// 🏗 SW-elementene PÅ BYGGEPLASSEN — monteringsinstruks, ikke generator.
//
// HVORFOR DENNE FILA FINNES OG IKKE BARE js/veggelement.js. Generatoren er på
// 300 kB og laster fasader, regneregler, tegningseksport og Excel-utskrift.
// Ingenting av det trenger montøren, og alt av det ville blitt forhåndslagret
// av service workeren for en telefon som står uten dekning. Denne fila tegner
// det Emil allerede har bestemt: kasser med riktig mål, på riktig sted, med
// SW-nummeret på. Beskrivelsen kommer ferdig fra kontoret (swForByggeplass i
// js/veggelement.js) og regnes ALDRI ut på nytt her — da kunne montøren endt
// opp med en vegg ingen har godkjent.
//
// Tegningen er enklere enn på kontoret med vilje: ingen bølgeprofil i blikket.
// Den er til pynt, og koster rammer på en telefon.
import * as THREE from "three";
import { S, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { scene } from "./scene.js";

export const swLettGroup = new THREE.Group();
scene.add(swLettGroup);

// ---------- Skiltene ligger PÅ panelet ----------
// FØRSTE FORSØK BRUKTE SVEVENDE LAPPER med konstant skjermstørrelse, som
// materiellet og kotene. På en fasade med to hundre paneler ble det to hundre
// skilt oppå hverandre, og montøren så et teppe av «SW-31» i stedet for
// bygget (Emils bilde 16.09). Kontoret har alltid gjort det motsatte: skiltet
// er en FLAT DEKAL med fast fysisk størrelse, limt på panelflaten. Da ligger
// det der det hører hjemme, krymper når du går unna, og to skilt kan ikke
// legge seg over hverandre — de sitter på hver sin vegg.
const dekalCache = new Map();

function dekalTekstur(tekst) {
  if (dekalCache.has(tekst)) return dekalCache.get(tekst);
  const pad = 16, fs = 64;
  const mc = document.createElement("canvas").getContext("2d");
  mc.font = "bold " + fs + "px sans-serif";
  const w = Math.ceil(mc.measureText(tekst).width + pad * 2);
  const c = document.createElement("canvas");
  c.width = w; c.height = fs + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#11161d"; ctx.lineWidth = 5; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  ctx.font = "bold " + fs + "px sans-serif";
  ctx.fillStyle = "#11161d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tekst, c.width / 2, c.height / 2 + 2);
  const ut = { tex: new THREE.CanvasTexture(c), aspect: c.width / c.height };
  dekalCache.set(tekst, ut);
  return ut;
}

// hoydeMm = skilthøyde i mm; maksBredde (sceneenheter) krymper skiltet så det
// aldri stikker utenfor elementet det sitter på.
function tekstDekal(tekst, hoydeMm, maksBredde) {
  const { tex, aspect } = dekalTekstur(tekst);
  let h = mm(hoydeMm), w = h * aspect;
  if (maksBredde > 0 && w > maksBredde) { const k = maksBredde / w; w *= k; h *= k; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ map: tex }));
  m.raycast = () => {};
  // Skiltet skal IKKE bli gjennomsiktig sammen med veggen det sitter på: du
  // slår på Gjennomsiktig for å se hva som står BAK panelet, og da må du
  // fortsatt kunne lese hvilket panel du ser gjennom.
  m.userData.ghostFritatt = true;
  return m;
}

// Millimeter til sceneenheter. S.enhetSkala settes i js/ifc.js og er meter per
// modellenhet — den SAMME omregningen som generatoren bruker, og grunnen til
// at et element havner riktig i en modell tegnet i millimeter.
const mm = (v) => (Number(v) || 0) / 1000 / (S.enhetSkala || 1);

const FARGER = { y: "#dfe5ec", i: "#cfd8e3", r: "#8a8f98" };

// ---------- Hva som faktisk skal tegnes ----------
// REN FUNKSJON, uten three.js: beskrivelsen kommer gjennom JSON og et nett, og
// reglene for hva som slipper gjennom skal kunne prøves uten å tegne noe.
//   · uten mål er det ingenting å montere etter — droppes
//   · et skråkappet element ER en trapes. Tegnet som kasse med middelhøyde
//     ville montøren fått beskjed om at gavlpanelet er rett når det ikke er det
//   · fargen er fasadens på ytterveggene, faste på innervegg og ringmur, så
//     montøren ser hva som er hva
export function swLettElementer(data) {
  const d = data && typeof data === "object" ? data : null;
  const liste = d && Array.isArray(d.elementer) ? d.elementer : [];
  const grunnfarge = /^#[0-9a-fA-F]{6}$/.test(String((d && d.farge) || "")) ? d.farge : FARGER.y;
  const ut = [];
  for (const e of liste) {
    if (!e || !(Number(e.l) > 0) || !(Number(e.h) > 0)) continue;
    ut.push(Object.assign({}, e, {
      farge: e.k === "r" ? FARGER.r : (e.k === "i" ? FARGER.i : grunnfarge),
      trapes: e.hv !== undefined && e.hh !== undefined && Number(e.hv) !== Number(e.hh)
    }));
  }
  return ut;
}

