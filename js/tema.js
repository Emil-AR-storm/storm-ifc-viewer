// Lyst / mørkt tema.
//
// Temaet ligger på <html data-tema="lys|mork">, og alle fargene i css/storm.css
// er variabler under de to velgerne. Selve valget settes allerede av et lite
// skript i <head> (js/tema-tidlig.js, synkront) – ellers rekker siden å male mørk flate før denne
// modulen er lastet, og det blinker. Her ligger bare knappen og lagringen.
//
// Egen lagringsnøkkel (storm.tema) på enheten. Før var temaet med vilje ikke
// synket («ulikt på PC og telefon»). Emil 19.11: temaet FØLGER NÅ BRUKEREN på
// tvers av Storm IFC, Storm Prosjekter og Storm Bemanning – lista «Brukere»
// (felles-innstillinger.js). Klikk på knappen lagrer felles (S.lagreFelles);
// et tema som kommer FRA lista (opt.fraFelles) lagres bare på enheten.
import { $, S } from "./state.js";
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

export function settTema(v, opt = {}) {
  document.documentElement.dataset.tema = (v === "lys") ? "lys" : "mork";
  skriv(tema());
  tegnKnapp();
  if (opt.fraBruker && !opt.fraFelles && S.lagreFelles) S.lagreFelles({ Tema: tema() });
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
  knapp.addEventListener("click", () => settTema(tema() === "lys" ? "mork" : "lys", { fraBruker: true }));
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
