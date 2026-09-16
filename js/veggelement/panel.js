// 🗂 Panelet: sammenfoldede seksjoner, oppsettfeltene og logovalget.
//
// Én av åtte deler av SW-generatoren. js/veggelement.js er inngangen og
// samler dem; se toppen av den fila for hva generatoren gjør.
//
// DELENE PEKER PÅ HVERANDRE BEGGE VEIER, og det er med vilje: dette var én
// fil på 6500 linjer, og å rive den i atskilte lag ville vært en omskriving,
// ikke en oppdeling. ES-moduler tåler ringer så lenge navnene brukes når
// koden KJØRER, ikke mens modulen lastes — derfor står det bare
// registreringer av lyttere på toppnivå her, aldri utregninger som leser en
// konstant fra en annen del.

import { $, S, esc, ikon } from "../state.js";
import { t } from "../i18n.js";
import { hentLogoer } from "../tegninger.js";
import { ryddLogonavn } from "../rapport.js";
import { SW_KLARING_MM, SW_MIN_FELT_MM, nesteUtspType, parseRadHoyder, sikreUtspTyper } from "./regler.js";
import { lagreResultat, lagret, lastInnResultat, lesLagrede, okBetongNaa, oppsett, skrivLagret, slettResultat, swLagringsTekst } from "./tilstand.js";
import { boks, tegnAlt, utspPaFasader } from "./tegning.js";
import { felt, fjernAltGenerert, generer, lastNedListe, lesOppsettFraPanel } from "./generer.js";
import { lastNedTegning } from "./stal.js";
import { startFinnUtsp, startJuster, startUtspMark, utspListeHtml } from "./juster.js";
import { fasadePanelHtml, innerForhandsvis, innerMark, innerPanelHtml, koblInnerPanel, oppdaterInnerveggerEtterUtsp, slettManuellFasade, startInnerMark } from "./innervegg.js";

// ---------- 📂 Sammenfoldede seksjoner ----------
// Panelet ble for langt å bla i: ni seksjoner med felt, tekst og lister under
// hverandre (Emil 08.09: «det tar alt for lang tid å bla gjennom hele
// verktøyet, det er rotete»). Hver <h4> blir derfor en <details>: bare
// overskriften står, og et trykk åpner seksjonen. Hvilke som står åpne huskes
// i localStorage — på tvers av modeller, fordi det er en ARBEIDSMÅTE, ikke
// noe om bygget: den som jobber med utsparinger vil ha den seksjonen åpen på
// neste bygg også.
//
// HVORFOR ETTERBEHANDLING AV DOM-EN OG IKKE <details> I HTML-STRENGEN: HTML-en
// bygges av seks funksjoner med rundt sytti felt, og hvert felt slås opp med
// $("swBetong") osv. Å pakke strengen om ville rørt alt det; å flytte noder
// etterpå rører ingenting — elementene finnes fortsatt med samme id.
// Handlingsknappene (Generer, Juster, PDF, Excel, Fjern) er merket
// data-sw-fast og blir stående utenfor: de skal aldri gjemmes bak en
// overskrift.
export const SEKSJON_NOKKEL = "storm-sw-seksjoner-apne";
export const SEKSJON_STANDARD_APEN = [];   // alle lukket til man åpner dem

export function lesApneSeksjoner() {
  try {
    const l = JSON.parse(localStorage.getItem(SEKSJON_NOKKEL) || "null");
    return Array.isArray(l) ? l : SEKSJON_STANDARD_APEN.slice();
  } catch (_) { return SEKSJON_STANDARD_APEN.slice(); }
}

export function skrivApneSeksjoner(liste) {
  try { localStorage.setItem(SEKSJON_NOKKEL, JSON.stringify(liste)); } catch (_) {}
}

// Ren: hvilken nøkkel en overskrift huskes under. data-sek fremfor teksten,
// fordi teksten skifter med språket — den som byttet til polsk skulle ikke
// miste hvilke seksjoner som sto åpne.
export function seksjonNokkel(h4) {
  return (h4.getAttribute && h4.getAttribute("data-sek")) || (h4.textContent || "").trim();
}

