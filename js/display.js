// Utseende: transparent, skjul/vis og fargelegging per elementtype.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, DEFAULT_APPEAR, S, apnePanel, esc, ikon } from "./state.js";
import { clearSelection } from "./elements.js";
import { sikreMeta, typeFor } from "./ifcrpc.js";
import { alleElementIder } from "./ifc.js";
import { saveAppear, saveBg, syncHiddenTypes } from "./prefs.js";
import { scene } from "./scene.js";

// ---------- Transparent (ghost) ----------

const ghostCache = new Map();

// silent = ikke lagre i brukerens eget oppsett (brukes av delte visningslenker)
export function setGhost(on, silent) {
  if (!S.modelGroup) return;
  clearSelection();
  $("propPanel").classList.remove("open");
  S.ghostOn = on;
  $("btnGhost").classList.toggle("active", S.ghostOn);
  // transparent overtar materialene, så fargelegging per type er ikke lenger på.
  // Uten dette ble S.typeColorsOn hengende igjen som «true» og lurte bl.a. ⛓-lenka.
  if (S.ghostOn) S.typeColorsOn = false;
  if (!silent) {
    S.appear.ghost = S.ghostOn;
    if (S.ghostOn) S.appear.typeColorsOn = false;
    saveAppear();
  }
  S.modelGroup.children.forEach(m => {
    if (S.ghostOn) {
      if (!ghostCache.has(m.userData.origMat)) {
        const g = m.userData.origMat.clone();
        g.transparent = true; g.opacity = 0.25; g.depthWrite = false;
        ghostCache.set(m.userData.origMat, g);
      }
      m.material = ghostCache.get(m.userData.origMat);
    } else {
      m.material = m.userData.origMat;
    }
  });
}

$("btnGhost").addEventListener("click", () => setGhost(!S.ghostOn));

// ---------- Skjul / vis ----------
export const hiddenIDs = new Set();

export function hideElement(expressID) {
  hiddenIDs.add(expressID);
  S.modelGroup.children.forEach(m => { if (m.userData.expressID === expressID) m.visible = false; });
  clearSelection();
  $("propPanel").classList.remove("open");
  $("btnShowAll").style.display = "";
}

$("btnShowAll").addEventListener("click", () => {
  hiddenIDs.clear();
  if (S.typeInfo) for (const [, g] of S.typeInfo) g.hidden = false;
  S.appear.hiddenTypes = []; saveAppear();
  if (S.modelGroup) S.modelGroup.children.forEach(m => m.visible = true);
  $("btnShowAll").style.display = "none";
  if ($("colorPanel").classList.contains("open")) renderColorPanel();
});

// ---------- Fargeinnstillinger (per elementtype) ----------
export const DEFAULT_BG = "#14181f";

const TYPE_LABELS = {
  COLUMN: "Søyler", BEAM: "Bjelker", SLAB: "Dekker", WALL: "Vegger",
  WALLSTANDARDCASE: "Vegger", MEMBER: "Stag/sperrer", PLATE: "Plater",
  DOOR: "Dører", WINDOW: "Vinduer", ROOF: "Tak", STAIR: "Trapper",
  STAIRFLIGHT: "Trappeløp", RAILING: "Rekkverk", FOOTING: "Fundamenter",
  PILE: "Peler", COVERING: "Kledning", CURTAINWALL: "Glassfasader",
  MECHANICALFASTENER: "Festemidler", FASTENER: "Festemidler",
  FLOWSEGMENT: "Rør/kanaler", BUILDINGELEMENTPROXY: "Annet"
};

const PALETTE = ["#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4",
  "#46f0f0","#f032e6","#bcf60c","#008080","#e6beff","#9a6324","#fffac8",
  "#800000","#aaffc3","#ffd8b1"];

export function buildTypeInfo() {
  S.typeInfo = new Map();
  const idType = new Map();
  S.modelGroup.children.forEach(m => {
    const id = m.userData.expressID;
    if (!idType.has(id)) {
      const t = typeFor(id) || "UKJENT";
      idType.set(id, t.toUpperCase().replace(/^IFC/, ""));
    }
    const key = idType.get(id);
    if (!S.typeInfo.has(key)) {
      const color = S.appear.colors[key] || PALETTE[S.typeInfo.size % PALETTE.length];
      S.typeInfo.set(key, {
        label: TYPE_LABELS[key] || key,
        meshes: [],
        color,
        hidden: S.appear.hiddenTypes.includes(key),
        mat: new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
      });
    }
    S.typeInfo.get(key).meshes.push(m);
  });
}

