// 🔩 Stålbunker — den rene regningen. Ingen DOM, ingen three.js, ingen nettkall.
//
// Emil 30.09 / 01.10: «les stålmodellen, ta søylene og bjelkene fra
// hverandre og pakk dem i bunker rundt bygget, gruppert på profil og
// lengde» — samme prinsipp som SW-generatoren: ferdig bygg, med
// materiellbunkene rundt. Godkjent plan 01.10, med én regel til fra Emil:
// SØYLER OG BJELKER LIGGER ALLTID I HVER SIN BUNKE, også når profilen og
// lengden er den samme. Det er to forskjellige leveranser på byggeplassen
// (søylene reises først), og en bunke man må plukke i er en bunke som
// stokkes om.
//
// Alt her testes i Node (_test/test-stalbunker.mjs) med ekte tall fra
// Geithus vaskehall.

// ═══════════════════════ PROFILNAVNET ═══════════════════════
//
// Navnene fra Revit er «Familie:Type:ElementID», f.eks.
//   «IPE:IPE200:240681»   «CFSHS (EN 10219-2) Column:CFSHS100x6:236704»
// Profilen er TYPEN. Leddene prøves BAKFRA (samme grunn som i profiler.js:
// det siste leddet er element-ID-en), og første ledd som ser ut som en
// stålprofil vinner. Ingen treff: ObjectType, så navnet uten løpenummer.
// Bokstavene foran tallet må stå FØRST i ordet: «Flattstål 120x8» skal ikke
// leses som en L-profil fordi «stål» slutter på l (JavaScripts \b ser ikke
// norske bokstaver som en del av ordet).
const FORAN = "(?<![A-Za-zÆØÅæøå])";
const PROFIL_RE = new RegExp(FORAN + "(?:IPE|IPN|HE\\s*-?\\s*[ABM]|HEA|HEB|HEM|UPE|UPN|UNP|C?F?[SR]HS|C?F?CHS|(?:KF)?HUP|VKR|KKR|HSQ|FLATTSTÅL|FLATSTÅL|FLAT|FL|L|T|U|RØR|ROR)\\s*-?\\s*\\d", "i");
export function profilNavn(navn, objType) {
  const ledd = String(navn || "").split(":").map(s => s.trim()).filter(Boolean);
  for (const l of ledd.slice().reverse()) if (PROFIL_RE.test(l)) return l.slice(0, 40);
  const ot = String(objType || "").split(":").map(s => s.trim()).filter(Boolean);
  for (const l of ot.slice().reverse()) if (PROFIL_RE.test(l)) return l.slice(0, 40);
  // Ingen kjent profil: TYPEN i «Familie:Type:ElementID» (nest siste ledd
  // når det siste er et tall), ellers ObjectType, ellers navnet.
  const uten = ledd.length > 1 && /^\d+$/.test(ledd[ledd.length - 1]) ? ledd.slice(0, -1) : ledd;
  const reserve = (uten.length > 1 ? uten[uten.length - 1] : (objType || uten[0] || "")).trim();
  return (reserve || "Ukjent profil").slice(0, 40);
}

