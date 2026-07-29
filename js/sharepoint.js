// Microsoft Graph: innlogging og modellbibliotek fra SharePoint.
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { afterLoad, clearLoadFlag, ifcReady, loadGlb, loadModel, offerLightRetry, setLoadFlag } from "./ifc.js";

// ---------- SharePoint-bibliotek (Microsoft Graph) ----------
export const SP = {
  clientId: "4470b31d-c68d-4c64-a3b1-c450c47c292a",  // app-registrering: Storm IFC-Viewer
  tenantId: "4daa24b2-8144-4c77-b00d-5a91bf914e73",  // Storm Entreprenør AS
  hostname: "stormentrepreno.sharepoint.com",        // SharePoint-adressen
  sitePath: "/sites/StormProsjektTegninger",         // området med modellene
  folder: "IFC-modeller"                             // mappe i Dokumenter-biblioteket
};

export const GRAPH = "https://graph.microsoft.com/v1.0";

const SP_SCOPES = ["Sites.Read.All", "Files.Read.All", "Files.ReadWrite.All"];

S.msalApp = null; S.spSiteId = null; S.spFiles = null;

async function msalInit() {
  if (S.msalApp) return S.msalApp;
  if (!window.msal) throw new Error("Innloggings-biblioteket (MSAL) lastet ikke – sjekk nettforbindelsen");
  S.msalApp = new msal.PublicClientApplication({
    auth: {
      clientId: SP.clientId,
      authority: "https://login.microsoftonline.com/" + SP.tenantId,
      redirectUri: location.origin + location.pathname
    },
    cache: { cacheLocation: "localStorage" }
  });
  await S.msalApp.initialize();
  const res = await S.msalApp.handleRedirectPromise();
  if (res && res.account) S.msalApp.setActiveAccount(res.account);
  else {
    const accs = S.msalApp.getAllAccounts();
    if (accs.length) S.msalApp.setActiveAccount(accs[0]);
  }
  // Er vi logget inn? Hent brukerens personlige oppsett fra SharePoint.
  if (S.msalApp.getActiveAccount() && S.onSignedIn) S.onSignedIn();
  // Kom vi nettopp tilbake fra innlogging? Åpne biblioteket igjen.
  if (S.msalApp.getActiveAccount() && sessionStorage.getItem("storm-ifc-open-lib")) {
    sessionStorage.removeItem("storm-ifc-open-lib");
    openLibrary();
  }
  return S.msalApp;
}

if (!SP.clientId.startsWith("FYLL")) msalInit().catch(() => {});

async function spToken() {
  await msalInit();
  const account = S.msalApp.getActiveAccount();
  if (!account) {
    sessionStorage.setItem("storm-ifc-open-lib", "1");
    await S.msalApp.loginRedirect({ scopes: SP_SCOPES });
    return null;
  }
  try {
    return (await S.msalApp.acquireTokenSilent({ scopes: SP_SCOPES, account })).accessToken;
  } catch (_) {
    sessionStorage.setItem("storm-ifc-open-lib", "1");
    await S.msalApp.loginRedirect({ scopes: SP_SCOPES });
    return null;
  }
}

// Stille token-henting: brukes av bakgrunns-synk (delte markeringer).
// Sender ALDRI brukeren til innlogging – gir null hvis vi ikke er logget inn.
export async function spTokenSilent() {
  try {
    await msalInit();
    const account = S.msalApp.getActiveAccount();
    if (!account) return null;
    return (await S.msalApp.acquireTokenSilent({ scopes: SP_SCOPES, account })).accessToken;
  } catch(_) { return null; }
}

