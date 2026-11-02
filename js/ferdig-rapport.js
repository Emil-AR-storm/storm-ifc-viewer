// 📊 FRAMDRIFTSRAPPORTEN — PDF OG EXCEL (runde 10a, Emil 02.11.2026).
//
// To varianter, med vilje svært ulike:
//   · «intern»: plan mot faktisk — totalen med planstrek og avvik, hver type
//     med status, S-kurven, trinnene og lista over det som er forsinket.
//     Excel har typene, trinnene og HVERT objekt (hvem, når, kontor/📱).
//   · «status»: til mottaker — totalen og % ferdig per elementtype. Ingen
//     plan, ingen avvik, ingen navn. Emil: «alt det andre bare kommer i veien
//     som støy for mottaker».
// Lastes først ved trykk (ferdig.js).
import { S } from "./state.js";
import { t } from "./i18n.js";
import { hentJsPDF, lastNedFil, norskDato } from "./rapport.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { malBunn, malTopp, pdfFarger } from "./pdf-utseende.js";
import { tilLatin1 } from "./skjema-pdf.js";
import * as F from "./ferdig-regn.js";

const A4 = { b: 210, h: 297, marg: 15 };
const FARGE = { gronn: [60, 180, 75], gul: [233, 161, 59], rod: [222, 53, 53], gra: [201, 206, 214] };
const rgb = (h) => { const n = parseInt(String(h || "#000000").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const L = (s) => tilLatin1(s);
const p1 = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

async function finnLogo() {
  try {
    const husket = S.framdriftLogoFil ? S.framdriftLogoFil() : (S.settings && S.settings.rapLogo);
    if (!husket) return null;
    const l = (await hentLogoer()).find(x => x.fil === husket);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}
function prosjekt() {
  const i = S.prosjektInfo ? S.prosjektInfo() || {} : {};
  return [i.nummer, i.navn].filter(Boolean).join(" · ") || String(S.fileName || "").replace(/\.(ifc|glb)$/i, "");
}
export function filnavn(slag, iDag, ext) {
  const base = String(S.fileName || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return (slag === "intern" ? t("Framdriftsrapport intern") : t("Framdriftsrapport status")) + " " + base + " " + iDag + "." + ext;
}

// ═══════════ PDF ═══════════
function side(d, o, kicker, tittel, under) {
  const bredde = A4.b - 2 * A4.marg;
  return malTopp(d, { x: A4.marg, y: A4.marg, bredde, logo: o.logo, logoB: 40, logoH: 12,
    meta: [{ tekst: L(prosjekt()), fet: true }, { tekst: L(t("Modell: {0}", String(S.fileName || ""))) }],
    kicker: L(kicker), tittel: L(tittel), tittelStr: 16, under: under ? L(under) : "" });
}
function strek(d, x, y, b, h, pst, farge, plan) {
  d.setFillColor(235, 237, 241); d.rect(x, y, b, h, "F");
  const w = Math.max(0, Math.min(100, pst)) / 100 * b;
  if (w > 0) { d.setFillColor(...farge); d.rect(x, y, w, h, "F"); }
  if (plan != null) {
    const xp = x + Math.max(0, Math.min(100, plan)) / 100 * b;
    d.setDrawColor(20, 22, 26); d.setLineWidth(0.6); d.line(xp, y - 1.2, xp, y + h + 1.2);
  }
}
function tekst(d, s, x, y, o) {
  const opt = o || {};
  d.setFont(undefined, opt.fet ? "bold" : "normal"); d.setFontSize(opt.str || 9);
  d.setTextColor(...(opt.farge || rgb(pdfFarger().tekst)));
  d.text(L(s), x, y, opt.align ? { align: opt.align } : undefined);
}

function statusPdf(d, r, o) {
  const x = A4.marg, B = A4.b - 2 * A4.marg, grå = rgb(pdfFarger().hjelpetekst);
  let y = side(d, o, t("Framdriftsrapport"), t("Status {0}", norskDato(r.iDag)), t("Hvor mye som er ferdig, per elementtype og totalt"));
  // Totalen
  d.setFillColor(244, 245, 247); d.roundedRect(x, y, B, 34, 2, 2, "F");
  tekst(d, t("Totalt prosjektet"), x + 6, y + 8, { str: 8, farge: grå, fet: true });
  tekst(d, p1(r.pst) + " %", x + 6, y + 22, { str: 26, fet: true });
  tekst(d, t("{0} av {1} ferdig", r.ferdig, r.n), x + B - 6, y + 22, { str: 10, align: "right" });
  strek(d, x + 6, y + 26, B - 12, 4, r.pst, FARGE.gronn, null);
  y += 44;
  tekst(d, t("Per elementtype"), x, y, { fet: true, str: 10 }); y += 6;
  for (const ty of r.typer) {
    if (y > A4.h - 40) { d.addPage("a4", "portrait"); y = side(d, o, t("Framdriftsrapport"), t("Status {0}", norskDato(r.iDag))); }
    tekst(d, t(ty.gruppe), x, y + 4, { str: 9.5, fet: true });
    tekst(d, ty.ferdig + " / " + ty.n, x + B - 22, y + 4, { str: 8.5, farge: grå, align: "right" });
    tekst(d, p1(ty.pst) + " %", x + B, y + 4, { str: 9.5, fet: true, align: "right" });
    strek(d, x + 62, y + 1, B - 62 - 42, 4, ty.pst, FARGE.gronn, null);
    y += 10;
  }
}

function internPdf(d, r, o) {
  const x = A4.marg, B = A4.b - 2 * A4.marg, grå = rgb(pdfFarger().hjelpetekst);
  const kick = t("Framdriftsrapport · intern");
  let y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag)), t("Den mørke streken er der Framdriftsplan sier vi skal være i dag"));
  const st = r.plan.status;
  d.setFillColor(244, 245, 247); d.roundedRect(x, y, B, 40, 2, 2, "F");
  tekst(d, t("Totalt ferdig"), x + 6, y + 8, { str: 8, farge: grå, fet: true });
  tekst(d, p1(r.pst) + " %", x + 6, y + 21, { str: 22, fet: true });
  if (r.plan.n) {
    tekst(d, t("Plan i dag"), x + B - 6, y + 8, { str: 8, farge: grå, fet: true, align: "right" });
    tekst(d, p1(r.plan.pst) + " %", x + B - 6, y + 21, { str: 22, fet: true, align: "right", farge: grå });
  }
  strek(d, x + 6, y + 25, B - 12, 4.5, r.plan.n ? r.plan.faktiskPst : r.pst, FARGE[st === "gra" ? "gronn" : st], r.plan.n ? r.plan.pst : null);
  const avv = !r.plan.n ? t("Ingen objekter ligger i et trinn med dato.")
    : r.plan.avvik >= F.GRENSE.gul ? t("{0} %-poeng bak plan", p1(r.plan.avvik)) + (r.plan.dagerBak > 0 ? " (ca. " + t("{0} arbeidsdager", r.plan.dagerBak) + ")" : "")
      : r.plan.avvik <= -F.GRENSE.gul ? t("{0} %-poeng foran plan", p1(-r.plan.avvik)) + (r.plan.dagerBak < 0 ? " (ca. " + t("{0} arbeidsdager", -r.plan.dagerBak) + ")" : "")
        : t("I rute");
  tekst(d, avv, x + 6, y + 36, { str: 9, fet: true, farge: FARGE[st === "gra" ? "gra" : st].map(v => Math.max(0, v - 40)) });
  if (r.plan.n && r.uten.n) tekst(d, t("{0} objekter uten trinn er med i «Totalt ferdig», men ikke i planen.", r.uten.n), x + B - 6, y + 36, { str: 7, farge: grå, align: "right" });
  y += 48;
  // Typene
  tekst(d, t("Per elementtype"), x, y, { fet: true, str: 10 });
  tekst(d, t("Ferdig"), x + B - 44, y, { str: 7, farge: grå, align: "right" }); tekst(d, t("Plan"), x + B - 22, y, { str: 7, farge: grå, align: "right" });
  tekst(d, t("Avvik"), x + B, y, { str: 7, farge: grå, align: "right" });
  y += 6;
  for (const ty of r.typer) {
    if (y > A4.h - 40) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
    const f = ty.status === "gra" ? (ty.ferdig ? "gronn" : "gra") : ty.status;
    tekst(d, t(ty.gruppe), x, y + 4, { str: 9, fet: true });
    tekst(d, ty.ferdig + "/" + ty.n, x + 58, y + 4, { str: 7.5, farge: grå, align: "right" });
    strek(d, x + 62, y + 1, B - 62 - 64, 4, ty.planN ? ty.faktiskPlanPst : ty.pst, FARGE[f], ty.planN ? ty.planPst : null);
    tekst(d, p1(ty.pst) + " %", x + B - 44, y + 4, { str: 8.5, fet: true, align: "right" });
    tekst(d, ty.planN ? p1(ty.planPst) + " %" : "–", x + B - 22, y + 4, { str: 8.5, farge: grå, align: "right" });
    tekst(d, ty.planN ? (ty.avvik > 0 ? "−" : "+") + p1(Math.abs(ty.avvik)) : "–", x + B, y + 4, { str: 8.5, fet: true, align: "right", farge: FARGE[f].map(v => Math.max(0, v - 40)) });
    y += 9;
  }
  // S-kurven
  if (r.kurve.plan.length) {
    if (y > A4.h - 95) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
    y += 4;
    tekst(d, t("S-kurve: plan (stiplet) mot ferdigmeldt"), x, y, { fet: true, str: 10 }); y += 4;
    const H = 52, a = r.kurve.a, b = Math.max(r.kurve.b, a + 1);
    const px = (dd) => x + 8 + (dd - a) / (b - a) * (B - 12), py = (p) => y + H - p / 100 * (H - 4);
    d.setDrawColor(201, 206, 214); d.setLineWidth(0.2);
    for (const p of [0, 25, 50, 75, 100]) { d.line(x + 8, py(p), x + B - 4, py(p)); tekst(d, p + "%", x + 6, py(p) + 1, { str: 6, farge: grå, align: "right" }); }
    const linje = (pts, farge, bredde, stiplet) => {
      d.setDrawColor(...farge); d.setLineWidth(bredde);
      if (stiplet && d.setLineDashPattern) d.setLineDashPattern([1.5, 1.2], 0);
      for (let i = 1; i < pts.length; i++) d.line(px(pts[i - 1][0]), py(pts[i - 1][1]), px(pts[i][0]), py(pts[i][1]));
      if (stiplet && d.setLineDashPattern) d.setLineDashPattern([], 0);
    };
    linje(r.kurve.plan, [107, 114, 128], 0.6, true);
    linje(r.kurve.faktisk, FARGE[st === "gra" ? "gronn" : st], 1.1, false);
    const dag = Date.UTC(...r.iDag.split("-").map((v, i) => i === 1 ? v - 1 : +v)) / 86400000;
    if (dag >= a && dag <= b) { d.setDrawColor(20, 22, 26); d.setLineWidth(0.3); d.line(px(dag), y, px(dag), y + H); tekst(d, t("i dag"), px(dag) + 1, y + 3, { str: 6.5 }); }
    tekst(d, norskDato(new Date(a * 86400000).toISOString().slice(0, 10)), x + 8, y + H + 4, { str: 6.5, farge: grå });
    tekst(d, norskDato(new Date((b - 1) * 86400000).toISOString().slice(0, 10)), x + B - 4, y + H + 4, { str: 6.5, farge: grå, align: "right" });
    y += H + 10;
  }
  // Trinnene
  if (r.trinn.length) {
    if (y > A4.h - 60) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
    tekst(d, t("Trinnene i Framdriftsplan"), x, y, { fet: true, str: 10 }); y += 6;
    const kol = [x, x + 80, x + 112, x + 132, x + 152, x + B];
    [t("Trinn"), t("Fra–til"), t("Ferdig"), t("Plan"), t("Avvik"), t("Status")].forEach((h, i) => tekst(d, h, i < 2 ? kol[i] : kol[i], y, { str: 7, farge: grå, align: i >= 2 ? "right" : undefined }));
    y += 4;
    for (const tr of r.trinn) {
      if (y > A4.h - 32) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
      d.setFillColor(...rgb(tr.farge)); d.rect(x, y - 2.6, 1.6, 3.6, "F");
      tekst(d, (tr.nr + " · " + tr.navn).slice(0, 44), x + 3, y, { str: 8.5 });
      tekst(d, norskDato(tr.dato).slice(0, 5) + "–" + norskDato(tr.slutt), kol[1], y, { str: 8, farge: grå });
      tekst(d, p1(tr.pst) + " %", kol[2], y, { str: 8.5, fet: true, align: "right" });
      tekst(d, p1(tr.planPst) + " %", kol[3], y, { str: 8.5, farge: grå, align: "right" });
      tekst(d, (tr.avvik > 0 ? "−" : "+") + p1(Math.abs(tr.avvik)), kol[4], y, { str: 8.5, align: "right" });
      d.setFillColor(...FARGE[tr.status]); d.roundedRect(kol[5] - 22, y - 3, 22, 4.2, 1, 1, "F");
      tekst(d, t(F.STATUS_TEKST[tr.status]), kol[5] - 11, y, { str: 7, fet: true, align: "center", farge: tr.status === "gra" || tr.status === "gul" ? [20, 22, 26] : [255, 255, 255] });
      y += 6;
    }
    y += 4;
  }
  // Forsinket
  if (r.forsinket.length) {
    if (y > A4.h - 50) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
    tekst(d, t("Skulle vært ferdig ({0})", r.forsinket.length), x, y, { fet: true, str: 10, farge: FARGE.rod }); y += 6;
    const MAKS = 60;
    for (const f of r.forsinket.slice(0, MAKS)) {
      if (y > A4.h - 30) { d.addPage("a4", "portrait"); y = side(d, o, kick, t("Plan mot faktisk {0}", norskDato(r.iDag))); }
      tekst(d, t(f.gruppe), x, y, { str: 8, fet: true });
      tekst(d, String(f.navn || f.gid || "").slice(0, 46), x + 34, y, { str: 7.5 });
      tekst(d, f.trinn.slice(0, 28), x + 120, y, { str: 7.5, farge: grå });
      tekst(d, t("{0} arb.dager over", f.dagerOver), x + B, y, { str: 7.5, align: "right", farge: FARGE.rod });
      y += 4.6;
    }
    if (r.forsinket.length > MAKS) tekst(d, t("… og {0} til — hele lista står i Excel-arket.", r.forsinket.length - MAKS), x, y + 2, { str: 8, farge: grå });
  }
}

export async function lastNedPdf(r, slag) {
  const jsPDF = await hentJsPDF();
  const d = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const o = { logo: await finnLogo() };
  if (slag === "intern") internPdf(d, r, o); else statusPdf(d, r, o);
  const n = d.getNumberOfPages(), bredde = A4.b - 2 * A4.marg;
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    malBunn(d, { x: A4.marg, bredde, yStrek: A4.h - A4.marg - 4, logo: o.logo, str: 7,
      hale: L(slag === "intern" ? t("Telles i antall objekter. Plan i dag regnes jevnt over hvert trinn i Framdriftsplan. Arbeidsdager = man–fre.") : t("Telles i antall objekter.")),
      hoyreTekst: L(t("Side {0} av {1}", i, n) + " · " + norskDato(r.iDag)) });
  }
  const fil = filnavn(slag, r.iDag, "pdf");
  lastNedFil(d.output("blob"), fil);
  return fil;
}

