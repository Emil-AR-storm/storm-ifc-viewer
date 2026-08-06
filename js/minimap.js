// 🗺 Minikart: toppvisning med kameraprikk, trykk for å flytte deg.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, writePrefs } from "./state.js";
import { axesGroup, camera, controls, frameHooks, grid, koteGroup, markerGroup, measureGroup, renderer, scene, selGroup } from "./scene.js";

// ---------- 🗺 Minikart (ovenfra, trykk for å flytte deg) ----------
export const miniCanvas = $("miniMap");

export function renderMiniMap() {
  S.miniInfo = null; S.miniBase = null;
  if (!S.modelGroup || !S.modelBox) { miniCanvas.style.display = "none"; return; }
  const size = 256;
  try {
    const c = S.modelBox.getCenter(new THREE.Vector3());
    const half = (Math.max(S.modelBox.max.x - S.modelBox.min.x, S.modelBox.max.z - S.modelBox.min.z) / 2) * 1.06 || 1;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, (S.modelBox.max.y - S.modelBox.min.y) + S.modelSize);
    cam.position.set(c.x, S.modelBox.max.y + S.modelSize * 0.2, c.z);
    cam.up.set(0, 0, -1);
    cam.lookAt(c.x, S.modelBox.min.y, c.z);
    cam.updateMatrixWorld(true);
    // render toppvisning uten overlegg/klipping til en offscreen-buffer
    const rt = new THREE.WebGLRenderTarget(size, size);
    const overlays = [markerGroup, measureGroup, koteGroup, axesGroup, selGroup];
    const vis = overlays.map(g => g.visible);
    overlays.forEach(g => g.visible = false);
    const gridVis = grid.visible; grid.visible = false;
    const prevClip = renderer.clippingPlanes; renderer.clippingPlanes = [];
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = prevClip;
    overlays.forEach((g, i) => g.visible = vis[i]);
    grid.visible = gridVis;
    rt.dispose();
    const ctx = miniCanvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    S.miniBase = img;
    S.miniInfo = { cx: c.x, cz: c.z, half, size };
    drawMiniOverlay(true);
    miniCanvas.style.display = S.miniOn ? "block" : "none";
    if (S.applyCubePos) S.applyCubePos();
  } catch(_) { miniCanvas.style.display = "none"; }
}

const _miniLast = { tx: NaN, tz: NaN, kx: NaN, kz: NaN };

function drawMiniOverlay(force) {
  if (!S.miniInfo || !S.miniBase) return;
  const t = controls.target, k = camera.position;
  if (!force && t.x === _miniLast.tx && t.z === _miniLast.tz && k.x === _miniLast.kx && k.z === _miniLast.kz) return;
  _miniLast.tx = t.x; _miniLast.tz = t.z; _miniLast.kx = k.x; _miniLast.kz = k.z;
  const { cx, cz, half, size } = S.miniInfo;
  const map = (wx, wz) => [size / 2 + (wx - cx) / half * (size / 2), size / 2 + (wz - cz) / half * (size / 2)];
  const ctx = miniCanvas.getContext("2d");
  ctx.putImageData(S.miniBase, 0, 0);
  const [px, py] = map(t.x, t.z);
  const [kx, ky] = map(k.x, k.z);
  ctx.strokeStyle = "#f59e0b"; ctx.fillStyle = "#f59e0b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(px, py); ctx.stroke(); // synsretning
  ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();       // hvor du ser
}

miniCanvas.addEventListener("pointerdown", (e) => {
  if (!S.miniInfo) return;
  e.preventDefault();
  const r = miniCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) / r.width * S.miniInfo.size;
  const my = (e.clientY - r.top) / r.height * S.miniInfo.size;
  const wx = S.miniInfo.cx + (mx - S.miniInfo.size / 2) / (S.miniInfo.size / 2) * S.miniInfo.half;
  const wz = S.miniInfo.cz + (my - S.miniInfo.size / 2) / (S.miniInfo.size / 2) * S.miniInfo.half;
  // flytt kamera + mål dit man trykket (høyden beholdes)
  const dx = wx - controls.target.x, dz = wz - controls.target.z;
  controls.target.x += dx; controls.target.z += dz;
  camera.position.x += dx; camera.position.z += dz;
});

// Minikartet styres nå fra ⚙ Innstillinger (av/på + størrelse)
export function setMini(on) {
  S.miniOn = on;
  writePrefs();
  miniCanvas.style.display = S.miniOn && S.miniBase ? "block" : "none";
  if (S.applyCubePos) S.applyCubePos();   // kuben står kanskje ved siden av kartet
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

export function applyMiniSize() {
  const px = Math.max(100, Math.min(400, Number(S.settings && S.settings.miniSize) || 180));
  miniCanvas.style.width = px + "px";
  miniCanvas.style.height = px + "px";
  if (S.applyCubePos) S.applyCubePos();
}

applyMiniSize();

// tegn kameraprikken i minikartet hver frame
frameHooks.push(drawMiniOverlay);

