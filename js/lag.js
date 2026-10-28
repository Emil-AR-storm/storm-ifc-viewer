// 🧅 LAG — modeller oppå hovedmodellen (byggeplan runde 5 / 9a, bygget 28.10.2026).
//
// Emils valg B: et panel i Bygg Info med ETT KORT PER LAG — antall, vekt og
// dimensjoner rett på kortet, gjennomsiktighet med glidebryter, og «Legg til
// lag» nederst i panelet med fremdrift mens IFC-en gjøres om.
//
// HOVEDMODELLEN ER URØRT. Viewer'en har én modell om gangen (S.modelGroup),
// og alle verktøy hører til den. Et lag er en egen THREE.Group i scenen som
// melder seg inn i EKSTRA_LAG (state.js) med evnene plukk, velg,
// visEgenskaper, noeSkjult, visAlt og skjulTilstand — da virker klikk,
// Vis alle, Gjennomsiktig og Angre på lagene uten at de verktøyene vet om dem.
//
// PLASSERING: T = hoved.kote⁻¹ · lag.kote (se lag-regn.js lagTransform).
// Testet på Lørenskog (betong + armering fra samme Revit-prosjekt, 28.10).
//
// LAGRING: et ferdig omgjort lag lagres som «<navn>.lag.glb» i SharePoint-
// mappa «Lag» (under IFC-modeller). Neste gang samme fil (samme størrelse og
// endret-dato) legges til, hentes GLB-en i stedet — sekunder i stedet for
// minutter. Ingen lag på byggeplass-siden ennå (Emil 28.10: vent).
//
// Modellgruppe (lagre/åpne et sett lag) og «Mengder per lag» kommer i runde 5b.
import * as THREE from "three";
import { $, S, apnePanel, avregistrerEkstraGruppe, esc, ikon, på, registrerEkstraGruppe } from "./state.js";
import { camera, flyTil, pointer, raycaster, renderer, scene } from "./scene.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { clearSelection, hitID } from "./elements.js";
import { spLastOpp, spLesBin, spPaalogget } from "./sp-lager.js";
import * as R from "./lag-regn.js";

export const LAG_MAPPE = "Lag";
const lagene = [];               // { id, navn, fag, farge, gjennom, synlig, kilde, gruppe, props, tall, sum, … }
export const _lagene = lagene;   // testene
const tilstand = {
  kilde: null,                   // { art: "bibliotek", item } | { art: "disk", fil }
  fag: "", farge: "",
  bibliotek: null, bibStatus: "",
  jobber: null,                  // { tekst, andel } mens et lag gjøres om
  bareLag: null                  // { id, foer: [...] } når «Bare dette laget» er på
};
export const _tilstand = tilstand;
let nesteId = 1;

// ---------- Scenen ----------
function lagMateriale(lag) {
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(lag.farge), side: THREE.DoubleSide });
  settGjennomsiktig(m, lag.gjennom);
  return m;
}
function settGjennomsiktig(m, prosent) {
  const p = Math.max(0, Math.min(95, Number(prosent) || 0));
  m.transparent = p > 0;
  m.opacity = 1 - p / 100;
  m.depthWrite = p < 50;
  m.needsUpdate = true;
}

// deler: [{ pos, norm?, idx, ranges }] i lagets egne koordinater
function byggGruppe(lag, deler) {
  const g = new THREE.Group();
  g.name = "lag:" + lag.id;
  g.matrixAutoUpdate = false;
  g.matrix.fromArray(lag.T);
  lag.materiale = lagMateriale(lag);
  for (const d of deler) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
    if (d.norm) bg.setAttribute("normal", new THREE.BufferAttribute(d.norm, 3));
    bg.setIndex(new THREE.BufferAttribute(d.idx, 1));
    if (!d.norm) bg.computeVertexNormals();
    const mesh = new THREE.Mesh(bg, lag.materiale);
    mesh.userData.merged = true;
    mesh.userData.ranges = d.ranges;
    mesh.userData.origMat = lag.materiale;
    mesh.userData.lagId = lag.id;
    g.add(mesh);
  }
  const hl = new THREE.Group();
  hl.name = "lag-valg";
  g.add(hl);
  lag.valgGruppe = hl;
  lag.gruppe = g;
  // ETTER at barna er lagt inn: ellers står meshene med enhetsmatrise til
  // første omtegning, og et klikk før det ville bommet på et flyttet lag.
  g.updateMatrixWorld(true);
  return g;
}

