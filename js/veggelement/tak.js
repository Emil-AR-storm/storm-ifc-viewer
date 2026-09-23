// 🏔 TAKFLATA OG TRP-PLATENE I 3D — runde 3 (Emil 18.09).
//
// Reglene bor i js/sw-tak.js (rene tall, testet i Node mot en håndregnet
// fasit på et saltak 24 × 40 m). Her bygges bare INNDATAENE fra det som ligger
// lagret, og platene tegnes opp. Finner du et regnestykke her, er det på feil
// sted.
//
// ── DET SOM MÅTTE BYGGES ──────────────────────────────────────────────────
// Det finnes ingen takflate i modellen. Emil valgte 18.09 at den skal bygges
// AUTOMATISK AV DE ØVERSTE BJELKENE, og det er nettopp det `takPunkter()`
// under gjør: den samler stålet som ligger øverst, projiserer det ned i
// takrammen, og lar sw-tak.js strekke et rektangel rundt.
//
// Bølgegeometrien er IKKE ny: `trpProfil` fra materiell-vis.js har tegnet
// TRP-plater i materiellbiblioteket siden i sommer — samme trapes, samme
// deling, samme lav-poly ribbon. En andre utgave her ville før eller siden
// sett annerledes ut enn den i biblioteket.
import { $, esc, ikon, S } from "../state.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { MALTYPER, trpProfil } from "../materiell-vis.js";
import { TAK_RADER, TAK_STD, bjelkeLinje, fallRetningFraBjelker, justerPlater, plateId,
         platerPaFlate, roterFlater, skjotBjelker, aserVerden, takFlater, takRamme, takRektangel,
         takflaterFraBjelker, platerPaTaket, tilUV, fraUV, trpListe, takTotaler,
         ensrettFlater, deltRadrutenett, vinkelTekstTak,
         indreAser, plateNokkel } from "../sw-tak.js";
import { husTakMesh, nullstillTakMesh, startTakJuster, takJust,
         lagreTakResultat, lastInnTakResultat, lesTakLagrede, slettTakResultat,
         takLagringsTekst } from "./tak-just.js";
import { soyleTypeNavn, takLinje, tilMm, tilScene } from "./regler.js";
import { allElementBoxes, forHverTrekant } from "../elements.js";
import { lagret, skrivLagret, swGroup } from "./tilstand.js";
import { TAK_BOTTE_MM, TAK_TOL_MM, baseYNaa, skjulNaa, tegnAlt, tekstDekal } from "./tegning.js";
import { STAL_TYPER } from "./stal.js";
import { bunkePlass, lesStabelPosisjonerAlle, settStabelTilbakeAlle } from "./bunker.js";
import { lagreMateriellLokalt, tegnMateriell, vaskMateriell } from "../materiell-vis.js";

// ───────────────────── oppsettet ─────────────────────

export const TAK_FELT = [
  ["trpBreddeMm", "TRP dekkende bredde (mm)"],
  ["endeOverlappMm", "Overlapp endeskjøt (mm)"],
  ["maksLengdeMm", "Transportgrense (mm) — varsler, deler ikke"],
  ["skrueAvstandMm", "Skrueavstand i skjøt (mm)"],
  ["plateOverMm", "Platene over bjelka (mm)"],
  ["skjotPlanTolMm", "Hvor nær flata en ås må ligge (mm)"],
  ["flattFallProsent", "Fall på flatt tak (%)"]
];

// 🔎 EMILS FUNN 18.09: «jeg får ikke lov å justere noe på de forskjellige
// punktene, det går tilbake til tallet som er satt fra før hver gang.»
//
// Årsaken var at oppsettet lå INNE i `oppsett()`. Den funksjonen kjører
// migreringen og bygger et NYTT objekt hver gang den kalles:
//
//     lagret.oppsett = migrerOppsett(lagret.oppsett, STD_OPPSETT);
//
// `settTakOppsett` gjorde `const o = oppsett()` og skrev så `o.tak = …`. Men
// mellom de to linjene kalte den `takOppsett()`, som kaller `oppsett()` ENDA
// en gang — og da pekte `lagret.oppsett` på et nyere objekt. Verdien ble
// skrevet til et objekt som allerede var kastet, og feltet sprettet tilbake.
//
// Blikket har aldri hatt problemet fordi det lagrer på `lagret.blikkOppsett`
// direkte. Taket gjør nå det samme: ett sted, ingen migrering å bli forbikjørt av.
export function takOppsett() {
  const o = (lagret && lagret.takOppsett) || {};
  return { ...TAK_STD, ...o };
}
export function settTakOppsett(ny) {
  if (!lagret) return;
  lagret.takOppsett = { ...takOppsett(), ...(ny || {}) };
  skrivLagret();
}

// På/av, samme bryter-modell som blikket fikk i runde 2b: «Generer tak» slår
// det på og gir det et hjem, og så følger taket stålet av seg selv.
export const TAK_STD_TILSTAND = { pa: false, just: {}, ekstra: [], nesteNr: 1, snap: null, materiellIder: [] };
export function takTilstand() {
  if (!lagret) return { ...TAK_STD_TILSTAND };
  if (!lagret.tak || typeof lagret.tak !== "object") lagret.tak = { ...TAK_STD_TILSTAND };
  const t2 = lagret.tak;
  if (!t2.just || typeof t2.just !== "object") t2.just = {};
  if (!Array.isArray(t2.ekstra)) t2.ekstra = [];
  if (!(Number(t2.nesteNr) > 0)) t2.nesteNr = 1;
  if (t2.snap && typeof t2.snap !== "object") t2.snap = null;
  if (!Array.isArray(t2.materiellIder)) t2.materiellIder = [];
  return t2;
}
export function takPa() { return !!(lagret && takTilstand().pa); }

// ───────────────────── det lagrede taket ─────────────────────
//
// 🔎 EMILS FUNN 21.09: «jeg må generere takelement/TRP-plater om igjen hver
// gang jeg åpner modellen — den er der ikke fra før av, på samme måte som
// veggelement og blikk.»
//
// Veggene og blikket overlever en ny sideinnlasting fordi de leser LAGREDE
// TALL: `lagret.fasader` og `lagret.vegger` er rene data, og å tegne dem
// krever ikke modellen i det hele tatt. Taket gjorde det motsatte — det regnet
// seg fram til takflatene av stålet HVER gang, og stålets typenavn kommer fra
// IFC-metadataene, som hentes asynkront. Rett etter en innlasting svarer
// `soyleTypeNavn` tom streng for alt, ingen er «Beam», og taket var borte.
// Det var derfor «Generer tak» alltid måtte trykkes på nytt: knappen er det
// eneste stedet som venter på metadataene (`await sikreMeta`).
//
// Takflatene lagres derfor sammen med resten av SW-resultatet. De er rene
// tall — U, V, N, origo, u0..v1 — uten et eneste THREE-objekt, og de står i
// verdenskoordinater i mm, så samme modellfil gir samme tall. «Generer tak»
// er fortsatt det ENESTE som regner dem ut; her leses de bare tilbake så
// lenge stålet ikke er lest inn.
export function takSnapshot() {
  if (!lagret) return null;
  const s = takTilstand().snap;
  return (s && typeof s === "object" && Array.isArray(s.flater) && s.flater.length) ? s : null;
}
export function settTakSnapshot(s) {
  if (!lagret) return;
  const t2 = takTilstand();
  if (JSON.stringify(t2.snap || null) === JSON.stringify(s || null)) return;
  t2.snap = s || null;
  skrivLagret();
}

