// 🔒 TILGANG: gratisdel, engangskode og enhetskort (post 11, steg 1 — 14.10.2026)
//
// Byggeplan: «Storm IFC-Viewer byggeplan engangskode og tilgang PLAN 2026-10-14.md»,
// avsnitt 2 (gratis og låst), 3b (kodeboksen) og 3c (oppdelingen i main.js).
// Utseendet på kodeboksen: «Storm IFC-Viewer kodeboks valgt B hva du faar 2026-10-14.png».
//
// SLIK HENGER DET SAMMEN
//   · Alle kan åpne kontorsiden og bruke gratisdelen: åpne lokal IFC,
//     Måleverktøy, Visning, minikartet, Søk og Markeringer.
//   · Resten krever et ENHETSKORT. Emil lager en engangskode i adminpanelet,
//     personen skriver den inn én gang her, og Worker-en svarer med en
//     kortnøkkel (32 tilfeldige byte) som huskes i localStorage. Etter det
//     virker alt som før, uten passord.
//   · main.js spør sjekkKort() FØR de låste modulene lastes. Uten kort lastes
//     de aldri — knappene står der med 🔒 og åpner kodeboksen.
//   · Worker-en sjekker kortet ved HVERT kall (hvemErDet i worker.js). Låsen
//     her er brukervennlighet; dørvakten er Worker-en (og fullt ut i steg 3).
//
// HVORFOR localStorage OG IKKE EN KAKE: kontorsiden ligger på github.io og
// Worker-en på workers.dev — ulike domener. En kake fra Worker-en ville ikke
// blitt sendt med. Det rettes i steg 3, når Worker-en serverer kontorsiden.
//
// STORM-BYGGEPLASS (bygg.html) LASTER ALDRI DENNE FILA. Montørene merker ingenting.
import { $, S, esc } from "./state.js";
import { TJENESTER } from "./config.js";
import { varsel } from "./varsel.js";

// Tekstene her er bare på norsk foreløpig. Ordbøkene i js/sprak/ ligger i
// byggeplassens service worker; endres de, får montørene «ny versjon»-varsel.
// Oversettelser legges til i en egen runde (husk verktoy/lag-sw-liste.mjs).
const norsk = (s, ...a) => a.reduce((r, v, i) => r.split("{" + i + "}").join(v), s);

// Endres versjonen, må alle med kort godta vilkårene på nytt ved neste oppstart
// (vilkårsutkastet 14.10, «Til den som bygger»).
export const VILKAR_VERSJON = "1.0";
export const KONTAKT_EPOST = "emil@stormentreprenor.no";

// _test/kjor-alle.sh setter denne til true i TEMP-KOPIEN, så de gamle testene
// (som trykker på låste knapper) ser hele appen. test-tilgang.mjs setter
// globalThis.__STORM_TEST_LÅS = true for å teste låsen. Skal være false her.
const TESTKOPI = false;
const testÅpent = () => TESTKOPI && !globalThis.__STORM_TEST_LÅS;

// ---------- Hva er låst (byggeplanen avsnitt 2) ----------
// Låsen settes PER KNAPP, fordi Bygg Info er delvis gratis (Søk og Markeringer).
export const LÅSTE_KNAPPER = [
  // Bygg Info
  "btnQty", "btnPris", "btnGrupper", "btnLaster", "btnCompare", "btnEm", "btnLag", "btnKollisjon",
  // Planlegging
  "btnTerreng", "btnRigg", "btnStopeplan", "btnFramdrift", "btnVaer",
  // Storm-Byggeplass
  "btnByggeplass", "btnMateriell", "btnSW", "btnTak", "btnShare", "btnHistorikk",
  // Dokumentasjon
  "btnRapport", "btnDokStope", "btnDokRigg", "btnDokSW", "btnDokBcf", "btnDokBcfImport", "btnSaveLite",
  // Biblioteket (SharePoint) — kort + Microsoft-innlogging som i dag
  "btnLib", "btnLibSplash"
];
// Grupper der ALT er låst: gruppeknappen får 🔒 og åpner kodeboksen.
export const LÅSTE_GRUPPER = ["plan", "bygg", "dok"];

