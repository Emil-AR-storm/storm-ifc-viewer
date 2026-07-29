// ✂️ Snitt (akse og fra flate) og 🏢 etasjefilter – begge bruker klippeplan.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/web-ifc-api.js";
import { $, S, esc, fmtLen } from "./state.js";
import { val } from "./elements.js";
import { ifcApi, lightElementBoxes } from "./ifc.js";
import { modeBar, modeButtons, updateModeBar } from "./modes.js";
import { renderer } from "./scene.js";

// ---------- Snitt (clipping) ----------

// 📐 Fra flate: snittplanet legges parallelt med en flate brukeren trykker på

const axisVectors = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) };

$("btnClip").addEventListener("click", () => {
  S.clipOn = !S.clipOn;
  $("btnClip").classList.toggle("active", S.clipOn);
  if (S.clipOn) {
    S.mode = null;
    for (const k in modeButtons) modeButtons[k].classList.remove("active");
    if (S.storeyOn) { S.storeyOn = false; S.storeyIdx = -1; $("btnStorey").classList.remove("active"); }
    showClipBar();
    applyClip();
  } else {
    stopFacePick();
    renderer.clippingPlanes = [];
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
  }
});

export function stopFacePick() {
  S.clipPickFace = false;
  renderer.domElement.style.cursor = "";
}

export function showClipBar() {
  const faceReady = S.clipMode === "face" && S.clipFaceN;
  let html =
    '<span class="lbl">' + (S.clipPickFace ? "Trykk på en flate i modellen …" : "Snitt:") + '</span>' +
    '<button id="cx">X</button><button id="cy">Y (høyde)</button><button id="cz">Z</button>' +
    '<button id="cfa" title="Legg snittet parallelt med en flate du trykker på – for skjeive bygg">📐 Fra flate</button>' +
    '<button id="cf">↔ Snu</button>';
  if (faceReady) {
    const lim = Math.max(1, S.modelSize);
    html += '<input type="range" id="crf" min="' + (-lim) + '" max="' + lim + '" step="' + (lim / 500) +
      '" value="' + S.clipFaceOff + '" title="Skyv snittet langs flatens normal">' +
      '<span class="lbl" id="crfv">' + fmtLen(S.clipFaceOff) + '</span>';
  } else {
    html += '<input type="range" id="cr" min="0" max="1000" value="' + Math.round(S.clipT * 1000) + '">';
  }
  modeBar.innerHTML = html;
  modeBar.classList.add("open");
  const upd = () => {
    $("cx").classList.toggle("active", S.clipMode === "axis" && S.clipAxis === "x");
    $("cy").classList.toggle("active", S.clipMode === "axis" && S.clipAxis === "y");
    $("cz").classList.toggle("active", S.clipMode === "axis" && S.clipAxis === "z");
    $("cfa").classList.toggle("active", S.clipPickFace || S.clipMode === "face");
    $("cf").classList.toggle("active", S.clipFlip);
  };
  const setAxis = (a) => {
    stopFacePick();
    S.clipMode = "axis"; S.clipAxis = a;
    showClipBar(); applyClip();
  };
  $("cx").onclick = () => setAxis("x");
  $("cy").onclick = () => setAxis("y");
  $("cz").onclick = () => setAxis("z");
  $("cfa").onclick = () => {
    S.clipPickFace = !S.clipPickFace;
    renderer.domElement.style.cursor = S.clipPickFace ? "crosshair" : "";
    showClipBar();
  };
  $("cf").onclick = () => { S.clipFlip = !S.clipFlip; upd(); applyClip(); };
  if ($("cr")) $("cr").oninput = (e) => { S.clipT = e.target.value / 1000; applyClip(); };
  if ($("crf")) $("crf").oninput = (e) => {
    S.clipFaceOff = Number(e.target.value);
    $("crfv").textContent = fmtLen(S.clipFaceOff);
    applyClip();
  };
  upd();
}

// Kalles når brukeren trykker på en flate i 📐 Fra flate-modus.
// Funker i alle tre lastemodus (full, lav kvalitet og lett kopi) fordi den
// bare bruker treffets trekantnormal – ikke IFC-data.
export function setClipFromFace(hit) {
  if (!hit || !hit.face) return false;
  const n = hit.face.normal.clone()
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
  if (!isFinite(n.x) || n.lengthSq() < 1e-9) return false;
  S.clipFaceN = n;
  S.clipFaceP = hit.point.clone();
  S.clipFaceOff = 0;
  S.clipMode = "face";
  S.clipFlip = false;
  stopFacePick();
  showClipBar();
  applyClip();
  return true;
}

function applyClip() {
  if (!S.modelBox) return;
  if (S.clipMode === "face") {
    if (!S.clipFaceN || !S.clipFaceP) { renderer.clippingPlanes = []; return; }
    // behold siden BAK flaten (motsatt normalen) slik at man ser inn i bygget
    const n = S.clipFaceN.clone().multiplyScalar(S.clipFlip ? 1 : -1);
    const p = S.clipFaceP.clone().addScaledVector(S.clipFaceN, S.clipFaceOff);
    renderer.clippingPlanes = [new THREE.Plane().setFromNormalAndCoplanarPoint(n, p)];
    return;
  }
  const min = S.modelBox.min[S.clipAxis] - 0.05;
  const max = S.modelBox.max[S.clipAxis] + 0.05;
  const v = min + (max - min) * S.clipT;
  const n = axisVectors[S.clipAxis].clone().multiplyScalar(S.clipFlip ? 1 : -1);
  const plane = new THREE.Plane(n, S.clipFlip ? -v : v);
  renderer.clippingPlanes = [plane];
}

