// 🧱 STILLAS — den rene regningen (Emil 08.10). Ingen DOM, ingen three.js.
//
// Ett riggobjekt «Stillas» som kan være:
//   · NORMALT (linje): settes ut som brakkeriggen — felt side om side
//     (`moduler`) og etasjer oppå hverandre.
//   · LUKKET: et omriss med skjøter som byggegjerdet (`punkter`), lagt rundt
//     bygget. Punktene er stillasets INNERKANT (mot veggen).
// og som kan være ALUMINIUM (ferdige rammer, plate 3×1 m) eller HAKI (løse
// bein, horisontaler og planker 3×0,25 m).
//
// HELE STILLASET ER ÉN LISTE MED DELER (stillasDeler). 3D-modellen tegner
// lista (stillas-modell.js), og mengdelista teller den (stillasMengder). Da kan
// de aldri bli uenige: det som står i bildet, er det som bestilles.
//
// Reglene er avklart med Emil 08.10 (prøvebildene i _proto/stillas-prove.html,
// «Storm IFC-Viewer byggeplan Rigg stillas PLAN 2026-10-08»):
//   · Utvendig hjørne: hjørneruta (B × B) stikker ut i forlengelsen av sida,
//     så du går rundt hjørnet. To vanlige rammer møtes — ingen hjørneramme.
//   · Innvendig hjørne: begge sidene stopper B før hjørnet, og ruta mellom dem
//     får en hjørneplate (variant 2 — samme regel som de utvendige).
//   · Rekkverk (hoved + kne) på utsiden av hvert plan og på toppen; innvendig
//     bare når det er slått på. Endene på et stillas på linje har rekkverk.
//   · Trappetårn UTENPÅ, to plater dypt, løpene annenhver side, repos i hver
//     ende. Stillasets eget rekkverk og fotlist er borte i trappefeltet.
//   · Plate med stige: luke i enden av plata, stigen henger under på skrå.
//   · Forholdstall (kan endres per stillas): diagonal hvert 5. felt,
//     forankring 4 × 4 m, rekkverk 1,0 m med knelist 0,5 m.
// Målene på trapp, luke og stige er typiske, ikke sjekket mot Haki eller
// Layher {Source not found}.
//
// Alt her testes i Node (_test/test-stillas.mjs).

export const STILLAS_STD = {
  L: 3.0, B: 1.0, H: 2.0,             // feltlengde, bredde, etasjehøyde
  plankeB: 0.25,                      // Haki: planker 3 × 0,25 m
  rekkverkH: 1.0, kneH: 0.5,
  diagonalHvert: 5, forankringBort: 4, forankringOpp: 4,
  repos: 0.5,                         // reposets lengde i hver ende av trappetårnet
  luke: 0.6,                          // luka i plata med stige
  skrueMaks: 0.5,                     // så langt bunnskruen skrus ut (typisk, ikke datablad)
  bunnRammeSteg: 0.5                  // ekstra rammehøyde nederst kommer i trinn på 0,5 m (typisk)
};
// Feltlengdene som finnes på lager (Emil 09.10): hvert felt snappes til den
// nærmeste av disse. Under den korteste → den korteste. Kan endres per stillas.
export const STILLAS_FASTE = [3.0, 2.5, 2.0];
export const STILLAS_MAKS_ETASJER = 20;
export const STILLAS_MAKS_FELT = 60;
export const STILLAS_FORMER = ["linje", "lukket"];
export const STILLAS_SYSTEM = ["alu", "haki"];
export const STILLAS_VISNING = ["forenklet", "fargekodet"];

// Fargene i den fargekodede visningen — de SAMME står foran radene i
// mengdelista, så du kan sjekke tellingen mot bildet.
export const STILLAS_FARGER = {
  ramme: "#3b82f6", spire: "#3b82f6", hor: "#7dd3fc", plate: "#facc15", planke: "#facc15",
  rekk: "#ef4444", fot: "#f97316", diag: "#a855f7", trapp: "#22c55e", stige: "#14b8a6",
  skrue: "#9ca3af", anker: "#f5f5f5"
};

// Navnene på deltypene (norsk = i18n-nøkkel)
export const STILLAS_DELNAVN = {
  ramme: "Ramme", spire: "Stillasbein", horLangs: "Horisontal", horTverr: "Horisontal (tverr)",
  bunnskrue: "Bunnskrue med fotplate", plate: "Plate", hjorneplate: "Hjørneplate",
  planke: "Planke", hjorneplanke: "Hjørneplanke", stigeplate: "Plate med stige", stige: "Stige",
  rekkverk: "Rekkverk", stolpe: "Rekkverksstolpe", fotlist: "Fotlist", diagonal: "Diagonalstag",
  forankring: "Veggforankring", trappelop: "Trappeløp", repos: "Repos", handlist: "Håndlist"
};
export const STILLAS_DELREKKEFOLGE = ["ramme", "spire", "horLangs", "horTverr", "bunnskrue", "plate", "hjorneplate",
  "planke", "hjorneplanke", "stigeplate", "stige", "trappelop", "repos", "handlist", "rekkverk", "stolpe", "fotlist",
  "diagonal", "forankring"];

const tall = (v) => (typeof v === "number" && Number.isFinite(v)) ? v
  : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(String(v).replace(",", ".")))) ? Number(String(v).replace(",", ".")) : null;
