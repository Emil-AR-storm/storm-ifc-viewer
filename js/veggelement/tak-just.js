// 🔧 «JUSTER TRP» — håndjustering av takplatene (Emil 21.09).
//
// Samme oppskrift som «Juster blikk» fikk i runde 2b, og av samme grunn:
// justeringen er et TILLEGG oppå det regnede, ikke et frosset tak. Stålet kan
// leses på nytt uten at justeringene ryker.
//
// Fire operasjoner, de samme som på blikket:
//   · slå av og på en plate
//   · dra enden kortere eller lengre
//   · legge til en plate
//   · egen bredde på en plate
//
// Reglene bor i js/sw-tak.js (justerPlater, plateId, summerFlate). Her er bare
// plukkingen i 3D og verktøylinja.
import { $, apnePanel, esc, S } from "../state.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { camera, canvas, raycaster } from "../scene.js";
import { tilMm, tilScene } from "./regler.js";
import { lagret, skrivLagret, swGroup } from "./tilstand.js";
import { tegnAlt } from "./tegning.js";
import { snapKandidater, snapVerdi } from "../sw-tak.js";

export let takJust = null;   // { valgt: Set<id>, drar, markorer, legger } når aktiv
export function settTakJust(v) { takJust = v; }

// Alle platene i 3D, slått opp på id. Tegningen fyller denne.
export const takMeshPerId = new Map();
export function nullstillTakMesh() { takMeshPerId.clear(); }
export function husTakMesh(id, m, info) {
  if (!id) return;
  if (!takMeshPerId.has(id)) takMeshPerId.set(id, { mesher: [], info });
  takMeshPerId.get(id).mesher.push(m);
}

function tilstand() {
  if (!lagret) return null;
  if (!lagret.tak || typeof lagret.tak !== "object") return null;
  const t2 = lagret.tak;
  if (!t2.just || typeof t2.just !== "object") t2.just = {};
  if (!Array.isArray(t2.ekstra)) t2.ekstra = [];
  if (!(Number(t2.nesteNr) > 0)) t2.nesteNr = 1;
  return t2;
}