function mat(farge) {
  return new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
}

// Rett element: en kasse. Skråkappet: en trapes, dratt ut i tykkelsen.
// Gavlpanelene ER trapeser, og en kasse med middelhøyde der ville sagt
// montøren at panelet er rett når det ikke er det.
function byggGeometri(e) {
  const L = mm(e.l), T = mm(e.t);
  if (e.trapes) {
    const hv = mm(e.hv), hh = mm(e.hh);
    const form = new THREE.Shape();
    form.moveTo(-L / 2, 0);
    form.lineTo(L / 2, 0);
    form.lineTo(L / 2, hh);
    form.lineTo(-L / 2, hv);
    form.closePath();
    const g = new THREE.ExtrudeGeometry(form, { depth: T, bevelEnabled: false });
    g.translate(0, -Math.max(hv, hh) / 2, -T / 2);
    return g;
  }
  return new THREE.BoxGeometry(L, mm(e.h), T);
}

function ryddAlt() {
  swLettGroup.children.slice().forEach(o => {
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); });
    swLettGroup.remove(o);
  });
}

// Over dette antallet droppes merkingen. Det er ikke kassene som tar knekken
// på en telefon, det er teksturene: hvert skilt er sitt eget canvas. Cachen
// deler dem på TEKST, så tjue paneler som alle heter «SW-31» koster én
// tekstur — derfor er grensen på antall SKILT, ikke på antall elementer.
const MAKS_LAPPER = 400;

// Det som står på bygget nå. Egen liste og ikke en gjennomgang av gruppa:
// søket skal svare på hva som ER der, og det svaret skal ikke avhenge av
// hvordan three.js har lagt tingene i scenen.
let tegnede = [];

export function tegnSwLett(data) {
  ryddAlt();
  const liste = swLettElementer(data);
  tegnede = liste;
  if (!liste.length) { oppdaterKnapp(); return; }
  // ETT materiale per farge, ikke ett per element: to tusen materialer er to
  // tusen shader-oppsett, og telefonen merker det med en gang.
  const materialer = new Map();
  const hent = (f) => {
    if (!materialer.has(f)) materialer.set(f, mat(f));
    return materialer.get(f);
  };
  const visLapper = liste.length <= MAKS_LAPPER;
  for (const e of liste) {
    const m = new THREE.Mesh(byggGeometri(e), hent(e.farge));
    m.position.set(Number(e.x) || 0, Number(e.y) || 0, Number(e.z) || 0);
    m.rotation.y = Number(e.rot) || 0;
    m.userData.swLettId = String(e.id || "");
    m.userData.swLett = e;
    swLettGroup.add(m);
    if (visLapper && e.sw) merkPanel(e);
  }
  if (visLapper) tegnUtsparinger(data);
  oppdaterKnapp();
  // Nytegnet = ferske materialer som ikke vet at Gjennomsiktig står på.
  if (S.ghostPaaNytt) S.ghostPaaNytt();
}

// SW-nummeret i øvre hjørne og målet i midten — nøyaktig samme plassering som
// på kontoret, så montøren og prosjektlederen ser det samme bildet.
const _opp = new THREE.Vector3(0, 0, 1);
function merkPanel(e) {
  const nv = new THREE.Vector3(Number(e.nx) || 0, 0, Number(e.nz) || 0);
  if (nv.lengthSq() < 1e-9) nv.set(0, 0, 1);
  nv.normalize();
  const ex = Math.cos(e.rot || 0), ez = -Math.sin(e.rot || 0);
  const utD = mm(e.t) / 2 + 0.01 / (S.enhetSkala || 1);
  const L = mm(e.l), H = mm(e.h);
  const sw = tekstDekal(e.sw, 220, L * 0.45);
  sw.quaternion.setFromUnitVectors(_opp, nv);
  sw.position.set(e.x - ex * L * 0.32 + nv.x * utD,
                  e.y + H * 0.24,
                  e.z - ez * L * 0.32 + nv.z * utD);
  swLettGroup.add(sw);
  if (e.dim) {
    const dim = tekstDekal(e.dim, 150, L * 0.6);
    dim.quaternion.copy(sw.quaternion);
    dim.position.set(e.x + nv.x * utD, e.y - H * 0.1, e.z + nv.z * utD);
    swLettGroup.add(dim);
  }
}

