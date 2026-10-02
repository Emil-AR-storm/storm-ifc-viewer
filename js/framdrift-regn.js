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
//   tak:<id>      takplate (TRP — fra SW-generatoren på kontoret, tak-lett på byggeplassen)
//   blikk:<id>    generert blikk/beslag fra SW-generatoren (Emil 01.10)
//   mat:<id>      materiell-objekt (også stålbunker og fagverk)
//   rigg:<id>     rigg-objekt
//   mark:<id>     markering (📌 kommentar, også med område) — Emil 01.10
// Slaget holder slagene fra hverandre: ExpressID 3 og rigg-objekt «3» kan
// aldri forveksles.
export const SLAG = ["id", "sw", "tak", "blikk", "mat", "rigg", "mark"];
export const SLAG_NAVN = { id: "Elementer", sw: "SW-elementer", tak: "Takplater", blikk: "Blikk", mat: "Materiell", rigg: "Rigg", mark: "Markeringer" };
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
// Emil 01.10: i framdriftsplanen heter etappene «Trinn» (støpeplanen beholder
// «Etappe»). Et lagret standardnavn fra trinn 1–2 («Etappe 3») blir «Trinn 3»;
// navn noen har skrevet selv, står urørt.
export function standardNavn(n) {
  const m = /^Etappe (\d+)$/.exec(n || "");
  return m ? "Trinn " + m[1] : (n || "");
}
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
    navn: standardNavn(tekst(e.navn, 80).trim()) || ("Trinn " + nr),
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
    nr, navn: "Trinn " + nr, farge: fargeFor(nr), dato: "", endret: naa || new Date().toISOString()
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

// ═══════════════════════ TIDEN (trinn 3: glideren) ═══════════════════════
//
// Emil 01.10: «en slider der objektene går fra skjult til gradvis synlig».
// Tiden måles i DAGER (desimaltall, så glideren kan stå midt i en dag). Et
// trinn varer fra startdatoen kl. 00 til dagen ETTER sluttdatoen kl. 00 —
// «Fra 06.10 Til 06.10» er altså én hel dag, ikke null.
//
// Innen trinnet bygges det nedenfra og opp: objektene sorteres etter
// underkant og deles i STEG (høyst STEG_MAKS). Steg j toner inn i sin del av
// trinnet, så modellen vokser i stedet for at alt blinker fram samtidig.
export const STEG_MAKS = 10;
export function dagNr(iso) {
  const d = dato(iso);
  if (!d) return NaN;
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
}
export function isoFraDag(n) {
  if (!Number.isFinite(n)) return "";
  return new Date(Math.floor(n) * 86400000).toISOString().slice(0, 10);
}
// [start, slutt) i dager, eller null når trinnet mangler startdato.
export function trinnTid(e) {
  if (!e || !e.dato) return null;
  const a = dagNr(e.dato);
  const b = dagNr(e.slutt || e.dato);
  if (!Number.isFinite(a)) return null;
  return { a, b: Math.max(a, Number.isFinite(b) ? b : a) + 1 };
}
// Spennet glideren går over: fra første start til siste slutt. null uten datoer.
export function tidsSpenn(liste) {
  let a = Infinity, b = -Infinity;
  for (const e of synlige(liste)) {
    const tt = trinnTid(e);
    if (!tt) continue;
    a = Math.min(a, tt.a); b = Math.max(b, tt.b);
  }
  return Number.isFinite(a) ? { a, b, dager: b - a } : null;
}
// Hvor langt trinnet er kommet ved tiden `tid` (dager): 0 før, 1 etter.
// Trinn uten dato regnes som ferdig — de står i modellen som før.
export function trinnAndel(e, tid) {
  const tt = trinnTid(e);
  if (!tt) return 1;
  if (!Number.isFinite(tid) || tid >= tt.b) return 1;
  if (tid <= tt.a) return 0;
  return (tid - tt.a) / (tt.b - tt.a);
}
export const antallSteg = (n) => Math.max(1, Math.min(STEG_MAKS, Math.round(Number(n) || 0)));
// Objekt nr. i (0-basert, sortert nedenfra) av n havner i steg ⌊i·K/n⌋.
export function stegFor(i, n) {
  const K = antallSteg(n);
  return Math.min(K - 1, Math.floor(i * K / Math.max(1, n)));
}
// Hvor synlig steg j av K er når trinnet er kommet `p` (0–1).
export function stegAndel(p, j, K) {
  if (p >= 1) return 1;
  if (p <= 0) return 0;
  return Math.max(0, Math.min(1, p * K - j));
}
// Trinnene som er i arbeid ved `tid` (andel mellom 0 og 1), i planrekkefølge.
export function iArbeid(liste, tid) {
  return sortert(liste).filter(e => { const p = trinnAndel(e, tid); return p > 0 && p < 1; });
}

// ═══════════════════════ PDF-EN (trinn 4) ═══════════════════════
//
// Oppsett B (Emil 01.10, «framdrift-prove-B.png» i Ideer): én side per
// trinn, fire skråbilder (nord, sør, øst, vest) der bygget vokser trinn for
// trinn, og en kolonne til høyre med trinnlinja, datoene, et bilde av BARE det
// som er nytt i trinnet (sett fra sør) og lista over hva som er lagt til.

// Trinnene som får en side: de som har noe i seg, i planrekkefølge.
export function pdfTrinn(liste) { return sortert(liste).filter(e => e.objekter.length); }

