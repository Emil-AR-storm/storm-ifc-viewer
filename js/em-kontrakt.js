// 📜 KONTRAKT OG VARSEL (byggeplan EM runde 2, Emils prøve A, 26.10.2026)
//
// Evalueringen av Em-test 3 fant det en byggherre ville bestride først: EM-en
// sa ikke HVEM den gikk til, UNDER HVILKEN KONTRAKT, HVA SLAGS varsel det var,
// eller HVILKEN HJEMMEL kravet bygger på. Nå:
//
//   • Kontrakt, standard, avviksbilag og mottaker huskes per prosjekt i
//     SharePoint-mappa Endringsmeldinger (<prosjektnr>.kontrakt.json) — samme
//     interne mappe som EM-ene, som Workeren og byggeplassen aldri ser.
//   • Type varsel, hjemmel, revisjon, «modell mottatt» og «arbeidet er» fylles
//     per EM. Hjemlene brukeren har skrevet huskes per type varsel.
//   • Sjekklisten (åtte punkter, rødt/gult/grønt) viser hva som mangler.
//     Rødt sperrer signering — EM-en kan lages og PDF lastes ned for kontroll,
//     men den merkes «UTKAST – IKKE SENDEKLAR» (B6).
//
// 🚫 Verktøyet foreslår ALDRI punktnummer, frister eller ordlyd fra NS 8405/8407
// (B7). Storm har ikke lisens til standardene; hjemmelen skrives av brukeren.
import { S } from "./state.js";
import { spLes, spSkriv } from "./sp-lager.js";
import { EM_MAPPE } from "./em-lager.js";

export const STANDARDER = ["NS 8405", "NS 8406", "NS 8407", "NS 8415", "NS 8416", "NS 8417", "Annet"];
export const VARSELTYPER = ["Varsel om endring", "Nøytralt varsel", "Spesifisert krav", "Varsel om fristforlengelse"];
export const ARBEIDET = ["Ikke produsert", "Produsert", "Levert", "Montert"];
export const FORELOPIG = "Foreløpig – spesifisert krav ettersendes";

const tekst = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n || 200);
const dato = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";

// Det som huskes per prosjekt
export function vaskKontrakt(r) {
  const o = r && typeof r === "object" ? r : {};
  const hj = {};
  if (o.hjemler && typeof o.hjemler === "object")
    for (const ty of VARSELTYPER) {
      const l = Array.isArray(o.hjemler[ty]) ? o.hjemler[ty] : [];
      const ut = [...new Set(l.map(x => tekst(x, 160)).filter(Boolean))].slice(0, 12);
      if (ut.length) hj[ty] = ut;
    }
  return {
    id: "kontrakt",
    kontrakt: tekst(o.kontrakt, 120),
    standard: STANDARDER.includes(o.standard) ? o.standard : "",
    avviksbilag: tekst(o.avviksbilag, 160),
    mottaker: tekst(o.mottaker, 160),
    hjemler: hj,
    endret: tekst(o.endret, 30)
  };
}

// Det som fylles per EM
export function vaskVarsel(r) {
  const o = r && typeof r === "object" ? r : {};
  return {
    type: VARSELTYPER.includes(o.type) ? o.type : "",
    hjemmel: tekst(o.hjemmel, 160),
    revFor: tekst(o.revFor, 80),
    revEtter: tekst(o.revEtter, 80),
    mottatt: dato(o.mottatt),
    arbeidet: ARBEIDET.includes(o.arbeidet) ? o.arbeidet : ""
  };
}

// «Totalentreprise 2025-14, NS 8407 + Bilag 3 – endringer»
export function kontraktTekst(k) {
  const deler = [k.kontrakt, k.standard && k.standard !== "Annet" ? k.standard : ""].filter(Boolean).join(", ");
  return deler + (k.avviksbilag ? (deler ? " + " : "") + k.avviksbilag : "");
}
export function revisjonTekst(v) {
  if (!v.revFor && !v.revEtter) return "";
  return (v.revEtter || "ny") + " mot " + (v.revFor || "forrige");
}

// Ny hjemmel først i lista for typen, uten dubletter
export function huskHjemmel(k, type, hjemmel) {
  const h = tekst(hjemmel, 160);
  if (!h || !VARSELTYPER.includes(type)) return k;
  const l = [h].concat((k.hjemler[type] || []).filter(x => x !== h)).slice(0, 12);
  return Object.assign({}, k, { hjemler: Object.assign({}, k.hjemler, { [type]: l }) });
}

