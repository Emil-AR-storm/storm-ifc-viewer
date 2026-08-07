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
const venter = new Map();   // id → { løs, avvis, underveis, timer, pust }

// Hvor lenge en kommando får være HELT STILLE før vi gir opp.
//
// Dette er IKKE total tid. Geometrien på en 200 MB-modell kan lovlig ta
// minutter, og en fast frist ville drept den. Klokka nullstilles av hver
// eneste melding fra tråden – porsjon, framdrift eller puls – så bare ekte
// stillhet slår ut. Og ekte stillhet betyr som regel at nettleseren har
// drept tråden fordi den gikk tom for minne.
//
// «open» er den eneste som ikke kan gi livstegn: OpenModel er ett synkront
// kall inne i web-ifc. Derfor får den mye lengre frist enn de andre.
const STILLE_MS = {
  open: 300000,          // 5 min – ett synkront kall, ingen puls mulig
  geometryFull: 45000,
  geometryLight: 45000,
  meta: 120000,          // romslig: sikreMeta kalles fra en setTimeout uten catch
  props: 60000,
  storeys: 120000,
  axisSources: 120000,
  buffer: 20000,
  close: 20000
};
const STILLE_STANDARD = 60000;

// Tråden er borte. Alle som venter må få svar, ellers henger «laster …» for alltid.
function trådDød(melding) {
  S.workerFeil = melding;
  for (const [, v] of venter) { clearTimeout(v.timer); v.avvis(new Error(melding)); }
  venter.clear();
  try { if (worker) worker.terminate(); } catch(_) {}
  worker = null;
  // Modellen levde inne i den tråden. Uten dette ville neste kall startet en
  // NY, tom tråd som stille svarer med tomme navn og typer – og brukeren fikk
  // en modell som ser normal ut, men mangler alle data.
  S.modelID = null;
  S.bufferITråd = false;
}

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
    v.pust();                          // livstegn: nullstill stille-klokka
    if (m.type === "puls") return;     // bare et livstegn, ingenting å gjøre
    if (m.type) { if (v.underveis) v.underveis(m); return; }   // melding underveis
    clearTimeout(v.timer);
    venter.delete(m.id);
    if (m.feil) v.avvis(new Error(m.feil)); else v.løs(m.svar);
  };
  worker.onerror = (e) => trådDød((e && e.message) || "ukjent feil i IFC-tråden");
  // En melding som ikke lar seg lese har ingen id vi kan koble den til, så vi
  // vet ikke hvem som venter på den. Da må tråden regnes som tapt.
  worker.onmessageerror = () => trådDød("IFC-tråden sendte en melding som ikke kunne leses");
  return worker;
}

export function kall(cmd, args, underveis, overfor) {
  const w = startWorker();
  if (!w) return lokaltKall(cmd, args, underveis);   // reserve: samme kode på hovedtråden
  const id = nesteId++;
  return new Promise((løs, avvis) => {
    const frist = STILLE_MS[cmd] || STILLE_STANDARD;
    const v = { løs, avvis, underveis, timer: null };
    v.pust = () => {
      clearTimeout(v.timer);
      v.timer = setTimeout(() => {
        venter.delete(id);
        const sek = Math.round(frist / 1000);
        trådDød("IFC-tråden svarte ikke på «" + cmd + "» på " + sek +
                " sekunder – den er trolig tom for minne");
        avvis(new Error(S.workerFeil));
      }, frist);
    };
    venter.set(id, v);
    v.pust();                                 // start klokka
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
  for (const [, v] of venter) { clearTimeout(v.timer); v.avvis(new Error("IFC-tråden ble stoppet")); }
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
  // Pågår en henting alt, VENT på den. Sto denne sjekken etter size-sjekken
  // under, holdt det å ha fått første porsjon på 4000 for at neste kall skulle
  // svare «ferdig» med bare en femtedel av dataene: trykket du 🔎 Søk og så
  // 📊 Mengder rett etter, ble mengdeuttaket bygget med tomme navn og
  // materialer for alt utover de første 4000 elementene.
  if (metaJobb) return metaJobb;
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
