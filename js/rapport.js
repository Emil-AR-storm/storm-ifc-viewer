// 📄 Statusrapport som PDF.
//
// To utgaver av samme rapport:
//   "full"  – hele kommentartråden. Til arkiv, internbruk og videre analyse.
//   "mote"  – første innlegg + de tre siste. Til utdeling på byggemøte, og
//             MERKET som forkortet, slik at ingen leser den som fullstendig.
//
// FILA ER DELT I TO. Alt over «─── NETTLESER ───» er rein logikk uten DOM,
// uten S og uten jsPDF: byggModell, kuttSvar, tilCsv, filnavn. Da kan
// _test/test-rapport.mjs kjøre den i Node uten å late som den har en nettleser,
// og feil i tallene fanges der de oppstår — ikke først når noen ser en rar PDF.
//
// jsPDF LASTES DYNAMISK, og fra vår egen /vendor/ — ikke fra et CDN. To grunner:
// fila er 365 kB og skal ikke koste noe på vanlig sidelast, og et bibliotek som
// kjører på samme side som Graph-tokenet skal ikke hentes fra en tredjepart vi
// ikke kontrollerer. Se worker.js: /vendor/ har egen cache-regel (ett år,
// immutable) fordi filnavnet bærer versjonen.
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { HASTEGRAD, HASTEGRAD_REKKE, dagerTil, hastegrad, iDagISO } from "./frist.js";

export const JSPDF_URL = "vendor/jspdf-2.5.2.umd.min.js";

// ── SPEILET FRA markers.js ─────────────────────────────────────────────────
// STATUS i js/markers.js:394 har de samme tre fargene. De kan ikke importeres
// hit: markers.js gjør DOM-oppslag på toppnivå, og da kunne ikke denne fila
// kjøres i Node. _test/test-rapport.mjs leser begge filene som tekst og feiler
// hvis verdiene kommer ut av takt.
export const STATUS_FARGE = {
  "Åpen":  "#f59e0b",
  "Pågår": "#3b82f6",
  "Løst":  "#3cb44b"
};
// ── SLUTT SPEILET ──────────────────────────────────────────────────────────

export const UTGAVER = ["full", "mote"];
export const MOTE_SISTE = 3;        // hvor mange siste innlegg møteutgaven viser

// ---------- Små hjelpere ----------

export const svarI = (c) => (c && Array.isArray(c.svar) ? c.svar : []);

// «2026-08-05» → «05.08.2026». Ugyldig inn gir tom streng, ikke «NaN.NaN».
export function norskDato(iso) {
  const d = String(iso || "").split("-");
  return d.length === 3 && d.every(x => /^\d+$/.test(x)) ? d[2] + "." + d[1] + "." + d[0] : "";
}