const heltall = (v, min, maks, std) => { const n = tall(v); return n == null ? std : Math.max(min, Math.min(maks, Math.round(n))); };
const mal = (v, min, maks, std) => { const n = tall(v); return n == null || n <= 0 ? std : Math.round(Math.max(min, Math.min(maks, n)) * 1000) / 1000; };
const r3 = (v) => Math.round(v * 1000) / 1000;

// Feltene som bare stillaset har. `ut` er det vaskede objektet fra
// vaskRiggObjekt (id, E, N, L, B, H …); dette legger stillasfeltene på.
export function vaskStillasFelt(p, ut) {
  ut.form = p.form === "lukket" ? "lukket" : "linje";
  ut.system = p.system === "haki" ? "haki" : "alu";
  ut.visning = p.visning === "fargekodet" ? "fargekodet" : "forenklet";
  ut.etasjer = heltall(p.etasjer, 1, STILLAS_MAKS_ETASJER, 3);
  ut.faste = vaskFaste(p.faste);
  // feltlengden er alltid en av de faste lengdene (2,47 → 2,5)
  if (typeof ut.L === "number") ut.L = snapLengde(ut.L, ut.faste);
  ut.moduler = heltall(p.moduler, 1, STILLAS_MAKS_FELT, 4);
  // etasjene som er arbeidsplan med plater; tomt/ugyldig → alle
  const plan = Array.isArray(p.plan) ? [...new Set(p.plan.map(Number).filter(k => Number.isInteger(k) && k >= 1 && k <= ut.etasjer))].sort((a, b) => a - b) : null;
  ut.plan = plan && plan.length ? plan : Array.from({ length: ut.etasjer }, (_, i) => i + 1);
  ut.rekkverkH = mal(p.rekkverkH, 0.5, 2, STILLAS_STD.rekkverkH);
  ut.kneH = mal(p.kneH, 0.1, ut.rekkverkH - 0.05, Math.min(STILLAS_STD.kneH, ut.rekkverkH - 0.05));
  ut.innvendig = p.innvendig === true;
  ut.plankeB = mal(p.plankeB, 0.1, 1, STILLAS_STD.plankeB);
  ut.diagonalHvert = heltall(p.diagonalHvert, 1, 50, STILLAS_STD.diagonalHvert);
  ut.forankringBort = mal(p.forankringBort, 1, 20, STILLAS_STD.forankringBort);
  ut.forankringOpp = mal(p.forankringOpp, 1, 20, STILLAS_STD.forankringOpp);
  const plass = (q, mEtg) => q && typeof q === "object" && Number.isInteger(q.side) && q.side >= 0 && Number.isInteger(q.felt) && q.felt >= 0 &&
    (!mEtg || (Number.isInteger(q.etg) && q.etg >= 1 && q.etg <= ut.etasjer));
  ut.trapper = (Array.isArray(p.trapper) ? p.trapper : []).filter(q => plass(q)).slice(0, 20)
    .map(q => ({ side: q.side, felt: q.felt, til: heltall(q.til, 1, ut.etasjer, ut.etasjer) }));
  ut.stigeplater = (Array.isArray(p.stigeplater) ? p.stigeplater : []).filter(q => plass(q, true)).slice(0, 200)
    .map(q => ({ side: q.side, felt: q.felt, etg: q.etg }));
  return ut;
}

// ═══════════════════════ FASTE LENGDER ═══════════════════════
// «3,0 2,5 2,0» (tekst fra skjemaet) eller [3, 2.5, 2] → sortert synkende,
// unike, 0,3–6 m, maks 10. Tomt/ugyldig → standard.
export function vaskFaste(v) {
  let liste = Array.isArray(v) ? v : typeof v === "string" ? v.trim().split(/[\s;\/]+/) : [];
  liste = liste.map(x => tall(x)).filter(x => x != null && x >= 0.3 && x <= 6).map(x => Math.round(x * 100) / 100);
  liste = [...new Set(liste)].sort((a, b) => b - a).slice(0, 10);
  return liste.length ? liste : STILLAS_FASTE.slice();
}

// Nærmeste faste lengde. Midt mellom to → den lengste. Under den korteste →
// den korteste, over den lengste → den lengste.
export function snapLengde(v, faste) {
  const F = faste && faste.length ? faste : STILLAS_FASTE;
  let best = F[0];
  for (const f of F) if (Math.abs(f - v) < Math.abs(best - v) - 1e-9 || (Math.abs(Math.abs(f - v) - Math.abs(best - v)) <= 1e-9 && f > best)) best = f;
  return best;
}

