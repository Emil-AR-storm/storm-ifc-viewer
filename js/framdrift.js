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
import { PROSJEKT_LOGO, erStandardLogo, fraLogoValg } from "./prosjektinfo-regn.js";
import { $, S, apnePanel, ekstraLagSom, esc, ikon, på, writePrefs } from "./state.js";
import { markerGroup } from "./scene.js";
import { hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import { t, tn } from "./i18n.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import { clearSelection, veksleMateriellIUtvalg } from "./elements.js";
import { metaFor } from "./ifcrpc.js";
import { SLAG_NAVN, etappeForNokkel, pdfTrinn, fjern, leggTil, nokkel, nyEtappe, sortert, synlige, tellingPerSlag, tidsSpenn, vaskEtappe, vaskEtappeListe } from "./framdrift-regn.js";
import { begrensListe, forberedMobilPanel, ryddFramdriftVis, settSkjulTildelte, stoppAvspilling, tegnFramdrift, tegnTidslinje } from "./framdrift-vis.js";
import { LAG_ID as TRP_BLIKK_LAG } from "./framdrift-plukk.js";
import { forberedKilder, nullstillKilder } from "./framdrift-kilde.js";
import { varsel } from "./varsel.js";

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
// 📌 Markeringer valgt i «Legg til» (comment-id). Uthevet med blå boble.
const markUtvalg = new Set();
function markEffekt() {
  const m = new Set([...markUtvalg].map(String));
  for (const s of markerGroup.children) {
    const paa = m.has(String(s.userData.commentId));
    if (paa && !s.userData.fpValgMat) {
      s.userData.fpValgOrig = s.material;
      s.userData.fpValgMat = s.material.clone();
      s.userData.fpValgMat.color.set(0x3b82f6);
      s.material = s.userData.fpValgMat;
    } else if (!paa && s.userData.fpValgMat) {
      if (s.material === s.userData.fpValgMat) s.material = s.userData.fpValgOrig;
      s.userData.fpValgMat.dispose();
      delete s.userData.fpValgMat; delete s.userData.fpValgOrig;
    }
  }
}
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
    if (!l.flervalg) continue;
    // Generert blikk og TRP-plater (framdrift-plukk.js): id-ene er hele nøkler
    if (l.id === TRP_BLIKK_LAG) { for (const k of l.valgte()) if (/^(tak|blikk):/.test(k)) ut.push({ k }); continue; }
    if (l.id !== "sw" && l.id !== "tak") continue;
    for (const id of l.valgte()) { const k = nokkel(l.id, id); if (k) ut.push({ k }); }
  }
  const mat = new Set([...(S.multiSelMat || [])]);
  if (S.materiellValgtId) mat.add(S.materiellValgtId);
  for (const id of mat) { const k = nokkel("mat", id); if (k) ut.push({ k }); }
  for (const id of riggUtvalg) { const k = nokkel("rigg", id); if (k) ut.push({ k }); }
  for (const id of markUtvalg) { const k = nokkel("mark", id); if (k) ut.push({ k }); }
  // «Legg til»: det som allerede ligger i et trinn, kan ikke legges inn på
  // nytt. «Fjern»: bare det som ligger i DETTE trinnet kan tas ut (Emil 01.10).
  const sett = new Set();
  return ut.filter(o => o.k && !sett.has(o.k) && sett.add(o.k) && tillatt(o.k));
}
// Hva velgemodusen kan ta med akkurat nå
function tillatt(k) {
  if (velger && velger.fjern) { const e = etappeForNokkel(S.framdrift, k); return !!e && e.id === velger.etappeId; }
  return !tildelt(k);
}
// Ligger objektet allerede i et trinn?
export function tildelt(k) { return !!etappeForNokkel(S.framdrift, k); }

