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
//   · FEIL blir stående til den lukkes (OK eller Esc), så en feilmelding
//     ikke forsvinner før den er lest
//   · INFO forsvinner av seg selv etter ~4 s (lengre tekst får litt lengre
//     tid, maks 10 s). Musa over kortet eller fokus i det holder det oppe.
//     (Emil 02.11, forslag 4: «info-varsler blir stående og legger seg over
//     verktøylinja»)
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

// Hvor lenge et info-varsel står: 4 s, + 40 ms per tegn over 80, maks 10 s.
export function infoTid(tekst) {
  const n = String(tekst || "").length;
  return Math.min(10000, 4000 + Math.max(0, n - 80) * 40);
}

function lukk(kort) {
  if (!kort) return;
  if (kort._tid) { clearTimeout(kort._tid); kort._tid = null; }
  if (!kort.parentNode) return;
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
//
// 👁 valg.vis (forslag 10A, Emil 03.11): beskjeder som handler om noe bestemt
// får en «Vis»-knapp ved siden av OK.
//   valg.vis = () => …                 → «Vis» går rett dit
//   valg.vis = [{ tekst, gaa }, …]     → én ting: «Vis» går rett dit;
//                                         flere: «Vis» åpner en nedtrekksliste
//                                         med egen «Vis» per linje (som 10C)
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
    if (siste._start) siste._start();   // ny telling: klokka starter på nytt
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
  leggTilVis(kort, valg && valg.vis, (valg && valg.visTekst) || "Vis");
  s.appendChild(kort);
  s.classList.add("har-varsel");
  while (s.children.length > MAKS_SYNLIGE) lukk(s.firstElementChild);
  if (type === "feil") {
    // fokus på OK, så Enter lukker — slik alert() oppførte seg. Bare for
    // feil: et info-kort som tar fokus og så forsvinner, ville sendt fokus
    // ut i løse lufta midt i arbeidet.
    try { kort.querySelector(".varsel-ok").focus({ preventScroll: true }); } catch (_) {}
  } else {
    autoLukk(kort, melding);
  }
  return kort;
}

// Info-kortet lukker seg selv. Musa over / fokus inni stopper klokka; når
// musa går ut, får det hele tiden på nytt (så det ikke forsvinner idet man
// flytter blikket tilbake).
function autoLukk(kort, melding) {
  // Et kort med «Vis» står litt lenger: man skal rekke å bestemme seg
  const tid = kort.dataset.vis ? Math.max(8000, infoTid(melding)) : infoTid(melding);
  kort.dataset.auto = String(tid);
  const stopp = () => { if (kort._tid) { clearTimeout(kort._tid); kort._tid = null; } };
  const start = () => {
    stopp();
    if (kort.matches && (kort.matches(":hover") || kort.contains(document.activeElement))) return;
    if (kort.querySelector(".varsel-liste")) return;   // nedtrekkslista er åpen
    kort._tid = setTimeout(() => lukk(kort), tid);
    // I Node (testene) skal ikke en ventende lukking holde prosessen i live.
    if (kort._tid && typeof kort._tid.unref === "function") kort._tid.unref();
  };
  kort._start = start;
  kort.addEventListener("mouseenter", stopp);
  kort.addEventListener("focusin", stopp);
  kort.addEventListener("mouseleave", start);
  kort.addEventListener("focusout", () => setTimeout(() => { if (!kort.contains(document.activeElement)) start(); }, 0));
  start();
}

// ---------- 👁 «Vis» (forslag 10A + nedtrekksliste) ----------
function vasketVis(vis) {
  if (typeof vis === "function") return [{ tekst: "", gaa: vis }];
  return (Array.isArray(vis) ? vis : []).filter(x => x && typeof x.gaa === "function").slice(0, 30);
}
function leggTilVis(kort, vis, visTekst) {
  const liste = vasketVis(vis);
  if (!liste.length) return;
  const okKnapp = kort.querySelector(".varsel-ok");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "varsel-vis";
  b.textContent = visTekst + (liste.length > 1 ? " (" + liste.length + ") ▾" : "");
  kort.insertBefore(b, okKnapp);
  kort.dataset.vis = String(liste.length);
  const gaa = (x) => { lukk(kort); try { x.gaa(); } catch (err) { console.error(err); } };
  if (liste.length === 1) { b.onclick = () => gaa(liste[0]); return; }
  b.setAttribute("aria-expanded", "false");
  b.onclick = () => {
    let ned = kort.querySelector(".varsel-liste");
    if (ned) { ned.remove(); b.setAttribute("aria-expanded", "false"); if (kort._start) kort._start(); return; }
    ned = document.createElement("div");
    ned.className = "varsel-liste";
    for (const x of liste) {
      const rad = document.createElement("div");
      rad.className = "varsel-liste-rad";
      const tx = document.createElement("span");
      tx.textContent = x.tekst || "";
      const v = document.createElement("button");
      v.type = "button";
      v.className = "varsel-liste-vis";
      v.textContent = visTekst;
      v.onclick = () => gaa(x);
      rad.append(tx, v);
      ned.appendChild(rad);
    }
    kort.appendChild(ned);
    b.setAttribute("aria-expanded", "true");
    // Lista er åpen: kortet blir stående til man har valgt eller lukker
    if (kort._tid) { clearTimeout(kort._tid); kort._tid = null; }
  };
}

export function lukkAlleVarsler() {
  const s = typeof document !== "undefined" && document.getElementById("varselStabel");
  if (s) { for (const k of [...s.children]) if (k._tid) clearTimeout(k._tid); s.innerHTML = ""; s.classList.remove("har-varsel"); }
}
