// ✥ Verktøyene i modellen: juster elementender, splitt et element, marker
// utsparing ved å peke på flatene, og «Finn utsparinger».
//
// Én av åtte deler av SW-generatoren. js/veggelement.js er inngangen og
// samler dem; se toppen av den fila for hva generatoren gjør.
//
// DELENE PEKER PÅ HVERANDRE BEGGE VEIER, og det er med vilje: dette var én
// fil på 6500 linjer, og å rive den i atskilte lag ville vært en omskriving,
// ikke en oppdeling. ES-moduler tåler ringer så lenge navnene brukes når
// koden KJØRER, ikke mens modulen lastes — derfor står det bare
// registreringer av lyttere på toppnivå her, aldri utregninger som leser en
// konstant fra en annen del.

import * as THREE from "three";
import { $, S, apnePanel, esc, ikon } from "../state.js";
import { t } from "../i18n.js";
import { camera, canvas, raycaster } from "../scene.js";
import { allElementBoxes, hitID, pick } from "../elements.js";
import { SW_KLARING_MM, SW_MIN_BIT_MM, grupperFlater, sikreUtspTyper, snappKant, tilMm, tilScene, utspTypeNavn, utsparingFraFlater } from "./regler.js";
import { STD_OPPSETT, finnMark, just, lagret, okBetongNaa, oppsett, settFinnMark, settJust, skrivLagret, swGroup } from "./tilstand.js";
import { baseYNaa, boks, tegnAlt, tekstDekal, utspPaFasader } from "./tegning.js";
import { byggAlleStabler, byggInnerStabler, generer, loesAlleJusteringer, snappPunkter } from "./generer.js";
import { finnUtsparingKandidater, kandidatTilUtsparing, stalPaFasader } from "./stal.js";
import { innerData, lagretInner, skrivInner, tegnPanel } from "./panel.js";
import { avsluttInnerMark, byggAlleInnervegger, innerBaseY, innerForhandsvis, innerMark, oppdaterInnerveggerEtterUtsp, tegnInnerBar } from "./innervegg.js";

// ---------- ✥ Juster elementer: dra i endene ----------
// Emils ønske 02.09: trykk på et element og dra i enden for å stille lengden.
// Shift+klikk markerer flere, som dras samtidig. Kanten snapper til 10 mm fra
// søylesenter eller til søylekanten. Drar du inn i naboen blir den kortere, og
// under 100 mm forsvinner den — men kommer tilbake når du drar tilbake, fordi
// ingenting slettes: alt er avledet av basFraMm/basTilMm + dFra/dTil.
// Finner et justerbart element — vegg ELLER ringmurbit. Begge har id, basis og
// forskyvninger, og hele justeringen bryr seg ikke om hvilken av dem det er.
// HVILKEN LAGRING et element bor i. Ytterveggene ligger i `lagret`,
// innerveggene i `lagretInner` — og justeringsmodusen skal ikke vite forskjell
// (Emil 08.09: «juster element funker ikke på innervegger»). Flagget står på
// elementet selv, satt der det ble bygget.
export function butikkFor(v) {
  return v && v.inner ? lagretInner : lagret;
}

export function veggMedId(id) {
  for (const b of [lagret, lagretInner]) {
    if (!b) continue;
    const v = (b.vegger || []).find(w => w.id === id) ||
              (b.ringmur || []).find(r => r.id === id);
    if (v) return v;
  }
  return null;
}

// Hvilken liste et element bor i. Ringmurbiter og veggelementer justeres med
// samme kode (Emil 03.09), men de ligger i hver sin array — og nå i hver sin
// lagring også.
export function listeFor(v) {
  const b = butikkFor(v);
  if (!b) return [];
  return v && v.ringmur ? (b.ringmur = b.ringmur || [])
                        : (b.vegger = b.vegger || []);
}

// Lagrer den butikken elementet hører til. Et drag i en innervegg skal ikke
// skrive ytterveggene, og omvendt.
export function skrivFor(v) {
  if (v && v.inner) skrivInner(); else skrivLagret();
}

// Begge lagringene, når et drag kan ha tatt element fra begge (shift+klikk).
export function skrivBegge() {
  skrivLagret();
  if (lagretInner) skrivInner();
}

// Neste revisjonsnummer i elementets EGEN liste — en ringmurbit skal ikke
// arve revisjonen til et veggdrag.
export function nesteRev(v) {
  return 1 + Math.max(0, ...listeFor(v).map(w => w.rev || 0));
}

// Elementgruppa under pekeren, blant de genererte veggene
export function pekVeggEn(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1,
                                -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const treff = raycaster.intersectObjects(swGroup.children, true);
  for (const h of treff) {
    let o = h.object;
    while (o && o.userData.swId === undefined) o = o.parent;
    if (o && o.userData.swId !== undefined) {
      const v = veggMedId(o.userData.swId);
      if (v && !v.skjult) return { v, punkt: h.point };
    }
  }
  return null;
}

// Treffer ikke midt på, prøves en liten ring rundt pekeren. Et element sett
// nesten på kant er bare noen piksler bredt på skjermen, og da er et treff
// på millimeteren for mye å kreve.
export function pekVegg(cx, cy) {
  swGroup.updateMatrixWorld(true);   // matrisene må være ferske før raycast
  const treff = pekVeggEn(cx, cy);
  if (treff) return treff;
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
    const t = pekVeggEn(cx + dx, cy + dy);
    if (t) return t;
  }
  return null;
}

