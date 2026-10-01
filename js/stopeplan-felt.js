// 🧱 Støpeplan i 3D — TRINN 3: felt på plata (kontor). Variant C, Emils valg
// 01.10: stiplet fugestrek, hvite hjørneprikker, gule prikker midt på hver
// kant, og mållapper på kantene mens du tegner og drar.
//
// HVA DU KAN GJØRE
//   «+ Felt» på en etappe → trykk på plata (høyden og tykkelsen hentes fra
//   det du trykket på) → andre trykk gir rektangelet. Polygon: trykk i hvert
//   hjørne, dobbeltklikk (eller Enter, eller trykk på første hjørne) avslutter.
//   Med støpeplanpanelet åpent: trykk på et felt for å velge det. Da kan du
//     · dra et hjørne (hvit prikk)
//     · dra en hel kant (gul prikk) — den flyttes rett ut, så et rektangel
//       forblir et rektangel
//     · dra inne i feltet for å flytte hele feltet
//     · dobbeltklikke på en kant for et nytt hjørne
//     · Delete: sletter hjørnet du sist dro (er det bare tre igjen, feltet)
//     · Ctrl+Z angrer alt over
//   Hjørner og kanter SNAPPER mot de andre feltene, og et hjørne to felt
//   deler, flytter begge (flyttPunkter i stopeplan-regn.js) — ingen glipe,
//   ingen overlapp.
//
// Bygget på samme mønster som riggens gjerder (rigg.js): lyttere på window i
// fangstfasen, som stopper hendelsen når et drag er vårt — da roterer ikke
// kameraet samtidig.
import * as THREE from "three";
import { $, S, esc } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, frameHooks, makeLabel, raycaster, renderer, scene, updateScreenScaled } from "./scene.js";
import { elementBoxById, hitID } from "./elements.js";
import {
  FELT_TOL_M, feltAreal, finnFelt, fjernFelt, fjernHjorne, flyttPunkter, kantLengde, leggTilFelt,
  feltKanter, fjernVann, leggTilVann, leggTilHjorne, nyttFelt, rektangel, settKantLengde as _settKant, snappFelt, synlige, vaskEtappeListe
} from "./stopeplan-regn.js";
import { feltBase, feltMeshListe, stopeGroup, tegnStopeplan, tilBygg, tilScene } from "./stopeplan-vis.js";
import { lagre, tegnPanel } from "./stopeplan.js";

// ═══════════════════════ TILSTAND ═══════════════════════
let tegner = null;     // { etappeId, form: "rekt"|"poly", by, tykkelseM, punkter: [[bx,bz]], peker }
let valgtFelt = null;  // felt-id
let aktivHjorne = null; // { feltId, i } — det sist dratte hjørnet (Delete sletter det)
let drar = null;       // { type, feltId, i, start, liste0, beveget }
let ned = null;        // { x, y } der pekeren gikk ned
let vann = null;       // 💧 trinn 6: { feltId, etappeId, type, valgt: Set<kantnr> }

export const feltValgt = () => valgtFelt;
export const tegnerFelt = () => (tegner ? tegner.etappeId : null);

// Håndtak og mållapper: egen gruppe, skjermskalert (konstant størrelse).
export const handtakGroup = new THREE.Group();
handtakGroup.name = "stopeplan-handtak";
scene.add(handtakGroup);
frameHooks.push(() => updateScreenScaled(handtakGroup));

const erApen = () => { const p = $("stopePanel"); return !!(p && p.classList.contains("open")); };
const aktiv = () => erApen() && !S.velgModusAktiv && !S.mode;
const overCanvas = (e) => e.target === canvas;
const m2 = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " m²";
const mTekst = (v) => v.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";

