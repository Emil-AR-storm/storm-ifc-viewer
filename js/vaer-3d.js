// 🌦 Været i 3D (Emil 09.10): «hvis Vis vær er på, skal bakgrunnen bli en blå
// himmel, og når det regner er det grå skyer og regn; storm blir mørkere med
// grå skyer, og lyn hvis det skal lyne og tordne».
//
// HVORDAN: scene.background får være en farge (mange steder setter den med
// .set() — rapportbildet, bakgrunnsvalget, usersync). Himmelen er i stedet en
// kuppel rundt kameraet som tegnes først og aldri skriver dybde, så alt annet
// havner foran den. Nedbøren er streker/prikker i en boks rundt det du ser på,
// og størrelsene regnes av kameraavstanden — samme utseende på en garasje og
// på et datasenter, i mm og i m (ingen fasit per modell).
//
// Hva som styrer været i 3D (første som finnes vinner):
//   1. panelet Vis vær: valgt dag og time
//   2. Framdriftsplan-glideren: dagen den står på (kl. 12)
//   3. ellers: været akkurat nå
// Settes fra vaer-felles.js / vaer.js med settVaer3D(kilde, tilstand).
//
// Alt ligger på LAG 1, som bare hovedkameraet ser. Minikartet, PDF-kameraene
// (riggplan, støpeplan, framdrift, video) og raycasteren bruker lag 0 og ser
// det aldri. Rapportbildet bruker hovedkameraet og skjuler det med
// S.skjulVaer3D(true).
import * as THREE from "three";
import { S, writePrefs } from "./state.js";
import { camera, controls, frameHooks, scene } from "./scene.js";
import { nattFor } from "./vaer-regn.js";
S.vaerNatt = (lat, dato, time) => nattFor(lat, dato, time);

// stil: "A" enkel (himmel + nedbør), "B" med skyer, "C" med skyer, dis og
// dempet lys. Valgt av Emil etter prøvebildene — standard B til da.
let stil = "C";
export function settStil(s) { if (["A", "B", "C"].includes(s)) { stil = s; bygg(); } }

// ═══════════════════════ FARGENE PER VÆR ═══════════════════════
// [topp, horisont] på himmelen, skyfarge, lysfaktor, dis
const HIMMEL = {
  sol:    { topp: "#2f7fd6", hor: "#bfe0ff", sky: "#ffffff", skyer: 0,  lys: 1.0,  dis: 0 },
  delvis: { topp: "#3d86d4", hor: "#cfe3f5", sky: "#ffffff", skyer: 7,  lys: 0.95, dis: 0 },
  sky:    { topp: "#7d8a98", hor: "#c5ccd4", sky: "#d9dee4", skyer: 16, lys: 0.8,  dis: 0.15 },
  taake:  { topp: "#a7afb8", hor: "#d3d7dc", sky: "#cfd4d9", skyer: 10, lys: 0.75, dis: 0.8 },
  regn:   { topp: "#5d6874", hor: "#9aa3ad", sky: "#8e98a3", skyer: 20, lys: 0.65, dis: 0.35 },
  sludd:  { topp: "#66717d", hor: "#a8b0b9", sky: "#9ca5af", skyer: 20, lys: 0.68, dis: 0.35 },
  sno:    { topp: "#8f9aa6", hor: "#dde3e9", sky: "#e4e8ec", skyer: 18, lys: 0.8,  dis: 0.45 },
  storm:  { topp: "#262c34", hor: "#525b66", sky: "#4a525c", skyer: 24, lys: 0.45, dis: 0.4 },
  ukjent: { topp: "#4b7fb8", hor: "#c3d6ea", sky: "#ffffff", skyer: 0,  lys: 1.0,  dis: 0 }
};
const NATT = { topp: "#05080f", hor: "#1b2433" };

// ═══════════════════════ TILSTAND ═══════════════════════
const kilder = { video: null, panel: null, framdrift: null, naa: null };
let videoModus = false;
let aktiv = null;           // { bilde, natt (0..1), lyn }
let skjult = false;
const gruppe = new THREE.Group();
gruppe.name = "vaer3d";
gruppe.renderOrder = -10;
scene.add(gruppe);
const ingenTreff = () => {};
const LAG = 1;
camera.layers.enable(LAG);