export function applyTypeColors(silent) {
  clearSelection();
  $("propPanel").classList.remove("open");
  S.ghostOn = false;
  $("btnGhost").classList.remove("active");
  S.typeColorsOn = true;
  for (const [, g] of S.typeInfo) g.meshes.forEach(m => m.material = g.mat);
  if (!silent) {
    S.appear.typeColorsOn = true;
    S.appear.ghost = false;
    saveAppear();
  }
}

export function resetColors() {
  scene.background.set(DEFAULT_BG);
  saveBg(DEFAULT_BG);
  S.typeColorsOn = false;
  S.ghostOn = false;
  $("btnGhost").classList.remove("active");
  if (S.modelGroup) {
    clearSelection();
    S.modelGroup.children.forEach(m => { m.material = m.userData.origMat; m.visible = true; });
  }
  hiddenIDs.clear();
  if (S.typeInfo) for (const [, g] of S.typeInfo) g.hidden = false;
  $("btnShowAll").style.display = "none";
  S.appear = Object.assign({}, DEFAULT_APPEAR, { colors: {}, hiddenTypes: [] });
  saveAppear();
  renderColorPanel();
}

$("btnColors").addEventListener("click", async () => {
  if (!S.modelGroup) return;
  const panel = $("colorPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (S.lightLoaded) {
    const bgVal = "#" + scene.background.getHexString();
    $("colorBody").innerHTML =
      '<div class="qty-row"><div class="n">Bakgrunn</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>' +
      '<p style="color:var(--muted); font-size:11px; margin-top:10px">Fargelegging og skjuling per type er ikke tilgjengelig i lav kvalitet. Last modellen i full kvalitet for å bruke det.</p>';
    $("colBg").oninput = (e) => { scene.background.set(e.target.value); saveBg(e.target.value); };
  } else {
    if (!S.typeInfo) { await sikreMeta(alleElementIder); buildTypeInfo(); }
    renderColorPanel();
  }
  apnePanel("colorPanel");
});

function renderColorPanel() {
  const bgVal = "#" + scene.background.getHexString();
  let html =
    '<div class="prop-actions">' +
    '<button id="colApply" class="primary">' + ikon("utseende") + ' Fargelegg etter type</button>' +
    '<button id="colReset">Originalfarger</button></div>' +
    '<div class="qty-row"><div class="n">Bakgrunn</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>';
  const keys = [...S.typeInfo.keys()];
  keys.forEach((key, i) => {
    const g = S.typeInfo.get(key);
    html += '<div class="qty-row"><div class="n">' + esc(g.label) +
      ' <span style="color:var(--muted);font-size:11px">(' + g.meshes.length + ')</span></div>' +
      '<div class="c" style="display:flex; align-items:center; gap:8px">' +
      '<button data-hide="' + i + '" title="Skjul/vis" style="padding:3px 8px">' + ikon(g.hidden ? "skjul" : "vis") + '</button>' +
      '<input type="color" data-type="' + i + '" value="' + g.color + '"></div></div>';
  });
  $("colorBody").innerHTML = html;
  $("colBg").oninput = (e) => { scene.background.set(e.target.value); saveBg(e.target.value); };
  $("colApply").onclick = () => applyTypeColors();
  $("colReset").onclick = resetColors;
  $("colorBody").querySelectorAll("input[data-type]").forEach(inp => {
    inp.oninput = (e) => {
      const key = keys[Number(e.target.dataset.type)];
      const g = S.typeInfo.get(key);
      g.color = e.target.value;
      g.mat.color.set(e.target.value);
      S.appear.colors[key] = e.target.value;
      saveAppear();
      if (!S.typeColorsOn) applyTypeColors();
    };
  });
  $("colorBody").querySelectorAll("button[data-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const g = S.typeInfo.get(keys[Number(e.currentTarget.dataset.hide)]);
      g.hidden = !g.hidden;
      g.meshes.forEach(m => m.visible = !g.hidden && !hiddenIDs.has(m.userData.expressID));
      e.currentTarget.innerHTML = ikon(g.hidden ? "skjul" : "vis");
      syncHiddenTypes();
      const anyHidden = hiddenIDs.size > 0 || [...S.typeInfo.values()].some(t => t.hidden);
      $("btnShowAll").style.display = anyHidden ? "" : "none";
    };
  });
}
