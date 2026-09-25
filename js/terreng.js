// ⛰ Terreng — hent landskapet rundt byggeplassen fra Kartverket og sett
// modellen ned i det, så prosjektlederen ser bygget i terrenget i stedet for
// å sveve i svart.
//
// Grunnlag: «Storm IFC-Viewer Terreng VEDTATT SPESIFIKASJON 2026-09-24.md» og
// «byggeplan Terreng 2026-09-25.md». Denne fila dekker TRINN 1–6:
//   1. knappen i Bygg Info og panelet
//   2. adresse → koordinat → høydegrid (ws.geonorge.no + WCS)
//   3. gridet som flate i scenen, i RIKTIG MÅLESTOKK
//   4. beskjæringsboksen (røde håndtak)
//   5. plasser og roter bygget (fotavtrykk, rotasjonshåndtak, 90°-snapping)
//   6. gulvkote — én tallverdi, aldri musa i Z
//   + utskjæring: terrenget under bygget byttes med en flat plate (gule håndtak)
// Lagring i SharePoint (trinn 7) kommer oppå dette.
//
// Kun kontor: importeres av main.js, IKKE av lett-main.js (spesifikasjonen
// punkt 5 — byggeplass-lenka når ikke SharePoint uansett).
//
// Den rene regningen (TIFF-lesing, UTM, grid → trekanter, plassering, plate,
// gulvkote) ligger i js/terreng-regn.js, så den kan testes uten nettleser.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på, registrerEkstraGruppe, tilM } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, controls, frameHooks, grid, scene, updateScreenScaled } from "./scene.js";
import { koteValue } from "./measure.js";
import {
  STANDARD_UTSNITT, UTSNITT, adresseUrl, bboxFra, byggTilTerreng, flyttKlippKant, flyttPadKant, flyttPlass,
  fulltKlipp, gridTilTrekanter, gulvReferanse, hoydeFarger, hoydeIPunkt, hoydeSpenn, hoydeVed, klippHandtak,
  klippMeter, klippOmriss, lagIndeks, lavesteUnder, lesTiff, likeKlipp, likePad, mTilScene, normVinkel,
  padFlagg, padHandtak, padMeter, padStandard, pikselSenter, punktFraE, punktFraN, snapVinkel, tolkKoordinat,
  tolkKote, vaskAdresseSvar, wcsUrl
} from "./terreng-regn.js";

// ═══════════════════════ TILSTAND ═══════════════════════
// Alt om det lastede terrenget. null = ingen terreng.
//   grid     — rådataene fra Kartverket (beholdes: beskjæring, plate og
//              masseberegning senere trenger høydene, ikke trekantene)
//   E0, N0   — nullpunktet i UTM33 (adressepunktet, avrundet til hel meter)
//   h0       — referansehøyde for trekantene (bare for Float32-presisjon)
//   klipp    — beskjæringen (trinn 4)
//   plass    — { pE, pN, rot }: hvor bygget står på terrenget (trinn 5)
//   gulv     — { kote, grov }: gulvkoten i moh. (trinn 6). grov = beregnet
//              av «Legg oppå terrenget», ikke oppgitt fra tegningen
//   pad      — { paa, x0, x1, z0, z1 }: plata under bygget, i byggrammen
let terreng = null;
let skjult = false;
let opptatt = false;
let melding = "";        // statuslinja i panelet
let meldingFeil = false;
let treff = [];          // adressetreff å velge mellom
let sisteSok = "";
let utsnitt = STANDARD_UTSNITT;
let flyttModus = false;  // ✥ «Flytt og roter bygget» er slått på

// ═══════════════════════ SCENEN ═══════════════════════
//
//   terrengGroup            — laget som er meldt inn (skjul, gjennomsiktig)
//   ├─ landGroup            — står i modellens senter, roteres med plass.rot
//   │   └─ innhold          — forskjøvet med plass.pE/pN
//   │       ├─ terrengflata
//   │       └─ klippGroup   — røde håndtak (beskjæring)
//   └─ byggGroup            — i MODELLENS koordinater: plata, fotavtrykket,
//                             gule håndtak og rotasjonshåndtaket
//
// Modellen står stille; terrenget flyttes og roteres under den. Se
// «PLASSERING» i terreng-regn.js for hvorfor.
export const terrengGroup = new THREE.Group();
terrengGroup.name = "terreng";
scene.add(terrengGroup);
const landGroup = new THREE.Group();
const innhold = new THREE.Group();
const byggGroup = new THREE.Group();
landGroup.add(innhold);
terrengGroup.add(landGroup, byggGroup);

// Laget melder inn hva det kan (se EKSTRA_LAG i js/state.js).
//
// TERRENGET HAR MED VILJE IKKE «plukk» OG IKKE «velg». Kan en terrengtrekant
// velges, havner den i flervalg, grupper og Mengder — en feil som sprer seg
// til fire verktøy før noen skjønner hvor den kom fra (byggeplanen, advarsel 3).
// I stedet har det «flate»: 📏 Mål og ▲ Kote kan treffe terrenget og plata,
// ingenting annet.
//
// «mengder» og «sokRader» er tomme med vilje — kontrakten i test-ekstralag
// krever at hvert lag svarer, og terrenget svarer «ingenting å telle».
registrerEkstraGruppe(terrengGroup, {
  id: "terreng",
  navn: "Terreng",
  noeSkjult: () => !!terreng && skjult,
  visAlt() { if (skjult) settSkjult(false); },
  skjulTilstand: () => ({ skjult }),
  settSkjulTilstand(v) { settSkjult(!!(v && v.skjult)); },
  mengder: () => {},
  sokRader: () => [],
  gaTil() { flyTilTerreng(); },
  utseendeRader(body) { tegnUtseendeRad(body); },
  flate: (x, y) => flateTreff(x, y)
});

function settSkjult(v) {
  skjult = !!v;
  terrengGroup.visible = !!terreng && !skjult;
  oppdaterRutenett();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (erApen()) tegnPanel();
}

// GridHelperen i scene.js ligger i modellens laveste punkt. Med terreng i
// samme plan flimrer de to flatene om hverandre (z-fighting) — det ser ut som
// en grafikkfeil. Rutenettet viker når terrenget vises.
function oppdaterRutenett() {
  grid.visible = !(terreng && !skjult);
}

// Kameraets bakre klippeplan settes av fitToModel etter MODELLENS størrelse
// (10 × diagonalen). Et bygg på 30 m får da ~400 m sikt, og en 800 m tomt
// kuttes i kanten. Rammekroken strekker det så hele terrenget synes — også
// etter at noen har trykket «Tilpass», som setter det tilbake.
let trengerFar = 0;
frameHooks.push(() => {
  if (!trengerFar || !terrengGroup.visible) return;
  if (camera.far < trengerFar) { camera.far = trengerFar; camera.updateProjectionMatrix(); }
});

