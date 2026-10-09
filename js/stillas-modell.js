// 🧱 STILLAS — 3D-modellen. Tegner lista fra stillasDeler (stillas-regn.js),
// så bildet og mengdelista aldri kan bli uenige.
//
// To visninger (Emil 08.10), valgt per stillas:
//   · FORENKLET (standard): tynne rør i én lys farge og halvgjennomsiktige
//     gule plater — lett å tegne på telefonen, og du ser bygget gjennom.
//   · FARGEKODET: hver deltype i sin farge (STILLAS_FARGER), de samme fargene
//     som står foran radene i mengdelista.
// Bitene merkes med `stykke` = sida de hører til, så rigg.js kan legge til en
// skjøt der man trykker (som på byggegjerdet), og så slaaSammen slår dem
// sammen per materiale og side.
import * as THREE from "three";
import { STILLAS_FARGER, stillasDeler } from "./stillas-regn.js";

const matCache = new Map();
const FORENKLET_ROR = "#d9dee3", FORENKLET_PLATE = "#c9a227";
const ER_PLATE = new Set(["plate", "planke", "stige"]);

function mat(del, visning) {
  const k = visning + "|" + del;
  if (matCache.has(k)) return matCache.get(k);
  let m;
  if (visning === "fargekodet") m = new THREE.MeshLambertMaterial({ color: STILLAS_FARGER[del] || "#9ca3af" });
  else if (ER_PLATE.has(del)) m = new THREE.MeshLambertMaterial({ color: FORENKLET_PLATE, transparent: true, opacity: 0.6, depthWrite: false });
  else m = new THREE.MeshLambertMaterial({ color: del === "skrue" ? "#8a9299" : FORENKLET_ROR });
  matCache.set(k, m);
  return m;
}

const OPP = new THREE.Vector3(0, 1, 0);
const geoCache = new Map();
function rorGeo(r, enkel) {
  const k = r.toFixed(4) + (enkel ? "e" : "");
  if (!geoCache.has(k)) geoCache.set(k, enkel ? new THREE.BoxGeometry(2 * r, 1, 2 * r) : new THREE.CylinderGeometry(r, r, 1, 6));
  return geoCache.get(k);
}

export function byggStillas(g, o, opts) {
  const enkel = !!(opts && opts.enkel);
  const visning = o.visning === "fargekodet" ? "fargekodet" : "forenklet";
  const d = stillasDeler(o);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
  for (const x of d.ror) {
    a.fromArray(x.a); b.fromArray(x.b);
    dir.subVectors(b, a);
    const L = dir.length();
    if (!(L > 1e-4)) continue;
    // Geometrien deles mellom rørene, men slaaSammen tar en KOPI av hver
    // før den slår sammen — derfor er det trygt.
    const m = new THREE.Mesh(rorGeo(x.r || 0.024, enkel), mat(x.del, visning));
    m.scale.set(1, L, 1);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(OPP, dir.normalize());
    m.userData.stykke = x.side;
    g.add(m);
  }
  for (const x of d.bokser) {
    if (x.usynlig) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(x.s[0], x.s[1], x.s[2]), mat(x.del, visning));
    m.position.fromArray(x.c);
    m.rotation.y = -Math.atan2(x.e.z, x.e.x);
    m.userData.stykke = x.side;
    g.add(m);
  }
}