// ═══════════════════════ TVERRSNITTET ═══════════════════════
//
// Formen og målene (mm) bunken tegnes med. Det er et BILDE av bunken — vekt
// og lengde kommer fra modellen og profiler.js, ikke herfra. Derfor holder
// tommelfingerreglene for I-profilene (IPE: b ≈ h/2, HEA/HEB/HEM: b ≈ h opp
// til 300) {Source not found: avrundet fra EN 10365-tabellene, godt nok til
// en tegning, ikke til en beregning}. Kjennes formen ikke igjen, brukes de
// to minste målene på elementet (`reserve`).
const tall = (s) => Number(String(s).replace(",", "."));
export function tverrsnitt(profil, reserve) {
  const s = String(profil || "");
  let m;
  if ((m = s.match(/\bIPE\s*(\d{2,4})/i))) { const h = tall(m[1]); return { form: "I", h, b: Math.round(h / 2), t: Math.max(5, h * 0.045) }; }
  if ((m = s.match(/\bIPN\s*(\d{2,4})/i))) { const h = tall(m[1]); return { form: "I", h, b: Math.round(h * 0.42), t: Math.max(5, h * 0.05) }; }
  if ((m = s.match(/\bHE\s*-?\s*([ABM])\s*(\d{2,4})/i))) {
    const n = tall(m[2]), b = Math.min(n, 300);
    const h = m[1].toUpperCase() === "A" ? n - 10 : m[1].toUpperCase() === "M" ? n + 20 : n;
    return { form: "I", h, b, t: Math.max(6, n * 0.06) };
  }
  if ((m = s.match(/\b(?:C?F?RHS|(?:KF)?HUP|VKR)\s*(\d{2,4})\s*[x×X]\s*(\d{2,4})\s*[x×X]\s*(\d{1,2}(?:[.,]\d)?)/i)))
    return { form: "RHS", h: tall(m[1]), b: tall(m[2]), t: tall(m[3]) };
  if ((m = s.match(/\b(?:C?F?SHS|(?:KF)?HUP|KKR|VKR)\s*(\d{2,4})\s*[x×X]\s*(\d{1,2}(?:[.,]\d)?)/i)))
    return { form: "RHS", h: tall(m[1]), b: tall(m[1]), t: tall(m[2]) };
  if ((m = s.match(/\b(?:C?F?CHS|RØR|ROR)\s*(\d{2,4}(?:[.,]\d)?)\s*[x×X]\s*(\d{1,2}(?:[.,]\d)?)/i)))
    return { form: "CHS", h: tall(m[1]), b: tall(m[1]), t: tall(m[2]) };
  if ((m = s.match(/\b(?:UPE|UPN|UNP)\s*(\d{2,4})/i))) { const h = tall(m[1]); return { form: "U", h, b: Math.round(Math.max(40, h * 0.4)), t: Math.max(5, h * 0.06) }; }
  // Flattstål og plater ligger flate: bredden er b, tykkelsen h
  if ((m = s.match(new RegExp(FORAN + "(?:FLATTSTÅL|FLATSTÅL|FLAT|FL)\\s*(\\d{2,4})\\s*[x×X]\\s*(\\d{1,3})", "i"))))
    return { form: "rekt", b: tall(m[1]), h: tall(m[2]), t: 0 };
  if ((m = s.match(/plate\s*\d{2,4}\s*[x×X]\s*(\d{2,4})\s*[x×X]\s*(\d{1,3})/i)))
    return { form: "rekt", b: tall(m[1]), h: tall(m[2]), t: 0 };
  if ((m = s.match(new RegExp(FORAN + "L\\s*(\\d{2,3})\\s*[x×X]\\s*(\\d{2,3})\\s*[x×X]\\s*(\\d{1,2})", "i")))) return { form: "L", h: tall(m[1]), b: tall(m[2]), t: tall(m[3]) };
  if ((m = s.match(new RegExp(FORAN + "L\\s*(\\d{2,3})\\s*[x×X]\\s*(\\d{1,2})(?!\\d)", "i")))) return { form: "L", h: tall(m[1]), b: tall(m[1]), t: tall(m[2]) };
  // T-profil (T120 = 120 × 120 mm)
  if ((m = s.match(new RegExp(FORAN + "T\\s*(\\d{2,3})(?!\\d)", "i")))) { const n = tall(m[1]); return { form: "T", h: n, b: n, t: Math.max(5, n * 0.11) }; }
  const r = reserve || {};
  const b = Math.max(20, Math.round(Number(r.b) || 100)), h = Math.max(20, Math.round(Number(r.h) || b));
  return { form: "rekt", h: Math.max(b, h), b: Math.min(b, h), t: 0 };
}

// ═══════════════════════ GRUPPENE ═══════════════════════
//
// Ett element: { del: "soyle" | "bjelke", profil, lengdeMm, kgPerM, b, h }.
// Lengden rundes til nærmeste 10 mm: modellen har avrunding i siste desimal,
// og 5999,7 og 6000,2 er samme stang fra stålverket.
// Nøkkelen er del + profil + lengde — søyler og bjelker deles ALLTID (Emil).
export const LENGDE_STEG_MM = 10;
export function rundLengde(mm) { return Math.round((Number(mm) || 0) / LENGDE_STEG_MM) * LENGDE_STEG_MM; }
export function stalNokkel(del, profil, lengdeMm) { return del + "|" + profil + "|" + rundLengde(lengdeMm); }

