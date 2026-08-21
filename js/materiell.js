// 📦 Materiell — VERKTØYET. Lage, plassere, flytte, rotere, skjule og slette
// materiell-objekter, og hente/lagre maler i SharePoint-biblioteket.
// Importeres BARE fra main.js — bygg.html (lettmodus) laster aldri denne fila;
// der finnes bare visningen (materiell-vis.js).
//
// PEKELOGIKKEN (lærepenger fra første runde, 19.08.2026):
//
//  · Lytterne ligger på window i FANGSTFASEN, så de kan stoppe hendelsen før
//    kameraets og main.js sine lyttere på canvas ser den.
//  · MEN: stopper vi et pointerup som kameraet fikk pointerdown til, blir
//    kameraet stående og TRO at knappen fortsatt holdes inne — det «låser seg
//    i rotasjon». Derfor: hver gang vi svelger et pointerup, sendes et
//    syntetisk pointercancel til canvas (slippKamera), så SimpleControls
//    rydder pekeren sin. Det er billig, og det kan aldri bli feil.
//  · Et KLIKK (under 8 px bevegelse) på et materiell-objekt velger det — i
//    ALLE moduser, ikke bare i materiell-modus. Valget vises med samme blå
//    markeringseffekt som elementvalget i modellen, og en liten knapperad
//    (roter/skjul/slett) kommer opp nederst.
//  · Et DRAG som ikke starter på et materiell-objekt skal ALDRI røres — det
//    er kameraet sitt.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, grid, raycaster } from "./scene.js";
import { pick } from "./elements.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import {
  ARM_DIM, ARM_TYPER, MALTYPER, byggMateriellObjekt, finnObjekt,
  lagreMateriellLokalt, materiellForEksport, materiellGroup,
  materiellTypeLabel, tegnMateriell, vaskMateriell
} from "./materiell-vis.js";

// ---------- Tilstand ----------
let plasserer = null;      // { p, gruppe } — objektet som henger på pekeren
let valgtId = null;        // markert objekt (roter/skjul/slett/flytt)
let drar = null;           // { id, fra: Vector3 } under flytting
let nedPos = null;         // vår egen nedtrykks-posisjon (klikk kontra drag)
const ROT_STEG = Math.PI / 12;   // 15°
const KLIKK_PX = 8;

function nyId() {
  return "M-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

// Endringer skal synes med en gang i Mengder og lagres lokalt.
function meldEndret() {
  S.qtyCache = null;
  lagreMateriellLokalt();
}

function hentP(id) { return (S.materiell || []).find(x => x.id === id) || null; }

// ---------- Kameraet skal aldri bli hengende ----------
// SimpleControls (scene.js) fører sin egen liste over nedtrykte pekere. Svelger
// vi et pointerup den ventet på, står pekeren igjen i lista og kameraet roterer
// på alt som beveger seg. Et syntetisk pointercancel rydder den — end()-lytteren
// i SimpleControls håndterer pointercancel fra før.
function slippKamera(e) {
  try {
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId }));
  } catch (_) {
    try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {}
  }
}

// ---------- Peking ----------
const _plan = new THREE.Plane();
const _punkt = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function bakkeY() { return grid.position.y || 0; }

function settNdc(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
}

// Der objektet skal lande: nærmeste treff av MODELLEN og ANNET MATERIELL,
// ellers bakkeplanet. At annet materiell teller er det som gjør at en ny
// stabel legger seg OPPÅ en som ligger der — ikke inni den. `unntatt` er
// objektet som selv er i bevegelse (forhåndsvisningen eller det som dras);
// uten unntaket ville det truffet seg selv og klatret til himmels.
function pekPunkt(clientX, clientY, unntatt) {
  const hit = pick(clientX, clientY);   // modellen (respekterer snitt)
  settNdc(clientX, clientY);
  raycaster.setFromCamera(_ndc, camera);
  const kandidater = materiellGroup.children.filter(o => o !== unntatt);
  // navnelappene (sprites) er ingen flate å legge noe på
  const mHits = raycaster.intersectObjects(kandidater, true).filter(h => !h.object.isSprite);
  let best = hit;
  if (mHits.length && (!best || mHits[0].distance < best.distance)) best = mHits[0];
  if (best) return best.point.clone();
  _plan.set(new THREE.Vector3(0, 1, 0), -bakkeY());
  raycaster.setFromCamera(_ndc, camera);
  return raycaster.ray.intersectPlane(_plan, _punkt) ? _punkt.clone() : null;
}

