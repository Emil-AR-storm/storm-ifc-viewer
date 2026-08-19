// 📦 Materiell — VISNINGEN. Parametriske 3D-objekter for vareleveranser
// (forskalingskassetter, TRP-takplater, sandwichpanel) som legges inn i
// modellen så alle ser hvor materiellet skal ligge når leverandøren kommer.
//
// DENNE FILA LASTES AV BÅDE main.js OG lett-main.js: montøren på byggeplassen
// skal SE objektene, men ikke kunne flytte dem. Selve verktøyet (dialog,
// plassering, bibliotek) ligger i js/materiell.js og lastes kun av main.js.
//
// Dataflyten er den samme som for markeringene:
//  · kontor: plasseringene lagres lokalt per modellfil (localStorage), og
//    følger med ut i <fil>.markeringer.json når Byggeplass-knappen trykkes
//  · byggeplass: markers.js leser samme fil og kaller S.settMateriellFraLett
//
// Geometrien bygges som rene tallfunksjoner (trpProfil, ribbonPosisjoner …)
// uten three.js, så mønsterreglene kan testes i Node uten skjerm.
import * as THREE from "three";
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { frameHooks, makeLabel, scene, updateScreenScaled } from "./scene.js";

// ---------- Objektmalene ----------
// Alle mål i MILLIMETER i lagret form; regnes om til sceneenheter ved bygging.
// `deling`/`profil` er mønsterregelen: den repeteres uansett hvilken dimensjon
// brukeren setter — antall bølger regnes ut, aldri skrives inn.
export const MALTYPER = {
  trp: {
    label: "TRP takplate",
    fast: false,                 // lengde × bredde settes fritt
    deling: 250, profilHoyde: 45,
    tykkelse: 45,                // «tykkelsen» til én plate i en stabel
    stabling: 55,                // mm per plate i stabelen (profil + klaring)
    standard: { lengde: 5000, bredde: 6000, farge: "#8fa3b8" }
  },
  sandwich: {
    label: "Sandwichpanel",
    fast: false,
    deling: 250, profilHoyde: 3, // mikroprofil i blikket på begge sider
    tykkelse: 150,               // settes fritt av brukeren
    stabling: 5,                 // mm klaring per panel i stabelen (+ tykkelsen)
    standard: { lengde: 6000, bredde: 1000, tykkelse: 150, farge: "#dfe5ec" }
  },
  kassett: {
    label: "Kassett forskaling",
    fast: true,                  // fast mål: 600 mm × 3000 mm
    lengde: 3000, bredde: 600,
    tykkelse: 120,               // plate 21 mm + planker 98 mm
    stabling: 125,
    deling: 300,                 // vertikal planke hver 300 mm
    standard: { farge: "#c9a86a" }
  }
};

export const MATERIELL_MAKS_ANTALL = 500;

// ---------- Vasking ----------
// Plasseringene kommer fra localStorage, fra SharePoint-biblioteket og fra
// Workerens JSON på byggeplassen. Ukjente felter slipper aldri inn — samme
// prinsipp som vaskMarkering i markers.js.
function tall(v, min, maks, std) {
  const n = Number(v);
  // 0 og tomt felt betyr «ikke satt» — da gjelder standardverdien, ikke
  // minstemålet. En bredde på 0 skal ikke bli en plate på 10 cm.
  if (!isFinite(n) || n <= 0) return std;
  return Math.max(min, Math.min(maks, n));
}

