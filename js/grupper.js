// 🎯 Objektgrupper — lagre et flervalg av IFC-elementer med navn, og hente
// det fram igjen: alt annet skjules og kameraet glir til 3 meter unna gruppa.
//
// Lastes av BÅDE main.js og lett-main.js:
//  · Kontoret lagrer grupper (fra shift-klikk/markeringsboks-utvalget) og de
//    følger prosjektet ut via Byggeplass-knappen (grupper-feltet i
//    .markeringer.json — samme reise som materiellet).
//  · Byggeplassen (lettmodus) henter dem fra Workerens JSON og kan trykke på
//    dem — alt annet skjules og kameraet flyr dit, akkurat som på kontoret
//    (skjuling i sammenslått geometri: synkMergedSkjuling i display.js).
//
// Lagring lokalt: én localStorage-nøkkel per modellfil, samme mønster som
// materiellet. Vasking: alt som kommer utenfra (Worker-JSON) går gjennom
// vaskGruppe — ukjente felter slipper aldri inn.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, controls } from "./scene.js";
import { allElementBoxes } from "./elements.js";
import { hideElements } from "./display.js";
import { mmTilScene } from "./materiell-vis.js";

const LETT = document.documentElement.dataset.lett === "1";
export const GRUPPE_MAKS_ELEMENTER = 5000;

// ---------- Vasking ----------
export function vaskGruppe(g) {
  if (!g || typeof g !== "object") return null;
  if (!g.id || typeof g.id !== "string") return null;
  const navn = String(g.navn || "").slice(0, 80).trim();
  if (!navn) return null;
  const ids = Array.isArray(g.ids)
    ? g.ids.map(Number).filter(Number.isFinite).slice(0, GRUPPE_MAKS_ELEMENTER)
    : [];
  if (!ids.length) return null;
  return { id: g.id.slice(0, 40), navn, ids };
}

export function vaskGruppeListe(liste) {
  return (Array.isArray(liste) ? liste : []).map(vaskGruppe).filter(Boolean);
}

export function grupperForEksport() { return vaskGruppeListe(S.grupper); }

// ---------- Lagring (kontor) ----------
function lagringsNokkel() { return "storm-ifc-grupper::" + S.fileName; }

function lagreLokalt() {
  if (LETT) return;   // på byggeplassen eies dataene av Workeren
  try { localStorage.setItem(lagringsNokkel(), JSON.stringify(grupperForEksport())); } catch (_) {}
}

function lesLokalt() {
  try { return vaskGruppeListe(JSON.parse(localStorage.getItem(lagringsNokkel()) || "[]")); }
  catch (_) { return []; }
}

// ---------- Kroker mot resten av appen ----------
// Kalles av afterLoad (ifc.js) når en modell er åpnet — kontoret leser fra
// localStorage; byggeplassen får dem via S.settGrupperFraLett (markers.js).
S.lastGrupper = () => {
  if (LETT) return;
  S.grupper = lesLokalt();
  if (erApen()) tegnPanel();
};

S.settGrupperFraLett = (liste) => {
  S.grupper = vaskGruppeListe(liste);
  if (erApen()) tegnPanel();
};

// ---------- Kameraglidningen ----------
let anim = 0;

// Glir kamera + siktepunkt dit på ~0,6 sek med myk inn/ut. Et nytt kall
// avbryter det forrige, så to raske trykk ikke slåss om kameraet.
function flyTil(posMal, targetMal) {
  const fraP = camera.position.clone(), fraT = controls.target.clone();
  const start = performance.now(), DUR = 600;
  cancelAnimationFrame(anim);
  const steg = (naa) => {
    const u = Math.min(1, (naa - start) / DUR);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    camera.position.lerpVectors(fraP, posMal, e);
    controls.target.lerpVectors(fraT, targetMal, e);
    if (u < 1) anim = requestAnimationFrame(steg);
  };
  anim = requestAnimationFrame(steg);
}

