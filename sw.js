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
const SW_VERSJON = "b23865f7c6e4";
const SKALL = [
  "/bygg.html",
  "/css/storm.css",
  "/img/favicon.svg",
  "/img/favicon-32.png",
  "/img/apple-touch-icon.png",
  "/js/tema-tidlig.js",
  "/js/feilfanger.js",
  "/js/angre.js",
  "/js/apning.js",
  "/js/axes.js",
  "/js/bilder.js",
  "/js/bp-modus.js",
  "/js/clip.js",
  "/js/cmp-skjul.js",
  "/js/compare.js",
  "/js/config.js",
  "/js/csv.js",
  "/js/diagnose.js",
  "/js/display.js",
  "/js/elements.js",
  "/js/em-detalj.js",
  "/js/em-paring.js",
  "/js/em-regn.js",
  "/js/ferdig-lett.js",
  "/js/framdrift-kilde.js",
  "/js/framdrift-lett.js",
  "/js/framdrift-regn.js",
  "/js/framdrift-vis.js",
  "/js/frist.js",
  "/js/grupper.js",
  "/js/hjelp.js",
  "/js/hjul.js",
  "/js/html-lyttere.js",
  "/js/i18n.js",
  "/js/ifc.js",
  "/js/ifcrpc.js",
  "/js/kran-regn.js",
  "/js/lagring-status.js",
  "/js/lapp-kollisjon.js",
  "/js/lett-main.js",
  "/js/lett.js",
  "/js/lever.js",
  "/js/lite.js",
  "/js/lyd.js",
  "/js/maal-verktoy.js",
  "/js/maal.js",
  "/js/markerbilde.js",
  "/js/markering-flett.js",
  "/js/markers.js",
  "/js/materiell-vis.js",
  "/js/measure.js",
  "/js/minimap.js",
  "/js/mobile.js",
  "/js/modes.js",
  "/js/nett.js",
  "/js/nevning.js",
  "/js/nytt.js",
  "/js/oppsett.js",
  "/js/outline.js",
  "/js/pdf-utseende.js",
  "/js/pek-eier.js",
  "/js/planner-regn.js",
  "/js/planner.js",
  "/js/prefs.js",
  "/js/profiler.js",
  "/js/prop-kompakt.js",
  "/js/prosjektinfo-regn.js",
  "/js/prosjektinfo.js",
  "/js/rapport.js",
  "/js/regneark.js",
  "/js/rigg-modell.js",
  "/js/rigg-regn.js",
  "/js/rigg-vis.js",
  "/js/rull-fall.js",
  "/js/scene.js",
  "/js/share.js",
  "/js/sharepoint.js",
  "/js/sjekkliste.js",
  "/js/sp-flett.js",
  "/js/sp-lager.js",
  "/js/sporsmal.js",
  "/js/stalbunker-regn.js",
  "/js/state.js",
  "/js/stillas-modell.js",
  "/js/stillas-regn.js",
  "/js/stopeplan-lett.js",
  "/js/stopeplan-regn.js",
  "/js/stopeplan-tid.js",
  "/js/stopeplan-vis.js",
  "/js/stopesjekk-regn.js",
  "/js/sw-blikk.js",
  "/js/sw-lett.js",
  "/js/sw-reg.js",
  "/js/sw-tak.js",
  "/js/tak-lett.js",
  "/js/tegninger.js",
  "/js/tema.js",
  "/js/terreng-plate3d.js",
  "/js/terreng-regn.js",
  "/js/terreng-vis.js",
  "/js/ui.js",
  "/js/utfylling-regn.js",
  "/js/vaaken.js",
  "/js/vaer-felles.js",
  "/js/vaer-regn.js",
  "/js/varsel.js",
  "/js/vedleggko.js",
  "/js/verktoygrupper.js",
  "/js/viewcube.js",
  "/vendor/three-0.160.0/three.module.min.js",
  "/vendor/three-0.160.0/addons/loaders/GLTFLoader.js",
  "/vendor/three-0.160.0/addons/lines/LineSegmentsGeometry.js",
  "/vendor/three-0.160.0/addons/lines/LineMaterial.js",
  "/vendor/three-0.160.0/addons/lines/LineSegments2.js"
];
// Innholdet i hver fil (SHA-256, 16 tegn) – uendrede filer hentes fra forrige cache.
const SKALL_HASH = {
  "/bygg.html": "f147970651b4b2a7",
  "/css/storm.css": "1c81d3ceb306f539",
  "/img/favicon.svg": "48ffba3e7d9c7b40",
  "/img/favicon-32.png": "2f521c7514d1898c",
  "/img/apple-touch-icon.png": "76237b63b2fbe371",
  "/js/tema-tidlig.js": "6cd284abaadf6496",
  "/js/feilfanger.js": "2a787a955ce87f19",
  "/js/angre.js": "7799172c1fbae979",
  "/js/apning.js": "cbde55af8b61bd69",
  "/js/axes.js": "a6fe5e2e2d60000b",
  "/js/bilder.js": "f735de5833ae74c6",
  "/js/bp-modus.js": "3d03f5b14ef97ec4",
  "/js/clip.js": "e4b6d94b5b9eaaf7",
  "/js/cmp-skjul.js": "1256663341f92da9",
  "/js/compare.js": "aa0aad23eef47388",
  "/js/config.js": "4c36fc4bd01a01c8",
  "/js/csv.js": "2e189577299440b1",
  "/js/diagnose.js": "a676df6242ad407a",
  "/js/display.js": "ecbe1f1bfdb7ed76",
  "/js/elements.js": "6e7aa6be39a8c709",
  "/js/em-detalj.js": "82f43a862462b15f",
  "/js/em-paring.js": "846fb430766a4d42",
  "/js/em-regn.js": "eb7c60d132e10f63",
  "/js/ferdig-lett.js": "c3d9a9a05c412799",
  "/js/framdrift-kilde.js": "a7f136d131968dfc",
  "/js/framdrift-lett.js": "e861de34cc51cfc4",
  "/js/framdrift-regn.js": "551ba81b1a2539e5",
  "/js/framdrift-vis.js": "c4142d3020029583",
  "/js/frist.js": "a8b9725bed7f4019",
  "/js/grupper.js": "9ec7167644ff62d5",
  "/js/hjelp.js": "8693768267a29878",
  "/js/hjul.js": "51c95daa3f6c4763",
  "/js/html-lyttere.js": "4c71f3300ce69666",
  "/js/i18n.js": "ebbcfc0da9daa439",
  "/js/ifc.js": "6421f5b8b630af8e",
  "/js/ifcrpc.js": "22f354bdebcf0a9c",
  "/js/kran-regn.js": "b46bf91549869956",
  "/js/lagring-status.js": "509d3fe666c90210",
  "/js/lapp-kollisjon.js": "f088c2f7f0f53b1a",
  "/js/lett-main.js": "647a65ec4b534b0c",
  "/js/lett.js": "dfb09ffe063b7af5",
  "/js/lever.js": "665b40c0dbb73d01",
  "/js/lite.js": "c7bc92cb94e87c17",
  "/js/lyd.js": "b242f7076382a923",
  "/js/maal-verktoy.js": "4340193eac660297",
  "/js/maal.js": "2acd113b25e20987",
  "/js/markerbilde.js": "90b2d157ee4064cd",
  "/js/markering-flett.js": "fcfc9c1ab738e288",
  "/js/markers.js": "959369780c9f45a1",
  "/js/materiell-vis.js": "7ed64cdff172d95e",
  "/js/measure.js": "fcc7c8982e27169c",
  "/js/minimap.js": "b3cba566f7fcb6b1",
  "/js/mobile.js": "35b9d29eb90fb203",
  "/js/modes.js": "e6368b59b1c3aae8",
  "/js/nett.js": "7bb3e05eaeefd470",
  "/js/nevning.js": "e00cd45997ba8abe",
  "/js/nytt.js": "0f3eb002a1367e0e",
  "/js/oppsett.js": "976dd79579b7e4ee",
  "/js/outline.js": "8221bb3ebab49578",
  "/js/pdf-utseende.js": "f2ba84681f9c07fb",
  "/js/pek-eier.js": "b8b1ff0d708385a7",
  "/js/planner-regn.js": "03f9c03a90a450cf",
  "/js/planner.js": "fedd1da95a7b2f5a",
  "/js/prefs.js": "d1ef2b5cc2a1979d",
  "/js/profiler.js": "5da75a4643d06c84",
  "/js/prop-kompakt.js": "8af7b223ba372ad4",
  "/js/prosjektinfo-regn.js": "b8a88fa47fbd9366",
  "/js/prosjektinfo.js": "b2930b38e63b8687",
  "/js/rapport.js": "bb3c546eec0e9a08",
  "/js/regneark.js": "0632e44df4666293",
  "/js/rigg-modell.js": "8929295e8f0fd126",
  "/js/rigg-regn.js": "b2460e31c92375f0",
  "/js/rigg-vis.js": "7838190534bfd122",
  "/js/rull-fall.js": "07d34602216bed2e",
  "/js/scene.js": "168f4105c078f124",
  "/js/share.js": "2991897474ba4c7f",
  "/js/sharepoint.js": "82f4d94621a5d3cd",
  "/js/sjekkliste.js": "4ca405e426dbce44",
  "/js/sp-flett.js": "544b029855bed23d",
  "/js/sp-lager.js": "52faeaf1c0f4ea74",
  "/js/sporsmal.js": "19eeaa6662e9c26d",
  "/js/stalbunker-regn.js": "f690be8b703ae84e",
  "/js/state.js": "f80c9342f584a3d4",
  "/js/stillas-modell.js": "db1c4676b92a89ad",
  "/js/stillas-regn.js": "ec4b7127a1b84f37",
  "/js/stopeplan-lett.js": "9e0b3f85fb65635e",
  "/js/stopeplan-regn.js": "b0f5890398d34a01",
  "/js/stopeplan-tid.js": "e94fdea3598eb019",
  "/js/stopeplan-vis.js": "e633a2f8daad7197",
  "/js/stopesjekk-regn.js": "ddf3c65f4ccd0e08",
  "/js/sw-blikk.js": "4324ca343b978f0d",
  "/js/sw-lett.js": "17ae0431c1323de0",
  "/js/sw-reg.js": "f16f1879e6f75de8",
  "/js/sw-tak.js": "65deba72e58380db",
  "/js/tak-lett.js": "e2dc453b74aa25fe",
  "/js/tegninger.js": "ed9e36f0c8b54f98",
  "/js/tema.js": "84a1cc162bfccc45",
  "/js/terreng-plate3d.js": "e5f357ff48136cf3",
  "/js/terreng-regn.js": "bf926f1b6eaa2be7",
  "/js/terreng-vis.js": "54d2e70070686252",
  "/js/ui.js": "8a4ab9aa9739c965",
  "/js/utfylling-regn.js": "8d0fa3248f90c340",
  "/js/vaaken.js": "a1365c3709682001",
  "/js/vaer-felles.js": "74227f451696992d",
  "/js/vaer-regn.js": "5416fde741c17400",
  "/js/varsel.js": "408a9db4db0ffaee",
  "/js/vedleggko.js": "3a56df240b659784",
  "/js/verktoygrupper.js": "eecb3bbabfdf5dc5",
  "/js/viewcube.js": "45baaca855ac99be",
  "/vendor/three-0.160.0/three.module.min.js": "3e690ac7d180b0aa",
  "/vendor/three-0.160.0/addons/loaders/GLTFLoader.js": "d073b438e6a07e13",
  "/vendor/three-0.160.0/addons/lines/LineSegmentsGeometry.js": "59419cee5eccbaac",
  "/vendor/three-0.160.0/addons/lines/LineMaterial.js": "eed69bd471547ca0",
  "/vendor/three-0.160.0/addons/lines/LineSegments2.js": "5009e85ffbd09e86"
};
// Språkfilene: hentes med import() ved behov, IKKE en del av SKALL.
const SPRAKFILER = {
  en: "/js/sprak/en.js",
  lt: "/js/sprak/lt.js",
  pl: "/js/sprak/pl.js"
};
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
    //
    // IKONENE (/img/) ER IKKE KRITISKE og hentes hver for seg (Emils funn
    // 01.10): proxyen slapp ikke gjennom /img/, så addAll() feilet på
    // favicon-en — og da feilet HELE installasjonen. Den nye versjonen ble
    // aldri tatt i bruk, og PC-en som hadde den gamle (fra 25.08) sto fast på
    // den: byggeplass-siden viste verken SW-elementer, tak, terreng eller rigg.
    // Telefonen hadde ingen gammel service worker og hentet alt fra nett.
    // Ett manglende ikon skal aldri kunne stoppe koden.
    const kritisk = SKALL.filter(u => !/^\/img\//.test(u));
    // ⚡ Forslag 9 (24.11): UENDREDE FILER TAS MED FRA FORRIGE VERSJON. Før
    // lastet hver ny versjon ned hele skallet (~3 MB) på nytt, også når bare
    // én fil var endret. Nå hentes en fil fra forrige skallcache når den har
    // nøyaktig samme innhold (x-storm-hash = SKALL_HASH), ellers fra nettet.
    // Fortsatt ALT-ELLER-INGENTING: alle svarene samles først, og feiler én
    // (ikke ok eller ingen nett), kastes det, og ingenting legges i cachen –
    // akkurat som addAll. Merket settes bare når bytene som kom, faktisk har
    // riktig hash; en gammel kopi fra Cloudflare blir derfor aldri gjenbrukt.
    const gamle = await gamleSkallCacher();
    const svar = await Promise.all(kritisk.map(u => hentSkallfil(u, gamle)));
    for (let i = 0; i < kritisk.length; i++) await c.put(kritisk[i], svar[i]);
    for (const u of SKALL) {
      if (kritisk.indexOf(u) !== -1) continue;
      try { await c.add(new Request(u, { cache: "reload" })); }
      catch (err) { console.warn("Fikk ikke forhåndslagret " + u, err); }
    }

    // SPRÅKET TELEFONEN STÅR I — og bare det. De tre ordbøkene er ~105 kB hver,
    // og montøren som leser norsk skal ikke betale for polsk og litauisk han
    // aldri åpner. Norsk koster ingenting: den norske teksten ER nøkkelen i
    // js/i18n.js, så det finnes ingen norsk ordbok å laste.
    //
    // navigator.language, ikke det valgte språket i appen: service workeren
    // installeres FØR noen har valgt noe. Velger montøren et annet språk
    // senere, lagres den fila når den hentes (se fetch-håndtereren), og
    // ⚙ Innstillinger sier fra at det må gjøres mens han har dekning.
    //
    // UTENFOR addAll, med vilje: addAll er alt-eller-ingenting. En ordbok som
    // ikke lar seg hente skal ikke ta ned hele installasjonen — da mister
    // montøren offline-modellen for å spare en oversettelse han får på norsk.
    const sprakUrl = SPRAKFILER[telefonensSprak()];
    if (sprakUrl) {
      try { await c.add(new Request(sprakUrl, { cache: "reload" })); }
      // Logges, ikke svelges: teksten står på norsk og montøren merker
      // ingenting, men vi skal kunne se hvorfor i konsollen.
      catch (e) { console.warn("Fikk ikke forhåndslagret ordboka " + sprakUrl, e); }
    }
  })());
});