export function vaskFarge(v) {
  const s = String(v || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : "#8fa3b8";
}

export function vaskMateriell(p) {
  if (!p || typeof p !== "object") return null;
  const mal = MALTYPER[p.maltype];
  if (!mal) return null;
  const ut = {
    id: String(p.id || "").slice(0, 40),
    maltype: p.maltype,
    navn: String(p.navn || "").slice(0, 80),
    farge: vaskFarge(p.farge),
    // faste mål kan ikke overstyres — en kassett ER 600 × 3000
    lengde: mal.fast ? mal.lengde : tall(p.lengde, 100, 30000, mal.standard.lengde),
    bredde: mal.fast ? mal.bredde : tall(p.bredde, 100, 30000, mal.standard.bredde),
    tykkelse: mal.fast ? mal.tykkelse
      : (p.maltype === "sandwich" ? tall(p.tykkelse, 30, 500, mal.tykkelse) : mal.tykkelse),
    antall: Math.round(tall(p.antall, 1, MATERIELL_MAKS_ANTALL, 1)),
    x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0,
    rot: Number(p.rot) || 0,
    // skjult = midlertidig ute av visningen (vises igjen fra panelet).
    // Feltet følger med i eksporten, så byggeplassen viser det samme som deg.
    skjult: p.skjult === true
  };
  if (!ut.id) return null;
  return ut;
}

export function vaskMateriellListe(liste) {
  return (Array.isArray(liste) ? liste : []).map(vaskMateriell).filter(Boolean);
}

// Det som sendes ut til byggeplassen (og lagres lokalt) — vasket, aldri rått.
export function materiellForEksport() {
  return vaskMateriellListe(S.materiell);
}

// ---------- Mønsterreglene (rene tall, testbare uten three.js) ----------

// Hele bølger, alltid: antall perioder rundes til nærmeste, minst 1, og
// perioden strekkes så mønsteret fyller bredden NØYAKTIG. En TRP på 6000 mm
// med deling 250 får 24 hele bølger; en på 6100 får 24 litt bredere.
export function antallPerioder(breddeMm, delingMm) {
  return Math.max(1, Math.round((Number(breddeMm) || 0) / (Number(delingMm) || 250)));
}

// Trapesprofilen som polylinje: [x, y]-punkter i mm, x fra 0 til bredde.
// Per periode: bunn → skrå opp → topp → skrå ned → bunn.
export function trpProfil(breddeMm, delingMm, hoydeMm) {
  const n = antallPerioder(breddeMm, delingMm);
  const T = breddeMm / n;
  const pkt = [[0, 0]];
  for (let i = 0; i < n; i++) {
    const x0 = i * T;
    pkt.push([x0 + 0.30 * T, 0], [x0 + 0.40 * T, hoydeMm],
             [x0 + 0.60 * T, hoydeMm], [x0 + 0.70 * T, 0], [x0 + T, 0]);
  }
  return pkt;
}

// Profilen ekstrudert til et bånd: posisjoner (ikke-indeksert, to trekanter
// per segment) for en plate der profilen går på tvers (x) og lengden i z.
// Alt i METER inn, meter ut. Sentrert om origo i x/z, y fra 0 og opp.
export function ribbonPosisjoner(profilM, lengdeM) {
  const ut = [];
  const z0 = -lengdeM / 2, z1 = lengdeM / 2;
  const bredde = profilM[profilM.length - 1][0];
  for (let i = 0; i < profilM.length - 1; i++) {
    const [ax, ay] = profilM[i], [bx, by] = profilM[i + 1];
    const x0 = ax - bredde / 2, x1 = bx - bredde / 2;
    // to trekanter: (a,z0)-(b,z0)-(b,z1) og (a,z0)-(b,z1)-(a,z1)
    ut.push(x0, ay, z0, x1, by, z0, x1, by, z1,
            x0, ay, z0, x1, by, z1, x0, ay, z1);
  }
  return ut;
}

// Stabelens totale høyde i mm: alle enhetene under + den øverste i full høyde.
export function stabelHoydeMm(maltype, antall, tykkelseMm) {
  const mal = MALTYPER[maltype];
  if (!mal) return 0;
  const n = Math.max(1, Math.round(Number(antall) || 1));
  const enhet = maltype === "sandwich"
    ? (Number(tykkelseMm) || mal.tykkelse) + mal.stabling
    : mal.stabling;
  const topp = maltype === "sandwich" ? (Number(tykkelseMm) || mal.tykkelse) : mal.tykkelse;
  return (n - 1) * enhet + topp;
}

// Millimeter → sceneenheter. Scenen står i MODELLENS enhet (mm-modell teller
// i mm), så 1 meter = 1 / S.enhetSkala sceneenheter.
export function mmTilScene(mm) {
  return (Number(mm) || 0) / 1000 / (S.enhetSkala || 1);
}

// ---------- Mengder ----------
// Rader til computeQuantities i elements.js — én rad PER ENHET, så «Antall» i
// panelet og i CSV-en teller plater, ikke stabler. Tallene er PARAMETRISKE
// (fra målene brukeren satte), ikke gjettet fra geometri.
let mengdeTeller = 0;
export function materiellMengdeRader() {
  const ut = [];
  mengdeTeller = 0;
  for (const p of vaskMateriellListe(S.materiell)) {
    const mal = MALTYPER[p.maltype];
    const L = p.lengde / 1000, B = p.bredde / 1000, H = p.tykkelse / 1000;
    const key = (p.navn || t(mal.label)) + " · " + t(mal.label);
    for (let i = 0; i < p.antall; i++) {
      mengdeTeller++;
      ut.push({
        id: -(1000000 + mengdeTeller),   // syntetisk, kolliderer aldri med IFC-id-er
        key, name: p.navn || t(mal.label), objType: t(mal.label),
        type: "Materiell", material: t(mal.label),
        L, B, H, len: Math.max(L, B, H),
        vol: 0, area: L * B, forskaling: 0,
        kg: 0, kgGeo: 0, kjentVekt: false, umuligVolum: false,
        vektKilde: "", profil: "", nomKgPerM: 0, avvik: null
      });
    }
  }
  return ut;
}

// Legger materiell-radene inn i mengde-uttaket. Kalles fra computeQuantities —
// muterer groups/rows på samme form som hovedløkka, så resten av panelet
// (filter, CSV, sum) virker uten å vite at radene ikke kom fra IFC-en.
export function leggMateriellIMengder(groups, rows) {
  for (const r of materiellMengdeRader()) {
    if (!groups.has(r.key)) groups.set(r.key,
      { count: 0, length: 0, vol: 0, area: 0, forskaling: 0, kg: 0, kgGeo: 0,
        utenVekt: 0, umulige: 0, nominelle: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.area += r.area; g.utenVekt++;
    rows.push(r);
  }
}

// ---------- three.js-bygging ----------
export const materiellGroup = new THREE.Group();
scene.add(materiellGroup);

// Navnelappene skal ha konstant størrelse på skjermen, som kote-lappene.
frameHooks.push(() => updateScreenScaled(materiellGroup));

function lambert(farge) {
  return new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
}

function ribbonMesh(profilMm, lengdeMm, farge) {
  const profilM = profilMm.map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
  const pos = ribbonPosisjoner(profilM, mmTilScene(lengdeMm));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, lambert(farge));
}

function boks(bMm, hMm, lMm, farge) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(mmTilScene(bMm), mmTilScene(hMm), mmTilScene(lMm)),
    lambert(farge));
  return m;
}

