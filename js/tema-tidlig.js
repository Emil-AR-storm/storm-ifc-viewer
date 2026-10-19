// Temaet settes FØR stilarket rekker å male, ellers blinker mørk flate i lyst
// tema. js/tema.js gjør resten (knappen og lagringen).
//
// VANLIG skript (ikke modul), lastet synkront med <script src> i <head> på
// index.html, bygg.html og vilkar.html. Det sto før inline i hver side, men
// sikkerhetspolicyen (CSP) nekter inline-skript — en egen fil fra eget domene
// kjører på nøyaktig samme tidspunkt (parseren venter på den), så det blinker
// fortsatt ikke. IKKE gjør den til type="module" eller async/defer: da kjører
// den først etter at siden er malt.
(function(){var v="mork";try{var g=localStorage.getItem("storm.tema");
if(g==="lys"||g==="mork")v=g;}catch(e){}document.documentElement.dataset.tema=v;})();
