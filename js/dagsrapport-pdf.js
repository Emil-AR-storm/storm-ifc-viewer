// 📄 DAGSRAPPORT-PDF (Emil 27.10.2026, prøvebilde C).
//
// To utgaver fra samme tegnekode:
//   • én dag  — én A4-side (flere hvis teksten eller bildene krever det);
//   • én uke  — en FORSIDE med uka i tall, dag for dag og avvik i uka, og så
//               hver dagsrapport etter tur, hver på ny side.
//
// Samme felles oppsett som de andre PDF-ene (malTopp/malBunn i
// pdf-utseende.js): logo, infolinjer, strek, kicker og tittel øverst,
// selskapene og sidetallet nederst. Farger fra Innstillinger → Utseende PDF.
//
// Synkron: logo og bilder er hentet på forhånd (data-URL-er). Ingen DOM og
// ingen S — testen tegner med ekte jsPDF i Node.
import { t } from "./i18n.js";
import { malBunn, malTopp, pdfFarger } from "./pdf-utseende.js";
import { tilLatin1 } from "./skjema-pdf.js";
import { bemanningSum, dagOgDato, vaerMerker, vaerTekst } from "./dagsrapport-regn.js";
import { datoLang } from "./vaer-regn.js";

const A4 = { b: 210, h: 297, marg: 15 };
const rgb = (h) => { const n = parseInt(String(h || "#000000").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const L = (s) => tilLatin1(s);
const STATUS_FARGE = { "Åpen": "#f59e0b", "Pågår": "#3b82f6", "Løst": "#3cb44b" };
const MERKE = { rod: { tekst: "#a01c1c", kant: "#f0c2c2", flate: "#fef5f5" },
  gul: { tekst: "#7a5c00", kant: "#e7d68a", flate: "#fdfaeb" }, ok: { tekst: "#166534", kant: "#bfe3c8", flate: "#f2fbf4" } };
const BILDE_NAVN = { sol: "Sol", delvis: "Lettskyet", sky: "Overskyet", taake: "Tåke", regn: "Regn", sludd: "Sludd", sno: "Snø", storm: "Storm", ukjent: "" };
const KILDE_NAVN = { maalt: "målt (Frost, Meteorologisk institutt)", varslet: "varslet (MET)", varsel: "varsel (MET)" };

// ---------- Papiret ----------
function papir(jsPDF, o) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const F = pdfFarger();
  const P = { d, F, o, y: A4.marg, x: A4.marg, bredde: A4.b - A4.marg * 2, bunnGrense: A4.h - A4.marg - 9, forsteSide: true, hale: "" };
  P.bunn = () => { const r = malBunn(d, { x: A4.marg, bredde: P.bredde, yStrek: A4.h - A4.marg - 4, logo: o.logo, str: 7.5, hale: P.hale }); P.hoyreY = r.hoyreY; };
  // Ny side. Den første siden finnes allerede i et nytt jsPDF-dokument.
  P.side = () => {
    if (!P.forsteSide) { P.bunn(); d.addPage(); }
    P.forsteSide = false;
    P.y = A4.marg;
  };
  P.fortsett = () => { P.bunn(); d.addPage(); P.y = A4.marg + 2; if (P.banner) P.banner(); };
  P.sorgFor = (h) => { if (P.y + h > P.bunnGrense) P.fortsett(); };
  P.slutt = () => {
    P.bunn();
    const n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      d.setFont(undefined, "normal"); d.setFontSize(6.4); d.setTextColor(...rgb(F.hjelpetekst));
      d.text(L(t("Side {0} av {1}", i, n)), A4.b - A4.marg, P.hoyreY || A4.h - A4.marg + 1, { align: "right" });
    }
  };
  return P;
}

