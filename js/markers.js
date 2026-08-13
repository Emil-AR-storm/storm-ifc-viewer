// 💬 Markeringer: lagring lokalt og deling via SharePoint.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, på, S, esc, ikon, loadingEl, loadingText, lukkPaneler } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { ANSATTE, FRISTER, PLANNER, TJENESTER } from "./config.js";
import { HASTEGRAD, fristTekst, hastegrad, iDagISO, omDager, vaskGrenser } from "./frist.js";
import { tegnMarkering } from "./markerbilde.js";
// Minikartet varsles med et flagg på S, IKKE med en import av minimap.js.
// Grunnen er modulrekkefølgen: minimap.js gjør DOM-oppslag ($("miniMap")) og
// kaller applyMiniSize() på toppnivå. Importeres den herfra, kjører den koden
// tidligere enn i dag, og en slik rekkefølgeendring er nøyaktig den typen feil
// som viser seg som «svart minikart bare på mobil».
import { finnNevnte, koblNevning, nevnKandidater, nevningHtml } from "./nevning.js";
import { fmtTid, lydStottes, startOpptak } from "./lyd.js";
import { fristTilISO, fullforOppgave, opprettOppgave, planUrl, plannerToken } from "./planner.js";
import { setMode } from "./modes.js";
import { camera, controls, frameHooks, markerGroup, renderer } from "./scene.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import { MAKS_LYD_PER_MARKERING, MAKS_PER_MARKERING, bildeUrl, erBildefil, lastOpp, leggTilBilder, lydNavn, lydUrl, slettBilder, trygtLyd } from "./bilder.js";
import { ADVAR_MB, antallSider, gyldigSide, hentTegninger, mb, sideBilde, velgMappe, visStatus } from "./tegninger.js";
// ⛓-lenka til en markering hentes via S.markerLink (settes av share.js).
// Direkte import ville gitt sirkel: markers → share → display → ifc → markers.

// ---------- Markeringer / kommentarer ----------

på("btnComments", "click", () => {
  lukkPaneler("commentPanel");
  $("commentPanel").classList.toggle("open");
});

function storageKey(){ return "storm-ifc-comments::" + S.fileName; }

// @-nevning i «Ny markering»-dialogen. Kobles én gang; kandidatlista hentes
// på nytt hver gang man skriver @, så den virker også etter at ansattlista
// har kommet fra SharePoint.
{
  const nyFelt = document.getElementById("commentText");
  if (nyFelt) koblNevning(nyFelt, () => nevnListe(null));
}

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
      // BAKOVERKOMPATIBEL: fila var en naken array fram til format 2, og en
      // gammel fil kan ligge i R2 lenge etter at klienten er oppdatert — helt
      // til noen trykker Byggeplass igjen. Tåler koden bare det nye formatet,
      // står byggeplassen tom i mellomtiden, uten feilmelding.
      const rå = Array.isArray(d) ? d : (d && Array.isArray(d.markeringer) ? d.markeringer : []);
      S.comments = rå.map(vaskMarkering).filter(Boolean);
      // Fristgrensene kommer fra samme fil. Byggeplassen har ingen SharePoint
      // og dermed ingen oppsett.json — dette er den eneste veien de kan komme.
      // Mangler de, står FRISTER på standardverdiene 8/3.
      if (d && d.grenser) {
        const g = vaskGrenser(d.grenser);
        FRISTER.gul = g.gul; FRISTER.rod = g.rod;
      }
    }
  } catch (_) {}
  markerGroup.clear();
  S.comments.forEach(addMarkerSprite);
  merkUsendte();          // J5: det som ligger i køen finnes ikke hos Workeren ennå
  renderCommentList();
  toemKo();               // og prøv å få det av gårde med en gang
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
//
// J5 – KØ FOR DET SOM IKKE KOM FRAM.
// Før fikk montøren bare en alert når sendingen feilet, mens markeringen ble
// liggende i S.comments og tegnet i modellen. Siden loadComments aldri leser
// localStorage i lettmodus, forsvant den sporløst ved neste sideinnlasting –
// og montøren hadde ingen måte å vite det på. På en byggeplass med dårlig
// dekning er det ikke et kanttilfelle.
//
// Nå legges hendelsen i en kø i localStorage, markeringen tegnes blass og
// merkes «ikke sendt», og køen tømmes automatisk når nettet er tilbake.
const KO_NOKKEL = "storm-bp-usendt";

