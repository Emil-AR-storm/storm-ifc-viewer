// ↩ Angre og gjenopprett for VISNINGEN.
//
// Hva som dekkes: mål, koter, skjul/vis, farger, gjennomsiktig og snitt.
// Alt dette lever bare i denne nettleseren – ingenting av det er sendt til
// SharePoint, Workeren eller andre brukere.
//
// Hva som IKKE dekkes, og hvorfor:
//   • Markeringer  – de er delt. En slettet markering har alt fjernet bildene
//                    sine i SharePoint, og i lettmodus er hendelsen alt sendt
//                    til Workerens innboks. Angre ville sett ut som om det
//                    virket, men prosjektlederen fikk markeringen likevel.
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

// post = { tekst, angre(), gjenopprett() }
// Kalles via S.pushAngre fra de andre modulene, så ingen av dem trenger å
// importere denne fila (samme mønster som S.onModelLoaded og S.syncPrefs).
// Sant mens vi selv spiller av en post. Uten dette ville en angre-funksjon som
// kaller den vanlige veien (f.eks. hideElements) lagt inn ENDA en post, og
// stabelen ville aldri tømt seg.
let spillerAv = false;

export function leggTilAngre(post) {
  if (spillerAv) return;
  if (!post || typeof post.angre !== "function" || typeof post.gjenopprett !== "function") return;
  post.kamera = kameraNå();
  angreStabel.push(post);
  if (angreStabel.length > MAKS) angreStabel.shift();
  // Ny handling gjør gjenopprett-stabelen ugyldig – den bygde på en historikk
  // som ikke lenger finnes.
  gjenStabel.length = 0;
  oppdaterKnapper();
}

export function angre() {
  const post = angreStabel.pop();
  if (!post) return;
  const etterpå = kameraNå();
  spillerAv = true;
  try { post.angre(); }
  catch (err) { console.warn("Kunne ikke angre «" + post.tekst + "»:", err); oppdaterKnapper(); return; }
  finally { spillerAv = false; }
  post.kameraEtter = etterpå;
  tilKamera(post.kamera);
  gjenStabel.push(post);
  oppdaterKnapper();
  visMelding(t("Angret: {0}", t(post.tekst)));
}

export function gjenopprett() {
  const post = gjenStabel.pop();
  if (!post) return;
  spillerAv = true;
  try { post.gjenopprett(); }
  catch (err) { console.warn("Kunne ikke gjenopprette «" + post.tekst + "»:", err); oppdaterKnapper(); return; }
  finally { spillerAv = false; }
  tilKamera(post.kameraEtter);
  angreStabel.push(post);
  oppdaterKnapper();
  visMelding(t("Gjenopprettet: {0}", t(post.tekst)));
}

// Tømmes ved modellbytte. Kalles fra nullstillModellState() i state.js, så den
// kan ikke glemmes – postene peker på mesh og element-ID-er fra forrige modell.
export function nullstillAngre() {
  angreStabel.length = 0;
  gjenStabel.length = 0;
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
