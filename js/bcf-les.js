// 🔁 BCF-IMPORT, den rene delen (verktøy 7, runde 2 — bygget 21.10.2026).
//
// Leser en .bcfzip fra RIB/ARK (Solibri, BIMcollab, Revit, Dalux) og lager en
// PLAN: hvilke saker blir nye markeringer, hvilke finnes fra før og
// oppdateres (og nøyaktig hva som endres), og hvilke peker på et element som
// ikke finnes i denne modellen. Dialogen (js/bcf-import.js) viser planen i
// tre grupper (Emils valg B) og legger på det som er krysset av.
//
// INGEN avhengigheter: ikke S, ikke three.js, ikke DOM utover DOMParser.
// _test/test-bcf-les.mjs kjører alt her direkte.
//
// TRE TING SOM STYRER DENNE FILA:
//
// 1. SAMME SAK SKAL FINNES IGJEN. En sak gjenkjennes på Topic Guid:
//    • en markering som er importert fra BCF, har feltet bcfGuid;
//    • en markering som er EKSPORTERT herfra, fikk guidFraId("m:" + id) som
//      Topic Guid (se byggSak i bcf.js) — samme tall hver gang, uten at noe
//      må lagres. Sender RIB fila tilbake, kjennes den igjen.
//    Kommentarer likedan: «bcf-<guid>» som svar-id, eller guidFraId("s:" + id).
//
// 2. ZIP LESES MED NETTLESERENS EGEN INFLATE. Solibri og BIMcollab komprimerer
//    (metode 8). DecompressionStream("deflate-raw") finnes i alle nettlesere vi
//    støtter — ingen ny bibliotekfil i vendor/.
//
// 3. BCF 2.1 OG 3.0. 2.1 har Comment og Viewpoints rett under <Markup>; 3.0
//    har <Comments> og <Viewpoints><ViewPoint> inne i <Topic>. Begge leses.

// ═══════════════════════ GUID ═══════════════════════

