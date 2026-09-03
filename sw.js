/* Storm IFC-Viewer — service worker for byggeplass-siden (bygg.html).
 *
 * HVA DEN GJØR: gjør at montøren kan åpne byggeplass-lenka på en telefon uten
 * dekning og få opp modellen med markeringene slik de var sist han hadde nett.
 *
 * HVA DEN IKKE GJØR: den gjør ikke systemet «offline». Nye markeringer,
 * bilder og talemeldinger sendes fortsatt av køene i js/markers.js og
 * js/vedleggko.js — denne fila rører aldri det som SENDES, bare det som HENTES.
 *
 * ---------------------------------------------------------------------------
 * FEM TING DU MÅ VITE FØR DU ENDRER NOE HER
 *
 * 1. FILA MÅ LIGGE PÅ ROTA. En service worker får bare styre adresser under
 *    sin egen mappe. Lå den på /js/sw.js, ville den ikke sett /20653 — som er
 *    nettopp adressen QR-plakaten peker på.
 *
 * 2. DEN SERVERES GJENNOM CLOUDFLARE-PROXYEN, ikke fra GitHub Pages direkte.
 *    Proxyens hvitliste i worker/worker.js MÅ inneholde sw\.js. Uten den får
 *    /sw.js 404 og registreringen feiler stille.
 *
 * 3. VERSJONEN LIGGER I CACHE-NAVNET og genereres av verktoy/lag-sw-liste.mjs
 *    som en hash av innholdet i skallet. Kjør det verktøyet før hver push som
 *    rører bygg.html, js/, css/ eller vendor/. Glemmer du det, feiler
 *    _test/test-sw.mjs — som er hele grunnen til at den testen finnes.
 *
 * 4. INGEN AUTOMATISK skipWaiting(). En ny service worker som tar over midt i
 *    en økt kan servere nye moduler til en side som allerede har lastet de
 *    gamle — halve appen fra hver versjon. Den nye venter, montøren får et
 *    synlig varsel, og bytter når HAN trykker. Se «hopp-over-venting» nederst.
 *
 * 5. SKALLET OG DATAENE LIGGER I HVER SIN CACHE. Skallet byttes ved hver
 *    kodeendring; modellen gjør det ikke. Lå de sammen, måtte montøren lastet
 *    ned en 40 MB .glb på nytt hver gang vi rettet en skrivefeil i en knapp.
 * ---------------------------------------------------------------------------
 */

// ---- GENERERT BLOKK START (verktoy/lag-sw-liste.mjs) ----
// IKKE REDIGER FOR HÅND. Kjør: node "verktoy/lag-sw-liste.mjs"
const SW_VERSJON = "7bedc043c7d0";
const SKALL = [
  "/bygg.html",
  "/css/storm.css",
  "/js/angre.js",
  "/js/apning.js",
  "/js/axes.js",
  "/js/bilder.js",
  "/js/clip.js",
  "/js/compare.js",
  "/js/config.js",
  "/js/display.js",
  "/js/elements.js",
  "/js/frist.js",
  "/js/grupper.js",
  "/js/hjelp.js",
  "/js/hjul.js",
  "/js/i18n.js",
  "/js/ifc.js",
  "/js/ifcrpc.js",
  "/js/lett-main.js",
  "/js/lett.js",
  "/js/lite.js",
  "/js/lyd.js",
  "/js/markerbilde.js",
  "/js/markers.js",
  "/js/materiell-vis.js",
  "/js/measure.js",
  "/js/minimap.js",
  "/js/mobile.js",
  "/js/modes.js",
  "/js/nett.js",
  "/js/nevning.js",
  "/js/oppsett.js",
  "/js/outline.js",
  "/js/planner.js",
  "/js/prefs.js",
  "/js/profiler.js",
  "/js/rapport.js",
  "/js/scene.js",
  "/js/share.js",
  "/js/sharepoint.js",
  "/js/sjekkliste.js",
  "/js/state.js",
  "/js/sw-reg.js",
  "/js/tegninger.js",
  "/js/tema.js",
  "/js/ui.js",
  "/js/vedleggko.js",
  "/js/verktoygrupper.js",
  "/js/viewcube.js",
  "/vendor/three-0.160.0/three.module.min.js",
  "/vendor/three-0.160.0/addons/loaders/GLTFLoader.js",
  "/vendor/three-0.160.0/addons/lines/LineSegmentsGeometry.js",
  "/vendor/three-0.160.0/addons/lines/LineMaterial.js",
  "/vendor/three-0.160.0/addons/lines/LineSegments2.js"
];
// ---- GENERERT BLOKK SLUTT ----

