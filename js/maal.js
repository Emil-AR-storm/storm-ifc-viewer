// 📐 Vis mål – tegner målene på det valgte elementet rett i 3D.
//
// HVA DEN TEGNER OG HVORFOR NETTOPP DET.
// Tallene i egenskapspanelet sier ingenting om HVILKEN vei de er målt. Står det
// «2,4 × 0,2 × 3,0 m» på en vegg, må du selv gjette hva som er lengde og hva
// som er tykkelse – og gjetter du feil når du bestiller, er feilen dyr. Derfor
// legges de tre målene på selve elementet, langs den kanten de faktisk gjelder,
// sammen med flata arealet er regnet av.
//
// Målene retter seg etter STØRSTE FLATE (se retteMaal i elements.js), ikke etter
// modellens akser. En vegg som står på skrå får derfor lengden langs veggen og
// ikke langs X.
//
// Det tegnes for ETT element om gangen. To sett mål oppå hverandre er ikke til
// hjelp for noen, og et sett som blir stående igjen på et element du ikke lenger
// har valgt, er verre enn ingen mål: clearSelection() i elements.js rydder dem.
import * as THREE from "three";
import { dec, S } from "./state.js";
import { t } from "./i18n.js";
import { frameHooks, makeLabel, scene, updateScreenScaled } from "./scene.js";
import { fmtArea, fmtVol, quantitiesForSet, retteMaal } from "./elements.js";
import { forskyvLapper, meldMaalLapper, settForskyvning, vinkelGrader } from "./maal-verktoy.js";

// EGEN gruppe, ikke measureGroup. Målebåndet (measureGroup) er brukerens egne
// mål, de ligger i angre-historikken og skal ikke kunne bli borte fordi noen
// klikket på et annet element.
export const maalGroup = new THREE.Group();
scene.add(maalGroup);

// Lappene skal holde samme størrelse på skjermen uansett hvor stor modellen er
// – samme behandling som målebåndet får i measure.js.
frameHooks.push(() => updateScreenScaled(maalGroup));
// 🏷 Lappene som skal stå et stykke unna punktet sitt (areal, volum, vinkler)
// flyttes på plass i skjermpiksler, og alle lappene viker for hverandre
// (lapp-kollisjonen i scene.js) — samme løsning som materiell-lappene fikk
// (Emil 05.10: «boksene ikke ligger oppå hverandre og står i veien»).
frameHooks.push(() => { forskyvLapper(maalGroup); meldMaalLapper(maalGroup, 0); });

const FARGE = 0xf59e0b;        // samme oransje som målebåndet
const FARGE_TEKST = "#f59e0b";
const FARGE_FLATE = 0x22d3ee;  // flata arealet er regnet av – tydelig forskjellig fra målene

// Metertall med samme antall desimaler som resten av panelet (⚙ Innstillinger).
function fmtM(m) { return m.toFixed(dec()) + " m"; }

function lagLinje(p1, p2, farge) {
  const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: farge, depthTest: false }));
  l.renderOrder = 997;
  return l;
}

// Et mål: strek med korte tverrstreker i endene, og en lapp på midten.
// Tverrstrekene gjør det utvetydig hvor målet begynner og slutter – uten dem
// ser en strek langs en kant ut som en del av modellen.
function lagMaal(p1, p2, tekst, tvers) {
  const ut = [lagLinje(p1, p2, FARGE)];
  const h = tvers.clone().multiplyScalar(p1.distanceTo(p2) * 0.03);
  ut.push(lagLinje(p1.clone().sub(h), p1.clone().add(h), FARGE));
  ut.push(lagLinje(p2.clone().sub(h), p2.clone().add(h), FARGE));
  const lapp = makeLabel(tekst, FARGE_TEKST);
  lapp.userData.px = 26;
  lapp.userData.maalLapp = true;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  lapp.position.copy(p1).add(p2).multiplyScalar(0.5);
  ut.push(lapp);
  return ut;
}

