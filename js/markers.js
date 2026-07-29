// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { ANSATTE } from "./config.js";
import { fristTilISO, fullforOppgave, opprettOppgave, planUrl, plannerToken } from "./planner.js";
import { setMode } from "./modes.js";
import { camera, controls, frameHooks, markerGroup } from "./scene.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { MAKS_PER_MARKERING, bildeUrl, erBildefil, leggTilBilder, slettBilder } from "./bilder.js";
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
  try {
    // spTokenSilent kan kaste hvis MSAL ikke lastet – da er vi bare offline
    const token = await spTokenSilent();
    if (!token) { S.sharedOK = false; renderCommentList(); return; }
    const sid = await sharedSiteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + ":/content",
      { headers: authHeaders(token, null, "markeringer") });
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
  try {
    const token = await spTokenSilent();
    if (!token) { S.sharedOK = false; renderCommentList(); return; }
    const sid = await sharedSiteId(token);
    const body = JSON.stringify(S.comments);
    if (syncedFile() !== forFile) return;
    const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + ":/content", {
      method: "PUT",
      headers: authHeaders(token, { "Content-Type": "application/json" }, "markeringer"),
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
    // Løst markering → kryss av oppgaven i Planner også. Stille: har vi ikke
    // tilgang der og da, lar vi det ligge i stedet for å avbryte brukeren.
    if (patch.status === "Løst" && c.taskId) {
      plannerToken(true)
        .then(t => t && fullforOppgave(t, c.taskId))
        .catch(err => console.warn("Kunne ikke fullføre Planner-oppgaven:", err.message));
    }
  }
  persist();
  pushSharedComments();
  renderCommentList();
  if (popFor && popFor.id === c.id) openMarkerPopup(c);
}

// ---------- 📷 Bilder ----------
// Bildene ligger i SharePoint (se js/bilder.js). Her er bare visningen: en
// stripe med miniatyrbilder i bobla, og en 📷-knapp som åpner kamera/filvelger.

function bildeStripeHtml(c, kanLeggeTil) {
  const liste = c.bilder || [];
  if (!liste.length && !kanLeggeTil) return "";
  return '<div class="mp-bilder">' +
    liste.map(f => '<span class="mp-bilde" data-bilde="' + esc(f) + '" title="Åpne bildet"></span>').join("") +
    (kanLeggeTil && liste.length < MAKS_PER_MARKERING
      ? '<label class="mp-bilde nytt" title="Ta bilde eller velg fil">📷' +
        '<input type="file" accept="image/*" capture="environment" multiple hidden></label>'
      : "") +
    '</div>';
}

// Fyller miniatyrbildene etterpå – hvert bilde hentes fra SharePoint én gang.
function fyllMiniatyrer(rot) {
  rot.querySelectorAll(".mp-bilde[data-bilde]").forEach(async el => {
    if (el.dataset.fylt) return;
    el.dataset.fylt = "1";
    const url = await bildeUrl(el.dataset.bilde);
    if (!url) { el.classList.add("mangler"); el.textContent = "🔒"; el.title = "Logg inn for å se bildet"; return; }
    const img = document.createElement("img");
    img.src = url;
    el.appendChild(img);
    el.onclick = () => visStort(url);
  });
}

// Bildet i full skjerm. Klikk eller Esc lukker.
function visStort(url) {
  let el = $("bildeVis");
  if (!el) {
    el = document.createElement("div");
    el.id = "bildeVis";
    document.body.appendChild(el);
    el.addEventListener("click", () => el.classList.remove("open"));
  }
  el.innerHTML = '<img src="' + url + '" alt=""><button class="bv-x" title="Lukk">✕</button>';
  el.classList.add("open");
}

function lukkBildeVis() { const el = $("bildeVis"); if (el) el.classList.remove("open"); }

