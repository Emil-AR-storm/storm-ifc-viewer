// 🏢 SELSKAPSDELING – BRYTEREN (BYGGEPLAN fra Storm Prosjekter 25.11)
//
// Hvor ligger prosjektlista og prosjektmappene?
//   «gammel»: lista Prosjekter og Prosjektdokumenter på /sites/StormProsjekter
//             (som før). Ingen kall mot selskapsgruppene.
//   «ny»:     én liste og ett bibliotek per selskap (/sites/StormEntreprenor,
//             StormBetong, StormStal). Brukeren ser bare selskapene hen er med i.
//             Felles per jobb ligger i lista Jobber på /sites/StormProsjekter.
//
// Standard er SELSKAPSDELING.aktiv i config.js. ?kilde=ny | gammel | standard på
// adressen overstyrer og huskes (localStorage «storm-ifc-kilde») – samme
// oppførsel i alle tre appene, så Emil kan teste før omleggingen.
// Modellbiblioteket (IFC-modeller, lette kopier, markeringer osv.) er felles og
// påvirkes IKKE av denne bryteren.
import { SELSKAPSDELING } from "./config.js";

export const KILDE_NOKKEL = "storm-ifc-kilde";
const GYLDIG = ["ny", "gammel"];
let testKilde = null;

function lesLagret() {
  try { const v = localStorage.getItem(KILDE_NOKKEL); return GYLDIG.includes(v) ? v : ""; } catch (_) { return ""; }
}

// ?kilde=… på adressen → husk det (standard = glem overstyringen)
export function lesAdresse(search) {
  let v = "";
  try { v = String(new URLSearchParams(search || "").get("kilde") || "").trim().toLowerCase(); } catch (_) { v = ""; }
  if (!v) return "";
  try {
    if (GYLDIG.includes(v)) localStorage.setItem(KILDE_NOKKEL, v);
    else if (v === "standard") localStorage.removeItem(KILDE_NOKKEL);
  } catch (_) { /* uten lagring: gjelder bare så lenge adressen har ?kilde= */ }
  return v;
}

export function kilde() {
  if (testKilde) return testKilde;
  let fraAdresse = "";
  try { fraAdresse = typeof location !== "undefined" ? String(new URLSearchParams(location.search).get("kilde") || "").toLowerCase() : ""; } catch (_) {}
  if (GYLDIG.includes(fraAdresse)) return fraAdresse;
  if (fraAdresse === "standard") return SELSKAPSDELING.aktiv ? "ny" : "gammel";
  return lesLagret() || (SELSKAPSDELING.aktiv ? "ny" : "gammel");
}
export const nyKilde = () => kilde() === "ny";

// Til testene: tving kilden (null = vanlig regel)
export function _settKilde(v) { testKilde = v; }

if (typeof location !== "undefined") lesAdresse(location.search);
