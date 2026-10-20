// ↩ Angre og gjenopprett for VISNINGEN.
//
// Hva som dekkes: mål, koter, skjul/vis, farger, gjennomsiktig og snitt.
// Alt dette lever bare i denne nettleseren – ingenting av det er sendt til
// SharePoint, Workeren eller andre brukere.
//
// Markeringer dekkes (kontorsiden): «Markering plassert» og «Markering
// slettet». Bildene og talemeldingene i SharePoint slettes IKKE med en gang
// markeringen forsvinner – da kunne angre bare gitt tilbake et tomt skall.
// Filene slettes først når angre-posten ikke kan brukes lenger, via posten sin
// forkast()-krok (se under), og bare hvis markeringen fortsatt ikke finnes.
// Byggeplass-siden (lettmodus) har ingen angre for markeringer: montøren kan
// verken plassere eller slette dem der, og en hendelse som er sendt til
// Workerens innboks kan ikke hentes tilbake.
//
// Hva som IKKE dekkes, og hvorfor:
//   • Kamera       – bevegelse er sammenhengende, ikke en handling. Ctrl+Z
//                    ville nesten alltid angret en kamerabevegelse i stedet
//                    for det brukeren mente. Kameraet lagres i STEDET som
//                    metadata på hver post, så visningen hopper dit ved angre
//                    og du SER hva som ble angret.
//   • Valg         – endres flere ganger i sekundet og ville druknet resten.
//
// Prinsipp: en angre-post kaller de SAMME funksjonene som den opprinnelige
// handlingen. S har ingen reaktivitet – knapper, paneler og .active-klasser
// oppdateres for hånd overalt – så å røre S direkte ville gitt en tilstand
// som ikke stemmer med det som vises.

import { $, på, S } from "./state.js";
import { t } from "./i18n.js";
import { camera, controls } from "./scene.js";

const MAKS = 40;   // eldste post faller ut; snapshots av S.appear er små, men ikke gratis

const angreStabel = [];
const gjenStabel = [];

// ---------- Kameraet som metadata ----------
function kameraNå() {
  return {
    p: [camera.position.x, camera.position.y, camera.position.z],
    m: [controls.target.x, controls.target.y, controls.target.z]
  };
}

function tilKamera(k) {
  if (!k) return;
  // Bare hopp hvis brukeren faktisk har flyttet seg et stykke siden. Ellers
  // rykker bildet uten grunn på hver eneste angring.
  const d = Math.hypot(camera.position.x - k.p[0], camera.position.y - k.p[1], camera.position.z - k.p[2]);
  if (d < S.modelSize * 0.02) return;
  camera.position.set(k.p[0], k.p[1], k.p[2]);
  controls.target.set(k.m[0], k.m[1], k.m[2]);
}

// ---------- Stabelen ----------

// post = { tekst, angre(), gjenopprett(), forkast?(grunn) }
//
// forkast(grunn) er valgfri og kalles NÅR POSTEN ER BORTE FOR GODT, så den
// kan rydde opp det angre holdt i live (f.eks. bildefilene til en slettet
// markering). grunn er «full» (dyttet ut over MAKS), «ny-handling»
// (gjenopprett-stabelen ble ugyldig) eller «modellbytte» (nullstillAngre).
// Den kalles aldri for en post som fortsatt ligger i en av stablene.
// Kalles via S.pushAngre fra de andre modulene, så ingen av dem trenger å
// importere denne fila (samme mønster som S.onModelLoaded og S.syncPrefs).
// Sant mens vi selv spiller av en post. Uten dette ville en angre-funksjon som
// kaller den vanlige veien (f.eks. hideElements) lagt inn ENDA en post, og
// stabelen ville aldri tømt seg.
let spillerAv = false;

// Kaller postens forkast-krok. En krok som kaster skal aldri ta med seg
// stabelen – den er opprydding, ikke selve handlingen.
function kast(post, grunn) {
  if (!post || typeof post.forkast !== "function") return;
  try { post.forkast(grunn); }
  catch (err) { console.warn("Opprydding etter angre-post feilet «" + post.tekst + "»:", err); }
}

// Svarer true når posten ble lagt inn. false = ignorert (under avspilling
// eller ugyldig post) – da vet den som kalte at forkast aldri vil bli kalt,
// og må rydde selv.
export function leggTilAngre(post) {
  if (spillerAv) return false;
  if (!post || typeof post.angre !== "function" || typeof post.gjenopprett !== "function") return false;
  post.kamera = kameraNå();
  angreStabel.push(post);
  if (angreStabel.length > MAKS) kast(angreStabel.shift(), "full");
  // Ny handling gjør gjenopprett-stabelen ugyldig – den bygde på en historikk
  // som ikke lenger finnes.
  const ugyldige = gjenStabel.splice(0);
  ugyldige.forEach(p => kast(p, "ny-handling"));
  oppdaterKnapper();
  return true;
}