// Fast UUID ut fra en tekst (FNV-1a i fire omganger). Ikke kryptografi — bare
// «samme inn gir samme ut», i gyldig UUID-form (versjon 4-bitene satt), så
// strenge BCF-lesere godtar den.
export function guidFraId(tekst) {
  const s = String(tekst == null ? "" : tekst);
  let hex = "";
  for (let runde = 0; runde < 4; runde++) {
    let h = (0x811c9dc5 ^ (runde * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= runde; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    hex += h.toString(16).padStart(8, "0");
  }
  const b = hex.split("");
  b[12] = "4";
  b[16] = "89ab"[parseInt(b[16], 16) & 3];
  const h = b.join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

export const erGuid = (g) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(g || ""));
const lik = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// ═══════════════════════ ZIP ═══════════════════════

export const MAKS_BCF_MB = 200;           // hele fila
const MAKS_DEL = 60 * 1024 * 1024;        // én fil inne i ZIP-en, utpakket

async function inflater(raa) {
  const s = new Blob([raa]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// bytes → Map(navn → Uint8Array). Leser sentralkatalogen (ikke de lokale
// hodene), for der står størrelsene også når fila er skrevet med
// «data descriptor» — det gjør Solibri.
export async function lesZip(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error("IKKE_ZIP");
  const antall = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  if (p === 0xFFFFFFFF || antall === 0xFFFF) throw new Error("ZIP64");
  const dec = new TextDecoder();
  const ut = new Map();
  for (let n = 0; n < antall; n++) {
    if (p + 46 > u.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("ODELAGT_ZIP");
    const metode = dv.getUint16(p + 10, true);
    const komp = dv.getUint32(p + 20, true), str = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const navn = dec.decode(u.subarray(p + 46, p + 46 + nl)).replace(/\\/g, "/");
    p += 46 + nl + xl + cl;
    if (!navn || navn.endsWith("/")) continue;
    if (str > MAKS_DEL || komp > MAKS_DEL) throw new Error("FOR_STOR");
    if (lokal + 30 > u.length || dv.getUint32(lokal, true) !== 0x04034b50) throw new Error("ODELAGT_ZIP");
    const start = lokal + 30 + dv.getUint16(lokal + 26, true) + dv.getUint16(lokal + 28, true);
    const raa = u.subarray(start, start + komp);
    if (metode === 0) ut.set(navn, raa.slice());
    else if (metode === 8) ut.set(navn, await inflater(raa));
    // andre metoder (bzip2, lzma …) brukes ikke av BCF-verktøyene — hoppes over
  }
  return ut;
}

// ═══════════════════════ XML ═══════════════════════

function rot(xml) {
  const d = new DOMParser().parseFromString(String(xml || ""), "application/xml");
  if (!d || !d.documentElement || d.getElementsByTagName("parsererror").length) throw new Error("UGYLDIG_XML");
  return d.documentElement;
}
const barn = (el, navn) => (el ? [...el.children].filter(c => c.localName === navn) : []);
const ett = (el, navn) => barn(el, navn)[0] || null;
const tekst = (el, navn) => { const x = ett(el, navn); return x ? x.textContent.trim() : ""; };
const nedover = (el, navn) => (el ? [...el.getElementsByTagName("*")].filter(c => c.localName === navn) : []);
const attr = (el, navn) => (el && el.getAttribute(navn)) || "";
const tilTekst = (bytes) => new TextDecoder().decode(bytes);   // fjerner BOM selv

function punkt(el) {
  if (!el) return null;
  const v = { x: Number(tekst(el, "X")), y: Number(tekst(el, "Y")), z: Number(tekst(el, "Z")) };
  return [v.x, v.y, v.z].every(isFinite) ? v : null;
}

// markup.bcf → én sak (uten viewpoint-innholdet)
export function tolkMarkup(xml) {
  const r = rot(xml);
  const topic = ett(r, "Topic");
  if (!topic) throw new Error("MANGLER_TOPIC");
  // 2.1: <Comment> rett under <Markup>. 3.0: <Topic><Comments><Comment>.
  const komm = barn(r, "Comment").concat(barn(ett(topic, "Comments"), "Comment"));
  const kommentarer = komm.map(k => ({
    guid: attr(k, "Guid"),
    dato: tekst(k, "Date"),
    forfatter: tekst(k, "Author"),
    tekst: tekst(k, "Comment")
  })).filter(k => k.tekst);
  // 2.1: flere <Viewpoints Guid> under <Markup>. 3.0: <Topic><Viewpoints><ViewPoint Guid>.
  const vp21 = barn(r, "Viewpoints");
  const vp30 = barn(ett(topic, "Viewpoints"), "ViewPoint");
  const viewpoints = vp21.concat(vp30).map(v => ({
    guid: attr(v, "Guid"), fil: tekst(v, "Viewpoint"), snapshot: tekst(v, "Snapshot")
  }));
  return {
    guid: attr(topic, "Guid"),
    tittel: tekst(topic, "Title"),
    beskrivelse: tekst(topic, "Description"),
    status: attr(topic, "TopicStatus") || tekst(topic, "TopicStatus"),
    prioritet: tekst(topic, "Priority"),
    opprettet: tekst(topic, "CreationDate"),
    forfatter: tekst(topic, "CreationAuthor"),
    frist: tekst(topic, "DueDate"),
    ansvarlig: tekst(topic, "AssignedTo"),
    kommentarer, viewpoints
  };
}

// viewpoint.bcfv → { ifcGuider (bare de VALGTE), kamera }. Komponentene under
// <Visibility><Exceptions> er de skjulte — de skal ikke bli elementreferansen.
export function tolkViewpoint(xml) {
  const r = rot(xml);
  const valg = nedover(r, "Selection")[0];
  const ifcGuider = nedover(valg, "Component").map(c => attr(c, "IfcGuid")).filter(Boolean);
  const kam = ett(r, "PerspectiveCamera") || ett(r, "OrthogonalCamera");
  const kamera = kam ? { punkt: punkt(ett(kam, "CameraViewPoint")), retning: punkt(ett(kam, "CameraDirection")) } : null;
  return { ifcGuider, kamera: kamera && kamera.punkt && kamera.retning ? kamera : null };
}

// Hele fila → { versjon, saker:[…], feil:[…] }. En ødelagt sak velter ikke
// resten — den havner i feil[] og nevnes i dialogen.
export function lesBcf(filer) {
  const kart = filer instanceof Map ? filer : new Map(Object.entries(filer || {}));
  const finn = (navn) => { for (const [k, v] of kart) if (lik(k, navn)) return v; return null; };
  let versjon = "";
  const vf = finn("bcf.version");
  if (vf) { try { const r = rot(tilTekst(vf)); versjon = attr(r, "VersionId") || tekst(r, "DetailedVersion"); } catch (_) {} }
  const saker = [], feil = [];
  for (const [navn, data] of kart) {
    const m = /^(.*\/)?markup\.bcf$/i.exec(navn);
    if (!m) continue;
    const mappe = m[1] || "";
    try {
      const s = tolkMarkup(tilTekst(data));
      const vp = s.viewpoints[0] || {};
      const vpData = finn(mappe + (vp.fil || "viewpoint.bcfv"));
      let v = { ifcGuider: [], kamera: null };
      if (vpData) { try { v = tolkViewpoint(tilTekst(vpData)); } catch (_) {} }
      let snapNavn = vp.snapshot || "";
      let snap = snapNavn ? finn(mappe + snapNavn) : null;
      if (!snap) for (const n of ["snapshot.png", "snapshot.jpg", "snapshot.jpeg"]) {
        snap = finn(mappe + n); if (snap) { snapNavn = n; break; }
      }
      saker.push(Object.assign(s, { ifcGuid: v.ifcGuider[0] || "", ifcGuider: v.ifcGuider,
        kamera: v.kamera, snapshot: snap || null, snapshotNavn: snap ? snapNavn : "" }));
    } catch (err) { feil.push({ mappe: mappe || navn, melding: err.message }); }
  }
  saker.sort((a, b) => String(a.opprettet).localeCompare(String(b.opprettet)) || String(a.tittel).localeCompare(String(b.tittel)));
  return { versjon, saker, feil };
}

// ═══════════════════════ OVERSETTING ═══════════════════════

// BCF-status → Storms tre. TopicStatus er fritekst i BCF, og hvert verktøy har
// sine egne ord, så vi kjenner igjen familiene og lar resten bli «Åpen».
export function fraBcfStatus(s) {
  const k = String(s || "").toLowerCase().replace(/[\s_-]/g, "");
  if (["closed", "resolved", "done", "fixed", "complete", "completed", "lukket", "løst", "lost"].includes(k)) return "Løst";
  if (["inprogress", "assigned", "inreview", "review", "pågår", "pagar", "active"].includes(k)) return "Pågår";
  return "Åpen";
}

// xs:dateTime → «21.10.2026, 08:40» (samme form som naaTekst i markers.js).
// Med tidssone: regnes om til norsk tid. Uten: tallene tas som de står.
export function fraIsoTid(iso) {
  const s = String(iso || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return "";
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (isFinite(d.getTime())) return d.toLocaleString("no-NO", { day: "2-digit", month: "2-digit",
      year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
  }
  return m[3] + "." + m[2] + "." + m[1] + (m[4] ? ", " + m[4] + ":" + m[5] : "");
}

export const fraIsoDato = (iso) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || "")); return m ? m[1] : ""; };

// Tittel + beskrivelse → markeringsteksten. Vår egen eksport skriver første
// linje som Title og hele teksten som Description — da er beskrivelsen hele
// teksten, og tittelen skal ikke stå to ganger.
export function sakTekst(sak) {
  const t = String(sak.tittel || "").trim(), b = String(sak.beskrivelse || "").trim();
  if (!b) return t;
  if (!t || b === t || b.startsWith(t)) return b;
  return t + "\n" + b;
}

// ═══════════════════════ KOORDINATER ═══════════════════════
// Motsatt vei av ifcPunkt/tilIfc i bcf.js: IFC-meter (Z opp) → visningen.
// inv = S.koteMatrixInv.elements (kolonnevis, three.js-rekkefølge); vi
// trenger den OPPRINNELIGE matrisen, og regner den ut her (affin invers).
export function fraIfc(P, skala, inv) {
  const s = Number(skala) || 1;
  const q = { x: P.x / s, y: P.z / s, z: -P.y / s };       // tilIfc baklengs
  if (!inv || inv.length !== 16) return q;
  const e = inv;
  const a = e[0], b = e[4], c = e[8], d = e[1], f = e[5], g = e[9], h = e[2], i = e[6], j = e[10];
  const det = a * (f * j - g * i) - b * (d * j - g * h) + c * (d * i - f * h);
  if (!det) return q;
  const x = q.x - e[12], y = q.y - e[13], z = q.z - e[14];
  return {
    x: ((f * j - g * i) * x - (b * j - c * i) * y + (b * g - c * f) * z) / det,
    y: (-(d * j - g * h) * x + (a * j - c * h) * y - (a * g - c * d) * z) / det,
    z: ((d * i - f * h) * x - (a * i - b * h) * y + (a * f - b * d) * z) / det
  };
}

// ═══════════════════════ PLANEN ═══════════════════════

// Finnes saken fra før? bcfGuid (importert) eller fast GUID fra vår eksport.
export function finnMarkering(sak, markeringer) {
  return (markeringer || []).find(c => c && (lik(c.bcfGuid, sak.guid) || lik(guidFraId("m:" + c.id), sak.guid))) || null;
}
const svarKjent = (c, guid) => (Array.isArray(c.svar) ? c.svar : []).some(s =>
  lik(s.id, "bcf-" + guid) || lik(guidFraId("s:" + s.id), guid));

export function svarFraKommentar(k) {
  return { id: "bcf-" + k.guid, tekst: String(k.tekst).slice(0, 4000), forfatter: String(k.forfatter || ""),
           dato: fraIsoTid(k.dato), endret: "", kilde: "bcf" };
}

// k = { markeringer, finnElement(ifcGuid) → { id, senter } | null,
//       tilVisning(ifcPunkt) → {x,y,z}, standardPunkt {x,y,z}, avstand, nyId() }
// Ut: [{ sak, art: "ny"|"oppdater"|"uendret"|"finner-ikke", valgt, markering?, mål?, patch?, nyeSvar?, endringer? }]
export function lagPlan(saker, k) {
  const o = k || {};
  const plan = [];
  for (const sak of saker || []) {
    if (!sak || !erGuid(sak.guid)) continue;
    const c = finnMarkering(sak, o.markeringer);
    const status = fraBcfStatus(sak.status);
    const tekstNy = sakTekst(sak);
    const nyeSvar = sak.kommentarer.filter(km => km.guid && !(c && svarKjent(c, km.guid))).map(svarFraKommentar);
    if (c) {
      const patch = {}, endringer = [];
      if (tekstNy && tekstNy !== String(c.text || "")) { patch.text = tekstNy; endringer.push({ felt: "tekst" }); }
      if ((c.status || "Åpen") !== status) { patch.status = status; endringer.push({ felt: "status", fra: c.status || "Åpen", til: status }); }
      const frist = fraIsoDato(sak.frist);
      if (frist && frist !== (c.due || "")) { patch.due = frist; endringer.push({ felt: "frist", fra: c.due || "", til: frist }); }
      if (sak.ansvarlig && sak.ansvarlig !== (c.owner || "")) { patch.owner = sak.ansvarlig; endringer.push({ felt: "ansvarlig", fra: c.owner || "", til: sak.ansvarlig }); }
      if (nyeSvar.length) endringer.push({ felt: "kommentarer", antall: nyeSvar.length });
      if (!c.bcfGuid) patch.bcfGuid = sak.guid;     // husk koblingen, også for eksporterte
      const art = endringer.length ? "oppdater" : "uendret";
      plan.push({ sak, art, valgt: art === "oppdater", mål: c, patch, nyeSvar, endringer });
      continue;
    }
    const el = sak.ifcGuid && o.finnElement ? o.finnElement(sak.ifcGuid) : null;
    let pos = el && el.senter;
    if (!pos && sak.kamera && o.tilVisning) {
      const d = Number(o.avstand) || 5, kp = sak.kamera.punkt, r = sak.kamera.retning;
      const len = Math.hypot(r.x, r.y, r.z) || 1;
      pos = o.tilVisning({ x: kp.x + r.x / len * d, y: kp.y + r.y / len * d, z: kp.z + r.z / len * d });
    }
    pos = pos || o.standardPunkt || { x: 0, y: 0, z: 0 };
    const markering = {
      id: o.nyId ? o.nyId() : Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      text: tekstNy || "BCF", author: sak.forfatter || "BCF", date: fraIsoTid(sak.opprettet),
      status, owner: sak.ansvarlig || "", due: fraIsoDato(sak.frist),
      x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0,
      bcfGuid: sak.guid, svar: nyeSvar
    };
    if (el) { markering.elementId = String(el.id); markering.globalId = sak.ifcGuid; }
    const art = el ? "ny" : "finner-ikke";
    plan.push({ sak, art, valgt: art === "ny", markering, plassering: el ? "element" : (sak.kamera ? "kamera" : "midt") });
  }
  return plan;
}

// Hvor mange i hver gruppe, og hvor mange som er valgt — til overskriftene.
export function telPlan(plan) {
  const t = { ny: 0, oppdater: 0, uendret: 0, "finner-ikke": 0, valgt: 0 };
  for (const p of plan || []) { t[p.art] = (t[p.art] || 0) + 1; if (p.valgt) t.valgt++; }
  return t;
}
