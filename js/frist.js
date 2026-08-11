// ⏱ Hastegrad ut fra frist.
//
// HVORFOR EGEN FIL: nøyaktig den samme regelen brukes fire steder — ringen rundt
// markeringen i 3D, prikken i markeringslista, prikken i minikartet, og
// morgenvarselet i Cloudflare-Workeren. Lå regnestykket i markers.js, ville
// Workeren fått sin egen kopi med en gang, og da kan modellen vise gul mens
// varselet sier rød uten at noen klarer å forklare hvorfor.
//
// FILA HAR INGEN AVHENGIGHETER MED VILJE. Ingen import, ingen DOM, ingen S.
// Da kan blokka mellom SPEILET-markørene kopieres ordrett inn i worker.js (som
// ikke kan importere herfra — den deployes til Cloudflare, ikke til GitHub
// Pages), og _test/test-frist.mjs kan kjøre den i rein Node.
//
// «i dag» SENDES INN i stedet for å leses fra klokka inne i funksjonen. To
// grunner: testen kan bruke faste datoer uten å rote med systemklokka, og
// kallstedet bestemmer hvilken dag som gjelder — viktig i Workeren, som kjører
// i UTC.

// ── SPEILET KODE ───────────────────────────────────────────────────────────
// Alt mellom disse to markørene skal finnes ORDRETT likt i worker/worker.js.
// Endres den ene, MÅ den andre endres. _test/test-frist.mjs klipper ut begge,
// normaliserer blanktegn og feiler hvis de har kommet ut av takt.
//
// Ikke legg noe her som bruker DOM, import eller S — Workeren har ingen av delene.

// Standard hvis oppsett.json ikke sier noe annet.
// gul = 8: fristen er om åtte dager eller mindre.
// rod = 3: fristen er om tre dager eller mindre.
// Bevisst TO tall og ikke tre: med tre grenser oppstår det et hull («hva er 8
// dager?») som ingen oppdager før noen står med en markering i akkurat det gapet.
const STANDARD_GRENSER = { gul: 8, rod: 3 };