function koLes() {
  try { const a = JSON.parse(localStorage.getItem(KO_NOKKEL)); return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}

function koSkriv(a) {
  try { localStorage.setItem(KO_NOKKEL, JSON.stringify(a)); } catch (_) {}
}

async function sendHendelse(hendelse, fraKo) {
  try {
    const r = await fetch("/hendelse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(hendelse)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return true;
  } catch (_) {
    if (!fraKo) {
      koSkriv(koLes().concat([hendelse]));
      alert(t("Fikk ikke sendt dette til prosjektlederen nå. Det er lagret på telefonen og sendes automatisk når du har nett igjen."));
    }
    return false;
  }
}

// Prøver hele køen på nytt. Kalles ved oppstart, når nettleseren melder at
// nettet er tilbake, og hvert minutt. Serielt med vilje – en byggeplass har
// sjelden båndbredde til overs.
let koJobber = false;

async function toemKo() {
  if (!LETT || koJobber || !navigator.onLine) return;
  const a = koLes();
  if (!a.length) return;
  koJobber = true;
  const igjen = [];
  for (const h of a) if (!(await sendHendelse(h, true))) igjen.push(h);
  koSkriv(igjen);
  koJobber = false;
  if (igjen.length < a.length) { merkUsendte(); renderCommentList(); }
}

// Henger «ikke sendt»-merket på det som fortsatt ligger i køen, og legger
// usendte markeringer tilbake i lista – de finnes jo ikke hos Workeren ennå.
function merkUsendte() {
  if (!LETT) return;
  const ko = koLes();
  S.comments.forEach(c => { delete c.usendt; svarI(c).forEach(s => { delete s.usendt; }); });

  for (const h of ko) {
    if (h.type !== "ny-markering" || !h.markering) continue;
    let c = S.comments.find(x => String(x.id) === String(h.markering.id));
    if (!c) {
      c = vaskMarkering(h.markering);
      if (!c) continue;
      S.comments.push(c);
      addMarkerSprite(c);
    }
    c.usendt = true;
  }
  for (const h of ko) {
    if (h.type !== "svar" || !h.svar) continue;
    const c = S.comments.find(x => String(x.id) === String(h.markering));
    if (!c) continue;
    let sv = svarI(c).find(x => String(x.id) === String(h.svar.id));
    if (!sv) { sv = Object.assign({}, h.svar); c.svar = svarI(c).concat([sv]); }
    sv.usendt = true;
  }
  // tegn markeringene på nytt så de blasse blir blasse
  markerGroup.clear();
  S.comments.forEach(addMarkerSprite);
}

if (LETT) {
  addEventListener("online", toemKo);
  setInterval(toemKo, 60000);
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
    endret: String(r.endret == null ? "" : r.endret),
    // Hvor innlegget kom fra. Brukes av PDF-rapporten til å merke innlegg fra
    // byggeplassen, der navnet er selvrapportert og ikke kontrollert mot noen
    // konto. Ukjent verdi kastes: heller ingen merkelapp enn en gjetning.
    kilde: r.kilde === "bygg" || r.kilde === "kontor" ? r.kilde : ""
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
  // Talemeldinger (N5). Navnet vaskes hardt: bare filnavnet, aldri en sti.
  if (Array.isArray(r.lyd)) c.lyd = r.lyd
    .map(l => (typeof l === "string" ? { fil: l } : l))
    .filter(l => l && trygtLyd(l.fil))
    .map(l => ({ fil: trygtLyd(l.fil), av: String(l.av || "").slice(0, 60), dato: String(l.dato || "") }));
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

// ---------- Hastegrad ut fra frist ----------
// Selve regelen ligger i js/frist.js, ikke her — den brukes også av minikartet
// og (etter Del B) av Cloudflare-Workeren, og skal finnes ett sted.
//
// Dagens dato holdes i en variabel i stedet for å leses ved hvert kall.
// Ikke av hensyn til ytelse, men fordi den DA kan sjekkes for endring ett sted
// (se «midnattskroken» nederst): en modell som står åpen over natta skal ikke
// vise gårsdagens hastegrad.
let iDag = iDagISO();

export const hastegradFor = (c) => hastegrad(c, FRISTER, iDag);

// Minikartet trenger fargen, men skal ikke importere markers.js (den er 70 kB
// og trekker inn halve verktøyet). Én funksjon på S er nok, og den settes her
// slik at minimap.js virker uendret om markeringene aldri lastes.
S.hastegradFarge = (c) => HASTEGRAD[hastegrad(c, FRISTER, iDag)].ring;
export const fristTekstFor = (c) => fristTekst(c, FRISTER, iDag);
export const dagensDato = () => iDag;

// Frist som er gått, på noe som ikke er løst.
// Bygget på hastegrad() i stedet for sin egen datosammenligning, så det finnes
// ETT regnestykke. Signaturen er uendret — den kalles to steder fra før.
export function isOverdue(c) {
  return hastegradFor(c) === "forfalt";
}

// ---------- Bobla i 3D ----------
// Selve tegningen ligger i js/markerbilde.js — ren, uten three.js og uten
// tilstand, slik at _test/lag-markeringsbilde.mjs kan kjøre den med et ekte
// canvas og vise at glyfen ikke stikker ut og at ringen ikke klippes.
function makeMarkerTexture(col, glyph, ringFarge) {
  return new THREE.CanvasTexture(tegnMarkering(col, glyph, ringFarge));
}

const markerTextures = {};
function textureFor(status, hast) {
  const st = STATUS[status] || STATUS["Åpen"];
  const h = HASTEGRAD[hast] ? hast : "ukjent";
  const nokkel = status + "|" + h;
  if (!markerTextures[nokkel])
    markerTextures[nokkel] = makeMarkerTexture(st.col, st.glyph, HASTEGRAD[h].ring);
  return markerTextures[nokkel];
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textureFor(statusOf(comment), hastegradFor(comment)), depthTest: false }));
  // J5: en markering som ikke kom fram tegnes blass, så den ikke ser ut som meldt
  if (comment.usendt) { sprite.material.transparent = true; sprite.material.opacity = 0.4; }
  sprite.position.set(comment.x, comment.y, comment.z);
  sprite.renderOrder = 999;
  sprite.userData.commentId = comment.id;
  markerGroup.add(sprite);
  skalerMarkeringer();   // riktig størrelse med en gang, ikke først ved neste bilde
}

