// ☁ LAGRINGSSTATUS — én oversikt over alt som lagres i SharePoint (forslag 6C,
// Emil 03.11: «trykk på SharePoint-sirkelen oppe i høyre hjørne … ny outline-
// sirkel rundt som viser status på opplastninger: grønn hvis alt gikk bra, gul
// mens noe laster opp og rød hvis opplastning gikk galt»).
//
// Hver skriving til SharePoint melder seg her (sp-lager.js gjør det for alle
// verktøyene som bruker spSkriv/spSkrivBin/spLastOpp; markeringene og bildene
// melder selv). Ringen rundt innloggingsprikken viser samlet status, og boksen
// som åpnes når du trykker på prikken viser én linje per verktøy.
//
// Ingen andre moduler (bortsett fra i18n for navnene), så den kan importeres
// fra sp-lager.js uten sirkel.
import { t } from "./i18n.js";

// Mappe i SharePoint → navnet brukeren kjenner verktøyet under
const NAVN = {
  "Framdriftsplan": "Framdriftsplan", "Prosjektinfo": "Prosjektinfo", "FDV": "FDV",
  "Endringsmeldinger": "Endringsmeldinger", "Grupper": "Grupper", "Priskalkulasjon": "Priskalkulasjon",
  "Dagsrapporter": "Dagsrapport", "Modellgrupper": "Lag", "PDF-utseende": "Utseende PDF",
  "Kollisjoner": "Kollisjon", "Rigg": "Rigg", "Rigg-planer": "Rigg", "Tak-resultater": "Tak",
  "Blikk-resultater": "Blikk", "SW-resultater": "SW-generator", "Stopeplan": "Støpeplan",
  "Terreng": "Terreng", "Lag": "Lag", "Markeringer": "Markeringer", "Bilder": "Bilder"
};
export function navnFor(mappe, fil) {
  // Framdriftsplanen og ferdigmeldingene ligger i samme mappe
  if (mappe === "Framdriftsplan" && /ferdig/i.test(String(fil || ""))) return "Ferdigmeldinger";
  if (mappe === "Framdriftsplan" && /\.(webm|mp4)$/i.test(String(fil || ""))) return "Framdriftsvideo";
  return NAVN[mappe] || String(mappe || "");
}

// navn → { tilstand: "lagrer"|"ok"|"feil"|"lokal", tid, igjen, aktive }
const status = new Map();
const lyttere = new Set();
export function vedEndring(f) { lyttere.add(f); return () => lyttere.delete(f); }
function meld() { for (const f of lyttere) { try { f(); } catch (_) {} } }

// Starter en skriving. Returnerer ferdig(ok, grunn) som kalles når den er over.
// igjen: funksjon som gjør samme skriving på nytt (brukes av «Lagre alt nå»).
export function start(navn, igjen) {
  const s = status.get(navn) || { tilstand: "ok", tid: 0, aktive: 0 };
  s.aktive = (s.aktive || 0) + 1;
  s.tilstand = "lagrer";
  if (igjen) s.igjen = igjen;
  status.set(navn, s);
  meld();
  return (ok, grunn) => {
    s.aktive = Math.max(0, s.aktive - 1);
    if (s.aktive) return meld();
    s.tilstand = ok ? "ok" : grunn === "av" ? "lokal" : "feil";
    s.tid = Date.now();
    meld();
  };
}

// Pakker inn en async skriving som svarer { ok, grunn } (som spSkriv)
export async function sporet(navn, kjør) {
  const ferdig = start(navn, () => sporet(navn, kjør));
  try {
    const r = await kjør();
    ferdig(!!(r && r.ok), r && r.grunn);
    return r;
  } catch (err) { ferdig(false, "feil"); throw err; }
}

// Samlet: "lagrer" hvis noe skrives nå, ellers "feil" hvis noe sist feilet,
// ellers "ok" hvis noe er lagret i økta, ellers "" (ingen ring).
export function samlet() {
  let ok = false, feil = false;
  for (const s of status.values()) {
    if (s.tilstand === "lagrer") return "lagrer";
    if (s.tilstand === "feil") feil = true;
    if (s.tilstand === "ok") ok = true;
  }
  return feil ? "feil" : ok ? "ok" : "";
}

export function liste() {
  return [...status.entries()].map(([navn, s]) => ({ navn, tilstand: s.tilstand, tid: s.tid, kanIgjen: !!s.igjen }))
    .sort((a, b) => a.navn.localeCompare(b.navn, "no"));
}

// «Lagre alt nå»: prøver på nytt det som feilet eller bare ble lagret lokalt.
// → antall som ble sendt på nytt
export function lagreAltNa() {
  let n = 0;
  for (const s of status.values()) {
    if ((s.tilstand === "feil" || s.tilstand === "lokal") && s.igjen) { n++; try { s.igjen(); } catch (_) {} }
  }
  return n;
}

export function tilstandTekst(s) {
  if (s.tilstand === "lagrer") return t("laster opp …");
  if (s.tilstand === "feil") return t("feilet");
  if (s.tilstand === "lokal") return t("bare på denne PC-en");
  const tid = s.tid ? new Date(s.tid).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }) : "";
  return t("lagret {0}", tid);
}

// Bare for testene
export function _nullstill() { status.clear(); meld(); }
