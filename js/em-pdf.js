// 📄 BILDESIDENE I EM-PDF-EN (Emil 26.10.2026, prøve C)
//
// Etter skjemasidene kommer én LIGGENDE A4-side per endring (én per
// elementtype som er krysset av): før- og etter-bildet side ved side, en plan
// ovenfra med aksene som viser hvor i bygget endringen er, og lista over
// elementene. Bare elementene i endringen er med — resten er skjult.
//
// Tegnes synkront inn i skjema-PDF-ens dokument (skjema-pdf.js tegn(…, ekstra)),
// FØR sidetallene settes, så «Side 3 av 4» stemmer også på bildesidene.
// Bildene er hentet på forhånd (data-URL-er), derfor ingen await her.
import { t } from "./i18n.js";
import { malBunn, malTopp } from "./pdf-utseende.js";
import { elementMengde, planUtsnitt } from "./em-regn.js";
import { tilLatin1 } from "./skjema-pdf.js";

export const EM_SIDE = { b: 297, h: 210, marg: 15 };
const BILDE_B = 92, PLAN_B = 75, LUFT = 4;
const FARGE = { ny: "#3cb44b", endret: "#e9a13b", valgt: "#3b82f6", fjernet: "#d22b34", gammel: "#a8650f",
  kant: "#dcdfe4", akse: "#b8bec7", gra: "#6b7280", tekst: "#14161a" };
const rgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const HVA = { ny: "Ny", fjernet: "Fjernet", endret: "Endret", valgt: "Valgt" };

function ramme(d, x, y, b, h) {
  d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25);
  d.setFillColor(251, 251, 252); d.rect(x, y, b, h, "FD");
}
function etikett(d, tekst, x, y, farge) {
  d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(...rgb(farge));
  d.text(tilLatin1(tekst).toUpperCase(), x + 2.5, y + 4.5, { charSpace: 0.5 });
}

// Bildet inn i ruta uten å strekkes (midtstilt)
function bilde(d, data, x, y, b, h) {
  if (!data) return false;
  let ib = 920, ih = 1180;
  try { const p = d.getImageProperties ? d.getImageProperties(data) : null; if (p && p.width) { ib = p.width; ih = p.height; } } catch (_) {}
  const f = Math.min((b - 2) / ib, (h - 8) / ih);
  const w = ib * f, hh = ih * f;
  try { d.addImage(data, "JPEG", x + (b - w) / 2, y + 6 + (h - 8 - hh) / 2, w, hh); return true; } catch (_) { return false; }
}

function tomtBilde(d, x, y, b, h, tekst) {
  d.setFont(undefined, "normal"); d.setFontSize(7.5); d.setTextColor(...rgb(FARGE.gra));
  d.text(d.splitTextToSize(tilLatin1(tekst), b - 16), x + b / 2, y + h / 2, { align: "center" });
}

// Planen ovenfra: x mot høyre, z nedover. Aksene fra aksesystemet hvis det finnes.
function plan(d, x, y, b, h, endring, akser) {
  const u = planUtsnitt(endring.elementer);
  if (!u) return;
  const ix = x + 6, iy = y + 9, ib = b - 9, ih = h - 12;
  const s = Math.min(ib / (u.x1 - u.x0), ih / (u.z1 - u.z0));
  const ox = ix + (ib - (u.x1 - u.x0) * s) / 2, oy = iy + (ih - (u.z1 - u.z0) * s) / 2;
  const X = (v) => ox + (v - u.x0) * s, Z = (v) => oy + (v - u.z0) * s;
  if (akser) {
    d.setDrawColor(...rgb(FARGE.akse)); d.setLineWidth(0.2); d.setLineDashPattern([1.2, 1], 0);
    d.setFont(undefined, "normal"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
    for (const a of akser.x || []) if (a.c > u.x0 && a.c < u.x1) { d.line(X(a.c), oy, X(a.c), Z(u.z1)); d.text(tilLatin1(a.navn), X(a.c), oy - 1, { align: "center" }); }
    for (const a of akser.z || []) if (a.c > u.z0 && a.c < u.z1) { d.line(ox, Z(a.c), X(u.x1), Z(a.c)); d.text(tilLatin1(a.navn), ox - 1.2, Z(a.c) + 0.8, { align: "right" }); }
    d.setLineDashPattern([], 0);
  }
  const rute = (c, dd, farge, stiplet) => {
    if (!c || !dd) return;
    const w = Math.max(dd[0] * s, 0.9), hh = Math.max(dd[2] * s, 0.9);
    const rx = X(c[0]) - w / 2, ry = Z(c[2]) - hh / 2;
    d.setDrawColor(...rgb(farge)); d.setLineWidth(0.3);
    if (stiplet) { d.setLineDashPattern([0.8, 0.6], 0); d.rect(rx, ry, w, hh, "S"); d.setLineDashPattern([], 0); }
    else { d.setFillColor(...rgb(farge)); d.rect(rx, ry, w, hh, "FD"); }
  };
  for (const e of endring.elementer) {
    if (e.hva === "fjernet") rute(e.c, e.d, FARGE.fjernet, true);
    if (e.hva === "endret") rute(e.fc, e.fd, FARGE.gammel, true);
  }
  for (const e of endring.elementer) if (e.hva !== "fjernet") rute(e.c, e.d, FARGE[e.hva] || FARGE.ny, false);
}

function tabell(d, x, y, b, yMaks, endring) {
  const kol = [{ t: "Element", b: b * 0.42 }, { t: "Akse", b: b * 0.17 }, { t: "Hva", b: b * 0.17 }, { t: "Mengde", b: b * 0.24, h: true }];
  d.setFont(undefined, "bold"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
  let cx = x;
  for (const k of kol) { d.text(tilLatin1(t(k.t)).toUpperCase(), k.h ? cx + k.b : cx, y, k.h ? { align: "right" } : undefined); cx += k.b; }
  d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25); d.line(x, y + 1.2, x + b, y + 1.2);
  let ry = y + 4.6;
  const RAD = 3.6;
  const plass = Math.max(0, Math.floor((yMaks - ry) / RAD));
  const el = endring.elementer, flere = endring.antall > el.length ? endring.antall - el.length : 0;
  const vis = (el.length + flere > plass) ? el.slice(0, Math.max(0, plass - 1)) : el;
  d.setFontSize(6);
  for (const e of vis) {
    cx = x;
    const navn = d.splitTextToSize(tilLatin1(e.navn || e.guid || "—"), kol[0].b - 1.5)[0] || "";
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(navn, cx, ry); cx += kol[0].b;
    d.text(tilLatin1(e.akse || "—"), cx, ry); cx += kol[1].b;
    d.setFont(undefined, "bold"); d.setTextColor(...rgb(FARGE[e.hva === "endret" ? "gammel" : e.hva] || FARGE.tekst));
    d.text(tilLatin1(t(HVA[e.hva] || e.hva)), cx, ry); cx += kol[2].b;
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(tilLatin1(elementMengde(e, endring.enhet)), cx + kol[3].b, ry, { align: "right" });
    ry += RAD;
  }
  const rest = el.length - vis.length + flere;
  if (rest > 0) {
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.gra));
    d.text(tilLatin1(t("+ {0} til — se mengdelista (Excel)", rest)), x, ry);
  }
}

