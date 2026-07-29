// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc } from "./state.js";
import { ANSATTE, PLANNER_DIR, PLANNER_PLAN_ID } from "./config.js";
import { setMode } from "./modes.js";
import { camera, controls, frameHooks, markerGroup } from "./scene.js";
import { GRAPH, SP, graphGet, spTokenSilent } from "./sharepoint.js";
// ⛓-lenka til en markering hentes via S.markerLink (settes av share.js).
// Direkte import ville gitt sirkel: markers → share → display → ifc → markers.

// ---------- Markeringer / kommentarer ----------

$("btnComments").addEventListener("click", () => {
  $("propPanel").classList.remove("open");
  $("qtyPanel").classList.remove("open");
  $("colorPanel").classList.remove("open");
  $("libPanel").classList.remove("open");
  $("axesPanel").classList.remove("open");
  $("searchPanel").classList.remove("open");
  $("comparePanel").classList.remove("open");
  $("clipPanel").classList.remove("open");
  $("sharePanel").classList.remove("open");
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

// ---------- Status, ansvarlig og frist ----------
// Fargen på markeringen forteller status, så modellen kan leses uten å åpne noe.
export const STATUS = {
  "Åpen":  { col: "#f59e0b", glyph: "!" },
  "Pågår": { col: "#3b82f6", glyph: "➜" },
  "Løst":  { col: "#3cb44b", glyph: "✓" }
};

export const statusOf = (c) => (c && STATUS[c.status] ? c.status : "Åpen");

// Frist som er gått, på noe som ikke er løst
export function isOverdue(c) {
  if (!c.due || statusOf(c) === "Løst") return false;
  return c.due < new Date().toISOString().slice(0, 10);
}

function makeMarkerTexture(col, glyph) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 10; ctx.strokeStyle = "#14181f"; ctx.stroke();
  ctx.fillStyle = "#14181f"; ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(glyph, 64, 68);
  return new THREE.CanvasTexture(c);
}

const markerTextures = {};
function textureFor(status) {
  const st = STATUS[status] || STATUS["Åpen"];
  if (!markerTextures[status]) markerTextures[status] = makeMarkerTexture(st.col, st.glyph);
  return markerTextures[status];
}

function addMarkerSprite(comment) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureFor(statusOf(comment)), depthTest: false }));
  sprite.position.set(comment.x, comment.y, comment.z);
  sprite.renderOrder = 999;
  const s = S.modelSize * 0.012 || 0.3;
  sprite.scale.set(s, s, 1);
  sprite.userData.commentId = comment.id;
  markerGroup.add(sprite);
}

// Endrer et felt på en markering og oppdaterer alt som viser den
function updateComment(c, patch) {
  Object.assign(c, patch);
  if (patch.status !== undefined) {
    markerGroup.children.filter(s => s.userData.commentId == c.id).forEach(s => markerGroup.remove(s));
    addMarkerSprite(c);
  }
  persist();
  pushSharedComments();
  renderCommentList();
  if (popFor && popFor.id === c.id) openMarkerPopup(c);
}

// ---------- Trykk på en 🟡 markering for å lese teksten ----------
// Bobla henges på selve markeringen og følger den når du roterer og zoomer.

const mRay = new THREE.Raycaster();
const mPt = new THREE.Vector2();

// Returnerer markeringen under punktet, eller null
export function pickMarker(clientX, clientY) {
  if (!markerGroup.children.length) return null;
  mPt.x = (clientX / innerWidth) * 2 - 1;
  mPt.y = -(clientY / innerHeight) * 2 + 1;
  mRay.setFromCamera(mPt, camera);
  const hits = mRay.intersectObjects(markerGroup.children, false);
  if (!hits.length) return null;
  const id = hits[0].object.userData.commentId;
  return S.comments.find(c => c.id == id) || null;
}

let popFor = null;                        // markeringen bobla hører til
const popAnchor = new THREE.Vector3();

export function closeMarkerPopup() {
  popFor = null;
  const el = $("markerPop");
  if (el) el.classList.remove("open");
}

