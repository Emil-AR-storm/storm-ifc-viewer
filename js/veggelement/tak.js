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
import { TAK_RADER, TAK_STD, platerPaFlate, takFlater, takRamme, takRektangel,
         tilUV, fraUV, trpListe, takTotaler } from "../sw-tak.js";
import { soyleTypeNavn, tilMm, tilScene } from "./regler.js";
import { allElementBoxes } from "../elements.js";
import { lagret, skrivLagret, swGroup } from "./tilstand.js";
import { baseYNaa, skjulNaa, tegnAlt } from "./tegning.js";
import { STAL_TYPER } from "./stal.js";

// ───────────────────── oppsettet ─────────────────────

export const TAK_FELT = [
  ["utstikkGesimsMm", "Utstikk gesims (mm)"],
  ["utstikkGavlMm", "Utstikk gavl (mm)"],
  ["trpBreddeMm", "TRP dekkende bredde (mm)"],
  ["endeOverlappMm", "Overlapp endeskjøt (mm)"],
  ["maksLengdeMm", "Maks platelengde (mm)"],
  ["skrueAvstandMm", "Skrueavstand i skjøt (mm)"],
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
export const TAK_STD_TILSTAND = { pa: false };
export function takTilstand() {
  if (!lagret) return { ...TAK_STD_TILSTAND };
  if (!lagret.tak || typeof lagret.tak !== "object") lagret.tak = { ...TAK_STD_TILSTAND };
  return lagret.tak;
}
export function takPa() { return !!(lagret && takTilstand().pa); }

// ───────────────────── de øverste bjelkene ─────────────────────
//
// Hvilke bjelker BÆRER taket? De som ligger øverst. Vi tar boksene til alt
// stålet, finner den høyeste overkanten, og beholder alt som når opp i
// nærheten av den — «nærheten» er takets egen høydevariasjon pluss en margin,
// for på et saltak ligger raftbjelken 2,4 m under mønebjelken og hører like
// fullt til taket.
//
// Returnerer punktene i (u, v), i MM, klare for takRektangel.
export function takPunkter(ramme, variasjonMm) {
  const bokser = allElementBoxes();
  if (!bokser || !bokser.size) return [];
  let toppY = -Infinity;
  const stal = [];
  for (const [id, b] of bokser) {
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    stal.push(b);
    if (b.max.y > toppY) toppY = b.max.y;
  }
  if (!stal.length) return [];
  // Marginen: takets egen variasjon + 1 m. På et flatt tak blir det 1 m, og da
  // er det bare takbjelkene som kommer med; på et saltak følger hele fallet med.
  const margin = tilScene(Math.max(0, Number(variasjonMm) || 0)) + 1 / (S.enhetSkala || 1);
  const ut = [];
  for (const b of stal) {
    if (b.max.y < toppY - margin) continue;
    for (const px of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z]) {
      const [u, v] = tilUV(ramme, px, pz);
      ut.push([tilMm(u), tilMm(v)]);
    }
  }
  return ut;
}

// Alt taket trenger, regnet ferdig. Null når det ikke går an.
// Hvorfor takflata ikke kunne bygges — i klartekst til panelet. Et tomt svar
// uten grunn er det samme som ingen hjelp.
export let takGrunn = "";

