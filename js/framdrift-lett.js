// 📅 Framdriftsplan — BYGGEPLASS-SIDEN (trinn 6). Montøren SER planen, han
// endrer den ikke: kontoret eier den (Emil 01.10, byggeplanen).
//
// Planen kommer i <fil>.markeringer.json (feltene `framdrift` og
// `framdriftKilder`, lagt der av Storm-Byggeplass-knappen på kontoret).
// markers.js kaller S.settFramdriftFraLett med feltene. Gamle filer har dem
// ikke — da er det ingen plan, og knappen Framdriftsplan blir ikke vist.
//
// Det som vises:
//   · glideren og tidslinja nederst (framdrift-vis.js — SAMME tegning som på
//     kontoret: elementene kommer opp trinn for trinn, bunkene brukes opp og
//     navnelappen teller ned)
//   · et lite panel: «Vis framdriften», og trinnene med datoer og innhold.
//     Trykk på et trinn: glideren går dit trinnet er ferdig.
// Ingen «Legg til», «Fjern», PDF eller video her.
import { $, S, apnePanel, esc, på } from "./state.js";
import { t, tn } from "./i18n.js";
import { sortert, synlige, tellingPerSlag, trinnTid, vaskEtappeListe, vaskKilder } from "./framdrift-regn.js";
import { begrensListe, forberedMobilPanel, framdriftPlanEndret, ryddFramdriftVis, settFramdriftTid, tegnFramdrift, tegnTidslinje } from "./framdrift-vis.js";

const erApen = () => { const p = $("framdriftPanel"); return !!(p && p.classList.contains("open")); };
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };
const ANTALL = {
  id: (n) => tn(n, "{0} element", "{0} elementer"),
  sw: (n) => tn(n, "{0} SW-element", "{0} SW-elementer"),
  tak: (n) => tn(n, "{0} takplate", "{0} takplater"),
  blikk: (n) => t("{0} blikk", n),
  mat: (n) => t("{0} materiell", n),
  rigg: (n) => t("{0} rigg", n),
  mark: (n) => tn(n, "{0} markering", "{0} markeringer")
};
export function innholdTekst(e) {
  const deler = tellingPerSlag(e).map(x => ANTALL[x.slag] ? ANTALL[x.slag](x.antall) : String(x.antall));
  return deler.length ? deler.join(" · ") : t("Ingenting lagt til ennå");
}
function datoTekst(e) {
  if (!e.dato) return t("Ingen dato");
  return datoLang(e.dato) + (e.slutt && e.slutt !== e.dato ? " – " + datoLang(e.slutt) : "");
}

function oppdaterKnapp() {
  const b = $("btnFramdrift");
  if (b) b.style.display = synlige(S.framdrift).length ? "" : "none";
}

function oppdaterVis() {
  const paa = erApen() && S.framdriftVis !== false;
  tegnFramdrift(paa);
  tegnTidslinje(paa);
}

export function tegnPanel() {
  const body = $("framdriftBody");
  if (!body) return;
  const liste = sortert(S.framdrift);
  let html = '<details class="set-hjelp fp-hjelp"><summary>' + esc(t("Slik bruker du framdriftsplanen")) + "</summary>" +
    esc(t("Planen er laget på kontoret. Dra glideren nederst for å se hva som er bygget når — trykk på et trinn for å gå dit det er ferdig.")) + "</details>";
  if (liste.length) html += '<label class="set-hjelp fp-vis"><input type="checkbox" id="fpVis"' + (S.framdriftVis !== false ? " checked" : "") + "> " +
    esc(t("Vis framdriften i modellen — dra glideren nederst")) + "</label>" +
    // 🌦 Sier fra hvorfor været mangler, i stedet for at det bare ikke vises
    (S.vaerStatus && S.vaerStatus() ? '<p class="hint fp-vaer-status">🌦 ' + esc(S.vaerStatus()) + "</p>" : "");
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen trinn ennå.")) + "</p>";
  html += '<div class="fp-liste" id="fpListe">';
  for (const e of liste) {
    html += '<div class="st-etappe st-lett fp-etappe" data-id="' + esc(e.id) + '" style="border-left:4px solid ' + esc(e.farge) + '">' +
      '<div class="st-rad"><b class="st-nr">' + e.nr + "</b> <b>" + esc(e.navn) + "</b></div>" +
      '<div class="st-rad fp-lett-rad"><span>' + esc(datoTekst(e)) + '</span><span class="st-innhold">' + esc(innholdTekst(e)) + "</span></div>" +
    "</div>";
  }
  html += "</div>";
  body.innerHTML = html;
  begrensListe($("fpListe"));
  if ($("fpVis")) $("fpVis").onchange = (ev) => { S.framdriftVis = ev.target.checked; oppdaterVis(); };
  body.querySelectorAll(".fp-etappe").forEach(rad => rad.onclick = () => {
    const e = synlige(S.framdrift).find(x => x.id === rad.dataset.id);
    const tt = e && trinnTid(e);
    if (!tt) return;
    if (S.framdriftVis === false) { S.framdriftVis = true; const c = $("fpVis"); if (c) c.checked = true; }
    tegnFramdrift(true);
    tegnTidslinje(true);
    settFramdriftTid(tt.b, true);
  });
  oppdaterVis();
}

// markers.js → feltene `framdrift` og `framdriftKilder` fra Workerens JSON
S.settFramdriftFraLett = (d, kilder) => {
  ryddFramdriftVis();
  S.framdrift = vaskEtappeListe(Array.isArray(d) ? d : []).filter(e => !e.slettet);
  S.framdriftKilder = vaskKilder(kilder);
  S.framdriftTid = null;
  framdriftPlanEndret();
  oppdaterKnapp();
  if (erApen()) tegnPanel();
};

på("btnFramdrift", "click", () => {
  const panel = $("framdriftPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); oppdaterVis(); return; }
  tegnPanel();
  apnePanel("framdriftPanel");
  forberedMobilPanel();   // 📱 mobil: åpner sammenlagt (oppsett B)
  oppdaterVis();
});

// Lukkes panelet av krysset eller et annet panel: glideren av, modellen hel
(() => {
  const p = $("framdriftPanel");
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!p || !MO) return;
  let varApen = p.classList.contains("open");
  new MO(() => {
    const naa = p.classList.contains("open");
    if (naa === varApen) return;
    varApen = naa;
    oppdaterVis();
  }).observe(p, { attributes: true, attributeFilter: ["class"] });
})();



// 🌦 Været hentet (eller feilet): oppdater meldingen om været i panelet
if (typeof document !== "undefined") document.addEventListener("storm-vaer", () => { if (erApen()) tegnPanel(); });
