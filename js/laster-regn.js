// ❄🌬 SNØLAST OG VINDLAST — regnestykkene (rene, uten three.js; testes i
// _test/test-laster.mjs). Visningen og panelet bor i js/laster.js.
//
// ⚠ FORBEHOLD (Emil 05.10, godkjent 06.10): dette er en VEILEDENDE kontroll og
// visualisering for Storm. Den erstatter ikke RIB, som har ansvaret for
// prosjekteringen (PRO). Kommuneverdiene (sk,0, Hg, Δsk, sk,maks, vb,0) står
// i de nasjonale tilleggene til NS-EN 1991-1-3 og NS-EN 1991-1-4, som er
// opphavsrettsbeskyttet av Standard Norge — de skrives inn av brukeren fra
// Storms eget eksemplar eller fra RIBs lastforutsetninger, og ligger IKKE i
// koden.
//
// Kilder for formlene: Byggforsk 471.041 «Snølast på tak», NTF-kurs «Laster»
// (takstol.com). Formfaktorene for vind (cpe,10) er fra NS-EN 1991-1-4
// tabell 7.1 (vegger) og 7.2 (flatt tak, skarp kant) — kontroller mot
// standarden før tallene brukes til noe annet enn kontroll.

// ═══════════════════════ SNØ ═══════════════════════
// Karakteristisk snølast på mark: sk = sk,0 + n·Δsk, n = (H − Hg)/100 rundet
// OPP til nærmeste heltall (0 når H ≤ Hg), og aldri over sk,maks.
export function snoMark(v) {
  const sk0 = tall(v.sk0), Hg = tall(v.Hg), dsk = tall(v.dsk), H = tall(v.H);
  const maks = tall(v.skMaks);
  if (sk0 == null) return null;
  let n = 0;
  if (H != null && Hg != null && dsk != null && H > Hg) n = Math.ceil((H - Hg) / 100 - 1e-9);
  let sk = sk0 + n * (dsk || 0);
  const kappet = maks != null && maks > 0 && sk > maks;
  if (kappet) sk = maks;
  return { sk, n, kappet };
}

// Formfaktor μ1 for pulttak og saltak (uten opphopning): 0,8 opp til 30°,
// lineært ned til 0 ved 60°, og 0 brattere enn det.
export function mu1(alfa) {
  const a = Math.abs(Number(alfa) || 0);
  if (a <= 30) return 0.8;
  if (a >= 60) return 0;
  return 0.8 * (60 - a) / 30;
}

// Snølast på tak, kN/m² på TAKETS HORISONTALPROJEKSJON: s = μ1·Ce·Ct·sk
export function snoTak(sk, alfa, Ce, Ct) {
  const ce = tall(Ce) ?? 1, ct = tall(Ct) ?? 1;
  return mu1(alfa) * ce * ct * sk;
}

// ═══════════════════════ VIND ═══════════════════════
// Terrengkategoriene (NS-EN 1991-1-4, norsk tillegg): ruhetsfaktor kr,
// ruhetslengde z0 og minstehøyde zmin.
export const TERRENG = {
  "0":   { navn: "0 – åpent hav", kr: 0.16, z0: 0.003, zmin: 2 },
  "I":   { navn: "I – kystnært, åpent", kr: 0.17, z0: 0.01, zmin: 2 },
  "II":  { navn: "II – landbruk, spredte hus", kr: 0.19, z0: 0.05, zmin: 4 },
  "III": { navn: "III – tettsted, skog", kr: 0.22, z0: 0.3, zmin: 8 },
  "IV":  { navn: "IV – by, minst 15 % bebygd", kr: 0.24, z0: 1.0, zmin: 16 }
};
export const LUFT_RHO = 1.25;   // kg/m³

// Basisvindhastighet: vb = cdir·cseason·calt·cprob·vb,0
export function vindBasis(v) {
  const vb0 = tall(v.vb0);
  if (vb0 == null) return null;
  const f = (x) => { const n = tall(x); return n == null ? 1 : n; };
  return f(v.cdir) * f(v.cseason) * f(v.calt) * f(v.cprob) * vb0;
}

