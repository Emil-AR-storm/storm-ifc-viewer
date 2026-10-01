// 🧱 Støpeplan i 3D — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan: «Storm IFC-Viewer byggeplan Stopeplan 3D 2026-09-30.md» (variant C
// valgt av Emil: felt på plata OG elementer i samme plan). Denne fila har det
// som ikke trenger three.js eller DOM: vasking av det som kommer fra SharePoint
// og byggeplass-lenka, nye etapper, fargene, statusen og sorteringen.
//
// TRINN 1 dekker etappene selv (navn, dato, farge, status). Felt, elementer og
// vanntetting kommer i trinn 2, 3 og 6; feltene for dem vaskes allerede her,
// så en fil lagret av en nyere utgave ikke mister dem hos en eldre.

// Fargene fra støpeplanene Emil har laget (Pour Sequence Sone 1B, 23.09):
// Pour 1 blå, 2 lilla, 3 oransje, 4 teal, 5 rosa. Rødt er med vilje IKKE med —
// rødt er hovedhandlingen og HOLD. Etter 5 går rekken rundt igjen; nummeret
// på etappen skiller dem da.
export const FARGER = ["#2f6fdb", "#7c4dcc", "#f08a24", "#14a3a3", "#c2388a"];
export const MAKS_ETAPPER = 200;

export function fargeFor(nr) {
  const n = Math.max(1, Math.round(Number(nr) || 1));
  return FARGER[(n - 1) % FARGER.length];
}

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n);
const hex = (f) => (typeof f === "string" && /^#[0-9a-fA-F]{6}$/.test(f)) ? f.toLowerCase() : "";
const dato = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : "";

// Ett element i en etappe: et IFC-element { id, gid } eller generert betong { sw }.
export function vaskElement(x) {
  if (!x || typeof x !== "object") return null;
  if (typeof x.sw === "string" && x.sw) return { sw: x.sw.slice(0, 40) };
  const id = Number(x.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, gid: typeof x.gid === "string" ? x.gid.slice(0, 40) : "" };
}
// Nøkkelen et element kjennes igjen på. «sw:» og «id:» holder de to slagene
// fra hverandre, så ExpressID 3 og ringmurbit «3» aldri kan forveksles.
export function elementNokkel(x) {
  if (typeof x === "number") return "id:" + x;
  if (typeof x === "string") return /^(sw|id):/.test(x) ? x : "sw:" + x;
  if (!x) return "";
  return x.sw ? "sw:" + x.sw : "id:" + Number(x.id);
}
export const erGenerert = (x) => !!(x && x.sw);

export function vaskEtappe(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) return null;
  const id = e.id.slice(0, 40);
  const endret = tekst(e.endret, 40);
  // 🪦 Gravstein: en slettet etappe beholdes så slettingen synkes (sp-lager.js)
  if (e.slettet === true) return { id, slettet: true, endret };
  const nr = Math.max(1, Math.min(999, Math.round(Number(e.nr) || 1)));
  const ut = {
    id, nr,
    navn: tekst(e.navn, 80).trim() || ("Etappe " + nr),
    farge: hex(e.farge) || fargeFor(nr),
    dato: dato(e.dato),
    status: e.status === "stopt" ? "stopt" : "planlagt",
    notat: tekst(e.notat, 500),
    // Kommer i trinn 2/3/6 — tas vare på allerede nå (se toppen av fila)
    // [{ id: ExpressID, gid: GlobalId }] — gid gjør at planen kan finne
    // elementet igjen i en ny revisjon av modellen (samme grep som Sammenlign)
    // 🧱 Generert betong (betonggulvet og ringmurbitene fra SW-generatoren,
    // Emil 30.09) er ikke i IFC-fila og har ingen ExpressID. De lagres som
    // { sw: "gulv" | "r3" | "ir2" } — SW-generatorens egne id-er.
    elementer: Array.isArray(e.elementer) ? e.elementer.map(vaskElement).filter(Boolean).slice(0, 20000) : [],
    felt: Array.isArray(e.felt) ? e.felt.slice(0, 200) : [],
    vanntetting: Array.isArray(e.vanntetting) ? e.vanntetting.slice(0, 500) : [],
    endret, av: tekst(e.av, 60)
  };
  return ut;
}

export function vaskEtappeListe(liste) {
  return (Array.isArray(liste) ? liste : []).slice(0, MAKS_ETAPPER * 2).map(vaskEtappe).filter(Boolean);
}

export function synlige(liste) {
  return vaskEtappeListe(liste).filter(e => !e.slettet);
}

