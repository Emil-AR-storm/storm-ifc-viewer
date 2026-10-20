// 🛡 ADMINPANELET — faner (runde 2, 20.10.2026)
//
// Runde 1 (14.10/19.10) var ett langt dashbord. Emil valgte prøvebilde X:
// FANER rett under overskriften — 📊 Oversikt · 👥 Brukere · 🏗 Byggeplass-
// prosjekter · ⚙ System — med et tall på hver, oransje når noe trenger ham.
// Bildene: «Storm IFC-Viewer adminpanel sider prove X 2026-10-20.png»
// (Oversikt), «… runde 2 prove A» (Brukere med utfoldet rad), «… prove A2»
// (Prosjekter med Filer som tredje del) og «… prove B» (System = de tre kortene).
// Kontrakten mot Workeren: kontrakt/runde2.md.
//
// Lastes BARE når ADMIN_TOKEN er limt inn under Innstillinger → Tilgang →
// Administrator (js/tilgang.js importerer fila når Admin-knappen trykkes).
// Den står ikke på lista over låste moduler for kortholdere i main.js.
//
// Alt panelet gjør, kan også gjøres fra konsollen — se
// «prossedyrer/Prosedyre - tilgangskoder.md». Panelet er bare et ansikt på
// de samme Worker-rutene: /kort/*, /admin/*, /filer/*, /fil/*.
import { $, esc } from "./state.js";
import { TJENESTER } from "./config.js";
import { varsel } from "./varsel.js";
import { adminNøkkel, loggUtAdmin, oppdaterAdminKnapp, VILKAR_VERSJON } from "./tilgang.js";
import { qrDataUrl } from "./qr.js";

// Tekstene her er bare på norsk foreløpig. Ordbøkene i js/sprak/ ligger i
// byggeplassens service worker; endres de, får montørene «ny versjon»-varsel.
// Oversettelser legges til i en egen runde (husk verktoy/lag-sw-liste.mjs).
const norsk = (s, ...a) => a.reduce((r, v, i) => r.split("{" + i + "}").join(v), s);

const W = () => TJENESTER.worker;

async function kall(sti, valg) {
  const tok = adminNøkkel();
  if (!tok) { loggUtAdmin(); throw new Error(norsk("Admin-nøkkelen er ikke limt inn.")); }
  const o = Object.assign({}, valg || {});
  o.headers = Object.assign({ "x-token": tok }, o.headers || {});
  if (o.json !== undefined) {
    o.method = o.method || "POST";
    o.headers["content-type"] = "application/json";
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  const r = await fetch(W() + sti, o);
  if (r.status === 403) { loggUtAdmin(norsk("Admin-nøkkelen ble ikke godtatt. Lim den inn på nytt under Innstillinger → Tilgang.")); throw new Error("403"); }
  if (r.status === 429) throw new Error(norsk("For mange forsøk. Prøv igjen om en time."));
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.feil || ("HTTP " + r.status));
  }
  return r;
}

// Samme GET fra flere faner samtidig (Oversikt trenger nesten alt) skal bare
// gå til Workeren én gang. Løftet glemmes så snart svaret er kommet, så
// «↻» og fanebytte alltid henter ferskt.
const iFlukt = new Map();
function hentJson(sti) {
  if (iFlukt.has(sti)) return iFlukt.get(sti);
  const p = kall(sti).then(r => r.json()).finally(() => iFlukt.delete(sti));
  iFlukt.set(sti, p);
  return p;
}