function forklaring(d, x, y, utvalg) {
  d.setFont(undefined, "normal"); d.setFontSize(6.5); d.setTextColor(...rgb(FARGE.gra));
  const deler = utvalg ? [["valgt", false, "Valgt"]]
    : [["ny", false, "Ny"], ["endret", false, "Endret"], ["fjernet", true, "Fjernet (omriss)"], ["gammel", true, "Endret – slik det var"]];
  let cx = x;
  for (const [f, stiplet, tekst] of deler) {
    d.setDrawColor(...rgb(FARGE[f])); d.setLineWidth(0.3);
    if (stiplet) { d.setLineDashPattern([0.8, 0.6], 0); d.rect(cx, y - 2.4, 4, 2.8, "S"); d.setLineDashPattern([], 0); }
    else { d.setFillColor(...rgb(FARGE[f])); d.rect(cx, y - 2.4, 4, 2.8, "F"); }
    const tx = tilLatin1(t(tekst));
    d.text(tx, cx + 5.5, y);
    cx += 5.5 + d.getTextWidth(tx) + 6;
  }
}

// em: vasket EM-post (em-regn.js vaskEm). bilder: [{ for, etter }] per endring
// (data-URL-er). o: { logo, avsender }
export function tegnEmSider(d, em, bilder, o) {
  const opt = o || {}, R = EM_SIDE, n = em.endringer.length;
  const bredde = R.b - 2 * R.marg;
  em.endringer.forEach((endring, i) => {
    d.addPage("a4", "landscape");
    const b = (bilder && bilder[i]) || {};
    const y0 = malTopp(d, {
      x: R.marg, y: R.marg, bredde, logo: opt.logo, logoB: 40, logoH: 12,
      meta: [
        opt.avsender ? { tekst: tilLatin1(opt.avsender), fet: true } : null,
        { tekst: tilLatin1((em.nr ? em.nr + " · " : "") + em.tittel) },
        em.til ? { tekst: tilLatin1(em.fra ? t("Modell: {0} mot {1}", em.til, em.fra) : t("Modell: {0}", em.til)) } : null
      ],
      kicker: t("Endring {0} av {1}", i + 1, n),
      tittel: tilLatin1(endring.navn + (endring.undertekst ? " (" + endring.undertekst + ")" : "")),
      tittelStr: 14,
      under: tilLatin1(endring.oppsummering)
    });
    const yStrek = R.h - R.marg - 4, yBunn = yStrek - 10;
    const hBilde = yBunn - y0;
    const x1 = R.marg, x2 = x1 + BILDE_B + LUFT, x3 = x2 + BILDE_B + LUFT, planB = R.b - R.marg - x3;

    ramme(d, x1, y0, BILDE_B, hBilde);
    etikett(d, t("Før"), x1, y0, FARGE.fjernet);
    if (!bilde(d, b.for, x1, y0, BILDE_B, hBilde))
      tomtBilde(d, x1, y0, BILDE_B, hBilde, em.utvalg ? t("Ingen før-bilde: elementene er valgt i modellen, ikke sammenlignet med en tidligere revisjon.")
        : t("Ingenting er fjernet eller flyttet i denne endringen."));
    ramme(d, x2, y0, BILDE_B, hBilde);
    etikett(d, t("Etter"), x2, y0, "#1f7a33");
    if (!bilde(d, b.etter, x2, y0, BILDE_B, hBilde)) tomtBilde(d, x2, y0, BILDE_B, hBilde, t("Ingen nye eller endrede elementer."));

    const planH = Math.min(62, hBilde * 0.5);
    ramme(d, x3, y0, planB, planH);
    etikett(d, t("Plan ovenfra"), x3, y0, FARGE.gra);
    plan(d, x3, y0, planB, planH, endring, em.akser);
    tabell(d, x3, y0 + planH + 5, planB, yBunn, endring);

    forklaring(d, x1, yBunn + 5, em.utvalg);
    malBunn(d, { x: R.marg, bredde, yStrek, logo: opt.logo, str: 7,
      tekstIstedet: opt.avsender ? tilLatin1(opt.avsender) : "",
      hale: t("Bildene er tatt fra 3D-modellen. Bare elementene i denne endringen vises, resten er skjult.") });
  });
}
