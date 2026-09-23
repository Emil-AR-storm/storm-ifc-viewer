// 🔧 «JUSTER TRP» — håndjustering av takplatene (Emil 21.09).
//
// Samme oppskrift som «Juster blikk» fikk i runde 2b, og av samme grunn:
// justeringen er et TILLEGG oppå det regnede, ikke et frosset tak. Stålet kan
// leses på nytt uten at justeringene ryker.
//
// Fire operasjoner, de samme som på blikket:
//   · slå av og på en plate
//   · dra enden kortere eller lengre
//   · legge til en plate
//   · egen bredde på en plate
//
// Reglene bor i js/sw-tak.js (justerPlater, plateId, summerFlate). Her er bare
// plukkingen i 3D og verktøylinja.
import { $, apnePanel, esc, S } from "../state.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { camera, canvas, raycaster } from "../scene.js";
import { tilMm, tilScene } from "./regler.js";
import { lagret, skrivLagret, swGroup } from "./tilstand.js";
import { tegnAlt } from "./tegning.js";
import { snapKandidater, snapVerdi } from "../sw-tak.js";
import { flettPaaNavn, spLes, spPaalogget, spSkriv } from "../sp-lager.js";

export let takJust = null;   // { valgt: Set<id>, drar, markorer } når aktiv
export function settTakJust(v) { takJust = v; }

// Alle platene i 3D, slått opp på id. Tegningen fyller denne.
export const takMeshPerId = new Map();
export function nullstillTakMesh() { takMeshPerId.clear(); }
export function husTakMesh(id, m, info) {
  if (!id) return;
  if (!takMeshPerId.has(id)) takMeshPerId.set(id, { mesher: [], info });
  takMeshPerId.get(id).mesher.push(m);
}

function tilstand() {
  if (!lagret) return null;
  if (!lagret.tak || typeof lagret.tak !== "object") return null;
  const t2 = lagret.tak;
  if (!t2.just || typeof t2.just !== "object") t2.just = {};
  if (!Array.isArray(t2.ekstra)) t2.ekstra = [];
  if (!(Number(t2.nesteNr) > 0)) t2.nesteNr = 1;
  return t2;
}

