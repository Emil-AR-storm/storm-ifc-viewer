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
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, flyTil, frameHooks, raycaster, scene } from "./scene.js";
import { pick, pickFlate } from "./elements.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import {
  MAKS_ETASJER, MAKS_MODULER, REF_ID, RIGG_FORKLARING, RIGG_REKKEFOLGE, RIGG_TYPER, ROT_STEG,
  byggTilRigg, enTilLokal, fjernSkjot, flyttSkjot, gjerdeFraRektangel, gjerdeMengder, gjerdeStykker,
  gjorOmTilPort, gjorTilbake, leggTilSkjot, naboStykker, nyRiggId, normVinkel, riggAntall, riggObjekter,
  riggTelling, trengerOpplasting, vaskRiggListe, vaskRiggObjekt
} from "./rigg-regn.js";
import {
  aktivRef, byggRiggObjekt, finnRiggObjekt, gjerdeDelLabel, lappStorrelse, oppdaterRiggValgEffekt, riggBase, riggGroup,
  riggTypeLabel, settGjerdeMarkering, tegnEnRigg, tegnRigg
} from "./rigg-vis.js";

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
let valgtSkjot = null;         // indeksen til skjøten som er valgt i det valgte gjerdet
let valgteStykker = [];        // panelene som er valgt (maks to) — til port

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
  return t("Lagres bare på denne maskinen. Logg inn i Biblioteket for å dele med de andre.");
}
function visLagring() {
  const el = $("riggLagringTekst");
  if (el) el.textContent = lagringsTekst();
}

// afterLoad (ifc.js): lokalt først, så SharePoint. Nyeste `endret` vinner per
// objekt. Var noe endret her uten nett, lastes det opp.
S.lastRigg = async () => {
  const fil = S.fileName;
  S.rigg = lsLes();
  tegnRigg();
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

function oppdater(id, felter, angreTekst) {
  const o = hentO(id);
  if (!o) return;
  const for_ = Object.assign({}, o);
  const ny = vaskRiggObjekt(Object.assign({}, o, felter));
  if (!ny) return;
  settPost(ny);
  tegnRigg();
  planLagring();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (erApen()) tegnPanel();
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
    if (o && o.userData.riggId) return { g: o, stykke, punkt: h.point };
  }
  return null;
}
function pekRigg(x, y) { const h = pekRiggTreff(x, y); return h ? h.g : null; }

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

function tomHandtak() { handtakGroup.children.slice().forEach(m => handtakGroup.remove(m)); }

