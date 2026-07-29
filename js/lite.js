// 💾 Lett kopi (.glb): bygging, lokal buffer og deling via SharePoint.
//
// Kopien bygges fra geometrien som ALLEREDE ligger i scenen – ingen ny parsing,
// ingen omlasting av modellen. I full kvalitet slås mesh sammen per materiale
// (festemidler og bittesmå elementer utelates, som i 🪶 lav kvalitet); er
// modellen alt lastet i lav kvalitet, er den ferdig slått sammen.
//
// Duplikater unngås slik:
//   • fast filnavn «‹modell›.lett.glb» i mappa «Lette kopier», lastet opp med
//     conflictBehavior=replace → aldri to filer for samme modell
//   • en liten _index.json holder styr på hvilken IFC-versjon kopien er laget av
//     (eTag + størrelse). Stemmer ikke stempelet, er kopien foreldet og lages på
//     nytt – bedre enn å vise gammel geometri.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { S, loadingText, statusEl } from "./state.js";
import { kall, metaFor } from "./ifcrpc.js";
import { GRAPH, IKKE_INNLOGGET, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";

export const LETT_MAPPE = "Lette kopier";
export const INDEKS_FIL = "_index.json";

export const lettNavn = (modellnavn) =>
  String(modellnavn || "modell").replace(/\.(ifc|glb)$/i, "") + ".lett.glb";

// Stempel som forteller hvilken IFC-versjon kopien er laget av
export function stempelAv(item) {
  if (!item) return null;
  return { eTag: item.eTag || item.cTag || "", size: item.size || 0 };
}

export const sammeStempel = (a, b) =>
  !!a && !!b && String(a.eTag) === String(b.eTag) && Number(a.size) === Number(b.size);

// ---------- Bygge kopien ----------

// Hvilke elementer skal utelates? Samme regel som 🪶 lav kvalitet.
const HOPP_TYPER = new Set(["MECHANICALFASTENER", "FASTENER", "DISCRETEACCESSORY"]);

// Slår sammen scenens mesh per materiale og gir ranges, slik lav kvalitet gjør.
// Returnerer en liste { pos, idx, material, ranges }.
export function slåSammenScene(children, opts) {
  const o = opts || {};
  const minst = o.minst !== undefined ? o.minst : 0.15;
  const bøtter = new Map();
  const boks = new THREE.Box3();
  let utelatt = 0;

  for (const m of children) {
    if (!m.isMesh) continue;
    if (m.userData.merged) {
      // alt sammenslått (lav kvalitet / lett kopi): ta geometrien som den er
      const key = m.material.uuid;
      let b = bøtter.get(key);
      if (!b) { b = { mat: m.material, deler: [] }; bøtter.set(key, b); }
      const pos = m.geometry.getAttribute("position").array;
      const idx = m.geometry.getIndex().array;
      b.deler.push({ pos, idx, ranges: m.userData.ranges || [] });
      continue;
    }
    const id = m.userData.expressID;
    const meta = metaFor(id);
    if (meta && HOPP_TYPER.has((meta.typeName || "").toUpperCase())) { utelatt++; continue; }
    // diagonalen regnes ut av boksens ytterpunkter – samme mål som IFC-tråden
    // bruker i 🪶 lav kvalitet, så de to veiene utelater nøyaktig de samme
    boks.setFromObject(m);
    const dx = boks.max.x - boks.min.x, dy = boks.max.y - boks.min.y, dz = boks.max.z - boks.min.z;
    if (Math.hypot(dx, dy, dz) < minst) { utelatt++; continue; }

    // legg matrisen inn i punktene, så alt kan slås sammen
    const g = m.geometry;
    const src = g.getAttribute("position");
    const pos = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    m.updateMatrixWorld(true);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const ix = g.getIndex();
    const idx = ix ? new Uint32Array(ix.array) : new Uint32Array(src.count).map((_, i) => i);
    const key = (m.userData.origMat || m.material).uuid;
    let b = bøtter.get(key);
    if (!b) { b = { mat: m.userData.origMat || m.material, deler: [] }; bøtter.set(key, b); }
    b.deler.push({ pos, idx, ranges: [{ start: 0, count: idx.length, id }] });
  }

  const ut = [];
  for (const [, b] of bøtter) {
    let vtot = 0, itot = 0;
    b.deler.forEach(d => { vtot += d.pos.length / 3; itot += d.idx.length; });
    const pos = new Float32Array(vtot * 3);
    const idx = new Uint32Array(itot);
    const ranges = [];
    let vo = 0, io = 0;
    for (const d of b.deler) {
      pos.set(d.pos, vo * 3);
      for (let i = 0; i < d.idx.length; i++) idx[io + i] = d.idx[i] + vo;
      d.ranges.forEach(r => ranges.push({ start: io + r.start, count: r.count, id: r.id }));
      vo += d.pos.length / 3;
      io += d.idx.length;
    }
    ut.push({ pos, idx, material: b.mat, ranges });
  }
  return { bøtter: ut, utelatt };
}

// Bygger .glb-en. Returnerer { bytes, ids, utelatt }.
export async function byggLettKopi(melding) {
  const si = melding || (() => {});
  si("Slår sammen geometri …");
  const { bøtter, utelatt } = slåSammenScene(S.modelGroup.children);

  const ids = new Set();
  bøtter.forEach(b => b.ranges.forEach(r => ids.add(r.id)));

  si("Henter elementdata …");
  const props = {};
  for (const id of ids) {
    const m = metaFor(id);
    if (m) props[id] = [m.name || "", m.objectType || "", m.typeName ? "Ifc" + m.typeName : ""];
  }
  let columns = [], storeys = [];
  try { columns = (await kall("axisSources")).filter(k => k.t === "COLUMN").map(k => k.id); } catch(_) {}
  try { storeys = (await kall("storeys")).map(s => ({ name: s.name, ids: s.ids })); } catch(_) {}

  // sveis sammen dupliserte punkter – gir mange ganger mindre fil
  si("Komprimerer geometri …");
  await new Promise(r => setTimeout(r, 0));
  const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
  const gruppe = new THREE.Group();
  for (const b of bøtter) {
    let g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(b.pos, 3));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    g = mergeVertices(g, 1e-4);
    const em = new THREE.Mesh(g, b.material);
    em.userData.merged = true;
    em.userData.ranges = b.ranges;
    gruppe.add(em);
  }
  gruppe.userData.stormLite = {
    v: 3,
    name: S.fileName,
    kote: S.koteMatrixInv ? Array.from(S.koteMatrixInv.elements) : null,
    kilde: S.liteKilde || null,     // stempel fra IFC-en kopien er laget av
    laget: new Date().toISOString(),
    columns, storeys, props
  };

  si("Skriver .glb …");
  await new Promise(r => setTimeout(r, 0));
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(gruppe, res, rej, { binary: true }));
  gruppe.children.forEach(em => em.geometry.dispose());
  return { bytes: new Uint8Array(glb), ids, utelatt };
}

