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

export const SET_KEY = "storm-ifc-settings";
export const APPEAR_KEY = "storm-ifc-utseende";

// ---------- Innstillinger og utseende, lest fra localStorage ----------
S.settings = Object.assign({}, DEFAULT_SETTINGS);
try {
  const raw = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
  S.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
  S.settings.keys = Object.assign({}, DEFAULT_KEYS, raw.keys || {});
} catch(_) {}

S.appear = Object.assign({}, DEFAULT_APPEAR);
try {
  const raw = JSON.parse(localStorage.getItem(APPEAR_KEY) || "{}");
  S.appear = Object.assign({}, DEFAULT_APPEAR, raw);
  S.appear.colors = raw.colors || {};
  S.appear.hiddenTypes = raw.hiddenTypes || [];
} catch(_) {}

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
S.lightMode = localStorage.getItem("storm-ifc-light") === "1";
S.lightLoaded = false;
S.glbActive = false; S.glbProps = null; S.glbColumns = null; S.glbStoreys = null;

// ---------- Verktøy og modus ----------
S.mode = null;            // null | marker | measure | kote
S.measureFirst = null;
S.snapOn = localStorage.getItem("storm-ifc-snap") !== "0";
S.snapPx = parseFloat(localStorage.getItem("storm-ifc-snappx")) || 18;
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
S.axisFontF = parseFloat(localStorage.getItem("storm-ifc-axisfont")) || 1;

// ---------- Minikart ----------
S.miniInfo = null; S.miniBase = null;
S.miniOn = localStorage.getItem("storm-ifc-mini") !== "0";

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
