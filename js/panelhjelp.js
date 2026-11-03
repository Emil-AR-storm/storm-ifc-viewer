// ❔ «?» I HVERT PANEL (forslag 7A, Emil 03.11).
//
// En liten «?»-knapp i panelhodet viser 3–5 linjer om akkurat det verktøyet i
// en boble. Hjelpekortene (Hjelp-knappen, forslag 8) røres ikke — boblen har en
// lenke dit for den som vil ha mer.
//
// Tekstene står her, én per panel, og oversettes som alt annet (js/sprak/).
// Kun kontoret (importeres fra main.js).
import { $, esc } from "./state.js";
import { t } from "./i18n.js";

// Panel-id → linjene. Hver linje er én t()-nøkkel, så språkfilene vokter dem.
// Funksjoner, ikke ferdige lister: t() må kalles når boblen vises — da er
// språket lastet. Kalt ved oppstart ville alt stått på norsk.
export const HJELP = {
  propPanel: () => [t("Trykk på et element i modellen for å se navn, type, mål og mengder."), t("Shift + trykk velger flere — summen står øverst."), t("«Skjul» og «Bare dette» gjelder elementet du har valgt.")],
  commentPanel: () => [t("Trykk «Markering» og så i modellen for å skrive et avvik, spørsmål eller en beskjed."), t("Status (Åpen, Pågår, Løst) og frist bestemmer fargen."), t("Trykk på en rad for å fly dit. Bilder og tegninger legges på i boblen.")],
  vaerPanel: () => [t("Været på byggeplassen time for time, fra adressen i Prosjektinfo."), t("Varsel om vind for kranen, og regn og frost for støp."), t("Dra i tidslinja for å bla mellom timene og dagene.")],
  lasterPanel: () => [t("Veiledende snølast på taket og vindlast på fasadene."), t("Tallene er et anslag — RIB har siste ord.")],
  framdriftPanel: () => [t("Plan: lag trinn med Fra–Til, trykk «+ Legg til» og velg det som utføres."), t("Rapport: ferdigmeld det som er gjort og se framdriften mot planen."), t("Glideren nederst viser bygget en valgt dag.")],
  stopePanel: () => [t("«Ny etappe» lager en støp med dato."), t("«+ Legg til»: trykk elementene som støpes. «+ Felt» tegner et felt på plata."), t("«Merk som støpt» når det er gjort. Sjekklista før støp ligger under hver etappe.")],
  grupperPanel: () => [t("Velg elementer med shift + trykk eller shift + dra, og lagre utvalget med et navn."), t("Trykk på en lagret gruppe for å hente den fram igjen.")],
  terrengPanel: () => [t("Henter terreng og kart fra Kartverket rundt adressen."), t("Juster hvor bygget står og hvor høyt. Terrenget følger med ut til byggeplassen.")],
  riggPanel: () => [t("Legg brakker, kraner, gjerder og containere på tomta."), t("Tårnkranen har løfteplan med lastkurve (kransjekk)."), t("Riggplanen kan lastes ned som PDF.")],
  swPanel: () => [t("Lager veggelementer, gulv og ringmur på stålmodeller."), t("Juster målene, og last ned instruksjonstegning (PDF) og materialliste.")],
  takPanel: () => [t("Legger TRP-plater på de øverste bjelkene."), t("Dra i platene for å justere, og lagre oppsettet med et navn.")],
  materiellPanel: () => [t("Legg vareleveranser i modellen så alle ser hvor de skal ligge."), t("Vekten brukes i løfteplanen.")],
  prisPanel: () => [t("Mengder × priser blir til en Excel med formler."), t("«Marker» objektene som hører til en post, og sett pris per enhet.")],
  qtyPanel: () => [t("Mengder per elementtype: antall, lengde, areal og volum."), t("Last ned som Excel.")],
  libPanel: () => [t("Modellene i SharePoint. Trykk på en for å åpne den."), t("Fanene skiller IFC-modeller og lette kopier.")],
  colorPanel: () => [t("Farge og skjul per elementtype."), t("«Fargelegg etter type» gir hver type sin farge. Kantlinjer og bakgrunn stilles her også.")],
  axesPanel: () => [t("Viser aksene og etasjenivåene fra modellen."), t("Skriftstørrelsen stilles i Innstillinger.")],
  fdvPanel: () => [t("Slipp PDF-er her for å lage en FDV-gruppe, og klikk objektene som hører til."), t("Hver gruppe viser hva som mangler. Overleveringspakken lastes ned samlet.")],
  lagPanel: () => [t("Legg fagmodeller (armering, stål …) oppå hovedmodellen."), t("Kollisjon-fanen finner kollisjoner mellom modellen og lagene."), t("Juster plasseringen hvis laget ikke ligger riktig.")],
  emPanel: () => [t("Endringsmeldinger med frister og kontraktsvarsel."), t("Last ned som PDF og send til byggherren.")],
  comparePanel: () => [t("Sammenlign to revisjoner av modellen."), t("Nytt, fjernet og endret får hver sin farge.")],
  sharePanel: () => [t("Lag en lenke som viser akkurat denne visningen — kamera, snitt og det som er skjult."), t("Mottakeren ser det samme som deg.")],
  clipPanel: () => [t("Snitt langs X, Y eller Z, fra en flate eller med en boks."), t("Lagre snittene du bruker ofte med et navn.")],
  searchPanel: () => [t("Søk etter elementer på navn, type eller egenskap."), t("Trykk på et treff for å fly dit.")]
};

