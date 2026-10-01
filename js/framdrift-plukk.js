// 📅 Framdriftsplan — GENERERT BLIKK OG TRP-PLATER I «LEGG TIL» (Emil 01.10).
//
// SW-generatoren tegner takplatene (userData.trpId) og blikket
// (userData.blikkId) i samme gruppe som veggene, men SW-lagets plukking ser
// bare veggene og gulvet (swId). Dette laget svarer for platene og blikket —
// og BARE mens framdriftsplanens velgemodus er på, så vanlige klikk og
// shift-klikk ellers i programmet er som før.
//
// Laget melder seg inn i EKSTRA_LAG (js/state.js) med plukk, flervalg og
// iRekt, så både trykk og shift + dra virker uten at elements.js vet om det.
// Id-ene er hele nøkler: «tak:<id>» og «blikk:<id>».
import * as THREE from "three";
import { S, registrerEkstraGruppe } from "./state.js";
import { camera, canvas, raycaster } from "./scene.js";
import { swGroup } from "./veggelement/tilstand.js";
import { settValgEffekt } from "./materiell-vis.js";

export const LAG_ID = "fpTrpBlikk";
const valgt = new Set();
const aktiv = () => !!(S.velgModusAktiv && S.framdriftVelger && S.framdriftVelger());

export function nokkelForMesh(o) {
  while (o && o !== swGroup) {
    const u = o.userData || {};
    if (u.trpId !== undefined && u.trpId !== null && u.trpId !== "") return "tak:" + u.trpId;
    if (u.blikkId !== undefined && u.blikkId !== null && u.blikkId !== "") return "blikk:" + u.blikkId;
    o = o.parent;
  }
  return null;
}
function synligKjede(o) {
  for (let x = o; x; x = x.parent) if (x.visible === false) return false;
  return true;
}
// Alle meshene per nøkkel (en plate eller et beslag kan være flere meshes)
function meshPerNokkel() {
  const m = new Map();
  for (const o of swGroup.children) {
    const k = nokkelForMesh(o);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return m;
}
function oppdaterEffekt() {
  for (const [k, liste] of meshPerNokkel()) for (const o of liste) settValgEffekt(o, valgt.has(k));
}

const _ndc = new THREE.Vector2();
const _b = new THREE.Box3(), _v = new THREE.Vector3();
const gruppe = new THREE.Group();     // tom: laget eier ingen egne objekter
registrerEkstraGruppe(gruppe, {
  id: LAG_ID,
  navn: "Blikk og takplater",
  // Lagkontrakten (test-ekstralag): mengder, søk og «fly til» står allerede
  // på SW-laget for de samme platene og beslagene — her er de tomme, så
  // ingenting telles eller vises to ganger.
  mengder: () => {},
  sokRader: () => [],
  gaTil() {},
  plukk(cx, cy) {
    if (!aktiv() || !swGroup.children.length) return null;
    const r = canvas.getBoundingClientRect();
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    swGroup.updateMatrixWorld(true);
    raycaster.setFromCamera(_ndc, camera);
    for (const h of raycaster.intersectObjects(swGroup.children, true)) {
      if (h.object.isSprite || !synligKjede(h.object)) continue;
      const k = nokkelForMesh(h.object);
      if (k) return { id: k, avstand: h.distance };
    }
    return null;
  },
  flervalg: true,
  iRekt(x0, y0, x1, y1) {
    if (!aktiv()) return [];
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const ut = [];
    swGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    for (const [k, liste] of meshPerNokkel()) {
      _b.makeEmpty();
      for (const o of liste) if (synligKjede(o)) _b.expandByObject(o);
      if (_b.isEmpty()) continue;
      _b.getCenter(_v).project(camera);
      if (_v.z > 1) continue;
      const px = (_v.x + 1) / 2 * innerWidth, py = (1 - _v.y) / 2 * innerHeight;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) ut.push(k);
    }
    return ut;
  },
  velg(ider) {
    const nye = new Set(ider || []);
    if (nye.size === valgt.size && [...nye].every(k => valgt.has(k))) return;
    valgt.clear();
    for (const k of nye) valgt.add(k);
    oppdaterEffekt();
  },
  valgte: () => [...valgt]
});
