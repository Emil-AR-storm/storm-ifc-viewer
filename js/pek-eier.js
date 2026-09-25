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
