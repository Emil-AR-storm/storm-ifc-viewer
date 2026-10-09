// ❄🌬 SNØ OG VIND — panelet og visningen i 3D (Emil 05.10, godkjent 06.10).
//
// Trinn 1: lastdata (kommuneverdiene skrives inn; høyden over havet hentes fra
//          terrenget når det er lastet).
// Trinn 2: snølast per takflate — fra tak-generatoren når den har lagt tak,
//          ellers et flatt, pult- eller saltak over modellens topp med en
//          takvinkel man skriver inn. Farge og kN i 3D.
// Trinn 3: vindtrykk per fasade (sonene A–E) og på flatt tak (F–I), for én
//          vindretning om gangen, med en pil som viser hvor vinden kommer fra.
//
// ⚠ VEILEDENDE — erstatter ikke RIB (se forbeholdet øverst i laster-regn.js og
// i panelet). Regnestykkene er i js/laster-regn.js.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { frameHooks, makeLabel, scene, updateScreenScaled } from "./scene.js";
import { lagret, swGroup } from "./veggelement/tilstand.js";
import { allElementBoxes, forHverTrekant, skjulteIder } from "./elements.js";
import { typeFor } from "./ifcrpc.js";
import { foldSeksjoner } from "./seksjoner.js";
import { forskyvLapper, meldMaalLapper } from "./maal-verktoy.js";
import {
  CPE_FLATT_TAK, TERRENG, flattTakSoner, kommuneFraSvar, kommunePunktUrl, mu1, snoMark, snoTak, tall, vaskLastdata,
  snoAdvarsler, vindAdvarsler, vindBasis, vindTrykk, we,
  fasadeOmriss, flaterFraRektangel, hylle2, kraft, minsteRektangel, vindPaFlater, vindRetninger,
  erStaende, takFraStal, klippX, omrissAvPolygoner, fasaderFraOmriss, klippMedKonveks, polyAreal2, utsatteDeler
} from "./laster-regn.js";
import { takBjelker, takBjelkeLinjer, takOppsett } from "./veggelement/tak.js";
import { takflaterFraBjelker, omrissUV, punktPaFlate } from "./sw-tak.js";
import { varsel } from "./varsel.js";

export const lasterGroup = new THREE.Group();
lasterGroup.name = "laster";
scene.add(lasterGroup);
frameHooks.push(() => {
  if (!lasterGroup.children.length) return;
  updateScreenScaled(lasterGroup);
  forskyvLapper(lasterGroup);
  meldMaalLapper(lasterGroup, 0.5);
});

let data = {};             // lastdata for modellen som er åpen
let visSno = false, visVind = false;

// ---------- Lagring per modell (localStorage) ----------
const nokkel = () => "storm-laster:" + (S.fileName || "");
function les() {
  try { data = vaskLastdata(JSON.parse(localStorage.getItem(nokkel()) || "{}")); } catch (_) { data = {}; }
}
function skriv() { try { localStorage.setItem(nokkel(), JSON.stringify(vaskLastdata(data))); } catch (_) {} }

// ---------- Bygget: boks, høyde over havet ----------
// Bygget = de SYNLIGE bygningselementene i modellen + veggene, taket og
// blikket SW-generatoren har lagt på — byggehøyden til vind skal måles til
// mønet, ikke til toppen av stålet.
//
// Emil 06.10 (bilde: vindsonene stakk langt ut over parkeringen): boksen ble
// regnet av hele modellgruppa og alt i SW-gruppa. Det tar med skjulte
// elementer, rom (IfcSpace), tomt og åpninger, og navnelapper og hjelpefigurer
// i SW-gruppa — og da blir «bygget» større enn bygget. Nå teller bare det
// som står der og er en del av bygget.
const IKKE_BYGG = new Set(["SPACE", "SITE", "OPENINGELEMENT", "ANNOTATION", "GRID", "VIRTUALELEMENT", "BUILDING", "BUILDINGSTOREY"]);
function typeNavn(id) {
  let tp = "";
  try {
    if (S.glbActive) { const p = S.glbProps && S.glbProps.get(id); tp = (p && p[2]) || ""; }
    else tp = typeFor(id) || "";
  } catch (_) { tp = ""; }
  return String(tp).toUpperCase().replace(/^IFC/, "");
}
export function erBygningsdel(type) { return !IKKE_BYGG.has(String(type || "").toUpperCase().replace(/^IFC/, "")); }
function synligKjede(o) { for (let x = o; x; x = x.parent) if (x.visible === false) return false; return true; }
function boks() {
  if (!S.modelGroup) return null;
  const b = new THREE.Box3();
  let skjult = new Set();
  try { skjult = skjulteIder(); } catch (_) { skjult = new Set(); }
  try {
    for (const [id, eb] of allElementBoxes()) {
      if (skjult.has(id) || !erBygningsdel(typeNavn(id)) || eb.isEmpty()) continue;
      b.union(eb);
    }
  } catch (_) { /* faller tilbake under */ }
  if (b.isEmpty()) b.setFromObject(S.modelGroup);
  if (swGroup && swGroup.children.length) {
    swGroup.traverse(o => {
      if (!o.isMesh || o.isSprite || !synligKjede(o)) return;
      const u = o.userData || {};
      if (u.swId === undefined && !u.tak && !u.blikk) return;   // bare vegger, gulv, tak og blikk
      b.expandByObject(o);
    });
  }
  return b.isEmpty() ? null : b;
}
const skala = () => S.enhetSkala || 1;      // meter per sceneenhet
function hFraTerreng() {
  const b = boks();
  if (!b || !S.koteMoh) return null;
  const c = b.getCenter(new THREE.Vector3()); c.y = b.min.y;
  const h = S.koteMoh(c);
  return Number.isFinite(h) ? Math.round(h) : null;
}

// ---------- 🗺 Kommunen fra terrenget (Emil 06.10) ----------
// Terrenget som er lastet inn på modellen vet adressen. Adressesøket gir
// kommunenavnet direkte; ble terrenget hentet på en koordinat, spør vi
// Kartverkets kommuneinfo om punktet. Svaret huskes per punkt, så panelet
// ikke spør nettet hver gang det åpnes.
const kommuneHurtig = new Map();
export async function kommuneFraTerreng() {
  // 🗂 Prosjektinfo (Innstillinger) først: adressesøket der gir kommunen direkte
  const pi = S.prosjektInfo ? S.prosjektInfo() : null;
  if (pi && pi.kommune) return pi.kommune;
  const ref = S.terrengRef ? S.terrengRef() : null;
  if (!ref) return "";
  if (ref.kommune) return ref.kommune;
  const url = kommunePunktUrl(ref.adresseE, ref.adresseN);
  if (!url) return "";
  if (kommuneHurtig.has(url)) return kommuneHurtig.get(url);
  try {
    const svar = await fetch(url);
    if (!svar.ok) return "";
    const navn = kommuneFraSvar(await svar.json());
    if (navn) kommuneHurtig.set(url, navn);
    return navn;
  } catch (_) { return ""; }
}

// Fyller inn TOMME felt fra terrenget: kommunen, og høyden over havet. Det
// brukeren har skrevet selv, røres aldri. `fra` husker hva som kom fra
// terrenget, så panelet kan si det under feltet.
let fraTerreng = { kommune: false, H: false };
async function fyllFraTerreng() {
  let endret = false;
  if (!data.H) { const h = hFraTerreng(); if (h != null) { data.H = String(h); fraTerreng.H = true; endret = true; } }
  if (!data.kommune) {
    const k = await kommuneFraTerreng();
    if (k && !data.kommune) { data.kommune = k; fraTerreng.kommune = true; endret = true; }
  }
  if (endret) { skriv(); if ($("lasterPanel") && $("lasterPanel").classList.contains("open")) tegnPanel(); }
  return endret;
}

