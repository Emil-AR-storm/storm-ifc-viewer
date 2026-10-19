// 🛡 Klikk-lytterne som før sto som onclick="…" rett i HTML-en (index.html og
// bygg.html).
//
// Sikkerhetsrunden 19.10: sidene har nå en streng sikkerhetspolicy (CSP,
// <meta http-equiv="Content-Security-Policy"> øverst i <head>). Den nekter
// ALL JavaScript som står inne i HTML-en — også onclick-attributter. Det er
// selve poenget: kommer det inn HTML fra et modellnavn, en markering eller en
// fil (f.eks. <img src=x onerror=…>), skal den ikke kunne kjøre kode i fanen
// der SharePoint-innloggingen og byggeplass-nøkkelen ligger.
//
// Derfor står handlingen som et data-attributt i HTML-en, og lytteren festes
// her:
//   data-lukk="propPanel"     → lukker vinduet med den id-en (fjerner .open)
//   data-kall="saveComment"   → kaller window.saveComment() (fra markers.js)
//
// IKKE legg til nye onclick="…" i HTML-en — de blir stille døde. Bruk
// data-lukk / data-kall, eller fest lytteren i modulen som eier knappen.
//
// Lastes FØRST av js/main.js og js/lett-main.js, så lytterne står først i
// køen på knappen — akkurat der onclick-attributtet sto (rigg.js fester f.eks.
// en egen lytter på #riggPanelLukk som skal kjøre etter lukkingen).
// Ingen importer med vilje: modulen skal ikke dra inn noe før resten.

const festet = new WeakSet();   // samme knapp får aldri to lyttere

export function festHtmlLyttere(rot) {
  const r = rot || document;
  r.querySelectorAll("[data-lukk]").forEach((b) => {
    if (festet.has(b)) return;
    festet.add(b);
    b.addEventListener("click", () => {
      const el = document.getElementById(b.dataset.lukk);
      if (el) el.classList.remove("open");
    });
  });
  r.querySelectorAll("[data-kall]").forEach((b) => {
    if (festet.has(b)) return;
    festet.add(b);
    b.addEventListener("click", () => {
      const f = window[b.dataset.kall];
      if (typeof f === "function") f();
    });
  });
}

festHtmlLyttere();
