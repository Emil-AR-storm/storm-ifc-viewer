// 📐 Instruksjonstegning: de genererte SW-elementene som oppriss på A0, i
// samme format som Moelv SW-01. Lastes DYNAMISK fra veggelement.js — jsPDF er
// 350 kB og skal ikke ligge i oppstarten for de som aldri trykker knappen.
//
// TRE TING SOM STYRER FILA:
//
// 1. ALLE MÅL ER MÅLT PÅ MOELV-TEGNINGA, ikke gjettet. Tallene i MOELV under
//    kommer fra `pdftotext -bbox-layout` (tekstposisjoner) og pikselanalyse av
//    300 dpi-utsnitt (linjer og farger). Endrer du et av dem, endrer du
//    formatet — og da er tegninga ikke lenger lik den Emil sammenligner med.
//
// 2. INGENTING TEGNES FRA MODELLEN PÅ NYTT. Alt kommer fra `lagret` —
//    de samme feltene som veggene tegnes av. Samme lærdom som runde 18:
//    hadde tegninga trengt noe som bare settes i generer(), ville knappen sett
//    død ut for alle som åpner en modell med vegger som alt ligger lagret.
//
// 3. DEN RENE DELEN VET IKKE OM jsPDF. `byggTegningsmodell`, `malkjede`,
//    `velgSkala` og `fordelPaArk` er rene funksjoner, så _test kan regne på
//    målkjedene og sideoppsettet uten en PDF i nærheten.
import { t } from "./i18n.js";
import { hentJsPDF } from "./rapport.js";
import { tilLatin1 } from "./skjema-pdf.js";

// ═══════════════════════ MÅLENE FRA MOELV SW-01 ═══════════════════════

export const MM = 72 / 25.4;                 // 1 mm i punkt = 2,8346

export const ARK = { b: 3369.83, h: 2383.94 };            // A0 liggende
export const RAMME = { x0: 69.8, x1: 3341.5, y0: 28.1, y1: 2355.1 };

// Tittelfeltet nede til høyre. `rader` er de vannrette skillene ovenfra og ned,
// `hoyreRader` skillene i den smale høyre kolonnen.
export const TF = {
  x0: 2941.7, x1: 3341.3,
  rader: [2048.9, 2063.0, 2100.0, 2199.1, 2258.6, 2318.2, 2355.1],
  revX: [2970.0, 3213.6, 3270.5, 3305.8],   // Revisjon | tekst | Dato | Tegnet | Kontrollert
  hoyreX: 3233.3, datoX: 3283.4,
  hoyreRader: [2199.1, 2219.0, 2239.0, 2258.6, 2278.6, 2298.5, 2318.2],
  nrX: 3055.0,                               // skillet foran Løpenummer-cella
  topp: { y0: 1569.8, y1: 1606.8, v1: 3055.0, v2: 3235.0 }
};

export const FARGE = {
  element: [230, 210, 181],   // #E6D2B5 — den lyse okeren i Moelv
  ringmur: [192, 192, 192],   // #C0C0C0
  strek: [0, 0, 0]
};

// Strektykkelser i punkt. Skjøten mellom to elementer i samme rad er TYKK i
// Moelv — det er den streken montøren følger når han setter elementene.
export const STREK = { tynn: 0.5, kjede: 0.5, skjot: 1.8, utsp: 1.4, ramme: 0.9 };

export const SKRIFT = { sw: 10, lengde: 10, kjede: 9, hoyde: 8, niva: 9,
                        tittel: 20, skala: 11, merknad: 8,
                        tfEtikett: 6, tfVerdi: 11, tfStor: 17, tfNr: 20 };

// Standardmålestokker, minst tall først. Moelv bruker 1:50 og 1:60 på samme ark.
export const SKALAER = [20, 25, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500];

// Plassen rundt selve opprisset, i punkt. Måltatt på Moelv: aksesirklene ligger
// ~95 pt over veggen, målkjeden ~25 pt over.
export const PLASS = {
  tittel: 40,      // fasadetittel + målestokk over blokka
  akse: 70,        // aksesirkler + hjelpelinjen
  kjede: 28,       // målkjeden mellom aksene og veggen
  hoydekjede: 46,  // loddrett radhøydekjede ved sida
  niva: 150,       // nivåmarkørene «Gesims ▼ +13.100»
  merknad: 250,    // merknadsteksten til venstre, bare når det finnes en
  luft: 46         // mellom to fasadeblokker
};

export const AKSE_R = 17;    // radius i aksesirkelen

// Fase / Revisjon / Status — måltatt avstand fra tittelfeltets venstrekant.
// Står likt i toppboksen og i nederste rad, derfor én liste.
const FASE_ET = [["Fase", 297.5], ["Revisjon", 330.2], ["Status", 373.7]];

// ═══════════════════════ REN LOGIKK ═══════════════════════