export function takJustBarEl() {
  let el = $("takJustBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "takJustBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;flex-wrap:wrap;max-width:92vw;" +
      "background:var(--panel);border:1px solid var(--border);border-radius:10px;" +
      "padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

export function tegnTakJustBar(paaNytt) {
  const el = takJustBarEl();
  if (!takJust) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const b = tilstand();
  if (!b) return;
  const n = takJust.valgt.size;
  const avSlatt = [...takJust.valgt].filter(id => (b.just[id] || {}).av).length;
  const forste = [...takJust.valgt][0];
  const d = forste ? takMeshPerId.get(forste) : null;
  const info = d && d.info;
  el.innerHTML =
    '<span style="font-size:12px;max-width:360px">' +
    esc(t("Trykk på en takplate. Dra i en av de blå pilene for lengden eller en av de oransje for bredden — hver pil flytter sin egen kant. Shift+klikk for å ta flere.")) +
    ' <b>' + esc(t("{0} valgt", n)) + '</b>' +
    (info ? ' <span style="color:var(--muted)">' +
      esc(t("Takflate {0} · {1} mm", (info.flate || 0) + 1, Math.round(info.lengdeMm || 0))) +
      '</span>' : "") + '</span>' +
    // 🔄 EMIL 22.09: «vi fjerner Legg til plate og Slå av, og legger til en
    // Del i to som klipper en TRP-plate i to på midten — samme måte som den
    // vi bruker til veggelement i SW-generatoren.»
    '<button id="tjDel" style="padding:3px 10px"' + (n ? "" : " disabled") + '>✂ ' +
      esc(t("Del i to")) + '</button>' +
    '<label style="font-size:12px;display:flex;gap:4px;align-items:center">' + esc(t("Bredde (mm)")) +
      '<input id="tjBredde" type="number" step="10" min="0" style="width:82px;padding:2px 4px"' +
      (n ? "" : " disabled") + ' value="' + esc(String(breddeNaa(forste))) + '"></label>' +
    '<button id="tjNull" style="padding:3px 10px">' + esc(t("Nullstill")) + '</button>' +
    '<button id="tjFerdig" class="primary" style="padding:3px 10px">' + esc(t("Ferdig")) + '</button>';
  // ✂ DEL I TO. Plata klippes på midten, og de to halvdelene skjøtes med
  // overlappen slik resten av taket gjør: den ØVRE lapper over den nedre,
  // fordi vannet renner nedover. Til sammen dekker de nøyaktig det samme som
  // den hele plata gjorde — ingen millimeter blir borte i klippet.
  //
  // Mekanikken er `ekstra`-lista, som allerede finnes: de to halvdelene er
  // vanlige plater med egen id, og går gjennom samme justering, summering og
  // tegning som de regnede. Originalen slås av. «Slå av» er borte som KNAPP,
  // men flagget lever videre her — det er det som gjør klippet mulig.
  if ($("tjDel")) $("tjDel").onclick = () => {
    const ov = Math.max(0, n2(takOppsettNaa().endeOverlappMm));
    const nye = [];
    for (const id of [...takJust.valgt]) {
      const d2 = takMeshPerId.get(id);
      const i = d2 && d2.info;
      if (!i || !tallEr(i.uFra) || !tallEr(i.uTil)) continue;
      const a2 = Math.min(n2(i.uFra), n2(i.uTil)), b2 = Math.max(n2(i.uFra), n2(i.uTil));
      const midt = (a2 + b2) / 2;
      if (b2 - a2 < 400) continue;          // for kort til å klippe i to
      const j = b.just[id] || (b.just[id] = {});
      j.av = true;
      for (const [uFra, uTil] of [[a2, midt], [Math.max(a2, midt - ov), b2]]) {
        const nyId = "t:" + i.flate + ":delt:" + (b.nesteNr++);
        b.ekstra.push({ id: nyId, fi: i.flate, vFra: Math.round(i.vFra),
          breddeMm: Math.round(i.breddeMm), uFra: Math.round(uFra), uTil: Math.round(uTil) });
        nye.push(nyId);
      }
    }
    if (!nye.length) return;
    takJust.valgt.clear();
    for (const id of nye) takJust.valgt.add(id);
    lagreOgTegn(paaNytt);
  };
  $("tjBredde").onchange = () => {
    const v = Number($("tjBredde").value);
    for (const id of takJust.valgt) {
      const j = b.just[id] || (b.just[id] = {});
      if (Number.isFinite(v) && v > 0) j.breddeMm = v; else delete j.breddeMm;
      if (!Object.keys(j).length) delete b.just[id];
    }
    lagreOgTegn(paaNytt);
  };
  $("tjNull").onclick = () => {
    if (!confirm(t("Nullstille alle håndjusteringene av takplatene?"))) return;
    b.just = {}; b.ekstra = [];
    takJust.valgt.clear();
    lagreOgTegn(paaNytt);
  };
  $("tjFerdig").onclick = () => avsluttTakJuster(paaNytt);
}

function breddeNaa(id) {
  const b = tilstand();
  const j = (b && b.just && b.just[id]) || {};
  if (Number.isFinite(Number(j.breddeMm))) return Number(j.breddeMm);
  const d = takMeshPerId.get(id);
  return d && d.info ? Math.round(d.info.breddeMm || 0) : "";
}

export function lagreOgTegn(paaNytt) {
  skrivLagret();
  tegnAlt();
  merkTakValgte();
  tegnTakJustBar(paaNytt);
  if (paaNytt) paaNytt();
}

// Blå markering rundt de valgte platene — samme språk som veggjusteringen.
export function merkTakValgte() {
  if (!takJust) return;
  const g = takJust.markorer;
  g.children.slice().forEach(m => g.remove(m));
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true,
    opacity: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  for (const id of takJust.valgt) {
    const d = takMeshPerId.get(id);
    if (!d) continue;
    for (const m of d.mesher) {
      if (!m.geometry) continue;
      const k = new THREE.Mesh(m.geometry, mat);
      k.position.copy(m.position);
      k.quaternion.copy(m.quaternion);
      k.scale.copy(m.scale);
      k.renderOrder = 999;
      k.raycast = () => {};
      g.add(k);
    }
  }
  // ↕ PILENE (Emil 22.09): «når man markerer en TRP-plate skal det vises en
  // pil som peker i bredden og en som peker i lengden oppå den blå
  // markeringen — du trykker på pilen og drar for å velge retningen.»
  //
  // Pilene står på plata du valgte SIST. Er flere valgt, gjelder draget alle
  // — som før — men pilene skal vise ÉN plate, ellers står det en skog av dem.
  const sist = [...takJust.valgt][takJust.valgt.size - 1];
  const dSist = sist ? takMeshPerId.get(sist) : null;
  if (dSist && dSist.info && dSist.info.U) {
    for (const m of lagPiler(dSist.info, sist)) g.add(m);
  }
}

// ↕ ÉN PIL: et skaft og et hode, lagt i takflatas eget plan og løftet over
// bølgene slik merketeksten er. Pilen er IKKE gjennomsiktig for musa — den er
// håndtaket, og må kunne treffes.
const PIL_FARGE = { lengde: 0x2563eb, bredde: 0xf59e0b };

export function pilMal(info, akse) {
  const bredde = n2(info.breddeMm);
  const lengde = Math.abs(n2(info.uTil) - n2(info.uFra));
  const langs = akse === "bredde" ? bredde : lengde;
  // Pila tar en tredel av plata LANGS SIN EGEN AKSE — ikke av det korteste
  // målet. En 6 000 × 1 030 plate skal ha en lang lengdepil og en kort
  // breddepil; det er nettopp forskjellen som viser hvilken vei du drar.
  // Gulv på 200 mm så en liten plate fortsatt har et håndtak, tak på 2 500 mm
  // så pila ikke slører hele taket på en lang plate.
  const pilMm = Math.max(200, Math.min(langs * 0.33, 2500));
  return { pilMm, uMid: (n2(info.uFra) + n2(info.uTil)) / 2, vMid: n2(info.vFra) + bredde / 2 };
}

// ↔ FIRE PILER (Emil 23.09: «det går kun an å dra den i 2 retninger og ikke
// 4 — vi trenger at den kan dras i alle 4»). Én pil per kant: to blå langs
// lengden (den ene flytter nedre ende, den andre øvre) og to oransje på tvers
// (den ene flytter radens start, den andre dens slutt). Hver pil drar SIN
// kant, og det er retningen pila peker som er retningen kanten går.
function lagPiler(info, id) {
  const ut = [];
  for (const [akse, ende] of [["lengde", "til"], ["lengde", "fra"], ["bredde", "til"], ["bredde", "fra"]]) {
    const aks = akse === "bredde" ? info.V : info.U;
    if (!aks) continue;
    const { pilMm: pil0, uMid, vMid } = pilMal(info, akse);
    const tegn = ende === "fra" ? -1 : 1;
    const pilMm = pil0 * 0.85;
    const start = pil0 * 0.12;              // litt fra midten, så de to pilene ikke går i hverandre
    const N = info.N || { x: 0, y: 1, z: 0 };
    // samme løft som merketeksten: over bølgetoppen, ikke nede i dalen
    const loft = 60;
    const pkt = (t) => new THREE.Vector3(
      tilScene(info.origo.x + info.U.x * (uMid + (akse === "bredde" ? 0 : t)) +
        info.V.x * (vMid + (akse === "bredde" ? t : 0)) + N.x * loft),
      tilScene(info.origo.y + info.U.y * (uMid + (akse === "bredde" ? 0 : t)) +
        info.V.y * (vMid + (akse === "bredde" ? t : 0)) + N.y * loft),
      tilScene(info.origo.z + info.U.z * (uMid + (akse === "bredde" ? 0 : t)) +
        info.V.z * (vMid + (akse === "bredde" ? t : 0)) + N.z * loft));
    const a = pkt(tegn * start), b = pkt(tegn * (start + pilMm));
    const retning = b.clone().sub(a);
    const L = retning.length();
    if (!(L > 0)) continue;
    const kvat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), retning.clone().normalize());
    const mat = new THREE.MeshBasicMaterial({ color: PIL_FARGE[akse],
      depthTest: false, depthWrite: false });
    const r = tilScene(Math.max(25, pilMm * 0.035));
    const skaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.72, 10), mat);
    skaft.position.copy(a.clone().lerp(b, 0.36));
    skaft.quaternion.copy(kvat);
    const hode = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, L * 0.28, 14), mat);
    hode.position.copy(a.clone().lerp(b, 0.86));
    hode.quaternion.copy(kvat);
    for (const m of [skaft, hode]) {
      m.renderOrder = 1000;
      m.userData.takPil = { akse, id, ende };
      ut.push(m);
    }
  }
  return ut;
}

