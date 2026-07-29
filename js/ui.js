// ⚙ Innstillingsmeny og hurtigtaster.
import { $, DEFAULT_APPEAR, DEFAULT_KEYS, DEFAULT_SETTINGS, S, esc, writePrefs } from "./state.js";
import { applyAxisFont } from "./axes.js";
import { showClipBar, stopFacePick } from "./clip.js";
import { DEFAULT_BG, resetColors } from "./display.js";
import { refreshNumbers } from "./elements.js";
import { applyMiniSize, setMini } from "./minimap.js";
import { lagRaskKopiNå } from "./lite.js";
import { setMode } from "./modes.js";
import { saveAppear, saveBg, saveSettings } from "./prefs.js";
import { scene } from "./scene.js";

// ---------- ⚙ Innstillingsmeny + hurtigtaster ----------
// Åpnes med høyreklikk i modellen eller ⚙-knappen i verktøylinja.
const ACTIONS = {
  marker:   { label: "📌 Markering",  run: () => $("btnMarker").click() },
  measure:  { label: "📏 Mål",        run: () => $("btnMeasure").click() },
  kote:     { label: "⛰ Kote",        run: () => $("btnKote").click() },
  axes:     { label: "🔠 Akser",      run: () => $("btnAxes").click() },
  clip:     { label: "✂️ Snitt",      run: () => $("btnClip").click() },
  storey:   { label: "🏢 Etasjer",    run: () => $("btnStorey").click() },
  search:   { label: "🔎 Søk",        run: () => $("btnSearch").click() },
  ghost:    { label: "👻 Transparent",run: () => $("btnGhost").click() },
  qty:      { label: "📊 Mengder",    run: () => $("btnQty").click() },
  fit:      { label: "🎯 Vis alt",    run: () => $("btnFit").click() },
  settings: { label: "⚙ Innstillinger", run: () => openSettings() }
};