function boksFor(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  return b.isEmpty() ? null : { min: b.min.toArray(), max: b.max.toArray() };
}

// ---------- Kontrakten mot resten av viewer'en ----------
function kontrakt(lag) {
  return {
    id: "lag:" + lag.id,
    navn: lag.navn,
    plukk(cx, cy) {
      if (!lag.synlig || !lag.gruppe) return null;
      pointer.x = (cx / innerWidth) * 2 - 1;
      pointer.y = -(cy / innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const kandidater = lag.gruppe.children.filter(m => m.isMesh && m.visible);
      const treff = raycaster.intersectObjects(kandidater, false);
      for (const h of treff) {
        if (renderer.clippingPlanes.length && !renderer.clippingPlanes.every(p => p.distanceToPoint(h.point) >= -0.001)) continue;
        const id = hitID(h);
        if (id == null) continue;
        const p = lag.props[id];
        return { id, navn: (p && p[0]) || "", avstand: h.distance };
      }
      return null;
    },
    velg(ider) { velgILag(lag, ider || []); },
    valgte: () => [...(lag.valgt || [])],
    visEgenskaper(id) { visEgenskaper(lag, id); },
    noeSkjult: () => !lag.synlig,
    visAlt() { if (!lag.synlig) { lag.synlig = true; lag.gruppe.visible = true; tegn(); } },
    skjulTilstand: () => ({ synlig: lag.synlig }),
    settSkjulTilstand(v) { lag.synlig = !(v && v.synlig === false); if (lag.gruppe) lag.gruppe.visible = lag.synlig; tegn(); }
  };
}

function velgILag(lag, ider) {
  lag.valgt = new Set(ider);
  const hl = lag.valgGruppe;
  if (!hl) return;
  hl.children.forEach(m => m.geometry.dispose());
  hl.clear();
  if (!ider.length) return;
  const sett = new Set(ider.map(Number));
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const m of lag.gruppe.children) {
    if (!m.isMesh || !m.userData.ranges) continue;
    const rs = m.userData.ranges.filter(r => sett.has(r.id));
    if (!rs.length) continue;
    const p = m.geometry.getAttribute("position").array, ix = m.geometry.getIndex().array;
    let n = 0; rs.forEach(r => { n += r.count; });
    const arr = new Float32Array(n * 3);
    let o = 0;
    for (const r of rs) for (let i = r.start; i < r.start + r.count; i++) {
      const vi = ix[i] * 3; arr[o++] = p[vi]; arr[o++] = p[vi + 1]; arr[o++] = p[vi + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const hm = new THREE.Mesh(g, mat);
    hm.renderOrder = 996;
    hl.add(hm);
  }
}

function visEgenskaper(lag, id) {
  const p = lag.props[id] || ["", "", "", "", ""];
  const a = lag.tall[id];
  const rad = (k, v) => '<div class="prop-row"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
  let html = '<div class="prop-actions">';
  if (a) html += '<button id="lagLike">' + ikon("fokus") + ' ' + esc(t("Marker alle like ({0})", R.likeArmering(lag.tall, id).length)) + '</button>';
  html += '<button id="lagBare">' + ikon("vis") + ' ' + esc(tilstand.bareLag ? t("Vis alle lag igjen") : t("Bare dette laget")) + '</button></div>';
  html += rad(t("Lag"), esc(lag.navn) + ' <span class="lag-fag">' + esc(t(lag.fag)) + '</span>');
  if (p[2]) html += rad(t("Type"), esc(p[2]));
  if (p[0]) html += rad("Name", esc(p[0]));
  if (p[1] && p[1] !== p[0]) html += rad("ObjectType", esc(p[1]));
  if (p[3]) html += rad(t("Materiale"), esc(p[3]));
  if (p[4]) html += rad("GlobalId", esc(p[4]));
  if (a) {
    html += '<div class="lag-nokkel">' + esc(t("NØKKELTALL")) + '</div>';
    for (const [k, v] of R.nokkelRader(a)) html += rad(t(k), esc(v));
    if (!a.pos) html += '<p class="lag-merk">' + esc(t("Posisjonsnummer finnes ikke i IFC-fila. «Marker alle like» bruker diameter og bøyeform.")) + '</p>';
  } else if (lag.volum && lag.volum.get(Number(id))) {
    html += rad(t("Volum (fra geometrien)"), esc(R.volumTekst(Math.abs(lag.volum.get(Number(id))))));
  }
  $("propTitle").textContent = p[0] || p[2] || t("Element");
  $("propBody").innerHTML = html;
  // Lag-panelet står til venstre — egenskapene åpnes ved siden av, uten å lukke det
  $("propPanel").classList.add("open");
  const like = $("lagLike");
  if (like) like.onclick = () => {
    const ider = R.likeArmering(lag.tall, id);
    velgILag(lag, ider);
    varsel(t("{0} like armeringer valgt i «{1}».", ider.length, lag.navn));
  };
  $("lagBare").onclick = () => { bareDetteLaget(lag); visEgenskaper(lag, id); };
}

// ---------- Legge til ----------
async function lesFil(kilde, si) {
  if (kilde.art === "disk") return new Uint8Array(await kilde.fil.arrayBuffer());
  const { graphGet, spToken, SP } = await import("./sharepoint.js");
  const token = await spToken();
  if (!token) throw new Error(t("Logg inn for å hente fra biblioteket."));
  if (!S.spSiteId) S.spSiteId = (await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token)).id;
  const meta = await graphGet("/sites/" + S.spSiteId + "/drive/items/" + kilde.item.id, token);
  const url = meta["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error(t("Fikk ingen nedlastingslenke fra SharePoint"));
  si(t("Laster ned {0} …", kilde.item.name), 0);
  const r = await fetch(url);
  if (!r.ok) throw new Error(t("Nedlasting feilet ({0})", r.status));
  return new Uint8Array(await r.arrayBuffer());
}
const kildeNavn = (k) => (k.art === "disk" ? k.fil.name : k.item.name);
const kildeStorrelse = (k) => (k.art === "disk" ? k.fil.size : k.item.size) || 0;
const kildeEndret = (k) => (k.art === "disk" ? String(k.fil.lastModified || "") : String(k.item.lastModifiedDateTime || ""));

// GLB → { deler, kote, props, raaTall, kilde }
async function lesGlb(bytes) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
  gltf.scene.updateMatrixWorld(true);
  let lite = null;
  const deler = [];
  gltf.scene.traverse(o => {
    if (o.userData && o.userData.stormLite) lite = o.userData.stormLite;
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    deler.push({ pos: g.getAttribute("position").array, norm: g.getAttribute("normal") ? g.getAttribute("normal").array : null,
      idx: g.getIndex().array, ranges: o.userData.ranges || [] });
  });
  const props = {};
  if (lite && lite.props) for (const [k, v] of Object.entries(lite.props)) props[k] = v;
  return { deler, kote: lite && lite.kote, props, raaTall: (lite && lite.tall) || {}, kilde: (lite && lite.kilde) || null };
}

async function lagGlb(lag, deler) {
  // Sveiser sammen like punkter (som lett kopi, 0,1 mm) — gir mange ganger
  // mindre fil. Antall indekser endres ikke, så `ranges` gjelder fortsatt.
  const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
  const g = new THREE.Group();
  for (const d of deler) {
    let bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
    bg.setIndex(new THREE.BufferAttribute(d.idx, 1));
    bg = mergeVertices(bg, 1e-4 / ((S.enhetSkala || 1) || 1));
    const m = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: 0x999999 }));
    m.userData.merged = true;
    m.userData.ranges = d.ranges;
    g.add(m);
  }
  g.userData.stormLite = { v: 5, lag: true, name: lag.navn, kote: lag.kote, props: lag.props, tall: lag.raaTall,
    kilde: lag.kilde, laget: new Date().toISOString() };
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(g, res, rej, { binary: true }));
  return new Uint8Array(glb);
}

