// Personlig oppsett i SharePoint: innstillinger og utseende følger BRUKEREN,
// ikke nettleseren. Én liten JSON-fil per person i IFC-modeller/Innstillinger.
// localStorage brukes fortsatt som hurtigbuffer, så viewer'en starter umiddelbart
// og virker fullt ut uten innlogging.
import { S } from "./state.js";
import { GRAPH, SP, graphGet, spTokenSilent } from "./sharepoint.js";
import { DEFAULT_APPEAR, DEFAULT_KEYS, DEFAULT_SETTINGS, saveAppear, saveSettings } from "./prefs.js";
import { applyMiniSize, setMini } from "./minimap.js";
import { applyAxisFont } from "./axes.js";

const PREFS_VERSION = 1;
let lastPushed = "";   // hindrer at vi skriver samme innhold flere ganger
let pushTimer = null;

// Filnavn av brukerens e-post: emil@stormentreprenor.no -> emil_stormentreprenor.no.json
function prefsFileName() {
  const acc = S.msalApp && S.msalApp.getActiveAccount();
  const upn = (acc && (acc.username || acc.homeAccountId)) || "";
  if (!upn) return null;
  return upn.toLowerCase().replace(/[^a-z0-9._-]+/g, "_") + ".json";
}

function prefsFilePath(name) {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/Innstillinger/" + encodeURIComponent(name);
}

async function siteId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

// Oppretter Innstillinger-mappa første gang noen lagrer
async function ensureFolder(token, sid) {
  const parent = "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/");
  await fetch(GRAPH + "/sites/" + sid + parent + ":/children", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Innstillinger", folder: {}, "@microsoft.graph.conflictBehavior": "replace" })
  }).catch(() => {});
}

// Alt som skal følge brukeren, samlet i ett objekt
function collectPrefs() {
  return {
    version: PREFS_VERSION,
    updated: new Date().toISOString(),
    settings: S.settings,
    appear: S.appear,
    bg: localStorage.getItem("storm-ifc-bg") || null,
    axisFont: S.axisFontF,
    snapOn: S.snapOn,
    snapPx: S.snapPx,
    miniOn: S.miniOn,
    lightMode: S.lightMode
  };
}

// Legger et hentet oppsett på plass i kjørende viewer
function applyPrefs(p) {
  if (!p || typeof p !== "object") return;
  if (p.settings) {
    S.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings);
    S.settings.keys = Object.assign({}, DEFAULT_KEYS, p.settings.keys || {});
    saveSettings();
    applyMiniSize();
  }
  if (p.appear) {
    S.appear = Object.assign({}, DEFAULT_APPEAR, p.appear);
    S.appear.colors = p.appear.colors || {};
    S.appear.hiddenTypes = p.appear.hiddenTypes || [];
    saveAppear();
  }
  if (p.bg) {
    try { localStorage.setItem("storm-ifc-bg", p.bg); } catch (_) {}
    if (S.scene) S.scene.background.set(p.bg);
  }
  if (typeof p.axisFont === "number") {
    S.axisFontF = p.axisFont;
    try { localStorage.setItem("storm-ifc-axisfont", p.axisFont); } catch (_) {}
    try { applyAxisFont(); } catch (_) {}
  }
  if (typeof p.snapOn === "boolean") {
    S.snapOn = p.snapOn;
    try { localStorage.setItem("storm-ifc-snap", p.snapOn ? "1" : "0"); } catch (_) {}
  }
  if (typeof p.snapPx === "number") {
    S.snapPx = p.snapPx;
    try { localStorage.setItem("storm-ifc-snappx", p.snapPx); } catch (_) {}
  }
  if (typeof p.miniOn === "boolean") setMini(p.miniOn);
  S.prefsSyncedAt = p.updated || null;
}

// Hentes ved innlogging. Nyeste versjon vinner: har skya et nyere tidsstempel
// enn det lokale oppsettet, brukes skyas – ellers lastes det lokale opp.
export async function pullUserPrefs() {
  const name = prefsFileName();
  if (!name) return;
  const token = await spTokenSilent();
  if (!token) return;
  try {
    const sid = await siteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + prefsFilePath(name) + ":/content",
      { headers: { Authorization: "Bearer " + token } });
    if (r.status === 404) { S.prefsCloudOK = true; pushUserPrefs(true); return; }
    if (!r.ok) throw new Error("Graph " + r.status);
    const remote = await r.json();
    const localStamp = localStorage.getItem("storm-ifc-prefs-updated") || "";
    if (!localStamp || !remote.updated || remote.updated >= localStamp) {
      applyPrefs(remote);
      try { localStorage.setItem("storm-ifc-prefs-updated", remote.updated || ""); } catch (_) {}
      lastPushed = JSON.stringify(Object.assign({}, remote, { updated: null }));
    } else {
      pushUserPrefs(true); // lokalt er nyere – send det opp
    }
    S.prefsCloudOK = true;
  } catch (err) {
    S.prefsCloudOK = false;
    console.warn("Kunne ikke hente personlig oppsett:", err.message);
  }
}

// Skriver oppsettet til SharePoint. Samlet opp med 2 sekunders forsinkelse
// så en slider som dras ikke gir hundre skrivinger.
export function pushUserPrefs(now) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, now ? 0 : 2000);
}

async function doPush() {
  const name = prefsFileName();
  if (!name) return;
  const data = collectPrefs();
  const fingerprint = JSON.stringify(Object.assign({}, data, { updated: null }));
  if (fingerprint === lastPushed) return; // ingen reell endring
  const token = await spTokenSilent();
  if (!token) return;
  try {
    const sid = await siteId(token);
    const put = () => fetch(GRAPH + "/sites/" + sid + prefsFilePath(name) + ":/content", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    let r = await put();
    if (r.status === 404) { await ensureFolder(token, sid); r = await put(); } // mappa fantes ikke
    if (!r.ok) throw new Error("Graph " + r.status);
    lastPushed = fingerprint;
    S.prefsCloudOK = true;
    try { localStorage.setItem("storm-ifc-prefs-updated", data.updated); } catch (_) {}
  } catch (err) {
    S.prefsCloudOK = false;
    console.warn("Kunne ikke lagre personlig oppsett:", err.message);
  }
}

// Alle steder som lagrer lokalt, kaller denne – da havner det også i skya.
S.syncPrefs = () => {
  try { localStorage.setItem("storm-ifc-prefs-updated", new Date().toISOString()); } catch (_) {}
  pushUserPrefs();
};

// sharepoint.js kaller denne når vi er innlogget
S.onSignedIn = () => { pullUserPrefs(); };

// Er brukeren allerede innlogget når siden lastes, hentes oppsettet med en gang.
// (msalInit kjører i bakgrunnen fra sharepoint.js og kaller S.onSignedIn.)
setTimeout(() => { if (!S.prefsCloudOK) pullUserPrefs(); }, 3000);
