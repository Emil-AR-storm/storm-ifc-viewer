// 📝 ENDRINGSMELDING FRA MODELLEN — panelet (byggeplan runde 3, verktøy 2;
// bygget 26.10.2026, Emils valg A: sidepanel med tre steg).
//
//   1 Kilde: siste Sammenligning (rev. A → B), eller valgte elementer.
//   2 Mengder og prisanslag: én linje per IFC-type, med avkrysning, enhet
//     (lm/m²/m³/stk/kg) og pris fra Priskalkulasjon (kan overstyres).
//   3 Tittel, EM-nummer (manuelt i V1) og frist.
//   «Lag EM-utkast» → EM-skjemaet (endringsmelding-v1) forhåndsutfylt: dato,
//   varselnummer, begrunnelse, ordrelinjer og vedlegg. Skjemaet er et UTKAST —
//   brukeren går gjennom, signerer og laster ned PDF.
//
// 🔒 26.10 (Emil: PDF C, lagring A, Godkjent/Avvist): EM-en er IKKE en markering
// lenger — markeringer reiser ut til byggeplassen. Den lagres internt i
// SharePoint-mappa Endringsmeldinger (em-lager.js), og panelet har to faner:
// «Ny endringsmelding» og «Endringsmeldinger» (lista: Opprettet → Sendt →
// Fullført · godkjent/avvist). Bildene tas automatisk, ett før/etter-par per
// endring med bare de elementene synlige (em-bilder.js), og står på egne
// liggende sider bakerst i PDF-en (em-pdf.js).
//
// Regningen ligger i js/em-regn.js.
import { $, på, S, apnePanel, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { sammenligningForEm } from "./compare.js";
import { allElementBoxes, lastNedXlsxFlere, quantitiesForSet, visElementUtenPanel, visPunkt } from "./elements.js";
import { metaFor, typeFor } from "./ifcrpc.js";
import { spLes, spPaalogget } from "./sp-lager.js";
import { fraLagret, prislisteNokkel } from "./priskalk-regn.js";
import { apneSkjema, hentMaler, iDagISO, nyttSkjema, vaskSkjema } from "./sjekkliste.js";
import { innloggetNavn } from "./markers.js";
import { hentBilde, huskBilde, lagreEm, lastOppBilde, lesEm, slettEm } from "./em-lager.js";
import { taEndringsbilder } from "./em-bilder.js";
import { tegnEmSider } from "./em-pdf.js";
import * as R from "./em-regn.js";
import { erKoordinering, forslagNokkel, revitNr } from "./em-paring.js";
import { detaljerFor } from "./em-detalj.js";

export const EM_MAL_ID = "endringsmelding-v1";

const tilstand = {
  kilde: "sammenligning", enheter: {}, egnePriser: {}, av: new Set(),
  tittel: "", emNr: "", oppdaget: "", fristDager: 3,
  poster: [], prisStatus: "", egenRetning: false,
  // 🔗 forslagene «mulig samme element» brukeren har krysset av (nøkkel → true),
  // og linjene som er krysset av automatisk som koordineringsobjekt én gang
  forslagValgt: new Set(), koordSett: new Set(),
  // 👁 blaing: hvilken liste og hvilket element som vises nå, og per type i tabellen
  bla: null, typeBla: {},
  // 🔒 fanen «Endringsmeldinger»
  fane: "ny", filter: "alle", sok: "", liste: [], listeStatus: ""
};
export const _tilstand = tilstand;   // testene

// ---------- Data ----------
function utvalgsIder() {
  return (S.multiSel && S.multiSel.size) ? [...S.multiSel.keys()].map(Number)
    : (S.currentPropID != null ? [Number(S.currentPropID)] : []);
}
function typeAv(id) {
  if (S.glbActive || (S.glbProps && S.glbProps.size)) { const p = S.glbProps && S.glbProps.get(id); if (p && p[2]) return p[2]; }
  return typeFor(id) || "";
}
function utvalgSomResultat() {
  const ider = utvalgsIder().filter(n => n > 0);
  if (!ider.length) return null;
  const boxes = allElementBoxes(), q = quantitiesForSet(new Set(ider));
  const ny = [];
  for (const id of ider) {
    const b = boxes.get(id); if (!b) continue;
    const c = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
    const d = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    const m = metaFor(id), p = S.glbProps && S.glbProps.get(id);
    ny.push({ id, type: typeAv(id), name: (m && m.name) || (p && p[0]) || "", c, d, v: ((q.get(id) || {}).vol) || 0 });
  }
  return { res: { ny, slettet: [], endret: [] }, utvalg: true, modell: S.fileName || "" };
}
export function kildeData() {
  if (tilstand.kilde !== "sammenligning") return utvalgSomResultat();
  const k = sammenligningForEm();
  if (!k) return k;
  // 🔗 Avkryssede forslag: samme element — det gamle blir «fra» på det nye, og begge
  // forsvinner fra fjernet/ny. Ikke avkrysset: står som før (fjernet + ny).
  const valgt = (k.res.forslag || []).filter(f => tilstand.forslagValgt.has(forslagNokkel(f)));
  if (valgt.length) {
    const ut = new Set(valgt.map(f => f.fra)), inn = new Set(valgt.map(f => f.til));
    k.res.slettet = k.res.slettet.filter(e => !ut.has(e));
    k.res.ny = k.res.ny.filter(e => !inn.has(e));
    k.res.endret = k.res.endret.concat(valgt.map(f => Object.assign({}, f.til, { fra: f.fra, nyId: "forslag" })));
  }
  return k;
}
export function linjer() {
  const k = kildeData();
  if (!k) return [];
  const l = R.mengdeDiff(k.res, { toM: S.enhetSkala || 1, enheter: tilstand.enheter });
  return R.prisAnslag(l, tilstand.poster, tilstand.egnePriser);
}
const valgte = () => linjer().filter(l => !tilstand.av.has(l.key));

export async function hentPriser() {
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const n = prislisteNokkel(info, S.fileName);
  const r = await spLes("Priskalkulasjon", n.fil);
  tilstand.prisStatus = r.status;
  tilstand.poster = (r.status === "ok") ? fraLagret(r.liste).poster : [];
  return tilstand.poster;
}

// ---------- Panelet ----------
const kr = (v) => v == null ? "—" : R.tallTekst(v) + " kr";
function html() {
  const s = sammenligningForEm(), utv = utvalgsIder().length;
  // Kilden byttes ALDRI av seg selv. Før ble den byttet til «Valgte elementer»
  // når sammenligningen var borte og ett element var valgt (det som ble vist
  // med «Vis») — og EM-test 4 ble én bjelke i stedet for hele endringen.
  const L = linjer(), sum = R.sumAnslag(L, l => !tilstand.av.has(l.key));
  const iDag = iDagISO();
  if (!tilstand.oppdaget) tilstand.oppdaget = iDag;
  const frist = R.emFrist(tilstand.oppdaget, tilstand.fristDager);
  const sek = (n, tekst) => '<div class="em-sek"><span class="em-n">' + n + '</span>' + esc(t(tekst)) + '</div>';
  let h = sek(1, "Kilde") + '<div class="em-kilder">' +
    '<button class="em-kilde' + (tilstand.kilde === "sammenligning" ? " valgt" : "") + '" data-kilde="sammenligning"' + (s ? "" : " disabled") + '>' +
      (s ? esc(t("Sammenligning {0} → {1}", kortNavn(s.fra), kortNavn(s.til))) : esc(t("Ingen sammenligning — bruk Sammenlign først"))) + '</button>' +
    '<button class="em-kilde' + (tilstand.kilde === "utvalg" ? " valgt" : "") + '" data-kilde="utvalg"' + (utv ? "" : " disabled") + '>' +
      esc(t("Valgte elementer ({0})", utv)) + '</button></div>';
  if (!s && tilstand.kilde === "sammenligning")
    h += '<p class="em-hjelp em-mangler">' + ikon("advarsel") + ' ' + esc(t("Sammenligningen er ikke aktiv. Åpne Sammenlign (den er ikke avsluttet før du trykker «Avslutt»), eller velg elementer og trykk «Valgte elementer».")) + '</p>';
  h += sek(2, "Mengder og prisanslag");
  if (!L.length) h += '<p class="em-hjelp">' + esc(s || utv ? t("Ingen endringer å telle.") : t("Sammenlign to revisjoner, eller velg elementer i modellen (shift-klikk), og kom tilbake hit.")) + '</p>';
  else {
    h += '<table class="em-tab"><tr><th></th><th>' + esc(t("Type")) + '</th><th>' + esc(t("Ny / fjernet / endret")) + '</th><th class="r">' + esc(t("Endring")) + '</th><th>' + esc(t("Enhet")) + '</th><th class="r">' + esc(t("Pris")) + '</th><th class="r">' + esc(t("Sum")) + '</th></tr>';
    for (const l of L) {
      const koord = erKoordinering(l.type, l.undertekst);
      if (koord && !tilstand.koordSett.has(l.key)) { tilstand.koordSett.add(l.key); tilstand.av.add(l.key); }
      const av = tilstand.av.has(l.key);
      h += '<tr class="em-rad' + (av ? " av" : "") + '" data-key="' + esc(l.key) + '">' +
        '<td><input type="checkbox" class="em-med"' + (av ? "" : " checked") + '></td>' +
        '<td><b>' + esc(t(l.navn)) + '</b>' + (koord ? ' <span class="em-koord">' + esc(t("koordineringsobjekt – sjekk før det prises")) + '</span>' : '') + '<div class="em-under">' + esc(l.undertekst) + '</div></td>' +
        '<td class="em-tall">+' + l.ny + ' / −' + l.slettet + ' / ' + l.endret + '</td>' +
        '<td class="r ' + (l.mengde < 0 ? "neg" : "pos") + '">' + esc(R.mengdeTekst(l).replace(" " + l.enhet, "")) + '</td>' +
        '<td><select class="em-enhet">' + R.EM_ENHETER.map(e => '<option' + (e === l.enhet ? " selected" : "") + '>' + e + '</option>').join("") + '</select></td>' +
        '<td class="r"><input class="em-pris" inputmode="decimal" value="' + (l.pris == null ? "" : esc(String(l.pris).replace(".", ","))) + '" placeholder="' + esc(t("mangler pris")) + '"></td>' +
        '<td class="r em-sum">' + esc(kr(l.sum)) + '</td></tr>';
    }
    h += '<tr class="em-sumrad"><td></td><td colspan="5">' + esc(t("Prisanslag (eks. mva)")) +
      (sum.manglerPris ? ' · <span class="em-mangler">' + esc(t("{0} linjer mangler pris", sum.manglerPris)) + '</span>' : "") + '</td><td class="r">' + esc(kr(sum.sum)) + '</td></tr></table>';
    h += '<p class="em-hjelp">' + esc(tilstand.prisStatus === "ok" ? t("Prisene er hentet fra Priskalkulasjon for prosjektet. Skriv inn pris der den mangler.")
      : tilstand.prisStatus === "av" ? t("Logg inn for å hente priser fra Priskalkulasjon.") : t("Ingen prisliste i Priskalkulasjon for prosjektet ennå — skriv inn prisene her.")) + '</p>';
  }
  h += paringHtml();
  h += sek(3, "Tittel, bilder og frist") +
    '<input id="emTittel" class="em-felt" maxlength="120" placeholder="' + esc(t("Tittel, f.eks. «Rev. B: nye søyler akse C»")) + '" value="' + esc(tilstand.tittel) + '">' +
    '<input id="emNr" class="em-felt" maxlength="30" placeholder="' + esc(t("EM-nummer (fra Storm Prosjektoversikt), f.eks. EM-14")) + '" value="' + esc(tilstand.emNr) + '">' +
    '<p class="em-hjelp">' + ikon("kamera") + ' ' + esc(t("Bildene tas automatisk når du lager utkastet: ett før- og ett etter-bilde per endring, der bare elementene i endringen vises. De står på egne sider bakerst i PDF-en.")) + '</p>' +
    '<label class="em-valg"><input type="checkbox" id="emEgenRetning"' + (tilstand.egenRetning ? " checked" : "") + '> ' +
      esc(t("Ta bildene fra retningen jeg ser modellen fra nå (ellers skrått ovenfra)")) + '</label>' +
    '<div class="em-frist">' + ikon("advarsel") + '<div>' + esc(t("Oppdaget")) + ' <input type="date" id="emOppdaget" value="' + esc(tilstand.oppdaget) + '"> · ' +
      esc(t("frist")) + ' <b>' + esc(frist.split("-").reverse().join(".")) + '</b> (' + esc(t("{0} dager", tilstand.fristDager)) + ')' +
      '<br><span class="em-hjelp">' + esc(t("Varsle uten ugrunnet opphold. Storms EM-flyt: frist 3 dager etter at endringen ble kjent.")) + '</span></div></div>';
  return h;
}
// 👁 Bla gjennom «samme element» / «mulig samme element» uten å lukke panelet
function blaListe(liste) {
  const k = tilstand.kilde === "sammenligning" ? sammenligningForEm() : null;
  if (!k) return [];
  return (liste === "forslag" ? k.res.forslag : k.res.uendretNyId) || [];
}
export function blaTil(liste, i) {
  const arr = blaListe(liste);
  if (!arr.length) return;
  tilstand.bla = { liste, i: Math.max(0, Math.min(i, arr.length - 1)) };
  const p = arr[tilstand.bla.i];
  try { if (!visElementUtenPanel(p.til.id)) visPunkt(p.til.c, p.til.d); } catch (_) {}
  tegn();
}

// 🔗 Prøve A (Emil 26.10): to bokser under mengdetabellen
// «Flat Bars:Flattstål 120x8:235953» → «Bjelke Flattstål 120x8»
const kortEl = (e) => { const d = String(e.name || "").split(":"); return (typeNavnKort(e.type) + " " + (d.length > 1 ? d[d.length - 2] : d[0])).trim(); };
const typeNavnKort = (type) => t(R.typeNavn(type));
// Hva er forskjellen på forslaget? «flyttet 25 mm» var senteret — en søyle som
// er forlenget 50 mm i toppen flytter senteret 25 mm (Emil, EM-test 5, 26.10).
// Nå står den korte teksten fra detaljene: «lengde +50 mm i toppen».
export function forslagTekst(f) {
  const el = (x) => ({ c: x.c, d: x.d, v: x.v, navn: x.name, r: x.r, L: x.L });
  let d = null;
  try { d = detaljerFor(Object.assign(el(f.til), { fra: el(f.fra) }), { toM: S.enhetSkala || 1, akser: S.akseLinjer }); } catch (_) { d = null; }
  const p = (d && d.punkter || []).filter(x => x.k !== "liten");
  if (!p.length) return t("flyttet {0} mm", f.avstandMm);
  const kort = p.map(x => {
    if (x.k === "lengde") { const m = /\(([^)]*)\)\s*$/.exec(x.tekst); return "lengde " + (m ? m[1] : ""); }
    return x.tekst.replace(/\s*\([^)]*\)\s*$/, "");
  }).join(", ");
  return kort.charAt(0).toLowerCase() + kort.slice(1);
}