// ───────────────────── de øverste BJELKENE ─────────────────────
//
// 🔎 EMILS FUNN 18.09 (bilde 1): «TRP-plate legger seg på toppen av
// søyleforlengere i stedet for bjelker».
//
// Første utgave tok ALT stål — `STAL_TYPER` er ["Column","Beam","Member",
// "Plate"] — og beholdt det som nådde opp mot toppen. En søyleforlenger når
// nøyaktig like høyt som bjelken den bærer, så den kom med, og takflata ble
// strukket ut til forlengernes ytterkant i stedet for til bjelkene.
//
// Taket bæres av BJELKER. Søyler bærer bjelkene, og en søyle er aldri en
// takflate. Derfor er søylene ute her — det er ikke en filtrering «for
// sikkerhets skyld», det er hva et tak ER.
export const TAK_BJELKE_TYPER = ["Beam", "Member"];

// Boksene til bjelkene som ligger øverst, i verdenskoordinater.
export function takBjelker() {
  const bokser = allElementBoxes();
  if (!bokser || !bokser.size) return [];
  const bjelker = [];
  let toppY = -Infinity;
  for (const [id, b] of bokser) {
    if (TAK_BJELKE_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    bjelker.push({ id, b });
    if (b.max.y > toppY) toppY = b.max.y;
  }
  if (!bjelker.length) return [];
  // Marginen måles mot den høyeste BJELKEN, ikke mot det høyeste stålet: på et
  // saltak ligger raftbjelken langt under mønet og hører like fullt til taket,
  // mens en bjelke nede i en mesanin ikke gjør det. Takets egen høyde er det
  // eneste målet vi har på hvor langt ned «taket» rekker, og det er nettopp
  // fallet fra møne til raft.
  const hoyder = bjelker.map(b => b.b.max.y);
  const spenn = toppY - Math.min(...hoyder);
  const margin = Math.min(spenn, 6 / (S.enhetSkala || 1)) + 0.5 / (S.enhetSkala || 1);
  return bjelker.filter(x => x.b.max.y >= toppY - margin);
}

// Bjelkeboksene i den formen sw-tak.js sin fallRetningFraBjelker vil ha dem:
// rene tall i mm, ingen THREE-objekter.
export function bjelkeBokserMm(bjelker) {
  return (bjelker || []).map(({ b }) => ({
    minX: tilMm(b.min.x), maxX: tilMm(b.max.x),
    minY: tilMm(b.min.y), maxY: tilMm(b.max.y),
    minZ: tilMm(b.min.z), maxZ: tilMm(b.max.z)
  }));
}

// Hjørnene av bjelkene i (u, v), i MM — det takRektangel strekkes rundt.
export function takPunkter(ramme, bjelker) {
  const ut = [];
  for (const { b } of bjelker || [])
    for (const px of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z]) {
      const [u, v] = tilUV(ramme, px, pz);
      ut.push([tilMm(u), tilMm(v)]);
    }
  return ut;
}

// 🏗 BJELKENES OVERKANT SOM LINJER I ROMMET — grunnlaget for «Automatisk».
//
// Boksen til en bjelke sier hvor den strekker seg, men IKKE hvilken ende som
// er høy: en boks har min og maks i hver akse uten å koble dem. På et valmtak
// er det nettopp koblingen som er hele svaret. Derfor leses de ekte
// trekantpunktene, slik taklinjerFraModell gjør mot fasadene.
export function takBjelkeLinjer(bjelker, idPerBoks) {
  const ider = new Set(idPerBoks || []);
  if (!ider.size) return [];
  const per = new Map();
  const v = new THREE.Vector3();
  forHverTrekant(ider, (pos, i0, i1, i2, mtx, id) => {
    let liste = per.get(id);
    if (!liste) { liste = []; per.set(id, liste); }
    if (liste.length > 600) return;          // nok til å finne endene
    for (const i of [i0, i1, i2]) {
      v.fromBufferAttribute(pos, i);
      if (mtx) v.applyMatrix4(mtx);
      liste.push([tilMm(v.x), tilMm(v.y), tilMm(v.z)]);
    }
  });
  const ut = [];
  for (const punkter of per.values()) {
    const l = bjelkeLinje(punkter);
    if (l) ut.push(l);
  }
  return ut;
}

// 🏔 PROFILET LEST AV BJELKENES OVERKANT.
//
// Når rammen kommer fra bjelkene, kan profilet IKKE lenger være gavlfasadens
// taklinje: den er målt langs fasadens egen akse, og bjelkeaksen trenger ikke
// være den samme. Overkanten leses derfor av bjelkene selv, bøttet langs u —
// samme framgangsmåte som taklinjerFraModell bruker mot fasadene.
//
// `takLinje` gjør resten: øvre hylle, støy under toleransen kastet, og flatt
// tak lagt vannrett. Den er skrevet, testet og i bruk fra runde 20 — å skrive
// en ny her ville vært samme regel to steder.
export function takProfilFraBjelker(ramme, bjelker, baseY) {
  const botte = tilScene(TAK_BOTTE_MM) || 0.1;
  const per = new Map();
  for (const { b } of bjelker || []) {
    // begge endene av bjelken, med sin egen overkant
    for (const px of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z]) {
      const [u] = tilUV(ramme, px, pz);
      const k = Math.round(u / botte);
      const e = per.get(k);
      if (!e || b.max.y > e[1]) per.set(k, [u, b.max.y]);
    }
  }
  const punkter = [...per.values()].map(([u, y]) => [tilMm(u), tilMm(y - baseY)]);
  return takLinje(punkter, TAK_TOL_MM);
}

// Alt taket trenger, regnet ferdig. Null når det ikke går an.
// Hvorfor takflata ikke kunne bygges — i klartekst til panelet. Et tomt svar
// uten grunn er det samme som ingen hjelp.
export let takGrunn = "";

export function takData() {
  takGrunn = "";
  if (!lagret || !(lagret.fasader || []).length) { takGrunn = "ingen-fasader"; return null; }
  const o = takOppsett();
  const bjelker = takBjelker();
  if (bjelker.length) {
    const d = takDataFraStal(bjelker, o);
    if (d) return d;
  }
  // 🔑 Stålet er ikke lest inn ennå (eller ga ingen flater). Da tegnes det
  // LAGREDE taket — se settTakSnapshot over. Dette er grunnen til at taket nå
  // står der når modellen åpnes, uten at «Generer tak» må trykkes på nytt.
  const s = takSnapshot();
  if (s) { takGrunn = ""; return takDataFraLagret(s, o); }
  if (!bjelker.length) takGrunn = stalFinnes() ? "ingen-bjelker" : "ingen-meta";
  return null;
}

