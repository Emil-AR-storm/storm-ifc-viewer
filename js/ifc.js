// Innlasting av modeller: IFC (full og lav kvalitet) og lett kopi (.glb).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/web-ifc-api.js";
import { $, S, esc, loadingEl, loadingText, statusEl, writePrefs } from "./state.js";
import { storeyDataIfc } from "./clip.js";
import { hiddenIDs } from "./display.js";
import { clearSelection, val } from "./elements.js";
import { loadComments, renderCommentList } from "./markers.js";
import { miniCanvas, renderMiniMap } from "./minimap.js";
import { restoreAppearance } from "./prefs.js";
import { axesGroup, fitToModel, koteGroup, markerGroup, measureGroup, renderer, scene } from "./scene.js";
import { SP, spOpenFile } from "./sharepoint.js";

// ---------- IFC ----------
export const ifcApi = new WebIFC.IfcAPI();

ifcApi.SetWasmPath("https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/", true);

export const ifcReady = ifcApi.Init();

// Åpner en fil fra disk – brukes både av 📂 Åpne-knappen og av dra-og-slipp.
// `handle` er et FileSystemFileHandle når nettleseren gir oss et; det lagres av
// recent.js slik at «▶ Fortsett med …» kan lese filen på nytt senere.
export async function openLocalFile(file, handle) {
  if (!file) return;
  if (!/\.(ifc|glb)$/i.test(file.name)) {
    alert("Dette ser ikke ut som en IFC- eller lett kopi-fil (" + file.name + "). Velg en fil som slutter på .ifc eller .glb");
    return;
  }
  S.fileName = file.name;
  loadingEl.classList.add("open");
  try {
    const isGlb = /\.glb$/i.test(file.name);
    if (!isGlb) {
      loadingText.textContent = "Starter IFC-motor …";
      await ifcReady;
    }
    loadingText.textContent = "Leser " + file.name + " …";
    const buffer = new Uint8Array(await file.arrayBuffer());
    await new Promise(r => setTimeout(r, 30));
    S.lastBuffer = buffer;
    setLoadFlag({ name: file.name, light: S.lightMode });
    if (isGlb) await loadGlb(buffer); else loadModel(buffer);
    afterLoad();
    clearLoadFlag();
    if (S.rememberModel) S.rememberModel({ kind: "local", name: file.name, size: file.size, handle: handle || null });
  } catch (err) {
    console.error(err);
    clearLoadFlag();
    // Filer som bare finnes i skya (OneDrive «frigjør plass») kan ikke leses direkte
    const msg = /permission|not.*readable|NotReadableError|NotFoundError/i.test(err.name + " " + err.message)
      ? "Klarte ikke å lese fila. Ligger den i OneDrive og er merket «bare på nett»? " +
        "Høyreklikk fila i Utforsker → «Behold alltid på denne enheten», og prøv igjen."
      : "Klarte ikke å lese IFC-filen: " + err.message;
    if (!(await offerLightRetry(err))) alert(msg);
  } finally {
    loadingEl.classList.remove("open");
  }
}

document.getElementById("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  await openLocalFile(file);
  e.target.value = "";
});

// 📂 Åpne: bruker showOpenFilePicker der den finnes, så vi får et filhåndtak og
// kan tilby «▶ Fortsett med …» neste gang. Ellers den vanlige filvelgeren.
export async function pickFile() {
  if (!window.showOpenFilePicker) { $("fileInput").click(); return; }
  let handle = null;
  try {
    [handle] = await window.showOpenFilePicker({
      id: "storm-ifc",                 // nettleseren husker sist brukte mappe
      multiple: false,
      types: [{ description: "IFC-modell eller lett kopi", accept: { "application/octet-stream": [".ifc", ".glb"] } }]
    });
  } catch (err) {
    if (err && err.name === "AbortError") return;   // brukeren avbrøt
    $("fileInput").click();                          // noe uventet – fall tilbake
    return;
  }
  try {
    await openLocalFile(await handle.getFile(), handle);
  } catch (err) {
    alert("Klarte ikke å lese filen: " + err.message);
  }
}

