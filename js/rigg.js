// 🏕 Rigg — VERKTØYET. Panelet, plasseringen på bakken, flytt, roter,
// rediger, skjul og slett — og lagringen, lokalt og i SharePoint.
// Importeres BARE fra main.js — bygg.html (lettmodus) laster aldri denne fila;
// der finnes bare visningen (rigg-vis.js).
//
// PEKELOGIKKEN er den samme som i materiell.js (les toppen av den fila):
//  · lytterne ligger på window i FANGSTFASEN
//  · svelger vi et pointerup, sendes et syntetisk pointercancel til canvas
//    (slippKamera) — ellers låser kameraet seg i rotasjon
//  · et KLIKK (under 8 px) på et rigg-objekt velger det, i alle moduser
//  · et DRAG som ikke starter på et rigg-objekt er kameraets, og røres aldri
//  · drag av et objekt starter bare i rigg-modus
//
// BAKKEN. Objektene skal stå på bakken, ikke på taket av bygget: pekeren
// treffer terrenget og plata (evnen «flate» i terreng.js). Treffer den bygget
// først, havner objektet ved foten av veggen. Uten terreng treffes gulvplanet.
//
// 🚧 BYGGEGJERDET (trinn 3–4) har tre ting ekstra, alle bare i rigg-modus:
//  · markeringsboksen: dra en firkant på bakken → gjerde langs omrisset
//  · skjøtene: prikker som kan dras; dobbeltklikk på et panel gir ny skjøt,
//    Delete (eller knappen) fjerner den valgte
//  · paneler: klikk på to paneler ved siden av hverandre → «Gjør om til port»
//
// ➜ PILENE (trinn 5) tegnes punkt for punkt: klikk på bakken for hvert knekk-
// punkt, dobbeltklikk (eller Enter / «Ferdig pil») for å avslutte. Etterpå
// virker prikkene akkurat som på gjerdet — dra, shift-klikk, dobbeltklikk for
// nytt punkt og Delete — men pila er en åpen linje uten paneler og porter.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, flyTil, frameHooks, raycaster, scene } from "./scene.js";
import { eierPunktet, iPunktModus, registrerPeker } from "./pek-eier.js";
import { pick, pickFlate } from "./elements.js";
import { flettPaaId, flettPaaNavn, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import { foldSeksjoner } from "./seksjoner.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import { riggIkon } from "./rigg-ikoner.js";
import {
  MAKS_ETASJER, MAKS_MODULER, REF_ID, RIGG_FORKLARING, RIGG_REKKEFOLGE, RIGG_TYPER, ROT_STEG,
  byggTilRigg, enTilLokal, fjernSkjoter, flyttSkjoter, gjerdeFraRektangel, gjerdeMengder, gjerdeStykker,
  gjorOmTilPort, gjorTilbake, leggTilSkjot, naboStykker, nyRiggId, normVinkel, riggAntall, riggObjekter,
  riggTelling, trengerOpplasting, vaskRiggListe, vaskRiggObjekt, erGjerde, MALESTOKKER, riggplanDekning, vaskMalestokkValg, erPil, minPunkter, parkeringsPlasser, pilFraPunkter, pilLengde,
  RIGGPLAN_NAVN_MAKS, riggFraLagret, riggOyeblikk, riggplanSammendrag, AVFALLSTYPER, avfallstype,
  KRAN_MAKS_H, KRAN_MAKS_R, KRAN_MIN_R, draSektor, kranSektor, vinkelTil
} from "./rigg-regn.js";
import {
  aktivRef, byggRiggObjekt, finnRiggObjekt, gjerdeDelLabel, lappStorrelse, oppdaterRiggValgEffekt, riggBase, riggGroup,
  riggTypeLabel, settGjerdeMarkering, tegnEnRigg, tegnRigg
} from "./rigg-vis.js";
import { varsel } from "./varsel.js";

// ═══════════════════════ TILSTAND ═══════════════════════
let plasserer = null;   // { o, gruppe } — objektet som henger på pekeren
let valgtId = null;
let drar = null;        // { id, fra: Vector3 } — drag i rigg-modus
let flytter = null;     // { id, fra: Vector3 } — Flytt-knappen: følger pekeren til neste trykk
let nedPos = null;
const KLIKK_PX = 8;
// 🚧 byggegjerdet
let merker = null;             // { start: Vector3|null, linje } — markeringsboksen
let skjotDrar = null;          // { id, k, punkter, flyttet } — en skjøt som dras
let valgteSkjoter = [];        // skjøtene som er valgt i det valgte gjerdet (shift-klikk gir flere)
let shiftSkjot = false;
let tegner = null;             // ➜ { type, punkter: [Vector3], linje } — pil under tegning        // pointerdown med shift traff en skjøt — pointerup skal svelges
let valgteStykker = [];        // panelene som er valgt (maks to) — til port
// 🚪 PORT-STEGET (Emil 29.09, runde 15a). Før kunne man trykke på paneler når
// som helst, og «Gjør om til port» var en grå knapp som ikke gjorde noe — man
// så ikke at man var i et eget steg, ikke hvor man skulle trykke, og «Ferdig»
// i knapperaden så ut som «lagre», men lukket raden og kastet utvalget. Nå er
// det et tydelig steg: «Port» (Emil 30.09: het «Lag port») → raden sier «trykk på 2 paneler (0 av 2)»,
// panelet under pekeren lyser → etter to naboer kommer «Gjør om til port» som
// hovedknapp. «Ferdig» er borte mens steget pågår; «Avbryt» går ut av det.
let portModus = false;
let sistSkjemaId = null;
let sistValgBarHtml = "";      // knapperaden slik den sist ble bygd (se oppdaterValgBar)      // skjemaet sist vist for (logolista hentes på nytt bare ved bytte)
let overStykke = null;         // panelet under pekeren i port-steget
// 🏗 Kranens svingsektor stilles inn (knappen «Radius» i raden): en kladd som
// tegnes mens håndtakene dras, og lagres først når man trykker «Lagre».
//   kranRed:    { id, sektorFra, sektorTil } — speiles i S.riggKranRed for rigg-vis.js
//   sektorDrar: { hvem: "fra" | "til" } — det håndtaket som holdes
let kranRed = null, sektorDrar = null;

function hentO(id) { return riggObjekter(S.rigg || []).find(o => o.id === id) || null; }

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

// ═══════════════════════ LAGRING ═══════════════════════
//
// LOKALT FØRST, SÅ SHAREPOINT (samme mønster som terreng.js og grupper.js):
// lista ligger i localStorage per modellfil, så riggen er der på denne
// maskinen uten innlogging. I SharePoint ligger den i IFC-modeller/Rigg som
// <modellfil>.rigg.json, flettet på id med gravsteiner (sp-lager.js) — to som
// rigger samtidig mister ikke hverandres brakker.
const SP_MAPPE = "Rigg";
function spFil() { return S.fileName + ".rigg.json"; }
function lsNokkel() { return "storm-ifc-rigg::" + S.fileName; }
let spStatus = "av";
let lagreTid = 0;

function lsLes() {
  try { return vaskRiggListe(JSON.parse(localStorage.getItem(lsNokkel()) || "[]")); }
  catch (_) { return []; }
}
function lsSkriv() {
  try { localStorage.setItem(lsNokkel(), JSON.stringify(S.rigg || [])); } catch (_) {}
}

// Endringer synes med en gang i Mengder, lagres lokalt straks, og samlet i
// SharePoint litt etter — et drag med tre rotasjoner blir ÉN skriving.
function planLagring() {
  if (!S.fileName) return;
  S.qtyCache = null;
  lsSkriv();
  const fil = S.fileName;
  clearTimeout(lagreTid);
  lagreTid = setTimeout(async () => {
    if (S.fileName !== fil) return;
    if (!spPaalogget()) { spStatus = "av"; visLagring(); return; }
    const res = await spSkriv(SP_MAPPE, spFil(), S.rigg || [], (p) => String(p && p.id || ""));
    if (S.fileName !== fil) return;
    spStatus = res.ok ? "ok" : "feil";
    // Svaret er lista flettet med kollegaenes poster. Tegnes bare på nytt når
    // ingen holder på med et objekt — ellers ville det hoppet under pekeren.
    if (res.ok && res.liste) {
      const ny = vaskRiggListe(res.liste);
      const forskjell = JSON.stringify(ny) !== JSON.stringify(S.rigg || []);
      S.rigg = ny;
      lsSkriv();
      if (forskjell && !plasserer && !drar && !flytter) { tegnRigg(); if (erApen()) tegnPanel(); }
    }
    visLagring();
  }, 1200);
}
S.riggMeldEndret = planLagring;

function lagringsTekst() {
  if (spStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (spStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Trykk på den røde prikken øverst til høyre og logg inn for å dele med de andre.");
}
function visLagring() {
  const el = $("riggLagringTekst");
  if (el) el.textContent = lagringsTekst();
}

// 🏷 LOGOEN PER OBJEKT (Emil 29.09): hvert rigg-objekt har sitt eget logovalg
// i skjemaet (o.logo = filnavnet i SharePoint-mappa Logoer), fordi brakkene
// på en byggeplass kan tilhøre flere bedrifter. Samme mappe og samme
// oppsett som rapportene, men valget i rapportmenyen påvirker IKKE riggen.
// Bildet er ORIGINALEN fra SharePoint (hentLogo), aldri en gjenskaping.
//   logoBilder: filnavn → { data, b, h } | null (fantes ikke)
//   onsket:     filnavn som trengs, men ikke er hentet (f.eks. før innlogging)
const logoBilder = new Map(), onsket = new Set();
let logoListe = null;          // Promise<[{ fil, itemId }]>, hentes én gang
function hentLogoListe(paaNytt) {
  if (!logoListe || paaNytt) logoListe = hentLogoer().catch(() => []);
  return logoListe;
}
S.riggLogoFor = (fil) => {
  if (!fil) return null;
  if (logoBilder.has(fil)) return logoBilder.get(fil);
  onsket.add(fil);
  return null;
};
let henter = false, logoSjekket = 0;
async function hentOnskedeLogoer() {
  if (henter || !onsket.size || !spPaalogget()) return;
  henter = true;
  try {
    let liste = await hentLogoListe();
    if (!liste.length) liste = await hentLogoListe(true);
    let noe = false;
    for (const fil of [...onsket]) {
      const l = liste.find(x => x.fil === fil);
      let bilde = null;
      if (l) { try { bilde = await hentLogo(l.itemId); } catch (_) { bilde = null; } }
      // Ikke funnet: husk det som «ingen», så vi ikke spør SharePoint hvert sekund
      logoBilder.set(fil, bilde);
      onsket.delete(fil);
      if (bilde) noe = true;
    }
    if (noe) tegnRigg();
  } finally { henter = false; }
}
// Én gang i sekundet: er det logoer som venter (f.eks. fordi brukeren ikke
// var logget inn da riggen ble tegnet), hentes de nå.
frameHooks.push(() => {
  const naa = performance.now();
  if (naa - logoSjekket < 1000) return;
  logoSjekket = naa;
  if (onsket.size) hentOnskedeLogoer();
});

// 🖼 LOGOEN PÅ RIGGPLAN-PDF-EN (Emil 01.10): eget valg, som i støpeplanen.
// Før fulgte PDF-en stille valget i rapportmenyen, så den som ville ha
// byggherrens logo på riggplanen måtte bytte logo på alle rapportene også.
// Ikke valgt ennå (null): rapportens valg, så de som alt har satt logo der
// får den samme som før. "" = ingen logo.
export function riggLogoFil() {
  const v = S.settings && S.settings.riggLogo;
  if (v === null || v === undefined) return (S.settings && S.settings.rapLogo) || "";
  return String(v);
}
S.riggLogoFil = riggLogoFil;

// Logovalget i skjemaet: «Ingen logo» + filene i Logoer-mappa. Det lagrede
// valget vises selv om lista ikke er hentet ennå (eller man er logget ut).
async function fyllRiggLogovalg(velg, valgt, paaNytt = true) {
  if (!velg) return;
  const opt = (verdi, tekst) => { const o = document.createElement("option"); o.value = verdi; o.textContent = tekst; return o; };
  velg.innerHTML = "";
  velg.appendChild(opt("", t("Ingen logo")));
  if (valgt) velg.appendChild(opt(valgt, ryddLogonavn(valgt)));
  velg.value = valgt || "";
  if (!spPaalogget()) return;
  const liste = await hentLogoListe(paaNytt);
  if (!velg.isConnected) return;
  for (const l of liste) if (l.fil !== valgt) velg.appendChild(opt(l.fil, ryddLogonavn(l.fil)));
  velg.value = valgt || "";
}

// afterLoad (ifc.js): lokalt først, så SharePoint. Nyeste `endret` vinner per
// objekt. Var noe endret her uten nett, lastes det opp.
S.lastRigg = async () => {
  const fil = S.fileName;
  S.rigg = lsLes();
  tegnRigg();
  hentPlanerFraSp();
  if (!spPaalogget()) { spStatus = "av"; return; }
  const sp = await spLes(SP_MAPPE, spFil());
  if (S.fileName !== fil) return;
  if (sp.status === "feil") { spStatus = "feil"; visLagring(); return; }
  spStatus = "ok";
  const eksterne = vaskRiggListe(sp.liste);
  const lokale = S.rigg;
  S.rigg = vaskRiggListe(flettPaaId(lokale, eksterne));
  lsSkriv();
  tegnRigg();
  if (erApen()) tegnPanel();
  if (trengerOpplasting(lokale, eksterne)) planLagring();
};

// ═══════════════════════ 💾 LAGREDE RIGGPLANER ═══════════════════════
//
// Emil 25.09: lagre og hente fram flere riggplaner, SAMME oppsett som
// «Lagrede SW-resultater» i SW-generator. Egen liste per modellfil, navnet er
// nøkkelen. Lokalt først, så SharePoint i IFC-modeller/Rigg-planer (mappa
// lages av sp-lager.js første gang noen lagrer — ingen skal måtte lage den
// for hånd). Flettes på NAVN med gravsteiner, som SW-resultatene: to som
// lagrer hver sin plan samtidig mister ikke hverandres.
const PLAN_SP_MAPPE = "Rigg-planer";
function planSpFil() { return S.fileName + ".riggplaner.json"; }
function planNokkel() { return "storm-ifc-rigg-planer::" + S.fileName; }

function lesPlanerRaa() {
  try {
    const l = JSON.parse(localStorage.getItem(planNokkel()) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (_) { return []; }
}
function lesPlaner() {
  return lesPlanerRaa().filter(p => p && !p.slettet && p.navn)
    .sort((a, b) => String(b.endret || b.dato || "").localeCompare(String(a.endret || a.dato || "")));
}
function skrivPlaner(liste) {
  try { localStorage.setItem(planNokkel(), JSON.stringify(liste)); return true; }
  catch (_) { return false; }
}
function lagrePlanerBeggeSteder(liste) {
  if (!skrivPlaner(liste)) return false;
  if (!spPaalogget()) return true;
  const fil = S.fileName;
  spSkriv(PLAN_SP_MAPPE, planSpFil(), liste).then(res => {
    if (S.fileName !== fil) return;
    if (res.ok && res.liste) skrivPlaner(res.liste);
    if (erApen()) tegnPanel();
  });
  return true;
}
async function hentPlanerFraSp() {
  if (!spPaalogget() || !S.fileName) return;
  const fil = S.fileName;
  const res = await spLes(PLAN_SP_MAPPE, planSpFil());
  if (S.fileName !== fil) return;
  if (res.status === "ok" || res.status === "tom") {
    skrivPlaner(flettPaaNavn(lesPlanerRaa(), res.liste));
    if (erApen()) tegnPanel();
  }
}

function lagrePlan(navn) {
  const rent = String(navn || "").trim().slice(0, RIGGPLAN_NAVN_MAKS);
  if (!rent) { varsel(t("Gi riggplanen et navn før du lagrer den.")); return; }
  if (!riggObjekter(S.rigg || []).length) { varsel(t("Plasser noe på tomta før du lagrer riggplanen.")); return; }
  const liste = lesPlanerRaa();
  const i = liste.findIndex(p => p && p.navn === rent);
  if (i >= 0 && !liste[i].slettet && !confirm(t("«{0}» finnes allerede. Skal den skrives over?", rent))) return;
  const naa = new Date();
  const data = riggOyeblikk(S.rigg || []);
  const post = { navn: rent, dato: naa.toISOString().slice(0, 10), endret: naa.toISOString(),
    av: mittNavn(), antall: riggplanSammendrag(data).objekter, data };
  if (i >= 0) liste[i] = post; else liste.push(post);
  if (!lagrePlanerBeggeSteder(liste)) {
    varsel(t("Klarte ikke å lagre — nettleserens lagring er full. Slett et gammelt resultat og prøv igjen."));
    return;
  }
  tegnPanel();
}

// Henter en lagret plan fram: den erstatter riggen som står nå. Ingen
// «er du sikker?» — det kan angres, som alt annet i verktøyet.
function settRiggFraPlan(data, angreTekst) {
  const forrige = riggOyeblikk(S.rigg || []);
  avbrytPlassering(); avbrytPil(); avbrytMerker();
  velg(null);
  S.rigg = vaskRiggListe(riggFraLagret(S.rigg || [], data));
  tegnRigg();
  if (S.riggOmplasser) S.riggOmplasser();
  planLagring();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (erApen()) tegnPanel();
  if (angreTekst) post(angreTekst, () => settRiggFraPlan(forrige, null), () => settRiggFraPlan(data, null));
}
// 🗑 «Fjern rigg» (Emil 28.09): alle objektene ut av tomta på én gang. Det
// er SAMME vei som å hente en tom plan: objektene blir gravsteiner (ellers
// kom de tilbake fra SharePoint), referansen blir stående, og alt kan angres.
// Spør først — riggen er delt, og en kollega kan ha brukt timer på den.
function fjernAllRigg() {
  const n = riggObjekter(S.rigg || []).length;
  if (!n) return;
  if (!confirm(t("Fjerne alle {0} rigg-objektene fra tomta? Det kan angres med Ctrl+Z.", n))) return;
  settRiggFraPlan({ objekter: [], ref: null }, "Rigg fjernet");
}
function lastInnPlan(navn) {
  const p = lesPlaner().find(x => x.navn === navn);
  if (!p || !p.data) return;
  settRiggFraPlan(JSON.parse(JSON.stringify(p.data)), "Riggplan hentet");
}
function slettPlan(navn) {
  if (!confirm(t("Slette «{0}»?", navn))) return;
  const liste = lesPlanerRaa().map(p => p && p.navn === navn
    ? { navn: p.navn, slettet: true, endret: new Date().toISOString() } : p);
  lagrePlanerBeggeSteder(liste);
  tegnPanel();
}

// ═══════════════════════ ENDRINGER (med angre) ═══════════════════════
function post(tekst, angreFn, gjenFn) {
  if (S.pushAngre) S.pushAngre({ tekst, angre: angreFn, gjenopprett: gjenFn });
}

// Bytter posten med samme id (eller legger den til), stempler `endret` og
// lagrer. Angre legger den forrige utgaven tilbake — også som gravstein.
function settPost(ny) {
  const liste = (S.rigg || []).filter(p => p && p.id !== ny.id);
  liste.push(Object.assign({}, ny, { endret: new Date().toISOString() }));
  S.rigg = liste;
}

function leggTil(o, medAngre) {
  settPost(Object.assign({}, o, { av: o.av || mittNavn() }));
  tegnRigg();
  // Referansen (hvor bygget står på tomta) lagres sammen med første objekt,
  // så byggeplass-siden og en maskin uten terreng tegner riggen likt.
  if (S.riggOmplasser) S.riggOmplasser();
  planLagring();
  if (erApen()) tegnPanel();
  if (medAngre) post("Rigg plassert", () => fjern(o.id, false), () => leggTil(o, false));
}

function fjern(id, medAngre) {
  const o = hentO(id);
  if (!o) return;
  settPost({ id, slettet: true });
  if (valgtId === id) velg(null);
  tegnRigg();
  planLagring();
  if (erApen()) tegnPanel();
  if (medAngre) post("Rigg slettet", () => leggTil(o, false), () => fjern(id, false));
}

// utenPanel: skjemaet lagrer selv (runde 15c) — da skal panelet IKKE tegnes
// på nytt, for det er det man står og trykker i.
function oppdater(id, felter, angreTekst, utenPanel) {
  const o = hentO(id);
  if (!o) return;
  const for_ = Object.assign({}, o);
  const ny = vaskRiggObjekt(Object.assign({}, o, felter));
  if (!ny) return;
  settPost(ny);
  tegnRigg();
  planLagring();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (erApen() && !utenPanel) tegnPanel();
  if (angreTekst) {
    const etter = Object.assign({}, ny);
    post(angreTekst, () => oppdater(id, for_, null), () => oppdater(id, etter, null));
  }
}

// ═══════════════════════ BAKKEN UNDER PEKEREN ═══════════════════════
const _plan = new THREE.Plane();
const _punkt = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function settNdc(x, y) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}

// Terrenget eller plata (pickFlate), ellers gulvplanet. Treffer pekeren
// BYGGET før bakken, settes objektet på bakken rett under treffpunktet — ved
// foten av veggen. Uten den regelen gikk strålen gjennom veggen og satte
// brakka INNI bygget (funnet i nettleserprøven 25.09).
function bakkePunkt(x, y) {
  const base = riggBase();
  if (!base) return null;
  let p = null;
  const f = pickFlate(x, y);
  if (f && f.point) p = f.point.clone();
  else {
    settNdc(x, y);
    raycaster.setFromCamera(_ndc, camera);
    _plan.set(new THREE.Vector3(0, 1, 0), -base.gulvY);
    if (raycaster.ray.intersectPlane(_plan, _punkt)) p = _punkt.clone();
  }
  const m = pick(x, y);
  if (m && m.point && (!p || m.distance < camera.position.distanceTo(p))) {
    p = m.point.clone();
    p.y = bakkeY(p) ?? base.gulvY;
  }
  return p;
}

// Bakkehøyden (scenens y) under et punkt i scenen, eller null.
function bakkeY(p) {
  const live = S.terrengRef ? S.terrengRef() : null;
  if (!live) return null;
  const pos = posisjonFra(p);
  return pos && pos.ramme === "utm" ? live.yVed(pos.E, pos.N) : null;
}

// Et punkt i scenen → posisjonsfeltene (UTM med terreng, byggrammen uten).
function posisjonFra(p) {
  const base = riggBase();
  if (!base || !p) return null;
  return byggTilRigg((p.x - base.c.x) * base.skala, (p.z - base.c.z) * base.skala, aktivRef());
}

// Et punkt i scenen → gjerdets egen ramme ({ x, z } i meter). Går via samme
// ramme som objektet står i (utm eller bygg), så det virker før og etter at
// terrenget er hentet.
function lokalFra(o, p) {
  const base = riggBase();
  if (!base || !p || !o) return null;
  const bx = (p.x - base.c.x) * base.skala, bz = (p.z - base.c.z) * base.skala;
  const ref = aktivRef();
  const pos = o.ramme === "utm" ? byggTilRigg(bx, bz, ref) : byggTilRigg(bx, bz, null);
  if (pos.ramme !== o.ramme) return null;
  return enTilLokal(o, pos.E, pos.N);
}

// Peker mot et rigg-objekt? (pick() i elements.js ser bare modellen.)
// Svaret er gruppa, og for gjerdet også hvilket panel (stykke) som ble truffet.
function pekRiggTreff(x, y) {
  settNdc(x, y);
  raycaster.setFromCamera(_ndc, camera);
  const treff = raycaster.intersectObjects(riggGroup.children, true);
  for (const h of treff) {
    if (h.object.isSprite || !h.object.visible) continue;
    let o = h.object, stykke = null;
    while (o && !o.userData.riggId) {
      if (stykke == null && o.userData.stykke != null) stykke = o.userData.stykke;
      o = o.parent;
    }
    if (o && o.userData.riggId) return { g: o, stykke, punkt: h.point, avstand: h.distance };
  }
  return null;
}
// Bare et treff som ligger nærmere enn alt annet klikkbart (materiell) teller —
// ellers ble både rigg-objektet og materiellet foran det markert (25.09).
function pekRiggEier(x, y) { const h = pekRiggTreff(x, y); return h && eierPunktet("rigg", x, y) ? h : null; }
function pekRigg(x, y) { const h = pekRiggEier(x, y); return h ? h.g : null; }
registrerPeker("rigg", (x, y) => { const h = pekRiggTreff(x, y); return h ? h.avstand : null; });

// ═══════════════════════ 🚧 SKJØTENE (håndtak) ═══════════════════════
// Svarte prikker med hvit kant, som på Emils skisse. De står like over
// bakken ved hver fot, ligger alltid oppå (depthTest av) og har fast
// størrelse på skjermen.
const handtakGroup = new THREE.Group();
handtakGroup.name = "rigg-skjoter";
scene.add(handtakGroup);
// Samme tak som navnelappene (lappStorrelse i rigg-vis.js): nært har prikkene
// fast skjermstørrelse, langt unna blir de aldri større enn SKJOT_MAKS_M og
// skjules når de blir for små — ellers ble 50 prikker én hvit klump.
const SKJOT_MAKS_M = 0.6;
const _hV = new THREE.Vector3();
function skalerHandtak() {
  if (!handtakGroup.children.length) return;
  const k = 2 * Math.tan(camera.fov * Math.PI / 360) / (canvas.clientHeight || 1);
  const maks = SKJOT_MAKS_M / (S.enhetSkala || 1);
  for (const m of handtakGroup.children) {
    m.getWorldPosition(_hV);
    const d = _hV.distanceTo(camera.position) || 1e-9;
    const r = lappStorrelse(m.userData.px, 1 / (d * k), maks * m.userData.px / 9);
    m.visible = r.vis;
    m.scale.setScalar(r.hoyde / 2);
  }
}
frameHooks.push(skalerHandtak);
const kuleGeo = new THREE.SphereGeometry(1, 16, 12);
const matSkjot = new THREE.MeshBasicMaterial({ color: "#111827", depthTest: false });
const matSkjotValgt = new THREE.MeshBasicMaterial({ color: "#3b82f6", depthTest: false });
const matKant = new THREE.MeshBasicMaterial({ color: "#ffffff", depthTest: false });

function valgtGjerde() {
  const o = valgtId ? hentO(valgtId) : null;
  return o && o.punkter ? o : null;
}

// ═══════════════════════ 🏗 KRANENS SEKTOR ═══════════════════════
function erKran(o) { return !!(o && RIGG_TYPER[o.type] && RIGG_TYPER[o.type].kran); }
function kranKladd() {
  const o = kranRed && hentO(kranRed.id);
  return o ? Object.assign({}, o, { sektorFra: kranRed.sektorFra, sektorTil: kranRed.sektorTil }) : null;
}
function startKranRed() {
  const o = valgtId && hentO(valgtId);
  if (!erKran(o)) return;
  // Som port-steget: håndtakene trenger rigg-modus, ellers går draget til kameraet
  if (!iModus() || !erApen()) visValgt(o.id);
  kranRed = { id: o.id, sektorFra: o.sektorFra, sektorTil: o.sektorTil };
  S.riggKranRed = kranRed;
  tegnEnRigg(kranKladd());
  oppdaterValgBar();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}
function avsluttKranRed(lagre) {
  if (!kranRed) return;
  const r = kranRed, o = hentO(r.id);
  kranRed = null; sektorDrar = null; S.riggKranRed = null;
  if (lagre && o && (o.sektorFra !== r.sektorFra || o.sektorTil !== r.sektorTil))
    oppdater(o.id, { sektorFra: r.sektorFra, sektorTil: r.sektorTil }, "Svingsektor endret");
  else if (o) tegnEnRigg(o);
  oppdaterValgBar();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}
// Hvilket håndtak er under pekeren? ("fra", "til" eller null)
function pekSektorHandtak(x, y) {
  const g = kranRed && finnRiggObjekt(kranRed.id);
  if (!g) return null;
  settNdc(x, y);
  raycaster.setFromCamera(_ndc, camera);
  const mesher = [];
  g.traverse(m => { if (m.isMesh && m.userData.sektorHandtak) mesher.push(m); });
  const h = raycaster.intersectObjects(mesher, false)[0];
  return h ? h.object.userData.sektorHandtak : null;
}
// Vinkelen fra kranens midte til pekeren, i kranens eget rom. Strålen treffer
// et vannrett plan i kranens fothøyde — ikke bygget: da ville vinkelen hoppet
// når pekeren går over taket.
const _kranPlan = new THREE.Plane(), _kranP = new THREE.Vector3();
function kranVinkel(o, x, y) {
  const g = finnRiggObjekt(o.id);
  if (!g) return null;
  settNdc(x, y);
  raycaster.setFromCamera(_ndc, camera);
  _kranPlan.set(new THREE.Vector3(0, 1, 0), -g.position.y);
  if (!raycaster.ray.intersectPlane(_kranPlan, _kranP)) return null;
  const lok = lokalFra(o, _kranP.clone());
  return lok ? vinkelTil(lok.x, lok.z) : null;
}

function tomHandtak() { handtakGroup.children.slice().forEach(m => handtakGroup.remove(m)); }

// `o` kan være en kladd (mens en skjøt dras).
function oppdaterHandtak(o) {
  tomHandtak();
  const gj = o || valgtGjerde();
  // 🚪 I port-steget er det panelene som skal trykkes på — prikkene ville
  // tatt klikkene (de ligger øverst) og druknet de grønne panelene.
  if (!gj || !iModus() || gj.skjult || portModus) return;
  const g = finnRiggObjekt(gj.id);
  if (!g || !g.children[0]) return;
  g.updateMatrixWorld(true);
  const modell = g.children[0], hoyder = g.userData.hoyder || [];
  gj.punkter.forEach((q, k) => {
    const v = modell.localToWorld(new THREE.Vector3(q.x, (hoyder[k] || 0) + 0.3, q.z));
    const kant = new THREE.Mesh(kuleGeo, matKant);
    kant.position.copy(v); kant.userData.px = 14; kant.renderOrder = 998;
    const kule = new THREE.Mesh(kuleGeo, valgteSkjoter.includes(k) ? matSkjotValgt : matSkjot);
    kule.position.copy(v); kule.userData.px = 9; kule.renderOrder = 999; kule.userData.skjot = k;
    handtakGroup.add(kant, kule);
  });
  skalerHandtak();
}

function pekHandtak(x, y) {
  if (!handtakGroup.children.length) return null;
  settNdc(x, y);
  raycaster.setFromCamera(_ndc, camera);
  const h = raycaster.intersectObjects(handtakGroup.children, false)[0];
  return h ? (h.object.userData.skjot != null ? h.object.userData.skjot : nesteKule(h.object)) : null;
}
// Treff på den hvite kanten: skjøten er kula rett etter den i lista.
function nesteKule(kant) {
  const i = handtakGroup.children.indexOf(kant);
  const k = handtakGroup.children[i + 1];
  return k && k.userData.skjot != null ? k.userData.skjot : null;
}

function settMarkering() {
  settGjerdeMarkering(valgtId, valgteStykker, portModus ? overStykke : null);
}

function startPortModus() {
  if (!valgtGjerde()) return;
  // 🚪 Port-steget trenger rigg-modus (runde 15d, Emils skjermbilde 30.09):
  // gjerdet kan velges uten at Rigg er åpent, og da gikk klikkene på panelene
  // videre til det vanlige elementvalget («358 elementer valgt») — bare
  // lyset under pekeren virket. Nå åpnes Rigg (katalog + panel) med gjerdet valgt.
  if (!iModus() || !erApen()) visValgt(valgtId);
  portModus = true; overStykke = null;
  valgteStykker = []; valgteSkjoter = [];
  settMarkering();
  const o = valgtGjerde(); if (o) tegnEnRigg(o);
  oppdaterValgBar(); oppdaterHandtak();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avsluttPortModus() {
  if (!portModus) return;
  portModus = false; overStykke = null;
  valgteStykker = [];
  settMarkering();
  const o = valgtGjerde(); if (o) tegnEnRigg(o);
  oppdaterValgBar(); oppdaterHandtak();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

// Svelger vi et pointerup kameraet fikk pointerdown til, må det få beskjed —
// se materiell.js. Det er billig, og det kan aldri bli feil.
function slippKamera(e) {
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
}

// ═══════════════════════ VALG OG KNAPPERADEN ═══════════════════════
function velg(id) {
  if (id !== valgtId) {
    const hadde = valgteStykker.length || (portModus && overStykke != null);
    valgteStykker = []; valgteSkjoter = [];
    portModus = false; overStykke = null;   // port-steget hører til ett gjerde
    settGjerdeMarkering(id, []);
    // de grønne panelene på gjerdet vi forlater må males om
    const forrige = valgtId && hentO(valgtId);
    if (hadde && forrige) tegnEnRigg(forrige);
  }
  if (kranRed && kranRed.id !== id) avsluttKranRed(false);
  const forrigeId = valgtId;
  valgtId = id;
  S.riggValgtId = id;
  // 🏗 Gradene og radiusen står bare på en valgt kran — den må tegnes på nytt
  // når den blir valgt eller valgt bort
  for (const k of new Set([forrigeId, id])) { const q = k && hentO(k); if (erKran(q)) tegnEnRigg(q); }
  oppdaterRiggValgEffekt();
  oppdaterValgBar();
  oppdaterHandtak();
  if (S.riggModeBarTegn && S.mode === "rigg") S.riggModeBarTegn();
  // 📝 Panelet til høyre viser skjemaet for det som er valgt (runde 15b) —
  // og lista når ingenting er valgt. Er man i rigg-modus og velger noe, åpnes
  // panelet: man skal ikke måtte lete etter en «Rediger»-knapp.
  if (id && iModus() && !erApen()) apnePanel("riggPanel");
  if (erApen()) tegnPanel();
}

// Velg et objekt og vis skjemaet for det (etter plassering, gjerde og pil).
function visValgt(id) {
  if (!iModus()) settRiggModus(true);
  if (!erApen()) apnePanel("riggPanel");
  if (!iModus()) settRiggModus(true);   // apnePanel kan ha avsluttet et annet klikkmodus
  velg(id);
  tegnPanel();
}

// Knapperaden hører hjemme ØVERST i panelet når det er åpent, og flyter
// nederst på skjermen når det er lukket (da er det eneste stedet knappene finnes).
function plasserValgBar() {
  const el = valgBarEl();
  const slot = erApen() ? $("riggValgSlot") : null;
  if (slot) { if (el.parentNode !== slot) slot.appendChild(el); el.classList.add("i-panel"); }
  else { if (el.parentNode !== document.body) document.body.appendChild(el); el.classList.remove("i-panel"); }
}

// tegnRigg() bygger objektene på nytt — effekten, knapperaden og skjøtene må på igjen
S.etterTegnRigg = () => { oppdaterRiggValgEffekt(); oppdaterValgBar(); oppdaterHandtak(); };

function valgBarEl() {
  let el = $("riggValgBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "riggValgBar";
    el.style.display = "none";   // resten av stilen står i storm.css (#riggValgBar)
    document.body.appendChild(el);
  }
  return el;
}

function oppdaterValgBar() {
  const el = valgBarEl();
  plasserValgBar();
  const o = valgtId ? hentO(valgtId) : null;
  if (!o || o.skjult) { el.style.display = "none"; el.innerHTML = ""; sistValgBarHtml = ""; return; }
  const n = riggAntall(o);
  el.style.display = "flex";
  // 🖱 Knappene byttes BARE når innholdet er endret (Emil 29.09, runde 15c):
  // man endret et felt og trykket «Ferdig» — musetrykket forlot feltet, det
  // lagret, og raden ble bygd på nytt MIDT i klikket. Knappen man trykket på
  // fantes ikke lenger da museknappen ble sluppet, så det måtte to trykk til.
  // Lik HTML → de samme knappene står, med de samme lytterne.
  const bytt = (html) => { if (html === sistValgBarHtml && el.firstChild) return false; el.innerHTML = html; sistValgBarHtml = html; return true; };
  if (kranRed && kranRed.id === o.id) {
    const sk = kranSektor(kranKladd() || o);
    const html = '<span style="font-size:12px;font-weight:600">' + t("Radius") + "</span>" +
      '<span style="font-size:12px;color:var(--muted)">' + esc(sk.full ? t("Hel sirkel — dra et hvitt håndtak langs kanten for å begrense svingen")
        : t("Tillatt sving {0}° — dra de hvite håndtakene langs kanten", sk.bredde)) + "</span>" +
      '<button id="rvKranHel" class="btn" style="padding:3px 8px"' + (sk.full ? " disabled" : "") + ">" + t("Hel sirkel") + "</button>" +
      '<button id="rvKranLagre" class="btn primary" style="padding:3px 10px">' + t("Lagre") + "</button>" +
      '<button id="rvKranAvbryt" class="btn" style="padding:3px 8px">' + t("Avbryt") + "</button>";
    if (bytt(html)) {
      $("rvKranLagre").onclick = () => avsluttKranRed(true);
      $("rvKranAvbryt").onclick = () => avsluttKranRed(false);
      $("rvKranHel").onclick = () => {
        if (!kranRed) return;
        kranRed.sektorTil = kranRed.sektorFra;
        tegnEnRigg(kranKladd()); oppdaterValgBar();
      };
    }
    return;
  }
  if (portModus && erGjerde(o)) {
    if (bytt('<span style="font-size:12px;font-weight:600">' + ikon("pluss") + " " + t("Port") + "</span>" + portStegKnapper(o))) koblPortSteg(o);
    return;
  }
  const html =
    '<span class="rv-navn" style="font-size:12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + esc(o.farge) + ';margin-right:6px"></span>' +
    esc(o.navn || riggTypeLabel(o.type)) + (n > 1 ? " ×" + n : "") + "</span>" +
    '<button id="rvFlytt" class="btn" title="' + t("Flytt: objektet følger pekeren — trykk der det skal stå") + '" style="padding:3px 8px">✥ ' + t("Flytt") + "</button>" +
    '<button id="rvRotV" class="btn" title="' + t("Roter 15° mot venstre") + '" style="padding:3px 8px">⟲</button>' +
    '<button id="rvRotH" class="btn" title="' + t("Roter 15° mot høyre") + '" style="padding:3px 8px">⟳</button>' +
    '<button id="rvSkjul" class="btn" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon("skjul") + "</button>" +
    '<button id="rvSlett" class="btn" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button>" +
    '<button id="rvRediger" class="btn" title="' + t("Rediger") + '" style="padding:3px 8px">' + ikon("rediger") + "</button>" +
    gjerdeKnapper(o) +
    (erKran(o) ? '<button id="rvRadius" class="btn" title="' + t("Still inn hvor kranen får svinge: dra håndtakene langs sirkelen") + '" style="padding:3px 8px">' + t("Radius") + "</button>" : "") +
    '<button id="rvLukk" class="btn" title="' + t("Ferdig") + '" style="padding:3px 8px">' + t("Ferdig") + "</button>";
  if (!bytt(html)) return;
  koblGjerdeKnapper(o);
  if ($("rvRadius")) $("rvRadius").onclick = () => startKranRed();
  $("rvFlytt").onclick = () => {
    const g = valgtId && finnRiggObjekt(valgtId);
    if (g) flytter = { id: valgtId, fra: g.position.clone() };
  };
  // rot er MED KLOKKA sett ovenfra (som et kompass): høyre = +15°
  $("rvRotV").onclick = () => { const q = hentO(valgtId); if (q) oppdater(q.id, { rot: normVinkel(q.rot - ROT_STEG) }, "Rigg rotert"); };
  $("rvRotH").onclick = () => { const q = hentO(valgtId); if (q) oppdater(q.id, { rot: normVinkel(q.rot + ROT_STEG) }, "Rigg rotert"); };
  $("rvSkjul").onclick = () => { const q = hentO(valgtId); if (!q) return; oppdater(q.id, { skjult: true }, "Rigg skjult"); velg(null); };
  $("rvSlett").onclick = () => { const q = hentO(valgtId); if (q) fjern(q.id, true); velg(null); };
  $("rvRediger").onclick = () => { if (valgtId) visValgt(valgtId); };
  $("rvLukk").onclick = () => velg(null);
}

// ═══════════════════════ 🚧 PORT OG SKJØTER ═══════════════════════
// Hva kan gjøres med utvalget akkurat nå?
function portValg(o) {
  const st = gjerdeStykker(o);
  const nabo = valgteStykker.length === 2 ? naboStykker(st.length, valgteStykker[0], valgteStykker[1]) : null;
  const kanPort = !!nabo && !st[valgteStykker[0]].port && !st[valgteStykker[1]].port && st.length - 1 >= 3;
  const portI = valgteStykker.length === 1 && st[valgteStykker[0]] && st[valgteStykker[0]].port ? valgteStykker[0] : null;
  return { kanPort, portI };
}

function fjernSkjotKnapp(o) {
  if (!valgteSkjoter.length) return "";
  const min = minPunkter(o);
  return '<button id="rvFjernSkjot" class="btn" style="padding:3px 8px"' +
    (o.punkter.length - valgteSkjoter.length < min ? " disabled" : "") + ">" +
    (valgteSkjoter.length > 1 ? t("Fjern {0} skjøter", valgteSkjoter.length) : t("Fjern skjøt")) + "</button>";
}

function gjerdeKnapper(o) {
  if (!o.punkter) return "";
  // ➜ Pila: lengden og fjern-knappen — ingen paneler og porter
  if (erPil(o)) return '<span style="font-size:11px;color:var(--muted)">' +
    (Math.round(pilLengde(o) * 10) / 10) + " m</span>" + fjernSkjotKnapp(o);
  const m = gjerdeMengder(o);
  return '<span style="font-size:11px;color:var(--muted)">' + t("{0} paneler · {1} porter", m.paneler, m.porter) +
    (m.forLange ? ' · <span style="color:var(--danger, #e53935)">' + t("{0} for lange", m.forLange) + "</span>" : "") + "</span>" +
    '<button id="rvPort" class="btn" style="padding:3px 8px"' +
    ' title="' + t("Gjør to paneler ved siden av hverandre om til én port — eller en port tilbake til paneler") + '">' + t("Port") + "</button>" +
    fjernSkjotKnapp(o);
}

// 🚪 Hva port-steget sier og kan akkurat nå. Ren tekst og tilstand, så testen
// kan sjekke hvert steg uten en scene.
function portStegStatus(o) {
  const st = gjerdeStykker(o);
  const v = portValg(o);
  const n = valgteStykker.length;
  if (v.portI != null) return { tekst: t("Du har valgt en port"), kan: "tilbake" };
  if (n < 2) return { tekst: t("Trykk på 2 paneler som står ved siden av hverandre ({0} av 2) — eller på en port for å gjøre den tilbake til paneler", n), kan: null };
  if (v.kanPort) return { tekst: t("2 av 2 valgt"), kan: "port" };
  if (valgteStykker.some(i => st[i] && st[i].port)) return { tekst: t("En port kan ikke bli en del av en ny port — trykk på et vanlig panel"), kan: null };
  if (st.length - 1 < 3) return { tekst: t("Gjerdet er for lite til en port"), kan: null };
  return { tekst: t("Panelene står ikke ved siden av hverandre — trykk på et annet panel"), kan: null };
}

function portStegKnapper(o) {
  const s = portStegStatus(o);
  return '<span id="rvPortTekst" style="font-size:12px;color:var(--muted)">' + esc(s.tekst) + "</span>" +
    (s.kan === "port" ? '<button id="rvPortLag" class="btn primary" style="padding:3px 10px">' + t("Gjør om til port") + "</button>" : "") +
    (s.kan === "tilbake" ? '<button id="rvTilbake" class="btn primary" style="padding:3px 10px">' + t("Gjør tilbake til paneler") + "</button>" : "") +
    '<button id="rvPortAvbryt" class="btn" style="padding:3px 8px">' + t("Avbryt") + "</button>";
}

function lagPortNaa(o) {
  const v = portValg(o);
  if (!v.kanPort) return false;
  const ny = gjorOmTilPort(o.punkter, valgteStykker[0], valgteStykker[1]);
  if (!ny) return false;
  portModus = false; overStykke = null;
  valgteStykker = []; valgteSkjoter = []; settMarkering();
  oppdater(o.id, { punkter: ny }, "Port laget");
  if (S.riggModeBarTegn) S.riggModeBarTegn();
  return true;
}

function koblPortSteg(o) {
  if ($("rvPortLag")) $("rvPortLag").onclick = () => lagPortNaa(o);
  if ($("rvTilbake")) $("rvTilbake").onclick = () => {
    const v = portValg(o);
    const ny = v.portI != null && gjorTilbake(o.punkter, v.portI);
    if (!ny) return;
    portModus = false; overStykke = null;
    valgteStykker = []; valgteSkjoter = []; settMarkering();
    oppdater(o.id, { punkter: ny }, "Port gjort tilbake til paneler");
    if (S.riggModeBarTegn) S.riggModeBarTegn();
  };
  if ($("rvPortAvbryt")) $("rvPortAvbryt").onclick = () => avsluttPortModus();
}

function koblGjerdeKnapper(o) {
  if (!o.punkter) return;
  if (erPil(o)) { if ($("rvFjernSkjot")) $("rvFjernSkjot").onclick = () => fjernValgtSkjot(); return; }
  if ($("rvPort")) $("rvPort").onclick = () => startPortModus();
  if ($("rvFjernSkjot")) $("rvFjernSkjot").onclick = () => fjernValgtSkjot();
}

function fjernValgtSkjot() {
  const o = valgtGjerde();
  if (!o || !valgteSkjoter.length) return;
  const ny = fjernSkjoter(o.punkter, valgteSkjoter, minPunkter(o));
  if (!ny) return;
  valgteSkjoter = []; valgteStykker = []; settMarkering();
  oppdater(o.id, { punkter: ny }, "Skjøt fjernet");
}

// Shift-klikk på en skjøt: av eller på i utvalget. Da kan flere skjøter
// flyttes på én gang — dra i en av dem, og alle de valgte følger med.
function veksleSkjot(k) {
  const i = valgteSkjoter.indexOf(k);
  if (i >= 0) valgteSkjoter.splice(i, 1); else valgteSkjoter.push(k);
  valgteStykker = []; settMarkering();
  oppdaterValgBar(); oppdaterHandtak();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

// Klikk på et panel i det valgte gjerdet: av eller på i utvalget. Maks to —
// et tredje klikk bytter ut det eldste.
function veksleStykke(o, i) {
  const k = valgteStykker.indexOf(i);
  if (k >= 0) valgteStykker.splice(k, 1);
  else { valgteStykker.push(i); if (valgteStykker.length > 2) valgteStykker.shift(); }
  valgteSkjoter = [];
  settMarkering();
  tegnEnRigg(o);
  oppdaterValgBar();
  oppdaterHandtak();
}

// ── ➜ Tegne en pil ──
function startPil(type) {
  avbrytPlassering(); avbrytMerker(); avbrytPil();
  if (!S.modelGroup || !RIGG_TYPER[type]) return;
  tegner = { type, punkter: [], linje: null };
  if (!iModus()) settRiggModus(true);
  tegnKatalog();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avbrytPil() {
  if (!tegner) return;
  if (tegner.linje) { scene.remove(tegner.linje); tegner.linje.geometry.dispose(); }
  tegner = null;
  tegnKatalog();
  if (S.riggModeBarTegn && iModus()) S.riggModeBarTegn();
}

// Forhåndsvisning: punktene så langt, og en strek videre til pekeren.
function tegnPilKladd(peker) {
  if (!tegner) return;
  const pts = tegner.punkter.concat(peker ? [peker] : []);
  if (tegner.linje) { scene.remove(tegner.linje); tegner.linje.geometry.dispose(); tegner.linje = null; }
  if (pts.length < 2) return;
  const loft = 0.1 / (S.enhetSkala || 1);
  tegner.linje = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y + loft, p.z))),
    new THREE.LineBasicMaterial({ color: RIGG_TYPER[tegner.type].farge, depthTest: false }));
  tegner.linje.renderOrder = 999;
  scene.add(tegner.linje);
}

// Ferdig: punktene (scene) → byggrammen (meter) → en pil med origo i første
// punkt, lagt langs scenens akser (samme grep som gjerdet).
function fullforPil() {
  if (!tegner) return;
  const base = riggBase();
  const type = tegner.type;
  const pts = tegner.punkter.slice();
  avbrytPil();
  if (!base || pts.length < 2) return;
  const f = pilFraPunkter(pts.map(p => ({ x: (p.x - base.c.x) * base.skala, z: (p.z - base.c.z) * base.skala })));
  if (!f) return;
  const start = new THREE.Vector3(base.c.x + f.x0 / base.skala, pts[0].y, base.c.z + f.z0 / base.skala);
  const pos = posisjonFra(start);
  if (!pos) return;
  const ref = aktivRef();
  const rot = pos.ramme === "utm" && ref ? ref.plass.rot : 0;
  const o = vaskRiggObjekt(Object.assign({ id: nyRiggId(), type, rot, punkter: f.punkter }, pos));
  if (!o) return;
  leggTil(o, true);
  visValgt(o.id);   // skjemaet åpnes med en gang (Emil 29.09)
}

// ── Markeringsboksen ──
function startGjerde() {
  avbrytPlassering();
  avbrytMerker();
  if (!S.modelGroup) return;
  merker = { start: null, linje: null };
  if (!iModus()) settRiggModus(true);
  tegnKatalog();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avbrytMerker() {
  if (!merker) return;
  if (merker.linje) { scene.remove(merker.linje); merker.linje.geometry.dispose(); }
  merker = null;
  tegnKatalog();
  if (S.riggModeBarTegn && iModus()) S.riggModeBarTegn();
}

const merkeMat = new THREE.LineBasicMaterial({ color: "#3b82f6", depthTest: false });
function tegnMerkeboks(a, b) {
  if (!merker) return;
  const y = Math.max(a.y, b.y) + 0.05 / (S.enhetSkala || 1);
  const pts = [[a.x, a.z], [b.x, a.z], [b.x, b.z], [a.x, b.z], [a.x, a.z]].map(([x, z]) => new THREE.Vector3(x, y, z));
  if (merker.linje) { scene.remove(merker.linje); merker.linje.geometry.dispose(); }
  merker.linje = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), merkeMat);
  merker.linje.renderOrder = 999;
  scene.add(merker.linje);
}

// Firkanten → et gjerde. Firkanten ligger langs scenens akser (byggets), og
// gjerdet får samme retning: origo midt i, x og z langs scenens x og z.
function lagGjerde(a, b) {
  const base = riggBase();
  if (!base || !a || !b) return;
  const midt = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const pos = posisjonFra(midt);
  if (!pos) return;
  const hx = Math.abs(b.x - a.x) / 2 * base.skala, hz = Math.abs(b.z - a.z) / 2 * base.skala;
  const punkter = gjerdeFraRektangel(hx, hz, RIGG_TYPER.gjerde.L);
  if (!punkter) { varsel(t("Firkanten er for liten til et gjerde. Dra en større boks.")); return; }
  const ref = aktivRef();
  // rotY i scenen = plass.rot − rot. Skal gjerdet ligge langs scenens akser, er rot = plass.rot.
  const rot = pos.ramme === "utm" && ref ? ref.plass.rot : 0;
  const o = vaskRiggObjekt(Object.assign({ id: nyRiggId(), type: "gjerde", rot, punkter }, pos));
  if (!o) return;
  leggTil(o, true);
  visValgt(o.id);   // skjemaet åpnes med en gang (Emil 29.09)
}

// ═══════════════════════ MODUS ═══════════════════════
function iModus() { return S.mode === "rigg"; }

S.riggModeBar = (bar) => {
  S.riggModeBarTegn = () => {
    // Kroken lever videre etter at rigg-modus er avsluttet — da er linja
    // nederst et annet verktøys (eller ingens), og den skal ikke røres.
    if (!iModus()) return;
    if (tegner) {
      bar.innerHTML = '<span class="lbl">' + t("Klikk på bakken for hvert punkt i pila — dobbeltklikk eller Enter for å avslutte, Esc avbryter") +
        '</span><button id="mbPilFerdig"' + (tegner.punkter.length < 2 ? " disabled" : "") + ">" + t("Ferdig pil") + "</button>";
      $("mbPilFerdig").onclick = () => fullforPil();
      bar.classList.add("open");
      return;
    }
    // 🚪 I port-steget står alt i knapperaden («+ Port … Avbryt»). En
    // rad til nederst med samme tekst var bare dobbelt (Emil 30.09).
    if (portModus && valgtGjerde()) {
      bar.innerHTML = "";
      bar.classList.remove("open");
      return;
    }
    const hint = merker
      ? t("Dra en boks på bakken der gjerdet skal stå — Esc avbryter")
      : plasserer
      ? t("Trykk der objektet skal stå — eller velg en annen type til venstre · Esc avbryter")
      : valgtGjerde() && erPil(valgtGjerde())
      ? t("Dra i prikkene for å forme pila · shift-klikk for flere prikker")
      : valgtGjerde()
      ? t("Dra i prikkene for å forme gjerdet · shift-klikk for flere prikker · dobbeltklikk på et panel for ny skjøt · «Port» for å lage en port eller gjøre en port tilbake til paneler")
      : t("Trykk på et rigg-objekt for å flytte, rotere eller slette det");
    bar.innerHTML = '<span class="lbl">' + hint + '</span><button id="mbRiggFerdig">' + t("Ferdig") + "</button>";
    $("mbRiggFerdig").onclick = () => { settRiggModus(false); $("riggPanel").classList.remove("open"); };
    bar.classList.add("open");
  };
  S.riggModeBarTegn();
};

function settRiggModus(paa) {
  S.mode = paa ? "rigg" : (S.mode === "rigg" ? null : S.mode);
  const b = $("btnRigg");
  if (b) b.classList.toggle("active", paa);
  if (!paa) { avbrytPlassering(); avbrytMerker(); avbrytPil(); avsluttPortModus(); avsluttKranRed(false); }
  visKatalog(paa);
  if (S.oppdaterModeBar) S.oppdaterModeBar();
  oppdaterHandtak();
}

// Et annet verktøy åpnes (apnePanel → modes.js): da er du ferdig med riggen.
S.avsluttRigg = () => settRiggModus(false);

// ═══════════════════════ PLASSERING ═══════════════════════
function startPlassering(type, mal) {
  avbrytPlassering();
  const M = RIGG_TYPER[type];
  if (!M || !S.modelGroup) return;
  const base = riggBase();
  const o = vaskRiggObjekt(Object.assign({ id: nyRiggId(), type, E: 0, N: 0, ramme: "bygg" }, mal || {}));
  if (!o || !base) return;
  const gruppe = byggRiggObjekt(o, base.skala);
  gruppe.position.set(base.c.x, base.gulvY, base.c.z);
  riggGroup.add(gruppe);
  plasserer = { o, gruppe };
  if (!iModus()) settRiggModus(true);
  // Panelet og katalogen står ÅPNE (Emil 29.09): før lukket panelet seg, og
  // man måtte trykke Rigg for hvert eneste objekt. Nå trykker man bare på
  // neste type i katalogen for å bytte.
  tegnKatalog();
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avbrytPlassering() {
  if (!plasserer) return;
  riggGroup.remove(plasserer.gruppe);
  plasserer.gruppe.traverse(m => { if (m.geometry) m.geometry.dispose(); });
  plasserer = null;
  tegnKatalog();
  if (S.riggModeBarTegn && iModus()) S.riggModeBarTegn();
}

function overCanvas(e) { return e.target === canvas; }

// Et objekt som er flyttet til `pt` i scenen: nye posisjonsfelt. Rotasjonen i
// scenen skal stå stille, også om objektet bytter ramme (bygg → utm).
function flyttetFelter(o, pt) {
  const pos = posisjonFra(pt);
  if (!pos) return null;
  const felter = { ramme: pos.ramme, E: pos.E, N: pos.N };
  if (pos.ramme !== o.ramme) {
    const ref = aktivRef();
    const plassRot = ref ? ref.plass.rot : 0;
    felter.rot = normVinkel(pos.ramme === "utm" ? o.rot + plassRot : o.rot - plassRot);
  }
  return felter;
}

// ═══════════════════════ PEKERNE (window, fangstfase) ═══════════════════════
window.addEventListener("pointerdown", (e) => {
  if (e.shiftKey && !plasserer && !drar && !flytter) {
    // 🚧 Shift-klikk på en skjøt i det valgte gjerdet: flervalg av skjøter.
    // Alt annet med shift er fortsatt markeringsboksens (elements.js).
    const gj = overCanvas(e) && e.button === 0 && iModus() ? valgtGjerde() : null;
    const k = gj ? pekHandtak(e.clientX, e.clientY) : null;
    if (k != null) { e.stopPropagation(); shiftSkjot = true; veksleSkjot(k); }
    return;
  }
  nedPos = { x: e.clientX, y: e.clientY };
  if (!overCanvas(e) || e.button !== 0) return;
  if (flytter || plasserer) { e.stopPropagation(); return; }   // tas på pointerup
  // 🚧 markeringsboksen: første hjørne
  if (merker) { e.stopPropagation(); merker.start = bakkePunkt(e.clientX, e.clientY); return; }
  // ➜ under pilteging tas klikket på pointerup; et drag roterer kameraet som vanlig
  if (tegner) return;
  if (iModus() && kranRed) {
    // 🏗 et håndtak på kranens sirkel? Alt annet er kameraet mens sektoren stilles inn
    const hvem = pekSektorHandtak(e.clientX, e.clientY);
    if (hvem) { e.stopPropagation(); sektorDrar = { hvem }; return; }
    return;
  }
  if (iModus()) {
    // 🚧 en skjøt i det valgte gjerdet?
    const gj = valgtGjerde();
    const k = gj ? pekHandtak(e.clientX, e.clientY) : null;
    if (gj && k != null) {
      e.stopPropagation();
      // Er skjøten alt med i et flervalg, dras hele utvalget; ellers bare den.
      const flere = valgteSkjoter.includes(k) && valgteSkjoter.length > 1;
      if (!flere) valgteSkjoter = [k];
      valgteStykker = []; settMarkering();
      skjotDrar = { id: gj.id, k, ider: valgteSkjoter.slice(), fra: gj.punkter, punkter: gj.punkter, flyttet: false, flere };
      oppdaterValgBar(); oppdaterHandtak();
      return;
    }
    const h = pekRiggEier(e.clientX, e.clientY);
    if (h) {
      e.stopPropagation();
      const id = h.g.userData.riggId, varValgt = id === valgtId;
      velg(id);
      // Draget holder på avstanden mellom pekeren og objektets origo — ellers
      // hopper et gjerde (origo midt i ringen) bort til pekeren.
      const pt = bakkePunkt(e.clientX, e.clientY);
      drar = { id, fra: h.g.position.clone(), stykke: h.stykke, varValgt, beveget: false,
        offset: pt ? h.g.position.clone().sub(pt) : new THREE.Vector3() };
    }
  }
}, true);

window.addEventListener("pointermove", (e) => {
  const aktiv = flytter || drar;
  if (plasserer) {
    const pt = bakkePunkt(e.clientX, e.clientY);
    if (pt) plasserer.gruppe.position.copy(pt);
    return;
  }
  if (tegner) { const pt = bakkePunkt(e.clientX, e.clientY); if (pt && tegner.punkter.length) tegnPilKladd(pt); return; }
  if (merker) {
    if (merker.start) { e.stopPropagation(); const pt = bakkePunkt(e.clientX, e.clientY); if (pt) tegnMerkeboks(merker.start, pt); }
    return;
  }
  if (sektorDrar && kranRed) {
    e.stopPropagation();
    const k = kranKladd();
    const v = k && kranVinkel(k, e.clientX, e.clientY);
    const ny = v != null && draSektor(k, sektorDrar.hvem, v);
    if (!ny || (ny.sektorFra === kranRed.sektorFra && ny.sektorTil === kranRed.sektorTil)) return;
    kranRed.sektorFra = ny.sektorFra; kranRed.sektorTil = ny.sektorTil;
    sektorDrar.hvem = ny.hvem;   // fra hel sirkel avgjør retningen hvilket håndtak det ble
    tegnEnRigg(kranKladd());
    oppdaterValgBar();
    return;
  }
  if (skjotDrar) {
    e.stopPropagation();
    const o = hentO(skjotDrar.id);
    const lok = o && lokalFra(o, bakkePunkt(e.clientX, e.clientY));
    if (!lok) return;
    // Alle de valgte flyttes like langt som den man holder i.
    const a = skjotDrar.fra[skjotDrar.k];
    skjotDrar.punkter = flyttSkjoter(skjotDrar.fra, skjotDrar.ider, lok.x - a.x, lok.z - a.z) || skjotDrar.punkter;
    skjotDrar.flyttet = true;
    const kladd = Object.assign({}, o, { punkter: skjotDrar.punkter });
    tegnEnRigg(kladd);
    oppdaterHandtak(kladd);
    return;
  }
  if (!aktiv && portModus) {
    // 🚪 panelet under pekeren lyser — tegnes bare på nytt når det bytter
    const o = valgtGjerde();
    const h = o && overCanvas(e) ? pekRiggTreff(e.clientX, e.clientY) : null;
    const i = h && h.g.userData.riggId === o.id && h.stykke != null ? h.stykke : null;
    if (i !== overStykke && o) { overStykke = i; settMarkering(); tegnEnRigg(o); }
    return;
  }
  if (!aktiv) return;
  if (drar) {
    // i port-steget flyttes ikke gjerdet: et lite rykk skal fortsatt velge panelet
    if (portModus && !drar.beveget) return;
    e.stopPropagation();
    // Et lite rykk er et klikk (velg panel), ikke et flytt.
    if (!drar.beveget) {
      if (!nedPos || Math.hypot(e.clientX - nedPos.x, e.clientY - nedPos.y) <= KLIKK_PX) return;
      drar.beveget = true;
      tomHandtak();
    }
  }
  const g = finnRiggObjekt(aktiv.id);
  const pt = g ? bakkePunkt(e.clientX, e.clientY) : null;
  if (!pt || !g) return;
  if (drar && drar.offset) { pt.x += drar.offset.x; pt.z += drar.offset.z; }
  g.position.copy(pt);
}, true);

function slippFlytt(tilstand) {
  const g = finnRiggObjekt(tilstand.id);
  const o = hentO(tilstand.id);
  if (!g || !o || g.position.distanceToSquared(tilstand.fra) < 1e-12) { velg(tilstand.id); return; }
  const felter = flyttetFelter(o, g.position.clone());
  if (felter) oppdater(tilstand.id, felter, "Rigg flyttet");
  velg(tilstand.id);
}

window.addEventListener("pointerup", (e) => {
  if (shiftSkjot) { shiftSkjot = false; e.stopPropagation(); slippKamera(e); nedPos = null; return; }
  if (e.shiftKey && !plasserer && !drar && !flytter) return;
  const ned = nedPos;
  nedPos = null;
  if (!overCanvas(e) || e.button !== 0) return;

  if (flytter) {
    const f = flytter; flytter = null;
    e.stopPropagation(); slippKamera(e);
    slippFlytt(f);
    return;
  }
  if (plasserer) {
    e.stopPropagation(); slippKamera(e);
    const pt = bakkePunkt(e.clientX, e.clientY);
    const pos = pt && posisjonFra(pt);
    if (!pos) return;
    const o = Object.assign({}, plasserer.o, pos);
    avbrytPlassering();
    leggTil(o, true);
    visValgt(o.id);   // 📝 skjemaet åpnes med en gang — ingen «trykk på den, så Rediger»
    return;
  }
  // ➜ pil under tegning: et KLIKK er et nytt punkt; et drag var kameraet
  if (tegner) {
    const klikkP = ned && Math.hypot(e.clientX - ned.x, e.clientY - ned.y) <= KLIKK_PX;
    if (!klikkP) return;
    e.stopPropagation(); slippKamera(e);
    const pt = bakkePunkt(e.clientX, e.clientY);
    if (pt) { tegner.punkter.push(pt); tegnPilKladd(null); if (S.riggModeBarTegn) S.riggModeBarTegn(); }
    return;
  }
  // 🚧 markeringsboksen: andre hjørne → gjerdet
  if (merker && merker.start) {
    const a = merker.start, b = bakkePunkt(e.clientX, e.clientY);
    e.stopPropagation(); slippKamera(e);
    avbrytMerker();
    lagGjerde(a, b);
    return;
  }
  if (sektorDrar) { sektorDrar = null; e.stopPropagation(); slippKamera(e); return; }
  if (kranRed && iModus()) {
    // Et klikk ved siden av håndtakene endrer ingenting — sektoren lagres med «Lagre»
    return;
  }
  if (skjotDrar) {
    const sd = skjotDrar; skjotDrar = null;
    e.stopPropagation(); slippKamera(e);
    if (sd.flyttet) oppdater(sd.id, { punkter: sd.punkter }, sd.ider.length > 1 ? "Skjøter flyttet" : "Skjøt flyttet");
    else {
      // Et klikk uten drag på en av flere valgte: bare den blir valgt.
      if (sd.flere) valgteSkjoter = [sd.k];
      oppdaterValgBar(); oppdaterHandtak();
    }
    return;
  }
  if (drar) {
    // Les tilstanden FØR slippKamera: pointercancel-lytteren under nullstiller
    // `drar` synkront (samme felle som materiell.js hadde 21.08).
    const d = drar; drar = null;
    e.stopPropagation(); slippKamera(e);
    if (!d.beveget) {
      // Et klikk. I port-steget, på det valgte gjerdet: panelet av/på i
      // utvalget. Utenfor port-steget velger et klikk bare gjerdet (15a) —
      // ellers ble paneler grønne uten at man visste hvorfor.
      const o = hentO(d.id);
      if (o && erGjerde(o) && d.varValgt && d.stykke != null && portModus) veksleStykke(o, d.stykke);
      else velg(d.id);
      return;
    }
    slippFlytt(d);
    return;
  }
  const klikk = ned && Math.hypot(e.clientX - ned.x, e.clientY - ned.y) <= KLIKK_PX;
  if (!klikk) return;
  // 📏 Mål, kote og markering: trykket er et punkt — ikke åpne riggen, og la
  // hendelsen gå videre til main.js (Emil 02.10)
  if (iPunktModus()) return;
  const g = pekRigg(e.clientX, e.clientY);
  // 📅 Framdriftsplanens velgemodus: trykket legger rigg-objektet til / tar
  // det bort i utvalget der (framdrift.js), i stedet for å åpne riggen.
  if (g && S.velgModusAktiv && S.riggIVelgModus) { e.stopPropagation(); slippKamera(e); S.riggIVelgModus(g.userData.riggId); return; }
  if (g) { e.stopPropagation(); slippKamera(e); velg(g.userData.riggId); return; }
  // klikk utenfor: velg bort, men IKKE stopp hendelsen — main.js skal få sitt
  if (valgtId) velg(null);
}, true);

window.addEventListener("pointercancel", () => { drar = null; nedPos = null; }, true);

// 🚧 Dobbeltklikk på et panel i det valgte gjerdet: ny skjøt der.
window.addEventListener("dblclick", (e) => {
  if (!overCanvas(e) || !iModus()) return;
  // ➜ dobbeltklikk avslutter pila (de to klikkene ga samme punkt to ganger —
  // pilFraPunkter slår dem sammen)
  if (tegner) { e.stopPropagation(); e.preventDefault(); fullforPil(); return; }
  const o = valgtGjerde();
  if (!o) return;
  const h = pekRiggEier(e.clientX, e.clientY);
  if (!h || h.g.userData.riggId !== o.id || h.stykke == null) return;
  e.stopPropagation(); e.preventDefault();
  // Treffpunktet på selve panelet, ikke bakken bak det: da havner skjøten
  // på gjerdelinja og panelene blir ikke lengre av å bli delt.
  const lok = lokalFra(o, h.punkt);
  const ny = lok && leggTilSkjot(o.punkter, h.stykke, lok.x, lok.z);
  if (!ny) return;
  valgteStykker = []; valgteSkjoter = [h.stykke + 1]; settMarkering();
  oppdater(o.id, { punkter: ny }, "Skjøt lagt til");
}, true);

window.addEventListener("keydown", (e) => {
  const iFelt = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.key === "Delete" || e.key === "Backspace") && !iFelt && iModus() && valgteSkjoter.length && valgtGjerde()) {
    e.preventDefault(); e.stopPropagation();
    fjernValgtSkjot();
    return;
  }
  if (tegner && e.key === "Enter" && !iFelt) { e.preventDefault(); fullforPil(); return; }
  if (portModus && e.key === "Enter" && !iFelt) { const o = valgtGjerde(); if (o && lagPortNaa(o)) e.preventDefault(); return; }
  if (kranRed && e.key === "Enter" && !iFelt) { e.preventDefault(); avsluttKranRed(true); return; }
  if (e.key !== "Escape") return;
  if (kranRed) { avsluttKranRed(false); return; }
  if (tegner) { avbrytPil(); return; }
  if (portModus) { avsluttPortModus(); return; }
  if (merker) { avbrytMerker(); return; }
  if (skjotDrar) { const id = skjotDrar.id; skjotDrar = null; tegnEnRigg(hentO(id)); oppdaterHandtak(); return; }
  if (flytter) {
    const g = finnRiggObjekt(flytter.id);
    if (g) g.position.copy(flytter.fra);
    flytter = null;
    return;
  }
  if (plasserer) { avbrytPlassering(); return; }
  if (valgtId) { velg(null); return; }
  if (iModus()) settRiggModus(false);
});

// ═══════════════════════ KNAPPEN OG PANELET ═══════════════════════
function erApen() { const p = $("riggPanel"); return !!(p && p.classList.contains("open")); }

på("btnRigg", "click", () => {
  const panel = $("riggPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); settRiggModus(false); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  apnePanel("riggPanel");
  settRiggModus(true);
  tegnPanel();
  hentPlanerFraSp();   // kollegaenes planer kan ha kommet til siden modellen ble åpnet
});

function gjerdeTekst(o) {
  const m = gjerdeMengder(o);
  return t("{0} paneler · {1} porter", m.paneler, m.porter) + " · " + (Math.round(m.lengde * 10) / 10) + " m" +
    (m.forLange ? " · ⚠ " + t("{0} for lange", m.forLange) : "");
}

// 🎨 Ikonet for en objekttype (Emil 29.09) — det samme som i tegnforklaringen
// på riggplan-PDF-en (js/rigg-ikoner.js). Uten lerret: fargeflisen.
function ikonImg(type, farge) {
  const data = riggIkon(type, farge, 64);
  return data ? '<img src="' + data + '" alt="" width="22" height="22" style="vertical-align:middle;margin-right:6px;border-radius:5px">' : flis(farge);
}

// Liten fargeflis — samme som i materiell-panelet.
function flis(farge) {
  return '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' +
    esc(farge) + ';margin-right:6px;vertical-align:middle"></span>';
}

const LITEN = 'style="color:var(--muted);font-size:12px;margin:4px 0"';

function tegnPanel() {
  const body = $("riggBody");
  if (!body) return;
  // ⌨ Skjemaet lagrer ved hver endring (runde 15b), og da tegnes panelet på
  // nytt. Uten dette mistet man markøren hver gang man tabbet til neste felt.
  const aktivEl = document.activeElement;
  const fokusId = aktivEl && body.contains(aktivEl) && aktivEl.id ? aktivEl.id : null;
  // Knapperaden kan stå inne i panelet: ta den ut før innholdet byttes, ellers
  // forsvinner den med det gamle innholdet.
  const vb = $("riggValgBar");
  if (vb && body.contains(vb)) document.body.appendChild(vb);
  const ref = aktivRef();
  const live = S.terrengRef ? S.terrengRef() : null;
  const valgt = valgtId ? hentO(valgtId) : null;
  const tittel = $("riggTittel");
  if (tittel) tittel.textContent = valgt ? (valgt.navn || riggTypeLabel(valgt.type)) + (riggAntall(valgt) > 1 ? " ×" + riggAntall(valgt) : "") : t("Rigg");
  let html = "";
  if (valgt) html += '<div id="riggValgSlot"></div>' + skjemaHtml(valgt);
  else html += "<p " + LITEN + ">" + t("Velg en type i lista til venstre, og trykk der den skal stå. Trykk på et objekt på tomta for å endre det.") + "</p>";
  if (!live) html += "<p " + LITEN + ">" + ikon("advarsel") + " " +
    t(ref ? "Terrenget er ikke lastet. Riggen vises rundt bygget på gulvhøyde, der den sto sist."
          : "Uten terreng står riggen på gulvhøyde rundt bygget. Hentes et terreng i Terreng, flyttes den over på tomta.") + "</p>";

  // 📂 Seksjonene foldes som i SW-generator og Blikk & Tak (Emil 28.09):
  // hver <h4 data-sek> blir en <details>. Katalogen og lista står åpne første
  // gang — det er dem man trenger for å komme i gang.
  // Katalogen står i sin egen stripe til venstre (tegnKatalog, runde 15b).

  // Det som er plassert
  const liste = riggObjekter(S.rigg || []);
  html += '<h4 data-sek="rigg-plassert" style="margin:12px 0 4px">' + t("Plassert på tomta") +
    ' <span style="color:var(--muted);font-size:11px">(' + liste.length + ")</span></h4>";
  if (!liste.length) html += "<p " + LITEN + ">" + t("Ingen rigg-objekter plassert ennå.") + "</p>";
  else html += liste.map(o => {
    const n = riggAntall(o);
    return '<div class="qty-row"' + (o.skjult ? ' style="opacity:.55"' : "") + '><div class="n" data-rigg-velg="' + esc(o.id) + '" style="cursor:pointer">' +
      ikonImg(o.type, o.farge) + esc(o.navn || riggTypeLabel(o.type)) +
      (o.avfall && avfallstype(o.avfall) ? ' <span style="color:var(--muted);font-size:11px">· ' + esc(t(avfallstype(o.avfall).label)) + "</span>" : "") +
      ' <span style="color:var(--muted);font-size:11px">' + esc(riggTypeLabel(o.type)) +
      (erPil(o) ? " · " + (Math.round(pilLengde(o) * 10) / 10) + " m" : o.punkter ? " · " + gjerdeTekst(o) : " · " + o.L + " × " + o.B + " m" + (n > 1 ? " · ×" + n : "") +
        (RIGG_TYPER[o.type].parkering ? " · " + t("{0} plasser", parkeringsPlasser(o.L, o.B).totalt) : "")) + "</span></div>" +
      '<div class="c">' +
      '<button data-rigg-skjul="' + esc(o.id) + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(o.skjult ? "skjul" : "vis") + "</button>" +
      '<button data-rigg-slett="' + esc(o.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>";
  }).join("");

  // Oppsummeringen — det som skal bestilles
  const telling = riggTelling(S.rigg || []);
  if (telling.length) {
    html += '<h4 data-sek="rigg-bestilling" style="margin:12px 0 4px">' + t("Til bestilling") + "</h4>" +
      telling.map(r => '<div class="qty-row"><div class="n">' + esc(r.del ? gjerdeDelLabel(r.del) : riggTypeLabel(r.type)) +
        '</div><div class="c">' + r.antall + t(" stk") + "</div></div>").join("") +
      "<p " + LITEN + ">" + t("Står også i Mengder under typen «Rigg», og kommer med i Excel-arket.") + "</p>";
  }

  // 📄 Riggplanen (trinn 6): hovedhandlingen i panelet når noe er plassert
  // Målestokken velges her (Emil 25.09): «Automatisk» tar den minste der
  // hele riggen og bygget får plass. Valget huskes mellom øktene.
  if (liste.length) {
    const valgt = vaskMalestokkValg(S.settings && S.settings.riggMalestokk);
    html += '<h4 data-sek="rigg-pdf" style="margin:14px 0 4px">' + ikon("tegning") + " " + t("Riggplan (PDF)") + "</h4>" +
      "<label>" + t("Målestokk på A3") + '<select id="riggMalestokk">' +
      '<option value="auto"' + (valgt === "auto" ? " selected" : "") + ">" + t("Automatisk (hele riggen får plass)") + "</option>" +
      MALESTOKKER.map(m => {
        const dk = riggplanDekning(m);
        return '<option value="' + m + '"' + (valgt === m ? " selected" : "") + ">1:" + m.toLocaleString("nb-NO") +
          " — " + t("{0} × {1} m", Math.round(dk.b), Math.round(dk.h)) + "</option>";
      }).join("") + "</select></label>" +
      "<p " + LITEN + ">" + t("A3 liggende: tomta sett ovenfra med nord opp, tegnforklaring og tittelfelt. Tallet bak målestokken er hvor mye av tomta arket dekker.") + "</p>" +
      // Samme «Ingen logo» + Logoer-mappa som i skjemaet til hvert objekt
      "<label>" + t("Logo på PDF") + ' <select id="riggPdfLogo"></select></label>';
  }
  // Handlingsknappene står UTENFOR seksjonene (data-sw-fast), som Generer og
  // Fjern i SW-generator: de skal aldri gjemmes bak en overskrift.
  html += '<div class="prop-actions" data-sw-fast style="margin-top:10px;flex-wrap:wrap">' +
    '<button id="riggPdf" class="primary"' + (liste.length ? "" : " disabled") + ">" +
    ikon("lastned") + " " + t("Last ned riggplan (PDF)") + "</button>" +
    '<button id="riggFjernAlle"' + (liste.length ? "" : " disabled") + ">" +
    ikon("slett") + " " + t("Fjern rigg") + "</button></div>";
  // 💾 Lagrede riggplaner — helt nederst, som «Lagrede SW-resultater».
  const planer = lesPlaner();
  html += '<h4 data-sek="riggplaner" style="margin:14px 0 4px">' + ikon("lagre") + " " + t("Lagrede riggplaner") + "</h4>" +
    "<p " + LITEN + ">" + t("Gi riggplanen et navn og lagre den. Trykk på navnet senere for å hente den fram igjen — den erstatter riggen som står nå (kan angres).") + "</p>" +
    '<p id="riggLagringTekst" ' + LITEN + ">" + esc(lagringsTekst()) + "</p>" +
    '<div class="prop-actions sw-lagre">' +
      '<input type="text" id="riggLagreNavn" maxlength="' + RIGGPLAN_NAVN_MAKS + '" placeholder="' + esc(t("Navn på riggplanen")) + '">' +
      '<button id="riggLagreBtn">' + ikon("lagre") + " " + t("Lagre") + "</button></div>" +
    (planer.length
      ? planer.map(p =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' +
          '<button class="sw-last" data-riggplan-last="' + esc(p.navn) + '">' + esc(p.navn) + "</button>" +
          ' <span style="color:var(--muted);font-size:11px">' +
          esc([p.dato, p.antall ? t("{0} objekter", p.antall) : "", p.av || ""].filter(Boolean).join(" · ")) +
          "</span></div>" +
        '<div class="c"><button data-riggplan-slett="' + esc(p.navn) + '" title="' + esc(t("Slett")) +
        '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>").join("")
      : "<p " + LITEN + ">" + t("Ingen lagrede riggplaner ennå.") + "</p>");

  body.innerHTML = html;
  foldSeksjoner(body, { nokkel: "storm-rigg-seksjoner-apne", standard: ["rigg-plassert"] });
  if (valgt) koblSkjema(valgt);
  plasserValgBar();
  oppdaterValgBar();
  if (fokusId && $(fokusId)) {
    const f = $(fokusId);
    try { f.focus({ preventScroll: true }); if (f.type === "text") f.setSelectionRange(f.value.length, f.value.length); } catch (_) {}
  }
  if ($("riggFjernAlle")) $("riggFjernAlle").onclick = fjernAllRigg;
  // Lastes først når knappen trykkes: PDF-koden og jsPDF skal ikke koste noe
  // for den som aldri laster ned en riggplan.
  if ($("riggMalestokk")) $("riggMalestokk").onchange = (e) => {
    if (!S.settings) return;
    S.settings.riggMalestokk = e.target.value;
    writePrefs();
  };
  if ($("riggPdfLogo")) {
    fyllRiggLogovalg($("riggPdfLogo"), riggLogoFil(), false);
    $("riggPdfLogo").onchange = (e) => {
      if (!S.settings) return;
      S.settings.riggLogo = e.target.value || "";
      writePrefs();
    };
  }
  if ($("riggPdf")) $("riggPdf").onclick = async () => {
    const b = $("riggPdf"); b.disabled = true;
    try {
      const m = await import("./riggplan.js");
      await m.lastNedRiggplan(vaskMalestokkValg(S.settings && S.settings.riggMalestokk));
    }
    catch (err) { varsel(t("Klarte ikke å lage riggplanen: {0}", err.message)); }
    finally { if ($("riggPdf")) $("riggPdf").disabled = false; }
  };
  // Trykk på navnet: velg objektet og fly dit
  body.querySelectorAll("[data-rigg-velg]").forEach(d => d.onclick = () => {
    const g = finnRiggObjekt(d.dataset.riggVelg);
    velg(d.dataset.riggVelg);
    if (!g) return;
    const boks = new THREE.Box3().setFromObject(g);
    flyTil(boks.getCenter(new THREE.Vector3()), boks.getSize(new THREE.Vector3()).length() * 2);
  });
  body.querySelectorAll("button[data-rigg-skjul]").forEach(b => b.onclick = () => {
    const o = hentO(b.dataset.riggSkjul);
    if (o) oppdater(o.id, { skjult: !o.skjult }, o.skjult ? "Rigg vist" : "Rigg skjult");
  });
  body.querySelectorAll("button[data-rigg-slett]").forEach(b => b.onclick = () => fjern(b.dataset.riggSlett, true));
  if ($("riggLagreBtn")) $("riggLagreBtn").onclick = () => lagrePlan(($("riggLagreNavn") || {}).value);
  if ($("riggLagreNavn")) $("riggLagreNavn").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); lagrePlan(e.target.value); } };
  body.querySelectorAll("button[data-riggplan-last]").forEach(b => b.onclick = () => lastInnPlan(b.dataset.riggplanLast));
  body.querySelectorAll("button[data-riggplan-slett]").forEach(b => b.onclick = () => slettPlan(b.dataset.riggplanSlett));
}

// Krok: «Vis alle» (rigg-vis.js) må kunne tegne lista på nytt.
S.tegnRiggPanel = () => { if (erApen()) tegnPanel(); };

// ═══════════════════════ SKJEMAET (rediger) ═══════════════════════
// 📝 Runde 15b: skjemaet er ØVERST i høyrepanelet når noe er valgt, og hver
// endring lagres med en gang (change: når feltet forlates eller Enter, og med
// en gang for nedtrekkslister og farge). Før var det et eget vindu man måtte
// åpne med «Rediger» og lukke med «Lagre endringer» — nå ser man endringen på
// tomta mens man jobber, og Angre tar den tilbake.
function skjemaHtml(o) {
  const M = RIGG_TYPER[o.type];
  const felt = (id, navn, verdi, min, maks, steg) =>
    "<label>" + t(navn) + '<input type="number" id="' + id + '" min="' + min + '" max="' + maks +
    '" step="' + steg + '" value="' + verdi + '"></label>';
  return '<div id="riggSkjema">' +
    '<p ' + LITEN + '>' + esc(riggTypeLabel(o.type)) + " · " + t("endringene vises med en gang på tomta") + "</p>" +
    "<label>" + t("Navn på objektet") + '<input type="text" id="riggNavn" maxlength="80" placeholder="' +
    esc(riggTypeLabel(o.type)) + '" value="' + esc(o.navn) + '"></label>' +
    // 🚧 Gjerdet: L er panellengden og H panelhøyden. Et panel som er lengre
    // enn panellengden blir rødt — endres lengden her, endres varslene.
    (M.pil
      ? felt("riggB", "Bredde på pila (m)", o.B, 0.2, 10, 0.1) +
        '<input type="hidden" id="riggL" value="' + o.L + '"><input type="hidden" id="riggH" value="' + o.H + '">'
      : M.gjerde
      ? felt("riggL", "Panellengde (m)", o.L, 0.5, 10, 0.01) + felt("riggH", "Panelhøyde (m)", o.H, 0.1, 15, 0.01) +
        '<input type="hidden" id="riggB" value="' + o.B + '">'
      : M.kran
      ? felt("riggRadius", "Svingradius = bomlengde (m)", o.radius, KRAN_MIN_R, KRAN_MAKS_R, 0.5) +
        felt("riggH", "Mastehøyde (m)", o.H, 0.1, KRAN_MAKS_H, 0.1) +
        felt("riggL", "Fundament lengde (m)", o.L, 0.1, 30, 0.01) + felt("riggB", "Fundament bredde (m)", o.B, 0.1, 30, 0.01) +
        "<p " + LITEN + ">" + t("Trykk «Radius» i raden over for å stille inn hvor kranen får svinge.") + "</p>"
      : felt("riggL", "Lengde (m)", o.L, 0.1, 30, 0.01) +
        felt("riggB", "Bredde (m)", o.B, 0.1, 30, 0.01) +
        felt("riggH", "Høyde (m)", o.H, 0.1, 15, 0.01)) +
    (M.moduler ? felt("riggMod", "Moduler side om side", o.moduler, 1, MAKS_MODULER, 1) +
      felt("riggEt", "Etasjer", o.etasjer, 1, MAKS_ETASJER, 1) : "") +
    felt("riggRot", "Rotasjon (grader, med klokka)", o.rot, 0, 359.9, 1) +
    "<label>" + t("Farge") + '<input type="color" id="riggFarge" value="' + esc(o.farge) + '"></label>' +
    (M.moduler ? "<label>" + t("Dør") + '<select id="riggDorSide">' +
      '<option value="gavl"' + (o.dorSide !== "langside" ? " selected" : "") + ">" + t("På gavlen") + "</option>" +
      '<option value="langside"' + (o.dorSide === "langside" ? " selected" : "") + ">" + t("Midt på langsiden") + "</option></select></label>" +
      "<label>" + t("Døra står på endemodulen") + '<select id="riggDorEnde">' +
      '<option value="hoyre"' + (o.dorEnde !== "venstre" ? " selected" : "") + ">" + t("Til høyre") + "</option>" +
      '<option value="venstre"' + (o.dorEnde === "venstre" ? " selected" : "") + ">" + t("Til venstre") + "</option></select></label>" +
      "<p " + LITEN + ">" + t("Én dør per etasje. Med 2–3 etasjer kommer trapp og repos utenfor døra.") + "</p>" : "") +
    (M.avfall ? "<label>" + t("Avfallstype") + '<select id="riggAvfall"><option value="">' + t("Ikke valgt") + "</option>" +
      AVFALLSTYPER.map(a => '<option value="' + a.id + '"' + (o.avfall === a.id ? " selected" : "") + ">" + esc(t(a.label)) + "</option>").join("") +
      "</select></label>" : "") +
    (M.logo ? "<label>" + t("Logo") + '<select id="riggLogo"></select></label>' +
      "<p " + LITEN + ">" + t(spPaalogget() ? "Logoene hentes fra SharePoint-mappa Logoer (samme som rapportene)." : "Logg inn for å velge logo fra SharePoint-mappa Logoer.") + "</p>" : "") +
    "<p " + LITEN + ">" + t("Standardmål: {0} × {1} × {2} m", M.L, M.B, M.H) + "</p>" +
    '<div class="prop-actions" style="margin-top:6px">' +
    '<button id="riggStd">' + t("Standardmål") + "</button></div></div>";
}

function koblSkjema(o) {
  const M = RIGG_TYPER[o.type];
  if (!$("riggSkjema")) return;
  const lesFelter = () => {
    if (!$("riggSkjema") || !$("riggNavn")) return null;
    const felter = {
      navn: $("riggNavn").value.trim(),
      L: $("riggL").value, B: $("riggB").value, H: $("riggH").value,
      rot: $("riggRot").value, farge: $("riggFarge").value
    };
    if (M.logo) felter.logo = $("riggLogo") ? $("riggLogo").value : (o.logo || "");
    if (M.moduler && $("riggDorSide")) felter.dorSide = $("riggDorSide").value;
    if (M.moduler && $("riggDorEnde")) felter.dorEnde = $("riggDorEnde").value;
    if (M.avfall && $("riggAvfall")) felter.avfall = $("riggAvfall").value;
    if (M.moduler) { felter.moduler = $("riggMod").value; felter.etasjer = $("riggEt").value; }
    if (M.kran && $("riggRadius")) felter.radius = $("riggRadius").value;
    return felter;
  };
  const lagre = (felter) => {
    if (!felter) return;
    // Bare når noe faktisk er endret — ellers ble hvert fokusbytte en angrepost.
    const for_ = hentO(o.id);
    const ny = for_ && vaskRiggObjekt(Object.assign({}, for_, felter));
    if (!ny || JSON.stringify(Object.assign({}, ny, { endret: "" })) === JSON.stringify(Object.assign({}, for_, { endret: "" }))) return;
    oppdater(o.id, felter, "Rigg endret", true);
    // Panelet står (det er der man trykker) — det som kan ha endret seg,
    // settes rett inn: overskriften, og tall som ble rundet eller klemt.
    const etter = hentO(o.id);
    if (!etter) return;
    const tittel = $("riggTittel");
    if (tittel && valgtId === o.id) tittel.textContent = (etter.navn || riggTypeLabel(etter.type)) + (riggAntall(etter) > 1 ? " ×" + riggAntall(etter) : "");
    const sett = (id, v) => { const f = $(id); if (f && f !== document.activeElement && v != null && String(f.value) !== String(v)) f.value = v; };
    sett("riggL", etter.L); sett("riggB", etter.B); sett("riggH", etter.H); sett("riggRot", etter.rot);
    if (M.moduler) { sett("riggMod", etter.moduler); sett("riggEt", etter.etasjer); }
    if (M.kran) sett("riggRadius", etter.radius);
  };
  // Lagres i NESTE runde av hendelsesløkka: med Tab fyrer change før markøren
  // har flyttet seg. Tegnes panelet på nytt der og da, landet markøren i
  // ingenting (nettleserprøven 29.09). Litt etter står den i neste felt, og
  // tegnPanel setter den tilbake dit.
  // Feltene leses MED EN GANG (de kan være borte om et øyeblikk — «Ferdig»
  // velger bort objektet), og lagres like etter.
  const lagreSnart = () => { const f = lesFelter(); setTimeout(() => lagre(f), 0); };
  $("riggSkjema").querySelectorAll("input, select").forEach(f => { f.onchange = lagreSnart; });
  // Enter i et felt: lagre (change fyrer ikke alltid på Enter i tallfelt)
  $("riggSkjema").querySelectorAll("input").forEach(f => {
    f.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); lagre(lesFelter()); } };
  });
  $("riggStd").onclick = () => {
    $("riggL").value = M.L; $("riggB").value = M.B; $("riggH").value = M.H; $("riggFarge").value = M.farge;
    lagre(lesFelter());
  };
  // Lista hentes på nytt fra SharePoint bare første gang skjemaet vises for
  // objektet — panelet tegnes på nytt ved hver endring, og det skal ikke bli
  // ett nettkall per tastetrykk.
  if (M.logo) fyllRiggLogovalg($("riggLogo"), o.logo || "", sistSkjemaId !== o.id);
  sistSkjemaId = o.id;
}

