// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { ANSATTE } from "./config.js";
import { fristTilISO, fullforOppgave, opprettOppgave, planUrl, plannerToken } from "./planner.js";
import { setMode } from "./modes.js";
import { camera, controls, frameHooks, markerGroup, renderer } from "./scene.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { MAKS_PER_MARKERING, bildeUrl, erBildefil, leggTilBilder, slettBilder } from "./bilder.js";
import { ADVAR_MB, antallSider, gyldigSide, hentTegninger, mb, sideBilde, velgMappe, visStatus } from "./tegninger.js";
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

// ---------- Størrelsen på markeringene ----------
// Før ble størrelsen satt til en brøkdel av modellen. På et datasenter på 200 m
// ble markeringen digre, på en vaskehall bitte liten. Nå holdes den på samme
// antall piksler på skjermen uansett modell og zoom, som en kartnål.
export const MARKER_PX = 26;

// Hvor stor må en sprite være i modellens enheter for å dekke `px` piksler på
// skjermen, når den står `avstand` fra kameraet?
export function markerSkala(avstand, fovGrader, hoydePx, px) {
  const h = hoydePx || 800;
  const synsfelt = 2 * Math.tan((fovGrader || 60) * Math.PI / 360);
  return Math.max(1e-6, avstand) * synsfelt * ((px || MARKER_PX) / h);
}

function skalerMarkeringer() {
  const n = markerGroup.children.length;
  if (!n) return;
  const h = (renderer.domElement && renderer.domElement.clientHeight) || 800;
  for (const s of markerGroup.children) {
    const k = markerSkala(camera.position.distanceTo(s.position), camera.fov, h);
    s.scale.set(k, k, 1);
  }
}

frameHooks.push(skalerMarkeringer);

function addMarkerSprite(comment) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureFor(statusOf(comment)), depthTest: false }));
  sprite.position.set(comment.x, comment.y, comment.z);
  sprite.renderOrder = 999;
  sprite.userData.commentId = comment.id;
  markerGroup.add(sprite);
  skalerMarkeringer();   // riktig størrelse med en gang, ikke først ved neste bilde
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

// Bildene ligger i to seksjoner, så et avvik kan dokumenteres før og etter at
// det er rettet. «Før» er den gamle lista (c.bilder), så markeringer som alt
// har bilder beholder dem.
export const SEKSJONER = [["for", "Før", "bilder"], ["etter", "Etter", "bilderEtter"]];

export function bildeFelt(seksjon) {
  const s = SEKSJONER.find(x => x[0] === seksjon);
  return s ? s[2] : "bilder";
}

export function bilderI(c, seksjon) {
  return (c && c[bildeFelt(seksjon)]) || [];
}

// Alle bildene til en markering, i rekkefølgen de vises – brukes til nummerering
// av nye filnavn, til telleren i lista og til opprydding ved sletting.
export function alleBilder(c) {
  return SEKSJONER.reduce((ut, [s]) => ut.concat(bilderI(c, s)), []);
}