export function skjulMaal() {
  maalGroup.children.forEach(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  maalGroup.clear();
  S.maalFor = null;
}

// Slår målene av og på for ett element. Returnerer true når de nå vises.
export function vekselMaal(id) {
  if (S.maalFor === id) { skjulMaal(); return false; }
  return visMaal(id);
}

export function visMaal(id) {
  skjulMaal();
  let r = null;
  try { r = retteMaal(id); } catch (err) { console.warn(err); }
  if (!r) return false;

  const { u, v, n, hjorne, lengde, bredde } = r.ramme;
  const L = lengde, B = bredde;                 // modellenheter
  const uL = u.clone().multiplyScalar(L);
  const vB = v.clone().multiplyScalar(B);
  // de fire hjørnene av rammen rundt flata
  const h0 = hjorne.clone();
  const h1 = h0.clone().add(uL);
  const h2 = h0.clone().add(uL).add(vB);
  const h3 = h0.clone().add(vB);

  // 1. Flata arealet er regnet av – de ekte trekantene, ikke rammen. Da ser du
  //    at en døråpning er trukket fra, i stedet for å måtte tro på tallet.
  const pk = r.plan.pk;
  if (pk.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pk), 3));
    const flate = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: FARGE_FLATE, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    }));
    flate.renderOrder = 995;
    maalGroup.add(flate);
  }

  // 2. Rammen rundt flata – stiplet ville vært finere, men en tynn heltrukket
  //    linje leses like godt og koster ingen ekstra geometri.
  maalGroup.add(lagLinje(h0, h1, FARGE_FLATE), lagLinje(h1, h2, FARGE_FLATE),
                lagLinje(h2, h3, FARGE_FLATE), lagLinje(h3, h0, FARGE_FLATE));

  // 3. De tre målene. Lengde og bredde legges UTENFOR rammen (8 % ut), slik at
  //    de ikke ligger oppå kanten de måler og blir umulige å lese.
  const utL = v.clone().multiplyScalar(-B * 0.08);
  const utB = u.clone().multiplyScalar(-L * 0.08);
  lagMaal(h0.clone().add(utL), h1.clone().add(utL), fmtM(r.lengde), v).forEach(o => maalGroup.add(o));
  lagMaal(h0.clone().add(utB), h3.clone().add(utB), fmtM(r.bredde), u).forEach(o => maalGroup.add(o));

  // Tykkelsen måles på tvers av flata, fra elementets ene side til den andre.
  // r.lav/r.hoy er ytterpunktene langs normalen; hjørnet ligger i planet (d),
  // så avstanden derfra er lav−d og hoy−d.
  const d = r.plan.d;
  const t1 = h1.clone().add(n.clone().multiplyScalar(r.lav - d));
  const t2 = h1.clone().add(n.clone().multiplyScalar(r.hoy - d));
  if (r.tykkelse > 0)
    lagMaal(t1, t2, fmtM(r.tykkelse), u).forEach(o => maalGroup.add(o));

  // 4. Arealet og volumet, midt på flata. På et slankt element (en bjelke)
  //    ligger lengdemålet nesten oppå midten — derfor står arealet et stykke
  //    OVER midten og volumet et stykke UNDER, målt i skjermpiksler, så det
  //    alltid er luft til lengden mellom dem uansett zoom (Emil 05.10).
  const midt = h0.clone().add(uL.clone().multiplyScalar(0.5)).add(vB.clone().multiplyScalar(0.5));
  const arealLapp = makeLabel(fmtArea(r.areal), "#22d3ee");
  arealLapp.userData.px = 26;
  arealLapp.userData.aspect = arealLapp.scale.x / arealLapp.scale.y;
  arealLapp.position.copy(midt);
  settForskyvning(arealLapp, midt, null, 56);
  maalGroup.add(arealLapp);
  let vol = 0;
  try { const q = quantitiesForSet(new Set([id])).get(id); vol = (q && q.vol) || 0; } catch (_) { vol = 0; }
  if (vol > 0) {
    const volLapp = makeLabel(fmtVol(vol), "#a78bfa");
    volLapp.userData.px = 26;
    volLapp.userData.aspect = volLapp.scale.x / volLapp.scale.y;
    volLapp.position.copy(midt);
    settForskyvning(volLapp, midt, null, -50);
    maalGroup.add(volLapp);
  }

  // 5. 📐 Vinkler i objektet (Emil 05.10): helningen på et skrått element, og
  //    hjørner i flata som ikke er rette (skråkappede ender, skrå gavler).
  vinklerI(r, h0, u, v, L, B);

  S.maalFor = id;
  return true;
}

// ---------- 📐 Vinklene ----------
const FARGE_VINKEL = 0xfbbf24, FARGE_VINKEL_TEKST = "#fbbf24";
const fmtGr = (g) => g.toFixed(1).replace(".", ",") + "°";

// Helningen mot vannrett for en retning (grader, 0–90). y er høyde.
export function helningGrader(dir) {
  const l = Math.hypot(dir.x, dir.y, dir.z);
  return l > 0 ? Math.asin(Math.min(1, Math.abs(dir.y) / l)) * 180 / Math.PI : 0;
}
const skraa = (g) => g > 0.5 && g < 89.5;

