// 🎨 UTSEENDE PDF — farger og selskaper i alle PDF-er (bygget 26.10.2026).
//
// Emil 26.10: malen («Arbeidstider Storm Gruppen») skal kunne brukes av hvem
// som helst. Logoen styres allerede av logo-systemet; det som manglet var
// FARGENE og SELSKAPENE i bunnteksten. Begge settes i Innstillinger →
// Utseende PDF (js/pdf-utseende-ui.js) og leses HER av hver PDF-modul rett
// før den tegner.
//
// Gjelder: statusrapport (rapport.js), sjekklister/skjema (skjema-pdf.js),
// støpeplan (stopeplan-pdf.js), riggplan (riggplan.js), framdriftsplan
// (framdrift-pdf.js). Gjelder IKKE konstruksjonstegninger fra Blikk, TRP og
// SW-generator (sw-tegning.js) — det er Emils eget unntak.
//
// Standard = slik PDF-ene så ut før (Storms rød/svart/grå/hvit). Statusfarger
// (Åpen/Pågår/Løst), fristfarger og nødnummer-fargene i riggplanen er IKKE
// profilfarger — de betyr noe og står fast.
import { S } from "./state.js";

// Rollene i den rekkefølgen de vises i menyen. Navnet er det brukeren ser.
export const PDF_ROLLER = [
  { k: "hoved",      navn: "Hovedfarge",      hjelp: "streker, kanter, uthevet firmanavn" },
  { k: "overskrift", navn: "Overskrift",      hjelp: "røde ord og overskrifter i teksten" },
  { k: "tekst",      navn: "Tekst",           hjelp: "brødtekst og titler" },
  { k: "hjelpetekst",navn: "Hjelpetekst",     hjelp: "små grå tekster" },
  { k: "linjer",     navn: "Linjer",          hjelp: "rammer og tabellstreker" },
  { k: "bokser",     navn: "Bokser",          hjelp: "bakgrunn i faktabokser" },
  { k: "lys",        navn: "Lys markering",   hjelp: "fremhevede rader og felt" },
  { k: "tabellhode", navn: "Tabellhode",      hjelp: "bakgrunn i tabelltopp" },
  { k: "paFarge",    navn: "Tekst på farge",  hjelp: "tekst i tabelltopp" }
];

export const PDF_STANDARD = Object.freeze({
  hoved: "#d22b34", overskrift: "#a8232b", tekst: "#14161a", hjelpetekst: "#6b7280",
  linjer: "#dcdfe4", bokser: "#f4f5f7", lys: "#fdf3f3", tabellhode: "#14161a", paFarge: "#ffffff"
});

// Navn (svart) · uthevet del (hovedfarge) · etterledd (grå) — som i malen:
// «Storm Entreprenør AS · Storm Betong AS · Storm Stål AS».
export const STANDARD_SELSKAPER = Object.freeze([
  { navn: "Storm", uthevet: "Entreprenør", etterledd: "AS" },
  { navn: "Storm", uthevet: "Betong", etterledd: "AS" },
  { navn: "Storm", uthevet: "Stål", etterledd: "AS" }
]);
export const MAKS_SELSKAPER = 6;
const MAKS_FELT = 40;

export function vaskHex(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : "";
}

const feltVask = (v) => String(v == null ? "" : v).replace(/[\x00-\x1f]/g, "").trim().slice(0, MAKS_FELT);

// Alt som kommer inn (innstillinger, SharePoint) vaskes: ukjente roller
// kastes, ugyldige farger blir standard, selskaper uten tekst forsvinner.
export function vaskUtseende(o) {
  const inn = o && typeof o === "object" ? o : {};
  const farger = {};
  for (const r of PDF_ROLLER) farger[r.k] = vaskHex(inn.farger && inn.farger[r.k]) || PDF_STANDARD[r.k];
  const selskaper = Array.isArray(inn.selskaper)
    ? inn.selskaper.filter(x => x && typeof x === "object")
        .map(x => ({ navn: feltVask(x.navn), uthevet: feltVask(x.uthevet), etterledd: feltVask(x.etterledd) }))
        .filter(x => x.navn || x.uthevet || x.etterledd).slice(0, MAKS_SELSKAPER)
    : STANDARD_SELSKAPER.map(x => Object.assign({}, x));
  const ut = { farger, selskaper };
  if (inn.kildeId) ut.kildeId = feltVask(inn.kildeId);
  if (inn.kildeNavn) ut.kildeNavn = feltVask(inn.kildeNavn);
  return ut;
}

export function standardUtseende() { return vaskUtseende({}); }

