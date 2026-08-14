// 📶 Nettstatus for byggeplassen — tidsavbrudd på henting, og ÉN synlig linje
// som forteller montøren hva som ikke kom fram.
//
// HVORFOR DENNE FINNES. Verktøyet hadde to stille feil på dårlig dekning, og
// «stille» er det farlige ordet:
//
// 1) lastLettMarkeringer() i markers.js fanget alt i «catch (_) {}» og lot
//    S.comments stå tom. Montøren fikk opp modellen uten en eneste markering
//    og uten en eneste feilmelding — og trodde det ikke var noen. Verktøyet
//    løy med selvtillit. Det er verre enn å ikke virke i det hele tatt.
//
// 2) Ingen fetch hadde tidsavbrudd. En halvdød forbindelse verken svarer eller
//    feiler; den bare henger. På skjermen ser det ut som om verktøyet er
//    ødelagt, og montøren lukker fana og åpner den aldri igjen.
//
// DETTE ER IKKE OFFLINE-MODUS. Sida må fortsatt lastes med dekning. Fila her
// dekker det VANLIGE tilfellet — dårlig dekning — ikke ingen dekning. Ekte
// offline krever en service worker, og det er en egen runde med egen risiko.
//
// FILA EIER INGEN DATA. Køene ligger der de hører hjemme: hendelser i
// markers.js (localStorage «storm-bp-usendt»), vedlegg i vedleggko.js
// (IndexedDB). Her leses de bare for å telles. Samme grensesnitt som
// js/frist.js: én ting, ingen sideeffekter utenfor sitt eget felt.

import { LETT } from "./lett.js";
import { S } from "./state.js";
import { t } from "./i18n.js";
import { koAntall } from "./vedleggko.js";

// Seks sekunder. Ikke et rundt tall for syns skyld: kortere slår inn på en helt
// normal 3G-forbindelse i en kjeller som FAKTISK ville svart, og lengre enn
// dette har montøren allerede bestemt seg for at verktøyet er ødelagt.
export const NETT_FRIST_MS = 6000;

// Modellen får lengre frist på SVARET (ikke nedlastingen, se under): Workeren
// skal slå opp i R2 og sjekke beviset før første byte kommer.
export const MODELL_FRIST_MS = 10000;

