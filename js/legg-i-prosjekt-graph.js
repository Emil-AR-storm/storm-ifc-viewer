// 📁 «LEGG I PROSJEKT» – Graph-delen (nett, men ingen skjerm). Reglene står i
// legg-i-prosjekt-regn.js. Bare brukerens egen Microsoft-innlogging; ingen
// nøkler, ingen Worker. Prøves med falsk fetch i _test/test-legg-i-prosjekt.mjs.
import * as R from "./legg-i-prosjekt-regn.js";
import { SELSKAPSDELING } from "./config.js";
import { nyKilde } from "./selskapsdeling.js";

export const GRAPH = "https://graph.microsoft.com/v1.0";
const HOST = "stormentrepreno.sharepoint.com";

export class IngenTilgang extends Error {}
export class IngenMappe extends Error {}
// Ny kilde, men brukeren er ikke med i noe selskap i SharePoint
export class IngenSelskap extends Error {}

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

const FULLE_FELT = "Nokkel,Arbeidsomrade,ProsjektNr,Title,ForelderNokkel,JobbNr,Modell,Prosjekttype,ProsjektmappeId,Prosjektmappe," +
  "Kunde,ProsjektlederNavn,ProsjektlederTelefon,ProsjektlederEpost,Adresse,Lat,Lon,KoordAdresse,Mannskap,Kontakter";