// ═══════════════════════ MODELLEN SOM REFERANSE ═══════════════════════
//
// Alt om den åpne modellen som plasseringen trenger, regnet på nytt ved hver
// tegning (modellen kan ha fått ny enhet i ⚙ Innstillinger).
//   c      — senteret i plan (scene)
//   skala  — meter per sceneenhet
//   fp     — fotavtrykket (modellens boks i plan) i byggrammen, meter
//   a      — modellkoten (meter) i scenens y = 0, så y ↔ kote kan regnes
//   ref    — gulvReferanse: hvilken modellkote gulvet har (±0 eller laveste)
function modellRef() {
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  const skala = S.enhetSkala || 1;
  // ▲ Kote-verktøyet leser modellens EGNE koter (koteValue i measure.js).
  // Vi regner på samme måte, så gulvkoten og Kote-lappen alltid er enige.
  const kote = (y) => tilM(koteValue(new THREE.Vector3(c.x, y, c.z)));
  const a = kote(0);
  const minK = kote(boks.min.y), maxK = kote(boks.max.y);
  return {
    boks, c, skala, a,
    fp: { x0: (boks.min.x - c.x) * skala, x1: (boks.max.x - c.x) * skala,
          z0: (boks.min.z - c.z) * skala, z1: (boks.max.z - c.z) * skala },
    ref: gulvReferanse(Math.min(minK, maxK), Math.max(minK, maxK))
  };
}

// Tillegget som gjør modellkoter om til moh. Kote-verktøyet i main.js leser
// denne, så ▲ Kote på gulvet viser gulvkoten, og på terrenget terrengets moh.
function koteTillegg(mr) {
  if (!terreng || !terreng.gulv) return 0;
  return terreng.gulv.kote - (mr || modellRef()).ref.mg;
}
S.koteTillegg = () => (terreng && S.modelGroup) ? koteTillegg() : 0;

// moh. → scenens y
function yFraMoh(moh, mr) {
  return (moh - koteTillegg(mr) - mr.a) / mr.skala;
}

// ═══════════════════════ TREFF (Mål og Kote) ═══════════════════════
const _ray = new THREE.Raycaster();
const _p = new THREE.Vector2();
let flateMesh = null;   // terrengflata
let plateMesh = null;   // plata under bygget
function flateTreff(x, y) {
  if (!terreng || !terrengGroup.visible) return null;
  _p.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  _ray.setFromCamera(_p, camera);
  const mål = [flateMesh, plateMesh].filter(m => m && m.visible);
  const h = _ray.intersectObjects(mål, false)[0];
  if (!h) return null;
  // utenSnap: kant-snappen i measure.js bygger kantliste per element og er
  // laget for stål. På 300 000 terrengtrekanter finnes ingen «hjørner» å
  // feste seg til — punktet du peker på er punktet.
  return { point: h.point, distance: h.distance, object: h.object, utenSnap: true };
}

// ═══════════════════════ HÅNDTAK OG VISNING ═══════════════════════
const HANDTAK_PX = 13;          // håndtakets diameter på skjermen
const TREFF_PX = 16;            // hvor nær pekeren må være for å ta tak
const LOFT_M = 0.4;             // omriss løftes litt, så de ikke forsvinner i terrenget
const FARGE_KLIPP = 0xe53935;   // rødt: beskjæringen av terrenget
const FARGE_PAD = 0xffb300;     // gult: plata under bygget
const FARGE_FOT = 0xffffff;     // hvitt: byggets fotavtrykk
const FARGE_PLATE = 0x8f9194;   // grått: planert grus/betong

const klippMat = new THREE.LineBasicMaterial({ color: FARGE_KLIPP, depthTest: false, transparent: true, opacity: 0.95 });
const padLinjeMat = new THREE.LineBasicMaterial({ color: FARGE_PAD, depthTest: false, transparent: true, opacity: 0.95 });
const fotMat = new THREE.LineBasicMaterial({ color: FARGE_FOT, depthTest: false, transparent: true, opacity: 0.9 });
const handtakGeo = new THREE.SphereGeometry(1, 12, 8);
const handtakMat = {
  klipp: new THREE.MeshBasicMaterial({ color: FARGE_KLIPP, depthTest: false }),
  pad: new THREE.MeshBasicMaterial({ color: FARGE_PAD, depthTest: false }),
  rot: new THREE.MeshBasicMaterial({ color: FARGE_FOT, depthTest: false })
};

const klippGroup = new THREE.Group();   // i innhold (følger terrenget)
const padGroup = new THREE.Group();     // i byggGroup (følger bygget)
const flyttGroup = new THREE.Group();   // i byggGroup: fotavtrykk + rotasjonshåndtak
klippGroup.name = "terreng-beskjaering";
padGroup.name = "terreng-plate";
flyttGroup.name = "terreng-flytt";
innhold.add(klippGroup);
byggGroup.add(padGroup, flyttGroup);

let handtakene = [];    // [{ type: "klipp"|"pad"|"rot", kant, mesh }]

function tomGruppe(g) {
  for (const o of g.children.slice()) {
    g.remove(o);
    if (o.geometry && o.geometry !== handtakGeo) o.geometry.dispose();
    if (o.userData.egetMat && o.material) o.material.dispose();   // plata har sitt eget
  }
}

function nyttHandtak(gruppe, type, kant, pos) {
  const m = new THREE.Mesh(handtakGeo, handtakMat[type]);
  m.position.copy(pos);
  m.userData.px = HANDTAK_PX;
  m.renderOrder = 998;
  gruppe.add(m);
  handtakene.push({ type, kant, mesh: m });
}

// (i, j) i gridet → punkt i `innhold` sine koordinater
function lokaltPunkt(i, j, loftM) {
  const { grid: g, E0, N0, h0 } = terreng;
  const skala = S.enhetSkala || 1;
  const c = pikselSenter(g, i, j);
  const h = hoydeIPunkt(g, i, j);
  return new THREE.Vector3(
    mTilScene(c.E - E0, skala),
    mTilScene((h != null ? h : h0) - h0 + (loftM || 0), skala),
    -mTilScene(c.N - N0, skala));
}

// Byggrammen (meter) → byggGroup sine koordinater (scene, modellens senter = 0)
function byggPunkt(bx, bz, y) {
  const s = S.enhetSkala || 1;
  return new THREE.Vector3(bx / s, y, bz / s);
}

function rektangel(x0, x1, z0, z1, y, mat) {
  const pts = [byggPunkt(x0, z0, y), byggPunkt(x1, z0, y), byggPunkt(x1, z1, y), byggPunkt(x0, z1, y)];
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
  l.renderOrder = 997;
  return l;
}