// ---------- Lagring ----------
const KORT_KEY = "storm-kort";              // localStorage: { nøkkel, id, navn, firma, storm }
const SJEKK_KEY = "storm-kort-sjekk";       // sessionStorage: svaret fra /kort/sjekk i denne økta
const ADMIN_KEY = "storm-bp-token";         // sessionStorage: ADMIN_TOKEN (samme nøkkel som før)
const ADMIN_TIDSAVBRUDD = 15 * 60 * 1000;   // logger ut etter 15 min uten aktivitet

const lesLS = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lesSS = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const settSS = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
const fjernSS = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };

// ADMIN_TOKEN lå i localStorage fram til 6. aug 2026 (se byggeplass.js). Ryddes
// fortsatt bort her, så den aldri blir liggende på disk.
try {
  const gml = localStorage.getItem(ADMIN_KEY);
  if (gml) { settSS(ADMIN_KEY, gml); localStorage.removeItem(ADMIN_KEY); }
} catch (_) {}

export function lesKort() {
  try {
    const k = JSON.parse(lesLS(KORT_KEY) || "null");
    return k && /^[0-9a-f]{64}$/.test(k.nøkkel || "") ? k : null;
  } catch (_) { return null; }
}
function lagreKort(k) { try { localStorage.setItem(KORT_KEY, JSON.stringify(k)); } catch (_) {} }
export function fjernKort() {
  try { localStorage.removeItem(KORT_KEY); } catch (_) {}
  fjernSS(SJEKK_KEY);
}

export function adminNøkkel() { return lesSS(ADMIN_KEY) || ""; }
export function erAdmin() { return !!adminNøkkel(); }
export function settAdminNøkkel(v) { settSS(ADMIN_KEY, v); sistAktiv = Date.now(); }
export function glemAdminNøkkel() { fjernSS(ADMIN_KEY); }

// Nøkkelen Worker-kallene sender i x-token: ADMIN_TOKEN hvis Emil har limt den
// inn i denne økta (da virker også prosjektene fra før v13, som eies av Admin),
// ellers kortet.
export function tilgangsNøkkel() {
  const a = adminNøkkel();
  if (a) return a;
  const k = lesKort();
  return k ? k.nøkkel : "";
}

// Tilstanden etter sjekkKort(): "ok" | "ingen" | "sperret" | "vilkar"
let tilstand = "ingen";
let kortSvar = null;

export function harKort() { return testÅpent() || erAdmin() || tilstand === "ok"; }
export function kortNavn() {
  if (erAdmin() && tilstand !== "ok") return "Admin";
  const k = kortSvar || lesKort();
  return k ? k.navn || "" : "";
}
export function kortInfo() { return kortSvar || lesKort(); }

// ---------- Oppstart: gjelder kortet fortsatt? ----------
// Svaret huskes for økta. Er nettet nede, men et kort finnes, godtas kortet
// lokalt — Worker-en sjekker det uansett ved hvert kall.
export async function sjekkKort() {
  if (testÅpent()) { tilstand = "ok"; return true; }
  const k = lesKort();
  if (!k) { tilstand = "ingen"; return erAdmin(); }
  const husket = (() => { try { return JSON.parse(lesSS(SJEKK_KEY) || "null"); } catch (_) { return null; } })();
  let svar = husket;
  if (!svar) {
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const tid = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
      const r = await fetch(TJENESTER.worker + "/kort/sjekk", { headers: { "x-token": k.nøkkel }, signal: ctl ? ctl.signal : undefined });
      if (tid) clearTimeout(tid);
      const j = await r.json().catch(() => ({}));
      if (r.ok) { svar = j; settSS(SJEKK_KEY, JSON.stringify(j)); }
      else if (r.status === 403 && j.sperret) svar = { sperret: true };
      else if (r.status === 403 && j.ukjent) { fjernKort(); tilstand = "ingen"; return erAdmin(); }
      // 429 eller noe annet: godta lokalt, som ved nett nede
    } catch (_) { /* nett nede — godta lokalt */ }
  }
  if (svar && svar.sperret) { tilstand = "sperret"; return erAdmin(); }
  kortSvar = Object.assign({}, k, svar || {});
  delete kortSvar.nøkkel;
  if (svar && (svar.vilkar || "") < VILKAR_VERSJON) { tilstand = "vilkar"; return erAdmin(); }
  tilstand = "ok";
  return true;
}