// Aksepunktene: samler feltgrensene fra elementene som er HELE FELT. Bare de
// har basFraMm/basTilMm nøyaktig på søylesenter ± klaringen; en strimmel ved
// siden av en port har grensa si midt i feltet og ville laget en falsk akse.
export function aksepunkter(vegger, fi, klaringMm, tolMm) {
  const tol = tolMm > 0 ? tolMm : 30;
  const kand = [];
  for (const v of vegger || []) {
    if (v.fi !== fi || v.skjult) continue;
    if (v.basFraMm === undefined || v.tilpasset || v.tilpassetRad) continue;
    kand.push(v.basFraMm - klaringMm, v.basTilMm + klaringMm);
  }
  kand.sort((a, b) => a - b);
  const ut = [];
  for (const x of kand) {
    if (ut.length && x - ut[ut.length - 1].sum / ut[ut.length - 1].n <= tol) {
      const g = ut[ut.length - 1]; g.sum += x; g.n++;
    } else ut.push({ sum: x, n: 1 });
  }
  return ut.map(g => Math.round(g.sum / g.n));
}

// Målkjeden over fasaden. Hver akse har en skjøt PÅ seg (2 × klaring), og
// mellom skjøtene står elementlengden:
//   3790 · 20 · 4290 · 20 · 5980 …
//
// KJEDEN SLUTTER DER ELEMENTENE SLUTTER, ikke i aksesenteret. Moelv leser
// 3800 i første segment mot vårt 3790, og det er ikke en feil i kjeden: Moelv
// lar det første elementet gå helt ut til hjørneaksen, mens generatoren gir
// klaring i BEGGE ender av hvert felt (basFraMm = akse + klaring). Kjeden skal
// vise elementene som faktisk blir laget — ellers står det ett mål på tegninga
// og et annet på elementlista, og montøren tror det er han som har målt feil.
export function malkjede(akser, klaringMm) {
  if (!akser || akser.length < 2) return [];
  const k = Math.max(0, klaringMm || 0);
  const pkt = [akser[0] + k];
  for (let i = 1; i < akser.length - 1; i++) { pkt.push(akser[i] - k); pkt.push(akser[i] + k); }
  pkt.push(akser[akser.length - 1] - k);
  const ut = [];
  for (let i = 0; i < pkt.length - 1; i++) {
    const mm = Math.round(pkt[i + 1] - pkt[i]);
    if (mm <= 0) continue;
    ut.push({ fraMm: pkt[i], tilMm: pkt[i + 1], mm });
  }
  return ut;
}

