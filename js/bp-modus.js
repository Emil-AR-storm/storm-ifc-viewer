// ◐ ENKEL | FULL PÅ BYGGEPLASSEN (Emil 04.11, valg E + av/på for Markeringer).
//
// «70 % vil bare se på modellen.» Modellen åpnes derfor i ENKEL: bare modellen,
// og fire verktøy i en linje nederst — Mål, Kjedemål, Snitt og Gjennomsiktig —
// pluss Markeringer med egen av/på-bryter (står av) og et rødt tall for hvor
// mange som finnes. Bryteren «Enkel | Full» oppe til høyre gir siden slik den
// var før. Grå tekst «mer info her →» peker på bryteren og forklarer begge.
//
// Knappene nederst trykker på de ekte knappene i verktøylinja (som bare er
// skjult, aldri fjernet), så alt verktøyene gjør er nøyaktig som i Full.
// Den aktive knappen lyser, og en kort linje over sier hva du gjør nå.
//
// Valget huskes IKKE: hver åpning starter i Enkel (Emils ønske).
// Kun byggeplassen (importeres fra lett-main.js).
import { $, S, ikon } from "./state.js";
import { t } from "./i18n.js";
import { axesGroup, grid, koteGroup, markerGroup, measureGroup, omradeGroup, scene, selGroup } from "./scene.js";
import { maalGroup } from "./maal.js";
import { skjulStoy, visStoy } from "./cmp-skjul.js";

// [knapp-id i Enkel, ekte knapp, ikon, tekst, hjelpelinje]
const VERKTOY = [
  ["bpeMaal", "btnMeasure", "maal", "Mål", "Mål: trykk to punkter i modellen"],
  ["bpeKjede", "btnKjede", "kjede", "Kjedemål", "Kjedemål: trykk punkt etter punkt langs det du vil måle"],
  ["bpeSnitt", "btnClip", "snitt", "Snitt", "Snitt: dra i glideren for å flytte snittet"],
  ["bpeGjenn", "btnGhost", "transparent", "Gjennomsiktig", "Gjennomsiktig: trykk på et element for å se det tydelig"]
];
// Mål og kjedemål er moduser (Esc avbryter); snitt og gjennomsiktig er visninger
const ESC = new Set(["btnMeasure", "btnKjede"]);

const rot = document.documentElement;
let modus = "enkel";
let markeringerPa = false;   // gjelder Enkel; i Full vises de som før

export const modusNa = () => modus;
export const markeringerSynlige = () => modus === "full" || markeringerPa;

function lagBryter() {
  const topp = $("topbar");
  if (!topp || $("bpmBryter")) return;
  const info = document.createElement("button");
  info.type = "button";
  info.id = "bpmInfo";
  info.className = "bpm-info";
  info.innerHTML = '<span data-i18n>mer info her</span> →';
  info.onclick = (e) => { e.stopPropagation(); visInfo(); };
  const b = document.createElement("div");
  b.id = "bpmBryter";
  b.className = "bpm-bryter";
  b.setAttribute("role", "group");
  b.innerHTML = '<button type="button" data-bpm="enkel" data-i18n>Enkel</button><button type="button" data-bpm="full" data-i18n>Full</button>';
  b.querySelectorAll("[data-bpm]").forEach(k => k.onclick = () => settModus(k.dataset.bpm));
  const før = $("btnInnlogging");
  topp.insertBefore(info, før || null);
  topp.insertBefore(b, før || null);
}

function lagLinje() {
  if ($("bpEnkel")) return;
  const l = document.createElement("div");
  l.id = "bpEnkel";
  l.innerHTML = '<div id="bpeHjelp" class="bpe-hjelp" style="display:none"></div>' +
    '<div class="bpe-rad">' +
    VERKTOY.map(([id, , ik, tekst]) => '<button type="button" id="' + id + '">' + ikon(ik) + '<span data-i18n>' + tekst + '</span></button>').join("") +
    '<span class="bpe-skille"></span>' +
    '<button type="button" id="bpeMerk" class="bpe-merk" role="switch" aria-checked="false">' + ikon("markeringer") +
    '<span class="bpe-merk-t"><span class="bpe-merk-navn" data-i18n>Markeringer</span><span class="bpe-sw"></span></span>' +
    '<span class="bpe-antall" id="bpeAntall" style="display:none"></span></button>' +
    '</div>';
  document.body.appendChild(l);
  for (const [id, ekte] of VERKTOY) $(id).onclick = () => { const k = $(ekte); if (k) k.click(); oppdater(); };
  $("bpeMerk").onclick = () => { markeringerPa = !markeringerPa; brukMarkeringer(); oppdater(); };
}