// Hjørnene i flata (de ekte trekantene, pk) som ikke er rette. Kantene som
// bare hører til én trekant er omrisset; et hjørne er et punkt med to slike
// kanter. 180° (et punkt midt på en rett kant) og 90° hoppes over.
export function skjeveHjorner(pk, eps, minKant) {
  const nok = (i) => Math.round(pk[i] / eps) + "," + Math.round(pk[i + 1] / eps) + "," + Math.round(pk[i + 2] / eps);
  const pkt = new Map(), kanter = new Map();
  const id = (i) => { const k = nok(i); if (!pkt.has(k)) pkt.set(k, { x: pk[i], y: pk[i + 1], z: pk[i + 2] }); return k; };
  for (let i = 0; i + 8 < pk.length; i += 9) {
    const a = id(i), b = id(i + 3), c = id(i + 6);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const k = p < q ? p + "|" + q : q + "|" + p;
      kanter.set(k, (kanter.get(k) || 0) + 1);
    }
  }
  const nab = new Map();
  for (const [k, n] of kanter) {
    if (n !== 1) continue;
    const [p, q] = k.split("|");
    if (!nab.has(p)) nab.set(p, []); if (!nab.has(q)) nab.set(q, []);
    nab.get(p).push(q); nab.get(q).push(p);
  }
  const ut = [];
  for (const [k, n] of nab) {
    if (n.length !== 2) continue;
    const A = pkt.get(n[0]), P = pkt.get(k), C = pkt.get(n[1]);
    // korte kanter er en buet kant delt i biter (et rør, en rund utsparing),
    // ikke et hjørne noen har tegnet
    if (minKant && (Math.hypot(A.x - P.x, A.y - P.y, A.z - P.z) < minKant || Math.hypot(C.x - P.x, C.y - P.y, C.z - P.z) < minKant)) continue;
    const g = vinkelGrader(A, P, C);
    if (g == null || Math.abs(g - 90) < 1 || g > 175 || g < 1) continue;
    ut.push({ punkt: pkt.get(k), grader: g, a: pkt.get(n[0]), b: pkt.get(n[1]) });
  }
  return ut;
}

function vinklerI(r, h0, u, v, L, B) {
  // a) Helningen: lengderetningen først, ellers breddretningen (en takplate
  //    som ligger med lengden vannrett, men faller på tvers)
  let akse = null, len = 0;
  if (skraa(helningGrader(u))) { akse = u; len = L; }
  else if (skraa(helningGrader(v))) { akse = v; len = B; }
  if (akse) {
    const g = helningGrader(akse);
    // start i den LAVE enden, og tegn en vannrett referanse derfra
    const a0 = akse.y >= 0 ? h0.clone() : h0.clone().addScaledVector(akse, len);
    const opp = akse.y >= 0 ? akse.clone() : akse.clone().negate();
    const vann = new THREE.Vector3(opp.x, 0, opp.z).normalize();
    const ref = len * 0.3;
    const lr = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a0, a0.clone().addScaledVector(vann, ref)]),
      new THREE.LineDashedMaterial({ color: FARGE_VINKEL, depthTest: false, dashSize: ref / 12, gapSize: ref / 12 }));
    lr.computeLineDistances(); lr.renderOrder = 997;
    maalGroup.add(lr);
    const bue = [];
    for (let i = 0; i <= 16; i++) {
      const s2 = i / 16;
      bue.push(a0.clone().addScaledVector(vann.clone().lerp(opp, s2).normalize(), ref * 0.7));
    }
    const bl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bue), new THREE.LineBasicMaterial({ color: FARGE_VINKEL, depthTest: false }));
    bl.renderOrder = 997;
    maalGroup.add(bl);
    const pos = a0.clone().addScaledVector(vann.clone().add(opp).normalize(), ref * 0.9);
    const l = makeLabel(t("Helning {0}", fmtGr(g)), FARGE_VINKEL_TEKST);
    l.userData.px = 24; l.userData.aspect = l.scale.x / l.scale.y;
    l.position.copy(pos);
    settForskyvning(l, pos, null, -22);
    maalGroup.add(l);
  }
  // b) Hjørner som ikke er rette — høyst seks, så flata ikke drukner i tall
  const pk = (r.plan && r.plan.pk) || [];
  if (!pk.length) return;
  const eps = Math.max(1e-6, Math.hypot(L, B) * 1e-5);
  for (const h of skjeveHjorner(pk, eps, Math.max(L, B) * 0.05).slice(0, 6)) {
    const p = new THREE.Vector3(h.punkt.x, h.punkt.y, h.punkt.z);
    const inn = new THREE.Vector3(h.a.x, h.a.y, h.a.z).sub(p).normalize()
      .add(new THREE.Vector3(h.b.x, h.b.y, h.b.z).sub(p).normalize());
    if (inn.lengthSq() < 1e-9) continue;
    const l = makeLabel(fmtGr(h.grader), FARGE_VINKEL_TEKST);
    l.userData.px = 22; l.userData.aspect = l.scale.x / l.scale.y;
    l.position.copy(p);
    settForskyvning(l, p, inn.normalize(), 26);
    maalGroup.add(l);
  }
}

// Bytter du visningsenhet i ⚙ Innstillinger, er tallene på lappene brent inn i
// teksturer og ville blitt stående som de var. measure.js kaller hit når den
// tegner sine egne lapper om, og da bygges hele settet på nytt – billig, siden
// det gjelder ett element.
S.tegnMaalOm = () => { if (S.maalFor !== null && S.maalFor !== undefined) visMaal(S.maalFor); };
