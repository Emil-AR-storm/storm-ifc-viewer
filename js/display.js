// Utseende: transparent, skjul/vis og fargelegging per elementtype.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, DEFAULT_APPEAR, på, S, apnePanel, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { clearSelection } from "./elements.js";
import { sikreMeta, typeFor } from "./ifcrpc.js";
import { alleElementIder } from "./ifc.js";
import { saveAppear, saveBg, syncHiddenTypes } from "./prefs.js";
import { scene } from "./scene.js";

// ---------- Transparent (ghost) ----------

const ghostCache = new Map();

// Det gjennomsiktige materialet for et mesh, laget én gang per originalmateriale.
// Skilt ut så settVisning() kan bruke nøyaktig samme materiale som setGhost().
function ghostMat(m) {
  if (!ghostCache.has(m.userData.origMat)) {
    const g = m.userData.origMat.clone();
    g.transparent = true; g.opacity = 0.25; g.depthWrite = false;
    ghostCache.set(m.userData.origMat, g);
  }
  return ghostCache.get(m.userData.origMat);
}

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
    m.material = S.ghostOn ? ghostMat(m) : m.userData.origMat;
  });
}

på("btnGhost", "click", () => {
  const før = visningsAvtrykk();
  setGhost(!S.ghostOn);
  meldAngre(før, S.ghostOn ? "Gjennomsiktig på" : "Gjennomsiktig av");
});

// ---------- Skjul / vis ----------
export const hiddenIDs = new Set();

// Skjuler et helt sett i ÉN gjennomgang av meshene. Å kalle hideElement per
// element ville gått gjennom hele modellen én gang per id – med noen hundre
// markerte elementer i en modell på tusenvis blir det merkbart tregt.
export function hideElements(ider) {
  const sett = ider instanceof Set ? ider : new Set(ider);
  if (!sett.size || !S.modelGroup) return;
  // Bare de som faktisk BLIR skjult av dette kallet skal vises igjen ved angre.
  // Var noen skjult fra før, skal de forbli skjult.
  const nye = [...sett].filter(id => !hiddenIDs.has(id));
  sett.forEach(id => hiddenIDs.add(id));
  S.modelGroup.children.forEach(m => { if (sett.has(m.userData.expressID)) m.visible = false; });
  clearSelection();   // tømmer også S.multiSel – de skjulte skal ikke bli liggende i utvalget
  $("propPanel").classList.remove("open");
  $("btnShowAll").style.display = "";
  if (nye.length && S.pushAngre) S.pushAngre({
    tekst: nye.length === 1 ? "Skjul element" : "Skjul flere element",
    angre: () => showElements(nye),
    gjenopprett: () => hideElements(nye)
  });
}

export function hideElement(expressID) { hideElements([expressID]); }

// Motstykket til hideElements – brukes av ↩ Angre. Et element skal bare bli
// synlig igjen hvis TYPEN det hører til ikke er skjult i 🎨 Utseende; ellers
// ville angre av «Skjul element» også slått på en type brukeren har skjult.
export function showElements(ider) {
  const sett = ider instanceof Set ? ider : new Set(ider);
  if (!sett.size) return;
  sett.forEach(id => hiddenIDs.delete(id));
  const typeSkjult = new Set();
  if (S.typeInfo) for (const [, g] of S.typeInfo) if (g.hidden) g.meshes.forEach(m => typeSkjult.add(m));
  if (S.modelGroup) S.modelGroup.children.forEach(m => {
    if (sett.has(m.userData.expressID)) m.visible = !typeSkjult.has(m);
  });
  oppdaterVisAlle();
  if ($("colorPanel").classList.contains("open") && S.typeInfo) renderColorPanel();
}

// «Vis alle» skal stå framme så lenge NOE er skjult – enkeltelement eller type.
// Lå før som en kopiert enlinjes tre steder, og de tre var ikke like.
export function oppdaterVisAlle() {
  const noeSkjult = hiddenIDs.size > 0 ||
    (S.typeInfo ? [...S.typeInfo.values()].some(g => g.hidden) : false);
  $("btnShowAll").style.display = noeSkjult ? "" : "none";
}