// «i dag 09:42», «i går 15:10», ellers «12.10»
function når(iso, medKlokke) {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "–";
  const dag = (x) => x.toISOString().slice(0, 10);
  const iDag = new Date(), iGår = new Date(Date.now() - 86400000);
  const kl = medKlokke && iso.length > 10 ? " " + klokke(iso) : "";
  const lokalDag = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000);
  if (dag(lokalDag(d)) === dag(lokalDag(iDag))) return norsk("i dag") + kl;
  if (dag(lokalDag(d)) === dag(lokalDag(iGår))) return norsk("i går") + kl;
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0");
}
function klokke(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "–" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// 1024-basert, norsk komma: «38,2 MB», «251 MB», «1,9 GB» (som i prøvebildene)
function str(b) {
  if (b === null || b === undefined || isNaN(b)) return "–";
  const e = ["B", "kB", "MB", "GB", "TB"];
  let v = Number(b), i = 0;
  while (v >= 1024 && i < e.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(v) : v.toLocaleString("nb-NO", { maximumFractionDigits: v < 100 ? 1 : 0 })) + " " + e[i];
}
// Gratiskvoten i R2. Lagringsflisa og streken i Helse måles mot denne.
const GRATIS = 10 * 1024 ** 3;
const flertall = (n, en, flere) => n + " " + (n === 1 ? en : flere);

// ---------- Faner ----------
const FANER = [
  ["oversikt", "📊", "Oversikt"],
  ["brukere", "👥", "Brukere"],
  ["prosjekter", "🏗", "Byggeplass-prosjekter"],
  ["system", "⚙", "System"]
];
const FANE_KEY = "storm.admin.fane";   // sessionStorage: sist valgte fane i denne økta
function lesFane() {
  try { const f = sessionStorage.getItem(FANE_KEY); if (FANER.some(x => x[0] === f)) return f; } catch (_) { /* privat vindu */ }
  return "oversikt";
}
let fane = "oversikt";

// Alt panelet har hentet. null = ikke hentet ennå; { feil } = hentingen feilet.
const D = { tall: null, venter: null, kort: null, ventende: null, lagring: null, blokkert: null, vilkar: null, helse: null, aktivitet: null };

let prosjektListe = [];
let prosjekterHentet = false;
let åpent = null;            // prosjektnummeret med utfoldet rad (én om gangen)
let nyKode = null;           // { prosjekt, kode } — den nye montørkoden, vises BARE til raden lukkes
const loggMinne = new Map(); // prosjekt → { rader, totalt, filter, vis } — så ny tegning ikke henter på nytt
let brukerListe = [];        // kortene fra /kort/liste — til «+ Eier» og Brukere-fanen
let åpenBruker = null;       // kort-id med utfoldet rad i Brukere
let sammeKode = null;        // { id, kode, navn } — «Ny kode til samme person», vises bare mens raden er åpen
const filMinne = new Map();  // prosjekt → [{ nøkkel, størrelse, lastet }] fra /filer/<nr>
const valgteFiler = new Map(); // prosjekt → Set(rad-id)
// Slettenøkkelen (SLETTE_NOKKEL) er en ANNEN nøkkel enn admin-nøkkelen og
// skal ikke ligge i nettleseren. Den spørres om første gang det slettes, og
// holdes bare i denne variabelen til panelet lukkes — aldri sessionStorage.
let slettNøkkel = null;

const LASTERE = {
  oversikt: () => [hentTall(), hentVenter(), hentHelse(), hentLagring(), hentAktivitet(), hentBlokkert(), hentVilkar(), hentBrukere(), hentProsjekter()],
  brukere: () => [hentBrukere(), hentProsjekter(), hentVilkar()],
  prosjekter: () => [hentProsjekter(), hentLagring(), hentBrukere()],
  system: () => [hentHelse(), hentBlokkert(), hentVilkar(), hentLagring()]
};

const tom = (tekst) => '<p class="ap-tom">' + esc(tekst) + '</p>';
const henter = () => tom(norsk("Henter …"));

export function visAdmin() {
  if ($("adminPanel")) { oppdaterAlt(); return; }
  fane = lesFane();
  const p = document.createElement("div");
  p.id = "adminPanel";
  p.className = "admin-panel";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-label", "Admin");
  p.innerHTML =
    '<div class="ap-hode"><h2>🛡 Admin</h2>' +
      '<button type="button" id="apLukk">✕ ' + esc(norsk("Tilbake til modellen")) + '</button></div>' +
    '<div class="ap-faner" role="tablist" aria-label="' + esc(norsk("Adminsider")) + '">' +
      FANER.map(([id, ikon, tekst]) =>
        '<button type="button" role="tab" id="apFane-' + id + '" data-fane="' + id + '" aria-controls="apSide-' + id + '">' +
          '<span aria-hidden="true">' + ikon + '</span> ' + esc(norsk(tekst)) +
          (id === "oversikt" ? "" : ' <span class="ap-fane-tall" id="apFaneTall-' + id + '">–</span>') +
        '</button>').join("") +
    '</div>' +

    // ---------- 📊 Oversikt ----------
    '<section class="ap-side" role="tabpanel" id="apSide-oversikt" aria-labelledby="apFane-oversikt" tabindex="0">' +
      '<div class="ap-tall">' +
        '<div><b id="apTallKort">–</b><span>' + esc(norsk("kort utlevert")) + '</span></div>' +
        '<div><b id="apTallVenter" class="ap-oransje">–</b><span>' + esc(norsk("venter på godkjenning")) + '</span></div>' +
        '<div><b id="apTallFirma">–</b><span>' + esc(norsk("eksterne firma")) + '</span></div>' +
        '<div><b id="apTallOpp">–</b><span>' + esc(norsk("opplastinger siste 30 dager")) + '</span></div>' +
        '<div><b id="apTallLagring">–</b><span>' + esc(norsk("lagring brukt av 10 GB")) + '</span></div>' +
        '<div id="apTallHelseFlis"><b id="apTallHelse">–</b><span id="apTallHelseTekst">' + esc(norsk("helse")) + '</span></div>' +
      '</div>' +
      '<div class="ap-oversikt">' +
        '<div class="ap-oversikt-venstre">' +
          '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Venter på godkjenning")) + ' <span class="ap-merke" id="apVenterMerke" hidden></span></h3>' +
            '<div id="apVenter">' + henter() + '</div></section>' +
          '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Trenger deg")) + '</h3><div id="apTrenger">' + henter() + '</div></section>' +
        '</div>' +
        '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Siste aktivitet, alle prosjekter")) + '</h3>' +
          '<div class="ap-tabell-boks"><table class="ap-tabell ap-logg"><tbody id="apAktivitet"><tr><td class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
        '</section>' +
      '</div>' +
    '</section>' +

    // ---------- 👥 Brukere ----------
    '<section class="ap-side" role="tabpanel" id="apSide-brukere" aria-labelledby="apFane-brukere" tabindex="0" hidden>' +
      '<section class="ap-kol ap-lav ap-brukere"><div class="ap-kolhode"><h3>' + esc(norsk("Brukere")) + ' <span class="ap-dempet" id="apBrukerSum"></span></h3>' +
        '<span class="ap-knapper"><button type="button" id="apExcel">⬇ Excel</button>' +
        '<button type="button" class="primary" id="apNyKodeKnapp" aria-expanded="false">+ ' + esc(norsk("Ny kode")) + '</button></span></div>' +
        // «Lag ny kode» fra runde 1, nå bak «+ Ny kode» (prøvebilde A)
        '<div class="ap-nykode" id="apNyKodeBoks" hidden>' +
          '<label>' + esc(norsk("Navn")) + '<input id="apNavn" autocomplete="off"></label>' +
          '<label>' + esc(norsk("Firma")) + '<input id="apFirma" autocomplete="off"></label>' +
          '<label>' + esc(norsk("E-post")) + '<input id="apEpost" type="email" autocomplete="off"></label>' +
          '<label class="ap-sjekk"><input type="checkbox" id="apStorm"> ' + esc(norsk("Storm-ansatt (godkjennes automatisk)")) + '</label>' +
          '<div><button type="button" id="apLag">' + esc(norsk("Lag engangskode")) + '</button></div>' +
          '<div id="apKodeUt" class="ap-kodeut"></div>' +
        '</div>' +
        '<div class="ap-tabell-boks"><table class="ap-tabell"><thead><tr>' +
          '<th>' + esc(norsk("Navn")) + '</th><th>' + esc(norsk("Firma")) + '</th><th>' + esc(norsk("Type")) + '</th>' +
          '<th>' + esc(norsk("Vilkår")) + '</th><th>' + esc(norsk("Sist brukt")) + '</th><th>' + esc(norsk("Eier prosjekter")) + '</th><th></th>' +
        '</tr></thead><tbody id="apBrukere"><tr><td colspan="7" class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
      '</section>' +
    '</section>' +

    // ---------- 🏗 Byggeplass-prosjekter ----------
    // Emil 14.10: avslutt et ferdig prosjekt, så kommer ingen montør inn lenger
    // — og aktiver det igjen ved et feiltrykk. Runde 2: Plass, Sist opplastet og Filer.
    '<section class="ap-side" role="tabpanel" id="apSide-prosjekter" aria-labelledby="apFane-prosjekter" tabindex="0" hidden>' +
      '<section class="ap-kol ap-prosjekter"><div class="ap-kolhode"><h3>' + esc(norsk("Byggeplass-prosjekter")) +
          ' <span class="ap-dempet" id="apProsjektTall"></span></h3>' +
          '<label class="ap-sjekk ap-filter"><input type="checkbox" id="apVisAvsluttet" checked> ' + esc(norsk("Vis avsluttede")) + '</label></div>' +
        '<p class="ap-tom" style="margin-top:0">' + esc(norsk("Avsluttet = montørene kommer ikke inn, og det kommer ingen morgenvarsler. Ingenting slettes: aktiverer du igjen, virker samme montørkode og QR.")) + '</p>' +
        '<div class="ap-tabell-boks"><table class="ap-tabell"><thead><tr>' +
          '<th>' + esc(norsk("Nr.")) + '</th><th>' + esc(norsk("Navn")) + '</th><th>' + esc(norsk("Eier")) + '</th>' +
          '<th>' + esc(norsk("Montørkode")) + '</th><th>' + esc(norsk("Plass")) + '</th><th>' + esc(norsk("Sist opplastet")) + '</th>' +
          '<th>' + esc(norsk("Status")) + '</th><th></th>' +
        '</tr></thead><tbody id="apProsjekter"><tr><td colspan="8" class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
      '</section>' +
    '</section>' +

    // ---------- ⚙ System (de tre kortene fra prøvebilde B) ----------
    '<section class="ap-side" role="tabpanel" id="apSide-system" aria-labelledby="apFane-system" tabindex="0" hidden>' +
      '<div class="ap-system">' +
        '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Helse")) + '</h3><div id="apHelse">' + henter() + '</div>' +
          '<div><button type="button" id="apHelseIgjen">↻ ' + esc(norsk("Sjekk igjen")) + '</button></div></section>' +
        '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Blokkerte adresser")) + ' <span class="ap-fane-tall" id="apBlokkertTall" hidden></span></h3>' +
          '<div id="apBlokkert">' + henter() + '</div>' +
          '<p class="ap-dempet">' + esc(norsk("Blokkering varer en time. Opphev hvis det er en montør bak samme 4G-ruter.")) + '</p></section>' +
        '<section class="ap-kol ap-lav"><h3>' + esc(norsk("Vilkår for bruk")) + '</h3><div id="apVilkar">' + henter() + '</div>' +
          '<div><button type="button" class="primary" id="apVilkarKrav">' + esc(norsk("Krev at alle godtar på nytt")) + '</button></div>' +
          '<p class="ap-dempet">' + esc(norsk("Alle kort må godta igjen ved neste åpning. Ingen mister tilgang til data.")) + '</p></section>' +
      '</div>' +
    '</section>';
  document.body.appendChild(p);
  // Under toppbaren, så Admin-knappen og gruppene fortsatt synes (som i bildet)
  const topp = $("topbar");
  p.style.top = (topp ? topp.getBoundingClientRect().bottom : 0) + "px";

  $("apLukk").onclick = lukkAdmin;
  document.addEventListener("keydown", escLukker, true);
  $("apLag").onclick = lagKode;
  $("apExcel").onclick = lastNedExcel;
  $("apNyKodeKnapp").onclick = () => visNyKodeSkjema($("apNyKodeBoks").hidden);
  $("apHelseIgjen").onclick = () => { hentHelse(); hentLagring(); };
  $("apVilkarKrav").onclick = krevVilkår;
  $("apVisAvsluttet").onchange = tegnProsjekter;
  kobleFaner();
  velgFane(fane, false, true);
  oppdaterAlt();
}

function escLukker(e) {
  if (e.key !== "Escape" || !$("adminPanel")) return;
  if (document.getElementById("kodeboks")) return;
  e.stopPropagation();
  lukkAdmin();
}

export function lukkAdmin() {
  const p = $("adminPanel");
  if (p) p.remove();
  // Kodene skal aldri bli liggende synlige neste gang panelet åpnes, og
  // slettenøkkelen glemmes med en gang panelet er lukket.
  åpent = null; nyKode = null; loggMinne.clear();
  åpenBruker = null; sammeKode = null; slettNøkkel = null;
  filMinne.clear(); valgteFiler.clear();
  document.removeEventListener("keydown", escLukker, true);
}

// Ved åpning: alt Oversikt trenger (og det gir tallene på fanene), pluss
// fanen som var valgt sist. Like ruter slås sammen i hentJson().
async function oppdaterAlt() {
  const l = LASTERE.oversikt();
  if (fane !== "oversikt") l.push(...LASTERE[fane]());
  await Promise.all(l);
}

function kobleFaner() {
  const liste = document.querySelector("#adminPanel .ap-faner");
  liste.querySelectorAll("button[data-fane]").forEach(b => { b.onclick = () => velgFane(b.dataset.fane, true); });
  // Piltaster mellom fanene (WAI-ARIA «tabs»): bare den valgte fanen er i Tab-rekkefølgen
  liste.addEventListener("keydown", (e) => {
    const i = FANER.findIndex(f => f[0] === fane);
    let ny = null;
    if (e.key === "ArrowRight") ny = FANER[(i + 1) % FANER.length][0];
    else if (e.key === "ArrowLeft") ny = FANER[(i - 1 + FANER.length) % FANER.length][0];
    else if (e.key === "Home") ny = FANER[0][0];
    else if (e.key === "End") ny = FANER[FANER.length - 1][0];
    if (!ny) return;
    e.preventDefault();
    velgFane(ny, true);
    const b = $("apFane-" + ny); if (b) b.focus();
  });
}

// Bytter fane. Hver fane henter sine egne data når den vises — da er det
// alltid ferskt, uten at Oversikt må vente på alt.
function velgFane(navn, last, førstegang) {
  if (!FANER.some(f => f[0] === navn)) navn = "oversikt";
  fane = navn;
  try { sessionStorage.setItem(FANE_KEY, navn); } catch (_) { /* privat vindu: husker bare ikke */ }
  for (const [id] of FANER) {
    const b = $("apFane-" + id), s = $("apSide-" + id);
    if (!b || !s) continue;
    b.setAttribute("aria-selected", String(id === navn));
    b.tabIndex = id === navn ? 0 : -1;
    b.classList.toggle("ap-fane-valgt", id === navn);
    s.hidden = id !== navn;
  }
  const b = $("apFane-" + navn);
  if (b && b.scrollIntoView && !førstegang) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (last) LASTERE[navn]();
}

// Tallene på fanene. Oransje = noe trenger Emil:
//  · System: blokkerte adresser, eller helsesjekken feiler
//  · Brukere: noen mangler vilkårene, eller en engangskode går ut innen 24 t
function oppdaterMerker() {
  const sett = (id, tekst, varsle, tittel) => {
    const m = $("apFaneTall-" + id); if (!m) return;
    m.textContent = tekst;
    m.classList.toggle("ap-varsel", !!varsle);
    m.title = tittel || "";
  };
  const mangler = vilkårMangler();
  const snart = koderSnart();
  sett("brukere", D.kort ? brukerListe.length : "–", mangler.length || snart.length,
    [mangler.length ? norsk("{0} mangler vilkår", mangler.length) : "", snart.length ? norsk("{0} kode går ut snart", snart.length) : ""].filter(Boolean).join(" · "));
  sett("prosjekter", prosjekterHentet ? prosjektListe.length : "–", false);
  const blokk = Array.isArray(D.blokkert) ? D.blokkert.length : 0;
  const n = blokk + (helseFeil() ? 1 : 0);
  sett("system", D.blokkert || D.helse ? n : "–", n > 0, n ? norsk("Noe trenger deg") : "");
}

function helseFeil() {
  const h = D.helse;
  if (!h) return false;
  return !!h.feil || !h.ok || h.kv === false || h.r2 === false;
}
function vilkårMangler() {
  if (D.vilkar && Array.isArray(D.vilkar.mangler)) return D.vilkar.mangler;
  // Eldre Worker uten /admin/vilkar: regn ut fra kortlista (versjonen alene)
  return brukerListe.filter(k => !k.sperret && (k.vilkar || "") < VILKAR_VERSJON);
}
function koderSnart() {
  const grense = Date.now() + 24 * 3600000;
  return (D.ventende || []).filter(v => v.utløper && Date.parse(v.utløper) < grense);
}

// ---------- Hentere: hver fyller D og tegner det som bruker dataene ----------
async function hentTall() {
  try {
    const j = D.tall = await hentJson("/admin/tall");
    $("apTallKort").textContent = j.kort;
    $("apTallVenter").textContent = j.venter;
    $("apTallFirma").textContent = j.eksterneFirma;
    $("apTallOpp").textContent = j.opplastinger;
  } catch (err) { if (err.message !== "403" && $("apTallKort")) $("apTallKort").title = err.message; }
}

async function hentVenter() {
  const boks = $("apVenter");
  if (!boks) return;
  try {
    const liste = D.venter = await hentJson("/admin/venter");
    oppdaterAdminKnapp(liste.length);
    if (!$("apVenter")) return;
    const merke = $("apVenterMerke");
    merke.textContent = liste.length; merke.hidden = !liste.length;
    if (!liste.length) { boks.innerHTML = tom(norsk("Ingen prosjekter venter.")); return; }
    boks.innerHTML = liste.map(v =>
      '<div class="ap-venter" data-prosjekt="' + esc(v.prosjekt) + '">' +
        '<div class="ap-venter-topp"><b>' + esc(v.prosjekt) + (v.prosjektnavn ? " " + esc(v.prosjektnavn) : "") + '</b>' +
        '<span>' + esc(når(v.tid, true)) + '</span></div>' +
        '<p>' + esc(v.navn || "") + (v.firma ? " · " + esc(v.firma) : "") + " " + esc(norsk("vil opprette byggeplass-prosjekt")) + '</p>' +
        '<div class="ap-knapper"><button type="button" class="ap-ok" data-godkjenn>✓ ' + esc(norsk("Godkjenn")) + '</button>' +
        '<button type="button" data-avvis>' + esc(norsk("Avvis")) + '</button></div>' +
      '</div>').join("");
    boks.querySelectorAll(".ap-venter").forEach(kort => {
      const prosjekt = kort.dataset.prosjekt;
      kort.querySelector("[data-godkjenn]").onclick = () => avgjør(prosjekt, true);
      kort.querySelector("[data-avvis]").onclick = () => {
        if (confirm(norsk("Avvise prosjekt {0}? Personen får ikke lage montørkode for det.", prosjekt))) avgjør(prosjekt, false);
      };
    });
  } catch (err) {
    if (err.message !== "403" && $("apVenter")) boks.innerHTML = '<p class="kb-feil">' + esc(err.message) + '</p>';
  }
}

async function avgjør(prosjekt, godkjenn) {
  try {
    await kall(godkjenn ? "/admin/godkjenn" : "/admin/avvis", { json: { prosjekt } });
    await Promise.all([hentVenter(), hentTall(), hentProsjekter()]);
  } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
}

async function hentBrukere() {
  try {
    const j = await hentJson("/kort/liste");
    brukerListe = j.kort || [];
    D.kort = brukerListe; D.ventende = j.ventende || [];
  } catch (err) {
    if (err.message === "403") return;
    const k = $("apBrukere");
    if (k) k.innerHTML = '<tr><td colspan="7" class="kb-feil">' + esc(err.message) + '</td></tr>';
    return;
  }
  tegnBrukere(); tegnTrenger(); oppdaterMerker();
}

async function hentProsjekter() {
  try {
    prosjektListe = await hentJson("/admin/prosjekter");
    prosjekterHentet = true;
  } catch (err) {
    if (err.message === "403") return;
    const k = $("apProsjekter");
    if (k) k.innerHTML = '<tr><td colspan="8" class="kb-feil">' + esc(err.message) + '</td></tr>';
    return;
  }
  tegnProsjekter(); tegnBrukere(); tegnTrenger(); oppdaterMerker();
}

async function hentLagring() {
  try { D.lagring = await hentJson("/admin/lagring"); }
  catch (err) { if (err.message === "403") return; D.lagring = { feil: err.message }; }
  const l = D.lagring;
  if (!$("adminPanel")) return;
  $("apTallLagring").textContent = l.feil ? "–" : str(l.totalt);
  $("apTallLagring").title = l.feil || "";
  oppdaterPlassCeller(); tegnHelse(); tegnTrenger();
  if (åpent) tegnFiler(åpent);
}

async function hentHelse() {
  const start = performance.now();
  try {
    const j = await hentJson("/admin/helse");
    D.helse = Object.assign({}, j, { rundtur: Math.round(performance.now() - start), sjekket: new Date().toISOString() });
  } catch (err) {
    if (err.message === "403") return;
    D.helse = { feil: err.message, sjekket: new Date().toISOString() };
  }
  if (!$("adminPanel")) return;
  const feil = helseFeil();
  $("apTallHelse").textContent = "● " + (feil ? norsk("Feil") : "OK");
  $("apTallHelseTekst").textContent = feil ? norsk("se System") : norsk("Workeren svarer");
  $("apTallHelseFlis").className = feil ? "ap-flis-feil" : "ap-flis-ok";
  tegnHelse(); tegnTrenger(); oppdaterMerker();
}

async function hentBlokkert() {
  try { D.blokkert = (await hentJson("/admin/blokkert")).liste || []; }
  catch (err) {
    if (err.message === "403") return;
    D.blokkert = null;
    if ($("apBlokkert")) $("apBlokkert").innerHTML = '<p class="kb-feil">' + esc(err.message) + '</p>';
    return;
  }
  tegnBlokkert(); tegnTrenger(); oppdaterMerker();
}

async function hentVilkar() {
  try { D.vilkar = await hentJson("/admin/vilkar"); }
  catch (err) {
    if (err.message === "403") return;
    D.vilkar = null;
    if ($("apVilkar")) $("apVilkar").innerHTML = '<p class="kb-feil">' + esc(err.message) + '</p>';
    return;
  }
  tegnVilkår(); tegnBrukere(); tegnTrenger(); oppdaterMerker();
}

async function hentAktivitet() {
  const kropp = $("apAktivitet");
  try {
    const j = await hentJson("/admin/aktivitet?antall=15");
    D.aktivitet = j.rader || [];
  } catch (err) {
    if (err.message !== "403" && kropp) kropp.innerHTML = '<tr><td class="kb-feil">' + esc(err.message) + '</td></tr>';
    return;
  }
  tegnAktivitet();
}

// ---------- 📊 Oversikt ----------
// Samme radformat som loggen fra runde 1 (når(), ✓/⚠ og fargene), pluss prosjektnummeret.
function tegnAktivitet() {
  const kropp = $("apAktivitet");
  if (!kropp || !D.aktivitet) return;
  if (!D.aktivitet.length) { kropp.innerHTML = '<tr><td class="ap-tom">' + esc(norsk("Ingen aktivitet ennå.")) + '</td></tr>'; return; }
  kropp.innerHTML = D.aktivitet.map(r => {
    const feil = r.ok === false;
    const detalj = detaljTekst(r);
    return '<tr><td class="ap-dempet ap-nowrap" title="' + esc(r.tid || "") + '">' + esc(når(r.tid, true)) + '</td>' +
      '<td class="' + (feil ? "ap-logg-feil" : "ap-logg-ok") + '">' + (feil ? "⚠ " : "✓ ") + esc(r.hva || "–") + '</td>' +
      '<td>' + esc(hvemTekst(r)) + '</td>' +
      '<td class="ap-dempet">' + esc(r.prosjekt || "") + (detalj !== "–" ? " · " + esc(detalj) : "") + '</td></tr>';
  }).join("");
}

// «Trenger deg»: ting Emil bør gjøre noe med, med snarvei til riktig fane.
function tegnTrenger() {
  const boks = $("apTrenger");
  if (!boks) return;
  const ting = [];   // { varsle, tekst, fane, knapp, prosjekt }
  const blokk = Array.isArray(D.blokkert) ? D.blokkert.length : 0;
  if (blokk) ting.push({ varsle: true, tekst: flertall(blokk, norsk("blokkert adresse"), norsk("blokkerte adresser")), fane: "system", knapp: norsk("Til System") });
  if (helseFeil()) ting.push({ varsle: true, tekst: norsk("Helsesjekken feiler"), fane: "system", knapp: norsk("Til System") });
  const mangler = vilkårMangler();
  if (D.kort && mangler.length) ting.push({ varsle: true,
    tekst: norsk(mangler.length === 1 ? "{0} bruker har ikke godtatt vilkår {1}" : "{0} brukere har ikke godtatt vilkår {1}", mangler.length, VILKAR_VERSJON),
    fane: "brukere", knapp: norsk("Til Brukere") });
  const vent = D.ventende || [];
  if (vent.length) {
    const først = vent.map(v => v.utløper).filter(Boolean).sort()[0];
    ting.push({ varsle: koderSnart().length > 0,
      tekst: norsk(vent.length === 1 ? "{0} engangskode ikke løst inn" : "{0} engangskoder ikke løst inn", vent.length) +
        (først ? " (" + norsk("går ut {0}", når(først, true)) + ")" : ""),
      fane: "brukere", knapp: norsk("Til Brukere") });
  }
  const lag = D.lagring && D.lagring.prosjekter;
  if (lag) for (const p of prosjektListe) {
    const l = lag[p.prosjekt];
    if (p.status === "avsluttet" && l && l.bytes > 0)
      ting.push({ varsle: false, tekst: norsk("{0} avsluttet – {1} kan ryddes", p.prosjekt + (p.navn ? " " + p.navn : ""), str(l.bytes)),
        fane: "prosjekter", knapp: norsk("Til Prosjekter"), prosjekt: p.prosjekt });
  }
  const venterPåData = !D.kort && !D.blokkert && !D.helse && !D.vilkar;
  if (!ting.length) { boks.innerHTML = tom(venterPåData ? norsk("Henter …") : norsk("Ingenting trenger deg nå ✓")); return; }
  boks.innerHTML = '<ul class="ap-trenger">' + ting.map((t, i) =>
    '<li><span class="ap-prikk' + (t.varsle ? " ap-prikk-varsel" : "") + '" aria-hidden="true"></span><span>' + esc(t.tekst) + '</span>' +
      '<button type="button" data-ting="' + i + '">' + esc(t.knapp) + ' →</button></li>').join("") + '</ul>';
  boks.querySelectorAll("button[data-ting]").forEach(b => {
    const t = ting[Number(b.dataset.ting)];
    b.onclick = () => {
      if (t.prosjekt) { åpent = t.prosjekt; nyKode = null; }
      velgFane(t.fane, true);
      if (t.prosjekt) tegnProsjekter();
    };
  });
}

// ---------- 👥 Brukere ----------
// Prosjektene en bruker eier, fra /admin/prosjekter (eiere[].kortId).
// Admin (Emil) eier det som ikke har noen eier — som i eierCelle().
function prosjekterEidAv(id) {
  return prosjektListe.filter(p => p.status !== "venter" && (Array.isArray(p.eiere) && p.eiere.length
    ? p.eiere.some(e => e.kortId === id) : id === "admin"));
}
function eierChips(id) {
  const l = prosjekterEidAv(id);
  if (!l.length) return '<span class="ap-dempet">–</span>';
  return '<span class="ap-eiere">' + l.map(p =>
    '<button type="button" class="ap-chip ap-chip-nr" data-gaa="' + esc(p.prosjekt) + '" title="' + esc(p.navn || p.prosjekt) + '">' + esc(p.prosjekt) + '</button>').join("") + '</span>';
}

function tegnBrukere() {
  const kropp = $("apBrukere");
  if (!kropp || !D.kort) return;
  const manglerId = new Set(vilkårMangler().map(m => m.id));
  const aktive = brukerListe.filter(k => !k.sperret).length;
  const vent = D.ventende || [];
  $("apBrukerSum").textContent = norsk("{0} aktive", aktive) + " · " + norsk("{0} sperret", brukerListe.length - aktive) +
    (vent.length ? " · " + norsk(vent.length === 1 ? "{0} kode ikke løst inn" : "{0} koder ikke løst inn", vent.length) : "");
  if (åpenBruker && åpenBruker !== "admin" && !brukerListe.some(k => k.id === åpenBruker)) { åpenBruker = null; sammeKode = null; }
  const rad = (k) => {
    const type = k.sperret
      ? '<span class="ap-type">' + esc(k.storm ? "Storm" : norsk("Ekstern")) + '</span> <span class="ap-type ap-sperret">' + esc(norsk("Sperret")) + '</span>'
      : (k.storm ? '<span class="ap-type ap-storm">Storm</span>' : '<span class="ap-type">' + esc(norsk("Ekstern")) + '</span>');
    const åpen = åpenBruker === k.id;
    const vilkår = !k.sperret && manglerId.has(k.id)
      ? esc(k.vilkar || "–") + ' <span class="ap-type ap-venter-merke" title="' + esc(norsk("Har ikke godtatt gjeldende vilkår")) + '">' + esc(norsk("mangler")) + '</span>'
      : esc(k.vilkar || "–");
    const knapper = k.sperret
      ? '<button type="button" data-id="' + esc(k.id) + '" data-sperr="0">' + esc(norsk("Gjenåpne")) + '</button>' +
        '<button type="button" class="ap-fare" data-slett="' + esc(k.id) + '">🗑 ' + esc(norsk("Slett")) + '</button>'
      : '<button type="button" data-endre="' + esc(k.id) + '" aria-expanded="' + åpen + '" title="' + esc(norsk("Endre navn, firma og e-post")) + '" aria-label="' +
          esc(norsk("Endre {0}", k.navn)) + '">✎</button>' +
        '<button type="button" data-samme="' + esc(k.id) + '">🔑 ' + esc(norsk("Ny kode")) + '</button>' +
        '<button type="button" data-id="' + esc(k.id) + '" data-sperr="1">' + esc(norsk("Sperr")) + '</button>';
    return '<tr class="' + (k.sperret ? "ap-rad-sperret" : "") + (åpen ? " ap-rad-apen" : "") + '" title="' +
        esc((k.epost || "") + (k.opplastinger ? " · " + k.opplastinger + " " + norsk("opplastinger") : "")) + '">' +
      '<td><b>' + esc(k.navn) + '</b></td><td>' + esc(k.firma) + '</td><td>' + type + '</td>' +
      '<td>' + vilkår + '</td><td>' + esc(når(k.sistBrukt)) + '</td><td>' + eierChips(k.id) + '</td>' +
      '<td class="ap-handling"><span class="ap-radknapper">' + knapper + '</span></td></tr>' +
      (åpen ? brukerDetalj(k) : "");
  };
  const admin = '<tr><td><b>Emil (admin)</b></td><td>Storm</td><td><span class="ap-type ap-storm">Storm</span></td><td>–</td><td>' +
    esc(norsk("i dag")) + '</td><td>' + eierChips("admin") + '</td><td class="ap-handling ap-dempet">admin</td></tr>';
  const ventende = vent.map(v => {
    const snart = v.utløper && Date.parse(v.utløper) < Date.now() + 24 * 3600000;
    return '<tr class="ap-rad-ventende"><td>' + esc(v.navn) + '</td><td>' + esc(v.firma) + '</td><td><span class="ap-type">' +
      esc(norsk("Kode sendt")) + '</span></td><td>–</td><td' + (snart ? ' class="ap-oransje"' : "") + '>' + esc(norsk("går ut {0}", når(v.utløper, true))) +
      '</td><td></td><td></td></tr>';
  }).join("");
  kropp.innerHTML = admin + brukerListe.map(rad).join("") + ventende;
  kobleBrukere(kropp);
}

function brukerDetalj(k) {
  const visKode = sammeKode && sammeKode.id === k.id;
  return '<tr class="ap-detalj"><td colspan="7"><div class="ap-bruker-grid">' +
    '<section class="ap-kol"><label>' + esc(norsk("Navn")) + '<input id="apEndreNavn" maxlength="60" autocomplete="off" value="' + esc(k.navn) + '"></label>' +
      '<label>' + esc(norsk("Firma")) + '<input id="apEndreFirma" maxlength="80" autocomplete="off" value="' + esc(k.firma) + '"></label>' +
      '<label>' + esc(norsk("E-post")) + '<input id="apEndreEpost" type="email" maxlength="120" autocomplete="off" value="' + esc(k.epost) + '"></label>' +
      '<div class="ap-knapper"><button type="button" class="primary" id="apEndreLagre">' + esc(norsk("Lagre")) + '</button>' +
        '<button type="button" id="apEndreAvbryt">' + esc(norsk("Avbryt")) + '</button></div>' +
      '<p class="kb-feil" id="apEndreFeil"></p></section>' +
    '<section class="ap-kol"><h3>' + esc(norsk("Eier prosjekter")) + '</h3>' + eierChips(k.id) +
      '<p class="ap-dempet">' + esc(norsk("Legg til eller fjern eier i Byggeplass-prosjekter.")) + '</p>' +
      '<div><button type="button" id="apTilProsjekter">' + esc(norsk("Til Byggeplass-prosjekter")) + ' →</button></div></section>' +
    '<section class="ap-kol"><h3>' + esc(norsk("Ny kode til samme person")) + '</h3>' +
      '<p class="ap-dempet">' + esc(norsk("Gammelt kort sperres og en ny engangskode lages med samme navn, firma og e-post. Eierskap flyttes over når koden løses inn.")) + '</p>' +
      (visKode ? '<div id="apSammeUt" class="ap-kodeut"></div>'
        : (k.sperret ? '<p class="ap-dempet">' + esc(norsk("Kortet er sperret.")) + '</p>'
          : '<div><button type="button" id="apSammeKnapp">🔑 ' + esc(norsk("Lag ny kode til {0}", k.navn)) + '</button></div>')) +
    '</section>' +
  '</div></td></tr>';
}

function kobleBrukere(kropp) {
  kropp.querySelectorAll("button[data-gaa]").forEach(b => { b.onclick = () => gåTilProsjekt(b.dataset.gaa); });
  kropp.querySelectorAll("button[data-id]").forEach(b => {
    b.onclick = async () => {
      const sperr = b.dataset.sperr === "1";
      if (sperr && !confirm(norsk("Sperre kortet? Personen mister tilgangen med en gang."))) return;
      b.disabled = true;
      try {
        await kall(sperr ? "/kort/sperr" : "/kort/gjenapne", { json: { id: b.dataset.id } });
        await Promise.all([hentBrukere(), hentTall(), hentVilkar()]);
      } catch (err) { b.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
    };
  });
  kropp.querySelectorAll("button[data-slett]").forEach(b => {
    b.onclick = async () => {
      const k = brukerListe.find(x => x.id === b.dataset.slett) || {};
      if (!confirm(norsk("Slette kortet til {0} for godt? Det kan ikke angres. Prosjektene personen eier, blir liggende.", k.navn || ""))) return;
      b.disabled = true;
      try {
        await kall("/kort/slett", { json: { id: b.dataset.slett } });
        if (åpenBruker === b.dataset.slett) { åpenBruker = null; sammeKode = null; }
        await Promise.all([hentBrukere(), hentTall(), hentVilkar()]);
      } catch (err) { b.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke å slette: ") + err.message); }
    };
  });
  kropp.querySelectorAll("button[data-endre]").forEach(b => {
    b.onclick = () => {
      åpenBruker = åpenBruker === b.dataset.endre ? null : b.dataset.endre;
      if (!sammeKode || sammeKode.id !== åpenBruker) sammeKode = null;   // koden vises bare mens raden er åpen
      tegnBrukere();
      // preventScroll: på telefon ruller tabellen sidelengs, og fokus skal ikke dra den bort fra navnene
      const navn = $("apEndreNavn"); if (navn) navn.focus({ preventScroll: true });
    };
  });
  kropp.querySelectorAll("button[data-samme]").forEach(b => {
    b.onclick = () => nyKodeSamme(brukerListe.find(x => x.id === b.dataset.samme), b);
  });
  const k = brukerListe.find(x => x.id === åpenBruker);
  if (!k || !$("apEndreLagre")) return;
  $("apEndreAvbryt").onclick = () => { åpenBruker = null; sammeKode = null; tegnBrukere(); };
  $("apEndreLagre").onclick = () => lagreBruker(k);
  ["apEndreNavn", "apEndreFirma", "apEndreEpost"].forEach(id => {
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") lagreBruker(k); });
  });
  $("apTilProsjekter").onclick = () => velgFane("prosjekter", true);
  const knapp = $("apSammeKnapp");
  if (knapp) knapp.onclick = () => nyKodeSamme(k, knapp);
  if (sammeKode && sammeKode.id === k.id && $("apSammeUt")) visKodeUt($("apSammeUt"), sammeKode.navn, sammeKode.kode);
}

async function lagreBruker(k) {
  const navn = $("apEndreNavn").value.trim(), firma = $("apEndreFirma").value.trim(), epost = $("apEndreEpost").value.trim();
  const feil = $("apEndreFeil");
  if (!navn) { feil.textContent = norsk("Navnet kan ikke være tomt."); $("apEndreNavn").focus(); return; }
  const knapp = $("apEndreLagre");
  knapp.disabled = true;
  try {
    const j = await (await kall("/kort/endre", { json: { id: k.id, navn, firma, epost } })).json();
    if (j.kort) Object.assign(k, j.kort);
    åpenBruker = null; sammeKode = null;     // raden lukkes; de nye verdiene står i tabellen
    await Promise.all([hentBrukere(), hentProsjekter()]);    // navnet står også som eier i prosjektene
  } catch (err) {
    if (err.message !== "403" && $("apEndreFeil")) $("apEndreFeil").textContent = err.message;
  } finally { if ($("apEndreLagre")) $("apEndreLagre").disabled = false; }
}

// «Ny kode til samme person»: Workeren sperrer det gamle kortet med en gang
// og lager en engangskode med samme navn/firma/e-post. Når koden løses inn,
// overtar det nye kortet eierskapet (kontrakt/runde2.md punkt 2).
async function nyKodeSamme(k, knapp) {
  if (!k) return;
  if (!confirm(norsk("Lage ny kode til {0}? Det gamle kortet sperres med en gang. Eierskapet flyttes over når den nye koden løses inn.", k.navn))) return;
  if (knapp) knapp.disabled = true;
  try {
    const j = await (await kall("/kort/ny-kode-samme", { json: { id: k.id } })).json();
    sammeKode = { id: k.id, kode: j.kode, navn: j.navn || k.navn };
    åpenBruker = k.id;
    await Promise.all([hentBrukere(), hentVilkar()]);
    tegnBrukere();
    const ut = $("apSammeUt"); if (ut && ut.scrollIntoView) ut.scrollIntoView({ block: "nearest" });
  } catch (err) {
    if (knapp) knapp.disabled = false;
    if (err.message !== "403") varsel(norsk("Klarte ikke å lage ny kode: ") + err.message);
  }
}

function visNyKodeSkjema(vis) {
  const boks = $("apNyKodeBoks"), knapp = $("apNyKodeKnapp");
  boks.hidden = !vis;
  knapp.setAttribute("aria-expanded", String(vis));
  // Rødt bare på hovedhandlingen: når skjemaet er åpent, er det «Lag engangskode»
  knapp.classList.toggle("primary", !vis);
  $("apLag").classList.toggle("primary", vis);
  knapp.textContent = vis ? "✕ " + norsk("Lukk") : "+ " + norsk("Ny kode");
  if (vis) $("apNavn").focus();
  else $("apKodeUt").innerHTML = "";          // koden skal ikke bli liggende
}

// Engangskoden vises ÉN gang — Worker-en lagrer bare hashen. Brukes både av
// «+ Ny kode» og «Ny kode til samme person», så meldingen er helt lik.
function visKodeUt(ut, navn, kode) {
  const adresse = location.origin + location.pathname.replace(/[^/]*$/, "");
  const melding = norsk("Hei {0}!", String(navn || "").split(" ")[0]) + "\n\n" +
    norsk("Her er koden din til Storm IFC: {0}", kode) + "\n\n" +
    norsk("Åpne {0}, trykk på «Gratisversjon» øverst (eller et verktøy med 🔒) og skriv inn koden.", adresse) + "\n" +
    norsk("Koden virker én gang og går ut om 48 timer. Etter det husker nettleseren tilgangen.") + "\n";
  ut.innerHTML =
    '<p class="ap-kodetekst">' + esc(norsk("Kode til {0} — gyldig i 48 t, kan brukes én gang:", navn)) + '</p>' +
    '<div class="ap-kode">' + esc(kode) + '</div>' +
    '<div class="ap-knapper"><button type="button" data-kopier="kode">📋 ' + esc(norsk("Kopier")) + '</button>' +
    '<button type="button" data-kopier="melding">✉ ' + esc(norsk("Kopier som melding")) + '</button></div>';
  const kopier = async (tekst, b) => {
    try { await navigator.clipboard.writeText(tekst); b.textContent = "✓ " + norsk("Kopiert"); }
    catch (_) { prompt(norsk("Kopier teksten:"), tekst); }
  };
  ut.querySelectorAll("button[data-kopier]").forEach(b => {
    b.onclick = () => kopier(b.dataset.kopier === "kode" ? kode : melding, b);
  });
}

async function lagKode() {
  const navn = $("apNavn").value.trim(), firma = $("apFirma").value.trim(), epost = $("apEpost").value.trim();
  const storm = $("apStorm").checked;
  const ut = $("apKodeUt");
  if (!navn) { ut.innerHTML = '<p class="kb-feil">' + esc(norsk("Skriv navnet til den som skal ha koden.")) + '</p>'; return; }
  const knapp = $("apLag");
  knapp.disabled = true;
  try {
    const j = await (await kall("/kort/ny-kode", { json: { navn, firma, epost, storm } })).json();
    visKodeUt(ut, navn, j.kode);
    $("apNavn").value = ""; $("apFirma").value = ""; $("apEpost").value = ""; $("apStorm").checked = false;
    hentBrukere();
  } catch (err) {
    if (err.message !== "403") ut.innerHTML = '<p class="kb-feil">' + esc(err.message) + '</p>';
  } finally { knapp.disabled = false; }
}

async function lastNedExcel() {
  try {
    const blob = await (await kall("/kort/liste?csv=1")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "storm-ifc-kort-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke å laste ned: ") + err.message); }
}

// ---------- ⚙ System ----------
function tegnHelse() {
  const boks = $("apHelse");
  if (!boks) return;
  const h = D.helse;
  if (!h) { boks.innerHTML = henter(); return; }
  const feil = helseFeil();
  const l = D.lagring && !D.lagring.feil ? D.lagring : null;
  const svarer = !h.feil;
  boks.innerHTML =
    '<p class="ap-helse ' + (feil ? "ap-helse-feil" : "ap-helse-ok") + '">● ' +
      esc(svarer ? norsk("Workeren svarer · {0} ms", h.rundtur) : norsk("Workeren svarer ikke")) + '</p>' +
    '<p class="ap-dempet">' + esc(svarer
      ? norsk("Sjekket {0}", klokke(h.sjekket)) + (h.versjon ? " · " + norsk("versjon {0}", h.versjon) : "") + " · " +
        (h.kv && h.r2 ? norsk("KV og R2 svarer") : norsk("KV {0} · R2 {1}", h.kv ? "OK" : norsk("svarer ikke"), h.r2 ? "OK" : norsk("svarer ikke"))) +
        (typeof h.ms === "number" ? " · " + norsk("{0} ms i Workeren", h.ms) : "")
      : norsk("Sjekket {0}", klokke(h.sjekket)) + " · " + h.feil) + '</p>' +
    '<p class="ap-dempet">' + (l ? esc(norsk("Lagring brukt:")) + ' <b>' + esc(str(l.totalt)) + '</b> ' + esc(norsk("av 10 GB gratis")) +
        (l.antall !== undefined ? " · " + esc(flertall(l.antall, norsk("fil"), norsk("filer"))) : "")
      : esc(D.lagring && D.lagring.feil ? norsk("Lagring: {0}", D.lagring.feil) : norsk("Lagring: henter …"))) + '</p>' +
    '<div class="ap-strek" role="progressbar" aria-label="' + esc(norsk("Lagring brukt av 10 GB")) + '" aria-valuemin="0" aria-valuemax="100"><span></span></div>';
  const andel = l ? Math.min(100, Math.round(l.totalt / GRATIS * 1000) / 10) : 0;
  const strek = boks.querySelector(".ap-strek");
  strek.setAttribute("aria-valuenow", String(andel));
  const fyll = strek.querySelector("span");
  fyll.style.width = andel + "%";
  if (andel >= 80) fyll.classList.add("ap-strek-varsel");
}

function tegnBlokkert() {
  const boks = $("apBlokkert"), tall = $("apBlokkertTall");
  if (!boks || !D.blokkert) return;
  tall.textContent = D.blokkert.length; tall.hidden = !D.blokkert.length;
  tall.classList.toggle("ap-varsel", D.blokkert.length > 0);
  if (!D.blokkert.length) { boks.innerHTML = tom(norsk("Ingen adresser er blokkert nå.")); return; }
  boks.innerHTML = '<table class="ap-tabell ap-logg"><tbody>' + D.blokkert.map(b =>
    '<tr><td class="ap-mono">' + esc(b.ip) + '</td>' +
      '<td class="ap-dempet ap-nowrap">' + esc([b.feil !== null && b.feil !== undefined ? norsk("{0} feil", b.feil) : "", b.utløper ? norsk("til {0}", klokke(b.utløper)) : ""].filter(Boolean).join(" · ") || "–") + '</td>' +
      '<td class="ap-handling"><button type="button" data-opphev="' + esc(b.ip) + '">' + esc(norsk("Opphev")) + '</button></td></tr>').join("") +
    '</tbody></table>';
  boks.querySelectorAll("button[data-opphev]").forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      try { await kall("/admin/opphev", { json: { ip: b.dataset.opphev } }); await hentBlokkert(); }
      catch (err) { b.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
    };
  });
}