// ═══════════════════════ PEKER → BYGGRAMMEN ═══════════════════════
const _ndc = new THREE.Vector2(), _plan = new THREE.Plane(), _p = new THREE.Vector3();
function settNdc(x, y) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
}
// Pekeren på det vannrette planet i høyde `by` (byggrammen, meter).
function paaPlan(x, y, by) {
  const B = feltBase();
  if (!B) return null;
  settNdc(x, y);
  _plan.set(new THREE.Vector3(0, 1, 0), -(B.c.y + by / B.skala));
  if (!raycaster.ray.intersectPlane(_plan, _p)) return null;
  const b = tilBygg(_p, B);
  return [b.bx, b.bz];
}
// Hvor mange meter i byggrammen ett skjermpiksel er, der pekeren treffer.
function meterPerPx(bx, bz, by) {
  const B = feltBase();
  const p = tilScene(bx, bz, by, B);
  if (!p) return 0.05;
  const k = 2 * Math.tan(camera.fov * Math.PI / 360) / renderer.domElement.clientHeight;
  return p.distanceTo(camera.position) * k * B.skala;
}
const SNAPP_PX = 12;

// Første trykk: hva ligger under pekeren? Toppen av det og tykkelsen.
// Alt synlig i scenen teller (modellen, SW-gulvet, terrenget) — men ikke
// støpeplanens egne flater og ikke merkelapper.
function treffUnder(x, y) {
  settNdc(x, y);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    let o = h.object, ok = o.isMesh && !o.isSprite;
    for (let p = o; p && ok; p = p.parent) if (!p.visible || p === stopeGroup || p === handtakGroup) ok = false;
    if (!ok) continue;
    return h;
  }
  return null;
}
function hoydeOgTykkelse(h) {
  const B = feltBase();
  let boks = null;
  try {
    const id = h.object.userData && (h.object.userData.merged ? hitID(h) : h.object.userData.expressID);
    if (id != null && h.object.userData.merged) boks = elementBoxById(id);
    if (!boks) boks = new THREE.Box3().setFromObject(h.object);
  } catch (_) { boks = null; }
  const tkM = boks ? (boks.max.y - boks.min.y) * B.skala : 0;
  // En «plate» er tynn. Traff du en vegg eller en søyle, er høyden der du
  // trykket toppen, og tykkelsen settes til 250 mm — rett den i panelet.
  if (boks && tkM > 0.04 && tkM <= 1.5 && Math.abs(boks.max.y - h.point.y) * B.skala < 0.05) {
    return { by: (boks.max.y - B.c.y) * B.skala, tykkelseM: tkM };
  }
  return { by: (h.point.y - B.c.y) * B.skala, tykkelseM: 0.25 };
}

// ═══════════════════════ TEGNING AV ET NYTT FELT ═══════════════════════
function feltBar() {
  let el = $("stFeltBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "stFeltBar";
    el.className = "st-velgbar";
    document.body.appendChild(el);
  }
  return el;
}
function tegnFeltBar() {
  const el = feltBar();
  if (!tegner) { el.style.display = "none"; el.innerHTML = ""; return; }
  const e = synlige(S.stopeplan).find(x => x.id === tegner.etappeId);
  const hjelp = tegner.by == null
    ? t("Trykk på plata der det første hjørnet skal være.")
    : tegner.form === "rekt"
      ? t("Trykk der det motsatte hjørnet skal være.")
      : t("Trykk i hvert hjørne. Dobbeltklikk, Enter eller trykk på første hjørne for å avslutte.");
  el.style.display = "flex";
  el.innerHTML =
    '<span class="st-velg-farge" style="background:' + esc(e ? e.farge : "#888") + '"></span>' +
    '<span class="st-velg-tekst"><b>' + esc(t("Nytt felt i {0}", e ? e.navn : "")) + "</b><br>" + esc(hjelp) + "</span>" +
    '<span class="st-form">' +
      '<button data-form="rekt" class="' + (tegner.form === "rekt" ? "aktiv" : "") + '">' + esc(t("Rektangel")) + "</button>" +
      '<button data-form="poly" class="' + (tegner.form === "poly" ? "aktiv" : "") + '">' + esc(t("Polygon")) + "</button>" +
    "</span>" +
    '<button id="stFeltAvbryt">' + esc(t("Avbryt")) + "</button>";
  el.querySelectorAll("button[data-form]").forEach(b => b.onclick = () => {
    if (!tegner) return;
    tegner.form = b.dataset.form;
    tegner.punkter = [];
    if (tegner.form === "rekt" && tegner.by != null && tegner.start) tegner.punkter = [tegner.start];
    tegnFeltBar(); tegnHandtak();
  });
  $("stFeltAvbryt").onclick = () => avbrytTegning();
}

