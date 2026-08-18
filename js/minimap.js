// 🗺 Minikart: toppvisning med kameraprikk, trykk for å flytte deg.
import * as THREE from "three";
import { $, esc, S, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { axesGroup, camera, controls, frameHooks, grid, koteGroup, markerGroup, measureGroup, renderer, scene, selGroup } from "./scene.js";

// ---------- 🗺 Minikart (ovenfra, trykk for å flytte deg) ----------
export const miniCanvas = $("miniMap");

export function renderMiniMap() {
  S.miniInfo = null; S.miniBase = null;
  if (!S.modelGroup || !S.modelBox) { miniCanvas.style.display = "none"; return; }
  const size = 256;

  // Alt som skal settes tilbake leses FØR try-blokka. Leste vi det inne i try
  // og heiste variablene med null-verdier, ville en feil på første linje gitt
  // renderer.clippingPlanes = null i finally – og three.js venter et array.
  // Da hadde vi byttet et sjeldent svart skjerm mot et garantert et.
  const overlays = [markerGroup, measureGroup, koteGroup, axesGroup, selGroup];
  const vis = overlays.map(g => g.visible);
  const gridVis = grid.visible;
  const prevClip = renderer.clippingPlanes;
  let rt = null;

  try {
    const c = S.modelBox.getCenter(new THREE.Vector3());
    const half = (Math.max(S.modelBox.max.x - S.modelBox.min.x, S.modelBox.max.z - S.modelBox.min.z) / 2) * 1.06 || 1;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, (S.modelBox.max.y - S.modelBox.min.y) + S.modelSize);
    cam.position.set(c.x, S.modelBox.max.y + S.modelSize * 0.2, c.z);
    cam.up.set(0, 0, -1);
    cam.lookAt(c.x, S.modelBox.min.y, c.z);
    cam.updateMatrixWorld(true);
    // render toppvisning uten overlegg/klipping til en offscreen-buffer
    rt = new THREE.WebGLRenderTarget(size, size);
    overlays.forEach(g => g.visible = false);
    grid.visible = false;
    renderer.clippingPlanes = [];
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    const ctx = miniCanvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    S.miniBase = img;
    S.miniInfo = { cx: c.x, cz: c.z, half, size };
    drawMiniOverlay(true);
    miniCanvas.style.display = S.miniOn ? "block" : "none";
    tegnEtasjeBoks();          // ny modell = ny etasjeliste, og valget er nullstilt
    if (S.applyCubePos) S.applyCubePos();
  } catch (err) {
    // Kartet er en hjelp, ikke en forutsetning – men feilen skal være synlig.
    // Den stumme catch(_) her er grunnen til at dette aldri ble oppdaget før.
    console.warn("Minikartet kunne ikke tegnes:", err);
    // MÅ nullstilles: drawMiniOverlay ligger i frameHooks og kaster ellers
    // 60 ganger i sekundet hvis vi rakk å sette miniBase før feilen.
    S.miniInfo = null; S.miniBase = null;
    miniCanvas.style.display = "none";
    tegnEtasjeBoks();
  } finally {
    // Rekkefølgen betyr noe: løs bufferen FØR den disponeres.
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = prevClip;
    overlays.forEach((g, i) => g.visible = vis[i]);
    grid.visible = gridVis;
    if (rt) rt.dispose();
  }
}

const _miniLast = { tx: NaN, tz: NaN, kx: NaN, kz: NaN };

// FALLGRUVE: drawMiniOverlay ligger i frameHooks og kalles 60 ganger i sekundet.
// Hopp-ut-sjekken under er derfor det eneste som holder kostnaden nede.
//
// Markeringene tegnes nå oppå kartet, og de kan endre seg UTEN at kamera flytter
// seg — en status byttes, en frist settes. Uten et flagg måtte vi enten gå
// gjennom hele markeringslista hvert bilde for å oppdage det, eller la endringen
// bli usynlig til noen panorerte. Derfor: den som endrer noe setter
// S.miniSkitten = true, og kartet tegner én gang til.
//
// Flagget settes fra markers.js via S, ikke ved at markers.js importerer denne
// fila — en ny import ville flyttet på modulrekkefølgen, og denne fila gjør
// DOM-oppslag på toppnivå.
const MARKER_KANT = "#14181f";   // samme mørke som markeringene i 3D

