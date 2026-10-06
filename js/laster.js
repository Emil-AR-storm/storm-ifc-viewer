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
import { swGroup } from "./veggelement/tilstand.js";
import { foldSeksjoner } from "./seksjoner.js";
import { forskyvLapper, meldMaalLapper } from "./maal-verktoy.js";
import {
  CPE_FLATT_TAK, TERRENG, cpeVegg, flattTakSoner, mu1, snoMark, snoTak, tall, vaskLastdata,
  veggSoner, vindBasis, vindTrykk, we
} from "./laster-regn.js";

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
// Bygget = modellen + det SW-generatoren har lagt på (vegger, tak, blikk):
// byggehøyden til vind skal måles til mønet, ikke til toppen av stålet.
function boks() {
  if (!S.modelGroup) return null;
  const b = new THREE.Box3().setFromObject(S.modelGroup);
  if (swGroup && swGroup.children.length) {
    const sb = new THREE.Box3();
    for (const o of swGroup.children) if (o.visible !== false) sb.expandByObject(o);
    if (!sb.isEmpty()) b.union(sb);
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

// Uten tak-generatoren: taket over modellens topp, med takvinkelen som er
// skrevet inn. Saltaket deles på langs (mønet langs den lange siden).
function manuelleTakflater(form, vinkel) {
  const b = boks();
  if (!b) return [];
  const s = skala();
  const Lx = (b.max.x - b.min.x) * s, Lz = (b.max.z - b.min.z) * s;
  const a = form === "flatt" ? 0 : Math.max(0, Math.min(89, tall(vinkel) || 0));
  const y = b.max.y;
  const kvad = (x0, x1, z0, z1) => [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1)];
  const flate = (navn, poly, planM2) => ({ navn, alfa: a, arealPlan: planM2, arealSkraa: planM2 / Math.cos(a * Math.PI / 180), polygon: poly, normal: new THREE.Vector3(0, 1, 0) });
  if (form === "saltak") {
    if (Lx >= Lz) {
      const zm = (b.min.z + b.max.z) / 2;
      return [flate(t("Takhalvdel {0}", 1), kvad(b.min.x, b.max.x, b.min.z, zm), Lx * Lz / 2),
              flate(t("Takhalvdel {0}", 2), kvad(b.min.x, b.max.x, zm, b.max.z), Lx * Lz / 2)];
    }
    const xm = (b.min.x + b.max.x) / 2;
    return [flate(t("Takhalvdel {0}", 1), kvad(b.min.x, xm, b.min.z, b.max.z), Lx * Lz / 2),
            flate(t("Takhalvdel {0}", 2), kvad(xm, b.max.x, b.min.z, b.max.z), Lx * Lz / 2)];
  }
  return [flate(t("Tak"), kvad(b.min.x, b.max.x, b.min.z, b.max.z), Lx * Lz)];
}

function takflater() {
  const form = data.takform || "auto";
  if (form === "auto") {
    const g = takflaterFraGenerator();
    if (g.length) return { kilde: "generator", flater: g };
    return { kilde: "mangler", flater: manuelleTakflater("flatt", 0) };
  }
  return { kilde: "manuell", flater: manuelleTakflater(form, data.takvinkel) };
}

// ---------- Utregningen ----------
const RETNINGER = [
  { navn: "→ +X", d: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1), start: (bx) => new THREE.Vector3(bx.min.x, 0, bx.min.z) },
  { navn: "↓ +Z", d: new THREE.Vector3(0, 0, 1), b: new THREE.Vector3(1, 0, 0), start: (bx) => new THREE.Vector3(bx.min.x, 0, bx.min.z) },
  { navn: "← −X", d: new THREE.Vector3(-1, 0, 0), b: new THREE.Vector3(0, 0, 1), start: (bx) => new THREE.Vector3(bx.max.x, 0, bx.min.z) },
  { navn: "↑ −Z", d: new THREE.Vector3(0, 0, -1), b: new THREE.Vector3(1, 0, 0), start: (bx) => new THREE.Vector3(bx.min.x, 0, bx.max.z) }
];

