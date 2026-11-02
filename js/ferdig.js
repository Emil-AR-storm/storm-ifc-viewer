// 📊 FRAMDRIFTSRAPPORT — KONTORET (runde 10a, Emils valg B 02.11.2026).
//
// Fanen «📊 Rapport» i Framdriftsplan-panelet:
//   · ferdigmelding: velg i 3D (elementer, SW-elementer, takplater, blikk) →
//     «✅ Ferdigmeld valgte». «Ikke ferdig» tar det tilbake (ny post, ikke
//     sletting — hvem som rettet står igjen).
//   · totalen og én linje per elementtype, med en hvit strek der
//     Framdriftsplan sier vi skal være i dag, avvik og ≈ arbeidsdager bak.
//   · S-kurven: planen mot det som faktisk er ferdigmeldt.
//   · modellen farget: grønn ferdig · gul pågår · rød forsinket · grå ikke startet.
//   · fire nedlastinger: INTERN PDF + Excel (plan mot faktisk, alt) og STATUS
//     PDF + Excel (bare % ferdig per type — til mottaker, Emil: «alt det andre
//     bare kommer i veien som støy»).
//
// Lagring som resten av Framdriftsplan: lokalt først, så SharePoint
// (Framdriftsplan/<modell>.ferdig.json), flettet på id med nyeste `endret`.
// Regningen står i ferdig-regn.js. Byggeplassen (10b) melder via innboksen.
import * as THREE from "three";
import { $, S, esc, ikon } from "./state.js";
import { scene } from "./scene.js";
import { t, tn } from "./i18n.js";
import { varsel } from "./varsel.js";
import { flettPaaId, spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { idFor, nokkel, slagFor, synlige } from "./framdrift-regn.js";
import * as F from "./ferdig-regn.js";

const SP_MAPPE = "Framdriftsplan";
let spStatus = "av", lagreTid = 0, endringNr = 0;
S.ferdig = S.ferdig || [];
const lsNokkel = () => "storm-ifc-ferdig::" + S.fileName;
const spFil = () => S.fileName + ".ferdig.json";
function mittNavn() {
  try { const acc = S.msalApp && S.msalApp.getActiveAccount(); return (acc && (acc.name || acc.username)) || ""; }
  catch (_) { return ""; }
}
function lesLokalt() { try { return F.vaskMeldinger(JSON.parse(localStorage.getItem(lsNokkel()) || "[]")); } catch (_) { return []; } }
function lagreLokalt() { try { localStorage.setItem(lsNokkel(), JSON.stringify(F.vaskMeldinger(S.ferdig))); } catch (_) {} }
function lagre() {
  endringNr++;
  lagreLokalt();
  clearTimeout(lagreTid);
  lagreTid = setTimeout(skrivSp, 600);
}
async function skrivSp() {
  if (!spPaalogget()) { spStatus = "av"; return; }
  const forFil = S.fileName, sendtNr = endringNr;
  const res = await spSkriv(SP_MAPPE, spFil(), F.vaskMeldinger(S.ferdig), (m) => String(m && m.id || ""));
  if (S.fileName !== forFil) return;
  spStatus = res.ok ? "ok" : "feil";
  if (res.ok && res.liste) {
    S.ferdig = F.vaskMeldinger(flettPaaId(F.vaskMeldinger(S.ferdig), F.vaskMeldinger(res.liste)));
    lagreLokalt();
    if (endringNr !== sendtNr) { clearTimeout(lagreTid); lagreTid = setTimeout(skrivSp, 600); }
  }
  oppdater();
}
async function hentFraSp() {
  if (!spPaalogget()) { spStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(SP_MAPPE, spFil());
  if (S.fileName !== forFil) return;
  spStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (spStatus === "ok") {
    S.ferdig = F.vaskMeldinger(flettPaaId(F.vaskMeldinger(S.ferdig), F.vaskMeldinger(res.liste)));
    lagreLokalt();
  }
  oppdater();
}

// ═══════════ HVA SOM TELLES ═══════════
// Modellens bygningsdeler (IFC) + genererte SW-elementer, takplater og blikk
// som ligger i et trinn eller er ferdigmeldt.
let universBuffer = null, universNokkel = "";
export async function univers() {
  const n = (S.fileName || "") + "|" + (S.modelGroup ? S.modelGroup.uuid : "");
  const ut = [];
  if (!universBuffer || universNokkel !== n) {
    const ifc = [];
    if (S.modelGroup) {
      const ider = new Set();
      for (const m of S.modelGroup.children) {
        if (m.userData.merged) { for (const r of m.userData.ranges || []) ider.add(r.id); }
        else if (m.userData.expressID !== undefined) ider.add(m.userData.expressID);
      }
      try { await sikreMeta(() => ider); } catch (_) {}
      for (const id of ider) {
        const me = metaFor(id) || {};
        if (F.ikkeTell(me.typeName)) continue;
        ifc.push({ k: nokkel("id", id), gid: me.globalId || "", gruppe: F.gruppeFor(me.typeName), navn: me.name || me.objectType || "" });
      }
    }
    universBuffer = ifc; universNokkel = n;
  }
  ut.push(...universBuffer);
  const sett = new Set();
  const leggTil = (k) => {
    const s = slagFor(k);
    if (!F.SLAG_GRUPPE[s] || sett.has(k)) return;
    sett.add(k); ut.push({ k, gruppe: F.SLAG_GRUPPE[s], navn: idFor(k) });
  };
  for (const e of synlige(S.framdrift)) for (const o of e.objekter) leggTil(o.k);
  for (const m of F.vaskMeldinger(S.ferdig)) leggTil(m.k);
  return ut;
}
S.ferdigTomBuffer = () => { universBuffer = null; };

// ═══════════ FERDIGMELDING ═══════════
function valgte() {
  const raa = S.framdriftValgteRaa ? S.framdriftValgteRaa() : [];
  return raa.filter(o => F.KAN_MELDES.includes(slagFor(o.k)));
}
export function meld(ferdig) {
  const v = valgte();
  if (!v.length) { varsel(t("Velg elementer i modellen først (trykk, eller shift + dra for mange).")); return 0; }
  const naa = new Date().toISOString(), av = mittNavn();
  const foer = F.vaskMeldinger(S.ferdig);
  const nye = v.map(o => {
    const gid = o.gid || (slagFor(o.k) === "id" ? ((metaFor(Number(idFor(o.k))) || {}).globalId || "") : "");
    return F.nyMelding(o.k, gid, ferdig, av, naa, "kontor");
  });
  S.ferdig = F.flettMeldinger(S.ferdig, nye);
  lagre();
  if (S.pushAngre) {
    const etter = F.vaskMeldinger(S.ferdig);
    const sett = (liste) => {
      // Angre gir ferske tidsstempler, så angringen vinner flettingen i SharePoint
      const t2 = new Date().toISOString();
      const ny = new Map(liste.map(m => [m.id, m]));
      const ut = [];
      for (const m of F.vaskMeldinger(S.ferdig)) {
        const mal = ny.get(m.id);
        ut.push(mal ? Object.assign({}, mal, { endret: t2 }) : Object.assign({}, m, { ferdig: false, endret: t2 }));
        ny.delete(m.id);
      }
      for (const m of ny.values()) ut.push(Object.assign({}, m, { endret: t2 }));
      S.ferdig = F.vaskMeldinger(ut); lagre(); oppdater();
    };
    S.pushAngre({ tekst: ferdig ? "Ferdigmeldt" : "Ikke ferdig", angre: () => sett(foer), gjenopprett: () => sett(etter) });
  }
  varsel(ferdig ? tn(nye.length, "{0} objekt ferdigmeldt.", "{0} objekter ferdigmeldt.") : tn(nye.length, "{0} objekt satt til ikke ferdig.", "{0} objekter satt til ikke ferdig."));
  oppdater();
  return nye.length;
}
// 10b: meldinger fra byggeplassen (byggeplass.js hentInnboks) — siste tid vinner
S.ferdigFlett = (meldinger) => {
  const nye = F.vaskMeldinger((meldinger || []).map(m => Object.assign({}, m, { kilde: "bygg" })));
  if (!nye.length) return 0;
  S.ferdig = F.flettMeldinger(S.ferdig, nye);
  lagre(); oppdater();
  return nye.length;
};

// ═══════════ PANELET (fanen «📊 Rapport») ═══════════
let sisteRapport = null, malerRunde = 0, farger = true;
const STATUS_FARGE = { gronn: "var(--ok)", gul: "var(--warn)", rod: "var(--danger)", gra: "var(--muted)" };
const p1 = (x) => (Math.round(x * 10) / 10).toLocaleString("no-NO");
const iDagISO = () => { const d = new Date(); const to = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + to(d.getMonth() + 1) + "-" + to(d.getDate()); };

export async function beregn() {
  sisteRapport = F.rapport(await univers(), S.ferdig, S.framdrift, iDagISO());
  return sisteRapport;
}

function bar(pst, farge, plan) {
  return '<div class="fr-bar"><i style="width:' + Math.max(0, Math.min(100, pst)) + "%;background:" + farge + '"></i>' +
    (plan != null ? '<u style="left:' + Math.max(0, Math.min(100, plan)) + '%"></u>' : "") + "</div>";
}
function kurveSvg(r) {
  const k = r.kurve;
  if (!k.plan.length) return "";
  const B = 360, H = 110, a = k.a, b = Math.max(k.b, a + 1);
  const x = (d) => 8 + (d - a) / (b - a) * (B - 16), y = (p) => H - 8 - p / 100 * (H - 22);
  const linje = (pts) => pts.map(p => x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ");
  const dag = Date.UTC(...r.iDag.split("-").map((v, i) => i === 1 ? v - 1 : +v)) / 86400000;
  const xd = x(Math.min(b, Math.max(a, dag)));
  return '<svg class="fr-kurve" viewBox="0 0 ' + B + " " + H + '" width="100%"><text x="4" y="11" class="fr-kt">' + esc(t("S-kurve: plan (stiplet) mot ferdigmeldt")) + "</text>" +
    '<polyline points="' + linje(k.plan) + '" fill="none" stroke="var(--muted)" stroke-dasharray="4 3" stroke-width="2"/>' +
    '<polyline points="' + linje(k.faktisk) + '" fill="none" stroke="' + STATUS_FARGE[r.plan.status === "gra" ? "gronn" : r.plan.status] + '" stroke-width="3"/>' +
    '<line x1="' + xd + '" y1="14" x2="' + xd + '" y2="' + (H - 4) + '" stroke="var(--text)" stroke-width="1"/>' +
    '<text x="' + (xd + 3) + '" y="24" class="fr-kt">' + esc(t("i dag")) + "</text></svg>";
}
function bakTekst(r) {
  const d = r.plan.dagerBak;
  if (!r.plan.n) return t("Ingen objekter ligger i et trinn med dato ennå — sett Fra–Til i Plan-fanen for å få planen.");
  if (r.plan.avvik >= F.GRENSE.gul) return t("{0} %-poeng bak plan", p1(r.plan.avvik)) + (d > 0 ? " ≈ " + tn(d, "{0} arbeidsdag", "{0} arbeidsdager") : "");
  if (r.plan.avvik <= -F.GRENSE.gul) return t("{0} %-poeng foran plan", p1(-r.plan.avvik)) + (d < 0 ? " ≈ " + tn(-d, "{0} arbeidsdag", "{0} arbeidsdager") : "");
  return t("I rute");
}

export async function tegnRapport(el) {
  if (!el) return;
  const runde = ++malerRunde;
  el.innerHTML = '<p class="hint">' + esc(t("Regner …")) + "</p>";
  const r = await beregn();
  if (runde !== malerRunde || !el.isConnected) return;
  const nValgt = valgte().length;
  const st = r.plan.status;
  let h = '<div class="fr-tot"><div class="fr-totrad"><div><div class="set-hjelp">' + esc(t("TOTALT PROSJEKTET")) + '</div><div class="fr-stor">' + p1(r.pst) + " %</div></div>" +
    (r.plan.n ? '<div style="text-align:right"><div class="set-hjelp">' + esc(t("PLAN I DAG")) + '</div><div class="fr-stor fr-plan">' + p1(r.plan.pst) + " %</div></div>" : "") + "</div>" +
    bar(r.plan.n ? r.plan.faktiskPst : r.pst, STATUS_FARGE[st === "gra" ? "gronn" : st], r.plan.n ? r.plan.pst : null) +
    '<div class="set-hjelp">' + esc(t("{0} av {1} ferdigmeldt", r.ferdig, r.n)) +
      (r.plan.n && r.uten.n ? " · " + esc(t("i planen: {0} % ferdig", p1(r.plan.faktiskPst))) : "") + "</div>" +
    '<span class="fr-pill" style="background:' + STATUS_FARGE[st] + '">' + esc(bakTekst(r)) + "</span></div>";
  for (const x of r.typer) {
    h += '<div class="fr-rad"><div class="fr-t"><span>' + esc(t(x.gruppe)) + "</span><span><b>" + p1(x.pst) + ' %</b> <span class="set-hjelp">' + x.ferdig + "/" + x.n + "</span></span></div>" +
      // Streken og planstreken på samme grunnlag: bare det som ligger i et trinn
      bar(x.planN ? x.faktiskPlanPst : x.pst, STATUS_FARGE[x.status === "gra" ? (x.ferdig ? "gronn" : "gra") : x.status], x.planN ? x.planPst : null) + "</div>";
  }
  if (r.uten.n && r.plan.n) h += '<p class="set-hjelp">' + esc(t("{0} objekter ligger ikke i noe trinn ({1} ferdig) — de er med i totalen, men har ingen plan.", r.uten.n, r.uten.ferdig)) + "</p>";
  h += '<div class="fr-leg"><span style="--c:var(--ok)">' + esc(t("I rute / ferdig")) + '</span><span style="--c:var(--warn)">' + esc(t("Litt bak / pågår")) + "</span>" +
    '<span style="--c:var(--danger)">' + esc(t("Forsinket")) + '</span><span style="--c:var(--text)">' + esc(t("Plan i dag")) + "</span></div>";
  h += kurveSvg(r);
  if (r.forsinket.length) h += '<p class="set-hjelp" style="color:var(--danger)">' + esc(tn(r.forsinket.length, "{0} objekt skulle vært ferdig etter planen.", "{0} objekter skulle vært ferdig etter planen.")) + "</p>";
  const vm = velgerAktiv();
  h += '<div class="prop-actions fr-knapper"><button id="frMeld" class="primary"' + (vm ? " disabled" : "") + ">✅ " + esc(vm ? t("Velger … ({0})", nValgt) : t("Ferdigmeld")) + "</button>" +
    '<button id="frIkke"' + (vm ? " disabled" : "") + ">" + esc(t("Ikke ferdig")) + "</button></div>" +
    '<label class="set-hjelp fp-vis"><input type="checkbox" id="frFarg"' + (farger ? " checked" : "") + "> " + esc(t("Farg modellen etter framdrift")) + "</label>" +
    '<div class="fr-last"><div class="set-hjelp"><b>' + esc(t("Intern (plan mot faktisk)")) + "</b> — " + esc(t("alt: typer, trinn, forsinkede og hvert objekt")) + "</div>" +
    '<div class="prop-actions"><button id="frIntPdf">' + ikon("lastned") + " PDF</button><button id=\"frIntXlsx\">" + ikon("lastned") + " Excel</button></div>" +
    '<div class="set-hjelp"><b>' + esc(t("Status (til mottaker)")) + "</b> — " + esc(t("bare % ferdig per elementtype og totalt")) + "</div>" +
    '<div class="prop-actions"><button id="frStPdf">' + ikon("lastned") + " PDF</button><button id=\"frStXlsx\">" + ikon("lastned") + " Excel</button></div></div>" +
    '<p class="set-hjelp">' + esc(t("Trykk «Ferdigmeld», trykk på det som er ferdig i modellen (shift + dra for mange) og trykk Ferdig. Telles i antall objekter. Plan i dag regnes jevnt over hvert trinn fra Fra- til Til-dato.")) + "</p>";
  el.innerHTML = h;
  // Emil 02.11: «trykk Ferdigmeld → markeringsmodus → marker alt → Ferdig».
  // Er noe valgt fra før, er det med i utvalget når modusen starter.
  $("frMeld").onclick = () => { if (velgerAktiv()) return; S.startFerdigVelg(true); };
  $("frIkke").onclick = () => { if (velgerAktiv()) return; S.startFerdigVelg(false); };
  $("frFarg").onchange = (ev) => { farger = !!ev.target.checked; tegnFarger(); };
  $("frIntPdf").onclick = () => last("pdf", "intern");
  $("frIntXlsx").onclick = () => last("xlsx", "intern");
  $("frStPdf").onclick = () => last("pdf", "status");
  $("frStXlsx").onclick = () => last("xlsx", "status");
  tegnFarger();
}

async function last(hva, slag) {
  const r = sisteRapport || await beregn();
  const R = await import("./ferdig-rapport.js");
  try {
    const fil = hva === "pdf" ? await R.lastNedPdf(r, slag) : await R.lastNedExcel(r, slag);
    if (fil) varsel(t("Lastet ned: {0}", fil));
  } catch (err) { varsel(t("Klarte ikke å lage rapporten: {0}", err.message)); }
}

// Panelet åpent på Rapport-fanen? (framdrift.js eier panelet)
const aktiv = () => { const p = $("framdriftPanel"); return !!(p && p.classList.contains("open") && S.fpFane === "rapport"); };
function oppdater() { if (aktiv()) tegnRapport($("ferdigBody")); else ryddFarger(); }
S.ferdigOppdater = oppdater;

// ═══════════ FARGENE I MODELLEN ═══════════
const fargeGruppe = new THREE.Group();
fargeGruppe.name = "ferdigFarger";
scene.add(fargeGruppe);
const FARGE = { gronn: 0x3cb44b, gul: 0xe9a13b, rod: 0xef4444, gra: 0x8a929c };
export function ryddFarger() {
  fargeGruppe.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  fargeGruppe.clear();
}
let fargeRunde = 0;
async function tegnFarger() {
  const runde = ++fargeRunde;
  ryddFarger();
  if (!farger || !aktiv() || !sisteRapport) return;
  const E = await import("./elements.js");
  if (runde !== fargeRunde) return;
  const v = new THREE.Vector3();
  for (const f of ["gronn", "gul", "rod", "gra"]) {
    const ider = new Set(sisteRapport.rader.filter(x => x.farge === f && slagFor(x.k) === "id").map(x => Number(idFor(x.k))));
    // I Ferdigmeld-modusen skal det valgte synes blått — det får ingen farge oppå
    if (velgerAktiv()) { for (const id of (S.multiSel ? S.multiSel.keys() : [])) ider.delete(Number(id)); if (S.currentPropID != null) ider.delete(Number(S.currentPropID)); }
    if (!ider.size) continue;
    const pos = [];
    E.forHverTrekant(ider, (pp, a, b, c, mtx) => { for (const i of [a, b, c]) { v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx); pos.push(v.x, v.y, v.z); } });
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: FARGE[f], transparent: true, opacity: f === "gra" ? 0.35 : 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false }));
    mesh.renderOrder = 989; mesh.raycast = () => {};
    fargeGruppe.add(mesh);
  }
}

// Modusen (framdrift.js velgemodus) — knappen viser «Velger … (n)» så lenge den er på
const velgerAktiv = () => !!(S.ferdigVelgAktiv && S.ferdigVelgAktiv());
S.ferdigMeld = (ferdig) => meld(ferdig);
// Utvalget endret i modusen: telleren på knappen, og fargene gjøres om så det
// valgte (blått) ikke dekkes av den røde/grønne fargen oppå
let utvalgTid = 0;
S.ferdigVelgEndret = () => {
  const b = $("frMeld");
  if (b && velgerAktiv()) b.textContent = "✅ " + t("Velger … ({0})", valgte().length);
  clearTimeout(utvalgTid);
  utvalgTid = setTimeout(tegnFarger, 120);
};

// ═══════════ KROKER (kalles fra framdrift.js) ═══════════
export function lastFerdig() {
  universBuffer = null; sisteRapport = null;
  ryddFarger();
  S.ferdig = lesLokalt();
  hentFraSp();
}
export function ryddFerdig() { ryddFarger(); S.ferdig = []; universBuffer = null; sisteRapport = null; }
export function lagringsStatus() { return spStatus; }
