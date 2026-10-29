// 🧅 LAG — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan runde 5 (9a), Emils valg B 28.10.2026: eget verktøy «Lag» i Bygg
// Info. Flere modeller legges OPPÅ hovedmodellen (armering på betong, stål på
// betong, ARK på RIB). Hovedmodellen beholder alle verktøy; lagene er egne
// grupper i scenen med egne kort, nøkkeltall og egenskapsboks.
//
// Testfilene (Lørenskog, 28.10) viste hva Revit faktisk eksporterer for
// armering: diameter, lengde og bøyeform — men INGEN vekt og INGEN
// posisjonsnummer. Vekten regnes derfor her: π/4 · d² · L · 7 850 kg/m³ per
// stang, ganger antall stenger i Revit-settet.
//
// Alt her er uten DOM, S og three.js. Matrisene er 16 tall i kolonnerekkefølge
// (samme som THREE.Matrix4.elements).

export const FAG = [
  { k: "Armering", farge: "#f08a24" },
  { k: "Stål", farge: "#3b82f6" },
  { k: "RIB", farge: "#8b939e" },
  { k: "ARK", farge: "#c9ced5" },
  { k: "RIV", farge: "#14a3a3" },
  { k: "RIE", farge: "#e9c13b" },
  { k: "Annet", farge: "#c2388a" }
];
export const MAKS_LAG = 8;
export const STAAL_TETTHET = 7850;   // kg/m³

export const fargeFor = (fag) => (FAG.find(f => f.k === fag) || FAG[FAG.length - 1]).farge;

// Gjett fag ut fra filnavnet. «Logistikkbygg Lørenskog_ Armering_RIB Fundamentering.ifc» → Armering.
export function gjettFag(filnavn) {
  const s = String(filnavn || "").toLowerCase();
  if (/armer|rebar|reinforc/.test(s)) return "Armering";
  if (/stål|stal\b|steel|tekla/.test(s)) return "Stål";
  if (/\bark\b|arkitekt|[-_ ]ark[-_ .]/.test(s)) return "ARK";
  if (/\briv\b|[-_ ]riv[-_ .]|vvs|ventil/.test(s)) return "RIV";
  if (/\brie\b|[-_ ]rie[-_ .]|elektro/.test(s)) return "RIE";
  if (/\brib\b|[-_ ]rib[-_ .]|betong|konstruksjon/.test(s)) return "RIB";
  return "Annet";
}
export const lagNavn = (filnavn) => String(filnavn || "lag").replace(/\.(ifc|glb)$/i, "").replace(/\.lag$/i, "").trim() || "lag";
export const lagGlbNavn = (filnavn) => lagNavn(filnavn).replace(/[\\/:*?"<>|#%]/g, "-").slice(0, 120) + ".lag.glb";

// ---------- Matriser (4×4, kolonnerekkefølge) ----------
export const ENHET = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function gang(a, b) {
  const ut = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    ut[c * 4 + r] = s;
  }
  return ut;
}
export function inverter(m) {
  const a = m, inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) return null;
  return inv.map(x => x / det);
}
// Enhetsmatrise (eller ingen) = «ingen flytting lagret»
export const erEnhet = (m) => !Array.isArray(m) || m.length !== 16 || m.every((x, i) => Math.abs(x - ENHET[i]) < 1e-9);
const gyldig = (m) => Array.isArray(m) && m.length === 16 && m.every(x => isFinite(x));

