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

// ---------- Fristgrenser ----------
// Når skifter ringen rundt en markering farge? gul = 8 betyr «gul når fristen
// er om 8 dager eller mindre», rod = 3 tilsvarende.
//
// FIRMAETS, IKKE PERSONLIGE. Ligger derfor her og overstyres fra oppsett.json,
// ikke i S.settings sammen med minikartstørrelsen. Hadde Simen hatt rød på 3 og
// Steffen på 10, ville de sett på samme modell og vært uenige om hva som
// brenner — uten å vite hvorfor.
//
// SAMME objekt hele veien, som ANSATTE og PLANNER: oppsett.js endrer innholdet,
// aldri objektet. De som importerer herfra gjør det én gang, før hentingen er
// ferdig, og ser endringen uten å gjøre noe.
export const FRISTER = { gul: 8, rod: 3 };

// ---------- Byggeplass-lenka (Cloudflare Worker) ----------
// Adressen til Workeren som serverer byggeplass-lenka. Ikke persondata, så
// standardverdien står her – oppsett.json kan overstyre den hos en kunde med
// egen Worker.
export const TJENESTER = { worker: "https://storm-byggeplass.emil-46a.workers.dev" };

// ---------- Tettheter (kg/m³) til vektberegningen ----------
// Vekt regnes som volum × tetthet. Volumet kommer fra selve geometrien, så
// nøyaktigheten hviler på at modellen har ekte profiler — ikke forenklede
// kasser. «kg/m»-kolonnen i Mengder finnes for å avsløre nettopp det.
//
// FIRMAETS TALL, som FRISTER: prises et bygg med 2500 hos oss og 2400 hos noen
// andre, skal det stå ett sted og ikke i hvert hode. Overstyres fra
// oppsett.json under «tettheter».
//
// Nøklene er materialGRUPPENE fra js/elements.js («Betong», «Stål»), ikke de
// nøyaktige materialnavnene. «B35», «C35/45» og «Concrete» er alle Betong.
//
// 2400 er uarmert betong. Armert ligger nærmere 2500 — sett det i oppsett.json
// hvis dere priser slik. Stål er 7850 og er ikke en vurderingssak.
//
// SAMME objekt hele veien, som ANSATTE og FRISTER.
export const TETTHET = { "Betong": 2400, "Stål": 7850 };

// ---------- Egne profiler (kg/m) ----------
// Sveiste og spesialtilpassede tverrsnitt som ikke finnes i noen katalog:
// HSQ-bjelker, T-profiler, hattprofiler. js/profiler.js kjenner de valsede og
// kaldformede profilene, men kan ikke gjette på disse — og gjetter derfor ikke.
//
// MÅLT PÅ HEGDALRINGEN 18: «ensidig HSQ justert» kom ut på 85,2 kg/m fra
// geometrien mot 75,3 i virkeligheten. +14 %, og de fire bjelkene alene sto for
// nesten hele avviket mot fasit på hele bygget. Med riktig kg/m her lander
// totalen 0,2 % under fasit i stedet for 1,3 % over.
//
// LIGGER I oppsett.json, ikke her, av samme grunn som tetthetene: kommer det en
// ny sveiset profil på neste prosjekt, skal den kunne legges inn uten en push.
// Nøkkelen er typenavnet slik det står i modellen — ett av leddene i
// «Familie:Type:ElementID», uten hensyn til store og små bokstaver.
//
// SAMME objekt hele veien, som ANSATTE og TETTHET.
export const EGNE_PROFILER = {};
