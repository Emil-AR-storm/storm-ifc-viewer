// 🏕 Rigg — VISNINGEN. Bygger 3D-objektene (brakker, toalett, container …),
// setter dem på bakken og melder laget inn i scenen.
//
// DENNE FILA LASTES AV BÅDE main.js OG lett-main.js: montøren på byggeplassen
// skal SE riggen, men ikke kunne endre den (Emil 25.09.2026, som Materiell).
// Selve verktøyet (panel, plassering, flytt, lagring) ligger i js/rigg.js og
// lastes kun av main.js.
//
// HVOR RIGGEN STÅR. Riggen hører til TOMTA (Emil 25.09): posisjonen lagres i
// UTM33, og flyttes bygget på terrenget, blir brakkene stående der de står.
// For å tegne den trengs terrengets plassering (referansen, se rigg-regn.js):
//   · kontor med terreng — levende fra terreng.js (S.terrengRef), og objektene
//     står på bakken (terrenget, eller plata innenfor utskjæringen)
//   · kontor uten terreng, og byggeplassen — siste kjente plassering, lagret i
//     rigg-lista. Objektene står da på gulvhøyde.
//
// Regningen (rammer, vasking, mengder) ligger i js/rigg-regn.js.
import * as THREE from "three";
import { $, S, esc, ikon, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { camera, flyTil, frameHooks, grid, makeLabel, renderer, scene } from "./scene.js";
import { settValgEffekt } from "./materiell-vis.js";
import {
  GJERDE_DELER, P_PLASS_B, P_PLASS_D, RIGG_REKKEFOLGE, RIGG_TYPER, erPil, gjerdeStykker, parkeringsPlasser, lokalTilEN, riggAntall, riggFraByggeplass, riggForByggeplassFra, riggMengdeRader,
  riggFotavtrykk, riggObjekter, riggRef, riggTilBygg, tilUtm, vaskRef, REF_ID
} from "./rigg-regn.js";

export function gjerdeDelLabel(del) { return t(GJERDE_DELER[del] || del); }

export function riggTypeLabel(type) {
  return RIGG_TYPER[type] ? t(RIGG_TYPER[type].label) : type;
}

// ═══════════════════════ SCENEN ═══════════════════════
export const riggGroup = new THREE.Group();
riggGroup.name = "rigg";
scene.add(riggGroup);

// Typer som er skjult i 🎨 Utseende (per type, som materiellets maltyper).
const skjulteTyper = new Set();

// Byggeplass-siden: det som kom i Workerens JSON.
let lett = { ref: null, objekter: [] };

// Objektene som skal vises, uansett side.
export function riggListe() {
  return LETT ? lett.objekter : riggObjekter(S.rigg || []);
}

// Referansen: den levende fra terrenget, ellers den lagrede.
export function aktivRef() {
  if (LETT) return lett.ref;
  const live = S.terrengRef ? S.terrengRef() : null;
  if (live) return vaskRef(live);
  return riggRef(S.rigg || []);
}

// Modellen som referanse: senteret i plan, meter per sceneenhet og gulvet
// (modellens laveste punkt — samme regel som terreng.js, så riggen og
// terrenget aldri er uenige om hvor gulvet er).
export function riggBase() {
  if (!S.modelGroup) return null;
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  const gulvY = Number.isFinite(boks.min.y) ? boks.min.y : (grid.position.y || 0);
  return { c, skala: S.enhetSkala || 1, gulvY };
}

// Hvor objektet skal stå i scenen: { x, y, z, rotY } eller null.
export function riggScenePos(o, base, ref, live) {
  const b = riggTilBygg(o, ref);
  if (!b || !base) return null;
  const x = base.c.x + b.bx / base.skala, z = base.c.z + b.bz / base.skala;
  // På skrå tomt står objektet på det HØYESTE punktet under seg (midten og de
  // fire hjørnene): da ser det ut som det står på klosser i nedoverbakken, i
  // stedet for å være halvveis begravd i oppoverbakken (nettleserprøven 25.09).
  let y = null;
  if (o.punkter) {
    // 🚧 Gjerdet: gruppa står på det LAVESTE punktet, og hver fot løftes
    // til bakken under seg (gjerdeHoyder) — gjerdet følger terrenget panel
    // for panel i stedet for å henge i lufta over en dump.
    if (live && o.ramme === "utm") for (const p of riggFotavtrykk(o)) {
      const h = live.yVed(p.E, p.N);
      if (h != null && (y == null || h < y)) y = h;
    }
    if (y == null) y = base.gulvY;
    return { x, y, z, rotY: b.rotY };
  }
  // 🅿 En parkeringsplass er en stor, flat flate: høyeste hjørne ville løftet
  // hele asfalten opp i lufta på en skrå tomt. Den legges i midtpunktets høyde.
  const bareMidten = !!(RIGG_TYPER[o.type] && RIGG_TYPER[o.type].flate);   // parkering og lagring
  if (live && o.ramme === "utm") {
    for (const p of [{ E: o.E, N: o.N }].concat(bareMidten ? [] : riggFotavtrykk(o))) {
      const h = live.yVed(p.E, p.N);
      if (h != null && (y == null || h > y)) y = h;
    }
  }
  if (y == null) y = base.gulvY;
  return { x, y, z, rotY: b.rotY };
}

// Høyden under hver skjøt i gjerdet, i METER over gruppas bunn (gy, scene).
export function gjerdeHoyder(o, base, live, gy) {
  return o.punkter.map(q => {
    if (!live || o.ramme !== "utm") return 0;
    const p = lokalTilEN(o, q.x, q.z);
    const h = live.yVed(p.E, p.N);
    return h == null ? 0 : Math.max(0, (h - gy) * base.skala);
  });
}

// ═══════════════════════ LAGET ═══════════════════════
// Samme evner som materiellet. INGEN «plukk» og «velg»: rigg-objektene velges
// av rigg.js med egne lyttere (som materiell.js), og ville ellers havnet i
// flervalg og grupper — der de ikke hører hjemme.
registrerEkstraGruppe(riggGroup, {
  id: "rigg",
  navn: "Rigg",
  noeSkjult: () => skjulteTyper.size > 0 || riggListe().some(o => o.skjult),
  visAlt() {
    if (!this.noeSkjult()) return;
    skjulteTyper.clear();
    if (!LETT) {
      const naa = new Date().toISOString();
      S.rigg = (S.rigg || []).map(p => p && p.skjult ? Object.assign({}, p, { skjult: false, endret: naa }) : p);
      if (S.riggMeldEndret) S.riggMeldEndret();
    }
    tegnRigg();
  },
  skjulTilstand: () => ({
    typer: [...skjulteTyper],
    ider: riggListe().filter(o => o.skjult).map(o => o.id)
  }),
  settSkjulTilstand(v) {
    const s = v || {};
    skjulteTyper.clear();
    for (const k of (s.typer || [])) skjulteTyper.add(k);
    if (!LETT) {
      const skjulte = new Set(s.ider || []);
      S.rigg = (S.rigg || []).map(p => (p && RIGG_TYPER[p.type] && !p.slettet && p.skjult !== skjulte.has(p.id))
        ? Object.assign({}, p, { skjult: skjulte.has(p.id), endret: new Date().toISOString() }) : p);
      if (S.riggMeldEndret) S.riggMeldEndret();
    }
    tegnRigg();
  },
  // 📊 Mengder: egen type «Rigg», så filteret i Mengder og Excel-arket får
  // riggen under egen overskrift.
  mengder: (groups, rows) => leggRiggIMengder(groups, rows),
  // 🔎 Elementsøk: «brakke» eller navnet du ga objektet skal gi treff.
  sokRader: () => riggListe().map(o => {
    const label = riggTypeLabel(o.type);
    const n = riggAntall(o);
    return {
      id: o.id, navn: o.navn || label,
      under: [label, n > 1 ? n + t(" stk") : ""].filter(Boolean).join(" · "),
      s: ((o.navn || "") + " " + label + " " + o.id).toLowerCase()
    };
  }),
  utseendeRader(body) { tegnUtseendeRader(body); },
  gaTil(id) {
    const g = finnRiggObjekt(id);
    if (!g) return;
    const boks = new THREE.Box3().setFromObject(g);
    flyTil(boks.getCenter(new THREE.Vector3()), boks.getSize(new THREE.Vector3()).length() * 2);
    S.riggValgtId = id;
    oppdaterRiggValgEffekt();
  }
});

// ═══════════════════════ NAVNELAPPENE ═══════════════════════
//
// Nært: konstant størrelse på skjermen, som materiellets lapper (px).
// Langt unna: lappen blir ALDRI større enn LAPP_MAKS_M meter i virkeligheten.
// Emils funn 25.09: med bare skjermstørrelse vokste lappene i forhold til
// tomta når man zoomet ut, til de dekket hele riggen. Nå krymper de sammen
// med objektene når taket er nådd — og blir de mindre enn LAPP_MIN_PX, skjules
// de helt: en lapp man ikke kan lese er bare støy.
export const LAPP_MAKS_M = 0.9;
export const LAPP_MIN_PX = 7;
const _lappV = new THREE.Vector3();

// Ren regel (testes): skjermhøyden i px ved avstanden, og om lappen vises.
//   pxPerEnhet — hvor mange skjermpiksler én sceneenhet er på denne avstanden
//   maksEnheter — taket, i sceneenheter
export function lappStorrelse(px, pxPerEnhet, maksEnheter) {
  const onsket = px / pxPerEnhet;                 // sceneenheter for px piksler
  const hoyde = Math.min(onsket, maksEnheter);
  const vistPx = hoyde * pxPerEnhet;
  return { hoyde, vis: vistPx >= LAPP_MIN_PX };
}

frameHooks.push(() => {
  if (!riggGroup.children.length) return;
  const h = renderer.domElement.clientHeight || 1;
  const k = 2 * Math.tan(camera.fov * Math.PI / 360) / h;     // sceneenheter per px per avstand
  const maks = LAPP_MAKS_M / (S.enhetSkala || 1);
  riggGroup.traverse(o => {
    if (!o.isSprite || !o.userData.px) return;
    o.getWorldPosition(_lappV);
    const d = _lappV.distanceTo(camera.position) || 1e-9;
    const r = lappStorrelse(o.userData.px, 1 / (d * k), maks);
    o.visible = r.vis;
    o.scale.set(r.hoyde * (o.userData.aspect || 3), r.hoyde, 1);
  });
});

export function leggRiggIMengder(groups, rows) {
  const liste = riggListe().filter(o => !skjulteTyper.has(o.type));
  for (const r of riggMengdeRader(liste, t)) {
    if (!groups.has(r.key)) groups.set(r.key,
      { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0,
        utenVekt: 0, umulige: 0, nominelle: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.area += r.area; g.flate += r.flate; g.utenVekt++;
    rows.push(r);
  }
}

// ═══════════════════════ 3D-MODELLENE ═══════════════════════
//
// Alle modellene bygges i METER, med origo midt på bunnen, lengden langs x og
// bredden langs z. Gruppa skaleres til modellens enhet (1/skala) — da trenger
// ingen av byggefunksjonene å vite om modellen er i mm eller meter.
//
// ENKLE MED VILJE (Emil: «enkel modell»). Det viktige er at man kjenner igjen
// hva det er ovenfra og fra siden, og at målene stemmer.

const matCache = new Map();
function mat(farge) {
  let m = matCache.get(farge);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: farge }); matCache.set(farge, m); }
  return m;
}

