// 🔍 HVA ER ENDRET PÅ ET ELEMENT — i detalj (Emil 26.10.2026, prøve B)
//
// «hvis ikke det står fullstendig spesifisert så må overentreprenør/byggherre
// kun betale for det de må forstå og ikke mer»
//
// Inn: et endret element fra sammenligningen, med avtrykket fra før og etter:
//   c (senter), d (ytre boks), v (volum m³), navn,
//   r (hovedretning, enhetsvektor) og L (lengde langs r) — regnes fra
//   geometrien i compare.js. Mangler r (eldre lagret sammenligning, eller et
//   element uten tydelig retning, som en kvadratisk plate), faller vi tilbake
//   på den ytre boksen.
// Ut: punktene i klartekst («Flyttet 150 mm mot akse D», «Dimensjon før 100 x 5
//   · etter 100 x 6», «Lengde før 1000 mm · etter 960 mm (−40 mm i enden mot
//   akse 3)», «Dreid 15° i plan»…) og tallene tegningen i PDF-en trenger.
//
// REN: ingen DOM, ingen three.js. _test/test-em.mjs regner alt direkte.
// Koordinatene er modellens (three.js): x og z vannrett, y opp.
import { akseFor } from "./em-regn.js";

export const TERSKEL_MM = 1;        // mindre enn dette er avrunding, ikke endring
export const TERSKEL_GRADER = 0.5;

const mm = (v, toM) => (Number(v) || 0) * (Number(toM) || 1) * 1000;
const rundMm = (v) => Math.round(v);
export function mmTekst(v) {
  const n = Math.round(Math.abs(v));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " mm";
}
const grader = (v) => (Math.round(v * 10) / 10).toString().replace(".", ",") + "°";
export function koteTekst(m) {
  const s = (Math.round(m * 1000) / 1000).toFixed(3).replace(".", ",");
  return (m >= 0 ? "+" : "") + s;
}

// ---------- Hovedretningen (PCA) ----------
// stat = { n, sx, sy, sz, sxx, sxy, sxz, syy, syz, szz } samlet over hjørnene.
// Svar: { r: [x,y,z], lang } der lang = hvor tydelig avlangt elementet er
// (største egenverdi delt på summen av de to andre). Under 1,8 er det ingen
// tydelig retning — da svarer vi null, ellers ville en kvadratisk plate fått
// en tilfeldig «dreining» mellom revisjonene.
export function pcaRetning(s) {
  if (!s || s.n < 2) return null;
  const n = s.n, mx = s.sx / n, my = s.sy / n, mz = s.sz / n;
  const C = [
    [s.sxx / n - mx * mx, s.sxy / n - mx * my, s.sxz / n - mx * mz],
    [s.sxy / n - mx * my, s.syy / n - my * my, s.syz / n - my * mz],
    [s.sxz / n - mx * mz, s.syz / n - my * mz, s.szz / n - mz * mz]
  ];
  const spor = C[0][0] + C[1][1] + C[2][2];
  if (!(spor > 0)) return null;
  // potensiteration fra den største diagonalen
  let v = [C[0][0], C[1][1], C[2][2]];
  const iMax = v.indexOf(Math.max(...v));
  v = [0, 0, 0]; v[iMax] = 1; v = v.map((x, i) => x + 0.01 * (i + 1));
  let lam = 0;
  for (let k = 0; k < 60; k++) {
    const w = [0, 1, 2].map(i => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]);
    const l = Math.hypot(w[0], w[1], w[2]);
    if (!(l > 0)) return null;
    v = w.map(x => x / l); lam = l;
  }
  const resten = spor - lam;
  const lang = resten > 1e-12 ? lam / resten : 1e9;
  if (lang < 1.8) return null;
  // Fast fortegn, så samme element får samme retning i begge revisjonene
  const st = [0, 1, 2].reduce((a, i) => Math.abs(v[i]) > Math.abs(v[a]) ? i : a, 0);
  if (v[st] < 0) v = v.map(x => -x);
  return { r: v, lang };
}

// ---------- Endene ----------
function ender(c, r, L) {
  if (!c || !r || !(L > 0)) return null;
  const h = L / 2;
  return [[c[0] - r[0] * h, c[1] - r[1] * h, c[2] - r[2] * h], [c[0] + r[0] * h, c[1] + r[1] * h, c[2] + r[2] * h]];
}
const avst = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Parer endene før/etter (retningen kan ha snudd fortegn)
function parEnder(fe, ne) {
  const rett = avst(fe[0], ne[0]) + avst(fe[1], ne[1]), kryss = avst(fe[0], ne[1]) + avst(fe[1], ne[0]);
  return rett <= kryss ? [[fe[0], ne[0]], [fe[1], ne[1]]] : [[fe[0], ne[1]], [fe[1], ne[0]]];
}