// Hele dager fra «iDag» til «due». Positivt = fristen er fram i tid.
//
// Regner på datodelene direkte gjennom Date.UTC, ikke på to Date-objekter i
// lokal tid. Grunnen er sommertid: natta 25.–26. oktober er 25 timer lang, og
// (b - a) / 86400000 gir da 30,96 dager mellom to datoer som er 31 dager fra
// hverandre. Math.round hadde skjult det, men bare noen ganger.
function dagerTil(due, iDag) {
  const a = String(due || "").split("-").map(Number);
  const b = String(iDag || "").split("-").map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return null;
  return (Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000;
}

// Sørger for at to tall fra en håndredigert oppsett.json er brukbare.
// Er gul mindre enn rod, er de byttet om — da hadde ingenting blitt gult.
function vaskGrenser(rå) {
  const g = rå && typeof rå === "object" ? rå : {};
  let gul = Number(g.gul), rod = Number(g.rod);
  if (!Number.isFinite(gul) || gul < 0) gul = STANDARD_GRENSER.gul;
  if (!Number.isFinite(rod) || rod < 0) rod = STANDARD_GRENSER.rod;
  gul = Math.min(365, Math.round(gul));
  rod = Math.min(365, Math.round(rod));
  if (rod > gul) { const b = rod; rod = gul; gul = b; }
  return { gul, rod };
}

// SELVE REGELEN. Alt annet i denne fila er støtte.
//
//   status «Løst»    → ingen ring. En løst sak har ingen hastegrad, og en rød
//                      ring rundt en grønn hake ville vært selvmotsigende.
//   ingen frist      → grå. IKKE grønn: «ingen har bestemt når dette skal være
//                      ferdig» er noe helt annet enn «det er god tid».
//   fristen passert  → mørkerød
//   ≤ rod dager      → rød
//   ≤ gul dager      → gul
//   ellers           → grønn
function hastegrad(c, grenser, iDag) {
  if (!c) return "ukjent";
  const g = grenser || STANDARD_GRENSER;
  if (c.status === "Løst") return "ingen";
  if (!c.due) return "ukjent";
  const d = dagerTil(c.due, iDag);
  if (d === null) return "ukjent";        // ubrukelig datotekst — grå, ikke krasj
  if (d < 0) return "forfalt";
  if (d <= g.rod) return "rod";
  if (d <= g.gul) return "gul";
  return "gronn";
}
// ── SLUTT SPEILET KODE ─────────────────────────────────────────────────────

export { STANDARD_GRENSER, dagerTil, vaskGrenser, hastegrad };

// Fargene på ringen.
//
// HARDKODET MED VILJE, og det er et unntak fra husregelen om at farger skal
// ligge i css/storm.css: ringen tegnes på et canvas som blir en tekstur inne i
// 3D-scenen, ikke på en DOM-flate. Samme presedens som STATUS i markers.js,
// som hardkoder sine tre verdier av samme grunn. Rett dette IKKE «tilbake» til
// CSS-variabler — getComputedStyle finnes ikke der teksturen tegnes.
//
// Gulen er lys (#fde047), ikke ravgul, fordi status «Åpen» allerede fyller
// bobla med #f59e0b. En ravgul ring utenpå en ravgul flate forsvinner.
//
// Utenfor den speilede blokka: Workeren skriver tekst i Teams, ikke farger.
export const HASTEGRAD = {
  ingen:   { ring: null,      navn: "Løst" },
  ukjent:  { ring: "#6b7280", navn: "Ingen frist" },
  gronn:   { ring: "#22c55e", navn: "God tid" },
  gul:     { ring: "#fde047", navn: "Nærmer seg" },
  rod:     { ring: "#ef4444", navn: "Haster" },
  forfalt: { ring: "#991b1b", navn: "Forfalt" }
};

// Rekkefølgen de skal vises i når noe sorteres eller telles. Verst først.
export const HASTEGRAD_REKKE = ["forfalt", "rod", "gul", "gronn", "ukjent", "ingen"];

// Dagens dato som YYYY-MM-DD i LOKAL tid.
//
// Ikke toISOString(): den gir UTC, og i Norge om sommeren er klokka 01:30 den
// 12. august fortsatt «11. august» i UTC. Da ville en frist satt til i dag sett
// ut som om den forfaller i morgen.
//
// Workeren har ikke denne — den kjører i UTC og bruker sin egen dato. Cron-en
// går 05:00 UTC, som er samme kalenderdag i Norge hele året.
export function iDagISO(d) {
  const n = d || new Date();
  const p = (x) => String(x).padStart(2, "0");
  return n.getFullYear() + "-" + p(n.getMonth() + 1) + "-" + p(n.getDate());
}

// Kort tekst til lista og bobla. Nøklene er norske og ligger i i18n.js.
export function fristTekst(c, grenser, iDag) {
  const h = hastegrad(c, grenser, iDag);
  if (h === "ingen" || h === "ukjent") return { hast: h, nokkel: HASTEGRAD[h].navn, arg: null };
  const d = dagerTil(c.due, iDag);
  if (d < 0)  return { hast: h, nokkel: "Forfalt for {0} dager siden", arg: -d };
  if (d === 0) return { hast: h, nokkel: "Forfaller i dag", arg: null };
  if (d === 1) return { hast: h, nokkel: "Forfaller i morgen", arg: null };
  return { hast: h, nokkel: "Forfaller om {0} dager", arg: d };
}

// Dato n dager fram i tid, som YYYY-MM-DD. Brukes til å forhåndsutfylle
// fristfeltet når kontoret lager en ny markering.
export function omDager(n, iDag) {
  const b = String(iDag || iDagISO()).split("-").map(Number);
  const d = new Date(Date.UTC(b[0], b[1] - 1, b[2]));
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  const p = (x) => String(x).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}
