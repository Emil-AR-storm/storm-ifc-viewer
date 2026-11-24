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
//
// ⚡ Optimalisert 24.11 (forslag 4): leser punktene rett fra geometrien (samme
// indeks og samme punkter som forHverTrekant), med min/maks i lokale tall per
// bit i stedet for et Map-oppslag og en Vector3 per hjørne. Svaret er det
// samme som før – test-etasjesentre sammenligner de to – og det bruker bare
// geometrien som ligger i scenen, så lett og ekstra lett kopi virker som før.
// Nøkkelen tar med antall barn, så en modell som bygges om (lav ↔ full
// kvalitet i samme gruppe) regnes på nytt.
let senterBuffer = null, senterNokkel = "";
export function sentre() {
  const g = S.modelGroup;
  const nokkel = (S.fileName || "") + "|" + (g ? g.uuid + "|" + g.children.length : "");
  if (senterBuffer && senterNokkel === nokkel) return senterBuffer;
  senterBuffer = regnSentre(g); senterNokkel = nokkel;
  return senterBuffer;
}
export function regnSentre(g) {
  const boks = new Map();   // id → [x0, y0, z0, x1, y1, z1]
  const legg = (id, x0, y0, z0, x1, y1, z1) => {
    const b = boks.get(id);
    if (!b) { boks.set(id, [x0, y0, z0, x1, y1, z1]); return; }
    if (x0 < b[0]) b[0] = x0; if (y0 < b[1]) b[1] = y0; if (z0 < b[2]) b[2] = z0;
    if (x1 > b[3]) b[3] = x1; if (y1 > b[4]) b[4] = y1; if (z1 > b[5]) b[5] = z1;
  };
  for (const m of (g && g.children) || []) {
    if (!m.isMesh || !m.geometry) continue;
    const p = m.geometry.getAttribute("position");
    const ix = m.geometry.getIndex();
    if (!p) continue;
    if (m.userData.merged) {
      if (!ix) continue;
      for (const r of m.userData.ranges || []) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        const slutt = r.start + r.count - (r.count % 3);
        for (let i = r.start; i < slutt; i++) {
          const v = ix.getX(i);
          const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        if (x0 !== Infinity) legg(r.id, x0, y0, z0, x1, y1, z1);
      }
    } else if (m.userData.expressID !== undefined) {
      const e = m.matrixWorld.elements;
      const n = ix ? ix.count - (ix.count % 3) : p.count - (p.count % 3);
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = ix ? ix.getX(i) : i;
        const px = p.getX(v), py = p.getY(v), pz = p.getZ(v);
        // samme regning som Vector3.applyMatrix4
        const w = 1 / (e[3] * px + e[7] * py + e[11] * pz + e[15]);
        const x = (e[0] * px + e[4] * py + e[8] * pz + e[12]) * w;
        const y = (e[1] * px + e[5] * py + e[9] * pz + e[13]) * w;
        const z = (e[2] * px + e[6] * py + e[10] * pz + e[14]) * w;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (x0 !== Infinity) legg(m.userData.expressID, x0, y0, z0, x1, y1, z1);
    }
  }
  const ut = new Map();
  for (const [id, b] of boks) ut.set(id, { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 });
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