// Vindkasthastighetstrykket qp(z) i N/m² (c0 = 1, flatt terreng):
//   cr = kr·ln(z/z0),  vm = cr·c0·vb,  Iv = 1/(c0·ln(z/z0)),
//   qp = [1 + 7·Iv]·½·ρ·vm²      — z erstattes av zmin under zmin
export function vindTrykk(z, vb, kat, c0) {
  const T = TERRENG[kat] || TERRENG.II;
  const c = tall(c0) ?? 1;
  const zz = Math.max(Number(z) || 0, T.zmin);
  const ln = Math.log(zz / T.z0);
  const cr = T.kr * ln;
  const vm = cr * c * vb;
  const Iv = 1 / (c * ln);
  const qp = (1 + 7 * Iv) * 0.5 * LUFT_RHO * vm * vm;
  return { qp, vm, Iv, cr, z: zz };
}

// Utvendig formfaktor cpe,10 for vegger (tabell 7.1), med lineær
// interpolasjon i h/d. A–C er sideveggene (fra lo-kanten og bakover),
// D er lo-veggen (trykk), E le-veggen (sug).
export function cpeVegg(hd) {
  const r = Math.max(0, Number(hd) || 0);
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  let D, E;
  if (r <= 0.25) { D = 0.7; E = -0.3; }
  else if (r <= 1) { const t = (r - 0.25) / 0.75; D = lerp(0.7, 0.8, t); E = lerp(-0.3, -0.5, t); }
  else if (r <= 5) { const t = (r - 1) / 4; D = 0.8; E = lerp(-0.5, -0.7, t); }
  else { D = 0.8; E = -0.7; }
  return { A: -1.2, B: -0.8, C: -0.5, D, E };
}

// Sonene på sideveggene langs vindretningen (figur 7.5): e = min(b, 2h).
// Svarer med lengdene [A, B, C] i meter fra lo-kanten.
export function veggSoner(b, d, h) {
  const e = Math.min(b, 2 * h);
  if (e >= 5 * d) return { e, A: d, B: 0, C: 0 };
  if (e >= d) return { e, A: e / 5, B: d - e / 5, C: 0 };
  return { e, A: e / 5, B: 4 * e / 5, C: d - e };
}

// Flatt tak (helning under 5°, skarp kant), tabell 7.2: cpe,10
export const CPE_FLATT_TAK = { F: -1.8, G: -1.2, H: -0.7, I: 0.2, Iminus: -0.2 };

// Sonene på et flatt tak (figur 7.6), i meter. Vinden kommer inn over den
// ene langsiden (bredde b på tvers av vinden, dybde d langs vinden).
//   F: e/4 bred langs kanten i hvert hjørne, e/10 dyp
//   G: midt mellom F-ene, e/10 dyp
//   H: fra e/10 til e/2
//   I: resten
export function flattTakSoner(b, d, h) {
  const e = Math.min(b, 2 * h);
  const dyp1 = Math.min(e / 10, d), dyp2 = Math.min(e / 2, d);
  const fBredde = Math.min(e / 4, b / 2);
  return {
    e,
    soner: [
      { sone: "F", u0: 0, u1: fBredde, v0: 0, v1: dyp1 },
      { sone: "G", u0: fBredde, u1: b - fBredde, v0: 0, v1: dyp1 },
      { sone: "F", u0: b - fBredde, u1: b, v0: 0, v1: dyp1 },
      { sone: "H", u0: 0, u1: b, v0: dyp1, v1: dyp2 },
      { sone: "I", u0: 0, u1: b, v0: dyp2, v1: d }
    ].filter(s => s.u1 - s.u0 > 1e-9 && s.v1 - s.v0 > 1e-9)
  };
}

// Vindlast på flata: we = qp·cpe (kN/m² når qp er i N/m²)
export const we = (qpNm2, cpe) => qpNm2 * cpe / 1000;

