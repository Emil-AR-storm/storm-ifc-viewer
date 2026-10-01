// 🔩 Stålbunker — VERKTØYET (kun kontor). Leser søylene og bjelkene i
// stålmodellen og legger dem som materiellbunker rundt bygget, gruppert på
// del (søyle/bjelke), profil og lengde. Regningen står i stalbunker-regn.js;
// her hentes tallene fra modellen, og bunkene legges inn i S.materiell som
// maltypen «stal» (materiell-vis.js tegner dem, også på byggeplass-siden).
//
// Panelet er en seksjon i Materiell (materiell.js spør S.stalPanel om HTML og
// lyttere) — bunkene ER materiell, og der ligger flytt, skjul og slett fra før.
import * as THREE from "three";
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { allElementBoxes, lastNedXlsx, quantitiesForSet } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { profilKgPerM } from "./profiler.js";
import { lagreMateriellLokalt, tegnMateriell, vaskMateriell } from "./materiell-vis.js";
import { grupperStal, plasserBunker, profilNavn, stalMengder, stalNokkel, stalSum } from "./stalbunker-regn.js";

// Fargen på stålet i bunkene: grå stål, så de skiller seg fra SW-bunkene
// (lys grå) og TRP (blågrå). Ikke en UI-farge, derfor ikke en CSS-variabel.
export const STAL_FARGE = "#6f7b85";
const ID_PREFIKS = "STAL-";

function stalliste() { return (S.materiell || []).filter(p => p && p.maltype === "stal"); }

// IFC-typen til et element: fra IFC-tråden, eller fra den lette kopien (glb).
function elementInfo(id) {
  if (S.glbActive) {
    const p = S.glbProps && S.glbProps.get(id);
    return p ? { navn: p[0] || "", objType: p[1] || "", type: String(p[2] || "").replace(/^Ifc/i, "") } : null;
  }
  const m = metaFor(id);
  return m ? { navn: m.name || "", objType: m.objectType || "", type: m.typeName || "" } : null;
}

// Søylene og bjelkene i modellen → elementene til grupperStal.
// Lengden er den lengste avstanden mellom to punkter på elementet (samme mål
// som Mengder bruker, så kapplista og mengdelista aldri er uenige), og
// tverrsnittet er de to korteste sidene av boksen — bare til tegningen.
export async function lesStal() {
  if (!S.modelGroup) return [];
  if (!S.glbActive) await sikreMeta(alleElementIder);
  const bokser = allElementBoxes();
  const ider = new Set();
  const info = new Map();
  for (const id of bokser.keys()) {
    const i = elementInfo(id);
    if (!i || (i.type !== "Column" && i.type !== "Beam")) continue;
    ider.add(id); info.set(id, i);
  }
  if (!ider.size) return [];
  const q = quantitiesForSet(ider);
  const toM = S.enhetSkala || 1, v = new THREE.Vector3();
  const ut = [];
  for (const id of ider) {
    const i = info.get(id), b = bokser.get(id);
    b.getSize(v);
    const mal = [v.x, v.y, v.z].map(x => x * toM * 1000).sort((a, c) => a - c);
    const lengdeMm = ((q.get(id) || {}).len || 0) * 1000 || mal[2];
    const prof = profilKgPerM(i.objType) || profilKgPerM(i.navn);
    ut.push({ del: i.type === "Column" ? "soyle" : "bjelke", profil: profilNavn(i.navn, i.objType),
      lengdeMm, kgPerM: prof ? prof.kgPerM : 0, b: mal[0], h: mal[1] });
  }
  return ut;
}

// Byggets fotavtrykk i METER fra modellens senter (samme ramme som scenen).
function byggRamme() {
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const toM = S.enhetSkala || 1, c = boks.getCenter(new THREE.Vector3());
  return { c, gulv: boks.min.y,
    ramme: { minX: (boks.min.x - c.x) * toM, maxX: (boks.max.x - c.x) * toM, minZ: (boks.min.z - c.z) * toM, maxZ: (boks.max.z - c.z) * toM } };
}

// Lag (eller lag på nytt) bunkene. En bunke som er flyttet beholder plassen
// sin så lenge del, profil og lengde er de samme — samme huskeregel som
// SW-bunkene (bunker.js): nøkkelen er innholdet, ikke rekkefølgen.
export async function lagStalbunker() {
  const elementer = await lesStal();
  const grupper = grupperStal(elementer);
  if (!grupper.length) { alert(t("Fant ingen søyler eller bjelker (IfcColumn / IfcBeam) i modellen.")); return null; }
  const { c, gulv, ramme } = byggRamme();
  const plass = new Map(plasserBunker(grupper, ramme).map(p => [p.nokkel, p]));
  const gamle = new Map(stalliste().map(p => [stalNokkel(p.del, p.profil, p.lengde), p]));
  const for_ = (S.materiell || []).slice();
  const nye = [];
  for (const g of grupper) {
    const gml = gamle.get(g.nokkel), pl = plass.get(g.nokkel);
    const p = vaskMateriell({
      id: gml ? gml.id : ID_PREFIKS + Math.random().toString(36).slice(2, 9),
      maltype: "stal", navn: t(g.del === "soyle" ? "Søyle" : "Bjelke") + " " + g.profil + " · " + g.lengdeMm + " mm",
      farge: gml ? gml.farge : STAL_FARGE,
      lengde: g.lengdeMm, bredde: g.snitt.b, tykkelse: g.snitt.h, godstykkelse: g.snitt.t,
      profil: g.profil, del: g.del, form: g.snitt.form, antall: g.antall,
      x: gml ? gml.x : c.x + pl.x / (S.enhetSkala || 1), y: gml ? gml.y : gulv, z: gml ? gml.z : c.z + pl.z / (S.enhetSkala || 1),
      rot: gml ? gml.rot : 0, skjult: gml ? gml.skjult : false
    });
    if (p) nye.push(p);
  }
  settStal(nye);
  const etter = S.materiell.slice();
  if (S.pushAngre) S.pushAngre({ tekst: "Stålbunker laget", angre: () => settAlt(for_), gjenopprett: () => settAlt(etter) });
  return { bunker: nye.length, profiler: elementer.length };
}