function overskrift(P, tekst, tillegg) {
  P.sorgFor(14);
  const { d, F } = P;
  d.setFont(undefined, "bold"); d.setFontSize(8.5); d.setTextColor(...rgb(F.overskrift));
  const s = L(String(tekst).toUpperCase());
  d.text(s, P.x, P.y, { charSpace: 0.3 });
  // charSpace kommer i tillegg til bredden getTextWidth måler
  const b = d.getTextWidth(s) + s.length * 0.3;
  if (tillegg) {
    d.setFont(undefined, "normal"); d.setFontSize(7.5); d.setTextColor(...rgb(F.hjelpetekst));
    d.text(L(tillegg), P.x + b + 3, P.y);
  }
  d.setDrawColor(...rgb(F.linjer)); d.setLineWidth(0.25);
  d.line(P.x, P.y + 1.6, P.x + P.bredde, P.y + 1.6);
  P.y += 6;
}

function avsnitt(P, tekst, tom) {
  const { d, F } = P;
  const s = String(tekst || "").trim();
  d.setFont(undefined, s ? "normal" : "italic"); d.setFontSize(9); d.setTextColor(...rgb(s ? F.tekst : F.hjelpetekst));
  const linjer = d.splitTextToSize(L(s || tom), P.bredde);
  for (const l of linjer) { P.sorgFor(5); d.text(l, P.x, P.y); P.y += 4.3; }
  d.setFont(undefined, "normal");
  P.y += 3;
}

function ruter(P, celler) {
  const { d, F } = P;
  const n = celler.length, mellom = 2.5, b = (P.bredde - mellom * (n - 1)) / n;
  P.sorgFor(17);
  celler.forEach((c, i) => {
    const x = P.x + i * (b + mellom);
    d.setFillColor(255, 255, 255); d.setDrawColor(...rgb(F.linjer)); d.setLineWidth(0.25);
    d.roundedRect(x, P.y, b, 14, 1.5, 1.5, "FD");
    d.setFont(undefined, "normal"); d.setFontSize(6.8); d.setTextColor(...rgb(F.hjelpetekst));
    d.text(L(c.tekst), x + 2.5, P.y + 4.2);
    d.setFont(undefined, "bold"); d.setFontSize(c.liten ? 9.5 : 12); d.setTextColor(...rgb(c.farge || F.tekst));
    d.text(L(c.tall), x + 2.5, P.y + 10.6, { maxWidth: b - 4 });
  });
  d.setFont(undefined, "normal");
  P.y += 18;
}

// Tabell: kol = [{ t, b (andel), h (høyrejustert) }], rader = [[celler]], sum = [celler]|null
function tabell(P, kol, rader, sum) {
  const { d, F } = P;
  const bredder = kol.map(k => k.b * P.bredde);
  const hode = () => {
    P.sorgFor(12);
    d.setFillColor(...rgb(F.bokser)); d.rect(P.x, P.y - 3.6, P.bredde, 5.4, "F");
    d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(...rgb(F.hjelpetekst));
    let x = P.x;
    kol.forEach((k, i) => { d.text(L(k.t).toUpperCase(), k.h ? x + bredder[i] - 1.5 : x + 1.5, P.y, k.h ? { align: "right" } : undefined); x += bredder[i]; });
    P.y += 5;
  };
  hode();
  const rad = (celler, fet) => {
    d.setFont(undefined, fet ? "bold" : "normal"); d.setFontSize(8.5);
    const deler = celler.map((c, i) => d.splitTextToSize(L(c == null ? "" : c), bredder[i] - 3));
    const h = Math.max(1, ...deler.map(x => x.length)) * 3.8 + 1.4;
    if (P.y + h > P.bunnGrense) { P.fortsett(); hode(); }
    let x = P.x;
    deler.forEach((linjer, i) => {
      const k = kol[i];
      d.setTextColor(...rgb((celler[i] && celler[i].farge) || (k.farge && k.farge(celler[i])) || F.tekst));
      linjer.forEach((l, j) => d.text(l, k.h ? x + bredder[i] - 1.5 : x + 1.5, P.y + j * 3.8, k.h ? { align: "right" } : undefined));
      x += bredder[i];
    });
    d.setDrawColor(...rgb(F.linjer)); d.setLineWidth(0.2);
    d.line(P.x, P.y + h - 3.2, P.x + P.bredde, P.y + h - 3.2);
    P.y += h;
  };
  rader.forEach(r => rad(r, false));
  if (sum) rad(sum, true);
  d.setFont(undefined, "normal");
  P.y += 3;
}

