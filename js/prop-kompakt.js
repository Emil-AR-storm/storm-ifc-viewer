// 📋 Egenskapspanelet på byggeplass-siden: først bare NAVNET, resten på trykk.
//
// Emil 30.09.2026 (skjermbilde fra telefonen): et trykk på en bjelke åpnet
// panelet over halve skjermen med ExpressID, arealer og volum — montøren
// mistet modellen han sto og så på, og det han ville vite var bare hva det
// var. Nå kommer panelet med type og navn øverst og en stram liste under som
// viser tre rader om gangen og rulles inni vinduet. (Først var lista lagt
// sammen bak en pil — Emil ba om å fjerne det i runde 1h.)
//
// HVORFOR EN VAKT PÅ PANELET, OG IKKE ENDRINGER I HVER SOM ÅPNER DET:
// propPanel fylles fra tre steder (elements.js for modellen, sw-lett.js for
// SW-elementene, flervalget i elements.js). En MutationObserver ser hver gang
// panelet åpnes eller får nytt innhold, og legger det sammen igjen — da virker
// det likt for alle, også for noe som kommer til senere.
//
// Bare byggeplass-siden (importeres av lett-main.js). Kontoret har mus og stor
// skjerm, og der er det nettopp hele lista prosjektlederen er ute etter.
import { $ } from "./state.js";
import { t } from "./i18n.js";

// «CFSHS (EN 10219-2):CFSHS100x6:241447» → «CFSHS100x6». Revit/Tekla skriver
// Familie:Type:Id; det montøren kjenner igjen er typen i midten. Uten kolon
// (eller når siste ledd ikke er et Id) brukes navnet som det er.
export function kortNavn(navn) {
  const s = String(navn || "").trim();
  if (!s) return "";
  const d = s.split(":").map(x => x.trim()).filter(Boolean);
  if (d.length >= 3 && /^\d+$/.test(d[d.length - 1])) return d[d.length - 2];
  if (d.length === 2 && /^\d+$/.test(d[1])) return d[0];
  return s;
}

// Navnet står i raden «Name» (modellen) — finnes den ikke (SW-elementer,
// flervalg), er tittelen alene nok: der ER tittelen navnet («SW-03»).
export function navnFraPanel(body) {
  if (!body) return "";
  // En rad merket data-navn (materiell, takplater) ER navnet — ingen forkorting.
  const merket = body.querySelector(".prop-row[data-navn] .v");
  if (merket) return merket.textContent.trim();
  for (const r of body.querySelectorAll(".prop-row")) {
    const k = r.querySelector(".k"), v = r.querySelector(".v");
    if (k && v && k.textContent.trim() === "Name") return kortNavn(v.textContent);
  }
  return "";
}

// 📏 Emil 30.09 (runde 1f): den åpne lista viser TRE rader om gangen, resten
// rulles fram inni vinduet. Høyden regnes av de faktiske radene (en rad kan
// brekke over to linjer), ikke av et fast tall — da er det alltid tre hele
// rader, uansett skrift, språk og hvor lange verdiene er.
export const SYNLIGE_RADER = 3;
export function hoydeForRader(body, antall) {
  if (!body) return 0;
  const rader = [...body.querySelectorAll(".prop-row")].filter(r => !r.classList.contains("skjult-bygg"));
  const knapper = body.querySelector(".prop-actions");
  let h = 0;
  if (knapper) {
    const cs = window.getComputedStyle(knapper);
    h += knapper.offsetHeight + (parseFloat(cs.marginBottom) || 0);
  }
  for (const r of rader.slice(0, antall)) h += r.offsetHeight;
  if (!h) return 0;                       // ikke tegnet ennå (eller jsdom) — la CSS styre
  const cs = window.getComputedStyle(body);
  return Math.ceil(h + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0));
}

export function settUtvidet(panel, paa) {
  if (!panel) return;
  panel.classList.toggle("utvidet", !!paa);
  const body = $("propBody");
  if (body) {
    body.style.maxHeight = "";
    if (paa) {
      const h = hoydeForRader(body, SYNLIGE_RADER);
      if (h > 0) body.style.maxHeight = h + "px";
      const flere = body.querySelectorAll(".prop-row:not(.skjult-bygg)").length > SYNLIGE_RADER;
      body.classList.toggle("kan-rulle", flere);
    }
  }
  const knapp = $("propUtvid");
  if (knapp) {
    knapp.setAttribute("aria-expanded", paa ? "true" : "false");
    const tekst = paa ? t("Vis mindre") : t("Vis alle egenskaper");
    knapp.title = tekst;
    knapp.setAttribute("aria-label", tekst);
  }
}

// ExpressID er et internt løpenummer i IFC-fila. Montøren har ingen bruk for
// det, og det er én rad mindre å lese forbi på en liten skjerm.
// «Name» står allerede øverst (kortnavnet i stripa) — Emil 30.09 (1i): ta den
// bort fra lista. Raden blir liggende skjult, for navnFraPanel leser navnet
// derfra.
const SKJUL_RADER = ["ExpressID", "Name"];

function legg(panel) {
  const body = $("propBody");
  const navn = $("propNavn");
  if (navn) navn.textContent = navnFraPanel(body);
  if (body) body.querySelectorAll(".prop-row").forEach(r => {
    const k = r.querySelector(".k");
    if (k && SKJUL_RADER.includes(k.textContent.trim())) r.classList.add("skjult-bygg");
  });
  // 1h (Emil 30.09): «fjern at vinduet må trykkes på for å åpne og lukke —
  // det går fint at det kommer opp nå som vinduet er så lite». Med tre rader
  // og rulling (1f) er lista liten nok til å stå åpen med en gang.
  settUtvidet(panel, true);
}

export function start() {
  const panel = $("propPanel"), body = $("propBody");
  // window.MutationObserver, ikke den globale: testene kjører i Node med
  // jsdom, og der finnes den bare på vinduet.
  const MO = typeof window !== "undefined" && window.MutationObserver;
  if (!panel || !body || !MO) return false;
  panel.classList.add("kompakt");
  // Åpnes panelet, eller får det nytt innhold (trykk på et annet objekt mens
  // det står åpent), legges det sammen og navnet skrives på nytt.
  let varApen = panel.classList.contains("open");
  new MO(() => {
    const apen = panel.classList.contains("open");
    if (apen && !varApen) legg(panel);
    varApen = apen;
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  new MO(() => { if (panel.classList.contains("open")) legg(panel); })
    .observe(body, { childList: true });
  // Pila — og hele stripa, som er et større mål for en tommel med hanske.
  // Krysset lukker som før (egen onclick i HTML-en); det skal ikke også vekse.
  // Ingen pil og ingen trykk på stripa lenger (1h): lista står alltid åpen.
  // Pila står i HTML-en (knapper skjules, fjernes aldri) og skjules i CSS.
  return true;
}

start();
