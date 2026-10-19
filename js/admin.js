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
  document.removeEventListener("keydown", escLukker, true);
}

async function oppdaterAlt() {
  await Promise.all([hentTall(), hentVenter(), hentBrukere(), hentProsjekter()]);
}

let prosjektListe = [];
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
  kropp.innerHTML = liste.map(p =>
    '<tr class="' + (p.status === "avsluttet" ? "ap-rad-sperret" : "") + '">' +
      '<td><b>' + esc(p.prosjekt) + '</b></td><td>' +
        (p.navn ? esc(p.navn) + ' <button type="button" class="ap-navn" data-navn="' + esc(p.prosjekt) + '" title="' + esc(norsk("Bytt navn")) + '">✎</button>'
                : '<button type="button" class="ap-navn ap-mangler" data-navn="' + esc(p.prosjekt) + '">✎ ' + esc(norsk("Gi navn")) + '</button>') + '</td>' +
      '<td>' + eierCelle(p) + '</td>' +
      '<td>' + (p.harKode ? esc(norsk("Ja")) : '<span class="ap-dempet">' + esc(norsk("Ikke laget")) + '</span>') + '</td>' +
      '<td>' + merke[p.status] + (p.status === "avsluttet" ? ' <span class="ap-dempet">' + esc(når(p.avsluttetTid)) + '</span>' : "") + '</td>' +
      '<td class="ap-handling"><button type="button" data-nr="' + esc(p.prosjekt) + '" data-aktiv="' + (p.status === "avsluttet" ? "1" : "0") + '"' +
        (p.status === "avsluttet" ? ' class="ap-ok"' : "") + '>' +
        esc(p.status === "avsluttet" ? norsk("▶ Aktiver") : norsk("⏹ Avslutt")) + '</button></td></tr>').join("");
  kobleEiere(kropp);
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
