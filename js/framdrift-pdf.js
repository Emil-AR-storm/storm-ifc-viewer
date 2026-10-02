// 📅 Framdriftsplan — PDF-EN (trinn 4). Lastes først når noen trykker «Last
// ned PDF» (dynamisk import fra framdrift.js), som riggplanen.
//
// Oppsett B, valgt av Emil 01.10 (prøvebildet «framdrift-prove-B.png» i
// Ideer). Emils bestilling («Nytt verktøy framdrifts plan 01.10.26.txt»):
//   • én side per trinn
//   • fire bilder — nord, sør, øst, vest — «på samme måte som riggplan PDF»,
//     og hvert bilde bygger videre på det forrige: side 2 viser trinn 1 + 2
//   • kolonne til høyre: datoen i overskriften, et bilde fra sør av BARE det
//     som er lagt til i trinnet, lista over hva som er lagt til, og helt
//     nederst hvem som har laget planen
//   • logoen velges som i rapporten og riggplanen
// Det som er nytt i trinnet tegnes i trinnets farge; det som ble gjort i
// tidligere trinn står i sine vanlige farger. Objekter som ikke ligger i noe
// trinn er ikke med (Emil 01.10).
//
// Bildene lages med NØYAKTIG samme kamera, sol og dis som riggplanens
// skråbilder (oversiktKameraer i riggplan.js), og alle sidene bruker samme
// kamera — da ser man bygget vokse fra side til side.
import * as THREE from "three";
import { EKSTRA_LAG, S, loadingEl, loadingText } from "./state.js";
import { t, tn } from "./i18n.js";
import { scene, markerGroup, omradeGroup } from "./scene.js";
import { hentJsPDF, lastNedFil, norskDato } from "./rapport.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { RIGGPLAN, RIGG_TYPER, nordOgOst } from "./rigg-regn.js";
import { aktivRef, riggBase } from "./rigg-vis.js";
import { boksUtenLapper, hex, hjorner, lastEtterbehandling, oversiktKameraer, tegnOversiktBilde, toppbaand } from "./riggplan.js";
import { elementGeometri, stopeGroup } from "./stopeplan-vis.js";
import { brukOppBunker, finnObjekter, settIfcSkjult } from "./framdrift-vis.js";
import { forberedKilder } from "./framdrift-kilde.js";
import { allElementBoxes } from "./elements.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { materiellTypeLabel } from "./materiell-vis.js";
import { veggMedId } from "./veggelement/juster.js";
import { spFilInfo, spPaalogget } from "./sp-lager.js";
import { qrDataUrl } from "./qr.js";
import { GULV_ID } from "./veggelement/tilstand.js";
import { IFC_GRUPPE, framdriftFilnavn, idFor, ifcUnder, infoRader, pdfTrinn, slagFor, trinnTittel } from "./framdrift-regn.js";

const GRÅ = "#6b7280", SORT = "#14161a", LINJE = "#c9ced6", KORT = "#f4f5f7";
const PX_PER_MM = 5;
// Arket: A3 liggende, samme marger og toppbånd som riggplanen (RIGGPLAN)
export const FRAMDRIFT_ARK = (() => {
  const R = RIGGPLAN;
  const y0 = R.marg + R.toppH + R.mellom;
  const bunn = R.h - R.marg - R.bunnH;
  const kolB = 112, mellom = 5;
  const kolX = R.b - R.marg - kolB;
  const flisB = (kolX - mellom - R.marg - mellom) / 2;
  const flisH = (bunn - y0 - mellom) / 2;
  return { y0, bunn, kolB, kolX, mellom, flisB, flisH, nyttB: kolB - 12, nyttH: (kolB - 12) / 1.5 };
})();
// Rekkefølgen bildene står i på arket (oppsett B): nord, sør / øst, vest
const RETNINGER = ["nord", "sor", "ost", "vest"];

