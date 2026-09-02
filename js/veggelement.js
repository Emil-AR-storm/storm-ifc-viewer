// 🧱 SW-generator: automatiske veggelementer (sandwichpaneler) på stålmodeller.
//
// HVA DEN GJØR (Emils spesifikasjon, Ideer/Automatisk SW,veggelement liste…txt):
//  · finner søylene (IfcColumn) og fasadene deres automatisk (konveks hull)
//  · genererer gulv (betong + isolasjon, OK betong = bunn av søylene, med
//    valgt utstikk forbi søylene) og valgfri ringmur inntil utvendige søyler
//  · fyller hver fasade med veggelementer søyle-til-søyle: elementet stopper
//    25 mm fra søylesenter (to naboelementer får 50 mm mellomrom), og radene
//    stables med 1100- og 1000-høyder til topp av søyleforlengerne — går ikke
//    høyden opp, kappes øverste rad (Emils valg 01.09)
//  · utsparinger (dører/vinduer/porter): trykk «Marker utsparing» og pek på
//    FLATENE rundt åpningen — innsiden av søylene på sidene, undersiden av
//    bjelken over. Én flate per side (Emils runde 3: hele elementer dro med
//    seg tre gale sider hver gang)
//  · hver unik lengde×høyde får et SW-nummer (SW-01, SW-02 …); kappede
//    tilpasningsbiter heter SW-XX, som på Moelv-tegningene
//  · veggene tegnes PÅ PLASS i 3D med valgt farge, OG hvert SW-nummer legges
//    som leveransestabel i 📦 Materiell (sandwichpanel) — da kommer antall og
//    areal i Mengder av seg selv
//  · lista lastes ned i Moelv-formatet (Elementnr, lengde, høyde, tykkelse,
//    antall, isolasjon, farger, m²) som semikolon-CSV som åpner rett i Excel
//
// KUN KONTOR: importeres bare fra main.js, som materiell.js. Genererte vegger
// lagres lokalt per modellfil og tegnes opp igjen når modellen åpnes.
//
// Regnereglene (radmiks, spennlengder, oppdeling rundt utsparinger, SW-numre)
// er RENE TALLFUNKSJONER uten three.js — de prøves i _test/test-veggelement.mjs.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { canvas, raycaster, scene } from "./scene.js";
import { allElementBoxes, hitID, pick, toCsv } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { MALTYPER, lagreMateriellLokalt, mmTilScene, ribbonPosisjoner, tegnMateriell, trpProfil, vaskMateriell } from "./materiell-vis.js";

// ---------- Konstanter (Emils regler) ----------
export const SW_KLARING_MM = 25;      // fra søylesenter til elementende
export const SW_HOYDER = [1100, 1000]; // radhøydene som finnes, mm
export const SW_MIN_BIT_MM = 100;     // kortere biter enn dette droppes
export const SW_TOL_MM = 5;           // to lengder innenfor dette = samme SW-nummer
export const SW_KAPP_UNDER_MM = 2000; // kortere elementer er KAPP → SW-XX (Emils regel)

// ═══════════════════ RENE REGNEFUNKSJONER (testes i Node) ═══════════════════

// Radmiks: hvilke radhøyder (nedenfra og opp) fyller `hoydeMm`?
// Prøver først en EKSAKT miks av 1100 og 1000 (6400 = 4×1100 + 2×1000).
// Finnes ingen, velges miksen som etterlater minst rest — og resten blir en
// kappet rad ØVERST (Emils valg). 1100-radene ligger nederst, deretter 1000.
export function radMiks(hoydeMm) {
  const H = Math.max(0, Math.round(Number(hoydeMm) || 0));
  let best = null;
  for (let a = Math.floor(H / 1100); a >= 0; a--) {
    const rest0 = H - a * 1100;
    const b = Math.floor(rest0 / 1000);
    const rest = rest0 - b * 1000;
    if (!best || rest < best.rest || (rest === best.rest && a + b < best.a + best.b))
      best = { a, b, rest };
    if (rest === 0) break;   // eksakt — og med flest mulig 1100 (a telles ovenfra)
  }
  if (!best) return { rader: [], kappMm: 0 };
  const rader = [];
  for (let i = 0; i < best.a; i++) rader.push(1100);
  for (let i = 0; i < best.b; i++) rader.push(1000);
  const kappMm = best.rest >= 20 ? best.rest : 0;   // under 2 cm er toleranse, ikke en rad
  return { rader, kappMm };
}

// Elementlengden mellom to søyler: senteravstand minus 25 mm i hver ende.
export function spennLengdeMm(senteravstandMm) {
  return Math.round((Number(senteravstandMm) || 0) - 2 * SW_KLARING_MM);
}

// Deler intervallet [fra, til] (mm langs fasaden) opp rundt utsparinger.
// `apninger` er [[a0, a1], …]. Returnerer bitene som står igjen, i rekkefølge.
export function delOppMedUtsparinger(fra, til, apninger) {
  let biter = [[fra, til]];
  for (const [a0, a1] of apninger || []) {
    const neste = [];
    for (const [b0, b1] of biter) {
      if (a1 <= b0 || a0 >= b1) { neste.push([b0, b1]); continue; }
      if (a0 > b0) neste.push([b0, a0]);
      if (a1 < b1) neste.push([a1, b1]);
    }
    biter = neste;
  }
  return biter.filter(([b0, b1]) => b1 - b0 >= SW_MIN_BIT_MM);
}

// Konveks hull av søylesentrene (monotone chain). Punkter: {x, z}.
// Returnerer hjørnene MOT KLOKKA, uten duplikater.
export function konveksHull(punkter) {
  const p = [...punkter].sort((u, v) => u.x - v.x || u.z - v.z);
  if (p.length < 3) return p;
  const kryss = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const nedre = [];
  for (const q of p) {
    while (nedre.length >= 2 && kryss(nedre[nedre.length - 2], nedre[nedre.length - 1], q) <= 0) nedre.pop();
    nedre.push(q);
  }
  const ovre = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (ovre.length >= 2 && kryss(ovre[ovre.length - 2], ovre[ovre.length - 1], q) <= 0) ovre.pop();
    ovre.push(q);
  }
  nedre.pop(); ovre.pop();
  return nedre.concat(ovre);
}

