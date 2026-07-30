// Microsoft Graph: innlogging og modellbibliotek fra SharePoint.
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { afterLoad, clearLoadFlag, ifcReady, loadGlb, loadModel, offerLightRetry, setLoadFlag } from "./ifc.js";

// ---------- SharePoint-bibliotek (Microsoft Graph) ----------
export const SP = {
  clientId: "4470b31d-c68d-4c64-a3b1-c450c47c292a",  // app-registrering: Storm IFC-Viewer
  tenantId: "4daa24b2-8144-4c77-b00d-5a91bf914e73",  // Storm Entreprenør AS
  hostname: "stormentrepreno.sharepoint.com",        // SharePoint-adressen
  sitePath: "/sites/StormProsjektTegninger",         // området med modellene
  folder: "IFC-modeller",                            // mappe i Dokumenter-biblioteket
  lightFolder: "IFC-modeller/Lette kopier"           // 💾 lette kopier (.glb) ligger her
};

// Biblioteket har to faner, så fulle modeller og lette kopier ikke ligger i
// samme liste. Filtypen bestemmer hvilken fane en fil hører til – en .glb som
// ligger løst i hovedmappa vises derfor under 🪶 Lette kopier, med en merknad.
export const LIB_FANER = [
  { key: "full", tittel: "📐 Modeller", mappe: () => SP.folder, filtype: /\.ifc$/i },
  { key: "lett", tittel: "🪶 Lette kopier", mappe: () => SP.lightFolder, filtype: /\.glb$/i }
];

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
    const t = (await S.msalApp.acquireTokenSilent({ scopes, account })).accessToken;
    // MSAL kan svare med tom streng når en hurtigbufret oppføring er utløpt.
    // Da må vi be om nytt token, ikke sende et tomt.
    if (t && String(t).trim()) return t;
    console.warn("MSAL ga tomt token for " + scopes.join(", ") + " – ber om nytt");
    if (o.silent) return null;
    if (o.confirmFirst && !confirm(o.confirmFirst)) return null;
    sessionStorage.setItem("storm-ifc-open-lib", o.after || "lib");
    await S.msalApp.acquireTokenRedirect({ scopes });
    return null;
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

// Alle Graph-kall skal gå gjennom denne. Sender vi et tomt token, svarer Graph
// «InvalidAuthenticationToken: Access token is empty» – en ubrukelig melding for
// den som står der. Vi stopper før det, sier hva som mangler, og logger hvilken
// forespørsel det gjaldt.
export const IKKE_INNLOGGET =
  "Du er ikke innlogget mot SharePoint (eller innloggingen er utløpt). " +
  "Åpne 📚 Biblioteket og logg inn, så prøv igjen.";

export function authHeaders(token, ekstra, hva) {
  if (!token || !String(token).trim()) {
    console.warn("Graph-kall stoppet uten token" + (hva ? " (" + hva + ")" : ""));
    throw new Error(IKKE_INNLOGGET);
  }
  return Object.assign({ Authorization: "Bearer " + token }, ekstra || {});
}

export async function graphGet(path, token) {
  const r = await fetch(GRAPH + path, { headers: authHeaders(token, null, path) });
  if (!r.ok) {
    const kropp = (await r.text()).slice(0, 200);
    if (r.status === 401 || /InvalidAuthenticationToken/.test(kropp)) {
      console.warn("Graph 401 på " + path);
      throw new Error(IKKE_INNLOGGET);
    }
    throw new Error("Graph " + r.status + ": " + kropp);
  }
  return r.json();
}

// Leser én mappe. Mangler mappa (404) svarer vi med tom liste i stedet for feil –
// «Lette kopier» finnes ikke i alle prosjekter.
async function spFetchFolder(mappe, token) {
  const folderPath = mappe.split("/").map(encodeURIComponent).join("/");
  try {
    const data = await graphGet("/sites/" + S.spSiteId + "/drive/root:/" + folderPath +
      ":/children?$top=999&$select=id,name,size,lastModifiedDateTime,file,eTag,cTag", token);
    return (data.value || []).filter(f => f.file);
  } catch (err) {
    if (/Graph 404/.test(err.message)) return [];
    throw err;
  }
}