function si(tekst, andel) {
  tilstand.jobber = { tekst, andel: Math.max(0, Math.min(1, andel || 0)) };
  const p = $("lagProg"), tx = $("lagProgTekst");
  if (p) p.style.width = Math.round(tilstand.jobber.andel * 100) + "%";
  if (tx) tx.textContent = t(tekst) + " " + Math.round(tilstand.jobber.andel * 100) + " %";
}

export async function leggTilLag(kilde, valg) {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return null; }
  if (lagene.length >= R.MAKS_LAG) { varsel(t("Maks {0} lag om gangen.", R.MAKS_LAG)); return null; }
  if (tilstand.jobber) return null;
  const navn = kildeNavn(kilde);
  const fag = (valg && valg.fag) || R.gjettFag(navn);
  const lag = { id: nesteId++, navn: R.lagNavn(navn), fil: navn, fag, farge: (valg && valg.farge) || R.fargeFor(fag),
    gjennom: fag === "ARK" ? 60 : 0, synlig: true, kildeRef: kilde, valgt: new Set(),
    kilde: { navn, size: kildeStorrelse(kilde), endret: kildeEndret(kilde) } };
  si("Starter …", 0.01); tegn();
  try {
    let data = null, fraLager = false;
    // 1) Ferdig omgjort lag i SharePoint for nøyaktig denne fila?
    if (/\.ifc$/i.test(navn) && spPaalogget()) {
      si("Ser etter ferdig lag i SharePoint …", 0.02);
      try {
        const r = await spLesBin(LAG_MAPPE, R.lagGlbNavn(navn));
        if (r.status === "ok" && r.data) {
          const g = await lesGlb(new Uint8Array(r.data));
          if (g.kilde && g.kilde.size === lag.kilde.size && g.kilde.endret === lag.kilde.endret) { data = g; fraLager = true; }
        }
      } catch (_) {}
    }
    // 2) Ellers: hent fila og gjør den om (IFC) eller les den (GLB)
    if (!data) {
      const bytes = await lesFil(kilde, si);
      if (/\.glb$/i.test(navn)) { si("Leser lag-GLB …", 0.5); data = await lesGlb(bytes); }
      else {
        const { konverterIfc } = await import("./lag-konverter.js");
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        data = await konverterIfc(ab, si);
      }
    }
    lag.kote = data.kote || null;
    lag.props = data.props || {};
    lag.raaTall = data.raaTall || {};
    lag.tall = {};
    for (const [id, raa] of Object.entries(lag.raaTall)) {
      const a = R.armeringTall(raa, lag.props[id] && lag.props[id][0]);
      if (a && !a.kval && lag.props[id] && lag.props[id][3]) a.kval = lag.props[id][3];
      if (a) lag.tall[id] = a;
    }
    lag.T = R.lagTransform(S.koteMatrixInv ? Array.from(S.koteMatrixInv.elements) : null, lag.kote);
    // Volum per element (betong) — i modellenheter³ → m³
    const toM = S.enhetSkala || 1;
    lag.volum = new Map();
    for (const d of data.deler) R.elementVolumer(d.pos, d.idx, d.ranges, lag.volum);
    for (const [k, v] of lag.volum) lag.volum.set(k, Math.abs(v) * toM * toM * toM);
    for (const id of Object.keys(lag.tall)) lag.volum.delete(Number(id));   // armering telles i kg
    lag.sum = R.lagSum(lag.props, lag.tall, lag.volum);
    settInn(lag, byggGruppe(lag, data.deler));
    const sjekk = R.avstandSjekk(boksFor(S.modelGroup), boksFor(lag.gruppe));
    if (sjekk.langt) varsel(t("«{0}» ligger langt unna hovedmodellen. Er begge eksportert med delte koordinater fra samme Revit-prosjekt?", lag.navn));
    if (S.pushAngre) S.pushAngre({
      tekst: t("Lag lagt til"),
      angre: () => taUt(lag), gjenopprett: () => settInn(lag),
      forkast: (grunn) => { if (!lagene.includes(lag) && grunn !== "full") frigi(lag); }
    });
    // 3) Lagre ferdig lag i SharePoint (i bakgrunnen — brukeren venter ikke)
    if (!fraLager && /\.ifc$/i.test(navn) && spPaalogget()) {
      lagGlb(lag, data.deler)
        .then(bytes => spLastOpp(LAG_MAPPE, R.lagGlbNavn(navn), bytes, "model/gltf-binary"))
        .then(r => { lag.lagret = !!(r && r.ok); tegn(); })
        .catch(() => {});
    } else lag.lagret = fraLager;
    lag.fraLager = fraLager;
    varsel(fraLager ? t("«{0}» lagt til (ferdig lag fra SharePoint).", lag.navn) : t("«{0}» lagt til som lag.", lag.navn));
    return lag;
  } catch (err) {
    console.error(err);
    varsel(t("Klarte ikke å legge til laget: {0}", err.message));
    return null;
  } finally {
    tilstand.jobber = null;
    tegn();
  }
}

