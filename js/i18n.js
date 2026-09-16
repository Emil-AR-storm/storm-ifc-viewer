// Språk. Norsk tekst er NØKKELEN og reserven: t("Åpne") slår opp i ordboken og
// gir norsk tilbake hvis oversettelsen mangler eller språket er norsk. Dermed
// kan ingen manglende nøkkel knekke noe – den gir bare norsk tekst.
//
// Tekster med innfylling bruker {0}, {1} …: t("Viser {0} av {1} treff", 50, n).
//
// Statisk HTML merkes med data-i18n (tekstinnhold), data-i18n-title (title) og
// data-i18n-ph (placeholder) – oversettDom() tar dem ved oppstart og språkbytte.
//
// ORDBOKEN LIGGER IKKE HER LENGER. De tre oversettelsene bor i js/sprak/en.js,
// js/sprak/pl.js og js/sprak/lt.js, og hentes med import() først når noen
// faktisk velger språket – se lastSprak() nederst. Før lå alle fire i denne
// fila, som da var 237 kB alle måtte laste ned; montøren som bare leser norsk
// betalte for tre språk han aldri åpner, på én strek dekning.
//
// KONSEKVENSEN Å KJENNE TIL: t() er synkron, mens språkfila hentes
// asynkront. Derfor er setLang() async, og den som bytter språk må vente på
// den før DOM-en tegnes på nytt. Rekker man ikke det, får man norsk tekst –
// aldri tomme strenger eller krasj.
//
// BEVISST IKKE oversatt (data som deles med hele Storm, alltid norsk):
// - Planner-oppgavenes tittel og notat (går til Storms felles tavle)
// - markeringenes lagrede statusverdier ("Åpen"/"Pågår"/"Løst" – vises oversatt)
// - datoformatet i lagrede markeringer (no-NO)
import { S, writePrefs } from "./state.js";

export const SPRAK = [
  ["no", "Norsk"],
  ["en", "English"],
  ["pl", "Polski"],
  ["lt", "Lietuvių"]
];

export function t(nøkkel, ...args) {
  const o = ORDBOK[nøkkel];
  let s = (o && o[S.lang]) || nøkkel;
  for (let i = 0; i < args.length; i++) s = s.split("{" + i + "}").join(args[i]);
  return s;
}

export async function setLang(kode) {
  if (!SPRAK.some(([k]) => k === kode)) kode = "no";
  S.lang = kode;
  writePrefs();
  if (S.syncPrefs) S.syncPrefs();
  // Ordboka må være på plass FØR DOM-en tegnes på nytt, ellers skriver
  // oversettDom() norsk over alt og teksten blir stående sånn til neste
  // tegning. S.lang settes over, altså før ventingen, så alt som bare leser
  // hvilket språk som er valgt (velgerne, lagringen) ser det med en gang.
  await lastSprak(kode);
  // Rakk noen å bytte igjen mens fila lastet, eier det byttet resten.
  if (S.lang !== kode) return;
  oversettDom();
  // ViewCube-flatene er tegnede bilder, ikke DOM – de må males på nytt
  if (S.rebuildCube) S.rebuildCube();
  // ❓ Hjelpekortet bygges av JS (knappen nederst bytter mellom «Neste» og
  // «Ferdig», og en data-i18n der ville blitt overskrevet). Derfor må det
  // tegnes på nytt her, ikke av oversettDom.
  if (S.rebuildHjelp) S.rebuildHjelp();
}

// Oversetter alt som er merket i index.html. Originalteksten (norsk) lagres i
// data-no første gang, så vi alltid kan bytte FRA et annet språk også.
export function oversettDom() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    if (!el.dataset.no) el.dataset.no = el.textContent.trim().replace(/\s+/g, " ");
    el.textContent = t(el.dataset.no);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    if (!el.dataset.noTitle) el.dataset.noTitle = el.getAttribute("title") || "";
    el.setAttribute("title", t(el.dataset.noTitle));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    if (!el.dataset.noPh) el.dataset.noPh = el.getAttribute("placeholder") || "";
    el.setAttribute("placeholder", t(el.dataset.noPh));
  });
}

// ---------- Ordboken ----------
//
// NØKKELEN ER DEN NORSKE TEKSTEN, og verdien er ett objekt per nøkkel:
// ORDBOK["Åpne"] = { en: "Open", pl: "Otwórz", lt: "Atidaryti" }. Norsk står
// ikke i tabellen i det hele tatt – t() gir nøkkelen tilbake når språket er
// norsk eller oversettelsen mangler.
//
// Tabellen starter TOM og fylles etter hvert som språkfiler hentes. Er bare
// engelsk hentet, har hver nøkkel bare .en. Det er med vilje: den som aldri
// bytter språk skal aldri laste ned en eneste oversettelse.
export const ORDBOK = {};

// Én literal import()-linje per språk, aldri en adresse satt sammen av
// variabler. Både verktoy/lag-sw-liste.mjs og nettleseren leser adressene rett
// ut av koden, og en adresse som først finnes når koden kjører er usynlig for
// begge – da havner ordbøkene verken i versjonshashen eller i cachen.
const SPRAKFIL = {
  en: () => import("./sprak/en.js"),
  pl: () => import("./sprak/pl.js"),
  lt: () => import("./sprak/lt.js")
};

const hentet = {};   // språkkode -> løftet som fyller ORDBOK (gjenbrukes)

// Henter ordboka for ett språk. Norsk trenger ingen fil. Kalles av setLang()
// og av oppstarten i js/main.js og js/lett-main.js.
//
// FEILER HENTINGEN – ingen dekning, fila mangler i cachen – logges det og
// løftet løser seg likevel. Da står teksten på norsk, og norsk tekst er alltid
// bedre enn en halvtegnet side. Neste forsøk får prøve på nytt, derfor
// nullstilles hentet[kode] i catch-en.
export function lastSprak(kode) {
  const lag = SPRAKFIL[kode];
  if (!lag) return Promise.resolve();          // "no" og alt ukjent
  if (hentet[kode]) return hentet[kode];
  hentet[kode] = lag().then(m => {
    const d = m.default || {};
    for (const nøkkel in d) {
      const rad = ORDBOK[nøkkel] || (ORDBOK[nøkkel] = {});
      rad[kode] = d[nøkkel];
    }
  }).catch(e => {
    hentet[kode] = null;
    console.warn("Fikk ikke hentet språkfila for " + kode + " – teksten blir stående på norsk.", e);
  });
  return hentet[kode];
}