async function spFetchList(fane) {
  const token = await spToken();
  if (!token) return null; // på vei til innlogging
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  const f = LIB_FANER.find(x => x.key === fane) || LIB_FANER[0];
  const egne = (await spFetchFolder(f.mappe(), token)).filter(x => f.filtype.test(x.name));
  // Lette kopier som ligger løst i hovedmappa skal ikke bli usynlige – de vises
  // i lett-fanen, merket, så de kan brukes og etter hvert ryddes på plass.
  let løse = [];
  if (f.key === "lett") {
    løse = (await spFetchFolder(SP.folder, token))
      .filter(x => f.filtype.test(x.name))
      .map(x => Object.assign({}, x, { løs: true }));
  }
  return egne.concat(løse).sort((a, b) => a.name.localeCompare(b.name, "no"));
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
  const fane = LIB_FANER.find(x => x.key === S.libFane) || LIB_FANER[0];
  const faneHtml = '<div class="prop-actions lib-faner">' + LIB_FANER.map(f =>
    '<button data-fane="' + f.key + '"' + (f.key === fane.key ? ' class="active"' : "") + '>' +
    esc(f.tittel) + '</button>').join("") + '</div>';
  const kobleFaner = () => {
    body.querySelectorAll("[data-fane]").forEach(b => {
      b.onclick = () => { if (b.dataset.fane !== S.libFane) { S.libFane = b.dataset.fane; openLibrary(); } };
    });
  };

  body.innerHTML = faneHtml + '<p style="color:var(--muted)">Henter fil-liste fra SharePoint …</p>';
  kobleFaner();
  try {
    const files = await spFetchList(fane.key);
    if (files === null) {
      body.innerHTML = faneHtml + '<p style="color:var(--muted)">Sender deg til Microsoft-innlogging …</p>';
      kobleFaner();
      return;
    }
    S.spFiles = files;
    body.innerHTML = faneHtml +
      '<input type="search" id="libSearch" placeholder="🔍 Søk etter modell …" autocomplete="off">' +
      '<div id="libList"></div>';
    kobleFaner();
    $("libSearch").addEventListener("input", () => renderLibList($("libSearch").value));
    renderLibList("");
  } catch (err) {
    body.innerHTML = faneHtml + '<p style="color:#ef4444">Feil: ' + esc(err.message) + '</p>' +
      '<p style="color:var(--muted); font-size:11px; margin-top:8px">Sjekk at mappen «' + esc(fane.mappe()) + '» finnes på ' + esc(SP.sitePath) + ' og at du har tilgang.</p>';
    kobleFaner();
  }
}

function renderLibList(filter) {
  const listEl = $("libList");
  const fane = LIB_FANER.find(x => x.key === S.libFane) || LIB_FANER[0];
  const q = filter.trim().toLowerCase();
  const list = (S.spFiles || []).filter(f => f.name.toLowerCase().includes(q));
  if (!S.spFiles || !S.spFiles.length) {
    listEl.innerHTML = '<p style="color:var(--muted)">Ingen filer i «' + esc(fane.mappe()) + '» ennå.' +
      (fane.key === "lett"
        ? ' Lag en med 💾 Lett kopi og legg .glb-filen i denne mappa.'
        : '') + '</p>';
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
      '<div class="m">' + mb + (d ? " · " + d : "") +
      (f.løs ? ' · <span style="color:var(--accent2)">ligger i ' + esc(SP.folder) + '</span>' : "") +
      '</div></div>';
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
    loadingText.textContent = "Laster ned " + item.name + " …";
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
        // «Laster ned» sier tydelig at dette er nedlastingen fra SharePoint, og
        // ikke selve lesingen av modellen. To prosentvisninger etter hverandre
        // så ut som om modellen ble lastet to ganger.
        loadingText.textContent = "Laster ned " + item.name + " … " +
          Math.min(100, Math.round(got / total * 100)) + " %";
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