// Retning mot neste akse: fra verdien v, i fortegnet til delta
function motAkse(liste, v, delta) {
  const l = (liste || []).filter(a => a && isFinite(a.c)).slice().sort((a, b) => a.c - b.c);
  if (!l.length) return "";
  const eps = 1e-9 + Math.abs(delta) * 0.01;
  const a = delta > 0 ? l.find(x => x.c > v + eps) : [...l].reverse().find(x => x.c < v - eps);
  return a ? String(a.navn) : "";
}

// Dimensjonen i navnet: «CFSHS 300x6», «HEB300», «Flat Bar 100x5»
export function dimensjonAv(navn) {
  const s = String(navn || "");
  const m = s.match(/\d+(?:[.,]\d+)?\s*[xX×*]\s*\d+(?:[.,]\d+)?(?:\s*[xX×*]\s*\d+(?:[.,]\d+)?)?/g);
  if (m) return m[m.length - 1].replace(/\s*[xX×*]\s*/g, " x ");
  const p = s.match(/\b(HE[ABM]|IPE|UNP|UPE|HUP|INP)\s?-?(\d{2,4})\b/i);
  return p ? (p[1].toUpperCase() + p[2]) : "";
}
const typeNavnUtenId = (n) => String(n || "").replace(/:\d+$/, "").trim();

const vinkelPlan = (r) => Math.atan2(r[2], r[0]) * 180 / Math.PI;
const helning = (r) => Math.asin(Math.min(1, Math.abs(r[1]))) * 180 / Math.PI;
function normDiff180(a) { let x = ((a % 180) + 180) % 180; if (x > 90) x -= 180; return x; }