// ---------- 🏢 Etasjefilter ----------
// Viser én etasje om gangen ved hjelp av to klippeplan (funker i full, lav og lett kopi-modus)

// Leser IfcBuildingStorey + hvilke elementer som hører til hver etasje
export function storeyDataIfc() {
  try {
    const byStorey = new Map();
    const rels = ifcApi.GetLineIDsWithType(S.modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(S.modelID, rels.get(i));
      const sid = rel.RelatingStructure && rel.RelatingStructure.value;
      if (!sid) continue;
      try { if (ifcApi.GetLineType(S.modelID, sid) !== WebIFC.IFCBUILDINGSTOREY) continue; } catch(_) { continue; }
      let e = byStorey.get(sid);
      if (!e) {
        const line = ifcApi.GetLine(S.modelID, sid);
        e = { name: val(line.Name) || ("Etasje " + (byStorey.size + 1)), elev: Number(val(line.Elevation)) || 0, ids: [] };
        byStorey.set(sid, e);
      }
      (rel.RelatedElements || []).forEach(o => e.ids.push(o.value));
    }
    return [...byStorey.values()].filter(s => s.ids.length).sort((a, b) => a.elev - b.elev);
  } catch(_) { return []; }
}

function buildStoreyList() {
  S.storeyList = [];
  let defs = [];
  if (S.glbActive) defs = (S.glbStoreys || []).map(s => ({ name: s.name, ids: new Set(s.ids) }));
  else if (S.modelID !== null) defs = storeyDataIfc().map(s => ({ name: s.name, ids: new Set(s.ids) }));
  if (!defs.length) return;
  // bounding-bokser for alle etasje-elementer i én omgang
  const allIds = new Set();
  defs.forEach(d => d.ids.forEach(id => allIds.add(id)));
  let boxMap;
  if (S.lightLoaded) boxMap = lightElementBoxes(allIds);
  else {
    boxMap = new Map();
    const tmp = new THREE.Box3();
    S.modelGroup.children.forEach(m => {
      const id = m.userData.expressID;
      if (!allIds.has(id)) return;
      tmp.setFromObject(m);
      const b = boxMap.get(id);
      if (b) b.union(tmp); else boxMap.set(id, tmp.clone());
    });
  }
  for (const d of defs) {
    const ys = [];
    for (const id of d.ids) { const b = boxMap.get(id); if (b) ys.push(b.min.y); }
    if (!ys.length) continue;
    ys.sort((a, b) => a - b);
    // etasjens gulvnivå = median av elementenes underkant (robust mot enkeltelementer under gulvet)
    S.storeyList.push({ name: d.name, count: ys.length, yBase: ys[Math.floor(ys.length / 2)] });
  }
  S.storeyList.sort((a, b) => a.yBase - b.yBase);
}

function applyStorey(i) {
  S.storeyIdx = i;
  if (i < 0 || !S.storeyList || !S.storeyList[i]) { renderer.clippingPlanes = []; return; }
  const eps = S.modelSize * 0.002;
  const lower = S.storeyList[i].yBase - eps;
  const upper = i + 1 < S.storeyList.length ? S.storeyList[i + 1].yBase - eps : S.modelBox.max.y + 1;
  renderer.clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -lower),  // vis alt over gulvet
    new THREE.Plane(new THREE.Vector3(0, -1, 0), upper)   // ... og under neste etasje
  ];
}

$("btnStorey").addEventListener("click", () => {
  if (!S.modelGroup) return;
  S.storeyOn = !S.storeyOn;
  $("btnStorey").classList.toggle("active", S.storeyOn);
  if (S.storeyOn) {
    if (S.clipOn) { S.clipOn = false; stopFacePick(); $("btnClip").classList.remove("active"); }
    if (!S.storeyList) buildStoreyList();
    showStoreyBar();
    applyStorey(S.storeyIdx);
  } else {
    renderer.clippingPlanes = [];
    S.storeyIdx = -1;
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
    updateModeBar();
  }
});

function showStoreyBar() {
  if (!S.storeyList || !S.storeyList.length) {
    modeBar.innerHTML = '<span class="lbl">Fant ingen etasjer (IfcBuildingStorey) i modellen' +
      (S.glbActive ? ' – lag en ny lett kopi fra original-IFC-en for å få med etasjedata' : '') + '</span>';
    modeBar.classList.add("open");
    return;
  }
  modeBar.innerHTML = '<span class="lbl">Etasje:</span><button data-st="-1">Alle</button>' +
    S.storeyList.map((s, i) => '<button data-st="' + i + '">' + esc(s.name) + '</button>').join("");
  modeBar.classList.add("open");
  const upd = () => modeBar.querySelectorAll("button[data-st]").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.st) === S.storeyIdx));
  modeBar.querySelectorAll("button[data-st]").forEach(b =>
    b.onclick = () => { applyStorey(Number(b.dataset.st)); upd(); });
  upd();
}