// Peker-posisjonen i fasade-mm: skjæringen mellom blikket og VEGGPLANET til
// elementet som dras. Da følger kanten pekeren uansett kameravinkel.
export const _jPlan = new THREE.Plane();
export const _jPkt = new THREE.Vector3();
export function fasadeMm(cx, cy, v) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1,
                                -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const n = new THREE.Vector3(v.nx, 0, v.nz).normalize();
  _jPlan.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(v.x, v.y, v.z));
  if (!raycaster.ray.intersectPlane(_jPlan, _jPkt)) return null;
  return tilMm((_jPkt.x - v.fx) * v.ex + (_jPkt.z - v.fz) * v.ez);
}

export function jBarEl() {
  let el = $("swJustBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swJustBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

export function tegnJustBar() {
  const el = jBarEl();
  if (!just) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  // Hva som er markert vises med mål, så det er synlig at trykket registrerte
  const valgtTekst = [...just.valgt]
    .map(id => veggMedId(id))
    .filter(Boolean)
    .map(v => (v.sw || (v.ringmur ? t("Ringmur") : "SW-XX")) + " " + v.lengdeMm + "×" + v.hoydeMm)
    .slice(0, 4)
    .join(", ");
  el.innerHTML =
    '<span style="font-size:12px;max-width:400px">' +
    t("Trykk på et veggelement og dra i enden for å stille lengden. Shift+klikk for å ta flere. Kanten snapper til søylene.") +
    ' <b>' + t("{0} valgt", just.valgt.size) + '</b>' +
    (valgtTekst ? ' <span style="color:var(--muted)">' + esc(valgtTekst) + '</span>' : "") +
    '</span>' +
    '<button id="swJustSplitt" style="padding:3px 10px"' + (just.valgt.size ? "" : " disabled") + '>✂ ' + t("Del i to") + '</button>' +
    '<button id="swJustNull" style="padding:3px 10px">' + t("Nullstill") + '</button>' +
    '<button id="swJustFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>';
  $("swJustSplitt").onclick = () => splittValgte();
  $("swJustNull").onclick = () => {
    const foer = justBilde();
    for (const v of [...((lagret && lagret.vegger) || []), ...((lagret && lagret.ringmur) || []),
                     ...((lagretInner && lagretInner.vegger) || []),
                     ...((lagretInner && lagretInner.ringmur) || [])])
      { v.dFra = 0; v.dTil = 0; v.rev = 0; }
    loesAlleJusteringer(); byggAlleStabler(); skrivBegge(); tegnAlt(); merkValgte();
    postJust("Justeringer nullstilt", foer);
  };
  $("swJustFerdig").onclick = () => avsluttJuster();
}

// Grønn kant rundt de markerte elementene
export function merkValgte() {
  if (!just) return;
  just.markorer.children.slice().forEach(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    just.markorer.remove(m);
  });
  for (const id of just.valgt) {
    const v = veggMedId(id);
    if (!v || v.skjult) continue;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(tilScene(v.lengdeMm), tilScene(v.hoydeMm)),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.40,
        side: THREE.DoubleSide, depthWrite: false }));
    const nv = new THREE.Vector3(v.nx, 0, v.nz).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    g.position.set(v.x, v.y, v.z).addScaledVector(nv, tilScene(v.tMm) / 2 + 0.02 / (S.enhetSkala || 1));
    g.renderOrder = 998;
    g.raycast = () => {};   // markeringen er bare til å se på
    just.markorer.add(g);
  }
}

// ---------- Angre/gjenopprett for justeringene ----------
// Elementene er rene tall, så et øyeblikksbilde av hele lista er nok — og da
// virker angre også på SPLITTER, som legger til et element.
// Angre-bildet må ta med BEGGE listene. Uten ringmuren ville et drag i den
// vært usynlig for angre — og et angre av et veggdrag ville dratt ringmuren
// tilbake til der den var før veggen ble rørt.
export function justBilde() {
  return JSON.parse(JSON.stringify({
    vegger: (lagret && lagret.vegger) || [],
    ringmur: (lagret && lagret.ringmur) || [],
    // Innerveggene MÅ med. Uten dem ville et angre av et drag i en innervegg
    // ikke gjort noe — og et angre av et ytterveggdrag ville dratt
    // innerveggene tilbake til der de sto før.
    iVegger: (lagretInner && lagretInner.vegger) || [],
    iRingmur: (lagretInner && lagretInner.ringmur) || []
  }));
}

export function settJustBilde(bilde) {
  if (!lagret) return;
  // Bakoverkompatibelt: et bilde tatt før ringmuren ble justerbar er en naken
  // array av vegger.
  const b = Array.isArray(bilde) ? { vegger: bilde, ringmur: lagret.ringmur } : bilde;
  lagret.vegger = JSON.parse(JSON.stringify(b.vegger || []));
  if (b.ringmur) lagret.ringmur = JSON.parse(JSON.stringify(b.ringmur));
  if (lagretInner && b.iVegger) {
    lagretInner.vegger = JSON.parse(JSON.stringify(b.iVegger));
    lagretInner.ringmur = JSON.parse(JSON.stringify(b.iRingmur || []));
  }
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
  if (just) { rensValgte(); merkValgte(); tegnJustBar(); }
  tegnPanel();
}