// Mørkere/lysere utgave av en farge, til kanter, vinduer og detaljer.
export function toneFarge(hex, f) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const k = (v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  const r = k((n >> 16) & 255), g = k((n >> 8) & 255), b = k(n & 255);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

const MORK = "#1f2a33";    // vinduer og dører
const HVIT = "#ffffff";

// En boks med SENTER i (x, y, z).
function boks(g, l, h, b, farge, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, b), mat(farge));
  m.position.set(x || 0, y || 0, z || 0);
  g.add(m);
  return m;
}

function sylinder(g, r, h, farge, x, y, z, akse) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat(farge));
  m.position.set(x || 0, y || 0, z || 0);
  if (akse === "z") m.rotation.x = Math.PI / 2;
  if (akse === "x") m.rotation.z = Math.PI / 2;
  g.add(m);
  return m;
}

// Vinduer langs en langside: mørke felt, jevnt fordelt, aldri helt i kanten.
function vinduer(g, L, y, z, hoyde) {
  const n = Math.max(1, Math.floor(L / 1.6));
  const del = L / n;
  for (let i = 0; i < n; i++) boks(g, Math.min(1.0, del * 0.6), hoyde, 0.03, MORK, -L / 2 + del * (i + 0.5), y, z);
}

// En hvit «M» i et plan — laget av fire staver, ikke en tekstur, så den er
// skarp på alle avstander og ikke trenger canvas. Står i xy-planet med senter
// i origo; kalleren dreier den på plass.
function mBokstav(storrelse, farge) {
  const g = new THREE.Group();
  const s = storrelse, stav = s * 0.16, d = 0.02;
  boks(g, stav, s, d, farge, -s / 2 + stav / 2, 0, 0);
  boks(g, stav, s, d, farge, s / 2 - stav / 2, 0, 0);
  const diag = Math.hypot(s / 2 - stav, s * 0.55);
  const vinkel = Math.atan2(s / 2 - stav, s * 0.55);
  const v = boks(g, stav, diag, d, farge, -s / 4 + stav / 4, s / 2 - s * 0.275, 0.001);
  v.rotation.z = vinkel;
  const h = boks(g, stav, diag, d, farge, s / 4 - stav / 4, s / 2 - s * 0.275, 0.001);
  h.rotation.z = -vinkel;
  return g;
}

