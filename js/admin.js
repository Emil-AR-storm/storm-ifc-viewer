// 🛡 ADMINPANELET — alternativ C, dashbord (post 11, steg 1 — 14.10.2026)
//
// Byggeplan 3d. Utseendet: «Storm IFC-Viewer adminpanel valgt C dashbord 2026-10-14.png».
//
// Lastes BARE når ADMIN_TOKEN er limt inn under Innstillinger → Tilgang →
// Administrator (js/tilgang.js importerer fila når Admin-knappen trykkes).
// Den står ikke på lista over låste moduler for kortholdere i main.js.
//
// Alt panelet gjør, kan også gjøres fra konsollen — se
// «prossedyrer/Prosedyre - tilgangskoder.md». Panelet er bare et ansikt på
// de samme Worker-rutene: /kort/*, /admin/*.
import { $, esc } from "./state.js";
import { TJENESTER } from "./config.js";
import { varsel } from "./varsel.js";
import { adminNøkkel, loggUtAdmin, oppdaterAdminKnapp } from "./tilgang.js";
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

// «i dag 09:42», «i går 15:10», ellers «12.10»
function når(iso, medKlokke) {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "–";
  const dag = (x) => x.toISOString().slice(0, 10);
  const iDag = new Date(), iGår = new Date(Date.now() - 86400000);
  const kl = medKlokke && iso.length > 10 ? " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "";
  const lokalDag = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000);
  if (dag(lokalDag(d)) === dag(lokalDag(iDag))) return norsk("i dag") + kl;
  if (dag(lokalDag(d)) === dag(lokalDag(iGår))) return norsk("i går") + kl;
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0");
}

