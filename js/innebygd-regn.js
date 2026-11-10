// 🖼 INNEBYGD MODUS – de rene reglene (ingen nettleser, ingen nett).
// Fase B i PLAN-3D-modell-Storm-Prosjekter-2026-11-09.md. Prøves i
// _test/test-innebygd.mjs. Selve visningen bor i js/innebygd.js.
//
// Storm Prosjekter viser Storm IFC i et stort vindu (iframe) på Dashbord:
//   index.html?innebygd=1&modell=<IFC-navn>      én modell
//   index.html?innebygd=1&gruppe=<modellgruppe-id> en modellgruppe (flere fag)
//   index.html?innebygd=1&lett=<glb-navn>          akkurat den fila i Lette kopier (B1)

// Den ENESTE siden som får ramme inn Storm IFC i innebygd modus.
export const STORM_PROSJEKTER = "https://wonderful-tree-047b03e03.5.azurestaticapps.net";

// Verktøyene i innebygd modus (Emil 09.11, valg E1 + rettelse): alt i
// Måleverktøy UNNTATT Kote, pluss Snitt, Gjennomsiktig, Grupper, Navigasjon og
// Vis alle. Objektinfo og «Skjul element» kommer når du trykker på et element.
// Knappene er de EKTE knappene, flyttet inn i linja — ingen kopier.
export const INNEBYGD_KNAPPER = ["btnMeasure", "btnKjede", "btnVinkel", "btnAxes",
  "btnClip", "btnGhost", "btnColors", "btnGrupper", "btnHjul", "btnShowAll", "btnSettings"];

// Verktøylinja (Emil 10.11, valg C / C2): to kategorier og tre faste knapper.
// Navnene som i kontoret («Måleverktøy» og «Visning», Emil 31.08) – Mål- og
// Utseende-verktøyene inne i gruppene heter det samme.
// Kategoriene står i topplinja og verktøyene i en rad rett under – på PC som i
// vanlig Storm IFC (Emil 10.11: linja nederst dekket målelinja med «Rett
// strek» og «Tøm mål»), på telefon som ikoner (C2).
// Det som ikke får plass, havner i «Mer» – som i Storm-Byggeplass.
export const INNEBYGD_KATEGORIER = [
  { id: "mal", navn: "Måleverktøy", ikon: "maal", knapper: ["btnMeasure", "btnKjede", "btnVinkel", "btnAxes"] },
  // Utseende (farger, skjul/vis typer) lagt til i Visning (Emil 10.11)
  { id: "vis", navn: "Visning", ikon: "utseende", knapper: ["btnClip", "btnGhost", "btnColors", "btnGrupper"] }
];
export const INNEBYGD_FASTE = ["btnHjul", "btnShowAll", "btnSettings"];
export const TELEFON_BREDDE = 640;

// Hvor mange av elementene får plass? bredder = [px], plass = px, merBredde =
// plassen «Mer» tar. Alt får plass → alle; ellers så mange som får plass
// SAMMEN MED «Mer». (Rekkefølgen beholdes – det siste går i «Mer» først.)
export function antallSomFårPlass(bredder, plass, merBredde, mellomrom = 6) {
  const b = (bredder || []).map(x => Math.max(0, x || 0));
  const sum = (n) => b.slice(0, n).reduce((s, x) => s + x, 0) + Math.max(0, n - 1) * mellomrom;
  if (sum(b.length) <= plass) return b.length;
  let n = b.length;
  while (n > 0 && sum(n) + mellomrom + merBredde > plass) n--;
  return n;
}

// URLSearchParams gjør «+» om til mellomrom, som Storm Prosjekter forventer.
export function lesInnebygd(search) {
  const p = new URLSearchParams(String(search || ""));
  const på = p.get("innebygd") === "1";
  const hent = (k) => på ? (p.get(k) || "").trim() : "";
  return { innebygd: på, modell: hent("modell"), gruppe: hent("gruppe"), lett: hent("lett") };
}

// Får siden vises her? Ikke innrammet (egen fane) → ja: da er det bare Storm
// IFC, og innloggingen avgjør resten. Innrammet → bare av Storm Prosjekter.
// ancestorOrigins finnes i Chrome/Edge/Safari; Firefox har den ikke, og da
// brukes referrer (Storm Prosjekter sender referrerpolicy="origin").
export function rammeOk(o) {
  if (!o || !o.innrammet) return true;
  const forfedre = o.ancestorOrigins ? Array.from(o.ancestorOrigins) : null;
  if (forfedre && forfedre.length) return forfedre[0] === STORM_PROSJEKTER;
  let ref = "";
  try { ref = o.referrer ? new URL(o.referrer).origin : ""; } catch (_) { ref = ""; }
  return ref === STORM_PROSJEKTER;
}

