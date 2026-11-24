// 🔴 «MODELLEN ER ENDRET» – rød prikk og stripe når noen andre har lagret noe
// på modellen du har åpen (Emil 24.11, prøvebilde C).
//
// HVORFOR. Markeringene, riggen, framdriften osv. hentes fra SharePoint når
// modellen åpnes – og ellers ikke. La Steffen inn to markeringer mens Emil
// hadde modellen åpen, så Emil dem først etter å ha lastet inn siden og åpnet
// modellen på nytt. Nå: rød prikk på SharePoint-prikken (som en app med ulest
// melding), en rød stripe under toppen som sier hva og hvem, og «Hent
// endringene», som henter bare det som er endret. Modellen, kameraet og det
// som er åpent blir stående.
//
// HVORDAN.
//   · Modulene melder fra om filene sine i S.delteFiler: { id, navn, mappe,
//     fil(), hent(), beskriv?(innhold, filAv) }.
//   · Hvert 2. minutt (og når fanen får fokus igjen) slås eTag og «sist endret
//     av» opp for hver fil – bare opplysningene om fila, ikke innholdet.
//   · Er eTag-en ny og det er NOEN ANDRE som lagret: endring. Er det deg selv
//     (lagring fra denne eller en annen fane, Storm Prosjekter med din
//     innlogging), godtas den stille.
//   · Markeringene leses for å si HVA (ny markering, status, svar) og hvem.
//   · «Hent endringene» kjører modulens egen innlasting (som flettes – ingenting
//     du holder på med forsvinner).
//
// Bare kontoret. Byggeplass-siden har sin egen teller (byggeplass.js).
import { $, S, esc } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { varsel } from "./varsel.js";
import { avFraGraph, endringLinje, erMeg, oppsummering } from "./endring-regn.js";

export const SJEKK_MS = 120000;          // hvert 2. minutt
const FOKUS_MS = 20000;                  // ved fokus: ikke oftere enn hvert 20. sekund
const FORSTE_MS = 8000;                  // første sjekk etter at modellen er åpnet

let fil = "";                            // modellen vi følger
const baseline = new Map();              // kilde-id → eTag vi har sett (og hentet)
const endringer = new Map();             // kilde-id → { navn, av, tid, eTag, linjer: [endring] }
let sisteSjekk = 0, sjekker = false, skjultSignatur = "", forsteTid = 0;

export const kilder = () => (S.delteFiler || []).filter(k => k && k.id && k.mappe && typeof k.fil === "function" && typeof k.hent === "function");

function meg() {
  try {
    const a = S.msalApp && S.msalApp.getActiveAccount();
    if (!a) return null;
    const c = a.idTokenClaims || {};
    return { id: String(c.oid || a.localAccountId || ""), navn: String(a.name || "") };
  } catch (_) { return null; }
}

function filSti(k) {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/" + encodeURIComponent(k.mappe) + "/" + encodeURIComponent(k.fil());
}

// Opplysningene om én fil: { eTag, endret, av } eller null (finnes ikke).
async function hentMeta(token, sid, k) {
  const r = await fetch(GRAPH + "/sites/" + sid + filSti(k) + "?$select=id,eTag,lastModifiedDateTime,lastModifiedBy",
    { headers: authHeaders(token, null, "endringsvarsel") });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Graph " + r.status);
  const j = await r.json();
  return { eTag: j.eTag || "", endret: j.lastModifiedDateTime || "", av: avFraGraph(j) };
}
async function hentInnhold(token, sid, k) {
  const r = await fetch(GRAPH + "/sites/" + sid + filSti(k) + ":/content", { headers: authHeaders(token, null, "endringsvarsel") });
  if (!r.ok) return null;
  return r.json();
}

