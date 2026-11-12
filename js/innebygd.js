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
import { t } from "./i18n.js";
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
    S.msHint = h;   // sharepoint.js: ssoSilent og popup med kontoen ferdig valgt
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
    '<div class="ib-verktoy" id="ibVerktoy" role="toolbar"></div>' +
    '<div class="ib-hoyre"><small id="ibBruker">' + esc(kortNavn()) + '</small>' +
      (innrammet ? '<button type="button" id="ibFullskjerm" data-i18n-title data-no-title="Åpne i full skjerm" title="' + esc(t("Åpne i full skjerm")) + '">' + ikon("fullskjerm") + '</button>' : "") +
      '<button type="button" id="ibApne" data-i18n-title data-no-title="Åpne Storm IFC i en egen fane" title="' + esc(t("Åpne Storm IFC i en egen fane")) + '">' + ikon("apne") +
        '<span class="btn-t" data-i18n data-no="Åpne i Storm IFC">' + esc(t("Åpne i Storm IFC")) + '</span></button></div>';
  document.body.appendChild(linje);
  byggVerktøy();
  // 🎯 Runde G: samme modell og samme mål (markering, kollisjon, element)
  $("ibApne").onclick = () => window.open(R.vanligMedMål(vanligAdresse(), ADR), "_blank", "noopener");
  const fs = $("ibFullskjerm");
  if (fs) fs.onclick = () => window.open(location.href, "_blank", "noopener");
}

