// 📥 Kø for vedlegg som ikke kom fram — bilder og talemeldinger.
//
// HVORFOR DENNE FINNES: markeringer og svar har hatt en kø siden J5
// (js/markers.js KO_NOKKEL), men bilder og talemeldinger har ikke hatt det.
// Feilet opplastingen, kom det en alert og fila var borte. Montøren hadde tatt
// på seg hanskene, klatret opp, tatt etterbildet — og så fantes det ikke.
// På en byggeplass med dårlig dekning er det ikke et kanttilfelle, det er
// tirsdag.
//
// HVORFOR IndexedDB OG IKKE localStorage: localStorage tar bare tekst, og har
// et tak rundt 5 MB. Ett komprimert byggeplassbilde er 300–800 kB, og som
// base64 blir det en tredjedel større. Tre bilder og køen er full. IndexedDB
// tar binærdata uten koding, og har plass til hele dagen.
//
// HVORFOR ArrayBuffer OG IKKE Blob: IndexedDB kan lagre Blob-er direkte, og
// det var det første forsøket. Men eldre iOS-Safari har hatt feil der en
// lagret Blob kommer tomt tilbake — og byggeplassen er full av iPhone-er.
// ArrayBuffer er en ren bytesekvens som alle nettlesere håndterer likt, og
// Blob-en bygges opp igjen med mime-typen når fila skal sendes. Testen
// avdekket det samme i fake-indexeddb, som var flaks.
//
// SAMME BASE som js/recent.js («storm-ifc»), men eget lager. Åpne-dansen
// under er kopiert derfra med vilje: den håndterer at basen finnes fra før
// uten vårt lager, og det er nettopp tilfellet på en telefon som har brukt
// verktøyet før denne runden.
//
// FILA RØRER IKKE NETTET. Selve opplastingen ligger i js/bilder.js, som eier
// adressen og formatet. Lå den her også, ville de to kommet ut av takt første
// gang noen endret én av dem — samme grunn som at js/frist.js finnes.

const DB_NAME = "storm-ifc";
const STORE = "vedleggko";

// Tak på køen. Ikke fordi IndexedDB går tom, men fordi en kø som vokser i
// månedsvis er et symptom ingen ser: bedre å si fra ved 40 enn å oppdage 300.
export const MAKS_I_KO = 40;

function apneDb() {
  return new Promise((ja, nei) => {
    if (!window.indexedDB) return nei(new Error("IndexedDB mangler"));
    // Åpnes UTEN versjonsnummer: basen tas som den er. Ber vi om versjon 1 på
    // en base som står på 2, får vi VersionError og køen er død.
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return ja(db);
      // Basen finnes (recent.js laget den), men mangler vårt lager. Eneste
      // måten å legge det til er å åpne på nytt med versjon + 1.
      const v = db.version + 1;
      db.close();
      const req2 = indexedDB.open(DB_NAME, v);
      req2.onupgradeneeded = () => {
        const d = req2.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
      };
      req2.onsuccess = () => ja(req2.result);
      req2.onerror = () => nei(req2.error || new Error("Kunne ikke åpne IndexedDB"));
    };
    req.onerror = () => nei(req.error || new Error("Kunne ikke åpne IndexedDB"));
  });
}

function transaksjon(db, modus, fn) {
  return new Promise((ja, nei) => {
    const tx = db.transaction(STORE, modus);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ja(r && r.result !== undefined ? r.result : r);
    tx.onerror = () => nei(tx.error);
    tx.onabort = () => nei(tx.error || new Error("Avbrutt"));
  });
}

// ---------- Vasking ----------
// Alt som skal ligge lagret over tid vaskes før det legges inn. En post med
// feil felt er verre enn ingen post: køen prøver den om og om igjen, feiler
// hver gang, og blokkerer resten.
export function vaskPost(p) {
  if (!p || typeof p !== "object") return null;
  const navn = String(p.navn || "").trim();
  const bytes = p.bytes;
  if (!navn || !bytes || typeof bytes.byteLength !== "number" || !bytes.byteLength) return null;
  return {
    id: String(p.id || (Date.now() + "-" + Math.random().toString(36).slice(2, 8))),
    navn,
    mime: String(p.mime || "application/octet-stream"),
    seksjon: p.seksjon === "for" ? "for" : "etter",
    av: String(p.av || "").slice(0, 60),
    markering: p.markering == null ? "" : String(p.markering),
    bytes,
    opprettet: Number(p.opprettet) || Date.now(),
    forsok: Number(p.forsok) || 0
  };
}

// Fra Blob til lagringsklar post, og tilbake igjen.
export async function fraBlob(blob, felt) {
  const bytes = await blob.arrayBuffer();
  return Object.assign({}, felt, { bytes, mime: (felt && felt.mime) || blob.type });
}
export function tilBlob(post) {
  return new Blob([post.bytes], { type: post.mime || "application/octet-stream" });
}

// ---------- Operasjoner ----------

export async function koLegg(post) {
  const p = vaskPost(post);
  if (!p) throw new Error("Ugyldig vedlegg til køen");
  const db = await apneDb();
  try {
    const n = await transaksjon(db, "readonly", (s) => s.count());
    if (n >= MAKS_I_KO) throw new Error("KO_FULL");
    await transaksjon(db, "readwrite", (s) => s.put(p));
    return p;
  } finally { db.close(); }
}

export async function koAlle() {
  let db;
  try { db = await apneDb(); } catch (_) { return []; }
  try {
    const alle = await transaksjon(db, "readonly", (s) => s.getAll());
    // Eldst først: rekkefølgen montøren tok bildene i er den rekkefølgen
    // prosjektlederen skal se dem i.
    return (alle || []).sort((a, b) => (a.opprettet || 0) - (b.opprettet || 0));
  } catch (_) { return []; } finally { db.close(); }
}

export async function koAntall() {
  let db;
  try { db = await apneDb(); } catch (_) { return 0; }
  try { return await transaksjon(db, "readonly", (s) => s.count()) || 0; }
  catch (_) { return 0; } finally { db.close(); }
}

export async function koSlett(id) {
  const db = await apneDb();
  try { await transaksjon(db, "readwrite", (s) => s.delete(String(id))); }
  finally { db.close(); }
}

// Et forsøk mer på en post som fortsatt ikke gikk. Tallet brukes ikke til å gi
// opp — en byggeplass kan være uten dekning i dager — men det gjør det mulig å
// se at noe har stått fast lenge.
export async function koTelleForsok(id) {
  const db = await apneDb();
  try {
    const p = await transaksjon(db, "readonly", (s) => s.get(String(id)));
    if (!p) return 0;
    p.forsok = (Number(p.forsok) || 0) + 1;
    await transaksjon(db, "readwrite", (s) => s.put(p));
    return p.forsok;
  } catch (_) { return 0; } finally { db.close(); }
}
