// 🏗 LØFTEPLAN / KRANSJEKK — REGNINGEN (runde 8, Emils valg 3A 30.10.2026). Ren, uten DOM.
//
// Spørsmålet: klarer tårnkranen å løfte hvert element der det skal stå?
//   kapasitet ved radius (fra LASTKURVEN i kranens datablad, skrives inn)
//   mot vekten av elementet (fra modellen) + løfteutstyret (åk, stropper).
// Grønn under 90 % utnyttelse, gul 90–100 %, rød over 100 %. Grå = vet ikke
// (ukjent vekt, eller utenfor bomlengden / lastkurven).
//
// KONSERVATIVT, med vilje: mellom to punkter i lastkurven brukes kapasiteten
// ved NESTE STØRRE radius (trappetrinn), ikke en rett linje. En rett linje kan
// gi en kapasitet som ikke står i databladet. Inne ved masta brukes det
// innerste punktet. Utenfor det ytterste punktet finnes ingen kapasitet.
// Tallene i lastkurven må komme fra leverandørens datablad — appen har ingen
// standardkurve [SLÅ OPP].

export const MAKS_PUNKTER = 24;
export const GUL_FRA = 0.9;      // 90 %
const tall = (v) => { const n = Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// [{ r, kg }] sortert på radius, uten like radier (siste vinner), innenfor fornuftige grenser
export function vaskLastkurve(liste) {
  const m = new Map();
  for (const p of Array.isArray(liste) ? liste : []) {
    const r = tall(p && p.r), kg = tall(p && p.kg);
    if (r == null || kg == null || r <= 0 || r > 100 || kg <= 0 || kg > 200000) continue;
    m.set(Math.round(r * 10) / 10, Math.round(kg));
  }
  return [...m.entries()].map(([r, kg]) => ({ r, kg })).sort((a, b) => a.r - b.r).slice(0, MAKS_PUNKTER);
}

// Det som lagres på kranen (riggobjektet): lastkurve, løfteutstyr, hvordan
// radius måles, og hvilke materialgrupper kranen løfter.
export const MODUSER = ["midt", "hjorne"];
export const STD_GRUPPER = ["Stål", "Tre", "Aluminium", "Materiell"];
export function vaskLofteplan(p) {
  const o = p && typeof p === "object" ? p : {};
  const utstyr = tall(o.utstyrKg);
  return {
    kurve: vaskLastkurve(o.kurve),
    utstyrKg: utstyr != null && utstyr >= 0 && utstyr <= 20000 ? Math.round(utstyr) : 0,
    modus: MODUSER.includes(o.modus) ? o.modus : "midt",
    grupper: Array.isArray(o.grupper) ? [...new Set(o.grupper.map(g => String(g || "").slice(0, 40)))].slice(0, 30) : STD_GRUPPER.slice()
  };
}

// Kapasitet (kg) ved radius r (m): trappetrinn — neste punkt med radius ≥ r.
// null = utenfor kurven (eller ingen kurve).
export function kapasitetVed(kurve, r) {
  const k = vaskLastkurve(kurve);
  if (!k.length || !(r >= 0)) return null;
  for (const p of k) if (p.r >= r - 1e-9) return p.kg;
  return null;
}

// Vannrett avstand (m) fra kranens midte til elementet.
// box: { min: [x,y,z], max: [x,y,z] } i sceneenheter, kran: [x, z] i sceneenheter,
// skala = meter per sceneenhet. «hjorne» = det hjørnet av boksen som er lengst unna.
export function radiusTil(kran, box, modus, skala) {
  const s = skala > 0 ? skala : 1;
  const [kx, kz] = kran;
  if (modus === "hjorne") {
    let maks = 0;
    for (const x of [box.min[0], box.max[0]]) for (const z of [box.min[2], box.max[2]]) maks = Math.max(maks, Math.hypot(x - kx, z - kz));
    return maks * s;
  }
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  return Math.hypot(cx - kx, cz - kz) * s;
}

// Én vurdering. kg = elementets vekt (0/ukjent → "ukjent").
// Svar: { farge, utn, last, kap }. farge:
//   "gronn" | "gul" | "rod"
//   "ukjent"     — vekten er ukjent
//   "ingenKurve" — lastkurven er ikke skrevet inn ennå (Emil 30.10: alt sto
//                  som «utenfor» før kurven var fylt ut — det var feil)
//   "utenfor"    — lenger ut enn bomlengden
//   "forLangt"   — innenfor bommen, men lenger ut enn lastkurvens siste punkt
export function vurder(kg, utstyrKg, kap, rM, radiusM, harKurve) {
  if (radiusM > 0 && rM > radiusM + 1e-9) return { farge: "utenfor", utn: null, last: kg > 0 ? kg + (utstyrKg || 0) : null, kap: null };
  if (harKurve === false) return { farge: "ingenKurve", utn: null, last: kg > 0 ? kg + (utstyrKg || 0) : null, kap: null };
  if (!(kg > 0)) return { farge: "ukjent", utn: null, last: null, kap };
  const last = kg + (utstyrKg || 0);
  if (kap == null) return { farge: "forLangt", utn: null, last, kap: null };
  const utn = last / kap;
  return { farge: utn > 1 + 1e-9 ? "rod" : utn >= GUL_FRA ? "gul" : "gronn", utn, last, kap };
}

// Hele modellen. elementer: [{ id, navn, type, material, gruppe, kg, box }]
// kran: { xz: [x, z], radiusM, plan: vaskLofteplan(...) }
// Svar: { rader: [...], telling: { gronn, gul, rod, ukjent, utenfor, totalt }, uteGrupper }
export function kransjekk(elementer, kran, skala) {
  const plan = vaskLofteplan(kran && kran.plan);
  const med = new Set(plan.grupper);
  const rader = [], telling = { gronn: 0, gul: 0, rod: 0, ukjent: 0, ingenKurve: 0, forLangt: 0, utenfor: 0, totalt: 0 };
  const harKurve = plan.kurve.length > 0;
  for (const e of elementer || []) {
    if (!med.has(e.gruppe || "")) continue;
    const r = radiusTil(kran.xz, e.box, plan.modus, skala);
    const v = vurder(e.kg, plan.utstyrKg, kapasitetVed(plan.kurve, r), r, kran.radiusM, harKurve);
    rader.push({ id: e.id, mat: !!e.mat, navn: e.navn || "", type: e.type || "", material: e.material || "", gruppe: e.gruppe || "", kg: e.kg > 0 ? Math.round(e.kg) : 0,
      r: Math.round(r * 10) / 10, last: v.last == null ? null : Math.round(v.last), kap: v.kap, utn: v.utn == null ? null : Math.round(v.utn * 1000) / 10, farge: v.farge });
    telling[v.farge]++; telling.totalt++;
  }
  // Verst først: rød (høyest %), gul, lenger ut enn kurven, utenfor bommen, ukjent vekt, uten kurve, grønn
  const rang = { rod: 0, gul: 1, forLangt: 2, utenfor: 3, ukjent: 4, ingenKurve: 5, gronn: 6 };
  rader.sort((a, b) => rang[a.farge] - rang[b.farge] || (b.utn || 0) - (a.utn || 0) || b.kg - a.kg);
  return { rader, telling };
}

// Hvilke materialgrupper finnes blant elementene, med antall: [{ gruppe, antall }]
export function grupperIModell(elementer) {
  const m = new Map();
  for (const e of elementer || []) { const g = e.gruppe || ""; m.set(g, (m.get(g) || 0) + 1); }
  return [...m.entries()].map(([gruppe, antall]) => ({ gruppe, antall })).sort((a, b) => b.antall - a.antall);
}

// Excel-radene
export function excelRader(rader, ov) {
  const T = ov || ((x) => x);
  const STATUS = { gronn: "OK", gul: "Sjekk (90–100 %)", rod: "Over kapasitet", ukjent: "Ukjent vekt", utenfor: "Utenfor bommen",
    forLangt: "Lenger ut enn lastkurven", ingenKurve: "Mangler lastkurve" };
  const ut = [[T("Status"), T("Element"), T("Type"), T("Materiale"), T("Vekt (kg)"), T("Last med utstyr (kg)"), T("Radius (m)"), T("Kapasitet (kg)"), T("Utnyttelse (%)")]];
  for (const r of rader) ut.push([T(STATUS[r.farge]), r.navn, r.type, r.material, r.kg || "", r.last == null ? "" : r.last, r.r, r.kap == null ? "" : r.kap, r.utn == null ? "" : r.utn]);
  return ut;
}

// Lastkurve-feltene slik de står i panelet: [{ r, kg }] som tekst.
// Svar: { hele: rader med begge felt, halve: antall rader med bare det ene }
// (Emil 30.10: en rad med bare radius ble lagret, kastet og visket ut — nå
// lagres kurven først når hver påbegynt rad har både radius og kg.)
export function delKurveFelt(felt) {
  const hele = [], tom = (v) => String(v == null ? "" : v).trim() === "";
  let halve = 0;
  for (const f of felt || []) {
    const a = tom(f.r), b = tom(f.kg);
    if (a && b) continue;
    if (a || b) { halve++; continue; }
    hele.push({ r: f.r, kg: f.kg });
  }
  return { hele, halve };
}
