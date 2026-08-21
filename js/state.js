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
  // Zoomen har alltid hatt en bunn 20 cm fra blikkpunktet. Den er der for at
  // man ikke skal miste modellen, men på en detalj oppleves den som at zoomen
  // låser seg. På = bunnen byttes mot en glidning framover (zoomSteget i
  // scene.js). AV som standard: den som ikke har bedt om det, skal ikke
  // plutselig fly tvers gjennom stålet.
  evigZoom: false,
  // ▣ Kantlinjer: en strek langs kantene på geometrien, så to objekt som ligger
  // inntil hverandre lar seg skille fra hverandre når man ser på detaljer.
  // AV som standard – den koster én tegneoperasjon per element, og den som ikke
  // har bedt om det skal ikke betale for den. Tykkelsen er i SKJERMPIKSLER,
  // ikke i meter, så streken er like tydelig nær som langt unna (js/outline.js).
  outline: false,
  outlineTykkelse: 2,
  unit: "m",          // måleenhet i mål-/kotelapper: "m" eller "mm"
  // Hvilken enhet MODELLEN er tegnet i. "auto" gjetter ut fra hvor stor
  // modellen er, og det er riktig i de aller fleste tilfeller – men gjetningen
  // bommer på små mm-modeller (én prefab-enhet) og på anlegg over en kilometer
  // tegnet i meter. Da settes den for hånd.
  modellEnhet: "auto",   // auto | mm | cm | m | ft
  decimals: 2,        // desimaler i mengder, mål og volum (0–4)
  miniSize: 180,      // minikartets størrelse i piksler
  listLimit: 100,     // hvor mange elementer listene viser før de kortes av (0 = vis alle)
  cubeOn: true,       // 🧊 ViewCube av/på
  cubePos: "th",      // hjørne: tv | th | nv | nh (oppe/nede × venstre/høyre)
  rapCsv: false,      // «Ta med CSV» i rapportmenyen
  rapLogo: "",        // valgt logo (filnavn i SharePoint-mappa Logoer)
  verktoygruppe: "",  // 🧰 valgt gruppe i verktøylinja (mal | info | utseende | bygg)
  // ❓ Hjelpekortene er vist én gang på denne maskinen. Står den false på
  // byggeplass-siden, kommer gjennomgangen av seg selv når modellen er lastet.
  // Montøren trykker aldri på et spørsmålstegn han ikke vet finnes.
  hjelpVist: false,
  keys: Object.assign({}, DEFAULT_KEYS)
};

// outlineTypes: elementtypene som har kantlinjer på. Ligger her og ikke i
// settings fordi den – som hiddenTypes – handler om DENNE modellens typer.
export const DEFAULT_APPEAR = { typeColorsOn: false, ghost: false, colors: {}, hiddenTypes: [], outlineTypes: [] };

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
    lightMode: lsGet("storm-ifc-light") === "1",
    lang: "no"
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
    lightMode: S.lightMode,
    lang: S.lang,
    clips: S.clipStore
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
// EGEN LISTE, ALDRI DEN I DEFAULT_APPEAR. Object.assign kopierer referansen, og
// hadde vi lagt til en type rett i den, ville standardverdien vært endret for
// alltid – samme felle som colors og hiddenTypes står her for å unngå.
S.appear.outlineTypes = (_prefs.appear && _prefs.appear.outlineTypes) || [];

S.bg = _prefs.bg || null;   // valgt bakgrunnsfarge, null = standard

// 📦 Snitt-boks: seks sider som andeler (0–1) av modellens utstrekning
export const DEFAULT_CLIPBOX = { x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1 };