function paringHtml() {
  const k = tilstand.kilde === "sammenligning" ? sammenligningForEm() : null;
  if (!k) return "";
  const samme = k.res.uendretNyId || [], forslag = k.res.forslag || [], dobbelt = k.res.dobbelt || [];
  let h = "";
  // 👁 «Viser nå: … ◀ 3 av 14 ▶» — bla uten at panelet lukkes
  const blaLinje = (liste, arr) => {
    const b = tilstand.bla;
    if (!b || b.liste !== liste || !arr.length) return "";
    const i = Math.min(b.i, arr.length - 1), p = arr[i];
    return '<div class="em-bla"><button data-bla-steg="-1" data-bla-liste="' + liste + '" title="' + esc(t("Forrige")) + '">◀</button>' +
      '<span>' + esc(t("Viser {0} av {1}: {2}", i + 1, arr.length, kortEl(p.til) + (R.akseFor(p.til.c, S.akseLinjer) ? " · " + R.akseFor(p.til.c, S.akseLinjer) : ""))) + '</span>' +
      '<button data-bla-steg="1" data-bla-liste="' + liste + '" title="' + esc(t("Neste")) + '">▶</button></div>';
  };
  if (samme.length) {
    h += '<div class="em-par"><div class="em-par-topp">' + ikon("hake") + ' <b>' + esc(t("Samme element, ny ID")) + '</b> <span class="em-antall-gra">' + samme.length + '</span>' +
      '<span class="em-hjelp"> — ' + esc(t("prises ikke")) + '</span></div>';
    h += blaLinje("samme", samme);
    for (const [i, p] of samme.slice(0, 4).entries()) h += '<div class="em-par-rad' + (tilstand.bla && tilstand.bla.liste === "samme" && tilstand.bla.i === i ? " aktiv" : "") + '"><span class="em-under">' + esc(kortEl(p.til)) + (R.akseFor(p.til.c, S.akseLinjer) ? ' · ' + esc(R.akseFor(p.til.c, S.akseLinjer)) : '') + '</span>' +
      '<span class="em-hjelp">' + esc(p.grunn === "revit" ? t("Revit-nr. {0}", revitNr(p.til.name)) : t("samme sted")) + '</span>' +
      '<button data-bla="samme:' + i + '">' + esc(t("Vis")) + '</button></div>';
    if (samme.length > 4) h += '<div class="em-hjelp">' + esc(t("+ {0} til — alle står i PDF-en og Excel", samme.length - 4)) + '</div>';
    h += '</div>';
  }
  if (forslag.length) {
    h += '<div class="em-par forslag"><div class="em-par-topp">? <b>' + esc(t("Mulig samme element")) + '</b> <span class="em-antall-gra">' + forslag.length + '</span>' +
      '<span class="em-hjelp"> — ' + esc(t("kryss av hvis det er samme stål")) + '</span></div>';
    h += blaLinje("forslag", forslag);
    for (const [i, f] of forslag.entries()) {
      const key = forslagNokkel(f);
      h += '<label class="em-par-rad' + (tilstand.bla && tilstand.bla.liste === "forslag" && tilstand.bla.i === i ? " aktiv" : "") + '"><input type="checkbox" data-forslag="' + esc(key) + '"' + (tilstand.forslagValgt.has(key) ? " checked" : "") + '>' +
        '<span>' + esc(kortEl(f.til)) + (R.akseFor(f.til.c, S.akseLinjer) ? ' · ' + esc(R.akseFor(f.til.c, S.akseLinjer)) : '') + '</span>' +
        '<span class="em-blaa">' + esc(forslagTekst(f)) + '</span>' +
        '<button data-bla="forslag:' + i + '">' + esc(t("Vis")) + '</button></label>';
    }
    h += '</div>';
  }
  if (dobbelt.length) h += '<p class="em-hjelp em-mangler">' + ikon("advarsel") + ' ' + esc(t("{0} nye elementer står oppå et annet likt element — mulig dobbeltelement i modellen. Sjekk før det prises.", dobbelt.length)) + '</p>';
  return h;
}

