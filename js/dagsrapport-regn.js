// 📋 DAGSRAPPORT — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan runde 4 (21.10.2026), endret av Emil 27.10.2026:
//   • ikke et eget verktøy, men et TREDJE VALG i Rapport-menyen
//     («Fullstendig» · «Byggemøte» · «Dagsrapport»);
//   • BARE på kontorsiden — alle som dokumenterer har kontortilgang, og
//     byggeplass-innloggingen skal ikke bli mer komplisert;
//   • prøvebilde C: skjema + UKE-STRIPE (levert / mangler / i dag) og
//     «Hele uka som PDF» med en forside for uka;
//   • egen kolonne for FAG i bemanningen, og bilder kan legges ved.
//
// Lagring: én JSON per prosjekt i SharePoint-mappa «Dagsrapporter»
// (dagsrapport.js). Hver VERSJON er en egen post — en signert rapport låses,
// og «Ny versjon» lager en ny post. Den gamle blir liggende. Ingenting slettes.
//
// Alt her er uten DOM, S og jsPDF.
import { dagnavn, datoLang, leggTilDager } from "./vaer-regn.js";

export const MAKS_BEMANNING = 30;
export const MAKS_BILDER = 12;
export const MAKS_MARKERINGER = 40;
export const MAKS_TEKST = 4000;
export const MAKS_SIGNATUR = 60000;      // samme tak som sjekklistene
export const FAG_FORSLAG = ["Betong", "Armering", "Forskaling", "Stålmontasje", "Grunnarbeid",
  "Tømrer", "Elektro", "Rør", "Ventilasjon", "Stillas", "Kran", "Annet"];

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n);
const dato = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : "";
const tall = (v) => (v == null || v === "" || !isFinite(Number(v))) ? null : Number(v);
const ikkeNeg = (v) => { const n = tall(v); return n == null ? null : Math.max(0, n); };

