// Innstillinger og utseende som huskes mellom økter.
import { $, S } from "./state.js";
import { applyTypeColors, buildTypeInfo } from "./display.js";

// ---------- ⚙ Innstillinger (lagres i localStorage) ----------
const SET_KEY = "storm-ifc-settings";

export const DEFAULT_KEYS = {
  marker: "P", measure: "M", kote: "K", axes: "A", clip: "S",
  storey: "E", search: "F", ghost: "T", qty: "D", fit: "G", settings: "I"
};

export const DEFAULT_SETTINGS = {
  rotSpeed: 1,        // rotasjonshastighet (1 = som før)
  zoomSpeed: 1,       // zoomhastighet
  invertZoom: false,  // snu rullehjulets retning
  unit: "m",          // måleenhet i mål-/kotelapper: "m" eller "mm"
  miniSize: 180,      // minikartets størrelse i piksler
  keys: Object.assign({}, DEFAULT_KEYS)
};

S.settings = Object.assign({}, DEFAULT_SETTINGS);

try {
  const raw = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
  S.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
  S.settings.keys = Object.assign({}, DEFAULT_KEYS, raw.keys || {});
} catch(_) {}

export function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(S.settings)); } catch(_) {}
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

// ---------- Lagret utseende (huskes mellom økter) ----------
// Fargelegging, egendefinerte typefarger, skjulte typer, transparent og bakgrunn
// legges i localStorage og legges automatisk på når en modell åpnes.
const APPEAR_KEY = "storm-ifc-utseende";

export const DEFAULT_APPEAR = { typeColorsOn: false, ghost: false, colors: {}, hiddenTypes: [] };

S.appear = Object.assign({}, DEFAULT_APPEAR);

try {
  const raw = JSON.parse(localStorage.getItem(APPEAR_KEY) || "{}");
  S.appear = Object.assign({}, DEFAULT_APPEAR, raw);
  S.appear.colors = raw.colors || {};
  S.appear.hiddenTypes = raw.hiddenTypes || [];
} catch(_) {}

export function saveAppear() {
  try { localStorage.setItem(APPEAR_KEY, JSON.stringify(S.appear)); } catch(_) {}
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

export function saveBg(hex) {
  try { localStorage.setItem("storm-ifc-bg", hex); } catch(_) {}
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

// Skriver dagens skjulte typer tilbake til lageret
export function syncHiddenTypes() {
  if (!S.typeInfo) return;
  S.appear.hiddenTypes = [...S.typeInfo.entries()].filter(([, g]) => g.hidden).map(([k]) => k);
  saveAppear();
}

// Legger på lagret utseende etter at en modell er åpnet
export function restoreAppearance() {
  if (!S.modelGroup || S.lightLoaded || S.glbActive || S.modelID === null) return;
  const hasSaved = S.appear.typeColorsOn || S.appear.ghost ||
    S.appear.hiddenTypes.length || Object.keys(S.appear.colors).length;
  if (!hasSaved) return;
  try {
    if (!S.typeInfo) buildTypeInfo();
    if (S.appear.typeColorsOn) applyTypeColors(true);
    if (S.appear.hiddenTypes.length) {
      let any = false;
      for (const [k, g] of S.typeInfo) {
        g.hidden = S.appear.hiddenTypes.includes(k);
        if (g.hidden) any = true;
        g.meshes.forEach(m => m.visible = !g.hidden);
      }
      if (any) $("btnShowAll").style.display = "";
    }
    if (S.appear.ghost && !S.appear.typeColorsOn) $("btnGhost").click();
  } catch(err) { console.warn("Klarte ikke å gjenopprette utseende:", err); }
}