// Det vanlige førstehjelpsskiltet: HVITT kors på GRØNT (ISO 7010 E003).
// IKKE Røde Kors-merket (rødt kors på hvitt) — det er beskyttet og skal ikke
// brukes som skilt (handoffen, advarsel 3).
function forstehjelpKors(g, side, gronn, y, z, retning) {
  const plate = boks(g, side, side, 0.03, gronn, 0, y, z);
  void plate;
  const arm = side * 0.6, tykk = side * 0.2;
  boks(g, arm, tykk, 0.01, HVIT, 0, y, z + retning * 0.02);
  boks(g, tykk, arm, 0.01, HVIT, 0, y, z + retning * 0.02);
}

// Et GENERISK ID-kort (ikke HMS-kortets egen logo — den skal ikke kopieres):
// hvitt kort med en farget stripe, et «bilde» og to tekstlinjer.
function idKort(g, bredde, y, z, retning, stripe) {
  const h = bredde * 0.63, dz = retning * 0.012;
  boks(g, bredde, h, 0.01, HVIT, 0, y, z + dz);
  boks(g, bredde, h * 0.22, 0.01, stripe, 0, y + h * 0.39, z + dz * 1.6);
  boks(g, bredde * 0.28, h * 0.46, 0.01, "#90a4ae", -bredde * 0.28, y - h * 0.08, z + dz * 1.6);
  boks(g, bredde * 0.42, h * 0.08, 0.01, "#90a4ae", bredde * 0.14, y, z + dz * 1.6);
  boks(g, bredde * 0.34, h * 0.08, 0.01, "#90a4ae", bredde * 0.10, y - h * 0.2, z + dz * 1.6);
}

