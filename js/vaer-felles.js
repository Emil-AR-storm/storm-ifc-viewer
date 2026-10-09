// 🌦 Vær — DATAENE og BILDENE, felles for Vis vær (kontoret) og
// Framdriftsplan (kontoret OG byggeplass-siden).
//
// Emil 09.10: «det skal også være med på byggeplass-siden ved at det vises
// gjennom framdriftsplan-verktøyet og ikke som et eget verktøy». Derfor bor
// hentingen og tidslinje-tegningen her, og panelet (vaer.js) bare på kontoret.
//
// Dataene kommer fra Workeren (worker.js /vaer og /vaer/historikk):
//   • kontoret (GitHub Pages) kaller Workerens adresse (CORS tillatt)
//   • byggeplass-siden serveres FRA Workeren og kaller /vaer direkte
import { S, esc } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { TJENESTER } from "./config.js";
import {
  BILDE_NAVN, dagSum, dogn, iDagISO, kildeFor, koordinat, leggTilDager, lokal, periodeTekst,
  retningNavn, sisteDato, tolkMet, vaskGrenser
} from "./vaer-regn.js";

// ═══════════════════════ BILDENE ═══════════════════════
// Enkle, egne SVG-er (ingen lisensiert ikonpakke). Fargene er CSS-variabler
// (--vaer-*) så lyst og mørkt tema virker.
const SKY = (y) => '<path d="M10 ' + (36 - y) + 'h26a9 9 0 0 0 0-18 12 12 0 0 0-23 3 8 8 0 0 0-3 15z" fill="var(--vaer-sky)"/>';
const IKON = {
  sol: '<circle cx="24" cy="24" r="9" fill="var(--vaer-sol)"/><g stroke="var(--vaer-sol)" stroke-width="3" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M10 38l4-4M34 14l4-4"/></g>',
  delvis: '<circle cx="18" cy="18" r="8" fill="var(--vaer-sol)"/><path d="M14 38h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-1 13z" fill="var(--vaer-sky)"/>',
  sky: SKY(0),
  taake: SKY(4) + '<g stroke="var(--vaer-sky)" stroke-width="3" stroke-linecap="round"><path d="M8 38h32M12 44h24"/></g>',
  regn: SKY(6) + '<g stroke="var(--vaer-regn)" stroke-width="3" stroke-linecap="round"><path d="M16 35l-3 7M25 35l-3 7M34 35l-3 7"/></g>',
  sludd: SKY(6) + '<g stroke="var(--vaer-regn)" stroke-width="3" stroke-linecap="round"><path d="M16 35l-3 7M34 35l-3 7"/></g><circle cx="24" cy="40" r="2.6" fill="var(--vaer-sno)"/>',
  sno: SKY(6) + '<g fill="var(--vaer-sno)"><circle cx="15" cy="38" r="2.6"/><circle cx="24" cy="42" r="2.6"/><circle cx="33" cy="38" r="2.6"/></g>',
  storm: '<path d="M10 28h26a9 9 0 0 0 0-18 12 12 0 0 0-23 3 8 8 0 0 0-3 15z" fill="var(--vaer-sky-mork)"/><path d="M26 28l-7 10h6l-3 8 9-12h-6l3-6z" fill="var(--vaer-sol)"/><g stroke="var(--vaer-regn)" stroke-width="3" stroke-linecap="round"><path d="M14 33l-2 5M36 33l-2 5"/></g>',
  ukjent: '<circle cx="24" cy="24" r="14" fill="none" stroke="var(--vaer-sky)" stroke-width="3" stroke-dasharray="4 4"/>'
};
export function vaerIkon(bilde, px) {
  const b = IKON[bilde] ? bilde : "ukjent";
  return '<svg class="vaer-ikon" viewBox="0 0 48 48" width="' + px + '" height="' + px + '" role="img" aria-label="' +
    esc(t(BILDE_NAVN[b] || "Ukjent")) + '">' + IKON[b] + "</svg>";
}

