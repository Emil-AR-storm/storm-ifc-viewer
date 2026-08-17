// 📋 Sjekklister: maler fra SharePoint, utfylling på en markering, og forslag
// til utfylling som må godkjennes før de blir svar.
//
// Mappestruktur, ved siden av Tegninger/ og Logoer/:
//   IFC-modeller/Sjekklister/endringsmelding-v1.json
//
// Legg fila i mappa, så dukker malen opp i menyen. Ingen kode å endre.
//
// TO TING SOM STYRER HELE DESIGNET:
//
// 1. SVARENE LAGRES SOM DATA, IKKE SOM PDF. Et utfylt skjema er
//    { malId, svar: {feltId: verdi} } på markeringen. PDF-en regnes ut på nytt
//    ved nedlasting. Lagres skjemaet som en ferdig PDF, kan systemet aldri
//    svare på «hvilke sjekkpunkt stryker oftest» — og det er hele grunnen til
//    å digitalisere skjemaet i det hele tatt.
//
// 2. ET FORSLAG ER IKKE ET SVAR. Forslagene vises i svak grå tekst ved siden
//    av feltet og lagres ALDRI før noen har trykket Godkjenn. Sperren ligger
//    her i datalaget (`byggSvar` leser bare `.verdi`, aldri forslaget), ikke i
//    CSS. Et skjema som kommer 70 % utfylt og ser ferdig ut, innbyr til å
//    trykke fullfør — og i et dokument der tomme felt kan ha preklusiv virkning
//    er det selve risikoen ved funksjonen.
import { S, $, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { lesMappe } from "./tegninger.js";

export const sjekklisteMappe = () => SP.folder + "/Sjekklister";
export const erJson = (navn) => /\.json$/i.test(String(navn || ""));

// Felttypene motoren kjenner. Ukjent type i en malfil blir til «tekst» — en mal
// med en skrivefeil skal vises, ikke forsvinne.
export const FELTTYPER = ["tekst", "fritekst", "dato", "valg", "flervalg", "ordrelinjer"];

// Kildene et forslag kan komme fra. Alt annet i en malfil ignoreres: en mal
// skal ikke kunne be om et felt motoren ikke vet hva er.
export const FORSLAGSKILDER = ["iDag", "varselnummer", "tittel", "faktablokk",
  "vedleggsliste", "ansvarlig", "frist", "forfatter", "prosjekt"];

// Felttyper som ALDRI får forslag. Dette er juridiske valg, ikke data.
// Systemet kan vise hva markeringen inneholder — det kan ikke foreslå hva
// Storm krever. Et forhåndsvalgt «Ingen påfølgende konsekvenser» ville vært
// den dyreste enkeltfeilen denne funksjonen kan gjøre.
export const UTEN_FORSLAG = ["valg", "flervalg", "ordrelinjer"];

export const MAKS_SKJEMA_PER_MARKERING = 20;

// Tak på den tegnede signaturen (tegn i data-URL-en, ca. 45 kB). Markeringsfila
// hentes på nytt hver gang noen åpner modellen — også på en telefon på
// byggeplassen — så en signatur som vokser ukontrollert koster dekning.
export const MAKS_SIGNATUR = 60000;

// ═══════════════════════ REN LOGIKK ═══════════════════════
// Alt over NETTLESER-skillet er uten DOM, S og Graph, og er det _test-suiten
// kjører. Samme deling som js/rapport.js — feil i tallene fanges der de
// oppstår, ikke når noen ser et rart skjema.

export function sjekklisteI(c) {
  return (c && Array.isArray(c.skjema)) ? c.skjema : [];
}

// Bare den siste versjonen av hvert skjema vises i lista. De gamle blir
// liggende (se laasSkjema) og kan fortsatt lastes ned.
export function gjeldendeSkjema(c) {
  const alle = sjekklisteI(c);
  const siste = new Map();
  for (const s of alle) {
    const f = siste.get(s.malId);
    if (!f || (Number(s.versjon) || 1) > (Number(f.versjon) || 1)) siste.set(s.malId, s);
  }
  return [...siste.values()];
}

export function nyId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// ---------- Malfila ----------

function vaskFelt(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").trim();
  if (!id) return null;                                   // felt uten id kan ikke lagres
  const type = FELTTYPER.includes(r.type) ? r.type : "tekst";
  const f = {
    id,
    nr: String(r.nr == null ? "" : r.nr),
    navn: String(r.navn == null ? id : r.navn),
    type,
    pakrevd: r.pakrevd === true,
    merknad: String(r.merknad == null ? "" : r.merknad)
  };
  if (type === "valg" || type === "flervalg") {
    f.valg = (Array.isArray(r.valg) ? r.valg : []).map(v => String(v)).filter(Boolean);
    if (!f.valg.length) f.type = "tekst";                 // valgfelt uten valg er ubrukelig
  }
  // Forslagskilden slippes bare gjennom hvis den er kjent OG typen tåler den.
  if (!UTEN_FORSLAG.includes(f.type) && FORSLAGSKILDER.includes(r.autofyll)) f.autofyll = r.autofyll;
  return f;
}

// Leser en malfil. Returnerer null hvis den er ubrukelig — den som kaller skal
// si HVILKEN fil som er ødelagt, ikke bare vise en tom meny.
export function vaskMal(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").trim();
  const navn = String(r.navn || "").trim();
  if (!id || !navn) return null;
  const seksjoner = (Array.isArray(r.seksjoner) ? r.seksjoner : [])
    .map(s => ({
      tittel: String((s && s.tittel) || ""),
      felt: (Array.isArray(s && s.felt) ? s.felt : []).map(vaskFelt).filter(Boolean)
    }))
    .filter(s => s.felt.length);
  if (!seksjoner.length) return null;
  const a = r.avsender && typeof r.avsender === "object" ? r.avsender : {};
  return {
    id, navn,
    versjon: Number(r.versjon) || 1,
    beskrivelse: String(r.beskrivelse == null ? "" : r.beskrivelse),
    // Brevhodet i PDF-en. Ligger i malen, ikke i koden: Storm Betong AS og
    // Storm Entreprenør AS er to juridiske enheter, og hvilken som er part
    // avgjøres av kontrakten — ikke av hvilken logo noen valgte i menyen.
    avsender: {
      navn: String(a.navn == null ? "" : a.navn),
      orgnr: String(a.orgnr == null ? "" : a.orgnr),
      adresse: String(a.adresse == null ? "" : a.adresse),
      sted: String(a.sted == null ? "" : a.sted)
    },
    seksjoner
  };
}

export function alleFelt(mal) {
  return (mal && mal.seksjoner || []).reduce((ut, s) => ut.concat(s.felt), []);
}

// ---------- Ordrelinjer (2.4) ----------
// Formelen er MÅLT i Gripr 17.08.2026 med 10 stk à 100 kr, 20 % påslag,
// 25 % mva — ikke gjettet:
//
//   Totalpris   = antall × enhetspris        →  1 000   ← dette er KOSTNADEN
//   Fortjeneste = Totalpris × påslag%        →    200
//   Sum eks mva = Totalpris + Fortjeneste    →  1 200
//   Sum inkl mva= Sum eks mva × (1 + mva%)   →  1 500
//   Margin      = Fortjeneste / Totalpris    →   20 %  (samme tall som påslaget)
//
// ENHETSPRIS ER KOSTPRIS. Derfor må dokumentet som går ut vise SALGSPRIS per
// enhet (enhetspris × (1 + påslag)), ikke enhetsprisen. Ellers kan mottakeren
// regne seg til påslaget ved å dele totalen på antallet.

export const STANDARD_MVA = 25;

export function vaskLinje(r) {
  if (!r || typeof r !== "object") return null;
  const tall = (v, d) => { const n = Number(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : d; };
  return {
    produkt: String(r.produkt == null ? "" : r.produkt).slice(0, 200),
    antall: tall(r.antall, 0),
    enhet: String(r.enhet == null ? "stk" : r.enhet).slice(0, 20),
    enhetspris: tall(r.enhetspris, 0),
    paslag: tall(r.paslag, 0),
    mva: tall(r.mva, STANDARD_MVA)
  };
}

export function tomLinje() {
  return { produkt: "", antall: 0, enhet: "stk", enhetspris: 0, paslag: 0, mva: STANDARD_MVA };
}

// Én linje regnet ut. `salgsEnhetspris` er den ENESTE prisen som skal ut av
// huset — `kostnad` og `fortjeneste` er interne tall.
export function linjeSum(r) {
  const l = vaskLinje(r) || tomLinje();
  const kostnad = l.antall * l.enhetspris;
  const fortjeneste = kostnad * (l.paslag / 100);
  const eksMva = kostnad + fortjeneste;
  const mvaBelop = eksMva * (l.mva / 100);
  return {
    kostnad, fortjeneste, eksMva, mvaBelop,
    inklMva: eksMva + mvaBelop,
    salgsEnhetspris: l.enhetspris * (1 + l.paslag / 100)
  };
}

export function ordreSum(rader) {
  const ut = { kostnad: 0, fortjeneste: 0, eksMva: 0, mvaBelop: 0, inklMva: 0, antallLinjer: 0 };
  for (const r of (Array.isArray(rader) ? rader : [])) {
    const s = linjeSum(r);
    ut.kostnad += s.kostnad; ut.fortjeneste += s.fortjeneste;
    ut.eksMva += s.eksMva; ut.mvaBelop += s.mvaBelop; ut.inklMva += s.inklMva;
    ut.antallLinjer++;
  }
  ut.margin = ut.kostnad ? (ut.fortjeneste / ut.kostnad) * 100 : 0;
  return ut;
}

// Norsk pengeformat: 1 500,00 — mellomrom som tusenskille, komma som desimal.
export function kr(n) {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  const [h, d] = Math.abs(v).toFixed(2).split(".");
  return (v < 0 ? "−" : "") + h.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + "," + d;
}

// ---------- Det utfylte skjemaet ----------

export function vaskSkjema(r) {
  if (!r || typeof r !== "object") return null;
  const malId = String(r.malId || "").trim();
  if (!malId) return null;
  const svar = {};
  if (r.svar && typeof r.svar === "object") {
    for (const k of Object.keys(r.svar)) {
      const v = r.svar[k];
      // Flervalg lagres som array, alt annet som streng.
      // Ordrelinjer er en liste med OBJEKTER; flervalg en liste med strenger.
      if (Array.isArray(v)) svar[String(k)] = v.every(x => x && typeof x === "object")
        ? v.map(vaskLinje).filter(Boolean).slice(0, 100)
        : v.map(x => String(x));
      else if (v != null) svar[String(k)] = String(v);
    }
  }
  return {
    id: r.id == null ? nyId() : String(r.id),
    malId,
    malNavn: String(r.malNavn == null ? malId : r.malNavn),
    malVersjon: Number(r.malVersjon) || 1,
    versjon: Number(r.versjon) || 1,
    svar,
    // Hvilke felt som ble fylt av et godkjent forslag. Internt sporbart, og
    // står ALDRI i dokumentet som går til byggherren.
    forslagGodkjent: (Array.isArray(r.forslagGodkjent) ? r.forslagGodkjent : []).map(x => String(x)),
    signertAv: String(r.signertAv == null ? "" : r.signertAv),
    signertTid: String(r.signertTid == null ? "" : r.signertTid),
    // Tegnet signatur som data-URL, eller "" når «Ikke nødvendig» ble valgt.
    // Vaskes hardt: bare PNG fra denne appen, og med tak på størrelsen — en
    // markeringsfil som vokser til flere MB gjør byggeplass-siden ubrukelig.
    signatur: (typeof r.signatur === "string" &&
               /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.signatur) &&
               r.signatur.length <= MAKS_SIGNATUR)
      ? r.signatur : "",
    laast: r.laast === true,
    erstatter: r.erstatter == null ? null : Number(r.erstatter) || null
  };
}

export function nyttSkjema(mal) {
  return {
    id: nyId(),
    malId: mal.id,
    malNavn: mal.navn,
    malVersjon: mal.versjon,
    versjon: 1,
    svar: {},
    forslagGodkjent: [],
    signertAv: "",
    signertTid: "",
    signatur: "",
    laast: false,
    erstatter: null
  };
}

export function tomtSvar(v) {
  if (Array.isArray(v)) return v.length === 0;
  return String(v == null ? "" : v).trim() === "";
}

// Hvilke påkrevde felt står tomme? Dette er sperren mot «fullfør» — den røde
// «Ikke besvart» skal ikke bare vises, den skal stoppe.
export function manglerPakrevd(mal, skjema) {
  return alleFelt(mal)
    .filter(f => f.pakrevd && tomtSvar(skjema.svar[f.id]))
    .map(f => f);
}

// Ny versjon av et låst skjema. Den gamle blir liggende — et skjema som kan
// endres i ettertid uten spor er ikke dokumentasjon, det er en notatblokk.
export function nyVersjon(gammelt) {
  return {
    ...gammelt,
    id: nyId(),
    versjon: (Number(gammelt.versjon) || 1) + 1,
    svar: { ...gammelt.svar },
    forslagGodkjent: [...(gammelt.forslagGodkjent || [])],
    signertAv: "",
    signertTid: "",
    signatur: "",
    laast: false,
    erstatter: Number(gammelt.versjon) || 1
  };
}

export function laasSkjema(skjema, navn, tid, signatur) {
  return {
    ...skjema, laast: true,
    signertAv: String(navn || ""),
    signertTid: String(tid || ""),
    signatur: typeof signatur === "string" ? signatur : ""
  };
}

// ---------- Forslagsmotoren ----------

export function iDagISO(naa) {
  const d = naa instanceof Date ? naa : new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

// Faktablokken til «Begrunnelse». Dette er den delen ingen annen kilde i Storm
// kan produsere automatisk — særlig linja om endring mot forrige revisjon.
// Jussen skrives av mennesket; motoren leverer bare fakta med kilde.
export function faktablokk(k) {
  const l = [];
  if (k.elementNavn) l.push(t("Bygningsdel: {0}", k.elementNavn + (k.ifcType ? " (" + k.ifcType + ")" : "")));
  if (k.globalId) l.push(t("IFC-referanse: {0}", k.globalId));
  if (k.revisjon) l.push(t("Modellrevisjon: {0}", k.revisjon));
  if (k.tegning) l.push(t("Tegningsgrunnlag: {0}", k.tegning));
  if (k.endring) l.push(t("Endring mot forrige revisjon: {0}", k.endring));
  if (k.registrert) l.push(t("Registrert: {0}", k.registrert));
  if (k.tekst) l.push("", t("Beskrivelse fra byggeplassen:"), k.tekst);
  if (k.transkripsjon) l.push("", t("Talemelding (maskinskrevet, ikke kontrollert):"), k.transkripsjon);
  l.push("", t("Hjemmel: [fyll inn punkt fra NS 84xx]"));
  return l.join("\n");
}

// Vedleggslista. Nesten gratis å bygge, og det er den som gjør varselet
// etterprøvbart.
export function vedleggsliste(k) {
  const l = [];
  if (k.antBilder) l.push("• " + t("{0} bilder", k.antBilder) + (k.bildePeriode ? " (" + k.bildePeriode + ")" : ""));
  if (k.antLyd) l.push("• " + t("{0} talemeldinger", k.antLyd));
  if (k.tegning) l.push("• " + t("Arbeidstegning {0}", k.tegning));
  if (k.revisjon) l.push("• " + t("Utsnitt av 3D-modellen, revisjon {0}", k.revisjon));
  if (k.lenke) l.push("• " + t("Lenke til markeringen: {0}", k.lenke));
  return l.length ? t("Vedlegg:") + "\n" + l.join("\n") : "";
}

// Ett forslag: { verdi, kilde }. `kilde` vises under den grå teksten — uten
// den er «Godkjenn» et blindt klikk.
export function forslagFor(felt, k) {
  if (!felt.autofyll) return null;
  switch (felt.autofyll) {
    case "iDag":
      return { verdi: k.iDag || iDagISO(), kilde: t("dagens dato") };
    case "varselnummer":
      return { verdi: (k.emId ? k.emId + " – " : "") + (k.tittel || ""),
               kilde: k.emId ? t("EM-nummer og markeringens tittel")
                             : t("markeringens tittel — EM-nummer må fylles inn manuelt") };
    case "tittel":
      return k.tittel ? { verdi: k.tittel, kilde: t("markeringens tittel") } : null;
    case "faktablokk": {
      const v = faktablokk(k);
      return v ? { verdi: v, kilde: t("markering, element, tegning og revisjonssammenligning") } : null;
    }
    case "vedleggsliste": {
      const v = vedleggsliste(k);
      return v ? { verdi: v, kilde: t("vedleggene på markeringen") } : null;
    }
    case "ansvarlig":
      return k.ansvarlig ? { verdi: k.ansvarlig, kilde: t("ansvarlig på markeringen") } : null;
    case "frist":
      return k.frist ? { verdi: k.frist, kilde: t("fristen på markeringen") } : null;
    case "forfatter":
      return k.forfatter ? { verdi: k.forfatter, kilde: t("den som opprettet markeringen") } : null;
    case "prosjekt":
      return k.prosjekt ? { verdi: k.prosjekt, kilde: t("prosjektnummeret") } : null;
    default:
      return null;
  }
}

// Alle forslag for en mal. Felt uten kilde, og felt som allerede har et svar,
// får ingenting — et forslag skal aldri overskrive noe et menneske har skrevet.
export function byggForslag(mal, k, skjema) {
  const ut = {};
  for (const f of alleFelt(mal)) {
    if (skjema && !tomtSvar(skjema.svar[f.id])) continue;
    const forslag = forslagFor(f, k || {});
    if (forslag && !tomtSvar(forslag.verdi)) ut[f.id] = forslag;
  }
  return ut;
}

// Hvor mange felt kan foreslås nå? Brukes til teksten på knappen, så den ikke
// lover mer enn den leverer.
export function antallForslag(mal, k, skjema) {
  return Object.keys(byggForslag(mal, k, skjema)).length;
}

// ═══════════════════════ NETTLESER ═══════════════════════

// ---------- Malbiblioteket fra SharePoint ----------

let malBuffer = null;

// Svar: { maler: [...], feil: [ {fil, grunn} ] } · { feil: "IKKE_INNLOGGET" }
// En ødelagt JSON i mappa skal si hvilken fil det gjelder, ikke gi tom meny.
export async function hentMaler(paNytt) {
  if (malBuffer && !paNytt) return malBuffer;
  if (LETT) return { maler: [], feil: [] };        // sjekklister er et kontorverktøy i v1
  let token;
  try { token = await spTokenSilent(); } catch (_) { token = null; }
  if (!token) return { feil: "IKKE_INNLOGGET" };
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  const innhold = await lesMappe(sjekklisteMappe(), token);
  if (innhold === null) return { maler: [], feil: [], mangler: true };

  const maler = [], feil = [];
  for (const f of (innhold || []).filter(x => x.file && erJson(x.name))) {
    try {
      // Nøyaktig samme kall som pdfDokument() i tegninger.js gjør for
      // arbeidstegninger. Den veien er i drift og virker – en egenskrevet
      // variant med håndlaget Authorization-header ville vært en ny,
      // utestet vei til samme fil.
      const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/items/" +
        encodeURIComponent(f.id) + "/content", { headers: authHeaders(token, null, "sjekklistemal") });
      if (!r.ok) { feil.push({ fil: f.name, grunn: "Graph " + r.status }); continue; }
      const mal = vaskMal(await r.json());
      if (mal) maler.push(mal);
      else feil.push({ fil: f.name, grunn: t("mangler id, navn eller felt") });
    } catch (err) {
      feil.push({ fil: f.name, grunn: err.message });
    }
  }
  maler.sort((a, b) => a.navn.localeCompare(b.navn, "no"));
  malBuffer = { maler, feil };
  return malBuffer;
}

export function tomMalbuffer() { malBuffer = null; }

// ---------- Konteksten forslagene bygges av ----------
// Alt hentes fra markeringen slik den faktisk er. Der en opplysning ikke
// finnes, står feltet tomt — det gjettes aldri. En merkelapp som selv er en
// gjetning er verre enn ingen merkelapp.
export async function byggKontekst(c, tilleggsFn) {
  const meta = (S.meta && c.elementId != null) ? S.meta.get(c.elementId) : null;
  const bilder = ((c.bilder || []).length) + ((c.bilderEtter || []).length);
  const teg = (c.tegninger || [])[0];
  const k = {
    iDag: iDagISO(),
    emId: "",                                    // hentes fra Excel i en senere runde
    tittel: String(c.text || "").split("\n")[0].slice(0, 80),
    tekst: String(c.text || ""),
    prosjekt: String(S.lettProsjekt || S.prosjektnummer || ""),
    ansvarlig: String(c.owner || ""),
    frist: String(c.due || ""),
    forfatter: String(c.author || ""),
    registrert: c.date ? t("{0} av {1}", c.date, c.author || t("ukjent")) : "",
    revisjon: String(S.revisjon || ""),
    elementNavn: meta ? String(meta.name || meta.typeName || "") : "",
    ifcType: meta ? String(meta.objectType || meta.typeName || "") : "",
    globalId: String(c.globalId || (meta && meta.globalId) || ""),
    tegning: teg ? teg.fil + (teg.side > 1 ? " s. " + teg.side : "") : "",
    endring: "",                                 // fylles av compare i en senere runde
    transkripsjon: "",                           // fylles av Whisper i en senere runde
    antBilder: bilder,
    antLyd: (c.lyd || []).length,
    bildePeriode: "",
    lenke: ""
  };
  // ⛓-lenka er ASYNK og tar hele markeringen, ikke id-en. Kalles den feil,
  // havner «[object Promise]» rett i vedleggslista — og det så ut som en
  // gyldig lenke helt til noen leste den.
  try { if (S.markerLink) k.lenke = String(await S.markerLink(c) || ""); } catch (_) { k.lenke = ""; }
  return typeof tilleggsFn === "function" ? (tilleggsFn(k) || k) : k;
}

// ---------- Seksjonen i markeringsbobla ----------

export function skjemaTekst(s) {
  return s.malNavn + (s.versjon > 1 ? t(" · v{0}", s.versjon) : "");
}

export function sjekklisteStripeHtml(c) {
  const liste = gjeldendeSkjema(c);
  return '<div class="mp-seksjon"><div class="mp-seksjon-tittel">' + t("Dokumentasjon") +
    (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
    '<div class="mp-skjemaer">' +
    liste.map(s =>
      '<span class="mp-skjema' + (s.laast ? " laast" : "") + '" data-skjema="' + esc(s.id) + '" ' +
      'title="' + (s.laast
        ? t("Signert av {0} {1}", esc(s.signertAv), esc(s.signertTid))
        : t("Ikke fullført")) + '">' +
      ikon(s.laast ? "laas" : "rediger") + ' ' + esc(skjemaTekst(s)) +
      (s.laast ? "" : ' <span class="uferdig">' + t("uferdig") + '</span>') +
      '</span>').join("") +
    '<button class="mp-skjema nytt" id="mpSkjema">' + ikon("tegning") + ' ' + t("Dokumentasjon") + '</button>' +
    '</div></div>';
}

// ---------- Overlayet ----------

function overlay() {
  let el = $("skjemaVelg");
  if (!el) {
    el = document.createElement("div");
    el.id = "skjemaVelg";
    document.body.appendChild(el);
  }
  return el;
}

function lukk() {
  const el = $("skjemaVelg");
  if (el) el.classList.remove("open");
}

function boks(tittel, kropp, bunn) {
  return '<div class="sv-boks"><div class="sv-topp"><strong>' + esc(tittel) + '</strong>' +
    '<button class="sv-x" title="' + t("Lukk") + '">' + ikon("lukk") + '</button></div>' +
    '<div class="sv-kropp">' + kropp + '</div>' +
    '<div class="sv-bunn">' + (bunn || "") + '</div></div>';
}

function vis(el, html) {
  el.innerHTML = html;
  el.classList.add("open");
  const x = el.querySelector(".sv-x");
  if (x) x.onclick = lukk;
}

// Malvelgeren: hvilken sjekkliste skal fylles ut?
export async function apneMalVelger(c, lagre) {
  const el = overlay();
  vis(el, boks(t("Velg sjekkliste"), '<p class="sv-info">' + t("Henter maler …") + '</p>'));

  let svar;
  try { svar = await hentMaler(); }
  catch (err) { vis(el, boks(t("Velg sjekkliste"), '<p class="sv-feil">' + esc(err.message) + '</p>')); return; }

  if (svar.feil === "IKKE_INNLOGGET") {
    vis(el, boks(t("Velg sjekkliste"),
      '<p class="sv-feil">' + t("Du må være logget inn i SharePoint for å hente sjekklistemaler.") + '</p>'));
    return;
  }
  if (svar.mangler || !svar.maler.length) {
    vis(el, boks(t("Velg sjekkliste"),
      '<p class="sv-info">' + t("Ingen maler funnet. Legg JSON-maler i mappa {0} i SharePoint.", esc(sjekklisteMappe())) + '</p>' +
      malfeilHtml(svar.feil)));
    return;
  }

  vis(el, boks(t("Velg sjekkliste"),
    '<div class="sv-maler">' + svar.maler.map(m =>
      '<button class="sv-mal" data-mal="' + esc(m.id) + '"><strong>' + esc(m.navn) + '</strong>' +
      (m.beskrivelse ? '<span>' + esc(m.beskrivelse) + '</span>' : "") + '</button>').join("") +
    '</div>' + malfeilHtml(svar.feil)));

  el.querySelectorAll(".sv-mal").forEach(b => {
    b.onclick = () => {
      const mal = svar.maler.find(m => m.id === b.dataset.mal);
      if (mal) apneSkjema(c, mal, nyttSkjema(mal), lagre);
    };
  });
}

function malfeilHtml(feil) {
  if (!feil || !feil.length) return "";
  return '<div class="sv-malfeil"><strong>' + t("Maler som ikke kunne leses:") + '</strong>' +
    feil.map(f => '<div>' + esc(f.fil) + ' — ' + esc(f.grunn) + '</div>').join("") + '</div>';
}

// ---------- Utfyllingen ----------
// `forslag` holdes utenfor `skjema` med vilje. Så lenge de er to forskjellige
// objekter, kan et forslag ikke lagres ved et uhell.

export async function apneSkjema(c, mal, skjema, lagre) {
  const el = overlay();
  // Konteksten bygges ÉN gang. Den henter ⛓-lenka over nettet, og skal ikke
  // gjøres på nytt for hver opptegning.
  const kontekst = await byggKontekst(c);
  let forslag = byggForslag(mal, kontekst, skjema);

  // Ubesvart-merkingen oppdateres UTEN å tegne skjemaet på nytt. Tegner vi alt
  // på nytt ved hvert kryss, mister brukeren rulleposisjonen midt i et langt
  // skjema — og uten oppdatering står «Ikke besvart» rødt på et felt som er
  // besvart, og «Fullfør» blir aldri klikkbar. Det siste er feilen Emil fant.
  function oppdaterStatus() {
    const mangler = manglerPakrevd(mal, skjema);
    const ubesvarte = new Set(mangler.map(f => f.id));
    el.querySelectorAll(".sv-felt[data-feltid]").forEach(d =>
      d.classList.toggle("ubesvart", ubesvarte.has(d.dataset.feltid)));
    const banner = el.querySelector(".sv-mangler");
    if (banner) {
      banner.classList.toggle("skjult", mangler.length === 0);
      const tekst = banner.querySelector(".sv-mangler-tekst");
      if (tekst) tekst.textContent = t("Kan ikke fullføres. Ikke besvart: {0}",
        mangler.map(f => (f.nr ? f.nr + " " : "") + f.navn).join(", "));
    }
    const fullfor = el.querySelector(".sv-fullfor");
    if (fullfor) fullfor.disabled = mangler.length > 0;
  }

  function tegn() {
    const laast = skjema.laast;
    const mangler = manglerPakrevd(mal, skjema);
    const antF = Object.keys(forslag).length;

    const kropp =
      (laast ? '<div class="sv-laast">' + ikon("laas") + " " +
        t("Signert av {0} den {1}. Trykk «Ny versjon» for å endre — den signerte utgaven blir liggende.",
          esc(skjema.signertAv), esc(skjema.signertTid)) + '</div>' : "") +
      (skjema.erstatter ? '<div class="sv-info">' +
        t("Versjon {0}. Erstatter versjon {1}, som fortsatt kan lastes ned.", skjema.versjon, skjema.erstatter) +
        '</div>' : "") +
      mal.seksjoner.map(s =>
        '<div class="sv-seksjon"><h4>' + esc(s.tittel) + '</h4>' +
        s.felt.map(f => feltHtml(f, skjema, forslag[f.id], laast)).join("") +
        '</div>').join("") +
      // Banneret tegnes ALLTID og skjules med en klasse, så oppdaterStatus()
      // kan vise og skjule det uten å bygge skjemaet på nytt.
      '<div class="sv-mangler' + (mangler.length ? "" : " skjult") + '">' + ikon("advarsel") +
        ' <span class="sv-mangler-tekst">' +
        esc(t("Kan ikke fullføres. Ikke besvart: {0}",
          mangler.map(f => (f.nr ? f.nr + " " : "") + f.navn).join(", "))) + '</span></div>';

    const pdfKn = '<button class="sv-pdf" title="' +
      t("Last ned som PDF. Kostpris, påslag og fortjeneste er ikke med.") + '">' +
      ikon("lastned") + ' ' + t("Last ned PDF") + '</button>';
    const bunn = laast
      ? pdfKn + '<button class="sv-versjon">' + ikon("rediger") + ' ' + t("Ny versjon") + '</button>' +
        '<button class="sv-lukk">' + t("Lukk") + '</button>'
      : pdfKn + (antF ? '<button class="sv-alle" title="' +
            t("Fyller inn forslag i {0} felt. Hvert felt må godkjennes for seg.", antF) + '">' +
            ikon("fortsett") + ' ' + t("Anbefalt utfylling ({0})", antF) + '</button>' : "") +
        '<button class="sv-lagre">' + ikon("lagre") + ' ' + t("Lagre uten å fullføre") + '</button>' +
        '<button class="sv-fullfor"' + (mangler.length ? " disabled" : "") + '>' +
            ikon("hake") + ' ' + t("Fullfør og signer") + '</button>';

    // Rulleposisjonen tas vare på: Godkjenn på felt 3 skal ikke sende deg
    // tilbake til toppen av skjemaet.
    const gammel = el.querySelector(".sv-kropp");
    const rull = gammel ? gammel.scrollTop : 0;
    vis(el, boks(mal.navn + (skjema.versjon > 1 ? " · v" + skjema.versjon : ""), kropp, bunn));
    const ny = el.querySelector(".sv-kropp");
    if (ny && rull) ny.scrollTop = rull;
    kobl();
  }

  function kobl() {
    // Skriving i et felt fjerner forslaget for det feltet — mennesket har tatt
    // over, og da skal ikke en grå tekst ligge og se ut som et alternativ.
    el.querySelectorAll("[data-felt]").forEach(inp => {
      const id = inp.dataset.felt;
      if (inp.type === "checkbox") {
        inp.onchange = () => {
          const na = new Set(Array.isArray(skjema.svar[id]) ? skjema.svar[id] : []);
          if (inp.checked) na.add(inp.value); else na.delete(inp.value);
          skjema.svar[id] = [...na];
          oppdaterStatus();
        };
      } else if (inp.type === "radio") {
        inp.onchange = () => { if (inp.checked) { skjema.svar[id] = inp.value; oppdaterStatus(); } };
      } else {
        inp.oninput = () => {
          skjema.svar[id] = inp.value;
          if (forslag[id]) { delete forslag[id]; tegn(); }
          else oppdaterStatus();
        };
      }
    });

    // Ordrelinjer. Tallene regnes om i cellene UTEN å bygge tabellen på nytt —
    // ellers mister du markøren midt i et beløp for hvert tastetrykk.
    function tegnOrdreTall(feltId) {
      const boks = el.querySelector('.sv-ordre[data-ordrefelt="' + feltId + '"]');
      if (!boks) return;
      const rader = Array.isArray(skjema.svar[feltId]) ? skjema.svar[feltId] : [];
      boks.querySelectorAll("tbody tr[data-rad]").forEach(tr => {
        const l = linjeSum(rader[Number(tr.dataset.rad)]);
        tr.querySelectorAll(".sv-o-ut").forEach(td => { td.textContent = kr(l[td.dataset.ut]); });
      });
      const sum = ordreSum(rader);
      boks.querySelectorAll("[data-sum]").forEach(b => {
        b.textContent = b.dataset.sum === "margin" ? sum.margin.toFixed(0) + " %" : kr(sum[b.dataset.sum]);
      });
      oppdaterStatus();
    }

    el.querySelectorAll("[data-ordre][data-kol]").forEach(inp => {
      inp.oninput = () => {
        const id = inp.dataset.ordre, i = Number(inp.dataset.rad), kol = inp.dataset.kol;
        const rader = Array.isArray(skjema.svar[id]) ? skjema.svar[id] : [];
        if (!rader[i]) return;
        rader[i][kol] = (kol === "produkt" || kol === "enhet") ? inp.value : inp.value;
        skjema.svar[id] = rader.map(r => vaskLinje(r) || tomLinje());
        // vaskLinje gjør tall om til tall; skriv IKKE verdien tilbake i feltet,
        // det ville hoppet markøren og spist et halvskrevet «12,».
        tegnOrdreTall(id);
      };
    });

    el.querySelectorAll(".sv-o-ny").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.ordre;
        const rader = (Array.isArray(skjema.svar[id]) ? skjema.svar[id] : []).slice();
        rader.push(tomLinje());
        skjema.svar[id] = rader;
        tegn();
      };
    });

    el.querySelectorAll(".sv-o-slett").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.ordre, i = Number(b.dataset.rad);
        skjema.svar[id] = (skjema.svar[id] || []).filter((_, n) => n !== i);
        tegn();
      };
    });

    el.querySelectorAll(".sv-godkjenn").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.godkjenn;
        const f = forslag[id];
        if (!f) return;
        skjema.svar[id] = f.verdi;
        if (!skjema.forslagGodkjent.includes(id)) skjema.forslagGodkjent.push(id);
        delete forslag[id];
        tegn();
      };
    });

    el.querySelectorAll(".sv-avlys").forEach(b => {
      b.onclick = () => { delete forslag[b.dataset.avlys]; tegn(); };
    });

    const alle = el.querySelector(".sv-alle");
    if (alle) alle.onclick = () => {
      // «Anbefalt utfylling» fyller ikke inn noe — den viser forslagene på nytt
      // for alle felt som kan få et. Godkjenningen skjer fortsatt per felt.
      forslag = byggForslag(mal, kontekst, skjema);
      tegn();
    };

    const lagreKn = el.querySelector(".sv-lagre");
    if (lagreKn) lagreKn.onclick = () => { lagre(c, skjema); lukk(); };

    const fullfor = el.querySelector(".sv-fullfor");
    if (fullfor) fullfor.onclick = async () => {
      if (manglerPakrevd(mal, skjema).length) return;
      const sign = await bePåSignatur((S.innloggetNavn && S.innloggetNavn()) || "");
      if (!sign) return;                                   // avbrutt — ingenting låses
      skjema = laasSkjema(skjema, sign.navn, new Date().toLocaleString("no-NO",
        { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        sign.signatur);
      lagre(c, skjema);
      tegn();
    };

    const versjon = el.querySelector(".sv-versjon");
    if (versjon) versjon.onclick = () => {
      skjema = nyVersjon(skjema);
      forslag = byggForslag(mal, kontekst, skjema);
      tegn();
    };

    const pdf = el.querySelector(".sv-pdf");
    if (pdf) pdf.onclick = async () => {
      try {
        const mod = await import("./skjema-pdf.js");
        await mod.lastNedSkjema({
          mal, skjema,
          prosjekt: kontekst.prosjekt,
          markering: kontekst.tittel,
          iDag: kontekst.iDag,
          hentLogo: typeof S.hentRapportLogo === "function" ? S.hentRapportLogo : null
        });
      } catch (err) {
        alert(t("Klarte ikke å lage PDF-en: {0}", err.message));
      }
    };

    const lukkKn = el.querySelector(".sv-lukk");
    if (lukkKn) lukkKn.onclick = lukk;
  }

  tegn();
}

