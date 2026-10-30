// 📁 FDV — panelet (runde 7 / 10, Emils valg A + B 29.10.2026).
//
// Knappen «FDV» i Dokumentasjon. Slipp PDF-er → det blir en FDV-GRUPPE →
// klikk objektene i 3D som hører til (et nytt klikk tar dem ut igjen).
// Modellen fargelegges etter FDV-status: grønn = gruppa har alle
// dokumentene, gul = gruppa mangler noe, rød = objektet er ikke i noen gruppe.
// Status per fag, og eksport til Excel + ZIP med PDF-ene sortert per gruppe.
//
// Lagring: gruppene i SharePoint «FDV/<prosjekt>.fdv.json» (flettes på id),
// PDF-ene i samme mappe. Uten innlogging: rødt varsel, og PDF-ene holdes i
// minnet til du logger inn (da lastes de opp av seg selv).
import * as THREE from "three";
import { $, S, apnePanel, esc, på } from "./state.js";
import { scene } from "./scene.js";
import { setMode } from "./modes.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { _lagene as lagene } from "./lag.js";
import { spLastOpp, spLes, spLesBin, spPaalogget, spSkriv } from "./sp-lager.js";
import * as F from "./fdv-regn.js";

const tilstand = {
  grupper: [],               // alle (også gravsteiner), som i SharePoint
  aktiv: "",                 // gruppa som redigeres (klikk i 3D legger til / tar ut)
  sist: null,                // sist klikkede objekt (til «Marker alle like»)
  farger: true,              // fargelegging av modellen på/av
  minne: new Map(),          // fil → ArrayBuffer (ikke lastet opp ennå)
  ulagret: new Set(),        // filer som venter på opplasting
  indeks: null,              // { nokkel, objekter: [...], perGid: Map }
  lest: "",                  // nøkkelen gruppene er lest for
  jobber: "",
  // 📚 FDV-biblioteket (valg A 30.10): varene for hele Storm, på tvers av prosjekter
  bib: [],                   // alle varer (også gravsteiner), som i SharePoint
  bibLest: false,
  fane: "prosjekt",          // "prosjekt" | "bibliotek"
  sok: "",
  skjulForslag: ""           // nøkkelen forslagene er skjult for (denne økta)
};
export const _tilstand = tilstand;
const nokkel = () => F.lagerNokkel(S.prosjektInfo ? S.prosjektInfo().nummer : "", S.fileName);
const filnavn = () => nokkel() + ".fdv.json";
const lokalNokkel = () => "storm.fdv." + nokkel();
const innlogget = () => (S.innloggetNavn ? S.innloggetNavn() : "") || "";
const naa = () => new Date().toISOString();

// ---------- Objektene i modellen og lagene ----------
// gid → { gid, kilde: "hoved" | lagId, id, type (Revit-type), ifcType, materiale, fag, modell }
async function byggIndeks() {
  const sign = (S.fileName || "") + "|" + lagene.map(l => l.id).join(",");
  if (tilstand.indeks && tilstand.indeks.sign === sign) return tilstand.indeks;
  const objekter = [], perGid = new Map(), perId = new Map();
  const legg = (o) => { if (!o.gid || perGid.has(o.gid)) return; objekter.push(o); perGid.set(o.gid, o); perId.set(o.kilde + ":" + o.id, o); };
  const revitType = (navn, objType) => String(objType || String(navn || "").replace(/:\d+$/, "")).trim();
  if (S.modelGroup) {
    const E = await import("./elements.js");
    await E.sikreMengder();
    const { metaFor } = await import("./ifcrpc.js");
    for (const id of E.allElementBoxes().keys()) {
      let navn = "", objType = "", ifcType = "", mat = "", gid = "";
      if (S.glbActive) { const p = S.glbProps ? S.glbProps.get(id) : null; if (p) { navn = p[0] || ""; objType = p[1] || ""; ifcType = (p[2] || "").replace(/^Ifc/, ""); mat = p[3] || ""; gid = p[4] || ""; } }
      else { const m = metaFor(id) || {}; navn = m.name || ""; objType = m.objectType || ""; ifcType = m.typeName || ""; mat = m.material || ""; gid = m.globalId || ""; }
      if (F.tellerIkke(navn, mat, ifcType)) continue;
      legg({ gid, kilde: "hoved", id, type: revitType(navn, objType) || ifcType, ifcType, materiale: mat, fag: F.fagFor(navn, mat, ifcType), modell: S.fileName });
    }
  }
  for (const l of lagene) {
    for (const [id, p] of Object.entries(l.props || {})) {
      const [navn, objType, ifcType, mat, gid] = p || [];
      if (F.tellerIkke(navn, mat, ifcType)) continue;
      legg({ gid, kilde: "lag" + l.id, id: Number(id), type: revitType(navn, objType) || ifcType, ifcType: String(ifcType || "").replace(/^Ifc/, ""), materiale: mat || "", fag: F.fagFor(navn, mat, ifcType), modell: l.navn });
    }
  }
  tilstand.indeks = { sign, objekter, perGid, perId };
  return tilstand.indeks;
}