function bildeStripeHtml(c, kanLeggeTil) {
  return SEKSJONER.map(([seksjon, tittel]) => {
    const liste = bilderI(c, seksjon);
    if (!liste.length && !kanLeggeTil) return "";
    return '<div class="mp-seksjon"><div class="mp-seksjon-tittel">' + tittel +
      (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
      '<div class="mp-bilder">' +
      liste.map(f => '<span class="mp-bilde" data-bilde="' + esc(f) + '" data-seksjon="' + seksjon + '" title="Åpne bildet"></span>').join("") +
      (kanLeggeTil && liste.length < MAKS_PER_MARKERING
        ? '<label class="mp-bilde nytt" title="Ta bilde eller velg fil (' + tittel.toLowerCase() + ')">📷' +
          '<input type="file" accept="image/*" capture="environment" multiple hidden data-seksjon="' + seksjon + '"></label>'
        : "") +
      '</div></div>';
  }).join("");
}

// Fyller miniatyrbildene etterpå – hvert bilde hentes fra SharePoint én gang.
function fyllMiniatyrer(rot, c) {
  rot.querySelectorAll(".mp-bilde[data-bilde]").forEach(async el => {
    if (el.dataset.fylt) return;
    el.dataset.fylt = "1";
    const url = await bildeUrl(el.dataset.bilde);
    if (!url) { el.classList.add("mangler"); el.textContent = "🔒"; el.title = "Logg inn for å se bildet"; return; }
    const img = document.createElement("img");
    img.src = url;
    el.appendChild(img);
    // du blar gjennom ALLE bildene i markeringen, så før og etter kan
    // sammenlignes med piltastene
    el.onclick = () => visStort(c, alleBilder(c).indexOf(el.dataset.bilde));
  });
}

// ---------- 📄 Arbeidstegninger på en markering ----------
// Vedlegget er en henvisning: { fil, itemId, side, storrelse }. Fjerner du den,
// forsvinner bare henvisningen – PDF-en ligger trygt i tegningsbiblioteket.

export function tegningerI(c) {
  return (c && c.tegninger) || [];
}

export function tegningTekst(v) {
  return v.fil + (v.side > 1 ? " · s. " + v.side : "");
}

function tegningStripeHtml(c) {
  const liste = tegningerI(c);
  return '<div class="mp-seksjon"><div class="mp-seksjon-tittel">Arbeidstegninger' +
    (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
    '<div class="mp-tegninger">' +
    liste.map((v, i) =>
      '<span class="mp-tegning" data-tegning="' + i + '" title="Åpne ' + esc(v.fil) + '">' +
      '📄 ' + esc(tegningTekst(v)) +
      (mb(v.storrelse) > ADVAR_MB ? ' <span class="stor">' + mb(v.storrelse).toFixed(0) + ' MB</span>' : "") +
      '<button class="mp-tegning-x" data-fjern="' + i + '" title="Fjern henvisningen (tegningen slettes ikke)">✕</button>' +
      '</span>').join("") +
    '<button class="mp-tegning nytt" id="mpTegning">📄 Legg til arbeidstegning</button>' +
    '</div></div>';
}

// Velgeren: lista over PDF-ene som hører til modellen, med søk og sidetall.
async function apneTegningVelger(c) {
  let el = $("tegningVelg");
  if (!el) {
    el = document.createElement("div");
    el.id = "tegningVelg";
    document.body.appendChild(el);
    el.addEventListener("click", (e) => { if (e.target === el) lukkTegningVelger(); });
  }
  el.innerHTML = '<div class="tv-boks"><div class="tv-topp">📄 Arbeidstegninger' +
    '<button class="tv-x" title="Lukk">✕</button></div>' +
    '<div class="tv-kropp"><p style="color:var(--muted)">Henter tegninger fra SharePoint …</p></div></div>';
  el.querySelector(".tv-x").onclick = lukkTegningVelger;
  el.classList.add("open");
  const kropp = el.querySelector(".tv-kropp");

  let svar;
  try { svar = await hentTegninger(S.fileName); }
  catch (err) { svar = { feil: err.message }; }
  if (!el.classList.contains("open")) return;

  if (svar.feil) {
    kropp.innerHTML = '<p style="color:var(--muted)">' + (svar.feil === "IKKE_INNLOGGET"
      ? "Tegningene ligger i SharePoint, så du må være innlogget. Åpne 📚 Biblioteket og logg inn."
      : esc(svar.feil)) + '</p>';
    return;
  }

  // Ingen mappe fant seg selv – la brukeren peke den ut én gang
  if (svar.mangler) {
    kropp.innerHTML = '<p style="color:var(--muted)">Fant ingen tegningsmappe for «' + esc(S.fileName) +
      '». Mappa skal ligge i <b>' + esc(SP.folder) + '/Tegninger</b> og hete det samme som modellen.</p>' +
      (svar.undermapper.length
        ? '<p style="color:var(--muted);font-size:11px;margin:8px 0 4px">Velg mappa som hører til denne modellen:</p>' +
          svar.undermapper.map(n => '<div class="lib-item" data-mappe="' + esc(n) + '"><div class="n">📁 ' + esc(n) + '</div></div>').join("")
        : '<p style="color:var(--muted);font-size:11px;margin-top:8px">Det ligger ingen mapper der ennå.</p>');
    kropp.querySelectorAll("[data-mappe]").forEach(d => {
      d.onclick = async () => {
        kropp.innerHTML = '<p style="color:var(--muted)">Henter tegninger …</p>';
        await velgMappe(S.fileName, d.dataset.mappe);
        apneTegningVelger(c);
      };
    });
    return;
  }

  if (!svar.filer.length) {
    kropp.innerHTML = '<p style="color:var(--muted)">Mappa <b>' + esc(svar.mappenavn) +
      '</b> er tom. Legg PDF-ene inn i ' + esc(tegningsStiTekst(svar.mappenavn)) + '.</p>';
    return;
  }

  kropp.innerHTML =
    '<p class="tv-mappe">📁 ' + esc(svar.mappenavn) + ' · ' + svar.filer.length + ' tegninger</p>' +
    '<input type="search" id="tvSok" placeholder="🔍 Søk etter tegning …" autocomplete="off">' +
    '<div id="tvListe"></div>' +
    '<div class="tv-bunn"><label>Side <input type="number" id="tvSide" min="1" value="1"></label>' +
    '<button class="primary" id="tvLegg" disabled>Legg ved</button></div>';

  let valgt = null;
  const tegn = (q) => {
    const treff = svar.filer.filter(f => f.name.toLowerCase().includes(q.trim().toLowerCase()));
    $("tvListe").innerHTML = treff.length
      ? treff.map(f => '<div class="lib-item' + (valgt && valgt.id === f.id ? " valgt" : "") + '" data-id="' + esc(f.id) + '">' +
          '<div class="n">📄 ' + esc(f.name) + '</div>' +
          '<div class="m">' + mb(f.size).toFixed(1) + ' MB' +
          (mb(f.size) > ADVAR_MB ? ' · <span style="color:var(--accent2)">stor fil</span>' : "") + '</div></div>').join("")
      : '<p style="color:var(--muted)">Ingen treff.</p>';
    $("tvListe").querySelectorAll(".lib-item").forEach(d => {
      d.onclick = () => {
        valgt = svar.filer.find(f => f.id === d.dataset.id) || null;
        $("tvLegg").disabled = !valgt;
        tegn($("tvSok").value);
      };
    });
  };
  $("tvSok").addEventListener("input", () => tegn($("tvSok").value));
  tegn("");

  $("tvLegg").onclick = () => {
    if (!valgt) return;
    const side = Math.max(1, Math.round(Number($("tvSide").value) || 1));
    c.tegninger = tegningerI(c).concat([{
      fil: valgt.name, itemId: valgt.id, side, storrelse: valgt.size || 0
    }]);
    persist();
    pushSharedComments();
    renderCommentList();
    lukkTegningVelger();
    openMarkerPopup(c);
  };
}

function tegningsStiTekst(mappenavn) {
  return SP.folder + "/Tegninger/" + mappenavn;
}

function lukkTegningVelger() {
  const el = $("tegningVelg");
  if (el) el.classList.remove("open");
}

// Åpner en tegning i fullskjermvisningen, på siden markeringen peker på.
async function visTegning(v) {
  let antall = 0;
  try {
    antall = await antallSider(v, visStatus);
  } catch (err) {
    visStatus("");
    alert(err.message === "IKKE_INNLOGGET"
      ? "Du må være innlogget for å åpne tegninger fra SharePoint."
      : "Klarte ikke å åpne tegningen: " + err.message);
    return;
  }
  visStatus("");
  if (!antall) return;                       // brukeren avbrøt en stor nedlasting
  byggBildeVis();
  bvSettKilde(
    (nr) => sideBilde(v, nr + 1),
    antall,
    (nr) => v.fil + " · side " + (nr + 1) + " av " + antall
  );
  $("bildeVis").classList.add("open");
  bvVis(gyldigSide(v.side, antall) - 1);
}

// ---------- Bildet i full skjerm: zoom, panorering og bla ----------
// Zoom med rullehjul (mot pekeren), + / −, dobbeltklikk eller knipe på mobil.
// Dra for å flytte når du er zoomet inn. Piltaster eller ‹ › blar mellom bildene
// i markeringen.

const BV = {
  navn: [], merker: [], nr: 0, antall: 0,
  hent: () => null, tekst: () => "",
  skala: 1, x: 0, y: 0, drar: false, px: 0, py: 0, pekere: new Map(), start: 0
};

// «Før 2 av 3» – teller innenfor seksjonen bildet hører til, siden det er slik
// man leser en avviksdokumentasjon.
export function bvTellerTekst(merker, nr) {
  const alle = merker || [];
  if (!alle.length) return "";
  const merke = alle[nr];
  const iSeksjon = alle.filter(m => m === merke);
  const nrISeksjon = alle.slice(0, nr + 1).filter(m => m === merke).length;
  return (merke ? merke + " " : "") + nrISeksjon + " av " + iSeksjon.length;
}
export const MIN_SKALA = 1, MAKS_SKALA = 8;

// Zoomen stopper ved 100 % og 800 %. Egen funksjon, så grensene kan testes.
export function bvNySkala(skala, faktor) {
  return Math.max(MIN_SKALA, Math.min(MAKS_SKALA, skala * faktor));
}

// Blar rundt: etter siste bilde kommer det første igjen.
export function bvNyttNr(nr, antall) {
  if (!antall) return 0;
  return ((nr % antall) + antall) % antall;
}

function bvSett() {
  const img = $("bvBilde");
  if (!img) return;
  img.style.transform = "translate(" + BV.x + "px," + BV.y + "px) scale(" + BV.skala + ")";
  img.style.cursor = BV.skala > 1 ? (BV.drar ? "grabbing" : "grab") : "zoom-in";
  const el = $("bildeVis");
  if (el) el.classList.toggle("zoomet", BV.skala > 1);
  const t = $("bvZoom");
  if (t) t.textContent = Math.round(BV.skala * 100) + " %";
}

function bvNullstill() { BV.skala = 1; BV.x = 0; BV.y = 0; bvSett(); }

// Zoomer om et punkt på skjermen, så det du peker på blir stående
function bvZoomOm(faktor, klientX, klientY) {
  const img = $("bvBilde");
  if (!img) return;
  const ny = bvNySkala(BV.skala, faktor);
  if (ny === BV.skala) return;
  const r = img.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const dx = (klientX === undefined ? cx : klientX) - cx;
  const dy = (klientY === undefined ? cy : klientY) - cy;
  const k = ny / BV.skala;
  BV.x = BV.x - dx * (k - 1);
  BV.y = BV.y - dy * (k - 1);
  BV.skala = ny;
  if (BV.skala === 1) { BV.x = 0; BV.y = 0; }
  bvSett();
}

// Viseren vet ikke om den viser et foto eller en tegningsside – den får en
// hent-funksjon, et antall og en tekst. Da virker zoom, dra og bla likt for
// begge.
function bvSettKilde(hent, antall, tekst) {
  BV.hent = hent;
  BV.antall = antall;
  BV.tekst = tekst;
}

async function bvVis(nr) {
  if (!BV.antall) return;
  BV.nr = bvNyttNr(nr, BV.antall);
  bvNullstill();
  const teller = $("bvTeller");
  if (teller) teller.textContent = BV.tekst(BV.nr);
  const img = $("bvBilde");
  if (img) {
    img.src = "";
    const visesNa = BV.nr;
    const url = await BV.hent(BV.nr);
    // brukeren kan ha blad videre mens siden ble tegnet
    if (url && $("bvBilde") && BV.nr === visesNa) $("bvBilde").src = url;
  }
  const flere = BV.antall > 1;
  ["bvFor", "bvNeste"].forEach(id => { const b = $(id); if (b) b.style.display = flere ? "" : "none"; });
}

function byggBildeVis() {
  let el = $("bildeVis");
  if (el) return el;
  el = document.createElement("div");
  el.id = "bildeVis";
  el.innerHTML =
    '<img id="bvBilde" alt="" draggable="false">' +
    '<div class="bv-topp"><span id="bvTeller"></span><span id="bvZoom"></span>' +
      '<button class="bv-knapp" id="bvUt" title="Zoom ut (−)">−</button>' +
      '<button class="bv-knapp" id="bvInn" title="Zoom inn (+)">+</button>' +
      '<button class="bv-knapp" id="bvEn" title="Tilpass til skjermen (0)">⤢</button>' +
      '<button class="bv-knapp bv-x" id="bvX" title="Lukk (Esc)">✕</button></div>' +
    '<button class="bv-pil" id="bvFor" title="Forrige bilde (←)">‹</button>' +
    '<button class="bv-pil" id="bvNeste" title="Neste bilde (→)">›</button>';
  document.body.appendChild(el);

  const stopp = (e) => e.stopPropagation();
  el.querySelector(".bv-topp").addEventListener("pointerdown", stopp);
  $("bvX").onclick = lukkBildeVis;
  $("bvInn").onclick = () => bvZoomOm(1.4);
  $("bvUt").onclick = () => bvZoomOm(1 / 1.4);
  $("bvEn").onclick = bvNullstill;
  $("bvFor").onclick = (e) => { stopp(e); bvVis(BV.nr - 1); };
  $("bvNeste").onclick = (e) => { stopp(e); bvVis(BV.nr + 1); };

  // rullehjul zoomer, og siden viewer'en ligger bak må vi stoppe hjulet der
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    bvZoomOm(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  const img = $("bvBilde");
  img.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (BV.skala > 1) bvNullstill(); else bvZoomOm(2.5, e.clientX, e.clientY);
  });

  // dra for å panorere, og to fingre for å knipe
  el.addEventListener("pointerdown", (e) => {
    BV.pekere.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (BV.pekere.size === 2) {
      const [a, b] = [...BV.pekere.values()];
      BV.start = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      BV.drar = false;
      return;
    }
    if (BV.skala > 1) { BV.drar = true; BV.px = e.clientX; BV.py = e.clientY; bvSett(); }
  });
  el.addEventListener("pointermove", (e) => {
    if (!BV.pekere.has(e.pointerId)) return;
    BV.pekere.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (BV.pekere.size === 2) {
      const [a, b] = [...BV.pekere.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      bvZoomOm(d / BV.start, (a.x + b.x) / 2, (a.y + b.y) / 2);
      BV.start = d;
      return;
    }
    if (!BV.drar) return;
    BV.x += e.clientX - BV.px; BV.y += e.clientY - BV.py;
    BV.px = e.clientX; BV.py = e.clientY;
    bvSett();
  });
  const slutt = (e) => {
    BV.pekere.delete(e.pointerId);
    // klikk på bakgrunnen lukker – men bare når vi ikke har dratt eller zoomet
    const dratt = BV.drar;
    BV.drar = false;
    bvSett();
    if (!dratt && BV.skala === 1 && e.target === el) lukkBildeVis();
  };
  el.addEventListener("pointerup", slutt);
  el.addEventListener("pointercancel", slutt);
  return el;
}

function visStort(c, nr) {
  const el = byggBildeVis();
  BV.navn = [];
  BV.merker = [];
  SEKSJONER.forEach(([seksjon, tittel]) => {
    bilderI(c, seksjon).filter(Boolean).forEach(f => { BV.navn.push(f); BV.merker.push(tittel); });
  });
  bvSettKilde(
    (i) => bildeUrl(BV.navn[i]),
    BV.navn.length,
    (i) => bvTellerTekst(BV.merker, i)   // «Etter 2 av 3», ikke «5 av 6»
  );
  el.classList.add("open");
  bvVis(Math.max(0, nr || 0));
}

function lukkBildeVis() {
  const el = $("bildeVis");
  if (el) el.classList.remove("open");
  BV.pekere.clear();
  BV.drar = false;
}

// Tastatur i bildeviseren: piler blar, +/− zoomer, 0 tilpasser
window.addEventListener("keydown", (e) => {
  const el = $("bildeVis");
  if (!el || !el.classList.contains("open")) return;
  if (e.key === "ArrowLeft") { bvVis(BV.nr - 1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { bvVis(BV.nr + 1); e.preventDefault(); }
  else if (e.key === "+" || e.key === "=") { bvZoomOm(1.4); e.preventDefault(); }
  else if (e.key === "-") { bvZoomOm(1 / 1.4); e.preventDefault(); }
  else if (e.key === "0") { bvNullstill(); e.preventDefault(); }
});

// Felles håndtering av valgte filer: komprimer, last opp, lagre filnavnene.
async function taImotFiler(c, filer, seksjon, etterpa) {
  const felt = bildeFelt(seksjon);
  const gode = [...filer].filter(erBildefil);
  if (!gode.length) { alert("Fant ingen bildefiler blant det du valgte."); return; }
  const plass = MAKS_PER_MARKERING - bilderI(c, seksjon).length;
  if (plass <= 0) { alert("Hver seksjon kan ha maks " + MAKS_PER_MARKERING + " bilder."); return; }
  loadingText.textContent = gode.length > 1 ? "Laster opp " + Math.min(gode.length, plass) + " bilder …" : "Laster opp bildet …";
  loadingEl.classList.add("open");
  try {
    // nummereringen går på TVERS av seksjonene, så to filer aldri får samme navn
    const navn = await leggTilBilder(c.id, gode.slice(0, plass), alleBilder(c).length);
    c[felt] = bilderI(c, seksjon).concat(navn);
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
    tegningStripeHtml(c) +
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
  el.querySelectorAll(".mp-bilder input[type=file]").forEach(inp => {
    inp.onchange = () => {
      const filer = [...inp.files];
      const seksjon = inp.dataset.seksjon;
      inp.value = "";                           // samme bilde skal kunne velges igjen
      taImotFiler(c, filer, seksjon, () => openMarkerPopup(c));
    };
  });
  if ($("mpTegning")) $("mpTegning").onclick = () => apneTegningVelger(c);
  el.querySelectorAll(".mp-tegning[data-tegning]").forEach(t => {
    t.onclick = (e) => {
      const fjern = e.target.getAttribute("data-fjern");
      if (fjern !== null) {
        // bare henvisningen fjernes – PDF-en blir liggende i biblioteket
        c.tegninger = tegningerI(c).filter((_, i) => i !== Number(fjern));
        persist(); pushSharedComments(); renderCommentList(); openMarkerPopup(c);
        return;
      }
      const v = tegningerI(c)[Number(t.dataset.tegning)];
      if (v) visTegning(v);
    };
  });
  fyllMiniatyrer(el, c);
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
  if (c && alleBilder(c).length) slettBilder(alleBilder(c));
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
  const tv = $("tegningVelg");
  if (tv && tv.classList.contains("open")) { lukkTegningVelger(); return; }
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
    // bilder tatt når markeringen opprettes er «før»-tilstanden
    taImotFiler(c, filer, "for", () => { if (popFor && popFor.id === c.id) openMarkerPopup(c); });
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
        (tegningerI(c).length ? ' · <span title="' +
          esc(tegningerI(c).map(tegningTekst).join(", ")) + '">📄 ' + tegningerI(c).length + '</span>' : "") +
        (alleBilder(c).length
          ? ' · <span title="' + SEKSJONER.map(([s, t]) => t + ": " + bilderI(c, s).length).join(", ") +
            '">📷 ' + alleBilder(c).length + (bilderI(c, "etter").length ? " (før/etter)" : "") + '</span>'
          : "") +
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