function mittNavn() {
  try { const acc = S.msalApp && S.msalApp.getActiveAccount(); return (acc && (acc.name || acc.username)) || ""; }
  catch (_) { return ""; }
}
async function finnLogo() {
  try {
    const husket = S.framdriftLogoFil ? S.framdriftLogoFil() : (S.settings && S.settings.rapLogo);
    if (!husket) return null;
    const l = (await hentLogoer()).find(x => x.fil === husket);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}

// ═══════════ HVA SOM STÅR I LISTA ═══════════
function postFor(k) {
  const s = slagFor(k), id = idFor(k);
  if (s === "id") {
    const m = metaFor(Number(id)) || {};
    return { gruppe: t(IFC_GRUPPE[m.typeName] || "Elementer"), under: ifcUnder(m.name || m.objectType || "") };
  }
  if (s === "sw") {
    if (id === GULV_ID) return { gruppe: t("Betonggulv") };
    let v = null; try { v = veggMedId(id); } catch (_) { v = null; }
    if (v && v.ringmur) return { gruppe: t("Ringmur") };
    if (v && v.inner) return { gruppe: t("Innervegger") };
    return { gruppe: t("Veggelementer") };
  }
  if (s === "tak") return { gruppe: t("Takplater") };
  if (s === "blikk") return { gruppe: t("Blikk") };
  if (s === "mat") {
    const p = (S.materiell || []).find(x => x && x.id === id);
    if (!p) return { gruppe: t("Materiell") };
    return { gruppe: p.navn || materiellTypeLabel(p), antall: p.antall || 1 };
  }
  if (s === "rigg") {
    const o = (S.rigg || []).find(x => x && x.id === id);
    const T = o && RIGG_TYPER[o.type];
    return { gruppe: T ? t(T.label) : t("Rigg"), antall: (o && T && T.moduler) ? (o.moduler || 1) : 1 };
  }
  if (s === "mark") return { gruppe: t("Markeringer") };
  return { gruppe: t("Objekter") };
}
export function radeneFor(e) { return infoRader(e.objekter.map(o => postFor(o.k))); }

// ═══════════ TILSTANDEN FOR ÉN SIDE ═══════════
// `liste`: trinnene med side, `i`: denne sidens trinn, `bareNytt`: bildet i
// kolonnen (bare det som er nytt). Returnerer en rydde-funksjon.
const _farge = new THREE.Color();
function farg(o, farge, ut) {
  o.traverse(m => {
    // Kranens svingsone og stiplede sirkel beholder sine farger — de er
    // ikke noe som bygges, bare hvor kranen når
    if (!m.material || m.isSprite || m.userData.kranSone || m.userData.kranStiplet || m.userData.sektorHandtak) return;
    const orig = m.material;
    const lag = (x) => { const c = x.clone(); if (c.color) c.color.lerp(_farge.set(farge), 0.62); return c; };
    m.material = Array.isArray(orig) ? orig.map(lag) : lag(orig);
    ut.push(() => {
      const ny = m.material;
      m.material = orig;
      (Array.isArray(ny) ? ny : [ny]).forEach(x => x && x.dispose && x.dispose());
    });
  });
}
// Alle IFC-elementene i modellen (også de sammenslåtte i lav kvalitet)
export function alleIfcIder() {
  const ut = new Set();
  for (const m of (S.modelGroup && S.modelGroup.children) || []) {
    if (m.userData.merged) { for (const r of m.userData.ranges || []) ut.add(r.id); }
    else if (m.userData.expressID !== undefined) ut.add(m.userData.expressID);
  }
  return ut;
}
// Det som SKAL være med i et bilde: modellen, lagene (SW, tak, materiell,
// rigg, terreng) og markeringene. Alt annet i scenen — utvalgsmarkeringen,
// mål, akser, sammenligning, håndtak — skjules (Emil 01.10: «en plate i
// stålmodellen som ikke finnes» var utvalgsmarkeringen fra skjermen).
function innholdsGrupper() {
  const g = new Set([markerGroup, omradeGroup]);
  if (S.modelGroup) g.add(S.modelGroup);
  for (const l of EKSTRA_LAG) if (l.gruppe && l.gruppe !== stopeGroup) g.add(l.gruppe);
  return g;
}
// Skjuler alt i scenen som ikke er innhold (se innholdsGrupper) — også for
// videoen. `ogsa`: grupper som skal stå likevel (videoens overgangskopier).
// Returnerer rydde-funksjonen.
// Kan kalles igjen for hvert bilde (videoen): skjermens rammekroker slår av
// og til ting på igjen mellom bildene. Første gang huskes hva som var synlig.
export function skjulIkkeInnhold(ogsa) {
  const innhold = innholdsGrupper();
  for (const g of ogsa || []) innhold.add(g);
  const husket = new Map();
  const haand = () => {
    for (const o of scene.children) {
      if (innhold.has(o) || o.isLight || o.isCamera) continue;
      if (!husket.has(o)) husket.set(o, o.visible);
      o.visible = false;
    }
  };
  haand();
  const rydd = () => { for (const [o, v] of husket) o.visible = v; };
  rydd.igjen = haand;
  return rydd;
}
// `vis(o)`/`skjul(o)` med husk, så alt settes tilbake nøyaktig som det var
function husk(rydd) {
  return (o, synlig) => {
    if (o.visible === synlig) return;
    const v = o.visible; o.visible = synlig;
    rydd.push(() => { o.visible = v; });
  };
}
// Emil 01.10: objekter som ikke ligger i noe trinn skjules i PDF-en og
// videoen — planen viser bare det som utføres. Bildet av det som er nytt i
// trinnet har objektenes egne farger; i de fire store bildene står det nye i
// trinnets farge.
export function settSide(liste, i, bareNytt, geoCache) {
  const naa = liste[i];
  const naaK = new Set(naa.objekter.map(o => o.k));
  const synligK = new Set(naaK);
  if (!bareNytt) liste.slice(0, i).forEach(e => e.objekter.forEach(o => synligK.add(o.k)));
  const objMap = finnObjekter();
  const nokkelFor = new Map();
  for (const [k, os] of objMap) for (const o of os) nokkelFor.set(o, k);
  const rydd = [];
  const sett = husk(rydd);
  const fargIfc = !bareNytt;

  // IFC: alt som ikke skal synes, skjules. Dette trinnets elementer tegnes i
  // de store bildene som én kopi i trinnets farge (originalene skjult).
  const naaIfc = [...naaK].filter(k => slagFor(k) === "id").map(k => Number(idFor(k)));
  const synligIfc = new Set([...synligK].filter(k => slagFor(k) === "id").map(k => Number(idFor(k))));
  // Kopien lages FØR skjulingen: i lav kvalitet er elementene slått sammen,
  // og et skjult element har ingen trekanter igjen å kopiere
  let g = (fargIfc && naaIfc.length) ? geoCache.get(naa.id) : null;
  if (g === undefined) { try { g = elementGeometri(naaIfc) || null; } catch (_) { g = null; } geoCache.set(naa.id, g); }
  const skjulIfc = new Set();
  for (const id of alleIfcIder()) if (!synligIfc.has(id) || (fargIfc && naaIfc.includes(id))) skjulIfc.add(id);
  settIfcSkjult(skjulIfc);
  rydd.push(() => settIfcSkjult(new Set()));
  // Det som ikke er innhold, ut av bildet
  const innhold = innholdsGrupper();
  for (const o of scene.children) {
    if (innhold.has(o) || o.isLight || o.isCamera) continue;
    sett(o, false);
  }
  // …og kopien inn ETTER den runden, ellers skjulte den seg selv
  if (g) {
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: naa.farge, side: THREE.DoubleSide }));
    m.userData.ikkeValg = true;
    scene.add(m);
    rydd.push(() => { scene.remove(m); m.material.dispose(); });
  }
  // Lagene (SW, takplater, blikk, materiell, rigg) og markeringene
  const grupper = EKSTRA_LAG.filter(l => l.gruppe && l.id !== "terreng" && l.gruppe !== stopeGroup).map(l => l.gruppe).concat([markerGroup, omradeGroup]);
  for (const gr of new Set(grupper)) {
    for (const o of gr.children) {
      const k = nokkelFor.get(o);
      if (k) {
        if (!synligK.has(k)) sett(o, false);
        else if (!bareNytt && naaK.has(k)) farg(o, naa.farge, rydd);
        continue;
      }
      // Lapper og utsparingsmerking følger eierne sine (fpEiere)
      const eiere = o.userData.fpEiere;
      if (eiere && eiere.length) { if (!eiere.some(x => synligK.has(x))) sett(o, false); continue; }
      // Uten eier og uten trinn: ikke med (Emil: det som ikke ligger i et trinn, skjules)
      sett(o, false);
    }
  }
  // 📦 Bunkene brukes opp (Emil 02.10): det som er montert til og med dette
  // trinnet, er tatt fra bunkene. «Nytt i trinnet» viser leveransen hel.
  if (!bareNytt) brukOppBunker(objMap, null, (k) => synligK.has(k) ? 1 : 0, (o) => sett(o, false), (m) => sett(m, false));
  return () => { for (let j = rydd.length - 1; j >= 0; j--) { try { rydd[j](); } catch (_) {} } };
}