// `o` kan være en kladd (mens en skjøt dras).
function oppdaterHandtak(o) {
  tomHandtak();
  const gj = o || valgtGjerde();
  if (!gj || !iModus() || gj.skjult) return;
  const g = finnRiggObjekt(gj.id);
  if (!g || !g.children[0]) return;
  g.updateMatrixWorld(true);
  const modell = g.children[0], hoyder = g.userData.hoyder || [];
  gj.punkter.forEach((q, k) => {
    const v = modell.localToWorld(new THREE.Vector3(q.x, (hoyder[k] || 0) + 0.3, q.z));
    const kant = new THREE.Mesh(kuleGeo, matKant);
    kant.position.copy(v); kant.userData.px = 14; kant.renderOrder = 998;
    const kule = new THREE.Mesh(kuleGeo, k === valgtSkjot ? matSkjotValgt : matSkjot);
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
  settGjerdeMarkering(valgtId, valgteStykker);
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
    const hadde = valgteStykker.length;
    valgteStykker = []; valgtSkjot = null;
    settGjerdeMarkering(id, []);
    // de grønne panelene på gjerdet vi forlater må males om
    const forrige = valgtId && hentO(valgtId);
    if (hadde && forrige) tegnEnRigg(forrige);
  }
  valgtId = id;
  S.riggValgtId = id;
  oppdaterRiggValgEffekt();
  oppdaterValgBar();
  oppdaterHandtak();
  if (S.riggModeBarTegn && S.mode === "rigg") S.riggModeBarTegn();
}

// tegnRigg() bygger objektene på nytt — effekten, knapperaden og skjøtene må på igjen
S.etterTegnRigg = () => { oppdaterRiggValgEffekt(); oppdaterValgBar(); oppdaterHandtak(); };

function valgBarEl() {
  let el = $("riggValgBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "riggValgBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function oppdaterValgBar() {
  const el = valgBarEl();
  const o = valgtId ? hentO(valgtId) : null;
  if (!o || o.skjult) { el.style.display = "none"; el.innerHTML = ""; return; }
  const n = riggAntall(o);
  el.style.display = "flex";
  el.innerHTML =
    '<span style="font-size:12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + esc(o.farge) + ';margin-right:6px"></span>' +
    esc(o.navn || riggTypeLabel(o.type)) + (n > 1 ? " ×" + n : "") + "</span>" +
    '<button id="rvFlytt" class="btn" title="' + t("Flytt: objektet følger pekeren — trykk der det skal stå") + '" style="padding:3px 8px">✥ ' + t("Flytt") + "</button>" +
    '<button id="rvRotV" class="btn" title="' + t("Roter 15° mot venstre") + '" style="padding:3px 8px">⟲</button>' +
    '<button id="rvRotH" class="btn" title="' + t("Roter 15° mot høyre") + '" style="padding:3px 8px">⟳</button>' +
    '<button id="rvSkjul" class="btn" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon("skjul") + "</button>" +
    '<button id="rvSlett" class="btn" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button>" +
    '<button id="rvRediger" class="btn" title="' + t("Rediger") + '" style="padding:3px 8px">' + ikon("rediger") + "</button>" +
    gjerdeKnapper(o) +
    '<button id="rvLukk" class="btn" title="' + t("Ferdig") + '" style="padding:3px 8px">' + t("Ferdig") + "</button>";
  koblGjerdeKnapper(o);
  $("rvFlytt").onclick = () => {
    const g = valgtId && finnRiggObjekt(valgtId);
    if (g) flytter = { id: valgtId, fra: g.position.clone() };
  };
  // rot er MED KLOKKA sett ovenfra (som et kompass): høyre = +15°
  $("rvRotV").onclick = () => { const q = hentO(valgtId); if (q) oppdater(q.id, { rot: normVinkel(q.rot - ROT_STEG) }, "Rigg rotert"); };
  $("rvRotH").onclick = () => { const q = hentO(valgtId); if (q) oppdater(q.id, { rot: normVinkel(q.rot + ROT_STEG) }, "Rigg rotert"); };
  $("rvSkjul").onclick = () => { const q = hentO(valgtId); if (!q) return; oppdater(q.id, { skjult: true }, "Rigg skjult"); velg(null); };
  $("rvSlett").onclick = () => { const q = hentO(valgtId); if (q) fjern(q.id, true); velg(null); };
  $("rvRediger").onclick = () => {
    const q = hentO(valgtId);
    if (!q) return;
    apnePanel("riggPanel");
    settRiggModus(true);
    tegnSkjema(q);
  };
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

function gjerdeKnapper(o) {
  if (!o.punkter) return "";
  const v = portValg(o);
  const m = gjerdeMengder(o);
  return '<span style="font-size:11px;color:var(--muted)">' + t("{0} paneler · {1} porter", m.paneler, m.porter) +
    (m.forLange ? ' · <span style="color:var(--danger, #e53935)">' + t("{0} for lange", m.forLange) + "</span>" : "") + "</span>" +
    '<button id="rvPort" class="btn" style="padding:3px 8px"' + (v.kanPort ? "" : " disabled") +
    ' title="' + t("Velg to paneler ved siden av hverandre, og gjør dem om til én port") + '">' + t("Gjør om til port") + "</button>" +
    (v.portI != null ? '<button id="rvTilbake" class="btn" style="padding:3px 8px">' + t("Gjør tilbake til paneler") + "</button>" : "") +
    (valgtSkjot != null ? '<button id="rvFjernSkjot" class="btn" style="padding:3px 8px"' +
      (o.punkter.length <= 3 ? " disabled" : "") + ">" + t("Fjern skjøt") + "</button>" : "");
}

function koblGjerdeKnapper(o) {
  if (!o.punkter) return;
  const v = portValg(o);
  if ($("rvPort")) $("rvPort").onclick = () => {
    if (!v.kanPort) return;
    const ny = gjorOmTilPort(o.punkter, valgteStykker[0], valgteStykker[1]);
    if (ny) { valgteStykker = []; valgtSkjot = null; settMarkering(); oppdater(o.id, { punkter: ny }, "Port laget"); }
  };
  if ($("rvTilbake")) $("rvTilbake").onclick = () => {
    const ny = gjorTilbake(o.punkter, v.portI);
    if (ny) { valgteStykker = []; valgtSkjot = null; settMarkering(); oppdater(o.id, { punkter: ny }, "Port gjort tilbake til paneler"); }
  };
  if ($("rvFjernSkjot")) $("rvFjernSkjot").onclick = () => fjernValgtSkjot();
}

function fjernValgtSkjot() {
  const o = valgtGjerde();
  if (!o || valgtSkjot == null) return;
  const ny = fjernSkjot(o.punkter, valgtSkjot);
  if (!ny) return;
  valgtSkjot = null; valgteStykker = []; settMarkering();
  oppdater(o.id, { punkter: ny }, "Skjøt fjernet");
}

// Klikk på et panel i det valgte gjerdet: av eller på i utvalget. Maks to —
// et tredje klikk bytter ut det eldste.
function veksleStykke(o, i) {
  const k = valgteStykker.indexOf(i);
  if (k >= 0) valgteStykker.splice(k, 1);
  else { valgteStykker.push(i); if (valgteStykker.length > 2) valgteStykker.shift(); }
  valgtSkjot = null;
  settMarkering();
  tegnEnRigg(o);
  oppdaterValgBar();
  oppdaterHandtak();
}

// ── Markeringsboksen ──
function startGjerde() {
  avbrytPlassering();
  avbrytMerker();
  if (!S.modelGroup) return;
  merker = { start: null, linje: null };
  if (!iModus()) settRiggModus(true);
  $("riggPanel").classList.remove("open");
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avbrytMerker() {
  if (!merker) return;
  if (merker.linje) { scene.remove(merker.linje); merker.linje.geometry.dispose(); }
  merker = null;
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
  if (!punkter) { alert(t("Firkanten er for liten til et gjerde. Dra en større boks.")); return; }
  const ref = aktivRef();
  // rotY i scenen = plass.rot − rot. Skal gjerdet ligge langs scenens akser, er rot = plass.rot.
  const rot = pos.ramme === "utm" && ref ? ref.plass.rot : 0;
  const o = vaskRiggObjekt(Object.assign({ id: nyRiggId(), type: "gjerde", rot, punkter }, pos));
  if (!o) return;
  leggTil(o, true);
  velg(o.id);
}

// ═══════════════════════ MODUS ═══════════════════════
function iModus() { return S.mode === "rigg"; }

S.riggModeBar = (bar) => {
  S.riggModeBarTegn = () => {
    const hint = merker
      ? t("Dra en boks på bakken der gjerdet skal stå — Esc avbryter")
      : plasserer
      ? t("Trykk der objektet skal stå — Esc avbryter")
      : valgtGjerde()
      ? t("Dra i prikkene for å forme gjerdet · dobbeltklikk på et panel for ny skjøt · velg to paneler for port")
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
  if (!paa) { avbrytPlassering(); avbrytMerker(); }
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
  $("riggPanel").classList.remove("open");
  if (S.riggModeBarTegn) S.riggModeBarTegn();
}

function avbrytPlassering() {
  if (!plasserer) return;
  riggGroup.remove(plasserer.gruppe);
  plasserer.gruppe.traverse(m => { if (m.geometry) m.geometry.dispose(); });
  plasserer = null;
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
  if (e.shiftKey && !plasserer && !drar && !flytter) return;   // shift = markeringsboksen sin
  nedPos = { x: e.clientX, y: e.clientY };
  if (!overCanvas(e) || e.button !== 0) return;
  if (flytter || plasserer) { e.stopPropagation(); return; }   // tas på pointerup
  // 🚧 markeringsboksen: første hjørne
  if (merker) { e.stopPropagation(); merker.start = bakkePunkt(e.clientX, e.clientY); return; }
  if (iModus()) {
    // 🚧 en skjøt i det valgte gjerdet?
    const gj = valgtGjerde();
    const k = gj ? pekHandtak(e.clientX, e.clientY) : null;
    if (gj && k != null) {
      e.stopPropagation();
      valgtSkjot = k; valgteStykker = []; settMarkering();
      skjotDrar = { id: gj.id, k, punkter: gj.punkter, flyttet: false };
      oppdaterValgBar(); oppdaterHandtak();
      return;
    }
    const h = pekRiggTreff(e.clientX, e.clientY);
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
  if (merker) {
    if (merker.start) { e.stopPropagation(); const pt = bakkePunkt(e.clientX, e.clientY); if (pt) tegnMerkeboks(merker.start, pt); }
    return;
  }
  if (skjotDrar) {
    e.stopPropagation();
    const o = hentO(skjotDrar.id);
    const lok = o && lokalFra(o, bakkePunkt(e.clientX, e.clientY));
    if (!lok) return;
    skjotDrar.punkter = flyttSkjot(o.punkter, skjotDrar.k, lok.x, lok.z) || skjotDrar.punkter;
    skjotDrar.flyttet = true;
    const kladd = Object.assign({}, o, { punkter: skjotDrar.punkter });
    tegnEnRigg(kladd);
    oppdaterHandtak(kladd);
    return;
  }
  if (!aktiv) return;
  if (drar) {
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
    velg(o.id);
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
  if (skjotDrar) {
    const sd = skjotDrar; skjotDrar = null;
    e.stopPropagation(); slippKamera(e);
    if (sd.flyttet) oppdater(sd.id, { punkter: sd.punkter }, "Skjøt flyttet");
    else oppdaterHandtak();
    return;
  }
  if (drar) {
    // Les tilstanden FØR slippKamera: pointercancel-lytteren under nullstiller
    // `drar` synkront (samme felle som materiell.js hadde 21.08).
    const d = drar; drar = null;
    e.stopPropagation(); slippKamera(e);
    if (!d.beveget) {
      // Et klikk. På et gjerde som alt var valgt: panelet av/på i utvalget.
      const o = hentO(d.id);
      if (o && o.punkter && d.varValgt && d.stykke != null) veksleStykke(o, d.stykke);
      else velg(d.id);
      return;
    }
    slippFlytt(d);
    return;
  }
  const klikk = ned && Math.hypot(e.clientX - ned.x, e.clientY - ned.y) <= KLIKK_PX;
  if (!klikk) return;
  const g = pekRigg(e.clientX, e.clientY);
  if (g) { e.stopPropagation(); slippKamera(e); velg(g.userData.riggId); return; }
  // klikk utenfor: velg bort, men IKKE stopp hendelsen — main.js skal få sitt
  if (valgtId) velg(null);
}, true);

window.addEventListener("pointercancel", () => { drar = null; nedPos = null; }, true);

// 🚧 Dobbeltklikk på et panel i det valgte gjerdet: ny skjøt der.
window.addEventListener("dblclick", (e) => {
  if (!overCanvas(e) || !iModus()) return;
  const o = valgtGjerde();
  if (!o) return;
  const h = pekRiggTreff(e.clientX, e.clientY);
  if (!h || h.g.userData.riggId !== o.id || h.stykke == null) return;
  e.stopPropagation(); e.preventDefault();
  // Treffpunktet på selve panelet, ikke bakken bak det: da havner skjøten
  // på gjerdelinja og panelene blir ikke lengre av å bli delt.
  const lok = lokalFra(o, h.punkt);
  const ny = lok && leggTilSkjot(o.punkter, h.stykke, lok.x, lok.z);
  if (!ny) return;
  valgteStykker = []; valgtSkjot = h.stykke + 1; settMarkering();
  oppdater(o.id, { punkter: ny }, "Skjøt lagt til");
}, true);

window.addEventListener("keydown", (e) => {
  const iFelt = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.key === "Delete" || e.key === "Backspace") && !iFelt && iModus() && valgtSkjot != null && valgtGjerde()) {
    e.preventDefault(); e.stopPropagation();
    fjernValgtSkjot();
    return;
  }
  if (e.key !== "Escape") return;
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
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  apnePanel("riggPanel");
  settRiggModus(true);
  tegnPanel();
});

function gjerdeTekst(o) {
  const m = gjerdeMengder(o);
  return t("{0} paneler · {1} porter", m.paneler, m.porter) + " · " + (Math.round(m.lengde * 10) / 10) + " m" +
    (m.forLange ? " · ⚠ " + t("{0} for lange", m.forLange) : "");
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
  const ref = aktivRef();
  const live = S.terrengRef ? S.terrengRef() : null;
  let html = "<p " + LITEN + ">" + t("Trykk på et objekt og så der det skal stå. Objektene står på bakken.") + "</p>";
  if (!live) html += "<p " + LITEN + ">" + ikon("advarsel") + " " +
    t(ref ? "Terrenget er ikke lastet. Riggen vises rundt bygget på gulvhøyde, der den sto sist."
          : "Uten terreng står riggen på gulvhøyde rundt bygget. Hentes et terreng i Terreng, flyttes den over på tomta.") + "</p>";

  // Katalogen: én knapp per type
  html += '<div id="riggKatalog" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0">' +
    RIGG_REKKEFOLGE.map(k => '<button data-rigg-ny="' + k + '" title="' + esc(t(RIGG_FORKLARING[k])) + '" ' +
      'style="text-align:left;padding:6px 8px">' + flis(RIGG_TYPER[k].farge) + esc(riggTypeLabel(k)) + "</button>").join("") +
    "</div>";

  // Det som er plassert
  const liste = riggObjekter(S.rigg || []);
  html += '<h4 style="margin:12px 0 4px">' + t("Plassert på tomta") +
    ' <span style="color:var(--muted);font-size:11px">(' + liste.length + ")</span></h4>";
  if (!liste.length) html += "<p " + LITEN + ">" + t("Ingen rigg-objekter plassert ennå.") + "</p>";
  else html += liste.map(o => {
    const n = riggAntall(o);
    return '<div class="qty-row"' + (o.skjult ? ' style="opacity:.55"' : "") + '><div class="n" data-rigg-velg="' + esc(o.id) + '" style="cursor:pointer">' +
      flis(o.farge) + esc(o.navn || riggTypeLabel(o.type)) +
      ' <span style="color:var(--muted);font-size:11px">' + esc(riggTypeLabel(o.type)) +
      (o.punkter ? " · " + gjerdeTekst(o) : " · " + o.L + " × " + o.B + " m" + (n > 1 ? " · ×" + n : "")) + "</span></div>" +
      '<div class="c">' +
      '<button data-rigg-skjul="' + esc(o.id) + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(o.skjult ? "skjul" : "vis") + "</button>" +
      '<button data-rigg-slett="' + esc(o.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>";
  }).join("");

  // Oppsummeringen — det som skal bestilles
  const telling = riggTelling(S.rigg || []);
  if (telling.length) {
    html += '<h4 style="margin:12px 0 4px">' + t("Til bestilling") + "</h4>" +
      telling.map(r => '<div class="qty-row"><div class="n">' + esc(r.del ? gjerdeDelLabel(r.del) : riggTypeLabel(r.type)) +
        '</div><div class="c">' + r.antall + t(" stk") + "</div></div>").join("") +
      "<p " + LITEN + ">" + t("Står også i Mengder under typen «Rigg», og kommer med i Excel-arket.") + "</p>";
  }

  html += '<h4 style="margin:14px 0 4px">' + ikon("lagre") + " " + t("Lagring") + "</h4>" +
    '<p id="riggLagringTekst" ' + LITEN + ">" + esc(lagringsTekst()) + "</p>";

  body.innerHTML = html;
  body.querySelectorAll("button[data-rigg-ny]").forEach(b => b.onclick = () =>
    b.dataset.riggNy === "gjerde" ? startGjerde() : startPlassering(b.dataset.riggNy));
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
}

// Krok: «Vis alle» (rigg-vis.js) må kunne tegne lista på nytt.
S.tegnRiggPanel = () => { if (erApen()) tegnPanel(); };

// ═══════════════════════ SKJEMAET (rediger) ═══════════════════════
function tegnSkjema(o) {
  const body = $("riggBody");
  if (!body || !o) return;
  const M = RIGG_TYPER[o.type];
  const felt = (id, navn, verdi, min, maks, steg) =>
    "<label>" + t(navn) + '<input type="number" id="' + id + '" min="' + min + '" max="' + maks +
    '" step="' + steg + '" value="' + verdi + '"></label>';
  body.innerHTML =
    '<h4 style="margin:0 0 6px">' + t("Rediger rigg-objekt") + " — " + esc(riggTypeLabel(o.type)) + "</h4>" +
    "<label>" + t("Navn på objektet") + '<input type="text" id="riggNavn" maxlength="80" placeholder="' +
    esc(riggTypeLabel(o.type)) + '" value="' + esc(o.navn) + '"></label>' +
    // 🚧 Gjerdet: L er panellengden og H panelhøyden. Et panel som er lengre
    // enn panellengden blir rødt — endres lengden her, endres varslene.
    (M.gjerde
      ? felt("riggL", "Panellengde (m)", o.L, 0.5, 10, 0.01) + felt("riggH", "Panelhøyde (m)", o.H, 0.1, 15, 0.01) +
        '<input type="hidden" id="riggB" value="' + o.B + '">'
      : felt("riggL", "Lengde (m)", o.L, 0.1, 30, 0.01) +
        felt("riggB", "Bredde (m)", o.B, 0.1, 30, 0.01) +
        felt("riggH", "Høyde (m)", o.H, 0.1, 15, 0.01)) +
    (M.moduler ? felt("riggMod", "Moduler side om side", o.moduler, 1, MAKS_MODULER, 1) +
      felt("riggEt", "Etasjer", o.etasjer, 1, MAKS_ETASJER, 1) : "") +
    felt("riggRot", "Rotasjon (grader, med klokka)", o.rot, 0, 359.9, 1) +
    "<label>" + t("Farge") + '<input type="color" id="riggFarge" value="' + esc(o.farge) + '"></label>' +
    "<p " + LITEN + ">" + t("Standardmål: {0} × {1} × {2} m", M.L, M.B, M.H) + "</p>" +
    '<div class="prop-actions" style="margin-top:10px">' +
    '<button id="riggLagre" class="primary">' + t("Lagre endringer") + "</button>" +
    '<button id="riggStd">' + t("Standardmål") + "</button>" +
    '<button id="riggAvbryt">' + t("Avbryt") + "</button></div>";
  $("riggLagre").onclick = () => {
    const felter = {
      navn: $("riggNavn").value.trim(),
      L: $("riggL").value, B: $("riggB").value, H: $("riggH").value,
      rot: $("riggRot").value, farge: $("riggFarge").value
    };
    if (M.moduler) { felter.moduler = $("riggMod").value; felter.etasjer = $("riggEt").value; }
    oppdater(o.id, felter, "Rigg endret");
    tegnPanel();
    velg(o.id);
  };
  $("riggStd").onclick = () => {
    $("riggL").value = M.L; $("riggB").value = M.B; $("riggH").value = M.H; $("riggFarge").value = M.farge;
  };
  $("riggAvbryt").onclick = () => tegnPanel();
}

// Til testene og hjelpekortene: ingen logikk her.
export const __rigg = { startPlassering, avbrytPlassering, leggTil, fjern, oppdater, velg, tegnPanel,
  get plasserer() { return plasserer; }, REF_ID };
