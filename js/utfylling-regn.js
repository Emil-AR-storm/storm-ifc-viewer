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
// Kolonnene i lista Prosjekter kan hete litt forskjellig. Vi leter etter de
// kjente navnene (store/små bokstaver likegyldig) og bruker den første som har
// en verdi. Personfelt som bare har en id (…LookupId), brukes ikke.
export const SP_KANDIDATER = {
  byggherre: ["Byggherre", "Kunde", "Oppdragsgiver", "Bestiller", "Kundenavn"],
  leder: ["Prosjektleder", "ProsjektlederNavn", "PL", "Prosjektansvarlig", "Kontaktperson"],
  telefon: ["Telefon", "ProsjektlederTelefon", "Mobil", "Kontakttelefon"],
  adresse: ["Adresse", "Byggeplassadresse", "Prosjektadresse", "Anleggsadresse", "Gateadresse", "Leveringsadresse"],
  postnummer: ["Postnummer", "Postnr"],
  poststed: ["Poststed", "Sted"]
};
function plukk(felt, navn) {
  const nøkler = Object.keys(felt || {});
  for (const n of navn) {
    const k = nøkler.find(x => x.toLowerCase() === n.toLowerCase());
    if (!k) continue;
    const v = felt[k];
    const s = typeof v === "string" ? v : (v && typeof v === "object" && (v.LookupValue || v.Title || v.displayName)) || (typeof v === "number" ? String(v) : "");
    if (String(s || "").trim()) return { verdi: String(s).trim(), kolonne: k };
  }
  return { verdi: "", kolonne: "" };
}
// felt = fields fra lista Prosjekter. Svar { navn, nummer, byggherre, leder, telefon, adresse, kolonner }
export function spProsjektinfo(felt) {
  const f = felt || {};
  const ut = { navn: tekst(f.Title, 120).trim(), nummer: tekst(f.ProsjektNr, 20).trim(), kolonner: {} };
  for (const k of ["byggherre", "leder", "telefon"]) {
    const p = plukk(f, SP_KANDIDATER[k]);
    ut[k] = tekst(p.verdi, k === "telefon" ? 30 : k === "leder" ? 80 : 120);
    if (p.kolonne) ut.kolonner[k] = p.kolonne;
  }
  const a = plukk(f, SP_KANDIDATER.adresse), pn = plukk(f, SP_KANDIDATER.postnummer), ps = plukk(f, SP_KANDIDATER.poststed);
  ut.adresse = [a.verdi, [pn.verdi, ps.verdi].filter(Boolean).join(" ")].filter(Boolean).join(", ").slice(0, 160);
  if (a.kolonne) ut.kolonner.adresse = a.kolonne;
  return ut;
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
