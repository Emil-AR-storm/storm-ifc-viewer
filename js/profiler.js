// 📏 Nominell vekt per meter for standard stålprofiler.
//
// HVORFOR DENNE FINNES. Vekten ble regnet som volum × tetthet, rett fra
// geometrien. Det er riktig i prinsippet og godt nok i praksis — men målt mot
// Revit på to ekte bygg lå den systematisk skjevt, og skjevheten varierte med
// profiltypen:
//
//   Hulprofiler (CFSHS)      +2 %   hjørneradiene tilnærmes utover i meshen
//   I-profiler (HEA, IPE)    −5 %   overgangsradiene flens/steg mangler
//   Sveiset HSQ             +14 %   den verste, og den er ikke til å gjette
//
// Nominell kg/m × MÅLT lengde traff derimot Revit på under 0,5 % på hver
// eneste gruppe. Det er heller ikke tilfeldig: nominell vekt er det stålverket
// leverer og det du betaler for. Geometrien er en tilnærming av profilen;
// tabellen ER profilen.
//
// DERFOR: nominell vekt er hovedkilden når profilen kjennes igjen. Geometrien
// blir kontrollen — spriker de, er det noe galt med modellen, og da skal du få
// vite det i stedet for å få et pent gjennomsnitt av to tall.
//
// KJENNER VI IKKE PROFILEN, LYVER VI IKKE. «ensidig HSQ justert» er en sveiset
// hattprofil uten katalogvekt. Den får geometrisk vekt, merket som geometri,
// så du vet at akkurat det tallet må kontrolleres for hånd.
//
// ---------------------------------------------------------------------------
// KILDENE
// I-profilene er tabellverdier (EN 10365 / gamle DIN-tabeller). De er sjekket
// mot Revits egne kg/m i Storms modeller: IPE360 57,1 · IPE400 66,3 ·
// HEA200 42,3 · HEA220 50,5 — alle stemmer eksakt.
//
// Hulprofiler, vinkler og flattstål REGNES ut i stedet for å tabelleres. Da
// dekker vi alle dimensjoner, ikke bare de vi har skrevet inn. Formlene er
// verifisert mot Revit: CFSHS 80x5, 100x5, 100x6, 140x5, 180x6 og 300x6
// treffer alle innenfor 0,3 %.
// ---------------------------------------------------------------------------

import { EGNE_PROFILER } from "./config.js";

const STÅL = 7850;   // kg/m³

// ---------- I-profiler: tabell ----------
const IPE = { 80: 6.0, 100: 8.1, 120: 10.4, 140: 12.9, 160: 15.8, 180: 18.8,
  200: 22.4, 220: 26.2, 240: 30.7, 270: 36.1, 300: 42.2, 330: 49.1, 360: 57.1,
  400: 66.3, 450: 77.6, 500: 90.7, 550: 106, 600: 122 };

const HEA = { 100: 16.7, 120: 19.9, 140: 24.7, 160: 30.4, 180: 35.5, 200: 42.3,
  220: 50.5, 240: 60.3, 260: 68.2, 280: 76.4, 300: 88.3, 320: 97.6, 340: 105,
  360: 112, 400: 125, 450: 140, 500: 155, 550: 166, 600: 178, 650: 190,
  700: 204, 800: 224, 900: 252, 1000: 272 };

const HEB = { 100: 20.4, 120: 26.7, 140: 33.7, 160: 42.6, 180: 51.2, 200: 61.3,
  220: 71.5, 240: 83.2, 260: 93.0, 280: 103, 300: 117, 320: 127, 340: 134,
  360: 142, 400: 155, 450: 171, 500: 187, 550: 199, 600: 212, 650: 225,
  700: 241, 800: 262, 900: 291, 1000: 314 };

const HEM = { 100: 41.8, 120: 52.1, 140: 63.2, 160: 76.2, 180: 88.9, 200: 103,
  220: 117, 240: 157, 260: 172, 280: 189, 300: 238, 320: 245, 340: 248,
  360: 250, 400: 256 };