export function framdriftFilnavn(modell, iso) {
  const navn = String(modell || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "modell";
  return "Framdriftsplan " + navn + " " + (iso || "") + ".pdf";
}

// IFC-klassen på norsk, i flertall — «Søyler CFSHS300x6 · 20 stk»
export const IFC_GRUPPE = {
  IfcColumn: "Søyler", IfcBeam: "Bjelker", IfcMember: "Staver", IfcPlate: "Plater",
  IfcSlab: "Dekker", IfcWall: "Vegger", IfcWallStandardCase: "Vegger", IfcFooting: "Fundamenter",
  IfcRoof: "Tak", IfcStair: "Trapper", IfcStairFlight: "Trapper", IfcRailing: "Rekkverk",
  IfcDoor: "Dører", IfcWindow: "Vinduer", IfcCovering: "Kledning", IfcPile: "Peler",
  IfcReinforcingBar: "Armering", IfcReinforcingMesh: "Armering", IfcBuildingElementProxy: "Objekter"
};
// Profilen/typen ut av IFC-navnet: «HE-A:HEA200:12345» → «HEA200»,
// «CFSHS (EN 10219-2) Column:CFSHS100x6» → «CFSHS100x6». Uten kolon: hele navnet.
export function ifcUnder(navn) {
  const deler = String(navn || "").split(":").map(x => x.trim()).filter(Boolean);
  while (deler.length > 1 && /^\d+$/.test(deler[deler.length - 1])) deler.pop();
  return (deler.length > 1 ? deler[deler.length - 1] : deler[0] || "").slice(0, 60);
}
// Lista i høyrekolonnen: like ting samles på én rad med antall.
// inn: [{ gruppe, under?, antall? }] → [{ tekst, antall }], størst først.
export function infoRader(poster) {
  const m = new Map();
  for (const p of poster || []) {
    if (!p || !p.gruppe) continue;
    const tekst = (p.gruppe + (p.under ? " " + p.under : "")).trim();
    m.set(tekst, (m.get(tekst) || 0) + (Number(p.antall) > 0 ? Number(p.antall) : 1));
  }
  return [...m].map(([tekst, antall]) => ({ tekst, antall }))
    .sort((a, b) => b.antall - a.antall || (a.tekst < b.tekst ? -1 : a.tekst > b.tekst ? 1 : 0));
}
// Overskriften i kolonnen: «Trinn 2 · Stålmontasje» — men står det bare
// «Trinn 2» i navnet, blir det ikke «Trinn 2 · Trinn 2».
export function trinnTittel(e, ordTrinn) {
  const ord = ordTrinn || "Trinn";
  const navn = String((e && e.navn) || "").trim();
  if (!navn || navn === ord + " " + e.nr) return ord + " " + e.nr;
  return ord + " " + e.nr + " · " + navn;
}

// ═══════════════════════ VIDEOEN (trinn 5) ═══════════════════════
// 1280 × 720 i 30 bilder/s, tegnet 1,5 ganger større og skalert ned (skarpere
// kanter). Hvert trinn får like lang tid — datoene står i teksten, men et
// trinn på én dag skal ikke blinke forbi mens et på tre uker tar et minutt.
export const VIDEO = { b: 1280, h: 720, fps: 30, overSampling: 1.5, bitrate: 6e6, avstand: 1.6, intro: 1, perTrinn: 3, outro: 2.5 };
export function videoFilnavn(modell, iso, ext) {
  return framdriftFilnavn(modell, iso).replace(/\.pdf$/, "." + (ext || "mp4"));
}
// Tidsplanen: hvilket bilde viser hva. `liste` = trinnene med innhold (pdfTrinn).
export function videoPlan(liste, V) {
  const o = Object.assign({}, VIDEO, V || {});
  const n = (liste || []).length;
  const sek = o.intro + n * o.perTrinn + o.outro;
  const bilder = Math.max(1, Math.round(sek * o.fps));
  const indeks = new Map((liste || []).map((e, i) => [e.id, i]));
  const tid = (f) => f / o.fps;
  const andel = (e, f) => {
    const i = indeks.has(e.id) ? indeks.get(e.id) : -1;
    if (i < 0) return 1;
    return Math.max(0, Math.min(1, (tid(f) - o.intro - i * o.perTrinn) / o.perTrinn));
  };
  const trinnVed = (f) => {
    if (!n) return null;
    const x = tid(f) - o.intro;
    if (x < 0) return null;
    return liste[Math.min(n - 1, Math.floor(x / o.perTrinn))];
  };
  // Én hel runde: rolig inn og ut, så første og siste bilde står nesten stille
  const vinkel = (f) => { const u = f / bilder; return 2 * Math.PI * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI) * 0.15); };
  return { bilder, sekunder: sek, andel, trinnVed, vinkel, fps: o.fps };
}

// ═══════════ BUNKENE SOM BRUKES OPP (Emil 02.10, se framdrift-kilde.js) ═══════════
// Hvor mange enheter som er igjen i bunken når objektene står med andelen
// `andel(nokkel)` (0–1). Ren regning — testes i Node.
export function igjen(antall, enheter, andel) {
  const n = Math.max(0, Math.round(Number(antall) || 0));
  if (!enheter || !enheter.length) return n;
  let sum = 0, brukt = 0;
  for (const e of enheter) {
    const w = Number(e.w) > 0 ? Number(e.w) : 1;
    let a = 0;
    for (const k of e.nokler || []) a += Math.max(0, Math.min(1, Number(andel(k)) || 0));
    a = (e.nokler && e.nokler.length) ? a / e.nokler.length : 0;
    sum += w; brukt += w * a;
  }
  if (!(sum > 0)) return n;
  return Math.max(0, Math.min(n, Math.ceil(n * (1 - brukt / sum) - 1e-9)));
}