// Flatene KLYNGES til åpninger: flater nær hverandre hører til samme åpning.
// Emil markerte alle portene i én omgang og trykket Ferdig — da må systemet
// selv se hvilke flater som hører sammen (single-linkage på avstand).
export function grupperFlater(flater, maksAvstand) {
  const grupper = [];
  for (const f of flater) {
    if (!f || !f.p) continue;
    const treff = grupper.filter(g => g.some(x =>
      Math.hypot(x.p.x - f.p.x, x.p.y - f.p.y, x.p.z - f.p.z) <= maksAvstand));
    if (!treff.length) { grupper.push([f]); continue; }
    treff[0].push(f);
    for (const r of treff.slice(1)) {
      treff[0].push(...r);
      grupper.splice(grupper.indexOf(r), 1);
    }
  }
  return grupper;
}

// Utsparingen regnes ut fra FLATENE brukeren trykket på, og HULLENE i
// rammen fylles fra ENDENE av de markerte elementene (Emils tegning runde 6):
//  · normal mest vannrett: flata er en SIDE (fortegnet sier venstre/høyre,
//    aksen er den normalen peker mest langs)
//  · normal mest ned/opp: undersiden av bjelke = TOPP, oversiden = BUNN
//  · 2 sider (to søyler): topp og bunn = ENDENE av de markerte søylene
//  · 3 sider (U): den manglende siden speiles fra elementene på tvers —
//    to søyler + bjelke over gir bunn = søylenes underkant; bjelke over og
//    under + én søyle gir den andre siden = bjelkenes ender
//  · helt uten holdepunkt: gulvet / veggtoppen (±1e9, klippes av radene)
// Hver flate er {p, n, boks?} der boks er elementets AABB ({min,max} xyz).
export function utsparingFraFlater(flater, slark) {
  if (!flater || !flater.length) return { feil: "tom" };
  const SLARK = Number(slark) > 0 ? Number(slark) : 0.5;   // sideveis raushet (sceneenheter)
  const grenser = { x: [null, null], z: [null, null] };   // [min, maks] per akse
  let bunn = null, topp = null;
  const pkt = [];
  const sideBokser = [], liggBokser = [];
  for (const f of flater) {
    if (!f || !f.p || !f.n) continue;
    pkt.push(f.p);
    if (Math.abs(f.n.y) >= Math.max(Math.abs(f.n.x), Math.abs(f.n.z))) {
      if (f.n.y < 0) topp = topp === null ? f.p.y : Math.min(topp, f.p.y);
      else bunn = bunn === null ? f.p.y : Math.max(bunn, f.p.y);
      if (f.boks) liggBokser.push(f.boks);
      continue;
    }
    if (f.boks) sideBokser.push(f.boks);
    const akse = Math.abs(f.n.x) >= Math.abs(f.n.z) ? "x" : "z";
    const g = grenser[akse];
    if (f.n[akse] > 0) g[0] = g[0] === null ? f.p[akse] : Math.max(g[0], f.p[akse]);
    else g[1] = g[1] === null ? f.p[akse] : Math.min(g[1], f.p[akse]);
  }
  // åpningens akse: helst den som har begge sidene, ellers den som har én
  let akse = null;
  for (const a of ["x", "z"]) {
    const g = grenser[a];
    if (g[0] !== null && g[1] !== null && g[1] > g[0] &&
        (!akse || (g[1] - g[0]) > (grenser[akse][1] - grenser[akse][0]))) akse = a;
  }
  if (!akse) for (const a of ["x", "z"]) if (grenser[a][0] !== null || grenser[a][1] !== null) akse = a;
  // helt uten sideflater: aksen og grensene hentes fra de liggende bjelkenes
  // felles utstrekning (bjelke over + under markert = endene deres er sidene)
  if (!akse && liggBokser.length) {
    for (const a of ["x", "z"]) {
      const lo = Math.max(...liggBokser.map(b => b.min[a]));
      const hi = Math.min(...liggBokser.map(b => b.max[a]));
      if (hi > lo && (!akse || hi - lo > grenser[akse][1] - grenser[akse][0])) {
        akse = a; grenser[a] = [lo, hi];
      }
    }
  }
  if (!akse) return { feil: "sider" };
  // manglende side i aksen: fyll fra de liggende elementenes ender
  const g = grenser[akse];
  if ((g[0] === null || g[1] === null) && liggBokser.length) {
    if (g[0] === null) g[0] = Math.max(...liggBokser.map(b => b.min[akse]));
    if (g[1] === null) g[1] = Math.min(...liggBokser.map(b => b.max[akse]));
  }
  if (g[0] === null || g[1] === null || g[1] <= g[0]) return { feil: "sider" };
  // manglende topp/bunn: endene av de markerte søylene (Emils 2-sider-regel)
  if (topp === null && sideBokser.length) topp = Math.max(...sideBokser.map(b => b.max.y));
  if (bunn === null && sideBokser.length) bunn = Math.min(...sideBokser.map(b => b.min.y));
  const annen = akse === "x" ? "z" : "x";
  const av = pkt.map(p => p[annen]);
  const STOR = 1e9;
  const min = { x: 0, y: bunn === null ? -STOR : bunn, z: 0 };
  const max = { x: 0, y: topp === null ? STOR : topp, z: 0 };
  min[akse] = g[0]; max[akse] = g[1];
  min[annen] = Math.min(...av) - SLARK; max[annen] = Math.max(...av) + SLARK;
  if (max.y <= min.y) return { feil: "hoyde" };
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
}

// SW-nummereringen: hver unik lengde×høyde (innenfor SW_TOL_MM) får et nummer.
// Sortert på lengde, så høyde (1100 før 1000) — deterministisk, som listene.
// `elementer`: [{lengdeMm, hoydeMm, tilpasset}]. Returnerer Map "L|H" → "SW-01".
export function swNummerering(elementer) {
  const nokkel = (e) => Math.round(e.lengdeMm / SW_TOL_MM) * SW_TOL_MM + "|" + e.hoydeMm;
  const unike = new Map();
  for (const e of elementer) {
    if (e.tilpasset) continue;
    const k = nokkel(e);
    if (!unike.has(k)) unike.set(k, { lengdeMm: e.lengdeMm, hoydeMm: e.hoydeMm });
  }
  const sortert = [...unike.entries()].sort((a, b) =>
    a[1].lengdeMm - b[1].lengdeMm || b[1].hoydeMm - a[1].hoydeMm);
  const ut = new Map();
  sortert.forEach(([k], i) => ut.set(k, "SW-" + String(i + 1).padStart(2, "0")));
  return { numre: ut, nokkel };
}