function settInn(lag) {
  if (!lag.gruppe) return;
  if (!lagene.includes(lag)) lagene.push(lag);
  lag.gruppe.visible = lag.synlig;
  scene.add(lag.gruppe);
  registrerEkstraGruppe(lag.gruppe, kontrakt(lag));
  if (S.ghostOn) import("./display.js").then(d => d.ghostPaaNytt && d.ghostPaaNytt()).catch(() => {});
  tegn();
}
function taUt(lag) {
  if (tilstand.bareLag) bareDetteLaget(null);
  const i = lagene.indexOf(lag);
  if (i >= 0) lagene.splice(i, 1);
  velgILag(lag, []);
  if (lag.gruppe) { scene.remove(lag.gruppe); avregistrerEkstraGruppe(lag.gruppe); }
  tegn();
}
function frigi(lag) {
  if (!lag.gruppe) return;
  lag.gruppe.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  if (lag.materiale) lag.materiale.dispose();
  lag.gruppe = null;
}
export function fjernLag(lag) {
  taUt(lag);
  if (S.pushAngre) S.pushAngre({ tekst: t("Lag fjernet"), angre: () => settInn(lag), gjenopprett: () => taUt(lag),
    forkast: () => { if (!lagene.includes(lag)) frigi(lag); } });
  else frigi(lag);
}

