// 🧭 ALLE VERKTØY — oversikt med snarveier (forslag 7, Emil 02.11).
//
// HVORFOR: flere verktøy bor INNI andre verktøy og er vanskelige å finne
// for den som ikke vet hvor de ligger: Løfteplan i Rigg, Kollisjon i Lag,
// Rapport i Framdriftsplan og Sjekkliste før støp i Støpeplan. Oversikten
// viser alle verktøyene gruppe for gruppe, med de «gjemte» øverst, og ett trykk
// tar deg dit.
//
// Lista over verktøy LESES fra verktøygruppene (js/verktoygrupper.js) og
// knappene selv (navn og forklaring), så den kan ikke komme i utakt med
// verktøylinja. Bare de gjemte er skrevet inn her.
//
// Lista (VERKTOY) er også grunnlaget for hurtigsøket (forslag 6), når det kommer.
//
// Importeres bare fra main.js (kontoret).
import { $, S, esc, ikon, på, apnePanel } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { GRUPPER, knappSynlig, settGruppe } from "./verktoygrupper.js";

const PANEL = "alleVerktoyPanel";

const erApen = (id) => { const p = $(id); return !!(p && p.classList.contains("open")); };
// Åpner et panel via sin egen knapp (knappen er en veksler — trykkes bare
// hvis panelet er lukket)
function apneVia(panelId, knappId) {
  if (erApen(panelId)) return true;
  const b = $(knappId);
  if (b) b.click();
  return erApen(panelId);
}

// ---------- Verktøy som bor inni andre verktøy ----------
export const GJEMTE = [
  { id: "lofteplan", navn: "Løfteplan", inni: "Rigg", ikon: "kran", knapp: "btnRigg",
    hjelp: "Kransjekk av løftene: vekt, radius og lastkurve",
    gaa: () => { if (!apneVia("riggPanel", "btnRigg")) return false; if (S.riggApneLofteplan) S.riggApneLofteplan(); return true; } },
  { id: "kollisjon", navn: "Kollisjon", inni: "Lag", ikon: "kollisjon", knapp: "btnLag",
    hjelp: "Finn kollisjoner mellom hovedmodellen og lagene",
    gaa: () => {
      if (!apneVia("lagPanel", "btnLag")) return false;
      if (S.lagVisFane && !S.lagVisFane("kollisjon")) varsel(t("Kollisjon vises når det er lagt til minst ett lag. Legg til et lag først."));
      return true;
    } },
  { id: "framdriftsrapport", navn: "Framdriftsrapport", inni: "Framdriftsplan", ikon: "framdrift", knapp: "btnFramdrift",
    hjelp: "Ferdigmeld det som er utført og se hvor langt dere er mot planen",
    gaa: () => { S.fpFane = "rapport"; if (!apneVia("framdriftPanel", "btnFramdrift")) return false; if (S.framdriftVisFane) S.framdriftVisFane("rapport"); return true; } },
  { id: "sjekkliste", navn: "Sjekkliste før støp", inni: "Støpeplan", ikon: "hake", knapp: "btnStopeplan",
    hjelp: "Én sjekkliste per støpeetappe — åpnes under hver etappe",
    gaa: () => {
      if (!apneVia("stopePanel", "btnStopeplan")) return false;
      const sj = document.querySelector("#stopePanel .sj-boks");
      if (sj) { try { sj.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} sj.classList.add("blink"); setTimeout(() => sj.classList.remove("blink"), 1600); }
      else varsel(t("Sjekklista ligger under hver støpeetappe. Lag en etappe med «Ny etappe» først."));
      return true;
    } }
];

// Navn og forklaring rett fra knappen (allerede oversatt av oversettDom)
function knappInfo(id) {
  const b = $(id);
  if (!b) return null;
  const tekst = (b.querySelector(".btn-t") || b).textContent.trim();
  const bruk = b.querySelector("use");
  return { navn: tekst, hjelp: b.getAttribute("title") || "", ikon: bruk ? (bruk.getAttribute("href") || "").replace("#i-", "") : "" };
}

