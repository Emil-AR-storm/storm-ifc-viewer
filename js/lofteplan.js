// 🏗 LØFTEPLAN — seksjonen inni tårnkranen i Rigg (runde 8, Emils valg 3A 30.10.2026).
//
// «Løfteplan kan ligge som en egen seksjon inni kran-rigg-objektet, med en
// snarvei i Dokumentasjon» (Emil 30.10). Seksjonen tegnes av rigg.js under
// skjemaet når en tårnkran er valgt (lofteplanHtml + koblLofteplan), og
// snarveien btnDokLofte (dokumentasjon.js) åpner Rigg og velger kranen.
//
// Regningen står i kran-regn.js. Her: elementene (vekt fra Mengder, boks fra
// modellen), kranens plass i scenen, fargene i 3D, lista, Excel og markeringer.
import * as THREE from "three";
import { $, S, esc } from "./state.js";
import { scene, flyTil } from "./scene.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import * as K from "./kran-regn.js";

const tilstand = { farger: true, svar: null, nokkel: "", kranId: "", regner: false, elementer: null, elementNokkel: "" };
export const _tilstand = tilstand;
const tusen = (n) => Math.round(n).toLocaleString("nb-NO");

// ---------- Elementene: vekt (Mengder) + boks (modellen) ----------
async function elementer() {
  const nokkel = (S.fileName || "") + "|" + (S.modelGroup ? S.modelGroup.uuid : "");
  if (tilstand.elementer && tilstand.elementNokkel === nokkel) return tilstand.elementer;
  if (!S.modelGroup) return [];
  const E = await import("./elements.js");
  await E.sikreMengder();
  const rows = (S.qtyCache && S.qtyCache.rows) || [];
  const boxes = E.allElementBoxes();
  const per = new Map();
  for (const r of rows) {
    if (r.id == null || typeof r.id !== "number") continue;   // materiell o.l. har syntetiske id-er
    const x = per.get(r.id) || { id: r.id, navn: r.name || "", type: r.type || "", material: r.material || "", kg: 0, beste: -1 };
    x.kg += r.kg || 0;
    // Lagdelt element: materialgruppen etter det tyngste laget
    if ((r.kg || 0) > x.beste) { x.beste = r.kg || 0; x.material = r.material || x.material; }
    per.set(r.id, x);
  }
  const ut = [];
  for (const x of per.values()) {
    const b = boxes.get(x.id);
    if (!b) continue;
    ut.push({ id: x.id, navn: x.navn, type: x.type, material: x.material, gruppe: E.materialGruppe(x.material) || "Uten materiale",
      kg: x.kg, box: { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } });
  }
  tilstand.elementer = ut; tilstand.elementNokkel = nokkel;
  return ut;
}
export const _elementer = elementer;

// Kranens midte i scenen (x, z) — fra den tegnede kranen i Rigg
async function kranXZ(o) {
  const V = await import("./rigg-vis.js");
  const g = V.finnRiggObjekt(o.id);
  if (!g) return null;
  const v = new THREE.Vector3();
  g.getWorldPosition(v);
  return [v.x, v.z];
}

export async function regn(o) {
  const xz = await kranXZ(o);
  if (!xz) return null;
  const els = await elementer();
  const svar = K.kransjekk(els, { xz, radiusM: o.radius, plan: o.lofteplan }, S.enhetSkala || 1);
  svar.grupper = K.grupperIModell(els);
  return svar;
}

