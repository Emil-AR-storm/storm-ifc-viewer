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
import { $, S, apnePanel, ekstraLagSom, esc, ikon, på, writePrefs } from "./state.js";
import { hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import { t, tn } from "./i18n.js";
import { iDagISO } from "./frist.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import {
  STATUS_TEKST, CEMFLEX_OMLEGG_M, cemflexPlan, vannLengde, vannSummer, dagerMellom, mandag, erGenerert, plussDager, statusPer, tidslinjeSpenn, feltAreal, feltSummer, feltVolum, fjernElementer, kantLengder, leggTilElementer, nyEtappe, sortert, statusFor, synlige, vaskEtappe, vaskEtappeListe
} from "./stopeplan-regn.js";
import { settVisEtappeplan, settVisVanntetting, tegnStopeplan, visEtappeplan, visVanntetting } from "./stopeplan-vis.js";
import { antallElementer, antallFelt, settVistPer as settVist, tegnTidslinje as tegnTid } from "./stopeplan-tid.js";
import { clearSelection, quantitiesForSet } from "./elements.js";
import { metaFor } from "./ifcrpc.js";

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
  tegnStopeplan();
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
  tegnStopeplan();
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
  tegnStopeplan();
}

// ═══════════════════ TRINN 2: ELEMENTER ═══════════════════
// Utvalget er det samme som Grupper bruker: shift-klikk / shift-dra
// (S.multiSel), eller det ene elementet som er trykket på.
export function valgteIder() {
  if (S.multiSel && S.multiSel.size) return [...S.multiSel.keys()].map(Number).filter(n => n > 0);
  if (S.currentPropID != null) return [Number(S.currentPropID)].filter(n => n > 0);
  return [];
}

// 🧱 Generert betong i utvalget: betonggulvet og ringmurbitene fra
// SW-generatoren (Emil 30.09). Sandwichveggene er ikke betong og støpes ikke —
// de blir ikke med selv om de er valgt sammen med ringmuren.
export function valgteGenererte() {
  const lag = ekstraLagSom("valgte").find(l => l.id === "sw");
  if (!lag || !S.swBetong) return [];
  return lag.valgte().filter(id => { const b = S.swBetong(id); return !!(b && b.betong); });
}
function antallValgte() { return valgteIder().length + valgteGenererte().length; }

let sisteMelding = "";
export function leggValgteTil(id) {
  const ider = valgteIder();
  const gen = valgteGenererte();
  if (!ider.length && !gen.length) return 0;
  const naa = new Date().toISOString();
  const nye = ider.map(n => { const m = metaFor(n); return { id: n, gid: (m && m.globalId) || "" }; })
    .concat(gen.map(sw => ({ sw })));
  const r = leggTilElementer(S.stopeplan, id, nye, naa);
  S.stopeplan = r.liste.map(e => e.id === id ? Object.assign(e, { av: mittNavn() }) : e);
  const e = synlige(S.stopeplan).find(x => x.id === id);
  sisteMelding = r.flyttet
    ? tn(r.lagtTil, "{0} element lagt i {1}. Det er flyttet fra en annen etappe.", "{0} elementer lagt i {1}. {2} av dem er flyttet fra en annen etappe.", e ? e.navn : "", r.flyttet)
    : tn(r.lagtTil, "{0} element lagt i {1}.", "{0} elementer lagt i {1}.", e ? e.navn : "");
  lagre();
  tegnStopeplan();
  tegnPanel();
  return r.lagtTil;
}

// ═══════════ «LEGG TIL»: EN EGEN VELGEMODUS (Emil 01.10) ═══════════
// FØR: velg i modellen → egenskapspanelet åpnet seg og LUKKET støpeplanen →
// åpne støpeplanen igjen → «Legg til valgte». Upraktisk for den som skal fylle
// inn en hel plan. NÅ: «Legg til» på etappen starter en modus der hvert trykk
// i modellen legger til eller tar bort (shift-dra for mange på en gang).
// Panelet blir stående, og en linje nederst viser hvor mange som er valgt.
// «Ferdig» legger dem i etappen, «Avbryt» (eller Esc) lar etappen være.
let velger = null;          // { etappeId } mens modusen er på
export const velgerEtappe = () => (velger ? velger.etappeId : null);

