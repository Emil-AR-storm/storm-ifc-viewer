// 📄 Sjekkliste som PDF. Regnes ut på nytt fra svarene hver gang — ingen PDF
// lagres noe sted. Bytter du logo eller retter en formulering i malen, slår det
// gjennom på alle gamle skjema.
//
// DEN ENE REGELEN SOM STYRER HELE FILA:
// Kostpris, påslag, fortjeneste og margin skal ALDRI ut av huset. `byggSkjemaModell`
// bygger derfor en modell som ikke inneholder de tallene i det hele tatt — det er
// ikke nok å la være å tegne dem, for da ligger de fortsatt i objektet neste
// utvikler sender videre.
//
// Det holder heller ikke å skjule påslag-kolonnen: `enhetspris` ER kostprisen,
// og står den ved siden av totalen kan mottakeren regne seg til påslaget
// (1 500 / 1,25 = 1 200 mot 10 × 100 = 1 000). Dokumentet viser derfor
// SALGSPRIS per enhet. Da går tallene opp, og kostnaden er ikke med.
import { t } from "./i18n.js";
import { hentJsPDF } from "./rapport.js";
import { alleFelt, kr, linjeSum, ordreSum, tomtSvar } from "./sjekkliste.js";

// ═══════════════════════ REN LOGIKK ═══════════════════════

export function norskDato(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? m[3] + "." + m[2] + "." + m[1] : String(iso || "");
}

export function svarTekst(f, verdi) {
  if (tomtSvar(verdi)) return "";
  if (f.type === "dato") return norskDato(verdi);
  if (Array.isArray(verdi)) return verdi.map(v => "• " + v).join("\n");
  return String(verdi);
}

// Ordrelinjene slik de skal se ut UTAD. Merk hva som IKKE er med.
export function ordreUtad(rader) {
  const liste = (Array.isArray(rader) ? rader : []).filter(r => r && typeof r === "object");
  const sum = ordreSum(liste);
  return {
    rader: liste.map(r => {
      const l = linjeSum(r);
      return {
        produkt: String(r.produkt || ""),
        antall: Number(r.antall) || 0,
        enhet: String(r.enhet || ""),
        enhetspris: l.salgsEnhetspris,   // SALGSPRIS, ikke kostpris
        eksMva: l.eksMva,
        mvaProsent: Number(r.mva) || 0,
        mvaBelop: l.mvaBelop,
        inklMva: l.inklMva
      };
    }),
    sum: { eksMva: sum.eksMva, mvaBelop: sum.mvaBelop, inklMva: sum.inklMva }
  };
}

export function byggSkjemaModell(mal, skjema, meta) {
  const o = meta || {};
  const felt = alleFelt(mal);
  const finn = (id) => felt.find(f => f.id === id);
  return {
    tittel: String(mal.navn || ""),
    avsender: {
      navn: String((mal.avsender && mal.avsender.navn) || ""),
      orgnr: String((mal.avsender && mal.avsender.orgnr) || ""),
      adresse: String((mal.avsender && mal.avsender.adresse) || ""),
      sted: String((mal.avsender && mal.avsender.sted) || "")
    },
    prosjekt: String(o.prosjekt || ""),
    markering: String(o.markering || ""),
    iDag: String(o.iDag || ""),
    versjon: Number(skjema.versjon) || 1,
    erstatter: skjema.erstatter || null,
    laast: skjema.laast === true,
    signertAv: String(skjema.signertAv || ""),
    signertTid: String(skjema.signertTid || ""),
    signatur: String(skjema.signatur || ""),
    seksjoner: (mal.seksjoner || []).map(s => ({
      tittel: String(s.tittel || ""),
      felt: s.felt.map(f => {
        const v = skjema.svar[f.id];
        const rad = { nr: f.nr || "", navn: f.navn || f.id, type: f.type, tom: tomtSvar(v) };
        if (f.type === "ordrelinjer") rad.ordre = ordreUtad(v);
        else rad.tekst = svarTekst(f, v);
        return rad;
      })
    })),
    _finn: undefined && finn
  };
}