// Peker mot et materiell-objekt? Raycast mot materiellGroup — pick() i
// elements.js ser bare modellen, med vilje.
function pekMateriell(clientX, clientY) {
  settNdc(clientX, clientY);
  raycaster.setFromCamera(_ndc, camera);
  const treff = raycaster.intersectObjects(materiellGroup.children, true);
  for (const h of treff) {
    let o = h.object;
    while (o && !o.userData.materiellId) o = o.parent;
    if (o && o.userData.materiellId) return o;
  }
  return null;
}

// ---------- Angre ----------
function post(tekst, angreFn, gjenFn) {
  if (S.pushAngre) S.pushAngre({ tekst, angre: angreFn, gjenopprett: gjenFn });
}

function leggTil(p, medAngre) {
  S.materiell = (S.materiell || []).concat([p]);
  tegnMateriell();
  meldEndret();
  if (medAngre) post("Materiell plassert",
    () => { fjern(p.id, false); },
    () => { leggTil(p, false); });
}

function fjern(id, medAngre) {
  const p = hentP(id);
  if (!p) return;
  S.materiell = S.materiell.filter(x => x.id !== id);
  if (valgtId === id) valgtId = null;
  tegnMateriell();
  meldEndret();
  if ($("materiellPanel") && $("materiellPanel").classList.contains("open")) tegnPanel();
  if (medAngre) post("Materiell slettet",
    () => { leggTil(p, false); },
    () => { fjern(id, false); });
}

function oppdater(id, felter, angreTekst) {
  const p = hentP(id);
  if (!p) return;
  const før = Object.assign({}, p);
  Object.assign(p, felter);
  tegnMateriell();
  meldEndret();
  if (angreTekst) {
    const etter = Object.assign({}, p);
    post(angreTekst,
      () => { oppdater(id, før, null); },
      () => { oppdater(id, etter, null); });
  }
}

// ---------- 🔵 Valg og markeringseffekt ----------
// Samme blå som elementvalget i modellen (selMat i elements.js), så «valgt»
// ser likt ut uansett hva man har trykket på.
const SEL_FARGE = 0x3b82f6, SEL_EMISSIVE = 0x1d4ed8;

function settValgEffekt(gruppe, paa) {
  gruppe.traverse(m => {
    if (m.isSprite || !m.isMesh || !m.material) return;
    if (paa) {
      if (!m.userData.matOrig) m.userData.matOrig = m.material;
      if (!m.userData.matSel) {
        const s = m.userData.matOrig.clone();
        s.color.set(SEL_FARGE);
        if (s.emissive) s.emissive.set(SEL_EMISSIVE);
        m.userData.matSel = s;
      }
      m.material = m.userData.matSel;
    } else if (m.userData.matOrig) {
      m.material = m.userData.matOrig;
    }
  });
}

function oppdaterValgEffekt() {
  materiellGroup.children.forEach(o => settValgEffekt(o, o.userData.materiellId === valgtId));
}

function velg(id) {
  valgtId = id;
  oppdaterValgEffekt();
  oppdaterValgBar();
  if (S.materiellModeBarTegn && S.mode === "materiell") S.materiellModeBarTegn();
}

// tegnMateriell() bygger objektene på nytt — effekten og knapperaden må på igjen
S.etterTegnMateriell = () => { oppdaterValgEffekt(); oppdaterValgBar(); };

