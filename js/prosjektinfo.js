// 🗂 Prosjektinfo — felles felt i Innstillinger som alle verktøy leser.
//
// Byggeplan: «Storm IFC-Viewer byggeplan Vaer og Prosjektinfo PLAN 2026-10-09».
// Emil 09.10: «velg logo i innstillinger, så kommer den logoen opp på alt som
// har med logo å gjøre, i stedet for at du må legge det inn selv på hvert
// eneste rigg-objekt, PDF osv.». Feltene (valgt 09.10): prosjektnavn,
// prosjektnummer, byggherre, prosjektleder og telefon, adresse og logo.
//
// Lagres PER MODELL: lokalt (storm-ifc-prosjektinfo::<fil>) og i SharePoint
// (Prosjektinfo/<fil>.prosjektinfo.json), så kollegaene ser det samme.
// Reglene for hva som gjelder står i prosjektinfo-regn.js. Verktøyene leser
// alltid gjennom S.prosjektInfo() — ingen importerer denne fila, så den kan
// ikke lage importsløyfer.
import { $, S, esc, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { gjeldende, tomInfo, vaskAdresseInfo, vaskProsjektInfo } from "./prosjektinfo-regn.js";
import { adresseUrl, tilTM, vaskAdresseSvar } from "./terreng-regn.js";
import { spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import { hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";
import { lettNavn } from "./lite.js";
import { feltKilde, fyllFraSp, spProsjektinfo, vaskMannskap } from "./utfylling-regn.js";

const SP_MAPPE = "Prosjektinfo";
let info = vaskProsjektInfo({});
let fraLett = null;               // byggeplass-siden: det kontoret sendte ut
let spStatus = "av", lagreTid = 0, sokTreff = [], sokMelding = "";

const lsNokkel = () => "storm-ifc-prosjektinfo::" + (S.fileName || "");
const spFil = () => (S.fileName || "modell") + ".prosjektinfo.json";

function bpNummer() {
  try {
    const kart = JSON.parse(localStorage.getItem("storm-bp-kart") || "{}");
    return kart[lettNavn(S.fileName || "")] || "";
  } catch (_) { return ""; }
}

// ═══════════════════════ DET VERKTØYENE LESER ═══════════════════════
export function prosjektInfo() {
  if (LETT) {
    const f = fraLett || {};
    return Object.assign({ navn: "", nummer: S.lettProsjekt || "", byggherre: "", leder: "", telefon: "", logo: "",
      adresse: "", kommune: "", E: null, N: null, lat: null, lon: null, fra: {} }, f, { nummer: f.nummer || S.lettProsjekt || "" });
  }
  let ter = null;
  try { ter = S.terrengRef ? S.terrengRef() : null; } catch (_) { ter = null; }
  return gjeldende(info, { lettProsjekt: S.lettProsjekt, bpNummer: bpNummer(), terreng: ter, rapLogo: S.settings && S.settings.rapLogo });
}
S.prosjektInfo = prosjektInfo;
S.standardLogoFil = () => prosjektInfo().logo || "";

// Rapportmenyen og sjekklista har ikke et eget logovalg — de viser «standarden».
// Bytter brukeren der, er det prosjektets logo som byttes når den er satt
// (ellers den globale fra rapportmenyen, som før).
S.settStandardLogo = (fil) => {
  if (info.logo) { info.logo = String(fil || ""); lagre(); }
  else if (S.settings) { S.settings.rapLogo = String(fil || ""); writePrefs(); }
};

function meld() {
  try { document.dispatchEvent(new CustomEvent("storm-prosjektinfo")); } catch (_) {}
}

// ═══════════════════════ LAGRING ═══════════════════════
function lesLokalt() {
  try { return vaskProsjektInfo(JSON.parse(localStorage.getItem(lsNokkel()) || "{}")); } catch (_) { return vaskProsjektInfo({}); }
}
function lagreLokalt() {
  try { localStorage.setItem(lsNokkel(), JSON.stringify(info)); } catch (_) {}
}
function lagre() {
  info.endret = new Date().toISOString();
  info = vaskProsjektInfo(info);
  lagreLokalt();
  meld();
  clearTimeout(lagreTid);
  lagreTid = setTimeout(skrivSp, 700);
}
async function skrivSp() {
  if (!spPaalogget()) { spStatus = "av"; visStatus(); return; }
  const forFil = S.fileName;
  const res = await spSkriv(SP_MAPPE, spFil(), [Object.assign({ id: "info" }, info)], (p) => String(p && p.id || ""));
  if (S.fileName !== forFil) return;
  spStatus = res.ok ? "ok" : "feil";
  visStatus();
}
async function hentFraSp() {
  if (LETT || !spPaalogget()) { spStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(SP_MAPPE, spFil());
  if (S.fileName !== forFil) return;
  spStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  const der = (res.liste || []).find(p => p && p.id === "info");
  // Nyeste vinner — samme regel som de andre delte listene.
  if (der && String(der.endret || "") > String(info.endret || "")) {
    info = vaskProsjektInfo(der);
    lagreLokalt();
    meld();
  }
  if (!tomInfo(info) || der) gjenTegn();
  hentFraStormProsjekter(false);
}

// ═══════════ ✍️ 1B · PROSJEKTINFO FRA STORM PROSJEKTER (runde 5, Emil 23.11) ═══════════
// Prosjektet modellen er koblet til (Modell-feltet i lista Prosjekter, ellers
// byggeplassnummeret) fyller navn, nummer, byggherre, prosjektleder, telefon
// og adresse. Et felt fylles når det er tomt eller fortsatt er det vi hentet
// sist; har du skrevet noe annet, står det som «✎ endret her» og røres ikke.
// «↺ Hent på nytt fra Storm Prosjekter» overskriver alt (kan angres).
let spHentStatus = "";   // "" | "henter" | "ok" | "ingen" | "feil"
export async function hentFraStormProsjekter(alle) {
  if (LETT || !S.fileName || !spPaalogget()) return false;
  const forFil = S.fileName;
  spHentStatus = "henter";
  try {
    const sp = await import("./sharepoint.js");
    const G = await import("./legg-i-prosjekt-graph.js");
    const LR = await import("./legg-i-prosjekt-regn.js");
    const token = await sp.spTokenSilent();
    if (!token) { spHentStatus = ""; return false; }
    const rader = await G.hentProsjekter(token);
    const fil = S.fileName || "";
    const å = { ifc: S.kildeIfc && S.kildeIfc.fil === fil ? S.kildeIfc.ifc : (/\.ifc$/i.test(fil) ? fil : ""), fil,
      gruppe: S.aktivModellgruppe && S.aktivModellgruppe.fil === fil ? S.aktivModellgruppe.id : "" };
    let jobb = LR.finnJobb(rader, å);
    if (!jobb.length) jobb = LR.jobbForNummer(rader, bpNummer() || info.nummer);
    const rad = LR.foreslåProsjekt(jobb, "annet", å);
    if (S.fileName !== forFil) return false;
    if (!rad) { spHentStatus = "ingen"; gjenTegn(); return false; }
    const felt = await G.hentProsjektFelt(token, rad);
    if (S.fileName !== forFil) return false;
    // Prosjektlederen gjelder per selskap: raden modellen hører til, ellers den
    // første i jobben som er fylt ut (SE → SB → SS) – SVAR fra Storm Prosjekter 23.11.
    const spInfo = spProsjektinfo(Object.assign({}, rad.fields || {}, felt), LR.sorterProsjekter([...jobb]));
    // 3A: folkene på jobben (kolonnen Mannskap, lik på alle hovedprosjektene i jobben)
    const mRad = [felt, rad.fields].concat(jobb.map(r => r && r.fields)).find(f => f && f.Mannskap) || null;
    settMannskap(mRad ? vaskMannskap(mRad.Mannskap) : null);
    const forrige = info.sp || null;
    const ny = fyllFraSp(info, spInfo, forrige, !!alle);
    const før = JSON.stringify(info);
    Object.assign(info, ny);
    // Adressen: Lat/Lon fra Storm Prosjekter brukes direkte når de finnes,
    // ellers søkes Adresse opp hos Kartverket (samme søk som feltet). En adresse
    // du har valgt selv, røres ikke (bare ved «Hent på nytt»).
    const adrTekst = spInfo.adresse || spInfo.koordAdresse;
    if (adrTekst && (!info.adresse || alle)) {
      if (spInfo.lat != null && spInfo.lon != null) {
        const p = tilTM(spInfo.lat, spInfo.lon, "25833");
        const a = vaskAdresseInfo({ tekst: adrTekst, E: p.E, N: p.N });
        if (a) info.adresse = a;
      } else if (spInfo.adresse) {
        try {
          const l = await sok(spInfo.adresse);
          if (l.length && S.fileName === forFil) { const a = vaskAdresseInfo(l[0]); if (a) info.adresse = a; }
        } catch (_) { /* uten adresse – feltet står som før */ }
      }
    }
    info.sp = Object.assign({}, spInfo, { nokkel: (rad.fields || {}).Nokkel || "", hentet: new Date().toISOString() });
    for (const k of ["kolonner", "lat", "lon", "koordAdresse", "epost"]) delete info.sp[k];
    spHentStatus = "ok";
    if (JSON.stringify(info) !== før) {
      const etter = JSON.parse(JSON.stringify(info)), forrigeInfo = JSON.parse(før);
      lagre();
      if (alle) meldPiAngre("Hentet fra Storm Prosjekter", () => { info = vaskProsjektInfo(forrigeInfo); lagre(); gjenTegn(); }, () => { info = vaskProsjektInfo(etter); lagre(); gjenTegn(); });
    }
    gjenTegn();
    return true;
  } catch (err) {
    console.warn("Prosjektinfo fra Storm Prosjekter:", err && err.message);
    spHentStatus = "feil"; gjenTegn();
    return false;
  }
}
S.hentProsjektinfoFraSp = hentFraStormProsjekter;

// 3A: folkene på jobben. Huskes per modell, så lista virker også uten nett.
const mannskapNokkel = () => "storm-ifc-mannskap::" + (S.fileName || "");
function settMannskap(m) {
  S.jobbMannskap = m || null;
  try { if (m) localStorage.setItem(mannskapNokkel(), JSON.stringify(m)); else localStorage.removeItem(mannskapNokkel()); } catch (_) {}
}
function lesMannskap() {
  try { S.jobbMannskap = vaskMannskap(localStorage.getItem(mannskapNokkel()) || ""); } catch (_) { S.jobbMannskap = null; }
}

// afterLoad (ifc.js): lokalt først, så SharePoint i bakgrunnen.
S.lastProsjektinfo = () => {
  if (LETT) return;
  if (S.nullstillVaer3D) S.nullstillVaer3D();   // 🌦 ikke vis forrige modells vær
  info = lesLokalt();
  lesMannskap();
  sokTreff = []; sokMelding = "";
  meld();
  hentFraSp();
};
// bygg.html: kommer i <fil>.markeringer.json (feltet prosjektInfo).
S.settProsjektinfoFraLett = (d) => {
  fraLett = d && typeof d === "object" ? d : null;
  meld();
};

// ═══════════════════════ LOGOEN ═══════════════════════
// Når prosjektets logo velges, nullstilles verktøyenes egne logovalg til
// «prosjektets logo». Det er hele poenget: velg én gang, så står den på alt.
function brukLogoOveralt(fil) {
  if (!S.settings) return;
  S.settings.stopeLogo = null;
  S.settings.riggLogo = null;
  S.settings.framdriftLogo = null;
  // Global standard for modeller som ikke har Prosjektinfo ennå
  if (fil) S.settings.rapLogo = fil;
  writePrefs();
  if (S.nullstillSwLogo) S.nullstillSwLogo();
}

let logoListe = null;
async function fyllLogo(velg) {
  if (!velg) return;
  const valgt = info.logo;
  const opt = (v, tx) => { const o = document.createElement("option"); o.value = v; o.textContent = tx; return o; };
  velg.innerHTML = "";
  velg.appendChild(opt("", t("Innebygd Storm-logo")));
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

// ═══════════════════════ ADRESSESØKET ═══════════════════════
// Samme søk som Terreng (Geonorge, UTM33): eksakt først, fuzzy bare som
// andre forsøk — fuzzy gjorde «Storgata 14 Vikersund» til Egersund.
async function sok(tekst) {
  const hent = async (fuzzy) => {
    const r = await fetch(adresseUrl(tekst, fuzzy));
    if (!r.ok) throw new Error("Kartverket " + r.status);
    return vaskAdresseSvar(await r.json());
  };
  let l = await hent(false);
  if (!l.length) l = await hent(true);
  return l;
}
async function startSok() {
  const tekst = (($("piAdresseSok") || {}).value || "").trim();
  if (!tekst) return;
  sokMelding = t("Søker etter adressen …"); sokTreff = []; gjenTegn();
  try {
    const l = await sok(tekst);
    if (l.length === 1) { velgAdresse(l[0]); return; }
    sokTreff = l.slice(0, 5);
    sokMelding = l.length ? t("Velg riktig adresse:") : t("Fant ingen adresse. Prøv med postnummer eller poststed.");
  } catch (_) {
    sokMelding = t("Fikk ikke kontakt med Kartverket. Sjekk nettet og prøv igjen.");
  }
  gjenTegn();
}
function velgAdresse(a) {
  const v = vaskAdresseInfo(a);
  if (!v) return;
  const før = info.adresse || null;
  info.adresse = v;
  sokTreff = []; sokMelding = "";
  lagre();
  gjenTegn();
  meldPiAngre("Adresse valgt", () => settAdresse(før), () => settAdresse(v));
}

// ═══════════════════════ ↩ ANGRE ═══════════════════════
// Adressen og logoen er valg man gjør med ett trykk — og angrer på med ett
// trykk. Tekstfeltene har nettleserens egen angre mens man skriver.
function meldPiAngre(tekst, angre, gjenopprett) {
  if (S.pushAngre) S.pushAngre({ tekst, angre, gjenopprett });
}
function settAdresse(a) {
  info.adresse = a ? Object.assign({}, a) : null;
  sokTreff = []; sokMelding = "";
  lagre();
  gjenTegn();
}
// Logovalget nullstiller verktøyenes egne valg (brukLogoOveralt). Angre skal
// legge tilbake det som sto der, ikke bare prosjektets logo — ellers hadde
// riggplanen mistet logoen sin for godt etter et feiltrykk.
const LOGO_VALG = ["stopeLogo", "riggLogo", "framdriftLogo", "rapLogo"];
function logoTilstand() {
  const s = S.settings || {};
  return { logo: info.logo || "", valg: Object.fromEntries(LOGO_VALG.map(k => [k, s[k] === undefined ? null : s[k]])) };
}
function settLogoTilstand(x) {
  info.logo = x.logo || "";
  if (S.settings) { for (const k of LOGO_VALG) S.settings[k] = x.valg[k]; writePrefs(); }
  if (S.nullstillSwLogo) S.nullstillSwLogo();
  lagre();
  gjenTegn();
}

// ═══════════════════════ SEKSJONEN I INNSTILLINGER ═══════════════════════
const KILDE_TEKST = { terreng: "fra Terreng", byggeplass: "fra Storm-Byggeplass", rapport: "fra rapportmenyen" };
function statusTekst() {
  if (spStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (spStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Trykk på den røde prikken øverst til høyre og logg inn for å dele med de andre.");
}
function visStatus() { const el = $("piStatus"); if (el) el.textContent = statusTekst(); }

function felt(id, navn, verdi, reserve, kilde, spFelt) {
  const ph = reserve ? reserve + (kilde ? " (" + t(KILDE_TEKST[kilde] || kilde) + ")" : "") : "";
  const k = spFelt ? feltKilde(info, info.sp, spFelt) : "";
  const merke = k === "hentet" ? ' <span class="pi-hentet">✓ ' + esc(t("hentet")) + "</span>" : k === "endret" ? ' <span class="pi-endret">✎ ' + esc(t("endret her")) + "</span>" : "";
  return '<label class="pi-felt">' + esc(t(navn)) + merke +
    '<input type="text" id="' + id + '" value="' + esc(verdi || "") + '" placeholder="' + esc(ph) + '"></label>';
}

export function prosjektinfoHtml() {
  if (LETT) return "";
  const g = prosjektInfo();
  const merke = S.fileName ? (g.navn || g.nummer ? " · " + esc([g.nummer, g.navn].filter(Boolean).join(" ")) : ' <span style="color:var(--warn)">(' + esc(t("ikke fylt ut")) + ")</span>") : "";
  let inni = "";
  if (!S.fileName) {
    inni = '<p class="hint">' + esc(t("Åpne en modell først — prosjektinfo lagres per modell.")) + "</p>";
  } else {
    const adr = info.adresse;
    inni +=
      '<p style="color:var(--muted);font-size:11px;margin:0 0 6px">' +
        esc(t("Fylles inn automatisk i Rapport, Sjekkliste, Støpeplan, Riggplan, Framdriftsplan, SW-tegning, rigg-objektene og Vis vær. Det du skriver i et verktøy, gjelder bare der.")) + "</p>" +
      felt("piNavn", "Prosjektnavn", info.navn, "", "", "navn") +
      felt("piNummer", "Prosjektnummer", info.nummer, info.nummer ? "" : (g.fra.nummer !== "info" ? g.nummer : ""), g.fra.nummer, "nummer") +
      felt("piByggherre", "Byggherre / kunde", info.byggherre, "", "", "byggherre") +
      felt("piLeder", "Prosjektleder / kontakt", info.leder, "", "", "leder") +
      felt("piTelefon", "Telefon", info.telefon, "", "", "telefon") +
      '<label class="pi-felt">' + esc(t("Byggeplassens adresse")) + "</label>" +
      (adr
        ? '<div class="pi-adr"><b>' + esc(adr.tekst) + "</b>" + (adr.postnummer || adr.poststed ? ", " + esc((adr.postnummer + " " + adr.poststed).trim()) : "") +
          (adr.kommune ? '<br><span class="hint">' + esc(t("{0} kommune", adr.kommune)) + "</span>" : "") +
          ' <button id="piAdresseFjern" class="lenke">' + esc(t("Bytt")) + "</button></div>"
        : (g.adresse ? '<p class="hint">' + esc(t("Bruker {0} ({1}) til du velger en egen.", g.adresse, t(KILDE_TEKST[g.fra.adresse] || ""))) + "</p>" : "") +
          '<div class="pi-sok"><input type="text" id="piAdresseSok" placeholder="' + esc(t("Gate og nummer, sted")) + '"><button id="piSok">' + esc(t("Søk")) + "</button></div>") +
      (sokMelding ? '<p class="hint">' + esc(sokMelding) + "</p>" : "") +
      sokTreff.map((a, i) => '<button class="pi-treff" data-i="' + i + '">' + esc(a.tekst + ", " + a.postnummer + " " + a.poststed) + "</button>").join("") +
      '<label class="pi-felt">' + esc(t("Logo på PDF-er, Excel-ark og rigg-objekter")) + ' <select id="piLogo"></select></label>' +
      // ✍️ 1B: hentet fra Storm Prosjekter
      '<div class="pi-sp">' + (info.sp && info.sp.hentet
        ? '<span class="hint">' + esc(t("Hentet fra Storm Prosjekter {0}", new Date(info.sp.hentet).toLocaleString("no-NO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))) + "</span>"
        : spHentStatus === "ingen" ? '<span class="hint">' + esc(t("Fant ikke prosjektet modellen hører til i Storm Prosjekter.")) + "</span>"
        : spHentStatus === "feil" ? '<span class="hint">' + esc(t("Fikk ikke hentet fra Storm Prosjekter.")) + "</span>" : "") +
        ' <button id="piHentSp" class="lenke">↺ ' + esc(spHentStatus === "henter" ? t("Henter …") : t("Hent på nytt fra Storm Prosjekter")) + "</button></div>" +
      '<p id="piStatus" style="color:var(--muted);font-size:11px;margin:6px 0 0">' + esc(statusTekst()) + "</p>";
  }
  return '<details id="piSeksjon"' + (apen ? " open" : "") + '><summary><h4 style="display:inline">' + esc(t("Prosjektinfo")) + "</h4>" + merke + "</summary>" + inni + "</details>";
}
S.prosjektinfoHtml = prosjektinfoHtml;

let apen = false;
export function koblProsjektinfo() {
  const sek = $("piSeksjon");
  if (!sek) return;
  sek.ontoggle = () => { apen = sek.open; };
  const tekstFelt = { piNavn: "navn", piNummer: "nummer", piByggherre: "byggherre", piLeder: "leder", piTelefon: "telefon" };
  for (const [id, k] of Object.entries(tekstFelt)) {
    const el = $(id);
    if (el) el.oninput = () => { info[k] = el.value; lagre(); };
  }
  if ($("piSok")) $("piSok").onclick = startSok;
  if ($("piHentSp")) $("piHentSp").onclick = () => { spHentStatus = "henter"; gjenTegn(); hentFraStormProsjekter(true); };
  if ($("piAdresseSok")) $("piAdresseSok").onkeydown = (e) => { if (e.key === "Enter") startSok(); };
  if ($("piAdresseFjern")) $("piAdresseFjern").onclick = () => {
    const før = info.adresse || null;
    info.adresse = null; lagre(); gjenTegn();
    meldPiAngre("Adresse fjernet", () => settAdresse(før), () => settAdresse(null));
  };
  sek.querySelectorAll(".pi-treff").forEach(b => b.onclick = () => velgAdresse(sokTreff[Number(b.dataset.i)]));
  const lv = $("piLogo");
  if (lv) {
    fyllLogo(lv);
    lv.onchange = () => {
      const før = logoTilstand();
      info.logo = lv.value || ""; brukLogoOveralt(info.logo); lagre();
      const etter = logoTilstand();
      meldPiAngre("Logo valgt", () => settLogoTilstand(før), () => settLogoTilstand(etter));
    };
  }
}
S.koblProsjektinfo = koblProsjektinfo;

function gjenTegn() {
  const sek = $("piSeksjon");
  if (!sek) return;
  apen = sek.open;
  const ny = document.createElement("div");
  ny.innerHTML = prosjektinfoHtml();
  sek.replaceWith(ny.firstChild);
  koblProsjektinfo();
}
