// ❓ SPØRSMÅLET DER DU TRYKKET — appens erstatning for confirm() og prompt().
//
// HVORFOR (Emil 03.11, forslag 1, valgt 1C): nettleserens confirm()/prompt()
// er grå systemvinduer med nettadressen øverst. De stopper hele siden (også
// 3D-en), kan ikke styles, og ser fremmede ut i en app. Ca. 70 steder brukte dem.
//
// SLIK SER DET UT
//   · Trykket du på en knapp i et panel, står spørsmålet RETT UNDER raden med
//     knappen: «Slette trinnet? [Ja, slett] [Avbryt]». Ingen boks som spretter
//     opp midt på skjermen.
//   · Kom spørsmålet fra et sted uten panel (verktøylinja, 3D-boblene,
//     adminpanelet, lasting av modell), vises det samme spørsmålet som et kort
//     øverst på skjermen (Emils valg 03.11: «Kort øverst»).
//   · Farlige valg (slett, fjern, nullstill …) har rød knapp, og fokus står på
//     Avbryt — Enter gjør da det trygge.
//   · Esc = Avbryt. Bygges panelet om mens spørsmålet står (synk, ny tegning),
//     regnes det som Avbryt — ingenting gjøres uten et klart ja.
//
// BRUK (alltid med await — svaret kommer når brukeren har trykket):
//   if (!(await bekreft(t("Slette «{0}»?", navn)))) return;
//   const navn = await spor(t("Navn på snittet:"), "Snitt 1");   // null = Avbryt
//
// I TESTENE (jsdom) finnes ingen som kan trykke. Der brukes teststubben
// global.confirm / global.prompt slik testene alltid har gjort, så de kan
// styre svaret.
import { t } from "./i18n.js";

// Node (testene) har process.versions.node; en nettleser har ikke process i det hele tatt.
const erTest = () => !globalThis.__sporsmalEkte && (typeof process !== "undefined" && !!(process.versions && process.versions.node)) ||
  (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || ""));

// Farlig = rød knapp, fokus på Avbryt. Leses av teksten, slik varsel.js leser feil.
const FARE = /^(slette|fjerne|nullstille|sperre|avvise|avslutte|erstatte|skrive over|kreve|lage ny|bytte til firkant|ta alt|ta alle)|skrives over|kan ikke angres|for godt/i;
export function erFarlig(tekst) { return FARE.test(String(tekst || "").trim()); }

// «Ja»-knappen sier hva som skjer, ikke bare «OK».
const JA = [
  [/^slette/i, "Ja, slett"], [/^fjerne/i, "Ja, fjern"], [/^nullstille/i, "Ja, nullstill"],
  [/^sperre/i, "Ja, sperr"], [/^avvise/i, "Ja, avvis"], [/^avslutte/i, "Ja, avslutt"],
  [/^erstatte/i, "Ja, erstatt"], [/skrive over|skrives over/i, "Ja, skriv over"],
  [/^lage ny/i, "Ja, lag ny"], [/^ta (alt|alle)/i, "Ja, ta ut"]
];
export function jaTekst(tekst) {
  const s = String(tekst || "").trim();
  for (const [re, n] of JA) if (re.test(s)) return t(n);
  return t("Ja");
}

