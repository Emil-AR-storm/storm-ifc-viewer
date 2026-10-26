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
    hjelp: "Måleverktøy: avstand, kjedemål, vinkel og fall, kote og aksesystem",
    knapper: ["btnMeasure", "btnKjede", "btnVinkel", "btnKote", "btnAxes"] },
  { id: "info",     navn: "Bygg Info",        ikonNavn: "sok",
    hjelp: "Informasjon om bygget: markeringer, mengder, priskalkulasjon, søk, laster, sammenligning og endringsmelding",
    knapper: ["btnMarker", "btnQty", "btnPris", "btnSearch", "btnGrupper", "btnLaster", "btnCompare", "btnEm"] },
  // 🗓 Planlegging (Emil 12.10): Bygg Info hadde 12 knapper og ble rotete.
  // Skillet: Bygg Info er det du LESER av modellen (markeringer, mengder,
  // priser, søk, laster); Planlegging er det du LAGER rundt den — tomta,
  // riggen, støpene, framdriften og været. Snø & Last blir i Bygg Info: det er
  // tall om bygget, ikke om plassen. Byggeplass-siden har bare Framdriftsplan
  // av de fem — samme gruppe der også, så oppbygningen er lik ute og inne.
  { id: "plan",     navn: "Planlegging",      ikonNavn: "framdrift",
    hjelp: "Planlegging av byggeplassen: terreng, rigg, støpeplan, framdriftsplan og vær",
    knapper: ["btnTerreng", "btnRigg", "btnStopeplan", "btnFramdrift", "btnVaer"] },
  { id: "utseende", navn: "Visning",          ikonNavn: "utseende",
    hjelp: "Snitt, etasjer, gjennomsiktig og farger",
    knapper: ["btnClip", "btnStorey", "btnGhost", "btnColors"] },
  { id: "bygg",     navn: "Storm-Byggeplass", ikonNavn: "lastned",
    hjelp: "Ut til byggeplassen: QR-lenke, materiell, SW-generator og deling",
    knapper: ["btnByggeplass", "btnMateriell", "btnSW", "btnTak", "btnShare", "btnHistorikk"] },
  // 📄 Alt som lager en fil å sende videre (Emil 02.09 og 04.09, valgt 30.09:
  // «flytt + snarveier»). Rapport og Lett kopi er FLYTTET hit fra
  // Storm-Byggeplass. Riggplan, SW-tegning og BCF er SNARVEIER: de åpner
  // panelet sitt og trykker den samme knappen der (js/dokumentasjon.js), så
  // målestokk, tittelfelt og sjekkene før nedlasting er de samme.
  { id: "dok",      navn: "Dokumentasjon",    ikonNavn: "tegning",
    hjelp: "Dokumentasjon: rapport, riggplan, SW-tegning, BCF og lett kopi",
    knapper: ["btnRapport", "btnDokStope", "btnDokRigg", "btnDokSW", "btnDokBcf", "btnDokBcfImport", "btnSaveLite"] }
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
  // 📱 Emil 08.10: «når du trykker …Mer får du opp absolutt alle verktøyene
  // i stedet for bare de fra gruppen du er inne på — dette er rotete.»
  // På telefon flytter js/mobile.js de fleste knappene ut av #toolbar og inn
  // i ⋯-menyen (#moreMenu), og der traff ikke gruppereglene, som henger på
  // #toolbar[data-gruppe]. Gruppa settes derfor også på <body>, så CSS-en kan
  // filtrere ⋯-menyen med samme regel — uansett om menyen finnes ennå.
  document.body.dataset.vgruppe = id || "";
  document.querySelectorAll("#verktoygrupper button[data-velg]").forEach(b =>
    b.classList.toggle("active", b.dataset.velg === id));
  merkMerAktiv();          // ligger gruppa under «Mer», er det «Mer» som lyser
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