// 🚪 UTSPARINGENE: stiplet ramme med kryss, målet i midten og navnet over.
// Hjørnene kommer ferdig utregnet fra kontoret (swUtspForByggeplass) — hadde
// vi regnet dem ut her av fasadene, ville den regningen stått to steder.
//
// Vanlig dybdetest og ingen renderOrder, som på kontoret: det var
// depthTest:false som lot krysset på baksiden skinne gjennom fasaden.
function tegnUtsparinger(data) {
  const liste = (data && Array.isArray(data.utsparinger)) ? data.utsparinger : [];
  if (!liste.length) return;
  const strekMat = new THREE.LineDashedMaterial({
    color: 0x11161d, dashSize: 0.12 / (S.enhetSkala || 1),
    gapSize: 0.08 / (S.enhetSkala || 1) });
  for (const a of liste) {
    if (!a || !Array.isArray(a.p) || a.p.length !== 4) continue;
    const v = a.p.map(q => new THREE.Vector3(Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0));
    const geo = new THREE.BufferGeometry().setFromPoints([
      v[0], v[1], v[1], v[2], v[2], v[3], v[3], v[0],   // rammen
      v[0], v[2], v[1], v[3]                            // krysset
    ]);
    const linje = new THREE.LineSegments(geo, strekMat);
    linje.computeLineDistances();     // MÅ til, ellers blir streken hel
    linje.raycast = () => {};
    linje.userData.ghostFritatt = true;
    swLettGroup.add(linje);
    const nv = new THREE.Vector3(Number((a.n || [])[0]) || 0, 0, Number((a.n || [])[1]) || 0);
    if (nv.lengthSq() < 1e-9) nv.set(0, 0, 1);
    nv.normalize();
    const maks = mm(Math.max((a.b || 0) * 0.8, 600));
    if (Array.isArray(a.m)) {
      const tot = tekstDekal((a.b || 0) + "\u00d7" + (a.h || 0) + " MM", 260, maks);
      tot.quaternion.setFromUnitVectors(_opp, nv);
      tot.position.set(Number(a.m[0]) || 0, Number(a.m[1]) || 0, Number(a.m[2]) || 0);
      swLettGroup.add(tot);
      if (a.navn && Array.isArray(a.mn)) {
        const navn = tekstDekal(a.navn, 260, maks);
        navn.quaternion.copy(tot.quaternion);
        navn.position.set(Number(a.mn[0]) || 0, Number(a.mn[1]) || 0, Number(a.mn[2]) || 0);
        swLettGroup.add(navn);
      }
    }
  }
}

// ---------- Skjul/vis hele laget ----------
// Én bryter, ikke per element: montøren skal kunne ta SW-elementene bort for å
// se stålet bak, og så få dem tilbake. Å skjule ett og ett er et kontorbehov.
let skjult = false;

function oppdaterKnapp() {
  swLettGroup.visible = !skjult;
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
}

// Laget melder inn hva det kan (se EKSTRA_LAG i js/state.js): Gjennomsiktig,
// «Vis alle», Mengder og Elementsøk virker da på byggeplassen uten at noen av
// dem vet at dette laget finnes.
registrerEkstraGruppe(swLettGroup, {
  id: "sw",
  navn: "SW-elementer",
  noeSkjult: () => skjult,
  visAlt() { if (!skjult) return; skjult = false; oppdaterKnapp(); },
  skjulTilstand: () => ({ skjult }),
  settSkjulTilstand(v) { skjult = !!(v && v.skjult); oppdaterKnapp(); },
  sokRader: () => tegnede.filter(e => e.sw).map(e => {
    const under = [e.k === "i" ? t("Innervegg") : t("Yttervegg"), e.l + "×" + e.h + " mm"].join(" · ");
    return { id: e.id, navn: e.sw, under, s: (e.sw + " " + under).toLowerCase() };
  })
});

// markers.js kaller denne med `sw`-feltet fra <fil>.markeringer.json når
// modellen er lastet. Gamle filer har ikke feltet — da tegnes ingenting, og
// det er riktig: byggeplassen skal ikke gjette.
S.settSwFraLett = (data) => tegnSwLett(data);
S.ryddSwLett = () => tegnSwLett(null);
