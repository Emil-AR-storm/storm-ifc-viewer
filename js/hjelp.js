// ❓ Hjelp: en liten bunke kort du blar gjennom.
//
// ---------------------------------------------------------------------------
// HVORFOR KORT OG IKKE BOBLER SOM PEKER PÅ KNAPPENE
//
// Den vanlige løsningen er «coach marks»: mørkt slør over skjermen, én knapp
// lyst opp om gangen, en boble ved siden av. Den er bedre pedagogisk — og den
// ville vært feil her. To mekanismer flytter knappene under føttene på oss:
// `js/mobile.js` flytter alt utenom fire knapper inn i ⋯-menyen under 640 px,
// og `js/verktoygrupper.js` skjuler alle knapper som ikke er i den valgte
// gruppa. En boble som peker på «Mengder» ville pekt på tomrom for den som
// står i gruppa Mål på en telefon — og det ser ut som en feil i appen, ikke
// som en hjelp.
//
// Kortene er hele skjermbilder. De kan ikke peke feil.
//
// HVORFOR TEKSTEN BYGGES I JS OG IKKE STÅR I HTML-EN
//
// Knappen nederst heter «Neste» på fire av kortene og «Ferdig» på det siste.
// Sto den i HTML med data-i18n, ville oversettDom() ved språkbytte lest
// data-no («Neste») og skrevet den tilbake over «Ferdig». Derfor tegnes hele
// kortet av tegn(), og i18n.js kaller S.rebuildHjelp ved språkbytte — samme
// mønster som ViewCube, som har nøyaktig samme problem.
//
// HVORFOR TO KORTSTOKKER
//
// Montøren og prosjektlederen møter to forskjellige verktøy. Montøren har ikke
// Bibliotek, Rapport eller BCF i det hele tatt (skjult i lettmodus), og et kort
// om en knapp som ikke finnes er verre enn ingen hjelp. `hvor` på hvert kort
// avgjør hvem som ser det.
// ---------------------------------------------------------------------------
import { $, S, ikon, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";

// hvor: "bygg" = byggeplass-siden, "kontor" = index.html, "begge" = begge
export const KORT = [
  // ---------- Byggeplass ----------
  {
    hvor: "bygg", ikonNavn: "hjul",
    tittel: "Slik ser du deg rundt",
    tekst: "Dra med én finger for å snu modellen. To fingre flytter den og zoomer. Har du gått deg bort, trykker du Vis alt — da kommer hele bygget tilbake på skjermen."
  },
  {
    hvor: "bygg", ikonNavn: "markering",
    tittel: "Trykk på noe for å se hva det er",
    tekst: "Ett trykk på en bjelke, en vegg eller et dekke gir deg navn, type og mål. Trykk utenfor modellen for å slippe den igjen."
  },
  {
    hvor: "bygg", ikonNavn: "mikrofon",
    tittel: "Meld et avvik uten å skrive",
    tekst: "Trykk Markering, og så på stedet i modellen der feilen er. Du kan snakke inn meldingen i stedet for å skrive den, og legge ved bilde."
  },
  {
    hvor: "bygg", ikonNavn: "hake",
    tittel: "Uten dekning mister du ingenting",
    tekst: "Alt du melder legger seg i kø på telefonen og sendes av seg selv når du får nett igjen. Du kan lukke siden i mellomtiden."
  },
  {
    hvor: "bygg", ikonNavn: "innstillinger",
    tittel: "Verktøyene ligger i grupper",
    tekst: "Knappene øverst bytter hvilke verktøy verktøylinja viser. Språk og andre valg ligger under Innstillinger."
  },

  // ---------- Kontor ----------
  {
    hvor: "kontor", ikonNavn: "apne",
    tittel: "Åpne en modell",
    tekst: "Åpne henter en IFC fra maskinen din, Bibliotek henter den fra SharePoint. Du kan også dra fila rett inn i vinduet."
  },
  {
    hvor: "kontor", ikonNavn: "sok",
    tittel: "Verktøyene ligger i fire grupper",
    tekst: "Mål, Info, Utseende og Storm-Byggeplass øverst bytter hvilke verktøy verktøylinja viser. Hold musepekeren over en knapp, så står det hva den gjør."
  },
  {
    hvor: "kontor", ikonNavn: "markering",
    tittel: "Markeringene er arbeidslista",
    tekst: "En markering kan få ansvarlig, frist og en oppgave i Planner. Ringen rundt skifter farge etter hvor nær fristen er."
  },
  {
    hvor: "kontor", ikonNavn: "lastned",
    tittel: "Få modellen ut på plassen",
    tekst: "Byggeplass lager en lett kopi og en QR-kode. Montøren trenger verken app eller innlogging — bare koden."
  },
  {
    hvor: "kontor", ikonNavn: "tegning",
    tittel: "Ta arbeidet ut igjen",
    tekst: "Rapport gir en PDF med bilder og status. BCF-eksport gir en fil som Solibri, Dalux og Revit kan åpne."
  }
];

// ═══════════════════════ REN LOGIKK ═══════════════════════

// Hvilke kort gjelder for denne utgaven? `lett` = byggeplass-siden.
export function kortFor(lett) {
  const min = lett ? "bygg" : "kontor";
  return KORT.filter(k => k.hvor === "begge" || k.hvor === min);
}

// Neste/forrige med stopp i begge ender. Egen funksjon fordi feilen man gjør
// her — å la indeksen gå til -1 eller forbi siste kort — gir et tomt kort uten
// at noe kaster, og et tomt kort ser ut som at appen har hengt seg.
export function gaTil(indeks, steg, antall) {
  if (!(antall > 0)) return 0;
  const n = Number(indeks) || 0;
  return Math.max(0, Math.min(antall - 1, n + (Number(steg) || 0)));
}

// Skal gjennomgangen komme av seg selv? Bare på byggeplass-siden, og bare
// første gang på denne telefonen. Prosjektlederen sitter ved siden av den som
// bygget verktøyet; montøren gjør ikke det, og han trykker aldri på et
// spørsmålstegn han ikke vet finnes.
export function skalVisesAvSegSelv(lett, alleredeVist) {
  return !!lett && !alleredeVist;
}

// ═══════════════════════ NETTLESER ═══════════════════════

let kort = [];
let nå = 0;

export function tegn() {
  const boks = $("hjelpKort");
  if (!boks || !kort.length) return;
  const k = kort[nå];
  const sisteKort = nå === kort.length - 1;

  const ikonEl = $("hkIkon");
  if (ikonEl) ikonEl.innerHTML = ikon(k.ikonNavn);
  const tit = $("hkTittel");
  if (tit) tit.textContent = t(k.tittel);
  const tek = $("hkTekst");
  if (tek) tek.textContent = t(k.tekst);

  const prikker = $("hkPrikker");
  if (prikker) prikker.innerHTML = kort.map((_, i) =>
    '<span class="hk-prikk' + (i === nå ? " på" : "") + '"></span>').join("");

  const forrige = $("hkForrige");
  if (forrige) {
    forrige.textContent = t("Forrige");
    // Borte, ikke bare låst, på det første kortet: en grå knapp som ikke gjør
    // noe er et spørsmål brukeren må bruke tid på å svare seg selv på. Og med
    // display: none fyller «Neste» hele bredden på kort 1 — den største
    // trykkflaten akkurat der en førstegangsbruker skal komme i gang.
    forrige.style.display = nå === 0 ? "none" : "";
  }
  const neste = $("hkNeste");
  if (neste) neste.textContent = sisteKort ? t("Ferdig") : t("Neste");

  const teller = $("hkTeller");
  if (teller) teller.textContent = t("{0} av {1}", nå + 1, kort.length);
}

export function apneHjelp(start) {
  const boks = $("hjelpKort");
  if (!boks) return;
  kort = kortFor(LETT);
  if (!kort.length) return;
  nå = gaTil(Number(start) || 0, 0, kort.length);
  tegn();
  boks.classList.add("open");
  const knapp = $("btnHjelp");
  if (knapp) knapp.classList.add("active");
}

export function lukkHjelp() {
  const boks = $("hjelpKort");
  if (boks) boks.classList.remove("open");
  const knapp = $("btnHjelp");
  if (knapp) knapp.classList.remove("active");
  // Har du sett den én gang, skal den ikke komme av seg selv igjen — uansett
  // om du bladde til siste kort eller lukket på kort 1. Den som lukker har
  // svart på spørsmålet.
  if (!S.settings.hjelpVist) { S.settings.hjelpVist = true; writePrefs(); }
}

export function erApen() {
  const boks = $("hjelpKort");
  return !!(boks && boks.classList.contains("open"));
}

function bytt(steg) {
  const forrigeIndeks = nå;
  nå = gaTil(nå, steg, kort.length);
  if (nå === forrigeIndeks && steg > 0) { lukkHjelp(); return; }   // sto på siste = Ferdig
  tegn();
}

// Språkbytte: i18n.js kaller denne. Uten den ville kortet blitt stående på
// forrige språk til man bladde videre.
S.rebuildHjelp = () => { if (erApen()) tegn(); };

// Kalles av afterLoad() i ifc.js når en modell er ferdig lastet. Grunnen til at
// den ligger på en krok og ikke på en import: hjelp.js skal ikke kjenne til
// lastingen, og ifc.js skal ikke kjenne til kortene.
S.visForsteHjelp = () => {
  if (skalVisesAvSegSelv(LETT, S.settings.hjelpVist)) apneHjelp(0);
};

const knapp = $("btnHjelp");
if (knapp) knapp.addEventListener("click", () => { erApen() ? lukkHjelp() : apneHjelp(0); });

const neste = $("hkNeste");
if (neste) neste.addEventListener("click", () => bytt(1));
const forrige = $("hkForrige");
if (forrige) forrige.addEventListener("click", () => bytt(-1));
const lukk = $("hkLukk");
if (lukk) lukk.addEventListener("click", lukkHjelp);

// Trykk på sløret utenfor kortet lukker. Sjekken på e.target er det som skiller
// «trykket utenfor» fra «trykket på kortet» — uten den lukket hvert trykk på
// selve teksten hele gjennomgangen.
const overlegg = $("hjelpKort");
if (overlegg) overlegg.addEventListener("click", (e) => { if (e.target === overlegg) lukkHjelp(); });

// Piltaster på PC. Esc håndteres i ui.js sammen med resten av lukkingen, så
// rekkefølgen mellom paneler, dialoger og denne står ett sted.
window.addEventListener("keydown", (e) => {
  if (!erApen()) return;
  if (e.key === "ArrowRight") { e.preventDefault(); bytt(1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); bytt(-1); }
});
