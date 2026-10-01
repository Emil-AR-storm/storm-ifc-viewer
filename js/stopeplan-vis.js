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
import { t } from "./i18n.js";
import { camera, canvas, flyTil, raycaster, scene } from "./scene.js";
import { LETT } from "./lett.js";
const _pk = new THREE.Vector2();
import { forHverTrekant } from "./elements.js";
import { iDagISO } from "./frist.js";
import { CEMFLEX_OMLEGG_M, cemflexPlan, elementNokkel, erGenerert, statusPer, synlige, vannLengde } from "./stopeplan-regn.js";
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
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
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

// ═══════════ TRINN 6: VANNTETTINGEN ═══════════
// Injeksjonsslangen som en tynn slange, Cemflex-platene som en smal stående
// stripe (150 mm høy). Begge ligger INNE i betongen, midt i tykkelsen —
// slangen 75 mm inn fra kanten, Cemflex-platen midt i fugen. Derfor tegnes de «gjennom»
// betongen (depthTest av), ellers ville de aldri synes.
export const VANN_FARGE = { injeksjon: "#f5b800", cemflex: "#b8c2cc" };
const VANN_INN_M = 0.075, SLANGE_R_M = 0.04, CEMFLEX_H_M = 0.15;
const VANN_NOKKEL = "storm-ifc-stopeplan-vann";
let vannSkjult = (() => { try { return localStorage.getItem(VANN_NOKKEL) === "av"; } catch (_) { return false; } })();
export const visVanntetting = () => !vannSkjult;
export function settVisVanntetting(paa) {
  vannSkjult = !paa;
  try { localStorage.setItem(VANN_NOKKEL, paa ? "paa" : "av"); } catch (_) {}
  tegnStopeplan();
}
const vannMeshes = [];
export function vannMeshListe() { return vannMeshes.slice(); }

