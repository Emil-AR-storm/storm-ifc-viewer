// 🖼 INNEBYGD MODUS – Storm IFC inne i Storm Prosjekter (fase B, Emils valg E1 09.11).
//
// Storm Prosjekter viser modellen i et stort vindu på Dashbord:
//   index.html?innebygd=1&modell=<IFC-navn>   eller   &gruppe=<modellgruppe-id>
//
// HVA SOM SKJER:
//  1. forberedInnebygd() kjøres av main.js FØR kortsjekken og modulene:
//     - siden nekter å vises i en ramme som ikke er Storm Prosjekter;
//     - uten gyldig kort/bevis: «Logg inn med Microsoft» → /kort/ms-inn.
//       Microsoft sier HVEM du er; brukerlista (Admin → Brukere) avgjør om du
//       får komme inn. Ingen nøkler eller tokens går mellom de to sidene.
//  2. startInnebygd() kjøres etter startTilgang(): topplinja E1 med de ekte
//     verktøyknappene flyttet inn, og modellen åpnes fra SharePoint (ekstra
//     lett → lett → IFC). Gruppene er de samme som for IFC-en.
//
// Tekstene står på norsk, som i tilgang.js og admin.js: dette er Storms egen
// innloggingsflyt, og Storm Prosjekter er på norsk.
import { $, S, esc, ikon, loadingEl, loadingText } from "./state.js";
import { TJENESTER } from "./config.js";
import { erAdmin, harKort, kortInfo, kortNavn, lagreMsKort, lesKort } from "./tilgang.js";
import { varsel } from "./varsel.js";
import * as R from "./innebygd-regn.js";

const norsk = (s, ...a) => a.reduce((r, v, i) => r.split("{" + i + "}").join(v), s);
const rot = document.documentElement;
const ADR = (() => { try { return R.lesInnebygd(location.search); } catch (_) { return { innebygd: false }; } })();
const innrammet = (() => { try { return window.top !== window.self; } catch (_) { return true; } })();
const vanligAdresse = () => location.origin + location.pathname;

export const erInnebygd = () => !!ADR.innebygd;
if (ADR.innebygd) rot.dataset.innebygd = "1";

// ---------- Kortene før modellen (innlogging, ingen tilgang, feil ramme) ----------
function visKort(html) {
  let bak = $("ibKort");
  if (!bak) {
    bak = document.createElement("div");
    bak.id = "ibKort";
    bak.className = "ib-kort-bak";
    document.body.appendChild(bak);
  }
  bak.innerHTML = '<div class="ib-kort" role="dialog" aria-modal="true">' +
    '<svg class="storm-logo ib-logo" viewBox="0 0 948 224" role="img" aria-label="Storm"><use href="#storm-lockup"/></svg>' + html + '</div>';
  return bak;
}
function lukkKort() { const b = $("ibKort"); if (b) b.remove(); }
// Navnet som vises: IFC-navnet (modell=) eller glb-navnet (lett=, B1).
const visNavn = () => R.modellTittel(ADR.modell || ADR.lett);
const tittel = () => visNavn() ? norsk("3D-modellen: {0}", visNavn()) : norsk("3D-modellen");

// Promise som aldri løser seg: resten av siden skal ikke lastes.
const stopp = () => new Promise(() => {});

