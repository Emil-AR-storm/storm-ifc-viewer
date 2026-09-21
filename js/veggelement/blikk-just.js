// 🔧💾 BLIKKET SOM LAGRET RESULTAT, OG HÅNDJUSTERINGEN — runde 2b (Emil 18.09).
//
// «i del 2b vil jeg at sluttresultatet er at 'blikk' har samme oppsett som
// 'SW-generator' med 'generer blikk' 'juster element' 'last ned
// instruksjonstegning' 'last ned liste (excel)' 'fjern genererte' og 'lagrede
// resultat seksjon'».
//
// ── ÉN AVKLARING, SAGT RETT UT ────────────────────────────────────────────
// «Generer blikk» og «Fjern genererte» høres ut som at blikket fryses til tall
// ved generering. Det gjør det IKKE, og det er med vilje. Emils valg A2 var at
// blikket skal følge veggene av seg selv, og hele grunnen til at verktøyet
// finnes er at Excel-arket skal være 100 % riktig — et frosset blikk ville vist
// gårsdagens vegg så snart et element ble dratt.
//
// Derfor er «Generer blikk» en BRYTER med et hjem:
//   · den slår blikket PÅ og gir det et sted å bo (`lagret.blikk`)
//   · så lenge det er på, regnes blikket om av seg selv når veggene tegnes
//   · håndjusteringene ligger i det hjemmet og overlever en ny generering,
//     akkurat som `dFra`/`dTil` gjør på et veggelement
//   · «Fjern genererte» slår det av og tømmer justeringene
//
// Det er «generer» slik SW-generatoren mener det: du sier fra én gang, og så
// er resultatet der og holder seg riktig.
import { $, apnePanel, esc, S } from "../state.js";
import { camera, canvas, raycaster } from "../scene.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { blikkStykkeId } from "../sw-blikk.js";
import { flettPaaNavn, spLes, spPaalogget, spSkriv } from "../sp-lager.js";
import { tilMm, tilScene } from "./regler.js";
import { lagret, skrivLagret, swGroup } from "./tilstand.js";
import { tegnAlt } from "./tegning.js";

// ───────────────────── på/av og hjemmet for justeringene ─────────────────────

export const BLIKK_STD_TILSTAND = { pa: false, just: {}, ekstra: [], nesteNr: 1, materiellIder: [] };

// Hjemmet. Lages ved første bruk, og migrerer en eldre lagring som ikke har
// det i det hele tatt — der var blikket alltid på, så `pa` settes til true når
// det finnes veggelement, ellers hadde blikket forsvunnet for alle som
// allerede bruker det.
export function blikkTilstand() {
  if (!lagret) return { ...BLIKK_STD_TILSTAND };
  if (!lagret.blikk || typeof lagret.blikk !== "object")
    lagret.blikk = { ...BLIKK_STD_TILSTAND, pa: !!(lagret.vegger || []).length };
  const b = lagret.blikk;
  if (typeof b.pa !== "boolean") b.pa = true;
  if (!b.just || typeof b.just !== "object") b.just = {};
  if (!Array.isArray(b.ekstra)) b.ekstra = [];
  if (!(Number(b.nesteNr) > 0)) b.nesteNr = 1;
  if (!Array.isArray(b.materiellIder)) b.materiellIder = [];
  return b;
}

export function blikkPa() { return !!(lagret && blikkTilstand().pa); }

export function generertAntall() {
  const b = lagret && lagret.blikk;
  return b && b.pa ? Number(b.antall) || 0 : 0;
}

// «Generer blikk». Slår på, rydder bort et tomt hjem fra en tidligere runde,
// og tegner alt på nytt. Tallene regnes av tegningen — her settes bare bryteren.
export function genererBlikk() {
  if (!lagret || !(lagret.vegger || []).length) {
    alert(t("Generer veggelementene først.")); return false;
  }
  const b = blikkTilstand();
  b.pa = true;
  b.tid = new Date().toISOString();
  skrivLagret();
  tegnAlt();
  return true;
}