const kortNavn = (f) => String(f || "").replace(/\.(ifc|glb)$/i, "").slice(0, 28);

// ---------- 🔒 Fanen «Endringsmeldinger» ----------
const dato = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "." + m[2] + "." + m[1] : ""; };
const finn = (id) => tilstand.liste.find(e => e.id === id && !e.slettet);
const STATUS_KLASSE = { opprettet: "o", sendt: "s", godkjent: "g", avvist: "a" };

function faneHtml() {
  const n = R.tellStatus(tilstand.liste).alle;
  return '<div class="em-faner">' +
    '<button data-fane="ny" class="' + (tilstand.fane === "ny" ? "valgt" : "") + '">' + esc(t("Ny endringsmelding")) + '</button>' +
    '<button data-fane="liste" class="' + (tilstand.fane === "liste" ? "valgt" : "") + '">' + esc(t("Endringsmeldinger")) +
      (n ? ' <span class="em-antall">' + n + '</span>' : "") + '</button></div>';
}

function kortHtml(e) {
  const ant = e.endringer.reduce((s, x) => s + (x.antall || 0), 0);
  const knapp = (h, tekst, kl) => '<button data-handling="' + h + '"' + (kl ? ' class="' + kl + '"' : "") + '>' + esc(t(tekst)) + '</button>';
  let k = knapp("skjema", "Åpne skjema") + knapp("pdf", "PDF") + knapp("excel", "Excel");
  if (e.status === "opprettet") k += knapp("sendt", "Merk som sendt");
  else if (e.status === "sendt") k += knapp("godkjent", "Godkjent", "em-ok") + knapp("avvist", "Avvist", "em-nei");
  else k += knapp("kopier", "Kopier til ny");
  k += '<button data-handling="slett" class="em-slett" title="' + esc(t("Slett")) + '">' + ikon("slett") + '</button>';
  return '<div class="em-kort" data-em="' + esc(e.id) + '">' +
    '<div class="em-kort-topp"><b>' + esc(e.nr || "EM") + '</b><span class="em-kort-tittel">' + esc(e.tittel) + '</span>' +
      '<span class="em-kort-sum">' + esc(e.sum == null ? "—" : R.tallTekst(e.sum) + " kr") + '</span></div>' +
    '<div class="em-kort-meta"><span class="em-st ' + STATUS_KLASSE[e.status] + '">' + esc(t(R.STATUS_NAVN[e.status])) + '</span> · ' +
      esc(t("laget {0} av {1}", dato(e.laget), e.av || t("ukjent"))) + ' · ' + esc(t("frist {0}", dato(e.frist))) + ' · ' +
      esc(t("{0} endringer · {1} elementer", e.endringer.length, ant)) + '</div>' +
    '<div class="em-kort-knapper">' + k + '</div></div>';
}