async function msInn(idToken) {
  const r = await fetch(TJENESTER.worker + "/kort/ms-inn", { method: "POST", headers: { "x-ms-token": idToken } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

async function godtaVilkår(bevis) {
  const r = await fetch(TJENESTER.worker + "/kort/godta-vilkar", { method: "POST",
    headers: { "content-type": "application/json", "x-token": bevis }, body: JSON.stringify({ vilkar: "1.0" }) });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

// ---------- 🖼 B3: hint fra Storm Prosjekter ----------
// Sier «klar» til Storm Prosjekter (aldri «*») og venter litt på svaret med
// e-posten til den innloggede. Gir e-posten, eller "" etter ventetiden.
let sistHint = "";
const hintLyttere = [];
function lyttEtterHint() {
  if (!innrammet || lyttEtterHint.på) return;
  lyttEtterHint.på = true;
  window.addEventListener("message", (e) => {
    const h = R.lesHintMelding(e, window.parent);
    if (!h) return;
    sistHint = h;
    hintLyttere.splice(0).forEach(f => f(h));
  });
  try { window.parent.postMessage({ type: R.KLAR_MELDING }, R.STORM_PROSJEKTER); } catch (_) { /* ingen forelder */ }
}
function ventPåHint(ms) {
  if (!innrammet) return Promise.resolve("");
  if (sistHint) return Promise.resolve(sistHint);
  return new Promise((løs) => {
    const t = setTimeout(() => løs(""), ms);
    hintLyttere.push((h) => { clearTimeout(t); løs(h); });
  });
}

// Kjøres av main.js før sjekkKort(). Løser seg når et gyldig bevis er lagret.
export async function forberedInnebygd() {
  if (!ADR.innebygd) return;
  if (!R.rammeOk({ innrammet, ancestorOrigins: location.ancestorOrigins, referrer: document.referrer })) {
    visKort('<h2>' + esc(norsk("Kan ikke vises her")) + '</h2>' +
      '<p>' + esc(norsk("Denne visningen virker bare inne i Storm Prosjekter.")) + '</p>' +
      '<p><a href="' + esc(vanligAdresse()) + '" target="_blank" rel="noopener">' + esc(norsk("Åpne Storm IFC vanlig →")) + '</a></p>');
    return stopp();
  }
  lyttEtterHint();         // B3: «klar» → Storm Prosjekter svarer med e-posten
  if (lesKort()) return;   // gyldig kort eller bevis i denne nettleseren
  const sp = await import("./sharepoint.js");
  // Logget inn mot Microsoft fra før (eller rett tilbake fra omdirigering)? Prøv stille.
  let id = null;
  try { id = await sp.msIdToken({ stille: true }); } catch (_) { id = null; }
  return new Promise((løs) => {
    const prøv = async (idToken) => {
      visKort('<h2>' + esc(tittel()) + '</h2><p>' + esc(norsk("Sjekker tilgangen …")) + '</p>');
      let svar;
      try { svar = await msInn(idToken); }
      catch (err) { return visFeil(norsk("Fikk ikke kontakt med Storm IFC: {0}", err.message)); }
      const j = svar.j || {};
      if (svar.ok && j.bevis) {
        const kort = { nøkkel: j.bevis, utløper: j.utløper, id: j.id, navn: j.navn, firma: j.firma, storm: !!j.storm, ms: true };
        if (!j.vilkar) return visVilkår(kort);
        lagreMsKort(kort); lukkKort(); løs();
        return;
      }
      if (j.sperret) return visKort('<h2>' + esc(norsk("Kortet er sperret")) + '</h2><p>' +
        esc(norsk("Tilgangen din til Storm IFC er stengt. Ta kontakt med Emil.")) + '</p>');
      if (svar.status === 429) return visFeil(j.feil || norsk("For mange forsøk. Prøv igjen om en time."));
      const konto = R.tokenEpost(idToken);
      visKort('<h2>' + esc(norsk("Du har ikke tilgang")) + '</h2>' +
        '<p>' + (konto ? norsk("Microsoft-kontoen <b>{0}</b> står ikke i brukerlista.", esc(konto)) : esc(norsk("Microsoft-kontoen står ikke i brukerlista."))) + '</p>' +
        '<p>' + esc(norsk("Be Emil legge deg til under Admin → Brukere i Storm IFC.")) + '</p>' +
        '<button type="button" class="ib-knapp ib-graa" id="ibAnnenKonto">' + esc(norsk("Logg inn med en annen konto")) + '</button>');
      $("ibAnnenKonto").onclick = () => loggInn(true);
    };
    const visFeil = (tekst) => {
      visKort('<h2>' + esc(tittel()) + '</h2><p class="kb-feil">' + esc(tekst) + '</p>' +
        '<button type="button" class="ib-knapp" id="ibIgjen">' + esc(norsk("Prøv igjen")) + '</button>');
      $("ibIgjen").onclick = () => loggInn(false);
    };
    const visVilkår = (kort) => {
      visKort('<h2>' + esc(norsk("Vilkårene er oppdatert")) + '</h2>' +
        '<p>' + esc(norsk("Les vilkårene for bruk og godta dem for å se modellen.")) + '</p>' +
        '<p><a href="vilkar.html" target="_blank" rel="noopener">' + esc(norsk("Les vilkårene for bruk")) + '</a></p>' +
        '<p class="kb-feil" id="ibFeil"></p>' +
        '<button type="button" class="ib-knapp" id="ibGodta">' + esc(norsk("Godta")) + '</button>');
      $("ibGodta").onclick = async () => {
        try { await godtaVilkår(kort.nøkkel); lagreMsKort(kort); lukkKort(); løs(); }
        catch (err) { $("ibFeil").textContent = norsk("Klarte ikke å lagre: ") + err.message; }
      };
    };
    const loggInn = async (velgKonto, loginHint) => {
      // Telefon i ramme: innloggingsvinduer blokkeres der (iOS). Da åpnes
      // samme adresse i en egen fane, der omdirigering virker.
      if (innrammet && !sp.brukPopup()) {
        window.open(location.href, "_blank", "noopener");
        return;
      }
      let idToken = null;
      try { idToken = await sp.msIdToken({ velgKonto, popup: innrammet, loginHint }); }
      catch (err) { if (!sp.avbruttAvBruker(err)) return visFeil(norsk("Innloggingen gikk ikke: {0}", (err && err.message) || err)); }
      if (idToken) prøv(idToken); else if (loginHint) visKonto(loginHint); else visStart();
    };
    // B3, valg B (Emil 10.11): kontokort som hos Microsoft — initialer, navn og
    // e-post, knappen «Fortsett» og «Ikke deg? Bruk en annen konto».
    const visKonto = (epost) => {
      const tlf = innrammet && !sp.brukPopup();
      const navn = R.navnFraEpost(epost);
      visKort('<h2>' + esc(tittel()) + '</h2>' +
        '<p>' + esc(tlf ? norsk("På telefon åpnes modellen i en egen fane.") : norsk("Nettleseren ba om ett klikk før du logges inn.")) + '</p>' +
        '<div class="ib-konto"><span class="ib-sirkel" aria-hidden="true">' + esc(R.initialer(navn)) + '</span>' +
          '<span class="ib-konto-tekst"><b>' + esc(navn) + '</b><small>' + esc(epost) + '</small></span></div>' +
        '<button type="button" class="ib-knapp" id="ibFortsett">' + esc(tlf ? norsk("Åpne i full skjerm") : norsk("Fortsett")) + '</button>' +
        '<button type="button" class="ib-lenke" id="ibAnnenKonto">' + esc(norsk("Ikke deg? Bruk en annen konto")) + '</button>');
      $("ibFortsett").onclick = () => loggInn(false, epost);
      $("ibAnnenKonto").onclick = () => loggInn(true);
    };
    // Ingen stille innlogging: vent kort på hintet, prøv ssoSilent med det,
    // og vis kontokortet bare hvis nettleseren krever et klikk.
    const utenToken = async () => {
      visKort('<h2>' + esc(tittel()) + '</h2><p>' + esc(norsk("Logger inn …")) + '</p>');
      const hint = await ventPåHint(2500);
      if (!hint) return visStart();
      const t = await sp.msSsoStille(hint);
      if (t) return prøv(t);
      visKonto(hint);
    };
    const visStart = () => {
      const tlf = innrammet && !sp.brukPopup();
      visKort('<h2>' + esc(tittel()) + '</h2>' +
        '<p>' + esc(norsk("Logg inn med Storm-kontoen din for å se modellen. Du må stå i brukerlista i Storm IFC.")) + '</p>' +
        (tlf ? '<p class="ib-liten">' + esc(norsk("På telefon åpnes modellen i en egen fane.")) + '</p>' : "") +
        '<button type="button" class="ib-knapp" id="ibLoggInn">' + esc(tlf ? norsk("Åpne i full skjerm") : norsk("Logg inn med Microsoft")) + '</button>');
      $("ibLoggInn").onclick = () => loggInn(false);
    };
    if (id) prøv(id); else utenToken();
  });
}

// ---------- Topplinja (E1) og modellen ----------
function byggLinje(art) {
  if ($("innebygdBar")) return;
  const linje = document.createElement("div");
  linje.id = "innebygdBar";
  linje.innerHTML =
    '<div class="ib-venstre"><svg class="storm-logo" viewBox="0 0 948 224" role="img" aria-label="Storm IFC-Viewer"><use href="#storm-lockup"/></svg>' +
      '<span class="ib-skille"></span><b id="ibTittel">' + esc(visNavn() || norsk("Modellgruppe")) + '</b><small id="ibArt">' + esc(art || "") + '</small></div>' +
    '<div class="ib-verktoy" id="ibVerktoy"></div>' +
    '<div class="ib-hoyre"><small id="ibBruker">' + esc(kortNavn()) + '</small>' +
      (innrammet ? '<button type="button" id="ibFullskjerm" title="' + esc(norsk("Åpne i full skjerm")) + '">' + ikon("fullskjerm") + '</button>' : "") +
      '<button type="button" id="ibApne" title="' + esc(norsk("Åpne Storm IFC i en egen fane")) + '">' + ikon("apne") + '<span class="btn-t">' + esc(norsk("Åpne i Storm IFC")) + '</span></button></div>';
  document.body.appendChild(linje);
  const v = $("ibVerktoy");
  for (const id of R.INNEBYGD_KNAPPER) { const b = $(id); if (b) v.appendChild(b); }
  $("ibApne").onclick = () => window.open(vanligAdresse(), "_blank", "noopener");
  // Bare ikoner når tekstene ikke får plass (smalt vindu, langt språk) –
  // målt, ikke gjettet med en fast skjermbredde.
  const tilpass = () => {
    linje.classList.remove("ib-ikoner");
    if (v.scrollWidth > v.clientWidth + 1) linje.classList.add("ib-ikoner");
  };
  tilpass();
  window.addEventListener("resize", tilpass);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(tilpass).observe(v);
  const fs = $("ibFullskjerm");
  if (fs) fs.onclick = () => window.open(location.href, "_blank", "noopener");
}

function settArt(art) {
  const a = $("ibArt");
  if (a) a.textContent = art === "ekstra" ? norsk("ekstra lett kopi") : art === "lett" ? norsk("lett kopi") : art === "ifc" ? norsk("full modell") : "";
}

function visMelding(tekst) {
  const v = $("ibVerktoy");
  visKort('<h2>' + esc(visNavn() || norsk("3D-modellen")) + '</h2><p>' + esc(tekst) + '</p>');
  if (v) v.style.visibility = "hidden";
}

// Leser Lette kopier/_index.json hvis den finnes (Storm Prosjekter kan legge
// den der). Mangler den, brukes navneregelen i velgModellfil.
async function lesIndeks() {
  try {
    const { spLesBin } = await import("./sp-lager.js");
    const r = await spLesBin("Lette kopier", "_index.json");
    if (r.status !== "ok" || !r.data) return null;
    return JSON.parse(new TextDecoder().decode(r.data));
  } catch (_) { return null; }
}

async function åpneModell(ifcNavn) {
  const sp = await import("./sharepoint.js");
  loadingEl.classList.add("open");
  loadingText.textContent = norsk("Finner {0} …", R.modellTittel(ifcNavn));
  let valg = null;
  try {
    const [full, lett, indeks] = await Promise.all([sp.spFetchList("full"), sp.spFetchList("lett"), lesIndeks()]);
    valg = R.velgModellfil(ifcNavn, full || [], lett || [], indeks);
  } catch (err) {
    loadingEl.classList.remove("open");
    visMelding(norsk("Fikk ikke lest modellene fra SharePoint: {0}", err.message));
    return false;
  }
  if (!valg) {
    loadingEl.classList.remove("open");
    visMelding(norsk("Fant ikke «{0}» i IFC-modeller på SharePoint.", ifcNavn));
    return false;
  }
  // Gruppene, lagene og forsidebildet hører til IFC-navnet, også når en lett
  // kopi er åpen (se grSpFil i grupper.js og apneGruppe i lag.js).
  S.kildeIfc = { fil: valg.fil.name, ifc: ifcNavn };
  settArt(valg.art);
  await sp.spOpenFile(valg.fil);
  return S.fileName === valg.fil.name;
}

// lett=<glb-navn> (B1): akkurat den fila i Lette kopier. Gruppene og
// markeringene hører til IFC-en som eier fila; uten eier brukes glb-navnet.
async function åpneLett(glbNavn) {
  const sp = await import("./sharepoint.js");
  loadingEl.classList.add("open");
  loadingText.textContent = norsk("Finner {0} …", R.modellTittel(glbNavn));
  let fil = null, eier = null;
  try {
    const [full, lett] = await Promise.all([sp.spFetchList("full"), sp.spFetchList("lett")]);
    fil = (lett || []).find(f => f.name === glbNavn) || null;
    eier = R.eierIfc(glbNavn, full || []);
  } catch (err) {
    loadingEl.classList.remove("open");
    visMelding(norsk("Fikk ikke lest modellene fra SharePoint: {0}", err.message));
    return false;
  }
  if (!fil) {
    loadingEl.classList.remove("open");
    visMelding(norsk("Fant ikke «{0}» i Lette kopier på SharePoint.", glbNavn));
    return false;
  }
  S.kildeIfc = eier ? { fil: fil.name, ifc: eier } : null;
  settArt(R.erEkstraLett(fil.name) ? "ekstra" : "lett");
  await sp.spOpenFile(fil);
  return S.fileName === fil.name;
}

async function åpneGruppe(id) {
  const { spLes } = await import("./sp-lager.js");
  const R2 = await import("./lag-regn.js");
  const r = await spLes(R2.GRUPPE_MAPPE, R2.GRUPPE_FIL);
  const g = (r.liste || []).map(R2.vaskGruppe).find(x => x && !x.slettet && x.id === id);
  if (!g) { visMelding(norsk("Fant ikke modellgruppen på SharePoint.")); return; }
  const t = $("ibTittel"); if (t) t.textContent = g.navn;
  if (!await åpneModell(g.hoved.navn)) return;
  try { await (await import("./lag.js")).apneGruppe(g); }
  catch (err) { varsel(norsk("Klarte ikke å legge på lagene: {0}", err.message)); }
}

// Kjøres av main.js etter startTilgang().
export async function startInnebygd() {
  if (!ADR.innebygd) return;
  if (!harKort()) {
    visKort('<h2>' + esc(norsk("Ingen tilgang")) + '</h2><p>' +
      esc(norsk("Kortet ditt er sperret eller vilkårene er ikke godtatt. Ta kontakt med Emil.")) + '</p>');
    return;
  }
  byggLinje("");
  if (ADR.gruppe) await åpneGruppe(ADR.gruppe);
  else if (ADR.lett) await åpneLett(ADR.lett);
  else if (ADR.modell) await åpneModell(ADR.modell);
  else visMelding(norsk("Ingen modell er koblet til prosjektet ennå."));
}

// ---------- 📸 Lagre forsidebilde (vanlig modus, Dokumentasjon) ----------
// Storm Prosjekter viser bildet på Dashbord uten å laste 3D:
// IFC-modeller/Forsidebilder/<IFC-navn>.png, ca. 800×450.
const kanForside = () => erAdmin() || !!(kortInfo() || {}).storm;

async function lagreForsidebilde() {
  if (!S.modelGroup || !S.fileName) { varsel(norsk("Åpne en modell først.")); return; }
  if (!kanForside()) { varsel(norsk("Bare Storm og admin kan lagre forsidebilde.")); return; }
  const navn = R.forsideNavn(S.fileName, await finnEier(S.fileName));
  const { fangstBilde } = await import("./scene.js");
  const bilde = fangstBilde(1280, 720, { type: "image/png" });   // vinkelen du står i nå
  if (!bilde) { varsel(norsk("Klarte ikke å ta bildet.")); return; }
  const { spLastOpp } = await import("./sp-lager.js");
  const r = await spLastOpp(R.FORSIDE_MAPPE, navn, tilBytes(bilde.data), "image/png");
  if (r && r.ok) varsel(norsk("Forsidebildet er lagret: {0}. Storm Prosjekter viser det på Dashbord.", R.FORSIDE_MAPPE + "/" + navn));
  else varsel(r && r.grunn === "av" ? norsk("Logg inn på SharePoint for å lagre forsidebildet.") : norsk("Klarte ikke å lagre forsidebildet."));
}

// ---------- 🖼 B2: forsidebilde automatisk ----------
// Når en modell fra SharePoint er ferdig vist (innebygd eller fra biblioteket):
// finnes ikke Forsidebilder/<IFC-navn>.png, eller er det eldre enn modellfila,
// tas et bilde fra standardvisningen (1280×720) og lastes opp. Alt skjer i det
// stille; feil står bare i konsollen.
const sov = (ms) => new Promise(r => setTimeout(r, ms));
const toRammer = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
function tilBytes(dataUrl) {
  const bin = atob(String(dataUrl).split(",")[1] || ""), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// IFC-en som eier den åpne fila: innebygd modus vet det (S.kildeIfc); en lett
// kopi fra biblioteket slås opp med navneregelen fra B1; uten eier → null.
async function finnEier(filNavn) {
  if (S.kildeIfc && S.kildeIfc.fil === filNavn) return S.kildeIfc.ifc;
  if (/\.ifc$/i.test(filNavn)) return filNavn;
  if (!/\.glb$/i.test(filNavn)) return null;
  try {
    const sp = await import("./sharepoint.js");
    return R.eierIfc(filNavn, (await sp.spFetchList("full")) || []);
  } catch (_) { return null; }
}
async function autoForside(item, meta) {
  try {
    if (!item || !item.name) return;
    const endret = (meta && meta.lastModifiedDateTime) || item.lastModifiedDateTime || "";
    const navn = R.forsideNavn(item.name, await finnEier(item.name));
    const lager = await import("./sp-lager.js");
    const info = await lager.spFilInfo(R.FORSIDE_MAPPE, navn);
    if (!R.trengerForside(info, endret)) return;
    // La lagene, fargene og skjulingen fra afterLoad bli tegnet først.
    await sov(1500); await toRammer();
    if (S.fileName !== item.name || !S.modelGroup) return;   // en annen modell er åpnet
    const { fangstBilde } = await import("./scene.js");
    const bilde = fangstBilde(1280, 720, { type: "image/png", standard: true });
    if (!bilde) { console.warn("Forsidebilde: klarte ikke å ta bildet"); return; }
    const r = await lager.spLastOppStille(R.FORSIDE_MAPPE, navn, tilBytes(bilde.data), "image/png");
    if (r && r.ok) console.info("Forsidebilde lagret: " + R.FORSIDE_MAPPE + "/" + navn);
    else console.warn("Forsidebilde ble ikke lagret (" + ((r && r.grunn) || "ukjent") + "): " + navn);
  } catch (err) {
    console.warn("Forsidebilde feilet:", err && err.message);
  }
}
S.etterSpModell = (item, meta) => { autoForside(item, meta); };

export function startForsidebilde() {
  const b = $("btnForsidebilde");
  if (!b) return;
  if (ADR.innebygd || !kanForside()) { b.style.display = "none"; b.dataset.skjultForside = "1"; return; }
  b.onclick = lagreForsidebilde;
}
