// 🕘 «SJEKK INN PÅ JOBB» – Storm Byggeplass med ansattkoden (runde J, 13.11.2026)
//
// BYGGEPLAN-Storm-IFC-oppmote-ansattkode-2026-11-13.md, punkt 5.
//   • Montørkoden: rett til modellen som før – ingen oppmøte.
//   • Ansattkoden: valgskjerm «Sjekk inn på jobb» / «Åpne modellen».
//   • Sjekk inn-skjermen: lista fra GET /oppmote. Navnet telefonen husker
//     (bp_navn_<nr>) står øverst med rød ramme, og bare den knappen er aktiv.
//     Knappen veksler Sjekk inn (rød) ↔ Sjekk ut (mørk).
//   • Posisjonen hentes BARE i øyeblikket man trykker (8 s tidsgrense). Nei
//     eller ingen posisjon → trykket sendes likevel (utenPosisjon).
//   • 428 fra Workeren → informasjonsvinduet: «Jeg har lest informasjonen»
//     må krysses av før «Sjekk inn» blir aktiv. «Avbryt» lagrer ingenting.
//   • Uten nett: trykket legges i kø (localStorage) med telefonens tid og
//     sendes når nettet er tilbake (Workeren merker det fraKo).
import { $, esc } from "./state.js";
import { t } from "./i18n.js";
import { hentMedFrist } from "./nett.js";

const KO = "bp_oppmote_ko";
const les = (k, std) => { try { const v = localStorage.getItem(k); return v == null ? std : JSON.parse(v); } catch (_) { return std; } };
const skriv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* privat modus: ingen husk */ } };
const nk = (n) => String(n || "").toLowerCase().replace(/\s+/g, " ").trim();

export function enhetId() {
  let e = les("bp_enhet", "");
  if (!/^[a-z0-9-]{8,40}$/i.test(e)) {
    const a = new Uint8Array(10); (crypto || window.crypto).getRandomValues(a);
    e = "e-" + [...a].map(x => x.toString(16).padStart(2, "0")).join("");
    skriv("bp_enhet", e);
  }
  return e;
}
export const mittNavn = (nr) => les("bp_navn_" + nr, "");
export const huskNavn = (nr, navn) => skriv("bp_navn_" + nr, navn || "");
export const huskRolle = (nr, rolle) => skriv("bp_rolle_" + nr, rolle || "");
export const rolleFor = (nr) => les("bp_rolle_" + nr, "");

// ---------- Posisjon i trykkøyeblikket ----------
export function posisjon(frist) {
  return new Promise((ok) => {
    if (!navigator.geolocation) { ok(null); return; }
    let ferdig = false;
    const slutt = (v) => { if (!ferdig) { ferdig = true; ok(v); } };
    setTimeout(() => slutt(null), (frist || 8000) + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => slutt({ lat: p.coords.latitude, lon: p.coords.longitude, noyaktighetM: Math.round(p.coords.accuracy || 0) }),
        () => slutt(null), { enableHighAccuracy: true, timeout: frist || 8000, maximumAge: 0 });
    } catch (_) { slutt(null); }
  });
}

