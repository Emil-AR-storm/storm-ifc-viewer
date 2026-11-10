// 📁 LEVER – det ene stedet dokumentene går ut av Storm IFC (Emil 10.11,
// «Legg i prosjekt», valg C). Liten med vilje: lastes av alle som laster ned.
//
// «Last ned ▾» (legg-i-prosjekt.js) setter S.lip = { valg, type, til } før
// den trykker den ekte knappen. Når dokumentet er laget og kommer hit:
//   valg "ned"      → lastes ned som før
//   valg "prosjekt" → «Legg i prosjekt»-dialogen, ingen nedlasting
//   valg "begge"    → begge deler
// Uten S.lip (vanlig trykk, eller Storm-Byggeplass) er alt som før.
import { S } from "./state.js";

export function lastNedRått(blob, navn, frigiEtterMs) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = navn;
  document.body.appendChild(a); a.click(); a.remove();
  // Nettleseren trenger noen sekunder på å faktisk lagre fila. Frigjør vi
  // adressen med en gang, kan nedlastingen bli tom på trege maskiner.
  setTimeout(() => URL.revokeObjectURL(url), frigiEtterMs || 20000);
}

// info.dato: datoen dokumentet gjelder (ÅÅÅÅ-MM-DD), f.eks. dagsrapportens dag.
export function lever(blob, navn, info) {
  const lip = S.lip && S.lip.til > Date.now() ? S.lip : null;
  S.lip = null;   // ett dokument per valg
  if (!lip || lip.valg !== "prosjekt") lastNedRått(blob, navn);
  if (lip && lip.valg !== "ned") {
    import("./legg-i-prosjekt.js")
      .then(m => m.dialog(lip.type, blob, navn, (info && info.dato) || ""))
      .catch(err => console.warn("Legg i prosjekt:", err && err.message));
  }
}
