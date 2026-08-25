// 💾 Lett kopi (.glb): bygging av en forenklet modell du kan laste ned.
//
// Kopien bygges fra geometrien som ALLEREDE ligger i scenen – ingen ny parsing og
// ingen omlasting av modellen, som 💾 måtte gjøre før. I full kvalitet slås mesh
// sammen per materiale (festemidler og bittesmå elementer utelates, som i 🪶 lav
// kvalitet); er modellen alt lastet i lav kvalitet, er den ferdig slått sammen.
//
// MERK: automatisk generering, opplasting til SharePoint og ⚡-merket i biblioteket
// er FJERNET (2026-07-29). Det ga for lite igjen for kompleksiteten, og byggingen
// tynget nettleseren på store modeller. Storm har en egen manuell prosedyre for å
// forenkle modeller når det trengs. Historikken ligger i OPPLASTING.md.
import * as THREE from "three";
import { S, loadingText, statusEl } from "./state.js";
import { t } from "./i18n.js";
import { kall, metaFor, sikreMeta } from "./ifcrpc.js";

// Offisielle parametersett for lettkopien (Emils valg 25.08.2026):
//   normal = som i dag · stor = 200 MB+-prosjekter der kopien ellers ikke lar
//   seg bygge/laste opp. «weld» er sveisetoleransen i mergeVertices (meter) —
//   1 mm på store prosjekter sveiser langt flere punkter enn 0,1 mm.
export function lettParametre(modus) {
  return modus === "stor"
    ? { minst: 0.5, sirkel: 5, weld: 1e-3 }
    : { minst: 0.15, sirkel: 6, weld: 1e-4 };
}

export const lettNavn = (modellnavn) =>
  String(modellnavn || "modell").replace(/\.(ifc|glb)$/i, "") + ".lett.glb";

// ---------- Bygge kopien ----------

// Hvilke elementer skal utelates? Samme regel som 🪶 lav kvalitet.
const HOPP_TYPER = new Set(["MECHANICALFASTENER", "FASTENER", "DISCRETEACCESSORY"]);

// Slår sammen scenens mesh per materiale og gir ranges, slik lav kvalitet gjør.
// Returnerer en liste { pos, idx, material, ranges }.
export function slåSammenScene(children, opts) {
  const o = opts || {};
  const minst = o.minst !== undefined ? o.minst : (Number(localStorage.getItem("storm-ifc-test-minst")) || 0.15);
  const bøtter = new Map();
  const boks = new THREE.Box3();
  let utelatt = 0;

  for (const m of children) {
    if (!m.isMesh) continue;
    if (m.userData.merged) {
      // alt sammenslått (lav kvalitet / lett kopi): ta geometrien som den er
      const key = m.material.uuid;
      let b = bøtter.get(key);
      if (!b) { b = { mat: m.material, deler: [] }; bøtter.set(key, b); }
      const pos = m.geometry.getAttribute("position").array;
      const idx = m.geometry.getIndex().array;
      b.deler.push({ pos, idx, ranges: m.userData.ranges || [] });
      continue;
    }
    const id = m.userData.expressID;
    const meta = metaFor(id);
    if (meta && HOPP_TYPER.has((meta.typeName || "").toUpperCase())) { utelatt++; continue; }
    // diagonalen regnes ut av boksens ytterpunkter – samme mål som IFC-tråden
    // bruker i 🪶 lav kvalitet, så de to veiene utelater nøyaktig de samme
    boks.setFromObject(m);
    const dx = boks.max.x - boks.min.x, dy = boks.max.y - boks.min.y, dz = boks.max.z - boks.min.z;
    if (Math.hypot(dx, dy, dz) < minst) { utelatt++; continue; }

    // legg matrisen inn i punktene, så alt kan slås sammen
    const g = m.geometry;
    const src = g.getAttribute("position");
    const pos = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    m.updateMatrixWorld(true);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const ix = g.getIndex();
    const idx = ix ? new Uint32Array(ix.array) : new Uint32Array(src.count).map((_, i) => i);
    const key = (m.userData.origMat || m.material).uuid;
    let b = bøtter.get(key);
    if (!b) { b = { mat: m.userData.origMat || m.material, deler: [] }; bøtter.set(key, b); }
    b.deler.push({ pos, idx, ranges: [{ start: 0, count: idx.length, id }] });
  }

  const ut = [];
  for (const [, b] of bøtter) {
    let vtot = 0, itot = 0;
    b.deler.forEach(d => { vtot += d.pos.length / 3; itot += d.idx.length; });
    const pos = new Float32Array(vtot * 3);
    const idx = new Uint32Array(itot);
    const ranges = [];
    let vo = 0, io = 0;
    for (const d of b.deler) {
      pos.set(d.pos, vo * 3);
      for (let i = 0; i < d.idx.length; i++) idx[io + i] = d.idx[i] + vo;
      d.ranges.forEach(r => ranges.push({ start: io + r.start, count: r.count, id: r.id }));
      vo += d.pos.length / 3;
      io += d.idx.length;
    }
    ut.push({ pos, idx, material: b.mat, ranges });
  }
  return { bøtter: ut, utelatt };
}