// ---------- Takflatene ----------
// Fra tak-generatoren: platene er gruppert på flate (trpInfo.flate). Helningen
// og arealet leses av trekantene selv (sum av flatenormaler — bølgene i
// profilet nuller hverandre ut), så vi slipper å stole på rammen i metadataene.
// Omrisset er det konvekse skallet av platenes hjørner, i flatas eget plan.
export function takflaterFraGenerator() {
  const per = new Map();
  if (!swGroup || !swGroup.children.length) return [];
  swGroup.updateMatrixWorld(true);
  for (const m of swGroup.children) {
    const u = m.userData || {};
    if (!u.tak || !u.trpInfo || !m.isMesh || m.visible === false || !m.geometry) continue;
    const k = u.trpInfo.flate != null ? u.trpInfo.flate : 0;
    if (!per.has(k)) per.set(k, []);
    per.get(k).push(m);
  }
  const ut = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const [k, mesher] of per) {
    // To runder: først grovretningen, så bare trekantene som vender omtrent
    // samme vei. Da teller ikke kantene på platene (loddrette sider) med og
    // drar helningen et par grader feil.
    const normalSum = (filter) => {
      const sum = new THREE.Vector3();
      for (const m of mesher) {
        const pos = m.geometry.getAttribute("position");
        const idx = m.geometry.getIndex();
        const tri = idx ? idx.count / 3 : pos.count / 3;
        for (let i = 0; i < tri; i++) {
          const i0 = idx ? idx.getX(3 * i) : 3 * i, i1 = idx ? idx.getX(3 * i + 1) : 3 * i + 1, i2 = idx ? idx.getX(3 * i + 2) : 3 * i + 2;
          a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
          b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
          c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
          n.subVectors(b, a).cross(c.clone().sub(a));
          if (n.y < 0) n.negate();
          if (filter && n.lengthSq() > 0 && n.clone().normalize().dot(filter) < 0.7) continue;
          sum.add(n);
        }
      }
      return sum;
    };
    const grov = normalSum(null);
    if (!(grov.length() > 0)) continue;
    const sum = normalSum(grov.clone().normalize());
    const hjorner = [];
    for (const m of mesher) {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z])
        hjorner.push(new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld));
    }
    const L = sum.length();
    if (!(L > 0)) continue;
    const normal = sum.clone().divideScalar(L);
    const alfa = Math.acos(Math.min(1, normal.y)) * 180 / Math.PI;
    // Arealet er omrisset (det konvekse skallet) i takplanet — IKKE summen av
    // trekantene: en plate med tykkelse har både over- og underside, og et
    // bølgeprofil har mer flate enn taket det dekker.
    const polygon = skall(hjorner, normal);
    const arealSkraa = polyAreal(polygon, normal) * skala() * skala();
    ut.push({ navn: t("Takflate {0}", ut.length + 1), alfa, arealSkraa,
      arealPlan: arealSkraa * Math.cos(alfa * Math.PI / 180), normal, polygon });
  }
  return ut;
}

// Arealet av en plan polygon med normal n
export function polyAreal(poly, n) {
  const sum = new THREE.Vector3();
  for (let i = 0; i < poly.length; i++) sum.add(poly[i].clone().cross(poly[(i + 1) % poly.length]));
  return Math.abs(sum.dot(n)) / 2;
}

// Konvekst skall av punktene projisert i planet med normal n (monoton kjede)
function skall(pkt, n) {
  if (!pkt.length) return [];
  const e1 = new THREE.Vector3(0, 1, 0).cross(n);
  if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0); else e1.normalize();
  const e2 = n.clone().cross(e1).normalize();
  const midt = pkt.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pkt.length);
  const p2 = pkt.map(p => { const d = p.clone().sub(midt); return { x: d.dot(e1), y: d.dot(e2), p }; })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const kryss = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lav = [], hoy = [];
  for (const q of p2) { while (lav.length >= 2 && kryss(lav[lav.length - 2], lav[lav.length - 1], q) <= 0) lav.pop(); lav.push(q); }
  for (const q of p2.slice().reverse()) { while (hoy.length >= 2 && kryss(hoy[hoy.length - 2], hoy[hoy.length - 1], q) <= 0) hoy.pop(); hoy.push(q); }
  // samme høyde over flata for alle hjørnene: øverste punkt langs normalen
  const topp = Math.max(...pkt.map(p => p.clone().sub(midt).dot(n)));
  return lav.slice(0, -1).concat(hoy.slice(0, -1)).map(q => midt.clone().addScaledVector(e1, q.x).addScaledVector(e2, q.y).addScaledVector(n, topp));
}

// Uten tak-generatoren (Emil 08.10): taket leses av STÅLET — den øvre konturen
// av takbjelker, fagverk og åser, over rektangelet stålsøylene står i. Søyler
// og søyleforlengere er ikke taket (se takFraStal i laster-regn.js). Velges en
// takform, eller skrives en takvinkel inn, brukes den på det samme taket.
let takHurtig = { nokkel: "", verdi: null };
function takFraModell(form, vinkel) {
  const nk = [stalNokkel(), form, vinkel].join("|");
  if (takHurtig.nokkel === nk) return takHurtig.verdi;
  let verdi = null;
  const stal = stalElementer();
  const ligg = stal.filter(x => !x.staar);
  if (ligg.length) {
    const staar = stal.filter(x => x.staar);
    const plan = (staar.length ? staar : stal).flatMap(x => x.pkt.map(q => [q[0], q[2]]));
    const rk = plan.length >= 3 ? minsteRektangel(plan) : null;
    if (rk) {
      // takets utstrekning: alt stålet (et utstikk over søylene teller med)
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const x of stal) for (const q of x.pkt) {
        const a = q[0] * rk.u[0] + q[2] * rk.u[1], b = q[0] * rk.v[0] + q[2] * rk.v[1];
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      }
      verdi = takFraStal(ligg.flatMap(x => x.pkt), { ...rk, a0, a1, b0, b1 }, { form, vinkel: tall(vinkel) });
    }
  }
  takHurtig = { nokkel: nk, verdi };
  return verdi;
}
function flaterFraStal(form, vinkel) {
  const r = takFraModell(form, vinkel);
  if (!r) return null;
  const s = skala();
  const navn = r.flater.length > 1 ? (i) => t("Takhalvdel {0}", i + 1) : () => t("Tak");
  return { profil: r.profil, flater: r.flater.map((f, i) => {
    const polygon = f.poly.map(q => new THREE.Vector3(q[0] / s, q[1] / s, q[2] / s));
    const normal = new THREE.Vector3().subVectors(polygon[1], polygon[0]).cross(new THREE.Vector3().subVectors(polygon[3], polygon[0])).normalize();
    if (normal.y < 0) normal.negate();
    return { navn: navn(i), alfa: f.alfa, arealPlan: f.arealPlan, arealSkraa: f.arealSkraa, polygon, normal };
  }) };
}
// Siste utvei (ingen bygningsdeler å lese taket av): flatt over modellen.
function lokkOverModellen() {
  const b = boks();
  if (!b) return [];
  const s = skala(), y = b.max.y;
  const Lx = (b.max.x - b.min.x) * s, Lz = (b.max.z - b.min.z) * s;
  const poly = [new THREE.Vector3(b.min.x, y, b.min.z), new THREE.Vector3(b.max.x, y, b.min.z), new THREE.Vector3(b.max.x, y, b.max.z), new THREE.Vector3(b.min.x, y, b.max.z)];
  return [{ navn: t("Tak"), alfa: 0, arealPlan: Lx * Lz, arealSkraa: Lx * Lz, polygon: poly, normal: new THREE.Vector3(0, 1, 0) }];
}

// 🏗 «AUTOMATISK» (Emil 08.10): uten lagte takplater regnes takflatene med
// NØYAKTIG de samme reglene som tak-generatoren bruker — de øverste bjelkene,
// gruppert i takfall, med omrisset av bjelkenes utvendige flate
// (takflaterFraBjelker i sw-tak.js). Ingen regel står to steder.
// Svar: [{ navn, alfa, arealPlan, arealSkraa, polygon (Vector3, scene), normal, plan ([x, z] i meter) }]
let metaVersjon = 0;                       // øker når typenavnene er lest inn
let regelHurtig = { nokkel: "", verdi: [] };
export function takflaterRegler() {
  let o = {};
  try { o = takOppsett(); } catch (_) { o = {}; }
  const nk = [stalNokkel(), metaVersjon, JSON.stringify(o)].join("|");
  if (regelHurtig.nokkel === nk) return regelHurtig.verdi;
  let verdi = [];
  try {
    const bj = takBjelker();
    if (bj.length) {
      const linjer = takBjelkeLinjer(bj, bj.map(x => x.id));
      const fl = takflaterFraBjelker(linjer, o);
      const s = skala();
      verdi = fl.map(f => {
        const uv = omrissUV(f) || [[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]];
        const mm = uv.map(([u, v]) => punktPaFlate(f, u, v));
        const polygon = mm.map(q => new THREE.Vector3(q.x / 1000 / s, q.y / 1000 / s, q.z / 1000 / s));
        const plan = mm.map(q => [q.x / 1000, q.z / 1000]);
        const arealPlan = Math.abs(polyAreal2(plan));
        const alfa = Math.abs(Number(f.fallGrader) || (Math.asin(Math.min(1, Math.abs(f.U.y))) * 180 / Math.PI));
        const N = f.N ? new THREE.Vector3(f.N.x, f.N.y, f.N.z) : new THREE.Vector3(0, 1, 0);
        if (N.y < 0) N.negate();
        return { alfa, arealPlan, arealSkraa: arealPlan / Math.cos(alfa * Math.PI / 180), polygon, normal: N.normalize(), plan };
      }).filter(f => f.arealPlan > 0.5).map((f, i, a) => ({ ...f, navn: a.length > 1 ? t("Takflate {0}", i + 1) : t("Tak") }));
    }
  } catch (err) { console.warn("Snø & Last: takflatene kunne ikke regnes", err); verdi = []; }
  regelHurtig = { nokkel: nk, verdi };
  return verdi;
}
// Byggets omriss i plan (meter): taket sett ovenfra. [] når taket ikke kan leses.
let omrissHurtig = { nokkel: "", verdi: [] };
export function byggOmriss() {
  const fl = takflaterRegler();
  const nk = regelHurtig.nokkel;
  if (omrissHurtig.nokkel === nk) return omrissHurtig.verdi;
  let verdi = [];
  try { verdi = fl.length ? omrissAvPolygoner(fl.map(f => f.plan)) : []; } catch (_) { verdi = []; }
  omrissHurtig = { nokkel: nk, verdi };
  return verdi;
}
// En takflate klippet til omrisset (manuell takform på en L): planet beholdes.
function klippTilOmriss(f, ring) {
  if (!ring || ring.length < 3) return f;
  const s = skala();
  const P = f.polygon.map(p => [p.x * s, p.y * s, p.z * s]);
  const plan = P.map(p => [p[0], p[2]]);
  const k = klippMedKonveks(ring, polyAreal2(plan) >= 0 ? plan : plan.slice().reverse());
  if (k.length < 3) return null;
  // planet y = a·x + b·z + c gjennom tre hjørner
  const [p0, p1, p2] = P;
  const d = (p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2]);
  const a = Math.abs(d) < 1e-12 ? 0 : ((p1[1] - p0[1]) * (p2[2] - p0[2]) - (p2[1] - p0[1]) * (p1[2] - p0[2])) / d;
  const b = Math.abs(d) < 1e-12 ? 0 : ((p2[1] - p0[1]) * (p1[0] - p0[0]) - (p1[1] - p0[1]) * (p2[0] - p0[0])) / d;
  const y = (x, z) => p0[1] + a * (x - p0[0]) + b * (z - p0[2]);
  const arealPlan = Math.abs(polyAreal2(k));
  return { ...f, polygon: k.map(([x, z]) => new THREE.Vector3(x / s, y(x, z) / s, z / s)), arealPlan,
    arealSkraa: arealPlan / Math.cos(f.alfa * Math.PI / 180) };
}

