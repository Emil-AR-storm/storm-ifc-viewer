// 📁 «LEGG I PROSJEKT» – Graph-delen (nett, men ingen skjerm). Reglene står i
// legg-i-prosjekt-regn.js. Bare brukerens egen Microsoft-innlogging; ingen
// nøkler, ingen Worker. Prøves med falsk fetch i _test/test-legg-i-prosjekt.mjs.
import * as R from "./legg-i-prosjekt-regn.js";

export const GRAPH = "https://graph.microsoft.com/v1.0";
const HOST = "stormentrepreno.sharepoint.com";

export class IngenTilgang extends Error {}
export class IngenMappe extends Error {}

function lag(token) {
  const hode = (ekstra) => Object.assign({ Authorization: "Bearer " + token }, ekstra || {});
  async function hent(sti, valg) {
    const url = /^https:/.test(sti) ? sti : GRAPH + sti;
    const r = await fetch(url, Object.assign({}, valg || {}, { headers: hode(valg && valg.headers) }));
    if (r.status === 403) throw new IngenTilgang("403");
    return r;
  }
  async function json(sti) {
    const r = await hent(sti);
    if (!r.ok) throw new Error("Graph " + r.status);
    return r.json();
  }
  return { hent, json };
}

let siteId = null, driveId = null;

// Nettstedet StormProsjekter og biblioteket Prosjektdokumenter.
export async function stedOgBibliotek(token) {
  const g = lag(token);
  if (!siteId) siteId = (await g.json("/sites/" + HOST + ":" + R.STORM_PROSJEKTER_SITE)).id;
  if (!driveId) driveId = (await g.json("/sites/" + siteId + "/lists/" + encodeURIComponent(R.DOK_BIBLIOTEK) + "/drive")).id;
  return { siteId, driveId };
}

// Alle rader i lista Prosjekter (følger @odata.nextLink).
export async function hentProsjekter(token) {
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  const felt = "Nokkel,Arbeidsomrade,ProsjektNr,Title,ForelderNokkel,JobbNr,Modell,Prosjekttype";
  let url = "/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items?$expand=fields($select=" + felt + ")&$top=999";
  const ut = [];
  for (let i = 0; url && i < 50; i++) {
    const j = await g.json(url);
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}

// Prosjektmappa (navnet) – eller IngenMappe. Storm IFC lager den ALDRI.
export async function prosjektmappe(token, rad) {
  const g = lag(token);
  const { driveId: d } = await stedOgBibliotek(token);
  let url = "/drives/" + d + "/root/children?$select=name,folder&$top=999";
  for (let i = 0; url && i < 50; i++) {
    const j = await g.json(url);
    const navn = R.finnProsjektmappe(j.value || [], rad);
    if (navn) return navn;
    url = j["@odata.nextLink"] || null;
  }
  throw new IngenMappe(R.prosjektPrefiks(rad));
}

// Laster opp: under 4 MB med én PUT, ellers createUploadSession i biter.
// conflictBehavior=replace: samme navn blir ny versjon i SharePoint.
export async function lastOpp(token, mappe, underMappe, filnavn, blob, påFremdrift) {
  const g = lag(token);
  const { driveId: d } = await stedOgBibliotek(token);
  const sti = R.graphSti(mappe, underMappe, R.vaskFilnavn(filnavn));
  const størrelse = blob.size;
  if (størrelse <= R.ENKEL_GRENSE) {
    const r = await g.hent("/drives/" + d + "/root:/" + sti + ":/content?@microsoft.graph.conflictBehavior=replace",
      { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    if (!r.ok) throw new Error("Graph " + r.status);
    if (påFremdrift) påFremdrift(100);
    return r.json();
  }
  const ses = await g.hent("/drives/" + d + "/root:/" + sti + ":/createUploadSession", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } })
  });
  if (!ses.ok) throw new Error("Graph " + ses.status);
  const { uploadUrl } = await ses.json();
  const BIT = 320 * 1024 * 10;   // 3,2 MB – må være et multiplum av 320 KiB
  let svar = null;
  for (let fra = 0; fra < størrelse; fra += BIT) {
    const til = Math.min(størrelse, fra + BIT);
    // Opplastingsadressen er forhåndsgodkjent – IKKE send Authorization dit.
    const r = await fetch(uploadUrl, { method: "PUT", headers: {
      "Content-Range": "bytes " + fra + "-" + (til - 1) + "/" + størrelse }, body: blob.slice(fra, til) });
    if (!r.ok && r.status !== 202) throw new Error("Opplasting " + r.status);
    if (påFremdrift) påFremdrift(Math.round(til / størrelse * 100));
    if (r.status === 200 || r.status === 201) svar = await r.json();
  }
  return svar;
}

// Oversiktsfila {prosjektmappe}/00 Prosjektprofil/storm-ifc-dokumenter.json.
// Les (404 = tom), flett, skriv med If-Match; 412 → les på nytt, maks 3 ganger.
export async function oppdaterOversikt(token, mappe, post) {
  const g = lag(token);
  const { driveId: d } = await stedOgBibliotek(token);
  const sti = "/drives/" + d + "/root:/" + R.graphSti(mappe, R.OVERSIKT_MAPPE, R.OVERSIKT_FIL);
  for (let forsøk = 0; forsøk < 3; forsøk++) {
    let gammel = null, etag = null;
    const meta = await g.hent(sti);
    if (meta.ok) {
      const m = await meta.json();
      etag = m.eTag || null;
      const inn = await g.hent(sti + ":/content");
      if (inn.ok) { try { gammel = await inn.json(); } catch (_) { gammel = null; } }
    } else if (meta.status !== 404) throw new Error("Graph " + meta.status);
    const ny = R.flettOversikt(gammel, post);
    const hode = { "Content-Type": "application/json" };
    if (etag) hode["If-Match"] = etag;
    const r = await g.hent(sti + ":/content", { method: "PUT", headers: hode, body: JSON.stringify(ny) });
    if (r.ok) return ny;
    if (r.status !== 412) throw new Error("Graph " + r.status);
  }
  throw new Error("Oversiktsfila ble endret av noen andre tre ganger på rad – prøv igjen.");
}

// Til testene: glem nettsted og bibliotek.
export function _nullstill() { siteId = null; driveId = null; }