// Felt som endrer hvordan markeringen SER UT i 3D.
//
// FALLGRUVE: her sto det tidligere bare en sjekk på `status`, fordi status var
// det eneste som påvirket teksturen. Med fristringen gjelder det også `due` —
// og glemmes den, oppdateres dataene, lista og SharePoint mens bobla i modellen
// står uendret til siden lastes på nytt. Ingenting krasjer. Det er bare feil.
//
// Legges det til noe nytt som påvirker teksturen, MÅ det inn i denne lista.
const TEGNEFELT = ["status", "due"];

// Endrer et felt på en markering og oppdaterer alt som viser den
function updateComment(c, patch) {
  Object.assign(c, patch);

  if (TEGNEFELT.some(f => patch[f] !== undefined)) {
    markerGroup.children.filter(s => s.userData.commentId == c.id).forEach(s => {
      markerGroup.remove(s);
      // Materialet lages nytt for hver sprite i addMarkerSprite og ble tidligere
      // liggende igjen på GPU-en ved hvert statusbytte. IKKE dispose() på
      // s.material.map — teksturen er delt fra markerTextures, og frigjøres den,
      // blir alle markeringer med samme status/hastegrad svarte.
      if (s.material) s.material.dispose();
    });
    addMarkerSprite(c);
    S.miniSkitten = true;   // prikken i minikartet skal skifte farge med
  }

  // Løst markering → kryss av oppgaven i Planner også. Stille: har vi ikke
  // tilgang der og da, lar vi det ligge i stedet for å avbryte brukeren.
  //
  // Flyttet ut av blokka over da TEGNEFELT kom til. Treffer nøyaktig samme
  // tilfelle som før: patch.status === "Løst" innebar allerede at status var satt.
  if (patch.status === "Løst" && c.taskId) {
    plannerToken(true)
      .then(t => t && fullforOppgave(t, c.taskId))
      .catch(err => console.warn("Kunne ikke fullføre Planner-oppgaven:", err.message));
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
  varsleNevning(c, tekst, finnNevnte(tekst, nevnListe(c)));
  return true;
}

// ---------- @-nevning ----------
// Kandidatlista er ansattlista på kontoret og navnene i markeringen på
// byggeplassen — se toppen av nevning.js for hvorfor.
export function nevnListe(c) { return nevnKandidater(c, LETT ? [] : ANSATTE); }

// Varsler den som er nevnt. To veier, avhengig av hvor vi står:
//   Byggeplassen – gjennom Workerens innboks, samme vei som markeringer og
//                  kommentarer går. Da fanges den opp av flyten som allerede
//                  lytter der og legger kort i Teams-kanalen.
//   Kontoret     – til adressen «varsel» i oppsett.json, hvis den er satt.
//                  Er den ikke satt, skjer ingenting utenfor appen; nevningen
//                  vises fortsatt i markeringen. Myk degradering, som resten
//                  av oppsett.json.
//
// «no-cors» med text/plain er med vilje: en Power Automate-flyt svarer ikke med
// CORS-hoder, og en vanlig JSON-POST ville utløst en preflight som blir
// blokkert. Vi får aldri vite om den kom fram — derfor er dette et TILLEGG til
// at nevningen står i markeringen, aldri den eneste veien.
function varsleNevning(c, tekst, nevnte) {
  if (!nevnte.length) return;
  const last = {
    type: "nevning",
    prosjekt: S.lettProsjekt || "",
    modell: S.fileName || "",
    markering: c.id,
    tekst: String(tekst || "").slice(0, 500),
    fra: innloggetNavn(),
    nevnte
  };
  if (LETT) { sendHendelse(last, true); return; }   // stille: nevningen står i teksten uansett
  const url = TJENESTER && TJENESTER.varsel;
  if (!url) return;
  try {
    fetch(url, {
      method: "POST", mode: "no-cors", keepalive: true,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(last)
    }).catch(() => {});
  } catch (_) {}
}

// ---------- 💬 Svar på en markering ----------
// Svarene ligger i markeringen selv (c.svar), så de følger med i den samme
// delte JSON-fila og trenger ingen ny lagringsplass i SharePoint.

export const svarI = (c) => (c && Array.isArray(c.svar) ? c.svar : []);

export function leggTilSvar(c, tekst) {
  const rent = String(tekst == null ? "" : tekst).trim();
  if (!c || !rent) return null;
  const s = { id: nyId(), tekst: rent, forfatter: innloggetNavn(), dato: naaTekst(), endret: "",
              kilde: LETT ? "bygg" : "kontor" };
  c.svar = svarI(c).concat([s]);
  updateComment(c, {});
  varsleNevning(c, rent, finnNevnte(rent, nevnListe(c)));
  if (LETT) sendHendelse({ type: "svar", markering: c.id, svar: s })
    .then(ok => { if (!ok) { merkUsendte(); renderCommentList(); } });
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

// Sletter en talemelding. Speiler slettSvar over: samme mønster, samme
// updateComment til slutt. Selve lydfila ryddes i bakgrunnen — feiler det, blir
// det en foreldreløs fil i SharePoint, og det skal ikke stoppe brukeren.
export function slettLyd(c, fil) {
  const f = lydI(c).length;
  c.lyd = lydI(c).filter(l => l.fil !== fil);
  if (c.lyd.length === f) return false;
  slettBilder([fil]);
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

// ---------- 🎤 Talemeldinger ----------
// En talemelding er { fil, av, dato }. Eldre opptak ble lagret som bare et
// filnavn, og de leses fortsatt — de får bare tom avsender. Normaliseringen
// gjøres HER, ikke i vasken alene, fordi lista også kommer fra byggeplassen og
// fra localStorage.
function lydI(c) {
  if (!c || !Array.isArray(c.lyd)) return [];
  return c.lyd.map(l => (typeof l === "string" ? { fil: l, av: "", dato: "" } : {
    fil: String((l && l.fil) || ""), av: String((l && l.av) || ""), dato: String((l && l.dato) || "")
  })).filter(l => l.fil);
}

const lydFiler = (c) => lydI(c).map(l => l.fil);

function lydStripeHtml(c, kanLeggeTil) {
  const liste = lydI(c);
  const kan = kanLeggeTil && lydStottes() && liste.length < MAKS_LYD_PER_MARKERING;
  if (!liste.length && !kan) return "";
  return '<div class="mp-seksjon mp-lyd-seksjon"><div class="mp-seksjon-tittel">' +
    t("Talemelding") + (liste.length ? ' <span>' + liste.length + '</span>' : "") + '</div>' +
    liste.map(l => '<div class="mp-lyd" data-lyd="' + esc(l.fil) + '">' +
      '<div class="mp-lyd-topp">' +
        '<span class="mp-lyd-meta">' + esc([l.av, l.dato].filter(Boolean).join(" · ")) + '</span>' +
        '<button class="mp-lyd-slett" title="' + t("Slett talemeldingen") + '">' + ikon("slett") + '</button>' +
      '</div>' +
      '</div>').join("") +
    (kan ? '<button class="mp-tegning nytt mp-lyd-ny">' + ikon("mikrofon") + ' ' + t("Ta opp talemelding") + '</button>' : "") +
    '</div>';
}

// Lydfilene hentes én gang hver, som miniatyrbildene.
function fyllLyd(rot) {
  rot.querySelectorAll(".mp-lyd[data-lyd]").forEach(async el => {
    if (el.dataset.fylt) return;
    el.dataset.fylt = "1";
    const url = await lydUrl(el.dataset.lyd);
    if (!url) {
      el.classList.add("mangler");
      el.insertAdjacentHTML("beforeend", '<span>' + ikon("laas") + " " + t("Logg inn for å høre opptaket") + '</span>');
      return;
    }
    const a = document.createElement("audio");
    a.controls = true;
    a.preload = "none";        // ikke last ned før noen trykker play
    a.src = url;
    el.appendChild(a);
  });
}

// Selve opptaket. Knappen bytter til «Stopp» med en teller, så man ser at det
// går – uten det er det umulig å vite om mikrofonen faktisk fanget noe.
// Et pågående opptak må kunne stanses utenfra. Lukker man bobla midt i et
// opptak, ville mikrofonen ellers stått på til fanen ble lukket – og
// opptaksprikken i telefonens statuslinje sier ikke hvilken side som lytter.
let opptak = null;

function stoppOpptakHvisAktivt() {
  if (!opptak) return;
  const o = opptak;
  opptak = null;
  try { o.avbryt(); } catch (_) {}
}

async function taOppTil(c, knapp) {
  if (lydI(c).length >= MAKS_LYD_PER_MARKERING) {
    alert(t("En markering kan ha maks {0} talemeldinger.", MAKS_LYD_PER_MARKERING));
    return;
  }
  stoppOpptakHvisAktivt();          // aldri to opptak i gang samtidig
  let ktrl;
  try {
    ktrl = await startOpptak((sek) => { knapp.innerHTML = ikon("stopp") + " " + t("Stopp") + " · " + fmtTid(sek); });
    opptak = ktrl;
  } catch (err) {
    // Avslått mikrofontilgang er den vanligste grunnen, og feilmeldingen fra
    // nettleseren sier ingenting om hvordan man angrer på det.
    alert(/NotAllowed|Permission/i.test(err.name + err.message)
      ? t("Mikrofonen er avslått for denne siden. Slå den på i nettleserens innstillinger for nettstedet, og prøv igjen.")
      : t("Fikk ikke startet opptaket: ") + err.message);
    return;
  }
  knapp.classList.add("tar-opp");
  knapp.onclick = async () => {
    knapp.onclick = null;
    const res = await ktrl.stopp();
    opptak = null;
    knapp.classList.remove("tar-opp");
    if (!res || !res.blob || res.blob.size < 1000) { openMarkerPopup(c); return; }  // for kort til å være noe
    loadingText.textContent = t("Sender talemeldingen …");
    loadingEl.classList.add("open");
    try {
      const navn = lydNavn(c.id, alleBilder(c).length + lydI(c).length + 1, res.endelse);
      const av = innloggetNavn();
      // Navnet sendes MED opplastingen. På byggeplassen går fila til Workerens
      // innboks, og der er det ingen innlogging å hente et navn fra senere —
      // rekker vi det ikke her, er avsenderen tapt for godt.
      await lastOpp(res.blob, navn, av);
      c.lyd = lydI(c).concat([{ fil: navn, av, dato: naaTekst() }]);
      persist();
      pushSharedComments();
      renderCommentList();
      if (LETT) alert(t("Talemeldingen er sendt. Den blir synlig for prosjektlederen neste gang han åpner modellen."));
    } catch (err) {
      alert(err.message === "IKKE_INNLOGGET"
        ? t("Talemeldinger lagres i SharePoint, så du må være innlogget. Åpne Biblioteket og logg inn, så prøv igjen.")
        : t("Klarte ikke å sende talemeldingen: ") + err.message);
    } finally {
      loadingEl.classList.remove("open");
      openMarkerPopup(c);
    }
  };
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
        : '<div class="mp-svar-tekst">' + nevningHtml(s.tekst, nevnListe(c), innloggetNavn()) + '</div>') +
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
  // @-nevning. Kobles FØR fokus, så lista er klar med en gang man skriver @.
  koblNevning(felt, () => nevnListe(popFor));
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
  stoppOpptakHvisAktivt();
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
      : '<div class="mp-text">' + nevningHtml(c.text, nevnListe(c), innloggetNavn()) + '</div>') +
    bildeStripeHtml(c, true) +
    lydStripeHtml(c, true) +
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
    // Hastegraden i klartekst under feltene. Vises OGSÅ på byggeplassen:
    // .mp-fields skjules i lettmodus, men .mp-frist gjør det ikke — frist er
    // den ene opplysningen som avgjør hva montøren gjør nå.
    (() => {
      const ft = fristTekstFor(c);
      const ring = HASTEGRAD[ft.hast].ring;
      if (!ring || ft.hast === "ukjent") return "";
      return '<div class="mp-frist" style="border-left:3px solid ' + ring + '">' +
        (ft.hast === "forfalt" || ft.hast === "rod" ? ikon("advarsel") + " " : "") +
        esc(ft.arg === null ? t(ft.nokkel) : t(ft.nokkel, ft.arg)) + '</div>';
    })() +
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
  fyllLyd(el);
  const lydKnapp = el.querySelector(".mp-lyd-ny");
  if (lydKnapp) lydKnapp.onclick = () => taOppTil(c, lydKnapp);
  el.querySelectorAll(".mp-lyd[data-lyd]").forEach(rad => {
    const slettKnapp = rad.querySelector(".mp-lyd-slett");
    if (!slettKnapp) return;
    slettKnapp.onclick = (e) => {
      e.stopPropagation();                       // ikke start avspilling
      if (!confirm(t("Slette denne talemeldingen?"))) return;
      slettLyd(c, rad.dataset.lyd);
    };
  });
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
  if (c && (alleBilder(c).length || lydI(c).length)) slettBilder(alleBilder(c).concat(lydFiler(c)));
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

// Gjør «Ny markering»-dialogen klar. Kalles fra main.js og lett-main.js like
// før dialogen åpnes.
//
// FORHÅNDSUTFYLT FRIST, IKKE PÅKREVD: et hardt krav ville lagt friksjon
// nøyaktig der du vil ha minst av den — du står i modellen, ser feilen, vil få
// den ned. Med forhåndsutfylling får vi samme dekning, og den som bare trykker
// videre får en fornuftig frist i stedet for ingen.
//
// GJELDER IKKE BYGGEPLASSEN. Montøren kjenner ikke framdriftsplanen, og frist
// er noe kontoret eier. Feltet er skjult med CSS i bygg.html
// ([data-lett="1"] .cd-frist), og hoppes over her uansett — CSS skal ikke være
// det eneste som avgjør hvilke data som lagres.
export const STANDARD_FRIST_DAGER = 14;

export function forberedNyMarkering() {
  $("commentText").value = "";
  const felt = $("commentDue"), av = $("commentNoDue");
  if (!felt || !av) return;                    // eldre HTML uten feltet
  if (LETT) { felt.value = ""; av.checked = true; return; }
  av.checked = false;
  felt.value = omDager(STANDARD_FRIST_DAGER, iDag);
  felt.disabled = false;
  av.onchange = () => { felt.disabled = av.checked; if (av.checked) felt.value = ""; };
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
    // J1: INGEN automatisk ansvarlig. Sto det ANSATTE[0] her, ble den som
    // tilfeldigvis står øverst i oppsett.json stille eier av alt som opprettes –
    // uten at noen valgte det, og uten at noen fikk beskjed. Tom eier er synlig
    // og ærlig; feil eier ser riktig ut, og da oppdager ingen den.
    owner: "",
    // Frist fra dialogen. Tom på byggeplassen og når «ingen frist» er huket av —
    // da får markeringen grå ring, som er ærlig: ingen har bestemt når dette
    // skal være ferdig. Grå blir dermed en arbeidskø, ikke en mangel.
    due: (!LETT && $("commentDue") && $("commentNoDue") && !$("commentNoDue").checked)
      ? ($("commentDue").value || "") : "",
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
    } }).then(ok => {
      if (ok) { alert(t("Markeringen er sendt til prosjektlederen.")); return; }
      merkUsendte();          // J5: tegn den blass og merk den «ikke sendt»
      renderCommentList();
    });
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
  // Uten plan-ID ville Graph fått «/planner/plans//buckets» og svart 400 med en
  // melding ingen kan gjøre noe med. Stopp her, og si hvor tallet skal inn.
  if (!PLANNER.planId) {
    alert(t("Planner er ikke satt opp ennå. Plan-ID-en legges inn i «oppsett.json» i SharePoint-mappa med modellene."));
    return;
  }
  const uten = list.filter(c => !c.due);
  if (uten.length) {
    alert((uten.length === 1 ? t("Markeringen mangler frist.") : t("{0} markeringer mangler frist.", uten.length)) +
      t(" Sett frist først – Planner-oppgaven trenger en dato."));
    return;
  }
  // J3: en oppgave uten mottaker er verre enn ingen oppgave – alle tror den er
  // sendt. Står det et navn i «owner» som ikke finnes i ANSATTE med Entra-GUID
  // (tidligere ansatt, eller navnet skrevet litt annerledes), ville assignees
  // blitt tom og oppgaven opprettet i det stille. Stopp før det skjer.
  const ukjent = [...new Set(list.filter(c => c.owner && !ANSATTE.some(a => a.navn === c.owner))
                                 .map(c => c.owner))];
  if (ukjent.length) {
    alert(t("Fant ikke {0} i ansattlista, så oppgaven ville ikke fått noen mottaker. Velg en ansvarlig fra lista først.",
      ukjent.map(n => "«" + n + "»").join(", ")));
    return;
  }
  const utenEier = list.filter(c => !c.owner);
  if (utenEier.length && !confirm(utenEier.length === 1
      ? t("Markeringen har ingen ansvarlig. Oppgaven blir liggende i Planner uten mottaker. Fortsette?")
      : t("{0} markeringer har ingen ansvarlig. Oppgavene blir liggende i Planner uten mottaker. Fortsette?", utenEier.length))) return;

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
  // To fristfiltre i tillegg til statusfiltrene. Prefikset «h:» skiller dem fra
  // statusnøklene, som er de lagrede verdiene «Åpen»/«Pågår»/«Løst».
  antall["h:forfalt"] = S.comments.filter(c => hastegradFor(c) === "forfalt").length;
  antall["h:rod"] = S.comments.filter(c => hastegradFor(c) === "rod").length;

  const knapp = (key, tekst, farge) => '<button data-flt="' + key + '"' +
    (listFilter === key ? ' class="active"' : "") + '>' +
    (farge ? '<span style="color:' + farge + '">●</span> ' : "") +
    tekst + ' ' + (antall[key] || 0) + '</button>';
  let html = status +
    '<div class="prop-actions">' + knapp("alle", t("Alle")) +
      Object.keys(STATUS).map(k => knapp(k, t(k))).join("") + '</div>' +
    // Egen rad: fristfiltrene svarer på et annet spørsmål enn statusfiltrene,
    // og de skal ikke se ut som om de hører til samme gruppe.
    ((antall["h:forfalt"] || antall["h:rod"])
      ? '<div class="prop-actions">' +
          (antall["h:forfalt"] ? knapp("h:forfalt", t("Forfalt"), HASTEGRAD.forfalt.ring) : "") +
          (antall["h:rod"] ? knapp("h:rod", t("Haster"), HASTEGRAD.rod.ring) : "") + '</div>'
      : "");

  const vis = S.comments.filter(c =>
    listFilter === "alle" ? true
    : listFilter.startsWith("h:") ? hastegradFor(c) === listFilter.slice(2)
    : statusOf(c) === listFilter);
  // uløste med frist, som ikke alt har fått en oppgave
  const apne = S.comments.filter(c => statusOf(c) !== "Løst" && c.due && !c.taskId);
  if (apne.length > 1) {
    html += '<div class="prop-actions"><button id="cmAllTasks">' + ikon("planner") + ' ' + t("Lag {0} Planner-oppgaver", apne.length) + '</button></div>';
  }

  html += vis.map(c => {
    const st = statusOf(c);
    // Venstrekanten beholder STATUSfargen — fyll = status, som i modellen.
    // Hastegraden kommer som en egen prikk lenger ned, så lista og bobla
    // forteller det samme.
    const ft = fristTekstFor(c);
    const ring = HASTEGRAD[ft.hast].ring;
    return '<div class="comment" data-id="' + esc(c.id) + '" style="border-left:3px solid ' + STATUS[st].col + '">' +
      '<div class="meta"><span>' + esc((c.author ? c.author + " · " : "") + (c.date || "")) + '</span>' +
        '<span class="del" data-del="' + esc(c.id) + '">' + t("Slett") + '</span></div>' +
      '<div>' + esc(c.text) + '</div>' +
      '<div class="meta" style="margin-top:4px"><span>' +
        '<span style="color:' + STATUS[st].col + '">●</span> ' + t(st) +
        (c.owner ? ' · ' + esc(c.owner) : "") +
        (c.due ? ' ' + t("· frist ") + esc(c.due.split("-").reverse().join(".")) : "") +
        // Hastegraden: farget prikk + tekst som sier hvor lenge det er igjen.
        // Ringen i modellen og denne prikken er samme regel, samme farge.
        (ring
          ? ' · <span style="color:' + ring + '" title="' + esc(t(HASTEGRAD[ft.hast].navn)) + '">●</span> ' +
            esc(ft.arg === null ? t(ft.nokkel) : t(ft.nokkel, ft.arg))
          : "") +
        (c.usendt ? ' · <span style="color:var(--warn)" title="' + t("Ligger lagret på telefonen og sendes når du har nett igjen.") + '">' +
          ikon("advarsel") + ' ' + t("ikke sendt") + '</span>' : "") +
        (c.taskId ? ' · <span title="Har en Planner-oppgave">' + ikon("planner") + '</span>' : "") +
        (svarI(c).length ? ' · <span title="' + t("{0} kommentarer", svarI(c).length) + '">' +
          ikon("svar") + ' ' + svarI(c).length + '</span>' : "") +
        (tegningerI(c).length ? ' · <span title="' +
          esc(tegningerI(c).map(tegningTekst).join(", ")) + '">' + ikon("tegning") + ' ' + tegningerI(c).length + '</span>' : "") +
        (lydI(c).length ? ' · <span title="' + t("Talemelding") + '">' + ikon("mikrofon") + ' ' + lydI(c).length + '</span>' : "") +
        (alleBilder(c).length
          ? ' · <span title="' + SEKSJONER.map(([s, t]) => t + ": " + bilderI(c, s).length).join(", ") +
            '">' + ikon("kamera") + ' ' + alleBilder(c).length + (bilderI(c, "etter").length ? " " + t("(før/etter)") : "") + '</span>'
          : "") +
      '</span></div></div>';
  }).join("") ||
    // «h:forfalt» er en intern nøkkel og skal aldri vises. Oversett den til
    // hastegradens navn før den settes inn i setningen.
    '<p style="color:var(--muted)">' + t("Ingen markeringer med status «{0}».",
      esc(listFilter.startsWith("h:")
        ? t((HASTEGRAD[listFilter.slice(2)] || { navn: listFilter }).navn)
        : t(listFilter))) + '</p>';

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