// ---------- Kodeboksen (alternativ B, «Hva du får») ----------
const FORDELER = [
  ["📊", "Mengder og priskalkulasjon", "Mengder rett fra modellen, og Excel med formler."],
  ["🏗", "Planlegging", "Terreng, rigg og stillas, støpeplan, framdrift og vær."],
  ["❄", "Snø og vindlast", "Laster fra kommunen, rett på taket og veggene."],
  ["📱", "Storm-Byggeplass", "Modellen ut til montørene med QR-kode, uten innlogging."],
  ["📄", "Dokumentasjon", "Rapport, riggplan, SW-tegning og BCF."]
];

const KODE_TEGN = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
export function formaterKode(s) {
  const r = String(s || "").toUpperCase().replace(KODE_TEGN, "").slice(0, 8);
  return r.length > 4 ? r.slice(0, 4) + "-" + r.slice(4) : r;
}

function lukkKodeboks() {
  const b = $("kodeboks");
  if (b) b.remove();
  document.removeEventListener("keydown", escLukker, true);
}
function escLukker(e) { if (e.key === "Escape") { e.stopPropagation(); lukkKodeboks(); } }

export function krevKort() {
  if (harKort()) return true;
  if (tilstand === "vilkar") visVilkarBoks(); else visKodeboks();
  return false;
}