// ═══════════ UTSNITTET: ALT, MED ALLE TRINNENE ═══════════
// `nokler`: bare disse objektene (bildet av det som er nytt i trinnet) —
// uten: alt i modellen, så alle sidene får samme kamera.
export function utsnitt(nokler) {
  const base = riggBase();
  if (!base) return null;
  const ref = aktivRef();
  const { nord, ost } = nordOgOst(ref ? ref.plass.rot : 0);
  const tilEN = (p) => {
    const dx = (p.x - base.c.x) * base.skala, dz = (p.z - base.c.z) * base.skala;
    return { e: dx * ost.x + dz * ost.z, n: dx * nord.x + dz * nord.z };
  };
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, toppY = -Infinity, bunnY = Infinity;
  const gyldig = (b) => !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
  const taMed = (b) => {
    if (!gyldig(b)) return;
    toppY = Math.max(toppY, b.max.y); bunnY = Math.min(bunnY, b.min.y);
    for (const p of hjorner(b)) {
      const q = tilEN(p);
      if (Math.hypot(q.e, q.n) > 1000) continue;        // som riggplanen: over 1 km unna er ikke tomta
      minE = Math.min(minE, q.e); maxE = Math.max(maxE, q.e); minN = Math.min(minN, q.n); maxN = Math.max(maxN, q.n);
    }
  };
  if (nokler) {
    let bokser = null;
    try { bokser = allElementBoxes(); } catch (_) { bokser = null; }
    const objMap = finnObjekter();
    for (const k of nokler) {
      if (slagFor(k) === "id") { const b = bokser && bokser.get(Number(idFor(k))); if (b) taMed(b.clone()); continue; }
      for (const o of objMap.get(k) || []) taMed(boksUtenLapper(o, true));
    }
  } else {
    if (S.modelGroup) taMed(new THREE.Box3().setFromObject(S.modelGroup));
    for (const l of EKSTRA_LAG) {
      if (!l.gruppe || l.id === "terreng" || l.gruppe === stopeGroup) continue;
      for (const o of l.gruppe.children) taMed(boksUtenLapper(o, true));     // uten kranens svingsirkel
    }
  }
  if (!isFinite(minE) || !isFinite(toppY)) return null;
  const marg = Math.max(3, 0.06 * Math.max(maxE - minE, maxN - minN));
  const mE = (minE + maxE) / 2, mN = (minN + maxN) / 2;
  const senter = new THREE.Vector3(base.c.x + (mE * ost.x + mN * nord.x) / base.skala, 0, base.c.z + (mE * ost.z + mN * nord.z) / base.skala);
  const punkter = [];
  for (const e of [minE, maxE]) for (const n of [minN, maxN]) for (const y of [bunnY, toppY])
    punkter.push(new THREE.Vector3(base.c.x + (e * ost.x + n * nord.x) / base.skala, y, base.c.z + (e * ost.z + n * nord.z) / base.skala));
  const rM = Math.max(maxE - minE, maxN - minN) / 2 + marg;
  return { base, nord, ost, senter, bunnY, toppY, punkter, rM };
}

