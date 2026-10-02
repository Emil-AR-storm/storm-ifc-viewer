// 📅 Framdriftsplan — HVOR MATERIELLET GÅR (Emil 02.10).
//
// «materiell som har blitt levert på byggeplass blir værende i modellen
// selvom det har blitt brukt opp og montert … går det an og legge til en
// funksjon hvor materiell fra bunker forsvinner etter som tilsvarende versjon
// av objektet … montert på bygget dukker opp i seinere trinn?»
// Og: «dette skal kun vises i framdriftsplan videoen, pdf-en og tidslinjen i
// framdriftsplan og skal ikke påvirke noe annet».
//
// Derfor endrer ingenting her selve bunkene. Fila svarer bare på ett
// spørsmål: hvilke monterte objekter en bunke er levert til. Glideren, PDF-en
// og videoen (framdrift-vis.js / framdrift-pdf.js) skjuler så bunkenes
// enheter ovenfra og ned, i takt med at objektene kommer opp.
//
// Koblingen per bunketype:
//   • stålbunker (søyler, bjelker)  → IFC-elementene med samme del, profil og
//     lengde (samme nøkkel som bunken ble laget med)
//   • fagverkshalvdeler             → fagverkene de er kappet fra
//   • SW-stabler (sandwich)         → veggelementene med samme SW-nummer
//   • TRP-bunker                    → takplatene med samme lengde
//   • beslagbunker (blikk)          → blikkstykkene med samme form, vektet
//     med lengden (bunken er stenger, stykkene er løpemeter)
// Bunker uten kobling (lagt inn for hånd) står som før.
//
// Svar: kilder(materiellId) → [{ nokler: ["id:…"|"sw:…"|"tak:…"|"blikk:…"], w }]
//
// 🏗 Byggeplass-siden (trinn 6): bygg.html har ikke SW-generatoren. Kontoret
// regner derfor koblingene ut når planen publiseres (kilderForByggeplass,
// kalt fra byggeplass.js), og lettmodus leser dem fra S.framdriftKilder.
// SW-modulene hentes med import() bare på kontoret.
import { S } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";

let stal = null, stalFor = null;          // stålkildene (krever modellen, hentes asynkront)
// Kontor-modulene (SW-generatoren) — hentes første gang, aldri i lettmodus
let lagret = null, lagretInner = null, takMeshPerId = new Map(), blikkMeshPerId = new Map(), BESLAG_FORM = {};
let swHentet = null;
function hentSw() {
  if (!swHentet) swHentet = Promise.all([
    import("./veggelement/tilstand.js"), import("./veggelement/panel.js"),
    import("./veggelement/tak-just.js"), import("./veggelement/blikk-just.js"), import("./sw-blikk.js")
  ]).then(([a, b, c, d, e]) => {
    VE = { a, b };
    takMeshPerId = c.takMeshPerId; blikkMeshPerId = d.blikkMeshPerId; BESLAG_FORM = e.BESLAG_FORM;
  }).catch(err => { console.warn("Framdrift: SW-modulene:", err && err.message); });
  return swHentet;
}
let VE = null;
// `lagret` byttes ut når SW-planen lastes på nytt — les den levende verdien
function oppdaterLagret() { if (VE) { lagret = VE.a.lagret; lagretInner = VE.b.lagretInner; } }

// Stålet må leses fra modellen (profil og lengde per element) — én gang per
// modell, og på nytt når stålbunkene er laget på nytt.
export async function forberedKilder() {
  if (LETT) return;
  await hentSw();
  const merke = String(S.fileName || "") + "|" + (S.materiell || []).filter(p => p && (p.maltype === "stal" || p.maltype === "fagverk")).map(p => p.id).join(",");
  if (stal && stalFor === merke) return;
  if (!(S.materiell || []).some(p => p && (p.maltype === "stal" || p.maltype === "fagverk"))) { stal = new Map(); stalFor = merke; return; }
  try {
    const SB = await import("./stalbunker.js");
    stal = await SB.stalKilder();
    stal.nokkelFor = SB.bunkeNokkel;
  } catch (err) {
    console.warn("Framdrift: fant ikke stålkildene:", err && err.message);
    stal = new Map();
  }
  stalFor = merke;
}
export function nullstillKilder() { stal = null; stalFor = null; }