function velgBar() {
  let el = $("stVelgBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "stVelgBar";
    el.className = "st-velgbar";
    document.body.appendChild(el);
  }
  return el;
}

function tegnVelgBar() {
  const el = velgBar();
  if (!velger) { el.style.display = "none"; el.innerHTML = ""; return; }
  const e = synlige(S.stopeplan).find(x => x.id === velger.etappeId);
  const n = antallValgte();
  el.style.display = "flex";
  el.innerHTML =
    '<span class="st-velg-farge" style="background:' + esc(e ? e.farge : "#888") + '"></span>' +
    '<span class="st-velg-tekst"><b>' + esc(t("Legg til i {0}", e ? e.navn : "")) + "</b><br>" +
      esc(t("Trykk på elementene som skal med. Shift + dra for mange på en gang.")) + "</span>" +
    '<span class="st-velg-ant">' + esc(t("{0} valgt", n)) + "</span>" +
    '<button id="stVelgFerdig" class="primary"' + (n ? "" : " disabled") + ">" + esc(t("Ferdig")) + "</button>" +
    '<button id="stVelgAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("stVelgFerdig").onclick = () => avsluttVelg(true);
  $("stVelgAvbryt").onclick = () => avsluttVelg(false);
}

export function startVelg(etappeId) {
  if (velger) avsluttVelg(false);
  if (S.stopeFelt && S.stopeFelt.tegner()) S.stopeFelt.avbrytTegning();
  velger = { etappeId };
  S.velgModusAktiv = true;
  sisteMelding = "";
  tegnVelgBar();
  tegnPanel();
}

export function avsluttVelg(leggTil) {
  if (!velger) return 0;
  const id = velger.etappeId;
  let n = 0;
  if (leggTil) n = leggValgteTil(id);
  velger = null;
  S.velgModusAktiv = false;
  // Utvalget var modusens arbeidsliste — det skal ikke henge igjen etterpå
  clearSelection();
  tegnVelgBar();
  tegnPanel();
  return n;
}
S.velgModusOppdater = () => tegnVelgBar();
S.avsluttVelgModus = () => avsluttVelg(false);
window.addEventListener("keydown", (ev) => {
  if (velger && ev.key === "Escape") { ev.stopPropagation(); avsluttVelg(false); }
}, true);

export function tomElementer(id) {
  S.stopeplan = fjernElementer(S.stopeplan, id, null, new Date().toISOString());
  sisteMelding = "";
  lagre();
  tegnStopeplan();
  tegnPanel();
}

// Volumet (ca) regnes av mengdeuttaket — samme tall som i Mengder.
const volumBuffer = new Map();
export function volumFor(e) {
  const ider = (e.elementer || []).filter(x => !erGenerert(x)).map(x => Number(x.id));
  // Generert betong regnes hver gang (billig, og målene endres når ringmuren
  // dras eller bygget genereres på nytt — et buffer ville vist gamle tall)
  let gen = 0;
  for (const x of e.elementer || []) {
    if (!erGenerert(x) || !S.swBetong) continue;
    const b = S.swBetong(x.sw);
    if (b && Number.isFinite(b.volM3)) gen += b.volM3;
  }
  if (!ider.length) return gen;
  const nokkel = e.id + "|" + ider.join(",");
  if (volumBuffer.has(nokkel)) return volumBuffer.get(nokkel) + gen;
  let v = 0;
  try {
    const q = quantitiesForSet(new Set(ider));
    for (const id of ider) { const x = q.get(id); if (x && Number.isFinite(x.vol)) v += x.vol; }
  } catch (_) { v = 0; }
  volumBuffer.set(nokkel, v);
  return v + gen;
}
const m3 = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " m³";
const m2 = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " m²";