// «Datasenter drangedalen.lett.glb» → «Datasenter drangedalen.ifc». Navnene er
// ikke ensartede i dag («X.lett.glb», «X LETT (1).glb», «X.ekstra_lett (1).glb»).
export function ifcNavnFra(filnavn) {
  const s = String(filnavn || "").trim();
  if (!s || /\.ifc$/i.test(s)) return s;
  const kjerne = s.replace(/\.glb$/i, "").replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[\s._-]*(ekstra[\s._-]*)?lett$/i, "").trim();
  return kjerne + ".ifc";
}

export function modellTittel(navn) { return String(navn || "").replace(/\.(ifc|glb)$/i, "").trim(); }

// ---------------------------------------------------------------------------
// HVILKEN LETT KOPI HØRER TIL EN IFC? (BYGGEPLAN-3D-innebygd-tillegg, B1)
// Storm Prosjekter bruker NØYAKTIG samme regel og viser brukeren hvilken fil
// som blir brukt — de to sidene må derfor være like:
//   - fila hører til «X.ifc» når navnet (små bokstaver) starter med «x»
//     fulgt av «.», mellomrom, «_» eller «-»
//     (X.lett.glb, X.lett (1).glb, X LETT (1).glb, X.ekstra_lett (1).glb)
//   - EKSTRA LETT har «ekstra lett», «ekstra_lett» eller «ekstra-lett» i
//     navnet; flere → den nyeste (lastModifiedDateTime)
//   - LETT er de andre; _index.json sitt «fil» vinner hvis den er blant dem,
//     ellers den nyeste
// ---------------------------------------------------------------------------
export function hørerTil(glbNavn, ifcNavn) {
  const x = String(ifcNavn || "").replace(/\.ifc$/i, "").toLowerCase();
  const n = String(glbNavn || "").toLowerCase();
  if (!x || n.length <= x.length || !n.startsWith(x)) return false;
  return /[. _-]/.test(n.charAt(x.length));
}
export const erEkstraLett = (navn) => /ekstra[ _-]lett/i.test(String(navn || ""));
const nyest = (a, b) => String(b.lastModifiedDateTime || "").localeCompare(String(a.lastModifiedDateTime || ""));

// _index.json: { "<IFC>": "<glb>" | { fil } } eller [ { ifc, fil } ]
function indeksFil(indeks, ifcNavn) {
  const navn = String(ifcNavn || "").toLowerCase();
  if (Array.isArray(indeks)) {
    const p = indeks.find(x => x && String(x.ifc || "").toLowerCase() === navn);
    return p ? String(p.fil || p.lett || "") : "";
  }
  if (indeks && typeof indeks === "object") {
    const k = Object.keys(indeks).find(x => x.toLowerCase() === navn);
    const p = k ? indeks[k] : null;
    return typeof p === "string" ? p : p ? String(p.fil || p.lett || "") : "";
  }
  return "";
}

// Hvilken fil skal åpnes for IFC-navnet? Emil 09.11: ekstra lett → lett → IFC.
// Svar: { fil, art: "ekstra"|"lett"|"ifc" } eller null.
export function velgModellfil(ifcNavn, ifcFiler, lettFiler, indeks) {
  const navn = String(ifcNavn || "").trim();
  if (!navn) return null;
  // Unntak: «X 2.lett.glb» passer også for «X.ifc» etter regelen, men finnes
  // «X 2.ifc», er det den som eier fila (lengste navn vinner, se eierIfc).
  const mine = (lettFiler || []).filter(f => hørerTil(f.name, navn) &&
    !(ifcFiler || []).some(i => i.name.length > navn.length && hørerTil(f.name, i.name)));
  const ekstra = mine.filter(f => erEkstraLett(f.name)).sort(nyest);
  if (ekstra.length) return { fil: ekstra[0], art: "ekstra" };
  const lett = mine.filter(f => !erEkstraLett(f.name)).sort(nyest);
  if (lett.length) {
    const fraIndeks = indeksFil(indeks, navn);
    return { fil: lett.find(f => f.name === fraIndeks) || lett[0], art: "lett" };
  }
  const ifc = (ifcFiler || []).find(f => f.name.toLowerCase() === navn.toLowerCase());
  return ifc ? { fil: ifc, art: "ifc" } : null;
}

