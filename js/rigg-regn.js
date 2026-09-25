// 🏕 Rigg — den rene regningen. Ingen DOM, ingen three.js, ingen nettkall.
//
// Rigg er det man setter opp på byggeplassen før første søyle reises:
// brakker, toalett, container, strømskap, møteplass osv. Verktøyet legger
// enkle modeller av dem på tomta, så riggplanen kan vises og lastes ned.
//
// Grunnlag: «Storm IFC-Viewer handoff Rigg 2026-09-25.md» og Emils bestilling
// i Rigg/rigg verktøy 25.09.2026.txt. Trinn 1–2: de enkle objektene.
// Trinn 3–4: byggegjerdet (skjøter, paneler og porter). Pilene og PDF-en
// kommer i egne runder.
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
  soppel:     { label: "Søppelcontainer", L: 3.5, B: 1.9, H: 1.5, farge: "#2c5f8a" },
  // 🚧 Byggegjerdet (trinn 3–4). L = PANELLENGDEN og H = panelhøyden — samme
  // felt som de andre objektene, så skjema, vasking og lagring er de samme.
  // B er foten (betongklossen) og brukes bare til tegningen.
  // Mål: mobilt anleggsgjerde ca. 3,5 × 2,0 m — forslaget fra handoffen, som
  // Emil valgte 25.09 {Source not found: ikke sjekket mot leverandør}.
  gjerde:     { label: "Byggegjerde", L: 3.5, B: 0.7, H: 2.0, farge: "#aab4bc", gjerde: true }
};

// Rekkefølgen knappene står i panelet — det man rigger først, først.
export const RIGG_REKKEFOLGE = ["gjerde", "brakke", "hjulbrakke", "toalett", "forstehjelp", "mote",
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
  soppel: "Avfall og kildesortering",
  gjerde: "Byggegjerde rundt byggeplassen, med port for kjøretøy"
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
    L: mal(p.L, M.gjerde ? 0.5 : 0.1, M.gjerde ? 10 : 30, M.L),
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
  if (M.gjerde) {
    ut.punkter = vaskPunkter(p.punkter);
    if (!ut.punkter) return null;
  }
  return ut;
}

// ═══════════════════════ 🚧 BYGGEGJERDET ═══════════════════════
//
// REGELEN (handoffen kap. 2, bekreftet av Emil 25.09 — «start trinn 3–4»):
//
//  · Gjerdet er en LUKKET RING AV SKJØTER. Hvert stykke mellom to skjøter er
//    ETT PANEL. Da er «dra i skjøten» det samme som å flytte ett punkt, og de
//    to panelene på hver side følger med.
//  · Skjøtene ligger i gjerdets EGEN ramme ({ x, z } i meter fra objektets
//    origo, x langs objektets lengderetning og z på tvers — samme ramme som
//    de andre objektenes 3D-modell). Da er gjerdet et helt vanlig rigg-objekt:
//    Flytt endrer E/N, roter endrer rot, og overgangen bygg → tomt (tilUtm)
//    virker uten en eneste særregel.
//  · Et panel har FAST lengde i virkeligheten. Blir et panel dratt lengre enn
//    panellengden (L), strekkes det ikke — det tegnes rødt og telles som et
//    varsel. Et kortere panel er lov: da overlapper det i skjøten.
//  · En PORT er to paneler ved siden av hverandre gjort om til ett stykke.
//    Den midterste skjøten forsvinner, og stykket merkes som port. Porten kan
//    gjøres tilbake til to paneler. Flaggen `port` står på skjøten stykket
//    STARTER i — da følger den med når skjøter legges til og fjernes foran.
//  · Mengder: paneler (stykker som ikke er port), føtter og klemmer (én per
//    skjøt) og porter.

export const MIN_SKJOTER = 3;
export const MAKS_SKJOTER = 400;
const MAKS_GJERDE_M = 2000;
// Litt slingring før et panel regnes som for langt: 1 cm er ingen feil, det
// er avrunding i musa.
const TOLERANSE_M = 0.01;