export function visAdmin() {
  if ($("adminPanel")) { oppdaterAlt(); return; }
  const p = document.createElement("div");
  p.id = "adminPanel";
  p.className = "admin-panel";
  p.setAttribute("role", "dialog");
  p.innerHTML =
    '<div class="ap-hode"><h2>🛡 Admin</h2>' +
      '<button type="button" id="apLukk">✕ ' + esc(norsk("Tilbake til modellen")) + '</button></div>' +
    '<div class="ap-tall">' +
      '<div><b id="apTallKort">–</b><span>' + esc(norsk("kort utlevert")) + '</span></div>' +
      '<div><b id="apTallVenter" class="ap-oransje">–</b><span>' + esc(norsk("venter på godkjenning")) + '</span></div>' +
      '<div><b id="apTallFirma">–</b><span>' + esc(norsk("eksterne firma")) + '</span></div>' +
      '<div><b id="apTallOpp">–</b><span>' + esc(norsk("opplastinger siste 30 dager")) + '</span></div>' +
    '</div>' +
    '<div class="ap-kolonner">' +
      '<section class="ap-kol"><h3>' + esc(norsk("Lag ny kode")) + '</h3>' +
        '<label>' + esc(norsk("Navn")) + '<input id="apNavn" autocomplete="off"></label>' +
        '<label>' + esc(norsk("Firma")) + '<input id="apFirma" autocomplete="off"></label>' +
        '<label>' + esc(norsk("E-post")) + '<input id="apEpost" type="email" autocomplete="off"></label>' +
        '<label class="ap-sjekk"><input type="checkbox" id="apStorm"> ' + esc(norsk("Storm-ansatt (godkjennes automatisk)")) + '</label>' +
        '<button type="button" class="primary" id="apLag">' + esc(norsk("Lag engangskode")) + '</button>' +
        '<div id="apKodeUt"></div>' +
      '</section>' +
      '<section class="ap-kol"><h3>' + esc(norsk("Venter på godkjenning")) + ' <span class="ap-merke" id="apVenterMerke" hidden></span></h3>' +
        '<div id="apVenter"><p class="ap-tom">' + esc(norsk("Henter …")) + '</p></div>' +
      '</section>' +
      '<section class="ap-kol ap-brukere"><div class="ap-kolhode"><h3>' + esc(norsk("Brukere")) + '</h3>' +
        '<button type="button" id="apExcel">⬇ Excel</button></div>' +
        '<div class="ap-tabell-boks"><table class="ap-tabell"><thead><tr>' +
          '<th>' + esc(norsk("Navn")) + '</th><th>' + esc(norsk("Firma")) + '</th><th>' + esc(norsk("Type")) + '</th>' +
          '<th>' + esc(norsk("Vilkår")) + '</th><th>' + esc(norsk("Sist brukt")) + '</th><th></th>' +
        '</tr></thead><tbody id="apBrukere"><tr><td colspan="6" class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
      '</section>' +
    '</div>' +
    // 🏗 Byggeplass-prosjekter (Emil 14.10): avslutt et ferdig prosjekt, så
    // kommer ingen montør inn lenger — og aktiver det igjen ved et feiltrykk.
    '<section class="ap-kol ap-prosjekter"><div class="ap-kolhode"><h3>' + esc(norsk("Byggeplass-prosjekter")) +
        ' <span class="ap-dempet" id="apProsjektTall"></span></h3>' +
        '<label class="ap-sjekk ap-filter"><input type="checkbox" id="apVisAvsluttet" checked> ' + esc(norsk("Vis avsluttede")) + '</label></div>' +
      '<p class="ap-tom" style="margin-top:0">' + esc(norsk("Avsluttet = montørene kommer ikke inn, og det kommer ingen morgenvarsler. Ingenting slettes: aktiverer du igjen, virker samme montørkode og QR.")) + '</p>' +
      '<div class="ap-tabell-boks"><table class="ap-tabell"><thead><tr>' +
        '<th>' + esc(norsk("Nr.")) + '</th><th>' + esc(norsk("Navn")) + '</th><th>' + esc(norsk("Eier")) + '</th>' +
        '<th>' + esc(norsk("Montørkode")) + '</th><th>' + esc(norsk("Status")) + '</th><th></th>' +
      '</tr></thead><tbody id="apProsjekter"><tr><td colspan="6" class="ap-tom">' + esc(norsk("Henter …")) + '</td></tr></tbody></table></div>' +
    '</section>';
  document.body.appendChild(p);
  // Under toppbaren, så Admin-knappen og gruppene fortsatt synes (som i bildet)
  const topp = $("topbar");
  p.style.top = (topp ? topp.getBoundingClientRect().bottom : 0) + "px";

  $("apLukk").onclick = lukkAdmin;
  document.addEventListener("keydown", escLukker, true);
  $("apLag").onclick = lagKode;
  $("apExcel").onclick = lastNedExcel;
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
  // Koden skal aldri bli liggende synlig neste gang panelet åpnes
  åpent = null; nyKode = null; loggMinne.clear();
  document.removeEventListener("keydown", escLukker, true);
}

async function oppdaterAlt() {
  await Promise.all([hentTall(), hentVenter(), hentBrukere(), hentProsjekter()]);
}

let prosjektListe = [];
let åpent = null;            // prosjektnummeret med utfoldet rad (én om gangen)
let nyKode = null;           // { prosjekt, kode } — den nye montørkoden, vises BARE til raden lukkes
const loggMinne = new Map(); // prosjekt → { rader, totalt, filter, vis } — så ny tegning ikke henter på nytt
let brukerListe = [];        // kortene fra /kort/liste — til «+ Eier»
async function hentProsjekter() {
  const kropp = $("apProsjekter");
  if (!kropp) return;
  try {
    prosjektListe = await (await kall("/admin/prosjekter")).json();
    tegnProsjekter();
  } catch (err) {
    if (err.message !== "403") kropp.innerHTML = '<tr><td colspan="6" class="kb-feil">' + esc(err.message) + '</td></tr>';
  }
}

