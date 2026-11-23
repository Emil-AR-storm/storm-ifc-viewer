// ✍️ MINDRE GJENTATT UTFYLLING – de rene reglene (runde 5, Emil 23.11.2026)
//
// Valgt fra prøvebildene: 1B, 2A, 3A, 4B, 5C, 6C, 7B og 9C. Her ligger det
// som kan prøves uten nettleser (_test/test-utfylling.mjs). Skjermen og 3D
// ligger i markers.js, framdrift.js, grupper.js, prosjektinfo.js og
// etasje-hjelp.js.
import { ifcGruppe, ifcUnder } from "./framdrift-regn.js";

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n || 200);

// ═══════════ 2A · TEKSTMALER FOR MARKERINGER ═══════════
// Norske nøkler – vises og settes inn gjennom t(), så montøren med polsk
// språk får polsk tekst i markeringen.
export const STANDARD_MALER = ["Mangler armering", "Feil høyde", "Avvik mot tegning", "Klar for støp", "Mangler sveis", "Ryddes"];
export const MAKS_EGNE_MALER = 20;
// Setter malen først i teksten. Står det alt en mal først (fra et tidligere
// trykk), byttes den – ellers legges resten etter « – ».
export function settMal(gjeldende, mal, kjente) {
  const g = String(gjeldende || "");
  const m = String(mal || "").trim();
  if (!m) return g;
  for (const k of kjente || []) {
    if (k && (g === k || g.startsWith(k + " – "))) return m + g.slice(k.length);
  }
  const rest = g.trim();
  return rest ? m + " – " + rest : m + " – ";
}
export function vaskEgneMaler(liste) {
  const ut = [];
  for (const x of Array.isArray(liste) ? liste : []) {
    const v = tekst(x, 60).replace(/\s+/g, " ").trim();
    if (v && !ut.includes(v)) ut.push(v);
  }
  return ut.slice(0, MAKS_EGNE_MALER);
}

// ═══════════ 3A · FAG, STANDARD ANSVARLIG OG FRIST ═══════════
export const FAG = ["Betong", "Stål", "Tre", "Annet"];
// Faget til elementet markeringen står på – fra navn, type og materiale.
// m = { typeName, name, objectType, material }
export function fagFor(m) {
  if (!m) return "Annet";
  const s = [m.name, m.objectType, m.material].map(x => String(x || "")).join(" ").toLowerCase();
  const typ = String(m.typeName || "").toLowerCase().replace(/^ifc/, "");
  if (/(stål|steel|\bs(235|275|355|420|460)\b|\bhe[abm]\s?\d|\bipe\s?\d|\bup[en]\s?\d|\b(rhs|shs|chs|vkr|kkr)\b|cfshs|hfshs|\bl\d{2,3}x\d)/.test(s)) return "Stål";
  if (/(betong|concrete|\bb\d{2}\b|\bc\d{2}\/\d{2}\b|hulldekke|\bhd\s?\d{3}\b|prefab)/.test(s)) return "Betong";
  if (/(limtre|glulam|\btre\b|wood|timber|\bclt\b|kl-?tre|\bc24\b|\bgl\d{2}[ch]?\b)/.test(s)) return "Tre";
  if (/^(reinforcingbar|reinforcingmesh|footing|pile)/.test(typ)) return "Betong";
  if (/^(mechanicalfastener|fastener)/.test(typ)) return "Stål";
  return "Annet";
}
// standarder = { Betong: { ansvarlig, dager }, … } (⚙ Innstillinger → Nye markeringer)
// sist = { ansvarlig } – sist valgte i dialogen. Svar { ansvarlig, dager, kilde }.
export const STANDARD_DAGER = 14;
export function standardFor(fag, standarder, sist) {
  const s = standarder && standarder[fag] && typeof standarder[fag] === "object" ? standarder[fag] : {};
  const d = Math.round(Number(s.dager));
  const dager = Number.isFinite(d) && d >= 0 && d <= 365 ? d : STANDARD_DAGER;
  if (s.ansvarlig) return { ansvarlig: tekst(s.ansvarlig, 80), dager, kilde: "fag" };
  if (sist && sist.ansvarlig) return { ansvarlig: tekst(sist.ansvarlig, 80), dager, kilde: "sist" };
  return { ansvarlig: "", dager, kilde: "" };
}
export function vaskStandarder(x) {
  const ut = {};
  for (const f of FAG) {
    const s = x && x[f];
    if (!s || typeof s !== "object") continue;
    const d = Math.round(Number(s.dager));
    const v = { ansvarlig: tekst(s.ansvarlig, 80).trim() };
    if (Number.isFinite(d) && d >= 0 && d <= 365 && String(s.dager) !== "") v.dager = d;
    if (v.ansvarlig || "dager" in v) ut[f] = v;
  }
  return ut;
}

