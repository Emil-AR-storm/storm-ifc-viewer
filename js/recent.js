// «▶ Fortsett med …» – knapp på startskjermen som gjenåpner sist brukte modell.
//
// Ingenting lastes automatisk; du må trykke. Vi lagrer aldri modellfilen selv:
//  • biblioteksmodeller huskes med SharePoint-ID og hentes på nytt
//  • lokale filer huskes med et FileSystemFileHandle – en peker på noen få hundre
//    byte, ikke innholdet. Nettleseren spør om tilgang på nytt ved trykk, og vi
//    leser alltid filen som den er nå (ingen utdatert kopi).
//  • uten håndtak (Safari/Firefox, eller fil valgt via den gamle filvelgeren)
//    viser knappen navnet og åpner filvelgeren i stedet.
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { openLocalFile } from "./ifc.js";
import { spOpenFile } from "./sharepoint.js";

const DB_NAME = "storm-ifc";
const STORE = "recent";
const REC_KEY = "last";

// ---------- Bittelite IndexedDB-lag (filhåndtak kan ikke ligge i localStorage) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB mangler"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Kunne ikke åpne IndexedDB"));
  });
}

function idbPut(rec) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec, REC_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function idbGet() {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(REC_KEY);
    r.onsuccess = () => { const v = r.result; db.close(); resolve(v || null); };
    r.onerror = () => { db.close(); reject(r.error); };
  }));
}

function idbDel() {
  return openDb().then(db => new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(REC_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  })).catch(() => {});
}

// ---------- Huske ----------
// Kalles fra ifc.js (lokal fil) og sharepoint.js (bibliotek) etter vellykket lasting.
S.rememberModel = (rec) => {
  if (!rec || !rec.name) return;
  const clean = {
    kind: rec.kind === "lib" ? "lib" : "local",
    name: rec.name,
    size: rec.size || 0,
    id: rec.id || null,
    handle: rec.handle || null,
    at: new Date().toISOString()
  };
  render(clean);   // knappen skal vises selv om lagringen skulle feile
  idbPut(clean).catch(() => {
    // Noen nettlesere nekter å lagre filhåndtaket. Da husker vi resten, slik at
    // knappen i det minste kan tilby å velge filen på nytt.
    const noHandle = Object.assign({}, clean, { handle: null });
    return idbPut(noHandle);
  }).catch(err => console.warn("Kunne ikke huske modellen:", err.message));
};

// ---------- Knappen på startskjermen ----------
function fmtSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1 ? " · " + mb.toFixed(mb < 10 ? 1 : 0) + " MB" : " · " + Math.round(bytes / 1024) + " kB";
}

// «i dag 09:14», «i går», «for 3 dager siden»
function fmtWhen(iso) {
  const ts = Date.parse(iso);
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return t("sist åpnet i dag");
  if (days === 1) return t("sist åpnet i går");
  if (days < 30) return t("sist åpnet for {0} dager siden", days);
  return t("sist åpnet {0}", new Date(ts).toLocaleDateString("no-NO"));
}

export function render(rec) {
  const box = $("resumeBox");
  if (!box) return;
  if (!rec) { box.style.display = "none"; box.innerHTML = ""; return; }
  const where = rec.kind === "lib" ? t("Biblioteket") : t("Din maskin") + (rec.handle ? "" : t(" – må velges på nytt"));
  box.style.display = "";
  box.innerHTML =
    '<button id="resumeBtn" class="primary" style="font-size:15px; padding:12px 20px; max-width:100%">' +
      ikon("fortsett") + ' ' + t("Fortsett med") + ' <b style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px; display:inline-block; vertical-align:bottom">' +
      esc(rec.name) + '</b></button>' +
    '<div style="color:var(--muted); font-size:11px; margin-top:6px">' + where + fmtSize(rec.size) +
      ' · ' + fmtWhen(rec.at) + ' · <a href="#" id="resumeForget" style="color:var(--muted)">' + t("glem") + '</a></div>';

  $("resumeBtn").onclick = () => resume(rec);
  $("resumeForget").onclick = (e) => { e.preventDefault(); idbDel(); render(null); };
}

export async function resume(rec) {
  if (rec.kind === "lib") {
    await spOpenFile({ id: rec.id, name: rec.name, size: rec.size });
    return;
  }
  // Lokal fil uten håndtak: vi kan ikke åpne den selv, så vi hjelper på vei
  if (!rec.handle || !rec.handle.getFile) {
    alert(t("Velg «{0}» på nytt – nettleseren tillater ikke at siden åpner en lokal fil av seg selv.", rec.name));
    $("fileInput").click();
    return;
  }
  try {
    let perm = "granted";
    if (rec.handle.queryPermission) perm = await rec.handle.queryPermission({ mode: "read" });
    if (perm !== "granted" && rec.handle.requestPermission) {
      perm = await rec.handle.requestPermission({ mode: "read" });
    }
    if (perm !== "granted") {
      alert(t("Fikk ikke tilgang til filen. Velg den på nytt med Åpne-knappen."));
      return;
    }
    const file = await rec.handle.getFile();
    await openLocalFile(file, rec.handle);
  } catch (err) {
    console.warn("Kunne ikke gjenåpne:", err);
    if (/NotFound|NotAllowed/i.test(err.name || "")) {
      alert(t("Fant ikke «{0}» der den lå sist. Er den flyttet eller slettet? Velg den på nytt med Åpne-knappen.", rec.name));
      idbDel(); render(null);
    } else {
      alert(t("Klarte ikke å gjenåpne filen: ") + err.message);
    }
  }
}

// Vis knappen ved oppstart hvis vi husker noe
idbGet().then(rec => { if (rec) render(rec); }).catch(() => {});
