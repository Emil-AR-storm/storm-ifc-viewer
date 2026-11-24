// 🗂 Prosjektinfo — REGNINGEN (ren, testes i Node uten nettleser).
//
// HVORFOR (Emil 09.10): «finn alle steder som har felles info — adresse, logo
// til PDF-er — sånn at vi kan legge de inn i Innstillinger, og når de blir
// fylt ut der blir det automatisk fylt ut i alle verktøy som har det punktet».
// Kartleggingen (byggeplanen 09.10) fant logoen valgt på seks steder,
// prosjektnavn/-nummer på fem og adressen på tre — hver for seg.
//
// Prosjektinfo lagres PER MODELL (én bruker jobber på mange prosjekter).
// REKKEFØLGEN er lik overalt:
//   1. det brukeren har fylt ut i selve verktøyet (gjelder bare der)
//   2. Prosjektinfo
//   3. det som fantes fra før (terrengets adresse, prosjektnummeret fra
//      Storm-Byggeplass, logoen fra rapportmenyen)
// Slik slutter ingenting som virket i går, å virke i dag.
import { fraTM } from "./terreng-regn.js";

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n).trim();
const tall = (v) => { const x = Number(v); return (v === "" || v == null || !Number.isFinite(x)) ? null : x; };

// Logo-verdien i verktøyenes egne valg som betyr «bruk Prosjektinfo».
export const PROSJEKT_LOGO = "@prosjekt";

export function vaskAdresseInfo(a) {
  if (!a || typeof a !== "object") return null;
  const t = tekst(a.tekst, 160);
  const E = tall(a.E), N = tall(a.N);
  if (!t) return null;
  const ut = {
    tekst: t,
    postnummer: tekst(a.postnummer, 8),
    poststed: tekst(a.poststed, 60),
    kommune: tekst(a.kommune, 60),
    E: E != null && E > 0 && E < 2e6 ? Math.round(E * 10) / 10 : null,
    N: N != null && N > 5e6 && N < 9e6 ? Math.round(N * 10) / 10 : null
  };
  // lat/lon regnes alltid fra E/N (UTM33) — vær-API-ene vil ha grader.
  if (ut.E != null && ut.N != null) {
    const g = fraTM(ut.E, ut.N, "25833");
    ut.lat = Math.round(g.lat * 1e5) / 1e5;
    ut.lon = Math.round(g.lon * 1e5) / 1e5;
  } else { ut.lat = null; ut.lon = null; }
  return ut;
}

// ▲ KOTE (Emil 24.11, prøvebilde B + felt i Innstillinger): er kotene i modellen
// meter over havet? Modellen kan være eksportert fra prosjektets nullpunkt (0
// = bunnen av bygget) i stedet for med høyde over havet. Da settes en
// FORSKYVNING (meter) for hele modellen, enten fra et punkt med kjent kote
// eller ved at noen bekrefter at kotene er riktige.
//   forskyv   – meter som legges til modellens egne koter
//   kote      – koten brukeren skrev for punktet (moh.)
//   punktKote – modellens egen kote i punktet (meter)
//   punkt     – hva punktet er («OK gulv 1. etasje»), valgfritt
//   bekreftet – «Ja, kotene er riktige» (forskyv 0)
export const KOTE_SPOR = { fra: -5, til: 5 };   // bygget starter mellom −5 og +5 m: spør
export function vaskKote(k) {
  if (!k || typeof k !== "object") return null;
  if (k.bekreftet === true) return { bekreftet: true, forskyv: 0, av: tekst(k.av, 80), endret: tekst(k.endret, 40) };
  const f = tall(k.forskyv);
  if (f == null || Math.abs(f) > 10000) return null;
  const ut = { forskyv: Math.round(f * 1000) / 1000, punkt: tekst(k.punkt, 80), av: tekst(k.av, 80), endret: tekst(k.endret, 40) };
  const kt = tall(k.kote), pk = tall(k.punktKote);
  if (kt != null && Math.abs(kt) < 10000) ut.kote = Math.round(kt * 1000) / 1000;
  if (pk != null && Math.abs(pk) < 100000) ut.punktKote = Math.round(pk * 1000) / 1000;
  return ut;
}
// Status for modellens koter. bunnM = modellens egen kote nederst i bygget (m).
//   "bekreftet" | "satt" | "usikker" (spør) | "sannsynlig" (ser ut som moh.) | "ukjent"
export function koteStatus(kote, bunnM) {
  const k = vaskKote(kote);
  if (k && k.bekreftet) return "bekreftet";
  if (k) return "satt";
  if (bunnM == null || !Number.isFinite(bunnM)) return "ukjent";
  return bunnM >= KOTE_SPOR.fra && bunnM <= KOTE_SPOR.til ? "usikker" : "sannsynlig";
}
// «+12,350» / «−0,200» – koter skrives alltid med fortegn og tre desimaler
export const fmtKote = (m) => (m < 0 ? "−" : "+") + Math.abs(m).toFixed(3).replace(".", ",");
export const koteForskyv = (kote) => { const k = vaskKote(kote); return k && !k.bekreftet ? k.forskyv : 0; };
// Tall skrevet med komma eller punktum («12,700», «+12.7») → meter, ellers null.
export function lesKoteTall(v) {
  const s = String(v == null ? "" : v).trim().replace(/\s+/g, "").replace(",", ".").replace(/^\+/, "").replace(/^[−–]/, "-");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) && Math.abs(x) < 10000 ? x : null;
}