function tegnHandtak() {
  handtakene = [];
  tomGruppe(klippGroup); tomGruppe(padGroup); tomGruppe(flyttGroup);
  plateMesh = null;
  if (!terreng || !S.modelGroup) return;
  const mr = modellRef();
  const s = mr.skala;

  // ✂ beskjæringen — rødt, følger terrenget
  const k = terreng.klipp;
  const omriss = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    klippOmriss(k).map(([i, j]) => lokaltPunkt(i, j, LOFT_M))), klippMat);
  omriss.renderOrder = 997;
  klippGroup.add(omriss);
  for (const hd of klippHandtak(k)) nyttHandtak(klippGroup, "klipp", hd.kant, lokaltPunkt(hd.i, hd.j, LOFT_M));

  // Plata og fotavtrykket står i gulvhøyde, i modellens koordinater
  const gulvY = (mr.ref.mg - mr.a) / s;
  byggGroup.position.set(mr.c.x, 0, mr.c.z);
  const p = terreng.pad;
  if (p && p.paa) {
    const geo = new THREE.PlaneGeometry((p.x1 - p.x0) / s, (p.z1 - p.z0) / s);
    geo.rotateX(-Math.PI / 2);
    plateMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: FARGE_PLATE, side: THREE.DoubleSide,
      // Samme triks som terrenget: gulvet i modellen ligger i nøyaktig samme
      // høyde som plata, og modellen skal vinne — ikke flimre.
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    }));
    plateMesh.position.copy(byggPunkt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, gulvY));
    plateMesh.name = "terrengplate";
    plateMesh.userData.egetMat = true;
    padGroup.add(plateMesh);
    const loft = LOFT_M * 0.25 / s;
    padGroup.add(rektangel(p.x0, p.x1, p.z0, p.z1, gulvY + loft, padLinjeMat));
    for (const hd of padHandtak(p)) nyttHandtak(padGroup, "pad", hd.kant, byggPunkt(hd.bx, hd.bz, gulvY + loft));
  }

  // ✥ fotavtrykket og rotasjonshåndtaket (bare i flyttemodus)
  const f = mr.fp;
  flyttGroup.add(rektangel(f.x0, f.x1, f.z0, f.z1, gulvY + LOFT_M / s, fotMat));
  const nord = Math.min(f.z0, p && p.paa ? p.z0 : f.z0) - 3;
  const rotPos = byggPunkt(0, nord, gulvY + LOFT_M / s);
  const stang = new THREE.Line(new THREE.BufferGeometry().setFromPoints([byggPunkt(0, 0, gulvY + LOFT_M / s), rotPos]), fotMat);
  stang.renderOrder = 997;
  flyttGroup.add(stang);
  nyttHandtak(flyttGroup, "rot", "rot", rotPos);
}

// Håndtakene synes bare med panelet åpent, og har konstant skjermstørrelse.
// Rotasjonshåndtaket og fotavtrykket bare i flyttemodus.
frameHooks.push(() => {
  const vis = !!terreng && !skjult && erApen();
  klippGroup.visible = vis;
  for (const o of padGroup.children) if (o !== plateMesh) o.visible = vis;
  flyttGroup.visible = vis && flyttModus;
  if (vis) { updateScreenScaled(klippGroup); updateScreenScaled(padGroup); if (flyttModus) updateScreenScaled(flyttGroup); }
});

// ═══════════════════════ TEGNING ═══════════════════════

function ryddScene() {
  if (flateMesh) {
    innhold.remove(flateMesh);
    flateMesh.geometry.dispose(); flateMesh.material.dispose();
    flateMesh = null;
  }
  handtakene = [];
  tomGruppe(klippGroup); tomGruppe(padGroup); tomGruppe(flyttGroup);
  plateMesh = null;
  trengerFar = 0;
}

// Plasserer gruppene etter plass, gulvkote og modellen. Billig — kalles for
// hvert musetrekk mens bygget dras.
function plasserGrupper(mr) {
  const { E0, N0, h0, plass } = terreng;
  const s = mr.skala;
  landGroup.position.set(mr.c.x, yFraMoh(h0, mr), mr.c.z);
  landGroup.rotation.set(0, (plass.rot || 0) * Math.PI / 180, 0);
  innhold.position.set(-mTilScene(plass.pE || 0, s), 0, mTilScene(plass.pN || 0, s));
  void E0; void N0;
}