export function foldSeksjoner(body) {
  if (!body || typeof document === "undefined") return;
  const apne = new Set(lesApneSeksjoner());
  const barn = Array.from(body.childNodes);
  let boks = null;
  for (const n of barn) {
    if (n.nodeType === 1 && n.tagName === "H4") {
      const nokkel = seksjonNokkel(n);
      boks = document.createElement("details");
      boks.className = "sw-seksjon";
      boks.setAttribute("data-sek", nokkel);
      if (apne.has(nokkel)) boks.open = true;
      const sum = document.createElement("summary");
      body.insertBefore(boks, n);
      sum.appendChild(n);
      boks.appendChild(sum);
      boks.addEventListener("toggle", () => {
        const liste = lesApneSeksjoner().filter(k => k !== nokkel);
        if (boks.open) liste.push(nokkel);
        skrivApneSeksjoner(liste);
      });
      continue;
    }
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-sw-fast")) { boks = null; continue; }
    if (boks) boks.appendChild(n);
  }
}

export function tegnPanel() {
  const body = $("swBody");
  if (!body) return;
  const o = oppsett();
  const antall = (lagret && lagret.vegger || []).length;
  const lagrede = lesLagrede();
  const utsp = (o.utsparinger || []).filter(u => u && u.min);
  body.innerHTML =
    '<h4 data-sek="gulv" style="margin:0 0 4px">' + t("Gulv") + '</h4>' +
    felt("swBetong", "Betong (mm)", o.betongMm) +
    felt("swIso", "Isolasjon (mm)", o.isoMm) +
    felt("swUtstikk", "Utstikk forbi søylene (mm)", o.utstikkMm) +
    '<p style="color:var(--muted);font-size:11px;margin:4px 0">' +
      t("Overkant betong settes automatisk til bunnen av søylene.") + '</p>' +
    '<h4 data-sek="ringmur" style="margin:10px 0 4px">' + t("Ringmur") + '</h4>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swRingmur"' +
      (o.ringmur ? " checked" : "") + '> ' + t("Med ringmur rundt stålkonstruksjonen") + '</label>' +
    felt("swRingH", "Høyde over gulv (mm)", o.ringHoydeMm) +
    '<h4 data-sek="vegg" style="margin:10px 0 4px">' + t("Veggelementer") + '</h4>' +
    felt("swTykk", "Tykkelse (mm) — samme som ringmuren", o.tykkelseMm) +
    felt("swKlaring", "Klaring fra søylesenter (mm) — 10 gir 20 mm skjøt", o.klaringMm) +
    '<label>' + t("Radhøyder nedenfra (mm) — tom = automatisk") +
      '<input type="text" id="swRadH" maxlength="200" value="' + esc(o.radHoyder || "") + '"></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Skriv stabelen nedenfra og opp, f.eks. «1100, 1100, 1100, 1100, 1000, 1000». Siste høyde gjentas hvis veggen er høyere. Sum: {0} mm.",
        parseRadHoyder(o.radHoyder).reduce((a, b) => a + b, 0)) + '</p>' +
    '<label style="display:flex;gap:6px;align-items:center" title="' +
      t("Leser taklinja av stålet i fasadeplanet og skråkapper veggen. Slå den på for saltak og pulttak. På et bygg med fagverk i gavlen ligger takstolen i veggplanet, og da skal den stå av.") +
      '"><input type="checkbox" id="swFolgTak"' +
      (o.folgTak ? " checked" : "") + '> ' + t("Veggen følger taket (saltak/pulttak)") + '</label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swKappNed"' +
      (o.kappNederst ? " checked" : "") + '> ' + t("Tilpasningsraden nederst (som Moelv/Lørenskog)") + '</label>' +
    felt("swMinFelt", "Minste felt (mm) — tettere skjøter slås sammen", o.minFeltMm) +
    felt("swKappUnder", "Alt kortere enn (mm) er kapp — 0 = av", o.kappUnderMm) +
    felt("swMinSkra", "Tynneste ende på skråkapp (mm) — 0 = helt inntil taket", o.minSkraMm) +
    '<label>' + t("Navn på kappbiter") +
      '<span class="sw-prefiks"><span>SW-</span>' +
      '<input type="text" id="swKappTekst" maxlength="20" value="' +
      esc(o.kappTekst || "XX") + '"></span></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Skriv bare slutten — «SW-» settes alltid foran. «XX» gir SW-XX (Moelv), «18*» gir SW-18*. Bare «*» gir forelderens nummer med stjerne (Lørenskog).") + '</p>' +
    '<label>' + t("Farge") + '<input type="color" id="swFarge" value="' + esc(o.farge) + '"></label>' +
    felt("swIsoType", "Isolasjon (til lista)", o.isolasjon, "text") +
    felt("swUtvF", "Utvendig farge (til lista)", o.utvFarge, "text") +
    felt("swInnF", "Innvendig farge (til lista)", o.innFarge, "text") +
    fasadePanelHtml(o) +
    '<h4 data-sek="utsp" style="margin:10px 0 4px">' + t("Utsparinger (dører, vinduer, porter)") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Trykk «Marker utsparing», og trykk så på flatene rundt åpningen i modellen: innsiden av søylene på sidene og undersiden av bjelken over. Én flate per side.") + '</p>' +
    '<div class="prop-actions" style="flex-wrap:wrap"><button id="swNyUtsp">' + ikon("boks") + ' ' + t("Marker utsparing") + '</button>' +
    (lagret && (lagret.fasader || []).length
      ? '<button id="swFinnUtsp" title="' + esc(t("Foreslår åpninger under losholter mellom søylene. Ingenting legges inn før du godkjenner.")) + '">' + ikon("sok") + ' ' + t("Finn utsparinger") + '</button>'
      : "") + '</div>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swVisUtsp"' +
      (o.visUtsp === false ? "" : " checked") + '> ' + t("Vis utsparingsmål (stiplet kryss + kappdybde)") + '</label>' +
    (o.visUtsp !== false && utsp.length && !(lagret && (lagret.fasader || []).length)
      ? '<p style="color:var(--muted);font-size:11px;margin:2px 0">' +
        t("Trykk «Generer SW + gulv/ringmur» for å få fram utsparingsmålene — veggene er laget av en eldre versjon.") + '</p>'
      : "") +
    utspListeHtml(utsp, "data-sw-slett-utsp", t("Ingen utsparinger lagt til ennå."), true) +
    innerPanelHtml() +
    '<h4 data-sek="lista" style="margin:10px 0 4px">' + t("Til lista") + '</h4>' +
    felt("swProsjekt", "Prosjekt", o.prosjekt, "text") +
    felt("swOppdrag", "Oppdragsnummer", o.oppdragsnr, "text") +
    felt("swSted", "Sted", o.sted, "text") +
    felt("swSign", "Sign.", o.sign, "text") +
    '<p style="color:var(--muted);font-size:11px;margin:6px 0 2px">' +
      t("Excel-fila får et eget ark «Materiell»: skruer, beslag, hatprofil og skum — én kolonne per fasade og innervegg, og en total. Bare synlige element teller.") + '</p>' +
    felt("swSkumTykk", "Skum: meter per boks, element ≥ 160 mm", o.skumUtbytteTykkM) +
    felt("swSkumTynn", "Skum: meter per boks, element < 160 mm", o.skumUtbytteTynnM) +
    // 📐 Rutene i Storm-tittelfeltet på instruksjonstegninga. Står de tomme,
    // arves de fra Til lista-feltene over — derfor er hjelpeteksten viktigere
    // enn den ser ut: uten den ser tomme felt ut som manglende data.
    '<h4 data-sek="pdf" style="margin:10px 0 4px">' + t("Utfyll PDF") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Dette fyller Storm-tittelfeltet på instruksjonstegninga. Tomt felt hentes fra «Til lista» over; Kontroll og Godkjent står tomme på papiret hvis du ikke fyller dem.") + '</p>' +
    felt("swPdfNr", "Tegningsnummer (nummeret øker per ark)", o.pdfNr || "SW-01", "text") +
    felt("swPdfTittel", "Tegningstittel", o.pdfTittel, "text") +
    felt("swPdfFase", "Prosjektfase", o.pdfFase, "text") +
    felt("swPdfProsjekt", "Prosjektnavn (linje 1)", o.pdfProsjekt, "text") +
    felt("swPdfUnder", "Undertittel (linje 2)", o.pdfUndertittel, "text") +
    felt("swPdfOppdrag", "Oppdragsnummer", o.pdfOppdrag, "text") +
    felt("swPdfTegnet", "Tegnet av", o.pdfTegnet, "text") +
    felt("swPdfKontroll", "Kontrollert av", o.pdfKontroll, "text") +
    felt("swPdfGodkjent", "Godkjent av", o.pdfGodkjent, "text") +
    felt("swPdfDato", "Utsendt dato (tom = i dag)", o.pdfDato, "text") +
    '<label>' + t("Merknad ved fasaden") +
      '<textarea id="swPdfMerknad" rows="2" maxlength="300" placeholder="' +
      esc(t("Veggelementer må kappes og tilpasses til eksisterende fasade. L-Beslag festes til eks. fasade.")) +
      '">' + esc(o.pdfMerknad || "") + '</textarea></label>' +
    '<label>' + t("Logo i tittelfeltet") +
      '<select id="swPdfLogo"><option value="">' + esc(t("Innebygd Storm-logo")) + '</option></select></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      (S.akseLinjer
        ? t("Aksenavnene hentes fra Akser.")
        : t("Aksenavnene blir A, B, C … per fasade. Bygg aksene i Akser først hvis du vil ha byggets egne aksenavn på tegninga.")) + '</p>' +
    '<div class="prop-actions" data-sw-fast style="margin-top:10px;flex-wrap:wrap">' +
    '<button id="swGenerer" class="primary">' + ikon("boks") + ' ' + t("Generer SW + gulv/ringmur") + '</button>' +
    '<button id="swJusterBtn">' + ikon("juster") + ' ' + t("Juster elementer") + '</button>' +
    '<button id="swTegning">' + ikon("tegning") + ' ' + t("Last ned instruksjonstegning (PDF)") + '</button>' +
    '<button id="swListe">' + ikon("lastned") + ' ' + t("Last ned liste (Excel)") + '</button>' +
    '<button id="swFjern">' + ikon("slett") + ' ' + t("Fjern genererte") + '</button></div>' +
    (antall ? '<p style="color:var(--muted);font-size:12px;margin-top:6px">' +
      t("{0} veggelementer generert. Stablene ligger i Materiell og telles i Mengder.", antall) + '</p>' : "") +
    // 💾 Lagrede resultater — helt nederst, som «Lagrede grupper» i Bygginfo.
    '<h4 data-sek="lagrede" style="margin:14px 0 4px">' + t("Lagrede SW-resultater") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Gi resultatet et navn og lagre det. Trykk på navnet senere for å laste hele resultatet inn på bygget igjen.") + '</p>' +
    // Hvor det lagres, sagt rett ut. «Lagret» uten dette er et løfte brukeren
    // ikke kan kontrollere — og forskjellen på «alle ser det» og «bare denne
    // maskinen» er hele poenget med at det ligger i SharePoint.
    '<p style="color:var(--muted);font-size:11px;margin:0 0 6px">' + esc(swLagringsTekst()) + '</p>' +
    '<div class="prop-actions sw-lagre">' +
      '<input type="text" id="swLagreNavn" maxlength="60" placeholder="' +
      esc(t("Navn på resultatet")) + '">' +
      '<button id="swLagreBtn">' + ikon("lagre") + ' ' + t("Lagre") + '</button></div>' +
    (lagrede.length
      ? lagrede.map(pst =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' +
          '<button class="sw-last" data-sw-last="' + esc(pst.navn) + '">' +
          esc(pst.navn) + '</button>' +
          ' <span style="color:var(--muted);font-size:11px">' +
          esc([pst.dato, pst.antall ? t("{0} element", pst.antall) : "", pst.av || ""].filter(Boolean).join(" · ")) +
          '</span></div>' +
        '<div class="c"><button data-sw-slett-lagret="' + esc(pst.navn) + '" title="' + t("Slett") +
        '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")
      : '<p style="color:var(--muted);font-size:12px">' + t("Ingen lagrede resultater ennå.") + '</p>');
  foldSeksjoner(body);
  $("swGenerer").onclick = async () => {
    lesOppsettFraPanel();
    $("swGenerer").disabled = true;
    try { await generer(); }
    catch (err) { console.warn("SW-generator:", err); alert(t("Genereringen feilet: ") + (err && err.message || err)); }
    finally { const b = $("swGenerer"); if (b) b.disabled = false; }
  };
  $("swListe").onclick = () => { lesOppsettFraPanel(); lastNedListe(); };
  if ($("swLagreBtn")) $("swLagreBtn").onclick = () => {
    lesOppsettFraPanel();
    lagreResultat(($("swLagreNavn") || {}).value);
  };
  body.querySelectorAll("button[data-sw-last]").forEach(b =>
    b.onclick = () => lastInnResultat(b.dataset.swLast));
  body.querySelectorAll("button[data-sw-slett-lagret]").forEach(b =>
    b.onclick = () => slettResultat(b.dataset.swSlettLagret));
  if ($("swTegning")) $("swTegning").onclick = lastNedTegning;
  fyllLogovalgSW();
  $("swFjern").onclick = () => { lesOppsettFraPanel(); fjernAltGenerert(); };
  $("swNyUtsp").onclick = () => { lesOppsettFraPanel(); startUtspMark(); };
  if ($("swFinnUtsp")) $("swFinnUtsp").onclick = () => { lesOppsettFraPanel(); startFinnUtsp(); };
  if ($("swVisUtsp")) $("swVisUtsp").onchange = () => { lesOppsettFraPanel(); tegnAlt(); };
  if ($("swJusterBtn")) $("swJusterBtn").onclick = () => { lesOppsettFraPanel(); startJuster(); };
  koblInnerPanel(body);
  body.querySelectorAll("button[data-sw-slett-utsp]").forEach(b =>
    b.onclick = () => {
      lesOppsettFraPanel();
      const o2 = oppsett();
      o2.utsparinger.splice(Number(b.dataset.swSlettUtsp), 1);
      sikreUtspTyper(o2.utsparinger, okBetongNaa());   // numrene rykker opp
      skrivLagret();
      tegnPanel();
      oppdaterInnerveggerEtterUtsp();   // åpningen forsvinner også fra innerveggen
    });
  if ($("swFasadeNy")) $("swFasadeNy").onclick = () => { lesOppsettFraPanel(); startInnerMark(null, true); };
  if ($("swFasadeSlettAlle")) $("swFasadeSlettAlle").onclick = () => { lesOppsettFraPanel(); slettManuellFasade(null); };
  body.querySelectorAll("button[data-sw-fasade-slett]").forEach(b =>
    b.onclick = () => { lesOppsettFraPanel(); slettManuellFasade(Number(b.dataset.swFasadeSlett)); });
  if ($("swFasadeLukk")) $("swFasadeLukk").onchange = () => {
    if (!innerMark || !innerMark.fasade) return;
    innerMark.serie.o.lukk = !!$("swFasadeLukk").checked;
    innerForhandsvis();
  };
  body.querySelectorAll("button[data-sw-type-utsp]").forEach(b =>
    b.onclick = () => {
      lesOppsettFraPanel();
      const o2 = oppsett();
      const u = (o2.utsparinger || [])[Number(b.dataset.swTypeUtsp)];
      if (!u) return;
      u.type = nesteUtspType(u.type);
      sikreUtspTyper(o2.utsparinger, okBetongNaa());
      skrivLagret();
      if (lagret && (lagret.fasader || []).length) { lagret.utspVis = utspPaFasader(); tegnAlt(); }
      tegnPanel();
    });
}