// Selve sjekken. metaFor/innholdFor kan byttes ut i testene.
export async function sjekkMed(metaFor, innholdFor, jeg) {
  if (!fil) return;
  const forFil = fil;
  for (const k of kilder()) {
    let m;
    try { m = await metaFor(k); } catch (_) { continue; }        // nettfeil: prøv neste gang
    if (fil !== forFil) return;
    const eTag = m ? m.eTag : "";
    if (!baseline.has(k.id)) { baseline.set(k.id, eTag); continue; }   // første gang: slik den er nå
    if (eTag === baseline.get(k.id)) continue;
    const forrige = endringer.get(k.id);
    if (forrige && forrige.eTag === eTag) continue;                   // allerede meldt
    if (!m || erMeg(m.av, jeg)) {                                      // slettet, eller lagret av deg selv
      baseline.set(k.id, eTag); endringer.delete(k.id); continue;
    }
    const filAv = (m.av && m.av.navn) || "";
    let linjer = [];
    if (typeof k.beskriv === "function") {
      try { const inn = await innholdFor(k); linjer = inn ? (k.beskriv(inn, filAv) || []) : []; } catch (_) { linjer = []; }
      if (fil !== forFil) return;
      if (!linjer.length) { baseline.set(k.id, eTag); endringer.delete(k.id); continue; }   // ingenting nytt for deg
    }
    endringer.set(k.id, { id: k.id, navn: k.navn, av: filAv, tid: m.endret, eTag, linjer });
  }
  tegn();
}

export async function sjekk(tving) {
  if (LETT || sjekker || !fil) return;
  if (!tving && typeof document !== "undefined" && document.visibilityState === "hidden") return;
  sjekker = true; sisteSjekk = Date.now();
  try {
    const token = await spTokenSilent();
    if (!token) return;
    if (!S.spSiteId) S.spSiteId = (await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token)).id;
    const sid = S.spSiteId;
    await sjekkMed(k => hentMeta(token, sid, k), k => hentInnhold(token, sid, k), meg());
  } catch (_) { /* ingen nett / ikke innlogget: prøv neste gang */ }
  finally { sjekker = false; }
}

// Alle endringene som én liste: markeringer linje for linje, andre filer som én linje.
export function alleEndringer() {
  const ut = [];
  for (const e of endringer.values()) {
    if (e.linjer.length) ut.push(...e.linjer);
    else ut.push({ type: "fil", navn: e.navn, av: e.av, tid: e.tid });
  }
  return ut;
}

export async function hentEndringene() {
  const ider = [...endringer.keys()];
  if (!ider.length) return;
  const knapper = document.querySelectorAll("[data-endring-hent]");
  knapper.forEach(b => { b.disabled = true; b.textContent = t("Henter …"); });
  let feil = 0;
  for (const id of ider) {
    const k = kilder().find(x => x.id === id);
    const e = endringer.get(id);
    if (!k || !e) continue;
    try { await k.hent(); baseline.set(id, e.eTag); endringer.delete(id); }
    catch (err) { feil++; console.warn("Fikk ikke hentet " + id + ":", err && err.message); }
  }
  skjultSignatur = "";
  tegn();
  varsel(feil ? t("Noen av endringene kom ikke inn. Prøv igjen om litt.") : t("Endringene er hentet."), { type: feil ? "feil" : "info" });
}

function signatur() { return [...endringer.values()].map(e => e.id + ":" + e.eTag).join("|"); }

// ---------- Skjermen ----------
function plasserStripe(el) {
  let bunn = 0;
  for (const id of ["topbar", "toolbar"]) {
    const x = document.getElementById(id);
    if (!x || !x.getBoundingClientRect) continue;
    const r = x.getBoundingClientRect();
    if (r.height && r.bottom > bunn) bunn = r.bottom;
  }
  el.style.top = Math.max(0, Math.round(bunn)) + "px";
}

