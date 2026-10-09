// 🌦 Vis vær — panelet på kontoret (alternativ C «planleggingskort», valgt 09.10).
//
// Emil 09.10: «en knapp som heter Vis vær, så får du en visuell presentasjon
// av været den dagen — regn, sol, snø, overskyet, storm — med en slider du
// kan dra i for å se været for hele døgnet. Temperatur, vindhastighet og
// mengde snø og regn. Dagen velges i en kalender, og den står på dagens dato
// når den åpnes.» Og om bruken: «vi skal støpe — hvor mye regner det den
// dagen? Er vinden for høy i dag til å bruke tårnkrana?»
//
// Derfor står svarene på de tre spørsmålene øverst (tårnkran, støp, frost),
// så timetabellen. Grensene stilles inne i verktøyet (Emil 09.10).
// «Vis vær» slår også på været i Framdriftsplan — på kontoret og på
// byggeplass-siden (sendes ut med Storm-Byggeplass).
//
// Posisjonen er byggeplassens adresse fra Prosjektinfo i Innstillinger
// (reserve: terrengets adresse).
import { $, S, apnePanel, esc, på, writePrefs } from "./state.js";
import { t } from "./i18n.js";
import { BILDE_NAVN, GRENSER_STANDARD, dagnavn, datoLang, iDagISO, lokal, periodeTekst, retningNavn, vaskGrenser } from "./vaer-regn.js";
import { VARSEL_TEKST, dagData, grenser, nullstillBuffer, posisjon, sisteHentFeil, vaerIkon } from "./vaer-felles.js";

let dato = "", time = 12, data = null, henter = false, forespurt = "";

function erApen() { const p = $("vaerPanel"); return !!(p && p.classList.contains("open")); }
const tall1 = (v) => v == null ? "–" : String(Math.round(v * 10) / 10).replace(".", ",");
const pad = (n) => String(n).padStart(2, "0");

async function last() {
  const k = posisjon();
  if (!k) { data = null; tegnPanel(); return; }
  const n = k.lat + "," + k.lon + "|" + dato + "|" + JSON.stringify(grenser());
  forespurt = n;
  henter = true; tegnPanel();
  let d = null;
  try { d = await dagData(k, dato); } catch (_) { d = null; }
  if (forespurt !== n) return;        // brukeren rakk å velge en annen dag
  henter = false; data = d;
  // Glideren går til første time med data hvis den står på en tom time
  if (data && !data.d[time]) { const f = data.d.findIndex(Boolean); if (f >= 0) time = f; }
  tegnPanel();
}

const STATUS = {
  ja: ["ok", "Ja"], delvis: ["warn", "Delvis"], nei: ["fare", "Nei"], "": ["muted", ""]
};
function statusRad(navn, st, under) {
  const [kl, ord] = STATUS[st || ""];
  return '<div class="vr-svar"><span>' + esc(navn) + (under ? '<small>' + esc(under) + "</small>" : "") + "</span>" +
    '<b class="vr-' + kl + '">● ' + esc(ord ? t(ord) : "–") + "</b></div>";
}

function kildeTekst() {
  if (!data) return "";
  const met = t("Værdata: MET Norway (CC BY 4.0)");
  if (data.kilde === "maalt") {
    const s = (data.stasjoner || []).map(x => x.navn + (x.avstand != null ? " (" + tall1(x.avstand) + " km)" : "")).join(", ");
    return t("Målt vær fra Frost (MET Norway, CC BY 4.0)") + (s ? " · " + t("stasjon {0}", s) : "");
  }
  if (data.kilde === "varslet") return t("Varselet slik det var den dagen (lagret av Storm). Målt vær krever Frost-nøkkel i Workeren.") + " · " + met;
  if (data.kilde === "varsel") {
    const o = data.oppdatert ? lokal(data.oppdatert) : null;
    return met + (o ? " · " + t("oppdatert {0} kl. {1}", datoLang(o.dato), pad(o.time)) : "");
  }
  return met;
}