// Logolista hentes fra SharePoint FØRSTE gang panelet tegnes, og huskes så
// lenge fanen står åpen. Feiler hentingen (ikke innlogget, ingen dekning) står
// bare «Innebygd Storm-logo» igjen — tegninga lages likevel.
export let swLogoer = null;

export async function fyllLogovalgSW() {
  if (!$("swPdfLogo")) return;
  if (!swLogoer) {
    try { swLogoer = await hentLogoer(); } catch (_) { swLogoer = []; }
  }
  // Panelet kan ha blitt tegnet på nytt mens vi ventet på SharePoint — hent
  // elementet ETTER ventingen, ellers fylles en <select> som er kastet.
  const v = $("swPdfLogo");
  if (!v) return;
  for (const l of swLogoer) {
    const o = document.createElement("option");
    o.value = l.itemId; o.textContent = ryddLogonavn(l.fil); o.dataset.fil = l.fil;
    v.appendChild(o);
  }
  const husket = (oppsett() || {}).pdfLogo;
  if (husket) {
    const treff = [...v.options].find(o => o.dataset.fil === husket);
    if (treff) v.value = treff.value;
  }
  v.onchange = () => {
    const o = v.selectedOptions[0];
    oppsett().pdfLogo = (o && o.dataset.fil) || "";
    skrivLagret();
  };
}

