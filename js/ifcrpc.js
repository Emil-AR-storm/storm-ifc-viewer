// Samtalen med IFC-workeren.
//
// Én kommando = ett løfte. Noen kommandoer sender også meldinger underveis
// (geometri i porsjoner, framdrift); de fanges av `underveis`-tilbakekallet.
//
// Faller workeren bort – eller nekter nettleseren å starte den – settes
// S.workerFeil, og ifc.js laster modellen på hovedtråden som før. Da mister vi
// prosenten, men ingen står uten viewer.
import { S } from "./state.js";

let worker = null;
let nesteId = 1;
const venter = new Map();   // id → { løs, avvis, underveis }

function url() {
  // ligger ved siden av de andre modulene
  return new URL("./ifc-worker.js", import.meta.url);
}

export function harWorker() {
  return !!worker;
}

export function startWorker() {
  if (worker) return worker;
  if (typeof Worker === "undefined") { S.workerFeil = "Nettleseren støtter ikke Web Workers"; return null; }
  try {
    worker = new Worker(url(), { type: "module" });
  } catch (err) {
    S.workerFeil = err.message || String(err);
    worker = null;
    return null;
  }
  worker.onmessage = (e) => {
    const m = e.data || {};
    const v = venter.get(m.id);
    if (!v) return;
    if (m.type) { if (v.underveis) v.underveis(m); return; }   // melding underveis
    venter.delete(m.id);
    if (m.feil) v.avvis(new Error(m.feil)); else v.løs(m.svar);
  };
  worker.onerror = (e) => {
    S.workerFeil = (e && e.message) || "ukjent feil i IFC-tråden";
    // alle som venter må få svar, ellers henger lastingen for alltid
    for (const [, v] of venter) v.avvis(new Error(S.workerFeil));
    venter.clear();
    try { worker.terminate(); } catch(_) {}
    worker = null;
  };
  return worker;
}

export function kall(cmd, args, underveis, overfor) {
  const w = startWorker();
  if (!w) return lokaltKall(cmd, args, underveis);   // reserve: samme kode på hovedtråden
  const id = nesteId++;
  return new Promise((løs, avvis) => {
    venter.set(id, { løs, avvis, underveis });
    w.postMessage({ id, cmd, args: args || {} }, overfor || []);
  });
}

// Reserve når nettleseren ikke gir oss en tråd (eller den krasjet): vi importerer
// NØYAKTIG samme modul og kjører kommandoene her. Da finnes IFC-logikken bare på
// ett sted, og forskjellen er bare at fanen fryser mens den jobber – som før.
let lokalModul = null;
async function lokaltKall(cmd, args, underveis) {
  if (!lokalModul) lokalModul = await import("./ifc-worker.js");
  const fn = lokalModul.KOMMANDOER[cmd];
  if (!fn) throw new Error("Ukjent kommando: " + cmd);
  return fn(args || {}, (m) => { if (underveis) underveis(m); });
}

export function stoppWorker() {
  if (!worker) return;
  try { worker.terminate(); } catch(_) {}
  worker = null;
  for (const [, v] of venter) v.avvis(new Error("IFC-tråden ble stoppet"));
  venter.clear();
}

// ---------- Hurtigbuffer for elementdata ----------
// Navn, type, tag og GlobalId hentes i ÉN runde rett etter lasting og lagres her.
// Da kan resten av viewer'en slå opp synkront, slik den alltid har gjort, og bare
// egenskapspanelet, etasjene og aksene trenger å vente på svar.

export function tømMeta() { S.meta = new Map(); }

export function metaFor(id) {
  return (S.meta && S.meta.get(id)) || null;
}

export function navnFor(id) {
  const m = metaFor(id);
  return (m && (m.name || m.objectType)) || "";
}

export function typeFor(id) {
  const m = metaFor(id);
  return (m && m.typeName) || "";
}

export function guidFor(id) {
  const m = metaFor(id);
  return (m && m.globalId) || null;
}

// Sørger for at elementdata er hentet – første gang noe faktisk trenger dem.
//
// Dette var opprinnelig gjort ved lasting, men det gjorde hver eneste åpning
// tregere: en 7 500-element-modell måtte lese 7 500 linjer og sende dem over
// trådgrensen før du fikk se noe, selv om du bare skulle snurre på bygget.
// Nå hentes de ved første trykk på 📊 Mengder, 🔎 Søk, 🎨 Utseende, 🔄
// Sammenlign eller et element – og bare én gang per modell.
let metaJobb = null;

export function sikreMeta(idFn) {
  if (S.meta && S.meta.size) return Promise.resolve(S.meta);
  if (S.modelID === null) return Promise.resolve(S.meta);
  if (!metaJobb) {
    metaJobb = hentMeta(typeof idFn === "function" ? idFn() : idFn)
      .finally(() => { metaJobb = null; });
  }
  return metaJobb;
}

// Henter meta for alle id-ene i porsjoner, så en stor modell ikke lager
// én kjempemelding.
export async function hentMeta(ids, framdrift) {
  tømMeta();
  const alle = [...ids];
  const PORSJON = 4000;
  for (let i = 0; i < alle.length; i += PORSJON) {
    const del = alle.slice(i, i + PORSJON);
    const svar = await kall("meta", { ids: del });
    svar.forEach(m => S.meta.set(m.id, m));
    if (framdrift) framdrift(Math.min(i + PORSJON, alle.length), alle.length);
  }
  return S.meta;
}