// ---------- Modellen som er åpen ----------
// ALT som hører til den åpne modellen ligger i denne fabrikken, og nullstilles
// SAMLET av nullstillModellState() når en ny modell åpnes (clearModel i ifc.js).
// Nytt felt som gjelder den åpne modellen? Legg det HER – da kan det ikke
// glemmes ved modellbytte. (S.glbStoreys ble i sin tid glemt i den håndskrevne
// lista i clearModel, og etasjene fra forrige .glb hang igjen i neste.)
export function modellStartverdier() {
  return {
    modelID: null,            // IFC-trådens modellnummer
    modelGroup: null,         // three.js-gruppa (clearModel disposer geometrien først)
    koteMatrixInv: null,      // for å regne tilbake til opprinnelige koter
    coordMatrix: null,        // original modell → viewer (brukes av aksesystemet)
    qtyCache: null,
    qtyType: "",              // valgt objekttype i 📊 Mengder ("" = alle typer)
    qtyMat: "",               // valgt materiale: "" | "g:<gruppe>" | "m:<navn>"
    lastLoadInfo: null,
    bufferITråd: false,       // IFC-tråden holder på filbufferen (🪶-omlasting)
    enhetSkala: 1,            // meter per modellenhet – settes av ifc.js etter lasting

    // 💾 lett kopi (.glb)
    glbActive: false, glbProps: null, glbColumns: null, glbStoreys: null,

    // søk, valg og visning
    searchIndex: null, lastQuery: "",
    multiSel: new Map(),
    allBoxCache: null,
    typeInfo: null, typeColorsOn: false,
    ghostOn: false,
    miniInfo: null, miniBase: null,
    // Hvilken etasje minikart-trykk lander deg på. −1 = «Original», altså
    // høyden du står i fra før. Hører til modellen, ikke til brukeren: etasje 2
    // i forrige modell er ikke etasje 2 i den neste.
    miniEtasje: -1,

    // snitt og etasjer (clipAxis og clipT er brukerens valg og beholdes)
    clipOn: false,
    clipMode: "axis",         // "axis" = X/Y/Z, "face" = langs flate, "box" = boks
    clipPickFace: false,
    clipFaceN: null, clipFaceP: null, clipFaceOff: 0, clipFlip: false,
    clipBox: Object.assign({}, DEFAULT_CLIPBOX),
    storeyOn: false, storeyList: null, storeyIdx: -1,

    // aksesystem
    axesOn: false, axesBuilt: false,
    axisSources: null, axisSelection: new Set(),
    axisRaw: null,            // kandidater til akser, hentet fra IFC-tråden

    // markeringer
    comments: [],
    sharedOK: false,

    // 📦 materiell (vareleveranser) plassert i denne modellen
    materiell: [],
    // 🎯 objektgrupper (lagrede flervalg) i denne modellen
    grupper: []
  };
}

// Nullstiller modell-feltene samlet. Kalles av clearModel() i ifc.js.
export function nullstillModellState() {
  Object.assign(S, modellStartverdier());
  // ↩ Angre-stabelen peker på mesh og element-ID-er fra modellen som nettopp
  // ble lukket. Den MÅ tømmes her og ikke i clearModel, ellers glemmes den
  // den dagen noen legger inn en ny vei til modellbytte.
  if (S.nullstillAngre) S.nullstillAngre();
  // ▣ Kantlinjene henger på meshene i modellen som nettopp ble lukket.
  // Geometrien deres er alt frigitt av clearModel; lista over dem må tømmes
  // her, ellers holder den forrige modell i live i minnet.
  if (S.ryddOutline) S.ryddOutline();
  // 📦 Materiell-objektene hører til modellen som ble lukket.
  if (S.ryddMateriell) S.ryddMateriell();
}

Object.assign(S, modellStartverdier());

// Felter rundt selve fila – settes FØR/UNDER lasting og nullstilles derfor
// ikke av clearModel (openLocalFile setter f.eks. S.fileName før loadModel).
S.fileName = "";
S.lastBuffer = null;
S.modelBox = null;
S.modelSize = 10;
S.enhetSkala = 1;   // meter per modellenhet; settes på nytt for hver modell
S.bildeMappeOK = false;   // bilder-mappa i SharePoint er sjekket/opprettet
S.libFane = "full";       // 📚 Biblioteket: "full" (.ifc) eller "lett" (.glb)
S.nyeBilder = [];         // bilder valgt i «Ny markering», før den er lagret

// Elementdata hentet i én runde fra IFC-tråden: id → {name, objectType, tag,
// globalId, typeName}. Lar resten av koden slå opp synkront som før.
// (Tømmes av tømMeta() i ifcrpc.js ved modellbytte.)
S.meta = new Map();
S.workerFeil = null;      // satt hvis IFC-tråden ikke kunne brukes

// ↩ Angre/gjenopprett. Settes av angre.js; null når modulen ikke er lastet, så
// hver innmelding står som «if (S.pushAngre) S.pushAngre(...)».
S.pushAngre = null;
S.nullstillAngre = null;

// ❓ Hjelpekortene. Krokene settes av hjelp.js.
S.rebuildHjelp = null;      // språkbytte: tegn kortet som står oppe på nytt
S.visForsteHjelp = null;    // afterLoad: vis gjennomgangen første gang på byggeplass

// 📦 Materiell. Krokene settes av materiell-vis.js / materiell.js; null når
// modulen ikke er lastet — hvert kall er beskyttet med if (S.x).
S.lastMateriell = null;         // afterLoad: les plasseringene (kontor)
S.settMateriellFraLett = null;  // markers.js: materiell fra Workerens JSON (bygg)
S.ryddMateriell = null;         // modellbytte: tøm gruppa
S.materiellUtseendeRader = null;// display.js: egne rader i 🎨 Utseende
S.materiellModeBar = null;      // modes.js: kontrollinja i materiell-modus
S.etterTegnMateriell = null;    // materiell-vis.js → materiell.js: legg valg-effekten på igjen