// Lista i Moelv-formatet, som rader til toCsv. Tilpassede biter (SW-XX) samles
// på like mål. m² = lengde × høyde × antall.
export function swListeRader(elementer, felter) {
  const f = felter || {};
  const grupper = new Map();
  for (const e of elementer) {
    const navn = e.sw || "SW-XX";
    const k = navn + "|" + Math.round(e.lengdeMm) + "|" + e.hoydeMm;
    if (!grupper.has(k)) grupper.set(k, { navn, lengdeMm: Math.round(e.lengdeMm), hoydeMm: e.hoydeMm, antall: 0 });
    grupper.get(k).antall++;
  }
  const sortert = [...grupper.values()].sort((a, b) => {
    const ax = a.navn === "SW-XX", bx = b.navn === "SW-XX";
    if (ax !== bx) return ax ? 1 : -1;         // SW-XX nederst
    return a.navn.localeCompare(b.navn, "no") || a.lengdeMm - b.lengdeMm;
  });
  const m2 = (g) => g.lengdeMm / 1000 * g.hoydeMm / 1000 * g.antall;
  const nb = (n, d) => n.toFixed(d).replace(".", ",");
  const ut = [
    ["Project", f.prosjekt || ""], ["Project nr.", f.oppdragsnr || ""],
    ["Location", f.sted || ""], ["Date", f.dato || ""], ["Sign.", f.sign || ""],
    [],
    ["Elementnr.", "Length [mm]", "Heigth [mm]", "Thickness [mm]", "Count [stk]",
     "Insulation", "Exterior Colour", "Interior Colour", "m2"]
  ];
  let sumAnt = 0, sumM2 = 0;
  for (const g of sortert) {
    sumAnt += g.antall; sumM2 += m2(g);
    ut.push([g.navn, g.lengdeMm, g.hoydeMm, f.tykkelseMm || "", g.antall,
      f.isolasjon || "", f.utvFarge || "", f.innFarge || "", nb(m2(g), 1)]);
  }
  ut.push(["Total", "", "", f.tykkelseMm || "", sumAnt, f.isolasjon || "",
    f.utvFarge || "", f.innFarge || "", nb(sumM2, 1)]);
  return ut;
}

// ═══════════════════ MODELLEN: søyler, fasader, utsparinger ═══════════════════

const tilScene = (mm) => (Number(mm) || 0) / 1000 / (S.enhetSkala || 1);
const tilMm = (u) => (Number(u) || 0) * (S.enhetSkala || 1) * 1000;

// Søylene: IfcColumn-elementer, slått sammen når de står i samme punkt
// (søyle + søyleforlenger er ofte to elementer oppå hverandre — de er ÉN
// søyle for oss, med samlet topp og bunn).
function soyleTypeNavn(id) {
  if (S.glbActive) {   // 💾 lett kopi: typen ligger i glbProps, ikke i IFC-tråden
    const p = S.glbProps && S.glbProps.get(id);
    return p ? String(p[2] || "").replace(/^Ifc/i, "") : "";
  }
  const m = metaFor(id);
  return m ? m.typeName : "";
}

async function hentSoyler() {
  if (!S.glbActive) await sikreMeta(alleElementIder);
  const bokser = allElementBoxes();
  const rå = [];
  for (const [id, b] of bokser) {
    if (soyleTypeNavn(id) !== "Column") continue;
    rå.push({ cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2,
      minY: b.min.y, maxY: b.max.y,
      bx: b.max.x - b.min.x, bz: b.max.z - b.min.z,
      bredde: Math.min(b.max.x - b.min.x, b.max.z - b.min.z) });
  }
  const tol = 0.15 / (S.enhetSkala || 1);   // 15 cm: samme punkt = samme søyle
  const ut = [];
  for (const s of rå) {
    const treff = ut.find(u => Math.hypot(u.cx - s.cx, u.cz - s.cz) < tol);
    if (treff) {
      treff.minY = Math.min(treff.minY, s.minY);
      treff.maxY = Math.max(treff.maxY, s.maxY);
      treff.bredde = Math.max(treff.bredde, s.bredde);
      treff.bx = Math.max(treff.bx, s.bx);
      treff.bz = Math.max(treff.bz, s.bz);
    } else ut.push({ ...s });
  }
  return ut;
}

