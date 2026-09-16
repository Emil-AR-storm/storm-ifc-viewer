// 📁 Flettereglene for delte, navngitte lister (SW-resultater og grupper).
//
// RENE FUNKSJONER, ingen import: verken nett, nettleser eller three.js. Det er
// med vilje — dette er reglene for hvem som vinner når samme post finnes to
// steder, og de skal kunne prøves uten å starte noe. Selve Graph-kallene bor i
// js/sp-lager.js.

// ---------- Sletting er en GRAVSTEIN, ikke et hull ----------
// Sletter du en post lokalt og vi bare utelater den, kommer den tilbake ved
// neste fletting — den ligger jo fortsatt i SharePoint, og flettingen kan ikke
// se forskjell på «slettet» og «ikke lastet ned ennå». Derfor blir posten
// stående med { slettet: true } og et ferskt tidsstempel, og vinner på nyeste.
// Lagrer du samme navn på nytt, er den nye enda ferskere og vinner tilbake.
//
// Gravsteinene ryddes bort etter et halvt år. Da har enhver maskin som var
// offline for lengst vært innom, og fila vokser ikke i det uendelige.
const GRAVSTEIN_DAGER = 180;

export function ryddGravsteiner(liste, naa) {
  const grense = new Date((naa || Date.now()) - GRAVSTEIN_DAGER * 86400000).toISOString();
  return (liste || []).filter(p => !(p && p.slettet && String(p.endret || "") < grense));
}

// ---------- Fletting inn i den lokale lista ----------
// Brukes når en modell åpnes: det som ligger i SharePoint er fasit, men poster
// du har lagret uten dekning skal ikke forsvinne. Nyeste `endret` vinner på et
// navn som finnes begge steder — ikke «SharePoint vinner alltid», for da ville
// en post du nettopp lagret offline blitt spist av en eldre utgave.
// `nokkel` sier hva som er SAMME post. SW-resultater kjennes på navnet — det
// er navnet du skriver i feltet, og to like navn ER samme resultat. Grupper
// har en egen id, og to personer kan godt lage hver sin gruppe som heter
// «Søyler akse 3»; flettet vi dem på navn, ville den ene forsvunnet.
export function flett(lokale, eksterne, nokkel) {
  const k = nokkel || ((p) => String(p && p.navn || ""));
  const ut = new Map();
  for (const p of (eksterne || [])) if (p && k(p)) ut.set(k(p), p);
  for (const p of (lokale || [])) {
    if (!p || !k(p)) continue;
    const finnes = ut.get(k(p));
    if (!finnes || String(p.endret || "") > String(finnes.endret || "")) ut.set(k(p), p);
  }
  return [...ut.values()];
}

export function flettPaaNavn(lokale, eksterne) { return flett(lokale, eksterne); }
export function flettPaaId(lokale, eksterne) {
  return flett(lokale, eksterne, (p) => String(p && p.id || ""));
}
