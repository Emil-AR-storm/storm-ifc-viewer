// 🧾 MATERIELL-LISTA TIL SW-GENERATOREN (Emil 08.09, sjekkliste punkt 5).
// Rene tallfunksjoner uten avhengigheter — testes i Node med ekte tall
// (_test/test-sw-materiell.mjs) og brukes av veggelement.js til arket
// «Materiell» i samme Excel-fil som SW-lista.
//
// Én kolonne per fasade, én per innervegg, og en total. Emil bestiller på
// totalen, men ser hvor forbruket kommer fra. BARE SYNLIGE ELEMENTER TELLER —
// et element som er dratt bort er ikke kjøpt.
//
// Reglene, ord for ord fra byggeordren:
//   1. Skrue veggelement: 6 per element i midtfelt, 8 per element i endefelt
//      (feltet som møter et bygghjørne). Fasit: 4 høyt × 5 bredt = 20 element,
//      12 × 6 + 8 × 8 = 136.
//   2. Beslag, løpemeter per fasade: topp + bunn (lengden én gang hver) +
//      høyden per loddrett kant. Et hjørne telles ÉN gang — ett hjørnebeslag
//      dekker begge fasadene. En fri ende teller også én gang.
//   3. Skrue beslag: 8 per 2,5 lm → ceil(lm / 2,5) × 8. Egen rad.
//   4. Hatprofil per utsparing: Vindu 2 × (b + h); Port og Dør 2 × h + b.
//      Vindu 2000 × 4000 → 12 lm. Dør 5000 høy × 3000 bred → 13 lm.
//   5. Skrue hatprofil: 8 per 2,5 lm. Egen rad.
//   6. Skum i bokser: bare LODDRETTE skjøter. Skjøtmeter = høyde × antall
//      innvendige skjøter (skjot.length − 2). Utbytte per boks: 15 m ved
//      element ≥ 160 mm, 20 m under — settbart per prosjekt.

export const SKRUER_MIDTFELT = 6;
export const SKRUER_ENDEFELT = 8;
export const SKRUER_PER_BESLAG = 8;      // per 2,5 lm
export const BESLAG_LENGDE_M = 2.5;
export const SKUM_TYKK_GRENSE_MM = 160;
export const SKUM_UTBYTTE_TYKK_M = 15;   // element ≥ 160 mm (Emil: 15–20 m på 200)
export const SKUM_UTBYTTE_TYNN_M = 20;   // element < 160 mm (Emil: 20–30 m på 120)

// Beslag rundt åpningen: Dør og Port har ingen bunn (3 sider), Vindu har 4.
export function beslagSider(type) { return type === "vindu" ? 4 : 3; }

// Hatprofil rundt én åpning, i meter.
export function hatprofilM(type, breddeMm, hoydeMm) {
  const b = Math.max(0, Number(breddeMm) || 0) / 1000, h = Math.max(0, Number(hoydeMm) || 0) / 1000;
  return beslagSider(type) === 4 ? 2 * (b + h) : 2 * h + b;
}

// 8 skruer per påbegynt 2,5 m beslag/hatprofil.
export function skruerForLm(lm) {
  const m = Number(lm) || 0;
  return m <= 0 ? 0 : Math.ceil(m / BESLAG_LENGDE_M - 1e-9) * SKRUER_PER_BESLAG;
}

// Standardutbyttet for skum etter elementtykkelsen. `oppsett` kan overstyre:
// { skumUtbytteTykkM, skumUtbytteTynnM }.
export function skumUtbytteM(tykkelseMm, oppsett) {
  const o = oppsett || {};
  const tykk = (Number(tykkelseMm) || 0) >= SKUM_TYKK_GRENSE_MM;
  const v = tykk ? o.skumUtbytteTykkM : o.skumUtbytteTynnM;
  const std = tykk ? SKUM_UTBYTTE_TYKK_M : SKUM_UTBYTTE_TYNN_M;
  return Number(v) > 0 ? Number(v) : std;
}

// Hvilket felt et element står i: antall innvendige skjøter til venstre for
// elementets midtpunkt. `skjot` er skjøtposisjonene i mm langs fasaden, med
// start og slutt som første og siste tall (slik lagret.fasader[i].skjot ligger).
export function feltIndeks(skjot, fraMm, tilMm) {
  const s = skjot || [];
  if (s.length < 3) return 0;
  const midt = ((Number(fraMm) || 0) + (Number(tilMm) || 0)) / 2;
  let n = 0;
  for (let i = 1; i < s.length - 1; i++) if (s[i] < midt) n++;
  return n;
}
export function antallFelt(skjot) { return Math.max(1, ((skjot || []).length || 2) - 1); }

// Er elementet i et ENDEFELT — det ytterste feltet i en ende som møter et
// hjørne? `hjorneStart`/`hjorneSlutt` sier om enden er et hjørne. En fri ende
// (innervegg som slutter i lufta) regnes som midtfelt (Emils regel).
export function erEndefelt(skjot, fraMm, tilMm, hjorneStart, hjorneSlutt) {
  const fi = feltIndeks(skjot, fraMm, tilMm), n = antallFelt(skjot);
  return (hjorneStart && fi === 0) || (hjorneSlutt && fi === n - 1);
}

