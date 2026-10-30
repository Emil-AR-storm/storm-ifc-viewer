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
//   · 📋 sjekklista før støp (runde 9b, Emils valg 5C): basen huker av,
//     tar bilde og signerer med fingeren. Det er det ENESTE montøren kan
//     endre her — og bare som tillegg via innboksen (/hendelse og /kvitter),
//     som markeringene. Kontoret fletter det inn (siste tid vinner per punkt).
import { $, EKSTRA_LAG, S, apnePanel, esc, på } from "./state.js";
import { t } from "./i18n.js";
import { iDagISO } from "./frist.js";
import { CEMFLEX_OMLEGG_M, cemflexPlan, vannLengde, vannSummer, STATUS_TEKST, feltAreal, feltSummer, feltVolum, finnFelt, sortert, statusFor, synlige, vaskEtappeListe } from "./stopeplan-regn.js";
import { settVisEtappeplan, settVisVanntetting, stopeGroup, tegnStopeplan, visEtappeplan, visVanntetting } from "./stopeplan-vis.js";
import { antallElementer, antallFelt, datoKort, datoLang, tegnTidslinje } from "./stopeplan-tid.js";
import * as J from "./stopesjekk-regn.js";
import { innloggetNavn, sendHendelse } from "./markers.js";
import { erBildefil, komprimer, lastOpp } from "./bilder.js";
import { varsel } from "./varsel.js";

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
    esc(t("Vis etappeplan")) + '<span class="set-hjelp"> — ' + esc(t("farger betongen etter støpeplanen")) + "</span></label>" +
    '<label class="st-vis"><input type="checkbox" id="stVisVann"' + (visVanntetting() ? " checked" : "") + "> " + esc(t("Vis vanntetting")) + "</label>";
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
      '<div class="st-innhold">' + esc(antallElementer((e.elementer || []).length) + " · " + antallFelt((e.felt || []).length) +
        (fs.areal > 0 ? " (" + m2(fs.areal) + " · " + m3(fs.volum) + ")" : "")) + "</div>" +
      vannLinje(e) +
      sjekkLett(e) +
    "</div>";
  }
  body.innerHTML = html;
  koblSjekkLett(body);
  $("stVis").onchange = (ev) => { settVisEtappeplan(ev.target.checked); tegnTidslinje(erApen()); };
  $("stVisVann").onchange = (ev) => settVisVanntetting(ev.target.checked);
  // Trykk på en etappe: kameraet flyr dit (samme som søket)
  body.querySelectorAll(".st-etappe").forEach(rad => rad.onclick = () => {
    const lag = EKSTRA_LAG.find(l => l.id === "stopeplan");
    if (lag && lag.gaTil) lag.gaTil(rad.dataset.id);
  });
  tegnTidslinje(erApen());
}

// ═══════════ 📋 SJEKKLISTE FØR STØP PÅ TELEFONEN (runde 9b) ═══════════
// Hendelsene lagres lokalt (per modell) og legges over det kontoret sist
// publiserte, så avhukingen står igjen etter omlasting selv før kontoret har
// hentet innboksen. Sendingen går gjennom markeringenes kø (sendHendelse):
// uten nett ligger den på telefonen og sendes når nettet er tilbake.
const LOKAL_NOKKEL = "storm-bp-sjekk";
const LOKAL_DAGER = 21;
const apneSjekk = new Set();
let publisert = [];          // planen slik kontoret sist publiserte den
function lesLokale() {
  try { const o = JSON.parse(localStorage.getItem(LOKAL_NOKKEL) || "{}"); return o && typeof o === "object" ? o : {}; }
  catch (_) { return {}; }
}
function lokaleFor() { const a = lesLokale()[S.fileName || ""]; return Array.isArray(a) ? a : []; }
function huskLokal(h) {
  const alle = lesLokale();
  const grense = new Date(Date.now() - LOKAL_DAGER * 864e5).toISOString();
  const tidFor = (x) => String(x.tid || (x.signert && x.signert.tid) || "");
  alle[S.fileName || ""] = lokaleFor().filter(x => tidFor(x) >= grense).concat([h]).slice(-300);
  try { localStorage.setItem(LOKAL_NOKKEL, JSON.stringify(alle)); } catch (_) {}
}
function brukLokale() {
  S.stopeplan = vaskEtappeListe(J.leggPaaLokale(publisert, lokaleFor()));
}

