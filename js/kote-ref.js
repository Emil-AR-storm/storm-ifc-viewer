// ▲ ER KOTENE RIKTIGE? (Emil 24.11, prøvebilde B + felt i Innstillinger)
//
// Kote-verktøyet viser modellens egne høyder. Er modellen eksportert fra
// prosjektets nullpunkt, er 0 bunnen av bygget – ikke havet. Starter bygget
// mellom −5 og +5 m, SPØR Storm IFC (Emil: «spør om det er riktig eller ikke i
// stedet for å anta at det er feil eller riktig»):
//   · gul «?» på Kote-knappen til det er avklart
//   · første trykk med Kote: lappen får «?», og et kort spør «Er dette riktig
//     kote?» – «Ja, kotene er riktige», eller skriv koten fra tegningen for
//     punktet (valgfritt: hva punktet er). Forskjellen gjelder hele modellen.
//   · det samme kan gjøres i Innstillinger → Prosjektinfo (prosjektinfo.js)
// Koten lagres i Prosjektinfo i SharePoint (kollegaer, lette kopier og
// byggeplassen får den samme), og brukes av Kote, terrenget og laster.
//
// HVILKET PUNKT: nøyaktig der du trykker (treffpunktet på flata). Trykk på en
// flat, vannrett flate med kjent kote (OK gulv, OK fundament).
import * as THREE from "three";
import { $, S, esc, tilM } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { koteValue, oppdaterLengdeEtiketter } from "./measure.js";
import { camera, koteGroup, renderer } from "./scene.js";
import { varsel } from "./varsel.js";
import { fmtKote, koteForskyv, lesKoteTall } from "./prosjektinfo-regn.js";

// Modellens egen kote nederst i bygget (meter), uten forskyvning.
let bunnBuffer = null, bunnNokkel = "";
export function bunnRaa() {
  const g = S.modelGroup;
  if (!g) return null;
  const nokkel = (S.fileName || "") + "|" + g.uuid + "|" + g.children.length;
  if (bunnNokkel === nokkel) return bunnBuffer;
  let v = null;
  try {
    const b = new THREE.Box3().setFromObject(g);
    if (Number.isFinite(b.min.y)) {
      const c = b.getCenter(new THREE.Vector3());
      v = Math.round(tilM(koteValue(new THREE.Vector3(c.x, b.min.y, c.z))) * 1000) / 1000;
    }
  } catch (_) { v = null; }
  bunnBuffer = v; bunnNokkel = nokkel;
  return v;
}
S.koteBunnRaa = bunnRaa;

const status = () => (S.koteStatus ? S.koteStatus() : "ukjent");
const bunn = () => (S.koteBunnRaa ? S.koteBunnRaa() : bunnRaa());
const forskyv = () => (S.koteForskyv ? S.koteForskyv() : 0);

// Modellens gulv (laveste punkt) i moh. – til terrenget. null når det er usikkert.
S.modellBunnKote = () => {
  const st = status(), b = bunn();
  if (b == null || st === "usikker" || st === "ukjent") return null;
  return Math.round((b + forskyv()) * 1000) / 1000;
};

// ---------- Gul «?» på Kote-knappen ----------
export function oppdaterMerke() {
  const k = $("btnKote");
  if (!k) return;
  let m = k.querySelector(".kote-sp");
  const vis = !LETT && !!S.modelGroup && status() === "usikker";
  if (vis && !m) { m = document.createElement("span"); m.className = "kote-sp"; m.textContent = "?"; k.appendChild(m); }
  if (!vis && m) m.remove();
  if (vis) k.title = t("Kote – er kotene i modellen riktige? Trykk på et punkt for å avklare");
}

// ---------- Lappene tegnes om når koten endres ----------
function tegnLappeneOm() {
  const f = forskyv(), usikker = status() === "usikker";
  for (const o of koteGroup.children) {
    if (!o.isSprite || typeof o.userData.raa !== "number") continue;
    o.userData.meter = o.userData.raa + f;
    o.userData.usikker = usikker;
  }
  try { oppdaterLengdeEtiketter(); } catch (_) {}
}

// ---------- Kortet «Er dette riktig kote?» ----------
let avvist = "", velgNeste = false;
function lukkKort() { const k = document.getElementById("koteKort"); if (k) k.remove(); }

function plasser(el, punkt) {
  let x = innerWidth / 2, y = innerHeight / 2;
  try {
    const v = punkt.clone().project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    x = r.left + (v.x + 1) / 2 * r.width; y = r.top + (1 - v.y) / 2 * r.height;
  } catch (_) {}
  const b = Math.min(320, innerWidth - 24);
  el.style.width = b + "px";
  el.style.left = Math.max(12, Math.min(innerWidth - b - 12, x + 24)) + "px";
  el.style.top = Math.max(60, Math.min(innerHeight - 360, y - 60)) + "px";
}

