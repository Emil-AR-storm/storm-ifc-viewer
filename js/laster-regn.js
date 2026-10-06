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
