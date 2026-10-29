// 💥 KOLLISJONSKONTROLL — REGNINGEN (runde 6 / 9b, Emils valg A 29.10.2026).
//
// Ren geometri, uten DOM, S og three.js: testes i Node med kjente kasser.
//
// TO SLAGS KONTROLL
//   1. ARMERING MOT BETONG er IKKE en vanlig kollisjon. Armeringen SKAL ligge
//      inni betongen. Feil er (a) armering som stikker UTENFOR betongen og
//      (b) for liten OVERDEKNING (kravet kommer fra RIBs beskrivelse — det
//      gjettes ikke her, feltet står tomt til brukeren skriver det inn).
//      Punktene er hjørnene på stangas overflate, så avstanden fra et punkt
//      til betongflata ER overdekningen.
//   2. HARD KOLLISJON (stål, RIV, ARK mot betong): to legemer som går inn i
//      hverandre mer enn toleransen. Å ligge AN mot (fotplate på betong) er
//      ikke en kollisjon.
//
// Et LEGEME er { id, tri: Float32Array (9 tall per trekant, verdenskoord.),
// boks: [minX, minY, minZ, maxX, maxY, maxZ] }. Alle avstander i
// modellenheter; den som kaller gjør om til mm.

export function lagLegeme(id, tri, info) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
  }
  const l = Object.assign({ id, tri, boks: b }, info || {});
  l.grov = !erLukket(tri, b);
  return l;
}
// ER LEGEMET HELT? Strålene teller bare riktig når meshen er lukket.
// Lørenskog 29.10: én vegg hadde 11 trekanter (én flate mangler) og en ringmur
// hadde «volum» 4,6 ganger sin egen boks. For slike brukes BOKSEN — grovere,
// men aldri et falskt «utenfor» midt i en vegg.
export function erLukket(tri, b) {
  if (tri.length < 36) return false;          // færre enn 4 trekanter kan ikke lukke noe
  // Volumet regnes fra origo; flytt til boksens hjørne for å slippe store tall
  const bv = (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
  const v = Math.abs(volumFra(tri, b[0], b[1], b[2]));
  if (!(bv > 0) || !(v > 0) || v > bv * 1.02) return false;
  // Hver kant skal deles av et jevnt antall trekanter (0,1 ‰ av boksen som rutenett)
  const q = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1e-4 || 1e-6;
  const pk = (i) => Math.round(tri[i] / q) + ":" + Math.round(tri[i + 1] / q) + ":" + Math.round(tri[i + 2] / q);
  const kanter = new Map();
  for (let i = 0; i < tri.length; i += 9) {
    const a = pk(i), c = pk(i + 3), d = pk(i + 6);
    for (const [x, y] of [[a, c], [c, d], [d, a]]) { if (x === y) continue; const k = x < y ? x + "|" + y : y + "|" + x; kanter.set(k, (kanter.get(k) || 0) + 1); }
  }
  let aapne = 0;
  for (const n of kanter.values()) if (n & 1) aapne++;
  return aapne <= kanter.size * 0.02;   // litt slark for T-skjøter i geometrien
}
function volumFra(t, ox, oy, oz) {
  let s = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i] - ox, ay = t[i + 1] - oy, az = t[i + 2] - oz, bx = t[i + 3] - ox, by = t[i + 4] - oy, bz = t[i + 5] - oz, cx = t[i + 6] - ox, cy = t[i + 7] - oy, cz = t[i + 8] - oz;
    s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return s / 6;
}

const iBoks = (b, x, y, z, m) => x >= b[0] - m && x <= b[3] + m && y >= b[1] - m && y <= b[4] + m && z >= b[2] - m && z <= b[5] + m;
const boksAvstand = (b, x, y, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5]));
const bokserOverlapper = (a, b, m) => a[0] <= b[3] + m && b[0] <= a[3] + m && a[1] <= b[4] + m && b[1] <= a[4] + m && a[2] <= b[5] + m && b[2] <= a[5] + m;