export function grupperStal(elementer) {
  const m = new Map();
  for (const e of elementer || []) {
    if (!e || (e.del !== "soyle" && e.del !== "bjelke")) continue;
    const L = rundLengde(e.lengdeMm);
    if (!(L > 0)) continue;
    const profil = String(e.profil || "Ukjent profil");
    const k = stalNokkel(e.del, profil, L);
    if (!m.has(k)) m.set(k, { nokkel: k, del: e.del, profil, lengdeMm: L, antall: 0, kgPerM: Number(e.kgPerM) || 0,
      snitt: tverrsnitt(profil, { b: e.b, h: e.h }) });
    m.get(k).antall++;
  }
  // Søyler først, så bjelker; innenfor hver: profil, så lengste først — slik
  // en kappliste leses.
  return [...m.values()].sort((a, b) =>
    (a.del === b.del ? 0 : a.del === "soyle" ? -1 : 1) ||
    a.profil.localeCompare(b.profil, "nb", { numeric: true }) ||
    b.lengdeMm - a.lengdeMm);
}

// ═══════════════════════ STABLINGEN ═══════════════════════
//
// Profilene ligger på strøer, side om side, lag for lag: STAL_PER_LAG i
// bredden, så et nytt lag oppå med strøer imellom (STRO_MM). Luft mellom
// profilene i et lag: STAL_LUFT_MM. {Source not found: vanlig praksis på
// byggeplass, ikke en standard.}
export const STAL_PER_LAG = 5, STRO_MM = 50, STAL_LUFT_MM = 40;
export function perLag(antall) { return Math.max(1, Math.min(STAL_PER_LAG, Math.round(Number(antall) || 1))); }
// [opp, sideveis] i mm for profil nr i (0-basert); sideveis er sentrert.
export function stalOffset(antall, b, h, i) {
  const n = perLag(antall), lag = Math.floor(i / n), kol = i % n;
  return [STRO_MM + lag * (h + STRO_MM), (kol - (n - 1) / 2) * (b + STAL_LUFT_MM)];
}
export function stalBunkeDybde(antall, b) { const n = perLag(antall); return n * b + (n - 1) * STAL_LUFT_MM; }
export function stalBunkeHoyde(antall, h) { const lag = Math.ceil((Number(antall) || 1) / perLag(antall)); return lag * (h + STRO_MM); }

// ═══════════════════════ PLASSERINGEN ═══════════════════════
//
// Rundt bygget, i METER i byggets plan (x, z — samme akser som scenen, −z er
// «nord» i modellen): SØYLENE langs sørsiden (+z), BJELKENE langs nordsiden
// (−z). Hver bunke ligger med lengden langs siden. Bunkene står på rekke fra
// vest mot øst med BUNKE_MELLOM_M luft; går rekka mer enn REKKE_FORBI_M forbi
// enden av bygget, begynner en ny rekke lenger ut. Første rekke står
// AVSTAND_M fra fasaden — samme 3 m som SW-bunkene (bunker.js).
export const AVSTAND_M = 3, BUNKE_MELLOM_M = 1.5, REKKE_MELLOM_M = 2, REKKE_FORBI_M = 6;
export function plasserBunker(grupper, bygg) {
  const ut = [];
  if (!bygg) return ut;
  for (const [del, side] of [["soyle", 1], ["bjelke", -1]]) {
    const liste = grupper.filter(g => g.del === del);
    let x = bygg.minX, ut0 = AVSTAND_M, rekkeDybde = 0;
    for (const g of liste) {
      const L = g.lengdeMm / 1000, D = stalBunkeDybde(g.antall, g.snitt.b) / 1000;
      if (x > bygg.minX && x + L > bygg.maxX + REKKE_FORBI_M) {
        x = bygg.minX; ut0 += rekkeDybde + REKKE_MELLOM_M; rekkeDybde = 0;
      }
      const z = side > 0 ? bygg.maxZ + ut0 + D / 2 : bygg.minZ - ut0 - D / 2;
      ut.push({ nokkel: g.nokkel, x: x + L / 2, z });
      x += L + BUNKE_MELLOM_M;
      rekkeDybde = Math.max(rekkeDybde, D);
    }
  }
  // Fagverkhalvdelene på østsiden (+x), med lengden langs siden (nord–sør):
  // de er lange og brede, og skal ikke stå i veien for søyle- og bjelkerekkene.
  let z = bygg.minZ, ut0 = AVSTAND_M, rekkeDybde = 0;
  for (const g of grupper.filter(g => g.del === "fagverk")) {
    const L = g.lengdeMm / 1000, D = fagverkBunkeDybde(g.antall, g.hoydeMm) / 1000;
    if (z > bygg.minZ && z + L > bygg.maxZ + REKKE_FORBI_M) { z = bygg.minZ; ut0 += rekkeDybde + REKKE_MELLOM_M; rekkeDybde = 0; }
    ut.push({ nokkel: g.nokkel, x: bygg.maxX + ut0 + D / 2, z: z + L / 2, rot: Math.PI / 2 });
    z += L + BUNKE_MELLOM_M;
    rekkeDybde = Math.max(rekkeDybde, D);
  }
  return ut;
}

