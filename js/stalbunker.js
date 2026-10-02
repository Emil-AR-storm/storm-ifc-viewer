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
import { allElementBoxes, forHverTrekant, lastNedXlsx, quantitiesForSet } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { profilKgPerM } from "./profiler.js";
import { lagreMateriellLokalt, tegnMateriell, vaskMateriell } from "./materiell-vis.js";
import { fagverkNokkel, fagverkProfiler, finnFagverk, grupperFagverk, grupperStal, plasserBunker, profilNavn, stalMengder, stalNokkel, stalSum } from "./stalbunker-regn.js";

// Fargen på stålet i bunkene: grå stål, så de skiller seg fra SW-bunkene
// (lys grå) og TRP (blågrå). Ikke en UI-farge, derfor ikke en CSS-variabel.
export const STAL_FARGE = "#6f7b85";
const ID_PREFIKS = "STAL-";

function stalliste() { return (S.materiell || []).filter(p => p && (p.maltype === "stal" || p.maltype === "fagverk")); }
// Nøkkelen en bunke huskes på (samme som gruppenes `nokkel`)
function bunkeNokkel(p) {
  return p.maltype === "fagverk" ? (p.nokkel || fagverkNokkel(p.lengde, p.bredde, p.staver.length, p.staver)) : stalNokkel(p.del, p.profil, p.lengde);
}