// ---------- Lese og lagre ----------
async function lesGrupper() {
  const k = nokkel();
  if (tilstand.lest === k) return;
  let liste = [];
  try { liste = JSON.parse(localStorage.getItem(lokalNokkel()) || "[]") || []; } catch (_) {}
  if (spPaalogget()) {
    try {
      const r = await spLes(F.FDV_MAPPE, filnavn());
      if (r.status === "ok") liste = flett(liste, r.liste);
    } catch (_) {}
  }
  await lesBib();
  // Dokumenter andre prosjekter har lagt på samme vare, blir med her også
  const varer = new Map(F.levendeVarer(tilstand.bib).map(v => [v.id, v]));
  tilstand.grupper = liste.map(F.vaskGruppe).filter(Boolean).map(g => (g.slettet || !varer.has(F.vareId(g)) ? g : F.flettVareDok(g, varer.get(F.vareId(g)))));
  tilstand.lest = k;
  // Grupper fra før biblioteket fantes (eller laget uten innlogging): inn nå
  const mangler = F.levende(tilstand.grupper).filter(g => !varer.has(F.vareId(g)));
  if (mangler.length) oppdaterBib(mangler);
}
// ---------- 📚 Biblioteket ----------
const BIB_LOKAL = "storm.fdv._bibliotek";
async function lesBib() {
  if (tilstand.bibLest) return;
  let liste = [];
  try { liste = JSON.parse(localStorage.getItem(BIB_LOKAL) || "[]") || []; } catch (_) {}
  if (spPaalogget()) {
    try {
      const r = await spLes(F.FDV_MAPPE, F.BIB_FIL);
      if (r.status === "ok") liste = flettVarer(liste, r.liste);
    } catch (_) {}
  }
  tilstand.bib = liste.map(F.vaskVare).filter(Boolean);
  tilstand.bibLest = true;
}
function flettVarer(a, b) {
  const m = new Map();
  for (const v0 of (b || []).concat(a || [])) { const v = F.vaskVare(v0); if (!v) continue; const f = m.get(v.id); if (!f || String(v.endret) > String(f.endret)) m.set(v.id, v); }
  return [...m.values()];
}
function lagreBib(endrede) {
  if (!endrede.length) return;
  const m = new Map(tilstand.bib.map(v => [v.id, v]));
  for (const v of endrede) m.set(v.id, v);
  tilstand.bib = [...m.values()];
  try { localStorage.setItem(BIB_LOKAL, JSON.stringify(tilstand.bib)); } catch (_) {}
  if (spPaalogget()) spSkriv(F.FDV_MAPPE, F.BIB_FIL, endrede, (p) => String(p && p.id || "")).catch(() => {});
}
// Endrede grupper → varene i biblioteket (gruppa lærer biblioteket typene sine)
function oppdaterBib(endrede) {
  const ut = [];
  for (const g of endrede || []) {
    if (!g || g.slettet) continue;
    if (!g.dokumenter.length && !g.objekter.length && !g.uten3d.length) continue;   // tom «Ny vare» — ikke ennå
    const v = F.vareFraGruppe(tilstand.bib, g, nokkel(), naa(), innlogget());
    if (v) ut.push(v);
  }
  lagreBib(ut);
}
const finnVare = (id) => F.levendeVarer(tilstand.bib).find(v => v.id === id) || null;
// En hel type tatt ut av gruppa = feilkobling: biblioteket glemmer den
function glemTyper(g, typer) {
  const v = finnVare(F.vareId(g));
  if (!v || !typer.length) return;
  let ny = v; for (const ty of typer) ny = F.glemType(ny, ty, naa());
  lagreBib([ny]);
}
function flett(a, b) {
  const m = new Map();
  for (const g of (b || []).concat(a || [])) { const v = F.vaskGruppe(g); if (!v) continue; const f = m.get(v.id); if (!f || String(v.endret) > String(f.endret)) m.set(v.id, v); }
  return [...m.values()];
}
function lagre(endrede) {
  try { localStorage.setItem(lokalNokkel(), JSON.stringify(tilstand.grupper)); } catch (_) {}
  try { oppdaterBib((endrede || []).map(F.vaskGruppe)); } catch (_) {}
  if (spPaalogget() && endrede && endrede.length) spSkriv(F.FDV_MAPPE, filnavn(), endrede.map(F.vaskGruppe).filter(Boolean), (p) => String(p && p.id || "")).catch(() => {});
}
// Ny liste + angre. tekst = hva som skjedde (vises i Angre)
function bytt(nye, tekst, endredeIder) {
  const foer = tilstand.grupper, etter = nye;
  const ider = new Set(endredeIder || []);
  const endret = (liste) => liste.filter(g => g && (!ider.size || ider.has(g.id)));
  const bruk = (liste) => { tilstand.grupper = liste; lagre(endret(liste)); tegn(); };
  bruk(etter);
  if (S.pushAngre) S.pushAngre({ tekst, angre: () => bruk(foer), gjenopprett: () => bruk(etter) });
}
const finn = (id) => F.levende(tilstand.grupper).find(g => g.id === id) || null;