// ---------- Lokal buffer (IndexedDB) ----------
const DB = "storm-ifc", STORE = "lite";

function db() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("IndexedDB mangler"));
    const q = indexedDB.open(DB, 2);
    q.onupgradeneeded = () => {
      const d = q.result;
      if (!d.objectStoreNames.contains("recent")) d.createObjectStore("recent");
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function lagreLokalt(navn, stempel, bytes) {
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ stempel, bytes, laget: Date.now() }, navn);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  d.close();
}

export async function hentLokalt(navn, stempel) {
  try {
    const d = await db();
    const rec = await new Promise((res, rej) => {
      const tx = d.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(navn);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
    d.close();
    if (!rec) return null;
    // foreldet kopi er verre enn ingen kopi
    if (stempel && !sammeStempel(rec.stempel, stempel)) return null;
    return rec.bytes;
  } catch(_) { return null; }
}

// ---------- SharePoint ----------
// Graph svarer «Access token is empty» hvis vi sender et tomt token – en
// ubrukelig melding for den som står der. Vi stopper før det og sier hva som
// mangler i stedet.
const auth = (token, ekstra) => authHeaders(token, ekstra, "lett kopi");

function mappeSti(ekstra) {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/" + encodeURIComponent(LETT_MAPPE) + (ekstra ? "/" + encodeURIComponent(ekstra) : "");
}

async function siteId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

// Hele oversikten i én forespørsel: modellnavn → { stempel, fil, laget }
//
// Finnes ikke fila ennå, svarer Graph 404. Det er helt normalt første gang, men
// Chrome logger alle 404-er som røde feil i konsollen – så vi husker svaret og
// spør ikke igjen i samme økt. Etter at den første kopien er laget, finnes fila
// og 404-en forsvinner for godt.
let indeksBuffer = null;      // { verdi } når vi har svar

export async function hentIndeks(friskt) {
  if (indeksBuffer && !friskt) return indeksBuffer.verdi;
  const token = await spTokenSilent();
  if (!token) return null;
  try {
    const sid = await siteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + mappeSti(INDEKS_FIL) + ":/content",
      { headers: auth(token) });
    if (r.status === 404) {
      console.log("⚡ Ingen oversikt over raske kopier ennå – lages ved første kopi. (404 over er forventet.)");
      indeksBuffer = { verdi: {} };
      return {};
    }
    if (!r.ok) throw new Error("Graph " + r.status);
    const d = await r.json();
    const verdi = (d && typeof d === "object") ? d : {};
    indeksBuffer = { verdi };
    return verdi;
  } catch(_) { return null; }
}

async function skrivIndeks(token, sid, oppdatering) {
  // les–slå sammen–skriv, så to samtidige kjøringer ikke sletter hverandres rader
  let indeks = {};
  try {
    const r = await fetch(GRAPH + "/sites/" + sid + mappeSti(INDEKS_FIL) + ":/content",
      { headers: auth(token) });
    if (r.ok) indeks = await r.json();
  } catch(_) {}
  Object.assign(indeks, oppdatering);
  await fetch(GRAPH + "/sites/" + sid + mappeSti(INDEKS_FIL) + ":/content", {
    method: "PUT",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(indeks)
  });
}

// Filer over 4 MB må lastes opp i biter via en opplastingsøkt
async function lastOppFil(token, sid, filnavn, bytes, si) {
  const sti = mappeSti(filnavn);
  if (bytes.byteLength <= 4e6) {
    const r = await fetch(GRAPH + "/sites/" + sid + sti + ":/content", {
      method: "PUT",
      headers: auth(token, { "Content-Type": "model/gltf-binary" }),
      body: bytes
    });
    if (!r.ok) throw new Error("Opplasting feilet (" + r.status + ")");
    return;
  }
  const økt = await fetch(GRAPH + "/sites/" + sid + sti + ":/createUploadSession", {
    method: "POST",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } })
  });
  if (!økt.ok) throw new Error("Fikk ingen opplastingsøkt (" + økt.status + ")");
  const { uploadUrl } = await økt.json();
  const BIT = 10 * 320 * 1024;            // må være multiplum av 320 KiB
  for (let start = 0; start < bytes.byteLength; start += BIT) {
    const slutt = Math.min(start + BIT, bytes.byteLength);
    const r = await fetch(uploadUrl, {
      method: "PUT",
      // Content-Length settes av nettleseren selv (forbudt å sette manuelt).
      // Bitene sendes til en ferdig autorisert uploadUrl – ingen Authorization her.
      headers: { "Content-Range": "bytes " + start + "-" + (slutt - 1) + "/" + bytes.byteLength },
      body: bytes.subarray(start, slutt)
    });
    if (!r.ok && r.status !== 202) throw new Error("Opplasting feilet (" + r.status + ")");
    if (si) si("Laster opp rask kopi … " + Math.round(slutt / bytes.byteLength * 100) + " %");
  }
}

