// 🏕 Rigg — den rene regningen. Ingen DOM, ingen three.js, ingen nettkall.
//
// Rigg er det man setter opp på byggeplassen før første søyle reises:
// brakker, toalett, container, strømskap, møteplass osv. Verktøyet legger
// enkle modeller av dem på tomta, så riggplanen kan vises og lastes ned.
//
// Grunnlag: «Storm IFC-Viewer handoff Rigg 2026-09-25.md» og Emils bestilling
// i Rigg/rigg verktøy 25.09.2026.txt. Denne fila dekker trinn 1–2: de enkle
// objektene. Byggegjerdet, pilene og PDF-en kommer i egne runder.
//
// Alt her testes i Node (_test/test-rigg.mjs).

// ═══════════════════════ OBJEKTMALENE ═══════════════════════
//
// Alle mål i METER (L = lengde langs objektets egen x, B = bredde, H = høyde).
// Målene er forslag fra handoffen — Emil valgte å starte med dem 25.09.2026.
// De kan endres per objekt i skjemaet, så et feil forslag er ikke farlig.
// Kilde: ISO 668 for 20 fots container (6,058 × 2,438 × 2,591 m). De andre
// er typiske mål, ikke sjekket mot Storms leverandør {Source not found}.
//
// Fargene er objektets egen farge i 3D (og i tegnforklaringen på riggplanen
// senere). De er IKKE UI-farger, derfor ikke CSS-variabler.
export const RIGG_TYPER = {
  brakke: {
    label: "Brakkerigg", L: 6.0, B: 2.4, H: 2.6, farge: "#dfe3e8",
    // En brakkerigg er moduler: side om side (moduler) og oppå hverandre
    // (etasjer, 1–3). Antallet er det man bestiller, så det telles i Mengder.
    moduler: true
  },
  hjulbrakke: { label: "Hjulbrakke", L: 5.0, B: 2.3, H: 2.6, farge: "#e8e2cf" },
  toalett:    { label: "Toalett", L: 1.1, B: 1.2, H: 2.3, farge: "#2f6fb3" },
  forstehjelp:{ label: "Førstehjelp", L: 0.7, B: 0.3, H: 2.2, farge: "#1e8e3e" },
  mote:       { label: "Møteområde", L: 3.0, B: 3.0, H: 2.5, farge: "#1f5fbf" },
  strom:      { label: "Strømskap", L: 0.6, B: 0.4, H: 1.4, farge: "#e67e22" },
  container:  { label: "Container 20 fot", L: 6.06, B: 2.44, H: 2.59, farge: "#2e6b4f" },
  hms:        { label: "HMS-kort-registrering", L: 0.8, B: 0.6, H: 1.5, farge: "#455a64" },
  soppel:     { label: "Søppelcontainer", L: 3.5, B: 1.9, H: 1.5, farge: "#2c5f8a" }
};

// Rekkefølgen knappene står i panelet — det man rigger først, først.
export const RIGG_REKKEFOLGE = ["brakke", "hjulbrakke", "toalett", "forstehjelp", "mote",
  "strom", "container", "hms", "soppel"];

// Kort forklaring per type. Står i panelet nå, og blir teksten i
// tegnforklaringen på riggplan-PDF-en (trinn 6).
export const RIGG_FORKLARING = {
  brakke: "Spisebrakke, garderobe og kontor",
  hjulbrakke: "Flyttbar brakke på hjul",
  toalett: "Toalett for arbeiderne",
  forstehjelp: "Førstehjelpsutstyr og båre",
  mote: "Møteplass ved alarm og for morgenmøte",
  strom: "Byggestrøm — tilkobling for verktøy og brakker",
  container: "Lager for verktøy og materiell",
  hms: "Registrering av HMS-kort ved inngangen",
  soppel: "Avfall og kildesortering"
};

export const MAKS_ETASJER = 3;
export const MAKS_MODULER = 12;
export const ROT_STEG = 15;        // grader per trykk på roter-knappene

// ═══════════════════════ VASKING ═══════════════════════
//
// Riggen kommer fra localStorage, fra SharePoint (<modell>.rigg.json) og fra
// Workerens JSON på byggeplassen. En fil kan inneholde hva som helst — ukjente
// felt slipper ALDRI inn, og et tall som ikke er et tall blir standardverdien
// (en NaN i posisjonen ville sendt objektet ut av synsfeltet uten et eneste
// feilsymptom).

const tall = (v) => (typeof v === "number" && Number.isFinite(v)) ? v
  : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) ? Number(v) : null;