const BYGG = {
  // Brakkerigg: moduler side om side (langs bredden) og 1–3 i høyden.
  brakke(g, o) {
    const { L, B, H } = o, n = o.moduler || 1, e = o.etasjer || 1;
    const kant = toneFarge(o.farge, 0.72), bredTot = n * B;
    for (let et = 0; et < e; et++) {
      for (let m = 0; m < n; m++) {
        const z = -bredTot / 2 + B * (m + 0.5);
        boks(g, L, H - 0.04, B - 0.04, o.farge, 0, et * H + H / 2, z);
        // takkant og bunnramme: det er dem man ser skille modulene
        boks(g, L + 0.02, 0.1, B, kant, 0, et * H + H - 0.05, z);
        boks(g, L + 0.02, 0.12, B, kant, 0, et * H + 0.06, z);
        // dør på gavlen, én per modul
        boks(g, 0.03, Math.min(2.0, H * 0.8), 0.9, MORK, L / 2 + 0.01, et * H + Math.min(1.0, H * 0.4) + 0.08, z + B * 0.2);
      }
      // vinduer på begge langsidene av hele riggen
      vinduer(g, L, et * H + H * 0.58, bredTot / 2 + 0.01, H * 0.32);
      vinduer(g, L, et * H + H * 0.58, -bredTot / 2 - 0.01, H * 0.32);
    }
  },

  // Hjulbrakke: kassen på en aksel med to hjul, og draget foran.
  hjulbrakke(g, o) {
    const { L, B, H } = o, bunn = Math.min(0.7, H * 0.3), kant = toneFarge(o.farge, 0.7);
    // kassen litt lavere enn takkanten: to flater i samme høyde flimrer (z-fighting)
    boks(g, L, H - bunn - 0.02, B, o.farge, 0, bunn + (H - bunn - 0.02) / 2, 0);
    boks(g, L + 0.02, 0.08, B + 0.02, kant, 0, H - 0.04, 0);
    boks(g, L * 0.9, 0.14, B * 0.8, "#37474f", 0, bunn - 0.07, 0);     // chassis
    const r = Math.min(0.35, bunn * 0.5);
    for (const s of [-1, 1]) sylinder(g, r, 0.2, "#222222", -L * 0.1, r, s * (B / 2 - 0.15), "z");
    // draget: to stag som møtes foran
    const dl = 1.3, vinkel = Math.atan2(B * 0.35, dl);
    for (const s of [-1, 1]) {
      const st = boks(g, Math.hypot(dl, B * 0.35), 0.08, 0.08, "#37474f", L / 2 + dl / 2, bunn - 0.1, s * B * 0.175);
      st.rotation.y = s * vinkel;
    }
    sylinder(g, 0.08, bunn - 0.1, "#222222", L / 2 + dl, (bunn - 0.1) / 2, 0);   // støttehjul
    vinduer(g, L * 0.8, bunn + (H - bunn) * 0.6, B / 2 + 0.01, (H - bunn) * 0.3);
    boks(g, 0.8, (H - bunn) * 0.75, 0.03, MORK, L * 0.3, bunn + (H - bunn) * 0.4, -B / 2 - 0.01);   // dør
  },

  // Toalett: smal boks med dør, tak med utstikk og lufterør.
  toalett(g, o) {
    const { L, B, H } = o;
    boks(g, L, H - 0.1, B, o.farge, 0, (H - 0.1) / 2, 0);
    boks(g, L + 0.08, 0.1, B + 0.08, toneFarge(o.farge, 1.5), 0, H - 0.05, 0);
    boks(g, 0.03, (H - 0.1) * 0.85, B * 0.7, toneFarge(o.farge, 1.3), L / 2 + 0.01, (H - 0.1) * 0.46, 0);
    sylinder(g, 0.05, 0.4, "#555555", -L * 0.3, H + 0.2, -B * 0.3);
  },

  // Førstehjelp: stolpe med skilt (hvitt kors på grønt), skap med skiltet på.
  forstehjelp(g, o) {
    const { L, B, H } = o, side = Math.min(L, 0.8);
    boks(g, 0.08, H, 0.08, "#9e9e9e", 0, H / 2, -B / 2 + 0.04);
    boks(g, L, 0.04, B, "#9e9e9e", 0, 0.02, 0);                          // fotplate
    forstehjelpKors(g, side, o.farge, H - side / 2 - 0.05, -B / 2 + 0.1, 1);
    forstehjelpKors(g, side, o.farge, H - side / 2 - 0.05, -B / 2 - 0.02, -1);
    // skapet med båre og utstyr
    boks(g, L * 0.8, 0.7, B * 0.8, toneFarge(o.farge, 1.2), 0, 1.0, 0.02);
    boks(g, L * 0.3, L * 0.3 * 0.2 + 0.03, 0.01, HVIT, 0, 1.0, B * 0.42 + 0.03);
    boks(g, L * 0.3 * 0.2 + 0.03, L * 0.3, 0.01, HVIT, 0, 1.0, B * 0.42 + 0.03);
  },

  // Møteområde: blå boks med hvit M på alle sider og på toppen.
  mote(g, o) {
    const { L, B, H } = o;
    boks(g, L, H, B, o.farge, 0, H / 2, 0);
    const s = Math.min(L, B, H) * 0.6;
    const topp = mBokstav(s, HVIT); topp.rotation.x = -Math.PI / 2; topp.position.set(0, H + 0.011, 0); g.add(topp);
    const fram = mBokstav(s, HVIT); fram.position.set(0, H / 2, B / 2 + 0.011); g.add(fram);
    const bak = mBokstav(s, HVIT); bak.rotation.y = Math.PI; bak.position.set(0, H / 2, -B / 2 - 0.011); g.add(bak);
    const sv = mBokstav(s, HVIT); sv.rotation.y = Math.PI / 2; sv.position.set(L / 2 + 0.011, H / 2, 0); g.add(sv);
    const sh = mBokstav(s, HVIT); sh.rotation.y = -Math.PI / 2; sh.position.set(-L / 2 - 0.011, H / 2, 0); g.add(sh);
  },

  // Strømskap: skap på fot, med dørskille og et gult varselfelt.
  strom(g, o) {
    const { L, B, H } = o, fot = Math.min(0.35, H * 0.25);
    boks(g, L * 0.7, fot, B * 0.7, "#546e7a", 0, fot / 2, 0);
    boks(g, L, H - fot, B, o.farge, 0, fot + (H - fot) / 2, 0);
    boks(g, L + 0.06, 0.04, B + 0.08, toneFarge(o.farge, 0.7), 0, H + 0.02, 0);
    boks(g, 0.015, (H - fot) * 0.9, 0.01, MORK, 0, fot + (H - fot) / 2, B / 2 + 0.006);
    boks(g, L * 0.3, L * 0.3, 0.01, "#fdd835", -L * 0.22, fot + (H - fot) * 0.75, B / 2 + 0.008);
    // stikkontaktene på siden
    for (let i = 0; i < 3; i++) boks(g, 0.02, 0.08, 0.08, "#263238", L / 2 + 0.01, fot + 0.2 + i * 0.14, 0);
  },

  // 20 fots container: korrugerte sider, hjørnestolper og dører på gavlen.
  container(g, o) {
    const { L, B, H } = o, kant = toneFarge(o.farge, 0.7);
    boks(g, L - 0.02, H - 0.02, B - 0.02, o.farge, 0, H / 2, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1])
      boks(g, 0.16, H, 0.16, kant, x * (L / 2 - 0.08), H / 2, z * (B / 2 - 0.08));
    boks(g, L, 0.12, B, kant, 0, H - 0.06, 0);
    boks(g, L, 0.12, B, kant, 0, 0.06, 0);
    // bølgene i sideveggene
    const n = Math.max(4, Math.round(L / 0.3));
    for (let i = 1; i < n; i++) {
      const x = -L / 2 + (L / n) * i;
      boks(g, 0.06, H - 0.3, 0.03, kant, x, H / 2, B / 2 + 0.01);
      boks(g, 0.06, H - 0.3, 0.03, kant, x, H / 2, -B / 2 - 0.01);
    }
    // dørene: skillet på midten og fire låsestenger
    boks(g, 0.03, H - 0.3, 0.02, MORK, -L / 2 - 0.01, H / 2, 0);
    for (const z of [-0.35, -0.15, 0.15, 0.35]) boks(g, 0.04, H - 0.4, 0.04, "#9e9e9e", -L / 2 - 0.03, H / 2, z * B);
  },

  // HMS-kort-registrering: terminal på fot, med et generisk kort-ikon på
  // begge sider.
  hms(g, o) {
    const { L, B, H } = o, fot = Math.min(0.4, H * 0.3);
    boks(g, 0.12, fot, 0.12, "#78909c", 0, fot / 2, 0);
    boks(g, L, 0.04, B, "#78909c", 0, 0.02, 0);
    boks(g, L, H - fot, B, o.farge, 0, fot + (H - fot) / 2, 0);
    const kortB = Math.min(L * 0.7, 0.5), y = fot + (H - fot) * 0.62;
    idKort(g, kortB, y, B / 2, 1, "#1f5fbf");
    idKort(g, kortB, y, -B / 2, -1, "#1f5fbf");
    boks(g, L * 0.4, 0.08, 0.02, "#26c6da", 0, fot + (H - fot) * 0.25, B / 2 + 0.01);   // leseren
  },

  // 🚧 Byggegjerde: nettingpanel i stålrør mellom hver skjøt, fot og klemme
  // i skjøten (Emils bilder 2 og 3). For lange paneler er RØDE (varsel), valgte
  // er GRØNNE (som på skissen), porter er gule med skråstag.
  gjerde(g, o, hoyder) {
    const H = o.H, mark = gjerdeMark.id === o.id ? gjerdeMark.stykker : null;
    const hv = (k) => (hoyder && hoyder[k]) || 0;
    for (const st of gjerdeStykker(o)) {
      const farge = mark && mark.has(st.i) ? "#2e7d32" : st.forLang ? "#e53935" : st.port ? "#f2b705" : o.farge;
      const dx = st.b.x - st.a.x, dz = st.b.z - st.a.z, l = Math.max(0.05, st.l);
      const panel = new THREE.Group();
      panel.position.set((st.a.x + st.b.x) / 2, (hv(st.i) + hv(st.j)) / 2, (st.a.z + st.b.z) / 2);
      panel.rotation.y = Math.atan2(-dz, dx);
      const rammer = [
        boks(panel, l, 0.045, 0.045, farge, 0, H - 0.02, 0),
        boks(panel, l, 0.045, 0.045, farge, 0, 0.12, 0),
        boks(panel, 0.045, H - 0.1, 0.045, farge, -l / 2 + 0.03, H / 2 + 0.05, 0),
        boks(panel, 0.045, H - 0.1, 0.045, farge, l / 2 - 0.03, H / 2 + 0.05, 0)
      ];
      const netting = new THREE.Mesh(new THREE.BoxGeometry(l, H - 0.16, 0.01), nettingMat(farge));
      netting.position.set(0, H / 2 + 0.05, 0);
      panel.add(netting);
      rammer.push(netting);
      if (st.port) {
        // skråstaget som gjør porten til en port, og en midtstolpe (to fløyer)
        const diag = Math.hypot(l / 2, H - 0.2);
        for (const side of [-1, 1]) {
          const d = boks(panel, 0.04, diag, 0.04, farge, side * l / 4, H / 2 + 0.05, 0);
          d.rotation.z = side * Math.atan2(l / 2, H - 0.2);
          rammer.push(d);
        }
        rammer.push(boks(panel, 0.05, H - 0.1, 0.05, farge, 0, H / 2 + 0.05, 0));
      }
      for (const m of rammer) m.userData.stykke = st.i;
      g.add(panel);
    }
    // føttene og klemmene, én per skjøt
    o.punkter.forEach((q, k) => {
      const fot = boks(g, o.B, 0.15, 0.22, "#9e9e9e", q.x, hv(k) + 0.075, q.z);
      const neste = o.punkter[(k + 1) % o.punkter.length];
      fot.rotation.y = Math.atan2(-(neste.z - q.z), neste.x - q.x);
      boks(g, 0.08, 0.12, 0.08, "#37474f", q.x, hv(k) + H * 0.55, q.z);
    });
  },

  // ➜ Piler for trafikkflyt: et flatt bånd på bakken med pilhode i enden.
  // Kjøretøy er heltrukket, gående stiplet — de skal kunne skilles også uten
  // farge (utskrift av riggplanen i svart-hvitt).
  pilKjoretoy(g, o, hoyder) { byggPil(g, o, hoyder); },
  pilGaende(g, o, hoyder) { byggPil(g, o, hoyder); },

  // 🅿 Parkeringsområde: asfalt, hvite oppmerkingsstreker mellom plassene og
  // et blått P-skilt i hjørnet. Plassene regnes ut av målene
  // (parkeringsPlasser i rigg-regn.js) — to rader med kjørebane i midten når
  // området er dypt nok.
  parkering(g, o) {
    const { L, B, H } = o, asfalt = 0.04, loft = asfalt + 0.006;
    boks(g, L, asfalt, B, o.farge, 0, asfalt / 2, 0);
    const pl = parkeringsPlasser(L, B);
    const start = -L / 2 + (L - pl.perRad * P_PLASS_B) / 2;
    const radZ = pl.rader === 2 ? [-B / 2 + P_PLASS_D / 2, B / 2 - P_PLASS_D / 2] : pl.rader === 1 ? [-B / 2 + P_PLASS_D / 2] : [];
    for (const z of radZ) {
      for (let i = 0; i <= pl.perRad; i++)
        boks(g, 0.12, 0.012, P_PLASS_D - 0.2, HVIT, start + i * P_PLASS_B, loft, z);
      // bakkant av raden
      boks(g, pl.perRad * P_PLASS_B, 0.012, 0.12, HVIT, start + pl.perRad * P_PLASS_B / 2, loft, z < 0 ? -B / 2 + 0.15 : B / 2 - 0.15);
    }
    // P-skiltet: stolpe og blått skilt med hvit P (fire staver, ingen tekstur)
    const sx = L / 2 - 0.5, sz = -B / 2 + 0.5, side = 0.6, topp = Math.max(1.2, H);
    boks(g, 0.08, topp, 0.08, "#9e9e9e", sx, topp / 2, sz);
    for (const r of [1, -1]) {
      const zf = sz + r * 0.03;
      boks(g, side, side, 0.02, "#1f5fbf", sx, topp - side / 2, sz);
      const y0 = topp - side / 2, st = side * 0.13, hs = side * 0.62;
      boks(g, st, hs, 0.01, HVIT, sx - side * 0.15, y0, zf + r * 0.006);                     // stammen
      boks(g, side * 0.32, st, 0.01, HVIT, sx - side * 0.02, y0 + hs / 2 - st / 2, zf + r * 0.006);   // toppen av bøyen
      boks(g, side * 0.32, st, 0.01, HVIT, sx - side * 0.02, y0 + st / 2 - hs * 0.02, zf + r * 0.006); // bunnen av bøyen
      boks(g, st, hs * 0.45, 0.01, HVIT, sx + side * 0.13, y0 + hs * 0.24, zf + r * 0.006);   // bøyens høyre side
    }
  },

  // 🟦 Lagringsområde: flate på bakken i objektets farge, med en kant i en
  // mørkere utgave av samme farge (Emil 25.09: lys blå inni, mørkeblå kant).
  lagring(g, o) {
    const { L, B } = o, tykk = 0.03, kant = Math.min(0.3, Math.min(L, B) * 0.06);
    const mork = toneFarge(o.farge, 0.45);
    boks(g, L - 2 * kant, tykk, B - 2 * kant, o.farge, 0, tykk / 2, 0);
    boks(g, L, tykk + 0.01, kant, mork, 0, (tykk + 0.01) / 2, -B / 2 + kant / 2);
    boks(g, L, tykk + 0.01, kant, mork, 0, (tykk + 0.01) / 2, B / 2 - kant / 2);
    boks(g, kant, tykk + 0.01, B - 2 * kant, mork, -L / 2 + kant / 2, (tykk + 0.01) / 2, 0);
    boks(g, kant, tykk + 0.01, B - 2 * kant, mork, L / 2 - kant / 2, (tykk + 0.01) / 2, 0);
  },

  // Søppelcontainer (liftcontainer, åpen): skrå gavler, åpen topp, løfteører.
  soppel(g, o) {
    const { L, B, H } = o, t = 0.05, inn = Math.min(0.5, L * 0.15);
    const bunnL = L - 2 * inn, kant = toneFarge(o.farge, 0.7);
    boks(g, bunnL, t, B, o.farge, 0, t / 2, 0);                            // bunn
    // langsidene som trapeser
    const form = new THREE.Shape();
    form.moveTo(-bunnL / 2, 0); form.lineTo(bunnL / 2, 0); form.lineTo(L / 2, H); form.lineTo(-L / 2, H); form.lineTo(-bunnL / 2, 0);
    for (const s of [-1, 1]) {
      const vegg = new THREE.Mesh(new THREE.ExtrudeGeometry(form, { depth: t, bevelEnabled: false }), mat(o.farge));
      vegg.position.set(0, 0, s > 0 ? B / 2 - t : -B / 2);
      g.add(vegg);
    }
    // skrå gavler
    const skraa = Math.hypot(inn, H), vinkel = Math.atan2(inn, H);
    for (const s of [-1, 1]) {
      const gavl = boks(g, t, skraa, B, o.farge, s * (bunnL / 2 + inn / 2), H / 2, 0);
      gavl.rotation.z = -s * vinkel;
    }
    // kantlist rundt åpningen og løfteørene
    boks(g, L, 0.08, 0.08, kant, 0, H - 0.04, B / 2 - 0.04);
    boks(g, L, 0.08, 0.08, kant, 0, H - 0.04, -B / 2 + 0.04);
    for (const s of [-1, 1]) sylinder(g, 0.06, B + 0.3, "#37474f", s * (bunnL / 2 + inn * 0.6), H * 0.62, 0, "z");
  }
};