// Alle verktøy som en flat liste — [{ id, navn, hjelp, ikon, gruppe, gruppeNavn, inni? }]
export function VERKTOY() {
  // Verktøylinja skjuler knappene i de andre gruppene med CSS (data-gruppe på
  // #toolbar). Den skjulingen skal ikke telle her — vi tar attributtet av
  // mens vi måler og setter det tilbake (synkront, så ingenting blinker).
  const linje = $("toolbar");
  const g0 = linje ? linje.dataset.gruppe : undefined;
  if (linje) delete linje.dataset.gruppe;
  try { return lagListe(); }
  finally { if (linje && g0 !== undefined) linje.dataset.gruppe = g0; }
}
function lagListe() {
  const ut = [];
  for (const g of GJEMTE) {
    if (!knappSynlig(g.knapp)) continue;
    ut.push({ id: "gjemt:" + g.id, navn: t(g.navn), hjelp: t(g.hjelp), ikon: g.ikon, gruppe: "gjemt", gruppeNavn: t("Inni andre verktøy"), inni: t(g.inni) });
  }
  for (const g of GRUPPER) {
    for (const id of g.knapper) {
      if (id === "btnAlleVerktoy" || !knappSynlig(id)) continue;
      const k = knappInfo(id);
      if (!k || !k.navn) continue;
      ut.push({ id, navn: k.navn, hjelp: k.hjelp, ikon: k.ikon, gruppe: g.id, gruppeNavn: t(g.navn) });
    }
  }
  return ut;
}

// Går til et verktøy: bytter til riktig gruppe i verktøylinja (så knappen
// synes etterpå) og trykker knappen — eller tar snarveien inn i verktøyet.
export function gaaTil(id) {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return "ingen-modell"; }
  const p = $(PANEL); if (p) p.classList.remove("open");
  if (String(id).startsWith("gjemt:")) {
    const g = GJEMTE.find(x => "gjemt:" + x.id === id);
    if (!g) return "fant-ikke";
    const gr = GRUPPER.find(x => x.knapper.includes(g.knapp));
    if (gr) settGruppe(gr.id);
    return g.gaa() ? "trykket" : "fant-ikke";
  }
  const gr = GRUPPER.find(x => x.knapper.includes(id));
  if (gr) settGruppe(gr.id);
  const b = $(id);
  if (!b) return "fant-ikke";
  b.click();
  return "trykket";
}
S.gaaTilVerktoy = gaaTil;

function panelEl() {
  let p = $(PANEL);
  if (p) return p;
  p = document.createElement("div");
  p.className = "panel";
  p.id = PANEL;
  p.innerHTML = '<header><span>' + esc(t("Alle verktøy")) + '</span><button data-lukk="' + PANEL + '" title="' + esc(t("Lukk")) + '">' + ikon("lukk") + "</button></header>" +
    '<div class="body" id="alleVerktoyBody"></div>';
  document.body.appendChild(p);
  p.querySelector("[data-lukk]").onclick = () => p.classList.remove("open");
  return p;
}

export function tegnOversikt() {
  const p = panelEl();
  const body = p.querySelector(".body");
  const liste = VERKTOY();
  let h = '<p class="set-hjelp">' + esc(t("Trykk på et verktøy for å gå rett dit. De øverste ligger inni andre verktøy og er lette å overse.")) + "</p>";
  let forrige = "";
  for (const v of liste) {
    if (v.gruppe !== forrige) {
      if (forrige) h += "</div>";
      h += '<h4>' + esc(v.gruppeNavn) + '</h4><div class="av-liste">';
      forrige = v.gruppe;
    }
    h += '<button type="button" class="av-rad" data-av="' + esc(v.id) + '">' + (v.ikon ? ikon(v.ikon) : "") +
      '<span class="av-tekst"><b>' + esc(v.navn) + "</b>" + (v.inni ? ' <span class="av-inni">' + esc(t("i {0}", v.inni)) + "</span>" : "") +
      (v.hjelp ? '<small>' + esc(v.hjelp) + "</small>" : "") + "</span></button>";
  }
  if (forrige) h += "</div>";
  body.innerHTML = h;
  body.querySelectorAll("[data-av]").forEach(b => b.onclick = () => gaaTil(b.dataset.av));
}

export function apneOversikt() {
  tegnOversikt();
  apnePanel(PANEL);
}
S.apneAlleVerktoy = apneOversikt;

på("btnAlleVerktoy", "click", () => {
  if (erApen(PANEL)) { $(PANEL).classList.remove("open"); return; }
  apneOversikt();
});