// Forrige versjons skallcacher (de slettes først i activate).
async function gamleSkallCacher() {
  const ut = [];
  try {
    for (const n of await caches.keys()) if (n.startsWith("storm-skall-") && n !== SKALL_CACHE) ut.push(await caches.open(n));
  } catch (_) { /* uten gamle cacher: alt hentes fra nett */ }
  return ut;
}
async function hentSkallfil(u, gamle) {
  const h = typeof SKALL_HASH === "object" ? SKALL_HASH[u] : "";
  if (h) for (const g of gamle) {
    try {
      const r = await g.match(u);
      if (r && r.headers && r.headers.get("x-storm-hash") === h) return r;
    } catch (_) { /* hent fra nett */ }
  }
  const r = await fetch(new Request(u, { cache: "reload" }));
  if (!r || !r.ok) throw new Error("Fikk ikke hentet " + u + " (" + (r ? r.status : "ingen svar") + ")");
  return merkHash(r, h);
}
// Merker svaret med hashen når bytene stemmer. Uten Web Crypto, eller når
// bytene ikke stemmer, lagres det umerket – og hentes på nytt neste versjon.
async function merkHash(r, h) {
  const subtle = (self.crypto && self.crypto.subtle) || (typeof crypto !== "undefined" && crypto && crypto.subtle);
  if (!h || !subtle) return r;
  try {
    const buf = await r.clone().arrayBuffer();
    const d = new Uint8Array(await subtle.digest("SHA-256", buf));
    let hex = "";
    for (let i = 0; i < 8; i++) hex += d[i].toString(16).padStart(2, "0");
    if (hex !== h) return r;
    const hode = new Headers(r.headers);
    hode.set("x-storm-hash", h);
    return new Response(buf, { status: r.status, statusText: r.statusText, headers: hode });
  } catch (_) { return r; }
}