// Filnavnet i SharePoint blir navnet i logomenyen.
// «Storm-Entreprenør-Logo-Signatur.png» → «Storm Entreprenør»
export function ryddLogonavn(fil) {
  return String(fil || "")
    .replace(/\.(png|jpe?g)$/i, "")
    .replace(/[-_]?(logo|signatur|sign)[-_]?/gi, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hvor kom innlegget fra? Feltet settes fra og med denne runden
// (js/markers.js leggTilSvar, js/byggeplass.js innboks-importen). Eldre svar
// har det ikke, og skal da IKKE få noen merkelapp — en gjetning her ville
// vært verre enn ingenting, siden merkelappen sier noe om hvor mye vi vet.
export function kilde(s) {
  const k = s && s.kilde;
  return k === "bygg" || k === "kontor" ? k : "";
}

// ---------- Møteutgaven kutter synlig ----------
//
// Første innlegg beholdes ALLTID. Det er der problemet beskrives; med bare de
// tre siste ville møtet sett «mangler M20 → bestilt → montert» uten å vite
// hvorfor saken fantes. Der noe er utelatt legges det inn en markørrad med
// antall og periode, så leseren vet at det finnes mer.
export function kuttSvar(svar, utgave) {
  const alle = Array.isArray(svar) ? svar : [];
  if (utgave !== "mote" || alle.length <= MOTE_SISTE + 1) {
    return { vist: alle, utelatt: 0, fra: "", til: "" };
  }
  const siste = alle.slice(-MOTE_SISTE);
  const midten = alle.slice(1, alle.length - MOTE_SISTE);
  return {
    vist: [alle[0]].concat(siste),
    etterForste: true,
    utelatt: midten.length,
    fra: (midten[0] && midten[0].dato) || "",
    til: (midten[midten.length - 1] && midten[midten.length - 1].dato) || ""
  };
}

// ---------- Datamodellen ----------
//
// ALT som skal på papiret regnes ut her, én gang, uten å røre DOM. PDF-tegning
// og CSV leser bare av. Da kan testen sjekke tallene uten å tegne noe.
//
// kilde: { markeringer, modell, prosjekt, revisjon, forrigeRev, forrigeMarkeringer,
//          grenser, iDag, utgave }
export function byggModell(kilde) {
  const k = kilde || {};
  const iDag = k.iDag || iDagISO();
  const grenser = k.grenser || { gul: 8, rod: 3 };
  const utgave = UTGAVER.includes(k.utgave) ? k.utgave : "full";
  const alle = (Array.isArray(k.markeringer) ? k.markeringer : []).filter(Boolean);

  // Hastegrad og status på hver markering
  const beriket = alle.map(c => {
    const h = hastegrad(c, grenser, iDag);
    const d = c.due ? dagerTil(c.due, iDag) : null;
    return {
      c,
      hast: h,
      dager: d,
      status: STATUS_FARGE[c.status] ? c.status : "Åpen",
      lost: c.status === "Løst"
    };
  });

  const tellHast = {};
  HASTEGRAD_REKKE.forEach(h => { tellHast[h] = 0; });
  beriket.forEach(b => { tellHast[b.hast] = (tellHast[b.hast] || 0) + 1; });

  const tellStatus = { "Åpen": 0, "Pågår": 0, "Løst": 0 };
  beriket.forEach(b => { tellStatus[b.status]++; });

  // «Krever handling nå»: forfalt og hastende, verst først. Innen samme
  // hastegrad sorteres på frist — den eldste fristen først.
  const rekke = (h) => HASTEGRAD_REKKE.indexOf(h);
  const krever = beriket
    .filter(b => b.hast === "forfalt" || b.hast === "rod")
    .sort((a, b) => rekke(a.hast) - rekke(b.hast) ||
                    String(a.c.due).localeCompare(String(b.c.due)));

  // Resten av det åpne, gruppert etter hastegrad
  const grupper = ["gul", "gronn", "ukjent"].map(h => ({
    hast: h,
    navn: HASTEGRAD[h].navn,
    rader: beriket.filter(b => b.hast === h)
      .sort((a, b) => String(a.c.due || "9999").localeCompare(String(b.c.due || "9999")))
  })).filter(g => g.rader.length);

  // Saksmapper: alt som ikke er løst, verst først. Løste saker teller med i
  // tallene, men får ikke en egen blokk — rapporten handler om det som gjenstår.
  const saker = beriket
    .filter(b => !b.lost)
    .sort((a, b) => rekke(a.hast) - rekke(b.hast) ||
                    String(a.c.due || "9999").localeCompare(String(b.c.due || "9999")))
    .map(b => Object.assign({}, b, { trad: kuttSvar(svarI(b.c), utgave) }));

  // ALLE markeringene, verst først — også de løste. Brukes av CSV-en.
  // Uten denne falt løste saker ut av datafila: de er hverken i «krever»
  // eller i «grupper» (som bare dekker det åpne), og «saker» filtrerer dem
  // bort med vilje. Testen fanget det.
  const rader = beriket.slice().sort((a, b) =>
    rekke(a.hast) - rekke(b.hast) ||
    String(a.c.due || "9999").localeCompare(String(b.c.due || "9999")));

  return {
    utgave,
    iDag,
    grenser,
    modell: String(k.modell || ""),
    prosjekt: String(k.prosjekt || ""),
    revisjon: k.revisjon == null ? "" : String(k.revisjon),
    forrigeRev: k.forrigeRev == null ? "" : String(k.forrigeRev),
    antall: alle.length,
    tellHast,
    tellStatus,
    utenFrist: tellHast.ukjent || 0,
    rader,
    krever,
    grupper,
    saker,
    endringer: endringerSiden(alle, k.forrigeMarkeringer)
  };
}

// ---------- Endret siden forrige revisjon ----------
//
// Sammenligner markeringene, ikke geometrien. Geometridiffen ligger i
// compare.js og hører hjemme i modellen, ikke i en statusrapport — den
// forskjellen er det verdt å holde tydelig, ellers tror leseren at rapporten
// dekker begge deler.
export function endringerSiden(naa, forrige) {
  if (!Array.isArray(forrige)) return null;
  const før = new Map(forrige.filter(Boolean).map(c => [String(c.id), c]));
  const ut = [];
  for (const c of naa) {
    const g = før.get(String(c.id));
    if (!g) { ut.push({ c, hva: "ny" }); continue; }
    if (c.status === "Løst" && g.status !== "Løst") { ut.push({ c, hva: "lost" }); continue; }
    if (String(c.due || "") !== String(g.due || "")) {
      ut.push({ c, hva: "frist", fra: g.due || "", til: c.due || "" });
    }
  }
  const nåIder = new Set(naa.map(c => String(c.id)));
  for (const g of før.values()) if (!nåIder.has(String(g.id))) ut.push({ c: g, hva: "slettet" });
  return {
    rader: ut,
    ny: ut.filter(x => x.hva === "ny").length,
    lost: ut.filter(x => x.hva === "lost").length,
    frist: ut.filter(x => x.hva === "frist").length,
    slettet: ut.filter(x => x.hva === "slettet").length
  };
}

// ---------- CSV ----------
//
// Samme norske Excel-dialekt som mengde-eksporten i elements.js: semikolon som
// skilletegn og BOM foran, ellers åpner Excel fila som én kolonne med rare
// tegn. Datoene skrives som YYYY-MM-DD (sorterbart), ikke norsk format — dette
// er fila man regner på, ikke fila man ser på.
export const CSV_KOLONNER = ["Nr", "Sak", "Status", "Hastegrad", "Ansvarlig", "Frist",
  "Dager til frist", "Opprettet", "Opprettet av", "Antall svar", "Antall bilder",
  "Antall talemeldinger", "Siste svar", "Siste svar av", "Planner"];

function csvFelt(v) {
  const s = String(v == null ? "" : v);
  return /[";\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
}

export function tilCsv(modell) {
  const linjer = [CSV_KOLONNER.join(";")];
  // modell.rader er ALT, også det løste. Datafila skal være komplett — det er
  // hele grunnen til at den finnes ved siden av PDF-en.
  for (const b of modell.rader) {
    const c = b.c;
    const sv = svarI(c);
    const siste = sv[sv.length - 1];
    linjer.push([
      c.id, c.text, c.status || "Åpen", HASTEGRAD[b.hast].navn, c.owner || "",
      c.due || "", b.dager == null ? "" : b.dager, c.date || "", c.author || "",
      sv.length, (c.bilder || []).length + (c.bilderEtter || []).length,
      (c.lyd || []).length, siste ? siste.tekst : "", siste ? siste.forfatter : "",
      c.taskUrl || ""
    ].map(csvFelt).join(";"));
  }
  return "﻿" + linjer.join("\r\n") + "\r\n";
}

// ---------- Filnavn ----------
// «20653 statusrapport byggemøte 2026-08-12.pdf»
export function filnavn(modell, endelse) {
  const p = modell.prosjekt ? modell.prosjekt + " " : "";
  const hva = endelse === "csv" ? "markeringer"
            : "statusrapport " + (modell.utgave === "mote" ? "byggemøte" : "fullstendig");
  return p + hva + " " + modell.iDag + "." + endelse;
}

// ═══════════════════════ NETTLESER ═══════════════════════
// Alt under dette punktet rører DOM, S eller jsPDF, og kjøres aldri i testen.

const A4 = { b: 210, h: 297, marg: 15 };
const GRÅ = "#6b7280", STREK = "#dcdfe4", ROD = "#a8232b", SORT = "#14161a";

function hex(d, farge, felt) {
  const n = parseInt(String(farge).replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (felt === "fyll") d.setFillColor(r, g, b);
  else if (felt === "strek") d.setDrawColor(r, g, b);
  else d.setTextColor(r, g, b);
}

// Laster jsPDF fra vår egen /vendor/ første gang knappen brukes.
let jsPDFLovnad = null;
export function hentJsPDF() {
  if (!jsPDFLovnad) {
    jsPDFLovnad = import(/* @vite-ignore */ new URL(JSPDF_URL, document.baseURI).href)
      .then(() => {
        const j = window.jspdf && window.jspdf.jsPDF;
        if (!j) throw new Error("jsPDF lastet, men fant ingen jsPDF i window.jspdf");
        return j;
      })
      .catch(err => { jsPDFLovnad = null; throw err; });
  }
  return jsPDFLovnad;
}

// ---------- Papiret ----------
// Liten layouthjelper: holder y-markøren, bryter side når det trengs, og
// tegner topp og bunn likt på hver side. Uten den ville hver seksjon måttet
// regne sidebrytning selv, og den regningen blir feil før eller siden.
function papir(jsPDF, m) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const P = {
    d, y: 0, side: 0, sider: 0, m,
    x: A4.marg, bredde: A4.b - A4.marg * 2,
    bunnGrense: A4.h - A4.marg - 8
  };

  P.plass = (h) => P.y + h <= P.bunnGrense;
  P.sørgFor = (h) => { if (!P.plass(h)) P.nySide(); };

  P.nySide = () => {
    if (P.side > 0) bunnlinje(P);
    d.addPage();
    P.side++;
    topplinje(P, false);
  };

  P.start = () => { P.side = 1; topplinje(P, true); };
  P.slutt = () => {
    bunnlinje(P);
    // Sidetallene må settes til slutt — vi vet ikke hvor mange sider det blir
    // før alt er tegnet. jsPDF lar oss gå tilbake til hver side.
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      d.setFontSize(7.5); hex(d, GRÅ);
      d.text(t("Side {0} av {1}", i, n) + " · " + m.modell + " · " + norskDato(m.iDag),
        A4.b - A4.marg, A4.h - A4.marg + 1, { align: "right" });
    }
  };
  return P;
}

function topplinje(P, forste) {
  const { d, m } = P;
  let y = A4.marg;
  if (P.logo) {
    // Logoen tegnes i sin egen målestokk: 42 mm bred, høyden følger bildet.
    const h = Math.min(16, 42 * (P.logo.h / P.logo.b));
    try { d.addImage(P.logo.data, "PNG", A4.marg, y - 2, 42, h); } catch (_) {}
    y += h + 2;
  } else {
    d.setFontSize(15); hex(d, SORT); d.setFont(undefined, "bold");
    d.text("Storm", A4.marg, y + 5); y += 9;
    d.setFont(undefined, "normal");
  }

  d.setFontSize(forste ? 16 : 13); hex(d, SORT); d.setFont(undefined, "bold");
  d.text(t("Statusrapport markeringer"), A4.marg, y + 5);
  d.setFont(undefined, "normal");
  d.setFontSize(9); hex(d, GRÅ);
  d.text(m.prosjekt ? m.prosjekt : m.modell, A4.marg, y + 10);

  // Metablokk til høyre
  d.setFontSize(7.5);
  const meta = [
    t("Modell") + ": " + m.modell,
    m.revisjon ? t("Revisjon") + ": " + m.revisjon : "",
    t("Rapport") + ": " + norskDato(m.iDag),
    t("Utskrift fra Storm IFC-Viewer")
  ].filter(Boolean);
  meta.forEach((linje, i) => d.text(linje, A4.b - A4.marg, A4.marg + 2 + i * 3.6, { align: "right" }));

  y += 13;
  hex(d, ROD, "strek"); d.setLineWidth(0.8);
  d.line(A4.marg, y, A4.b - A4.marg, y);
  P.y = y + 6;

  // Møteutgaven merkes på HVER side. Ett bånd bare på forsiden ville forsvunnet
  // i det noen skriver ut side 3 og legger den ved en e-post.
  if (m.utgave === "mote") {
    const h = forste ? 11 : 7;
    hex(d, "#fdf3f3", "fyll"); hex(d, "#f0cfcf", "strek"); d.setLineWidth(0.2);
    d.roundedRect(A4.marg, P.y, P.bredde, h, 1.5, 1.5, "FD");
    hex(d, ROD, "fyll"); d.rect(A4.marg, P.y, 1.2, h, "F");
    hex(d, ROD); d.setFontSize(8); d.setFont(undefined, "bold");
    d.text(t("Møteutgave – forkortet."), A4.marg + 4, P.y + 4.6);
    d.setFont(undefined, "normal"); hex(d, SORT);
    if (forste) {
      d.text(t("Kommentartrådene viser første og de tre siste innleggene. Fullstendig rapport ligger i prosjektmappa."),
        A4.marg + 4, P.y + 8.4);
    }
    P.y += h + 5;
  }
}

function bunnlinje(P) {
  const { d, m } = P;
  hex(d, STREK, "strek"); d.setLineWidth(0.2);
  d.line(A4.marg, A4.h - A4.marg - 4, A4.b - A4.marg, A4.h - A4.marg - 4);
  d.setFontSize(7.5); hex(d, GRÅ);
  d.text("Storm Entreprenør AS" + (m.prosjekt ? " · " + m.prosjekt : "") +
    (m.utgave === "mote" ? " · " + t("møteutgave") : ""), A4.marg, A4.h - A4.marg + 1);
}

// ---------- Byggeklosser ----------

function overskrift(P, tekst, tillegg) {
  P.sørgFor(12);
  const { d } = P;
  d.setFontSize(8); hex(d, GRÅ); d.setFont(undefined, "bold");
  d.text(String(tekst).toUpperCase(), P.x, P.y);
  if (tillegg) {
    d.setFont(undefined, "normal");
    d.text(" " + tillegg, P.x + d.getTextWidth(String(tekst).toUpperCase()) + 1.5, P.y);
  }
  d.setFont(undefined, "normal");
  P.y += 4.5;
}

// Rad med tellerruter. Fargen er hastegradens ring / statusens farge — samme
// verdier som i modellen, så tallet på papiret og ringen på skjermen er enige.
function ruter(P, celler) {
  const { d } = P;
  const n = celler.length, mellom = 2.5;
  const b = (P.bredde - mellom * (n - 1)) / n;
  P.sørgFor(17);
  celler.forEach((c, i) => {
    const x = P.x + i * (b + mellom);
    hex(d, "#ffffff", "fyll"); hex(d, STREK, "strek"); d.setLineWidth(0.2);
    d.roundedRect(x, P.y, b, 15, 1.5, 1.5, "FD");
    if (c.farge) { hex(d, c.farge, "fyll"); d.rect(x + 0.6, P.y + 0.3, b - 1.2, 1.4, "F"); }
    hex(d, SORT); d.setFontSize(15); d.setFont(undefined, "bold");
    d.text(String(c.tall), x + 3, P.y + 8.5);
    d.setFont(undefined, "normal"); d.setFontSize(7.5); hex(d, GRÅ);
    d.text(c.tekst, x + 3, P.y + 12.5);
  });
  P.y += 19;
}

// Bryter tekst til en gitt bredde og returnerer linjene.
const bryt = (d, tekst, bredde) => d.splitTextToSize(String(tekst == null ? "" : tekst), bredde);

// ---------- Tabellen ----------
const KOL = { nr: 9, ansv: 32, frist: 20, hast: 26, status: 18 };

function tabellhode(P, fristTittel) {
  const { d } = P;
  d.setFontSize(6.5); hex(d, GRÅ); d.setFont(undefined, "bold");
  let x = P.x;
  const sak = P.bredde - KOL.nr - KOL.ansv - KOL.frist - KOL.hast - KOL.status;
  [["#", KOL.nr], [t("Sak"), sak], [t("Ansvarlig"), KOL.ansv],
   [fristTittel || t("Frist"), KOL.frist], [t("Hastegrad"), KOL.hast], [t("Status"), KOL.status]]
    .forEach(([tit, b]) => { d.text(String(tit).toUpperCase(), x, P.y); x += b; });
  d.setFont(undefined, "normal");
  P.y += 1.6;
  hex(d, STREK, "strek"); d.setLineWidth(0.4);
  d.line(P.x, P.y, P.x + P.bredde, P.y);
  P.y += 3.2;
  return sak;
}

function tabellrad(P, b, sakBredde, visSiste) {
  const { d } = P;
  const c = b.c;
  const sv = svarI(c);
  const siste = visSiste && sv.length ? sv[sv.length - 1] : null;

  const tittel = bryt(d, c.text, sakBredde - 2);
  const under = [
    (c.bilder || []).length + (c.bilderEtter || []).length
      ? t("{0} bilder", (c.bilder || []).length + (c.bilderEtter || []).length) : "",
    (c.lyd || []).length ? t("{0} talemeldinger", (c.lyd || []).length) : "",
    sv.length ? t("{0} svar", sv.length) : "",
    (c.tegninger || []).length ? t("{0} tegninger", (c.tegninger || []).length) : ""
  ].filter(Boolean).join(" · ");
  const sisteLinjer = siste
    ? bryt(d, t("Siste") + ": " + (siste.forfatter || "—") + " – " + siste.tekst, sakBredde - 4)
        .slice(0, 2)
    : [];

  const h = 3 + tittel.length * 3.6 + (under ? 3.2 : 0) + sisteLinjer.length * 3.4 + 2.5;
  P.sørgFor(h + 4);
  const y0 = P.y;

  let x = P.x;
  d.setFontSize(7.5); hex(d, GRÅ);
  d.text(String(c.id).slice(-4), x, P.y + 2.4); x += KOL.nr;

  hex(d, SORT); d.setFontSize(8); d.setFont(undefined, "bold");
  tittel.forEach((l, i) => d.text(l, x, P.y + 2.4 + i * 3.6));
  d.setFont(undefined, "normal");
  let ry = P.y + 2.4 + tittel.length * 3.6;
  if (under) { d.setFontSize(6.8); hex(d, GRÅ); d.text(under, x, ry); ry += 3.2; }
  if (sisteLinjer.length) {
    hex(d, STREK, "strek"); d.setLineWidth(0.5);
    d.line(x, ry - 2.2, x, ry - 2.2 + sisteLinjer.length * 3.4);
    d.setFontSize(7); hex(d, "#4b5563");
    sisteLinjer.forEach((l, i) => d.text(l, x + 2, ry + i * 3.4));
  }
  x += sakBredde;

  d.setFontSize(7.5); hex(d, SORT);
  bryt(d, c.owner || "—", KOL.ansv - 2).slice(0, 2)
    .forEach((l, i) => d.text(l, x, P.y + 2.4 + i * 3.4));
  x += KOL.ansv;

  d.text(norskDato(c.due) || "—", x, P.y + 2.4); x += KOL.frist;

  // Hastegraden som fargelapp med dager — «7 dager over» sier mer i et møte
  // enn en dato folk må regne på selv.
  const ring = HASTEGRAD[b.hast].ring;
  const lapp = hastLapp(b);
  if (lapp) {
    d.setFontSize(6.5);
    const lb = d.getTextWidth(lapp) + 3.4;
    hex(d, ring || STREK, "strek"); d.setLineWidth(0.25);
    hex(d, "#ffffff", "fyll");
    d.roundedRect(x, P.y - 0.6, Math.min(lb, KOL.hast - 1), 4.4, 2.2, 2.2, "FD");
    hex(d, ring || GRÅ);
    d.text(lapp, x + 1.7, P.y + 2.4);
  }
  x += KOL.hast;

  hex(d, STATUS_FARGE[b.status] || GRÅ, "fyll");
  d.circle(x + 1.2, P.y + 1.4, 1.1, "F");
  d.setFontSize(7); hex(d, SORT);
  d.text(t(b.status), x + 3.2, P.y + 2.4);

  P.y = y0 + h;
  hex(d, "#eceef1", "strek"); d.setLineWidth(0.2);
  d.line(P.x, P.y - 1.5, P.x + P.bredde, P.y - 1.5);
}

function hastLapp(b) {
  if (b.hast === "ingen") return "";
  if (b.hast === "ukjent") return t("ingen frist");
  const d = b.dager;
  if (d == null) return HASTEGRAD[b.hast].navn;
  if (d < 0) return t("{0} dager over", -d);
  if (d === 0) return t("i dag");
  if (d === 1) return t("i morgen");
  return t("om {0} dager", d);
}

// ---------- Saksmappe ----------
function saksmappe(P, b) {
  const { d } = P;
  const c = b.c;
  const ring = HASTEGRAD[b.hast].ring || STREK;
  const innB = P.bredde - 8;

  const tittel = bryt(d, "#" + String(c.id).slice(-4) + " " + c.text, innB - 30);
  const meta = [c.owner ? t("ansvarlig") + " " + c.owner : "",
                c.due ? t("frist") + " " + norskDato(c.due) : "",
                c.date ? t("opprettet") + " " + c.date + (c.author ? " " + t("av") + " " + c.author : "") : ""]
    .filter(Boolean).join(" · ");
  const metaL = bryt(d, meta, innB - 4);

  const trad = b.trad.vist;
  // Grovmål på høyden, så mappa ikke brytes midt i overskriften.
  const anslag = 6 + tittel.length * 4.4 + metaL.length * 3.2 + 6 +
    (b.trad.utelatt ? 6 : 0) + trad.length * 9 + 4;
  P.sørgFor(Math.min(anslag, 90));

  const y0 = P.y;
  P.y += 4;

  d.setFontSize(9.5); hex(d, SORT); d.setFont(undefined, "bold");
  tittel.forEach((l, i) => d.text(l, P.x + 5, P.y + i * 4.4));
  d.setFont(undefined, "normal");
  P.y += tittel.length * 4.4;

  const lapp = hastLapp(b);
  if (lapp) {
    d.setFontSize(6.5); hex(d, ring);
    d.text(lapp, P.x + P.bredde - 4, y0 + 7.2, { align: "right" });
  }

  d.setFontSize(7); hex(d, GRÅ);
  metaL.forEach((l, i) => d.text(l, P.x + 5, P.y + i * 3.2));
  P.y += metaL.length * 3.2 + 2;

  // Bilder og talemeldinger nevnes, aldri lastes ned — en rapport skal kunne
  // lages uten å hente 40 MB bilder fra SharePoint først.
  const vedlegg = [];
  const før = (c.bilder || []).length, etter = (c.bilderEtter || []).length;
  if (før) vedlegg.push(t("{0} bilder før", før));
  if (etter) vedlegg.push(t("{0} bilder etter", etter));
  (c.lyd || []).forEach(l => vedlegg.push(
    "🎤 " + t("talemelding") + (l.av ? " · " + l.av : "") + (l.dato ? " · " + l.dato : "")));
  (c.tegninger || []).forEach(tg => vedlegg.push(
    t("tegning") + " " + tg.fil + (tg.side ? " s. " + tg.side : "")));
  if (vedlegg.length) {
    d.setFontSize(7); hex(d, "#4b5563");
    bryt(d, vedlegg.join("  ·  "), P.bredde - 10).forEach((l, i) => {
      P.sørgFor(5); d.text(l, P.x + 5, P.y + i * 3.2);
    });
    P.y += bryt(d, vedlegg.join("  ·  "), P.bredde - 10).length * 3.2 + 1;
  }

  // Kommentartråden
  if (trad.length) {
    hex(d, STREK, "strek"); d.setLineWidth(0.2);
    d.line(P.x + 5, P.y, P.x + P.bredde - 5, P.y);
    P.y += 3.5;
    d.setFontSize(6.5); hex(d, GRÅ);
    d.text((b.trad.utelatt
      ? t("Kommentartråd – {0} av {1} innlegg", trad.length, trad.length + b.trad.utelatt)
      : t("Kommentartråd – {0} innlegg", trad.length)).toUpperCase(), P.x + 5, P.y);
    P.y += 4;

    trad.forEach((s, i) => {
      if (b.trad.etterForste && i === 1 && b.trad.utelatt) {
        P.sørgFor(7);
        d.setFontSize(6.8); hex(d, GRÅ);
        hex(d, "#f7f8f9", "fyll"); hex(d, "#ccd2d8", "strek");
        d.setLineDashPattern([0.8, 0.8], 0);
        d.roundedRect(P.x + 10, P.y - 2.6, P.bredde - 20, 5, 1, 1, "FD");
        d.setLineDashPattern([], 0);
        d.text(t("{0} tidligere innlegg utelatt ({1} – {2}). Se fullstendig rapport.",
          b.trad.utelatt, b.trad.fra || "?", b.trad.til || "?"), P.x + 12, P.y + 0.8);
        P.y += 6.5;
      }
      innlegg(P, s);
    });
  }

  // Rammen tegnes til slutt: nå vet vi hvor høy mappa faktisk ble.
  const h = P.y - y0 + 1;
  hex(d, STREK, "strek"); d.setLineWidth(0.2);
  d.roundedRect(P.x, y0, P.bredde, h, 1.5, 1.5, "D");
  hex(d, ring, "fyll"); d.rect(P.x, y0, 1.4, h, "F");
  P.y = y0 + h + 4;
}

function innlegg(P, s) {
  const { d } = P;
  const linjer = bryt(d, s.tekst || "", P.bredde - 22);
  P.sørgFor(linjer.length * 3.4 + 6);
  const k = kilde(s);

  // Kule: rød ring = fra byggeplassen
  hex(d, "#ffffff", "fyll");
  hex(d, k === "bygg" ? ROD : GRÅ, "strek"); d.setLineWidth(0.5);
  d.circle(P.x + 7, P.y + 0.6, 1.2, "FD");

  d.setFontSize(7.2); hex(d, SORT); d.setFont(undefined, "bold");
  const navn = s.forfatter || t("Ukjent");
  d.text(navn, P.x + 11, P.y + 1.4);
  let bx = P.x + 11 + d.getTextWidth(navn) + 2;
  d.setFont(undefined, "normal");

  if (k) {
    const merke = k === "bygg" ? t("BYGGEPLASS") : t("KONTOR");
    d.setFontSize(5.5);
    const mb = d.getTextWidth(merke) + 2.4;
    hex(d, k === "bygg" ? "#fdeceb" : "#eef2f7", "fyll");
    hex(d, k === "bygg" ? "#f0c8c5" : "#d5dde6", "strek"); d.setLineWidth(0.15);
    d.roundedRect(bx, P.y - 1.4, mb, 3.2, 0.7, 0.7, "FD");
    hex(d, k === "bygg" ? ROD : "#44546a");
    d.text(merke, bx + 1.2, P.y + 1);
    bx += mb + 2;
  }
  d.setFontSize(6.5); hex(d, GRÅ);
  d.text(s.dato || "", bx, P.y + 1.4);

  d.setFontSize(7.5); hex(d, SORT);
  linjer.forEach((l, i) => d.text(l, P.x + 11, P.y + 5 + i * 3.4));
  P.y += 5 + linjer.length * 3.4 + 1.5;
}

// ---------- Selve rapporten ----------
export async function tegn(jsPDF, m, bilde, logo) {
  const P = papir(jsPDF, m);
  P.logo = logo;
  P.start();
  const { d } = P;

  // 1) Bildet av modellen
  if (bilde) {
    overskrift(P, t("Modellen"), t("– slik den sto da rapporten ble laget"));
    const h = Math.min(62, P.bredde * (bilde.h / bilde.b));
    P.sørgFor(h + 6);
    try { d.addImage(bilde.data, "PNG", P.x, P.y, P.bredde, h); } catch (_) {}
    hex(d, STREK, "strek"); d.setLineWidth(0.2);
    d.roundedRect(P.x, P.y, P.bredde, h, 1.5, 1.5, "D");
    P.y += h + 5;
  }

  // 2) Tallene
  overskrift(P, t("Etter frist"));
  ruter(P, HASTEGRAD_REKKE.filter(h => h !== "ingen").map(h => ({
    tall: m.tellHast[h] || 0, tekst: t(HASTEGRAD[h].navn), farge: HASTEGRAD[h].ring
  })).concat([{ tall: m.tellStatus["Løst"], tekst: t("Løst"), farge: STATUS_FARGE["Løst"] }]));

  overskrift(P, t("Etter status"));
  ruter(P, ["Åpen", "Pågår", "Løst"].map(s => ({
    tall: m.tellStatus[s], tekst: t(s), farge: STATUS_FARGE[s]
  })));

  // 3) Endret siden forrige revisjon
  if (m.endringer && m.endringer.rader.length) {
    overskrift(P, t("Endret siden revisjon {0}", m.forrigeRev || "?"));
    ruter(P, [
      { tall: "+" + m.endringer.ny, tekst: t("Nye markeringer"), farge: "#22c55e" },
      { tall: m.endringer.lost, tekst: t("Løst siden sist"), farge: STATUS_FARGE["Løst"] },
      { tall: m.endringer.frist, tekst: t("Fikk ny frist"), farge: "#e9a13b" }
    ]);
  }

  // 4) Krever handling nå
  overskrift(P, t("Krever handling nå"), t("– forfalt og hastende, verst først"));
  if (!m.krever.length) {
    d.setFontSize(8); hex(d, GRÅ);
    d.text(t("Ingenting er forfalt eller haster."), P.x, P.y); P.y += 6;
  } else {
    const sb = tabellhode(P);
    m.krever.forEach(b => tabellrad(P, b, sb, true));
    P.y += 3;
  }

  // Markeringer uten frist er verdt en egen advarsel: de faller ut av både
  // morgenvarselet og prioriteringslista, og forsvinner derfor stille.
  if (m.utenFrist) {
    P.sørgFor(12);
    hex(d, "#fff8f8", "fyll"); hex(d, "#f0d3d3", "strek"); d.setLineWidth(0.2);
    d.roundedRect(P.x, P.y, P.bredde, 9, 1.5, 1.5, "FD");
    hex(d, ROD, "fyll"); d.rect(P.x, P.y, 1.2, 9, "F");
    d.setFontSize(7.5); hex(d, ROD); d.setFont(undefined, "bold");
    d.text(t("{0} markeringer mangler frist.", m.utenFrist), P.x + 4, P.y + 3.8);
    d.setFont(undefined, "normal"); hex(d, SORT);
    d.text(t("De kommer ikke med i morgenvarselet og havner ikke i prioriteringslista."),
      P.x + 4, P.y + 7.2);
    P.y += 13;
  }

  // 5) Øvrige åpne, gruppert
  for (const g of m.grupper) {
    overskrift(P, t(g.navn), t("– {0} markeringer", g.rader.length));
    const sb = tabellhode(P, g.hast === "ukjent" ? t("Opprettet") : t("Frist"));
    g.rader.forEach(b => tabellrad(P, b, sb, false));
    P.y += 3;
  }

  // 6) Saksmappene
  if (m.saker.length) {
    P.nySide();
    overskrift(P, t("Saksmapper"), t("– vedlegg og hele kommentartråden, én blokk per sak"));
    m.saker.forEach(b => saksmappe(P, b));
  }

  P.slutt();
  return d;
}

// ---------- Nedlasting ----------

function lastNedFil(blob, navn) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = navn;
  document.body.appendChild(a); a.click(); a.remove();
  // Nettleseren trenger noen sekunder på å faktisk lagre fila. Frigjør vi
  // adressen med en gang, kan nedlastingen bli tom på trege maskiner.
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

// Hovedinngangen. Kalles fra menyen i ui.js.
//
// Rekkefølgen er valgt med vilje: bildet fanges FØRST, mens brukeren fortsatt
// ser modellen slik han forlot den. Henter vi logoen fra SharePoint først, kan
// nettverket bruke to sekunder, og i mellomtiden kan noe ha endret visningen.
export async function lastNedRapport(opts) {
  const o = opts || {};
  const utgave = UTGAVER.includes(o.utgave) ? o.utgave : "full";
  // Samme framdriftsvisning som opplastingen i byggeplass.js. IKKE statusEl:
  // den linja viser antall elementer i modellen, og skal ikke overskrives av
  // noe forbigående — da står det «Rapporten er lastet ned» der for alltid.
  const vis = (tekst) => { if (loadingText) loadingText.textContent = tekst; };
  if (loadingEl) loadingEl.classList.add("open");
  try {
    vis(t("Lager rapport …"));

    const bilde = typeof o.fangstBilde === "function" ? await o.fangstBilde() : null;
    const logo = typeof o.hentLogo === "function" ? await o.hentLogo() : null;

    const m = byggModell({
      markeringer: o.markeringer || (S && S.comments) || [],
      modell: o.modell || (S && S.fileName) || "",
      prosjekt: o.prosjekt || "",
      revisjon: o.revisjon, forrigeRev: o.forrigeRev,
      forrigeMarkeringer: o.forrigeMarkeringer,
      grenser: o.grenser, iDag: o.iDag, utgave
    });

    vis(t("Henter PDF-biblioteket …"));
    const jsPDF = await hentJsPDF();
    vis(t("Tegner {0} sider …", m.saker.length + 2));
    const d = await tegn(jsPDF, m, bilde, logo);
    lastNedFil(d.output("blob"), filnavn(m, "pdf"));

    if (o.medCsv) {
      lastNedFil(new Blob([tilCsv(m)], { type: "text/csv;charset=utf-8" }), filnavn(m, "csv"));
    }
    return m;
  } catch (err) {
    console.warn("Rapporten feilet:", err);
    alert(t("Klarte ikke å lage rapporten: {0}", err.message));
    return null;
  } finally {
    if (loadingEl) loadingEl.classList.remove("open");
  }
}