// Hovedmodellen lukkes / byttes: lagene hører til den økta og fjernes uten angre
S.ryddLag = () => {
  tilstand.bareLag = null;
  for (const lag of lagene.slice()) { taUt(lag); frigi(lag); }
};

// «Bare dette laget» / «Vis alle lag igjen»
function bareDetteLaget(lag) {
  if (tilstand.bareLag) {
    const f = tilstand.bareLag.foer;
    if (S.modelGroup) S.modelGroup.visible = f.hoved;
    for (const l of lagene) if (l.gruppe && f.lag[l.id] != null) { l.synlig = f.lag[l.id]; l.gruppe.visible = l.synlig; }
    tilstand.bareLag = null;
  } else if (lag) {
    tilstand.bareLag = { id: lag.id, foer: { hoved: S.modelGroup ? S.modelGroup.visible : true,
      lag: Object.fromEntries(lagene.map(l => [l.id, l.synlig])) } };
    if (S.modelGroup) S.modelGroup.visible = false;
    for (const l of lagene) { l.synlig = l === lag; if (l.gruppe) l.gruppe.visible = l.synlig; }
  }
  tegn();
}

async function apneSomHoved(lag) {
  if (!confirm(t("Åpne «{0}» som hovedmodell? Lagene lukkes, og alle verktøy jobber da på denne fila.", lag.navn))) return;
  const k = lag.kildeRef;
  if (k.art === "bibliotek") (await import("./sharepoint.js")).spOpenFile(k.item);
  else (await import("./ifc.js")).openLocalFile(k.fil);
}

