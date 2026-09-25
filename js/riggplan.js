// 📄 Riggplan — nedlastbar PDF (trinn 6). Emils bestilling: «Nedlastbar PDF
// som heter "riggplan" som er en pdf med bilder av området sett ovenfra fra
// nord til sør, og en sideseksjon som beskriver hva de forskjellige objektene
// i tegningen betyr.» Tolket som: sett rett ovenfra med NORD OPP.
//
// Arket (A3 liggende, Emil 25.09):
//   ┌──────────────────────────────────────┬──────────────┐
//   │ tomta ovenfra, nord opp              │ Tegnforklar- │
//   │ (nummerringer ved hvert objekt,      │ ing: nr,     │
//   │  nordpil, skalastrek, kartkilde)     │ farge, navn, │
//   │                                      │ antall, hva  │
//   ├──────────────────────────────────────┴──────────────┤
//   │ logo │ RIGGPLAN · modell │ prosjekt/adresse │ dato, målestokk, laget av │
//   └─────────────────────────────────────────────────────┘
//
// Bildet tegnes med et ORTOGRAFISK kamera rett ovenfra, i en rund målestokk
// (1:500, 1:1000 …), så planen kan måles på med linjal. Kameraet dreies så
// nord er opp: terrenget er rotert med byggets plass.rot, og uten den
// dreiningen ville nord stått skjevt på arket.
//
// Den rene regningen (målestokk, skalastrek, tegnforklaring, filnavn) ligger i
// rigg-regn.js og testes i Node. Denne fila rører DOM, three.js og jsPDF, og
// lastes først når noen trykker på knappen (dynamisk import fra rigg.js).
import * as THREE from "three";
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { grid, renderer, scene } from "./scene.js";
import { hentJsPDF, lastNedFil, norskDato } from "./rapport.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import {
  RIGGPLAN, nordOgOst, riggObjekter, riggplanFilnavn, riggplanTegnforklaring, skalaStrek, velgMalestokk
} from "./rigg-regn.js";
import { aktivRef, finnRiggObjekt, riggBase, riggGroup } from "./rigg-vis.js";

const PX_PER_MM = 7;          // bildets oppløsning: 292 mm → ~2000 px
const GRÅ = "#6b7280", SORT = "#14161a", STREK = "#9aa1ab";