function listeRader() {
  const vis = R.filtrerEm(tilstand.liste, { filter: tilstand.filter, sok: tilstand.sok });
  if (tilstand.listeStatus === "henter" && !tilstand.liste.length) return '<p class="em-hjelp">' + esc(t("Henter endringsmeldingene fra SharePoint …")) + '</p>';
  if (tilstand.listeStatus === "av") return '<p class="em-hjelp">' + esc(t("Logg inn for å se endringsmeldingene. De ligger bare i SharePoint.")) + '</p>';
  if (tilstand.listeStatus === "feil") return '<p class="em-hjelp em-mangler">' + esc(t("Klarte ikke å hente endringsmeldingene fra SharePoint. Prøv igjen om litt.")) + '</p>';
  if (!vis.length) return '<p class="em-hjelp">' + esc(tilstand.liste.some(e => !e.slettet) ? t("Ingen endringsmeldinger passer søket.") : t("Ingen endringsmeldinger for prosjektet ennå. Lag den første i fanen «Ny endringsmelding».")) + '</p>';
  return vis.map(kortHtml).join("");
}

function listeHtml() {
  const n = R.tellStatus(tilstand.liste);
  const chip = (f, tekst) => '<button class="em-chip' + (tilstand.filter === f ? " valgt" : "") + '" data-filter="' + f + '">' + esc(t(tekst)) + ' ' + n[f] + '</button>';
  return '<div class="em-intern">' + ikon("laas") + ' ' + esc(t("Internt. Lagres i SharePoint (Endringsmeldinger) og sendes aldri ut til byggeplassen.")) + '</div>' +
    '<input id="emSok" class="em-felt" placeholder="' + esc(t("Søk i nr. eller tittel …")) + '" value="' + esc(tilstand.sok) + '">' +
    '<div class="em-chips">' + chip("alle", "Alle") + chip("opprettet", "Opprettet") + chip("sendt", "Sendt") + chip("fullfort", "Fullført") + '</div>' +
    '<div id="emListe">' + listeRader() + '</div>';
}

