// 📄 BILDESIDENE I EM-PDF-EN (Emil 26.10.2026, prøve C)
//
// Etter skjemasidene kommer én LIGGENDE A4-side per endring (én per
// elementtype som er krysset av): før- og etter-bildet side ved side, en plan
// ovenfra med aksene som viser hvor i bygget endringen er, og lista over
// elementene. Bare elementene i endringen er med — resten er skjult.
//
// 🔍 26.10 (Emil, prøve B): etter hver oversiktsside kommer DETALJSIDER for
// de endrede elementene i den endringen — ett kort per element (tre per side)
// med en målsatt tegning (rød stiplet = før, oransje = etter, blå piler med mm
// og grader) og endringen i klartekst. Rekkefølgen blir: skjemaet → oversikt 1
// → detaljer 1 → oversikt 2 → detaljer 2 …
//
// Tegnes synkront inn i skjema-PDF-ens dokument (skjema-pdf.js tegn(…, ekstra)),
// FØR sidetallene settes, så «Side 3 av 4» stemmer også på bildesidene.
// Bildene er hentet på forhånd (data-URL-er), derfor ingen await her.
import { t } from "./i18n.js";
import { malBunn, malTopp } from "./pdf-utseende.js";
import { elementMengde, kortGuid, planUtsnitt, tallTekst, typeNavn } from "./em-regn.js";
import { detaljerFor, dimensjonAv } from "./em-detalj.js";
import { tilLatin1 } from "./skjema-pdf.js";

export const EM_SIDE = { b: 297, h: 210, marg: 15 };
const BILDE_B = 92, PLAN_B = 75, LUFT = 4;
const FARGE = { ny: "#3cb44b", endret: "#e9a13b", valgt: "#3b82f6", fjernet: "#d22b34", gammel: "#a8650f",
  kant: "#dcdfe4", akse: "#b8bec7", gra: "#6b7280", tekst: "#14161a", bla: "#1d4ed8" };
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