// ---------- Knapperaden for det valgte objektet ----------
// Egen flytende rad (ikke modeBar): den skal virke i ALLE moduser, også når
// man bare klikker på et objekt uten å ha materiell-verktøyet åpent.
function valgBarEl() {
  let el = $("matValgBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "matValgBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function oppdaterValgBar() {
  const el = valgBarEl();
  const p = valgtId ? hentP(valgtId) : null;
  if (!p || p.skjult) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML =
    '<span style="font-size:12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + esc(p.farge) + ';margin-right:6px"></span>' +
    esc(p.navn || materiellTypeLabel(p)) + (p.antall > 1 ? " ×" + p.antall : "") + "</span>" +
    '<button id="mvRotV" class="btn" title="' + t("Roter 15° mot venstre") + '" style="padding:3px 8px">⟲</button>' +
    '<button id="mvRotH" class="btn" title="' + t("Roter 15° mot høyre") + '" style="padding:3px 8px">⟳</button>' +
    '<button id="mvSkjul" class="btn" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon("skjul") + "</button>" +
    '<button id="mvSlett" class="btn" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button>" +
    '<button id="mvRediger" class="btn" title="' + t("Rediger") + '" style="padding:3px 8px">' + ikon("rediger") + "</button>" +
    '<button id="mvLukk" class="btn" title="' + t("Ferdig") + '" style="padding:3px 8px">' + t("Ferdig") + "</button>";
  $("mvRotV").onclick = () => { const q = hentP(valgtId); if (q) oppdater(q.id, { rot: q.rot + ROT_STEG }, "Materiell rotert"); };
  $("mvRotH").onclick = () => { const q = hentP(valgtId); if (q) oppdater(q.id, { rot: q.rot - ROT_STEG }, "Materiell rotert"); };
  $("mvSkjul").onclick = () => {
    const q = hentP(valgtId); if (!q) return;
    oppdater(q.id, { skjult: true }, "Materiell skjult");
    velg(null);
    if ($("materiellPanel").classList.contains("open")) tegnPanel();
  };
  $("mvSlett").onclick = () => { const q = hentP(valgtId); if (q) fjern(q.id, true); velg(null); };
  // Rediger: åpner skjemaet forhåndsutfylt, så en skrivefeil i dimensjoner,
  // navn eller farge rettes uten å legge inn objektet på nytt (Emil 21.08).
  $("mvRediger").onclick = () => {
    const q = hentP(valgtId);
    if (!q) return;
    apnePanel("materiellPanel");
    tegnSkjema(q, q.id);
  };
  $("mvLukk").onclick = () => velg(null);
}

// ---------- Modus og kontrollinja ----------
function iModus() { return S.mode === "materiell"; }

// modes.js kaller denne når S.mode === "materiell". Valgt-objekt-knappene bor
// i den flytende raden (over) — kontrollinja har hintet og Ferdig-knappen.
S.materiellModeBar = (bar) => {
  S.materiellModeBarTegn = () => {
    const hint = plasserer
      ? t("Trykk der materiellet skal ligge — Esc avbryter")
      : t("Trykk på et materiell-objekt for å flytte, rotere eller slette det");
    bar.innerHTML = '<span class="lbl">' + hint + '</span>' +
      '<button id="mbMatFerdig">' + t("Ferdig") + "</button>";
    $("mbMatFerdig").onclick = () => {
      settMateriellModus(false);
      $("materiellPanel").classList.remove("open");
    };
    bar.classList.add("open");
  };
  S.materiellModeBarTegn();
};

function settMateriellModus(paa) {
  S.mode = paa ? "materiell" : null;
  const b = $("btnMateriell");
  if (b) b.classList.toggle("active", paa);
  if (!paa) avbrytPlassering();
  if (S.oppdaterModeBar) S.oppdaterModeBar();
}

// ---------- Plassering ----------
function startPlassering(mal) {
  avbrytPlassering();
  const p = vaskMateriell(Object.assign({ id: nyId() }, mal, { skjult: false }));
  if (!p) return;
  const gruppe = byggMateriellObjekt(p);
  gruppe.position.set(0, bakkeY(), 0);
  materiellGroup.add(gruppe);
  plasserer = { p, gruppe };
  if (!iModus()) settMateriellModus(true);
  $("materiellPanel").classList.remove("open");
  if (S.materiellModeBarTegn) S.materiellModeBarTegn();
}

function avbrytPlassering() {
  if (!plasserer) return;
  materiellGroup.remove(plasserer.gruppe);
  plasserer.gruppe.traverse(m => { if (m.geometry) m.geometry.dispose(); });
  plasserer = null;
  if (S.materiellModeBarTegn && iModus()) S.materiellModeBarTegn();
}

function overCanvas(e) { return e.target === canvas; }

// ---------- Pekerne (window, fangstfase) ----------
window.addEventListener("pointerdown", (e) => {
  // Shift er markeringsboksens og flervalgets tast (elements.js) — materiell
  // holder fingrene av fatet, ellers valgte et shift-klikk BÅDE objektet og
  // startet boksmodus (Emils funn 21.08).
  if (e.shiftKey && !plasserer && !drar) return;
  nedPos = { x: e.clientX, y: e.clientY };
  if (!overCanvas(e) || e.button !== 0) return;
  if (plasserer) { e.stopPropagation(); return; }   // plasseringsklikket tas på pointerup
  // Drag av et objekt starter KUN i materiell-modus — ellers eier kameraet
  // draget, og et klikk (pointerup under 8 px) velger objektet uansett modus.
  if (iModus()) {
    const o = pekMateriell(e.clientX, e.clientY);
    if (o) {
      e.stopPropagation();   // kameraet skal ikke rotere mens objektet dras
      velg(o.userData.materiellId);
      drar = { id: o.userData.materiellId, fra: o.position.clone() };
    }
  }
}, true);

window.addEventListener("pointermove", (e) => {
  if (plasserer) {
    const pt = pekPunkt(e.clientX, e.clientY, plasserer.gruppe);
    if (pt) plasserer.gruppe.position.copy(pt);
    return;
  }
  if (drar) {
    e.stopPropagation();
    const o = finnObjekt(drar.id);
    const pt = o ? pekPunkt(e.clientX, e.clientY, o) : null;
    if (pt && o) o.position.set(pt.x, pt.y, pt.z);
  }
}, true);

window.addEventListener("pointerup", (e) => {
  if (e.shiftKey && !plasserer && !drar) return;   // shift = markeringsboksen sin
  const ned = nedPos;
  nedPos = null;
  if (!overCanvas(e) || e.button !== 0) return;

  if (plasserer) {
    e.stopPropagation(); slippKamera(e);
    const pt = pekPunkt(e.clientX, e.clientY, plasserer.gruppe);
    if (!pt) return;
    const p = Object.assign({}, plasserer.p, { x: pt.x, y: pt.y, z: pt.z });
    avbrytPlassering();
    leggTil(p, true);
    velg(p.id);
    return;
  }

  if (drar) {
    // Les ut drag-tilstanden FØR slippKamera: det syntetiske pointercancel-et
    // den sender treffer vår egen pointercancel-lytter synkront, og den
    // nullstiller `drar` — å lese drar.id etterpå var null-feilen Emils
    // feilviser pekte på 21.08 ([materiell.js:344]).
    const fra = drar.fra, id = drar.id;
    drar = null;
    e.stopPropagation(); slippKamera(e);
    const o = finnObjekt(id);
    if (o && o.position.distanceToSquared(fra) > 1e-12) {
      const til = o.position.clone();
      oppdater(id, { x: til.x, y: til.y, z: til.z }, null);
      post("Materiell flyttet",
        () => oppdater(id, { x: fra.x, y: fra.y, z: fra.z }, null),
        () => oppdater(id, { x: til.x, y: til.y, z: til.z }, null));
    }
    velg(id);
    return;
  }

  // Bare et KLIKK velger — et kameradrag skal aldri røres, og aldri stoppes.
  const klikk = ned && Math.hypot(e.clientX - ned.x, e.clientY - ned.y) <= KLIKK_PX;
  if (!klikk) return;
  const o = pekMateriell(e.clientX, e.clientY);
  if (o) {
    // valg virker i ALLE moduser — også uten materiell-verktøyet åpent
    e.stopPropagation(); slippKamera(e);
    velg(o.userData.materiellId);
    return;
  }
  // klikk utenfor: velg bort — men IKKE stopp hendelsen, main.js skal få
  // gjøre sitt (velge element, lukke paneler). Å svelge den her var det som
  // låste kameraet i første utgave.
  if (valgtId) velg(null);
}, true);

window.addEventListener("pointercancel", () => { drar = null; nedPos = null; }, true);

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (plasserer) { avbrytPlassering(); return; }
  if (valgtId) { velg(null); return; }
  if (iModus()) settMateriellModus(false);
});