export function tegn() {
  if (typeof document === "undefined" || !document.body) return;
  const n = endringer.size;
  // 🔴 Prikken på SharePoint-prikken
  const knapp = $("btnInnlogging");
  if (knapp) {
    let p = knapp.querySelector(".endring-prikk");
    if (n && !p) { p = document.createElement("span"); p.className = "endring-prikk"; knapp.appendChild(p); }
    if (!n && p) p.remove();
    knapp.dataset.endring = n ? "1" : "";
    if (n) knapp.title = t("Modellen er endret av andre – trykk for å se hva");
  }
  // Stripa under toppen
  let el = document.getElementById("endringStripe");
  const vis = n && signatur() !== skjultSignatur;
  if (!vis) { if (el) el.remove(); }
  else {
    if (!el) { el = document.createElement("div"); el.id = "endringStripe"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.innerHTML = '<b>' + esc(t("Modellen er endret:")) + '</b> <span class="es-tekst">' + esc(oppsummering(alleEndringer(), t)) + '</span>' +
      '<span class="es-kn"><button type="button" class="primary" data-endring-hent>⟳ ' + esc(t("Hent endringene")) + '</button>' +
      '<button type="button" id="esSenere">' + esc(t("Senere")) + '</button></span>';
    el.querySelector("[data-endring-hent]").onclick = hentEndringene;
    el.querySelector("#esSenere").onclick = () => { skjultSignatur = signatur(); tegn(); };
    plasserStripe(el);
  }
  // Boksen bak prikken er åpen: tegn den på nytt
  const info = $("innloggingInfo");
  if (info && info.classList.contains("open") && S.tegnInnloggingInfo) S.tegnInnloggingInfo();
}

// Seksjonen øverst i boksen bak SharePoint-prikken (sharepoint.js tegnInfo).
S.endringerHtml = () => {
  if (!endringer.size) return "";
  const kl = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }); };
  const linjer = alleEndringer();
  return '<div class="endring-boks"><b>' + esc(t("Endringer i modellen siden du åpnet den")) + '</b><ul>' +
    linjer.map(e => '<li><span>' + esc(endringLinje(e, t)) + '</span><span class="m">' + esc([e.av, kl(e.tid)].filter(Boolean).join(" · ")) + '</span></li>').join("") +
    '</ul><div class="prop-actions"><button type="button" class="primary" data-endring-hent>⟳ ' + esc(t("Hent endringene")) + '</button></div>' +
    '<p class="set-hjelp">' + esc(t("Henter det som er endret. Modellen, kameraet og det du har åpent blir stående.")) + '</p></div>';
};
S.koblEndringer = (info) => {
  const b = info && info.querySelector("[data-endring-hent]");
  if (b) b.onclick = (e) => { e.stopPropagation(); hentEndringene(); };
};

// ---------- Når sjekkes det ----------
// Ny modell åpnet: alt nullstilles, og første sjekk tar «slik den er nå».
function følgModell() {
  const naa = S.fileName || "";
  if (naa === fil) return;
  fil = naa; baseline.clear(); endringer.clear(); skjultSignatur = "";
  forsteTid = naa ? Date.now() + FORSTE_MS : 0;
  tegn();
}
export function _tilstand() { return { fil, baseline, endringer, skjultSignatur }; }
export function _nullstill() { fil = S.fileName || ""; baseline.clear(); endringer.clear(); skjultSignatur = ""; }

if (!LETT && typeof window !== "undefined") {
  setInterval(() => {
    følgModell();
    if (!fil) return;
    if (forsteTid && Date.now() >= forsteTid) { forsteTid = 0; sjekk(); return; }
    if (!forsteTid && Date.now() - sisteSjekk >= SJEKK_MS) sjekk();
  }, 4000);
  const vedFokus = () => { følgModell(); if (fil && !forsteTid && Date.now() - sisteSjekk >= FOKUS_MS) sjekk(); };
  window.addEventListener("focus", vedFokus);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") vedFokus(); });
  window.addEventListener("resize", () => { const el = document.getElementById("endringStripe"); if (el) plasserStripe(el); });
}