// Ordrelinje-tabellen. Påslag og fortjeneste vises HER, på kontoret, fordi
// prosjektlederen trenger dem for å prise jobben. De skal ikke ut av huset —
// PDF-en (js/skjema-pdf.js) utelater dem, og viser salgspris i stedet for
// kostpris, slik at tallene går opp uten at kostnaden kan regnes tilbake.
export function ordreHtml(f, rader, laast) {
  const av = laast ? " disabled" : "";
  const sum = ordreSum(rader);
  const celle = (i, n, verdi, bredde, steg) =>
    '<input type="number" step="' + (steg || "any") + '" class="sv-o-tall" style="width:' + bredde + '" ' +
    'data-ordre="' + esc(f.id) + '" data-rad="' + i + '" data-kol="' + n + '" value="' + esc(verdi) + '"' + av + '>';

  return '<div class="sv-ordre" data-ordrefelt="' + esc(f.id) + '">' +
    '<table class="sv-o-tab"><thead><tr>' +
      '<th>' + t("Produkt") + '</th><th>' + t("Antall") + '</th><th>' + t("Enhet") + '</th>' +
      '<th>' + t("Enhetspris") + '</th><th>' + t("Totalpris") + '</th><th>' + t("Påslag") + '</th>' +
      '<th>' + t("Fortjeneste") + '</th><th>' + t("MVA") + '</th><th>' + t("Total (inkl. mva)") + '</th><th></th>' +
    '</tr></thead><tbody>' +
    (rader.length ? rader.map((r, i) => {
      const l = linjeSum(r);
      return '<tr data-rad="' + i + '">' +
        '<td><input type="text" class="sv-o-produkt" data-ordre="' + esc(f.id) + '" data-rad="' + i + '" ' +
          'data-kol="produkt" value="' + esc(r.produkt || "") + '"' + av + '></td>' +
        '<td>' + celle(i, "antall", r.antall, "62px") + '</td>' +
        '<td><input type="text" class="sv-o-enhet" data-ordre="' + esc(f.id) + '" data-rad="' + i + '" ' +
          'data-kol="enhet" value="' + esc(r.enhet || "stk") + '"' + av + '></td>' +
        '<td>' + celle(i, "enhetspris", r.enhetspris, "84px") + '</td>' +
        '<td class="sv-o-ut" data-ut="kostnad">' + kr(l.kostnad) + '</td>' +
        '<td>' + celle(i, "paslag", r.paslag, "58px") + ' %</td>' +
        '<td class="sv-o-ut" data-ut="fortjeneste">' + kr(l.fortjeneste) + '</td>' +
        '<td>' + celle(i, "mva", r.mva, "54px") + ' %</td>' +
        '<td class="sv-o-ut sterk" data-ut="inklMva">' + kr(l.inklMva) + '</td>' +
        '<td>' + (laast ? "" : '<button class="sv-o-slett" data-ordre="' + esc(f.id) +
          '" data-rad="' + i + '" title="' + t("Fjern linjen") + '">' + ikon("slett") + '</button>') + '</td>' +
      '</tr>';
    }).join("") : '<tr class="sv-o-tom"><td colspan="10">' + t("Ingen ordrelinjer ennå.") + '</td></tr>') +
    '</tbody></table>' +
    (laast ? "" : '<button class="sv-o-ny" data-ordre="' + esc(f.id) + '">' +
      ikon("pluss") + ' ' + t("Legg til en fritekstrad") + '</button>') +
    '<div class="sv-o-sum">' +
      '<div><span>' + t("Total (eks. mva)") + '</span><b data-sum="eksMva">' + kr(sum.eksMva) + '</b></div>' +
      '<div><span>' + t("MVA") + '</span><b data-sum="mvaBelop">' + kr(sum.mvaBelop) + '</b></div>' +
      '<div class="stor"><span>' + t("Total (inkl. mva)") + '</span><b data-sum="inklMva">' + kr(sum.inklMva) + '</b></div>' +
      '<div class="intern"><span>' + t("Total kostnad") + '</span><b data-sum="kostnad">' + kr(sum.kostnad) + '</b></div>' +
      '<div class="intern"><span>' + t("Fortjeneste") + '</span><b data-sum="fortjeneste">' + kr(sum.fortjeneste) +
        '</b> <em data-sum="margin">' + sum.margin.toFixed(0) + ' %</em></div>' +
      '<div class="sv-o-varsel">' + t("Kostnad, påslag og fortjeneste vises bare her. De kommer ikke med i PDF-en.") + '</div>' +
    '</div></div>';
}

