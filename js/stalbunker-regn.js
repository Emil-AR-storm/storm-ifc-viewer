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
  return ut;
}

// ═══════════════════════ MENGDELISTA ═══════════════════════
// Én rad per bunke: del, profil, lengde, antall, løpemeter og vekt (vekten
// bare når profilen kjennes igjen i profiler.js — ellers tom, ikke 0).
export function stalMengder(grupper) {
  return grupper.map(g => {
    const lm = g.antall * g.lengdeMm / 1000;
    return { del: g.del, profil: g.profil, lengdeMm: g.lengdeMm, antall: g.antall,
      lm: Math.round(lm * 100) / 100, kg: g.kgPerM > 0 ? Math.round(g.kgPerM * lm * 10) / 10 : null };
  });
}
export function stalSum(rader) {
  return rader.reduce((a, r) => ({ antall: a.antall + r.antall, lm: Math.round((a.lm + r.lm) * 100) / 100,
    kg: a.kg + (r.kg || 0), utenVekt: a.utenVekt + (r.kg == null ? r.antall : 0) }), { antall: 0, lm: 0, kg: 0, utenVekt: 0 });
}
