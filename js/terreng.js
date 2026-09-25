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
import { $, S, apnePanel, esc, ikon, på, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { flettPaaId, spLes, spLesBin, spPaalogget, spSkriv, spSkrivBin } from "./sp-lager.js";
import { camera, canvas, controls, frameHooks, grid, makeLabel, renderer, scene, updateScreenScaled } from "./scene.js";
import {
  STANDARD_UTSNITT, UTSNITT, adresseUrl, bboxFra, byggTilTerreng, flyttKlippKant, flyttPadKant, flyttPlass,
  fulltKlipp, gridTilTrekanter, hoydeFarger, hoydeIPunkt, kartUv, nordRetning, topoUrl, hoydeSpenn, hoydeVed, klippHandtak,
  klippMeter, klippOmriss, lagIndeks, lavesteUnder, lesTiff, likeKlipp, likePad, mTilScene, normVinkel,
  padFlagg, padHandtak, padMeter, padStandard, pikselSenter, punktFraE, punktFraN, snapVinkel, tolkKoordinat,
  tolkKote, vaskAdresseSvar, wcsUrl,
  binTilGrid, gridTilBin, navneforslag, nyTerrengId, vaskPlassering, vaskTerrengListe,
  planumKote, vaskPlanum,
  KOORDSYS, dzFarger, ferdigGrid, festEttPunkt, festSjekk, festToPunkt, masseFelt, vaskFest, vaskSkraning
} from "./terreng-regn.js";
import { pick } from "./elements.js";
import { snapPoint } from "./measure.js";

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
// 🗺 Hva som ligger på terrenget: "topo" (Kartverkets kart) eller "hoyde"
// (høydefarger). Valget huskes mellom hentinger — det er brukerens, ikke tomtas.
let kartValg = "topo";
// ⛏ «Vis skjæring/fylling»: plata tas bort, terrenget under blir liggende og
// farges rødt (grave) og blått (fylle) mot planum.
let visMasser = false;
// ⛏ «Vis terrenget etter graving»: terrenget tegnes med skråningene og
// planum, slik tomta blir seende ut når gravemaskinen er ferdig.
let visFerdig = false;
// 📍 Fest hjørne: hvilket punkt (1 eller 2) neste trykk i modellen velger.
let festVelger = 0;
let festNed = null;
let festMelding = "", festFeil = false;
function erLaast() { return !!(terreng && terreng.fest && terreng.fest.laast); }

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
//   gulvY  — scenens y for GULVET: modellens laveste punkt
//
// GULVET ER MODELLENS LAVESTE PUNKT — bunnen av stålsøylene, som er toppen
// av betonggulvet (Emil 25.09). Første utgave regnet gulvet ut fra modellens
// egne koter (±0 via koteValue), og på Geithus havnet plata og terrenget i
// TAKHØYDE: modellens koter og scenens y hang ikke sammen slik regnestykket
// antok. Laveste punkt i scenen er det man ser, og det bommer ikke.
function modellRef() {
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  const skala = S.enhetSkala || 1;
  return {
    boks, c, skala, gulvY: boks.min.y,
    fp: { x0: (boks.min.x - c.x) * skala, x1: (boks.max.x - c.x) * skala,
          z0: (boks.min.z - c.z) * skala, z1: (boks.max.z - c.z) * skala }
  };
}

// moh. → scenens y: gulvkoten ligger i gulvY, og resten følger med meter
// for meter. Ingen omvei om modellens egne koter.
function yFraMoh(moh, mr) {
  const g = terreng && terreng.gulv ? terreng.gulv.kote : moh;
  return mr.gulvY + (moh - g) / mr.skala;
}

// ▲ Kote-verktøyet (main.js) spør her først: er terrenget lagt under
// modellen, er høyden på ethvert punkt gulvkoten pluss høyden over gulvet.
// Da viser Kote på gulvet nøyaktig gulvkoten, og på terrenget terrengets moh.
S.koteMoh = (punkt) => {
  if (!terreng || !terreng.gulv || !S.modelGroup || !punkt) return null;
  const mr = modellRef();
  return terreng.gulv.kote + (punkt.y - mr.gulvY) * mr.skala;
};

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
  rot: new THREE.MeshBasicMaterial({ color: FARGE_FOT, depthTest: false }),
  fest: new THREE.MeshBasicMaterial({ color: 0x00c853, depthTest: false })
};

const klippGroup = new THREE.Group();   // i innhold (følger terrenget)
const padGroup = new THREE.Group();     // i byggGroup (følger bygget)
const flyttGroup = new THREE.Group();   // i byggGroup: fotavtrykk + rotasjonshåndtak
klippGroup.name = "terreng-beskjaering";
padGroup.name = "terreng-plate";
flyttGroup.name = "terreng-flytt";
innhold.add(klippGroup);
// 📍 festGroup: de valgte hjørnene («1», «2») for Fest hjørne. Ikke håndtak —
// de dras ikke, de velges på nytt med «Velg i modellen».
const festGroup = new THREE.Group();
festGroup.name = "terreng-fest";
byggGroup.add(padGroup, flyttGroup, festGroup);

let handtakene = [];    // [{ type: "klipp"|"pad"|"rot", kant, mesh }]

