// 📄 SAMMENLIGNING-PDF (runde G, 12.11.2026)
//
// Samme oppsett som EM-dokumentet: side 1 er en oversikt over ALLE endringene
// (oversiktsbildet og en tabell – fortsetter på neste side hvis den er lang),
// deretter én side per endring (per elementtype) med bilder før og etter,
// plan med akser og punktene i klartekst – de sidene tegnes av em-pdf.js.
//
// Synkron: bildene er hentet på forhånd. Prøves med ekte jsPDF i
// _test/test-sammenligning-send.mjs.
import { t } from "./i18n.js";
import { malBunn, malTopp } from "./pdf-utseende.js";
import { tilLatin1 } from "./skjema-pdf.js";
import { EM_SIDE, tegnEmSider } from "./em-pdf.js";

const L = (s) => tilLatin1(String(s == null ? "" : s));
const FARGE = { ny: [60, 180, 75], endret: [233, 161, 59], fjernet: [210, 43, 52], gra: [107, 114, 128], kant: [220, 223, 228], tekst: [20, 22, 26] };
const HVA_NAVN = { ny: "Ny", endret: "Endret", fjernet: "Fjernet" };

function bildeInn(d, data, x, y, b, h) {
  if (!data) return false;
  let ib = 16, ih = 10;
  try { const p = d.getImageProperties(data); if (p && p.width) { ib = p.width; ih = p.height; } } catch (_) { /* standard */ }
  const f = Math.min(b / ib, h / ih), w = ib * f, hh = ih * f;
  try { d.addImage(data, "JPEG", x + (b - w) / 2, y + (h - hh) / 2, w, hh); return true; } catch (_) { return false; }
}

// j: sammenligning.json (sammenligning-regn byggJson). o: { logo, avsender, oversikt (dataUrl) }
function tegnOversikt(d, j, o) {
  const R = EM_SIDE, bredde = R.b - 2 * R.marg;
  const topp = (fortsatt) => malTopp(d, {
    x: R.marg, y: R.marg, bredde, logo: o.logo, logoB: 40, logoH: 12,
    meta: [o.avsender ? { tekst: L(o.avsender), fet: true } : null,
      { tekst: L(t("Laget {0} av {1}", String(j.laget || "").slice(0, 10).split("-").reverse().join("."), j.av || "")) },
      { tekst: L(t("Metode: {0}", j.metode === "manuell" ? t("manuell (modellene lagt oppå hverandre)") : t("automatisk"))) }],
    kicker: fortsatt ? t("Sammenligning · alle endringene (fortsatt)") : t("Sammenligning · alle endringene"),
    tittel: L(j.tittel), tittelStr: 15,
    under: L(t("{0} nye · {1} endret · {2} fjernet", j.telling.ny, j.telling.endret, j.telling.fjernet) + "  ·  " + j.fra + " → " + j.til)
  });
  const bunn = () => malBunn(d, { x: R.marg, bredde, yStrek: R.h - R.marg - 4, logo: o.logo, str: 7,
    tekstIstedet: o.avsender ? L(o.avsender) : "",
    hale: L(t("Grønt = ny · gult = endret · rødt = fjernet. Vurderingene gjøres i Storm Prosjekter.")) });
  // Første side: bildet til venstre, tabellen til høyre
  let y0 = topp(false);
  const yMaks = R.h - R.marg - 10;
  const bildeB = 128, luft = 6;
  if (j.usikker) {
    d.setFont(undefined, "bold"); d.setFontSize(7.5); d.setTextColor(160, 28, 28);
    d.text(L(t("Under halvparten av elementene lot seg parre – er dette to versjoner av samme modell?")), R.marg, y0); y0 += 5;
  }
  d.setDrawColor(...FARGE.kant); d.setLineWidth(0.25); d.rect(R.marg, y0, bildeB, yMaks - y0);
  if (!bildeInn(d, o.oversikt, R.marg + 1, y0 + 1, bildeB - 2, yMaks - y0 - 2)) {
    d.setFont(undefined, "italic"); d.setFontSize(8); d.setTextColor(...FARGE.gra);
    d.text(L(t("Oversiktsbildet mangler.")), R.marg + 4, y0 + 8);
  }
  let x = R.marg + bildeB + luft, b = bredde - bildeB - luft, y = y0 + 3;
  const kol = [{ t: t("Hva"), b: 0.14 }, { t: t("Type"), b: 0.2 }, { t: t("Navn"), b: 0.34 }, { t: t("Endring"), b: 0.32 }];
  const hode = () => {
    d.setFillColor(245, 246, 248); d.rect(x, y - 3.6, b, 5.2, "F");
    d.setFont(undefined, "bold"); d.setFontSize(6.6); d.setTextColor(...FARGE.gra);
    let xx = x; for (const k of kol) { d.text(L(k.t).toUpperCase(), xx + 1.2, y); xx += k.b * b; }
    y += 4.6;
  };
  hode();
  if (!j.endringer.length) {
    d.setFont(undefined, "italic"); d.setFontSize(8); d.setTextColor(...FARGE.gra);
    d.text(L(t("Ingen forskjeller funnet.")), x + 1.2, y + 2);
  }
  for (const e of j.endringer) {
    d.setFont(undefined, "normal"); d.setFontSize(7.2);
    const celler = [t(HVA_NAVN[e.hva] || e.hva), e.type, e.navn || e.gid || "—", (e.punkter || [])[0] || ""];
    const deler = celler.map((c, i) => d.splitTextToSize(L(c), kol[i].b * b - 2.4).slice(0, 2));
    const h = Math.max(...deler.map(z => z.length)) * 3.1 + 1.2;
    if (y + h > yMaks) {
      bunn(); d.addPage("a4", "landscape");
      y0 = topp(true); x = R.marg; b = bredde; y = y0 + 3; hode();
      d.setFont(undefined, "normal"); d.setFontSize(7.2);
    }
    let xx = x;
    deler.forEach((linjer, i) => {
      d.setTextColor(...(i === 0 ? (FARGE[e.hva] || FARGE.tekst) : FARGE.tekst));
      if (i === 0) d.setFont(undefined, "bold"); else d.setFont(undefined, "normal");
      linjer.forEach((l, li) => d.text(l, xx + 1.2, y + li * 3.1));
      xx += kol[i].b * b;
    });
    d.setDrawColor(...FARGE.kant); d.setLineWidth(0.15); d.line(x, y + h - 2.6, x + b, y + h - 2.6);
    y += h;
  }
  bunn();
}

// jsPDF: klassen. j: sammenligning.json. em: { endringer, toM, akser, fra, til, tittel }
// bilder: [{ for, etter }] per gruppe (data-URL-er). o: { logo, avsender, oversikt }
export function tegnSammenligning(jsPDF, j, em, bilder, o) {
  const opt = o || {};
  const d = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  tegnOversikt(d, j, opt);
  const emLik = { nr: "", tittel: j.tittel, fra: j.fra, til: j.til, endringer: em.endringer || [], toM: em.toM || 1,
    akser: em.akser || null, utvalg: false, nyIdAndre: [] };
  if (emLik.endringer.length) tegnEmSider(d, emLik, bilder || [], { logo: opt.logo, avsender: opt.avsender || "" });
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    d.setFont(undefined, "normal"); d.setFontSize(6.4); d.setTextColor(107, 114, 128);
    d.text(L(t("Side {0} av {1}", i, n)), EM_SIDE.b - EM_SIDE.marg, EM_SIDE.h - EM_SIDE.marg + 1, { align: "right" });
  }
  return d;
}