export function filnavn(m) {
  const p = m.prosjekt ? m.prosjekt + " " : "";
  const navn = m.tittel.replace(/[\\/:*?"<>|]/g, "-");
  return p + navn + (m.versjon > 1 ? " v" + m.versjon : "") + " " + m.iDag + ".pdf";
}

// ═══════════════════════ NETTLESER ═══════════════════════

const A4 = { b: 210, h: 297, marg: 16 };
const GRÅ = [110, 116, 124], STREK = [220, 223, 228], ROD = [192, 39, 45], SORT = [20, 22, 26];

function papir(jsPDF, m) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const P = { d, m, y: A4.marg, side: 1, x: A4.marg, bredde: A4.b - A4.marg * 2,
              bunnGrense: A4.h - A4.marg - 10, logo: null };
  P.plass = (h) => P.y + h <= P.bunnGrense;
  P.sørgFor = (h) => { if (!P.plass(h)) P.nySide(); };
  P.nySide = () => { bunnlinje(P); d.addPage(); P.side++; P.y = A4.marg; topplinje(P, false); };
  P.start = () => topplinje(P, true);
  P.slutt = () => {
    bunnlinje(P);
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i); d.setFontSize(7); d.setTextColor(...GRÅ);
      d.text(t("Side {0} av {1}", i, n), A4.b - A4.marg, A4.h - A4.marg + 4, { align: "right" });
    }
  };
  return P;
}

function topplinje(P, forste) {
  const d = P.d;
  let y = P.y;
  if (P.logo) {
    try {
      const h = Math.min(15, 38 * (P.logo.h / P.logo.b));
      d.addImage(P.logo.data, P.logo.format || "PNG", A4.marg, y - 1, 38, h);
      y += h;
    } catch (_) { y += 8; }
  } else {
    d.setFont(undefined, "bold"); d.setFontSize(14); d.setTextColor(...SORT);
    d.text("Storm", A4.marg, y + 6); y += 9;
  }
  const a = P.m.avsender;
  if (a.navn || a.orgnr || a.adresse) {
    d.setFont(undefined, "bold"); d.setFontSize(7.5); d.setTextColor(...SORT);
    let ay = P.y + 2;
    [a.navn, a.orgnr, a.adresse, a.sted].filter(Boolean).forEach((linje, i) => {
      if (i === 1) d.setFont(undefined, "normal");
      d.text(String(linje), A4.b - A4.marg, ay, { align: "right" }); ay += 3.4;
    });
    y = Math.max(y, ay - 1);
  }
  P.y = y + 4;
  if (forste) {
    d.setFont(undefined, "bold"); d.setFontSize(17); d.setTextColor(...SORT);
    d.text(P.m.tittel, A4.marg, P.y + 6); P.y += 11;
    const under = [];
    if (P.m.prosjekt) under.push(t("Prosjekt {0}", P.m.prosjekt));
    if (P.m.versjon > 1) under.push(t("Versjon {0}", P.m.versjon) +
      (P.m.erstatter ? " " + t("(erstatter versjon {0})", P.m.erstatter) : ""));
    if (P.m.markering) under.push(t("Markering: {0}", P.m.markering));
    if (under.length) {
      d.setFont(undefined, "normal"); d.setFontSize(8); d.setTextColor(...GRÅ);
      d.text(under.join("  ·  "), A4.marg, P.y + 3); P.y += 6;
    }
    d.setDrawColor(...STREK); d.setLineWidth(0.3);
    d.line(A4.marg, P.y + 1, A4.b - A4.marg, P.y + 1);
    P.y += 6;
  }
}

function bunnlinje(P) {
  const d = P.d;
  d.setDrawColor(...STREK); d.setLineWidth(0.2);
  d.line(A4.marg, A4.h - A4.marg - 2, A4.b - A4.marg, A4.h - A4.marg - 2);
  d.setFont(undefined, "normal"); d.setFontSize(7); d.setTextColor(...GRÅ);
  const venstre = [P.m.avsender.navn || "Storm", P.m.prosjekt].filter(Boolean).join(" · ");
  d.text(venstre, A4.marg, A4.h - A4.marg + 4);
}