// Taket regnet av dagens stål. Null når det ikke går an — takGrunn sier hvorfor.
function takDataFraStal(bjelker, o) {
  // 🏗 FALLET LESES AV BJELKENE (Emils tips 18.09). Sperra bærer platene og
  // ligger allerede i fallet — leser vi retningen av den, kan takflata per
  // definisjon ikke havne på tvers av det som bærer den.
  // 🏗 «AUTOMATISK» (Emil 18.09): platene legger seg langs bjelkene, og hvert
  // sett parallelle bjelker i samme plan blir ETT takfall. Et valmtak gir fire
  // flater av seg selv — ingen taktype er kodet inn noe sted.
  if (o.fallFasade === "auto" || o.fallFasade === undefined || o.fallFasade === null) {
    const linjer = takBjelkeLinjer(bjelker, bjelker.map(x => x.id));
    let flater = takflaterFraBjelker(linjer, o);
    if (!flater.length) { takGrunn = "ingen-fall"; return null; }
    // 🔄 «Roter takflata 90°» (Emil 21.09, bilde 4). Rotasjonen skjer FØR
    // åsene finnes: etter en rotasjon er det andre bjelker som ligger på
    // tvers, og dermed andre steder en skjøt kan hvile.
    if (o.rotert) flater = roterFlater(flater);
    // 🔩 Hver flate bærer sine egne åser — de bjelkene som ligger i flata og
    // går på tvers av fallet. Uten dem er det ingenting å skru en skjøt i.
    flater = flater.map(f => ({ ...f, skjotU: skjotBjelker(f, linjer, o), aserL: aserVerden(f, linjer, o) }));
    // 🔁 SIST: begge takhalvdelene legges samme vei, og to halvdeler som deler
    // et møne deler også radrutenettet. MÅ stå etter rotasjonen og etter at
    // åsene er funnet — se kommentaren over takflaterFraBjelker i js/sw-tak.js.
    flater = deltRadrutenett(ensrettFlater(flater), o);
    settTakSnapshot({ auto: true, flater, bjelker: bjelker.length, linjer: linjer.length });
    return autoData(flater, o,
      { fraStal: true, auto: true, bjelker: linjer.length, flater: flater.length },
      bjelker.length);
  }
  const fall = fallRetningFraBjelker(bjelkeBokserMm(bjelker), o.minHellingProsent);
  const ramme = takRamme(lagret.fasader, o.fallFasade, o, fall);
  if (!ramme) { takGrunn = "ingen-ramme"; return null; }
  const punkter = takPunkter(ramme, bjelker);
  if (!punkter.length) { takGrunn = "ingen-bjelker"; return null; }
  const rekt = takRektangel(punkter, o.utstikkGesimsMm, o.utstikkGavlMm);
  if (!rekt) { takGrunn = "ingen-rektangel"; return null; }
  const baseY = baseYNaa();
  // Profilet leses av bjelkene når rammen gjør det — ellers ville høyden vært
  // målt langs en annen akse enn flata.
  const profil = ramme.fraStal
    ? takProfilFraBjelker(ramme, bjelker, baseY)
    : ramme.profil;
  const flattHoyde = flattToppMm(baseY);
  const flater = takFlater(rekt, profil, { ...o, flattHoydeMm: flattHoyde });
  settTakSnapshot({ auto: false, flater, ramme, rekt, profil, bjelker: bjelker.length });
  return { ramme, rekt, flater, baseY, o, bjelker: bjelker.length, profil,
    liste: trpListe(flater, o), totaler: takTotaler(flater),
    medPlater: platerPaTaket(flater, o) };
}

// 🔧 HÅNDJUSTERINGENE legges på TIL SLUTT, oppå det regnede — samme
// rekkefølge som blikket. Flatene er fasit, og justeringene er et tillegg
// som overlever at de leses på nytt.
function autoData(flater, o, ramme, antBjelker) {
  const tt = takTilstand();
  const medPlater = justerPlater(platerPaTaket(flater, o), tt.just, tt.ekstra, o);
  return { auto: true, flater, baseY: baseYNaa(), o, bjelker: antBjelker, ramme,
    liste: trpListe(flater, o, medPlater), totaler: takTotaler(flater), medPlater };
}

// Taket tegnet av det som ligger lagret. Ingen tilgang til stål eller
// IFC-metadata i det hele tatt — det er nettopp poenget.
function takDataFraLagret(s, o) {
  if (s.auto) {
    const d = autoData(s.flater, o,
      { fraStal: true, auto: true, bjelker: s.linjer || 0, flater: s.flater.length },
      s.bjelker || 0);
    d.fraLagret = true;
    d.ramme.fraLagret = true;
    return d;
  }
  return { ramme: { ...(s.ramme || {}), fraLagret: true }, rekt: s.rekt,
    flater: s.flater, baseY: baseYNaa(), o, bjelker: s.bjelker || 0, profil: s.profil,
    liste: trpListe(s.flater, o), totaler: takTotaler(s.flater),
    medPlater: platerPaTaket(s.flater, o), fraLagret: true };
}

// 🔎 EMILS FUNN 18.09: «Fant ikke stål å bygge takflata av» på et bygg som
// tydelig HAR stål.
//
// `soyleTypeNavn(id)` leser typenavnet av IFC-metadataene, og de hentes
// ASYNKRONT fra IFC-tråden. `stalPaFasader` venter på dem:
//
//     if (!S.glbActive) await sikreMeta(alleElementIder);
//
// `takPunkter` gjorde ikke det. Laster man siden på nytt og henter
// SW-resultatet fra lagringen — uten å generere veggene om igjen — er
// metadataene aldri hentet i den sideinnlastingen. Da svarer `soyleTypeNavn`
// tom streng for HVERT element, ingen er «Beam», og taket finner ikke noe stål.
//
// «Generer tak» venter derfor på metadataene før den leter. Denne funksjonen
// svarer på om de er der, så panelet kan si hva som mangler i stedet for å
// påstå at bygget er uten stål.
export function stalFinnes() {
  const bokser = allElementBoxes();
  if (!bokser || !bokser.size) return false;
  for (const [id] of bokser)
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) !== -1) return true;
  return false;
}

// Stålets overkant i mm over SW-basen — høyden et flatt tak legges på.
function flattToppMm(baseY) {
  const bokser = allElementBoxes();
  let toppY = -Infinity;
  for (const [id, b] of (bokser || [])) {
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    if (b.max.y > toppY) toppY = b.max.y;
  }
  return Number.isFinite(toppY) ? tilMm(toppY - baseY) : 0;
}

// ───────────────────── tegningen ─────────────────────
//
// Hver TRP-plate er en ribbon: trapesprofilen strukket ned fallet. Platen
// ligger i sitt eget takfalls plan, så den er RETT — ingen plate bøyes over
// mønet, og det er nettopp derfor sw-tak.js deler taket i ett plan per fall.

const matBuffer = new Map();
function takMat(farge) {
  if (!matBuffer.has(farge))
    matBuffer.set(farge, new THREE.MeshLambertMaterial({ color: farge,
      side: THREE.DoubleSide, flatShading: true }));
  return matBuffer.get(farge);
}

