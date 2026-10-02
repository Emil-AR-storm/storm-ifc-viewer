// 📜 RULLING I ALLE VINDUENE — byggeplass-siden (Emil 02.10).
//
// Runde 2 (Emil 02.10, skjermbilder av Utseende og Mengder): «ingen av de
// andre pop up vinduene har fått samme løsning som objekt info vinduet».
// Vinduene er nå like små som egenskapspanelet: strammere hode og rader, og
// lista får en fast lav høyde og rulles inni vinduet (CSS «kompakte vinduer»
// i storm.css). Denne fila gir fallet nederst og løfter kontekstlinja.
//
// «jeg vil ha den skrulle funksjonen i alle pop up vindu storm-byggeplass»:
// samme oppførsel som egenskapspanelet (js/prop-kompakt.js) — innholdet
// ruller inne i vinduet uten å dra modellen eller siden med seg, og et svakt
// fall nederst viser at det finnes mer å rulle til. Fallet forsvinner når du
// har rullet helt ned.
//
// Én regel for alle vinduer, i stedet for kode i hvert panel: fila ser etter
// alt som kan rulle (overflow auto/scroll) i panelene, innstillingsmenyen,
// markeringsvinduet og hjelpekortet, og setter klassen `rull-mer` når det er
// mer under. Nye vinduer får det uten at noen husker på det.
const UTVALG = ".panel .body, #setMenu .body, #commentDialog, #commentDialog *, #hjelpKort, #hjelpKort *, .fp-liste";

export function kanRulleMer(el) {
  return el.scrollHeight - el.clientHeight > 4 && el.scrollTop + el.clientHeight < el.scrollHeight - 4;
}

const sett = new WeakSet();
function rullbar(el) {
  const cs = window.getComputedStyle(el);
  return cs.overflowY === "auto" || cs.overflowY === "scroll";
}
// 📏 Høyden på panelet som står åpent, så kontekstlinja nederst (snitt, mål,
// koter — #modeBar) kan legge seg OVER det i stedet for oppå innholdet
// (Emil 02.10, skjermbilde: «Tøm koter» lå over Utseende-lista).
export function apentPanelHoyde() {
  let h = 0;
  for (const p of document.querySelectorAll(".panel.open")) {
    const r = p.getBoundingClientRect();
    if (r.height > h && r.bottom >= window.innerHeight - 2) h = r.height;
  }
  return Math.round(h);
}
export function oppdaterFall() {
  document.documentElement.style.setProperty("--apen-panel", apentPanelHoyde() + "px");
  for (const el of document.querySelectorAll(UTVALG)) {
    if (!el.offsetParent && el.offsetHeight === 0) { el.classList.remove("rull-mer"); continue; }
    if (!rullbar(el)) continue;
    if (!sett.has(el)) { sett.add(el); el.classList.add("rull-boks"); }
    el.classList.toggle("rull-mer", kanRulleMer(el));
  }
}

let ventende = false;
function snart() {
  if (ventende) return;
  ventende = true;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16);
  raf(() => { ventende = false; oppdaterFall(); });
}

if (typeof document !== "undefined") {
  // Rulling (fanges for alle vinduer på én gang), nytt innhold, panel åpnet/lukket
  document.addEventListener("scroll", (ev) => {
    const el = ev.target;
    if (el && el.classList && el.classList.contains("rull-boks")) el.classList.toggle("rull-mer", kanRulleMer(el));
  }, true);
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (MO) new MO(snart).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "open", "style"] });
  if (typeof window !== "undefined") window.addEventListener("resize", snart);
  snart();
}
