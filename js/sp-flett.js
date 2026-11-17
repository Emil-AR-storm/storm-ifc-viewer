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
// behold(lokal, ekstern) (valgfri): true = den i SharePoint vinner uansett
// `endret` (dagsrapporten: en signert post erstattes aldri av en usignert).
// beholdt (valgfri liste) får nøklene som ble holdt igjen slik.
export function flett(lokale, eksterne, nokkel, behold, beholdt) {
  const k = nokkel || ((p) => String(p && p.navn || ""));
  const ut = new Map();
  for (const p of (eksterne || [])) if (p && k(p)) ut.set(k(p), p);
  for (const p of (lokale || [])) {
    if (!p || !k(p)) continue;
    const finnes = ut.get(k(p));
    if (finnes && typeof behold === "function" && behold(p, finnes)) { if (beholdt) beholdt.push(k(p)); continue; }
    if (!finnes || String(p.endret || "") > String(finnes.endret || "")) ut.set(k(p), p);
  }
  return [...ut.values()];
}

export function flettPaaNavn(lokale, eksterne) { return flett(lokale, eksterne); }
export function flettPaaId(lokale, eksterne) {
  return flett(lokale, eksterne, (p) => String(p && p.id || ""));
}

// ---------- 📅 Framdriftsplanen: trinn fra Storm Prosjekter (steg 7, 17.11) ----------
// Storm Prosjekter eier navn/datoer/farge/fag/status (stemplet med spEndret);
// Storm IFC eier objektene og nummeret (stemplet med endret). Et trinn med
// kilde «storm-prosjekter» flettes derfor FELT FOR FELT – ellers kunne en
// montør som legger til objekter rett etter at prosjektlederen flyttet datoen,
// skrive den gamle datoen tilbake (eller omvendt).
//   · uten kilde: som før – nyeste `endret` vinner
//   · gravstein: nyeste `endret` vinner, som før
const SP_FELT = ["navn", "dato", "slutt", "farge", "fag", "status", "jobb", "spEndret", "kilde"];
export function objektTid(x) {
  const a = String(x && x.objEndret || "");
  const b = x && x.endret && x.endret !== x.spEndret ? String(x.endret) : "";
  return a > b ? a : b;
}
export function flettFramdrift(lokale, eksterne) {
  const id = (p) => String(p && p.id || "");
  const ut = new Map();
  for (const p of (eksterne || [])) if (p && id(p)) ut.set(id(p), p);
  for (const p of (lokale || [])) {
    if (!p || !id(p)) continue;
    const f = ut.get(id(p));
    if (!f) { ut.set(id(p), p); continue; }
    const sp = (x) => x && !x.slettet && x.kilde === "storm-prosjekter";
    if (sp(p) && sp(f)) {
      const spVinner = String(p.spEndret || "") >= String(f.spEndret || "") ? p : f;
      // Hvem har de nyeste OBJEKTENE? Storm Prosjekter setter endret = spEndret
      // når det skriver, så en slik `endret` sier ingenting om objektene. Derfor
      // objektTid(): objEndret, eller endret når den ikke er Storm Prosjekters.
      // Uten dette ville en datoflytting (nyere endret) spist objekter som en
      // montør nettopp hadde lagt til, men ennå ikke fått lagret.
      const op = objektTid(p), of = objektTid(f);
      const ifcVinner = (op || of) ? (op >= of ? p : f) : (String(p.endret || "") >= String(f.endret || "") ? p : f);
      const m = Object.assign({}, ifcVinner);
      for (const k of SP_FELT) if (k in spVinner) m[k] = spVinner[k];
      m.objekter = ifcVinner.objekter; m.nr = ifcVinner.nr;
      if (op || of) m.objEndret = op > of ? op : of;
      m.endret = String(p.endret || "") > String(f.endret || "") ? p.endret : f.endret;
      ut.set(id(p), m);
    } else if (String(p.endret || "") > String(f.endret || "")) ut.set(id(p), p);
  }
  return [...ut.values()];
}