// 📏 Per profil (Emil 26.10): «KG per type/dimensjon i løpemeter» — regningen
// står over elementlista, så kontraktsparten ser lengde × kg/m for hver profil.
function profilBlokk(d, x, y, b, endring) {
  const prof = (endring.profiler || []).filter(p => p && (p.ny || p.slettet || p.endret || p.lm));
  if (!prof.length || !["kg", "lm"].includes(endring.enhet)) return y;
  const kg = endring.enhet === "kg";
  const kol = [{ t: "Profil", b: b * 0.40 }, { t: "Lengde", b: b * 0.2, h: true }, { t: kg ? "kg/m" : "", b: b * 0.17, h: true }, { t: "Mengde", b: b * 0.23, h: true }];
  d.setFont(undefined, "bold"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
  let cx = x;
  for (const k of kol) { if (k.t) d.text(tilLatin1(t(k.t)).toUpperCase(), k.h ? cx + k.b : cx, y, k.h ? { align: "right" } : undefined); cx += k.b; }
  d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25); d.line(x, y + 1.2, x + b, y + 1.2);
  let ry = y + 4.6;
  const vis = prof.slice(0, 8);
  d.setFontSize(6);
  for (const p of vis) {
    cx = x;
    d.setFont(undefined, "bold"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(kutt(d, tilLatin1(p.navn), kol[0].b - 1.5), cx, ry); cx += kol[0].b;
    d.setFont(undefined, "normal");
    d.text(tilLatin1((p.lm > 0 ? "+" : "") + tallTekst(p.lm, 2) + " lm"), cx + kol[1].b, ry, { align: "right" }); cx += kol[1].b;
    if (kg) {
      d.setTextColor(...rgb(p.kilde === "modell" ? FARGE.gra : FARGE.tekst));
      d.text(tilLatin1(p.kgPerM == null ? "—" : "x " + tallTekst(p.kgPerM, 1) + (p.kilde === "modell" ? "*" : "")), cx + kol[2].b, ry, { align: "right" });
      d.setTextColor(...rgb(FARGE.tekst));
    }
    cx += kol[2].b;
    d.text(tilLatin1((p.mengde > 0 ? "+" : "") + tallTekst(p.mengde, kg ? 0 : 2) + " " + endring.enhet), cx + kol[3].b, ry, { align: "right" });
    ry += 3.6;
  }
  d.setTextColor(...rgb(FARGE.gra));
  if (prof.length > vis.length) { d.text(tilLatin1(t("+ {0} til — se mengdelista (Excel)", prof.length - vis.length)), x, ry); ry += 3.6; }
  if (kg && vis.some(p => p.kilde === "modell")) { d.setFontSize(5); d.text(tilLatin1(t("* kg/m anslått fra modellen (volum × 7 850 / lengde)")), x, ry); ry += 3.2; }
  return ry + 2.5;
}

function tabell(d, x, y0, b, yMaks, endring) {
  const y = profilBlokk(d, x, y0, b, endring);
  const kol = [{ t: "Element", b: b * 0.48 }, { t: "Akse", b: b * 0.13 }, { t: "Hva", b: b * 0.19 }, { t: "Mengde", b: b * 0.2, h: true }];
  const nrAv = endretNummer(endring);
  d.setFont(undefined, "bold"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
  let cx = x;
  for (const k of kol) { d.text(tilLatin1(t(k.t)).toUpperCase(), k.h ? cx + k.b : cx, y, k.h ? { align: "right" } : undefined); cx += k.b; }
  d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25); d.line(x, y + 1.2, x + b, y + 1.2);
  let ry = y + 4.6;
  const RAD = 3.6;
  // 🔗 Plass til «samme element, ny ID» under lista (prøve A, Emil 26.10)
  const nyId = endring.nyId || [];
  const nyRader = nyId.length ? Math.min(nyId.length, 8) + 2 : 0;
  const plass = Math.max(3, Math.floor((yMaks - ry) / RAD) - nyRader);
  // De endrede først: de har nummer og egne detaljsider, og skal ikke forsvinne i «+ n til»
  const el = endring.elementer.filter(e => e.hva === "endret").concat(endring.elementer.filter(e => e.hva !== "endret"));
  const flere = endring.antall > el.length ? endring.antall - el.length : 0;
  const vis = (el.length + flere > plass) ? el.slice(0, Math.max(0, plass - 1)) : el;
  d.setFontSize(6);
  for (const e of vis) {
    cx = x;
    const navn = kutt(d, tilLatin1(e.navn || e.guid || "—"), kol[0].b - 1.5);
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(navn, cx, ry); cx += kol[0].b;
    d.text(tilLatin1(e.akse || "—"), cx, ry); cx += kol[1].b;
    d.setFont(undefined, "bold"); d.setTextColor(...rgb(FARGE[e.hva === "endret" ? "gammel" : e.hva] || FARGE.tekst));
    d.text(tilLatin1(t(HVA[e.hva] || e.hva) + (nrAv.has(e) ? " " + nrAv.get(e) : "")), cx, ry); cx += kol[2].b;
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(tilLatin1(elementMengde(e, endring.enhet)), cx + kol[3].b, ry, { align: "right" });
    ry += RAD;
  }
  const rest = el.length - vis.length + flere;
  if (rest > 0) {
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.gra));
    d.text(tilLatin1(t("+ {0} til — se mengdelista (Excel)", rest)), x, ry);
    ry += RAD;
  }
  if (!nyId.length) return;
  ry += 1.5;
  d.setFont(undefined, "bold"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
  d.text(tilLatin1(t("Samme element, ny ID — ikke priset")).toUpperCase(), x, ry);
  d.setDrawColor(...rgb(FARGE.kant)); d.line(x, ry + 1.2, x + b, ry + 1.2);
  ry += 4.6;
  const nyPlass = Math.max(1, Math.floor((yMaks - ry) / RAD));
  const nyVis = nyId.length > nyPlass ? nyId.slice(0, nyPlass - 1) : nyId;
  d.setFontSize(6);
  for (const e of nyVis) {
    d.setFont(undefined, "normal"); d.setTextColor(...rgb(FARGE.tekst));
    d.text(kutt(d, tilLatin1(e.navn || e.gt || "—"), kol[0].b - 1.5), x, ry);
    d.text(tilLatin1(e.akse || "—"), x + kol[0].b, ry);
    d.setTextColor(...rgb(FARGE.gra));
    d.text(tilLatin1(e.grunn === "revit" ? t("Revit-nr.") : t("samme sted")), x + kol[0].b + kol[1].b, ry);
    ry += RAD;
  }
  if (nyVis.length < nyId.length) {
    d.setTextColor(...rgb(FARGE.gra));
    d.text(tilLatin1(t("+ {0} til — se mengdelista (Excel)", nyId.length - nyVis.length)), x, ry);
  }
}