// Bygger flata: punktene (med plata skåret ut) og normalene. Kalles når
// terrenget hentes og når plass/plate/gulv er FERDIG endret — ikke for hvert
// musetrekk (160 000 punkt + normaler er ~50 ms).
function byggFlate(mr) {
  const { grid: g, E0, N0, h0 } = terreng;
  const p = terreng.pad;
  const flat = (p && p.paa && terreng.gulv)
    // Litt under plata: terrenget skal ikke stikke opp gjennom den i skrå
    // ruter langs kanten.
    ? { flagg: padFlagg(g, E0, N0, terreng.plass, p), hoyde: terreng.gulv.kote - 0.05 }
    : null;
  const tr = gridTilTrekanter(g, E0, N0, h0, mr.skala, flat);
  const geo = flateMesh.geometry;
  geo.setAttribute("position", new THREE.BufferAttribute(tr.pos, 3));
  // Normalene regnes på HELE gridet. Beskjæringen bytter bare indeksen
  // etterpå — da blir ikke lyset på kanten annerledes enn midt i.
  geo.setIndex(new THREE.BufferAttribute(tr.idx, 1));
  geo.computeVertexNormals();
  geo.setIndex(new THREE.BufferAttribute(lagIndeks(tr.ok, g.w, g.h, terreng.klipp), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  terreng.ok = tr.ok;
}

function tegnTerreng() {
  ryddScene();
  if (!terreng || !S.modelGroup) { oppdaterRutenett(); return; }
  const mr = modellRef();
  const g = terreng.grid;
  if (!terreng.klipp) terreng.klipp = fulltKlipp(g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("color", new THREE.BufferAttribute(hoydeFarger(g, terreng.spenn), 3));
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // Skyver terrenget et hårsbredd bakover i dybdebufferen, så en
    // bunnplate som ligger nøyaktig i terrenghøyden vinner over terrenget
    // i stedet for å flimre.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  flateMesh = new THREE.Mesh(geo, mat);
  flateMesh.name = "terrengflate";
  flateMesh.userData.terreng = true;
  innhold.add(flateMesh);
  byggFlate(mr);
  plasserGrupper(mr);
  tegnHandtak();
  terrengGroup.visible = !skjult;
  trengerFar = mTilScene(g.w * g.dx * 4, mr.skala);
  oppdaterRutenett();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
}

// Etter en ferdig endring av plass, plate eller gulv
function oppdaterAlt() {
  if (!terreng || !flateMesh || !S.modelGroup) return;
  const mr = modellRef();
  byggFlate(mr);
  plasserGrupper(mr);
  tegnHandtak();
  visTall();
}

function flyTilTerreng() {
  if (!terreng) return;
  const s = mTilScene(terreng.grid.w * terreng.grid.dx, S.enhetSkala || 1);
  const c = byggGroup.getWorldPosition(new THREE.Vector3());
  c.y = landGroup.position.y;
  camera.position.set(c.x + s * 0.7, c.y + s * 0.6, c.z + s * 0.7);
  controls.target.copy(c);
  controls.update();
}

// ═══════════════════════ ✂ BESKJÆRING (trinn 4) ═══════════════════════
// Bare trekantlista byttes — punktene og normalene står.
function brukKlipp() {
  if (!flateMesh || !terreng) return;
  const idx = lagIndeks(terreng.ok, terreng.grid.w, terreng.grid.h, terreng.klipp);
  flateMesh.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  tegnHandtak();
  visTall();
}

function klippTekst() {
  if (!terreng) return "";
  const m = klippMeter(terreng.grid, terreng.klipp);
  return Math.round(m.bredde) + " × " + Math.round(m.hoyde) + " m";
}
function padTekst() {
  if (!terreng || !terreng.pad) return "";
  const m = padMeter(terreng.pad);
  const f = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO");
  return f(m.bredde) + " × " + f(m.lengde) + " m";
}
function plassTekst() {
  if (!terreng) return "";
  const { pE, pN } = terreng.plass;
  const f = (v) => Math.abs(Math.round(v * 10) / 10).toLocaleString("no-NO");
  return f(pE) + " m " + (pE < 0 ? t("vest") : t("øst")) + ", " + f(pN) + " m " + (pN < 0 ? t("sør") : t("nord"));
}

// Oppdaterer tallene uten å tegne hele panelet på nytt — da ville et felt
// med markøren i mistet fokus for hvert musetrekk.
function visTall() {
  const sett = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  sett("trKlippTall", klippTekst());
  sett("trPadTall", padTekst());
  sett("trPlassTall", plassTekst());
  const rot = $("trRot");
  if (rot && terreng && document.activeElement !== rot) rot.value = String(normVinkel(terreng.plass.rot)).replace(".", ",");
  const nb = $("trKlippHele");
  if (nb && terreng) nb.disabled = likeKlipp(terreng.klipp, fulltKlipp(terreng.grid));
}

function settKlipp(k, medAngre) {
  if (!terreng || likeKlipp(k, terreng.klipp)) return;
  const fra = terreng.klipp, til = Object.assign({}, k), gjeldende = terreng;
  terreng.klipp = til;
  brukKlipp();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: "Terreng beskåret",
    angre: () => { if (terreng === gjeldende) { terreng.klipp = fra; brukKlipp(); } },
    gjenopprett: () => { if (terreng === gjeldende) { terreng.klipp = til; brukKlipp(); } }
  });
}

// ═══════════════════════ ✥ PLASSERING (trinn 5) ═══════════════════════
//
// Brukeren flytter BYGGET — men det er terrenget som flyttes under det. For
// at det skal SE ut som bygget flytter seg, flyttes kameraet like mye som
// terrenget: da står terrenget stille på skjermen og bygget glir over det.
// Uten dette gled terrenget motsatt vei av musa, og det er det motsatte av
// «dra fotavtrykket på plass».

function kameraNaa() { return { p: camera.position.clone(), m: controls.target.clone() }; }
function settKamera(k) { camera.position.copy(k.p); controls.target.copy(k.m); controls.update(); }

function kameraForskyv(v) {
  camera.position.add(v);
  controls.target.add(v);
  controls.update();
}
function kameraRoter(d, cx, cz) {
  const c = Math.cos(d), s = Math.sin(d);
  for (const p of [camera.position, controls.target]) {
    const x = p.x - cx, z = p.z - cz;
    p.x = cx + x * c + z * s;
    p.z = cz - x * s + z * c;
  }
  controls.update();
}

// Setter ny plassering. `kompenser`: kameraet følger terrenget, så bygget
// ser ut til å flytte seg (brukes både av dra, knapper og angre).
function settPlass(ny, { kompenser = true, angre = false, fullt = true } = {}) {
  if (!terreng || !S.modelGroup) return;
  const fra = Object.assign({}, terreng.plass);
  const til = { pE: ny.pE, pN: ny.pN, rot: normVinkel(ny.rot) };
  if (fra.pE === til.pE && fra.pN === til.pN && fra.rot === til.rot) return;
  // Angre-posten lages FØR kameraet flyttes: angre.js tar vare på kameraet
  // i det posten legges inn og hopper tilbake dit ved Ctrl+Z. Ble den lagt
  // inn etterpå, sto kameraet igjen på den nye plasseringen mens terrenget
  // ble dreid tilbake (funnet i prøvekjøring).
  if (angre && S.pushAngre) {
    const gjeldende = terreng;
    S.pushAngre({
      tekst: "Bygget flyttet på terrenget",
      angre: () => { if (terreng === gjeldende) settPlass(fra); },
      gjenopprett: () => { if (terreng === gjeldende) settPlass(til); }
    });
  }
  const mr = modellRef();
  if (kompenser) {
    // Rotasjon først (rundt modellens senter), så forskyvning
    let d = (til.rot - fra.rot) * Math.PI / 180;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d) kameraRoter(d, mr.c.x, mr.c.z);
    // Terrengets forskyvning i verden = −(byggets flytt i terrenget), rotert
    const t0 = til.rot * Math.PI / 180, c = Math.cos(t0), s = Math.sin(t0);
    const dE = til.pE - fra.pE, dN = til.pN - fra.pN;
    const lx = -dE, lz = dN;   // terrenget flyttes motsatt av bygget, i terrengrammen
    const wx = lx * c + lz * s, wz = -lx * s + lz * c;
    if (wx || wz) kameraForskyv(new THREE.Vector3(wx / mr.skala, 0, wz / mr.skala));
  }
  terreng.plass = til;
  if (fullt) oppdaterAlt(); else { plasserGrupper(mr); visTall(); }
}

// ═══════════════════════ GULVKOTE (trinn 6) ═══════════════════════
//
// ALDRI DRA I Z (spesifikasjonen punkt 3). Høyden settes med et tall fra
// tegningen. Et øyemål bommer lett 30–50 cm, og på 400 m² er 30 cm 120 m³.

function settGulv(kote, grov, medAngre) {
  if (!terreng || kote == null || !Number.isFinite(kote)) return;
  const fra = terreng.gulv ? Object.assign({}, terreng.gulv) : null;
  const til = { kote: Math.round(kote * 1000) / 1000, grov: !!grov };
  if (fra && fra.kote === til.kote && fra.grov === til.grov) return;
  terreng.gulv = til;
  oppdaterAlt();
  if (erApen()) tegnPanel();
  if (medAngre && S.pushAngre) {
    const gjeldende = terreng;
    S.pushAngre({
      tekst: "Gulvkote",
      angre: () => { if (terreng === gjeldende) { terreng.gulv = fra; oppdaterAlt(); if (erApen()) tegnPanel(); } },
      gjenopprett: () => { if (terreng === gjeldende) { terreng.gulv = til; oppdaterAlt(); if (erApen()) tegnPanel(); } }
    });
  }
}

// «Legg oppå terrenget»: gulvet på laveste terrengpunkt under fotavtrykket.
// Tallet merkes GROVT — det er beregnet, ikke oppgitt.
function leggOppaa(medAngre) {
  if (!terreng || !S.modelGroup) return;
  const mr = modellRef();
  const k = lavesteUnder(terreng.grid, terreng.E0, terreng.N0, terreng.plass, mr.fp);
  settGulv(k != null ? k : terreng.h0, true, medAngre);
}

// ═══════════════════════ PLATA (utskjæring) ═══════════════════════
function settPad(ny, medAngre) {
  if (!terreng || likePad(ny, terreng.pad)) return;
  const fra = Object.assign({}, terreng.pad), til = Object.assign({}, ny), gjeldende = terreng;
  terreng.pad = til;
  oppdaterAlt();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: "Utskjæring",
    angre: () => { if (terreng === gjeldende) { terreng.pad = fra; oppdaterAlt(); if (erApen()) tegnPanel(); } },
    gjenopprett: () => { if (terreng === gjeldende) { terreng.pad = til; oppdaterAlt(); if (erApen()) tegnPanel(); } }
  });
}