// ---------- PDF-ene ----------
async function lastOpp(fil, bytes) {
  if (!spPaalogget()) { tilstand.minne.set(fil, bytes); tilstand.ulagret.add(fil); return false; }
  const r = await spLastOpp(F.FDV_MAPPE, fil, new Uint8Array(bytes), "application/pdf").catch(() => null);
  if (r && r.ok) { tilstand.ulagret.delete(fil); tilstand.minne.set(fil, bytes); return true; }
  tilstand.minne.set(fil, bytes); tilstand.ulagret.add(fil);
  return false;
}
async function lastOppVentende() {
  for (const fil of [...tilstand.ulagret]) { const b = tilstand.minne.get(fil); if (b) await lastOpp(fil, b); }
  tegn();
}
async function hentPdf(fil) {
  if (tilstand.minne.has(fil)) return tilstand.minne.get(fil);
  const r = await spLesBin(F.FDV_MAPPE, fil);
  if (r && r.status === "ok" && r.data) { tilstand.minne.set(fil, r.data); return r.data; }
  return null;
}
async function apnePdf(fil) {
  const b = await hentPdf(fil).catch(() => null);
  if (!b) { varsel(t("Fant ikke «{0}» i SharePoint (FDV).", fil)); return; }
  const url = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Filer → dokumenter i en (ny eller eksisterende) gruppe
export async function leggTilPdfer(filer, gruppeId) {
  const pdf = [...(filer || [])].filter(f => f && /\.pdf$/i.test(f.name || ""));
  if (!pdf.length) { varsel(t("Slipp PDF-filer.")); return null; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return null; }
  await lesGrupper();
  let g = gruppeId ? finn(gruppeId) : null;
  const ny = !g;
  if (ny) g = F.vaskGruppe({ id: F.nyId(), navn: pdf[0].name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").slice(0, 60), dokumenter: [], objekter: [], endret: naa(), av: innlogget() });
  tilstand.jobber = t("Laster opp {0} PDF …", pdf.length); tegn();
  const dok = [];
  for (const f of pdf) {
    const fil = F.trygtFilnavn(nokkel() + " - " + g.id + " - " + f.name);
    const bytes = await f.arrayBuffer();
    await lastOpp(fil, bytes);
    dok.push(F.vaskDok({ fil, navn: f.name, type: F.gjettDoktype(f.name), lastet: naa(), av: innlogget() }));
  }
  tilstand.jobber = "";
  const oppdatert = Object.assign({}, g, { dokumenter: g.dokumenter.concat(dok), endret: naa() });
  const liste = ny ? tilstand.grupper.concat([oppdatert]) : tilstand.grupper.map(x => (x && x.id === g.id ? oppdatert : x));
  bytt(liste, ny ? t("Ny FDV-gruppe") : t("PDF lagt til i FDV-gruppe"), [g.id]);
  if (ny) startRedigering(g.id);
  if (!spPaalogget()) varsel(t("Ikke lagret i SharePoint — logg inn. PDF-ene lastes opp når du logger inn."));
  return oppdatert;
}

// ---------- Redigering: klikk i 3D legger til / tar ut ----------
export function startRedigering(id) {
  // Emil 30.10 (skjermbilde): «Kote» sto på, så klikkene i 3D gikk til kote-
  // verktøyet og ingenting ble lagt i gruppa. Mål/Kote står med vilje på når
  // man åpner paneler — men å klikke objekter inn i en FDV-gruppe ER et
  // klikkverktøy, så de slås av her.
  if (S.mode) setMode(S.mode);
  tilstand.aktiv = id;
  S.fdvKlikk = klikk;
  window.addEventListener("keydown", escTast, true);
  tegn();
}
export function stoppRedigering() {
  tilstand.aktiv = "";
  if (S.fdvKlikk === klikk) S.fdvKlikk = null;
  window.removeEventListener("keydown", escTast, true);
  tegn();
}
function escTast(e) { if (e.key === "Escape" && tilstand.aktiv) { e.preventDefault(); e.stopImmediatePropagation(); stoppRedigering(); } }

async function objektVed(x, y) {
  const E = await import("./elements.js");
  const h = E.pick(x, y);
  const ek = E.pickEkstra(x, y);
  const ix = await byggIndeks();
  if (ek && /^lag:\d+$/.test(String(ek.lag.id)) && (!h || ek.avstand < h.distance)) return ix.perId.get("lag" + String(ek.lag.id).slice(4) + ":" + ek.id) || null;
  if (h) { const id = E.hitID(h); return id != null ? ix.perId.get("hoved:" + id) || null : null; }
  return null;
}
function klikk(x, y) {
  if (!tilstand.aktiv) return false;
  objektVed(x, y).then(o => {
    if (!o) { varsel(t("Traff ikke et objekt som kan få FDV.")); return; }
    tilstand.sist = o;
    const g = finn(tilstand.aktiv);
    if (!g) return;
    if (g.objekter.some(x2 => x2.gid === o.gid)) {
      bytt(F.taUt(tilstand.grupper, g.id, [o.gid], naa()), t("Tatt ut av FDV-gruppe"), [g.id]);
      varsel(t("«{0}» tatt ut av «{1}».", o.type, g.navn));
    } else {
      const r = F.leggTil(tilstand.grupper, g.id, [{ gid: o.gid, type: o.type }], naa());
      bytt(r.grupper, t("Lagt til i FDV-gruppe"), null);
      varsel(r.flyttet.length ? t("«{0}» flyttet fra «{1}» til «{2}».", o.type, r.flyttet[0].fra, g.navn) : t("«{0}» lagt til i «{1}».", o.type, g.navn));
    }
  });
  return true;
}
// Velger man Mål, Kote o.l. mens en gruppe redigeres, er man ferdig med
// gruppa — ellers ville klikkene stille gått til det andre verktøyet.
{
  const tidligere = S.modusByttet;
  S.modusByttet = (m) => {
    if (tidligere) try { tidligere(m); } catch (_) {}
    if (m && tilstand.aktiv) { stoppRedigering(); varsel(t("FDV-redigeringen er avsluttet fordi et annet verktøy ble valgt. Trykk «Rediger» på gruppa for å fortsette.")); }
  };
}
// Alle med samme Revit-type som sist klikkede (legg til eller ta ut)
export async function alleLike(taUtIstedet) {
  const g = finn(tilstand.aktiv), o = tilstand.sist;
  if (!g || !o) { varsel(t("Klikk først et objekt i 3D.")); return; }
  const ix = await byggIndeks();
  const like = ix.objekter.filter(x => x.type === o.type);
  if (taUtIstedet) { bytt(F.taUt(tilstand.grupper, g.id, like.map(x => x.gid), naa()), t("Tatt ut av FDV-gruppe"), [g.id]); glemTyper(g, [o.type]); }
  else {
    const r = F.leggTil(tilstand.grupper, g.id, like.map(x => ({ gid: x.gid, type: x.type })), naa());
    bytt(r.grupper, t("Lagt til i FDV-gruppe"), null);
  }
  varsel(t(taUtIstedet ? "{0} × «{1}» tatt ut av «{2}»." : "{0} × «{1}» lagt til i «{2}».", like.length, o.type, g.navn));
}

// ---------- Fargene i 3D ----------
const fargeGruppe = new THREE.Group();
fargeGruppe.name = "fdv-farger";
scene.add(fargeGruppe);
const FARGE = { gronn: 0x3cb44b, gul: 0xe9a13b, rod: 0xd22b34, aktiv: 0x3b82f6 };
function ryddFarger() {
  fargeGruppe.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  fargeGruppe.clear();
}
let fargeRunde = 0;
async function tegnFarger() {
  const runde = ++fargeRunde;   // en ny tegning avbryter en som ikke er ferdig
  ryddFarger();
  const p = $("fdvPanel");
  if (!tilstand.farger || !p || !p.classList.contains("open") || !S.modelGroup) return;
  const ix = await byggIndeks();
  const E = await import("./elements.js");
  if (runde !== fargeRunde) return;
  ryddFarger();
  const kart = F.objektKart(tilstand.grupper);
  const aktiv = finn(tilstand.aktiv);
  const iAktiv = new Set(aktiv ? aktiv.objekter.map(o => o.gid) : []);
  const bøtter = { gronn: [], gul: [], rod: [], aktiv: [] };
  for (const o of ix.objekter) {
    const f = iAktiv.has(o.gid) ? "aktiv" : (kart.get(o.gid) || { farge: "rod" }).farge;
    bøtter[f].push(o);
  }
  const v = new THREE.Vector3();
  for (const [f, liste] of Object.entries(bøtter)) {
    if (!liste.length) continue;
    const pos = [];
    const hoved = new Set(liste.filter(o => o.kilde === "hoved").map(o => o.id));
    if (hoved.size) E.forHverTrekant(hoved, (pp, a, b, c, mtx) => { for (const i of [a, b, c]) { v.fromBufferAttribute(pp, i); if (mtx) v.applyMatrix4(mtx); pos.push(v.x, v.y, v.z); } });
    for (const l of lagene) {
      if (!l.gruppe || !l.synlig) continue;
      const ider = new Set(liste.filter(o => o.kilde === "lag" + l.id).map(o => o.id));
      if (!ider.size) continue;
      l.gruppe.updateMatrixWorld(true);
      for (const m of l.gruppe.children) {
        if (!m.isMesh || !m.userData.ranges || !m.geometry.getIndex()) continue;
        const pp = m.geometry.getAttribute("position"), ix2 = m.geometry.getIndex();
        for (const r of m.userData.ranges) if (ider.has(r.id)) for (let i = r.start; i < r.start + r.count; i++) { v.fromBufferAttribute(pp, ix2.getX(i)).applyMatrix4(m.matrixWorld); pos.push(v.x, v.y, v.z); }
      }
    }
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    const mat = new THREE.MeshBasicMaterial({ color: FARGE[f], transparent: true, opacity: f === "aktiv" ? 0.85 : 0.7, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 990;
    mesh.raycast = () => {};   // fargene skal ikke kunne trykkes på
    fargeGruppe.add(mesh);
  }
}

// ---------- Eksport ----------
export async function lastNedPakke() {
  if (tilstand.jobber) return;   // dobbeltklikk: én pakke om gangen
  tilstand.jobber = t("Lager FDV-pakken …"); tegn();
  try {
    await lesGrupper();
    const ix = await byggIndeks();
    const X = await import("./xlsx.js");
    const { excelToppfelt } = await import("./excel-logo.js");
    const { lagZip } = await import("./bcf.js");
    const ark = [{ navn: t("FDV-register"), rader: F.registerRader(ix.objekter, tilstand.grupper, t) }, { navn: t("FDV-grupper"), rader: F.gruppeRader(tilstand.grupper, t) }];
    const xlsx = X.lagXlsxFlere(ark, await excelToppfelt());
    const filer = [{ navn: nokkel() + " FDV-register.xlsx", data: xlsx }];
    let mangler = 0;
    for (const g of F.levende(tilstand.grupper)) for (const d of g.dokumenter) {
      const b = await hentPdf(d.fil).catch(() => null);
      if (b) filer.push({ navn: F.zipSti(g, d), data: new Uint8Array(b) }); else mangler++;
    }
    const zip = lagZip(filer);
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const a = document.createElement("a"); a.href = url; a.download = nokkel() + " FDV.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    varsel(mangler ? t("FDV-pakken er lastet ned, men {0} PDF-er fantes ikke.", mangler) : t("FDV-pakken er lastet ned ({0} PDF-er + register).", filer.length - 1));
  } catch (err) {
    varsel(t("Klarte ikke å lage FDV-pakken: {0}", err.message));
  } finally { tilstand.jobber = ""; tegn(); }
}

// ---------- 📚 Bruk en vare fra biblioteket ----------
// medObjekter: legg også inn de ledige objektene med typene varen kjenner
export async function brukVare(id, medObjekter, rediger) {
  await lesGrupper();
  const v = finnVare(id);
  if (!v) return null;
  if (F.levende(tilstand.grupper).some(g => F.vareId(g) === v.id)) { varsel(t("«{0}» er allerede i dette prosjektet.", v.navn)); return null; }
  let g = F.gruppeFraVare(v, naa(), innlogget());
  let liste = tilstand.grupper.concat([g]);
  let n = 0;
  if (medObjekter) {
    const ix = await byggIndeks();
    const f = F.forslag([v], tilstand.grupper, ix.objekter)[0];
    if (f) { liste = F.leggTil(liste, g.id, f.objekter, naa()).grupper; n = f.objekter.length; }
  }
  bytt(liste, t("Vare hentet fra FDV-biblioteket"), [g.id]);
  tilstand.fane = "prosjekt";
  if (rediger) startRedigering(g.id); else tegn();
  varsel(n ? t("«{0}» hentet fra biblioteket med {1} objekter.", v.navn, n) : t("«{0}» hentet fra biblioteket. Klikk objektene i 3D som hører til.", v.navn));
  return finn(g.id);
}
export async function brukAlleForslag() {
  await lesGrupper();
  const ix = await byggIndeks();
  const fs = F.forslag(tilstand.bib, tilstand.grupper, ix.objekter);
  if (!fs.length) return 0;
  let liste = tilstand.grupper; const ider = [];
  for (const f of fs) {
    const g = F.gruppeFraVare(f.vare, naa(), innlogget());
    liste = F.leggTil(liste.concat([g]), g.id, f.objekter, naa()).grupper; ider.push(g.id);
  }
  bytt(liste, t("Varer hentet fra FDV-biblioteket"), ider);
  varsel(t("{0} varer hentet fra biblioteket.", fs.length));
  return fs.length;
}
// Ny vare uten PDF (f.eks. spiker — PDF-en kommer senere)
export function nyTomVare() {
  const g = F.vaskGruppe({ id: F.nyId(), navn: t("Ny vare"), dokumenter: [], objekter: [], endret: naa(), av: innlogget() });
  bytt(tilstand.grupper.concat([g]), t("Ny FDV-gruppe"), [g.id]);
  startRedigering(g.id);
  return g;
}
// 🔩 Linjer uten 3D i gruppa
export function leggTilLinje(gruppeId, navn, mengde, enhet) {
  const l = F.vaskLinje({ id: F.nyId(), navn, mengde, enhet });
  const g = finn(gruppeId);
  if (!l || !g) { varsel(t("Skriv navnet på varen.")); return null; }
  bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { uten3d: (x.uten3d || []).concat([l]), endret: naa() }) : x)), t("Vare uten 3D lagt til"), [g.id]);
  return l;
}
function endreLinjer(gruppeId, gjor, tekst) {
  const g = finn(gruppeId); if (!g) return;
  bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { uten3d: gjor(g.uten3d), endret: naa() }) : x)), tekst, [g.id]);
}
function slettVare(id) {
  const v = finnVare(id);
  if (!v || !confirm(t("Slette «{0}» fra FDV-biblioteket? Prosjektene som bruker varen beholder gruppa si. PDF-ene blir liggende i SharePoint.", v.navn))) return;
  lagreBib([{ id: v.id, slettet: true, endret: naa() }]);
  tegn();
}