// Ett punkt på takflata: (u, v) i mm → verden.
//
// I «Automatisk» har HVER FLATE sin egen ramme — U opp fallet i rommet, V
// vannrett på tvers, alt målt fra flatas eget origo. Da ligger platene i
// flatas plan uansett hvilken vei den faller, og et valmtak blir riktig uten
// at noen retning er gjettet.
function P(data, uMm, vMm, hMm, flate) {
  if (data.auto && flate && flate.U) {
    const o = flate.origo, U = flate.U, V = flate.V;
    const h = tilScene(Number(hMm) || 0);
    // 🔎 EMILS FUNN 21.09: «TRP-plater legger seg oppå bjelke og ikke inne i
    // toppen av bjelken — samme problemet som blikk hadde tidligere med at det
    // blir hakkete og kommer hull.»
    //
    // Flatas origo ER bjelkas overkant (bjelkeLinje tar det høyeste punktet i
    // hver ende), så platas underside lå nøyaktig i samme plan som bjelkas
    // toppflate. To flater i samme plan gir z-fighting: nettleseren vet ikke
    // hvilken som er foran, og du ser gjennom taket i flekker. Nøyaktig samme
    // sak som blikkets lokk hadde 18.09.
    //
    // Platene løftes derfor `plateOverMm` langs flatas NORMAL — ikke rett opp,
    // for da ville løftet blitt mindre jo brattere taket er.
    const N = flate.N;
    const ov = tilScene(Number(data.o && data.o.plateOverMm) || 0);
    const nx = N ? N.x * ov : 0, ny = N ? N.y * ov : ov, nz = N ? N.z * ov : 0;
    return new THREE.Vector3(
      tilScene(o.x + U.x * uMm + V.x * vMm) + nx,
      tilScene(o.y + U.y * uMm + V.y * vMm) + ny + h,
      tilScene(o.z + U.z * uMm + V.z * vMm) + nz);
  }
  const p = fraUV(data.ramme, tilScene(uMm), tilScene(vMm));
  return new THREE.Vector3(p.x, data.baseY + tilScene(hMm), p.z);
}

// Høyden på en flate ved u — rett interpolasjon, flata er et plan.
// I «Automatisk» ligger høyden i U-vektoren selv, så her er den 0.
function hVed(flate, uMm) {
  if (flate && flate.U) return 0;
  const d = flate.u1 - flate.u0;
  if (!(Math.abs(d) > 1e-6)) return flate.h0;
  const k = (Number(uMm) - flate.u0) / d;
  return flate.h0 + (flate.h1 - flate.h0) * Math.max(0, Math.min(1, k));
}

// Én plate, tegnet som bølgeblikk i sitt eget plan.
//
// Profilen løper på TVERS av plata (langs v, langs mønet) og bølgene står opp
// fra takflata. Plata strekkes ned fallet fra uFra til uTil.
export function tegnPlate(data, flate, vFra, breddeMm, uFra, uTil, farge, legg, meta) {
  const mal = MALTYPER.trp;
  const prof = trpProfil(breddeMm, mal.deling, mal.profilHoyde);
  const pos = [];
  const pkt = (v, h, uu) => {
    const p = P(data, uu, vFra + v, hVed(flate, uu) + h, flate);
    pos.push(p.x, p.y, p.z);
  };
  // ✂ SKRÅKAPP MOT EN SKRÅ TOPPBJELKE (Emil 22.09). Enden er ikke lenger én
  // u-verdi: den løper fra uTilA ved v = 0 til uTilB ved v = bredden. Da følger
  // bølgene skråkanten helt ut, uten trappetrinn — samme grep som skråkappede
  // veggelementer fikk 08.09.
  const B = Math.max(1, Number(breddeMm) || 1);
  const skra = meta && meta.skra;
  // 🖼 KNEKKET KAPP (23.09): når omrisset har et hjørne inne i raden, følger
  // enden hvert knekkpunkt [v, u] — ellers den rette linja mellom sidene.
  const langs = (kurve, v) => {
    for (let i = 1; i < kurve.length; i++) {
      const a = kurve[i - 1], b = kurve[i];
      if (v <= b[0] || i === kurve.length - 1) {
        const d = b[0] - a[0];
        return d > 1e-9 ? a[1] + (b[1] - a[1]) * (v - a[0]) / d : b[1];
      }
    }
    return kurve[0][1];
  };
  const knekkTil = skra && Array.isArray(meta.kappTil) && meta.kappTil.length > 1;
  const knekkFra = skra && Array.isArray(meta.kappFra) && meta.kappFra.length > 1;
  const enden = (v) => knekkTil ? langs(meta.kappTil, v) : skra
    ? Number(meta.uTilA) + (Number(meta.uTilB) - Number(meta.uTilA)) * (v / B)
    : uTil;
  const starten = (v) => knekkFra ? langs(meta.kappFra, v) : skra
    ? Number(meta.uFraA) + (Number(meta.uFraB) - Number(meta.uFraA)) * (v / B)
    : uFra;
  // to trekanter per segment av profilen, strukket fra uFra til uTil
  for (let i = 1; i < prof.length; i++) {
    const [v0, h0] = prof[i - 1], [v1, h1] = prof[i];
    const a0 = starten(v0), a1 = starten(v1), b0 = enden(v0), b1 = enden(v1);
    pkt(v0, h0, a0); pkt(v1, h1, a1); pkt(v1, h1, b1);
    pkt(v0, h0, a0); pkt(v1, h1, b1); pkt(v0, h0, b0);
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, takMat(farge));
  m.userData.tak = true;
  if (meta) m.userData.takPlate = meta;
  legg(m);
  return m;
}

// Luft mellom bølgetoppen og merketeksten. Nok til at teksten står klart oppe
// på profilen, lite nok til at den ikke svever synlig over taket sett fra
// siden.
export const MERKE_KLARING_MM = 10;