// Feltene langs en side på `eff` meter, bare med faste lengder (ikke lengre
// enn `maks`): så få felt at ingen blir for lange, hvert felt snappet til
// nærmeste faste lengde, og så justeres ett og ett felt opp eller ned til
// summen kommer nærmest sida. `ikkeOver` = sida ender i et innvendig hjørne:
// da må stillaset ikke gå forbi (det ville kollidert med naboen).
export function stillasFeltLengder(eff, faste, maks, ikkeOver) {
  let F = (faste && faste.length ? faste : STILLAS_FASTE).filter(f => !(maks > 0) || f <= maks + 1e-9);
  if (!F.length) F = [Math.min(...(faste && faste.length ? faste : STILLAS_FASTE))];
  F = F.slice().sort((a, b) => b - a);
  const n = Math.max(1, Math.min(STILLAS_MAKS_FELT * 4, Math.ceil(eff / F[0] - 1e-6)));
  const f = Array(n).fill(snapLengde(eff / n, F));
  const kost = (d) => Math.abs(d) + (ikkeOver && d > 0.005 ? 100 + d : 0);
  for (let runde = 0; runde < n * F.length + 2; runde++) {
    const sum = f.reduce((a, b) => a + b, 0), d = sum - eff;
    if (Math.abs(d) < 1e-6) break;
    let bedre = null;
    for (const v of new Set(f)) {
      const j = F.indexOf(v);
      for (const ny of [F[j - 1], F[j + 1]]) {
        if (ny == null) continue;
        const k = kost(d - v + ny);
        if (k < kost(d) - 1e-9 && (!bedre || k < bedre.k)) bedre = { k, v, ny };
      }
    }
    if (!bedre) break;
    f[f.indexOf(bedre.v)] = bedre.ny;
  }
  return f.sort((a, b) => b - a).map(r3);
}

// ═══════════════════════ SIDENE ═══════════════════════
// Hver side: { i, p0, p1, e, n, L, start, slutt } i objektets egen ramme
// (meter, x og z). e = retningen langs sida, n = utover (bort fra veggen).
// `start`/`slutt` er hvor langt inn fra p0/p1 sida faktisk begynner/slutter
// (innvendige hjørner kutter B). `hjorne` = "ut" | "inn" | null ved p1.

function innenfor(px, pz, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > pz) !== (b.z > pz) && px < (b.x - a.x) * (pz - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export function stillasSider(o) {
  const B = o.B;
  if (o.form !== "lukket" || !Array.isArray(o.punkter) || o.punkter.length < 3) {
    const tot = (o.moduler || 1) * o.L;
    return [medFelter({ i: 0, p0: { x: -tot / 2, z: -B / 2 }, p1: { x: tot / 2, z: -B / 2 }, e: { x: 1, z: 0 }, n: { x: 0, z: 1 },
      L: tot, start: 0, slutt: 0, hjorne: null, lukket: false }, Array(o.moduler || 1).fill(o.L))];
  }
  const p = o.punkter, N = p.length;
  const sider = [];
  for (let i = 0; i < N; i++) {
    const a = p[i], b = p[(i + 1) % N];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) { sider.push(null); continue; }
    const e = { x: dx / L, z: dz / L };
    let n = { x: -e.z, z: e.x };
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (innenfor(mx + n.x * 0.01, mz + n.z * 0.01, p)) n = { x: -n.x, z: -n.z };
    sider.push({ i, p0: a, p1: b, e, n, L, start: 0, slutt: 0, hjorne: null, lukket: true });
  }
  const gyldige = sider.filter(Boolean);
  for (let k = 0; k < gyldige.length; k++) {
    const s = gyldige[k], nx = gyldige[(k + 1) % gyldige.length];
    const d = s.n.x * nx.e.x + s.n.z * nx.e.z;       // −1 utvendig, +1 innvendig, 0 rett
    if (d < -0.2) s.hjorne = "ut";
    else if (d > 0.2) { s.hjorne = "inn"; s.slutt = B; nx.start = B; }
  }
  const faste = vaskFaste(o.faste);
  for (const s of gyldige) {
    const eff = Math.max(0.1, s.L - s.start - s.slutt);
    // faste feltlengder, ingen lengre enn feltlengden (Emil 09.10)
    medFelter(s, stillasFeltLengder(eff, faste, o.L, s.hjorne === "inn"));
  }
  return gyldige;
}

// felter = lengden på hvert felt, pos = hvor hvert felt begynner (fra
// start), lengde = hvor langt stillaset faktisk går, avvik = lengde − sida.
function medFelter(s, felter) {
  s.felter = felter.map(r3);
  s.felt = s.felter.length;
  s.pos = [0];
  for (const f of s.felter) s.pos.push(r3(s.pos[s.pos.length - 1] + f));
  s.lengde = s.pos[s.pos.length - 1];
  s.avvik = r3(s.lengde - Math.max(0.1, s.L - s.start - s.slutt));
  return s;
}

// ═══════════════════════ DELENE ═══════════════════════
// Rør: { del, a:[x,y,z], b:[x,y,z], r, side, tell?, mal? }
// Plate/boks: { del, c:[x,y,z], s:[langs, høyde, tvers], e:{x,z}, side, tell?, mal? }
// `del` = fargegruppe (STILLAS_FARGER), `tell` = mengdenøkkel (STILLAS_DELNAVN),
// `mal` = målteksten i mengdelista.
const fm = (v) => (Math.round(v * 100) / 100).toString().replace(".", ",");