// ═══════════ 4B · ENDRE MANGE MARKERINGER ═══════════
// endring = { owner?: string ("" = ingen), due?: string|"" , status?: string }
// Felt som ikke er med, er «(uendret)». Svar: lista over patcher { id, patch }.
export function masseEndring(markeringer, ider, endring) {
  const sett = new Set((ider || []).map(String));
  const ut = [];
  for (const c of markeringer || []) {
    if (!c || !sett.has(String(c.id))) continue;
    const p = {};
    for (const k of ["owner", "due", "status"]) if (endring && k in endring && endring[k] !== c[k]) p[k] = endring[k];
    if (Object.keys(p).length) ut.push({ id: c.id, patch: p });
  }
  return ut;
}
// Shift-klikk: alt mellom forrige og denne i lista (begge med)
export function område(rekke, fra, til) {
  const a = rekke.indexOf(fra), b = rekke.indexOf(til);
  if (a < 0 || b < 0) return til != null ? [til] : [];
  return rekke.slice(Math.min(a, b), Math.max(a, b) + 1);
}

// ═══════════ 5C · TRINN PER ETASJE ═══════════
// etasjer = [{ navn, ids: [expressID] }] nederst først. Svar: forslag
// [{ navn, ids }] – én per etasje med elementer.
export function trinnPerEtasje(etasjer, tell) {
  const ut = [];
  for (const e of etasjer || []) {
    const ids = (e.ids || []).filter(id => !tell || tell(id));
    if (ids.length) ut.push({ navn: tekst(e.navn, 80) || "Etasje", ids });
  }
  return ut;
}
// Slår sammen forslag i og i+1 («Kjeller + 1. etasje»)
export function slåSammen(forslag, i) {
  if (!forslag || i < 0 || i >= forslag.length - 1) return (forslag || []).slice();
  const a = forslag[i], b = forslag[i + 1];
  const m = { navn: tekst(a.navn + " + " + b.navn, 80), ids: [...new Set(a.ids.concat(b.ids))] };
  return forslag.slice(0, i).concat([m], forslag.slice(i + 2));
}

// ═══════════ 6C · GJENTA I ANDRE ETASJER ═══════════
// utvalg/alle: [{ id, type, profil, x, z, etasje }] (etasje = indeks nederst først).
// For hvert element i utvalget finnes elementet med samme type og profil på
// samme sted i plan (±tol) i hver av de andre etasjene. Svar: per etasje
// { etasje, ids, mangler } for etasjer med minst ett treff.
export function tilsvarende(utvalg, alle, tol) {
  const u = (utvalg || []).filter(Boolean);
  if (!u.length) return [];
  const fra = new Set(u.map(x => x.etasje));
  if (fra.size !== 1 || u[0].etasje == null || u[0].etasje < 0) return [];
  const egen = u[0].etasje;
  const valgt = new Set(u.map(x => x.id));
  const per = new Map();
  for (const x of alle || []) {
    if (!x || x.etasje == null || x.etasje < 0 || x.etasje === egen || valgt.has(x.id)) continue;
    if (!per.has(x.etasje)) per.set(x.etasje, []);
    per.get(x.etasje).push(x);
  }
  const ut = [];
  for (const [etasje, liste] of [...per.entries()].sort((a, b) => a[0] - b[0])) {
    const brukt = new Set(), ids = [];
    for (const s of u) {
      let best = null, bestD = Infinity;
      for (const c of liste) {
        if (brukt.has(c.id) || c.type !== s.type || (c.profil || "") !== (s.profil || "")) continue;
        const dx = Math.abs(c.x - s.x), dz = Math.abs(c.z - s.z);
        if (dx > tol || dz > tol) continue;
        const d = dx + dz;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) { brukt.add(best.id); ids.push(best.id); }
    }
    if (ids.length) ut.push({ etasje, ids, mangler: u.length - ids.length });
  }
  return ut;
}

