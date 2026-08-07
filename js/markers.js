// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc, ikon, loadingEl, loadingText, lukkPaneler } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
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
  lukkPaneler("commentPanel");
  $("commentPanel").classList.toggle("open");
});

function storageKey(){ return "storm-ifc-comments::" + S.fileName; }

export function loadComments() {
  if (LETT) { lastLettMarkeringer(); return; }
  try {
    const raw = localStorage.getItem(storageKey());
    S.comments = raw ? JSON.parse(raw) : [];
  } catch(_) { S.comments = []; }
  S.comments.forEach(addMarkerSprite);
  renderCommentList();
  syncSharedComments(); // hent delte markeringer fra SharePoint i bakgrunnen
}

// LETTMODUS: markeringene kommer som vasket JSON fra Workeren (lagt der av
// Byggeplass-knappen i det interne verktøyet). Samme feltvask som for den
// delte SharePoint-fila — ukjente felter slipper aldri inn.
async function lastLettMarkeringer() {
  S.comments = [];
  try {
    const r = await fetch("/markeringer/" + (S.lettProsjekt || "00000") + "/" +
      encodeURIComponent(S.fileName + ".markeringer.json"));
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d)) S.comments = d.map(vaskMarkering).filter(Boolean);
    }
  } catch (_) {}
  markerGroup.clear();
  S.comments.forEach(addMarkerSprite);
  renderCommentList();
}

function persist() {
  try { localStorage.setItem(storageKey(), JSON.stringify(S.comments)); } catch(_){}
}

// Brukes av byggeplass.js når kvitteringsbilder fra innboksen henges på markeringene
export function lagreOgSynk() { persist(); pushSharedComments(); renderCommentList(); }

// Brukes av byggeplass.js når hendelser fra byggeplassen (ny markering, kommentar)
// tas inn i den delte lista
export function leggTilImportertMarkering(c) {
  S.comments.push(c);
  addMarkerSprite(c);
}