// `bakke(x, z)` (valgfri): bakkens høyde i meter under stillasets nullnivå
// (≤ 0) — beina går ned til terrenget, platene står i vater.
export function stillasDeler(o, bakke) {
  const ror = [], bokser = [];
  const B = o.B, Hetg = o.H, Etg = o.etasjer || 1, topp = Etg * Hetg;
  const RH = o.rekkverkH || 1, KH = o.kneH || 0.5;
  const plan = new Set(o.plan && o.plan.length ? o.plan : Array.from({ length: Etg }, (_, i) => i + 1));
  const haki = o.system === "haki";
  const R = 0.024;
  const bein = new Map();      // dedupliserte bein: "x,z" → { x, z, h }
  const rammeLinjer = [];      // innerbein + ytterbein i samme ramme-linje
  const sider = stillasSider(o);
  const trapper = o.trapper || [], stiger = o.stigeplater || [];

  for (const S of sider) {
    const n0 = S.felt, Le = S.lengde, pos = S.pos;
    const P = (s, t, y) => [S.p0.x + S.e.x * (S.start + s) + S.n.x * t, y, S.p0.z + S.e.z * (S.start + s) + S.n.z * t];
    const R_ = (a, b, del, x) => { const d = Object.assign({ del, a, b, r: R, side: S.i }, x || {}); ror.push(d); return d; };
    const Bx = (c, s, del, x) => { const d = Object.assign({ del, c, s, e: S.e, side: S.i }, x || {}); bokser.push(d); return d; };
    const legg = (s, t, h) => {
      const q = P(s, t, 0), k = q[0].toFixed(3) + "," + q[2].toFixed(3);
      const f = bein.get(k);
      if (!f) bein.set(k, { x: q[0], z: q[2], h, side: S.i }); else f.h = Math.max(f.h, h);
      return k;
    };
    const trappI = (i) => trapper.find(q => q.side === S.i && q.felt === i);

    // Bein og rammer i hver ramme-linje
    for (let i = 0; i <= n0; i++) {
      const s = pos[i];
      const ky = legg(s, B, topp + RH);
      const ki = legg(s, 0, topp + (o.innvendig ? RH : 0));
      rammeLinjer.push({ a: ki, b: ky, side: S.i });
      for (let k = 1; k <= Etg; k++) {
        const y = k * Hetg;
        if (haki) R_(P(s, 0, y), P(s, B, y), "hor", { tell: "horTverr", mal: fm(B) + " m" });
        else R_(P(s, 0, y), P(s, B, y), "ramme", { tell: "ramme", mal: fm(B) + " × " + fm(Hetg) + " m" });
      }
    }
    for (let i = 0; i < n0; i++) {
      const Lf = S.felter[i], s0 = pos[i], s1 = pos[i + 1], sm = s0 + Lf / 2;
      const tr = trappI(i);
      for (let k = 1; k <= Etg; k++) {
        const y = k * Hetg;
        if (haki) for (const t of [0, B]) R_(P(s0, t, y), P(s1, t, y), "hor", { tell: "horLangs", mal: fm(Lf) + " m" });
        const harPlate = plan.has(k);
        const vedTrapp = !!tr && k <= tr.til;
        if (harPlate) {
          const stige = stiger.some(q => q.side === S.i && q.felt === i && q.etg === k);
          if (stige) {
            Bx(P(sm, B / 2, y + 0.03), [Lf - 0.04, 0.05, B - 0.04], "stige", { tell: "stigeplate", mal: fm(Lf) + " × " + fm(B) + " m" });
            // 🪜 Toppen av stigen peker mot nærmeste ende/hjørne av stillaset
            // (Emil 09.10, som på Instant-bildet): luka ligger i den enden av
            // plata, og stigen går på skrå inn under plata derfra.
            const motSlutt = sm >= Le / 2, retn = motSlutt ? 1 : -1;
            const lukL = STILLAS_STD.luke, luk0 = motSlutt ? s1 - 0.1 - lukL : s0 + 0.1;
            Bx(P(luk0 + lukL / 2, B / 2, y + 0.06), [lukL, 0.012, B - 0.2], "trapp");
            const toppS = motSlutt ? luk0 + 0.05 : luk0 + lukL - 0.05, fotS = toppS - retn * Hetg * 0.55;
            for (const tv of [B / 2 - 0.2, B / 2 + 0.2]) R_(P(fotS, tv, y - Hetg + 0.05), P(toppS, tv, y - 0.02), "stige", { r: R * 0.7 });
            ror[ror.length - 1].tell = "stige"; ror[ror.length - 1].mal = fm(Math.hypot(Math.abs(toppS - fotS), Hetg)) + " m";
            for (let r = 0.3; r < Hetg - 0.1; r += 0.3) {
              const f = r / Hetg, sr = fotS + (toppS - fotS) * f, yr = y - Hetg + 0.05 + (Hetg - 0.07) * f;
              R_(P(sr, B / 2 - 0.2, yr), P(sr, B / 2 + 0.2, yr), "stige", { r: R * 0.5 });
            }
          } else if (!haki) {
            Bx(P(sm, B / 2, y + 0.03), [Lf - 0.04, 0.05, B - 0.04], "plate", { tell: "plate", mal: fm(Lf) + " × " + fm(B) + " m" });
          } else {
            const k4 = Math.max(1, Math.round(B / (o.plankeB || 0.25)));
            for (let j = 0; j < k4; j++)
              Bx(P(sm, (j + 0.5) * B / k4, y + 0.03), [Lf - 0.04, 0.04, B / k4 - 0.015], "planke", { tell: "planke", mal: fm(Lf) + " × " + fm(B / k4) + " m" });
          }
          if (!vedTrapp) Bx(P(sm, B - 0.01, y + 0.08), [Lf, 0.15, 0.02], "fot", { tell: "fotlist", mal: fm(Lf) + " m" });
          if (o.innvendig) Bx(P(sm, 0.01, y + 0.08), [Lf, 0.15, 0.02], "fot", { tell: "fotlist", mal: fm(Lf) + " m" });
        }
        if (harPlate || k === Etg) {
          for (const t of o.innvendig ? [0, B] : [B]) {
            if (t === B && vedTrapp) continue;
            R_(P(s0, t, y + KH), P(s1, t, y + KH), "rekk", { tell: "rekkverk", mal: fm(Lf) + " m" });
            R_(P(s0, t, y + RH), P(s1, t, y + RH), "rekk", { tell: "rekkverk", mal: fm(Lf) + " m" });
          }
          // endene på et stillas på linje
          if (!S.lukket) for (const se of [i === 0 ? 0 : null, i === n0 - 1 ? Le : null]) {
            if (se === null) continue;
            R_(P(se, 0, y + KH), P(se, B, y + KH), "rekk", { tell: "rekkverk", mal: fm(B) + " m" });
            R_(P(se, 0, y + RH), P(se, B, y + RH), "rekk", { tell: "rekkverk", mal: fm(B) + " m" });
            if (harPlate) Bx(P(se + (se === 0 ? 0.01 : -0.01), B / 2, y + 0.08), [0.02, 0.15, B], "fot", { tell: "fotlist", mal: fm(B) + " m" });
          }
        }
      }
      // diagonal hvert n. felt, på utsiden
      if (i % (o.diagonalHvert || 5) === 0)
        for (let k = 0; k < Etg; k++) R_(P(s0, B, k * Hetg + 0.25), P(s1, B, (k + 1) * Hetg), "diag", { tell: "diagonal", mal: fm(Math.hypot(Lf, Hetg - 0.25)) + " m" });
      if (tr) trappetaarn(o, S, P, R_, Bx, legg, s0, s1, tr, haki, bakke);
    }
    // forankring mot veggen
    for (let s = Math.min(1.5, Le / 2); s < Le; s += (o.forankringBort || 4))
      for (let y = (o.forankringOpp || 4); y <= topp + 1e-9; y += (o.forankringOpp || 4))
        R_(P(s, -0.25, y - 0.2), P(s, 0, y - 0.2), "anker", { r: R * 1.3, tell: "forankring", mal: "" });
    // hjørneruta
    if (S.hjorne === "ut") {
      // ved enden av stillaset (kan avvike litt fra hjørnet med faste lengder)
      const H0 = (a, b, y) => P(Le + a, b, y);
      legg(Le + B, B, topp + RH);
      for (let k = 1; k <= Etg; k++) {
        const y = k * Hetg;
        const L2 = haki ? "hor" : "ramme";
        R_(H0(0, B, y), H0(B, B, y), L2, haki ? { tell: "horTverr", mal: fm(B) + " m" } : {});
        R_(H0(B, B, y), H0(B, 0, y), L2, haki ? { tell: "horTverr", mal: fm(B) + " m" } : {});
        if (plan.has(k)) hjorneplate(o, H0, y, S.e, S.i, Bx, haki);
        if (plan.has(k) || k === Etg) {
          for (const h of [KH, RH]) {
            R_(H0(0, B, y + h), H0(B, B, y + h), "rekk", { tell: "rekkverk", mal: fm(B) + " m" });
            R_(H0(B, B, y + h), H0(B, 0, y + h), "rekk", { tell: "rekkverk", mal: fm(B) + " m" });
          }
          if (plan.has(k)) {
            Bx(H0(B / 2, B - 0.01, y + 0.08), [B, 0.15, 0.02], "fot", { tell: "fotlist", mal: fm(B) + " m" });
            Bx(H0(B - 0.01, B / 2, y + 0.08), [0.02, 0.15, B], "fot", { tell: "fotlist", mal: fm(B) + " m" });
          }
        }
      }
    } else if (S.hjorne === "inn") {
      // ruta mellom de to avkuttede sidene: inntil begge veggene, ingen ytterkant
      const H0 = (a, b, y) => [S.p1.x - S.e.x * a + S.n.x * b, y, S.p1.z - S.e.z * a + S.n.z * b];
      for (const k of plan) hjorneplate(o, H0, k * Hetg, S.e, S.i, Bx, haki, true);
    }
  }
  // beina: ett segment per etasje (Haki teller dem), rekkverksstolpe over toppen
  // Med terreng (Emil 09.10): søylene og rammene står i SAMME høyde overalt —
  // bunnskruen skrus ut til bakken under hvert bein. Er fallet større enn
  // skruen klarer (skrueMaks), bygges stillaset opp med en EKSTRA RAMMEHØYDE
  // nederst (trinn på bunnRammeSteg). Begge beina i en ramme-linje får samme
  // ekstra høyde (de er én ramme), så lenge ingen av dem havner under bakken.
  const SM = STILLAS_STD.skrueMaks, steg = STILLAS_STD.bunnRammeSteg;
  for (const b of bein.values()) {
    b.g = bakke ? Math.min(0, Number(bakke(b.x, b.z)) || 0) : 0;
    const behov = -b.g - SM;
    b.ekstra = behov > 1e-6 ? Math.ceil(behov / steg - 1e-9) * steg : 0;
  }
  for (const L of rammeLinjer) {
    const a = bein.get(L.a), b = bein.get(L.b);
    if (!a || !b) continue;
    const h = Math.max(a.ekstra, b.ekstra);
    if (-a.g - h >= -1e-9 && -b.g - h >= -1e-9) { a.ekstra = h; b.ekstra = h; L.ekstra = h; }
  }
  let skrueMaks = 0, ekstraRammer = 0;
  for (const b of bein.values()) {
    const a = (y) => [b.x, y, b.z];
    const fot = 0.25 - b.ekstra;                 // der skruen møter beinet
    skrueMaks = Math.max(skrueMaks, -b.g - b.ekstra);
    bokser.push({ del: "skrue", c: a(b.g + 0.02), s: [0.15, 0.04, 0.15], e: { x: 1, z: 0 }, side: b.side, tell: "bunnskrue", mal: "" });
    ror.push({ del: "skrue", a: a(b.g + 0.04), b: a(fot), r: R * 0.8, side: b.side });
    if (b.ekstra > 0) ror.push({ del: haki ? "spire" : "ramme", a: a(fot), b: a(0.25), r: R, side: b.side,
      tell: haki ? "spire" : undefined, mal: haki ? fm(b.ekstra) + " m" : undefined });
    const toppStal = Math.min(b.h, topp);
    // første segment fra skruen til 1. etasje, så ett per etasje
    for (let y0 = 0; y0 < toppStal - 1e-6; y0 += Hetg) {
      const fra = Math.max(0.25, y0), til = Math.min(toppStal, y0 + Hetg);
      if (til - fra < 1e-6) continue;
      ror.push({ del: haki ? "spire" : "ramme", a: a(fra), b: a(til), r: R, side: b.side,
        tell: haki ? "spire" : undefined, mal: haki ? fm(Hetg) + " m" : undefined });
    }
    if (b.h > topp + 1e-6) ror.push({ del: haki ? "spire" : "ramme", a: a(topp), b: a(b.h), r: R, side: b.side, tell: "stolpe", mal: fm(b.h - topp) + " m" });
  }
  // den ekstra rammen: tverrstykket på toppen av den (der den vanlige begynner)
  for (const L of rammeLinjer) {
    if (!(L.ekstra > 0)) continue;
    const a = bein.get(L.a), b = bein.get(L.b);
    ekstraRammer++;
    ror.push({ del: haki ? "hor" : "ramme", a: [a.x, 0.25, a.z], b: [b.x, 0.25, b.z], r: R, side: L.side,
      tell: haki ? "horTverr" : "ramme", mal: haki ? fm(o.B) + " m" : fm(o.B) + " × " + fm(L.ekstra) + " m" });
  }
  return { ror, bokser, sider, skrueMaks: r3(skrueMaks), ekstraRammer };
}