// Løft hver regelflate opp på toppen av platene som ligger på den. Platene
// og bjelkeflata er parallelle; avstanden langs normalen er platenes høyde
// over bjelken. Finnes ingen plateflate med samme helning (taket er lagt
// annerledes enn reglene), blir flata liggende på bjelketoppen.
function paaPlatetoppen(regler, plater) {
  return regler.map(f => {
    const n = f.normal || new THREE.Vector3(0, 1, 0);
    let best = null;
    for (const g of plater) {
      if (!g.normal || !g.polygon || !g.polygon.length) continue;
      if (g.normal.dot(n) < 0.999) continue;      // ikke samme takfall
      const d = g.polygon[0].clone().sub(f.polygon[0]).dot(n);
      // bare et løft på noen få cm til en halv meter er platene på DENNE flata
      if (d > 0 && d * skala() < 0.5 && (best === null || d < best)) best = d;
    }
    return best === null ? f : { ...f, polygon: f.polygon.map(p => p.clone().addScaledVector(n, best)) };
  });
}

function takflater() {
  const form = data.takform || "auto";
  if (form === "auto") {
    const g = takflaterFraGenerator();
    const r = takflaterRegler();
    // 🔎 EMILS FUNN 08.10 (Valle, bilde 3): «formen på Vis snølast ligger
    // utenfor taket — den skal ligge innenfor blikket og stoppe ved utvendig
    // ytterkant av toppbjelkene.»
    //
    // Med takplater lagt ble snøflaten lest av PLATENE: det konvekse skallet av
    // hver plates boks. Platene stikker ut over bjelkene, og en skråkappet
    // plate har en boks som går forbi kappet — derfor lå snøen ute over
    // blikket og forbi skråkanten. Taket snøen ligger på er det samme med og
    // uten plater: omrisset av toppbjelkenes utvendige flate. Platene brukes
    // nå bare til å løfte flata opp på platetoppen, så den ikke gjemmer seg
    // under platene.
    if (r.length) return g.length
      ? { kilde: "regler-plater", flater: paaPlatetoppen(r, g) }
      : { kilde: "regler", flater: r };
    if (g.length) return { kilde: "generator", flater: g };
    const m = flaterFraStal("auto", "");
    if (m) return { kilde: "stal", flater: m.flater, profil: m.profil };
    return { kilde: "mangler", flater: lokkOverModellen() };
  }
  const m = flaterFraStal(form, data.takvinkel);
  if (m) {
    const ring = byggOmriss();
    const flater = m.flater.map(f => klippTilOmriss(f, ring)).filter(Boolean);
    return { kilde: "manuell", flater, profil: m.profil };
  }
  return { kilde: "mangler", flater: lokkOverModellen() };
}

