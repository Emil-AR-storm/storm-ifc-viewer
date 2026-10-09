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
  // Emil 08.10 (sk,0 = 8 og sk,maks = 6 ga 4,80 kN/m² uten at noe sa fra)
  const maks = tall(v.skMaks);
  if (sk0 != null && maks != null && maks > 0 && sk0 > maks) ut.push({ tekst: "sk,0 ({0} kN/m²) er større enn sk,maks ({1} kN/m²). Da blir sk,maks brukt — sjekk begge tallene mot standarden eller RIB.", verdi: sk0, navn: String(maks).replace(".", ",") });
  const H = tall(v.H), Hg = tall(v.Hg);
  if (H != null && Hg != null && Math.abs(H - Hg) < 1e-9 && H > 0) ut.push({ tekst: "Hg er lik høyden over havet ({0} moh). Hg er kommunens grensehøyde fra standarden, ikke byggets høyde — sjekk tallet.", verdi: Hg });
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
//
// Emil 08.10 (bilde: søyleforlengerne var dekket, men ikke mellomrommet
// mellom dem): veggelementene går helt opp mellom forlengerne, så den delen
// av veggen tar også vind. Derfor STÅENDE (valgfri): toppene [t, y] av de
// stående delene i fasaden (søyler med forlengere). Mellom to naboer trekkes
// toppen som en rett linje fra topp til topp — aldri lavere enn delene selv.
// Stående deler som er under halvparten så høye som de høyeste (en dørstolpe)
// tas ikke med.
export function fasadeOmriss(deler, staende) {
  const dl = (deler || []).filter(d => d && d.length >= 3);
  if (!dl.length) return [];
  let yb = Infinity;
  const ts = [];
  for (const d of dl) for (const [t, y] of d) { yb = Math.min(yb, y); ts.push(t); }
  // Emil 08.10 (runde 4, bilde 3–4): toppen dukket ned mellom forlengerne,
  // fordi søyler som stopper under toppbjelka og de loddrette stavene i
  // fagverket også «sto». Nå:
  //   1. stående deler i samme søylepunkt (søyle + forlenger) er ÉN søyle,
  //      med samlet topp og fot
  //   2. bare søyler som går ned til foten av fasaden teller — en stav i
  //      fagverket henger i lufta og bærer ingen vegg
  //   3. toppen er den ØVRE HYLLA over søyletoppene: en søyle som er lavere
  //      enn linja mellom naboene (en vindsøyle under bjelka) drar ikke
  //      veggen ned — veggelementene går helt opp mellom forlengerne.
  let st = (staende || []).filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]))
    .map(q => [q[0], q[1], Number.isFinite(q[2]) ? q[2] : yb]).sort((a, b) => a[0] - b[0]);
  if (st.length) {
    const klynger = [];
    for (const q of st) {
      const k = klynger[klynger.length - 1];
      if (k && q[0] - k.t1 <= 0.3) { k.t1 = q[0]; k.tSum += q[0]; k.n++; k.topp = Math.max(k.topp, q[1]); k.fot = Math.min(k.fot, q[2]); }
      else klynger.push({ t1: q[0], tSum: q[0], n: 1, topp: q[1], fot: q[2] });
    }
    const hoyde = Math.max(...klynger.map(k => k.topp)) - yb;
    const grense = yb + Math.max(1, 0.15 * hoyde);
    const pkt = klynger.filter(k => k.fot <= grense).map(k => [k.tSum / k.n, k.topp]);
    st = ovreKontur(pkt);
    for (const q of st) ts.push(q[0]);
  }
  const u = [...new Set(ts.map(t => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  const t0 = u[0], t1 = u[u.length - 1];
  if (!(t1 - t0 > 1e-9)) return [];
  const eps = Math.max(1e-6, (t1 - t0) * 1e-7);
  const bro = (t) => {
    if (st.length < 2 || t < st[0][0] - 1e-9 || t > st[st.length - 1][0] + 1e-9) return null;
    for (let i = 1; i < st.length; i++) if (t <= st[i][0] + 1e-9) {
      const a = st[i - 1], b = st[i]; return a[1] + (t - a[0]) / ((b[0] - a[0]) || 1) * (b[1] - a[1]);
    }
    return null;
  };
  const topp = (t) => {
    let y = null; for (const d of dl) { const v = toppVed(d, t); if (v != null && (y == null || v > y)) y = v; }
    const b = bro(t); if (b != null && (y == null || b > y)) y = b;
    return y;
  };
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

// ════════════════════════════════════════════════════════════════════════
// 🏗 TAKET FRA STÅLET (Emil 08.10)
// Uten tak fra tak-generatoren la snøen seg som et flatt lokk på toppen av
// søyleforlengerne, og lokket stakk utenfor bygget. Regelen nå:
//   • STÅENDE elementer (søyler, søyleforlengere, alt som er mye høyere enn
//     det er bredt) bærer taket, men ER ikke taket — de telles ikke.
//   • Taket er den ØVRE KONTUREN av resten av stålet (takbjelker, fagverk,
//     åser), sett på tvers av mønet. Konturen er den øvre konvekse hylla, så
//     åser og fagverksknuter ikke gir et sagtak.
//   • Mønet ligger der konturen er høyest. Ligger det helt ute ved en kant,
//     er taket et pulttak; er begge sidene under 0,5°, er det flatt.
//   • Retningen: den av byggets to akser der taket heller mest.
// Ingenting her vet noe om én bestemt modell.
// ════════════════════════════════════════════════════════════════════════
const GRAD = Math.PI / 180;

// Står elementet? Søyler alltid; ellers når høyden er over dobbelt så stor
// som den største bredden i plan.
export function erStaende(pkt, tp) {
  if (String(tp || "").toUpperCase() === "COLUMN") return true;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, y, z] of pkt || []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (!Number.isFinite(y1)) return false;
  return (y1 - y0) > 2 * Math.max(x1 - x0, z1 - z0, 1e-9);
}

// Øvre kontur av punktene [s, y]: den øvre konvekse hylla, venstre → høyre.
export function ovreKontur(pkt) {
  const p = (pkt || []).filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1])).slice().sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const ut = [];
  const kr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (const q of p) {
    if (ut.length && Math.abs(ut[ut.length - 1][0] - q[0]) < 1e-9) continue;   // samme s: den høyeste kom først
    while (ut.length >= 2 && kr(ut[ut.length - 2], ut[ut.length - 1], q) >= -1e-12) ut.pop();
    ut.push(q);
  }
  return ut;
}
const yPaKontur = (k, s) => {
  if (!k.length) return NaN;
  if (s <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (s <= k[i][0]) {
    const a = k[i - 1], b = k[i]; return a[1] + (s - a[0]) / ((b[0] - a[0]) || 1) * (b[1] - a[1]);
  }
  return k[k.length - 1][1];
};

// Takprofilet på tvers av mønet, fra s0 til s1: { form, sm (mønet), y0, ym, y1, vinkel }
export function takProfil(pkt, s0, s1) {
  const k = ovreKontur(pkt);
  if (!k.length || !(s1 > s0)) return null;
  const L = s1 - s0;
  let im = 0; for (let i = 1; i < k.length; i++) if (k[i][1] > k[im][1] + 1e-9) im = i;
  // En rett linje gjennom hver side av konturen (minste kvadrater). Toppen selv
  // er ofte en ås eller en knute litt ved siden av mønet, så den tas bare med
  // når siden ellers har for få punkter.
  const linje = (q) => {
    if (!q.length) return null;
    if (q.length === 1) return { k: 0, m: q[0][1] };
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = q.length;
    for (const [x, y] of q) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx;
    if (Math.abs(d) < 1e-12) return { k: 0, m: sy / n };
    const kk = (n * sxy - sx * sy) / d; return { k: kk, m: (sy - kk * sx) / n };
  };
  // jevnt fordelte punkter langs konturen, uten endene: en kort knekk ved
  // takfoten eller ved mønet (enden av en ås, en fagverksknute) skal ikke
  // styre linja
  const prov = (a, b) => {
    if (!(b - a > 1e-6)) return [];
    const n = 60, q = [], m = (b - a) * 0.1;          // 10 % av hver ende holdes utenfor
    for (let i = 0; i <= n; i++) { const x = a + m + (b - a - 2 * m) * i / n; q.push([x, yPaKontur(k, x)]); }
    return q;
  };
  const venstre = linje(prov(k[0][0], k[im][0])), hoyre = linje(prov(k[im][0], k[k.length - 1][0]));
  const yv = (l, s) => l.k * s + l.m;
  let sm = k[im][0], ym = k[im][1];
  const LITE = Math.tan(0.25 * GRAD);
  const stigerV = venstre && venstre.k > LITE, fallerH = hoyre && hoyre.k < -LITE;
  if (stigerV && fallerH && Math.abs(venstre.k - hoyre.k) > 1e-9) {
    const x = (hoyre.m - venstre.m) / (venstre.k - hoyre.k);
    if (x > s0 && x < s1) { sm = x; ym = yv(venstre, x); }
  }
  const lv = venstre || hoyre, lh = hoyre || venstre;
  let y0 = lv ? yv(lv, s0) : yPaKontur(k, s0);
  let y1 = lh ? yv(lh, s1) : yPaKontur(k, s1);
  // mønet nær en kant (innenfor 10 %): pulttak fra den andre kanten
  if (sm - s0 < 0.1 * L || !stigerV) { sm = s0; ym = lh ? yv(lh, s0) : ym; }
  else if (s1 - sm < 0.1 * L || !fallerH) { sm = s1; ym = lv ? yv(lv, s1) : ym; }
  const v0 = sm > s0 ? Math.atan(Math.max(0, ym - y0) / (sm - s0)) / GRAD : 0;
  const v1 = s1 > sm ? Math.atan(Math.max(0, ym - y1) / (s1 - sm)) / GRAD : 0;
  const topp = Math.max(...k.map(q => q[1]));
  if (v0 < 0.5 && v1 < 0.5) return { form: "flatt", sm: s0, y0: topp, ym: topp, y1: topp, vinkel: 0 };
  if (sm === s0) return { form: "pult", sm, y0: ym, ym, y1, vinkel: v1 };
  if (sm === s1) return { form: "pult", sm, y0, ym, y1: ym, vinkel: v0 };
  return { form: "saltak", sm, y0, ym, y1, vinkel: Math.max(v0, v1) };
}

// Ny takvinkel på et profil (skrevet inn for hånd). Laveste takfot står fast.
export function profilMedVinkel(p, form, vinkel, s0, s1) {
  const tg = Math.tan(Math.max(0, Math.min(89, Number(vinkel) || 0)) * GRAD);
  const fot = Math.min(p.y0, p.y1);
  if (form === "flatt") return { form, sm: s0, y0: p.ym, ym: p.ym, y1: p.ym, vinkel: 0 };
  if (form === "pult") {
    // heller samme vei som stålet hvis det heller; ellers stiger det mot s1
    if (p.form === "pult" && p.sm === s0) return { form, sm: s0, y0: fot + tg * (s1 - s0), ym: fot + tg * (s1 - s0), y1: fot, vinkel };
    return { form, sm: s1, y0: fot, ym: fot + tg * (s1 - s0), y1: fot + tg * (s1 - s0), vinkel };
  }
  const sm = p.form === "saltak" ? p.sm : (s0 + s1) / 2;
  return { form: "saltak", sm, y0: fot + tg * 0, ym: fot + tg * Math.max(sm - s0, s1 - sm), y1: fot, vinkel,
    // to takflater med samme vinkel: takfoten på hver side regnes fra mønet
    yA: fot + tg * Math.max(sm - s0, s1 - sm) - tg * (sm - s0), yB: fot + tg * Math.max(sm - s0, s1 - sm) - tg * (s1 - sm) };
}

// Takflatene (meter) over rektangelet rk (fra minsteRektangel) for punktene
// [x, y, z] av takstålet. akse "v" = mønet langs u (profilet går langs v).
// Svar: { akse, profil, flater: [{ poly: [[x,y,z]…], alfa, arealPlan, arealSkraa }] }
export function takFraStal(pkt, rk, valg) {
  if (!rk || !pkt || !pkt.length) return null;
  const o = valg || {};
  const A = (p) => p[0] * rk.u[0] + p[2] * rk.u[1], B = (p) => p[0] * rk.v[0] + p[2] * rk.v[1];
  const prof = {
    v: takProfil(pkt.map(p => [B(p), p[1]]), rk.b0, rk.b1),
    u: takProfil(pkt.map(p => [A(p), p[1]]), rk.a0, rk.a1)
  };
  if (!prof.v && !prof.u) return null;
  // aksen der taket heller mest; likt (flatt): profilet på tvers av den lange siden
  const lang = (rk.a1 - rk.a0) >= (rk.b1 - rk.b0) ? "v" : "u";
  let akse = lang;
  if (prof.v && prof.u && Math.abs(prof.u.vinkel - prof.v.vinkel) > 0.25) akse = prof.u.vinkel > prof.v.vinkel ? "u" : "v";
  else if (!prof[akse]) akse = akse === "v" ? "u" : "v";
  const [s0, s1, c0, c1] = akse === "v" ? [rk.b0, rk.b1, rk.a0, rk.a1] : [rk.a0, rk.a1, rk.b0, rk.b1];
  let p = prof[akse];
  const vinkel = Number(o.vinkel);
  if (o.form && o.form !== "auto") p = profilMedVinkel(p, o.form, o.vinkel, s0, s1);
  else if (Number.isFinite(vinkel) && vinkel > 0) p = profilMedVinkel(p, p.form === "flatt" ? "saltak" : p.form, vinkel, s0, s1);
  const P = (s, c, y) => {
    const [a, b] = akse === "v" ? [c, s] : [s, c];
    return [rk.u[0] * a + rk.v[0] * b, y, rk.u[1] * a + rk.v[1] * b];
  };
  const flate = (sa, sb, ya, yb) => {
    const plan = (sb - sa) * (c1 - c0);
    const alfa = Math.atan(Math.abs(yb - ya) / ((sb - sa) || 1)) / GRAD;
    return { poly: [P(sa, c0, ya), P(sb, c0, yb), P(sb, c1, yb), P(sa, c1, ya)], alfa, arealPlan: plan, arealSkraa: plan / Math.cos(alfa * GRAD) };
  };
  const flater = [];
  if (p.form === "saltak" && p.sm > s0 && p.sm < s1) {
    flater.push(flate(s0, p.sm, p.yA ?? p.y0, p.ym), flate(p.sm, s1, p.ym, p.yB ?? p.y1));
  } else flater.push(flate(s0, s1, p.y0, p.y1));
  return { akse, profil: p, flater };
}

// ════════════════════════════════════════════════════════════════════════
// 🗺 BYGGETS OMRISS I PLAN (Emil 08.10)
// Bilde: vindsonene gikk tvers gjennom bygget. Bygget var en L (hall + tilbygg
// som er smalere), og fasadene ble lest som fire sider av et rektangel, eller
// som SW-generatorens fasadelinjer — også linja mellom hallen og tilbygget,
// som står INNE i bygget. Regelen nå: fasadene er kantene av byggets omriss,
// og omrisset er taket sett ovenfra (samme takflater som tak-generatoren
// finner av de øverste bjelkene). Det er likt med og uten veggelementer.
// Alt i meter, punkter [x, z].
// ════════════════════════════════════════════════════════════════════════
export function punktIPoly(p, poly) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inn = !inn;
  }
  return inn;
}
export function polyAreal2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
// Douglas–Peucker på en lukket ring
function forenkleRing(ring, tol) {
  if (ring.length < 4) return ring;
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-12;
    let maks = -1, im = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
      if (d > maks) { maks = d; im = i; }
    }
    if (maks <= tol) return [a, b];
    const v = dp(pts.slice(0, im + 1)), h = dp(pts.slice(im));
    return v.slice(0, -1).concat(h);
  };
  // del ringen i to ved punktet lengst fra det første
  let im = 0, dm = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > dm) { dm = d; im = i; } }
  const a = dp(ring.slice(0, im + 1)), b = dp(ring.slice(im).concat([ring[0]]));
  return a.slice(0, -1).concat(b.slice(0, -1));
}
// Omrisset av flere polygoner slått sammen (rutenett, så hull og overlapp
// mellom takflatene ikke spiller noen rolle). Svar: den største ringen, mot
// klokka sett ovenfra i (x, z), eller [] .
export function omrissAvPolygoner(polys, celle) {
  const P = (polys || []).filter(p => p && p.length >= 3);
  if (!P.length) return [];
  // byggets akse: den lengste kanten av den største flata
  let akse = [1, 0], best = -1;
  const storst = P.slice().sort((a, b) => Math.abs(polyAreal2(b)) - Math.abs(polyAreal2(a)))[0];
  for (let i = 0; i < storst.length; i++) {
    const p = storst[i], q = storst[(i + 1) % storst.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L > best) { best = L; akse = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; }
  }
  const [c, s] = akse;
  const rot = (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
  const tilbake = (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  const R = P.map(p => p.map(rot));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of R) for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const g = celle || Math.min(0.25, Math.max(0.05, Math.max(x1 - x0, z1 - z0) / 400));
  const nx = Math.ceil((x1 - x0) / g) + 2, nz = Math.ceil((z1 - z0) / g) + 2;
  const ox = x0 - g, oz = z0 - g;
  const fylt = new Uint8Array(nx * nz);
  for (const p of R) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of p) { a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, z); b1 = Math.max(b1, z); }
    for (let i = Math.max(0, Math.floor((a0 - ox) / g)); i <= Math.min(nx - 1, Math.ceil((a1 - ox) / g)); i++)
      for (let j = Math.max(0, Math.floor((b0 - oz) / g)); j <= Math.min(nz - 1, Math.ceil((b1 - oz) / g)); j++)
        if (!fylt[i * nz + j] && punktIPoly([ox + (i + 0.5) * g, oz + (j + 0.5) * g], p)) fylt[i * nz + j] = 1;
  }
  const F = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && fylt[i * nz + j] === 1;
  // kantene mellom fylt og tomt, rettet slik at det fylte ligger til venstre
  const neste = new Map();
  const k = (i, j) => i + "," + j;
  const leggTil = (a, b) => { const ka = k(a[0], a[1]); if (!neste.has(ka)) neste.set(ka, []); neste.get(ka).push(b); };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (!F(i, j)) continue;
    if (!F(i, j - 1)) leggTil([i, j], [i + 1, j]);
    if (!F(i + 1, j)) leggTil([i + 1, j], [i + 1, j + 1]);
    if (!F(i, j + 1)) leggTil([i + 1, j + 1], [i, j + 1]);
    if (!F(i - 1, j)) leggTil([i, j + 1], [i, j]);
  }
  const ringer = [];
  while (neste.size) {
    const start = neste.keys().next().value;
    const ring = [];
    let cur = start.split(",").map(Number);
    for (let n = 0; n < 1e6; n++) {
      const kc = k(cur[0], cur[1]);
      const l = neste.get(kc);
      if (!l || !l.length) break;
      const nx2 = l.pop(); if (!l.length) neste.delete(kc);
      ring.push(cur);
      cur = nx2;
      if (k(cur[0], cur[1]) === start) break;
    }
    if (ring.length >= 4) ringer.push(ring);
  }
  if (!ringer.length) return [];
  const verden = ringer.map(r => r.map(([i, j]) => [ox + i * g, oz + j * g]));
  verden.sort((a, b) => Math.abs(polyAreal2(b)) - Math.abs(polyAreal2(a)));
  let ring = forenkleRing(verden[0], g * 1.5);
  if (polyAreal2(ring) < 0) ring = ring.reverse();
  // Hjørnene festes til takflatenes egne hjørner når de ligger innenfor to
  // ruter — rutenettet skal ikke flytte en vegg 5 cm.
  const hj = R.flat();
  ring = ring.map(p => {
    let b = null, d = 2 * g;
    for (const q of hj) { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < d) { d = dd; b = q; } }
    if (b) return b.slice();
    // ellers hver akse for seg (et innvendig hjørne ligger på to kanter)
    let x = p[0], z = p[1], dx = 2 * g, dz = 2 * g;
    for (const q of hj) { if (Math.abs(q[0] - p[0]) < dx) { dx = Math.abs(q[0] - p[0]); x = q[0]; } if (Math.abs(q[1] - p[1]) < dz) { dz = Math.abs(q[1] - p[1]); z = q[1]; } }
    return [x, z];
  });
  return ring.map(tilbake);
}