// ---------- Henting med tidsavbrudd ----------
//
// TIDSAVBRUDDET GJELDER SVARET, IKKE NEDLASTINGEN. Timeren stoppes i det
// fetch() svarer — altså når headerne er inne — og aldri mens kroppen leses.
// Gjorde vi det motsatte, ville en 40 MB modell over dårlig dekning bli avbrutt
// midt i nedlastingen hver eneste gang, og «tidsavbrudd» hadde blitt en ny og
// verre feil enn den vi prøver å fjerne. Det vi vil fange er en forbindelse som
// aldri svarer i det hele tatt.
export async function hentMedFrist(url, opts, ms) {
  const frist = ms || NETT_FRIST_MS;
  // Nettlesere uten AbortController skal ikke miste funksjonen — de får bare
  // den gamle oppførselen, uten tidsavbrudd.
  if (typeof AbortController !== "function") return fetch(url, opts || {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), frist);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
  } catch (e) {
    // AbortError kan også komme av at nettleseren avbryter ved sidebytte. Vi
    // skiller ikke: for montøren er det samme sak — det kom ikke fram.
    if (e && e.name === "AbortError") {
      const f = new Error("Tidsavbrudd");
      f.tidsavbrudd = true;
      throw f;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Den synlige linja ----------
//
// Banneret ligger INNE i #topbar med flex-basis 100 %, ikke som et fritt
// svevende felt. Toppbaren har flex-wrap fra før, så linja legger seg på egen
// rad og baren vokser. Et fixed-posisjonert felt måtte gjettet på høyden av en
// toppbar som allerede bryter til to rader på en smal telefon — og gjettet
// feil på nøyaktig de telefonene dette er laget for.
//
// Elementet finnes bare i bygg.html. I det interne verktøyet er det null, og da
// gjør alt her ingenting. Det er med vilje: prosjektlederen sitter på kontoret
// med kabel, og en ekstra rad i toppbaren hans er bare støy.

let sisteFeil = "";
let lagretKopiTid = 0;
let nyVersjonHandling = null;

// En feil som skal stå til den er rettet. Tom streng fjerner den.
export function meldNettfeil(tekst) {
  sisteFeil = tekst || "";
  tegnNettBanner();
}

// Markeringene kom fra service workerens lager, ikke fra Workeren. Tidspunktet
// er da de sist BLE HENTET, ikke da de ble laget.
//
// HVORFOR DETTE MÅ VISES: markeringene er ferskvare. En avvikslapp som ble
// lukket i går morges står fortsatt åpen i en kopi fra i forgårs, og en montør
// som tror han ser sannheten kan gå og fikse noe som alt er fikset — eller la
// være å fikse noe som nettopp ble meldt. En kopi uten tidsstempel er ikke
// hjelpsom, den er villedende. 0 fjerner merket.
export function meldLagretKopi(tidMs) {
  lagretKopiTid = Number(tidMs) || 0;
  tegnNettBanner();
}

// «Ny versjon klar» hører hjemme i SAMME boks som resten av nettstatusen.
// Første forsøk hadde et eget felt, med den begrunnelsen at det ene sier noe
// om nettet og det andre om koden. På en telefon var det feil: to bokser som
// begge kan dukke opp nederst er to ting som kan legge seg oppå hverandre og
// oppå minikartet. Én boks som vokser er én ting å holde styr på.
// null fjerner knappen igjen.
export function meldNyVersjon(handling) {
  nyVersjonHandling = typeof handling === "function" ? handling : null;
  tegnNettBanner();
}

function klokkeslett(ms) {
  try {
    return new Date(ms).toLocaleString("no-NO",
      { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

export async function tegnNettBanner() {
  const el = typeof document !== "undefined" ? document.getElementById("nettBanner") : null;
  if (!el) return;

  let vedlegg = 0;
  try { vedlegg = await koAntall(); } catch (_) {}
  // Hendelseskøen eies av markers.js. Kroken settes der, samme mønster som
  // S.pushAngre og S.rebuildCube — en import hadde gitt sirkel
  // (markers → nett → markers).
  let hendelser = 0;
  try { hendelser = (S.tellUsendteHendelser && S.tellUsendteHendelser()) || 0; } catch (_) {}
  const usendt = vedlegg + hendelser;
  const avNett = typeof navigator !== "undefined" && navigator.onLine === false;

  const deler = [];
  let farge = "var(--warn)";

  if (sisteFeil) { deler.push(sisteFeil); farge = "var(--danger)"; }
  if (lagretKopiTid) deler.push(t("Markeringer sist hentet {0}", klokkeslett(lagretKopiTid)));
  if (avNett) deler.push(t("Ingen nett – det du gjør lagres og sendes når du får dekning."));
  if (usendt) deler.push(t("{0} ikke sendt", usendt));

  if (!deler.length && !nyVersjonHandling) {
    el.style.display = "none";
    el.textContent = "";
    settHoyde(el, 0);
    return;
  }

  el.textContent = "";
  if (deler.length) {
    const linje = document.createElement("div");
    linje.textContent = deler.join(" · ");
    linje.style.color = farge;
    el.appendChild(linje);
  }
  if (nyVersjonHandling) {
    const rad = document.createElement("div");
    rad.textContent = t("Ny versjon klar.") + " ";
    const knapp = document.createElement("button");
    knapp.type = "button";
    knapp.className = "primary";
    knapp.textContent = t("Last inn på nytt");
    knapp.onclick = () => { knapp.disabled = true; nyVersjonHandling(); };
    rad.appendChild(knapp);
    el.appendChild(rad);
    if (!deler.length) farge = "var(--accent)";
  }
  el.style.borderColor = farge;
  el.style.display = "block";
  settHoyde(el, el.offsetHeight);
}

// Minikartet, snitt-/målelinja og hintet bor også nederst. De flyttes opp av
// --nett-hoyde i css/storm.css. Høyden MÅLES i stedet for å gjettes, fordi
// teksten kan bli tre linjer på en smal telefon — og en gjettet høyde ville
// vært riktig på min skjerm og feil på montørens.
function settHoyde(el, px) {
  try {
    const rot = document.documentElement;
    // +12 px luft mellom banneret og det som skyves opp
    rot.style.setProperty("--nett-hoyde", px ? (px + 12) + "px" : "0px");
  } catch (_) {}
}

// Oppdateres når nettleseren melder fra, og ellers hvert halvminutt. Halvminutt
// og ikke hvert sekund: tellinga leser IndexedDB, og en telefon på byggeplassen
// har bedre bruk for batteriet.
//
// «online» tømmer feilmeldingen. Den er alltid en påstand om fortiden («dette
// kom ikke fram»), og når dekningen er tilbake er påstanden foreldet — køene
// tømmer seg selv, og en rød linje som blir stående etter at alt er sendt er
// den typen støy som gjør at folk slutter å lese varsler.
if (LETT && typeof addEventListener === "function") {
  addEventListener("online", () => meldNettfeil(""));
  addEventListener("offline", tegnNettBanner);
  setInterval(tegnNettBanner, 30000);
  // Første tegning etter at resten av modulene har rukket å sette krokene sine.
  setTimeout(tegnNettBanner, 0);
}