function tomGruppe(g) {
  for (const o of g.children.slice()) {
    g.remove(o);
    if (o.geometry && o.geometry !== handtakGeo) o.geometry.dispose();
    if (o.userData.egetMat && o.material) o.material.dispose();   // plata har sitt eget
    if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
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
  tomGruppe(klippGroup); tomGruppe(padGroup); tomGruppe(flyttGroup); tomGruppe(festGroup);
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
  tegnNord();

  // Plata og fotavtrykket står i gulvhøyde, i modellens koordinater
  const gulvY = mr.gulvY;
  byggGroup.position.set(mr.c.x, 0, mr.c.z);
  const p = terreng.pad;
  if (p && p.paa && !visMasser) {
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

  // 📍 valgte hjørner — grønne, med nummer
  const fp = terreng.fest ? terreng.fest.punkter : [];
  fp.forEach((q, i) => {
    if (!q || q.bx == null) return;
    const pos = byggPunkt(q.bx, q.bz, gulvY + q.hy / s);
    const m = new THREE.Mesh(handtakGeo, handtakMat.fest);
    m.position.copy(pos); m.userData.px = 10; m.renderOrder = 998;
    festGroup.add(m);
    const lapp = makeLabel(String(i + 1), "#00a844");
    lapp.userData.px = 20;
    lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
    lapp.position.copy(pos).add(new THREE.Vector3(0, 1.2 / s, 0));
    festGroup.add(lapp);
  });
}

// Håndtakene synes bare med panelet åpent, og har konstant skjermstørrelse.
// Rotasjonshåndtaket og fotavtrykket bare i flyttemodus.
frameHooks.push(() => {
  const vis = !!terreng && !skjult && erApen();
  klippGroup.visible = vis;
  for (const o of padGroup.children) if (o !== plateMesh) o.visible = vis;
  flyttGroup.visible = vis && flyttModus;
  festGroup.visible = vis;
  if (vis) { updateScreenScaled(klippGroup); updateScreenScaled(padGroup); updateScreenScaled(festGroup); if (flyttModus) updateScreenScaled(flyttGroup); }
});

// ═══════════════════════ TEGNING ═══════════════════════

function ryddScene() {
  if (flateMesh) {
    innhold.remove(flateMesh);
    flateMesh.geometry.dispose(); flateMesh.material.dispose();
    flateMesh = null;
  }
  handtakene = [];
  tomGruppe(klippGroup); tomGruppe(padGroup); tomGruppe(flyttGroup); tomGruppe(festGroup); tomGruppe(nordGroup);
  plateMesh = null;
  trengerFar = 0;
}

// ═══════════════════════ 🗺 KART PÅ TERRENGET ═══════════════════════
//
// Kartverkets topografiske kart legges som tekstur på terrenget: elver, vann,
// veier og bygninger synes, og man kjenner igjen tomta fra et vanlig kart.
// Flyfoto (Norge i bilder) krever avtale — se terreng-regn.js.
//
// Bildet hentes én gang per terreng og ligger på terreng-objektet, så angre
// ikke henter det på nytt.
async function hentKart(t0) {
  if (!t0 || t0.kart) return;
  t0.kart = { status: "laster", tex: null };
  if (erApen()) tegnPanel();
  try {
    const r = await hentMedFrist(topoUrl(t0.bb), 30000);
    const blob = await r.blob();
    if (!/^image\//.test(blob.type)) throw new Error(t("tjenesten svarte ikke med et bilde"));
    const url = URL.createObjectURL(blob);
    const img = await new Promise((ok, feil) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => feil(new Error(t("bildet kunne ikke leses")));
      i.src = url;
    });
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Skrått innsyn på en 2 km tomt blir grøt uten anisotropi
    const maks = renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    tex.anisotropy = Math.min(8, maks || 1);
    tex.needsUpdate = true;
    t0.kart = { status: "ok", tex, url };
  } catch (err) {
    console.warn("Kartet kunne ikke hentes:", err);
    t0.kart = { status: "feil", tex: null, detalj: detaljAv(err) };
  }
  if (terreng === t0) brukKart();
  if (erApen()) tegnPanel();
}

function brukKart() {
  if (!flateMesh || !terreng) return;
  const mat = flateMesh.material;
  const tex = kartValg === "topo" && terreng.kart && terreng.kart.tex;
  mat.map = tex || null;
  mat.vertexColors = true;   // hvitt under kartet, se oppdaterFarger
  mat.color.set(0xffffff);
  mat.needsUpdate = true;
  oppdaterFarger();
}

function ryddKart(t0) {
  if (t0 && t0.kart) {
    if (t0.kart.tex) t0.kart.tex.dispose();
    if (t0.kart.url) URL.revokeObjectURL(t0.kart.url);
    t0.kart = null;
  }
}

// ═══════════════════════ 🧭 NORDPIL ═══════════════════════
//
// To ting: en kompassrose i hjørnet av 3D-vinduet som dreier med kameraet,
// og en «N» på terrengets nordkant. Kompasset er det man ser på; «N»-en er
// det man kjenner igjen når man sammenligner med kartet.
const nordGroup = new THREE.Group();
nordGroup.name = "terreng-nord";
innhold.add(nordGroup);

const kompass = document.createElement("div");
kompass.id = "terrengKompass";
kompass.setAttribute("aria-hidden", "true");
kompass.style.cssText = "position:fixed;right:22px;top:212px;width:54px;height:54px;border-radius:50%;" +
  "background:var(--flate-82);border:1px solid var(--border);box-shadow:var(--skygge);display:none;" +
  "pointer-events:none;z-index:5";
kompass.innerHTML = '<svg viewBox="0 0 54 54" width="54" height="54"><g id="terrengKompassPil">' +
  '<path d="M27 6 L34 28 L27 24 L20 28 Z" fill="var(--accent)"/>' +
  '<path d="M27 48 L34 26 L27 30 L20 26 Z" fill="var(--muted)"/>' +
  '<text x="27" y="17" text-anchor="middle" font-size="9" font-weight="700" fill="var(--paa-accent)" font-family="sans-serif">N</text>' +
  "</g></svg>";
if (document.body) document.body.appendChild(kompass);
const kompassPil = kompass.querySelector("#terrengKompassPil");

const _kA = new THREE.Vector3(), _kB = new THREE.Vector3();
frameHooks.push(() => {
  const vis = !!terreng && !skjult && terrengGroup.visible;
  kompass.style.display = vis ? "block" : "none";
  if (!vis || !kompassPil) return;
  updateScreenScaled(nordGroup);
  // Nord i verden → to punkt på skjermen → vinkelen pilen skal peke.
  // Skjermkoordinatene (NDC) strekkes med bildeforholdet, ellers blir
  // vinkelen feil på en bred skjerm.
  const n = nordRetning(terreng.plass.rot);
  const len = (S.modelSize || 20) * 0.5;
  _kA.copy(controls.target).project(camera);
  _kB.set(controls.target.x + n.x * len, controls.target.y, controls.target.z + n.z * len).project(camera);
  const dx = (_kB.x - _kA.x) * (camera.aspect || 1), dy = _kB.y - _kA.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return;
  const grader = Math.atan2(dx, dy) * 180 / Math.PI;
  kompassPil.setAttribute("transform", "rotate(" + grader.toFixed(1) + " 27 27)");
});

function tegnNord() {
  tomGruppe(nordGroup);
  if (!terreng) return;
  const k = terreng.klipp;
  const lapp = makeLabel("N", "#e53935");
  lapp.userData.px = 26;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  lapp.position.copy(lokaltPunkt((k.i0 + k.i1) / 2, k.j0, 6));
  nordGroup.add(lapp);
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
  const { E0, N0, h0 } = terreng;
  beregnMasser();
  const felt = terreng.masser;
  const g = visFerdig && felt ? ferdigGrid(terreng.grid, felt.dz) : terreng.grid;
  const p = terreng.pad;
  const flat = (p && p.paa && terreng.gulv && !visMasser)
    // Litt under plata: terrenget skal ikke stikke opp gjennom den i skrå
    // ruter langs kanten.
    ? { flagg: felt ? felt.flagg : padFlagg(g, E0, N0, terreng.plass, p), hoyde: terreng.gulv.kote - 0.05 }
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
  oppdaterFarger();
}

// ⛏ Massene regnes på nytt hver gang plass, plate, gulv eller planum er
// ferdig endret. Et gjennomløp av gridet: ~10 ms på 1000 × 1000.
// Skråningene utenfor plata er med (masseFelt i terreng-regn.js).
function beregnMasser() {
  terreng.masser = null;
  const p = terreng.pad;
  if (!p || !p.paa) return;
  const pk = planumKote(terreng.gulv, terreng.planum);
  if (pk == null) return;
  const f = masseFelt(terreng.grid, terreng.E0, terreng.N0, terreng.plass, p, pk, terreng.skraning);
  if (f) terreng.masser = Object.assign({ planum: pk }, f);
}

// Fargene på punktene: hvite under kartet (kartet gir fargen), høydefarger
// uten kart — og rødt/blått under plata når skjæring/fylling vises.
function oppdaterFarger() {
  if (!flateMesh || !terreng) return;
  const g = terreng.grid;
  const tex = kartValg === "topo" && terreng.kart && terreng.kart.tex;
  let farger = tex ? new Float32Array(g.w * g.h * 3).fill(1) : (terreng.hf || (terreng.hf = hoydeFarger(g, terreng.spenn)));
  if (visMasser && terreng.masser) farger = dzFarger(terreng.masser.dz, farger);
  flateMesh.geometry.setAttribute("color", new THREE.BufferAttribute(farger, 3));
}

function tegnTerreng() {
  ryddScene();
  if (!terreng || !S.modelGroup) { oppdaterRutenett(); return; }
  const mr = modellRef();
  const g = terreng.grid;
  if (!terreng.klipp) terreng.klipp = fulltKlipp(g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("color", new THREE.BufferAttribute(hoydeFarger(g, terreng.spenn), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(kartUv(g), 2));
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
  brukKart();
  if (kartValg === "topo" && !terreng.kart) hentKart(terreng);
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
  visMasseTall();
  planLagring();
}

// Masse-delen av panelet tegnes på nytt når plass/plate/gulv endres — men
// ikke mens brukeren skriver i et av feltene der (da mister hun markøren).
function visMasseTall() {
  const el = $("trMasser");
  if (!el || !terreng || (document.activeElement && el.contains(document.activeElement))) return;
  el.innerHTML = tegnMasser();
  koblMasser();
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
  planLagring();
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

// Rotasjon fra panelet. Er bygget festet i ETT hjørne, dreies det rundt det
// hjørnet — så hjørnet blir stående på landmålerens koordinat.
function settRotasjon(rot) {
  if (!terreng) return;
  const f = terreng.fest;
  if (f && f.laast && f.antall === 2) return;
  if (f && f.laast) {
    const q = f.punkter.find(p => p && p.bx != null && p.E != null);
    if (q) {
      const naa = byggTilTerreng(q.bx, q.bz, terreng.E0, terreng.N0, terreng.plass);
      settPlass(festEttPunkt(q, terreng.E0, terreng.N0, rot, naa.E, naa.N), { angre: true });
      return;
    }
  }
  settPlass(Object.assign({}, terreng.plass, { rot }), { angre: true });
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
    if (h.type === "rot" && (!flyttModus || erLaast())) continue;
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
  return { y: mr.gulvY, mr };
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
    if (festVelger && e.target === canvas && e.buttons === 0 && !m) m = "crosshair";
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
  if (e.key === "Escape" && festVelger && erApen()) { festVelger = 0; tegnPanel(); return; }
  if (e.key === "Escape" && flyttModus && erApen()) { flyttModus = false; tegnPanel(); }
});

// 📍 Fest hjørne: et vanlig trykk (under 8 px bevegelse, som i main.js) i
// modellen velger punktet — draging roterer kameraet som før. Trykket stoppes
// her i fangstfasen, så main.js ikke også velger elementet.
window.addEventListener("pointerdown", (e) => {
  festNed = festVelger && e.target === canvas && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
}, true);
window.addEventListener("pointerup", (e) => {
  if (!festVelger || !festNed || e.target !== canvas || !terreng || !S.modelGroup) return;
  const flyttet = Math.hypot(e.clientX - festNed.x, e.clientY - festNed.y);
  festNed = null;
  if (flyttet > 8 || e.button > 0) return;
  e.stopPropagation();
  const hit = pick(e.clientX, e.clientY);
  if (!hit) return;
  // Snappen fester punktet til nærmeste hjørne eller kant i modellen, som i
  // 📏 Mål — et trykk «omtrent på hjørnet» blir hjørnet.
  const sp = snapPoint(hit);
  const pt = sp && sp.point ? sp.point : hit.point;
  const mr = modellRef();
  const i = festVelger - 1;
  const f = terreng.fest || vaskFest({});
  const punkter = f.punkter.slice();
  punkter[i] = Object.assign({ E: null, N: null, Z: null }, punkter[i] || {}, {
    bx: (pt.x - mr.c.x) * mr.skala, bz: (pt.z - mr.c.z) * mr.skala,
    hy: Math.max(0, (pt.y - mr.gulvY) * mr.skala), snap: sp && sp.type ? sp.type : null
  });
  terreng.fest = Object.assign({}, f, { punkter });
  festVelger = 0;
  festMelding = ""; festFeil = false;
  canvas.style.cursor = ""; satteMarkor = "";
  tegnHandtak();
  planLagring();
  if (erApen()) tegnPanel();
}, true);

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
      pad: padStandard(mr.fp), planum: vaskPlanum(null), skraning: vaskSkraning(null), fest: vaskFest({})
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
  clearTimeout(lagreTid);
  ryddKart(terreng);
  terreng = null; skjult = false; treff = []; flyttModus = false;
  ryddScene();
  oppdaterRutenett();
};

// ═══════════════════════ 💾 LAGRING (trinn 7) ═══════════════════════
//
// Katalogen (terreng.json) og plasseringen (<modell>.plassering.json) går
// gjennom sp-lager.js — fletting, eTag, 412 og gravsteiner ligger der ferdig
// prøvd. Høydegridet er en rå Float32-fil som skrives én gang (spSkrivBin).
//
// LOKALT FØRST, SÅ SHAREPOINT (samme mønster som grupper.js): plasseringen og
// katalogposten ligger også i localStorage, så terrenget kommer tilbake på
// denne maskinen selv uten innlogging. Gridet får ikke plass i localStorage
// (4 MB) — men det er åpne data, så uten SharePoint hentes det bare på nytt
// fra Kartverket med samme firkant. Det gir nøyaktig de samme høydene.
const SP_MAPPE = "Terreng";
const KATALOG_FIL = "terreng.json";
const LS_KATALOG = "storm-ifc-terreng-katalog";
function plassFil() { return S.fileName + ".plassering.json"; }
function lsPlassNokkel() { return "storm-ifc-terreng-plassering::" + S.fileName; }

let katalog = [];          // vasket, med gravsteiner
let spStatus = "av";       // "av" | "ok" | "feil" — vises i panelet
let lagrer = false;
let lagreTid = 0;

function lsLes(k, fb) { try { return JSON.parse(localStorage.getItem(k) || "null") || fb; } catch (_) { return fb; } }
function lsSkriv(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

function lagringsTekst() {
  if (spStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (spStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Logg inn i Biblioteket for å dele med de andre.");
}

function synligKatalog() { return katalog.filter(p => !p.slettet); }

function katalogPost(t0, navn) {
  const g = t0.grid, naa = new Date().toISOString();
  return {
    id: t0.id, navn, bbox: t0.bb, w: g.w, h: g.h, dx: g.dx, dy: g.dy, x0: g.x0, y0: g.y0, nodata: g.nodata,
    E0: t0.E0, N0: t0.N0, adresse: t0.adresse,
    kilde: "Kartverket Høyde DTM (NHM_DTM_25833)", laserdato: null,
    av: mittNavn(), opprettet: naa, endret: naa
  };
}

function plassPost() {
  return {
    id: "plassering", terreng: terreng.id, plass: terreng.plass, gulv: terreng.gulv, pad: terreng.pad,
    klipp: terreng.klipp, planum: terreng.planum,
    skraning: terreng.skraning, fest: terreng.fest, kart: kartValg, av: mittNavn(), endret: new Date().toISOString()
  };
}

async function skrivKatalog(poster) {
  katalog = vaskTerrengListe(flettPaaId(poster, katalog));
  lsSkriv(LS_KATALOG, katalog);
  if (!spPaalogget()) { spStatus = "av"; return; }
  const res = await spSkriv(SP_MAPPE, KATALOG_FIL, poster, (p) => String(p && p.id || ""));
  spStatus = res.ok ? "ok" : "feil";
  if (res.ok && res.liste) { katalog = vaskTerrengListe(res.liste); lsSkriv(LS_KATALOG, katalog); }
}

// Plasseringen skrives ETTER at brukeren har sluppet musa, og samlet: et drag
// med rotasjon og tre justeringer av plata blir ÉN skriving, ikke fire.
function planLagring() {
  if (!terreng || !terreng.id || !S.fileName) return;
  const fil = S.fileName;
  lsSkriv(lsPlassNokkel(), plassPost());
  clearTimeout(lagreTid);
  lagreTid = setTimeout(async () => {
    if (!terreng || !terreng.id || S.fileName !== fil) return;
    if (!spPaalogget()) { spStatus = "av"; if (erApen()) visLagring(); return; }
    const res = await spSkriv(SP_MAPPE, plassFil(), [plassPost()], (p) => String(p && p.id || ""));
    spStatus = res.ok ? "ok" : "feil";
    if (erApen()) visLagring();
  }, 1200);
}

function visLagring() {
  const el = $("trLagringTekst");
  if (el) el.textContent = lagringsTekst();
}

// «Lagre terreng»: gridet først (tregest, og uten det er katalogposten
// verdiløs), så katalogen, så plasseringen for denne modellen.
async function lagreTerreng(navn) {
  if (!terreng || lagrer) return;
  const n = String(navn || "").trim().slice(0, 80);
  if (!n) { alert(t("Gi terrenget et navn først.")); return; }
  lagrer = true; tegnPanel();
  const t0 = terreng;
  t0.id = nyTerrengId();
  try {
    if (spPaalogget()) {
      const bin = await spSkrivBin(SP_MAPPE, t0.id + ".bin", gridTilBin(t0.grid));
      if (!bin.ok) spStatus = bin.grunn === "av" ? "av" : "feil";
    }
    await skrivKatalog([katalogPost(t0, n)]);
    t0.navn = n;
    if (terreng === t0) planLagring();
  } finally {
    lagrer = false;
    if (erApen()) tegnPanel();
  }
}

// Gridet til en katalogpost: SharePoint først, ellers Kartverket med samme
// firkant og samme oppløsning.
async function gridFor(post) {
  // Ikke innlogget → rett til Kartverket. (Uten MSAL-biblioteket kaster
  // selve token-kallet, og det skal ikke stoppe gjenopprettingen.)
  if (spPaalogget()) {
    try {
      const sp = await spLesBin(SP_MAPPE, post.id + ".bin");
      if (sp.status === "ok") return binTilGrid(sp.data, post);
    } catch (err) { console.warn("Gridfila i SharePoint kunne ikke brukes:", err.message); }
  }
  const r = await hentMedFrist(wcsUrl(post.bbox), 30000);
  const g = lesTiff(await r.arrayBuffer());
  if (g.w !== post.w || g.h !== post.h) throw new Error(t("Kartverket svarte med et annet rutenett enn det som ble lagret"));
  return g;
}

// Bygger terreng-objektet fra en katalogpost (+ plassering hvis den finnes).
async function lastTerrengPost(post, pl, medKamera) {
  if (!S.modelGroup) return;
  const forFil = S.fileName;
  opptatt = true; settMelding(t("Henter lagret terreng …"));
  try {
    const g = await gridFor(post);
    if (S.fileName !== forFil) { opptatt = false; return; }
    const spenn = hoydeSpenn(g);
    const E0 = post.E0, N0 = post.N0;
    const hPunkt = hoydeVed(g, E0, N0);
    const h0 = hPunkt != null ? hPunkt : spenn.min;
    const mr = modellRef();
    const plass = pl ? pl.plass : { pE: 0, pN: 0, rot: 0 };
    let gulv = pl && pl.gulv;
    if (!gulv) {
      const gk = lavesteUnder(g, E0, N0, plass, mr.fp);
      gulv = { kote: Math.round((gk != null ? gk : h0) * 1000) / 1000, grov: true };
    }
    const fullt = fulltKlipp(g);
    const klipp = pl && pl.klipp && pl.klipp.i1 <= fullt.i1 && pl.klipp.j1 <= fullt.j1 ? pl.klipp : fullt;
    if (pl && pl.kart) kartValg = pl.kart;
    ryddKart(terreng);
    terreng = {
      grid: g, bb: post.bbox, E0, N0, h0, hPunkt, spenn, adresse: post.adresse, klipp, plass, gulv,
      pad: (pl && pl.pad) || padStandard(mr.fp), id: post.id, navn: post.navn,
      planum: vaskPlanum(pl && pl.planum),
      skraning: vaskSkraning(pl && pl.skraning),
      fest: (pl && pl.fest) || vaskFest({})
    };
    sisteSok = post.adresse.tekst || sisteSok;
    skjult = false;
    tegnTerreng();
    if (medKamera) flyTilTerreng();
    opptatt = false;
    settMelding("");
    if (!pl) planLagring();       // ny kobling modell ↔ terreng
  } catch (err) {
    opptatt = false;
    console.warn("Kunne ikke laste lagret terreng:", err);
    settMelding(t("Klarte ikke å hente det lagrede terrenget: ") + detaljAv(err), true);
  }
}

// Trykk på et terreng i lista: legg det under DENNE modellen. Har modellen
// alt en plassering på akkurat det terrenget, brukes den.
async function velgLagret(id) {
  const post = synligKatalog().find(p => p.id === id);
  if (!post) return;
  const lok = vaskPlassering(lsLes(lsPlassNokkel(), null));
  await lastTerrengPost(post, lok && lok.terreng === id ? lok : null, true);
}

async function slettLagret(id) {
  const post = synligKatalog().find(p => p.id === id);
  if (!post) return;
  if (!confirm(t("Slette «{0}» fra lista over lagrede terreng?", post.navn))) return;
  // Gravstein (se sp-lager.js): uten den kommer terrenget tilbake ved neste
  // fletting fra SharePoint.
  await skrivKatalog([{ id, navn: post.navn, slettet: true, endret: new Date().toISOString() }]);
  if (terreng && terreng.id === id) terreng.id = null;
  if (erApen()) tegnPanel();
}

// Når en modell åpnes (afterLoad i ifc.js): les katalogen, og finnes det en
// plassering for modellen, hent terrenget i bakgrunnen — modellen står alt på
// skjermen. Nyeste `endret` vinner mellom denne maskinen og SharePoint.
S.lastTerreng = async () => {
  const forFil = S.fileName;
  katalog = vaskTerrengListe(lsLes(LS_KATALOG, []));
  let pl = vaskPlassering(lsLes(lsPlassNokkel(), null));
  if (spPaalogget()) {
    const [kat, plSp] = await Promise.all([spLes(SP_MAPPE, KATALOG_FIL), spLes(SP_MAPPE, plassFil())]);
    if (S.fileName !== forFil) return;
    spStatus = (kat.status === "ok" || kat.status === "tom") ? "ok" : "feil";
    if (kat.status === "ok") { katalog = vaskTerrengListe(flettPaaId(katalog, vaskTerrengListe(kat.liste))); lsSkriv(LS_KATALOG, katalog); }
    const fraSp = plSp.status === "ok" ? vaskPlassering(plSp.liste[0]) : null;
    if (fraSp && (!pl || String(fraSp.endret) > String(pl.endret))) { pl = fraSp; lsSkriv(lsPlassNokkel(), pl); }
  } else spStatus = "av";
  if (erApen()) tegnPanel();
  if (!pl || S.fileName !== forFil || terreng) return;
  const post = synligKatalog().find(p => p.id === pl.terreng);
  if (!post) return;                          // terrenget er slettet fra katalogen
  await lastTerrengPost(post, pl, false);
};

function tegnLagring() {
  let html = '<h4 style="margin:14px 0 4px">' + ikon("lagre") + " " + t("Lagring") + "</h4>";
  if (terreng && !terreng.id) {
    html += '<label>' + t("Navn på terrenget") +
      '<input type="text" id="trNavn" maxlength="80" value="' + esc(navneforslag(terreng.adresse)) + '"></label>' +
      '<div class="prop-actions"><button id="trLagre" class="primary"' + (lagrer ? " disabled" : "") + ">" +
      ikon("lagre") + " " + (lagrer ? t("Lagrer …") : t("Lagre terreng")) + "</button></div>" +
      "<p " + LITEN + ">" + t("Lagrer terrenget og plasseringen av denne modellen. Etterpå lagres endringer i plasseringen av seg selv.") + "</p>";
  } else if (terreng && terreng.id) {
    html += '<p style="font-size:12px;margin:4px 0 0">' + ikon("hake") + " " + t("Lagret som") + " «" + esc(terreng.navn || "") + "». " +
      t("Plassering, gulvkote og plate lagres av seg selv for denne modellen.") + "</p>";
  }
  html += '<p id="trLagringTekst" style="color:var(--muted);font-size:11px;margin:4px 0 0">' + esc(lagringsTekst()) + "</p>";
  const liste = synligKatalog();
  html += '<h4 style="margin:12px 0 4px">' + t("Lagrede terreng") +
    ' <span style="color:var(--muted);font-size:11px">(' + liste.length + ")</span></h4>";
  if (!liste.length) html += "<p " + LITEN + ">" + t("Ingen terreng lagret ennå.") + "</p>";
  else {
    html += liste.map(p => {
      const dato = p.opprettet ? new Date(p.opprettet).toLocaleDateString("no-NO") : "";
      const aktiv = terreng && terreng.id === p.id;
      return '<div class="qty-row"><div class="n" data-tr-lagret="' + esc(p.id) + '" style="cursor:pointer' + (aktiv ? ";font-weight:700" : "") + '">' +
        ikon("kote") + " " + esc(p.navn) +
        ' <span style="color:var(--muted);font-size:11px;font-weight:400">' + Math.round(p.bbox.side) + " × " + Math.round(p.bbox.side) + " m" +
        (dato ? " · " + esc(dato) : "") + (p.av ? " · " + esc(p.av) : "") + "</span></div>" +
        '<div class="c"><button data-tr-slett="' + esc(p.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>";
    }).join("") + "<p " + LITEN + ">" + t("Trykk på et terreng for å legge det under modellen.") + "</p>";
  }
  return html;
}

function koblLagring(body) {
  const lagre = $("trLagre");
  if (lagre) lagre.onclick = () => lagreTerreng(($("trNavn") || {}).value);
  body.querySelectorAll("[data-tr-lagret]").forEach(d => d.onclick = () => velgLagret(d.dataset.trLagret));
  body.querySelectorAll("button[data-tr-slett]").forEach(b => b.onclick = (e) => { e.stopPropagation(); slettLagret(b.dataset.trSlett); });
}

// ═══════════════════════ ⛏ MASSER I PANELET ═══════════════════════
function m3(v) { return Math.round(v).toLocaleString("no-NO") + " m³"; }

function tegnMasser() {
  const pad = terreng.pad, pl = terreng.planum || vaskPlanum(null), m = terreng.masser;
  let html = '<h4 style="margin:14px 0 4px">' + ikon("mengder") + " " + t("Masser under plata") + "</h4>";
  if (!pad || !pad.paa) return html + "<p " + LITEN + ">" + t("Slå på utskjæringen for å regne skjæring og fylling.") + "</p>";
  html += '<label>' + t("Planum") + '<select id="trPlanumModus">' +
    '<option value="oppbygging"' + (pl.modus !== "kote" ? " selected" : "") + ">" + t("Gulvkote minus oppbygging") + "</option>" +
    '<option value="kote"' + (pl.modus === "kote" ? " selected" : "") + ">" + t("Egen planumkote") + "</option></select></label>" +
    (pl.modus === "kote"
      ? '<label>' + t("Planumkote (moh.)") + '<input type="text" id="trPlanumKote" inputmode="decimal" value="' +
        esc(pl.kote != null ? pl.kote.toFixed(2).replace(".", ",") : (m ? m.planum.toFixed(2).replace(".", ",") : "")) + '"></label>'
      : '<label>' + t("Oppbygging under gulv (m) — betong, isolasjon og pukk") + '<input type="text" id="trOppbygging" inputmode="decimal" value="' +
        esc(pl.oppbygging.toFixed(2).replace(".", ",")) + '"></label>');
  if (!m) return html + "<p " + LITEN + ">" + t("Skriv gulvkoten først.") + "</p>";
  // Bare skjæring og fylling får farge (samme rødt/blått som i terrenget);
  // resten står i vanlig tekstfarge, så ikke alt ser ut som en advarsel.
  const rad = (navn, verdi, farge) => '<div class="qty-row"><div class="n">' + navn + '</div><div class="c" style="font-weight:700;color:' +
    (farge || "var(--text)") + '">' + verdi + "</div></div>";
  const sk = terreng.skraning || vaskSkraning(null);
  const n1 = (v) => String(v).replace(".", ",");
  const del = (plate, skr) => sk.paa
    ? '<div style="font-size:11px;color:var(--muted);margin:-2px 0 4px;text-align:right">' +
      t("plate {0} · skråning {1}", m3(plate), m3(skr)) + "</div>" : "";
  html += '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:6px"><input type="checkbox" id="trSkrPaa"' +
    (sk.paa ? " checked" : "") + "> " + t("Ta med skråninger rundt plata") + "</label>" +
    (sk.paa
      ? '<div style="display:flex;gap:8px">' +
        '<label style="flex:1">' + t("Skjæring 1:") + '<input type="text" id="trSkrSkj" inputmode="decimal" value="' + esc(n1(sk.skjaering)) + '"></label>' +
        '<label style="flex:1">' + t("Fylling 1:") + '<input type="text" id="trSkrFyl" inputmode="decimal" value="' + esc(n1(sk.fylling)) + '"></label></div>' +
        "<p " + LITEN + ">" + t("1:1,5 betyr 1 m opp for hver 1,5 m ut. Typisk 1:1,5 i skjæring og 1:2 i fylling, men det avhenger av massene — geoteknikeren bestemmer.") + "</p>"
      : "");
  html += rad(t("Planum"), esc((Math.round(m.planum * 100) / 100).toLocaleString("no-NO", { minimumFractionDigits: 2 }) + " " + t("moh."))) +
    rad(t("Skjæring (grave bort)"), m3(m.skjaering), "#e53935") + del(m.skjaeringPlate, m.skjaeringSkraning) +
    rad(t("Fylling (fylle inn)"), m3(m.fylling), "#3b82f6") + del(m.fyllingPlate, m.fyllingSkraning) +
    rad(m.netto >= 0 ? t("Overskudd av masser") : t("Underskudd av masser"), m3(Math.abs(m.netto))) +
    rad(t("Areal under plata"), Math.round(m.areal).toLocaleString("no-NO") + " m²") +
    (sk.paa ? rad(t("Areal i skråningene"), Math.round(m.arealSkraning).toLocaleString("no-NO") + " m²") : "") +
    (sk.paa && m.skraningUtAvUtsnitt
      ? '<p style="font-size:11px;margin:4px 0 0;color:var(--accent)">' + ikon("advarsel") + " " +
        t("Skråningen når kanten av det hentede terrenget — massene er for små. Hent et større utsnitt.") + "</p>" : "") +
    "<p " + LITEN + ">" + t("10 cm høyere eller lavere planum endrer massene med ca. {0}.", m3(m.per10cm)) +
    (m.snitt != null ? " " + t("Snitthøyde for terrenget under plata: {0}", fmtMoh(m.snitt, 2)) : "") + "</p>" +
    '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:6px"><input type="checkbox" id="trVisMasser"' +
    (visMasser ? " checked" : "") + "> " + t("Vis skjæring (rødt) og fylling (blått) i terrenget") + "</label>" +
    '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:4px"><input type="checkbox" id="trVisFerdig"' +
    (visFerdig ? " checked" : "") + "> " + t("Vis terrenget etter graving (planum og skråninger)") + "</label>" +
    '<p style="font-size:11px;margin:6px 0 0;color:var(--accent)">' +
    t("Overslag, ikke til oppgjør: terrenget er laserskannet før graving, og skråningene er regnet med fast helning uten grøfter, drenering eller masseutskifting.") +
    (erLaast() ? "" : " " + t("Uten festet hjørne er plasseringen ±1–2 m.")) + "</p>";
  return html;
}

function settPlanum(ny, medAngre) {
  if (!terreng) return;
  const fra = Object.assign({}, terreng.planum), til = vaskPlanum(ny), gjeldende = terreng;
  if (JSON.stringify(fra) === JSON.stringify(til)) return;
  terreng.planum = til;
  oppdaterAlt();
  if (erApen()) tegnPanel();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: "Planum",
    angre: () => { if (terreng === gjeldende) { terreng.planum = fra; oppdaterAlt(); if (erApen()) tegnPanel(); } },
    gjenopprett: () => { if (terreng === gjeldende) { terreng.planum = til; oppdaterAlt(); if (erApen()) tegnPanel(); } }
  });
}

function koblMasser() {
  if (!terreng) return;
  const modus = $("trPlanumModus");
  if (modus) modus.onchange = () => {
    const pl = terreng.planum || vaskPlanum(null);
    if (modus.value === "kote") settPlanum(Object.assign({}, pl, { modus: "kote", kote: pl.kote != null ? pl.kote : (terreng.masser ? Math.round(terreng.masser.planum * 100) / 100 : null) }), true);
    else settPlanum(Object.assign({}, pl, { modus: "oppbygging" }), true);
    tegnPanel();
  };
  const tall = (el) => Number(String(el.value).replace(/\s/g, "").replace(",", "."));
  const opp = $("trOppbygging");
  if (opp) {
    opp.onchange = () => { const v = tall(opp); if (Number.isFinite(v) && v >= 0 && v <= 5) settPlanum(Object.assign({}, terreng.planum, { oppbygging: v }), true); else tegnPanel(); };
    opp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); opp.blur(); } };
  }
  const kote = $("trPlanumKote");
  if (kote) {
    kote.onchange = () => { const v = tolkKote(kote.value); if (v != null) settPlanum(Object.assign({}, terreng.planum, { modus: "kote", kote: v }), true); else tegnPanel(); };
    kote.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); kote.blur(); } };
  }
  const vis = $("trVisMasser");
  if (vis) vis.onchange = () => { visMasser = vis.checked; oppdaterAlt(); };
  const ferdig = $("trVisFerdig");
  if (ferdig) ferdig.onchange = () => { visFerdig = ferdig.checked; oppdaterAlt(); };
  const skrPaa = $("trSkrPaa");
  if (skrPaa) skrPaa.onchange = () => settSkraning(Object.assign({}, terreng.skraning, { paa: skrPaa.checked }));
  for (const [id, felt] of [["trSkrSkj", "skjaering"], ["trSkrFyl", "fylling"]]) {
    const el = $(id);
    if (!el) continue;
    el.onchange = () => {
      const v = tall(el);
      if (Number.isFinite(v) && v >= 0.2 && v <= 10) settSkraning(Object.assign({}, terreng.skraning, { [felt]: v }));
      else tegnPanel();
    };
    el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } };
  }
}

