// Three.js-oppsett: renderer, kamera, lys, kamerakontroll og render-løkka.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, på, S } from "./state.js";

// Egen enkel kamera-kontroll (mus + touch) – ingen eksterne avhengigheter
class SimpleControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this._pointers = new Map();
    this._prevDist = 0;
    this._prevMid = null;
    dom.addEventListener("pointerdown", (e) => {
      if (e.shiftKey && e.button === 0) return; // shift+venstre = markeringsboks, ikke kamera
      if (e.button === 2) return;               // høyreklikk = innstillingsmeny, ikke kamera
      if (e.button === 1) e.preventDefault();   // hindrer nettleserens autoscroll på midtklikk
      dom.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._prevDist = Math.hypot(a.x - b.x, a.y - b.y);
        this._prevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    });
    dom.addEventListener("pointermove", (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      if (this._pointers.size === 1) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (p.button === 1) this._pan(dx, dy); // midtklikk (musehjul-knappen) panorerer
        else this._rotate(dx, dy);
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this._prevDist > 0) this._zoom(this._prevDist / dist);
        if (this._prevMid) this._pan(mid.x - this._prevMid.x, mid.y - this._prevMid.y);
        this._prevDist = dist;
        this._prevMid = mid;
      }
    });
    const end = (e) => { this._pointers.delete(e.pointerId); this._prevDist = 0; this._prevMid = null; };
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      const s = 0.0012 * (S.settings.zoomSpeed || 1) * (S.settings.invertZoom ? -1 : 1);
      this._zoom(1 + e.deltaY * s);
    }, { passive: false });
    dom.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    dom.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (S.onContextMenu) S.onContextMenu(e.clientX, e.clientY); // settes av ui.js
    });
  }
  _offset() { return this.camera.position.clone().sub(this.target); }
  _rotate(dx, dy) {
    const off = this._offset();
    const sph = new THREE.Spherical().setFromVector3(off);
    const rs = 0.006 * (S.settings.rotSpeed || 1);
    sph.theta -= dx * rs;
    sph.phi -= dy * rs;
    sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi));
    this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(this.target);
  }
  _pan(dx, dy) {
    const dist = this._offset().length();
    const factor = dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * factor).add(up.multiplyScalar(dy * factor));
    this.camera.position.add(move);
    this.target.add(move);
  }
  _zoom(scale) {
    const off = this._offset().multiplyScalar(scale);
    const len = off.length();
    if (len < 0.2 || len > 8000) return;
    this.camera.position.copy(this.target).add(off);
  }
  // Offentlige navn på de tre bevegelsene. _rotate/_pan/_zoom er interne, og
  // navigasjonshjulet (js/hjul.js) trenger dem utenfra. Å kalle en
  // understrek-metode fra en annen modul er en ulykke som venter på å skje —
  // da står det ingenting i veien for at noen «rydder» dem bort.
  roter(dx, dy) { this._rotate(dx, dy); }
  panorer(dx, dy) { this._pan(dx, dy); }
  zoomSteg(skala) { this._zoom(skala); }

  update() { this.camera.lookAt(this.target); }
}

// ---------- Scene ----------
export const canvas = document.getElementById("viewer");

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

export const scene = new THREE.Scene();

scene.background = new THREE.Color(0x14181f);
S.scene = scene; // usersync trenger den for å sette lagret bakgrunnsfarge

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);

camera.position.set(15, 12, 15);

export const controls = new SimpleControls(camera, canvas);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));

const dir = new THREE.DirectionalLight(0xffffff, 1.4);

dir.position.set(30, 60, 30);

scene.add(dir);

const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);

dir2.position.set(-30, 20, -30);

scene.add(dir2);

export const grid = new THREE.GridHelper(60, 60, 0x2c3442, 0x232a36);

scene.add(grid);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

addEventListener("resize", resize);

resize();

// Moduler melder seg på hver frame via frameHooks – da slipper scene.js
// å kjenne til verktøyene, og vi unngår sirkulære importer.
export const frameHooks = [];
renderer.setAnimationLoop(() => {
  controls.update();
  for (const fn of frameHooks) { try { fn(); } catch (err) { console.warn(err); } }
  renderer.render(scene, camera);
});

