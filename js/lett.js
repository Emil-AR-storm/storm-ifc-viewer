// Lettmodus: viewer'en kjører uten innlogging. Slås på av bygg.html
// med data-lett="1" på <html>-elementet. Flagget står i HTML-en og ikke
// i URL-en, fordi det da er lest før noen modul kjører, og ikke kan slås
// av av den som besøker siden.
export const LETT = document.documentElement.dataset.lett === "1";