export function startTegning(etappeId) {
  if (S.velgModusAktiv && S.avsluttVelgModus) S.avsluttVelgModus();
  tegner = { etappeId, form: "rekt", by: null, tykkelseM: 0.25, punkter: [], peker: null };
  valgtFelt = null; aktivHjorne = null;
  tegnFeltBar(); tegnHandtak(); tegnPanel();
}
export function avbrytTegning() {
  tegner = null;
  tegnFeltBar(); tegnHandtak(); tegnPanel();
}

function fullfor() {
  if (!tegner) return;
  let punkter = tegner.punkter.slice();
  if (tegner.form === "rekt") {
    if (punkter.length < 2) return;
    punkter = rektangel(punkter[0], punkter[1]);
  }
  // to trykk på samme sted (dobbeltklikket) slås sammen
  punkter = punkter.filter((p, i) => i === 0 || Math.hypot(p[0] - punkter[i - 1][0], p[1] - punkter[i - 1][1]) > FELT_TOL_M);
  if (punkter.length > 3 && Math.hypot(punkter[0][0] - punkter[punkter.length - 1][0], punkter[0][1] - punkter[punkter.length - 1][1]) <= FELT_TOL_M) punkter.pop();
  if (punkter.length < 3 || feltAreal({ punkter }) < 0.01) return;
  const f = nyttFelt(punkter, tegner.by, tegner.tykkelseM);
  const id = tegner.etappeId;
  tegner = null;
  endre(leggTilFelt(S.stopeplan, id, f, new Date().toISOString()), "Felt tegnet");
  valgtFelt = f.id;
  tegnFeltBar(); tegnHandtak(); tegnPanel();
}

// Pekeren under tegning, snappet mot de andre feltene.
function tegnePunkt(x, y) {
  const p = paaPlan(x, y, tegner.by);
  if (!p) return null;
  return snappFelt(S.stopeplan, p, SNAPP_PX * meterPerPx(p[0], p[1], tegner.by)).punkt;
}

// ═══════════════════════ ENDRINGER (med angre) ═══════════════════════
function endre(ny, tekst, for_) {
  const forrige = for_ || vaskEtappeListe(S.stopeplan);
  S.stopeplan = vaskEtappeListe(ny);
  lagre();
  tegnStopeplan();
  tegnHandtak();
  tegnPanel();
  const etter = vaskEtappeListe(S.stopeplan);
  if (S.pushAngre) S.pushAngre({
    tekst,
    angre: () => { S.stopeplan = forrige; lagre(); tegnStopeplan(); sjekkValgt(); tegnHandtak(); tegnPanel(); },
    gjenopprett: () => { S.stopeplan = etter; lagre(); tegnStopeplan(); sjekkValgt(); tegnHandtak(); tegnPanel(); }
  });
}
function sjekkValgt() { if (valgtFelt && !finnFelt(S.stopeplan, valgtFelt)) { valgtFelt = null; aktivHjorne = null; } }

export function velgFelt(id) {
  valgtFelt = id && finnFelt(S.stopeplan, id) ? id : null;
  aktivHjorne = null;
  tegnHandtak(); tegnPanel();
}
export function slettFelt(id) {
  if (valgtFelt === id) { valgtFelt = null; aktivHjorne = null; }
  endre(fjernFelt(S.stopeplan, id, new Date().toISOString()), "Felt slettet");
}
export function settTykkelse(id, mm) {
  const tk = Number(mm) / 1000;
  if (!(tk > 0)) return;
  const naa = new Date().toISOString();
  const liste = vaskEtappeListe(S.stopeplan).map(e => (e.slettet || !(e.felt || []).some(f => f.id === id)) ? e
    : Object.assign({}, e, { felt: e.felt.map(f => f.id === id ? Object.assign({}, f, { tykkelseM: tk }) : f), endret: naa }));
  endre(liste, "Tykkelse endret");
}
function settKantLengdeUI(id, i, meter) {
  endre(_settKant(S.stopeplan, id, i, meter, new Date().toISOString()), "Mål endret");
}

// ═══════════════════════ HÅNDTAK OG MÅLLAPPER ═══════════════════════
function prikkTekstur(farge) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  if (g) {
    g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2);
    g.fillStyle = farge; g.fill();
    g.lineWidth = 3; g.strokeStyle = "#111"; g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