function koblListe(body) {
  body.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { tilstand.filter = b.dataset.filter; tegn(); });
  const sok = $("emSok");
  if (sok) sok.oninput = () => { tilstand.sok = sok.value; const l = $("emListe"); if (l) { l.innerHTML = listeRader(); koblKort(l); } };
  koblKort(body);
}
function koblKort(rot) {
  rot.querySelectorAll(".em-kort [data-handling]").forEach(b => {
    b.onclick = () => {
      const id = b.closest(".em-kort").dataset.em, h = b.dataset.handling;
      if (h === "skjema") apneEmSkjema(id);
      else if (h === "pdf") lastNedEmPdf(id).catch(err => varsel(t("Klarte ikke å lage PDF-en: {0}", err.message)));
      else if (h === "excel") lastNedEmExcel(id).catch(err => varsel(err.message));
      else if (h === "sendt" || h === "godkjent" || h === "avvist") settStatus(id, h);
      else if (h === "kopier") kopierTilNy(id);
      else if (h === "slett") slett(id);
    };
  });
}

export async function lastListe() {
  tilstand.listeStatus = "henter"; tegn();
  const r = await lesEm();
  tilstand.listeStatus = r.status;
  if (r.status === "ok" || r.status === "tom") tilstand.liste = r.liste;
  tegn();
  return tilstand.liste;
}

