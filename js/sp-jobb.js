// 🔗 B2 – FINN JOBBEN I STORM PROSJEKTER UTEN Å HENTE HELE LISTA (Emil 24.11)
//
// HVORFOR. Før lastet Storm IFC ned hele lista «Prosjekter» (alle rader, 20
// kolonner – også Mannskap og Kontakter for hvert eneste prosjekt) hver gang en
// modell ble åpnet, ved «Legg i prosjekt», dagsrapport og sammenligning.
// Emil: «er det ikke smartere at den venter med å lete til den er koblet til et
// prosjekt, og kun leter der infoen til det prosjektet ligger?»
//
// HVORDAN.
//   1. Koblingen modell → jobb huskes (localStorage, per modellfil): jobbnummer
//      og radene. Bare KOBLINGEN huskes – aldri selve informasjonen.
//   2. Neste gang hentes bare radene i jobben, med alle kolonnene, ferskt hver
//      gang. Står modellen ikke lenger i Modell-feltet der (flyttet til et
//      annet prosjekt), letes det på nytt.
//   3. Uten kobling (første gang, eller den stemte ikke): den LETTE lista
//      (10 kolonner), finn jobben, husk koblingen, og hent de tunge kolonnene
//      bare for jobben.
//   4. Feiler noe av dette: dagens fulle henting (hentProsjekter). Det kan
//      aldri bli dårligere enn før.
//   (SVAR fra Storm Prosjekter 24.11: JobbNr og ProsjektNr er tekst og
//   indeksert. Mangler JobbNr, huskes rad-id-ene i stedet – samme regel som
//   Storm Prosjekters jobbFor, der jobben da er prosjektets egen Nøkkel.)
//   (Selskapsdeling 25.11: i ny kilde er id-ene «SB:123». En gammel id uten
//   selskap finnes ikke der – da letes det på nytt, som når koblingen ikke stemmer.)
//
// Svar: { jobb: [rader i jobben, SE → SB → SS], rader: [lista hvis den ble
//         hentet – ellers jobben], kilde: "kobling" | "liste" | "full",
//         komplett: true når radene har alle kolonnene }
import * as R from "./legg-i-prosjekt-regn.js";

const LS = "storm-ifc-sp-kobling::";
const felt = (r) => (r && (r.fields || r)) || {};

export function lesKobling(fil) {
  if (!fil) return null;
  try {
    const k = JSON.parse(localStorage.getItem(LS + fil) || "null");
    if (!k || typeof k !== "object") return null;
    const jobbNr = String(k.jobbNr || "").trim().slice(0, 20);
    // «SB:123» = rad i et selskap (selskapsdeling 25.11); gamle id-er uten selskap leses som før
    const ider = Array.isArray(k.ider) ? k.ider.map(String).filter(x => /^(?:S[EBS]:)?[\w-]{1,40}$/.test(x)).slice(0, 10) : [];
    return jobbNr || ider.length ? { jobbNr, ider } : null;
  } catch (_) { return null; }
}
export function koblingFor(jobb) {
  const l = (jobb || []).filter(Boolean);
  if (!l.length) return null;
  const jobbNr = String(felt(l.find(r => felt(r).JobbNr) || {}).JobbNr || "").trim();
  return { jobbNr, ider: l.map(r => String(r.id || "")).filter(Boolean) };
}
export function skrivKobling(fil, jobb) {
  if (!fil) return;
  try {
    const k = koblingFor(jobb);
    if (k) localStorage.setItem(LS + fil, JSON.stringify(Object.assign({ tid: new Date().toISOString() }, k)));
    else localStorage.removeItem(LS + fil);
  } catch (_) { /* uten lagring: lista hentes neste gang også */ }
}

// Velg jobben blant radene: på modellen først (standard), eller på
// byggeplassnummeret først (dagsrapporten).
export function velgJobb(rader, åpen, nummer, nummerFørst) {
  const a = () => R.finnJobb(rader, åpen), b = () => R.jobbForNummer(rader, nummer);
  let j = nummerFørst ? b() : a();
  if (!j.length) j = nummerFørst ? a() : b();
  return j;
}

async function koblingRader(G, token, k) {
  if (k.jobbNr) return G.hentJobbRader(token, k.jobbNr);
  const l = await Promise.all(k.ider.map(id => G.hentProsjektRad(token, id).catch(() => null)));
  return l.filter(Boolean);
}

export async function hentJobb(token, åpen, opt, deps) {
  const o = opt || {};
  const G = deps || await import("./legg-i-prosjekt-graph.js");
  const fil = (åpen && åpen.fil) || "";
  const nummer = o.nummer || "";

  // 1. Den huskede koblingen
  const k = lesKobling(fil);
  if (k) {
    try {
      const rader = await koblingRader(G, token, k);
      // Dagsrapporten: står byggeplassnummeret i en annen jobb, gjelder ikke koblingen
      const nummerPasser = !o.nummerFørst || !nummer || R.jobbForNummer(rader, nummer).length > 0;
      const jobb = nummerPasser ? velgJobb(rader, åpen, nummer, o.nummerFørst) : [];
      if (jobb.length && R.finnJobb(rader, åpen).length) return { jobb, rader: jobb, kilde: "kobling", komplett: true };
      if (jobb.length && o.nummerFørst) return { jobb, rader: jobb, kilde: "kobling", komplett: true };
    } catch (err) {
      if (err instanceof G.IngenTilgang || (G.IngenSelskap && err instanceof G.IngenSelskap)) throw err;
      /* koblingen kunne ikke brukes – let i lista */
    }
  }

  // 2. Den lette lista
  let rader, kilde = "liste";
  try { rader = await G.hentProsjekterLett(token); }
  catch (err) {
    if (err instanceof G.IngenTilgang || (G.IngenSelskap && err instanceof G.IngenSelskap)) throw err;
    // 4. Som før
    rader = await G.hentProsjekter(token); kilde = "full";
  }
  let jobb = velgJobb(rader, åpen, nummer, o.nummerFørst);
  if (fil) {
    if (R.finnJobb(rader, åpen).length) skrivKobling(fil, R.finnJobb(rader, åpen));
    else if (k) skrivKobling(fil, null);    // modellen står ikke lenger i noe prosjekt
  }
  let komplett = false;
  // 3. De tunge kolonnene bare for jobben
  if (jobb.length && o.tunge) {
    try {
      const fulle = await koblingRader(G, token, koblingFor(jobb));
      const etter = new Map(fulle.map(r => [String(r.id), r]));
      if (jobb.every(r => etter.has(String(r.id)))) { jobb = jobb.map(r => etter.get(String(r.id))); komplett = true; }
    } catch (err) {
      if (err instanceof G.IngenTilgang || (G.IngenSelskap && err instanceof G.IngenSelskap)) throw err;
      // Filteret ble avvist: én rad om gangen (som før B2)
      try {
        jobb = await Promise.all(jobb.map(async r => Object.assign({}, r, { fields: Object.assign({}, r.fields, await G.hentProsjektFelt(token, r)) })));
        komplett = true;
      } catch (_) { /* da blir det som før: prosjektinfo henter raden selv */ }
    }
  }
  return { jobb, rader, kilde, komplett };
}
