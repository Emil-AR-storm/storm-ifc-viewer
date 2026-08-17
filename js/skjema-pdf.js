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

// jsPDF tegner med de innebygde WinAnsi-fontene. Alt utenfor Latin-1 blir til
// søppel — «volum 2,4 → 3,1 m³» ble til «volum 2,4 !' 3,1 m» i den første ekte
// PDF-en. Pilen er ikke pynt: den kommer fra revisjonssammenligningen i
// js/compare.js og står i hver eneste faktablokk.
//
// Merk hva som IKKE trengs å byttes: – — « » ' ' " " • … ± × ÷ ² ³ ¼ ½ ¾ µ ° §
// ligger alle i WinAnsi og tegnes riktig.
export const LATIN1_BYTTE = [
  [/[→⇒➔➜]/g, "->"], [/[←⇐]/g, "<-"], [/[↔⇔]/g, "<->"], [/[↑⇑]/g, "^"], [/[↓⇓]/g, "v"],
  [/≤/g, "<="], [/≥/g, ">="], [/≠/g, "!="], [/≈/g, "~"], [/∅/g, "diam."], [/⌀/g, "diam."],
  [/[\u2713\u2714]/g, "OK"], [/[\u2717\u2718]/g, "X"],
  // MERK: en-dash \u2013 og em-dash \u2014 ligger i WinAnsi og skal IKKE byttes
  // — «akse 4\u20135» skal fortsatt se riktig ut.
  [/[\u2212\u2012]/g, "-"], [/[\u2011\u2010]/g, "-"],
  [/[\u2028\u2029]/g, "\n"], [/\u200b/g, ""]
];

export function tilLatin1(tekst) {
  let s = String(tekst == null ? "" : tekst);
  for (const [fra, til] of LATIN1_BYTTE) s = s.replace(fra, til);
  // Alt som fortsatt ikke finnes i Latin-1 fjernes. Et tegn som mangler er
  // bedre enn et tegn som lyver: «Ø‹ßα» midt i et varsel ser ut som en feil i
  // innholdet, ikke i skriften.
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a1-\u00ff\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2122]/g, "");
}

export function svarTekst(f, verdi) {
  if (tomtSvar(verdi)) return "";
  if (f.type === "dato") return norskDato(verdi);
  if (Array.isArray(verdi)) return tilLatin1(verdi.map(v => "• " + v).join("\n"));
  return tilLatin1(verdi);
}