function sjekkLett(e) {
  if (e.status === "stopt" && !e.sjekk) return "";
  const st = J.sjekkStatus(e.sjekk);
  const apen = apneSjekk.has(e.id);
  const farge = st.kanKlar ? "var(--ok)" : st.ok ? "var(--warn)" : "var(--danger)";
  let h = '<div class="sj-boks sj-lett" data-sj-etappe="' + esc(e.id) + '">' +
    '<div class="st-rad sj-topp"><span>📋 ' + esc(t("Sjekkliste før støp")) + "</span>" +
    (e.sjekk ? '<span class="fdv-pill" style="background:' + farge + ";color:" + (st.ok && !st.kanKlar ? "#111" : "#fff") + '">' + st.ok + "/" + st.totalt + "</span>" : "") +
    (e.klar ? '<span class="sj-klar">✅ ' + esc(t("Klar til støp")) + "</span>" : "") + "</div>";
  if (e.sjekk) {
    h += '<div class="sj-bar"><i style="width:' + (st.totalt ? Math.round(st.ok / st.totalt * 100) : 0) + "%;background:" + farge + '"></i></div>' +
      '<div class="st-rad st-knapper"><button class="sj-apne">' + esc(apen ? t("Lukk sjekklista") : t("Åpne sjekklista")) + "</button></div>";
  } else if (e.status !== "stopt") {
    h += '<div class="st-rad st-knapper"><button class="sj-start">' + esc(t("Start sjekkliste")) + "</button></div>";
  }
  if (e.sjekk && apen) {
    const laast = e.status === "stopt";
    h += '<div class="sj-liste">' + e.sjekk.punkter.map(p => {
      const a = e.sjekk.svar[p.id];
      return '<div class="sj-punkt sj-punkt-lett"><label><input type="checkbox" data-sj-punkt="' + esc(p.id) + '"' + (a && a.ok ? " checked" : "") + (laast ? " disabled" : "") + "> <span>" + esc(t(p.tekst)) +
        (a && a.ok ? "<small>" + esc([a.av, J.kortTid(a.tid), a.bilde ? "📷" : ""].filter(Boolean).join(" · ")) + "</small>" : "") + "</span></label>" +
        (laast ? "" : '<button class="sj-foto" data-sj-foto="' + esc(p.id) + '" title="' + esc(t("Ta bilde")) + '">📷</button>') + "</div>";
    }).join("") + "</div>" +
    (e.sjekk.signert ? '<p class="set-hjelp">✍ ' + esc(t("Signert av {0}, {1}", e.sjekk.signert.av, J.kortTid(e.sjekk.signert.tid))) + "</p>" : "") +
    (!laast && st.ferdig && !st.signert ? '<div class="st-rad st-knapper"><button class="sj-signer primary">✍ ' + esc(t("Signer")) + "</button></div>" : "") +
    (!st.ferdig ? '<p class="set-hjelp">' + esc(t("Signering blir mulig når alle punktene er huket av.")) + "</p>" : "") +
    '<input type="file" class="sj-fil" accept="image/*" capture="environment" hidden>';
  }
  return h + "</div>";
}

// Én endring: lokalt først (vises med en gang), så til kontoret.
function sendSjekk(e, felt) {
  const etter = J.flettHendelse(e.sjekk, felt);
  const h = J.lagHendelse(e, felt, etter);
  huskLokal(h);
  brukLokale();
  tegnPanel();
  sendHendelse(h);
}

function koblSjekkLett(body) {
  body.querySelectorAll(".sj-lett").forEach(boks => {
    boks.onclick = (ev) => ev.stopPropagation();   // ikke fly kameraet når du huker av
    const e = synlige(S.stopeplan).find(x => x.id === boks.dataset.sjEtappe);
    if (!e) return;
    const q = (s) => boks.querySelector(s);
    if (q(".sj-start")) q(".sj-start").onclick = () => {
      apneSjekk.add(e.id);
      sendSjekk(e, { punkter: J.STD_PUNKTER, tid: new Date().toISOString(), av: innloggetNavn() });
    };
    if (q(".sj-apne")) q(".sj-apne").onclick = () => { if (apneSjekk.has(e.id)) apneSjekk.delete(e.id); else apneSjekk.add(e.id); tegnPanel(); };
    boks.querySelectorAll("[data-sj-punkt]").forEach(c => c.onchange = () =>
      sendSjekk(e, { punkt: c.dataset.sjPunkt, ok: c.checked, av: innloggetNavn(), tid: new Date().toISOString() }));
    const fil = q(".sj-fil");
    boks.querySelectorAll("[data-sj-foto]").forEach(b => b.onclick = () => {
      if (!fil) return;
      fil.dataset.punkt = b.dataset.sjFoto;
      fil.value = "";
      fil.click();
    });
    if (fil) fil.onchange = async () => {
      const f = fil.files && fil.files[0];
      const punkt = fil.dataset.punkt;
      if (!f || !punkt || !erBildefil(f)) return;
      const av = innloggetNavn();
      const navn = J.sjekkBildeNavn(e.id, punkt);
      try {
        const r = await lastOpp(await komprimer(f), navn, av);
        varsel(r.koet ? t("Bildet er lagret på telefonen og sendes når du har nett igjen.") : t("Bildet er sendt til prosjektlederen."));
      } catch (err) { varsel(t("Fikk ikke sendt bildet: {0}", err.message)); return; }
      // Et bilde av punktet huker det også av
      sendSjekk(e, { punkt, ok: true, av, tid: new Date().toISOString(), bilde: navn });
    };
    if (q(".sj-signer")) q(".sj-signer").onclick = async () => {
      const { bePåSignatur } = await import("./sjekkliste.js");
      const s = await bePåSignatur(innloggetNavn());
      if (!s || !String(s.navn || "").trim()) return;
      sendSjekk(e, { signert: { av: String(s.navn).trim().slice(0, 60), tid: new Date().toISOString(), signatur: s.signatur || "" } });
    };
  });
}

