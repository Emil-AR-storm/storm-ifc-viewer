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
  // Plass nederst: kontrollinja, minikartet og hinten flyttes over linja
  const l = $("bpEnkel");
  const hoyde = enkel && l && l.offsetHeight ? l.offsetHeight + 8 : 0;
  rot.style.setProperty("--enkel-h", hoyde + "px");
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
  window.addEventListener("resize", () => oppdater());
}

export function start() {
  lagBryter();
  lagLinje();
  folg();
  settModus("enkel");
}
S.bpModus = { settModus, oppdater, modusNa };

if (typeof document !== "undefined" && rot.dataset.lett === "1") start();