// Skallet: koden vår. Byttes ved hver versjon.
const SKALL_CACHE = "storm-skall-" + SW_VERSJON;
// Dataene: modellen og markeringene. Navnet er BEVISST uten kodeversjon —
// se punkt 5 over. Tallet bak økes bare hvis formatet her endrer seg.
const DATA_CACHE = "storm-data-v1";

// Hvor lenge vi venter på nettet før vi går til cachen. Kort med vilje: står
// montøren i en kjeller, skal han ikke se på en blank skjerm i ti sekunder for
// å ende opp med den kopien vi hadde hele tiden.
const FRIST_MS = 5000;

function medFrist(løfte, ms) {
  return new Promise((ja, nei) => {
    const t = setTimeout(() => nei(new Error("Tidsavbrudd")), ms);
    løfte.then(v => { clearTimeout(t); ja(v); }, e => { clearTimeout(t); nei(e); });
  });
}

// ---------- Installasjon ----------
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SKALL_CACHE);
    // addAll er ALT-ELLER-INGENTING, og det er riktig her: en halv cache er
    // verre enn ingen. Feiler én fil, avbrytes installasjonen og den gamle
    // service workeren blir stående — montøren merker ingenting, og vi har
    // ikke servert ham en side som mangler en modul.
    //
    // cache: "reload" hopper over nettleserens egen HTTP-cache. Uten den kunne
    // vi forhåndslagret en fem minutter gammel kopi av vår egen kode (proxyen
    // setter max-age=300) og låst den inne for hele versjonen.
    await c.addAll(SKALL.map(u => new Request(u, { cache: "reload" })));
  })());
});

// ---------- Aktivering ----------
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Rydd bort gamle SKALL-cacher. Datacachen røres ikke — den har eget navn
    // nettopp for å overleve dette.
    const navn = await caches.keys();
    await Promise.all(navn
      .filter(n => n.startsWith("storm-skall-") && n !== SKALL_CACHE)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ---------- Henting ----------
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // ALT SOM IKKE ER GET SLIPPER RETT GJENNOM. POST /hendelse, POST /kvitter,
  // PUT /last-opp — de eies av køene i js/markers.js og js/vedleggko.js, som
  // allerede håndterer at nettet er borte. Blandet vi oss her, ville vi fått
  // to systemer som prøver å sende det samme.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Fremmede domener rører vi ikke. jsDelivr (web-ifc, QR-biblioteket) og
  // Microsoft Graph hører ikke hjemme i en cache vi styrer.
  if (url.origin !== self.location.origin) return;

  // Navigasjon: /, /20653 og alt annet som er en sidelast.
  if (req.mode === "navigate") { e.respondWith(navigasjon()); return; }

  const p = url.pathname;

  if (SKALL.indexOf(p) !== -1) { e.respondWith(fraSkall(req, p)); return; }

  // Modellen. Bare nyeste i rota — IKKE /modell/<p>/rev/2/… : å forhåndslagre
  // gamle revisjoner er titalls MB for en funksjon ingen bruker på stillaset.
  if (/^\/modell\/\d{5}\/[^/]+\.glb$/.test(p)) { e.respondWith(modell(req)); return; }

  if (/^\/markeringer\/\d{5}\//.test(p)) { e.respondWith(markeringer(req)); return; }

  // ALT ANNET GÅR RETT PÅ NETTET OG LAGRES ALDRI:
  //   /innboks/, /logg/, /filer/, /fil/, /prosjekt/  — admin, med x-token
  //   /revisjoner/                                   — historikk krever nett
  //   /bilde/, /tegning/                             — ubegrenset volum
  //   /modell/<p>/rev/…                              — gamle revisjoner
  //   /helse, /ny-kode, /åpne                        — ingen verdi cachet
});

