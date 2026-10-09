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
    endret: tekst(p.endret, 40)
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
  return (ut.navn || ut.nummer || ut.adresse || ut.lat != null) ? ut : null;
}

// Verktøyenes egne logovalg: null (aldri valgt) og PROSJEKT_LOGO betyr
// «bruk prosjektets logo». "" = ingen logo; ellers et filnavn.
export function erStandardLogo(v) { return v === null || v === undefined || v === PROSJEKT_LOGO; }
export function fraLogoValg(verdi) { return verdi === PROSJEKT_LOGO ? null : String(verdi || ""); }
