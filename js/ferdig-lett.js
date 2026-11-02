// 📊 FERDIGMELDING PÅ BYGGEPLASSEN (runde 10b, Emils valg B 02.11.2026).
//
// I Framdriftsplan-panelet på telefonen: «✅ Ferdigmeld» (og «Ikke ferdig»)
// starter en markeringsmodus som på kontoret — trykk på elementer,
// SW-elementer og takplater (trykk igjen tar dem ut), og «Lagre». Det valgte
// er blått; det som er ferdig fra før, er grønt mens panelet er åpent.
//
// Montøren kan bare LEGGE TIL: meldingen går til kontoret gjennom Workerens
// innboks (/hendelse type «ferdig», Worker v19), via markeringenes kø — uten
// nett ligger den på telefonen og sendes når nettet er tilbake. Kontoret
// fletter den inn i framdriftsrapporten når det trykker Storm-Byggeplass.
//
// Hva som er ferdig kommer fra kontoret (feltet `ferdig` i markeringer.json)
// pluss det montøren selv har meldt (localStorage, til kontoret har publisert
// på nytt). Nyeste per objekt gjelder.
import * as THREE from "three";
import { $, S, esc } from "./state.js";
import { scene } from "./scene.js";
import { t, tn } from "./i18n.js";
import { varsel } from "./varsel.js";
import { idFor, slagFor, synlige } from "./framdrift-regn.js";
import { innloggetNavn, sendHendelse } from "./markers.js";
import { forHverTrekant, hitID, pick, pickEkstra } from "./elements.js";
import { finnObjekter } from "./framdrift-vis.js";

const LOKAL = "storm-bp-ferdig";
const DAGER = 21;
const MAKS_PER_SENDING = 300;
let publisert = new Set();            // ferdig ifølge kontoret
let modus = null;                      // null | { ferdig: true|false }
const valgt = new Set();               // nøkler valgt i modusen

const kanMeldes = (k) => /^(id|sw|tak|blikk):/.test(String(k || ""));
function lesLokale() { try { const o = JSON.parse(localStorage.getItem(LOKAL) || "{}"); return o && typeof o === "object" ? o : {}; } catch (_) { return {}; } }
function lokale() { const a = lesLokale()[S.fileName || ""]; return Array.isArray(a) ? a : []; }
function huskLokale(nye) {
  const alle = lesLokale();
  const grense = new Date(Date.now() - DAGER * 864e5).toISOString();
  alle[S.fileName || ""] = lokale().filter(x => String(x.tid) >= grense).concat(nye).slice(-5000);
  try { localStorage.setItem(LOKAL, JSON.stringify(alle)); } catch (_) {}
}
// Gjeldende: kontorets liste med telefonens egne meldinger oppå (nyeste vinner)
export function ferdigNa(publ, lok) {
  const ut = new Set(publ || []);
  const siste = new Map();
  for (const m of lok || []) { const f = siste.get(m.k); if (!f || String(m.tid) >= String(f.tid)) siste.set(m.k, m); }
  for (const [k, m] of siste) { if (m.ferdig === false) ut.delete(k); else ut.add(k); }
  return ut;
}
const ferdig = () => ferdigNa(publisert, lokale());

// Planens objekter som kan meldes ferdig: «x av y i planen»
function iPlanen() {
  const s = new Set();
  for (const e of synlige(S.framdrift)) for (const o of e.objekter) if (kanMeldes(o.k)) s.add(o.k);
  return s;
}

// ═══════════ PANELDELEN (framdrift-lett.js tegner den) ═══════════
export function ferdigHtml() {
  const plan = iPlanen();
  if (!plan.size) return "";
  const f = ferdig();
  let n = 0; for (const k of plan) if (f.has(k)) n++;
  const pst = Math.round(n / plan.size * 100);
  return '<div class="fr-tot fr-lett"><div class="fr-t"><span>📊 ' + esc(t("Ferdig i planen")) + "</span><span><b>" + pst + ' %</b> <span class="set-hjelp">' + n + "/" + plan.size + "</span></span></div>" +
    '<div class="fr-bar"><i style="width:' + pst + '%;background:var(--ok)"></i></div>' +
    '<div class="prop-actions"><button id="flMeld" class="primary"' + (modus ? " disabled" : "") + ">✅ " + esc(t("Ferdigmeld")) + "</button>" +
    '<button id="flIkke"' + (modus ? " disabled" : "") + ">" + esc(t("Ikke ferdig")) + "</button></div>" +
    '<p class="set-hjelp">' + esc(t("Trykk Ferdigmeld, trykk på det som er montert (trykk igjen for å ta det ut) og trykk Lagre. Det sendes til prosjektlederen.")) + "</p></div>";
}
export function koblFerdig() {
  const a = $("flMeld"), b = $("flIkke");
  if (a) a.onclick = () => start(true);
  if (b) b.onclick = () => start(false);
  tegnFarger();
}