// Himmelkuppelen: gradient fra horisont til topp, pluss lynglimt.
const kuppelMat = new THREE.ShaderMaterial({
  uniforms: { topp: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, glimt: { value: 0 },
    sol: { value: new THREE.Vector3(0.4, 0.35, -0.85).normalize() }, solStyrke: { value: 0 } },
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform vec3 topp; uniform vec3 hor; uniform float glimt; uniform vec3 sol; uniform float solStyrke; varying vec3 vP;" +
    "void main(){ float h = clamp(vP.y * 1.6 + 0.08, 0.0, 1.0); vec3 c = mix(hor, topp, pow(h, 0.8));" +
    " float s = max(dot(normalize(vP), sol), 0.0); c += solStyrke * (vec3(1.0, 0.93, 0.75) * pow(s, 400.0) * 1.6 + vec3(1.0, 0.85, 0.6) * pow(s, 12.0) * 0.35);" +
    " c = mix(c, vec3(0.93, 0.95, 1.0), glimt); gl_FragColor = vec4(c, 1.0); }",
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
});
const kuppel = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), kuppelMat);
kuppel.frustumCulled = false; kuppel.renderOrder = -10; kuppel.raycast = ingenTreff; kuppel.layers.set(LAG);
gruppe.add(kuppel);