// Bygger .glb-en. Returnerer { bytes, ids, utelatt }.
export async function byggLettKopi(melding, opts) {
  const si = melding || (() => {});
  const o = opts || {};

  // Navnene er det som gjør kopien nyttig (søk og egenskaper), så vi sørger for
  // at elementdata er hentet før vi begynner.
  si(t("Leser elementdata …"));
  await sikreMeta(() => {
    const s = new Set();
    S.modelGroup.children.forEach(m => {
      if (m.userData.merged) (m.userData.ranges || []).forEach(r => s.add(r.id));
      else if (m.userData.expressID !== undefined) s.add(m.userData.expressID);
    });
    return s;
  });

  si(t("Slår sammen geometri …"));
  const { bøtter, utelatt } = slåSammenScene(S.modelGroup.children, o.minst !== undefined ? { minst: o.minst } : undefined);

  const ids = new Set();
  bøtter.forEach(b => b.ranges.forEach(r => ids.add(r.id)));

  si(t("Henter elementdata …"));
  const props = {};
  for (const id of ids) {
    const m = metaFor(id);
    // fjerde plass er materialet – lett kopi har ingen IFC-data å slå opp i
    // femte plass er GlobalId — nøkkelen som gjenkjenner elementet mellom revisjoner
    if (m) props[id] = [m.name || "", m.objectType || "", m.typeName ? "Ifc" + m.typeName : "", m.material || "", m.globalId || ""];
  }
  let columns = [], storeys = [];
  try { columns = (await kall("axisSources")).filter(k => k.t === "COLUMN").map(k => k.id); } catch(_) {}
  try { storeys = (await kall("storeys")).map(s => ({ name: s.name, ids: s.ids })); } catch(_) {}

  // sveis sammen dupliserte punkter – gir mange ganger mindre fil
  si(t("Komprimerer geometri …"));
  await new Promise(r => setTimeout(r, 0));
  const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
  const gruppe = new THREE.Group();
  let nr = 0;
  for (const b of bøtter) {
    // mergeVertices er tung og synkron – slipp nettleseren til mellom hver bøtte
    si(t("Komprimerer geometri …") + " " + (++nr) + "/" + bøtter.length);
    await new Promise(r => setTimeout(r, 0));
    let g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(b.pos, 3));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    g = mergeVertices(g, o.weld || 1e-4);
    const em = new THREE.Mesh(g, b.material);
    em.userData.merged = true;
    em.userData.ranges = b.ranges;
    gruppe.add(em);
  }
  gruppe.userData.stormLite = {
    v: 4,   // v4 = props har GlobalId på femte plass
    name: S.fileName,
    kote: S.koteMatrixInv ? Array.from(S.koteMatrixInv.elements) : null,
    laget: new Date().toISOString(),
    columns, storeys, props
  };

  si(t("Skriver .glb …"));
  await new Promise(r => setTimeout(r, 0));
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(gruppe, res, rej, { binary: true }));
  gruppe.children.forEach(em => em.geometry.dispose());
  return { bytes: new Uint8Array(glb), ids, utelatt };
}
