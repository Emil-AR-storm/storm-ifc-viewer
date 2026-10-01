// 🧱 Støpeplan i 3D — TIDSLINJEN (trinn 4), delt mellom kontoret
// (stopeplan.js) og byggeplass-siden (stopeplan-lett.js). Én stolpe per
// etappe på datoen, en glider for «Vist per» og «I dag». Bakover viser
// modellen hva som faktisk var støpt, framover hva som SKAL være støpt.
import { $, S, esc } from "./state.js";
import { t } from "./i18n.js";
import { iDagISO } from "./frist.js";
import { STATUS_TEKST, dagerMellom, mandag, plussDager, sortert, statusPer, tidslinjeSpenn } from "./stopeplan-regn.js";
import { tegnStopeplan, visEtappeplan } from "./stopeplan-vis.js";

export const datoKort = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] : iso; };
export const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : iso; };

// Tidslinjen nederst: én stolpe per etappe på datoen, en glider for «Vist
// per» og «I dag». Vises når panelet er åpent, fargingen er på og minst én
// etappe har en dato. Dras glideren, viser modellen planen den dagen:
// bakover hva som faktisk var støpt, framover hva som SKAL være støpt.
export function settVistPer(dato, apen) {
  const iDag = iDagISO();
  S.stopeVistPer = dato && dato !== iDag ? dato : null;
  tegnStopeplan();
  tegnTidslinje(apen);
}

function tidEl() {
  let el = $("stTidslinje");
  if (!el) {
    el = document.createElement("div");
    el.id = "stTidslinje";
    el.className = "st-tid";
    document.body.appendChild(el);
  }
  return el;
}

// `apen`: om panelet som eier tidslinjen er åpent (kontor eller byggeplass).
let sistApen = false;
export function tegnTidslinje(apen) {
  if (apen !== undefined) sistApen = !!apen;
  const el = tidEl();
  const iDag = iDagISO();
  const spenn = tidslinjeSpenn(S.stopeplan, iDag);
  const vis = sistApen && visEtappeplan() && !!spenn;
  document.body.classList.toggle("st-tid-paa", vis);
  if (!vis) {
    el.style.display = "none"; el.innerHTML = "";
    if (S.stopeVistPer) { S.stopeVistPer = null; tegnStopeplan(); }
    return;
  }
  const n = Math.max(1, dagerMellom(spenn.fra, spenn.til));
  const per = S.stopeVistPer || iDag;
  const pos = (d) => Math.max(0, Math.min(100, dagerMellom(spenn.fra, d) / n * 100));
  let stolper = "";
  for (const e of sortert(S.stopeplan)) {
    const d = e.stoptDato || e.dato;
    if (!d) continue;
    const st = statusPer(e, per, iDag);
    stolper += '<button class="st-stolpe ' + st + '" data-dato="' + esc(d) + '" style="left:' + pos(d).toFixed(2) + "%;--f:" + esc(e.farge) + '" title="' +
      esc(e.nr + " " + e.navn + " · " + datoLang(d) + " · " + t(STATUS_TEKST[st])) + '"><span>' + e.nr + "</span></button>";
  }
  // Akse: én merkelapp per mandag (eller hver 4. uke når spennet er langt)
  let akse = "";
  const uker = Math.ceil(n / 7), steg = uker > 16 ? 4 : uker > 8 ? 2 : 1;
  for (let d = mandagEtter(spenn.fra), k = 0; d <= spenn.til; d = plussDager(d, 7), k++) {
    if (k % steg) continue;
    akse += '<span style="left:' + pos(d).toFixed(2) + '%">' + esc(datoKort(d)) + "</span>";
  }
  el.style.display = "block";
  el.innerHTML =
    '<div class="st-tid-topp"><span>' + esc(t("Vist per")) + " <b>" + esc(datoLang(per)) + "</b>" +
      (per !== iDag ? ' <span class="st-tid-merk">' + esc(per < iDag ? t("— slik det var") : t("— slik det skal bli")) + "</span>" : "") +
      '</span><button id="stTidIdag"' + (per === iDag ? " disabled" : "") + ">" + esc(t("I dag")) + "</button></div>" +
    '<div class="st-tid-bane">' +
      '<span class="st-tid-idag" style="left:' + pos(iDag).toFixed(2) + '%" title="' + esc(t("I dag")) + '"></span>' +
      stolper +
      '<input type="range" id="stTidGlider" min="0" max="' + n + '" step="1" value="' + dagerMellom(spenn.fra, per) + '" aria-label="' + esc(t("Vist per")) + '">' +
    "</div>" +
    '<div class="st-tid-akse">' + akse + "</div>";
  $("stTidIdag").onclick = () => settVistPer(null, sistApen);
  const g = $("stTidGlider");
  g.oninput = () => {
    S.stopeVistPer = plussDager(spenn.fra, Number(g.value));
    if (S.stopeVistPer === iDag) S.stopeVistPer = null;
    tegnStopeplan();
    const b = el.querySelector(".st-tid-topp b");
    if (b) b.textContent = datoLang(S.stopeVistPer || iDag);
  };
  g.onchange = () => tegnTidslinje(sistApen);
  el.querySelectorAll(".st-stolpe").forEach(b => b.onclick = () => settVistPer(b.dataset.dato, sistApen));
}
function mandagEtter(iso) {
  const m = mandag(iso);
  return m < iso ? plussDager(m, 7) : m;
}