// ---------- Fasadene vinden tar på (Emil 06.10) ----------
// Fasit fra Emil (bilde 6): flatene skal ligge som en kasse RUNDT bygget —
// hver fasade dekket helt, fra ende til ende og fra bunn til topp, som om
// stålbygget var kledd med veggelementer uten utsparinger. Ingenting her vet
// noe om én bestemt modell; flatene lages etter disse reglene:
//
//   FASADENE: SW-generatorens fasader når den har lagt vegger, ellers det
//   minste rektangelet rundt stålsøylene (fire sider).
//
//   HVA SOM STÅR I EN FASADE: veggelementene og ringmuren på den fasaden
//   (lastet inn = generert, også når de er skjult i Utseende), og stålet
//   (søyler, bjelker, stag) som ligger i fasadeplanet. Stål som går på tvers
//   av fasaden (takåser, bjelker inn i bygget) hører ikke til.
//
//   HVOR FLATEN LIGGER: på utsiden av veggelementene/ringmuren når de er
//   lastet inn. Ellers på utsiden av søylene — pluss veggtykkelsen hvis den er
//   oppgitt i SW-generatoren, fordi veggen skal stå der.
//
//   HVOR LANG OG HØY: ytterkant til ytterkant (+ veggtykkelsen i hver ende
//   hvis den er oppgitt), fra laveste fot til toppen. Toppen følger gavler og
//   skråkapp; hull, vinduer og porter telles med (fasadeOmriss).
const STAL_FASADE = new Set(["COLUMN", "BEAM", "MEMBER"]);
const STAL_SOYLE = new Set(["COLUMN"]);
const FASADE_BAND = 1.0;
const SOYLE_INN = 3.0;
const SW_UT = 2.0;                // m: så langt utenfor søylerekka en generert vegg kan stå            // m: så langt innenfor takkanten søylerekka kan stå          // m: så nær fasadelinja må stålet ligge for å høre til fasaden
let flateHurtig = { nokkel: "", verdi: null };
function takTopp() {
  let y = -Infinity;
  if (swGroup) swGroup.traverse(o => {
    if (!o.isMesh || !(o.userData && (o.userData.tak || o.userData.blikk))) return;
    const bb = new THREE.Box3().setFromObject(o); if (!bb.isEmpty()) y = Math.max(y, bb.max.y);
  });
  if (Number.isFinite(y)) return y * skala();
  // uten lagte takplater: toppen av takflatene etter tak-generatorens regler
  for (const f of takflaterRegler()) for (const p of f.polygon) y = Math.max(y, p.y * skala());
  if (Number.isFinite(y)) return y;
  // ellers taket lest av stålet
  const r = takFraModell("auto", "");
  if (r) for (const f of r.flater) for (const q of f.poly) y = Math.max(y, q[1]);
  return Number.isFinite(y) ? y : NaN;
}
// SW-generatorens vegger og ringmur, per fasade: hjørnene i 3D (meter).
// Regnet av TALLENE i SW-lagringen, ikke av 3D-meshene: «lastet inn» betyr
// generert, og veggene skal telle også når de er skjult i 🎨 Utseende (da
// tegnes de ikke, men de står der på bygget).
export function swElementHjorner(v, s) {
  const rot = Number(v.rot) || 0;
  const r = [Math.cos(rot), -Math.sin(rot)], f = [Math.sin(rot), Math.cos(rot)];
  const c = [Number(v.x) * s, Number(v.y) * s, Number(v.z) * s];
  let L, T, omr;
  if (v.ringmur) {
    L = Number(v.lengde) * s; T = Number(v.tykkelse) * s;
    const H = Number(v.hoyde) * s;
    omr = [[-L / 2, -H / 2], [L / 2, -H / 2], [L / 2, H / 2], [-L / 2, H / 2]];
  } else {
    L = Number(v.lengdeMm) / 1000; T = Number(v.tMm) / 1000;
    if (v.skra && Array.isArray(v.toppP) && v.toppP.length) {
      const hMaks = Math.max(...v.toppP.map(q => Number(q[1]))) / 1000, y0 = -hMaks / 2;
      omr = [[-L / 2, y0], [L / 2, y0], ...v.toppP.map(q => [-L / 2 + Number(q[0]) / 1000, y0 + Number(q[1]) / 1000]).reverse()];
    } else {
      const H = Number(v.hoydeMm) / 1000;
      omr = [[-L / 2, -H / 2], [L / 2, -H / 2], [L / 2, H / 2], [-L / 2, H / 2]];
    }
  }
  if (!(L > 0) || !omr.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1])) || !c.every(Number.isFinite)) return [];
  const tt = Number.isFinite(T) && T > 0 ? T : 0;
  const ut = [];
  for (const [x, y] of omr) for (const z of [-tt / 2, tt / 2])
    ut.push([c[0] + x * r[0] + z * f[0], c[1] + y, c[2] + x * r[1] + z * f[1]]);
  return ut;
}
function swPunkterPerFasade() {
  const L = lagret, ut = new Map();
  if (!L || !Array.isArray(L.fasader)) return ut;
  const s = skala();
  for (const v of [...(L.vegger || []), ...(L.ringmur || [])]) {
    if (!v || v.skjult || !Number.isInteger(v.fi) || !L.fasader[v.fi]) continue;
    if (!v.ringmur && v.lengdeMm !== undefined && !(v.lengdeMm > 0)) continue;
    const arr = swElementHjorner(v, s);
    if (!arr.length) continue;
    let del = ut.get(v.fi); if (!del) ut.set(v.fi, del = new Map());
    del.set(v.id, arr);
  }
  return ut;
}
// Stålet i modellen: punktene til hvert element (meter), med typen og om det
// står (søyle, søyleforlenger). Huskes til modellen eller det skjulte endres.
let stalHurtig = { nokkel: "", verdi: null };
function stalNokkel() {
  let skjultN = 0; try { skjultN = skjulteIder().size; } catch (_) {}
  return [S.fileName, S.modelGroup && S.modelGroup.uuid, skjultN, skala()].join("|");
}
function stalElementer() {
  const nk = stalNokkel();
  if (stalHurtig.nokkel === nk && stalHurtig.verdi) return stalHurtig.verdi;
  const verdi = stalElementerNy();
  stalHurtig = { nokkel: nk, verdi };
  return verdi;
}
function stalElementerNy() {
  let skjult = new Set();
  try { skjult = skjulteIder(); } catch (_) { skjult = new Set(); }
  const typer = new Map(), alle = new Map();
  try {
    for (const [id, eb] of allElementBoxes()) {
      if (skjult.has(id) || eb.isEmpty()) continue;
      const tp = typeNavn(id);
      if (!erBygningsdel(tp)) continue;
      alle.set(id, eb);
      if (STAL_FASADE.has(tp)) typer.set(id, tp);
    }
  } catch (_) { return []; }
  const s = skala();
  const ider = typer.size ? typer : new Map([...alle.keys()].map(id => [id, ""]));
  const pkt = new Map();
  const v = new THREE.Vector3();
  try {
    forHverTrekant(new Set(ider.keys()), (pos, a, b, c, mat, id) => {
      let arr = pkt.get(id); if (!arr) pkt.set(id, arr = []);
      for (const i of [a, b, c]) { v.fromBufferAttribute(pos, i); if (mat) v.applyMatrix4(mat); arr.push([v.x * s, v.y * s, v.z * s]); }
    });
  } catch (_) { /* uten geometri: boksene under */ }
  const ut = [];
  for (const [id, tp] of ider) {
    let arr = pkt.get(id);
    if (!arr || !arr.length) {
      const eb = alle.get(id); if (!eb) continue;
      arr = [];
      for (const x of [eb.min.x, eb.max.x]) for (const y of [eb.min.y, eb.max.y]) for (const z of [eb.min.z, eb.max.z]) arr.push([x * s, y * s, z * s]);
    }
    ut.push({ id, tp, pkt: arr, staar: erStaende(arr, tp) });
  }
  return ut;
}
function byggFasader() {
  const L = lagret, s = skala();
  const tyk = L && L.oppsett && Number(L.oppsett.tykkelseMm) > 0 ? Number(L.oppsett.tykkelseMm) / 1000 : 0;
  const sw = swPunkterPerFasade();
  const stal = stalElementer();
  const ring = byggOmriss();
  // 1. fasadene
  // Emil 08.10: kantene av byggets omriss når taket kan leses (likt med og
  // uten veggelementer). Ellers SW-generatorens fasader, eller rektangelet
  // rundt søylene.
  let rammer = [], kilde;
  const swFasader = L && Array.isArray(L.fasader) ? L.fasader.map((f, fi) => {
    const el = Math.hypot(f.ex, f.ez) || 1, nl = Math.hypot(f.nx, f.nz) || 1;
    return { fi, navn: f.navn || t("Fasade {0}", fi + 1), o: [f.px * s, f.pz * s], e: [f.ex / el, f.ez / el], N: [f.nx / nl, f.nz / nl] };
  }) : [];
  if (ring.length >= 3) {
    kilde = sw.size ? "omriss-sw" : "omriss";
    rammer = fasaderFraOmriss(ring, 0.5).map((f, i) => {
      // navnet fra SW-generatorens fasade på samme linje, når den finnes
      const mid = [f.o[0] + f.e[0] * f.L / 2, f.o[1] + f.e[1] * f.L / 2];
      const lik = swFasader.find(g => Math.abs(g.e[0] * f.e[1] - g.e[1] * f.e[0]) < 0.05 &&
        Math.abs((mid[0] - g.o[0]) * g.N[0] + (mid[1] - g.o[1]) * g.N[1]) < FASADE_BAND);
      return { navn: lik ? lik.navn : t("Side {0}", i + 1), o: f.o, e: f.e, N: f.N, L: f.L, fast: true };
    });
  } else if (sw.size && swFasader.length) {
    kilde = "sw";
    rammer = swFasader;
  } else {
    kilde = "stal";
    const soyler = stal.filter(x => STAL_SOYLE.has(x.tp));
    const plan = (soyler.length ? soyler : stal).flatMap(x => x.pkt.map(q => [q[0], q[2]]));
    const rk = plan.length >= 3 ? minsteRektangel(plan) : null;
    if (!rk) return { flater: [], kilde };
    rammer = flaterFraRektangel(rk, 0, 1).map((f, i) => ({ fi: i, navn: t("Side {0}", i + 1), o: f.o, e: f.e, N: f.N }));
  }
  // midtpunktet av bygget — avgjør hvilken vei «utover» er
  let cx = 0, cz = 0, n = 0;
  for (const x of stal) for (const q of x.pkt) { cx += q[0]; cz += q[2]; n++; }
  for (const del of sw.values()) for (const arr of del.values()) for (const q of arr) { cx += q[0]; cz += q[2]; n++; }
  if (!n) return { flater: [], kilde };
  cx /= n; cz /= n;
  const alleSw = [...sw.values()].flatMap(del => [...del.values()]);
  const kant = tyk + 0.05;                                   // så langt forbi hjørnet flata får gå
  const flater = [];
  // 🧭 HVEM EIER HVA (Emil 08.10, runde 5: ved innvendige hjørner med et
  // lite sprang lå flata på enden av NABOveggen, og naboflatene overlappet).
  // To parallelle fasader som ligger tett (et sprang på under en meter)
  // fanget begge de samme veggene og søylene, og flata la seg på den som
  // stakk lengst ut. Nå eies hvert element av ÉN fasade per retning: den
  // parallelle fasaden hvis linje ligger nærmest elementets midte, og som
  // elementet ligger langs. Vinkelrette fasader påvirkes ikke — en
  // hjørnesøyle hører fortsatt til begge sidene av hjørnet.
  const eier = new Map();                                    // element → Set av rammeindekser
  if (rammer.some(r => r.fast)) {
    const retn = (r) => Math.round(((Math.atan2(r.e[1], r.e[0]) * 180 / Math.PI) % 180 + 180) % 180 / 5) % 36;
    const tildel = (el, pkt) => {
      let cx2 = 0, cz2 = 0;
      for (const q of pkt) { cx2 += q[0]; cz2 += q[2]; }
      cx2 /= pkt.length; cz2 /= pkt.length;
      const best = new Map();
      rammer.forEach((r, i) => {
        if (!r.fast) return;
        const d = (cx2 - r.o[0]) * r.N[0] + (cz2 - r.o[1]) * r.N[1];
        const tt = (cx2 - r.o[0]) * r.e[0] + (cz2 - r.o[1]) * r.e[1];
        if (tt < -kant - 0.5 || tt > r.L + kant + 0.5 || d < -SOYLE_INN - 1 || d > SW_UT + 1) return;
        const k = retn(r), b = best.get(k);
        if (!b || Math.abs(d) < b.d) best.set(k, { i, d: Math.abs(d) });
      });
      eier.set(el, new Set([...best.values()].map(b => b.i)));
    };
    for (const arr of alleSw) tildel(arr, arr);
    for (const x of stal) tildel(x, x.pkt);
  }
  const eies = (el, i) => { const e = eier.get(el); return !e || e.has(i); };
  for (const [ri, r] of rammer.entries()) {
    // utover = bort fra midten av bygget (omrisset vet det selv)
    if (!r.fast && (r.o[0] - cx) * r.N[0] + (r.o[1] - cz) * r.N[1] < 0) r.N = [-r.N[0], -r.N[1]];
    // 🏗 Emil 08.10 (bilde: flatene lå et stykke utenfor søylene, og gikk
    // ikke opp til forlengerne): omrisset er TAKET sett ovenfra, og taket kan
    // stikke ut over søylene. Fasaden står på SØYLEREKKA. Kanten flyttes
    // derfor inn til ytterkanten av de ytterste søylene langs den (inntil
    // 3 m innenfor taket), og fasaden går fra søyle til søyle i lengderetning.
    let tA = -Infinity, tB = Infinity;
    if (r.fast) {
      let skyv = -Infinity, a0 = Infinity, b0 = -Infinity;
      const kandidater = [];
      for (const x of stal) {
        if (!x.staar || !eies(x, ri)) continue;
        let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
        for (const q of x.pkt) {
          const v = (q[0] - r.o[0]) * r.N[0] + (q[2] - r.o[1]) * r.N[1];
          const tt = (q[0] - r.o[0]) * r.e[0] + (q[2] - r.o[1]) * r.e[1];
          n0 = Math.min(n0, v); n1 = Math.max(n1, v); e0 = Math.min(e0, tt); e1 = Math.max(e1, tt);
        }
        if (n1 < -SOYLE_INN || n0 > FASADE_BAND || e1 < -kant || e0 > r.L + kant) continue;
        kandidater.push({ n0, n1, e0, e1 });
        skyv = Math.max(skyv, n1);
      }
      if (Number.isFinite(skyv)) {
        r.o = [r.o[0] + r.N[0] * skyv, r.o[1] + r.N[1] * skyv];
        // søylene i den nye linja (innenfor båndet): de bestemmer endene
        for (const k of kandidater) if (k.n1 - skyv >= -FASADE_BAND) { a0 = Math.min(a0, k.e0); b0 = Math.max(b0, k.e1); }
        if (b0 > a0) { tA = a0; tB = b0; }
      }
      // Én søyle alene er ikke en vegg: et lite sprang i takkanten (taket
      // stikker ut over hallen, men ikke over tilbygget) gir en kort kant med
      // bare hjørnesøyla i. Den blir borte når kanten flyttes inn til søylene.
      if (Number.isFinite(tA) && tB - tA < 0.6) continue;
    }
    const ty = (q) => [(q[0] - r.o[0]) * r.e[0] + (q[2] - r.o[1]) * r.e[1], q[1]];
    const nn = (q) => (q[0] - r.o[0]) * r.N[0] + (q[2] - r.o[1]) * r.N[1];
    // ligger delen langs denne kanten? (bare når fasaden er en kant av omrisset)
    const iSpenn = (tyx) => {
      if (!r.fast) return true;
      let a = Infinity, b = -Infinity; for (const [tt] of tyx) { a = Math.min(a, tt); b = Math.max(b, tt); }
      return b > -kant + 1e-6 && a < r.L + kant - 1e-6;
    };
    const deler = [];
    // veggelementer og ringmur på fasaden
    let swUt = -Infinity;
    // Emil 08.10 (runde 4): vegger som står lenger ut enn båndet (et
    // innvendig hjørne der veggen er satt et stykke ut) ble ikke med, og
    // flata ble liggende inne bak veggen. Veggene velges nå etter fasaden de
    // hører til i SW-generatoren: den må være parallell med kanten, og
    // veggen må stå inntil 2 m utenfor søylerekka.
    let swDel;
    if (r.fast) {
      swDel = [];
      for (const [fi, del] of sw) {
        const g = L && L.fasader && L.fasader[fi];
        if (!g) continue;
        const el = Math.hypot(g.ex, g.ez) || 1;
        if (Math.abs((g.ex / el) * r.e[1] - (g.ez / el) * r.e[0]) > 0.05) continue;   // ikke parallell
        for (const arr of del.values()) swDel.push(arr);
      }
    } else swDel = r.fi !== undefined && kilde === "sw" && sw.get(r.fi) ? [...sw.get(r.fi).values()] : [];
    let swA = Infinity, swB = -Infinity;
    for (const arr of swDel) {
      if (r.fast && !eies(arr, ri)) continue;
      if (r.fast) {
        let n0 = Infinity, n1 = -Infinity; for (const q of arr) { const v = nn(q); n0 = Math.min(n0, v); n1 = Math.max(n1, v); }
        if (n0 < -FASADE_BAND || n1 > SW_UT) continue;
      }
      const tyx = arr.map(ty);
      if (!iSpenn(tyx)) continue;
      const h = hylle2(tyx); if (h.length >= 3) deler.push(h);
      for (const q of arr) swUt = Math.max(swUt, nn(q));
      for (const [tt] of tyx) { swA = Math.min(swA, tt); swB = Math.max(swB, tt); }
    }
    // stålet i fasadeplanet
    let stalUt = -Infinity, soyleUt = -Infinity;
    const staende = [];                                        // toppene av søyler og forlengere
    for (const x of stal) {
      if (r.fast && !eies(x, ri)) continue;
      let n0 = Infinity, n1 = -Infinity;
      for (const q of x.pkt) { const v = nn(q); n0 = Math.min(n0, v); n1 = Math.max(n1, v); }
      if (n0 < -FASADE_BAND || n1 > FASADE_BAND) continue;     // går på tvers, eller ligger i en annen fasade
      const tyx = x.pkt.map(ty);
      if (!iSpenn(tyx)) continue;                              // står på samme linje, men et annet sted
      const h = hylle2(tyx); if (h.length >= 3) deler.push(h);
      stalUt = Math.max(stalUt, n1);
      let e0 = Infinity, e1 = -Infinity, yt = -Infinity, yf = Infinity;
      for (const [tt, yy] of tyx) { e0 = Math.min(e0, tt); e1 = Math.max(e1, tt); yt = Math.max(yt, yy); yf = Math.min(yf, yy); }
      if (x.staar) { staende.push([(e0 + e1) / 2, yt, yf]); soyleUt = Math.max(soyleUt, n1); }
    }
    if (!deler.length) continue;
    let omr = fasadeOmriss(deler, staende);
    if (omr.length < 3) continue;
    let ut;
    if (Number.isFinite(swUt)) ut = swUt;                      // utsiden av veggene/ringmuren
    else if (r.fast) ut = Number.isFinite(soyleUt) ? soyleUt : (Number.isFinite(stalUt) ? stalUt : 0);   // inntil søylene (Emil 08.10)
    else {
      ut = (Number.isFinite(stalUt) ? stalUt : 0) + tyk;       // utsiden av søylene (+ veggen som skal stå der)
      if (tyk > 0) {                                           // veggtykkelsen forbi søylene i hver ende
        const a = Math.min(...omr.map(p => p[0])), b = Math.max(...omr.map(p => p[0]));
        omr = omr.map(([tt, y]) => [tt <= a + 1e-9 ? tt - tyk : tt >= b - 1e-9 ? tt + tyk : tt, y]);
      }
    }
    if (r.fast) {
      // fra søyle til søyle — eller til veggens ender når den er generert.
      // Hjørnene rettes etterpå (se under), dette er bare reserven.
      let a = Number.isFinite(tA) ? tA : -kant, b = Number.isFinite(tB) ? tB : r.L + kant;
      // veggene kan gå forbi søylene, men ikke forbi kanten av omrisset —
      // der fortsetter nabofasaden (samme linje, annen del av bygget)
      if (Number.isFinite(swUt)) { a = Math.max(Math.min(a, swA), -kant); b = Math.min(Math.max(b, swB), r.L + kant); }
      flater.push({ navn: r.navn, o: r.o, e: r.e, N: r.N, deler: [omr], ut, a, b, fast: true, L: r.L });
      continue;
    }
    flater.push({ navn: r.navn, o: r.o, e: r.e, N: r.N, deler: [omr], ut });
  }
  // 📐 HJØRNENE (Emil 08.10, runde 4: «innover vendte hjørner blir ikke
  // flyttet ut til overflaten av veggelementet»). Flatene ligger på
  // overflaten — veggens eller søylenes — og to naboflater skal møtes der de
  // to overflatene krysser hverandre. På et utvendig hjørne forlenges flata
  // ut til naboens overflate, på et innvendig hjørne kortes den inn. Da går
  // flatene rundt bygget som én sammenhengende kappe.
  {
    const fast = flater.filter(f => f.fast);
    const n = fast.length;
    const kryss = (f, g) => {
      const P = [f.o[0] + f.N[0] * f.ut, f.o[1] + f.N[1] * f.ut], Q = [g.o[0] + g.N[0] * g.ut, g.o[1] + g.N[1] * g.ut];
      const d = f.e[0] * g.e[1] - f.e[1] * g.e[0];
      if (Math.abs(d) < 0.2) return null;                       // nesten parallelle: ikke et hjørne
      const s2 = ((Q[0] - P[0]) * g.e[1] - (Q[1] - P[1]) * g.e[0]) / d;
      const X = [P[0] + f.e[0] * s2, P[1] + f.e[1] * s2];
      return { tf: (X[0] - f.o[0]) * f.e[0] + (X[1] - f.o[1]) * f.e[1], tg: (X[0] - g.o[0]) * g.e[0] + (X[1] - g.o[1]) * g.e[1] };
    };
    for (let i = 0; n >= 3 && i < n; i++) {
      const f = fast[i], g = fast[(i + 1) % n];
      const k = kryss(f, g);
      // bare når krysset ligger nær endene vi har fra før — ellers er det
      // ikke naboflater rundt samme hjørne
      if (k && Math.abs(k.tf - f.b) < 3 && Math.abs(k.tg - g.a) < 3) { f.b = k.tf; g.a = k.tg; }
      else if (!k && f.L > 0 && Math.abs(f.e[0] * g.e[0] + f.e[1] * g.e[1]) > 0.98) {
        // parallelle naboer rundt et lite sprang: hver stopper der sin egen
        // kant av omrisset slutter — de skal ikke gå forbi hverandre
        f.b = Math.min(f.b, f.L); g.a = Math.max(g.a, 0);
      }
    }
  }
  for (const f of flater) {
    if (!f.fast) continue;
    let omr = f.deler[0];
    const a0 = Math.min(...omr.map(p => p[0])), b0 = Math.max(...omr.map(p => p[0]));
    omr = klippX(omr, f.a, f.b);
    if (omr.length >= 3) {
      // strekk endene ut til hjørnet når flata må forlenges
      const a1 = Math.min(...omr.map(p => p[0])), b1 = Math.max(...omr.map(p => p[0]));
      omr = omr.map(([tt, y]) => [tt <= a1 + 1e-9 && f.a < a0 ? f.a : tt >= b1 - 1e-9 && f.b > b0 ? f.b : tt, y]);
    }
    f.deler = omr.length >= 3 ? [omr] : [];
  }
  for (let i = flater.length - 1; i >= 0; i--) if (!flater[i].deler.length) flater.splice(i, 1);
  // Reserve uten omriss: fasader (eller biter av dem) som står inne i bygget
  // tas ut — se utsatteDeler i laster-regn.js.
  if (kilde === "sw" && flater.length > 1) {
    const ute = utsatteDeler(flater);
    const rene = [];
    flater.forEach((f, i) => {
      const deler = [];
      for (const [a, b] of ute[i]) for (const d of f.deler) { const k = klippX(d, a, b); if (k.length >= 3) deler.push(k); }
      if (deler.length) rene.push({ ...f, deler });
    });
    return { flater: rene, kilde, tyk, ring };
  }
  return { flater, kilde, tyk, ring };
}
function vindFlater() {
  let skjultN = 0; try { skjultN = skjulteIder().size; } catch (_) {}
  const L = lagret;
  const nk = [S.fileName, S.modelGroup && S.modelGroup.uuid, swGroup ? swGroup.children.length : 0, [...((L && L.vegger) || []), ...((L && L.ringmur) || [])].reduce((a, v) => a + (Number(v.x) || 0) * 7 + (Number(v.z) || 0) * 13 + (Number(v.y) || 0) * 3 + (Number(v.lengdeMm || v.lengde) || 0) + (v.skjult ? 1e6 : 0), 0).toFixed(4),
    L && L.vegger ? L.vegger.length : 0, L && L.ringmur ? L.ringmur.length : 0,
    L && L.oppsett ? L.oppsett.tykkelseMm : "", skjultN, skala(), metaVersjon].join("|");
  if (flateHurtig.nokkel === nk && flateHurtig.verdi) return flateHurtig.verdi;
  const verdi = { ...byggFasader(), hTopp: takTopp() };
  flateHurtig = { nokkel: nk, verdi };
  return verdi;
}
const PILER = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
const pilFor = (w) => PILER[((Math.round(Math.atan2(w[1], w[0]) / (Math.PI / 4)) % 8) + 8) % 8];
function retninger(vf) {
  return vindRetninger(vf.flater).map(w => {
    const r = vindPaFlater(vf.flater, w, vf.hTopp);
    let lo = null, A = 0;
    if (r) for (const x of r.perFlate) if (x.sone === "D" && x.areal > A) { A = x.areal; lo = vf.flater[x.fi].navn; }
    return { w, navn: pilFor(w) + (lo ? " " + lo : "") };
  });
}