function hjorneplate(o, H0, y, e, side, Bx, haki, inn) {
  const B = o.B;
  if (!haki) { Bx(H0(B / 2, B / 2, y + 0.03), [B - 0.04, 0.05, B - 0.04], "plate", { tell: "hjorneplate", mal: fm(B) + " × " + fm(B) + " m", side }); return; }
  const k4 = Math.max(1, Math.round(B / (o.plankeB || 0.25)));
  for (let j = 0; j < k4; j++)
    Bx(H0(B / 2, (j + 0.5) * B / k4, y + 0.03), [B - 0.04, 0.04, B / k4 - 0.015], "planke", { tell: "hjorneplanke", mal: fm(B) + " × " + fm(B / k4) + " m", side });
  void inn; void e;
}

// 🪜 Trappetårnet utenpå feltet s0–s1: to rader (t = B … 3B), løpene
// annenhver side, repos i hver ende over begge radene, rekkverk bare utvendig.
function trappetaarn(o, S, P, R_, Bx, legg, s0, s1, tr, haki, bakke) {
  const B = o.B, Hetg = o.H, rad = B, t0 = B, t1 = B + 2 * rad, rep = STILLAS_STD.repos;
  const nLop = Math.min(tr.til, o.etasjer || 1), topT = nLop * Hetg;
  const RH = o.rekkverkH || 1, KH = o.kneH || 0.5;
  for (const sx of [s0, s1]) for (const tx of [t0 + rad, t1]) legg(sx - 0 + 0, tx, topT + RH);
  const L = haki ? "hor" : "ramme";
  for (let k = 0; k < nLop; k++) {
    const ya = k * Hetg, yb = ya + Hetg, fram = k % 2 === 0;
    const ra = fram ? t0 + rad : t0, rb = ra + rad, tm = (ra + rb) / 2;
    const a = fram ? s0 + rep : s1 - rep, b = fram ? s1 - rep : s0 + rep;
    const tv0 = ra + 0.07, tv1 = rb - 0.07;
    for (const tv of [tv0, tv1]) {
      R_(P(a, tv, ya + 0.02), P(b, tv, yb + 0.02), "trapp", { r: 0.038 });
      if (!(fram && tv === tv1)) continue;
      R_(P(a, tv, ya + 0.95), P(b, tv, yb + 0.95), "trapp", { r: 0.019, tell: "handlist", mal: fm(Math.hypot(b - a, Hetg)) + " m" });
      R_(P(a, tv, ya + 0.5), P(b, tv, yb + 0.5), "trapp", { r: 0.014 });
      for (let j = 0; j <= 4; j++) { const f = j / 4, sp = a + (b - a) * f, yp = ya + (yb - ya) * f; R_(P(sp, tv, yp + 0.02), P(sp, tv, yp + 0.95), "trapp", { r: 0.014 }); }
    }
    // 🪜 Nederste løp fortsetter ned til terrenget (Emil 09.10): samme
    // stigning, bakover fra der løpet begynner, til trappa treffer bakken.
    if (k === 0 && bakke) {
      const retn = Math.sign(b - a) || 1, stig = Hetg / Math.abs(b - a);
      const gVed = (sx) => { const q = P(sx, tm, 0); return Math.min(0, Number(bakke(q[0], q[2])) || 0); };
      let d = 0;
      if (gVed(a) < -0.02) for (d = 0.01; d < 12 && -stig * d > gVed(a - retn * d); d += 0.01);
      if (d > 0.02) {
        const sb = a - retn * d, yb0 = -stig * d;
        for (const tv of [tv0, tv1]) {
          R_(P(sb, tv, yb0 + 0.02), P(a, tv, 0.02), "trapp", { r: 0.038 });
          if (tv !== tv1) continue;
          R_(P(sb, tv, yb0 + 0.95), P(a, tv, 0.95), "trapp", { r: 0.019, tell: "handlist", mal: fm(Math.hypot(d, -yb0)) + " m" });
          R_(P(sb, tv, yb0 + 0.5), P(a, tv, 0.5), "trapp", { r: 0.014 });
          for (const f of [0, 1]) { const sp = sb + (a - sb) * f, yp = yb0 * (1 - f); R_(P(sp, tv, yp + 0.02), P(sp, tv, yp + 0.95), "trapp", { r: 0.014 }); }
        }
        const n = Math.max(1, Math.round(-yb0 / 0.2));
        Bx(P((a + sb) / 2, tm, yb0 / 2), [0.01, 0.01, 0.01], "trapp", { tell: "trappelop", mal: fm(d) + " m / " + fm(-yb0) + " m", usynlig: true });
        for (let j = 0; j < n; j++) {
          const sj = sb + (a - sb) * (j + 0.5) / n, yj = yb0 * (1 - (j + 0.5) / n);
          Bx(P(sj, tm, yj + 0.02), [d / n + 0.02, 0.04, tv1 - tv0], "trapp");
        }
      }
    }
    const steg = Math.max(4, Math.round(Hetg / 0.2));
    const lop = Bx(P((a + b) / 2, tm, (ya + yb) / 2), [0.01, 0.01, 0.01], "trapp", { tell: "trappelop", mal: fm(Math.abs(b - a)) + " m / " + fm(Hetg) + " m" });
    lop.usynlig = true;
    for (let j = 0; j < steg; j++) {
      const sj = a + (b - a) * (j + 0.5) / steg, yj = ya + (yb - ya) * (j + 0.5) / steg;
      Bx(P(sj, tm, yj + 0.02), [Math.abs(b - a) / steg + 0.02, 0.04, tv1 - tv0], "trapp");
    }
    for (const [r0, r1] of [[s0, s0 + rep], [s1 - rep, s1]])
      Bx(P((r0 + r1) / 2, (t0 + t1) / 2, yb + 0.03), [rep - 0.02, 0.05, 2 * rad - 0.04], "trapp", { tell: "repos", mal: fm(rep) + " × " + fm(2 * rad) + " m" });
    for (const sx of [s0, s1, s0 + rep, s1 - rep]) R_(P(sx, t0, yb), P(sx, t1, yb), L, haki ? { tell: "horTverr", mal: fm(2 * rad) + " m" } : {});
    // aluminium: tårnet står på rammer — to rader = to rammer i hver ende per etasje
    if (!haki) for (const sx of [s0, s1]) for (const tx of [t0 + rad / 2, t0 + rad * 1.5])
      Bx(P(sx, tx, yb), [0.01, 0.01, 0.01], "ramme", { tell: "ramme", mal: fm(rad) + " × " + fm(Hetg) + " m", usynlig: true });
    for (const tx of [t0 + rad, t1]) R_(P(s0, tx, yb), P(s1, tx, yb), L, haki ? { tell: "horLangs", mal: fm(s1 - s0) + " m" } : {});
    if (k + 1 < nLop) for (const h of [KH, RH]) {
      R_(P(s0, t1, yb + h), P(s1, t1, yb + h), "rekk", { tell: "rekkverk", mal: fm(s1 - s0) + " m" });
      R_(P(s0, t0, yb + h), P(s0, t1, yb + h), "rekk", { tell: "rekkverk", mal: fm(2 * rad) + " m" });
      R_(P(s1, t0, yb + h), P(s1, t1, yb + h), "rekk", { tell: "rekkverk", mal: fm(2 * rad) + " m" });
    }
  }
  for (const h of [KH, RH]) {
    R_(P(s0, t1, topT + h), P(s1, t1, topT + h), "rekk", { tell: "rekkverk", mal: fm(s1 - s0) + " m" });
    R_(P(s0, t0, topT + h), P(s0, t1, topT + h), "rekk", { tell: "rekkverk", mal: fm(2 * rad) + " m" });
    R_(P(s1, t0, topT + h), P(s1, t1, topT + h), "rekk", { tell: "rekkverk", mal: fm(2 * rad) + " m" });
  }
  void S;
}