// Det som gjelder NÅ (Innstillinger → Utseende PDF), alltid vasket.
export function pdfUtseende() { return vaskUtseende(S.settings && S.settings.pdfUtseende); }
export function pdfFarger() { return pdfUtseende().farger; }

export function erStandard(u) {
  const a = vaskUtseende(u), b = standardUtseende();
  return JSON.stringify(a.farger) === JSON.stringify(b.farger) &&
         JSON.stringify(a.selskaper) === JSON.stringify(b.selskaper);
}
export function likeUtseender(a, b) {
  const x = vaskUtseende(a), y = vaskUtseende(b);
  return JSON.stringify(x.farger) === JSON.stringify(y.farger) &&
         JSON.stringify(x.selskaper) === JSON.stringify(y.selskaper);
}

// a → b med andel t (0 = a, 1 = b). Brukes for lyse kanter rundt de lyse
// markeringene, så de følger hovedfargen i stedet for å stå røde igjen.
export function bland(a, b, t) {
  const p = (h) => { const n = parseInt(vaskHex(h).slice(1) || "000000", 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b), k = Math.max(0, Math.min(1, Number(t) || 0));
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
}
export const lysKant = (F) => bland((F || PDF_STANDARD).hoved, "#ffffff", 0.78);

// «Storm Entreprenør AS · Storm Betong AS · Storm Stål AS» som ren tekst
// (til filnavn, Excel og steder der det ikke tegnes i farger).
export function selskapTekst(selskaper) {
  return (selskaper || []).map(x => [x.navn, x.uthevet, x.etterledd].filter(Boolean).join(" ")).join(" · ");
}

// ---------- jsPDF ----------
function rgb(h) { const n = parseInt(vaskHex(h).slice(1) || "000000", 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

// Delene som skal tegnes, med farge og vekt — ren, så den kan testes.
export function selskapDeler(selskaper, F) {
  const f = F || PDF_STANDARD, ut = [];
  (selskaper || []).forEach((x, i) => {
    if (i) ut.push({ tekst: "  ·  ", farge: f.hoved, fet: true });
    if (x.navn) ut.push({ tekst: x.navn + (x.uthevet || x.etterledd ? " " : ""), farge: f.tekst, fet: true });
    if (x.uthevet) ut.push({ tekst: x.uthevet + (x.etterledd ? " " : ""), farge: f.hoved, fet: true });
    if (x.etterledd) ut.push({ tekst: x.etterledd, farge: f.hjelpetekst, fet: false, liten: true });
  });
  return ut;
}

// Tegner selskapslinja. o = { align: "left"|"right", str (pt), maksB (mm) }.
// Krymper skrifta hvis lista er for lang for plassen. Svarer med bredden.
export function tegnSelskaper(d, x, y, o) {
  const opt = o || {};
  const u = opt.utseende ? vaskUtseende(opt.utseende) : pdfUtseende();
  const deler = selskapDeler(u.selskaper, u.farger);
  if (!deler.length) return 0;
  let str = Number(opt.str) || 7.5;
  const maal = () => deler.reduce((s, p) => {
    d.setFont(undefined, p.fet ? "bold" : "normal"); d.setFontSize(p.liten ? str * 0.82 : str);
    return s + d.getTextWidth(p.tekst);
  }, 0);
  let b = maal();
  if (opt.maksB && b > opt.maksB) { str = Math.max(4.5, str * opt.maksB / b); b = maal(); }
  let cx = opt.align === "right" ? x - b : x;
  for (const p of deler) {
    d.setFont(undefined, p.fet ? "bold" : "normal"); d.setFontSize(p.liten ? str * 0.82 : str);
    d.setTextColor(...rgb(p.farge));
    d.text(p.tekst, cx, y);
    cx += d.getTextWidth(p.tekst);
  }
  d.setFont(undefined, "normal"); d.setFontSize(str);
  return b;
}

// Hver PDF hadde sine egne, litt ulike nyanser (riggplanen tegnet linjer i
// #c9ced6, rapporten i #dcdfe4; rapporten streket i mørk rød, malen i lys).
// Står rollen på standard, beholder PDF-en sin EGEN gamle nyanse — da ser
// ingen PDF annerledes ut før noen faktisk har endret noe. Er rollen endret,
// gjelder den nye fargen overalt.
export function profilFarge(F, rolle, lokal) {
  const f = (F || PDF_STANDARD)[rolle];
  return f && f !== PDF_STANDARD[rolle] ? f : (lokal || PDF_STANDARD[rolle]);
}

// ---------- Bunnteksten: én eller to linjer ----------
// Emil 26.10: med 4+ selskaper krøp selskapslinja inn i «Side 1 av 2 ·
// modell · dato» til høyre. Teksten skal IKKE flyttes inn i sideinnholdet
// (da skyves alt nedover og over på nye sider). Løsningen er å bruke plassen
// UNDER streken, som er tom uansett:
//   • får alt plass på én linje → som før;
//   • ellers → selskapene alene på linje 1 (over hele bredden, krympes om
//     nødvendig), og hale (prosjekt, «utkast» …) + høyreteksten på linje 2.
// Innholdsområdet (bunnGrense) er det samme i begge tilfeller.
export const BUNN_LINJEAVSTAND = 3.6;   // mm mellom linje 1 og 2

// Ren beslutning, så den kan testes: får alt plass på én linje?
export function bunnPaaEnLinje(bSelskaper, bHale, bHoyre, bredde, luft) {
  return bSelskaper + bHale + bHoyre + (luft == null ? 6 : luft) <= bredde;
}

// o = { x, y, bredde, hale, hoyre, str, grå, tekstIstedet }
//   hale        tekst etter selskapene (grå), f.eks. «20653 · møteutgave»
//   hoyre       tekst til høyre — BARE til måling (sidetallet tegnes senere,
//               når antall sider er kjent); bruk svaret .hoyreY til det
//   tekstIstedet  vanlig grå tekst i stedet for selskapene (skjemaets avsender)
// Svar: { toLinjer, hoyreY }
export function tegnBunntekst(d, o) {
  const str = Number(o.str) || 7.5, grå = o.grå || PDF_STANDARD.hjelpetekst;
  const u = pdfUtseende();
  const gråTekst = (s, x, y) => { d.setFont(undefined, "normal"); d.setFontSize(str); d.setTextColor(...rgb(grå)); d.text(s, x, y); };
  const mål = (s) => { d.setFont(undefined, "normal"); d.setFontSize(str); return d.getTextWidth(s || ""); };
  // Bredden selskapene tar i full størrelse
  const bSel = o.tekstIstedet ? mål(o.tekstIstedet)
    : selskapDeler(u.selskaper, u.farger).reduce((s, p) => {
        d.setFont(undefined, p.fet ? "bold" : "normal"); d.setFontSize(p.liten ? str * 0.82 : str);
        return s + d.getTextWidth(p.tekst);
      }, 0);
  const hale = o.hale ? (bSel ? " · " : "") + o.hale : "";
  const enLinje = bunnPaaEnLinje(bSel, mål(hale), mål(o.hoyre), o.bredde);
  const venstre = (y, maksB) => o.tekstIstedet
    ? (gråTekst(o.tekstIstedet, o.x, y), bSel)
    : tegnSelskaper(d, o.x, y, { str, maksB, utseende: u });
  if (enLinje) {
    const b = venstre(o.y, o.bredde);
    if (hale) gråTekst(hale, o.x + b, o.y);
    return { toLinjer: false, hoyreY: o.y };
  }
  venstre(o.y, o.bredde);
  const y2 = o.y + BUNN_LINJEAVSTAND;
  if (o.hale) gråTekst(o.hale, o.x, y2);
  return { toLinjer: true, hoyreY: y2 };
}

// ═════════ 📐 Felles oppsett (Emils valg A 26.10: malen på alle fem) ═════════
// Topp:  logo øverst til venstre · infolinjer til høyre · strek i hovedfarge ·
//        kicker (dokumenttypen, hovedfarge, sperret) · stor tittel · undertittel
// Bunn:  strek i hovedfarge · liten logo til venstre · selskapene til høyre (linje 1)
//        · hale til venstre og sidetall til høyre (linje 2)
// Samme hjelpere brukes av rapport.js, skjema-pdf.js, stopeplan-pdf.js,
// riggplan.js (toppbaand) og framdrift-pdf.js — så alle fem ser like ut.
function logoMaal(logo, maksB, maksH) {
  const b0 = Number(logo && logo.b) || maksB, h0 = Number(logo && logo.h) || maksH;
  const f = Math.min(maksB / b0, maksH / h0);
  return { b: b0 * f, h: h0 * f };
}
function tegnLogo(d, logo, x, y, maksB, maksH) {
  if (!logo || !logo.data) return null;
  const m = logoMaal(logo, maksB, maksH);
  try { d.addImage(logo.data, logo.format || "PNG", x, y, m.b, m.h); } catch (_) { return null; }
  return m;
}

// o = { x, y, bredde, logo, logoB, logoH, meta: [{ tekst, fet }], kicker,
//       tittel, under, tittelStr }  →  y der innholdet kan starte
export function malTopp(d, o) {
  const u = pdfUtseende(), F = u.farger;
  const lb = o.logoB || 42, lh = o.logoH || 16;
  let hLogo = 0;
  const m = tegnLogo(d, o.logo, o.x, o.y - 2, lb, lh);
  if (m) hLogo = m.h - 2;
  else if (u.selskaper[0] && u.selskaper[0].navn) {
    // Uten logo: første selskaps navn, aldri en gjenskapt logo
    d.setFont(undefined, "bold"); d.setFontSize(16); d.setTextColor(...rgb(F.tekst));
    d.text(String(u.selskaper[0].navn), o.x, o.y + 5); hLogo = 7;
  }
  let my = o.y + 1;
  for (const l of o.meta || []) {
    if (!l || !String(l.tekst || "").trim()) continue;
    d.setFont(undefined, l.fet ? "bold" : "normal"); d.setFontSize(7);
    d.setTextColor(...rgb(l.fet ? F.tekst : F.hjelpetekst));
    d.text(String(l.tekst), o.x + o.bredde, my, { align: "right" });
    my += 3.4;
  }
  let y = Math.max(o.y + hLogo + 3, my);
  d.setDrawColor(...rgb(F.hoved)); d.setLineWidth(0.6);
  d.line(o.x, y, o.x + o.bredde, y);
  y += 6;
  if (o.kicker) {
    d.setFont(undefined, "bold"); d.setFontSize(7); d.setTextColor(...rgb(F.hoved));
    d.text(String(o.kicker).toUpperCase(), o.x, y, { charSpace: 0.7 });
    y += 6.5;
  }
  if (o.tittel) {
    const str = o.tittelStr || 18;
    d.setFont(undefined, "bold"); d.setFontSize(str); d.setTextColor(...rgb(F.tekst));
    d.text(String(o.tittel), o.x, y);
    y += str * 0.22 + 1.5;
  }
  if (o.under) {
    d.setFont(undefined, "normal"); d.setFontSize(9); d.setTextColor(...rgb(F.hjelpetekst));
    d.text(String(o.under), o.x, y + 1.5);
    y += 5;
  }
  d.setFont(undefined, "normal");
  return y + 3;
}

// Høyden malTopp bruker med disse valgene (uten å tegne) — til A3-arkene som
// må vite hvor planen kan starte FØR noe tegnes.
export function malToppHoyde(o) {
  const lh = (o && o.logoH) || 16;
  let y = Math.max(lh + 1, ((o && o.meta) || []).filter(l => l && String(l.tekst || "").trim()).length * 3.4 + 1);
  y += 6;
  if (o && o.kicker) y += 6.5;
  if (o && o.tittel) y += ((o.tittelStr || 18) * 0.22 + 1.5);
  if (o && o.under) y += 5;
  return y + 3;
}

// o = { x, bredde, yStrek, logo, str, hale, hoyreTekst, tekstIstedet }
//  → { hoyreY } (linje 2, der sidetallet står)
export const MAL_BUNN_H = 11;   // fra streken til linje 2
export function malBunn(d, o) {
  const u = pdfUtseende(), F = u.farger, str = Number(o.str) || 7.5;
  d.setDrawColor(...rgb(F.hoved)); d.setLineWidth(0.5);
  d.line(o.x, o.yStrek, o.x + o.bredde, o.yStrek);
  const m = tegnLogo(d, o.logo, o.x, o.yStrek + 1.8, 30, 6.5);
  const lb = m ? m.b : 0;
  const r1 = o.yStrek + 5.2, r2 = r1 + 3.8;
  if (o.tekstIstedet) {
    d.setFont(undefined, "bold"); d.setFontSize(str); d.setTextColor(...rgb(F.tekst));
    d.text(String(o.tekstIstedet), o.x + o.bredde, r1, { align: "right" });
  } else tegnSelskaper(d, o.x + o.bredde, r1, { align: "right", str, maksB: o.bredde - lb - 8, utseende: u });
  d.setFont(undefined, "normal"); d.setFontSize(str * 0.85); d.setTextColor(...rgb(F.hjelpetekst));
  // Halen står til høyre for logoen på linje 2, så den aldri går oppi den
  if (o.hale) d.text(String(o.hale), o.x + (lb ? lb + 4 : 0), r2, { maxWidth: o.bredde * 0.6 - lb });
  if (o.hoyreTekst) d.text(String(o.hoyreTekst), o.x + o.bredde, r2, { align: "right" });
  d.setFontSize(str);
  return { hoyreY: r2 };
}