function hex(d, farge, felt) {
  const n = parseInt(String(farge).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (felt === "fyll") d.setFillColor(r, g, b);
  else if (felt === "strek") d.setDrawColor(r, g, b);
  else d.setTextColor(r, g, b);
}

// Boksen rundt alt som er TEGNET i en gruppe — uten navnelapper (sprites),
// som ellers ville blåst opp utstrekningen.
function boksUtenLapper(rot) {
  const boks = new THREE.Box3(), b = new THREE.Box3();
  rot.updateMatrixWorld(true);
  rot.traverse(o => {
    if (!o.isMesh || o.isSprite || !o.visible || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    boks.union(b);
  });
  return boks;
}

function hjorner(boks) {
  const ut = [];
  for (const x of [boks.min.x, boks.max.x]) for (const z of [boks.min.z, boks.max.z]) ut.push({ x, z });
  return ut;
}

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

// Samme logo som rapportene (valgt i rapportmenyen) — originalbildet fra
// SharePoint, aldri en gjenskaping. Uten innlogging: tekst.
async function finnLogo() {
  try {
    const husket = S.settings && S.settings.rapLogo;
    if (!husket) return null;
    const liste = await hentLogoer();
    const l = liste.find(x => x.fil === husket);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}

// ═══════════════════════ BILDET ═══════════════════════
// Returnerer { data, kamera, bredde, hoyde } — kameraet trengs for å legge
// nummerringene på riktig sted på arket.
function tegnOvenfra(senter, nord, bredde, hoyde, toppY, bunnY, pxB, pxH, skala) {
  // Langt nok ned til at terrenget under bygget kommer med, også i en bratt
  // skråning (500 m under bunnen av bygget er mer enn noen tomt).
  const kam = new THREE.OrthographicCamera(-bredde / 2, bredde / 2, hoyde / 2, -hoyde / 2, 0.01, (toppY - bunnY) * 3 + 500 / (skala || 1));
  kam.up.set(nord.x, 0, nord.z);
  kam.position.set(senter.x, toppY + (toppY - bunnY) + 1, senter.z);
  kam.lookAt(senter.x, bunnY, senter.z);
  kam.updateProjectionMatrix();
  kam.updateMatrixWorld(true);

  // Alt som hører skjermen til, skjules for bildet: navnelapper (sprites),
  // skjøteprikker og håndtak. Settes tilbake i finally, uansett hva som skjer.
  const skjult = [];
  scene.traverse(o => {
    if (o.visible && (o.isSprite || o.name === "rigg-skjoter")) { skjult.push(o); o.visible = false; }
  });
  const gammelBg = scene.background ? scene.background.clone() : null;
  const gammeltRutenett = grid.visible;
  const gammelt = renderer.getRenderTarget();
  // Lyset i scenen er satt for skrått innsyn: sett rett ovenfra fikk takene
  // lite lys, og fargene ble mørke og grumsete på papiret (første prøve
  // 25.09 — den oransje pila ble brun). Et ekstra, jevnt lys for bildet gir
  // fargene i tegnforklaringen.
  const utskriftsLys = new THREE.HemisphereLight(0xffffff, 0xdddddd, 1.1);
  scene.add(utskriftsLys);
  let rt = null;
  try {
    if (scene.background) scene.background.set(0xffffff);
    grid.visible = false;
    if (S.outlineOpplosning) S.outlineOpplosning(pxB, pxH);
    rt = new THREE.WebGLRenderTarget(pxB, pxH);
    renderer.setRenderTarget(rt);
    renderer.render(scene, kam);
    const px = new Uint8Array(pxB * pxH * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, pxB, pxH, px);
    const c = document.createElement("canvas");
    c.width = pxB; c.height = pxH;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(pxB, pxH);
    for (let y = 0; y < pxH; y++) img.data.set(px.subarray((pxH - 1 - y) * pxB * 4, (pxH - y) * pxB * 4), y * pxB * 4);
    ctx.putImageData(img, 0, 0);
    return { data: c.toDataURL("image/jpeg", 0.9), kamera: kam };
  } finally {
    renderer.setRenderTarget(gammelt);
    scene.remove(utskriftsLys);
    if (rt) rt.dispose();
    if (gammelBg && scene.background) scene.background.copy(gammelBg);
    grid.visible = gammeltRutenett;
    for (const o of skjult) o.visible = true;
  }
}

// ═══════════════════════ HOVEDINNGANGEN ═══════════════════════
export async function lastNedRiggplan() {
  const base = riggBase();
  if (!base) { alert(t("Åpne en modell først.")); return null; }
  const objekter = riggObjekter(S.rigg || []).filter(o => !o.skjult);
  if (!objekter.length) { alert(t("Legg inn noe rigg først — planen er tom.")); return null; }
  const vis = (tekst) => { if (loadingText) loadingText.textContent = tekst; };
  if (loadingEl) loadingEl.classList.add("open");
  try {
    vis(t("Lager riggplan …"));
    // Nord: fra terrenget (levende), ellers siste kjente plassering. Uten
    // noen av dem finnes ingen ekte nordretning — da står modellens −Z opp,
    // og arket sier fra.
    const live = S.terrengRef ? S.terrengRef() : null;
    const ref = aktivRef();
    const nordKjent = !!ref;
    const { nord, ost } = nordOgOst(ref ? ref.plass.rot : 0);

    // Utstrekningen: riggen og bygget, målt langs øst og nord (meter).
    const bokser = [boksUtenLapper(riggGroup)];
    if (S.modelGroup) bokser.push(new THREE.Box3().setFromObject(S.modelGroup));
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, toppY = -Infinity, bunnY = Infinity;
    for (const b of bokser) {
      if (b.isEmpty()) continue;
      toppY = Math.max(toppY, b.max.y); bunnY = Math.min(bunnY, b.min.y);
      for (const p of hjorner(b)) {
        const dx = (p.x - base.c.x) * base.skala, dz = (p.z - base.c.z) * base.skala;
        const e = dx * ost.x + dz * ost.z, n = dx * nord.x + dz * nord.z;
        minE = Math.min(minE, e); maxE = Math.max(maxE, e); minN = Math.min(minN, n); maxN = Math.max(maxN, n);
      }
    }
    if (!isFinite(minE)) throw new Error(t("Fant ingenting å tegne."));
    const marg = Math.max(5, 0.08 * Math.max(maxE - minE, maxN - minN));
    const bM = maxE - minE + 2 * marg, hM = maxN - minN + 2 * marg;
    const skala = velgMalestokk(bM, hM, RIGGPLAN.bildeB, RIGGPLAN.bildeH);
    // Bildet dekker HELE bildefeltet i den runde målestokken
    const rammeB = RIGGPLAN.bildeB * skala / 1000, rammeH = RIGGPLAN.bildeH * skala / 1000;
    const mE = (minE + maxE) / 2, mN = (minN + maxN) / 2;
    const senter = new THREE.Vector3(
      base.c.x + (mE * ost.x + mN * nord.x) / base.skala, 0,
      base.c.z + (mE * ost.z + mN * nord.z) / base.skala);
    const pxB = Math.round(RIGGPLAN.bildeB * PX_PER_MM), pxH = Math.round(RIGGPLAN.bildeH * PX_PER_MM);
    const bilde = tegnOvenfra(senter, nord, rammeB / base.skala, rammeH / base.skala, toppY, bunnY, pxB, pxH, base.skala);

    // Nummerringene: midten av hvert objekt, projisert inn på arket
    const forklaring = riggplanTegnforklaring(S.rigg || [], t);
    const nrFor = new Map(forklaring.map(r => [r.type, r.nr]));
    const ringer = [];
    for (const o of objekter) {
      const g = finnRiggObjekt(o.id);
      if (!g) continue;
      // Gjerdet og pilene: ringen på midten av første stykke — midten av
      // boksen ville vært midt inne i bygget, langt fra selve gjerdet.
      let v;
      if (o.punkter && g.children[0]) {
        const a = o.punkter[0], b2 = o.punkter[1];
        const h = (g.userData.hoyder && g.userData.hoyder[0]) || 0;
        g.updateMatrixWorld(true);
        v = g.children[0].localToWorld(new THREE.Vector3((a.x + b2.x) / 2, h + 1, (a.z + b2.z) / 2));
      } else {
        const b = boksUtenLapper(g);
        if (b.isEmpty()) continue;
        v = b.getCenter(new THREE.Vector3());
      }
      v.project(bilde.kamera);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      ringer.push({ nr: nrFor.get(o.type), x: RIGGPLAN.marg + (v.x + 1) / 2 * RIGGPLAN.bildeB, y: RIGGPLAN.marg + (1 - v.y) / 2 * RIGGPLAN.bildeH });
    }

    const logo = await finnLogo();
    vis(t("Henter PDF-biblioteket …"));
    const jsPDF = await hentJsPDF();
    const iDag = new Date().toISOString().slice(0, 10);
    const d = tegnArk(jsPDF, {
      bilde, ringer, forklaring, skala, nordKjent, logo, iDag,
      kartkilde: !!(live && live.synlig),
      modell: String(S.fileName || "").replace(/\.(ifc|glb)$/i, ""),
      prosjekt: S.lettProsjekt || "",
      adresse: (live && live.adresse) || "",
      av: mittNavn()
    });
    lastNedFil(d.output("blob"), riggplanFilnavn(S.fileName, iDag));
    return { skala, ringer: ringer.length, rader: forklaring.length };
  } catch (err) {
    console.warn("Riggplanen feilet:", err);
    alert(t("Klarte ikke å lage riggplanen: {0}", err.message));
    return null;
  } finally {
    if (loadingEl) loadingEl.classList.remove("open");
  }
}

// ═══════════════════════ ARKET ═══════════════════════
function tegnArk(jsPDF, m) {
  const R = RIGGPLAN;
  const d = new jsPDF({ unit: "mm", format: "a3", orientation: "landscape" });
  const x0 = R.marg, y0 = R.marg;
  d.setLineWidth(0.3);

  // ── Bildet ──
  d.addImage(m.bilde.data, "JPEG", x0, y0, R.bildeB, R.bildeH);
  hex(d, SORT, "strek"); d.rect(x0, y0, R.bildeB, R.bildeH);

  // Nummerringene
  d.setFontSize(7); d.setFont(undefined, "bold");
  for (const r of m.ringer) {
    hex(d, "#ffffff", "fyll"); hex(d, SORT, "strek"); d.setLineWidth(0.35);
    d.circle(r.x, r.y, 2.4, "FD");
    hex(d, SORT); d.text(String(r.nr), r.x, r.y + 0.9, { align: "center" });
  }
  d.setFont(undefined, "normal");

  // Nordpila oppe til høyre i bildet
  const nx = x0 + R.bildeB - 12, ny = y0 + 14;
  hex(d, "#ffffff", "fyll"); hex(d, SORT, "strek"); d.setLineWidth(0.3);
  d.circle(nx, ny, 8, "FD");
  hex(d, SORT, "fyll");
  d.triangle(nx, ny - 6.5, nx - 3, ny + 3.5, nx, ny + 1.5, "F");
  hex(d, "#ffffff", "fyll"); d.triangle(nx, ny - 6.5, nx + 3, ny + 3.5, nx, ny + 1.5, "FD");
  d.setFontSize(9); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text("N", nx, ny - 8.8, { align: "center" });
  d.setFont(undefined, "normal");

  // Skalastreken nede til venstre i bildet, på hvit bunn
  const s = skalaStrek(m.skala, 70);
  const sx = x0 + 6, sy = y0 + R.bildeH - 8;
  hex(d, "#ffffff", "fyll"); d.rect(sx - 3, sy - 7, s.mm + 16, 11, "F");
  hex(d, SORT, "strek"); d.setLineWidth(0.25);
  for (let i = 0; i < s.deler; i++) {
    const del = s.mm / s.deler;
    if (i % 2 === 0) hex(d, SORT, "fyll"); else hex(d, "#ffffff", "fyll");
    d.rect(sx + i * del, sy - 1.5, del, 1.5, "FD");
  }
  d.setFontSize(7); hex(d, SORT);
  d.text("0", sx, sy - 2.5, { align: "center" });
  d.text(s.m + " m", sx + s.mm, sy - 2.5, { align: "center" });
  d.text("1:" + m.skala.toLocaleString("nb-NO") + " (A3)", sx, sy + 3);

  // Kartkilden nede til høyre (CC BY 4.0 krever navngivelse)
  d.setFontSize(6.5); hex(d, GRÅ);
  const kilde = m.kartkilde ? t("Terreng og kart: © Kartverket (CC BY 4.0)") : t("Uten terreng — bakgrunnen er ikke et kart");
  const kb = d.getTextWidth(kilde) + 4;
  hex(d, "#ffffff", "fyll"); d.rect(x0 + R.bildeB - kb - 2, y0 + R.bildeH - 6, kb, 5, "F");
  hex(d, GRÅ); d.text(kilde, x0 + R.bildeB - 4, y0 + R.bildeH - 2.5, { align: "right" });
  if (!m.nordKjent) {
    d.setFontSize(7); hex(d, "#a8232b");
    d.text(t("Nord er ikke kontrollert: modellen står ikke i et terreng."), x0 + 4, y0 + 6);
  }

  // ── Tegnforklaringen ──
  const fx = R.forklaringX, fb = R.forklaringB;
  hex(d, SORT, "strek"); d.setLineWidth(0.3); d.rect(fx, y0, fb, R.bildeH);
  d.setFontSize(12); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text(t("Tegnforklaring"), fx + 4, y0 + 8);
  d.setFont(undefined, "normal");
  let y = y0 + 15;
  for (const r of m.forklaring) {
    if (y > y0 + R.bildeH - 14) { d.setFontSize(7); hex(d, GRÅ); d.text(t("… flere typer enn det er plass til"), fx + 4, y); break; }
    // nummerringen
    hex(d, "#ffffff", "fyll"); hex(d, SORT, "strek"); d.setLineWidth(0.3);
    d.circle(fx + 6.5, y, 2.6, "FD");
    d.setFontSize(7.5); d.setFont(undefined, "bold"); hex(d, SORT);
    d.text(String(r.nr), fx + 6.5, y + 1, { align: "center" });
    // fargen: flis, eller strek for pilene (stiplet for gående)
    if (r.pil) {
      hex(d, r.farge, "strek"); d.setLineWidth(1.4);
      if (r.stiplet) d.setLineDashPattern([1.6, 1], 0);
      d.line(fx + 11, y, fx + 19, y);
      d.setLineDashPattern([], 0);
      hex(d, r.farge, "fyll"); d.triangle(fx + 19, y - 1.6, fx + 22, y, fx + 19, y + 1.6, "F");
    } else {
      hex(d, r.farge, "fyll"); hex(d, SORT, "strek"); d.setLineWidth(0.2);
      d.rect(fx + 11, y - 2.2, 9, 4.4, "FD");
    }
    d.setFontSize(9); hex(d, SORT);
    d.text(r.label, fx + 25, y - 0.4);
    d.setFont(undefined, "normal"); d.setFontSize(7.5); hex(d, GRÅ);
    d.text(r.antall, fx + fb - 3, y - 0.4, { align: "right" });
    const linjer = d.splitTextToSize(r.forklaring, fb - 29);
    d.setFontSize(7); d.text(linjer, fx + 25, y + 3.4);
    y += 6 + linjer.length * 3.2 + 3;
  }

  // ── Tittelfeltet ──
  const ty = y0 + R.bildeH + R.mellom, th = R.tittelH, tb = R.b - 2 * R.marg;
  hex(d, SORT, "strek"); d.setLineWidth(0.3); d.rect(x0, ty, tb, th);
  const kol = [x0, x0 + 62, x0 + 178, x0 + 290, x0 + tb];
  for (let i = 1; i < kol.length - 1; i++) d.line(kol[i], ty, kol[i], ty + th);
  // logo (originalbildet) eller tekst
  if (m.logo) {
    const lb = 50, lh = Math.min(th - 6, lb * (m.logo.h / m.logo.b));
    try { d.addImage(m.logo.data, m.logo.format || "PNG", kol[0] + 5, ty + (th - lh) / 2, lb, lh); } catch (_) {}
  } else {
    d.setFontSize(16); d.setFont(undefined, "bold"); hex(d, SORT);
    d.text("Storm", kol[0] + 5, ty + 11);
    d.setFont(undefined, "normal"); d.setFontSize(8); hex(d, GRÅ);
    d.text("Storm Entreprenør AS", kol[0] + 5, ty + 16);
  }
  const felt = (k, overskrift, tekst, stor) => {
    d.setFontSize(6.5); hex(d, GRÅ); d.text(overskrift, kol[k] + 3, ty + 5);
    d.setFontSize(stor ? 15 : 9); d.setFont(undefined, stor ? "bold" : "normal"); hex(d, SORT);
    d.text(d.splitTextToSize(tekst || "—", kol[k + 1] - kol[k] - 6).slice(0, 2), kol[k] + 3, ty + (stor ? 13 : 11));
    d.setFont(undefined, "normal");
  };
  felt(1, t("Tegning"), t("Riggplan"), true);
  d.setFontSize(8); hex(d, GRÅ); d.text(d.splitTextToSize(m.modell, kol[2] - kol[1] - 6).slice(0, 1), kol[1] + 3, ty + 19);
  felt(2, t("Prosjekt og adresse"), [m.prosjekt, m.adresse].filter(Boolean).join(" · "));
  d.setFontSize(6.5); hex(d, GRÅ);
  d.text(t("Omtrentlig plassering (±1–2 m). Skal ikke brukes til utstikking."), kol[2] + 3, ty + th - 3);
  d.setFontSize(6.5); hex(d, GRÅ); d.text(t("Dato"), kol[3] + 3, ty + 5);
  d.text(t("Målestokk"), kol[3] + 40, ty + 5);
  d.text(t("Laget av"), kol[3] + 3, ty + 15);
  d.setFontSize(9); hex(d, SORT);
  d.text(norskDato(m.iDag), kol[3] + 3, ty + 10);
  d.text("1:" + m.skala.toLocaleString("nb-NO") + " (A3)", kol[3] + 40, ty + 10);
  d.text(d.splitTextToSize(m.av || "—", kol[4] - kol[3] - 6).slice(0, 1), kol[3] + 3, ty + 20);
  return d;
}