export function regnUt() {
  const ut = { sno: null, vind: null };
  const sm = snoMark({ sk0: data.sk0, Hg: data.Hg, dsk: data.dsk, skMaks: data.skMaks, H: data.H });
  const tf = takflater();
  if (sm) {
    ut.sno = { ...sm, kilde: tf.kilde, flater: tf.flater.map(f => {
      const s = snoTak(sm.sk, f.alfa, data.Ce, data.Ct);
      return { ...f, mu: mu1(f.alfa), s, total: s * f.arealPlan };
    }) };
  }
  const vb = vindBasis(data);
  const bx = boks();
  if (vb != null && bx) {
    const s = skala();
    const r = RETNINGER[Number(data.retning || 0)] || RETNINGER[0];
    const Lx = (bx.max.x - bx.min.x) * s, Lz = (bx.max.z - bx.min.z) * s;
    const h = (bx.max.y - bx.min.y) * s;
    const d = Math.abs(r.d.x) > 0 ? Lx : Lz, b = Math.abs(r.d.x) > 0 ? Lz : Lx;
    const kat = TERRENG[data.terreng] ? data.terreng : "II";
    const q = vindTrykk(h, vb, kat);
    const cpe = cpeVegg(h / d);
    const soner = veggSoner(b, d, h);
    const tak = tf.flater.length && tf.flater.every(f => f.alfa < 5) ? flattTakSoner(b, d, h) : null;
    ut.vind = { vb, kat, h, b, d, q, cpe, soner, tak, retning: r };
  }
  return ut;
}

// ---------- 3D ----------
function rydd() {
  lasterGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  lasterGroup.clear();
}
function flateMesh(poly, farge, opasitet) {
  if (poly.length < 3) return null;
  const pos = [];
  for (let i = 1; i + 1 < poly.length; i++) pos.push(...poly[0].toArray(), ...poly[i].toArray(), ...poly[i + 1].toArray());
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
    const v = r.vind, s = skala();
    const o0 = v.retning.start(bx); o0.y = bx.min.y;
    const P = (dm, bm, ym) => o0.clone().addScaledVector(v.retning.d, dm / s).addScaledVector(v.retning.b, bm / s).add(new THREE.Vector3(0, ym / s, 0));
    const ut = (bx.max.x - bx.min.x + bx.max.z - bx.min.z) * 0.004;
    const qp = v.q.qp;
    const sone = (navn, cpe, hj, utover) => {
      const poly = hj.map(p => p.clone().addScaledVector(utover, ut));
      const m = flateMesh(poly, farge(cpe), 0.4);
      if (m) lasterGroup.add(m);
      const midt = poly.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(poly.length);
      lasterGroup.add(lappPaa(navn + "  " + fortegn(we(qp, cpe)) + " kN/m²", hex(farge(cpe)), midt));
    };
    const H = v.h, D = v.d, B = v.b;
    // lo-veggen (D) og le-veggen (E)
    sone("D", v.cpe.D, [P(0, 0, 0), P(0, B, 0), P(0, B, H), P(0, 0, H)], v.retning.d.clone().negate());
    sone("E", v.cpe.E, [P(D, 0, 0), P(D, B, 0), P(D, B, H), P(D, 0, H)], v.retning.d.clone());
    // sideveggene: A, B, C fra lo-kanten
    let fra = 0;
    for (const [navn, len] of [["A", v.soner.A], ["B", v.soner.B], ["C", v.soner.C]]) {
      if (!(len > 1e-9)) continue;
      const til = fra + len;
      sone(navn, v.cpe[navn], [P(fra, 0, 0), P(til, 0, 0), P(til, 0, H), P(fra, 0, H)], v.retning.b.clone().negate());
      sone(navn, v.cpe[navn], [P(fra, B, 0), P(til, B, 0), P(til, B, H), P(fra, B, H)], v.retning.b.clone());
      fra = til;
    }
    // flatt tak
    if (v.tak) for (const z of v.tak.soner) {
      const cpe = CPE_FLATT_TAK[z.sone];
      sone(z.sone, cpe, [P(z.v0, z.u0, H), P(z.v1, z.u0, H), P(z.v1, z.u1, H), P(z.v0, z.u1, H)], new THREE.Vector3(0, 1, 0));
    }
    // pila: hvor vinden kommer fra
    const lengde = Math.max(D, B) * 0.25 / s;
    const midtLo = P(0, B / 2, H / 2);
    const pil = new THREE.ArrowHelper(v.retning.d.clone(), midtLo.clone().addScaledVector(v.retning.d, -lengde * 1.2), lengde, 0x22d3ee, lengde * 0.3, lengde * 0.15);
    lasterGroup.add(pil);
    lasterGroup.add(lappPaa(t("Vind · qp {0} kN/m²", kn(qp / 1000)), "#22d3ee", midtLo.clone().addScaledVector(v.retning.d, -lengde * 1.4)));
  }
}