// ÉN VEGG (fasade eller innervegg-bein) → tallene for kolonnen hennes.
// vegg = {
//   navn, hoydeMm, lengdeMm, tykkelseMm, skjot: [mm…],
//   hjorneStart, hjorneSlutt,         // møter enden et hjørne?
//   loddretteKanter,                  // antall loddrette beslagkanter DENNE veggen eier (0–2)
//   elementer: [{ fraMm, tilMm, skjult }],
//   utsparinger: [{ type, breddeMm, hoydeMm }]
// }
export function veggMateriell(vegg, oppsett) {
  const v = vegg || {};
  const synlige = (v.elementer || []).filter(e => e && !e.skjult);
  const hoydeM = Math.max(0, Number(v.hoydeMm) || 0) / 1000;
  const lengdeM = Math.max(0, Number(v.lengdeMm) || 0) / 1000;
  let elementer = 0, skruerElement = 0;
  for (const e of synlige) {
    elementer++;
    skruerElement += erEndefelt(v.skjot, e.fraMm, e.tilMm, !!v.hjorneStart, !!v.hjorneSlutt)
      ? SKRUER_ENDEFELT : SKRUER_MIDTFELT;
  }
  // En vegg uten et eneste synlig element er ikke kjøpt — ingenting av det
  // andre heller.
  if (!elementer) return tomKolonne(v.navn);
  const kanter = Math.max(0, Math.min(2, Number(v.loddretteKanter) || 0));
  const beslagLm = 2 * lengdeM + kanter * hoydeM;
  let hatprofilLm = 0;
  for (const u of v.utsparinger || []) if (u) hatprofilLm += hatprofilM(u.type, u.breddeMm, u.hoydeMm);
  const innvSkjoter = Math.max(0, ((v.skjot || []).length || 0) - 2);
  const skjotM = innvSkjoter * hoydeM;
  const utbytte = skumUtbytteM(v.tykkelseMm, oppsett);
  return {
    navn: v.navn || "", elementer, skruerElement,
    beslagLm: rund(beslagLm), skruerBeslag: skruerForLm(beslagLm),
    hatprofilLm: rund(hatprofilLm), skruerHatprofil: skruerForLm(hatprofilLm),
    skumSkjotM: rund(skjotM), skumUtbytteM: utbytte,
    skumBokser: skjotM > 0 ? Math.ceil(skjotM / utbytte - 1e-9) : 0,
    skumBrok: skjotM / utbytte      // til totalen: bokser summeres som brøk, rundes opp én gang
  };
}
function tomKolonne(navn) {
  return { navn: navn || "", elementer: 0, skruerElement: 0, beslagLm: 0, skruerBeslag: 0,
    hatprofilLm: 0, skruerHatprofil: 0, skumSkjotM: 0, skumUtbytteM: 0, skumBokser: 0, skumBrok: 0 };
}
const rund = (x) => Math.round(x * 100) / 100;

// Alle veggene → kolonner + total. Totalen for skruer på beslag/hatprofil
// regnes av TOTAL-løpemeteren (færre påbegynte lengder enn summen av
// kolonnene), og skumbokser av summen av brøkene — én oppruding, ikke én per
// vegg. Det er totalen Emil bestiller på.
export function materiellListe(vegger, oppsett) {
  const kolonner = (vegger || []).map(v => veggMateriell(v, oppsett));
  const sum = (k) => kolonner.reduce((a, c) => a + (c[k] || 0), 0);
  const beslagLm = sum("beslagLm"), hatprofilLm = sum("hatprofilLm"), brok = sum("skumBrok");
  const total = {
    navn: "Totalt", elementer: sum("elementer"), skruerElement: sum("skruerElement"),
    beslagLm: rund(beslagLm), skruerBeslag: skruerForLm(beslagLm),
    hatprofilLm: rund(hatprofilLm), skruerHatprofil: skruerForLm(hatprofilLm),
    skumSkjotM: rund(sum("skumSkjotM")), skumUtbytteM: null,
    skumBokser: brok > 0 ? Math.ceil(brok - 1e-9) : 0, skumBrok: brok
  };
  return { kolonner, total };
}

// Radene i arket «Materiell». `T` er oversetteren (t fra i18n.js); sendes den
// ikke inn, står norsk. Første rad er overskriften, så én rad per vare.
export const MATERIELL_RADER = [
  ["Veggelement (stk)", "elementer"],
  ["Skrue veggelement (stk)", "skruerElement"],
  ["Beslag (lm)", "beslagLm"],
  ["Skrue beslag (stk)", "skruerBeslag"],
  ["Hatprofil utsparinger (lm)", "hatprofilLm"],
  ["Skrue hatprofil (stk)", "skruerHatprofil"],
  ["Skum – loddrette skjøtmeter (m)", "skumSkjotM"],
  ["Skum – utbytte per boks (m)", "skumUtbytteM"],
  ["Skum (bokser)", "skumBokser"]
];
export function materiellRader(liste, T) {
  const tr = typeof T === "function" ? T : (s) => s;
  const { kolonner, total } = liste;
  const rader = [[tr("Materiell")].concat(kolonner.map(k => k.navn), [tr("Totalt")])];
  for (const [navn, felt] of MATERIELL_RADER) {
    rader.push([tr(navn)].concat(kolonner.map(k => tall(k[felt])), [tall(total[felt])]));
  }
  return rader;
}
// Excel skal få TALL, ikke tekst — og en tom celle der et tall ikke finnes.
function tall(v) { return (v === null || v === undefined || !isFinite(v)) ? "" : Number(v); }
