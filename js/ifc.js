// Innlasting av modeller: IFC (full og lav kvalitet) og lett kopi (.glb).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc, loadingEl, loadingText, lukkPaneler, nullstillModellState, statusEl, writePrefs } from "./state.js";
import { harWorker, kall, metaFor, tømMeta } from "./ifcrpc.js";
import { byggLettKopi, lettNavn } from "./lite.js";
import { hiddenIDs } from "./display.js";
import { clearSelection } from "./elements.js";
import { loadComments, renderCommentList } from "./markers.js";
import { miniCanvas, renderMiniMap } from "./minimap.js";
import { restoreAppearance } from "./prefs.js";
import { axesGroup, fitToModel, koteGroup, markerGroup, measureGroup, renderer, scene } from "./scene.js";
import { SP, spOpenFile } from "./sharepoint.js";
import { tomTegningsbuffer } from "./tegninger.js";

// ---------- IFC ----------
// Selve IFC-motoren (web-ifc + wasm) lever nå i js/ifc-worker.js. Hovedtråden
// laster den ikke i det hele tatt – det sparer 3 MB wasm og all parsing.
// `ifcReady` beholdes som et løst løfte, siden lastekoden ventet på det før.
export const ifcReady = Promise.resolve();

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
    if (isGlb) await loadGlb(buffer); else await loadModel(buffer);
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
  hint.textContent = "Slipp IFC- eller .glb-fila her";
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
  // three.js: fjern og frigi geometrien til forrige modell
  if (S.modelGroup) {
    scene.remove(S.modelGroup);
    S.modelGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  markerGroup.clear();
  measureGroup.clear();
  koteGroup.clear();
  axesGroup.clear();
  axesGroup.visible = false;

  // be IFC-tråden lukke modellen FØR tilstanden nullstilles
  if (S.modelID !== null) kall("close").catch(() => {});
  tømMeta();

  // all S-tilstand som hører til modellen – samlet på ETT sted (state.js).
  // Nye modell-felter legges i modellStartverdier(), ikke i en liste her.
  nullstillModellState();

  // DOM: paneler, knapper og markører hører også til forrige modell
  lukkPaneler();
  document.getElementById("setMenu").classList.remove("open");
  ["btnAxes", "btnStorey", "btnGhost", "btnClip"].forEach(id =>
    document.getElementById(id).classList.remove("active"));
  document.getElementById("btnShowAll").style.display = "none";
  miniCanvas.style.display = "none";
  renderer.domElement.style.cursor = "";
  renderer.clippingPlanes = [];
  hiddenIDs.clear();
  tomTegningsbuffer();      // tegninger hører til forrige modell
  renderCommentList();
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

// Åpner modellen i IFC-tråden og bygger geometrien fra porsjonene den sender.
// Hovedtråden gjør bare mesh-bygging, som er raskt – derfor blir fanen brukbar
// mens en stor modell åpnes, og prosenten er en faktisk måling.
export async function loadModel(buffer) {
  clearModel();
  S.lightLoaded = S.lightMode;
  renderer.setPixelRatio(S.lightLoaded ? 1 : Math.min(window.devicePixelRatio, 2));
  S.modelGroup = new THREE.Group();

  const t0 = performance.now();
  visFramdrift("Åpner IFC-filen …", 0, 0);

  // Bufferen OVERFØRES til tråden – ingen kopi. Tråden beholder den, så vi kan
  // få den tilbake ved behov (🪶-omlasting). Før holdt vi filen i to utgaver
  // samtidig, som på en 200 MB-modell var nettopp det som tok knekken på fanen.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  S.lastBuffer = null;
  S.bufferITråd = true;
  const info = await kall("open", { buffer: ab, light: S.lightLoaded }, null, [ab]);
  const tApnet = performance.now();
  S.modelID = 1;   // «en modell er åpen» – all lesing går nå gjennom IFC-tråden

  if (info.coordMatrix) {
    S.coordMatrix = new THREE.Matrix4().fromArray(info.coordMatrix);
    S.koteMatrixInv = S.coordMatrix.clone().invert();
  } else { S.koteMatrixInv = null; S.coordMatrix = null; }

  const res = S.lightLoaded ? await byggLett(info) : await byggFull(info);
  const tGeo = performance.now();

  // Etterarbeidet (samlet boks over alle mesh, innramming, minikart) tar flere
  // sekunder på en modell med tusenvis av elementer. Uten denne linja sto
  // prosenten stille på 98 % og det så ut som om den hang.
  loadingText.textContent = "Fullfører …";
  await pust();

  scene.add(S.modelGroup);
  statusEl.textContent = res.shown + " elementer" +
    (S.lightLoaded ? " · lav kvalitet" + (res.skipped ? " (" + res.skipped + " små utelatt)" : "") : "");
  S.modelBox = new THREE.Box3().setFromObject(S.modelGroup);
  S.modelSize = S.modelBox.getSize(new THREE.Vector3()).length() || 10;

  // Elementdata (navn/type/GlobalId) og aksekilder hentes IKKE her. De leses
  // første gang noe trenger dem – ellers betaler hver åpning for arbeid du
  // kanskje ikke skal bruke. Se sikreMeta() i ifcrpc.js og sikreAxisRaw() i axes.js.

  fitToModel();
  renderMiniMap();
  // Tidsbruk per fase, så vi kan se HVOR tiden går på store modeller i stedet
  // for å gjette. Les den i konsollen (F12) etter at en modell er åpnet.
  const ms = (a, b) => Math.round(b - a) + " ms";
  console.log("Modell åpnet i " + Math.round(performance.now() - t0) + " ms" +
    (harWorker() ? " (egen tråd)" : " (hovedtråden – " + (S.workerFeil || "ingen tråd") + ")") +
    "\n  1. web-ifc åpner filen:      " + ms(t0, tApnet) +
    "\n  2. geometri + mesh-bygging:  " + ms(tApnet, tGeo) +
    "\n  3. boks, innramming, kart:   " + ms(tGeo, performance.now()) +
    "\n  elementer: " + res.shown + (res.skipped ? ", utelatt: " + res.skipped : ""));
}

// Bufferen ligger i IFC-tråden etter lasting. Denne henter den tilbake når
// noe trenger den (omlasting i annen kvalitet).
export async function hentBuffer() {
  if (S.lastBuffer) return S.lastBuffer;
  if (!S.bufferITråd) return null;
  try {
    const svar = await kall("buffer");
    return svar && svar.buffer ? new Uint8Array(svar.buffer) : null;
  } catch(_) { return null; }
}

// «Leser … 42 %» eller «… 1 240 av 3 100 elementer»
function visFramdrift(tekst, gjort, av) {
  if (!av) { loadingText.textContent = tekst; return; }
  const pst = Math.min(99, Math.round(gjort / av * 100));
  loadingText.textContent = tekst + " " + pst + " %";
}

// Alle element-id-er i modellen (også i sammenslått geometri)
export function alleElementIder() {
  const ids = new Set();
  if (!S.modelGroup) return ids;
  S.modelGroup.children.forEach(m => {
    if (m.userData.merged) (m.userData.ranges || []).forEach(r => ids.add(r.id));
    else if (m.userData.expressID !== undefined) ids.add(m.userData.expressID);
  });
  return ids;
}

// Lar nettleseren tegne mellom porsjonene
const pust = () => new Promise(r => setTimeout(r, 0));

// Full kvalitet: ett objekt per element
// Porsjonene bygges med en gang de kommer inn, ikke samlet til slutt – ellers
// ville vi holdt hele modellen i to utgaver i minnet samtidig.
async function byggFull(info) {
  let count = 0;
  const svar = await kall("geometryFull", info, (m) => {
    if (m.type === "progress") { visFramdrift("Leser geometrien …", m.done, m.total); return; }
    if (m.type !== "geo") return;
    for (const e of m.batch) {
      for (const p of e.parts) {
        const mesh = new THREE.Mesh(bufferGeo(p), getMaterial(p.color));
        mesh.applyMatrix4(new THREE.Matrix4().fromArray(p.matrix));
        mesh.userData.expressID = e.id;
        mesh.userData.origMat = mesh.material;
        S.modelGroup.add(mesh);
      }
      count++;
    }
    visFramdrift("Leser geometrien …", m.done, m.total);
  });
  return { shown: svar.shown || count, skipped: svar.skipped || 0 };
}

// 🪶 Lav kvalitet: tråden har alt slått sammen per farge
async function byggLett(info) {
  const svar = await kall("geometryLight", info, (m) => {
    if (m.type === "progress") { visFramdrift("Forenkler geometri …", m.done, m.total); return; }
    if (m.type !== "bucket") return;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    bg.setAttribute("normal", new THREE.BufferAttribute(m.norm, 3));
    bg.setIndex(new THREE.BufferAttribute(m.idx, 1));
    const mesh = new THREE.Mesh(bg, getMaterial(m.color));
    mesh.userData.merged = true;
    mesh.userData.ranges = m.ranges;
    mesh.userData.origMat = mesh.material;
    S.modelGroup.add(mesh);
    visFramdrift("Setter sammen geometrien …", m.nr + 1, m.av);
  });
  return svar;
}

function bufferGeo(p) {
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.BufferAttribute(p.pos, 3));
  bg.setAttribute("normal", new THREE.BufferAttribute(p.norm, 3));
  bg.setIndex(new THREE.BufferAttribute(p.idx, 1));
  return bg;
}