// ═══════════════════════ VALGENE ═══════════════════════
// Kontoret: S.settings.vaerPaa / vaerGrenser (per bruker). Byggeplass-siden:
// det kontoret sendte ut (S.settVaerFraLett).
let fraLett = null;
S.settVaerFraLett = (v) => {
  fraLett = v && typeof v === "object" ? { paa: !!v.paa, grenser: vaskGrenser(v.grenser) } : null;
  meld();
};
export function vaerPaa() {
  if (LETT) return !!(fraLett && fraLett.paa);
  return !!(S.settings && S.settings.vaerPaa);
}
export function grenser() {
  if (LETT) return vaskGrenser(fraLett && fraLett.grenser);
  return vaskGrenser(S.settings && S.settings.vaerGrenser);
}
S.vaerForByggeplass = () => ({ paa: vaerPaa(), grenser: grenser() });

export function posisjon() {
  const pi = S.prosjektInfo ? S.prosjektInfo() : null;
  return pi ? koordinat(pi.lat, pi.lon) : null;
}

function meld() {
  try { document.dispatchEvent(new CustomEvent("storm-vaer")); } catch (_) {}
}

// ═══════════════════════ HENTINGEN ═══════════════════════
const base = () => LETT ? "" : TJENESTER.worker;
const nokkel = (k) => k.lat.toFixed(2) + "_" + k.lon.toFixed(2);
const varselBuffer = new Map();     // nøkkel → { tid, data: {oppdatert, timer}, lover }
const histBuffer = new Map();       // nøkkel|dato → { kilde, timer, stasjoner } | null (ingen data)
const VARSEL_MAKS_ALDER = 10 * 60e3;
let sisteFeil = "";
export const sisteHentFeil = () => sisteFeil;

export async function hentVarsel(k) {
  const n = nokkel(k);
  const b = varselBuffer.get(n);
  if (b && b.data && Date.now() - b.tid < VARSEL_MAKS_ALDER) return b.data;
  if (b && b.lover) return b.lover;
  const lover = (async () => {
    try {
      const r = await fetch(base() + "/vaer?lat=" + k.lat + "&lon=" + k.lon);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = tolkMet(await r.json());
      varselBuffer.set(n, { tid: Date.now(), data });
      sisteFeil = "";
      return data;
    } catch (e) {
      sisteFeil = String(e && e.message || e);
      varselBuffer.delete(n);
      if (b && b.data) return b.data;
      throw e;
    }
  })();
  varselBuffer.set(n, Object.assign({}, b || {}, { lover }));
  return lover;
}

// Historikk i biter på maks 31 dager (Workerens grense). Passerte dager
// huskes for godt i økta; i dag hentes på nytt hver gang (fylles på).
export async function hentHistorikk(k, fra, til) {
  const iDag = iDagISO();
  if (til > iDag) til = iDag;
  if (fra > til) return {};
  const n = nokkel(k), ut = {};
  const mangler = [];
  for (let d = fra; d <= til; d = leggTilDager(d, 1)) {
    const key = n + "|" + d;
    if (d < iDag && histBuffer.has(key)) { const v = histBuffer.get(key); if (v) ut[d] = v; }
    else mangler.push(d);
  }
  for (let i = 0; i < mangler.length; i += 31) {
    const bit = mangler.slice(i, i + 31);
    const a = bit[0], b = bit[bit.length - 1];
    try {
      const r = await fetch(base() + "/vaer/historikk?lat=" + k.lat + "&lon=" + k.lon + "&fra=" + a + "&til=" + b);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      for (const d of bit) {
        const v = j.dager && j.dager[d] ? Object.assign({ stasjoner: j.stasjoner || [] }, j.dager[d]) : null;
        histBuffer.set(n + "|" + d, v);
        if (v) ut[d] = v;
      }
      sisteFeil = "";
    } catch (e) { sisteFeil = String(e && e.message || e); }
  }
  return ut;
}