// ═══════════ MODUSEN ═══════════
function bar() {
  let el = $("flVelgBar");
  if (!el) { el = document.createElement("div"); el.id = "flVelgBar"; el.className = "st-velgbar fp-velgbar"; document.body.appendChild(el); }
  return el;
}
function tegnBar() {
  const el = bar();
  if (!modus) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML = '<span class="st-velg-farge" style="background:' + (modus.ferdig ? "var(--ok)" : "var(--muted)") + '"></span>' +
    '<span class="st-velg-tekst"><b>' + esc(modus.ferdig ? t("Ferdigmeld") : t("Ikke ferdig")) + '</b><small class="fl-hint">' +
      esc(modus.ferdig ? t("Trykk på det som er montert. Trykk igjen for å ta det ut.") : t("Trykk på det som likevel ikke er ferdig.")) + "</small></span>" +
    '<span class="st-velg-ant">' + esc(t("{0} valgt", valgt.size)) + "</span>" +
    '<button id="flLagre" class="primary"' + (valgt.size ? "" : " disabled") + ">" + esc(t("Lagre")) + "</button>" +
    '<button id="flAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("flLagre").onclick = () => slutt(true);
  $("flAvbryt").onclick = () => slutt(false);
}
function start(erFerdig) {
  modus = { ferdig: erFerdig };
  valgt.clear();
  S.lettVelgKlikk = klikk;
  if (S.framdriftLettModus) S.framdriftLettModus(true);   // glideren av, hele bygget synlig
  tegnBar(); oppdater();
}
function slutt(lagre) {
  const m = modus;
  modus = null;
  S.lettVelgKlikk = null;
  if (lagre && m && valgt.size) send([...valgt], m.ferdig);
  valgt.clear();
  if (S.framdriftLettModus) S.framdriftLettModus(false);
  tegnBar(); oppdater();
}
// Trykk i modellen i modusen: nærmeste element / SW / takplate veksler inn og ut
function klikk(x, y) {
  if (!modus) return false;
  const hit = pick(x, y);
  const ek = pickEkstra(x, y);
  let k = null;
  if (ek && (!hit || ek.avstand < hit.distance) && ek.lag && (ek.lag.id === "sw" || ek.lag.id === "tak")) k = ek.lag.id + ":" + ek.id;
  else if (hit) { const id = hitID(hit); if (id != null) k = "id:" + id; }
  if (!k || !kanMeldes(k)) return true;
  if (valgt.has(k)) valgt.delete(k); else valgt.add(k);
  tegnBar(); tegnFarger();
  return true;
}
function gidFor(k) {
  if (slagFor(k) !== "id") return "";
  const p = S.glbProps && S.glbProps.get(Number(idFor(k)));
  return (p && p[4]) ? String(p[4]).slice(0, 40) : "";
}
function send(nokler, erFerdig) {
  const av = innloggetNavn(), tid = new Date().toISOString();
  const meldinger = nokler.map(k => { const g = gidFor(k); return Object.assign({ k, ferdig: erFerdig, tid, av }, g ? { gid: g } : {}); });
  huskLokale(meldinger);
  for (let i = 0; i < meldinger.length; i += MAKS_PER_SENDING) {
    sendHendelse({ type: "ferdig", av, meldinger: meldinger.slice(i, i + MAKS_PER_SENDING) });
  }
  varsel(erFerdig ? tn(nokler.length, "{0} objekt ferdigmeldt.", "{0} objekter ferdigmeldt.") : tn(nokler.length, "{0} objekt satt til ikke ferdig.", "{0} objekter satt til ikke ferdig."));
}
window.addEventListener("keydown", (ev) => { if (modus && ev.key === "Escape") slutt(false); }, true);

// ═══════════ FARGENE: grønt = ferdig, blått = valgt ═══════════
const gruppe = new THREE.Group();
gruppe.name = "ferdigLett";
scene.add(gruppe);
function rydd() { gruppe.children.forEach(m => { if (!m.userData.delt) m.geometry.dispose(); m.material.dispose(); }); gruppe.clear(); }
const mat = (farge, op) => new THREE.MeshBasicMaterial({ color: farge, transparent: true, opacity: op, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false });
const panelApent = () => { const p = $("framdriftPanel"); return !!(p && p.classList.contains("open")); };
function tegnFarger() {
  rydd();
  if (!panelApent() && !modus) return;
  const f = ferdig();
  const lag = (nokler, farge, op) => {
    const ider = new Set([...nokler].filter(k => slagFor(k) === "id").map(k => Number(idFor(k))));
    if (ider.size) {
      const pos = [], v = new THREE.Vector3();
      forHverTrekant(ider, (pp, a, b, c, mtx) => { for (const i of [a, b, c]) { v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx); pos.push(v.x, v.y, v.z); } });
      if (pos.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
        const m = new THREE.Mesh(g, mat(farge, op)); m.renderOrder = 989; m.raycast = () => {}; gruppe.add(m);
      }
    }
    const andre = [...nokler].filter(k => slagFor(k) !== "id");
    if (!andre.length) return;
    const kart = finnObjekter(), mm = mat(farge, op);
    for (const k of andre) for (const o of kart.get(k) || []) {
      if (!o.visible) continue;
      o.updateWorldMatrix(true, true);
      o.traverse(x => {
        if (!x.isMesh || !x.geometry || !x.visible) return;
        const t2 = new THREE.Mesh(x.geometry, mm); t2.matrixAutoUpdate = false; t2.matrix.copy(x.matrixWorld);
        t2.userData.delt = true; t2.renderOrder = 989; t2.raycast = () => {}; gruppe.add(t2);
      });
    }
  };
  lag([...f].filter(k => !valgt.has(k)), 0x3cb44b, 0.7);
  if (valgt.size) lag(valgt, 0x3b82f6, 0.85);
}
function oppdater() { if (S.framdriftLettTegn) S.framdriftLettTegn(); else tegnFarger(); }
S.ferdigLettFarger = tegnFarger;

// markers.js → feltet `ferdig` fra Workerens JSON (kontorets ferdigmeldinger)
S.settFerdigFraLett = (liste) => {
  publisert = new Set((Array.isArray(liste) ? liste : []).filter(kanMeldes).map(String));
  if (panelApent()) oppdater();
};