// ---------- Rutenett: hvilke legemer kan ligge ved et punkt? ----------
export function lagRutenett(legemer, celle) {
  const c = Number(celle) > 0 ? Number(celle) : 1;
  const kart = new Map();
  const nk = (i, j, k) => i + "," + j + "," + k;
  for (const l of legemer) {
    const b = l.boks;
    for (let i = Math.floor(b[0] / c); i <= Math.floor(b[3] / c); i++)
      for (let j = Math.floor(b[1] / c); j <= Math.floor(b[4] / c); j++)
        for (let k = Math.floor(b[2] / c); k <= Math.floor(b[5] / c); k++) {
          const n = nk(i, j, k);
          if (!kart.has(n)) kart.set(n, []);
          kart.get(n).push(l);
        }
  }
  return {
    celle: c,
    ved(x, y, z) { return kart.get(nk(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c))) || []; },
    // legemer innen r fra punktet (via cellene rundt)
    naer(x, y, z, r) {
      const ut = new Set();
      for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
        for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++)
          for (let k = Math.floor((z - r) / c); k <= Math.floor((z + r) / c); k++)
            for (const l of kart.get(nk(i, j, k)) || []) ut.add(l);
      return [...ut];
    }
  };
}

// ---------- Strålen: er punktet inni legemet? ----------
// Teller skjæringer langs en skrå retning (ikke langs en akse: da ville
// strålen ofte truffet en kant eller et hjørne og telt dobbelt). Oddetall = inni.
// TRE stråler i ulike retninger, og flertallet avgjør: IFC-geometri er ikke
// alltid helt lukket (Lørenskog: en vegg med 11 trekanter — én mangler), og
// én stråle som går ut gjennom hullet ville ellers snudd svaret.
const norm = (d) => { const n = Math.hypot(...d); return d.map(x => x / n); };
const DIRS = [norm([1, 0.000317, 0.000731]), norm([-0.000419, 1, 0.000283]), norm([0.000613, -0.000271, -1])];
export function inniLegeme(l, x, y, z) {
  if (!iBoks(l.boks, x, y, z, 0)) return false;
  if (l.grov) return true;   // ufullstendig geometri: boksen avgjør (se erLukket)
  const t = l.tri;
  let ja = 0;
  for (let k = 0; k < 3; k++) {
    const d = DIRS[k];
    let n = 0;
    for (let i = 0; i < t.length; i += 9) if (straaleTreffer(x, y, z, d, t, i)) n++;
    if (n & 1) ja++;
    if (ja >= 2) return true;
    if (k - ja >= 1 && k === 1) return false;   // to nei
  }
  return ja >= 2;
}
// Möller–Trumbore, bare t > 0
function straaleTreffer(ox, oy, oz, d, t, i) {
  const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
  const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-15) return false;
  const inv = 1 / det;
  const sx = ox - t[i], sy = oy - t[i + 1], sz = oz - t[i + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  return (e2x * qx + e2y * qy + e2z * qz) * inv > 1e-12;
}