// ═══════════════════════ PEKEREN ═══════════════════════
//
// Dra-mekanikken er kopiert fra materiell.js, ikke skrevet på nytt:
// lyttere på window i fangstfasen, stopPropagation så kameraet ikke roterer,
// og slippKamera() (et syntetisk pointercancel) når draget er ferdig.

// Nærmeste håndtak under pekeren, målt i SKJERMPIKSLER.
const _v = new THREE.Vector3();
function handtakVed(x, y) {
  if (!terreng || skjult || !erApen()) return null;
  const r = canvas.getBoundingClientRect();
  let best = null, bestD = TREFF_PX;
  for (const h of handtakene) {
    if (h.type === "rot" && !flyttModus) continue;
    h.mesh.getWorldPosition(_v).project(camera);
    if (_v.z > 1) continue;                              // bak kameraet
    const sx = r.left + (_v.x * 0.5 + 0.5) * r.width, sy = r.top + (-_v.y * 0.5 + 0.5) * r.height;
    const d = Math.hypot(sx - x, sy - y);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

// Pekeren → punkt i et vannrett plan i høyden planY (verden). Planet og ikke
// terrenget: i en bratt skråning ville et treff på terrenget latt kanten
// hoppe fram og tilbake mens du drar.
const _plan = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ndc = new THREE.Vector2();
function planPunkt(x, y, planY) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  _plan.constant = -planY;
  const hit = new THREE.Vector3();
  return _ray.ray.intersectPlane(_plan, hit) ? hit : null;
}

function slippKamera(e) {
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
}

let drar = null;        // { type, kant, fra, planY, ... }
let venter = 0;         // rAF-id: én ombygging per bilde, uansett hvor mange musetrekk
let satteMarkor = "";

function gulvPlanY() {
  const mr = modellRef();
  return { y: (mr.ref.mg - mr.a) / mr.skala, mr };
}

window.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target !== canvas || e.shiftKey || !terreng || !S.modelGroup) return;
  const h = handtakVed(e.clientX, e.clientY);
  if (h) {
    e.stopPropagation();   // kameraet skal ikke rotere mens håndtaket dras
    const planY = h.mesh.getWorldPosition(new THREE.Vector3()).y;
    if (h.type === "klipp") drar = { type: "klipp", kant: h.kant, fra: Object.assign({}, terreng.klipp), planY };
    else if (h.type === "pad") drar = { type: "pad", kant: h.kant, fra: Object.assign({}, terreng.pad), planY };
    else {
      const { mr } = gulvPlanY();
      const p = planPunkt(e.clientX, e.clientY, planY);
      if (!p) return;
      drar = { type: "rot", fra: Object.assign({}, terreng.plass), planY, cx: mr.c.x, cz: mr.c.z,
               a0: Math.atan2(-(p.z - mr.c.z), p.x - mr.c.x), dPaa: 0, kam: kameraNaa() };
    }
    return;
  }
  // ✥ Flyttemodus: trykk innenfor fotavtrykket drar bygget
  if (!flyttModus || !erApen() || skjult) return;
  const { y, mr } = gulvPlanY();
  const p = planPunkt(e.clientX, e.clientY, y);
  if (!p) return;
  const bx = (p.x - mr.c.x) * mr.skala, bz = (p.z - mr.c.z) * mr.skala;
  const f = mr.fp;
  if (bx < f.x0 || bx > f.x1 || bz < f.z0 || bz > f.z1) return;
  e.stopPropagation();
  drar = { type: "flytt", fra: Object.assign({}, terreng.plass), planY: y, start: p.clone(), paa: new THREE.Vector3(), kam: kameraNaa() };
}, true);

window.addEventListener("pointermove", (e) => {
  if (!drar) {
    // Pekeren viser hva som kan dras: hånd over et håndtak, flyttekors over
    // fotavtrykket i flyttemodus.
    let m = "";
    if (e.target === canvas && e.buttons === 0 && terreng) {
      if (handtakVed(e.clientX, e.clientY)) m = "grab";
      else if (flyttModus && erApen() && !skjult && S.modelGroup) {
        const { y, mr } = gulvPlanY();
        const p = planPunkt(e.clientX, e.clientY, y);
        if (p) {
          const bx = (p.x - mr.c.x) * mr.skala, bz = (p.z - mr.c.z) * mr.skala, f = mr.fp;
          if (bx >= f.x0 && bx <= f.x1 && bz >= f.z0 && bz <= f.z1) m = "move";
        }
      }
    }
    if (m !== satteMarkor) { canvas.style.cursor = m; satteMarkor = m; }
    return;
  }
  e.stopPropagation();
  if (!terreng) return;
  const p = planPunkt(e.clientX, e.clientY, drar.planY);
  if (!p) return;

  if (drar.type === "klipp") {
    const lok = innhold.worldToLocal(p.clone());
    const skala = S.enhetSkala || 1;
    const E = terreng.E0 + lok.x * skala, N = terreng.N0 - lok.z * skala;
    const ny = flyttKlippKant(terreng.grid, terreng.klipp, drar.kant, punktFraE(terreng.grid, E), punktFraN(terreng.grid, N));
    if (likeKlipp(ny, terreng.klipp)) return;
    terreng.klipp = ny;
    if (!venter) venter = requestAnimationFrame(() => { venter = 0; brukKlipp(); });
    return;
  }
  const mr = modellRef();
  if (drar.type === "pad") {
    const ny = flyttPadKant(terreng.pad, drar.kant, (p.x - mr.c.x) * mr.skala, (p.z - mr.c.z) * mr.skala);
    if (likePad(ny, terreng.pad)) return;
    terreng.pad = ny;
    // Under draget flyttes bare plata og håndtakene — terrenget skjæres ut
    // på nytt når du slipper.
    if (!venter) venter = requestAnimationFrame(() => { venter = 0; tegnHandtak(); visTall(); });
    return;
  }
  if (drar.type === "flytt") {
    // Kameraet er alt flyttet `paa`; punktet i den opprinnelige rammen er
    // p + paa. Bygget skal stå der pekeren er.
    const iRamme = p.clone().add(drar.paa);
    const mal = iRamme.sub(drar.start);                 // totalt flytt (scene)
    const steg = mal.clone().sub(drar.paa);
    if (Math.abs(steg.x) + Math.abs(steg.z) < 1e-9) return;
    const ny = flyttPlass(terreng.plass, steg.x * mr.skala, steg.z * mr.skala);
    drar.paa.copy(mal);
    settPlass(ny, { fullt: false });
    return;
  }
  if (drar.type === "rot") {
    const a = Math.atan2(-(p.z - drar.cz), p.x - drar.cx);
    // Se utledningen i kommentaren ved settPlass: håndtaket skal bli liggende
    // under pekeren mens kameraet dreies med terrenget.
    const dMaal = drar.dPaa + (drar.a0 - a);
    const rot = snapVinkel(drar.fra.rot + dMaal * 180 / Math.PI, 4);
    let dNy = (rot - drar.fra.rot) * Math.PI / 180;
    // Samme vinkel kan uttrykkes ±360°; velg den som ligger nærmest forrige
    while (dNy - drar.dPaa > Math.PI) dNy -= 2 * Math.PI;
    while (dNy - drar.dPaa < -Math.PI) dNy += 2 * Math.PI;
    drar.dPaa = dNy;
    settPlass({ pE: terreng.plass.pE, pN: terreng.plass.pN, rot }, { fullt: false });
  }
}, true);