function tegnVilkår() {
  const boks = $("apVilkar");
  if (!boks || !D.vilkar) return;
  const v = D.vilkar, mangler = v.mangler || [];
  boks.innerHTML =
    '<p>' + esc(norsk("Gjeldende versjon:")) + ' <b>' + esc(VILKAR_VERSJON) + '</b></p>' +
    '<p class="ap-dempet">' + esc(norsk("{0} av {1} har godtatt", v.godtatt, v.totalt) + " · " + norsk("{0} venter", mangler.length)) +
      (v.krav ? " · " + esc(norsk("krevd på nytt {0}", når(v.krav, true))) : "") + '</p>' +
    (mangler.length ? '<p class="ap-dempet">' + esc(norsk("Venter:")) + ' ' + mangler.map(m =>
      esc(m.navn) + (m.firma ? ' <span class="ap-dempet">(' + esc(m.firma) + ')</span>' : "")).join(", ") + '</p>' : "");
}

async function krevVilkår() {
  if (!confirm(norsk("Kreve at alle godtar vilkårene på nytt? Alle kort får vilkårene opp igjen ved neste åpning. Ingen mister tilgang til data."))) return;
  const b = $("apVilkarKrav");
  b.disabled = true;
  try { await kall("/admin/vilkar-krav", { json: {} }); await hentVilkar(); varsel(norsk("Alle må godta vilkårene på nytt.")); }
  catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
  finally { if ($("apVilkarKrav")) $("apVilkarKrav").disabled = false; }
}