export function openMarkerPopup(c) {
  if (!c) return;
  let el = $("markerPop");
  if (!el) {
    el = document.createElement("div");
    el.id = "markerPop";
    document.body.appendChild(el);
  }
  popFor = c;
  const st = statusOf(c);
  el.innerHTML =
    '<div class="mp-meta"><span>' + esc((c.author ? c.author + " · " : "") + (c.date || "")) + '</span>' +
      '<button class="mp-x" title="Lukk">✕</button></div>' +
    '<div class="mp-text">' + esc(c.text) + '</div>' +
    '<div class="mp-fields">' +
      '<label>Status<select class="mp-st">' + Object.keys(STATUS).map(k =>
        '<option value="' + k + '"' + (k === st ? " selected" : "") + '>' + k + '</option>').join("") + '</select></label>' +
      '<label>Ansvarlig<select class="mp-ow"><option value="">– ingen –</option>' +
        ANSATTE.map(a => '<option value="' + esc(a.navn) + '"' + (c.owner === a.navn ? " selected" : "") + '>' +
          esc(a.navn) + '</option>').join("") +
        (c.owner && !ANSATTE.some(a => a.navn === c.owner)
          ? '<option value="' + esc(c.owner) + '" selected>' + esc(c.owner) + '</option>' : "") +
      '</select></label>' +
      '<label>Frist<input type="date" class="mp-due" value="' + (c.due || "") + '"></label>' +
    '</div>' +
    (isOverdue(c) ? '<div class="mp-late">⚠️ Fristen er gått</div>' : "") +
    '<div class="mp-act"><button class="mp-go">🎯 Gå til</button>' +
      '<button class="mp-task" title="Lag Teams Planner-oppgave">📋 Planner</button>' +
      '<button class="mp-del">🗑 Slett</button></div>';
  el.querySelector(".mp-x").onclick = closeMarkerPopup;
  el.querySelector(".mp-go").onclick = () => goToComment(c);
  el.querySelector(".mp-st").onchange = (e) => updateComment(c, { status: e.target.value });
  el.querySelector(".mp-ow").onchange = (e) => updateComment(c, { owner: e.target.value });
  el.querySelector(".mp-due").onchange = (e) => updateComment(c, { due: e.target.value });
  el.querySelector(".mp-task").onclick = () => showPlannerCommand([c]);
  el.querySelector(".mp-del").onclick = () => { deleteComment(c.id); closeMarkerPopup(); };
  el.classList.add("open");
  placePopup();
}

// Flytter bobla dit markeringen er på skjermen nå
function placePopup() {
  const el = $("markerPop");
  if (!el || !popFor) return;
  popAnchor.set(popFor.x, popFor.y, popFor.z).project(camera);
  if (popAnchor.z > 1) { el.style.visibility = "hidden"; return; }  // bak kameraet
  el.style.visibility = "visible";
  const x = (popAnchor.x * 0.5 + 0.5) * innerWidth;
  const y = (-popAnchor.y * 0.5 + 0.5) * innerHeight;
  const w = el.offsetWidth || 240, h = el.offsetHeight || 90;
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + "px";
  el.style.top = Math.max(8, Math.min(innerHeight - h - 8, y - h - 18)) + "px";
}

frameHooks.push(() => { if (popFor) placePopup(); });

export function goToComment(c) {
  controls.target.set(c.x, c.y, c.z);
  const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(8);
  camera.position.set(c.x + off.x, c.y + off.y, c.z + off.z);
}

export function deleteComment(id) {
  S.comments = S.comments.filter(c => c.id != id);
  markerGroup.children.filter(s => s.userData.commentId == id).forEach(s => markerGroup.remove(s));
  persist(); pushSharedComments(); renderCommentList();
}

// Esc lukker bobla (tastetrykket håndteres ellers i ui.js)
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMarkerPopup(); });

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
    status: "Åpen",
    owner: (ANSATTE[0] && ANSATTE[0].navn) || "",
    due: "",
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

// ---------- 📋 Teams Planner ----------
// Nettleseren kan ikke opprette Planner-oppgaver selv (viewer'en har bare
// Sites/Files-tilgang), så vi lager den ferdige kommandoen slik em-flyten gjør.

// Anførselstegn i PowerShell-argument dobles
const pq = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").replace(/"/g, '""').trim();

export function plannerCommandFor(c, lenke) {
  const modell = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  const kort = (c.text || "").replace(/\s+/g, " ").trim();
  const tittel = "IFC " + modell + ": " + (kort.length > 60 ? kort.slice(0, 57) + "…" : kort);
  const person = ANSATTE.find(a => a.navn === c.owner);
  return "python markering_planner.py" +
    ' --plan "' + PLANNER_PLAN_ID + '"' +
    ' --oppgavenavn "' + pq(tittel) + '"' +
    ' --frist "' + (c.due || "") + '"' +
    ' --ansvarlig "' + pq(person ? person.id : (c.owner || "")) + '"' +
    ' --status "' + statusOf(c) + '"' +
    ' --modell "' + pq(S.fileName || "") + '"' +
    ' --markering "' + c.id + '"' +
    (lenke ? ' --lenke "' + lenke + '"' : "");
}