// 🚦 Sjekklisten. o: { emNr, endret, omarbeidMed, omarbeidPris, postMangler, linjer }
// Svar: [{ id, niva: "ok"|"gul"|"rod", tekst }] — rødt sperrer signering.
export function sjekkliste(k, v, o) {
  const opt = o || {};
  const p = (id, niva, tekst) => ({ id, niva, tekst });
  const ut = [];
  ut.push(String(opt.emNr || "").trim() ? p("nr", "ok", "EM-nr.: " + String(opt.emNr).trim())
    : p("nr", "gul", "EM-nr. mangler — hent neste nummer fra Storm Prosjektoversikt"));
  ut.push(k.mottaker ? p("mottaker", "ok", "Mottaker: " + k.mottaker) : p("mottaker", "rod", "Mottaker mangler"));
  ut.push(k.kontrakt && k.standard ? p("kontrakt", "ok", "Kontrakt og standard: " + kontraktTekst(k))
    : p("kontrakt", "rod", !k.kontrakt ? "Kontrakt mangler" : "Standard mangler"));
  ut.push(v.type ? p("type", "ok", "Type varsel: " + v.type) : p("type", "rod", "Type varsel mangler"));
  ut.push(v.hjemmel ? p("hjemmel", "ok", "Hjemmel: " + v.hjemmel) : p("hjemmel", "rod", "Hjemmel mangler — skriv punktet fra kontrakten"));
  ut.push(v.revFor && v.revEtter ? p("rev", "ok", "Revisjon: " + revisjonTekst(v)) : p("rev", "gul", "Revisjon før/etter er ikke fylt inn"));
  const n = Number(opt.endret) || 0, el = n === 1 ? "1 endret element" : n + " endrede elementer";
  ut.push(!n ? p("folge", "ok", "Ingen endrede elementer som kan gi omarbeid")
    : opt.omarbeidMed && opt.omarbeidPris ? p("folge", "ok", "Følgekostnader: omarbeid av " + el + " er priset")
    : opt.omarbeidMed ? p("folge", "gul", "Følgekostnader: omarbeid av " + el + " mangler pris")
    : p("folge", "gul", "Følgekostnader: " + el + " er ikke priset (omarbeid)"));
  // Sammenligningen parret under halvparten (to ulike modeller?) — vises bare da
  if (opt.usikker) ut.push(p("usikker", "gul", "Sammenligningen er usikker: under halvparten av elementene lot seg parre — kontroller at det er to revisjoner av samme modell"));
  // 🧾 runde 3: kontraktsposten per linje
  const pm = Number(opt.postMangler) || 0;
  ut.push(pm ? p("post", "gul", "Kontraktspost mangler på " + pm + (pm === 1 ? " linje" : " linjer") + " — skriv punktet fra prislista")
    : p("post", "ok", (opt.linjer ? "Kontraktspost på alle linjer" : "Ingen linjer å poste")));
  ut.push(!v.arbeidet ? p("arbeidet", "gul", "Velg om arbeidet er produsert, levert eller montert")
    : v.arbeidet === "Ikke produsert" ? p("arbeidet", "ok", "Arbeidet er ikke produsert")
    : p("arbeidet", "gul", "Arbeidet er " + v.arbeidet.toLowerCase() + " — vurder fremdrift (2.1) og omarbeid/vrak"));
  return ut;
}
export const rodePunkter = (liste) => (liste || []).filter(x => x.niva === "rod");

// ---------- SharePoint (intern, som EM-ene) ----------
export function kontraktFil() {
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const ren = (s) => String(s || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-").trim().slice(0, 80);
  return (ren(info && info.nummer) || ren(S.fileName) || "uten-prosjekt") + ".kontrakt.json";
}
export async function lesKontrakt() {
  const r = await spLes(EM_MAPPE, kontraktFil());
  const post = (r.liste || []).find(x => x && x.id === "kontrakt" && !x.slettet);
  return { status: r.status, kontrakt: vaskKontrakt(post) };
}
export async function lagreKontrakt(k) {
  const post = Object.assign(vaskKontrakt(k), { endret: new Date().toISOString() });
  const r = await spSkriv(EM_MAPPE, kontraktFil(), [post], (x) => String(x && x.id || ""));
  return { ok: r.ok, grunn: r.grunn, kontrakt: post };
}