// ---------- Aktivering ----------
// Alt annet skjules (kontor) og kameraet ender 3 m fra gruppas overflate,
// i samme retning som du sto — du mister ikke orienteringen.
export function aktiverGruppe(g) {
  if (!S.modelGroup) return;
  const bokser = allElementBoxes();
  const iGruppen = new Set(g.ids);
  const boks = new THREE.Box3();
  let funnet = 0;
  for (const id of g.ids) {
    const b = bokser.get(id);
    if (b) { boks.union(b); funnet++; }
  }
  if (!funnet) { alert(t("Fant ikke elementene i denne modellen.")); return; }
  // Skjuling virker nå også i lettmodus (synkMergedSkjuling i display.js
  // kollapser trekantene i den sammenslåtte geometrien) — montøren får
  // samme fokusvisning som kontoret.
  const andre = [];
  for (const id of bokser.keys()) if (!iGruppen.has(id)) andre.push(id);
  if (andre.length) hideElements(andre);   // angre-post lages der
  const c = boks.getCenter(new THREE.Vector3());
  const radius = boks.getSize(new THREE.Vector3()).length() / 2;
  let dir = camera.position.clone().sub(c);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize().multiplyScalar(radius + mmTilScene(3000));
  flyTil(c.clone().add(dir), c);
}

// ---------- Lagre / slette ----------
function valgteIder() {
  if (S.multiSel && S.multiSel.size) return [...S.multiSel.keys()];
  if (S.currentPropID != null) return [S.currentPropID];
  return [];
}

function nyId() {
  return "G-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function leggTil(g, medAngre) {
  S.grupper = (S.grupper || []).concat([g]);
  lagreLokalt();
  tegnPanel();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: "Gruppe lagret",
    angre: () => fjern(g.id, false),
    gjenopprett: () => leggTil(g, false)
  });
}

function fjern(id, medAngre) {
  const g = (S.grupper || []).find(x => x.id === id);
  if (!g) return;
  S.grupper = S.grupper.filter(x => x.id !== id);
  lagreLokalt();
  tegnPanel();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: "Gruppe slettet",
    angre: () => leggTil(g, false),
    gjenopprett: () => fjern(id, false)
  });
}

// ---------- Panelet ----------
function erApen() {
  const p = $("grupperPanel");
  return !!(p && p.classList.contains("open"));
}

function tegnPanel() {
  const body = $("grupperBody");
  if (!body) return;
  const valgte = valgteIder();
  let html = "";
  if (!LETT) {
    html += '<label>' + t("Navn på gruppen") +
      '<input type="text" id="grNavn" maxlength="80" placeholder="' + t("f.eks. Søyler akse 3") + '"></label>' +
      '<div class="prop-actions"><button id="grLagre" class="primary"' + (valgte.length ? "" : " disabled") + ">" +
      ikon("lagre") + " " + t("Lagre valgte som gruppe") + (valgte.length ? " (" + valgte.length + ")" : "") + "</button></div>" +
      (valgte.length ? "" :
        '<p style="color:var(--muted);font-size:12px">' + t("Velg elementer først: shift-klikk eller shift-dra i modellen.") + "</p>");
  }
  const liste = vaskGruppeListe(S.grupper);
  html += '<h4 style="margin:12px 0 4px">' + t("Lagrede grupper") +
    ' <span style="color:var(--muted);font-size:11px">(' + liste.length + ')</span></h4>';
  if (!liste.length) {
    html += '<p style="color:var(--muted);font-size:12px">' + t("Ingen grupper lagret ennå.") + "</p>";
  } else {
    html += liste.map(g =>
      '<div class="qty-row"><div class="n" data-gr-vis="' + esc(g.id) + '" style="cursor:pointer">' +
      ikon("fokus") + " " + esc(g.navn) +
      ' <span style="color:var(--muted);font-size:11px">' + g.ids.length + t(" stk") + "</span></div>" +
      '<div class="c">' + (LETT ? "" :
      '<button data-gr-slett="' + esc(g.id) + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + "</button>") +
      "</div></div>").join("") +
      '<p style="color:var(--muted);font-size:11px;margin-top:6px">' +
      t("Trykk på en gruppe: alt annet skjules og kameraet flyr dit. «Vis alle» henter tilbake resten.") + "</p>";
  }
  body.innerHTML = html;
  const inp = $("grNavn"), knapp = $("grLagre");
  if (knapp) knapp.onclick = () => {
    const navn = (inp.value || "").trim();
    if (!navn) { alert(t("Gi gruppen et navn først.")); return; }
    const ids = valgteIder();
    if (!ids.length) return;
    leggTil({ id: nyId(), navn: navn.slice(0, 80), ids }, true);
  };
  body.querySelectorAll("[data-gr-vis]").forEach(d =>
    d.onclick = () => {
      const g = vaskGruppeListe(S.grupper).find(x => x.id === d.dataset.grVis);
      if (g) aktiverGruppe(g);
    });
  body.querySelectorAll("button[data-gr-slett]").forEach(b =>
    b.onclick = () => fjern(b.dataset.grSlett, true));
}

på("btnGrupper", "click", () => {
  const panel = $("grupperPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("grupperPanel");
});