// Tellerne på «Legg til valgte» følger utvalget uten at hele panelet tegnes
// på nytt (det ville tatt fokus fra et felt du skriver i).
function oppdaterValgKnapper() {
  if (velger) tegnVelgBar();
}
window.addEventListener("pointerup", () => setTimeout(oppdaterValgKnapper, 0));
window.addEventListener("keyup", () => setTimeout(oppdaterValgKnapper, 0));

// ═══════════ TRINN 4: «MERK SOM STØPT» OG TIDSLINJEN ═══════════
const datoKort = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] : iso; };
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : iso; };

export function merkStopt(id, stopt) {
  const e = synlige(S.stopeplan).find(x => x.id === id);
  if (!e) return;
  const forrige = vaskEtappeListe(S.stopeplan);
  endreEtappe(id, stopt ? { status: "stopt", stoptDato: e.stoptDato || iDagISO() } : { status: "planlagt", stoptDato: "" });
  const etter = vaskEtappeListe(S.stopeplan);
  if (S.pushAngre) S.pushAngre({
    tekst: stopt ? "Merket som støpt" : "Ikke støpt",
    angre: () => { S.stopeplan = forrige; lagre(); tegnStopeplan(); tegnPanel(); },
    gjenopprett: () => { S.stopeplan = etter; lagre(); tegnStopeplan(); tegnPanel(); }
  });
  tegnPanel();
}

// Tidslinjen bor i stopeplan-tid.js — byggeplass-siden bruker den samme.
export function tegnTidslinje() { tegnTid(erApen()); }
export function settVistPer(dato) { settVist(dato, erApen()); }

