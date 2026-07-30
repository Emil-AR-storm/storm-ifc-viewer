// Modus-håndtering (markering / mål / kote) og den nedre kontrollinja.
import { $, S, writePrefs } from "./state.js";
import { hideSnapPreview } from "./measure.js";
import { koteGroup, measureGroup } from "./scene.js";

// ---------- Modus-håndtering ----------

export const modeButtons = { marker: $("btnMarker"), measure: $("btnMeasure"), kote: $("btnKote") };

export const modeBar = $("modeBar");

export function setMode(m) {
  S.mode = (S.mode === m) ? null : m;
  for (const k in modeButtons) modeButtons[k].classList.toggle("active", S.mode === k);
  S.measureFirst = null;
  hideSnapPreview();
  updateModeBar();
}

$("btnMarker").addEventListener("click", () => setMode("marker"));

$("btnMeasure").addEventListener("click", () => setMode("measure"));

$("btnKote").addEventListener("click", () => setMode("kote"));

export function updateModeBar() {
  if (S.clipOn || S.storeyOn) return; // snitt-/etasjekontroller styrer modeBar
  if (S.mode === "measure") {
    modeBar.innerHTML = '<span class="lbl">Trykk på to punkter</span>' +
      '<button id="mbSnap" title="Fest til nærmeste hjørne/kant">Snap</button>' +
      '<input type="range" id="mbSnapPx" min="5" max="50" step="1" value="' + S.snapPx + '" title="Snap-følsomhet (piksler)" style="width:90px">' +
      '<button id="mbClear">Tøm mål</button>';
    $("mbSnap").classList.toggle("active", S.snapOn);
    $("mbSnap").onclick = () => {
      S.snapOn = !S.snapOn;
      $("mbSnap").classList.toggle("active", S.snapOn);
      writePrefs();
      if (S.syncPrefs) S.syncPrefs();
    };
    $("mbSnapPx").oninput = (e) => {
      S.snapPx = Number(e.target.value);
      writePrefs();
      if (S.syncPrefs) S.syncPrefs();
    };
    $("mbClear").onclick = () => { measureGroup.clear(); S.measureFirst = null; };
    modeBar.classList.add("open");
  } else if (S.mode === "kote") {
    modeBar.innerHTML = '<span class="lbl">Trykk på et punkt for å vise kotehøyde</span><button id="mbClear">Tøm koter</button>';
    $("mbClear").onclick = () => koteGroup.clear();
    modeBar.classList.add("open");
  } else if (S.mode === "marker") {
    modeBar.innerHTML = '<span class="lbl">Trykk på modellen for å plassere markering</span>';
    modeBar.classList.add("open");
  } else {
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
  }
}