// Felles håndtering av valgte filer: komprimer, last opp, lagre filnavnene.
async function taImotFiler(c, filer, etterpa) {
  const gode = [...filer].filter(erBildefil);
  if (!gode.length) { alert("Fant ingen bildefiler blant det du valgte."); return; }
  const plass = MAKS_PER_MARKERING - (c.bilder || []).length;
  if (plass <= 0) { alert("En markering kan ha maks " + MAKS_PER_MARKERING + " bilder."); return; }
  loadingText.textContent = gode.length > 1 ? "Laster opp " + Math.min(gode.length, plass) + " bilder …" : "Laster opp bildet …";
  loadingEl.classList.add("open");
  try {
    const navn = await leggTilBilder(c.id, gode, c.bilder);
    c.bilder = (c.bilder || []).concat(navn);
    persist();
    pushSharedComments();
    renderCommentList();
    if (etterpa) etterpa();
  } catch (err) {
    alert(err.message === "IKKE_INNLOGGET"
      ? "Bilder lagres i SharePoint, så du må være innlogget. Åpne 📚 Biblioteket og logg inn, så prøv igjen."
      : "Klarte ikke å legge ved bildet: " + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
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
    bildeStripeHtml(c, true) +
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
      (c.taskId
        ? '<button class="mp-open" title="Åpne oppgaven i Planner">📋 Se oppgave</button>'
        : '<button class="mp-task" id="mp-task" title="Lag Teams Planner-oppgave">📋 Planner</button>') +
      '<button class="mp-del">🗑 Slett</button></div>';
  el.querySelector(".mp-x").onclick = closeMarkerPopup;
  el.querySelector(".mp-go").onclick = () => goToComment(c);
  el.querySelector(".mp-st").onchange = (e) => updateComment(c, { status: e.target.value });
  el.querySelector(".mp-ow").onchange = (e) => updateComment(c, { owner: e.target.value });
  el.querySelector(".mp-due").onchange = (e) => updateComment(c, { due: e.target.value });
  if (el.querySelector(".mp-task")) el.querySelector(".mp-task").onclick = () => sendTilPlanner([c]);
  if (el.querySelector(".mp-open")) el.querySelector(".mp-open").onclick = () => window.open(c.taskUrl || planUrl(), "_blank");
  el.querySelector(".mp-del").onclick = () => { deleteComment(c.id); closeMarkerPopup(); };
  const filvelger = el.querySelector(".mp-bilder input[type=file]");
  if (filvelger) filvelger.onchange = () => {
    const filer = [...filvelger.files];
    filvelger.value = "";                       // samme bilde skal kunne velges igjen
    taImotFiler(c, filer, () => openMarkerPopup(c));
  };
  fyllMiniatyrer(el);
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
  const c = S.comments.find(c => c.id == id);
  // bildefilene i SharePoint ryddes med, så vi ikke samler opp foreldreløse filer
  if (c && (c.bilder || []).length) slettBilder(c.bilder);
  S.comments = S.comments.filter(c => c.id != id);
  markerGroup.children.filter(s => s.userData.commentId == id).forEach(s => markerGroup.remove(s));
  persist(); pushSharedComments(); renderCommentList();
}

// Esc lukker bildet i full skjerm først, deretter bobla
// (tastetrykket håndteres ellers i ui.js)
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const bv = $("bildeVis");
  if (bv && bv.classList.contains("open")) { lukkBildeVis(); return; }
  closeMarkerPopup();
});

// Bilder valgt i «Ny markering» venter i S.nyeBilder til markeringen er lagret –
// først da har vi en id å navngi filene etter.
const filInput = $("commentFiles");
if (filInput) filInput.onchange = () => {
  S.nyeBilder = [...filInput.files].filter(erBildefil).slice(0, MAKS_PER_MARKERING);
  visValgteFiler();
};

function visValgteFiler() {
  const info = $("commentFileInfo");
  if (!info) return;
  const n = S.nyeBilder.length;
  info.textContent = n ? (n === 1 ? "1 bilde valgt" : n + " bilder valgt") : "";
}

export function nullstillNyeBilder() {
  S.nyeBilder = [];
  const inp = $("commentFiles");
  if (inp) inp.value = "";
  visValgteFiler();
}

window.saveComment = function() {
  const text = $("commentText").value.trim();
  $("commentDialog").classList.remove("open");
  if (!text || !S.pendingPoint) { S.pendingPoint = null; nullstillNyeBilder(); return; }
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
  // markeringen er lagret nå – bildene lastes opp i bakgrunnen etterpå
  if (S.nyeBilder.length) {
    const filer = S.nyeBilder;
    nullstillNyeBilder();
    taImotFiler(c, filer, () => { if (popFor && popFor.id === c.id) openMarkerPopup(c); });
  } else nullstillNyeBilder();
  if (S.mode === "marker") setMode("marker"); // slå av markering-modus
};

window.cancelComment = function() {
  $("commentDialog").classList.remove("open");
  S.pendingPoint = null;
  nullstillNyeBilder();
};

// ---------- 📋 Teams Planner ----------
// Oppgaven opprettes rett fra nettleseren med brukerens egen Microsoft-innlogging.

export function oppgaveTittel(c) {
  const modell = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  const kort = (c.text || "").replace(/\s+/g, " ").trim();
  return "IFC " + modell + ": " + (kort.length > 60 ? kort.slice(0, 57) + "…" : kort);
}