function vannMesh(v, felt) {
  const B = base;
  const tk = felt ? felt.tykkelseM : 0.25;
  const midtY = v.by - tk / 2;
  // Midten av feltet: «inn» er bort fra kanten mot den
  let cx = 0, cz = 0;
  if (felt) { for (const p of felt.punkter) { cx += p[0]; cz += p[1]; } cx /= felt.punkter.length; cz /= felt.punkter.length; }
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: VANN_FARGE[v.type], depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  for (const [x1, z1, x2, z2] of v.kanter) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (!(L > 0.01)) continue;
    let nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
    if (felt && ((x1 + x2) / 2 - cx) * nx + ((z1 + z2) / 2 - cz) * nz > 0) { nx = -nx; nz = -nz; }
    // Cemflex står I fugen (halvt i hver støp); slangen 75 mm inn i feltet
    const inn = felt && v.type === "injeksjon" ? VANN_INN_M : 0;
    const mx = (x1 + x2) / 2 + nx * inn, mz = (z1 + z2) / 2 + nz * inn;
    const geo = v.type === "injeksjon"
      ? new THREE.CylinderGeometry(SLANGE_R_M / B.skala, SLANGE_R_M / B.skala, L / B.skala, 8, 1, true)
      : new THREE.PlaneGeometry(L / B.skala, CEMFLEX_H_M / B.skala);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(B.c.x + mx / B.skala, B.c.y + midtY / B.skala, B.c.z + mz / B.skala);
    const vinkel = Math.atan2(-(z2 - z1), x2 - x1);
    if (v.type === "injeksjon") { m.rotation.set(0, vinkel, Math.PI / 2); }
    else m.rotation.set(0, vinkel, 0);
    m.renderOrder = 6;
    m.userData.vannId = v.id;
    g.add(m);
    // Sett ovenfra er en stående stripe bare en strek, og en slange på 50 mm
    // forsvinner på 50 m avstand. Derfor også en strek som alltid er synlig.
    const lg = new THREE.BufferGeometry();
    const ax = x1 + nx * inn, az = z1 + nz * inn, bx = x2 + nx * inn, bz = z2 + nz * inn;
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      B.c.x + ax / B.skala, B.c.y + midtY / B.skala, B.c.z + az / B.skala,
      B.c.x + bx / B.skala, B.c.y + midtY / B.skala, B.c.z + bz / B.skala]), 3));
    const l = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: VANN_FARGE[v.type], depthTest: false, transparent: true }));
    l.renderOrder = 7;
    g.add(l);
  }
  g.userData.vannId = v.id;
  return g;
}

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
  vannMeshes.length = 0;
  stopeGroup.visible = !skjult;
  if (!S.modelGroup) return;
  const iDag = iDagISO();
  feltBase();
  for (const e of synlige(liste === undefined ? S.stopeplan : liste)) {
    // 💧 Vanntettingen (trinn 6)
    if (base && !vannSkjult) for (const v of e.vanntetting || []) {
      try {
        const felt = (e.felt || []).find(f => f.id === v.feltId) || null;
        const g = vannMesh(v, felt);
        g.userData.etappeId = e.id;
        stopeGroup.add(g);
        g.children.forEach(m => { if (m.isMesh) vannMeshes.push(m); });
      } catch (err) { console.warn("Vanntettingen kunne ikke tegnes:", err); }
    }
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
  // 📊 Mengder: løpemeterne for vanntettingen (trinn 6)
  mengder: (groups, rows) => leggVannIMengder(groups, rows),
  sokRader: () => [],
  // 📋 Byggeplassen (trinn 5): trykk på et FELT viser etappen i infovinduet.
  // Bare der — på kontoret eier stopeplan-felt.js trykkene på feltene.
  ...(LETT ? {
    plukk(x, y) {
      if (!stopeGroup.visible || !feltMeshes.length) return null;
      const r = canvas.getBoundingClientRect();
      _pk.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(_pk, camera);
      // Vanntettingen ligger «gjennom» betongen — den vinner når den treffes
      const hv = vannMeshes.length ? raycaster.intersectObjects(vannMeshes, false)[0] : null;
      if (hv) return { id: "vann:" + hv.object.userData.vannId, navn: "", avstand: 0 };
      const h = raycaster.intersectObjects(feltMeshes, false)[0];
      return h ? { id: h.object.userData.feltId, navn: "", avstand: h.distance } : null;
    },
    velg() {},
    valgte: () => [],
    visEgenskaper(id) { if (S.stopeVisFelt) S.stopeVisFelt(id); }
  } : {}),
  // Fra søket (kontrakten i test-ekstralag): fly til etappen
  gaTil(id) {
    const m = stopeGroup.children.find(o => o.userData.etappeId === id);
    if (!m || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    flyTil(b.getCenter(new THREE.Vector3()), b.getSize(new THREE.Vector3()).length());
  }
});


// 📊 Vanntettingen i Mengder: injeksjonsslange i løpemeter, Cemflex i
// løpemeter MED omlegg (5 cm per skjøt) og antall plater.
export function leggVannIMengder(groups, rows) {
  const plateM = S.stopePlateM || 2;
  for (const e of synlige(S.stopeplan)) for (const v of e.vanntetting || []) {
    const L = vannLengde(v);
    const erC = v.type === "cemflex";
    const p = erC ? cemflexPlan(L, v.lukket, plateM, CEMFLEX_OMLEGG_M) : null;
    const navn = erC ? t("Cemflex-plater") : t("Injeksjonsslange");
    const key = navn + " · " + t("Vanntetting");
    const len = erC ? p.lmMedOmlegg : L;
    if (!groups.has(key)) groups.set(key, { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0,
      utenVekt: 0, umulige: 0, nominelle: 0, type: "Vanntetting", material: navn });
    const g = groups.get(key);
    g.count += erC ? p.plater : 1; g.length += len; g.utenVekt++;
    rows.push({ key, name: navn + " · " + e.navn, objType: t("Vanntetting"), type: "Vanntetting", material: navn,
      L: len, B: 0, H: 0, len, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0, kjentVekt: false,
      umuligVolum: false, vektKilde: "", profil: "", nomKgPerM: 0, avvik: null });
  }
}
