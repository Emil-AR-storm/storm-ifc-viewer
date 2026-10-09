// Modus-håndtering (markering / mål / kote) og den nedre kontrollinja.
import { $, på, S, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { hideSnapPreview } from "./measure.js";
import { koteGroup, measureGroup } from "./scene.js";

// ---------- Modus-håndtering ----------

export const modeButtons = { marker: $("btnMarker"), measure: $("btnMeasure"), kote: $("btnKote"), kjede: $("btnKjede"), vinkel: $("btnVinkel") };

export const modeBar = $("modeBar");

// 📱 «?»-KNAPPEN I KONTROLLBOKSEN (Emil 08.10): «det er en linje du må dra
// fram og tilbake på — det er vanskelig å stille på ting og se all infoen.
// Gjør det til en boks som viser alt på én gang, og legg hjelpeteksten bak en
// ?-knapp i stedet for at den tar masse plass.»
//
// Innholdet i kontrollinja skrives av mange moduler (mål, kjede, vinkel, kote,
// snitt, etasje, markering, materiell, rigg) med innerHTML. I stedet for å
// legge «?» inn ni steder følger vi med på linja her: hver gang innholdet
// byttes og det finnes en hjelpetekst (.lbl), legges «?» til bakerst. CSS-en
// (telefon) skjuler hjelpeteksten til «?» er trykket; på PC er «?» skjult og
// alt er som før. Valget huskes mens siden er åpen.
let hjelpVises = false;
function leggHjelpKnapp() {
  if (!modeBar || $("mbHjelp") || !modeBar.querySelector(".lbl")) return;
  const b = document.createElement("button");
  b.id = "mbHjelp";
  b.type = "button";
  b.textContent = "?";
  b.title = t("Vis eller skjul hjelpeteksten");
  b.setAttribute("aria-label", t("Vis eller skjul hjelpeteksten"));
  b.classList.toggle("active", hjelpVises);
  b.onclick = () => {
    hjelpVises = !hjelpVises;
    modeBar.classList.toggle("vis-hjelp", hjelpVises);
    b.classList.toggle("active", hjelpVises);
  };
  modeBar.appendChild(b);
}
// window.MutationObserver først: i Node-testene (jsdom) finnes den bare på window
const MO = (typeof window !== "undefined" && window.MutationObserver) ||
  (typeof MutationObserver !== "undefined" ? MutationObserver : null);
if (modeBar && MO) {
  modeBar.classList.toggle("vis-hjelp", hjelpVises);
  new MO(leggHjelpKnapp).observe(modeBar, { childList: true });
}

export function setMode(m) {
  S.mode = (S.mode === m) ? null : m;
  for (const k in modeButtons) if (modeButtons[k]) modeButtons[k].classList.toggle("active", S.mode === k);
  // 📏📐 et kjedemål eller en vinkel under arbeid kastes når modusen byttes
  if (S.avbrytMaalVerktoy) S.avbrytMaalVerktoy();
  // 📦 materiell-modus settes av materiell.js — men går man hit fra den,
  // skal knappen dens slippe å stå som aktiv
  const bm = $("btnMateriell");
  if (bm && S.mode !== "materiell") bm.classList.remove("active");
  const br = $("btnRigg");   // 🏕 samme for rigg-modusen (js/rigg.js)
  if (br && S.mode !== "rigg") br.classList.remove("active");
  S.measureFirst = null;
  hideSnapPreview();
  updateModeBar();
}

// materiell.js trenger å tegne kontrollinja på nytt uten sirkulær import
S.oppdaterModeBar = updateModeBar;

// ---------- Ett verktøy om gangen ----------
// KLIKKMODUS = en modus der et klikk i modellen betyr noe annet enn «vis meg
// dette elementet»: markering plasserer en markering, materiell plasserer en
// kasse. Åpner du et annet verktøy, er du ferdig med den — ellers står
// kontrollinja igjen nederst og neste klikk gjør noe du ikke lenger holder på
// med. Verdien er panelet som EIER modusen: åpner du det, skal modusen stå.
//
// DISSE STÅR MED VILJE IKKE I LISTA:
//   · Mål og Kote legger bare på en måling. Du skal kunne måle mens du ser på
//     mengder, og målene blir stående uansett.
//   · Snitt, etasjefilter, gjennomsiktig og fargelegging er VISNINGER, ikke
//     moduser. De bestemmer hva du ser på, og skal overleve at du bytter
//     verktøy — nøyaktig som at du skrur dem av selv når du er ferdig.
const KLIKKMODUSER = { marker: "commentPanel", materiell: "materiellPanel", rigg: "riggPanel" };

S.avsluttKlikkModus = (nyttPanel) => {
  const eier = KLIKKMODUSER[S.mode];
  if (!eier || eier === nyttPanel) return;
  // materiell-modusen eies av js/materiell.js og må avsluttes derfra: den
  // rydder også bort en påbegynt plassering. setMode() alene ville latt en
  // halvferdig kasse bli hengende i scenen.
  if (S.mode === "materiell") { if (S.avsluttMateriell) S.avsluttMateriell(); return; }
  if (S.mode === "rigg") { if (S.avsluttRigg) S.avsluttRigg(); return; }   // 🏕 samme grunn
  setMode(S.mode);   // setMode på gjeldende modus slår den av
};

på("btnMarker", "click", () => setMode("marker"));

på("btnMeasure", "click", () => setMode("measure"));

på("btnKote", "click", () => setMode("kote"));

på("btnKjede", "click", () => setMode("kjede"));     // 📏 kjedemål (js/maal-verktoy.js)

på("btnVinkel", "click", () => setMode("vinkel"));   // 📐 vinkel og fall (js/maal-verktoy.js)

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
  } else if (S.mode === "kjede" && S.kjedeModeBar) {
    S.kjedeModeBar(modeBar);      // 📏 eies av js/maal-verktoy.js
  } else if (S.mode === "vinkel" && S.vinkelModeBar) {
    S.vinkelModeBar(modeBar);     // 📐 eies av js/maal-verktoy.js
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
  } else if (S.mode === "rigg" && S.riggModeBar) {
    // 🏕 rigg-verktøyet eier innholdet sitt selv (js/rigg.js)
    S.riggModeBar(modeBar);
  } else {
    modeBar.classList.remove("open");
    modeBar.innerHTML = "";
  }
}