// 🔺 Endepunktene til hver bjelke (meter, scenens akser): de to punktene på
// elementet som ligger lengst fra hverandre — samme to-runders regel som
// lengden i quantitiesForSet. Fagverkreglene trenger planet og helningen.
const _p = new THREE.Vector3();
function endepunkter(ider) {
  const start = new Map(), fjern = new Map();
  const punkt = (pos, i, m) => { _p.fromBufferAttribute(pos, i); if (m) _p.applyMatrix4(m); return _p; };
  forHverTrekant(ider, (pos, a, b, c, m, id) => {
    for (const i of [a, b, c]) {
      const v = punkt(pos, i, m);
      if (!start.has(id)) { start.set(id, v.clone()); continue; }
      const d = v.distanceToSquared(start.get(id)), f = fjern.get(id);
      if (!f || d > f.d) fjern.set(id, { d, p: v.clone() });
    }
  });
  const ende = new Map();
  forHverTrekant(ider, (pos, a, b, c, m, id) => {
    const f = fjern.get(id);
    if (!f) return;
    for (const i of [a, b, c]) {
      const v = punkt(pos, i, m), d = v.distanceToSquared(f.p), e = ende.get(id);
      if (!e || d > e.d) ende.set(id, { d, p: v.clone() });
    }
  });
  // De to ytterpunktene er HJØRNER av endeflatene, ikke midten av staven —
  // forskjøvet en halv profilbredde. På et HEA220 er det 11 cm, nok til at
  // stagene i enden av et fagverk falt utenfor planet (nettleserprøven 01.10).
  // Derfor: snittet av alle punktene nær hver ende er endens MIDTPUNKT.
  const toM = S.enhetSkala || 1, sum = new Map();
  forHverTrekant(ider, (pos, a, b, c, m, id) => {
    const f = fjern.get(id), e = ende.get(id);
    if (!f || !e) return;
    const L = f.p.distanceTo(e.p), r = Math.min(0.4 / toM, L / 4);
    let q = sum.get(id);
    if (!q) sum.set(id, q = { a: new THREE.Vector3(), na: 0, b: new THREE.Vector3(), nb: 0 });
    for (const i of [a, b, c]) {
      const v = punkt(pos, i, m);
      if (v.distanceTo(e.p) < r) { q.a.add(v); q.na++; }
      else if (v.distanceTo(f.p) < r) { q.b.add(v); q.nb++; }
    }
  });
  const ut = new Map();
  for (const [id, q] of sum) {
    if (!q.na || !q.nb) continue;
    const a = q.a.divideScalar(q.na), b = q.b.divideScalar(q.nb);
    ut.set(id, { a: [a.x * toM, a.y * toM, a.z * toM], b: [b.x * toM, b.y * toM, b.z * toM] });
  }
  return ut;
}

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
    // IfcMember: stagene i et fagverk er i noen modeller Member, ikke Beam
    if (!i || (i.type !== "Column" && i.type !== "Beam" && i.type !== "Member")) continue;
    ider.add(id); info.set(id, i);
  }
  if (!ider.size) return [];
  const q = quantitiesForSet(ider);
  const ender = endepunkter(new Set([...ider].filter(id => info.get(id).type !== "Column")));
  const toM = S.enhetSkala || 1, v = new THREE.Vector3();
  const ut = [];
  for (const id of ider) {
    const i = info.get(id), b = bokser.get(id);
    b.getSize(v);
    const mal = [v.x, v.y, v.z].map(x => x * toM * 1000).sort((a, c) => a - c);
    const lengdeMm = ((q.get(id) || {}).len || 0) * 1000 || mal[2];
    const prof = profilKgPerM(i.objType) || profilKgPerM(i.navn);
    const en = ender.get(id);
    ut.push({ id, del: i.type === "Column" ? "soyle" : "bjelke", profil: profilNavn(i.navn, i.objType),
      lengdeMm, kgPerM: prof ? prof.kgPerM : 0, b: mal[0], h: mal[1], bMm: mal[0], a: en && en.a, bp: en && en.b });
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
  // 🔺 Fagverkene først: stavene deres ligger i halvdelene, ikke i de løse bunkene
  const fagverk = finnFagverk(elementer.filter(e => e.a && e.bp).map(e => Object.assign({}, e, { b: e.bp })));
  const iFagverk = new Set(fagverk.flatMap(f => f.ider));
  const grupper = grupperStal(elementer.filter(e => !iFagverk.has(e.id))).concat(grupperFagverk(fagverk));
  if (!grupper.length) { alert(t("Fant ingen søyler eller bjelker (IfcColumn / IfcBeam) i modellen.")); return null; }
  const { c, gulv, ramme } = byggRamme();
  const plass = new Map(plasserBunker(grupper, ramme).map(p => [p.nokkel, p]));
  const gamle = new Map(stalliste().map(p => [bunkeNokkel(p), p]));
  const for_ = (S.materiell || []).slice();
  const nye = [];
  for (const g of grupper) {
    const gml = gamle.get(g.nokkel), pl = plass.get(g.nokkel);
    const felles = {
      id: gml ? gml.id : ID_PREFIKS + Math.random().toString(36).slice(2, 9),
      farge: gml ? gml.farge : STAL_FARGE, antall: g.antall,
      x: gml ? gml.x : c.x + pl.x / (S.enhetSkala || 1), y: gml ? gml.y : gulv, z: gml ? gml.z : c.z + pl.z / (S.enhetSkala || 1),
      rot: gml ? gml.rot : (pl.rot || 0), skjult: gml ? gml.skjult : false
    };
    if (g.del === "fagverk") {
      const p = vaskMateriell(Object.assign(felles, { maltype: "fagverk",
        navn: t("Fagverk halvdel") + " · " + g.lengdeMm + " × " + g.hoydeMm + " mm",
        lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: g.tykkMm, staver: g.staver, kgHalv: g.kgHalv, nokkel: g.nokkel }));
      if (p) nye.push(p);
      continue;
    }
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
  return { bunker: nye.length, profiler: elementer.length, fagverk: fagverk.length };
}

// 📅 FRAMDRIFTSPLANEN (Emil 02.10): hvilke IFC-elementer hver stålbunke er
// levert til. Bunken minker i framdriftsplanens glider, PDF og video etter
// hvert som elementene monteres — og BARE der; selve bunkene endres ikke.
// Svar: Map(bunkenøkkel → [{ nokler: ["id:…"], w }]), én enhet per profil
// eller per fagverkshalvdel.
export async function stalKilder() {
  const elementer = await lesStal();
  const fagverk = finnFagverk(elementer.filter(e => e.a && e.bp).map(e => Object.assign({}, e, { b: e.bp })));
  const iFagverk = new Set(fagverk.flatMap(f => f.ider));
  const ut = new Map();
  const legg = (k, nokler) => { if (!ut.has(k)) ut.set(k, []); ut.get(k).push({ nokler, w: 1 }); };
  for (const e of elementer) {
    if (iFagverk.has(e.id) || (e.del !== "soyle" && e.del !== "bjelke")) continue;
    for (const g of grupperStal([e])) legg(g.nokkel, ["id:" + e.id]);
  }
  for (const g of grupperFagverk(fagverk)) for (const ider of g.fagverk || []) legg(g.nokkel, ider.map(id => "id:" + id));
  return ut;
}
export { bunkeNokkel };

function settAlt(liste) {
  S.materiell = liste;
  tegnMateriell(); S.qtyCache = null; lagreMateriellLokalt();
  if (S.tegnMateriellPanel) S.tegnMateriellPanel();
}
function settStal(nye) {
  settAlt((S.materiell || []).filter(p => !p || (p.maltype !== "stal" && p.maltype !== "fagverk")).concat(nye));
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
  return stalMengder(stalliste().map(p => p.maltype === "fagverk"
    ? { del: "fagverk", profil: fagverkProfiler(p.staver).join(", "), lengdeMm: p.lengde, hoydeMm: p.bredde, antall: p.antall, kgHalv: p.kgHalv }
    : { del: p.del, profil: p.profil, lengdeMm: p.lengde, antall: p.antall, kgPerM: ((profilKgPerM(p.profil) || {}).kgPerM) || 0 }));
}
const delNavn = (d) => t(d === "soyle" ? "Søyle" : d === "fagverk" ? "Fagverk halvdel" : "Bjelke");
const nb = (x, d) => Number(x).toLocaleString("nb-NO", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });

export async function lastNedStalliste() {
  const rader = mengderNaa();
  const sum = stalSum(rader);
  const ut = [[t("Del"), t("Profil"), t("Lengde (mm)"), t("Antall"), t("Løpemeter"), t("Vekt (kg)")]];
  for (const r of rader) ut.push([delNavn(r.del) + (r.del === "fagverk" ? " (H " + r.hoydeMm + " mm)" : ""), r.profil, r.lengdeMm, r.antall, r.lm, r.kg == null ? "" : r.kg]);
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
      '<p style="color:var(--muted);font-size:12px;margin:4px 0">' +
      t("Fagverk kjennes igjen av seg selv (to korder med stag imellom) og legges som halvdeler, delt midt på, flatt på strøer.") + "</p>" +
      '<div class="prop-actions" style="flex-wrap:wrap">' +
      '<button id="stalLag">' + ikon("boks") + " " + t(rader.length ? "Lag stålbunker på nytt" : "Lag stålbunker") + "</button>" +
      '<button id="stalFjern"' + (rader.length ? "" : " disabled") + ">" + ikon("slett") + " " + t("Fjern stålbunker") + "</button>" +
      '<button id="stalXlsx"' + (rader.length ? "" : " disabled") + ">" + ikon("lastned") + " " + t("Mengdeliste (Excel)") + "</button></div>";
    if (rader.length) {
      h += rader.map(r => '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(delNavn(r.del)) +
        (r.del === "fagverk"
          ? ' <span style="color:var(--muted);font-size:11px">' + nb(r.lengdeMm) + " × " + nb(r.hoydeMm) + " mm · " + esc(r.profil) + "</span></div>"
          : " " + esc(r.profil) + ' <span style="color:var(--muted);font-size:11px">' + nb(r.lengdeMm) + " mm</span></div>") +
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