let _hvit = null, _gul = null;
function prikk(p, gul) {
  if (!_hvit) { _hvit = prikkTekstur("#ffffff"); _gul = prikkTekstur("#f5b800"); }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gul ? _gul : _hvit, depthTest: false, transparent: true }));
  s.position.copy(p);
  s.renderOrder = 999;
  s.userData.px = gul ? 11 : 13;
  s.userData.aspect = 1;
  return s;
}
// Lappen står litt UTENFOR kanten (bort fra feltets midte), så den ikke
// dekker den gule kantprikken som ligger midt på kanten.
function maalLapp(a, b, by, midt) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.05) return null;
  const lapp = makeLabel(mTekst(L), "#f5b800");
  lapp.userData.px = 22;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
  if (midt && (mx - midt[0]) * nx + (mz - midt[1]) * nz < 0) { nx = -nx; nz = -nz; }
  const ut = 26 * meterPerPx(mx, mz, by);
  lapp.position.copy(tilScene(mx + nx * ut, mz + nz * ut, by + 0.05));
  return lapp;
}
const midtAv = (P) => [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];

function ryddHandtak() {
  while (handtakGroup.children.length) {
    const o = handtakGroup.children.pop();
    if (o.material) { if (o.material.map && o.material.map !== _hvit && o.material.map !== _gul) o.material.map.dispose(); o.material.dispose(); }
    if (o.geometry) o.geometry.dispose();
  }
}

// Hva står i gruppa nå — testene leser dette.
let handtakInfo = { hjorner: 0, kanter: 0, lapper: 0 };
export const handtakNaa = () => Object.assign({}, handtakInfo);

export function tegnHandtak() {
  ryddHandtak();
  handtakInfo = { hjorner: 0, kanter: 0, lapper: 0 };
  if (!S.modelGroup || !feltBase()) return;
  // Under tegning: kladden med mål
  if (tegner && tegner.by != null) {
    let pk = tegner.punkter.slice();
    if (tegner.peker) pk = pk.concat([tegner.peker]);
    if (tegner.form === "rekt" && pk.length >= 2) pk = rektangel(pk[0], pk[1]);
    const lukket = tegner.form === "rekt";
    const pos = pk.map(p => tilScene(p[0], p[1], tegner.by + 0.01));
    if (pos.length >= 2) {
      const lp = [];
      const n = lukket ? pos.length : pos.length - 1;
      for (let i = 0; i < n; i++) { const a = pos[i], b = pos[(i + 1) % pos.length]; lp.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lp), 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf5b800, depthTest: false }));
      l.renderOrder = 998;
      handtakGroup.add(l);
      for (let i = 0; i < n; i++) {
        const lapp = maalLapp(pk[i], pk[(i + 1) % pk.length], tegner.by, midtAv(pk));
        if (lapp) { handtakGroup.add(lapp); handtakInfo.lapper++; }
      }
    }
    for (const p of pos) { handtakGroup.add(prikk(p, false)); handtakInfo.hjorner++; }
    return;
  }
  // 💧 Velg kanter for vanntetting: valgte kanter gule, de andre hvite
  if (vann) {
    const vv = finnFelt(S.stopeplan, vann.feltId);
    if (!vv) return;
    const f = vv.felt, P = f.punkter, y = f.by + 0.02;
    const lp = { ja: [], nei: [] };
    for (let i = 0; i < P.length; i++) {
      const a = tilScene(P[i][0], P[i][1], y), b = tilScene(P[(i + 1) % P.length][0], P[(i + 1) % P.length][1], y);
      (vann.valgt.has(i) ? lp.ja : lp.nei).push(a.x, a.y, a.z, b.x, b.y, b.z);
      const m = P[i], q = P[(i + 1) % P.length];
      handtakGroup.add(prikk(tilScene((m[0] + q[0]) / 2, (m[1] + q[1]) / 2, y), vann.valgt.has(i))); handtakInfo.kanter++;
      const lapp = maalLapp(m, q, f.by, midtAv(P));
      if (lapp) { handtakGroup.add(lapp); handtakInfo.lapper++; }
    }
    for (const [k, farge] of [["ja", 0xf5b800], ["nei", 0xffffff]]) {
      if (!lp[k].length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lp[k]), 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: farge, depthTest: false, transparent: true, opacity: k === "ja" ? 1 : 0.6 }));
      l.renderOrder = 998;
      handtakGroup.add(l);
    }
    return;
  }
  const v = valgtFelt && finnFelt(S.stopeplan, valgtFelt);
  if (!v || !erApen()) return;
  const f = v.felt, P = f.punkter;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    handtakGroup.add(prikk(tilScene(a[0], a[1], f.by + 0.01), false)); handtakInfo.hjorner++;
    handtakGroup.add(prikk(tilScene((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, f.by + 0.01), true)); handtakInfo.kanter++;
  }
  // Mållappene i variant C: mens du drar — og på feltet som er valgt, så du
  // ser målene før du begynner (de er små og ligger på kanten).
  for (let i = 0; i < P.length; i++) {
    const lapp = maalLapp(P[i], P[(i + 1) % P.length], f.by, midtAv(P));
    if (lapp) { handtakGroup.add(lapp); handtakInfo.lapper++; }
  }
}