export function oppgaveNotat(c, lenke) {
  const l = [
    "Markering i Storm IFC-Viewer",
    "Modell: " + (S.fileName || "–"),
    "Status: " + statusOf(c),
    c.author ? "Satt av: " + c.author : "",
    "",
    (c.text || "").trim()
  ];
  if (lenke) { l.push("", "Åpne markeringen i modellen:", lenke); }
  return l.filter((x, i) => x !== "" || i > 0).join("\n").trim();
}

// Tar en liste markeringer og lager én Planner-oppgave per markering
async function sendTilPlanner(list) {
  const uten = list.filter(c => !c.due);
  if (uten.length) {
    alert((uten.length === 1 ? "Markeringen mangler frist." : uten.length + " markeringer mangler frist.") +
      " Sett frist først – Planner-oppgaven trenger en dato.");
    return;
  }
  const alt = list.filter(c => c.taskId);
  if (alt.length && !confirm(alt.length === 1
      ? "Denne markeringen har allerede en Planner-oppgave. Lage en ny?"
      : alt.length + " av markeringene har allerede oppgaver. Lage nye for alle?")) return;

  const btnIds = ["mp-task", "cmAllTasks"];
  btnIds.forEach(id => { const b = $(id); if (b) b.disabled = true; });   // hindrer doble oppgaver
  loadingText.textContent = "Lager Planner-oppgave …";
  loadingEl.classList.add("open");
  try {
    const token = await plannerToken();
    if (!token) return;   // på vei til samtykke, eller brukeren avbrøt
    let laget = 0;
    for (const c of list) {
      loadingText.textContent = "Lager Planner-oppgave " + (laget + 1) + " av " + list.length + " …";
      let lenke = "";
      try { if (S.markerLink) lenke = await S.markerLink(c); } catch(_) {}
      const person = ANSATTE.find(a => a.navn === c.owner);
      const res = await opprettOppgave(token, {
        title: oppgaveTittel(c),
        dueISO: fristTilISO(c.due),
        description: oppgaveNotat(c, lenke),
        assignees: person ? [person.id] : []
      });
      c.taskId = res.id;
      c.taskUrl = res.url;
      laget++;
    }
    persist();
    pushSharedComments();
    renderCommentList();
    if (popFor) openMarkerPopup(popFor);
    loadingEl.classList.remove("open");
    if (confirm("✅ " + laget + (laget === 1 ? " oppgave" : " oppgaver") +
        " opprettet i Planner.\n\nÅpne Planner-tavla nå?")) window.open(planUrl(), "_blank");
  } catch (err) {
    loadingEl.classList.remove("open");
    const m = /403|Forbidden/.test(err.message)
      ? "Planner nektet. Vanligste årsak: den ansvarlige er ikke medlem av gruppen som eier planen."
      : err.message;
    alert("Klarte ikke å lage Planner-oppgave: " + m);
  } finally {
    loadingEl.classList.remove("open");
    btnIds.forEach(id => { const b = $(id); if (b) b.disabled = false; });
  }
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
  // uløste med frist, som ikke alt har fått en oppgave
  const apne = S.comments.filter(c => statusOf(c) !== "Løst" && c.due && !c.taskId);
  if (apne.length > 1) {
    html += '<div class="prop-actions"><button id="cmAllTasks">📋 Lag ' +
      apne.length + ' Planner-oppgaver</button></div>';
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
        (c.taskId ? ' · <span title="Har en Planner-oppgave">📋</span>' : "") +
        ((c.bilder || []).length ? ' · <span title="Har bilder">📷 ' + c.bilder.length + '</span>' : "") +
      '</span></div></div>';
  }).join("") ||
    '<p style="color:var(--muted)">Ingen markeringer med status «' + esc(listFilter) + '».</p>';

  body.innerHTML = html;
  body.querySelectorAll("button[data-flt]").forEach(b => {
    b.onclick = () => { listFilter = b.dataset.flt; renderCommentList(); };
  });
  if ($("cmAllTasks")) $("cmAllTasks").onclick = () => sendTilPlanner(apne);
  body.querySelectorAll(".comment").forEach(el => {
    el.addEventListener("click", (e) => {
      const delId = e.target.getAttribute("data-del");
      if (delId) { deleteComment(delId); closeMarkerPopup(); return; }
      const c = S.comments.find(c => c.id == el.dataset.id);
      if (c) { goToComment(c); openMarkerPopup(c); }
    });
  });
}