function vaskPunkter(liste) {
  if (!Array.isArray(liste)) return null;
  const ut = [];
  for (const q of liste.slice(0, MAKS_SKJOTER)) {
    if (!q || typeof q !== "object") continue;
    const x = tall(q.x), z = tall(q.z);
    if (x == null || z == null || Math.abs(x) > MAKS_GJERDE_M || Math.abs(z) > MAKS_GJERDE_M) continue;
    const p = { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
    if (q.port === true) p.port = true;
    ut.push(p);
  }
  return ut.length >= MIN_SKJOTER ? ut : null;
}

// Markeringsboksen → skjøtene langs omrisset. Hver side deles i så mange like
// paneler som trengs for at ingen blir lengre enn panellengden:
// ceil(side / panellengde). Rundt med klokka sett ovenfra, fra hjørnet (−x, −z).
export function gjerdeFraRektangel(hx, hz, panelL) {
  const P = Math.max(0.5, Number(panelL) || 3.5);
  const a = Math.abs(hx), b = Math.abs(hz);
  if (!(a > 0.25 && b > 0.25)) return null;
  const hjorner = [[-a, -b], [a, -b], [a, b], [-a, b]];
  const ut = [];
  for (let s = 0; s < 4; s++) {
    const [x0, z0] = hjorner[s], [x1, z1] = hjorner[(s + 1) % 4];
    const lengde = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(lengde / P - 1e-9));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      ut.push({ x: rund(x0 + (x1 - x0) * t), z: rund(z0 + (z1 - z0) * t) });
    }
  }
  return ut;
}

// Stykkene i ringen: { i, j, a, b, l, port, forLang }. i og j er skjøtene i
// hver ende (j = i + 1, og siste stykke går tilbake til skjøt 0).
export function gjerdeStykker(o) {
  const p = (o && o.punkter) || [];
  const P = o ? o.L : 3.5;
  const ut = [];
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const a = p[i], b = p[j];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const port = a.port === true;
    // En port er to paneler bred — lengre enn det er den for bred.
    const maks = (port ? 2 : 1) * P + TOLERANSE_M;
    ut.push({ i, j, a, b, l, port, forLang: l > maks });
  }
  return ut;
}

export function gjerdeMengder(o) {
  const st = gjerdeStykker(o);
  const porter = st.filter(s => s.port).length;
  return {
    paneler: st.length - porter,
    fotter: st.length,        // én fot under hver skjøt, og ringen er lukket
    klemmer: st.length,       // én klemme i hver skjøt
    porter,
    forLange: st.filter(s => s.forLang).length,
    lengde: st.reduce((sum, s) => sum + s.l, 0)
  };
}

// To stykker ved siden av hverandre? Da deler de en skjøt: svaret er
// { forst, sist } (sist = forst + 1 rundt ringen), ellers null.
export function naboStykker(antall, i, j) {
  if (antall < 2 || i === j) return null;
  if ((i + 1) % antall === j) return { forst: i, sist: j };
  if ((j + 1) % antall === i) return { forst: j, sist: i };
  return null;
}

// «Gjør om til port»: to naboer uten port blir ett stykke med port-flagg.
// Skjøten mellom dem forsvinner. Minst tre skjøter må være igjen.
export function gjorOmTilPort(punkter, i, j) {
  const p = punkter || [];
  const n = naboStykker(p.length, i, j);
  if (!n || p.length - 1 < MIN_SKJOTER) return null;
  if (p[n.forst].port || p[n.sist].port) return null;
  const ut = p.map(q => Object.assign({}, q));
  ut[n.forst].port = true;
  ut.splice(n.sist, 1);          // skjøten mellom dem (starten på det andre stykket)
  return ut;
}

// «Gjør tilbake»: porten blir to paneler igjen, med en ny skjøt midt på.
export function gjorTilbake(punkter, i) {
  const p = punkter || [];
  if (!p[i] || !p[i].port || p.length + 1 > MAKS_SKJOTER) return null;
  const a = p[i], b = p[(i + 1) % p.length];
  const ut = p.map(q => Object.assign({}, q));
  delete ut[i].port;
  ut.splice(i + 1, 0, { x: rund((a.x + b.x) / 2), z: rund((a.z + b.z) / 2) });
  return ut;
}

// Ny skjøt i stykke i, i punktet (x, z). Et panel delt i to er to paneler;
// en port delt i to er to paneler (en port kan ikke ha skjøt på midten).
export function leggTilSkjot(punkter, i, x, z) {
  const p = punkter || [];
  if (!p[i] || p.length + 1 > MAKS_SKJOTER) return null;
  const ut = p.map(q => Object.assign({}, q));
  delete ut[i].port;
  ut.splice(i + 1, 0, { x: rund(x), z: rund(z) });
  return ut;
}

// Fjern skjøt k: de to stykkene på hver side blir ett. Var stykket FØR skjøten
// en port, er det fortsatt en port.
export function fjernSkjot(punkter, k) {
  const p = punkter || [];
  if (!p[k] || p.length - 1 < MIN_SKJOTER) return null;
  const ut = p.map(q => Object.assign({}, q));
  ut.splice(k, 1);
  return ut;
}

export function flyttSkjot(punkter, k, x, z) {
  const p = punkter || [];
  if (!p[k]) return null;
  const ut = p.map(q => Object.assign({}, q));
  ut[k].x = rund(x); ut[k].z = rund(z);
  return ut;
}