export function postJust(tekst, foer) {
  const etter = justBilde();
  if (JSON.stringify(foer) === JSON.stringify(etter)) return;   // ingenting skjedde
  if (S.pushAngre) S.pushAngre({
    tekst,
    angre: () => settJustBilde(foer),
    gjenopprett: () => settJustBilde(etter)
  });
}

// Etter angre kan et markert element være borte (en splitt ble angret)
export function rensValgte() {
  if (!just) return;
  for (const id of [...just.valgt]) if (!veggMedId(id)) just.valgt.delete(id);
}

// ---------- ✂ Splitt: del ett element i to ----------
// Deler på midten, med skjøteklaringen mellom halvdelene. Etterpå kan skjøten
// dras dit den skal — den nye halvdelen er et helt vanlig element.
export function splittKanter(fraMm, tilMm, klaringMm, minBitMm) {
  const k = Number(klaringMm) >= 0 ? Number(klaringMm) : SW_KLARING_MM;
  const min = Number(minBitMm) > 0 ? Number(minBitMm) : SW_MIN_BIT_MM;
  const midt = (fraMm + tilMm) / 2;
  const a = [fraMm, Math.round(midt - k)];
  const b = [Math.round(midt + k), tilMm];
  if (a[1] - a[0] < min || b[1] - b[0] < min) return null;   // for lite å dele
  return [a, b];
}

export function splittValgte() {
  if (!just) return;
  const foer = justBilde();
  const o = (lagret && lagret.oppsett) || STD_OPPSETT;
  let delt = 0;
  for (const id of [...just.valgt]) {
    const v = veggMedId(id);
    if (!v || v.skjult) continue;
    // Klaringen tas fra den veggen elementet FAKTISK står i: en innervegg kan
    // ha en annen skjøt enn ytterveggene.
    const kl = v.inner
      ? (((lagretInner && (lagretInner.fasader || [])[v.fi]) || {}).o || {}).klaringMm
      : o.klaringMm;
    const kanter = splittKanter(v.fraMm, v.tilMm, kl === undefined ? o.klaringMm : kl, SW_MIN_BIT_MM);
    if (!kanter) continue;
    const rev = nesteRev(v);
    const ny = JSON.parse(JSON.stringify(v));
    ny.id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // begge halvdelene får ny BASIS og nullede forskyvninger — da er de
    // vanlige elementer som kan dras videre hver for seg
    v.basFraMm = kanter[0][0]; v.basTilMm = kanter[0][1]; v.dFra = 0; v.dTil = 0; v.rev = rev;
    ny.basFraMm = kanter[1][0]; ny.basTilMm = kanter[1][1]; ny.dFra = 0; ny.dTil = 0; ny.rev = rev;
    // full feltlengde arves, så begge halvdelene regnes som kapp
    const liste = listeFor(v);
    liste.splice(liste.indexOf(v) + 1, 0, ny);
    just.valgt.add(ny.id);
    delt++;
  }
  if (!delt) { alert(t("Elementet er for kort å dele — hver halvdel må bli minst 100 mm.")); return; }
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
  merkValgte();
  tegnJustBar();
  postJust("Veggelement delt", foer);
}

export function startJuster() {
  const antYtre = ((lagret && lagret.vegger) || []).length;
  const antIndre = ((lagretInner && lagretInner.vegger) || []).length;
  if (!antYtre && !antIndre) { alert(t("Generer veggelementene først.")); return; }
  // Migrer og tegn på nytt FØR modusen åpnes: en ringmur laget av en eldre
  // versjon mangler id-en plukkingen trenger, og da klikket man rett gjennom
  // muren og traff søyla bak (Emil 03.09). Etter migreringen bærer hver bit
  // id-en, og tegninga må gjøres om for at meshen skal få den.
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
  const markorer = new THREE.Group();
  swGroup.add(markorer);
  settJust({ valgt: new Set(), drar: null, markorer });
  $("swPanel").classList.remove("open");
  tegnJustBar();
}

export function avsluttJuster() {
  if (!just) return;
  just.markorer.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(just.markorer);
  settJust(null);
  tegnJustBar();
  tegnPanel();
  apnePanel("swPanel");
}

window.addEventListener("pointerdown", (e) => {
  if (!just || e.button !== 0 || e.target !== canvas) return;
  const treff = pekVegg(e.clientX, e.clientY);
  just.ned = { x: e.clientX, y: e.clientY };
  if (!treff || !treff.v) { just.drar = null; return; }
  const v = treff.v;
  if (e.shiftKey) {
    if (just.valgt.has(v.id)) just.valgt.delete(v.id); else just.valgt.add(v.id);
    e.stopPropagation();
    merkValgte(); tegnJustBar();
    return;
  }
  if (!just.valgt.has(v.id)) { just.valgt.clear(); just.valgt.add(v.id); }
  const startMm = fasadeMm(e.clientX, e.clientY, v);
  if (startMm === null) return;
  // Hvilken ENDE dras? Den halvparten av elementet trykket havnet i.
  const ende = startMm < (v.fraMm + v.tilMm) / 2 ? "fra" : "til";
  const rev = nesteRev(v);
  const base = new Map();
  for (const id of just.valgt) {
    const w = veggMedId(id);
    if (w) base.set(id, { dFra: w.dFra || 0, dTil: w.dTil || 0 });
  }
  just.drar = { id: v.id, ende, startMm, base, rev, foer: justBilde() };
  e.stopPropagation();   // kameraet skal ikke rotere mens vi drar
  merkValgte(); tegnJustBar();
}, true);