// Pilens mål: tykkelse, hodets lengde og bredde (i forhold til båndet) og
// stiplene for gående. Løftet litt over bakken så båndet ikke flimrer i
// terrenget (z-fighting).
const PIL_TYKK = 0.06, PIL_LOFT = 0.08, PIL_STIPPEL = 1.0, PIL_MELLOM = 0.6;
function byggPil(g, o, hoyder) {
  const B = o.B, hodeL = Math.max(1.5, B * 2.5), hodeB = B * 2.8;
  const st = gjerdeStykker(o);
  const stiplet = !!(RIGG_TYPER[o.type] && RIGG_TYPER[o.type].stiplet);
  const hv = (k) => (hoyder && hoyder[k]) || 0;
  st.forEach((s, n) => {
    const siste = n === st.length - 1;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
    const l = s.l;
    if (l < 1e-6) return;
    const ux = dx / l, uz = dz / l;
    // siste stykke kortes inn med hodet, så spissen står nøyaktig i sluttpunktet
    const brukL = siste ? Math.max(0, l - hodeL) : l;
    const vinkel = Math.atan2(-dz, dx);
    const y0 = hv(s.i), y1 = hv(s.j);
    const bit = (fra, til) => {
      const m = (fra + til) / 2, len = til - fra;
      if (len <= 1e-3) return;
      const b = boks(g, len, PIL_TYKK, B, o.farge, s.a.x + ux * m, y0 + (y1 - y0) * (m / l) + PIL_LOFT, s.a.z + uz * m);
      b.rotation.y = vinkel;
      b.userData.stykke = s.i;
    };
    if (stiplet) {
      for (let t = 0; t < brukL; t += PIL_STIPPEL + PIL_MELLOM) bit(t, Math.min(brukL, t + PIL_STIPPEL));
    } else bit(0, brukL);
    // rund skjøt mellom to stykker, så knekken ikke får et hakk
    if (!siste && !stiplet) {
      const r = sylinder(g, B / 2, PIL_TYKK, o.farge, s.b.x, y1 + PIL_LOFT, s.b.z);
      r.userData.stykke = s.i;
    }
    if (siste) {
      const form = new THREE.Shape();
      form.moveTo(0, -hodeB / 2); form.lineTo(hodeL, 0); form.lineTo(0, hodeB / 2); form.lineTo(0, -hodeB / 2);
      const hode = new THREE.Mesh(new THREE.ExtrudeGeometry(form, { depth: PIL_TYKK, bevelEnabled: false }), mat(o.farge));
      // Formen ligger i xy; lagt ned i xz med spissen langs stykket
      const holder = new THREE.Group();
      hode.rotation.x = -Math.PI / 2;
      hode.position.y = -PIL_TYKK / 2;
      holder.add(hode);
      holder.position.set(s.a.x + ux * brukL, y1 + PIL_LOFT, s.a.z + uz * brukL);
      holder.rotation.y = vinkel;
      hode.userData.stykke = s.i;
      g.add(holder);
    }
  });
}

