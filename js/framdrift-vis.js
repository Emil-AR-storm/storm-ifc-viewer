// 📅 Framdriftsplan — GLIDEREN I MODELLEN (trinn 3).
//
// Emil 01.10: «en slider der objektene går fra skjult til gradvis synlig».
// Dras glideren til en dato, viser modellen bygget slik det står da:
//   • trinn som er ferdige        → alt står som vanlig
//   • trinn som ikke er begynt    → objektene er skjult
//   • trinnet som er i arbeid     → bygges nedenfra og opp i steg; steget som
//     er i gang toner inn (IFC-elementer i trinnets farge, rigg/materiell/SW
//     med sine egne farger, gjennomsiktige)
// Objekter som ikke ligger i noe trinn, står alltid. Trinn uten dato også.
//
// Glideren rører IKKE brukerens egen skjuling: IFC-elementene går i en egen
// mengde (framdriftSkjult i display.js), og rigg/materiell/SW får synligheten
// sin tilbake slik den var. Lukkes panelet, står modellen som før.
import * as THREE from "three";
import { $, EKSTRA_LAG, S, esc } from "./state.js";
import { t } from "./i18n.js";
import { frameHooks, scene } from "./scene.js";
import { iDagISO } from "./frist.js";
import { allElementBoxes } from "./elements.js";
import { framdriftSkjult, hiddenIDs, synkMergedSkjuling } from "./display.js";
import { elementGeometri } from "./stopeplan-vis.js";
import { antallSteg, dagNr, idFor, iArbeid, isoFraDag, slagFor, sortert, stegAndel, stegFor, synlige, tidsSpenn, trinnAndel, trinnTid } from "./framdrift-regn.js";

// IFC-stegene som toner inn tegnes som kopier her (raycast av: de skal ikke
// kunne trykkes på — originalen er skjult til steget står ferdig).
export const framdriftGroup = new THREE.Group();
framdriftGroup.name = "framdrift";
scene.add(framdriftGroup);

// Hvilke lag som har hvilke objekter, og hvor id-en står på objektet.
const LAG_SLAG = {
  sw: ["sw", ["swId", "swLettId"]],
  tak: ["tak", ["takLettId"]],
  materiell: ["mat", ["materiellId"]],
  rigg: ["rigg", ["riggId"]]
};
function finnObjekter() {
  const map = new Map();
  for (const l of EKSTRA_LAG) {
    const d = LAG_SLAG[l.id];
    if (!d || !l.gruppe) continue;
    for (const o of l.gruppe.children) {
      for (const f of d[1]) {
        const id = o.userData[f];
        if (id === undefined || id === null || id === "") continue;
        const k = d[0] + ":" + String(id);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(o);
        break;
      }
    }
  }
  return map;
}

// ═══════════ REKKEFØLGEN INNEN TRINNET: NEDENFRA OG OPP ═══════════
const rekkeCache = new Map();     // nøkkel (trinn + objekter) → nøkler sortert
const _b = new THREE.Box3();
function underkant(k, objMap, bokser) {
  const s = slagFor(k);
  if (s === "id") { const b = bokser && bokser.get(Number(idFor(k))); return b ? b.min.y : Infinity; }
  const o = objMap.get(k);
  if (!o || !o.length) return Infinity;
  _b.setFromObject(o[0]);
  return _b.isEmpty() ? Infinity : _b.min.y;
}
function rekkefolge(e, objMap) {
  const nokkel = e.id + "|" + e.objekter.map(o => o.k).join(",");
  let r = rekkeCache.get(nokkel);
  if (r) return r;
  let bokser = null;
  try { if (S.modelGroup && e.objekter.some(o => slagFor(o.k) === "id")) bokser = allElementBoxes(); } catch (_) { bokser = null; }
  const m = e.objekter.map((o, i) => ({ k: o.k, y: underkant(o.k, objMap, bokser), i }));
  m.sort((a, b) => (a.y - b.y) || (a.i - b.i));
  r = m.map(x => x.k);
  if (rekkeCache.size > 400) rekkeCache.clear();
  rekkeCache.set(nokkel, r);
  return r;
}