// ═══════════════════════ MENGDELISTA ═══════════════════════
// Én rad per bunke: del, profil, lengde, antall, løpemeter og vekt (vekten
// bare når profilen kjennes igjen i profiler.js — ellers tom, ikke 0).
export function stalMengder(grupper) {
  return grupper.map(g => {
    const lm = g.antall * g.lengdeMm / 1000;
    // Fagverket: vekten er summen av stavene i halvdelen (kgHalv), ikke kg/m
    const kg = g.del === "fagverk" ? (g.kgHalv > 0 ? Math.round(g.kgHalv * g.antall * 10) / 10 : null)
      : (g.kgPerM > 0 ? Math.round(g.kgPerM * lm * 10) / 10 : null);
    return { del: g.del, profil: g.profil, lengdeMm: g.lengdeMm, antall: g.antall, hoydeMm: g.hoydeMm || 0,
      lm: Math.round(lm * 100) / 100, kg };
  });
}
export function stalSum(rader) {
  return rader.reduce((a, r) => ({ antall: a.antall + r.antall, lm: Math.round((a.lm + r.lm) * 100) / 100,
    kg: a.kg + (r.kg || 0), utenVekt: a.utenVekt + (r.kg == null ? r.antall : 0) }), { antall: 0, lm: 0, kg: 0, utenVekt: 0 });
}

// ═══════════════════════ 🔺 FAGVERK ═══════════════════════
//
// Emil 01.10 (bilder fra Hegdalringen): på større bygg kommer fagverkene
// NESTEN FERDIG SAMMENSATT, delt i to på midten. Da er ikke korder og stag
// løse profiler i en bunke — det er to fagverkhalvdeler som løftes av bilen.
// Valgt 01.10: halvdelene ligger FLATE på strøer (prøvebilde A), BEGGE
// kordene deles, og delingen er ALLTID MIDT PÅ spennet.
//
// IFC-en sier ikke at noe er et fagverk (ingen IfcElementAssembly i Storms
// modeller — sjekket på seks), så det finnes ut av geometrien, med faste
// regler og ingen fasit fra én modell:
//   1. Alle bjelker i SAMME LODDRETTE PLAN (begge endene innenfor PLAN_TOL_M
//      fra planet til en lang, vannrett bjelke) er kandidater.
//   2. I planet: to NIVÅER av vannrette bjelker (helning under 10°) med
//      FV_MIN_H_M–FV_MAKS_H_M mellom seg, som overlapper minst 60 %.
//   3. Mellom nivåene: minst FV_MIN_STAG skrå eller loddrette stag med begge
//      endene innenfor høyden og spennet.
//   4. Spennet er der stagene står (+ 0,6 m): en takbjelke i neste felt som
//      ligger på samme høyde som overkorda, er IKKE en del av fagverket.
// Prøvd 01.10: Hegdalringen 5 fagverk og Sundland 7 fagverk (2 overkorder,
// 1 underkorde, 20 stag hver); Geithus, Norsjø, Valle og Arendal 0 — riktig.
export const PLAN_TOL_M = 0.15, FV_MIN_H_M = 0.3, FV_MAKS_H_M = 4, FV_MIN_STAG = 4, FV_SKRA = 0.17;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);