// ---------- Utregningen ----------
export function regnUt() {
  const ut = { sno: null, vind: null };
  const sm = snoMark({ sk0: data.sk0, Hg: data.Hg, dsk: data.dsk, skMaks: data.skMaks, H: data.H });
  const tf = takflater();
  if (sm) {
    ut.sno = { ...sm, kilde: tf.kilde, profil: tf.profil, flater: tf.flater.map(f => {
      const s = snoTak(sm.sk, f.alfa, data.Ce, data.Ct);
      return { ...f, mu: mu1(f.alfa), s, total: s * f.arealPlan };
    }) };
  }
  const vb = vindBasis(data);
  if (vb != null) {
    const vf = vindFlater();
    const rr = vf.flater.length ? retninger(vf) : [];
    const r = rr[Number(data.retning || 0)] || rr[0];
    const v = r ? vindPaFlater(vf.flater, r.w, vf.hTopp) : null;
    if (v) {
      const kat = TERRENG[data.terreng] ? data.terreng : "II";
      const q = vindTrykk(v.h, vb, kat);
      let tak = tf.flater.length && tf.flater.every(f => f.alfa < 5) ? flattTakSoner(v.b, v.d, v.h) : null;
      // Emil 08.10: sonene på taket ligger PÅ TAKET (overkant av de høyeste
      // bjelkene), ikke på toppen av søyleforlengerne — og bare der det er
      // tak: en L klippes til omrisset.
      if (tak) {
        let yTak = -Infinity;
        for (const f of tf.flater) for (const p of f.polygon) yTak = Math.max(yTak, p.y * skala());
        if (!Number.isFinite(yTak)) yTak = v.y1;
        const W = v.w, Q = v.tvers, ring = vf.ring || [];
        const P = (dm, bm) => [W[0] * (v.s0 + dm) + Q[0] * (v.q0 + bm), W[1] * (v.s0 + dm) + Q[1] * (v.q0 + bm)];
        tak = { ...tak, y: yTak, soner: tak.soner.map(z => {
          let plan = [P(z.v0, z.u0), P(z.v1, z.u0), P(z.v1, z.u1), P(z.v0, z.u1)];
          if (ring.length >= 3) plan = klippMedKonveks(ring, polyAreal2(plan) >= 0 ? plan : plan.slice().reverse());
          return { ...z, plan, areal: plan.length >= 3 ? Math.abs(polyAreal2(plan)) : 0 };
        }).filter(z => z.areal > 1e-6) };
      }
      ut.vind = { ...v, vb, kat, q, tak, kilde: vf.kilde, flater: vf.flater, retning: r, retninger: rr };
    }
  }
  return ut;
}