// Ett felt. Forslaget ligger UTENFOR input-elementet — aldri som value, aldri
// som placeholder på et felt som lagres. Det er den mekaniske garantien for at
// grå tekst ikke kan bli et svar.
function feltHtml(f, skjema, forslag, laast) {
  const v = skjema.svar[f.id];
  const tom = tomtSvar(v);
  const av = laast ? " disabled" : "";
  const nr = f.nr ? '<span class="sv-nr">' + esc(f.nr) + '</span> ' : "";

  let inn = "";
  if (f.type === "fritekst") {
    inn = '<textarea data-felt="' + esc(f.id) + '" rows="4"' + av + '>' + esc(v || "") + '</textarea>';
  } else if (f.type === "dato") {
    inn = '<input type="date" data-felt="' + esc(f.id) + '" value="' + esc(v || "") + '"' + av + '>';
  } else if (f.type === "valg") {
    inn = '<div class="sv-valg">' + f.valg.map((o, i) =>
      '<label><input type="radio" name="' + esc(f.id) + '" data-felt="' + esc(f.id) + '" value="' + esc(o) + '"' +
      (v === o ? " checked" : "") + av + '> ' + esc(o) + '</label>').join("") + '</div>';
  } else if (f.type === "flervalg") {
    const valgt = Array.isArray(v) ? v : [];
    inn = '<div class="sv-valg">' + f.valg.map(o =>
      '<label><input type="checkbox" data-felt="' + esc(f.id) + '" value="' + esc(o) + '"' +
      (valgt.includes(o) ? " checked" : "") + av + '> ' + esc(o) + '</label>').join("") + '</div>';
  } else if (f.type === "ordrelinjer") {
    inn = ordreHtml(f, Array.isArray(v) ? v : [], laast);
  } else {
    inn = '<input type="text" data-felt="' + esc(f.id) + '" value="' + esc(v || "") + '"' + av + '>';
  }

  const forslagHtml = (forslag && !laast)
    ? '<div class="sv-forslag"><div class="sv-forslag-tekst">' + esc(forslag.verdi) + '</div>' +
      '<div class="sv-forslag-bunn"><span class="sv-forslag-kilde">' +
        t("Forslag fra {0}", esc(forslag.kilde)) + '</span>' +
      '<button class="sv-godkjenn" data-godkjenn="' + esc(f.id) + '">' + ikon("hake") + ' ' + t("Godkjenn") + '</button>' +
      '<button class="sv-avlys" data-avlys="' + esc(f.id) + '">' + t("Avlys") + '</button></div></div>'
    : "";

  return '<div class="sv-felt' + (f.pakrevd && tom ? " ubesvart" : "") +
    '" data-feltid="' + esc(f.id) + '">' +
    '<label class="sv-etikett">' + nr + esc(f.navn) +
      (f.pakrevd ? ' <span class="sv-pakrevd">*</span>' : "") + '</label>' +
    (f.merknad ? '<div class="sv-merknad">' + esc(f.merknad) + '</div>' : "") +
    inn +
    // Tegnes ALLTID for paakrevde felt og skjules med CSS. Da kan
    // oppdaterStatus() vise og skjule den ved et kryss, uten aa bygge om.
    (f.pakrevd ? '<div class="sv-ubesvart">' + t("Ikke besvart") + '</div>' : "") +
    forslagHtml +
    '</div>';
}