// elementer: { id, del, profil, a: [x, y, z], b: [x, y, z] (meter, y opp), bMm, kgPerM }
// Svar: [{ ider: [id …], staver: [{ e, u0, v0, u1, v1 }], u0, u1, lo, hi }]
export function finnFagverk(elementer) {
  const bj = (elementer || []).filter(e => e && e.del === "bjelke" && e.a && e.b);
  for (const e of bj) { const d = sub(e.b, e.a), l = len3(d); e._l = l; e._skra = l > 0 ? Math.abs(d[1]) / l : 0; }
  const brukt = new Set(), ut = [];
  const zMidt = (e) => (e.a[1] + e.b[1]) / 2;
  const kandidater = bj.filter(e => e._skra < FV_SKRA && e._l > 3).sort((p, q) => q._l - p._l);
  for (const k of kandidater) {
    if (brukt.has(k.id)) continue;
    const dx = k.b[0] - k.a[0], dz = k.b[2] - k.a[2], dl = Math.hypot(dx, dz);
    if (!(dl > 0)) continue;
    const d = [dx / dl, dz / dl], n = [-d[1], d[0]], off = k.a[0] * n[0] + k.a[2] * n[1];
    const iPlan = (p) => Math.abs(p[0] * n[0] + p[2] * n[1] - off) < PLAN_TOL_M;
    const u = (p) => p[0] * d[0] + p[2] * d[1];
    const plan = bj.filter(e => !brukt.has(e.id) && iPlan(e.a) && iPlan(e.b));
    const vannrett = plan.filter(e => e._skra < FV_SKRA && e._l > 1.5);
    const nivaa = [...new Set(vannrett.map(e => Math.round(zMidt(e) * 10) / 10))].sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i < nivaa.length; i++) for (let j = i + 1; j < nivaa.length; j++) {
      const lo = nivaa[i], hi = nivaa[j];
      if (hi - lo < FV_MIN_H_M || hi - lo > FV_MAKS_H_M) continue;
      const lav = vannrett.filter(e => Math.abs(zMidt(e) - lo) < 0.15), hoy = vannrett.filter(e => Math.abs(zMidt(e) - hi) < 0.15);
      const spenn = (L) => [Math.min(...L.map(e => Math.min(u(e.a), u(e.b)))), Math.max(...L.map(e => Math.max(u(e.a), u(e.b))))];
      const [a0, a1] = spenn(lav), [b0, b1] = spenn(hoy);
      if (Math.min(a1, b1) - Math.max(a0, b0) < 0.6 * Math.max(a1 - a0, b1 - b0)) continue;
      const s0 = Math.min(a0, b0), s1 = Math.max(a1, b1);
      const stag = plan.filter(e => e._skra >= FV_SKRA && Math.min(e.a[1], e.b[1]) >= lo - 0.3 && Math.max(e.a[1], e.b[1]) <= hi + 0.3 &&
        Math.min(u(e.a), u(e.b)) >= s0 - 0.3 && Math.max(u(e.a), u(e.b)) <= s1 + 0.3);
      if (stag.length < FV_MIN_STAG) continue;
      const t0 = Math.min(...stag.map(e => Math.min(u(e.a), u(e.b)))) - 0.6, t1 = Math.max(...stag.map(e => Math.max(u(e.a), u(e.b)))) + 0.6;
      const inn = (e) => Math.min(Math.max(u(e.a), u(e.b)), t1) - Math.max(Math.min(u(e.a), u(e.b)), t0) >= 0.5 * e._l;
      const lav2 = lav.filter(inn), hoy2 = hoy.filter(inn);
      if (!lav2.length || !hoy2.length) continue;
      if (!best || stag.length > best.stag.length) best = { lav: lav2, hoy: hoy2, stag, lo, hi };
    }
    if (!best) continue;
    const alle = best.lav.concat(best.hoy, best.stag);
    if (alle.some(e => brukt.has(e.id))) continue;
    alle.forEach(e => brukt.add(e.id));
    const U = best.lav.concat(best.hoy).flatMap(e => [u(e.a), u(e.b)]);
    const u0 = Math.min(...U), u1 = Math.max(...U);
    // stavene i fagverkets eget plan: u langs spennet fra u0, v opp fra underkorda
    const vBunn = Math.min(...best.lav.flatMap(e => [e.a[1], e.b[1]]));
    const staver = alle.map(e => ({ e, u0: u(e.a) - u0, v0: e.a[1] - vBunn, u1: u(e.b) - u0, v1: e.b[1] - vBunn }));
    ut.push({ ider: alle.map(e => e.id), staver, spenn: u1 - u0, lo: best.lo, hi: best.hi });
  }
  for (const e of bj) { delete e._l; delete e._skra; }
  return ut;
}