// ═══════════════════════ 🏕 KATALOGEN (til venstre) ═══════════════════════
// Hvilken type er «i hånda» akkurat nå? Den får blå ramme i katalogen.
function aktivType() {
  if (plasserer) return plasserer.o.type;
  if (merker) return "gjerde";
  if (tegner) return tegner.type;
  return null;
}

function startType(k) {
  if (!RIGG_TYPER[k]) return;
  // Samme type en gang til: legg den fra deg (som Esc).
  if (aktivType() === k) { avbrytPlassering(); avbrytMerker(); avbrytPil(); return; }
  avbrytPlassering(); avbrytMerker(); avbrytPil();
  if (k === "gjerde") startGjerde();
  else if (RIGG_TYPER[k].pil) startPil(k);
  else startPlassering(k);
}

function tegnKatalog() {
  const body = $("riggKatalogBody");
  if (!body) return;
  const aktiv = aktivType();
  body.innerHTML = RIGG_REKKEFOLGE.map(k => '<button class="rigg-type' + (k === aktiv ? " aktiv" : "") + '" data-rigg-ny="' + k +
      '" title="' + esc(t(RIGG_FORKLARING[k])) + '" aria-pressed="' + (k === aktiv) + '">' +
      ikonImg(k, RIGG_TYPER[k].farge).replace(/ style="[^"]*"/, "") + "<span>" + esc(riggTypeLabel(k)) + "</span></button>").join("");
  body.querySelectorAll("button[data-rigg-ny]").forEach(b => b.onclick = () => startType(b.dataset.riggNy));
}

// Katalogen står under verktøylinja, som kan brekke over to rader.
function plasserKatalog() {
  const el = $("riggKatalog"), tb = $("toolbar");
  if (!el) return;
  const r = tb && tb.getBoundingClientRect ? tb.getBoundingClientRect() : null;
  if (r && r.bottom > 0) el.style.top = Math.round(r.bottom + 8) + "px";
  // Nederst til venstre står andre ting (kartet i Terreng o.l.) — katalogen
  // slutter godt over dem og ruller heller.
  if (window.innerWidth > 640) el.style.maxHeight = Math.max(200, window.innerHeight - (parseInt(el.style.top, 10) || 100) - 150) + "px";
}

function visKatalog(paa) {
  const el = $("riggKatalog");
  if (!el) return;
  el.classList.toggle("open", !!paa);
  if (paa) { tegnKatalog(); plasserKatalog(); }
}
window.addEventListener("resize", () => { if (iModus()) plasserKatalog(); });
på("riggKatalogLukk", "click", () => { settRiggModus(false); $("riggPanel").classList.remove("open"); });
// Lukkes høyrepanelet med krysset, må knapperaden ut av det og flyte igjen.
på("riggPanelLukk", "click", () => setTimeout(() => { plasserValgBar(); oppdaterValgBar(); }, 0));

// Til testene og hjelpekortene: ingen logikk her.
export const __rigg = { startPlassering, avbrytPlassering, leggTil, fjern, oppdater, velg, tegnPanel,
  startType, aktivType, tegnKatalog, visValgt,
  startPortModus, avsluttPortModus, portStegStatus, lagPortNaa, veksleStykke,
  get portModus() { return portModus; }, get valgteStykker() { return valgteStykker.slice(); },
  get plasserer() { return plasserer; }, REF_ID };
