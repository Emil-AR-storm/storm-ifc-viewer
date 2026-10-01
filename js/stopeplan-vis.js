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
import { elementNokkel, erGenerert, statusPer, synlige } from "./stopeplan-regn.js";
import { riggBase } from "./rigg-vis.js";

export const stopeGroup = new THREE.Group();
stopeGroup.name = "stopeplan";
scene.add(stopeGroup);

export const OPASITET = { stopt: 0.92, uke: 0.8, forsinket: 0.8, planlagt: 0.38 };

// 👁 «Vis etappeplan» (Emil 01.10): ÉN bryter for hele fargingen, i stedet for
// skjul/vis på hver etappe. Valget huskes på denne maskinen (per bruker —
// det er en visning, ikke en del av planen).
const VIS_NOKKEL = "storm-ifc-stopeplan-vis";
let skjult = (() => { try { return localStorage.getItem(VIS_NOKKEL) === "av"; } catch (_) { return false; } })();
export const visEtappeplan = () => !skjult;
export function settVisEtappeplan(paa) {
  skjult = !paa;
  try { localStorage.setItem(VIS_NOKKEL, paa ? "paa" : "av"); } catch (_) {}
  tegnStopeplan();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
}
// 📅 Tidslinjen (trinn 4): hvilken dag modellen viser. null = i dag.
export const vistPer = () => S.stopeVistPer || null;

function rydd() {
  while (stopeGroup.children.length) {
    const o = stopeGroup.children.pop();
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
}

// ═══════════ TRINN 3: FELTENE PÅ PLATA ═══════════
// Byggrammen ↔ scenen. Samme ramme som riggen (riggBase): meter fra midten av
// modellens boks. Basen regnes ut én gang per tegning — Box3 av en stor modell
// er for dyr å gjøre for hvert hjørne i et drag.
let base = null;
export function feltBase() { base = riggBase(); return base; }
export function tilScene(bx, bz, by, b) {
  const B = b || base || feltBase();
  if (!B) return null;
  return new THREE.Vector3(B.c.x + bx / B.skala, B.c.y + by / B.skala, B.c.z + bz / B.skala);
}
export function tilBygg(p, b) {
  const B = b || base || feltBase();
  if (!B || !p) return null;
  return { bx: (p.x - B.c.x) * B.skala, by: (p.y - B.c.y) * B.skala, bz: (p.z - B.c.z) * B.skala };
}
// Feltet ligger et hårstrå OVER plata (1 cm), så fargen ikke flimrer mot den.
const LOFT_M = 0.01;
export const FELT_OPASITET = { stopt: 0.85, uke: 0.75, forsinket: 0.75, planlagt: 0.5 };

function feltMesh(f, farge, opasitet) {
  const B = base;
  const y = B.c.y + (f.by + LOFT_M) / B.skala;
  const pos = f.punkter.map(([bx, bz]) => [B.c.x + bx / B.skala, B.c.z + bz / B.skala]);
  const tri = THREE.ShapeUtils.triangulateShape(pos.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const arr = [];
  for (const t of tri || []) for (const k of t) arr.push(pos[k][0], y, pos[k][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: farge, side: THREE.DoubleSide, transparent: true, opacity: opasitet, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  m.renderOrder = 3;
  // 🧱 Variant C: STIPLET fugestrek rundt feltet (Emils valg 01.10)
  const lp = [];
  for (let i = 0; i < pos.length; i++) {
    const a = pos[i], b = pos[(i + 1) % pos.length];
    lp.push(a[0], y, a[1], b[0], y, b[1]);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lp), 3));
  const strek = new THREE.LineSegments(lg, new THREE.LineDashedMaterial({
    color: 0x111111, dashSize: 0.5 / B.skala, gapSize: 0.3 / B.skala, depthTest: false, transparent: true }));
  strek.computeLineDistances();
  strek.renderOrder = 4;
  m.add(strek);
  return m;
}
const feltMeshes = [];
export function feltMeshListe() { return feltMeshes.slice(); }

// Trekantene til en mengde elementer som én geometri (verdenskoordinater).
// `genererte`: SW-id-er (betonggulvet, ringmurbiter) — trekantene kommer fra
// SW-laget selv (S.swTrekanter), siden de ikke finnes i modellen.
export function elementGeometri(ider, genererte) {
  const sett = new Set((ider || []).map(Number));
  const pos = [];
  const v = new THREE.Vector3();
  if (!S.modelGroup || (!sett.size && !(genererte || []).length)) return null;
  if (sett.size) forHverTrekant(sett, (p, a, b, c, mtx) => {
    for (const i of [a, b, c]) {
      v.fromBufferAttribute(p, i);
      if (mtx) v.applyMatrix4(mtx);
      pos.push(v.x, v.y, v.z);
    }
  });
  if ((genererte || []).length && S.swTrekanter) {
    const g = S.swTrekanter(genererte);
    for (let i = 0; i < g.length; i++) pos.push(g[i]);
  }
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
  feltMeshes.length = 0;
  stopeGroup.visible = !skjult;
  if (!S.modelGroup) return;
  const iDag = iDagISO();
  feltBase();
  for (const e of synlige(liste === undefined ? S.stopeplan : liste)) {
    // Feltene først — de skal tegnes også om etappen ikke har elementer
    if (base) for (const f of e.felt || []) {
      try {
        const m = feltMesh(f, e.farge, FELT_OPASITET[statusPer(e, vistPer(), iDag)]);
        m.userData.feltId = f.id; m.userData.etappeId = e.id;
        stopeGroup.add(m);
        feltMeshes.push(m);
      } catch (err) { console.warn("Feltet kunne ikke tegnes:", err); }
    }
    const ider = (e.elementer || []).filter(x => !erGenerert(x)).map(x => Number(x && x.id)).filter(n => n > 0);
    const gen = (e.elementer || []).filter(erGenerert).map(x => x.sw);
    if (!ider.length && !gen.length) {
      if ((e.felt || []).length) tegnet.push({ id: e.id, antallElementer: 0, antallGenererte: 0, antallFelt: e.felt.length, status: statusPer(e, vistPer(), iDag) });
      continue;
    }
    const geo = elementGeometri(ider, gen);
    if (!geo) continue;
    const st = statusPer(e, vistPer(), iDag);
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
    tegnet.push({ id: e.id, antallElementer: ider.length + gen.length, antallGenererte: gen.length, antallFelt: (e.felt || []).length, status: st });
  }
}

// Hvilken etappe et element ligger i (eller null).
// Tall = ExpressID; tekst = SW-id («gulv», «r3») eller en nøkkel («sw:r3»).
export function etappeFor(element, liste) {
  const k = elementNokkel(element);
  for (const e of synlige(liste === undefined ? S.stopeplan : liste))
    if ((e.elementer || []).some(x => elementNokkel(x) === k)) return e;
  return null;
}

S.tegnStopeplan = () => tegnStopeplan();

// Laget i Utseende/«Vis alle». Ingen «plukk» og «velg»: trykk går til
// elementet under, som før (etappen står i egenskapene — trinn 4).
registrerEkstraGruppe(stopeGroup, {
  id: "stopeplan",
  navn: "Støpeplan",
  noeSkjult: () => skjult,
  visAlt() { if (skjult) settVisEtappeplan(true); },
  skjulTilstand: () => ({ skjult }),
  settSkjulTilstand(v) { settVisEtappeplan(!(v && v.skjult)); },
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

