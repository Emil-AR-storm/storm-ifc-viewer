// 📅 Framdriftsplan — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan: «Storm IFC-Viewer byggeplan Framdriftsplan 2026-10-01.md».
// Emil 01.10: «samme system som støpeplan-verktøyet — lag etapper, marker
// objekter og legg dem til, sett dato for utførelse». Forskjellen fra
// støpeplanen: ALLE objekter kan være med, ikke bare betong — IFC-elementer,
// genererte SW-veggelementer og takplater, rigg-objekter og materiell.
// Valgt 01.10: PDF-oppsett B (etappelinje øverst, tidligere etapper i grått),
// video som trinn 5, og QR-kode til videoen på hver side.
//
// Trinn 1–2 (denne fila nå): etappene, vaskingen og elementene i dem.

// Samme farger som støpeplanen (Emils Pour Sequence-planer) — rødt er med
// vilje IKKE med; rødt er hovedhandlingen.
export const FARGER = ["#2f6fdb", "#7c4dcc", "#f08a24", "#14a3a3", "#c2388a"];
export const MAKS_ETAPPER = 200;
export const MAKS_ELEMENTER = 20000;
export function fargeFor(nr) {
  const n = Math.max(1, Math.round(Number(nr) || 1));
  return FARGER[(n - 1) % FARGER.length];
}

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n);
const hex = (f) => (typeof f === "string" && /^#[0-9a-fA-F]{6}$/.test(f)) ? f.toLowerCase() : "";
const dato = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : "";

// ═══════════════════════ OBJEKTENE ═══════════════════════
//
// Ett objekt i en etappe er en NØKKEL med et slag foran kolon:
//   id:123        IFC-element (ExpressID) — `gid` (GlobalId) følger med, så
//                 elementet kan kjennes igjen når modellen lastes på nytt
//   sw:<id>       generert SW-element eller betong fra SW-generatoren
//   tak:<id>      takplate
//   mat:<id>      materiell-objekt (også stålbunker og fagverk)
//   rigg:<id>     rigg-objekt
// Slaget holder slagene fra hverandre: ExpressID 3 og rigg-objekt «3» kan
// aldri forveksles.
export const SLAG = ["id", "sw", "tak", "mat", "rigg"];
export const SLAG_NAVN = { id: "Elementer", sw: "SW-elementer", tak: "Takplater", mat: "Materiell", rigg: "Rigg" };
export function nokkel(slag, id) {
  if (!SLAG.includes(slag)) return "";
  const s = tekst(id, 60).trim();
  if (!s) return "";
  if (slag === "id") { const n = Number(s); return Number.isFinite(n) && n > 0 ? "id:" + Math.round(n) : ""; }
  return slag + ":" + s;
}
export function slagFor(k) { const i = String(k || "").indexOf(":"); return i > 0 ? k.slice(0, i) : ""; }
export function idFor(k) { const i = String(k || "").indexOf(":"); return i > 0 ? k.slice(i + 1) : ""; }

export function vaskObjekt(x) {
  if (!x || typeof x !== "object") return null;
  const k = String(x.k || "");
  const k2 = nokkel(slagFor(k), idFor(k));
  if (!k2) return null;
  const ut = { k: k2 };
  if (slagFor(k2) === "id" && typeof x.gid === "string" && x.gid) ut.gid = x.gid.slice(0, 40);
  return ut;
}

// ═══════════════════════ ETAPPENE ═══════════════════════
// { id, nr, navn, farge, dato (start), slutt, objekter: [{ k, gid? }], av, endret }
// En slettet etappe blir en gravstein (som støpeplanen), så slettingen også
// når kollegaene gjennom SharePoint-flettingen.
export function vaskEtappe(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) return null;
  const id = e.id.slice(0, 40), endret = tekst(e.endret, 40);
  if (e.slettet === true) return { id, slettet: true, endret };
  const nr = Math.max(1, Math.min(999, Math.round(Number(e.nr) || 1)));
  const sett = new Set();
  const objekter = [];
  for (const x of (Array.isArray(e.objekter) ? e.objekter : []).slice(0, MAKS_ELEMENTER)) {
    const o = vaskObjekt(x);
    if (!o || sett.has(o.k)) continue;
    sett.add(o.k); objekter.push(o);
  }
  const start = dato(e.dato);
  let slutt = dato(e.slutt);
  if (slutt && start && slutt < start) slutt = start;     // slutten kan ikke komme før starten
  return {
    id, nr,
    navn: tekst(e.navn, 80).trim() || ("Etappe " + nr),
    farge: hex(e.farge) || fargeFor(nr),
    dato: start, slutt,
    objekter,
    av: tekst(e.av, 80),
    endret
  };
}
export function vaskEtappeListe(liste) {
  return (Array.isArray(liste) ? liste : []).slice(0, MAKS_ETAPPER * 2).map(vaskEtappe).filter(Boolean);
}
export function synlige(liste) { return vaskEtappeListe(liste).filter(e => !e.slettet); }
export function nesteNr(liste) { return synlige(liste).reduce((m, e) => Math.max(m, e.nr), 0) + 1; }
export function nyEtappe(liste, naa, id) {
  const nr = nesteNr(liste);
  return vaskEtappe({
    id: id || ("F-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)),
    nr, navn: "Etappe " + nr, farge: fargeFor(nr), dato: "", endret: naa || new Date().toISOString()
  });
}
// Rekkefølgen i planen: etter startdato, så nummer. Uten dato sist.
export function sortert(liste) {
  return synlige(liste).sort((a, b) =>
    (a.dato || "9999") < (b.dato || "9999") ? -1 : (a.dato || "9999") > (b.dato || "9999") ? 1 : a.nr - b.nr);
}

// ═══════════════════════ OBJEKTER I EN ETAPPE ═══════════════════════
// Et objekt hører til ÉN etappe: det utføres én gang. Legges det i en ny
// etappe, flyttes det dit, og svaret sier hvor mange som ble flyttet.
export function leggTil(liste, etappeId, nye, naa) {
  const inn = (nye || []).map(vaskObjekt).filter(Boolean);
  const nokler = new Set(inn.map(o => o.k));
  let flyttet = 0;
  const ut = vaskEtappeListe(liste).map(e => {
    if (e.slettet) return e;
    if (e.id === etappeId) {
      const rest = e.objekter.filter(o => !nokler.has(o.k));
      return Object.assign({}, e, { objekter: rest.concat(inn).slice(0, MAKS_ELEMENTER), endret: naa || e.endret });
    }
    const rest = e.objekter.filter(o => !nokler.has(o.k));
    if (rest.length !== e.objekter.length) { flyttet += e.objekter.length - rest.length; return Object.assign({}, e, { objekter: rest, endret: naa || e.endret }); }
    return e;
  });
  return { liste: ut, lagtTil: inn.length, flyttet };
}
// `nokler`: null = alle objektene i etappen
export function fjern(liste, etappeId, nokler, naa) {
  const sett = nokler ? new Set(nokler) : null;
  return vaskEtappeListe(liste).map(e => (e.slettet || e.id !== etappeId) ? e
    : Object.assign({}, e, { objekter: sett ? e.objekter.filter(o => !sett.has(o.k)) : [], endret: naa || e.endret }));
}
// Hvilken etappe et objekt ligger i (eller null).
export function etappeForNokkel(liste, k) {
  for (const e of synlige(liste)) if (e.objekter.some(o => o.k === k)) return e;
  return null;
}
// Antall per slag, i SLAG-rekkefølge: [{ slag, antall }]
export function tellingPerSlag(e) {
  const m = new Map();
  for (const o of (e && e.objekter) || []) { const s = slagFor(o.k); m.set(s, (m.get(s) || 0) + 1); }
  return SLAG.filter(s => m.has(s)).map(s => ({ slag: s, antall: m.get(s) }));
}