export function takData() {
  takGrunn = "";
  if (!lagret || !(lagret.fasader || []).length) { takGrunn = "ingen-fasader"; return null; }
  const o = takOppsett();
  const ramme = takRamme(lagret.fasader, o.fallFasade, o);
  if (!ramme) { takGrunn = "ingen-ramme"; return null; }
  const punkter = takPunkter(ramme, ramme.variasjon);
  if (!punkter.length) { takGrunn = stalFinnes() ? "ingen-toppbjelker" : "ingen-meta"; return null; }
  const rekt = takRektangel(punkter, o.utstikkGesimsMm, o.utstikkGavlMm);
  if (!rekt) { takGrunn = "ingen-rektangel"; return null; }
  // Et flatt tak har ingen taklinje å lese høyden av — da brukes stålets
  // overkant, som er nøyaktig der platene skal ligge.
  const baseY = baseYNaa();
  const flattHoyde = flattToppMm(baseY);
  const flater = takFlater(rekt, ramme.profil, { ...o, flattHoydeMm: flattHoyde });
  return { ramme, rekt, flater, baseY, o,
    liste: trpListe(flater, o), totaler: takTotaler(flater),
    medPlater: flater.map(f => platerPaFlate(f, o)).filter(Boolean) };
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
function P(data, uMm, vMm, hMm) {
  const p = fraUV(data.ramme, tilScene(uMm), tilScene(vMm));
  return new THREE.Vector3(p.x, data.baseY + tilScene(hMm), p.z);
}

// Høyden på en flate ved u — rett interpolasjon, flata er et plan.
function hVed(flate, uMm) {
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
    const p = P(data, uu, vFra + v, hVed(flate, uu) + h);
    pos.push(p.x, p.y, p.z);
  };
  // to trekanter per segment av profilen, strukket fra uFra til uTil
  for (let i = 1; i < prof.length; i++) {
    const [v0, h0] = prof[i - 1], [v1, h1] = prof[i];
    pkt(v0, h0, uFra); pkt(v1, h1, uFra); pkt(v1, h1, uTil);
    pkt(v0, h0, uFra); pkt(v1, h1, uTil); pkt(v0, h0, uTil);
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

export function tegnTak() {
  const sk = skjulNaa();
  if (sk.tak) return;
  if (!takPa()) return;
  const data = takData();
  if (!data) return;
  const legg = (m) => { m.userData.tak = true; swGroup.add(m); };
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
        const fra = sPlan, til = sPlan + p.lengdeMm;
        tegnPlate(data, f, rad.vFra, rad.breddeMm,
          uLav + retning * fra * skala, uLav + retning * til * skala,
          p.kort ? "#c05a5a" : farge, legg,
          { flate: fi, vFra: rad.vFra, lengdeMm: p.lengdeMm, kort: !!p.kort });
        sPlan = til - ov;                 // neste plate skjøtes inn på denne
      }
    }
  }
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
  const vis = (x) => (typeof x === "number" && !Number.isInteger(x))
    ? x.toFixed(2).replace(".", ",") : String(x);
  const rad = (navn, verdi, enhet) =>
    "<tr><td>" + esc(t(navn)) + "</td><td style='text-align:right'>" +
    esc(vis(verdi)) + (enhet ? " " + esc(enhet) : "") + "</td></tr>";

  let topp = "";
  if (!data) {
    const grunn = takGrunn === "ingen-meta"
      ? t("Stålet er ikke lest inn ennå. Trykk «Generer tak» — den henter det først.")
      : takGrunn === "ingen-toppbjelker"
        ? t("Fant stål, men ingen bjelker øverst å bygge takflata av.")
        : t("Fant ikke stål å bygge takflata av. Taket bygges av de øverste bjelkene.");
    topp = "<p class='hint'>" + esc(grunn) + "</p>";
  } else {
    const L = data.liste, T2 = data.totaler, r = data.ramme;
    topp =
      "<p class='hint'>" + esc(r.flatt
        ? t("Taket er flatt. Fallretningen settes nedenfor, og fallprosenten bestemmer hvor mye det heller.")
        : t("Fallet leses av gavlfasaden — {0} mm fra raft til møne.", vis(r.variasjon))) + "</p>" +
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
      "<h4 data-sek='takplater'>" + esc(t("Platene")) + "</h4>" +
      "<table class='swtab'><tbody>" +
      L.plater.map(p => "<tr><td>" + esc(p.navn) + "</td><td style='text-align:right'>" +
        esc(String(p.antall)) + " " + esc(t("stk")) + "</td></tr>").join("") +
      "</tbody></table>";
  }

  // fallretning: hvilken fasade fallet løper langs
  const valgt = o.fallFasade !== null && o.fallFasade !== undefined && o.fallFasade !== "";
  const fasadeValg = (lagret.fasader || []).map((f, i) =>
    "<option value='" + i + "'" + (valgt && Number(o.fallFasade) === i ? " selected" : "") + ">" +
    esc(f.navn || t("Fasade {0}", i + 1)) + "</option>").join("");

  return topp +
    "<h4 data-sek='takmal'>" + esc(t("Takoppsett")) + "</h4>" +
    "<label>" + esc(t("Farge")) + "<input type='color' id='takFarge' value='" +
      esc(o.farge || "#8fa3b8") + "'></label>" +
    "<label class='swfelt'><span>" + esc(t("Fallretning")) + "</span>" +
      "<select id='takFallFasade'><option value=''>" + esc(t("Finn selv (gavlfasaden)")) +
      "</option>" + fasadeValg + "</select></label>" +
    // 📐 Platelengdene: SAMME system som radhøydene i SW-generatoren (Emil
    // 18.09), bare at stabelen legges HENOVER taket i stedet for oppover.
    "<label>" + esc(t("Platelengder fra gesimsen og opp (mm) — tom = automatisk")) +
      "<input type='text' id='takPlatelengder' maxlength='200' value='" +
      esc(o.platelengder || "") + "'></label>" +
    "<p class='hint'>" + esc(t("Skriv stabelen fra gesimsen og opp mot mønet, f.eks. «6000, 6000, 3000». Siste lengde gjentas hvis fallet er lengre. Husk at hver skjøt spiser overlappen: to plater à 6000 med 150 mm overlapp dekker 11 850 mm, ikke 12 000.")) + "</p>" +
    TAK_FELT.map(([id, tekst]) =>
      "<label class='swfelt'><span>" + esc(t(tekst)) + "</span>" +
      "<input id='tf_" + id + "' type='number' step='any' min='0' value='" +
      esc(String(o[id])) + "'></label>").join("") +
    "<div class='prop-actions' style='margin-top:10px;flex-wrap:wrap'>" +
    "<button id='takGenerer' class='primary'>" + ikon("boks") + " " + esc(t("Generer tak")) + "</button>" +
    "<button id='takListe'" + (pa ? "" : " disabled") + ">" + ikon("lastned") + " " +
      esc(t("Last ned liste (Excel)")) + "</button>" +
    "<button id='takFjern'" + (pa ? "" : " disabled") + ">" + ikon("slett") + " " +
      esc(t("Fjern genererte")) + "</button></div>" +
    (pa ? "<p class='hint'>" + esc(t("Taket er generert og følger stålet av seg selv.")) + "</p>"
        : "<p class='hint'>" + esc(t("Trykk «Generer tak» for å legge takflata på bygget.")) + "</p>");
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
    const ff = $("takFallFasade");
    ny.fallFasade = ff && ff.value !== "" ? Number(ff.value) : null;
    settTakOppsett(ny);
    tegnAlt();
    if (paaNytt) paaNytt();
  };
  for (const id of ["takFarge", "takPlatelengder", "takFallFasade"])
    if ($(id)) $(id).onchange = les;
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
    takTilstand().pa = false;
    skrivLagret();
    tegnAlt();
    if (paaNytt) paaNytt();
  };
  if ($("takListe")) $("takListe").onclick = lastNedTakListe;
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