export function takJustBarEl() {
  let el = $("takJustBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "takJustBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;flex-wrap:wrap;max-width:92vw;" +
      "background:var(--panel);border:1px solid var(--border);border-radius:10px;" +
      "padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

export function tegnTakJustBar(paaNytt) {
  const el = takJustBarEl();
  if (!takJust) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const b = tilstand();
  if (!b) return;
  const n = takJust.valgt.size;
  const avSlatt = [...takJust.valgt].filter(id => (b.just[id] || {}).av).length;
  const forste = [...takJust.valgt][0];
  const d = forste ? takMeshPerId.get(forste) : null;
  const info = d && d.info;
  el.innerHTML =
    '<span style="font-size:12px;max-width:360px">' +
    esc(t("Trykk på en takplate og dra i enden. Shift+klikk for å ta flere.")) +
    ' <b>' + esc(t("{0} valgt", n)) + '</b>' +
    (info ? ' <span style="color:var(--muted)">' +
      esc(t("Takflate {0} · {1} mm", (info.flate || 0) + 1, Math.round(info.lengdeMm || 0))) +
      '</span>' : "") + '</span>' +
    '<button id="tjAv" style="padding:3px 10px"' + (n ? "" : " disabled") + '>' +
      (avSlatt === n && n ? "👁 " + esc(t("Slå på")) : "🚫 " + esc(t("Slå av"))) + '</button>' +
    '<label style="font-size:12px;display:flex;gap:4px;align-items:center">' + esc(t("Bredde (mm)")) +
      '<input id="tjBredde" type="number" step="10" min="0" style="width:82px;padding:2px 4px"' +
      (n ? "" : " disabled") + ' value="' + esc(String(breddeNaa(forste))) + '"></label>' +
    '<button id="tjLegg" style="padding:3px 10px"' + (takJust.legger ? ' class="primary"' : "") + '>' +
      '➕ ' + esc(t("Legg til plate")) + '</button>' +
    '<button id="tjNull" style="padding:3px 10px">' + esc(t("Nullstill")) + '</button>' +
    '<button id="tjFerdig" class="primary" style="padding:3px 10px">' + esc(t("Ferdig")) + '</button>';
  $("tjAv").onclick = () => {
    const pa = avSlatt === n && n;
    for (const id of takJust.valgt) {
      const j = b.just[id] || (b.just[id] = {});
      if (pa) delete j.av; else j.av = true;
      if (!Object.keys(j).length) delete b.just[id];
    }
    lagreOgTegn(paaNytt);
  };
  $("tjBredde").onchange = () => {
    const v = Number($("tjBredde").value);
    for (const id of takJust.valgt) {
      const j = b.just[id] || (b.just[id] = {});
      if (Number.isFinite(v) && v > 0) j.breddeMm = v; else delete j.breddeMm;
      if (!Object.keys(j).length) delete b.just[id];
    }
    lagreOgTegn(paaNytt);
  };
  $("tjLegg").onclick = () => {
    takJust.legger = takJust.legger ? null : true;
    tegnTakJustBar(paaNytt);
  };
  $("tjNull").onclick = () => {
    if (!confirm(t("Nullstille alle håndjusteringene av takplatene?"))) return;
    b.just = {}; b.ekstra = [];
    takJust.valgt.clear();
    lagreOgTegn(paaNytt);
  };
  $("tjFerdig").onclick = () => avsluttTakJuster(paaNytt);
}

function breddeNaa(id) {
  const b = tilstand();
  const j = (b && b.just && b.just[id]) || {};
  if (Number.isFinite(Number(j.breddeMm))) return Number(j.breddeMm);
  const d = takMeshPerId.get(id);
  return d && d.info ? Math.round(d.info.breddeMm || 0) : "";
}

export function lagreOgTegn(paaNytt) {
  skrivLagret();
  tegnAlt();
  merkTakValgte();
  tegnTakJustBar(paaNytt);
  if (paaNytt) paaNytt();
}

// Blå markering rundt de valgte platene — samme språk som veggjusteringen.
export function merkTakValgte() {
  if (!takJust) return;
  const g = takJust.markorer;
  g.children.slice().forEach(m => g.remove(m));
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true,
    opacity: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  for (const id of takJust.valgt) {
    const d = takMeshPerId.get(id);
    if (!d) continue;
    for (const m of d.mesher) {
      if (!m.geometry) continue;
      const k = new THREE.Mesh(m.geometry, mat);
      k.position.copy(m.position);
      k.quaternion.copy(m.quaternion);
      k.scale.copy(m.scale);
      k.renderOrder = 999;
      k.raycast = () => {};
      g.add(k);
    }
  }
}

export function startTakJuster(paaNytt) {
  if (!lagret || !lagret.tak || !lagret.tak.pa) { alert(t("Trykk «Generer tak» først.")); return; }
  tegnAlt();                       // meshene må bære id-ene før vi plukker
  const markorer = new THREE.Group();
  swGroup.add(markorer);
  settTakJust({ valgt: new Set(), drar: null, markorer, legger: null, tegnPanel: paaNytt });
  $("blikkPanel")?.classList.remove("open");
  tegnTakJustBar(paaNytt);
}

export function avsluttTakJuster(paaNytt) {
  if (!takJust) return;
  swGroup.remove(takJust.markorer);
  settTakJust(null);
  tegnTakJustBar(paaNytt);
  if (paaNytt) paaNytt();
  apnePanel("blikkPanel");
}

// Hvilken takplate ligger under musa?
export function pekTak(cx, cy) {
  if (!canvas || !camera || !raycaster) return null;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const treff = raycaster.intersectObjects(swGroup.children, true)
    .find(h => h.object && h.object.userData && h.object.userData.trpId);
  return treff ? { id: treff.object.userData.trpId, punkt: treff.point } : null;
}

const n = (x) => Number(x) || 0;
const tallEr = (x) => Number.isFinite(Number(x));

// Takoppsettet uten å dra inn tak.js (som importerer denne fila).
function takOppsettNaa() {
  const o = (lagret && lagret.takOppsett) || {};
  return { endeOverlappMm: tallEr(o.endeOverlappMm) ? Number(o.endeOverlappMm) : 150,
           snapDragTolMm: tallEr(o.snapDragTolMm) ? Number(o.snapDragTolMm) : 200 };
}

// Åsene på flata, i ABSOLUTT u — de ligger lagret sammen med flata.
function aserAbsFor(fi) {
  const F = (lagret && lagret.tak && lagret.tak.snap && lagret.tak.snap.flater) || [];
  const f = F[fi];
  return (f && Array.isArray(f.skjotU)) ? f.skjotU : [];
}

// Posisjonen langs platas eget løp (u), i mm.
export function takLopMm(id, punkt) {
  const d = takMeshPerId.get(id);
  if (!d || !d.info || !punkt || !d.info.U) return null;
  const i = d.info, o = i.origo, U = i.U;
  const hh = U.x * U.x + U.z * U.z;
  if (!(hh > 1e-12)) return null;
  const dx = tilMm(punkt.x) - o.x, dz = tilMm(punkt.z) - o.z;
  return (dx * U.x + dz * U.z) / hh;
}

window.addEventListener("pointerdown", (e) => {
  if (!takJust || e.button !== 0 || e.target !== canvas) return;
  const treff = pekTak(e.clientX, e.clientY);
  if (!treff) { takJust.drar = null; return; }
  const b = tilstand();
  if (!b) return;
  // ➕ LEGG TIL: ett trykk på en plate gir en ny plate ved siden av den
  if (takJust.legger) {
    const d = takMeshPerId.get(treff.id);
    if (d && d.info) {
      const i = d.info;
      const nr = b.nesteNr++;
      const id = "t:" + i.flate + ":lagt:" + nr;
      b.ekstra.push({ id, fi: i.flate, vFra: Math.round(i.vFra + i.breddeMm),
        breddeMm: Math.round(i.breddeMm), uFra: Math.round(i.uFra), uTil: Math.round(i.uTil) });
      takJust.legger = null;
      takJust.valgt.clear();
      takJust.valgt.add(id);
      lagreOgTegn(takJust.tegnPanel);
    }
    e.stopPropagation();
    return;
  }
  if (e.shiftKey) {
    if (takJust.valgt.has(treff.id)) takJust.valgt.delete(treff.id);
    else takJust.valgt.add(treff.id);
    e.stopPropagation();
    merkTakValgte(); tegnTakJustBar(takJust.tegnPanel);
    return;
  }
  if (!takJust.valgt.has(treff.id)) { takJust.valgt.clear(); takJust.valgt.add(treff.id); }
  const startMm = takLopMm(treff.id, treff.punkt);
  const d = takMeshPerId.get(treff.id);
  if (startMm === null || !d) { merkTakValgte(); tegnTakJustBar(takJust.tegnPanel); return; }
  const midt = (d.info.uFra + d.info.uTil) / 2;
  const base = new Map();
  for (const id of takJust.valgt) {
    const j = b.just[id] || {};
    base.set(id, { dFra: Number(j.dFra) || 0, dTil: Number(j.dTil) || 0 });
  }
  const ende = startMm < midt ? "fra" : "til";
  takJust.drar = { id: treff.id, ende, startMm, base,
    // 🧲 kanten slik den står NÅ — snappingen regnes mot denne, ikke mot
    // museposisjonen, så et snap ikke flytter seg videre for hvert musepiksel
    kantStart: ende === "fra" ? d.info.uFra : d.info.uTil };
  e.stopPropagation();
  merkTakValgte(); tegnTakJustBar(takJust.tegnPanel);
}, true);

window.addEventListener("pointermove", (e) => {
  if (!takJust || !takJust.drar) return;
  const d = takJust.drar;
  const naMm = takLopMm(d.id, pekPlan(e.clientX, e.clientY, d.id));
  if (naMm === null) return;
  let delta = Math.round((naMm - d.startMm) / 5) * 5;
  const b = tilstand();
  if (!b) return;
  // 🧲 SNAPPING (Emil 22.09). Bare når ÉN plate er valgt: drar du flere
  // samtidig har de hver sin kant, og et snap på den ene ville flyttet de
  // andre til et sted ingen har pekt på.
  if (takJust.valgt.size === 1 && tallEr(d.kantStart)) {
    const meg = takMeshPerId.get(d.id);
    const fi = meg && meg.info ? meg.info.flate : null;
    const kanter = [];
    for (const [id2, d2] of takMeshPerId) {
      if (id2 === d.id || !d2.info || d2.info.flate !== fi) continue;
      kanter.push(d2.info.uFra, d2.info.uTil);
    }
    const o = takOppsettNaa();
    const kand = snapKandidater(d.ende, aserAbsFor(fi), kanter, o.endeOverlappMm);
    const raa = n(d.kantStart) + delta;
    const snappet = snapVerdi(raa, kand, o.snapDragTolMm);
    delta = Math.round(snappet - n(d.kantStart));
  }
  for (const id of takJust.valgt) {
    const basis = d.base.get(id);
    if (!basis) continue;
    const j = b.just[id] || (b.just[id] = {});
    if (d.ende === "fra") j.dFra = basis.dFra - delta; else j.dTil = basis.dTil + delta;
  }
  skrivLagret();
  tegnAlt();
  merkTakValgte();
  e.stopPropagation();
}, true);

window.addEventListener("pointerup", (e) => {
  if (!takJust || e.button !== 0 || !takJust.drar) return;
  takJust.drar = null;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  lagreOgTegn(takJust.tegnPanel);
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && takJust) { e.stopPropagation(); avsluttTakJuster(takJust.tegnPanel); }
}, true);

// Takflatas eget plan, så draget følger musa også utenfor selve plata.
const _tPlan = new THREE.Plane(), _tPkt = new THREE.Vector3();
export function pekPlan(cx, cy, id) {
  const d = takMeshPerId.get(id);
  if (!d || !d.info || !d.info.N || !canvas || !camera || !raycaster) return null;
  const i = d.info, o = i.origo, N = i.N;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  _tPlan.setFromNormalAndCoplanarPoint(new THREE.Vector3(N.x, N.y, N.z).normalize(),
    new THREE.Vector3(tilScene(o.x), tilScene(o.y), tilScene(o.z)));
  return raycaster.ray.intersectPlane(_tPlan, _tPkt) ? _tPkt.clone() : null;
}
