// Modus-håndtering (markering / mål / kote) og den nedre kontrollinja.
import { $, på, S, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { hideSnapPreview } from "./measure.js";
import { koteGroup, measureGroup } from "./scene.js";

// ---------- Modus-håndtering ----------

export const modeButtons = { marker: $("btnMarker"), measure: $("btnMeasure"), kote: $("btnKote") };

export const modeBar = $("modeBar");

export function setMode(m) {
  S.mode = (S.mode === m) ? null : m;
  for (const k in modeButtons) modeButtons[k].classList.toggle("active", S.mode === k);
  // 📦 materiell-modus settes av materiell.js — men går man hit fra den,
  // skal knappen dens slippe å stå som aktiv
  const bm = $("btnMateriell");
  if (bm && S.mode !== "materiell") bm.classList.remove("active");
  S.measureFirst = null;
  hideSnapPreview();
  updateModeBar();
}

// materiell.js trenger å tegne kontrollinja på nytt uten sirkulær import
S.oppdaterModeBar = updateModeBar;

på("btnMarker", "click", () => setMode("marker"));

på("btnMeasure", "click", () => setMode("measure"));

på("btnKote", "click", () => setMode("kote"));

export function updateModeBar() {
  if (S.clipOn || S.storeyOn) return; // snitt-/etasjekontroller styrer modeBar
  if (S.mode === "measure") {
    modeBar.innerHTML = '<span class="lbl">' + t("Trykk på to punkter") + '</span>' +
      '<button id="mbSnap" title="' + t("Fest til nærmeste hjørne/kant") + '">' + t("Snap") + '</button>' +
      '<button id="mbRett" title="' + t("Lås målet til rett linje langs nærmeste akse (vannrett eller loddrett)") + '">' + t("Rett strek") + '</button>' +
      '<input type="range" id="mbSnapPx" min="5" max="50" step="1" value="' + S.snapPx + '" title="' + t("Snap-følsomhet (piksler)") + '" style="width:90px">' +
      '<button id="mbClear">' + t("Tøm mål") + '</button>';
    $("mbSnap").classList.toggle("active", S.snapOn);
    $("mbRett").classList.toggle("active", !!S.rettOn);
    $("mbRett").onclick = () => {
      S.rettOn = !S.rettOn;
      $("mbRett").classList.toggle("active", S.rettOn);
    };
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
    $("mbClear").onclick = () => {
      const barn = measureGroup.children.slice();
      measureGroup.clear();
      S.measureFirst = null;
      if (barn.length && S.pushAngre) S.pushAngre({
        tekst: "Tøm mål",
        angre: () => barn.forEach(o => measureGroup.add(o)),
        gjenopprett: () => barn.forEach(o => measureGroup.remove(o))
      });
    };
    modeBar.classList.add("open");
  } else if (S.mode === "kote") {
    modeBar.innerHTML = '<span class="lbl">' + t("Trykk på et punkt for å vise kotehøyde") + '</span><button id="mbClear">' + t("Tøm koter") + '</button>';
    $("mbClear").onclick = () => {
      const barn = koteGroup.children.slice();
      koteGroup.clear();
      if (barn.length && S.pushAngre) S.pushAngre({
        tekst: "Tøm koter",
        angre: () => barn.forEach(o => koteGroup.add(o)),
        gjenopprett: () => barn.forEach(o => koteGroup.remove(o))
      });
    };
    modeBar.classList.add("open");
  } else if (S.mode === "marker") {
    modeBar.innerHTML = '<span class="lbl">' + t("Trykk på modellen for å plassere markering") + '</span>';
    // ⭕▭ Område-valgene (sirkel/firkant + nivå) eies av markers.js og legges
    // på via S — samme krok-mønster som materiell, av samme grunn: markers.js
    // importerer setMode herfra, så modes.js kan ikke importere tilbake.
    if (S.omradeModeBar) S.omradeModeBar(modeBar);
    modeBar.classList.add("open");
  } else if (S.mode === "materiell" && S.materiellModeBar) {
    // 📦 materiell-verktøyet eier innholdet sitt selv (js/materiell.js)
    S.materiellModeBar(modeBar);
  } else {
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
  }
}