// Kantene av omrisset som fasader: { o, e, N, L } (N peker UT av bygget).
// Kanter kortere enn minL tas ikke med.
export function fasaderFraOmriss(ring, minL) {
  const ut = [];
  const m = minL === undefined ? 0.5 : minL;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(L >= m)) continue;
    const e = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    let N = [e[1], -e[0]];
    const mid = [(p[0] + q[0]) / 2 + N[0] * 0.05, (p[1] + q[1]) / 2 + N[1] * 0.05];
    if (punktIPoly(mid, ring)) N = [-N[0], -N[1]];
    ut.push({ o: p, e, N, L });
  }
  return ut;
}

// Klipp et polygon (gjerne konkavt) med et KONVEKST polygon (Sutherland–Hodgman).
export function klippMedKonveks(poly, klipp) {
  let ut = poly.slice();
  const A = polyAreal2(klipp) >= 0 ? 1 : -1;
  for (let i = 0; i < klipp.length && ut.length; i++) {
    const a = klipp[i], b = klipp[(i + 1) % klipp.length];
    const inne = (p) => A * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-12;
    const inn = ut; ut = [];
    for (let j = 0; j < inn.length; j++) {
      const p = inn[j], q = inn[(j + 1) % inn.length];
      const pi = inne(p), qi = inne(q);
      if (pi) ut.push(p);
      if (pi !== qi) {
        const dx = q[0] - p[0], dz = q[1] - p[1];
        const d = (b[0] - a[0]) * dz - (b[1] - a[1]) * dx;
        const tt = Math.abs(d) < 1e-15 ? 0 : ((b[0] - a[0]) * (a[1] - p[1]) - (b[1] - a[1]) * (a[0] - p[0])) / d;
        ut.push([p[0] + tt * dx, p[1] + tt * dz]);
      }
    }
  }
  return ut.length >= 3 ? ut : [];
}