// ═══════════════════════ HJELP ═══════════════════════
// Tom streng, mellomrom og komma som desimaltegn tåles (feltene er norske).
export function tall(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Feltene som lagres per modell. Ukjente nøkler slipper aldri inn.
export const FELT = ["kommune", "H", "sk0", "Hg", "dsk", "skMaks", "Ce", "Ct", "takform", "takvinkel",
  "vb0", "cdir", "cseason", "calt", "cprob", "terreng", "retning"];
export function vaskLastdata(d) {
  const ut = {};
  if (!d || typeof d !== "object") return ut;
  for (const k of FELT) {
    if (d[k] === undefined || d[k] === null) continue;
    ut[k] = String(d[k]).slice(0, 60);
  }
  if (ut.terreng && !TERRENG[ut.terreng]) delete ut.terreng;
  if (ut.takform && !["auto", "flatt", "pult", "saltak"].includes(ut.takform)) delete ut.takform;
  if (ut.retning && !["0", "1", "2", "3"].includes(ut.retning)) delete ut.retning;
  return ut;
}

// ═══════════════════════ KOMMUNEN FRA TERRENGET ═══════════════════════
// Kartverkets kommuneinfo: hvilken kommune et punkt (UTM33, EPSG:25833)
// ligger i. Ingen nøkkel — samme tjeneste (ws.geonorge.no) som adressesøket
// i Terreng. Brukes bare når adressen ikke hadde kommunenavnet med.
export const KOMMUNE_PUNKT_URL = "https://ws.geonorge.no/kommuneinfo/v1/punkt";
export function kommunePunktUrl(E, N) {
  if (E === null || E === undefined || E === "" || N === null || N === undefined || N === "") return null;
  const e = Number(E), n = Number(N);
  if (!Number.isFinite(e) || !Number.isFinite(n)) return null;
  return KOMMUNE_PUNKT_URL + "?nord=" + Math.round(n) + "&ost=" + Math.round(e) + "&koordsys=25833";
}
// «Øvre Eiker» fra { kommunenavn: "Øvre Eiker", kommunenummer: "3314", … }
export function kommuneFraSvar(json) {
  const navn = json && typeof json.kommunenavn === "string" ? json.kommunenavn.trim() : "";
  return navn ? navn.slice(0, 60) : "";
}

// ═══════════════════════ SJEKK AV TALLENE SOM SKRIVES INN ═══════════════════════
// Emil 06.10 (bilde: qp 0,07 kN/m²): vb,0 = 5, cdir = 2, cseason = 4 gir et
// vindtrykk som ikke kan stemme — og ingenting sa fra. Grensene her er
// rimelighetsgrenser, ikke standardens tall: utenfor dem er det nesten alltid
// en skrivefeil. Svaret er nøkler (oversettes i panelet) med verdien.
export function vindAdvarsler(v) {
  const ut = [];
  const n = (k) => tall(v[k]);
  const vb0 = n("vb0");
  if (vb0 != null && (vb0 < 20 || vb0 > 35)) ut.push({ tekst: "vb,0 er {0} m/s. Referansevindhastigheten i Norge er vanligvis mellom 22 og 31 m/s — sjekk tallet.", verdi: vb0 });
  for (const k of ["cdir", "cseason"]) {
    const x = n(k);
    if (x != null && (x <= 0 || x > 1)) ut.push({ tekst: "{1} er {0}. Den skal ligge mellom 0 og 1,0 (normalt 1,0).", verdi: x, navn: k });
  }
  const calt = n("calt");
  if (calt != null && (calt < 1 || calt > 2)) ut.push({ tekst: "{1} er {0}. Høydefaktoren er 1,0 eller litt større — aldri under 1,0.", verdi: calt, navn: "calt" });
  const cprob = n("cprob");
  if (cprob != null && (cprob < 0.7 || cprob > 1.2)) ut.push({ tekst: "{1} er {0}. Sannsynlighetsfaktoren er normalt 1,0 (50 års returperiode).", verdi: cprob, navn: "cprob" });
  return ut;
}
export function snoAdvarsler(v) {
  const ut = [];
  const sk0 = tall(v.sk0);
  if (sk0 != null && (sk0 <= 0 || sk0 > 12)) ut.push({ tekst: "sk,0 er {0} kN/m². Det er utenfor det som er vanlig i Norge — sjekk tallet.", verdi: sk0 });
  for (const k of ["Ce", "Ct"]) {
    const x = tall(v[k]);
    if (x != null && (x <= 0 || x > 1.25)) ut.push({ tekst: "{1} er {0}. Den skal normalt være 1,0.", verdi: x, navn: k });
  }
  return ut;
}

// ════════════════════════════════════════════════════════════════════════
// 🧱 VINDEN PÅ DE FAKTISKE VEGGENE (Emil 06.10)
// «Boksen skal forme seg rundt stålbygget og legge seg langs flaten til
// veggen og regne ut m² av veggen.» Og: «basert på prinsipp og regler —
// ingen hardkodet info om spesifikke modeller».
//
// Derfor: ingenting her vet noe om én bestemt modell. Inndataene er bare
// FLATER — hver med en utovernormal N, en retning e langs flaten, et
// startpunkt o i plan og en liste DELER (omrisset av hver vegg-bit i flatens
// eget plan, t langs e og y opp). Hvor flatene kommer fra (SW-generatorens
// vegger, eller omrisset av stålsøylene) avgjøres i laster.js. Reglene som
// brukes er bare NS-EN 1991-1-4 avsnitt 7.2.2:
//   • en flate som vinden treffer rett på (N·w < −cos 45°) er lo-vegg D
//   • en flate vinden går rett fra (N·w > cos 45°) er le-vegg E
//   • de andre er sidevegger, delt i A, B, C etter avstanden fra lo-kanten
//   • b, d og h måles på veggene selv (b på tvers av vinden, d langs)
// Alt i meter.
// ════════════════════════════════════════════════════════════════════════
const COS45 = Math.SQRT1_2;

// Konveks hylle av punkter [x, y] (monoton kjede), mot klokka.
export function hylle2(pkt) {
  const p = pkt.filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]))
    .slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const kr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lav = [], hoy = [];
  for (const q of p) { while (lav.length >= 2 && kr(lav[lav.length - 2], lav[lav.length - 1], q) <= 1e-12) lav.pop(); lav.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hoy.length >= 2 && kr(hoy[hoy.length - 2], hoy[hoy.length - 1], q) <= 1e-12) hoy.pop(); hoy.push(q); }
  lav.pop(); hoy.pop();
  return lav.concat(hoy);
}