på("btnShowAll", "click", () => {
  // Avtrykk FØR: «Vis alle» kan gjøre om en hel dags skjuling på ett klikk
  const før = visningsAvtrykk();
  hiddenIDs.clear();
  if (S.typeInfo) for (const [, g] of S.typeInfo) g.hidden = false;
  S.appear.hiddenTypes = []; saveAppear();
  if (S.modelGroup) S.modelGroup.children.forEach(m => m.visible = true);
  $("btnShowAll").style.display = "none";
  if ($("colorPanel").classList.contains("open")) renderColorPanel();
  meldAngre(før, "Vis alle");
});

// ---------- ↩ Avtrykk av visningen (til angre/gjenopprett) ----------
// Dekker skjuling, typefarger, gjennomsiktig og bakgrunn – alt som «Originalfarger»
// nullstiller på ett klikk. Kun verdier, aldri objektreferanser: S.typeInfo
// bygges på nytt ved modellbytte.
export function visningsAvtrykk() {
  return {
    skjulteIder: [...hiddenIDs],
    skjulteTyper: S.typeInfo ? [...S.typeInfo].filter(([, g]) => g.hidden).map(([k]) => k) : [],
    farger: S.typeInfo ? Object.fromEntries([...S.typeInfo].map(([k, g]) => [k, g.color])) : {},
    typeColorsOn: S.typeColorsOn,
    ghostOn: S.ghostOn,
    bg: "#" + scene.background.getHexString()
  };
}

export function settVisning(a) {
  if (!a) return;
  scene.background.set(a.bg);
  saveBg(a.bg);
  if (S.typeInfo) {
    const skjult = new Set(a.skjulteTyper);
    for (const [key, g] of S.typeInfo) {
      g.hidden = skjult.has(key);
      if (a.farger[key]) { g.color = a.farger[key]; g.mat.color.set(a.farger[key]); }
    }
    S.appear.colors = Object.assign({}, a.farger);
  }
  hiddenIDs.clear();
  a.skjulteIder.forEach(id => hiddenIDs.add(id));

  // Materialene settes i én gjennomgang: ghost > typefarger > original.
  // Rekkefølgen er den samme som setGhost/applyTypeColors bruker hver for seg.
  S.typeColorsOn = a.typeColorsOn && !a.ghostOn;
  S.ghostOn = a.ghostOn;
  $("btnGhost").classList.toggle("active", S.ghostOn);
  if (S.modelGroup) {
    const typeAv = new Map();
    if (S.typeInfo) for (const [, g] of S.typeInfo) g.meshes.forEach(m => typeAv.set(m, g));
    S.modelGroup.children.forEach(m => {
      const g = typeAv.get(m);
      m.material = S.ghostOn ? ghostMat(m) : (S.typeColorsOn && g ? g.mat : m.userData.origMat);
      m.visible = !hiddenIDs.has(m.userData.expressID) && !(g && g.hidden);
    });
  }
  S.appear.ghost = S.ghostOn;
  S.appear.typeColorsOn = S.typeColorsOn;
  syncHiddenTypes();
  saveAppear();
  oppdaterVisAlle();
  if ($("colorPanel").classList.contains("open") && S.typeInfo) renderColorPanel();
}

// Melder en visningsendring til angre-stabelen. Avtrykket ETTER tas her, så
// kallstedet bare trenger å ta vare på avtrykket FØR.
function meldAngre(før, tekst) {
  if (!S.pushAngre) return;
  const etter = visningsAvtrykk();
  S.pushAngre({ tekst, angre: () => settVisning(før), gjenopprett: () => settVisning(etter) });
}

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
      const tp = typeFor(id) || "UKJENT";
      idType.set(id, tp.toUpperCase().replace(/^IFC/, ""));
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
  // Den mest destruktive knappen i verktøyet: sletter farger, skjuling,
  // gjennomsiktig og bakgrunn på ett klikk. Avtrykk før noe som helst røres.
  const før = visningsAvtrykk();
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
  meldAngre(før, "Originalfarger");
}

