// 📄 Støpeplan — nedlastbar PDF og Excel (trinn 7). Oppsett D, valgt av Emil
// 01.10 av seks prøvebilder: plan ovenfra og 3D øverst, tidslinje over ukene
// i midten, full tabell nederst (areal, volum, injeksjonsslange, Cemflex med
// omlegg og plater), Storm-tittelfeltet over hele bredden.
//
// Ingen «ca» på tallene og ingen svinn eller ekstra betong (Emil 01.10): det
// varierer fra prosjekt til prosjekt, og brukeren legger det til selv. Arket
// sier i en linje nederst hva tallene er og ikke er.
//
// Den rene regningen (tabellen, ukene, filnavnet, Excel-radene) ligger i
// stopeplan-regn.js og testes i Node. Denne fila rører three.js og jsPDF, og
// lastes først når noen trykker på knappen (dynamisk import fra stopeplan.js).
import * as THREE from "three";
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { renderer, scene } from "./scene.js";
import { hentJsPDF, lastNedFil } from "./rapport.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { SRGB_TABELL } from "./rigg-regn.js";
import { elementBoxById } from "./elements.js";
import { iDagISO } from "./frist.js";
import {
  CEMFLEX_OMLEGG_M, STATUS_TEKST, dagerMellom, erGenerert, ganttUker, plussDager, sortert, statusFor,
  stopeplanExcelRader, stopeplanFilnavn, stopeplanTabell
} from "./stopeplan-regn.js";
import { innholdTekst } from "./stopeplan-tid.js";
import { stopeGroup, tegnStopeplan, feltBase, tilScene } from "./stopeplan-vis.js";
import { varsel } from "./varsel.js";

// Arket i mm (A3 liggende)
export const ARK = {
  b: 420, h: 297, marg: 12,
  toppY: 12, toppH: 16,
  bildeY: 30, bildeH: 100, planB: 236, mellom: 4,
  ganttY: 136, ganttH: 54, ganttEtikett: 52,
  tabellY: 196, radH: 6.2,
  tfH: 20
};
const PX_PER_MM = 6;
const SORT = "#14161a", GRÅ = "#6b7280", LINJE = "#c9ced6", STØPT_GRØNN = "#1b7f3b", UKE_GUL = "#b26a00";