// Nærmeste håndtak på skjermen: { type: "hjorne"|"kant", i } eller null.
const _s = new THREE.Vector3();
function skjermPos(bx, bz, by) {
  const p = tilScene(bx, bz, by);
  if (!p) return null;
  _s.copy(p).project(camera);
  if (_s.z > 1) return null;
  const r = canvas.getBoundingClientRect();
  return [r.left + (_s.x + 1) / 2 * r.width, r.top + (1 - _s.y) / 2 * r.height];
}
function pekHandtak(x, y) {
  const v = valgtFelt && finnFelt(S.stopeplan, valgtFelt);
  if (!v) return null;
  const P = v.felt.punkter;
  let best = null, bestD = 14;
  for (let i = 0; i < P.length; i++) {
    const q = skjermPos(P[i][0], P[i][1], v.felt.by);
    if (q) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bestD) { bestD = d; best = { type: "hjorne", i }; } }
  }
  if (best) return best;
  bestD = 12;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const q = skjermPos((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, v.felt.by);
    if (q) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bestD) { bestD = d; best = { type: "kant", i }; } }
  }
  return best;
}
// Feltet under pekeren (eller null)
function pekFelt(x, y) {
  settNdc(x, y);
  const h = raycaster.intersectObjects(feltMeshListe(), false)[0];
  return h ? h.object.userData.feltId : null;
}
// Kanten nærmest pekeren på skjermen (for dobbeltklikk): { i, punkt } eller null
function pekKant(x, y) {
  const v = valgtFelt && finnFelt(S.stopeplan, valgtFelt);
  if (!v) return null;
  const P = v.felt.punkter;
  let best = null, bestD = 10;
  for (let i = 0; i < P.length; i++) {
    const a = skjermPos(P[i][0], P[i][1], v.felt.by), b = skjermPos(P[(i + 1) % P.length][0], P[(i + 1) % P.length][1], v.felt.by);
    if (!a || !b) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    if (L2 < 1) continue;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
    const d = Math.hypot(a[0] + u * dx - x, a[1] + u * dy - y);
    if (d < bestD && u > 0.05 && u < 0.95) { bestD = d; best = { i }; }
  }
  if (!best) return null;
  best.punkt = paaPlan(x, y, v.felt.by);
  return best.punkt ? best : null;
}

function slippKamera(e) {
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
}

// ═══════════════════════ PEKEREN ═══════════════════════
window.addEventListener("pointerdown", (e) => {
  ned = { x: e.clientX, y: e.clientY };
  if (!overCanvas(e) || e.button !== 0 || e.shiftKey) return;
  if (tegner) return;                     // tegningen tas på pointerup (drag = kamera)
  if (!aktiv() || !valgtFelt) return;
  const h = pekHandtak(e.clientX, e.clientY);
  const v = finnFelt(S.stopeplan, valgtFelt);
  if (!v) return;
  if (h || pekFelt(e.clientX, e.clientY) === valgtFelt) {
    e.stopPropagation();
    const start = paaPlan(e.clientX, e.clientY, v.felt.by);
    if (!start) return;
    drar = { type: h ? h.type : "felt", i: h ? h.i : -1, feltId: valgtFelt, start, by: v.felt.by,
      fra: v.felt.punkter.map(p => p.slice()), liste0: vaskEtappeListe(S.stopeplan), beveget: false };
    if (h && h.type === "hjorne") aktivHjorne = { feltId: valgtFelt, i: h.i };
  }
}, true);