// Nettingen er halvgjennomsiktig: gjerdet skal ikke skjule det som står bak.
const nettCache = new Map();
function nettingMat(farge) {
  let m = nettCache.get(farge);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: farge, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    nettCache.set(farge, m);
  }
  return m;
}

// Hvilket gjerde og hvilke paneler som er valgt til port (rigg.js setter det).
const gjerdeMark = { id: null, stykker: new Set() };
export function settGjerdeMarkering(id, stykker) {
  gjerdeMark.id = id || null;
  gjerdeMark.stykker = new Set(stykker || []);
}

// Høyden på det ferdige objektet (til navnelappen): brakken i etasjer.
export function riggTotalHoyde(o) {
  return RIGG_TYPER[o.type] && RIGG_TYPER[o.type].moduler ? o.H * (o.etasjer || 1) : o.H;
}

// Hele objektet: en ytre gruppe som står i scenen (posisjon, rotasjon, id),
// med modellen skalert inni og navnelappen ved siden av — ikke inni den
// skalerte gruppa, ellers ville skjermstørrelsen på lappen blitt feil.
export function byggRiggObjekt(o, skala, hoyder) {
  const ytre = new THREE.Group();
  const modell = new THREE.Group();
  const s = 1 / (skala || 1);
  modell.scale.set(s, s, s);
  const bygg = BYGG[o.type];
  if (bygg) bygg(modell, o, hoyder);
  ytre.add(modell);
  const n = riggAntall(o);
  let tekst = (o.navn || riggTypeLabel(o.type)) + (n > 1 ? "  ×" + n : "");
  // 🅿 parkeringen viser antall plasser, det er det man lurer på
  if (RIGG_TYPER[o.type] && RIGG_TYPER[o.type].parkering)
    tekst += "  · " + t("{0} plasser", parkeringsPlasser(o.L, o.B).totalt);
  // ➜ Pilene har ingen navnelapp med mindre brukeren har gitt dem et navn:
  // fargen og streken sier hva de er, og en lapp på hver pil ville druknet
  // riggplanen.
  if (erPil(o) && !o.navn) {
    ytre.userData.hoyder = hoyder || null;
    ytre.userData.riggId = o.id;
    ytre.userData.riggType = o.type;
    return ytre;
  }
  const lapp = makeLabel(tekst, o.farge);
  lapp.userData.px = 22;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  lapp.position.y = (riggTotalHoyde(o) + 0.8) * s;
  if (o.punkter) {
    // gjerdets lapp står midt i ringen, over det høyeste punktet
    const cx = o.punkter.reduce((a, q) => a + q.x, 0) / o.punkter.length;
    const cz = o.punkter.reduce((a, q) => a + q.z, 0) / o.punkter.length;
    const hm = Math.max(0, ...(hoyder || [0]));
    lapp.position.set(cx * s, (o.H + hm + 0.8) * s, cz * s);
  }
  ytre.add(lapp);
  ytre.userData.hoyder = hoyder || null;
  ytre.userData.riggId = o.id;
  ytre.userData.riggType = o.type;
  return ytre;
}