// ═══════════════════════ HOVEDINNGANGEN ═══════════════════════
export async function lagFramdriftPdf() {
  const liste = pdfTrinn(S.framdrift);
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return null; }
  if (!liste.length) { alert(t("Legg noe i et trinn først — planen er tom.")); return null; }
  const vis = (tekst) => { if (loadingText) loadingText.textContent = tekst; };
  if (loadingEl) loadingEl.classList.add("open");
  const geoCache = new Map();
  try {
    vis(t("Lager framdriftsplan …"));
    await lastEtterbehandling();
    try { await sikreMeta(); } catch (_) {}
    await forberedKilder();
    // Samme kamera på alle sidene, rundt alt som ligger i et trinn
    const u = utsnitt([...new Set(liste.flatMap(e => e.objekter.map(o => o.k)))]) || utsnitt();
    if (!u) throw new Error(t("Fant ingenting å tegne."));
    const A = FRAMDRIFT_ARK;
    const kamFlis = oversiktKameraer(u.base, u.senter, u.nord, u.ost, u.rM, u.bunnY, A.flisB / A.flisH, u.punkter);
    // «Nytt i trinnet»: kameraet fra sør, men tett rundt det som er nytt
    const kamNyttFor = (e) => {
      const n = utsnitt(e.objekter.map(o => o.k)) || u;
      return oversiktKameraer(u.base, n.senter, u.nord, u.ost, Math.max(n.rM, 4), n.bunnY, A.nyttB / A.nyttH, n.punkter).find(k => k.id === "sor");
    };
    const fpx = [Math.round(A.flisB * PX_PER_MM), Math.round(A.flisH * PX_PER_MM)];
    const npx = [Math.round(A.nyttB * PX_PER_MM), Math.round(A.nyttH * PX_PER_MM)];
    const sider = [];
    for (let i = 0; i < liste.length; i++) {
      vis(t("Tegner trinn {0} av {1} …", i + 1, liste.length));
      await new Promise(r => setTimeout(r, 0));          // la «Tegner …» komme på skjermen
      let rydd = settSide(liste, i, false, geoCache);
      const bilder = {};
      try { for (const k of kamFlis) bilder[k.id] = { navn: k.navn, data: tegnOversiktBilde(k, fpx[0], fpx[1]) }; }
      finally { rydd(); }
      rydd = settSide(liste, i, true, geoCache);
      let nytt = null;
      try { nytt = tegnOversiktBilde(kamNyttFor(liste[i]), npx[0], npx[1]); } finally { rydd(); }
      sider.push({ e: liste[i], bilder: RETNINGER.map(r => bilder[r]).filter(Boolean), nytt, rader: radeneFor(liste[i]) });
    }
    const logo = await finnLogo();
    // ▦ QR til videoen (trinn 5) — finnes den i SharePoint, kommer den på hver side
    const video = await finnVideo();
    const qr = video ? await qrDataUrl(video, 512) : null;
    vis(t("Henter PDF-biblioteket …"));
    const jsPDF = await hentJsPDF();
    const iDag = new Date().toISOString().slice(0, 10);
    const live = S.terrengRef ? S.terrengRef() : null;
    const d = tegnArk(jsPDF, {
      sider, logo, iDag, av: mittNavn(), alle: sortert0(), qr,
      under: [S.lettProsjekt || "", (live && live.adresse) || "", String(S.fileName || "").replace(/\.(ifc|glb)$/i, "")].filter(Boolean).join("  ·  ")
    });
    lastNedFil(d.output("blob"), framdriftFilnavn(S.fileName, iDag));
    return { sider: sider.length };
  } catch (err) {
    console.warn("Framdriftsplanen feilet:", err);
    alert(t("Klarte ikke å lage framdriftsplanen: {0}", err.message));
    return null;
  } finally {
    for (const g of geoCache.values()) if (g && g.dispose) g.dispose();
    if (loadingEl) loadingEl.classList.remove("open");
  }
}
// Videoen i SharePoint (lagret av «Lag video»): lenken, eller null
async function finnVideo() {
  if (!spPaalogget()) return null;
  for (const ext of ["mp4", "webm"]) {
    try {
      const r = await spFilInfo("Framdriftsplan", String(S.fileName || "modell") + ".framdrift." + ext);
      if (r && r.status === "ok" && r.webUrl) return r.webUrl;
    } catch (_) {}
  }
  return null;
}
// Trinnlinja viser ALLE trinnene med side, så nummereringen stemmer med sidene
function sortert0() { return pdfTrinn(S.framdrift); }

