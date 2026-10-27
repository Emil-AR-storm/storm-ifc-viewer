// 📝 ENDRINGSMELDING FRA MODELLEN — den rene regningen (byggeplan runde 3,
// verktøy 2; bygget 26.10.2026, Emils valg A: sidepanel med tre steg).
//
// Inn: et Sammenlign-resultat ({ ny, slettet, endret }) eller et utvalg
// elementer. Ut: én linje per IFC-type med antall nye/slettede/endrede,
// mengdeendring i valgt enhet, pris fra Priskalkulasjon og sum — pluss
// tekstene som går inn i EM-skjemaet (endringsmelding-v1).
//
// Ingen DOM, ingen three.js, ingen S — _test/test-em.mjs kjører alt direkte.
//
// MENGDENE ER MODELLMENGDER. Lengde er boksens lengste side, areal de to
// lengste, volum er geometriens volum (quantitiesForSet) og kg er volum ×
// 7 850 for stål. Det er et ANSLAG til et varsel, ikke et oppmål — og det står
// i begrunnelsen som går til byggherren.

export const EM_ENHETER = ["lm", "m²", "m³", "stk", "kg"];
export const STAAL_KG_M3 = 7850;

// Standard enhet per IFC-type (kan endres per linje i panelet)
const STANDARD = {
  ifccolumn: "lm", ifcbeam: "lm", ifcmember: "lm", ifcpile: "lm", ifcrailing: "lm",
  ifcslab: "m²", ifcwall: "m²", ifcwallstandardcase: "m²", ifcroof: "m²", ifccovering: "m²",
  ifccurtainwall: "m²", ifcstair: "stk", ifcfooting: "m³",
  ifcreinforcingbar: "kg", ifcreinforcingmesh: "kg", ifctendon: "kg"
};
// IfcWallStandardCase er en vanlig vegg — to «Vegg Basic Wall»-linjer i Emils stresstest 27.10
export const typeNokkel = (t) => String(t || "").trim().toLowerCase().replace(/^(ifc)?wallstandardcase$/, (m, i) => (i || "") + "wall");
export function standardEnhet(type, staal) {
  const k = typeNokkel(type), kk = STANDARD[k] ? k : "ifc" + k;
  // 🔩 Stål prises i kg (Emil 27.10): søyler, bjelker, staver og plater med stålprofil
  if (staal && STAAL_TYPER.includes(kk)) return "kg";
  return STANDARD[kk] || "stk";
}
// Typene der stål gir kg som standard, og navnene som kjennetegner stål.
// Betong (B30/B35 …, «betong», «concrete») er aldri stål, selv med mål i navnet.
export const STAAL_TYPER = ["ifccolumn", "ifcbeam", "ifcmember", "ifcplate"];
const STAAL_RE = /\b(HE[ABM]|HEB|IPE|IPN|UPE|UPN|UNP|INP|CFSHS|CFRHS|CFCHS|HFSHS|HFRHS|HFCHS|CHS|RHS|SHS|KKR|VKR|HUP|Z\d|C\d|L\d|T\d|Flat ?bars?|Flattstål|Stålplate|Square ?bars?|Rundstål|Vinkelstål|stål|steel|S235|S275|S355|S420|S460)/i;
const BETONG_RE = /\b(betong|concrete|B\d{2}\b|C\d{2}\/\d{2}|hulldekke|HD\d|prefab|plasstøpt)/i;
// 🧱 MATERIALET (Emil 27.10, stresstest 200 MB): samme IFC-type kan være både
// stål og betong («Søyle: SHS … Column, Søyle Betong Rektangulær») — og ble
// da regnet i kg med stålets 7 850 kg/m³, også betongen. Isolasjon lå i
// «Dekke» og «Vegg» og ble priset som betong. Nå deles en type i én linje per
// materiale når den har MER ENN ETT kjent materiale. Navnet avgjør; uten
// kjent materiale følger elementet flertallet i typen.
const ISOLASJON_RE = /(isolasjon|insulation|\bEPS\b|\bXPS\b|mineralull|steinull|glava|rockwool|isopor|skumplast|\bPIR\b)/i;
const BETONG_EKSTRA_RE = /(betong|concrete|fundament|såle|ringmur|hulldekke|plasstøpt|prefab|støpeplate|\bB\d{2}\b)/i;
export const MATERIAL_NAVN = { staal: "stål", betong: "betong", isolasjon: "isolasjon", koord: "koordineringsobjekt", annet: "annet" };
const KOORD_RE = /(coordination|survey ?marker|survey ?point|kontrollpunkt|origo|base ?point)/i;
export function materialAv(navn) {
  const n = String(navn || "");
  if (KOORD_RE.test(n)) return "koord";
  if (ISOLASJON_RE.test(n)) return "isolasjon";
  if (erStaalNavn(n)) return "staal";
  if (BETONG_EKSTRA_RE.test(n) || BETONG_RE.test(n)) return "betong";
  return "";
}
// Nøkkelen (linja) hvert element hører til i dette resultatet: «ifccolumn»,
// eller «ifccolumn|betong» når typen har flere materialer.
export function linjeNokler(res) {
  const alle = [].concat((res && res.ny) || [], (res && res.slettet) || [], (res && res.endret) || []);
  const per = new Map();   // type → Map(materiale → antall)
  for (const e of alle) {
    const k = typeNokkel(e && e.type) || "ukjent", m = materialAv(e && e.name);
    if (!per.has(k)) per.set(k, new Map());
    if (m) per.get(k).set(m, (per.get(k).get(m) || 0) + 1);
  }
  const info = new Map();
  for (const [k, m] of per) {
    const sortert = [...m.entries()].sort((a, b) => b[1] - a[1]);
    info.set(k, { delt: sortert.length > 1, flest: sortert.length ? sortert[0][0] : "" });
  }
  const nokkel = (e) => {
    const k = typeNokkel(e && e.type) || "ukjent", i = info.get(k);
    if (!i || !i.delt) return k;
    return k + "|" + (materialAv(e && e.name) || i.flest);
  };
  nokkel.material = (e) => { const k = typeNokkel(e && e.type) || "ukjent", i = info.get(k); return materialAv(e && e.name) || (i ? i.flest : ""); };
  nokkel.delt = (k) => { const i = info.get(k); return !!(i && i.delt); };
  return nokkel;
}
export function erStaalNavn(navn) { const n = String(navn || ""); return STAAL_RE.test(n) && !BETONG_RE.test(n); }