function farge(d, hexFarge, felt) {
  const n = parseInt(String(hexFarge || "#000000").slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (felt === "fyll") d.setFillColor(r, g, b);
  else if (felt === "strek") d.setDrawColor(r, g, b);
  else d.setTextColor(r, g, b);
}
// Mellomrommet i «1 680» er et hardt mellomrom (U+00A0) fra toLocaleString.
// jsPDF måler det annerledes enn det tegner det, så m²-sifferet havnet feil.
const tall = (v, des) => (Math.round(v * Math.pow(10, des || 0)) / Math.pow(10, des || 0))
  .toLocaleString("no-NO", { minimumFractionDigits: des || 0, maximumFractionDigits: des || 0 }).replace(/[\u00a0\u202f]/g, " ");
const datoKort = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] : ""; };
const datoLang = (iso) => { const d = String(iso || "").split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}
// Logoen valgt i støpeplanpanelet (stopeLogoFil: faller tilbake på
// rapportens valg) — originalbildet fra SharePoint, aldri en gjenskaping.
// Uten innlogging eller uten valgt logo: Storm-navnet som tekst.
async function finnLogo() {
  try {
    const husket = S.stopeLogoFil ? S.stopeLogoFil() : (S.settings && S.settings.rapLogo);
    if (!husket) return null;
    const liste = await hentLogoer();
    const l = liste.find(x => x.fil === husket);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}

// ═══════════════════════ BILDENE ═══════════════════════
// 🧱 Emil 01.10: BARE det som skal støpes kommer med — ikke veggelementer,
// tak, resten av modellen, rutenett, markeringer, mål eller riggen. Den som
// leser støpeplanen skal se ringmuren og dekket, ikke lete etter dem bak
// veggene. Etappefargene tegnes ugjennomsiktige (på hvitt ark ville 38 %
// gjennomsiktighet bli nesten borte); planlagte etapper blir i stedet en
// lysere utgave av fargen, og alle får en tynn mørk kontur så kantene leses.
export const PDF_LYSNING = { stopt: 0, uke: 0.15, forsinket: 0.15, planlagt: 0.5 };
function medBareBygget(fn) {
  const synlig = [];
  for (const o of scene.children) {
    if (o.isLight || o === stopeGroup) continue;
    synlig.push([o, o.visible]);
    o.visible = false;
  }
  const varVis = stopeGroup.visible;
  stopeGroup.visible = true;
  const mat = [], ekstra = [];
  const hvit = new THREE.Color(0xffffff);
  for (const m of stopeGroup.children) {
    if (!m.isMesh || !m.material || m.userData.etappeId == null || m.material.depthTest === false) continue;
    const e = (S.stopeplan || []).find(x => x.id === m.userData.etappeId);
    const lys = PDF_LYSNING[e ? statusFor(e, iDagISO()) : "planlagt"] || 0;
    const M = m.material;
    mat.push([M, { transparent: M.transparent, opacity: M.opacity, depthWrite: M.depthWrite, color: M.color.clone() }]);
    M.transparent = false; M.opacity = 1; M.depthWrite = true;
    M.color.lerp(hvit, lys);
    M.needsUpdate = true;
    if (m.userData.feltId == null) {
      try {
        const k = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25),
          new THREE.LineBasicMaterial({ color: 0x333333 }));
        k.renderOrder = 3;
        stopeGroup.add(k); ekstra.push(k);
      } catch (_) {}
    }
  }
  const bak = scene.background;
  scene.background = new THREE.Color(0xffffff);
  if (S.skjulVaer3D) S.skjulVaer3D(true);   // 🌦 ingen dis eller dempet lys på arket
  try { return fn(); }
  finally {
    for (const k of ekstra) { stopeGroup.remove(k); k.geometry.dispose(); k.material.dispose(); }
    for (const [M, v] of mat) { M.transparent = v.transparent; M.opacity = v.opacity; M.depthWrite = v.depthWrite; M.color.copy(v.color); M.needsUpdate = true; }
    stopeGroup.visible = varVis;
    for (const [o, v] of synlig) o.visible = v;
    scene.background = bak;
    if (S.skjulVaer3D) S.skjulVaer3D(false);
    renderer.setRenderTarget(null);
  }
}

function render(kam, W, H) {
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, kam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const bilde = g.createImageData(W, H);
    // WebGL leser nedenfra og opp, og i lineære farger
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((H - 1 - y) * W + x) * 4, j = (y * W + x) * 4;
      bilde.data[j] = SRGB_TABELL[px[i]]; bilde.data[j + 1] = SRGB_TABELL[px[i + 1]];
      bilde.data[j + 2] = SRGB_TABELL[px[i + 2]]; bilde.data[j + 3] = 255;
    }
    g.putImageData(bilde, 0, 0);
    return c.toDataURL("image/jpeg", 0.92);
  } finally { rt.dispose(); }
}

// Rammen er det som skal støpes (ikke hele bygget), så ringmuren fyller
// bildet. Tom støpeplan: hele modellen, så arket ikke blir et punkt.
function byggBoks() {
  const b = new THREE.Box3().setFromObject(stopeGroup);
  if (!b.isEmpty()) return b;
  if (S.modelGroup) b.setFromObject(S.modelGroup);
  return b;
}

// Rett ovenfra, ortografisk, med −z opp (samme vei som «Topp» i kuben).
function kameraOvenfra(boks, aspekt) {
  const c = boks.getCenter(new THREE.Vector3()), s = boks.getSize(new THREE.Vector3());
  let w = s.x * 1.06, h = s.z * 1.06;
  if (w / h > aspekt) h = w / aspekt; else w = h * aspekt;
  const kam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, s.y * 4 + 100);
  kam.position.set(c.x, boks.max.y + s.y + 10, c.z);
  kam.up.set(0, 0, -1);
  kam.lookAt(c);
  kam.updateMatrixWorld(true); kam.updateProjectionMatrix();
  return kam;
}
// Skrått fra sørvest, hele bygget i bildet
function kamera3D(boks, aspekt) {
  const c = boks.getCenter(new THREE.Vector3()), s = boks.getSize(new THREE.Vector3());
  const kam = new THREE.PerspectiveCamera(35, aspekt, 0.1, 1e5);
  const r = Math.max(s.x, s.z, s.y) * 1.25 + 1;
  kam.position.set(c.x - r * 0.75, c.y + r * 0.7, c.z + r * 0.95);
  kam.lookAt(c);
  kam.updateMatrixWorld(true); kam.updateProjectionMatrix();
  return kam;
}

