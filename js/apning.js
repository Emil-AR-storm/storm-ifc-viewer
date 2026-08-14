// 🔑 Den siste vellykkede åpningen av et prosjekt, lagret på telefonen.
//
// HVA DEN LØSER: `POST /åpne` kan ikke lykkes uten nett. Uten denne fila møter
// montøren kodeboksen, skriver koden, får «Fikk ikke kontakt» — og kommer
// aldri fram til modellen, uansett hvor godt service workeren har cachet den.
// Det var det egentlige offline-problemet; markeringene var bare det synlige.
//
// ---------------------------------------------------------------------------
// DETTE SVEKKER ADGANGSKONTROLLEN, OG DET SKAL STÅ SVART PÅ HVITT.
//
// En telefon som ÉN GANG har åpnet prosjektet kan i sju døgn åpne den cachede
// modellen uten å skrive koden — også etter at storm_bp-kaka (12 timer) er
// utløpt. Trusselen som åpnes er «noen får tak i montørens ulåste telefon».
// Trusselen koden er laget mot — «en fremmed gjetter seg fram» — er urørt:
// uten en tidligere åpning på nettopp denne telefonen finnes det ingenting å
// åpne, og modellen ligger fortsatt bak kode og rate limiting hos Workeren.
//
// Alternativet var å sjekke koden lokalt mot en lagret hash. Det ble vraket:
// en hash som ligger på telefonen sammen med en seks tegns kode er knekt på
// sekunder, så det hadde kjøpt en følelse av sikkerhet og ingen sikkerhet.
//
// SJU DØGN er valgt fordi det dekker en normal arbeidsuke pluss helg. Lenger,
// og en telefon som har vært innom prosjektet én gang i fjor er fortsatt en
// nøkkel. Kortere, og montøren som var på kurs mandag og tirsdag er låst ute.
// ---------------------------------------------------------------------------
//
// LAGRER INGEN KODE OG INGEN KAKE. Bare prosjektnummeret, modelladressene og
// tidspunktet. Adressene alene gir ingen tilgang: /modell/ krever fortsatt
// beviset fra /åpne — det er service workerens cache som svarer offline, og
// den ligger på telefonen som allerede hadde lov.

const NOKKEL = "storm-bp-apning";
export const GYLDIG_MS = 7 * 24 * 60 * 60 * 1000;

// Alt som skal ligge lagret over tid vaskes før det legges inn OG når det
// leses. Samme regel som js/vedleggko.js: en post med feil felt er verre enn
// ingen post, fordi den feiler et helt annet sted enn der den ble laget.
function vask(p) {
  if (!p || typeof p !== "object") return null;
  const prosjekt = String(p.prosjekt || "");
  if (!/^\d{5}$/.test(prosjekt)) return null;
  const modeller = (Array.isArray(p.modeller) ? p.modeller : [])
    .map(m => {
      if (!m || typeof m !== "object") return null;
      const url = String(m.url || "");
      // Bare våre egne modelladresser. Uten denne sjekken kunne en manipulert
      // localStorage fått åpneFraUrl() til å hente fra et fremmed domene.
      if (!/^\/modell\/\d{5}\/[^?]+\.glb(\?|$)/i.test(url)) return null;
      return {
        navn: String(m.navn || "").slice(0, 200),
        url,
        størrelse: Number(m.størrelse) || 0
      };
    })
    .filter(Boolean);
  if (!modeller.length) return null;
  return { prosjekt, modeller, tid: Number(p.tid) || 0 };
}

export function lagreApning(prosjekt, modeller) {
  const p = vask({ prosjekt, modeller, tid: Date.now() });
  if (!p) return null;
  try { localStorage.setItem(NOKKEL, JSON.stringify(p)); } catch (_) {}
  return p;
}

// Uten argument: den lagrede åpningen, hvis den er fersk nok.
// Med prosjektnummer: bare hvis den gjelder NETTOPP det prosjektet — ellers
// ville en montør som skanner QR-en til et nytt prosjekt fått opp modellen fra
// det forrige, og trodd at han så på riktig bygg.
export function lesApning(prosjekt) {
  let p = null;
  try { p = vask(JSON.parse(localStorage.getItem(NOKKEL))); } catch (_) { return null; }
  if (!p) return null;
  if (Date.now() - p.tid > GYLDIG_MS) return null;
  if (prosjekt && p.prosjekt !== String(prosjekt)) return null;
  return p;
}

export function glemApning() {
  try { localStorage.removeItem(NOKKEL); } catch (_) {}
}
