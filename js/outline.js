// ▣ Kantlinjer (outline): en strek langs kantene på geometrien, så det ene
// objektet lar seg skille fra det andre når man ser på detaljer.
//
// ---------------------------------------------------------------------------
// HVORFOR IKKE BARE LineBasicMaterial MED linewidth
//
// Fordi den ikke virker. `linewidth` på et vanlig linjemateriale ignoreres av
// WebGL på Windows og Android — streken blir alltid 1 piksel, uansett hva du
// setter. En tykkelse-slider som ikke gjør noe er verre enn ingen slider, så
// linjene tegnes med three-ens «fat lines» (LineSegments2 + LineMaterial), som
// bygger hver strek som to trekanter og derfor kan være så tykk du vil.
//
// HVORFOR MOTOREN LASTES MED import() OG IKKE ØVERST
//
// De tre addon-filene er ~40 kB, og funksjonen er AV som standard. Den som
// aldri slår den på skal ikke betale for den ved hver sidelast. Filene er
// likevel med i service workerens skall (se verktoy/lag-sw-liste.mjs), slik at
// montøren kan slå på kantlinjer uten dekning — ellers hadde knappen vært død
// akkurat der den trengs mest, uten en feilmelding.
//
// HVORFOR LINJENE HENGER PÅ HVERT MESH, IKKE I EN EGEN GRUPPE
//
// Et skjult element skal ikke ha kantlinjer igjen svevende i lufta. Legger vi
// linjene som BARN av meshet, arver de både plasseringen og synligheten: skjul
// meshet, og linjene forsvinner med det. Alternativet — én samlet gruppe i
// scenen — måtte bygget om hver gang noen skjulte noe, og den ombyggingen ville
// vært en ny feilkilde for hver eneste vei inn i «skjul».
//
// Prisen er én tegneoperasjon per mesh. Verktøyet tegner allerede ett mesh per
// element i full kvalitet, så kantlinjer på ÉN elementtype er en påplussing i
// samme størrelsesorden som typen selv. Derfor finnes både den globale bryteren
// og av/på per type: den som har en tung modell slår den på der han trenger den.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { frameHooks, renderer, scene } from "./scene.js";

// Under denne vinkelen regnes to flater som samme flate, og det trekkes ingen
// strek mellom dem. 20° tar hjørnene på en bjelke uten å streke opp hver eneste
// trekant i et rundt rør.
export const KANT_VINKEL = 20;

export const TYKK_MIN = 1;
export const TYKK_MAKS = 6;
export const TYKK_STANDARD = 2;

// Nøkkelen som brukes når modellen ikke har elementtyper å gruppere på
// (🪶 lav kvalitet og 💾 lett kopi er slått sammen per farge, ikke per type).
export const ALLE = "*";

// ---------- Rene funksjoner (prøves direkte i _test/test-outline.mjs) ----------

// Slideren er i hele piksler. Alt annet – tomt felt, tekst, 0, 99 – skal gi noe
// som lar seg tegne, ikke en usynlig eller altoppslukende strek.
export function vaskTykkelse(v) {
  // Tomt felt FØRST: Number("") er 0, ikke NaN, og 0 ville blitt kappet opp til
  // 1 px i stedet for å gi standardverdien tilbake. Forskjellen er liten, men
  // «feltet er tomt» og «brukeren skrev 0» er ikke det samme.
  if (v === "" || v === null || v === undefined) return TYKK_STANDARD;
  const n = Number(v);
  if (!isFinite(n)) return TYKK_STANDARD;
  return Math.min(TYKK_MAKS, Math.max(TYKK_MIN, Math.round(n)));
}

// Skal denne elementtypen ha kantlinjer? Den globale bryteren slår ut alt annet
// – det er dette som gjør at knappene i 🎨 Utseende låses når den står på.
export function outlineAktiv(key, global, typer) {
  if (global) return true;
  return Array.isArray(typer) && typer.indexOf(key) !== -1;
}

// Svart strek på svart bakgrunn er ingen strek. Fargen velges ut fra hvor lys
// bakgrunnen er, så den virker både i mørkt og lyst tema – og på en hvit
// bakgrunn valgt for hånd i 🎨 Utseende.
export function kantfarge(bgHex) {
  const n = Number(bgHex) || 0;
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const lys = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lys > 0.5 ? 0x11161d : 0xe8ecf2;
}

