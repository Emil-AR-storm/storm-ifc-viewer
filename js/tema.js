// Lyst / mørkt tema.
//
// Temaet ligger på <html data-tema="lys|mork">, og alle fargene i css/storm.css
// er variabler under de to velgerne. Selve valget settes allerede av et lite
// inline-skript i <head> – ellers rekker siden å male mørk flate før denne
// modulen er lastet, og det blinker. Her ligger bare knappen og lagringen.
//
// Egen lagringsnøkkel med vilje: prefs-strukturen i state.js synkes til
// SharePoint (usersync.js), og temaet er noe man gjerne vil ha ulikt på
// PC-en inne og telefonen ute på plassen.
import { $ } from "./state.js";
import { t } from "./i18n.js";

const NOKKEL = "storm.tema";

function les() {
  try {
    const v = localStorage.getItem(NOKKEL);
    return (v === "lys" || v === "mork") ? v : null;
  } catch (_) { return null; }
}

function skriv(v) {
  try { localStorage.setItem(NOKKEL, v); } catch (_) {}
}

export function tema() {
  return document.documentElement.dataset.tema === "lys" ? "lys" : "mork";
}

export function settTema(v) {
  document.documentElement.dataset.tema = (v === "lys") ? "lys" : "mork";
  skriv(tema());
  tegnKnapp();
}

// Knappen viser ikonet for det man bytter TIL, ikke det man står i –
// det er slik alle andre temabrytere oppfører seg.
function tegnKnapp() {
  const b = $("btnTema");
  if (!b) return;
  const lys = tema() === "lys";
  b.innerHTML = '<svg class="ikon"><use href="#i-tema' + (lys ? "-mork" : "") + '"/></svg>';
  b.title = lys ? t("Bytt til mørkt tema") : t("Bytt til lyst tema");
  b.setAttribute("aria-label", b.title);
}

const knapp = $("btnTema");
if (knapp) {
  knapp.addEventListener("click", () => settTema(tema() === "lys" ? "mork" : "lys"));
  tegnKnapp();
}

// Har brukeren aldri valgt selv, følger vi systemet også når det endrer seg
// (mørk modus på i solnedgang o.l.).
try {
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    if (!les()) {
      document.documentElement.dataset.tema = e.matches ? "lys" : "mork";
      tegnKnapp();
    }
  });
} catch (_) {}