function lukkBoble() {
  const b = $("panelHjelpBoble");
  if (b) b.remove();
  document.removeEventListener("pointerdown", utenfor, true);
  window.removeEventListener("keydown", escTast, true);
}
function utenfor(e) {
  const b = $("panelHjelpBoble");
  if (b && !b.contains(e.target) && !(e.target.closest && e.target.closest(".panel-hjelp"))) lukkBoble();
}
function escTast(e) { if (e.key === "Escape" && $("panelHjelpBoble")) { e.preventDefault(); e.stopImmediatePropagation(); lukkBoble(); } }

export function visHjelp(panelId, knapp) {
  const apen = $("panelHjelpBoble");
  if (apen) { const var_ = apen.dataset.panel; lukkBoble(); if (var_ === panelId) return null; }
  if (!HJELP[panelId]) return null;
  const linjer = HJELP[panelId]();
  const panel = $(panelId);
  const tittel = panel ? ((panel.querySelector("header > span") || {}).textContent || "") : "";
  const b = document.createElement("div");
  b.id = "panelHjelpBoble";
  b.className = "panel-hjelp-boble";
  b.dataset.panel = panelId;
  b.setAttribute("role", "dialog");
  b.innerHTML = "<b>" + esc(tittel) + "</b><ul>" + linjer.map(l => "<li>" + esc(l) + "</li>").join("") + "</ul>" +
    '<button type="button" class="panel-hjelp-mer">' + esc(t("Flere tips under Hjelp")) + " →</button>";
  document.body.appendChild(b);
  b.querySelector(".panel-hjelp-mer").onclick = () => { lukkBoble(); const h = $("btnHjelp"); if (h) h.click(); };
  // Under knappen, innenfor skjermen
  const r = knapp ? knapp.getBoundingClientRect() : { left: 20, right: 40, bottom: 60 };
  const bredde = Math.min(300, window.innerWidth - 16);
  b.style.width = bredde + "px";
  b.style.left = Math.max(8, Math.min(r.right - bredde, window.innerWidth - bredde - 8)) + "px";
  b.style.top = (r.bottom + 8) + "px";
  // Går boblen ut nederst (panelet står lavt), legges den over knappen
  const h = b.getBoundingClientRect().height;
  if (r.bottom + 8 + h > window.innerHeight - 8) b.style.top = Math.max(8, r.top - h - 8) + "px";
  document.addEventListener("pointerdown", utenfor, true);
  window.addEventListener("keydown", escTast, true);
  return b;
}

// «?» i hodet på hvert panel som har en tekst. Panelene som lages i JS
// (adminPanel o.l.) uten tekst får ingen knapp.
export function leggTilKnapper(rot) {
  const doc = rot || document;
  for (const id of Object.keys(HJELP)) {
    const p = doc.getElementById(id);
    const hode = p && p.querySelector(":scope > header");
    if (!hode || hode.querySelector(".panel-hjelp")) continue;
    const k = document.createElement("button");
    k.type = "button";
    k.className = "panel-hjelp";
    k.textContent = "?";
    // Oversettes av oversettDom() ved oppstart og språkbytte (data-i18n-title)
    k.title = "Hva gjør dette verktøyet?";
    k.dataset.noTitle = "Hva gjør dette verktøyet?";
    k.setAttribute("data-i18n-title", "");
    k.setAttribute("aria-label", "?");
    k.addEventListener("click", (e) => { e.stopPropagation(); visHjelp(id, k); });
    const lukk = hode.querySelector("[data-lukk]");
    hode.insertBefore(k, lukk || null);
  }
}

if (typeof document !== "undefined") leggTilKnapper();
