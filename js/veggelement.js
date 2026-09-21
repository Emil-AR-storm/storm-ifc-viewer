// 🧱 SW-generator: automatiske veggelementer (sandwichpaneler) på stålmodeller.
//
// HVA DEN GJØR (Emils spesifikasjon, Ideer/Automatisk SW,veggelement liste…txt):
//  · finner søylene (IfcColumn) og fasadene deres automatisk (konveks hull)
//  · genererer gulv (betong + isolasjon, OK betong = bunn av søylene, med
//    valgt utstikk forbi søylene) og valgfri ringmur inntil utvendige søyler
//  · fyller hver fasade med veggelementer søyle-til-søyle: elementet stopper
//    25 mm fra søylesenter (to naboelementer får 50 mm mellomrom), og radene
//    stables med 1100- og 1000-høyder til topp av søyleforlengerne — går ikke
//    høyden opp, kappes øverste rad (Emils valg 01.09)
//  · utsparinger (dører/vinduer/porter): trykk «Marker utsparing» og pek på
//    FLATENE rundt åpningen — innsiden av søylene på sidene, undersiden av
//    bjelken over. Én flate per side (Emils runde 3: hele elementer dro med
//    seg tre gale sider hver gang)
//  · hver unik lengde×høyde får et SW-nummer (SW-01, SW-02 …); kappede
//    tilpasningsbiter heter SW-XX, som på Moelv-tegningene
//  · veggene tegnes PÅ PLASS i 3D med valgt farge, OG hvert SW-nummer legges
//    som leveransestabel i 📦 Materiell (sandwichpanel) — da kommer antall og
//    areal i Mengder av seg selv
//  · lista lastes ned i Moelv-formatet (Elementnr, lengde, høyde, tykkelse,
//    antall, isolasjon, farger, m²) som semikolon-CSV som åpner rett i Excel
//
// KUN KONTOR: importeres bare fra main.js, som materiell.js. Genererte vegger
// lagres lokalt per modellfil og tegnes opp igjen når modellen åpnes.
//
// Regnereglene (radmiks, spennlengder, oppdeling rundt utsparinger, SW-numre)
// er RENE TALLFUNKSJONER uten three.js — de prøves i _test/test-veggelement.mjs.
//
// ---------------------------------------------------------------------------
// FILA ER DELT I ÅTTE. Den var 327 kB og 6524 linjer i ett stykke — for stor
// til å åpne på en treg maskin, og umulig å finne fram i. Delene ligger i
// js/veggelement/ og denne fila er inngangen: den samler dem og sender alt
// videre. Alle som importerer «./veggelement.js» merker derfor ingenting.
//
//   regler.js     rene tallfunksjoner og konstanter — ingen three.js, ingen DOM
//   tilstand.js   swGroup, det lagrede resultatet, skjul/valg, lagring
//   tegning.js    veggene, ringmuren og merkingen tegnet opp i 3D
//   generer.js    generer(), migrering, justeringer løst opp, stabler, CSV
//   stal.js       stålet projisert på fasadene + instruksjonstegningen
//   juster.js     juster ender, splitt, marker utsparing, finn utsparinger
//   panel.js      seksjonene, oppsettfeltene og logovalget
//   innervegg.js  innerveggene, fra bygging til eget panel
//   bunker.js     hvor materiellbunkene står, og at de husker en flytting
//   blikk.js      blikket rundt elementene — eget verktøy, reglene i sw-blikk.js
//
// HVORFOR «export *» OG IKKE EN HÅNDSKREVET LISTE: delene eksporterer alt de
// har på toppnivå, fordi de peker på hverandre. En håndskrevet liste her måtte
// vært à jour med alle åtte, og den dagen den ikke er det, forsvinner et navn
// stille ut av _test/test-veggelement.mjs uten at noe blir rødt.
//
// REKKEFØLGEN UNDER ER LESEREKKEFØLGE, ikke lasterekkefølge: modulene peker på
// hverandre i ring, og nettleseren løser det selv. Det går bare så lenge ingen
// del REGNER UT noe på toppnivå som leser en konstant fra en annen del — står
// det bare registreringer av lyttere der, er ringen ufarlig.
// ---------------------------------------------------------------------------
export * from "./veggelement/regler.js";
export * from "./veggelement/bunker.js";
export * from "./veggelement/tilstand.js";
export * from "./veggelement/tegning.js";
export * from "./veggelement/generer.js";
export * from "./veggelement/stal.js";
export * from "./veggelement/juster.js";
export * from "./veggelement/panel.js";
export * from "./veggelement/innervegg.js";
export * from "./veggelement/blikk.js";
export * from "./veggelement/blikk-just.js";
export * from "./veggelement/tak.js";
export * from "./veggelement/tak-just.js";