// Neste nummer er ett høyere enn det høyeste som finnes (også blant de
// slettede? Nei — sletter du etappe 4 av 4, skal neste hete 4 igjen).
export function nesteNr(liste) {
  return synlige(liste).reduce((m, e) => Math.max(m, e.nr), 0) + 1;
}

export function nyEtappe(liste, naa, id) {
  const nr = nesteNr(liste);
  return vaskEtappe({
    id: id || ("E-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)),
    nr, navn: "Etappe " + nr, farge: fargeFor(nr), dato: "", status: "planlagt",
    endret: naa || new Date().toISOString()
  });
}

// Mandag i uka datoen ligger i (ISO-uke), som «ÅÅÅÅ-MM-DD».
export function mandag(iso) {
  const b = String(iso || "").split("-").map(Number);
  if (b.length !== 3 || b.some(n => !Number.isFinite(n))) return "";
  const d = new Date(Date.UTC(b[0], b[1] - 1, b[2]));
  const dag = (d.getUTCDay() + 6) % 7;            // 0 = mandag
  d.setUTCDate(d.getUTCDate() - dag);
  return d.toISOString().slice(0, 10);
}

// Hva etappen står som i dag:
//   "stopt"     — merket som støpt (bare knappen avgjør det, ikke datoen)
//   "forsinket" — datoen er passert, men ikke merket som støpt
//   "uke"       — datoen er i samme uke som i dag
//   "planlagt"  — alt annet, også uten dato
export function statusFor(e, iDag) {
  if (!e) return "planlagt";
  if (e.status === "stopt") return "stopt";
  if (!e.dato) return "planlagt";
  if (e.dato < iDag) return "forsinket";
  if (mandag(e.dato) === mandag(iDag)) return "uke";
  return "planlagt";
}

export const STATUS_TEKST = {
  stopt: "Støpt", uke: "Denne uka", forsinket: "Forsinket", planlagt: "Planlagt"
};

// Rekkefølgen i lista: dato først (uten dato sist), så nummer.
export function sortert(liste) {
  return synlige(liste).sort((a, b) =>
    (a.dato || "9999") < (b.dato || "9999") ? -1 : (a.dato || "9999") > (b.dato || "9999") ? 1 : a.nr - b.nr);
}

// Det byggeplassen skal ha (trinn 5): bare synlige etapper, uten synkfelt.
export function stopeplanForByggeplass(liste) {
  return synlige(liste).map(e => ({
    id: e.id, nr: e.nr, navn: e.navn, farge: e.farge, dato: e.dato, status: e.status,
    elementer: e.elementer, felt: e.felt, vanntetting: e.vanntetting
  }));
}

// ═══════════════ TRINN 2: ELEMENTER I EN ETAPPE ═══════════════
// Et element hører til ÉN etappe — støpes det i etappe 2, er det ikke også i
// etappe 3. Legges det til en ny etappe, flyttes det dit. Svaret sier hvor
// mange som ble flyttet fra andre etapper, så panelet kan si fra.
export const MAKS_ELEMENTER = 20000;
export function leggTilElementer(liste, etappeId, nye, naa) {
  const inn = (nye || []).map(vaskElement).filter(Boolean);
  const nokler = new Set(inn.map(elementNokkel));
  const har = (x) => nokler.has(elementNokkel(x));
  let flyttet = 0;
  const ut = vaskEtappeListe(liste).map(e => {
    if (e.slettet) return e;
    if (e.id === etappeId) {
      const fra = (e.elementer || []).filter(x => !har(x));
      return Object.assign({}, e, { elementer: fra.concat(inn).slice(0, MAKS_ELEMENTER), endret: naa || e.endret });
    }
    const for_ = (e.elementer || []).length;
    const rest = (e.elementer || []).filter(x => !har(x));
    if (rest.length !== for_) { flyttet += for_ - rest.length; return Object.assign({}, e, { elementer: rest, endret: naa || e.endret }); }
    return e;
  });
  return { liste: ut, lagtTil: inn.length, flyttet };
}

// `ider`: null = alle, ellers ExpressID-er (tall) og/eller nøkler («sw:gulv»).
export function fjernElementer(liste, etappeId, ider, naa) {
  const sett = ider ? new Set(ider.map(elementNokkel)) : null;
  return vaskEtappeListe(liste).map(e => (e.slettet || e.id !== etappeId) ? e
    : Object.assign({}, e, { elementer: sett ? e.elementer.filter(x => !sett.has(elementNokkel(x))) : [], endret: naa || e.endret }));
}