// Mørkere utgave av objektfargen til stabel-sokkelen, så toppen skiller seg ut.
export function morkere(hex) {
  const f = vaskFarge(hex);
  const n = parseInt(f.slice(1), 16);
  const k = (v) => Math.max(0, Math.round(v * 0.72));
  return "#" + [k(n >> 16 & 255), k(n >> 8 & 255), k(n & 255)]
    .map(v => v.toString(16).padStart(2, "0")).join("");
}

// Én enhet av malen, med origo i underkant. Returnerer en gruppe.
function byggEnhet(p) {
  const g = new THREE.Group();
  const mal = MALTYPER[p.maltype];
  if (p.maltype === "trp") {
    g.add(ribbonMesh(trpProfil(p.bredde, mal.deling, mal.profilHoyde), p.lengde, p.farge));
  } else if (p.maltype === "sandwich") {
    // kjerne (isolasjonen) i lys grå — endene viser at det ER en sandwich
    const kjerne = boks(p.bredde - 4, p.tykkelse - 8, p.lengde - 4, "#e8e4da");
    kjerne.position.y = mmTilScene(p.tykkelse / 2);
    g.add(kjerne);
    // blikk med mikroprofil på begge sider, i objektets farge
    const topp = ribbonMesh(trpProfil(p.bredde, mal.deling, mal.profilHoyde), p.lengde, p.farge);
    topp.position.y = mmTilScene(p.tykkelse - mal.profilHoyde);
    const bunn = ribbonMesh(trpProfil(p.bredde, mal.deling, mal.profilHoyde), p.lengde, p.farge);
    bunn.scale.y = -1;   // profilen bøyer NED på undersiden
    bunn.position.y = mmTilScene(mal.profilHoyde);
    g.add(topp, bunn);
  } else if (p.maltype === "kassett") {
    // ligger med plankesiden ned: planker 98 mm + plate 21 mm øverst
    const plankeH = 98, plateH = 21;
    const plate = boks(p.lengde, plateH, p.bredde, p.farge);
    plate.position.y = mmTilScene(plankeH + plateH / 2);
    g.add(plate);
    const plankeFarge = morkere(p.farge);
    // ramme langs begge langsider
    for (const s of [-1, 1]) {
      const rail = boks(p.lengde, plankeH, 48, plankeFarge);
      rail.position.set(0, mmTilScene(plankeH / 2), s * mmTilScene(p.bredde / 2 - 24));
      g.add(rail);
    }
    // vertikal planke hver 300 mm (medregnet endene)
    const n = Math.round(p.lengde / mal.deling);
    for (let i = 0; i <= n; i++) {
      const x = -p.lengde / 2 + Math.min(p.lengde - 24, Math.max(24, i * mal.deling));
      const v = boks(48, plankeH, p.bredde - 96, plankeFarge);
      v.position.set(mmTilScene(x), mmTilScene(plankeH / 2), 0);
      g.add(v);
    }
  }
  return g;
}

