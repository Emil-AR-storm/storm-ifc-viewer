// Oppsett som er likt for alle, og trygge standardverdier for det som ikke er det.
//
// ⚠ INGEN PERSONDATA I DENNE FILA. Ansattlista og Planner-planen er forskjellig
// hos hver kunde, og lå tidligere skrevet rett inn her – som betyr at Storms
// egne folk fulgte med i alle kopier av verktøyet. Nå hentes de fra fila
// «oppsett.json» i SharePoint-mappa ved oppstart (se js/oppsett.js).
//
// Verdiene under er derfor TOMME eller nøytrale. De fylles ved kjøring.
// Alt som fylles må ligge i et objekt eller en liste – ikke som en konstant –
// fordi de som importerer herfra gjør det én gang, før hentingen er ferdig.

// ---------- Ansatte som kan settes som ansvarlig på en markering ----------
// Fylles av oppsett.js med { navn, id, mail }. id = brukerens Entra-objekt-ID,
// den samme som Planner bruker; uten id lages oppgaven uten tildeling.
// Første person i lista er standardvalg.
//
// SAMME liste hele veien: oppsett.js tømmer og fyller denne, den byttes aldri
// ut. markers.js importerer den én gang og ser endringen uten å gjøre noe.
export const ANSATTE = [];

// ---------- Planner ----------
// planId hentes fra adressen til planen:
//   planner.cloud.microsoft/webui/plan/<PLAN_ID>/view/board
// bucket er kolonnen på tavla, og opprettes automatisk hvis den mangler.
//
// NB: alle som skal kunne få en oppgave må være medlem av gruppen som eier
// planen – Planner nekter å tilordne oppgaver til folk utenfor gruppen.
export const PLANNER = { planId: "", bucket: "IFC-markeringer" };

// ---------- Byggeplass-lenka (Cloudflare Worker) ----------
// Adressen til Workeren som serverer byggeplass-lenka. Ikke persondata, så
// standardverdien står her – oppsett.json kan overstyre den hos en kunde med
// egen Worker.
export const TJENESTER = { worker: "https://storm-byggeplass.emil-46a.workers.dev" };