// ═══════════════════════ MENGDENE ═══════════════════════
// [{ tell, navn, mal, antall }] i fast rekkefølge — det som bestilles.
// Aluminium: rammene telles (én per ramme-linje per etasje); beina og
// horisontalene er en del av rammen og plata. Haki: bein, horisontaler og
// planker telles hver for seg.
export function stillasMengder(o, bakke) {
  const d = stillasDeler(o, bakke);
  const m = new Map();
  for (const x of d.ror.concat(d.bokser)) {
    if (!x.tell) continue;
    const k = x.tell + "|" + (x.mal || "");
    m.set(k, (m.get(k) || 0) + 1);
  }
  const ut = [];
  for (const [k, antall] of m) {
    const [tell, malT] = k.split("|");
    ut.push({ tell, navn: STILLAS_DELNAVN[tell] || tell, mal: malT, antall });
  }
  const rang = (t) => { const i = STILLAS_DELREKKEFOLGE.indexOf(t); return i < 0 ? 99 : i; };
  return ut.sort((a, b) => rang(a.tell) - rang(b.tell) || a.mal.localeCompare(b.mal));
}

// Summen per deltype (uten mål) — til kort oppsummering
export function stillasSum(o, bakke) {
  const s = {};
  for (const r of stillasMengder(o, bakke)) s[r.tell] = (s[r.tell] || 0) + r.antall;
  return s;
}