// 🎯 Objektgrupper. Krokene settes av grupper.js; null når modulen ikke er lastet.
S.lastGrupper = null;           // ifc.js: les lagrede grupper når modellen åpnes
S.settGrupperFraLett = null;    // markers.js: grupper fra Workerens JSON (bygg)

// ▣ Kantlinjer. Krokene settes av outline.js; null når modulen ikke er lastet.
S.ryddOutline = null;       // modellbytte: tøm lista over linjeobjekt
S.outlineSynlig = null;     // skjul/vis alle linjene (minikartet bruker den)
S.outlineOpplosning = null; // sett tykkelsens referanseoppløsning (rapportbildet)
S.onOutlineFeil = null;     // settes av ui.js: tegn ⚙-menyen på nytt med feilen
S.outlineFeil = false;      // linjemotoren kunne ikke lastes (uten nett første gang)

// Lastemodus: full, 🪶 lav kvalitet og 💾 lett kopi (.glb)
S.lightMode = _prefs.lightMode === true;
S.lightLoaded = false;

// Språk (no | en | pl | lt). Ordboken og t() ligger i i18n.js.
S.lang = typeof _prefs.lang === "string" ? _prefs.lang : "no";

// ---------- Verktøy og modus ----------
S.mode = null;            // null | marker | measure | kote
S.measureFirst = null;
S.snapOn = _prefs.snapOn !== false;
S.snapPx = Number(_prefs.snapPx) || 18;
S._snapPrevT = 0;
S.downPos = null;
S.keyWaitFor = null;

// ---------- Snitt: brukerens valg (beholdes mellom modeller) ----------
S.clipAxis = "y";
S.clipT = 1;

// Navngitte lagrede snitt per modellfil: { "filnavn.ifc": [ {name, …} ] }
S.clipStore = (_prefs.clips && typeof _prefs.clips === "object") ? _prefs.clips : {};

// ---------- Valg og markeringsboks ----------
S.selectedMeshes = [];
S.currentPropID = null;
S.boxSel = null; S._idMat = null;

// ---------- Aksesystem / minikart: brukerens valg ----------
S.axisFontF = Number(_prefs.axisFont) || 1;
S.miniOn = _prefs.miniOn !== false;

// ---------- Markeringer ----------
S.pendingPoint = null;

// ---------- SharePoint ----------
S.msalApp = null; S.spSiteId = null; S.spFiles = null;

// ---------- 🔄 Sammenligning (brukes av compare.js) ----------
S.compareBase = null;     // avtrykk av forrige modell
S.compareOn = false;

// ---------- Felter som andre moduler eier, deklarert her for oversikt ----------
S.scene = null;           // settes av scene.js
S.prefsCloudOK = false;   // settes av usersync.js når skyoppsettet er lest
S.oppsettOK = false;      // settes av oppsett.js når firmaoppsettet er lest

// ---------- Callbacks mellom moduler ----------
// Settes av modulen som eier funksjonen, for å unngå sirkulære importer.
// Alle kall er beskyttet med if (S.x) – en modul som ikke er lastet gir
// stille ingen effekt.
S.onModelLoaded = null;   // compare.js  ← kalles av ifc.js etter lasting
S.onSharedReady = null;   // share.js    ← kalles av ifc.js etter lasting
// onSignedIn KJEDES: både usersync.js og oppsett.js henger seg på, og hver av
// dem tar vare på den forrige. Sett den aldri med rein tilordning.
S.onSignedIn = null;      // usersync.js + oppsett.js ← kalles av sharepoint.js
S.onOppsett = null;       // markers.js  ← kalles av oppsett.js når firmaoppsettet er lest
S.onContextMenu = null;   // ui.js       ← kalles av scene.js ved høyreklikk
S.syncPrefs = null;       // usersync.js ← kalles av alle som lagrer oppsett
S.rememberModel = null;   // recent.js   ← kalles av ifc.js og sharepoint.js
S.markerLink = null;      // share.js    ← kalles av markers.js (Planner-notatet)

// ---------- Delt visningslenke ----------
// Adressen leses her, i den første modulen som kjører, før MSAL får røre hashen.
S.initialHash = (typeof location !== "undefined" && location.hash) || "";
S.sharedView = null;      // tilstanden fra en delt lenke, venter på at modellen åpnes

