// 📱 Mobiloppsett.
//
// På telefon brøt de 15 verktøyknappene over fire linjer og la seg oppå
// toppbaren. Her flyttes de sjeldnere knappene inn i en ⋯-meny, og toppbaren
// får korte etiketter så den holder seg på én linje.
//
// Knappene FLYTTES (appendChild) – de bygges ikke på nytt. Da beholder de alle
// hendelseslyttere modulene har satt på dem.
import { $, S } from "./state.js";

const SMAL = 640;

// Disse blir liggende i verktøylinja på telefon – resten går i ⋯-menyen.
const PRIMÆRE = ["btnMarker", "btnMeasure", "btnClip", "btnStorey"];

// Kortere etiketter i toppbaren når skjermen er smal
const KORT = {
  btnOpen: "📂",
  btnLib: "📚",
  btnLight: "🪶",
  btnFit: "🎯"
};

let mobilNå = null;      // null = ikke bestemt ennå
let menyÅpen = false;

function lagMeny() {
  if ($("moreMenu")) return $("moreMenu");
  const m = document.createElement("div");
  m.id = "moreMenu";
  document.body.appendChild(m);
  // trykk utenfor lukker menyen
  document.addEventListener("pointerdown", (e) => {
    if (!menyÅpen) return;
    if (m.contains(e.target) || e.target.id === "btnMore") return;
    lukkMeny();
  });
  return m;
}

function lagMerKnapp() {
  if ($("btnMore")) return $("btnMore");
  const b = document.createElement("button");
  b.id = "btnMore";
  b.textContent = "⋯ Mer";
  b.title = "Flere verktøy – hold inne for ⚙ Innstillinger";
  b.onclick = () => (menyÅpen ? lukkMeny() : åpneMeny());

  // Langtrykk = ⚙ Innstillinger, som avtalt
  let holdTimer = null;
  const start = () => {
    holdTimer = setTimeout(() => {
      holdTimer = null;
      lukkMeny();
      $("btnSettings").click();
    }, 550);
  };
  const stopp = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  b.addEventListener("pointerdown", start);
  b.addEventListener("pointerup", stopp);
  b.addEventListener("pointercancel", stopp);
  b.addEventListener("pointerleave", stopp);
  b.addEventListener("contextmenu", (e) => e.preventDefault());   // ikke vis nettleserens meny
  return b;
}

export function åpneMeny() {
  const m = $("moreMenu");
  if (!m) return;
  m.classList.add("open");
  menyÅpen = true;
  $("btnMore").classList.add("active");
}

export function lukkMeny() {
  const m = $("moreMenu");
  if (!m) return;
  m.classList.remove("open");
  menyÅpen = false;
  const b = $("btnMore");
  if (b) b.classList.remove("active");
}

// Alle verktøyknappene i den rekkefølgen de står i HTML-en
function verktøyKnapper() {
  return [...$("toolbar").querySelectorAll("button"), ...($("moreMenu") ? [...$("moreMenu").querySelectorAll("button")] : [])]
    .filter(b => b.id !== "btnMore");
}

function tilMobil() {
  const bar = $("toolbar");
  const meny = lagMeny();
  const knapper = verktøyKnapper();

  // rekkefølgen i HTML-en bestemmer rekkefølgen i menyen
  knapper.forEach(b => {
    if (PRIMÆRE.includes(b.id)) bar.appendChild(b);
    else meny.appendChild(b);
  });
  bar.appendChild(lagMerKnapp());

  for (const id in KORT) {
    const b = $(id);
    if (b && !b.dataset.lang) { b.dataset.lang = b.textContent; b.textContent = KORT[id]; }
  }
}

function tilPC() {
  const bar = $("toolbar");
  lukkMeny();
  // legg alt tilbake i verktøylinja, i HTML-rekkefølge
  verktøyKnapper().forEach(b => bar.appendChild(b));
  const mer = $("btnMore");
  if (mer) mer.remove();
  const meny = $("moreMenu");
  if (meny) meny.remove();

  for (const id in KORT) {
    const b = $(id);
    if (b && b.dataset.lang) { b.textContent = b.dataset.lang; delete b.dataset.lang; }
  }
}

export function oppdaterOppsett() {
  const smal = window.innerWidth <= SMAL;
  if (smal === mobilNå) return;
  mobilNå = smal;
  document.body.classList.toggle("mobil", smal);
  if (smal) tilMobil(); else tilPC();
}

// Menyen skal lukke seg når man har valgt noe
document.addEventListener("click", (e) => {
  if (!menyÅpen) return;
  const b = e.target.closest && e.target.closest("#moreMenu button");
  if (b) lukkMeny();
}, true);

window.addEventListener("resize", oppdaterOppsett);
window.addEventListener("orientationchange", () => setTimeout(oppdaterOppsett, 200));

oppdaterOppsett();

// Esc lukker menyen
window.addEventListener("keydown", (e) => { if (e.key === "Escape") lukkMeny(); });