// Navigasjon svares ALLTID fra den cachede bygg.html, ikke fra et oppslag på
// adressen. QR-en er /20653, rota er /, og begge serverer samme fil — et
// oppslag på req ville bommet på begge. Ny kode kommer via en ny service
// worker, ikke via denne hentingen; derfor cache først og ingen venting.
async function navigasjon() {
  const c = await caches.open(SKALL_CACHE);
  const cachet = await c.match("/bygg.html");
  if (cachet) return cachet;
  try { return await fetch("/bygg.html"); }
  catch (_) { return new Response("Ingen nett og ingen lagret kopi.", { status: 503 }); }
}

// Skallet er uforanderlig innenfor en versjon: ny kode = ny versjon = ny cache.
async function fraSkall(req, p) {
  const c = await caches.open(SKALL_CACHE);
  const cachet = await c.match(p);
  if (cachet) return cachet;
  // Havner vi her, mangler fila i cachen — installasjonen var ufullstendig
  // eller nettleseren har ryddet. Hent fra nett og la det være.
  return fetch(req);
}

// Modellen. Adressen har ?v=<opplastingstid> og er merket immutable, så en
// truffet kopi er per definisjon riktig kopi.
async function modell(req) {
  const c = await caches.open(DATA_CACHE);
  const cachet = await c.match(req);
  if (cachet) return cachet;
  const svar = await fetch(req);
  if (svar && svar.ok) {
    // Gamle ?v= for SAMME fil ryddes bort. Uten dette samler telefonen opp en
    // kopi per opplasting, og på et prosjekt med ukentlige revisjoner er det
    // hundrevis av megabyte som aldri slippes.
    await ryddModell(c, new URL(req.url));
    await c.put(req, svar.clone());
  }
  return svar;
}

async function ryddModell(c, url) {
  const uten = url.origin + url.pathname;
  for (const n of await c.keys()) {
    const u = new URL(n.url);
    if (u.origin + u.pathname === uten && n.url !== url.href) await c.delete(n);
  }
}

// Markeringene er FERSKVARE. Nett først; bare når nettet ikke svarer serverer
// vi den lagrede kopien — og da med et stempel som sier når den ble hentet, så
// klienten kan si «sist hentet kl. …» i stedet for å presentere den som sann.
//
// Workeren setter Cache-Control: no-store på denne ruta. Det gjelder
// nettleserens HTTP-cache; Cache Storage bryr seg ikke om det, og det er
// derfor vi kan lagre den her i det hele tatt. Det er ikke en omgåelse: uten
// nett er alternativet en tom modell uten forklaring.
async function markeringer(req) {
  const c = await caches.open(DATA_CACHE);
  try {
    const svar = await medFrist(fetch(req), FRIST_MS);
    if (svar && svar.ok) {
      await c.put(req, await medStempel(svar.clone(), Date.now()));
      return svar;   // det ferske svaret har INGEN stempel — det er signalet
    }
  } catch (_) {}
  const cachet = await c.match(req);
  if (cachet) return cachet;
  // Ingen kopi. Et ærlig 504 er bedre enn en tom liste: js/markers.js viser
  // «Fikk ikke hentet markeringene» på alt som ikke er 404.
  return new Response("Ingen nett og ingen lagret kopi av markeringene.", { status: 504 });
}

async function medStempel(svar, tid) {
  const h = new Headers(svar.headers);
  h.set("X-Storm-Cachet", String(tid));
  return new Response(await svar.blob(), { status: svar.status, statusText: svar.statusText, headers: h });
}

// ---------- Bytte av versjon, styrt av montøren ----------
// Klienten (js/sw-reg.js) viser «Ny versjon klar» og sender denne meldingen
// når han trykker. Da — og bare da — tar den nye over.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "hopp-over-venting") self.skipWaiting();
  if (e.data && e.data.type === "hvilken-versjon" && e.source) {
    e.source.postMessage({ type: "versjon", versjon: SW_VERSJON });
  }
});
