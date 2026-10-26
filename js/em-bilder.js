// 📸 BILDENE TIL ENDRINGSMELDINGEN — ett før- og ett etter-bilde per endring
// (Emil 26.10.2026: «kun de elementene som er relevant får endringen skal
// vises og resten skal være skjult», PDF-oppsett C).
//
// For hvert bilde:
//   • hele modellen og alt annet i scenen (markeringer, mål, rigg, akser …)
//     skjules; bare lysene står igjen
//   • FØR: det som er fjernet (rødt) og endrede slik de var (oransje) tegnes
//     som stiplede omriss. Den gamle modellen er ikke åpen — sammenligningen
//     har bare boksene fra avtrykket, og det er dem vi viser.
//   • ETTER: de nye (grønt) og endrede (oransje) elementene med ekte geometri.
//     På en lett kopi (GLB) er geometrien slått sammen og kan ikke skilles —
//     da tegnes elementene som massive bokser i samme farger.
//   • akselinjene (hvis aksesystemet er laget) som svake linjer på bakken
//   • kameraet zoomer inn på elementene, SAMME vinkel i begge bildene
// Alt settes tilbake i finally, også om noe kaster underveis.
import * as THREE from "three";
import { S } from "./state.js";
import { camera, controls, fangstBilde, scene } from "./scene.js";
import { allElementBoxes } from "./elements.js";

// Bildets form passer ruta på den liggende A4-sida (em-pdf.js)
export const EM_BILDE_PX = { b: 920, h: 1180 };
const FARGE = { ny: 0x3cb44b, endret: 0xe9a13b, valgt: 0x3b82f6, fjernet: 0xd22b34, gammel: 0xa8650f };

function boks(c, d, min) {
  const m = Math.max(min, 1e-6);
  return new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...c),
    new THREE.Vector3(Math.max(d[0], m), Math.max(d[1], m), Math.max(d[2], m)));
}

function omriss(b, farge, strek) {
  const g = new THREE.Group();
  const str = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
  const geo = new THREE.BoxGeometry(str.x, str.y, str.z);
  const fyll = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: farge, transparent: true, opacity: 0.14, depthWrite: false }));
  const linjer = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineDashedMaterial({ color: farge, dashSize: strek, gapSize: strek * 0.6 }));
  linjer.computeLineDistances();
  fyll.position.copy(mid); linjer.position.copy(mid);
  g.add(fyll, linjer);
  return g;
}

function massiv(b, farge) {
  const g = new THREE.Group();
  const str = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
  const geo = new THREE.BoxGeometry(str.x, str.y, str.z);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: farge }));
  const k = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x333333 }));
  m.position.copy(mid); k.position.copy(mid);
  g.add(m, k);
  return g;
}

function akselinjer(utsnitt) {
  const a = S.akseLinjer, g = new THREE.Group();
  if (!a) return g;
  const mat = new THREE.LineBasicMaterial({ color: 0xb8bec7 });
  const y = utsnitt.min.y, s = utsnitt.getSize(new THREE.Vector3()), luft = Math.max(s.x, s.z) * 0.6 + 1e-6;
  const x0 = utsnitt.min.x - luft, x1 = utsnitt.max.x + luft, z0 = utsnitt.min.z - luft, z1 = utsnitt.max.z + luft;
  const linje = (p, q) => g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), mat));
  for (const l of a.x || []) if (l.c >= x0 && l.c <= x1) linje(new THREE.Vector3(l.c, y, z0), new THREE.Vector3(l.c, y, z1));
  for (const l of a.z || []) if (l.c >= z0 && l.c <= z1) linje(new THREE.Vector3(x0, y, l.c), new THREE.Vector3(x1, y, l.c));
  return g;
}

