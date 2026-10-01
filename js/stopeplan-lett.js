// 🧱 Støpeplan i 3D — BYGGEPLASS-SIDEN (trinn 5). Montøren SER planen, han
// endrer den ikke: kontoret eier den (Emil 30.09, byggeplanen).
//
// Planen kommer i <fil>.markeringer.json (feltet `stopeplan`, lagt der av
// Storm-Byggeplass-knappen på kontoret). markers.js kaller
// S.settStopeplanFraLett med feltet. Gamle filer har det ikke — da er det
// ingen plan, og knappen Støpeplan blir ikke vist.
//
// Det som vises:
//   · betongen farget etter etappe og status (stopeplan-vis.js — SAMME
//     tegning som på kontoret, også genererte gulv og ringmur via sw-lett.js)
//   · et lite panel: «Vis etappeplan», og etappene med dato og status
//   · tidslinjen nederst (stopeplan-tid.js — den samme som på kontoret)
//   · trykk på et felt: etappe, dato, status, areal og volum i infovinduet
import { $, EKSTRA_LAG, S, apnePanel, esc, på } from "./state.js";
import { t } from "./i18n.js";
import { iDagISO } from "./frist.js";
import { STATUS_TEKST, feltAreal, feltSummer, feltVolum, finnFelt, sortert, statusFor, synlige, vaskEtappeListe } from "./stopeplan-regn.js";
import { settVisEtappeplan, stopeGroup, tegnStopeplan, visEtappeplan } from "./stopeplan-vis.js";
import { datoKort, datoLang, tegnTidslinje } from "./stopeplan-tid.js";

const erApen = () => { const p = $("stopePanel"); return !!(p && p.classList.contains("open")); };
const m2 = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " m²";
const m3 = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " m³";
const STATUS_FARGE = { stopt: "var(--ok)", uke: "var(--warn)", forsinket: "var(--danger)", planlagt: "var(--muted)" };

function oppdaterKnapp() {
  const b = $("btnStopeplan");
  if (b) b.style.display = synlige(S.stopeplan).length ? "" : "none";
}

export function tegnPanel() {
  const body = $("stopeBody");
  if (!body) return;
  const iDag = iDagISO();
  let html = '<label class="st-vis"><input type="checkbox" id="stVis"' + (visEtappeplan() ? " checked" : "") + "> " +
    esc(t("Vis etappeplan")) + '<span class="set-hjelp"> — ' + esc(t("farger betongen etter støpeplanen")) + "</span></label>";
  const liste = sortert(S.stopeplan);
  if (!liste.length) html += '<p class="hint">' + esc(t("Ingen etapper ennå.")) + "</p>";
  for (const e of liste) {
    const st = statusFor(e, iDag);
    const fs = feltSummer(e);
    html += '<div class="st-etappe st-lett" data-id="' + esc(e.id) + '" style="border-left:4px solid ' + esc(e.farge) + '">' +
      '<div class="st-rad"><b class="st-nr">' + e.nr + "</b> <b>" + esc(e.navn) + "</b></div>" +
      '<div class="st-rad">' + (e.dato ? esc(datoLang(e.dato)) : esc(t("Ingen dato"))) +
        ' <span class="st-merke" style="color:' + STATUS_FARGE[st] + '">' +
        esc(st === "stopt" && e.stoptDato ? t("Støpt {0}", datoKort(e.stoptDato)) : t(STATUS_TEKST[st])) + "</span></div>" +
      '<div class="st-innhold">' + esc(t("{0} elementer", (e.elementer || []).length) + " · " + t("{0} felt", (e.felt || []).length) +
        (fs.areal > 0 ? " (" + t("ca {0}", m2(fs.areal)) + " · " + t("ca {0}", m3(fs.volum)) + ")" : "")) + "</div>" +
    "</div>";
  }
  body.innerHTML = html;
  $("stVis").onchange = (ev) => { settVisEtappeplan(ev.target.checked); tegnTidslinje(erApen()); };
  // Trykk på en etappe: kameraet flyr dit (samme som søket)
  body.querySelectorAll(".st-etappe").forEach(rad => rad.onclick = () => {
    const lag = EKSTRA_LAG.find(l => l.id === "stopeplan");
    if (lag && lag.gaTil) lag.gaTil(rad.dataset.id);
  });
  tegnTidslinje(erApen());
}

// ---------- 📋 Trykk på et felt: etappen i infovinduet ----------
export function visFelt(feltId) {
  const v = finnFelt(S.stopeplan, feltId);
  if (!v || !$("propTitle")) return;
  const e = v.etappe, f = v.felt;
  const st = statusFor(e, iDagISO());
  const rad = (k, val) => '<div class="prop-row"><div class="k">' + esc(k) + '</div><div class="v">' + esc(String(val)) + "</div></div>";
  $("propTitle").textContent = t("Etappe {0}", e.nr) + " · " + e.navn;
  $("propBody").innerHTML =
    rad(t("Dato"), e.dato ? datoLang(e.dato) : t("Ingen dato")) +
    rad(t("Status"), st === "stopt" && e.stoptDato ? t("Støpt {0}", datoLang(e.stoptDato)) : t(STATUS_TEKST[st])) +
    rad(t("Areal (ca)"), m2(feltAreal(f))) +
    rad(t("Volum (ca)"), m3(feltVolum(f))) +
    rad(t("Tykkelse"), Math.round(f.tykkelseM * 1000) + " mm");
  const p = $("propPanel");
  if (p) p.dataset.navn = $("propTitle").textContent;
  apnePanel("propPanel");
}

S.stopeVisFelt = visFelt;

// markers.js → feltet `stopeplan` fra Workerens JSON
S.settStopeplanFraLett = (d) => {
  S.stopeplan = vaskEtappeListe(Array.isArray(d) ? d : []);
  S.stopeVistPer = null;
  tegnStopeplan();
  oppdaterKnapp();
  if (erApen()) tegnPanel(); else tegnTidslinje(false);
};

på("btnStopeplan", "click", () => {
  const panel = $("stopePanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); tegnTidslinje(false); return; }
  tegnPanel();
  apnePanel("stopePanel");
  tegnTidslinje(true);
});

// Panelet lukkes også av krysset eller et annet panel: da skal tidslinjen
// bort og modellen tilbake til i dag.
(() => {
  const p = $("stopePanel");
  const MO = (typeof window !== "undefined" && window.MutationObserver) || null;
  if (!p || !MO) return;
  new MO(() => tegnTidslinje(p.classList.contains("open"))).observe(p, { attributes: true, attributeFilter: ["class"] });
})();

export { stopeGroup };