// 🔗 Typer der ALT er «samme element, ny ID» har ingen egen endringsside —
// de står her, så kontrollen er synlig også for dem.
function tegnNyIdSide(d, em, opt) {
  const liste = em.nyIdAndre || [];
  if (!liste.length) return;
  const R = EM_SIDE, bredde = R.b - 2 * R.marg, RAD = 4.2;
  let i = 0;
  while (i < liste.length) {
    d.addPage("a4", "landscape");
    const y0 = malTopp(d, { x: R.marg, y: R.marg, bredde, logo: opt.logo, logoB: 40, logoH: 12,
      meta: [opt.avsender ? { tekst: tilLatin1(opt.avsender), fet: true } : null, { tekst: tilLatin1((em.nr ? em.nr + " · " : "") + em.tittel) }],
      kicker: t("Vedlegg · kontroll av sammenligningen"), tittel: tilLatin1(t("Samme element med ny ID")), tittelStr: 14,
      under: tilLatin1(t("Elementene fikk ny GlobalId i modellen, men er samme element på samme sted. De er ikke priset.")) });
    const kol = [["Type", 0.14], ["Element", 0.34], ["Akse", 0.1], ["GlobalId før → etter", 0.3], ["Funnet igjen på", 0.12]];
    let y = y0 + 2, cx = R.marg;
    d.setFont(undefined, "bold"); d.setFontSize(6); d.setTextColor(...rgb(FARGE.gra));
    for (const [n, f] of kol) { d.text(tilLatin1(t(n)).toUpperCase(), cx, y); cx += bredde * f; }
    d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25); d.line(R.marg, y + 1.3, R.marg + bredde, y + 1.3);
    y += 5;
    const yMaks = R.h - R.marg - 12;
    d.setFont(undefined, "normal"); d.setFontSize(7); d.setTextColor(...rgb(FARGE.tekst));
    while (i < liste.length && y < yMaks) {
      const e = liste[i++]; cx = R.marg;
      const celler = [t(typeNavn(e.type)), e.navn, e.akse || "—", (e.gf || "—") + " → " + (e.gt || "—"),
        e.grunn === "revit" ? t("Revit-nr. {0}", e.nr) : t("samme sted")];
      celler.forEach((c, k) => { d.text(kutt(d, tilLatin1(c), bredde * kol[k][1] - 2), cx, y); cx += bredde * kol[k][1]; });
      y += RAD;
    }
    malBunn(d, { x: R.marg, bredde, yStrek: R.h - R.marg - 4, logo: opt.logo, str: 7,
      tekstIstedet: opt.avsender ? tilLatin1(opt.avsender) : "",
      hale: t("Paret på Revit-nummer eller samme plassering (±5 mm) og samme mål (±1 mm).") });
  }
}

