// 🔔 VARSELBOKSEN — appens egen erstatning for nettleserens alert().
//
// HVORFOR (Emil 08.10): «varselene skal komme opp i egen varselboks — Storm
// IFC skal kanskje utvikles til å bli en app i stedet for en nettside, og da
// må disse varselene være på plass.» Nettleserens alert() er en grå systemboks
// med nettadressen øverst. Den kan ikke styles, den ser fremmed ut i en app,
// og den stopper hele siden til noen trykker OK — også 3D-tegningen.
//
// Varselet her er en vanlig del av siden:
//   · samme farger og ikoner som panelene (CSS-variabler, mørkt og lyst tema)
//   · blokkerer ingenting — 3D-en og panelene lever videre bak
//   · blir stående til den lukkes (OK, krysset eller Esc), slik alert() gjorde,
//     så en feilmelding ikke forsvinner før den er lest
//   · samme tekst to ganger på rad gir ×2 på det samme kortet i stedet for to
//     like kort oppå hverandre
//
// Ren DOM, ingen andre moduler: den skal kunne brukes fra alle filer — også
// lettsiden (bygg.html) og modulene som lastes før resten av appen.

const MAKS_SYNLIGE = 3;

// Feil får rødt merke, alt annet er en vanlig beskjed. Leses av teksten, så
// de 138 stedene som brukte alert() ikke måtte skrives om én for én.
const FEIL = /klarte ikke|kunne ikke|feil(?:et|en)?\b|feilmelding|mislyktes|ikke tilgang|nektet|error|failed|nie udało|nepavyko|błąd|klaida/i;

export function varselType(tekst) {
  return FEIL.test(String(tekst || "")) ? "feil" : "info";
}

function stabel() {
  let s = document.getElementById("varselStabel");
  if (!s) {
    s = document.createElement("div");
    s.id = "varselStabel";
    s.className = "varsel-stabel";
    // Plassering: øverst (prøve B). På telefonen ligger panelene nederst som
    // ark, så toppen er det stedet varselet ikke dekker knappene man trenger.
    // Byttes til "midt" eller "bunn" her — CSS-en har alle tre.
    s.dataset.stil = "topp";
    document.body.appendChild(s);
  }
  return s;
}

function lukk(kort) {
  if (!kort || !kort.parentNode) return;
  const s = kort.parentNode;
  kort.remove();
  if (!s.children.length) s.classList.remove("har-varsel");
}

// Esc lukker det øverste varselet FØRST, og bare det. Lytteren ligger i
// fangstfasen, så Esc-trappa i ui.js ikke samtidig lukker panelet bak.
let escLagt = false;
function leggEsc() {
  if (escLagt || typeof document === "undefined") return;
  escLagt = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const s = document.getElementById("varselStabel");
    const siste = s && s.lastElementChild;
    if (!siste) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    lukk(siste);
  }, true);
}

// varsel("tekst") — samme bruk som alert(). valg.type: "feil" | "info".
export function varsel(tekst, valg) {
  const melding = String(tekst == null ? "" : tekst);
  // Krok for testene i Node: der finnes ingen skjerm å se varselet på, så
  // testene fanger teksten her i stedet for via alert().
  if (typeof globalThis.__varselTest === "function") globalThis.__varselTest(melding);
  if (typeof document === "undefined" || !document.body) return;
  leggEsc();
  const s = stabel();
  const type = (valg && valg.type) || varselType(melding);

  // samme tekst som det nederste kortet: tell opp i stedet for å stable
  const siste = s.lastElementChild;
  if (siste && siste.dataset.tekst === melding) {
    const n = (Number(siste.dataset.antall) || 1) + 1;
    siste.dataset.antall = String(n);
    const t = siste.querySelector(".varsel-antall");
    if (t) { t.textContent = "×" + n; t.hidden = false; }
    return siste;
  }

  const kort = document.createElement("div");
  kort.className = "varsel-kort varsel-" + type;
  kort.setAttribute("role", type === "feil" ? "alertdialog" : "status");
  kort.setAttribute("aria-live", type === "feil" ? "assertive" : "polite");
  kort.dataset.tekst = melding;
  kort.dataset.antall = "1";
  kort.innerHTML =
    '<svg class="ikon varsel-ikon" aria-hidden="true"><use href="#i-' + (type === "feil" ? "advarsel" : "hjelp") + '"/></svg>' +
    '<div class="varsel-tekst"></div>' +
    '<span class="varsel-antall" hidden></span>' +
    '<button type="button" class="varsel-ok">OK</button>';
  // tekstContent, ikke innerHTML: meldingene kan inneholde filnavn og
  // feiltekster utenfra, og linjeskift beholdes med CSS (pre-line)
  kort.querySelector(".varsel-tekst").textContent = melding;
  kort.querySelector(".varsel-ok").onclick = () => lukk(kort);
  s.appendChild(kort);
  s.classList.add("har-varsel");
  while (s.children.length > MAKS_SYNLIGE) s.firstElementChild.remove();
  // fokus på OK, så Enter lukker — slik alert() oppførte seg
  try { kort.querySelector(".varsel-ok").focus({ preventScroll: true }); } catch (_) {}
  return kort;
}

export function lukkAlleVarsler() {
  const s = typeof document !== "undefined" && document.getElementById("varselStabel");
  if (s) { s.innerHTML = ""; s.classList.remove("har-varsel"); }
}