const tekst = (v, n) => String(v == null ? "" : v).slice(0, n || 80).trim();

// 0 og tomt felt betyr «ikke satt» — da gjelder standardverdien, ikke
// minstemålet (samme regel som materiell-vis.js).
function mal(v, min, maks, std) {
  const n = tall(v);
  if (n == null || n <= 0) return std;
  return Math.round(Math.max(min, Math.min(maks, n)) * 1000) / 1000;
}

function heltall(v, min, maks, std) {
  const n = tall(v);
  if (n == null) return std;
  return Math.max(min, Math.min(maks, Math.round(n)));
}

export function vaskFarge(v, std) {
  const s = String(v || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : (std || "#8fa3b8");
}

// Grader til [0, 360) med én desimal — rotasjonen MED KLOKKA sett ovenfra,
// som et kompass (samme retning som byggets rotasjon i terrenget).
export function normVinkel(g) {
  const v = ((Number(g) || 0) % 360 + 360) % 360;
  return Math.round(v * 10) / 10 % 360;
}

// Posisjonen kan ligge i UTM33 (seks-sifrede tall) — grensen er vid med vilje,
// men ikke uendelig: noe utenfor Norge er en feil, ikke en tomt.
const MAKS_KOORD = 1e7;

export function vaskRiggObjekt(p) {
  if (!p || typeof p !== "object") return null;
  const M = RIGG_TYPER[p.type];
  if (!M) return null;
  const id = tekst(p.id, 40);
  if (!id || id === REF_ID) return null;
  const E = tall(p.E), N = tall(p.N);
  if (E == null || N == null || Math.abs(E) > MAKS_KOORD || Math.abs(N) > MAKS_KOORD) return null;
  const ut = {
    id, type: p.type,
    navn: tekst(p.navn, 80),
    farge: vaskFarge(p.farge, M.farge),
    L: mal(p.L, 0.1, 30, M.L),
    B: mal(p.B, 0.1, 30, M.B),
    H: mal(p.H, 0.1, 15, M.H),
    // "utm" = E/N er UTM33 i meter (riggen hører til TOMTA, Emil 25.09).
    // "bygg" = lagt inn før noe terreng fantes: E/N er byggrammen (E = x,
    // N = −z, meter fra modellens senter). Gjøres om til utm første gang
    // modellen står i et terreng (tilUtm).
    ramme: p.ramme === "bygg" ? "bygg" : "utm",
    E, N,
    rot: normVinkel(p.rot),
    skjult: p.skjult === true,
    av: tekst(p.av, 60),
    endret: tekst(p.endret, 40)
  };
  if (M.moduler) {
    ut.etasjer = heltall(p.etasjer, 1, MAKS_ETASJER, 1);
    ut.moduler = heltall(p.moduler, 1, MAKS_MODULER, 1);
  }
  return ut;
}

// ═══════════════════════ REFERANSEN ═══════════════════════
//
// Riggen står i UTM33. For å tegne den trengs terrengets plassering: hvor
// bygget står på tomta (E0, N0 og plass = { pE, pN, rot }, se «PLASSERING» i
// terreng-regn.js). Med terrenget lastet er den levende. Uten terreng — og på
// byggeplass-siden, som aldri laster terrenget — brukes siste kjente
// plassering, lagret som en egen post i samme liste. Da står riggen likt rundt
// bygget selv om terrenget ikke vises.
export const REF_ID = "_ref";

export function vaskRef(p) {
  if (!p || typeof p !== "object") return null;
  const E0 = tall(p.E0), N0 = tall(p.N0);
  if (E0 == null || N0 == null || Math.abs(E0) > MAKS_KOORD || Math.abs(N0) > MAKS_KOORD) return null;
  const pl = p.plass || {};
  const pE = tall(pl.pE) || 0, pN = tall(pl.pN) || 0;
  if (Math.abs(pE) > 5000 || Math.abs(pN) > 5000) return null;
  return { E0, N0, plass: { pE, pN, rot: normVinkel(tall(pl.rot) || 0) } };
}

export function likRef(a, b) {
  if (!a || !b) return !a && !b;
  const n = (x, y) => Math.abs(x - y) < 1e-6;
  return n(a.E0, b.E0) && n(a.N0, b.N0) && n(a.plass.pE, b.plass.pE) &&
    n(a.plass.pN, b.plass.pN) && n(a.plass.rot, b.plass.rot);
}

// Én post i lista: et objekt, en gravstein (slettet) eller referansen.
export function vaskRiggPost(p) {
  if (!p || typeof p !== "object") return null;
  if (p.id === REF_ID) {
    const r = vaskRef(p);
    return r ? Object.assign({ id: REF_ID }, r, { endret: tekst(p.endret, 40) }) : null;
  }
  if (p.slettet === true) {
    const id = tekst(p.id, 40);
    return id ? { id, slettet: true, endret: tekst(p.endret, 40) } : null;
  }
  return vaskRiggObjekt(p);
}

export function vaskRiggListe(liste) {
  return (Array.isArray(liste) ? liste : []).map(vaskRiggPost).filter(Boolean);
}

// Objektene som skal tegnes og telles: ikke gravsteiner, ikke referansen.
export function riggObjekter(liste) {
  return (liste || []).filter(p => p && p.id !== REF_ID && !p.slettet && RIGG_TYPER[p.type]);
}

export function riggRef(liste) {
  const r = (liste || []).find(p => p && p.id === REF_ID);
  return r ? vaskRef(r) : null;
}

// ═══════════════════════ RAMMENE ═══════════════════════
//
// Samme formler som terrengTilBygg/byggTilTerreng i terreng-regn.js — kopiert
// hit med vilje: byggeplass-siden (lett-main.js) skal kunne vise riggen uten å
// laste terrengkoden, og test-terreng vokter at den aldri gjør det.
// test-rigg sjekker at de to utgavene regner likt.
//
// Byggrammen: meter fra modellens senter, x langs scenens X, z langs scenens Z
// (z peker mot sør når rot = 0).

function tilBygg(E, N, ref) {
  const t = (ref.plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = E - ref.E0 - (ref.plass.pE || 0), lz = -(N - ref.N0 - (ref.plass.pN || 0));
  return { bx: lx * c + lz * s, bz: -lx * s + lz * c };
}

function fraBygg(bx, bz, ref) {
  const t = (ref.plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = bx * c - bz * s, lz = bx * s + bz * c;
  return { E: ref.E0 + (ref.plass.pE || 0) + lx, N: ref.N0 + (ref.plass.pN || 0) - lz };
}

// Hvor objektet står i byggrammen, og hvordan det er dreid i scenen.
//   bx, bz — meter fra modellens senter
//   rotY   — radianer rundt scenens Y (three.js: positiv = mot klokka ovenfra)
// null når objektet står i UTM og det ikke finnes noen referanse å regne med.
//
// Rotasjonen: objektets rot er med klokka i sin egen ramme. Terrenget er dreid
// +plass.rot (landGroup i terreng.js), så i scenen blir det (plass.rot − rot).
export function riggTilBygg(o, ref) {
  if (!o) return null;
  if (o.ramme === "bygg") return { bx: o.E, bz: -o.N, rotY: -(o.rot || 0) * Math.PI / 180 };
  if (!ref) return null;
  const b = tilBygg(o.E, o.N, ref);
  return { bx: b.bx, bz: b.bz, rotY: ((ref.plass.rot || 0) - (o.rot || 0)) * Math.PI / 180 };
}

// Fotavtrykket: de fire hjørnene som { E, N } i objektets egen ramme.
// Lengden ligger langs objektets x, som peker ØST ved rot = 0. Dreid r grader
// med klokka blir x-retningen (cos r, −sin r) og bredderetningen
// (−sin r, −cos r) i (E, N) — test-rigg sjekker at det stemmer med
// rotasjonen i scenen. Brakkeriggen er så bred som alle modulene til sammen.
export function riggFotavtrykk(o) {
  if (!o) return [];
  const r = (o.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const bredde = RIGG_TYPER[o.type] && RIGG_TYPER[o.type].moduler ? o.B * (o.moduler || 1) : o.B;
  const hl = o.L / 2, hb = bredde / 2;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => ({
    E: o.E + a * hl * c + b * hb * -s,
    N: o.N + a * hl * -s + b * hb * -c
  }));
}

// Et punkt i byggrammen → posisjonsfeltene til et objekt. Med referanse havner
// det i UTM (tomta), uten i byggrammen.
export function byggTilRigg(bx, bz, ref) {
  if (!ref) return { ramme: "bygg", E: rund(bx), N: rund(-bz) };
  const p = fraBygg(bx, bz, ref);
  return { ramme: "utm", E: rund(p.E), N: rund(p.N) };
}

// Et objekt som ble lagt inn i byggrammen, flyttet over på tomta — samme sted
// og samme retning i scenen. Kalles første gang modellen står i et terreng.
export function tilUtm(o, ref) {
  if (!o || o.ramme !== "bygg" || !ref) return o;
  const p = fraBygg(o.E, -o.N, ref);
  return Object.assign({}, o, { ramme: "utm", E: rund(p.E), N: rund(p.N),
    rot: normVinkel((o.rot || 0) + (ref.plass.rot || 0)) });
}

// Rotasjon i scenen (radianer, Y) → objektets rot i dets ramme. Brukes når
// noe dreies i scenen og skal lagres.
export function rotFraScene(rotY, ramme, ref) {
  const grader = rotY * 180 / Math.PI;
  const plassRot = ramme === "utm" && ref ? (ref.plass.rot || 0) : 0;
  return normVinkel(plassRot - grader);
}

function rund(v) { return Math.round(v * 1000) / 1000; }

// ═══════════════════════ LAGRING ═══════════════════════
//
// Hvert objekt er én post med id; en sletting blir en gravstein. Da kan to som
// rigger samtidig flettes på id i sp-lager.js — nyeste `endret` vinner per
// objekt, og ingen sletter hverandres brakker.
//
// Må noe lastes opp etter at lista er lest fra SharePoint? Ja hvis en lokal
// post er nyere enn (eller mangler i) SharePoint — da ble noe endret uten
// innlogging eller uten nett, og det skal ikke bli liggende på én maskin.
export function trengerOpplasting(lokale, eksterne) {
  const ext = new Map((eksterne || []).filter(p => p && p.id).map(p => [p.id, p]));
  return (lokale || []).some(p => {
    if (!p || !p.id) return false;
    const e = ext.get(p.id);
    return !e || String(p.endret || "") > String(e.endret || "");
  });
}

// Det byggeplass-siden får: vasket, uten gravsteiner og uten skjulte objekter
// (montøren skal se det kontoret viser).
export function riggForByggeplassFra(liste, ref) {
  return {
    ref: ref ? { E0: ref.E0, N0: ref.N0, plass: Object.assign({}, ref.plass) } : null,
    objekter: riggObjekter(vaskRiggListe(liste)).filter(o => !o.skjult)
  };
}

// Byggeplass-siden leser det tilbake. Gamle filer har ikke feltet.
export function riggFraByggeplass(d) {
  if (!d || typeof d !== "object") return { ref: null, objekter: [] };
  return { ref: vaskRef(d.ref), objekter: riggObjekter(vaskRiggListe(d.objekter)) };
}

// ═══════════════════════ MENGDER ═══════════════════════
//
// Det som skal bestilles eller leies. En brakkerigg med 3 moduler i 2 etasjer
// er 6 brakkemoduler — det er det utleieren teller. Resten er ett stykk per
// objekt. Skjulte objekter telles ikke: de er tatt ut av planen.
export function riggAntall(o) {
  if (!o) return 0;
  return RIGG_TYPER[o.type] && RIGG_TYPER[o.type].moduler
    ? (o.etasjer || 1) * (o.moduler || 1) : 1;
}

// Én rad per ENHET (som materiell-vis.js), så «Antall» i Mengder og i Excel
// teller brakkemoduler, ikke rigger. `label` oversetter typenavnet.
export function riggMengdeRader(liste, label) {
  const lab = label || ((k) => RIGG_TYPER[k].label);
  const ut = [];
  let n = 0;
  for (const o of riggObjekter(liste)) {
    if (o.skjult) continue;
    const typeNavn = lab(o.type);
    const key = (o.navn || typeNavn) + " · " + typeNavn;
    for (let i = 0; i < riggAntall(o); i++) {
      n++;
      ut.push({
        id: -(2000000 + n),     // syntetisk, kolliderer aldri med IFC-id-er eller materiell
        key, name: o.navn || typeNavn, objType: typeNavn,
        type: "Rigg", material: typeNavn,
        L: o.L, B: o.B, H: o.H, len: Math.max(o.L, o.B),
        vol: 0, area: o.L * o.B, flate: o.L * o.B, forskaling: 0,
        kg: 0, kgGeo: 0, kjentVekt: false, umuligVolum: false,
        vektKilde: "", profil: "", nomKgPerM: 0, avvik: null
      });
    }
  }
  return ut;
}

// Oppsummering per type, til panelet (og tegnforklaringen senere).
export function riggTelling(liste) {
  const m = new Map();
  for (const o of riggObjekter(liste)) {
    if (o.skjult) continue;
    m.set(o.type, (m.get(o.type) || 0) + riggAntall(o));
  }
  return RIGG_REKKEFOLGE.filter(k => m.has(k)).map(k => ({ type: k, antall: m.get(k) }));
}

export function nyRiggId() {
  return "R-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