function swBoks(sw) {
  const tr = S.swTrekanter ? S.swTrekanter([sw]) : null;
  if (!tr || !tr.length) return null;
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i + 2 < tr.length; i += 3) b.expandByPoint(v.set(tr[i], tr[i + 1], tr[i + 2]));
  return b;
}

// Hvor etappens nummerbrikke skal stå i planen (verdenskoordinater): midten
// av hvert felt, ellers midten av elementene.
function brikkePunkter(e) {
  const ut = [];
  feltBase();
  for (const f of e.felt || []) {
    let x = 0, z = 0;
    for (const p of f.punkter) { x += p[0]; z += p[1]; }
    const p = tilScene(x / f.punkter.length, z / f.punkter.length, f.by);
    if (p) ut.push(p);
  }
  if (!ut.length) {
    // Midten av det STØRSTE elementet — ikke av alle samlet: to vegger i et
    // L har sin felles midte ute på plata, oppå et annet felt.
    let best = null, bestV = -1;
    for (const x of e.elementer || []) {
      // Generert betong (ringmur, gulv) finnes ikke i modellen — boksen
      // regnes av trekantene fra SW-laget
      const eb = erGenerert(x) ? swBoks(x.sw) : elementBoxById(Number(x.id));
      if (!eb || eb.isEmpty()) continue;
      const sz = eb.getSize(new THREE.Vector3()), v = sz.x * sz.z + sz.y * 0.01;
      if (v > bestV) { bestV = v; best = eb; }
    }
    if (best) ut.push(best.getCenter(new THREE.Vector3()));
  }
  return ut;
}

// Innhold-kolonnen på brukerens språk (regnemodulen gir den bare på norsk)
function medInnhold(tab) {
  for (const r of tab.rader) r.innhold = innholdTekst(r.nEl, r.nF);
  return tab;
}

// ═══════════════════════ HOVEDFUNKSJONEN ═══════════════════════
export async function lagStopeplanPdf(volumFor) {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return null; }
  const vis = (tekst) => { if (loadingEl) { loadingEl.classList.add("open"); if (loadingText) loadingText.textContent = tekst; } };
  try {
    vis(t("Tegner støpeplanen …"));
    const iDag = iDagISO();
    // Arket viser planen I DAG, uansett hvor tidslinjen på skjermen står
    const vistPerFor = S.stopeVistPer;
    S.stopeVistPer = null;
    tegnStopeplan();
    const R = ARK;
    const planB = R.planB, planH = R.bildeH, tdB = R.b - 2 * R.marg - planB - R.mellom;
    const boks = byggBoks();
    const kamPlan = kameraOvenfra(boks, planB / planH);
    const kam3d = kamera3D(boks, tdB / planH);
    const bilder = medBareBygget(() => ({
      plan: render(kamPlan, Math.round(planB * PX_PER_MM), Math.round(planH * PX_PER_MM)),
      tre: render(kam3d, Math.round(tdB * PX_PER_MM), Math.round(planH * PX_PER_MM))
    }));
    // Brikkene: projisert inn i planbildet
    const brikker = [];
    for (const e of sortert(S.stopeplan)) for (const p of brikkePunkter(e)) {
      const q = p.clone().project(kamPlan);
      if (Math.abs(q.x) > 1 || Math.abs(q.y) > 1) continue;
      const b = { nr: e.nr, farge: e.farge, stopt: statusFor(e, iDag) === "stopt",
        x: R.marg + (q.x + 1) / 2 * planB, y: R.bildeY + (1 - q.y) / 2 * planH };
      // To brikker oppå hverandre: den neste flyttes ned til den står fritt
      // …og aldri ut over kanten av bildet
      b.x = Math.min(R.marg + planB - 7, Math.max(R.marg + 7, b.x));
      b.y = Math.min(R.bildeY + planH - 7, Math.max(R.bildeY + 7, b.y));
      for (let k = 0; k < 6 && brikker.some(o => Math.hypot(o.x - b.x, o.y - b.y) < 12); k++) b.y = b.y + 12 > R.bildeY + planH - 7 ? b.y - 24 : b.y + 12;
      brikker.push(b);
    }
    S.stopeVistPer = vistPerFor;
    tegnStopeplan();

    const tab = medInnhold(stopeplanTabell(S.stopeplan, volumFor, S.stopePlateM || 2, iDag));
    const uker = ganttUker(S.stopeplan, iDag);
    const logo = await finnLogo();
    vis(t("Henter PDF-biblioteket …"));
    const jsPDF = await hentJsPDF();
    const d = tegnArk(jsPDF, {
      bilder, brikker, tab, uker, iDag, logo, planB, tdB,
      modell: String(S.fileName || "").replace(/\.(ifc|glb)$/i, ""),
      // 🗂 Prosjektinfo (Innstillinger): «20652 Byggeprosjekt» i tittelfeltet
      prosjekt: (() => { const pi = S.prosjektInfo ? S.prosjektInfo() : {}; return [pi.nummer, pi.navn].filter(Boolean).join(" "); })(),
      av: mittNavn(), plateM: S.stopePlateM || 2
    });
    lastNedFil(d.output("blob"), stopeplanFilnavn(S.fileName, iDag, "pdf"));
    return { etapper: tab.rader.length, brikker: brikker.length, sider: d.getNumberOfPages() };
  } catch (err) {
    console.warn("Støpeplan-PDF feilet:", err);
    varsel(t("Klarte ikke å lage støpeplanen: {0}", err.message));
    return null;
  } finally {
    if (loadingEl) loadingEl.classList.remove("open");
  }
}