// PLASSERINGEN. web-ifc flytter hver modell til origo når den åpnes
// (COORDINATE_TO_ORIGIN) og forteller hvordan med en koordinasjonsmatrise M.
// Viewer'en lagrer kote = M⁻¹ («flyttingen tilbake», S.koteMatrixInv), både
// for IFC og i lette kopier. Et lag har sin egen kote. For å legge laget i
// hovedmodellens rom: tilbake til de ekte koordinatene med lagets kote, og så
// inn i hovedmodellens rom med hovedmodellens M (= kote⁻¹):
//     T = hoved.kote⁻¹ · lag.kote
// Forutsetter delte koordinater (samme Revit-prosjekt) — Lørenskog-filene har det.
export function lagTransform(hovedKote, lagKote) {
  const h = gyldig(hovedKote) ? inverter(hovedKote) : null;
  const l = gyldig(lagKote) ? lagKote : null;
  return gang(h || ENHET, l || ENHET);
}
export function brukPaaPunkt(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

// Ligger laget langt unna hovedmodellen? Boksene er { min:[x,y,z], max:[x,y,z] }.
// «Langt» = boksene overlapper ikke og sentrene står mer enn én største
// diagonal fra hverandre. Da er det nesten sikkert ulike koordinatsystemer.
export function avstandSjekk(a, b) {
  if (!a || !b) return { langt: false, avstand: 0 };
  const senter = (x) => [0, 1, 2].map(i => (x.min[i] + x.max[i]) / 2);
  const diag = (x) => Math.hypot(...[0, 1, 2].map(i => x.max[i] - x.min[i]));
  const sa = senter(a), sb = senter(b);
  const avstand = Math.hypot(sa[0] - sb[0], sa[1] - sb[1], sa[2] - sb[2]);
  const overlapp = [0, 1, 2].every(i => a.min[i] <= b.max[i] && b.min[i] <= a.max[i]);
  return { langt: !overlapp && avstand > Math.max(diag(a), diag(b)), avstand };
}

// ---------- Armeringen ----------
export function diameterFraNavn(navn) {
  const m = /(?:[ØøΦφ⌀]|\bD|\bdia\.?\s?)(\d{1,2})\b/.exec(String(navn || ""));
  return m ? Number(m[1]) : null;
}
export const kgPerMeter = (dMm) => (dMm > 0 ? Math.PI / 4 * (dMm / 1000) ** 2 * STAAL_TETTHET : 0);

// Rått fra IFC-tråden (cmdLagTall) + navnet → nøkkeltallene for én armering.
export function armeringTall(raa, navn) {
  if (!raa) return null;
  const d = Number(raa.d) > 0 ? Number(raa.d) : diameterFraNavn(navn);
  const L = Number(raa.L) > 0 ? Number(raa.L) : null;
  const n = Math.max(1, Math.round(Number(raa.n) || 1));
  const kgM = kgPerMeter(d);
  const kgStk = L ? kgM * L / 1000 : null;
  return {
    d: d || null, L, n, kgPerM: kgM || null,
    kgStk: kgStk == null ? null : Math.round(kgStk * 100) / 100,
    kg: kgStk == null ? null : Math.round(kgStk * n * 100) / 100,
    lm: L ? Math.round(L / 1000 * n * 100) / 100 : null,
    form: String(raa.form || ""), mal: raa.mal && typeof raa.mal === "object" ? raa.mal : {},
    kval: String(raa.kval || ""), ref: String(raa.ref || ""), pos: String(raa.pos || "")
  };
}

// «Marker alle like»: samme diameter OG samme bøyeform (Revit eksporterer
// ikke posisjonsnummer — Emils testfiler 28.10). Har vi posisjonsnummer,
// er DET nøkkelen.
export function likeArmering(tall, id) {
  const a = tall && tall[id];
  if (!a) return [];
  const nokkel = (x) => x.pos ? "p:" + x.pos : "d:" + x.d + "|" + x.form;
  const k = nokkel(a);
  return Object.keys(tall).filter(i => tall[i] && nokkel(tall[i]) === k).map(Number);
}

// ---------- Volum fra geometrien ----------
// Signert tetraeder-sum per element (samme metode som Mengder). pos er
// punktene, idx trekantene, ranges { start, count, id } i idx. Svar i
// modellenheter³ — ganges med toM³ av den som kaller.
export function elementVolumer(pos, idx, ranges, ut) {
  const v = ut || new Map();
  for (const r of ranges || []) {
    let s = 0;
    for (let i = r.start; i < r.start + r.count; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      s += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
         - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
         + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    v.set(r.id, (v.get(r.id) || 0) + s / 6);
  }
  return v;
}

// ---------- Summen på kortet ----------
// props: { id: [navn, objektType, IfcType, materiale, GlobalId] }
// tall:  { id: armeringTall } · volum: Map id → m³
export function lagSum(props, tall, volum) {
  const ider = Object.keys(props || {});
  const arm = Object.values(tall || {}).filter(Boolean);
  const perD = new Map();
  for (const a of arm) {
    const k = a.d || 0;
    const x = perD.get(k) || { d: k, stk: 0, kg: 0, lm: 0 };
    x.stk += a.n; x.kg += a.kg || 0; x.lm += a.lm || 0;
    perD.set(k, x);
  }
  const perDiameter = [...perD.values()].sort((a, b) => a.d - b.d)
    .map(x => ({ d: x.d, stk: x.stk, kg: Math.round(x.kg * 10) / 10, lm: Math.round(x.lm * 10) / 10 }));
  const volumM3 = volum ? [...volum.values()].reduce((s, v) => s + Math.abs(v), 0) : 0;
  // «<Unnamed>» og «Default» er Revits plassholdere, ikke materialer (Emils bilde 28.10)
  const materialer = [...new Set(ider.map(i => props[i] && props[i][3]).filter(m => m && !/^(<unnamed>|default)$/i.test(String(m).trim())))].sort();
  const dims = perDiameter.filter(x => x.d).map(x => x.d);
  return {
    elementer: ider.length,
    armering: arm.length,
    stenger: arm.reduce((s, a) => s + a.n, 0),
    kg: Math.round(arm.reduce((s, a) => s + (a.kg || 0), 0) * 10) / 10,
    volumM3: Math.round(volumM3 * 100) / 100,
    materialer, perDiameter,
    dimTekst: dims.length ? (dims.length === 1 ? "Ø" + dims[0] : "Ø" + dims[0] + "–Ø" + dims[dims.length - 1]) : ""
  };
}

// ---------- Tekst ----------
const tusen = (n, d) => {
  const s = (Math.round(n * 10 ** (d || 0)) / 10 ** (d || 0)).toFixed(d || 0).split(".");
  return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (s[1] ? "," + s[1] : "");
};
export const heltall = (n) => tusen(Number(n) || 0, 0);
export function vektTekst(kg) {
  if (!(kg > 0)) return "–";
  return kg >= 1000 ? tusen(kg / 1000, 1) + " t" : tusen(kg, 0) + " kg";
}
export const volumTekst = (m3) => (m3 > 0 ? tusen(m3, m3 >= 100 ? 0 : 1) + " m³" : "–");
export const mmTekst = (mm) => (mm > 0 ? tusen(mm, 0) + " mm" : "–");

// De tre rutene på kortet (prøvebilde B): [tall, etikett] × 3.
// Etikettene er norske nøkler — oversettes med t() av den som tegner.
export function kortRuter(sum) {
  if (sum.armering) return [
    [heltall(sum.stenger), "stenger"],
    [vektTekst(sum.kg), "vekt (beregnet)"],
    [sum.dimTekst || "–", "dimensjoner"]
  ];
  return [
    [heltall(sum.elementer), "elementer"],
    [volumTekst(sum.volumM3), "volum"],
    [sum.materialer.length ? sum.materialer.slice(0, 2).join(", ") + (sum.materialer.length > 2 ? " …" : "") : "–", "materialer"]
  ];
}

// Radene under «NØKKELTALL» i egenskapsboksen: [[etikett, verdi], …]
export function nokkelRader(a) {
  if (!a) return [];
  const rader = [];
  if (a.d) rader.push(["Diameter", "Ø" + a.d + " mm"]);
  if (a.L) rader.push(["Lengde per stang", mmTekst(a.L)]);
  rader.push(["Antall stenger", heltall(a.n)]);
  if (a.kgStk != null) rader.push(["Vekt (beregnet)", tusen(a.kgStk, 2) + " kg/stk · " + vektTekst(a.kg) + " totalt"]);
  if (a.form) rader.push(["Bøyeform", a.form]);
  const mal = Object.keys(a.mal || {}).filter(k => a.mal[k] > 0).sort();
  if (mal.length) rader.push(["Bøyemål", mal.map(k => k + " = " + tusen(a.mal[k], 0)).join(" · ")]);
  if (a.kval) rader.push(["Stålkvalitet", a.kval]);
  if (a.pos) rader.push(["Posisjonsnummer", a.pos]);
  return rader;
}

// ---------- 📐 Juster plassering (Emils valg A, 28.10.2026) ----------
// Selv med delte koordinater lå armeringen på Lørenskog 0,15–0,42 m over
// veggtoppene: etasjene i armeringsfila står 120 mm høyere enn i betongen
// (Kjeller 162 000 → 162 120 osv.). Derfor en justering OPPÅ T:
//   • Høyde fra etasjene med samme navn (nøyaktig — hentet fra IFC-en).
//   • Sideveis fra midtpunktet av samme søyle/pæl i begge (overdekningen
//     gjør hjørnene ubrukelige, men midtpunktet er det samme).
//   • Finjustering med piltaster, Z/X og rullehjulet.
// Justeringen er i MILLIMETER langs modellens akser: øst = +X, nord = +Y,
// høyde = +Z i IFC. I scenen (Y opp fra web-ifc) blir det x, −z og y.
export const TOM_JUSTERING = Object.freeze({ ost: 0, nord: 0, hoyde: 0, kilde: [] });
export const STEG_MM = [1, 10, 100];

const runde = (x) => Math.round((Number(x) || 0) * 10) / 10;
export function vaskJustering(j) {
  if (!j || typeof j !== "object") return { ost: 0, nord: 0, hoyde: 0, kilde: [] };
  const kilde = Array.isArray(j.kilde) ? [...new Set(j.kilde.map(String).filter(k => /^(etasjer|midtpunkt|manuelt)$/.test(k)))] : [];
  return { ost: runde(j.ost), nord: runde(j.nord), hoyde: runde(j.hoyde), kilde };
}
export const erJustert = (j) => !!j && (Math.abs(j.ost || 0) >= 0.05 || Math.abs(j.nord || 0) >= 0.05 || Math.abs(j.hoyde || 0) >= 0.05);

// mm langs IFC-aksene → forskyvning i scenen (modellenheter). meterPerEnhet = S.enhetSkala.
export function justeringTilScene(j, meterPerEnhet) {
  const e = (Number(meterPerEnhet) > 0 ? Number(meterPerEnhet) : 1) * 1000;   // mm per enhet
  const v = vaskJustering(j);
  return [v.ost / e, v.hoyde / e, -v.nord / e];
}
// Forskyvning i scenen → mm langs IFC-aksene (omvendt av den over)
export function sceneTilJustering(d, meterPerEnhet) {
  const e = (Number(meterPerEnhet) > 0 ? Number(meterPerEnhet) : 1) * 1000;
  return { ost: runde(d[0] * e), nord: runde(-d[2] * e), hoyde: runde(d[1] * e) };
}
// Lagets matrise med justeringen: flytt(j) · T
export function justertMatrise(T, j, meterPerEnhet) {
  const [x, y, z] = justeringTilScene(j, meterPerEnhet);
  const flytt = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  return gang(flytt, gyldig(T) ? T : ENHET);
}
export function leggTil(j, d, kilde) {
  const v = vaskJustering(j);
  const ut = vaskJustering({ ost: v.ost + (d.ost || 0), nord: v.nord + (d.nord || 0), hoyde: v.hoyde + (d.hoyde || 0), kilde: v.kilde.concat(kilde ? [kilde] : []) });
  if (!erJustert(ut)) ut.kilde = [];
  return ut;
}

// Ett tastetrykk / ett rullehakk i flytte-modus → endring i mm, eller null.
// Piltastene: ← vest, → øst, ↑ nord, ↓ sør. Z / rull fram = opp, X / rull bak = ned.
// Shift = 1 mm uansett valgt steg. Ctrl/Cmd/Alt slipper gjennom (Ctrl+Z er Angre).
export function tasteFlytt(key, steg, mod) {
  const m = mod || {};
  if (m.ctrl || m.meta || m.alt) return null;
  const s = m.shift ? 1 : (STEG_MM.includes(Number(steg)) ? Number(steg) : 10);
  switch (String(key)) {
    case "ArrowLeft": return { ost: -s };
    case "ArrowRight": return { ost: s };
    case "ArrowUp": return { nord: s };
    case "ArrowDown": return { nord: -s };
    case "z": case "Z": return { hoyde: s };
    case "x": case "X": return { hoyde: -s };
    default: return null;
  }
}
export function rulleFlytt(deltaY, steg, shift) {
  if (!deltaY) return null;
  const s = shift ? 1 : (STEG_MM.includes(Number(steg)) ? Number(steg) : 10);
  return { hoyde: deltaY < 0 ? s : -s };   // rull fram (deltaY < 0) = opp
}

// Etasjer med samme navn i hovedmodellen og laget → forslag til høyde.
// hoved/lag: [{ navn, mm }] (høyde i mm fra IFC-ens IfcBuildingStorey.Elevation).
// Svar: { par: [{ navn, hoved, lag, diff }], forslag (mm, flytt laget så mye),
//         spredning (mm), antall }. forslag = −median(lag − hoved).
const navnNokkel = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export function etasjeForslag(hoved, lag) {
  const h = new Map();
  for (const e of hoved || []) if (e && e.navn && isFinite(e.mm)) h.set(navnNokkel(e.navn), e);
  const par = [];
  const sett = new Set();
  for (const e of lag || []) {
    if (!e || !e.navn || !isFinite(e.mm)) continue;
    const k = navnNokkel(e.navn);
    if (sett.has(k) || !h.has(k)) continue;
    sett.add(k);
    const hv = h.get(k);
    // Et referansenivå som står på 0 i begge filene (Revits «Datum» på
    // Lørenskog) sier ingenting om forskyvningen — det hoppes over.
    if (Number(hv.mm) === 0 && Number(e.mm) === 0) continue;
    par.push({ navn: String(hv.navn), hoved: Number(hv.mm), lag: Number(e.mm), diff: runde(Number(e.mm) - Number(hv.mm)) });
  }
  if (!par.length) return { par, forslag: 0, spredning: 0, antall: 0, like: [], avvik: [] };
  par.sort((a, b) => a.hoved - b.hoved);
  const d = par.map(p => p.diff).sort((a, b) => a - b);
  const median = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  // «like» = etasjene som følger forslaget (±2 mm), «avvik» = de som ikke gjør det
  const like = par.filter(p => Math.abs(p.diff - median) <= 2), avvik = par.filter(p => Math.abs(p.diff - median) > 2);
  return { par, forslag: runde(-median) || 0, spredning: runde(d[d.length - 1] - d[0]), antall: par.length, like, avvik };
}

// To bokser (scenen, { min:[x,y,z], max:[x,y,z] }) → hvor mye laget skal
// flyttes sideveis (mm) for at midtpunktene sett ovenfra blir like.
export function midtpunktFlytt(hovedBoks, lagBoks, meterPerEnhet) {
  if (!hovedBoks || !lagBoks) return null;
  const m = (b, i) => (b.min[i] + b.max[i]) / 2;
  const d = sceneTilJustering([m(hovedBoks, 0) - m(lagBoks, 0), 0, m(hovedBoks, 2) - m(lagBoks, 2)], meterPerEnhet);
  return { ost: d.ost, nord: d.nord };
}

// Tekst på kortet: «Justert Ø +12 · N −5 · H −120 mm (etasjer, midtpunkt)».
// Kildene er norske nøkler — den som tegner oversetter dem.
const fortegn = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + tusen(Math.abs(n), Math.abs(n) % 1 ? 1 : 0);
export function justeringTekst(j) {
  const v = vaskJustering(j);
  if (!erJustert(v)) return "";
  const deler = [];
  if (Math.abs(v.ost) >= 0.05) deler.push("Ø " + fortegn(v.ost));
  if (Math.abs(v.nord) >= 0.05) deler.push("N " + fortegn(v.nord));
  if (Math.abs(v.hoyde) >= 0.05) deler.push("H " + fortegn(v.hoyde));
  return deler.join(" · ") + " mm";
}
export const mmFortegn = fortegn;

// Nøkkelen en justering lagres under: samme lag på samme hovedmodell.
export const justeringId = (hovedFil, lagFil) => String(hovedFil || "") + " | " + String(lagFil || "");

// ---------- 🗂 Modellgruppe (runde 5b, Emils valg A 29.10.2026) ----------
// Et sett «hovedmodell + lag» lagres i SharePoint og åpnes med ett trykk.
// Alle gruppene ligger i ÉN liste (Modellgrupper/modellgrupper.json) og
// flettes på id — som SW-resultater og grupper (sp-lager.js). Selve lagene
// ligger som ferdige lag-GLB i mappa «Lag»; gruppen er bare oppskriften.
export const GRUPPE_MAPPE = "Modellgrupper";
export const GRUPPE_FIL = "modellgrupper.json";
const tekst = (s, n) => String(s == null ? "" : s).slice(0, n || 200);
const hex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || "")) ? String(s).toLowerCase() : null;
export const nyGruppeId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function vaskGruppe(g) {
  if (!g || typeof g !== "object" || !g.id) return null;
  if (g.slettet) return { id: tekst(g.id, 60), slettet: true, endret: tekst(g.endret, 40) };
  const h = g.hoved && typeof g.hoved === "object" ? g.hoved : {};
  const lag = (Array.isArray(g.lag) ? g.lag : []).slice(0, MAKS_LAG).map(l => {
    if (!l || typeof l !== "object" || !l.fil) return null;
    const fag = FAG.some(f => f.k === l.fag) ? l.fag : "Annet";
    return {
      fil: tekst(l.fil), navn: tekst(l.navn || lagNavn(l.fil)), fag, farge: hex(l.farge) || fargeFor(fag),
      gjennom: Math.max(0, Math.min(90, Math.round(Number(l.gjennom) || 0))), synlig: l.synlig !== false,
      justering: vaskJustering(l.justering), libId: l.libId ? tekst(l.libId, 120) : null,
      size: Math.max(0, Number(l.size) || 0), endret: tekst(l.endret, 40)
    };
  }).filter(Boolean);
  return {
    id: tekst(g.id, 60), navn: tekst(g.navn, 80).trim() || "Gruppe",
    hoved: { navn: tekst(h.navn), libId: h.libId ? tekst(h.libId, 120) : null, size: Math.max(0, Number(h.size) || 0) },
    lag, endret: tekst(g.endret, 40), av: tekst(g.av, 80)
  };
}

