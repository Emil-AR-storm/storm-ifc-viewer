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
// treffer terrenget og plata (evnen «flate» i terreng.js) — modellen ignoreres
// med vilje. Uten terreng treffes gulvplanet.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, flyTil, raycaster } from "./scene.js";
import { pick, pickFlate } from "./elements.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import {
  MAKS_ETASJER, MAKS_MODULER, REF_ID, RIGG_FORKLARING, RIGG_REKKEFOLGE, RIGG_TYPER, ROT_STEG,
  byggTilRigg, nyRiggId, normVinkel, riggAntall, riggObjekter, riggTelling, trengerOpplasting,
  vaskRiggListe, vaskRiggObjekt
} from "./rigg-regn.js";
import {
  aktivRef, byggRiggObjekt, finnRiggObjekt, oppdaterRiggValgEffekt, riggBase, riggGroup,
  riggTypeLabel, tegnRigg
} from "./rigg-vis.js";

// ═══════════════════════ TILSTAND ═══════════════════════
let plasserer = null;   // { o, gruppe } — objektet som henger på pekeren
let valgtId = null;
let drar = null;        // { id, fra: Vector3 } — drag i rigg-modus
let flytter = null;     // { id, fra: Vector3 } — Flytt-knappen: følger pekeren til neste trykk
let nedPos = null;
const KLIKK_PX = 8;

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

// Peker mot et rigg-objekt? (pick() i elements.js ser bare modellen.)
function pekRigg(x, y) {
  settNdc(x, y);
  raycaster.setFromCamera(_ndc, camera);
  const treff = raycaster.intersectObjects(riggGroup.children, true);
  for (const h of treff) {
    if (h.object.isSprite) continue;
    let o = h.object;
    while (o && !o.userData.riggId) o = o.parent;
    if (o && o.userData.riggId) return o;
  }
  return null;
}

// Svelger vi et pointerup kameraet fikk pointerdown til, må det få beskjed —
// se materiell.js. Det er billig, og det kan aldri bli feil.
function slippKamera(e) {
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
}

// ═══════════════════════ VALG OG KNAPPERADEN ═══════════════════════
function velg(id) {
  valgtId = id;
  S.riggValgtId = id;
  oppdaterRiggValgEffekt();
  oppdaterValgBar();
  if (S.riggModeBarTegn && S.mode === "rigg") S.riggModeBarTegn();
}

// tegnRigg() bygger objektene på nytt — effekten og knapperaden må på igjen
S.etterTegnRigg = () => { oppdaterRiggValgEffekt(); oppdaterValgBar(); };

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
    '<button id="rvLukk" class="btn" title="' + t("Ferdig") + '" style="padding:3px 8px">' + t("Ferdig") + "</button>";
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

// ═══════════════════════ MODUS ═══════════════════════
function iModus() { return S.mode === "rigg"; }

S.riggModeBar = (bar) => {
  S.riggModeBarTegn = () => {
    const hint = plasserer
      ? t("Trykk der objektet skal stå — Esc avbryter")
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
  if (!paa) avbrytPlassering();
  if (S.oppdaterModeBar) S.oppdaterModeBar();
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
  if (iModus()) {
    const g = pekRigg(e.clientX, e.clientY);
    if (g) {
      e.stopPropagation();
      velg(g.userData.riggId);
      drar = { id: g.userData.riggId, fra: g.position.clone() };
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
  if (!aktiv) return;
  if (drar) e.stopPropagation();
  const g = finnRiggObjekt(aktiv.id);
  const pt = g ? bakkePunkt(e.clientX, e.clientY) : null;
  if (pt && g) g.position.copy(pt);
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
  if (drar) {
    // Les tilstanden FØR slippKamera: pointercancel-lytteren under nullstiller
    // `drar` synkront (samme felle som materiell.js hadde 21.08).
    const d = drar; drar = null;
    e.stopPropagation(); slippKamera(e);
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

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
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
      " · " + o.L + " × " + o.B + " m" + (n > 1 ? " · ×" + n : "") + "</span></div>" +
      '<div class="c">' +
      '<button data-rigg-skjul="' + esc(o.id) + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(o.skjult ? "skjul" : "vis") + "</button>" +
      '<button data-rigg-slett="' + esc(o.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>";
  }).join("");

  // Oppsummeringen — det som skal bestilles
  const telling = riggTelling(S.rigg || []);
  if (telling.length) {
    html += '<h4 style="margin:12px 0 4px">' + t("Til bestilling") + "</h4>" +
      telling.map(r => '<div class="qty-row"><div class="n">' + esc(riggTypeLabel(r.type)) +
        '</div><div class="c">' + r.antall + t(" stk") + "</div></div>").join("") +
      "<p " + LITEN + ">" + t("Står også i Mengder under typen «Rigg», og kommer med i Excel-arket.") + "</p>";
  }

  html += '<h4 style="margin:14px 0 4px">' + ikon("lagre") + " " + t("Lagring") + "</h4>" +
    '<p id="riggLagringTekst" ' + LITEN + ">" + esc(lagringsTekst()) + "</p>";

  body.innerHTML = html;
  body.querySelectorAll("button[data-rigg-ny]").forEach(b => b.onclick = () => startPlassering(b.dataset.riggNy));
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
    felt("riggL", "Lengde (m)", o.L, 0.1, 30, 0.01) +
    felt("riggB", "Bredde (m)", o.B, 0.1, 30, 0.01) +
    felt("riggH", "Høyde (m)", o.H, 0.1, 15, 0.01) +
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