// ═══════════════════════ TEGN OG PLASSER ═══════════════════════

function fjernAlle() {
  riggGroup.children.slice().forEach(o => {
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); });
    riggGroup.remove(o);
  });
}

export function finnRiggObjekt(id) {
  return riggGroup.children.find(o => o.userData.riggId === id) || null;
}

function byggPlassert(o, base, ref, live) {
  const pos = riggScenePos(o, base, ref, live);
  if (!pos) return null;
  const g = byggRiggObjekt(o, base.skala, o.punkter ? gjerdeHoyder(o, base, live, pos.y) : null);
  g.position.set(pos.x, pos.y, pos.z);
  g.rotation.y = pos.rotY;
  return g;
}

// Ett objekt på nytt (rigg.js, mens en skjøt dras): `o` kan være en kladd
// som ikke er lagret ennå. Valget og effekten beholdes.
export function tegnEnRigg(o) {
  const base = riggBase();
  if (!base || !o) return null;
  const gammel = finnRiggObjekt(o.id);
  if (gammel) { gammel.traverse(m => { if (m.geometry) m.geometry.dispose(); }); riggGroup.remove(gammel); }
  const g = byggPlassert(o, base, aktivRef(), !LETT && S.terrengRef ? S.terrengRef() : null);
  if (g) { riggGroup.add(g); valgEffekt(g, o.id === S.riggValgtId); }
  return g;
}

export function tegnRigg() {
  fjernAlle();
  const base = riggBase();
  if (base) {
    const ref = aktivRef();
    const live = !LETT && S.terrengRef ? S.terrengRef() : null;
    for (const o of riggListe()) {
      if (o.skjult || skjulteTyper.has(o.type)) continue;
      const g = byggPlassert(o, base, ref, live);
      if (g) riggGroup.add(g);
    }
  }
  if (S.etterTegnRigg) S.etterTegnRigg();
  else oppdaterRiggValgEffekt();
  if (S.ghostPaaNytt) S.ghostPaaNytt();
}