window.addEventListener("pointermove", (e) => {
  if (!just || !just.drar) return;
  const d = just.drar;
  const v = veggMedId(d.id);
  if (!v) return;
  const naMm = fasadeMm(e.clientX, e.clientY, v);
  if (naMm === null) return;
  const b = d.base.get(d.id) || { dFra: 0, dTil: 0 };
  const basKant = d.ende === "fra" ? v.basFraMm + b.dFra : v.basTilMm + b.dTil;
  // kanten snappes, og SAMME forskyvning gis til alle markerte
  const snappet = snappKant(basKant + (naMm - d.startMm), snappPunkter(v), 150);
  const delta = Math.round(snappet - basKant);
  for (const id of just.valgt) {
    const w = veggMedId(id);
    const wb = d.base.get(id);
    if (!w || !wb) continue;
    if (d.ende === "fra") w.dFra = wb.dFra + delta; else w.dTil = wb.dTil + delta;
    w.rev = d.rev;
  }
  loesAlleJusteringer();
  tegnAlt();
  merkValgte();
  e.stopPropagation();
}, true);

window.addEventListener("pointerup", (e) => {
  if (!just || e.button !== 0) return;
  if (!just.drar) { just.ned = null; return; }
  const foer = just.drar.foer;
  just.drar = null;
  just.ned = null;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
  merkValgte();
  tegnJustBar();
  postJust("Veggelement justert", foer);
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && just) { e.stopPropagation(); avsluttJuster(); }
}, true);

// ---------- 🎯 Marker utsparing: trykk på FLATENE rundt åpningen ----------
// Emils regel (runde 3): trykk på ÉN flate per side — innsiden av søylene på
// hver side, undersiden av bjelken over, evt. oversiden av en bjelke under.
// Hvert trykk gir treffpunkt + flatenormal; utsparingFraFlater regner boksen.
// Kameraet virker som vanlig underveis (bare selve KLIKKET fanges), og små
// markører viser hvilke flater som er valgt.
export let utspMark = null;   // { flater: [], ned: {x,y}, prikker: Group } når aktiv