// Ett fagverk → to halvdeler, delt MIDT PÅ spennet. En stav som krysser
// midten kuttes der (korden blir to stykker). Halvdel 2 speiles, så begge
// halvdelene beskrives fra den ytre enden — da er de LIKE når fagverket er
// symmetrisk, og havner i samme bunke.
// Svar: [{ staver: [[u0, v0, u1, v1, bMm, profil]], lengdeMm, hoydeMm, tykkMm, kg }] (mm)
export function delFagverk(fv) {
  const midt = fv.spenn / 2;
  const halv = [[], []];
  for (const s of fv.staver) {
    let a = [s.u0, s.v0], b = [s.u1, s.v1];
    if (a[0] > b[0]) [a, b] = [b, a];
    const leggTil = (h, p, q) => { if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.02) halv[h].push([p, q, s.e]); };
    if (b[0] <= midt + 1e-6) leggTil(0, a, b);
    else if (a[0] >= midt - 1e-6) leggTil(1, a, b);
    else { const t = (midt - a[0]) / (b[0] - a[0]), m = [midt, a[1] + (b[1] - a[1]) * t]; leggTil(0, a, m); leggTil(1, m, b); }
  }
  return halv.map((liste, h) => {
    const mm = (x) => Math.round(x * 1000);
    const staver = liste.map(([p, q, e]) => {
      let u0 = p[0], u1 = q[0];
      if (h === 1) { u0 = fv.spenn - u0; u1 = fv.spenn - u1; }
      const [ua, va, ub, vb] = u0 <= u1 ? [u0, p[1], u1, q[1]] : [u1, q[1], u0, p[1]];
      return [mm(ua), mm(va), mm(ub), mm(vb), Math.round(Number(e.bMm) || 100), String(e.profil || "")];
    }).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    const kg = liste.reduce((sum, [p, q, e]) => sum + (Number(e.kgPerM) || 0) * Math.hypot(q[0] - p[0], q[1] - p[1]), 0);
    const vs = staver.flatMap(s => [s[1], s[3]]);
    return { staver, lengdeMm: mm(midt), hoydeMm: Math.max(...vs) - Math.min(0, ...vs), tykkMm: Math.max(...staver.map(s => s[4])), kg: Math.round(kg * 10) / 10,
      utenVekt: liste.some(([, , e]) => !(Number(e.kgPerM) > 0)) };
  });
}

