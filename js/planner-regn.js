// 📋 Planner-status tilbake (verktøy 8, runde 1 — bygget 21.10.2026).
//
// REN regning, uten DOM, uten Graph og uten S — så _test/test-planner-synk.mjs
// kan kjøre den rett. markers.js henter statusene (planner.js hentStatus) og
// bruker det som kommer ut herfra.
//
// Emils beslutninger 21.10:
//   • Lukkes oppgaven i Planner → markeringen blir «Løst» av seg selv.
//   • Åpnes den igjen i Planner mens markeringen er «Løst» → IKKE endre noe
//     automatisk; bare et merke «Åpnet igjen i Planner», så bekrefter Emil.
//   • Oppgaven er slettet i Planner (404) → taskId fjernes, markeringen står,
//     merke «Oppgaven finnes ikke lenger».
//
// Feltene på markeringen (alle tekst, se MARKERING_TEKSTFELT i markers.js):
//   plannerMerke  "lukket" | "apnet" | "borte" | ""   — hva stripa i bobla viser
//   plannerDato   YYYY-MM-DD da merket kom              — «lukket» vises i 7 dager
//   plannerLukket completedDateTime vi alt har tatt stilling til. Uten den
//                 ville en markering som ble satt tilbake (Angre, eller Åpen
//                 for hånd) blitt lukket igjen ved neste synk — for oppgaven
//                 er fortsatt 100 % i Planner.
//   plannerSist   "ferdig" | "apen" — Planner-tilstanden sist vi så. «Åpnet
//                 igjen» betyr en OVERGANG fra ferdig til åpen; uten den ville
//                 en markering satt til Løst her (der fullforOppgave feilet)
//                 fått merket uten at noen har gjenåpnet noe.
//   plannerFra    status før automatisk lukking — det Angre setter tilbake.
//   plannerAv     navnet på den som lukket i Planner (fra ANSATTE), eller "".

export const LUKKET_VISES_DAGER = 7;
export const PLANNER_MERKER = ["lukket", "apnet", "borte"];
export const MIN_MELLOM_SYNK_MS = 5 * 60 * 1000;   // høyst hvert 5. minutt

// statuser: [{ id, finnes:false }  eller
//            { id, percentComplete, completedDateTime, completedBy }]
// En oppgave som IKKE er med i lista (struping, 403, nettfeil) får ingen
// endring — vi vet ingenting nytt om den.
//
// Ut: [{ id, art, tid?, avId? }], der art er
//   "lukket"        sett markeringen til Løst (synlig endring + angre)
//   "apnet"         sett merket «Åpnet igjen»
//   "borte"         fjern taskId, sett merket «finnes ikke»
//   "ferdig-stille" / "apen-stille"  bare bokføring (plannerSist/plannerLukket)
export function statusEndringer(markeringer, statuser) {
  const etter = new Map((statuser || []).filter(s => s && s.id != null).map(s => [String(s.id), s]));
  const ut = [];
  for (const c of markeringer || []) {
    if (!c || !c.taskId) continue;
    const s = etter.get(String(c.taskId));
    if (!s) continue;
    if (s.finnes === false) { ut.push({ id: c.id, art: "borte" }); continue; }
    const ferdig = Number(s.percentComplete) >= 100;
    const tid = String(s.completedDateTime || "");
    const lost = c.status === "Løst";
    if (ferdig) {
      if (!lost && c.plannerLukket !== tid) {
        ut.push({ id: c.id, art: "lukket", tid, avId: String(s.completedBy || "") });
      } else if (c.plannerSist !== "ferdig" || c.plannerMerke === "apnet" ||
                 (lost && c.plannerLukket !== tid)) {
        ut.push({ id: c.id, art: "ferdig-stille", tid });
      }
    } else {
      if (lost && c.plannerSist === "ferdig") ut.push({ id: c.id, art: "apnet" });
      else if (c.plannerSist !== "apen") ut.push({ id: c.id, art: "apen-stille" });
    }
  }
  return ut;
}

// Svar-id-en er LIK på alle maskiner for samme lukking. Synken fletter svar
// på id (syncSharedComments) — med tilfeldig id ville to PC-er som begge så
// lukkingen gitt to like linjer i tråden.
export function plannerSvarId(taskId, tid) {
  return "planner-" + String(taskId || "") + "-" + String(tid || "");
}

// Gjør én endring om til { patch, svar? }. patch legges på markeringen med
// Object.assign; undefined-verdier betyr «fjern feltet» (taskId ved «borte»).
// navn = den som lukket i Planner (slått opp i ANSATTE), eller "".
export function patchFor(c, e, { iDag, naa, navn } = {}) {
  if (!c || !e) return null;
  if (e.art === "lukket") {
    return {
      patch: { status: "Løst", plannerMerke: "lukket", plannerDato: iDag || "",
               plannerLukket: e.tid || "", plannerSist: "ferdig",
               plannerFra: c.status || "Åpen", plannerAv: navn || "",
               endretAv: "Planner", endret: naa || "" },
      svar: { id: plannerSvarId(c.taskId, e.tid), forfatter: "Planner", dato: naa || "",
              endret: "", kilde: "planner",
              tekst: navn ? "Lukket i Planner av " + navn : "Lukket i Planner" }
    };
  }
  if (e.art === "apnet") return { patch: { plannerMerke: "apnet", plannerDato: iDag || "", plannerSist: "apen" } };
  if (e.art === "borte") return { patch: { taskId: undefined, taskUrl: undefined, plannerMerke: "borte",
                                           plannerDato: iDag || "", plannerSist: undefined } };
  if (e.art === "ferdig-stille") {
    const p = { plannerSist: "ferdig", plannerLukket: e.tid || "" };
    if (c.plannerMerke === "apnet") p.plannerMerke = "";   // lukket igjen → merket er ikke sant lenger
    return { patch: p };
  }
  if (e.art === "apen-stille") return { patch: { plannerSist: "apen" } };
  return null;
}

// Skal stripa vises i bobla (og pillen i lista)? «lukket» bare i 7 dager —
// etterpå er det historikk, og den står i tråden. «apnet»/«borte» står til
// noen har trykket en knapp.
export function visMerke(c, iDag) {
  const m = c && c.plannerMerke;
  if (!PLANNER_MERKER.includes(m)) return "";
  if (m !== "lukket") return m;
  const d = Date.parse(String(c.plannerDato || "") + "T00:00:00Z");
  const n = Date.parse(String(iDag || "") + "T00:00:00Z");
  if (!isFinite(d) || !isFinite(n)) return "";
  return (n - d) / 86400000 <= LUKKET_VISES_DAGER ? "lukket" : "";
}

// "2026-10-21T08:40:12.34Z" → "21.10.2026" i norsk tid. Tom inn → "".
export function plannerDatoTekst(iso) {
  const d = new Date(String(iso || ""));
  if (!isFinite(d.getTime())) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }
  return d.toLocaleDateString("no-NO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Oslo" });
}