// ═══════════ 9C · NAVNEFORSLAG ═══════════
// elementer = [{ typeName, name, etasje: "2. etasje" | "" }]
// «Søyler HEB200 2. etasje», «Søyler og bjelker 1. etasje», «Vegger»
export function navnForslag(elementer) {
  const l = (elementer || []).filter(Boolean);
  if (!l.length) return "";
  const grupper = new Map();
  for (const e of l) { const g = ifcGruppe(e.typeName) || "Elementer"; grupper.set(g, (grupper.get(g) || 0) + 1); }
  const rang = [...grupper.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
  let navn = rang.length === 1 ? rang[0] : rang.length === 2 ? rang[0] + " og " + rang[1].toLowerCase() : rang[0] + ", " + rang[1].toLowerCase() + " m.m.";
  if (rang.length === 1) {
    const profiler = new Set(l.map(e => ifcUnder(e.name)).filter(Boolean));
    const p = profiler.size === 1 ? [...profiler][0] : "";
    if (p && p.length <= 24 && p.toLowerCase() !== navn.toLowerCase() && !/^\d+$/.test(p)) navn += " " + p;
  }
  const etasjer = new Set(l.map(e => String(e.etasje || "")));
  if (etasjer.size === 1 && [...etasjer][0]) navn += " " + [...etasjer][0];
  return navn.slice(0, 80);
}
// Er navnet bare standardnavnet («Trinn 3», «Etappe 3»)? Da foreslås et bedre.
export const erStandardNavn = (n) => /^(Trinn|Etappe)\s+\d+$/.test(String(n || "").trim());

// ═══════════ 1B · PROSJEKTINFO FRA STORM PROSJEKTER ═══════════
// Kolonnene i lista Prosjekter – bekreftet av Storm Prosjekter 4.60 (23.11):
//   Kunde (byggherre; Kontraktspart nesten aldri fylt ut), ProsjektlederNavn,
//   ProsjektlederTelefon, ProsjektlederEpost (tekst – personkolonnene
//   Prosjektleder/Anleggsleder er tomme og leses ALDRI), Adresse (én tekst med
//   postnummer og sted), Lat/Lon (WGS84) og KoordAdresse, Mannskap (JSON).
// Prosjektleder gjelder per selskap: raden til selskapet modellen hører til,
// ellers den første i jobben som er fylt ut (SE → SB → SS).
export const SP_KOLONNER = {
  byggherre: ["Kunde", "Kontraktspart"],
  leder: ["ProsjektlederNavn"],
  telefon: ["ProsjektlederTelefon"],
  epost: ["ProsjektlederEpost"],
  adresse: ["Adresse"]
};
// Bakoverkompatibelt navn (testene og eldre kode)
export const SP_KANDIDATER = SP_KOLONNER;
const tekstFelt = (f, navn) => {
  for (const n of navn) { const v = f && f[n]; if (typeof v === "string" && v.trim()) return v.trim(); if (typeof v === "number") return String(v); }
  return "";
};
const tall = (v) => { const x = typeof v === "number" ? v : Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(x) && String(v) !== "" && v != null ? x : null; };
const erEpost = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(e || ""));
// felt = fields fra raden til selskapet modellen hører til.
// jobb (valgfri) = hovedprosjektene i jobben, SE → SB → SS – brukes når
// raden ikke har prosjektleder. Svar { navn, nummer, byggherre, leder,
// telefon, epost, adresse, lat, lon, koordAdresse }
export function spProsjektinfo(felt, jobb) {
  const f = felt || {};
  const ut = { navn: tekst(f.Title, 120).trim(), nummer: tekst(f.ProsjektNr, 20).trim() };
  ut.byggherre = tekst(tekstFelt(f, SP_KOLONNER.byggherre), 120);
  let lf = f;
  if (!tekstFelt(f, SP_KOLONNER.leder)) {
    const annen = (jobb || []).map(r => (r && (r.fields || r)) || {}).find(x => tekstFelt(x, SP_KOLONNER.leder));
    if (annen) lf = annen;
  }
  ut.leder = tekst(tekstFelt(lf, SP_KOLONNER.leder), 80);
  ut.telefon = tekst(tekstFelt(lf, SP_KOLONNER.telefon), 30);
  const ep = tekstFelt(lf, SP_KOLONNER.epost).toLowerCase();
  ut.epost = erEpost(ep) ? ep.slice(0, 120) : "";
  ut.adresse = tekst(tekstFelt(f, SP_KOLONNER.adresse), 160);
  const lat = tall(f.Lat), lon = tall(f.Lon);
  ut.lat = lat != null && lat > 57 && lat < 72 ? lat : null;
  ut.lon = lon != null && lon > 3 && lon < 32 ? lon : null;
  if (ut.lat == null || ut.lon == null) { ut.lat = null; ut.lon = null; }
  ut.koordAdresse = tekst(tekstFelt(f, ["KoordAdresse"]), 160);
  return ut;
}