// «Fjern genererte». Blikket forsvinner fra 3D, panelet og arket — og
// justeringene med det, for de hører til et blikk som ikke finnes lenger.
// Spør først når det er noe å miste.
export function fjernBlikk() {
  const b = lagret && lagret.blikk;
  if (!b || !b.pa) return false;
  const harJust = Object.keys(b.just || {}).length + (b.ekstra || []).length;
  if (harJust && !confirm(t("Fjerne blikket? De {0} håndjusteringene forsvinner også.", harJust)))
    return false;
  if (blikkJust) avsluttBlikkJuster();
  lagret.blikk = { ...BLIKK_STD_TILSTAND };
  skrivLagret();
  tegnAlt();
  return true;
}

// ───────────────────── 💾 lagrede blikkresultater ─────────────────────
//
// Egen lagring, egen SharePoint-mappe. Blikket kan justeres for seg uten at et
// lagret SW-resultat røres, og to blikkoppsett kan prøves mot samme vegg.

export function blikkLagredeNokkel() { return "storm-ifc-blikk-lagrede::" + S.fileName; }
export const BLIKK_SP_MAPPE = "Blikk-resultater";
export function blikkSpFil() { return S.fileName + ".blikk.json"; }
export let blikkSpStatus = "av";     // "av" | "ok" | "feil"