["btnOpen", "btnOpenSplash"].forEach(id => {
  const b = $(id);
  if (b) b.addEventListener("click", pickFile);
});

// ---------- Dra og slipp ----------
// Slipp en .ifc/.glb rett i vinduet. Nyttig når Windows-dialogen filtrerer bort
// filer, og raskere enn å lete seg fram i mapper.
(function enableDrop() {
  const hint = document.createElement("div");
  hint.id = "dropHint";
  hint.textContent = "📥 Slipp IFC- eller .glb-fila her";
  document.body.appendChild(hint);
  let depth = 0;
  const show = (on) => hint.classList.toggle("open", on);
  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault(); depth++; show(true);
  });
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); depth = 0; show(false);
    // Ta med filhåndtaket hvis nettleseren tilbyr det (gir «▶ Fortsett med …»)
    let handle = null;
    try {
      const item = e.dataTransfer.items && e.dataTransfer.items[0];
      if (item && item.getAsFileSystemHandle) {
        const h = await item.getAsFileSystemHandle();
        if (h && h.kind === "file") handle = h;
      }
    } catch(_) {}
    await openLocalFile(e.dataTransfer.files[0], handle);
  });
})();

export function afterLoad() {
  $("splash").style.display = "none";
  $("hint").style.display = "block";
  $("toolbar").classList.add("open");
  loadComments();
  restoreAppearance(); // legger på lagret fargelegging/skjuling/transparent
  if (S.onModelLoaded) S.onModelLoaded(); // 🔄 sammenligning, hvis et avtrykk er tatt
  if (S.onSharedReady) S.onSharedReady(); // ⛓ delt visning, hvis lenka hadde en
}

function clearModel() {
  if (S.modelGroup) {
    scene.remove(S.modelGroup);
    S.modelGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    S.modelGroup = null;
  }
  markerGroup.clear();
  measureGroup.clear();
  koteGroup.clear();
  axesGroup.clear();
  axesGroup.visible = false;
  S.axesOn = false; S.axesBuilt = false;
  S.axisSources = null; S.axisSelection = new Set();
  document.getElementById("axesPanel").classList.remove("open");
  document.getElementById("btnAxes").classList.remove("active");
  S.searchIndex = null; S.lastQuery = "";
  document.getElementById("searchPanel").classList.remove("open");
  document.getElementById("clipPanel").classList.remove("open");
  document.getElementById("sharePanel").classList.remove("open");
  S.storeyOn = false; S.storeyList = null; S.storeyIdx = -1;
  document.getElementById("btnStorey").classList.remove("active");
  S.sharedOK = false;
  S.multiSel.clear();
  S.allBoxCache = null;
  S.miniInfo = null; S.miniBase = null;
  miniCanvas.style.display = "none";
  S.comments = [];
  S.qtyCache = null;
  S.typeInfo = null;
  S.typeColorsOn = false;
  hiddenIDs.clear();
  S.ghostOn = false;
  document.getElementById("btnGhost").classList.remove("active");
  document.getElementById("btnShowAll").style.display = "none";
  S.clipOn = false; S.clipMode = "axis"; S.clipFaceN = null; S.clipFaceP = null; S.clipFaceOff = 0; S.clipFlip = false;
  S.clipPickFace = false;
  S.clipBox = { x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1 };
  renderer.domElement.style.cursor = "";
  document.getElementById("btnClip").classList.remove("active");
  document.getElementById("setMenu").classList.remove("open");
  renderer.clippingPlanes = [];
  renderCommentList();
  if (S.modelID !== null) { try { ifcApi.CloseModel(S.modelID); } catch(_){} S.modelID = null; }
  S.glbActive = false;
  S.glbProps = null;
  S.glbColumns = null;
  clearSelection();
}

const matCache = new Map();

