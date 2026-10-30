// 📋 SJEKKLISTE FØR STØP — REGNINGEN (runde 9, Emils valg 5C 30.10.2026). Ren, uten DOM.
//
// Hver etappe i Støpeplan får en sjekkliste «Før støp». Basen huker av på
// telefonen (byggeplass-siden, runde 9b) eller på kontoret, og signerer.
// «Klar til støp» kan først settes når ALT er huket av OG signert.
//
// Punktene er FORSLAG, ikke hentet fra en standard. Storm bestemmer selv
// innholdet: legg en mal med id «for-stop» i SharePoint-mappa Sjekklister
// (samme format som de andre malene, se Sjekklister/for-stop.json), så brukes
// den. Punktene kopieres inn i etappen første gang lista tas i bruk, så
// kontoret og byggeplassen alltid ser den samme lista for den etappen.

export const MAL_ID = "for-stop";
export const STD_PUNKTER = [
  { id: "forskaling", tekst: "Forskaling kontrollert (mål, lodd, avstivning)" },
  { id: "armering", tekst: "Armering kontrollert mot tegning" },
  { id: "overdekning", tekst: "Overdekning / avstandsholdere" },
  { id: "utsparinger", tekst: "Utsparinger og innstøpningsgods på plass" },
  { id: "gjennomforinger", tekst: "Jording / gjennomføringer (EL/RØR) godkjent" },
  { id: "stopeskjoter", tekst: "Støpeskjøter rengjort" },
  { id: "bestilt", tekst: "Betong bestilt (kvalitet, mengde, tid)" },
  { id: "mannskap", tekst: "Pumpe/kran og mannskap bekreftet" },
  { id: "vaer", tekst: "Værvarsel / vintertiltak" },
  { id: "herding", tekst: "Herdetiltak klare" },
  { id: "bilder", tekst: "Bilder tatt" },
  { id: "rengjort", tekst: "Forskalingen ren for snø, is og rusk" }
];
export const MAKS_PUNKTER = 60;
export const MAKS_SIGNATUR = 60000;   // samme tak som sjekklistene på markeringer
const tekst = (s, n) => String(s == null ? "" : s).slice(0, n || 200);
const punktId = (s) => tekst(s, 40).replace(/[^0-9a-zA-Z_-]/g, "") || "";

// Punktene fra en mal i Sjekklister-formatet (seksjoner → felt: id + navn)
export function punkterFraMal(mal) {
  const ut = [], sett = new Set();
  for (const s of (mal && Array.isArray(mal.seksjoner) ? mal.seksjoner : [])) {
    for (const f of (s && Array.isArray(s.felt) ? s.felt : [])) {
      const id = punktId(f && f.id), navn = tekst(f && f.navn, 160).trim();   // uten navn = ikke et punkt
      if (id && navn && !sett.has(id)) { sett.add(id); ut.push({ id, tekst: navn }); }
    }
  }
  return ut.slice(0, MAKS_PUNKTER);
}

function vaskSvar(v) {
  if (!v || typeof v !== "object") return null;
  return { ok: v.ok === true, av: tekst(v.av, 60), tid: tekst(v.tid, 40), kilde: v.kilde === "bygg" ? "bygg" : "kontor",
    bilde: tekst(v.bilde, 160), kommentar: tekst(v.kommentar, 300) };
}
function vaskSignert(s) {
  if (!s || typeof s !== "object" || !String(s.av || "").trim()) return null;
  const sig = typeof s.signatur === "string" && /^data:image\/(png|jpeg);base64,/.test(s.signatur) && s.signatur.length <= MAKS_SIGNATUR ? s.signatur : "";
  return { av: tekst(s.av, 60).trim(), tid: tekst(s.tid, 40), signatur: sig, kilde: s.kilde === "bygg" ? "bygg" : "kontor" };
}
// sjekk = { punkter: [{ id, tekst }], svar: { id: { ok, av, tid, kilde, bilde, kommentar } }, signert }
export function vaskSjekk(s) {
  if (!s || typeof s !== "object") return null;
  const sett = new Set();
  const punkter = (Array.isArray(s.punkter) ? s.punkter : []).map(p => ({ id: punktId(p && p.id), tekst: tekst(p && p.tekst, 160).trim() }))
    .filter(p => p.id && p.tekst && !sett.has(p.id) && sett.add(p.id)).slice(0, MAKS_PUNKTER);
  if (!punkter.length) return null;
  const svar = {};
  for (const p of punkter) { const v = vaskSvar(s.svar && s.svar[p.id]); if (v) svar[p.id] = v; }
  return { punkter, svar, signert: vaskSignert(s.signert) };
}
export const nySjekk = (punkter) => vaskSjekk({ punkter: punkter && punkter.length ? punkter : STD_PUNKTER, svar: {}, signert: null });

// { ok, totalt, ferdig, signert, kanKlar }
export function sjekkStatus(s) {
  const v = vaskSjekk(s);
  if (!v) return { ok: 0, totalt: 0, ferdig: false, signert: false, kanKlar: false };
  const ok = v.punkter.filter(p => v.svar[p.id] && v.svar[p.id].ok).length;
  const ferdig = ok === v.punkter.length;
  return { ok, totalt: v.punkter.length, ferdig, signert: !!v.signert, kanKlar: ferdig && !!v.signert };
}