// ---------- Panelet ----------
function kortHtml(lag) {
  const ruter = R.kortRuter(lag.sum || R.lagSum({}, {}, null));
  return '<div class="lag-kort' + (lag.synlig ? "" : " av") + '" data-lag="' + lag.id + '" style="--lagfarge:' + esc(lag.farge) + '">' +
    '<div class="lag-topp"><button class="lag-oye" data-oye="' + lag.id + '" title="' + esc(lag.synlig ? t("Skjul laget") : t("Vis laget")) + '">' + ikon(lag.synlig ? "vis" : "skjul") + '</button>' +
      '<b title="' + esc(lag.fil) + '">' + esc(lag.navn) + '</b><span class="lag-fag">' + esc(t(lag.fag)) + '</span>' +
      '<button class="lag-x" data-fjern="' + lag.id + '" title="' + esc(t("Fjern laget")) + '">' + ikon("lukk") + '</button></div>' +
    '<div class="lag-ruter">' + ruter.map(([v, k]) => '<div><b>' + esc(v) + '</b><span>' + esc(t(k)) + '</span></div>').join("") + '</div>' +
    '<label class="lag-glid"><span>' + esc(t("Gjennomsiktig")) + '</span><input type="range" min="0" max="90" step="5" value="' + lag.gjennom + '" data-gjennom="' + lag.id + '"><i>' + lag.gjennom + ' %</i></label>' +
    '<div class="lag-knapper"><button data-bare="' + lag.id + '">' + esc(tilstand.bareLag && tilstand.bareLag.id === lag.id ? t("Vis alle lag igjen") : t("Bare dette laget")) + '</button>' +
      '<label class="lag-fargevalg" title="' + esc(t("Farge")) + '"><input type="color" value="' + esc(lag.farge) + '" data-farge="' + lag.id + '"></label>' +
      '<button data-hoved="' + lag.id + '">' + esc(t("Åpne som hovedmodell")) + '</button></div>' +
    '<div class="lag-status">' + esc(lag.fraLager ? t("Hentet ferdig fra SharePoint (Lag)") : lag.lagret ? t("Lagret i SharePoint (Lag) — åpnes raskt neste gang") : (lag.fil && /\.ifc$/i.test(lag.fil) && spPaalogget() ? t("Lagres i SharePoint …") : "")) + '</div>' +
  '</div>';
}