export function tegn() {
  const body = $("emBody"); if (!body) return;
  const panel = $("emPanel");
  if (panel) panel.classList.toggle("em-fane-liste", tilstand.fane === "liste");
  body.innerHTML = faneHtml() + (tilstand.fane === "liste" ? listeHtml() : html());
  body.querySelectorAll("[data-fane]").forEach(b => b.onclick = () => {
    tilstand.fane = b.dataset.fane; tegn();
    if (tilstand.fane === "liste" && tilstand.listeStatus !== "henter") lastListe();
  });
  const sum = $("emSumApne");
  if (sum) sum.textContent = t("Sum åpne (opprettet + sendt): {0} kr eks. mva", R.tallTekst(R.sumApne(tilstand.liste)));
  if (tilstand.fane === "liste") { koblListe(body); return; }

  body.querySelectorAll("[data-kilde]").forEach(b => b.onclick = () => { tilstand.kilde = b.dataset.kilde; tegn(); });
  body.querySelectorAll(".em-rad").forEach(rad => {
    const key = rad.dataset.key;
    rad.querySelector(".em-med").onchange = (e) => { if (e.target.checked) tilstand.av.delete(key); else tilstand.av.add(key); tegn(); };
    rad.querySelector(".em-enhet").onchange = (e) => { tilstand.enheter[key] = e.target.value; delete tilstand.egnePriser[key]; tegn(); };
    rad.querySelector(".em-pris").onchange = (e) => {
      const v = String(e.target.value).replace(/\s/g, "").replace(",", ".");
      if (v === "") delete tilstand.egnePriser[key]; else if (isFinite(Number(v))) tilstand.egnePriser[key] = Number(v);
      tegn();
    };
    // Trykk på typen → vis elementene ett for ett (hvert trykk = neste), panelet blir stående
    rad.querySelector("td:nth-child(2)").onclick = () => {
      const l = linjer().find(x => x.key === key);
      if (!l || !l.ider.length) return;
      const i = ((tilstand.typeBla[key] == null ? -1 : tilstand.typeBla[key]) + 1) % l.ider.length;
      tilstand.typeBla[key] = i;
      try { visElementUtenPanel(l.ider[i]); } catch (_) {}
    };
  });
  const tt = $("emTittel"); if (tt) tt.oninput = () => { tilstand.tittel = tt.value; };
  const nr = $("emNr"); if (nr) nr.oninput = () => { tilstand.emNr = nr.value; };
  const od = $("emOppdaget"); if (od) od.onchange = () => { tilstand.oppdaget = od.value || iDagISO(); tegn(); };
  const er = $("emEgenRetning"); if (er) er.onchange = () => { tilstand.egenRetning = er.checked; };
  body.querySelectorAll("[data-forslag]").forEach(cb => cb.onchange = () => {
    if (cb.checked) tilstand.forslagValgt.add(cb.dataset.forslag); else tilstand.forslagValgt.delete(cb.dataset.forslag);
    tegn();
  });
  body.querySelectorAll(".em-par [data-bla]").forEach(b => b.onclick = (ev) => {
    ev.preventDefault();
    const [liste, i] = b.dataset.bla.split(":");
    blaTil(liste, Number(i));
  });
  body.querySelectorAll("[data-bla-steg]").forEach(b => b.onclick = (ev) => {
    ev.preventDefault();
    const liste = b.dataset.blaListe, n = blaListe(liste).length;
    if (!n) return;
    const i = tilstand.bla && tilstand.bla.liste === liste ? tilstand.bla.i : -1;
    blaTil(liste, (i + Number(b.dataset.blaSteg) + n) % n);
  });
  const harLinjer = linjer().some(l => !tilstand.av.has(l.key));
  if ($("emLag")) $("emLag").disabled = !harLinjer;
  if ($("emExcel")) $("emExcel").disabled = !harLinjer;
}

// ---------- Excel ----------
export async function lastNedExcel() {
  const k = kildeData() || {};
  const rader = R.excelRader(valgte(), { fra: kortNavn(k.fra), til: kortNavn(k.til) });
  const navn = ((S.prosjektInfo && S.prosjektInfo().nummer) ? S.prosjektInfo().nummer + " " : "") +
    t("Endringsmelding mengder") + " " + iDagISO() + ".xlsx";
  await lastNedXlsxFlere(navn, [{ navn: t("Endringsmelding"), rader }]);
}
export async function lastNedOversikt() {
  const navn = ((S.prosjektInfo && S.prosjektInfo().nummer) ? S.prosjektInfo().nummer + " " : "") +
    t("Endringsmeldinger") + " " + iDagISO() + ".xlsx";
  await lastNedXlsxFlere(navn, [{ navn: t("Endringsmeldinger"), rader: R.oversiktRader(tilstand.liste) }]);
}

// ---------- Lagring ----------
const naa = () => new Date().toISOString();
const hendelse = (hva) => ({ tid: naa(), av: innloggetNavn() || "", hva });

async function lagre(em, feilTekst) {
  const r = await lagreEm(em);
  if (!r.ok) {
    varsel(feilTekst || (r.grunn === "av" ? t("Logg inn for å lagre endringsmeldingen.") : t("Klarte ikke å lagre endringsmeldingen i SharePoint. Prøv igjen.")));
    return null;
  }
  tilstand.liste = r.liste; tilstand.listeStatus = "ok";
  tegn();
  return r.post;
}

export async function settStatus(id, ny) {
  const em = finn(id); if (!em || em.status === ny) return null;
  const forrige = em.status;
  const lagret = await lagre(Object.assign({}, em, { status: ny,
    historikk: em.historikk.concat(hendelse(t("Status: {0}", t(R.STATUS_NAVN[ny])))) }));
  if (lagret && S.pushAngre) S.pushAngre({ tekst: t("Status på {0}", em.nr || em.tittel),
    angre: () => { const x = finn(id); if (x) lagre(Object.assign({}, x, { status: forrige, historikk: x.historikk.concat(hendelse(t("Status tilbake: {0}", t(R.STATUS_NAVN[forrige])))) })); },
    gjenopprett: () => { const x = finn(id); if (x) lagre(Object.assign({}, x, { status: ny })); } });
  return lagret;
}

