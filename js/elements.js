// Valg, egenskaper, søk, mengder og markeringsboks.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, apnePanel, dec, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { hiddenIDs, hideElement } from "./display.js";
import { alleElementIder, lightElementBoxes } from "./ifc.js";
import { kall, metaFor, sikreMeta } from "./ifcrpc.js";
import { axesGroup, camera, canvas, controls, grid, koteGroup, markerGroup, measureGroup, pointer, raycaster, renderer, scene, selGroup } from "./scene.js";

const selMat = new THREE.MeshLambertMaterial({ color: 0x3b82f6, emissive: 0x1d4ed8, side: THREE.DoubleSide });

const selMatLight = new THREE.MeshBasicMaterial({
  color: 0x3b82f6, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});

// Hvor mange rader elementlista viser før den kortes av. 0 = vis alle.
export function listeGrense() {
  const n = Number(S.settings.listLimit);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

// Tar bort BARE den blå uthevingen i 3D. Brukes internt når et nytt sett skal
// tegnes opp (da skal S.multiSel stå urørt).
function clearSelectionVisual() {
  S.selectedMeshes.forEach(({ mesh, mat }) => mesh.material = mat);
  S.selectedMeshes = [];
  selGroup.children.forEach(h => h.geometry.dispose());
  selGroup.clear();
  S.currentPropID = null;
}

// Nullstiller valget HELT – både uthevingen og flervalgslista.
// VIKTIG: S.multiSel må tømmes her. Ellers lever de gamle elementene videre i
// lista selv om de ikke lenger er blå, og neste shift-klikk drar dem opp igjen
// (klikk i tomrommet, skjul/vis, fargelegging og transparent kaller alle hit).
export function clearSelection() {
  clearSelectionVisual();
  S.multiSel.clear();
}

// Finn expressID fra et raycast-treff (også i sammenslått geometri)
export function hitID(hit) {
  const u = hit.object.userData;
  if (!u.merged) return u.expressID;
  const fi = hit.faceIndex * 3;
  const r = u.ranges;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fi < r[mid].start) hi = mid - 1;
    else if (fi >= r[mid].start + r[mid].count) lo = mid + 1;
    else return r[mid].id;
  }
  return null;
}

export function pick(clientX, clientY, ignoreClip) {
  if (!S.modelGroup) return null;
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = S.modelGroup.children.filter(m => m.visible);
  const hits = raycaster.intersectObjects(visible, false);
  // hopp over treff bak snittplanet
  if (!ignoreClip && renderer.clippingPlanes.length) {
    for (const h of hits) {
      if (renderer.clippingPlanes.every(p => p.distanceToPoint(h.point) >= -0.001)) return h;
    }
    return null;
  }
  return hits.length ? hits[0] : null;
}