// ═══════════ 🚪 INNERVEGGER: markering, side, godkjenning, egen serie ═══════════
//
// HELE DEL B LIGGER FOR SEG SELV — egen lagringsnøkkel, egen liste, egen
// tegning. Det er ikke ryddighet for ryddighetens skyld: ytterveggene på de
// fire regresjonsbyggene skal være BIT FOR BIT uendret etter denne runden, og
// den eneste måten å vite det er at innerveggene ikke deler en eneste array
// med dem. Numrene starter derfor på SW-01 igjen av seg selv — de kommer fra
// swNummerering over en annen liste.
//
// Emils flyt (08.09), steg for steg:
//   A  «Ny innervegg» → marker søylene veggen skal stå på
//   B  velg radhøyder, vegghøyde, tykkelse, farge og ringmur
//   C  velg SIDE av søylene — pila i 3D viser hvilken, og forhåndsvisningen
//      står der veggen faktisk kommer
//   D  «Godkjenn»
//   E  egen SW-liste fra SW-01, egen PDF, eget regneark

export const INNER_STD = {
  radHoyder: "", kappNederst: true,
  veggHoydeMm: 3000,            // Emils valg: vegghøyden skrives inn
  tykkelseMm: 100, farge: "#eef2f7",
  ringmur: false, ringHoydeMm: 500,
  klaringMm: SW_KLARING_MM, minFeltMm: SW_MIN_FELT_MM,
  // Endene: 0 = veggen går fra første til siste søylesenter. Se innerveggBiter.
  endeMm: 0,
  // 🔲 Rundt et rom: siste bein går tilbake til første søyle. AV som standard —
  // en L er det vanlige, og en lukket boks skal være et valg, ikke en gjetning.
  lukk: false,
  // Hvor mye retningen må endre seg for at veggen KNEKKER i et hjørne.
  // 25° tar en rettvinklet L uten å dele en rekke som bukter seg litt.
  knekkGrader: 25
};

