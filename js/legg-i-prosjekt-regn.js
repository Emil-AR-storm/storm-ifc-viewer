// 📁 «LEGG I PROSJEKT» – de rene reglene (ingen nettleser, ingen nett).
// BYGGEPLAN-legg-i-prosjekt-Storm-IFC-2026-11-10.md. Storm Prosjekter 4.24
// (js/ifcdok.js) leser det vi skriver, så typene, mappene og oversiktsfila
// er en FAST AVTALE – endres de her, må de endres der også.
// Prøves i _test/test-legg-i-prosjekt.mjs. Nett og dialog: legg-i-prosjekt.js.
import { hørerTil } from "./innebygd-regn.js";

export const STORM_PROSJEKTER_SITE = "/sites/StormProsjekter";
export const PROSJEKT_LISTE = "Prosjekter";
export const DOK_BIBLIOTEK = "Prosjektdokumenter";
export const OVERSIKT_MAPPE = "00 Prosjektprofil";
export const OVERSIKT_FIL = "storm-ifc-dokumenter.json";
export const MAKS_OVERSIKT = 2000;
export const ENKEL_GRENSE = 4 * 1024 * 1024;   // over dette: createUploadSession

// Typene (punkt 3 i byggeplanen). selskap = forslag i nedtrekkslista.
export const TYPER = {
  framdrift:   { navn: "Framdriftsplan", mappe: "04 Fremdrift", selskap: "SE" },
  stopeplan:   { navn: "Støpeplan", mappe: "04 Fremdrift", selskap: "SB" },
  montasje:    { navn: "Montasjeplan", mappe: "04 Fremdrift/Montasjeplaner", selskap: "SS" },
  riggplan:    { navn: "Riggplan", mappe: "05 HMS og SHA", selskap: "SE" },
  lofteplan:   { navn: "Løfteplan", mappe: "05 HMS og SHA", selskap: "SE" },
  // Mappenumre 12–14 (BYGGEPLAN-Storm-IFC-mappenummer-12-14, Storm Prosjekter 4.25):
  // «11 Dagsrapporter» kolliderte med «11 Underprosjekter».
  dagsrapport: { navn: "Dagsrapport", mappe: "12 Dagsrapporter", selskap: "SE" },
  byggemote:   { navn: "Rapport til byggemøte", mappe: "08 Møtereferater", selskap: "SE" },
  em:          { navn: "Endringsmelding", mappe: "06 Endringer", selskap: "SE" },
  fdv:         { navn: "FDV", mappe: "09 FDV og sluttdokumentasjon", selskap: "SE" },
  priskalk:    { navn: "Priskalkulasjon", mappe: "13 Kalkulasjoner", selskap: "SE" },
  // Emil 10.11 (tillegg): BCF-eksport og mengdelister i ny mappe, kollisjon i Beskrivelser
  bcf:         { navn: "BCF-eksport", mappe: "14 BIM og koordinering", selskap: "SE" },
  mengder:     { navn: "Mengdeliste", mappe: "13 Kalkulasjoner", selskap: "SE" },
  kollisjon:   { navn: "Kollisjonsrapport", mappe: "14 BIM og koordinering", selskap: "SE" },
  // Runde G (12.11): «Send til Storm Prosjekter» fra Sammenlign. PDF-en ligger i
  // 14 BIM og koordinering/Sammenligninger/<id>/, oversikten sier mappe «14 BIM og koordinering».
  sammenligning: { navn: "Sammenligning", mappe: "14 BIM og koordinering", selskap: "SE" },
  annet:       { navn: "Annet", mappe: "00 Prosjektprofil", selskap: "SE" }
};
export const typeInfo = (type) => TYPER[type] || TYPER.annet;
const SELSKAP_REKKE = ["SE", "SB", "SS"];

