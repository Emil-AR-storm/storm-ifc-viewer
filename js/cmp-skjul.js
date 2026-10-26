// 🙈 BARE MODELLEN UNDER SAMMENLIGNINGEN (Emil 26.10.2026)
//
// «alt som ikke har noe … rigg objekt, genererte vegg, trp og blikk objekt
// OSV... skal skjules når sammenlignings verktøyet brukes. Det man er
// interesert i … er hva som er endret fra den forrige IFC modellen og da er
// alt som ikke har noe med det og gjøre bare støy»
//
// Lagene (rigg, SW-vegger, tak/TRP/blikk, terreng, materiell, framdrift,
// markeringer …) ligger hver i sin gruppe rett i scenen. Mens sammenligningen
// står på, skjules alle gruppene som ikke er modellen, fargeboksene, valget,
// aksene eller målene — rett før hvert bilde tegnes, så et lag som slår seg
// selv på igjen underveis (terrenget gjør det) også holdes skjult. Hver gruppe
// huskes, og settes tilbake når sammenligningen avsluttes eller valget slås av.
//
// REN: ingen DOM. Scenen og «hva som skal stå» kommer inn.

// holdt: Map(gruppe → true) — gruppene VI har skjult
export function skjulStoy(scene, behold, holdt) {
  for (const ch of scene.children) {
    if (!ch.visible || behold(ch)) continue;
    ch.visible = false;
    holdt.set(ch, true);
  }
}

export function visStoy(holdt) {
  for (const ch of holdt.keys()) ch.visible = true;
  holdt.clear();
}
