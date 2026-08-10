// 🧭 Navigasjonshjul — samme idé som «Full Navigation Wheel» i Revit.
//
// HVORFOR: uten mus finnes det ingen midtklikk å panorere med og ingen
// rullehjul å zoome med. På et nettbrett ute på plassen er to fingre det eneste
// alternativet, og det er upresist med hansker. Hjulet gir hver bevegelse sin
// egen flate å dra i.
//
// BETJENING: hold og dra, som i Revit. Trykk og hold på en kile, dra for å
// navigere, slipp for å avslutte. Hub-en i midten og «Angre visning» er
// derimot vanlige klikk — de har ingen dra-bevegelse å styre.
//
// HVORFOR EGEN MODUL OG IKKE I scene.js: hjulet er ren betjening. Kameraet
// eies fortsatt av SimpleControls, og alt hjulet gjør er å kalle de samme tre
// metodene som mus og berøring bruker (roter/panorer/zoomSteg). Skal noen
// senere endre hvordan kameraet beveger seg, er det ett sted å gjøre det.

import { $, S } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, controls } from "./scene.js";
import { pick } from "./elements.js";

const NOKKEL = "storm-ifc-hjul";

// [navn, SVG-bane, ikonets x, ikonets y] — banene er REGNET UT, ikke tegnet
// for hånd: fire kiler à 90° i en ring fra radius 32 til 58, med 2,5° luft
// mellom hver. Endrer du størrelsen, må alle fire regnes om samtidig.
const KILER = [
  ["orbit", "M20.8 17.2A58 58 0 0 1 99.2 17.2L81.6 36.4A32 32 0 0 0 38.4 36.4Z", 60, 15, "i-hjul-orbit", "Roter"],
  ["zoom",  "M102.8 20.8A58 58 0 0 1 102.8 99.2L83.6 81.6A32 32 0 0 0 83.6 38.4Z", 105, 60, "i-hjul-zoom", "Zoom"],
  ["pan",   "M99.2 102.8A58 58 0 0 1 20.8 102.8L38.4 83.6A32 32 0 0 0 81.6 83.6Z", 60, 105, "i-hjul-pan", "Panorer"],
  ["angre", "M17.2 99.2A58 58 0 0 1 17.2 20.8L36.4 38.4A32 32 0 0 0 36.4 81.6Z", 15, 60, "i-hjul-angre", "Angre visning"]
];

// ---------- Kamerahistorikk ----------
// «Angre visning» trenger noe å gå tilbake TIL. Vi lagrer posisjon og
// blikkpunkt, ikke hele kameraet: alt annet (synsvinkel, nær/fjern-plan) settes
// av modellen, og å skrive det tilbake ville kunne gjøre en modell usynlig.
const historikk = [];
const MAKS_HISTORIKK = 30;

function husk() {
  historikk.push({
    pos: camera.position.clone(),
    mal: controls.target.clone()
  });
  if (historikk.length > MAKS_HISTORIKK) historikk.shift();
}

function gaTilbake() {
  const h = historikk.pop();
  if (!h) return false;
  camera.position.copy(h.pos);
  controls.target.copy(h.mal);
  camera.lookAt(controls.target);
  return true;
}

// ---------- Bygg hjulet ----------
function ikonBruk(id, x, y) {
  return '<use href="#' + id + '" x="' + (x - 9) + '" y="' + (y - 9) + '" width="18" height="18"/>';
}

const el = document.createElement("div");

el.id = "navHjul";

el.innerHTML =
  '<svg viewBox="0 0 120 120" aria-hidden="true">' +
    KILER.map(([navn, bane, ix, iy, ikon, tittel]) =>
      '<g class="nh-kile" data-nav="' + navn + '"><title>' + t(tittel) + '</title>' +
        '<path d="' + bane + '"/>' + ikonBruk(ikon, ix, iy) +
      '</g>').join("") +
    '<g class="nh-hub" data-nav="sentrer"><title>' + t("Sentrer på et punkt") + '</title>' +
      '<circle cx="60" cy="60" r="30"/>' + ikonBruk("i-hjul-sentrer", 60, 60) +
    '</g>' +
  '</svg>';