// Skyene: myke «puter» tegnet på canvas én gang, brukt som sprites.
let skyTex = null;
function lagSkyTex() {
  if (skyTex || typeof document === "undefined") return skyTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  for (let i = 0; i < 9; i++) {
    const x = 34 + Math.random() * 60, y = 50 + Math.random() * 30, r = 22 + Math.random() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  skyTex = new THREE.CanvasTexture(c);
  return skyTex;
}
const skyGruppe = new THREE.Group();
gruppe.add(skyGruppe);

// Nedbøren: regn som smale strimler og snø som prikker, N stykker i en
// enhetsboks som skaleres med kameraavstanden.
//
// REGNET ER STRIMLER, IKKE STREKER (Emil 09.10: «på dager med regn kom det
// ikke opp noe regn i videoen»). Streker i WebGL er alltid 1 piksel brede.
// Videoen tegnes 1,5 ganger større og skaleres ned, og MP4-komprimeringen
// fjerner så tynne, lyse detaljer — regnet forsvant. Strimlene har en bredde
// i PIKSLER (regnes av kameraavstanden og bildehøyden), så regnet ser likt ut
// på skjermen og i videoen. Snøfnuggene skaleres på samme måte.
const N_REGN = 3000, N_SNO = 2500;
const REGN_PX = 1.6, SNO_PX = 3;
const regnPos = new Float32Array(N_REGN * 4 * 3);
const regnIdx = new Uint32Array(N_REGN * 6);
for (let i = 0; i < N_REGN; i++) regnIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
const regnGeo = new THREE.BufferGeometry();
regnGeo.setAttribute("position", new THREE.BufferAttribute(regnPos, 3));
regnGeo.setIndex(new THREE.BufferAttribute(regnIdx, 1));
const regn = new THREE.Mesh(regnGeo, new THREE.MeshBasicMaterial({ color: 0xdfeaf5, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false }));
regn.frustumCulled = false; regn.raycast = ingenTreff; regn.layers.set(LAG);
const snoPos = new Float32Array(N_SNO * 3);
const snoGeo = new THREE.BufferGeometry();
snoGeo.setAttribute("position", new THREE.BufferAttribute(snoPos, 3));
const sno = new THREE.Points(snoGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
sno.frustumCulled = false; sno.raycast = ingenTreff; sno.layers.set(LAG);
const nedbor = new THREE.Group();
nedbor.add(regn, sno);
gruppe.add(nedbor);
// Frø i enhetsboksen [-0.5, 0.5]³
const fro = new Float32Array(Math.max(N_REGN, N_SNO) * 3);
for (let i = 0; i < fro.length; i++) fro[i] = Math.random() - 0.5;

// Lynet: en takket strek fra skyene ned mot bakken, synlig bare i glimtet
const lynPos = new Float32Array(14 * 3);
const lynGeo = new THREE.BufferGeometry();
lynGeo.setAttribute("position", new THREE.BufferAttribute(lynPos, 3));
const lynStrek = new THREE.Line(lynGeo, new THREE.LineBasicMaterial({ color: 0xf4f7ff, transparent: true, depthWrite: false, fog: false }));
lynStrek.frustumCulled = false; lynStrek.raycast = ingenTreff; lynStrek.visible = false; lynStrek.layers.set(LAG);
gruppe.add(lynStrek);
function nyttLyn(t, d) {
  const v = Math.random() * Math.PI * 2, r = d * (1.2 + Math.random() * 1.2);
  let x = t.x + Math.cos(v) * r, z = t.z + Math.sin(v) * r, y = t.y + d * 1.1;
  const bunn = t.y - d * 0.05, steg = (y - bunn) / 13;
  for (let i = 0; i < 14; i++) {
    lynPos.set([x, y, z], i * 3);
    x += (Math.random() - 0.5) * d * 0.12; z += (Math.random() - 0.5) * d * 0.12; y -= steg;
  }
  lynGeo.attributes.position.needsUpdate = true;
}

// Lysene i scenen (dempes i stil C) — huskes første gang
let lysene = null;
function finnLys() {
  if (lysene) return lysene;
  lysene = [];
  scene.traverse(o => { if (o.isLight && o.parent === scene) lysene.push({ l: o, i: o.intensity }); });
  return lysene;
}

// ═══════════════════════ BYGG FOR AKTIVT VÆR ═══════════════════════
// 3D-været vises bare når Vis vær er på OG «Vis været i 3D» ikke er slått av
// (Emil 09.10: «det må finnes en knapp som skrur av 3D-visningen — det er
// tungvint når du skal vise noen modellen og det er masse snø på skjermen»,
// og «Vis været i Framdriftsplan skal også skru av 3D-været»).
// Videoen følger bare Vis vær (den har sitt eget valg: medVaer).
export function vaer3DTillatt() {
  if (videoModus) return true;
  return !!(S.settings && S.settings.vaerPaa && S.settings.vaer3D !== false);
}
function bygg() {
  const a = (skjult || !vaer3DTillatt()) ? null : aktiv;
  gruppe.visible = !!a;
  if (!a) {
    for (const x of finnLys()) x.l.intensity = x.i;
    if (scene.userData.vaerTaake) { scene.fog = null; scene.userData.vaerTaake = false; }
    return;
  }
  const h = HIMMEL[a.bilde] || HIMMEL.ukjent;
  const n = Math.max(0, Math.min(1, a.natt || 0));
  kuppelMat.uniforms.topp.value.set(h.topp).lerp(new THREE.Color(NATT.topp), n * 0.85);
  kuppelMat.uniforms.hor.value.set(h.hor).lerp(new THREE.Color(NATT.hor), n * 0.8);
  // Skyer (B og C)
  skyGruppe.clear();
  const tex = stil === "A" ? null : lagSkyTex();
  if (tex && h.skyer) {
    const farge = new THREE.Color(h.sky).lerp(new THREE.Color("#2a3140"), n * 0.7);
    for (let i = 0; i < h.skyer; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: farge, transparent: true, opacity: 0.55 + Math.random() * 0.35, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m);
      const v = (i / h.skyer) * Math.PI * 2 + Math.random() * 0.4;
      s.userData = { v, r: 0.9 + Math.random() * 0.9, y: 0.32 + Math.random() * 0.28, sk: 0.45 + Math.random() * 0.5, fart: 0.004 + Math.random() * 0.006 };
      s.raycast = ingenTreff; s.renderOrder = -9; s.layers.set(LAG);
      skyGruppe.add(s);
    }
  }
  // Nedbør
  const erRegn = ["regn", "storm", "sludd"].includes(a.bilde), erSno = ["sno", "sludd"].includes(a.bilde);
  regn.visible = erRegn; sno.visible = erSno;
  regn.material.opacity = a.bilde === "storm" ? 0.75 : 0.6;
  // Sola på himmelen (stil C): bare når den faktisk synes
  kuppelMat.uniforms.solStyrke.value = stil === "C" ? (a.bilde === "sol" ? 1 : a.bilde === "delvis" ? 0.6 : 0) * (1 - n) : 0;
  // Lys og dis (stil C)
  const lysF = stil === "C" ? h.lys * (1 - n * 0.6) : 1;
  for (const x of finnLys()) x.l.intensity = x.i * lysF;
  if (videoModus) { /* videoen har sin egen dis (riggplan.js bildeOkt) */ }
  else if (stil === "C" && h.dis > 0) {
    scene.fog = new THREE.Fog(new THREE.Color(h.hor).lerp(new THREE.Color(NATT.hor), n * 0.8), 1, 2);
    scene.userData.vaerTaake = true;
  } else if (scene.userData.vaerTaake) { scene.fog = null; scene.userData.vaerTaake = false; }
}

// ═══════════════════════ HVER FRAME ═══════════════════════
let sist = 0, nesteLyn = 0, lynStart = -1e9;
// Skjermen: hver frame, rundt hovedkameraet. Videoen kaller oppdaterFor()
// selv før hvert bilde, med sitt eget kamera og sin egen klokke.
frameHooks.push(() => {
  if (!gruppe.visible || videoModus) return;
  const naa = performance.now();
  const dt = Math.min(0.1, sist ? (naa - sist) / 1000 : 0.016);
  sist = naa;
  oppdaterFor(camera, controls.target, naa, dt, (typeof innerHeight === "number" ? innerHeight : 800) * Math.min(2, (typeof devicePixelRatio === "number" ? devicePixelRatio : 1)));
});
const _syn = new THREE.Vector3(), _side = new THREE.Vector3(), _ned = new THREE.Vector3();
// hPx: bildehøyden i piksler det tegnes i (skjermen, eller videoens store bilde)
function oppdaterFor(kam, t, naa, dt, hPx) {
  const d = Math.max(1e-3, kam.position.distanceTo(t));
  // Kuppelen følger kameraet, rett innenfor fjernplanet
  kuppel.position.copy(kam.position);
  kuppel.scale.setScalar(kam.far * 0.9);
  // Skyene på en ring over det du ser på
  for (const s of skyGruppe.children) {
    const u = s.userData;
    u.v += u.fart * dt;
    s.position.set(t.x + Math.cos(u.v) * d * 2.2 * u.r, t.y + d * 1.1 * u.y + d * 0.3, t.z + Math.sin(u.v) * d * 2.2 * u.r);
    s.scale.set(d * 1.6 * u.sk, d * 0.8 * u.sk, 1);
  }
  // Dis: tett nok til å synes, aldri så tett at modellen forsvinner
  if (scene.userData.vaerTaake && scene.fog && aktiv) {
    const h = HIMMEL[aktiv.bilde] || HIMMEL.ukjent;
    scene.fog.near = d * (1.6 - h.dis * 1.0);
    scene.fog.far = d * (6 - h.dis * 3.2);
  }
  // Nedbøren: boks rundt målet, faller og går rundt
  const B = d * 1.4;
  nedbor.position.copy(t);
  // Én piksel i verdensenheter, der det regner (rundt målet)
  const fov = (kam.fov || 50) * Math.PI / 180;
  const pxVerden = 2 * d * Math.tan(fov / 2) / Math.max(100, hPx || 800);
  if (regn.visible) {
    const fall = (naa / 1000) * 1.4;   // bokser per sekund
    const len = 0.04, vind = aktiv && aktiv.bilde === "storm" ? 0.35 : 0.08;
    // Strimlene vendes mot kameraet: sideretningen står vinkelrett på både
    // fallretningen og synslinja
    _syn.copy(t).sub(kam.position).normalize();
    _ned.set(vind, 1, 0).normalize();
    _side.crossVectors(_ned, _syn).normalize().multiplyScalar(pxVerden * REGN_PX / 2);
    const sx = _side.x, sy = _side.y, sz = _side.z;
    for (let i = 0; i < N_REGN; i++) {
      let y = fro[i * 3 + 1] - fall; y = y - Math.floor(y + 0.5);
      const x = fro[i * 3] + vind * y, z = fro[i * 3 + 2];
      const ax = x * B, ay = y * B, az = z * B, bx = (x + vind * len) * B, by = (y + len) * B, bz = z * B;
      regnPos.set([ax - sx, ay - sy, az - sz, ax + sx, ay + sy, az + sz, bx - sx, by - sy, bz - sz, bx + sx, by + sy, bz + sz], i * 12);
    }
    regnGeo.attributes.position.needsUpdate = true;
  }
  sno.material.size = SNO_PX * Math.max(1, (hPx || 800) / 900);
  if (sno.visible) {
    const fall = (naa / 1000) * 0.12;
    for (let i = 0; i < N_SNO; i++) {
      let y = fro[i * 3 + 1] - fall; y = y - Math.floor(y + 0.5);
      const drift = Math.sin(naa / 1500 + i) * 0.01;
      snoPos[i * 3] = (fro[i * 3] + drift) * B; snoPos[i * 3 + 1] = y * B; snoPos[i * 3 + 2] = fro[i * 3 + 2] * B;
    }
    snoGeo.attributes.position.needsUpdate = true;
  }
  // Lyn: bare når symbolet sier torden (aktiv.lyn), med tilfeldig mellomrom
  if (aktiv && aktiv.lyn) {
    if (naa > nesteLyn) { lynStart = naa; nesteLyn = naa + 3500 + Math.random() * 6000; nyttLyn(t, d); }
    // To blink, som et ekte lyn: 0–90 ms fullt, kort mørkt, så et svakere
    // blink som dør ut over ~0,4 s. Regnes av klokka, ikke antall bilder.
    const ms = naa - lynStart;
    const g = ms < Math.max(90, lynHold) ? 1 : ms < 150 ? 0.1 : ms < 550 ? 0.75 * (1 - (ms - 150) / 400) : 0;
    const glimt = g;
    kuppelMat.uniforms.glimt.value = g * 0.85;
    lynStrek.visible = glimt > 0.3;
    lynStrek.material.opacity = Math.min(1, glimt * 1.4);
    for (const x of finnLys()) if (x.l.isAmbientLight) x.l.intensity = x.i * ((stil === "C" ? (HIMMEL.storm.lys) : 1) + g * 1.2);
  } else { kuppelMat.uniforms.glimt.value = 0; lynStrek.visible = false; }
}

// ═══════════════════════ STYRINGEN ═══════════════════════
// tilstand: { bilde, natt (0..1), lyn (bool) } eller null
export function settVaer3D(kilde, tilstand) {
  kilder[kilde] = tilstand || null;
  const ny = kilder.video || kilder.panel || kilder.framdrift || kilder.naa;
  if (JSON.stringify(ny) === JSON.stringify(aktiv)) return;
  aktiv = ny ? Object.assign({}, ny) : null;
  bygg();
  visKnapp();
}
S.settVaer3D = settVaer3D;
S.skjulVaer3D = (paa) => { skjult = !!paa; bygg(); };
export const vaer3DAktiv = () => aktiv;
// Neste lyn med en gang (brukt av prøvebildene og testene)
// `hold` (ms): blinket står fullt så lenge (prøvebilder og tester)
let lynHold = 0;
export function lynNaa(hold) { nesteLyn = 0; lynHold = hold || 0; }

// ═══════════════════════ FRAMDRIFTSPLAN-VIDEOEN ═══════════════════════
// Emil 09.10: «3D-visningen skal vises i framdriftsplan-videoen hvis Vis vær
// er på». Videoen tegner med sitt eget kamera (lag 0); det får lag 1 i
// tillegg, og været settes for dagen hvert bilde viser. Klokka er videoens,
// så regnet faller like fort i videoen uansett hvor lang tid et bilde tar.
S.vaer3DVideo = {
  start(kam) {
    videoModus = true;
    if (scene.userData.vaerTaake) { scene.fog = null; scene.userData.vaerTaake = false; }
    kam.layers.enable(LAG);
  },
  // hPx: høyden på bildet videoen tegnes i (før nedskalering)
  ramme(kam, mal, tilstand, tidMs, hPx) {
    settVaer3D("video", tilstand);
    if (!gruppe.visible) return;
    oppdaterFor(kam, mal, tidMs, 1 / 30, hPx);
  },
  slutt() { videoModus = false; settVaer3D("video", null); bygg(); }
};

// Bryterne (Vis vær, Vis været i 3D, knappen i 3D-visningen) sier fra med
// «storm-vaer» — tegn på nytt og vis/skjul knappen.
function visKnapp() {
  const k = typeof document !== "undefined" && document.getElementById("vaer3dAv");
  if (!k) return;
  k.style.display = (aktiv && vaer3DTillatt() && !videoModus) ? "" : "none";
}
if (typeof document !== "undefined") {
  document.addEventListener("storm-vaer", () => { bygg(); visKnapp(); });
  const k = document.getElementById("vaer3dAv");
  if (k) k.addEventListener("click", () => {
    if (!S.settings) return;
    S.settings.vaer3D = false;
    writePrefs();
    try { document.dispatchEvent(new CustomEvent("storm-vaer")); } catch (_) {}
  });
}