function merker(P, liste) {
  const { d } = P;
  let x = P.x;
  d.setFont(undefined, "bold"); d.setFontSize(7.5);
  for (const m of liste) {
    const f = MERKE[m.niva] || MERKE.ok, s = L(t(m.tekst)), b = d.getTextWidth(s) + 5;
    d.setFillColor(...rgb(f.flate)); d.setDrawColor(...rgb(f.kant)); d.setLineWidth(0.3);
    d.roundedRect(x, P.y - 3.4, b, 5, 1.2, 1.2, "FD");
    d.setTextColor(...rgb(f.tekst)); d.text(s, x + 2.5, P.y);
    x += b + 2;
  }
  d.setFont(undefined, "normal");
  P.y += 5;
}

// Bildet inn i en rute uten å strekkes
function bilde(d, data, x, y, b, h) {
  let ib = 4, ih = 3;
  try { const p = d.getImageProperties(data); if (p && p.width) { ib = p.width; ih = p.height; } } catch (_) {}
  const f = Math.min(b / ib, h / ih), w = ib * f, hh = ih * f;
  try { d.addImage(data, "JPEG", x + (b - w) / 2, y + (h - hh) / 2, w, hh); return true; } catch (_) { return false; }
}

// ---------- Én dag ----------
function tegnDagSide(P, r, o) {
  const { d, F } = P;
  P.side();
  P.hale = [r.prosjekt, t("dagsrapport") + " " + datoLang(r.dato)].filter(Boolean).join(" · ");
  const utkast = !r.signert;
  P.banner = utkast ? () => {
    d.setFillColor(...rgb(MERKE.gul.flate)); d.setDrawColor(...rgb(MERKE.gul.kant)); d.setLineWidth(0.3);
    d.roundedRect(P.x, P.y, P.bredde, 7, 1.2, 1.2, "FD");
    d.setFont(undefined, "bold"); d.setFontSize(8); d.setTextColor(...rgb(MERKE.gul.tekst));
    d.text(L(t("UTKAST – ikke signert")), P.x + 3, P.y + 4.7);
    d.setFont(undefined, "normal");
    P.y += 11;
  } : null;
  P.y = malTopp(d, {
    x: A4.marg, y: A4.marg, bredde: P.bredde, logo: o.logo,
    meta: [
      { tekst: L(t("Utskrift fra Storm IFC-Viewer").toUpperCase()), fet: true },
      r.modell ? { tekst: L(t("Modell") + ": " + r.modell) } : null,
      { tekst: L(t("Dagsrapport nr. {0}", o.nrFor ? o.nrFor(r.dato) : 1) + (r.versjon > 1 ? " · " + t("versjon {0}", r.versjon) : "")) }
    ],
    kicker: L(t("Dagsrapport")),
    tittel: L(t(dagOgDato(r.dato).split(" ")[0]) + " " + datoLang(r.dato)),
    under: L([r.prosjekt, r.prosjektNavn].filter(Boolean).join(" ")),
    tittelStr: 17
  });
  if (P.banner) P.banner();

  // Dag og vær
  overskrift(P, t("Dag og vær"), r.vaer && r.vaer.kilde && KILDE_NAVN[r.vaer.kilde] ? "– " + t(KILDE_NAVN[r.vaer.kilde]) : "");
  const v = r.vaer;
  if (v) {
    const gr = (x) => (x < 0 ? "-" : "") + Math.round(Math.abs(x));
    ruter(P, [
      { tekst: t("Temperatur"), tall: v.min != null ? gr(v.min) + " / " + gr(v.maks) + " °C" : "–" },
      { tekst: t("Nedbør"), tall: String(v.regnSum || 0).replace(".", ",") + " mm" },
      { tekst: t("Vind (maks)"), tall: v.maksVind != null ? Math.round(v.maksVind) + " m/s" : "–" },
      { tekst: t("Vær"), tall: t(BILDE_NAVN[v.bilde] || "") || "–", liten: true }
    ]);
    merker(P, vaerMerker(v));
    P.y += 2;
  } else avsnitt(P, "", t("Ingen værdata for denne dagen (posisjon mangler i Prosjektinfo, eller værtjenesten svarte ikke)."));

  // Bemanning
  const sum = bemanningSum(r.bemanning);
  overskrift(P, t("Bemanning"), sum.antall ? "– " + t("{0} personer", sum.antall) : "");
  if (r.bemanning.length) {
    const tall1 = (n) => n == null ? "" : String(n).replace(".", ",");
    tabell(P, [{ t: t("Firma"), b: 0.38 }, { t: t("Fag"), b: 0.32 }, { t: t("Antall"), b: 0.14, h: true }, { t: t("Timer"), b: 0.16, h: true }],
      r.bemanning.map(b => [b.firma, t(b.fag) || b.fag, tall1(b.antall), tall1(b.timer)]),
      [t("Sum"), "", tall1(sum.antall), tall1(sum.timer)]);
  } else avsnitt(P, "", t("Ikke fylt ut."));

  overskrift(P, t("Utført arbeid"));
  avsnitt(P, r.utfort, t("Ikke fylt ut."));
  overskrift(P, t("Hindringer og avvik"));
  avsnitt(P, r.hindringer, t("Ingen."));

  if (r.medMarkeringer) {
    overskrift(P, t("Dagens markeringer"), "– " + t("{0} stk", r.markeringer.length));
    if (r.markeringer.length) {
      tabell(P, [{ t: "#", b: 0.06 }, { t: t("Sak"), b: 0.6 }, { t: t("Hva"), b: 0.18 }, { t: t("Status"), b: 0.16, farge: (c) => STATUS_FARGE[c] }],
        r.markeringer.map((m, i) => [String(i + 1), m.tekst + (m.hva === "svar" && m.svar ? "\n" + t("Svar") + ": " + m.svar : ""),
          m.hva === "ny" ? t("Ny") : t("Nytt svar"), t(m.status)]));
    } else avsnitt(P, "", t("Ingen markeringer ble laget eller besvart denne dagen."));
  }

  // Bilder, to i bredden
  const bilder = (r.bilder || []).map(b => ({ b, data: o.bilder && o.bilder.get(b.fil) })).filter(x => x.data);
  if (bilder.length) {
    overskrift(P, t("Bilder"), "– " + t("{0} stk", bilder.length));
    const mellom = 5, bb = (P.bredde - mellom) / 2, bh = 62;
    for (let i = 0; i < bilder.length; i += 2) {
      P.sorgFor(bh + 9);
      for (let j = 0; j < 2 && i + j < bilder.length; j++) {
        const x = P.x + j * (bb + mellom), it = bilder[i + j];
        d.setDrawColor(...rgb(F.linjer)); d.setLineWidth(0.25); d.setFillColor(250, 250, 251);
        d.rect(x, P.y, bb, bh, "FD");
        bilde(d, it.data, x + 1, P.y + 1, bb - 2, bh - 2);
        d.setFontSize(7.5); d.setTextColor(...rgb(F.hjelpetekst));
        d.text(L((i + j + 1) + ". " + (it.b.tekst || "")), x, P.y + bh + 3.6, { maxWidth: bb });
      }
      P.y += bh + 8;
    }
  }

  // Signert
  P.sorgFor(r.signert && r.signert.signatur ? 36 : 18);
  P.y += 2;
  overskrift(P, t("Signert"));
  if (r.signert) {
    if (r.signert.signatur) {
      d.setFillColor(255, 255, 255); d.setDrawColor(...rgb(F.linjer)); d.setLineWidth(0.2);
      d.roundedRect(P.x, P.y - 1, 62, 20, 1.5, 1.5, "FD");
      try { d.addImage(r.signert.signatur, "PNG", P.x + 2, P.y, 58, 18); } catch (_) {}
      P.y += 22;
    }
    d.setDrawColor(...rgb(F.tekst)); d.setLineWidth(0.3); d.line(P.x, P.y, P.x + 62, P.y);
    d.setFont(undefined, "bold"); d.setFontSize(9); d.setTextColor(...rgb(F.tekst));
    d.text(L(r.signert.navn), P.x, P.y + 4);
    d.setFont(undefined, "normal"); d.setFontSize(7.5); d.setTextColor(...rgb(F.hjelpetekst));
    d.text(L(r.signert.tid || ""), P.x, P.y + 8);
    P.y += 11;
  } else avsnitt(P, "", t("Ikke signert ennå."));
  P.banner = null;
}