// ---------- Hulprofiler: formel ----------
// Kaldformet firkant/rektangel etter EN 10219-2.
//
//   A = 2t(b + h − 2t) − (4 − π)(Ro² − Ri²)
//
// Leddet bak er materialet hjørnene «mangler» mot et skarpt hjørne. Ri = Ro − t.
//
// HJØRNERADIEN AVHENGER AV GODSTYKKELSEN — det er ikke en detalj. EN 10219-2
// setter ytre radius til
//     2,0·t   for t ≤ 6 mm
//     2,5·t   for 6 < t ≤ 10 mm
//     3,0·t   for t > 10 mm
//
// Første versjon brukte 2,0·t for ALT. Det er riktig for tynt gods, og derfor
// stemte 100x5, 100x6, 140x5 og 300x6 eksakt mot Revit. Men på Valle
// båropplager, der det står tykt gods, sprakk det:
//
//     CFSHS300x8   72,06 mot Revits 71,6   (+0,6 %,  87 kg for mye)
//     CFSHS300x10  89,04 mot Revits 88,4   (+0,7 %,  24 kg)
//     CFSHS140x8   31,86 mot Revits 31,4   (+1,5 %,  41 kg)
//
// Med riktig radius treffer alle åtte kontrollerte dimensjonene innenfor 0,1 %.
// Feilen vokser med tykkelsen, så den ville blitt verre jo tyngre bygget er —
// nettopp der en kalkyle koster mest å bomme på.
export function hulprofilKgPerM(b_mm, h_mm, t_mm) {
  const b = b_mm / 1000, h = h_mm / 1000, t = t_mm / 1000;
  if (!(b > 0 && h > 0 && t > 0) || t * 2 >= Math.min(b, h)) return 0;
  const ro = t_mm <= 6 ? 2.0 : (t_mm <= 10 ? 2.5 : 3.0);   // ytre radius / t
  // (Ro² − Ri²) med Ro = ro·t og Ri = (ro − 1)·t  ⇒  (2·ro − 1)·t²
  const A = 2 * t * (b + h - 2 * t) - (2 * ro - 1) * (4 - Math.PI) * t * t;
  return A > 0 ? A * STÅL : 0;
}

// ---------- Vinkel: formel ----------
// Uten hjørne- og kantradier. Ligger 0,5–1,2 % LAVT mot tabell, og det er
// bevisst: heller litt under enn å late som vi kjenner radiene.
export function vinkelKgPerM(b_mm, t_mm) {
  const b = b_mm / 1000, t = t_mm / 1000;
  if (!(b > 0 && t > 0) || t >= b) return 0;
  return t * (2 * b - t) * STÅL;
}

// ---------- Flattstål ----------
export function flattKgPerM(b_mm, t_mm) {
  const b = b_mm / 1000, t = t_mm / 1000;
  return b > 0 && t > 0 ? b * t * STÅL : 0;
}

const tall = (s) => Number(String(s).replace(",", "."));

// ---------------------------------------------------------------------------
// Slår opp en profil fra navnet slik det står i modellen.
//
// Navnene ser slik ut hos Storm:
//   «IPE:IPE360»                          «HE-A:HEA220»
//   «CFSHS (EN 10219-2) Column:CFSHS300x6»  «Equal L Column:L100x10»
//   «Flat Bars:Flattstål 120x8»           «RNO_EHP:ensidig HSQ justert»
//
// …og med element-ID-en på slutten i en ekte modell:
//   «CFSHS (EN 10219-2):CFSHS100x6:1234567»
// Derfor prøves leddene BAKFRA til ett treffer, ikke bare det siste.
//
// Returnerer null når profilen ikke kjennes igjen. DET ER ET RIKTIG SVAR —
// bedre enn en gjetning som ser like sikker ut som en tabellverdi.
// ---------------------------------------------------------------------------
export function profilKgPerM(navn) {
  // LEDDENE PRØVES BAKFRA. Navnet fra Revit er «Familie:Type:ElementID», og
  // første forsøk her leste bare siste ledd — altså element-ID-en. Da fant den
  // aldri en eneste profil i en ekte modell, og ALT falt tilbake på geometri.
  // Feilen var usynlig i enhetstestene, fordi navnene der var «Familie:Type»
  // uten ID. På skjermen sto det «geo» på hver eneste gruppe; det var det ene
  // sporet som fantes.
  //
  // Bakfra fordi typen står nærmere slutten enn familien: «HE-A:HEA220:98765»
  // skal treffe HEA220, ikke stoppe på «HE-A». Familieleddet inneholder ofte
  // standardnummer («EN 10219-2») — de treffer ingen av mønstrene, fordi alle
  // krever bokstavprefiks umiddelbart foran dimensjonene.
  for (const ledd of String(navn || "").split(":").reverse()) {
    const r = ettLedd(ledd.trim());
    if (r) return r;
  }
  return null;
}