// 🙈 BARE IFC-MODELLEN I ENKEL (Emil 04.11: «den skal kun vise IFC modellen +
// markeringer hvis du skrur det på»). Rigg, terreng, materiell, SW-elementer,
// TRP-plater, blikk, ringmur, betonggulv, støpeplan, framdrift, vær …
// ligger hver i sin gruppe rett i scenen. Samme grep som sammenligningen
// (cmp-skjul.js): rett før hvert bilde skjules alt som ikke står i lista
// under, så et lag som slår seg på igjen selv også holdes skjult. Gruppene
// huskes og settes tilbake i Full. Markeringene styres av bryteren nederst.
const stoyHoldt = new Map();
const beholdes = (ch) => ch.isLight || ch.isCamera || ch === S.modelGroup || ch === grid ||
  ch === markerGroup || ch === omradeGroup || ch === measureGroup || ch === koteGroup ||
  ch === selGroup || ch === axesGroup || ch === maalGroup ||
  !!(ch.userData && ch.userData.sammenlign);   // målepekeren o.l. (merket for sammenligningen)
export function oppdaterStoy() {
  if (modus === "enkel" && S.modelGroup) {
    skjulStoy(scene, beholdes, stoyHoldt);
    for (const g of stoyHoldt.keys()) if (g.userData) g.userData.enkelSkjult = true;
  } else if (stoyHoldt.size) {
    for (const g of stoyHoldt.keys()) if (g.userData) delete g.userData.enkelSkjult;
    visStoy(stoyHoldt);
  }
}
function kobleStoy() {
  // compare.js har allerede sin egen krok her — vi legger oss etter, ikke over
  const forrige = scene.onBeforeRender;
  scene.onBeforeRender = function (...a) {
    if (typeof forrige === "function") forrige.apply(this, a);
    oppdaterStoy();
  };
}

// Markeringene av/på i 3D (markers.js eier gruppene)
function brukMarkeringer() {
  const pa = markeringerSynlige();
  if (S.settMarkeringerSynlig) S.settMarkeringerSynlig(pa);
}

function antallMarkeringer() {
  const alle = (S.comments || []).length;
  const skjulte = S.skjulteMarkeringerAntall ? S.skjulteMarkeringerAntall() : 0;
  return Math.max(0, alle - skjulte);
}

// Tegner knappene, hjelpelinja og bryteren i takt med de ekte knappene
export function oppdater() {
  const enkel = modus === "enkel";
  rot.dataset.bpModus = modus;
  document.querySelectorAll("#bpmBryter [data-bpm]").forEach(k => {
    const p = k.dataset.bpm === modus;
    k.classList.toggle("akt", p);
    k.setAttribute("aria-pressed", p ? "true" : "false");
  });
  let hjelp = "";
  for (const [id, ekte, , , linje] of VERKTOY) {
    const k = $(ekte), b = $(id);
    const pa = !!(k && k.classList.contains("active"));
    if (b) { b.classList.toggle("akt", pa); b.setAttribute("aria-pressed", pa ? "true" : "false"); }
    // Mål/kjedemål går foran snitt og gjennomsiktig: det er der du holder på
    if (pa && (!hjelp || ESC.has(ekte))) hjelp = t(linje) + (ESC.has(ekte) && !erTelefon() ? " · " + t("Esc avbryter") : "");
  }
  const h = $("bpeHjelp");
  if (h) { h.textContent = hjelp; h.style.display = hjelp ? "" : "none"; }
  const m = $("bpeMerk");
  if (m) { m.classList.toggle("pa", markeringerPa); m.setAttribute("aria-checked", markeringerPa ? "true" : "false"); }
  const n = antallMarkeringer(), a = $("bpeAntall");
  if (a) { a.textContent = n > 99 ? "99+" : String(n); a.style.display = n ? "" : "none"; }
  if (m) m.title = t("Markeringer: {0}", n) + " — " + (markeringerPa ? t("vises") : t("skjult"));
  // Linja står ØVERST (Emil 04.11, valg A): nederst dekket den objektinfoen.
  // Den legges rett under toppbaren, og kuben (Topp/Front) flyttes under linja.
  tilpassInfo();
  const l = $("bpEnkel"), topp = $("topbar");
  const start = Math.round((topp ? topp.getBoundingClientRect().bottom : 50) + 6);
  rot.style.setProperty("--enkel-start", start + "px");
  rot.style.setProperty("--enkel-h", "0px");   // ingenting nederst trenger å flyttes lenger
  if (enkel && l && l.offsetHeight) rot.style.setProperty("--enkel-topp", (start + l.offsetHeight + 8) + "px");
  else rot.style.removeProperty("--enkel-topp");
}