// ---------- Køen (uten nett) ----------
export const kø = () => les(KO, []);
function leggIKo(post) { const k = kø(); k.push(post); skriv(KO, k.slice(-50)); }
// Sender det som ligger i køen. 409 (tilstanden stemmer ikke lenger) og 4xx
// kastes; 428 (må lese informasjonen) og nettfeil blir liggende.
export async function sendKo() {
  const k = kø(); if (!k.length) return { sendt: 0, igjen: 0 };
  const igjen = []; let sendt = 0;
  for (const p of k) {
    try {
      const r = await hentMedFrist("/oppmote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
      if (r.ok) sendt++;
      else if (r.status === 428 || r.status === 429 || r.status >= 500) igjen.push(p);
    } catch (_) { igjen.push(p); }
  }
  skriv(KO, igjen);
  return { sendt, igjen: igjen.length };
}
if (typeof window !== "undefined") window.addEventListener("online", () => { sendKo().then(r => { if (r.sendt && tilstand.nr) last(); }); });

// ---------- Skjermene ----------
const tilstand = { nr: "", liste: [], dato: "", kvittering: "", feil: "", åpneModell: null, opptatt: false, nyttNavn: false };
export const _tilstand = tilstand;

function rot() {
  let el = $("bpOppmote");
  if (!el) { el = document.createElement("div"); el.id = "bpOppmote"; el.className = "op-bak"; document.body.appendChild(el); }
  return el;
}
export function lukk() { const el = $("bpOppmote"); if (el) el.remove(); const d = $("opInfo"); if (d) d.remove(); }

// Skjerm 1: valget
export function visValg(nr, åpneModell) {
  tilstand.nr = nr; tilstand.åpneModell = åpneModell;
  sendKo().catch(() => {});
  const el = rot();
  el.innerHTML = '<div class="op-kort op-valg">' +
    '<div class="op-topp"><b>' + esc(t("Byggeplass {0}", nr)) + '</b><span>' + esc(t("Storm-ansatt")) + '</span></div>' +
    '<button class="op-stor primary" id="opSjekkInn">' + esc(t("Sjekk inn på jobb")) + '<small>' + esc(t("Registrer når du kommer og går")) + '</small></button>' +
    '<button class="op-stor" id="opModell">' + esc(t("Åpne modellen")) + '<small>' + esc(t("3D-modellen, markeringer og tegninger")) + '</small></button>' +
    (mittNavn(nr) ? '<p class="op-liten">' + esc(t("Denne telefonen: {0}", mittNavn(nr))) + '</p>' : "") + '</div>';
  $("opSjekkInn").onclick = () => visListe();
  $("opModell").onclick = () => { lukk(); if (åpneModell) åpneModell(); };
}

async function last() {
  try {
    const r = await hentMedFrist("/oppmote?prosjekt=" + encodeURIComponent(tilstand.nr), { cache: "no-store" });
    if (r.status === 403) { tilstand.feil = t("Ansattkoden gjelder ikke lenger. Skriv koden på nytt."); tegn(); return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    tilstand.liste = j.personer || []; tilstand.dato = j.dato || ""; tilstand.feil = "";
    skriv("bp_oppmote_liste_" + tilstand.nr, { dato: tilstand.dato, personer: tilstand.liste });
  } catch (_) {
    const lagret = les("bp_oppmote_liste_" + tilstand.nr, null);
    if (lagret) { tilstand.liste = lagret.personer || []; tilstand.dato = lagret.dato || ""; }
    tilstand.feil = t("Ingen nett – trykket lagres på telefonen og sendes når nettet er tilbake.");
  }
  // Ventende trykk i køen vises som utført
  for (const p of kø().filter(x => x.prosjekt === tilstand.nr)) {
    const x = tilstand.liste.find(y => nk(y.navn) === nk(p.navn));
    if (x) { x.inne = p.hva === "inn"; x.venter = true; }
  }
  tegn();
}

// Skjerm 2: lista
export async function visListe() {
  tilstand.kvittering = ""; tilstand.nyttNavn = false;
  tegn();
  await last();
}

function statusTekst(p) {
  if (p.venter) return p.inne ? t("Inne (venter på nett)") : t("Ute (venter på nett)");
  if (p.inne) return t("Inne fra {0}", p.inn);
  if (p.ut) return t("Gikk {0}", p.ut);
  return "—";
}
function tegn() {
  const el = rot(), nr = tilstand.nr, meg = mittNavn(nr);
  const liste = tilstand.liste.slice();
  if (meg && !liste.some(p => nk(p.navn) === nk(meg))) liste.unshift({ navn: meg, inne: false, inn: "", ut: "", ukjent: true });
  liste.sort((a, b) => (nk(b.navn) === nk(meg)) - (nk(a.navn) === nk(meg)));
  const rad = (p) => {
    const egen = meg && nk(p.navn) === nk(meg);
    const knapp = egen
      ? '<button class="op-knapp' + (p.inne ? " ut" : " primary") + '" data-op="' + esc(p.navn) + '"' + (tilstand.opptatt ? " disabled" : "") + '>' +
        esc(p.inne ? t("Sjekk ut") : t("Sjekk inn")) + '</button>'
      : '<span class="op-status' + (p.inne ? " inne" : "") + '">' + esc(p.inne ? t("Inne") : "—") + '</span>';
    return '<div class="op-rad' + (egen ? " egen" : "") + (!meg ? " velg" : "") + '"' + (!meg ? ' data-velg="' + esc(p.navn) + '" role="button" tabindex="0"' : "") + '>' +
      '<div class="op-navn"><b>' + esc(p.navn) + '</b>' + (egen ? '<span class="op-merke">' + esc(t("denne telefonen")) + '</span>' : "") +
      '<small>' + esc(statusTekst(p)) + (p.ukjent ? " · " + esc(t("ikke på lista")) : "") + '</small></div>' + (meg ? knapp : "") + '</div>';
  };
  el.innerHTML = '<div class="op-kort op-liste">' +
    '<div class="op-topp"><button class="op-tilbake" id="opTilbake" aria-label="' + esc(t("Tilbake")) + '">‹</button><b>' + esc(t("Sjekk inn · {0}", nr)) + '</b><span>' + esc(tilstand.dato ? tilstand.dato.split("-").reverse().join(".") : "") + '</span></div>' +
    (tilstand.kvittering ? '<div class="op-kvittering">✓ ' + esc(tilstand.kvittering) + '</div>' : "") +
    (tilstand.feil ? '<div class="op-feil">' + esc(tilstand.feil) + '</div>' : "") +
    (!meg ? '<p class="op-hint">' + esc(t("Trykk på navnet ditt. Telefonen husker det til neste gang.")) + '</p>' : "") +
    '<div class="op-rader">' + (liste.length ? liste.map(rad).join("") : '<p class="op-liten">' + esc(t("Ingen er satt opp på jobben ennå.")) + '</p>') + '</div>' +
    (tilstand.nyttNavn ? '<div class="op-nytt"><input id="opNyttNavn" maxlength="80" autocomplete="name" placeholder="' + esc(t("Fullt navn")) + '"><button class="op-knapp primary" id="opNyttOk">' + esc(t("Bruk")) + '</button></div>'
      : (!meg ? '<button class="op-lenke" id="opIkkeLista">+ ' + esc(t("Jeg står ikke på lista")) + '</button>' : '<button class="op-lenke" id="opIkkeMeg">' + esc(t("Ikke meg")) + '</button>')) +
    '<p class="op-info">' + esc(t("Når du trykker, lagres navn, tid og hvor telefonen er akkurat da. Ingen sporing ellers. Posisjonen slettes etter 90 dager.")) + '</p>' +
    '<button class="op-stor" id="opModell2">' + esc(t("Åpne modellen")) + '</button></div>';
  $("opTilbake").onclick = () => visValg(nr, tilstand.åpneModell);
  $("opModell2").onclick = () => { lukk(); if (tilstand.åpneModell) tilstand.åpneModell(); };
  el.querySelectorAll("[data-velg]").forEach(r => r.onclick = () => { huskNavn(nr, r.dataset.velg); tegn(); });
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = () => trykk(b.dataset.op));
  const ikke = $("opIkkeMeg"); if (ikke) ikke.onclick = () => { huskNavn(nr, ""); tilstand.kvittering = ""; tegn(); };
  const ikkeL = $("opIkkeLista"); if (ikkeL) ikkeL.onclick = () => { tilstand.nyttNavn = true; tegn(); const i = $("opNyttNavn"); if (i) i.focus(); };
  const ok = $("opNyttOk");
  if (ok) {
    const bruk = () => { const v = String($("opNyttNavn").value || "").replace(/\s+/g, " ").trim().slice(0, 80); if (v.length < 3) return; huskNavn(nr, v); tilstand.nyttNavn = false; tegn(); };
    ok.onclick = bruk;
    $("opNyttNavn").onkeydown = (e) => { if (e.key === "Enter") bruk(); };
  }
}

// Ett trykk: posisjon nå → POST /oppmote. 428 → informasjonsvinduet.
async function trykk(navn) {
  if (tilstand.opptatt) return;
  const p = tilstand.liste.find(x => nk(x.navn) === nk(navn)) || { navn, inne: false };
  const hva = p.inne ? "ut" : "inn";
  tilstand.opptatt = true; tilstand.kvittering = t("Henter posisjon …"); tegn();
  const pos = await posisjon(8000);
  const post = { prosjekt: tilstand.nr, navn, hva, enhet: enhetId(),
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, noyaktighetM: pos ? pos.noyaktighetM : null };
  await send(post, p);
}
async function send(post, p) {
  try {
    const r = await hentMedFrist("/oppmote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(post) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 428 && j.trengerBekreftelse) { tilstand.opptatt = false; tilstand.kvittering = ""; tegn(); visInfo(j, post, p); return; }
    if (r.status === 409) { tilstand.kvittering = ""; tilstand.feil = j.inne ? t("Du var allerede sjekket inn.") : t("Du var allerede sjekket ut."); await last(); return; }
    if (!r.ok) throw Object.assign(new Error(j.feil || ("HTTP " + r.status)), { http: true });
    tilstand.feil = "";
    tilstand.kvittering = (j.hva === "inn" ? t("Sjekket inn {0}", j.tid) : t("Sjekket ut {0}", j.tid)) +
      (j.utenPosisjon ? " · " + t("uten posisjon") : "") + (j.langtUnna ? " · " + t("langt fra byggeplassen – prosjektleder får beskjed") : "");
    await last();
  } catch (err) {
    if (err && err.http) { tilstand.feil = String(err.message); tilstand.kvittering = ""; }
    else {
      // Ingen nett: i køen med telefonens tid
      leggIKo(Object.assign({}, post, { tidKlient: new Date().toISOString() }));
      if (p) { p.inne = post.hva === "inn"; p.venter = true; }
      const kl = new Date().toTimeString().slice(0, 5);
      tilstand.kvittering = (post.hva === "inn" ? t("Sjekket inn {0}", kl) : t("Sjekket ut {0}", kl)) + " · " + t("sendes når nettet er tilbake");
    }
  } finally { tilstand.opptatt = false; tegn(); }
}

// Informasjonsvinduet (første innsjekk, eller ny versjon av teksten)
function visInfo(j, post, p) {
  const tekster = j.tekst || {};
  const språk = (document.documentElement.lang || "no").slice(0, 2);
  const tekst = tekster[språk] || tekster.no || "";
  const d = document.createElement("div");
  d.id = "opInfo"; d.className = "op-bak op-info-bak";
  d.innerHTML = '<div class="op-kort op-infokort" role="dialog" aria-modal="true">' +
    '<div class="op-topp"><b>' + esc(t("Før første innsjekk")) + '</b></div>' +
    '<div class="op-tekst">' + esc(tekst).replace(/\n/g, "<br>") + '</div>' +
    '<p class="op-som">' + esc(t("Du sjekker inn som: {0}", post.navn)) + '</p>' +
    '<label class="op-avkryss"><input type="checkbox" id="opLest"> ' + esc(t("Jeg har lest informasjonen")) + '</label>' +
    '<div class="op-kn"><button class="op-knapp" id="opAvbryt">' + esc(t("Avbryt")) + '</button>' +
    '<button class="op-knapp primary" id="opBekreft" disabled>' + esc(t("Sjekk inn")) + '</button></div></div>';
  document.body.appendChild(d);
  $("opLest").onchange = () => { $("opBekreft").disabled = !$("opLest").checked; };
  $("opAvbryt").onclick = () => d.remove();
  $("opBekreft").onclick = async () => {
    $("opBekreft").disabled = true;
    try {
      const r = await hentMedFrist("/oppmote-bekreft", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prosjekt: post.prosjekt, navn: post.navn, enhet: post.enhet, tekstVersjon: j.tekstVersjon }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      d.remove();
      tilstand.opptatt = true; tilstand.kvittering = t("Sjekker inn …"); tegn();
      await send(post, p);
    } catch (_) {
      $("opBekreft").disabled = false;
      const f = d.querySelector(".op-som"); if (f) f.textContent = t("Fikk ikke kontakt – prøv igjen når du har nett.");
    }
  };
}

// Etter innlasting: har telefonen ansattkoden for prosjektet fra før, og kaka
// gjelder fortsatt (GET /oppmote svarer 200), vises valget uten ny kode.
export async function prøvGjenåpne(nr, åpneModell) {
  if (!/^\d{5}$/.test(nr) || rolleFor(nr) !== "ansatt" || !navigator.onLine) return false;
  try {
    const r = await hentMedFrist("/oppmote?prosjekt=" + encodeURIComponent(nr), { cache: "no-store" }, 6000);
    if (!r.ok) return false;
  } catch (_) { return false; }
  visValg(nr, åpneModell);
  return true;
}
