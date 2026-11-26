// 📷 BILDER AV MODELLEN I FRAMDRIFTSRAPPORTEN (Emil 26.11)
//
// «Framdriftsrapport skal inneholde bilde av 3D-modellen: ett bilde som bare
// viser det som er fullført, ett som viser litt bak/pågår og ett som viser
// forsinket. Har en av kategoriene 0 objekter, legges det ikke inn bilde.»
// «Markert med fargekoden, og resten av modellen er gjennomsiktig.»
// «Ovenfra, og se ned på skrå mot modellen» (vedlagt skjermbilde).
//
// Hvert bilde: objektene i kategorien i sin farge (grønn/gul/rød, heldekkende),
// resten av modellen (IFC og SW/tak/blikk) svakt grå og gjennomsiktig. Rigg,
// materiell, terreng og markeringer er ikke med. Kameraet står på langsiden av
// bygget, dreid 30° og 35° over bakken – samme skråvinkel og utsnitt som
// skråbildene i framdriftsplanen og riggplanen (riggplan.js).
// Bildene følger «Rapport for» (fagfilteret): rapportens rader er det som
// farges; resten av bygget er gjennomsiktig.
import * as THREE from "three";
import { EKSTRA_LAG, S } from "./state.js";
import { t } from "./i18n.js";
import { scene } from "./scene.js";
import { lastEtterbehandling, oversiktKameraer, tegnOversiktBilde } from "./riggplan.js";
import { elementGeometri } from "./stopeplan-vis.js";
import { finnObjekter, settIfcSkjult } from "./framdrift-vis.js";
import { idFor, slagFor } from "./framdrift-regn.js";
import { utsnitt } from "./framdrift-pdf.js";
import { BILDE_KATEGORIER, bildeKategorier, skraaRetning } from "./ferdig-regn.js";

const FARGE = { gronn: 0x3cb44b, gul: 0xe9a13b, rod: 0xef4444 };
const SPOKELSE = { farge: 0xb9bfc7, opasitet: 0.14 };
const LAG_MED = new Set(["sw", "tak"]);   // lagene med SW-elementer, takplater og blikk

// Bytt materialet på alt i `o` (husk det gamle). lag(gammelt) → nytt.
function byttMaterial(o, lag, rydd) {
  o.traverse(m => {
    if (!m.material || m.isSprite) return;
    const orig = m.material;
    m.material = Array.isArray(orig) ? orig.map(lag) : lag(orig);
    rydd.push(() => {
      const ny = m.material;
      m.material = orig;
      (Array.isArray(ny) ? ny : [ny]).forEach(x => x && x.dispose && x.dispose());
    });
  });
}
const spokelse = () => new THREE.MeshBasicMaterial({ color: SPOKELSE.farge, transparent: true, opacity: SPOKELSE.opasitet,
  depthWrite: false, side: THREE.DoubleSide });
const heldekkende = (farge) => new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });

// Gjør scenen klar for ett bilde: `farget` = nøklene i kategorien.
// Returnerer rydde-funksjonen (kall alltid, i finally).
function settScene(farget, farge, geoCache) {
  const rydd = [];
  const skjul = (o) => { if (o.visible) { o.visible = false; rydd.push(() => { o.visible = true; }); } };
  // 1) Bare modellen og SW/tak-lagene er med
  const behold = new Set([S.modelGroup]);
  for (const l of EKSTRA_LAG) if (LAG_MED.has(l.id) && l.gruppe) behold.add(l.gruppe);
  for (const o of scene.children) if (!behold.has(o) && !o.isLight && !o.isCamera) skjul(o);
  // 2) IFC: kopien i fargen lages FØR originalene skjules (lav kvalitet er slått sammen)
  const ider = [...farget].filter(k => slagFor(k) === "id").map(k => Number(idFor(k)));
  const nøkkel = farge + "|" + ider.length;
  let g = geoCache.get(nøkkel);
  if (g === undefined) { try { g = ider.length ? elementGeometri(ider) : null; } catch (_) { g = null; } geoCache.set(nøkkel, g); }
  if (S.modelGroup) byttMaterial(S.modelGroup, spokelse, rydd);
  if (ider.length) { settIfcSkjult(new Set(ider)); rydd.push(() => settIfcSkjult(new Set())); }
  if (g) {
    const m = new THREE.Mesh(g, heldekkende(FARGE[farge]));
    m.userData.ikkeValg = true;
    scene.add(m);
    rydd.push(() => { scene.remove(m); m.material.dispose(); });
  }
  // 3) SW-elementer, takplater og blikk: i fargen eller gjennomsiktige
  const objMap = finnObjekter();
  const nokkelFor = new Map();
  for (const [k, os] of objMap) for (const o of os) nokkelFor.set(o, k);
  for (const l of EKSTRA_LAG) {
    if (!LAG_MED.has(l.id) || !l.gruppe) continue;
    for (const o of l.gruppe.children) {
      const k = nokkelFor.get(o);
      if (!k) { skjul(o); continue; }                     // lapper og utsparingsmerking
      if (!o.visible) continue;
      byttMaterial(o, farget.has(k) ? () => heldekkende(FARGE[farge]) : spokelse, rydd);
    }
  }
  return () => { for (let j = rydd.length - 1; j >= 0; j--) { try { rydd[j](); } catch (_) {} } };
}

// Kameraet: på langsiden, dreid 30°, 35° over bakken, tett rundt hele bygget
// (samme utsnitt på alle bildene, så de kan sammenlignes).
function kamera(aspekt) {
  const u = utsnitt();
  if (!u) return null;
  const fra = skraaRetning(u.bE, u.bN);
  const kam = oversiktKameraer(u.base, u.senter, u.nord, u.ost, u.rM, u.bunnY, aspekt, u.punkter,
    [{ id: "skraa", navn: "", fra }])[0];
  return kam;
}

// r = rapporten (ferdig-regn.rapport). Svar: [{ farge, tittel, n, data }] –
// bare kategoriene som har objekter. pxB × pxH = bildets størrelse i piksler.
export async function lagBilder(r, pxB, pxH) {
  if (!S.modelGroup || !r) return [];
  const kat = bildeKategorier(r).filter(k => k.n > 0);
  if (!kat.length) return [];
  await lastEtterbehandling();
  const kam = kamera(pxB / pxH);
  if (!kam) return [];
  const geoCache = new Map();
  const ut = [];
  try {
    for (const k of kat) {
      const farget = new Set(r.rader.filter(x => x.farge === k.farge).map(x => x.k));
      const rydd = settScene(farget, k.farge, geoCache);
      try {
        // Uten skygger (det gjennomsiktige ville kastet skygge) og uten dis
        ut.push({ farge: k.farge, tittel: t(k.tittel), n: k.n, av: r.n,
          data: tegnOversiktBilde({ kam: kam.kam, skygge: null, taake: null, himmel: false }, pxB, pxH) });
      } finally { rydd(); }
    }
  } finally {
    for (const g of geoCache.values()) if (g && g.dispose) g.dispose();
    // Rapport-fanens egne farger og skjuling tilbake
    if (S.ferdigOppdater) { try { S.ferdigOppdater(); } catch (_) {} }
  }
  return ut;
}
export { BILDE_KATEGORIER };
