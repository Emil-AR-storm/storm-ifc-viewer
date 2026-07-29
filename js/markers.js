// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc } from "./state.js";
import { setMode } from "./modes.js";
import { camera, controls, markerGroup } from "./scene.js";
import { GRAPH, SP, graphGet, spTokenSilent } from "./sharepoint.js";

// ---------- Markeringer / kommentarer ----------

$("btnComments").addEventListener("click", () => {
  $("propPanel").classList.remove("open");
  $("qtyPanel").classList.remove("open");
  $("colorPanel").classList.remove("open");
  $("libPanel").classList.remove("open");
  $("axesPanel").classList.remove("open");
  $("searchPanel").classList.remove("open");
  $("commentPanel").classList.toggle("open");
});

function storageKey(){ return "storm-ifc-comments::" + S.fileName; }

export function loadComments() {
  try {
    const raw = localStorage.getItem(storageKey());
    S.comments = raw ? JSON.parse(raw) : [];
  } catch(_) { S.comments = []; }
  S.comments.forEach(addMarkerSprite);
  renderCommentList();
  syncSharedComments(); // hent delte markeringer fra SharePoint i bakgrunnen
}

function persist() {
  try { localStorage.setItem(storageKey(), JSON.stringify(S.comments)); } catch(_){}
}

// ---- Delte markeringer (lagres som JSON i SharePoint: IFC-modeller/Markeringer) ----

const syncedFile = () => S.fileName;

function sharedFilePath() {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/Markeringer/" + encodeURIComponent(syncedFile() + ".markeringer.json");
}

async function sharedSiteId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

async function syncSharedComments() {
  const forFile = syncedFile();
  if (!forFile) return;
  const token = await spTokenSilent();
  if (!token) { S.sharedOK = false; renderCommentList(); return; }
  try {
    const sid = await sharedSiteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + ":/content",
      { headers: { Authorization: "Bearer " + token } });
    let remote = [];
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) remote = d; }
    else if (r.status !== 404) throw new Error("Graph " + r.status);
    if (syncedFile() !== forFile) return; // brukeren byttet modell underveis
    const have = new Set(remote.map(c => c.id));
    const localOnly = S.comments.filter(c => !have.has(c.id));
    S.comments = remote.concat(localOnly);
    markerGroup.clear();
    S.comments.forEach(addMarkerSprite);
    persist();
    S.sharedOK = true;
    renderCommentList();
    if (localOnly.length) pushSharedComments(); // last opp det som bare fantes lokalt
  } catch(_) { S.sharedOK = false; renderCommentList(); }
}

async function pushSharedComments() {
  const forFile = syncedFile();
  if (!forFile) return;
  const token = await spTokenSilent();
  if (!token) { S.sharedOK = false; renderCommentList(); return; }
  try {
    const sid = await sharedSiteId(token);
    const body = JSON.stringify(S.comments);
    if (syncedFile() !== forFile) return;
    const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + ":/content", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body
    });
    S.sharedOK = r.ok;
  } catch(_) { S.sharedOK = false; }
  renderCommentList();
}

function makeMarkerTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = "#f59e0b"; ctx.fill();
  ctx.lineWidth = 10; ctx.strokeStyle = "#14181f"; ctx.stroke();
  ctx.fillStyle = "#14181f"; ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("!", 64, 68);
  return new THREE.CanvasTexture(c);
}

const markerTexture = makeMarkerTexture();

function addMarkerSprite(comment) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture, depthTest: false }));
  sprite.position.set(comment.x, comment.y, comment.z);
  sprite.renderOrder = 999;
  const s = S.modelSize * 0.012 || 0.3;
  sprite.scale.set(s, s, 1);
  sprite.userData.commentId = comment.id;
  markerGroup.add(sprite);
}

window.saveComment = function() {
  const text = $("commentText").value.trim();
  $("commentDialog").classList.remove("open");
  if (!text || !S.pendingPoint) { S.pendingPoint = null; return; }
  let author = "";
  try { const a = S.msalApp && S.msalApp.getActiveAccount(); author = (a && (a.name || a.username)) || ""; } catch(_){}
  const c = {
    id: Date.now(),
    text,
    author,
    x: S.pendingPoint.x, y: S.pendingPoint.y, z: S.pendingPoint.z,
    date: new Date().toLocaleString("no-NO", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })
  };
  S.comments.push(c);
  addMarkerSprite(c);
  persist();
  pushSharedComments();
  renderCommentList();
  S.pendingPoint = null;
  if (S.mode === "marker") setMode("marker"); // slå av markering-modus
};

window.cancelComment = function() {
  $("commentDialog").classList.remove("open");
  S.pendingPoint = null;
};

export function renderCommentList() {
  $("commentCount").textContent = S.comments.length;
  const body = $("commentBody");
  const status = S.sharedOK
    ? '<p style="color:#3cb44b; font-size:11px; margin:0 0 8px">🟢 Delt via SharePoint – alle med tilgang ser disse</p>'
    : '<p style="color:var(--muted); font-size:11px; margin:0 0 8px">⚪ Kun lagret på denne enheten – logg inn i 📚 Biblioteket for å dele</p>';
  if (!S.comments.length) {
    body.innerHTML = status + '<p style="color:var(--muted)">Ingen markeringer ennå. Trykk på 📌 Markering og deretter på modellen.</p>';
    return;
  }
  body.innerHTML = status + S.comments.map(c =>
    `<div class="comment" data-id="${c.id}">
       <div class="meta"><span>${esc((c.author ? c.author + " · " : "") + (c.date || ""))}</span><span class="del" data-del="${c.id}">Slett</span></div>
       <div>${esc(c.text)}</div>
     </div>`).join("");
  body.querySelectorAll(".comment").forEach(el => {
    el.addEventListener("click", (e) => {
      const delId = e.target.getAttribute("data-del");
      if (delId) {
        S.comments = S.comments.filter(c => c.id != delId);
        markerGroup.children.filter(s => s.userData.commentId == delId).forEach(s => markerGroup.remove(s));
        persist(); pushSharedComments(); renderCommentList();
        return;
      }
      const c = S.comments.find(c => c.id == el.dataset.id);
      if (c) {
        controls.target.set(c.x, c.y, c.z);
        const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(8);
        camera.position.set(c.x + off.x, c.y + off.y, c.z + off.z);
      }
    });
  });
}