function ettLedd(s) {
  if (!s) return null;

  // EGNE PROFILER FØRST. Firmaets egne verdier fra oppsett.json skal kunne
  // overstyre alt — også en katalogprofil, hvis noen har målt noe annet på et
  // konkret prosjekt. Nøkkelen sammenlignes uten hensyn til store bokstaver.
  for (const nøkkel of Object.keys(EGNE_PROFILER)) {
    if (nøkkel.toLowerCase() === s.toLowerCase()) {
      const kg = Number(EGNE_PROFILER[nøkkel]);
      if (Number.isFinite(kg) && kg > 0) return { kgPerM: kg, profil: nøkkel, kilde: "egen" };
    }
  }

  let m;

  // HEA / HEB / HEM — «HEA220», «HE-A 220», «HEB 200»
  m = s.match(/\bHE\s*-?\s*([ABM])\s*(\d{2,4})\b/i);
  if (m) {
    const tab = { a: HEA, b: HEB, m: HEM }[m[1].toLowerCase()];
    const kg = tab[Number(m[2])];
    if (kg) return { kgPerM: kg, profil: "HE" + m[1].toUpperCase() + m[2], kilde: "tabell" };
    return null;   // kjent familie, ukjent dimensjon – da gjetter vi ikke
  }

  // IPE
  m = s.match(/\bIPE\s*(\d{2,4})\b/i);
  if (m) {
    const kg = IPE[Number(m[1])];
    return kg ? { kgPerM: kg, profil: "IPE" + m[1], kilde: "tabell" } : null;
  }

  // Rektangulært hulprofil: CFRHS 200x100x6
  m = s.match(/\bC?F?RHS\s*(\d{2,4})\s*[x×]\s*(\d{2,4})\s*[x×]\s*(\d{1,2}(?:[.,]\d)?)\b/i);
  if (m) {
    const kg = hulprofilKgPerM(tall(m[2]), tall(m[1]), tall(m[3]));
    return kg ? { kgPerM: kg, profil: "RHS" + m[1] + "x" + m[2] + "x" + m[3], kilde: "formel" } : null;
  }

  // Kvadratisk hulprofil: CFSHS100x6, SHS 100x6
  m = s.match(/\bC?F?SHS\s*(\d{2,4})\s*[x×]\s*(\d{1,2}(?:[.,]\d)?)\b/i);
  if (m) {
    const b = tall(m[1]), t = tall(m[2]);
    const kg = hulprofilKgPerM(b, b, t);
    return kg ? { kgPerM: kg, profil: "SHS" + m[1] + "x" + m[2], kilde: "formel" } : null;
  }

  // NORDISK BETEGNELSE PÅ SAMME PROFIL: KFHUP / HUP.
  // «KFHUP» = Kaldformet firkant hulprofil. Det ER en CFSHS — bare skrevet på
  // nordisk, slik Ferro og andre stålverk gjør det. Uten dette mønsteret falt
  // hele stålet på Lagerbygg Brenna tilbake på geometri: fem grupper, +2,3 til
  // +5,1 % mot Rambølls materialliste, 351 kg for mye på 27 tonn.
  //
  // Rektangulær form (KFHUP200X100X6) MÅ stå før den kvadratiske, ellers
  // spiser den kvadratiske de to første tallene og leser 100 som godstykkelse.
  m = s.match(/\b(?:KF)?HUP\s*(\d{2,4})\s*[x×]\s*(\d{2,4})\s*[x×]\s*(\d{1,2}(?:[.,]\d)?)\b/i);
  if (m) {
    const kg = hulprofilKgPerM(tall(m[2]), tall(m[1]), tall(m[3]));
    return kg ? { kgPerM: kg, profil: "HUP" + m[1] + "x" + m[2] + "x" + m[3], kilde: "formel" } : null;
  }
  m = s.match(/\b(?:KF)?HUP\s*(\d{2,4})\s*[x×]\s*(\d{1,2}(?:[.,]\d)?)\b/i);
  if (m) {
    const b = tall(m[1]), t = tall(m[2]);
    const kg = hulprofilKgPerM(b, b, t);
    return kg ? { kgPerM: kg, profil: "HUP" + m[1] + "x" + m[2], kilde: "formel" } : null;
  }

  // Flattstål / flat bar: «Flattstål 120x8»
  m = s.match(/\b(?:flatt?st[åa]l|flat\s*bar)\s*(\d{2,4})\s*[x×]\s*(\d{1,3}(?:[.,]\d)?)\b/i);
  if (m) {
    const kg = flattKgPerM(tall(m[1]), tall(m[2]));
    return kg ? { kgPerM: kg, profil: "Flattstål " + m[1] + "x" + m[2], kilde: "formel" } : null;
  }

  // Likesidet vinkel: L100x10. MÅ stå sist av x-mønstrene, og L-en må stå
  // alene — ellers spiser den «…L» inne i andre navn.
  m = s.match(/(?:^|[\s:_-])L\s*(\d{2,3})\s*[x×]\s*(\d{1,2}(?:[.,]\d)?)\b/i);
  if (m) {
    const kg = vinkelKgPerM(tall(m[1]), tall(m[2]));
    return kg ? { kgPerM: kg, profil: "L" + m[1] + "x" + m[2], kilde: "formel" } : null;
  }

  return null;
}
