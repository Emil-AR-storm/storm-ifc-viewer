// ✨ «NYTT I STORM IFC» (Emils valg 10A, 05.11).
//
// Et kort midt på skjermen ÉN gang etter at selve nettsiden har fått nye
// funksjoner — ikke når en modell oppdateres. Lukkes med «Ok, skjønner» og
// vises ikke igjen før neste oppdatering.
//
// SLIK LEGGES NOE NYTT INN: legg en ny post ØVERST i NYHETER med en ny id
// (dato), og skriv 2–4 korte linjer for kontoret og/eller byggeplassen. Hver
// linje er en norsk nøkkel som oversettes i js/sprak/ som all annen tekst.
//
// Den som åpner Storm IFC for første gang får IKKE kortet (alt er nytt for
// dem); id-en lagres bare, så neste oppdatering vises som vanlig. Kortet
// kommer når en modell er åpnet, ikke over startskjermen og kodefeltet.
//
// Begge sider (main.js og lett-main.js). Ingen andre moduler enn state/i18n.
import { S, esc } from "./state.js";
import { t } from "./i18n.js";

export const NYHETER = [
  {
    id: "2026-11-05",
    dato: "05.11.2026",
    kontor: [
      "Filter i markeringslista: Mine, Ikke løst, Frist denne uka og Fra byggeplassen",
      "Tomme verktøy forklarer hvordan du kommer i gang"
    ],
    bygg: [
      "Modellen åpnes i Enkel: bare modellen og de viktigste verktøyene. «Full» gir alt",
      "Velg etasje rett under verktøylinja"
    ]
  }
];

const NOKKEL = "storm-nytt-sett";

// Hvilken post skal vises? sett = id-en som er lest, harBrukt = har denne
// nettleseren brukt Storm IFC før. → posten, eller null.
export function nyttAVise(nyheter, sett, harBrukt, side) {
  const nyeste = nyheter && nyheter[0];
  if (!nyeste) return null;
  if (!sett && !harBrukt) return null;          // første besøk: ikke noe «nytt»
  if (sett && sett >= nyeste.id) return null;   // allerede lest
  const linjer = side === "bygg" ? nyeste.bygg : nyeste.kontor;
  return linjer && linjer.length ? nyeste : null;
}

function les(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function skriv(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

// Har nettleseren brukt Storm IFC før? Andre lagrede innstillinger fra siden.
function harBruktFor() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k !== NOKKEL && /^(storm|ifc)/i.test(k)) return true;
    }
  } catch (_) {}
  return false;
}

const side = () => (document.documentElement.dataset.lett === "1" ? "bygg" : "kontor");

export function visNytt(post) {
  if (!post || document.getElementById("nyttKort")) return null;
  const linjer = side() === "bygg" ? post.bygg : post.kontor;
  const slor = document.createElement("div");
  slor.id = "nyttKort";
  slor.className = "nytt-slor";
  slor.innerHTML = '<div class="nytt-kort" role="dialog" aria-modal="true" aria-labelledby="nyttTittel">' +
    '<div class="nytt-tittel" id="nyttTittel">✨ ' + esc(t("Nytt i Storm IFC")) + '</div>' +
    '<div class="nytt-dato">' + esc(t("Oppdatert {0}", post.dato || post.id)) + '</div>' +
    '<ul>' + linjer.map(l => '<li>' + esc(t(l)) + '</li>').join("") + '</ul>' +
    '<div class="nytt-knapper"><button type="button" class="primary" id="nyttOk">' + esc(t("Ok, skjønner")) + '</button></div></div>';
  document.body.appendChild(slor);
  const lukk = () => {
    skriv(NOKKEL, post.id);
    slor.remove();
    window.removeEventListener("keydown", tast, true);
  };
  const tast = (e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); lukk(); } };
  slor.querySelector("#nyttOk").onclick = lukk;
  slor.addEventListener("click", (e) => { if (e.target === slor) lukk(); });
  window.addEventListener("keydown", tast, true);
  setTimeout(() => { const k = document.getElementById("nyttOk"); if (k) k.focus(); }, 50);
  return slor;
}

// Hjelpekortene (forslag 8) kan stå åpne første gang — da venter «Nytt» til
// de er lukket, så det aldri ligger to kort oppå hverandre.
function visNarLedig(post, vent) {
  setTimeout(() => {
    const hk = document.getElementById("hjelpKort");
    if (hk && hk.classList.contains("open")) return visNarLedig(post, 1000);
    visNytt(post);
  }, vent);
}

// Første gang en modell er åpen i denne økta: vis kortet hvis det er noe nytt
// «Brukt før?» leses med en gang modulen lastes — senere i økta kan siden selv
// ha lagret innstillinger, og da ville en førstegangsbruker sett ut som en gammel.
const BRUKT_FOR = typeof localStorage !== "undefined" ? harBruktFor() : false;
let sjekket = false;
export function sjekkNytt() {
  if (sjekket || !document.body.classList.contains("har-modell")) return;
  if (document.documentElement.dataset.innebygd === "1") return;   // 🖼 ikke i Storm Prosjekter
  sjekket = true;
  const sett = les(NOKKEL), brukt = BRUKT_FOR;
  const post = nyttAVise(NYHETER, sett, brukt, side());
  if (post) visNarLedig(post, 600);   // la modellen tegnes først
  else if (!sett && NYHETER[0]) skriv(NOKKEL, NYHETER[0].id);   // første besøk: merk som lest
}
S.sjekkNytt = sjekkNytt;

if (typeof document !== "undefined" && document.body) {
  const MO = window.MutationObserver;
  if (MO) new MO(() => sjekkNytt()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  sjekkNytt();
}