// Det som er åpent nå → en gruppepost. hoved: { navn, libId, size }.
// lagene: lag-objektene fra lag.js (kilde, kildeRef, justering …).
export function gruppeFraOppsett(o) {
  return vaskGruppe({
    id: o.id || nyGruppeId(), navn: o.navn, av: o.av || "", endret: o.endret || new Date().toISOString(),
    hoved: o.hoved,
    lag: (o.lagene || []).map(l => ({
      fil: l.fil, navn: l.navn, fag: l.fag, farge: l.farge, gjennom: l.gjennom, synlig: l.synlig, justering: l.justering,
      libId: l.kildeRef && l.kildeRef.art === "bibliotek" && l.kildeRef.item ? l.kildeRef.item.id : (l.libId || null),
      size: l.kilde && l.kilde.size, endret: l.kilde && l.kilde.endret
    }))
  });
}

// Lista i nedtrekket: gruppene for modellen som er åpen først, så resten.
// Slettede (gravsteiner) vises ikke.
export function sorterGrupper(liste, hovedNavn) {
  const levende = (liste || []).map(vaskGruppe).filter(g => g && !g.slettet);
  const her = levende.filter(g => g.hoved.navn === hovedNavn).sort((a, b) => a.navn.localeCompare(b.navn, "no"));
  const andre = levende.filter(g => g.hoved.navn !== hovedNavn).sort((a, b) => a.navn.localeCompare(b.navn, "no"));
  return { her, andre };
}