function drawMiniOverlay(force) {
  if (!S.miniInfo || !S.miniBase) return;
  const t = controls.target, k = camera.position;
  const skitten = !!S.miniSkitten;
  if (!force && !skitten &&
      t.x === _miniLast.tx && t.z === _miniLast.tz && k.x === _miniLast.kx && k.z === _miniLast.kz) return;
  S.miniSkitten = false;
  _miniLast.tx = t.x; _miniLast.tz = t.z; _miniLast.kx = k.x; _miniLast.kz = k.z;
  const { cx, cz, half, size } = S.miniInfo;
  const map = (wx, wz) => [size / 2 + (wx - cx) / half * (size / 2), size / 2 + (wz - cz) / half * (size / 2)];
  const ctx = miniCanvas.getContext("2d");
  ctx.putImageData(S.miniBase, 0, 0);

  // ---------- Markeringene som prikker ----------
  // Selve markeringssprite-ene skjules med vilje når toppvisningen renderes
  // (se overlays i renderMiniMap) — de blir gale i ortografisk projeksjon.
  // Men da så montøren bygget ovenfra uten å se HVOR avvikene er. Prikkene her
  // gir et avvikskart: trykk der det er rødt, kamera flytter seg dit.
  //
  // S.hastegradFarge settes av markers.js. Er den ikke satt (kartet lastet før
  // markeringene), tegnes prikkene grå i stedet for at noe kaster.
  const farge = S.hastegradFarge;
  if (farge) {
    for (const c of (S.comments || [])) {
      if (c.status === "Løst") continue;          // løste avvik roter til kartet
      if (typeof c.x !== "number" || typeof c.z !== "number") continue;
      const [mx, my] = map(c.x, c.z);
      if (mx < 0 || my < 0 || mx > size || my > size) continue;   // utenfor kartet
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = farge(c) || "#6b7280"; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = MARKER_KANT; ctx.stroke();
    }
  }

  const [px, py] = map(t.x, t.z);
  const [kx, ky] = map(k.x, k.z);
  ctx.strokeStyle = "#f59e0b"; ctx.fillStyle = "#f59e0b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(px, py); ctx.stroke(); // synsretning
  ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();       // hvor du ser
}

// Hvor nær kameraet blikkpunktet får ligge etter et karttrykk: 12 % av
// modellens diagonal. På Geithus-hallen (24 m) blir det knappe 3 m.
export const MINI_PIVOT_ANDEL = 0.12;

// Hvor høyt over etasjens gulv du landes: 1,7 m, altså øyehøyde for en person
// som står på plassen. Tallet er i METER og må regnes om til modellens enhet —
// en mm-modell teller i millimeter, og 1,7 der ville vært under skotuppen.
export const OYEHOYDE_M = 1.7;

export function etasjeHoyde(yBase, enhetSkala) {
  const s = Number(enhetSkala) > 0 ? Number(enhetSkala) : 1;   // meter per modellenhet
  return (Number(yBase) || 0) + OYEHOYDE_M / s;
}