// ═══════════ TONING AV RIGG, MATERIELL OG SW ═══════════
const tonet = new Set();          // objekter glideren har rørt
function klon(x) { const c = x.clone(); c.transparent = true; c.depthWrite = false; return c; }
function tone(o, a) {
  if (!tonet.has(o)) { o.userData.fpVar = o.visible; tonet.add(o); }
  if (a <= 0) { o.visible = false; return; }
  o.visible = o.userData.fpVar;
  o.traverse(m => {
    if (!m.material) return;
    if (!m.userData.fpOrig || (m.material !== m.userData.fpMat && m.material !== m.userData.fpOrig)) {
      // Første gang — eller noen (valgeffekten) har byttet materialet siden
      if (m.userData.fpMat) gjenopprettMesh(m);
      m.userData.fpOrig = m.material;
      m.userData.fpMat = Array.isArray(m.material) ? m.material.map(klon) : klon(m.material);
    }
    m.material = m.userData.fpMat;
    const o2 = Array.isArray(m.userData.fpOrig) ? m.userData.fpOrig : [m.userData.fpOrig];
    const f2 = Array.isArray(m.userData.fpMat) ? m.userData.fpMat : [m.userData.fpMat];
    f2.forEach((mm, i) => { const op = o2[i] && o2[i].opacity != null ? o2[i].opacity : 1; mm.opacity = op * a; });
  });
}
function gjenopprettMesh(m) {
  if (!m.userData.fpOrig) return;
  if (m.material === m.userData.fpMat) m.material = m.userData.fpOrig;
  if (m.userData.matOrig === m.userData.fpMat) m.userData.matOrig = m.userData.fpOrig;
  const f = m.userData.fpMat;
  (Array.isArray(f) ? f : [f]).forEach(x => x && x.dispose && x.dispose());
  delete m.userData.fpOrig; delete m.userData.fpMat;
}
function gjenopprettObjekt(o) {
  if ("fpVar" in o.userData) { o.visible = o.userData.fpVar; delete o.userData.fpVar; }
  o.traverse(gjenopprettMesh);
}

// ═══════════ IFC: SKJUL OG TON INN ═══════════
function typeSkjulteMeshes() {
  const s = new Set();
  if (S.typeInfo) for (const [, g] of S.typeInfo) if (g.hidden) g.meshes.forEach(m => s.add(m));
  return s;
}
function settIfcSkjult(nye) {
  const endret = nye.size !== framdriftSkjult.size || [...nye].some(id => !framdriftSkjult.has(id));
  const fram = [...framdriftSkjult].filter(id => !nye.has(id));
  framdriftSkjult.clear();
  nye.forEach(id => framdriftSkjult.add(id));
  if (!S.modelGroup) return;
  const framSett = new Set(fram);
  const typeSkjult = fram.length ? typeSkjulteMeshes() : null;
  S.modelGroup.children.forEach(m => {
    if (m.userData.merged) return;
    const id = m.userData.expressID;
    if (framdriftSkjult.has(id)) m.visible = false;
    else if (framSett.has(id)) m.visible = !hiddenIDs.has(id) && !typeSkjult.has(m);
  });
  if (endret) synkMergedSkjuling();
}

const geoCache = new Map();       // steg-nøkkel → geometri
const overlay = new Map();        // steg-nøkkel → mesh
function stegMesh(nokkel, ider, farge) {
  let m = overlay.get(nokkel);
  if (m) return m;
  let g = geoCache.get(nokkel);
  if (g === undefined) {
    try { g = elementGeometri(ider) || null; } catch (_) { g = null; }
    geoCache.set(nokkel, g);
  }
  if (!g) return null;
  m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    color: farge, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide
  }));
  m.raycast = () => {};
  m.userData.ikkeValg = true;
  m.userData.framdriftSteg = nokkel;
  framdriftGroup.add(m);
  overlay.set(nokkel, m);
  return m;
}
function ryddOverlay(behold) {
  for (const [k, m] of overlay) {
    if (behold && behold.has(k)) continue;
    framdriftGroup.remove(m);
    if (m.material) m.material.dispose();
    overlay.delete(k);
  }
}