// ---------- Nærmeste punkt på en trekant (Ericson) ----------
export function naermestPaaTrekant(px, py, pz, t, i, ut) {
  const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const sett = (x, y, z) => { ut[0] = x; ut[1] = y; ut[2] = z; return ut; };
  if (d1 <= 0 && d2 <= 0) return sett(ax, ay, az);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sett(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return sett(ax + v * abx, ay + v * aby, az + v * abz); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sett(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return sett(ax + w * acx, ay + w * acy, az + w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return sett(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return sett(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}
// Korteste avstand fra punktet til flata på legemet (+ trekanten den ligger på)
export function avstandTilFlate(l, x, y, z, grense) {
  const t = l.tri, q = [0, 0, 0];
  let best = Infinity, bi = -1;
  const g = grense == null ? Infinity : grense;
  for (let i = 0; i < t.length; i += 9) {
    // Rask utsiling: trekantens egen boks
    const mnx = Math.min(t[i], t[i + 3], t[i + 6]), mxx = Math.max(t[i], t[i + 3], t[i + 6]);
    const mny = Math.min(t[i + 1], t[i + 4], t[i + 7]), mxy = Math.max(t[i + 1], t[i + 4], t[i + 7]);
    const mnz = Math.min(t[i + 2], t[i + 5], t[i + 8]), mxz = Math.max(t[i + 2], t[i + 5], t[i + 8]);
    const db = Math.hypot(Math.max(mnx - x, 0, x - mxx), Math.max(mny - y, 0, y - mxy), Math.max(mnz - z, 0, z - mxz));
    if (db >= best || db > g) continue;
    naermestPaaTrekant(x, y, z, t, i, q);
    const d = Math.hypot(q[0] - x, q[1] - y, q[2] - z);
    if (d < best) { best = d; bi = i; }
  }
  return { avstand: best, tri: bi };
}

// ---------- 1. Armering mot betong ----------
// stenger: [{ id, pts: Float32Array (x,y,z …) }] · betong: legemer
// o: { tol (modellenheter, punkt nærmere flata enn dette regnes som inni),
//      overdekning (modellenheter, 0/tom = ikke kontrollert), celle }
// Svar per stang med funn: { id, ute, total, maksUte, punkt:[x,y,z], ved (legeme-id),
//   minOverdekning, overdekningPunkt, ved2 }
export function kontrollerArmering(stenger, betong, o) {
  const opt = o || {};
  const tol = Number(opt.tol) || 0, krav = Number(opt.overdekning) || 0;
  const nett = opt.nett || lagRutenett(betong, opt.celle || 1);
  const sok = Number(opt.sok) || (opt.celle || 1) * 2;   // hvor langt vi leter etter nærmeste betong
  const ut = [];
  const kantPkt = [0, 0, 0];
  for (const s of stenger) {
    const p = s.pts;
    let ute = 0, maks = 0, verst = null, ved = null, minOd = Infinity, odPkt = null, ved2 = null;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      let inni = null;
      for (const l of nett.ved(x, y, z)) if (inniLegeme(l, x, y, z)) { inni = l; break; }
      if (!inni) {
        // Utenfor: hvor langt fra nærmeste betongflate? (innen toleransen = ok)
        let best = Infinity, bl = null;
        for (const l of nett.naer(x, y, z, Math.max(tol, sok))) {
          if (boksAvstand(l.boks, x, y, z) >= best) continue;
          const a = avstandTilFlate(l, x, y, z, best).avstand;
          if (a < best) { best = a; bl = l; }
        }
        if (best <= tol) continue;
        ute++;
        if (best > maks) { maks = best; verst = [x, y, z]; ved = bl ? bl.id : null; }
        continue;
      }
      if (!krav || inni.grov) continue;   // overdekning krever hel geometri
      // Overdekning: avstand til flata på legemet punktet ligger i — men bare
      // til YTTERflater. En flate der det er betong på begge sider (vegg mot
      // dekke) er en støpeskjøt, ikke en overflate, og teller ikke.
      const t = inni.tri;
      let best = Infinity;
      for (let i2 = 0; i2 < t.length; i2 += 9) {
        naermestPaaTrekant(x, y, z, t, i2, kantPkt);
        const d = Math.hypot(kantPkt[0] - x, kantPkt[1] - y, kantPkt[2] - z);
        if (d >= best || d >= krav) continue;
        if (!erYtterflate(t, i2, kantPkt, inni, nett, tol)) continue;
        best = d;
      }
      if (best < minOd) { minOd = best; odPkt = [x, y, z]; ved2 = inni.id; }
    }
    const funnUte = ute > 0, funnOd = krav > 0 && minOd < krav;
    if (funnUte || funnOd) ut.push({ id: s.id, ute, total: p.length / 3, maksUte: maks, punkt: verst || odPkt, ved,
      minOverdekning: funnOd ? minOd : null, overdekningPunkt: odPkt, ved2: funnOd ? ved2 : null, ute_: funnUte, od_: funnOd });
  }
  return ut;
}
// Ligger det betong på utsida av denne flata? Da er den en skjøt.
function erYtterflate(t, i, q, eget, nett, tol) {
  const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
  const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const n = Math.hypot(nx, ny, nz) || 1; nx /= n; ny /= n; nz /= n;
  const e = Math.max(tol * 2, 1e-6) || 1e-3;
  // Uteside = den sida av flata som ikke er inni eget legeme
  let ox = q[0] + nx * e, oy = q[1] + ny * e, oz = q[2] + nz * e;
  if (inniLegeme(eget, ox, oy, oz)) { ox = q[0] - nx * e; oy = q[1] - ny * e; oz = q[2] - nz * e; }
  for (const l of nett.ved(ox, oy, oz)) if (l !== eget && inniLegeme(l, ox, oy, oz)) return false;
  return true;
}

// ---------- 2. Hard kollisjon ----------
// a, b: legemer. Svar: { a, b, dybde, punkt } når de går inn i hverandre mer
// enn tol, ellers null. Prøver hjørnene til hver av dem inni den andre, og
// kantene til a gjennom flatene til b (en bjelke gjennom en vegg har ingen
// hjørner inni veggen).
export function hardKollisjon(a, b, tol) {
  const m = Number(tol) || 0;
  if (!bokserOverlapper(a.boks, b.boks, -m)) return null;
  let dybde = 0, punkt = null;
  const prov = (fra, til) => {
    const t = fra.tri;
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i], y = t[i + 1], z = t[i + 2];
      if (!iBoks(til.boks, x, y, z, -m)) continue;
      if (!inniLegeme(til, x, y, z)) continue;
      const d = avstandTilFlate(til, x, y, z).avstand;
      if (d > m && d > dybde) { dybde = d; punkt = [x, y, z]; }
    }
  };
  prov(a, b); prov(b, a);
  if (!punkt) {
    // Ingen hjørner inni den andre (bjelke tvers gjennom en vegg, vegg som
    // står i en bjelke): prøv et rutenett av punkter i overlappet mellom
    // boksene. Et punkt inni BEGGE, mer enn tol fra begge flatene, er en kollisjon.
    const A = a.boks, B = b.boks;
    const lo = [Math.max(A[0], B[0]), Math.max(A[1], B[1]), Math.max(A[2], B[2])];
    const hi = [Math.min(A[3], B[3]), Math.min(A[4], B[4]), Math.min(A[5], B[5])];
    const N = 10;
    const steg = [0, 1, 2].map(k => (hi[k] - lo[k]) / N);
    for (let i = 0; i < N && !punkt; i++) for (let j = 0; j < N && !punkt; j++) for (let k = 0; k < N; k++) {
      const x = lo[0] + steg[0] * (i + 0.5), y = lo[1] + steg[1] * (j + 0.5), z = lo[2] + steg[2] * (k + 0.5);
      if (!inniLegeme(a, x, y, z) || !inniLegeme(b, x, y, z)) continue;
      const d = Math.min(avstandTilFlate(a, x, y, z).avstand, avstandTilFlate(b, x, y, z).avstand);
      if (d > m && d > dybde) { dybde = d; punkt = [x, y, z]; }
    }
  }
  return punkt ? { a: a.id, b: b.id, dybde, punkt } : null;
}
function straaleAvstand(ox, oy, oz, d, t, i) {
  const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
  const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-15) return null;
  const inv = 1 / det;
  const sx = ox - t[i], sy = oy - t[i + 1], sz = oz - t[i + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
// Alle par (a i lagA, b i lagB) som kolliderer. nett over lagB.
export function kontrollerHard(lagA, lagB, o) {
  const opt = o || {};
  const tol = Number(opt.tol) || 0;
  const ut = [];
  for (const a of lagA) {
    for (const b of lagB) {
      if (!bokserOverlapper(a.boks, b.boks, -tol)) continue;
      const k = hardKollisjon(a, b, tol);
      if (k) ut.push(k);
    }
  }
  return ut;
}

// ---------- Hvilke elementer er hva ----------
// navn + materiale + IFC-type → "armering" | "betong" | "isolasjon" | "annet"
const ISO = /(isolasjon|insulation|\bEPS\b|\bXPS\b|mineralull|steinull|glava|rockwool|isopor|skumplast|\bPIR\b)/i;
const BET = /(betong|concrete|fundament|såle|ringmur|hulldekke|plasstøpt|prefab|\bB\d{2}\b|\bC\d{2}\/\d{2}\b)/i;
const BETONG_TYPER = /^(Ifc)?(Slab|Wall|WallStandardCase|Column|Beam|Footing|Pile|Stair|Ramp|Roof)$/i;
export function elementArt(navn, materiale, type) {
  const t = String(type || "");
  if (/^(Ifc)?(ReinforcingBar|ReinforcingMesh|Tendon)$/i.test(t)) return "armering";
  const s = String(materiale || "") + " " + String(navn || "");
  if (ISO.test(s)) return "isolasjon";
  if (/^(Ifc)?(BuildingElementProxy|Space|Annotation|Grid|OpeningElement|VirtualElement)$/i.test(t)) return "annet";
  if (BET.test(s)) return "betong";
  if (BETONG_TYPER.test(t) && !String(materiale || "").trim()) return "betong";
  return "annet";
}

// ---------- Funnene: id, tekst, status ----------
// id er stabil mellom kjøringer: kontroll · lag-fil · GlobalId (· GlobalId).
export const funnId = (art, lagFil, gidA, gidB) => [art, lagFil, gidA || "", gidB || ""].join("|");
export const STATUSER = ["ny", "godkjent", "lost"];
export function vaskStatus(p) {
  if (!p || typeof p !== "object" || !p.id) return null;
  return { id: String(p.id).slice(0, 400), status: STATUSER.includes(p.status) ? p.status : "ny",
    kommentar: String(p.kommentar || "").slice(0, 300), endret: String(p.endret || "").slice(0, 40), av: String(p.av || "").slice(0, 80) };
}
// Nye funn + lagrede statuser → lista som vises. Funn som var Ny/Godkjent og
// ikke kommer igjen, er LØST (RIB har rettet modellen).
export function slaaSammen(funn, lagret, kontrollerte) {
  const st = new Map((lagret || []).map(vaskStatus).filter(Boolean).map(p => [p.id, p]));
  const her = new Set(funn.map(f => f.id));
  const ut = funn.map(f => {
    const s = st.get(f.id);
    const status = s && s.status === "godkjent" ? "godkjent" : "ny";   // løst som kommer igjen er ny igjen
    return Object.assign({}, f, { status, kommentar: s ? s.kommentar : "" });
  });
  const nyLost = [];
  const kontr = new Set(kontrollerte || []);
  for (const [id, s] of st) {
    if (her.has(id) || s.status === "lost") continue;
    const lagFil = id.split("|")[1];
    if (kontr.size && !kontr.has(lagFil)) continue;   // den kontrollen ble ikke kjørt nå
    nyLost.push(Object.assign({}, s, { status: "lost" }));
  }
  return { funn: ut, nyLost };
}
export function telling(funn) {
  const t = { ny: 0, godkjent: 0, lost: 0 };
  for (const f of funn) t[f.status] = (t[f.status] || 0) + 1;
  return t;
}
export const mm = (x, toM) => Math.round((Number(x) || 0) * (Number(toM) || 1) * 1000);