// ═══════════ EXCEL ═══════════
export async function lastNedExcel(r, slag) {
  const X = await import("./xlsx.js");
  const { excelToppfelt } = await import("./excel-logo.js");
  let ark;
  if (slag === "intern") {
    const typeR = F.internTypeRader(r, t);
    const trinnR = F.internTrinnRader(r, t);
    const objR = F.internObjektRader(r, t);
    ark = [
      { navn: t("Typer"), rader: typeR, bredder: [24, 9, 9, 10, 10, 13, 18, 14, 13],
        stil: F.excelStil((i) => i < r.typer.length ? r.typer[i].status : r.plan.status, 9) },
      { navn: t("Trinn"), rader: trinnR, bredder: [7, 30, 12, 12, 10, 9, 10, 13, 14, 13], stil: F.excelStil((i) => r.trinn[i] && r.trinn[i].status, 10) },
      { navn: t("Objekter"), rader: objR, bredder: [18, 34, 26, 24, 12, 13, 17, 20, 13], stil: F.excelStil((i) => r.rader[i] && r.rader[i].farge, 9) }
    ];
  } else {
    ark = [{ navn: t("Status"), rader: F.statusRader(r, t), bredder: [26, 10, 10, 11] }];
  }
  const data = X.lagXlsxFlere(ark, await excelToppfelt());
  const fil = filnavn(slag, r.iDag, "xlsx");
  lastNedFil(new Blob([data], { type: X.XLSX_MIME }), fil);
  return fil;
}
