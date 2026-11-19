// 🌐🌓 FELLES SPRÅK OG TEMA med Storm Prosjekter og Storm Bemanning (19.11.2026)
//
// BYGGEPLAN-Storm-IFC-felles-innstillinger-2026-11-19.md. Velger brukeren
// mørk modus og engelsk i én av de tre nettsidene, bruker de andre to det
// samme neste gang de åpnes.
//
// Lagring: lista «Brukere» på /sites/StormProsjekter, én rad per bruker
// (Title = e-post med små bokstaver), kolonnene Sprak, Tema og InnstEndret.
// Regler (felles for alle tre nettsidene):
//   · Ved oppstart brukes valget på enheten først. Etter innlogging (og ETTER
//     Storm IFC sin egen prefs-fil) hentes raden; et gyldig, ulikt valg vinner.
//   · Bare når brukeren selv endrer, skrives Sprak/Tema + InnstEndret til
//     brukerens EGEN rad (PATCH …/items/{id}/fields). Et valg som kom FRA
//     lista skrives aldri tilbake (ingen evig runde).
//   · Storm IFC lager ALDRI en rad (raden styrer tilgangen i Storm
//     Prosjekter) og endrer ALDRI andre kolonner.
//   · Ugyldige verdier ignoreres – alt fra lista er data.
//   · Feil i Graph stopper aldri siden: console.warn og fortsett.
//   · Uten Microsoft-innlogging (byggeplass-siden, montører, byggherre-lenker)
//     lastes ikke denne modulen – alt virker som før, bare på enheten.
//
// Lesing bruker det vanlige SharePoint-tokenet (Sites.Read.All). Å endre et
// listeelement krever Sites.ReadWrite.All; det hentes STILLE og bare når noe
// skal lagres. Er tillatelsen ikke gitt i app-registreringen, blir valget
// liggende på enheten – uten vindu og uten feilmelding.
import { S } from "./state.js";
import { GRAPH, SP, graphGet, graphToken, spTokenSilent } from "./sharepoint.js";
import { setLang } from "./i18n.js";
import { settTema, tema } from "./tema.js";

export const SITE = "/sites/StormProsjekter", LISTE = "Brukere";
export const OK_SPRAK = ["no", "en", "pl", "lt"], OK_TEMA = ["lys", "mork"];
const SKRIV_SCOPES = ["Sites.ReadWrite.All"];
const FI = { siteId: null, listId: null, radId: null, epost: "", ingenRad: false };

// Ren regel (testes): hva skal endres lokalt ut fra raden?
//   { tema?: "lys"|"mork", sprak?: "no"|"en"|"pl"|"lt" } – bare gyldige og ulike verdier
export function endringerFraRad(rad, nå) {
  const ut = {};
  if (!rad || typeof rad !== "object") return ut;
  const tm = typeof rad.Tema === "string" ? rad.Tema.trim() : "";
  const sp = typeof rad.Sprak === "string" ? rad.Sprak.trim() : "";
  if (OK_TEMA.includes(tm) && tm !== nå.tema) ut.tema = tm;
  if (OK_SPRAK.includes(sp) && sp !== nå.sprak) ut.sprak = sp;
  return ut;
}
// Ren regel (testes): feltene som skrives – bare Sprak/Tema (gyldige) + InnstEndret
export function feltTilLagring(felt, tid) {
  const ut = {};
  if (felt && OK_SPRAK.includes(felt.Sprak)) ut.Sprak = felt.Sprak;
  if (felt && OK_TEMA.includes(felt.Tema)) ut.Tema = felt.Tema;
  if (!Object.keys(ut).length) return null;
  ut.InnstEndret = tid || new Date().toISOString();
  return ut;
}

function minEpost() {
  try { return String((S.msalApp && S.msalApp.getActiveAccount() && S.msalApp.getActiveAccount().username) || "").trim().toLowerCase(); }
  catch (_) { return ""; }
}

async function finnRad(token) {
  const epost = minEpost();
  if (!epost) return null;
  if (FI.epost !== epost) { FI.epost = epost; FI.radId = null; FI.ingenRad = false; }
  if (FI.ingenRad) return null;
  if (!FI.siteId) FI.siteId = (await graphGet("/sites/" + SP.hostname + ":" + SITE, token)).id;
  if (!FI.listId) {
    const l = await graphGet("/sites/" + FI.siteId + "/lists?$select=id,displayName&$top=200", token);
    const x = (l.value || []).find(v => v.displayName === LISTE);
    if (!x) { FI.ingenRad = true; return null; }
    FI.listId = x.id;
  }
  const f = encodeURIComponent("fields/Title eq '" + epost.replace(/'/g, "''") + "'");
  const d = await graphGet("/sites/" + FI.siteId + "/lists/" + FI.listId +
    "/items?$expand=fields($select=Title,Sprak,Tema,InnstEndret)&$filter=" + f + "&$top=2", token);
  const rad = (d.value || []).find(v => v && v.fields && String(v.fields.Title || "").trim().toLowerCase() === epost);
  if (!rad) { FI.ingenRad = true; return null; }
  FI.radId = rad.id;
  return rad.fields || {};
}

// Etter innlogging, og ETTER pullUserPrefs() (usersync.js kaller S.hentFelles).
export async function hentFelles() {
  try {
    const token = await spTokenSilent();
    if (!token) return;
    const r = await finnRad(token);
    if (!r) return;
    const e = endringerFraRad(r, { tema: tema(), sprak: S.lang || "no" });
    if (e.tema) settTema(e.tema, { fraFelles: true });
    if (e.sprak) await setLang(e.sprak, { fraFelles: true });
  } catch (err) { console.warn("Felles innstillinger:", (err && err.message) || err); }
}

// Brukeren endret selv: { Sprak } eller { Tema }
export async function lagreFelles(felt) {
  try {
    const kropp = feltTilLagring(felt);
    if (!kropp) return;
    const lese = await spTokenSilent();
    if (!lese) return;
    if (!FI.radId && !(await finnRad(lese))) return;      // ingen rad → bare på enheten
    const token = await graphToken(SKRIV_SCOPES, { silent: true });
    if (!token) { console.warn("Felles innstillinger (lagre): mangler skrivetilgang til lista Brukere (Sites.ReadWrite.All)"); return; }
    const r = await fetch(GRAPH + "/sites/" + FI.siteId + "/lists/" + FI.listId + "/items/" + encodeURIComponent(FI.radId) + "/fields", {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(kropp)
    });
    if (!r.ok) throw new Error("Graph " + r.status);
  } catch (err) { console.warn("Felles innstillinger (lagre):", (err && err.message) || err); }
}

S.lagreFelles = lagreFelles;
S.hentFelles = hentFelles;
// Til testene
export function _nullstill() { FI.siteId = FI.listId = FI.radId = null; FI.epost = ""; FI.ingenRad = false; }