// Legger kopien i biblioteket slik at HELE Storm får nytte av den
export async function delILbiblioteket(modellnavn, stempel, bytes, si) {
  const token = await spTokenSilent();
  if (!token) return false;      // ikke innlogget – kopien blir liggende lokalt
  const sid = await siteId(token);
  const filnavn = lettNavn(modellnavn);
  // mappa opprettes hvis den mangler
  await fetch(GRAPH + "/sites/" + sid + "/drive/root:/" +
    SP.folder.split("/").map(encodeURIComponent).join("/") + ":/children", {
    method: "POST",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: LETT_MAPPE, folder: {}, "@microsoft.graph.conflictBehavior": "replace" })
  }).catch(() => {});
  await lastOppFil(token, sid, filnavn, bytes, si);
  await skrivIndeks(token, sid, {
    [modellnavn]: { stempel, fil: filnavn, laget: new Date().toISOString(), størrelse: bytes.byteLength }
  });
  indeksBuffer = null;        // vår hurtigbuffer er utdatert nå
  return true;
}

// Henter en delt kopi fra biblioteket (brukes av ⚡ i fil-lista)
export async function hentFraBiblioteket(filnavn) {
  const token = await spTokenSilent();
  if (!token) return null;
  const sid = await siteId(token);
  const r = await fetch(GRAPH + "/sites/" + sid + mappeSti(filnavn) + ":/content",
    { headers: auth(token) });
  if (!r.ok) throw new Error("Kunne ikke hente rask kopi (" + r.status + ")");
  return new Uint8Array(await r.arrayBuffer());
}

// ---------- Automatisk generering ----------
// Kjøres i bakgrunnen etter at en modell er åpnet i full kvalitet, hvis den ikke
// alt har en fersk kopi. Ingenting av dette blokkerer brukeren.
let jobbGår = false;

// Liten melding øverst til høyre, så man ser at noe skjedde
function visLite(tekst, tittel) {
  if (!statusEl) return;
  const grunn = statusEl.dataset.grunn || statusEl.textContent;
  statusEl.dataset.grunn = grunn;
  statusEl.textContent = grunn + " · " + tekst;
  statusEl.title = tittel || "";
}

