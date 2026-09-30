// 📄 Dokumentasjon — snarveiene i verktøygruppa med samme navn.
//
// Emil ville ha én gruppe med alt som lager en fil (02.09 og 04.09), og valgte
// 30.09 «flytt + snarveier». Rapport og Lett kopi er flyttet dit som de er
// (samme knapper, se js/verktoygrupper.js). Riggplan, SW-tegning og BCF bor
// inne i hvert sitt panel, og DER blir de stående.
//
// HVORFOR SNARVEIEN ÅPNER PANELET OG TRYKKER PANELKNAPPEN, i stedet for å
// kalle nedlastingen direkte: panelene bygges først når de åpnes, og
// nedlastingene leser valgene sine derfra. SW-tegningen leser ringmur, rad-
// høyder og tittelfelt fra feltene i SW-panelet — finnes ikke feltene, faller
// den tilbake til standardverdier og gir en ANNEN tegning enn den brukeren har
// stilt inn. Riggplanen leser målestokken fra Rigg-panelet. Ved å gå veien om
// panelet blir det én kode som laster ned, og brukeren ser valgene som ble brukt.
//
// Importeres bare fra main.js. På byggeplass-siden er knappene skjult.
import { $, S, på } from "./state.js";
import { t } from "./i18n.js";

// Åpner panelet (hvis det ikke er åpent) og trykker knappen inni det.
// Returnerer hva som skjedde, så testene kan sjekke det uten å se på skjermen.
export function apneOgTrykk(panelId, apneKnappId, indreKnappId, tomTekst) {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return "ingen-modell"; }
  const panel = $(panelId);
  // Åpne-knappen er en veksler: trykkes den mens panelet er åpent, LUKKES det.
  if (!(panel && panel.classList.contains("open"))) {
    const apne = $(apneKnappId);
    if (apne) apne.click();
  }
  const knapp = $(indreKnappId);
  if (!knapp) return "fant-ikke";
  // En låst knapp betyr at det ikke finnes noe å laste ned (riggplan uten
  // rigg). Et trykk på en låst knapp gjør ingenting — da må vi si hvorfor.
  if (knapp.disabled) { if (tomTekst) alert(t(tomTekst)); return "tom"; }
  knapp.click();
  return "trykket";
}

på("btnDokRigg", "click", () =>
  apneOgTrykk("riggPanel", "btnRigg", "riggPdf", "Legg inn noe rigg først — planen er tom."));
på("btnDokSW", "click", () =>
  apneOgTrykk("swPanel", "btnSW", "swTegning"));
// BCF ligger i rapportmenyen, som finnes fra start — der er det ikke noe
// panel å åpne, bare knappen å trykke.
på("btnDokBcf", "click", () => {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  const b = $("rapBcf");
  if (b) b.click();
});