// Ren regning, så den kan prøves uten en scene: hvor havner kamera og
// blikkpunkt når du trykker i kartet? Svaret er ABSOLUTTE posisjoner, ikke et
// tillegg — både høyden, retningen og avstanden regnes om her.
//
// FIRE FEIL LIGGER BAK DENNE FUNKSJONEN. Tre av dem var forsøk på å rette den
// forrige, og hver av dem så riktig ut på papiret. Derfor står de her:
//
// 1. Forskjellen ble regnet fra BLIKKPUNKTET. Da endte du opp med å SE på
//    stedet du trykket, fra samme avstand som før — du kom aldri dit.
//
// 2. Regnet fra kameraet i stedet: da arvet blikkpunktet zoomnivået. Målt på
//    Geithus-hallen zoomet ut (blikkpunkt 19 m foran): kameraet landet riktig i
//    hjørnet, men blikkpunktet havnet på (−9,7 / −25,7) — utenfor bygget.
//
// 3. Med tak på avstanden var det fortsatt tomt: kameraet arvet HØYDEN og sto
//    7,5 m over taket. Skjermbildet var helt svart.
//
// 4. Med høyden inne i bygget var det FORTSATT tomt, fordi himmelretningen ble
//    arvet — og fra et hjørne pekte den rett ut av bygget.
//
// Det som virker, bekreftet med skjermbilde: du lander på punktet, i en høyde
// inne i bygget, og snus MOT modellens midte. Da ser du alltid stål, uansett
// hvor i kartet du trykker og uansett hvor du sto fra før.
export function miniLanding(kameraPos, malPos, wx, wz, boks, maksAvstand, senter, fastY) {
  // ---- høyden ----
  // Er en etasje valgt, ER høyden bestemt og ingenting skal overprøve den.
  // Det er hele poenget med etasjevelgeren: X og Z kommer fra trykket i kartet,
  // Y fra etasjen, og da er landingspunktet låst i alle tre akser.
  // FELLE: Number(null) er 0, ikke NaN. Sjekker man bare isFinite(Number(x)),
  // blir «ingen etasje valgt» til «land på Y = 0» — og på en modell med kjeller
  // er det midt inne i betongen. Testen fanget nettopp dette.
  let y;
  const fy = (fastY === null || fastY === undefined || fastY === "") ? NaN : Number(fastY);
  if (isFinite(fy)) {
    y = fy;
  } else {
    // «Original»: høyden du står i. Er du alt innenfor byggets høyde, var den
    // riktig og beholdes; er du over taket eller under gulvet, settes du midt
    // mellom dem — ellers ser du rett ut i lufta (målt 18.08).
    y = Number(kameraPos.y) || 0;
    const minY = boks && Number(boks.minY), maxY = boks && Number(boks.maxY);
    if (isFinite(minY) && isFinite(maxY) && maxY > minY && (y < minY || y > maxY)) {
      y = (minY + maxY) / 2;
    }
  }

  // ---- retningen: mot midten av modellen ----
  let hx = senter ? Number(senter.x) - wx : 0;
  let hz = senter ? Number(senter.z) - wz : 0;
  let l = Math.hypot(hx, hz);
  if (!(l > 1e-9)) {                 // du landet midt i modellen – behold din egen
    hx = malPos.x - kameraPos.x; hz = malPos.z - kameraPos.z; l = Math.hypot(hx, hz);
  }
  if (!(l > 1e-9)) { hx = 1; hz = 0; l = 1; }   // og så du rett ned: pek i +x
  hx /= l; hz /= l;

  // ---- avstanden til blikkpunktet: arver ikke zoomen ----
  const nå = Math.hypot(malPos.x - kameraPos.x, malPos.y - kameraPos.y, malPos.z - kameraPos.z);
  const maks = Number(maksAvstand);
  const d = Math.max(1e-6, maks > 0 ? Math.min(nå || maks, maks) : (nå || 1));

  return {
    kamera: { x: wx, y, z: wz },
    mal: { x: wx + hx * d, y, z: wz + hz * d }     // samme y = vannrett blikk
  };
}

miniCanvas.addEventListener("pointerdown", (e) => {
  if (!S.miniInfo) return;
  e.preventDefault();
  const r = miniCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) / r.width * S.miniInfo.size;
  const my = (e.clientY - r.top) / r.height * S.miniInfo.size;
  const wx = S.miniInfo.cx + (mx - S.miniInfo.size / 2) / (S.miniInfo.size / 2) * S.miniInfo.half;
  const wz = S.miniInfo.cz + (my - S.miniInfo.size / 2) / (S.miniInfo.size / 2) * S.miniInfo.half;
  const boks = S.modelBox ? { minY: S.modelBox.min.y, maxY: S.modelBox.max.y } : null;
  const ut = miniLanding(camera.position, controls.target, wx, wz, boks,
    (Number(S.modelSize) || 20) * MINI_PIVOT_ANDEL,
    { x: S.miniInfo.cx, z: S.miniInfo.cz },    // kartets midt ER modellens midt
    valgtEtasjeHoyde());
  camera.position.set(ut.kamera.x, ut.kamera.y, ut.kamera.z);
  controls.target.set(ut.mal.x, ut.mal.y, ut.mal.z);
  camera.lookAt(controls.target);
});

// ---------- 🏢 Etasjevelgeren på kartet ----------
// Uten den bestemmer kartet X og Z, men Y blir en gjetning ut fra hvor du sto.
// Med den er alle tre aksene brukerens eget valg.
//
// Etasjelista eies av clip.js (samme liste som 🏢-knappen bruker) og hentes
// gjennom S.sikreEtasjeliste — se kommentaren der for hvorfor det ikke er en
// import. Valget nullstilles av modellStartverdier() ved modellbytte: «Plan 2»
// i én modell er ikke «Plan 2» i den neste.

function valgtEtasjeHoyde() {
  const i = Number(S.miniEtasje);
  const e = i >= 0 && S.storeyList && S.storeyList[i];
  return e ? etasjeHoyde(e.yBase, S.enhetSkala) : null;
}