function settSkraning(ny) {
  if (!terreng) return;
  const fra = Object.assign({}, terreng.skraning), til = vaskSkraning(ny), gjeldende = terreng;
  if (JSON.stringify(fra) === JSON.stringify(til)) { tegnPanel(); return; }
  const bruk = (v) => { if (terreng === gjeldende) { terreng.skraning = v; oppdaterAlt(); if (erApen()) tegnPanel(); } };
  bruk(til);
  if (S.pushAngre) S.pushAngre({ tekst: "Skråninger", angre: () => bruk(fra), gjenopprett: () => bruk(til) });
}

// ═══════════════════════ 📍 FEST HJØRNE ═══════════════════════
//
// Spesifikasjonen punkt 2. Velg et hjørne i modellen, skriv inn landmålerens
// koordinat — bygget flyttes dit og låses. To hjørner gir også rotasjonen og
// en kontroll: avstanden mellom dem i modellen skal være den samme som hos
// landmåleren. Punktene er i byggrammen, så de følger modellen, ikke terrenget.
function tallFelt(v) {
  const s0 = String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".");
  if (!s0) return null;
  const n = Number(s0);
  return Number.isFinite(n) ? n : NaN;
}
function tallTekst(v, des) {
  return v == null ? "" : v.toFixed(des).replace(".", ",");
}
function mTekst(v) {
  return (Math.round(v * 100) / 100).toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
}

