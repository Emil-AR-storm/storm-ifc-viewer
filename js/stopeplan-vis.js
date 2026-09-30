// 🧱 Støpeplan i 3D — VISNINGEN: etappenes farger på elementene i modellen.
//
// Trinn 2 (Emil 30.09): elementene i en etappe farges i etappens farge.
//
// HVORFOR ET LAG OPPÅ, OG IKKE NYE MATERIALER PÅ MODELLEN. Materialene på
// S.modelGroup eies av display.js (typefarger, gjennomsiktig, skjuling) og
// elements.js (valg). Byttet vi dem her, ville hvert av de verktøyene måttet
// vite om støpeplanen — og slått hverandre i hjel. I stedet lages en kopi av
// trekantene til hver etappe (forHverTrekant — samme vei valget går, og den
// virker også i sammenslått geometri på byggeplassen), med etappens farge og
// dratt et hårstrå fram i dybdebufferen. Modellen under er urørt.
//
// Utseende etter status (se statusFor i stopeplan-regn.js):
//   støpt           — full farge
//   denne uka / forsinket — farge, litt gjennomsiktig
//   planlagt        — blass
import * as THREE from "three";
import { S, registrerEkstraGruppe } from "./state.js";
import { flyTil, scene } from "./scene.js";
import { forHverTrekant } from "./elements.js";
import { iDagISO } from "./frist.js";
import { statusFor, synlige } from "./stopeplan-regn.js";

export const stopeGroup = new THREE.Group();
stopeGroup.name = "stopeplan";
scene.add(stopeGroup);

export const OPASITET = { stopt: 0.92, uke: 0.8, forsinket: 0.8, planlagt: 0.38 };

let skjult = false;
const skjulteEtapper = new Set();

function rydd() {
  while (stopeGroup.children.length) {
    const o = stopeGroup.children.pop();
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
}

// Trekantene til en mengde elementer som én geometri (verdenskoordinater).
export function elementGeometri(ider) {
  const sett = new Set((ider || []).map(Number));
  const pos = [];
  const v = new THREE.Vector3();
  if (!S.modelGroup || !sett.size) return null;
  forHverTrekant(sett, (p, a, b, c, mtx) => {
    for (const i of [a, b, c]) {
      v.fromBufferAttribute(p, i);
      if (mtx) v.applyMatrix4(mtx);
      pos.push(v.x, v.y, v.z);
    }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

// Hva som står i scenen nå: [{ id, antallElementer }] — testene teller dette.
let tegnet = [];
export function tegnedeEtapper() { return tegnet.slice(); }

export function tegnStopeplan(liste) {
  rydd();
  tegnet = [];
  stopeGroup.visible = !skjult;
  if (!S.modelGroup) return;
  const iDag = iDagISO();
  for (const e of synlige(liste === undefined ? S.stopeplan : liste)) {
    if (skjulteEtapper.has(e.id)) continue;
    const ider = (e.elementer || []).map(x => Number(x && x.id)).filter(n => n > 0);
    if (!ider.length) continue;
    const geo = elementGeometri(ider);
    if (!geo) continue;
    const st = statusFor(e, iDag);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: e.farge, side: THREE.DoubleSide,
      transparent: OPASITET[st] < 1, opacity: OPASITET[st], depthWrite: OPASITET[st] >= 0.9,
      // Dratt litt FRAM, så etappefargen vinner over modellen under
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    }));
    mesh.renderOrder = 2;
    mesh.userData.etappeId = e.id;
    mesh.raycast = () => {};          // trykk går til modellen under (egenskaper som før)
    stopeGroup.add(mesh);
    tegnet.push({ id: e.id, antallElementer: ider.length, status: st });
  }
}

// Hvilken etappe et element ligger i (eller null).
export function etappeFor(expressID, liste) {
  const id = Number(expressID);
  for (const e of synlige(liste === undefined ? S.stopeplan : liste))
    if ((e.elementer || []).some(x => Number(x && x.id) === id)) return e;
  return null;
}

S.tegnStopeplan = () => tegnStopeplan();

// Laget i Utseende/«Vis alle». Ingen «plukk» og «velg»: trykk går til
// elementet under, som før (etappen står i egenskapene — trinn 4).
registrerEkstraGruppe(stopeGroup, {
  id: "stopeplan",
  navn: "Støpeplan",
  noeSkjult: () => skjult || skjulteEtapper.size > 0,
  visAlt() { skjult = false; skjulteEtapper.clear(); tegnStopeplan(); },
  skjulTilstand: () => ({ skjult, ider: [...skjulteEtapper] }),
  settSkjulTilstand(v) {
    skjult = !!(v && v.skjult);
    skjulteEtapper.clear();
    for (const id of ((v && v.ider) || [])) skjulteEtapper.add(String(id));
    tegnStopeplan();
  },
  mengder: () => {},
  sokRader: () => [],
  // Fra søket (kontrakten i test-ekstralag): fly til etappen
  gaTil(id) {
    const m = stopeGroup.children.find(o => o.userData.etappeId === id);
    if (!m || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    flyTil(b.getCenter(new THREE.Vector3()), b.getSize(new THREE.Vector3()).length());
  }
});

export function settEtappeSkjult(id, paa) {
  if (paa) skjulteEtapper.add(id); else skjulteEtapper.delete(id);
  tegnStopeplan();
}
export function etappeSkjult(id) { return skjulteEtapper.has(id); }
