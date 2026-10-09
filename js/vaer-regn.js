// 🌦 Vær på byggeplassen — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan: «Storm IFC-Viewer byggeplan Vaer og Prosjektinfo PLAN 2026-10-09».
// Emil 09.10: «vis regn hvis det regner og vind uansett — vi skal støpe
// betong, hvor mye regner det den dagen? eller er vindhastigheten for høy i
// dag til å bruke tårnkrana». Derfor regner denne fila ut tre JA/DELVIS/NEI-
// svar per døgn (tårnkran, støp, frost) i tillegg til selve været.
//
// Kilder (via Workeren, se worker.js /vaer):
//   • Varsel: MET Norway Locationforecast 2.0 «complete» (CC BY 4.0) — timevis
//     de første ~2,5 døgnene, deretter 6-timers, ca. 9–10 døgn fram.
//   • Tidligere dager: målt vær fra Frost (MET) når Workeren har en klient-ID,
//     ellers varselet Workeren lagret den dagen.
// Begge kommer hit i samme timeform: { t, temp, vind, kast, retning, regn,
// symbol, varighet, skydekke }.

// Standardgrensene (Emil 09.10: «sett alternativ 1 som standard og man kan
// stille på det manuelt inne på verktøyet»). Brukes bare til VARSLER — regn
// og vind vises alltid.
export const GRENSER_STANDARD = Object.freeze({
  kranKast: 20,      // m/s vindkast — tårnkran stopper
  stormMiddel: 20,   // m/s middelvind — stormvarsel
  regnDogn: 5,       // mm regn i døgnet — støp frarådes
  regnTime: 1,       // mm regn i én time — støp frarådes
  frost: 0           // °C — under dette er det frost (vinterstøp)
});
const GRENSE_SPENN = { kranKast: [5, 60], stormMiddel: [5, 60], regnDogn: [0.1, 200], regnTime: [0.1, 100], frost: [-30, 15] };
export function vaskGrenser(g) {
  const ut = {};
  for (const k of Object.keys(GRENSER_STANDARD)) {
    const v = Number(g && g[k]);
    const [a, b] = GRENSE_SPENN[k];
    ut[k] = (g && g[k] !== "" && g[k] != null && Number.isFinite(v)) ? Math.min(b, Math.max(a, v)) : GRENSER_STANDARD[k];
  }
  return ut;
}

// MET krever maks 4 desimaler. Vi bruker 2 (≈ 1 km): været er det samme over
// en byggeplass, og da deler alle modeller på samme sted samme cache i Workeren.
export function koordinat(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100 };
}