export async function graphGet(path, token) {
  const r = await fetch(GRAPH + path, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("Graph " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}

async function spFetchList() {
  const token = await spToken();
  if (!token) return null; // på vei til innlogging
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  const folderPath = SP.folder.split("/").map(encodeURIComponent).join("/");
  const data = await graphGet("/sites/" + S.spSiteId + "/drive/root:/" + folderPath +
    ":/children?$top=999&$select=id,name,size,lastModifiedDateTime,file", token);
  return (data.value || [])
    .filter(f => f.file && /\.(ifc|glb)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "no"));
}

$("btnLib").addEventListener("click", () => {
  const panel = $("libPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  ["propPanel", "commentPanel", "qtyPanel", "colorPanel", "axesPanel", "searchPanel"].forEach(id => $(id).classList.remove("open"));
  openLibrary();
});

$("btnLibSplash").addEventListener("click", openLibrary);

async function openLibrary() {
  const body = $("libBody");
  $("libPanel").classList.add("open");
  if (SP.clientId.startsWith("FYLL")) {
    body.innerHTML = '<p style="color:var(--muted)">Biblioteket er ikke satt opp ennå – client-ID mangler i konfigurasjonen.</p>';
    return;
  }
  body.innerHTML = '<p style="color:var(--muted)">Henter fil-liste fra SharePoint …</p>';
  try {
    const files = await spFetchList();
    if (files === null) {
      body.innerHTML = '<p style="color:var(--muted)">Sender deg til Microsoft-innlogging …</p>';
      return;
    }
    S.spFiles = files;
    body.innerHTML =
      '<input type="search" id="libSearch" placeholder="🔍 Søk etter modell …" autocomplete="off">' +
      '<div id="libList"></div>';
    $("libSearch").addEventListener("input", () => renderLibList($("libSearch").value));
    renderLibList("");
  } catch (err) {
    body.innerHTML = '<p style="color:#ef4444">Feil: ' + esc(err.message) + '</p>' +
      '<p style="color:var(--muted); font-size:11px; margin-top:8px">Sjekk at mappen «' + esc(SP.folder) + '» finnes på ' + esc(SP.sitePath) + ' og at du har tilgang.</p>';
  }
}

function renderLibList(filter) {
  const listEl = $("libList");
  const q = filter.trim().toLowerCase();
  const list = (S.spFiles || []).filter(f => f.name.toLowerCase().includes(q));
  if (!S.spFiles || !S.spFiles.length) {
    listEl.innerHTML = '<p style="color:var(--muted)">Ingen IFC-filer i mappen «' + esc(SP.folder) + '» ennå.</p>';
    return;
  }
  if (!list.length) {
    listEl.innerHTML = '<p style="color:var(--muted)">Ingen treff på «' + esc(filter) + '».</p>';
    return;
  }
  listEl.innerHTML = list.map(f => {
    const mb = f.size ? (f.size / 1048576).toFixed(1) + " MB" : "";
    const d = f.lastModifiedDateTime ? new Date(f.lastModifiedDateTime).toLocaleDateString("no-NO") : "";
    return '<div class="lib-item" data-id="' + esc(f.id) + '">' +
      '<div class="n">' + esc(f.name) + '</div>' +
      '<div class="m">' + mb + (d ? " · " + d : "") + '</div></div>';
  }).join("");
  listEl.querySelectorAll(".lib-item").forEach(el => {
    el.addEventListener("click", () => {
      const f = S.spFiles.find(x => x.id === el.dataset.id);
      if (f) spOpenFile(f);
    });
  });
}

export async function spOpenFile(item) {
  $("libPanel").classList.remove("open");
  loadingEl.classList.add("open");
  try {
    loadingText.textContent = "Henter " + item.name + " …";
    const token = await spToken();
    if (!token) return;
    if (!S.spSiteId) {
      const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
      S.spSiteId = site.id;
    }
    const meta = await graphGet("/sites/" + S.spSiteId + "/drive/items/" + item.id, token);
    const url = meta["@microsoft.graph.downloadUrl"];
    if (!url) throw new Error("Fikk ingen nedlastingslenke fra SharePoint");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Nedlasting feilet (" + resp.status + ")");
    let buf;
    const total = Number(resp.headers.get("Content-Length")) || item.size || 0;
    if (resp.body && total) {
      const reader = resp.body.getReader();
      const chunks = [];
      let got = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        loadingText.textContent = "Henter " + item.name + " … " + Math.min(100, Math.round(got / total * 100)) + " %";
      }
      buf = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { buf.set(c, o); o += c.length; }
    } else {
      buf = new Uint8Array(await resp.arrayBuffer());
    }
    const isGlb = /\.glb$/i.test(item.name);
    loadingText.textContent = "Leser " + item.name + " …";
    if (!isGlb) await ifcReady;
    await new Promise(r => setTimeout(r, 30));
    S.fileName = item.name;
    S.lastBuffer = buf;
    setLoadFlag({ name: item.name, size: item.size, light: S.lightMode, libId: item.id });
    if (isGlb) await loadGlb(buf); else loadModel(buf);
    afterLoad();
    clearLoadFlag();
  } catch (err) {
    console.error(err);
    clearLoadFlag();
    if (!(await offerLightRetry(err))) alert("Klarte ikke å åpne fra biblioteket: " + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
}