async function showPlannerCommand(list) {
  const uten = list.filter(c => !c.due);
  if (uten.length) {
    alert((uten.length === 1 ? "Markeringen mangler frist." : uten.length + " markeringer mangler frist.") +
      " Sett frist først – Planner-oppgaven trenger en dato.");
    return;
  }
  const lines = [];
  for (const c of list) {
    let lenke = "";
    try { if (S.markerLink) lenke = await S.markerLink(c); } catch(_) {}
    lines.push(plannerCommandFor(c, lenke));
  }
  const cmd = 'cd "' + PLANNER_DIR + '"\r\n' + lines.join("\r\n");
  const body = $("commentBody");
  $("commentPanel").classList.add("open");
  body.innerHTML =
    '<div class="prop-actions"><button id="cmTilbake">← Tilbake til markeringer</button>' +
      '<button id="cmCopy" class="primary">📋 Kopier kommando</button></div>' +
    '<p style="color:var(--muted); font-size:11px; margin:0 0 8px">Lim inn i PowerShell på din maskin. ' +
      'Oppgaven havner i Planner med frist, ansvarlig og en ⛓-lenke rett til markeringen i modellen.</p>' +
    '<textarea id="cmCmd" readonly rows="' + Math.min(14, 3 + lines.length * 2) + '" style="width:100%; font-size:11px; ' +
      'background:var(--panel2); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px">' +
      esc(cmd) + '</textarea>';
  $("cmTilbake").onclick = renderCommentList;
  $("cmCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      $("cmCopy").textContent = "✅ Kopiert";
      setTimeout(() => { if ($("cmCopy")) $("cmCopy").textContent = "📋 Kopier kommando"; }, 1500);
    } catch(_) { $("cmCmd").select(); alert("Trykk Ctrl+C for å kopiere."); }
  };
}

let listFilter = "alle";

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

  // teller per status + filterknapper
  const antall = { alle: S.comments.length };
  Object.keys(STATUS).forEach(k => antall[k] = S.comments.filter(c => statusOf(c) === k).length);
  const knapp = (key, tekst) => '<button data-flt="' + key + '"' +
    (listFilter === key ? ' class="active"' : "") + '>' + tekst + ' ' + (antall[key] || 0) + '</button>';
  let html = status +
    '<div class="prop-actions">' + knapp("alle", "Alle") +
      Object.keys(STATUS).map(k => knapp(k, k)).join("") + '</div>';

  const vis = S.comments.filter(c => listFilter === "alle" || statusOf(c) === listFilter);
  const apne = S.comments.filter(c => statusOf(c) !== "Løst" && c.due);
  if (apne.length > 1) {
    html += '<div class="prop-actions"><button id="cmAllTasks">📋 Planner-kommandoer for ' +
      apne.length + ' uløste</button></div>';
  }

  html += vis.map(c => {
    const st = statusOf(c);
    return '<div class="comment" data-id="' + c.id + '" style="border-left:3px solid ' + STATUS[st].col + '">' +
      '<div class="meta"><span>' + esc((c.author ? c.author + " · " : "") + (c.date || "")) + '</span>' +
        '<span class="del" data-del="' + c.id + '">Slett</span></div>' +
      '<div>' + esc(c.text) + '</div>' +
      '<div class="meta" style="margin-top:4px"><span>' +
        '<span style="color:' + STATUS[st].col + '">●</span> ' + st +
        (c.owner ? ' · ' + esc(c.owner) : "") +
        (c.due ? ' · frist ' + esc(c.due.split("-").reverse().join(".")) : "") +
        (isOverdue(c) ? ' <span style="color:#ef4444">⚠️ gått</span>' : "") +
      '</span></div></div>';
  }).join("") ||
    '<p style="color:var(--muted)">Ingen markeringer med status «' + esc(listFilter) + '».</p>';

  body.innerHTML = html;
  body.querySelectorAll("button[data-flt]").forEach(b => {
    b.onclick = () => { listFilter = b.dataset.flt; renderCommentList(); };
  });
  if ($("cmAllTasks")) $("cmAllTasks").onclick = () => showPlannerCommand(apne);
  body.querySelectorAll(".comment").forEach(el => {
    el.addEventListener("click", (e) => {
      const delId = e.target.getAttribute("data-del");
      if (delId) { deleteComment(delId); closeMarkerPopup(); return; }
      const c = S.comments.find(c => c.id == el.dataset.id);
      if (c) { goToComment(c); openMarkerPopup(c); }
    });
  });
}