// ═══ Fasader som står INNE i bygget (reserve når omrisset ikke finnes) ═══
// Et punkt på fasaden er inne i bygget hvis en stråle rett UT fra det først
// treffer en annen fasade som vender SAMME vei — da står det bygg utenfor.
// Treffer strålen en fasade som vender MOT oss, er det luft imellom, og
// fasaden tar vind. Svar: for hver fasade, t-intervallene som er ute.
export function utsatteDeler(fl, steg) {
  const ds = steg || 0.5;
  const linje = (f) => {
    let a = Infinity, b = -Infinity;
    for (const d of f.deler) for (const [t] of d) { a = Math.min(a, t); b = Math.max(b, t); }
    return { a, b, ut: Number(f.ut) || 0 };
  };
  const L = fl.map(linje);
  return fl.map((f, i) => {
    const li = L[i];
    if (!(li.b > li.a)) return [];
    const n = Math.max(1, Math.ceil((li.b - li.a) / ds));
    const ute = [];
    for (let s = 0; s < n; s++) {
      const ta = li.a + (li.b - li.a) * s / n, tb = li.a + (li.b - li.a) * (s + 1) / n, tm = (ta + tb) / 2;
      const p = [f.o[0] + tm * f.e[0] + (li.ut + 0.02) * f.N[0], f.o[1] + tm * f.e[1] + (li.ut + 0.02) * f.N[1]];
      let naer = Infinity, vend = 0;
      fl.forEach((g, j) => {
        if (j === i) return;
        const lj = L[j];
        // g: q(u) = g.o + u·g.e + ut·g.N;  p + s·N = q(u)
        const det = f.N[0] * (-g.e[1]) - f.N[1] * (-g.e[0]);
        if (Math.abs(det) < 1e-9) return;
        const rx = g.o[0] + lj.ut * g.N[0] - p[0], rz = g.o[1] + lj.ut * g.N[1] - p[1];
        const s2 = (rx * (-g.e[1]) - rz * (-g.e[0])) / det;
        const u = (f.N[0] * rz - f.N[1] * rx) / det;
        if (s2 <= 1e-6 || u < lj.a - 1e-6 || u > lj.b + 1e-6) return;
        if (s2 < naer) { naer = s2; vend = f.N[0] * g.N[0] + f.N[1] * g.N[1]; }
      });
      const inne = Number.isFinite(naer) && vend > 0.5;
      if (inne) continue;
      if (ute.length && Math.abs(ute[ute.length - 1][1] - ta) < 1e-9) ute[ute.length - 1][1] = tb; else ute.push([ta, tb]);
    }
    return ute;
  });
}