// Bokstavakser: A, B … Z, AA, AB … Samme funksjon som js/axes.js bruker.
export function aksebokstav(i) {
  let s = "";
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

// Radene på en fasade, ordnet NEDENFRA OG OPP — samme rekkefølge som stabelen
// bygges i, og samme rekkefølge SW-numrene løper i.
export function raderFra(vegger, fi) {
  const per = new Map();
  for (const v of vegger || []) {
    if (v.fi !== fi || v.skjult || v.rBunnMm === undefined) continue;
    const k = v.radIdx;
    if (!per.has(k)) per.set(k, { bunnMm: v.rBunnMm, hoydeMm: v.hoydeMm });
  }
  return [...per.values()].sort((a, b) => a.bunnMm - b.bunnMm);
}

// Kotehøyden som tekst: 13100 → «+13.100», -350 → «-0.350».
export function kote(mm) {
  const neg = mm < 0;
  const a = Math.abs(Math.round(mm));
  const m = Math.floor(a / 1000), r = String(a % 1000).padStart(3, "0");
  return (neg ? "-" : "+") + m + "." + r;
}

// Bygger tegningsmodellen av det som ALT ligger lagret. `aksenavn(fi, mm)` får
// spørre 🔠 Akser om det virkelige navnet; svarer den null, faller vi tilbake
// på bokstaver per fasade.
export function byggTegningsmodell(inn) {
  const vegger = (inn.vegger || []).filter(v => !v.skjult && v.fi !== undefined);
  const fasader = inn.fasader || [];
  const o = inn.oppsett || {};
  const utsp = inn.utsparinger || [];
  const aksenavn = typeof inn.aksenavn === "function" ? inn.aksenavn : () => null;
  const klaring = Math.max(0, Number(o.klaringMm) || 0);
  // ±0.000 er GULVET. Med ringmur står SW-basen «ringHoydeMm» over gulvet;
  // uten ringmur er SW-basen søylefoten, altså gulvet selv.
  const nullMm = o.ringmur ? -Math.max(0, Number(o.ringHoydeMm) || 0) : 0;
  const rmBunnMm = o.ringmur
    ? -((Number(o.ringHoydeMm) || 0) + (Number(o.betongMm) || 0) + (Number(o.isoMm) || 0))
    : 0;

  const ut = [];
  for (let fi = 0; fi < fasader.length; fi++) {
    const el = vegger.filter(v => v.fi === fi);
    if (!el.length) continue;                 // en fasade uten elementer tegnes ikke
    let akser = aksepunkter(vegger, fi, klaring, o.aksetolMm);
    const minEl = Math.min(...el.map(v => v.fraMm));
    const maksEl = Math.max(...el.map(v => v.tilMm));
    if (!akser.length) akser = [minEl - klaring, maksEl + klaring];
    // fasaden skal alltid dekke elementene, også der en strimmel stikker
    // forbi ytterste akse
    const fraMm = Math.min(akser[0], minEl);
    const tilMm = Math.max(akser[akser.length - 1], maksEl);
    const rader = raderFra(vegger, fi);
    const toppMm = Math.max(...el.map(v => v.rBunnMm + v.hoydeMm));

    ut.push({
      fi,
      navn: t("Fasade {0}", fi + 1),
      fraMm, tilMm,
      lengdeMm: tilMm - fraMm,
      bunnMm: o.ringmur ? rmBunnMm : 0,
      toppMm,
      nullMm,
      ringmur: o.ringmur ? { bunnMm: rmBunnMm, toppMm: 0 } : null,
      akser: akser.map((mm, i) => ({ mm, navn: aksenavn(fi, mm) || aksebokstav(i) })),
      kjede: malkjede(akser, klaring),
      rader,
      elementer: el.map(v => ({
        fraMm: v.fraMm, tilMm: v.tilMm, bunnMm: v.rBunnMm, hoydeMm: v.hoydeMm,
        sw: v.sw || "", tilpasset: !!v.tilpasset
      })).sort((a, b) => a.bunnMm - b.bunnMm || a.fraMm - b.fraMm),
      utsparinger: utsp.filter(a => a.fi === fi).map(a => ({
        fraMm: a.fraMm, tilMm: a.tilMm_,
        bunnMm: a.bunnMm,
        // «full høyde» lagres som ±1e9 — klipp den til veggen, ellers blir
        // rektangelet uendelig høyt og tegninga svart.
        toppMm: Math.abs(a.toppMm) > 1e8 ? toppMm : a.toppMm,
        full: Math.abs(a.toppMm) > 1e8
      }))
    });
  }
  return { fasader: ut };
}

// Blokkas mål i punkt ved en gitt målestokk.
export function blokkMal(f, skala, medMerknad) {
  const b = f.lengdeMm / skala * MM + PLASS.hoydekjede + PLASS.niva +
            (medMerknad ? PLASS.merknad : 0);
  const h = PLASS.tittel + PLASS.akse + PLASS.kjede +
            (f.toppMm - f.bunnMm) / skala * MM;
  return { b, h };
}

// Største tegning som får plass i bredden OG på et helt ark.
export function velgSkala(f, bredde, arkHoyde, medMerknad) {
  for (const s of SKALAER) {
    const m = blokkMal(f, s, medMerknad);
    if (m.b <= bredde && m.h <= arkHoyde) return s;
  }
  return SKALAER[SKALAER.length - 1];
}

// Så mange fasader per ark som får plass — Emils valg 02.09. Fasadene tas i
// rekkefølge og legges ovenfra og ned; går den neste ikke inn i det som er
// igjen av høyden, begynner et nytt ark.
//
// Bredden er ikke den samme øverst og nederst på arket: tittelfeltkolonnen
// stjeler høyre side FRA y = TF.topp.y0 og nedover. En blokk som slutter over
// den linja får hele rammebredden.
export function bredeVed(bunnY) {
  return (bunnY <= TF.topp.y0 - 10 ? RAMME.x1 : TF.x0 - 20) - RAMME.x0 - 20;
}

export function fordelPaArk(fasader, medMerknad) {
  const arkH = RAMME.y1 - RAMME.y0 - 20;
  const ark = [];
  let na = null, y = RAMME.y0 + 10;
  for (const f of fasader || []) {
    // to forsøk: først med den brede plassen, så med den smale — en blokk som
    // ikke får plass oppe skal ikke måles med den brede bredden lenger nede
    let skala = null, mal = null;
    for (const bred of [bredeVed(y + 1), bredeVed(RAMME.y1)]) {
      const s = velgSkala(f, bred, arkH, medMerknad);
      const m = blokkMal(f, s, medMerknad);
      if (m.b <= bredeVed(y + m.h)) { skala = s; mal = m; break; }
      skala = s; mal = m;
    }
    if (!na || y + mal.h > RAMME.y1 - 10) {
      na = { fasader: [] }; ark.push(na); y = RAMME.y0 + 10;
      // på et ferskt ark kan blokka få bedre målestokk
      const s2 = velgSkala(f, bredeVed(y + 1), arkH, medMerknad);
      const m2 = blokkMal(f, s2, medMerknad);
      if (m2.b <= bredeVed(y + m2.h)) { skala = s2; mal = m2; }
    }
    na.fasader.push({ f, skala, y, hoyde: mal.h });
    y += mal.h + PLASS.luft;
  }
  return ark;
}

// Tegningsnummer per ark: SW-01, SW-02 …
export function arkNr(grunn, i) {
  const m = /^(.*?)(\d+)$/.exec(String(grunn || "SW-01"));
  if (!m) return String(grunn) + (i ? "-" + (i + 1) : "");
  const n = Number(m[2]) + i;
  return m[1] + String(n).padStart(m[2].length, "0");
}

export function idag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
}

