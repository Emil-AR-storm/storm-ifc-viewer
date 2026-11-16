// 🔆 HOLD SKJERMEN VÅKEN – Storm Byggeplass (Emil 16.11.2026, forslag 4 runde 4)
//
// Telefonen slukker skjermen etter noen sekunder uten berøring. Står montøren
// og sammenligner modellen med det som er bygget, går den i svart midt i en
// måling. Nettleserens Screen Wake Lock ber telefonen la skjermen stå på:
//   • bare mens en modell er åpen og siden vises
//   • slipper etter 10 minutter uten berøring (Emils valg), så batteriet ikke
//     tappes om telefonen blir liggende – et nytt trykk slår den på igjen
//   • telefonen slipper den selv ved appbytte og når siden skjules; når siden
//     vises igjen, bes det på nytt
//   • av/på i Innstillinger («Hold skjermen våken»), på som standard
// Støtter ikke telefonen dette (eldre iOS enn 16.4), skjer ingenting.
import { S } from "./state.js";

export const SLIPP_ETTER_MS = 10 * 60 * 1000;
let lås = null, sistAktiv = Date.now(), ber = false;

export const støttes = () => typeof navigator !== "undefined" && !!(navigator.wakeLock && navigator.wakeLock.request);
export const påSlått = () => !(S.settings && S.settings.holdVaaken === false);
export const aktiv = () => !!(lås && !lås.released);

// Skal skjermen holdes våken akkurat nå? (ren regel – testes)
export function bør(o) {
  return !!(o.på && o.modell && o.synlig && (o.nå - o.sistAktiv) < SLIPP_ETTER_MS);
}
function nå() {
  return bør({ på: påSlått(), modell: !!S.modelGroup, synlig: document.visibilityState === "visible", nå: Date.now(), sistAktiv });
}

async function be() {
  if (!støttes() || aktiv() || ber) return;
  ber = true;
  try {
    lås = await navigator.wakeLock.request("screen");
    lås.addEventListener("release", () => { lås = null; });
  } catch (_) { lås = null; /* f.eks. lavstrøm eller siden ikke synlig – prøver igjen ved neste trykk */ }
  finally { ber = false; }
}
async function slipp() {
  const l = lås; lås = null;
  if (l && !l.released) { try { await l.release(); } catch (_) { /* allerede sluppet */ } }
}
export function oppdater() { if (nå()) be(); else slipp(); }

function aktivitet() { sistAktiv = Date.now(); if (!aktiv()) oppdater(); }

export function start() {
  if (typeof document === "undefined") return;
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(h => document.addEventListener(h, aktivitet, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", oppdater);
  // Hvert halve minutt: modellen åpnet / 10 minutter gått / innstillingen endret
  setInterval(oppdater, 30000);
  oppdater();
}
S.vaaken = { oppdater, aktiv, støttes };