// «IFCCOLUMN» / «IfcColumn» → «Søyle» o.l. Ukjent: typen uten «Ifc».
const NAVN = {
  ifccolumn: "Søyle", ifcbeam: "Bjelke", ifcmember: "Stav", ifcslab: "Dekke", ifcwall: "Vegg",
  ifcwallstandardcase: "Vegg", ifcplate: "Plate", ifcfooting: "Fundament", ifcpile: "Pel",
  ifcroof: "Tak", ifcstair: "Trapp", ifcrailing: "Rekkverk", ifcdoor: "Dør", ifcwindow: "Vindu",
  ifccovering: "Kledning", ifccurtainwall: "Glassfasade", ifcreinforcingbar: "Armering",
  ifcreinforcingmesh: "Armeringsnett", ifcmechanicalfastener: "Festemiddel", ifcbuildingelementproxy: "Annet"
};
export function typeNavn(type) {
  const k = typeNokkel(type);
  // Lette kopier (GLB) har typen uten «Ifc» («Beam») — samme norske navn (Emils PDF 26.10)
  return NAVN[k] || NAVN["ifc" + k] || String(type || "").replace(/^ifc/i, "") || "Ukjent";
}

// Mengden for ÉTT element i en enhet. e = { d:[x,y,z] (modellenheter), v (m³) }
export function mengdeFor(e, enhet, toM) {
  const s = Number(toM) || 1;
  const d = (Array.isArray(e && e.d) ? e.d : [0, 0, 0]).map(x => Math.abs(Number(x) || 0) * s).sort((a, b) => b - a);
  const v = Math.abs(Number(e && e.v) || 0);
  switch (enhet) {
    case "lm": return d[0];
    case "m²": return d[0] * d[1];
    case "m³": return v;
    case "kg": return v * STAAL_KG_M3;
    default: return 1;
  }
}

// 📏 PROFILEN (Emil 26.10, EM-test 5): «søyle CFSHS100x6 og søyle CFSHS100x8 er
// begge 2 søyle CFSHS … forskjellige dimensjoner = forskjellige pris/vekt».
// Revit-navnet er «Familie:Type:Id» — Type er profilen, som i Revits
// stålskjema («Tabell Søyler Stål»: CFSHS100x6 · lengde · kg/m · vekt).
export function profilNavn(navn) {
  const deler = String(navn || "").split(":").map(x => x.trim()).filter(Boolean);
  if (deler.length && /^\d+$/.test(deler[deler.length - 1])) deler.pop();
  return (deler.length ? deler[deler.length - 1] : "").slice(0, 60) || "(uten navn)";
}
// Lengden langs elementet (PCA-lengden når den finnes, ellers boksens lengste side), i meter
export function elementLengde(e, toM) {
  const s = Number(toM) || 1;
  if (e && Number(e.L) > 0) return Number(e.L) * s;
  const d = (Array.isArray(e && e.d) ? e.d : [0, 0, 0]).map(x => Math.abs(Number(x) || 0));
  return Math.max(0, ...d) * s;
}
export const profilNokkelFor = (linjeKey, profil) => linjeKey + "|" + profil;
const rund1 = (x) => Math.round(x * 10) / 10;

