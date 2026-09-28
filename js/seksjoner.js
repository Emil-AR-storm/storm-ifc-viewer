// 📂 Sammenfoldede seksjoner — felles for SW-generator, Blikk & Tak, Rigg og Terreng.
//
// Panelet ble for langt å bla i: ni seksjoner med felt, tekst og lister under
// hverandre (Emil 08.09: «det tar alt for lang tid å bla gjennom hele
// verktøyet, det er rotete»). Hver <h4> blir derfor en <details>: bare
// overskriften står, og et trykk åpner seksjonen. Hvilke som står åpne huskes
// i localStorage — på tvers av modeller, fordi det er en ARBEIDSMÅTE, ikke
// noe om bygget: den som jobber med utsparinger vil ha den seksjonen åpen på
// neste bygg også.
//
// HVORFOR ETTERBEHANDLING AV DOM-EN OG IKKE <details> I HTML-STRENGEN: HTML-en
// bygges av seks funksjoner med rundt sytti felt, og hvert felt slås opp med
// $("swBetong") osv. Å pakke strengen om ville rørt alt det; å flytte noder
// etterpå rører ingenting — elementene finnes fortsatt med samme id.
// Handlingsknappene (Generer, Juster, PDF, Excel, Fjern) er merket
// data-sw-fast og blir stående utenfor: de skal aldri gjemmes bak en
// overskrift.
export const SEKSJON_NOKKEL = "storm-sw-seksjoner-apne";
export const SEKSJON_STANDARD_APEN = [];   // alle lukket til man åpner dem

// Rigg og Terreng (Emil 28.09: «samme dropdown-format som SW-generator») har
// hver sin nøkkel og sine egne seksjoner som står åpne FØRSTE gang: den som
// åpner Terreng for første gang skal se «Hent terreng», ikke bare en rad med
// lukkede overskrifter. SW-generator og Blikk & Tak deler den gamle nøkkelen
// (og «alt lukket») som før.
export function lesApneSeksjoner(nokkel, standard) {
  const std = (standard || SEKSJON_STANDARD_APEN).slice();
  try {
    const l = JSON.parse(localStorage.getItem(nokkel || SEKSJON_NOKKEL) || "null");
    return Array.isArray(l) ? l : std;
  } catch (_) { return std; }
}

export function skrivApneSeksjoner(liste, nokkel) {
  try { localStorage.setItem(nokkel || SEKSJON_NOKKEL, JSON.stringify(liste)); } catch (_) {}
}

// Ren: hvilken nøkkel en overskrift huskes under. data-sek fremfor teksten,
// fordi teksten skifter med språket — den som byttet til polsk skulle ikke
// miste hvilke seksjoner som sto åpne.
export function seksjonNokkel(h4) {
  return (h4.getAttribute && h4.getAttribute("data-sek")) || (h4.textContent || "").trim();
}

// valg: { nokkel, standard } — se lesApneSeksjoner. Uten valg: SW-generatorens.
export function foldSeksjoner(body, valg) {
  if (!body || typeof document === "undefined") return;
  const nokkelLs = valg && valg.nokkel, standard = valg && valg.standard;
  const apne = new Set(lesApneSeksjoner(nokkelLs, standard));
  const barn = Array.from(body.childNodes);
  let boks = null;
  for (const n of barn) {
    if (n.nodeType === 1 && n.tagName === "H4") {
      const nokkel = seksjonNokkel(n);
      boks = document.createElement("details");
      boks.className = "sw-seksjon";
      boks.setAttribute("data-sek", nokkel);
      if (apne.has(nokkel)) boks.open = true;
      const sum = document.createElement("summary");
      body.insertBefore(boks, n);
      sum.appendChild(n);
      boks.appendChild(sum);
      // 🔎 EMILS FUNN 21.09 (feilmeldinga oppe til høyre): «Cannot read
      // properties of null (reading 'open')» hver gang en seksjon ble trykket.
      //
      // `boks` er ÉN `let` erklært utenfor løkka, og lukkingen under fanger
      // VARIABELEN, ikke elementet. Første `data-sw-fast` setter boks = null —
      // og etter det leste hver eneste toggle-lytter `null.open`. Feilen har
      // ligget her siden runde 29, men SW-panelet fanger den i sin egen
      // try/catch; i Blikk & Tak kom den rett opp i skjermbildet.
      //
      // `denne` er en `const` INNE i løkka: hver seksjon får sitt eget
      // element, og de kan ikke lenger overskrive hverandre.
      const denne = boks;
      denne.addEventListener("toggle", () => {
        const liste = lesApneSeksjoner(nokkelLs, standard).filter(k => k !== nokkel);
        if (denne.open) liste.push(nokkel);
        skrivApneSeksjoner(liste, nokkelLs);
      });
      continue;
    }
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-sw-fast")) { boks = null; continue; }
    if (boks) boks.appendChild(n);
  }
}