function tegnFest() {
  const f = terreng.fest || vaskFest({});
  let html = '<h4 style="margin:14px 0 4px">' + ikon("markering") + " " + t("Fest til landmålerens koordinater") + "</h4>";
  if (f.laast) {
    html += '<p style="font-size:12px;margin:4px 0 0">' + ikon("hake") + " " +
      (f.antall === 2 ? t("Bygget er festet i to hjørner. Flytting og rotering er låst.") : t("Bygget er festet i ett hjørne. Flytting er låst — rotasjonen kan fortsatt skrives inn.")) + "</p>";
    if (f.kontroll) {
      const k = f.kontroll, stor = Math.abs(k.avvikM) > 0.10;
      html += '<p style="font-size:11px;margin:4px 0 0;color:' + (stor ? "var(--accent)" : "var(--muted)") + '">' +
        t("Avstand mellom hjørnene: {0} i modellen, {1} hos landmåler (avvik {2}).", mTekst(k.lengdeModell), mTekst(k.lengdeLandmaaler), mTekst(Math.abs(k.avvikM))) +
        (stor ? " " + t("Over 10 cm — sjekk at det er de samme hjørnene og samme koordinatsystem.") : "") + "</p>";
    }
    if (festMelding) html += '<p style="font-size:11px;margin:4px 0 0;color:var(--accent)">' + esc(festMelding) + "</p>";
    html += '<div class="prop-actions"><button id="trFestLos">' + ikon("juster") + " " + t("Løsne bygget") + "</button></div>";
    return html;
  }
  html += "<p " + LITEN + ">" + t("Velg et hjørne i modellen og skriv inn koordinaten fra landmåleren. To hjørner gir også rotasjonen.") + "</p>" +
    '<label>' + t("Koordinatsystem") + '<select id="trFestSys">' +
    KOORDSYS.map(k => '<option value="' + k.id + '"' + (k.id === f.sys ? " selected" : "") + ">" + esc(k.navn) + " (EPSG:" + k.id + ")</option>").join("") +
    "</select></label>";
  for (let i = 0; i < 2; i++) {
    const q = f.punkter[i] || {};
    const valgt = q.bx != null;
    html += '<div style="border:1px solid var(--border);border-radius:6px;padding:6px 8px;margin-top:6px">' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:12px"><b>' + t("Hjørne {0}", i + 1) + "</b>" +
      (i === 1 ? ' <span style="color:var(--muted)">' + t("(valgfritt)") + "</span>" : "") +
      '<span style="flex:1"></span><button data-tr-festvelg="' + (i + 1) + '"' + (festVelger === i + 1 ? ' class="active"' : "") + ">" +
      ikon("markering") + " " + (festVelger === i + 1 ? t("Trykk i modellen …") : (valgt ? t("Velg på nytt") : t("Velg i modellen"))) + "</button></div>" +
      '<div style="font-size:11px;color:' + (valgt ? "var(--muted)" : "var(--accent)") + ';margin-top:2px">' +
      (valgt ? t("Valgt") + (q.snap === "hjørne" ? " (" + t("snappet til hjørne") + ")" : "") + " · " + t("{0} over gulvet", mTekst(q.hy || 0))
             : t("Ikke valgt ennå")) + "</div>" +
      '<div style="display:flex;gap:6px">' +
      '<label style="flex:1">' + t("Nord (x)") + '<input type="text" inputmode="decimal" data-tr-fest="' + i + ':N" value="' + esc(tallTekst(q.N, 3)) + '"></label>' +
      '<label style="flex:1">' + t("Øst (y)") + '<input type="text" inputmode="decimal" data-tr-fest="' + i + ':E" value="' + esc(tallTekst(q.E, 3)) + '"></label></div>' +
      (i === 0 ? '<label>' + t("Kote (moh.) — valgfri, setter gulvkoten") + '<input type="text" inputmode="decimal" data-tr-fest="0:Z" value="' + esc(tallTekst(q.Z, 3)) + '"></label>' : "") +
      "</div>";
  }
  html += "<p " + LITEN + ">" + t("I norsk oppmåling er x nord og y øst. Esc avbryter valget.") + "</p>" +
    '<div class="prop-actions"><button id="trFestBruk">' + ikon("hake") + " " + t("Fest bygget") + "</button></div>";
  if (festMelding) html += '<p style="font-size:11px;margin:4px 0 0;color:' + (festFeil ? "var(--accent)" : "var(--muted)") + '">' + esc(festMelding) + "</p>";
  return html;
}

