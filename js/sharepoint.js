// Microsoft Graph: innlogging og modellbibliotek fra SharePoint.
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { afterLoad, clearLoadFlag, ifcReady, loadGlb, loadModel, offerLightRetry, setLoadFlag } from "./ifc.js";
import { hentFraBiblioteket, hentIndeks, sammeStempel, stempelAv } from "./lite.js";

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
  // Kom vi nettopp tilbake fra innlogging? Fortsett der brukeren var.
  if (S.msalApp.getActiveAccount()) {
    const after = sessionStorage.getItem("storm-ifc-open-lib");
    if (after) {
      sessionStorage.removeItem("storm-ifc-open-lib");
      if (after === "markeringer") $("commentPanel").classList.add("open");
      else openLibrary();
    }
  }
  return S.msalApp;
}

// Token for et vilkårlig sett Graph-tillatelser. Egne scope-sett gir
// «inkrementell samtykke»: brukeren spør bare om Planner-tilgang den dagen
// hun faktisk lager en Planner-oppgave.
//   silent: true  → gir null i stedet for å sende brukeren til innlogging
//   after: "lib" | "markeringer" → hva som skal åpnes når vi kommer tilbake
export async function graphToken(scopes, opts) {
  const o = opts || {};
  await msalInit();
  const account = S.msalApp.getActiveAccount();
  if (!account) {
    if (o.silent) return null;
    sessionStorage.setItem("storm-ifc-open-lib", o.after || "lib");
    await S.msalApp.loginRedirect({ scopes });
    return null;
  }
  try {
    return (await S.msalApp.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (_) {
    if (o.silent) return null;
    if (o.confirmFirst && !confirm(o.confirmFirst)) return null;
    sessionStorage.setItem("storm-ifc-open-lib", o.after || "lib");
    await S.msalApp.acquireTokenRedirect({ scopes });
    return null;
  }
}

if (!SP.clientId.startsWith("FYLL")) msalInit().catch(() => {});

async function spToken() {
  return graphToken(SP_SCOPES, { after: "lib" });
}

// Stille token-henting: brukes av bakgrunns-synk (delte markeringer).
// Sender ALDRI brukeren til innlogging – gir null hvis vi ikke er logget inn.
export async function spTokenSilent() {
  return graphToken(SP_SCOPES, { silent: true });
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
    ":/children?$top=999&$select=id,name,size,lastModifiedDateTime,file,eTag,cTag", token);
  return (data.value || [])
    .filter(f => f.file && /\.(ifc|glb)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "no"));
}

$("btnLib").addEventListener("click", () => {
  const panel = $("libPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  ["propPanel", "commentPanel", "qtyPanel", "colorPanel", "axesPanel", "comparePanel", "searchPanel"].forEach(id => $(id).classList.remove("open"));
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
    // hvilke modeller har en fersk rask kopi? Én forespørsel for hele lista.
    S.liteIndeks = await hentIndeks();
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
    const rask = raskKopiFor(f);
    return '<div class="lib-item" data-id="' + esc(f.id) + '">' +
      '<div class="n">' + esc(f.name) + '</div>' +
      '<div class="m">' + mb + (d ? " · " + d : "") +
        (rask ? ' · <span class="lite-badge" title="Det finnes en rask kopi av denne versjonen">⚡ rask kopi</span>' : "") +
      '</div>' +
      (rask ? '<button class="lib-lite" data-lite="' + esc(f.id) + '" ' +
        'title="Åpner på sekunder. Uten full egenskapsliste – bruk originalen for psets.">⚡ Åpne rask</button>' : "") +
      '</div>';
  }).join("");
  listEl.querySelectorAll("[data-lite]").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const f = S.spFiles.find(x => x.id === b.dataset.lite);
      if (f) spOpenLite(f);
    });
  });
  listEl.querySelectorAll(".lib-item").forEach(el => {
    el.addEventListener("click", () => {
      const f = S.spFiles.find(x => x.id === el.dataset.id);
      if (f) spOpenFile(f);
    });
  });
}

// Har denne modellen en rask kopi som er laget av NÅVÆRENDE versjon?
function raskKopiFor(f) {
  const rad = S.liteIndeks && S.liteIndeks[f.name];
  if (!rad) return null;
  return sammeStempel(rad.stempel, stempelAv(f)) ? rad : null;
}

// ⚡ Åpne den raske kopien i stedet for IFC-en
async function spOpenLite(f) {
  const rad = raskKopiFor(f);
  if (!rad) { spOpenFile(f); return; }
  $("libPanel").classList.remove("open");
  loadingEl.classList.add("open");
  try {
    loadingText.textContent = "Henter rask kopi av " + f.name + " …";
    const bytes = await hentFraBiblioteket(rad.fil);
    if (!bytes) throw new Error("Fikk ingen fil");
    S.fileName = f.name;
    S.lastBuffer = bytes;
    setLoadFlag({ name: f.name, size: f.size, light: true, libId: f.id, lite: true });
    await loadGlb(bytes);
    afterLoad();
    clearLoadFlag();
    if (S.rememberModel) S.rememberModel({ kind: "lib", name: f.name, size: f.size, id: f.id });
  } catch (err) {
    clearLoadFlag();
    if (confirm("Klarte ikke å åpne den raske kopien (" + err.message + ").\n\nÅpne originalmodellen i stedet?")) spOpenFile(f);
  } finally {
    loadingEl.classList.remove("open");
  }
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
    // stempel fra selve IFC-en: brukes til å avgjøre om en rask kopi er fersk
    S.liteKilde = stempelAv(meta) || stempelAv(item);
    setLoadFlag({ name: item.name, size: item.size, light: S.lightMode, libId: item.id });
    if (isGlb) await loadGlb(buf); else await loadModel(buf);
    afterLoad();
    clearLoadFlag();
    if (S.rememberModel) S.rememberModel({ kind: "lib", name: item.name, size: item.size, id: item.id });
  } catch (err) {
    console.error(err);
    clearLoadFlag();
    if (!(await offerLightRetry(err))) alert("Klarte ikke å åpne fra biblioteket: " + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
}
