// Firmaoppsett fra SharePoint: ansattliste, Planner-plan og Worker-adresse.
//
// Hvorfor: disse tre tingene er forskjellige hos hver kunde. Lå de i config.js,
// måtte koden endres per kunde – og Storms egne ansatte fulgte med i kjøpet.
// Nå ligger de i én fil, «oppsett.json», rett i SharePoint-mappa som allerede
// er satt opp (SP.folder). Den som administrerer mappa kan endre lista uten å
// røre kode.
//
// MYK DEGRADERING er hele poenget: finnes ikke fila, er du ikke innlogget, eller
// svarer Graph feil – da starter viewer'en som før, bare uten ansattliste.
// Ingenting kaster. Det eneste som forsvinner er «Ansvarlig»-nedtrekket og
// Planner-knappen, og begge sier fra hvorfor.
import { S } from "./state.js";
import { ANSATTE, FRISTER, PLANNER, TJENESTER } from "./config.js";
import { vaskGrenser } from "./frist.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";

const CACHE_KEY = "storm-ifc-oppsett";

// Filnavnet i SharePoint. Ligger ved siden av modellene, ikke i en undermappe –
// færre steder å bomme for den som skal legge den inn første gang.
export const OPPSETT_FIL = "oppsett.json";

export const oppsettSti = () =>
  SP.folder.split("/").map(encodeURIComponent).join("/") + "/" + encodeURIComponent(OPPSETT_FIL);

// ---------- Vasking ----------
// Alt som kommer utenfra vaskes før det slippes inn. En håndredigert JSON-fil
// har feil i seg før eller siden, og da skal viewer'en droppe den ene raden –
// ikke hele lista.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Hvilke adresser oppsett.json får peke på ----------
// oppsett.json ligger i SharePoint-mappa, og alle som kan skrive der kan endre
// den. Sto det bare "bare https" her, kunne de byttet worker-adressen til sin
// egen server – og neste gang en prosjektleder trykket Byggeplass, ville
// opplastingsnøkkelen fulgt med i x-token-headeren (se byggeplass.js).
// Nøkkelen er FELLES for alle prosjekter, så det ene byttet gir tilgang til
// alt. En https-sjekk stopper feilskriving, ikke en som vil noe.
//
// Adressen kan fortsatt settes i oppsett.json – det var hele poenget med fila
// – men bare til en vert som står her. Skal Workeren flyttes for godt, endres
// lista og klienten pushes. Det skjer sjelden, og det er kontorarbeid.
//
// Et navn uten punktum foran må treffe eksakt. Et navn som BEGYNNER med
// punktum godtar underdomener: ".logic.azure.com" slipper gjennom
// "prod-59.westeurope.logic.azure.com", men ikke "falsk-logic.azure.com".
export const WORKER_VERTER = ["storm-byggeplass.emil-46a.workers.dev"];
// Varselet går til en Power Automate-flyt. De ligger alltid under Microsofts
// logic.azure.com, og verten bytter når flyten flyttes mellom regioner – derfor
// domenet og ikke én fast vert.
export const VARSEL_VERTER = [".logic.azure.com"];

export function gyldigAdresse(adr, verter) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(adr)) return false;   // bare https, ingen mellomrom
  let vert;
  try { vert = new URL(adr).hostname.toLowerCase(); } catch (_) { return false; }
  return verter.some(v => v[0] === "." ? vert.endsWith(v) : vert === v);
}

export function vaskAnsatte(rå) {
  if (!Array.isArray(rå)) return [];
  const sett = new Set();
  const ut = [];
  for (const p of rå) {
    if (!p || typeof p !== "object") continue;
    const navn = String(p.navn || "").trim();
    if (!navn) continue;                       // uten navn er raden ubrukelig
    const id = GUID.test(String(p.id || "").trim()) ? String(p.id).trim().toLowerCase() : "";
    if (id && sett.has(id)) continue;          // samme person to ganger
    if (id) sett.add(id);
    ut.push({ navn, id, mail: String(p.mail || "").trim() });
  }
  return ut;
}