window.addEventListener("pointerup", (e) => {
  if (!drar) return;
  // Les ut drag-tilstanden FØR slippKamera: det syntetiske pointercancel-et
  // treffer vår egen lytter synkront og nullstiller `drar` (samme felle som
  // materiell.js gikk i 21.08).
  const d = drar;
  drar = null;
  e.stopPropagation(); slippKamera(e);
  if (!terreng) return;
  if (d.type === "klipp") {
    const til = Object.assign({}, terreng.klipp);
    terreng.klipp = d.fra;              // settKlipp lager angre-posten fra→til
    if (likeKlipp(d.fra, til)) { brukKlipp(); return; }
    settKlipp(til, true);
  } else if (d.type === "pad") {
    const til = Object.assign({}, terreng.pad);
    terreng.pad = d.fra;
    if (likePad(d.fra, til)) { tegnHandtak(); return; }
    settPad(til, true);
  } else {
    // flytt / rot: plasseringen står alt der den skal; nå skjæres terrenget
    // ut på nytt, og angre-posten lages uten å flytte kameraet en gang til.
    const til = Object.assign({}, terreng.plass), fra = d.fra, gjeldende = terreng;
    oppdaterAlt();
    if (erApen()) tegnPanel();
    if ((fra.pE !== til.pE || fra.pN !== til.pN || fra.rot !== til.rot) && S.pushAngre) {
      // angre.js lagrer kameraet i det posten legges inn. Kameraet er alt
      // flyttet med terrenget — sett det tilbake til der draget startet et
      // øyeblikk, så Ctrl+Z hopper dit og ikke hit.
      const naa = kameraNaa();
      settKamera(d.kam);
      S.pushAngre({
        tekst: d.type === "rot" ? "Bygget rotert på terrenget" : "Bygget flyttet på terrenget",
        angre: () => { if (terreng === gjeldende) settPlass(fra); },
        gjenopprett: () => { if (terreng === gjeldende) settPlass(til); }
      });
      settKamera(naa);
    }
  }
}, true);

window.addEventListener("pointercancel", () => { drar = null; }, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && flyttModus && erApen()) { flyttModus = false; tegnPanel(); }
});

// ═══════════════════════ HENTING ═══════════════════════

// Nettkall med frist og ETT nytt forsøk. Første test hos Emil 25.09 ga
// «Fikk ikke kontakt med Kartverket» på et kall som virket fra samme side
// minuttet etter — et nettblaff, ikke en feil i koden. Én gang til koster
// ingenting; å be brukeren trykke på nytt koster tillit. Fristen hindrer at
// panelet henger på «Søker …» for alltid hvis tjenesten ikke svarer.
async function hentMedFrist(url, ms) {
  let sisteFeil = null;
  for (let forsok = 0; forsok < 2; forsok++) {
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    const tid = ac ? setTimeout(() => ac.abort(), ms) : 0;
    try {
      const r = await fetch(url, ac ? { signal: ac.signal } : undefined);
      clearTimeout(tid);
      if (r.ok) return r;
      sisteFeil = new Error("HTTP " + r.status);
      if (r.status < 500) break;          // 4xx blir ikke bedre av et nytt forsøk
    } catch (err) {
      clearTimeout(tid);
      sisteFeil = (err && err.name === "AbortError") ? new Error(t("svarte ikke innen {0} sekunder", Math.round(ms / 1000))) : err;
    }
    if (forsok === 0) await new Promise(r => setTimeout(r, 800));
  }
  throw sisteFeil || new Error("ukjent feil");
}

// Selve feilteksten vises i panelet (grått, under meldingen). Uten den er
// «fikk ikke kontakt» umulig å feilsøke over telefon.
let feilDetalj = "";
function detaljAv(err) {
  const m = String((err && err.message) || err || "");
  return m === "Failed to fetch" ? t("nettleseren fikk ikke svar (nett, brannmur eller tjenesten nede)") : m.slice(0, 200);
}

async function sokAdresse(tekst) {
  const hent = async (fuzzy) => {
    const r = await hentMedFrist(adresseUrl(tekst, fuzzy), 15000);
    return vaskAdresseSvar(await r.json());
  };
  let liste = await hent(false);
  if (!liste.length) liste = await hent(true);
  return liste;
}

async function hentGrid(E, N) {
  const bb = bboxFra(E, N, utsnitt);
  const r = await hentMedFrist(wcsUrl(bb), 30000);
  return { grid: lesTiff(await r.arrayBuffer()), bb };
}

function settMelding(tekst, feil, detalj) {
  melding = tekst || ""; meldingFeil = !!feil; feilDetalj = detalj || "";
  if (erApen()) tegnPanel();
}

// Knappen «Hent terreng». To tall → koordinat rett inn. Ellers adressesøk:
// ett treff hentes med en gang, flere vises som en liste å velge fra —
// adressesøk treffer sjelden blink første gang.
async function startHenting() {
  if (opptatt) return;
  const inp = $("trAdresse");
  const tekst = (inp && inp.value || "").trim();
  sisteSok = tekst;
  if (!tekst) { settMelding(t("Skriv en adresse eller en koordinat først."), true); return; }
  treff = [];
  const k = tolkKoordinat(tekst);
  if (k) { await hentTerreng({ tekst: Math.round(k.E) + " Ø, " + Math.round(k.N) + " N", E: k.E, N: k.N }); return; }
  opptatt = true; settMelding(t("Søker etter adressen …"));
  try {
    const liste = await sokAdresse(tekst);
    opptatt = false;
    if (!liste.length) { settMelding(t("Fant ingen adresse. Prøv med postnummer eller poststed, eller skriv en UTM33-koordinat."), true); return; }
    if (liste.length === 1) { await hentTerreng(liste[0]); return; }
    treff = liste.slice(0, 5);
    settMelding(t("Velg riktig adresse:"));
  } catch (err) {
    opptatt = false;
    console.warn("Adressesøk feilet:", err);
    settMelding(t("Fikk ikke kontakt med Kartverket. Sjekk nettet og prøv igjen."), true, detaljAv(err));
  }
}