// ---------- Verktøyknappen ----------
på("btnMateriell", "click", () => {
  const panel = $("materiellPanel");
  if (panel.classList.contains("open")) {
    panel.classList.remove("open");
    settMateriellModus(false);
    return;
  }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  settMateriellModus(true);
  tegnPanel();
  apnePanel("materiellPanel");
});

// ---------- Panelet ----------
function tegnPanel() {
  const body = $("materiellBody");
  if (!body) return;
  let html = '<div class="prop-actions"><button id="matNytt" class="primary">' +
    ikon("boks") + " " + t("Nytt materiell") + "</button></div>";

  // plasserte objekter i denne modellen
  const liste = materiellForEksport();
  html += '<h4 style="margin:12px 0 4px">' + t("Plassert i modellen") +
    ' <span style="color:var(--muted);font-size:11px">(' + liste.length + ')</span></h4>';
  if (!liste.length) {
    html += '<p style="color:var(--muted);font-size:12px">' + t("Ingen materiell-objekter plassert ennå.") + "</p>";
  } else {
    html += liste.map(p =>
      '<div class="qty-row"' + (p.skjult ? ' style="opacity:.55"' : "") + '><div class="n" data-mat-velg="' + esc(p.id) + '" style="cursor:pointer">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + esc(p.farge) + ';margin-right:6px"></span>' +
      esc(p.navn || materiellTypeLabel(p)) +
      ' <span style="color:var(--muted);font-size:11px">' + esc(materiellTypeLabel(p)) +
      " · " + p.lengde + "×" + p.bredde + " mm" + (p.antall > 1 ? " · ×" + p.antall : "") + "</span></div>" +
      '<div class="c">' +
      '<button data-mat-skjul="' + esc(p.id) + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(p.skjult ? "skjul" : "vis") + "</button>" +
      '<button data-mat-slett="' + esc(p.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>"
    ).join("");
  }

  // biblioteket
  html += '<h4 style="margin:14px 0 4px">' + t("Materiell-bibliotek") + "</h4>" +
    '<div id="matBib"><p style="color:var(--muted);font-size:12px">' + t("Henter biblioteket …") + "</p></div>";

  body.innerHTML = html;
  $("matNytt").onclick = () => tegnSkjema();
  body.querySelectorAll("[data-mat-velg]").forEach(d =>
    d.onclick = () => velg(d.dataset.matVelg));
  body.querySelectorAll("button[data-mat-skjul]").forEach(b =>
    b.onclick = () => {
      const p = hentP(b.dataset.matSkjul);
      if (!p) return;
      oppdater(p.id, { skjult: !p.skjult }, p.skjult ? "Materiell vist" : "Materiell skjult");
      tegnPanel();
    });
  body.querySelectorAll("button[data-mat-slett]").forEach(b =>
    b.onclick = () => { fjern(b.dataset.matSlett, true); });
  tegnBibliotek();
}

// ---------- Skjemaet: nytt objekt ELLER redigering av et plassert ----------
// Med redigerId utfylt er skjemaet forhåndsutfylt fra det plasserte objektet,
// og lagring endrer det på stedet (posisjon/rotasjon/skjult beholdes).
function tegnSkjema(mal, redigerId) {
  const body = $("materiellBody");
  const m = mal || {};
  const type = MALTYPER[m.maltype] ? m.maltype : "trp";
  const felter = (typ) => {
    const M = MALTYPER[typ];
    const std = Object.assign({}, M.standard, m.maltype === typ ? m : {});
    let ut = "";
    if (typ === "armering") {
      // de to underkategoriene: hva slags armering, og Ø-dimensjonen
      const valgtArm = ARM_TYPER[std.armType] ? std.armType : "nett";
      const valgtDim = ARM_DIM.includes(Number(std.diameter)) ? Number(std.diameter) : 12;
      ut += '<label>' + t("Armeringstype") + '<select id="matArmType">' +
        Object.keys(ARM_TYPER).map(k => '<option value="' + k + '"' + (k === valgtArm ? " selected" : "") + ">" +
          esc(t(ARM_TYPER[k].label)) + "</option>").join("") + "</select></label>" +
        '<label>' + t("Dimensjon") + '<select id="matDiameter">' +
        ARM_DIM.map(dm => '<option value="' + dm + '"' + (dm === valgtDim ? " selected" : "") + ">Ø" + dm + "</option>").join("") +
        "</select></label>";
    }
    if (!M.fast) {
      ut += '<label>' + t("Lengde (mm)") + '<input type="number" id="matL" min="100" max="30000" step="50" value="' + (std.lengde || M.standard.lengde) + '"></label>' +
        '<label>' + t("Bredde (mm)") + '<input type="number" id="matB" min="100" max="30000" step="50" value="' + (std.bredde || M.standard.bredde) + '"></label>';
      if (typ === "sandwich")
        ut += '<label>' + t("Tykkelse (mm)") + '<input type="number" id="matT" min="30" max="500" step="10" value="' + (std.tykkelse || M.tykkelse) + '"></label>';
    } else {
      ut += '<p style="color:var(--muted);font-size:12px;margin:4px 0">' + t("Fast mål: {0} × {1} mm", M.bredde, M.lengde) + "</p>";
    }
    return ut;
  };
  body.innerHTML =
    '<h4 style="margin:0 0 6px">' + t(redigerId ? "Rediger materiell" : "Nytt materiell") + "</h4>" +
    '<label>' + t("Type") + '<select id="matType">' +
    Object.keys(MALTYPER).map(k => '<option value="' + k + '"' + (k === type ? " selected" : "") + ">" + esc(t(MALTYPER[k].label)) + "</option>").join("") +
    "</select></label>" +
    '<label>' + t("Navn på objektet") + '<input type="text" id="matNavn" maxlength="80" placeholder="' + t("f.eks. TRP tak felt B") + '" value="' + esc(m.navn || "") + '"></label>' +
    '<div id="matFelter">' + felter(type) + "</div>" +
    '<label>' + t("Farge") + '<input type="color" id="matFarge" value="' + esc(m.farge || MALTYPER[type].standard.farge) + '"></label>' +
    '<label>' + t("Antall i stabel") + '<input type="number" id="matAntall" min="1" max="500" step="1" value="' + (m.antall || 1) + '"></label>' +
    '<div class="prop-actions" style="margin-top:10px">' +
    '<button id="matPlasser" class="primary">' + t(redigerId ? "Lagre endringer" : "Legg i modellen") + "</button>" +
    '<button id="matLagre">' + t("Lagre i bibliotek") + "</button>" +
    '<button id="matAvbryt">' + t("Avbryt") + "</button></div>";

  $("matType").onchange = () => {
    const typ = $("matType").value;
    $("matFelter").innerHTML = felter(typ);
    $("matFarge").value = MALTYPER[typ].standard.farge;
  };
  const lesSkjema = () => vaskMateriell({
    id: nyId(),
    maltype: $("matType").value,
    navn: $("matNavn").value.trim(),
    farge: $("matFarge").value,
    lengde: $("matL") ? $("matL").value : 0,
    bredde: $("matB") ? $("matB").value : 0,
    tykkelse: $("matT") ? $("matT").value : 0,
    armType: $("matArmType") ? $("matArmType").value : undefined,
    diameter: $("matDiameter") ? $("matDiameter").value : undefined,
    antall: $("matAntall").value
  });
  $("matPlasser").onclick = () => {
    const p = lesSkjema();
    if (!p) return;
    if (redigerId && hentP(redigerId)) {
      // bare de redigerbare feltene — posisjon, rotasjon og skjult beholdes
      oppdater(redigerId, {
        maltype: p.maltype, navn: p.navn, farge: p.farge,
        lengde: p.lengde, bredde: p.bredde, tykkelse: p.tykkelse, antall: p.antall,
        armType: p.armType, diameter: p.diameter
      }, "Materiell endret");
      tegnPanel();
      velg(redigerId);
      return;
    }
    startPlassering(p);
  };
  $("matLagre").onclick = async () => {
    const p = lesSkjema();
    if (!p) return;
    if (!p.navn) { alert(t("Gi malen et navn før du lagrer den i biblioteket.")); return; }
    $("matLagre").disabled = true;
    try { await lagreIBibliotek(p); tegnPanel(); }
    catch (err) { alert(t("Fikk ikke lagret i biblioteket: ") + err.message); }
    finally { const b = $("matLagre"); if (b) b.disabled = false; }
  };
  $("matAvbryt").onclick = () => tegnPanel();
}

// ---------- SharePoint-biblioteket ----------
// Én JSON-fil med alle malene, i en egen mappe ved siden av IFC-modellene.
// Samme innlogging og site som modellbiblioteket — og bare når du er logget
// inn, akkurat som med IFC-modellene.
const BIB_FIL = "materiell-bibliotek.json";

function bibMappe() { return SP.folder + "/Materiell"; }

async function sikreSiteId(token) {
  if (S.spSiteId) return;
  const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
  S.spSiteId = site.id;
}

async function hentBibliotek() {
  const token = await spTokenSilent();
  if (!token) return null;   // ikke innlogget
  await sikreSiteId(token);
  const sti = (bibMappe() + "/" + BIB_FIL).split("/").map(encodeURIComponent).join("/");
  const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/root:/" + sti + ":/content",
    { headers: authHeaders(token, null, "materiell-bibliotek") });
  if (r.status === 404) return [];   // mappa/fila finnes ikke ennå — tomt bibliotek
  if (!r.ok) throw new Error("Graph " + r.status);
  const data = await r.json().catch(() => []);
  return (Array.isArray(data) ? data : []).map(vaskMateriell).filter(Boolean);
}

