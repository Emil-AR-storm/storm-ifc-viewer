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
//  · utsparinger (dører/vinduer/porter) er OMRÅDE-FIRKANTER fra markerings-
//    verktøyet som hukes av i panelet — bare de avhukede lager hull, en vanlig
//    avviksmarkering skal aldri kappe en vegg
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
import { scene } from "./scene.js";
import { allElementBoxes, toCsv } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { lagreMateriellLokalt, tegnMateriell, vaskMateriell } from "./materiell-vis.js";

// ---------- Konstanter (Emils regler) ----------
export const SW_KLARING_MM = 25;      // fra søylesenter til elementende
export const SW_HOYDER = [1100, 1000]; // radhøydene som finnes, mm
export const SW_MIN_BIT_MM = 100;     // kortere biter enn dette droppes
export const SW_TOL_MM = 5;           // to lengder innenfor dette = samme SW-nummer

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

// Utsparingene: avhukede område-firkanter, projisert inn på fasaden.
// Returnerer [{fraMm, tilMm, bunnMm, toppMm}] relativt til fasadestart/SW-basen.
function utsparingerPaFasade(fasade, baseY, valgteIder) {
  const ut = [];
  for (const c of S.comments || []) {
    const o = c.omrade;
    if (!o || o.form !== "firkant" || !valgteIder.has(String(c.id))) continue;
    // nær nok fasaden sideveis? (senteret innenfor boksens egen dybde + 1 m)
    const avst = Math.abs((o.x - fasade.p.x) * fasade.nx + (o.z - fasade.p.z) * fasade.nz);
    if (avst > Math.max(o.rx, o.rz) + 1.0 / (S.enhetSkala || 1)) continue;
    // hjørnene projisert på fasadeaksen → intervall i mm
    const ts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = o.x + sx * o.rx, pz = o.z + sz * o.rz;
      ts.push((px - fasade.p.x) * fasade.ex + (pz - fasade.p.z) * fasade.ez);
    }
    ut.push({
      fraMm: tilMm(Math.min(...ts)), tilMm_: tilMm(Math.max(...ts)),
      bunnMm: tilMm(o.y - baseY), toppMm: tilMm((o.y + (o.h || 0)) - baseY)
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
  utsparinger: []   // markering-id-er som er huket av som åpninger
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
  for (const v of lagret.vegger || []) {
    const m = boks(o.farge || "#dfe5ec", 1);
    m.scale.set(tilScene(v.lengdeMm), tilScene(v.hoydeMm), tilScene(v.tMm));
    m.position.set(v.x, v.y, v.z);
    m.rotation.y = v.rot;
    m.userData.sw = v.sw;
    swGroup.add(m);
  }
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
  const valgte = new Set((o.utsparinger || []).map(String));

  // Gulvet: søylenes utstrekning + utstikk, OK betong øverst
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  const minX = Math.min(...hull.map(p => p.x)), maxX = Math.max(...hull.map(p => p.x));
  const minZ = Math.min(...hull.map(p => p.z)), maxZ = Math.max(...hull.map(p => p.z));
  const ut = tilScene(o.utstikkMm);
  const gulv = {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, topp: okBetong,
    bredde: maxX - minX + 2 * ut, dybde: maxZ - minZ + 2 * ut
  };

  // Ringmur og vegger per fasade
  const ringmur = [];
  const vegger = [];
  for (const f of fasader) {
    // veggen (og ringmuren) står INNTIL utsiden av søylene:
    // senterlinja = søylelinja + (søylebredde/2 + tykkelse/2) utover
    const off = f.kolBredde / 2 + tS / 2;
    const midt = (tMid, y) => ({
      x: f.p.x + f.ex * tMid + f.nx * off,
      z: f.p.z + f.ez * tMid + f.nz * off,
      y
    });
    const rot = Math.atan2(-f.ez, f.ex);
    const t0 = f.soyler[0].t, t1 = f.soyler[f.soyler.length - 1].t;
    if (o.ringmur) {
      const p = midt((t0 + t1) / 2, okBetong + ringH / 2 - tilScene(o.betongMm + o.isoMm) / 2);
      ringmur.push({ x: p.x, z: p.z,
        y: okBetong + (ringH - tilScene(o.betongMm + o.isoMm)) / 2,
        lengde: (t1 - t0) + f.kolBredde + 2 * tS,   // lukker hjørnene
        hoyde: ringH + tilScene(o.betongMm + o.isoMm),   // fra gulvets underkant og opp
        tykkelse: tS, rot });
    }
    const toppMm = tilMm(f.toppY - baseY);
    const { rader, kappMm } = radMiks(toppMm);
    const alleRader = rader.concat(kappMm ? [kappMm] : []);
    const apninger = utsparingerPaFasade(f, baseY, valgte);
    let bunnMm = 0;
    for (const radH of alleRader) {
      const tilpassetRad = kappMm > 0 && radH === kappMm && radH !== 1000 && radH !== 1100;
      const rBunn = bunnMm, rTopp = bunnMm + radH;
      // åpningene som faktisk kutter denne raden (mer enn 1 cm overlapp)
      const kutt = apninger
        .filter(a => Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) > 10)
        .map(a => [a.fraMm, a.tilMm_]);
      for (let i = 0; i < f.soyler.length - 1; i++) {
        const sFra = tilMm(f.soyler[i].t) + SW_KLARING_MM;
        const sTil = tilMm(f.soyler[i + 1].t) - SW_KLARING_MM;
        const fullMm = sTil - sFra;
        if (fullMm < SW_MIN_BIT_MM) continue;
        for (const [bFra, bTil] of delOppMedUtsparinger(sFra, sTil, kutt)) {
          const lengdeMm = bTil - bFra;
          const tMid = tilScene((bFra + bTil) / 2);
          const p = midt(tMid, baseY + tilScene(rBunn + radH / 2));
          vegger.push({
            x: p.x, y: p.y, z: p.z, rot,
            lengdeMm: Math.round(lengdeMm), hoydeMm: radH, tMm: o.tykkelseMm,
            tilpasset: tilpassetRad || lengdeMm < fullMm - SW_TOL_MM
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
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm, antall: 0 });
    perSw.get(v.sw).antall++;
  }
  const nyeIder = [];
  let plassX = gulv.x + gulv.bredde / 2 + tilScene(3000);
  const plassZ = gulv.z - gulv.dybde / 2;
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = vaskMateriell({
      id: "SW-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw, farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: o.tykkelseMm,
      antall: g.antall, x: plassX, y: okBetong, z: plassZ, rot: 0
    });
    if (p) { nyeIder.push(p.id); S.materiell = (S.materiell || []).concat([p]); }
    plassX += tilScene(g.lengdeMm + 1000);
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
  const ider = new Set((lagret && lagret.materiellIder) || []);
  if (!ider.size) return;
  S.materiell = (S.materiell || []).filter(p => !ider.has(p.id));
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
  o.utsparinger = [...document.querySelectorAll("#swBody input[data-sw-utsp]:checked")]
    .map(i => i.dataset.swUtsp);
  skrivLagret();
  return o;
}

function tegnPanel() {
  const body = $("swBody");
  if (!body) return;
  const o = oppsett();
  const antall = (lagret && lagret.vegger || []).length;
  // område-firkantene som kan være utsparinger
  const kandidater = (S.comments || []).filter(c => c.omrade && c.omrade.form === "firkant");
  const valgte = new Set((o.utsparinger || []).map(String));
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
    (!kandidater.length
      ? '<p style="color:var(--muted);font-size:12px">' +
        t("Ingen område-firkanter i modellen ennå. Tegn utsparingene med Markering → Firkant først — bare de du huker av her blir åpninger.") + '</p>'
      : kandidater.map(c =>
        '<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" data-sw-utsp="' + esc(String(c.id)) + '"' +
        (valgte.has(String(c.id)) ? " checked" : "") + '> ' +
        esc((c.text || "").slice(0, 40) || t("Uten tekst")) +
        ' <span style="color:var(--muted)">' +
        Math.round(tilMm(c.omrade.rx * 2)) + "×" + Math.round(tilMm(c.omrade.h || 0)) + " mm</span></label>").join("")) +
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
}

på("btnSW", "click", () => {
  const panel = $("swPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("swPanel");
});