// Hvilket felt et punkt (objektets ramme, meter) ligger i: { side, felt, etg }
// eller null. Brukes når man trykker på stillaset for å legge inn trapp eller
// gjøre en plate om til plate med stige.
export function stillasFeltVed(o, x, z, y) {
  let best = null;
  for (const S of stillasSider(o)) {
    const Le = S.lengde;
    const dx = x - S.p0.x, dz = z - S.p0.z;
    const s = dx * S.e.x + dz * S.e.z - S.start, t = dx * S.n.x + dz * S.n.z;
    if (s < -0.05 || s > Le + 0.05 || t < -0.3 || t > 3 * o.B + 0.3) continue;
    const avst = t < 0 ? -t : t > o.B ? t - o.B : 0;
    if (best && best.avst <= avst) continue;
    let felt = 0;
    while (felt < S.felt - 1 && s >= S.pos[felt + 1]) felt++;
    const etg = Math.max(1, Math.min(o.etasjer || 1, Math.round((Number(y) || 0) / o.H)));
    best = { side: S.i, felt, etg, avst };
  }
  return best ? { side: best.side, felt: best.felt, etg: best.etg } : null;
}

// Slå trapp av/på i et felt (trykk på feltet, som port på gjerdet)
export function veksleTrapp(o, side, felt) {
  const liste = (o.trapper || []).slice();
  const i = liste.findIndex(q => q.side === side && q.felt === felt);
  if (i >= 0) liste.splice(i, 1); else liste.push({ side, felt, til: o.etasjer || 1 });
  return liste;
}
// Slå plate med stige av/på
export function veksleStigeplate(o, side, felt, etg) {
  const liste = (o.stigeplater || []).slice();
  const i = liste.findIndex(q => q.side === side && q.felt === felt && q.etg === etg);
  if (i >= 0) liste.splice(i, 1); else liste.push({ side, felt, etg });
  return liste;
}