// Ordrelinjene slik de skal se ut UTAD. Merk hva som IKKE er med.
export function ordreUtad(rader) {
  const liste = (Array.isArray(rader) ? rader : []).filter(r => r && typeof r === "object");
  const sum = ordreSum(liste);
  return {
    rader: liste.map(r => {
      const l = linjeSum(r);
      return {
        produkt: tilLatin1(r.produkt),
        antall: Number(r.antall) || 0,
        enhet: tilLatin1(r.enhet),
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
    tittel: tilLatin1(mal.navn),
    avsender: {
      navn: tilLatin1(mal.avsender && mal.avsender.navn),
      orgnr: tilLatin1(mal.avsender && mal.avsender.orgnr),
      adresse: tilLatin1(mal.avsender && mal.avsender.adresse),
      sted: tilLatin1(mal.avsender && mal.avsender.sted)
    },
    prosjekt: tilLatin1(o.prosjekt),
    markering: tilLatin1(o.markering),
    iDag: String(o.iDag || ""),
    versjon: Number(skjema.versjon) || 1,
    erstatter: skjema.erstatter || null,
    laast: skjema.laast === true,
    signertAv: tilLatin1(skjema.signertAv),
    signertTid: tilLatin1(skjema.signertTid),
    signatur: String(skjema.signatur || ""),
    seksjoner: (mal.seksjoner || []).map(s => ({
      tittel: tilLatin1(s.tittel),
      felt: s.felt.map(f => {
        const v = skjema.svar[f.id];
        const rad = { nr: tilLatin1(f.nr), navn: tilLatin1(f.navn || f.id), type: f.type, tom: tomtSvar(v) };
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
// Designspråket er HENTET FRA js/rapport.js, ikke funnet på: samme marg, samme
// farger, samme røde strek under toppen, samme små grå versal-overskrifter,
// samme bunnlinje. To dokumenter fra samme firma som ser ut som to firmaer er
// verre enn ett stygt dokument.

const A4 = { b: 210, h: 297, marg: 15 };
const GRÅ = "#6b7280", STREK = "#dcdfe4", ROD = "#a8232b", SORT = "#14161a";

function hex(d, farge, felt) {
  const n = parseInt(String(farge).replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (felt === "fyll") d.setFillColor(r, g, b);
  else if (felt === "strek") d.setDrawColor(r, g, b);
  else d.setTextColor(r, g, b);
}

function papir(jsPDF, m) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const P = { d, m, y: 0, side: 0, x: A4.marg, bredde: A4.b - A4.marg * 2,
              bunnGrense: A4.h - A4.marg - 8, logo: null };
  P.plass = (h) => P.y + h <= P.bunnGrense;
  P.sørgFor = (h) => { if (!P.plass(h)) P.nySide(); };
  P.nySide = () => { if (P.side > 0) bunnlinje(P); d.addPage(); P.side++; topplinje(P, false); };
  P.start = () => { P.side = 1; topplinje(P, true); };
  P.slutt = () => {
    bunnlinje(P);
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      d.setFontSize(7.5); hex(d, GRÅ);
      d.text(t("Side {0} av {1}", i, n) + (m.prosjekt ? " · " + m.prosjekt : "") +
        " · " + norskDato(m.iDag), A4.b - A4.marg, A4.h - A4.marg + 1, { align: "right" });
    }
  };
  return P;
}

function topplinje(P, forste) {
  const { d, m } = P;
  let y = A4.marg;
  if (P.logo) {
    const h = Math.min(16, 42 * (P.logo.h / P.logo.b));
    try { d.addImage(P.logo.data, P.logo.format || "PNG", A4.marg, y - 2, 42, h); } catch (_) {}
    y += h + 2;
  }

  d.setFontSize(forste ? 16 : 13); hex(d, SORT); d.setFont(undefined, "bold");
  d.text(m.tittel, A4.marg, y + 5);
  d.setFont(undefined, "normal");
  d.setFontSize(9); hex(d, GRÅ);
  const undertittel = [m.prosjekt, m.versjon > 1 ? t("Versjon {0}", m.versjon) : ""].filter(Boolean).join(" · ");
  if (undertittel) d.text(undertittel, A4.marg, y + 10);

  // Metablokka til høyre. Avsenderen står FØRST og i halvfet: dette er et
  // varsel til en kontraktspart, og hvem det kommer fra er ikke en fotnote.
  d.setFontSize(7.5);
  hex(d, SORT); d.setFont(undefined, "bold");
  let my = A4.marg + 2;
  if (m.avsender.navn) { d.text(m.avsender.navn, A4.b - A4.marg, my, { align: "right" }); my += 3.6; }
  d.setFont(undefined, "normal"); hex(d, GRÅ);
  [m.avsender.orgnr ? t("Org.nr. {0}", m.avsender.orgnr) : "", m.avsender.adresse, m.avsender.sted,
   m.markering ? t("Markering: {0}", m.markering) : "",
   m.erstatter ? t("Erstatter versjon {0}", m.erstatter) : ""]
    .filter(Boolean).forEach(linje => { d.text(String(linje), A4.b - A4.marg, my, { align: "right" }); my += 3.6; });

  y = Math.max(y + 13, my + 1);
  hex(d, ROD, "strek"); d.setLineWidth(0.8);
  d.line(A4.marg, y, A4.b - A4.marg, y);
  P.y = y + 6;

  // UTKAST-båndet står på HVER side. Ett bånd bare på forsiden ville forsvunnet
  // i det noen skriver ut side 2 og legger den ved en e-post — samme grunn som
  // møteutgaven i statusrapporten.
  if (!m.laast) {
    const h = forste ? 11 : 7;
    hex(d, "#fdf3f3", "fyll"); hex(d, "#f0cfcf", "strek"); d.setLineWidth(0.2);
    d.roundedRect(A4.marg, P.y, P.bredde, h, 1.5, 1.5, "FD");
    hex(d, ROD, "fyll"); d.rect(A4.marg, P.y, 1.2, h, "F");
    hex(d, ROD); d.setFontSize(8); d.setFont(undefined, "bold");
    d.text(t("Utkast – ikke fullført og ikke signert."), A4.marg + 4, P.y + 4.6);
    d.setFont(undefined, "normal"); hex(d, SORT);
    if (forste) d.text(t("Skjemaet kan fortsatt endres. Det er ikke et avsendt varsel."), A4.marg + 4, P.y + 8.4);
    P.y += h + 5;
  }
}

function bunnlinje(P) {
  const { d, m } = P;
  hex(d, STREK, "strek"); d.setLineWidth(0.2);
  d.line(A4.marg, A4.h - A4.marg - 4, A4.b - A4.marg, A4.h - A4.marg - 4);
  d.setFontSize(7.5); hex(d, GRÅ);
  d.text((m.avsender.navn || "Storm Entreprenør AS") + (m.laast ? "" : " · " + t("utkast")),
    A4.marg, A4.h - A4.marg + 1);
}

function overskrift(P, tekst, tillegg) {
  P.sørgFor(12);
  const { d } = P;
  d.setFontSize(8); hex(d, GRÅ); d.setFont(undefined, "bold");
  d.text(String(tekst).toUpperCase(), P.x, P.y);
  if (tillegg) {
    d.setFont(undefined, "normal");
    d.text(" " + tillegg, P.x + d.getTextWidth(String(tekst).toUpperCase()) + 1.5, P.y);
  }
  d.setFont(undefined, "normal");
  P.y += 4.5;
}

const bryt = (d, tekst, bredde) => d.splitTextToSize(String(tekst == null ? "" : tekst), bredde);

function feltBlokk(P, f) {
  const { d } = P;
  const tittel = (f.nr ? f.nr + "  " : "") + f.navn;
  const linjer = f.tom ? [t("Ikke besvart")] : bryt(d, f.tekst, P.bredde);
  P.sørgFor(6 + linjer.length * 4 + 5);
  d.setFontSize(9); hex(d, SORT); d.setFont(undefined, "bold");
  d.text(tittel, P.x, P.y + 3);
  d.setFont(undefined, "normal");
  P.y += 6.4;
  d.setFontSize(9); hex(d, f.tom ? ROD : SORT);
  linjer.forEach(l => { P.sørgFor(5); d.text(l, P.x, P.y + 3); P.y += 4.1; });
  P.y += 3;
  hex(d, STREK, "strek"); d.setLineWidth(0.2);
  d.line(P.x, P.y, P.x + P.bredde, P.y);
  P.y += 4;
}

// SEKS kolonner. Påslag, fortjeneste og kostnad finnes ikke i modellen og kan
// derfor ikke tegnes ved et uhell.
const O_KOL = [
  { n: "produkt",    tittel: "Produkt",       b: 60, h: "left"  },
  { n: "antall",     tittel: "Antall",        b: 15, h: "right" },
  { n: "enhet",      tittel: "Enhet",         b: 13, h: "left"  },
  { n: "enhetspris", tittel: "Enhetspris",    b: 24, h: "right" },
  { n: "eksMva",     tittel: "Sum eks. mva",  b: 26, h: "right" },
  { n: "mvaBelop",   tittel: "MVA",           b: 19, h: "right" },
  { n: "inklMva",    tittel: "Sum inkl. mva", b: 26, h: "right" }
];

function ordreTabell(P, f) {
  const { d } = P;
  const tittel = (f.nr ? f.nr + "  " : "") + f.navn;
  P.sørgFor(26);
  d.setFontSize(9); hex(d, SORT); d.setFont(undefined, "bold");
  d.text(tittel, P.x, P.y + 3);
  d.setFont(undefined, "normal");
  P.y += 7;

  if (!f.ordre.rader.length) {
    d.setFontSize(9); hex(d, ROD);
    d.text(t("Ikke besvart"), P.x, P.y + 3);
    P.y += 6;
    hex(d, STREK, "strek"); d.setLineWidth(0.2);
    d.line(P.x, P.y, P.x + P.bredde, P.y); P.y += 4;
    return;
  }

  const skala = P.bredde / O_KOL.reduce((a, k) => a + k.b, 0);
  const x = []; let løpende = P.x;
  O_KOL.forEach((k, i) => { x[i] = løpende; løpende += k.b * skala; });
  const slutt = (i) => x[i] + O_KOL[i].b * skala;

  const hode = () => {
    d.setFontSize(6.5); hex(d, GRÅ); d.setFont(undefined, "bold");
    // 2 mm luft etter hver høyrestilt kolonne. Uten den kolliderte «ANTALL» og
    // «ENHET» til «ANTALLENHET», og verdiene ble «120m».
    O_KOL.forEach((k, i) => d.text(t(k.tittel).toUpperCase(),
      k.h === "right" ? slutt(i) - 2 : x[i], P.y, { align: k.h === "right" ? "right" : "left" }));
    d.setFont(undefined, "normal");
    P.y += 1.6;
    hex(d, STREK, "strek"); d.setLineWidth(0.4);
    d.line(P.x, P.y, P.x + P.bredde, P.y);
    P.y += 1;                     // bandets topp; grunnlinja kommer 3,2 mm ned
  };
  hode();

  // Hver rad er et BÅND: P.y er bandets topp, grunnlinja ligger 3,2 mm ned, og
  // skillestreken tegnes nøyaktig i bunnen. Første utgave flyttet P.y først og
  // tegnet streken etterpå — da landet den 1,4 mm over neste rads grunnlinje,
  // altså tvers gjennom teksten.
  const OVER = 3.2, LINJEHOYDE = 3.6, UNDER = 2.6;

  f.ordre.rader.forEach(r => {
    const navn = bryt(d, r.produkt || "—", O_KOL[0].b * skala - 2);
    const h = OVER + (navn.length - 1) * LINJEHOYDE + UNDER;
    if (!P.plass(h + 3)) { P.nySide(); hode(); }
    d.setFontSize(8); hex(d, SORT);
    navn.forEach((l, i) => d.text(l, x[0], P.y + OVER + i * LINJEHOYDE));
    const verdier = [null, String(r.antall), r.enhet, kr(r.enhetspris), kr(r.eksMva), kr(r.mvaBelop), kr(r.inklMva)];
    O_KOL.forEach((k, i) => {
      if (i === 0) return;
      d.text(verdier[i], k.h === "right" ? slutt(i) - 2 : x[i], P.y + OVER,
        { align: k.h === "right" ? "right" : "left" });
    });
    P.y += h;
    hex(d, STREK, "strek"); d.setLineWidth(0.15);
    d.line(P.x, P.y, P.x + P.bredde, P.y);
  });

  P.sørgFor(18);
  P.y += 5;
  const s = f.ordre.sum;
  const rad = (etikett, verdi, fet) => {
    d.setFont(undefined, fet ? "bold" : "normal");
    d.setFontSize(fet ? 9.5 : 8);
    hex(d, fet ? SORT : GRÅ);
    d.text(etikett, slutt(5) - 2, P.y, { align: "right" });
    hex(d, SORT);
    d.text(verdi + " NOK", slutt(6) - 2, P.y, { align: "right" });
    P.y += fet ? 5.5 : 4.2;
  };
  rad(t("Total (eks. mva)"), kr(s.eksMva), false);
  rad(t("MVA"), kr(s.mvaBelop), false);
  rad(t("Total (inkl. mva)"), kr(s.inklMva), true);
  d.setFont(undefined, "normal");
  P.y += 1;
  hex(d, STREK, "strek"); d.setLineWidth(0.2);
  d.line(P.x, P.y, P.x + P.bredde, P.y);
  P.y += 4;
}

function signaturblokk(P) {
  const { d, m } = P;
  if (!m.laast) return;                 // utkast er allerede merket i toppen
  P.sørgFor(m.signatur ? 42 : 24);
  P.y += 2;
  overskrift(P, t("Signert"), m.signatur ? "" : t("– signatur ikke påkrevd for dette skjemaet"));
  P.y += 1;
  if (m.signatur) {
    // Signaturen tegnes på hvit bunn med ramme, som en signaturlinje på papir.
    hex(d, "#ffffff", "fyll"); hex(d, STREK, "strek"); d.setLineWidth(0.2);
    d.roundedRect(P.x, P.y, 62, 21, 1.5, 1.5, "FD");
    try { d.addImage(m.signatur, "PNG", P.x + 2, P.y + 1.5, 58, 18); } catch (_) {}
    P.y += 23;
  }
  hex(d, SORT, "strek"); d.setLineWidth(0.3);
  d.line(P.x, P.y, P.x + 62, P.y);
  P.y += 4;
  d.setFontSize(9); hex(d, SORT); d.setFont(undefined, "bold");
  d.text(m.signertAv, P.x, P.y);
  d.setFont(undefined, "normal"); d.setFontSize(8); hex(d, GRÅ);
  if (m.signertTid) d.text(m.signertTid, P.x, P.y + 4);
  P.y += 8;
}

export function tegn(jsPDF, m, logo) {
  const P = papir(jsPDF, m);
  P.logo = logo || null;
  P.start();
  m.seksjoner.forEach(s => {
    // Overskriften skal ALDRI bli stående alene nederst på en side. «ANNET» sto
    // på side 1 og 3.1 på side 2 i den første ekte PDF-en.
    P.sørgFor(26);
    overskrift(P, s.tittel);
    s.felt.forEach(f => (f.type === "ordrelinjer" ? ordreTabell(P, f) : feltBlokk(P, f)));
    P.y += 2;
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