// ---------- 3D ----------
function rydd() {
  lasterGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  lasterGroup.clear();
}
// Emil 08.10 (bilde: hjørnene ble «vrengt» opp mot søyleforlengerne): flatene
// ble delt i trekanter som en vifte fra første hjørne. Det går bare for
// konvekse flater — en fasade med hakk og gavler fikk trekanter UTENFOR
// omrisset. Nå trianguleres omrisset ordentlig (ShapeUtils), i flatens eget
// plan. `plan2` er hjørnene i 2D når de finnes; ellers legges de i planet.
function flatePlan2(poly) {
  const n = new THREE.Vector3();
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  return poly.map(p => ax >= ay && ax >= az ? new THREE.Vector2(p.y, p.z) : ay >= az ? new THREE.Vector2(p.x, p.z) : new THREE.Vector2(p.x, p.y));
}
function flateMesh(poly, farge, opasitet, plan2) {
  if (poly.length < 3) return null;
  const pos = [];
  let p2 = plan2 ? plan2.map(q => new THREE.Vector2(q[0], q[1])) : flatePlan2(poly);
  let tri = [];
  try { tri = THREE.ShapeUtils.triangulateShape(p2, []); } catch (_) { tri = []; }
  if (tri.length) for (const [a, b, c] of tri) pos.push(...poly[a].toArray(), ...poly[b].toArray(), ...poly[c].toArray());
  else for (let i = 1; i + 1 < poly.length; i++) pos.push(...poly[0].toArray(), ...poly[i].toArray(), ...poly[i + 1].toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: farge, transparent: true, opacity: opasitet, side: THREE.DoubleSide, depthWrite: false }));
  m.renderOrder = 990;
  const kant = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly), new THREE.LineBasicMaterial({ color: farge, transparent: true, opacity: 0.9 }));
  kant.renderOrder = 991;
  const gr = new THREE.Group(); gr.add(m, kant);
  return gr;
}
function lappPaa(tekst, farge, pos) {
  const l = makeLabel(tekst, farge);
  l.userData.px = 22;
  l.userData.aspect = l.scale.x / l.scale.y;
  l.position.copy(pos);
  return l;
}
const kn = (v) => v.toFixed(2).replace(".", ",");
const kn1 = (v) => (Math.round(v * 10) / 10).toString().replace(".", ",");
const fortegn = (v) => (v >= 0 ? "+" : "−") + kn(Math.abs(v));
export function farge(cpe) {
  if (cpe >= 0) return 0x3b82f6;
  const a = Math.abs(cpe);
  return a >= 1.2 ? 0xef4444 : a >= 0.7 ? 0xf97316 : 0xfbbf24;
}
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