// ---------- Panelet ----------
const felt = (id, navn, enhet, hjelp) =>
  '<label>' + navn + (enhet ? ' <span style="opacity:.7">(' + enhet + ')</span>' : '') +
  '<input type="text" inputmode="decimal" data-felt="' + id + '" value="' + esc(data[id] || "") + '"' +
  (hjelp ? ' placeholder="' + esc(hjelp) + '"' : "") + "></label>";

function tegnPanel() {
  const body = $("lasterBody");
  if (!body) return;
  const terrengH = hFraTerreng();
  const kat = Object.entries(TERRENG).map(([k, v]) => '<option value="' + k + '"' + ((data.terreng || "II") === k ? " selected" : "") + ">" + esc(t(v.navn)) + "</option>").join("");
  const takf = [["auto", t("Fra tak-generatoren")], ["flatt", t("Flatt tak")], ["pult", t("Pulttak")], ["saltak", t("Saltak")]]
    .map(([k, n]) => '<option value="' + k + '"' + ((data.takform || "auto") === k ? " selected" : "") + ">" + n + "</option>").join("");
  body.innerHTML =
    '<div class="laster-forbehold">' + ikon("advarsel") + " " +
      t("Veiledende kontroll og visualisering. Erstatter ikke RIB, som har ansvaret for prosjekteringen (PRO). Kommuneverdiene skrives inn fra NS-EN 1991-1-3 og NS-EN 1991-1-4 med nasjonalt tillegg, eller fra RIBs lastforutsetninger.") + "</div>" +
    '<div class="prop-actions" data-sw-fast><button id="laSno">' + t("Vis snølast") + '</button><button id="laVind">' + t("Vis vindlast") + "</button></div>" +
    '<h4 data-sek="la-sted">' + t("Sted") + "</h4>" +
    felt("kommune", t("Kommune"), "", t("f.eks. Modum")) +
    felt("H", t("Høyde over havet, H"), "moh", terrengH != null ? t("fra terrenget: {0}", terrengH) : "") +
    (terrengH != null ? '<div class="prop-actions"><button id="laHentH">' + t("Bruk høyden fra terrenget ({0} moh)", terrengH) + "</button></div>" : "") +
    '<h4 data-sek="la-sno">' + t("Snølast (NS-EN 1991-1-3)") + "</h4>" +
    felt("sk0", "sk,0", "kN/m²") + felt("Hg", "Hg", "moh") + felt("dsk", "Δsk", t("kN/m² per 100 m")) + felt("skMaks", "sk,maks", "kN/m²") +
    felt("Ce", "Ce", "", "1,0") + felt("Ct", "Ct", "", "1,0") +
    '<label>' + t("Taket") + '<select data-felt="takform">' + takf + "</select></label>" +
    felt("takvinkel", t("Takvinkel"), "°", "0") +
    '<div id="laSnoRes"></div>' +
    '<h4 data-sek="la-vind">' + t("Vindlast (NS-EN 1991-1-4)") + "</h4>" +
    felt("vb0", "vb,0", "m/s") + felt("cdir", "cdir", "", "1,0") + felt("cseason", "cseason", "", "1,0") +
    felt("calt", "calt", "", "1,0") + felt("cprob", "cprob", "", "1,0") +
    '<label>' + t("Terrengkategori") + '<select data-felt="terreng">' + kat + "</select></label>" +
    '<label>' + t("Vindretning") + '</label><div class="prop-actions" id="laRetning">' +
      RETNINGER.map((r, i) => '<button data-retning="' + i + '"' + (String(data.retning || 0) === String(i) ? ' class="active"' : "") + ">" + r.navn + "</button>").join("") + "</div>" +
    '<div id="laVindRes"></div>';
  foldSeksjoner(body, { nokkel: "storm-laster-seksjoner-apne", standard: ["la-sted", "la-sno", "la-vind"] });
  body.querySelectorAll("[data-felt]").forEach(el => {
    const lagre = () => { data[el.dataset.felt] = el.value; skriv(); visResultat(); if (visSno || visVind) tegn(); };
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
function visResultat() {
  const r = regnUt();
  const sr = $("laSnoRes"), vr = $("laVindRes");
  if (sr) {
    if (!r.sno) sr.innerHTML = '<p class="la-tom">' + t("Skriv inn sk,0 (og Hg, Δsk og H) for å få snølasten.") + "</p>";
    else {
      let h = rad(t("Snølast på mark, sk"), kn(r.sno.sk) + " kN/m²" + (r.sno.n ? " (n = " + r.sno.n + ")" : "") + (r.sno.kappet ? " · sk,maks" : ""));
      if (r.sno.kilde === "mangler") h += '<p class="la-tom">' + t("Tak-generatoren har ikke lagt tak — regnet som flatt tak over modellen. Velg takform og vinkel over.") + "</p>";
      for (const f of r.sno.flater)
        h += rad(esc(f.navn) + " · " + Math.round(f.alfa * 10) / 10 + "° · μ1 " + kn(f.mu), kn(f.s) + " kN/m² · " + Math.round(f.total) + " kN");
      const tot = r.sno.flater.reduce((s, f) => s + f.total, 0);
      h += rad("<b>" + t("Sum snølast på taket") + "</b>", "<b>" + Math.round(tot) + " kN</b>");
      sr.innerHTML = h;
    }
  }
  if (vr) {
    if (!r.vind) vr.innerHTML = '<p class="la-tom">' + t("Skriv inn vb,0 for å få vindlasten.") + "</p>";
    else {
      const v = r.vind;
      let h = rad(t("Basisvindhastighet, vb"), kn(v.vb) + " m/s") +
        rad(t("Byggehøyde h · b · d"), kn(v.h) + " · " + kn(v.b) + " · " + kn(v.d) + " m") +
        rad(t("Vindkasthastighetstrykk qp(h)"), kn(v.q.qp / 1000) + " kN/m²");
      for (const k of ["D", "E", "A", "B", "C"]) {
        if (k !== "D" && k !== "E" && !(v.soner[k] > 1e-9)) continue;
        const navn = { D: t("D – lo-vegg (trykk)"), E: t("E – le-vegg (sug)"), A: "A", B: "B", C: "C" }[k];
        h += rad(navn + " · cpe " + fortegn(v.cpe[k]), fortegn(we(v.q.qp, v.cpe[k])) + " kN/m²");
      }
      if (v.tak) for (const k of ["F", "G", "H", "I"])
        h += rad(t("Tak {0}", k) + " · cpe " + fortegn(CPE_FLATT_TAK[k]), fortegn(we(v.q.qp, CPE_FLATT_TAK[k])) + " kN/m²" + (k === "I" ? " / " + fortegn(we(v.q.qp, CPE_FLATT_TAK.Iminus)) : ""));
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
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  les();
  tegnPanel();
  apnePanel("lasterPanel");
});

// Ny modell: lastdataene hører til modellen, og visningen ryddes
S.ryddLaster = () => { visSno = visVind = false; rydd(); data = {}; };

export const __test = { RETNINGER, regnUt, settData: (d) => { data = vaskLastdata(d); } };
