// 🏠 TAKPLATENE PÅ BYGGEPLASSEN — bare visning (Emil 30.09.2026).
//
// «Takplater kommer ikke opp i storm byggeplass»: generatoren la dem på taket
// på kontoret, men de ble aldri sendt ut. Kontoret sender nå hver plate som
// omriss i takflata (takForByggeplass i js/veggelement/tak.js), og her tegnes
// de som flate plater med kant — ingen bølgeprofil. Den er pynt, og koster
// rammer på en telefon (samme valg som sw-lett.js gjorde for veggblikket).
//
// Trykk på en plate viser kode og mål i egenskapspanelet, og den kan skjules,
// som veggelementene. Bare byggeplass-siden (importeres av lett-main.js).
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, flyTil, raycaster, scene } from "./scene.js";
import { vaskTakLett } from "./sw-tak.js";

export const takLettGroup = new THREE.Group();
takLettGroup.name = "tak-lett";
scene.add(takLettGroup);

let data = null;          // { farge, plater } fra vaskTakLett
let tegnede = [];         // id-ene som står i scenen nå (testene teller disse)
export function tegnedeIder() { return tegnede.slice(); }
const skjultId = new Set();
const valgt = new Set();
const SEL = 0x3b82f6;

function morkere(hex) {
  const n = parseInt(String(hex || "#8fa3b8").slice(1), 16);
  const k = (v) => Math.max(0, Math.round(v * 0.62));
  return (k(n >> 16 & 255) << 16) | (k(n >> 8 & 255) << 8) | k(n & 255);
}

function rydd() {
  while (takLettGroup.children.length) {
    const g = takLettGroup.children.pop();
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

// Ett omriss (konvekst, fra omrissIPlanet) → vifte av trekanter + kantlinje.
export function platePosisjoner(pts) {
  const pos = [];
  for (let i = 1; i + 1 < pts.length; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
  return pos;
}

function tegn() {
  rydd();
  tegnede = [];
  if (!data) return;
  for (const p of data.plater) {
    if (skjultId.has(p.id)) continue;
    const g = new THREE.Group();
    g.userData.takLettId = p.id;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(platePosisjoner(p.p)), 3));
    geo.computeVertexNormals();
    const flate = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: valgt.has(p.id) ? SEL : p.farge, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    }));
    // Line med første hjørne gjentatt til slutt (i stedet for LineLoop) —
    // samme strek, og testenes three-stubb kjenner den.
    const ring = p.p.concat([p.p[0]]).map(q => new THREE.Vector3(q[0], q[1], q[2]));
    const kant = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: morkere(p.farge) }));
    kant.raycast = () => {};
    g.add(flate, kant);
    takLettGroup.add(g);
    tegnede.push(p.id);
  }
}

function senter(p) {
  const c = new THREE.Vector3();
  for (const q of p.p) c.add(new THREE.Vector3(q[0], q[1], q[2]));
  return c.divideScalar(p.p.length || 1);
}

// markers.js (lettmodus) med `tak`-feltet fra Workeren. Gamle filer: null.
S.settTakFraLett = (d) => { data = vaskTakLett(d); valgt.clear(); tegn(); };
S.ryddTakLett = () => { data = null; skjultId.clear(); valgt.clear(); rydd(); };

const _ndc = new THREE.Vector2();
registrerEkstraGruppe(takLettGroup, {
  id: "tak",
  navn: "Takplater",
  noeSkjult: () => skjultId.size > 0,
  visAlt() { if (!skjultId.size) return; skjultId.clear(); tegn(); },
  skjulTilstand: () => ({ ider: [...skjultId] }),
  settSkjulTilstand(v) { skjultId.clear(); for (const id of ((v && v.ider) || [])) skjultId.add(String(id)); tegn(); },
  mengder: () => {},
  sokRader: () => ((data && data.plater) || []).filter(p => p.kode).map(p => ({
    id: p.id, navn: p.kode, under: t("TRP-takplate") + " · " + p.l + "×" + p.b + " mm",
    s: (p.kode + " trp " + t("TRP-takplate")).toLowerCase()
  })),
  plukk(cx, cy) {
    if (!takLettGroup.visible || !takLettGroup.children.length) return null;
    const r = canvas.getBoundingClientRect();
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    const treff = raycaster.intersectObjects(takLettGroup.children, true);
    for (const h of treff) {
      let o = h.object;
      while (o && o.userData.takLettId === undefined) o = o.parent;
      if (o) return { id: o.userData.takLettId, avstand: h.distance };
    }
    return null;
  },
  velg(ider) { valgt.clear(); for (const id of (ider || [])) valgt.add(String(id)); tegn(); },
  valgte: () => [...valgt],
  skjul(ider) {
    for (const id of (ider || [])) { skjultId.add(String(id)); valgt.delete(String(id)); }
    tegn();
    if ($("propPanel")) $("propPanel").classList.remove("open");
  },
  gaTil(id) {
    const p = data && data.plater.find(x => x.id === String(id));
    if (!p) return;
    flyTil(senter(p), Math.max(p.l, p.b) / 1000 / (S.enhetSkala || 1));
    this.velg([id]);
    this.visEgenskaper(id);
  },
  visEgenskaper(id) {
    const p = data && data.plater.find(x => x.id === String(id));
    if (!p || !$("propTitle")) return;
    const rad = (k, v, navn) => '<div class="prop-row"' + (navn ? " data-navn" : "") + '><div class="k">' + esc(k) +
      '</div><div class="v">' + esc(String(v)) + '</div></div>';
    $("propTitle").textContent = t("TRP-takplate");
    $("propBody").innerHTML =
      '<div class="prop-actions"><button id="paSkjulTak">' + ikon("skjul") + " " + esc(t("Skjul denne plata")) + "</button></div>" +
      (p.kode ? rad(t("Kode"), p.kode, true) : "") +
      (p.l ? rad(t("Lengde"), p.l + " mm") : "") +
      (p.b ? rad(t("Bredde"), p.b + " mm") : "");
    $("paSkjulTak").onclick = () => this.skjul([id]);
    apnePanel("propPanel");
  }
});