export function visKort(punkt, raa) {
  lukkKort();
  const el = document.createElement("div");
  el.id = "koteKort"; el.className = "kote-kort"; el.setAttribute("role", "dialog");
  const b = bunn();
  el.innerHTML = '<b>' + esc(t("Er dette riktig kote?")) + '</b>' +
    '<p class="m">' + esc(b != null ? t("Modellen starter på {0}, så kotene kan være målt fra bygget og ikke meter over havet.", fmtKote(b)) : t("Skriv koten fra tegningen for punktet, så gjelder den hele modellen.")) + '</p>' +
    '<div class="kk-kn"><button type="button" id="kkRiktig">' + esc(t("Ja, kotene er riktige")) + '</button></div>' +
    '<label>' + esc(t("Riktig kote på dette punktet (fra tegningen)")) + '<input type="text" id="kkKote" inputmode="decimal" placeholder="' + esc(t("f.eks. 12,700")) + '"></label>' +
    '<label>' + esc(t("Hva er punktet? (valgfritt)")) + '<input type="text" id="kkPunkt" maxlength="80" placeholder="' + esc(t("f.eks. OK gulv 1. etasje, akse B3")) + '"></label>' +
    '<p class="m" id="kkFlytt">' + esc(t("Trykk på en flat, vannrett flate med kjent kote – koten gjelder nøyaktig punktet du trykket på.")) + '</p>' +
    '<div class="kk-kn"><button type="button" class="primary" id="kkLagre" disabled>' + esc(t("Lagre kote")) + '</button>' +
    '<button type="button" id="kkAvbryt">' + esc(t("Avbryt")) + '</button></div>';
  document.body.appendChild(el);
  plasser(el, punkt);
  const inn = el.querySelector("#kkKote");
  inn.oninput = () => {
    const v = lesKoteTall(inn.value);
    el.querySelector("#kkLagre").disabled = v == null;
    el.querySelector("#kkFlytt").textContent = v == null
      ? t("Trykk på en flat, vannrett flate med kjent kote – koten gjelder nøyaktig punktet du trykket på.")
      : t("Hele modellen flyttes {0} m. Gjelder Kote, terreng, vær og støpeplan – og for kollegaene dine.", fmtKote(v - raa));
  };
  inn.onkeydown = (e) => { if (e.key === "Enter" && !el.querySelector("#kkLagre").disabled) el.querySelector("#kkLagre").click(); };
  el.querySelector("#kkLagre").onclick = () => {
    const v = lesKoteTall(inn.value);
    if (v == null || !S.settKote) return;
    S.settKote({ forskyv: v - raa, kote: v, punktKote: raa, punkt: el.querySelector("#kkPunkt").value });
    lukkKort();
    varsel(t("Koten er lagret. Alle koter i modellen er flyttet {0} m.", fmtKote(v - raa)), { type: "info" });
  };
  el.querySelector("#kkRiktig").onclick = () => { if (S.settKote) S.settKote({ bekreftet: true }); lukkKort(); };
  el.querySelector("#kkAvbryt").onclick = () => { avvist = S.fileName || ""; lukkKort(); };
  try { inn.focus(); } catch (_) {}
}

// Kalles av main.js etter hver kote (uten terreng). Lappen får «?» mens det er usikkert.
S.koteSporsmal = (punkt, raa, lapp) => {
  if (LETT) return;
  const st = status();
  if (lapp && st === "usikker") lapp.userData.usikker = true;
  if (velgNeste || (st === "usikker" && avvist !== (S.fileName || ""))) { velgNeste = false; visKort(punkt, raa); }
};
// «▲ Velg punkt i modellen» i Innstillinger: neste trykk med Kote åpner kortet.
S.koteVelgPunkt = async () => {
  velgNeste = true;
  try { const M = await import("./modes.js"); if (S.mode !== "kote") M.setMode("kote"); } catch (_) {}
  varsel(t("Trykk på et punkt du kjenner koten til, f.eks. overkant gulv i 1. etasje."), { type: "info" });
};

// Koten er endret her (prosjektinfo.js) eller kom fra SharePoint (hendelsen)
S.koteEndret = () => { oppdaterMerke(); tegnLappeneOm(); };
if (typeof document !== "undefined") document.addEventListener("storm-prosjektinfo", () => S.koteEndret());
export const _tilstand = () => ({ avvist, velgNeste });
export const _nullstill = () => { avvist = ""; velgNeste = false; bunnNokkel = ""; lukkKort(); };
export { tegnLappeneOm, koteForskyv };
