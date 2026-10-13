// 🏷 LOGOEN I EXCEL-ARKENE (Emil 13.10)
//
// «går det an og legge inn samme logo funksjon som vi bruker på pdf-ene og få
// det inn i excel-arkene i storm-IFC også? ikke glem og koble opp alt opp til
// "Logo på PDF-er og rigg-objekter"».
//
// Én kilde: logoen valgt i Innstillinger → Prosjektinfo («Logo på PDF-er,
// Excel-ark og rigg-objekter», S.standardLogoFil i prosjektinfo.js). Er en
// logofil valgt, hentes ORIGINALBILDET fra SharePoint-mappa Logoer — samme
// vei som PDF-ene (hentLogoer/hentLogo i tegninger.js). Står valget på
// «Innebygd Storm-logo», brukes Storm-merket som SW-tegningen tegner.
//
// Excel viser bare PNG og JPEG. Andre formater (WEBP, SVG) tegnes om til PNG
// i nettleseren, og store bilder skaleres ned så fila holder seg liten.
// Går noe galt (ikke innlogget, ingen nett, ingen canvas) blir arket laget
// UTEN logo — en manglende logo skal aldri stoppe en nedlasting.
import { S } from "./state.js";
import { dataUrlTilBytes } from "./bcf.js";

const MAKS_PX = 640;   // høyeste side i bildet som legges i fila

export function valgtLogoFil() {
  if (S.standardLogoFil) return S.standardLogoFil() || "";
  return (S.settings && S.settings.rapLogo) || "";
}

// data-URL → { bytes, ext, b, h } som xlsx.js forstår, eller null
export function fraDataUrl(data, b, h) {
  const m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(String(data || ""));
  if (!m) return null;
  const type = m[1].toLowerCase();
  const ext = type === "png" ? "png" : (type === "jpeg" || type === "jpg") ? "jpeg" : "";
  if (!ext) return null;
  const bytes = dataUrlTilBytes(data);
  return bytes ? { bytes, ext, b: b || 1000, h: h || 260 } : null;
}

// Tegner om til PNG når formatet ikke er PNG/JPEG, eller bildet er stort
async function somPng(logo) {
  const img = await new Promise((ok, nei) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = nei;
    i.src = logo.data;
  });
  const b0 = img.naturalWidth || logo.b || 1000, h0 = img.naturalHeight || logo.h || 260;
  const f = Math.min(1, MAKS_PX / Math.max(b0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b0 * f)); c.height = Math.max(1, Math.round(h0 * f));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return fraDataUrl(c.toDataURL("image/png"), b0, h0);
}

async function hentValgt(fil) {
  const { hentLogoer, hentLogo } = await import("./tegninger.js");
  const liste = await hentLogoer();
  const l = (liste || []).find(x => x.fil === fil);
  return l ? await hentLogo(l.itemId) : null;
}

// Aldri vent lenger enn dette på logoen — da lastes arket ned uten.
export const LOGO_VENT_MS = 8000;
export function excelLogo() {
  return Promise.race([hentExcelLogo(),
    new Promise(ok => setTimeout(() => ok(null), LOGO_VENT_MS))]);
}
async function hentExcelLogo() {
  try {
    const fil = valgtLogoFil();
    let bilde = null;
    if (fil) { try { bilde = await hentValgt(fil); } catch (_) { bilde = null; } }
    if (!bilde) {
      // «Innebygd Storm-logo» — eller filen kunne ikke hentes (ikke innlogget)
      const { logoBilde } = await import("./sw-tegning.js");
      bilde = await logoBilde();
    }
    if (!bilde || !bilde.data) return null;
    const rett = fraDataUrl(bilde.data, bilde.b, bilde.h);
    if (rett && Math.max(bilde.b || 0, bilde.h || 0) <= MAKS_PX * 2) return rett;
    return await somPng(bilde);
  } catch (err) {
    console.warn("Excel-logo:", err && err.message);
    return null;
  }
}