// ═══════════════════════ ARKET ═══════════════════════
function datoSpenn(e) {
  const a = norskDato(e.dato), b = norskDato(e.slutt);
  if (!a) return t("Uten dato");
  return b && b !== a ? a + " – " + b : a;
}
function trinnLinje(d, x, y, b, alle, naa) {
  const n = alle.length, i0 = alle.findIndex(e => e.id === naa.id);
  if (n === 1) return;
  if (n > 14) {
    // Mange trinn: en fremdriftsstrek i stedet for prikker
    hex(d, LINJE, "fyll"); d.roundedRect(x, y - 1, b, 2, 1, 1, "F");
    hex(d, naa.farge, "fyll"); d.roundedRect(x, y - 1, b * (i0 + 1) / n, 2, 1, 1, "F");
    d.setFontSize(7); hex(d, GRÅ); d.text(t("Trinn {0} av {1}", i0 + 1, n), x + b, y + 5, { align: "right" });
    return;
  }
  const steg = b / (n - 1), r = 2.4;
  hex(d, LINJE, "strek"); d.setLineWidth(0.5); d.line(x, y, x + b, y);
  alle.forEach((e, i) => {
    const cx = x + i * steg;
    const stor = i === i0, f = i <= i0 ? e.farge : "#d4d8de";
    hex(d, "#ffffff", "fyll"); d.circle(cx, y, (stor ? r * 1.35 : r) + 0.6, "F");
    hex(d, f, "fyll"); d.circle(cx, y, stor ? r * 1.35 : r, "F");
    d.setFontSize(stor ? 7.5 : 6); d.setFont(undefined, "bold");
    hex(d, i <= i0 ? "#ffffff" : GRÅ);
    d.text(String(e.nr), cx, y + 0.1, { align: "center", baseline: "middle" });
    d.setFont(undefined, "normal");
  });
}