// Hvilken pil ligger under musa?
export function pekPil(cx, cy) {
  if (!takJust || !canvas || !camera || !raycaster) return null;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const treff = raycaster.intersectObjects(takJust.markorer.children, true)
    .find(h => h.object && h.object.userData && h.object.userData.takPil);
  return treff ? { ...treff.object.userData.takPil, punkt: treff.point } : null;
}

export function startTakJuster(paaNytt) {
  if (!lagret || !lagret.tak || !lagret.tak.pa) { alert(t("Trykk «Generer tak» først.")); return; }
  tegnAlt();                       // meshene må bære id-ene før vi plukker
  const markorer = new THREE.Group();
  swGroup.add(markorer);
  settTakJust({ valgt: new Set(), drar: null, markorer, tegnPanel: paaNytt });
  $("blikkPanel")?.classList.remove("open");
  tegnTakJustBar(paaNytt);
}

export function avsluttTakJuster(paaNytt) {
  if (!takJust) return;
  swGroup.remove(takJust.markorer);
  settTakJust(null);
  tegnTakJustBar(paaNytt);
  if (paaNytt) paaNytt();
  apnePanel("blikkPanel");
}

// Hvilken takplate ligger under musa?
export function pekTak(cx, cy) {
  if (!canvas || !camera || !raycaster) return null;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  const treff = raycaster.intersectObjects(swGroup.children, true)
    .find(h => h.object && h.object.userData && h.object.userData.trpId);
  return treff ? { id: treff.object.userData.trpId, punkt: treff.point } : null;
}