// ---------- HTML ----------
export function lofteplanHtml(o) {
  const p = K.vaskLofteplan(o.lofteplan);
  const rader = p.kurve.length ? p.kurve : [{ r: "", kg: "" }];
  let h = '<h4 data-sek="rigg-lofteplan" style="margin:12px 0 4px">🏗 ' + esc(t("Løfteplan")) + "</h4>" +
    '<div id="lpBody" class="lp">' +
    '<p class="lp-liten">' + esc(t("Lastkurve fra kranens datablad: maks last (kg) ved radius (m). Mellom punktene brukes kapasiteten ved neste større radius (på den sikre siden).")) + "</p>" +
    '<div class="lp-kurve"><span>' + esc(t("Radius (m)")) + "</span><span>" + esc(t("Maks last (kg)")) + "</span><span></span>" +
    rader.map((q, i) => '<input type="text" inputmode="decimal" data-lp-r="' + i + '" value="' + esc(q.r) + '" placeholder="' + (10 * (i + 1)) + '">' +
      '<input type="text" inputmode="decimal" data-lp-kg="' + i + '" value="' + (q.kg === "" ? "" : esc(q.kg)) + '" placeholder="kg">' +
      '<button class="lag-x" data-lp-fjern="' + i + '" title="' + esc(t("Fjern punktet")) + '">✕</button>').join("") + "</div>" +
    '<div class="lag-knapper"><button data-lp-ny>' + esc(t("＋ Punkt")) + "</button></div>" +
    '<label class="lp-felt">' + esc(t("Løfteutstyr (åk, stropper) kg")) + '<input type="text" inputmode="decimal" id="lpUtstyr" value="' + p.utstyrKg + '"></label>' +
    '<label class="lp-felt">' + esc(t("Radius måles til")) + '<select id="lpModus"><option value="midt"' + (p.modus === "midt" ? " selected" : "") + ">" + esc(t("midten av elementet")) + "</option>" +
    '<option value="hjorne"' + (p.modus === "hjorne" ? " selected" : "") + ">" + esc(t("hjørnet lengst unna (sikrest)")) + "</option></select></label>" +
    '<div class="koll-lbl">' + esc(t("HVA LØFTER KRANEN?")) + "</div>" +
    '<div id="lpGrupper" class="lp-grupper"><span class="lp-liten">' + esc(t("Leser modellen …")) + "</span></div>" +
    '<p class="lp-liten">' + esc(t("Plasstøpt betong løftes ikke med kran. Slå på Betong bare for betongelementer.")) + "</p>" +
    '<div class="koll-lbl">' + esc(t("RESULTAT")) + "</div>" +
    '<div id="lpResultat"><span class="lp-liten">' + esc(t("Regner …")) + "</span></div></div>";
  return h;
}

const FARGE = { gronn: "#2e9e4a", gul: "#e9a13b", rod: "#d22b34", ukjent: "#6b7280", utenfor: "#6b7280" };
const NAVN = { gronn: "innenfor (under 90 %)", gul: "90–100 % — sjekk", rod: "over kapasitet", utenfor: "utenfor lastkurven / bommen", ukjent: "ukjent vekt" };

function resultatHtml(svar, harKurve) {
  const tl = svar.telling;
  let h = "";
  if (!harKurve) h += '<div class="lag-ulagret" style="color:var(--warn)">⚠ ' + esc(t("Skriv inn lastkurven fra kranens datablad for å sjekke løftene.")) + "</div>";
  if (!tl.totalt) return h + '<p class="lp-liten">' + esc(t("Ingen elementer i de valgte materialgruppene.")) + "</p>";
  h += ["gronn", "gul", "rod", "utenfor", "ukjent"].filter(k => tl[k]).map(k => '<div class="lp-tell"><span class="fdv-pill" style="background:' + FARGE[k] + ';color:' + (k === "gul" ? "#111" : "#fff") + '">' + tl[k] + "</span> " + esc(t(NAVN[k])) + "</div>").join("");
  h += '<label class="fdv-farger"><input type="checkbox" id="lpFarger"' + (tilstand.farger ? " checked" : "") + "> " + esc(t("Fargelegg modellen")) + "</label>";
  const ikkeOk = svar.rader.filter(r => r.farge !== "gronn");
  if (ikkeOk.length) {
    h += '<div class="koll-lbl">' + esc(t("MÅ SJEKKES · {0}", ikkeOk.length)) + "</div>";
    h += ikkeOk.slice(0, 40).map(r => '<div class="lp-rad" data-lp-gaa="' + r.id + '"><span class="fdv-prikk" style="background:' + FARGE[r.farge] + '"></span><span class="lp-n">' + esc(r.navn || r.type) + "</span>" +
      '<span class="lp-t">' + (r.kg ? esc(tusen(r.kg)) + " kg" : esc(t("ukjent vekt"))) + " · R " + String(r.r).replace(".", ",") + " m" + (r.utn != null ? " · <b>" + String(r.utn).replace(".", ",") + " %</b>" : "") + "</span></div>").join("");
    if (ikkeOk.length > 40) h += '<p class="lp-liten">' + esc(t("… og {0} til (se Excel).", ikkeOk.length - 40)) + "</p>";
  }
  h += '<div class="lag-knapper"><button class="primary" id="lpExcel">' + esc(t("Excel")) + "</button>" +
    (svar.telling.rod ? '<button id="lpMark">' + esc(t("Lag markeringer ({0} røde)", svar.telling.rod)) + "</button>" : "") + "</div>";
  return h;
}