// Ett døgn: { kilde, d (24 timer), sum, stasjoner, oppdatert }.
// kilde: "varsel", "maalt", "varslet" eller "" (ingen data / for langt fram).
export async function dagData(k, dato) {
  const g = grenser();
  const iDag = iDagISO();
  let varsel = null;
  try { varsel = await hentVarsel(k); } catch (_) { varsel = null; }
  const siste = varsel ? sisteDato(varsel.timer) : "";
  const hvor = kildeFor(dato, iDag, siste);
  let d = new Array(24).fill(null), kilde = "", stasjoner = [], oppdatert = varsel ? varsel.oppdatert : "";
  if (hvor === "varsel") { d = dogn(varsel.timer, dato, g); kilde = "varsel"; }
  // Fortid — og timene som alt er passert i dag (varselet starter ved
  // inneværende time): målt eller lagret varsel fra Workeren.
  if (hvor === "historikk" || dato === iDag) {
    const h = (await hentHistorikk(k, dato, dato))[dato];
    if (h) {
      const dh = dogn(h.timer, dato, g);
      for (let i = 0; i < 24; i++) if (!d[i] && dh[i]) d[i] = Object.assign(dh[i], { kilde: h.kilde });
      if (!kilde) kilde = h.kilde;
      stasjoner = h.stasjoner || [];
    }
  }
  return { dato, kilde, d, sum: dagSum(d, g), stasjoner, oppdatert, sisteVarsel: siste };
}

// Mange døgn på én gang (Framdriftsplan). Fortiden begrenses til 180 dager
// bakover — eldre enn det leter ingen etter i en framdriftsplan.
const dagBuffer = new Map();        // nøkkel|dato → døgnsum (for tidslinja)
let laster = null;
export function dagerSync(fra, til) {
  const k = posisjon();
  if (!k) return null;
  const n = nokkel(k), ut = {};
  for (let d = fra; d <= til; d = leggTilDager(d, 1)) { const v = dagBuffer.get(n + "|" + d); if (v) ut[d] = v; }
  return ut;
}
export async function lastDager(fra, til) {
  const k = posisjon();
  if (!k) return;
  const iDag = iDagISO();
  const n = nokkel(k), g = grenser();
  let varsel = null;
  try { varsel = await hentVarsel(k); } catch (_) { varsel = null; }
  const siste = varsel ? sisteDato(varsel.timer) : "";
  const hFra = fra < leggTilDager(iDag, -180) ? leggTilDager(iDag, -180) : fra;
  const hist = hFra <= iDag && hFra <= til ? await hentHistorikk(k, hFra, til < iDag ? til : iDag) : {};
  for (let d = fra; d <= til; d = leggTilDager(d, 1)) {
    let dd = new Array(24).fill(null), kilde = "";
    if (varsel && d >= iDag && d <= siste) { dd = dogn(varsel.timer, d, g); kilde = "varsel"; }
    if (hist[d]) {
      const dh = dogn(hist[d].timer, d, g);
      for (let i = 0; i < 24; i++) if (!dd[i] && dh[i]) dd[i] = dh[i];
      if (!kilde) kilde = hist[d].kilde;
    }
    const s = dagSum(dd, g);
    if (s.harData) dagBuffer.set(n + "|" + d, Object.assign(s, { kilde }));
  }
}
// Kalles fra tidslinja: henter i bakgrunnen og sier fra når det er klart.
let sistBedt = "";
export function bestillDager(fra, til) {
  const k = posisjon();
  if (!k || !vaerPaa()) return;
  const bestilling = nokkel(k) + "|" + fra + "|" + til + "|" + JSON.stringify(grenser());
  if (bestilling === sistBedt || laster) return;
  sistBedt = bestilling;
  laster = lastDager(fra, til).catch(() => {}).finally(() => { laster = null; meld(); });
}
S.vaerForbered = async (fra, til) => { if (vaerPaa() && posisjon()) { sistBedt = ""; await lastDager(fra, til); } };
export function nullstillBuffer() { dagBuffer.clear(); sistBedt = ""; }

