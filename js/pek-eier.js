// ═══════════════════════ 🎯 HVEM EIER KLIKKET? ═══════════════════════
// Materiell og rigg har hver sin pekerlytter på window i fangstfasen. De ser
// ikke hverandre, og stopPropagation() stopper ikke en annen lytter på SAMME
// mål (window). Lå et rigg-objekt bak et materiell-objekt i samme siktelinje,
// traff begge raycastene — og begge ble markert (Emils funn 25.09).
//
// Regelen er den samme som main.js bruker for SW-elementene mot modellen:
// det som ligger NÆRMEST kameraet er det du trykte på. Hvert verktøy melder
// seg på med en funksjon som svarer med avstanden til sitt nærmeste treff
// (eller null), og spør her før det velger noe.

import { S } from "./state.js";

const pekere = new Map();   // navn → (clientX, clientY) => avstand | null

export function registrerPeker(navn, avstandFn) { pekere.set(navn, avstandFn); }

// Navnet på verktøyet som har nærmeste treff under pekeren, eller null.
// Ved likt treff vinner den som meldte seg på først — da er det uansett
// samme punkt i rommet, og ett av dem må få klikket.
export function naermesteEier(x, y) {
  let best = null, bestAvstand = Infinity;
  for (const [navn, fn] of pekere) {
    let d = null;
    try { d = fn(x, y); } catch { d = null; }   // ett ødelagt verktøy skal ikke ta de andre med seg
    if (d != null && Number.isFinite(d) && d < bestAvstand) { best = navn; bestAvstand = d; }
  }
  return best;
}

// Eier `navn` punktet? Brukes rett før et verktøy velger noe: har et annet
// verktøy et nærmere treff, skal dette verktøyet oppføre seg som om klikket
// gikk i tomrommet (og velge bort sitt eget).
export function eierPunktet(navn, x, y) { return naermesteEier(x, y) === navn; }

// ═══════════════════════ 📏 MÅL, KOTE OG MARKERING ═══════════════════════
// Emil 02.10: «når du bruker måleverktøy … så kan du enda trykke inn på rigg
// objekt med et uhell». Rigg og materiell hadde «valg virker i ALLE moduser»,
// og lytterne deres ligger på window i fangstfasen — de tok trykket før
// main.js fikk sette målepunktet. I disse modusene betyr et trykk «her er et
// punkt», aldri «åpne dette objektet».
const PUNKTMODUSER = new Set(["measure", "kote", "marker"]);
export function iPunktModus() { return PUNKTMODUSER.has(S.mode); }

// …men punktet skal havne PÅ objektet du trykte på (kranfoten, toppen av
// containeren), ikke på bakken bak det. Rigg og materiell melder inn en flate
// som svarer { point, distance }; main.js tar den nærmeste av dem, modellen
// og terrenget. utenSnap: kant-snappen er laget for stålet i modellen.
const flater = new Map();   // navn → (clientX, clientY) => { point, distance } | null
export function registrerMaaleflate(navn, fn) { flater.set(navn, fn); }
export function naermesteMaaleflate(x, y) {
  let best = null;
  for (const fn of flater.values()) {
    let h = null;
    try { h = fn(x, y); } catch { h = null; }
    if (h && h.point && Number.isFinite(h.distance) && (!best || h.distance < best.distance)) best = h;
  }
  return best ? { point: best.point, distance: best.distance, utenSnap: true } : null;
}