function getMaterial(c) {
  const key = [c.x.toFixed(3), c.y.toFixed(3), c.z.toFixed(3), c.w.toFixed(3)].join("|");
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({
      color: new THREE.Color(c.x, c.y, c.z),
      transparent: c.w < 1,
      opacity: c.w,
      side: THREE.DoubleSide
    }));
  }
  return matCache.get(key);
}

export function loadModel(buffer) {
  clearModel();
  S.lightLoaded = S.lightMode;
  renderer.setPixelRatio(S.lightLoaded ? 1 : Math.min(window.devicePixelRatio, 2));
  S.modelID = ifcApi.OpenModel(buffer, S.lightLoaded
    ? { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 8 }
    : { COORDINATE_TO_ORIGIN: true });
  S.modelGroup = new THREE.Group();

  try {
    const cm = ifcApi.GetCoordinationMatrix(S.modelID);
    S.coordMatrix = new THREE.Matrix4().fromArray(cm);
    S.koteMatrixInv = S.coordMatrix.clone().invert();
  } catch(_) { S.koteMatrixInv = null; S.coordMatrix = null; }

  const res = S.lightLoaded ? loadMeshesLight() : loadMeshesFull();

  scene.add(S.modelGroup);
  statusEl.textContent = res.shown + " elementer" +
    (S.lightLoaded ? " · 🪶" + (res.skipped ? " (" + res.skipped + " små utelatt)" : "") : "");
  S.modelBox = new THREE.Box3().setFromObject(S.modelGroup);
  S.modelSize = S.modelBox.getSize(new THREE.Vector3()).length() || 10;
  fitToModel();
  renderMiniMap();
}

// Full kvalitet: ett objekt per element (alle funksjoner tilgjengelig)
function loadMeshesFull() {
  let count = 0;
  ifcApi.StreamAllMeshes(S.modelID, (mesh) => {
    const expressID = mesh.expressID;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const geom = ifcApi.GetGeometry(S.modelID, pg.geometryExpressID);
      const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

      const pos = new Float32Array(verts.length / 2);
      const norm = new Float32Array(verts.length / 2);
      for (let j = 0; j < verts.length; j += 6) {
        const k = j / 2;
        pos[k] = verts[j]; pos[k+1] = verts[j+1]; pos[k+2] = verts[j+2];
        norm[k] = verts[j+3]; norm[k+1] = verts[j+4]; norm[k+2] = verts[j+5];
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      bg.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
      bg.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

      const m = new THREE.Mesh(bg, getMaterial(pg.color));
      const mtx = new THREE.Matrix4();
      mtx.fromArray(pg.flatTransformation);
      m.applyMatrix4(mtx);
      m.userData.expressID = expressID;
      m.userData.origMat = m.material;
      S.modelGroup.add(m);
      geom.delete();
    }
    count++;
  });
  return { shown: count, skipped: 0 };
}