// Linje → lukket: et rektangel rundt stillasets eget fotavtrykk (innerkanten),
// og lukket → linje: den lengste sida blir linja.
export function stillasTilLukket(o) {
  const tot = (o.moduler || 1) * o.L;
  const a = tot / 2, b = Math.max(o.B, tot / 3) / 2;
  return [{ x: -a, z: -b }, { x: a, z: -b }, { x: a, z: b }, { x: -a, z: b }].map(q => ({ x: r3(q.x), z: r3(q.z) }));
}
export function stillasTilLinje(o) {
  const sider = stillasSider(o);
  const lengst = sider.reduce((m, s) => (!m || s.L > m.L ? s : m), null);
  return { moduler: Math.max(1, Math.min(STILLAS_MAKS_FELT, Math.round((lengst ? lengst.L : o.L * 4) / o.L))) };
}

// Fotavtrykket i objektets ramme (til riggplanen og terrenghøyden)
export function stillasOmriss(o) {
  if (o.form === "lukket" && o.punkter) return o.punkter.map(q => ({ x: q.x, z: q.z }));
  const tot = (o.moduler || 1) * o.L / 2;
  return [{ x: -tot, z: -o.B / 2 }, { x: tot, z: -o.B / 2 }, { x: tot, z: o.B / 2 }, { x: -tot, z: o.B / 2 }];
}

// Hvor beina står (objektets ramme) — terrenghøyden under dem bestemmer
// stillasets nullnivå (det høyeste punktet: platene i vater, beina ned).
export function stillasBeinPunkter(o) {
  const d = stillasDeler(o);
  return d.bokser.filter(x => x.tell === "bunnskrue").map(x => ({ x: x.c[0], z: x.c[2] }));
}
