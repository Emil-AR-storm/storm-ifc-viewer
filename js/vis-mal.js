// 🎯 «VIS I MODELLEN» fra Storm Prosjekter (runde G, 12.11.2026)
//
// BYGGEPLAN-Storm-IFC-avvik-sammenligning-2026-11-12.md, punkt 1. Når
// modellen er åpnet fra en adresse med &markering=, &kollisjon= eller
// &element= (innebygd-regn.js lesMål), flyr kameraet dit:
//   markering → finn den på id, fly til x,y,z, åpne bobla, marker elementet
//   kollisjon → ikke kjør kontrollen: les funnet i kollisjonsfila, fly til
//               x,y,z og marker element A og B
//   element   → velg elementet på GlobalId og zoom inn
// Finnes ikke målet, får brukeren beskjed, og modellen vises som vanlig.
import * as THREE from "three";
import { S } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";

const vent = (ms) => new Promise(r => setTimeout(r, ms));

// GlobalId → ExpressID i modellen som er åpen (samme kilder som bcf-import.js).
export async function guidTilId() {
  const kart = new Map();
  if (S.glbProps && S.glbProps.size) {
    for (const [id, p] of S.glbProps) if (p && p[4]) kart.set(String(p[4]), id);
    return kart;
  }
  try {
    const { sikreMeta } = await import("./ifcrpc.js");
    const { alleElementIder } = await import("./ifc.js");
    await sikreMeta(alleElementIder);
  } catch (_) { /* uten meta: ingen treff */ }
  for (const [id, m] of (S.meta || new Map())) if (m && m.globalId) kart.set(String(m.globalId), id);
  return kart;
}

// Markeringene leses fra SharePoint i bakgrunnen etter at modellen er åpnet.
// Vent til de er lest for denne fila (eller til den er funnet), høyst 20 s.
async function ventPåMarkering(id) {
  const finn = () => (S.comments || []).find(c => String(c.id) === String(id));
  const start = Date.now(), fil = S.fileName;
  while (Date.now() - start < 20000) {
    const c = finn();
    if (c) return c;
    if (S.markeringerLest && S.markeringerLest.fil === fil && S.markeringerLest.tid >= start - 60000) return finn();
    await vent(250);
  }
  return finn();
}

async function markerElementer(gider) {
  const E = await import("./elements.js");
  const kart = await guidTilId();
  const ider = gider.filter(Boolean).map(g => kart.get(g)).filter(x => x != null);
  ider.forEach((id, i) => E.selectElement(id, i > 0));
  return ider;
}

async function tilMarkering(mål) {
  const c = await ventPåMarkering(mål.markering);
  if (!c) {
    varsel(mål.modellfil && mål.modellfil !== S.fileName
      ? t("Fant ikke markeringen – den ligger på {0}, og den modellen er ikke åpen.", mål.modellfil)
      : t("Fant ikke markeringen – den kan være slettet."));
    return false;
  }
  const M = await import("./markers.js");
  M.goToComment(c);
  if (c.globalId) await markerElementer([c.globalId]).catch(() => []);
  M.openMarkerPopup(c);
  return true;
}

async function lesKollisjoner() {
  const { spLes } = await import("./sp-lager.js");
  const { KOLL_MAPPE } = await import("./kollisjon.js");
  const navn = (f) => String(f || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-") + ".kollisjoner.json";
  const filer = [...new Set([S.fileName, S.kildeIfc && S.kildeIfc.ifc].filter(Boolean).map(navn))];
  for (const f of filer) {
    try { const r = await spLes(KOLL_MAPPE, f); if (r.status === "ok" && r.liste.length) return r.liste; } catch (_) { /* neste */ }
  }
  return [];
}

async function tilKollisjon(mål) {
  const liste = await lesKollisjoner();
  const f = liste.find(p => p && String(p.id) === mål.kollisjon);
  const gidA = (f && f.gidA) || mål.element || "", gidB = (f && f.gidB) || "";
  if (f && isFinite(Number(f.x)) && isFinite(Number(f.y)) && isFinite(Number(f.z)) && (f.x || f.y || f.z)) {
    const { flyTil } = await import("./scene.js");
    flyTil(new THREE.Vector3(Number(f.x), Number(f.y), Number(f.z)), 2.5 / (S.enhetSkala || 1));
    await markerElementer([gidA, gidB]).catch(() => []);
    return true;
  }
  // Gammelt funn uten posisjon: elementet alene, hvis vi har det
  if (gidA && await tilElement(gidA, true)) return true;
  varsel(t("Fant ikke kollisjonen – kjør kollisjonskontrollen på nytt i Storm IFC."));
  return false;
}

async function tilElement(gid, stille) {
  const kart = await guidTilId();
  const id = kart.get(gid);
  if (id == null) { if (!stille) varsel(t("Fant ikke elementet i denne modellen – det kan være fjernet.")); return false; }
  const E = await import("./elements.js");
  return E.visElementUtenPanel(id);
}

// Kjøres når modellen er åpnet. Svar: true = målet ble funnet.
export async function gåTilMål(mål) {
  if (!mål || !S.modelGroup) return false;
  try {
    if (mål.markering) return await tilMarkering(mål);
    if (mål.kollisjon) return await tilKollisjon(mål);
    if (mål.element) return await tilElement(mål.element);
  } catch (err) {
    console.warn("Vis i modellen:", err && err.message);
  }
  return false;
}