const n2 = (x) => Number(x) || 0;
const tallEr = (x) => Number.isFinite(Number(x));

// Takoppsettet uten å dra inn tak.js (som importerer denne fila).
function takOppsettNaa() {
  const o = (lagret && lagret.takOppsett) || {};
  return { endeOverlappMm: tallEr(o.endeOverlappMm) ? Number(o.endeOverlappMm) : 150,
           snapDragTolMm: tallEr(o.snapDragTolMm) ? Number(o.snapDragTolMm) : 200 };
}

// Åsene på flata, i ABSOLUTT u — de ligger lagret sammen med flata.
function aserAbsFor(fi) {
  const F = (lagret && lagret.tak && lagret.tak.snap && lagret.tak.snap.flater) || [];
  const f = F[fi];
  return (f && Array.isArray(f.skjotU)) ? f.skjotU : [];
}

// ───────────────── 💾 LAGREDE TAKRESULTATER (Emil 22.09) ─────────────────
//
// Samme oppskrift som blikkets lagrede resultater: lokalt først, SharePoint
// etterpå. Det som lagres er OPPSETTET og JUSTERINGENE — ikke platelengdene.
// Lastes resultatet inn på et bygg som er endret siden, regnes platene på
// nytt av dagens stål, og det er nettopp poenget med at taket følger stålet.
export function takLagredeNokkel() { return "storm-ifc-tak-lagrede::" + S.fileName; }
export const TAK_SP_MAPPE = "Tak-resultater";
export function takSpFil() { return S.fileName + ".tak.json"; }
export let takSpStatus = "av";