// ---------- Signaturboksen ----------
// Navn i tekst OG en tegnet signatur. «Ikke nødvendig» finnes fordi ikke alle
// skjema krever signatur — men den er et VALG som registreres, ikke en snarvei
// forbi låsingen: skjemaet låses uansett, og at signaturen ble utelatt står i
// dokumentet.
//
// Signaturen lagres som PNG-data-URL på markeringen. Lerretet er 480×160, som
// gir noen få kB. Taket (MAKS_SIGNATUR) finnes fordi markeringsfila hentes på
// nytt hver gang noen åpner modellen — også på en telefon på byggeplassen.
export const SIGNATUR_B = 480, SIGNATUR_H = 160;

export function bePåSignatur(standardNavn) {
  return new Promise((ferdig) => {
    let el = $("signaturBoks");
    if (!el) { el = document.createElement("div"); el.id = "signaturBoks"; document.body.appendChild(el); }
    el.innerHTML =
      '<div class="sg-boks"><div class="sg-topp"><strong>' + t("Signer skjemaet") + '</strong>' +
        '<button class="sg-x" title="' + t("Lukk") + '">' + ikon("lukk") + '</button></div>' +
      '<div class="sg-kropp">' +
        '<label class="sg-etikett">' + t("Navn") + ' <span class="sv-pakrevd">*</span></label>' +
        '<input type="text" id="sgNavn" value="' + esc(standardNavn || "") + '" autocomplete="off">' +
        '<label class="sg-etikett">' + t("Signatur — tegn med musa") + '</label>' +
        '<div class="sg-lerret-ramme">' +
          '<canvas id="sgLerret" width="' + SIGNATUR_B + '" height="' + SIGNATUR_H + '"></canvas>' +
          '<div class="sg-strek"></div>' +
        '</div>' +
        '<div class="sg-verktoy"><button class="sg-tom">' + t("Tøm") + '</button>' +
          '<span class="sg-hint">' + t("Hold inne museknappen og skriv. På berøringsskjerm: bruk fingeren.") + '</span></div>' +
      '</div>' +
      '<div class="sg-bunn">' +
        '<button class="sg-avbryt">' + t("Avbryt") + '</button>' +
        '<button class="sg-uten">' + t("Ikke nødvendig") + '</button>' +
        '<button class="sg-ok">' + ikon("hake") + ' ' + t("Signer og lås") + '</button>' +
      '</div></div>';
    el.classList.add("open");

    const lerret = $("sgLerret"), navnFelt = $("sgNavn");
    // Uten 2D-kontekst (eldre nettleser, blokkert lerret) skal boksen fortsatt
    // virke: navn og «Ikke nødvendig» holder. Å kaste her ville låst brukeren
    // ute fra å fullføre skjemaet i det hele tatt.
    let d = null;
    try { d = lerret && lerret.getContext ? lerret.getContext("2d") : null; } catch (_) { d = null; }
    if (d) {
      d.lineWidth = 2.2; d.lineCap = "round"; d.lineJoin = "round";
      // Streken skal ha temaets tekstfarge. Feiler oppslaget, tegner vi svart
      // — en signatur er verdiløs hvis den er usynlig.
      let farge = "";
      try {
        farge = window.getComputedStyle(document.documentElement)
          .getPropertyValue("--text").trim();
      } catch (_) { farge = ""; }
      d.strokeStyle = farge || "#111";
    } else {
      el.querySelector(".sg-lerret-ramme").innerHTML =
        '<div class="sg-uten-lerret">' + t("Tegneflaten er ikke tilgjengelig her. Velg «Ikke nødvendig».") + '</div>';
    }
    let tegner = false, tegnet = false, forrige = null;

    const punkt = (e) => {
      const r = lerret.getBoundingClientRect();
      const kilde = (e.touches && e.touches[0]) || e;
      return { x: (kilde.clientX - r.left) * (lerret.width / r.width),
               y: (kilde.clientY - r.top) * (lerret.height / r.height) };
    };
    const start = (e) => { if (!d) return; e.preventDefault(); tegner = true; forrige = punkt(e); };
    const flytt = (e) => {
      if (!tegner || !d) return;
      e.preventDefault();
      const p = punkt(e);
      d.beginPath(); d.moveTo(forrige.x, forrige.y); d.lineTo(p.x, p.y); d.stroke();
      forrige = p; tegnet = true;
    };
    const slutt = () => { tegner = false; forrige = null; };
    if (d) lerret.addEventListener("pointerdown", start);
    if (d) {
      lerret.addEventListener("pointermove", flytt);
      lerret.addEventListener("pointerup", slutt);
      lerret.addEventListener("pointerleave", slutt);
    }

    const lukkSig = () => { el.classList.remove("open"); el.innerHTML = ""; };
    const svar = (verdi) => { lukkSig(); ferdig(verdi); };

    el.querySelector(".sg-tom").onclick = () => {
      if (d) d.clearRect(0, 0, lerret.width, lerret.height);
      tegnet = false;
    };
    el.querySelector(".sg-x").onclick = () => svar(null);
    el.querySelector(".sg-avbryt").onclick = () => svar(null);

    const navnEllerStopp = () => {
      const navn = navnFelt.value.trim();
      if (!navn) { navnFelt.focus(); navnFelt.classList.add("mangler"); return null; }
      return navn;
    };

    el.querySelector(".sg-uten").onclick = () => {
      const navn = navnEllerStopp();
      if (!navn) return;
      if (!confirm(t("Låse skjemaet uten tegnet signatur? Det blir stående i dokumentet at signatur ikke var påkrevd."))) return;
      svar({ navn, signatur: "" });
    };

    el.querySelector(".sg-ok").onclick = () => {
      const navn = navnEllerStopp();
      if (!navn) return;
      if (!tegnet) { alert(t("Tegn signaturen i feltet, eller velg «Ikke nødvendig».")); return; }
      let data = "";
      try { data = String(lerret.toDataURL("image/png") || ""); } catch (_) { data = ""; }
      if (!/^data:image\/png;base64,/.test(data)) {
        alert(t("Klarte ikke å lagre signaturen. Velg «Ikke nødvendig», eller prøv en annen nettleser."));
        return;
      }
      // For stor signatur lagres ikke — heller navn alene enn en markeringsfil
      // som vokser til flere MB og gjør byggeplass-siden treg.
      if (data.length > MAKS_SIGNATUR) {
        alert(t("Signaturen ble for stor til å lagres. Prøv en enklere strek, eller velg «Ikke nødvendig»."));
        return;
      }
      svar({ navn, signatur: data });
    };

    navnFelt.oninput = () => navnFelt.classList.remove("mangler");
    setTimeout(() => navnFelt.focus(), 30);
  });
}

export function visStatus(tekst) {
  if (!tekst) { loadingEl.classList.remove("open"); return; }
  loadingText.textContent = tekst;
  loadingEl.classList.add("open");
}