let sisteMelding = "";
// «Fjern»: ta utvalget ut av trinnet igjen (feiltrykk, eller det hører til et annet trinn)
export function fjernValgteFra(id) {
  const ut = valgteObjekter().map(o => o.k);
  if (!ut.length) return 0;
  S.framdrift = fjern(S.framdrift, id, ut, new Date().toISOString())
    .map(e => e.id === id ? Object.assign(e, { av: mittNavn() }) : e);
  const e = synlige(S.framdrift).find(x => x.id === id);
  sisteMelding = tn(ut.length, "{0} objekt tatt ut av {1}.", "{0} objekter tatt ut av {1}.", e ? e.navn : "");
  lagre();
  return ut.length;
}
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
export const velgerFjerner = () => !!(velger && velger.fjern);
S.framdriftVelger = () => !!velger;
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
    '<span class="st-velg-tekst"><b>' + esc(velger.fjern ? t("Ta ut av {0}", e ? e.navn : "") : t("Legg til i {0}", e ? e.navn : "")) + "</b><br>" +
      esc(velger.fjern
        ? t("Trykk på det som skal ut av trinnet. Bare det som ligger i trinnet kan velges; det som ligger i andre trinn er skjult. Shift + dra for mange på en gang.")
        : t("Trykk på det som skal med — elementer, SW, takplater, blikk, rigg, materiell og markeringer. Det som allerede ligger i et trinn, er skjult. Shift + dra for mange på en gang.")) + "</span>" +
    '<span class="st-velg-ant">' + esc(t("{0} valgt", n)) + "</span>" +
    '<button id="fpVelgFerdig" class="primary"' + (n ? "" : " disabled") + ">" + esc(velger.fjern ? t("Ta ut") : t("Ferdig")) + "</button>" +
    '<button id="fpVelgAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("fpVelgFerdig").onclick = () => avsluttVelg(true);
  $("fpVelgAvbryt").onclick = () => avsluttVelg(false);
}
export function startVelg(etappeId, fjernModus) {
  if (velger) avsluttVelg(false);
  if (S.avsluttVelgModus && S.velgModusAktiv) S.avsluttVelgModus();     // støpeplanens modus
  velger = { etappeId, fjern: !!fjernModus };
  S.velgModusAktiv = true;
  riggUtvalg.clear();
  S.materiellIVelgModus = (id) => { if (!tillatt(nokkel("mat", id))) return; veksleMateriellIUtvalg(id); tegnVelgBar(); };
  S.velgModusBlokkert = (k) => !tillatt(k);
  markUtvalg.clear();
  S.markeringIVelgModus = (id) => {
    if (!tillatt(nokkel("mark", id))) return;
    if (markUtvalg.has(id)) markUtvalg.delete(id); else markUtvalg.add(id);
    markEffekt(); tegnVelgBar();
  };
  S.riggIVelgModus = (riggId) => {
    if (!tillatt(nokkel("rigg", riggId))) return;
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
  const n = !medTil ? 0 : velger.fjern ? fjernValgteFra(id) : leggValgteTil(id);
  velger = null;
  S.velgModusAktiv = false;
  S.riggIVelgModus = null;
  S.materiellIVelgModus = null;
  S.velgModusBlokkert = null;
  S.markeringIVelgModus = null;
  markUtvalg.clear(); markEffekt();
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
  // 🗂 Ikke valgt / «Prosjektets logo»: logoen fra Prosjektinfo (Innstillinger)
  if (erStandardLogo(v)) return S.standardLogoFil ? S.standardLogoFil() : ((S.settings && S.settings.rapLogo) || "");
  return String(v);
}
S.framdriftLogoFil = framdriftLogoFil;
let logoListe = null;
async function fyllLogo(velg) {
  if (!velg) return;
  const valgt = framdriftLogoFil();
  const vis = erStandardLogo(S.settings && S.settings.framdriftLogo) ? PROSJEKT_LOGO : valgt;
  const opt = (verdi, tekst) => { const o = document.createElement("option"); o.value = verdi; o.textContent = tekst; return o; };
  velg.innerHTML = "";
  velg.appendChild(opt(PROSJEKT_LOGO, t("Prosjektets logo") + (valgt && vis === PROSJEKT_LOGO ? " (" + ryddLogonavn(valgt) + ")" : "")));
  velg.appendChild(opt("", t("Ingen logo")));
  if (valgt) velg.appendChild(opt(valgt, ryddLogonavn(valgt)));
  velg.value = vis;
  if (!spPaalogget()) return;
  if (!logoListe) logoListe = hentLogoer().catch(() => []);
  const liste = await logoListe;
  if (!liste.length) { logoListe = null; return; }
  if (!velg.isConnected) return;
  for (const l of liste) if (l.fil !== valgt) velg.appendChild(opt(l.fil, ryddLogonavn(l.fil)));
  velg.value = vis;
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() { const p = $("framdriftPanel"); return !!(p && p.classList.contains("open")); }
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };
// «1 element», «2 elementer» — entall og flertall på alle språk
const ANTALL = {
  id: (n) => tn(n, "{0} element", "{0} elementer"),
  sw: (n) => tn(n, "{0} SW-element", "{0} SW-elementer"),
  tak: (n) => tn(n, "{0} takplate", "{0} takplater"),
  blikk: (n) => t("{0} blikk", n),
  mat: (n) => t("{0} materiell", n),
  rigg: (n) => t("{0} rigg", n),
  mark: (n) => tn(n, "{0} markering", "{0} markeringer")
};
export function innholdTekst(e) {
  const deler = tellingPerSlag(e).map(x => ANTALL[x.slag] ? ANTALL[x.slag](x.antall) : x.antall + " " + t(SLAG_NAVN[x.slag]).toLowerCase());
  return deler.length ? deler.join(" · ") : t("Ingenting lagt til ennå");
}

export function tegnPanel() {
  const body = $("framdriftBody");
  if (!body) return;
  const liste = sortert(S.framdrift);
  // Forklaringen står åpen til det finnes trinn — så er den én linje du kan
  // trykke på, og trinnene får plassen (Emil 02.10: panelet var for stort)
  const forklaring = esc(t("Del arbeidet i trinn med dato. Trykk «Legg til» på trinnet og velg det som utføres da — elementer, SW-elementer, takplater, blikk, rigg, materiell og markeringer. Trykk «Ferdig» når du er ferdig. Kom noe med ved en feil, tar «− Fjern» det ut igjen."));
  let html = (liste.length
    ? '<details class="set-hjelp fp-hjelp"><summary>' + esc(t("Slik bruker du framdriftsplanen")) + "</summary>" + forklaring + "</details>"
    : '<p class="set-hjelp" style="margin-top:0">' + forklaring + "</p>") +
    (sisteMelding ? '<p class="set-hjelp" style="color:var(--text)">' + esc(sisteMelding) + "</p>" : "");
  if (liste.length) html += '<label class="set-hjelp fp-vis"><input type="checkbox" id="fpVis"' + (S.framdriftVis !== false ? " checked" : "") + "> " +
    esc(t("Vis framdriften i modellen — dra glideren nederst")) + "</label>" +
    // 🌦 Samme bryter som i Vis vær — været på tidslinja, her og på byggeplassen
    '<label class="set-hjelp fp-vis"><input type="checkbox" id="fpVaer"' + (S.settings && S.settings.vaerPaa ? " checked" : "") + "> " +
    esc(t("Vis været på tidslinja (varsel ved storm, mye regn, sterk vind og frost)")) + "</label>" +
    (tidsSpenn(liste) ? "" : '<p class="hint">' + esc(t("Sett «Fra»-dato på trinnene for å få glideren.")) + "</p>");
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen trinn ennå.")) + "</p>";
  html += '<div class="fp-liste" id="fpListe">';
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
      '<div class="st-rad st-knapper fp-knapper"><span class="st-innhold">' + esc(innholdTekst(e)) + "</span>" +
        '<button class="st-legg' + (velgerHer && !velgerFjerner() ? " aktiv" : "") + '">' + esc(velgerHer && !velgerFjerner() ? t("Velger …") : t("+ Legg til")) + "</button>" +
        (e.objekter.length ? '<button class="st-fjern' + (velgerHer && velgerFjerner() ? " aktiv" : "") + '" title="' + esc(t("Ta enkeltobjekter ut av trinnet igjen")) + '">' +
          esc(velgerHer && velgerFjerner() ? t("Velger …") : t("− Fjern")) + "</button>" : "") +
        (e.objekter.length ? '<button class="st-tom">' + esc(t("Tøm")) + "</button>" : "") +
      "</div></div>";
  }
  html += "</div>";
  html += '<label class="set-hjelp st-logo">' + esc(t("Logo på PDF")) + ' <select id="fpLogo"></select></label>' +
    '<div class="prop-actions" style="margin-top:10px"><button id="fpNy" class="primary">' + ikon("pluss") + " " + esc(t("Nytt trinn")) + "</button>" +
      '<button id="fpPdf"' + (pdfTrinn(S.framdrift).length ? "" : " disabled") + ' title="' + esc(t("Én side per trinn: bygget sett fra nord, sør, øst og vest, og det som er nytt i trinnet")) + '">' +
      ikon("lastned") + " " + esc(t("Last ned PDF")) + "</button>" +
      '<button id="fpVideo"' + (pdfTrinn(S.framdrift).length ? "" : " disabled") + ' title="' + esc(t("Kameraet går én gang rundt bygget mens trinnene bygges opp. Lagres i SharePoint, så PDF-en får en QR-kode til videoen.")) + '">' +
      ikon("lastned") + " " + esc(t("Lag video")) + "</button></div>" +
    '<p class="set-hjelp" id="fpLagring">' + esc(lagringsTekst()) + "</p>";
  body.innerHTML = html;

  $("fpNy").onclick = () => leggTilEtappe();
  $("fpPdf").onclick = () => lastNedPdf();
  $("fpVideo").onclick = () => lagVideo();
  if ($("fpVis")) $("fpVis").onchange = (ev) => { S.framdriftVis = ev.target.checked; oppdaterVis(); };
  if ($("fpVaer")) $("fpVaer").onchange = (ev) => {
    S.settings.vaerPaa = !!ev.target.checked; writePrefs();
    try { document.dispatchEvent(new CustomEvent("storm-vaer")); } catch (_) {}
  };
  fyllLogo($("fpLogo"));
  $("fpLogo").onchange = (ev) => { S.settings.framdriftLogo = fraLogoValg(ev.target.value); writePrefs(); };
  body.querySelectorAll(".fp-etappe").forEach(rad => {
    const id = rad.dataset.id;
    rad.querySelector(".st-navn").onchange = (ev) => endreEtappe(id, { navn: ev.target.value });
    rad.querySelector(".fp-fra").onchange = (ev) => { endreEtappe(id, { dato: ev.target.value }); tegnPanel(); };
    rad.querySelector(".fp-til").onchange = (ev) => { endreEtappe(id, { slutt: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-farge").onchange = (ev) => { endreEtappe(id, { farge: ev.target.value }); tegnPanel(); };
    rad.querySelector(".st-legg").onclick = () => { if (velgerEtappe() === id && !velgerFjerner()) avsluttVelg(true); else startVelg(id); };
    const fj = rad.querySelector(".st-fjern");
    if (fj) fj.onclick = () => { if (velgerEtappe() === id && velgerFjerner()) avsluttVelg(true); else startVelg(id, true); };
    const tom = rad.querySelector(".st-tom");
    if (tom) tom.onclick = () => { if (confirm(t("Ta alt ut av trinnet?"))) tomEtappe(id); };
    rad.querySelector(".st-slett").onclick = () => {
      const e = synlige(S.framdrift).find(x => x.id === id);
      if (e && confirm(t("Slette {0}?", e.navn))) slettEtappe(id);
    };
  });
  begrensListe($("fpListe"));
  oppdaterVis();
}

// 📅 Glideren (trinn 3, js/framdrift-vis.js): på når panelet er åpent og
// avkrysset — men AV mens du velger, ellers kunne du ikke trykke på det som
// ennå ikke er bygget.
function oppdaterVis() {
  // «Legg til»: alt som allerede ligger i et trinn skjules, så det ikke kan
  // markeres på nytt — glideren og tidslinja er av så lenge (Emil 01.10)
  if (velger && erApen()) {
    stoppAvspilling();
    settSkjulTildelte(true, velger.fjern ? velger.etappeId : null);
    tegnFramdrift(true);
    tegnTidslinje(false);
    return;
  }
  settSkjulTildelte(false);
  const paa = erApen() && S.framdriftVis !== false && !velger;
  // 📦 Hvilke bunker som brukes opp, finnes én gang per modell (stålet leses
  // fra modellen) — så tegnes glideren på nytt med bunkene
  if (paa) forberedKilder().then(() => { if (erApen() && S.framdriftVis !== false && !velger) tegnFramdrift(); }).catch(() => {});
  if (!paa) stoppAvspilling();
  tegnFramdrift(paa);
  tegnTidslinje(paa);
}

// 📄 PDF-en (trinn 4, js/framdrift-pdf.js — lastes først ved trykk). Glideren
// slås av mens bildene tegnes, og settes tilbake etterpå.
let lagerPdf = false;
export async function lastNedPdf() {
  if (lagerPdf) return null;
  lagerPdf = true;
  if (velger) avsluttVelg(false);
  stoppAvspilling();
  settSkjulTildelte(false);
  tegnFramdrift(false);
  try {
    const P = await import("./framdrift-pdf.js");
    return await P.lagFramdriftPdf();
  } finally {
    lagerPdf = false;
    oppdaterVis();
  }
}

// 🎞 Videoen (trinn 5, js/framdrift-video.js — lastes først ved trykk)
export async function lagVideo() {
  if (lagerPdf) return null;
  lagerPdf = true;
  if (velger) avsluttVelg(false);
  stoppAvspilling();
  settSkjulTildelte(false);
  tegnFramdrift(false);
  let r = null;
  try {
    const V = await import("./framdrift-video.js");
    r = await V.lagFramdriftVideo();
  } finally {
    lagerPdf = false;
    if (r) sisteMelding = r.url
      ? t("Videoen er lastet ned og lagret i SharePoint. PDF-en får nå en QR-kode til den.")
      : t("Videoen er lastet ned. Logg inn (den røde prikken øverst til høyre) og lag den på nytt for å lagre den i SharePoint — da får PDF-en en QR-kode til den.");
    if (erApen()) tegnPanel(); else oppdaterVis();
  }
  return r;
}

// ═══════════════════════ KROKER ═══════════════════════
S.lastFramdrift = () => {
  ryddFramdriftVis();
  nullstillKilder();
  S.framdrift = lesLokalt();
  sisteMelding = "";
  if (erApen()) tegnPanel();
  hentFraSp();
};
S.ryddFramdrift = () => { if (velger) avsluttVelg(false); ryddFramdriftVis(); S.framdrift = []; };

på("btnFramdrift", "click", () => {
  const panel = $("framdriftPanel");
  if (panel.classList.contains("open")) { if (velger) avsluttVelg(false); panel.classList.remove("open"); oppdaterVis(); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("framdriftPanel");
  forberedMobilPanel();   // 📱 mobil: åpner sammenlagt (oppsett B)
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