// ---------- 🏗 Byggeplass-prosjekter ----------
function gåTilProsjekt(nr) {
  åpent = nr; nyKode = null;
  velgFane("prosjekter", true);
  tegnProsjekter();
}

const plassCelle = (nr) => {
  const l = D.lagring && D.lagring.prosjekter && D.lagring.prosjekter[nr];
  if (!D.lagring) return '<span class="ap-dempet">…</span>';
  return l ? esc(str(l.bytes)) : '<span class="ap-dempet">–</span>';
};
const sistCelle = (nr) => {
  const l = D.lagring && D.lagring.prosjekter && D.lagring.prosjekter[nr];
  return l && l.sist ? esc(når(l.sist, true)) : '<span class="ap-dempet">–</span>';
};
// Lagringen kommer i et eget svar. Bare cellene byttes, så en utfoldet rad
// (med et halvskrevet nøkkelfelt) ikke tegnes på nytt.
function oppdaterPlassCeller() {
  document.querySelectorAll("#apProsjekter td[data-plass]").forEach(td => { td.innerHTML = plassCelle(td.dataset.plass); });
  document.querySelectorAll("#apProsjekter td[data-sist]").forEach(td => { td.innerHTML = sistCelle(td.dataset.sist); });
}

function tegnProsjekter() {
  const kropp = $("apProsjekter");
  if (!kropp || !prosjekterHentet) return;
  const visAvsl = $("apVisAvsluttet").checked;
  const aktive = prosjektListe.filter(p => p.status !== "avsluttet").length;
  $("apProsjektTall").textContent = aktive + " " + norsk("aktive") + " · " + (prosjektListe.length - aktive) + " " + norsk("avsluttet");
  const liste = prosjektListe.filter(p => visAvsl || p.status !== "avsluttet" || p.prosjekt === åpent);
  if (!liste.length) { kropp.innerHTML = '<tr><td colspan="8" class="ap-tom">' + esc(norsk("Ingen prosjekter.")) + '</td></tr>'; return; }
  const merke = { aktiv: '<span class="ap-type ap-aktiv">' + esc(norsk("Aktiv")) + '</span>',
    venter: '<span class="ap-type ap-venter-merke">' + esc(norsk("Venter")) + '</span>',
    avsluttet: '<span class="ap-type ap-sperret">' + esc(norsk("Avsluttet")) + '</span>' };
  if (åpent && !liste.some(p => p.prosjekt === åpent)) åpent = null;
  kropp.innerHTML = liste.map(p =>
    '<tr class="' + (p.status === "avsluttet" ? "ap-rad-sperret" : "") + (p.prosjekt === åpent ? " ap-rad-apen" : "") + '">' +
      '<td><button type="button" class="ap-utvid" data-utvid="' + esc(p.prosjekt) + '" aria-expanded="' + (p.prosjekt === åpent) + '" title="' +
        esc(norsk("Montørkode, QR, logg og filer")) + '"><span aria-hidden="true">' + (p.prosjekt === åpent ? "▾" : "▸") + '</span> <b>' + esc(p.prosjekt) + '</b></button></td><td>' +
        (p.navn ? esc(p.navn) + ' <button type="button" class="ap-navn" data-navn="' + esc(p.prosjekt) + '" title="' + esc(norsk("Bytt navn")) + '">✎</button>'
                : '<button type="button" class="ap-navn ap-mangler" data-navn="' + esc(p.prosjekt) + '">✎ ' + esc(norsk("Gi navn")) + '</button>') + '</td>' +
      '<td>' + eierCelle(p) + '</td>' +
      '<td>' + (p.harKode ? esc(norsk("Ja")) + (p.kodeLaget ? ' <span class="ap-dempet">· ' + esc(når(p.kodeLaget)) + '</span>' : "")
                          : '<span class="ap-dempet">' + esc(norsk("Ikke laget")) + '</span>') + '</td>' +
      '<td class="ap-nowrap" data-plass="' + esc(p.prosjekt) + '">' + plassCelle(p.prosjekt) + '</td>' +
      '<td class="ap-nowrap" data-sist="' + esc(p.prosjekt) + '">' + sistCelle(p.prosjekt) + '</td>' +
      '<td>' + merke[p.status] + (p.status === "avsluttet" ? ' <span class="ap-dempet">' + esc(når(p.avsluttetTid)) + '</span>' : "") + '</td>' +
      '<td class="ap-handling"><button type="button" data-nr="' + esc(p.prosjekt) + '" data-aktiv="' + (p.status === "avsluttet" ? "1" : "0") + '"' +
        (p.status === "avsluttet" ? ' class="ap-ok"' : "") + '>' +
        esc(p.status === "avsluttet" ? norsk("▶ Aktiver") : norsk("⏹ Avslutt")) + '</button></td></tr>' +
    (p.prosjekt === åpent ? detaljRad(p) : "")).join("");
  kobleEiere(kropp);
  kropp.querySelectorAll("button[data-utvid]").forEach(b => {
    b.onclick = () => {
      const nr = b.dataset.utvid;
      åpent = åpent === nr ? null : nr;
      if (nyKode && nyKode.prosjekt !== åpent) nyKode = null;   // koden vises bare så lenge raden er åpen
      tegnProsjekter();
    };
  });
  if (åpent) kobleDetalj(liste.find(p => p.prosjekt === åpent));
  kropp.querySelectorAll("button[data-navn]").forEach(b => {
    b.onclick = async () => {
      const nr = b.dataset.navn, p = prosjektListe.find(x => x.prosjekt === nr) || {};
      const navn = prompt(norsk("Navn på prosjekt {0}:", nr), p.navn || "");
      if (navn === null || !navn.trim()) return;
      try {
        await kall("/admin/prosjekt-navn", { json: { prosjekt: nr, navn: navn.trim() } });
        await hentProsjekter();
      } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
    };
  });
  kropp.querySelectorAll("button[data-nr]").forEach(b => {
    b.onclick = async () => {
      const aktiv = b.dataset.aktiv === "1", nr = b.dataset.nr;
      if (!aktiv && !confirm(norsk("Avslutte prosjekt {0}? Montørene kommer ikke inn lenger, heller ikke de som har siden åpen. Ingenting slettes, og du kan aktivere det igjen.", nr))) return;
      b.disabled = true;
      try {
        await kall("/admin/prosjekt-aktiv", { json: { prosjekt: nr, aktiv } });
        await hentProsjekter();
      } catch (err) { b.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
    };
  });
}

// 👥 Eiere per prosjekt (Emil 19.10): «Prosjektet tilhører en annen bruker»
// hadde ingen vei ut. Nå står eierne som små merker med ×, og «+ Eier» gir en
// liste over brukerne som kan legges til. Alle eierne har samme tilgang.
// Administrator har alltid tilgang uansett.
function eierCelle(p) {
  if (p.status === "venter") return esc(p.eier) + (p.firma ? ' <span class="ap-dempet">· ' + esc(p.firma) + '</span>' : "") +
    ' <span class="ap-dempet">(' + esc(norsk("godkjenn først")) + ')</span>';
  const eiere = Array.isArray(p.eiere) && p.eiere.length ? p.eiere : [{ kortId: "admin", navn: p.eier, firma: p.firma }];
  const enAdmin = eiere.length === 1 && eiere[0].kortId === "admin";
  return '<div class="ap-eiere">' + eiere.map(e =>
    '<span class="ap-eier">' + esc(e.navn) + (e.firma ? ' <span class="ap-dempet">· ' + esc(e.firma) + '</span>' : "") +
    (enAdmin ? "" : ' <button type="button" class="ap-eier-x" data-fjern="' + esc(e.kortId) + '" data-p="' + esc(p.prosjekt) + '" title="' +
      esc(norsk("Fjern {0} som eier", e.navn)) + '" aria-label="' + esc(norsk("Fjern {0} som eier", e.navn)) + '">×</button>') + '</span>').join("") +
    ' <button type="button" class="ap-navn ap-eier-pluss" data-leggtil="' + esc(p.prosjekt) + '">+ ' + esc(norsk("Eier")) + '</button></div>';
}

function kobleEiere(kropp) {
  kropp.querySelectorAll("button[data-fjern]").forEach(b => {
    b.onclick = async () => {
      const nr = b.dataset.p, p = prosjektListe.find(x => x.prosjekt === nr) || {};
      const e = (p.eiere || []).find(x => x.kortId === b.dataset.fjern) || {};
      const sist = (p.eiere || []).length === 1;
      if (!confirm(norsk("Fjerne {0} som eier av {1}?", e.navn || "", nr) + (sist ? " " + norsk("Da blir Admin (Emil) eier.") : ""))) return;
      b.disabled = true;
      try { await kall("/admin/prosjekt-eier", { json: { prosjekt: nr, kortId: b.dataset.fjern, fjern: true } }); await hentProsjekter(); }
      catch (err) { b.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
    };
  });
  kropp.querySelectorAll("button[data-leggtil]").forEach(b => {
    b.onclick = () => {
      const nr = b.dataset.leggtil, p = prosjektListe.find(x => x.prosjekt === nr) || {};
      const har = new Set((p.eiere || []).map(e => e.kortId));
      const kan = brukerListe.filter(k => !k.sperret && !har.has(k.id));
      const celle = b.parentElement;
      if (celle.querySelector(".ap-eier-velg")) return;
      if (!kan.length) { varsel(norsk("Alle brukerne er allerede eiere. Lag en ny kode under Brukere → «+ Ny kode» for å gi en ny person tilgang.")); return; }
      const boks = document.createElement("span");
      boks.className = "ap-eier-velg";
      boks.innerHTML = '<select aria-label="' + esc(norsk("Velg bruker")) + '"><option value="">' + esc(norsk("Velg bruker …")) + '</option>' +
        kan.map(k => '<option value="' + esc(k.id) + '">' + esc(k.navn) + (k.firma ? " · " + esc(k.firma) : "") + '</option>').join("") +
        '</select> <button type="button" class="ap-ok">' + esc(norsk("Legg til")) + '</button> <button type="button">' + esc(norsk("Avbryt")) + '</button>';
      celle.appendChild(boks);
      const [velg, ok, avbryt] = [boks.querySelector("select"), ...boks.querySelectorAll("button")];
      velg.focus();
      avbryt.onclick = () => boks.remove();
      ok.onclick = async () => {
        if (!velg.value) { velg.focus(); return; }
        ok.disabled = true;
        try { await kall("/admin/prosjekt-eier", { json: { prosjekt: nr, kortId: velg.value } }); await hentProsjekter(); }
        catch (err) { ok.disabled = false; if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
      };
    };
  });
}

// ---------- ▾ Utfoldet prosjektrad: montørkode, QR og logg (Emil 19.10, alternativ A) ----------
// Runde 2: Filer som tredje del — se «Filer» lenger ned.
// Utseendet: «Storm IFC-Viewer adminpanel montorkode og logg prove A 2026-10-19.png».
// Montørkoden lagres bare som hash i Workeren (POST /ny-kode), så panelet kan
// ALDRI vise en gammel kode — bare lage en ny. QR-en har ikke koden i seg, bare
// adressen WORKER/<nr>, så den kan vises og lastes ned når som helst uten at
// plakaten på brakkeveggen slutter å virke.

const LOGG_SIDE = 25;
const FILTRE = [
  ["alle", "Alle"], ["feil", "⚠ Feil"], ["opplasting", "Opplasting"], ["montor", "Montører"], ["admin", "Admin"]
];

// Hvilken gruppe en logglinje hører til. Montørene har ikke navn (de skriver
// bare prosjektkoden), så linjer uten «hvem» fra byggeplassen er «Montør».
function kategori(r) {
  if (r.ok === false) return "feil";
  if (r.hvem === "Admin") return "admin";
  const hva = String(r.hva || "");
  if (/^(opplasting|arkivert|slettet|prosjekt slettet)/.test(hva)) return "opplasting";
  if (hva === "morgenvarsel") return "system";
  if (!r.hvem) return "montor";
  return "bruker";
}
function hvemTekst(r) {
  if (r.hvem) return r.hvem;
  // Sletting krever slettenøkkelen (ikke montørkoden) — Workeren logger ingen «hvem» for den
  if (/^(slettet|prosjekt slettet)/.test(String(r.hva || ""))) return norsk("Slettenøkkel");
  return kategori(r) === "system" ? norsk("System") : norsk("Montør");
}
function detaljTekst(r) {
  const d = [];
  if (r.fil) d.push(String(r.fil).split("/").pop());
  if (r.rev) d.push("rev " + r.rev);
  if (r.seksjon) d.push(r.seksjon);
  if (r.for) d.push(norsk("for {0}", r.for));
  if (r.antall !== undefined) d.push(r.antall + " " + norsk("filer"));
  if (r.forsøk) d.push(norsk("{0}. forsøk fra samme adresse", r.forsøk));
  return d.join(" · ") || "–";
}
const adresseFor = (nr) => W() + "/" + nr;

function detaljRad(p) {
  const venter = p.status === "venter";
  const kodeTekst = p.harKode
    ? norsk("Montørkode laget {0}. Den lagres bare som fingeravtrykk og kan ikke vises igjen.", når(p.kodeLaget || p.laget, true))
    : norsk("Ingen montørkode ennå — montørene kommer ikke inn før du lager en.");
  const visNy = nyKode && nyKode.prosjekt === p.prosjekt;
  const m = loggMinne.get(p.prosjekt);
  return '<tr class="ap-detalj"><td colspan="8"><div class="ap-detalj-grid">' +
    '<section class="ap-kol ap-kodekol"><h3>' + esc(norsk("Montørkode og QR")) + '</h3>' +
      '<div class="ap-qr-rad"><div class="ap-qr" id="apQr"><span class="ap-dempet">' + esc(norsk("Lager QR …")) + '</span></div>' +
      '<div class="ap-qr-tekst">' +
        '<p class="ap-dempet">' + esc(norsk("QR-en peker bare på prosjektet — den virker alltid, også etter ny kode.")) + '</p>' +
        '<p class="ap-adresse">' + esc(adresseFor(p.prosjekt)) + '</p>' +
        '<div class="ap-knapper"><button type="button" id="apQrPng">⬇ ' + esc(norsk("Last ned QR som PNG")) + '</button>' +
          '<button type="button" id="apQrSkriv">🖨 ' + esc(norsk("Skriv ut plakat")) + '</button></div>' +
        '<p class="ap-dempet ap-kodeinfo">' + esc(kodeTekst) + '</p>' +
        (visNy
          ? '<div class="ap-kode ap-montorkode"><span class="ap-kodetekst">' + esc(norsk("Ny montørkode — vises bare nå, skriv den ned:")) + '</span>' +
              '<b>' + esc(nyKode.kode) + '</b></div>' +
            '<div class="ap-knapper"><button type="button" id="apMkKopier">📋 ' + esc(norsk("Kopier")) + '</button>' +
              '<button type="button" id="apMkMelding">✉ ' + esc(norsk("Kopier som melding")) + '</button></div>'
          : venter
            ? '<p class="ap-dempet">' + esc(norsk("Godkjenn prosjektet først, så kan du lage montørkode.")) + '</p>'
            : '<button type="button" class="primary" id="apNyMk">' + esc(p.harKode ? norsk("↻ Lag ny montørkode") : norsk("Lag montørkode")) + '</button>' +
              (p.harKode ? '<p class="ap-dempet">' + esc(norsk("Den gamle koden slutter å virke med en gang.")) + '</p>' : "")) +
        (p.status === "avsluttet" ? '<p class="ap-dempet">' + esc(norsk("Prosjektet er avsluttet — koden virker først når du aktiverer det igjen.")) + '</p>' : "") +
      '</div></div>' +
    '</section>' +
    '<section class="ap-kol ap-loggkol"><div class="ap-kolhode"><h3>' + esc(norsk("Logg")) + ' · ' + esc(p.prosjekt) +
        ' <span class="ap-dempet" id="apLoggTall"></span></h3>' +
      '<span class="ap-knapper"><button type="button" id="apLoggOppdater" title="' + esc(norsk("Hent loggen på nytt")) + '">↻</button>' +
        '<button type="button" id="apLoggExcel">⬇ Excel</button></span></div>' +
      '<div class="ap-filtre" id="apLoggFiltre"></div>' +
      '<div class="ap-tabell-boks"><table class="ap-tabell ap-logg"><thead><tr><th>' + esc(norsk("Når")) + '</th><th>' + esc(norsk("Hva")) +
        '</th><th>' + esc(norsk("Hvem")) + '</th><th>' + esc(norsk("Fil / detalj")) + '</th></tr></thead>' +
        '<tbody id="apLogg"><tr><td colspan="4" class="ap-tom">' + esc(m ? "" : norsk("Henter …")) + '</td></tr></tbody></table></div>' +
      '<div class="ap-dempet ap-logg-fot" id="apLoggFot"></div>' +
    '</section>' +
    filerSeksjon() +
  '</div></td></tr>';
}

function kobleDetalj(p) {
  if (!p) return;
  const nr = p.prosjekt;
  // QR — samme bibliotek og samme adresse som QR-plakaten etter opplasting
  qrDataUrl(adresseFor(nr), 512).then(url => {
    const rute = $("apQr");
    if (!rute || åpent !== nr) return;
    rute.innerHTML = url ? '<img alt="QR ' + esc(nr) + '" src="' + url + '">' : '<span class="kb-feil">' + esc(norsk("Fikk ikke laget QR")) + '</span>';
    rute.dataset.url = url || "";
  });
  const qrUrl = () => ($("apQr") && $("apQr").dataset.url) || "";
  $("apQrPng").onclick = () => {
    if (!qrUrl()) return varsel(norsk("QR-en er ikke klar ennå."));
    const a = document.createElement("a");
    a.href = qrUrl(); a.download = "byggeplass-QR-" + nr + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  };
  $("apQrSkriv").onclick = () => skrivPlakat(p, qrUrl());
  const ny = $("apNyMk");
  if (ny) ny.onclick = () => lagMontørkode(p, ny);
  if (nyKode && nyKode.prosjekt === nr) {
    const melding = norsk("Byggeplass {0}{1}", nr, p.navn ? " " + p.navn : "") + "\n" +
      norsk("Åpne {0} (eller skann QR-en på brakka) og skriv koden: {1}", adresseFor(nr), nyKode.kode) + "\n";
    const kopier = async (tekst, b) => {
      try { await navigator.clipboard.writeText(tekst); b.textContent = "✓ " + norsk("Kopiert"); }
      catch (_) { prompt(norsk("Kopier teksten:"), tekst); }
    };
    $("apMkKopier").onclick = (e) => kopier(nyKode.kode, e.currentTarget);
    $("apMkMelding").onclick = (e) => kopier(melding, e.currentTarget);
  }
  $("apLoggOppdater").onclick = () => { loggMinne.delete(nr); hentLogg(nr); };
  $("apLoggExcel").onclick = () => loggTilExcel(nr);
  if (loggMinne.has(nr)) tegnLogg(nr); else hentLogg(nr);
  kobleFiler(nr);
}

async function lagMontørkode(p, knapp) {
  const nr = p.prosjekt;
  if (p.harKode && !confirm(norsk("Lage ny montørkode for prosjekt {0}? Den gamle koden slutter å virke med en gang, og alle montører må skrive den nye. QR-en er den samme.", nr))) return;
  knapp.disabled = true;
  try {
    const j = await (await kall("/ny-kode", { json: { prosjekt: nr, navn: p.navn || "" } })).json();
    if (j.venter || !j.kode) { varsel(norsk("Prosjektet venter på godkjenning — godkjenn det først.")); return; }
    nyKode = { prosjekt: nr, kode: j.kode };
    loggMinne.delete(nr);          // «ny-kode» skal synes i loggen med en gang
    await hentProsjekter();        // «Ja · i dag» i Montørkode-kolonnen; tegner raden på nytt
  } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke å lage montørkode: ") + err.message); }
  finally { knapp.disabled = false; }
}

async function hentLogg(nr) {
  try {
    const j = await (await kall("/logg/" + nr + "?nyest=1&antall=1000")).json();
    // Eldre Worker (før 19.10) svarer med en ren liste, eldste først
    const rader = Array.isArray(j) ? j.slice().reverse() : (j.rader || []);
    loggMinne.set(nr, { rader, totalt: Array.isArray(j) ? j.length : (j.totalt || rader.length), filter: "alle", vis: LOGG_SIDE });
    if (åpent === nr) tegnLogg(nr);
  } catch (err) {
    const k = $("apLogg");
    if (k && err.message !== "403") k.innerHTML = '<tr><td colspan="4" class="kb-feil">' + esc(err.message) + '</td></tr>';
  }
}

function tegnLogg(nr) {
  const m = loggMinne.get(nr), kropp = $("apLogg");
  if (!m || !kropp) return;
  const tell = { alle: m.rader.length };
  for (const r of m.rader) { const k = kategori(r); tell[k] = (tell[k] || 0) + 1; }
  $("apLoggFiltre").innerHTML = FILTRE.map(([k, tekst]) =>
    '<button type="button" class="ap-chip' + (m.filter === k ? " ap-chip-valgt" : "") + '" data-filter="' + k + '" aria-pressed="' + (m.filter === k) + '">' +
      esc(norsk(tekst)) + ' <span>' + (tell[k] || 0) + '</span></button>').join("");
  $("apLoggFiltre").querySelectorAll("button[data-filter]").forEach(b => {
    b.onclick = () => { m.filter = b.dataset.filter; m.vis = LOGG_SIDE; tegnLogg(nr); };
  });
  const utvalg = m.filter === "alle" ? m.rader : m.rader.filter(r => kategori(r) === m.filter);
  $("apLoggTall").textContent = m.totalt > m.rader.length ? norsk("(nyeste {0} av {1})", m.rader.length, m.totalt) : "";
  if (!utvalg.length) {
    kropp.innerHTML = '<tr><td colspan="4" class="ap-tom">' + esc(m.rader.length ? norsk("Ingen linjer i dette filteret.") : norsk("Ingenting i loggen ennå.")) + '</td></tr>';
    $("apLoggFot").innerHTML = "";
    return;
  }
  kropp.innerHTML = utvalg.slice(0, m.vis).map(r => {
    const feil = r.ok === false;
    return '<tr><td class="ap-dempet ap-nowrap" title="' + esc(r.tid || "") + '">' + esc(når(r.tid, true)) + '</td>' +
      '<td class="' + (feil ? "ap-logg-feil" : "ap-logg-ok") + '">' + (feil ? "⚠ " : "✓ ") + esc(r.hva || "–") + '</td>' +
      '<td>' + esc(hvemTekst(r)) + '</td><td class="ap-dempet">' + esc(detaljTekst(r)) + '</td></tr>';
  }).join("");
  const fot = $("apLoggFot");
  fot.innerHTML = esc(norsk("Viser {0} av {1}", Math.min(m.vis, utvalg.length), utvalg.length)) +
    (utvalg.length > m.vis ? ' · <button type="button" class="ap-lenke" id="apLoggFlere">' + esc(norsk("Vis flere")) + '</button>' : "");
  const flere = $("apLoggFlere");
  if (flere) flere.onclick = () => { m.vis += LOGG_SIDE * 4; tegnLogg(nr); };
}

// CSV med semikolon og BOM — åpnes rett i norsk Excel (samme som brukerlista)
function loggTilExcel(nr) {
  const m = loggMinne.get(nr);
  if (!m || !m.rader.length) return varsel(norsk("Loggen er tom."));
  const celle = (v) => {
    let t = String(v === undefined || v === null ? "" : v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;          // ingen formler fra loggen inn i Excel
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const linjer = [["Tid", "OK", "Hva", "Hvem", "Gruppe", "Detalj"].map(celle).join(";")];
  for (const r of m.rader) linjer.push([r.tid, r.ok === false ? "nei" : "ja", r.hva, hvemTekst(r), kategori(r), detaljTekst(r)].map(celle).join(";"));
  const blob = new Blob(["﻿" + linjer.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "storm-ifc-logg-" + nr + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Plakat til brakkeveggen: QR, nummer, navn og rådet om å åpne før man går
// inn (samme tekst som QR-kortet etter opplasting). Koden står IKKE på
// plakaten — den skal montørene få muntlig eller på melding.
function skrivPlakat(p, qr) {
  if (!qr) return varsel(norsk("QR-en er ikke klar ennå."));
  const ramme = document.createElement("iframe");
  ramme.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(ramme);
  const d = ramme.contentDocument;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title>QR ' + esc(p.prosjekt) + '</title><style>' +
    'body{font-family:Arial,sans-serif;text-align:center;margin:40px;color:#111}h1{font-size:40px;margin:0}h2{font-size:24px;margin:6px 0 24px;font-weight:400}' +
    'img{width:110mm;height:110mm;image-rendering:pixelated}p{font-size:18px;margin:10px 0}.liten{font-size:14px;color:#444}</style></head><body>' +
    '<h1>' + esc(norsk("Prosjekt {0}", p.prosjekt)) + '</h1><h2>' + esc(p.navn || "") + '</h2><img src="' + qr + '" alt="">' +
    '<p>' + esc(norsk("Skann → skriv prosjektkoden → se modellen")) + '</p><p class="liten">' + esc(adresseFor(p.prosjekt)) + '</p>' +
    '<p class="liten">' + esc(norsk("Åpne modellen før du går inn i bygget — inne i betong og armering forsvinner dekningen.")) + '</p>' +
    '</body></html>');
  d.close();
  const img = d.querySelector("img");
  const skriv = () => { try { ramme.contentWindow.focus(); ramme.contentWindow.print(); } finally { setTimeout(() => ramme.remove(), 1000); } };
  if (img.complete) setTimeout(skriv, 50); else img.onload = skriv;
}

// ---------- 🗂 Filer: tredje del av den utfoldede prosjektraden (runde 2, prøvebilde A2) ----------
// Lista kommer fra GET /filer/<nr> → [{ nøkkel, størrelse, lastet }]. R2 har
// ingen mapper, så vi grupperer selv, slik nøklene skrives av Workeren:
//   <nr>/<fil>.glb                    modellen (én rad per modell)
//   <nr>/rev/<n>/<fil>.glb (+ .markeringer.json)   arkivert revisjon (én rad per revisjon)
//   <nr>/bilder/…, tegninger/…, innboks/…           én «mapperad» per mappe
//   <nr>/<fil>.markeringer.json        mapperaden «markeringer»
//   <nr>/modus.json, <nr>/rev/index.json …          «innstillinger» — kan ikke velges:
//      sletter man dem, mister prosjektet modus og revisjonslista, ikke bare plass.
function grupperFiler(nr, liste) {
  const modeller = [], revisjoner = new Map(), mapper = new Map();
  const leggI = (kart, id, mal) => { if (!kart.has(id)) kart.set(id, Object.assign({ id, nøkler: [], bytes: 0, sist: "" }, mal)); return kart.get(id); };
  const tell = (rad, f) => {
    rad.nøkler.push(f.rest); rad.bytes += Number(f.størrelse) || 0;
    const t = f.lastet ? new Date(f.lastet).toISOString() : "";
    if (t > rad.sist) rad.sist = t;
  };
  for (const o of liste || []) {
    const rest = String(o.nøkkel || "").startsWith(nr + "/") ? String(o.nøkkel).slice(nr.length + 1) : String(o.nøkkel || "");
    if (!rest) continue;
    const f = Object.assign({}, o, { rest });
    const deler = rest.split("/");
    let m;
    if (deler.length === 1 && /\.glb$/i.test(rest)) {
      const r = { id: "m:" + rest, navn: rest, type: "modell", modell: rest, nøkler: [], bytes: 0, sist: "", valgbar: true };
      tell(r, f); modeller.push(r);
    } else if ((m = /^rev\/(\d+)\/(.+)$/.exec(rest))) {
      const fil = m[2].replace(/\.markeringer\.json$/i, "");
      tell(leggI(revisjoner, "r:" + m[1] + ":" + fil, { navn: fil + " (rev " + m[1] + ")", type: "revisjon", modell: fil, rev: Number(m[1]), valgbar: true }), f);
    } else if (deler.length > 1 && deler[0] !== "rev") {
      tell(leggI(mapper, "d:" + deler[0], { mappe: deler[0], type: deler[0], valgbar: true }), f);
    } else if (deler.length === 1 && /\.markeringer\.json$/i.test(rest)) {
      tell(leggI(mapper, "d:markeringer", { mappe: "markeringer", type: "markeringer", valgbar: true, løse: true }), f);
    } else {
      tell(leggI(mapper, "x:andre", { mappe: norsk("innstillinger"), type: norsk("innstillinger"), valgbar: false, løse: true }), f);
    }
  }
  modeller.sort((a, b) => a.navn.localeCompare(b.navn, "nb"));
  const rader = [];
  const revListe = [...revisjoner.values()].sort((a, b) => a.modell.localeCompare(b.modell, "nb") || b.rev - a.rev);
  const brukt = new Set();
  for (const mo of modeller) {
    rader.push(mo);
    for (const r of revListe) if (r.modell === mo.modell) { rader.push(r); brukt.add(r.id); }
  }
  // Revisjoner av en modell som ikke ligger der lenger (slettet eller omdøpt)
  for (const r of revListe) if (!brukt.has(r.id)) rader.push(r);
  for (const d of [...mapper.values()].sort((a, b) => (a.valgbar === b.valgbar ? a.mappe.localeCompare(b.mappe, "nb") : a.valgbar ? -1 : 1))) {
    d.navn = (d.løse ? d.mappe : d.mappe + "/") + " (" + flertall(d.nøkler.length, norsk("fil"), norsk("filer")) + ")";
    rader.push(d);
  }
  return rader;
}

// Alle revisjoner unntatt den nyeste per modell (prøvebilde A2: rev 3 står, rev 2 og 1 velges)
function gamleRevisjoner(rader) {
  const nyeste = new Map();
  for (const r of rader) if (r.type === "revisjon" && (!nyeste.has(r.modell) || r.rev > nyeste.get(r.modell))) nyeste.set(r.modell, r.rev);
  return rader.filter(r => r.type === "revisjon" && r.rev < nyeste.get(r.modell)).map(r => r.id);
}

function filerSeksjon() {
  return '<section class="ap-kol ap-filkol"><div class="ap-kolhode"><h3>' + esc(norsk("Filer")) + ' <span id="apFilSum"></span></h3>' +
      '<span class="ap-dempet" id="apFilTotal"></span></div>' +
    '<div class="ap-tabell-boks"><table class="ap-tabell ap-logg ap-filer"><thead><tr>' +
      '<th><input type="checkbox" id="apFilAlle" aria-label="' + esc(norsk("Velg alle filer")) + '"></th><th>' + esc(norsk("Fil")) + '</th><th>' + esc(norsk("Type")) +
      '</th><th>' + esc(norsk("Størrelse")) + '</th><th>' + esc(norsk("Lastet opp")) + '</th></tr></thead>' +
      '<tbody id="apFiler"><tr><td colspan="5" class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
    '<div class="ap-knapper"><button type="button" id="apVelgRev">☑ ' + esc(norsk("Velg gamle revisjoner")) + '</button>' +
      '<button type="button" class="ap-fare" id="apSlettValgte" disabled>🗑 ' + esc(norsk("Slett valgte")) + '</button></div>' +
    '<div class="ap-slettboks" id="apSlettBoks" hidden></div>' +
    '<p class="kb-feil" id="apFilMelding" role="status"></p>' +
    '<p class="ap-dempet">' + esc(norsk("Sletting krever slettenøkkelen. Den lagres aldri — den glemmes når panelet lukkes.")) + '</p>' +
  '</section>';
}

function kobleFiler(nr) {
  if (!valgteFiler.has(nr)) valgteFiler.set(nr, new Set());
  if (filMinne.has(nr)) tegnFiler(nr); else hentFiler(nr);
}

async function hentFiler(nr) {
  try {
    const liste = await hentJson("/filer/" + nr);
    filMinne.set(nr, Array.isArray(liste) ? liste : []);
    if (åpent === nr) tegnFiler(nr);
  } catch (err) {
    const k = $("apFiler");
    if (k && err.message !== "403" && åpent === nr) k.innerHTML = '<tr><td colspan="5" class="kb-feil">' + esc(err.message) + '</td></tr>';
  }
}

function tegnFiler(nr) {
  const kropp = $("apFiler"), liste = filMinne.get(nr);
  if (!kropp || !liste || åpent !== nr) return;
  const rader = grupperFiler(nr, liste);
  const valgt = valgteFiler.get(nr) || new Set();
  for (const id of [...valgt]) if (!rader.some(r => r.id === id && r.valgbar)) valgt.delete(id);
  valgteFiler.set(nr, valgt);
  const sum = rader.reduce((s, r) => s + r.bytes, 0);
  $("apFilSum").textContent = "· " + str(sum);
  const tot = D.lagring && !D.lagring.feil ? D.lagring.totalt : null;
  $("apFilTotal").textContent = tot !== null && tot !== undefined ? norsk("{0} brukt totalt", str(tot)) : "";
  if (!rader.length) {
    kropp.innerHTML = '<tr><td colspan="5" class="ap-tom">' + esc(norsk("Ingen filer på prosjektet.")) + '</td></tr>';
  } else {
    kropp.innerHTML = rader.map(r =>
      '<tr class="' + (valgt.has(r.id) ? "ap-fil-valgt" : "") + '"><td><input type="checkbox" data-fil="' + esc(r.id) + '"' + (valgt.has(r.id) ? " checked" : "") +
        (r.valgbar ? "" : ' disabled title="' + esc(norsk("Innstillingsfiler slettes ikke herfra")) + '"') +
        ' aria-label="' + esc(norsk("Velg {0}", r.navn)) + '"></td>' +
      '<td class="ap-filnavn" title="' + esc(r.nøkler.length === 1 ? r.nøkler[0] : r.navn) + '">' + esc(r.navn) + '</td>' +
      '<td class="ap-dempet">' + esc(r.type) + '</td><td class="ap-nowrap">' + esc(str(r.bytes)) + '</td>' +
      '<td class="ap-dempet ap-nowrap">' + esc(når(r.sist, true)) + '</td></tr>').join("");
  }
  const oppdaterKnapp = () => {
    const v = rader.filter(r => valgt.has(r.id));
    const b = $("apSlettValgte");
    b.disabled = !v.length;
    b.textContent = "🗑 " + (v.length ? norsk("Slett {0} valgte ({1})", v.length, str(v.reduce((s, r) => s + r.bytes, 0))) : norsk("Slett valgte"));
    const valgbare = rader.filter(r => r.valgbar);
    const alle = $("apFilAlle");
    alle.checked = valgbare.length > 0 && valgbare.every(r => valgt.has(r.id));
    alle.indeterminate = v.length > 0 && !alle.checked;
  };
  kropp.querySelectorAll("input[data-fil]").forEach(c => {
    c.onchange = () => {
      if (c.checked) valgt.add(c.dataset.fil); else valgt.delete(c.dataset.fil);
      c.closest("tr").classList.toggle("ap-fil-valgt", c.checked);
      oppdaterKnapp();
    };
  });
  $("apFilAlle").onchange = (e) => {
    rader.filter(r => r.valgbar).forEach(r => { if (e.target.checked) valgt.add(r.id); else valgt.delete(r.id); });
    tegnFiler(nr);
  };
  $("apVelgRev").onclick = () => {
    const gamle = gamleRevisjoner(rader);
    if (!gamle.length) { $("apFilMelding").textContent = norsk("Ingen gamle revisjoner å velge."); return; }
    gamle.forEach(id => valgt.add(id));
    $("apFilMelding").textContent = "";
    tegnFiler(nr);
  };
  $("apSlettValgte").onclick = () => slettValgte(nr, rader.filter(r => valgt.has(r.id)));
  oppdaterKnapp();
}

function slettValgte(nr, rader) {
  const nøkler = rader.flatMap(r => r.nøkler);
  if (!nøkler.length) return;
  const bytes = rader.reduce((s, r) => s + r.bytes, 0);
  if (!confirm(norsk("Slette {0} fra prosjekt {1} ({2})? Det kan ikke angres.", flertall(nøkler.length, norsk("fil"), norsk("filer")), nr, str(bytes)))) return;
  if (slettNøkkel) utførSletting(nr, nøkler);
  else spørOmSlettNøkkel(nr, nøkler, "");
}

// Liten boks i stedet for prompt(): passordfelt, så nøkkelen ikke står i
// klartekst på skjermen, og ingen nettleser tilbyr å huske den.
function spørOmSlettNøkkel(nr, nøkler, feil) {
  const boks = $("apSlettBoks");
  if (!boks) return;
  boks.hidden = false;
  boks.innerHTML =
    '<label>' + esc(norsk("Slettenøkkel")) + '<input type="password" id="apSlettInput" autocomplete="off" spellcheck="false"></label>' +
    '<div class="ap-knapper"><button type="button" class="ap-fare" id="apSlettOk">🗑 ' + esc(norsk("Slett {0}", flertall(nøkler.length, norsk("fil"), norsk("filer")))) + '</button>' +
      '<button type="button" id="apSlettAvbryt">' + esc(norsk("Avbryt")) + '</button></div>' +
    (feil ? '<p class="kb-feil">' + esc(feil) + '</p>' : "");
  const felt = $("apSlettInput");
  felt.focus();
  const ok = () => {
    if (!felt.value) { felt.focus(); return; }
    slettNøkkel = felt.value;
    felt.value = "";
    boks.hidden = true; boks.innerHTML = "";
    utførSletting(nr, nøkler);
  };
  $("apSlettOk").onclick = ok;
  felt.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
  $("apSlettAvbryt").onclick = () => { boks.hidden = true; boks.innerHTML = ""; };
}

// Én DELETE per fil (Workeren har ingen samlesletting). Hvert segment av
// nøkkelen kodes for seg, så «/» blir stående og æøå/mellomrom kommer fram.
// 403 = feil slettenøkkel → glem den og spør igjen. 429 = for mange forsøk
// (sperren gjelder også sletting) → stopp og si hvor mange som rakk å gå.
async function utførSletting(nr, nøkler) {
  const knapp = $("apSlettValgte"), melding = $("apFilMelding");
  if (knapp) knapp.disabled = true;
  if (melding) { melding.className = "ap-dempet"; melding.textContent = ""; }
  let slettet = 0, feilet = 0, stopp = "";
  for (const n of nøkler) {
    if (åpent !== nr || !$("adminPanel")) { stopp = "lukket"; break; }
    if (knapp) knapp.textContent = "🗑 " + norsk("Sletter {0} av {1} …", slettet + feilet + 1, nøkler.length);
    let r;
    try {
      r = await fetch(W() + "/fil/" + nr + "/" + n.split("/").map(encodeURIComponent).join("/"),
        { method: "DELETE", headers: { "x-slett-token": slettNøkkel || "" } });
    } catch (_) { feilet++; continue; }
    if (r.status === 403) { slettNøkkel = null; stopp = "403"; break; }
    if (r.status === 429) { stopp = "429"; break; }
    if (r.ok) slettet++; else feilet++;
  }
  filMinne.delete(nr);
  valgteFiler.set(nr, new Set());
  loggMinne.delete(nr);           // «slettet»-linjene skal synes i loggen
  const tekst = [
    slettet ? norsk("{0} slettet.", flertall(slettet, norsk("fil"), norsk("filer"))) : "",
    feilet ? norsk("{0} feilet.", feilet) : "",
    stopp === "429" ? norsk("For mange forsøk — Workeren stoppet slettingen. Vent litt og prøv igjen for resten.") : ""
  ].filter(Boolean).join(" ");
  await Promise.all([hentFiler(nr), hentLagring(), åpent === nr ? hentLogg(nr) : null]);
  const m = $("apFilMelding");
  if (stopp === "403") {
    spørOmSlettNøkkel(nr, nøkler.slice(slettet + feilet), norsk("Feil slettenøkkel — ingenting mer er slettet.") + (slettet ? " " + tekst : ""));
    return;
  }
  if (m) { m.className = stopp === "429" || feilet ? "kb-feil" : "ap-dempet ap-gronn"; m.textContent = tekst; }
}