export function tegnPanel() {
  const body = $("vaerBody");
  if (!body) return;
  const g = grenser();
  const pi = S.prosjektInfo ? S.prosjektInfo() : {};
  const k = posisjon();
  let html =
    '<div class="vr-topp"><label class="vr-dato">' + esc(t("Dag")) + ' <input type="date" id="vrDato" value="' + esc(dato) + '"></label>' +
      '<span class="vr-dagnavn">' + esc(t(dagnavn(dato))) + "</span>" +
      '<button id="vrIdag"' + (dato === iDagISO() ? " disabled" : "") + ">" + esc(t("I dag")) + "</button></div>" +
    '<p class="vr-sted">' + (pi.adresse ? esc(pi.adresse) + (pi.kommune ? ", " + esc(pi.kommune) : "") +
      (pi.fra && pi.fra.adresse === "terreng" ? ' <span class="hint">(' + esc(t("fra Terreng")) + ")</span>" : "") : "") + "</p>";
  if (!k) {
    html += '<p class="hint">' + esc(t("Legg inn byggeplassens adresse i Innstillinger → Prosjektinfo, så vises været der.")) + "</p>" +
      '<div class="prop-actions"><button id="vrTilInnst" class="primary">' + esc(t("Åpne Innstillinger")) + "</button></div>";
  } else if (henter && !data) {
    html += '<p class="hint">' + esc(t("Henter været …")) + "</p>";
  } else if (!data || !data.sum.harData) {
    const fram = data && !data.kilde && dato > iDagISO();
    html += '<p class="hint">' + esc(fram
      ? t("Ingen varsel ennå for denne dagen — MET varsler ca. 9–10 dager fram. Varselet til og med {0} finnes nå.", datoLang(data.sisteVarsel))
      : sisteHentFeil() ? t("Fikk ikke hentet været. Sjekk nettet og prøv igjen.") : t("Ingen værdata for denne dagen.")) + "</p>";
  } else {
    const s = data.sum;
    html +=
      '<div class="vr-naa" id="vrNaa">' + naaHtml() + "</div>" +
      '<input type="range" id="vrTime" min="0" max="23" step="1" value="' + time + '" aria-label="' + esc(t("Klokkeslett")) + '">' +
      '<div class="vr-svarboks">' +
        statusRad(t("Tårnkran (kast under {0} m/s)", g.kranKast), s.status.kran, s.kranTimer.length ? t("stopp kl. {0}", periodeTekst(s.kranTimer)) + (s.kastMangler ? " · " + t("delvis vurdert på middelvind") : "") : "") +
        statusRad(t("Støp (under {0} mm i døgnet)", tall1(g.regnDogn)), s.status.stop, s.regnSum > 0 ? t("{0} mm, regn kl. {1}", tall1(s.regnSum), periodeTekst(s.regnTimer)) : t("opphold hele døgnet")) +
        statusRad(t("Frost (over {0} °C)", tall1(g.frost)), s.status.frost, s.frostTimer.length ? t("frost kl. {0}", periodeTekst(s.frostTimer)) : "") +
      "</div>" +
      (s.varsler.some(v => v.type === "storm") ? '<div class="vr-varsel fare">⚠ ' + esc(VARSEL_TEKST.storm(s)) + "</div>" : "") +
      '<p class="vr-dogn">' + esc(t("Døgnet: {0} til {1} °C · vind opp mot {2} m/s · {3} mm", tall1(s.min), tall1(s.maks), tall1(s.maksVind), tall1(s.regnSum))) + "</p>" +
      '<div class="vr-tabell"><table><thead><tr><th>' + esc(t("Kl.")) + "</th><th></th><th>" + esc(t("Temp")) + "</th><th>" + esc(t("Vind (kast)")) + "</th><th>" + esc(t("Nedbør")) + "</th></tr></thead><tbody>" +
      data.d.map((x, i) => x ? '<tr data-t="' + i + '"' + (i === time ? ' class="valgt"' : "") + "><td>" + pad(i) + "</td><td>" + vaerIkon(x.bilde, 18) + "</td><td>" + esc(tall1(x.temp)) + "°</td>" +
        "<td" + ((x.kast != null ? x.kast : x.vind) >= g.kranKast ? ' class="vr-fare"' : "") + ">" + esc(tall1(x.vind)) + (x.kast != null ? " (" + esc(tall1(x.kast)) + ")" : "") + "</td>" +
        "<td" + (x.regn >= g.regnTime ? ' class="vr-varm"' : "") + ">" + (x.regn > 0 ? esc(tall1(x.regn)) + " mm" : "–") + "</td></tr>" : "").join("") +
      "</tbody></table></div>";
  }
  html +=
    '<label class="set-hjelp vr-fp"><input type="checkbox" id="vrFramdrift"' + (S.settings.vaerPaa ? " checked" : "") + "> " +
      esc(t("Vis været i Framdriftsplan (også på byggeplassen)")) + "</label>" +
    '<details class="vr-grenser"><summary>' + esc(t("Grenser for varsel")) + "</summary>" +
      '<p class="hint">' + esc(t("Regn og vind vises alltid. Grensene bestemmer bare når det varsles.")) + "</p>" +
      grenseFelt("kranKast", "Tårnkran: vindkast (m/s)", g) +
      grenseFelt("stormMiddel", "Storm: middelvind (m/s)", g) +
      grenseFelt("regnDogn", "Støp: regn i døgnet (mm)", g) +
      grenseFelt("regnTime", "Støp: regn i én time (mm)", g) +
      grenseFelt("frost", "Frost: under (°C)", g) +
      '<div class="prop-actions"><button id="vrGrenseStd">' + esc(t("Tilbake til standard")) + "</button></div>" +
    "</details>" +
    '<p class="vr-kilde">' + esc(kildeTekst()) + "</p>";
  const apneGrenser = body.querySelector(".vr-grenser") && body.querySelector(".vr-grenser").open;
  body.innerHTML = html;
  if (apneGrenser) body.querySelector(".vr-grenser").open = true;
  koble();
  oppdater3D();
}

