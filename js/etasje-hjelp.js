// 🏢 ETASJER, PLASSERING OG FORHÅNDSVISNING – runde 5 (Emil 23.11.2026)
//
// Felles for 5C (trinn per etasje, forhåndsvist i 3D), 6C (gjenta i andre
// etasjer) og 9C (navneforslag). Reglene ligger i utfylling-regn.js.
import * as THREE from "three";
import { S } from "./state.js";
import { scene } from "./scene.js";
import { forHverTrekant } from "./elements.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { ifcUnder } from "./framdrift-regn.js";

// Etasjene nederst først: [{ navn, ids: [expressID], yBase }]
export async function etasjer() {
  if (!S.modelGroup || !S.sikreEtasjeliste) return [];
  let l = [];
  try { l = await S.sikreEtasjeliste(); } catch (_) { l = []; }
  return (l || []).filter(e => e && Array.isArray(e.ids) && e.ids.length).map(e => ({ navn: e.name || "", ids: e.ids, yBase: e.yBase }));
}
// expressID → etasjeindeks (nederst først)
export async function etasjeKart() {
  const l = await etasjer();
  const m = new Map();
  l.forEach((e, i) => { for (const id of e.ids) if (!m.has(id)) m.set(id, i); });
  return { liste: l, kart: m };
}

// Senter i plan (x, z) for hvert element – samme trekanter som fargene bruker,
// så det virker likt med full modell, lav kvalitet og lett kopi.
let senterBuffer = null, senterNokkel = "";
export function sentre() {
  const nokkel = (S.fileName || "") + "|" + (S.modelGroup ? S.modelGroup.uuid : "");
  if (senterBuffer && senterNokkel === nokkel) return senterBuffer;
  const min = new Map(), max = new Map();
  const v = new THREE.Vector3();
  if (S.modelGroup) {
    const alle = new Set();
    for (const m of S.modelGroup.children) {
      if (m.userData.merged) for (const r of m.userData.ranges || []) alle.add(r.id);
      else if (m.userData.expressID !== undefined) alle.add(m.userData.expressID);
    }
    forHverTrekant(alle, (pp, a, b, c, mtx, id) => {
      for (const i of [a, b, c]) {
        v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx);
        let lo = min.get(id), hi = max.get(id);
        if (!lo) { lo = v.clone(); hi = v.clone(); min.set(id, lo); max.set(id, hi); }
        else { lo.min(v); hi.max(v); }
      }
    });
  }
  const ut = new Map();
  for (const [id, lo] of min) { const hi = max.get(id); ut.set(id, { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 }); }
  senterBuffer = ut; senterNokkel = nokkel;
  return ut;
}

// Elementbeskrivelser til reglene: { id, type, profil, x, z, etasje }
export async function beskriv(ider) {
  const { liste, kart } = await etasjeKart();
  try { await sikreMeta(() => new Set(ider)); } catch (_) { /* uten meta: type tom */ }
  const sen = sentre();
  const ut = [];
  for (const id of ider) {
    const me = metaFor(id) || {};
    const p = sen.get(id);
    if (!p) continue;
    ut.push({ id, type: String(me.typeName || "").toUpperCase(), profil: ifcUnder(me.name || me.objectType || ""), x: p.x, z: p.z,
      etasje: kart.has(id) ? kart.get(id) : -1, typeName: me.typeName || "", name: me.name || me.objectType || "",
      etasjeNavn: kart.has(id) && liste[kart.get(id)] ? liste[kart.get(id)].navn : "" });
  }
  return { elementer: ut, etasjer: liste };
}

// Hele modellen beskrevet (til 6C) – bare elementer som ligger i en etasje
export async function beskrivAlle() {
  const { liste } = await etasjeKart();
  const ider = [];
  for (const e of liste) ider.push(...e.ids);
  return beskriv([...new Set(ider)]);
}

// ---------- Forhåndsvisning: farget kopi over elementene ----------
const overlay = new THREE.Group();
overlay.name = "etasjeForhandsvisning";
overlay.renderOrder = 990;
let lagtTil = false;
export function visOverlay(grupper) {
  fjernOverlay();
  if (!S.modelGroup) return;
  if (!lagtTil) { scene.add(overlay); lagtTil = true; }
  const v = new THREE.Vector3();
  for (const g of grupper || []) {
    const ids = new Set(g.ids);
    if (!ids.size) continue;
    const pos = [];
    forHverTrekant(ids, (pp, a, b, c, mtx) => { for (const i of [a, b, c]) { v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx); pos.push(v.x, v.y, v.z); } });
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(g.farge || "#2f6fdb"), transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 990; mesh.raycast = () => {};
    overlay.add(mesh);
  }
  S.miniSkitten = true;
}
export function fjernOverlay() {
  for (const m of [...overlay.children]) { overlay.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  S.miniSkitten = true;
}
export const _nullstill = () => { senterBuffer = null; senterNokkel = ""; };
