// Personlig oppsett i SharePoint: innstillinger og utseende følger BRUKEREN,
// ikke nettleseren. Én liten JSON-fil per person i IFC-modeller/Innstillinger.
// localStorage brukes fortsatt som hurtigbuffer, så viewer'en starter umiddelbart
// og virker fullt ut uten innlogging.
import { DEFAULT_APPEAR, DEFAULT_KEYS, DEFAULT_SETTINGS, PREFS_VERSION, S, collectPrefs, writePrefs } from "./state.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { saveAppear, saveSettings } from "./prefs.js";
import { applyMiniSize, setMini } from "./minimap.js";
import { applyAxisFont } from "./axes.js";

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
    headers: authHeaders(token, { "Content-Type": "application/json" }, "oppsett"),
    body: JSON.stringify({ name: "Innstillinger", folder: {}, "@microsoft.graph.conflictBehavior": "replace" })
  }).catch(() => {});
}

// Samme oppsett som lagres lokalt (state.js), med versjon og tidsstempel på toppen
function cloudPrefs() {
  return Object.assign({}, collectPrefs(), {
    version: PREFS_VERSION,
    updated: S.prefsUpdated || new Date().toISOString()
  });
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
    S.bg = p.bg;
    if (S.scene) S.scene.background.set(p.bg);
  }
  if (typeof p.axisFont === "number") {
    S.axisFontF = p.axisFont;
    try { applyAxisFont(); } catch (_) {}
  }
  if (typeof p.snapOn === "boolean") S.snapOn = p.snapOn;
  if (typeof p.snapPx === "number") S.snapPx = p.snapPx;
  if (typeof p.miniOn === "boolean") setMini(p.miniOn);
  S.prefsUpdated = p.updated || S.prefsUpdated;
  S.prefsSyncedAt = p.updated || null;
  writePrefs();   // alt havner i den ene lokale nøkkelen
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
      { headers: authHeaders(token, null, "oppsett") });
    if (r.status === 404) { S.prefsCloudOK = true; pushUserPrefs(true); return; }
    if (!r.ok) throw new Error("Graph " + r.status);
    const remote = await r.json();
    const localStamp = S.prefsUpdated || "";
    if (!localStamp || !remote.updated || remote.updated >= localStamp) {
      applyPrefs(remote);
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
  const data = cloudPrefs();
  const fingerprint = JSON.stringify(Object.assign({}, data, { updated: null }));
  if (fingerprint === lastPushed) return; // ingen reell endring
  const token = await spTokenSilent();
  if (!token) return;
  try {
    const sid = await siteId(token);
    const put = () => fetch(GRAPH + "/sites/" + sid + prefsFilePath(name) + ":/content", {
      method: "PUT",
      headers: authHeaders(token, { "Content-Type": "application/json" }, "oppsett"),
      body: JSON.stringify(data)
    });
    let r = await put();
    if (r.status === 404) { await ensureFolder(token, sid); r = await put(); } // mappa fantes ikke
    if (!r.ok) throw new Error("Graph " + r.status);
    lastPushed = fingerprint;
    S.prefsCloudOK = true;
    S.prefsUpdated = data.updated;
    writePrefs();
  } catch (err) {
    S.prefsCloudOK = false;
    console.warn("Kunne ikke lagre personlig oppsett:", err.message);
  }
}

// Alle steder som lagrer lokalt, kaller denne – da havner det også i skya.
S.syncPrefs = () => {
  S.prefsUpdated = new Date().toISOString();
  writePrefs();
  pushUserPrefs();
};

// sharepoint.js kaller denne når vi er innlogget
S.onSignedIn = () => { pullUserPrefs(); };

// Er brukeren allerede innlogget når siden lastes, hentes oppsettet med en gang.
// (msalInit kjører i bakgrunnen fra sharepoint.js og kaller S.onSignedIn.)
setTimeout(() => { if (!S.prefsCloudOK) pullUserPrefs(); }, 3000);