// 🪶 Lav kvalitet: all geometri slås sammen per farge (mye mindre minne),
// festemidler og veldig små elementer utelates
function loadMeshesLight() {
  const skipTypes = new Set([WebIFC.IFCMECHANICALFASTENER, WebIFC.IFCFASTENER, WebIFC.IFCDISCRETEACCESSORY].filter(t => t !== undefined));
  const buckets = new Map(); // materiale -> { mat, segs, vtot, itot }
  let shown = 0, skipped = 0;
  const v = new THREE.Vector3();
  const nMat = new THREE.Matrix3();

  ifcApi.StreamAllMeshes(S.modelID, (mesh) => {
    const expressID = mesh.expressID;
    try { if (skipTypes.has(ifcApi.GetLineType(S.modelID, expressID))) { skipped++; return; } } catch(_){}
    const parts = [];
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const geom = ifcApi.GetGeometry(S.modelID, pg.geometryExpressID);
      const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const mtx = new THREE.Matrix4().fromArray(pg.flatTransformation);
      nMat.getNormalMatrix(mtx);
      const pos = new Float32Array(verts.length / 2);
      const norm = new Float32Array(verts.length / 2);
      for (let j = 0; j < verts.length; j += 6) {
        const k = j / 2;
        v.set(verts[j], verts[j+1], verts[j+2]).applyMatrix4(mtx);
        pos[k] = v.x; pos[k+1] = v.y; pos[k+2] = v.z;
        if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x;
        if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
        if (v.z < mnz) mnz = v.z; if (v.z > mxz) mxz = v.z;
        v.set(verts[j+3], verts[j+4], verts[j+5]).applyMatrix3(nMat).normalize();
        norm[k] = v.x; norm[k+1] = v.y; norm[k+2] = v.z;
      }
      parts.push({ mat: getMaterial(pg.color), pos, norm, idx: new Uint32Array(indices) });
      geom.delete();
    }
    // dropp veldig små elementer (< 0,15 i modellens enheter, dvs. 15 cm i meter-modeller)
    const diag = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
    if (diag < 0.15) { skipped++; return; }
    for (const p of parts) {
      const key = p.mat.uuid;
      let b = buckets.get(key);
      if (!b) { b = { mat: p.mat, segs: [], vtot: 0, itot: 0 }; buckets.set(key, b); }
      b.segs.push({ pos: p.pos, norm: p.norm, idx: p.idx, id: expressID });
      b.vtot += p.pos.length / 3;
      b.itot += p.idx.length;
    }
    shown++;
  });

  for (const [, b] of buckets) {
    const pos = new Float32Array(b.vtot * 3);
    const norm = new Float32Array(b.vtot * 3);
    const idx = new Uint32Array(b.itot);
    const ranges = [];
    let vo = 0, io = 0;
    for (const s of b.segs) {
      pos.set(s.pos, vo * 3);
      norm.set(s.norm, vo * 3);
      for (let i = 0; i < s.idx.length; i++) idx[io + i] = s.idx[i] + vo;
      ranges.push({ start: io, count: s.idx.length, id: s.id });
      vo += s.pos.length / 3;
      io += s.idx.length;
    }
    b.segs = null;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    bg.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
    bg.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(bg, b.mat);
    m.userData.merged = true;
    m.userData.ranges = ranges;
    m.userData.origMat = b.mat;
    S.modelGroup.add(m);
  }
  return { shown, skipped };
}

// ---------- 💾 Lett kopi (.glb) ----------

export async function loadGlb(buffer) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
  clearModel();
  S.lightLoaded = true;
  S.glbActive = true;
  renderer.setPixelRatio(1);
  S.modelGroup = new THREE.Group();
  let lite = null;
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse(o => {
    if (o.userData && o.userData.stormLite) lite = o.userData.stormLite;
    if (o.isMesh) meshes.push(o);
  });
  const idSet = new Set();
  meshes.forEach(m => {
    m.geometry.applyMatrix4(m.matrixWorld);
    m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1);
    m.updateMatrix();
    if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
    if (m.material) m.material.side = THREE.DoubleSide;
    m.userData.merged = true;
    m.userData.origMat = m.material;
    (m.userData.ranges || []).forEach(r => idSet.add(r.id));
    S.modelGroup.add(m);
  });
  if (lite) {
    S.koteMatrixInv = lite.kote ? new THREE.Matrix4().fromArray(lite.kote) : null;
    S.glbColumns = new Set(lite.columns || []);
    S.glbStoreys = lite.storeys || null;
    S.glbProps = new Map(Object.entries(lite.props || {}).map(([k, v]) => [Number(k), v]));
  } else {
    S.glbColumns = new Set();
    S.glbStoreys = null;
    S.glbProps = new Map();
  }
  scene.add(S.modelGroup);
  statusEl.textContent = idSet.size + " elementer · 💾 lett kopi";
  S.modelBox = new THREE.Box3().setFromObject(S.modelGroup);
  S.modelSize = S.modelBox.getSize(new THREE.Vector3()).length() || 10;
  fitToModel();
  renderMiniMap();
}