// Kaster en angre-funksjon, skal posten IKKE forsvinne: før ble den tatt av
// stabelen og var borte uten et ord, så brukeren trodde Ctrl+Z hadde virket.
// Nå legges den tilbake der den lå, og boblen sier fra. Noen poster er
// asynkrone (snittet venter på geometri) — de gir et løfte, og et løfte som
// feiler håndteres likt: posten flyttes tilbake og brukeren får beskjed.
function spill(post, fn, fra, til, feilMal, logg) {
  spillerAv = true;
  let ret;
  try { ret = fn(); }
  catch (err) {
    console.warn(logg + " «" + post.tekst + "»:", err);
    fra.push(post);
    oppdaterKnapper();
    visMelding(t(feilMal, t(post.tekst)));
    return false;
  }
  finally { spillerAv = false; }
  if (ret && typeof ret.then === "function") {
    ret.then(null, (err) => {
      console.warn(logg + " «" + post.tekst + "»:", err);
      // Bare hvis posten fortsatt ligger øverst — har brukeren gjort noe annet
      // i mellomtiden, er stabelen en annen, og da rører vi den ikke.
      if (til[til.length - 1] === post) { til.pop(); fra.push(post); }
      oppdaterKnapper();
      visMelding(t(feilMal, t(post.tekst)));
    });
  }
  return true;
}

export function angre() {
  const post = angreStabel.pop();
  if (!post) return;
  const etterpå = kameraNå();
  if (!spill(post, () => post.angre(), angreStabel, gjenStabel, "Kunne ikke angre: {0}", "Kunne ikke angre")) return;
  post.kameraEtter = etterpå;
  tilKamera(post.kamera);
  gjenStabel.push(post);
  oppdaterKnapper();
  visMelding(t("Angret: {0}", t(post.tekst)));
}

export function gjenopprett() {
  const post = gjenStabel.pop();
  if (!post) return;
  if (!spill(post, () => post.gjenopprett(), gjenStabel, angreStabel, "Kunne ikke gjenopprette: {0}", "Kunne ikke gjenopprette")) return;
  tilKamera(post.kameraEtter);
  angreStabel.push(post);
  oppdaterKnapper();
  visMelding(t("Gjenopprettet: {0}", t(post.tekst)));
}

// Tømmes ved modellbytte. Kalles fra nullstillModellState() i state.js, så den
// kan ikke glemmes – postene peker på mesh og element-ID-er fra forrige modell.
export function nullstillAngre() {
  const alle = angreStabel.splice(0).concat(gjenStabel.splice(0));
  alle.forEach(p => kast(p, "modellbytte"));
  oppdaterKnapper();
}

// ---------- Knappene ----------
// Samme mønster som «Vis alle»: display:none til det finnes noe å gjøre.
export function oppdaterKnapper() {
  const a = $("btnAngre"), g = $("btnGjenopprett");
  if (a) {
    a.style.display = angreStabel.length ? "" : "none";
    const sis = angreStabel[angreStabel.length - 1];
    a.title = sis ? t("Angre: {0}", t(sis.tekst)) : t("Angre");
  }
  if (g) {
    g.style.display = gjenStabel.length ? "" : "none";
    const sis = gjenStabel[gjenStabel.length - 1];
    g.title = sis ? t("Gjenopprett: {0}", t(sis.tekst)) : t("Gjenopprett");
  }
}

// Kort kvittering, så brukeren vet HVA som ble angret. Egen boble og ikke
// #status: den viser elementtallet, og er dessuten skjult under 640 px – altså
// nettopp der montøren ikke har Ctrl+Z og trenger tilbakemeldingen mest.
let meldingTimer = null;
const boble = document.createElement("div");
boble.style.cssText = "position:fixed; left:50%; bottom:22px; transform:translateX(-50%);" +
  "background:rgba(20,24,31,.94); color:#e6ebf2; border:1px solid #2c3442; border-radius:10px;" +
  "padding:8px 14px; font-size:13px; z-index:60; pointer-events:none; display:none";
boble.setAttribute("role", "status");
boble.setAttribute("aria-live", "polite");
document.body.appendChild(boble);

function visMelding(tekst) {
  boble.textContent = tekst;
  boble.style.display = "block";
  clearTimeout(meldingTimer);
  meldingTimer = setTimeout(() => { boble.style.display = "none"; }, 2200);
}

// ---------- Ferdige posttyper, til bruk fra de andre modulene ----------

// Objekter lagt til i en three.js-gruppe (mål, koter). Group.clear() og
// .remove() disposer ikke, så referansene er trygge å holde på.
export function postLagtTil(gruppe, objekter, tekst) {
  const liste = objekter.slice();
  return {
    tekst,
    angre: () => liste.forEach(o => gruppe.remove(o)),
    gjenopprett: () => liste.forEach(o => gruppe.add(o))
  };
}

// En gruppe som ble tømt (Tøm mål / Tøm koter)
export function postTømt(gruppe, barn, tekst) {
  const liste = barn.slice();
  return {
    tekst,
    angre: () => liste.forEach(o => gruppe.add(o)),
    gjenopprett: () => liste.forEach(o => gruppe.remove(o))
  };
}

// Generell før/etter-post der begge tilstandene kan settes med samme funksjon
export function postTilstand(før, etter, sett, tekst) {
  return { tekst, angre: () => sett(før), gjenopprett: () => sett(etter) };
}

S.pushAngre = leggTilAngre;
S.nullstillAngre = nullstillAngre;

på("btnAngre", "click", angre);
på("btnGjenopprett", "click", gjenopprett);

oppdaterKnapper();