// 🏷 MERKINGEN PÅ EN TRP-PLATE (Emil 22.09): «samme merking som veggelement
// — dimensjon i senter og nummer/navn oppe i hjørnet.»
//
// Dekalene legges FLATT PÅ TAKET, i flatas eget plan, akkurat som
// veggmerkingen ligger på elementflaten. Ikke svevende skjermlapper: de fløt
// over alt og ble uleselige (Emils runde 4 og 5 på veggene). Aksene er
// flatas egne — V på tvers, U opp fallet, N ut av taket — så teksten står
// rett vei uansett hvilken retning taket faller.
function merkPlate(data, flate, naa, kode, legg) {
  if (!flate || !flate.U || !flate.V || !flate.N) return;
  const U = flate.U, V = flate.V, N = flate.N;
  const lengde = Math.abs(Number(naa.uTil) - Number(naa.uFra));
  const bredde = Number(naa.breddeMm) || 0;
  if (!(lengde > 0) || !(bredde > 0)) return;
  // 🔎 EMILS FUNN 22.09 (bilde 1–3): «skriften står vertikalt GJENNOM
  // TRP-plata i stedet for oppå flaten.»
  //
  // Basisen var (V, U, N) rett fra flata. Etter «Roter takflata 90°» bytter
  // U og V plass — og å bytte to akser SNUR HÅNDSVINGEN. Matrisen fikk
  // determinant −1, altså en speiling, og `setFromRotationMatrix` er ikke
  // definert for speilinger: den ga en tilfeldig rotasjon, og dekalen stilte
  // seg på høykant tvers gjennom plata.
  //
  // Nå regnes den tredje aksen ut av de to andre i stedet for å antas.
  // Kryssproduktet er høyrehendt per definisjon, så en speiling kan ikke
  // oppstå. Peker resultatet ned i taket, snus X — da står teksten fortsatt
  // oppover fallet, men vi ser den fra oversiden.
  const aX = new THREE.Vector3(V.x, V.y, V.z).normalize();
  const aY = new THREE.Vector3(U.x, U.y, U.z).normalize();
  const aZ = new THREE.Vector3().crossVectors(aX, aY).normalize();
  if (aZ.dot(new THREE.Vector3(N.x, N.y, N.z)) < 0) {
    aX.negate();
    aZ.crossVectors(aX, aY).normalize();
  }
  const kvat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(aX, aY, aZ));
  const uMid = (Number(naa.uFra) + Number(naa.uTil)) / 2;
  // 🔎 EMILS FUNN 22.09 (bilde 2): «merketeksten drukner i bølgene.»
  //
  // P() med h = 0 gir BUNNEN av bølgedalen — bølgetoppene står profilHoyde
  // høyere. Løftet var et fast tall på 6 mm, altså godt nede i dalen, og
  // teksten lå og blinket mellom bølgetoppene.
  //
  // Nå leses løftet av profilen selv. Da følger merkingen med hvis
  // profilhøyden endres — et fast tall måtte vært rettet to steder, og det
  // ene ville blitt glemt.
  const løftMm = (Number(MALTYPER.trp.profilHoyde) || 0) + MERKE_KLARING_MM;
  const sett = (m, uMm, vMm) => {
    const p = P(data, uMm, vMm, 0, flate);
    const løft = tilScene(løftMm);
    m.position.set(p.x + aZ.x * løft, p.y + aZ.y * løft, p.z + aZ.z * løft);
    m.quaternion.copy(kvat);
    m.renderOrder = 3;
    legg(m);
  };
  const maks = tilScene(Math.min(lengde, bredde));
  // dimensjonen i senter — samme form som veggene: «4853×5521MM», og på et
  // skråkapp med BEGGE endemålene og vinkelen: «6150/5400×6000MM 27,6°»
  const lTekst = naa.skra
    ? Math.round(Number(naa.lengdeVMm)) + "/" + Math.round(Number(naa.lengdeHMm))
    : String(Math.round(lengde));
  const vTekst = naa.skra ? " " + vinkelTekstTak(naa.vinkel) : "";
  sett(tekstDekal(lTekst + "×" + Math.round(bredde) + "MM" + vTekst, 150, maks * 0.7),
    uMid, Number(naa.vFra) + bredde / 2);
  // koden oppe i hjørnet, mot den høye enden
  if (kode)
    sett(tekstDekal(kode, 220, maks * 0.45),
      uMid + (Number(naa.uTil) - uMid) * 0.62, Number(naa.vFra) + bredde * 0.22);
}

export function tegnTak() {
  const sk = skjulNaa();
  if (sk.tak) return;
  if (!takPa()) return;
  const data = takData();
  if (!data) return;
  // kode per størrelse — den SAMME lista bunkene på bakken bygges av
  const koder = new Map();
  for (const pl of (data.liste && data.liste.plater) || [])
    koder.set(pl.navn, pl.kode);
  nullstillTakMesh();
  let naa = null;
  const legg = (m) => {
    m.userData.tak = true;
    if (naa) { m.userData.trpId = naa.id; husTakMesh(naa.id, m, naa); }
    swGroup.add(m);
  };
  const farge = data.o.farge || "#8fa3b8";
  const ov = Number(data.o.endeOverlappMm) || 0;

  for (let fi = 0; fi < data.medPlater.length; fi++) {
    const f = data.medPlater[fi];
    if (!f) continue;
    // fallretningen: u0 → u1 er nedover når h0 > h1. Platene legges fra den
    // LAVE enden og opp, for det er slik stabelen leses (gesims → møne) og
    // slik de monteres (steg 6: neste runde skjøtes inn på forrige).
    const nedover = f.h1 <= f.h0;
    const uLav = nedover ? f.u1 : f.u0;
    const retning = nedover ? -1 : 1;     // fra lav ende mot høy, i u
    // den vannrette lengden per mm skrå lengde — profilet er skrått, og
    // platelengdene er målt I PLANET
    const skala = f.lengdeMm > 0 ? Math.abs(f.u1 - f.u0) / f.lengdeMm : 1;
    for (const rad of f.rader) {
      let sPlan = 0;                      // hvor langt opp fallet vi har kommet
      for (let pi = 0; pi < rad.plater.length; pi++) {
        const p = rad.plater[pi];
        // 🔧 Etter en justering er platas EGEN u-strekning fasit — vi kan
        // ikke lenger legge dem etter hverandre fra bunnen av.
        const harU = Number.isFinite(Number(p.uFra)) && Number.isFinite(Number(p.uTil));
        const ua = harU ? Number(p.uFra) : uLav + retning * sPlan * skala;
        const ub = harU ? Number(p.uTil) : uLav + retning * (sPlan + p.lengdeMm) * skala;
        naa = { id: p.id || plateId(fi, rad, p), flate: fi, vFra: rad.vFra,
          breddeMm: rad.breddeMm, uFra: ua, uTil: ub, lengdeMm: p.lengdeMm,
          lagtTil: !!p.lagtTil,
          // ✂ skråkappet følger med til tegningen og til merkingen
          skra: !!p.skra, lengdeVMm: p.lengdeVMm, lengdeHMm: p.lengdeHMm,
          uFraA: p.uFraA, uFraB: p.uFraB, uTilA: p.uTilA, uTilB: p.uTilB,
          kappFra: p.kappFra, kappTil: p.kappTil,
          vinkel: p.vinkel,
          // rammen følger med, så «Juster TRP» kan regne seg tilbake til u
          U: f.U, V: f.V, N: f.N, origo: f.origo };
        tegnPlate(data, f, rad.vFra, rad.breddeMm, ua, ub,
          p.kort ? "#c05a5a" : (p.lagtTil ? "#7fae7f" : farge), legg, naa);
        if (!sk.merking && data.auto)
          merkPlate(data, f, naa, koder.get(plateNokkel(p.lengdeMm, rad.breddeMm, p)), legg);
        naa = null;
        sPlan = sPlan + p.lengdeMm - ov;
      }
    }
  }
}


