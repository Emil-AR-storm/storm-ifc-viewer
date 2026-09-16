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
import { frameHooks, makeLabel, scene, updateScreenScaled } from "./scene.js";

export const swLettGroup = new THREE.Group();
scene.add(swLettGroup);

// Navnelappene skal ha konstant størrelse på skjermen, som kote- og
// materiell-lappene. Uten dette er SW-nummeret uleselig på avstand og
// skjermfyllende når du går nær.
frameHooks.push(() => updateScreenScaled(swLettGroup));

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

// Over dette antallet droppes lappene. Tre hundre sprites med hver sin tekstur
// er det som tar knekken på en telefon, ikke kassene — samme grense som
// generatoren bruker på kontoret.
const MAKS_LAPPER = 300;

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
    if (visLapper && e.sw) {
      const lapp = makeLabel(e.sw, "#38bdf8");
      lapp.userData.px = 22;                       // konstant skjermstørrelse
      lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
      lapp.position.set(m.position.x, m.position.y + mm(e.h) * 0.32, m.position.z);
      swLettGroup.add(lapp);
    }
  }
  oppdaterKnapp();
  // Nytegnet = ferske materialer som ikke vet at Gjennomsiktig står på.
  if (S.ghostPaaNytt) S.ghostPaaNytt();
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