// endring: { elementer: [{ hva, id, c, d, fc, fd }] } (em-regn.js endringerFra)
// o: { egenRetning, utvalg } → { for: dataUrl|null, etter: dataUrl|null }
export async function taEndringsbilder(endring, o) {
  const opt = o || {};
  if (!S.modelGroup) return { for: null, etter: null };
  const el = (endring && endring.elementer) || [];
  const bokser = allElementBoxes();
  const minst = (S.modelSize || 10) * 0.002;

  const forDeler = [], etterDeler = [];
  const utsnitt = new THREE.Box3();
  for (const e of el) {
    if (e.hva === "fjernet" && e.c && e.d) { const b = boks(e.c, e.d, minst); forDeler.push([b, FARGE.fjernet]); utsnitt.union(b); }
    if (e.hva === "endret" && e.fc && e.fd) { const b = boks(e.fc, e.fd, minst); forDeler.push([b, FARGE.gammel]); utsnitt.union(b); }
    if (e.hva !== "fjernet") {
      const b = (e.id != null && bokser.get(e.id)) || (e.c && e.d ? boks(e.c, e.d, minst) : null);
      if (b) { etterDeler.push([e, b.clone(), FARGE[e.hva] || FARGE.ny]); utsnitt.union(b); }
    }
  }
  if (utsnitt.isEmpty()) return { for: null, etter: null };

  // --- ta vare på alt vi rører ---
  const skjult = [];
  const mesher = [];
  const kam = { p: camera.position.clone(), up: camera.up.clone(), m: controls.target.clone(), near: camera.near, far: camera.far, q: camera.quaternion.clone() };
  const tmp = new THREE.Group();
  try {
    for (const ch of scene.children) {
      if (ch.isLight || ch === S.modelGroup || !ch.visible) continue;
      ch.visible = false; skjult.push(ch);
    }
    S.modelGroup.traverse(m => { if (m.isMesh) mesher.push({ m, v: m.visible, mat: m.material }); });
    scene.add(tmp);
    tmp.add(akselinjer(utsnitt));

    // --- kameraet: inn på elementene ---
    const mid = utsnitt.getCenter(new THREE.Vector3());
    const r = Math.max(utsnitt.getSize(new THREE.Vector3()).length() / 2, minst * 4);
    const retning = opt.egenRetning ? camera.position.clone().sub(controls.target) : new THREE.Vector3(1, 0.85, 1.25);
    if (retning.lengthSq() < 1e-12) retning.set(1, 0.85, 1.25);
    retning.normalize();
    const vfov = camera.fov * Math.PI / 180, aspekt = EM_BILDE_PX.b / EM_BILDE_PX.h;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspekt);
    const avstand = r / Math.sin(Math.min(vfov, hfov) / 2) * 1.08;
    camera.up.set(0, 1, 0);
    camera.position.copy(mid).addScaledVector(retning, avstand);
    controls.target.copy(mid);
    camera.near = Math.max(avstand / 2000, 1e-4); camera.far = avstand * 20;
    camera.lookAt(mid);
    camera.updateProjectionMatrix();
    const strek = r * 0.025;

    // --- FØR ---
    let forBilde = null;
    if (!opt.utvalg && forDeler.length) {
      for (const x of mesher) x.m.visible = false;
      const g = new THREE.Group();
      for (const [b, f] of forDeler) g.add(omriss(b, f, strek));
      tmp.add(g);
      const f = fangstBilde(EM_BILDE_PX.b, EM_BILDE_PX.h);
      forBilde = f ? f.data : null;
      tmp.remove(g);
    }

    // --- ETTER ---
    let etterBilde = null;
    if (etterDeler.length) {
      const hva = new Map(etterDeler.map(([e]) => [e.id, e.hva]));
      const funnet = new Set();
      const mat = {};
      const matFor = (h) => mat[h] || (mat[h] = new THREE.MeshLambertMaterial({ color: FARGE[h] || FARGE.ny, side: THREE.DoubleSide }));
      for (const x of mesher) {
        const id = x.m.userData.expressID;
        if (!x.m.userData.merged && id !== undefined && hva.has(id)) {
          x.m.visible = true; x.m.material = matFor(hva.get(id)); funnet.add(id);
        } else x.m.visible = false;
      }
      const g = new THREE.Group();
      for (const [e, b, f] of etterDeler) if (!funnet.has(e.id)) g.add(massiv(b, f));
      tmp.add(g);
      const f = fangstBilde(EM_BILDE_PX.b, EM_BILDE_PX.h);
      etterBilde = f ? f.data : null;
    }
    return { for: forBilde, etter: etterBilde };
  } finally {
    scene.remove(tmp);
    for (const x of mesher) { x.m.visible = x.v; x.m.material = x.mat; }
    for (const ch of skjult) ch.visible = true;
    camera.position.copy(kam.p); camera.up.copy(kam.up); controls.target.copy(kam.m);
    camera.quaternion.copy(kam.q); camera.near = kam.near; camera.far = kam.far;
    camera.updateProjectionMatrix();
  }
}