// Sammenlign-resultat → linjer per type. enheter = { [typeNokkel]: enhet }
// (brukerens valg per linje); mangler den, brukes standardEnhet.
//
// Hver linje har også `profiler`: én underlinje per profil med antall, lengde-
// endring (lm) og kg/m. I kg regnes linja som Σ lengde × kg/m per profil —
// samme regning som Revits stålskjema. kg/m skrives inn av brukeren
// (opt.kgPerM[linje|profil]); ellers brukes et anslag fra modellen
// (volum × 7 850 / lengde), merket «modell». Et endret element som har byttet
// profil trekkes fra den gamle profilen og legges til den nye.
export function mengdeDiff(res, o) {
  const opt = o || {}, toM = Number(opt.toM) || 1, valgt = opt.enheter || {}, egneKg = opt.kgPerM || {}, huskKg = opt.kgPerMProfil || {};
  const per = new Map();
  // Linja per type — og per materiale når typen er blandet (linjeNokler)
  const nok = linjeNokler(res);
  const linje = (e) => {
    const type = e && e.type, k = nok(e);
    if (!per.has(k)) {
      const mat = nok.material(e), delt = nok.delt(typeNokkel(type) || "ukjent");
      const std = mat === "isolasjon" && ["ifcslab", "ifcwall", "ifccovering", "ifcroof"].includes(typeNokkel(type)) ? "m²" : standardEnhet(type, mat === "staal");
      per.set(k, { key: k, type: type || "", navn: typeNavn(type) + (delt ? " – " + MATERIAL_NAVN[mat || "annet"] : ""), material: mat || "",
        enhet: valgt[k] || std, ny: 0, slettet: 0, endret: 0, mengde: 0, ider: [], navnSett: new Map(), prof: new Map() });
    }
    return per.get(k);
  };
  const prof = (l, navn) => {
    const p = profilNavn(navn);
    if (!l.prof.has(p)) l.prof.set(p, { key: profilNokkelFor(l.key, p), navn: p, ny: 0, slettet: 0, endret: 0, lm: 0, mengde: 0, volKg: 0, lengde: 0, utenLengde: 0, ider: [] });
    return l.prof.get(p);
  };
  // modellanslaget for kg/m: alle elementene i profilen, før og etter
  const maal = (p, e) => { const L = elementLengde(e, toM); if (L > 0 && e.v > 0) { p.volKg += Math.abs(e.v) * STAAL_KG_M3; p.lengde += L; } };
  const tellNavn = (l, n) => { const x = String(n || "").split(":")[0].trim(); if (x) l.navnSett.set(x, (l.navnSett.get(x) || 0) + 1); };
  // fortegn: +1 ny, −1 fjernet. stk teller ikke endrede.
  const legg = (l, p, e, fortegn) => { l.mengde += fortegn * mengdeFor(e, l.enhet, toM); p.lm += fortegn * elementLengde(e, toM); p.mengde += fortegn * mengdeFor(e, l.enhet, toM); p.kgVol = (p.kgVol || 0) + fortegn * mengdeFor(e, "kg", toM); maal(p, e); };
  for (const e of (res && res.ny) || []) { const l = linje(e), p = prof(l, e.name); l.ny++; p.ny++; legg(l, p, e, 1); if (e.id != null) { l.ider.push(e.id); p.ider.push(e.id); } tellNavn(l, e.name); }
  for (const e of (res && res.slettet) || []) {
    const l = linje(e), p = prof(l, e.name); l.slettet++; p.slettet++;
    // det fjernede for seg — brukes når arbeidet alt er produsert (ingen fradrag, runde 3)
    const lmF = elementLengde(e, toM);
    l.fjernetMengde = (l.fjernetMengde || 0) + mengdeFor(e, l.enhet, toM);
    p.lmFjernet = (p.lmFjernet || 0) + lmF; p.fjMengde = (p.fjMengde || 0) + mengdeFor(e, l.enhet, toM); p.fjKgVol = (p.fjKgVol || 0) + mengdeFor(e, "kg", toM);
    legg(l, p, e, -1); tellNavn(l, e.name);
  }
  for (const e of (res && res.endret) || []) {
    const l = linje(e), p = prof(l, e.name); l.endret++; p.endret++;
    const fra = e.fra || {}, pf = prof(l, fra.name || e.name);
    // profilen elementet kom FRA — ellers sto den med 0 / 0 / 0 og et stort minus (stresstest 27.10)
    if (pf !== p) pf.byttetFra = (pf.byttetFra || 0) + 1;
    // stk teller ikke endrede: én søyle som blir lengre er fortsatt én søyle
    if (l.enhet !== "stk") { legg(l, p, e, 1); legg(l, pf, fra, -1); }
    else { maal(p, e); maal(pf, fra); p.lm += elementLengde(e, toM); pf.lm -= elementLengde(fra, toM); }
    if (e.id != null) { l.ider.push(e.id); p.ider.push(e.id); } tellNavn(l, e.name);
  }
  return [...per.values()].map(l => {
    const navn = [...l.navnSett.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const profiler = [...l.prof.values()].filter(p => p.ny || p.slettet || p.endret || p.byttetFra || Math.abs(p.lm) > 1e-9).map(p => {
      // skrevet inn her (linje|profil), ellers husket fra før for samme profilnavn
      const ok = (v) => v != null && v !== "" && isFinite(Number(v)) && Number(v) > 0;
      const egen = ok(egneKg[p.key]) ? Number(egneKg[p.key]) : (ok(huskKg[p.navn]) ? Number(huskKg[p.navn]) : null);
      const modell = p.lengde > 0 ? rund1(p.volKg / p.lengde) : null;
      const kgPerM = egen != null ? egen : modell;
      // kg: lengde × kg/m (uten lengde: volum × 7 850)
      const mengde = l.enhet === "kg" ? (kgPerM != null ? p.lm * kgPerM : (p.kgVol || 0)) : (l.enhet === "stk" ? p.ny - p.slettet : p.mengde);
      const fjMengde = l.enhet === "kg" ? (kgPerM != null ? (p.lmFjernet || 0) * kgPerM : (p.fjKgVol || 0)) : (l.enhet === "stk" ? p.slettet : (p.fjMengde || 0));
      return { key: p.key, navn: p.navn, ny: p.ny, slettet: p.slettet, endret: p.endret, byttetFra: p.byttetFra || 0, lm: avrund(p.lm, "lm"),
        lmFjernet: avrund(p.lmFjernet || 0, "lm"), mengdeFjernet: avrund(fjMengde, l.enhet),
        kgPerM, kgPerMKilde: egen != null ? "egen" : (modell != null ? "modell" : ""), kgPerMModell: modell,
        mengde: avrund(mengde, l.enhet), ider: p.ider };
    }).sort((a, b) => a.navn.localeCompare(b.navn, "no", { numeric: true }));
    const mengde = l.enhet === "kg" ? profiler.reduce((s, p) => s + p.mengde, 0) : l.mengde;
    const fjernetMengde = l.enhet === "kg" ? profiler.reduce((s, p) => s + p.mengdeFjernet, 0) : (l.fjernetMengde || 0);
    delete l.fjernetMengde;
    delete l.navnSett; delete l.prof;
    return Object.assign(l, { undertekst: navn.slice(0, 2).join(", ") + (navn.length > 2 ? " …" : ""), mengde: avrund(mengde, l.enhet), profiler,
      mengdeFjernet: avrund(fjernetMengde, l.enhet) });
  }).filter(l => l.ny || l.slettet || l.endret)
    .sort((a, b) => a.navn.localeCompare(b.navn, "no"));
}

// 🔁 Runde 3 (Emil 26.10): «Arbeidet er produsert/levert/montert» — stål som
// alt er laget, kan ikke trekkes fra som om det aldri fantes. Det fjernede
// trekkes da IKKE fra (ingen fradrag); linja og profilene regnes uten det.
// «Ikke produsert»: som før — det fjernede er fradrag (minus).
export const PRODUSERT = ["Produsert", "Levert", "Montert"];
export function utenFradrag(l) {
  if (!l || !(l.slettet > 0)) return l;
  const profiler = (l.profiler || []).map(p => Object.assign({}, p, {
    lm: avrund(p.lm + (p.lmFjernet || 0), "lm"), mengde: avrund(p.mengde + (p.mengdeFjernet || 0), l.enhet), lmFjernet: 0, mengdeFjernet: 0 }));
  const mengde = l.enhet === "kg" && profiler.length ? profiler.reduce((s, p) => s + p.mengde, 0) : l.mengde + (l.mengdeFjernet || 0);
  return Object.assign({}, l, { profiler, mengde: avrund(mengde, l.enhet), mengdeFjernet: 0, utenFradrag: true });
}

// Mengden for ett element i linja — i kg med profilens kg/m (samme regning som linja)
export function mengdeILinje(e, l, toM) {
  if (l && l.enhet === "kg" && Array.isArray(l.profiler)) {
    const p = l.profiler.find(x => x.navn === profilNavn(e && e.name));
    if (p && p.kgPerM != null) return elementLengde(e, toM) * p.kgPerM;
  }
  return mengdeFor(e, l ? l.enhet : "stk", toM);
}

export function avrund(v, enhet) {
  const d = enhet === "stk" ? 0 : enhet === "kg" ? 0 : enhet === "lm" ? 2 : enhet === "m²" ? 2 : 3;
  const f = 10 ** d; return Math.round((Number(v) || 0) * f) / f;
}

// Pris fra Priskalkulasjon: første post med samme type OG enhet som har pris.
// Påslaget i posten tas med — det er Storms pris ut, ikke kostpris.
export function prisFor(type, enhet, poster) {
  const k = typeNokkel(type);
  const p = (poster || []).find(x => x && !x.slettet && typeNokkel(x.type) === k && x.enhet === enhet && x.pris != null && isFinite(x.pris));
  if (!p) return null;
  return Math.round(Number(p.pris) * (1 + (Number(p.paaslag) || 0) / 100) * 100) / 100;
}

// Legger pris og sum på linjene. egne = { [key]: pris } (skrevet i panelet) vinner.
export function prisAnslag(linjer, poster, egne) {
  const e = egne || {};
  return (linjer || []).map(l => {
    const pris = e[l.key] != null && e[l.key] !== "" && isFinite(Number(e[l.key])) ? Number(e[l.key]) : prisFor(l.type, l.enhet, poster);
    return Object.assign({}, l, { pris, sum: pris == null ? null : Math.round(l.mengde * pris) });
  });
}
export function sumAnslag(linjer, med) {
  const valgt = (linjer || []).filter(l => !med || med(l));
  return { sum: valgt.reduce((s, l) => s + (l.sum || 0), 0), manglerPris: valgt.filter(l => l.pris == null).length };
}

// Tall i norsk form: 12,4 · −15 620
export function tallTekst(v, d) {
  const n = Number(v) || 0, s = n < 0 ? "−" : "";
  const [h, des] = Math.abs(n).toFixed(d == null ? 0 : d).split(".");
  return s + h.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (des && Number(des) ? "," + des.replace(/0+$/, "") : "");
}
export const mengdeTekst = (l) => (l.mengde > 0 ? "+" : "") + tallTekst(l.mengde, l.enhet === "stk" || l.enhet === "kg" ? 0 : 2) + " " + l.enhet;

// Teksten til «Begrunnelse» (felt 1.3). Fakta, ikke vurdering — hvorfor det
// er en endring og hjemmelen skriver brukeren selv (samme regel som i
// sjekkliste.js faktablokk).
export function faktablokk(linjer, k) {
  const o = k || {};
  const l = [];
  if (o.fra || o.til) l.push("Modellrevisjon " + (o.til || "ny") + " mot " + (o.fra || "forrige") + (o.metode ? " (sammenlignet på " + o.metode + ")" : "") + ":");
  else if (o.utvalg) l.push("Valgte elementer i modellen " + (o.modell || "") + ":");
  for (const x of linjer || []) {
    const deler = [];
    if (x.ny) deler.push("+" + x.ny + " ny" + (x.ny > 1 ? "e" : ""));
    if (x.slettet) deler.push("−" + x.slettet + " fjernet");
    if (x.endret) deler.push(x.endret + " endret");
    l.push("• " + x.navn + (x.undertekst ? " (" + x.undertekst + ")" : "") + ": " + deler.join(", ") + " → " + mengdeTekst(x));
    // 📏 kg per profil: lengde × kg/m, så regningen kan etterprøves
    if (x.enhet === "kg") l.push(...profilLinjer(x.profiler));
  }
  if (o.utenFradrag) l.push("", "Arbeidet er " + String(o.arbeidet || "produsert").toLowerCase() + ": fjernede elementer er allerede produsert og er derfor ikke trukket fra.");
  if (o.nyId) l.push("", o.nyId + (o.nyId === 1 ? " element har" : " elementer har") + " fått ny GlobalId i modellen, men er samme element på samme sted. De er kontrollert og ikke priset (se vedlegg).");
  l.push("", "Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål.");
  if (o.oppdaget) l.push("Endringen ble oppdaget " + o.oppdaget + ".");
  // Med mal v2 har hjemmelen eget felt (1.7) og står ikke her (hjemmel: null).
  // Verktøyet skriver aldri et punktnummer selv — bare det brukeren har skrevet.
  if (o.hjemmel !== null) l.push("", "Hjemmel: " + (String(o.hjemmel || "").trim() || "[fyll inn punkt fra kontrakten]"));
  return l.join("\n");
}

// «   – CFSHS100x6: +0,3 lm × 17 kg/m = +5 kg» — regnestykket per profil i 1.3
export function profilLinjer(profiler) {
  return (profiler || []).filter(p => p && p.kgPerM != null && Math.abs(Number(p.lm) || 0) > 1e-9).map(p => {
    const kg = p.mengde != null && p.kgPerMKilde !== undefined ? p.mengde : Math.round((Number(p.lm) || 0) * p.kgPerM);
    return "   – " + p.navn + ": " + (p.lm > 0 ? "+" : "") + tallTekst(p.lm, 2) + " lm × " + tallTekst(p.kgPerM, 1) + " kg/m = " +
      mengdeTekst({ mengde: kg, enhet: "kg" }) + (p.kgPerMKilde === "modell" || p.kilde === "modell" ? " (kg/m anslått fra modellen)" : "");
  });
}
// 1.3 oppdateres når en linje i 2.4 får ny enhet eller nye kg/m: tallet etter
// «→» på linja byttes, og regnestykket per profil skrives på nytt. Har brukeren
// skrevet om linja (finner ikke starten), røres ingenting.
export function oppdaterBegrunnelse(tekst, r) {
  const s = String(tekst || "");
  if (!r || !r.begr || !s) return s;
  const l = s.split("\n"), i = l.findIndex(x => x.startsWith(r.begr));
  if (i < 0 || !/→/.test(l[i])) return s;
  l[i] = l[i].replace(/→[^→]*$/, "→ " + mengdeTekst({ mengde: Number(r.antall) || 0, enhet: r.enhet }));
  let j = i + 1;
  while (j < l.length && l[j].startsWith("   – ")) j++;
  const nye = r.enhet === "kg" ? profilLinjer((r.profiler || []).map(p => ({ navn: p.navn, lm: p.lm, kgPerM: p.kgPerM, kilde: p.kilde }))) : [];
  l.splice(i + 1, j - i - 1, ...nye);
  return l.join("\n");
}

// Ordrelinjer til felt «okonomi» (sjekkliste.js vaskLinje-formen). Linjer
// uten pris tas med med pris 0, så ingenting forsvinner stille.
// o: { post: { [linjeKey]: "04.12" } } — kontraktsposten per linje (runde 3)
export function ordrelinjer(linjer, o) {
  const post = (o && o.post) || {};
  return (linjer || []).map(l => {
    const r = {
      // Ikke «(mangler pris)» i navnet: det ble stående i PDF-en etter at prisen
      // var fylt inn i skjemaet (Emils test 26.10). Panelet viser hva som mangler.
      produkt: (l.navn + (l.undertekst ? " " + l.undertekst : "")).slice(0, 120),
      antall: l.mengde, enhet: l.enhet, enhetspris: l.pris == null ? 0 : l.pris, paslag: 0, mva: 25,
      post: String(post[l.key] || "").slice(0, 30),
      // Starten på linja i begrunnelsen (1.3) — så 1.3 kan følge med når enheten
      // eller kg/m endres i 2.4 (Emil 27.10, EM-test 8: 1.3 sa lm, 2.4 sa kg)
      begr: ("• " + l.navn + (l.undertekst ? " (" + l.undertekst + ")" : "") + ":").slice(0, 200)
    };
    // 📏 Prøve C (Emil 26.10): regnestykket per profil følger med inn i 2.4 —
    // bare på skjermen. Antall = Σ lengde × kg/m (sjekkliste.js vaskLinje).
    // Emil 27.10: også i lm — nedtrekket skal finnes uansett enhet (kg kan velges i 2.4)
    if ((l.enhet === "kg" || l.enhet === "lm") && (l.profiler || []).some(p => p.lm))
      r.profiler = l.profiler.filter(p => p.lm).slice(0, 60).map(p => ({ navn: p.navn, lm: p.lm, kgPerM: p.kgPerM, kilde: p.kgPerMKilde || p.kilde || "" }));
    return r;
  });
}

// 🧾 Følgekostnader (runde 3) — egne ordrelinjer, merket folge.
// f: { omarbeid: { med, antall, pris, post }, vrak: {…}, tegninger: { med, timer, pris, post }, paslag: { med, prosent, post } }
export const FOLGE = {
  omarbeid: "Omarbeid av endrede elementer",
  vrak: "Vrak / håndtering av fjernet stål (allerede produsert)",
  tegninger: "Revisjon av verkstedtegninger",
  paslag: "Påslag / administrasjon"
};
export function folgelinjer(f) {
  const o = f || {}, ut = [];
  const n = (v) => Number(String(v == null ? "" : v).replace(",", ".")) || 0;
  const linje = (type, produkt, antall, enhet, pris, post) => ({ produkt, antall, enhet, enhetspris: n(pris), paslag: 0, mva: 25, post: String(post || "").slice(0, 30), folge: type });
  if (o.omarbeid && o.omarbeid.med && n(o.omarbeid.antall)) ut.push(linje("omarbeid", n(o.omarbeid.antall) === 1 ? "Omarbeid av 1 endret element" : "Omarbeid av " + n(o.omarbeid.antall) + " endrede elementer", n(o.omarbeid.antall), "stk", o.omarbeid.pris, o.omarbeid.post));
  if (o.vrak && o.vrak.med && n(o.vrak.antall)) ut.push(linje("vrak", FOLGE.vrak, n(o.vrak.antall), "stk", o.vrak.pris, o.vrak.post));
  if (o.tegninger && o.tegninger.med) ut.push(linje("tegninger", FOLGE.tegninger, n(o.tegninger.timer), "timer", o.tegninger.pris, o.tegninger.post));
  if (o.paslag && o.paslag.med && n(o.paslag.prosent)) ut.push(linje("paslag", FOLGE.paslag, n(o.paslag.prosent), "%", 0, o.paslag.post));
  return ut;
}
// Summen av følgelinjene; påslaget i % regnes av alt det andre (som i 2.4)
export function folgeSum(linjer, folge) {
  const base = (linjer || []).reduce((s, l) => s + (l.sum || 0), 0);
  let sum = 0, manglerPris = 0;
  const vanlige = (folge || []).filter(f => f.enhet !== "%");
  for (const f of vanlige) { sum += f.antall * f.enhetspris; if (!f.enhetspris) manglerPris++; }
  for (const f of (folge || []).filter(f => f.enhet === "%")) sum += (base + vanlige.reduce((s, x) => s + x.antall * x.enhetspris, 0)) * f.antall / 100;
  return { sum: Math.round(sum), manglerPris };
}

// Excel: én rad per linje + sum
export function excelRader(linjer, k) {
  const o = k || {};
  const rader = [["Type", "Elementer / profil", "Ny", "Fjernet", "Endret", "Mengdeendring", "Enhet", "Pris (kr/enhet)", "Sum (kr eks. mva)", "Lengdeendring (lm)", "kg/m"]];
  for (const l of linjer || []) {
    rader.push([l.navn, l.undertekst || "", l.ny, l.slettet, l.endret, l.mengde, l.enhet, l.pris == null ? "mangler pris" : l.pris, l.sum == null ? "" : l.sum]);
    for (const p of l.profiler || []) rader.push(["", "   " + p.navn, p.ny, p.slettet, p.endret, p.mengde, l.enhet, "",
      l.pris == null ? "" : Math.round(p.mengde * l.pris), p.lm, l.enhet === "kg" && p.kgPerM != null ? p.kgPerM : ""]);
  }
  const s = sumAnslag(linjer);
  rader.push([], ["Prisanslag (eks. mva)", "", "", "", "", "", "", "", s.sum]);
  if (o.fra || o.til) rader.push(["Revisjon " + (o.til || "") + " mot " + (o.fra || "")]);
  rader.push(["Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål."]);
  return rader;
}

// Frist etter Storms EM-flyt: oppdaget + 3 dager (kan endres i panelet)
export function emFrist(oppdagetISO, dager) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(oppdagetISO || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(dager) || 3)));
  return d.toISOString().slice(0, 10);
}