// 🐞 Emil 12.10: «jeg finner ikke framdriftsplan noe sted i storm-byggeplass
// eller planlegging seksjon». På byggeplassen er Framdriftsplan (og Støpeplan)
// skjult til planen er lastet fra Worker-en — da var Planlegging tom ved
// oppstart, gruppeknappen ble skjult, og den kom aldri tilbake. Nå måles
// gruppene på nytt hver gang en verktøyknapp viser eller skjuler seg selv.
// Gruppefilteret tas midlertidig av under målingen (samme tråd, ingen
// opptegning imellom), så det er knappens EGEN synlighet som telles.
export function oppdaterGruppeknapper() {
  const boks = $("verktoygrupper"), linje = $("toolbar");
  if (!boks || !linje) return [];
  const gammel = linje.dataset.gruppe || "", gammelBody = document.body.dataset.vgruppe || "";
  // 🐞 Emil 12.10 (runde 2): attributtene må FJERNES, ikke settes til "".
  // CSS-regelen «#toolbar[data-gruppe] button[data-gruppe] {display:none}»
  // treffer også en tom verdi — da så ALLE grupper tomme ut, alle
  // gruppeknappene ble skjult, og byggeplassen satt fast i Bygg Info.
  delete linje.dataset.gruppe; delete document.body.dataset.vgruppe;
  let medInnhold;
  try { medInnhold = grupperMedInnhold(knappSynlig); }
  finally { linje.dataset.gruppe = gammel; document.body.dataset.vgruppe = gammelBody; }
  // Sikring: ser ALT tomt ut er det målingen som er feil, ikke verktøyene —
  // da røres ingenting.
  if (!medInnhold.length) return medInnhold;
  boks.querySelectorAll("button[data-velg]").forEach(b => {
    b.style.display = medInnhold.includes(b.dataset.velg) ? "" : "none";
  });
  planleggTilpass();       // en gruppe kom eller forsvant: mål toppbaren på nytt
  // Var den valgte gruppa tom (f.eks. ingen gruppe med innhold ved oppstart),
  // velges en som har innhold nå.
  if (!gammel || !medInnhold.includes(gammel)) {
    const ny = velgStartgruppe(S.settings && S.settings.verktoygruppe, medInnhold);
    if (ny && ny !== gammel) settGruppe(ny);
  }
  return medInnhold;
}