const etasjeBoks = document.createElement("button");
etasjeBoks.id = "miniEtasje";
etasjeBoks.className = "mini-etasje";
etasjeBoks.type = "button";
document.body.appendChild(etasjeBoks);

const etasjeListe = document.createElement("div");
etasjeListe.id = "miniEtasjeListe";
etasjeListe.className = "mini-etasje-liste";
document.body.appendChild(etasjeListe);

export function tegnEtasjeBoks() {
  const e = Number(S.miniEtasje) >= 0 && S.storeyList && S.storeyList[S.miniEtasje];
  etasjeBoks.textContent = e ? e.name : t("Original");
  etasjeBoks.classList.toggle("valgt", !!e);
  etasjeBoks.title = t("Hvilken etasje trykk i kartet lander deg på");
  plasserEtasjeBoks();
}

// Boksen og lista er position:fixed og legges etter kartets EGEN plassering.
// Kartet står nede til venstre på skjerm og nede til høyre på mobil, og
// bunnverdien flyttes av nett-banneret — å skrive de reglene på nytt her ville
// vært tre steder å glemme. Rektangelet vet alt det.
function plasserEtasjeBoks() {
  const vis = S.miniOn && S.miniBase && miniCanvas.style.display !== "none";
  etasjeBoks.style.display = vis ? "block" : "none";
  if (!vis) { etasjeListe.classList.remove("open"); return; }
  const r = miniCanvas.getBoundingClientRect();
  const bunn = Math.max(0, window.innerHeight - r.bottom) + 6;
  etasjeBoks.style.left = (r.left + 6) + "px";
  etasjeBoks.style.bottom = bunn + "px";
  etasjeListe.style.left = (r.left + 6) + "px";
  etasjeListe.style.bottom = (bunn + etasjeBoks.offsetHeight + 4) + "px";
}

window.addEventListener("resize", plasserEtasjeBoks);

async function apneEtasjeliste() {
  const liste = S.sikreEtasjeliste ? await S.sikreEtasjeliste() : (S.storeyList || []);
  if (!liste.length) {
    // Samme beskjed som 🏢-knappen gir. En tom liste er ikke en feil — de
    // fleste .glb-kopier og noen IFC-er har rett og slett ingen etasjer.
    etasjeListe.innerHTML = '<span class="tom">' +
      t("Fant ingen etasjer (IfcBuildingStorey) i modellen") + '</span>';
  } else {
    // Nederste etasje nederst i lista, som i bygget.
    const rader = liste.map((e, i) =>
      '<button data-e="' + i + '"' + (Number(S.miniEtasje) === i ? ' class="valgt"' : '') + '>' +
        esc(e.name) + '</button>').reverse().join("");
    etasjeListe.innerHTML = rader +
      '<button data-e="-1"' + (Number(S.miniEtasje) < 0 ? ' class="valgt"' : '') + '>' +
        t("Original") + '</button>';
    etasjeListe.querySelectorAll("button[data-e]").forEach(b => b.onclick = () => {
      S.miniEtasje = Number(b.dataset.e);
      etasjeListe.classList.remove("open");
      tegnEtasjeBoks();
    });
  }
  plasserEtasjeBoks();
  etasjeListe.classList.add("open");
}

etasjeBoks.addEventListener("click", (e) => {
  e.stopPropagation();          // ellers lukker dokument-lytteren den med én gang
  if (etasjeListe.classList.contains("open")) { etasjeListe.classList.remove("open"); return; }
  apneEtasjeliste();
});

document.addEventListener("click", (e) => {
  if (!etasjeListe.contains(e.target)) etasjeListe.classList.remove("open");
});

// Minikartet styres nå fra ⚙ Innstillinger (av/på + størrelse)
export function setMini(on) {
  S.miniOn = on;
  writePrefs();
  miniCanvas.style.display = S.miniOn && S.miniBase ? "block" : "none";
  tegnEtasjeBoks();
  if (S.applyCubePos) S.applyCubePos();   // kuben står kanskje ved siden av kartet
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

export function applyMiniSize() {
  const px = Math.max(100, Math.min(400, Number(S.settings && S.settings.miniSize) || 180));
  miniCanvas.style.width = px + "px";
  miniCanvas.style.height = px + "px";
  plasserEtasjeBoks();          // boksen henger på kartets nedre venstre hjørne
  if (S.applyCubePos) S.applyCubePos();
}

applyMiniSize();

// tegn kameraprikken i minikartet hver frame
frameHooks.push(drawMiniOverlay);