// LETTMODUS: nye markeringer og kommentarer sendes til Workerens innboks.
// Feiler sendingen, sier vi fra — en stille feil her ville sett ut som at
// avviket ble meldt, uten at det noen gang kom fram.
async function sendHendelse(hendelse) {
  try {
    const r = await fetch("/hendelse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(hendelse)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return true;
  } catch (_) {
    alert(t("Fikk ikke sendt dette til prosjektlederen – sjekk nettet og prøv igjen."));
    return false;
  }
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

// Feltvask for markeringer som kommer utenfra (den delte JSON-fila i
// SharePoint): bare kjente felter slipper inn, og alt som skal være tekst
// gjøres om til tekst. Da kan ikke et rart felt i fila – med vilje eller ved
// uhell – nå innerHTML eller window.open med noe annet enn det vi forventer.
const MARKERING_TEKSTFELT = ["text", "author", "status", "owner", "due", "date", "taskId", "taskUrl",
  "endret", "endretAv"];

// ID som ikke kolliderer selv om to på hver sin maskin skriver i samme
// millisekund – samme oppskrift som markeringene selv bruker.
export function nyId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// Navnet på den innloggede, til «skrevet av» og «endret av».
export function innloggetNavn() {
  if (LETT) {
    // Montøren har ingen konto — navnet spørres én gang og huskes i nettleseren
    let navn = "";
    try { navn = localStorage.getItem("storm-bp-navn") || ""; } catch(_) {}
    if (!navn) {
      navn = (prompt(t("Navnet ditt (vises på markeringen):")) || "").trim().slice(0, 40);
      if (navn) try { localStorage.setItem("storm-bp-navn", navn); } catch(_) {}
    }
    return navn || t("Byggeplass");
  }
  try {
    const a = S.msalApp && S.msalApp.getActiveAccount();
    return (a && (a.name || a.username)) || "";
  } catch(_) { return ""; }
}

export function naaTekst() {
  return new Date().toLocaleString("no-NO",
    { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

// Feltvask for ett svar i tråden under en markering. Samme tanke som for
// markeringen selv: bare kjente felter, og alt som skal være tekst blir tekst.
export function vaskSvar(r) {
  if (!r || typeof r !== "object") return null;
  const tekst = String(r.tekst == null ? "" : r.tekst).trim();
  if (!tekst) return null;                        // tomme svar kastes
  return {
    id: r.id == null ? nyId() : String(r.id),
    tekst,
    forfatter: String(r.forfatter == null ? "" : r.forfatter),
    dato: String(r.dato == null ? "" : r.dato),
    endret: String(r.endret == null ? "" : r.endret)
  };
}

export function vaskMarkering(r) {
  if (!r || typeof r !== "object" || r.id == null) return null;
  const c = { id: typeof r.id === "number" ? r.id : String(r.id) };
  for (const k of MARKERING_TEKSTFELT) if (r[k] != null) c[k] = String(r[k]);
  if (Array.isArray(r.svar)) c.svar = r.svar.map(vaskSvar).filter(Boolean);
  for (const k of ["x", "y", "z"]) c[k] = Number(r[k]) || 0;
  // frist skal være en ren dato – alt annet forkastes
  if (c.due && !/^\d{4}-\d{2}-\d{2}$/.test(c.due)) c.due = "";
  // oppgavelenka åpnes med window.open – slipp bare gjennom https
  if (c.taskUrl && !/^https:\/\//i.test(c.taskUrl)) delete c.taskUrl;
  if (Array.isArray(r.bilder)) c.bilder = r.bilder.filter(b => typeof b === "string");
  if (Array.isArray(r.bilderEtter)) c.bilderEtter = r.bilderEtter.filter(b => typeof b === "string");
  if (Array.isArray(r.tegninger)) c.tegninger = r.tegninger
    .filter(t => t && typeof t === "object")
    .map(t => ({ fil: String(t.fil || ""), itemId: String(t.itemId || ""),
                 side: Number(t.side) || 0, storrelse: Number(t.storrelse) || 0 }));
  return c;
}

async function syncSharedComments(stille) {
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
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) remote = d.map(vaskMarkering).filter(Boolean); }
    else if (r.status !== 404) throw new Error("Graph " + r.status);
    if (syncedFile() !== forFile) return; // brukeren byttet modell underveis
    const have = new Set(remote.map(c => c.id));
    const localOnly = S.comments.filter(c => !have.has(c.id));
    // Den delte fila vinner på markeringen, men svar går aldri tapt: skrev to
    // personer hvert sitt svar før noen rakk å synke, beholdes begge.
    const lokaleSvar = new Map(S.comments.map(c => [String(c.id), svarI(c)]));
    remote.forEach(c => {
      const mine = lokaleSvar.get(String(c.id));
      if (!mine || !mine.length) return;
      const kjent = new Set(svarI(c).map(s => String(s.id)));
      const nye = mine.filter(s => !kjent.has(String(s.id)));
      if (nye.length) c.svar = svarI(c).concat(nye);
    });
    S.comments = remote.concat(localOnly);
    markerGroup.clear();
    S.comments.forEach(addMarkerSprite);
    persist();
    S.sharedOK = true;
    renderCommentList();
    // stille = vi er midt i en 412-runde og skal skrive selv straks etterpå.
    // Uten den ville vi startet en ny push inni den som allerede pågår.
    if (localOnly.length && !stille) pushSharedComments(); // last opp det som bare fantes lokalt
  } catch(_) { S.sharedOK = false; renderCommentList(); }
}

// eTag-en ligger på selve elementet i SharePoint, ikke på innholdet, så den må
// hentes for seg. null = fila finnes ikke ennå (første markering på modellen).
async function sharedETag(token, sid) {
  const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + "?$select=id,eTag",
    { headers: authHeaders(token, null, "markeringer") });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Graph " + r.status);
  return (await r.json()).eTag || null;
}

// Skrivingene står i kø, og hver skriving er BETINGET av at fila ikke er endret
// siden vi leste den. Før skrev vi hele fila blindt: to prosjektledere med samme
// modell åpen samme dag, og den som lagret sist slettet den andres markeringer –
// uten feilmelding, og uten at noen oppdaget det før noen lette etter en
// markering som ikke fantes.
//
// Køen er der fordi updateComment, lagreOgSynk og sendTilPlanner fyrer tett.
// To samtidige PUT-er mot samme fil ville uansett gitt 412 på den ene.
let pushKø = Promise.resolve();
let pushTimer = null;

export function pushSharedComments() {
  // Samle raske endringer (statusbytte, frist, svar) til én skriving.
  // Samme mønster som usersync.js bruker for det personlige oppsettet.
  clearTimeout(pushTimer);
  return new Promise((ferdig) => {
    pushTimer = setTimeout(() => {
      pushKø = pushKø.then(() => doPush(0)).catch(() => {}).then(ferdig);
    }, 400);
  });
}

async function doPush(forsøk) {
  if (LETT) return; // lettmodus skriver aldri markeringer — kvitteringer går via innboksen
  const forFile = syncedFile();
  if (!forFile) return;
  try {
    const token = await spTokenSilent();
    if (!token) { S.sharedOK = false; renderCommentList(); return; }
    const sid = await sharedSiteId(token);
    const eTag = await sharedETag(token, sid);
    if (syncedFile() !== forFile) return;

    const h = authHeaders(token, { "Content-Type": "application/json" }, "markeringer");
    // Ingen eTag = fila skal ikke finnes. If-None-Match: * hindrer at vi skriver
    // over en fil noen andre rakk å opprette i mellomtiden.
    if (eTag) h["If-Match"] = eTag; else h["If-None-Match"] = "*";

    const r = await fetch(GRAPH + "/sites/" + sid + sharedFilePath() + ":/content", {
      method: "PUT", headers: h, body: JSON.stringify(S.comments)
    });

    if (r.status === 412 || r.status === 409) {
      // Noen andre skrev først. Hent deres versjon, flett inn vårt, prøv igjen.
      if (forsøk < 3) {
        await syncSharedComments(true);
        return doPush(forsøk + 1);
      }
      // Ga vi oss stille her, ville brukeren trodd at markeringen var delt.
      // Det lokale ligger trygt i localStorage – ingenting er tapt.
      S.sharedOK = false;
      renderCommentList();
      alert(t("Fikk ikke lagret markeringene – noen andre skriver i samme fil akkurat nå. Ingenting er tapt lokalt; prøv igjen om litt."));
      return;
    }
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

// Glyfen TEGNES med linjer i stedet for fillText: fonttegn som ➜ og ✓ finnes
// ikke i alle sans-serif-fallbacker, og en tofu-boks inne i 3D-scenen er
// vanskelig å feilsøke. Strektegning gir samme resultat på alle plattformer.
const MARKER_KANT = "#14181f";   // samme mørke som bakgrunnen (scene.js)

function tegnGlyf(ctx, glyph) {
  ctx.strokeStyle = MARKER_KANT;
  ctx.fillStyle = MARKER_KANT;
  ctx.lineWidth = 13;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (glyph === "!") {                    // Åpen: utropstegn
    ctx.moveTo(64, 34); ctx.lineTo(64, 72);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 93, 8, 0, Math.PI * 2); ctx.fill();
  } else if (glyph === "➜") {             // Pågår: pil mot høyre
    ctx.moveTo(36, 64); ctx.lineTo(86, 64);
    ctx.moveTo(64, 42); ctx.lineTo(88, 64); ctx.lineTo(64, 86);
    ctx.stroke();
  } else {                                // Løst: hake
    ctx.moveTo(38, 66); ctx.lineTo(56, 84); ctx.lineTo(90, 46);
    ctx.stroke();
  }
}

function makeMarkerTexture(col, glyph) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 10; ctx.strokeStyle = MARKER_KANT; ctx.stroke();
  tegnGlyf(ctx, glyph);
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

// ---------- ✏️ Redigering av markeringsteksten ----------
// Teksten kan rettes etter at markeringen er laget. Vi overskriver ikke
// «skrevet av» og opprinnelig dato – de forteller hvem som fant avviket. I
// stedet noteres hvem som endret og når, så historikken ikke forsvinner.

export function redigerMarkeringstekst(c, nyTekst) {
  const tekst = String(nyTekst == null ? "" : nyTekst).trim();
  if (!c || !tekst || tekst === c.text) return false;   // tom tekst sletter ikke
  updateComment(c, { text: tekst, endret: naaTekst(), endretAv: innloggetNavn() });
  return true;
}

// ---------- 💬 Svar på en markering ----------
// Svarene ligger i markeringen selv (c.svar), så de følger med i den samme
// delte JSON-fila og trenger ingen ny lagringsplass i SharePoint.

export const svarI = (c) => (c && Array.isArray(c.svar) ? c.svar : []);

export function leggTilSvar(c, tekst) {
  const rent = String(tekst == null ? "" : tekst).trim();
  if (!c || !rent) return null;
  const s = { id: nyId(), tekst: rent, forfatter: innloggetNavn(), dato: naaTekst(), endret: "" };
  c.svar = svarI(c).concat([s]);
  updateComment(c, {});
  if (LETT) sendHendelse({ type: "svar", markering: c.id, svar: s });
  return s;
}

export function endreSvar(c, svarId, tekst) {
  const rent = String(tekst == null ? "" : tekst).trim();
  const s = svarI(c).find(x => x.id == svarId);
  if (!s || !rent || rent === s.tekst) return false;
  s.tekst = rent;
  s.endret = naaTekst();
  updateComment(c, {});
  return true;
}

export function slettSvar(c, svarId) {
  const f = svarI(c).length;
  c.svar = svarI(c).filter(x => x.id != svarId);
  if (c.svar.length === f) return false;
  updateComment(c, {});
  return true;
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
    return '<div class="mp-seksjon"><div class="mp-seksjon-tittel">' + t(tittel) +
      (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
      '<div class="mp-bilder">' +
      liste.map(f => '<span class="mp-bilde" data-bilde="' + esc(f) + '" data-seksjon="' + seksjon + '" title="' + t("Åpne bildet") + '"></span>').join("") +
      (kanLeggeTil && liste.length < MAKS_PER_MARKERING
        ? '<label class="mp-bilde nytt" title="' + t("Ta bilde eller velg fil ({0})", t(tittel).toLowerCase()) + '">' + ikon("kamera") +
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
    if (!url) { el.classList.add("mangler"); el.innerHTML = ikon("laas"); el.title = t("Logg inn for å se bildet"); return; }
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
  return v.fil + (v.side > 1 ? t(" · s. ") + v.side : "");
}

function tegningStripeHtml(c) {
  const liste = tegningerI(c);
  return '<div class="mp-seksjon"><div class="mp-seksjon-tittel">' + t("Arbeidstegninger") +
    (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
    '<div class="mp-tegninger">' +
    liste.map((v, i) =>
      '<span class="mp-tegning" data-tegning="' + i + '" title="' + t("Åpne {0}", esc(v.fil)) + '">' +
      ikon("tegning") + ' ' + esc(tegningTekst(v)) +
      (mb(v.storrelse) > ADVAR_MB ? ' <span class="stor">' + mb(v.storrelse).toFixed(0) + ' MB</span>' : "") +
      '<button class="mp-tegning-x" data-fjern="' + i + '" title="' + t("Fjern henvisningen (tegningen slettes ikke)") + '">' + ikon("lukk") + '</button>' +
      '</span>').join("") +
    '<button class="mp-tegning nytt" id="mpTegning">' + ikon("tegning") + ' ' + t("Legg til arbeidstegning") + '</button>' +
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
  el.innerHTML = '<div class="tv-boks"><div class="tv-topp">' + t("Arbeidstegninger") +
    '<button class="tv-x" title="' + t("Lukk") + '">' + ikon("lukk") + '</button></div>' +
    '<div class="tv-kropp"><p style="color:var(--muted)">' + t("Henter tegninger fra SharePoint …") + '</p></div></div>';
  el.querySelector(".tv-x").onclick = lukkTegningVelger;
  el.classList.add("open");
  const kropp = el.querySelector(".tv-kropp");

  let svar;
  try { svar = await hentTegninger(S.fileName); }
  catch (err) { svar = { feil: err.message }; }
  if (!el.classList.contains("open")) return;

  if (svar.feil) {
    kropp.innerHTML = '<p style="color:var(--muted)">' + (svar.feil === "IKKE_INNLOGGET"
      ? t("Tegningene ligger i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn.")
      : esc(svar.feil)) + '</p>';
    return;
  }

  // Ingen mappe fant seg selv – la brukeren peke den ut én gang
  if (svar.mangler) {
    kropp.innerHTML = '<p style="color:var(--muted)">' + t("Fant ingen tegningsmappe for «{0}». Mappa skal ligge i <b>{1}</b>.", esc(S.fileName), esc(SP.folder) + "/Tegninger") + '</p>' +
      (svar.undermapper.length
        ? '<p style="color:var(--muted);font-size:11px;margin:8px 0 4px">' + t("Velg mappa som hører til denne modellen:") + '</p>' +
          svar.undermapper.map(n => '<div class="lib-item" data-mappe="' + esc(n) + '"><div class="n">' + ikon("apne") + ' ' + esc(n) + '</div></div>').join("")
        : '<p style="color:var(--muted);font-size:11px;margin-top:8px">' + t("Det ligger ingen mapper der ennå.") + '</p>');
    kropp.querySelectorAll("[data-mappe]").forEach(d => {
      d.onclick = async () => {
        kropp.innerHTML = '<p style="color:var(--muted)">' + t("Henter tegninger …") + '</p>';
        await velgMappe(S.fileName, d.dataset.mappe);
        apneTegningVelger(c);
      };
    });
    return;
  }

  if (!svar.filer.length) {
    kropp.innerHTML = '<p style="color:var(--muted)">' + t("Mappa <b>{0}</b> er tom. Legg PDF-ene inn i {1}.", esc(svar.mappenavn), esc(tegningsStiTekst(svar.mappenavn))) + '</p>';
    return;
  }

  kropp.innerHTML =
    '<p class="tv-mappe">' + esc(svar.mappenavn) + ' · ' + t("{0} tegninger", svar.filer.length) + '</p>' +
    '<input type="search" id="tvSok" placeholder="' + t("Søk etter tegning …") + '" autocomplete="off">' +
    '<div id="tvListe"></div>' +
    '<div class="tv-bunn"><label>' + t("Side") + ' <input type="number" id="tvSide" min="1" value="1"></label>' +
    '<button class="primary" id="tvLegg" disabled>' + t("Legg ved") + '</button></div>';

  let valgt = null;
  const tegn = (q) => {
    const treff = svar.filer.filter(f => f.name.toLowerCase().includes(q.trim().toLowerCase()));
    $("tvListe").innerHTML = treff.length
      ? treff.map(f => '<div class="lib-item' + (valgt && valgt.id === f.id ? " valgt" : "") + '" data-id="' + esc(f.id) + '">' +
          '<div class="n">' + ikon("tegning") + ' ' + esc(f.name) + '</div>' +
          '<div class="m">' + mb(f.size).toFixed(1) + ' MB' +
          (mb(f.size) > ADVAR_MB ? ' · <span style="color:var(--accent2)">' + t("stor fil") + '</span>' : "") + '</div></div>').join("")
      : '<p style="color:var(--muted)">' + t("Ingen treff.") + '</p>';
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
      ? t("Du må være innlogget for å åpne tegninger fra SharePoint.")
      : t("Klarte ikke å åpne tegningen: ") + err.message);
    return;
  }
  visStatus("");
  if (!antall) return;                       // brukeren avbrøt en stor nedlasting
  byggBildeVis();
  bvSettKilde(
    (nr) => sideBilde(v, nr + 1),
    antall,
    (nr) => v.fil + t(" · side ") + t("{0} av {1}", nr + 1, antall)
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
  return (merke ? t(merke) + " " : "") + t("{0} av {1}", nrISeksjon, iSeksjon.length);
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
      '<button class="bv-knapp" id="bvUt" title="' + t("Zoom ut (−)") + '">−</button>' +
      '<button class="bv-knapp" id="bvInn" title="' + t("Zoom inn (+)") + '">+</button>' +
      '<button class="bv-knapp" id="bvEn" title="' + t("Tilpass til skjermen (0)") + '">' + ikon("fullskjerm") + '</button>' +
      '<button class="bv-knapp bv-x" id="bvX" title="' + t("Lukk (Esc)") + '">' + ikon("lukk") + '</button></div>' +
    '<button class="bv-pil" id="bvFor" title="' + t("Forrige bilde (←)") + '">' + ikon("forrige") + '</button>' +
    '<button class="bv-pil" id="bvNeste" title="' + t("Neste bilde (→)") + '">' + ikon("neste") + '</button>';
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
  if (!gode.length) { alert(t("Fant ingen bildefiler blant det du valgte.")); return; }
  const plass = MAKS_PER_MARKERING - bilderI(c, seksjon).length;
  if (plass <= 0) { alert(t("Hver seksjon kan ha maks {0} bilder.", MAKS_PER_MARKERING)); return; }
  loadingText.textContent = gode.length > 1 ? t("Laster opp {0} bilder …", Math.min(gode.length, plass)) : t("Laster opp bildet …");
  loadingEl.classList.add("open");
  try {
    if (LETT) S._lettSeksjon = seksjon;   // leses av lastOpp i bilder.js
    // nummereringen går på TVERS av seksjonene, så to filer aldri får samme navn
    const navn = await leggTilBilder(c.id, gode.slice(0, plass), alleBilder(c).length);
    c[felt] = bilderI(c, seksjon).concat(navn);
    persist();
    pushSharedComments();
    renderCommentList();
    if (etterpa) etterpa();
    if (LETT) alert(t("Bildet er sendt. Det blir synlig for prosjektlederen neste gang han åpner modellen."));
  } catch (err) {
    alert(err.message === "IKKE_INNLOGGET"
      ? t("Bilder lagres i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn, så prøv igjen.")
      : t("Klarte ikke å legge ved bildet: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
}

// ---------- 💬 Svartråden i bobla ----------

// Hvilken tekst redigeres akkurat nå? null = ingen, "" = selve markeringen,
// ellers ID-en til svaret. Ligger utenfor openMarkerPopup fordi bobla tegnes
// på nytt hver gang noe endres, og redigeringen skal overleve det.
let redigerer = null;

// «Emil · 04.08.2026, 09:12 (endret 04.08.2026, 10:30)»
export function svarMetaTekst(s) {
  const hode = (s.forfatter ? s.forfatter + " · " : "") + (s.dato || "");
  return s.endret ? hode + " " + t("(endret {0})", s.endret) : hode;
}

export function markeringMetaTekst(c) {
  const hode = (c.author ? c.author + " · " : "") + (c.date || "");
  if (!c.endret) return hode;
  return hode + " " + (c.endretAv
    ? t("(endret av {0} {1})", c.endretAv, c.endret)
    : t("(endret {0})", c.endret));
}

// Et tekstfelt med Lagre/Avbryt – brukes både til markeringen og til svar.
function redigerFeltHtml(verdi, klasse) {
  return '<div class="mp-rediger ' + klasse + '">' +
    '<textarea class="mp-rediger-tekst" rows="3">' + esc(verdi) + '</textarea>' +
    '<div class="mp-rediger-knapper">' +
      '<button class="mp-lagre">' + ikon("lagre") + ' ' + t("Lagre") + '</button>' +
      '<button class="mp-avbryt">' + t("Avbryt") + '</button>' +
    '</div></div>';
}

function svarSeksjonHtml(c) {
  const liste = svarI(c);
  let html = '<div class="mp-seksjon mp-svar-seksjon"><div class="mp-seksjon-tittel">' +
    t("Kommentarer") + (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>';

  html += liste.map(s => '<div class="mp-svar" data-svar="' + esc(s.id) + '">' +
      '<div class="mp-svar-meta"><span>' + esc(svarMetaTekst(s)) + '</span>' +
        '<span class="mp-svar-verktoy">' +
          '<button class="mp-svar-rediger" title="' + t("Endre kommentaren") + '">' + ikon("rediger") + '</button>' +
          '<button class="mp-svar-slett" title="' + t("Slett kommentaren") + '">' + ikon("slett") + '</button>' +
        '</span></div>' +
      (redigerer === s.id
        ? redigerFeltHtml(s.tekst, "for-svar")
        : '<div class="mp-svar-tekst">' + esc(s.tekst) + '</div>') +
    '</div>').join("");

  html += redigerer === "nytt"
    ? redigerFeltHtml("", "for-nytt")
    : '<button class="mp-tegning nytt mp-svar-nytt">' + ikon("svar") + ' ' + t("Skriv en kommentar") + '</button>';
  return html + '</div>';
}

// Kobler opp Lagre/Avbryt i ett redigeringsfelt. `lagre(tekst)` gjør jobben.
function koblRedigering(rot, lagre) {
  const boks = rot.querySelector(".mp-rediger");
  if (!boks) return;
  const felt = boks.querySelector(".mp-rediger-tekst");
  const ferdig = () => { redigerer = null; };
  boks.querySelector(".mp-avbryt").onclick = () => { ferdig(); openMarkerPopup(popFor); };
  boks.querySelector(".mp-lagre").onclick = () => {
    const tekst = felt.value;
    ferdig();
    // lagre() kaller updateComment, som tegner bobla på nytt. Endret den
    // ingenting (tom tekst, eller helt lik den gamle), tegner vi selv.
    if (!lagre(tekst)) openMarkerPopup(popFor);
  };
  // Ctrl/Cmd+Enter lagrer, Esc avbryter – Esc stoppes så den ikke lukker bobla
  felt.onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); boks.querySelector(".mp-lagre").click(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); boks.querySelector(".mp-avbryt").click(); }
  };
  felt.focus();
  felt.setSelectionRange(felt.value.length, felt.value.length);
}

function koblSvarSeksjon(el, c) {
  const seksjon = el.querySelector(".mp-svar-seksjon");
  if (!seksjon) return;

  const nyttKnapp = seksjon.querySelector(".mp-svar-nytt");
  if (nyttKnapp) nyttKnapp.onclick = () => { redigerer = "nytt"; openMarkerPopup(c); };

  if (redigerer === "nytt") koblRedigering(seksjon, (tekst) => !!leggTilSvar(c, tekst));

  seksjon.querySelectorAll(".mp-svar").forEach(rad => {
    const id = rad.dataset.svar;
    rad.querySelector(".mp-svar-rediger").onclick = () => { redigerer = id; openMarkerPopup(c); };
    rad.querySelector(".mp-svar-slett").onclick = () => {
      if (!confirm(t("Slette denne kommentaren?"))) return;
      slettSvar(c, id);
    };
    if (redigerer === id) koblRedigering(rad, (tekst) => endreSvar(c, id, tekst));
  });
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
  redigerer = null;
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
  // Bytter du markering, skal en påbegynt redigering ikke følge med over
  if (popFor && popFor.id !== c.id) redigerer = null;
  popFor = c;
  const st = statusOf(c);
  el.innerHTML =
    '<div class="mp-meta"><span>' + esc(markeringMetaTekst(c)) + '</span>' +
      '<button class="mp-endre" title="' + t("Endre teksten") + '">' + ikon("rediger") + '</button>' +
      '<button class="mp-x" title="' + t("Lukk") + '">' + ikon("lukk") + '</button></div>' +
    // Alt mellom toppen og knappene ligger i en egen kropp som kan rulles.
    // Uten den vokser bobla ut av skjermen så snart teksten blir lang – og da
    // er både feltene og Slett-knappen utenfor rekkevidde.
    '<div class="mp-kropp">' +
    (redigerer === ""
      ? redigerFeltHtml(c.text, "for-markering")
      : '<div class="mp-text">' + esc(c.text) + '</div>') +
    bildeStripeHtml(c, true) +
    tegningStripeHtml(c) +
    svarSeksjonHtml(c) +
    '<div class="mp-fields">' +
      '<label>' + t("Status") + '<select class="mp-st">' + Object.keys(STATUS).map(k =>
        '<option value="' + k + '"' + (k === st ? " selected" : "") + '>' + t(k) + '</option>').join("") + '</select></label>' +
      '<label>' + t("Ansvarlig") + '<select class="mp-ow"><option value="">' + t("– ingen –") + '</option>' +
        ANSATTE.map(a => '<option value="' + esc(a.navn) + '"' + (c.owner === a.navn ? " selected" : "") + '>' +
          esc(a.navn) + '</option>').join("") +
        (c.owner && !ANSATTE.some(a => a.navn === c.owner)
          ? '<option value="' + esc(c.owner) + '" selected>' + esc(c.owner) + '</option>' : "") +
      '</select></label>' +
      '<label>' + t("Frist") + '<input type="date" class="mp-due" value="' + esc(c.due || "") + '"></label>' +
    '</div>' +
    (isOverdue(c) ? '<div class="mp-late">' + ikon("advarsel") + ' ' + t("Fristen er gått") + '</div>' : "") +
    '</div>' +
    '<div class="mp-act"><button class="mp-go">' + ikon("fokus") + ' ' + t("Gå til") + '</button>' +
      (c.taskId
        ? '<button class="mp-open" title="' + t("Åpne oppgaven i Planner") + '">' + ikon("planner") + ' ' + t("Se oppgave") + '</button>'
        : '<button class="mp-task" id="mp-task" title="' + t("Lag Teams Planner-oppgave") + '">' + ikon("planner") + ' Planner</button>') +
      '<button class="mp-del">' + ikon("slett") + ' ' + t("Slett") + '</button></div>';
  el.querySelector(".mp-x").onclick = closeMarkerPopup;
  el.querySelector(".mp-endre").onclick = () => { redigerer = ""; openMarkerPopup(c); };
  if (redigerer === "") {
    koblRedigering(el, (tekst) => redigerMarkeringstekst(c, tekst));
  }
  koblSvarSeksjon(el, c);
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
  info.textContent = n ? (n === 1 ? t("1 bilde valgt") : t("{0} bilder valgt", n)) : "";
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
  const c = {
    // klokkeslett + tilfeldig hale: to som lager markering i samme millisekund
    // (delt fil, hele Storm) skal ikke få samme ID
    id: nyId(),
    text,
    author: innloggetNavn(),
    status: "Åpen",
    owner: (ANSATTE[0] && ANSATTE[0].navn) || "",
    due: "",
    svar: [],
    x: S.pendingPoint.x, y: S.pendingPoint.y, z: S.pendingPoint.z,
    date: naaTekst()
  };
  S.comments.push(c);
  addMarkerSprite(c);
  persist();
  pushSharedComments();
  renderCommentList();
  if (LETT) {
    sendHendelse({ type: "ny-markering", markering: {
      id: c.id, text: c.text, author: c.author, date: c.date,
      status: "Åpen", x: c.x, y: c.y, z: c.z
    } }).then(ok => { if (ok) alert(t("Markeringen er sendt til prosjektlederen.")); });
  }
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
    alert((uten.length === 1 ? t("Markeringen mangler frist.") : t("{0} markeringer mangler frist.", uten.length)) +
      t(" Sett frist først – Planner-oppgaven trenger en dato."));
    return;
  }
  const alt = list.filter(c => c.taskId);
  if (alt.length && !confirm(alt.length === 1
      ? t("Denne markeringen har allerede en Planner-oppgave. Lage en ny?")
      : t("{0} av markeringene har allerede oppgaver. Lage nye for alle?", alt.length))) return;

  const btnIds = ["mp-task", "cmAllTasks"];
  btnIds.forEach(id => { const b = $(id); if (b) b.disabled = true; });   // hindrer doble oppgaver
  loadingText.textContent = t("Lager Planner-oppgave …");
  loadingEl.classList.add("open");
  try {
    const token = await plannerToken();
    if (!token) return;   // på vei til samtykke, eller brukeren avbrøt
    let laget = 0;
    for (const c of list) {
      loadingText.textContent = t("Lager Planner-oppgave {0} av {1} …", laget + 1, list.length);
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
    if (confirm(t("{0} opprettet i Planner.\n\nÅpne Planner-tavla nå?",
        laget + " " + (laget === 1 ? t("oppgave") : t("oppgaver"))))) window.open(planUrl(), "_blank");
  } catch (err) {
    loadingEl.classList.remove("open");
    const m = /403|Forbidden/.test(err.message)
      ? t("Planner nektet. Vanligste årsak: den ansvarlige er ikke medlem av gruppen som eier planen.")
      : err.message;
    alert(t("Klarte ikke å lage Planner-oppgave: ") + m);
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
    ? '<p style="color:var(--ok); font-size:11px; margin:0 0 8px">' + ikon("hake") + ' ' + t("Delt via SharePoint – alle med tilgang ser disse") + '</p>'
    : '<p style="color:var(--muted); font-size:11px; margin:0 0 8px">' + ikon("laas") + ' ' + t("Kun lagret på denne enheten – logg inn i Biblioteket for å dele") + '</p>';
  if (!S.comments.length) {
    body.innerHTML = status + '<p style="color:var(--muted)">' + t("Ingen markeringer ennå. Trykk på Markering og deretter på modellen.") + '</p>';
    return;
  }

  // teller per status + filterknapper
  const antall = { alle: S.comments.length };
  Object.keys(STATUS).forEach(k => antall[k] = S.comments.filter(c => statusOf(c) === k).length);
  const knapp = (key, tekst) => '<button data-flt="' + key + '"' +
    (listFilter === key ? ' class="active"' : "") + '>' + tekst + ' ' + (antall[key] || 0) + '</button>';
  let html = status +
    '<div class="prop-actions">' + knapp("alle", t("Alle")) +
      Object.keys(STATUS).map(k => knapp(k, t(k))).join("") + '</div>';

  const vis = S.comments.filter(c => listFilter === "alle" || statusOf(c) === listFilter);
  // uløste med frist, som ikke alt har fått en oppgave
  const apne = S.comments.filter(c => statusOf(c) !== "Løst" && c.due && !c.taskId);
  if (apne.length > 1) {
    html += '<div class="prop-actions"><button id="cmAllTasks">' + ikon("planner") + ' ' + t("Lag {0} Planner-oppgaver", apne.length) + '</button></div>';
  }

  html += vis.map(c => {
    const st = statusOf(c);
    return '<div class="comment" data-id="' + esc(c.id) + '" style="border-left:3px solid ' + STATUS[st].col + '">' +
      '<div class="meta"><span>' + esc((c.author ? c.author + " · " : "") + (c.date || "")) + '</span>' +
        '<span class="del" data-del="' + esc(c.id) + '">' + t("Slett") + '</span></div>' +
      '<div>' + esc(c.text) + '</div>' +
      '<div class="meta" style="margin-top:4px"><span>' +
        '<span style="color:' + STATUS[st].col + '">●</span> ' + t(st) +
        (c.owner ? ' · ' + esc(c.owner) : "") +
        (c.due ? ' ' + t("· frist ") + esc(c.due.split("-").reverse().join(".")) : "") +
        (isOverdue(c) ? ' <span style="color:var(--danger)">' + ikon("advarsel") + ' ' + t("gått") + '</span>' : "") +
        (c.taskId ? ' · <span title="Har en Planner-oppgave">' + ikon("planner") + '</span>' : "") +
        (svarI(c).length ? ' · <span title="' + t("{0} kommentarer", svarI(c).length) + '">' +
          ikon("svar") + ' ' + svarI(c).length + '</span>' : "") +
        (tegningerI(c).length ? ' · <span title="' +
          esc(tegningerI(c).map(tegningTekst).join(", ")) + '">' + ikon("tegning") + ' ' + tegningerI(c).length + '</span>' : "") +
        (alleBilder(c).length
          ? ' · <span title="' + SEKSJONER.map(([s, t]) => t + ": " + bilderI(c, s).length).join(", ") +
            '">' + ikon("kamera") + ' ' + alleBilder(c).length + (bilderI(c, "etter").length ? " " + t("(før/etter)") : "") + '</span>'
          : "") +
      '</span></div></div>';
  }).join("") ||
    '<p style="color:var(--muted)">' + t("Ingen markeringer med status «{0}».", esc(t(listFilter))) + '</p>';

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