// e = { c, d, v, navn, r, L, fra: { c, d, v, navn, r, L } }
// o = { toM, akser }
export function detaljerFor(e, o) {
  const opt = o || {}, toM = Number(opt.toM) || 1, akser = opt.akser || null;
  const f = e.fra || {};
  const ut = { punkter: [], tegning: { flytt: null, hoyde: 0, dL: 0, vinkel: 0, pivot: null, enden: null }, vertikal: false };
  if (!e.c || !f.c) return ut;
  const P = (k, tekst, ekstra) => ut.punkter.push(Object.assign({ k, tekst }, ekstra || {}));

  const harR = Array.isArray(e.r) && Array.isArray(f.r) && e.L > 0 && f.L > 0;
  const vertikal = harR ? (Math.abs(e.r[1]) > 0.9 && Math.abs(f.r[1]) > 0.9) : ((e.d && e.d[1] > Math.max(e.d[0], e.d[2]) * 2));
  ut.vertikal = vertikal;

  // Endene: den enden som har flyttet seg MINST er ankeret. Flyttingen av
  // ankeret er elementets flytting; resten forklares av lengde og dreining.
  // Uten dette ble «kortet 40 mm i den ene enden» til «flyttet 20 mm» (senteret
  // flytter seg halve forkortingen).
  let fast = -1, bevegelig = -1, parene = null, trans = null;
  if (harR) {
    const fe = ender(f.c, f.r, f.L), ne = ender(e.c, e.r, e.L);
    parene = parEnder(fe, ne);
    const flytt = parene.map(([a, b]) => avst(a, b));
    const anker = flytt[0] <= flytt[1] ? 0 : 1;
    const [fa, na] = parene[anker];
    trans = [na[0] - fa[0], na[1] - fa[1], na[2] - fa[2]];
    bevegelig = 1 - anker;
    if (mm(flytt[anker], toM) < TERSKEL_MM) { fast = anker; ut.tegning.pivot = fa; }
    if (mm(flytt[bevegelig], toM) < TERSKEL_MM) bevegelig = -1;
  }
  const endeNavn = (p) => {
    if (vertikal) return p[1] > (f.c[1] || 0) ? "i toppen" : "i bunnen";
    const a = akseFor(p, akser);
    return a ? "i enden ved akse " + a : "i den ene enden";
  };

  // 1) Flytting: ankerenden (eller senteret når retningen mangler)
  const dv = trans || [e.c[0] - f.c[0], e.c[1] - f.c[1], e.c[2] - f.c[2]];
  const dx = mm(dv[0], toM), dz = mm(dv[2], toM);
  const plan = [];
  if (Math.abs(dx) >= TERSKEL_MM) {
    const a = motAkse(akser && akser.x, f.c[0], dx);
    plan.push({ akse: "x", mm: dx, tekst: "Flyttet " + mmTekst(dx) + (a ? " mot akse " + a : " i " + (dx > 0 ? "+" : "−") + "X-retning") });
  }
  if (Math.abs(dz) >= TERSKEL_MM) {
    const a = motAkse(akser && akser.z, f.c[2], dz);
    plan.push({ akse: "z", mm: dz, tekst: "Flyttet " + mmTekst(dz) + (a ? " mot akse " + a : " i " + (dz > 0 ? "+" : "−") + "Z-retning") });
  }
  for (const p of plan) P("flytt", p.tekst, { akse: p.akse, mm: p.mm });
  if (plan.length) ut.tegning.flytt = { dx: Math.abs(dx) >= TERSKEL_MM ? dx : 0, dz: Math.abs(dz) >= TERSKEL_MM ? dz : 0 };
  // Høyden: ankerets høydeendring, med underkanten før og etter
  const ukF = (f.c[1] - (f.d ? f.d[1] / 2 : 0)) * toM, ukN = (e.c[1] - (e.d ? e.d[1] / 2 : 0)) * toM;
  const dH = trans ? mm(trans[1], toM) : (ukN - ukF) * 1000;
  if (Math.abs(dH) >= TERSKEL_MM) {
    P("hoyde", (dH > 0 ? "Hevet " : "Senket ") + mmTekst(dH) + " (underkant før " + koteTekst(ukF) + " · etter " + koteTekst(ukN) + ")", { mm: dH });
    ut.tegning.hoyde = dH;
  }

  // 2) Dimensjon / type fra navnet
  const dimF = dimensjonAv(f.navn), dimN = dimensjonAv(e.navn);
  let profilEndret = false;
  if (dimF && dimN && dimF.replace(/\s/g, "") !== dimN.replace(/\s/g, "")) {
    P("profil", "Dimensjon før " + dimF + " · etter " + dimN); profilEndret = true;
  } else if (typeNavnUtenId(f.navn) && typeNavnUtenId(e.navn) && typeNavnUtenId(f.navn) !== typeNavnUtenId(e.navn)) {
    P("profil", "Type før «" + typeNavnUtenId(f.navn) + "» · etter «" + typeNavnUtenId(e.navn) + "»"); profilEndret = true;
  }

  // 3) Lengde
  const lF = harR ? mm(f.L, toM) : (f.d ? mm(Math.max(...f.d), toM) : 0);
  const lN = harR ? mm(e.L, toM) : (e.d ? mm(Math.max(...e.d), toM) : 0);
  const dL = lN - lF;
  if (lF > 0 && Math.abs(dL) >= TERSKEL_MM) {
    let hvor = "";
    if (bevegelig >= 0 && parene) hvor = " " + endeNavn(parene[bevegelig][0]);
    P("lengde", "Lengde før " + mmTekst(lF) + " · etter " + mmTekst(lN) + " (" + (dL > 0 ? "+" : "−") + mmTekst(dL) + hvor + ")", { foer: lF, etter: lN, mm: dL });
    ut.tegning.dL = dL; ut.tegning.lF = lF; ut.tegning.lN = lN;
    if (bevegelig >= 0) ut.tegning.enden = bevegelig;
  }

  // 4) Vinkel: dreiing i plan og helning
  if (harR) {
    if (!vertikal) {
      const dv = normDiff180(vinkelPlan(e.r) - vinkelPlan(f.r));
      if (Math.abs(dv) >= TERSKEL_GRADER) {
        const rundt = fast >= 0 ? " rundt " + (akseFor(parene[fast][0], akser) ? "enden ved akse " + akseFor(parene[fast][0], akser) : "den ene enden") : "";
        P("vinkel", "Dreid " + grader(Math.abs(dv)) + " i plan" + rundt, { grader: dv });
        ut.tegning.vinkel = dv;
      }
    }
    const hF = helning(f.r), hN = helning(e.r);
    if (Math.abs(hN - hF) >= TERSKEL_GRADER)
      P("helning", (vertikal ? "Helning fra loddrett før " + grader(90 - hF) + " · etter " + grader(90 - hN)
        : "Helning før " + grader(hF) + " · etter " + grader(hN)), { grader: hN - hF });
  }

  // 5) Ytre mål på tverrsnittet — bare når elementet ligger langs aksene
  //    (ellers lyver den ytre boksen) og dimensjonen ikke alt står over
  const langsAksene = !harR || [e.r, f.r].every(r => Math.max(...r.map(Math.abs)) > 0.995);
  if (!profilEndret && langsAksene && e.d && f.d) {
    const snitt = (d) => d.map(x => mm(x, toM)).sort((a, b) => a - b).slice(0, 2);
    const sF = snitt(f.d), sN = snitt(e.d);
    if (Math.abs(sF[0] - sN[0]) >= TERSKEL_MM || Math.abs(sF[1] - sN[1]) >= TERSKEL_MM)
      P("tverrsnitt", "Ytre mål tverrsnitt før " + rundMm(sF[0]) + " x " + rundMm(sF[1]) + " mm · etter " + rundMm(sN[0]) + " x " + rundMm(sN[1]) + " mm");
  }

  // 6) Bare volumet? Da er det noe inne i elementet (hull, utsparing, avfasing)
  if (!ut.punkter.length && f.v > 0 && Math.abs((e.v - f.v) / f.v) > 0.005) {
    const v3 = (x) => (Math.round(x * 1000) / 1000).toString().replace(".", ",");
    P("volum", "Volum før " + v3(f.v) + " m³ · etter " + v3(e.v) + " m³ — ytre mål er de samme, så noe inne i elementet er endret (f.eks. hull, utsparing eller avfasing)");
  }
  if (!ut.punkter.length) P("liten", "Endret under 1 mm (avrundet bort) — ingen målbar endring");
  return ut;
}