// ---------- Tegn alle markeringer på nytt ----------
// Brukes når noe UTENFOR markeringene har endret hvordan de skal se ut:
// datoen har skiftet, eller fristgrensene har kommet fra oppsett.json.
export function tegnAlleMarkeringerPaNytt() {
  const gamle = [...markerGroup.children];
  gamle.forEach(s => {
    markerGroup.remove(s);
    if (s.material) s.material.dispose();   // ikke .map — den er delt, se updateComment
  });
  (S.comments || []).forEach(addMarkerSprite);
  S.miniSkitten = true;
}

// ---------- Midnattskroken ----------
// Teksturene regnes ut én gang, men hastegraden endrer seg av seg selv når
// klokka passerer midnatt. Står modellen åpen over natta — eller står nettbrettet
// på i brakka — ville bobla vist gårsdagens hastegrad til noen lastet siden.
//
// To utløsere med vilje: visibilitychange fanger den vanlige saken (fanen tas
// fram igjen om morgenen), intervallet fanger skjermer som aldri blir skjult.
// Ti minutter er rikelig; ingen merker at fargen skifter 09:57 i stedet for 00:00.
function sjekkDagskifte() {
  const naa = iDagISO();
  if (naa === iDag) return;
  iDag = naa;
  tegnAlleMarkeringerPaNytt();
  renderCommentList();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) sjekkDagskifte(); });
setInterval(sjekkDagskifte, 600000);

// Firmaoppsettet kommer fra SharePoint et sekund eller to etter oppstart. Står
// markeringspanelet allerede åpent, tegnes det på nytt så «Ansvarlig» får folk
// i seg uten at brukeren må lukke og åpne.
//
// Fristgrensene kommer samme vei (FRISTER fylles av oppsett.js), så markeringene
// må også tegnes på nytt — ellers står ringene på standardverdiene 8/3 helt til
// noen endrer en status.
S.onOppsett = () => {
  try {
    tegnAlleMarkeringerPaNytt();
    if ($("commentPanel") && $("commentPanel").classList.contains("open")) renderCommentList();
  } catch (_) {}
};