// ---------- Hvor ble det trykket? ----------
// Siste trykk huskes i fangstfasen, før knappens egen lytter kjører. Safari
// gir ikke knapper fokus ved klikk, så document.activeElement holder ikke.
let sisteTrykk = null, sisteTid = 0;
const KLIKKBAR = "button, [role=button], input, select, summary, a, label";
if (typeof document !== "undefined") {
  const husk = (e) => {
    const el = e.target && e.target.closest ? e.target.closest(KLIKKBAR) : null;
    if (el) { sisteTrykk = el; sisteTid = Date.now(); }
  };
  document.addEventListener("pointerdown", husk, true);
  document.addEventListener("click", husk, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") husk(e); }, true);
}

// Steder der spørsmålet kan stå inne i siden. Utenfor disse: kort øverst.
const INNE = ".panel, #setMenu, #rapMeny, .bp-innboks, .sj-boks, .fdv-gruppe";
// Raden spørsmålet legges under
const RAD = ".st-rad, .st-knapper, .prop-actions, .lag-knapper, .set-row, .qty-row, .fp-rad, .pk-rad, li";

function finnAnker(valg) {
  const a = (valg && valg.anker) || ((Date.now() - sisteTid < 2500) ? sisteTrykk : null);
  if (!a || !a.isConnected || !a.closest || !a.closest(INNE)) return null;
  return a;
}

// ---------- Selve boksen ----------
let aktiv = null;   // { boks, ferdig } — bare ett spørsmål om gangen

function lag(tekst, felt, valg) {
  return new Promise((svar) => {
    if (aktiv) aktiv.avbryt();    // et nytt spørsmål avbryter det gamle

    const fare = valg && typeof valg.fare === "boolean" ? valg.fare : (!felt && erFarlig(tekst));
    const anker = finnAnker(valg);
    const boks = document.createElement("div");
    boks.className = "spor-boks" + (fare ? " fare" : "") + (anker ? " inne" : " flytende");
    boks.setAttribute("role", "alertdialog");
    boks.innerHTML =
      '<div class="spor-tekst"></div>' +
      (felt ? '<input type="text" class="spor-felt">' : "") +
      '<div class="spor-knapper"><button type="button" class="spor-ja' + (fare ? " fare" : " primary") + '"></button>' +
      '<button type="button" class="spor-nei"></button></div>';
    boks.querySelector(".spor-tekst").textContent = String(tekst == null ? "" : tekst);
    const ja = boks.querySelector(".spor-ja"), nei = boks.querySelector(".spor-nei");
    ja.textContent = (valg && valg.ja) || (felt ? t("Lagre") : jaTekst(tekst));
    nei.textContent = t("Avbryt");
    const inp = boks.querySelector(".spor-felt");
    if (inp) inp.value = felt.standard == null ? "" : String(felt.standard);

    let vakt = 0;
    const ferdig = (v) => {
      if (!aktiv || aktiv.boks !== boks) return;
      aktiv = null;
      clearTimeout(vakt);
      window.removeEventListener("keydown", tast, true);
      boks.remove();
      // Fokus tilbake til knappen det ble trykket på, så tastaturet ikke mister plassen
      if (anker && anker.isConnected && anker.focus) { try { anker.focus({ preventScroll: true }); } catch (_) {} }
      svar(v);
    };
    const tast = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); ferdig(felt ? null : false); }
      else if (e.key === "Enter" && inp && document.activeElement === inp) { e.preventDefault(); ferdig(inp.value); }
    };
    ja.onclick = () => ferdig(felt ? (inp ? inp.value : "") : true);
    nei.onclick = () => ferdig(felt ? null : false);
    aktiv = { boks, ferdig, avbryt: () => ferdig(felt ? null : false) };

    if (anker) {
      const rad = (anker.closest(RAD) && anker.closest(INNE).contains(anker.closest(RAD))) ? anker.closest(RAD) : anker;
      rad.insertAdjacentElement("afterend", boks);
    } else {
      let stabel = document.getElementById("sporStabel");
      if (!stabel) { stabel = document.createElement("div"); stabel.id = "sporStabel"; stabel.className = "spor-stabel"; document.body.appendChild(stabel); }
      stabel.appendChild(boks);
    }
    // På window (ikke document): da kommer spørsmålet FØR varselboksens og
    // Esc-trappas lyttere, så Esc avbryter spørsmålet først.
    window.addEventListener("keydown", tast, true);
    // Bygges panelet om mens spørsmålet står, forsvinner boksen med det — da
    // er svaret «Avbryt», og den som venter får vite det.
    // (setTimeout i kjede, ikke setInterval: testene gjør alle setInterval
    // «svake», og da ville Node avsluttet mens spørsmålet fortsatt sto.)
    const sjekk = () => {
      if (!aktiv || aktiv.boks !== boks) return;
      if (!boks.isConnected) { aktiv = null; window.removeEventListener("keydown", tast, true); svar(felt ? null : false); return; }
      vakt = setTimeout(sjekk, 400);
    };
    vakt = setTimeout(sjekk, 400);
    try { boks.scrollIntoView({ block: "nearest" }); } catch (_) {}
    try {
      if (inp) { inp.focus({ preventScroll: true }); inp.select(); }
      else (fare ? nei : ja).focus({ preventScroll: true });
    } catch (_) {}
  });
}

// Ja/Avbryt. → Promise<boolean>. valg: { ja: "knappetekst", fare: true|false, anker: element }
export function bekreft(tekst, valg) {
  if (erTest() && typeof globalThis.confirm === "function") return Promise.resolve(!!globalThis.confirm(tekst));
  if (typeof document === "undefined" || !document.body) return Promise.resolve(false);
  return lag(tekst, null, valg);
}

// Tekstfelt. → Promise<string|null> (null = Avbryt), som prompt().
export function spor(tekst, standard, valg) {
  if (erTest() && typeof globalThis.prompt === "function") return Promise.resolve(globalThis.prompt(tekst, standard));
  if (typeof document === "undefined" || !document.body) return Promise.resolve(null);
  return lag(tekst, { standard }, valg);
}

// Står det et spørsmål åpent nå? (testene og Esc-trappa i ui.js)
export function sporsmalApent() { return !!aktiv; }