const har = (liste, id) => Array.isArray(liste) && liste.includes(id);
export function kilder(p) {
  if (!p) return null;
  if (LETT) {
    const k = S.framdriftKilder && S.framdriftKilder[p.id];
    return Array.isArray(k) && k.length ? k : null;
  }
  oppdaterLagret();
  if (p.maltype === "stal" || p.maltype === "fagverk") {
    if (!stal || !stal.nokkelFor) return null;
    let k = null; try { k = stal.nokkelFor(p); } catch (_) { k = null; }
    return (k && stal.get(k)) || null;
  }
  if (p.maltype === "sandwich") {
    if (lagret && har(lagret.materiellIder, p.id)) {
      const ut = (lagret.vegger || []).filter(v => v && !v.skjult && !v.tilpasset && v.sw === p.navn).map(v => ({ nokler: ["sw:" + v.id], w: 1 }));
      return ut.length ? ut : null;
    }
    if (lagretInner && har(lagretInner.materiellIder, p.id)) {
      const ut = (lagretInner.vegger || []).filter(v => v && !v.skjult && !v.tilpasset && (v.sw + " " + t("innervegg")) === p.navn).map(v => ({ nokler: ["sw:" + v.id], w: 1 }));
      return ut.length ? ut : null;
    }
    return null;
  }
  if (p.maltype === "trp") {
    if (!(lagret && lagret.tak && har(lagret.tak.materiellIder, p.id))) return null;
    const ut = [];
    for (const [id, v] of takMeshPerId) {
      const info = v && v.info;
      if (info && Math.round(Number(info.lengdeMm) || 0) === Math.round(Number(p.lengde) || 0)) ut.push({ nokler: ["tak:" + id], w: 1 });
    }
    return ut.length ? ut : null;
  }
  if (p.maltype === "beslag") {
    if (!(lagret && lagret.blikk && har(lagret.blikk.materiellIder, p.id))) return null;
    const ut = [];
    for (const [id, v] of blikkMeshPerId) {
      const info = v && v.info;
      if (!info || BESLAG_FORM[info.type] !== p.beslagType) continue;
      ut.push({ nokler: ["blikk:" + id], w: Math.max(1, Math.abs((Number(info.tilMm) || 0) - (Number(info.fraMm) || 0))) });
    }
    return ut.length ? ut : null;
  }
  return null;
}

// 🏗 Til byggeplass-siden: koblingene for bunkene som ligger i planen.
// { materiellId: [{ nokler, w }] } — bare for bunker som ligger i planen.
export async function kilderForByggeplass(liste) {
  const trinn = (Array.isArray(liste) ? liste : []).filter(e => e && !e.slettet);
  const iPlan = new Set();
  for (const e of trinn) for (const o of e.objekter || []) if (o && o.k) iPlan.add(o.k);
  const mat = [...iPlan].filter(k => k.startsWith("mat:")).map(k => k.slice(4));
  if (!mat.length) return {};
  try { await forberedKilder(); } catch (_) { return {}; }
  const ut = {};
  for (const id of mat) {
    const p = (S.materiell || []).find(x => x && x.id === id);
    const k = kilder(p);
    if (!k) continue;
    // Alle enhetene sendes med (også de som ikke er i noe trinn): andelen
    // som er brukt opp regnes av helheten, som på kontoret.
    ut[id] = k.map(x => ({ nokler: (x.nokler || []).slice(), w: x.w }));
  }
  return ut;
}

// Regningen (hvor mye som er igjen) er ren og bor i framdrift-regn.js
export { igjen } from "./framdrift-regn.js";