// ---------- Motoren (lastes ved første bruk) ----------

let LINJE = null;

async function hentLinjemotor() {
  if (LINJE) return LINJE;
  const [g, m, s] = await Promise.all([
    import("three/addons/lines/LineSegmentsGeometry.js"),
    import("three/addons/lines/LineMaterial.js"),
    import("three/addons/lines/LineSegments2.js")
  ]);
  // I testene byttes addon-stiene mot three-stubben, og da finnes ikke klassene.
  // Uten denne sjekken hadde feilen kommet som «X is not a constructor» langt
  // inne i byggingen, med en halvbygd modell igjen i scenen.
  if (!g.LineSegmentsGeometry || !m.LineMaterial || !s.LineSegments2)
    throw new Error("Linjemotoren mangler klassene");
  LINJE = { Geo: g.LineSegmentsGeometry, Mat: m.LineMaterial, Seg: s.LineSegments2 };
  return LINJE;
}

// ---------- Materialet: ett, delt av alle linjene ----------

let mat = null;

function materiale() {
  if (mat) return mat;
  mat = new LINJE.Mat({
    color: kantfarge(scene.background ? scene.background.getHex() : 0),
    linewidth: vaskTykkelse(S.settings.outlineTykkelse),
    worldUnits: false          // tykkelsen er PIKSLER, ikke meter: en strek skal
                               // være like tydelig nær som langt unna
  });
  mat.resolution.set(innerWidth, innerHeight);
  // Linjene ligger nøyaktig oppå flatene de kommer fra. Uten en dytt mot
  // kameraet flimrer de av og på når man roterer (z-fighting), og det ser ut
  // som en feil i modellen.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  mat.polygonOffsetUnits = -4;
  return mat;
}

// ---------- Bokføring ----------

// Alle linjeobjektene som henger på et mesh NÅ. Lista er den eneste veien til
// dem utenfra (minikartet skjuler dem, se S.outlineSynlig).
const registrerte = [];

// Modellbytte: meshene og geometrien deres er alt frigitt av clearModel, men
// lista må tømmes – ellers holder den forrige modell i live i minnet.
// Kroken kalles av nullstillModellState() i state.js.
S.ryddOutline = () => { registrerte.length = 0; };

// Brukes av minikartet: kartet er en silhuett sett rett ovenfra, og med
// kantlinjer på blir det en svart flekk. (Tykkelsen er i skjermpiksler, og
// kartet tegnes 180 px bredt – hver strek ville dekket halve bygget.)
S.outlineSynlig = (v) => { for (const o of registrerte) o.visible = !!v; };

// Brukes av fangstBilde() i scene.js: rapportbildet tegnes i en annen
// oppløsning enn skjermen, og tykkelsen regnes ut fra oppløsningen. Uten dette
// blir strekene i PDF-en tynnere eller tykkere enn de var på skjermen.
// Rammestørrelsen nullstilles, så rammekroken under setter den tilbake selv.
S.outlineOpplosning = (b, h) => {
  if (!mat) return;
  mat.resolution.set(b, h);
  sisteBredde = -1;
};

// ---------- Rammekroken: holder oppløsning og farge i takt ----------

const _st = new THREE.Vector2();
let sisteBredde = -1, sisteHøyde = -1, sisteBg = -1;

frameHooks.push(() => {
  if (!mat) return;
  renderer.getSize(_st);
  if (_st.x !== sisteBredde || _st.y !== sisteHøyde) {
    sisteBredde = _st.x; sisteHøyde = _st.y;
    mat.resolution.set(_st.x, _st.y);
  }
  const bg = scene.background ? scene.background.getHex() : 0;
  if (bg !== sisteBg) { sisteBg = bg; mat.color.setHex(kantfarge(bg)); }
});

// ---------- Bygging ----------

// Meshene gruppert på elementtype. Uten typeinfo (lav kvalitet / lett kopi)
// er hele modellen én gruppe – da finnes ikke per-type-knappene heller, og
// bare den globale bryteren gjelder.
export function outlineGrupper() {
  const ut = new Map();
  if (!S.modelGroup) return ut;
  if (S.typeInfo && S.typeInfo.size) {
    for (const [key, g] of S.typeInfo) ut.set(key, g.meshes);
    return ut;
  }
  ut.set(ALLE, S.modelGroup.children.filter(o => o.isMesh));
  return ut;
}