export async function slett(id) {
  const em = finn(id); if (!em) return null;
  if (!confirm(t("Slette {0} «{1}»? Du kan angre med Ctrl+Z.", em.nr || "EM", em.tittel))) return null;
  const r = await slettEm(em);
  if (!r.ok) { varsel(t("Klarte ikke å slette i SharePoint. Prøv igjen.")); return null; }
  tilstand.liste = r.liste; tegn();
  if (S.pushAngre) S.pushAngre({ tekst: t("Slett {0}", em.nr || em.tittel),
    angre: () => lagre(Object.assign({}, em, { slettet: false })),
    gjenopprett: () => { const x = finn(id); if (x) slettEm(x).then(rr => { if (rr.ok) { tilstand.liste = rr.liste; tegn(); } }); } });
  return true;
}

function kopierTilNy(id) {
  const em = finn(id); if (!em) return;
  tilstand.tittel = em.tittel; tilstand.emNr = "";
  tilstand.fane = "ny"; tegn();
  varsel(t("Tittelen er kopiert. Velg kilde og linjer for den nye endringsmeldingen."));
}

// ---------- Skjemaet og PDF-en ----------
async function emMal() {
  const maler = await hentMaler();
  const mal = maler && maler.maler && maler.maler.find(m => m.id === EM_MAL_ID);
  if (!mal) varsel(maler && maler.feil === "IKKE_INNLOGGET" ? t("Logg inn for å hente EM-skjemaet fra SharePoint.")
    : t("Fant ikke EM-skjemaet (Sjekklister/endringsmelding-v1.json) i SharePoint."));
  return mal || null;
}
const referanse = (em) => (em.nr ? em.nr + " · " : "") + em.tittel;

// Bildene hentes FØR PDF-en tegnes (tegningen er synkron)
export function ekstraSider(id) {
  return async () => {
    const em = finn(id);
    if (!em || !em.endringer.length) return null;
    const bilder = [];
    for (const e of em.endringer) bilder.push({ for: await hentBilde(e.bilder.for), etter: await hentBilde(e.bilder.etter) });
    return (d, ctx) => tegnEmSider(d, em, bilder, { logo: ctx.logo, avsender: ctx.m && ctx.m.avsender ? ctx.m.avsender.navn : "" });
  };
}

async function lagreSkjemaEm(id, nytt) {
  const em = finn(id); if (!em) return;
  const rent = vaskSkjema(nytt);
  const signert = rent && rent.laast && !(em.skjema && em.skjema.laast);
  await lagre(Object.assign({}, em, { skjema: rent,
    historikk: signert ? em.historikk.concat(hendelse(t("Signert av {0}", rent.signertAv || ""))) : em.historikk }));
}

export async function apneEmSkjema(id, malInn) {
  const em = finn(id); if (!em) return;
  const mal = malInn || await emMal(); if (!mal) return;
  const skjema = vaskSkjema(em.skjema) || nyttSkjema(mal);
  // Skjemaet åpnes i samme vindu som på markeringene, men «markeringen» her
  // er bare en bærer for tittel, forfatter og frist — den lagres aldri.
  const c = { id: em.id, text: referanse(em), author: em.av, date: dato(em.laget), owner: "", due: em.frist,
    bilder: [], bilderEtter: [], lyd: [], tegninger: [], svar: [] };
  await apneSkjema(c, mal, Object.assign({}, skjema, { svar: Object.assign({}, skjema.svar) }),
    (_c, nytt) => lagreSkjemaEm(id, nytt),
    { referanse: referanse(em), utenMarkering: true, ekstraSider: ekstraSider(id),
      kontekst: (k) => Object.assign(k, { lenke: "", emId: em.nr || "" }) });
}

