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

// ═══════════ 🔎 FINN VERKTØY — søkefelt i toppbaren (forslag 6A, Emil 03.11) ═══════════
// Alltid synlig når en modell er åpen. Ctrl+K (⌘K på Mac) hopper hit. Søker i
// den samme lista som «Alle verktøy» over — også verktøy inni andre verktøy.
// Bare på kontoret (Emils valg 03.11): byggeplass-siden har få verktøy.

// Poeng: treff i starten av navnet > starten av et ord i navnet > i navnet >
// i forklaringen / gruppa. Tomt søk gir ingen treff (lista viser hint).
const norm = (s) => String(s || "").toLowerCase().normalize("NFC");
export function sokVerktoy(sok, liste) {
  const q = norm(sok).trim();
  if (!q) return [];
  const ord = q.split(/\s+/).filter(Boolean);
  const ut = [], sett = new Set();
  for (const v of liste || []) {
    // Samme navn to steder (Løfteplan inni Rigg OG snarveien i Dokumentasjon)
    // går til samme sted — vis det én gang, den første (den «gjemte») vinner.
    if (sett.has(norm(v.navn))) continue;
    sett.add(norm(v.navn));
    const navn = norm(v.navn), rest = norm([v.hjelp, v.gruppeNavn, v.inni].join(" "));
    let poeng = 0, alle = true;
    for (const o of ord) {
      if (navn.startsWith(o)) poeng += 100;
      else if (new RegExp("(^|[\\s«(/-])" + o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(navn)) poeng += 60;
      else if (navn.includes(o)) poeng += 40;
      else if (rest.includes(o)) poeng += 10;
      else { alle = false; break; }
    }
    if (alle) ut.push({ v, poeng });
  }
  return ut.sort((a, b) => b.poeng - a.poeng || a.v.navn.localeCompare(b.v.navn, "no")).map(x => x.v);
}

// <mark> rundt det som er søkt på — teksten escapes FØRST
export function merkTreff(tekst, sok) {
  let h = esc(tekst);
  const ord = norm(sok).trim().split(/\s+/).filter(o => o.length >= 2);
  for (const o of ord) {
    const e = esc(o).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    h = h.replace(new RegExp("(" + e + ")(?![^<]*>)", "ig"), "<mark>$1</mark>");
  }
  return h;
}

let sokListe = [], sokTreff = [], sokValgt = 0;

function sokFelt() {
  let f = $("vsok");
  if (f) return f;
  const topp = $("topbar");
  if (!topp) return null;
  f = document.createElement("div");
  f.id = "vsok";
  f.className = "vsok";
  f.innerHTML = ikon("sok") + '<input id="vsokInput" type="search" autocomplete="off" spellcheck="false" aria-label="' + esc(t("Finn verktøy")) +
    '" placeholder="' + esc(t("Finn verktøy …")) + '"><kbd class="vsok-tast">' + (/Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘K" : "Ctrl K") + "</kbd>";
  const status = $("status");
  topp.insertBefore(f, status || null);
  const inp = f.querySelector("input");
  inp.addEventListener("focus", () => { sokListe = VERKTOY(); f.classList.add("apen"); visTreff(); });
  inp.addEventListener("input", () => { sokValgt = 0; visTreff(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sokValgt = Math.min(sokValgt + 1, Math.max(0, sokTreff.length - 1)); visTreff(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sokValgt = Math.max(0, sokValgt - 1); visTreff(); }
    else if (e.key === "Enter") { e.preventDefault(); const v = sokTreff[sokValgt]; if (v) velgTreff(v); }

  });
  inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) lukkSok(false); }, 150));
  f.addEventListener("pointerdown", (e) => { if (e.target !== inp) { e.preventDefault(); inp.focus(); } });
  return f;
}

function resultatBoks() {
  let r = $("vsokTreff");
  if (r) return r;
  r = document.createElement("div");
  r.id = "vsokTreff";
  r.className = "vsok-treff";
  r.setAttribute("role", "listbox");
  r.hidden = true;
  // pointerdown + preventDefault: feltet mister ikke fokus før klikket er tatt
  r.addEventListener("pointerdown", (e) => {
    const rad = e.target.closest && e.target.closest("[data-vsok]");
    e.preventDefault();
    if (rad) { const v = sokTreff[Number(rad.dataset.vsok)]; if (v) velgTreff(v); }
  });
  document.body.appendChild(r);
  return r;
}

function visTreff() {
  const inp = $("vsokInput"), r = resultatBoks();
  if (!inp) return;
  const q = inp.value;
  sokTreff = sokVerktoy(q, sokListe).slice(0, 8);
  if (!q.trim()) { r.hidden = true; return; }
  const f = $("vsok").getBoundingClientRect();
  const bredde = Math.min(400, window.innerWidth - 16);
  r.style.width = bredde + "px";
  r.style.top = (f.bottom + 6) + "px";
  r.style.left = Math.max(8, Math.min(f.left, window.innerWidth - bredde - 8)) + "px";
  r.innerHTML = (sokTreff.length
    ? sokTreff.map((v, i) => '<div class="vsok-rad' + (i === sokValgt ? " valgt" : "") + '" role="option" data-vsok="' + i + '"' + (i === sokValgt ? ' aria-selected="true"' : "") + ">" +
        (v.ikon ? ikon(v.ikon) : "") + '<div class="vsok-tekst"><b>' + merkTreff(v.navn, q) + "</b>" + (v.hjelp ? "<small>" + merkTreff(v.hjelp, q) + "</small>" : "") + "</div>" +
        '<span class="vsok-gruppe">' + esc(v.inni ? t("i {0}", v.inni) : v.gruppeNavn) + "</span></div>").join("")
    : '<div class="vsok-tom">' + esc(t("Fant ingen verktøy for «{0}».", q.trim())) + "</div>") +
    '<div class="vsok-hint">' + esc(t("↑↓ velg · Enter åpne · Esc lukk")) + "</div>";
  r.hidden = false;
}

function lukkSok(tom) {
  const r = $("vsokTreff"); if (r) r.hidden = true;
  const f = $("vsok"); if (f) f.classList.remove("apen");
  const inp = $("vsokInput");
  if (inp && tom) { inp.value = ""; if (document.activeElement === inp) inp.blur(); }
}

function velgTreff(v) {
  lukkSok(true);
  gaaTil(v.id);
}

export function apneSok() {
  const f = sokFelt();
  if (!f) return false;
  if (!S.modelGroup || getComputedStyle(f).display === "none") { varsel(t("Åpne en modell først.")); return false; }
  const inp = f.querySelector("input");
  inp.focus(); inp.select();
  return true;
}
S.apneVerktoySok = apneSok;

if (typeof document !== "undefined") {
  sokFelt();
  // Ctrl+K / ⌘K — også fra et annet tekstfelt. Fangstfasen på window, så
  // nettleserens egen Ctrl+K (søk i adresselinja) ikke tar den først.
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault(); e.stopPropagation();
      apneSok();
    }
  }, true);
  window.addEventListener("resize", () => lukkSok(false));
  // Esc i søkefeltet: lukk søket. På window i fangstfasen — ellers tar
  // varselboksen (document, fangst) Esc først når et varsel står fremme.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const inp = $("vsokInput");
    if (!inp || document.activeElement !== inp) return;
    e.preventDefault(); e.stopImmediatePropagation();
    lukkSok(true);
  }, true);
}