export function utspBarEl() {
  let el = $("swUtspBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swUtspBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

export function tegnUtspBar() {
  const el = utspBarEl();
  if (!utspMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML =
    '<span style="font-size:12px;max-width:340px">' +
    t("Trykk på flatene rundt åpningene: innsiden av søylene på sidene, undersiden av bjelken over. Én flate per side — du kan markere flere åpninger før Ferdig.") +
    ' <b>' + t("{0} flater valgt", utspMark.flater.length) + '</b></span>' +
    '<button id="swUtspFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>' +
    '<button id="swUtspAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
  $("swUtspFerdig").onclick = fullforUtspMark;
  $("swUtspAvbryt").onclick = () => avsluttUtspMark();
}

// `forInner` = true når markeringen hører til den innerveggen som redigeres.
// Da havner boksene på SERIEN, ikke i del A-oppsettet: en dør i en innervegg
// skal ikke kappe ytterveggen bak den.
export function startUtspMark(forInner) {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  const prikker = new THREE.Group();
  swGroup.add(prikker);
  utspMark = { flater: [], ned: null, prikker, inner: !!forInner };
  $("swPanel").classList.remove("open");   // panelet i veien for modellen
  tegnInnerBar();                          // innerveggbaren viker for denne
  tegnUtspBar();
}

export function avsluttUtspMark() {
  if (!utspMark) return;
  utspMark.prikker.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(utspMark.prikker);
  utspMark = null;
  tegnUtspBar();
  tegnInnerBar();          // står vi i en innervegg, kommer baren tilbake
  tegnPanel();
  apnePanel("swPanel");
}

export function fullforUtspMark() {
  if (!utspMark) return;
  const e = S.enhetSkala || 1;
  // flater innenfor 4 m hører til samme åpning — da kan alle åpningene
  // markeres i én omgang og Ferdig trykkes til slutt (Emils runde 5)
  const klynger = grupperFlater(utspMark.flater, 4.0 / e);
  // 🚪 Innerveggens åpninger bor på SERIEN som redigeres; ytterveggenes i
  // del A-oppsettet. Samme markering, to mottakere.
  const tilInner = utspMark.inner && innerMark && innerMark.steg === "side" && !innerMark.fasade;
  const o = oppsett();
  const maal = tilInner
    ? (innerMark.serie.utsparinger = (innerMark.serie.utsparinger || []).filter(x => x && x.min))
    : (o.utsparinger = (o.utsparinger || []).filter(x => x && x.min));
  let lagt = 0, feilet = 0;
  for (const kl of klynger) {
    const u = utsparingFraFlater(kl, 0.5 / e);
    if (u.feil) { feilet++; continue; }
    lagt++;
    maal.push({ min: u.min, max: u.max, akse: u.akse, flater: u.antFlater, kilde: u.kilde });
  }
  // 🚪 type etter startforslaget og navn «Port 1» / «Dør 2» / «Vindu 3» (punkt 1).
  // OK betong: innerveggens egen når den er bygget, ellers byggets.
  sikreUtspTyper(maal, tilInner && innerMark.bygd && innerMark.bygd.okBetong !== undefined
    ? innerMark.bygd.okBetong : okBetongNaa());
  if (!lagt) {
    alert(t("Utsparingen trenger to motstående sider — trykk på innsiden av søylene på hver side av åpningen."));
    return;
  }
  if (!tilInner) skrivLagret();
  avsluttUtspMark();
  if (tilInner) innerForhandsvis();
  // 🚪 EMILS FUNN 08.09: han markerte en dør til innerveggen med den vanlige
  // «Marker utsparing», den ble lagret som «Utsparing 14» — og ingenting
  // skjedde med veggen. Åpningen lå i den globale lista, og innerveggene ble
  // aldri bygget på nytt. Nå gjør de det, og døra kapper veggen den står i.
  else oppdaterInnerveggerEtterUtsp();
  if (feilet) alert(t("{0} utsparinger lagt til — {1} område manglet to motstående sider og ble hoppet over.", lagt, feilet));
}

// Klikkene fanges på window i FANGSTFASEN (samme oppskrift som materiell.js):
// kameraet får dra som vanlig — bare et trykk under 8 px behandles, og da
// stoppes det FØR elementvalget i main.js ser det.
// Trykket må ha landet PÅ lerretet. Uten denne sjekken fanget window-lytteren
// også trykk på knappene i modus-baren (#swUtspBar ligger over lerretet), og
// «Ferdig»/«Avbryt» plukket i tillegg flata bak knappen (Emils funn 03.09).
// Samme guard som overCanvas() i materiell.js.
window.addEventListener("pointerdown", (e) => {
  if (!utspMark || e.button !== 0) return;
  if (e.target !== canvas) { utspMark.ned = null; return; }
  utspMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!utspMark || e.button !== 0 || !utspMark.ned) return;
  if (e.target !== canvas) { utspMark.ned = null; return; }
  const ned = utspMark.ned;
  utspMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  e.stopPropagation();
  // Kameraet fikk pointerdown-en (rotasjon skal virke i modusen) — svelger vi
  // pointerup-en uten å rydde, blir kameraet stående og tro at knappen holdes
  // og «låser seg i rotasjon». Samme kur som materiell.js: syntetisk
  // pointercancel, som SimpleControls håndterer fra før.
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const hit = pick(e.clientX, e.clientY);
  if (!hit || !hit.face) return;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  // IFC-geometri har ofte vilkårlig vindingsretning — normalen kan like
  // gjerne peke INN i søylen som ut. Men flata brukeren SER har alltid
  // normalen sin MOT kameraet: peker den med blikket, snus den. Det var
  // dette som ga «trenger to motstående sider» med 17 flater valgt
  // (Emils skjermbilde 01.09 18:14).
  if (n.dot(raycaster.ray.direction) > 0) n.multiplyScalar(-1);
  // elementets boks følger med: endene av markerte søyler/bjelker fyller ut
  // sidene som ikke er markert (Emils regel runde 6)
  const bid = hitID(hit);
  const bb = bid != null ? allElementBoxes().get(bid) : null;
  // ANDRE TRYKK PÅ SAMME FLATE FJERNER MARKERINGEN (Emil 08.09, punkt 2a).
  // Før ble flata markert to ganger; nå skrus den av, så et feiltrykk angres
  // med et nytt trykk. «Samme flate» = element-id + hvilken SIDE av elementet.
  const nokkel = flateNokkel(bid, n);
  const iSamme = finnSammeFlate(utspMark.flater, nokkel);
  if (iSamme >= 0) {
    const [bort] = utspMark.flater.splice(iSamme, 1);
    if (bort.merke) {
      utspMark.prikker.remove(bort.merke);
      if (bort.merke.geometry) bort.merke.geometry.dispose();
      if (bort.merke.material) bort.merke.material.dispose();
    }
    tegnUtspBar();
    return;
  }
  // hele SIDEN av elementet farges blå — som når sammenligningen farger
  // elementer, bare for én flate (Emils runde 4). Flaten finnes fra
  // elementets boks: kvadranten som normalen peker ut av.
  const merke = byggFlateMerke(hit, n);
  utspMark.prikker.add(merke);
  utspMark.flater.push({ p: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
                         n: { x: n.x, y: n.y, z: n.z },
                         boks: bb ? { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
                                      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } } : undefined,
                         nokkel, merke });
  tegnUtspBar();
}, true);

// Hvilken side av elementet en flatenormal peker ut av: den dominerende aksen
// med fortegn — «x+», «y−», «z+». Rene tall, testes i Node.
export function flateSide(n) {
  const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? "x"
    : Math.abs(n.y) >= Math.abs(n.z) ? "y" : "z";
  return ax + (n[ax] >= 0 ? "+" : "−");
}
// Nøkkelen for «samme flate»: element-id + side. Uten element (trykk i lufta
// eller på noe uten id) finnes ingen nøkkel, og trykket legges alltid til.
export function flateNokkel(id, n) {
  return id == null ? null : String(id) + "|" + flateSide(n);
}
export function finnSammeFlate(flater, nokkel) {
  if (!nokkel) return -1;
  return (flater || []).findIndex(f => f && f.nokkel === nokkel);
}

// Blå, halvgjennomsiktig plate lagt oppå siden brukeren trykket på.
export function byggFlateMerke(hit, n) {
  const id = hitID(hit);
  const b = id != null ? allElementBoxes().get(id) : null;
  const løft = 0.015 / (S.enhetSkala || 1);   // 15 mm ut, mot z-fighting
  let w = 0.4 / (S.enhetSkala || 1), h = w;
  const senter = hit.point.clone();
  if (b) {
    const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? "x"
      : Math.abs(n.y) >= Math.abs(n.z) ? "y" : "z";
    if (ax === "x") { w = b.max.z - b.min.z; h = b.max.y - b.min.y; }
    else if (ax === "y") { w = b.max.x - b.min.x; h = b.max.z - b.min.z; }
    else { w = b.max.x - b.min.x; h = b.max.y - b.min.y; }
    senter.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    senter[ax] = n[ax] >= 0 ? b.max[ax] : b.min[ax];
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false }));
  const nv = new THREE.Vector3(n.x, n.y, n.z).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
  m.position.copy(senter).addScaledVector(nv, løft);
  m.renderOrder = 997;
  return m;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && utspMark) { e.stopPropagation(); avsluttUtspMark(); }
}, true);

