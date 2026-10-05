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
import { camera, canvas, raycaster } from "./scene.js";

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
// containeren, et SW-element, en takplate, et blikkstykke), ikke på bakken
// bak det. Lagene melder inn en flate som svarer med et treff; main.js og
// lett-main.js tar den nærmeste av dem, modellen og terrenget.
//
// Svaret er et VANLIG raycast-treff (object, faceIndex, point, distance), så
// snappen i measure.js fester seg til hjørner og kanter på riggen og
// SW-elementene akkurat som på stålet (Emil 05.10: «rigg objekt og generert
// veggelement/takplater/blikk går ikke an og ta mål på»). Bare et lag som
// sier utenSnap: true (terrenget) slipper snappen.
const flater = new Map();   // navn → (clientX, clientY) => treff | null
export function registrerMaaleflate(navn, fn) { flater.set(navn, fn); }
export function naermesteMaaleflate(x, y) {
  let best = null;
  for (const fn of flater.values()) {
    let h = null;
    try { h = fn(x, y); } catch { h = null; }
    if (h && h.point && Number.isFinite(h.distance) && (!best || h.distance < best.distance)) best = h;
  }
  return best;
}

// Hva en måling kan feste seg på: synlige, hele flater. Ikke navnelapper
// (sprites), ikke streker, ikke halvgjennomsiktige felt som kransektoren —
// et punkt der ville sveve i lufta eller havne på bakken under sektoren.
export function kanMaalesPaa(o) {
  if (!o || !o.isMesh || o.isSprite) return false;
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (m && m.transparent && (m.opacity == null ? 1 : m.opacity) < 0.6) return false;
  return true;
}
const _fNdc = { x: 0, y: 0 };
// Ferdig flate for en hel gruppe: nærmeste treff blant barna som kan måles på.
export function gruppeFlate(gruppe) {
  return (x, y) => {
    if (!gruppe || !gruppe.visible || !gruppe.children.length) return null;
    const r = canvas.getBoundingClientRect();
    _fNdc.x = ((x - r.left) / r.width) * 2 - 1;
    _fNdc.y = -((y - r.top) / r.height) * 2 + 1;
    gruppe.updateMatrixWorld(true);
    raycaster.setFromCamera(_fNdc, camera);
    for (const h of raycaster.intersectObjects(gruppe.children, true)) if (kanMaalesPaa(h.object)) return h;
    return null;
  };
}