// Tekst som ikke får plass kuttes på tegn, med «…» — ikke på ord. «CFSHS (EN»
// i Emils første ekte PDF var ordbrytingen som kastet resten av navnet.
function kutt(d, tekst, bredde) {
  let s = String(tekst || "");
  if (d.getTextWidth(s) <= bredde) return s;
  while (s.length > 1 && d.getTextWidth(s + "…") > bredde) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
// De endrede elementene nummereres 1, 2, 3 … — samme nummer i tabellen og på detaljkortet
function endretNummer(endring) {
  const m = new Map(); let n = 0;
  for (const e of endring.elementer) if (e.hva === "endret") m.set(e, ++n);
  return m;
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

// ═══════════════ 🔍 DETALJSIDENE ═══════════════
function pilHode(d, x1, y1, x2, y2, farge) {
  const a = Math.atan2(y2 - y1, x2 - x1), l = 1.8, b = 0.75;
  d.setFillColor(...rgb(farge || FARGE.bla));
  d.triangle(x2, y2, x2 - l * Math.cos(a) + b * Math.sin(a), y2 - l * Math.sin(a) - b * Math.cos(a),
    x2 - l * Math.cos(a) - b * Math.sin(a), y2 - l * Math.sin(a) + b * Math.cos(a), "F");
}
function pil(d, x1, y1, x2, y2, farge) {
  d.setDrawColor(...rgb(farge || FARGE.bla)); d.setLineWidth(0.45);
  d.line(x1, y1, x2, y2); pilHode(d, x1, y1, x2, y2, farge);
}
function blaTekst(d, tekst, x, y, op) {
  d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(...rgb(FARGE.bla));
  d.text(tilLatin1(tekst), x, y, op);
}
function polygon(d, pkt, farge, stiplet) {
  d.setDrawColor(...rgb(stiplet ? FARGE.fjernet : FARGE.gammel)); d.setLineWidth(stiplet ? 0.35 : 0.3);
  if (stiplet) d.setLineDashPattern([1, 0.7], 0);
  else d.setFillColor(...rgb(farge));
  const rel = []; for (let i = 1; i < pkt.length; i++) rel.push([pkt[i][0] - pkt[i - 1][0], pkt[i][1] - pkt[i - 1][1]]);
  d.lines(rel, pkt[0][0], pkt[0][1], [1, 1], stiplet ? "S" : "FD", true);
  if (stiplet) d.setLineDashPattern([], 0);
}

// Formen til elementet i tegningens plan (u, v). Plan: u = x, v = z.
// Oppriss: u langs elementets retning i plan (eller x), v = −y (opp er opp).
function form(c, dd, r, L, visning, h) {
  if (!c || !dd) return null;
  const proj = visning === "plan" ? (p) => [p[0], p[2]] : (p) => [p[0] * h[0] + p[2] * h[1], -p[1]];
  const cu = proj(c);
  let ret = null, len = 0, bredde = 0;
  if (r && L > 0) {
    const ru = visning === "plan" ? [r[0], r[2]] : [r[0] * h[0] + r[2] * h[1], -r[1]];
    const lu = Math.hypot(ru[0], ru[1]);
    if (lu > 0.3) {
      ret = [ru[0] / lu, ru[1] / lu]; len = L * lu;
      const snitt = dd.slice().sort((a, b) => a - b);
      bredde = Math.min(Math.max(snitt[0], len / 60), len / 4);
    }
  }
  if (!ret) {   // langs aksene: den ytre boksen
    const w = visning === "plan" ? dd[0] : Math.abs(dd[0] * h[0]) + Math.abs(dd[2] * h[1]);
    const hh = visning === "plan" ? dd[2] : dd[1];
    return { c: cu, pkt: [[cu[0] - w / 2, cu[1] - hh / 2], [cu[0] + w / 2, cu[1] - hh / 2], [cu[0] + w / 2, cu[1] + hh / 2], [cu[0] - w / 2, cu[1] + hh / 2]], ret: w >= hh ? [1, 0] : [0, 1], len: Math.max(w, hh) };
  }
  const n = [-ret[1], ret[0]], a = len / 2, b = bredde / 2;
  const P = (sa, sb) => [cu[0] + ret[0] * a * sa + n[0] * b * sb, cu[1] + ret[1] * a * sa + n[1] * b * sb];
  return { c: cu, pkt: [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], ret, len };
}

function tegnElement(d, x, y, b, h, e, det, akser) {
  const T = det.tegning;
  const helning = det.punkter.some(p => p.k === "helning");
  const plan = !!(T.flytt || T.vinkel || (T.dL && !det.vertikal)) || !(T.hoyde || (T.dL && det.vertikal) || helning);
  const visning = plan ? "plan" : "oppriss";
  // Retningen i plan til opprisset: elementets egen, ellers x
  let hd = [1, 0];
  if (!plan && e.r && Math.hypot(e.r[0], e.r[2]) > 0.3) { const l = Math.hypot(e.r[0], e.r[2]); hd = [e.r[0] / l, e.r[2] / l]; }
  const fF = form(e.fc, e.fd, e.fr, e.fL, visning, hd), fN = form(e.c, e.d, e.r, e.L, visning, hd);
  if (!fF || !fN) return;
  d.setFont(undefined, "bold"); d.setFontSize(6); d.setTextColor(...rgb(FARGE.gra));
  d.text(tilLatin1(plan ? t("PLAN OVENFRA") : t("OPPRISS (SETT FRA SIDEN)")), x + 2.5, y + 4);

  // Utsnitt og målestokk
  const alle = fF.pkt.concat(fN.pkt);
  let u0 = Math.min(...alle.map(p => p[0])), u1 = Math.max(...alle.map(p => p[0]));
  let v0 = Math.min(...alle.map(p => p[1])), v1 = Math.max(...alle.map(p => p[1]));
  const st = Math.max(u1 - u0, v1 - v0) || 1;
  u0 -= st * 0.3; u1 += st * 0.3; v0 -= st * 0.3; v1 += st * 0.3;
  const ix = x + 8, iy = y + 9, ib = b - 16, ih = h - 15;
  const s = Math.min(ib / (u1 - u0), ih / (v1 - v0));
  const ox = ix + (ib - (u1 - u0) * s) / 2, oy = iy + (ih - (v1 - v0) * s) / 2;
  const X = (u) => ox + (u - u0) * s, Y = (v) => oy + (v - v0) * s;
  const papir = (pkt) => pkt.map(p => [X(p[0]), Y(p[1])]);

  // Aksene i planen
  if (plan && akser) {
    d.setDrawColor(...rgb(FARGE.akse)); d.setLineWidth(0.2); d.setLineDashPattern([1.2, 1], 0);
    d.setFont(undefined, "normal"); d.setFontSize(6); d.setTextColor(...rgb(FARGE.gra));
    for (const a of akser.x || []) if (a.c > u0 && a.c < u1) { d.line(X(a.c), iy, X(a.c), iy + ih); d.text(tilLatin1(a.navn), X(a.c), iy - 0.6, { align: "center" }); }
    for (const a of akser.z || []) if (a.c > v0 && a.c < v1) { d.line(ix, Y(a.c), ix + ib, Y(a.c)); d.text(tilLatin1(a.navn), ix - 1.2, Y(a.c) + 0.8, { align: "right" }); }
    d.setLineDashPattern([], 0);
  }
  polygon(d, papir(fF.pkt), null, true);
  polygon(d, papir(fN.pkt), FARGE.endret, false);

  let forstorret = false;
  const minst = 6;   // mm på papiret — små flyttinger tegnes større
  // Flytting: først langs u, så langs v
  if (plan && T.flytt) {
    let px = X(fF.c[0]), py = Y(fF.c[1]);
    const du = (fN.c[0] - fF.c[0]) * s, dv = (fN.c[1] - fF.c[1]) * s;
    const lengde = (v) => { if (!v) return 0; if (Math.abs(v) < minst) { forstorret = true; return Math.sign(v) * minst; } return v; };
    const lu = T.flytt.dx ? lengde(du) : 0, lv = T.flytt.dz ? lengde(dv) : 0;
    if (lu) { pil(d, px, py, px + lu, py); blaTekst(d, Math.round(Math.abs(T.flytt.dx)) + " mm", px + lu / 2, py - 1.6, { align: "center" }); px += lu; }
    if (lv) { pil(d, px, py, px, py + lv); blaTekst(d, Math.round(Math.abs(T.flytt.dz)) + " mm", px + 1.8, py + lv / 2 + 1); }
  }
  // Høyde i opprisset
  if (!plan && T.hoyde) {
    const vx = Math.min(...papir(fF.pkt).map(p => p[0])) - 3;
    let lv = -T.hoyde / 1000 / ((e.toM || 1)) * s;   // v = −y
    if (Math.abs(lv) < minst) { forstorret = true; lv = Math.sign(lv || -1) * minst; }
    const y1 = Y(fF.c[1]);
    pil(d, vx, y1, vx, y1 + lv);
    blaTekst(d, (T.hoyde > 0 ? t("hevet") : t("senket")) + " " + Math.round(Math.abs(T.hoyde)) + " mm", vx - 1.5, y1 + lv / 2, { align: "right" });
  }
  // Dreiing: bue rundt den faste enden (eller senter)
  if (plan && T.vinkel) {
    const pv = T.pivot ? [X(T.pivot[0]), Y(T.pivot[2])] : [X(fF.c[0]), Y(fF.c[1])];
    const vin = (p) => { const c = [X(p.c[0]), Y(p.c[1])]; return Math.atan2(c[1] - pv[1], c[0] - pv[0]); };
    let a0 = T.pivot ? vin(fF) : Math.atan2(fF.ret[1], fF.ret[0]), a1 = T.pivot ? vin(fN) : Math.atan2(fN.ret[1], fN.ret[0]);
    let sveip = a1 - a0; while (sveip > Math.PI) sveip -= 2 * Math.PI; while (sveip < -Math.PI) sveip += 2 * Math.PI;
    if (Math.abs(sveip) < 0.14) { forstorret = true; sveip = Math.sign(sveip || 1) * 0.14; }
    const rr = Math.max(8, fF.len * s * 0.35);
    const pk = []; for (let k = 0; k <= 16; k++) { const a = a0 + sveip * k / 16; pk.push([pv[0] + rr * Math.cos(a), pv[1] + rr * Math.sin(a)]); }
    d.setDrawColor(...rgb(FARGE.bla)); d.setLineWidth(0.45);
    for (let k = 1; k < pk.length; k++) d.line(pk[k - 1][0], pk[k - 1][1], pk[k][0], pk[k][1]);
    pilHode(d, pk[15][0], pk[15][1], pk[16][0], pk[16][1]);
    const am = a0 + sveip / 2;
    blaTekst(d, String(Math.round(Math.abs(T.vinkel) * 10) / 10).replace(".", ",") + "°", pv[0] + (rr + 3) * Math.cos(am), pv[1] + (rr + 3) * Math.sin(am) + 1);
  }
  // Lengde: målelinjer langs elementet, før (rødt) på den ene siden og etter (oransje) på den andre
  if (T.dL) {
    const maal = (f, farge, side, tekst) => {
      const p = papir(f.pkt), c = [X(f.c[0]), Y(f.c[1])];
      const r = [(p[1][0] - p[0][0]), (p[1][1] - p[0][1])], l = Math.hypot(r[0], r[1]) || 1;
      const ru = [r[0] / l, r[1] / l], nn = [-ru[1] * side, ru[0] * side];
      const lp = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]) / 2 + 3.5;
      const a = [c[0] - ru[0] * l / 2 + nn[0] * lp, c[1] - ru[1] * l / 2 + nn[1] * lp], b2 = [c[0] + ru[0] * l / 2 + nn[0] * lp, c[1] + ru[1] * l / 2 + nn[1] * lp];
      d.setDrawColor(...rgb(farge)); d.setLineWidth(0.25); d.line(a[0], a[1], b2[0], b2[1]);
      for (const q of [a, b2]) d.line(q[0] - nn[0] * 1.2, q[1] - nn[1] * 1.2, q[0] + nn[0] * 1.2, q[1] + nn[1] * 1.2);
      d.setFont(undefined, "normal"); d.setFontSize(6.5); d.setTextColor(...rgb(farge));
      const mx = (a[0] + b2[0]) / 2, my = (a[1] + b2[1]) / 2;
      // Loddrett mållinje: teksten ved siden av, ikke oppå streken
      if (Math.abs(ru[1]) > Math.abs(ru[0])) d.text(tilLatin1(tekst), mx + (nn[0] >= 0 ? 1.5 : -1.5), my + 0.8, { align: nn[0] >= 0 ? "left" : "right" });
      else d.text(tilLatin1(tekst), mx + nn[0] * 2.2, my + nn[1] * 2.2 + 0.8, { align: "center" });
    };
    maal(fF, FARGE.fjernet, 1, t("før") + " " + Math.round(T.lF) + " mm");
    maal(fN, FARGE.gammel, -1, t("etter") + " " + Math.round(T.lN) + " mm");
    // Blå pil i den enden som er endret: fra den gamle enden til den nye
    const endene = (f) => { const c = [X(f.c[0]), Y(f.c[1])], r = f.ret, l = f.len * s / 2;
      return [[c[0] - r[0] * l, c[1] - r[1] * l], [c[0] + r[0] * l, c[1] + r[1] * l]]; };
    const eF = endene(fF), eN = endene(fN);
    const av = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const par = av(eF[0], eN[0]) + av(eF[1], eN[1]) <= av(eF[0], eN[1]) + av(eF[1], eN[0]) ? [[eF[0], eN[0]], [eF[1], eN[1]]] : [[eF[0], eN[1]], [eF[1], eN[0]]];
    const [fra, til] = av(...par[0]) >= av(...par[1]) ? par[0] : par[1];
    let vx = til[0] - fra[0], vy = til[1] - fra[1], vl = Math.hypot(vx, vy);
    if (vl > 0.01) {
      if (vl < minst) { forstorret = true; vx *= minst / vl; vy *= minst / vl; }
      const ux = vx / Math.hypot(vx, vy), uy = vy / Math.hypot(vx, vy);
      const sx = fra[0] + uy * 7, sy = fra[1] - ux * 7;   // ved siden av elementet, utenfor mållinjene
      pil(d, sx, sy, sx + vx, sy + vy);
      const lx = sx + vx / 2 + uy * 3, ly = sy + vy / 2 - ux * 3 + 1;
      blaTekst(d, (T.dL > 0 ? "+" : "-") + Math.round(Math.abs(T.dL)) + " mm", lx, ly, { align: Math.abs(uy) > 0.7 ? (uy > 0 ? "left" : "right") : "center" });
    }
  }
  // Høydeendring i en plantegning: et merke i hjørnet, så den ikke bare står i teksten
  if (plan && T.hoyde) {
    const tx = x + b - 3, ty = y + 5;
    const tekst = (T.hoyde > 0 ? t("hevet") : t("senket")) + " " + Math.round(Math.abs(T.hoyde)) + " mm";
    d.setFont(undefined, "bold"); d.setFontSize(7);
    const w = d.getTextWidth(tilLatin1(tekst));
    const ax = tx - w - 3;
    pil(d, ax, T.hoyde > 0 ? ty + 1.5 : ty - 2.5, ax, T.hoyde > 0 ? ty - 2.5 : ty + 1.5);
    blaTekst(d, tekst, tx, ty + 0.5, { align: "right" });
  }
  if (forstorret) {
    d.setFont(undefined, "italic"); d.setFontSize(5.5); d.setTextColor(...rgb(FARGE.gra));
    d.text(tilLatin1(t("Små endringer er tegnet større enn målestokk — tallene gjelder.")), x + 2.5, y + h - 2);
  }
}

