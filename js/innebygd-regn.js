// 🖼 INNEBYGD MODUS – de rene reglene (ingen nettleser, ingen nett).
// Fase B i PLAN-3D-modell-Storm-Prosjekter-2026-11-09.md. Prøves i
// _test/test-innebygd.mjs. Selve visningen bor i js/innebygd.js.
//
// Storm Prosjekter viser Storm IFC i et stort vindu (iframe) på Dashbord:
//   index.html?innebygd=1&modell=<IFC-navn>      én modell
//   index.html?innebygd=1&gruppe=<modellgruppe-id> en modellgruppe (flere fag)

// Den ENESTE siden som får ramme inn Storm IFC i innebygd modus.
export const STORM_PROSJEKTER = "https://wonderful-tree-047b03e03.5.azurestaticapps.net";

// Verktøyene i innebygd modus (Emil 09.11, valg E1 + rettelse): alt i
// Måleverktøy UNNTATT Kote, pluss Snitt, Gjennomsiktig, Grupper, Navigasjon og
// Vis alle. Objektinfo og «Skjul element» kommer når du trykker på et element.
// Knappene er de EKTE knappene, flyttet inn i linja — ingen kopier.
export const INNEBYGD_KNAPPER = ["btnMeasure", "btnKjede", "btnVinkel", "btnAxes",
  "btnClip", "btnGhost", "btnGrupper", "btnHjul", "btnShowAll"];

// URLSearchParams gjør «+» om til mellomrom, som Storm Prosjekter forventer.
export function lesInnebygd(search) {
  const p = new URLSearchParams(String(search || ""));
  const på = p.get("innebygd") === "1";
  return { innebygd: på, modell: på ? (p.get("modell") || "").trim() : "", gruppe: på ? (p.get("gruppe") || "").trim() : "" };
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

const norm = (s) => String(s || "").toLowerCase().replace(/\.(ifc|glb)$/i, "").replace(/\s*\(\d+\)\s*$/, "")
  .replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();

// Hvilken fil skal åpnes for IFC-navnet? Emil 09.11: «ekstra lett» hvis den
// finnes, ellers lett kopi, ellers IFC-en. Svar: { fil, art: "ekstra"|"lett"|"ifc" } eller null.
//   ifcFiler / lettFiler: lister fra SharePoint ({ id, name, size, lastModifiedDateTime })
//   indeks: Lette kopier/_index.json hvis den finnes. Begge former godtas:
//     { "<IFC-navn>": "<glb>" }  eller  { "<IFC-navn>": { lett, ekstra } }
//     eller [ { ifc, lett, ekstra } ]
export function velgModellfil(ifcNavn, ifcFiler, lettFiler, indeks) {
  const navn = String(ifcNavn || "").trim();
  if (!navn) return null;
  const lett = lettFiler || [];
  const finn = (n) => n ? lett.find(f => f.name === n) || null : null;
  // 1) indeksen
  let post = null;
  if (Array.isArray(indeks)) post = indeks.find(x => x && String(x.ifc || "").toLowerCase() === navn.toLowerCase()) || null;
  else if (indeks && typeof indeks === "object") {
    const nøkkel = Object.keys(indeks).find(k => k.toLowerCase() === navn.toLowerCase());
    post = nøkkel ? indeks[nøkkel] : null;
    if (typeof post === "string") post = { lett: post };
  }
  if (post) {
    const e = finn(post.ekstra), l = finn(post.lett);
    if (e) return { fil: e, art: "ekstra" };
    if (l) return { fil: l, art: "lett" };
  }
  // 2) navneregelen
  const base = norm(navn);
  const nyest = (a, b) => String(b.lastModifiedDateTime || "").localeCompare(String(a.lastModifiedDateTime || ""));
  const ekstra = [], vanlig = [];
  for (const f of lett) {
    const n = norm(f.name);
    if (n !== base && !n.startsWith(base + " ")) continue;
    const rest = n.slice(base.length).trim();
    if (/^ekstra ?lett$|^ekstra$/.test(rest)) ekstra.push(f);
    else if (rest === "lett" || rest === "") vanlig.push(f);
  }
  if (ekstra.length) return { fil: ekstra.sort(nyest)[0], art: "ekstra" };
  if (vanlig.length) return { fil: vanlig.sort(nyest)[0], art: "lett" };
  // 3) IFC-en selv
  const ifc = (ifcFiler || []).find(f => f.name.toLowerCase() === navn.toLowerCase());
  return ifc ? { fil: ifc, art: "ifc" } : null;
}

// Forsidebildet Storm Prosjekter viser på Dashbord:
// IFC-modeller/Forsidebilder/<IFC-navn>.png (med .ifc i navnet).
export const FORSIDE_MAPPE = "Forsidebilder";
export function forsidebildeNavn(filnavn) { const n = ifcNavnFra(filnavn); return n ? n + ".png" : ""; }

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