function seksjonshode(P, tekst) {
  P.sørgFor(12);
  const d = P.d;
  d.setFont(undefined, "bold"); d.setFontSize(11); d.setTextColor(...SORT);
  d.text(tekst, P.x, P.y + 4);
  P.y += 7;
  d.setDrawColor(...STREK); d.setLineWidth(0.2);
  d.line(P.x, P.y, A4.b - A4.marg, P.y);
  P.y += 4;
}

function feltBlokk(P, f) {
  const d = P.d;
  const tittel = (f.nr ? f.nr + " " : "") + f.navn;
  d.setFont(undefined, "bold"); d.setFontSize(9);
  const linjer = f.tom ? [t("Ikke besvart")] : d.splitTextToSize(f.tekst || "", P.bredde);
  P.sørgFor(6 + linjer.length * 4 + 4);
  d.setTextColor(...SORT);
  d.text(tittel, P.x, P.y + 3.5);
  P.y += 6;
  d.setFont(undefined, "normal"); d.setFontSize(9);
  d.setTextColor(...(f.tom ? ROD : SORT));
  linjer.forEach(l => { P.sørgFor(5); d.text(l, P.x, P.y + 3.2); P.y += 4.2; });
  P.y += 3.5;
  d.setDrawColor(...STREK); d.setLineWidth(0.15);
  d.line(P.x, P.y, A4.b - A4.marg, P.y);
  P.y += 4;
}

// Ordrelinjer. SEKS kolonner — påslag, fortjeneste og kostnad finnes ikke i
// modellen og kan derfor ikke tegnes ved et uhell.
const O_KOL = [
  { n: "produkt",    tittel: "Produkt",         b: 58, h: "left"  },
  { n: "antall",     tittel: "Antall",          b: 16, h: "right" },
  { n: "enhet",      tittel: "Enhet",           b: 14, h: "left"  },
  { n: "enhetspris", tittel: "Enhetspris",      b: 24, h: "right" },
  { n: "eksMva",     tittel: "Sum eks. mva",    b: 26, h: "right" },
  { n: "mvaBelop",   tittel: "MVA",             b: 20, h: "right" },
  { n: "inklMva",    tittel: "Sum inkl. mva",   b: 26, h: "right" }
];

function ordreTabell(P, f) {
  const d = P.d;
  const tittel = (f.nr ? f.nr + " " : "") + f.navn;
  P.sørgFor(24);
  d.setFont(undefined, "bold"); d.setFontSize(9); d.setTextColor(...SORT);
  d.text(tittel, P.x, P.y + 3.5); P.y += 7;

  if (!f.ordre.rader.length) {
    d.setFont(undefined, "normal"); d.setFontSize(9); d.setTextColor(...ROD);
    d.text(t("Ikke besvart"), P.x, P.y + 3.2); P.y += 8;
    return;
  }

  const bredder = O_KOL.map(k => k.b);
  const totalB = bredder.reduce((a, b) => a + b, 0);
  const skala = P.bredde / totalB;
  const x = []; let løpende = P.x;
  bredder.forEach((b, i) => { x[i] = løpende; løpende += b * skala; });
  const slutt = (i) => x[i] + bredder[i] * skala;

  const hode = () => {
    d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(...GRÅ);
    O_KOL.forEach((k, i) => d.text(t(k.tittel), k.h === "right" ? slutt(i) - 1 : x[i], P.y + 3,
      { align: k.h === "right" ? "right" : "left" }));
    P.y += 5;
    d.setDrawColor(...STREK); d.setLineWidth(0.2);
    d.line(P.x, P.y, A4.b - A4.marg, P.y); P.y += 3;
  };
  hode();

  d.setFont(undefined, "normal"); d.setFontSize(8); d.setTextColor(...SORT);
  f.ordre.rader.forEach(r => {
    const navn = d.splitTextToSize(r.produkt || "—", bredder[0] * skala - 2);
    const h = Math.max(4.2, navn.length * 3.6);
    if (!P.plass(h + 4)) { P.nySide(); hode(); d.setFont(undefined, "normal"); d.setFontSize(8); d.setTextColor(...SORT); }
    navn.forEach((l, i) => d.text(l, x[0], P.y + 3 + i * 3.6));
    const verdier = [null, String(r.antall), r.enhet, kr(r.enhetspris), kr(r.eksMva), kr(r.mvaBelop), kr(r.inklMva)];
    O_KOL.forEach((k, i) => {
      if (i === 0) return;
      d.text(verdier[i], k.h === "right" ? slutt(i) - 1 : x[i], P.y + 3,
        { align: k.h === "right" ? "right" : "left" });
    });
    P.y += h + 1.6;
    d.setDrawColor(...STREK); d.setLineWidth(0.12);
    d.line(P.x, P.y, A4.b - A4.marg, P.y); P.y += 2;
  });

  P.sørgFor(16);
  const s = f.ordre.sum;
  const rad = (etikett, verdi, fet) => {
    d.setFont(undefined, fet ? "bold" : "normal"); d.setFontSize(fet ? 9 : 8);
    d.setTextColor(...(fet ? SORT : GRÅ));
    d.text(etikett, slutt(5) - 1, P.y + 3, { align: "right" });
    d.setTextColor(...SORT);
    d.text(verdi + " NOK", slutt(6) - 1, P.y + 3, { align: "right" });
    P.y += fet ? 5.5 : 4.4;
  };
  P.y += 1;
  rad(t("Total (eks. mva)"), kr(s.eksMva), false);
  rad(t("MVA"), kr(s.mvaBelop), false);
  rad(t("Total (inkl. mva)"), kr(s.inklMva), true);
  P.y += 3;
}