// Geometrien bygges av byggFull()/byggLett() lenger opp, fra porsjonene
// IFC-tråden sender. Den gamle koden som leste web-ifc her er borte.

// Bounding box per element i sammenslått geometri (🪶 lav kvalitet og 💾 lett
// kopi). Bruker `ranges`, så den trenger ingen IFC-data.
const _lv = new THREE.Vector3();

export function lightElementBoxes(idSet, out) {
  const boxes = out || new Map();
  if (!S.modelGroup) return boxes;
  S.modelGroup.children.forEach(m => {
    if (!m.userData.merged) return;
    const p = m.geometry.getAttribute("position").array;
    const ix = m.geometry.getIndex().array;
    for (const r of (m.userData.ranges || [])) {
      if (idSet && !idSet.has(r.id)) continue;
      let b = boxes.get(r.id);
      if (!b) { b = new THREE.Box3(); boxes.set(r.id, b); }
      for (let i = r.start; i < r.start + r.count; i++) {
        const vi = ix[i] * 3;
        _lv.set(p[vi], p[vi + 1], p[vi + 2]);
        b.expandByPoint(_lv);
      }
    }
  });
  return boxes;
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
  statusEl.textContent = idSet.size + " elementer · lett kopi";
  S.modelBox = new THREE.Box3().setFromObject(S.modelGroup);
  S.modelSize = S.modelBox.getSize(new THREE.Vector3()).length() || 10;
  fitToModel();
  renderMiniMap();
}