// Fasadene: kantene i det konvekse hullet av søylesentrene. Hver fasade får
// søylene sine (innenfor en søylebredde fra kantlinja), sortert langs kanten,
// pluss utover-normalen (bort fra tyngdepunktet) og toppen av forlengerne.
export function fasaderFra(soyler, tolScene) {
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  if (hull.length < 2) return [];
  const cx = hull.reduce((a, p) => a + p.x, 0) / hull.length;
  const cz = hull.reduce((a, p) => a + p.z, 0) / hull.length;
  const ut = [];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ex = dx / len, ez = dz / len;
    let nx = ez, nz = -ex;   // normalens fortegn rettes mot tyngdepunktet under
    if ((p.x - cx) * nx + (p.z - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const paKant = [];
    for (const s of soyler) {
      const tt = (s.cx - p.x) * ex + (s.cz - p.z) * ez;
      const avst = Math.abs((s.cx - p.x) * nx + (s.cz - p.z) * nz);
      if (avst <= tolScene && tt >= -tolScene && tt <= len + tolScene)
        paKant.push({ s, t: tt });
    }
    paKant.sort((a, b) => a.t - b.t);
    if (paKant.length < 2) continue;
    ut.push({
      p, ex, ez, nx, nz,
      soyler: paKant,
      toppY: Math.max(...paKant.map(k => k.s.maxY)),
      kolBredde: paKant.map(k => k.s.bredde).sort((a, b) => a - b)[Math.floor(paKant.length / 2)]
    });
  }
  return ut;
}

// Utsparingene: boksene brukeren har lagt til fra valgte elementer
// (oppsett.utsparinger = [{navn, min:[x,y,z], max:[x,y,z]}]), projisert inn
// på fasaden. Returnerer [{fraMm, tilMm_, bunnMm, toppMm}] relativt til
// fasadestart/SW-basen.
function utsparingerPaFasade(fasade, baseY, liste) {
  const ut = [];
  for (const u of liste || []) {
    if (!u || !u.min || !u.max) continue;
    // hvilken vegg utsparingen hører til er alt avgjort (utspPerFasade i
    // generer) — her projiseres den bare inn på fasadeaksen
    const ts = [];
    for (const px of [u.min[0], u.max[0]]) for (const pz of [u.min[2], u.max[2]])
      ts.push((px - fasade.p.x) * fasade.ex + (pz - fasade.p.z) * fasade.ez);
    ut.push({
      fraMm: tilMm(Math.min(...ts)), tilMm_: tilMm(Math.max(...ts)),
      bunnMm: tilMm(u.min[1] - baseY), toppMm: tilMm(u.max[1] - baseY)
    });
  }
  return ut;
}

// ═══════════════════ GENERERINGEN ═══════════════════

// Alt som tegnes bor i én gruppe, og alt som er generert lagres som rene tall
// per modellfil — da kan det tegnes opp igjen uten å regne på nytt.
export const swGroup = new THREE.Group();
scene.add(swGroup);

function lagringsNokkel() { return "storm-ifc-sw::" + S.fileName; }

let lagret = null;   // { oppsett, vegger, gulv, ringmur, materiellIder }

function lesLagret() {
  try { return JSON.parse(localStorage.getItem(lagringsNokkel()) || "null"); }
  catch (_) { return null; }
}

function skrivLagret() {
  try {
    if (lagret) localStorage.setItem(lagringsNokkel(), JSON.stringify(lagret));
    else localStorage.removeItem(lagringsNokkel());
  } catch (_) {}
}

const STD_OPPSETT = {
  betongMm: 200, isoMm: 300, utstikkMm: 200,
  ringmur: false, ringHoydeMm: 500, tykkelseMm: 120,
  farge: "#dfe5ec", isolasjon: "PIR", utvFarge: "RAL 1015", innFarge: "9010",
  prosjekt: "", oppdragsnr: "", sted: "", sign: "",
  utsparinger: []   // [{navn, min:[x,y,z], max:[x,y,z]}] fra valgte elementer
};

function oppsett() {
  if (!lagret) lagret = lesLagret() || { oppsett: { ...STD_OPPSETT }, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  if (!lagret.oppsett) lagret.oppsett = { ...STD_OPPSETT };
  return lagret.oppsett;
}

// ---------- Tegning ----------
function ryddTegning() {
  swGroup.children.slice().forEach(o => {
    o.traverse(m => {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    swGroup.remove(o);
  });
}

function boks(farge, opacity) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
  return m;
}

// Tegner alt fra de lagrede tallene. Vegger: {x,y,z,rot,lengdeMm,hoydeMm,tMm,sw,tilpasset}
function tegnAlt() {
  ryddTegning();
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  if (lagret.gulv) {
    const g = lagret.gulv;
    const betong = boks("#9aa3ad", 1);
    betong.scale.set(g.bredde, tilScene(o.betongMm), g.dybde);
    betong.position.set(g.x, g.topp - tilScene(o.betongMm) / 2, g.z);
    swGroup.add(betong);
    if (o.isoMm > 0) {
      const iso = boks("#e8e4da", 1);
      iso.scale.set(g.bredde, tilScene(o.isoMm), g.dybde);
      iso.position.set(g.x, g.topp - tilScene(o.betongMm) - tilScene(o.isoMm) / 2, g.z);
      swGroup.add(iso);
    }
  }
  for (const r of lagret.ringmur || []) {
    const m = boks("#8a8f98", 1);
    m.scale.set(r.lengde, r.hoyde, r.tykkelse);
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.rot;
    swGroup.add(m);
  }
  // Elementene tegnes som EKTE SANDWICHPANELER — samme oppskrift som
  // materiell-modellen Emil pekte på (runde 3): lys isolasjonskjerne synlig i
  // endene, og et tynt blikk med mikroprofil i elementfargen på begge sider.
  // Panelet bygges liggende (samme akser som materiell) og reises opp 90°.
  const farge = o.farge || "#dfe5ec";
  const fargeMat = new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
  const kjerneMat = new THREE.MeshLambertMaterial({ color: "#e8e4da", side: THREE.DoubleSide });
  const mal = MALTYPER.sandwich;
  const visLapper = (lagret.vegger || []).length <= 400;   // tusenvis av lapper kveler bilderaten
  for (const v of lagret.vegger || []) {
    const el = new THREE.Group();
    const inner = new THREE.Group();
    const kjerne = new THREE.Mesh(new THREE.BoxGeometry(
      tilScene(Math.max(v.lengdeMm - 4, 10)), tilScene(Math.max(v.tMm - 8, 10)), tilScene(Math.max(v.hoydeMm - 4, 10))), kjerneMat);
    kjerne.position.y = mmTilScene(v.tMm / 2);
    inner.add(kjerne);
    const profS = trpProfil(v.hoydeMm, mal.deling, mal.profilHoyde)
      .map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    const lag = () => {
      const pos = ribbonPosisjoner(profS, mmTilScene(v.lengdeMm));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, fargeMat);
    };
    const ytter = lag();
    ytter.position.y = mmTilScene(v.tMm - mal.profilHoyde);
    const indre = lag();
    indre.scale.y = -1;
    indre.position.y = mmTilScene(mal.profilHoyde);
    inner.add(ytter, indre);
    inner.rotation.x = -Math.PI / 2;          // reis panelet: høyden opp
    inner.position.z = tilScene(v.tMm) / 2;   // tykkelsen sentrert om veggplanet
    el.add(inner);
    el.position.set(v.x, v.y, v.z);
    el.rotation.y = v.rot;
    el.userData.sw = v.sw;
    swGroup.add(el);
    // 🏷 SW-nummer i øvre hjørne + dimensjon i midten — som på Moelv-tegningen
    // og Lørenskog-skjermbildene. Konstant skjermstørrelse (updateScreenScaled).
    if (visLapper) {
      const ex = Math.cos(v.rot), ez = -Math.sin(v.rot);
      // Teksten SITTER PÅ ELEMENTFLATEN som på tegningene — flate dekaler
      // limt 10 mm utenpå ytterhuden, i veggens plan, med dybdetest. Ikke
      // svevende skjermlapper (Emils runde 4 og 5): de fløt over alt og ble
      // uleselige. Dekalene har fast FYSISK størrelse og følger veggen.
      const nx = v.nx !== undefined ? v.nx : Math.sin(v.rot);
      const nz = v.nz !== undefined ? v.nz : Math.cos(v.rot);
      const nv = new THREE.Vector3(nx, 0, nz).normalize();
      const utD = tilScene(v.tMm) / 2 + 0.01 / (S.enhetSkala || 1);
      const L = tilScene(v.lengdeMm), H = tilScene(v.hoydeMm);
      const sw = tekstDekal(v.sw, 220, L * 0.45);
      sw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
      sw.position.set(
        v.x - ex * L * 0.32 + nv.x * utD,
        v.y + H * 0.24,
        v.z - ez * L * 0.32 + nv.z * utD);
      swGroup.add(sw);
      const dim = tekstDekal(v.lengdeMm + "×" + v.hoydeMm + "MM", 150, L * 0.6);
      dim.quaternion.copy(sw.quaternion);
      dim.position.set(v.x + nv.x * utD, v.y - H * 0.1, v.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
}

// ---------- 🏷 Tekst-dekaler: flate skilt limt på elementflaten ----------
// Hvit boks med sort tekst, som elementmerkene på Moelv-tegningen. Teksturen
// caches per tekst (SW-03 går igjen hundrevis av ganger); materialet og
// geometrien er per dekal og ryddes av ryddTegning.
const dekalCache = new Map();

function dekalTekstur(tekst) {
  if (dekalCache.has(tekst)) return dekalCache.get(tekst);
  const pad = 16, fs = 64;
  const mc = document.createElement("canvas").getContext("2d");
  mc.font = "bold " + fs + "px sans-serif";
  const w = Math.ceil(mc.measureText(tekst).width + pad * 2);
  const c = document.createElement("canvas");
  c.width = w; c.height = fs + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#11161d"; ctx.lineWidth = 5; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  ctx.font = "bold " + fs + "px sans-serif";
  ctx.fillStyle = "#11161d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tekst, c.width / 2, c.height / 2 + 2);
  const ut = { tex: new THREE.CanvasTexture(c), aspect: c.width / c.height };
  dekalCache.set(tekst, ut);
  return ut;
}

// hoydeMm = ønsket skilthøyde i mm; maksBredde (sceneenheter) krymper skiltet
// så det aldri stikker utenfor elementet det sitter på.
function tekstDekal(tekst, hoydeMm, maksBredde) {
  const { tex, aspect } = dekalTekstur(tekst);
  let h = tilScene(hoydeMm), w = h * aspect;
  if (maksBredde > 0 && w > maksBredde) { const k = maksBredde / w; w *= k; h *= k; }
  return new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ map: tex }));
}

// Kalles av afterLoad (ifc.js) når en modell er åpnet, og av clearModel når
// den lukkes — samme kroker som materiell og grupper bruker.
S.lastSW = () => { lagret = lesLagret(); tegnAlt(); };
S.ryddSW = () => { lagret = null; ryddTegning(); };

// ---------- Selve genereringen ----------
async function generer() {
  const o = oppsett();
  const soyler = await hentSoyler();
  if (soyler.length < 3) {
    alert(t("Fant bare {0} søyler (IfcColumn) i modellen — trenger minst 3 for å finne fasadene.", soyler.length));
    return;
  }
  const kolTol = Math.max(0.3 / (S.enhetSkala || 1), soyler[0].bredde * 2);
  const fasader = fasaderFra(soyler, kolTol);
  if (!fasader.length) { alert(t("Fant ingen fasader å sette veggelementer på.")); return; }

  const okBetong = Math.min(...soyler.map(s => s.minY));   // OK betong = bunn av søylene
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;                           // SW starter på gulv eller ringmur
  const tS = tilScene(o.tykkelseMm);

  // Gulvet: søylenes utstrekning + utstikk, OK betong øverst
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  const minX = Math.min(...hull.map(p => p.x)), maxX = Math.max(...hull.map(p => p.x));
  const minZ = Math.min(...hull.map(p => p.z)), maxZ = Math.max(...hull.map(p => p.z));
  const ut = tilScene(o.utstikkMm);
  const gulv = {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, topp: okBetong,
    bredde: maxX - minX + 2 * ut, dybde: maxZ - minZ + 2 * ut
  };

  // Hver utsparing hører til ÉN vegg — den fasaden senteret ligger nærmest
  // (Emils runde 6: en åpning nær et hjørne skal aldri kappe naboveggen).
  const utspPerFasade = new Map();
  for (const u of (o.utsparinger || [])) {
    if (!u || !u.min) continue;
    const cx = (u.min[0] + u.max[0]) / 2, cz = (u.min[2] + u.max[2]) / 2;
    let besteFi = -1, besteAvst = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      const tt = (cx - f.p.x) * f.ex + (cz - f.p.z) * f.ez;
      const len = f.soyler[f.soyler.length - 1].t;
      if (tt < f.soyler[0].t - 1 || tt > len + 1) continue;   // utenfor fasadens lengde
      const avst = Math.abs((cx - f.p.x) * f.nx + (cz - f.p.z) * f.nz);
      if (avst < besteAvst) { besteAvst = avst; besteFi = fi; }
    }
    if (besteFi >= 0) {
      if (!utspPerFasade.has(besteFi)) utspPerFasade.set(besteFi, []);
      utspPerFasade.get(besteFi).push(u);
    }
  }

  // Ringmur og vegger per fasade
  const ringmur = [];
  const vegger = [];
  const fasadeInfo = [];   // {off, rot} per fasade — til stabelplasseringen
  for (let fi = 0; fi < fasader.length; fi++) {
    const f = fasader[fi];
    // Veggen (og ringmuren) står FLUKT inntil utsiden av søylene. Utsiden
    // måles fra de FAKTISKE søyleboksene på fasaden — senteravvik pluss halve
    // boksen langs normalen — ikke fra en medianbredde. Da ligger elementet
    // rett på veggen selv når søylene har fotplater eller ulik størrelse
    // (Emils funn runde 2: veggene sto ikke inntil).
    let ytreFlate = 0;
    for (const k of f.soyler) {
      const lat = (k.s.cx - f.p.x) * f.nx + (k.s.cz - f.p.z) * f.nz;
      const halv = (Math.abs(f.nx) * k.s.bx + Math.abs(f.nz) * k.s.bz) / 2;
      ytreFlate = Math.max(ytreFlate, lat + halv);
    }
    const off = ytreFlate + tS / 2;
    const midt = (tMid, y) => ({
      x: f.p.x + f.ex * tMid + f.nx * off,
      z: f.p.z + f.ez * tMid + f.nz * off,
      y
    });
    const rot = Math.atan2(-f.ez, f.ex);
    fasadeInfo.push({ off, rot });
    // SØYLEFORLENGERNE BESTEMMER SKJØTENE (Emils regel runde 5): bare søyler
    // som når helt til TOPPEN av fasaden deler veggen i spenn. Korte
    // tilleggssøyler og losholter rundt utsparinger når aldri toppen, og kan
    // dermed aldri bli misforstått som skjøtepunkter — mens forlengerne over
    // portene gir skjøt på riktig plass.
    const toppTol = 0.8 / (S.enhetSkala || 1);
    const toppS = f.soyler.filter(k => k.s.maxY >= f.toppY - toppTol);
    const spennSoyler = toppS.length >= 2 ? toppS : f.soyler;
    const t0 = spennSoyler[0].t, t1 = spennSoyler[spennSoyler.length - 1].t;
    const toppMm = tilMm(f.toppY - baseY);
    const { rader, kappMm } = radMiks(toppMm);
    const alleRader = rader.concat(kappMm ? [kappMm] : []);
    const apninger = utsparingerPaFasade(f, baseY, utspPerFasade.get(fi) || []);
    // HJØRNENE gjøres som på Moelv-tegningen: hver fasade LØPER FORBI hjørnet
    // i sin sluttende (dekker naboveggens endeflate, helt ut til ytterhjørnet),
    // og starter FLUKT mot innsiden av forrige fasades vegg. Rundt bygget gir
    // det pinwheel-hjørner — ett element stikker forbi i hvert hjørne, aldri to.
    const offMm = tilMm(off);
    const hjFraMm = tilMm(t0) - offMm + o.tykkelseMm / 2;   // start: mot naboens innside
    const hjTilMm = tilMm(t1) + offMm + o.tykkelseMm / 2;   // slutt: forbi, til ytterhjørnet
    if (o.ringmur) {
      // Ringmuren kappes der en utsparing går til bunns (porter) — Emils
      // runde 6. bunnMm er relativt SW-basen (topp ringmur), så «når ned til
      // ringmuren» = bunn under −(ringmurhøyde − 10 cm). Vinduer rører den ikke.
      const rKutt = apninger
        .filter(a => a.bunnMm <= -tilMm(ringH) + 100)
        .map(a => [a.fraMm, a.tilMm_]);
      for (const [rFra, rTil] of delOppMedUtsparinger(hjFraMm, hjTilMm, rKutt)) {
        const pR = midt(tilScene((rFra + rTil) / 2), 0);
        ringmur.push({ x: pR.x, z: pR.z,
          y: okBetong + (ringH - tilScene(o.betongMm + o.isoMm)) / 2,
          lengde: tilScene(rTil - rFra),
          hoyde: ringH + tilScene(o.betongMm + o.isoMm),   // fra gulvets underkant og opp
          tykkelse: tS, rot });
      }
    }
    let bunnMm = 0;
    for (const radH of alleRader) {
      const tilpassetRad = kappMm > 0 && radH === kappMm && radH !== 1000 && radH !== 1100;
      const rBunn = bunnMm, rTopp = bunnMm + radH;
      // åpningene som faktisk kutter denne raden (mer enn 1 cm overlapp)
      const kutt = apninger
        .filter(a => Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) > 10)
        .map(a => [a.fraMm, a.tilMm_]);
      for (let i = 0; i < spennSoyler.length - 1; i++) {
        const sFra = i === 0 ? hjFraMm : tilMm(spennSoyler[i].t) + SW_KLARING_MM;
        const sTil = i === spennSoyler.length - 2 ? hjTilMm : tilMm(spennSoyler[i + 1].t) - SW_KLARING_MM;
        const fullMm = sTil - sFra;
        if (fullMm < SW_MIN_BIT_MM) continue;
        for (const [bFra, bTil] of delOppMedUtsparinger(sFra, sTil, kutt)) {
          const lengdeMm = bTil - bFra;
          const tMid = tilScene((bFra + bTil) / 2);
          const p = midt(tMid, baseY + tilScene(rBunn + radH / 2));
          vegger.push({
            x: p.x, y: p.y, z: p.z, rot, fi, tMid, nx: f.nx, nz: f.nz,
            lengdeMm: Math.round(lengdeMm), hoydeMm: radH, tMm: o.tykkelseMm,
            // kapp: rad-kapp, bit kappet av utsparing, ELLER kortere enn 2 m —
            // alt under 2000 mm er kapp og heter SW-XX (Emils regel runde 3)
            tilpasset: tilpassetRad || lengdeMm < fullMm - SW_TOL_MM || lengdeMm < SW_KAPP_UNDER_MM
          });
        }
      }
      bunnMm = rTopp;
    }
  }
  if (!vegger.length) { alert(t("Ingen veggelementer ble generert — sjekk at modellen har søyler med høyde.")); return; }

  // SW-numrene
  const { numre, nokkel } = swNummerering(vegger);
  for (const v of vegger) v.sw = v.tilpasset ? "SW-XX" : (numre.get(nokkel(v)) || "SW-XX");

  // 📦 Leveransestablene i Materiell: én stabel per SW-nummer (Emils valg:
  // begge deler — vegg på plass OG stabler). Forrige generering ryddes først.
  fjernGenerertMateriell();
  const perSw = new Map();
  for (const v of vegger) {
    if (v.sw === "SW-XX") continue;
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm, antall: 0, fi: v.fi, tSum: 0 });
    const g = perSw.get(v.sw);
    g.antall++;
    g.tSum += v.tMid;
  }
  // Stablene settes UTENFOR FASADEN der elementene skal monteres (Emils runde
  // 3): hver SW plasseres ved tyngdepunktet sitt langs sin fasade, parallelt
  // med veggen, og flere SW-er på samme fasade legges i rader utover. Kan
  // etterpå flyttes for hånd med Flytt-knappen i materiell.
  const nyeIder = [];
  const fasadeRad = new Map();
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const f = fasader[g.fi] || fasader[0];
    const info = fasadeInfo[g.fi] || fasadeInfo[0] || { off: 0, rot: 0 };
    const rad = fasadeRad.get(g.fi) || 0;
    fasadeRad.set(g.fi, rad + 1);
    const ut = info.off + tilScene(5000) + rad * tilScene(g.hoydeMm + 1500);
    const tSpenn = f.soyler[f.soyler.length - 1].t - f.soyler[0].t;
    const tMid = Math.max(f.soyler[0].t + tilScene(g.lengdeMm) / 2,
      Math.min(f.soyler[0].t + tSpenn - tilScene(g.lengdeMm) / 2, g.tSum / g.antall));
    const p = vaskMateriell({
      id: "SW-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw, farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: o.tykkelseMm,
      antall: g.antall,
      x: f.p.x + f.ex * tMid + f.nx * ut,
      y: okBetong,
      z: f.p.z + f.ez * tMid + f.nz * ut,
      rot: info.rot
    });
    if (p) { nyeIder.push(p.id); S.materiell = (S.materiell || []).concat([p]); }
  }
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;

  lagret = { oppsett: o, vegger, gulv, ringmur, materiellIder: nyeIder };
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

