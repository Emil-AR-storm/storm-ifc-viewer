// 🔒 ENDRINGSMELDINGENE I SHAREPOINT (Emil 26.10.2026, lagring valg A)
//
// «det er kun de som jobber internt som trenger/skal se den, hvis ikke kan
// noen snike seg inn på byggeplass versjonen og hente den ut»
//
// HVORFOR IKKE SOM MARKERING LENGER. Byggeplass-knappen (byggeplass.js) sender
// alle markeringer — tekst, plassering og før/etter-bilder — ut til Workeren,
// der montørene leser dem. En EM med priser og bilder hører ikke hjemme der.
// Nå ligger EM-ene i SharePoint-mappa «Endringsmeldinger» (under IFC-modeller),
// én JSON-fil per prosjekt, og bildene som egne filer ved siden av. Den mappa
// leses bare av kontorsiden med Storm-innlogging; Workeren og bygg.html vet
// ikke at den finnes.
//
// Samme lager som SW-resultater og grupper (sp-lager.js): fletting på id,
// gravstein ved sletting, eTag ved samtidig lagring.
import { S } from "./state.js";
import { spLes, spLesBin, spSkriv, spSkrivBin } from "./sp-lager.js";
import { emFil, vaskEm } from "./em-regn.js";

export const EM_MAPPE = "Endringsmeldinger";
const vedId = (p) => String(p && p.id || "");

export function emFilNavn() {
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  return emFil(info && info.nummer, S.fileName);
}

// { status: "av" | "tom" | "ok" | "feil", liste }
export async function lesEm() {
  const r = await spLes(EM_MAPPE, emFilNavn());
  return { status: r.status, liste: (r.liste || []).map(vaskEm).filter(Boolean) };
}

export async function lagreEm(em) {
  const post = Object.assign({}, em, { endret: new Date().toISOString() });
  const r = await spSkriv(EM_MAPPE, emFilNavn(), [post], vedId);
  return { ok: r.ok, grunn: r.grunn, liste: (r.liste || []).map(vaskEm).filter(Boolean), post };
}

// Gravstein: posten blir stående med slettet: true, så den ikke kommer
// tilbake fra en annen maskin ved neste fletting.
export async function slettEm(em) {
  return lagreEm(Object.assign({}, em, { slettet: true }));
}

function dataUrlTilBytes(u) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(u || ""));
  if (!m) return null;
  const bin = atob(m[2]), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export async function lastOppBilde(navn, dataUrl) {
  const bytes = dataUrlTilBytes(dataUrl);
  if (!bytes) return { ok: false };
  return spSkrivBin(EM_MAPPE, navn, bytes, "image/jpeg");
}

// Bildene som nettopp er tatt holdes i minnet, så PDF-en kan lages med en
// gang uten å hente dem tilbake fra SharePoint.
const buffer = new Map();
export function huskBilde(navn, dataUrl) { if (navn && dataUrl) buffer.set(navn, dataUrl); }

export async function hentBilde(navn) {
  if (!navn) return null;
  if (buffer.has(navn)) return buffer.get(navn);
  const r = await spLesBin(EM_MAPPE, navn);
  if (r.status !== "ok" || !r.data) return null;
  const a = new Uint8Array(r.data);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  const data = "data:image/jpeg;base64," + btoa(s);
  buffer.set(navn, data);
  return data;
}