// ---------- Kobling ----------
// oppdater(felter, tekst) = rigg.js sin lagring (med angre)
export function koblLofteplan(o, oppdater) {
  const body = $("lpBody");
  if (!body) return;
  const p = K.vaskLofteplan(o.lofteplan);
  const lesKurve = () => {
    const ut = [];
    body.querySelectorAll("[data-lp-r]").forEach(inp => { const i = inp.dataset.lpR; const kg = body.querySelector('[data-lp-kg="' + i + '"]'); ut.push({ r: inp.value, kg: kg ? kg.value : "" }); });
    return ut;
  };
  const lagre = (endring, tekst) => oppdater({ lofteplan: Object.assign({}, p, endring) }, tekst || "Løfteplan endret");
  body.querySelectorAll("[data-lp-r], [data-lp-kg]").forEach(inp => {
    inp.onchange = () => lagre({ kurve: K.vaskLastkurve(lesKurve()) }, "Lastkurve endret");
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } };
  });
  body.querySelectorAll("[data-lp-fjern]").forEach(b => b.onclick = () => {
    const i = Number(b.dataset.lpFjern);
    lagre({ kurve: K.vaskLastkurve(lesKurve().filter((_, j) => j !== i)) }, "Lastkurve endret");
  });
  const ny = body.querySelector("[data-lp-ny]");
  if (ny) ny.onclick = () => {
    // Et tomt felt nederst — lagres først når det er fylt ut
    const k = body.querySelector(".lp-kurve");
    const i = body.querySelectorAll("[data-lp-r]").length;
    k.insertAdjacentHTML("beforeend", '<input type="text" inputmode="decimal" data-lp-r="' + i + '" placeholder="m"><input type="text" inputmode="decimal" data-lp-kg="' + i + '" placeholder="kg"><span></span>');
    k.querySelectorAll('[data-lp-r="' + i + '"], [data-lp-kg="' + i + '"]').forEach(inp => { inp.onchange = () => lagre({ kurve: K.vaskLastkurve(lesKurve()) }, "Lastkurve endret"); });
    const f = k.querySelector('[data-lp-r="' + i + '"]'); if (f) f.focus();
  };
  const ut = $("lpUtstyr"); if (ut) ut.onchange = () => lagre({ utstyrKg: ut.value }, "Løfteutstyr endret");
  const mo = $("lpModus"); if (mo) mo.onchange = () => lagre({ modus: mo.value }, "Løfteplan endret");
  oppdaterResultat(o, oppdater);
}

async function oppdaterResultat(o, oppdater) {
  const p = K.vaskLofteplan(o.lofteplan);
  const svar = await regn(o).catch(() => null);
  const gEl = $("lpGrupper"), rEl = $("lpResultat");
  if (!gEl || !rEl) return;
  if (!svar) { rEl.innerHTML = '<span class="lp-liten">' + esc(t("Fant ikke kranen i 3D. Er terrenget eller bygget lastet?")) + "</span>"; return; }
  tilstand.svar = svar; tilstand.kranId = o.id;
  const med = new Set(p.grupper);
  gEl.innerHTML = svar.grupper.map(g => '<label><input type="checkbox" data-lp-gruppe="' + esc(g.gruppe) + '"' + (med.has(g.gruppe) ? " checked" : "") + "> " + esc(t(g.gruppe)) + ' <span class="lp-liten">' + g.antall + "</span></label>").join("") ||
    '<span class="lp-liten">' + esc(t("Ingen elementer med materiale i modellen.")) + "</span>";
  gEl.querySelectorAll("[data-lp-gruppe]").forEach(c => c.onchange = () => {
    const ny = new Set(p.grupper); if (c.checked) ny.add(c.dataset.lpGruppe); else ny.delete(c.dataset.lpGruppe);
    oppdater({ lofteplan: Object.assign({}, p, { grupper: [...ny] }) }, "Løfteplan endret");
  });
  rEl.innerHTML = resultatHtml(svar, p.kurve.length > 0);
  const fa = $("lpFarger"); if (fa) fa.onchange = () => { tilstand.farger = fa.checked; tegnFarger(); };
  rEl.querySelectorAll("[data-lp-gaa]").forEach(d => d.onclick = () => gaaTil(Number(d.dataset.lpGaa)));
  const ex = $("lpExcel"); if (ex) ex.onclick = () => lastNedExcel(o);
  const mk = $("lpMark"); if (mk) mk.onclick = () => lagMarkeringer(o);
  tegnFarger();
}