// ---------- 🧰 Verktøylinja (Emil 10.11: C på PC, C2 på telefon) ----------
// #ibVerktoy: kategoriene + de faste knappene. #ibRad: verktøyene i valgt
// kategori. Knappene er de EKTE knappene, flyttet inn — ingen kopier.
let aktivKat = "mal";
const erTelefon = () => window.innerWidth <= R.TELEFON_BREDDE;
function lagMer(id) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "ib-mer"; b.id = id; b.hidden = true;
  b.title = t("Flere verktøy"); b.dataset.i18nTitle = ""; b.dataset.noTitle = "Flere verktøy";
  b.innerHTML = ikon("mer") + '<span class="btn-t" data-i18n data-no="Mer">' + esc(t("Mer")) + '</span>';
  return b;
}
function byggVerktøy() {
  const v = $("ibVerktoy");
  const rad = document.createElement("div"); rad.id = "ibRad"; rad.setAttribute("role", "toolbar");
  document.body.appendChild(rad);
  const liste = document.createElement("div"); liste.id = "ibMerListe"; liste.hidden = true;
  document.body.appendChild(liste);
  let n = 0;
  for (const k of R.INNEBYGD_KATEGORIER) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ib-kat"; b.dataset.kat = k.id; b.dataset.ibRekke = String(n++);
    b.title = t(k.navn); b.dataset.i18nTitle = ""; b.dataset.noTitle = k.navn;
    b.innerHTML = ikon(k.ikon) + '<span class="btn-t" data-i18n data-no="' + esc(k.navn) + '">' + esc(t(k.navn)) + '</span>';
    b.onclick = () => velgKat(aktivKat === k.id && !rad.hidden ? "" : k.id);
    v.appendChild(b);
  }
  const skille = document.createElement("span"); skille.className = "ib-skille2"; skille.dataset.ibRekke = String(n++);
  v.appendChild(skille);
  for (const id of R.INNEBYGD_FASTE) { const b = $(id); if (b) { b.dataset.ibRekke = String(n++); v.appendChild(b); } }
  v.appendChild(lagMer("ibMerKat"));
  rad.appendChild(lagMer("ibMerRad"));
  $("ibMerKat").onclick = (e) => { e.stopPropagation(); visMer(v, $("ibMerKat")); };
  $("ibMerRad").onclick = (e) => { e.stopPropagation(); visMer(rad, $("ibMerRad")); };
  // Et trykk på et verktøy i «Mer» bruker verktøyet og lukker lista.
  liste.addEventListener("click", (e) => { if (e.target.closest("button")) setTimeout(lukkMer, 0); });
  document.addEventListener("pointerdown", (e) => {
    if (liste.hidden || liste.contains(e.target) || (e.target.closest && e.target.closest(".ib-mer"))) return;
    lukkMer();
  }, true);
  velgKat(aktivKat);
  infoOgVerktøy();
  utseendeKompakt();
  plasser();
  window.addEventListener("resize", plasser);
  // Også når tittelen eller «lastet på …» endrer bredden på verktøydelen.
  if (typeof ResizeObserver !== "undefined") {
    let venter = false;
    const ro = new ResizeObserver(() => { if (venter) return; venter = true; requestAnimationFrame(() => { venter = false; plasser(); }); });
    ro.observe(document.body); ro.observe(v);
  }
  // «Vis alle» vises og skjules av kontorkoden (inline display) – da må
  // plassen regnes ut på nytt.
  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(() => requestAnimationFrame(plasser));
    for (const id of R.INNEBYGD_FASTE) { const b = $(id); if (b) mo.observe(b, { attributes: true, attributeFilter: ["style", "hidden"] }); }
  }
}
// Telefon (Emil 10.11): trykker du på et element, lukkes verktøyraden og et
// åpent måleverktøy, så målelinja ikke legger seg over infoboksen. Velger du
// et verktøy, lukkes infoboksen.
function infoOgVerktøy() {
  const panel = $("propPanel");
  if (!panel || typeof MutationObserver === "undefined") return;
  let varÅpen = panel.classList.contains("open");
  new MutationObserver(() => {
    const åpen = panel.classList.contains("open");
    if (åpen && !varÅpen && erTelefon()) {
      const rad = $("ibRad");
      if (rad && !rad.hidden) velgKat("");
      for (const k of R.INNEBYGD_KATEGORIER) for (const kid of k.knapper) {
        const b = $(kid);
        if (b && b.classList.contains("active") && ["btnMeasure", "btnKjede", "btnVinkel"].includes(kid)) b.click();
      }
    }
    varÅpen = åpen;
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  $("ibRad").addEventListener("click", (e) => {
    if (!erTelefon() || !e.target.closest("button") || e.target.closest(".ib-mer")) return;
    if (panel.classList.contains("open")) { const x = panel.querySelector("[data-lukk]"); if (x) x.click(); }
  }, true);
}

// 🎨 Telefon (Emil 10.11): Utseende-boksen viser tre typer om gangen og ruller
// resten, som infoboksen – ellers dekket den 80–90 % av skjermen. Høyden
// regnes av de faktiske radene: knappene, Bakgrunn og tre typer.
const UTSEENDE_RADER = 3;
function utseendeKompakt() {
  const body = $("colorBody");
  if (!body || typeof MutationObserver === "undefined") return;
  const tilpass = () => {
    body.style.maxHeight = "";
    body.classList.remove("kan-rulle");
    if (!erTelefon()) return;
    const knapper = body.querySelector(".prop-actions");
    const rader = [...body.querySelectorAll(".qty-row")];
    if (!rader.length) return;
    let h = 0;
    if (knapper) h += knapper.offsetHeight + (parseFloat(getComputedStyle(knapper).marginBottom) || 0);
    for (const r of rader.slice(0, 1 + UTSEENDE_RADER)) h += r.offsetHeight;   // Bakgrunn + tre typer
    if (!h) return;
    const cs = getComputedStyle(body);
    body.style.maxHeight = Math.ceil(h + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)) + "px";
    body.classList.toggle("kan-rulle", rader.length > 1 + UTSEENDE_RADER);
  };
  new MutationObserver(() => requestAnimationFrame(tilpass)).observe(body, { childList: true });
  window.addEventListener("resize", tilpass);
}

function velgKat(id) {
  aktivKat = id || aktivKat;
  const rad = $("ibRad");
  lukkMer();
  // Verktøyene i de andre kategoriene parkeres i et skjult lager – de må
  // ALDRI tas ut av dokumentet: resten av koden slår dem opp med id (clearModel
  // m.fl.) og krasjer på null.
  let lager = $("ibLager");
  if (!lager) { lager = document.createElement("div"); lager.id = "ibLager"; lager.hidden = true; document.body.appendChild(lager); }
  for (const k of R.INNEBYGD_KATEGORIER) for (const kid of k.knapper) { const b = $(kid); if (b) { delete b.dataset.ibFra; lager.appendChild(b); } }
  const k = R.INNEBYGD_KATEGORIER.find(x => x.id === aktivKat);
  let n = 0;
  if (id && k) for (const kid of k.knapper) { const b = $(kid); if (b) { b.dataset.ibRekke = String(n++); rad.insertBefore(b, $("ibMerRad")); } }
  rad.hidden = !id;
  document.querySelectorAll("#ibVerktoy .ib-kat, #ibMerListe .ib-kat").forEach(b => b.classList.toggle("paa", !!id && b.dataset.kat === aktivKat));
  plasser();
}
// Legger det som ikke får plass i «Mer» (målt, ikke gjettet).
function fordel(boks, mer) {
  const liste = $("ibMerListe");
  // alt tilbake i boksen, i opprinnelig rekkefølge
  const egne = Array.from(liste.children).filter(e => e.dataset.ibFra === boks.id);
  egne.forEach(e => { delete e.dataset.ibFra; boks.insertBefore(e, mer); });
  const elementer = Array.from(boks.children).filter(e => e !== mer)
    .sort((a, b) => Number(a.dataset.ibRekke) - Number(b.dataset.ibRekke));
  elementer.forEach(e => boks.insertBefore(e, mer));
  mer.hidden = false;
  const merB = mer.offsetWidth;
  mer.hidden = true;
  const synlige = elementer.filter(e => e.offsetWidth > 0 || e.classList.contains("ib-skille2"));
  const stil = getComputedStyle(boks);
  const plass = boks.clientWidth - (parseFloat(stil.paddingLeft) || 0) - (parseFloat(stil.paddingRight) || 0);
  const får = R.antallSomFårPlass(synlige.map(e => e.offsetWidth), plass, merB, parseFloat(stil.columnGap) || 6);
  if (får >= synlige.length) return;
  mer.hidden = false;
  synlige.slice(får).forEach(e => {
    if (e.classList.contains("ib-skille2")) return;   // skillestreken hører ikke hjemme i en liste
    e.dataset.ibFra = boks.id; liste.appendChild(e);
  });
}
function plasser() {
  const linje = $("innebygdBar"), v = $("ibVerktoy"), rad = $("ibRad");
  if (!linje || !v || !rad) return;
  const tlf = erTelefon();
  rot.dataset.ibTelefon = tlf ? "1" : "";
  // Alltid i topplinja (Emil 10.11): nederst dekket linja målelinja.
  if (v.parentNode !== linje) linje.insertBefore(v, linje.querySelector(".ib-hoyre"));
  const topp = linje.getBoundingClientRect().height;
  rot.style.setProperty("--ib-topp", topp + "px");
  // Trangt? Først bare ikoner på de faste knappene (Navigasjon, Innstillinger),
  // deretter «Mer» for det som fortsatt ikke får plass.
  v.classList.remove("ib-tett");
  fordel(v, $("ibMerKat"));
  if (!$("ibMerKat").hidden) { v.classList.add("ib-tett"); fordel(v, $("ibMerKat")); }
  if (!rad.hidden) fordel(rad, $("ibMerRad"));
  rot.style.setProperty("--ib-bunn", "0px");
  // Verktøyraden skyver visningskuben ned, så de ikke ligger oppå hverandre.
  rot.style.setProperty("--ib-rad", rad.hidden ? "0px" : (rad.getBoundingClientRect().height + 8) + "px");
}
function visMer(boks, mer) {
  const liste = $("ibMerListe");
  const åpen = !liste.hidden && liste.dataset.fra === boks.id;
  lukkMer();
  if (åpen) return;
  Array.from(liste.children).forEach(e => { e.style.display = e.dataset.ibFra === boks.id ? "" : "none"; });
  liste.dataset.fra = boks.id;
  liste.hidden = false;
  mer.classList.add("paa");
  const r = mer.getBoundingClientRect(), l = liste.getBoundingClientRect();
  liste.style.left = Math.max(8, Math.min(r.right - l.width, window.innerWidth - l.width - 8)) + "px";
  liste.style.top = (r.top > window.innerHeight / 2 ? r.top - l.height - 6 : r.bottom + 6) + "px";
}
function lukkMer() {
  const liste = $("ibMerListe");
  if (liste) { liste.hidden = true; Array.from(liste.children).forEach(e => { e.style.display = ""; }); }
  document.querySelectorAll(".ib-mer.paa").forEach(b => b.classList.remove("paa"));
}

function settArt(art) {
  const a = $("ibArt");
  if (a) delete a.dataset.art;
  if (a) a.textContent = art === "ekstra" ? t("ekstra lett kopi") : art === "lett" ? t("lett kopi") : art === "ifc" ? t("full modell") : "";
}

function visMelding(tekst) {
  if (!ADR.innebygd) { varsel(tekst); return; }   // vanlig modus (åpnet med ?modell=)
  const v = $("ibVerktoy");
  visKort('<h2>' + esc(visNavn() || norsk("3D-modellen")) + '</h2><p>' + esc(tekst) + '</p>');
  if (v) v.style.visibility = "hidden";
  const rad = $("ibRad"); if (rad) rad.hidden = true;
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

// ---------- ⚡ B4 valg C (Emil 10.11): forsidebildet mens modellen lastes ----------
// Mørk bakgrunn som før, forsidebildet som et kort i midten, modellnavnet og
// en fremdriftsstolpe under. Finnes ikke bildet, står spinneren som før.
let lasteUrl = "";
export function visLasting(forsideNavn) {
  const l = loadingEl;
  if (!l || $("ibLasteBilde")) return;
  l.classList.add("ib-last");
  const navn = document.createElement("b"); navn.id = "ibLasteNavn"; navn.textContent = visNavn() || "";
  const stolpe = document.createElement("div"); stolpe.className = "ib-stolpe"; stolpe.innerHTML = '<i id="ibLasteStolpe"></i>';
  const tekst = $("loadingText");
  l.insertBefore(navn, tekst); l.insertBefore(stolpe, tekst);
  S.lasteFremdrift = (pst) => { const s = $("ibLasteStolpe"); if (s) s.style.width = Math.max(0, Math.min(100, pst)) + "%"; };
  // Bildet hentes ved siden av nedlastingen — modellen venter aldri på det.
  (async () => {
    try {
      const { spLesBin } = await import("./sp-lager.js");
      const r = await spLesBin(R.FORSIDE_MAPPE, forsideNavn);
      if (r.status !== "ok" || !r.data || !l.classList.contains("open")) return;
      lasteUrl = URL.createObjectURL(new Blob([r.data], { type: "image/png" }));
      const img = document.createElement("img"); img.id = "ibLasteBilde"; img.alt = ""; img.src = lasteUrl;
      l.insertBefore(img, navn);
      l.classList.add("ib-med-bilde");
    } catch (_) { /* uten bilde: spinneren står */ }
  })();
}
export function ryddLasting() {
  ["ibLasteBilde", "ibLasteNavn"].forEach(id => { const e = $(id); if (e) e.remove(); });
  const s = loadingEl && loadingEl.querySelector(".ib-stolpe"); if (s) s.remove();
  if (loadingEl) loadingEl.classList.remove("ib-last", "ib-med-bilde");
  if (lasteUrl) { URL.revokeObjectURL(lasteUrl); lasteUrl = ""; }
  S.lasteFremdrift = null;
}
// Målingen i topplinja etter lasting: «ekstra lett kopi · lastet på 4,1 s»
S.etterMåling = async (m) => {
  if (!ADR.innebygd) return;
  // Utseende uten typer viser bare «UKJENT» – da skjules knappen (Emil 10.11).
  try {
    const { antallKjenteTyper } = await import("./display.js");
    const b = $("btnColors");
    if (b) { b.classList.toggle("ib-ingen-typer", antallKjenteTyper() === 0); plasser(); }
  } catch (_) { /* knappen står */ }
  try {
    const LR = await import("./modell-lager-regn.js");
    const a = $("ibArt");
    const tot = (m.nedMs || 0) + (m.tolkMs || 0) + (m.tegnMs || 0);
    const kort = t("lastet på {0}", LR.sek(tot)) + (m.kilde === "lokal" ? " " + t("(lokal kopi)") : m.kilde === "gz" ? " " + t("(komprimert)") : "");
    if (a) { a.dataset.art = a.dataset.art || a.textContent; a.textContent = (a.dataset.art ? a.dataset.art + " · " : "") + kort; a.title = LR.måleLinje(m); }
  } catch (_) { /* bare pynt */ }
};

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
  visLasting(R.forsideNavn(valg.fil.name, ifcNavn));
  try { await sp.spOpenFile(valg.fil); } finally { ryddLasting(); }
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
  visLasting(R.forsideNavn(fil.name, eier));
  try { await sp.spOpenFile(fil); } finally { ryddLasting(); }
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

// SharePoint-innlogging før modellen hentes. Beviset (12 t) slipper deg inn i
// Storm IFC uten Microsoft-innlogging i denne økta – men modellfilene leses med
// DINE SharePoint-rettigheter, så Graph må ha et token. Rekkefølge: stille →
// ssoSilent med e-posten fra Storm Prosjekter → kontokortet med «Fortsett»
// (popup fra et klikk – nettleseren blokkerer popup uten klikk, og MSAL nekter
// omdirigering i en ramme). Telefon i ramme: åpne i egen fane.
async function sikreSharePoint() {
  const sp = await import("./sharepoint.js");
  if (await sp.spTokenSilent()) return true;
  const hint = await ventPåHint(2500);
  if (hint && await sp.spTokenSilent()) return true;   // graphToken prøver ssoSilent med hintet
  return new Promise((løs) => {
    const tlf = innrammet && !sp.brukPopup();
    const navn = hint ? R.navnFraEpost(hint) : "";
    visKort('<h2>' + esc(tittel()) + '</h2>' +
      '<p>' + esc(tlf ? norsk("På telefon åpnes modellen i en egen fane.") : norsk("Logg inn på SharePoint for å hente modellen. Nettleseren ba om ett klikk.")) + '</p>' +
      (hint ? '<div class="ib-konto"><span class="ib-sirkel" aria-hidden="true">' + esc(R.initialer(navn)) + '</span>' +
        '<span class="ib-konto-tekst"><b>' + esc(navn) + '</b><small>' + esc(hint) + '</small></span></div>' : "") +
      '<p class="kb-feil" id="ibSpFeil"></p>' +
      '<button type="button" class="ib-knapp" id="ibSpFortsett">' + esc(tlf ? norsk("Åpne i full skjerm") : norsk("Fortsett")) + '</button>' +
      (hint && !tlf ? '<button type="button" class="ib-lenke" id="ibSpAnnen">' + esc(norsk("Ikke deg? Bruk en annen konto")) + '</button>' : ""));
    const prøv = async (velgKonto) => {
      if (tlf) { window.open(location.href, "_blank", "noopener"); return; }
      try { await sp.msIdToken({ popup: true, velgKonto, loginHint: velgKonto ? undefined : hint }); }
      catch (err) { if (!sp.avbruttAvBruker(err)) { $("ibSpFeil").textContent = norsk("Innloggingen gikk ikke: {0}", (err && err.message) || err); } return; }
      if (await sp.spTokenSilent()) { lukkKort(); løs(true); }
      else $("ibSpFeil").textContent = norsk("Fikk ikke tilgang til SharePoint. Prøv igjen.");
    };
    $("ibSpFortsett").onclick = () => prøv(false);
    const a = $("ibSpAnnen"); if (a) a.onclick = () => prøv(true);
  });
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
  // 📋 Egenskapspanelet som på byggeplassen (Emil 10.11: «infoboksen tar 60 %
  // av skjermen»): navnet og tre rader med rulling, maks 45 % av høyden.
  try { await import("./prop-kompakt.js"); } catch (_) { /* panelet virker som før */ }
  if (ADR.gruppe || ADR.lett || ADR.modell) await sikreSharePoint();
  let åpnet = false;
  if (ADR.gruppe) { await åpneGruppe(ADR.gruppe); åpnet = !!S.modelGroup; }
  else if (ADR.lett) åpnet = await åpneLett(ADR.lett);
  else if (ADR.modell) åpnet = await åpneModell(ADR.modell);
  else visMelding(norsk("Ingen modell er koblet til prosjektet ennå."));
  if (åpnet && R.harMål(ADR)) await (await import("./vis-mal.js")).gåTilMål(ADR);
}

// 🎯 Vanlig modus med ?modell=…&markering=… («Åpne i Storm IFC» fra 3D-vinduet,
// runde G). Bare stille innlogging: er du ikke logget inn, åpnes Storm IFC
// som før, og du får beskjed om hvilken modell lenken gjaldt.
export async function startVanligMål() {
  if (ADR.innebygd) return;
  let p; try { p = new URLSearchParams(location.search); } catch (_) { return; }
  const modell = (p.get("modell") || "").trim(), lett = (p.get("lett") || "").trim(), gruppe = (p.get("gruppe") || "").trim();
  if (!modell && !lett && !gruppe) return;
  const mål = R.lesMål(location.search);
  const sp = await import("./sharepoint.js");
  let token = null;
  for (let i = 0; i < 20 && !token; i++) { try { token = await sp.spTokenSilent(); } catch (_) { token = null; } if (!token) await new Promise(r => setTimeout(r, 500)); }
  if (!token) { varsel(norsk("Logg inn på SharePoint og åpne «{0}» fra Biblioteket.", R.modellTittel(modell || lett || gruppe))); return; }
  let åpnet = false;
  if (gruppe) { await åpneGruppe(gruppe); åpnet = !!S.modelGroup; }
  else if (lett) åpnet = await åpneLett(lett);
  else åpnet = await åpneModell(modell);
  if (åpnet && R.harMål(mål)) await (await import("./vis-mal.js")).gåTilMål(mål);
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
// ---------- ⚡ B4: komprimert kopi (.glb.gz) automatisk ----------
// Ble en lett kopi lastet ned ukomprimert fordi det ikke fantes en fersk
// «<navn>.glb.gz», lager Storm IFC den i bakgrunnen og legger den ved siden
// av (bare Storm/admin, ikke på telefon). Neste åpning henter da 2–4 ganger
// mindre. Tapsfritt: gzip endrer ingen byte i selve modellen.
const svakEnhet = () => window.innerWidth <= 640 || (window.matchMedia && !window.matchMedia("(pointer: fine)").matches);
async function autoGz(item, meta) {
  try {
    const m = S.sistLasting || {};
    if (!/\.glb$/i.test(item.name) || m.navn !== item.name || m.kilde !== "nett") return;
    if (typeof DecompressionStream === "undefined" || !kanForside() || svakEnhet()) return;
    await sov(5000);                                   // la modellen og brukeren få ro først
    if (S.fileName !== item.name || !S.lastBuffer) return;
    const L = await import("./modell-lager.js");
    const LR = await import("./modell-lager-regn.js");
    const rå = S.lastBuffer;
    const pakket = await L.gzip(rå);
    if (!pakket) return;
    console.info("⚡ gzip " + item.name + ": " + LR.mb(rå.byteLength) + " → " + LR.mb(pakket.byteLength) +
      " (" + Math.round(pakket.byteLength / rå.byteLength * 100) + " %)");
    if (!LR.verdtGz(rå.byteLength, pakket.byteLength)) return;
    const { spLastOppVed } = await import("./sharepoint.js");
    const r = await spLastOppVed(meta, LR.gzNavn(item.name), pakket, "application/gzip");
    if (r.ok) console.info("⚡ Komprimert kopi lagret: " + LR.gzNavn(item.name));
    else console.warn("⚡ Komprimert kopi ble ikke lagret (" + r.grunn + ")");
  } catch (err) { console.warn("⚡ Komprimert kopi feilet:", err && err.message); }
}

S.etterSpModell = (item, meta) => { autoForside(item, meta); autoGz(item, meta); };

export function startForsidebilde() {
  const b = $("btnForsidebilde");
  if (!b) return;
  if (ADR.innebygd || !kanForside()) { b.style.display = "none"; b.dataset.skjultForside = "1"; return; }
  b.onclick = lagreForsidebilde;
}