// lett=<glb-navn>: hvilken IFC eier fila? Den lengste IFC-en som passer vinner
// («X.ifc» og «X 2.ifc» — «X 2.lett.glb» hører til «X 2.ifc»). null = ingen eier;
// da brukes glb-navnet for gruppene.
export function eierIfc(glbNavn, ifcFiler) {
  const kand = (ifcFiler || []).filter(f => hørerTil(glbNavn, f.name)).sort((a, b) => b.name.length - a.name.length);
  return kand.length ? kand[0].name : null;
}

// Forsidebildet Storm Prosjekter viser på Dashbord:
// IFC-modeller/Forsidebilder/<IFC-navn>.png (med .ifc i navnet). Er det en
// lett kopi uten IFC som eier den, heter bildet <glb-navn>.png (B2).
export const FORSIDE_MAPPE = "Forsidebilder";
export function forsidebildeNavn(filnavn) { const n = ifcNavnFra(filnavn); return n ? n + ".png" : ""; }
export function forsideNavn(filNavn, eierIfc) {
  const n = String(eierIfc || filNavn || "").trim();
  return n ? n + ".png" : "";
}

// B2: skal det tas et nytt forsidebilde? info er svaret fra spFilInfo:
//   «tom» (finnes ikke)          → ja
//   «ok», eldre enn modellfila   → ja
//   «ok», like nytt eller nyere  → nei
//   «av»/«feil» (ingen innlogging eller nettfeil) → nei, prøv neste gang
export function trengerForside(info, modellEndret) {
  if (!info) return false;
  if (info.status === "tom") return true;
  if (info.status !== "ok") return false;
  const bilde = Date.parse(info.endret || ""), modell = Date.parse(modellEndret || "");
  if (!isFinite(bilde)) return true;
  if (!isFinite(modell)) return false;
  return bilde < modell;
}

// ---------------------------------------------------------------------------
// B3: INNLOGGINGSHINT FRA STORM PROSJEKTER
// Storm IFC sier «storm-ifc-klar» (bare til STORM_PROSJEKTER), og Storm
// Prosjekter svarer med e-posten til den som er innlogget. Ingen tokens eller
// nøkler — e-posten brukes bare til å velge kontoen i Microsoft-innloggingen.
// Kortlista i Workeren avgjør fortsatt om du kommer inn.
// ---------------------------------------------------------------------------
export const KLAR_MELDING = "storm-ifc-klar";
export const HINT_MELDING = "storm-prosjekter-hint";
export const STORM_DOMENER = ["stormentreprenor.no", "stormbetong.no", "stormstal.no"];

// Gyldig hint: en enkel e-postadresse, maks 120 tegn, på et Storm-domene.
// Svar: e-posten med små bokstaver, eller "" (ignoreres).
export function gyldigHint(h) {
  if (typeof h !== "string") return "";
  const e = h.trim().toLowerCase();
  if (!e || e.length > 120) return "";
  const m = /^[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(e);
  if (!m || !STORM_DOMENER.includes(m[1])) return "";
  return e;
}

// Godtar bare en melding fra Storm Prosjekter (riktig origin OG vinduet som
// rammer oss inn) med riktig type og et gyldig hint. Svar: e-posten eller "".
export function lesHintMelding(e, forelder) {
  if (!e || e.origin !== STORM_PROSJEKTER) return "";
  if (!forelder || e.source !== forelder) return "";
  const d = e.data;
  if (!d || typeof d !== "object" || d.type !== HINT_MELDING) return "";
  return gyldigHint(d.loginHint);
}

// «ola.nordmann@…» → «Ola Nordmann» (hintet har bare e-posten).
export function navnFraEpost(e) {
  const lokal = String(e || "").split("@")[0] || "";
  return lokal.split(/[._-]+/).filter(Boolean)
    .map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(" ");
}
export function initialer(navn) {
  const d = String(navn || "").trim().split(/\s+/).filter(Boolean);
  if (!d.length) return "?";
  return ((d[0][0] || "") + (d.length > 1 ? d[d.length - 1][0] : "")).toUpperCase();
}

// Microsoft ID-tokenets e-post (bare til visning i «ikke tilgang» — Workeren
// sjekker selve tokenet).
export function tokenEpost(idToken) {
  try {
    const del = String(idToken || "").split(".")[1] || "";
    const json = decodeURIComponent(escape(atob(del.replace(/-/g, "+").replace(/_/g, "/"))));
    const p = JSON.parse(json);
    return String(p.preferred_username || p.email || "").toLowerCase();
  } catch (_) { return ""; }
}
