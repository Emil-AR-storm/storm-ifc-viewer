// 📁 «LEGG I PROSJEKT» – knappemenyen og dialogen (Emil 10.11, valg C; lik på
// mobil). BYGGEPLAN-legg-i-prosjekt-Storm-IFC-2026-11-10.md.
//
// «Last ned ▾»: hver nedlastingsknapp i registeret under får en meny
//   Last ned · Legg i prosjekt · Begge deler
// Valget lagres i S.lip, og så trykkes den EKTE knappen. Dokumentet lages som
// før og går ut gjennom lever.js, som laster ned og/eller åpner dialogen her.
// Ingen av verktøyene trenger å vite om dette.
//
// Reglene: legg-i-prosjekt-regn.js. Graph: legg-i-prosjekt-graph.js.
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import * as R from "./legg-i-prosjekt-regn.js";
import { ifcNavnFra } from "./innebygd-regn.js";

// Knappene som laster ned et dokument, og typen dokumentet får (punkt 0 i planen).
export const REGISTER = [
  { sel: ".dr-pdf, .dr-uke-pdf", type: "dagsrapport" },
  { sel: "#fpPdf, #fpVideo, #frIntPdf, #frIntXlsx, #frStPdf, #frStXlsx", type: "framdrift" },
  { sel: "#stPdf, #stXlsx", type: "stopeplan" },
  { sel: "#swTegning, #swInnerTegning", type: "montasje" },
  { sel: "#riggPdf", type: "riggplan" },
  { sel: "#lpExcel", type: "lofteplan" },
  { sel: ".rap-valg[data-utgave]", type: "byggemote" },
  { sel: '.em-kort [data-handling="pdf"], .em-kort [data-handling="excel"], #emExcel, #emOversikt', type: "em" },
  { sel: "#pkExcel", type: "priskalk" },
  { sel: "#fdvPakke", type: "fdv" },
  { sel: "#rapBcf", type: "bcf" },
  { sel: "#qtyCsvG, #qtyCsvE", type: "mengder" },
  { sel: "#kollBcf, #kollXlsx", type: "kollisjon" }
];
const ALLE = REGISTER.map(r => r.sel).join(", ");
const typeFor = (knapp) => { for (const r of REGISTER) if (knapp.matches(r.sel)) return r.type; return null; };

// Storm-Byggeplass (montørkode, ingen Microsoft-innlogging): ingen meny.
const erByggeplass = () => document.documentElement.dataset.lett === "1";

let gjennom = false;
function lukkMeny() { const m = $("lipMeny"); if (m) m.remove(); }

function visMeny(knapp) {
  lukkMeny();
  const type = typeFor(knapp);
  const m = document.createElement("div");
  m.id = "lipMeny"; m.className = "lip-meny"; m.setAttribute("role", "menu");
  m.innerHTML =
    '<button type="button" data-lip="ned" role="menuitem">' + ikon("lastned") + '<span>' + esc(t("Last ned")) + '</span></button>' +
    '<button type="button" data-lip="prosjekt" role="menuitem">' + ikon("bibliotek") + '<span>' + esc(t("Legg i prosjekt")) + '</span></button>' +
    '<button type="button" data-lip="begge" role="menuitem">' + ikon("lastned") + ikon("bibliotek") + '<span>' + esc(t("Begge deler")) + '</span></button>';
  document.body.appendChild(m);
  const r = knapp.getBoundingClientRect(), b = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.right - b.width, window.innerWidth - b.width - 8)) + "px";
  m.style.top = (r.bottom + b.height + 8 > window.innerHeight ? Math.max(8, r.top - b.height - 6) : r.bottom + 6) + "px";
  m.addEventListener("click", (e) => {
    const valg = e.target.closest("[data-lip]");
    if (!valg) return;
    lukkMeny();
    // Gyldig i to minutter: store dokumenter (video) tar tid å lage.
    S.lip = { valg: valg.dataset.lip, type, til: Date.now() + 120000 };
    gjennom = true;
    try { knapp.click(); } finally { gjennom = false; }
  });
  const fokus = m.querySelector("button"); if (fokus) fokus.focus();
}