// ---------- Forsiden for uka ----------
function tegnUkeForside(P, u, o) {
  const { d, F } = P;
  P.side();
  P.hale = [o.prosjekt, t("dagsrapporter uke {0}", u.uke)].filter(Boolean).join(" · ");
  P.y = malTopp(d, {
    x: A4.marg, y: A4.marg, bredde: P.bredde, logo: o.logo,
    meta: [
      { tekst: L(t("Utskrift fra Storm IFC-Viewer").toUpperCase()), fet: true },
      o.modell ? { tekst: L(t("Modell") + ": " + o.modell) } : null,
      { tekst: L(datoLang(u.mandag) + " – " + datoLang(u.sondag)) }
    ],
    kicker: L(t("Dagsrapporter")),
    tittel: L(t("Uke {0}", u.uke) + " " + u.aar),
    under: L([o.prosjekt, o.prosjektNavn].filter(Boolean).join(" ")),
    tittelStr: 18
  });
  overskrift(P, t("Uka i tall"));
  ruter(P, [
    { tekst: t("Rapporter levert"), tall: u.levert + " / " + Math.max(u.arbeidsdager, u.antall), farge: u.mangler ? "#a01c1c" : null },
    { tekst: t("Mannskap i snitt"), tall: String(u.mannskapSnitt).replace(".", ",") },
    { tekst: t("Timer i sum"), tall: String(u.timerSum).replace(".", ",") },
    { tekst: t("Dager med frost"), tall: String(u.frostDager) }
  ]);
  overskrift(P, t("Dag for dag"));
  tabell(P, [{ t: t("Dag"), b: 0.14 }, { t: t("Vær"), b: 0.17 }, { t: t("Folk"), b: 0.08, h: true }, { t: t("Utført (kort)"), b: 0.49 }, { t: t("Avvik"), b: 0.12, h: true }],
    u.rader.map(x => {
      const dag = t(x.dag).replace(/^./, c => c.toUpperCase()) + " " + x.dato.slice(8) + "." + x.dato.slice(5, 7);
      if (!x.rapport) return [dag, { toString: () => t("Mangler rapport"), farge: "#a01c1c" }, "", "", ""];
      const v = x.rapport.vaer;
      const vt = v && v.min != null ? Math.round(v.min) + "/" + Math.round(v.maks) + " °C" : "–";
      return [dag + (x.rapport.signert ? "" : " *"), vt, String(x.folk || ""), x.kort, String(x.avvik)];
    }));
  if (u.rader.some(x => x.rapport && !x.rapport.signert)) {
    d.setFontSize(7); d.setTextColor(...rgb(F.hjelpetekst));
    d.text(L(t("* utkast – ikke signert")), P.x, P.y - 1); P.y += 3;
  }
  overskrift(P, t("Avvik i uka"));
  if (u.avvik.length) u.avvik.forEach(a => avsnitt(P, t(a.dag).replace(/^./, c => c.toUpperCase()) + " " + datoLang(a.dato) + ": " + a.tekst, ""));
  else avsnitt(P, "", t("Ingen avvik registrert."));
  d.setFontSize(7.5); d.setTextColor(...rgb(F.hjelpetekst));
  P.sorgFor(6);
  d.text(L(t("Deretter følger hver dagsrapport på egen side.")), P.x, P.y);
}

// o = { logo, nrFor(dato), bilder: Map(fil → dataUrl), prosjekt, prosjektNavn, modell, uke: ukeSum|null }
export function tegnDagsrapport(jsPDF, rapporter, o) {
  const opt = o || {};
  const P = papir(jsPDF, opt);
  if (opt.uke) tegnUkeForside(P, opt.uke, opt);
  for (const r of rapporter) tegnDagSide(P, r, opt);
  if (!opt.uke && !rapporter.length) P.side();
  P.slutt();
  return P.d;
}