// ═══════════════════════ TEGNING (jsPDF) ═══════════════════════
// Alt under dette punktet rører jsPDF og kjøres aldri i testen av den rene
// delen. Samme skille som i rapport.js.

const T = (s) => tilLatin1(s == null ? "" : String(s));

function nyttArk(jsPDF, forste, d) {
  if (forste) return new jsPDF({ unit: "pt", format: [ARK.b, ARK.h], orientation: "landscape" });
  d.addPage([ARK.b, ARK.h], "landscape");
  return d;
}

function strek(d, x1, y1, x2, y2, w) {
  d.setLineWidth(w == null ? STREK.tynn : w);
  d.line(x1, y1, x2, y2);
}

function stiplet(d, pa) {
  d.setLineDashPattern(pa ? [6, 4] : [], 0);
}

// Strek-punkt: aksene gjennom veggen og ±0.000 gjennom fundamentstripa.
function strekPunkt(d, pa) {
  d.setLineDashPattern(pa ? [14, 5, 3, 5] : [], 0);
}

// Tekst i en hvit, DEKKENDE boks — elementmerkene i Moelv skjuler streken de
// ligger over. Uten boksen forsvinner SW-nummeret i radskilleren.
function boksTekst(d, s, x, y, str, plasser) {
  const tx = T(s);
  if (!tx) return 0;
  d.setFontSize(str);
  const w = d.getTextWidth(tx), h = str * 0.95;
  const bx = plasser === "midt" ? x - w / 2 : (plasser === "hoyre" ? x - w : x);
  d.setFillColor(255, 255, 255);
  d.rect(bx - 1.5, y - h * 0.82, w + 3, h, "F");
  d.setTextColor(0, 0, 0);
  d.text(tx, bx, y);
  return w;
}

// ---------- Ramma og arkstrimlene ----------
function tegnRamme(d) {
  d.setDrawColor(0, 0, 0);
  d.setLineWidth(STREK.ramme);
  d.rect(RAMME.x0, RAMME.y0, RAMME.x1 - RAMME.x0, RAMME.y1 - RAMME.y0, "S");
  // strimlene utenfor ramma, med formatet i hjørnet — som Moelv
  d.setLineWidth(STREK.tynn);
  d.line(RAMME.x1, RAMME.y0, RAMME.x1, ARK.h - 0.6);
  d.line(RAMME.x0, RAMME.y1, ARK.b - 0.6, RAMME.y1);
  // formatruta i hjørnet: Moelv har den som en egen liten boks i BUNNstrimmelen,
  // til venstre for rammelinja — ikke oppå den
  d.rect(3324.0, 2361.3, 12.0, 11.2, "S");
  d.setFontSize(9); d.setTextColor(0, 0, 0);
  d.text("A0", 3324.6, 2370.2);
}

// ---------- Storm-logoen ----------
// Logoen ligger som SVG i sidas eget <defs> (#storm-ringer, #storm-kube,
// #storm-ord). Den serialiseres til et frittstående SVG med fargene INNE i
// koden — CSS-variablene finnes ikke i et løsrevet bilde — og males på et
// lerret. Ingen ny fil å laste, og det virker uten dekning på byggeplassen.
const LOGO_CSS =
  ".r1{fill:none;stroke:#d22b34;stroke-width:36.2}" +
  ".r2{fill:none;stroke:#a85055;stroke-width:2.6}" +
  ".r3{fill:none;stroke:#efb3a6;stroke-width:2.6}" +
  ".kb{fill:none;stroke:#11161d;stroke-width:4.5;stroke-linejoin:round;stroke-linecap:round}" +
  ".od{fill:#11161d}";

export function logoSvg() {
  const ringer =
    '<circle class="r1" cx="150.9" cy="142.8" r="83.06"/>' +
    '<circle class="r2" cx="151.3" cy="132.2" r="99.1"/>' +
    '<circle class="r2" cx="123.4" cy="148" r="88.7"/>' +
    '<circle class="r3" cx="176.4" cy="126.7" r="89.9"/>';
  const ord = document.getElementById("storm-ord");
  const kube = document.getElementById("storm-kube");
  const dOrd = ord ? ord.getAttribute("d") : "";
  const kubeP = kube ? [...kube.querySelectorAll("path")].map(p =>
    '<path class="kb" d="' + p.getAttribute("d") + '"/>').join("") : "";
  // 948, ikke 700: ordmerket slutter på x = 286 + 684 = 970 i symbolets egne
  // koordinater, og med translate(-28) på 942. En viewBox på 700 kappet
  // «Storm» til «Stor» — og det var ikke synlig før logoen sto i tittelfeltet.
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 948 224" width="948" height="224">' +
    '<style>' + LOGO_CSS + '</style><g transform="translate(-28,-26)">' + ringer + kubeP +
    '<g transform="translate(286,52)"><path class="od" fill-rule="evenodd" d="' + dOrd + '"/></g>' +
    '</g></svg>';
}