function leggTilHtml() {
  const k = tilstand.kilde;
  const fag = tilstand.fag || (k ? R.gjettFag(kildeNavn(k)) : "Armering");
  const farge = tilstand.farge || R.fargeFor(fag);
  const bib = tilstand.bibliotek;
  let valg = '<option value="">' + esc(bib ? t("Velg fra biblioteket …") : (tilstand.bibStatus || t("Henter biblioteket …"))) + '</option>';
  if (bib) valg += bib.map(f => '<option value="' + esc(f.id) + '"' + (k && k.art === "bibliotek" && k.item.id === f.id ? " selected" : "") + '>' + esc(f.name) + '</option>').join("");
  if (k && k.art === "disk") valg += '<option value="disk" selected>' + esc(t("Fra disk: {0}", k.fil.name)) + '</option>';
  const j = tilstand.jobber;
  return '<div class="lag-ny">' +
    '<div class="lag-lbl">' + esc(t("LEGG TIL LAG")) + '</div>' +
    '<div class="lag-rad"><select id="lagKilde"' + (j ? " disabled" : "") + '>' + valg + '</select>' +
      '<label class="lag-disk" title="' + esc(t("Fra disk …")) + '">' + ikon("apne") + '<input type="file" id="lagFil" accept=".ifc,.glb" hidden></label></div>' +
    '<div class="lag-rad"><select id="lagFag"' + (j ? " disabled" : "") + '>' + R.FAG.map(f => '<option value="' + f.k + '"' + (f.k === fag ? " selected" : "") + '>' + esc(t(f.k)) + '</option>').join("") + '</select>' +
      '<label class="lag-fargevalg stor"><input type="color" id="lagFarge" value="' + esc(farge) + '"></label>' +
      '<button class="primary" id="lagLeggTil"' + (k && !j ? "" : " disabled") + '>' + esc(t("Legg til")) + '</button></div>' +
    (j ? '<div class="lag-lbl"><span id="lagProgTekst">' + esc(t(j.tekst)) + ' ' + Math.round(j.andel * 100) + ' %</span></div><div class="lag-prog"><i id="lagProg" style="width:' + Math.round(j.andel * 100) + '%"></i></div>'
       : '<div class="lag-hjelp">' + esc(t("IFC gjøres om i bakgrunnen. Hovedmodellen blir liggende. Ferdige lag lagres i SharePoint og åpnes raskt neste gang.")) + '</div>') +
  '</div>';
}

export function tegn() {
  const body = $("lagBody");
  if (!body) return;
  const hoved = S.fileName ? '<div class="lag-hoved"><span class="lag-oye-dummy">' + ikon(S.modelGroup && S.modelGroup.visible === false ? "skjul" : "vis") + '</span>' +
    '<div><b>' + esc(S.fileName) + '</b><span>' + esc(t("Hovedmodell · alle verktøy")) + '</span></div></div>' : "";
  body.innerHTML = hoved +
    (lagene.length ? lagene.map(kortHtml).join("") : '<p class="lag-tom">' + esc(t("Ingen lag ennå. Legg til armering, stål eller en annen fagmodell oppå hovedmodellen.")) + '</p>') +
    leggTilHtml();
  koble(body);
}

function finnLag(id) { return lagene.find(l => l.id === Number(id)); }

