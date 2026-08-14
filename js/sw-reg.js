// Registrerer service workeren, og varsler montøren når en ny versjon står klar.
//
// HVORFOR REGISTRERINGEN LIGGER I EN EGEN FIL: den er det ENESTE stedet i
// koden som vet at /sw.js finnes. Skal service workeren skrus av — i en
// feilsøking, eller fordi noe viser seg å være galt — er det én linje her,
// ikke et søk gjennom lett-main.js.
//
// FILA LASTES MED DYNAMISK import() FRA lett-main.js, og det er en rettelse
// etter en ekte feil: da fila ikke ble med i en push, stoppet en vanlig import
// HELE modulkjeden. Byggeplass-siden så normal ut — logo, knapper, kodefelt —
// men ingenting virket, og «JavaScript kjører ikke» ble stående. Offline er en
// bonus; å se modellen er jobben. En bonus skal ikke kunne ta ned jobben.
//
// BARE LETTMODUS. Det interne verktøyet (index.html) kjører på et annet
// domene, uten proxy, og har ingen bruk for offline.
//
// ---------------------------------------------------------------------------
// updateViaCache: "none" ER IKKE PYNT.
// Proxyen setter Cache-Control: max-age=300 på alt som ikke er /vendor/, og
// det gjelder også /sw.js. Uten dette valget kan nettleseren svare på
// oppdateringssjekken fra sin egen HTTP-cache, og en push blir usynlig i opptil
// fem minutter — lenger på en treg mobilcache. Med "none" hentes selve
// sw.js-fila alltid ferskt.
//
// INGEN AUTOMATISK OVERTAKELSE.
// Når en ny service worker er installert, står den som «waiting» til alle faner
// med den gamle er lukket. Vi framskynder det ALDRI av oss selv: da kunne en
// side som allerede har lastet gamle moduler få nye i neste henting, og halve
// appen ville vært fra hver versjon. I stedet får montøren en knapp.
// ---------------------------------------------------------------------------

import { LETT } from "./lett.js";
import { meldNyVersjon } from "./nett.js";

export let swVersjon = "";

function klarTilBytte(ventende) {
  // Knappen tegnes av js/nett.js, i samme boks som resten av nettstatusen.
  // Bytte skjer i to trinn: vi ber den ventende ta over, og laster først siden
  // på nytt når nettleseren melder at den FAKTISK har tatt over. Lastet vi med
  // en gang, ville vi like gjerne fått den gamle igjen.
  meldNyVersjon(() => ventende.postMessage({ type: "hopp-over-venting" }));
}

function start() {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      // Står det allerede en ventende ved oppstart, har en tidligere økt
      // installert den uten at noen trykket. Vis knappen med en gang.
      if (reg.waiting && navigator.serviceWorker.controller) klarTilBytte(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const ny = reg.installing;
        if (!ny) return;
        ny.addEventListener("statechange", () => {
          // «installed» MED en controller betyr oppdatering. Uten controller
          // er det førstegangsinstallasjonen, og da skal ingen varsles om
          // noe — montøren har jo nettopp åpnet sida.
          if (ny.state === "installed" && navigator.serviceWorker.controller) klarTilBytte(ny);
        });
      });
    })
    .catch(() => {
      // Registreringen kan feile helt legitimt: privat nettlesing i Safari,
      // eller /sw.js som ikke slipper gjennom proxyens hvitliste. Da skal
      // resten av verktøyet virke akkurat som før — uten offline, men uten
      // en feilmelding montøren ikke kan gjøre noe med.
    });

  // Nettleseren har byttet service worker. Nå — og bare nå — er det trygt
  // å laste siden på nytt.
  let lastet = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (lastet) return;
    lastet = true;
    location.reload();
  });

  // Hvilken versjon kjører telefonen? Svaret legges på window slik at du kan
  // spørre montøren «hva står det der» i stedet for å gjette.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "versjon") {
      swVersjon = String(e.data.versjon || "");
      window.STORM_SW_VERSJON = swVersjon;
    }
  });
  navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "hvilken-versjon" });
    }
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// NÅR start() KJØRER — OG HVORFOR DET IKKE ER «addEventListener("load")» ALENE.
//
// Registreringen bør vente på «load»: konkurrerer den med modellhentingen om
// båndbredden på en telefon med én strek, er det modellen som skal vinne —
// montøren står og venter på den.
//
// MEN denne fila lastes med dynamisk import() fra lett-main.js. Den importen
// starter en ny henting, og den hentingen kan fullføres ETTER at «load» har
// gått. Da fester vi en lytter på en hendelse som allerede er over, start()
// kjører aldri, og ingen service worker blir registrert — i det stille.
//
// Symptomet er nøyaktig det Emil så på telefonen: alt virker så lenge fana
// står åpen, men laster han siden på nytt uten dekning, sier Safari «iPhonen
// mangler internett-forbindelse». Det ser ut som en Safari-begrensning. Det er
// det ikke — det er denne kappløpet.
//
// Derfor: har «load» alt gått (readyState === "complete"), kjør nå. Ellers vent.
if (LETT && typeof navigator !== "undefined" && navigator.serviceWorker) {
  if (typeof document !== "undefined" && document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}