// Arealet av et polygon [[x, y], …] (skolissformelen), alltid positivt.
export function areal2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

// Klipper et polygon til stripa ta ≤ x ≤ tb (Sutherland–Hodgman, to kanter).
export function klippX(poly, ta, tb) {
  const kant = (inn, side, grense) => {
    const ut = [];
    for (let i = 0; i < inn.length; i++) {
      const p = inn[i], q = inn[(i + 1) % inn.length];
      const pi = side * (p[0] - grense) >= 0, qi = side * (q[0] - grense) >= 0;
      if (pi) ut.push(p);
      if (pi !== qi) { const k = (grense - p[0]) / (q[0] - p[0]); ut.push([grense, p[1] + k * (q[1] - p[1])]); }
    }
    return ut;
  };
  let r = kant(poly, 1, Math.min(ta, tb));
  if (r.length) r = kant(r, -1, Math.max(ta, tb));
  return r.length >= 3 ? r : [];
}

// Minste omsluttende rektangel rundt punkter i plan (roterende kalipere på
// hylla): gir bygningens akser når det ikke finnes vegger å lese av.
export function minsteRektangel(pkt) {
  const h = hylle2(pkt);
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 1e-9) continue;
    const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const r of h) { const a = r[0] * ux + r[1] * uy, b = -r[0] * uy + r[1] * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const A = (a1 - a0) * (b1 - b0);
    if (!best || A < best.A - 1e-9) best = { A, u: [ux, uy], v: [-uy, ux], a0, a1, b0, b1 };
  }
  return best;
}