// ---------- Panelet ----------
const DOKNAVN = (k) => t((F.DOKTYPER.find(d => d.k === k) || F.DOKTYPER[4]).navn);
export async function tegn() {
  const body = $("fdvBody");
  if (!body) return;
  const p = $("fdvPanel");
  if (!p || !p.classList.contains("open")) { ryddFarger(); return; }
  const ix = await byggIndeks();
  const kart = F.objektKart(tilstand.grupper);
  const grupper = F.levende(tilstand.grupper);
  const varer = F.levendeVarer(tilstand.bib);
  let h = '<div class="lag-faner fdv-faner"><button data-fdv-fane="prosjekt" class="' + (tilstand.fane === "prosjekt" ? "active" : "") + '">' + esc(t("Dette prosjektet")) + '</button>' +
    '<button data-fdv-fane="bibliotek" class="' + (tilstand.fane === "bibliotek" ? "active" : "") + '">' + esc(t("Bibliotek · {0}", varer.length)) + '</button></div>';
  if (!spPaalogget()) h += '<div class="lag-ulagret">⚠ ' + esc(t("Ikke lagret — logg inn på SharePoint")) + ' <button data-fdv-logginn>' + esc(t("Logg inn")) + '</button></div>';
  else if (tilstand.ulagret.size) h += '<div class="lag-ulagret">⚠ ' + esc(t("{0} PDF-er venter på opplasting", tilstand.ulagret.size)) + ' <button data-fdv-lastopp>' + esc(t("Prøv igjen")) + '</button></div>';
  if (tilstand.fane === "bibliotek") { body.innerHTML = h + bibHtml(varer, grupper); koble(body); tegnFarger(); return; }
  // 💡 Forslag fra biblioteket (typer som er koblet i tidligere prosjekter)
  const fs = tilstand.skjulForslag === nokkel() ? [] : F.forslag(tilstand.bib, tilstand.grupper, ix.objekter);
  if (fs.length) {
    h += '<div class="fdv-forslag"><b>💡 ' + esc(t("{0} varer fra biblioteket passer modellen", fs.length)) + '</b>';
    for (const f of fs.slice(0, 12)) h += '<div class="fdv-fl"><span>' + esc(f.vare.navn) + ' → ' + f.typer.map(x => '<span class="fdv-tag">' + esc(x.type) + '</span>').join(" ") + ' ' + esc(t("{0} obj", f.antall)) + '</span><button class="primary" data-fdv-bruk="' + esc(f.vare.id) + '">' + esc(t("Bruk")) + '</button></div>';
    h += '<div class="lag-knapper"><button data-fdv-brukalle>' + esc(t("Bruk alle {0}", fs.length)) + '</button><button data-fdv-skjulforslag>' + esc(t("Skjul")) + '</button></div></div>';
  }
  h += '<div class="koll-lbl">' + esc(t("STATUS PER FAG")) + '<span>' + esc(t("{0} objekter", ix.objekter.length)) + '</span></div>';
  for (const s of F.statusPerFag(ix.objekter, kart, tilstand.grupper)) {
    const farge = s.prosent >= 100 ? "var(--ok)" : s.prosent > 0 ? "var(--warn)" : "var(--danger)";
    h += '<div class="fdv-fag"><b>' + esc(t(s.fag)) + '</b><span class="fdv-bar"><i style="width:' + s.prosent + '%;background:' + farge + '"></i></span><span>' + s.prosent + ' %</span></div>';
  }
  h += '<label class="fdv-farger"><input type="checkbox" id="fdvFarger"' + (tilstand.farger ? " checked" : "") + '> ' + esc(t("Fargelegg modellen")) +
    ' <span class="fdv-prikk" style="background:#3cb44b"></span>' + esc(t("ferdig")) + ' <span class="fdv-prikk" style="background:#e9a13b"></span>' + esc(t("mangler dokument")) +
    ' <span class="fdv-prikk" style="background:#d22b34"></span>' + esc(t("ikke i gruppe")) + '</label>';
  h += '<div class="lag-slipp" id="fdvSlipp">' + esc(t("Slipp FDV-PDF-er her → ny FDV-gruppe")) + '<input type="file" id="fdvFil" accept=".pdf" multiple hidden></div>' +
    '<div class="lag-knapper"><button data-fdv-tom>' + esc(t("＋ Ny vare uten PDF (skriv inn)")) + '</button></div>';
  if (tilstand.jobber) h += '<div class="koll-jobb">' + esc(tilstand.jobber) + '</div>';
  h += '<div class="koll-lbl">' + esc(t("FDV-GRUPPER · {0}", grupper.length)) + '</div>';
  if (!grupper.length) h += '<p class="lag-tom">' + esc(t("Ingen FDV-grupper ennå. Slipp PDF-ene for en vare i ruta over, og klikk objektene i 3D som hører til.")) + '</p>';
  for (const g of grupper) {
    const st = F.gruppeStatus(g), aktiv = g.id === tilstand.aktiv;
    h += '<div class="fdv-gruppe' + (aktiv ? " aktiv" : "") + '" data-fdv-gruppe="' + esc(g.id) + '">' +
      '<div class="fdv-gh"><span class="fdv-pill ' + (st.ferdig ? "g" : st.har.length ? "y" : "r") + '">' + st.har.length + '/' + st.krav.length + '</span>' +
      (aktiv ? '<input type="text" class="fdv-navn" data-fdv-navn="' + esc(g.id) + '" value="' + esc(g.navn) + '">' : '<b>' + esc(g.navn) + '</b>') +
      (g.fraBib ? '<span class="fdv-tag" title="' + esc(t("fra biblioteket")) + '">📚</span>' : "") +
      (g.uten3d.length && !g.objekter.length ? '<span class="fdv-tag uten">' + esc(t("uten 3D")) + '</span>' : '<span class="fdv-ant">' + esc(t("{0} objekter", g.objekter.length)) + '</span>') + '</div>';
    if (aktiv) {
      h += '<div class="fdv-hint">👆 ' + esc(t("Klikk objektene i 3D som hører til (blå). Klikk igjen for å ta ut. Esc = ferdig.")) + '</div>' +
        '<div class="lag-knapper"><button data-fdv-like>' + esc(t("Marker alle like")) + '</button><button data-fdv-ikkelike>' + esc(t("Fjern alle like")) + '</button><button class="primary" data-fdv-ferdig>' + esc(t("Ferdig")) + '</button></div>';
      for (const d of F.DOKTYPER.filter(x => x.k !== "annet")) {
        const ia = g.ikkeAktuelt.includes(d.k);
        const har = g.dokumenter.filter(x => x.type === d.k);
        h += '<div class="fdv-dok"><span>' + esc(t(d.navn)) + '</span>' + (har.length ? '<span class="ok">✓ ' + har.length + '</span>' : ia ? '<span class="fdv-ia">' + esc(t("ikke aktuelt")) + '</span>' : '<span class="mangler">' + esc(t("mangler")) + '</span>') +
          '<label class="fdv-ia-valg" title="' + esc(t("Ikke aktuelt for denne varen")) + '"><input type="checkbox" data-fdv-ia="' + d.k + '"' + (ia ? " checked" : "") + '> ' + esc(t("ikke aktuelt")) + '</label></div>';
      }
      h += g.dokumenter.map((d, i) => '<div class="fdv-fil"><a href="#" data-fdv-apne="' + esc(d.fil) + '">📄 ' + esc(d.navn) + '</a>' + (tilstand.ulagret.has(d.fil) ? ' <span class="mangler">⚠</span>' : "") +
        '<select data-fdv-type="' + i + '">' + F.DOKTYPER.map(x => '<option value="' + x.k + '"' + (x.k === d.type ? " selected" : "") + '>' + esc(t(x.navn)) + '</option>').join("") + '</select>' +
        '<button class="lag-x" data-fdv-fjerndok="' + i + '" title="' + esc(t("Fjern dokumentet")) + '">✕</button></div>').join("");
      h += '<div class="lag-slipp liten" data-fdv-slipp="' + esc(g.id) + '">' + esc(t("Slipp flere PDF-er på denne gruppa")) + '</div>';
      h += '<div class="koll-lbl">' + esc(t("VARER UTEN 3D-MODELL")) + '</div>';
      h += g.uten3d.map((l, i) => '<div class="fdv-u3"><span>' + esc(l.navn) + '</span><input type="text" inputmode="decimal" class="fdv-u3m" data-fdv-u3mengde="' + i + '" value="' + (l.mengde == null ? "" : String(l.mengde).replace(".", ",")) + '" placeholder="' + esc(t("mengde")) + '"><span class="fdv-u3e">' + esc(l.enhet) + '</span><button class="lag-x" data-fdv-u3fjern="' + i + '" title="' + esc(t("Fjern")) + '">✕</button></div>').join("");
      h += '<div class="fdv-u3 ny"><input type="text" id="fdvU3Navn" placeholder="' + esc(t("Navn, f.eks. Skruer 6×60 A4")) + '"><input type="text" inputmode="decimal" id="fdvU3Mengde" class="fdv-u3m" placeholder="' + esc(t("mengde")) + '">' +
        '<select id="fdvU3Enhet">' + F.ENHETER.map(e => '<option>' + esc(e) + '</option>').join("") + '</select><button class="primary" data-fdv-u3ny>＋</button></div>';
      const pt = F.perType(g);
      if (pt.length) h += '<div class="koll-lbl">' + esc(t("OBJEKTER I GRUPPA")) + '</div>' + pt.map(x => '<div class="fdv-obj"><span>' + esc(x.type) + '</span><b>' + x.antall + '</b><button class="lag-x" data-fdv-fjerntype="' + esc(x.type) + '" title="' + esc(t("Ta ut av gruppa")) + '">✕</button></div>').join("");
      h += '<div class="lag-knapper"><button data-fdv-slett>' + esc(t("Slett gruppa")) + '</button></div>';
    } else {
      h += '<div class="fdv-sub">' + esc(F.perType(g).slice(0, 3).map(x => x.type + " (" + x.antall + ")").concat(g.uten3d.slice(0, 3).map(l => l.navn + " (" + F.mengdeTekst(l) + ")")).join(" · ") || t("ingen objekter ennå")) +
        (st.mangler.length ? ' · ' + esc(t("mangler {0}", st.mangler.map(DOKNAVN).join(", "))) : "") + '</div>' +
        '<div class="lag-knapper"><button data-fdv-rediger="' + esc(g.id) + '">' + esc(t("Rediger")) + '</button></div>';
    }
    h += '</div>';
  }
  h += '<div class="lag-knapper"><button class="primary" id="fdvPakke"' + (grupper.length ? "" : " disabled") + '>' + esc(t("FDV-pakke (Excel + ZIP)")) + '</button></div>';
  body.innerHTML = h;
  koble(body);
  tegnFarger();
}