// ═══════════ TEGN: MODELLEN VED TIDEN ═══════════
let aktiv = false;
let sistTegnet = 0;
// Tiden glideren står på (dager). null = alt ferdig (planens slutt).
export function framdriftTid() {
  const sp = tidsSpenn(S.framdrift);
  if (!sp) return null;
  const v = S.framdriftTid;
  if (v == null || !Number.isFinite(v)) return sp.b;
  return Math.max(sp.a, Math.min(sp.b, v));
}
export const framdriftAktiv = () => aktiv;

// Hva som tegnes nå (testene leser dette): skjulte IFC, tonede steg og objekter.
let status = { skjulteIfc: 0, steg: [], tonet: 0, skjult: 0 };
export const framdriftStatus = () => JSON.parse(JSON.stringify(status));

export function tegnFramdrift(paa) {
  if (paa !== undefined) aktiv = !!paa;
  sistTegnet = Date.now();
  const sp = tidsSpenn(S.framdrift);
  if (!aktiv || !sp) { gjenopprettAlt(); return; }
  const tid = framdriftTid();
  const objMap = finnObjekter();
  const ifc = new Set();
  const fade = new Map();
  const steg = [];
  const behold = new Set();
  for (const e of synlige(S.framdrift)) {
    const p = trinnAndel(e, tid);
    if (p >= 1) continue;
    const rekke = rekkefolge(e, objMap);
    const n = rekke.length, K = antallSteg(n);
    const delIfc = new Map();      // steg j → [ider] for stegene som toner inn
    rekke.forEach((k, i) => {
      const j = stegFor(i, n);
      const a = stegAndel(p, j, K);
      if (a >= 1) return;
      const s = slagFor(k);
      if (s === "id") {
        const id = Number(idFor(k));
        ifc.add(id);
        if (a > 0) { if (!delIfc.has(j)) delIfc.set(j, { a, ider: [] }); delIfc.get(j).ider.push(id); }
      } else {
        for (const o of objMap.get(k) || []) fade.set(o, a);
      }
    });
    for (const [j, d] of delIfc) {
      const nk = e.id + "|" + j + "|" + d.ider.join(",");
      const m = stegMesh(nk, d.ider, e.farge);
      if (m) { m.material.opacity = 0.15 + 0.7 * d.a; m.material.color.set(e.farge); m.visible = true; behold.add(nk); }
      steg.push({ trinn: e.id, steg: j, andel: d.a, elementer: d.ider.length });
    }
  }
  settIfcSkjult(ifc);
  ryddOverlay(behold);
  for (const o of [...tonet]) if (!fade.has(o) || !o.parent) { gjenopprettObjekt(o); tonet.delete(o); }
  let nSkjult = 0, nTonet = 0;
  for (const [o, a] of fade) { tone(o, a); if (a <= 0) nSkjult++; else nTonet++; }
  framdriftGroup.visible = true;
  status = { skjulteIfc: ifc.size, steg, tonet: nTonet, skjult: nSkjult };
}

function gjenopprettAlt() {
  settIfcSkjult(new Set());
  ryddOverlay(null);
  for (const o of tonet) gjenopprettObjekt(o);
  tonet.clear();
  status = { skjulteIfc: 0, steg: [], tonet: 0, skjult: 0 };
}
// Planen er endret (objekter lagt til/tatt ut): rekkefølge og geometri på nytt
export function framdriftPlanEndret() {
  rekkeCache.clear();
  ryddOverlay(null);
  for (const g of geoCache.values()) if (g && g.dispose) g.dispose();
  geoCache.clear();
}
export function ryddFramdriftVis() { stoppAvspilling(); aktiv = false; framdriftPlanEndret(); gjenopprettAlt(); S.framdriftTid = null; tegnTidslinje(false); }

// Lagene bygger objektene sine på nytt (SW tegnAlt, rigg omplassert …) —
// nye objekter har ikke glideren på seg. Et lett etterslep holder dem i takt.
frameHooks.push(() => {
  if (!aktiv) return;
  const naa = Date.now();
  if (naa - sistTegnet > 450) tegnFramdrift();
});

