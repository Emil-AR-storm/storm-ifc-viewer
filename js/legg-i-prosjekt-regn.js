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

// Forslaget i nedtrekkslista: selskapet typen hører til, ellers det første.
export function foreslåProsjekt(jobb, type) {
  if (!jobb || !jobb.length) return null;
  const ønsket = typeInfo(type).selskap;
  return jobb.find(r => String(felt(r).Arbeidsomrade || "").toUpperCase() === ønsket) || jobb[0];
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
