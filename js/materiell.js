// 📦 Materiell — VERKTØYET. Lage, plassere, flytte, rotere og slette
// materiell-objekter, og hente/lagre maler i SharePoint-biblioteket.
// Importeres BARE fra main.js — bygg.html (lettmodus) laster aldri denne fila;
// der finnes bare visningen (materiell-vis.js).
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, grid, raycaster } from "./scene.js";
import { pick } from "./elements.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
import {
  MALTYPER, byggMateriellObjekt, finnObjekt, lagreMateriellLokalt,
  materiellForEksport, materiellGroup, mmTilScene, tegnMateriell, vaskMateriell
} from "./materiell-vis.js";

// ---------- Tilstand ----------
let plasserer = null;      // { p, gruppe } — objektet som henger på pekeren
let valgtId = null;        // markert objekt (flytt/roter/slett)
let drar = null;           // { id, fra: Vector3 } under flytting
const ROT_STEG = Math.PI / 12;   // 15°

function nyId() {
  return "M-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

// Endringer skal synes med en gang i Mengder og lagres lokalt.
function meldEndret() {
  S.qtyCache = null;
  lagreMateriellLokalt();
}

// ---------- Bakkeplanet ----------
// Objektene legger seg der du peker: på en modellflate hvis du treffer en,
// ellers på bakkeplanet (rutenettets høyde = modellens underkant).
const _plan = new THREE.Plane();
const _punkt = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function bakkeY() { return grid.position.y || 0; }

function pekPunkt(clientX, clientY) {
  const hit = pick(clientX, clientY);
  if (hit) return hit.point.clone();
  const r = canvas.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  _plan.set(new THREE.Vector3(0, 1, 0), -bakkeY());
  return raycaster.ray.intersectPlane(_plan, _punkt) ? _punkt.clone() : null;
}

// Peker mot et materiell-objekt? Raycast mot materiellGroup — pick() i
// elements.js ser bare modellen, med vilje.
function pekMateriell(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
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
  const p = (S.materiell || []).find(x => x.id === id);
  if (!p) return;
  S.materiell = S.materiell.filter(x => x.id !== id);
  if (valgtId === id) velg(null);
  tegnMateriell();
  meldEndret();
  if (medAngre) post("Materiell slettet",
    () => { leggTil(p, false); },
    () => { fjern(id, false); });
}

function oppdater(id, felter, angreTekst) {
  const p = (S.materiell || []).find(x => x.id === id);
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

// ---------- Modus, valg og kontrollinje ----------
function iModus() { return S.mode === "materiell"; }

function velg(id) {
  valgtId = id;
  if (S.materiellModeBarTegn) S.materiellModeBarTegn();
}

// modes.js kaller denne når S.mode === "materiell" — den eier innholdet i
// kontrollinja nederst (samme flate som måle- og koteverktøyet bruker).
S.materiellModeBar = (bar) => {
  S.materiellModeBarTegn = () => {
    const p = valgtId ? (S.materiell || []).find(x => x.id === valgtId) : null;
    if (plasserer) {
      bar.innerHTML = '<span class="lbl">' + t("Trykk der materiellet skal ligge — Esc avbryter") + '</span>';
    } else if (p) {
      bar.innerHTML = '<span class="lbl">' + esc(p.navn || t(MALTYPER[p.maltype].label)) + '</span>' +
        '<button id="mbRotV" title="' + t("Roter 15° mot venstre") + '">⟲ 15°</button>' +
        '<button id="mbRotH" title="' + t("Roter 15° mot høyre") + '">⟳ 15°</button>' +
        '<button id="mbSlett">' + t("Slett") + '</button>' +
        '<span class="lbl" style="opacity:.7">' + t("Dra objektet for å flytte det") + '</span>';
      $("mbRotV").onclick = () => oppdater(p.id, { rot: p.rot + ROT_STEG }, "Materiell rotert");
      $("mbRotH").onclick = () => oppdater(p.id, { rot: p.rot - ROT_STEG }, "Materiell rotert");
      $("mbSlett").onclick = () => fjern(p.id, true);
    } else {
      bar.innerHTML = '<span class="lbl">' + t("Trykk på et materiell-objekt for å flytte, rotere eller slette det") + '</span>';
    }
    bar.classList.add("open");
  };
  S.materiellModeBarTegn();
};

// ---------- Plassering og flytting ----------
// Lytterne ligger på window i FANGSTFASEN: da kan de stoppe hendelsen før
// kameraets og main.js sine lyttere på canvas rekker å se den. Det er slik
// draging av et objekt lar seg gjøre uten at kameraet roterer samtidig.
function startPlassering(mal) {
  avbrytPlassering();
  const p = vaskMateriell(Object.assign({ id: nyId() }, mal));
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
  if (S.materiellModeBarTegn) S.materiellModeBarTegn();
}

function overCanvas(e) { return e.target === canvas; }

window.addEventListener("pointermove", (e) => {
  if (plasserer) {
    const pt = pekPunkt(e.clientX, e.clientY);
    if (pt) plasserer.gruppe.position.copy(pt);
    return;
  }
  if (drar) {
    e.stopPropagation();
    const pt = pekPunkt(e.clientX, e.clientY);
    const o = finnObjekt(drar.id);
    if (pt && o) o.position.set(pt.x, pt.y, pt.z);
  }
}, true);

window.addEventListener("pointerdown", (e) => {
  if (!iModus() || e.button !== 0 || !overCanvas(e)) return;
  if (plasserer) { e.stopPropagation(); return; }   // selve plasseringen skjer på pointerup
  const o = pekMateriell(e.clientX, e.clientY);
  if (o) {
    e.stopPropagation();   // kameraet skal ikke rotere mens objektet dras
    velg(o.userData.materiellId);
    drar = { id: o.userData.materiellId, fra: o.position.clone() };
  }
}, true);

window.addEventListener("pointerup", (e) => {
  if (!iModus() || !overCanvas(e)) return;
  if (plasserer && e.button === 0) {
    e.stopPropagation();
    const pt = pekPunkt(e.clientX, e.clientY);
    if (!pt) return;
    const p = Object.assign({}, plasserer.p, { x: pt.x, y: pt.y, z: pt.z });
    avbrytPlassering();
    leggTil(p, true);
    velg(p.id);
    return;
  }
  if (drar) {
    e.stopPropagation();
    const o = finnObjekt(drar.id);
    const fra = drar.fra, id = drar.id;
    drar = null;
    if (o && o.position.distanceToSquared(fra) > 1e-12) {
      const til = o.position.clone();
      oppdater(id, { x: til.x, y: til.y, z: til.z }, null);
      post("Materiell flyttet",
        () => oppdater(id, { x: fra.x, y: fra.y, z: fra.z }, null),
        () => oppdater(id, { x: til.x, y: til.y, z: til.z }, null));
    } else if (o) {
      // et rent klikk (ingen flytting) = bare velg, tegn linja på nytt
      velg(id);
    }
    return;
  }
  // klikk i modus utenfor objektene: velg bort, og stopp elementvalget i main.js
  if (e.button === 0) {
    e.stopPropagation();
    velg(null);
  }
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && plasserer) avbrytPlassering();
});

// ---------- Modus av/på ----------
function settMateriellModus(paa) {
  S.mode = paa ? "materiell" : null;
  const b = $("btnMateriell");
  if (b) b.classList.toggle("active", paa);
  if (!paa) { avbrytPlassering(); velg(null); }
  // updateModeBar ligger i modes.js og kalles via kroken — den kjenner modusen
  if (S.oppdaterModeBar) S.oppdaterModeBar();
}

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
      '<div class="qty-row"><div class="n">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + esc(p.farge) + ';margin-right:6px"></span>' +
      esc(p.navn || t(MALTYPER[p.maltype].label)) +
      ' <span style="color:var(--muted);font-size:11px">' + esc(t(MALTYPER[p.maltype].label)) +
      " · " + p.lengde + "×" + p.bredde + " mm" + (p.antall > 1 ? " · ×" + p.antall : "") + "</span></div>" +
      '<div class="c"><button data-mat-slett="' + esc(p.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>"
    ).join("");
  }

  // biblioteket
  html += '<h4 style="margin:14px 0 4px">' + t("Materiell-bibliotek") + "</h4>" +
    '<div id="matBib"><p style="color:var(--muted);font-size:12px">' + t("Henter biblioteket …") + "</p></div>";

  body.innerHTML = html;
  $("matNytt").onclick = () => tegnSkjema();
  body.querySelectorAll("button[data-mat-slett]").forEach(b =>
    b.onclick = () => { fjern(b.dataset.matSlett, true); tegnPanel(); });
  tegnBibliotek();
}

