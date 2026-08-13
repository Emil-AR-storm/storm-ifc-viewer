// 🧊 ViewCube: den klassiske orienteringskuben. Viser hvilken vei modellen står,
// og et trykk på en flate, kant eller hjørne snur kameraet dit.
//
// Kuben tegnes i sin EGEN lille WebGL-flate, ikke oppå hovedbildet. Det er
// bevisst: hovedløkka i scene.js avslutter med én render av hele scenen, så alt
// som skulle tegnes etter den måtte ha endret render-løkka. En egen 104 px
// canvas med tolv trekanter koster nesten ingenting og holder snitt-plan,
// klipping og overlegg helt utenfor.
import * as THREE from "three";
import { S, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { camera, controls, frameHooks } from "./scene.js";

export const CUBE_POS = ["tv", "th", "nv", "nh"];   // oppe/nede × venstre/høyre

// ---------- flate-etiketter ----------
// Rekkefølgen er den BoxGeometry bruker: +X, −X, +Y, −Y, +Z, −Z
const SIDER = [
  { n: "Høyre",  aksel: [ 1,  0,  0] },
  { n: "Venstre",aksel: [-1,  0,  0] },
  { n: "Topp",   aksel: [ 0,  1,  0] },
  { n: "Bunn",   aksel: [ 0, -1,  0] },
  { n: "Front",  aksel: [ 0,  0,  1] },
  { n: "Bak",    aksel: [ 0,  0, -1] }
];

function sideTekstur(tekst) {
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "#1b2130";
  g.fillRect(0, 0, 160, 160);
  g.strokeStyle = "#2c3442"; g.lineWidth = 8;
  g.strokeRect(4, 4, 152, 152);
  // lang tekst må krympes så den ikke renner utenfor flata
  let fs = 30;
  g.font = "bold " + fs + "px sans-serif";
  while (g.measureText(tekst).width > 132 && fs > 14) {
    fs -= 2;
    g.font = "bold " + fs + "px sans-serif";
  }
  g.fillStyle = "#cfe0ff";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(tekst, 80, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// ---------- egen liten scene ----------
const el = document.createElement("canvas");
el.id = "viewCube";
const TITTEL = "Trykk på en flate, kant eller hjørne for å snu modellen";
el.title = t(TITTEL);
el.style.cssText = "position:fixed; z-index:6; display:none; cursor:pointer; " +
  "border:1px solid #2c3442; border-radius:10px; background:rgba(20,24,31,.72)";
document.body.appendChild(el);

const AVSTAND = 3.4;

// Kuben trenger en WebGL-flate til. Nettlesere har et tak på hvor mange som kan
// være åpne samtidig, og noen eldre maskiner nekter helt. Da skal kuben bare
// utebli – ikke ta med seg resten av verktøyet i fallet.
let rend = null, kScene = null, kCam = null, kube = null, materialer = [];

try {
  rend = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
  rend.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  kScene = new THREE.Scene();
  kCam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  materialer = SIDER.map(s => new THREE.MeshBasicMaterial({ map: sideTekstur(t(s.n)) }));
  kube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materialer);
  kScene.add(kube);
  kube.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(kube.geometry),
    new THREE.LineBasicMaterial({ color: 0x5b7cb8 })
  ));
} catch (err) {
  console.warn("ViewCube kunne ikke settes opp:", err);
  rend = null;
  el.remove();
}

// Bygger etikettene på nytt når språket byttes (setLang i i18n.js kaller denne).
export function rebuildCubeLabels() {
  if (!rend) return;
  el.title = t(TITTEL);
  SIDER.forEach((s, i) => {
    if (materialer[i].map) materialer[i].map.dispose();
    materialer[i].map = sideTekstur(t(s.n));
    materialer[i].needsUpdate = true;
  });
}
S.rebuildCube = rebuildCubeLabels;

// ---------- plassering og størrelse ----------
function storrelse() { return innerWidth <= 640 ? 78 : 104; }

// Nede til venstre ligger minikartet fra før – da settes kuben til HØYRE for det.
// På telefon flytter CSS-en minikartet over til høyre side, og da skal kuben
// ligge helt ute i venstrekanten som normalt. Derfor leses den faktiske
// plasseringen av kartet, ikke innstillingen.
function venstreKant() {
  const mm = document.getElementById("miniMap");
  if (!mm || mm.style.display === "none") return 12;
  const r = mm.getBoundingClientRect();
  if (!r.width || r.left > innerWidth / 2) return 12;
  return Math.round(r.right) + 10;
}

export function applyCubePos() {
  if (!rend) return;
  const px = storrelse();
  el.style.width = px + "px";
  el.style.height = px + "px";
  rend.setSize(px, px, false);
  el.style.top = el.style.bottom = el.style.left = el.style.right = "";
  const oppe = innerWidth <= 640 ? 88 : 96;   // rett under verktøylinja
  switch (S.settings.cubePos) {
    case "tv": el.style.top = oppe + "px"; el.style.left = "12px"; break;
    case "th": el.style.top = oppe + "px"; el.style.right = "12px"; break;
    case "nv": el.style.bottom = "12px"; el.style.left = venstreKant() + "px"; break;
    default:   el.style.bottom = "12px"; el.style.right = "12px";
  }
  el.style.display = S.settings.cubeOn === false ? "none" : "block";
}