// PROSJEKTDATAENE BOR ETT STED. Prosjektnavn, oppdragsnummer, sted, sign,
// isolasjon og fargenavnene til lista hentes fra del A-oppsettet — to sett
// felter for samme prosjekt ville drevet fra hverandre første gang noen retta
// bare det ene. Innerveggene overstyrer bare det som FAKTISK er deres eget:
// geometrien, fargen i 3D, og tegningsnummeret.
export function innerOppsettForListe(so) {
  const a = oppsett();
  return { ...a, ...so, betongMm: 0, isoMm: 0,
    pdfNr: (innerData().oppsett.pdfNr || "SWI-01"),
    pdfTittel: a.pdfTittel || t("SW-Elementer innervegg") };
}

export let lagretInner = null;
// Se settLagret i tilstand.js: en importert binding kan leses, ikke tildeles.
export function settLagretInner(v) { lagretInner = v; }
export function innerNokkel() { return "storm-ifc-sw-inner::" + S.fileName; }

export function lesInner() {
  try { return JSON.parse(localStorage.getItem(innerNokkel()) || "null"); }
  catch (_) { return null; }
}

export function skrivInner() {
  try {
    if (lagretInner && (lagretInner.serier || []).length)
      localStorage.setItem(innerNokkel(), JSON.stringify(lagretInner));
    else localStorage.removeItem(innerNokkel());   // siste innervegg slettet
  } catch (_) {}
}

export function innerData() {
  if (!lagretInner) lagretInner = lesInner() || null;
  if (!lagretInner || typeof lagretInner !== "object")
    lagretInner = { oppsett: { ...INNER_STD }, serier: [], vegger: [], ringmur: [], fasader: [] };
  lagretInner.oppsett = { ...INNER_STD, ...(lagretInner.oppsett || {}) };
  for (const n of ["serier", "vegger", "ringmur", "fasader"])
    if (!Array.isArray(lagretInner[n])) lagretInner[n] = [];
  // Skjulingen er en VISNINGStilstand og bor hos innerveggene selv, ikke i
  // del A: slår Emil av ytterveggene, skal innerveggene stå igjen.
  if (!lagretInner.skjul || typeof lagretInner.skjul !== "object") lagretInner.skjul = {};
  if (!Array.isArray(lagretInner.materiellIder)) lagretInner.materiellIder = [];
  for (const s of lagretInner.serier) {
    s.o = { ...INNER_STD, ...(s.o || {}) };
    if (!Array.isArray(s.utsparinger)) s.utsparinger = [];
  }
  if (!Array.isArray(lagretInner.utspVis)) lagretInner.utspVis = [];
  return lagretInner;
}
