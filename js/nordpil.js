// 🧭 NORDPIL UNDER KUBEN (Emils valg 5A, 05.11).
//
// En liten rund pil rett under kuben (Topp/Front/Høyre). Den dreier seg med
// kameraet; rød spiss = nord.
//
// VISES BARE NÅR NORD ER KJENT (Emil: «nordpil skal kun komme opp hvis det er
// satt i modellen, hvis ikke er det bare død data og støy»). Nord settes når
// bygget plasseres i ⛰ Terreng på kontoret: plass.rot er byggets rotasjon mot
// kartet, og S.terrengRef() gir den — både på kontoret (terreng.js) og på
// byggeplassen (terreng-vis.js). Uten plassering finnes ingen ekte nordretning,
// og da vises ingenting. Samme regel som riggplanen (riggplan.js).
//
// Begge sider (main.js og lett-main.js).
import { S } from "./state.js";
import { t } from "./i18n.js";
import { camera, controls, frameHooks } from "./scene.js";

// Nord i scenen, gitt byggets rotasjon (samme formel som nordRetning i
// terreng-regn.js — terrengets −Z dreid med rot rundt Y)
export function nordVektor(rot) {
  const v = (Number(rot) || 0) * Math.PI / 180;
  return { x: -Math.sin(v), z: -Math.cos(v) };
}

// Vinkelen pila skal dreies på skjermen (grader, med klokka, 0 = rett opp).
// fram: kameraets synsretning, hoyre/opp: kameraets akser — alle { x, y, z }.
// Ser kameraet nesten rett ned, er «fram» flat og ubrukelig; da brukes
// kameraets opp-akse lagt ned i planet i stedet.
export function skjermVinkel(nord, fram, hoyre, opp) {
  let fx = fram.x, fz = fram.z;
  if (Math.abs(fram.y) > 0.95 || Math.hypot(fx, fz) < 1e-6) { fx = opp.x; fz = opp.z; }
  const fl = Math.hypot(fx, fz) || 1;
  const hl = Math.hypot(hoyre.x, hoyre.z) || 1;
  const sy = (nord.x * fx + nord.z * fz) / fl;
  const sx = (nord.x * hoyre.x + nord.z * hoyre.z) / hl;
  return Math.atan2(sx, sy) * 180 / Math.PI;
}

let el = null;
function lag() {
  if (el || typeof document === "undefined") return el;
  el = document.createElement("div");
  el.id = "nordPil";
  el.className = "nord-pil";
  el.setAttribute("role", "img");
  el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" class="np-ring"/>' +
    '<g class="np-pil"><path d="M20 5 L27 24 L20 20 L13 24 Z" fill="#dc2626"/><path d="M20 35 L27 24 L20 20 L13 24 Z" class="np-sor"/></g></svg>' +
    '<span class="np-n">N</span>';
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
}

// Plasseringen av bygget leses sjelden (terrengRef kan regne på hele modellen)
let rot = null, sistSjekk = 0;
function lesRot() {
  const naa = Date.now();
  if (naa - sistSjekk < 1000) return rot;
  sistSjekk = naa;
  let ref = null;
  try { ref = S.modelGroup && S.terrengRef ? S.terrengRef() : null; } catch (_) { ref = null; }
  rot = ref && ref.plass && Number.isFinite(Number(ref.plass.rot)) ? Number(ref.plass.rot) : null;
  return rot;
}

let sistVinkel = null, sistTittel = "";
function tegn() {
  const e = lag();
  if (!e) return;
  const r = lesRot();
  const kube = document.getElementById("viewCube");
  const kubeSynlig = kube && kube.style.display !== "none" && kube.offsetWidth > 0;
  if (r === null || !S.modelGroup || !document.body.classList.contains("har-modell")) {
    if (e.style.display !== "none") e.style.display = "none";
    return;
  }
  // Under kuben — eller over den når kuben står nederst. Uten kube: oppe til høyre.
  const STR = 34;
  if (kubeSynlig) {
    const k = kube.getBoundingClientRect();
    e.style.left = Math.round(k.left + k.width / 2 - STR / 2) + "px";
    e.style.right = "auto";
    e.style.top = Math.round(k.top < window.innerHeight / 2 ? k.bottom + 6 : k.top - STR - 20) + "px";
  } else {
    e.style.left = "auto"; e.style.right = "16px"; e.style.top = "96px";
  }
  if (e.style.display === "none") e.style.display = "";
  // Kameraets akser fra matrisen: kolonne 0 = høyre, 1 = opp
  const m = camera.matrixWorld.elements;
  const hoyre = { x: m[0], y: m[1], z: m[2] }, opp = { x: m[4], y: m[5], z: m[6] };
  const fram = { x: controls.target.x - camera.position.x, y: 0, z: controls.target.z - camera.position.z };
  const lengde = Math.hypot(controls.target.x - camera.position.x, controls.target.y - camera.position.y, controls.target.z - camera.position.z) || 1;
  fram.y = (controls.target.y - camera.position.y) / lengde;
  const v = skjermVinkel(nordVektor(r), fram, hoyre, opp);
  if (sistVinkel === null || Math.abs(v - sistVinkel) > 0.3) {
    sistVinkel = v;
    const g = e.querySelector(".np-pil");
    if (g) g.setAttribute("transform", "rotate(" + v.toFixed(1) + " 20 20)");
  }
  const tittel = t("Nord — fra plasseringen i Terreng");
  if (tittel !== sistTittel) { sistTittel = tittel; e.title = tittel; e.setAttribute("aria-label", tittel); }
}

if (typeof document !== "undefined") frameHooks.push(tegn);