$("btnSaveLite").addEventListener("click", async () => {
  if (!S.modelGroup) return;
  if (S.glbActive) { alert("Denne modellen er allerede en lett kopi."); return; }
  loadingEl.classList.add("open");
  try {
    // Kopien bygges fra geometrien som alt ligger i scenen – modellen lastes
    // IKKE om igjen i lav kvalitet, slik den måtte før.
    const { bytes, ids, utelatt } = await byggLettKopi((t) => { loadingText.textContent = t; });
    const blob = new Blob([bytes], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = lettNavn(S.fileName);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    statusEl.textContent = ids.size + " elementer i lett kopi" +
      (utelatt ? " (" + utelatt + " små/festemidler utelatt)" : "");
  } catch (err) {
    console.error(err);
    alert("Klarte ikke å lage lett kopi: " + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});

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
  if (S.modelGroup && (S.lastBuffer || S.bufferITråd) && S.lightMode !== S.lightLoaded &&
      confirm("Laste modellen på nytt i " + (S.lightMode ? "lav" : "full") + " kvalitet?")) {
    loadingEl.classList.add("open");
    loadingText.textContent = "Laster på nytt …";
    await new Promise(r => setTimeout(r, 30));
    try {
      setLoadFlag(Object.assign({}, S.lastLoadInfo || { name: S.fileName }, { light: S.lightMode }));
      const buf = await hentBuffer();
      if (!buf) throw new Error("Fant ikke modellfilen igjen – åpne den på nytt");
      await loadModel(buf);
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
  if (S.lightMode || !(S.lastBuffer || S.bufferITråd)) return false;
  if (!confirm("Klarte ikke å laste modellen (" + ((err && err.message) || err) + ").\n\nPrøve på nytt i lav kvalitet?")) return false;
  setLight(true);
  loadingEl.classList.add("open");
  loadingText.textContent = "Prøver i lav kvalitet …";
  await new Promise(r => setTimeout(r, 30));
  try {
    setLoadFlag(Object.assign({}, S.lastLoadInfo || { name: S.fileName }, { light: true }));
    const buf = await hentBuffer();
    if (!buf) throw new Error("Fant ikke modellfilen igjen");
    await loadModel(buf);
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
  b.innerHTML = "Forrige forsøk på å åpne <b>" + esc(String(info.name || "modellen")) + "</b> ser ut til å ha krasjet nettleseren." +
    (info.light
      ? " Den var allerede i lav kvalitet – modellen er trolig for stor for denne enheten."
      : "<br><button id='crashRetry' class='primary' style='margin-top:10px'>Prøv igjen i lav kvalitet</button>");
  const btn = $("crashRetry");
  if (btn) btn.onclick = () => {
    setLight(true);
    b.style.display = "none";
    if (info.libId) spOpenFile({ id: info.libId, name: info.name, size: info.size });
    else alert("Velg «" + (info.name || "filen") + "» på nytt – den åpnes nå i lav kvalitet.");
  };
})();