function fjernGenerertMateriell() {
  // Fjerner både de id-sporede stablene fra forrige generering OG alle
  // sandwich-stabler med SW-nummer-navn: tidligere versjoner sporet ikke
  // id-ene, og de gamle stablene ble liggende igjen for hver generering —
  // det var derfor 3D-en fløt over av SW-stabler fra gamle kjøringer
  // (avlest rett fra localStorage i nettleseren, 01.09).
  const ider = new Set((lagret && lagret.materiellIder) || []);
  const generertNavn = /^SW-\d{2}$/;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(p =>
    !ider.has(p.id) && !(p.maltype === "sandwich" && generertNavn.test(p.navn || "")));
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

function fjernAltGenerert() {
  fjernGenerertMateriell();
  const o = oppsett();
  lagret = { oppsett: o, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

// ---------- CSV ----------
function lastNedListe() {
  if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
  const o = lagret.oppsett;
  const rader = swListeRader(lagret.vegger, {
    prosjekt: o.prosjekt, oppdragsnr: o.oppdragsnr, sted: o.sted, sign: o.sign,
    dato: new Date().toLocaleDateString("no-NO"),
    tykkelseMm: o.tykkelseMm, isolasjon: o.isolasjon,
    utvFarge: o.utvFarge, innFarge: o.innFarge
  });
  const blob = new Blob(["﻿" + toCsv(rader)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "") + " - SW-liste.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- Panelet ----------
function felt(id, label, verdi, type) {
  return '<label>' + t(label) +
    '<input type="' + (type || "number") + '" id="' + id + '" value="' + esc(String(verdi)) + '"' +
    (type === "text" ? ' maxlength="60"' : ' step="10" min="0" max="30000"') + '></label>';
}

function lesOppsettFraPanel() {
  const o = oppsett();
  const num = (id, std) => { const n = Number(($(id) || {}).value); return isFinite(n) && n >= 0 ? n : std; };
  const txt = (id) => (($(id) || {}).value || "").trim();
  o.betongMm = num("swBetong", o.betongMm);
  o.isoMm = num("swIso", o.isoMm);
  o.utstikkMm = num("swUtstikk", o.utstikkMm);
  o.ringmur = !!($("swRingmur") || {}).checked;
  o.ringHoydeMm = num("swRingH", o.ringHoydeMm);
  o.tykkelseMm = Math.max(30, Math.min(500, num("swTykk", o.tykkelseMm)));
  o.farge = ($("swFarge") || {}).value || o.farge;
  o.isolasjon = txt("swIsoType") || o.isolasjon;
  o.utvFarge = txt("swUtvF");
  o.innFarge = txt("swInnF");
  o.prosjekt = txt("swProsjekt");
  o.oppdragsnr = txt("swOppdrag");
  o.sted = txt("swSted");
  o.sign = txt("swSign");
  skrivLagret();
  return o;
}

// ---------- 🎯 Marker utsparing: trykk på FLATENE rundt åpningen ----------
// Emils regel (runde 3): trykk på ÉN flate per side — innsiden av søylene på
// hver side, undersiden av bjelken over, evt. oversiden av en bjelke under.
// Hvert trykk gir treffpunkt + flatenormal; utsparingFraFlater regner boksen.
// Kameraet virker som vanlig underveis (bare selve KLIKKET fanges), og små
// markører viser hvilke flater som er valgt.
let utspMark = null;   // { flater: [], ned: {x,y}, prikker: Group } når aktiv

function utspBarEl() {
  let el = $("swUtspBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swUtspBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function tegnUtspBar() {
  const el = utspBarEl();
  if (!utspMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML =
    '<span style="font-size:12px;max-width:340px">' +
    t("Trykk på flatene rundt åpningene: innsiden av søylene på sidene, undersiden av bjelken over. Én flate per side — du kan markere flere åpninger før Ferdig.") +
    ' <b>' + t("{0} flater valgt", utspMark.flater.length) + '</b></span>' +
    '<button id="swUtspFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>' +
    '<button id="swUtspAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
  $("swUtspFerdig").onclick = fullforUtspMark;
  $("swUtspAvbryt").onclick = () => avsluttUtspMark();
}

function startUtspMark() {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  const prikker = new THREE.Group();
  swGroup.add(prikker);
  utspMark = { flater: [], ned: null, prikker };
  $("swPanel").classList.remove("open");   // panelet i veien for modellen
  tegnUtspBar();
}

function avsluttUtspMark() {
  if (!utspMark) return;
  utspMark.prikker.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(utspMark.prikker);
  utspMark = null;
  tegnUtspBar();
  tegnPanel();
  apnePanel("swPanel");
}

function fullforUtspMark() {
  if (!utspMark) return;
  const e = S.enhetSkala || 1;
  // flater innenfor 4 m hører til samme åpning — da kan alle åpningene
  // markeres i én omgang og Ferdig trykkes til slutt (Emils runde 5)
  const klynger = grupperFlater(utspMark.flater, 4.0 / e);
  const o = oppsett();
  o.utsparinger = (o.utsparinger || []).filter(x => x && x.min);   // gamle formater ryddes
  let lagt = 0, feilet = 0;
  for (const kl of klynger) {
    const u = utsparingFraFlater(kl, 0.5 / e);
    if (u.feil) { feilet++; continue; }
    lagt++;
    o.utsparinger.push({ navn: t("Utsparing {0}", o.utsparinger.length + 1), min: u.min, max: u.max });
  }
  if (!lagt) {
    alert(t("Utsparingen trenger to motstående sider — trykk på innsiden av søylene på hver side av åpningen."));
    return;
  }
  skrivLagret();
  avsluttUtspMark();
  if (feilet) alert(t("{0} utsparinger lagt til — {1} område manglet to motstående sider og ble hoppet over.", lagt, feilet));
}

// Klikkene fanges på window i FANGSTFASEN (samme oppskrift som materiell.js):
// kameraet får dra som vanlig — bare et trykk under 8 px behandles, og da
// stoppes det FØR elementvalget i main.js ser det.
window.addEventListener("pointerdown", (e) => {
  if (!utspMark || e.button !== 0) return;
  utspMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!utspMark || e.button !== 0 || !utspMark.ned) return;
  const ned = utspMark.ned;
  utspMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  e.stopPropagation();
  // Kameraet fikk pointerdown-en (rotasjon skal virke i modusen) — svelger vi
  // pointerup-en uten å rydde, blir kameraet stående og tro at knappen holdes
  // og «låser seg i rotasjon». Samme kur som materiell.js: syntetisk
  // pointercancel, som SimpleControls håndterer fra før.
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const hit = pick(e.clientX, e.clientY);
  if (!hit || !hit.face) return;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  // IFC-geometri har ofte vilkårlig vindingsretning — normalen kan like
  // gjerne peke INN i søylen som ut. Men flata brukeren SER har alltid
  // normalen sin MOT kameraet: peker den med blikket, snus den. Det var
  // dette som ga «trenger to motstående sider» med 17 flater valgt
  // (Emils skjermbilde 01.09 18:14).
  if (n.dot(raycaster.ray.direction) > 0) n.multiplyScalar(-1);
  // elementets boks følger med: endene av markerte søyler/bjelker fyller ut
  // sidene som ikke er markert (Emils regel runde 6)
  const bid = hitID(hit);
  const bb = bid != null ? allElementBoxes().get(bid) : null;
  utspMark.flater.push({ p: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
                         n: { x: n.x, y: n.y, z: n.z },
                         boks: bb ? { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
                                      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } } : undefined });
  // hele SIDEN av elementet farges blå — som når sammenligningen farger
  // elementer, bare for én flate (Emils runde 4). Flaten finnes fra
  // elementets boks: kvadranten som normalen peker ut av.
  utspMark.prikker.add(byggFlateMerke(hit, n));
  tegnUtspBar();
}, true);

// Blå, halvgjennomsiktig plate lagt oppå siden brukeren trykket på.
function byggFlateMerke(hit, n) {
  const id = hitID(hit);
  const b = id != null ? allElementBoxes().get(id) : null;
  const løft = 0.015 / (S.enhetSkala || 1);   // 15 mm ut, mot z-fighting
  let w = 0.4 / (S.enhetSkala || 1), h = w;
  const senter = hit.point.clone();
  if (b) {
    const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? "x"
      : Math.abs(n.y) >= Math.abs(n.z) ? "y" : "z";
    if (ax === "x") { w = b.max.z - b.min.z; h = b.max.y - b.min.y; }
    else if (ax === "y") { w = b.max.x - b.min.x; h = b.max.z - b.min.z; }
    else { w = b.max.x - b.min.x; h = b.max.y - b.min.y; }
    senter.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    senter[ax] = n[ax] >= 0 ? b.max[ax] : b.min[ax];
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false }));
  const nv = new THREE.Vector3(n.x, n.y, n.z).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
  m.position.copy(senter).addScaledVector(nv, løft);
  m.renderOrder = 997;
  return m;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && utspMark) { e.stopPropagation(); avsluttUtspMark(); }
}, true);

function tegnPanel() {
  const body = $("swBody");
  if (!body) return;
  const o = oppsett();
  const antall = (lagret && lagret.vegger || []).length;
  const utsp = (o.utsparinger || []).filter(u => u && u.min);
  body.innerHTML =
    '<h4 style="margin:0 0 4px">' + t("Gulv") + '</h4>' +
    felt("swBetong", "Betong (mm)", o.betongMm) +
    felt("swIso", "Isolasjon (mm)", o.isoMm) +
    felt("swUtstikk", "Utstikk forbi søylene (mm)", o.utstikkMm) +
    '<p style="color:var(--muted);font-size:11px;margin:4px 0">' +
      t("Overkant betong settes automatisk til bunnen av søylene.") + '</p>' +
    '<h4 style="margin:10px 0 4px">' + t("Ringmur") + '</h4>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swRingmur"' +
      (o.ringmur ? " checked" : "") + '> ' + t("Med ringmur rundt stålkonstruksjonen") + '</label>' +
    felt("swRingH", "Høyde over gulv (mm)", o.ringHoydeMm) +
    '<h4 style="margin:10px 0 4px">' + t("Veggelementer") + '</h4>' +
    felt("swTykk", "Tykkelse (mm) — samme som ringmuren", o.tykkelseMm) +
    '<label>' + t("Farge") + '<input type="color" id="swFarge" value="' + esc(o.farge) + '"></label>' +
    felt("swIsoType", "Isolasjon (til lista)", o.isolasjon, "text") +
    felt("swUtvF", "Utvendig farge (til lista)", o.utvFarge, "text") +
    felt("swInnF", "Innvendig farge (til lista)", o.innFarge, "text") +
    '<h4 style="margin:10px 0 4px">' + t("Utsparinger (dører, vinduer, porter)") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Trykk «Marker utsparing», og trykk så på flatene rundt åpningen i modellen: innsiden av søylene på sidene og undersiden av bjelken over. Én flate per side.") + '</p>' +
    '<div class="prop-actions"><button id="swNyUtsp">' + ikon("boks") + ' ' + t("Marker utsparing") + '</button></div>' +
    (!utsp.length
      ? '<p style="color:var(--muted);font-size:12px">' + t("Ingen utsparinger lagt til ennå.") + '</p>'
      : utsp.map((u, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(u.navn || ("#" + (i + 1))) +
        ' <span style="color:var(--muted)">' +
        Math.round(tilMm(Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2]))) + "×" +
        (u.max[1] - u.min[1] > 1e8 ? t("full høyde") : Math.round(tilMm(u.max[1] - u.min[1])) + " mm") + "</span></div>" +
        '<div class="c"><button data-sw-slett-utsp="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")) +
    '<h4 style="margin:10px 0 4px">' + t("Til lista") + '</h4>' +
    felt("swProsjekt", "Prosjekt", o.prosjekt, "text") +
    felt("swOppdrag", "Oppdragsnummer", o.oppdragsnr, "text") +
    felt("swSted", "Sted", o.sted, "text") +
    felt("swSign", "Sign.", o.sign, "text") +
    '<div class="prop-actions" style="margin-top:10px;flex-wrap:wrap">' +
    '<button id="swGenerer" class="primary">' + ikon("boks") + ' ' + t("Generer SW + gulv/ringmur") + '</button>' +
    '<button id="swListe">' + ikon("lastned") + ' ' + t("Last ned liste (Excel/CSV)") + '</button>' +
    '<button id="swFjern">' + ikon("slett") + ' ' + t("Fjern genererte") + '</button></div>' +
    (antall ? '<p style="color:var(--muted);font-size:12px;margin-top:6px">' +
      t("{0} veggelementer generert. Stablene ligger i 📦 Materiell og telles i Mengder.", antall) + '</p>' : "");
  $("swGenerer").onclick = async () => {
    lesOppsettFraPanel();
    $("swGenerer").disabled = true;
    try { await generer(); }
    catch (err) { console.warn("SW-generator:", err); alert(t("Genereringen feilet: ") + (err && err.message || err)); }
    finally { const b = $("swGenerer"); if (b) b.disabled = false; }
  };
  $("swListe").onclick = () => { lesOppsettFraPanel(); lastNedListe(); };
  $("swFjern").onclick = () => { lesOppsettFraPanel(); fjernAltGenerert(); };
  $("swNyUtsp").onclick = () => { lesOppsettFraPanel(); startUtspMark(); };
  body.querySelectorAll("button[data-sw-slett-utsp]").forEach(b =>
    b.onclick = () => {
      lesOppsettFraPanel();
      const o2 = oppsett();
      o2.utsparinger.splice(Number(b.dataset.swSlettUtsp), 1);
      skrivLagret();
      tegnPanel();
    });
}

på("btnSW", "click", () => {
  const panel = $("swPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("swPanel");
});
