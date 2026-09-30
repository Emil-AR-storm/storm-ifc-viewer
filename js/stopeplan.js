// 🧱 Støpeplan i 3D — VERKTØYET (kontor). Trinn 1: etappene, panelet og
// lagringen. Byggeplan: «Storm IFC-Viewer byggeplan Stopeplan 3D 2026-09-30.md».
//
// Emil 30.09: knappen i Bygg Info, ingen Planner-kobling, ingen fugetyper, men
// vanntetting (injeksjonsslanger og Cemflex) med løpemeter, og sonene skal
// kunne dras og justeres. Felt, elementer og vanntetting kommer i egne trinn.
//
// LAGRING som Grupper og Rigg: lokalt FØRST (så ingenting er borte om nettet
// faller ut), så SharePoint-mappa «Stopeplan», én fil per modell. `endret` på
// hver etappe avgjør hvem som vinner når to har endret (sp-lager.js). En
// slettet etappe blir en gravstein, så slettingen også når kollegaene.
//
// Importeres BARE fra main.js. Byggeplass-siden får egen visning (trinn 5).
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { iDagISO } from "./frist.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import {
  STATUS_TEKST, nyEtappe, sortert, statusFor, synlige, vaskEtappe, vaskEtappeListe
} from "./stopeplan-regn.js";

const SP_MAPPE = "Stopeplan";
let spStatus = "av";          // "av" | "ok" | "feil" — vises nederst i panelet
let lagreTid = 0;

function nokkel() { return "storm-ifc-stopeplan::" + S.fileName; }
function spFil() { return S.fileName + ".stopeplan.json"; }

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

function lesLokalt() {
  try { return vaskEtappeListe(JSON.parse(localStorage.getItem(nokkel()) || "[]")); }
  catch (_) { return []; }
}
function lagreLokalt() {
  try { localStorage.setItem(nokkel(), JSON.stringify(vaskEtappeListe(S.stopeplan))); } catch (_) {}
}

// Skriving samles: å skrive dato-feltet tegn for tegn skal ikke gi ti
// skrivinger til SharePoint. Lokalt lagres det med en gang.
export function lagre() {
  lagreLokalt();
  clearTimeout(lagreTid);
  lagreTid = setTimeout(skrivSp, 600);
}

async function skrivSp() {
  if (!spPaalogget()) { spStatus = "av"; visLagring(); return; }
  const forFil = S.fileName;
  const res = await spSkriv(SP_MAPPE, spFil(), vaskEtappeListe(S.stopeplan), (e) => String(e && e.id || ""));
  if (S.fileName !== forFil) return;
  spStatus = res.ok ? "ok" : "feil";
  if (res.ok && res.liste) { S.stopeplan = vaskEtappeListe(res.liste); lagreLokalt(); if (erApen()) tegnPanel(); }
  else visLagring();
}