export function setCube(on) {
  S.settings.cubeOn = !!on;
  writePrefs();
  applyCubePos();
  if (S.syncPrefs) S.syncPrefs();
}

export function setCubePos(pos) {
  S.settings.cubePos = CUBE_POS.includes(pos) ? pos : "th";
  writePrefs();
  applyCubePos();
  if (S.syncPrefs) S.syncPrefs();
}

addEventListener("resize", applyCubePos);
applyCubePos();
// minikartet melder fra hit når det slås av/på eller endrer størrelse, slik at
// kuben kan flytte seg ut av veien uten at minimap.js må importere denne fila
S.applyCubePos = applyCubePos;

// ---------- hold kuben i takt med kameraet ----------
const _retning = new THREE.Vector3();

function tegn() {
  if (!rend || el.style.display === "none") return;
  _retning.copy(camera.position).sub(controls.target);
  if (_retning.lengthSq() < 1e-9) _retning.set(1, 1, 1);
  _retning.normalize().multiplyScalar(AVSTAND);
  kCam.position.copy(_retning);
  kCam.up.copy(camera.up);
  kCam.lookAt(0, 0, 0);
  rend.render(kScene, kCam);
}

// ---------- trykk: finn flate, kant eller hjørne ----------
const rc = new THREE.Raycaster();
const mus = new THREE.Vector2();

function treff(e) {
  if (!rend) return null;
  const r = el.getBoundingClientRect();
  mus.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  mus.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  rc.setFromCamera(mus, kCam);
  const h = rc.intersectObject(kube, false);
  return h.length ? h[0] : null;
}

// Punktet på kuben gjøres om til én av 26 retninger: nær midten av en flate gir
// ren flate, nær en kant gir to akser, nær et hjørne gir tre. Det er slik en
// ViewCube skal oppføre seg – ellers får man bare seks visninger.
const GRENSE = 0.34;   // av halvsiden 0.5

// Ren matematikk, uten three.js – kan testes for seg selv.
// Inn: et punkt på kuben i lokale koordinater (hver akse i [-0.5, 0.5]).
// Ut: {x, y, z} som ikke er normalisert ennå.
export function retningTall(px, py, pz, reserve) {
  const kv = (v) => v > GRENSE ? 1 : v < -GRENSE ? -1 : 0;
  let d = { x: kv(px), y: kv(py), z: kv(pz) };
  if (!d.x && !d.y && !d.z && reserve) d = { x: reserve.x, y: reserve.y, z: reserve.z };
  // Rett ovenfra/nedenfra er en singularitet for kamerakontrollen (den regner i
  // kulekoordinater og klemmer phi). Et knøtt lite dytt gir samme bilde uten at
  // rotasjonen låser seg etterpå.
  if (d.x === 0 && d.z === 0 && d.y !== 0) d.z = -0.0015 * d.y;
  return d;
}

function retningFra(hit) {
  const p = kube.worldToLocal(hit.point.clone());
  const d = retningTall(p.x, p.y, p.z, hit.face && hit.face.normal);
  return new THREE.Vector3(d.x, d.y, d.z).normalize();
}

// ---------- myk overgang til ny retning ----------
let anim = null;

function flyTil(dir) {
  const fra = camera.position.clone().sub(controls.target);
  const lengde = fra.length() || 10;
  const til = dir.clone().multiplyScalar(lengde);
  anim = { fra, til, t0: performance.now(), ms: 380 };
}

function animer() {
  if (!anim) return;
  const k = Math.min(1, (performance.now() - anim.t0) / anim.ms);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease-in-out
  const v = anim.fra.clone().lerp(anim.til, e);
  // hold avstanden konstant gjennom hele svingen – ren lerp ville dyppet innom
  // midten og fått modellen til å «puste»
  v.setLength(anim.fra.length() * (1 - e) + anim.til.length() * e);
  camera.position.copy(controls.target).add(v);
  camera.lookAt(controls.target);
  if (k >= 1) anim = null;
}

// hover: lys opp flata under pekeren
let markert = -1;

function settMarkert(i) {
  if (i === markert) return;
  if (markert >= 0) materialer[markert].color.setHex(0xffffff);
  markert = i;
  if (markert >= 0) materialer[markert].color.setHex(0x93b4e8);
}

el.addEventListener("pointermove", (e) => {
  const h = treff(e);
  settMarkert(h && h.face ? Math.floor(h.faceIndex / 2) : -1);
});

el.addEventListener("pointerleave", () => settMarkert(-1));

el.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const h = treff(e);
  if (h) flyTil(retningFra(h));
});

// kuben skal ikke åpne innstillingsmenyen slik høyreklikk i modellen gjør
el.addEventListener("contextmenu", (e) => e.preventDefault());

frameHooks.push(animer);
frameHooks.push(tegn);
