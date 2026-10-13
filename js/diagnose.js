// 🩺 FEILINFO PÅ BYGGEPLASSEN (bygg.html)
//
// HVORFOR (Emil 13.10): «noen ganger får kollegaer ikke lastet inn modellen
// etter at de har puttet inn koden — alle det ikke har virket for bruker
// Samsung». Vi har ingen Samsung å teste på, og montøren har ingen konsoll.
// Når noe feiler, viser denne boksen alt som trengs for å finne årsaken:
// hvilket steg som stoppet, feilteksten, telefon, nettleser, grafikkbrikke,
// minne og modellstørrelse. Montøren tar et skjermbilde og sender det.
//
// SENDER INGENTING. Alt vises bare på skjermen til den som har telefonen —
// ingen ny rute i Workeren, ingen persondata ut.
//
// KRÆSJ FANGES OGSÅ. Går telefonen tom for minne midt i lastingen, dør fanen
// og siden lastes på nytt — da rekker ingen catch å kjøre. Derfor skrives
// steget til localStorage FØR hvert steg, og slettes når modellen er tegnet.
// Står det et uferdig steg der ved neste oppstart, viser vi boksen da.
//
// Ren modul uten avhengighet til 3D-motoren: den skal virke også når det er
// nettopp WebGL som ikke vil. Importeres FØRST i lett-main.js.
import { t } from "./i18n.js";

const NOKKEL = "storm-diag";
const KRAESJ_VINDU = 15 * 60 * 1000;   // eldre enn 15 min = gammel historie, ikke vis

const tilstand = { steg: "", data: {}, sisteFeil: "", startet: Date.now() };

// ---------- Siste ukjente feil fra hvor som helst på siden ----------
// bygg.html viser dem allerede i statuslinja; vi tar vare på teksten til boksen.
window.addEventListener("error", (e) => {
  const hvor = e.filename ? " [" + e.filename.split("/").pop() + ":" + e.lineno + "]" : "";
  tilstand.sisteFeil = (e.message || "ukjent") + hvor;
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  tilstand.sisteFeil = (r && r.message ? r.message : String(r)) +
    (r && r.stack ? " [" + ((/([A-Za-z0-9_.-]+\.m?js:\d+)/.exec(r.stack) || [])[1] || "") + "]" : "");
});

function lagre(obj) { try { localStorage.setItem(NOKKEL, JSON.stringify(obj)); } catch (_) {} }
function les() { try { return JSON.parse(localStorage.getItem(NOKKEL) || "null"); } catch (_) { return null; } }
function glem() { try { localStorage.removeItem(NOKKEL); } catch (_) {} }

// Kalles FØR hvert steg i lastingen. data slås sammen med det som var.
export function diagSteg(steg, data) {
  tilstand.steg = steg;
  Object.assign(tilstand.data, data || {});
  // Koden lagres ikke på disk — den trengs bare i boksen her og nå.
  const { kode, ...uten } = tilstand.data;
  lagre({ steg, data: uten, tid: Date.now() });
}

// Modellen er tegnet — ingenting å rapportere.
export function diagFerdig() {
  tilstand.steg = "ferdig";
  glem();
}

// Ny lasting begynner: glem forrige modells tall.
export function diagNullstill() { tilstand.steg = ""; tilstand.data = {}; }

// ---------- Hva telefonen sier om seg selv ----------
function webglInfo() {
  const ut = {};
  try {
    const c = document.createElement("canvas");
    let gl = c.getContext("webgl2"); ut.webgl = gl ? "WebGL 2" : "";
    if (!gl) { gl = c.getContext("webgl") || c.getContext("experimental-webgl"); ut.webgl = gl ? "WebGL 1" : "MANGLER"; }
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      ut.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      ut.gpuLeverandor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      ut.maksTekstur = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();      // gi fra oss testkonteksten med en gang
    }
  } catch (e) { ut.webgl = "feil: " + (e && e.message); }
  return ut;
}

async function telefonInfo() {
  const n = navigator;
  const ut = { ua: n.userAgent || "" };
  try {
    if (n.userAgentData && n.userAgentData.getHighEntropyValues) {
      const h = await n.userAgentData.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]);
      ut.modell = h.model || "";
      ut.os = (n.userAgentData.platform || "") + " " + (h.platformVersion || "");
      ut.nettleser = (h.fullVersionList || []).filter(b => !/Not.?A.?Brand/i.test(b.brand))
        .map(b => b.brand + " " + b.version).join(", ");
    }
  } catch (_) {}
  // Samsung Internet sier fra i UA-strengen; telefonmodellen står ofte der også.
  const sam = /SamsungBrowser\/([\d.]+)/.exec(ut.ua);
  if (sam) ut.nettleser = "Samsung Internet " + sam[1] + (ut.nettleser ? " (" + ut.nettleser + ")" : "");
  if (!ut.modell) { const m = /Android [\d.]+; ([^;)]+)/.exec(ut.ua); if (m) ut.modell = m[1]; }
  if (!ut.os) { const a = /Android ([\d.]+)/.exec(ut.ua); ut.os = a ? "Android " + a[1] : (/iPhone|iPad/.test(ut.ua) ? "iOS" : ""); }
  ut.minne = n.deviceMemory ? n.deviceMemory + " GB" : "ukjent";
  try { if (performance.memory) ut.jsMinne = Math.round(performance.memory.jsHeapSizeLimit / 1048576) + " MB grense"; } catch (_) {}
  ut.skjerm = screen.width + "×" + screen.height + " @" + Math.round((window.devicePixelRatio || 1) * 100) / 100;
  ut.nett = (n.onLine ? "på nett" : "AV NETT") + (n.connection && n.connection.effectiveType ? " · " + n.connection.effectiveType : "");
  try {
    const nav = await caches.keys();
    ut.versjon = (nav.find(k => k.startsWith("storm-skall-")) || "").replace("storm-skall-", "") || "ingen cache";
  } catch (_) { ut.versjon = "ukjent"; }
  ut.sw = n.serviceWorker && n.serviceWorker.controller ? "aktiv" : "ikke aktiv";
  return ut;
}