// Fire vegger rundt et rektangel (fra minsteRektangel), fra yb til yt.
export function flaterFraRektangel(rk, yb, yt) {
  if (!rk) return [];
  const P = (a, b) => [rk.u[0] * a + rk.v[0] * b, rk.u[1] * a + rk.v[1] * b];
  const side = (o, e, N, L) => ({ o, e, N, deler: [[[0, yb], [L, yb], [L, yt], [0, yt]]] });
  const La = rk.a1 - rk.a0, Lb = rk.b1 - rk.b0;
  return [
    side(P(rk.a0, rk.b0), rk.u, [-rk.v[0], -rk.v[1]], La),
    side(P(rk.a1, rk.b0), rk.v, rk.u, Lb),
    side(P(rk.a1, rk.b1), [-rk.u[0], -rk.u[1]], rk.v, La),
    side(P(rk.a0, rk.b1), [-rk.v[0], -rk.v[1]], [-rk.u[0], -rk.u[1]], Lb)
  ];
}

// Fire vindretninger etter BYGGETS akser: rett inn på den lengste flaten,
// så 90°, 180° og 270° videre. w er retningen vinden BLÅSER mot.
export function vindRetninger(flater) {
  let best = null, bestA = -1;
  for (const f of flater || []) {
    const A = (f.deler || []).reduce((s, d) => s + areal2(d), 0);
    if (A > bestA) { bestA = A; best = f; }
  }
  const n = best ? best.N : [0, 1];
  const w0 = [-n[0], -n[1]];
  const rot = (v, k) => { let x = v[0], y = v[1]; for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };
  return [0, 1, 2, 3].map(k => rot(w0, k));
}

// Hoveddelen: deler flatene i soner for vindretningen w og regner arealene.
// hTopp (valgfri) er toppen av bygget hvis taket stikker over veggene.
export function vindPaFlater(flater, w, hTopp) {
  const fl = (flater || []).filter(f => f && f.deler && f.deler.length);
  if (!fl.length) return null;
  const wl = Math.hypot(w[0], w[1]) || 1, wx = w[0] / wl, wz = w[1] / wl;
  const qx = -wz, qz = wx;                       // på tvers av vinden
  let s0 = Infinity, s1 = -Infinity, q0 = Infinity, q1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of fl) for (const d of f.deler) for (const [t, y] of d) {
    const x = f.o[0] + t * f.e[0], z = f.o[1] + t * f.e[1];
    const s = x * wx + z * wz, q = x * qx + z * qz;
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); q0 = Math.min(q0, q); q1 = Math.max(q1, q);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (Number.isFinite(hTopp) && hTopp > y1) y1 = hTopp;
  const d = s1 - s0, b = q1 - q0, h = y1 - y0;
  if (!(d > 0 && b > 0 && h > 0)) return null;
  const soner = veggSoner(b, d, h);
  const cpe = cpeVegg(h / d);
  const grenser = [["A", 0, soner.A], ["B", soner.A, soner.A + soner.B], ["C", soner.A + soner.B, d]];
  const deler = [];                               // { fi, sone, poly, areal }
  fl.forEach((f, fi) => {
    const c = f.N[0] * wx + f.N[1] * wz;
    if (c < -COS45 || c > COS45) {
      const sone = c < 0 ? "D" : "E";
      for (const p of f.deler) deler.push({ fi, sone, poly: p, areal: areal2(p) });
      return;
    }
    const ew = f.e[0] * wx + f.e[1] * wz;
    const os = f.o[0] * wx + f.o[1] * wz - s0;    // s = os + t·ew
    for (const [sone, sa, sb] of grenser) {
      if (!(sb - sa > 1e-9)) continue;
      for (const p of f.deler) {
        const k = Math.abs(ew) < 1e-9 ? (os >= sa && os <= sb ? p : []) : klippX(p, (sa - os) / ew, (sb - os) / ew);
        const A = k.length ? areal2(k) : 0;
        if (A > 1e-6) deler.push({ fi, sone, poly: k, areal: A });
      }
    }
  });
  // samlet per flate og sone
  const sum = new Map();
  for (const x of deler) {
    const k = x.fi + "|" + x.sone;
    if (!sum.has(k)) sum.set(k, { fi: x.fi, sone: x.sone, areal: 0 });
    sum.get(k).areal += x.areal;
  }
  return { b, d, h, s0, q0, y0, y1, w: [wx, wz], tvers: [qx, qz], soner, cpe, deler, perFlate: [...sum.values()] };
}