// Midtpunkt for markeringen: snittet av elementsentrene (nye/endrede fra
// boksene i modellen, slettede fra avtrykket).
export function senter(punkter) {
  const p = (punkter || []).filter(x => Array.isArray(x) && x.length === 3 && x.every(isFinite));
  if (!p.length) return null;
  return p.reduce((s, x) => [s[0] + x[0] / p.length, s[1] + x[1] / p.length, s[2] + x[2] / p.length], [0, 0, 0]);
}

// ═══════════ 🔒 Intern EM-liste og bildesider (Emil 26.10: PDF C, lagring A) ═══════════
// EM-ene er IKKE markeringer lenger. Markeringer reiser ut til byggeplassen
// (byggeplass.js → <fil>.markeringer.json), og en endringsmelding med priser og
// bilder skal bare finnes på kontoret. De lagres i SharePoint-mappa
// «Endringsmeldinger», én fil per prosjekt, som Workeren aldri ser.

// Statusene: Opprettet → Sendt → Fullført (Godkjent eller Avvist)
export const EM_STATUS = ["opprettet", "sendt", "godkjent", "avvist"];
export const STATUS_NAVN = { opprettet: "Opprettet", sendt: "Sendt", godkjent: "Fullført · godkjent", avvist: "Fullført · avvist" };
export const erFullfort = (s) => s === "godkjent" || s === "avvist";
// Filteret i lista: «fullført» dekker begge svarene
export function iFilter(em, filter) {
  if (!filter || filter === "alle") return true;
  if (filter === "fullfort") return erFullfort(em.status);
  return em.status === filter;
}
export function filtrerEm(liste, o) {
  const opt = o || {}, sok = String(opt.sok || "").trim().toLowerCase();
  return (liste || []).filter(e => e && !e.slettet && iFilter(e, opt.filter) &&
    (!sok || (String(e.nr || "") + " " + String(e.tittel || "")).toLowerCase().includes(sok)))
    .sort((a, b) => String(b.laget || "").localeCompare(String(a.laget || "")));
}
export function tellStatus(liste) {
  const n = { alle: 0, opprettet: 0, sendt: 0, fullfort: 0 };
  for (const e of liste || []) {
    if (!e || e.slettet) continue;
    n.alle++;
    if (erFullfort(e.status)) n.fullfort++; else if (n[e.status] != null) n[e.status]++;
  }
  return n;
}
// Sum av det som fortsatt venter på svar (opprettet + sendt)
export function sumApne(liste) {
  return (liste || []).filter(e => e && !e.slettet && !erFullfort(e.status)).reduce((s, e) => s + (Number(e.sum) || 0), 0);
}

