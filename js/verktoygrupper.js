// 🧰 Verktøygrupper. Verktøylinja hadde 18 knapper på én rad. Nå ligger fire
// gruppeknapper i toppbaren — Mål, Info, Storm-Byggeplass, Utseende — og
// verktøylinja viser bare verktøyene i gruppa du har valgt.
//
// TRE TING SOM STYRER LØSNINGEN:
//
// 1. INGEN KNAPPER FJERNES. Grupperingen skjer med et `data-gruppe`-attributt
//    og CSS, akkurat som lettmodus skjuler knapper i bygg.html. En knapp som
//    fjernes fra DOM-en mister lytterne sine, og hurtigtastene i ui.js slår
//    opp knappene med $() — de ville sluttet å virke uten et eneste synlig
//    feilsymptom.
//
// 2. GRUPPEKNAPPENE BYGGES I JS, ikke i HTML. index.html og bygg.html har hver
//    sin toppbar, og to nesten like blokker HTML som må holdes i takt er en
//    feil som venter på å skje. Knappene får `data-i18n`, så oversettDom()
//    tar dem ved oppstart og språkbytte som alt annet.
//
// 3. EN TOM GRUPPE SKJULES. I bygg.html er Rapport, Lett kopi og Sammenlign
//    skjult i lettmodus, og Byggeplass finnes ikke. En gruppeknapp som åpner
//    en tom rad er verre enn en rotete linje: den ser ut som en feil.
import { $, S, esc, ikon, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";

// Rekkefølgen her er rekkefølgen i toppbaren.
// `navn` er også i18n-nøkkelen. «Info» het bare det fram til 18.08.2026 — det
// ble lest som «informasjon om verktøyet», altså hjelp, av den som ikke visste
// bedre. «Bygg Info» sier hva det faktisk er: informasjon om BYGGET.
// `hjelp` er forklaringsteksten som vises når man holder musepekeren over.
export const GRUPPER = [
  // «Måleverktøy» og «Visning», ikke «Mål» og «Utseende»: gruppene het det
  // samme som verktøy INNE i gruppa (Mål-knappen og Utseende-panelet), og da
  // kunne ingen si «trykk på Mål» uten å måtte forklare hvilken (Emil 31.08).
  { id: "mal",      navn: "Måleverktøy",      ikonNavn: "maal",
    hjelp: "Måleverktøy: avstand, kote og aksesystem",
    knapper: ["btnMeasure", "btnKote", "btnAxes"] },
  { id: "info",     navn: "Bygg Info",        ikonNavn: "sok",
    hjelp: "Informasjon om bygget: markeringer, mengder, søk og sammenligning",
    knapper: ["btnMarker", "btnQty", "btnSearch", "btnGrupper", "btnCompare"] },
  { id: "utseende", navn: "Visning",          ikonNavn: "utseende",
    hjelp: "Snitt, etasjer, gjennomsiktig og farger",
    knapper: ["btnClip", "btnStorey", "btnGhost", "btnColors"] },
  { id: "bygg",     navn: "Storm-Byggeplass", ikonNavn: "lastned",
    hjelp: "Ut til byggeplassen: QR-lenke, rapport, lett kopi og deling",
    knapper: ["btnByggeplass", "btnMateriell", "btnRapport", "btnSaveLite", "btnShare", "btnHistorikk"] }
];

// Knapper som står uansett hvilken gruppe som er valgt. Angre, Gjenopprett og
// Vis alle styres allerede av JS med inline display — de skal ikke også styres
// av grupperingen, ellers slåss to mekanismer om samme knapp.
export const ALLTID = ["btnHjul", "btnSettings", "btnAngre", "btnGjenopprett", "btnShowAll"];

export const STANDARD_GRUPPE = "info";

// ═══════════════════════ REN LOGIKK ═══════════════════════

export function gruppeFor(knappId) {
  const g = GRUPPER.find(g => g.knapper.includes(knappId));
  return g ? g.id : "";
}

export function gyldigGruppe(id) {
  return GRUPPER.some(g => g.id === id) ? id : STANDARD_GRUPPE;
}

// Alle knapp-id-er vi kjenner. Brukes av testen til å fange en knapp som
// hverken har fått en gruppe eller står i ALLTID — da ville den blitt usynlig
// i alle grupper, og ingen ville oppdaget det før noen lette etter verktøyet.
export function alleKjente() {
  return GRUPPER.reduce((ut, g) => ut.concat(g.knapper), []).concat(ALLTID);
}

// Hvilke grupper har minst én synlig knapp? `erSynlig` sendes inn, så
// funksjonen kan testes uten DOM.
export function grupperMedInnhold(erSynlig) {
  return GRUPPER.filter(g => g.knapper.some(id => erSynlig(id))).map(g => g.id);
}

// Hvilken gruppe skal vises? Den huskede hvis den finnes og har innhold,
// ellers den første som har innhold, ellers "".
export function velgStartgruppe(husket, medInnhold) {
  if (husket && medInnhold.includes(husket)) return husket;
  if (medInnhold.includes(STANDARD_GRUPPE)) return STANDARD_GRUPPE;
  return medInnhold[0] || "";
}

// ═══════════════════════ NETTLESER ═══════════════════════

// Merker verktøyknappene. Kjøres én gang: attributtet er det CSS-en henger på.
export function merkKnapper(rot) {
  const doc = rot || document;
  for (const g of GRUPPER) {
    for (const id of g.knapper) {
      const b = doc.getElementById(id);
      if (b) b.dataset.gruppe = g.id;
    }
  }
  for (const id of ALLTID) {
    const b = doc.getElementById(id);
    if (b) b.dataset.alltid = "1";
  }
}

// En knapp regnes som synlig hvis den ikke er skjult av CSS (lettmodus) eller
// av inline display. Vi ser bort fra vår egen gruppeskjuling ved å lese
// attributtet, ikke den beregnede stilen for gruppen.
export function knappSynlig(id) {
  const b = $(id);
  if (!b) return false;
  if (b.style && b.style.display === "none") return false;
  try {
    // Måles FØR gruppen settes, mens alle knapper er synlige.
    return window.getComputedStyle(b).display !== "none";
  } catch (_) { return true; }
}

export function settGruppe(id) {
  const linje = $("toolbar");
  if (!linje) return;
  linje.dataset.gruppe = id || "";
  document.querySelectorAll("#verktoygrupper button[data-velg]").forEach(b =>
    b.classList.toggle("active", b.dataset.velg === id));
  S.settings.verktoygruppe = id || "";
  writePrefs();
}

export function byggGruppeknapper(medInnhold) {
  const topp = $("topbar");
  if (!topp || $("verktoygrupper")) return;
  const boks = document.createElement("span");
  boks.id = "verktoygrupper";
  // Forklaringsteksten legges bare på i kontorutgaven. En title vises når man
  // holder MUSEPEKEREN over — den finnes ikke på en telefon, og i bygg.html
  // ville den vært ren vekt. Der er det hjelpekortene som forklarer.
  boks.innerHTML = GRUPPER.map(g =>
    '<button data-velg="' + g.id + '"' +
    (medInnhold.includes(g.id) ? "" : ' style="display:none"') +
    (LETT || !g.hjelp ? "" : ' title="' + esc(t(g.hjelp)) + '" data-i18n-title') + '>' +
    ikon(g.ikonNavn) + '<span class="btn-t" data-i18n>' + g.navn + '</span></button>').join("");
  // Etter «Lav kvalitet», før markeringstelleren — der Emil ba om dem.
  const etter = $("btnLight") || $("btnLib");
  if (etter && etter.parentNode === topp) topp.insertBefore(boks, etter.nextSibling);
  else topp.appendChild(boks);

  boks.querySelectorAll("button[data-velg]").forEach(b =>
    b.addEventListener("click", () => settGruppe(b.dataset.velg)));
}

export function start() {
  if (!$("toolbar")) return;
  merkKnapper();
  // Synligheten MÅ måles før første settGruppe(), mens alle knapper står
  // ugruppert. Etterpå er de fleste skjult av vår egen CSS, og alle grupper
  // ville sett tomme ut.
  const medInnhold = grupperMedInnhold(knappSynlig);
  byggGruppeknapper(medInnhold);
  settGruppe(velgStartgruppe(S.settings && S.settings.verktoygruppe, medInnhold));
}

start();