export function selectElement(expressID, additive) {
  if (!additive) clearSelection();
  S.currentPropID = expressID;
  if (S.lightLoaded) {
    // bygg en liten kopi av elementets trekanter som legges oppå
    S.modelGroup.children.forEach(m => {
      if (!m.userData.merged) return;
      const rs = m.userData.ranges.filter(r => r.id === expressID);
      if (!rs.length) return;
      const p = m.geometry.getAttribute("position").array;
      const ix = m.geometry.getIndex().array;
      let n = 0;
      rs.forEach(r => n += r.count);
      const arr = new Float32Array(n * 3);
      let o = 0;
      rs.forEach(r => {
        for (let i = r.start; i < r.start + r.count; i++) {
          const vi = ix[i] * 3;
          arr[o] = p[vi]; arr[o+1] = p[vi+1]; arr[o+2] = p[vi+2];
          o += 3;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const hl = new THREE.Mesh(g, selMatLight);
      hl.renderOrder = 996;
      selGroup.add(hl);
    });
    return;
  }
  S.modelGroup.children.forEach(m => {
    if (m.userData.expressID === expressID) {
      S.selectedMeshes.push({ mesh: m, mat: m.material });
      m.material = selMat;
    }
  });
}

export function val(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "value" in v) return v.value;
  return v;
}

// Asynkron fordi egenskapslista hentes fra IFC-tråden. Kallerne trenger ikke
// vente – panelet fyller seg selv når svaret kommer.
export async function showProperties(expressID) {
  const body = $("propBody");
  const rows = [];
  if (S.glbActive) {
    const p = S.glbProps ? S.glbProps.get(expressID) : null;
    $("propTitle").textContent = (p && p[2]) || t("Element");
    rows.push(["ExpressID", expressID]);
    if (p && p[0]) rows.push(["Name", p[0]]);
    if (p && p[1]) rows.push(["ObjectType", p[1]]);
    if (p && p[3]) rows.push([t("Materiale"), p[3]]);
    try {
      const q = elementQuantities(expressID);
      rows.push([t("Mål L×B×H (ca)"), q.dims.map(fmtDim).join(" × ") + " m"]);
      rows.push([t("Areal, fotavtrykk (ca)"), fmtArea(q.area)]);
      rows.push([t("Volum (ca)"), fmtVol(q.vol)]);
    } catch(_){}
    rows.push([t("Merk"), t("Lett kopi – åpne original-IFC-en for full egenskapsliste")]);
  } else {
    // IFC-tråden svarer med hele egenskapslista i én runde
    let p = null;
    try { p = await kall("props", { id: expressID }); } catch(_) {}
    if (!p || p.feil) rows.push([t("Feil"), t("Kunne ikke lese egenskaper")]);
    else {
      $("propTitle").textContent = (p.typeName ? "Ifc" + p.typeName : t("Element"));
      rows.push(["ExpressID", expressID]);
      p.felt.forEach(([k, v]) => rows.push([k, v]));
      const mMeta = metaFor(expressID);
      if (mMeta && mMeta.material) rows.push([t("Materiale"), mMeta.material]);
      try {
        const q = elementQuantities(expressID);
        rows.push([t("Mål L×B×H (ca)"), q.dims.map(fmtDim).join(" × ") + " m"]);
        rows.push([t("Areal, fotavtrykk (ca)"), fmtArea(q.area)]);
        rows.push([t("Volum (ca)"), fmtVol(q.vol)]);
      } catch(_){}
      p.psets.forEach(([k, v]) => rows.push([k, v]));
    }
  }

  body.innerHTML =
    (S.lightLoaded ? "" : '<div class="prop-actions"><button id="paHide">' + ikon("skjul") + ' ' + t("Skjul element") + '</button></div>') +
    rows.map(([k,v]) =>
    `<div class="prop-row"><div class="k">${esc(String(k))}</div><div class="v">${esc(String(v))}</div></div>`).join("");
  if (!S.lightLoaded) $("paHide").onclick = () => hideElement(expressID);
  apnePanel("propPanel");
}

// ---------- 🔎 Elementsøk ----------

// ---------- 🔎 Elementsøk ----------

function buildSearchIndex() {
  S.searchIndex = [];
  const push = (id, name, objType, tag, type) => S.searchIndex.push({
    id,
    name: name || "", objType: objType || "", tag: tag || "", type: type || "",
    s: ((name || "") + " " + (objType || "") + " " + (tag || "") + " " + id).toLowerCase()
  });
  if (S.glbActive) {
    for (const [id, p] of (S.glbProps || new Map()))
      push(id, p[0], p[1], "", (p[2] || "").replace(/^Ifc/i, ""));
  } else if (S.modelID !== null) {
    const ids = new Set();
    S.modelGroup.children.forEach(m => {
      if (m.userData.merged) (m.userData.ranges || []).forEach(r => ids.add(r.id));
      else if (m.userData.expressID !== undefined) ids.add(m.userData.expressID);
    });
    for (const id of ids) {
      const m = metaFor(id);
      if (m) push(id, m.name, m.objectType, m.tag, m.typeName);
    }
  }
}

export function elementBoxById(id) {
  if (S.lightLoaded) return lightElementBoxes(new Set([id])).get(id) || null;
  let box = null;
  const tmp = new THREE.Box3();
  S.modelGroup.children.forEach(m => {
    if (m.userData.expressID === id) {
      tmp.setFromObject(m);
      if (box) box.union(tmp); else box = tmp.clone();
    }
  });
  return box;
}

// ---------- 🧮 Mengder per element ----------
const _qa = new THREE.Vector3(), _qb = new THREE.Vector3(), _qc = new THREE.Vector3();

// Bounding box for alle elementer (bygges én gang per modell)

export function allElementBoxes() {
  if (S.allBoxCache) return S.allBoxCache;
  const map = new Map();
  if (S.lightLoaded) lightElementBoxes(null, map);
  else {
    const tmp = new THREE.Box3();
    S.modelGroup.children.forEach(m => {
      const id = m.userData.expressID;
      if (id === undefined) return;
      tmp.setFromObject(m);
      const b = map.get(id);
      if (b) b.union(tmp); else map.set(id, tmp.clone());
    });
  }
  S.allBoxCache = map;
  return map;
}

// Bidraget fra ÉN trekant, som rene tall uten three.js – da kan matematikken
// testes for seg selv.
//   vol6  = 6 × signert volum av tetraederet origo–a–b–c (summen over et lukket
//           legeme gir 6 × volumet, uansett hvor legemet står)
//   proj2 = 2 × trekantens areal projisert ned i planet (Y er opp i scenen).
//           Absoluttverdi, så vindingsretningen i modellen ikke spiller inn.
export function triBidrag(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const vol6 = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  const proj2 = Math.abs((bz - az) * (cx - ax) - (bx - ax) * (cz - az));
  return { vol6, proj2 };
}

// Gjør summene om til meter og m²/m³.
// Et lukket legeme har både over- og underside, og begge kaster samme skygge –
// derfor deles den projiserte summen på 2 til slutt (Σproj2 / 4). Flater uten
// tykkelse (0 volum) har bare ÉN side og skal ikke halveres.
export function sluttMengder(volSum, projSum, toM) {
  const vol = Math.abs(volSum) * toM * toM * toM;
  const lukket = vol > 1e-9;
  return { vol, area: projSum / (lukket ? 4 : 2) * toM * toM };
}

// Beregner ytre mål, volum (m³) og fotavtrykk (m²) for et sett elementer i ÉN
// gjennomgang av geometrien.
// Volum: signert tetraeder-sum – funker for lukkede volumer som betong og stålprofiler.
// Fotavtrykk: grunnflaten sett rett ovenfra – se triBidrag/sluttMengder over.
//   NB: Skrå og hvelvede flater blir riktig projisert, men et element som
//   overlapper seg selv i høyden (f.eks. en trapp) får skyggen regnet to ganger.
export function quantitiesForSet(idSet) {
  const toM = S.modelSize > 1000 ? 0.001 : 1; // mm-modell → meter
  const vols = new Map();
  const projs = new Map();   // Σ|n.y| per element – rå, før halvering
  const addTri = (p, i0, i1, i2, mtx, id) => {
    _qa.fromBufferAttribute(p, i0); _qb.fromBufferAttribute(p, i1); _qc.fromBufferAttribute(p, i2);
    if (mtx) { _qa.applyMatrix4(mtx); _qb.applyMatrix4(mtx); _qc.applyMatrix4(mtx); }
    const t = triBidrag(_qa.x, _qa.y, _qa.z, _qb.x, _qb.y, _qb.z, _qc.x, _qc.y, _qc.z);
    vols.set(id, (vols.get(id) || 0) + t.vol6 / 6);
    projs.set(id, (projs.get(id) || 0) + t.proj2);
  };
  S.modelGroup.children.forEach(m => {
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute("position");
    const ix = m.geometry.getIndex();
    if (m.userData.merged) {
      if (!ix) return;
      (m.userData.ranges || []).forEach(r => {
        if (!idSet.has(r.id)) return;
        for (let i = r.start; i < r.start + r.count; i += 3)
          addTri(p, ix.getX(i), ix.getX(i + 1), ix.getX(i + 2), null, r.id);
      });
    } else if (idSet.has(m.userData.expressID)) {
      const n = ix ? ix.count : p.count;
      for (let i = 0; i < n; i += 3)
        addTri(p, ix ? ix.getX(i) : i, ix ? ix.getX(i + 1) : i + 1, ix ? ix.getX(i + 2) : i + 2, m.matrixWorld, m.userData.expressID);
    }
  });
  const boxes = allElementBoxes();
  const out = new Map();
  const s = new THREE.Vector3();
  for (const id of idSet) {
    let dims = [0, 0, 0];
    const b = boxes.get(id);
    if (b) { b.getSize(s); dims = [s.x * toM, s.y * toM, s.z * toM].sort((a, x) => x - a); }
    const m = sluttMengder(vols.get(id) || 0, projs.get(id) || 0, toM);
    out.set(id, { dims, vol: m.vol, area: m.area });
  }
  return out;
}

function elementQuantities(id) {
  return quantitiesForSet(new Set([id])).get(id) || { dims: [0, 0, 0], vol: 0, area: 0 };
}

// Desimaler følger ⚙ Innstillinger. Små volumer får alltid nok desimaler til å
// vise noe – et 0,005 m³-element skal ikke stå som «0,00 m³».
export function fmtVol(v) {
  const d = Math.max(dec(), v > 0 && v < 0.01 ? 3 : 0);
  return v.toFixed(d) + " m³";
}

export function fmtDim(d) { return d.toFixed(dec()); }

export function elemDisplayName(id) {
  if (S.glbActive) { const p = S.glbProps && S.glbProps.get(id); return (p && (p[0] || p[1])) || ("ID " + id); }
  try { const line = metaFor(id) || {}; return (line.name || null) || val(line.ObjectType) || ("ID " + id); } catch(_) { return "ID " + id; }
}

// ---------- Flervalg (shift-klikk) med samlede mengder ----------

function showMultiSummary() {
  let totVol = 0, totLen = 0, totArea = 0;
  const items = [];
  for (const [id, q] of S.multiSel) {
    totVol += q.vol;
    totLen += q.dims[0];
    totArea += q.area || 0;
    items.push({ id, name: elemDisplayName(id), vol: q.vol });
  }
  // Hvor mange rader lista viser før den kortes av. Settes i ⚙ Innstillinger →
  // Visning → «Elementer i lista». 0 = vis alle (kan bli tregt på tusenvis).
  const grense = listeGrense();
  const vist = grense > 0 ? items.slice(0, grense) : items;
  $("propTitle").textContent = t("{0} elementer valgt", S.multiSel.size);
  $("propBody").innerHTML =
    '<div class="prop-row" style="font-weight:600"><div class="k">' + t("Sum volum") + '</div><div class="v">' + fmtVol(totVol) + '</div></div>' +
    '<div class="prop-row" style="font-weight:600"><div class="k">' + t("Sum areal (fotavtrykk)") + '</div><div class="v">' + fmtArea(totArea) + '</div></div>' +
    '<div class="prop-row"><div class="k">' + t("Sum lengde (lengste mål)") + '</div><div class="v">' + totLen.toFixed(2) + ' m</div></div>' +
    '<div class="prop-row"><div class="k">' + t("Antall") + '</div><div class="v">' + S.multiSel.size + t(" stk") + '</div></div>' +
    vist.map(it => '<div class="prop-row"><div class="k">' + esc(it.name) + '</div><div class="v">' + fmtVol(it.vol) + '</div></div>').join("") +
    (items.length > vist.length ? '<p style="color:var(--muted); font-size:11px; margin-top:6px">' + t("… og {0} til (summene øverst gjelder alle). Endre grensen i ⚙ Innstillinger → Visning.", items.length - vist.length) + '</p>' : "") +
    '<p style="color:var(--muted); font-size:11px; margin-top:8px">' + t("Shift-klikk legger til/fjerner. Shift + dra lager markeringsboks: mot høyre = kun synlige, mot venstre = alt i boksen. Vanlig klikk nullstiller.") + '</p>';
  apnePanel("propPanel");
}

// Markerer et helt sett elementer i én gjennomgang (raskt også for hundrevis)
function selectElementsSet(idSet) {
  clearSelectionVisual();   // ikke clearSelection() – den ville tømt S.multiSel vi nettopp fylte
  if (!idSet.size) return;
  if (S.lightLoaded) {
    S.modelGroup.children.forEach(m => {
      if (!m.userData.merged) return;
      const rs = (m.userData.ranges || []).filter(r => idSet.has(r.id));
      if (!rs.length) return;
      const p = m.geometry.getAttribute("position").array;
      const ix = m.geometry.getIndex().array;
      let n = 0;
      rs.forEach(r => n += r.count);
      const arr = new Float32Array(n * 3);
      let o = 0;
      rs.forEach(r => {
        for (let i = r.start; i < r.start + r.count; i++) {
          const vi = ix[i] * 3;
          arr[o] = p[vi]; arr[o+1] = p[vi+1]; arr[o+2] = p[vi+2];
          o += 3;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const hl = new THREE.Mesh(g, selMatLight);
      hl.renderOrder = 996;
      selGroup.add(hl);
    });
  } else {
    S.modelGroup.children.forEach(m => {
      if (idSet.has(m.userData.expressID)) {
        S.selectedMeshes.push({ mesh: m, mat: m.material });
        m.material = selMat;
      }
    });
  }
}

// Felles shift-klikk-logikk (brukes både ved klikk og små drag)
function shiftClickAt(x, y) {
  const hit = pick(x, y);
  if (!hit) return;
  const id = hitID(hit);
  if (id == null) return;
  if (!S.multiSel.size && S.currentPropID != null && S.currentPropID !== id)
    S.multiSel.set(S.currentPropID, elementQuantities(S.currentPropID));
  if (S.multiSel.has(id)) S.multiSel.delete(id);
  else S.multiSel.set(id, elementQuantities(id));
  selectElementsSet(new Set(S.multiSel.keys()));
  if (S.multiSel.size) showMultiSummary();
  else $("propPanel").classList.remove("open");
}

export function zoomToElement(id) {
  const box = elementBoxById(id);
  if (!box) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || S.modelSize * 0.05;
  controls.target.copy(c);
  const dir = camera.position.clone().sub(c);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize().multiplyScalar(Math.max(size * 2.5, S.modelSize * 0.02));
  camera.position.copy(c).add(dir);
  selectElement(id);
  showProperties(id);
}

$("btnSearch").addEventListener("click", () => {
  if (!S.modelGroup) return;
  const panel = $("searchPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  apnePanel("searchPanel");
  if (!S.searchIndex) {
    $("searchBody").innerHTML = '<p style="color:var(--muted)">' + t("Bygger søkeindeks …") + '</p>';
    setTimeout(async () => { await sikreMeta(alleElementIder); buildSearchIndex(); renderSearchUI(); }, 30);
  } else renderSearchUI();
});

function renderSearchUI() {
  $("searchBody").innerHTML =
    '<input type="search" id="elSearch" placeholder="' + t("Navn, merke, profil eller ID …") + '" autocomplete="off">' +
    '<div id="searchList"></div>';
  const inp = $("elSearch");
  inp.value = S.lastQuery;
  inp.addEventListener("input", () => { S.lastQuery = inp.value; renderSearchResults(); });
  inp.focus();
  renderSearchResults();
}

function renderSearchResults() {
  const el = $("searchList");
  const q = S.lastQuery.trim().toLowerCase();
  if (q.length < 2) {
    el.innerHTML = '<p style="color:var(--muted); font-size:12px; margin-top:8px">' + t("Skriv minst 2 tegn – søker i navn, merke (Tag), profil og ExpressID. {0} elementer i indeksen.", S.searchIndex.length) + '</p>';
    return;
  }
  const hits = S.searchIndex.filter(e => e.s.includes(q));
  if (!hits.length) { el.innerHTML = '<p style="color:var(--muted); margin-top:8px">' + t("Ingen treff på «{0}».", esc(S.lastQuery)) + '</p>'; return; }
  el.innerHTML = hits.slice(0, 50).map(h =>
    '<div class="lib-item" data-eid="' + h.id + '">' +
    '<div class="n">' + esc(h.name || h.objType || String(h.id)) + '</div>' +
    '<div class="m">' + esc([h.type, h.objType, h.tag && (t("Merk: ") + h.tag)].filter(Boolean).join(" · ")) + '</div></div>').join("") +
    (hits.length > 50 ? '<p style="color:var(--muted); font-size:11px; margin-top:6px">' + t("Viser 50 av {0} treff – skriv mer for å avgrense.", hits.length) + '</p>' : "");
  el.querySelectorAll(".lib-item").forEach(d =>
    d.addEventListener("click", () => zoomToElement(Number(d.dataset.eid))));
}

// ---------- Mengder ----------
$("btnQty").addEventListener("click", async () => {
  if (!S.modelGroup) return;
  const panel = $("qtyPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.qtyCache) {
    // volumberegningen tar litt tid på store modeller – vis at det skjer noe
    loadingText.textContent = t("Regner ut mengder …");
    loadingEl.classList.add("open");
    await new Promise(r => setTimeout(r, 30));
    try { await sikreMeta(alleElementIder); S.qtyCache = computeQuantities(); }
    finally { loadingEl.classList.remove("open"); }
  }
  renderQuantities(S.qtyCache);
  apnePanel("qtyPanel");
});

// Samler mengder både gruppert (til panelet) og per element (til regneark).
// Volum regnes i samme gjennomgang som sammenligningen bruker, så det koster én
// runde gjennom geometrien uansett hvor mange elementer modellen har.
function computeQuantities() {
  // bounding box per element (funker i både full og lav kvalitet)
  const boxMap = new Map();
  if (S.lightLoaded) {
    lightElementBoxes(null, boxMap);
  } else {
    const tmp = new THREE.Box3();
    S.modelGroup.children.forEach(m => {
      const id = m.userData.expressID;
      tmp.setFromObject(m);
      const b = boxMap.get(id);
      if (b) b.union(tmp); else boxMap.set(id, tmp.clone());
    });
  }
  const toM = S.modelSize > 1000 ? 0.001 : 1;   // mm-modell → meter
  const vq = quantitiesForSet(new Set(boxMap.keys()));
  const groups = new Map();
  const rows = [];
  const sizeV = new THREE.Vector3();
  for (const [id, box] of boxMap) {
    let name = "", objType = "", typeName = "", material = "";
    if (S.glbActive) {
      const p = S.glbProps ? S.glbProps.get(id) : null;
      if (p) { name = p[0] || ""; objType = p[1] || ""; typeName = (p[2] || "").replace(/^Ifc/, ""); material = p[3] || ""; }
    } else {
      const meta = metaFor(id);
      if (meta) { name = meta.name || ""; objType = meta.objectType || ""; typeName = meta.typeName || ""; material = meta.material || ""; }
    }
    // gruppenøkkel: ObjectType er oftest profilen (f.eks. CFSHS100x6), ellers navn uten løpenummer
    let key = objType || name.replace(/:\d+$/, "") || typeName || "Ukjent";
    // lengde: lengste dimensjon av elementets samlede boks, i meter
    box.getSize(sizeV);
    const len = Math.max(sizeV.x, sizeV.y, sizeV.z) * toM;
    const q = vq.get(id) || { dims: [0, 0, 0], vol: 0, area: 0 };
    // Gruppene skilles også på materiale: en betongsøyle og en stålsøyle med
    // samme mål skal ikke havne på samme rad i en vareordre.
    const gkey = key + (material ? " · " + material : "");
    if (!groups.has(gkey)) groups.set(gkey, { count: 0, length: 0, vol: 0, area: 0, type: typeName, material });
    const g = groups.get(gkey);
    g.count++;
    g.length += len;
    g.vol += q.vol;
    g.area += q.area;
    rows.push({
      id, key: gkey, name, objType, type: typeName, material,
      L: q.dims[0], B: q.dims[1], H: q.dims[2], len, vol: q.vol, area: q.area
    });
  }
  const sortedRows = rows.sort((a, b) => a.key.localeCompare(b.key, "no") || a.id - b.id);
  return {
    groups: [...groups.entries()].sort((a, b) => b[1].count - a[1].count),
    rows: sortedRows,
    types: typeListe(sortedRows),
    materialer: materialListe(sortedRows)
  };
}

// ---------- Objekttyper (til nedtrekket) ----------
// IFC-typenavnet er engelsk og står uten «Ifc» i dataene («Beam», «Footing»).
// Her får de norske navn – ukjente typer vises som de er.
const TYPE_NAVN = {
  Footing: "Fundamenter", Pile: "Peler", Column: "Søyler", Beam: "Bjelker",
  Member: "Staver", Plate: "Plater", Wall: "Vegger",
  WallStandardCase: "Vegger", CurtainWall: "Glassfasader",
  Slab: "Dekker", Roof: "Tak", Stair: "Trapper", StairFlight: "Trappeløp",
  Ramp: "Ramper", RampFlight: "Rampeløp", Railing: "Rekkverk",
  Covering: "Kledning", Door: "Dører", Window: "Vinduer",
  Reinforcing: "Armering", ReinforcingBar: "Armeringsjern",
  ReinforcingMesh: "Armeringsnett", Fastener: "Festemidler",
  MechanicalFastener: "Festemidler", DiscreteAccessory: "Tilbehør",
  BuildingElementProxy: "Øvrige bygningsdeler", ElementAssembly: "Sammenstillinger",
  Pipe: "Rør", PipeSegment: "Rør", DuctSegment: "Kanaler",
  Furniture: "Inventar", Space: "Rom", Site: "Tomt"
};

export function typeVisning(typ) {
  if (!typ) return t("Uten IFC-type");
  return TYPE_NAVN[typ] ? t(TYPE_NAVN[typ]) : typ;
}

// Liste over objekttypene som faktisk finnes i modellen, flest først.
function typeListe(rows) {
  const m = new Map();
  rows.forEach(r => {
    const t = r.type || "";
    if (!m.has(t)) m.set(t, { count: 0, vol: 0, area: 0 });
    const e = m.get(t);
    e.count++; e.vol += r.vol; e.area += r.area;
  });
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
}

// ---------- Materiale ----------
// Materialnavnene i en IFC-modell er ikke standardiserte: «B35», «C35/45»,
// «Concrete - Cast-in-Place», «Betong». For å kunne ta ut ALLE betongsøyler i én
// fil, uansett hva prosjekterende har kalt betongen, kjennes navnet igjen på
// nøkkelord og havner i en grovgruppe. Enkeltmaterialene kan fortsatt velges.
const MAT_GRUPPER = [
  ["Betong", /betong|concrete|\bc\d{2}\/\d{2}\b|\bb\d{2}\b|elementbetong|lettbetong/i],
  ["Stål", /\bstål\b|\bstal\b|steel|\bs\d{3}\b|\bhup\b|\bheb?\b|\bipe\b|galvanis|jern(?!bane)/i],
  ["Armering", /armering|reinforc|\bkamstål\b|\bb500\b/i],
  ["Tre", /\btre\b|\btrevirke\b|timber|wood|limtre|kerto|\bc24\b|\bgl30\b|kryssfin/i],
  ["Mur", /mur|brick|tegl|blokk|leca|betongstein/i],
  ["Isolasjon", /isolasjon|insulat|mineralull|glava|rockwool|eps\b|xps\b/i],
  ["Aluminium", /aluminium|alu\b/i],
  ["Glass", /glass|glazing/i],
  ["Gips", /gips|plaster|gypsum/i]
];

export function materialGruppe(navn) {
  const s = String(navn || "").trim();
  if (!s) return "";
  for (const [gruppe, m] of MAT_GRUPPER) if (m.test(s)) return gruppe;
  return "Annet";
}

export function materialVisning(mat) {
  return mat ? mat : t("Uten materiale");
}

// Materialene som faktisk fins i modellen, med grovgruppe og antall.
function materialListe(rows) {
  const m = new Map();
  rows.forEach(r => {
    const mat = r.material || "";
    if (!m.has(mat)) m.set(mat, { count: 0, gruppe: materialGruppe(mat) });
    m.get(mat).count++;
  });
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
}

// Filtrerer en ferdig mengde-cache ned til én objekttype og/eller ett materiale.
// `mat` er "" (alle), "g:Betong" (hele grovgruppen) eller "m:B35" (nøyaktig
// materialnavn). Gruppene regnes på nytt fra radene, så «Antall» i arket
// stemmer med det som faktisk eksporteres.
export function qtyForType(cache, type, mat) {
  if (!type && !mat) return cache;
  const rows = cache.rows.filter(r => {
    if (type && (r.type || "") !== type) return false;
    if (!mat) return true;
    if (mat.slice(0, 2) === "g:") return materialGruppe(r.material) === mat.slice(2);
    if (mat.slice(0, 2) === "m:") return (r.material || "") === mat.slice(2);
    return true;
  });
  const groups = new Map();
  rows.forEach(r => {
    if (!groups.has(r.key)) groups.set(r.key, { count: 0, length: 0, vol: 0, area: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.vol += r.vol; g.area += r.area;
  });
  return {
    groups: [...groups.entries()].sort((a, b) => b[1].count - a[1].count),
    rows, types: cache.types, materialer: cache.materialer
  };
}

// ---------- Eksport til regneark ----------
// Semikolon og desimalkomma, som norsk Excel forventer, og BOM foran så æøå
// blir riktig. Da åpner fila rett i Excel uten importveiviser.
const nb = (n, d) => (Number(n) || 0).toFixed(d === undefined ? 3 : d).replace(".", ",");

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  return rows.map(r => r.map(csvCell).join(";")).join("\r\n");
}

function download(name, text, mime) {
  const blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function baseName() {
  return (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
}

// Regnearket skal aldri være mindre presist enn skjermen, men heller ikke miste
// presisjon om noen setter visningen til 0 desimaler.
const csvLenDec = () => Math.max(dec(), 3);
const csvVolDec = () => Math.max(dec(), 4);

const csvAreaDec = () => Math.max(dec(), 3);

export function qtyGroupRows(cache) {
  const out = [[t("Gruppe"), t("IFC-type"), t("Materiale"), t("Antall"), t("Sum lengde (m)"), t("Sum areal (m2)"), t("Sum volum (m3)")]];
  cache.groups.forEach(([key, g]) => out.push([key, g.type || "", g.material || "", g.count,
    nb(g.length, csvLenDec()), nb(g.area, csvAreaDec()), nb(g.vol, csvVolDec())]));
  const tot = cache.groups.reduce((s, [, g]) => [s[0] + g.count, s[1] + g.length, s[2] + g.vol, s[3] + g.area], [0, 0, 0, 0]);
  out.push([]);
  out.push([t("SUM"), "", "", tot[0], nb(tot[1], csvLenDec()), nb(tot[3], csvAreaDec()), nb(tot[2], csvVolDec())]);
  return out;
}

export function qtyElementRows(cache) {
  const out = [["ElementID", t("Gruppe"), t("Navn"), "ObjectType", t("IFC-type"), t("Materiale"),
    t("Lengde (m)"), t("Bredde (m)"), t("Høyde (m)"), t("Lengste mål (m)"), t("Areal (m2)"), t("Volum (m3)")]];
  cache.rows.forEach(r => out.push([r.id, r.key, r.name, r.objType, r.type, r.material || "",
    nb(r.L, csvLenDec()), nb(r.B, csvLenDec()), nb(r.H, csvLenDec()),
    nb(r.len, csvLenDec()), nb(r.area, csvAreaDec()), nb(r.vol, csvVolDec())]));
  return out;
}

export function fmtArea(a) {
  const d = Math.max(dec(), a > 0 && a < 0.01 ? 3 : 0);
  return a.toFixed(d) + " m²";
}

function renderQuantities(full) {
  // S.qtyType er valgt objekttype ("" = alle). Alt under – tabell, sum og
  // eksport – gjelder det som er valgt, slik at CSV-fila blir «ett ark».
  const valgt = S.qtyType || "";
  if (!(full.types || []).some(([t]) => t === valgt)) S.qtyType = "";
  // materialvalget kan være g:<gruppe> eller m:<nøyaktig navn>
  const mv = S.qtyMat || "";
  const matFinnes = !mv ||
    (mv.slice(0, 2) === "g:" && (full.materialer || []).some(([m]) => materialGruppe(m) === mv.slice(2))) ||
    (mv.slice(0, 2) === "m:" && (full.materialer || []).some(([m]) => m === mv.slice(2)));
  if (!matFinnes) S.qtyMat = "";
  const cache = (S.qtyType || S.qtyMat) ? qtyForType(full, S.qtyType, S.qtyMat) : full;
  const matNavnValgt = S.qtyMat ? S.qtyMat.slice(2) || t("Uten materiale") : "";
  const filnavnDel = (S.qtyType ? " - " + typeVisning(S.qtyType) : "") +
    (matNavnValgt ? " - " + matNavnValgt : "");

  const list = cache.groups;
  const total = list.reduce((s, [, g]) => s + g.count, 0);
  const totVol = list.reduce((s, [, g]) => s + g.vol, 0);
  const totLen = list.reduce((s, [, g]) => s + g.length, 0);
  const totArea = list.reduce((s, [, g]) => s + g.area, 0);

  // Nedtrekkene teller innenfor det ANDRE valget: har du valgt Søyler, viser
  // materiallista hvor mange søyler som er betong – ikke hvor mange elementer i
  // hele modellen som er betong. Ellers kan du velge en kombinasjon som gir 0.
  const forType = S.qtyMat ? qtyForType(full, "", S.qtyMat).rows : full.rows;
  const forMat = S.qtyType ? qtyForType(full, S.qtyType, "").rows : full.rows;
  const tell = (rader, passer) => rader.reduce((s, r) => s + (passer(r) ? 1 : 0), 0);

  const typeValg = (full.types || []).map(([t]) => [t, tell(forType, r => (r.type || "") === t)])
    .filter(([, n]) => n > 0);

  // materialer: grovgrupper først, deretter de nøyaktige navnene
  // NB: tell én gang PER GRUPPE. Å summere per materialnavn ville tellet hver
  // rad på nytt for hvert navn i gruppen (tre betongnavn ⇒ tre ganger for høyt).
  const grupper = new Set();
  (full.materialer || []).forEach(([m]) => { const g = materialGruppe(m); if (g) grupper.add(g); });
  const gruppeValg = [...grupper]
    .map(g => [g, tell(forMat, r => materialGruppe(r.material) === g)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const matValg = (full.materialer || []).map(([m]) => [m, tell(forMat, r => (r.material || "") === m)])
    .filter(([, n]) => n > 0);
  const harMateriale = (full.materialer || []).some(([m]) => m);

  const nedtrekk =
    '<div class="qty-filtre">' +
    '<label class="qty-type-velg">' + t("Objekttype") +
    '<select id="qtyType">' +
      '<option value=""' + (S.qtyType ? "" : " selected") + '>' + t("Alle typer ({0} stk)", forType.length) + '</option>' +
      typeValg.map(([typ, n]) =>
        '<option value="' + esc(typ) + '"' + (typ === S.qtyType ? " selected" : "") + '>' +
        esc(typeVisning(typ)) + ' (' + n + t(" stk") + ')</option>').join("") +
    '</select></label>' +
    (harMateriale
      ? '<label class="qty-type-velg">' + t("Materiale") +
        '<select id="qtyMat">' +
          '<option value=""' + (S.qtyMat ? "" : " selected") + '>' + t("Alle materialer ({0} stk)", forMat.length) + '</option>' +
          (gruppeValg.length
            ? '<optgroup label="' + t("Materialgrupper") + '">' + gruppeValg.map(([g, n]) =>
                '<option value="g:' + esc(g) + '"' + ("g:" + g === S.qtyMat ? " selected" : "") + '>' +
                esc(t(g)) + ' (' + n + t(" stk") + ')</option>').join("") + '</optgroup>'
            : "") +
          '<optgroup label="' + t("Enkeltmaterialer") + '">' + matValg.map(([m, n]) =>
            '<option value="m:' + esc(m) + '"' + ("m:" + m === S.qtyMat ? " selected" : "") + '>' +
            esc(materialVisning(m)) + ' (' + n + t(" stk") + ')</option>').join("") + '</optgroup>' +
        '</select></label>'
      : "") +
    '</div>';

  $("qtyBody").innerHTML =
    nedtrekk +
    '<div class="prop-actions">' +
      '<button id="qtyCsvG" class="primary" title="' + t("Én rad per gruppe, bare valgt objekttype") + '">' + ikon("lastned") + ' ' + t("Grupper (CSV)") + '</button>' +
      '<button id="qtyCsvE" title="' + t("Én rad per element – for mengdeberegning og vareordre") + '">' + ikon("lastned") + ' ' + t("Alle elementer") + '</button>' +
      '<button id="qtyCopy" title="' + t("Lim rett inn i et åpent regneark") + '">' + ikon("kopier") + ' ' + t("Kopier") + '</button>' +
    '</div>' +
    '<div class="qty-row" style="font-weight:600"><div class="n">' +
      esc([S.qtyType ? typeVisning(S.qtyType) : "", matNavnValgt].filter(Boolean).join(" · ") || t("Totalt")) +
      '</div><div class="c">' + total +
      t(" stk") + ' · ' + totLen.toFixed(dec()) + ' m · ' + fmtArea(totArea) + ' · ' + fmtVol(totVol) + '</div></div>' +
    list.map(([key, g]) =>
      '<div class="qty-row"><div class="n">' + esc(key) + (g.type ? ' <span style="color:var(--muted);font-size:11px">(' + esc(typeVisning(g.type)) + ')</span>' : "") + '</div>' +
      '<div class="c">' + g.count + t(" stk") + ' · ' + g.length.toFixed(dec()) + ' m · ' + fmtArea(g.area) + ' · ' + fmtVol(g.vol) + '</div></div>').join("") +
    '<p style="color:var(--muted); font-size:11px; margin-top:10px">' +
    t("Antall desimaler settes i Innstillinger. Velg objekttype og materiale for å få ett ark om gangen – nedlastingen inneholder bare det som står i lista nå (f.eks. Søyler + Betong gir bare betongsøylene). Materialgruppene samler navn som betyr det samme: «B35», «C35/45» og «Concrete» havner alle under Betong. Mangler materiale på et element, står det ikke i IFC-fila. Lengde = lengste mål per element (ca-verdi, summert per gruppe). Areal = fotavtrykk, altså grunnflaten sett rett ovenfra – det målet dekker, plater og fundamenter bestilles etter. Volum er regnet ut av geometrien og gjelder lukkede volumer – hule profiler blir riktige, flater uten tykkelse blir 0.") + '</p>';

  const sel = $("qtyType");
  if (sel) sel.onchange = () => { S.qtyType = sel.value; renderQuantities(full); };
  const selM = $("qtyMat");
  if (selM) selM.onchange = () => { S.qtyMat = selM.value; renderQuantities(full); };

  $("qtyCsvG").onclick = () => download(baseName() + filnavnDel + " - mengder.csv", toCsv(qtyGroupRows(cache)));
  $("qtyCsvE").onclick = () => download(baseName() + filnavnDel + " - mengder per element.csv", toCsv(qtyElementRows(cache)));
  $("qtyCopy").onclick = async () => {
    // tabulator lar deg lime rett inn i celler i et åpent ark
    const tsv = qtyGroupRows(cache).map(r => r.join("\t")).join("\r\n");
    try {
      await navigator.clipboard.writeText(tsv);
      $("qtyCopy").textContent = t("Kopiert");
      setTimeout(() => { if ($("qtyCopy")) $("qtyCopy").innerHTML = ikon("kopier") + " " + t("Kopier"); }, 1500);
    } catch(_) { alert(t("Klarte ikke å kopiere. Bruk Grupper (CSV) i stedet.")); }
  };
}

// Tegner tall på nytt når desimalvalget endres i ⚙ Innstillinger.
// Mål-lapper som alt er plassert i 3D beholder teksten de fikk – nye lapper
// følger den nye innstillingen.
export function refreshNumbers() {
  if ($("qtyPanel").classList.contains("open") && S.qtyCache) renderQuantities(S.qtyCache);
  if ($("propPanel").classList.contains("open")) {
    if (S.multiSel.size) showMultiSummary();
    else if (S.currentPropID != null) showProperties(S.currentPropID);
  }
}

// ---------- Markeringsboks (shift + dra) ----------
// Mot høyre (blå): kun elementer som er synlige i boksen. Mot venstre (grønn): alt innenfor, også skjult bak.

const boxSelEl = document.createElement("div");

boxSelEl.style.cssText = "position:fixed; border:1.5px dashed #8ab4ff; background:rgba(59,130,246,.12); display:none; z-index:20; pointer-events:none";

document.body.appendChild(boxSelEl);

// Farge per element bakes inn som vertex-farge (expressID → RGB) for GPU-basert synlighetstest
function ensureIdColors() {
  let added = false;
  S.modelGroup.children.forEach(m => {
    if (!m.isMesh || m.geometry.getAttribute("color")) return;
    added = true;
    const count = m.geometry.getAttribute("position").count;
    const arr = new Uint8Array(count * 3);
    const write = (vi, id) => { arr[vi] = (id >> 16) & 255; arr[vi+1] = (id >> 8) & 255; arr[vi+2] = id & 255; };
    if (m.userData.merged) {
      const ix = m.geometry.getIndex().array;
      for (const r of (m.userData.ranges || []))
        for (let i = r.start; i < r.start + r.count; i++) write(ix[i] * 3, r.id);
    } else {
      const id = m.userData.expressID || 0;
      for (let i = 0; i < count; i++) write(i * 3, id);
    }
    m.geometry.setAttribute("color", new THREE.BufferAttribute(arr, 3, true));
  });
  return added;
}

// Tegner scenen med ID-farger og leser av pikslene i boksen → elementer som faktisk er synlige der
function idsVisibleInRect(x0, y0, x1, y1) {
  const freshAttrs = ensureIdColors();
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const scale = Math.min(1, 1400 / Math.max(w, h));
  const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale));
  const rt = new THREE.WebGLRenderTarget(rw, rh);
  if (!S._idMat) S._idMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const overlays = [markerGroup, measureGroup, koteGroup, axesGroup, selGroup];
  const vis = overlays.map(g => g.visible);
  overlays.forEach(g => g.visible = false);
  const gridVis = grid.visible; grid.visible = false;
  const bg = scene.background; scene.background = new THREE.Color(0x000000);
  const prevCS = renderer.outputColorSpace; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const swaps = [];
  S.modelGroup.children.forEach(m => { if (m.isMesh) { swaps.push([m, m.material]); m.material = S._idMat; } });
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  // aller første render etter at fargeattributter er lagt til blir svart (VAO-oppdatering) – render en gang til
  if (freshAttrs) renderer.render(scene, camera);
  const sx = Math.max(0, Math.round(Math.min(x0, x1) * scale));
  const sy = Math.max(0, Math.round((h - Math.max(y0, y1)) * scale));
  const sw = Math.max(1, Math.min(rw - sx, Math.round(Math.abs(x1 - x0) * scale)));
  const sh = Math.max(1, Math.min(rh - sy, Math.round(Math.abs(y1 - y0) * scale)));
  const buf = new Uint8Array(sw * sh * 4);
  renderer.readRenderTargetPixels(rt, sx, sy, sw, sh, buf);
  renderer.setRenderTarget(null);
  swaps.forEach(([m, mat]) => m.material = mat);
  overlays.forEach((g, i) => g.visible = vis[i]);
  grid.visible = gridVis;
  scene.background = bg;
  renderer.outputColorSpace = prevCS;
  rt.dispose();
  const ids = new Set();
  for (let i = 0; i < buf.length; i += 4) {
    const id = (buf[i] << 16) | (buf[i+1] << 8) | buf[i+2];
    if (id) ids.add(id);
  }
  return ids;
}

// Geometrisk test: alle elementer hvis projiserte boks berører markeringen (også skjult bak andre)
// Alle elementer som ikke er synlige NÅ. Dekker både «Skjul element» (hiddenIDs)
// og hele typer skjult fra 🎨 Utseende – de siste ligger bare som m.visible=false
// på meshene, ikke i hiddenIDs, og slapp derfor gjennom markeringsboksen før.
// Bygges én gang per markering: å spørre per element ville blitt O(n²).
export function skjulteIder() {
  const skjult = new Set(hiddenIDs);
  if (!S.modelGroup || S.lightLoaded) return skjult;  // sammenslått geometri: bare hiddenIDs gjelder
  const synlige = new Set();
  S.modelGroup.children.forEach(m => {
    const id = m.userData.expressID;
    if (id === undefined) return;
    if (m.visible) synlige.add(id); else skjult.add(id);
  });
  // et element med flere deler regnes som synlig så lenge én del vises
  for (const id of synlige) if (!hiddenIDs.has(id)) skjult.delete(id);
  return skjult;
}

function idsAllInRect(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const v = new THREE.Vector3();
  const planes = renderer.clippingPlanes;
  const skjult = skjulteIder();
  camera.updateMatrixWorld(true);
  const ids = new Set();
  for (const [id, box] of allElementBoxes()) {
    if (skjult.has(id)) continue;
    box.getCenter(v);
    if (v.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue; // bak kameraet
    if (planes.length) {
      let ok = true;
      for (const p of planes) if (p.distanceToPoint(v) < 0 && !box.intersectsPlane(p)) { ok = false; break; }
      if (!ok) continue; // utenfor aktivt snitt/etasjefilter
    }
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (let ci = 0; ci < 8; ci++) {
      v.set(ci & 1 ? box.max.x : box.min.x, ci & 2 ? box.max.y : box.min.y, ci & 4 ? box.max.z : box.min.z);
      v.project(camera);
      const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight;
      if (px < sMinX) sMinX = px; if (px > sMaxX) sMaxX = px;
      if (py < sMinY) sMinY = py; if (py > sMaxY) sMaxY = py;
    }
    if (sMaxX >= minX && sMinX <= maxX && sMaxY >= minY && sMinY <= maxY) ids.add(id);
  }
  return ids;
}

function finishBoxSelect(b) {
  const visibleOnly = b.x1 >= b.x0; // venstre→høyre = kun synlige
  const ids = visibleOnly ? idsVisibleInRect(b.x0, b.y0, b.x1, b.y1) : idsAllInRect(b.x0, b.y0, b.x1, b.y1);
  // siste skanse: skjulte elementer skal aldri kunne markeres, uansett hvilken vei boksen dras
  const skjult = skjulteIder();
  for (const id of skjult) ids.delete(id);
  if (!ids.size) return;
  const q = quantitiesForSet(ids);
  for (const id of ids) S.multiSel.set(id, q.get(id) || { dims: [0, 0, 0], vol: 0 });
  selectElementsSet(new Set(S.multiSel.keys()));
  showMultiSummary();
}

canvas.addEventListener("pointerdown", (e) => {
  if (!e.shiftKey || e.button !== 0 || !S.modelGroup) return;
  e.preventDefault();
  S.boxSel = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!S.boxSel) return;
  S.boxSel.x1 = e.clientX; S.boxSel.y1 = e.clientY;
  boxSelEl.style.display = "block";
  boxSelEl.style.left = Math.min(S.boxSel.x0, S.boxSel.x1) + "px";
  boxSelEl.style.top = Math.min(S.boxSel.y0, S.boxSel.y1) + "px";
  boxSelEl.style.width = Math.abs(S.boxSel.x1 - S.boxSel.x0) + "px";
  boxSelEl.style.height = Math.abs(S.boxSel.y1 - S.boxSel.y0) + "px";
  const crossing = S.boxSel.x1 < S.boxSel.x0;
  boxSelEl.style.borderColor = crossing ? "#3cb44b" : "#8ab4ff";
  boxSelEl.style.background = crossing ? "rgba(60,180,75,.12)" : "rgba(59,130,246,.12)";
});

canvas.addEventListener("pointerup", (e) => {
  if (!S.boxSel) return;
  boxSelEl.style.display = "none";
  const b = S.boxSel; S.boxSel = null;
  if (Math.abs(b.x1 - b.x0) < 8 && Math.abs(b.y1 - b.y0) < 8) shiftClickAt(e.clientX, e.clientY);
  else finishBoxSelect(b);
});