function følgKnapper() {
  const MO = typeof window !== "undefined" && window.MutationObserver;
  if (!MO) return;
  let venter = false;
  const obs = new MO(() => {
    if (venter) return;
    venter = true;
    Promise.resolve().then(() => { venter = false; oppdaterGruppeknapper(); });
  });
  for (const id of alleKjente()) {
    const b = $(id);
    if (b && !ALLTID.includes(id)) obs.observe(b, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
  }
}

// ═══════════════════════ «MER» I TOPPBAREN ═══════════════════════
// 🐞 Emil 20.10: «når PC-vinduet ikke er bredt nok, brekker kategorilinja til
// en ny linje, og den havner BAK verktøylinja» (bare «H» og «:» stakk fram
// mellom Terreng og Rigg). Toppbaren hadde flex-wrap, og #toolbar sto fast på
// top: 52px — uansett hvor høy toppbaren ble.
//
// Nå MÅLES det som faktisk står i toppbaren. Gruppene som ikke får plass på
// første linje, flyttes inn under en «Mer»-knapp på slutten av gruppelinja —
// samme utseende som «Mer» på byggeplassen/telefonen (js/mobile.js).
//
// INGEN GRUPPEKNAPP FJERNES ELLER FLYTTES. De som ikke får plass, får klassen
// `vg-ute` (display: none). Menyen bygges med egne punkter som trykker den
// skjulte originalen med .click() — da går trykket gjennom de samme lytterne
// som før, også låsen i js/tilgang.js (capture på document), og
// `#verktoygrupper button[data-velg]` peker fortsatt på nøyaktig seks knapper.
//
// Sikkerhetsnett: får ikke engang «Mer» plass, vises bare ikonene på Åpne,
// Bibliotek, Lav kvalitet og Hjelp (`topp-trang`). Og brekker linja LIKEVEL
// (veldig smalt vindu, stort språk), følger verktøylinja etter: toppbarens
// faktiske bunn skrives til CSS-variabelen --toppbar-h, og #toolbar står der.
// Telefon (≤ 640 px) har sitt eget opplegg i js/mobile.js: toppbaren ruller
// sidelengs på én linje. Der er «Mer» av, og alle gruppene står som før.

const SMAL = 640;                 // samme grense som js/mobile.js
const STATUS_PLASS = 110;         // så mye «0 elementer · …» får beholde, høyst

// Ren logikk: hvilke grupper får plass? `grupper` = [{ id, w }] i rekkefølge,
// `ledig` = bredden gruppelinja kan bruke. Får alle plass, trengs ingen «Mer».
// Ellers fylles linja forfra til «Mer» ikke lenger får plass bak — rekkefølgen
// holdes, så menyen alltid er «resten av lista».
export function fordelGrupper(grupper, ledig, merBredde, mellomrom) {
  const gap = mellomrom || 0;
  const bredde = (l) => l.reduce((s, g) => s + g.w, 0) + gap * Math.max(0, l.length - 1);
  if (bredde(grupper) <= ledig + 0.5) return { inne: grupper.map(g => g.id), ute: [] };
  const inne = [];
  let brukt = merBredde;
  for (const g of grupper) {
    if (brukt + gap + g.w > ledig + 0.5) break;
    inne.push(g.id); brukt += gap + g.w;
  }
  return { inne, ute: grupper.filter(g => !inne.includes(g.id)).map(g => g.id) };
}

let merÅpen = false;

function merKnapp() { return $("vgMer"); }
function merMeny() { return $("vgMerMeny"); }

function byggMer() {
  const boks = $("verktoygrupper");
  if (!boks || merKnapp()) return;
  const b = document.createElement("button");
  b.id = "vgMer";
  b.type = "button";
  b.className = "vg-mer";
  b.hidden = true;
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-controls", "vgMerMeny");
  // Samme oppbygning som «Mer» i js/mobile.js. data-no: knappen kan bygges
  // etter et språkbytte, og oversettDom() må vite den norske nøkkelen.
  b.innerHTML = ikon("mer") + '<span class="btn-t" data-i18n data-no="Mer">' + esc(t("Mer")) + '</span>';
  b.title = t("Flere verktøygrupper");
  b.setAttribute("data-i18n-title", "");
  b.dataset.noTitle = "Flere verktøygrupper";
  b.addEventListener("click", () => { merÅpen ? lukkMer(false) : åpneMer(false); });
  b.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); åpneMer(true, e.key === "ArrowUp"); }
  });
  boks.appendChild(b);

  // Menyen står i <body>, ikke i toppbaren: den er position: fixed, og en
  // toppbar med overflow (telefon) ville klippet den.
  const m = document.createElement("div");
  m.id = "vgMerMeny";
  m.className = "vg-mer-meny";
  m.setAttribute("role", "menu");
  m.setAttribute("aria-labelledby", "vgMer");
  m.hidden = true;
  m.addEventListener("click", (e) => {
    const p = e.target.closest && e.target.closest("[data-mer-velg]");
    if (!p) return;
    const orig = document.querySelector('#verktoygrupper button[data-velg="' + p.dataset.merVelg + '"]');
    lukkMer(true);
    if (orig) orig.click();          // samme vei som et vanlig trykk (låsen også)
  });
  m.addEventListener("keydown", (e) => {
    const punkter = [...m.querySelectorAll("[role=menuitem]")];
    const i = punkter.indexOf(document.activeElement);
    let ny = -1;
    if (e.key === "ArrowDown") ny = (i + 1) % punkter.length;
    else if (e.key === "ArrowUp") ny = (i - 1 + punkter.length) % punkter.length;
    else if (e.key === "Home") ny = 0;
    else if (e.key === "End") ny = punkter.length - 1;
    else if (e.key === "Tab") { lukkMer(false); return; }
    if (ny >= 0 && punkter[ny]) { e.preventDefault(); punkter[ny].focus(); }
  });
  document.body.appendChild(m);
}

// Punktene bygges hver gang menyen åpnes: da er teksten alltid den samme som
// på originalknappen (språk), og «valgt» og låsen er alltid riktig.
function fyllMeny() {
  const m = merMeny();
  if (!m) return [];
  const ute = [...document.querySelectorAll("#verktoygrupper button[data-velg].vg-ute")];
  m.innerHTML = ute.map(orig => {
    const g = GRUPPER.find(x => x.id === orig.dataset.velg);
    const tekst = (orig.querySelector(".btn-t") || orig).textContent.trim();
    const aktiv = orig.classList.contains("active");
    return '<button type="button" role="menuitem" tabindex="-1" data-mer-velg="' + esc(orig.dataset.velg) + '"' +
      (aktiv ? ' class="active" aria-current="true"' : '') +
      (orig.title ? ' title="' + esc(orig.title) + '"' : '') + '>' +
      ikon(g ? g.ikonNavn : "mer") + '<span class="btn-t">' + esc(tekst) + '</span>' +
      (orig.classList.contains("laast") ? '<span class="laas-ikon" aria-hidden="true">🔒</span>' : '') +
      '</button>';
  }).join("");
  return [...m.querySelectorAll("[role=menuitem]")];
}