function tegn() {
  rydd();
  if (!visSno && !visVind) return;
  const r = regnUt();
  const bx = boks();
  if (!bx) return;
  const lofte = (bx.max.y - bx.min.y) * 0.004 + 1e-6;
  if (visSno && r.sno) {
    for (const f of r.sno.flater) {
      const poly = f.polygon.map(p => p.clone().addScaledVector(f.normal || new THREE.Vector3(0, 1, 0), lofte));
      const m = flateMesh(poly, 0x93c5fd, 0.45);
      if (m) lasterGroup.add(m);
      const midt = poly.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(poly.length || 1);
      lasterGroup.add(lappPaa(t("Snø {0} kN/m² · {1}° · {2} kN", kn(f.s), Math.round(f.alfa), Math.round(f.total)), "#93c5fd", midt));
    }
  }
  if (visVind && r.vind) {
    const v = r.vind, s = skala(), qp = v.q.qp;
    const luft = 0.05;                              // 5 cm utenpå veggen
    const plan = (f, tt) => [f.o[0] + tt * f.e[0] + (f.ut + luft) * f.N[0], f.o[1] + tt * f.e[1] + (f.ut + luft) * f.N[1]];
    const V3 = (x, y, z) => new THREE.Vector3(x / s, y / s, z / s);
    const midt = new Map();                         // flate|sone → tyngdepunkt
    for (const x of v.deler) {
      const f = v.flater[x.fi];
      const poly = x.poly.map(([tt, y]) => { const [px, pz] = plan(f, tt); return V3(px, y, pz); });
      const m = flateMesh(poly, farge(v.cpe[x.sone]), 0.4, x.poly);
      if (m) lasterGroup.add(m);
      const k = x.fi + "|" + x.sone;
      if (!midt.has(k)) midt.set(k, { p: new THREE.Vector3(), A: 0 });
      const c = poly.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(poly.length);
      const mm = midt.get(k); mm.p.addScaledVector(c, x.areal); mm.A += x.areal;
    }
    for (const x of v.perFlate) {
      const mm = midt.get(x.fi + "|" + x.sone);
      if (!mm || !(mm.A > 0)) continue;
      const cpe = v.cpe[x.sone];
      lasterGroup.add(lappPaa(x.sone + "  " + fortegn(we(qp, cpe)) + " kN/m² · " + Math.round(x.areal) + " m²", hex(farge(cpe)), mm.p.clone().divideScalar(mm.A)));
    }
    // flatt tak — i vindens retning, over toppen av veggene
    const W = v.w, Q = v.tvers;
    const T = (dm, bm, ym) => V3(W[0] * (v.s0 + dm) + Q[0] * (v.q0 + bm), ym, W[1] * (v.s0 + dm) + Q[1] * (v.q0 + bm));
    if (v.tak) for (const z of v.tak.soner) {
      const cpe = CPE_FLATT_TAK[z.sone];
      const poly = z.plan.map(([x, zz]) => V3(x, v.tak.y + luft, zz));
      const m = flateMesh(poly, farge(cpe), 0.4, z.plan); if (m) lasterGroup.add(m);
      const c = poly.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(poly.length);
      lasterGroup.add(lappPaa(z.sone + "  " + fortegn(we(qp, cpe)) + " kN/m²", hex(farge(cpe)), c));
    }
    // pila: hvor vinden kommer fra
    const lengde = Math.max(v.d, v.b) * 0.25;
    const midtLo = T(-lengde * 1.2, v.b / 2, (v.y0 + v.y1) / 2);
    const retn = new THREE.Vector3(W[0], 0, W[1]);
    lasterGroup.add(new THREE.ArrowHelper(retn, midtLo, lengde / s, 0x22d3ee, lengde * 0.3 / s, lengde * 0.15 / s));
    lasterGroup.add(lappPaa(t("Vind · qp {0} kN/m²", kn(qp / 1000)), "#22d3ee", T(-lengde * 1.4, v.b / 2, (v.y0 + v.y1) / 2)));
  }
}

// ---------- Panelet ----------
const felt = (id, navn, enhet, hjelp) =>
  '<label>' + navn + (enhet ? ' <span style="opacity:.7">(' + enhet + ')</span>' : '') +
  '<input type="text" inputmode="decimal" data-felt="' + id + '" value="' + esc(data[id] || "") + '"' +
  (hjelp ? ' placeholder="' + esc(hjelp) + '"' : "") + "></label>";

function retningKnapper() {
  let rr = [];
  try { const vf = vindFlater(); rr = vf.flater.length ? retninger(vf) : []; } catch (_) { rr = []; }
  if (!rr.length) rr = [0, 1, 2, 3].map(i => ({ navn: String(i + 1) }));
  return rr.map((r, i) => '<button data-retning="' + i + '"' + (String(data.retning || 0) === String(i) ? ' class="active"' : "") + ">" + esc(r.navn) + "</button>").join("");
}
function tegnPanel() {
  const body = $("lasterBody");
  if (!body) return;
  const terrengH = hFraTerreng();
  const kat = Object.entries(TERRENG).map(([k, v]) => '<option value="' + k + '"' + ((data.terreng || "II") === k ? " selected" : "") + ">" + esc(t(v.navn)) + "</option>").join("");
  const takf = [["auto", t("Automatisk")], ["flatt", t("Flatt tak")], ["pult", t("Pulttak")], ["saltak", t("Saltak")]]
    .map(([k, n]) => '<option value="' + k + '"' + ((data.takform || "auto") === k ? " selected" : "") + ">" + n + "</option>").join("");
  body.innerHTML =
    '<div class="laster-forbehold">' + ikon("advarsel") + " " +
      t("Veiledende kontroll og visualisering. Erstatter ikke RIB, som har ansvaret for prosjekteringen (PRO). Kommuneverdiene skrives inn fra NS-EN 1991-1-3 og NS-EN 1991-1-4 med nasjonalt tillegg, eller fra RIBs lastforutsetninger.") + "</div>" +
    '<div class="prop-actions" data-sw-fast><button id="laSno">' + t("Vis snølast") + '</button><button id="laVind">' + t("Vis vindlast") + "</button></div>" +
    '<h4 data-sek="la-sted">' + t("Sted") + "</h4>" +
    felt("kommune", t("Kommune"), "", t("f.eks. Modum")) +
    (fraTerreng.kommune ? '<p class="la-tom">' + ikon("kote") + " " + t("Hentet fra terrenget (adressen)") + "</p>" : "") +
    felt("H", t("Høyde over havet, H"), "moh", terrengH != null ? t("fra terrenget: {0}", terrengH) : "") +
    (fraTerreng.H ? '<p class="la-tom">' + ikon("kote") + " " + t("Hentet fra terrenget") + "</p>" : "") +
    (terrengH != null ? '<div class="prop-actions"><button id="laHentH">' + t("Bruk høyden fra terrenget ({0} moh)", terrengH) + "</button></div>" : "") +
    '<h4 data-sek="la-sno">' + t("Snølast (NS-EN 1991-1-3)") + "</h4>" +
    felt("sk0", "sk,0", "kN/m²") + felt("Hg", "Hg", "moh") + felt("dsk", "Δsk", t("kN/m² per 100 m")) + felt("skMaks", "sk,maks", "kN/m²") +
    felt("Ce", "Ce", "", "1,0") + felt("Ct", "Ct", "", "1,0") +
    '<label>' + t("Taket") + '<select data-felt="takform">' + takf + "</select></label>" +
    ((data.takform || "auto") !== "auto" ? felt("takvinkel", t("Takvinkel"), "°", "0") : "") +
    '<div id="laSnoRes"></div>' +
    '<h4 data-sek="la-vind">' + t("Vindlast (NS-EN 1991-1-4)") + "</h4>" +
    felt("vb0", "vb,0", "m/s") + felt("cdir", "cdir", "", "1,0") + felt("cseason", "cseason", "", "1,0") +
    felt("calt", "calt", "", "1,0") + felt("cprob", "cprob", "", "1,0") +
    '<label>' + t("Terrengkategori") + '<select data-felt="terreng">' + kat + "</select></label>" +
    '<label>' + t("Vindretning") + '</label><div class="prop-actions" id="laRetning">' +
      retningKnapper() + "</div>" +
    '<div id="laVindRes"></div>';
  foldSeksjoner(body, { nokkel: "storm-laster-seksjoner-apne", standard: ["la-sted", "la-sno", "la-vind"] });
  body.querySelectorAll("[data-felt]").forEach(el => {
    const lagre = () => {
      data[el.dataset.felt] = el.value;
      if (el.dataset.felt in fraTerreng) fraTerreng[el.dataset.felt] = false;   // skrevet om for hånd
      skriv(); visResultat(); if (visSno || visVind) tegn();
      if (el.dataset.felt === "takform") tegnPanel();
    };
    el.addEventListener("input", lagre); el.addEventListener("change", lagre);
  });
  body.querySelectorAll("[data-retning]").forEach(el => el.onclick = () => {
    data.retning = el.dataset.retning; skriv();
    body.querySelectorAll("[data-retning]").forEach(x => x.classList.toggle("active", x === el));
    visResultat(); if (visVind) tegn();
  });
  if ($("laHentH")) $("laHentH").onclick = () => { data.H = String(terrengH); skriv(); tegnPanel(); if (visSno) tegn(); };
  $("laSno").classList.toggle("active", visSno);
  $("laVind").classList.toggle("active", visVind);
  $("laSno").onclick = () => { visSno = !visSno; $("laSno").classList.toggle("active", visSno); tegn(); };
  $("laVind").onclick = () => { visVind = !visVind; $("laVind").classList.toggle("active", visVind); tegn(); };
  visResultat();
}