async function lagreIBibliotek(p) {
  const token = await spTokenSilent();
  if (!token) throw new Error(t("Logg inn (åpne Biblioteket) først."));
  await sikreSiteId(token);
  const eksisterende = (await hentBibliotek()) || [];
  // samme navn + type erstatter den gamle malen i stedet for å doble den
  const uten = eksisterende.filter(x => !(x.navn === p.navn && x.maltype === p.maltype));
  const mal = Object.assign({}, p, { x: 0, y: 0, z: 0, rot: 0, skjult: false });
  const sti = (bibMappe() + "/" + BIB_FIL).split("/").map(encodeURIComponent).join("/");
  const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/root:/" + sti + ":/content", {
    method: "PUT",
    headers: authHeaders(token, { "content-type": "application/json" }, "materiell-lagre"),
    body: JSON.stringify(uten.concat([mal]))
  });
  if (!r.ok) throw new Error("Graph " + r.status);
}

async function tegnBibliotek() {
  const el = $("matBib");
  if (!el) return;
  let liste = null;
  try { liste = await hentBibliotek(); }
  catch (_) { el.innerHTML = '<p style="color:var(--muted);font-size:12px">' + t("Fikk ikke hentet biblioteket. Prøv igjen.") + "</p>"; return; }
  if (!$("matBib")) return;   // panelet er tegnet om i mellomtiden
  if (liste === null) {
    el.innerHTML = '<p style="color:var(--muted);font-size:12px">' + t("Logg inn (åpne Biblioteket) for å hente lagrede maler.") + "</p>";
    return;
  }
  if (!liste.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:12px">' + t("Ingen maler lagret ennå. Lag et objekt og trykk «Lagre i bibliotek».") + "</p>";
    return;
  }
  el.innerHTML = liste.map((p, i) =>
    '<div class="lib-item" data-mat-bib="' + i + '"><div class="n">' +
    '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + esc(p.farge) + ';margin-right:6px"></span>' +
    esc(p.navn || materiellTypeLabel(p)) + "</div>" +
    '<div class="m">' + esc(materiellTypeLabel(p)) + " · " + p.lengde + "×" + p.bredde + " mm" +
    (p.antall > 1 ? " · ×" + p.antall : "") + "</div></div>").join("") +
    '<p style="color:var(--muted);font-size:11px;margin-top:6px">' + t("Trykk på en mal for å plassere den i modellen.") + "</p>";
  el.querySelectorAll("[data-mat-bib]").forEach(d =>
    d.onclick = () => {
      const p = liste[Number(d.dataset.matBib)];
      if (p) startPlassering(Object.assign({}, p, { id: nyId() }));
    });
}