export function visKodeboks() {
  if ($("kodeboks")) return;
  const k = lesKort();
  const bak = document.createElement("div");
  bak.id = "kodeboks";
  bak.className = "kodeboks-bak";
  bak.innerHTML =
    '<div class="kodeboks" role="dialog" aria-modal="true" aria-labelledby="kbTittel">' +
      '<div class="kb-venstre">' +
        '<h2 id="kbTittel">' + esc(norsk("Lås opp hele Storm IFC")) + '</h2>' +
        '<p class="kb-under">' + esc(norsk("Du bruker gratisversjonen: måling, visning, søk og markeringer. Med kode får du i tillegg:")) + '</p>' +
        '<ul class="kb-liste">' + FORDELER.map(([ik, tit, linje]) =>
          '<li><span class="kb-ikon">' + ik + '</span><span><b>' + esc(norsk(tit)) + '</b><br><span>' + esc(norsk(linje)) + '</span></span></li>').join("") +
        '</ul>' +
        '<div class="kb-bunn"><span>' + esc(norsk("Har du ikke kode?")) + '</span>' +
          '<button type="button" id="kbBeOm">✉ ' + esc(norsk("Be om tilgang")) + '</button></div>' +
      '</div>' +
      '<div class="kb-hoyre">' +
        '<div class="kb-hode"><h3>' + esc(norsk("Har du fått en kode?")) + '</h3>' +
          '<button type="button" class="kb-lukk" id="kbLukk" title="' + esc(norsk("Lukk")) + '" aria-label="' + esc(norsk("Lukk")) + '">✕</button></div>' +
        (tilstand === "sperret" ? '<p class="kb-feil">' + esc(norsk("Kortet på denne PC-en er sperret. Be om en ny kode.")) + '</p>' : "") +
        '<label class="kb-etikett" for="kbKode">' + esc(norsk("Engangskode")) + '</label>' +
        '<input id="kbKode" class="kb-kode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="XXXX-XXXX">' +
        '<p class="kb-feil" id="kbFeil" role="alert"></p>' +
        '<div class="kb-rad">' +
          '<label><span class="kb-etikett">' + esc(norsk("Navn")) + '</span><input id="kbNavn" autocomplete="name" value="' + esc(k && k.navn || "") + '"></label>' +
          '<label><span class="kb-etikett">' + esc(norsk("Firma")) + '</span><input id="kbFirma" autocomplete="organization" value="' + esc(k && k.firma || "") + '"></label>' +
        '</div>' +
        '<label class="kb-vilkar"><input type="checkbox" id="kbVilkar"> ' + esc(norsk("Jeg godtar")) +
          ' <a href="vilkar.html" target="_blank" rel="noopener">' + esc(norsk("vilkårene for bruk")) + '</a></label>' +
        '<button type="button" class="kb-las-opp" id="kbLasOpp" disabled>' + esc(norsk("Lås opp")) + '</button>' +
        '<p class="kb-personvern">' + esc(norsk("Vi lagrer navn, firma og e-post for å gi deg tilgang og kunne følge opp. Si fra til {0} hvis du vil bli slettet.", KONTAKT_EPOST)) + '</p>' +
      '</div>' +
    '</div>';
  document.body.appendChild(bak);

  const kode = $("kbKode"), knapp = $("kbLasOpp"), feil = $("kbFeil"), vilkar = $("kbVilkar");
  const oppdater = () => { knapp.disabled = kode.value.replace("-", "").length !== 8 || !vilkar.checked; };
  kode.addEventListener("input", () => {
    const pos = kode.value.length;
    kode.value = formaterKode(kode.value);
    if (pos >= kode.value.length) kode.setSelectionRange(kode.value.length, kode.value.length);
    feil.textContent = "";
    oppdater();
  });
  vilkar.addEventListener("change", oppdater);
  kode.addEventListener("keydown", (e) => { if (e.key === "Enter" && !knapp.disabled) knapp.click(); });
  $("kbLukk").onclick = lukkKodeboks;
  bak.addEventListener("pointerdown", (e) => { if (e.target === bak) lukkKodeboks(); });
  document.addEventListener("keydown", escLukker, true);
  $("kbBeOm").onclick = () => {
    const navn = $("kbNavn").value.trim(), firma = $("kbFirma").value.trim();
    const tekst = "Hei Emil!\n\nJeg vil gjerne ha tilgang til Storm IFC.\n\n" +
      "Navn: " + navn + "\nFirma: " + firma + "\nE-post: \nTelefon: \n\nHva jeg vil bruke det til: \n";
    location.href = "mailto:" + KONTAKT_EPOST + "?subject=" + encodeURIComponent("Tilgang til Storm IFC") +
      "&body=" + encodeURIComponent(tekst);
  };
  knapp.onclick = async () => {
    knapp.disabled = true;
    feil.textContent = "";
    const forrige = knapp.textContent;
    knapp.textContent = norsk("Låser opp …");
    try {
      const r = await fetch(TJENESTER.worker + "/kort/los-inn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kode: kode.value, navn: $("kbNavn").value.trim(), firma: $("kbFirma").value.trim(), vilkar: VILKAR_VERSJON })
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) throw new Error(norsk("For mange forsøk. Prøv igjen om en time."));
      if (!r.ok || !j.nøkkel) throw new Error(norsk("Koden er feil, brukt eller utløpt"));
      lagreKort({ nøkkel: j.nøkkel, id: j.id, navn: j.navn, firma: j.firma, storm: !!j.storm });
      settSS(SJEKK_KEY, JSON.stringify({ navn: j.navn, firma: j.firma, storm: !!j.storm, id: j.id, vilkar: j.vilkar || VILKAR_VERSJON }));
      // Last siden på nytt, så de låste modulene lastes i riktig rekkefølge (3c)
      location.reload();
    } catch (err) {
      feil.textContent = err && err.name !== "TypeError" ? err.message : norsk("Fikk ikke kontakt med tjenesten. Sjekk nettet og prøv igjen.");
      knapp.textContent = forrige;
      oppdater();
    }
  };
  setTimeout(() => kode.focus(), 30);
}

