// 🔢 Kolonnebokstaver og SUM-formler. Ingen avhengigheter med vilje: både
// js/elements.js (som lager radene) og js/xlsx.js (som skriver fila) trenger
// dette, og js/xlsx.js skal kunne lastes dynamisk uten å dra inn resten.

// A, B … Z, AA, AB … Regnet ut, ikke en tabell: et ark med mer enn 26 kolonner
// er ikke uvanlig, og en tabell som stopper på Z feiler stille.
export function kolBokstav(i) {
  let n = Math.floor(Number(i) || 0), s = "";
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

export function celleRef(rad, kol) { return kolBokstav(kol) + (Math.floor(rad) + 1); }

// SUMMEN SKAL VÆRE EN FORMEL, ikke et ferdig tall (Emil 03.09): da ser man i
// arket hvilke rader den kommer fra, og den holder seg riktig om noen sletter
// en rad etterpå. Området bruker «:», som betyr det samme i norsk og engelsk
// Excel — argumentskilletegnet (som ER lokalavhengig) trengs ikke i en SUM.
// `fraRad`/`tilRad` er RADNUMRE I ARKET (1-basert, som i Excel).
export function sumFormel(kolonne, fraRad, tilRad) {
  if (!(tilRad >= fraRad) || !(fraRad >= 1)) return "";
  const c = kolBokstav(kolonne);
  return "=SUM(" + c + fraRad + ":" + c + tilRad + ")";
}