// Tobokstavskoden telefonen er satt opp med: "pl-PL" og "pl" gir begge "pl".
function telefonensSprak() {
  const l = (self.navigator && self.navigator.language) || "no";
  return String(l).slice(0, 2).toLowerCase();
}

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
  // 🔗 17.11: delte lenker til byggherren (/d/…) og Storm Prosjekter-rutene
  // (/sp/…) er ikke byggeplass-siden. Før fikk en PDF fra en byggherre-lenke
  // bygg.html (uten stil) hvis nettleseren hadde brukt Storm Byggeplass før.
  // Må stå FØR navigasjonen under.
  if (url.origin === self.location.origin && (url.pathname.startsWith("/d/") || url.pathname.startsWith("/sp/"))) return;
  // Fremmede domener rører vi ikke. jsDelivr (web-ifc, QR-biblioteket) og
  // Microsoft Graph hører ikke hjemme i en cache vi styrer.
  if (url.origin !== self.location.origin) return;

  // Navigasjon: /, /20653 og alt annet som er en sidelast.
  if (req.mode === "navigate") { e.respondWith(navigasjon()); return; }

  const p = url.pathname;

  if (SKALL.indexOf(p) !== -1) { e.respondWith(fraSkall(req, p)); return; }

  // Ordbøkene. Ikke i SKALL – bare én av dem er forhåndslagret – men den
  // montøren faktisk velger skal bli liggende, så språkbyttet holder seg
  // neste gang han er uten dekning.
  if (erSprakfil(p)) { e.respondWith(sprakfil(req, p)); return; }

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
//   js/sprak/<de andre språkene>                   — lagres først ved bruk
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