// Nye vilkår siden kortet ble løst inn: vis dem og be om «Godta».
function visVilkarBoks() {
  if ($("kodeboks")) return;
  const bak = document.createElement("div");
  bak.id = "kodeboks";
  bak.className = "kodeboks-bak";
  bak.innerHTML = '<div class="kodeboks kb-smal" role="dialog" aria-modal="true">' +
    '<div class="kb-hoyre"><div class="kb-hode"><h3>' + esc(norsk("Vilkårene er oppdatert")) + '</h3>' +
    '<button type="button" class="kb-lukk" id="kbLukk" aria-label="' + esc(norsk("Lukk")) + '">✕</button></div>' +
    '<p>' + esc(norsk("Les vilkårene for bruk (versjon {0}) og godta dem for å bruke de låste verktøyene igjen.", VILKAR_VERSJON)) + '</p>' +
    '<p><a href="vilkar.html" target="_blank" rel="noopener">' + esc(norsk("Les vilkårene for bruk")) + '</a></p>' +
    '<p class="kb-feil" id="kbFeil"></p>' +
    '<button type="button" class="kb-las-opp" id="kbGodta">' + esc(norsk("Godta")) + '</button></div></div>';
  document.body.appendChild(bak);
  $("kbLukk").onclick = lukkKodeboks;
  document.addEventListener("keydown", escLukker, true);
  $("kbGodta").onclick = async () => {
    const k = lesKort();
    try {
      const r = await fetch(TJENESTER.worker + "/kort/godta-vilkar", { method: "POST",
        headers: { "content-type": "application/json", "x-token": k ? k.nøkkel : "" },
        body: JSON.stringify({ vilkar: VILKAR_VERSJON }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      fjernSS(SJEKK_KEY);
      location.reload();
    } catch (err) {
      $("kbFeil").textContent = norsk("Klarte ikke å lagre: ") + err.message;
    }
  };
}

// ---------- Hengelåsene ----------
function erLåstKnapp(b) {
  if (!b) return false;
  if (b.id && LÅSTE_KNAPPER.includes(b.id)) return true;
  return !!(b.dataset && b.dataset.velg && LÅSTE_GRUPPER.includes(b.dataset.velg));
}

function merkLås(b) {
  if (!b || b.classList.contains("laast")) return;
  b.classList.add("laast");
  // Ikke aria-disabled: knappen VIRKER — den åpner kodeboksen.
  const s = document.createElement("span");
  s.className = "laas-ikon";
  s.setAttribute("aria-hidden", "true");
  s.textContent = "🔒";
  b.appendChild(s);
}

function merkAlleLåste() {
  LÅSTE_KNAPPER.forEach(id => merkLås($(id)));
  document.querySelectorAll("#verktoygrupper button[data-velg]").forEach(b => { if (erLåstKnapp(b)) merkLås(b); });
}

// Fanger trykket FØR knappens egne lyttere (capture-fasen). Gjelder også
// hurtigtastene og hjelpekortene, som trykker knappene med .click().
function fangLåsteTrykk(e) {
  if (harKort()) return;
  const b = e.target && e.target.closest ? e.target.closest("button") : null;
  if (!erLåstKnapp(b)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  krevKort();
}

// ---------- Merkelappen og Admin-knappen i toppbaren ----------
function byggToppknapper() {
  const topp = $("topbar");
  if (!topp) return;
  const foran = $("btnInnlogging");
  const sett = (el) => { if (foran && foran.parentNode === topp) topp.insertBefore(el, foran); else topp.appendChild(el); };
  if (!harKort() && !$("btnGratis")) {
    const g = document.createElement("button");
    g.id = "btnGratis";
    g.className = "gratis-merke";
    g.title = norsk("Du bruker gratisversjonen — trykk for å låse opp med kode");
    g.textContent = norsk("Gratisversjon");
    g.onclick = () => visKodeboks();
    sett(g);
  }
  oppdaterAdminKnapp();
}

export function oppdaterAdminKnapp(antallVenter) {
  const topp = $("topbar");
  if (!topp) return;
  let a = $("btnAdmin");
  if (!erAdmin()) { if (a) a.remove(); return; }
  if (!a) {
    a = document.createElement("button");
    a.id = "btnAdmin";
    a.className = "admin-knapp";
    a.title = norsk("Adminpanel: koder, godkjenning og brukere");
    a.innerHTML = "🛡 <span class='btn-t'>Admin</span><span class='admin-tall' hidden></span>";
    a.onclick = åpneAdmin;
    const foran = $("btnInnlogging");
    if (foran && foran.parentNode === topp) topp.insertBefore(a, foran); else topp.appendChild(a);
  }
  if (antallVenter != null) {
    const tall = a.querySelector(".admin-tall");
    tall.textContent = antallVenter;
    tall.hidden = !antallVenter;
  }
}

async function åpneAdmin() {
  if (!erAdmin()) return;
  try {
    const m = await import("./admin.js");
    m.visAdmin();
  } catch (err) {
    console.error(err);
    varsel(norsk("Klarte ikke å åpne adminpanelet: ") + err.message);
  }
}

// Antall som venter (det røde tallet på Admin-knappen), uten å laste admin.js
async function hentVenterAntall() {
  if (!erAdmin()) return;
  try {
    const r = await fetch(TJENESTER.worker + "/admin/venter", { headers: { "x-token": adminNøkkel() } });
    if (r.ok) oppdaterAdminKnapp((await r.json()).length);
    else if (r.status === 403) { glemAdminNøkkel(); oppdaterAdminKnapp(); }
  } catch (_) {}
}

// ---------- 15 minutter uten aktivitet → admin logges ut ----------
let sistAktiv = Date.now();
function følgAktivitet() {
  const merk = () => { sistAktiv = Date.now(); };
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(h => document.addEventListener(h, merk, { passive: true, capture: true }));
  setInterval(() => {
    if (erAdmin() && Date.now() - sistAktiv > ADMIN_TIDSAVBRUDD) loggUtAdmin(norsk("Logget ut av admin etter 15 minutter uten aktivitet."));
  }, 30000);
  setInterval(hentVenterAntall, 120000);
}

export function loggUtAdmin(melding) {
  glemAdminNøkkel();
  const p = $("adminPanel");
  if (p) p.remove();
  oppdaterAdminKnapp();
  if (melding) varsel(melding);
}

// ---------- Innstillinger → Tilgang ----------
// Settes inn via S.prosjektinfoHtml (ui.js kaller den), så ui.js — som også
// lastes av bygg.html — ikke trenger å endres. Prosjektinfo vises bare med kort.
function tilgangHtml() {
  const k = kortInfo();
  let html = '<h4>' + esc(norsk("Tilgang")) + '</h4>';
  if (tilstand === "ok" && k) {
    html += '<div class="set-row"><span class="n">' + esc(norsk("Kortet tilhører")) + '</span><span>' +
      esc(k.navn || "") + (k.firma ? " · " + esc(k.firma) : "") + '</span></div>' +
      '<div class="prop-actions"><button id="tgFjern">' + esc(norsk("Fjern kortet fra denne PC-en")) + '</button></div>';
  } else if (erAdmin() || document.body.classList.contains("har-kort")) {
    // Åpent uten eget kort: enten admin-nøkkelen nå, eller admin-nøkkelen
    // som ble logget ut etter 15 min (verktøyene er lastet og står åpne til
    // siden lastes på nytt — vi laster ikke om selv, det kan koste ulagret arbeid).
    html += '<p style="font-size:12px; margin:0 0 6px; color:' + (erAdmin() ? 'var(--ok)">🛡 ' +
        esc(norsk("Åpnet med admin-nøkkelen. Alle verktøy er tilgjengelige i denne fanen.")) :
        'var(--warn)">' + esc(norsk("Admin-nøkkelen er logget ut. Verktøyene er åpne til siden lastes på nytt."))) + '</p>' +
      '<p style="color:var(--muted); font-size:11px; margin:0 0 6px">' +
        esc(norsk("Uten eget kort låses verktøyene igjen når fanen lukkes. Løs inn en Storm-kode for å bli husket på denne PC-en.")) + '</p>' +
      '<div class="prop-actions"><button id="tgLasOpp">🔑 ' + esc(norsk("Løs inn eget kort")) + '</button></div>';
  } else {
    html += '<p style="color:var(--muted); font-size:12px; margin:0 0 6px">' +
      esc(tilstand === "sperret" ? norsk("Kortet på denne PC-en er sperret.") :
          tilstand === "vilkar" ? norsk("Vilkårene er oppdatert og må godtas.") :
          norsk("Gratisversjon: måling, visning, søk og markeringer.")) + '</p>' +
      '<div class="prop-actions"><button id="tgLasOpp" class="primary">🔒 ' + esc(tilstand === "vilkar" ? norsk("Les og godta vilkårene") : norsk("Lås opp med kode")) + '</button>' +
      (lesKort() ? '<button id="tgFjern">' + esc(norsk("Fjern kortet fra denne PC-en")) + '</button>' : "") + '</div>';
  }
  html += '<details' + (erAdmin() ? " open" : "") + '><summary><span style="font-size:12px">' + esc(norsk("Administrator")) + '</span></summary>';
  if (erAdmin()) {
    html += '<p style="font-size:12px; color:var(--ok); margin:6px 0">🛡 ' + esc(norsk("Admin-nøkkelen er aktiv i denne fanen. Logges ut etter 15 minutter uten aktivitet.")) + '</p>' +
      '<div class="prop-actions"><button id="tgAdminUt">' + esc(norsk("Logg ut av admin")) + '</button></div>';
  } else {
    html += '<div class="set-row" style="gap:6px"><input type="password" id="tgAdmin" autocomplete="off" placeholder="ADMIN_TOKEN" style="flex:1; min-width:0">' +
      '<button id="tgAdminInn">' + esc(norsk("Bruk")) + '</button></div>' +
      '<p class="kb-feil" id="tgAdminFeil"></p>';
  }
  html += '</details>';
  return html;
}

function koblTilgang() {
  if ($("tgLasOpp")) $("tgLasOpp").onclick = () => { if (tilstand === "vilkar") visVilkarBoks(); else visKodeboks(); };
  if ($("tgFjern")) $("tgFjern").onclick = () => {
    if (!confirm(norsk("Fjerne kortet fra denne PC-en? Du trenger en ny kode for å låse opp igjen."))) return;
    fjernKort();
    location.reload();
  };
  if ($("tgAdminUt")) $("tgAdminUt").onclick = () => { loggUtAdmin(); location.reload(); };
  if ($("tgAdminInn")) $("tgAdminInn").onclick = async () => {
    const v = ($("tgAdmin").value || "").trim();
    const feil = $("tgAdminFeil");
    if (!v) return;
    try {
      const r = await fetch(TJENESTER.worker + "/admin/tall", { headers: { "x-token": v } });
      if (r.status === 429) throw new Error(norsk("For mange forsøk. Prøv igjen om en time."));
      if (!r.ok) throw new Error(norsk("Nøkkelen ble ikke godtatt."));
      settAdminNøkkel(v);
      // Last på nytt: med admin-nøkkelen lastes også de låste verktøyene
      location.reload();
    } catch (err) {
      feil.textContent = err && err.name !== "TypeError" ? err.message : norsk("Fikk ikke kontakt med tjenesten.");
    }
  };
}

function koblInnstillinger() {
  const html = S.prosjektinfoHtml, kobl = S.koblProsjektinfo;
  S.prosjektinfoHtml = () => tilgangHtml() + (harKort() && html ? html() : "");
  S.koblProsjektinfo = () => { koblTilgang(); if (harKort() && kobl) kobl(); };
}

// ---------- Kalles av main.js når ALLE moduler er lastet ----------
export function startTilgang() {
  koblInnstillinger();
  byggToppknapper();
  følgAktivitet();
  if (erAdmin()) hentVenterAntall();
  if (harKort()) { document.body.classList.add("har-kort"); return; }
  document.body.classList.add("gratisversjon");
  document.addEventListener("click", fangLåsteTrykk, true);
  merkAlleLåste();
  // Gruppeknappene bygges av verktoygrupper.js (lastes via ui.js) — de finnes
  // nå. Uten kort starter vi i Måleverktøy (byggeplanen 3b).
  const mal = document.querySelector('#verktoygrupper button[data-velg="mal"]');
  const valgt = document.querySelector("#verktoygrupper button.active");
  if (mal && (!valgt || LÅSTE_GRUPPER.includes(valgt.dataset.velg) || valgt.dataset.velg === "info")) mal.click();
  // Knapper som bygges senere (f.eks. Historikk) får låsen når de dukker opp
  if (typeof MutationObserver !== "undefined") {
    let venter = false;
    new MutationObserver(() => {
      if (venter) return;
      venter = true;
      Promise.resolve().then(() => { venter = false; merkAlleLåste(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
}