function byggFor(m) {
  const kant = new THREE.EdgesGeometry(m.geometry, KANT_VINKEL);
  const pos = kant.getAttribute("position");
  const arr = pos && pos.array;
  kant.dispose();                       // kantene er kopiert ut; geometrien trengs ikke
  if (!arr || arr.length < 6) return;   // ingen kanter over terskelen
  const g = new LINJE.Geo();
  g.setPositions(arr);
  g.computeBoundingBox();
  g.computeBoundingSphere();            // uten disse blir linjene klippet bort av
                                        // frustum-testen så fort man zoomer inn
  const linjer = new LINJE.Seg(g, materiale());
  linjer.raycast = () => {};            // linjene skal aldri kunne velges eller måles på
  linjer.userData.stormOutline = true;
  m.add(linjer);
  m.userData.outline = linjer;
  registrerte.push(linjer);
}

function fjernFra(linjer) {
  const m = linjer.parent;
  if (m) { m.remove(linjer); delete m.userData.outline; }
  if (linjer.geometry) linjer.geometry.dispose();
}

const pust = () => new Promise(r => setTimeout(r, 0));

// Over dette antallet vises lasteoverlegget. Under går byggingen så fort at et
// overlegg bare hadde blinket.
const VIS_FRAMDRIFT_OVER = 300;

let kjører = false;
let påNytt = false;

// Setter scenen i takt med innstillingene. Trygg å kalle så ofte man vil:
// bygger bare det som mangler, og fjerner bare det som ikke skal være der.
export async function oppdaterOutline() {
  // To kall som overlapper ville bygget de samme linjene to ganger og lagt dem
  // oppå hverandre. Det andre kallet venter, og kjøres én gang etterpå.
  if (kjører) { påNytt = true; return; }
  kjører = true;
  try { await gjørOppdatering(); }
  finally {
    kjører = false;
    if (påNytt) { påNytt = false; oppdaterOutline(); }
  }
}

async function gjørOppdatering() {
  if (!S.modelGroup) return;
  const global = !!(S.settings && S.settings.outline);
  const typer = (S.appear && S.appear.outlineTypes) || [];

  const skal = new Set();
  for (const [key, meshes] of outlineGrupper())
    if (outlineAktiv(key, global, typer)) for (const m of meshes) skal.add(m);

  // 1. Fjern det som ikke skal være der lenger
  for (let i = registrerte.length - 1; i >= 0; i--) {
    const linjer = registrerte[i];
    if (!linjer.parent || !skal.has(linjer.parent)) {
      fjernFra(linjer);
      registrerte.splice(i, 1);
    }
  }

  // 2. Bygg det som mangler
  const mangler = [...skal].filter(m => !m.userData.outline);
  if (!mangler.length) { settTykkelse(); return; }

  try { await hentLinjemotor(); }
  catch (err) {
    // Uten nett første gang, eller hvis filene mangler i vendor-mappa. Feilen
    // skrives i ⚙ Innstillinger, ikke bare i konsollen: den som har krysset av
    // og ikke ser noen streker skal få vite hvorfor.
    console.warn("Kantlinjer: linjemotoren kunne ikke lastes:", err);
    S.outlineFeil = true;
    if (S.onOutlineFeil) S.onOutlineFeil();
    return;
  }
  S.outlineFeil = false;

  const vis = mangler.length > VIS_FRAMDRIFT_OVER;
  if (vis) { loadingEl.classList.add("open"); loadingText.textContent = t("Tegner kantlinjer …"); }
  try {
    for (let i = 0; i < mangler.length; i++) {
      byggFor(mangler[i]);
      if ((i & 255) === 255) {
        if (vis) loadingText.textContent =
          t("Tegner kantlinjer …") + " " + Math.round((i + 1) / mangler.length * 100) + " %";
        await pust();
      }
    }
  } finally {
    if (vis) loadingEl.classList.remove("open");
  }
  settTykkelse();
}

// Tykkelsen bor på det ene delte materialet, så slideren treffer alt på én gang
// – ingen gjennomgang av modellen, ingen ombygging av geometri.
export function settTykkelse() {
  if (!mat) return;
  mat.linewidth = vaskTykkelse(S.settings.outlineTykkelse);
}