// Alle rader i lista Prosjekter (følger @odata.nextLink).
export async function hentProsjekter(token) {
  if (nyKilde()) return nyHentListe(token, FULLE_FELT, R.JOBB_FELT);
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  // Kolonnene etter Kunde er bekreftet av Storm Prosjekter 4.60 (SVAR 23.11):
  // prosjektlederen per selskap og Mannskap trengs for hele jobben (1B og 3A).
  const felt = FULLE_FELT;
  let url = "/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items?$expand=fields($select=" + felt + ")&$top=999";
  const ut = [];
  for (let i = 0; url && i < 50; i++) {
    const j = await g.json(url);
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}

// 🔗 B2 (Emil 24.11): den LETTE lista – bare det som trengs for å finne jobben
// og prosjektmappa. Mannskap, Kontakter, adresse osv. hentes bare for jobben
// (hentJobbRader), ikke for alle prosjektene i Storm Prosjekter.
export const LETT_FELT = "Nokkel,Arbeidsomrade,ProsjektNr,Title,ForelderNokkel,JobbNr,Modell,Prosjekttype,ProsjektmappeId,Prosjektmappe";
export async function hentProsjekterLett(token) {
  if (nyKilde()) return nyHentListe(token, LETT_FELT, R.JOBB_FELT_LETT);
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  let url = "/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items?$expand=fields($select=" + LETT_FELT + ")&$top=999";
  const ut = [];
  for (let i = 0; url && i < 50; i++) {
    const j = await g.json(url);
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}
// Alle radene med ett jobbnummer, med ALLE kolonnene (som hentProsjektFelt).
// SVAR fra Storm Prosjekter 24.11: JobbNr er TEKST og INDEKSERT (689 rader),
// så filteret er raskt og trenger ikke Prefer-hodet. Verdien er SE-nummeret
// («20652») eller selskapets nøkkel når jobben ikke har SE («SB-371»).
// En jobb uten JobbNr hentes på rad-id i sp-jobb.js (ingen modell peker på en
// slik rad i dag, ifølge samme svar).
export async function hentJobbRader(token, jobbNr) {
  const n = String(jobbNr == null ? "" : jobbNr).trim();
  if (!n) return [];
  if (nyKilde()) return nyHentJobbRader(token, n);
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  let url = "/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items?$expand=fields&$top=200&$filter=" +
    encodeURIComponent("fields/JobbNr eq '" + n.replace(/'/g, "''") + "'");
  const ut = [];
  for (let i = 0; url && i < 20; i++) {
    const j = await g.json(url);
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}
// Én rad (id, createdDateTime og alle kolonnene) – for en jobb uten jobbnummer.
export async function hentProsjektRad(token, id) {
  if (nyKilde()) return nyHentRad(token, id);
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  return g.json("/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items/" + encodeURIComponent(id) + "?$expand=fields");
}

// ✍️ 1B (runde 5): alle kolonnene til ett prosjekt (Prosjektinfo fra Storm
// Prosjekter). Uten $select, så vi ser hva lista faktisk har.
export async function hentProsjektFelt(token, rad) {
  if (nyKilde()) {
    if (!rad || !rad.id) return (rad && rad.fields) || {};
    const r = await nyHentRad(token, rad.id);
    return (r && r.fields) || {};
  }
  const g = lag(token);
  const { siteId: s } = await stedOgBibliotek(token);
  if (!rad || !rad.id) return (rad && rad.fields) || {};
  const j = await g.json("/sites/" + s + "/lists/" + R.PROSJEKT_LISTE + "/items/" + encodeURIComponent(rad.id) + "?$expand=fields");
  return (j && j.fields) || {};
}

// Mappe på ID (felles mappe, Storm Prosjekter 4.26). null ved 404 eller når
// det ikke er en mappe.
async function mappePåId(g, d, id) {
  if (!id) return null;
  const r = await g.hent("/drives/" + d + "/items/" + encodeURIComponent(id) + "?$select=id,name,webUrl,folder,parentReference");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Graph " + r.status);
  const j = await r.json();
  return j && j.folder ? j : null;
}

// Prosjektmappa – samme rekkefølge som Storm Prosjekter 4.57 (18.11):
//   1. prosjektets ProsjektmappeId. Under «Storm Entreprenør/», «Storm Betong/»
//      eller «Storm Stål/» er den EGEN (ikke felles); i rota er den en gammel
//      felles mappe. Ligger den i «_Arkiv felles mapper» (flyttet), brukes den ikke.
//   2. uten ID: «<selskapsmappe>/<ProsjektNr> …» (prefiks-søk)
//   3. gammel egen mappe i rota, «<Arbeidsomrade> <ProsjektNr> » (ikke felles)
//   4. gammel felles mappe via et annet prosjekt i jobben (bare til mappene er
//      delt opp) – aldri et annet selskaps egen mappe, aldri arkivet
//   5. IngenMappe – Storm IFC lager den ALDRI (åpne Dokumenter i Storm Prosjekter).
// Svar: { sti, navn, id, felles }
async function barnAv(g, d, sti) {
  const ut = [];
  let url = "/drives/" + d + (sti ? "/root:/" + R.graphSti(sti) + ":/children" : "/root/children") + "?$select=name,folder&$top=999";
  for (let i = 0; url && i < 50; i++) {
    const r = await g.hent(url);
    if (r.status === 404) return ut;
    if (!r.ok) throw new Error("Graph " + r.status);
    const j = await r.json();
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}
export async function prosjektmappe(token, rad, rader) {
  if (nyKilde()) return nyProsjektmappe(token, rad);
  const g = lag(token);
  const { driveId: d } = await stedOgBibliotek(token);
  const f = (rad && (rad.fields || rad)) || {};
  const fraItem = (m) => { const sti = R.stiFraItem(m); return { sti, navn: m.name, id: m.id, felles: !R.underSelskapsmappe(sti) }; };
  const egen = await mappePåId(g, d, f.ProsjektmappeId);
  if (egen && !R.iArkiv(R.stiFraItem(egen))) return fraItem(egen);
  const sm = R.selskapsmappe(f.Arbeidsomrade);
  if (sm) {
    const navn = R.finnSelskapsmappeProsjekt(await barnAv(g, d, sm), rad);
    if (navn) return { sti: sm + "/" + navn, navn, id: "", felles: false };
  }
  const navn = R.finnProsjektmappe(await barnAv(g, d, ""), rad);
  if (navn) return { sti: navn, navn, id: "", felles: false };
  for (const annen of R.jobbMappeKandidater(rader || [], rad)) {
    const m = await mappePåId(g, d, (annen.fields || annen).ProsjektmappeId);
    if (!m) continue;
    const sti = R.stiFraItem(m);
    if (R.iArkiv(sti) || R.underSelskapsmappe(sti)) continue;   // arkivet, eller et annet selskaps egen mappe
    return { sti, navn: m.name, id: m.id, felles: true };
  }
  throw new IngenMappe(R.prosjektPrefiks(rad));
}

// Laster opp: under 4 MB med én PUT, ellers createUploadSession i biter.
// conflictBehavior=replace: samme navn blir ny versjon i SharePoint.
export async function lastOpp(token, mappe, underMappe, filnavn, blob, påFremdrift) {
  const g = lag(token);
  const k = await diskFor(token, mappe), d = k.d;
  const sti = R.graphSti(R.utSti(mappe, k.sm, k.flat), underMappe, R.vaskFilnavn(filnavn));
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

// Last opp UTEN å overskrive (felles dagsrapport, 12.11): finnes fila fra før
// (lagt der av Storm Prosjekter eller et tidligere forsøk), røres den ikke.
// Svar: { item, finnes } – item er driveItem-en som ligger der nå.
export async function lastOppNy(token, mappe, underMappe, filnavn, blob) {
  const g = lag(token);
  const k = await diskFor(token, mappe), d = k.d;
  const sti = "/drives/" + d + "/root:/" + R.graphSti(R.utSti(mappe, k.sm, k.flat), underMappe, R.vaskFilnavn(filnavn));
  const fra = await g.hent(sti);
  if (fra.ok) return { item: await fra.json(), finnes: true };
  if (fra.status !== 404) throw new Error("Graph " + fra.status);
  if (blob.size > R.ENKEL_GRENSE) {
    // Store PDF-er: samme økt som lastOpp, men conflictBehavior=fail
    const ses = await g.hent(sti + ":/createUploadSession", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }) });
    if (ses.status === 409) { const n = await g.hent(sti); if (n.ok) return { item: await n.json(), finnes: true }; }
    if (!ses.ok) throw new Error("Graph " + ses.status);
    const { uploadUrl } = await ses.json();
    const BIT = 320 * 1024 * 10;
    let svar = null;
    for (let fra2 = 0; fra2 < blob.size; fra2 += BIT) {
      const til = Math.min(blob.size, fra2 + BIT);
      const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": "bytes " + fra2 + "-" + (til - 1) + "/" + blob.size }, body: blob.slice(fra2, til) });
      if (!r.ok && r.status !== 202) throw new Error("Opplasting " + r.status);
      if (r.status === 200 || r.status === 201) svar = await r.json();
    }
    return { item: svar, finnes: false };
  }
  const r = await g.hent(sti + ":/content?@microsoft.graph.conflictBehavior=fail",
    { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
  if (r.status === 409) { const n = await g.hent(sti); if (n.ok) return { item: await n.json(), finnes: true }; }
  if (!r.ok) throw new Error("Graph " + r.status);
  return { item: await r.json(), finnes: false };
}

// Oversiktsfila {prosjektmappe}/00 Prosjektprofil/storm-ifc-dokumenter.json.
// Les (404 = tom), flett, skriv med If-Match; 412 → les på nytt, maks 3 ganger.
export async function oppdaterOversikt(token, mappe, post) {
  const g = lag(token);
  const k = await diskFor(token, mappe), d = k.d;
  const sti = "/drives/" + d + "/root:/" + R.graphSti(R.utSti(mappe, k.sm, k.flat), R.OVERSIKT_MAPPE, R.OVERSIKT_FIL);
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

// ═══════════════ 🏢 NY KILDE: SELSKAPSDELING (BYGGEPLAN 25.11) ═══════════════
// Lista Prosjekter og Prosjektdokumenter i hvert selskaps gruppe. Brukeren ser
// bare selskapene hen er medlem av. Det som er felles for jobben (Modell,
// Mannskap, Kontakter, adressen …) ligger i lista Jobber på StormProsjekter og
// legges oppå hovedprosjektene. Bare brukerens egen innlogging, som før.
let selskapBuffer = null;
const diskBuffer = {};
let spSiteId = null;

// Hvilke selskaper er brukeren med i? Svar = medlem; 401/403/404 = hoppes over;
// annen feil kastes. Huskes for økten.
export async function selskaper(token) {
  if (selskapBuffer) return selskapBuffer;
  const ut = [];
  for (const omr of ["SE", "SB", "SS"]) {
    const sti = SELSKAPSDELING.omrader[omr];
    if (!sti) continue;
    const r = await fetch(GRAPH + "/sites/" + HOST + ":" + sti + "?$select=id", { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401 || r.status === 403 || r.status === 404) continue;
    if (!r.ok) throw new Error("Graph " + r.status);
    const j = await r.json();
    if (j && j.id) ut.push({ omr, siteId: j.id });
  }
  selskapBuffer = ut;
  return ut;
}
async function alleSelskaper(token) {
  const l = await selskaper(token);
  if (!l.length) throw new IngenSelskap("Du er ikke lagt inn i noe selskap i SharePoint");
  return l;
}
async function selskapSite(token, omr) {
  const s = (await selskaper(token)).find(x => x.omr === omr);
  if (!s) throw new IngenTilgang("403 " + omr);
  return s.siteId;
}
// Lista i selskapet (adresseres på navnet, som før – ett kall spart)
export async function prosjektListe(token, omr) {
  return "/sites/" + await selskapSite(token, omr) + "/lists/" + R.PROSJEKT_LISTE;
}
// Prosjektdokumenter i selskapet. Flate prosjektmapper (25.11): biblioteket
// får visningsnavnet «Storm Betong prosjekter», men adressen er fortsatt
// …/Prosjektdokumenter – derfor finnes det på adressen (webUrl), ikke navnet.
export async function dokDisk(token, omr) {
  if (diskBuffer[omr]) return diskBuffer[omr];
  const g = lag(token);
  const s = await selskapSite(token, omr);
  const l = await hentAlle(g, "/sites/" + s + "/drives?$select=id,name,webUrl", 5);
  const disk = l.find(x => R.erProsjektdokumenter(x.webUrl));
  if (!disk) throw new Error("Fant ikke prosjektbiblioteket (…/Prosjektdokumenter) i " + (SELSKAPSDELING.mapper[omr] || omr) + ".");
  diskBuffer[omr] = disk.id;
  return diskBuffer[omr];
}
// Gammelt eller nytt (flatt) oppsett i selskapets bibliotek? Finnes mappa
// «Storm Betong» i rota, er det gammelt (stier som før). 404 = flatt.
// Huskes for økten.
const oppsettBuffer = {};
async function oppsett(token, omr) {
  const d = await dokDisk(token, omr);
  const sm = R.selskapsmappe(omr);
  if (!(omr in oppsettBuffer)) {
    const r = await lag(token).hent("/drives/" + d + "/root:/" + R.graphSti(sm) + "?$select=id");
    if (r.ok) oppsettBuffer[omr] = false;
    else if (r.status === 404) oppsettBuffer[omr] = true;
    else throw new Error("Graph " + r.status);
  }
  return { d, sm, flat: oppsettBuffer[omr], omr };
}
// Disken for en mappe: gammel kilde = StormProsjekter; ny kilde = selskapet i
// første del av stien. En sti uten selskapsmappe lastes ALDRI opp (ellers kunne
// den havnet i feil selskap).
// Svar: { d, sm, flat } – flat = prosjektmappene ligger rett i biblioteket.
async function diskFor(token, mappe) {
  if (!nyKilde()) return { d: (await stedOgBibliotek(token)).driveId, sm: "", flat: false };
  const omr = R.selskapForSti(mappe);
  if (!omr) throw new Error("Mappa «" + String(mappe || "") + "» ligger ikke i en selskapsmappe – ingenting er lastet opp.");
  return oppsett(token, omr);
}

async function hentAlle(g, url, maks) {
  const ut = [];
  for (let i = 0; url && i < maks; i++) {
    const j = await g.json(url);
    ut.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return ut;
}
// Jobber på StormProsjekter (bare feltene Storm IFC trenger). Feiler den: tom
// liste og en advarsel – da brukes radenes egne verdier.
async function hentJobber(token, nummer, feltListe) {
  try {
    const g = lag(token);
    if (!spSiteId) spSiteId = (await g.json("/sites/" + HOST + ":" + R.STORM_PROSJEKTER_SITE)).id;
    let url = "/sites/" + spSiteId + "/lists/" + R.JOBBER_LISTE + "/items?$expand=fields($select=" + feltListe.join(",") + ")&$top=" + (nummer ? 50 : 999);
    if (nummer) url += "&$filter=" + encodeURIComponent("fields/JobbNr eq '" + String(nummer).replace(/'/g, "''") + "'");
    return await hentAlle(g, url, nummer ? 5 : 50);
  } catch (err) {
    console.warn("[Storm IFC] Lista Jobber kunne ikke leses – bruker prosjektradenes egne verdier.", err && err.message);
    return [];
  }
}
// Samme spørring mot hvert selskap brukeren er med i, slått sammen
async function fraAlleSelskaper(token, sti) {
  const g = lag(token);
  const l = await alleSelskaper(token);
  const deler = await Promise.all(l.map(async ({ omr }) => {
    try {
      return (await hentAlle(g, (await prosjektListe(token, omr)) + sti, 50)).map(r => R.medSelskap(r, omr));
    } catch (err) {
      if (err instanceof IngenTilgang) return [];    // mistet tilgangen siden sjekken
      throw err;
    }
  }));
  return [].concat(...deler);
}
async function nyHentListe(token, feltTekst, jobbFelt) {
  const [rader, jobber] = await Promise.all([
    fraAlleSelskaper(token, "/items?$expand=fields($select=" + feltTekst + ")&$top=999"),
    hentJobber(token, "", jobbFelt)
  ]);
  return R.leggPåJobber(rader, jobber);
}
async function nyHentJobbRader(token, n) {
  const [rader, jobber] = await Promise.all([
    fraAlleSelskaper(token, "/items?$expand=fields&$top=200&$filter=" + encodeURIComponent("fields/JobbNr eq '" + n.replace(/'/g, "''") + "'")),
    hentJobber(token, n, R.JOBB_FELT)
  ]);
  return R.leggPåJobber(rader, jobber);
}
// Én rad: id-en sier selskapet («SB:123»). En gammel id uten selskap finnes
// ikke i ny kilde → feil, og sp-jobb.js leter på nytt.
async function nyHentRad(token, id) {
  const d = R.delId(id);
  if (!d) throw new Error("Rad-id uten selskap: " + id);
  const g = lag(token);
  const rad = R.medSelskap(await g.json((await prosjektListe(token, d.omr)) + "/items/" + encodeURIComponent(d.id) + "?$expand=fields"), d.omr);
  const n = R.jobbNøkkel(rad);
  return n && !rad.fields.ForelderNokkel ? R.leggPåJobber([rad], await hentJobber(token, n, R.JOBB_FELT))[0] : rad;
}
// Prosjektmappa i prosjektets selskap:
//   1. ProsjektmappeId på selskapets disk (ikke i arkivet)
//   2. «<selskapsmappe>/<ProsjektNr> …»
//   3. IngenMappe – gamle felles mapper og mapper i rota finnes ikke her.
async function nyProsjektmappe(token, rad) {
  const g = lag(token);
  const f = (rad && (rad.fields || rad)) || {};
  const omr = (rad && rad._omr) || (R.delId(rad && rad.id) || {}).omr || String(f.Arbeidsomrade || "").trim().toUpperCase();
  const sm = R.selskapsmappe(omr);
  if (!sm) throw new IngenMappe(R.prosjektPrefiks(rad));
  const k = await oppsett(token, omr), d = k.d;
  // Flatt oppsett: stien får selskapsmappa lagt til, så den ser ut som før
  const egen = R.innItem(await mappePåId(g, d, f.ProsjektmappeId), sm, k.flat);
  if (egen) {
    const sti = R.stiFraItem(egen);
    if (!R.iArkiv(sti) && R.selskapForSti(sti) === omr) return { sti, navn: egen.name, id: egen.id, felles: false, omr };
  }
  // Flatt oppsett: barna av rota (utSti gir "")
  const navn = R.finnSelskapsmappeProsjekt(await barnAv(g, d, R.utSti(sm, sm, k.flat)), rad);
  if (navn) return { sti: sm + "/" + navn, navn, id: "", felles: false, omr };
  throw new IngenMappe(R.prosjektPrefiks(rad));
}

// Til testene: glem nettsted og bibliotek.
export function _nullstill() { siteId = null; driveId = null; selskapBuffer = null; spSiteId = null; for (const k of Object.keys(diskBuffer)) delete diskBuffer[k]; for (const k of Object.keys(oppsettBuffer)) delete oppsettBuffer[k]; }