// Hele det plasserte objektet: stabel-sokkel + detaljert topp-enhet + navnelapp.
export function byggMateriellObjekt(p) {
  const gruppe = new THREE.Group();
  const mal = MALTYPER[p.maltype];
  const sokkelMm = p.antall > 1 ? stabelHoydeMm(p.maltype, p.antall, p.tykkelse) - p.tykkelse : 0;
  if (sokkelMm > 0) {
    const sokkel = boks(p.lengde, sokkelMm, p.bredde, morkere(p.farge));
    sokkel.position.y = mmTilScene(sokkelMm / 2);
    gruppe.add(sokkel);
  }
  const enhet = byggEnhet(p);
  enhet.position.y = mmTilScene(sokkelMm);
  gruppe.add(enhet);

  // Navnelappen — samme utseende som aksesystemets etiketter, i objektets
  // farge, med antallet når det er en stabel.
  const tekst = (p.navn || t(mal.label)) + (p.antall > 1 ? "  ×" + p.antall : "");
  const lapp = makeLabel(tekst, p.farge);
  lapp.userData.px = 26;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  lapp.position.y = mmTilScene(sokkelMm + p.tykkelse) + mmTilScene(600);
  gruppe.add(lapp);

  gruppe.position.set(p.x, p.y, p.z);
  gruppe.rotation.y = p.rot || 0;
  gruppe.userData.materiellId = p.id;
  gruppe.userData.maltype = p.maltype;
  return gruppe;
}