// Halvdelene → bunker. Like halvdeler (samme staver innenfor 20 mm, samme
// profiler) ligger i samme bunke — signaturen er stavene selv, ikke navnet.
export const FV_SIGNATUR_MM = 20;
export function fagverkSignatur(h) {
  const r = (x) => Math.round(x / FV_SIGNATUR_MM);
  return r(h.lengdeMm) + "x" + r(h.hoydeMm) + ":" + h.staver.map(s => [r(s[0]), r(s[1]), r(s[2]), r(s[3]), s[5]].join(",")).join(";");
}
// Nøkkelen en flyttet bunke huskes på: mål, antall staver og profilene.
export function fagverkNokkel(lengdeMm, hoydeMm, antallStaver, staver) {
  const prof = [...new Set((staver || []).map(s => s[5]))].sort().join("+");
  return "fagverk|" + lengdeMm + "|" + hoydeMm + "|" + antallStaver + "|" + prof;
}
// Profilene i en halvdel, kordene (de lengste) først — til navn og mengdeliste.
export function fagverkProfiler(staver) {
  const lengde = new Map();
  for (const s of staver || []) lengde.set(s[5], (lengde.get(s[5]) || 0) + Math.hypot(s[2] - s[0], s[3] - s[1]));
  return [...lengde.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}
// To halvdeler er LIKE når de har like mange staver av hver profil, og hver
// stav i den ene har en stav av samme profil i den andre innenfor
// FV_LIK_TOL_MM i begge ender. Toleranse og ikke avrunding: en avrunding til
// 20 mm satte ett av fem like fagverk i egen bunke fordi ett tall lå på
// grensen (nettleserprøven 01.10).
export const FV_LIK_TOL_MM = 40;
export function likeHalvdeler(h1, h2) {
  if (h1.staver.length !== h2.staver.length || Math.abs(h1.lengdeMm - h2.lengdeMm) > FV_LIK_TOL_MM || Math.abs(h1.hoydeMm - h2.hoydeMm) > FV_LIK_TOL_MM) return false;
  const brukt = new Set();
  const naer = (s, q) => Math.max(Math.abs(s[0] - q[0]), Math.abs(s[1] - q[1]), Math.abs(s[2] - q[2]), Math.abs(s[3] - q[3])) <= FV_LIK_TOL_MM;
  for (const s of h1.staver) {
    const j = h2.staver.findIndex((q, k) => !brukt.has(k) && q[5] === s[5] && naer(s, q));
    if (j < 0) return false;
    brukt.add(j);
  }
  return true;
}
export function grupperFagverk(fagverk) {
  const m = new Map();
  for (const fv of fagverk || []) for (const h of delFagverk(fv)) {
    let sig = null;
    for (const [k, g] of m) if (likeHalvdeler(g.halv, h)) { sig = k; break; }
    if (!sig) sig = fagverkSignatur(h) + "#" + m.size;
    if (!m.has(sig)) m.set(sig, { nokkel: fagverkNokkel(rundLengde(h.lengdeMm), rundLengde(h.hoydeMm), h.staver.length, h.staver), sig, del: "fagverk",
      profil: "Fagverk", lengdeMm: rundLengde(h.lengdeMm), hoydeMm: rundLengde(h.hoydeMm), tykkMm: h.tykkMm, staver: h.staver,
      kgHalv: h.utenVekt ? 0 : h.kg, antall: 0, halv: h, snitt: { form: "fagverk", b: h.hoydeMm, h: h.tykkMm, t: 0 } });
    m.get(sig).antall++;
    // 📅 Hvilket fagverk halvdelen er fra (framdriftsplanen: bunken minker
    // når fagverket er montert). Bare en liste med id-er — rører ikke bunken.
    if (fv.ider) (m.get(sig).fagverk = m.get(sig).fagverk || []).push(fv.ider.slice());
  }
  // 🔑 Nøkkelen MÅ være unik per bunke. To ulike halvdeler med samme lengde,
  // høyde og profiler (et pulttak: venstre og høyre halvdel, Emils
  // skjermbilde 01.10) fikk samme nøkkel — og dermed samme plass, oppå
  // hverandre. Like nøkler får et løpenummer, i en fast rekkefølge.
  const liste = [...m.values()].sort((a, b) => b.lengdeMm - a.lengdeMm || b.hoydeMm - a.hoydeMm || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  const sett = new Map();
  for (const g of liste) {
    const n = sett.get(g.nokkel) || 0;
    sett.set(g.nokkel, n + 1);
    if (n) g.nokkel += "#" + (n + 1);
  }
  return liste;
}

// Stablingen: FV_PER_STABEL halvdeler flatt oppå hverandre med strøer
// imellom (FV_STRO_MM — tykkere enn under løse profiler, fagverket er tungt
// og spriker), så en ny stabel ved siden av med FV_MELLOM_MM luft.
export const FV_PER_STABEL = 5, FV_STRO_MM = 100, FV_MELLOM_MM = 500;
export function fagverkOffset(antall, hoydeMm, tykkMm, i) {
  const stabler = Math.max(1, Math.ceil((Number(antall) || 1) / FV_PER_STABEL)), st = Math.floor(i / FV_PER_STABEL), lag = i % FV_PER_STABEL;
  return [FV_STRO_MM + lag * (tykkMm + FV_STRO_MM), (st - (stabler - 1) / 2) * (hoydeMm + FV_MELLOM_MM)];
}
export function fagverkBunkeDybde(antall, hoydeMm) {
  const stabler = Math.max(1, Math.ceil((Number(antall) || 1) / FV_PER_STABEL));
  return stabler * hoydeMm + (stabler - 1) * FV_MELLOM_MM;
}