async function hentTerreng(adr) {
  if (!S.modelGroup) { settMelding(t("Åpne en modell først."), true); return; }
  opptatt = true; treff = [];
  settMelding(t("Henter høydedata fra Kartverket …"));
  const forFil = S.fileName;
  try {
    const { grid: g, bb } = await hentGrid(adr.E, adr.N);
    if (S.fileName !== forFil) { opptatt = false; return; }   // modellen ble byttet underveis
    const spenn = hoydeSpenn(g);
    if (!spenn.gyldige) {
      opptatt = false;
      settMelding(t("Kartverket har ingen høydedata her (sjø, eller utenfor dekningen)."), true);
      return;
    }
    const E0 = Math.round(adr.E), N0 = Math.round(adr.N);
    // Høyden i adressepunktet. Står punktet i et hull (sjø, bro), brukes
    // laveste høyde i utsnittet.
    const hPunkt = hoydeVed(g, E0, N0);
    const h0 = hPunkt != null ? hPunkt : spenn.min;
    const forrige = terreng;
    const mr = modellRef();
    const plass = { pE: 0, pN: 0, rot: 0 };
    // Gulvet legges oppå terrenget (grovt) til brukeren skriver koten fra
    // tegningen. Plata står på: terrenget skal ikke gå gjennom bygget.
    const gk = lavesteUnder(g, E0, N0, plass, mr.fp);
    const nytt = {
      grid: g, bb, E0, N0, h0, hPunkt, spenn, adresse: adr, klipp: fulltKlipp(g), plass,
      gulv: { kote: Math.round((gk != null ? gk : h0) * 1000) / 1000, grov: true },
      pad: padStandard(mr.fp)
    };
    terreng = nytt;
    skjult = false;
    tegnTerreng();
    // Kameraet trekkes ut så hele terrenget — og alle håndtakene — synes.
    flyTilTerreng();
    opptatt = false;
    settMelding("");
    if (S.pushAngre) S.pushAngre({
      tekst: "Terreng hentet",
      angre: () => { terreng = forrige; skjult = false; tegnTerreng(); if (erApen()) tegnPanel(); },
      gjenopprett: () => { terreng = nytt; skjult = false; tegnTerreng(); if (erApen()) tegnPanel(); }
    });
  } catch (err) {
    opptatt = false;
    console.warn("Henting av terreng feilet:", err);
    settMelding(t("Klarte ikke å hente terrenget: ") + detaljAv(err), true);
  }
}

function fjernTerreng() {
  if (!terreng) return;
  const forrige = terreng;
  terreng = null; skjult = false; flyttModus = false;
  tegnTerreng();
  tegnPanel();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (S.pushAngre) S.pushAngre({
    tekst: "Terreng fjernet",
    angre: () => { terreng = forrige; tegnTerreng(); if (erApen()) tegnPanel(); },
    gjenopprett: () => { terreng = null; tegnTerreng(); if (erApen()) tegnPanel(); }
  });
}

// Modellbytte: terrenget var lagt under forrige modell, med dens senter og
// dens enheter. Det hører ikke til den neste. (Trinn 8: finnes en
// plasseringsfil for den nye modellen, hentes terrenget inn igjen av seg selv.)
S.ryddTerreng = () => {
  terreng = null; skjult = false; treff = []; flyttModus = false;
  ryddScene();
  oppdaterRutenett();
};