// Fanger det brukeren ser, som PNG — til PDF-rapporten.
//
// SAMME OPPSKRIFT SOM MINIKARTET (js/minimap.js): render til et
// WebGLRenderTarget og les pikslene ut, i stedet for å sette
// preserveDrawingBuffer:true på rendereren. Det flagget ville kostet ytelse på
// HVER eneste frame, hele tiden, for en knapp som brukes én gang i uka.
//
// Radene må snus: WebGL leser nedenfra og opp, canvas tegner ovenfra og ned.
export function fangstBilde(bredde, høyde) {
  const b = Math.max(64, Math.round(bredde || 1400));
  const h = Math.max(64, Math.round(høyde || 900));
  let rt = null;
  const gammelt = renderer.getRenderTarget();
  // Rapporten er et hvitt dokument. Brukerens egen 3D-bakgrunn er mørk som
  // standard, og et svart felt på en A4-side ser feil ut og tømmer en
  // blekkpatron. Bakgrunn og rutenett settes lyst for fangsten og settes
  // tilbake i finally — også hvis noe kaster underveis.
  const gammelBg = scene.background ? scene.background.clone() : null;
  const gammeltRutenett = grid.visible;
  try {
    if (scene.background) scene.background.set(0xffffff);
    grid.visible = false;
    rt = new THREE.WebGLRenderTarget(b, h);
    // Kameraets bildeforhold må matche målet, ellers blir bildet strukket
    const gammeltAspect = camera.aspect;
    camera.aspect = b / h; camera.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const px = new Uint8Array(b * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, b, h, px);
    camera.aspect = gammeltAspect; camera.updateProjectionMatrix();

    const c = document.createElement("canvas");
    c.width = b; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(b, h);
    for (let y = 0; y < h; y++)
      img.data.set(px.subarray((h - 1 - y) * b * 4, (h - y) * b * 4), y * b * 4);
    ctx.putImageData(img, 0, 0);
    // JPEG, ikke PNG: den første ekte rapporten ble 5 MB, og nesten alt var
    // dette ene bildet. En 3D-visning er fotolignende, så JPEG komprimerer den
    // ned til noen hundre kilobyte uten at noen ser forskjell — og en rapport
    // som skal sendes på e-post før et møte må kunne sendes på e-post.
    return { data: c.toDataURL("image/jpeg", 0.86), b, h, format: "JPEG" };
  } catch (err) {
    // Bildet er en pynt, ikke en forutsetning — rapporten skal komme uansett.
    console.warn("Klarte ikke å fange modellbildet:", err);
    return null;
  } finally {
    if (gammelBg && scene.background) scene.background.copy(gammelBg);
    grid.visible = gammeltRutenett;
    renderer.setRenderTarget(gammelt);
    if (rt) rt.dispose();
  }
}

export const markerGroup = new THREE.Group();

export const measureGroup = new THREE.Group();

export const koteGroup = new THREE.Group();

export const axesGroup = new THREE.Group();

export const selGroup = new THREE.Group();

axesGroup.visible = false;

scene.add(markerGroup, measureGroup, koteGroup, axesGroup, selGroup);

export function fitToModel() {
  if (!S.modelGroup) return;
  const box = new THREE.Box3().setFromObject(S.modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = Math.max(size * 0.7, 5);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(dist * .7, dist * .55, dist * .7));
  camera.near = size / 1000;
  camera.far = size * 10 + 100;
  camera.updateProjectionMatrix();
  grid.position.y = box.min.y;
}

på("btnFit", "click", fitToModel);

// ---------- Tekst-etiketter (sprites) ----------
export function makeLabel(text, color = "#f59e0b", sizeF = 0.028) {
  const pad = 14;
  const fs = 44;
  const mc = document.createElement("canvas").getContext("2d");
  mc.font = "bold " + fs + "px sans-serif";
  const w = mc.measureText(text).width + pad * 2;
  const c = document.createElement("canvas");
  c.width = Math.ceil(w);
  c.height = fs + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(20,24,31,0.85)";
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 14); ctx.fill(); }
  else ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  ctx.font = "bold " + fs + "px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.renderOrder = 998;
  const s = S.modelSize * sizeF;
  sprite.scale.set(s * c.width / c.height, s, 1);
  return sprite;
}

// ---------- Valg / egenskaper ----------
export const raycaster = new THREE.Raycaster();

export const pointer = new THREE.Vector2();

// Lapper og punkter med userData.px holder konstant størrelse på skjermen uansett modellstørrelse
const _ssV = new THREE.Vector3();

export function updateScreenScaled(group) {
  if (!group.children.length) return;
  const k = 2 * Math.tan(camera.fov * Math.PI / 360) / renderer.domElement.clientHeight;
  group.traverse(o => {
    const px = o.userData.px;
    if (!px) return;
    o.getWorldPosition(_ssV);
    const s = px * _ssV.distanceTo(camera.position) * k;
    if (o.isSprite) o.scale.set(s * (o.userData.aspect || 3), s, 1);
    else o.scale.setScalar(s / 2);
  });
}