function bibHtml(varer, grupper) {
  const brukt = new Set(grupper.map(F.vareId));
  const treff = F.sokVarer(tilstand.bib, tilstand.sok);
  let h = '<input type="search" class="fdv-sok" id="fdvSok" placeholder="🔍 ' + esc(t("Søk i biblioteket (navn eller Revit-type)")) + '" value="' + esc(tilstand.sok) + '">';
  if (!varer.length) return h + '<p class="lag-tom">' + esc(t("Biblioteket er tomt. Hver FDV-gruppe du lager i et prosjekt, havner her av seg selv — med PDF-ene og Revit-typene.")) + '</p>';
  if (!treff.length) h += '<p class="lag-tom">' + esc(t("Ingen treff.")) + '</p>';
  for (const v of treff.slice(0, 80)) {
    const st = F.gruppeStatus(v);
    h += '<div class="fdv-gruppe fdv-vare"><div class="fdv-gh"><b>' + esc(v.navn) + '</b>' +
      (v.uten3d.length && !v.typer.length ? '<span class="fdv-tag uten">' + esc(t("uten 3D")) + '</span>' : "") +
      '<span class="fdv-pill ' + (st.ferdig ? "g" : st.har.length ? "y" : "r") + '">' + st.har.length + '/' + st.krav.length + '</span></div>' +
      '<div class="fdv-sub">' + esc(t("Brukt i {0} prosjekter", v.prosjekter.length)) + (v.typer.length ? ' · ' + esc(t("Revit-typer: {0}", v.typer.slice(0, 4).join(", ") + (v.typer.length > 4 ? " …" : ""))) : "") +
      (v.uten3d.length ? ' · ' + esc(v.uten3d.slice(0, 3).map(l => l.navn + " (" + l.enhet + ")").join(", ")) : "") + '</div>' +
      (v.dokumenter.length ? '<div class="fdv-sub">' + v.dokumenter.map(d => '<a href="#" data-fdv-apne="' + esc(d.fil) + '">📄 ' + esc(DOKNAVN(d.type)) + '</a>').join(" · ") + '</div>' : "") +
      '<div class="lag-knapper">' + (brukt.has(v.id) ? '<span class="fdv-ibruk">✓ ' + esc(t("i dette prosjektet")) + '</span>' : '<button class="primary" data-fdv-brukbib="' + esc(v.id) + '">' + esc(t("Bruk i dette prosjektet")) + '</button>') +
      '<button class="lag-x" data-fdv-slettvare="' + esc(v.id) + '" title="' + esc(t("Slett fra biblioteket")) + '">🗑</button></div></div>';
  }
  h += '<p class="fdv-note">' + esc(t("Biblioteket ligger i SharePoint (FDV/_bibliotek.fdv.json) og er felles for alle prosjekter. En PDF lagt på en vare i ett prosjekt, kommer med i de andre prosjektene som bruker varen.")) + '</p>';
  return h;
}