// ═══════════════════════ 🎨 UTSEENDE ═══════════════════════
function tegnUtseendeRad(body) {
  if (!body || !terreng) return;
  const el = document.createElement("div");
  el.innerHTML = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
    t("Terreng") + '</div><div class="c"><button data-terreng-skjul title="' + t("Skjul/vis") +
    '" style="padding:3px 8px">' + ikon(skjult ? "skjul" : "vis") + "</button></div></div>";
  body.appendChild(el);
  const b = el.querySelector("button[data-terreng-skjul]");
  b.onclick = () => { settSkjult(!skjult); b.innerHTML = ikon(skjult ? "skjul" : "vis"); };
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() {
  const p = $("terrengPanel");
  return !!(p && p.classList.contains("open"));
}

function fmtMoh(v, des) {
  const d = des == null ? 1 : des;
  return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString("no-NO", { minimumFractionDigits: d, maximumFractionDigits: d }) + " " + t("moh.");
}

const LITEN = 'style="color:var(--muted);font-size:11px;margin:4px 0 0"';

function tegnPanel() {
  const body = $("terrengBody");
  if (!body) return;
  const valg = UTSNITT.map(s => '<option value="' + s + '"' + (s === utsnitt ? " selected" : "") + ">" +
    s + " × " + s + " m</option>").join("");
  let html =
    '<label>' + t("Adresse eller koordinat") +
    '<input type="text" id="trAdresse" maxlength="120" value="' + esc(sisteSok) + '" placeholder="' +
    t("f.eks. Industriveien 20, Geithus") + '"' + (opptatt ? " disabled" : "") + "></label>" +
    '<label>' + t("Utsnitt") + '<select id="trUtsnitt"' + (opptatt ? " disabled" : "") + ">" + valg + "</select></label>" +
    '<div class="prop-actions"><button id="trHent" class="primary"' + (opptatt ? " disabled" : "") + ">" +
    ikon("kote") + " " + t("Hent terreng") + "</button></div>";

  if (melding) {
    html += '<p style="font-size:12px;margin:6px 0 0;color:' + (meldingFeil ? "var(--accent)" : "var(--muted)") + '">' +
      esc(melding) + "</p>";
    if (feilDetalj) html += '<p style="font-size:11px;margin:2px 0 0;color:var(--muted)">' + esc(feilDetalj) + "</p>";
  }
  if (treff.length) {
    html += treff.map((a, i) =>
      '<div class="qty-row"><div class="n" data-tr-treff="' + i + '" style="cursor:pointer">' +
      ikon("markering") + " " + esc(a.tekst) +
      ' <span style="color:var(--muted);font-size:11px">' + esc([a.postnummer, a.poststed].filter(Boolean).join(" ")) +
      (a.kommune ? " · " + esc(a.kommune) : "") + "</span></div></div>").join("");
  }

  html += '<p style="color:var(--muted);font-size:11px;margin:8px 0 0">' +
    t("Henter 1 m terrengmodell fra Kartverket. Terrenget viser bakken slik den var da den ble laserskannet — før graving.") + "</p>";

  if (terreng && S.modelGroup) {
    const g = terreng.grid;
    const mr = modellRef();
    const b = Math.round(g.w * g.dx), h = Math.round(g.h * g.dy);
    const gulv = terreng.gulv;
    const pad = terreng.pad;
    html += '<h4 style="margin:12px 0 4px">' + t("Lastet terreng") + "</h4>" +
      '<div class="qty-row"><div class="n">' + ikon("kote") + " " + esc(terreng.adresse.tekst) +
      ' <span style="color:var(--muted);font-size:11px">' +
      esc([terreng.adresse.postnummer, terreng.adresse.poststed].filter(Boolean).join(" ")) + "</span></div>" +
      '<div class="c"><button id="trSkjul" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(skjult ? "skjul" : "vis") + "</button>" +
      '<button id="trFjern" title="' + t("Fjern terrenget") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>" +
      '<p style="font-size:12px;margin:4px 0 0">' +
      t("Hentet") + " " + b + " × " + h + " m · " + fmtMoh(terreng.spenn.min) + " – " + fmtMoh(terreng.spenn.max) + "</p>" +

      // ✥ Trinn 5 — plasser og roter
      '<h4 style="margin:14px 0 4px">' + ikon("juster") + " " + t("Plasser bygget") + "</h4>" +
      '<div class="prop-actions"><button id="trFlytt"' + (flyttModus ? ' class="active"' : "") + ">" +
      ikon("juster") + " " + (flyttModus ? t("Ferdig med å flytte") : t("Flytt og roter bygget")) + "</button></div>" +
      (flyttModus ? "<p " + LITEN + ">" +
        t("Dra i det hvite fotavtrykket for å flytte bygget. Dra i det hvite håndtaket foran bygget for å rotere — det snapper til hver 90°. Esc avslutter.") + "</p>" : "") +
      '<label>' + t("Rotasjon (grader, med klokka)") +
      '<span style="display:flex;gap:6px;margin-top:3px">' +
      '<input type="text" id="trRot" inputmode="decimal" style="flex:1" value="' + esc(String(normVinkel(terreng.plass.rot)).replace(".", ",")) + '">' +
      '<button id="trRotV" title="' + t("Roter 90° mot klokka") + '">−90°</button>' +
      '<button id="trRotH" title="' + t("Roter 90° med klokka") + '">+90°</button></span></label>' +
      "<p " + LITEN + ">" + t("Byggets senter står") + ' <span id="trPlassTall">' + esc(plassTekst()) + "</span> " +
      t("fra adressepunktet.") + "</p>" +

      // ▲ Trinn 6 — gulvkote
      '<h4 style="margin:14px 0 4px">' + ikon("kote") + " " + t("Gulvkote") + "</h4>" +
      '<label>' + t("Gulvkote (moh.)") +
      '<input type="text" id="trGulv" inputmode="decimal" value="' +
      esc(gulv ? gulv.kote.toFixed(2).replace(".", ",") : "") + '" placeholder="' + t("f.eks. 75,30") + '"></label>' +
      '<p style="font-size:11px;margin:4px 0 0;color:' + (gulv && gulv.grov ? "var(--accent)" : "var(--muted)") + '">' +
      (gulv && gulv.grov
        ? t("Grovt: beregnet fra laveste terrengpunkt under bygget, ikke oppgitt. Skriv gulvkoten fra tegningen.")
        : t("Oppgitt fra tegningen.")) + "</p>" +
      "<p " + LITEN + ">" + (mr.ref.relativ
        ? t("Modellens ±0 regnes som gulv. ▲ Kote viser nå moh.")
        : t("Modellen har ikke ±0 innenfor seg — modellens laveste punkt regnes som gulv. ▲ Kote viser nå moh.")) + "</p>" +
      '<div class="prop-actions"><button id="trOppaa">' + ikon("kote") + " " + t("Legg oppå terrenget") + "</button></div>" +

      // Utskjæring
      '<h4 style="margin:14px 0 4px">' + ikon("boks") + " " + t("Utskjæring rundt bygget") +
      (pad && pad.paa ? ' <span id="trPadTall" style="font-weight:700;margin-left:6px">' + esc(padTekst()) + "</span>" : "") + "</h4>" +
      '<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="trPadPaa"' +
      (pad && pad.paa ? " checked" : "") + "> " + t("Skjær ut terrenget og legg en flat plate i gulvhøyde") + "</label>" +
      (pad && pad.paa ? "<p " + LITEN + ">" +
        t("Dra i de gule håndtakene for å endre størrelsen på plata.") + "</p>" +
        '<div class="prop-actions"><button id="trPadStd">' + ikon("nullstill") + " " +
        t("Tilbakestill (2 m rundt bygget)") + "</button></div>" : "") +

      // ✂ Trinn 4 — beskjæring
      '<h4 style="margin:14px 0 4px">' + ikon("snitt") + " " + t("Beskjær") +
      ' <span id="trKlippTall" style="font-weight:700;margin-left:6px">' + esc(klippTekst()) + "</span></h4>" +
      "<p " + LITEN + ">" +
      t("Dra i de røde håndtakene i 3D-vinduet for å beskjære terrenget. Hele utsnittet er tatt vare på — dra ut igjen, så kommer det tilbake uten å hente på nytt.") + "</p>" +
      '<div class="prop-actions"><button id="trKlippHele"' +
      (likeKlipp(terreng.klipp, fulltKlipp(terreng.grid)) ? " disabled" : "") + ">" +
      ikon("fullskjerm") + " " + t("Vis hele utsnittet") + "</button></div>";
  }

  // Advarselen står i PANELET, ikke bare i spesifikasjonen (byggeplanen,
  // advarsel 4). Den som skal grave, leser ikke spesifikasjoner.
  html += '<p style="font-size:11px;margin:10px 0 0;padding:6px 8px;border:1px solid var(--border);border-radius:6px">' +
    ikon("advarsel") + " " +
    t("Plasseringen er omtrentlig (±1–2 m) og skal aldri brukes til utstikking.") + "</p>";

  body.innerHTML = html;

  const inp = $("trAdresse");
  if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); startHenting(); } };
  const sel = $("trUtsnitt");
  if (sel) sel.onchange = () => { utsnitt = Number(sel.value) || STANDARD_UTSNITT; };
  const hent = $("trHent");
  if (hent) hent.onclick = () => startHenting();
  body.querySelectorAll("[data-tr-treff]").forEach(d =>
    d.onclick = () => { const a = treff[Number(d.dataset.trTreff)]; if (a) { sisteSok = a.tekst; hentTerreng(a); } });
  const kobl = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  kobl("trSkjul", () => settSkjult(!skjult));
  kobl("trFjern", () => fjernTerreng());
  kobl("trKlippHele", () => { if (terreng) settKlipp(fulltKlipp(terreng.grid), true); });
  kobl("trFlytt", () => { flyttModus = !flyttModus; tegnPanel(); });
  kobl("trRotV", () => { if (terreng) settPlass(Object.assign({}, terreng.plass, { rot: snapVinkel(terreng.plass.rot - 90, 0.05) }), { angre: true }); });
  kobl("trRotH", () => { if (terreng) settPlass(Object.assign({}, terreng.plass, { rot: snapVinkel(terreng.plass.rot + 90, 0.05) }), { angre: true }); });
  kobl("trOppaa", () => leggOppaa(true));
  kobl("trPadStd", () => { if (terreng && S.modelGroup) settPad(padStandard(modellRef().fp), true); });
  const rot = $("trRot");
  if (rot) {
    const bruk = () => {
      const v = Number(String(rot.value).replace(",", "."));
      if (!terreng || !Number.isFinite(v)) { visTall(); return; }
      settPlass(Object.assign({}, terreng.plass, { rot: v }), { angre: true });
    };
    rot.onchange = bruk;
    rot.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); rot.blur(); } };
  }
  const gulv = $("trGulv");
  if (gulv) {
    const bruk = () => {
      const v = tolkKote(gulv.value);
      if (v == null) { if (erApen()) tegnPanel(); return; }
      settGulv(v, false, true);
    };
    gulv.onchange = bruk;
    gulv.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); gulv.blur(); } };
  }
  const padPaa = $("trPadPaa");
  if (padPaa) padPaa.onchange = () => {
    if (!terreng) return;
    settPad(Object.assign({}, terreng.pad, { paa: padPaa.checked }), true);
    tegnPanel();
  };
}

på("btnTerreng", "click", () => {
  const panel = $("terrengPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("terrengPanel");
  const inp = $("trAdresse");
  if (inp && !terreng) setTimeout(() => inp.focus(), 50);
});