// Kort status om den raske kopien for modellen som er åpen – vises i ⚙-menyen
export async function raskKopiStatus() {
  if (!S.modelGroup) return "Åpne en modell først.";
  if (S.glbActive) return "Denne modellen ER en rask kopi.";
  if (S.modelID === null) return "Ingen IFC-data i det som er åpent.";
  const stempel = S.liteKilde;
  const lokal = stempel ? await hentLokalt(S.fileName, stempel) : null;
  if (lokal) {
    const mb = Math.round(lokal.byteLength / 1048576 * 10) / 10;
    const indeks = await hentIndeks();
    const delt = indeks && indeks[S.fileName] && sammeStempel(indeks[S.fileName].stempel, stempel);
    return "✅ Finnes (" + mb + " MB) – " + (delt ? "delt i biblioteket." : "bare på denne maskinen.");
  }
  const indeks = await hentIndeks();
  if (indeks && indeks[S.fileName]) {
    return sammeStempel(indeks[S.fileName].stempel, stempel)
      ? "✅ Finnes i biblioteket."
      : "⚠️ Kopien i biblioteket er laget av en eldre versjon – lages på nytt.";
  }
  return "Ingen kopi ennå for «" + S.fileName + "».";
}

// Tvinger jobben i gang uten å vente, og uten å hoppe av på «finnes alt»
export async function lagRaskKopiNå() {
  if (!S.modelGroup || S.glbActive || S.modelID === null) {
    alert("Åpne en IFC-modell først (en lett kopi kan ikke kopieres igjen).");
    return;
  }
  jobbGår = true;
  try {
    visLite("⚡ lager rask kopi …", "");
    const { bytes } = await byggLettKopi((t) => { loadingText.textContent = t; });
    const stempel = S.liteKilde || { eTag: "manuell:" + Date.now(), size: 0 };
    await lagreLokalt(S.fileName, stempel, bytes);
    let delt = false;
    try { delt = await delILbiblioteket(S.fileName, stempel, bytes); } catch (e) { console.warn("⚡ opplasting feilet:", e.message); }
    const mb = Math.round(bytes.byteLength / 1048576 * 10) / 10;
    visLite("⚡ rask kopi klar", mb + " MB" + (delt ? " – lagt i biblioteket" : " – bare lokalt"));
    alert("⚡ Rask kopi laget (" + mb + " MB)" + (delt
      ? " og lagt i biblioteket." : ". Den ligger lokalt – logg inn via 📚 for å dele den."));
  } catch (err) {
    visLite("⚡ mislyktes", err.message);
    // Graphs egne feilmeldinger er engelsk JSON – kort dem ned til noe lesbart
    const m = /InvalidAuthenticationToken|Access token is empty|401/.test(err.message)
      ? IKKE_INNLOGGET
      : err.message;
    alert("Klarte ikke å lage rask kopi: " + m);
  } finally {
    jobbGår = false;
  }
}

export async function kanskjeLagRaskKopi() {
  const hvorfor = (t) => console.log("⚡ rask kopi: " + t);
  if (jobbGår) return hvorfor("en jobb går alt");
  if (!S.settings.autoLite) return hvorfor("slått av i ⚙ Innstillinger");
  if (!S.modelGroup) return hvorfor("ingen modell");
  if (S.glbActive) return hvorfor("dette ER en lett kopi");
  if (S.modelID === null) return hvorfor("ingen IFC-data");
  const stempel = S.liteKilde;
  if (!stempel) return hvorfor("mangler stempel for filversjonen");
  if (await hentLokalt(S.fileName, stempel)) return hvorfor("finnes alt lokalt");
  const indeks = await hentIndeks();
  if (indeks && indeks[S.fileName] && sammeStempel(indeks[S.fileName].stempel, stempel))
    return hvorfor("finnes alt i biblioteket");

  jobbGår = true;
  const navn = S.fileName;
  try {
    // vent til brukeren har fått se modellen litt
    await new Promise(r => setTimeout(r, 4000));
    if (S.fileName !== navn) return;          // byttet modell underveis
    hvorfor("bygger …");
    visLite("⚡ lager rask kopi …", "Bygges i bakgrunnen – du kan jobbe videre");
    const { bytes } = await byggLettKopi(() => {});
    if (S.fileName !== navn) return;
    await lagreLokalt(navn, stempel, bytes);
    let delt = false;
    try { delt = await delILbiblioteket(navn, stempel, bytes); } catch (e) { console.warn("⚡ opplasting feilet:", e.message); }
    const mb = Math.round(bytes.byteLength / 1048576 * 10) / 10;
    hvorfor("ferdig for " + navn + " – " + mb + " MB" +
      (delt ? ", lagt i biblioteket" : ", bare lokalt (ikke innlogget?)"));
    visLite("⚡ rask kopi klar", mb + " MB" + (delt
      ? " – lagt i biblioteket, hele Storm får nytte av den"
      : " – lagret lokalt. Logg inn via 📚 for å dele den."));
  } catch (err) {
    console.warn("Klarte ikke å lage rask kopi:", err.message);
    visLite("⚡ mislyktes", err.message);
  } finally {
    jobbGår = false;
  }
}