async function hentFraSp() {
  if (!spPaalogget()) { spStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(SP_MAPPE, spFil());
  if (S.fileName !== forFil) return;      // modellen byttet underveis
  spStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (spStatus === "ok") {
    S.stopeplan = vaskEtappeListe(flettPaaId(vaskEtappeListe(S.stopeplan), vaskEtappeListe(res.liste)));
    lagreLokalt();
  }
  if (erApen()) tegnPanel();
  if (S.tegnStopeplan) S.tegnStopeplan();
}

function lagringsTekst() {
  if (spStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (spStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Trykk på den røde prikken øverst til høyre og logg inn for å dele med de andre.");
}
function visLagring() {
  const el = $("stLagring");
  if (el) el.textContent = lagringsTekst();
}

// Endrer én etappe og stempler den, så den vinner flettingen.
export function endreEtappe(id, endring) {
  const naa = new Date().toISOString();
  S.stopeplan = vaskEtappeListe(S.stopeplan).map(e =>
    e.id === id ? vaskEtappe(Object.assign({}, e, endring, { endret: naa, av: mittNavn() })) : e);
  lagre();
  if (S.tegnStopeplan) S.tegnStopeplan();
}

export function leggTilEtappe() {
  const e = nyEtappe(S.stopeplan);
  e.av = mittNavn();
  S.stopeplan = vaskEtappeListe(S.stopeplan).concat([e]);
  lagre();
  tegnPanel();
  return e;
}

export function slettEtappe(id) {
  const naa = new Date().toISOString();
  S.stopeplan = vaskEtappeListe(S.stopeplan).map(e => e.id === id ? { id, slettet: true, endret: naa } : e);
  lagre();
  tegnPanel();
  if (S.tegnStopeplan) S.tegnStopeplan();
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() { const p = $("stopePanel"); return !!(p && p.classList.contains("open")); }

const STATUS_FARGE = { stopt: "var(--ok)", uke: "var(--warn)", forsinket: "var(--danger)", planlagt: "var(--muted)" };

export function tegnPanel() {
  const body = $("stopeBody");
  if (!body) return;
  const iDag = iDagISO();
  const liste = sortert(S.stopeplan);
  let html = '<p class="set-hjelp" style="margin-top:0">' +
    esc(t("Del støpene i etapper. Gi hver etappe en dato, og merk den som støpt når den er ferdig. Felt på plata og elementer legges til etappen i neste trinn.")) + "</p>";
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen etapper ennå.")) + "</p>";
  for (const e of liste) {
    const st = statusFor(e, iDag);
    const innhold = [
      t("{0} elementer", e.elementer.length),
      t("{0} felt", e.felt.length)
    ].join(" · ");
    html += '<div class="st-etappe" data-id="' + esc(e.id) + '" style="border-left:4px solid ' + esc(e.farge) + '">' +
      '<div class="st-rad">' +
        '<input type="color" class="st-farge" value="' + esc(e.farge) + '" title="' + esc(t("Farge")) + '">' +
        '<b class="st-nr">' + e.nr + '</b>' +
        '<input type="text" class="st-navn" maxlength="80" value="' + esc(e.navn) + '">' +
        '<button class="st-slett" title="' + esc(t("Slett etappen")) + '">' + ikon("slett") + "</button>" +
      "</div>" +
      '<div class="st-rad">' +
        '<input type="date" class="st-dato" value="' + esc(e.dato) + '">' +
        '<select class="st-status">' +
          '<option value="planlagt"' + (e.status !== "stopt" ? " selected" : "") + ">" + esc(t("Ikke støpt")) + "</option>" +
          '<option value="stopt"' + (e.status === "stopt" ? " selected" : "") + ">" + esc(t("Støpt")) + "</option>" +
        "</select>" +
        '<span class="st-merke" style="color:' + STATUS_FARGE[st] + '">' + esc(t(STATUS_TEKST[st])) + "</span>" +
      "</div>" +
      '<div class="st-innhold">' + esc(innhold) + "</div>" +
    "</div>";
  }
  html += '<div class="prop-actions" style="margin-top:10px"><button id="stNy" class="primary">' + ikon("pluss") + " " + esc(t("Ny etappe")) + "</button></div>" +
    '<p class="set-hjelp" id="stLagring">' + esc(lagringsTekst()) + "</p>";
  body.innerHTML = html;

  $("stNy").onclick = () => leggTilEtappe();
  body.querySelectorAll(".st-etappe").forEach(rad => {
    const id = rad.dataset.id;
    rad.querySelector(".st-navn").onchange = (ev) => endreEtappe(id, { navn: ev.target.value });
    rad.querySelector(".st-dato").onchange = (ev) => { endreEtappe(id, { dato: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-status").onchange = (ev) => { endreEtappe(id, { status: ev.target.value }); tegnPanel(); };
    // «change», ikke «input»: input fyrer for hvert musetrekk i fargehjulet
    rad.querySelector(".st-farge").onchange = (ev) => { endreEtappe(id, { farge: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-slett").onclick = () => {
      const e = synlige(S.stopeplan).find(x => x.id === id);
      if (e && confirm(t("Slette {0}?", e.navn))) slettEtappe(id);
    };
  });
}

// ═══════════════════════ KROKER ═══════════════════════
S.lastStopeplan = () => {
  S.stopeplan = lesLokalt();
  if (erApen()) tegnPanel();
  hentFraSp();          // i bakgrunnen
};
S.ryddStopeplan = () => { S.stopeplan = []; };

på("btnStopeplan", "click", () => {
  const panel = $("stopePanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("stopePanel");
});