function settFest(ny, tekst) {
  if (!terreng) return;
  const fra = terreng.fest, til = ny, gjeldende = terreng;
  const bruk = (v) => { if (terreng === gjeldende) { terreng.fest = v; tegnHandtak(); planLagring(); if (erApen()) tegnPanel(); } };
  bruk(til);
  if (tekst && S.pushAngre) S.pushAngre({ tekst, angre: () => bruk(fra), gjenopprett: () => bruk(til) });
}

function festBruk() {
  if (!terreng) return;
  const f = terreng.fest || vaskFest({});
  const g = terreng.grid, halv = Math.min(g.w * g.dx, g.h * g.dy) / 2;
  const klare = [];
  f.punkter.forEach((q, i) => { if (q && q.bx != null && q.E != null && q.N != null) klare.push({ q, i }); });
  festFeil = true;
  const halvferdig = f.punkter.some(q => q && ((q.bx != null) !== (q.E != null && q.N != null)));
  if (!klare.length) { festMelding = t("Velg et hjørne i modellen og skriv inn både nord og øst først."); tegnPanel(); return; }
  if (halvferdig) { festMelding = t("Et hjørne mangler enten valg i modellen eller koordinater — fullfør det eller tøm feltene."); tegnPanel(); return; }
  const sj = [];
  for (const o of klare) {
    const r = festSjekk(o.q.E, o.q.N, f.sys, terreng.E0, terreng.N0, halv);
    if (!r.ok) {
      festMelding = t("Hjørne {0} havner {1} fra adressen, utenfor terrenget.", o.i + 1, Math.round(r.avstand).toLocaleString("no-NO") + " m") + " " +
        (r.byttet ? t("Nord og øst ser ut til å være byttet om.") : t("Sjekk koordinatsystemet og tallene."));
      tegnPanel(); return;
    }
    sj.push(r);
  }
  let ny, kontroll = null;
  if (klare.length === 2) {
    const r = festToPunkt(klare[0].q, klare[1].q, terreng.E0, terreng.N0, sj[0], sj[1]);
    if (!r) { festMelding = t("Hjørnene ligger for nær hverandre — velg to hjørner minst noen meter fra hverandre."); tegnPanel(); return; }
    ny = r.plass;
    kontroll = { avvikM: r.avvikM, lengdeModell: r.lengdeModell, lengdeLandmaaler: r.lengdeLandmaaler };
  } else {
    ny = festEttPunkt(klare[0].q, terreng.E0, terreng.N0, terreng.plass.rot, sj[0].E, sj[0].N);
  }
  festFeil = false; festMelding = "";
  flyttModus = false; festVelger = 0;
  settPlass(ny, { angre: true });
  const z = f.punkter[0];
  if (z && z.Z != null && z.bx != null) {
    const kote = z.Z - (z.hy || 0);
    settGulv(kote, false, true);
    // Koten gjelder punktet som ble valgt. Står det oppe på en søyle eller
    // takkanten, er gulvet så mye lavere — si det, så ingen tror gulvkoten
    // er landmålerens tall rett av.
    if ((z.hy || 0) > 0.05) festMelding = t("Gulvkoten er satt til {0}: koten {1} minus {2} fra gulvet opp til punktet du valgte.",
      fmtMoh(kote, 2), fmtMoh(z.Z, 2), mTekst(z.hy));
  }
  settFest(Object.assign({}, f, { laast: true, antall: klare.length, kontroll }), "Bygget festet");
}