// Bare flytt det som står der. Kalles for hvert musetrekk mens bygget dras
// på terrenget — å bygge alle meshene på nytt da ville vært bortkastet.
export function plasserRigg() {
  const base = riggBase();
  if (!base) return;
  const ref = aktivRef();
  const live = !LETT && S.terrengRef ? S.terrengRef() : null;
  const alle = new Map(riggListe().map(o => [o.id, o]));
  const gjerder = [];
  for (const g of riggGroup.children.slice()) {
    const o = alle.get(g.userData.riggId);
    if (o && o.punkter) { gjerder.push(o); continue; }
    const pos = o && riggScenePos(o, base, ref, live);
    if (!pos) continue;
    g.position.set(pos.x, pos.y, pos.z);
    g.rotation.y = pos.rotY;
  }
  // Gjerdets føtter står hver på sin bakke — flyttes tomta under, må de
  // regnes på nytt, ikke bare flyttes.
  for (const o of gjerder) tegnEnRigg(o);
}

// terreng.js: bygget er flyttet på tomta, eller terrenget kom eller gikk.
// To ting kan måtte lagres (kontor): objekter lagt inn i byggrammen før noe
// terreng fantes flyttes over på tomta, og referansen (siste kjente
// plassering) oppdateres, så byggeplass-siden og en maskin uten terreng
// tegner riggen på samme sted.
S.riggOmplasser = () => {
  if (!LETT && S.terrengRef) {
    const live = S.terrengRef();
    const ref = live ? vaskRef(live) : null;
    if (ref) {
      const liste = S.rigg || [];
      const naa = new Date().toISOString();
      let endret = false;
      const ny = liste.map(p => {
        if (p && p.ramme === "bygg" && !p.slettet && RIGG_TYPER[p.type]) {
          endret = true;
          return Object.assign(tilUtm(p, ref), { endret: naa });
        }
        return p;
      });
      const gammel = riggRef(ny);
      const harObjekter = riggObjekter(ny).length > 0;
      const refEndret = harObjekter && !likRefSmaa(gammel, ref);
      if (refEndret) {
        const uten = ny.filter(p => p && p.id !== REF_ID);
        uten.push(Object.assign({ id: REF_ID }, ref, { endret: naa }));
        S.rigg = uten;
      } else if (endret) S.rigg = ny;
      if (endret) { tegnRigg(); if (S.riggMeldEndret) S.riggMeldEndret(); return; }
      if (refEndret && S.riggMeldEndret) S.riggMeldEndret();
    }
  }
  plasserRigg();
};

// Referansen regnes lik innenfor en millimeter og en tidel grad — ellers ville
// hvert eneste flyttemusetrekk gitt en ny post (lagringen er uansett samlet).
function likRefSmaa(a, b) {
  if (!a || !b) return !a && !b;
  const n = (x, y, e) => Math.abs(x - y) < e;
  return n(a.E0, b.E0, 1e-3) && n(a.N0, b.N0, 1e-3) && n(a.plass.pE, b.plass.pE, 1e-3) &&
    n(a.plass.pN, b.plass.pN, 1e-3) && n(a.plass.rot, b.plass.rot, 0.05);
}

// ═══════════════════════ 🔵 VALG ═══════════════════════
// Samme blå som materiell og elementvalget (settValgEffekt i materiell-vis.js).
// 🚧 Gjerdet males IKKE blått når det er valgt: da ville det skjult det som
// betyr noe på gjerdet — røde paneler (for lange), grønne (valgt til port) og
// gule porter. Valget vises med skjøtene (prikkene) i stedet.
function valgEffekt(g, paa) {
  settValgEffekt(g, paa && g.userData.riggType !== "gjerde" && !(RIGG_TYPER[g.userData.riggType] || {}).pil);
}

export function oppdaterRiggValgEffekt() {
  riggGroup.children.forEach(o => valgEffekt(o, o.userData.riggId === S.riggValgtId));
}

// ═══════════════════════ BYGGEPLASSEN ═══════════════════════

// Det som sendes med i <fil>.markeringer.json når Byggeplass trykkes (byggeplass.js).
export function riggForByggeplass() {
  return riggForByggeplassFra(S.rigg || [], aktivRef());
}

// markers.js (lettmodus) med `rigg`-feltet. Gamle filer har ikke feltet.
S.settRiggFraLett = (d) => {
  lett = riggFraByggeplass(d);
  tegnRigg();
};

// Modellbytte: riggen hørte til modellen som ble lukket.
S.ryddRigg = () => {
  fjernAlle();
  if (LETT) lett = { ref: null, objekter: [] };
};

// ═══════════════════════ 🎨 UTSEENDE ═══════════════════════
function tegnUtseendeRader(body) {
  if (!body) return;
  const typer = new Map();
  for (const o of riggListe()) typer.set(o.type, (typer.get(o.type) || 0) + riggAntall(o));
  if (!typer.size) return;
  const el = document.createElement("div");
  let html = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
    t("Rigg") + '</div><div class="c"></div></div>';
  for (const k of RIGG_REKKEFOLGE) {
    if (!typer.has(k)) continue;
    html += '<div class="qty-row"><div class="n">' + esc(riggTypeLabel(k)) +
      ' <span style="color:var(--muted);font-size:11px">(' + typer.get(k) + ')</span></div>' +
      '<div class="c"><button data-rigg-hide="' + k + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' +
      ikon(skjulteTyper.has(k) ? "skjul" : "vis") + '</button></div></div>';
  }
  el.innerHTML = html;
  body.appendChild(el);
  el.querySelectorAll("button[data-rigg-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const k = e.currentTarget.dataset.riggHide;
      if (skjulteTyper.has(k)) skjulteTyper.delete(k); else skjulteTyper.add(k);
      e.currentTarget.innerHTML = ikon(skjulteTyper.has(k) ? "skjul" : "vis");
      tegnRigg();
      S.qtyCache = null;
      if (S.oppdaterVisAlle) S.oppdaterVisAlle();
    };
  });
}

export function riggTypeSkjult(k) { return skjulteTyper.has(k); }