// ---------- 📊 Mengder per lag ----------
// Samme skrivemåte i hovedmodellen og lagene: «Wall», ikke «IfcWall», og
// Revits plassholdere «<Unnamed>» / «Default» er ikke materialer (Lørenskog 29.10).
const typeUtenIfc = (x) => String(x || "Ukjent").replace(/^Ifc/i, "") || "Ukjent";
const vaskMateriale = (m) => { const s = String(m || "").trim(); return /^(<unnamed>|default)$/i.test(s) ? "" : s; };
// Et lag: armering per diameter (fra nøkkeltallene) + alt annet per IFC-type
// og materiale (volum fra geometrien, m³). props/tall/volum som i lagSum.
export function lagMengder(props, tall, volum) {
  const s = lagSum(props, tall, volum);
  const typer = new Map();
  for (const id of Object.keys(props || {})) {
    if (tall && tall[id]) continue;   // armeringen telles per diameter
    const p = props[id] || [];
    const type = typeUtenIfc(p[2]), materiale = vaskMateriale(p[3]);
    const k = type + "|" + materiale;
    const x = typer.get(k) || { type, materiale, antall: 0, volumM3: 0 };
    x.antall++; x.volumM3 += Math.abs((volum && volum.get(Number(id))) || 0);
    typer.set(k, x);
  }
  const liste = [...typer.values()].map(x => ({ ...x, volumM3: Math.round(x.volumM3 * 100) / 100 }))
    .sort((a, b) => b.volumM3 - a.volumM3 || b.antall - a.antall);
  return {
    perDiameter: s.perDiameter.filter(x => x.stk > 0),
    sumArm: { stk: s.stenger, lm: Math.round(s.perDiameter.reduce((a, x) => a + x.lm, 0) * 10) / 10, kg: s.kg },
    typer: liste,
    sumTyper: { antall: liste.reduce((a, x) => a + x.antall, 0), volumM3: Math.round(liste.reduce((a, x) => a + x.volumM3, 0) * 100) / 100 }
  };
}