function signaturblokk(P) {
  const d = P.d, m = P.m;
  if (!m.laast) {
    P.sørgFor(14);
    d.setDrawColor(...ROD); d.setLineWidth(0.4);
    d.roundedRect(P.x, P.y, P.bredde, 10, 1.5, 1.5, "D");
    d.setFont(undefined, "bold"); d.setFontSize(8.5); d.setTextColor(...ROD);
    d.text(t("UTKAST – ikke fullført og ikke signert"), P.x + 3, P.y + 6.5);
    P.y += 14;
    return;
  }
  const høyde = m.signatur ? 40 : 22;
  P.sørgFor(høyde + 4);
  d.setDrawColor(...STREK); d.setLineWidth(0.3);
  d.line(P.x, P.y, A4.b - A4.marg, P.y);
  P.y += 5;
  d.setFont(undefined, "bold"); d.setFontSize(7.5); d.setTextColor(...GRÅ);
  d.text(t("SIGNERT"), P.x, P.y + 2.5);
  P.y += 5;
  if (m.signatur) {
    try { d.addImage(m.signatur, "PNG", P.x, P.y, 54, 18); } catch (_) {}
    P.y += 19;
  } else {
    d.setFont(undefined, "italic"); d.setFontSize(8); d.setTextColor(...GRÅ);
    d.text(t("Signatur ikke påkrevd for dette skjemaet."), P.x, P.y + 3);
    P.y += 5;
  }
  d.setDrawColor(...STREK); d.setLineWidth(0.2);
  d.line(P.x, P.y, P.x + 54, P.y);
  P.y += 4;
  d.setFont(undefined, "normal"); d.setFontSize(8.5); d.setTextColor(...SORT);
  d.text(m.signertAv + (m.signertTid ? "  ·  " + m.signertTid : ""), P.x, P.y);
  P.y += 6;
}

export function tegn(jsPDF, m, logo) {
  const P = papir(jsPDF, m);
  P.logo = logo || null;
  P.start();
  m.seksjoner.forEach(s => {
    seksjonshode(P, s.tittel);
    s.felt.forEach(f => (f.type === "ordrelinjer" ? ordreTabell(P, f) : feltBlokk(P, f)));
  });
  signaturblokk(P);
  P.slutt();
  return P.d;
}

function lastNedFil(blob, navn) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = navn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// opts: { mal, skjema, prosjekt, markering, iDag, hentLogo }
export async function lastNedSkjema(opts) {
  const m = byggSkjemaModell(opts.mal, opts.skjema, opts);
  const logo = typeof opts.hentLogo === "function" ? await opts.hentLogo() : null;
  const jsPDF = await hentJsPDF();
  const d = tegn(jsPDF, m, logo);
  lastNedFil(d.output("blob"), filnavn(m));
  return filnavn(m);
}
