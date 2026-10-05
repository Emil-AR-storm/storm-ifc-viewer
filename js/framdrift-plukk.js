// 📅 Framdriftsplan — GENERERT BLIKK OG TRP-PLATER I «LEGG TIL» (Emil 01.10).
//
// SW-generatoren tegner takplatene (userData.trpId) og blikket
// (userData.blikkId) i samme gruppe som veggene, men SW-lagets plukking ser
// bare veggene og gulvet (swId). Dette laget svarer for platene og blikket —
// og BARE mens framdriftsplanens velgemodus er på, så vanlige klikk og
// shift-klikk ellers i programmet er som før.
//
// Laget melder seg inn i EKSTRA_LAG (js/state.js) med plukk, flervalg og
// iRekt, så både trykk og shift + dra virker uten at elements.js vet om det.
// Id-ene er hele nøkler: «tak:<id>» og «blikk:<id>».
//
// 🎯 TRYKK OVERALT (Emil 05.10): «når man trykker på generert veggelement/
// takplater/blikk så blir objekt som står bak markert». SW-lagets plukking
// så gjennom platene og blikket og traff veggen (eller stålet) bak. Nå
// plukker dette laget platene og blikket ALLTID, ikke bare i velgemodusen —
// nærmeste treff vinner i main.js, så plata du ser er den du får — og
// trykket viser kode og mål i egenskapspanelet. Markeringsboksen (iRekt)
// tar dem med overalt også (Emil 05.10) — oppsummeringen samler dem per type
// (flervalgRader), så tusen blikkstykker blir noen få linjer.
import * as THREE from "three";
import { $, S, apnePanel, esc, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { BESLAG_FORM, BESLAG_FORM_NAVN, BLIKK_TYPE_NAVN } from "./sw-blikk.js";
import { blikkInfoRad } from "./veggelement/tilstand.js";
import { camera, canvas, raycaster } from "./scene.js";
import { swGroup } from "./veggelement/tilstand.js";
import { settValgEffekt } from "./materiell-vis.js";

export const LAG_ID = "fpTrpBlikk";
const valgt = new Set();
const aktiv = () => !!(S.velgModusAktiv && S.framdriftVelger && S.framdriftVelger());

export function nokkelForMesh(o) {
  while (o && o !== swGroup) {
    const u = o.userData || {};
    if (u.trpId !== undefined && u.trpId !== null && u.trpId !== "") return "tak:" + u.trpId;
    if (u.blikkId !== undefined && u.blikkId !== null && u.blikkId !== "") return "blikk:" + u.blikkId;
    o = o.parent;
  }
  return null;
}
function synligKjede(o) {
  for (let x = o; x; x = x.parent) if (x.visible === false) return false;
  return true;
}
// Alle meshene per nøkkel (en plate eller et beslag kan være flere meshes)
function meshPerNokkel() {
  const m = new Map();
  for (const o of swGroup.children) {
    const k = nokkelForMesh(o);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return m;
}
function oppdaterEffekt() {
  for (const [k, liste] of meshPerNokkel()) for (const o of liste) settValgEffekt(o, valgt.has(k));
}

const _ndc = new THREE.Vector2();
const _b = new THREE.Box3(), _v = new THREE.Vector3();
const gruppe = new THREE.Group();     // tom: laget eier ingen egne objekter
registrerEkstraGruppe(gruppe, {
  id: LAG_ID,
  navn: "Blikk og takplater",
  // Lagkontrakten (test-ekstralag): mengder, søk og «fly til» står allerede
  // på SW-laget for de samme platene og beslagene — her er de tomme, så
  // ingenting telles eller vises to ganger.
  mengder: () => {},
  sokRader: () => [],
  gaTil() {},
  plukk(cx, cy) {
    if (!swGroup.visible || !swGroup.children.length) return null;
    const r = canvas.getBoundingClientRect();
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    swGroup.updateMatrixWorld(true);
    raycaster.setFromCamera(_ndc, camera);
    for (const h of raycaster.intersectObjects(swGroup.children, true)) {
      if (h.object.isSprite || !synligKjede(h.object)) continue;
      // Det FØRSTE synlige treffet avgjør: er det en vegg, er det ikke en
      // plate bak veggen du trykte på (da svarer SW-laget).
      const k = nokkelForMesh(h.object);
      return k ? { id: k, avstand: h.distance } : null;
    }
    return null;
  },
  flervalg: true,
  // ⇧ Markeringsboksen tar platene og blikket med overalt (Emil 05.10:
  // «legg til at man kan markere blikk og takelement med markeringsboks»).
  iRekt(x0, y0, x1, y1) {
    if (!swGroup.visible || !swGroup.children.length) return new Set();
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    // Et Set, som SW-lagets iRekt — finishBoxSelect i elements.js leser .size
    const ut = new Set();
    swGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    for (const [k, liste] of meshPerNokkel()) {
      _b.makeEmpty();
      for (const o of liste) if (synligKjede(o)) _b.expandByObject(o);
      if (_b.isEmpty()) continue;
      _b.getCenter(_v).project(camera);
      if (_v.z > 1) continue;
      const px = (_v.x + 1) / 2 * innerWidth, py = (1 - _v.y) / 2 * innerHeight;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) ut.add(k);
    }
    return ut;
  },
  velg(ider) {
    const nye = new Set(ider || []);
    if (nye.size === valgt.size && [...nye].every(k => valgt.has(k))) return;
    valgt.clear();
    for (const k of nye) valgt.add(k);
    oppdaterEffekt();
  },
  valgte: () => [...valgt],
  // ⇧ Shift-klikk utenfor velgemodusen: platene og blikket telles i
  // oppsummeringen (antall og løpemeter per type), som SW-elementene
  flervalgRader(ider) {
    const ut = [];
    for (const k of ider || []) {
      const i = infoFor(k);
      if (!i) continue;
      if (i.slag === "tak") ut.push({ key: t("TRP-takplate") + (i.kode ? " · " + i.kode : ""), type: "TRP", len: i.lengdeMm / 1000, area: i.lengdeMm * i.breddeMm / 1e6, vol: 0, navn: i.kode || t("TRP-takplate") });
      else ut.push({ key: blikkNavn(i.r.t) + (i.r.fo ? " · " + t(i.r.fo) : ""), type: t("Blikk"), len: i.r.l / 1000, area: 0, vol: 0, navn: blikkNavn(i.r.t) });
    }
    return ut;
  },
  visEgenskaper(k) { visInfo(k); }
});

// ---------- Hva plata / stykket ER ----------
function blikkNavn(type) { return BLIKK_TYPE_NAVN[type] ? t(BLIKK_TYPE_NAVN[type]) : (type || t("Blikk")); }
function forsteMesh(k) {
  for (const o of swGroup.children) if (nokkelForMesh(o) === k) return o;
  return null;
}
export function infoFor(k) {
  const m = forsteMesh(k);
  if (!m) return null;
  if (String(k).startsWith("tak:")) {
    const p = m.userData.trpInfo || {};
    return { slag: "tak", kode: String(p.kode || ""), lengdeMm: Math.round(Number(p.lengdeMm) || 0),
      breddeMm: Math.round(Number(p.breddeMm) || 0), skra: !!p.skra,
      lengdeVMm: Math.round(Number(p.lengdeVMm) || 0), lengdeHMm: Math.round(Number(p.lengdeHMm) || 0) };
  }
  const r = blikkInfoRad(m.userData.blikkInfo);
  return r ? { slag: "blikk", r } : null;
}
function visInfo(k) {
  const i = infoFor(k);
  if (!i || !$("propTitle")) return;
  const rad = (a, b) => '<div class="prop-row"><div class="k">' + esc(a) + '</div><div class="v">' + esc(String(b)) + "</div></div>";
  const mm = (v) => Number(v).toLocaleString("no-NO") + " mm";
  if (i.slag === "tak") {
    $("propTitle").textContent = t("TRP-takplate");
    $("propBody").innerHTML =
      (i.kode ? rad(t("Kode"), i.kode) : "") +
      (i.skra && i.lengdeVMm && i.lengdeHMm ? rad(t("Lengde"), mm(i.lengdeVMm) + " / " + mm(i.lengdeHMm))
        : (i.lengdeMm ? rad(t("Lengde"), mm(i.lengdeMm)) : "")) +
      (i.breddeMm ? rad(t("Bredde"), mm(i.breddeMm)) : "");
  } else {
    const r = i.r;
    const form = r.fo || (BESLAG_FORM[r.t] ? BESLAG_FORM_NAVN[BESLAG_FORM[r.t]] : "");
    $("propTitle").textContent = blikkNavn(r.t);
    $("propBody").innerHTML =
      rad(t("Type"), blikkNavn(r.t)) +
      (form ? rad(t("Profil"), t(form)) : "") +
      rad(t("Lengde"), mm(r.l)) +
      (r.b ? rad(t("Benlengde"), r.b + " mm") : "") +
      rad(t("Plassering"), (r.se === "inner" ? t("Innervegg") : t("Yttervegg")) + (r.fa ? " · " + r.fa : ""));
  }
  const p = $("propPanel");
  if (p) p.dataset.navn = $("propTitle").textContent;
  apnePanel("propPanel");
}