// «mer info her →» skal alltid synes helt (Emil 04.11: «hvis den ikke får plass
// så krymper tekststørrelsen»). Toppbaren ruller sidelengs på telefon når den
// er for bred; da krympes teksten et halvt punkt om gangen til alt får plass
// (ned til 7 px). Kjøres når siden endrer bredde, språk eller modus.
export function tilpassInfo() {
  const topp = $("topbar"), i = $("bpmInfo");
  if (!topp || !i) return;
  i.style.fontSize = "";
  i.classList.remove("to-linjer");
  topp.classList.remove("bpm-trang");
  if (!i.offsetWidth) return;   // skjult (før modellen er åpen, eller Full på telefon)
  const forBred = () => topp.scrollWidth > topp.clientWidth + 1;
  const krymp = (fra, til) => {
    let px = fra;
    while (forBred() && px > til) { px -= 0.5; i.style.fontSize = px + "px"; }
  };
  // 1) mindre tekst, ned til 9 px  2) to linjer («mer info / her →»), ned til 7 px
  krymp(parseFloat(window.getComputedStyle(i).fontSize) || 12, 9);
  if (forBred()) { i.classList.add("to-linjer"); i.style.fontSize = "11px"; krymp(11, 7); }
  // 3) fortsatt for trangt (smal telefon, langt språk): tettere toppbar
  if (forBred()) { topp.classList.add("bpm-trang"); i.style.fontSize = "10px"; krymp(10, 7); }
}

const erTelefon = () => typeof window !== "undefined" && window.innerWidth <= 640;

// Bytt modus. Til Enkel: verktøy som ikke finnes der lukkes, så ingenting
// står igjen som man ikke kan nå.
export function settModus(ny) {
  modus = ny === "full" ? "full" : "enkel";
  if (modus === "enkel") {
    document.querySelectorAll(".panel.open").forEach(p => {
      if (["propPanel", "clipPanel"].includes(p.id)) return;
      const x = p.querySelector("[data-lukk]");
      if (x) x.click(); else p.classList.remove("open");
    });
    // Klikkmoduser som ikke har knapp i Enkel (markering, kote, vinkel …)
    if (S.mode && !["measure", "kjede"].includes(S.mode) && S.avsluttKlikkModus) S.avsluttKlikkModus("bpEnkel");
  }
  lukkInfo();
  brukMarkeringer();
  oppdaterStoy();
  S.miniSkitten = true;
  oppdater();
}

// «mer info her →»: kort forklaring under bryteren
function visInfo() {
  if ($("bpmInfoBoble")) { lukkInfo(); return; }
  const b = document.createElement("div");
  b.id = "bpmInfoBoble";
  b.className = "bpm-boble";
  b.setAttribute("role", "dialog");
  b.innerHTML =
    '<div class="bpm-kort' + (modus === "enkel" ? " akt" : "") + '" data-bpm="enkel"><b>' + t("Enkel") + '</b><small>' + t("Bare modellen: mål, kjedemål, snitt og gjennomsiktig. Markeringene slås på nederst.") + '</small></div>' +
    '<div class="bpm-kort' + (modus === "full" ? " akt" : "") + '" data-bpm="full"><b>' + t("Full") + '</b><small>' + t("Alt fra kontoret: markeringer, framdriftsplan, støpeplan, ferdigmelding, vær og resten av verktøyene.") + '</small></div>';
  b.querySelectorAll("[data-bpm]").forEach(k => k.onclick = () => settModus(k.dataset.bpm));
  document.body.appendChild(b);
  const br = $("bpmBryter");
  const r = br ? br.getBoundingClientRect() : { right: window.innerWidth - 8, bottom: 50 };
  const bredde = Math.min(320, window.innerWidth - 16);
  b.style.width = bredde + "px";
  b.style.left = Math.max(8, Math.min(r.right - bredde, window.innerWidth - bredde - 8)) + "px";
  b.style.top = (r.bottom + 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", utenfor, true), 0);
}
function lukkInfo() {
  const b = $("bpmInfoBoble");
  if (b) b.remove();
  document.removeEventListener("pointerdown", utenfor, true);
}
function utenfor(e) {
  const b = $("bpmInfoBoble");
  if (b && !b.contains(e.target) && !(e.target.closest && e.target.closest("#bpmInfo"))) lukkInfo();
}

// Følg med på de ekte knappene (andre moduler slår dem av og på) og på
// markeringstelleren (endres når markeringene hentes eller nye kommer)
function folg() {
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!MO) return;
  const mo = new MO(() => oppdater());
  for (const [, ekte] of VERKTOY) { const k = $(ekte); if (k) mo.observe(k, { attributes: true, attributeFilter: ["class"] }); }
  const c = $("commentCount");
  if (c) mo.observe(c, { childList: true, characterData: true, subtree: true });
  // Teksten byttes ved språkbytte, og toppbaren vises når modellen er åpen
  const mo2 = new MO(() => tilpassInfo());
  const i = $("bpmInfo");
  if (i) mo2.observe(i, { childList: true, characterData: true, subtree: true });
  if (document.body) mo2.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", () => oppdater());
  // Hjelpelinja under linja kommer og går — kuben skal følge med
  const l = $("bpEnkel");
  if (l && window.ResizeObserver) new window.ResizeObserver(() => oppdater()).observe(l);
}

export function start() {
  lagBryter();
  lagLinje();
  folg();
  kobleStoy();
  settModus("enkel");
}
S.bpModus = { settModus, oppdater, modusNa };

if (typeof document !== "undefined" && rot.dataset.lett === "1") start();
