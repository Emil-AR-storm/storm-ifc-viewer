// Genererer fillista og versjonen som service workeren forhåndslagrer.
//
// Bruk:  node "verktoy/lag-sw-liste.mjs"
// Kjøres FØR hver push som rører bygg.html, js/, css/ eller vendor/.
// Glemmer du det, feiler _test/test-sw.mjs. Det er hele poenget med at den
// testen finnes — se under.
//
// ---------------------------------------------------------------------------
// HVORFOR LISTA GENERERES OG IKKE SKRIVES FOR HÅND
//
// En service worker må vite navnet på hver fil den skal forhåndslagre FØR den
// installerer. Den kan ikke liste en mappe over HTTP, og den kan ikke følge
// import-grafen selv. Alternativet er en håndskrevet liste — og en håndskrevet
// liste går stille ut av takt første gang noen legger til en modul. Da
// installerer service workeren fint, mangler én fil, og montøren får en side
// som er halvveis offline. Det er nøyaktig den typen feil ingen oppdager.
//
// HVORFOR VERSJONEN ER EN HASH AV INNHOLDET
//
// Cache-navnet inneholder versjonen. Endrer én byte i én fil seg, endrer
// hashen seg, cache-navnet endrer seg, og den gamle cachen slettes i activate.
// En dato eller et løpenummer måtte noen husket å øke — og den dagen noen
// glemmer det, sitter telefonene på byggeplassen fast på gammel kode i dagevis
// uten at noen skjønner hvorfor. Det er den verste feilen i dette systemet.
//
// HVORFOR BLOKKEN SKRIVES INN I sw.js OG IKKE I EN EGEN FIL
//
// Nettleseren bestemmer om service workeren skal oppdateres ved å sammenligne
// BYTENE i sw.js med den som kjører. Lå lista i en egen fil som sw.js hentet
// med importScripts(), ville sw.js vært bit for bit identisk fra versjon til
// versjon — og oppdateringen ville hengt på at nettleseren også sammenligner
// importerte skript. Det GJØR moderne nettlesere, men vi vil ikke at den
// viktigste garantien i systemet skal hvile på en detalj i spesifikasjonen.
// Lista står i sw.js. Da endrer sw.js seg alltid når noe endrer seg.
//
// HVA SOM IKKE ER MED — se listen «UTELATT» nederst i utskriften. Den skrives
// hver gang, med grunn, så ingen tror at «forhåndslagret» betyr «alt».
// ---------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const les = (p) => fs.readFileSync(path.join(ROT, p), "utf8");
const finnes = (p) => fs.existsSync(path.join(ROT, p));

// ---------- 1. Følg import-grafen fra inngangspunktet ----------
//
// BARE STATISKE IMPORTER. En dynamisk import() kjører først når koden faktisk
// ber om den, og i lettmodus er alle knappene som utløser dem skjult
// (krymping, rapport). Å forhåndslaste dem hadde kostet montøren ~475 kB på
// dårlig dekning for funksjoner han ikke har.
const IMPORT_RE = /^\s*(?:import|export)\s[\s\S]*?from\s*["']([^"']+)["']/gm;
const BARE_IMPORT_RE = /^\s*import\s*["']([^"']+)["']/gm;
const DYNAMISK_RE = /\bimport\s*\(\s*["']([^"']+)["']/g;

const dynamiske = new Set();

function grafFra(start) {
  const sett = new Set();
  const kø = [start];
  while (kø.length) {
    const fil = kø.shift();
    if (sett.has(fil)) continue;
    sett.add(fil);
    const kode = les(fil);
    const mappe = path.posix.dirname(fil);
    const treff = [];
    for (const m of kode.matchAll(IMPORT_RE)) treff.push(m[1]);
    for (const m of kode.matchAll(BARE_IMPORT_RE)) treff.push(m[1]);
    for (const m of kode.matchAll(DYNAMISK_RE)) dynamiske.add(m[1]);
    for (const spec of treff) {
      // «three» og «three/addons/…» løses av importmap-en, ikke av mappa.
      // De håndteres for seg under.
      if (!spec.startsWith(".")) continue;
      const nes = path.posix.normalize(path.posix.join(mappe, spec));
      if (!finnes(nes)) throw new Error("Importen finnes ikke på disk: " + spec + " (fra " + fil + ")");
      kø.push(nes);
    }
  }
  return [...sett].sort();
}

const moduler = grafFra("js/lett-main.js");

// js/sw-reg.js lastes med DYNAMISK import() fra lett-main.js, og faller derfor
// utenfor grafen over. Den skal likevel forhåndslagres — uten den registreres
// ingen service worker ved neste besøk, og offline slutter stille å virke.
//
// Grunnen til at den er dynamisk står i lett-main.js: som vanlig import tok en
// manglende fil ned HELE siden. Prisen for den robustheten er denne ene
// eksplisitte linja, og et modulnavn her er lettere å se enn en side som er død.
if (finnes("js/sw-reg.js") && moduler.indexOf("js/sw-reg.js") === -1) {
  moduler.push("js/sw-reg.js");
  moduler.sort();
}

// ---------- 2. bygg.html: css og importmap ----------
const html = les("bygg.html");

const css = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/g)].map(m => m[1]);
for (const f of css) if (!finnes(f)) throw new Error("CSS-fila finnes ikke: " + f);