async function hentValgtLogo() {
  try {
    const { valgtLogoFil } = await import("./excel-logo.js");
    const fil = valgtLogoFil(); if (!fil) return null;
    const { hentLogoer, hentLogo } = await import("./tegninger.js");
    const l = ((await hentLogoer()) || []).find(x => x.fil === fil);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}

// 📊 Mengdelista til en lagret EM — vedlegget skjemaet nevner (Emil 26.10)
export async function lastNedEmExcel(id) {
  const em = finn(id); if (!em) return null;
  const { emExcelArk } = await import("./em-detalj.js");
  const { ordreUtad } = await import("./skjema-pdf.js");
  const ordre = em.skjema && em.skjema.svar ? ordreUtad(em.skjema.svar.okonomi) : null;
  const navn = ((S.prosjektInfo && S.prosjektInfo().nummer) ? S.prosjektInfo().nummer + " " : "") +
    (em.nr ? em.nr + " " : "") + t("Mengdeliste") + " " + iDagISO() + ".xlsx";
  await lastNedXlsxFlere(navn.replace(/[\\/:*?"<>|]/g, "-"), emExcelArk(em, ordre));
  return navn;
}

export async function lastNedEmPdf(id) {
  const em = finn(id); if (!em) return null;
  const mal = await emMal(); if (!mal) return null;
  const skjema = vaskSkjema(em.skjema) || nyttSkjema(mal);
  const mod = await import("./skjema-pdf.js");
  return mod.lastNedSkjema({ mal, skjema, prosjekt: (S.prosjektInfo && S.prosjektInfo().nummer) || "",
    referanse: referanse(em), iDag: iDagISO(), hentLogo: hentValgtLogo, ekstraSider: ekstraSider(id) });
}

// ---------- Lag EM-utkast ----------
const kompakteAkser = (a) => a ? { tol: a.tol, x: (a.x || []).slice(0, 80).map(l => ({ c: l.c, navn: l.navn })), z: (a.z || []).slice(0, 80).map(l => ({ c: l.c, navn: l.navn })) } : null;

export async function lagUtkast() {
  const L = valgte();
  if (!L.length) { varsel(t("Kryss av minst én linje først.")); return null; }
  if (!spPaalogget()) { varsel(t("Logg inn for å lagre endringsmeldingen. Den lagres bare internt i SharePoint, aldri på byggeplassen.")); return null; }
  const mal = await emMal(); if (!mal) return null;
  const k = kildeData() || { res: { ny: [], slettet: [], endret: [] } };
  const utvalg = !!k.utvalg;
  // Aksenavnene («mot akse D») — lages stille hvis aksene ikke er slått på
  if (!S.akseLinjer && S.sikreAkseLinjer) { try { await S.sikreAkseLinjer(); } catch (_) {} }
  const endringer = R.endringerFra(k.res, L, { toM: S.enhetSkala || 1, akser: S.akseLinjer, utvalg });
  const id = "em" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const iDag = iDagISO(), frist = R.emFrist(tilstand.oppdaget || iDag, tilstand.fristDager);
  const tittel = String(tilstand.tittel || "").trim() || t("Endringsmelding fra modellen");
  const oppdagetTekst = String(tilstand.oppdaget || iDag).split("-").reverse().join(".");

  // Bildene: ett før/etter-par per endring, bare de elementene synlige
  let bildeFeil = 0;
  loadingEl.classList.add("open");
  try {
    for (let i = 0; i < endringer.length; i++) {
      loadingText.textContent = t("Tar bilder av endring {0} av {1} …", i + 1, endringer.length);
      let b = { for: null, etter: null };
      try { b = await taEndringsbilder(endringer[i], { egenRetning: tilstand.egenRetning, utvalg }); } catch (err) { console.warn("EM-bildet feilet:", err); }
      for (const hva of ["for", "etter"]) {
        if (!b[hva]) continue;
        const navn = R.bildeFil(id, i, hva);
        const r = await lastOppBilde(navn, b[hva]);
        if (r.ok) { endringer[i].bilder[hva] = navn; huskBilde(navn, b[hva]); } else bildeFeil++;
      }
    }
  } finally { loadingEl.classList.remove("open"); }

  const skjema = nyttSkjema(mal);
  skjema.svar = {
    oversendtDato: iDag,
    varselnummer: (String(tilstand.emNr || "").trim() ? String(tilstand.emNr).trim() + " – " : "") + tittel,
    begrunnelse: R.faktablokk(L, { fra: kortNavn(k.fra), til: kortNavn(k.til), metode: k.metode,
      utvalg: k.utvalg, modell: kortNavn(k.modell), oppdaget: oppdagetTekst, nyId: (k.res.uendretNyId || []).length }),
    okonomi: R.ordrelinjer(L),
    annet: [t("Vedlegg:"), "• " + t("Før- og etter-bilder fra 3D-modellen og mål for hvert endret element (bakerst i dokumentet)"), "• " + t("Mengdeliste (Excel) fra Storm IFC-Viewer, sendes som egen fil sammen med dette dokumentet")].join("\n")
  };
  const sum = R.sumAnslag(L);
  const em = R.vaskEm({
    id, nr: String(tilstand.emNr || "").trim(), tittel, status: "opprettet", laget: naa(), av: innloggetNavn() || "",
    oppdaget: tilstand.oppdaget || iDag, frist, sum: sum.sum, manglerPris: sum.manglerPris,
    modell: S.fileName || "", fra: kortNavn(k.fra), til: kortNavn(k.til || S.fileName), metode: k.metode || "",
    utvalg, toM: S.enhetSkala || 1, akser: kompakteAkser(S.akseLinjer), endringer, skjema: vaskSkjema(skjema),
    nyIdAndre: R.nyIdUtenEndring(k.res, endringer, { akser: S.akseLinjer }),
    historikk: [hendelse(t("Laget"))]
  });
  const lagret = await lagre(em);
  if (!lagret) return null;
  if (S.pushAngre) S.pushAngre({ tekst: t("Endringsmelding"),
    angre: () => { const x = finn(id); if (x) slettEm(x).then(r => { if (r.ok) { tilstand.liste = r.liste; tegn(); } }); },
    gjenopprett: () => lagre(Object.assign({}, em, { slettet: false })) });
  tilstand.fane = "liste"; tegn();
  varsel(t("EM-utkastet er lagret internt i Endringsmeldinger. Gå gjennom skjemaet, signer og last ned PDF.") +
    (bildeFeil ? " " + t("{0} bilder ble ikke lastet opp.", bildeFeil) : ""));
  try { await apneEmSkjema(id, mal); } catch (_) {}
  return finn(id);
}

// ---------- Knapper ----------
på("btnEm", "click", async () => {
  const p = $("emPanel");
  if (p && p.classList.contains("open")) { p.classList.remove("open"); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  apnePanel("emPanel");
  tegn();
  try { await hentPriser(); } catch (_) {}
  tegn();
  lastListe().catch(() => {});
});
på("emLag", "click", async () => {
  const b = $("emLag"); if (b) b.disabled = true;
  try { await lagUtkast(); } finally { tegn(); }
});
på("emExcel", "click", () => { lastNedExcel().catch(err => varsel(err.message)); });
på("emOversikt", "click", () => { lastNedOversikt().catch(err => varsel(err.message)); });