// ═══════════════════════ TIDSLINJEN ═══════════════════════
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };
const datoKort = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] : ""; };

function tidEl() {
  let el = $("fpTidslinje");
  if (!el) {
    el = document.createElement("div");
    el.id = "fpTidslinje";
    el.className = "st-tid fp-tid";
    document.body.appendChild(el);
  }
  return el;
}

// Settes tiden, tegnes modellen og toppteksten — hele linja bare ved `full`.
export function settFramdriftTid(tid, full) {
  const sp = tidsSpenn(S.framdrift);
  if (!sp) return;
  S.framdriftTid = (tid == null || tid >= sp.b) ? null : Math.max(sp.a, tid);
  tegnFramdrift();
  if (full) tegnTidslinje(); else oppdaterTopp();
}

function toppTekst() {
  const sp = tidsSpenn(S.framdrift);
  const tid = framdriftTid();
  if (!sp) return "";
  if (S.framdriftTid == null) return esc(t("Vist per")) + " <b>" + esc(datoLang(isoFraDag(sp.b - 1))) + "</b> " +
    '<span class="st-tid-merk">' + esc(t("— alt ferdig")) + "</span>";
  const arb = iArbeid(S.framdrift, tid);
  return esc(t("Vist per")) + " <b>" + esc(datoLang(isoFraDag(tid))) + "</b>" +
    (arb.length ? ' <span class="st-tid-merk">· ' + esc(t("I arbeid:")) + " " +
      arb.map(e => esc(e.nr + " " + e.navn) + " (" + Math.round(trinnAndel(e, tid) * 100) + " %)").join(", ") + "</span>" : "");
}
function oppdaterTopp() {
  const el = $("fpTidTekst");
  if (el) el.innerHTML = toppTekst();
  const g = $("fpTidGlider");
  const sp = tidsSpenn(S.framdrift);
  if (g && sp) g.value = String(framdriftTid() - sp.a);
  const ferdig = $("fpTidFerdig");
  if (ferdig) ferdig.disabled = S.framdriftTid == null;
  const spill = $("fpTidSpill");
  if (spill) spill.textContent = spiller ? t("Pause") : t("Spill av");
}