// ═══════════════════ 🔍 «FINN UTSPARINGER» — FORESLÅ OG GODKJENN ═══════════════════
// Kandidatene (finnUtsparingKandidater) tegnes stiplet med mål i 3D, og baren
// sier «N åpninger funnet». Et trykk på en kandidat slår den av eller på, og
// «Godkjenn» legger inn dem som står igjen. INGENTING legges inn uten
// godkjenning (Emils valg).
// (finnMark er deklarert ved siden av `just`, fordi ryddTegning() må se den)

export function finnBarEl() {
  let el = $("swFinnBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swFinnBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}
export function tegnFinnBar() {
  const el = finnBarEl();
  if (!finnMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const n = finnMark.kandidater.length, paa = finnMark.kandidater.filter(c => c.paa).length;
  el.innerHTML =
    '<span style="font-size:12px;max-width:380px"><b>' + t("{0} åpninger funnet", n) + '</b> · ' +
    t("{0} valgt", paa) + '<br>' +
    t("Trykk på en åpning i modellen for å slå den av eller på. Godkjenn legger inn dem som står igjen.") + '</span>' +
    '<button id="swFinnGodkjenn" class="primary" style="padding:3px 10px"' + (paa ? "" : " disabled") + '>✓ ' + t("Godkjenn {0}", paa) + '</button>' +
    '<button id="swFinnAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
  $("swFinnGodkjenn").onclick = finnGodkjenn;
  $("swFinnAvbryt").onclick = () => avsluttFinn();
}

export async function startFinnUtsp() {
  if (!lagret || !(lagret.fasader || []).length) { alert(t("Generer veggelementene først.")); return; }
  if (utspMark) avsluttUtspMark();
  if (innerMark) avsluttInnerMark();
  if (just) avsluttJuster();
  if (finnMark) avsluttFinn();
  const o = oppsett();
  const baseY = baseYNaa();
  // 🚪 OGSÅ INNERVEGGENE (Emil 09.09: døra i innerveggen på Arendal manglet).
  // Ytterveggene først (fi 0…n−1), så innerveggenes bein (fi n…). Hver vegg
  // husker hvor den kom fra, sitt eget oppsett, sin egen base og sin egen
  // OK betong — en mesaninvegg står høyere enn gulvet.
  const d = innerData();
  const vegger = lagret.fasader.map((f, fi) => ({
    f, inner: false, fi, o, baseY,
    okBetongMm: tilMm((lagret.okBetong || 0) - baseY),
    toppMm: Math.max(0, ...(lagret.vegger || []).filter(v => v && v.fi === fi && !v.ringmur).map(v => (v.rBunnMm || 0) + (v.hoydeMm || 0)))
  })).concat((d.fasader || []).map((f, fi) => {
    const fo = { ...INNER_STD, ...(f.o || {}) };
    const fBase = f.baseY !== undefined ? f.baseY : innerBaseY();
    return {
      f, inner: true, fi, o: fo, baseY: fBase,
      okBetongMm: tilMm((f.okBetong !== undefined ? f.okBetong : fBase) - fBase),
      toppMm: Math.max(0, ...(d.vegger || []).filter(v => v && v.fi === fi && !v.ringmur).map(v => (v.rBunnMm || 0) + (v.hoydeMm || 0)))
    };
  }));
  // stålet projiseres på ALLE veggene i én omgang (nærmeste vegg vinner), med
  // ytterveggenes base — innerveggenes høyder regnes om til deres egen base
  const stalAlle = await stalPaFasader(vegger.map(v => v.f), o, baseY);
  for (const r of stalAlle) {
    const v = vegger[r.fi];
    if (v && v.baseY !== baseY) { const dMm = tilMm(baseY - v.baseY); r.bunnMm += dMm; r.toppMm += dMm; }
  }
  const finnes = utspPaFasader().concat((d.utspVis || []).map(a => ({ ...a, fi: a.fi + lagret.fasader.length })));
  const fasInfo = vegger.map(v => ({ lengdeMm: tilMm(Math.abs(v.f.t1 - v.f.t0)), toppMm: v.toppMm, okBetongMm: v.okBetongMm, skjot: v.f.skjot || [] }));
  const kand = finnUtsparingKandidater(stalAlle, fasInfo, finnes);
  if (!kand.length) { alert(t("Fant ingen åpninger under losholter på fasadene.")); return; }
  settFinnMark({ kandidater: kand.map(k => ({ k, paa: true, mesh: null })), vegger, gruppe: new THREE.Group(), ned: null });
  swGroup.add(finnMark.gruppe);
  tegnFinnKandidater();
  tegnFinnBar();
}

export function avsluttFinn() {
  if (!finnMark) return;
  finnMark.gruppe.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(finnMark.gruppe);
  settFinnMark(null);
  tegnFinnBar();
}

// Stiplet ramme + kryss, en halvgjennomsiktig plate å trykke på (blå = på,
// grå = av) og en lapp med type og mål — samme språk som utsparingsmerkingen.
export function tegnFinnKandidater() {
  if (!finnMark) return;
  const g = finnMark.gruppe;
  g.children.slice().forEach(m => {
    m.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    g.remove(m);
  });
  finnMark.kandidater.forEach((c, i) => {
    const v = finnMark.vegger[c.k.fi];
    if (!v) return;
    const k = c.k, f = v.f, o = v.o, baseY = v.baseY;
    const utD = f.off + tilScene(o.tykkelseMm) / 2 + 0.05 / (S.enhetSkala || 1);
    const pkt = (mm, y) => new THREE.Vector3(f.px + f.ex * tilScene(mm) + f.nx * utD, y, f.pz + f.ez * tilScene(mm) + f.nz * utD);
    const y0 = baseY + tilScene(k.bunnMm), y1 = baseY + tilScene(k.toppMm);
    const h0 = pkt(k.fraMm, y0), h1 = pkt(k.tilMm_, y0), t0 = pkt(k.fraMm, y1), t1 = pkt(k.tilMm_, y1);
    const linje = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([h0, h1, h1, t1, t1, t0, t0, h0, h0, t1, h1, t0]),
      new THREE.LineDashedMaterial({ color: c.paa ? 0x1d4ed8 : 0x777777,
        dashSize: 0.12 / (S.enhetSkala || 1), gapSize: 0.08 / (S.enhetSkala || 1) }));
    linje.computeLineDistances();
    linje.raycast = () => {};
    g.add(linje);
    const nv = new THREE.Vector3(f.nx, 0, f.nz).normalize();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(tilScene(k.tilMm_ - k.fraMm), 1e-6), Math.max(y1 - y0, 1e-6)),
      new THREE.MeshBasicMaterial({ color: c.paa ? 0x3b82f6 : 0x888888, transparent: true,
        opacity: c.paa ? 0.35 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
    plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    plate.position.copy(pkt((k.fraMm + k.tilMm_) / 2, (y0 + y1) / 2));
    plate.renderOrder = 996;
    plate.userData.finnIdx = i;
    g.add(plate);
    c.mesh = plate;
    const bredde = Math.round(k.tilMm_ - k.fraMm), hoyde = Math.round(k.toppMm - k.bunnMm);
    const lapp = tekstDekal((c.paa ? "" : "✕ ") + utspTypeNavn(k.type).toUpperCase() + " " + bredde + "×" + hoyde + " MM", 260,
      tilScene(Math.max(bredde * 0.8, 600)));
    lapp.quaternion.copy(plate.quaternion);
    lapp.position.copy(pkt((k.fraMm + k.tilMm_) / 2, (y0 + y1) / 2)).addScaledVector(nv, 0.02 / (S.enhetSkala || 1));
    lapp.raycast = () => {};
    g.add(lapp);
  });
}

export async function finnGodkjenn() {
  if (!finnMark) return;
  const valgte = finnMark.kandidater.filter(c => c.paa);
  if (!valgte.length) { avsluttFinn(); return; }
  const o = oppsett();
  const d = innerData();
  o.utsparinger = (o.utsparinger || []).filter(x => x && x.min);
  let ytre = 0, indre = 0;
  for (const c of valgte) {
    const v = finnMark.vegger[c.k.fi];
    if (!v) continue;
    if (!v.inner) {
      o.utsparinger.push(kandidatTilUtsparing(c.k, v.f, v.baseY, v.o.tykkelseMm));
      ytre++;
    } else {
      // 🚪 en åpning i en innervegg hører til DEN veggens serie — som om
      // Emil hadde markert den med innerveggens egen «Marker utsparing»
      const serie = d.serier[v.f.serieIdx];
      if (!serie) continue;
      serie.utsparinger = (serie.utsparinger || []).filter(x => x && x.min);
      serie.utsparinger.push(kandidatTilUtsparing(c.k, v.f, v.baseY, v.o.tykkelseMm));
      indre++;
    }
  }
  sikreUtspTyper(o.utsparinger, okBetongNaa());
  skrivLagret();
  avsluttFinn();
  if (ytre) {
    await generer();                 // ytterveggene kappes rundt de nye åpningene
    oppdaterInnerveggerEtterUtsp();  // en åpning kan også stå i en innervegg
  }
  if (indre) {
    await byggAlleInnervegger();     // innerveggene kappes rundt sine
    byggInnerStabler();
    skrivInner();
    tegnAlt();
  }
  tegnPanel();
}

// Trykk på en kandidat slår den av/på — samme fangst som de andre modusene.
window.addEventListener("pointerdown", (e) => {
  if (!finnMark || e.button !== 0) return;
  if (e.target !== canvas) { finnMark.ned = null; return; }
  finnMark.ned = { x: e.clientX, y: e.clientY };
}, true);
window.addEventListener("pointerup", (e) => {
  if (!finnMark || e.button !== 0 || !finnMark.ned) return;
  if (e.target !== canvas) { finnMark.ned = null; return; }
  const ned = finnMark.ned;
  finnMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  const nd = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(nd, camera);
  const treff = raycaster.intersectObjects(finnMark.kandidater.map(c => c.mesh).filter(Boolean), false);
  if (!treff.length) return;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const c = finnMark.kandidater[treff[0].object.userData.finnIdx];
  if (c) c.paa = !c.paa;
  tegnFinnKandidater();
  tegnFinnBar();
}, true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && finnMark) { e.stopPropagation(); avsluttFinn(); }
}, true);

// Én linje under målene som viser HVOR grensene kom fra. En firkantet åpning
// har bare to mål (bredde × høyde) uansett hvor mange flater som markeres —
// denne linja viser at den tredje og fjerde flata faktisk ble brukt, og hva
// som ble fylt automatisk (Emil runde 7: «markert 3 sider, bare 2 mål»).
export function utspKildeTekst(u) {
  const biter = [];
  if (u.flater) biter.push(t("{0} flater markert", u.flater));
  const k = u.kilde || {};
  if (k.topp === "flate") biter.push(t("topp fra flate"));
  else if (k.topp === "ender") biter.push(t("topp fra søyleendene"));
  else if (k.topp === "åpen") biter.push(t("topp åpen"));
  if (k.bunn === "flate") biter.push(t("bunn fra flate"));
  else if (k.bunn === "ender") biter.push(t("bunn fra søyleendene"));
  else if (k.bunn === "åpen") biter.push(t("bunn: gulvet"));
  if (k.sider === "ender") biter.push(t("side fra bjelkeendene"));
  // 🔍 funnet av «Finn utsparinger»
  if (k.topp === "losholt") biter.push(t("funnet under losholt"));
  if (k.bunn === "bjelke") biter.push(t("bunn fra bjelke"));
  return biter.join(" · ");
}

// 📋 UTSPARINGSLISTA ER SAMMENFOLDET (Emil 08.09, punkt 2b): de 3 nyeste
// vises, nyeste øverst, og en pil åpner resten. Ren deling, testes i Node.
// `i` er plassen i den lagrede lista — den bruker slett- og type-knappene.
export const UTSP_VIS_NYESTE = 3;
export function delUtspListe(utsp) {
  const alle = (utsp || []).map((u, i) => ({ u, i })).reverse();   // nyeste først
  return { nyeste: alle.slice(0, UTSP_VIS_NYESTE), eldre: alle.slice(UTSP_VIS_NYESTE) };
}

// ÉN radfunksjon for begge listene (del A og innerveggens egen), så de ikke
// drifter fra hverandre: samme navn, samme mål, samme knapper.
export function utspRadHtml(u, i, slettAttr, visKilde) {
  const kilde = visKilde ? utspKildeTekst(u) : "";
  const typeAttr = slettAttr.replace("slett", "type");
  return '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(u.navn || ("#" + (i + 1))) +
    ' <span style="color:var(--muted)">' +
    Math.round(tilMm(Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2]))) + "×" +
    (u.max[1] - u.min[1] > 1e8 ? t("full høyde") : Math.round(tilMm(u.max[1] - u.min[1])) + " mm") + "</span>" +
    (kilde ? '<br><span style="color:var(--muted);font-size:11px">' + esc(kilde) + "</span>" : "") +
    "</div>" +
    // 🚪 Type-knappen ved siden av slett: bytter til neste type (Port → Dør →
    // Vindu → Port), og typen står i klartekst på knappen (punkt 1)
    '<div class="c" style="display:flex;gap:4px"><button ' + typeAttr + '="' + i + '" title="' + esc(t("Bytt type (Port, Dør, Vindu)")) +
    '" style="padding:3px 8px;font-size:11px">' + esc(utspTypeNavn(u.type)) + '</button>' +
    '<button ' + slettAttr + '="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>';
}
export function utspListeHtml(utsp, slettAttr, tomTekst, visKilde) {
  if (!utsp.length) return '<p style="color:var(--muted);font-size:12px">' + esc(tomTekst) + '</p>';
  const { nyeste, eldre } = delUtspListe(utsp);
  let html = nyeste.map(r => utspRadHtml(r.u, r.i, slettAttr, visKilde)).join("");
  if (eldre.length) {
    // <details> holder tilstanden selv: sammenfoldet er standard, og den
    // trenger ikke huskes mellom økter (Emils valg).
    html += '<details class="sw-utsp-eldre"><summary style="cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0">' +
      esc(t("Vis {0} eldre utsparinger", eldre.length)) + '</summary>' +
      eldre.map(r => utspRadHtml(r.u, r.i, slettAttr, visKilde)).join("") + '</details>';
  }
  return html;
}