på("btnColors", "click", async () => {
  if (!S.modelGroup) return;
  const panel = $("colorPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (S.lightLoaded) {
    const bgVal = "#" + scene.background.getHexString();
    $("colorBody").innerHTML =
      '<div class="qty-row"><div class="n">' + t("Bakgrunn") + '</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>' +
      '<p style="color:var(--muted); font-size:11px; margin-top:10px">' + t("Fargelegging og skjuling per type er ikke tilgjengelig i lav kvalitet. Last modellen i full kvalitet for å bruke det.") + '</p>';
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
    '<button id="colApply" class="primary">' + ikon("utseende") + ' ' + t("Fargelegg etter type") + '</button>' +
    '<button id="colReset">' + t("Originalfarger") + '</button></div>' +
    '<div class="qty-row"><div class="n">' + t("Bakgrunn") + '</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>';
  const keys = [...S.typeInfo.keys()];
  keys.forEach((key, i) => {
    const g = S.typeInfo.get(key);
    html += '<div class="qty-row"><div class="n">' + esc(t(g.label)) +
      ' <span style="color:var(--muted);font-size:11px">(' + g.meshes.length + ')</span></div>' +
      '<div class="c" style="display:flex; align-items:center; gap:8px">' +
      '<button data-hide="' + i + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(g.hidden ? "skjul" : "vis") + '</button>' +
      '<input type="color" data-type="' + i + '" value="' + g.color + '"></div></div>';
  });
  $("colorBody").innerHTML = html;
  // Fargevelgere fyrer oninput per piksel man drar. Ett avtrykk tas ved
  // pointerdown/focus og meldes inn på change – ellers ville én dragbevegelse
  // fylt hele angre-stabelen med mellomtrinn.
  let dragFør = null;
  const startDrag = () => { if (!dragFør) dragFør = visningsAvtrykk(); };

  $("colBg").oninput = (e) => { scene.background.set(e.target.value); saveBg(e.target.value); };
  $("colBg").onpointerdown = startDrag;
  $("colBg").onchange = () => { if (dragFør) { meldAngre(dragFør, "Bakgrunnsfarge"); dragFør = null; } };
  $("colApply").onclick = () => {
    const før = visningsAvtrykk();
    applyTypeColors();
    meldAngre(før, "Fargelegg etter type");
  };
  $("colReset").onclick = resetColors;
  $("colorBody").querySelectorAll("input[data-type]").forEach(inp => {
    inp.onpointerdown = startDrag;
    inp.onfocus = startDrag;          // tastaturbruk åpner velgeren uten pointerdown
    inp.oninput = (e) => {
      const key = keys[Number(e.target.dataset.type)];
      const g = S.typeInfo.get(key);
      g.color = e.target.value;
      g.mat.color.set(e.target.value);
      S.appear.colors[key] = e.target.value;
      saveAppear();
      if (!S.typeColorsOn) applyTypeColors();
    };
    inp.onchange = () => { if (dragFør) { meldAngre(dragFør, "Farge på elementtype"); dragFør = null; } };
  });
  $("colorBody").querySelectorAll("button[data-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const før = visningsAvtrykk();
      const g = S.typeInfo.get(keys[Number(e.currentTarget.dataset.hide)]);
      g.hidden = !g.hidden;
      g.meshes.forEach(m => m.visible = !g.hidden && !hiddenIDs.has(m.userData.expressID));
      e.currentTarget.innerHTML = ikon(g.hidden ? "skjul" : "vis");
      syncHiddenTypes();
      oppdaterVisAlle();
      meldAngre(før, g.hidden ? "Skjul elementtype" : "Vis elementtype");
    };
  });
}
