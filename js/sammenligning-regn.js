// 🔄 SAMMENLIGNING → STORM PROSJEKTER – de rene reglene (runde G, 12.11.2026)
//
// BYGGEPLAN-Storm-IFC-avvik-sammenligning-2026-11-12.md, punkt 4.
// Sammenligningen LAGRES i Storm Prosjekter, ikke her: Storm IFC lager bildene,
// PDF-en og sammenligning.json og legger dem i
//   <prosjektmappe>/14 BIM og koordinering/Sammenligninger/<id>/
// Vurderingene (OK, Følges opp, Lag EM) gjøres i Storm Prosjekter og ligger i
// vurderinger.json i samme mappe – den rører Storm IFC ALDRI.
//
// FAST AVTALE med Storm Prosjekter 4.38: feltene i sammenligning.json under.
// Ren: ingen DOM, ingen nett. Prøves i _test/test-sammenligning-send.mjs.
import { detaljerFor } from "./em-detalj.js";
import { elementMengde } from "./em-regn.js";

export const UNDERMAPPE = "14 BIM og koordinering/Sammenligninger";
export const JSON_FIL = "sammenligning.json";
export const OVERSIKT_BILDE = "oversikt.jpg";
export const VURDERINGER = "vurderinger.json";    // eies av Storm Prosjekter – skrives aldri herfra
export const MAKS_ENDRINGER = 500, MAKS_PUNKTER = 12, MAKS_PUNKT_TEGN = 200;
export const FILNAVN_RE = /^[^\\/:*?"<>|#%]{1,140}\.(jpg|jpeg|png|pdf)$/;

const to = (n) => String(n).padStart(2, "0");
// «2026-11-11-1015-ab3f» (lokal tid). tilfeldig: 4 tegn [a-z0-9]
export function sammenligningId(d, tilfeldig) {
  const x = d instanceof Date ? d : new Date(d || Date.now());
  const r = String(tilfeldig || Math.random().toString(36).slice(2, 6)).toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(4, "0").slice(0, 4);
  return x.getFullYear() + "-" + to(x.getMonth() + 1) + "-" + to(x.getDate()) + "-" + to(x.getHours()) + to(x.getMinutes()) + "-" + r;
}
const isoDag = (d) => { const x = d instanceof Date ? d : new Date(d || Date.now()); return x.getFullYear() + "-" + to(x.getMonth() + 1) + "-" + to(x.getDate()); };

// «RIB rev C.ifc» → «RIB rev C». Lett kopi: «X.lett (1).glb» → «X»
export const kortModellNavn = (s) => String(s || "").replace(/\.(ifc|glb)$/i, "").replace(/[\s._-]*(ekstra[\s._-]*)?lett(\s*\(\d+\))?$/i, "").trim();
const vaskDel = (s) => String(s || "").replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim();

// «Sammenligning RIB rev C – rev D 2026-11-11.pdf». Har de to navnene samme
// begynnelse («RIB rev C», «RIB rev D»), står den bare én gang.
export function pdfNavn(fra, til, d) {
  const a = vaskDel(kortModellNavn(fra)), b = vaskDel(kortModellNavn(til));
  const ord = (s) => s.split(" ");
  const A = ord(a), B = ord(b);
  let felles = 0;
  while (felles < A.length - 1 && felles < B.length - 2 && A[felles] === B[felles]) felles++;   // «rev D», ikke bare «D»
  const bKort = felles > 0 ? B.slice(felles).join(" ") : b;
  let navn = "Sammenligning " + (a || "forrige") + " – " + (bKort || "ny") + " " + isoDag(d);
  if (navn.length > 136) navn = navn.slice(0, 136).trim();
  return navn + ".pdf";
}
export function tittel(fra, til) {
  return (kortModellNavn(fra) || "forrige") + " → " + (kortModellNavn(til) || "ny");
}

// Bildenavnene per gruppe (én gruppe = én elementtype, som i EM-en)
export const gruppeBilde = (i, hva) => "e" + (i + 1) + (hva === "for" ? "-for" : "") + ".jpg";

const HVA = { ny: "ny", valgt: "ny", endret: "endret", fjernet: "fjernet" };
const kutt = (s, n) => String(s == null ? "" : s).slice(0, n);

// Punktene i klartekst for ett element
export function punkterFor(e, o) {
  const opt = o || {};
  const akse = e.akse ? " ved akse " + e.akse : "";
  if (e.hva === "endret") {
    const el = { c: e.c, d: e.d, v: e.v, navn: e.navn, r: e.r, L: e.L, fra: { c: e.fc, d: e.fd, v: e.fv, navn: e.nf || e.navn, r: e.fr, L: e.fL } };
    let p = [];
    try { p = detaljerFor(el, { toM: opt.toM, akser: opt.akser }).punkter.map(x => x.tekst); } catch (_) { p = []; }
    return (p.length ? p : ["Endret" + akse]).map(x => kutt(x, MAKS_PUNKT_TEGN)).slice(0, MAKS_PUNKTER);
  }
  if (e.hva === "fjernet") return ["Fjernet" + akse];
  return ["Ny" + akse];
}

// endringer: em-regn endringerFra (grupper med elementer). bilder: [{ for, etter }]
// (true/false = finnes). k: { fra, til, metode, usikker, telling, manuell }
export function byggJson(o) {
  const k = o || {};
  const ut = [];
  (k.endringer || []).forEach((g, gi) => {
    const b = (k.bilder && k.bilder[gi]) || {};
    for (const e of g.elementer || []) {
      if (ut.length >= MAKS_ENDRINGER) break;
      const hva = HVA[e.hva] || "endret";
      const bilde = hva === "fjernet" ? (b.for ? gruppeBilde(gi, "for") : (b.etter ? gruppeBilde(gi, "etter") : ""))
        : (b.etter ? gruppeBilde(gi, "etter") : (b.for ? gruppeBilde(gi, "for") : ""));
      let mengde = "";
      try { mengde = elementMengde(Object.assign({}, e, { hva: e.hva === "valgt" ? "ny" : e.hva }), g.enhet) || ""; } catch (_) { mengde = ""; }
      ut.push({ id: "e" + (ut.length + 1), hva, type: kutt(g.navn, 80), navn: kutt(e.navn, 160), gid: /^[0-9A-Za-z_$]{22}$/.test(e.guid || "") ? e.guid : "",
        punkter: punkterFor(e, { toM: k.toM, akser: k.akser }), mengde: mengde === "endret" ? "" : kutt(mengde, 40), bilde });
    }
  });
  const tell = k.telling || {};
  return {
    versjon: 1, id: String(k.id || ""),
    tittel: kutt(k.tittel || tittel(k.fra, k.til), 200), fra: kutt(k.fra, 200), til: kutt(k.til, 200),
    modell: kutt(k.modell || k.til, 200),
    laget: k.laget || new Date().toISOString(), av: kutt(k.av, 120),
    metode: k.manuell ? "manuell" : "automatisk", usikker: !!k.usikker,
    oversiktBilde: k.oversiktBilde === false ? "" : OVERSIKT_BILDE, pdf: String(k.pdf || ""),
    telling: { ny: Number(tell.ny) || 0, endret: Number(tell.endret) || 0, fjernet: Number(tell.fjernet) || 0 },
    endringer: ut
  };
}

// Kontroll før sending: det Storm Prosjekter leser, med grensene i avtalen.
export function sjekkJson(j) {
  const feil = [];
  if (!j || j.versjon !== 1) feil.push("versjon");
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]{4}$/.test(String(j && j.id))) feil.push("id");
  if (!Array.isArray(j && j.endringer) || j.endringer.length > MAKS_ENDRINGER) feil.push("endringer");
  for (const e of (j && j.endringer) || []) {
    if (!["ny", "endret", "fjernet"].includes(e.hva)) feil.push("hva " + e.id);
    if (!Array.isArray(e.punkter) || e.punkter.length > MAKS_PUNKTER || e.punkter.some(p => String(p).length > MAKS_PUNKT_TEGN)) feil.push("punkter " + e.id);
    if (e.bilde && !FILNAVN_RE.test(e.bilde)) feil.push("bilde " + e.id);
  }
  if (j && j.pdf && !FILNAVN_RE.test(j.pdf)) feil.push("pdf");
  if (j && j.oversiktBilde && !FILNAVN_RE.test(j.oversiktBilde)) feil.push("oversiktBilde");
  return feil;
}