$("btnSaveLite").addEventListener("click", async () => {
  if (!S.modelGroup || !S.lastBuffer) return;
  if (S.glbActive) { alert("Denne modellen er allerede en lett kopi."); return; }
  if (!S.lightLoaded) {
    if (!confirm("Lett kopi lages fra 🪶 lav kvalitet. Laste modellen på nytt i lav kvalitet først?")) return;
    setLight(true);
    loadingEl.classList.add("open");
    loadingText.textContent = "Laster i lav kvalitet …";
    await new Promise(r => setTimeout(r, 30));
    try { loadModel(S.lastBuffer); }
    catch (err) { alert("Feil: " + err.message); loadingEl.classList.remove("open"); return; }
  }
  loadingEl.classList.add("open");
  loadingText.textContent = "Lager lett kopi …";
  await new Promise(r => setTimeout(r, 30));
  try {
    // metadata som bakes inn i fila: navn/profil per element, søyle-liste (til akser) og kote-matrise
    const ids = new Set();
    S.modelGroup.children.forEach(m => (m.userData.ranges || []).forEach(r => ids.add(r.id)));
    const props = {};
    for (const id of ids) {
      try {
        const line = ifcApi.GetLine(S.modelID, id);
        let tn = "";
        try { tn = (ifcApi.GetNameFromTypeCode(ifcApi.GetLineType(S.modelID, id)) || "").replace(/^IFC/i, "Ifc"); } catch(_){}
        props[id] = [val(line.Name) || "", val(line.ObjectType) || "", tn];
      } catch(_){}
    }
    const columns = [];
    try {
      const v = ifcApi.GetLineIDsWithType(S.modelID, WebIFC.IFCCOLUMN);
      for (let i = 0; i < v.size(); i++) columns.push(v.get(i));
    } catch(_){}
    let storeys = [];
    try { storeys = storeyDataIfc().map(s => ({ name: s.name, ids: s.ids })); } catch(_){}
    // bygg en krympet kopi for eksport: normaler droppes (regnes ut ved åpning)
    // og dupliserte punkter sveises sammen – gir mange ganger mindre fil
    loadingText.textContent = "Komprimerer geometri …";
    await new Promise(r => setTimeout(r, 30));
    const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
    const exportGroup = new THREE.Group();
    for (const m of S.modelGroup.children) {
      let g = new THREE.BufferGeometry();
      g.setAttribute("position", m.geometry.getAttribute("position"));
      g.setIndex(m.geometry.getIndex());
      g = mergeVertices(g, 1e-4);
      const em = new THREE.Mesh(g, m.material);
      em.userData.merged = true;
      em.userData.ranges = m.userData.ranges;
      exportGroup.add(em);
    }
    exportGroup.userData.stormLite = {
      v: 2, name: S.fileName,
      kote: S.koteMatrixInv ? Array.from(S.koteMatrixInv.elements) : null,
      columns, storeys, props
    };
    loadingText.textContent = "Lager lett kopi …";
    await new Promise(r => setTimeout(r, 30));
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const glb = await new Promise((res, rej) => new GLTFExporter().parse(exportGroup, res, rej, { binary: true }));
    exportGroup.children.forEach(em => em.geometry.dispose());
    const blob = new Blob([glb], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = S.fileName.replace(/\.ifc$/i, "") + " LETT.glb";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    alert("Lett kopi lastet ned (" + (blob.size / 1048576).toFixed(1) + " MB).\n\nLast den opp i SharePoint-mappen «" + SP.folder + "», så dukker den opp i 📚 Biblioteket og kan åpnes på mobil.");
  } catch (err) {
    console.error(err);
    alert("Klarte ikke å lage lett kopi: " + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});

// Bounding box per element i lav kvalitet-modus (leses ut av de sammenslåtte objektene)
const _lv = new THREE.Vector3();

export function lightElementBoxes(idSet, out) {
  const boxes = out || new Map();
  S.modelGroup.children.forEach(m => {
    if (!m.userData.merged) return;
    const p = m.geometry.getAttribute("position").array;
    const ix = m.geometry.getIndex().array;
    for (const r of m.userData.ranges) {
      if (idSet && !idSet.has(r.id)) continue;
      let b = boxes.get(r.id);
      if (!b) { b = new THREE.Box3(); boxes.set(r.id, b); }
      for (let i = r.start; i < r.start + r.count; i++) {
        const vi = ix[i] * 3;
        _lv.set(p[vi], p[vi+1], p[vi+2]);
        b.expandByPoint(_lv);
      }
    }
  });
  return boxes;
}

// ---------- 🪶 Lav kvalitet: bryter, krasjflagg og retry ----------

export function setLoadFlag(info) {
  S.lastLoadInfo = info;
  try { localStorage.setItem("storm-ifc-loadflag", JSON.stringify(info)); } catch(_){}
}

export function clearLoadFlag() {
  try { localStorage.removeItem("storm-ifc-loadflag"); } catch(_){}
}

function setLight(on) {
  S.lightMode = on;
  writePrefs();
  if (S.syncPrefs) S.syncPrefs();
  $("btnLight").classList.toggle("active", on);
}

setLight(S.lightMode);

$("btnLight").addEventListener("click", async () => {
  setLight(!S.lightMode);
  if (S.modelGroup && S.lastBuffer && S.lightMode !== S.lightLoaded &&
      confirm("Laste modellen på nytt i " + (S.lightMode ? "🪶 lav" : "full") + " kvalitet?")) {
    loadingEl.classList.add("open");
    loadingText.textContent = "Laster på nytt …";
    await new Promise(r => setTimeout(r, 30));
    try {
      setLoadFlag(Object.assign({}, S.lastLoadInfo || { name: S.fileName }, { light: S.lightMode }));
      loadModel(S.lastBuffer);
      clearLoadFlag();
    } catch (err) {
      clearLoadFlag();
      alert("Klarte ikke å laste på nytt: " + err.message);
    } finally {
      loadingEl.classList.remove("open");
    }
  }
});

// Tilbud om nytt forsøk i lav kvalitet når lasting feiler
export async function offerLightRetry(err) {
  if (S.lightMode || !S.lastBuffer) return false;
  if (!confirm("Klarte ikke å laste modellen (" + ((err && err.message) || err) + ").\n\nPrøve på nytt i 🪶 lav kvalitet?")) return false;
  setLight(true);
  loadingEl.classList.add("open");
  loadingText.textContent = "Prøver i lav kvalitet …";
  await new Promise(r => setTimeout(r, 30));
  try {
    setLoadFlag(Object.assign({}, S.lastLoadInfo || { name: S.fileName }, { light: true }));
    loadModel(S.lastBuffer);
    afterLoad();
    clearLoadFlag();
  } catch (e2) {
    clearLoadFlag();
    alert("Gikk ikke i lav kvalitet heller: " + e2.message);
  } finally {
    loadingEl.classList.remove("open");
  }
  return true;
}

// Krasjet nettleseren under forrige lasting? (flagget ble aldri ryddet bort)
(function crashCheck() {
  let info = null;
  try { info = JSON.parse(localStorage.getItem("storm-ifc-loadflag")); } catch(_){}
  if (!info) return;
  clearLoadFlag();
  const b = $("crashBanner");
  b.style.display = "block";
  b.innerHTML = "⚠️ Forrige forsøk på å åpne <b>" + esc(String(info.name || "modellen")) + "</b> ser ut til å ha krasjet nettleseren." +
    (info.light
      ? " Den var allerede i 🪶 lav kvalitet – modellen er trolig for stor for denne enheten."
      : "<br><button id='crashRetry' class='primary' style='margin-top:10px'>🪶 Prøv igjen i lav kvalitet</button>");
  const btn = $("crashRetry");
  if (btn) btn.onclick = () => {
    setLight(true);
    b.style.display = "none";
    if (info.libId) spOpenFile({ id: info.libId, name: info.name, size: info.size });
    else alert("Velg «" + (info.name || "filen") + "» på nytt – den åpnes nå i 🪶 lav kvalitet.");
  };
})();