function tegnProsjekter() {
  const kropp = $("apProsjekter");
  if (!kropp) return;
  const visAvsl = $("apVisAvsluttet").checked;
  $("apVisAvsluttet").onchange = tegnProsjekter;
  const aktive = prosjektListe.filter(p => p.status !== "avsluttet").length;
  $("apProsjektTall").textContent = aktive + " " + norsk("aktive") + " · " + (prosjektListe.length - aktive) + " " + norsk("avsluttet");
  const liste = prosjektListe.filter(p => visAvsl || p.status !== "avsluttet");
  if (!liste.length) { kropp.innerHTML = '<tr><td colspan="6" class="ap-tom">' + esc(norsk("Ingen prosjekter.")) + '</td></tr>'; return; }
  const merke = { aktiv: '<span class="ap-type ap-aktiv">' + esc(norsk("Aktiv")) + '</span>',
    venter: '<span class="ap-type ap-venter-merke">' + esc(norsk("Venter")) + '</span>',
    avsluttet: '<span class="ap-type ap-sperret">' + esc(norsk("Avsluttet")) + '</span>' };
  if (åpent && !liste.some(p => p.prosjekt === åpent)) åpent = null;
  kropp.innerHTML = liste.map(p =>
    '<tr class="' + (p.status === "avsluttet" ? "ap-rad-sperret" : "") + (p.prosjekt === åpent ? " ap-rad-apen" : "") + '">' +
      '<td><button type="button" class="ap-utvid" data-utvid="' + esc(p.prosjekt) + '" aria-expanded="' + (p.prosjekt === åpent) + '" title="' +
        esc(norsk("Montørkode, QR og logg")) + '"><span aria-hidden="true">' + (p.prosjekt === åpent ? "▾" : "▸") + '</span> <b>' + esc(p.prosjekt) + '</b></button></td><td>' +
        (p.navn ? esc(p.navn) + ' <button type="button" class="ap-navn" data-navn="' + esc(p.prosjekt) + '" title="' + esc(norsk("Bytt navn")) + '">✎</button>'
                : '<button type="button" class="ap-navn ap-mangler" data-navn="' + esc(p.prosjekt) + '">✎ ' + esc(norsk("Gi navn")) + '</button>') + '</td>' +
      '<td>' + eierCelle(p) + '</td>' +
      '<td>' + (p.harKode ? esc(norsk("Ja")) + (p.kodeLaget ? ' <span class="ap-dempet">· ' + esc(når(p.kodeLaget)) + '</span>' : "")
                          : '<span class="ap-dempet">' + esc(norsk("Ikke laget")) + '</span>') + '</td>' +
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
      if (!kan.length) { varsel(norsk("Alle brukerne er allerede eiere. Lag en ny kode under «Lag ny kode» for å gi en ny person tilgang.")); return; }
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

async function hentTall() {
  try {
    const j = await (await kall("/admin/tall")).json();
    $("apTallKort").textContent = j.kort;
    $("apTallVenter").textContent = j.venter;
    $("apTallFirma").textContent = j.eksterneFirma;
    $("apTallOpp").textContent = j.opplastinger;
  } catch (err) { if (err.message !== "403") console.warn(err); }
}

async function hentVenter() {
  const boks = $("apVenter");
  if (!boks) return;
  try {
    const liste = await (await kall("/admin/venter")).json();
    oppdaterAdminKnapp(liste.length);
    const merke = $("apVenterMerke");
    merke.textContent = liste.length; merke.hidden = !liste.length;
    if (!liste.length) { boks.innerHTML = '<p class="ap-tom">' + esc(norsk("Ingen prosjekter venter.")) + '</p>'; return; }
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
    if (err.message !== "403") boks.innerHTML = '<p class="kb-feil">' + esc(err.message) + '</p>';
  }
}

async function avgjør(prosjekt, godkjenn) {
  try {
    await kall(godkjenn ? "/admin/godkjenn" : "/admin/avvis", { json: { prosjekt } });
    await Promise.all([hentVenter(), hentTall()]);
  } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
}

async function hentBrukere() {
  const kropp = $("apBrukere");
  if (!kropp) return;
  try {
    const j = await (await kall("/kort/liste")).json();
    brukerListe = j.kort || [];
    const rad = (k) => {
      const type = k.sperret
        ? '<span class="ap-type">' + esc(k.storm ? "Storm" : norsk("Ekstern")) + '</span> <span class="ap-type ap-sperret">' + esc(norsk("Sperret")) + '</span>'
        : (k.storm ? '<span class="ap-type ap-storm">Storm</span>' : '<span class="ap-type">' + esc(norsk("Ekstern")) + '</span>');
      return '<tr class="' + (k.sperret ? "ap-rad-sperret" : "") + '" title="' + esc((k.epost || "") + (k.opplastinger ? " · " + k.opplastinger + " " + norsk("opplastinger") : "")) + '">' +
        '<td><b>' + esc(k.navn) + '</b></td><td>' + esc(k.firma) + '</td><td>' + type + '</td>' +
        '<td>' + esc(k.vilkar || "–") + '</td><td>' + esc(når(k.sistBrukt)) + '</td>' +
        '<td class="ap-handling"><button type="button" data-id="' + esc(k.id) + '" data-sperr="' + (k.sperret ? "0" : "1") + '">' +
          esc(k.sperret ? norsk("Gjenåpne") : norsk("Sperr")) + '</button></td></tr>';
    };
    const admin = '<tr><td><b>Emil (admin)</b></td><td>Storm</td><td><span class="ap-type ap-storm">Storm</span></td><td>–</td><td>' +
      esc(norsk("i dag")) + '</td><td class="ap-handling ap-dempet">admin</td></tr>';
    const ventende = (j.ventende || []).map(v =>
      '<tr class="ap-rad-ventende"><td>' + esc(v.navn) + '</td><td>' + esc(v.firma) + '</td><td><span class="ap-type">' +
      esc(norsk("Kode sendt")) + '</span></td><td>–</td><td>' + esc(norsk("går ut {0}", når(v.utløper, true))) + '</td><td></td></tr>').join("");
    kropp.innerHTML = admin + j.kort.map(rad).join("") + ventende;
    kropp.querySelectorAll("button[data-id]").forEach(b => {
      b.onclick = async () => {
        const sperr = b.dataset.sperr === "1";
        if (sperr && !confirm(norsk("Sperre kortet? Personen mister tilgangen med en gang."))) return;
        try {
          await kall(sperr ? "/kort/sperr" : "/kort/gjenapne", { json: { id: b.dataset.id } });
          await Promise.all([hentBrukere(), hentTall()]);
        } catch (err) { if (err.message !== "403") varsel(norsk("Klarte ikke: ") + err.message); }
      };
    });
  } catch (err) {
    if (err.message !== "403") kropp.innerHTML = '<tr><td colspan="6" class="kb-feil">' + esc(err.message) + '</td></tr>';
  }
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
    const adresse = location.origin + location.pathname.replace(/[^/]*$/, "");
    const melding = norsk("Hei {0}!", navn.split(" ")[0]) + "\n\n" +
      norsk("Her er koden din til Storm IFC: {0}", j.kode) + "\n\n" +
      norsk("Åpne {0}, trykk på «Gratisversjon» øverst (eller et verktøy med 🔒) og skriv inn koden.", adresse) + "\n" +
      norsk("Koden virker én gang og går ut om 48 timer. Etter det husker nettleseren tilgangen.") + "\n";
    // Koden vises ÉN gang — Worker-en lagrer bare hashen.
    ut.innerHTML =
      '<p class="ap-kodetekst">' + esc(norsk("Kode til {0} — gyldig i 48 t, kan brukes én gang:", navn)) + '</p>' +
      '<div class="ap-kode">' + esc(j.kode) + '</div>' +
      '<div class="ap-knapper"><button type="button" id="apKopier">📋 ' + esc(norsk("Kopier")) + '</button>' +
      '<button type="button" id="apKopierMelding">✉ ' + esc(norsk("Kopier som melding")) + '</button></div>';
    const kopier = async (tekst, b) => {
      try { await navigator.clipboard.writeText(tekst); b.textContent = "✓ " + norsk("Kopiert"); }
      catch (_) { prompt(norsk("Kopier teksten:"), tekst); }
    };
    $("apKopier").onclick = (e) => kopier(j.kode, e.currentTarget);
    $("apKopierMelding").onclick = (e) => kopier(melding, e.currentTarget);
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

// ---------- ▾ Utfoldet prosjektrad: montørkode, QR og logg (Emil 19.10, alternativ A) ----------
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
  return '<tr class="ap-detalj"><td colspan="6"><div class="ap-detalj-grid">' +
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