// ═══════════ 3A · FOLKENE PÅ JOBBEN (kolonnen Mannskap, Storm Prosjekter 4.60) ═══════════
// { versjon, oppdatert, personer: [{ navn, epost, rolle, fag, firma }], standard: { fag: epost } }
// Alt er DATA: bare kjente felt, gyldig e-post (små bokstaver), kjente fag.
// Tom eller ugyldig → null (da brukes ansattlista som før).
// En kolonne med «utvidet tekst» kommer fra Graph som HTML (<div>{&quot;…}</div>).
// Da tas taggene bort og tegnene gjøres om før JSON leses.
export function lesJsonKolonne(v) {
  if (typeof v !== "string") return v;
  let s = v.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { /* prøv som HTML */ }
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#160;/g, " ").replace(/&#58;/g, ":").replace(/&#123;/g, "{").replace(/&#125;/g, "}").replace(/&amp;/g, "&").replace(/\u200b/g, "").trim();
  try { return JSON.parse(s); } catch (_) { return null; }
}
export function vaskMannskap(v) {
  const o = lesJsonKolonne(v);
  if (!o || typeof o !== "object" || !Array.isArray(o.personer)) return null;
  const personer = [], sett = new Set();
  for (const p of o.personer.slice(0, 200)) {
    if (!p || typeof p !== "object") continue;
    const navn = tekst(p.navn, 80).replace(/\s+/g, " ").trim();
    const epost = String(p.epost || "").trim().toLowerCase().slice(0, 120);
    if (!navn || !erEpost(epost) || sett.has(epost)) continue;
    sett.add(epost);
    personer.push({ navn, epost, rolle: tekst(p.rolle, 40).trim(), fag: FAG.includes(p.fag) ? p.fag : "", firma: tekst(p.firma, 80).trim() });
  }
  const standard = {};
  if (o.standard && typeof o.standard === "object") {
    for (const f of FAG) {
      const e = String(o.standard[f] || "").trim().toLowerCase();
      if (erEpost(e) && sett.has(e)) standard[f] = e;
    }
  }
  if (!personer.length) return null;
  return { personer, standard };
}
// Navnet Ansvarlig-feltet lagrer: ansattlistas navn når e-posten finnes der
// (Planner finner personen på navnet i ansattlista), ellers navnet fra Mannskap.
export function navnForEpost(epost, mannskap, ansatte) {
  const e = String(epost || "").toLowerCase();
  if (!e) return "";
  const a = (ansatte || []).find(x => String(x.mail || x.epost || "").toLowerCase() === e);
  if (a && a.navn) return a.navn;
  const p = mannskap && mannskap.personer.find(x => x.epost === e);
  return p ? p.navn : "";
}
// Kontaktene på jobben (kolonnen Kontakter, [{id,rolle,navn,firma,tlf,epost,merknad}]).
// Som Ansvarlig tas bare de som er Storms ansatte (e-posten finnes i ansattlista)
// – en ekstern kontakt kan ikke få oppgaven i Planner.
export function vaskKontakter(v) {
  const l = lesJsonKolonne(v);
  if (!Array.isArray(l)) return [];
  const ut = [];
  for (const k of l.slice(0, 200)) {
    if (!k || typeof k !== "object") continue;
    const epost = String(k.epost || "").trim().toLowerCase().slice(0, 120);
    const navn = tekst(k.navn, 80).replace(/\s+/g, " ").trim();
    if (!navn || !erEpost(epost)) continue;
    ut.push({ navn, epost, rolle: tekst(k.rolle, 40).trim(), fag: "", firma: tekst(k.firma, 80).trim() });
  }
  return ut;
}
// Folkene på jobben = Mannskap + kontaktene som er Storms ansatte.
// Svar { personer, standard } eller null når ingen er lagt inn.
export function jobbFolk(mannskap, kontakter, ansatte) {
  const personer = mannskap ? mannskap.personer.slice() : [];
  const sett = new Set(personer.map(p => p.epost));
  const ansatt = new Set((ansatte || []).map(a => String(a.mail || a.epost || "").toLowerCase()).filter(Boolean));
  for (const k of kontakter || []) {
    if (sett.has(k.epost) || !ansatt.has(k.epost)) continue;
    sett.add(k.epost); personer.push(k);
  }
  return personer.length ? { personer, standard: (mannskap && mannskap.standard) || {} } : null;
}
// Valgene i Ansvarlig-lista (Emil 23.11: «kun dem som faktisk er lagt inn på
// prosjektet»). Er noen lagt inn på jobben, vises BARE de. Ingen lagt inn →
// hele ansattlista som før. Svar [{ navn, gruppe: "jobb"|"ansatte", rolle }]
export function ansvarligValg(mannskap, ansatte) {
  const ut = [], sett = new Set();
  for (const p of (mannskap && mannskap.personer) || []) {
    const navn = navnForEpost(p.epost, mannskap, ansatte) || p.navn;
    if (sett.has(navn)) continue;
    sett.add(navn); ut.push({ navn, gruppe: "jobb", rolle: [p.rolle, p.fag].filter(Boolean).join(" · ") });
  }
  if (ut.length) return ut;
  for (const a of ansatte || []) {
    if (!a || !a.navn || sett.has(a.navn)) continue;
    sett.add(a.navn); ut.push({ navn: a.navn, gruppe: "ansatte", rolle: "" });
  }
  return ut;
}
// Standard for faget: jobbens standard (Mannskap.standard) går foran brukerens.
export function standardMedJobb(fag, mannskap, ansatte, standarder, sist) {
  const brukers = standardFor(fag, standarder, sist);
  const e = mannskap && mannskap.standard && mannskap.standard[fag];
  const navn = e ? navnForEpost(e, mannskap, ansatte) : "";
  if (navn) return Object.assign({}, brukers, { ansvarlig: navn, kilde: "jobb" });
  return brukers;
}

// Hvilke felt skal fylles fra Storm Prosjekter? Et felt fylles når det er tomt,
// eller når det fortsatt er det vi hentet sist (da følger det endringer i
// Storm Prosjekter). Har brukeren skrevet noe annet, er det «endret her» og
// røres ikke – unntatt når alle = true («↺ Hent på nytt»).
export const INFO_FELT = ["navn", "nummer", "byggherre", "leder", "telefon"];
export function fyllFraSp(info, sp, forrige, alle) {
  const ny = {};
  for (const k of INFO_FELT) {
    const v = sp && sp[k] ? sp[k] : "";
    if (!v) continue;
    const har = String((info && info[k]) || "");
    if (alle || !har || (forrige && har === forrige[k])) { if (har !== v) ny[k] = v; }
  }
  return ny;
}
// Merket ved feltet: "hentet" | "endret" | ""
export function feltKilde(info, sp, k) {
  const v = sp && sp[k] ? sp[k] : "";
  if (!v) return "";
  return String((info && info[k]) || "") === v ? "hentet" : "endret";
}