// ---------- Tegn alt på nytt fra S.materiell ----------
function fjernAlle() {
  materiellGroup.children.slice().forEach(o => {
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); });
    materiellGroup.remove(o);
  });
}

export function tegnMateriell() {
  fjernAlle();
  for (const p of vaskMateriellListe(S.materiell)) {
    if (skjulteMaltyper.has(p.maltype) || p.skjult) continue;
    materiellGroup.add(byggMateriellObjekt(p));
  }
  // materiell.js legger markeringseffekten (blått valg) på igjen etter hver
  // omtegning — objektene er nye instanser hver gang.
  if (S.etterTegnMateriell) S.etterTegnMateriell();
}

export function finnObjekt(id) {
  return materiellGroup.children.find(o => o.userData.materiellId === id) || null;
}

// ---------- Lagring (kontor) ----------
// Samme mønster som markeringene: én localStorage-nøkkel per modellfil.
function lagringsNokkel() { return "storm-ifc-materiell::" + S.fileName; }

export function lagreMateriellLokalt() {
  if (LETT) return;   // på byggeplassen eies dataene av Workeren
  try { localStorage.setItem(lagringsNokkel(), JSON.stringify(materiellForEksport())); } catch (_) {}
}

function lesMateriellLokalt() {
  try { return vaskMateriellListe(JSON.parse(localStorage.getItem(lagringsNokkel()) || "[]")); }
  catch (_) { return []; }
}

// ---------- Kroker mot resten av appen ----------

// Kalles av afterLoad (ifc.js) når en modell er åpnet. På kontoret leses
// plasseringene fra localStorage; på byggeplassen kommer de fra Workerens
// JSON via S.settMateriellFraLett (markers.js kaller den).
S.lastMateriell = () => {
  if (LETT) return;
  S.materiell = lesMateriellLokalt();
  tegnMateriell();
};

// Kalles av markers.js (lettmodus) med `materiell`-feltet fra
// <fil>.markeringer.json. Gamle filer har ikke feltet — da er lista tom.
S.settMateriellFraLett = (liste) => {
  S.materiell = vaskMateriellListe(liste);
  tegnMateriell();
};

// Kalles av nullstillModellState når modellen byttes.
S.ryddMateriell = () => { fjernAlle(); };

// ---------- 🎨 Utseende: egne rader i fargepanelet ----------
// Fargen settes per objekt (det er hele poenget), så radene her har bare
// skjul/vis per maltype — de tegnes av renderColorPanel via denne kroken.
const skjulteMaltyper = new Set();

export function maltypeSkjult(key) { return skjulteMaltyper.has(key); }

S.materiellUtseendeRader = (body) => {
  if (!body) return;
  const typer = new Map();
  for (const p of vaskMateriellListe(S.materiell)) {
    typer.set(p.maltype, (typer.get(p.maltype) || 0) + p.antall);
  }
  if (!typer.size) return;
  const boksEl = document.createElement("div");
  let html = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
    t("Materiell (leveranser)") + '</div><div class="c"></div></div>';
  for (const [key, antall] of typer) {
    html += '<div class="qty-row"><div class="n">' + esc(t(MALTYPER[key].label)) +
      ' <span style="color:var(--muted);font-size:11px">(' + antall + ')</span></div>' +
      '<div class="c"><button data-materiell-hide="' + key + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' +
      ikon(skjulteMaltyper.has(key) ? "skjul" : "vis") + '</button></div></div>';
  }
  boksEl.innerHTML = html;
  body.appendChild(boksEl);
  boksEl.querySelectorAll("button[data-materiell-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const key = e.currentTarget.dataset.materiellHide;
      if (skjulteMaltyper.has(key)) skjulteMaltyper.delete(key);
      else skjulteMaltyper.add(key);
      e.currentTarget.innerHTML = ikon(skjulteMaltyper.has(key) ? "skjul" : "vis");
      tegnMateriell();
    };
  });
};