// ═══════════ 💧 TRINN 6: VANNTETTINGEN I PANELET ═══════════
// Platelengden for Cemflex (standard 2 m — CEMflex VB 150). Huskes på
// maskinen; den er en egenskap ved produktet som bestilles, ikke ved planen.
const PLATE_NOKKEL = "storm-ifc-stopeplan-cemflex-m";
S.stopePlateM = (() => { try { const v = Number(localStorage.getItem(PLATE_NOKKEL)); return v > 0.2 ? v : 2; } catch (_) { return 2; } })();
function settPlateM(v) {
  const n = Number(String(v).replace(",", "."));
  if (!(n > 0.2 && n < 20)) return;
  S.stopePlateM = n;
  try { localStorage.setItem(PLATE_NOKKEL, String(n)); } catch (_) {}
}
const lm = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " lm";
export function cemflexTekst(c, plateM) {
  return lm(c.lmMedOmlegg) + " " + t("({0} plater à {1} m, {2} skjøter à 5 cm)", c.plater, String(plateM).replace(".", ","), c.skjoter);
}
function vannTotalHtml() {
  let inj = 0; const c = { lm: 0, lmMedOmlegg: 0, plater: 0, skjoter: 0 };
  for (const e of synlige(S.stopeplan)) {
    const v = vannSummer(e, S.stopePlateM);
    inj += v.injeksjon.lm; c.lm += v.cemflex.lm; c.lmMedOmlegg += v.cemflex.lmMedOmlegg; c.plater += v.cemflex.plater; c.skjoter += v.cemflex.skjoter;
  }
  if (!inj && !c.lm) return '<p class="set-hjelp">' + esc(t("Vanntetting: trykk «+ Injeksjon» eller «+ Cemflex» på et felt.")) + "</p>";
  return '<div class="st-vann-sum">' +
    (inj ? '<div><span class="st-vann-prikk" style="background:#f5b800"></span>' + esc(t("Injeksjonsslange")) + ": <b>" + esc(lm(inj)) + "</b></div>" : "") +
    (c.lm ? '<div><span class="st-vann-prikk" style="background:#b8c2cc"></span>' + esc(t("Cemflex-plater")) + ": <b>" + esc(cemflexTekst(c, S.stopePlateM)) + "</b></div>" : "") +
    '<label class="set-hjelp">' + esc(t("Platelengde Cemflex")) + ' <input type="number" id="stPlateM" min="0.5" max="6" step="0.1" value="' + S.stopePlateM + '"> m</label>' +
  "</div>";
}
function vannHtml(e) {
  if (!(e.vanntetting || []).length) return "";
  return e.vanntetting.map(v => {
    const L = vannLengde(v);
    const tekst = v.type === "cemflex"
      ? t("Cemflex-plater") + " · " + cemflexTekst(cemflexPlan(L, v.lukket, S.stopePlateM, CEMFLEX_OMLEGG_M), S.stopePlateM)
      : t("Injeksjonsslange") + " · " + lm(L) + (v.lukket ? " · " + t("hele omkretsen") : "");
    return '<div class="st-vann"><span class="st-vann-prikk" style="background:' + (v.type === "cemflex" ? "#b8c2cc" : "#f5b800") + '"></span>' +
      '<span class="st-vann-tekst">' + esc(tekst) + "</span>" +
      '<button class="st-vann-slett" data-vann="' + esc(v.id) + '" title="' + esc(t("Slett")) + '">' + ikon("slett") + "</button></div>";
  }).join("");
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() { const p = $("stopePanel"); return !!(p && p.classList.contains("open")); }

const STATUS_FARGE = { stopt: "var(--ok)", uke: "var(--warn)", forsinket: "var(--danger)", planlagt: "var(--muted)" };

// Valgt logofil for støpeplanen. Ikke valgt ennå (null): det brukeren har
// valgt i rapportmenyen, så de som alt har satt logo der slipper å gjøre det
// på nytt.
export function stopeLogoFil() {
  const v = S.settings && S.settings.stopeLogo;
  if (v === null || v === undefined) return (S.settings && S.settings.rapLogo) || "";
  return String(v);
}
S.stopeLogoFil = stopeLogoFil;
// Lista hentes én gang per økt (SharePoint), ikke hver gang panelet tegnes
let logoListe = null;
async function fyllStopeLogo(velg) {
  if (!velg) return;
  const valgt = stopeLogoFil();
  const opt = (verdi, tekst) => { const o = document.createElement("option"); o.value = verdi; o.textContent = tekst; return o; };
  velg.innerHTML = "";
  velg.appendChild(opt("", t("Ingen logo")));
  if (valgt) velg.appendChild(opt(valgt, ryddLogonavn(valgt)));
  velg.value = valgt;
  if (!spPaalogget()) return;
  if (!logoListe) logoListe = hentLogoer().catch(() => []);
  let liste = await logoListe;
  if (!liste.length) { logoListe = null; return; }   // prøv igjen neste gang (innlogging kan komme senere)
  if (!velg.isConnected) return;
  for (const l of liste) if (l.fil !== valgt) velg.appendChild(opt(l.fil, ryddLogonavn(l.fil)));
  velg.value = valgt;
}

export function tegnPanel() {
  const body = $("stopeBody");
  if (!body) return;
  const iDag = iDagISO();
  const liste = sortert(S.stopeplan);
  // 👁 Én bryter for hele fargingen (Emil 01.10), øverst i panelet
  let html = '<label class="st-vis"><input type="checkbox" id="stVis"' + (visEtappeplan() ? " checked" : "") + "> " +
      esc(t("Vis etappeplan")) + '<span class="set-hjelp"> — ' + esc(t("farger betongen etter støpeplanen")) + "</span></label>" +
    // 💧 Trinn 6: vanntettingen kan skrus av for seg, og summen står øverst
    '<label class="st-vis"><input type="checkbox" id="stVisVann"' + (visVanntetting() ? " checked" : "") + "> " +
      esc(t("Vis vanntetting")) + "</label>" + vannTotalHtml() +
    '<p class="set-hjelp" style="margin-top:0">' +
    esc(t("Del støpene i etapper. Gi hver etappe en dato, og merk den som støpt når den er ferdig. Trykk «Legg til» på etappen og velg elementene i modellen — også generert betonggulv og ringmur. Trykk «Ferdig» når du er ferdig. «+ Felt» tegner et felt på plata.")) + "</p>" +
    (sisteMelding ? '<p class="set-hjelp" style="color:var(--text)">' + esc(sisteMelding) + "</p>" : "");
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen etapper ennå.")) + "</p>";
  const SF = S.stopeFelt;
  const valgtF = SF ? SF.valgt() : null, tegnerI = SF ? SF.tegner() : null;
  for (const e of liste) {
    const st = statusFor(e, iDag);
    const fs = feltSummer(e);
    const vol = volumFor(e) + fs.volum;
    const innhold = [
      antallElementer(e.elementer.length),
      antallFelt(e.felt.length) + (fs.areal > 0 ? " (" + m2(fs.areal) + ")" : "")
    ].join(" · ") + (vol > 0 ? " · " + m3(vol) : "");
    // 🧱 Feltene (trinn 3): én linje per felt, og målene på det som er valgt
    let feltHtml = "";
    e.felt.forEach((f, k) => {
      const erValgt = f.id === valgtF;
      feltHtml += '<div class="st-felt' + (erValgt ? " valgt" : "") + '" data-felt="' + esc(f.id) + '">' +
        '<button class="st-felt-navn" title="' + esc(t("Vis og juster feltet")) + '">' + esc(t("Felt {0}", k + 1)) + "</button>" +
        '<span class="st-felt-tall">' + esc(m2(feltAreal(f)) + " · " + m3(feltVolum(f))) + "</span>" +
        '<label class="st-felt-tk">' + '<input type="number" class="st-tk" min="50" max="3000" step="10" value="' + Math.round(f.tykkelseM * 1000) + '"> mm</label>' +
        '<button class="st-felt-slett" title="' + esc(t("Slett feltet")) + '">' + ikon("slett") + "</button>" +
        '<span class="st-felt-vann"><button class="st-vann-ny" data-type="injeksjon">' + esc(t("+ Injeksjon")) + "</button>" +
          '<button class="st-vann-ny" data-type="cemflex">' + esc(t("+ Cemflex")) + "</button></span>" +
        (erValgt ? '<div class="st-kanter">' + esc(t("Kanter (m):")) + " " +
          kantLengder(f).map((L, i) => '<input type="number" class="st-kant" data-i="' + i + '" step="0.01" min="0.05" value="' + (Math.round(L * 100) / 100) + '">').join("") +
          '<div class="set-hjelp">' + esc(t("Dra de hvite prikkene (hjørner) eller de gule (kanter). Dra inne i feltet for å flytte det. Dobbeltklikk på en kant gir et nytt hjørne. Delete sletter. Ctrl+Z angrer.")) + "</div></div>" : "") +
      "</div>";
    });
    html += '<div class="st-etappe" data-id="' + esc(e.id) + '" style="border-left:4px solid ' + esc(e.farge) + '">' +
      '<div class="st-rad">' +
        '<input type="color" class="st-farge" value="' + esc(e.farge) + '" title="' + esc(t("Farge")) + '">' +
        '<b class="st-nr">' + e.nr + '</b>' +
        '<input type="text" class="st-navn" maxlength="80" value="' + esc(e.navn) + '">' +
        '<button class="st-slett" title="' + esc(t("Slett etappen")) + '">' + ikon("slett") + "</button>" +
      "</div>" +
      '<div class="st-rad">' +
        '<input type="date" class="st-dato" value="' + esc(e.dato) + '">' +
        // 📅 Trinn 4: BARE knappen merker støpt — datoen alene gjør det aldri
        (e.status === "stopt"
          ? '<span class="st-merke" style="color:' + STATUS_FARGE.stopt + '">' + ikon("hake") + " " +
              esc(e.stoptDato ? t("Støpt {0}", datoKort(e.stoptDato)) : t("Støpt")) + "</span>" +
            '<button class="st-ikke-stopt" title="' + esc(t("Angre «støpt»")) + '">' + esc(t("Angre")) + "</button>"
          : '<button class="st-stopt">' + esc(t("Merk som støpt")) + "</button>" +
            '<span class="st-merke" style="color:' + STATUS_FARGE[st] + '">' + esc(t(STATUS_TEKST[st])) + "</span>") +
      "</div>" +
      '<div class="st-innhold">' + esc(innhold) + "</div>" + feltHtml + vannHtml(e) +
      '<div class="st-rad st-knapper">' +
        '<button class="st-legg' + (velgerEtappe() === e.id ? " aktiv" : "") + '">' +
          esc(velgerEtappe() === e.id ? t("Velger …") : t("+ Legg til")) + "</button>" +
        '<button class="st-nyfelt' + (tegnerI === e.id ? " aktiv" : "") + '">' + esc(tegnerI === e.id ? t("Tegner …") : t("+ Felt")) + "</button>" +
        (e.elementer.length ? '<button class="st-tom">' + esc(t("Tøm")) + "</button>" : "") +
      "</div>" +
    "</div>";
  }
  // 🏷 Logoen på PDF-en: samme SharePoint-mappe (Logoer) og samme originalbilde
  // som rapporten og rigg-objektene, men eget valg — støpeplanen kan gå til en
  // annen byggherre enn rapportene. Står i panelet, rett over PDF-knappen, så
  // brukeren ser hva som kommer med FØR han trykker.
  html += '<label class="set-hjelp st-logo">' + esc(t("Logo på PDF")) + ' <select id="stLogo"></select></label>';
  html += '<div class="prop-actions" style="margin-top:10px"><button id="stNy" class="primary">' + ikon("pluss") + " " + esc(t("Ny etappe")) + "</button>" +
      // 📄 Trinn 7: PDF (oppsett D) og Excel
      '<button id="stPdf"' + (liste.length ? "" : " disabled") + ">" + ikon("lastned") + " " + esc(t("Støpeplan (PDF)")) + "</button>" +
      '<button id="stXlsx"' + (liste.length ? "" : " disabled") + ">" + ikon("lastned") + " " + esc(t("Excel")) + "</button></div>" +
    '<p class="set-hjelp" id="stLagring">' + esc(lagringsTekst()) + "</p>";
  body.innerHTML = html;

  $("stNy").onclick = () => leggTilEtappe();
  $("stPdf").onclick = async () => { const P = await import("./stopeplan-pdf.js"); return P.lagStopeplanPdf(volumFor); };
  $("stXlsx").onclick = async () => { const P = await import("./stopeplan-pdf.js"); return P.lagStopeplanXlsx(volumFor); };
  $("stVis").onchange = (ev) => { settVisEtappeplan(ev.target.checked); tegnTidslinje(); };
  $("stVisVann").onchange = (ev) => settVisVanntetting(ev.target.checked);
  fyllStopeLogo($("stLogo"));
  $("stLogo").onchange = (ev) => { S.settings.stopeLogo = ev.target.value || ""; writePrefs(); };
  const pl = $("stPlateM");
  if (pl) pl.onchange = () => { settPlateM(pl.value); tegnPanel(); };
  tegnTidslinje();
  body.querySelectorAll(".st-etappe").forEach(rad => {
    const id = rad.dataset.id;
    rad.querySelector(".st-navn").onchange = (ev) => endreEtappe(id, { navn: ev.target.value });
    rad.querySelector(".st-dato").onchange = (ev) => { endreEtappe(id, { dato: ev.target.value }); tegnPanel(); };
    const stB = rad.querySelector(".st-stopt"), ikB = rad.querySelector(".st-ikke-stopt");
    if (stB) stB.onclick = () => merkStopt(id, true);
    if (ikB) ikB.onclick = () => merkStopt(id, false);
    // «change», ikke «input»: input fyrer for hvert musetrekk i fargehjulet
    rad.querySelector(".st-farge").onchange = (ev) => { endreEtappe(id, { farge: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-legg").onclick = () => { if (velgerEtappe() === id) avsluttVelg(true); else startVelg(id); };
    rad.querySelector(".st-nyfelt").onclick = () => {
      if (!SF) return;
      if (SF.tegner() === id) SF.avbrytTegning(); else { if (velger) avsluttVelg(false); SF.startTegning(id); }
    };
    rad.querySelectorAll(".st-felt").forEach(fr => {
      const fid = fr.dataset.felt;
      fr.querySelector(".st-felt-navn").onclick = () => SF && SF.velgFelt(SF.valgt() === fid ? null : fid);
      fr.querySelector(".st-felt-slett").onclick = () => SF && SF.slettFelt(fid);
      fr.querySelectorAll(".st-vann-ny").forEach(b => b.onclick = () => SF && SF.startVann(fid, b.dataset.type));
      fr.querySelector(".st-tk").onchange = (ev) => SF && SF.settTykkelse(fid, ev.target.value);
      fr.querySelectorAll(".st-kant").forEach(inp => inp.onchange = (ev) => SF && SF.settKantLengde(fid, Number(inp.dataset.i), Number(ev.target.value)));
    });
    rad.querySelectorAll(".st-vann-slett").forEach(b => b.onclick = () => SF && SF.slettVann(b.dataset.vann));
    const tom = rad.querySelector(".st-tom");
    if (tom) tom.onclick = () => { if (confirm(t("Ta alle elementene ut av etappen?"))) tomElementer(id); };
    rad.querySelector(".st-slett").onclick = () => {
      const e = synlige(S.stopeplan).find(x => x.id === id);
      if (e && confirm(t("Slette {0}?", e.navn))) slettEtappe(id);
    };
  });
}

// ═══════════════════════ KROKER ═══════════════════════
S.lastStopeplan = () => {
  S.stopeplan = lesLokalt();
  volumBuffer.clear();
  sisteMelding = "";
  tegnStopeplan();
  if (erApen()) tegnPanel();
  hentFraSp();          // i bakgrunnen
};
S.ryddStopeplan = () => { if (velger) avsluttVelg(false); if (S.ryddStopeFelt) S.ryddStopeFelt(); S.stopeplan = []; volumBuffer.clear(); tegnStopeplan([]); };

// ⌨ Hurtigtasten «Ny etappe» (N): åpner panelet om det er lukket
S.stopeNyEtappe = () => {
  if (!S.modelGroup) return null;
  if (!$("stopePanel").classList.contains("open")) $("btnStopeplan").click();
  const e = leggTilEtappe();
  const felt = document.querySelector('.st-etappe[data-id="' + e.id + '"] .st-navn');
  if (felt) { if (felt.scrollIntoView) felt.scrollIntoView({ block: "nearest" }); felt.focus(); felt.select(); }
  return e;
};

på("btnStopeplan", "click", () => {
  const panel = $("stopePanel");
  if (panel.classList.contains("open")) {
    if (velger) avsluttVelg(false);
    if (S.ryddStopeFelt) S.ryddStopeFelt();
    panel.classList.remove("open"); return;
  }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("stopePanel");
  tegnTidslinje();
});

// Panelet lukkes på flere måter (krysset, et annet panel som åpnes, Esc).
// Da skal tidslinjen, en halvferdig tegning og håndtakene bort — og modellen
// tilbake til i dag. Derfor følges klassen, ikke bare knappen vår.
(() => {
  const p = $("stopePanel");
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!p || !MO) return;
  let varApen = p.classList.contains("open");
  new MO(() => {
    const naa = p.classList.contains("open");
    if (naa === varApen) return;
    varApen = naa;
    if (!naa) {
      if (velger) avsluttVelg(false);
      if (S.ryddStopeFelt) S.ryddStopeFelt();
    }
    tegnTidslinje();
  }).observe(p, { attributes: true, attributeFilter: ["class"] });
})();