let sistApen = false;
export function tegnTidslinje(apen) {
  if (apen !== undefined) sistApen = !!apen;
  const el = tidEl();
  const sp = tidsSpenn(S.framdrift);
  const vis = sistApen && aktiv && !!sp;
  document.body.classList.toggle("fp-tid-paa", vis);
  if (!vis) { el.style.display = "none"; el.innerHTML = ""; stoppAvspilling(); return; }
  const n = Math.max(1, sp.dager);
  const pos = (d) => Math.max(0, Math.min(100, (d - sp.a) / n * 100));
  const tid = framdriftTid();
  let barer = "";
  for (const e of sortert(S.framdrift)) {
    const tt = trinnTid(e);
    if (!tt) continue;
    const p = trinnAndel(e, tid);
    const kl = p >= 1 ? "ferdig" : p <= 0 ? "kommer" : "arbeid";
    barer += '<button class="fp-bar ' + kl + '" data-slutt="' + tt.b + '" style="left:' + pos(tt.a).toFixed(2) + "%;width:" +
      Math.max(0.8, pos(tt.b) - pos(tt.a)).toFixed(2) + "%;--f:" + esc(e.farge) + '" title="' +
      esc(e.nr + " " + e.navn + " · " + datoLang(e.dato) + (e.slutt && e.slutt !== e.dato ? " – " + datoLang(e.slutt) : "")) +
      '"><span>' + e.nr + "</span></button>";
  }
  const iDag = dagNr(iDagISO());
  const idagMerke = iDag >= sp.a && iDag <= sp.b
    ? '<span class="st-tid-idag" style="left:' + pos(iDag + 0.5).toFixed(2) + '%" title="' + esc(t("I dag")) + '"></span>' : "";
  let akse = "";
  const steg = n > 120 ? 28 : n > 56 ? 14 : n > 21 ? 7 : n > 10 ? 2 : 1;
  for (let d = sp.a; d <= sp.b; d += steg) akse += '<span style="left:' + pos(d).toFixed(2) + '%">' + esc(datoKort(isoFraDag(d))) + "</span>";
  el.style.display = "block";
  el.innerHTML =
    '<div class="st-tid-topp"><span id="fpTidTekst">' + toppTekst() + "</span>" +
      '<span class="fp-tid-knapper">' +
        '<button id="fpTidSpill">' + esc(spiller ? t("Pause") : t("Spill av")) + "</button>" +
        '<button id="fpTidIdag"' + (iDag >= sp.a && iDag < sp.b ? "" : " disabled") + ">" + esc(t("I dag")) + "</button>" +
        '<button id="fpTidFerdig"' + (S.framdriftTid == null ? " disabled" : "") + ">" + esc(t("Alt ferdig")) + "</button>" +
      "</span></div>" +
    '<div class="st-tid-bane">' + idagMerke + barer +
      '<input type="range" id="fpTidGlider" min="0" max="' + n + '" step="0.02" value="' + (tid - sp.a) + '" aria-label="' + esc(t("Vist per")) + '">' +
    "</div>" +
    '<div class="st-tid-akse">' + akse + "</div>";
  const g = $("fpTidGlider");
  g.oninput = () => { stoppAvspilling(); settFramdriftTid(sp.a + Number(g.value), false); oppdaterBarer(); };
  g.onchange = () => tegnTidslinje();
  $("fpTidSpill").onclick = () => { if (spiller) stoppAvspilling(); else spillAv(); oppdaterTopp(); };
  $("fpTidIdag").onclick = () => { stoppAvspilling(); settFramdriftTid(iDag + 0.5, true); };
  $("fpTidFerdig").onclick = () => { stoppAvspilling(); settFramdriftTid(null, true); };
  el.querySelectorAll(".fp-bar").forEach(b => b.onclick = () => { stoppAvspilling(); settFramdriftTid(Number(b.dataset.slutt), true); });
}
function oppdaterBarer() {
  const tid = framdriftTid();
  const liste = sortert(S.framdrift).filter(e => trinnTid(e));
  document.querySelectorAll("#fpTidslinje .fp-bar").forEach((b, i) => {
    const e = liste[i];
    if (!e) return;
    const p = trinnAndel(e, tid);
    b.classList.toggle("ferdig", p >= 1); b.classList.toggle("kommer", p <= 0); b.classList.toggle("arbeid", p > 0 && p < 1);
  });
}

// ▶ Spill av: hele planen på noen sekunder (1,5 s per trinn, minst 6 s).
// Trinn 5 (videoen) bruker samme avspilling.
let spiller = null;
export const spillerAv = () => !!spiller;
export function spillAv(sekunder) {
  const sp = tidsSpenn(S.framdrift);
  if (!sp) return;
  stoppAvspilling();
  const ant = synlige(S.framdrift).filter(e => trinnTid(e)).length;
  const varighet = (sekunder || Math.max(6, ant * 1.5)) * 1000;
  let fra = framdriftTid();
  if (S.framdriftTid == null || fra >= sp.b - 1e-6) fra = sp.a;
  const t0 = Date.now() - (fra - sp.a) / sp.dager * varighet;
  const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (f) => setTimeout(() => f(Date.now()), 16);
  spiller = { stopp: false };
  const mitt = spiller;
  const steg = () => {
    if (mitt.stopp) return;
    const naa = Date.now();
    const tid = sp.a + Math.min(1, (naa - t0) / varighet) * sp.dager;
    if (tid >= sp.b) { spiller = null; settFramdriftTid(null, true); return; }
    S.framdriftTid = tid;
    tegnFramdrift();
    oppdaterTopp(); oppdaterBarer();
    raf(steg);
  };
  raf(steg);
}
export function stoppAvspilling() {
  if (!spiller) return;
  spiller.stopp = true;
  spiller = null;
  oppdaterTopp();
}
