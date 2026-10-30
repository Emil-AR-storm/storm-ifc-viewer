// 📷 BILDESIDENE I «SJEKKLISTE FØR STØP»-PDF-EN (Emil 30.10.2026)
//
// Etter skjemasiden(e) kommer bildene basen tok på telefonen: to per stående
// A4-side, hvert med punktnummer, punkt, hvem som tok det og når. Tegnes
// synkront inn i skjema-PDF-ens dokument (skjema-pdf.js tegn(…, ekstra)) FØR
// sidetallene settes, så «Side 2 av 3» stemmer også her. Bildene er hentet på
// forhånd (data-URL-er) i stopesjekk.js — derfor ingen await her.
import { t } from "./i18n.js";
import { malBunn, malTopp } from "./pdf-utseende.js";
import { tilLatin1 } from "./skjema-pdf.js";

export const SIDE = { b: 210, h: 297, marg: 15 };
export const PER_SIDE = 2;
const KANT = [220, 223, 228], GRA = [107, 114, 128], TEKST = [20, 22, 26];

// Bildet inn i ruta uten å strekkes (midtstilt)
function bilde(d, data, x, y, b, h) {
  if (!data) return false;
  let ib = 1600, ih = 1200;
  try { const p = d.getImageProperties ? d.getImageProperties(data) : null; if (p && p.width) { ib = p.width; ih = p.height; } } catch (_) {}
  const f = Math.min((b - 4) / ib, (h - 4) / ih);
  const w = ib * f, hh = ih * f;
  try { d.addImage(data, "JPEG", x + (b - w) / 2, y + (h - hh) / 2, w, hh); return true; } catch (_) { return false; }
}

// Del lista i sider à PER_SIDE (ren, testes)
export function sider(bilder) {
  const ut = [];
  for (let i = 0; i < (bilder || []).length; i += PER_SIDE) ut.push(bilder.slice(i, i + PER_SIDE));
  return ut;
}

// bilder: [{ nr, tekst, av, tid, data }]   o: { logo, referanse, prosjekt }
export function tegnSjekkBilder(d, bilder, o) {
  const opt = o || {}, R = SIDE, bredde = R.b - 2 * R.marg;
  const alle = sider(bilder);
  alle.forEach((side, si) => {
    d.addPage("a4", "portrait");
    const y0 = malTopp(d, {
      x: R.marg, y: R.marg, bredde, logo: opt.logo, logoB: 40, logoH: 12,
      meta: [
        opt.prosjekt ? { tekst: tilLatin1(opt.prosjekt), fet: true } : null,
        opt.referanse ? { tekst: tilLatin1(opt.referanse) } : null
      ],
      kicker: t("Bilder {0} av {1}", si + 1, alle.length),
      tittel: tilLatin1(t("Sjekkliste før støp — bilder")),
      tittelStr: 14
    });
    const yStrek = R.h - R.marg - 4;
    const tekstH = 11, luft = 6;
    const ruteH = (yStrek - 6 - y0 - (PER_SIDE - 1) * luft) / PER_SIDE - tekstH;
    side.forEach((b, i) => {
      const y = y0 + i * (ruteH + tekstH + luft);
      d.setFont(undefined, "bold"); d.setFontSize(9.5); d.setTextColor(...TEKST);
      d.text(tilLatin1(b.nr + ". " + b.tekst).slice(0, 110), R.marg, y + 4);
      d.setFont(undefined, "normal"); d.setFontSize(7.5); d.setTextColor(...GRA);
      d.text(tilLatin1([b.av, b.tid, t("tatt på byggeplassen")].filter(Boolean).join(" · ")), R.marg, y + 8.5);
      const yr = y + tekstH;
      d.setDrawColor(...KANT); d.setLineWidth(0.25); d.setFillColor(251, 251, 252);
      d.rect(R.marg, yr, bredde, ruteH, "FD");
      if (!bilde(d, b.data, R.marg, yr, bredde, ruteH)) {
        d.setFontSize(8); d.setTextColor(...GRA);
        d.text(tilLatin1(t("Bildet kunne ikke hentes fra SharePoint.")), R.marg + bredde / 2, yr + ruteH / 2, { align: "center" });
      }
    });
    malBunn(d, { x: R.marg, bredde, yStrek, logo: opt.logo, str: 7,
      hale: t("Bildene er tatt av basen på telefonen og hentet inn med Storm-Byggeplass.") });
  });
}