const STEG_TEKST = {
  "kode": "sjekker koden",
  "henter": "kobler til for å hente modellen",
  "laster ned": "laster ned modellen",
  "leser modellen": "leser modellen (minnekrevende)",
  "tegner": "tegner modellen i 3D",
  "3d": "3D-grafikken"
};

const mb = (b) => !b ? "" : b < 1048576 ? Math.round(b / 1024) + " kB" : (b / 1048576).toFixed(1) + " MB";

async function lagTekst(feil, steg, data, ekstra) {
  const tel = await telefonInfo();
  const gl = webglInfo();
  const d = data || {};
  const linjer = [
    ["Tid", new Date().toLocaleString("no-NO")],
    ["Stoppet ved", STEG_TEKST[steg] || steg || "ukjent"],
    ["Feil", feil || "(ingen feiltekst)"],
    ["Prosjekt", d.prosjekt || ""],
    ["Kode sendt", d.kode ? d.kode + " (" + d.kode.length + " tegn)" : ""],
    ["Svar fra server", d.status ? "HTTP " + d.status + (d.svar ? " · " + d.svar : "") : ""],
    ["Modell", d.url ? decodeURIComponent(String(d.url).split("/").pop().split("?")[0]) : ""],
    ["Størrelse", mb(d.bytes) || mb(d.forventet)],
    ["Telefon", tel.modell],
    ["System", tel.os],
    ["Nettleser", tel.nettleser],
    ["Grafikk", (gl.webgl || "") + (gl.gpu ? " · " + gl.gpu : "") + (gl.maksTekstur ? " · tekstur " + gl.maksTekstur : "")],
    ["Minne", tel.minne + (tel.jsMinne ? " · " + tel.jsMinne : "")],
    ["Skjerm", tel.skjerm],
    ["Nett", tel.nett],
    ["Appversjon", tel.versjon + " · SW " + tel.sw],
    ["Siste sidefeil", tilstand.sisteFeil],
    ["UA", tel.ua]
  ].concat(ekstra || []);
  return linjer.filter(([, v]) => v !== "" && v != null).map(([k, v]) => k + ": " + v).join("\n");
}

// ---------- Boksen ----------
export async function visDiagnose(feil, steg, innledning) {
  const tekst = await lagTekst(feil, steg || tilstand.steg, tilstand.data);
  let boks = document.getElementById("diagBoks");
  if (boks) boks.remove();
  boks = document.createElement("div");
  boks.id = "diagBoks";
  boks.className = "diag-boks";
  boks.setAttribute("role", "dialog");
  boks.innerHTML =
    '<div class="diag-kort">' +
      '<h3>🩺 ' + t("Feilinfo") + '</h3>' +
      (innledning ? '<p class="diag-inn"></p>' : "") +
      '<p class="diag-hjelp">' + t("Ta et skjermbilde av denne boksen og send det til den som ga deg koden.") + '</p>' +
      '<pre class="diag-tekst"></pre>' +
      '<div class="diag-knapper">' +
        '<button class="btn" data-k="kopier">' + t("Kopier") + '</button>' +
        '<button class="btn primary" data-k="lukk">' + t("Lukk") + '</button>' +
      '</div>' +
    '</div>';
  if (innledning) boks.querySelector(".diag-inn").textContent = innledning;
  boks.querySelector(".diag-tekst").textContent = tekst;
  boks.querySelector('[data-k="lukk"]').onclick = () => boks.remove();
  boks.querySelector('[data-k="kopier"]').onclick = async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(tekst); b.textContent = t("Kopiert"); }
    catch (_) {
      // Eldre nettlesere / ikke-sikker kontekst: merk teksten, så kan den kopieres for hånd
      const r = document.createRange(); r.selectNodeContents(boks.querySelector(".diag-tekst"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  };
  document.body.appendChild(boks);
  return tekst;
}

// Les feilen som Error, tekst eller hva som helst.
export function feilTekst(err) {
  if (!err) return "";
  if (err.tidsavbrudd) return "Tidsavbrudd (ingen svar fra serveren)";
  return (err.name && err.name !== "Error" ? err.name + ": " : "") + (err.message || String(err));
}

// Et uferdig steg fra forrige gang = fanen døde under lastingen.
export function sjekkForrigeForsok() {
  const f = les();
  if (!f || !f.steg || f.steg === "ferdig" || f.steg === "kode") { glem(); return null; }
  if (!f.tid || Date.now() - f.tid > KRAESJ_VINDU) { glem(); return null; }
  glem();
  tilstand.data = f.data || {};
  visDiagnose("Siden ble lastet på nytt midt i lastingen (" + Math.round((Date.now() - f.tid) / 1000) + " s siden)",
    f.steg, t("Forrige forsøk stoppet mens modellen ble lastet. Telefonen kan ha gått tom for minne."));
  return f;
}