// Fila: prosjektnummeret hvis det finnes, ellers modellnavnet
export function emFil(prosjektNr, modellFil) {
  const ren = (s) => String(s || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-").trim().slice(0, 80);
  const n = ren(prosjektNr) || ren(modellFil) || "uten-prosjekt";
  return n + ".endringsmeldinger.json";
}

// Aksen et punkt står på. akser = S.akseLinjer: { x:[{c,navn}] (tallakser),
// z:[{c,navn}] (bokstavakser), tol }. «B3» på aksekrysset, «B–C/3» mellom.
export function akseFor(c, akser) {
  if (!akser || !Array.isArray(c)) return "";
  const del = (liste, v) => {
    const l = (liste || []).filter(a => a && isFinite(a.c)).slice().sort((a, b) => a.c - b.c);
    if (!l.length || !isFinite(v)) return "";
    const tol = Number(akser.tol) || 0;
    let best = l[0];
    for (const a of l) if (Math.abs(a.c - v) < Math.abs(best.c - v)) best = a;
    if (Math.abs(best.c - v) <= tol) return String(best.navn);
    const i = l.findIndex(a => a.c > v);
    if (i <= 0) return (i === 0 ? "<" + l[0].navn : ">" + l[l.length - 1].navn);
    return l[i - 1].navn + "–" + l[i].navn;
  };
  const z = del(akser.z, c[2]), x = del(akser.x, c[0]);
  if (!z && !x) return "";
  // Utenfor aksene: nærmeste akse og «utenfor» — ikke «<A/>6» (Emils test 26.10)
  if (/[<>]/.test(z + x)) {
    const zz = z.replace(/[<>]/g, ""), xx = x.replace(/[<>]/g, "");
    return (/–/.test(zz + xx) ? [zz, xx].filter(Boolean).join("/") : zz + xx) + " (utenfor)";
  }
  const enkel = (s) => !/[–<>]/.test(s);
  return (z && x && enkel(z) && enkel(x)) ? z + x : [z, x].filter(Boolean).join("/");
}

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const pkt = (a) => Array.isArray(a) ? a.slice(0, 3).map(r3) : null;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const retn = (r) => (Array.isArray(r) && r.length === 3 && r.every(x => isFinite(Number(x)))) ? r.map(x => Math.round(Number(x) * 1e5) / 1e5) : null;
export const kortGuid = (g) => { const s = String(g || ""); return s.length > 10 ? s.slice(0, 4) + "…" + s.slice(-3) : s; };
export const MAKS_ELEMENTER = 400;   // per endring i fila — resten telles

// Én «endring» per linje (elementtype) som er krysset av: elementene med hva
// som skjedde, aksen, mengden i linjas enhet, og boksene til bildene/planen.
export function endringerFra(res, linjer, o) {
  const opt = o || {}, toM = Number(opt.toM) || 1;
  return (linjer || []).map(l => {
    const nok = linjeNokler(res);
    const av = (e) => nok(e) === l.key;
    const el = [];
    const legg = (e, hva) => {
      let m;
      if (hva === "fjernet") m = -mengdeILinje(e, l, toM);
      else if (hva === "endret") m = l.enhet === "stk" ? null : mengdeILinje(e, l, toM) - mengdeILinje(Object.assign({ name: e.name }, e.fra || {}), l, toM);
      else m = mengdeILinje(e, l, toM);
      el.push({ hva, id: e.id != null ? e.id : null, navn: String(e.name || "").slice(0, 80), guid: String(e.guid || ""),
        akse: akseFor(e.c, opt.akser), mengde: m == null ? null : avrund(m, l.enhet),
        c: pkt(e.c), d: pkt(e.d), fc: e.fra ? pkt(e.fra.c) : null, fd: e.fra ? pkt(e.fra.d) : null,
        // 🔍 detaljene (em-detalj.js): retning, lengde, volum og navnet før
        r: retn(e.r), L: r3(e.L), v: r6(e.v),
        fr: e.fra ? retn(e.fra.r) : null, fL: e.fra ? r3(e.fra.L) : 0, fv: e.fra ? r6(e.fra.v) : 0,
        nf: e.fra ? String(e.fra.name || "").slice(0, 80) : "" });
    };
    const nyHva = opt.utvalg ? "valgt" : "ny";
    for (const e of (res && res.slettet) || []) if (av(e)) legg(e, "fjernet");
    for (const e of (res && res.ny) || []) if (av(e)) legg(e, nyHva);
    for (const e of (res && res.endret) || []) if (av(e)) legg(e, "endret");
    const deler = [];
    if (opt.utvalg) deler.push(l.ny + " valgt");
    else {
      if (l.slettet) deler.push(l.slettet + " fjernet");
      if (l.ny) deler.push(l.ny + " ny" + (l.ny > 1 ? "e" : ""));
      if (l.endret) deler.push(l.endret + " endret");
    }
    const nyId = nyIdFor(res, opt, (e) => nok(e) === l.key);
    return { key: l.key, navn: l.navn, undertekst: l.undertekst || "", enhet: l.enhet,
      oppsummering: deler.join(" · ") + " → " + mengdeTekst(l) + (nyId.length ? " · " + nyId.length + " samme element med ny ID (ikke priset)" : ""),
      antall: el.length, elementer: el.slice(0, MAKS_ELEMENTER), bilder: { for: "", etter: "" }, nyId,
      // Antallene fra linja — elementlista er kuttet ved MAKS_ELEMENTER, og Excel
      // talte fra den («Ny 400» der det var 769, stresstest 27.10)
      tall: { ny: l.ny || 0, fjernet: l.slettet || 0, endret: l.endret || 0 },
      // 📏 per profil — står i PDF-en og Excel, så kontraktsparten ser regningen
      profiler: (l.profiler || []).slice(0, 60).map(p => ({ navn: p.navn, ny: p.ny, slettet: p.slettet, endret: p.endret, byttetFra: p.byttetFra || 0, lm: p.lm,
        kgPerM: p.kgPerM, kilde: p.kgPerMKilde || "", mengde: p.mengde })) };
  });
}

// 🔗 «Samme element, ny ID» (em-paring.js) i kort form: navn, akse, GlobalId før → etter, grunn
export function nyIdFor(res, o, filter) {
  return ((res && res.uendretNyId) || []).filter(p => p && p.til && (!filter || filter(p.til))).slice(0, MAKS_ELEMENTER).map(p => ({
    navn: String(p.til.name || "").slice(0, 80), type: String(p.til.type || ""), akse: akseFor(p.til.c, o && o.akser),
    gf: String(p.fra.guid || ""), gt: String(p.til.guid || ""), grunn: p.grunn === "revit" ? "revit" : "sted",
    nr: p.grunn === "revit" ? (/:(\d{4,})\s*$/.exec(String(p.til.name || "")) || [])[1] || "" : "" }));
}
// Typene som bare har elementer med ny ID (ingen ekte endring) — de har ingen
// egen endringsside, men skal likevel stå i PDF-en (Emil 26.10: «ja det skal det»)
export function nyIdUtenEndring(res, endringer, o) {
  const har = new Set((endringer || []).map(e => e.key));
  const nok = linjeNokler(res);
  return nyIdFor(res, o, (e) => !har.has(nok(e)));
}

// Mengden i tabellen på bildesida
export function elementMengde(e, enhet) {
  if (e.hva === "endret" && !e.mengde) return "endret";
  if (e.mengde == null) return "";
  const d = enhet === "stk" || enhet === "kg" ? 0 : 2;
  return (e.mengde > 0 && e.hva !== "valgt" ? "+" : "") + tallTekst(e.mengde, d) + " " + enhet;
}

// Utsnittet i planen ovenfra (x mot høyre, z nedover): alle fotavtrykk
// (også det gamle til endrede), med litt luft rundt.
export function planUtsnitt(elementer) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const ta = (c, d) => {
    if (!c || !d) return;
    x0 = Math.min(x0, c[0] - d[0] / 2); x1 = Math.max(x1, c[0] + d[0] / 2);
    z0 = Math.min(z0, c[2] - d[2] / 2); z1 = Math.max(z1, c[2] + d[2] / 2);
  };
  for (const e of elementer || []) { ta(e.c, e.d); ta(e.fc, e.fd); }
  if (!isFinite(x0)) return null;
  const luft = Math.max(x1 - x0, z1 - z0) * 0.18 || 1;
  return { x0: x0 - luft, x1: x1 + luft, z0: z0 - luft, z1: z1 + luft };
}