// Ikonene (favicon, app-ikon) leses av <link rel="icon"/"apple-touch-icon">
// på samme måte: legges et nytt ikon i bygg.html, følger det med i skallet.
// Uten dem i cachen står fanen uten merke når montøren er uten dekning.
const ikoner = [...html.matchAll(/<link[^>]+rel=["'](?:icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/g)].map(m => m[1]);
for (const f of ikoner) if (!finnes(f)) throw new Error("Ikonfila finnes ikke: " + f);

// Importmap-en er den ENESTE stedet three-adressen står. Leser vi den herfra,
// kan ingen oppgradere three uten at lista følger med av seg selv.
const imKilde = (html.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1];
if (!imKilde) throw new Error("Fant ingen importmap i bygg.html");
const im = JSON.parse(imKilde).imports || {};
const treUrl = (im["three"] || "").replace(/^\.\//, "");
if (!treUrl || !finnes(treUrl)) throw new Error("importmap-en peker på en three som ikke finnes: " + treUrl);
const addonRot = (im["three/addons/"] || "").replace(/^\.\//, "");

// three-motoren trengs alltid. Av addons trengs BARE lasteren: byggeplassen
// åpner ferdige .glb-er. GLTFExporter og BufferGeometryUtils hører til
// krympingen (js/lite.js), som er prosjektlederens funksjon og skjult her.
const vendor = [treUrl];
const lasteren = addonRot + "loaders/GLTFLoader.js";
if (finnes(lasteren)) vendor.push(lasteren);

// ▣ Kantlinjene (js/outline.js) laster «fat lines» med import() først når noen
// krysser av for dem. En dynamisk import står ikke i grafen over, og filene
// ville derfor ikke vært forhåndslagret — knappen hadde vært død uten dekning,
// akkurat der den trengs mest, og uten en feilmelding som forklarte hvorfor.
// De tre filene er ~40 kB til sammen, mot three-motorens ~600 kB. Verdt det.
for (const f of ["lines/LineSegmentsGeometry.js", "lines/LineMaterial.js", "lines/LineSegments2.js"]) {
  const sti = addonRot + f;
  if (finnes(sti)) vendor.push(sti);
}

// ---------- 3. Sett sammen ----------
const skall = ["bygg.html", ...css, ...ikoner, ...moduler, ...vendor].map(f => "/" + f);

// Versjonen: hash av innholdet i ALLE filene i skallet, i fast rekkefølge.
// Filnavnene er med i hashen, så en fil som fjernes gir også ny versjon.
const h = crypto.createHash("sha256");
for (const f of skall) { h.update(f); h.update(fs.readFileSync(path.join(ROT, f.slice(1)))); }
const versjon = h.digest("hex").slice(0, 12);

// ---------- 4. Skriv blokken inn i sw.js ----------
const START = "// ---- GENERERT BLOKK START (verktoy/lag-sw-liste.mjs) ----";
const SLUTT = "// ---- GENERERT BLOKK SLUTT ----";

export function byggBlokk() {
  return START + "\n" +
    "// IKKE REDIGER FOR HÅND. Kjør: node \"verktoy/lag-sw-liste.mjs\"\n" +
    "const SW_VERSJON = \"" + versjon + "\";\n" +
    "const SKALL = [\n" +
    skall.map(f => "  \"" + f + "\"").join(",\n") + "\n];\n" +
    SLUTT;
}

// Kjøres den som verktøy (ikke importert av testen), skriver den fila.
const kjørtDirekte = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (kjørtDirekte) {
  const swSti = path.join(ROT, "sw.js");
  if (!fs.existsSync(swSti)) { console.error("Fant ikke sw.js i rota."); process.exit(1); }
  const sw = fs.readFileSync(swSti, "utf8");
  const i = sw.indexOf(START), j = sw.indexOf(SLUTT);
  if (i === -1 || j === -1) { console.error("Fant ikke de genererte markørene i sw.js."); process.exit(1); }
  const ny = sw.slice(0, i) + byggBlokk() + sw.slice(j + SLUTT.length);
  const endret = ny !== sw;
  fs.writeFileSync(swSti, ny);

  let bytes = 0;
  for (const f of skall) bytes += fs.statSync(path.join(ROT, f.slice(1))).size;

  console.log((endret ? "sw.js OPPDATERT" : "sw.js var allerede i takt") + " — versjon " + versjon);
  console.log("  " + skall.length + " filer, " + Math.round(bytes / 1024) + " kB");
  console.log("    " + moduler.length + " moduler · " + css.length + " css · " + vendor.length + " vendor · 1 html");
  console.log("\nUTELATT MED VILJE (dette er IKKE forhåndslagret):");
  console.log("  · three-addons utenom GLTFLoader og lines/ — krymping og eksport er skjult i lettmodus");
  console.log("  · vendor/jspdf — rapporten er skjult i lettmodus");
  console.log("  · js/ifc-worker.js + web-ifc fra jsDelivr — byggeplassen åpner ferdige .glb,");
  console.log("    IFC-tråden startes aldri (ifcReady er Promise.resolve() i js/ifc.js)");
  if (dynamiske.size) {
    console.log("  · dynamiske import(): " + [...dynamiske].sort().join(", "));
    console.log("    (lastes først når koden ber om dem — knappene er skjult i lettmodus)");
  }
  console.log("  · modell, markeringer, bilder og tegninger — de caches ved bruk, ikke ved installasjon");
}

export { skall, versjon, moduler, css, vendor, START, SLUTT };