// Filnavn: navnet appen lager (med dato), uten "*:<>?/\|#%
export function vaskFilnavn(navn) {
  const v = String(navn || "").replace(/["*:<>?/\\|#%]/g, "-").replace(/\s+/g, " ").trim();
  return v || "dokument";
}

// ÅÅÅÅ-MM-DD (lokal dato)
export function isoDato(d) {
  const x = d instanceof Date ? d : new Date(d || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}

// Modell-feltet i lista: JSON { type: "fil"|"lett"|"gruppe", navn, id }
export function lesModellFelt(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { const o = JSON.parse(String(v)); return o && typeof o === "object" ? o : null; } catch (_) { return null; }
}

// Hører prosjektets modell til den som er åpen? åpen = { ifc, fil, gruppe }
//   gruppe: samme gruppe-id
//   ellers: samme IFC-navn, eller en lett kopi som hører til samme IFC
//   (prefiksregelen fra biblioteket – hørerTil i innebygd-regn.js)
export function modellTreff(felt, åpen) {
  const m = lesModellFelt(felt);
  if (!m || !åpen) return false;
  if (m.type === "gruppe") return !!åpen.gruppe && m.id === åpen.gruppe;
  const navn = String(m.navn || "").trim();
  if (!navn) return false;
  const lik = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const ifc = åpen.ifc || "";
  const fil = åpen.fil || "";
  if (lik(navn, ifc) || lik(navn, fil)) return true;
  // prosjektet har IFC-en, vi har en lett kopi av den – eller omvendt
  if (/\.ifc$/i.test(navn) && fil && hørerTil(fil, navn)) return true;
  if (ifc && !/\.ifc$/i.test(navn) && hørerTil(navn, ifc)) return true;
  return false;
}

const felt = (r) => (r && (r.fields || r)) || {};
export const erHovedprosjekt = (r) => !felt(r).ForelderNokkel;
export function prosjektTekst(r) {
  const f = felt(r);
  return [f.Arbeidsomrade, f.ProsjektNr, f.Title].filter(Boolean).join(" ");
}

// Jobben modellen hører til: alle hovedprosjekter med samme JobbNr som et
// treff (uten JobbNr: bare treffet selv). SE, så SB, så SS. Svar: [] = ingen
// treff (da velger brukeren selv – vi gjetter aldri).
export function finnJobb(rader, åpen) {
  const hoved = (rader || []).filter(erHovedprosjekt);
  const treff = hoved.filter(r => modellTreff(felt(r).Modell, åpen));
  if (!treff.length) return [];
  const jobbNr = new Set(treff.map(r => String(felt(r).JobbNr || "")).filter(Boolean));
  const ut = new Map();
  for (const r of treff) ut.set(felt(r).Nokkel, r);
  for (const r of hoved) if (jobbNr.has(String(felt(r).JobbNr || ""))) ut.set(felt(r).Nokkel, r);
  return sorterProsjekter([...ut.values()]);
}
export function sorterProsjekter(liste) {
  const rang = (r) => { const i = SELSKAP_REKKE.indexOf(String(felt(r).Arbeidsomrade || "").toUpperCase()); return i < 0 ? 9 : i; };
  return (liste || []).slice().sort((a, b) => rang(a) - rang(b) ||
    String(felt(a).ProsjektNr || "").localeCompare(String(felt(b).ProsjektNr || ""), "no", { numeric: true }));
}

// Jobben til et byggeplassnummer (felles dagsrapport, 12.11): byggeplassen
// kobles på prosjektnummeret (5 siffer). Treff = hovedprosjekt med samme
// ProsjektNr eller JobbNr; så hele jobben (samme JobbNr). [] = ingen treff.
export function jobbForNummer(rader, nr) {
  const n = String(nr || "").trim();
  if (!/^\d{5}$/.test(n)) return [];
  const hoved = (rader || []).filter(erHovedprosjekt);
  const treff = hoved.filter(r => String(felt(r).ProsjektNr || "").trim() === n || String(felt(r).JobbNr || "").trim() === n);
  if (!treff.length) return [];
  const jobbNr = new Set(treff.map(r => String(felt(r).JobbNr || "")).filter(Boolean));
  const ut = new Map();
  for (const r of treff) ut.set(felt(r).Nokkel, r);
  for (const r of hoved) if (jobbNr.has(String(felt(r).JobbNr || ""))) ut.set(felt(r).Nokkel, r);
  return sorterProsjekter([...ut.values()]);
}

// ---------- Én prosjektmappe per selskap (Storm Prosjekter 4.57, 18.11) ----------
// BYGGEPLAN-Storm-IFC-selskapsmapper-2026-11-18.md
//   Storm Entreprenør/20728 Lierstranda/…   Storm Betong/371 …   Storm Stål/105 …
//   _Arkiv felles mapper/…   ← de gamle felles mappene, flyttet urørt. Skriv ALDRI der.
export const SELSKAPSMAPPER = { SE: "Storm Entreprenør", SB: "Storm Betong", SS: "Storm Stål" };
export const ARKIV_MAPPE = "_Arkiv felles mapper";
export const selskapsmappe = (ao) => SELSKAPSMAPPER[String(ao || "").trim().toUpperCase()] || "";
const førsteDel = (sti) => String(sti || "").replace(/^\/+/, "").split("/")[0].toLowerCase();
export const underSelskapsmappe = (sti) => Object.values(SELSKAPSMAPPER).some(m => m.toLowerCase() === førsteDel(sti));
export const iArkiv = (sti) => førsteDel(sti) === ARKIV_MAPPE.toLowerCase();
// I selskapsmappa: første mappe som starter med «<ProsjektNr> » (uten selskapskode)
export function finnSelskapsmappeProsjekt(barn, r) {
  const pre = String(felt(r).ProsjektNr || "").trim().toLowerCase() + " ";
  if (pre === " ") return null;
  const m = (barn || []).find(x => x && x.folder && String(x.name || "").toLowerCase().startsWith(pre));
  return m ? m.name : null;
}
// Hovedselskapet i jobben (jobb-eieren): SE hvis jobben har SE, ellers det
// eldste prosjektet. Jobb-felles dokumenter (dagsrapporter) ligger bare der.
export function hovedselskap(jobb) {
  const l = (jobb || []).filter(Boolean);
  if (!l.length) return null;
  const se = l.find(r => String(felt(r).Arbeidsomrade || "").toUpperCase() === "SE");
  if (se) return se;
  const laget = (r) => String((r && (r.createdDateTime || (r.fields && r.fields.Created))) || "9999");
  return l.slice().sort((a, b) => laget(a) < laget(b) ? -1 : laget(a) > laget(b) ? 1 : 0)[0];
}
// Forslaget i nedtrekkslista (18.11): selskapet på modellen (prosjektet modellen
// er koblet til – ved flere: det typen hører til), ellers jobb-eieren.
// Dagsrapporter går alltid til hovedselskapet.
export function foreslåProsjekt(jobb, type, åpen) {
  if (!jobb || !jobb.length) return null;
  if (type === "dagsrapport") return hovedselskap(jobb);
  const ønsket = typeInfo(type).selskap;
  const treff = åpen ? jobb.filter(r => modellTreff(felt(r).Modell, åpen)) : [];
  if (treff.length) return treff.find(r => String(felt(r).Arbeidsomrade || "").toUpperCase() === ønsket) || treff[0];
  return hovedselskap(jobb);
}

// Søk i lista over alle hovedprosjekter (nummer og navn).
export function søkProsjekter(rader, tekst) {
  const q = String(tekst || "").trim().toLowerCase();
  const hoved = sorterProsjekter((rader || []).filter(erHovedprosjekt));
  if (!q) return hoved;
  return hoved.filter(r => prosjektTekst(r).toLowerCase().includes(q));
}

// Prosjektmappa i rota av Prosjektdokumenter: første mappe som starter med
// «<Arbeidsomrade> <ProsjektNr> ». Finnes den ikke, lager vi den IKKE.
export function prosjektPrefiks(r) {
  const f = felt(r);
  return String(f.Arbeidsomrade || "").trim() + " " + String(f.ProsjektNr || "").trim() + " ";
}
export function finnProsjektmappe(barn, r) {
  const pre = prosjektPrefiks(r).toLowerCase();
  const m = (barn || []).find(x => x && x.folder && String(x.name || "").toLowerCase().startsWith(pre));
  return m ? m.name : null;
}

// Sti for Graph: hver del URL-kodet, skråstrekene beholdt.
// ---------- Felles prosjektmappe (Storm Prosjekter 4.26) ----------
// BYGGEPLAN-Storm-IFC-felles-prosjektmappe-2026-11-10.md. Mappa finnes på ID
// (ProsjektmappeId), fordi den kan få nytt navn når et selskap kommer til.
// Undermappa for typen: i en FELLES mappe er «06 Endringer» delt per selskap
// («06 Endringer/SB»). Alt annet som før.
// 18.11: en mappe under en selskapsmappe er ALDRI felles – der er det rett i
// «06 Endringer» (og «01 Kontrakt»). Felles gjelder bare de gamle mappene.
export function mappeFor(type, felles, arbeidsomrade) {
  const m = typeInfo(type).mappe;
  if (felles && type === "em") {
    const ao = String(arbeidsomrade || "").trim().toUpperCase();
    return ao ? m + "/" + ao : m;
  }
  return m;
}
// Stien til en mappe (driveItem) relativt til roten av biblioteket:
// parentReference.path «/drives/x/root:/A/B» + name → «A/B/<name>».
export function stiFraItem(item) {
  if (!item || !item.name) return "";
  const p = String((item.parentReference && item.parentReference.path) || "");
  const i = p.indexOf("root:");
  let forelder = i >= 0 ? p.slice(i + 5) : "";
  try { forelder = decodeURIComponent(forelder); } catch (_) { /* allerede dekodet */ }
  forelder = forelder.replace(/^\/+|\/+$/g, "");
  return forelder ? forelder + "/" + item.name : item.name;
}
// Hovedprosjektene i jobben som deler samme felles mappe (samme ID) – til
// «(felles mappe for SE 20653, SB 292, SS 53)» i dialogen.
export function delerMappe(jobb, id) {
  if (!id) return [];
  return sorterProsjekter((jobb || []).filter(r => String(felt(r).ProsjektmappeId || "") === String(id)))
    .map(r => [felt(r).Arbeidsomrade, felt(r).ProsjektNr].filter(Boolean).join(" "));
}
// Kandidatene for jobbens felles mappe (steg 3): andre hovedprosjekter i samme
// jobb med ProsjektmappeId, i SE → SB → SS-rekkefølge.
export function jobbMappeKandidater(rader, p) {
  const jnr = String(felt(p).JobbNr || "");
  if (!jnr) return [];
  return sorterProsjekter((rader || []).filter(r => erHovedprosjekt(r) && r !== p &&
    String(felt(r).JobbNr || "") === jnr && felt(r).ProsjektmappeId));
}

export const graphSti = (...deler) => deler.join("/").split("/").filter(Boolean).map(encodeURIComponent).join("/");

export const stormProsjekterLenke = (nokkel) =>
  "https://wonderful-tree-047b03e03.5.azurestaticapps.net/#/p/" + encodeURIComponent(String(nokkel || "")) + "/dokumentasjon";

// Oversiktsfila: ny versjon (samme id) erstatter den gamle; maks 2000, de nyeste.
export function flettOversikt(gammel, ny) {
  const liste = (gammel && Array.isArray(gammel.dokumenter) ? gammel.dokumenter : []).filter(d => d && d.id !== ny.id);
  liste.push(ny);
  liste.sort((a, b) => String(a.lagt || "").localeCompare(String(b.lagt || "")));
  return { versjon: 1, dokumenter: liste.slice(-MAKS_OVERSIKT) };
}
export function oversiktPost(o) {
  return {
    id: String(o.id || ""), navn: String(o.navn || ""), type: TYPER[o.type] ? o.type : "annet",
    dato: /^\d{4}-\d{2}-\d{2}$/.test(o.dato || "") ? o.dato : isoDato(),
    lagt: o.lagt || new Date().toISOString(), av: String(o.av || ""), modell: String(o.modell || ""),
    mappe: String(o.mappe || ""), url: String(o.url || ""), storrelse: Number(o.storrelse) || 0,
    // 4.26: prosjektet som ble valgt (en felles mappe har flere selskaper)
    ...(o.prosjekt ? { prosjekt: String(o.prosjekt) } : {})
  };
}

// ---------- 🏢 Selskapsdeling (BYGGEPLAN fra Storm Prosjekter 25.11) ----------
// Ny kilde: lista Prosjekter og Prosjektdokumenter finnes i hvert selskaps
// gruppe. Radene merkes med selskapet (`_omr`, id «SB:123»), og det som er
// felles for jobben ligger i lista Jobber på /sites/StormProsjekter.
export const JOBBER_LISTE = "Jobber";
// Feltene Storm IFC leser fra Jobber. ByggeplassKode og AnsattKode hentes
// ALDRI – Storm IFC trenger dem ikke (kodene er Workerens sak).
export const JOBB_FELT = ["JobbNr", "Modell", "ByggeplassNr", "BemanningId", "BemanningNavn", "Kontakter", "Mannskap", "Adresse", "Lat", "Lon", "KoordAdresse"];
export const JOBB_FELT_LETT = ["JobbNr", "Modell"];
// Jobbens nummer, som jobbFor i Storm Prosjekter: JobbNr, ellers Nokkel
export const jobbNøkkel = (r) => { const f = felt(r); return String(f.JobbNr || f.Nokkel || "").trim(); };
const tom = (v) => v == null || (typeof v === "string" && !v.trim());
// Jobber legges OPPÅ hovedprosjektene (som Storm Prosjekter 4.66): felt med
// verdi i Jobber vinner, tomme felt røres ikke. Underprosjekter røres ikke.
export function leggPåJobber(rader, jobber) {
  const etter = new Map();
  for (const j of jobber || []) { const n = String(felt(j).JobbNr || "").trim(); if (n && !etter.has(n)) etter.set(n, felt(j)); }
  if (!etter.size) return rader || [];
  return (rader || []).map(r => {
    const f = felt(r);
    if (f.ForelderNokkel) return r;
    const j = etter.get(jobbNøkkel(r));
    if (!j) return r;
    const ny = Object.assign({}, f);
    for (const k of JOBB_FELT) if (k !== "JobbNr" && !tom(j[k])) ny[k] = j[k];
    return Object.assign({}, r, { fields: ny });
  });
}
// «SB:123» → { omr: "SB", id: "123" }. Uten selskap: null.
export function delId(id) {
  const m = /^(SE|SB|SS):(.+)$/.exec(String(id || ""));
  return m ? { omr: m[1], id: m[2] } : null;
}
// Merk en rad med selskapet den kom fra
export function medSelskap(rad, omr) {
  const f = Object.assign({}, (rad && rad.fields) || {});
  if (!f.Arbeidsomrade) f.Arbeidsomrade = omr;
  return Object.assign({}, rad, { id: omr + ":" + String((rad && rad.id) || ""), _omr: omr, fields: f });
}
// Hvilket selskaps bibliotek en sti hører til: første del av stien
// («Storm Betong/371 …» → SB). Ingen selskapsmappe → "" (lastes ALDRI opp).
export function selskapForSti(sti) {
  const d = førsteDel(sti);
  return Object.keys(SELSKAPSMAPPER).find(k => SELSKAPSMAPPER[k].toLowerCase() === d) || "";
}

// ---------- 📂 Flate prosjektmapper (BYGGEPLAN fra Storm Prosjekter 25.11) ----------
// I ny kilde flyttes prosjektmappene rett i selskapets bibliotek
// («Prosjektdokumenter/292 Vaskehall/…» i stedet for «…/Storm Betong/292 …»).
// Storm IFC regner fortsatt med stier MED selskapsmappa («Storm Betong/292 …»),
// så alt annet er som før. Oversettelsen skjer bare mot Graph:
//   ut: «Storm Betong/292 …» → «292 …»; bare «Storm Betong» → "" (rota)
//   inn: parentReference.path får selskapsmappa rett etter «root:»
// Gammelt oppsett (mappa «Storm Betong» finnes): ingen oversettelse.
export function utSti(sti, sm, flat) {
  const s = String(sti || "").replace(/^\/+/, "");
  if (!flat || !sm) return s;
  const deler = s.split("/");
  if (deler[0].toLowerCase() !== String(sm).toLowerCase()) return s;
  return deler.slice(1).join("/");
}
export function innItem(item, sm, flat) {
  if (!flat || !sm || !item || !item.parentReference || typeof item.parentReference.path !== "string") return item;
  const path = item.parentReference.path.replace(/^(.*?root:)(\/|$)/, (_, a, b) => a + "/" + sm + (b ? "/" : ""));
  return Object.assign({}, item, { parentReference: Object.assign({}, item.parentReference, { path: path.replace(/\/$/, "") }) });
}
// Biblioteket finnes på ADRESSEN («…/Prosjektdokumenter»), ikke visningsnavnet
// (det blir «Storm Betong prosjekter»).
export function erProsjektdokumenter(webUrl) {
  let u = String(webUrl || "");
  try { u = decodeURIComponent(u); } catch (_) {}
  return /\/prosjektdokumenter$/i.test(u.replace(/\/+$/, ""));
}