// Huk av / ta bort ett punkt. Endres noe etter at lista er signert, er
// signaturen ikke lenger gyldig — den fjernes (må signeres på nytt).
export function settPunkt(s, id, ok, av, tid, kilde, ekstra) {
  const v = vaskSjekk(s);
  if (!v || !v.punkter.some(p => p.id === id)) return v;
  const gml = v.svar[id] || {};
  const ny = Object.assign({}, v, { svar: Object.assign({}, v.svar, { [id]: vaskSvar(Object.assign({}, gml, ekstra || {}, { ok: ok === true, av, tid, kilde })) }) });
  if (!!gml.ok !== (ok === true)) ny.signert = null;
  return ny;
}
export function signer(s, av, tid, signatur, kilde) {
  const v = vaskSjekk(s);
  if (!v || !sjekkStatus(v).ferdig) return v;
  return Object.assign({}, v, { signert: vaskSignert({ av, tid, signatur, kilde }) });
}

// 9b: en hendelse fra byggeplassen. Siste tid vinner per punkt — et punkt
// kontoret har rettet ETTER at basen huket av, skal ikke overskrives av en
// eldre hendelse som kommer sent (dårlig dekning).
// h = { punkt, ok, av, tid, bilde? } eller { signert: { av, tid, signatur } }
// h kan også bære { punkter } når lista ble startet på telefonen (kontoret
// hadde ikke startet den) — da opprettes den med de punktene.
export function flettHendelse(s, h) {
  let v = vaskSjekk(s);
  if (!v && h && Array.isArray(h.punkter)) v = vaskSjekk({ punkter: h.punkter, svar: {}, signert: null });
  if (!v || !h) return v;
  if (!h.signert && !h.punkt) return v;
  if (h.signert) {
    if (!sjekkStatus(v).ferdig) return v;
    if (v.signert && String(v.signert.tid) >= String(h.signert.tid || "")) return v;
    return signer(v, h.signert.av, h.signert.tid, h.signert.signatur, "bygg");
  }
  const gml = v.svar[h.punkt];
  if (gml && String(gml.tid) > String(h.tid || "")) return v;
  return settPunkt(v, h.punkt, h.ok === true, h.av, h.tid, "bygg", h.bilde ? { bilde: h.bilde } : null);
}

// 9b: bildene fra telefonen. Navnet bærer etappe og punkt (for feilsøking),
// men koblingen gjøres av hendelsen (feltet bilde) — bildet og hendelsen
// reiser i hver sin kø og kan komme fram i hvilken som helst rekkefølge.
const ren = (x) => String(x == null ? "" : x).replace(/[^0-9a-zA-Z]/g, "").slice(0, 20);
export function sjekkBildeNavn(etappeId, punktId, naa, slump) {
  return "sjk_" + ren(etappeId) + "_" + ren(punktId) + "-" + Number(naa || Date.now()).toString(36) + "-" +
    (slump || Math.random().toString(36).slice(2, 6)).replace(/[^0-9a-z]/g, "").slice(0, 6) + ".jpg";
}
export const erSjekkBilde = (navn) => /^sjk_[0-9a-zA-Z_-]+\.jpg$/.test(String(navn || ""));

// Hendelsen telefonen sender. etappeNr/etappeNavn/status brukes bare i
// Teams-teksten i Workeren; kontoret regner alt selv.
export function lagHendelse(e, felt, sjekkEtter) {
  const st = sjekkStatus(sjekkEtter);
  return Object.assign({ type: "sjekkliste", etappe: e.id, etappeNr: e.nr, etappeNavn: tekst(e.navn, 60),
    status: { ok: st.ok, totalt: st.totalt } }, felt);
}

// Telefonen: lokale hendelser legges over det kontoret sist publiserte, så
// avhukingen ikke forsvinner ved omlasting før kontoret har hentet den.
// Siste tid vinner (flettHendelse), så en nyere rettelse fra kontoret står.
export function leggPaaLokale(etapper, lokale) {
  const liste = Array.isArray(etapper) ? etapper : [];
  const hs = (Array.isArray(lokale) ? lokale : []).slice().sort((a, b) => String(a.tid || (a.signert && a.signert.tid) || "").localeCompare(String(b.tid || (b.signert && b.signert.tid) || "")));
  return liste.map(e => {
    let s = e.sjekk || null;
    for (const h of hs) if (h && h.etappe === e.id) s = flettHendelse(s, h);
    return s === e.sjekk ? e : Object.assign({}, e, { sjekk: s });
  });
}

// PDF via den felles skjema-motoren (skjema-pdf.js): en mal + et skjema
export function somSkjema(s, tittel, ov) {
  const T = ov || ((x) => x);
  const v = vaskSjekk(s) || nySjekk();
  const mal = { id: MAL_ID, navn: tittel || T("Sjekkliste før støp"), versjon: 1, avsender: {},
    seksjoner: [{ tittel: T("Før støp"), felt: v.punkter.map((p, i) => ({ id: p.id, nr: String(i + 1), navn: p.tekst, type: "tekst", pakrevd: true })) }] };
  const svar = {};
  for (const p of v.punkter) {
    const a = v.svar[p.id];
    svar[p.id] = a && a.ok ? T("OK") + " — " + [a.av, a.tid ? kortTid(a.tid) : "", a.kilde === "bygg" ? T("byggeplassen") : "", a.bilde ? T("bilde") : ""].filter(Boolean).join(" · ") : "";
  }
  return { mal, skjema: { versjon: 1, svar, laast: !!v.signert, signertAv: v.signert ? v.signert.av : "", signertTid: v.signert ? kortTid(v.signert.tid) : "", signatur: v.signert ? v.signert.signatur : "" } };
}
// «2026-11-14T09:42:10.000Z» → «14.11.2026 09:42» (lokal tid)
export function kortTid(iso) {
  const d = new Date(iso);
  if (!isFinite(d)) return String(iso || "");
  const to = (n) => String(n).padStart(2, "0");
  return to(d.getDate()) + "." + to(d.getMonth() + 1) + "." + d.getFullYear() + " " + to(d.getHours()) + ":" + to(d.getMinutes());
}