// ---------- Skjemaet: nytt objekt ----------
function tegnSkjema(mal) {
  const body = $("materiellBody");
  const m = mal || {};
  const type = MALTYPER[m.maltype] ? m.maltype : "trp";
  const felter = (typ) => {
    const M = MALTYPER[typ];
    const std = Object.assign({}, M.standard, m.maltype === typ ? m : {});
    let ut = "";
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
    '<h4 style="margin:0 0 6px">' + t("Nytt materiell") + "</h4>" +
    '<label>' + t("Type") + '<select id="matType">' +
    Object.keys(MALTYPER).map(k => '<option value="' + k + '"' + (k === type ? " selected" : "") + ">" + esc(t(MALTYPER[k].label)) + "</option>").join("") +
    "</select></label>" +
    '<label>' + t("Navn på objektet") + '<input type="text" id="matNavn" maxlength="80" placeholder="' + t("f.eks. TRP tak felt B") + '" value="' + esc(m.navn || "") + '"></label>' +
    '<div id="matFelter">' + felter(type) + "</div>" +
    '<label>' + t("Farge") + '<input type="color" id="matFarge" value="' + esc(m.farge || MALTYPER[type].standard.farge) + '"></label>' +
    '<label>' + t("Antall i stabel") + '<input type="number" id="matAntall" min="1" max="500" step="1" value="' + (m.antall || 1) + '"></label>' +
    '<div class="prop-actions" style="margin-top:10px">' +
    '<button id="matPlasser" class="primary">' + t("Legg i modellen") + "</button>" +
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
    antall: $("matAntall").value
  });
  $("matPlasser").onclick = () => { const p = lesSkjema(); if (p) startPlassering(p); };
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
  const mal = Object.assign({}, p, { x: 0, y: 0, z: 0, rot: 0 });
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
    esc(p.navn || t(MALTYPER[p.maltype].label)) + "</div>" +
    '<div class="m">' + esc(t(MALTYPER[p.maltype].label)) + " · " + p.lengde + "×" + p.bredde + " mm" +
    (p.antall > 1 ? " · ×" + p.antall : "") + "</div></div>").join("") +
    '<p style="color:var(--muted);font-size:11px;margin-top:6px">' + t("Trykk på en mal for å plassere den i modellen.") + "</p>";
  el.querySelectorAll("[data-mat-bib]").forEach(d =>
    d.onclick = () => {
      const p = liste[Number(d.dataset.matBib)];
      if (p) startPlassering(Object.assign({}, p, { id: nyId() }));
    });
}