// ---------- Fargene i 3D ----------
const fargeGruppe = new THREE.Group();
fargeGruppe.name = "lofteplan-farger";
scene.add(fargeGruppe);
export const _fargeGruppe = fargeGruppe;
export function ryddFarger() {
  fargeGruppe.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  fargeGruppe.clear();
}
let runde = 0;
async function tegnFarger() {
  const r = ++runde;
  ryddFarger();
  const p = $("riggPanel");
  if (!tilstand.farger || !tilstand.svar || !p || !p.classList.contains("open") || S.riggValgtId !== tilstand.kranId) return;
  const E = await import("./elements.js");
  if (r !== runde) return;
  const v = new THREE.Vector3();
  for (const f of ["gronn", "gul", "rod", "utenfor", "ukjent"]) {
    const ider = new Set(tilstand.svar.rader.filter(x => x.farge === f).map(x => x.id));
    if (!ider.size) continue;
    const pos = [];
    E.forHverTrekant(ider, (pp, a, b, c, mtx) => { for (const i of [a, b, c]) { v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx); pos.push(v.x, v.y, v.z); } });
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: FARGE[f], transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false }));
    mesh.renderOrder = 990; mesh.raycast = () => {};
    fargeGruppe.add(mesh);
  }
}
// rigg.js kaller denne når panelet tegnes (ny kran valgt, eller ingen)
export function etterRiggPanel(valgtKran) {
  if (!valgtKran || valgtKran.id !== tilstand.kranId) { if (!valgtKran) { tilstand.kranId = ""; tilstand.svar = null; } ryddFarger(); }
}

async function gaaTil(id) {
  const E = await import("./elements.js");
  const b = E.allElementBoxes().get(id);
  if (!b) return;
  try { E.selectElement(id); } catch (_) {}
  flyTil(b.getCenter(new THREE.Vector3()), Math.max(b.getSize(new THREE.Vector3()).length() * 2.5, 2.5 / (S.enhetSkala || 1)));
}

export async function lastNedExcel(o) {
  const svar = tilstand.svar && tilstand.kranId === o.id ? tilstand.svar : await regn(o);
  if (!svar) return;
  const X = await import("./xlsx.js");
  const { excelToppfelt } = await import("./excel-logo.js");
  const p = K.vaskLofteplan(o.lofteplan);
  const kurve = [[t("Radius (m)"), t("Maks last (kg)")]].concat(p.kurve.map(q => [q.r, q.kg])).concat([[], [t("Løfteutstyr (kg)"), p.utstyrKg], [t("Radius måles til"), t(p.modus === "hjorne" ? "hjørnet lengst unna (sikrest)" : "midten av elementet")],
    [t("Bomlengde (m)"), o.radius], [t("Materialgrupper"), p.grupper.map(g => t(g)).join(", ")]]);
  const data = X.lagXlsxFlere([{ navn: t("Kransjekk"), rader: K.excelRader(svar.rader, t) }, { navn: t("Lastkurve"), rader: kurve }], await excelToppfelt());
  const base = String(S.fileName || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]/g, "-");
  const url = URL.createObjectURL(new Blob([data], { type: X.XLSX_MIME }));
  const a = document.createElement("a"); a.href = url; a.download = base + " kransjekk " + (o.navn || t("Tårnkran")).replace(/[\\/:*?"<>|]/g, "-") + ".xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  varsel(t("Kransjekken er lastet ned ({0} elementer).", svar.rader.length));
}

export async function lagMarkeringer(o) {
  const svar = tilstand.svar && tilstand.kranId === o.id ? tilstand.svar : await regn(o);
  if (!svar) return;
  const rode = svar.rader.filter(r => r.farge === "rod");
  if (!rode.length) { varsel(t("Ingen elementer over kapasitet.")); return; }
  if (rode.length > 30 && !confirm(t("Lage {0} markeringer?", rode.length))) return;
  const M = await import("./markers.js");
  const E = await import("./elements.js");
  const boxes = E.allElementBoxes();
  const laget = [];
  for (const r of rode) {
    const b = boxes.get(r.id); if (!b) continue;
    const c = b.getCenter(new THREE.Vector3());
    let gid = ""; try { const { metaFor } = await import("./ifcrpc.js"); gid = (metaFor(r.id) || {}).globalId || ""; } catch (_) {}
    const m = M.vaskMarkering({ id: M.nyId(), text: t("Kransjekk") + ": " + (r.navn || r.type) + "\n" + t("{0} kg med utstyr · radius {1} m · kapasitet {2} kg · {3} %", tusen(r.last), String(r.r).replace(".", ","), tusen(r.kap), String(r.utn).replace(".", ",")),
      author: M.innloggetNavn(), date: M.naaTekst(), status: "Åpen", x: c.x, y: c.y, z: c.z, globalId: gid, elementId: r.id });
    if (!m) continue;
    M.leggTilImportertMarkering(m); laget.push(m);
  }
  M.lagreOgSynk();
  if (S.pushAngre && laget.length) S.pushAngre({ tekst: t("Markeringer fra kransjekk"),
    angre: () => { laget.forEach(m => M.fjernImportertMarkering(m.id)); M.lagreOgSynk(); },
    gjenopprett: () => { laget.forEach(m => M.leggTilImportertMarkering(m)); M.lagreOgSynk(); } });
  varsel(t("{0} markeringer laget fra kransjekken.", laget.length));
}
