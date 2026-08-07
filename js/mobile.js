// 📱 Mobiloppsett.
//
// På telefon brøt de 15 verktøyknappene over fire linjer og la seg oppå
// toppbaren. Her flyttes de sjeldnere knappene inn i en ⋯-meny, og toppbaren
// viser bare ikonene så den holder seg på én linje.
//
// Knappene FLYTTES (appendChild) – de bygges ikke på nytt. Da beholder de alle
// hendelseslyttere modulene har satt på dem.
import { $, ikon } from "./state.js";
import { t } from "./i18n.js";

const SMAL = 640;

// Disse blir liggende i verktøylinja på telefon – resten går i ⋯-menyen.
const PRIMÆRE = ["btnMarker", "btnMeasure", "btnClip", "btnStorey"];

// Disse toppbar-knappene viser bare ikonet når skjermen er smal.
// Teksten (<span class="btn-t">) skjules – ikonet i knappen står igjen.
const KORTE = ["btnOpen", "btnLib", "btnLight", "btnFit"];

function settKort(på) {
  KORTE.forEach(id => {
    const b = $(id);
    if (b) b.querySelectorAll(".btn-t").forEach(t => { t.style.display = på ? "none" : ""; });
  });
}

let mobilNå = null;      // null = ikke bestemt ennå
let menyÅpen = false;

function lagMeny() {
  if ($("moreMenu")) return $("moreMenu");
  const m = document.createElement("div");
  m.id = "moreMenu";
  document.body.appendChild(m);
  return m;
}

// Trykk utenfor lukker menyen. Lytteren settes ÉN gang, ikke inne i lagMeny():
// tilPC() fjerner menyen, så neste tilMobil() slapp forbi vakten der og la på
// enda en lytter. Hver rotasjon over/under 640 px la til én til, og de gamle
// holdt på et frakoblet element – så m.contains(e.target) var alltid usann og
// de lukket den NYE menyen på trykk som skulle vært ignorert.
document.addEventListener("pointerdown", (e) => {
  if (!menyÅpen) return;
  const m = $("moreMenu");
  if (!m || m.contains(e.target) || e.target.id === "btnMore") return;
  if (e.target.closest && e.target.closest("#btnMore")) return;   // treff på ikonet inni knappen
  lukkMeny();
});

function lagMerKnapp() {
  if ($("btnMore")) return $("btnMore");
  const b = document.createElement("button");
  b.id = "btnMore";
  // data-i18n + data-no: knappen bygges gjerne ETTER språkbytte, så originalen
  // (norsk nøkkel) må oppgis eksplisitt for at oversettDom() skal treffe riktig
  b.innerHTML = ikon("mer") + '<span class="btn-t" data-i18n data-no="Mer">' + t("Mer") + '</span>';
  b.title = t("Flere verktøy – hold inne for Innstillinger");
  b.setAttribute("data-i18n-title", "");
  b.dataset.noTitle = "Flere verktøy – hold inne for Innstillinger";
  // Langtrykk = ⚙ Innstillinger, som avtalt
  let holdTimer = null;
  let holdBrukt = false;   // langtrykket fyrte – da skal klikket etterpå ignoreres

  // Uten holdBrukt: timeren fyrte, satte holdTimer = null, og stopp() gjorde
  // ingenting. Deretter kom det vanlige click-eventet og åpnet ⋯-menyen – så
  // langtrykk ga BÅDE Innstillinger og ⋯-menyen samtidig.
  b.onclick = () => {
    if (holdBrukt) { holdBrukt = false; return; }
    menyÅpen ? lukkMeny() : åpneMeny();
  };

  const start = () => {
    holdBrukt = false;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      holdBrukt = true;
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

// Alle verktøyknappene i den rekkefølgen de står i HTML-en.
//
// Rekkefølgen leses fra HTML-en ÉN gang, ved oppstart, mens alle knappene ennå
// står i verktøylinja. Å lese den ut av DOM-en senere ga feil svar: da er
// listen «toolbar først, så moreMenu», og etter en tur innom mobil kom
// knappene tilbake i den rekkefølgen i stedet for HTML-rekkefølgen – for godt.
const HTML_REKKEFØLGE = [...$("toolbar").querySelectorAll("button")]
  .map(b => b.id)
  .filter(Boolean);

function verktøyKnapper() {
  const alle = [...$("toolbar").querySelectorAll("button"),
                ...($("moreMenu") ? [...$("moreMenu").querySelectorAll("button")] : [])]
    .filter(b => b.id !== "btnMore");
  const plass = (b) => {
    const i = HTML_REKKEFØLGE.indexOf(b.id);
    return i === -1 ? HTML_REKKEFØLGE.length : i;   // ukjente knapper bakerst
  };
  return alle.sort((a, b) => plass(a) - plass(b));
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
  settKort(true);
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
  settKort(false);
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