// Legger et hentet oppsett på plass. Endrer ALDRI hvilke objekter de andre
// modulene holder på – bare innholdet i dem.
export function bruk(o) {
  if (!o || typeof o !== "object") return false;

  const folk = vaskAnsatte(o.ansatte);
  if (folk.length) {
    ANSATTE.length = 0;                        // samme liste, nytt innhold
    folk.forEach(p => ANSATTE.push(p));
  }

  const pl = o.planner || {};
  if (typeof pl.planId === "string" && pl.planId.trim()) PLANNER.planId = pl.planId.trim();
  if (typeof pl.bucket === "string" && pl.bucket.trim()) PLANNER.bucket = pl.bucket.trim();

  // Bare https, og bare en vert fra lista øverst i fila. Se kommentaren der:
  // https alene stopper feilskriving, ikke en omdirigering som vil noe.
  const w = String(o.worker || "").trim();
  if (gyldigAdresse(w, WORKER_VERTER)) TJENESTER.worker = w.replace(/\/+$/, "");

  // Adressen @-nevninger varsles til (Power Automate / Teams-flyt). Samme
  // sjekk. Her følger det ingen nøkkel med, men navn og kommentartekst – og
  // den sendes med no-cors, så en omdirigering ville aldri gitt en feilmelding
  // noen kunne reagert på. Mangler adressen, virker nevning fortsatt – den
  // vises bare i appen.
  const v = String(o.varsel || "").trim();
  if (gyldigAdresse(v, VARSEL_VERTER)) TJENESTER.varsel = v;

  // Fristgrensene: når skifter ringen rundt en markering til gul og rød?
  // Firmaets verdier, ikke personlige — derfor her og ikke i S.settings.
  // vaskGrenser tåler tull i en håndredigert fil: tekst, negative tall, og at
  // gul og rod er byttet om (da hadde ingenting blitt gult).
  if (o.frister) {
    const g = vaskGrenser(o.frister);
    FRISTER.gul = g.gul; FRISTER.rod = g.rod;
  }

  return true;
}

// ---------- Hurtigbuffer ----------
// Lista brukes med en gang siden åpnes, lenge før Graph rekker å svare. Uten
// buffer ville «Ansvarlig» stått tom de første sekundene hver eneste gang.
function lesBuffer() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (_) { return null; }
}
function skrivBuffer(o) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); } catch (_) {}
}

// ---------- Henting ----------
export async function hentOppsett() {
  try {
    // Token-hentingen ligger INNE i try: laster ikke MSAL (blokkert nett,
    // reklameblokkerer), kaster den, og en ubehandlet feil her ville stoppet
    // resten av oppstarten uten at noe synes på skjermen.
    const token = await spTokenSilent();
    if (!token) return false;                  // ikke innlogget – bufferet står
    if (!S.spSiteId) {
      const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
      S.spSiteId = site.id;
    }
    const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/root:/" + oppsettSti() + ":/content",
      { headers: authHeaders(token, null, "oppsett.json") });
    if (r.status === 404) {
      console.warn("Fant ingen " + OPPSETT_FIL + " i «" + SP.folder + "». " +
        "Ansvarlig-lista og Planner er derfor ikke satt opp.");
      return false;
    }
    if (!r.ok) throw new Error("Graph " + r.status);
    const data = await r.json();
    bruk(data);
    skrivBuffer(data);
    S.oppsettOK = true;
    try { if (S.onOppsett) S.onOppsett(); } catch (_) {}
    return true;
  } catch (err) {
    console.warn("Kunne ikke hente " + OPPSETT_FIL + ":", err.message);
    return false;
  }
}

// Bufferet tas i bruk med det samme fila lastes.
bruk(lesBuffer());

// Kjedes på, ikke over: usersync.js setter den samme krokene. Rekkefølgen på
// importene skal ikke kunne slå ut den ene eller den andre.
const tidligere = S.onSignedIn;
S.onSignedIn = () => {
  try { if (tidligere) tidligere(); } catch (_) {}
  hentOppsett();
};

// Var brukeren allerede innlogget da siden lastet, kan msalInit ha kalt
// S.onSignedIn før denne fila kom med. Samme sikkerhetsnett som usersync.js.
setTimeout(() => { if (!S.oppsettOK) hentOppsett(); }, 3000);