// ═══════════════════════ ARKET ═══════════════════════
// m² og m³: Helvetica i jsPDF har ikke ² og ³, og de ble borte (bare «m»).
// Sifferet tegnes derfor selv, mindre og hevet. `opt.align` som i d.text.
function tekst(d, s, x, y, opt) {
  s = String(s);
  const m = s.match(/^(.*m)([²³])$/);
  if (!m) { d.text(s, x, y, opt); return; }
  const fs = d.getFontSize(), sup = m[2] === "²" ? "2" : "3";
  const wHoved = d.getTextWidth(m[1]);
  d.setFontSize(fs * 0.65);
  const wSup = d.getTextWidth(sup);
  d.setFontSize(fs);
  const venstre = opt && opt.align === "right" ? x - wHoved - wSup : opt && opt.align === "center" ? x - (wHoved + wSup) / 2 : x;
  d.text(m[1], venstre, y);
  d.setFontSize(fs * 0.65);
  d.text(sup, venstre + wHoved, y - fs * 0.35 * 0.3528 * 0.9);
  d.setFontSize(fs);
}

function tegnArk(jsPDF, m) {
  const R = ARK;
  const d = new jsPDF({ unit: "mm", format: "a3", orientation: "landscape" });
  d.setLineHeightFactor(1.15);
  const B = R.b - 2 * R.marg;

  const ramme = () => { farge(d, SORT, "strek"); d.setLineWidth(0.5); d.rect(R.marg - 4, R.marg - 4, R.b - 2 * R.marg + 8, R.h - 2 * R.marg + 8); };
  const topp = (side) => {
    farge(d, SORT); d.setFont("helvetica", "bold"); d.setFontSize(20);
    d.text(t("STØPEPLAN") + (side > 1 ? " — " + t("forts.") : ""), R.marg, R.toppY + 7);
    d.setFont("helvetica", "normal"); d.setFontSize(10); farge(d, GRÅ);
    const ukeTekst = m.uker ? " · " + t("uke {0}–{1}", m.uker.uker[0].nr, m.uker.uker[m.uker.uker.length - 1].nr) : "";
    d.text(m.modell + " · " + t("per {0}", datoLang(m.iDag)) + ukeTekst, R.marg, R.toppY + 13);
  };
  ramme(); topp(1);

  // --- Plan og 3D ---
  d.addImage(m.bilder.plan, "JPEG", R.marg, R.bildeY, m.planB, R.bildeH);
  d.addImage(m.bilder.tre, "JPEG", R.marg + m.planB + R.mellom, R.bildeY, m.tdB, R.bildeH);
  farge(d, SORT, "strek"); d.setLineWidth(0.3);
  d.rect(R.marg, R.bildeY, m.planB, R.bildeH);
  d.rect(R.marg + m.planB + R.mellom, R.bildeY, m.tdB, R.bildeH);
  d.setFont("helvetica", "bold"); d.setFontSize(9); farge(d, SORT);
  // Merkelappene på hvit bunn, så de kan leses oppå fargen
  for (const [tx, lx] of [[t("Plan ovenfra"), R.marg], [t("3D — per {0}", datoKort(m.iDag)), R.marg + m.planB + R.mellom]]) {
    farge(d, "#ffffff", "fyll"); d.rect(lx + 0.3, R.bildeY + 0.3, d.getTextWidth(tx) + 4, 6, "F");
    d.text(tx, lx + 2, R.bildeY + 4.5);
  }
  for (const b of m.brikker) {
    const r = 5.5;
    d.setLineWidth(0.9);
    farge(d, b.farge, "strek");
    farge(d, b.stopt ? b.farge : "#ffffff", "fyll");
    d.circle(b.x, b.y, r, "FD");
    d.setLineWidth(0.25); farge(d, SORT, "strek"); d.circle(b.x, b.y, r + 0.55, "S");
    d.setFont("helvetica", "bold"); d.setFontSize(15);
    farge(d, b.stopt ? "#ffffff" : SORT);
    d.text(String(b.nr), b.x, b.y + 1.9, { align: "center" });
  }

  // --- Tidslinjen ---
  const gx = R.marg, gy = R.ganttY, gB = B, gH = R.ganttH;
  farge(d, SORT, "strek"); d.setLineWidth(0.4); d.rect(gx, gy, gB, gH);
  const rader = m.tab.rader;
  if (m.uker && rader.length) {
    const x0 = gx + R.ganttEtikett, bredde = gB - R.ganttEtikett - 4;
    const dager = Math.max(1, dagerMellom(m.uker.fra, m.uker.til));
    const xFor = (iso) => x0 + dagerMellom(m.uker.fra, iso) / dager * bredde;
    d.setFont("helvetica", "normal"); d.setFontSize(8);
    for (const u of m.uker.uker) {
      const x = xFor(u.mandag);
      farge(d, LINJE, "strek"); d.setLineWidth(0.2); d.line(x, gy + 7, x, gy + gH - 2);
      farge(d, GRÅ); d.text(t("Uke {0} · {1}", u.nr, datoKort(u.mandag)), x + 1, gy + 5);
    }
    const radH = Math.min(8, (gH - 10) / rader.length);
    rader.forEach((r, i) => {
      const y = gy + 8 + i * radH;
      d.setFontSize(Math.min(9, radH * 1.6)); farge(d, SORT);
      tekst(d, (r.nr + " " + r.navn).slice(0, 34) + " · " + tall(r.volum, 1) + " m³", gx + 3, y + radH * 0.7);
      const nar = r.stoptDato || r.dato;
      if (!nar) return;
      const bx = xFor(nar), bb = Math.max(3, bredde / dager * 1.6), bh = Math.max(2, radH - 1.6);
      const stopt = r.status === "stopt";
      d.setLineWidth(0.7); farge(d, r.farge, "strek"); farge(d, stopt ? r.farge : "#ffffff", "fyll");
      d.roundedRect(bx, y + 0.5, bb, bh, 0.8, 0.8, "FD");
      d.setFont("helvetica", "bold"); d.setFontSize(Math.min(8, bh * 2)); farge(d, stopt ? "#ffffff" : SORT);
      d.text(String(r.nr), bx + 1, y + 0.5 + bh * 0.72);
      d.setFont("helvetica", "normal");
    });
    // I dag
    const xi = xFor(m.iDag);
    farge(d, UKE_GUL, "strek"); d.setLineWidth(0.5); d.line(xi, gy + 6.5, xi, gy + gH - 2);
    d.setFontSize(7); farge(d, UKE_GUL); d.text(t("i dag {0}", datoKort(m.iDag)), xi + 1, gy + 9);
  } else {
    d.setFontSize(10); farge(d, GRÅ); d.text(t("Ingen etapper har dato ennå — tidslinjen er tom."), gx + 4, gy + gH / 2);
  }

  // --- Tabellen (fortsetter på neste side når den ikke får plass) ---
  const kol = [
    { k: "nr", t: "Nr", b: 14 }, { k: "navn", t: t("Etappe"), b: 64 }, { k: "innhold", t: t("Innhold"), b: 46 },
    { k: "dato", t: t("Dato"), b: 26 }, { k: "status", t: t("Status"), b: 40 },
    { k: "areal", t: t("Areal"), b: 34, h: true }, { k: "volum", t: t("Volum"), b: 34, h: true },
    { k: "injeksjon", t: t("Injeksjon"), b: 36, h: true }, { k: "cemflex", t: t("Cemflex"), b: 36, h: true },
    { k: "plater", t: t("Plater"), b: 0, h: true }
  ];
  const fast = kol.reduce((s, c) => s + c.b, 0);
  kol[kol.length - 1].b = B - fast;
  const celle = (r, k) => {
    if (k === "nr") return String(r.nr);
    if (k === "navn") return r.navn;
    if (k === "innhold") return r.innhold;
    if (k === "dato") return r.dato ? datoLang(r.dato) : "–";
    if (k === "status") return r.status === "stopt" && r.stoptDato ? t("Støpt {0}", datoKort(r.stoptDato)) : t(STATUS_TEKST[r.status]);
    if (k === "areal") return r.areal ? tall(r.areal, 1) + " m²" : "–";
    if (k === "volum") return r.volum ? tall(r.volum, 1) + " m³" : "–";
    if (k === "injeksjon") return r.injeksjon ? tall(r.injeksjon, 1) + " lm" : "–";
    if (k === "cemflex") return r.cemflex ? tall(r.cemflex, 1) + " lm" : "–";
    if (k === "plater") return r.plater ? String(r.plater) : "–";
    return "";
  };
  const tfY = R.h - R.marg - R.tfH;
  const tabellHode = (y) => {
    farge(d, SORT, "fyll"); d.rect(R.marg, y, B, R.radH, "F");
    d.setFont("helvetica", "bold"); d.setFontSize(9); farge(d, "#ffffff");
    let x = R.marg;
    for (const c of kol) { d.text(c.t, c.h ? x + c.b - 2 : x + 2, y + R.radH * 0.68, { align: c.h ? "right" : "left" }); x += c.b; }
    return y + R.radH;
  };
  let y = tabellHode(R.tabellY);
  let side = 1;
  const sisteY = tfY - 12;
  for (const r of rader) {
    if (y + R.radH > sisteY) {
      tittelfelt(d, m, side);
      d.addPage("a3", "landscape"); side++;
      ramme(); topp(side);
      y = tabellHode(R.bildeY);
    }
    d.setFont("helvetica", "normal"); d.setFontSize(9.5);
    let x = R.marg;
    for (const c of kol) {
      const innhold = celle(r, c.k);
      if (c.k === "nr") { farge(d, r.farge, "fyll"); farge(d, SORT, "strek"); d.setLineWidth(0.2); d.rect(x + 2, y + 1.4, 3.4, 3.4, "FD"); }
      if (c.k === "status") farge(d, r.status === "stopt" ? STØPT_GRØNN : r.status === "uke" || r.status === "forsinket" ? UKE_GUL : GRÅ);
      else farge(d, SORT);
      if (c.k === "status") d.setFont("helvetica", "bold");
      tekst(d, String(innhold).slice(0, 42), c.h ? x + c.b - 2 : x + (c.k === "nr" ? 7 : 2), y + R.radH * 0.68, { align: c.h ? "right" : "left" });
      d.setFont("helvetica", "normal");
      x += c.b;
    }
    farge(d, LINJE, "strek"); d.setLineWidth(0.15); d.line(R.marg, y + R.radH, R.marg + B, y + R.radH);
    y += R.radH;
  }
  // Sum
  d.setFont("helvetica", "bold"); d.setFontSize(9.5); farge(d, SORT);
  const s = m.tab.sum;
  const sumTekst = { navn: t("Sum"), areal: s.areal ? tall(s.areal, 1) + " m²" : "–", volum: s.volum ? tall(s.volum, 1) + " m³" : "–",
    injeksjon: s.injeksjon ? tall(s.injeksjon, 1) + " lm" : "–", cemflex: s.cemflex ? tall(s.cemflex, 1) + " lm" : "–", plater: s.plater ? String(s.plater) : "–" };
  let x = R.marg;
  for (const c of kol) {
    if (sumTekst[c.k] !== undefined) tekst(d, sumTekst[c.k], c.h ? x + c.b - 2 : x + 2, y + R.radH * 0.68, { align: c.h ? "right" : "left" });
    x += c.b;
  }
  farge(d, SORT, "strek"); d.setLineWidth(0.3); d.line(R.marg, y + R.radH, R.marg + B, y + R.radH);
  y += R.radH + 4;
  d.setFont("helvetica", "normal"); d.setFontSize(8); farge(d, GRÅ);
  d.text(t("Volum fra modellen (elementer) og felt × tykkelse, uten svinn eller ekstra betong. Cemflex VB 150, plater à {0} m, minst 5 cm omlegg per skjøt. Injeksjonsslange uten skjøt.",
    String(m.plateM).replace(".", ",")), R.marg, Math.min(y, sisteY + 5));
  tittelfelt(d, m, side);
  // «side x av y» kjenner vi først nå
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    d.setFont("helvetica", "normal"); d.setFontSize(9); farge(d, SORT);
    d.text(t("A3 liggende · side {0} av {1}", i, n), R.b - R.marg - 3, R.h - R.marg - 3, { align: "right" });
  }
  return d;
}

