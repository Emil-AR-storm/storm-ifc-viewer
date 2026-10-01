// 📅 Framdriftsplan — VERKTØYET (kontor). Trinn 1–2: etappene, panelet,
// lagringen og «Legg til» for ALLE slags objekter.
// Byggeplan: «Storm IFC-Viewer byggeplan Framdriftsplan 2026-10-01.md».
//
// Samme oppbygning som støpeplanen (stopeplan.js) med vilje — Emil: «det
// bruker samme system som støpeplan-verktøyet». LAGRING lokalt FØRST, så
// SharePoint-mappa «Framdriftsplan», én fil per modell; `endret` på etappen
// avgjør flettingen, og en slettet etappe blir en gravstein.
//
// HVA SOM KAN LEGGES TIL (Emil: «alle objekt i modellen veggelement,
// stålbygg, takplater, ringmur, dekke/betonggulv, rigg objekt, materiell
// objekt osv.»). Velgemodusen bruker det samme utvalget som resten av appen:
//   · IFC-elementer: S.multiSel / det ene elementet som er trykket på
//   · lagene som kan flervalg (SW-elementer og ringmur/gulv, takplater):
//     ekstraLagSom("valgte") — laget melder seg inn selv
//   · materiell (også stålbunker og fagverk): S.multiSelMat
//   · rigg: eget utvalg her — rigg.js gir oss klikket via S.riggIVelgModus
//
// Importeres BARE fra main.js.
import { $, S, apnePanel, ekstraLagSom, esc, ikon, på, writePrefs } from "./state.js";
import { hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import { t, tn } from "./i18n.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import { clearSelection, veksleMateriellIUtvalg } from "./elements.js";
import { metaFor } from "./ifcrpc.js";
import { SLAG_NAVN, fjern, leggTil, nokkel, nyEtappe, sortert, synlige, tellingPerSlag, tidsSpenn, vaskEtappe, vaskEtappeListe } from "./framdrift-regn.js";
import { ryddFramdriftVis, stoppAvspilling, tegnFramdrift, tegnTidslinje } from "./framdrift-vis.js";

const SP_MAPPE = "Framdriftsplan";
let spStatus = "av", lagreTid = 0;
S.framdrift = S.framdrift || [];

function lsNokkel() { return "storm-ifc-framdrift::" + S.fileName; }
function spFil() { return S.fileName + ".framdrift.json"; }
function mittNavn() {
  try { const acc = S.msalApp && S.msalApp.getActiveAccount(); return (acc && (acc.name || acc.username)) || ""; }
  catch (_) { return ""; }
}
function lesLokalt() {
  try { return vaskEtappeListe(JSON.parse(localStorage.getItem(lsNokkel()) || "[]")); } catch (_) { return []; }
}
function lagreLokalt() {
  try { localStorage.setItem(lsNokkel(), JSON.stringify(vaskEtappeListe(S.framdrift))); } catch (_) {}
}
// Skriving samles (navnet skrives tegn for tegn); lokalt lagres det med en gang.
export function lagre() {
  lagreLokalt();
  clearTimeout(lagreTid);
  lagreTid = setTimeout(skrivSp, 600);
}
async function skrivSp() {
  if (!spPaalogget()) { spStatus = "av"; visLagring(); return; }
  const forFil = S.fileName;
  const res = await spSkriv(SP_MAPPE, spFil(), vaskEtappeListe(S.framdrift), (e) => String(e && e.id || ""));
  if (S.fileName !== forFil) return;
  spStatus = res.ok ? "ok" : "feil";
  if (res.ok && res.liste) { S.framdrift = vaskEtappeListe(res.liste); lagreLokalt(); if (erApen()) tegnPanel(); }
  else visLagring();
}
async function hentFraSp() {
  if (!spPaalogget()) { spStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(SP_MAPPE, spFil());
  if (S.fileName !== forFil) return;
  spStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (spStatus === "ok") {
    S.framdrift = vaskEtappeListe(flettPaaId(vaskEtappeListe(S.framdrift), vaskEtappeListe(res.liste)));
    lagreLokalt();
  }
  if (erApen()) tegnPanel();
}
function lagringsTekst() {
  if (spStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (spStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Trykk på den røde prikken øverst til høyre og logg inn for å dele med de andre.");
}
function visLagring() { const el = $("fpLagring"); if (el) el.textContent = lagringsTekst(); }

// ═══════════════════════ ETAPPENE ═══════════════════════
export function endreEtappe(id, endring) {
  const naa = new Date().toISOString();
  S.framdrift = vaskEtappeListe(S.framdrift).map(e =>
    e.id === id ? vaskEtappe(Object.assign({}, e, endring, { endret: naa, av: mittNavn() })) : e);
  lagre();
}
export function leggTilEtappe() {
  const e = nyEtappe(S.framdrift);
  e.av = mittNavn();
  S.framdrift = vaskEtappeListe(S.framdrift).concat([e]);
  lagre(); tegnPanel();
  return e;
}
export function slettEtappe(id) {
  const naa = new Date().toISOString();
  S.framdrift = vaskEtappeListe(S.framdrift).map(e => e.id === id ? { id, slettet: true, endret: naa } : e);
  lagre(); tegnPanel();
}
export function tomEtappe(id) {
  S.framdrift = fjern(S.framdrift, id, null, new Date().toISOString());
  sisteMelding = ""; lagre(); tegnPanel();
}

// ═══════════════════════ UTVALGET ═══════════════════════
// Rigg har ikke flervalg i resten av appen — det holdes her mens modusen er på.
const riggUtvalg = new Set();
S.riggFlervalg = riggUtvalg;          // rigg-vis.js maler dem blå (valgt)
// Alt som er valgt akkurat nå, som nøkler { k, gid? }.
export function valgteObjekter() {
  const ut = [];
  const ider = (S.multiSel && S.multiSel.size) ? [...S.multiSel.keys()] : (S.currentPropID != null ? [S.currentPropID] : []);
  for (const n of ider.map(Number).filter(n => n > 0)) {
    const m = metaFor(n);
    const o = { k: nokkel("id", n) };
    if (m && m.globalId) o.gid = m.globalId;
    ut.push(o);
  }
  for (const l of ekstraLagSom("valgte")) {
    if (!l.flervalg || (l.id !== "sw" && l.id !== "tak")) continue;
    for (const id of l.valgte()) { const k = nokkel(l.id, id); if (k) ut.push({ k }); }
  }
  const mat = new Set([...(S.multiSelMat || [])]);
  if (S.materiellValgtId) mat.add(S.materiellValgtId);
  for (const id of mat) { const k = nokkel("mat", id); if (k) ut.push({ k }); }
  for (const id of riggUtvalg) { const k = nokkel("rigg", id); if (k) ut.push({ k }); }
  return ut.filter(o => o.k);
}

let sisteMelding = "";
export function leggValgteTil(id) {
  const nye = valgteObjekter();
  if (!nye.length) return 0;
  const r = leggTil(S.framdrift, id, nye, new Date().toISOString());
  S.framdrift = r.liste.map(e => e.id === id ? Object.assign(e, { av: mittNavn() }) : e);
  const e = synlige(S.framdrift).find(x => x.id === id);
  sisteMelding = r.flyttet
    ? tn(r.lagtTil, "{0} objekt lagt i {1}. Det er flyttet fra et annet trinn.", "{0} objekter lagt i {1}. {2} av dem er flyttet fra et annet trinn.", e ? e.navn : "", r.flyttet)
    : tn(r.lagtTil, "{0} objekt lagt i {1}.", "{0} objekter lagt i {1}.", e ? e.navn : "");
  lagre();
  return r.lagtTil;
}

// ═══════════ «LEGG TIL»: VELGEMODUSEN (som støpeplanen) ═══════════
// Hvert trykk i modellen legger til eller tar bort (shift-dra for mange).
// Panelet blir stående; «Ferdig» legger utvalget i etappen, «Avbryt» eller Esc
// lar etappen være. Rigg-objektene kommer via kroken under.
let velger = null;
let forrigeKroker = null;     // støpeplanens kroker, tilbake når modusen avsluttes
export const velgerEtappe = () => (velger ? velger.etappeId : null);
S.riggIVelgModus = null;
S.materiellIVelgModus = null;

function velgBar() {
  let el = $("fpVelgBar");
  if (!el) { el = document.createElement("div"); el.id = "fpVelgBar"; el.className = "st-velgbar fp-velgbar"; document.body.appendChild(el); }
  return el;
}
function tegnVelgBar() {
  const el = velgBar();
  if (!velger) { el.style.display = "none"; el.innerHTML = ""; return; }
  const e = synlige(S.framdrift).find(x => x.id === velger.etappeId);
  const n = valgteObjekter().length;
  el.style.display = "flex";
  el.innerHTML =
    '<span class="st-velg-farge" style="background:' + esc(e ? e.farge : "#888") + '"></span>' +
    '<span class="st-velg-tekst"><b>' + esc(t("Legg til i {0}", e ? e.navn : "")) + "</b><br>" +
      esc(t("Trykk på det som skal med — elementer, SW, takplater, rigg og materiell. Shift + dra for mange på en gang.")) + "</span>" +
    '<span class="st-velg-ant">' + esc(t("{0} valgt", n)) + "</span>" +
    '<button id="fpVelgFerdig" class="primary"' + (n ? "" : " disabled") + ">" + esc(t("Ferdig")) + "</button>" +
    '<button id="fpVelgAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("fpVelgFerdig").onclick = () => avsluttVelg(true);
  $("fpVelgAvbryt").onclick = () => avsluttVelg(false);
}
export function startVelg(etappeId) {
  if (velger) avsluttVelg(false);
  if (S.avsluttVelgModus && S.velgModusAktiv) S.avsluttVelgModus();     // støpeplanens modus
  velger = { etappeId };
  S.velgModusAktiv = true;
  riggUtvalg.clear();
  S.materiellIVelgModus = (id) => { veksleMateriellIUtvalg(id); tegnVelgBar(); };
  S.riggIVelgModus = (riggId) => {
    if (riggUtvalg.has(riggId)) riggUtvalg.delete(riggId); else riggUtvalg.add(riggId);
    if (S.oppdaterRiggValg) S.oppdaterRiggValg();
    tegnVelgBar();
  };
  // Krokene elements.js kaller i velgemodus er støpeplanens til vanlig —
  // de lånes mens denne modusen er på, og gis tilbake etterpå.
  forrigeKroker = { o: S.velgModusOppdater, a: S.avsluttVelgModus };
  S.velgModusOppdater = () => tegnVelgBar();
  S.avsluttVelgModus = () => avsluttVelg(false);
  sisteMelding = "";
  tegnVelgBar(); tegnPanel();
}
export function avsluttVelg(medTil) {
  if (!velger) return 0;
  const id = velger.etappeId;
  const n = medTil ? leggValgteTil(id) : 0;
  velger = null;
  S.velgModusAktiv = false;
  S.riggIVelgModus = null;
  S.materiellIVelgModus = null;
  if (forrigeKroker) { S.velgModusOppdater = forrigeKroker.o; S.avsluttVelgModus = forrigeKroker.a; forrigeKroker = null; }
  riggUtvalg.clear();
  if (S.oppdaterRiggValg) S.oppdaterRiggValg();
  // Utvalget var modusens arbeidsliste — det skal ikke henge igjen etterpå
  clearSelection();
  tegnVelgBar(); tegnPanel();
  return n;
}
window.addEventListener("keydown", (ev) => {
  if (velger && ev.key === "Escape") { ev.stopPropagation(); avsluttVelg(false); }
}, true);
// Telleren følger utvalget uten at hele panelet tegnes på nytt
window.addEventListener("pointerup", () => setTimeout(() => { if (velger) tegnVelgBar(); }, 0));
window.addEventListener("keyup", () => setTimeout(() => { if (velger) tegnVelgBar(); }, 0));

// ═══════════════════════ LOGOEN PÅ PDF-EN ═══════════════════════
// Samme mønster som støpeplanen og riggplanen: eget valg, rapportens som
// reserve (null), "" = ingen logo. Originalbildet fra SharePoint (Logoer).
export function framdriftLogoFil() {
  const v = S.settings && S.settings.framdriftLogo;
  if (v === null || v === undefined) return (S.settings && S.settings.rapLogo) || "";
  return String(v);
}
S.framdriftLogoFil = framdriftLogoFil;
let logoListe = null;
async function fyllLogo(velg) {
  if (!velg) return;
  const valgt = framdriftLogoFil();
  const opt = (verdi, tekst) => { const o = document.createElement("option"); o.value = verdi; o.textContent = tekst; return o; };
  velg.innerHTML = "";
  velg.appendChild(opt("", t("Ingen logo")));
  if (valgt) velg.appendChild(opt(valgt, ryddLogonavn(valgt)));
  velg.value = valgt;
  if (!spPaalogget()) return;
  if (!logoListe) logoListe = hentLogoer().catch(() => []);
  const liste = await logoListe;
  if (!liste.length) { logoListe = null; return; }
  if (!velg.isConnected) return;
  for (const l of liste) if (l.fil !== valgt) velg.appendChild(opt(l.fil, ryddLogonavn(l.fil)));
  velg.value = valgt;
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() { const p = $("framdriftPanel"); return !!(p && p.classList.contains("open")); }
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };
// «1 element», «2 elementer» — entall og flertall på alle språk
const ANTALL = {
  id: (n) => tn(n, "{0} element", "{0} elementer"),
  sw: (n) => tn(n, "{0} SW-element", "{0} SW-elementer"),
  tak: (n) => tn(n, "{0} takplate", "{0} takplater"),
  mat: (n) => t("{0} materiell", n),
  rigg: (n) => t("{0} rigg", n)
};
export function innholdTekst(e) {
  const deler = tellingPerSlag(e).map(x => ANTALL[x.slag] ? ANTALL[x.slag](x.antall) : x.antall + " " + t(SLAG_NAVN[x.slag]).toLowerCase());
  return deler.length ? deler.join(" · ") : t("Ingenting lagt til ennå");
}

export function tegnPanel() {
  const body = $("framdriftBody");
  if (!body) return;
  const liste = sortert(S.framdrift);
  let html = '<p class="set-hjelp" style="margin-top:0">' +
    esc(t("Del arbeidet i trinn med dato. Trykk «Legg til» på trinnet og velg det som utføres da — elementer, SW-elementer, takplater, rigg og materiell. Trykk «Ferdig» når du er ferdig.")) + "</p>" +
    (sisteMelding ? '<p class="set-hjelp" style="color:var(--text)">' + esc(sisteMelding) + "</p>" : "");
  if (liste.length) html += '<label class="set-hjelp fp-vis"><input type="checkbox" id="fpVis"' + (S.framdriftVis !== false ? " checked" : "") + "> " +
    esc(t("Vis framdriften i modellen — dra glideren nederst")) + "</label>" +
    (tidsSpenn(liste) ? "" : '<p class="hint">' + esc(t("Sett «Fra»-dato på trinnene for å få glideren.")) + "</p>");
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen trinn ennå.")) + "</p>";
  for (const e of liste) {
    const velgerHer = velgerEtappe() === e.id;
    html += '<div class="st-etappe fp-etappe" data-id="' + esc(e.id) + '" style="border-left:4px solid ' + esc(e.farge) + '">' +
      '<div class="st-rad">' +
        '<input type="color" class="st-farge" value="' + esc(e.farge) + '" title="' + esc(t("Farge")) + '">' +
        '<b class="st-nr">' + e.nr + "</b>" +
        '<input type="text" class="st-navn" maxlength="80" value="' + esc(e.navn) + '">' +
        '<button class="st-slett" title="' + esc(t("Slett trinnet")) + '">' + ikon("slett") + "</button>" +
      "</div>" +
      '<div class="st-rad fp-datoer">' +
        '<label class="fp-dato">' + esc(t("Fra")) + ' <input type="date" class="fp-fra" value="' + esc(e.dato) + '"></label>' +
        '<label class="fp-dato">' + esc(t("Til")) + ' <input type="date" class="fp-til" value="' + esc(e.slutt) + '"></label>' +
      "</div>" +
      '<div class="st-innhold">' + esc(innholdTekst(e)) + "</div>" +
      '<div class="st-rad st-knapper">' +
        '<button class="st-legg' + (velgerHer ? " aktiv" : "") + '">' + esc(velgerHer ? t("Velger …") : t("+ Legg til")) + "</button>" +
        (e.objekter.length ? '<button class="st-tom">' + esc(t("Tøm")) + "</button>" : "") +
      "</div></div>";
  }
  html += '<label class="set-hjelp st-logo">' + esc(t("Logo på PDF")) + ' <select id="fpLogo"></select></label>' +
    '<div class="prop-actions" style="margin-top:10px"><button id="fpNy" class="primary">' + ikon("pluss") + " " + esc(t("Nytt trinn")) + "</button></div>" +
    '<p class="set-hjelp" id="fpLagring">' + esc(lagringsTekst()) + "</p>";
  body.innerHTML = html;

  $("fpNy").onclick = () => leggTilEtappe();
  if ($("fpVis")) $("fpVis").onchange = (ev) => { S.framdriftVis = ev.target.checked; oppdaterVis(); };
  fyllLogo($("fpLogo"));
  $("fpLogo").onchange = (ev) => { S.settings.framdriftLogo = ev.target.value || ""; writePrefs(); };
  body.querySelectorAll(".fp-etappe").forEach(rad => {
    const id = rad.dataset.id;
    rad.querySelector(".st-navn").onchange = (ev) => endreEtappe(id, { navn: ev.target.value });
    rad.querySelector(".fp-fra").onchange = (ev) => { endreEtappe(id, { dato: ev.target.value }); tegnPanel(); };
    rad.querySelector(".fp-til").onchange = (ev) => { endreEtappe(id, { slutt: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-farge").onchange = (ev) => { endreEtappe(id, { farge: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-legg").onclick = () => { if (velgerEtappe() === id) avsluttVelg(true); else startVelg(id); };
    const tom = rad.querySelector(".st-tom");
    if (tom) tom.onclick = () => { if (confirm(t("Ta alt ut av trinnet?"))) tomEtappe(id); };
    rad.querySelector(".st-slett").onclick = () => {
      const e = synlige(S.framdrift).find(x => x.id === id);
      if (e && confirm(t("Slette {0}?", e.navn))) slettEtappe(id);
    };
  });
  oppdaterVis();
}

// 📅 Glideren (trinn 3, js/framdrift-vis.js): på når panelet er åpent og
// avkrysset — men AV mens du velger, ellers kunne du ikke trykke på det som
// ennå ikke er bygget.
function oppdaterVis() {
  const paa = erApen() && S.framdriftVis !== false && !velger;
  if (!paa) stoppAvspilling();
  tegnFramdrift(paa);
  tegnTidslinje(paa);
}

// ═══════════════════════ KROKER ═══════════════════════
S.lastFramdrift = () => {
  ryddFramdriftVis();
  S.framdrift = lesLokalt();
  sisteMelding = "";
  if (erApen()) tegnPanel();
  hentFraSp();
};
S.ryddFramdrift = () => { if (velger) avsluttVelg(false); ryddFramdriftVis(); S.framdrift = []; };

på("btnFramdrift", "click", () => {
  const panel = $("framdriftPanel");
  if (panel.classList.contains("open")) { if (velger) avsluttVelg(false); panel.classList.remove("open"); oppdaterVis(); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("framdriftPanel");
  oppdaterVis();
});
// Lukkes panelet på en annen måte (krysset, et annet panel, Esc): velgemodusen av
(() => {
  const p = $("framdriftPanel");
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!p || !MO) return;
  let varApen = p.classList.contains("open");
  new MO(() => {
    const naa = p.classList.contains("open");
    if (naa === varApen) return;
    varApen = naa;
    if (!naa && velger) avsluttVelg(false);
    if (!naa) oppdaterVis();
  }).observe(p, { attributes: true, attributeFilter: ["class"] });
})();