export function lesTakLagredeRaa() {
  try {
    const l = JSON.parse(localStorage.getItem(takLagredeNokkel()) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (_) { return []; }
}
export function lesTakLagrede() {
  return lesTakLagredeRaa().filter(p => p && !p.slettet)
    .sort((a, b) => String(b.endret || b.dato || "").localeCompare(String(a.endret || a.dato || "")));
}
export function skrivTakLagrede(liste) {
  try { localStorage.setItem(takLagredeNokkel(), JSON.stringify(liste)); return true; }
  catch (_) { return false; }
}
export function lagreTakBeggeSteder(liste, etterpa) {
  if (!skrivTakLagrede(liste)) return false;
  if (!spPaalogget()) { takSpStatus = "av"; return true; }
  spSkriv(TAK_SP_MAPPE, takSpFil(), liste).then(res => {
    takSpStatus = res.ok ? "ok" : "feil";
    if (res.ok && res.liste) skrivTakLagrede(res.liste);
    if (etterpa) etterpa();
  });
  return true;
}
export async function hentTakLagredeFraSp(etterpa) {
  if (!spPaalogget()) { takSpStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(TAK_SP_MAPPE, takSpFil());
  if (S.fileName !== forFil) return;
  takSpStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (res.status === "ok" || res.status === "tom")
    skrivTakLagrede(flettPaaNavn(lesTakLagredeRaa(), res.liste));
  if (etterpa) etterpa();
}
export function takLagringsTekst() {
  if (takSpStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (takSpStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Logg inn i Biblioteket for å dele med de andre.");
}
function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

export function lagreTakResultat(navn, etterpa) {
  const rent = String(navn || "").trim().slice(0, 60);
  if (!rent) { alert(t("Gi resultatet et navn før du lagrer det.")); return; }
  const b = tilstand();
  if (!b || !b.pa) { alert(t("Trykk «Generer tak» først.")); return; }
  const liste = lesTakLagredeRaa();
  const fraFor = liste.findIndex(p => p.navn === rent);
  if (fraFor >= 0 && !liste[fraFor].slettet
      && !confirm(t("«{0}» finnes allerede. Skal den skrives over?", rent))) return;
  const naa = new Date();
  const post = { navn: rent, dato: naa.toISOString().slice(0, 10),
    endret: naa.toISOString(), av: mittNavn(),
    antall: Object.keys(b.just || {}).length + (b.ekstra || []).length,
    data: JSON.parse(JSON.stringify({
      oppsett: (lagret && lagret.takOppsett) || {},
      tak: { pa: true, just: b.just, ekstra: b.ekstra, nesteNr: b.nesteNr } })) };
  if (fraFor >= 0) liste[fraFor] = post; else liste.push(post);
  if (!lagreTakBeggeSteder(liste, etterpa)) {
    alert(t("Klarte ikke å lagre — nettleserens lagring er full. Slett et gammelt resultat og prøv igjen."));
    return;
  }
  if (etterpa) etterpa();
}

export function lastInnTakResultat(navn, etterpa) {
  const post = lesTakLagrede().find(p => p.navn === navn);
  if (!post || !post.data || !lagret) return;
  const d = JSON.parse(JSON.stringify(post.data));
  if (d.oppsett) lagret.takOppsett = { ...(lagret.takOppsett || {}), ...d.oppsett };
  const naa = tilstand() || {};
  // 🔑 Øyeblikksbildet av takflatene (`snap`) hører til MODELLEN, ikke til
  // det lagrede oppsettet — derfor beholdes dagens. Ellers ville et resultat
  // lagret på ett bygg dratt med seg det andre byggets takflater.
  lagret.tak = { pa: true, just: {}, ekstra: [], nesteNr: 1,
    snap: naa.snap || null, materiellIder: naa.materiellIder || [],
    ...(d.tak || {}), snapBehold: undefined };
  lagret.tak.snap = naa.snap || null;
  lagret.tak.materiellIder = naa.materiellIder || [];
  skrivLagret();
  tegnAlt();
  if (etterpa) etterpa();
}

export function slettTakResultat(navn, etterpa) {
  if (!confirm(t("Slette «{0}»?", navn))) return;
  const liste = lesTakLagredeRaa().map(p => p.navn === navn
    ? { navn: p.navn, slettet: true, endret: new Date().toISOString() } : p);
  lagreTakBeggeSteder(liste, etterpa);
  if (etterpa) etterpa();
}

// Posisjonen langs platas eget løp (u), i mm.
export function takLopMm(id, punkt) {
  const d = takMeshPerId.get(id);
  if (!d || !d.info || !punkt || !d.info.U) return null;
  const i = d.info, o = i.origo, U = i.U;
  const hh = U.x * U.x + U.z * U.z;
  if (!(hh > 1e-12)) return null;
  const dx = tilMm(punkt.x) - o.x, dz = tilMm(punkt.z) - o.z;
  return (dx * U.x + dz * U.z) / hh;
}

// Posisjonen på TVERS av plata (v), i mm — samme regnestykke som takLopMm,
// bare langs den andre aksen. Brukes når du drar i breddepila.
export function takTverrMm(id, punkt) {
  const d = takMeshPerId.get(id);
  if (!d || !d.info || !punkt || !d.info.V) return null;
  const i = d.info, o = i.origo, V = i.V;
  const hh = V.x * V.x + V.z * V.z;
  if (!(hh > 1e-12)) return null;
  const dx = tilMm(punkt.x) - o.x, dz = tilMm(punkt.z) - o.z;
  return (dx * V.x + dz * V.z) / hh;
}

window.addEventListener("pointerdown", (e) => {
  if (!takJust || e.button !== 0 || e.target !== canvas) return;
  // ↕ PILA FØRST. Treffer du en pil, er det DEN som bestemmer retningen —
  // ikke hvilken halvdel av plata du tilfeldigvis traff.
  const pil = pekPil(e.clientX, e.clientY);
  if (pil) {
    const b0 = tilstand();
    const d0 = takMeshPerId.get(pil.id);
    if (b0 && d0 && d0.info) {
      if (!takJust.valgt.has(pil.id)) { takJust.valgt.clear(); takJust.valgt.add(pil.id); }
      const base = new Map();
      for (const id of takJust.valgt) {
        const j = b0.just[id] || {};
        base.set(id, { dFra: Number(j.dFra) || 0, dTil: Number(j.dTil) || 0,
          dvFra: Number(j.dvFra) || 0,
          breddeMm: Number(j.breddeMm) || Number(d0.info.breddeMm) || 0 });
      }
      const startMm = pil.akse === "bredde"
        ? takTverrMm(pil.id, pekPlan(e.clientX, e.clientY, pil.id))
        : takLopMm(pil.id, pekPlan(e.clientX, e.clientY, pil.id));
      const ende = pil.ende === "fra" ? "fra" : "til";
      if (startMm !== null) {
        takJust.drar = { id: pil.id, akse: pil.akse, ende, startMm, base,
          kantStart: pil.akse === "bredde" ? null
            : Number(ende === "fra" ? d0.info.uFra : d0.info.uTil) };
        e.stopPropagation();
        merkTakValgte(); tegnTakJustBar(takJust.tegnPanel);
        return;
      }
    }
  }
  const treff = pekTak(e.clientX, e.clientY);
  if (!treff) { takJust.drar = null; return; }
  const b = tilstand();
  if (!b) return;
  if (e.shiftKey) {
    if (takJust.valgt.has(treff.id)) takJust.valgt.delete(treff.id);
    else takJust.valgt.add(treff.id);
    e.stopPropagation();
    merkTakValgte(); tegnTakJustBar(takJust.tegnPanel);
    return;
  }
  if (!takJust.valgt.has(treff.id)) { takJust.valgt.clear(); takJust.valgt.add(treff.id); }
  const startMm = takLopMm(treff.id, treff.punkt);
  const d = takMeshPerId.get(treff.id);
  if (startMm === null || !d) { merkTakValgte(); tegnTakJustBar(takJust.tegnPanel); return; }
  const midt = (d.info.uFra + d.info.uTil) / 2;
  const base = new Map();
  for (const id of takJust.valgt) {
    const j = b.just[id] || {};
    base.set(id, { dFra: Number(j.dFra) || 0, dTil: Number(j.dTil) || 0 });
  }
  const ende = startMm < midt ? "fra" : "til";
  takJust.drar = { id: treff.id, ende, startMm, base,
    // 🧲 kanten slik den står NÅ — snappingen regnes mot denne, ikke mot
    // museposisjonen, så et snap ikke flytter seg videre for hvert musepiksel
    kantStart: ende === "fra" ? d.info.uFra : d.info.uTil };
  e.stopPropagation();
  merkTakValgte(); tegnTakJustBar(takJust.tegnPanel);
}, true);

window.addEventListener("pointermove", (e) => {
  if (!takJust || !takJust.drar) return;
  const d = takJust.drar;
  // ↕ BREDDEPILA: her endres RADENS bredde, ikke lengden. Det er samme tall
  // som «Bredde (mm)»-feltet i verktøylinja skriver, så de to kan ikke komme i
  // utakt — og en TRP-plate er like bred hele veien, derfor raden og ikke plata.
  if (d.akse === "bredde") {
    const b2 = tilstand();
    const naV = takTverrMm(d.id, pekPlan(e.clientX, e.clientY, d.id));
    if (!b2 || naV === null) return;
    const delta = Math.round((naV - d.startMm) / 5) * 5;
    for (const id of takJust.valgt) {
      const basis = d.base.get(id);
      if (!basis) continue;
      const j = b2.just[id] || (b2.just[id] = {});
      if (d.ende === "fra") {
        // den NEDRE sida flyttes: raden begynner et annet sted, og bredden
        // tar igjen det samme — den andre sida står stille
        const ny = Math.max(50, Math.round(basis.breddeMm - delta));
        j.dvFra = basis.dvFra + (basis.breddeMm - ny);
        j.breddeMm = ny;
      } else {
        j.breddeMm = Math.max(50, Math.round(basis.breddeMm + delta));
      }
    }
    skrivLagret();
    tegnAlt();
    merkTakValgte();
    e.stopPropagation();
    return;
  }
  const naMm = takLopMm(d.id, pekPlan(e.clientX, e.clientY, d.id));
  if (naMm === null) return;
  let delta = Math.round((naMm - d.startMm) / 5) * 5;
  const b = tilstand();
  if (!b) return;
  // 🧲 SNAPPING (Emil 22.09). Bare når ÉN plate er valgt: drar du flere
  // samtidig har de hver sin kant, og et snap på den ene ville flyttet de
  // andre til et sted ingen har pekt på.
  if (takJust.valgt.size === 1 && tallEr(d.kantStart)) {
    const meg = takMeshPerId.get(d.id);
    const fi = meg && meg.info ? meg.info.flate : null;
    const kanter = [];
    for (const [id2, d2] of takMeshPerId) {
      if (id2 === d.id || !d2.info || d2.info.flate !== fi) continue;
      kanter.push(d2.info.uFra, d2.info.uTil);
    }
    const o = takOppsettNaa();
    const kand = snapKandidater(d.ende, aserAbsFor(fi), kanter, o.endeOverlappMm);
    const raa = n2(d.kantStart) + delta;
    const snappet = snapVerdi(raa, kand, o.snapDragTolMm);
    delta = Math.round(snappet - n2(d.kantStart));
  }
  for (const id of takJust.valgt) {
    const basis = d.base.get(id);
    if (!basis) continue;
    const j = b.just[id] || (b.just[id] = {});
    if (d.ende === "fra") j.dFra = basis.dFra - delta; else j.dTil = basis.dTil + delta;
  }
  skrivLagret();
  tegnAlt();
  merkTakValgte();
  e.stopPropagation();
}, true);

window.addEventListener("pointerup", (e) => {
  if (!takJust || e.button !== 0 || !takJust.drar) return;
  takJust.drar = null;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  lagreOgTegn(takJust.tegnPanel);
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && takJust) { e.stopPropagation(); avsluttTakJuster(takJust.tegnPanel); }
}, true);

// Takflatas eget plan, så draget følger musa også utenfor selve plata.
const _tPlan = new THREE.Plane(), _tPkt = new THREE.Vector3();
export function pekPlan(cx, cy, id) {
  const d = takMeshPerId.get(id);
  if (!d || !d.info || !d.info.N || !canvas || !camera || !raycaster) return null;
  const i = d.info, o = i.origo, N = i.N;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  _tPlan.setFromNormalAndCoplanarPoint(new THREE.Vector3(N.x, N.y, N.z).normalize(),
    new THREE.Vector3(tilScene(o.x), tilScene(o.y), tilScene(o.z)));
  return raycaster.ray.intersectPlane(_tPlan, _tPkt) ? _tPkt.clone() : null;
}