function koble(body) {
  body.querySelectorAll("[data-oye]").forEach(b => b.onclick = () => {
    const lag = finnLag(b.dataset.oye); if (!lag) return;
    const foer = lag.synlig;
    lag.synlig = !lag.synlig; lag.gruppe.visible = lag.synlig;
    if (S.pushAngre) S.pushAngre({ tekst: t("Lag vist/skjult"),
      angre: () => { lag.synlig = foer; if (lag.gruppe) lag.gruppe.visible = foer; tegn(); },
      gjenopprett: () => { lag.synlig = !foer; if (lag.gruppe) lag.gruppe.visible = !foer; tegn(); } });
    if (S.oppdaterVisAlle) S.oppdaterVisAlle();
    tegn();
  });
  body.querySelectorAll("[data-fjern]").forEach(b => b.onclick = () => { const lag = finnLag(b.dataset.fjern); if (lag) fjernLag(lag); });
  body.querySelectorAll("[data-gjennom]").forEach(inp => {
    inp.oninput = () => {
      const lag = finnLag(inp.dataset.gjennom); if (!lag) return;
      lag.gjennom = Number(inp.value) || 0;
      settGjennomsiktig(lag.materiale, lag.gjennom);
      const i = inp.parentElement.querySelector("i"); if (i) i.textContent = lag.gjennom + " %";
    };
  });
  body.querySelectorAll("[data-farge]").forEach(inp => {
    inp.oninput = () => {
      const lag = finnLag(inp.dataset.farge); if (!lag) return;
      lag.farge = inp.value; lag.materiale.color.set(lag.farge);
      const k = inp.closest(".lag-kort"); if (k) k.style.setProperty("--lagfarge", lag.farge);
    };
  });
  body.querySelectorAll("[data-bare]").forEach(b => b.onclick = () => bareDetteLaget(tilstand.bareLag && tilstand.bareLag.id === Number(b.dataset.bare) ? null : finnLag(b.dataset.bare)));
  body.querySelectorAll("[data-hoved]").forEach(b => b.onclick = () => { const lag = finnLag(b.dataset.hoved); if (lag) apneSomHoved(lag); });
  const ks = $("lagKilde");
  if (ks) ks.onchange = () => {
    const v = ks.value;
    if (v === "disk") return;
    const f = (tilstand.bibliotek || []).find(x => x.id === v);
    tilstand.kilde = f ? { art: "bibliotek", item: f } : null;
    tilstand.fag = f ? R.gjettFag(f.name) : ""; tilstand.farge = "";
    tegn();
  };
  const fil = $("lagFil");
  if (fil) fil.onchange = () => {
    const f = fil.files && fil.files[0];
    if (!f) return;
    tilstand.kilde = { art: "disk", fil: f };
    tilstand.fag = R.gjettFag(f.name); tilstand.farge = "";
    tegn();
  };
  const fag = $("lagFag");
  if (fag) fag.onchange = () => { tilstand.fag = fag.value; tilstand.farge = ""; tegn(); };
  const fa = $("lagFarge");
  if (fa) fa.oninput = () => { tilstand.farge = fa.value; };
  const lt = $("lagLeggTil");
  if (lt) lt.onclick = async () => {
    const k = tilstand.kilde; if (!k) return;
    const valg = { fag: tilstand.fag || R.gjettFag(kildeNavn(k)), farge: tilstand.farge || "" };
    if (!valg.farge) valg.farge = R.fargeFor(valg.fag);
    const lag = await leggTilLag(k, valg);
    if (lag) { tilstand.kilde = null; tilstand.fag = ""; tilstand.farge = ""; tegn(); }
  };
}

async function hentBibliotek() {
  if (tilstand.bibliotek || tilstand.bibStatus === "henter") return;
  if (!spPaalogget()) { tilstand.bibStatus = t("Logg inn for biblioteket — eller velg fra disk"); tegn(); return; }
  tilstand.bibStatus = "henter";
  try {
    const { spFetchList } = await import("./sharepoint.js");
    const [ifc, glb] = await Promise.all([spFetchList("full").catch(() => []), spFetchList("lett").catch(() => [])]);
    tilstand.bibliotek = (ifc || []).concat(glb || []).filter(f => f.name !== S.fileName);
    tilstand.bibStatus = "";
  } catch (_) { tilstand.bibStatus = t("Klarte ikke å hente biblioteket"); }
  tegn();
}

på("btnLag", "click", () => {
  const p = $("lagPanel");
  if (p && p.classList.contains("open")) { p.classList.remove("open"); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  apnePanel("lagPanel");
  tegn();
  hentBibliotek();
});

// Gå til et lag (brukes av testene og hjelpekortet)
export function zoomTilLag(lag) {
  const b = new THREE.Box3().setFromObject(lag.gruppe);
  if (!b.isEmpty()) flyTil(b.getCenter(new THREE.Vector3()), b.getSize(new THREE.Vector3()).length());
}
export { clearSelection as _clearSelection };
// Testene: rundtur lag → .lag.glb → lag (bufferen i SharePoint)
export { lagGlb as _lagGlb, lesGlb as _lesGlb };
