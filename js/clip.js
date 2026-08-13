// ✂️ Snitt (akse og fra flate) og 🏢 etasjefilter – begge bruker klippeplan.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, DEFAULT_CLIPBOX, på, S, apnePanel, esc, fmtLen, ikon, tilM, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { val } from "./elements.js";
import { lightElementBoxes } from "./ifc.js";
import { kall } from "./ifcrpc.js";
import { modeBar, modeButtons, updateModeBar } from "./modes.js";
import { renderer } from "./scene.js";

// ---------- Snitt (clipping) ----------

// 📐 Fra flate: snittplanet legges parallelt med en flate brukeren trykker på

const axisVectors = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) };

på("btnClip", "click", () => {
  const førSnitt = snittAvtrykk();
  S.clipOn = !S.clipOn;
  $("btnClip").classList.toggle("active", S.clipOn);
  if (S.clipOn) {
    S.mode = null;
    for (const k in modeButtons) modeButtons[k].classList.remove("active");
    // 📦 Boks kan stå sammen med etasjefilteret; et enkelt plan kan ikke
    if (S.storeyOn && S.clipMode !== "box") {
      S.storeyOn = false; S.storeyIdx = -1; $("btnStorey").classList.remove("active");
    }
    showClipBar();
    applyClip();
  } else {
    stopFacePick();
    $("clipPanel").classList.remove("open");
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
    applyClip();
    if (S.storeyOn) showStoreyBar();
  }
  meldSnittAngre(førSnitt, S.clipOn ? "Snitt på" : "Snitt av");
});

// ---------- ↩ Angre for snitt ----------
// applyClipState alene holder ikke: den slår ALLTID snittet på, så den kan
// ikke gjenopprette «snitt av». Avtrykket bærer derfor med seg av/på.
export function snittAvtrykk() {
  return Object.assign({ on: S.clipOn }, currentClipState());
}

export async function settSnitt(a) {
  if (!a) return;
  if (a.on) { await applyClipState(a); return; }
  // Av: samme opprydding som knappen gjør
  S.clipOn = false;
  $("btnClip").classList.remove("active");
  stopFacePick();
  $("clipPanel").classList.remove("open");
  modeBar.classList.remove("open");
  modeBar.innerHTML = "";
  applyClip();
  if (S.storeyOn) showStoreyBar();
}

function meldSnittAngre(før, tekst) {
  if (!S.pushAngre) return;
  const etter = snittAvtrykk();
  S.pushAngre({ tekst, angre: () => settSnitt(før), gjenopprett: () => settSnitt(etter) });
}

export function stopFacePick() {
  S.clipPickFace = false;
  renderer.domElement.style.cursor = "";
}

function setAxis(a) {
  stopFacePick();
  $("clipPanel").classList.remove("open");
  S.clipMode = "axis"; S.clipAxis = a;
  showClipBar(); applyClip();
}

function startFacePick() {
  $("clipPanel").classList.remove("open");
  if (S.clipMode === "box") S.clipMode = "axis";
  S.clipPickFace = !S.clipPickFace;
  renderer.domElement.style.cursor = S.clipPickFace ? "crosshair" : "";
  showClipBar();
  applyClip();
}