const DETALJ_PER_SIDE = 3;
function tegnDetaljsider(d, em, endring, i, n, opt) {
  const nr = endretNummer(endring);
  const liste = endring.elementer.filter(e => e.hva === "endret");
  if (!liste.length) return 0;
  const R = EM_SIDE, bredde = R.b - 2 * R.marg, sider = Math.ceil(liste.length / DETALJ_PER_SIDE);
  for (let si = 0; si < sider; si++) {
    d.addPage("a4", "landscape");
    const y0 = malTopp(d, {
      x: R.marg, y: R.marg, bredde, logo: opt.logo, logoB: 40, logoH: 12,
      meta: [
        opt.avsender ? { tekst: tilLatin1(opt.avsender), fet: true } : null,
        { tekst: tilLatin1((em.nr ? em.nr + " · " : "") + em.tittel) },
        em.til ? { tekst: tilLatin1(em.fra ? t("Modell: {0} mot {1}", em.til, em.fra) : t("Modell: {0}", em.til)) } : null
      ],
      kicker: t("Endring {0} av {1} · endrede elementer, side {2} av {3}", i + 1, n, si + 1, sider),
      tittel: tilLatin1(endring.navn + (endring.undertekst ? " (" + endring.undertekst + ")" : "")),
      tittelStr: 14,
      under: tilLatin1(t("Rød stiplet = før · oransje = etter · blått = hva som er endret"))
    });
    const yStrek = R.h - R.marg - 4, yBunn = yStrek - 4, luft = 5;
    const kb = (bredde - luft * (DETALJ_PER_SIDE - 1)) / DETALJ_PER_SIDE, kh = yBunn - y0;
    liste.slice(si * DETALJ_PER_SIDE, si * DETALJ_PER_SIDE + DETALJ_PER_SIDE).forEach((e, k) => {
      const kx = R.marg + k * (kb + luft);
      d.setDrawColor(...rgb(FARGE.kant)); d.setLineWidth(0.25); d.roundedRect(kx, y0, kb, kh, 1.2, 1.2, "S");
      // nummer og navn
      d.setFillColor(...rgb(FARGE.bla)); d.circle(kx + 5, y0 + 5, 2.4, "F");
      d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(255, 255, 255);
      d.text(String(nr.get(e)), kx + 5, y0 + 6.1, { align: "center" });
      d.setFontSize(8.5); d.setTextColor(...rgb(FARGE.tekst));
      const akse = e.akse ? " · " + e.akse : "";
      d.text(kutt(d, tilLatin1((e.navn || e.guid || "—").split(":").slice(-2).join(":") + akse), kb - 12), kx + 9, y0 + 6.2);
      d.setFont(undefined, "normal"); d.setFontSize(6.5); d.setTextColor(...rgb(FARGE.gra));
      d.text(kutt(d, tilLatin1([dimensjonAv(e.navn), kortGuid(e.guid)].filter(Boolean).join(" · ")), kb - 12), kx + 9, y0 + 9.6);
      // tegningen
      const el = { c: e.c, d: e.d, v: e.v, navn: e.navn, r: e.r, L: e.L,
        fra: { c: e.fc, d: e.fd, v: e.fv, navn: e.nf || e.navn, r: e.fr, L: e.fL } };
      const det = detaljerFor(el, { toM: em.toM, akser: em.akser });
      const th = Math.min(kh * 0.6, kh - 40);
      d.setDrawColor(...rgb(FARGE.kant)); d.setFillColor(251, 251, 252); d.rect(kx + 3, y0 + 12.5, kb - 6, th, "FD");
      tegnElement(d, kx + 3, y0 + 12.5, kb - 6, th, Object.assign({ toM: em.toM }, e), det, em.akser);
      // teksten
      let ty = y0 + 12.5 + th + 5;
      d.setFont(undefined, "normal"); d.setFontSize(7.4); d.setTextColor(...rgb(FARGE.tekst));
      for (const p of det.punkter) {
        const linjer = d.splitTextToSize(tilLatin1(p.tekst), kb - 11);
        if (ty + linjer.length * 3.3 > y0 + kh - 2) { d.text("…", kx + 4, ty); break; }
        d.setFillColor(...rgb(FARGE.bla)); d.circle(kx + 5, ty - 0.9, 0.55, "F");
        d.text(linjer, kx + 7.5, ty);
        ty += linjer.length * 3.3 + 1.2;
      }
    });
    malBunn(d, { x: R.marg, bredde, yStrek, logo: opt.logo, str: 7,
      tekstIstedet: opt.avsender ? tilLatin1(opt.avsender) : "",
      hale: t("Mål og vinkler er lest fra 3D-modellen. Endringer under 1 mm og 0,5° er avrundet bort.") });
  }
  return sider;
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
    // 🔍 rett etter oversikten: detaljene for de endrede elementene i den
    if (!em.utvalg) tegnDetaljsider(d, em, endring, i, n, opt);
  });
  tegnNyIdSide(d, em, opt);
}