function koble(body) {
  body.querySelectorAll("[data-fdv-fane]").forEach(b => b.onclick = () => { tilstand.fane = b.dataset.fdvFane; if (tilstand.aktiv && tilstand.fane !== "prosjekt") stoppRedigering(); else tegn(); });
  body.querySelectorAll("[data-fdv-bruk]").forEach(b => b.onclick = () => brukVare(b.dataset.fdvBruk, true, false));
  body.querySelectorAll("[data-fdv-brukbib]").forEach(b => b.onclick = () => brukVare(b.dataset.fdvBrukbib, true, true));
  body.querySelectorAll("[data-fdv-brukalle]").forEach(b => b.onclick = () => brukAlleForslag());
  body.querySelectorAll("[data-fdv-skjulforslag]").forEach(b => b.onclick = () => { tilstand.skjulForslag = nokkel(); tegn(); });
  body.querySelectorAll("[data-fdv-slettvare]").forEach(b => b.onclick = () => slettVare(b.dataset.fdvSlettvare));
  body.querySelectorAll("[data-fdv-tom]").forEach(b => b.onclick = () => nyTomVare());
  const sok = body.querySelector("#fdvSok");
  if (sok) sok.oninput = () => { tilstand.sok = sok.value; const pos = sok.selectionStart; tegn().then(() => { const n = $("fdvSok"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } }); };
  const fa = body.querySelector("#fdvFarger"); if (fa) fa.onchange = () => { tilstand.farger = fa.checked; tegnFarger(); };
  const sl = body.querySelector("#fdvSlipp"), fil = body.querySelector("#fdvFil");
  if (sl) {
    sl.onclick = () => fil && fil.click();
    slippRute(sl, (filer) => leggTilPdfer(filer, null));
  }
  if (fil) fil.onchange = () => { leggTilPdfer(fil.files, null); fil.value = ""; };
  body.querySelectorAll("[data-fdv-slipp]").forEach(r => slippRute(r, (filer) => leggTilPdfer(filer, r.dataset.fdvSlipp)));
  body.querySelectorAll("[data-fdv-rediger]").forEach(b => b.onclick = () => startRedigering(b.dataset.fdvRediger));
  const g = finn(tilstand.aktiv);
  body.querySelectorAll("[data-fdv-ferdig]").forEach(b => b.onclick = () => stoppRedigering());
  body.querySelectorAll("[data-fdv-like]").forEach(b => b.onclick = () => alleLike(false));
  body.querySelectorAll("[data-fdv-ikkelike]").forEach(b => b.onclick = () => alleLike(true));
  body.querySelectorAll("[data-fdv-navn]").forEach(inp => inp.onchange = () => {
    const n = inp.value.trim(); if (!g || !n || n === g.navn) return;
    bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { navn: n.slice(0, 80), endret: naa() }) : x)), t("FDV-gruppe omdøpt"), [g.id]);
  });
  body.querySelectorAll("[data-fdv-ia]").forEach(c => c.onchange = () => {
    if (!g) return;
    const ia = new Set(g.ikkeAktuelt); if (c.checked) ia.add(c.dataset.fdvIa); else ia.delete(c.dataset.fdvIa);
    bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { ikkeAktuelt: [...ia], endret: naa() }) : x)), t("FDV-gruppe endret"), [g.id]);
  });
  body.querySelectorAll("[data-fdv-type]").forEach(s => s.onchange = () => {
    if (!g) return;
    const dok = g.dokumenter.map((d, i) => (i === Number(s.dataset.fdvType) ? Object.assign({}, d, { type: s.value }) : d));
    bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { dokumenter: dok, endret: naa() }) : x)), t("FDV-gruppe endret"), [g.id]);
  });
  body.querySelectorAll("[data-fdv-fjerndok]").forEach(b => b.onclick = () => {
    if (!g) return;
    const dok = g.dokumenter.filter((d, i) => i !== Number(b.dataset.fdvFjerndok));
    bytt(tilstand.grupper.map(x => (x && x.id === g.id ? Object.assign({}, x, { dokumenter: dok, endret: naa() }) : x)), t("Dokument fjernet fra FDV-gruppe"), [g.id]);
  });
  body.querySelectorAll("[data-fdv-apne]").forEach(a => a.onclick = (e) => { e.preventDefault(); apnePdf(a.dataset.fdvApne); });
  body.querySelectorAll("[data-fdv-fjerntype]").forEach(b => b.onclick = () => {
    if (!g) return;
    const gids = g.objekter.filter(o => o.type === b.dataset.fdvFjerntype).map(o => o.gid);
    bytt(F.taUt(tilstand.grupper, g.id, gids, naa()), t("Tatt ut av FDV-gruppe"), [g.id]);
    glemTyper(g, [b.dataset.fdvFjerntype]);
  });
  // 🔩 Varer uten 3D
  body.querySelectorAll("[data-fdv-u3ny]").forEach(b => b.onclick = () => {
    if (!g) return;
    const n = $("fdvU3Navn"), m = $("fdvU3Mengde"), e = $("fdvU3Enhet");
    if (leggTilLinje(g.id, n ? n.value : "", m ? m.value : "", e ? e.value : "stk")) { const ny = $("fdvU3Navn"); if (ny) ny.focus(); }
  });
  const u3n = body.querySelector("#fdvU3Navn"), u3m = body.querySelector("#fdvU3Mengde");
  [u3n, u3m].forEach(inp => { if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); const k = body.querySelector("[data-fdv-u3ny]"); if (k) k.click(); } }; });
  body.querySelectorAll("[data-fdv-u3fjern]").forEach(b => b.onclick = () => {
    if (!g) return; const i = Number(b.dataset.fdvU3fjern);
    endreLinjer(g.id, (ls) => ls.filter((_, j) => j !== i), t("Vare uten 3D fjernet"));
  });
  body.querySelectorAll("[data-fdv-u3mengde]").forEach(inp => inp.onchange = () => {
    if (!g) return; const i = Number(inp.dataset.fdvU3mengde);
    endreLinjer(g.id, (ls) => ls.map((l, j) => (j === i ? F.vaskLinje(Object.assign({}, l, { mengde: inp.value })) : l)), t("Mengde endret"));
  });
  body.querySelectorAll("[data-fdv-slett]").forEach(b => b.onclick = () => {
    if (!g || !confirm(t("Slette FDV-gruppa «{0}»? Objektene blir røde igjen. PDF-ene blir liggende i SharePoint.", g.navn))) return;
    const id = g.id; stoppRedigering();
    bytt(tilstand.grupper.map(x => (x && x.id === id ? { id, slettet: true, endret: naa() } : x)), t("FDV-gruppe slettet"), [id]);
  });
  body.querySelectorAll("[data-fdv-logginn]").forEach(b => b.onclick = async () => { try { (await import("./sharepoint.js")).spToken(); } catch (_) {} });
  body.querySelectorAll("[data-fdv-lastopp]").forEach(b => b.onclick = () => lastOppVentende());
  // Pakke-knappen fanges på panelet (ikke på selve knappen): tegn() kan bytte
  // ut knappen mens Emil klikker, og da ville klikket ellers forsvunnet.
  if (!body.dataset.pakke) { body.dataset.pakke = "1"; body.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("#fdvPakke")) lastNedPakke(); }); }
}
function slippRute(el, gjor) {
  el.ondragover = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); el.classList.add("over"); const h = $("dropHint"); if (h) h.classList.remove("open"); } };
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = (e) => { e.preventDefault(); e.lagHåndtert = true; el.classList.remove("over"); const h = $("dropHint"); if (h) h.classList.remove("open"); gjor(e.dataTransfer ? e.dataTransfer.files : []); };
}