// Hovedmodellen: gruppene fra Mengder (elements.js computeQuantities) slått
// sammen per IFC-type og materiale. groups: [[nøkkel, { type, material, count, vol }], …]
export function hovedMengder(groups) {
  const typer = new Map();
  for (const [, g] of groups || []) {
    if (!g) continue;
    const type = typeUtenIfc(g.type), materiale = vaskMateriale(g.material);
    const k = type + "|" + materiale;
    const x = typer.get(k) || { type, materiale, antall: 0, volumM3: 0 };
    x.antall += Number(g.count) || 0; x.volumM3 += Number(g.vol) || 0;
    typer.set(k, x);
  }
  const liste = [...typer.values()].map(x => ({ ...x, volumM3: Math.round(x.volumM3 * 100) / 100 }))
    .sort((a, b) => b.volumM3 - a.volumM3 || b.antall - a.antall);
  return { perDiameter: [], sumArm: { stk: 0, lm: 0, kg: 0 }, typer: liste,
    sumTyper: { antall: liste.reduce((a, x) => a + x.antall, 0), volumM3: Math.round(liste.reduce((a, x) => a + x.volumM3, 0) * 100) / 100 } };
}

// Excel: ett ark per modell. Overskriftene er norske nøkler (t() hos kalleren).
// Tall står som tall (ikke tekst), så Excel kan summere. SUM nederst som formel
// med ferdig regnet svar (vises også i «Beskyttet visning»).
export function mengdeRader(m, ov) {
  const T = ov || ((x) => x);
  const rader = [];
  const sum = (kol, fra, til, verdi) => ({ formel: "=SUM(" + kol + fra + ":" + kol + til + ")", verdi });
  if (m.perDiameter.length) {
    rader.push([T("Diameter"), T("Stenger"), T("Løpemeter (m)"), T("Vekt (kg)")]);
    const fra = rader.length + 1;
    for (const x of m.perDiameter) rader.push([x.d ? "Ø" + x.d : T("Ukjent"), x.stk, x.lm, x.kg]);
    const til = rader.length;
    rader.push([T("Sum"), sum("B", fra, til, m.sumArm.stk), sum("C", fra, til, m.sumArm.lm), sum("D", fra, til, m.sumArm.kg)]);
    if (m.typer.length) rader.push([]);
  }
  if (m.typer.length) {
    rader.push([T("IFC-type"), T("Materiale"), T("Antall"), T("Volum (m3)")]);
    const fra = rader.length + 1;
    for (const x of m.typer) rader.push([x.type, x.materiale, x.antall, x.volumM3]);
    const til = rader.length;
    rader.push([T("Sum"), "", sum("C", fra, til, m.sumTyper.antall), sum("D", fra, til, m.sumTyper.volumM3)]);
  }
  if (!rader.length) rader.push([T("Ingen mengder")]);
  return rader;
}
// Sammendraget: én rad per modell. liste: [{ navn, rolle, m }]
export function sammendragRader(liste, ov) {
  const T = ov || ((x) => x);
  const rader = [[T("Modell"), T("Rolle"), T("Elementer (uten armering)"), T("Volum (m3)"), T("Armering (stenger)"), T("Armering (kg)")]];
  for (const x of liste) rader.push([x.navn, T(x.rolle), x.m.sumTyper.antall, x.m.sumTyper.volumM3, x.m.sumArm.stk, x.m.sumArm.kg]);
  return rader;
}
// Excel tåler maks 31 tegn og ikke : \ / ? * [ ] i arknavn — og ingen like navn
export function arkNavnListe(navn) {
  const brukt = new Set();
  return navn.map(n => {
    let s = String(n || "Ark").replace(/[:\\/?*\[\]]/g, "-").slice(0, 31).trim() || "Ark";
    let k = s, i = 2;
    while (brukt.has(k.toLowerCase())) { const hale = " (" + i++ + ")"; k = s.slice(0, 31 - hale.length) + hale; }
    brukt.add(k.toLowerCase());
    return k;
  });
}
