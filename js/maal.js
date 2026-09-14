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
import { frameHooks, makeLabel, scene, updateScreenScaled } from "./scene.js";
import { fmtArea, retteMaal } from "./elements.js";

// EGEN gruppe, ikke measureGroup. Målebåndet (measureGroup) er brukerens egne
// mål, de ligger i angre-historikken og skal ikke kunne bli borte fordi noen
// klikket på et annet element.
export const maalGroup = new THREE.Group();
scene.add(maalGroup);

// Lappene skal holde samme størrelse på skjermen uansett hvor stor modellen er
// – samme behandling som målebåndet får i measure.js.
frameHooks.push(() => updateScreenScaled(maalGroup));

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

  // 4. Arealet, midt på flata.
  const midt = h0.clone().add(uL.clone().multiplyScalar(0.5)).add(vB.clone().multiplyScalar(0.5));
  const arealLapp = makeLabel(fmtArea(r.areal), "#22d3ee");
  arealLapp.userData.px = 30;
  arealLapp.userData.aspect = arealLapp.scale.x / arealLapp.scale.y;
  arealLapp.position.copy(midt);
  maalGroup.add(arealLapp);

  S.maalFor = id;
  return true;
}

// Bytter du visningsenhet i ⚙ Innstillinger, er tallene på lappene brent inn i
// teksturer og ville blitt stående som de var. measure.js kaller hit når den
// tegner sine egne lapper om, og da bygges hele settet på nytt – billig, siden
// det gjelder ett element.
S.tegnMaalOm = () => { if (S.maalFor !== null && S.maalFor !== undefined) visMaal(S.maalFor); };