window.addEventListener("pointermove", (e) => {
  if (tegner && tegner.by != null) {
    const p = tegnePunkt(e.clientX, e.clientY);
    if (p) { tegner.peker = p; tegnHandtak(); }
    return;
  }
  if (!drar) return;
  e.stopPropagation();
  const p = paaPlan(e.clientX, e.clientY, drar.by);
  if (!p) return;
  const tol = SNAPP_PX * meterPerPx(p[0], p[1], drar.by);
  let dx = p[0] - drar.start[0], dz = p[1] - drar.start[1];
  if (!drar.beveget && Math.hypot(e.clientX - ned.x, e.clientY - ned.y) < 3) return;
  drar.beveget = true;
  const F = drar.fra;
  let flytt, bare = null;
  if (drar.type === "hjorne") {
    const ny = snappFelt(drar.liste0, [F[drar.i][0] + dx, F[drar.i][1] + dz], tol, drar.feltId, [F[drar.i]]).punkt;
    flytt = [{ fra: F[drar.i], til: ny }];
  } else if (drar.type === "kant") {
    // Kanten flyttes RETT UT (langs normalen) — et rektangel forblir et rektangel
    const a = F[drar.i], b = F[(drar.i + 1) % F.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    const nx = -ez / L, nz = ex / L;
    let d = dx * nx + dz * nz;
    // snapp: midten av kanten mot de andre feltene
    const m = [(a[0] + b[0]) / 2 + nx * d, (a[1] + b[1]) / 2 + nz * d];
    const s = snappFelt(drar.liste0, m, tol, drar.feltId, [a, b]);
    if (s.type) d = (s.punkt[0] - (a[0] + b[0]) / 2) * nx + (s.punkt[1] - (a[1] + b[1]) / 2) * nz;
    flytt = [{ fra: a, til: [a[0] + nx * d, a[1] + nz * d] }, { fra: b, til: [b[0] + nx * d, b[1] + nz * d] }];
  } else {
    // Hele feltet: snapp det hjørnet som kommer nærmest et annet felt
    let best = null;
    for (const q of F) {
      const s = snappFelt(drar.liste0, [q[0] + dx, q[1] + dz], tol, drar.feltId);
      if (s.type) { const d = Math.hypot(s.punkt[0] - q[0] - dx, s.punkt[1] - q[1] - dz); if (!best || d < best.d) best = { d, kx: s.punkt[0] - q[0] - dx, kz: s.punkt[1] - q[1] - dz }; }
    }
    if (best) { dx += best.kx; dz += best.kz; }
    flytt = F.map(q => ({ fra: q, til: [q[0] + dx, q[1] + dz] }));
    bare = drar.feltId;
  }
  S.stopeplan = flyttPunkter(drar.liste0, flytt, null, bare);
  tegnStopeplan();
  tegnHandtak();
}, true);

window.addEventListener("pointerup", (e) => {
  const n = ned; ned = null;
  if (drar) {
    const d = drar; drar = null;
    e.stopPropagation(); slippKamera(e);
    if (!d.beveget) { S.stopeplan = d.liste0; return; }
    // Stemple de endrede etappene, så endringen vinner flettingen
    const naa = new Date().toISOString();
    const for0 = new Map(d.liste0.map(x => [x.id, JSON.stringify(x.felt)]));
    const ny = vaskEtappeListe(S.stopeplan).map(x => for0.get(x.id) !== JSON.stringify(x.felt) ? Object.assign({}, x, { endret: naa }) : x);
    endre(ny, d.type === "felt" ? "Felt flyttet" : d.type === "kant" ? "Kant flyttet" : "Hjørne flyttet", d.liste0);
    return;
  }
  if (!overCanvas(e) || e.button !== 0 || e.shiftKey) return;
  if (n && Math.hypot(e.clientX - n.x, e.clientY - n.y) > 6) return;   // et drag var kameraet
  // 💧 Velg kanter: trykk på en kant legger den til eller tar den bort
  if (vann) {
    e.stopPropagation(); slippKamera(e);
    const i = nærmesteKant(vann.feltId, e.clientX, e.clientY, 18);
    if (i != null) { if (vann.valgt.has(i)) vann.valgt.delete(i); else vann.valgt.add(i); tegnVannBar(); tegnHandtak(); }
    return;
  }
  if (tegner) {
    // Kameraet fikk pointerdown — det må få vite at trykket er over, ellers
    // tror det at knappen fortsatt holdes og roterer med neste musebevegelse.
    e.stopPropagation(); slippKamera(e);
    if (tegner.by == null) {
      const h = treffUnder(e.clientX, e.clientY);
      if (!h) return;
      const ht = hoydeOgTykkelse(h);
      tegner.by = ht.by; tegner.tykkelseM = ht.tykkelseM;
      const p = tegnePunkt(e.clientX, e.clientY);
      if (!p) { tegner.by = null; return; }
      tegner.start = p;
      tegner.punkter = [p];
      tegnFeltBar(); tegnHandtak();
      return;
    }
    const p = tegnePunkt(e.clientX, e.clientY);
    if (!p) return;
    if (tegner.form === "rekt") { tegner.punkter = [tegner.punkter[0], p]; fullfor(); return; }
    // polygon: trykk på første hjørne lukker
    const f0 = tegner.punkter[0];
    const q = skjermPos(f0[0], f0[1], tegner.by);
    if (tegner.punkter.length >= 3 && q && Math.hypot(q[0] - e.clientX, q[1] - e.clientY) < 12) { fullfor(); return; }
    tegner.punkter.push(p);
    tegnHandtak();
    return;
  }
  if (!aktiv()) return;
  const id = pekFelt(e.clientX, e.clientY);
  if (id) { e.stopPropagation(); slippKamera(e); if (id !== valgtFelt) velgFelt(id); return; }
  if (valgtFelt) velgFelt(null);   // trykk utenfor: slipp feltet (og la trykket gå videre)
}, true);

window.addEventListener("dblclick", (e) => {
  if (!overCanvas(e)) return;
  if (tegner && tegner.form === "poly") { e.stopPropagation(); e.preventDefault(); fullfor(); return; }
  if (!aktiv() || !valgtFelt) return;
  const k = pekKant(e.clientX, e.clientY);
  if (!k) return;
  e.stopPropagation(); e.preventDefault();
  endre(leggTilHjorne(S.stopeplan, valgtFelt, k.i, k.punkt, new Date().toISOString()), "Hjørne lagt til");
}, true);

window.addEventListener("keydown", (e) => {
  const iFelt = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (iFelt) return;
  if (vann) { if (e.key === "Escape") { e.stopPropagation(); avbrytVann(); } return; }
  if (tegner) {
    if (e.key === "Escape") { e.stopPropagation(); avbrytTegning(); }
    else if (e.key === "Enter" && tegner.form === "poly") { e.preventDefault(); fullfor(); }
    return;
  }
  if (!valgtFelt || !erApen()) return;
  if (e.key === "Escape") { e.stopPropagation(); velgFelt(null); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault(); e.stopPropagation();
    const v = finnFelt(S.stopeplan, valgtFelt);
    if (aktivHjorne && aktivHjorne.feltId === valgtFelt && v && v.felt.punkter.length > 3) {
      const i = aktivHjorne.i; aktivHjorne = null;
      endre(fjernHjorne(S.stopeplan, valgtFelt, i, new Date().toISOString()), "Hjørne slettet");
    } else slettFelt(valgtFelt);
  }
}, true);

// ═══════════ 💧 TRINN 6: VANNTETTING LANGS KANTENE ═══════════
// «+ Injeksjon» eller «+ Cemflex» på et felt: trykk på kantene den skal gå
// langs (eller «Hele omkretsen»), og «Ferdig». Injeksjonsslangen går som regel
// rundt hele (Emil 01.10), Cemflex ofte bare langs fugen mot neste støp.
function nærmesteKant(feltId, x, y, tolPx) {
  const v = finnFelt(S.stopeplan, feltId);
  if (!v) return null;
  const P = v.felt.punkter;
  let best = null, bestD = tolPx;
  for (let i = 0; i < P.length; i++) {
    const a = skjermPos(P[i][0], P[i][1], v.felt.by), b = skjermPos(P[(i + 1) % P.length][0], P[(i + 1) % P.length][1], v.felt.by);
    if (!a || !b) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    if (L2 < 1) continue;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
    const d = Math.hypot(a[0] + u * dx - x, a[1] + u * dy - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function vannBar() {
  let el = $("stVannBar");
  if (!el) { el = document.createElement("div"); el.id = "stVannBar"; el.className = "st-velgbar"; document.body.appendChild(el); }
  return el;
}
function vannValgtLengde() {
  const v = vann && finnFelt(S.stopeplan, vann.feltId);
  if (!v) return 0;
  let L = 0;
  for (const i of vann.valgt) L += kantLengde(v.felt, i);
  return L;
}
function tegnVannBar() {
  const el = vannBar();
  if (!vann) { el.style.display = "none"; el.innerHTML = ""; return; }
  const navn = vann.type === "cemflex" ? t("Cemflex-plater") : t("Injeksjonsslange");
  const n = vann.valgt.size;
  el.style.display = "flex";
  el.innerHTML =
    '<span class="st-velg-farge" style="background:' + (vann.type === "cemflex" ? "#b8c2cc" : "#f5b800") + '"></span>' +
    '<span class="st-velg-tekst"><b>' + esc(t("{0} langs kantene", navn)) + "</b><br>" +
      esc(t("Trykk på kantene den skal gå langs.")) + "</span>" +
    '<span class="st-velg-ant">' + esc(t("{0} kanter · {1}", n, mTekst(vannValgtLengde()))) + "</span>" +
    '<button id="stVannAlle">' + esc(t("Hele omkretsen")) + "</button>" +
    '<button id="stVannFerdig" class="primary"' + (n ? "" : " disabled") + ">" + esc(t("Ferdig")) + "</button>" +
    '<button id="stVannAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("stVannAlle").onclick = () => {
    const v = finnFelt(S.stopeplan, vann.feltId);
    if (!v) return;
    vann.valgt = new Set(v.felt.punkter.map((_, i) => i));
    tegnVannBar(); tegnHandtak();
  };
  $("stVannFerdig").onclick = () => ferdigVann();
  $("stVannAvbryt").onclick = () => avbrytVann();
}
export function startVann(feltId, type) {
  const v = finnFelt(S.stopeplan, feltId);
  if (!v) return;
  if (tegner) avbrytTegning();
  if (S.velgModusAktiv && S.avsluttVelgModus) S.avsluttVelgModus();
  vann = { feltId, etappeId: v.etappe.id, type, valgt: new Set() };
  valgtFelt = null; aktivHjorne = null;
  tegnVannBar(); tegnHandtak(); tegnPanel();
}
export function avbrytVann() { vann = null; tegnVannBar(); tegnHandtak(); tegnPanel(); }
function ferdigVann() {
  const v = vann && finnFelt(S.stopeplan, vann.feltId);
  if (!v || !vann.valgt.size) return;
  const ider = [...vann.valgt].sort((a, b) => a - b);
  const lukket = ider.length === v.felt.punkter.length;
  const ny = { id: "V-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    type: vann.type, kanter: feltKanter(v.felt, ider), by: v.felt.by, lukket, feltId: v.felt.id };
  const etappeId = vann.etappeId;
  vann = null;
  tegnVannBar();
  endre(leggTilVann(S.stopeplan, etappeId, ny, new Date().toISOString()), "Vanntetting lagt til");
}
export function slettVann(id) { endre(fjernVann(S.stopeplan, id, new Date().toISOString()), "Vanntetting slettet"); }

// ═══════════════════════ KROKER ═══════════════════════
S.stopeFelt = { startTegning, avbrytTegning, velgFelt, slettFelt, settTykkelse, settKantLengde: settKantLengdeUI,
  startVann, avbrytVann, slettVann, vann: () => (vann ? { feltId: vann.feltId, type: vann.type } : null),
  valgt: () => valgtFelt, tegner: () => (tegner ? tegner.etappeId : null), tegnHandtak };
// Panelet lukket eller ny modell: ingen håndtak og ingen halvferdig tegning
S.ryddStopeFelt = () => { tegner = null; drar = null; valgtFelt = null; aktivHjorne = null; vann = null; tegnFeltBar(); tegnVannBar(); ryddHandtak(); };