export function tegnArk(jsPDF, m) {
  const R = RIGGPLAN, A = FRAMDRIFT_ARK;
  const d = new jsPDF({ unit: "mm", format: "a3", orientation: "landscape" });
  const ant = m.sider.length;
  m.sider.forEach((side, si) => {
    if (si) d.addPage("a3", "landscape");
    const e = side.e;
    d.setLineWidth(0.3);
    toppbaand(d, m, t("Framdriftsplan"), m.under, [
      [t("Trinn"), t("{0} av {1}", si + 1, ant)],
      [t("Dato"), norskDato(e.dato) || "—"],
      [t("Laget av"), m.av]
    ]);
    // ── De fire bildene ──
    side.bilder.forEach((b, i) => {
      const bx = R.marg + (i % 2) * (A.flisB + A.mellom);
      const by = A.y0 + Math.floor(i / 2) * (A.flisH + A.mellom);
      try { d.addImage(b.data, "JPEG", bx, by, A.flisB, A.flisH); } catch (_) {}
      hex(d, LINJE, "strek"); d.setLineWidth(0.25); d.rect(bx, by, A.flisB, A.flisH);
      d.setFontSize(8.5); d.setFont(undefined, "bold");
      const pb = d.getTextWidth(b.navn) + 8;
      hex(d, "#ffffff", "fyll");
      d.roundedRect(bx + 3, by + 3, pb, 7, 3.5, 3.5, "FD");
      hex(d, SORT); d.text(b.navn, bx + 3 + pb / 2, by + 6.6, { align: "center", baseline: "middle" });
      d.setFont(undefined, "normal");
    });
    // ── Kolonnen til høyre ──
    const kx = A.kolX, kb = A.kolB, ix = kx + 6, ib = kb - 12;
    hex(d, KORT, "fyll"); d.roundedRect(kx, A.y0, kb, A.bunn - A.y0, 2, 2, "F");
    let y = A.y0 + 9;
    trinnLinje(d, ix + 2, y, ib - 4, m.alle, e);
    y += 12;
    d.setFontSize(13); d.setFont(undefined, "bold"); hex(d, SORT);
    const tittel = d.splitTextToSize(trinnTittel(e, t("Trinn")), ib).slice(0, 2);
    d.text(tittel, ix, y); y += tittel.length * 5.4;
    d.setFontSize(11); hex(d, e.farge); d.text(datoSpenn(e), ix, y); y += 6.5;
    d.setFont(undefined, "normal");
    d.setFontSize(7.5); hex(d, GRÅ); d.text(t("Nytt i dette trinnet (sett fra sør)"), ix, y); y += 2.5;
    if (side.nytt) { try { d.addImage(side.nytt, "JPEG", ix, y, A.nyttB, A.nyttH); } catch (_) {} }
    hex(d, LINJE, "strek"); d.setLineWidth(0.25); d.rect(ix, y, A.nyttB, A.nyttH);
    y += A.nyttH + 8;
    // Lista: punkt i trinnets farge, teksten, antallet til høyre
    const QR_MM = 24;
    const bunnListe = A.bunn - 18 - (m.qr ? QR_MM + 4 : 0);
    d.setFontSize(8.5);
    for (let r = 0; r < side.rader.length; r++) {
      if (y > bunnListe) {
        d.setFontSize(7.5); hex(d, GRÅ);
        d.text(tn(side.rader.length - r, "… og {0} til", "… og {0} til"), ix + 4, y);
        break;
      }
      const rad = side.rader[r];
      hex(d, e.farge, "fyll"); d.circle(ix + 1.2, y - 1.1, 1.1, "F");
      hex(d, SORT);
      const antTekst = rad.antall + " " + t("stk");
      const tw = ib - 4 - d.getTextWidth(antTekst) - 3;
      d.text(d.splitTextToSize(rad.tekst, tw)[0], ix + 4, y);
      d.text(antTekst, ix + ib, y, { align: "right" });
      y += 5.4;
    }
    // ▦ QR-koden til videoen, rett over «Laget av»
    if (m.qr) {
      const qy = A.bunn - 13 - QR_MM;
      try { d.addImage(m.qr, "PNG", ix, qy, QR_MM, QR_MM); } catch (_) {}
      d.setFontSize(8.5); d.setFont(undefined, "bold"); hex(d, SORT);
      d.text(t("Se videoen av hele framdriften"), ix + QR_MM + 4, qy + 9);
      d.setFont(undefined, "normal"); d.setFontSize(7.5); hex(d, GRÅ);
      d.text(t("Skann med mobilen (SharePoint, Storm-innlogging)"), ix + QR_MM + 4, qy + 14);
    }
    // Helt nederst: hvem som har laget planen
    hex(d, LINJE, "strek"); d.setLineWidth(0.25); d.line(ix, A.bunn - 11, ix + ib, A.bunn - 11);
    d.setFontSize(8); hex(d, GRÅ);
    d.text(t("Laget av: {0}", (m.av || "—") + " · " + norskDato(m.iDag)), ix, A.bunn - 5);
    // ── Bunnlinja ──
    d.setFontSize(6.5); hex(d, GRÅ);
    d.text(t("Farget: nytt i trinn {0} · Vanlige farger: utført i tidligere trinn", e.nr), R.marg, R.h - R.marg);
    d.text(t("Side {0} av {1}", si + 1, ant), R.b - R.marg, R.h - R.marg, { align: "right" });
  });
  return d;
}
