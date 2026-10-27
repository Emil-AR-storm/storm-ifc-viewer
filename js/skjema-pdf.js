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
import { alleFelt, kr, linjeSum, ordreBasis, ordreSum, tomtSvar } from "./sjekkliste.js";
import { lysKant, malBunn, malTopp, pdfFarger, profilFarge } from "./pdf-utseende.js";

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

// Minus i beløp: kr() bruker det typografiske minustegnet (U+2212), som
// Helvetica i jsPDF ikke har — det ble til «"40,00» i Emils EM-PDF 26.10.
const krPdf = (n) => tilLatin1(kr(n).replace(/\u00a0/g, " "));   // tusenskillet (hardt mellomrom) må overleve

export function svarTekst(f, verdi) {
  if (tomtSvar(verdi)) return "";
  if (f.type === "dato") return norskDato(verdi);
  if (Array.isArray(verdi)) return tilLatin1(verdi.map(v => "• " + v).join("\n"));
  return tilLatin1(verdi);
}

// Ordrelinjene slik de skal se ut UTAD. Merk hva som IKKE er med.
export function ordreUtad(rader) {
  const liste = (Array.isArray(rader) ? rader : []).filter(r => r && typeof r === "object");
  const sum = ordreSum(liste), basis = ordreBasis(liste);
  return {
    // Profilene (regnestykket per profil) er med vilje IKKE med — de vises bare
    // på skjermen (Emil 26.10). Posten er med: kontraktsparten skal se hvilken
    // post i prislista linja prises etter.
    rader: liste.map(r => {
      const l = linjeSum(r, basis);
      return {
        // «(mangler pris)» fra eldre EM-utkast fjernes når prisen er fylt inn
        // Påslag i % (Emil 27.10): «3 % av 16 551,80» i teksten og «—» som
        // enhetspris — 1 % av grunnlaget som «pris» ble lest som en pris
        produkt: tilLatin1(String(r.enhet).trim() === "%" ? String(r.produkt || "") + " (" + (Number(r.antall) || 0).toString().replace(".", ",") + " % av " + kr(basis).replace(/\u00a0/g, " ") + ")"
          : l.salgsEnhetspris > 0 ? String(r.produkt || "").replace(/\s*\(mangler pris\)\s*$/, "") : r.produkt),
        post: tilLatin1(r.post || ""),
        antall: Number(r.antall) || 0,
        enhet: tilLatin1(r.enhet),
        enhetspris: String(r.enhet).trim() === "%" ? null : l.salgsEnhetspris,   // SALGSPRIS, ikke kostpris
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
    // 📝 EM fra modellen: «EM-12 · tittel» i stedet for «Markering: …»
    referanse: tilLatin1(o.referanse),
    iDag: String(o.iDag || ""),
    versjon: Number(skjema.versjon) || 1,
    erstatter: skjema.erstatter || null,
    laast: skjema.laast === true,
    // 🚦 Påkrevde felt som står tomme (EM runde 2, B6): utkastet merkes
    // «UTKAST – IKKE SENDEKLAR: … mangler» på HVER side, også bildesidene
    mangler: felt.filter(f => f.pakrevd && tomtSvar(skjema.svar && skjema.svar[f.id])).map(f => tilLatin1(kortFelt(f.navn || f.id))),
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

// «Hjemmel (punkt i kontrakten)» → «Hjemmel» — stempelet skal være kort
const kortFelt = (n) => String(n || "").replace(/\s*\(.*\)\s*$/, "").split(" / ")[0].trim();
export function stempelTekst(m) {
  if (!m || m.laast || !(m.mangler || []).length) return "";
  const l = m.mangler.slice(0, 4).map(x => x.toLowerCase());
  return t("UTKAST – IKKE SENDEKLAR: {0} mangler", l.join(", ") + (m.mangler.length > 4 ? " …" : ""));
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
// 🎨 Farger fra Innstillinger → Utseende PDF (js/pdf-utseende.js, 26.10.2026).
// «let», ikke «const»: brukProfil() fyller dem inn rett før hver tegning, så
// en endring i innstillingene gjelder neste PDF uten omlasting.
let GRÅ = "#6b7280", STREK = "#dcdfe4", ROD = "#a8232b", SORT = "#14161a";
let HOVED = "#d22b34", LYS = "#fdf3f3", LYSKANT = "#f0cfcf", BOKS = "#f4f5f7";
function brukProfil() {
  const F = pdfFarger();
  GRÅ = F.hjelpetekst; STREK = F.linjer; ROD = F.overskrift; SORT = F.tekst;
  // Standard = PDF-ens egne gamle nyanser (se profilFarge): streken var mørk rød her.
  HOVED = profilFarge(F, "hoved", "#a8232b"); LYS = F.lys;
  LYSKANT = profilFarge(F, "hoved", "") === "#a8232b" ? "#f0cfcf" : lysKant(F);
  BOKS = profilFarge(F, "bokser", "#f4f5f7");
}

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
    if (!P.bunnFerdig) bunnlinje(P);
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      // Bildesidene til EM-en er LIGGENDE (em-pdf.js): sidetallet står da på
      // samme avstand fra den nederste kanten av den sida, ikke av A4 stående.
      const ps = d.internal && d.internal.pageSize;
      const sb = ps && ps.getWidth ? ps.getWidth() : A4.b, sh = ps && ps.getHeight ? ps.getHeight() : A4.h;
      d.setFontSize(7.5); hex(d, GRÅ);
      d.text(t("Side {0} av {1}", i, n) + (m.prosjekt ? " · " + m.prosjekt : "") +
        " · " + norskDato(m.iDag), sb - A4.marg, (P.hoyreY || A4.h - A4.marg + 1) - A4.h + sh, { align: "right" });
    }
  };
  return P;
}

function topplinje(P, forste) {
  const { d, m } = P;
  // 📐 Felles oppsett (Emils valg A 26.10): malen. Avsenderen står FØRST og i
  // halvfet i infolinjene til høyre — dette er et varsel til en kontraktspart,
  // og hvem det kommer fra er ikke en fotnote. Sidene etter forsiden har som i
  // malen ingen topp.
  if (forste) {
    const a = m.avsender || {};
    P.y = malTopp(d, {
      x: A4.marg, y: A4.marg, bredde: P.bredde, logo: P.logo,
      meta: [
        a.navn ? { tekst: a.navn, fet: true } : null,
        a.orgnr ? { tekst: t("Org.nr. {0}", a.orgnr) } : null,
        a.adresse ? { tekst: a.adresse } : null,
        a.sted ? { tekst: a.sted } : null,
        m.markering ? { tekst: t("Markering: {0}", m.markering) } : null,
        m.referanse ? { tekst: m.referanse } : null,
        m.erstatter ? { tekst: t("Erstatter versjon {0}", m.erstatter) } : null
      ],
      kicker: m.prosjekt ? t("Prosjekt {0}", m.prosjekt) : t("Skjema"),
      tittel: m.tittel,
      tittelStr: 16,
      under: m.versjon > 1 ? t("Versjon {0}", m.versjon) : ""
    });
  } else P.y = A4.marg + 2;

  // UTKAST-båndet står på HVER side. Ett bånd bare på forsiden ville forsvunnet
  // i det noen skriver ut side 2 og legger den ved en e-post — samme grunn som
  // møteutgaven i statusrapporten.
  if (!m.laast) {
    const h = forste ? 11 : 7;
    hex(d, LYS, "fyll"); hex(d, LYSKANT, "strek"); d.setLineWidth(0.2);
    d.roundedRect(A4.marg, P.y, P.bredde, h, 1.5, 1.5, "FD");
    hex(d, HOVED, "fyll"); d.rect(A4.marg, P.y, 1.2, h, "F");
    hex(d, ROD); d.setFontSize(8); d.setFont(undefined, "bold");
    d.text(tilLatin1(stempelTekst(m) || t("Utkast – ikke fullført og ikke signert.")), A4.marg + 4, P.y + 4.6);
    d.setFont(undefined, "normal"); hex(d, SORT);
    if (forste) d.text(t("Skjemaet kan fortsatt endres. Det er ikke et avsendt varsel."), A4.marg + 4, P.y + 8.4);
    P.y += h + 5;
  }
}

function bunnlinje(P) {
  const { d, m } = P;
  // 📐 Felles bunn (malen): logo til venstre, avsender (fra malen) eller
  // selskapene til høyre, sidetallet på linja under (tegnes i P.slutt).
  const L = malBunn(d, { x: A4.marg, bredde: P.bredde, yStrek: A4.h - A4.marg - 4, logo: P.logo, str: 7.5,
    tekstIstedet: m.avsender && m.avsender.navn ? tilLatin1(m.avsender.navn) : "",
    hale: m.laast ? "" : t("utkast") });
  P.hoyreY = L.hoyreY;
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
const O_KOL_STD = [
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

  // 🧾 «Post»-kolonnen bare når minst én linje har post (runde 3)
  const medPost = f.ordre.rader.some(r => r.post);
  const O_KOL = medPost ? [{ n: "post", tittel: "Post", b: 14, h: "left" }].concat(O_KOL_STD) : O_KOL_STD;
  const P0 = medPost ? 1 : 0;
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
    const navn = bryt(d, r.produkt || "—", O_KOL[P0].b * skala - 2);
    const h = OVER + (navn.length - 1) * LINJEHOYDE + UNDER;
    if (!P.plass(h + 3)) { P.nySide(); hode(); }
    d.setFontSize(8); hex(d, SORT);
    navn.forEach((l, i) => d.text(l, x[P0], P.y + OVER + i * LINJEHOYDE));
    const verdier = (medPost ? [r.post || "—"] : []).concat([null, tilLatin1(String(r.antall)), r.enhet, r.enhetspris == null ? "—" : krPdf(r.enhetspris), krPdf(r.eksMva), krPdf(r.mvaBelop), krPdf(r.inklMva)]);
    O_KOL.forEach((k, i) => {
      if (i === P0) return;
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
    d.text(etikett, slutt(5 + P0) - 2, P.y, { align: "right" });
    hex(d, SORT);
    d.text(verdi + " NOK", slutt(6 + P0) - 2, P.y, { align: "right" });
    P.y += fet ? 5.5 : 4.2;
  };
  rad(t("Total (eks. mva)"), krPdf(s.eksMva), false);
  rad(t("MVA"), krPdf(s.mvaBelop), false);
  rad(t("Total (inkl. mva)"), krPdf(s.inklMva), true);
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

// ekstra(d, { logo, m }): tegner egne sider ETTER skjemaet og FØR sidetallene
// (EM-ens bildesider, em-pdf.js). Synkron — bildene er hentet på forhånd.
export function tegn(jsPDF, m, logo, ekstra) {
  brukProfil();
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
  if (typeof ekstra === "function") {
    bunnlinje(P); P.bunnFerdig = true;
    const forsteEkstra = P.d.getNumberOfPages() + 1;
    ekstra(P.d, { logo: P.logo, m });
    // Stempelet også på bildesidene — en side kan skrives ut og sendes alene
    const st = stempelTekst(m);
    if (st) for (let i = forsteEkstra; i <= P.d.getNumberOfPages(); i++) {
      P.d.setPage(i);
      const ps = P.d.internal && P.d.internal.pageSize, sb = ps && ps.getWidth ? ps.getWidth() : A4.b;
      P.d.setFontSize(7); P.d.setFont(undefined, "bold"); hex(P.d, ROD);
      P.d.text(tilLatin1(st), sb / 2, 9, { align: "center" });
      P.d.setFont(undefined, "normal");
    }
  }
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
  const ekstra = typeof opts.ekstraSider === "function" ? await opts.ekstraSider() : null;
  const d = tegn(jsPDF, m, logo, ekstra);
  lastNedFil(d.output("blob"), filnavn(m));
  return filnavn(m);
}