// ───────────────── 📦 TRP-BUNKENE RUNDT BYGGET ─────────────────
//
// Emil 21.09: «vi må legge til at TRP-plate og blikk kommer opp som
// materiellbunker rundt bygget, på samme måte som SW-generatoren gjør.»
//
// Én bunke per PLATESTØRRELSE, ikke per takflate: to flater som begge bruker
// TRP 6000 skal bestilles som én haug med 6000-plater. Det er nøyaktig samme
// gruppering som lista i Excel bruker (trpListe → plater), så bunken og
// bestillingen kan ikke komme i utakt.
export function byggTakStabler() {
  if (!lagret) return;
  const tt = takTilstand();
  const forrige = lesStabelPosisjonerAlle(S.materiell, new Set(tt.materiellIder || []));
  fjernTakMateriell();
  if (!takPa()) return;
  const data = takData();
  if (!data || !data.liste || !(data.liste.plater || []).length) return;
  const f = (lagret.fasader || [])[0];
  if (!f) return;
  const okBetong = lagret.okBetong || 0;
  const nyeIder = [];
  let i = 0;
  for (const pl of data.liste.plater) {
    const pkt = vaskMateriell({
      id: "TRP-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "trp", navn: pl.navn, farge: data.o.farge || "#8fa3b8",
      lengde: pl.lengdeMm, bredde: pl.breddeMm, antall: pl.antall,
      ...bunkePlass(f, okBetong, 1, i++, pl.lengdeMm, 2000)
    });
    settStabelTilbakeAlle(pkt, forrige);
    if (pkt) { nyeIder.push(pkt.id); S.materiell = (S.materiell || []).concat([pkt]); }
  }
  takTilstand().materiellIder = nyeIder;
  skrivLagret();
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// Rydder BARE takets egne bunker, og gjør det på ID — aldri på navnet. En
// TRP-bunke Emil har lagt inn selv i Materiell heter gjerne «TRP 6000» den
// også, og den skal ikke forsvinne fordi taket ble generert på nytt.
export function fjernTakMateriell() {
  const ider = new Set((lagret && lagret.tak && lagret.tak.materiellIder) || []);
  if (!ider.size) return;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(p => !ider.has(p.id));
  if (lagret && lagret.tak) lagret.tak.materiellIder = [];
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// ───────────────────── panelet ─────────────────────
//
// Samme oppsett som «Blikk» fikk i runde 2b, som igjen er SW-generatorens.

export function takPanelHtml() {
  if (!lagret || !(lagret.vegger || []).length)
    return "<p class='hint'>" + esc(t("Generer veggelementene først.")) + "</p>";
  const data = takData();
  const o = takOppsett();
  const pa = takPa();
  // 🔎 EMILS FUNN 21.09 («takplater er helt feil»): åtte håndjusteringer fra
  // en tidligere prøverunde lå igjen og ble lagt oppå hver eneste gang. Uten
  // justeringene: 14 plater à 5521. Med dem: 8466, 3746, 3581, 3291, 2961,
  // 2786, 2346, 1996 — og ingenting i panelet sa at de fantes.
  //
  // Blikket har sagt fra om dette siden runde 2b. Taket gjorde det ikke, og
  // det er hele grunnen til at feilen så ut som en regnefeil.
  const tt0 = takTilstand();
  const antJust = Object.keys(tt0.just || {}).length + (tt0.ekstra || []).length;
  const vis = (x) => (typeof x === "number" && !Number.isInteger(x))
    ? x.toFixed(2).replace(".", ",") : String(x);
  const rad = (navn, verdi, enhet) =>
    "<tr><td>" + esc(t(navn)) + "</td><td style='text-align:right'>" +
    esc(vis(verdi)) + (enhet ? " " + esc(enhet) : "") + "</td></tr>";

  let topp = "";
  if (!data) {
    const grunn = takGrunn === "ingen-meta"
      ? t("Stålet er ikke lest inn ennå. Trykk «Generer tak» — den henter det først.")
      : takGrunn === "ingen-bjelker"
        ? t("Fant stål, men ingen bjelker øverst å bygge takflata av.")
      : takGrunn === "ingen-fall"
        ? t("Ingen av takbjelkene ligger med fall. Velg fallretning selv nedenfor.")
        : t("Fant ikke stål å bygge takflata av. Taket bygges av de øverste bjelkene.");
    topp = "<p class='hint'>" + esc(grunn) + "</p>";
  } else {
    const L = data.liste, T2 = data.totaler, r = data.ramme;
    topp = (data.fraLagret
      ? "<p class='hint'>" + esc(t("Taket er tegnet av det lagrede resultatet — stålet er ikke lest inn i denne økta. Trykk «Generer tak» hvis modellen er endret.")) + "</p>"
      : "") +
      "<p class='hint'>" + esc(r.auto
        ? t("Platene følger bjelkene: {0} takflater av {1} bjelker. Ingen retning er gjettet.", r.flater, r.bjelker)
        : r.fraStal
        ? t("Fallet leses av {0} takbjelker — de ligger allerede i fallet.", r.bjelker)
        : r.flatt
          ? t("Taket er flatt. Fallretningen settes nedenfor, og fallprosenten bestemmer hvor mye det heller.")
          : t("Fallet leses av gavlfasaden — {0} mm fra raft til møne.", vis(r.variasjon))) + "</p>" +
      // 🔩 HVOR SKJØTENE KAN LIGGE, sagt rett ut. Emil 21.09: «det er masse
      // små plater som skjøtes midt i lufta.» Det skal han se FØR han taster
      // lengder, ikke oppdage etterpå i 3D.
      aseTekst(data) +
      "<h4 data-sek='takmengder'>" + esc(t("Takmengder")) + "</h4>" +
      "<table class='swtab'><tbody>" +
      rad("Takflater", T2.flater, "") +
      rad("Takareal", T2.arealM2, "m²") +
      rad("Lengste fall", T2.lengsteFallMm, "mm") +
      rad("Antall TRP-plater", L.antall, "stk") +
      rad("Skjøt", L.skjotLm, "lm") +
      rad("Skrue skjøt", L.skruer, "stk") +
      "</tbody></table>" +
      (L.advarsel
        ? "<p class='hint' style='color:var(--warn,#c05a5a)'>" + esc(t(
            "{0} plater blir kortere enn 500 mm. Platelengdene går ikke opp med overlappen — juster stabelen.",
            L.korte)) + "</p>"
        : "") +
      // 🚛 TRANSPORTGRENSA SIER FRA, DEN DELER IKKE (Emil 22.09: «jeg er enig
      // i at den kan bli rød»). Delte koden selv, havnet skjøten i løse lufta.
      (L.overMaks
        ? "<p class='hint' style='color:var(--warn,#c05a5a)'>" + esc(t(
            "{0} plater er lengre enn transportgrensa på {1} mm (lengste {2} mm). Bjelkene gir ingen skjøt før der — tast platelengder selv hvis de må deles, eller bestill spesialtransport.",
            L.overMaks, Math.round(Number((data.o && data.o.maksLengdeMm) || 0)), L.lengsteMm)) + "</p>"
        : "") +
      // 🔎 EMILS FUNN 22.09: strimlene langs kanten er borte — men de er
      // ikke bortforklart. Står det igjen en rest smalere enn én bølge, sier
      // panelet hvor mye, så Emil selv kan avgjøre om den skal dekkes.
      (() => {
        const rester = (data.medPlater || [])
          .map(f => Math.round(Number(f.restMm) || 0)).filter(x => x > 0);
        return rester.length
          ? "<p class='hint'>" + esc(t(
              "Ytterste kant står udekket med {0} mm. Resten er smalere enn én bølge og kan ikke lappes over naboplata — det meste av den er utstikket på flata.",
              rester.join(" / "))) + "</p>"
          : "";
      })() +
      "<h4 data-sek='takplater'>" + esc(t("Platene")) + "</h4>" +
      "<table class='swtab'><tbody>" +
      L.plater.map(p => "<tr><td>" + esc(p.navn) + "</td><td style='text-align:right'>" +
        esc(String(p.antall)) + " " + esc(t("stk")) + "</td></tr>").join("") +
      "</tbody></table>";
  }

  // fallretning: hvilken fasade fallet løper langs
  const auto = o.fallFasade === "auto" || o.fallFasade === null || o.fallFasade === undefined;
  const valgt = !auto && o.fallFasade !== "";
  const fasadeValg = (lagret.fasader || []).map((f, i) =>
    "<option value='" + i + "'" + (valgt && Number(o.fallFasade) === i ? " selected" : "") + ">" +
    esc(f.navn || t("Fasade {0}", i + 1)) + "</option>").join("");

  return topp +
    "<h4 data-sek='takmal'>" + esc(t("Takoppsett")) + "</h4>" +
    "<label>" + esc(t("Farge")) + "<input type='color' id='takFarge' value='" +
      esc(o.farge || "#8fa3b8") + "'></label>" +
    "<label class='swfelt'><span>" + esc(t("Fallretning")) + "</span>" +
      "<select id='takFallFasade'>" +
      "<option value='auto'" + (auto ? " selected" : "") + ">" +
        esc(t("Automatisk — platene følger bjelkene")) + "</option>" +
      "<option value=''" + (!auto && o.fallFasade === "" ? " selected" : "") + ">" +
        esc(t("Finn selv (gavlfasaden)")) + "</option>" +
      fasadeValg + "</select></label>" +
    // 📐 Platelengdene: SAMME system som radhøydene i SW-generatoren (Emil
    // 18.09), bare at stabelen legges HENOVER taket i stedet for oppover.
    "<label>" + esc(t("Platelengder fra gesimsen og opp (mm) — tom = automatisk")) +
      "<input type='text' id='takPlatelengder' maxlength='200' value='" +
      esc(o.platelengder || "") + "'></label>" +
    "<p class='hint'>" + esc(t("Tom = platene deles av bjelkene: én skjøt på hver ås, ingen andre steder. Skriver du tall — f.eks. «6000, 5500, 6000, 5000» — blir platene akkurat de lengdene etter hverandre, fra gesimsen og opp. Siste lengde gjentas hvis fallet er lengre, og tallene er DEKNING: overlappen kommer i tillegg.")) + "</p>" +
    TAK_FELT.map(([id, tekst]) =>
      "<label class='swfelt'><span>" + esc(t(tekst)) + "</span>" +
      "<input id='tf_" + id + "' type='number' step='any' min='0' value='" +
      esc(String(o[id])) + "'></label>").join("") +
    // 🔄 Emil 21.09, bilde 4: «vi legger inn en enkel roter-knapp som endrer
    // retningen taket legger seg i.»
    "<div class='prop-actions' data-sw-fast style='margin-top:10px;flex-wrap:wrap'>" +
    "<button id='takRoter'" + (pa ? "" : " disabled") + ">" + ikon("juster") + " " +
      esc(t("Roter takflata 90°")) + (o.rotert ? " ✓" : "") + "</button></div>" +
    "<div class='prop-actions' data-sw-fast style='margin-top:10px;flex-wrap:wrap'>" +
    "<button id='takGenerer' class='primary'>" + ikon("boks") + " " + esc(t("Generer tak")) + "</button>" +
    "<button id='takJusterBtn'" + (pa ? "" : " disabled") + ">" + ikon("juster") + " " +
      esc(t("Juster TRP")) + "</button>" +
    "<button id='takNullstillJust'" + (antJust ? "" : " disabled") + ">" + ikon("nullstill") + " " +
      esc(t("Nullstill justeringer ({0})", antJust)) + "</button>" +
    "<button id='takListe'" + (pa ? "" : " disabled") + ">" + ikon("lastned") + " " +
      esc(t("Last ned liste (Excel)")) + "</button>" +
    "<button id='takFjern'" + (pa ? "" : " disabled") + ">" + ikon("slett") + " " +
      esc(t("Fjern genererte")) + "</button></div>" +
    takLagredeHtml() +
    (pa ? "<p class='hint'>" + esc(antJust
            ? t("Taket er generert og følger stålet. {0} håndjusteringer ligger OPPÅ det regnede — de er grunnen hvis platelengdene ikke er de du taster.", antJust)
            : t("Taket er generert og følger stålet av seg selv.")) + "</p>"
        : "<p class='hint'>" + esc(t("Trykk «Generer tak» for å legge takflata på bygget.")) + "</p>");
}

// 💾 Lagrede takresultater — samme seksjon som blikket har (Emil 22.09).
function takLagredeHtml() {
  const lagrede = lesTakLagrede();
  return "<h4 data-sek='taklagrede' style='margin:14px 0 4px'>" + esc(t("Lagrede takresultater")) + "</h4>" +
    "<p class='hint'>" + esc(t("Gi oppsettet et navn og lagre det. Trykk på navnet senere for å legge samme platelengder og håndjusteringer på bygget igjen.")) + "</p>" +
    "<p class='hint'>" + esc(takLagringsTekst()) + "</p>" +
    "<div class='prop-actions sw-lagre'>" +
      "<input type='text' id='takLagreNavn' maxlength='60' placeholder='" +
      esc(t("Navn på resultatet")) + "'>" +
      "<button id='takLagreBtn'>" + ikon("lagre") + " " + esc(t("Lagre")) + "</button></div>" +
    (lagrede.length
      ? lagrede.map(pst =>
        "<div class='qty-row'><div class='n' style='font-size:12px'>" +
          "<button class='sw-last' data-tak-last='" + esc(pst.navn) + "'>" + esc(pst.navn) + "</button>" +
          " <span style='color:var(--muted);font-size:11px'>" +
          esc([pst.dato, pst.antall ? t("{0} justeringer", pst.antall) : "", pst.av || ""].filter(Boolean).join(" · ")) +
          "</span></div>" +
        "<div class='c'><button data-tak-slett='" + esc(pst.navn) + "' title='" + esc(t("Slett")) +
        "' style='padding:3px 8px'>" + ikon("slett") + "</button></div></div>").join("")
      : "<p class='hint'>" + esc(t("Ingen lagrede resultater ennå.")) + "</p>");
}

// Åsene, i klartekst: hvor stabelen kan skjøtes, og hva som skjer når det
// ikke finnes en eneste ås å skjøte på.
function aseTekst(data) {
  const F = (data && data.flater) || [];
  if (!F.length || !F[0].U) return "";
  // 🔄 ETTER EN ROTASJON LIGGER PLATENE PÅ TVERS AV VANNVEIEN.
  //
  // Emil ba om knappen, og han skal ha den. Men en endeskjøt på en plate som
  // ligger vannrett har vann stående i overlappen, og det er en lekkasje —
  // ikke en smakssak. Derfor står det rødt i panelet så lenge rotasjonen er
  // på og den nye fallretningen er flat. Sagt høyt, ikke sperret.
  const flatt = F.every(f => Math.abs(Number(f.fallGrader) || 0) < 0.3);
  const advarsel = (data.o && data.o.rotert && flatt)
    ? "<p class='hint' style='color:var(--warn,#c05a5a)'>" + esc(t(
        "Takflata er rotert 90°. Platene ligger nå PÅ TVERS av fallet, og en endeskjøt får vann stående i overlappen. Roter tilbake hvis platene skal følge vannveien.")) + "</p>"
    : "";
  return advarsel + aseLinje(F, data);
}

function aseLinje(F, data) {
  // samme funksjon som snappingen bruker — panelet kan ikke liste en ås
  // snappingen ser bort fra
  const per = F.map(f => indreAser(f, data.o).map(Math.round));
  const med = per.filter(l => l.length).length;
  // 🔎 Emil 21.09: modellen har oftest ingen åser i takplanet. Da STÅR
  // platelengdene hans — men han skal vite at ingen har kontrollert at
  // skjøtene treffer stål.
  if (!med)
    return "<p class='hint' style='color:var(--warn,#c05a5a)'>" + esc(t(
      "Ingen åser på tvers er modellert i takplanet. Da er det ingenting å skjøte i, og hvert fall blir én plate. Taster du platelengder selv, står de som du skriver dem — men skjøtene er IKKE kontrollert mot stål. Sjekk mot arbeidstegning, eller roter takflata hvis platene skal ligge den andre veien.")) + "</p>";
  const forste = per.find(l => l.length) || [];
  const egne = data.o && String(data.o.platelengder || "").trim();
  return "<p class='hint'>" + esc(egne
    ? t("Åser på tvers, målt opp fallet: {0} mm ({1} av {2} takflater har åser). Du har tastet platelengder selv — dine tall vinner, og skjøtene ligger der du sier.",
        forste.join(", "), med, F.length)
    : t("Åser på tvers, målt opp fallet: {0} mm ({1} av {2} takflater har åser). Platene skjøtes på hver av dem — én skjøt per ås, ingen andre steder.",
        forste.join(", "), med, F.length)) + "</p>";
}

// Seksjonen kobles opp av tegnBlikkPanel() — «Blikk & Tak» er ÉTT verktøy med
// to seksjoner (vedtatt spesifikasjon §1), ikke to knapper.
export function koblTakPanel(paaNytt) {
  const les = () => {
    const ny = {};
    for (const [id] of TAK_FELT) {
      const e = $("tf_" + id);
      const v = e ? Number(e.value) : NaN;
      ny[id] = Number.isFinite(v) && v >= 0 ? v : TAK_STD[id];
    }
    const f = $("takFarge");
    if (f) ny.farge = f.value;
    const pl = $("takPlatelengder");
    if (pl) ny.platelengder = pl.value;
    ny.rotert = !!takOppsett().rotert;     // knappen eier den, ikke feltene
    const ff = $("takFallFasade");
    ny.fallFasade = !ff ? "auto"
      : ff.value === "auto" ? "auto"
      : ff.value === "" ? "" : Number(ff.value);
    settTakOppsett(ny);
    tegnAlt();
    if (paaNytt) paaNytt();
  };
  for (const id of ["takFarge", "takPlatelengder", "takFallFasade"])
    if ($(id)) $(id).onchange = les;
  if ($("takRoter")) $("takRoter").onclick = () => {
    settTakOppsett({ rotert: !takOppsett().rotert });
    tegnAlt();
    byggTakStabler();
    if (paaNytt) paaNytt();
  };
  for (const [id] of TAK_FELT) if ($("tf_" + id)) $("tf_" + id).onchange = les;
  if ($("takGenerer")) $("takGenerer").onclick = async () => {
    if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
    const b = $("takGenerer");
    if (b) b.disabled = true;
    try {
      // 🔑 METADATAENE FØRST. Uten dem er hvert typenavn tomt, og taket finner
      // ikke et eneste stål — se stalFinnes(). Dette er den ENESTE grunnen
      // til at knappen er asynkron.
      if (!S.glbActive) {
        const { sikreMeta } = await import("../ifcrpc.js");
        const { alleElementIder } = await import("../ifc.js");
        await sikreMeta(alleElementIder);
      }
      takTilstand().pa = true;
      skrivLagret();
      tegnAlt();
    } catch (err) {
      console.warn("Taket kunne ikke genereres:", err);
      alert(t("Klarte ikke å hente stålet: ") + (err && err.message || err));
    } finally {
      const b2 = $("takGenerer");
      if (b2) b2.disabled = false;
      if (paaNytt) paaNytt();
    }
  };
  if ($("takFjern")) $("takFjern").onclick = () => {
    const tt = takTilstand();
    const antJust = Object.keys(tt.just || {}).length + (tt.ekstra || []).length;
    if (antJust && !confirm(t("Fjerne taket? De {0} håndjusteringene forsvinner også.", antJust)))
      return;
    if (takJust) { /* juster-modus står åpen */ }
    fjernTakMateriell();
    lagret.tak = { pa: false, just: {}, ekstra: [], nesteNr: 1, snap: null, materiellIder: [] };
    skrivLagret();
    tegnAlt();
    if (paaNytt) paaNytt();
  };
  if ($("takJusterBtn")) $("takJusterBtn").onclick = () => startTakJuster(paaNytt);
  // Justeringene alene — taket blir stående. Å måtte fjerne hele taket for å
  // bli kvitt åtte drag er ikke et valg noen skal måtte ta.
  if ($("takNullstillJust")) $("takNullstillJust").onclick = () => {
    const tt = takTilstand();
    const ant = Object.keys(tt.just || {}).length + (tt.ekstra || []).length;
    if (!ant) return;
    if (!confirm(t("Nullstille de {0} håndjusteringene? Taket blir stående.", ant))) return;
    tt.just = {};
    tt.ekstra = [];
    tt.nesteNr = 1;
    skrivLagret();
    tegnAlt();
    byggTakStabler();
    if (paaNytt) paaNytt();
  };
  if ($("takListe")) $("takListe").onclick = lastNedTakListe;
  if ($("takLagreBtn")) $("takLagreBtn").onclick = () =>
    lagreTakResultat(($("takLagreNavn") || {}).value, paaNytt);
  (document).querySelectorAll("button[data-tak-last]").forEach(b2 =>
    b2.onclick = () => lastInnTakResultat(b2.dataset.takLast, paaNytt));
  (document).querySelectorAll("button[data-tak-slett]").forEach(b2 =>
    b2.onclick = () => slettTakResultat(b2.dataset.takSlett, paaNytt));
}

// 📊 Arket «Tak». Samme form som «Blikk» og «Materiell».
export function takArk() {
  if (!takPa()) return null;
  const data = takData();
  if (!data) return null;
  const L = data.liste, T2 = data.totaler;
  const verdi = { flater: T2.flater, arealM2: T2.arealM2, antall: L.antall,
    skjotLm: L.skjotLm, skruer: L.skruer };
  const rader = [[t("Tak"), t("Verdi")]];
  for (const [navn, felt] of TAK_RADER) rader.push([t(navn), verdi[felt]]);
  rader.push([]);
  rader.push([t("Plate"), t("Antall")]);
  for (const p of L.plater) rader.push([p.navn, p.antall]);
  return { navn: t("Tak"), rader };
}

export function lastNedTakListe() {
  const ark = takArk();
  if (!ark) { alert(t("Trykk «Generer tak» først.")); return; }
  import("../elements.js").then(({ lastNedXlsxFlere }) => {
    const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
    return lastNedXlsxFlere(navn + " - Takliste.xlsx", [ark]);
  }).catch(err => {
    console.warn("Taklista kunne ikke lages:", err);
    alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
  });
}