// Gjerdets egen ramme ↔ objektets posisjonsramme (E, N). Samme dreining som
// fotavtrykket: x-retningen er (cos r, −sin r) og z-retningen (−sin r, −cos r).
// Matrisen er sin egen invers, så begge veier regnes likt.
export function lokalTilEN(o, x, z) {
  const r = (o.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { E: o.E + x * c - z * s, N: o.N - x * s - z * c };
}

export function enTilLokal(o, E, N) {
  const r = (o.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dE = E - o.E, dN = N - o.N;
  return { x: dE * c - dN * s, z: -dE * s - dN * c };
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
  if (o.punkter) return o.punkter.map(q => lokalTilEN(o, q.x, q.z));
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
  if (o.punkter) return gjerdeMengder(o).paneler;
  return RIGG_TYPER[o.type] && RIGG_TYPER[o.type].moduler
    ? (o.etasjer || 1) * (o.moduler || 1) : 1;
}

// Delene i et byggegjerde, slik de bestilles. Egne rader i Mengder, men IKKE
// egne objekter: gjerdet er ÉN post (handoffen, advarsel 4) — ellers ville
// hvert panel havnet i flervalg, grupper og Mengder hver for seg.
export const GJERDE_DELER = {
  panel: "Gjerdepanel", fot: "Gjerdefot", klemme: "Gjerdeklemme", port: "Byggeport"
};

// Én rad per ENHET (som materiell-vis.js), så «Antall» i Mengder og i Excel
// teller brakkemoduler og gjerdepaneler, ikke rigger. `tr` oversetter tekst.
export function riggMengdeRader(liste, tr) {
  const lab = tr || ((x) => x);
  const ut = [];
  let n = 0;
  const rad = (key, navn, del, L, B, H) => {
    n++;
    ut.push({
      id: -(2000000 + n),     // syntetisk, kolliderer aldri med IFC-id-er eller materiell
      key, name: navn, objType: del,
      type: "Rigg", material: del,
      L, B, H, len: Math.max(L, B),
      vol: 0, area: L * B, flate: L * B, forskaling: 0,
      kg: 0, kgGeo: 0, kjentVekt: false, umuligVolum: false,
      vektKilde: "", profil: "", nomKgPerM: 0, avvik: null
    });
  };
  for (const o of riggObjekter(liste)) {
    if (o.skjult) continue;
    if (o.punkter) {
      const m = gjerdeMengder(o), navn = o.navn || lab(RIGG_TYPER.gjerde.label);
      const del = (k) => lab(GJERDE_DELER[k]);
      for (let i = 0; i < m.paneler; i++) rad(navn + " · " + del("panel"), navn, del("panel"), o.L, 0.05, o.H);
      for (let i = 0; i < m.porter; i++) rad(navn + " · " + del("port"), navn, del("port"), o.L * 2, 0.05, o.H);
      for (let i = 0; i < m.fotter; i++) rad(navn + " · " + del("fot"), navn, del("fot"), o.B, 0.2, 0.15);
      for (let i = 0; i < m.klemmer; i++) rad(navn + " · " + del("klemme"), navn, del("klemme"), 0.1, 0.1, 0.1);
      continue;
    }
    const typeNavn = lab(RIGG_TYPER[o.type].label);
    const key = (o.navn || typeNavn) + " · " + typeNavn;
    for (let i = 0; i < riggAntall(o); i++) rad(key, o.navn || typeNavn, typeNavn, o.L, o.B, o.H);
  }
  return ut;
}

// Oppsummering per type, til panelet (og tegnforklaringen senere).
// Gjerdet gir fire linjer (paneler, porter, føtter, klemmer) med `del` satt.
export function riggTelling(liste) {
  const m = new Map();
  const gj = { panel: 0, port: 0, fot: 0, klemme: 0 };
  let harGjerde = false;
  for (const o of riggObjekter(liste)) {
    if (o.skjult) continue;
    if (o.punkter) {
      const g = gjerdeMengder(o);
      harGjerde = true;
      gj.panel += g.paneler; gj.port += g.porter; gj.fot += g.fotter; gj.klemme += g.klemmer;
      continue;
    }
    m.set(o.type, (m.get(o.type) || 0) + riggAntall(o));
  }
  const ut = [];
  for (const k of RIGG_REKKEFOLGE) {
    if (k === "gjerde") {
      if (harGjerde) for (const d of ["panel", "port", "fot", "klemme"])
        if (gj[d]) ut.push({ type: "gjerde", del: d, antall: gj[d] });
      continue;
    }
    if (m.has(k)) ut.push({ type: k, antall: m.get(k) });
  }
  return ut;
}

export function nyRiggId() {
  return "R-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