function plasserMeny() {
  const m = merMeny(), b = merKnapp();
  if (!m || !b) return;
  const r = b.getBoundingClientRect();
  m.style.top = Math.round(r.bottom + 6) + "px";
  // Venstrekant under knappen, men aldri ut over høyre kant av vinduet
  const bredde = m.offsetWidth || 200;
  const venstre = Math.max(6, Math.min(r.left, window.innerWidth - bredde - 6));
  m.style.left = Math.round(venstre) + "px";
}

export function åpneMer(fokuser, sist) {
  const m = merMeny(), b = merKnapp();
  if (!m || !b || b.hidden) return;
  const punkter = fyllMeny();
  if (!punkter.length) return;
  m.hidden = false;
  merÅpen = true;
  b.setAttribute("aria-expanded", "true");
  b.classList.add("apen");
  plasserMeny();
  if (fokuser) {
    const valgt = punkter.find(p => p.classList.contains("active"));
    (sist ? punkter[punkter.length - 1] : (valgt || punkter[0])).focus();
  }
}

export function lukkMer(fokusTilbake) {
  const m = merMeny(), b = merKnapp();
  if (m) m.hidden = true;
  const varÅpen = merÅpen;
  merÅpen = false;
  if (b) {
    b.setAttribute("aria-expanded", "false");
    b.classList.remove("apen");
    if (fokusTilbake && varÅpen && !b.hidden) b.focus();
  }
}

// «Mer» bærer den valgte gruppa når den ligger der inne — samme stil som en
// valgt gruppeknapp, så det alltid er én markert knapp på linja.
function merkMerAktiv() {
  const b = merKnapp();
  if (!b) return;
  const aktivUte = !!document.querySelector("#verktoygrupper button[data-velg].vg-ute.active");
  b.classList.toggle("active", aktivUte && !b.hidden);
}

function synligIFlyt(el) {
  if (!el || el.hidden) return false;
  const cs = window.getComputedStyle(el);
  return cs.display !== "none" && cs.position !== "fixed" && cs.position !== "absolute";
}

function ytreBredde(el) {
  const cs = window.getComputedStyle(el);
  return el.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
}

// Toppbarens og verktøylinjas faktiske bunn → CSS-variabler. #toolbar,
// innloggingsboksen og «Skjul været» står under dem i stedet for på faste
// 52 / 104 px. (Telefon har egne faste verdier i @media-regelen.)
function oppdaterHøyder() {
  const topp = $("topbar"), linje = $("toolbar");
  const rot = document.documentElement;
  if (topp) {
    const bunn = Math.round(topp.getBoundingClientRect().bottom);
    if (bunn > 0) rot.style.setProperty("--toppbar-h", bunn + "px");
  }
  if (linje && linje.classList.contains("open")) {
    const bunn = Math.round(linje.getBoundingClientRect().bottom);
    if (bunn > 0) rot.style.setProperty("--verktoylinje-bunn", bunn + "px");
  }
}