function settAlt(liste) {
  S.materiell = liste;
  tegnMateriell(); S.qtyCache = null; lagreMateriellLokalt();
  if (S.tegnMateriellPanel) S.tegnMateriellPanel();
}
function settStal(nye) {
  settAlt((S.materiell || []).filter(p => !p || p.maltype !== "stal").concat(nye));
}

export function fjernStalbunker() {
  if (!stalliste().length) return;
  const for_ = (S.materiell || []).slice();
  settStal([]);
  const etter = S.materiell.slice();
  if (S.pushAngre) S.pushAngre({ tekst: "Stålbunker fjernet", angre: () => settAlt(for_), gjenopprett: () => settAlt(etter) });
}

// Mengdelista: fra bunkene som står (de kan være laget i en tidligere økt).
function mengderNaa() {
  return stalMengder(stalliste().map(p => ({ del: p.del, profil: p.profil, lengdeMm: p.lengde, antall: p.antall,
    kgPerM: ((profilKgPerM(p.profil) || {}).kgPerM) || 0 })));
}
const delNavn = (d) => t(d === "soyle" ? "Søyle" : "Bjelke");
const nb = (x, d) => Number(x).toLocaleString("nb-NO", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });

export async function lastNedStalliste() {
  const rader = mengderNaa();
  const sum = stalSum(rader);
  const ut = [[t("Del"), t("Profil"), t("Lengde (mm)"), t("Antall"), t("Løpemeter"), t("Vekt (kg)")]];
  for (const r of rader) ut.push([delNavn(r.del), r.profil, r.lengdeMm, r.antall, r.lm, r.kg == null ? "" : r.kg]);
  ut.push([t("Sum"), "", "", sum.antall, sum.lm, Math.round(sum.kg * 10) / 10]);
  const navn = String(S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  await lastNedXlsx(navn + " - stålbunker.xlsx", t("Stålbunker"), ut);
}

// ── Seksjonen i Materiell-panelet ──
S.stalPanel = {
  html() {
    const rader = mengderNaa(), sum = stalSum(rader);
    let h = '<h4 style="margin:14px 0 4px">' + ikon("boks") + " " + t("Stålbunker fra stålmodellen") + "</h4>" +
      '<p style="color:var(--muted);font-size:12px;margin:4px 0">' +
      t("Søylene og bjelkene i modellen legges i bunker rundt bygget, én bunke per profil og lengde. Søyler og bjelker ligger alltid i hver sin bunke.") + "</p>" +
      '<div class="prop-actions" style="flex-wrap:wrap">' +
      '<button id="stalLag">' + ikon("boks") + " " + t(rader.length ? "Lag stålbunker på nytt" : "Lag stålbunker") + "</button>" +
      '<button id="stalFjern"' + (rader.length ? "" : " disabled") + ">" + ikon("slett") + " " + t("Fjern stålbunker") + "</button>" +
      '<button id="stalXlsx"' + (rader.length ? "" : " disabled") + ">" + ikon("lastned") + " " + t("Mengdeliste (Excel)") + "</button></div>";
    if (rader.length) {
      h += rader.map(r => '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(delNavn(r.del)) + " " + esc(r.profil) +
        ' <span style="color:var(--muted);font-size:11px">' + nb(r.lengdeMm) + " mm</span></div>" +
        '<div class="c" style="font-size:12px;color:var(--text)">' + r.antall + t(" stk") +
        ' <span style="color:var(--muted);font-size:11px">' + nb(r.lm, 1) + " m" + (r.kg != null ? " · " + nb(r.kg) + " kg" : "") + "</span></div></div>").join("") +
        '<div class="qty-row"><div class="n" style="font-weight:700;font-size:12px">' + t("Sum") + "</div>" +
        '<div class="c" style="font-weight:700;font-size:12px;color:var(--text)">' + sum.antall + t(" stk") + " · " + nb(sum.lm, 1) + " m · " + nb(sum.kg) + " kg</div></div>" +
        (sum.utenVekt ? '<p style="color:var(--muted);font-size:11px;margin:4px 0">' + t("{0} profiler uten kjent vekt — profilen finnes ikke i tabellen.", sum.utenVekt) + "</p>" : "") +
        '<p style="color:var(--muted);font-size:11px;margin:4px 0">' + t("Stålet står allerede i Mengder (fra modellen) — bunkene telles ikke der en gang til.") + "</p>";
    }
    return h;
  },
  kobl() {
    if ($("stalLag")) $("stalLag").onclick = async () => {
      const b = $("stalLag"); b.disabled = true;
      try { await lagStalbunker(); }
      catch (err) { alert(t("Klarte ikke å lage stålbunkene: {0}", err.message)); }
      finally { if ($("stalLag")) $("stalLag").disabled = false; }
    };
    if ($("stalFjern")) $("stalFjern").onclick = () => fjernStalbunker();
    if ($("stalXlsx")) $("stalXlsx").onclick = () => lastNedStalliste();
  }
};