function openSettings(x, y) {
  const menu = $("setMenu");
  renderSettings();
  menu.classList.add("open");
  const w = menu.offsetWidth || 320, h = menu.offsetHeight || 420;
  const left = (x == null) ? Math.max(8, innerWidth - w - 14) : Math.min(Math.max(8, x), innerWidth - w - 8);
  const top  = (y == null) ? 100 : Math.min(Math.max(56, y), Math.max(56, innerHeight - h - 8));
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeSettings() {
  $("setMenu").classList.remove("open");
  S.keyWaitFor = null;
}

$("btnSettings").addEventListener("click", () => {
  const menu = $("setMenu");
  if (menu.classList.contains("open")) closeSettings(); else openSettings();
});

// klikk utenfor lukker menyen
document.addEventListener("pointerdown", (e) => {
  const menu = $("setMenu");
  if (!menu.classList.contains("open")) return;
  if (menu.contains(e.target) || e.target.id === "btnSettings") return;
  if (e.button === 2) return; // høyreklikk flytter menyen i stedet (contextmenu-håndtereren)
  closeSettings();
}, true);

function keyLabel(k) {
  if (!k) return "–";
  if (k === " ") return "Mellomrom";
  if (k === "Escape") return "Esc";
  return k.length === 1 ? k.toUpperCase() : k;
}

// Forteller om oppsettet følger brukeren (SharePoint) eller bare denne nettleseren
function syncStatusText() {
  const acc = S.msalApp && S.msalApp.getActiveAccount();
  if (!acc) return '<span style="color:var(--muted)">🖥 Lagres bare i denne nettleseren. Logg inn via 📚 Bibliotek for at oppsettet skal følge deg på alle maskiner.</span>';
  if (S.prefsCloudOK) return '<span style="color:#3cb44b">☁ Følger kontoen din (' + esc(acc.username || "") + ')</span>';
  return '<span style="color:var(--accent2)">☁ Prøver å lagre til SharePoint …</span>';
}

function renderSettings() {
  const bgVal = "#" + scene.background.getHexString();
  let html = "";
  html += '<h4>Kamera</h4>' +
    '<div class="set-row"><span class="n">Rotasjonshastighet</span>' +
    '<input type="range" id="stRot" min="0.3" max="3" step="0.1" value="' + S.settings.rotSpeed + '"></div>' +
    '<div class="set-row"><span class="n">Zoomhastighet</span>' +
    '<input type="range" id="stZoom" min="0.3" max="3" step="0.1" value="' + S.settings.zoomSpeed + '"></div>' +
    '<div class="set-row"><span class="n">Invertér zoom</span>' +
    '<input type="checkbox" id="stInv"' + (S.settings.invertZoom ? " checked" : "") + '></div>';

  html += '<h4>Visning</h4>' +
    '<div class="set-row"><span class="n">Måleenhet</span>' +
    '<select id="stUnit"><option value="m"' + (S.settings.unit === "m" ? " selected" : "") + '>Meter (m)</option>' +
    '<option value="mm"' + (S.settings.unit === "mm" ? " selected" : "") + '>Millimeter (mm)</option></select></div>' +
    '<div class="set-row"><span class="n">Desimaler i mål og mengder</span>' +
    '<select id="stDec">' + [0, 1, 2, 3, 4].map(d =>
      '<option value="' + d + '"' + (S.settings.decimals === d ? " selected" : "") + '>' + d +
      (d === 0 ? " (hele meter)" : d === 3 ? " (mm)" : "") + '</option>').join("") + '</select></div>' +
    '<div class="set-row"><span class="n">Bakgrunnsfarge</span>' +
    '<input type="color" id="stBg" value="' + bgVal + '"></div>' +
    '<div class="set-row"><span class="n">⚡ Lag rask kopi automatisk</span>' +
    '<input type="checkbox" id="stAutoLite"' + (S.settings.autoLite ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">🪶 Lav kvalitet</span>' +
    '<input type="checkbox" id="stLight"' + (S.lightMode ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">Skriftstørrelse akser</span>' +
    '<input type="range" id="stAxFont" min="40" max="250" step="10" value="' + Math.round(S.axisFontF * 100) + '"></div>';

  html += '<h4>🗺 Minikart</h4>' +
    '<div class="set-row"><span class="n">Vis minikart</span>' +
    '<input type="checkbox" id="stMini"' + (S.miniOn ? " checked" : "") + '></div>' +
    '<div class="set-row"><span class="n">Størrelse <span id="stMiniV" style="color:var(--muted)">' +
    Math.round(S.settings.miniSize) + ' px</span></span>' +
    '<input type="range" id="stMiniSz" min="100" max="400" step="10" value="' + S.settings.miniSize + '"></div>';

  html += '<h4>Hurtigtaster</h4>';
  for (const k in ACTIONS) {
    html += '<div class="set-row"><span class="n">' + ACTIONS[k].label + '</span>' +
      '<button class="keybtn' + (S.keyWaitFor === k ? " wait" : "") + '" data-key="' + k + '">' +
      (S.keyWaitFor === k ? "Trykk tast …" : keyLabel(S.settings.keys[k])) + '</button></div>';
  }
  html += '<p style="color:var(--muted); font-size:11px; margin-top:8px">Esc avbryter modus og lukker paneler. ' +
    'Trykk på en tast-knapp og deretter ønsket tast for å endre.</p>' +
    '<h4>Lagring</h4>' +
    '<p style="color:var(--muted); font-size:11px; margin:0 0 6px">💾 Alt over – pluss fargelegging, egne typefarger, skjulte typer, ' +
    '👻 transparent, 🧲 snap og 🪶 lav kvalitet – lagres automatisk og legges på neste gang du åpner en modell.</p>' +
    '<p style="font-size:11px; margin:0 0 6px" id="stSync">' + syncStatusText() + '</p>' +
    '<div class="prop-actions" style="margin-top:10px">' +
      '<button id="stLiteNow" title="Bygger .glb nå og legger den i biblioteket">⚡ Lag rask kopi nå</button>' +
      '<button id="stReset">↺ Tilbakestill alt</button></div>';

  $("setBody").innerHTML = html;

  $("stRot").oninput = (e) => { S.settings.rotSpeed = Number(e.target.value); saveSettings(); };
  $("stZoom").oninput = (e) => { S.settings.zoomSpeed = Number(e.target.value); saveSettings(); };
  $("stInv").onchange = (e) => { S.settings.invertZoom = e.target.checked; saveSettings(); };
  $("stUnit").onchange = (e) => {
    S.settings.unit = e.target.value; saveSettings();
    if (S.clipOn && S.clipMode === "face") showClipBar();
  };
  $("stDec").onchange = (e) => {
    S.settings.decimals = Number(e.target.value);
    saveSettings();
    refreshNumbers();
    if (S.clipOn && S.clipMode === "face") showClipBar();
  };
  $("stBg").oninput = (e) => {
    scene.background.set(e.target.value);
    saveBg(e.target.value);
  };
  $("stAutoLite").onchange = (e) => { S.settings.autoLite = e.target.checked; saveSettings(); };
  $("stLight").onchange = () => $("btnLight").click();
  $("stAxFont").oninput = (e) => {
    S.axisFontF = e.target.value / 100;
    writePrefs();
    if (S.syncPrefs) S.syncPrefs();
    applyAxisFont();
  };
  $("stMini").onchange = (e) => setMini(e.target.checked);
  $("stMiniSz").oninput = (e) => {
    S.settings.miniSize = Number(e.target.value);
    $("stMiniV").textContent = S.settings.miniSize + " px";
    applyMiniSize(); saveSettings();
  };
  $("setBody").querySelectorAll("button[data-key]").forEach(b => {
    b.onclick = () => { S.keyWaitFor = b.dataset.key; renderSettings(); };
  });
  $("stLiteNow").onclick = () => { closeSettings(); lagRaskKopiNå(); };
  $("stReset").onclick = () => {
    S.settings = Object.assign({}, DEFAULT_SETTINGS, { keys: Object.assign({}, DEFAULT_KEYS) });
    saveSettings();
    applyMiniSize();
    // utseende, snap, aksefont og bakgrunn tilbake til standard
    S.axisFontF = 1;
    S.snapOn = true; S.snapPx = 18;
    writePrefs();
    applyAxisFont();
    setMini(true);
    if (S.typeInfo) resetColors(); else { scene.background.set(DEFAULT_BG); saveBg(DEFAULT_BG); S.appear = Object.assign({}, DEFAULT_APPEAR, { colors: {}, hiddenTypes: [] }); saveAppear(); }
    renderSettings();
  };
}

// Husk bakgrunnsfargen mellom økter
try { if (S.bg) scene.background.set(S.bg); } catch(_) {}

window.addEventListener("keydown", (e) => {
  // venter vi på ny hurtigtast?
  if (S.keyWaitFor) {
    e.preventDefault();
    if (e.key !== "Escape") {
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      for (const a in S.settings.keys) if (S.settings.keys[a] === k && a !== S.keyWaitFor) S.settings.keys[a] = "";
      S.settings.keys[S.keyWaitFor] = k;
      saveSettings();
    }
    S.keyWaitFor = null;
    renderSettings();
    return;
  }
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === "Escape") {
    if ($("commentDialog").classList.contains("open")) { $("commentDialog").classList.remove("open"); return; }
    if ($("setMenu").classList.contains("open")) { closeSettings(); return; }
    if (S.clipPickFace) { stopFacePick(); showClipBar(); return; }
    if (S.mode) { setMode(S.mode); return; } // slår av gjeldende modus
    ["propPanel","commentPanel","qtyPanel","colorPanel","libPanel","axesPanel","comparePanel", "searchPanel"]
      .forEach(id => $(id).classList.remove("open"));
    return;
  }
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  for (const a in ACTIONS) {
    if (S.settings.keys[a] && S.settings.keys[a] === key) {
      e.preventDefault();
      try { ACTIONS[a].run(); } catch(_) {}
      return;
    }
  }
});

// høyreklikk i modellen åpner denne menyen (kobles opp av scene.js)
S.onContextMenu = openSettings;