// Hovedjobben. Alt skjer synkront (ingen opptegning imellom), så det man
// aldri ser er mellomtilstanden der alle gruppene står fram for å bli målt.
export function tilpassToppbar() {
  const topp = $("topbar"), boks = $("verktoygrupper");
  if (!topp || !boks) return;
  if (LETT) { oppdaterHøyder(); return; }     // byggeplassen: uendret, bare høyden følges
  const knapper = [...boks.querySelectorAll("button[data-velg]")];
  const før = knapper.filter(k => k.classList.contains("vg-ute")).map(k => k.dataset.velg).join("|");
  const førTrang = topp.classList.contains("topp-trang");

  // 1. Alt fram: ingen skjult gruppe, ingen «Mer», full tekst
  knapper.forEach(k => k.classList.remove("vg-ute"));
  topp.classList.remove("topp-trang");
  if (merKnapp()) merKnapp().hidden = true;

  const ferdig = () => {
    merkMerAktiv();
    const etter = knapper.filter(k => k.classList.contains("vg-ute")).map(k => k.dataset.velg).join("|");
    if (etter !== før || topp.classList.contains("topp-trang") !== førTrang) lukkMer(false);
    oppdaterHøyder();
  };

  // Telefon, ingen modell (gruppene skjult) eller ingen layout (jsdom): stopp her
  const bredde = topp.clientWidth;
  if (window.innerWidth <= SMAL || !bredde || window.getComputedStyle(boks).display === "none") return ferdig();
  // «Mer» bygges først når det finnes en toppbar å måle (ikke i jsdom)
  byggMer();
  const mer = merKnapp();

  const måle = () => {
    const cs = window.getComputedStyle(topp);
    const innvendig = bredde - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
    const andre = [...topp.children].filter(el => el !== boks && synligIFlyt(el));
    let brukt = 0;
    for (const el of andre) {
      // Statusteksten krymper (ellipse) — den får bare beholde litt
      if (el.id === "status") brukt += Math.min(el.scrollWidth, STATUS_PLASS);
      else brukt += ytreBredde(el);
    }
    brukt += gap * andre.length;          // mellomrom mellom alle elementene inkl. boksen
    const bcs = window.getComputedStyle(boks);
    const ramme = (parseFloat(bcs.paddingLeft) || 0) + (parseFloat(bcs.paddingRight) || 0) +
      (parseFloat(bcs.borderLeftWidth) || 0) + (parseFloat(bcs.borderRightWidth) || 0) +
      (parseFloat(bcs.marginLeft) || 0) + (parseFloat(bcs.marginRight) || 0);
    const indreGap = parseFloat(bcs.columnGap) || parseFloat(bcs.gap) || 0;
    const ledig = innvendig - brukt - ramme - 1;     // 1 px slakk for avrunding
    const grupper = knapper.filter(k => k.style.display !== "none")
      .map(k => ({ id: k.dataset.velg, w: k.getBoundingClientRect().width }));
    mer.hidden = false;
    const merBredde = mer.getBoundingClientRect().width;
    mer.hidden = true;
    return { ledig, grupper, merBredde, indreGap };
  };

  let m = måle();
  if (!m.grupper.length) return ferdig();
  let fordeling = fordelGrupper(m.grupper, m.ledig, m.merBredde, m.indreGap);
  if (fordeling.ute.length && m.ledig < m.merBredde) {
    // Ikke engang «Mer» får plass: bare ikoner på de andre toppknappene
    topp.classList.add("topp-trang");
    m = måle();
    fordeling = fordelGrupper(m.grupper, m.ledig, m.merBredde, m.indreGap);
  }
  if (fordeling.ute.length) {
    knapper.forEach(k => k.classList.toggle("vg-ute", fordeling.ute.includes(k.dataset.velg)));
    mer.hidden = false;
  }
  ferdig();
}

let tilpassVenter = false;
function planleggTilpass() {
  if (tilpassVenter) return;
  tilpassVenter = true;
  const kjør = () => { tilpassVenter = false; try { tilpassToppbar(); } catch (err) { console.error(err); } };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(kjør);
  else setTimeout(kjør, 16);
}

function følgToppbar() {
  const topp = $("topbar");
  if (!topp) return;
  window.addEventListener("resize", planleggTilpass);
  // Størrelsen på HVER knapp følges: språkbytte, Admin/Gratisversjon som
  // dukker opp, tallet på markeringer og statusteksten endrer bredden på
  // barna uten at toppbaren nødvendigvis endrer seg.
  const RO = window.ResizeObserver;
  let ro = null;
  if (RO) {
    ro = new RO(() => planleggTilpass());
    ro.observe(topp);
    [...topp.children].forEach(el => ro.observe(el));
    const linje = $("toolbar");
    if (linje) ro.observe(linje);
  }
  const MO = window.MutationObserver;
  if (MO) {
    // Nye knapper (Admin, Gratisversjon) og tekst som byttes (språk)
    new MO((liste) => {
      if (ro) liste.forEach(l => l.addedNodes && l.addedNodes.forEach(n => { if (n.nodeType === 1 && n.parentNode === topp) ro.observe(n); }));
      planleggTilpass();
    }).observe(topp, { childList: true, subtree: true, characterData: true });
    // har-modell på <body> viser gruppene; «open» på #toolbar endrer bunnen
    new MO(planleggTilpass).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const linje = $("toolbar");
    if (linje) new MO(planleggTilpass).observe(linje, { attributes: true, attributeFilter: ["class"] });
  }
  // Skrifta kan komme etter første måling
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(planleggTilpass).catch(() => {});

  // Lukk menyen: trykk utenfor og Esc
  document.addEventListener("pointerdown", (e) => {
    if (!merÅpen) return;
    const m = merMeny(), b = merKnapp();
    if ((m && m.contains(e.target)) || (b && b.contains(e.target))) return;
    lukkMer(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (merÅpen && e.key === "Escape") { e.preventDefault(); lukkMer(true); }
  });
  window.addEventListener("resize", () => { if (merÅpen) lukkMer(false); });
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
  følgKnapper();
  følgToppbar();
  planleggTilpass();
}

start();