// ═══════════════════════ TEKSTENE ═══════════════════════
const tall1 = (v) => v == null ? "–" : String(Math.round(v * 10) / 10).replace(".", ",");
export const VARSEL_TEKST = {
  storm: (s) => t("Storm: middelvind opp mot {0} m/s", tall1(s.maksVind)),
  kran: (s) => t("Tårnkran: vindkast over grensen kl. {0}", periodeTekst(s.kranTimer)),
  regn: (s) => t("Støp: {0} mm regn i døgnet", tall1(s.regnSum)),
  frost: (s) => t("Frost kl. {0}", periodeTekst(s.frostTimer))
};
// Kort linje for tidslinja og videoen: «Regn · 7 °C · vind 13 (kast 23) m/s · 25 mm»
export function kortTekst(s) {
  if (!s || !s.harData) return "";
  return [t(BILDE_NAVN[s.bilde] || ""),
    (s.min != null ? (Math.round(s.min) === Math.round(s.maks) ? Math.round(s.maks) : Math.round(s.min) + "–" + Math.round(s.maks)) + " °C" : ""),
    s.maksVind != null ? t("vind {0}", Math.round(s.maksVind)) + (s.maksKast != null && !s.kastMangler ? " (" + t("kast {0}", Math.round(s.maksKast)) + ")" : "") + " m/s" : "",
    s.regnSum > 0 ? tall1(s.regnSum) + " mm" : ""
  ].filter(Boolean).join(" · ");
}
export { retningNavn, lokal };

// ═══════════════════════ FRAMDRIFTSPLAN-TIDSLINJA ═══════════════════════
// framdrift-vis.js kaller disse (via S, så framdrift-vis ikke må importere
// været når det er av). `dager` = [{ iso, venstre% }], `aktiv` = dagen glideren står på.
S.vaerTidslinje = (fraIso, tilIso, posFor, bredde) => {
  if (!vaerPaa()) return "";
  if (!posisjon()) return '<div class="fp-vaer-rad"><span class="fp-vaer-tom">' + esc(t("Vær: legg inn adressen i Innstillinger → Prosjektinfo")) + "</span></div>";
  bestillDager(fraIso, tilIso);
  const dager = dagerSync(fraIso, tilIso) || {};
  const ant = Object.keys(dager).length;
  let html = "";
  // Ikon per dag når det er plass (≥ 14 px per dag), ellers bare varslene.
  const visIkon = bredde >= 14;
  for (const [iso, s] of Object.entries(dager)) {
    // Rødt bak ikonet: storm eller vind over krangrensa. Oransje: mye regn
    // eller frost (varsel, ikke stopp).
    const niva = (s.varsler || []).some(x => x.niva === "fare") ? "fare" : (s.varsler || []).length ? "varsel" : "";
    const v = posFor(iso);
    if (niva) html += '<span class="fp-vaer-felt ' + niva + '" style="left:' + v.fra + "%;width:" + v.b + '%" title="' + esc(s.varsler.map(x => VARSEL_TEKST[x.type](s)).join(" · ")) + '"></span>';
    if (visIkon) html += '<span class="fp-vaer-dag" style="left:' + v.midt + '%" title="' + esc(iso.split("-").reverse().join(".") + ": " + kortTekst(s)) + '">' + vaerIkon(s.bilde, 16) + "</span>";
  }
  return '<div class="fp-vaer-rad">' + html + (!ant && !laster ? '<span class="fp-vaer-tom">' + esc(t("Ingen værdata for disse datoene ennå")) + "</span>" : "") + "</div>";
};
// Merkelappene i toppteksten for dagen glideren står på.
S.vaerTopp = (iso) => {
  if (!vaerPaa() || !posisjon()) return "";
  const s = (dagerSync(iso, iso) || {})[iso];
  if (!s) return "";
  let h = ' <span class="fp-vaer-merke">' + vaerIkon(s.bilde, 14) + " " + esc(kortTekst(s)) + "</span>";
  for (const v of s.varsler || []) h += ' <span class="fp-vaer-merke ' + v.niva + '">⚠ ' + esc(VARSEL_TEKST[v.type](s)) + "</span>";
  return h;
};
S.vaerVideoTekst = (iso) => {
  if (!vaerPaa() || !posisjon()) return "";
  const s = (dagerSync(iso, iso) || {})[iso];
  if (!s) return "";
  return kortTekst(s) + ((s.varsler || []).length ? "  ⚠ " + s.varsler.map(v => VARSEL_TEKST[v.type](s)).join(" · ") : "");
};

// Ny adresse (Prosjektinfo) → nye data. Varselbufferen er per posisjon og kan stå.
if (typeof document !== "undefined") document.addEventListener("storm-prosjektinfo", () => { nullstillBuffer(); });