function erSprakfil(p) {
  for (const k in SPRAKFILER) if (SPRAKFILER[k] === p) return true;
  return false;
}

// Cache først, ellers nett — og det som hentes fra nettet BLIR LIGGENDE.
// Det er forskjellen fra fraSkall(): skallet er forhåndslagret i sin helhet,
// så en bom der er en feil. Her er bom det normale, én gang per språk.
// Cachen er versjonsnavngitt, så en rettet oversettelse rydder seg selv bort.
async function sprakfil(req, p) {
  const c = await caches.open(SKALL_CACHE);
  const cachet = await c.match(p);
  if (cachet) return cachet;
  const svar = await fetch(req);
  if (svar && svar.ok) await c.put(p, svar.clone());
  return svar;
}

// Modellen. Adressen har ?v=<opplastingstid> og er merket immutable, så en
// truffet kopi er per definisjon riktig kopi.
async function modell(req) {
  const c = await caches.open(DATA_CACHE);
  const cachet = await c.match(req);
  if (cachet) return cachet;
  const svar = await fetch(req);
  // 🔒 Tilgangen er borte (prosjektet avsluttet, koden byttet): ikke la noe
  // av prosjektet bli liggende på telefonen. Se tilgangBorte() nedenfor.
  if (svar && tilgangBorte(svar)) { await glemProsjekt(c, new URL(req.url).pathname); return svar; }
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
    // 🔒 Serveren SVARTE, og svaret er «du har ikke tilgang». Da er det ikke
    // dårlig dekning, og den lagrede kopien skal IKKE reddes frem — ellers ville
    // en telefon med gammel kode fortsatt vist markeringene (og via
    // modell-cachen hele modellen) etter at prosjektet er avsluttet. Kopien
    // slettes, og 401/403 går videre til siden, som da ber om koden.
    if (svar && tilgangBorte(svar)) { await glemProsjekt(c, new URL(req.url).pathname); return svar; }
  } catch (_) {}
  // Hit kommer vi bare når fetch KASTET (ingen nett, tidsavbrudd) eller
  // serveren svarte noe annet enn ok/401/403 (f.eks. 5xx). Da er den lagrede
  // kopien riktig svar — det er hele poenget med denne fila.
  const cachet = await c.match(req);
  if (cachet) return cachet;
  // Ingen kopi. Et ærlig 504 er bedre enn en tom liste: js/markers.js viser
  // «Fikk ikke hentet markeringene» på alt som ikke er 404.
  return new Response("Ingen nett og ingen lagret kopi av markeringene.", { status: 504 });
}

// 401 = ingen/ugyldig kode, 403 = koden gjelder ikke (lenger) for prosjektet.
function tilgangBorte(svar) { return svar.status === 401 || svar.status === 403; }

// Sletter ALT dette prosjektet har i datacachen: modellen (alle ?v=) og
// markeringene. Prosjektnummeret hentes fra stien (/modell/20653/…,
// /markeringer/20653/…). Kommer avslaget på markeringene, går modellen også —
// den er cache-først og ville ellers aldri spurt serveren igjen. Andre
// prosjekter på samme telefon røres ikke.
async function glemProsjekt(c, sti) {
  const m = /^\/(?:modell|markeringer)\/(\d{5})\//.exec(sti);
  if (!m) return;
  const prefikser = ["/modell/" + m[1] + "/", "/markeringer/" + m[1] + "/"];
  for (const n of await c.keys()) {
    const p = new URL(n.url).pathname;
    if (prefikser.some(x => p.startsWith(x))) await c.delete(n);
  }
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