export function lesBlikkLagredeRaa() {
  try {
    const l = JSON.parse(localStorage.getItem(blikkLagredeNokkel()) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (_) { return []; }
}
export function lesBlikkLagrede() {
  return lesBlikkLagredeRaa().filter(p => p && !p.slettet)
    .sort((a, b) => String(b.endret || b.dato || "").localeCompare(String(a.endret || a.dato || "")));
}
export function skrivBlikkLagrede(liste) {
  try { localStorage.setItem(blikkLagredeNokkel(), JSON.stringify(liste)); return true; }
  catch (_) { return false; }
}

// Lokalt først, så SharePoint — som SW-resultatene. Uten dekning skal arbeidet
// likevel være lagret når fanen lukkes.
export function lagreBlikkBeggeSteder(liste, etterpa) {
  if (!skrivBlikkLagrede(liste)) return false;
  if (!spPaalogget()) { blikkSpStatus = "av"; return true; }
  spSkriv(BLIKK_SP_MAPPE, blikkSpFil(), liste).then(res => {
    blikkSpStatus = res.ok ? "ok" : "feil";
    if (res.ok && res.liste) skrivBlikkLagrede(res.liste);
    if (etterpa) etterpa();
  });
  return true;
}

export async function hentBlikkLagredeFraSp(etterpa) {
  if (!spPaalogget()) { blikkSpStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(BLIKK_SP_MAPPE, blikkSpFil());
  if (S.fileName !== forFil) return;
  blikkSpStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (res.status === "ok" || res.status === "tom")
    skrivBlikkLagrede(flettPaaNavn(lesBlikkLagredeRaa(), res.liste));
  if (etterpa) etterpa();
}

export function blikkLagringsTekst() {
  if (blikkSpStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (blikkSpStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Logg inn i Biblioteket for å dele med de andre.");
}

export function blikkMittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

// Det som lagres er OPPSETTET og JUSTERINGENE, ikke løpemeterne. Lastes
// resultatet inn på en vegg som er endret siden, regnes tallene på nytt av den
// veggen — det er poenget med at blikket følger veggene.
export function blikkOyeblikksbilde(oppsettForSett) {
  return JSON.parse(JSON.stringify({
    oppsett: oppsettForSett,
    blikk: { ...blikkTilstand() }
  }));
}

export function lagreBlikkResultat(navn, oppsettForSett, etterpa) {
  const rent = String(navn || "").trim().slice(0, 60);
  if (!rent) { alert(t("Gi resultatet et navn før du lagrer det.")); return; }
  if (!blikkPa()) { alert(t("Trykk «Generer blikk» først.")); return; }
  const liste = lesBlikkLagredeRaa();
  const fra_for = liste.findIndex(p => p.navn === rent);
  if (fra_for >= 0 && !liste[fra_for].slettet
      && !confirm(t("«{0}» finnes allerede. Skal den skrives over?", rent))) return;
  const naa = new Date();
  const b = blikkTilstand();
  const post = { navn: rent, dato: naa.toISOString().slice(0, 10),
    endret: naa.toISOString(), av: blikkMittNavn(),
    antall: Object.keys(b.just || {}).length + (b.ekstra || []).length,
    data: blikkOyeblikksbilde(oppsettForSett) };
  if (fra_for >= 0) liste[fra_for] = post; else liste.push(post);
  if (!lagreBlikkBeggeSteder(liste, etterpa)) {
    alert(t("Klarte ikke å lagre — nettleserens lagring er full. Slett et gammelt resultat og prøv igjen."));
    return;
  }
  if (etterpa) etterpa();
}

export function lastInnBlikkResultat(navn, settOppsett, etterpa) {
  const post = lesBlikkLagrede().find(p => p.navn === navn);
  if (!post || !post.data || !lagret) return;
  const d = JSON.parse(JSON.stringify(post.data));
  if (d.oppsett && settOppsett) settOppsett(d.oppsett);
  lagret.blikk = { ...BLIKK_STD_TILSTAND, ...(d.blikk || {}), pa: true };
  skrivLagret();
  tegnAlt();
  if (etterpa) etterpa();
}

export function slettBlikkResultat(navn, etterpa) {
  if (!confirm(t("Slette «{0}»?", navn))) return;
  const liste = lesBlikkLagredeRaa().map(p => p.navn === navn
    ? { navn: p.navn, slettet: true, endret: new Date().toISOString() } : p);
  lagreBlikkBeggeSteder(liste, etterpa);
  if (etterpa) etterpa();
}

// ───────────────────── 🔧 «Juster blikk» ─────────────────────
//
// Emils fire operasjoner, valgt 17.09:
//   · slå av og på en strekning
//   · dra enden kortere eller lengre
//   · legge til en strekning
//   · egen ben-lengde per stykke
//
// Plukkingen går på selve blikkmeshene: hvert brett bærer `userData.blikkId`
// og `userData.blikkSett` fra tegningen, så et trykk treffer STYKKET og ikke
// en tilfeldig brett-boks. Justeringen skrives i `lagret.blikk.just`.

export let blikkJust = null;   // { valgt: Set<id>, drar, markorer, legger } når aktiv
export function settBlikkJust(v) { blikkJust = v; }

// Alle stykkene i 3D, slått opp på id. Tegningen fyller denne.
export const blikkMeshPerId = new Map();
export function nullstillBlikkMesh() { blikkMeshPerId.clear(); }
export function husBlikkMesh(id, m, info) {
  if (!id) return;
  if (!blikkMeshPerId.has(id)) blikkMeshPerId.set(id, { mesher: [], info });
  blikkMeshPerId.get(id).mesher.push(m);
}

export function blikkJustBarEl() {
  let el = $("blikkJustBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "blikkJustBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;flex-wrap:wrap;max-width:92vw;" +
      "background:var(--panel);border:1px solid var(--border);border-radius:10px;" +
      "padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

// Hva slags stykke en id peker på, i klartekst. Står det ingenting om hva du
// har markert, er «3 valgt» en opplysning uten innhold.
export function stykkeNavn(id) {
  const d = blikkMeshPerId.get(id);
  const s = d && d.info;
  const navn = { topp: t("Toppbeslag"), bunn: t("Bunnbeslag"), hjorne: t("Hjørnebeslag"),
    ende: t("Endebeslag"), skjot: t("Hatprofil skjøt"), utsparing: t("Hatprofil utsparing") };
  if (!s) return String(id || "");
  return (navn[s.type] || s.type) + " · " + (s.fasade || "");
}

export function tegnBlikkJustBar(tegnPanelFn) {
  const el = blikkJustBarEl();
  if (!blikkJust) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const n = blikkJust.valgt.size;
  const b = blikkTilstand();
  const avSlatt = [...blikkJust.valgt].filter(id => (b.just[id] || {}).av).length;
  const forste = [...blikkJust.valgt][0];
  el.innerHTML =
    '<span style="font-size:12px;max-width:380px">' +
    t("Trykk på et blikkstykke og dra i enden. Shift+klikk for å ta flere.") +
    ' <b>' + t("{0} valgt", n) + '</b>' +
    (n ? ' <span style="color:var(--muted)">' + esc(stykkeNavn(forste)) +
      (n > 1 ? " +" + (n - 1) : "") + '</span>' : "") + '</span>' +
    '<button id="bjAv" style="padding:3px 10px"' + (n ? "" : " disabled") + '>' +
      (avSlatt === n && n ? "👁 " + t("Slå på") : "🚫 " + t("Slå av")) + '</button>' +
    '<label style="font-size:12px;display:flex;gap:4px;align-items:center">' + t("Ben (mm)") +
      '<input id="bjBen" type="number" step="10" min="0" style="width:74px;padding:2px 4px"' +
      (n ? "" : " disabled") + ' value="' + esc(String(benNaa(forste))) + '"></label>' +
    '<button id="bjLegg" style="padding:3px 10px"' + (blikkJust.legger ? ' class="primary"' : "") + '>' +
      '➕ ' + t("Legg til strekning") + '</button>' +
    '<button id="bjNull" style="padding:3px 10px">' + t("Nullstill") + '</button>' +
    '<button id="bjFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>';
  $("bjAv").onclick = () => {
    const pa = avSlatt === n && n;
    for (const id of blikkJust.valgt) {
      const j = b.just[id] || (b.just[id] = {});
      if (pa) delete j.av; else j.av = true;
      if (!Object.keys(j).length) delete b.just[id];
    }
    lagreOgTegn(tegnPanelFn);
  };
  $("bjBen").onchange = () => {
    const v = Number($("bjBen").value);
    for (const id of blikkJust.valgt) {
      const j = b.just[id] || (b.just[id] = {});
      if (Number.isFinite(v) && v > 0) j.benMm = v; else delete j.benMm;
      if (!Object.keys(j).length) delete b.just[id];
    }
    lagreOgTegn(tegnPanelFn);
  };
  $("bjLegg").onclick = () => {
    blikkJust.legger = blikkJust.legger ? null : { punkter: [] };
    tegnBlikkJustBar(tegnPanelFn);
  };
  $("bjNull").onclick = () => {
    if (!confirm(t("Nullstille alle håndjusteringene av blikket?"))) return;
    b.just = {}; b.ekstra = [];
    blikkJust.valgt.clear();
    lagreOgTegn(tegnPanelFn);
  };
  $("bjFerdig").onclick = () => avsluttBlikkJuster(tegnPanelFn);
}

function benNaa(id) {
  const b = lagret && lagret.blikk;
  const j = (b && b.just && b.just[id]) || {};
  return Number.isFinite(Number(j.benMm)) ? Number(j.benMm) : "";
}

export function lagreOgTegn(tegnPanelFn) {
  skrivLagret();
  tegnAlt();
  merkBlikkValgte();
  tegnBlikkJustBar(tegnPanelFn);
  if (tegnPanelFn) tegnPanelFn();
}

// Blå markering rundt de valgte stykkene — samme språk som veggjusteringen.
export function merkBlikkValgte() {
  if (!blikkJust) return;
  const g = blikkJust.markorer;
  g.children.slice().forEach(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    g.remove(m);
  });
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true,
    opacity: 0.55, depthTest: false, depthWrite: false });
  for (const id of blikkJust.valgt) {
    const d = blikkMeshPerId.get(id);
    if (!d) continue;
    for (const m of d.mesher) {
      if (!m.geometry) continue;
      const k = new THREE.Mesh(m.geometry, mat);
      k.position.copy(m.position);
      k.quaternion.copy(m.quaternion);
      k.scale.copy(m.scale).multiplyScalar(1.35);
      k.renderOrder = 999;
      k.raycast = () => {};
      g.add(k);
    }
  }
}

export function startBlikkJuster(tegnPanelFn) {
  if (!blikkPa()) { alert(t("Trykk «Generer blikk» først.")); return; }
  tegnAlt();                       // meshene må bære id-ene før vi plukker
  const markorer = new THREE.Group();
  swGroup.add(markorer);
  settBlikkJust({ valgt: new Set(), drar: null, markorer, legger: null });
  $("blikkPanel")?.classList.remove("open");
  tegnBlikkJustBar(tegnPanelFn);
}

export function avsluttBlikkJuster(tegnPanelFn) {
  if (!blikkJust) return;
  blikkJust.markorer.traverse(m => {
    if (m.geometry && m.geometry.__egen) m.geometry.dispose();
  });
  swGroup.remove(blikkJust.markorer);
  settBlikkJust(null);
  tegnBlikkJustBar(tegnPanelFn);
  if (tegnPanelFn) tegnPanelFn();
  apnePanel("blikkPanel");
}

// Hvilket blikkstykke ligger under musa?
export function pekBlikk(cx, cy) {
  if (!canvas || !camera || !raycaster) return null;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const treff = raycaster.intersectObjects(swGroup.children, true)
    .find(h => h.object && h.object.userData && h.object.userData.blikkId);
  return treff ? { id: treff.object.userData.blikkId, punkt: treff.point } : null;
}

// Posisjonen langs stykkets eget løp, i mm. Brukes til å avgjøre hvilken ende
// som dras, og hvor langt.
export function blikkLopMm(id, punkt) {
  const d = blikkMeshPerId.get(id);
  if (!d || !d.info || !punkt) return null;
  const i = d.info;
  if (i.loddrett) return tilMm(punkt.y - (i.baseY || 0));
  return tilMm((punkt.x - i.fx) * i.ex + (punkt.z - i.fz) * i.ez);
}

window.addEventListener("pointerdown", (e) => {
  if (!blikkJust || e.button !== 0 || e.target !== canvas) return;
  // ➕ LEGG TIL: to trykk på samme fasade gir en ny strekning mellom dem.
  if (blikkJust.legger) { leggTilTrykk(e); return; }
  const treff = pekBlikk(e.clientX, e.clientY);
  if (!treff) { blikkJust.drar = null; return; }
  if (e.shiftKey) {
    if (blikkJust.valgt.has(treff.id)) blikkJust.valgt.delete(treff.id);
    else blikkJust.valgt.add(treff.id);
    e.stopPropagation();
    merkBlikkValgte(); tegnBlikkJustBar(blikkJust.tegnPanel);
    return;
  }
  if (!blikkJust.valgt.has(treff.id)) { blikkJust.valgt.clear(); blikkJust.valgt.add(treff.id); }
  const startMm = blikkLopMm(treff.id, treff.punkt);
  const d = blikkMeshPerId.get(treff.id);
  if (startMm === null || !d) { merkBlikkValgte(); tegnBlikkJustBar(blikkJust.tegnPanel); return; }
  const midt = (d.info.fraMm + d.info.tilMm) / 2;
  const b = blikkTilstand();
  const base = new Map();
  for (const id of blikkJust.valgt) {
    const j = b.just[id] || {};
    base.set(id, { dFra: Number(j.dFra) || 0, dTil: Number(j.dTil) || 0 });
  }
  blikkJust.drar = { id: treff.id, ende: startMm < midt ? "fra" : "til", startMm, base,
    foer: JSON.parse(JSON.stringify({ just: b.just, ekstra: b.ekstra })) };
  e.stopPropagation();
  merkBlikkValgte(); tegnBlikkJustBar(blikkJust.tegnPanel);
}, true);

window.addEventListener("pointermove", (e) => {
  if (!blikkJust || !blikkJust.drar) return;
  const d = blikkJust.drar;
  const naMm = blikkLopMm(d.id, pekPlan(e.clientX, e.clientY, d.id));
  if (naMm === null) return;
  // «Fra»-enden dras i MINUS-retning når den går utover: dFra forlenger
  // nedover/bakover, slik justerStykke leser den.
  const delta = Math.round((naMm - d.startMm) / 5) * 5;
  const b = blikkTilstand();
  for (const id of blikkJust.valgt) {
    const basis = d.base.get(id);
    if (!basis) continue;
    const j = b.just[id] || (b.just[id] = {});
    if (d.ende === "fra") j.dFra = basis.dFra - delta; else j.dTil = basis.dTil + delta;
  }
  skrivLagret();
  tegnAlt();
  merkBlikkValgte();
  e.stopPropagation();
}, true);

window.addEventListener("pointerup", (e) => {
  if (!blikkJust || e.button !== 0 || !blikkJust.drar) return;
  blikkJust.drar = null;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  lagreOgTegn(blikkJust.tegnPanel);
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && blikkJust) { e.stopPropagation(); avsluttBlikkJuster(blikkJust.tegnPanel); }
}, true);

// Planet stykket ligger i, så draget følger musa også når den går utenfor
// selve blikket — ellers stopper draget i det du sklir av platen.
const _bPlan = new THREE.Plane(), _bPkt = new THREE.Vector3();
export function pekPlan(cx, cy, id) {
  const d = blikkMeshPerId.get(id);
  if (!d || !d.info || !canvas || !camera || !raycaster) return null;
  const i = d.info;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const nrm = new THREE.Vector3(i.nx, 0, i.nz).normalize();
  _bPlan.setFromNormalAndCoplanarPoint(nrm, new THREE.Vector3(i.fx, i.baseY || 0, i.fz));
  return raycaster.ray.intersectPlane(_bPlan, _bPkt) ? _bPkt.clone() : null;
}

// ➕ Legg til en strekning: første trykk setter startpunktet på en fasade,
// andre trykk setter sluttpunktet. Begge må treffe SAMME fasade — en
// strekning som spenner over et hjørne er ikke ett beslag.
export function leggTilTrykk(e) {
  const treff = pekBlikk(e.clientX, e.clientY);
  if (!treff) return;
  const d = blikkMeshPerId.get(treff.id);
  if (!d || !d.info) return;
  const mm = blikkLopMm(treff.id, treff.punkt);
  if (mm === null) return;
  e.stopPropagation();
  const L = blikkJust.legger;
  const i = d.info;
  if (!L.punkter.length) {
    L.punkter.push({ sett: i.sett, fi: i.fi, type: i.type, mm, baseY: i.baseY });
    tegnBlikkJustBar(blikkJust.tegnPanel);
    return;
  }
  const a = L.punkter[0];
  if (a.sett !== i.sett || a.fi !== i.fi) {
    alert(t("Begge punktene må ligge på samme fasade."));
    L.punkter = [];
    return;
  }
  const b = blikkTilstand();
  const nr = b.nesteNr++;
  const type = a.type === "skjot" || a.type === "hjorne" || a.type === "ende" ? "ende" : a.type;
  const id = a.sett + ":" + a.fi + ":lagt:" + nr;
  const fra = Math.min(a.mm, mm), til = Math.max(a.mm, mm);
  b.ekstra.push(type === "ende"
    ? { id, sett: a.sett, fi: a.fi, type: "ende", tMm: Math.round(fra), bunnMm: Math.round(fra), toppMm: Math.round(til) }
    : { id, sett: a.sett, fi: a.fi, type, fraMm: Math.round(fra), tilMm: Math.round(til) });
  L.punkter = [];
  blikkJust.legger = null;
  blikkJust.valgt.clear();
  blikkJust.valgt.add(id);
  lagreOgTegn(blikkJust.tegnPanel);
}
