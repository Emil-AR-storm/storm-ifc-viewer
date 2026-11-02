// Lettmodus: viewer'en kjører uten innlogging. Slås på av bygg.html
// med data-lett="1" på <html>-elementet. Flagget står i HTML-en og ikke
// i URL-en, fordi det da er lest før noen modul kjører, og ikke kan slås
// av av den som besøker siden.
export const LETT = document.documentElement.dataset.lett === "1";

// 👷 Montørens navn (forslag 2, 02.11). Spørres ÉN gang i kodeboksen og kan
// endres under Innstillinger — ikke via et grått prompt()-vindu midt i første
// markering eller ferdigmelding. Huskes i nettleseren.
// NB: kontorsiden (byggeplass.js) bruker samme nøkkel til et JSON-kart over
// prosjektnavn. En verdi som starter med «{» er derfor ikke et navn.
const NAVN_NOKKEL = "storm-bp-navn";
export function montorNavn() {
  let n = "";
  try { n = localStorage.getItem(NAVN_NOKKEL) || ""; } catch (_) {}
  return n.trim().startsWith("{") ? "" : n.trim();
}
export function settMontorNavn(navn) {
  const n = String(navn || "").replace(/\s+/g, " ").trim().slice(0, 40);
  try { if (n) localStorage.setItem(NAVN_NOKKEL, n); } catch (_) {}
  return n;
}