// Kraft på en sone: we · A (kN, med fortegn — positivt er trykk inn på veggen).
export const kraft = (qp, cpe, areal) => we(qp, cpe) * areal;

// ════════════════════════════════════════════════════════════════════════
// 🧱 HELE FASADEN, FRA TOPP TIL BUNN (Emil 06.10)
// «Vindlasten treffer hele overflaten av fasaden, så den bør dekke hele
// veggen — som om stålbygget var helt dekket av veggelementer fra topp til
// bunn, uten utsparinger.» Vinduer, porter og hull mellom elementene telles
// altså med (bruttoareal).
//
// Omrisset bygges av delene på fasaden:
//   • bunnen er den laveste foten
//   • toppen er den øvre konturen over alle delene (gavler og skråkapp
//     følges), og der det ikke står noe element (en port i full høyde)
//     trekkes toppen rett over fra naboene
// ════════════════════════════════════════════════════════════════════════
function toppVed(poly, t) {
  let y = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const a = Math.min(p[0], q[0]), b = Math.max(p[0], q[0]);
    if (t < a - 1e-9 || t > b + 1e-9) continue;
    if (b - a < 1e-9) y = Math.max(y, p[1], q[1]);
    else y = Math.max(y, p[1] + (t - p[0]) / (q[0] - p[0]) * (q[1] - p[1]));
  }
  return Number.isFinite(y) ? y : null;
}
export function fasadeOmriss(deler) {
  const dl = (deler || []).filter(d => d && d.length >= 3);
  if (!dl.length) return [];
  let yb = Infinity;
  const ts = [];
  for (const d of dl) for (const [t, y] of d) { yb = Math.min(yb, y); ts.push(t); }
  const u = [...new Set(ts.map(t => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  const t0 = u[0], t1 = u[u.length - 1];
  if (!(t1 - t0 > 1e-9)) return [];
  const eps = Math.max(1e-6, (t1 - t0) * 1e-7);
  const topp = (t) => { let y = null; for (const d of dl) { const v = toppVed(d, t); if (v != null && (y == null || v > y)) y = v; } return y; };
  // venstre og høyre side av hvert knekkpunkt, så trinn blir loddrette
  const pkt = [];
  u.forEach((t, i) => {
    const L = i > 0 ? topp(t - eps) : null, R = i < u.length - 1 ? topp(t + eps) : null;
    if (i > 0) pkt.push([t, L]);
    if (i < u.length - 1 && (i === 0 || R !== L)) pkt.push([t, R]);
  });
  // hull uten element (port i full høyde): rett linje mellom naboene
  for (let i = 0; i < pkt.length; i++) if (pkt[i][1] == null) {
    let a = i - 1; while (a >= 0 && pkt[a][1] == null) a--;
    let b = i + 1; while (b < pkt.length && pkt[b][1] == null) b++;
    const ya = a >= 0 ? pkt[a][1] : null, yb2 = b < pkt.length ? pkt[b][1] : null;
    pkt[i][1] = ya == null ? yb2 : yb2 == null ? ya
      : ya + (pkt[i][0] - pkt[a][0]) / ((pkt[b][0] - pkt[a][0]) || 1) * (yb2 - ya);
  }
  // fjern punkter som ligger på en rett linje
  const ren = [];
  for (const p of pkt) {
    if (ren.length >= 2) {
      const a = ren[ren.length - 2], b = ren[ren.length - 1];
      if (Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-9) ren.pop();
    }
    if (!ren.length || Math.abs(ren[ren.length - 1][0] - p[0]) > 1e-12 || Math.abs(ren[ren.length - 1][1] - p[1]) > 1e-12) ren.push(p);
  }
  return [[t0, yb], [t1, yb], ...ren.reverse()];
}