// ---------- DOM-hjelpere ----------
export const statusEl = document.getElementById("status");
export const loadingEl = document.getElementById("loading");
export const loadingText = document.getElementById("loadingText");
export const $ = (id) => document.getElementById(id);

// Fester en lytter bare hvis elementet finnes.
//
// Hvorfor dette og ikke $("id").addEventListener(...): byggeplassversjonen
// (bygg.html) har ikke alle knappene index.html har. Et kall på modulnivå mot
// en knapp som mangler gir "Cannot read properties of null", og da kaster hele
// modulen ved import – ikke bare den ene knappen. Mister bygg.html
// btnComments, dør altså HELE markeringssystemet.
//
// Husregelen har vært "skjul knapper med CSS, aldri fjern dem". Den gjelder
// fortsatt som praksis, men den skal ikke være det eneste som står mellom oss
// og en død modul.
export function på(id, hendelse, fn, valg) {
  const el = $(id);
  if (el) el.addEventListener(hendelse, fn, valg);
  return el;
}

// ---------- Panelregister ----------
// De ti panelene som skal lukke hverandre. Nye paneler legges KUN til her –
// da lukkes de riktig overalt (knapper og Esc) uten flere kopier av
// lukkelogikken. Før lå denne lista håndskrevet 11 steder, og fem av kopiene
// manglet clipPanel/sharePanel.
export const PANELER = [
  "propPanel", "commentPanel", "qtyPanel", "libPanel", "colorPanel",
  "axesPanel", "searchPanel", "comparePanel", "clipPanel", "sharePanel",
  "materiellPanel", "grupperPanel"
];

// Lukker alle paneler – eventuelt med ett unntak (panelet som skal stå igjen)
export function lukkPaneler(unntak) {
  for (const id of PANELER) {
    if (id === unntak) continue;
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  }
}

// Åpner ett panel og lukker resten – felles vei for alle panelknappene
export function apnePanel(id) {
  lukkPaneler(id);
  const el = document.getElementById(id);
  if (el) el.classList.add("open");
}

// Ikon fra Lucide-spriten i index.html, til dynamisk bygd HTML.
// Eks: ikon("kamera") → <svg class="ikon"><use href="#i-kamera"/></svg>
export function ikon(navn) {
  return '<svg class="ikon" aria-hidden="true"><use href="#i-' + navn + '"/></svg>';
}

// Tåler også tall, null og undefined: en markering fra SharePoint som mangler et
// felt skal ikke kunne velte hele panelet. Escaper også anførselstegn, siden
// esc() brukes inne i HTML-attributter (title="…", value="…", data-id="…") –
// uten det kunne et filnavn med " bryte seg ut av attributtet.
export function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// Antall desimaler brukeren har valgt (⚙ Innstillinger → Visning)
export function dec() {
  const d = Number(S.settings && S.settings.decimals);
  return isFinite(d) ? Math.max(0, Math.min(4, Math.round(d))) : 2;
}

// ---------- Enheter ----------
//
// S.enhetSkala er hvor mange METER én enhet i modellen er. En mm-modell har
// 0.001, en meter-modell 1. Den settes ved lasting (js/ifc.js) og er ÉN
// sannhet – før lå den samme gjetningen skrevet ut fire steder, og de fire
// var ikke enige med hverandre.
//
// tilM() gjør om et tall fra modellens enheter til meter. Den skal brukes på
// alt som kommer rått ut av geometrien: avstander mellom punkter, koter,
// snittposisjoner. Mengdeuttaket regner alt om selv og skal IKKE gjennom den
// en gang til – da blir tallene tusen ganger for små.
export const ENHET_SKALA = { mm: 0.001, cm: 0.01, m: 1, ft: 0.3048 };

export function tilM(v) { return v * (S.enhetSkala || 1); }

// Gjetning ut fra modellens diagonal. Er den over 1000 «enheter», er det nesten
// alltid millimeter – et bygg på 1000 meter finnes knapt.
export function gjettEnhetSkala(modelSize) {
  return modelSize > 1000 ? 0.001 : 1;
}

// Enheten som skal brukes: brukerens valg hvis satt, ellers gjetningen.
export function velgEnhetSkala(modelSize) {
  const valgt = S.settings && S.settings.modellEnhet;
  if (valgt && valgt !== "auto" && ENHET_SKALA[valgt]) return ENHET_SKALA[valgt];
  return gjettEnhetSkala(modelSize);
}

// Lengde i valgt visningsenhet. TAR METER – bruk tilM() først hvis verdien
// kommer rått fra geometrien.
export function fmtLen(m) {
  return S.settings.unit === "mm"
    ? Math.round(m * 1000).toLocaleString("no-NO") + " mm"
    : m.toFixed(dec()) + " m";
}