function koblFest(body) {
  if (!terreng) return;
  const f = () => terreng.fest || vaskFest({});
  const sys = $("trFestSys");
  if (sys) sys.onchange = () => settFest(Object.assign({}, f(), { sys: sys.value }), null);
  body.querySelectorAll("[data-tr-festvelg]").forEach(b => b.onclick = () => {
    const n = Number(b.dataset.trFestvelg);
    festVelger = festVelger === n ? 0 : n;
    tegnPanel();
  });
  body.querySelectorAll("input[data-tr-fest]").forEach(el => {
    el.onchange = () => {
      const [i, felt] = el.dataset.trFest.split(":");
      const v = tallFelt(el.value);
      if (Number.isNaN(v)) { festMelding = t("«{0}» er ikke et tall.", el.value); festFeil = true; tegnPanel(); return; }
      const punkter = f().punkter.slice();
      punkter[Number(i)] = Object.assign({ bx: null, bz: null, hy: 0, E: null, N: null, Z: null }, punkter[Number(i)] || {}, { [felt]: v });
      festMelding = "";
      settFest(vaskFest(Object.assign({}, f(), { punkter })), null);
    };
    el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } };
  });
  const bruk = $("trFestBruk");
  if (bruk) bruk.onclick = () => festBruk();
  const los = $("trFestLos");
  if (los) los.onclick = () => (festMelding = "", settFest(Object.assign({}, f(), { laast: false, antall: 0, kontroll: null }), "Bygget løsnet"));
}

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
    // Ett festet hjørne låser flyttingen; rotasjonen kan fortsatt skrives inn
    // (bygget dreier da rundt hjørnet, se settRotasjon). To hjørner låser alt.
    const rotLaast = erLaast() && terreng.fest.antall === 2;
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
      '<div class="prop-actions"><button id="trFlytt"' + (flyttModus ? ' class="active"' : "") + (erLaast() ? " disabled" : "") + ">" +
      ikon("juster") + " " + (flyttModus ? t("Ferdig med å flytte") : t("Flytt og roter bygget")) + "</button></div>" +
      (flyttModus ? "<p " + LITEN + ">" +
        t("Dra i det hvite fotavtrykket for å flytte bygget. Dra i det hvite håndtaket foran bygget for å rotere — det snapper til hver 90°. Esc avslutter.") + "</p>" : "") +
      '<label>' + t("Rotasjon (grader, med klokka)") +
      '<span style="display:flex;gap:6px;margin-top:3px">' +
      '<input type="text" id="trRot" inputmode="decimal" style="flex:1" value="' + esc(String(normVinkel(terreng.plass.rot)).replace(".", ",")) + '"' + (rotLaast ? " disabled" : "") + ">" +
      '<button id="trRotV" title="' + t("Roter 90° mot klokka") + '"' + (rotLaast ? " disabled" : "") + ">−90°</button>" +
      '<button id="trRotH" title="' + t("Roter 90° med klokka") + '"' + (rotLaast ? " disabled" : "") + ">+90°</button></span></label>" +
      (erLaast() ? "<p " + LITEN + ">" + ikon("markering") + " " + t("Festet til landmålerens koordinater — løsne under «Fest til landmålerens koordinater» for å flytte.") + "</p>" : "") +
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
      "<p " + LITEN + ">" + t("Gulvet er modellens laveste punkt — bunnen av søylene, toppen av betonggulvet. ▲ Kote viser nå moh.") + "</p>" +
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

      // 📍 Fest hjørne: landmålerens koordinater
      tegnFest() +

      // ⛏ Masser: skjæring og fylling under plata
      '<div id="trMasser">' + tegnMasser() + "</div>" +

      // 🗺 Kart på terrenget
      '<h4 style="margin:14px 0 4px">' + ikon("tegning") + " " + t("Kart på terrenget") + "</h4>" +
      '<label>' + t("Vis") + '<select id="trKart">' +
      '<option value="topo"' + (kartValg === "topo" ? " selected" : "") + ">" + t("Topografisk kart (Kartverket)") + "</option>" +
      '<option value="hoyde"' + (kartValg === "hoyde" ? " selected" : "") + ">" + t("Høydefarger") + "</option></select></label>" +
      (kartValg === "topo" && terreng.kart && terreng.kart.status === "laster" ? "<p " + LITEN + ">" + t("Henter kartet …") + "</p>" : "") +
      (kartValg === "topo" && terreng.kart && terreng.kart.status === "feil"
        ? '<p style="font-size:11px;margin:4px 0 0;color:var(--accent)">' + t("Kartet kunne ikke hentes — viser høydefarger.") +
          (terreng.kart.detalj ? " " + esc(terreng.kart.detalj) : "") + "</p>" : "") +
      "<p " + LITEN + ">" + t("Kart og høydedata: © Kartverket (CC BY 4.0). Flyfoto fra Norge i bilder krever avtale gjennom Norge digitalt og er derfor ikke med.") + "</p>" +

      // ✂ Trinn 4 — beskjæring
      '<h4 style="margin:14px 0 4px">' + ikon("snitt") + " " + t("Beskjær") +
      ' <span id="trKlippTall" style="font-weight:700;margin-left:6px">' + esc(klippTekst()) + "</span></h4>" +
      "<p " + LITEN + ">" +
      t("Dra i de røde håndtakene i 3D-vinduet for å beskjære terrenget. Hele utsnittet er tatt vare på — dra ut igjen, så kommer det tilbake uten å hente på nytt.") + "</p>" +
      '<div class="prop-actions"><button id="trKlippHele"' +
      (likeKlipp(terreng.klipp, fulltKlipp(terreng.grid)) ? " disabled" : "") + ">" +
      ikon("fullskjerm") + " " + t("Vis hele utsnittet") + "</button></div>";
  }

  // 💾 Lagring og lagrede terreng — lista vises også uten et hentet terreng,
  // så et lagret terreng kan legges under en ny modell uten å hente på nytt.
  if (S.modelGroup) html += tegnLagring();

  // Advarselen står i PANELET, ikke bare i spesifikasjonen (byggeplanen,
  // advarsel 4). Den som skal grave, leser ikke spesifikasjoner.
  html += '<p style="font-size:11px;margin:10px 0 0;padding:6px 8px;border:1px solid var(--border);border-radius:6px">' +
    ikon("advarsel") + " " +
    (erLaast()
      ? t("Bygget er festet etter landmålerens koordinater, men terrenget er fortsatt laserdata fra før graving. Skal aldri brukes til utstikking.")
      : t("Plasseringen er omtrentlig (±1–2 m) og skal aldri brukes til utstikking.")) + "</p>";

  body.innerHTML = html;
  koblLagring(body);
  koblMasser();
  koblFest(body);

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
  kobl("trFlytt", () => { if (erLaast()) return; flyttModus = !flyttModus; tegnPanel(); });
  kobl("trRotV", () => { if (terreng) settRotasjon(snapVinkel(terreng.plass.rot - 90, 0.05)); });
  kobl("trRotH", () => { if (terreng) settRotasjon(snapVinkel(terreng.plass.rot + 90, 0.05)); });
  kobl("trOppaa", () => leggOppaa(true));
  kobl("trPadStd", () => { if (terreng && S.modelGroup) settPad(padStandard(modellRef().fp), true); });
  const rot = $("trRot");
  if (rot) {
    const bruk = () => {
      const v = Number(String(rot.value).replace(",", "."));
      if (!terreng || !Number.isFinite(v)) { visTall(); return; }
      settRotasjon(v);
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
  const kart = $("trKart");
  if (kart) kart.onchange = () => {
    kartValg = kart.value === "hoyde" ? "hoyde" : "topo";
    if (terreng && kartValg === "topo" && (!terreng.kart || terreng.kart.status === "feil")) { terreng.kart = null; hentKart(terreng); }
    brukKart();
    planLagring();
    tegnPanel();
  };
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