document.body.appendChild(el);

// ---------- Hold og dra ----------
let aktiv = null, sistX = 0, sistY = 0;

el.addEventListener("pointerdown", (e) => {
  const g = e.target.closest("[data-nav]");
  if (!g) return;
  const nav = g.dataset.nav;
  e.preventDefault();

  // Klikk-handlingene har ingen dra-bevegelse å styre
  if (nav === "angre") {
    if (!gaTilbake()) blink(g, "tom");
    return;
  }
  if (nav === "sentrer") { ventPaSenter(g); return; }

  husk();                       // så «Angre visning» kan komme hit tilbake
  aktiv = nav;
  sistX = e.clientX; sistY = e.clientY;
  el.setPointerCapture(e.pointerId);
  g.classList.add("gar");
});

el.addEventListener("pointermove", (e) => {
  if (!aktiv) return;
  const dx = e.clientX - sistX, dy = e.clientY - sistY;
  sistX = e.clientX; sistY = e.clientY;
  if (aktiv === "orbit") controls.roter(dx, dy);
  else if (aktiv === "pan") controls.panorer(dx, dy);
  else if (aktiv === "zoom") {
    // Dra OPP = zoom inn. Samme retning som å skyve modellen fra seg med
    // rullehjulet, og motsatt av å dra i selve modellen.
    const s = 1 + dy * 0.005 * (S.settings && S.settings.zoomSpeed ? S.settings.zoomSpeed : 1);
    controls.zoomSteg(Math.max(0.85, Math.min(1.15, s)));
  }
});

const slutt = () => {
  aktiv = null;
  el.querySelectorAll(".gar").forEach(g => g.classList.remove("gar"));
};

el.addEventListener("pointerup", slutt);
el.addEventListener("pointercancel", slutt);

function blink(g, klasse) {
  g.classList.add(klasse);
  setTimeout(() => g.classList.remove(klasse), 400);
}

// ---------- Sentrer på et punkt ----------
// Trykk hub-en, så velger neste trykk i modellen nytt rotasjonssenter.
// Lytteren ligger i FANGST-fasen på canvas, så den kommer foran valg av
// element og markeringsverktøyene i main.js — de ligger i boble-fasen.
let venter = false;

function ventPaSenter(g) {
  venter = !venter;
  g.classList.toggle("venter", venter);
  // Ingen tekstmelding: hub-en blir rød og pekeren blir et kryss. Statusfeltet
  // oppe til høyre eies av modellinfoen, og å låne det ville tatt bort
  // «206 elementer» uten å gi det tilbake.
  canvas.style.cursor = venter ? "crosshair" : "";
  canvas.title = venter ? t("Trykk i modellen for å sette nytt midtpunkt") : "";
}

canvas.addEventListener("pointerup", (e) => {
  if (!venter || e.button > 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const treff = pick(e.clientX, e.clientY);
  if (treff) {
    husk();
    // Kameraet står stille; bare blikkpunktet flyttes. Flyttet vi kameraet
    // også, ville modellen hoppet, og man mister følelsen av hvor man er.
    controls.target.copy(treff.point);
    camera.lookAt(controls.target);
  }
  ventPaSenter(el.querySelector(".nh-hub"));
}, true);

// ---------- Av og på ----------
export function visHjul(pa) {
  el.classList.toggle("open", !!pa);
  const b = $("btnHjul");
  if (b) b.classList.toggle("active", !!pa);
  try { localStorage.setItem(NOKKEL, pa ? "1" : "0"); } catch (_) {}
  if (!pa && venter) ventPaSenter(el.querySelector(".nh-hub"));
}

const knapp = $("btnHjul");

if (knapp) knapp.addEventListener("click", () => visHjul(!el.classList.contains("open")));

try { if (localStorage.getItem(NOKKEL) === "1") visHjul(true); } catch (_) {}