på("btnFdv", "click", async () => {
  const p = $("fdvPanel");
  if (p && p.classList.contains("open")) { p.classList.remove("open"); stoppRedigering(); ryddFarger(); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  apnePanel("fdvPanel");
  $("fdvBody").innerHTML = '<p class="lag-tom">' + esc(t("Leser modellen …")) + '</p>';
  await lesGrupper();
  tegn();
});
document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest('[data-lukk="fdvPanel"]')) { stoppRedigering(); setTimeout(ryddFarger, 0); } });
// Et annet panel åpnes (apnePanel lukker dette): fargene og redigeringen av
{
  const tidligere = S.avsluttKlikkModus;
  S.avsluttKlikkModus = (id) => { if (tidligere) try { tidligere(id); } catch (_) {} if (id !== "fdvPanel" && tilstand.aktiv) stoppRedigering(); if (id !== "fdvPanel") ryddFarger(); };
}
// Modellbytte: indeksen og lesingen hører til den gamle modellen
{
  const tidligere = S.ryddLag;
  S.ryddLag = () => { if (tidligere) tidligere(); tilstand.indeks = null; tilstand.lest = ""; tilstand.aktiv = ""; S.fdvKlikk = null; ryddFarger(); };
}
// Innlogget (popup): last opp PDF-ene som venter, og les gruppene fra SharePoint
{
  const tidligere = S.onSignedIn;
  S.onSignedIn = () => { if (tidligere) try { tidligere(); } catch (_) {} tilstand.lest = ""; tilstand.bibLest = false; setTimeout(async () => { await lastOppVentende(); const p = $("fdvPanel"); if (p && p.classList.contains("open")) { await lesGrupper(); tegn(); } }, 0); };
}
export { byggIndeks as _byggIndeks, lesGrupper as _lesGrupper, klikk as _klikk, fargeGruppe as _fargeGruppe, tegnFarger as _tegnFarger };
