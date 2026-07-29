// Delt tilstand og små hjelpere. Alt som flere moduler endrer, ligger i S.
//
// VIKTIG: hele starttilstanden settes opp her, i modulen som lastes først og
// ikke er avhengig av noe annet. Da kan enhver modul lese S ved oppstart uten
// å måtte vite i hvilken rekkefølge modulene lastes.

export const S = {};

// ---------- Standardverdier for innstillinger ----------
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

export const DEFAULT_APPEAR = { typeColorsOn: false, ghost: false, colors: {}, hiddenTypes: [] };

// ---------- Alt oppsett i én versjonert nøkkel ----------
// Før lå dette spredt på åtte storm-ifc-*-nøkler. Nå ligger alt i storm-ifc-prefs.
// Gamle nøkler leses én gang ved oppstart og slettes deretter.
export const PREFS_KEY = "storm-ifc-prefs";
export const PREFS_VERSION = 2;

const LEGACY_KEYS = [
  "storm-ifc-settings", "storm-ifc-utseende", "storm-ifc-light", "storm-ifc-snap",
  "storm-ifc-snappx", "storm-ifc-axisfont", "storm-ifc-mini", "storm-ifc-bg",
  "storm-ifc-prefs-updated"
];

function lsGet(k) { try { return localStorage.getItem(k); } catch(_) { return null; } }
function lsJson(k) { try { return JSON.parse(lsGet(k) || "null"); } catch(_) { return null; } }

function readPrefs() {
  const p = lsJson(PREFS_KEY);
  if (p && typeof p === "object") return p;

  // Migrasjon fra de gamle nøklene (samme standardverdier som før)
  const mig = {
    v: PREFS_VERSION,
    updated: lsGet("storm-ifc-prefs-updated") || "",
    settings: lsJson("storm-ifc-settings") || {},
    appear: lsJson("storm-ifc-utseende") || {},
    bg: lsGet("storm-ifc-bg") || null,
    axisFont: parseFloat(lsGet("storm-ifc-axisfont")) || 1,
    snapOn: lsGet("storm-ifc-snap") !== "0",
    snapPx: parseFloat(lsGet("storm-ifc-snappx")) || 18,
    miniOn: lsGet("storm-ifc-mini") !== "0",
    lightMode: lsGet("storm-ifc-light") === "1"
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(mig));
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
  } catch(_) {}
  return mig;
}

const _prefs = readPrefs();

// Alt som skal følge brukeren, samlet i ett objekt
export function collectPrefs() {
  return {
    v: PREFS_VERSION,
    updated: S.prefsUpdated || "",
    settings: S.settings,
    appear: S.appear,
    bg: S.bg || null,
    axisFont: S.axisFontF,
    snapOn: S.snapOn,
    snapPx: S.snapPx,
    miniOn: S.miniOn,
    lightMode: S.lightMode
  };
}

// Skriver hele oppsettet. Kalles av alle som endrer noe lagret.
export function writePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(collectPrefs())); } catch(_) {}
}

S.prefsUpdated = _prefs.updated || "";

// ---------- Innstillinger og utseende ----------
S.settings = Object.assign({}, DEFAULT_SETTINGS, _prefs.settings || {});
S.settings.keys = Object.assign({}, DEFAULT_KEYS, (_prefs.settings && _prefs.settings.keys) || {});

S.appear = Object.assign({}, DEFAULT_APPEAR, _prefs.appear || {});
S.appear.colors = (_prefs.appear && _prefs.appear.colors) || {};
S.appear.hiddenTypes = (_prefs.appear && _prefs.appear.hiddenTypes) || [];

S.bg = _prefs.bg || null;   // valgt bakgrunnsfarge, null = standard

// ---------- Modellen som er åpen ----------
S.modelID = null;
S.modelGroup = null;
S.fileName = "";
S.lastBuffer = null;
S.modelBox = null;
S.modelSize = 10;
S.koteMatrixInv = null;   // for å regne tilbake til opprinnelige koter
S.coordMatrix = null;     // original modell → viewer (brukes av aksesystemet)
S.qtyCache = null;
S.lastLoadInfo = null;

// Lastemodus: full, 🪶 lav kvalitet og 💾 lett kopi (.glb)
S.lightMode = _prefs.lightMode === true;
S.lightLoaded = false;
S.glbActive = false; S.glbProps = null; S.glbColumns = null; S.glbStoreys = null;

// ---------- Verktøy og modus ----------
S.mode = null;            // null | marker | measure | kote
S.measureFirst = null;
S.snapOn = _prefs.snapOn !== false;
S.snapPx = Number(_prefs.snapPx) || 18;
S._snapPrevT = 0;
S.downPos = null;
S.keyWaitFor = null;

// ---------- Snitt og etasjefilter ----------
S.clipOn = false;
S.clipAxis = "y";
S.clipFlip = false;
S.clipT = 1;
S.clipMode = "axis";      // "axis" = X/Y/Z, "face" = langs markert flate
S.clipPickFace = false;
S.clipFaceN = null;
S.clipFaceP = null;
S.clipFaceOff = 0;
S.storeyOn = false; S.storeyList = null; S.storeyIdx = -1;

// ---------- Valg og markeringsboks ----------
S.selectedMeshes = [];
S.currentPropID = null;
S.multiSel = new Map();
S.boxSel = null; S._idMat = null;
S.allBoxCache = null;
S.searchIndex = null; S.lastQuery = "";

// ---------- Utseende ----------
S.ghostOn = false;
S.typeInfo = null;
S.typeColorsOn = false;

// ---------- Aksesystem ----------
S.axesOn = false; S.axesBuilt = false;
S.axisSources = null;
S.axisSelection = new Set();
S.axisFontF = Number(_prefs.axisFont) || 1;

// ---------- Minikart ----------
S.miniInfo = null; S.miniBase = null;
S.miniOn = _prefs.miniOn !== false;

// ---------- Markeringer ----------
S.comments = [];
S.pendingPoint = null;
S.sharedOK = false;

// ---------- SharePoint ----------
S.msalApp = null; S.spSiteId = null; S.spFiles = null;

// ---------- DOM-hjelpere ----------
export const statusEl = document.getElementById("status");
export const loadingEl = document.getElementById("loading");
export const loadingText = document.getElementById("loadingText");
export const $ = (id) => document.getElementById(id);

export function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// Lengde i valgt enhet (m eller mm)
export function fmtLen(m) {
  return S.settings.unit === "mm" ? Math.round(m * 1000).toLocaleString("no-NO") + " mm" : m.toFixed(2) + " m";
}