export function vaskProsjektInfo(x) {
  const p = x && typeof x === "object" ? x : {};
  return {
    navn: tekst(p.navn, 120),
    nummer: tekst(p.nummer, 20),
    byggherre: tekst(p.byggherre, 120),
    leder: tekst(p.leder, 80),
    telefon: tekst(p.telefon, 30),
    logo: tekst(p.logo, 200),
    adresse: vaskAdresseInfo(p.adresse),
    endret: tekst(p.endret, 40),
    ...(vaskKote(p.kote) ? { kote: vaskKote(p.kote) } : {}),
    // ✍️ 1B (runde 5, 23.11): det som sist ble hentet fra Storm Prosjekter. Brukes
    // til «✓ hentet» / «✎ endret her», og til å følge endringer der.
    ...(p.sp && typeof p.sp === "object" ? { sp: {
      navn: tekst(p.sp.navn, 120), nummer: tekst(p.sp.nummer, 20), byggherre: tekst(p.sp.byggherre, 120),
      leder: tekst(p.sp.leder, 80), telefon: tekst(p.sp.telefon, 30), adresse: tekst(p.sp.adresse, 160),
      nokkel: tekst(p.sp.nokkel, 60), hentet: tekst(p.sp.hentet, 40) } } : {})
  };
}

export function tomInfo(p) {
  const v = vaskProsjektInfo(p);
  return !v.navn && !v.nummer && !v.byggherre && !v.leder && !v.telefon && !v.logo && !v.adresse;
}

// Det som faktisk gjelder for modellen, med hvor hvert felt kom fra
// («info», «terreng», «byggeplass», «rapport» eller «»).
//   kilder: { lettProsjekt, bpNummer, terreng: S.terrengRef(), rapLogo }
export function gjeldende(info, kilder) {
  const p = vaskProsjektInfo(info);
  const k = kilder || {};
  const fra = {};
  const velg = (felt, ...alt) => {
    for (const [verdi, kilde] of alt) if (verdi) { fra[felt] = kilde; return verdi; }
    fra[felt] = ""; return "";
  };
  const ut = {
    navn: velg("navn", [p.navn, "info"]),
    nummer: velg("nummer", [p.nummer, "info"], [tekst(k.lettProsjekt, 20), "byggeplass"], [tekst(k.bpNummer, 20), "byggeplass"]),
    byggherre: velg("byggherre", [p.byggherre, "info"]),
    leder: velg("leder", [p.leder, "info"]),
    telefon: velg("telefon", [p.telefon, "info"]),
    logo: velg("logo", [p.logo, "info"], [tekst(k.rapLogo, 200), "rapport"])
  };
  let adr = p.adresse;
  fra.adresse = adr ? "info" : "";
  const ter = k.terreng;
  if (!adr && ter && (ter.adresse || (ter.adresseE && ter.adresseN))) {
    adr = vaskAdresseInfo({ tekst: ter.adresse || (Math.round(ter.adresseE) + " Ø, " + Math.round(ter.adresseN) + " N"), kommune: ter.kommune, E: ter.adresseE, N: ter.adresseN });
    if (adr) fra.adresse = "terreng";
  }
  ut.adresse = adr ? adr.tekst : "";
  ut.adresseFull = adr ? [adr.tekst, [adr.postnummer, adr.poststed].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  ut.kommune = adr ? adr.kommune : "";
  ut.E = adr ? adr.E : null; ut.N = adr ? adr.N : null;
  ut.lat = adr ? adr.lat : null; ut.lon = adr ? adr.lon : null;
  ut.kote = p.kote || null;
  ut.koteForskyv = koteForskyv(p.kote);
  ut.fra = fra;
  return ut;
}

// Et felt i et verktøy: brukerens eget hvis det er fylt ut, ellers Prosjektinfo.
export function felt(egen, felles) {
  const e = tekst(egen, 400);
  return e || tekst(felles, 400);
}

// «20652 · Byggeprosjekt · Storgata 1» — undertittelen på PDF-ene.
export function undertittel(g, medAdresse) {
  if (!g) return "";
  return [g.nummer, g.navn, medAdresse === false ? "" : g.adresse].filter(Boolean).join(" · ");
}

// Byggeplass-siden får bare det den bruker: navn, nummer, adresse og
// posisjonen (til været i Framdriftsplan).
export function forByggeplass(g) {
  if (!g) return null;
  const ut = { navn: g.navn || "", nummer: g.nummer || "", adresse: g.adresse || "", kommune: g.kommune || "",
    lat: g.lat != null ? g.lat : null, lon: g.lon != null ? g.lon : null };
  // ▲ Kotene på byggeplassen blir de samme som på kontoret
  const f = Number(g.koteForskyv);
  if (Number.isFinite(f) && f !== 0 && Math.abs(f) <= 10000) ut.koteForskyv = Math.round(f * 1000) / 1000;
  return (ut.navn || ut.nummer || ut.adresse || ut.lat != null || ut.koteForskyv) ? ut : null;
}

// Verktøyenes egne logovalg: null (aldri valgt) og PROSJEKT_LOGO betyr
// «bruk prosjektets logo». "" = ingen logo; ellers et filnavn.
export function erStandardLogo(v) { return v === null || v === undefined || v === PROSJEKT_LOGO; }
export function fraLogoValg(verdi) { return verdi === PROSJEKT_LOGO ? null : String(verdi || ""); }