function tittelfelt(d, m, side) {
  const R = ARK, B = R.b - 2 * R.marg, y = R.h - R.marg - R.tfH;
  farge(d, SORT, "strek"); d.setLineWidth(0.5); d.rect(R.marg, y, B, R.tfH);
  const kol = [{ b: 52 }, { b: 110, k: m.prosjekt ? t("Prosjekt") : t("Modell"), v: m.prosjekt || m.modell }, { b: 66, k: t("Tegning"), v: t("Støpeplan") },
    { b: 52, k: t("Dato"), v: datoLang(m.iDag) }, { b: 66, k: t("Tegnet av"), v: m.av || "–" }, { b: 0, k: t("Ark"), v: "" }];
  kol[kol.length - 1].b = B - kol.reduce((s, c) => s + c.b, 0);
  let x = R.marg;
  kol.forEach((c, i) => {
    if (i) { d.setLineWidth(0.3); d.line(x, y, x, y + R.tfH); }
    if (i === 0) {
      if (m.logo) {
        const f = Math.min((c.b - 6) / m.logo.b, (R.tfH - 6) / m.logo.h);
        try { d.addImage(m.logo.data, m.logo.format || "PNG", x + (c.b - m.logo.b * f) / 2, y + (R.tfH - m.logo.h * f) / 2, m.logo.b * f, m.logo.h * f); } catch (_) {}
      } else { d.setFont("helvetica", "bold"); d.setFontSize(14); farge(d, SORT); d.text("STORM", x + c.b / 2, y + R.tfH / 2 + 2, { align: "center" }); }
    } else {
      d.setFont("helvetica", "normal"); d.setFontSize(7); farge(d, GRÅ); d.text(c.k.toUpperCase(), x + 2.5, y + 4.5);
      d.setFont("helvetica", "bold"); d.setFontSize(10); farge(d, SORT); d.text(String(c.v).slice(0, 60), x + 2.5, y + 10);
    }
    x += c.b;
  });
}

// ═══════════════════════ EXCEL ═══════════════════════
export async function lagStopeplanXlsx(volumFor) {
  const iDag = iDagISO();
  const tab = medInnhold(stopeplanTabell(S.stopeplan, volumFor, S.stopePlateM || 2, iDag));
  const rader = stopeplanExcelRader(tab, (s) => t(STATUS_TEKST[s] || s));
  rader.push([]);
  rader.push([t("Volum fra modellen (elementer) og felt × tykkelse, uten svinn eller ekstra betong. Cemflex VB 150, plater à {0} m, minst 5 cm omlegg per skjøt. Injeksjonsslange uten skjøt.",
    String(S.stopePlateM || 2).replace(".", ","))]);
  const { lagXlsx, XLSX_MIME } = await import("./xlsx.js");
  const data = lagXlsx(t("Støpeplan"), rader);
  lastNedFil(new Blob([data], { type: XLSX_MIME }), stopeplanFilnavn(S.fileName, iDag, "xlsx"));
  return rader.length;
}

export { CEMFLEX_OMLEGG_M, plussDager };