// ═══════════════════════ TID (norsk tid) ═══════════════════════
// MET og Frost svarer i UTC. Byggeplassen lever i norsk tid, og et døgn er
// 00–24 norsk tid — ellers ville kl. 01 om natta havnet på gårsdagen om
// sommeren. Intl gjør sommertid riktig uten egen tabell.
let _fmt = null;
function fmt() {
  if (!_fmt) _fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  return _fmt;
}
export function lokal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = {};
  for (const x of fmt().formatToParts(d)) p[x.type] = x.value;
  return { dato: p.year + "-" + p.month + "-" + p.day, time: Number(p.hour) % 24 };
}
export function iDagISO(naa) { return lokal(naa || new Date()).dato; }
export function leggTilDager(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
export function dagerMellom(a, b) {
  const t = (s) => { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 864e5);
}
const DAGNAVN = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
export function dagnavn(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return DAGNAVN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };

// ═══════════════════════ MET → TIMER ═══════════════════════
const tall = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : null;
export function tolkMet(json) {
  const ts = json && json.properties && Array.isArray(json.properties.timeseries) ? json.properties.timeseries : [];
  const timer = [];
  for (const x of ts) {
    const d = x && x.data;
    if (!d || !d.instant || !d.instant.details) continue;
    const i = d.instant.details;
    const n1 = d.next_1_hours, n6 = d.next_6_hours;
    const neste = n1 || n6;
    if (!neste) continue;          // siste punkt har bare «instant» — ingen periode å vise
    timer.push({
      t: x.time,
      temp: tall(i.air_temperature),
      vind: tall(i.wind_speed),
      kast: tall(i.wind_speed_of_gust),
      retning: tall(i.wind_from_direction),
      skydekke: tall(i.cloud_area_fraction),
      regn: tall(neste.details && neste.details.precipitation_amount) || 0,
      symbol: (neste.summary && neste.summary.symbol_code) || "",
      varighet: n1 ? 1 : 6
    });
  }
  const meta = json && json.properties && json.properties.meta;
  return { oppdatert: (meta && meta.updated_at) || "", timer };
}

// ═══════════════════════ BILDET ═══════════════════════
// Sju bilder er nok på en byggeplass: sol, lettskyet, overskyet, tåke, regn,
// sludd, snø og storm. Storm brukes ved torden ELLER middelvind over
// stormgrensa — det er vinden som stopper arbeidet, ikke bare lynet.
export const BILDER = ["sol", "delvis", "sky", "taake", "regn", "sludd", "sno", "storm"];
export const BILDE_NAVN = { sol: "Sol", delvis: "Lettskyet", sky: "Overskyet", taake: "Tåke", regn: "Regn", sludd: "Sludd", sno: "Snø", storm: "Storm", ukjent: "Ukjent" };
export function bildeFor(time, grenser) {
  if (!time) return "ukjent";
  const g = grenser || GRENSER_STANDARD;
  const s = String(time.symbol || "");
  if (/thunder/.test(s) || (time.vind != null && time.vind >= g.stormMiddel)) return "storm";
  if (/sleet/.test(s)) return "sludd";
  if (/snow/.test(s)) return "sno";
  if (/rain|drizzle/.test(s)) return "regn";
  if (/fog/.test(s)) return "taake";
  if (/^cloudy/.test(s)) return "sky";
  if (/partlycloudy/.test(s)) return "delvis";
  if (/clearsky|fair/.test(s)) return /fair/.test(s) ? "delvis" : "sol";
  // Målt vær (Frost) har ikke symbol: nedbør og temperatur avgjør, skydekket
  // (åttendedeler) når stasjonen måler det.
  if (time.regn > 0.05) return time.temp != null && time.temp <= 0 ? "sno" : time.temp != null && time.temp <= 1.5 ? "sludd" : "regn";
  if (time.skydekke != null) return time.skydekke <= 2 ? "sol" : time.skydekke <= 5 ? "delvis" : "sky";
  return "sky";
}

// ═══════════════════════ ETT DØGN ═══════════════════════
// 24 plasser, kl. 00–23 norsk tid. En 6-timers periode fyller 6 plasser, og
// nedbøren deles likt på dem (MET sier ikke hvilken av timene det regner i).
// Plasser ingen periode dekker, er null.
export function dogn(timer, dato, grenser) {
  const ut = new Array(24).fill(null);
  for (const x of timer || []) {
    const start = new Date(x.t);
    for (let k = 0; k < (x.varighet || 1); k++) {
      const l = lokal(new Date(start.getTime() + k * 36e5));
      if (!l || l.dato !== dato || ut[l.time]) continue;
      ut[l.time] = {
        time: l.time, temp: x.temp, vind: x.vind, kast: x.kast, retning: x.retning,
        regn: Math.round(((x.regn || 0) / (x.varighet || 1)) * 100) / 100,
        symbol: x.symbol, skydekke: x.skydekke, varighet: x.varighet || 1
      };
    }
  }
  for (const h of ut) if (h) h.bilde = bildeFor(h, grenser);
  return ut;
}

// Sammenhengende timer → «kl. 10–12». Tar en liste av timetall (sortert).
export function perioder(timer) {
  const ut = [];
  for (const h of timer) {
    const s = ut[ut.length - 1];
    if (s && h === s[1] + 1) s[1] = h; else ut.push([h, h]);
  }
  return ut;
}
const pad = (n) => String(n).padStart(2, "0");
export function periodeTekst(p) {
  return p.map(([a, b]) => a === b ? pad(a) : pad(a) + "–" + pad(b + 1 === 24 ? 24 : b + 1)).join(", ");
}

// Døgnet oppsummert, med de tre planleggingssvarene. `status` er "ja",
// "delvis", "nei" eller "" (ingen data).
export function dagSum(d, grenser) {
  const g = vaskGrenser(grenser);
  const h = (d || []).filter(Boolean);
  if (!h.length) return { harData: false, status: { kran: "", stop: "", frost: "" }, varsler: [] };
  const temps = h.map(x => x.temp).filter(v => v != null);
  const vinder = h.map(x => x.vind).filter(v => v != null);
  // Kast mangler når MET bare har 6-timers data (eller stasjonen ikke måler
  // det). Da vurderes kranen på middelvinden — og vi sier det.
  const kastFor = (x) => x.kast != null ? x.kast : x.vind;
  const kastMangler = h.some(x => x.kast == null);
  const kaster = h.map(kastFor).filter(v => v != null);
  const regnSum = Math.round(h.reduce((s, x) => s + (x.regn || 0), 0) * 10) / 10;
  const kranTimer = h.filter(x => kastFor(x) != null && kastFor(x) >= g.kranKast).map(x => x.time);
  const stormTimer = h.filter(x => x.vind != null && x.vind >= g.stormMiddel).map(x => x.time);
  const regnTimer = h.filter(x => (x.regn || 0) > 0.05).map(x => x.time);
  const kraftigTimer = h.filter(x => (x.regn || 0) >= g.regnTime).map(x => x.time);
  const frostTimer = h.filter(x => x.temp != null && x.temp < g.frost).map(x => x.time);
  const min = temps.length ? Math.min(...temps) : null, maks = temps.length ? Math.max(...temps) : null;
  const sum = {
    harData: true, antTimer: h.length,
    min, maks, regnSum,
    maksVind: vinder.length ? Math.max(...vinder) : null,
    maksKast: kaster.length ? Math.max(...kaster) : null,
    kastMangler,
    torden: h.some(x => /thunder/.test(String(x.symbol || ""))),
    kranTimer: perioder(kranTimer), regnTimer: perioder(regnTimer), frostTimer: perioder(frostTimer), stormTimer: perioder(stormTimer),
    status: {
      kran: !kranTimer.length ? "ja" : kranTimer.length >= Math.min(8, h.length) ? "nei" : "delvis",
      stop: (regnSum >= g.regnDogn || kraftigTimer.length) ? "nei" : regnSum > 0 ? "delvis" : "ja",
      frost: frostTimer.length ? "nei" : "ja"
    },
    varsler: []
  };
  if (stormTimer.length) sum.varsler.push({ type: "storm", niva: "fare", fra: stormTimer[0] });
  if (kranTimer.length) sum.varsler.push({ type: "kran", niva: "fare", fra: kranTimer[0] });
  if (sum.status.stop === "nei") sum.varsler.push({ type: "regn", niva: "varsel", fra: (kraftigTimer[0] != null ? kraftigTimer[0] : regnTimer[0]) });
  if (frostTimer.length) sum.varsler.push({ type: "frost", niva: "varsel", fra: frostTimer[0] });
  sum.bilde = dagBilde(h, g);
  return sum;
}

// Ett bilde for hele døgnet (Framdriftsplan-stripa): storm vinner alltid; så
// nedbør hvis det kommer minst 1 mm; ellers det vanligste bildet på dagtid.
export function dagBilde(h, grenser) {
  const g = grenser || GRENSER_STANDARD;
  const liste = (h || []).filter(Boolean);
  if (!liste.length) return "ukjent";
  const b = liste.map(x => x.bilde || bildeFor(x, g));
  if (b.includes("storm")) return "storm";
  const regn = liste.reduce((s, x) => s + (x.regn || 0), 0);
  if (regn >= 1) {
    const n = (k) => b.filter(x => x === k).length;
    return n("sno") > n("regn") && n("sno") >= n("sludd") ? "sno" : n("sludd") > n("regn") ? "sludd" : "regn";
  }
  const dag = liste.filter(x => x.time >= 7 && x.time <= 17);
  const bruk = (dag.length ? dag : liste).map(x => x.bilde || bildeFor(x, g)).filter(x => !["regn", "sludd", "sno"].includes(x));
  if (!bruk.length) return b[0];
  const tell = {};
  for (const x of bruk) tell[x] = (tell[x] || 0) + 1;
  return Object.keys(tell).sort((a, c) => tell[c] - tell[a] || BILDER.indexOf(c) - BILDER.indexOf(a))[0];
}

// Vindretning (grader, hvor vinden KOMMER FRA) → «sørvest».
const RETNINGER = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"];
export function retningNavn(gr) {
  if (gr == null || !Number.isFinite(gr)) return "";
  return RETNINGER[Math.round((((gr % 360) + 360) % 360) / 45) % 8];
}

// Kilden for en dato: "varsel" (i dag og framover så langt MET varsler),
// "historikk" (før i dag) eller "" (for langt fram — ingen varsel ennå).
export function kildeFor(dato, iDag, sisteVarselDato) {
  if (!dato) return "";
  if (dato < iDag) return "historikk";
  if (sisteVarselDato && dato <= sisteVarselDato) return "varsel";
  return "";
}
export function sisteDato(timer) {
  let s = "";
  for (const x of timer || []) { const l = lokal(x.t); if (l && l.dato > s) s = l.dato; }
  return s;
}

// Natt (0..1) ut fra solhøyden: 0 når sola står over 6°, 1 under −6°.
// Enkel solformel (deklinasjon + timevinkel) — godt nok til lys og mørke.
export function nattFor(lat, dato, time) {
  if (lat == null || !dato) return 0;
  const [y, m, d] = String(dato).split("-").map(Number);
  const dag = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const dekl = -23.44 * Math.cos(2 * Math.PI / 365 * (dag + 10)) * Math.PI / 180;
  // norsk tid ≈ soltid + 1 t (vinter) / 2 t (sommer); 1,5 t i snitt holder her
  const tv = (time + 0.5 - 13.5) * 15 * Math.PI / 180;
  const la = lat * Math.PI / 180;
  const hoyde = Math.asin(Math.sin(la) * Math.sin(dekl) + Math.cos(la) * Math.cos(dekl) * Math.cos(tv)) * 180 / Math.PI;
  return Math.max(0, Math.min(1, (6 - hoyde) / 12));
}