// ---------- Fil og navn ----------
// «20652.dagsrapporter.json». Uten prosjektnummer: modellnavnet, som EM-ene.
export function rapportFil(prosjektNr, modellFil) {
  const ren = (s) => String(s || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-").trim().slice(0, 80);
  return (ren(prosjektNr) || ren(modellFil) || "uten-prosjekt") + ".dagsrapporter.json";
}
const filDel = (s) => String(s || "").replace(/[\\/:*?"<>|#%]/g, "-").trim().slice(0, 60);

// «20652 2026-10-27 Dagsrapport.pdf» / «… Dagsrapport v2.pdf»
export function pdfNavn(prosjektNr, d, versjon) {
  const p = filDel(prosjektNr);
  return (p ? p + " " : "") + d + " Dagsrapport" + (Number(versjon) > 1 ? " v" + Number(versjon) : "") + ".pdf";
}
export function ukePdfNavn(prosjektNr, mandag) {
  const u = ukeNr(mandag);
  const p = filDel(prosjektNr);
  return (p ? p + " " : "") + "Dagsrapporter uke " + u.uke + " " + u.aar + ".pdf";
}
export function bildeNavn(prosjektNr, d, id) {
  return (filDel(prosjektNr) || "dagsrapport") + "-" + d + "-" + String(id).replace(/[^a-z0-9-]/gi, "") + ".jpg";
}
const BILDE_RE = /^[^\\/:*?"<>|#%]{1,140}\.jpg$/;

// ---------- Vask ----------
export function vaskBemanning(r) {
  if (!r || typeof r !== "object") return null;
  const ut = { firma: tekst(r.firma, 80).trim(), fag: tekst(r.fag, 40).trim(),
    antall: ikkeNeg(r.antall), timer: ikkeNeg(r.timer) };
  if (ut.antall != null) ut.antall = Math.round(ut.antall);
  if (ut.timer != null) ut.timer = Math.round(ut.timer * 10) / 10;
  return (ut.firma || ut.fag || ut.antall || ut.timer) ? ut : null;
}

export function vaskVaer(v) {
  if (!v || typeof v !== "object" || !v.harData) return null;
  const st = (x) => ["ja", "delvis", "nei"].includes(x) ? x : "";
  return {
    harData: true,
    min: tall(v.min), maks: tall(v.maks), regnSum: tall(v.regnSum) || 0,
    maksVind: tall(v.maksVind), maksKast: tall(v.maksKast),
    bilde: tekst(v.bilde, 12), kilde: tekst(v.kilde, 12),
    kran: st(v.kran), stop: st(v.stop), frost: st(v.frost),
    frostFra: tall(v.frostFra), kranFra: tall(v.kranFra)
  };
}

function vaskMerk(m) {
  if (!m || typeof m !== "object") return null;
  const t = tekst(m.tekst, 200).trim();
  if (!t) return null;
  return { id: tekst(m.id, 60), tekst: t, status: tekst(m.status, 20),
    hva: ["ny", "svar"].includes(m.hva) ? m.hva : "ny", svar: tekst(m.svar, 200), av: tekst(m.av, 80) };
}

export function vaskRapport(r) {
  if (!r || typeof r !== "object") return null;
  const d = dato(r.dato);
  if (!d) return null;
  const versjon = Math.max(1, Math.round(tall(r.versjon) || 1));
  const s = r.signert && typeof r.signert === "object" && String(r.signert.navn || "").trim() ? {
    navn: tekst(r.signert.navn, 80).trim(), tid: tekst(r.signert.tid, 40),
    signatur: (typeof r.signert.signatur === "string" && r.signert.signatur.length <= MAKS_SIGNATUR &&
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.signert.signatur)) ? r.signert.signatur : ""
  } : null;
  return {
    id: rapportId(d, versjon), dato: d, versjon,
    prosjekt: tekst(r.prosjekt, 30), prosjektNavn: tekst(r.prosjektNavn, 120), modell: tekst(r.modell, 160),
    vaer: vaskVaer(r.vaer),
    bemanning: (Array.isArray(r.bemanning) ? r.bemanning : []).map(vaskBemanning).filter(Boolean).slice(0, MAKS_BEMANNING),
    utfort: tekst(r.utfort, MAKS_TEKST), hindringer: tekst(r.hindringer, MAKS_TEKST),
    medMarkeringer: r.medMarkeringer !== false,
    markeringer: (Array.isArray(r.markeringer) ? r.markeringer : []).map(vaskMerk).filter(Boolean).slice(0, MAKS_MARKERINGER),
    bilder: (Array.isArray(r.bilder) ? r.bilder : [])
      .filter(b => b && BILDE_RE.test(String(b.fil || "")))
      .map(b => ({ fil: String(b.fil), tekst: tekst(b.tekst, 160) })).slice(0, MAKS_BILDER),
    laget: tekst(r.laget, 30), lagetAv: tekst(r.lagetAv, 80),
    endret: tekst(r.endret, 30), endretAv: tekst(r.endretAv, 80),
    signert: s, forrige: tekst(r.forrige, 30)
  };
}

export const rapportId = (d, versjon) => d + "-v" + Math.max(1, Math.round(Number(versjon) || 1));
export const erLaast = (r) => !!(r && r.signert);

// Tom rapport for en dag. Navn og prosjekt fylles av den som kaller.
export function nyRapport(d, o) {
  const k = o || {};
  return vaskRapport({ dato: d, versjon: 1, prosjekt: k.prosjekt, prosjektNavn: k.prosjektNavn, modell: k.modell,
    bemanning: [], medMarkeringer: true });
}

// «Ny versjon» av en låst rapport: samme innhold, neste nummer, ikke signert.
export function nyVersjon(r, alle) {
  const hoyeste = (alle || []).filter(x => x && x.dato === r.dato).reduce((m, x) => Math.max(m, x.versjon || 1), r.versjon || 1);
  return vaskRapport(Object.assign({}, r, { versjon: hoyeste + 1, signert: null, forrige: r.id, laget: "", lagetAv: "", endret: "", endretAv: "" }));
}

// Gjeldende versjon per dag: den med høyest nummer.
export function gjeldende(liste) {
  const ut = new Map();
  for (const r of liste || []) {
    if (!r || !r.dato || r.slettet) continue;
    const f = ut.get(r.dato);
    if (!f || r.versjon > f.versjon) ut.set(r.dato, r);
  }
  return ut;
}
export const versjonerFor = (liste, d) => (liste || []).filter(r => r && r.dato === d && !r.slettet).sort((a, b) => a.versjon - b.versjon);

// Løpenummeret: hvilken rapportdag dette er på prosjektet (1, 2, 3 …).
export function lopenr(liste, d) {
  const dager = [...gjeldende(liste).keys()];
  if (!dager.includes(d)) dager.push(d);
  return dager.sort().indexOf(d) + 1;
}

// ---------- Uka ----------
export function mandagFor(iso) {
  const n = ["man", "tir", "ons", "tor", "fre", "lør", "søn"].indexOf(dagnavn(iso));
  return leggTilDager(iso, -Math.max(0, n));
}
// ISO-ukenummer (uka med årets første torsdag er uke 1).
export function ukeNr(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  const dag = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dag + 3);
  const aar = x.getUTCFullYear();
  const forste = new Date(Date.UTC(aar, 0, 4));
  return { aar, uke: 1 + Math.round(((x - forste) / 864e5 - 3 + ((forste.getUTCDay() + 6) % 7)) / 7) };
}
export const erHelg = (iso) => ["lør", "søn"].includes(dagnavn(iso));

// Én rute per dag i uka. status:
//   "levert"  – signert rapport      "utkast" – lagret, ikke signert
//   "mangler" – passert arbeidsdag uten rapport
//   "idag"    – i dag, ingen rapport ennå
//   "fremtid" – ikke kommet ennå     "helg" – lørdag/søndag uten rapport
export function ukeStatus(liste, mandag, iDag) {
  const g = gjeldende(liste);
  const ut = [];
  for (let i = 0; i < 7; i++) {
    const d = leggTilDager(mandag, i), r = g.get(d) || null;
    let status;
    if (r) status = erLaast(r) ? "levert" : "utkast";
    else if (d === iDag) status = "idag";
    else if (d > iDag) status = "fremtid";
    else status = erHelg(d) ? "helg" : "mangler";
    ut.push({ dato: d, dag: dagnavn(d), dagNr: Number(d.slice(8)), status, iDag: d === iDag, rapport: r });
  }
  return ut;
}
export function ukeTelling(status) {
  const s = status || [];
  return {
    levert: s.filter(x => x.status === "levert").length,
    utkast: s.filter(x => x.status === "utkast").length,
    mangler: s.filter(x => x.status === "mangler").length,
    // Arbeidsdager som er passert eller er i dag — de som kunne vært levert
    arbeidsdager: s.filter(x => !erHelg(x.dato) && x.status !== "fremtid").length
  };
}

// ---------- Bemanning ----------
export function bemanningSum(rader) {
  let antall = 0, timer = 0;
  for (const r of rader || []) { antall += Number(r && r.antall) || 0; timer += Number(r && r.timer) || 0; }
  return { antall, timer: Math.round(timer * 10) / 10 };
}
// «Samme som i går»: bemanningen fra siste rapport FØR denne dagen.
export function forrigeBemanning(liste, d) {
  const g = [...gjeldende(liste).values()].filter(r => r.dato < d && r.bemanning.length).sort((a, b) => b.dato.localeCompare(a.dato));
  return g.length ? { dato: g[0].dato, rader: g[0].bemanning.map(x => Object.assign({}, x)) } : null;
}
// Firmanavn brukt før på prosjektet — forslag i firmafeltet.
export function tidligereFirma(liste) {
  const s = new Set();
  for (const r of liste || []) for (const b of (r && r.bemanning) || []) if (b.firma) s.add(b.firma);
  return [...s].sort((a, b) => a.localeCompare(b, "no"));
}

// ---------- Ukesummen (forsiden i ukes-PDF-en) ----------
export function ukeSum(liste, mandag, iDag) {
  const status = ukeStatus(liste, mandag, iDag || "9999-12-31");
  const dager = status.filter(s => s.rapport).map(s => s.rapport);
  const folk = dager.map(r => bemanningSum(r.bemanning)).filter(b => b.antall > 0);
  const tell = ukeTelling(status);
  return {
    mandag, sondag: leggTilDager(mandag, 6), ...ukeNr(mandag),
    antall: dager.length, levert: tell.levert, utkast: tell.utkast, mangler: tell.mangler, arbeidsdager: tell.arbeidsdager,
    mannskapSnitt: folk.length ? Math.round(folk.reduce((s, b) => s + b.antall, 0) / folk.length * 10) / 10 : 0,
    timerSum: Math.round(dager.reduce((s, r) => s + bemanningSum(r.bemanning).timer, 0) * 10) / 10,
    frostDager: dager.filter(r => r.vaer && r.vaer.frost === "nei").length,
    rader: status.filter(s => s.rapport || s.status === "mangler").map(s => ({
      dato: s.dato, dag: s.dag, status: s.status, rapport: s.rapport,
      folk: s.rapport ? bemanningSum(s.rapport.bemanning).antall : 0,
      kort: s.rapport ? kortTekst(s.rapport.utfort, 60) : "",
      avvik: s.rapport ? avvikLinjer(s.rapport.hindringer).length : 0
    })),
    avvik: dager.filter(r => avvikLinjer(r.hindringer).length).map(r => ({ dato: r.dato, dag: dagnavn(r.dato), tekst: kortTekst(r.hindringer, 220) }))
  };
}
// «Ingen», «-» og tomt teller ikke som avvik.
export function avvikLinjer(t) {
  return String(t || "").split(/\n+/).map(s => s.trim())
    .filter(s => s && !/^(ingen|nei|-+|–|ok|0)\.?$/i.test(s));
}
export function kortTekst(t, n) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const kutt = s.slice(0, n - 1), mellom = kutt.lastIndexOf(" ");
  return (mellom > n * 0.6 ? kutt.slice(0, mellom) : kutt) + "…";
}

// ---------- Dagens markeringer ----------
// Markeringenes dato er «27.10.2026, 15:42» (toLocaleString no-NO), og eldre
// kan mangle den — da brukes tidsstempelet i ID-en (1785919803135-4wru9o).
export function datoFraTekst(s) {
  const t = String(s || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return "";
}
function datoFraId(id, lokalDato) {
  const m = /^(\d{12,14})-/.exec(String(id || ""));
  return m && typeof lokalDato === "function" ? lokalDato(new Date(Number(m[1])).toISOString()) : "";
}
// comments = S.comments. lokalDato(isoTid) → «YYYY-MM-DD» i norsk tid (vaer-regn
// lokal().dato) — sendes inn så denne fila slipper å vite om tidssoner.
export function dagensMarkeringer(comments, d, lokalDato) {
  const ut = [];
  for (const c of comments || []) {
    if (!c) continue;
    const laget = datoFraTekst(c.date) || datoFraId(c.id, lokalDato);
    const svar = (Array.isArray(c.svar) ? c.svar : []).filter(s => s && datoFraTekst(s.dato) === d);
    const tittel = String(c.text || "").split("\n")[0].trim() || "—";
    if (laget === d) ut.push({ id: String(c.id), tekst: tittel, status: c.status || "Åpen", hva: "ny", svar: "", av: c.author || "" });
    else if (svar.length) {
      const s = svar[svar.length - 1];
      ut.push({ id: String(c.id), tekst: tittel, status: c.status || "Åpen", hva: "svar",
        svar: String(s.tekst || "").split("\n")[0].slice(0, 200), av: s.forfatter || "" });
    }
  }
  return ut.slice(0, MAKS_MARKERINGER);
}

// ---------- Været ----------
// Øyeblikksbilde av dagSum (vaer-regn) — lagres i rapporten, så PDF-en sier
// det samme om et år, uansett hva værtjenesten svarer da.
export function vaerFraSum(sum, kilde) {
  if (!sum || !sum.harData) return null;
  // perioder() gir [[fra, til], …] — vi tar første time
  const forste = (p) => (Array.isArray(p) && Array.isArray(p[0]) && isFinite(p[0][0])) ? p[0][0] : null;
  return vaskVaer({
    harData: true, min: sum.min, maks: sum.maks, regnSum: sum.regnSum, maksVind: sum.maksVind, maksKast: sum.maksKast,
    bilde: sum.bilde, kilde,
    kran: sum.status && sum.status.kran, stop: sum.status && sum.status.stop, frost: sum.status && sum.status.frost,
    frostFra: forste(sum.frostTimer), kranFra: forste(sum.kranTimer)
  });
}
const desimal = (v, n) => (Math.round(Number(v) * 10 ** n) / 10 ** n).toFixed(n).replace(".", ",").replace(/,0+$/, "");
const grader = (v) => (v < 0 ? "−" : "") + desimal(Math.abs(v), 0);
export function vaerTekst(v) {
  if (!v || !v.harData) return "";
  const del = [];
  if (v.min != null && v.maks != null) del.push(grader(v.min) + " / " + grader(v.maks) + " °C");
  del.push(desimal(v.regnSum || 0, 1) + " mm");
  if (v.maksVind != null) del.push("vind " + desimal(v.maksVind, 0) + " m/s" + (v.maksKast != null && v.maksKast > v.maksVind ? " (kast " + desimal(v.maksKast, 0) + ")" : ""));
  return del.join(" · ");
}
// Merkelappene til høyre for været (kranstopp, støp, frost). Norske nøkler — oversettes med t().
export function vaerMerker(v) {
  if (!v || !v.harData) return [];
  const ut = [];
  if (v.kran === "nei") ut.push({ niva: "rod", tekst: "Kranstopp" });
  else if (v.kran === "delvis") ut.push({ niva: "rod", tekst: "Kranstopp i perioder" });
  if (v.stop === "nei") ut.push({ niva: "gul", tekst: "Ikke støpevær" });
  if (v.frost === "nei") ut.push({ niva: "gul", tekst: "Frostfare" });
  if (!ut.length) ut.push({ niva: "ok", tekst: "Godt arbeidsvær" });
  return ut;
}

// ---------- Til visning ----------
export const DAG_LANG = { man: "mandag", tir: "tirsdag", ons: "onsdag", tor: "torsdag", fre: "fredag", "lør": "lørdag", "søn": "søndag" };
export const dagOgDato = (d) => DAG_LANG[dagnavn(d)] + " " + datoLang(d);

// Ble noe endret siden siste lagring? Sammenligner bare det brukeren skriver.
export function likeRapporter(a, b) {
  if (!a || !b) return !a && !b;
  const kjerne = (r) => JSON.stringify([r.bemanning, r.utfort, r.hindringer, r.medMarkeringer, r.bilder]);
  return kjerne(a) === kjerne(b);
}