// Vask av en EM-post fra SharePoint: bare kjente felt, tekst er tekst
const tekst = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, n || 200);
const tall = (v) => (v == null || v === "" || !isFinite(Number(v))) ? null : Number(v);
const trePkt = (a) => (Array.isArray(a) && a.length === 3 && a.every(x => isFinite(Number(x)))) ? a.map(Number) : null;
export function vaskEm(r) {
  if (!r || typeof r !== "object" || !r.id) return null;
  const ut = {
    id: tekst(r.id, 60), nr: tekst(r.nr, 30), tittel: tekst(r.tittel, 120),
    status: EM_STATUS.includes(r.status) ? r.status : "opprettet",
    laget: tekst(r.laget, 30), av: tekst(r.av, 80), oppdaget: tekst(r.oppdaget, 10), frist: tekst(r.frist, 10),
    sum: tall(r.sum), manglerPris: Math.max(0, Math.round(tall(r.manglerPris) || 0)),
    modell: tekst(r.modell, 160), fra: tekst(r.fra, 160), til: tekst(r.til, 160), metode: tekst(r.metode, 30),
    utvalg: r.utvalg === true, toM: tall(r.toM) || 1,
    endret: tekst(r.endret, 30), slettet: r.slettet === true,
    historikk: (Array.isArray(r.historikk) ? r.historikk : []).slice(-50).map(h => ({ tid: tekst(h && h.tid, 30), av: tekst(h && h.av, 80), hva: tekst(h && h.hva, 120) })),
    akser: null, endringer: [], nyIdAndre: vaskNyId(r.nyIdAndre),
    kontrakt: r.kontrakt && typeof r.kontrakt === "object" ? { mottaker: tekst(r.kontrakt.mottaker, 160), kontrakt: tekst(r.kontrakt.kontrakt, 320) } : null,
    varsel: r.varsel && typeof r.varsel === "object" ? { type: tekst(r.varsel.type, 40), hjemmel: tekst(r.varsel.hjemmel, 160), revFor: tekst(r.varsel.revFor, 80),
      revEtter: tekst(r.varsel.revEtter, 80), mottatt: tekst(r.varsel.mottatt, 10), arbeidet: tekst(r.varsel.arbeidet, 30) } : null, skjema: (r.skjema && typeof r.skjema === "object") ? r.skjema : null
  };
  if (r.akser && typeof r.akser === "object") {
    const a = (l) => (Array.isArray(l) ? l : []).slice(0, 80).filter(x => x && isFinite(Number(x.c))).map(x => ({ c: Number(x.c), navn: tekst(x.navn, 6) }));
    ut.akser = { x: a(r.akser.x), z: a(r.akser.z), tol: tall(r.akser.tol) || 0 };
  }
  ut.endringer = (Array.isArray(r.endringer) ? r.endringer : []).slice(0, 40).map(e => ({
    key: tekst(e && e.key, 60), navn: tekst(e && e.navn, 60), undertekst: tekst(e && e.undertekst, 120),
    enhet: EM_ENHETER.includes(e && e.enhet) ? e.enhet : "stk", oppsummering: tekst(e && e.oppsummering, 160),
    antall: Math.max(0, Math.round(tall(e && e.antall) || 0)),
    bilder: { for: bildeNavnOk(e && e.bilder && e.bilder.for), etter: bildeNavnOk(e && e.bilder && e.bilder.etter) },
    nyId: vaskNyId(e && e.nyId),
    tall: e && e.tall && typeof e.tall === "object" ? { ny: Math.max(0, Math.round(tall(e.tall.ny) || 0)), fjernet: Math.max(0, Math.round(tall(e.tall.fjernet) || 0)), endret: Math.max(0, Math.round(tall(e.tall.endret) || 0)) } : null,
    profiler: (Array.isArray(e && e.profiler) ? e.profiler : []).slice(0, 60).map(p => ({ navn: tekst(p && p.navn, 60),
      ny: Math.max(0, Math.round(tall(p && p.ny) || 0)), slettet: Math.max(0, Math.round(tall(p && p.slettet) || 0)), endret: Math.max(0, Math.round(tall(p && p.endret) || 0)),
      byttetFra: Math.max(0, Math.round(tall(p && p.byttetFra) || 0)),
      lm: tall(p && p.lm) || 0, kgPerM: tall(p && p.kgPerM), kilde: p && p.kilde === "egen" ? "egen" : (p && p.kilde === "modell" ? "modell" : ""), mengde: tall(p && p.mengde) || 0 })),
    elementer: (Array.isArray(e && e.elementer) ? e.elementer : []).slice(0, MAKS_ELEMENTER).map(x => ({
      hva: ["ny", "fjernet", "endret", "valgt"].includes(x && x.hva) ? x.hva : "ny",
      id: tall(x && x.id), navn: tekst(x && x.navn, 80), guid: tekst(x && x.guid, 40), akse: tekst(x && x.akse, 20),
      mengde: tall(x && x.mengde), c: trePkt(x && x.c), d: trePkt(x && x.d), fc: trePkt(x && x.fc), fd: trePkt(x && x.fd),
      r: trePkt(x && x.r), L: tall(x && x.L) || 0, v: tall(x && x.v) || 0,
      fr: trePkt(x && x.fr), fL: tall(x && x.fL) || 0, fv: tall(x && x.fv) || 0, nf: tekst(x && x.nf, 80)
    }))
  }));
  return ut;
}
// Bildene ligger i samme mappe, med navn vi selv har laget — alt annet avvises
function vaskNyId(l) {
  return (Array.isArray(l) ? l : []).slice(0, MAKS_ELEMENTER).map(x => ({ navn: tekst(x && x.navn, 80), type: tekst(x && x.type, 60),
    akse: tekst(x && x.akse, 24), gf: tekst(x && x.gf, 40), gt: tekst(x && x.gt, 40), grunn: x && x.grunn === "revit" ? "revit" : "sted", nr: tekst(x && x.nr, 12) }));
}
export function bildeNavnOk(n) { const s = String(n || ""); return /^em-[a-z0-9-]{4,60}\.jpg$/i.test(s) ? s : ""; }
export function bildeFil(emId, i, hva) { return "em-" + String(emId).replace(/[^a-z0-9-]/gi, "").slice(0, 40) + "-" + (i + 1) + "-" + (hva === "for" ? "for" : "etter") + ".jpg"; }

// Excel: oversikten over alle EM-ene i lista
export function oversiktRader(liste) {
  const rader = [["EM-nr", "Tittel", "Status", "Laget", "Av", "Frist", "Endringer", "Elementer", "Prisanslag (kr eks. mva)"]];
  for (const e of filtrerEm(liste, {})) rader.push([e.nr, e.tittel, STATUS_NAVN[e.status] || e.status, String(e.laget || "").slice(0, 10), e.av, e.frist,
    e.endringer.length, e.endringer.reduce((s, x) => s + (x.antall || 0), 0), e.sum == null ? "" : e.sum]);
  rader.push([], ["Sum åpne (opprettet + sendt)", "", "", "", "", "", "", "", sumApne(liste)]);
  return rader;
}