// Timen glideren står på. Egen funksjon fordi glideren IKKE skal tegne hele
// panelet på nytt mens den dras: da ble <input> byttet ut under fingeren og
// draget stoppet etter ett hakk (Emil 09.10 — 12 → 15 tok tre drag).
function naaHtml() {
  const h = data && data.d[time];
  const s = data && data.sum;
  return vaerIkon(h ? h.bilde : (s ? s.bilde : "ukjent"), 46) + "<div>" +
    (h ? "<b>" + esc(tall1(h.temp)) + " °C</b> · " + esc(t(BILDE_NAVN[h.bilde] || "")) + " · " + esc(t("kl. {0}", pad(time))) +
      '<div class="hint">' + esc(t("vind {0} m/s", tall1(h.vind))) + (h.kast != null ? ", " + esc(t("kast {0}", tall1(h.kast))) : "") +
      (h.retning != null ? " " + esc(t("fra {0}", t(retningNavn(h.retning)))) : "") + " · " +
      esc(h.regn > 0 ? t("{0} mm denne timen", tall1(h.regn)) : t("opphold")) + (h.varighet === 6 ? " · " + esc(t("6-timers varsel")) : "") + "</div>"
      : '<span class="hint">' + esc(t("Ingen data for kl. {0}", pad(time))) + "</span>") +
    "</div>";
}
// Bare timedelen oppdateres: teksten øverst, raden i tabellen og 3D-været.
function visTime() {
  const el = $("vrNaa");
  if (el) el.innerHTML = naaHtml();
  const g = $("vrTime");
  if (g && Number(g.value) !== time) g.value = String(time);
  document.querySelectorAll("#vaerBody tr[data-t]").forEach(r => r.classList.toggle("valgt", Number(r.dataset.t) === time));
  oppdater3D();
}
// 🌦 Været i 3D følger timen i panelet (vaer-3d.js, bare kontoret)
function oppdater3D() {
  if (!S.settVaer3D) return;
  const h = data && data.d[time];
  if (!erApen() || !h) { S.settVaer3D("panel", null); return; }
  const k = posisjon();
  S.settVaer3D("panel", { bilde: h.bilde, natt: S.vaerNatt ? S.vaerNatt(k && k.lat, dato, time) : 0, lyn: /thunder/.test(h.symbol || "") });
}

