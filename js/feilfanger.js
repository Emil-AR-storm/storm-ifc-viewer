// Fanger feil og viser dem på skjermen (nyttig på mobil uten konsoll).
//
// VANLIG skript (ikke modul), lastet synkront med <script src> nederst i
// <body> på index.html og bygg.html, FØR modulene. Det sto før inline, men
// sikkerhetspolicyen (CSP) nekter inline-skript. Samme plass i siden = samme
// rekkefølge: lytterne står før noen modul rekker å feile.
window.addEventListener("error", function(e) {
  var s = document.getElementById("status");
  var hvor = e.filename ? " [" + e.filename.split("/").pop() + ":" + e.lineno + "]" : "";
  if (s) s.textContent = "Feil: " + (e.message || "ukjent") + hvor;
});
window.addEventListener("unhandledrejection", function(e) {
  var s = document.getElementById("status");
  var m = e.reason && e.reason.stack && /([A-Za-z0-9_.-]+\.m?js:\d+)/.exec(e.reason.stack);
  if (s) s.textContent = "Feil: " + (e.reason && e.reason.message ? e.reason.message : e.reason) +
    (m ? " [" + m[1] + "]" : "");
});