// ---------- 📊 Mengdelista (Excel) til en lagret EM ----------
// Vedlegget skjemaet lover («Mengdeliste (Excel) fra Storm IFC-Viewer»). Emil
// 26.10: «jeg ser ikke noe sted og hente dette utfra» — Excel-knappen fantes
// bare FØR utkastet ble laget. Nå lages lista fra den lagrede EM-en.
// ordre = ordreUtad(skjema.svar.okonomi) fra skjema-pdf.js: SALGSPRIS, aldri
// kostpris eller påslag — lista sendes til kontraktsparten sammen med PDF-en.
// Svar: [{ navn, rader }] — ett ark per tema.
const HVA_NAVN = { ny: "Ny", fjernet: "Fjernet", endret: "Endret", valgt: "Valgt" };
export function emExcelArk(em, ordre) {
  const topp = [["Endringsmelding", (em.nr ? em.nr + " · " : "") + em.tittel],
    ["Modell", em.fra ? em.til + " mot " + em.fra : em.til], ["Laget", String(em.laget || "").slice(0, 10)], []];
  // 1) Mengder per type
  const mengder = topp.concat([["Type", "Elementer", "Ny", "Fjernet", "Endret", "Mengdeendring", "Enhet"]]);
  for (const e of em.endringer || []) {
    const n = (h) => e.elementer.filter(x => x.hva === h).length;
    const sum = e.elementer.reduce((s, x) => s + (Number(x.mengde) || 0), 0);
    mengder.push([e.navn, e.undertekst, n("ny") + n("valgt"), n("fjernet"), n("endret"), Math.round(sum * 1000) / 1000, e.enhet]);
  }
  mengder.push([], ["Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål."]);
  // 2) Hvert element, med hva som er endret
  const el = topp.concat([["Nr", "Type", "Element", "GlobalId", "Akse", "Hva", "Mengde", "Enhet", "Hva er endret"]]);
  for (const e of em.endringer || []) {
    let nr = 0;
    for (const x of e.elementer) {
      let tekst = "";
      if (x.hva === "endret") {
        nr++;
        tekst = detaljerFor({ c: x.c, d: x.d, v: x.v, navn: x.navn, r: x.r, L: x.L,
          fra: { c: x.fc, d: x.fd, v: x.fv, navn: x.nf || x.navn, r: x.fr, L: x.fL } }, { toM: em.toM, akser: em.akser })
          .punkter.map(p => p.tekst).join(" · ");
      }
      el.push([x.hva === "endret" ? nr : "", e.navn, x.navn, x.guid, x.akse, HVA_NAVN[x.hva] || x.hva,
        x.mengde == null ? "" : x.mengde, x.mengde == null ? "" : e.enhet, tekst]);
    }
    if (e.antall > e.elementer.length) el.push(["", e.navn, "+ " + (e.antall - e.elementer.length) + " til (ikke lagret)"]);
  }
  el.push([], ["Mål og vinkler er lest fra 3D-modellen. Endringer under 1 mm og 0,5° er avrundet bort."]);
  const ark = [{ navn: "Mengder", rader: mengder }, { navn: "Elementer", rader: el }];
  // 3) Økonomi — som i skjemaet (salgspris)
  if (ordre && ordre.rader && ordre.rader.length) {
    const ok = topp.concat([["Produkt", "Antall", "Enhet", "Enhetspris", "Sum eks. mva", "MVA %", "MVA", "Sum inkl. mva"]]);
    for (const r of ordre.rader) ok.push([r.produkt, r.antall, r.enhet, r.enhetspris, r.eksMva, r.mvaProsent, r.mvaBelop, r.inklMva]);
    ok.push([], ["Total", "", "", "", ordre.sum.eksMva, "", ordre.sum.mvaBelop, ordre.sum.inklMva]);
    ark.push({ navn: "Økonomi", rader: ok });
  }
  return ark;
}