const rad = (k, v) => '<div class="qty-row"><div class="n">' + k + '</div><div class="c">' + v + "</div></div>";
const advarsel = (liste) => liste.map(a => '<div class="laster-forbehold laster-advarsel">' + ikon("advarsel") + " " +
  esc(t(a.tekst, String(a.verdi).replace(".", ","), a.navn || "")) + "</div>").join("");
function visResultat() {
  const r = regnUt();
  const sr = $("laSnoRes"), vr = $("laVindRes");
  if (sr) {
    if (!r.sno) sr.innerHTML = '<p class="la-tom">' + t("Skriv inn sk,0 (og Hg, Δsk og H) for å få snølasten.") + "</p>";
    else {
      let h = advarsel(snoAdvarsler(data)) + rad(t("Snølast på mark, sk"), kn(r.sno.sk) + " kN/m²" + (r.sno.n ? " (n = " + r.sno.n + ")" : "") + (r.sno.kappet ? " · sk,maks" : ""));
      if (r.sno.kilde === "mangler") h += '<p class="la-tom">' + t("Tak-generatoren har ikke lagt tak — regnet som flatt tak over modellen. Velg takform og vinkel over.") + "</p>";
      const formNavn = { flatt: t("Flatt tak"), pult: t("Pulttak"), saltak: t("Saltak") };
      if (r.sno.kilde === "regler-plater") h += '<p class="la-tom">' + t("Snøen ligger på taket innenfor blikket: omrisset av toppbjelkenes utvendige flate ({0} takflater), løftet opp på takplatene.", r.sno.flater.length) + "</p>";
      if (r.sno.kilde === "regler") h += '<p class="la-tom">' + t("Ingen takplater er lagt — takflatene er regnet med tak-generatorens regler: de øverste bjelkene, med omrisset av bjelkenes utvendige flate ({0} takflater).", r.sno.flater.length) + "</p>";
      if (r.sno.kilde === "stal" && r.sno.profil) h += '<p class="la-tom">' + t("Fant ingen takbjelker — taket er lest av stålet (uten søyler og søyleforlengere): {0}, {1}°. Velg takform for å skrive inn vinkelen selv.", formNavn[r.sno.profil.form] || "", kn1(r.sno.profil.vinkel)) + "</p>";
      if (r.sno.kilde === "stal-vinkel" && r.sno.profil) h += '<p class="la-tom">' + t("Takvinkelen du skrev inn ({0}°) er brukt på taket lest av stålet ({1}).", kn1(r.sno.profil.vinkel), formNavn[r.sno.profil.form] || "") + "</p>";
      for (const f of r.sno.flater)
        h += rad(esc(f.navn) + " · " + kn1(f.alfa) + "° · μ1 " + kn(f.mu), kn(f.s) + " kN/m² · " + Math.round(f.total) + " kN");
      const tot = r.sno.flater.reduce((s, f) => s + f.total, 0);
      h += rad("<b>" + t("Sum snølast på taket") + "</b>", "<b>" + Math.round(tot) + " kN</b>");
      sr.innerHTML = h;
    }
  }
  if (vr) {
    if (!r.vind) vr.innerHTML = '<p class="la-tom">' + t("Skriv inn vb,0 for å få vindlasten.") + "</p>";
    else {
      const v = r.vind, qp = v.q.qp;
      let h = advarsel(vindAdvarsler(data)) + rad(t("Basisvindhastighet, vb"), kn(v.vb) + " m/s") +
        '<p class="la-tom">' + ikon("fasade") + " " + (v.kilde === "omriss" || v.kilde === "omriss-sw"
          ? t("Fasadene er kantene av byggets omriss sett ovenfra ({0} fasader) — likt med og uten veggelementer. Sonene dekker hver fasade fra ende til ende og bunn til topp.", v.flater.length)
          : v.kilde === "sw"
          ? t("Sonene ligger utenpå veggelementene og ringmuren ({0} fasader), fra ende til ende og bunn til topp.", v.flater.length)
          : t("Ingen SW-vegger: sonene ligger utenpå stålsøylene i hver fasade, fra ende til ende og bunn til topp.")) + "</p>" +
        rad(t("Byggehøyde h · b · d"), kn(v.h) + " · " + kn(v.b) + " · " + kn(v.d) + " m") +
        rad(t("Vindkasthastighetstrykk qp(h)"), kn(qp / 1000) + " kN/m²");
      for (const k of ["D", "E", "A", "B", "C"]) {
        const A = v.perFlate.filter(x => x.sone === k).reduce((s, x) => s + x.areal, 0);
        if (!(A > 1e-6)) continue;
        const navn = { D: t("D – lo-vegg (trykk)"), E: t("E – le-vegg (sug)"), A: "A", B: "B", C: "C" }[k];
        h += rad(navn + " · cpe " + fortegn(v.cpe[k]), fortegn(we(qp, v.cpe[k])) + " kN/m² · " + kn(A) + " m² · " + fortegn(kraft(qp, v.cpe[k], A)) + " kN");
      }
      h += '<h4>' + t("Per fasade") + "</h4>";
      const rekke = { D: 0, A: 1, B: 2, C: 3, E: 4 };
      for (const x of v.perFlate.slice().sort((a, b) => a.fi - b.fi || rekke[a.sone] - rekke[b.sone]))
        h += rad(esc(v.flater[x.fi].navn) + " · " + x.sone + " · " + kn(x.areal) + " m²",
          fortegn(we(qp, v.cpe[x.sone])) + " kN/m² · " + fortegn(kraft(qp, v.cpe[x.sone], x.areal)) + " kN");
      const sumA = v.perFlate.reduce((s, x) => s + x.areal, 0);
      h += rad("<b>" + t("Sum veggareal") + "</b>", "<b>" + kn(sumA) + " m²</b>");
      if (v.tak) for (const k of ["F", "G", "H", "I"]) {
        const A = v.tak.soner.filter(z => z.sone === k).reduce((s, z) => s + z.areal, 0);
        if (!(A > 1e-6)) continue;
        h += rad(t("Tak {0}", k) + " · cpe " + fortegn(CPE_FLATT_TAK[k]) + " · " + kn(A) + " m²",
          fortegn(we(qp, CPE_FLATT_TAK[k])) + " kN/m²" + (k === "I" ? " / " + fortegn(we(qp, CPE_FLATT_TAK.Iminus)) : ""));
      }
      else h += '<p class="la-tom">' + t("Vind på skrått tak (over 5°) er ikke med i denne versjonen — se tabell 7.3–7.4 i standarden.") + "</p>";
      vr.innerHTML = h;
    }
  }
}

// ---------- Knappen og modellbytte ----------
på("btnLaster", "click", () => {
  const panel = $("lasterPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  les();
  fraTerreng = { kommune: false, H: false };
  tegnPanel();
  apnePanel("lasterPanel");
  fyllFraTerreng();   // tegner panelet på nytt når kommunen er funnet
  lesMeta();          // typenavnene (bjelke/søyle) trengs for takflatene
});

// Typenavnene fra IFC-tråden hentes asynkront — samme venting som «Generer
// tak» gjør. Når de er lest, regnes takflatene og fasadene på nytt.
let metaLest = "";
async function lesMeta() {
  if (S.glbActive || metaLest === S.fileName) return;
  try {
    const { sikreMeta } = await import("./ifcrpc.js");
    const { alleElementIder } = await import("./ifc.js");
    await sikreMeta(alleElementIder);
    metaLest = S.fileName; metaVersjon++;
    if ($("lasterPanel") && $("lasterPanel").classList.contains("open")) { tegnPanel(); if (visSno || visVind) tegn(); }
  } catch (err) { console.warn("Snø & Last: typenavnene kunne ikke leses", err); }
}

// Ny modell: lastdataene hører til modellen, og visningen ryddes
S.ryddLaster = () => { metaLest = ""; visSno = visVind = false; rydd(); data = {}; fraTerreng = { kommune: false, H: false }; };

export const __test = { regnUt, byggFasader, glemFlater: () => { flateHurtig = { nokkel: "", verdi: null }; }, settData: (d) => { data = vaskLastdata(d); }, hentData: () => data, fyllFraTerreng };