async function logoBilde() {
  try {
    if (!document.getElementById("storm-ord")) return null;
    const svg = logoSvg();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const img = await new Promise((ok, nei) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = nei;
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = 1896; c.height = 448;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/png"), b: 948, h: 224 };
  } catch (_) { return null; }
}

// ---------- Tittelfeltet ----------
// Mønsteret i hver celle: liten etikett klistret i øvre venstre hjørne,
// verdien rett under. Det er DET som gjør at feltet leses som et skjema.
function celle(d, x, y, etikett, verdi, str) {
  d.setFontSize(SKRIFT.tfEtikett); d.setTextColor(0, 0, 0);
  if (etikett) d.text(T(etikett), x + 3, y + 7.5);
  if (verdi) {
    d.setFontSize(str || SKRIFT.tfVerdi);
    d.text(T(verdi), x + 3, y + 7.5 + (str || SKRIFT.tfVerdi) * 0.95);
  }
}

function tegnTittelfelt(d, felt, logo, nr) {
  const R = TF.rader;
  d.setDrawColor(0, 0, 0); d.setLineWidth(STREK.tynn);
  stiplet(d, false);

  // toppboksen med tegningsnummeret gjentatt
  const tb = TF.topp;
  d.rect(TF.x0, tb.y0, TF.x1 - TF.x0, tb.y1 - tb.y0, "S");
  d.line(tb.v1, tb.y0, tb.v1, tb.y1);
  d.line(tb.v2, tb.y0, tb.v2, tb.y1);
  d.setFontSize(SKRIFT.tfEtikett);
  // Avstandene er MÅLT på Moelv, ikke jevnt fordelt: med 31 pt mellom hver
  // havnet «System» og «Type» på feil side av skillet ved 3055.
  const TB_ET = [["Kompleks", 3.5], ["Bygg", 75.6], ["Etasje", 135.8],
                 ["Fag", 168.3], ["System", 188.1], ["Type", 228.8],
                 ["Løpenummer", 257.9]];
  for (const [navn, dx] of TB_ET) d.text(T(navn), TF.x0 + dx, tb.y0 + 7.5);
  FASE_ET.forEach(([navn, dx]) => d.text(T(navn), TF.x0 + dx, tb.y0 + 7.5));
  d.setFontSize(SKRIFT.tfNr);
  d.text(T(nr), tb.v2 - 4 - d.getTextWidth(T(nr)), tb.y1 - 6);

  // den tomme revisjonskolonnen mellom toppboksen og hovedfeltet
  d.line(TF.x0, tb.y1, TF.x0, R[0]);
  d.line(TF.x1, tb.y1, TF.x1, R[0]);

  // hovedfeltet
  d.rect(TF.x0, R[0], TF.x1 - TF.x0, R[R.length - 1] - R[0], "S");
  for (const y of R.slice(1, -1)) d.line(TF.x0, y, TF.x1, y);

  // revisjonsraden
  d.setFontSize(SKRIFT.tfEtikett);
  for (const x of TF.revX) d.line(x, R[0], x, R[1]);
  const revNavn = ["Revisjon", "Revisjonstekst", "Dato", "Tegnet", "Kontrollert"];
  const revX = [TF.x0, TF.revX[0], TF.revX[1], TF.revX[2], TF.revX[3]];
  revNavn.forEach((s, i) => d.text(T(s), revX[i] + 3, R[0] + 9.5));

  // prosjektfase
  celle(d, TF.x0, R[1], "Prosjektfase", felt.fase, SKRIFT.tfStor);

  // logoen, sentrert i sin egen rad
  if (logo) {
    // BREDDEN styrer, ikke høyden. Målt på Moelv er merket + ordet 242 pt bredt
    // i et 399,6 pt bredt felt — altså 60 %. Styrte høyden (78 pt) ble logoen
    // 330 pt bred og fylte nesten hele feltet.
    const b = (TF.x1 - TF.x0) * 0.60;
    const h = b * (logo.h / logo.b);
    try {
      d.addImage(logo.data, "PNG", TF.x0 + (TF.x1 - TF.x0 - b) / 2, R[2] + 8, b, h);
    } catch (_) {}
    d.setFontSize(Math.max(9, b * 0.058)); d.setFont("helvetica", "bold");
    const e = T("ENTREPRENØR");
    d.text(e, TF.x0 + (TF.x1 - TF.x0 - d.getTextWidth(e)) / 2, R[2] + 8 + h + 13);
    d.setFont("helvetica", "normal");
  }

  // prosjekt + tegningstittel til venstre, skjemarutene til høyre
  d.line(TF.hoyreX, R[3], TF.hoyreX, R[5]);
  d.setFontSize(SKRIFT.tfStor); d.setTextColor(0, 0, 0);
  d.text(T(felt.prosjekt), TF.x0 + 4, R[3] + 22);
  d.text(T(felt.undertittel), TF.x0 + 4, R[3] + 22 + SKRIFT.tfStor * 1.35);
  d.text(T(felt.tittel), TF.x0 + 4, R[4] + 26);

  const H = TF.hoyreRader;
  for (const y of H.slice(1)) d.line(TF.hoyreX, y, TF.x1, y);
  celle(d, TF.hoyreX, H[0], "Oppdragsnummer", felt.oppdragsnr);
  celle(d, TF.hoyreX, H[1], "Tegnet av", felt.tegnet);
  celle(d, TF.hoyreX, H[2], "Kontroll", felt.kontroll);
  celle(d, TF.hoyreX, H[3], "Godkjent", felt.godkjent);
  celle(d, TF.hoyreX, H[4], "Utsendt dato", felt.dato);
  celle(d, TF.hoyreX, H[5], "Målestokk", felt.skala);
  for (let i = 1; i <= 3; i++) {
    d.line(TF.datoX, H[i], TF.datoX, H[i + 1]);
    celle(d, TF.datoX, H[i], "Dato", "");
  }
  d.setFontSize(SKRIFT.tfEtikett);
  FASE_ET.forEach(([navn, dx]) => d.text(T(navn), TF.x0 + dx, H[6] + 7.5));

  // nederste rad: løpenummeret stort
  d.line(TF.nrX, R[5], TF.nrX, R[6]);
  d.line(TF.hoyreX, R[5], TF.hoyreX, R[6]);
  d.setFontSize(SKRIFT.tfEtikett);
  d.text(T("Løpenummer"), TF.x0 + 245.0, R[5] + 7.5);
  d.setFontSize(SKRIFT.tfNr);
  d.text(T(nr), TF.hoyreX - 14.5 - d.getTextWidth(T(nr)), R[6] - 6);
}

// ---------- Nivåmarkør «Gesims ▼ +13.100» ----------
function nivaMarkor(d, x0, x1, y, navn, koteTekst) {
  d.setDrawColor(0, 0, 0);
  stiplet(d, false);
  strek(d, x0, y, x1, y, 1.1);
  d.setFontSize(SKRIFT.niva); d.setTextColor(0, 0, 0);
  const n = T(navn);
  const tri = 13;
  d.text(n, x1 - tri - 4 - d.getTextWidth(n), y - 4);
  // trekanten: fylt, spissen NED på linja
  d.setFillColor(0, 0, 0);
  d.triangle(x1 - tri, y - tri * 0.62, x1, y - tri * 0.62, x1 - tri / 2, y, "F");
  d.text(T(koteTekst), x1 - tri - 4 - d.getTextWidth(T(koteTekst)), y + SKRIFT.niva + 1);
}

// Hakemerket i en målkjede: en kort skråstrek gjennom kjedelinja.
function hake(d, x, y, loddrett) {
  const a = 4.5;
  d.setLineWidth(STREK.kjede);
  if (loddrett) d.line(x - a, y + a, x + a, y - a);
  else d.line(x - a, y + a, x + a, y - a);
}

// ---------- Én fasadeblokk ----------
function tegnFasade(d, f, skala, x, yTopp, medMerknad, merknad) {
  const xTittel = RAMME.x0 + 40;      // Moelv: tittelen i margen, ikke over veggen
  const px = (mm) => x + (mm - f.fraMm) / skala * MM;                 // langs fasaden
  const py = (mm) => yVegg + (f.toppMm - mm) / skala * MM;            // høyde over SW-basen
  const veggB = f.lengdeMm / skala * MM;
  const yVegg = yTopp + PLASS.tittel + PLASS.akse + PLASS.kjede;      // veggens TOPP
  const yBunn = py(f.bunnMm);

  d.setDrawColor(0, 0, 0); d.setTextColor(0, 0, 0);

  // tittelen og målestokken
  stiplet(d, false);
  d.setFontSize(SKRIFT.tittel);
  d.text(T("SW – " + f.navn), xTittel, yTopp + SKRIFT.tittel);
  d.setFontSize(SKRIFT.skala);
  d.text(T("1 : " + skala), xTittel + 2, yTopp + SKRIFT.tittel + 16);

  // ── aksesirklene og hjelpelinja
  const yAkseL = yTopp + PLASS.tittel + AKSE_R * 2 + 6;   // linja sirklene står på
  strek(d, px(f.akser[0].mm) - 30, yAkseL, px(f.akser[f.akser.length - 1].mm) + 30, yAkseL, STREK.tynn);
  d.setFontSize(12);
  for (const a of f.akser) {
    const ax = px(a.mm);
    d.setLineWidth(STREK.tynn);
    d.circle(ax, yAkseL - AKSE_R, AKSE_R, "S");
    const s = T(a.navn);
    d.text(s, ax - d.getTextWidth(s) / 2, yAkseL - AKSE_R + 4.5);
    // fra sirkelen ned til målkjeden
    strek(d, ax, yAkseL, ax, yVegg - PLASS.kjede, STREK.tynn);
  }

  // ── målkjeden mellom aksene
  const yKj = yVegg - PLASS.kjede + 16;
  strek(d, px(f.kjede.length ? f.kjede[0].fraMm : f.fraMm), yKj,
           px(f.kjede.length ? f.kjede[f.kjede.length - 1].tilMm : f.tilMm), yKj, STREK.kjede);
  d.setFontSize(SKRIFT.kjede);
  for (const s of f.kjede) {
    hake(d, px(s.fraMm), yKj, false);
    hake(d, px(s.tilMm), yKj, false);
    const tx = T(String(s.mm));
    const mid = (px(s.fraMm) + px(s.tilMm)) / 2;
    // et 20 mm-segment er 1 pt bredt — tallet må stå der uansett, ellers
    // forsvinner nettopp skjøten som er hele poenget med kjeden
    d.text(tx, mid - d.getTextWidth(tx) / 2, yKj - 4);
  }

  // ── fundamentstripa (ringmuren)
  if (f.ringmur) {
    const y0 = py(f.ringmur.toppMm), y1 = py(f.ringmur.bunnMm);
    d.setFillColor(FARGE.ringmur[0], FARGE.ringmur[1], FARGE.ringmur[2]);
    d.setLineWidth(STREK.tynn);
    d.rect(x - 8, y0, veggB + 16, y1 - y0, "FD");
  }

  // ── elementene
  d.setLineWidth(STREK.tynn);
  for (const e of f.elementer) {
    const ex = px(e.fraMm), ew = (e.tilMm - e.fraMm) / skala * MM;
    const ey = py(e.bunnMm + e.hoydeMm), eh = e.hoydeMm / skala * MM;
    if (ew <= 0.2 || eh <= 0.2) continue;
    d.setFillColor(FARGE.element[0], FARGE.element[1], FARGE.element[2]);
    d.rect(ex, ey, ew, eh, "FD");
  }
  // skjøtene mellom to elementer i SAMME rad tegnes tykke, oppå fyllet
  for (const e of f.elementer) {
    const naboer = f.elementer.filter(o => o !== e && o.bunnMm === e.bunnMm &&
      Math.abs(o.fraMm - e.tilMm) < 60);
    if (!naboer.length) continue;
    const ey = py(e.bunnMm + e.hoydeMm), eh = e.hoydeMm / skala * MM;
    strek(d, px(e.tilMm), ey, px(e.tilMm), ey + eh, STREK.skjot);
  }

  // ── aksene som strek-punkt gjennom veggen
  strekPunkt(d, true);
  d.setLineWidth(STREK.tynn);
  for (const a of f.akser) d.line(px(a.mm), yVegg, px(a.mm), yBunn + 26);
  // ±0.000 gjennom fundamentstripa
  if (f.ringmur) d.line(x - 18, py(f.nullMm), x + veggB + 18, py(f.nullMm));
  strekPunkt(d, false);

  // ── utsparingene: hvitt rektangel, tykk kontur, stiplet kryss
  for (const a of f.utsparinger) {
    const ax0 = px(Math.max(a.fraMm, f.fraMm)), ax1 = px(Math.min(a.tilMm, f.tilMm));
    const ay0 = py(Math.min(a.toppMm, f.toppMm)), ay1 = py(Math.max(a.bunnMm, 0));
    if (ax1 - ax0 <= 0.5 || ay1 - ay0 <= 0.5) continue;
    d.setFillColor(255, 255, 255);
    d.setLineWidth(STREK.utsp);
    d.rect(ax0, ay0, ax1 - ax0, ay1 - ay0, "FD");
    stiplet(d, true);
    d.setLineWidth(STREK.tynn);
    d.line(ax0, ay0, ax1, ay1);
    d.line(ax0, ay1, ax1, ay0);
    stiplet(d, false);
    // totalmålet midt i åpningen — samme tekst som merkingen i 3D
    const bredde = Math.round(a.tilMm - a.fraMm);
    const hoyde = a.full ? null : Math.round(a.toppMm - a.bunnMm);
    boksTekst(d, bredde + "×" + (hoyde === null ? "—" : hoyde) + " MM",
      (ax0 + ax1) / 2, (ay0 + ay1) / 2 + 3, SKRIFT.lengde, "midt");
  }

  // ── merkelappene til slutt, så ingenting legger seg over dem
  // Ligger punktet inne i en åpning? Da er det hull der, og en merkelapp der
  // ville stått midt i vinduet og skjult krysset.
  const iApning = (mm, hoyde) => f.utsparinger.some(a =>
    mm > a.fraMm + 20 && mm < a.tilMm - 20 && hoyde > a.bunnMm + 20 && hoyde < a.toppMm - 20);
  for (const e of f.elementer) {
    const ex = px(e.fraMm), ew = (e.tilMm - e.fraMm) / skala * MM;
    const ey = py(e.bunnMm + e.hoydeMm), eh = e.hoydeMm / skala * MM;
    if (ew < 14 || eh < 9) continue;                 // for smal bit — lappen ville dekket den
    const midt = (e.fraMm + e.tilMm) / 2, midtH = e.bunnMm + e.hoydeMm / 2;
    if (!iApning(e.fraMm + 60, e.bunnMm + e.hoydeMm - 60))
      boksTekst(d, e.sw, ex + 4, ey + SKRIFT.sw * 0.95 + 1.5, SKRIFT.sw);
    if (!iApning(midt, midtH))
      boksTekst(d, e.tilMm - e.fraMm + "MM", ex + ew / 2, ey + eh / 2 + SKRIFT.lengde * 0.35,
        SKRIFT.lengde, "midt");
  }

  // ── kappdybden per element som går gjennom en åpning (runde 16–19)
  d.setFontSize(SKRIFT.hoyde);
  for (const a of f.utsparinger) {
    for (const e of f.elementer) {
      const x0 = Math.max(e.fraMm, a.fraMm), x1 = Math.min(e.tilMm, a.tilMm);
      if (x1 - x0 <= 10) continue;
      const b0 = Math.max(e.bunnMm, a.bunnMm), b1 = Math.min(e.bunnMm + e.hoydeMm, a.toppMm);
      const dybde = Math.round(b1 - b0);
      if (dybde <= 10 || dybde >= e.hoydeMm - 10) continue;   // hel rad = ikke et kapp
      boksTekst(d, String(dybde), (px(x0) + px(x1)) / 2, (py(b0) + py(b1)) / 2 + 3,
        SKRIFT.hoyde, "midt");
    }
  }

  // ── loddrett radhøydekjede + nivåmarkørene
  const xKj = x + veggB + 22;
  strek(d, xKj, yVegg, xKj, py(0), STREK.kjede);
  d.setFontSize(SKRIFT.hoyde);
  for (const r of f.rader) {
    const y0 = py(r.bunnMm + r.hoydeMm), y1 = py(r.bunnMm);
    hake(d, xKj, y0, true);
    hake(d, xKj, y1, true);
    if (y1 - y0 < 14) continue;
    d.text(T(String(r.hoydeMm)), xKj - 4, (y0 + y1) / 2 + d.getTextWidth(String(r.hoydeMm)) / 2,
      { angle: 90 });
  }
  const xNiva = x + veggB + PLASS.hoydekjede + PLASS.niva - 14;
  nivaMarkor(d, xKj + 8, xNiva, yVegg, t("Gesims"), kote(f.toppMm - f.nullMm));
  nivaMarkor(d, xKj + 8, xNiva, py(f.nullMm), "01", kote(0));

  // ── merknaden til venstre, med pil inn mot fasaden
  if (medMerknad && merknad) {
    d.setFontSize(SKRIFT.merknad);
    const linjer = d.splitTextToSize(T(merknad), PLASS.merknad - 60);
    let ty = yVegg + 6;
    for (const l of linjer) { d.text(l, x - PLASS.merknad + 10, ty); ty += SKRIFT.merknad * 1.25; }
    stiplet(d, false);
    strek(d, x - PLASS.merknad + 10, ty + 2, x - 6, ty + 22, STREK.tynn);
    // pilspissen
    d.setFillColor(0, 0, 0);
    d.triangle(x - 6, ty + 22, x - 16, ty + 17, x - 13, ty + 26, "F");
  }
}

// ---------- Hele tegninga ----------
// `logo` kan sendes inn ferdig (testen gjør det — den har ingen nettleser å
// male SVG-en på). Utelates den, males den fra sidas eget <defs>.
export async function tegn(jsPDF, modell, felt, logoInn) {
  const merknad = (felt.merknad || "").trim();
  const medMerknad = !!merknad;
  const ark = fordelPaArk(modell.fasader, medMerknad);
  const logo = logoInn !== undefined ? logoInn : await logoBilde();
  let d = null;
  for (let i = 0; i < ark.length; i++) {
    d = nyttArk(jsPDF, i === 0, d);
    d.setFont("helvetica", "normal");
    tegnRamme(d);
    const skalaer = [];
    for (const b of ark[i].fasader) {
      const x = RAMME.x0 + 20 + (medMerknad ? PLASS.merknad : 0);
      tegnFasade(d, b.f, b.skala, x, b.y, medMerknad, merknad);
      skalaer.push("1:" + b.skala);
    }
    tegnTittelfelt(d, Object.assign({}, felt, {
      skala: [...new Set(skalaer)].join(" / ")
    }), logo, arkNr(felt.nr, i));
  }
  return d;
}

// Kalles fra panelet. `opts` er alt tegninga trenger — ingenting hentes fra
// modellen her.
export async function lastNedTegning(opts) {
  const modell = byggTegningsmodell(opts);
  if (!modell.fasader.length) throw new Error(t("Fant ingen fasader med veggelementer å tegne."));
  const jsPDF = await hentJsPDF();
  const d = await tegn(jsPDF, modell, opts.felt || {});
  const navn = ((opts.felt && opts.felt.nr) || "SW-01") + " " +
    ((opts.felt && opts.felt.prosjekt) || "instruksjonstegning");
  d.save(navn.replace(/[\\/:*?"<>|]+/g, "-").trim() + ".pdf");
  return modell;
}