export function showClipBar() {
  const faceReady = S.clipMode === "face" && S.clipFaceN;
  let html =
    '<span class="lbl">' + (S.clipPickFace ? t("Trykk på en flate i modellen …") : t("Snitt:")) + '</span>' +
    '<button id="cx">X</button><button id="cy">Y (' + t("høyde") + ')</button><button id="cz">Z</button>' +
    '<button id="cfa" title="' + t("Legg snittet parallelt med en flate du trykker på – for skjeive bygg") + '">' + ikon("flate") + ' ' + t("Fra flate") + '</button>' +
    '<button id="cbox" title="' + t("Seks plan du kan krympe hver for seg – isolerer et utsnitt av bygget") + '">' + ikon("boks") + ' ' + t("Boks") + '</button>' +
    '<button id="csave" title="' + t("Lagrede snitt for denne modellen") + '">' + ikon("lagre") + ' ' + t("Snitt") + '</button>';
  if (S.clipMode === "box") {
    modeBar.innerHTML = html;
    modeBar.classList.add("open");
    $("cbox").classList.add("active");
    $("cx").onclick = () => setAxis("x");
    $("cy").onclick = () => setAxis("y");
    $("cz").onclick = () => setAxis("z");
    $("cfa").onclick = startFacePick;
    $("cbox").onclick = () => {
      const p = $("clipPanel");
      if (p.classList.contains("open")) p.classList.remove("open");
      else apnePanel("clipPanel");
      renderClipPanel();
    };
    $("csave").onclick = openSavedClips;
    return;
  }
  html += '<button id="cf">' + ikon("snu") + ' ' + t("Snu") + '</button>';
  if (faceReady) {
    const lim = Math.max(1, S.modelSize);
    html += '<input type="range" id="crf" min="' + (-lim) + '" max="' + lim + '" step="' + (lim / 500) +
      '" value="' + S.clipFaceOff + '" title="' + t("Skyv snittet langs flatens normal") + '">' +
      '<span class="lbl" id="crfv">' + fmtLen(tilM(S.clipFaceOff)) + '</span>';
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
  $("cx").onclick = () => setAxis("x");
  $("cy").onclick = () => setAxis("y");
  $("cz").onclick = () => setAxis("z");
  $("cfa").onclick = startFacePick;
  $("cbox").onclick = startBoxClip;
  $("csave").onclick = openSavedClips;
  $("cf").onclick = () => { S.clipFlip = !S.clipFlip; upd(); applyClip(); };
  if ($("cr")) $("cr").oninput = (e) => { S.clipT = e.target.value / 1000; applyClip(); };
  if ($("crf")) $("crf").oninput = (e) => {
    S.clipFaceOff = Number(e.target.value);
    $("crfv").textContent = fmtLen(tilM(S.clipFaceOff));   // offset er i modellens enheter
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

// ---------- 📦 Snitt-boks ----------
// Seks plan som kan krympes uavhengig, oppgitt som andeler (0–1) av modellens
// utstrekning. Ingen IFC-data brukes, så boksen virker i alle tre lastemodus.

export function startBoxClip() {
  stopFacePick();
  S.clipMode = "box";
  showClipBar();
  apnePanel("clipPanel");
  renderClipPanel();
  applyClip();
}

// Verdien en boksside har i modellens koordinater
function boxEdge(axis, frac) {
  const min = S.modelBox.min[axis] - 0.05;
  const max = S.modelBox.max[axis] + 0.05;
  return min + (max - min) * frac;
}

// Ren matematikk, uten three.js: hvilke plan boksen gir.
// dir 1 = behold alt over verdien, dir -1 = behold alt under. Sider som ikke er
// krympet gir ingen plan, så en urørt boks koster ingenting.
export function boxPlaneSpecs(box, modelBox) {
  const specs = [];
  for (const a of ["x", "y", "z"]) {
    const min = modelBox.min[a] - 0.05, max = modelBox.max[a] + 0.05;
    const edge = (f) => min + (max - min) * f;
    if (box[a + "0"] > 0.0001) specs.push({ axis: a, dir: 1, constant: -edge(box[a + "0"]) });
    if (box[a + "1"] < 0.9999) specs.push({ axis: a, dir: -1, constant: edge(box[a + "1"]) });
  }
  return specs;
}

// Sidene kan ikke passere hverandre – hold minst 1 % åpning
export function clampEdge(v, other, isMin) {
  v = isMin ? Math.min(v, other - 0.01) : Math.max(v, other + 0.01);
  return Math.max(0, Math.min(1, v));
}

function boxPlanes() {
  return boxPlaneSpecs(S.clipBox, S.modelBox).map(s =>
    new THREE.Plane(axisVectors[s.axis].clone().multiplyScalar(s.dir), s.constant));
}

// Alle aktive klippeplan samles her, så snitt og etasjefilter kan virke sammen
function applyClip() {
  if (!S.modelBox) return;
  let planes = [];
  if (S.clipOn) {
    if (S.clipMode === "box") {
      planes = boxPlanes();
    } else if (S.clipMode === "face") {
      if (S.clipFaceN && S.clipFaceP) {
        // behold siden BAK flaten (motsatt normalen) slik at man ser inn i bygget
        const n = S.clipFaceN.clone().multiplyScalar(S.clipFlip ? 1 : -1);
        const p = S.clipFaceP.clone().addScaledVector(S.clipFaceN, S.clipFaceOff);
        planes = [new THREE.Plane().setFromNormalAndCoplanarPoint(n, p)];
      }
    } else {
      const v = boxEdge(S.clipAxis, S.clipT);
      const n = axisVectors[S.clipAxis].clone().multiplyScalar(S.clipFlip ? 1 : -1);
      planes = [new THREE.Plane(n, S.clipFlip ? -v : v)];
    }
  }
  if (S.storeyOn && S.storeyIdx >= 0) planes = planes.concat(storeyPlanes(S.storeyIdx));
  renderer.clippingPlanes = planes;
}

function clipRow(key, label, other, isMin) {
  const v = Math.round(S.clipBox[key] * 1000);
  return '<div class="clip-row"><span class="n">' + label + '</span>' +
    '<input type="range" class="clip-sl" data-k="' + key + '" data-o="' + other + '" data-min="' + (isMin ? 1 : 0) +
    '" min="0" max="1000" value="' + v + '">' +
    '<span class="v" id="cv_' + key + '">' + Math.round(S.clipBox[key] * 100) + ' %</span></div>';
}

export function renderClipPanel() {
  const body = $("clipBody");
  if (!body) return;
  body.innerHTML =
    '<p style="color:var(--muted); font-size:11px; margin:0 0 8px">' +
    t("Krymp boksen fra hver av de seks sidene. Alt utenfor skjules. Boksen kan stå sammen med Etasjer.") + '</p>' +
    clipRow("x0", "X fra", "x1", true) + clipRow("x1", "X til", "x0", false) +
    clipRow("y0", "Y fra (gulv)", "y1", true) + clipRow("y1", "Y til (tak)", "y0", false) +
    clipRow("z0", "Z fra", "z1", true) + clipRow("z1", "Z til", "z0", false) +
    '<div class="prop-actions" style="margin-top:12px">' +
      '<button id="cbReset">' + ikon("nullstill") + ' ' + t("Hele modellen") + '</button>' +
      '<button id="cbHalf" title="' + t("Krymp alle sider 25 % inn") + '">' + ikon("boks") + ' ' + t("Midten") + '</button>' +
      '<button id="cbSave" class="primary">' + ikon("lagre") + ' ' + t("Lagre som …") + '</button>' +
    '</div>';

  body.querySelectorAll(".clip-sl").forEach(sl => {
    sl.oninput = () => {
      const k = sl.dataset.k, other = sl.dataset.o, isMin = sl.dataset.min === "1";
      const v = clampEdge(Number(sl.value) / 1000, S.clipBox[other], isMin);
      S.clipBox[k] = v;
      sl.value = Math.round(v * 1000);
      $("cv_" + k).textContent = Math.round(v * 100) + " %";
      applyClip();
    };
  });
  $("cbReset").onclick = () => { S.clipBox = Object.assign({}, DEFAULT_CLIPBOX); renderClipPanel(); applyClip(); };
  $("cbHalf").onclick = () => {
    S.clipBox = { x0: 0.25, x1: 0.75, y0: 0.25, y1: 0.75, z0: 0.25, z1: 0.75 };
    renderClipPanel(); applyClip();
  };
  $("cbSave").onclick = saveCurrentClip;
}

// ---------- 💾 Navngitte lagrede snitt ----------
// Lagres per modellfil i det personlige oppsettet, så de følger brukeren.

const MAX_CLIPS = 20;      // per modell
const MAX_MODELS = 30;     // hvor mange modeller vi husker snitt for

function clipList() {
  if (!S.fileName) return [];
  return S.clipStore[S.fileName] || [];
}

function saveClipList(list) {
  if (!S.fileName) return;
  if (list.length) S.clipStore[S.fileName] = list.slice(0, MAX_CLIPS);
  else delete S.clipStore[S.fileName];
  // hold lageret lite – eldste modeller ryker først
  const keys = Object.keys(S.clipStore);
  if (keys.length > MAX_MODELS) keys.slice(0, keys.length - MAX_MODELS).forEach(k => delete S.clipStore[k]);
  writePrefs();
  if (S.syncPrefs) S.syncPrefs();
}

function currentClipState() {
  return {
    mode: S.clipMode,
    axis: S.clipAxis,
    t: S.clipT,
    flip: S.clipFlip,
    box: Object.assign({}, S.clipBox),
    faceN: S.clipFaceN ? [S.clipFaceN.x, S.clipFaceN.y, S.clipFaceN.z] : null,
    faceP: S.clipFaceP ? [S.clipFaceP.x, S.clipFaceP.y, S.clipFaceP.z] : null,
    faceOff: S.clipFaceOff,
    storey: S.storeyOn ? S.storeyIdx : -1
  };
}

function saveCurrentClip() {
  if (!S.fileName) { alert(t("Åpne en modell først.")); return; }
  const name = (prompt(t("Navn på snittet:"), t("Snitt") + " " + (clipList().length + 1)) || "").trim();
  if (!name) return;
  const list = clipList().filter(c => c.name !== name);
  list.unshift(Object.assign({ name }, currentClipState()));
  saveClipList(list);
  openSavedClips();
}

export async function applyClipState(c) {
  if (!c) return;
  S.clipMode = c.mode || "axis";
  S.clipAxis = c.axis || "y";
  S.clipT = typeof c.t === "number" ? c.t : 1;
  S.clipFlip = !!c.flip;
  S.clipBox = Object.assign({}, DEFAULT_CLIPBOX, c.box || {});
  S.clipFaceN = c.faceN ? new THREE.Vector3(c.faceN[0], c.faceN[1], c.faceN[2]) : null;
  S.clipFaceP = c.faceP ? new THREE.Vector3(c.faceP[0], c.faceP[1], c.faceP[2]) : null;
  S.clipFaceOff = c.faceOff || 0;
  S.clipOn = true;
  $("btnClip").classList.add("active");
  // etasjevalget følger med i snittet
  const st = typeof c.storey === "number" ? c.storey : -1;
  if (st >= 0) {
    if (!S.storeyList) await buildStoreyList();
    S.storeyOn = true; S.storeyIdx = st;
    $("btnStorey").classList.add("active");
  } else if (S.storeyOn) {
    S.storeyOn = false; S.storeyIdx = -1;
    $("btnStorey").classList.remove("active");
  }
  showClipBar();
  if (S.clipMode === "box") { apnePanel("clipPanel"); renderClipPanel(); }
  else $("clipPanel").classList.remove("open");
  applyClip();
}

export function openSavedClips() {
  const body = $("clipBody");
  if (!body) return;
  apnePanel("clipPanel");
  const list = clipList();
  let html = '<div class="prop-actions"><button id="clNew" class="primary">' + ikon("lagre") + ' ' + t("Lagre nåværende snitt") + '</button>' +
    '<button id="clBack">' + ikon("boks") + ' ' + t("Tilbake til boksen") + '</button></div>';
  html += list.length
    ? list.map((c, i) => {
        const what = c.mode === "box" ? ikon("boks") + " " + t("Boks") : c.mode === "face" ? ikon("flate") + " " + t("Fra flate") : ikon("snitt") + " " + String(c.axis || "y").toUpperCase();
        const st = c.storey >= 0 && S.storeyList && S.storeyList[c.storey] ? " · " + esc(S.storeyList[c.storey].name) : "";
        return '<div class="comment" data-i="' + i + '">' +
          '<div class="meta"><span>' + what + st + '</span><span class="del" data-del="' + i + '">' + t("Slett") + '</span></div>' +
          '<div>' + esc(c.name) + '</div></div>';
      }).join("")
    : '<p style="color:var(--muted)">' + t("Ingen lagrede snitt for <b>{0}</b> ennå.", esc(S.fileName || "modellen")) + '</p>';
  body.innerHTML = html;
  $("clNew").onclick = saveCurrentClip;
  $("clBack").onclick = () => { S.clipMode = "box"; showClipBar(); renderClipPanel(); applyClip(); };
  body.querySelectorAll(".comment").forEach(el => {
    el.onclick = (e) => {
      const del = e.target.getAttribute("data-del");
      if (del !== null && del !== undefined) {
        const list2 = clipList().slice();
        list2.splice(Number(del), 1);
        saveClipList(list2);
        openSavedClips();
        return;
      }
      applyClipState(clipList()[Number(el.dataset.i)]);   // asynkron, men ingenting venter på den
    };
  });
}

// ---------- 🏢 Etasjefilter ----------
// Viser én etasje om gangen ved hjelp av to klippeplan (funker i full, lav og lett kopi-modus)

// Etasjene leses av IFC-tråden (js/ifc-worker.js → cmdStoreys)
export async function storeyDataIfc() {
  try { return await kall("storeys"); } catch(_) { return []; }
}

async function buildStoreyList() {
  S.storeyList = [];
  let defs = [];
  if (S.glbActive) defs = (S.glbStoreys || []).map(s => ({ name: s.name, ids: new Set(s.ids) }));
  else if (S.modelID !== null) defs = (await storeyDataIfc()).map(s => ({ name: s.name, ids: new Set(s.ids) }));
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

function storeyPlanes(i) {
  if (i < 0 || !S.storeyList || !S.storeyList[i] || !S.modelBox) return [];
  const eps = S.modelSize * 0.002;
  const lower = S.storeyList[i].yBase - eps;
  const upper = i + 1 < S.storeyList.length ? S.storeyList[i + 1].yBase - eps : S.modelBox.max.y + 1;
  return [
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -lower),  // vis alt over gulvet
    new THREE.Plane(new THREE.Vector3(0, -1, 0), upper)   // ... og under neste etasje
  ];
}

function applyStorey(i) {
  S.storeyIdx = i;
  applyClip();   // samler etasjeplan og et eventuelt aktivt snitt
}

på("btnStorey", "click", async () => {
  if (!S.modelGroup) return;
  S.storeyOn = !S.storeyOn;
  $("btnStorey").classList.toggle("active", S.storeyOn);
  if (S.storeyOn) {
    // 📦 Boks kan stå sammen med etasjefilteret; et enkelt snittplan kan ikke
    if (S.clipOn && S.clipMode !== "box") {
      S.clipOn = false; stopFacePick();
      $("btnClip").classList.remove("active");
      $("clipPanel").classList.remove("open");
    }
    if (!S.storeyList) await buildStoreyList();
    showStoreyBar();
    applyStorey(S.storeyIdx);
  } else {
    S.storeyIdx = -1;
    applyClip();
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
    if (S.clipOn) showClipBar(); else updateModeBar();
  }
});

function showStoreyBar() {
  if (!S.storeyList || !S.storeyList.length) {
    modeBar.innerHTML = '<span class="lbl">' + t("Fant ingen etasjer (IfcBuildingStorey) i modellen") +
      (S.glbActive ? t(" – lag en ny lett kopi fra original-IFC-en for å få med etasjedata") : '') + '</span>';
    modeBar.classList.add("open");
    return;
  }
  modeBar.innerHTML = '<span class="lbl">' + t("Etasje:") + '</span><button data-st="-1">' + t("Alle") + '</button>' +
    S.storeyList.map((s, i) => '<button data-st="' + i + '">' + esc(s.name) + '</button>').join("") +
    // står snitt-boksen på samtidig, gir vi en vei tilbake til den
    (S.clipOn && S.clipMode === "box" ? '<button id="stBox" title="' + t("Tilbake til snitt-boksen") + '">' + ikon("boks") + ' ' + t("Boks") + '</button>' : "");
  modeBar.classList.add("open");
  if ($("stBox")) $("stBox").onclick = () => { showClipBar(); apnePanel("clipPanel"); renderClipPanel(); };
  const upd = () => modeBar.querySelectorAll("button[data-st]").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.st) === S.storeyIdx));
  modeBar.querySelectorAll("button[data-st]").forEach(b =>
    b.onclick = () => { applyStorey(Number(b.dataset.st)); upd(); });
  upd();
}