// 💧 Løpemeterne per etappe (trinn 6). Platelengden kommer ikke med ut —
// montøren bruker standarden (2 m, CEMflex VB 150).
const lm = (v) => (Math.round(v * 10) / 10).toLocaleString("no-NO") + " lm";
function vannLinje(e) {
  const v = vannSummer(e, 2);
  if (!v.injeksjon.lm && !v.cemflex.lm) return "";
  return '<div class="st-innhold">' + esc([
    v.injeksjon.lm ? t("Injeksjonsslange") + " " + lm(v.injeksjon.lm) : "",
    v.cemflex.lm ? t("Cemflex-plater") + " " + lm(v.cemflex.lmMedOmlegg) + " (" + t("{0} plater", v.cemflex.plater) + ")" : ""
  ].filter(Boolean).join(" · ")) + "</div>";
}
function visVann(vannId) {
  for (const e of synlige(S.stopeplan)) for (const v of e.vanntetting || []) if (v.id === vannId) {
    const L = vannLengde(v);
    const rad = (k, val) => '<div class="prop-row"><div class="k">' + esc(k) + '</div><div class="v">' + esc(String(val)) + "</div></div>";
    const erC = v.type === "cemflex";
    const p = erC ? cemflexPlan(L, v.lukket, 2, CEMFLEX_OMLEGG_M) : null;
    $("propTitle").textContent = erC ? t("Cemflex-plater") : t("Injeksjonsslange");
    $("propBody").innerHTML =
      rad(t("Etappe"), e.nr + " · " + e.navn) +
      rad(t("Lengde"), lm(L) + (v.lukket ? " · " + t("hele omkretsen") : "")) +
      (erC ? rad(t("Med omlegg"), lm(p.lmMedOmlegg)) + rad(t("Plater"), t("{0} plater à {1} m, {2} skjøter à 5 cm", p.plater, "2", p.skjoter)) : "") +
      rad(t("Plassering"), t("Langs kanten av betongen, inne i armeringen"));
    const pp = $("propPanel");
    if (pp) pp.dataset.navn = $("propTitle").textContent;
    apnePanel("propPanel");
    return;
  }
}

// ---------- 📋 Trykk på et felt: etappen i infovinduet ----------
export function visFelt(feltId) {
  if (String(feltId).startsWith("vann:")) { visVann(String(feltId).slice(5)); return; }
  const v = finnFelt(S.stopeplan, feltId);
  if (!v || !$("propTitle")) return;
  const e = v.etappe, f = v.felt;
  const st = statusFor(e, iDagISO());
  const rad = (k, val) => '<div class="prop-row"><div class="k">' + esc(k) + '</div><div class="v">' + esc(String(val)) + "</div></div>";
  $("propTitle").textContent = t("Etappe {0}", e.nr) + " · " + e.navn;
  $("propBody").innerHTML =
    rad(t("Dato"), e.dato ? datoLang(e.dato) : t("Ingen dato")) +
    rad(t("Status"), st === "stopt" && e.stoptDato ? t("Støpt {0}", datoLang(e.stoptDato)) : t(STATUS_TEKST[st])) +
    rad(t("Areal"), m2(feltAreal(f))) +
    rad(t("Volum"), m3(feltVolum(f))) +
    rad(t("Tykkelse"), Math.round(f.tykkelseM * 1000) + " mm");
  const p = $("propPanel");
  if (p) p.dataset.navn = $("propTitle").textContent;
  apnePanel("propPanel");
}

S.stopeVisFelt = visFelt;

// markers.js → feltet `stopeplan` fra Workerens JSON
S.settStopeplanFraLett = (d) => {
  publisert = vaskEtappeListe(Array.isArray(d) ? d : []);
  brukLokale();          // 📋 egne avhukinger som kontoret ikke har hentet ennå
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