function grenseFelt(k, navn, g) {
  return '<label class="vr-grense">' + esc(t(navn)) + ' <input type="number" step="0.5" data-grense="' + k + '" value="' + g[k] + '" placeholder="' + GRENSER_STANDARD[k] + '"></label>';
}

function koble() {
  const d = $("vrDato");
  if (d) d.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(d.value)) { dato = d.value; data = null; last(); } };
  if ($("vrIdag")) $("vrIdag").onclick = () => { dato = iDagISO(); time = lokal(new Date()).time; data = null; last(); };
  const g = $("vrTime");
  if (g) g.oninput = () => { time = Number(g.value); visTime(); };
  document.querySelectorAll("#vaerBody tr[data-t]").forEach(r => r.onclick = () => { time = Number(r.dataset.t); visTime(); });
  if ($("vrTilInnst")) $("vrTilInnst").onclick = () => { const b = $("btnSettings"); if (b) b.click(); };
  if ($("vrFramdrift")) $("vrFramdrift").onchange = (e) => { S.settings.vaerPaa = !!e.target.checked; writePrefs(); meldFramdrift(); };
  document.querySelectorAll("#vaerBody input[data-grense]").forEach(inp => inp.onchange = () => {
    const ny = Object.assign({}, grenser(), { [inp.dataset.grense]: inp.value });
    S.settings.vaerGrenser = vaskGrenser(ny);
    writePrefs(); nullstillBuffer(); meldFramdrift();
    last();
  });
  if ($("vrGrenseStd")) $("vrGrenseStd").onclick = () => { S.settings.vaerGrenser = null; writePrefs(); nullstillBuffer(); meldFramdrift(); last(); };
}

function meldFramdrift() {
  try { document.dispatchEvent(new CustomEvent("storm-vaer")); } catch (_) {}
}

// Knappen: åpner panelet på DAGENS dato hver gang (Emil 09.10), og slår på
// været i Framdriftsplan første gang.
på("btnVaer", "click", () => {
  const p = $("vaerPanel");
  if (!p) return;
  if (p.classList.contains("open")) { p.classList.remove("open"); return; }
  dato = iDagISO();
  time = lokal(new Date()).time;
  data = null;
  if (S.settings.vaerPaa === undefined || S.settings.vaerPaa === null) { S.settings.vaerPaa = true; writePrefs(); meldFramdrift(); }
  tegnPanel();
  apnePanel("vaerPanel");
  last();
});

// Ny adresse i Prosjektinfo eller ny modell: hent på nytt hvis panelet står åpent
if (typeof document !== "undefined") document.addEventListener("storm-prosjektinfo", () => { if (erApen()) { data = null; last(); } });

// Panelet lukkes (krysset, et annet panel, Esc): 3D-været går tilbake til
// Framdriftsplan-glideren eller været nå.
(() => {
  const p = typeof document !== "undefined" && $("vaerPanel");
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!p || !MO) return;
  new MO(() => { if (!erApen() && S.settVaer3D) S.settVaer3D("panel", null); }).observe(p, { attributes: true, attributeFilter: ["class"] });
})();