export function start() {
  if (start.på || erByggeplass()) return;
  start.på = true;
  // ▾ på alle registrerte knapper (de lages og tegnes på nytt hele tiden,
  // derfor CSS og ikke en klasse på hver knapp).
  const st = document.createElement("style");
  st.textContent = REGISTER.map(r => r.sel.split(",").map(s => s.trim() + "::after").join(", ")).join(",\n") +
    ' { content: " ▾"; font-size: .8em; opacity: .8; }';
  document.head.appendChild(st);
  // Fanges FØR knappens egen klikk-handler (capture på dokumentet).
  document.addEventListener("click", (e) => {
    if (gjennom || !e.target || !e.target.closest) return;
    const knapp = e.target.closest(ALLE);
    if (!knapp || knapp.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    visMeny(knapp);
  }, true);
  document.addEventListener("pointerdown", (e) => {
    const m = $("lipMeny");
    if (m && !m.contains(e.target)) lukkMeny();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { lukkMeny(); lukkDialog(); } });
}

// ---------- Dialogen ----------
function lukkDialog() { const d = $("lipBak"); if (d) d.remove(); }

function åpenModell() {
  const fil = S.fileName || "";
  const ifc = S.kildeIfc && S.kildeIfc.fil === fil ? S.kildeIfc.ifc : (/\.ifc$/i.test(fil) ? fil : "");
  const g = S.aktivModellgruppe && S.aktivModellgruppe.fil === fil ? S.aktivModellgruppe.id : "";
  return { ifc, fil, gruppe: g };
}
// Modellnavnet uten endelse: IFC-navnet, eller IFC-navnet en lett kopi peker på
// («X.lett (1).glb» → «X»), som i eksempelet i avtalen.
const modellNavn = (å) => String(å.ifc || (å.fil ? ifcNavnFra(å.fil) : "")).replace(/\.(ifc|glb)$/i, "");

export async function dialog(type, blob, filnavn, dato) {
  lukkDialog();
  const info = R.typeInfo(type);
  const navn = R.vaskFilnavn(filnavn);
  const bak = document.createElement("div");
  bak.id = "lipBak"; bak.className = "lip-bak";
  bak.innerHTML = '<div class="lip-d" role="dialog" aria-modal="true"><h2>' + esc(t("Legg i prosjekt")) + '</h2>' +
    '<label>' + esc(t("Fil")) + '</label><div class="lip-fil">' + esc(navn) + '</div>' +
    '<div id="lipInnhold"><p class="lip-liten">' + esc(t("Henter prosjektene …")) + '</p></div>' +
    '<p class="kb-feil" id="lipFeil"></p>' +
    '<div class="lip-kn"><button type="button" id="lipAvbryt">' + esc(t("Avbryt")) + '</button>' +
    '<button type="button" class="primary" id="lipOk" disabled>' + ikon("bibliotek") + ' ' + esc(t("Legg i prosjekt")) + '</button></div></div>';
  document.body.appendChild(bak);
  $("lipAvbryt").onclick = lukkDialog;
  bak.addEventListener("pointerdown", (e) => { if (e.target === bak) lukkDialog(); });
  const feil = (tekst) => { const f = $("lipFeil"); if (f) f.textContent = tekst; };

  const sp = await import("./sharepoint.js");
  const G = await import("./legg-i-prosjekt-graph.js");
  let token, rader;
  try {
    token = await sp.spToken();
    if (!token) { feil(t("Logg inn på SharePoint først.")); return; }
    rader = await G.hentProsjekter(token);
  } catch (err) {
    feil(err instanceof G.IngenTilgang ? t("Du har ikke tilgang til prosjektlista i Storm Prosjekter.") : t("Fikk ikke hentet prosjektene: {0}", err.message));
    return;
  }
  const å = åpenModell();
  const jobb = R.finnJobb(rader, å);
  const innhold = $("lipInnhold");
  let valgt = R.foreslåProsjekt(jobb, type);
  let underMappe = info.mappe;
  let endret = false;          // har brukeren skrevet sin egen undermappe?
  let mappa = null;            // { sti, navn, id, felles } for valgt prosjekt
  let mappeFeil = null;
  let teller = 0;

  // Prosjektmappa slås opp når prosjektet velges (felles mappe på ID, 4.26),
  // så brukeren ser hvor fila havner FØR hun trykker.
  const tegnMappe = async () => {
    const m = $("lipMappe"), notat = $("lipFelles");
    $("lipOk").disabled = true;
    mappa = null; mappeFeil = null;
    if (!valgt) { if (m) m.textContent = "📁 …"; if (notat) notat.textContent = ""; return; }
    if (m) m.textContent = "📁 " + t("Finner mappa …");
    const mitt = ++teller;
    try {
      const svar = await G.prosjektmappe(token, valgt, rader);
      if (mitt !== teller) return;
      mappa = svar;
      if (!endret) underMappe = R.mappeFor(type, svar.felles, valgt.fields.Arbeidsomrade);
      if (m) m.textContent = "📁 " + svar.navn + " / " + underMappe;
      const deler = svar.felles ? R.delerMappe(jobb.length ? jobb : rader, svar.id) : [];
      if (notat) notat.textContent = deler.length > 1 ? t("(felles mappe for {0})", deler.join(", ")) : "";
      $("lipOk").disabled = false;
    } catch (err) {
      if (mitt !== teller) return;
      mappeFeil = err;
      if (m) m.textContent = "📁 " + R.prosjektTekst(valgt) + " / " + underMappe;
      if (notat) notat.textContent = "";
      feil(err instanceof G.IngenMappe ? t("Prosjektet har ingen mappe ennå – åpne det i Storm Prosjekter og trykk Mappe først.")
        : err instanceof G.IngenTilgang ? t("Du har ikke tilgang til prosjektmappa i Storm Prosjekter.")
        : t("Klarte ikke å legge fila i prosjektet: {0}", err.message));
    }
  };
  const mappeHtml = '<label>' + esc(t("Mappe")) + '</label><div class="lip-mappe"><span id="lipMappe"></span>' +
    '<button type="button" class="lip-lenke" id="lipEndre">' + esc(t("Endre")) + '</button></div>' +
    '<p class="lip-liten" id="lipFelles"></p>';

  if (jobb.length) {
    innhold.innerHTML = '<label for="lipProsjekt">' + esc(t("Prosjekt")) + '</label><select id="lipProsjekt">' +
      jobb.map(r => '<option value="' + esc(r.fields.Nokkel) + '"' + (r === valgt ? " selected" : "") + '>' + esc(R.prosjektTekst(r)) + '</option>').join("") +
      '</select>' + mappeHtml;
    $("lipProsjekt").onchange = (e) => { valgt = jobb.find(r => r.fields.Nokkel === e.target.value) || null; feil(""); tegnMappe(); };
  } else {
    // Ingen kobling: brukeren velger selv. Vi gjetter aldri.
    valgt = null;
    innhold.innerHTML = '<p class="lip-liten">' + esc(t("Fant ikke prosjektet modellen hører til. Velg prosjekt:")) + '</p>' +
      '<label for="lipSok">' + esc(t("Prosjekt")) + '</label><input id="lipSok" type="search" placeholder="' + esc(t("Søk på nummer eller navn")) + '">' +
      '<div class="lip-treff" id="lipTreff"></div>' + mappeHtml;
    const vis = () => {
      const treff = R.søkProsjekter(rader, $("lipSok").value).slice(0, 50);
      $("lipTreff").innerHTML = treff.map(r => '<button type="button" data-nokkel="' + esc(r.fields.Nokkel) + '"' +
        (valgt === r ? ' class="paa"' : "") + '>' + esc(R.prosjektTekst(r)) + '</button>').join("") ||
        '<p class="lip-liten">' + esc(t("Ingen treff.")) + '</p>';
    };
    $("lipSok").oninput = vis;
    $("lipTreff").onclick = (e) => {
      const b = e.target.closest("[data-nokkel]"); if (!b) return;
      valgt = rader.find(r => r.fields && r.fields.Nokkel === b.dataset.nokkel) || null; vis(); feil(""); tegnMappe();
    };
    vis();
  }
  $("lipEndre").onclick = () => {
    const inn = document.createElement("input");
    inn.type = "text"; inn.value = underMappe; inn.className = "lip-mappe-inn";
    const m = $("lipMappe").parentNode; m.replaceWith(inn); inn.focus();
    inn.oninput = () => { endret = true; underMappe = inn.value.split("/").map(x => x.trim()).filter(Boolean).join("/") || info.mappe; $("lipOk").disabled = !mappa; };
  };
  tegnMappe();

  $("lipOk").onclick = async () => {
    if (!valgt || !mappa) return;
    const ok = $("lipOk"); ok.disabled = true; feil("");
    ok.textContent = t("Laster opp …");
    try {
      const mappe = mappa.sti;
      const opp = await G.lastOpp(token, mappe, underMappe, navn, blob, (p) => { ok.textContent = t("Laster opp … {0} %", p); });
      const konto = (sp.innloggingNå().konto || {});
      await G.oppdaterOversikt(token, mappe, R.oversiktPost({
        id: opp && opp.id, navn, type: R.TYPER[type] ? type : "annet", dato: dato || R.isoDato(),
        av: konto.name || konto.username || "", modell: modellNavn(å), mappe: underMappe,
        url: (opp && opp.webUrl) || "", storrelse: (opp && opp.size) || blob.size,
        prosjekt: valgt.fields.Nokkel
      }));
      const lenke = R.stormProsjekterLenke(valgt.fields.Nokkel);
      $("lipInnhold").innerHTML = '<p class="lip-ok">' + ikon("hake") + ' ' + esc(t("Lagt i {0} → {1}", R.prosjektTekst(valgt).split(" ").slice(0, 2).join(" "), underMappe)) + '</p>' +
        '<p><a href="' + esc(lenke) + '" target="_blank" rel="noopener">' + esc(t("Åpne i Storm Prosjekter ↗")) + '</a></p>';
      ok.remove();
      $("lipAvbryt").textContent = t("Lukk");
    } catch (err) {
      ok.disabled = false; ok.innerHTML = ikon("bibliotek") + " " + esc(t("Legg i prosjekt"));
      if (err instanceof G.IngenMappe) feil(t("Prosjektet har ingen mappe ennå – åpne det i Storm Prosjekter og trykk Mappe først."));
      else if (err instanceof G.IngenTilgang) feil(t("Du har ikke tilgang til prosjektmappa i Storm Prosjekter."));
      else feil(t("Klarte ikke å legge fila i prosjektet: {0}", err.message));
    }
  };
}

// ---------- Automatisk, uten dialog (felles dagsrapport, 12.11) ----------
// Etter «Signer og lag PDF» legges PDF-en i jobbens prosjektmappe under
// «12 Dagsrapporter» og registreres i storm-ifc-dokumenter.json. Jobben
// finnes på byggeplassnummeret (ProsjektNr/JobbNr), ellers på modellen.
// Overskriver ALDRI: ligger fila der fra før (Storm Prosjekter signerte),
// røres den ikke. Svar:
//   { ok: true, prosjekt, mappe, finnes }  lagt (eller lå der fra før)
//   { ok: false, grunn: "ingen-prosjekt" | "ingen-mappe" | "ingen-tilgang" | "av" | "feil", melding }
export async function leggAutomatisk(type, blob, filnavn, dato, o) {
  const opt = o || {};
  const sp = await import("./sharepoint.js");
  const G = await import("./legg-i-prosjekt-graph.js");
  try {
    const token = await sp.spTokenSilent();
    if (!token) return { ok: false, grunn: "av" };
    const rader = await G.hentProsjekter(token);
    const å = åpenModell();
    let jobb = R.jobbForNummer(rader, opt.nummer);
    if (!jobb.length) jobb = R.finnJobb(rader, å);
    const valgt = R.foreslåProsjekt(jobb, type);
    if (!valgt) return { ok: false, grunn: "ingen-prosjekt" };
    const mappa = await G.prosjektmappe(token, valgt, rader);
    const under = R.mappeFor(type, mappa.felles, valgt.fields.Arbeidsomrade);
    const navn = R.vaskFilnavn(filnavn);
    const { item, finnes } = await G.lastOppNy(token, mappa.sti, under, navn, blob);
    const konto = (sp.innloggingNå().konto || {});
    await G.oppdaterOversikt(token, mappa.sti, R.oversiktPost({
      id: item && item.id, navn, type, dato: dato || R.isoDato(),
      av: konto.name || konto.username || "", modell: modellNavn(å), mappe: under,
      url: (item && item.webUrl) || "", storrelse: (item && item.size) || blob.size,
      prosjekt: valgt.fields.Nokkel,
      // Lå fila der fra før, beholdes den første oppføringens tid
      ...(finnes && item && item.createdDateTime ? { lagt: item.createdDateTime } : {})
    }));
    return { ok: true, prosjekt: R.prosjektTekst(valgt).split(" ").slice(0, 2).join(" "), nokkel: valgt.fields.Nokkel, mappe: under, finnes };
  } catch (err) {
    if (err instanceof G.IngenMappe) return { ok: false, grunn: "ingen-mappe" };
    if (err instanceof G.IngenTilgang) return { ok: false, grunn: "ingen-tilgang" };
    return { ok: false, grunn: "feil", melding: err && err.message };
  }
}

start();
