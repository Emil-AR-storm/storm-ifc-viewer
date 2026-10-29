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
import { camera, canvas, flyTil, pointer, raycaster, renderer, scene } from "./scene.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { clearSelection, elementBoxById, hitID, pick } from "./elements.js";
import { spLastOpp, spLes, spLesBin, spPaalogget, spSkriv } from "./sp-lager.js";
import * as R from "./lag-regn.js";

export const LAG_MAPPE = "Lag";
// 6 = koten (flyttingen til origo) er lest ETTER geometrien (28.10). Lag-GLB-er
// med lavere versjon brukes ikke fra bufferen i SharePoint.
// 7 = etasjene (navn + høyde i mm) er med — Juster plassering trenger dem (28.10).
export const LAG_GLB_VERSJON = 7;
const lagene = [];               // { id, navn, fag, farge, gjennom, synlig, kilde, gruppe, props, tall, sum, … }
export const _lagene = lagene;   // testene
const tilstand = {
  kilde: null,                   // { art: "bibliotek", item } | { art: "disk", fil }
  fag: "", farge: "",
  bibliotek: null, bibStatus: "",
  jobber: null,                  // { tekst, andel } mens et lag gjøres om
  bareLag: null,                 // { id, foer: [...] } når «Bare dette laget» er på
  midt: null,                    // 📐 { lagId, steg 1|2, hovedBoks } mens Midtpunkt venter på klikk
  flytt: null,                   // 📐 { lagId, start } mens «Flytt med tastene» er på
  steg: 10,                      // mm per tastetrykk
  hovedEt: null,                 // hovedmodellens etasjer { fil, liste, grunn }
  grupper: null,                 // 🗂 modellgruppene fra SharePoint (rå liste) — null = ikke hentet
  grStatus: "",                  // "henter" | feiltekst
  grValgt: "",                   // id i nedtrekket
  grNavnFelt: false,             // navnefeltet for «Lagre gruppe» er åpent
  grJobber: "",                  // tekst mens en gruppe åpnes/lagres
  visMengder: false,             // 📊 «Mengder per lag» foldet ut
  hovedM: null,                  // { fil, m } | { fil, regner: true } — hovedmodellens mengder
  enheter: lesEnheter()          // 📏 valgt enhet per rad { "Revit-type|materiale": "m²" } — huskes på maskinen
};
export const _tilstand = tilstand;
function lesEnheter() { try { return JSON.parse(localStorage.getItem("storm.lagEnheter") || "{}") || {}; } catch (_) { return {}; } }
function lagreEnheter() { try { localStorage.setItem("storm.lagEnheter", JSON.stringify(tilstand.enheter)); } catch (_) {} }
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
  g.matrix.fromArray(R.justertMatrise(lag.T, lag.justering, S.enhetSkala));
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

// Vis/skjul ett lag — fra kortet, egenskapsboksen og Utseende. Én vei, én
// angrepost, så de tre stedene aldri kommer ut av takt med hverandre.
function settSynlig(lag, synlig) {
  if (!lag || lag.synlig === synlig) return;
  const foer = lag.synlig;
  const bruk = (v) => { lag.synlig = v; if (lag.gruppe) lag.gruppe.visible = v; if (!v) velgILag(lag, []); tegn(); if (S.oppdaterVisAlle) S.oppdaterVisAlle(); if (S.tegnUtseendePanel) S.tegnUtseendePanel(); };
  bruk(synlig);
  if (S.pushAngre) S.pushAngre({ tekst: synlig ? t("Lag vist") : t("Lag skjult"), angre: () => bruk(foer), gjenopprett: () => bruk(synlig) });
}

// 🎨 Utseende: én blokk «Lag» med en vis/skjul-rad per lag (Emil 28.10).
// Hvert lag melder inn evnen, men bare det FØRSTE tegner blokken — ellers
// ville den kommet én gang per lag.
function utseendeRader(body) {
  if (!body || !lagene.length) return;
  const boks = document.createElement("div");
  boks.innerHTML = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' + ikon("lag") + ' ' + esc(t("Lag")) + '</div><div class="c"></div></div>' +
    lagene.map(l => '<div class="qty-row"><div class="n"><span class="lag-prikk" style="background:' + esc(l.farge) + '"></span>' + esc(l.navn) +
      ' <span style="color:var(--muted);font-size:11px">(' + esc(t(l.fag)) + ')</span></div><div class="c"><button data-lag-skjul="' + l.id + '" title="' + esc(t("Skjul/vis")) +
      '" style="padding:3px 8px">' + ikon(l.synlig ? "vis" : "skjul") + '</button></div></div>').join("");
  body.appendChild(boks);
  boks.querySelectorAll("[data-lag-skjul]").forEach(b => b.onclick = () => { const l = finnLag(b.dataset.lagSkjul); if (l) settSynlig(l, !l.synlig); });
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
    utseendeRader(body) { if (lagene[0] === lag) utseendeRader(body); },
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
  html += '<button id="lagBare">' + ikon("vis") + ' ' + esc(tilstand.bareLag ? t("Vis alle lag igjen") : t("Bare dette laget")) + '</button>';
  // 🙈 Emil 28.10: skjul laget rett herfra — uten å åpne Lag-panelet hver gang
  html += '<button id="lagSkjulDette">' + ikon("skjul") + ' ' + esc(t("Skjul dette laget")) + '</button></div>';
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
  $("lagSkjulDette").onclick = () => { settSynlig(lag, false); $("propPanel").classList.remove("open"); };
}

// ---------- Legge til ----------
async function lesFil(kilde, si) {
  if (kilde.art === "disk") return new Uint8Array(await kilde.fil.arrayBuffer());
  // 🗂 Fra en modellgruppe: den ferdige lag-GLB-en fantes ikke (eller IFC-en
  // er endret). Ligger IFC-en i biblioteket, hentes den derfra og gjøres om.
  if (kilde.art === "gruppe") {
    if (!kilde.item) throw new Error(t("«{0}» finnes ikke i SharePoint. Legg laget til på nytt mens du er logget inn, og lagre gruppen igjen.", kilde.navn));
    kilde = { art: "bibliotek", item: kilde.item };
  }
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
// art: "disk" { fil } · "bibliotek" { item } · "gruppe" { navn, size, endret, item? } (fra en modellgruppe)
const kildeNavn = (k) => (k.art === "disk" ? k.fil.name : k.art === "gruppe" ? k.navn : k.item.name);
const kildeStorrelse = (k) => (k.art === "disk" ? k.fil.size : k.art === "gruppe" ? k.size : k.item.size) || 0;
const kildeEndret = (k) => (k.art === "disk" ? String(k.fil.lastModified || "") : k.art === "gruppe" ? String(k.endret || "") : String(k.item.lastModifiedDateTime || ""));

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
  return { deler, kote: lite && lite.kote, props, raaTall: (lite && lite.tall) || {}, kilde: (lite && lite.kilde) || null, v: Number(lite && lite.v) || 0,
    etasjer: Array.isArray(lite && lite.etasjer) ? lite.etasjer : [] };
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
  g.userData.stormLite = { v: LAG_GLB_VERSJON, lag: true, name: lag.navn, kote: lag.kote, props: lag.props, tall: lag.raaTall,
    etasjer: lag.etasjer || [], kilde: lag.kilde, laget: new Date().toISOString() };
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
    gjennom: fag === "ARK" ? 60 : 0, synlig: true, kildeRef: kilde, valgt: new Set(), fraGruppe: !!(valg && valg.fraGruppe),
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
          // v6+: kote fra ETTER geometrien. Eldre lag i SharePoint (laget før
          // rettingen 28.10) har enhetsmatrise og havner flere hundre meter feil
          // (Emils bilde 28.10) — de lages på nytt og overskrives.
          if (g.v >= LAG_GLB_VERSJON && g.kilde && g.kilde.size === lag.kilde.size && g.kilde.endret === lag.kilde.endret) { data = g; fraLager = true; }
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
    lag.etasjer = Array.isArray(data.etasjer) ? data.etasjer : [];
    lag.justering = R.vaskJustering(null);
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
    // 📏 Lengde og største flate per element (ikke armeringen) — til valgfri
    // enhet i «Mengder per lag» (Emil 29.10: isolasjon prises i m²)
    {
      const hopp = new Set(Object.keys(lag.tall).map(Number)), kart = new Map();
      for (const d of data.deler) R.elementMaal(d.pos, d.idx, d.ranges, hopp, 0.005 / toM, kart);
      lag.maal = R.ferdigeMaal(kart, toM);
    }
    lag.sum = R.lagSum(lag.props, lag.tall, lag.volum);
    settInn(lag, byggGruppe(lag, data.deler));
    // En lett kopi eller lag-GLB laget før 28.10 har «ingen flytting» lagret.
    // Det kan ikke rettes i ettertid — men det skal sies, ikke skje i det stille.
    if (S.glbActive && R.erEnhet(S.koteMatrixInv ? Array.from(S.koteMatrixInv.elements) : null))
      varsel(t("Hovedmodellen er en lett kopi uten plassering (laget før 28.10.2026). Lag den lette kopien på nytt, eller åpne IFC-en, så havner lagene riktig."));
    else if (/\.glb$/i.test(navn) && !(data.v >= LAG_GLB_VERSJON) && R.erEnhet(lag.kote))
      varsel(t("«{0}» er laget før 28.10.2026 og mangler plassering. Legg til IFC-en i stedet, så havner laget riktig.", lag.navn));
    const sjekk = R.avstandSjekk(boksFor(S.modelGroup), boksFor(lag.gruppe));
    if (sjekk.langt) varsel(t("«{0}» ligger langt unna hovedmodellen. Er begge eksportert med delte koordinater fra samme Revit-prosjekt?", lag.navn));
    if (S.pushAngre) S.pushAngre({
      tekst: t("Lag lagt til"),
      angre: () => taUt(lag), gjenopprett: () => settInn(lag),
      forkast: (grunn) => { if (!lagene.includes(lag) && grunn !== "full") frigi(lag); }
    });
    // 3) Lagre ferdig lag i SharePoint (i bakgrunnen — brukeren venter ikke).
    // Ikke logget inn: kortet sier fra med rødt, og laget lagres så snart
    // brukeren logger inn (S.onSignedIn nederst) — Emil 29.10.
    lag.lagret = fraLager;
    lag.fraLager = fraLager;
    if (!fraLager) lagreLagISharePoint(lag);
    hentLagretJustering(lag);   // 📐 samme lag på samme hovedmodell justert før? (i bakgrunnen)
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
  setTimeout(() => { if (S.tegnUtseendePanel) S.tegnUtseendePanel(); }, 0);
  if (!lagene.includes(lag)) lagene.push(lag);
  lag.gruppe.visible = lag.synlig;
  scene.add(lag.gruppe);
  registrerEkstraGruppe(lag.gruppe, kontrakt(lag));
  if (S.ghostOn) import("./display.js").then(d => d.ghostPaaNytt && d.ghostPaaNytt()).catch(() => {});
  tegn();
}
function taUt(lag) {
  if (tilstand.bareLag) bareDetteLaget(null);
  stoppModuser(lag);
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
  tilstand.hovedM = null;
  stoppModuser(null);
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
  else if (k.art === "gruppe") { if (k.item) (await import("./sharepoint.js")).spOpenFile(k.item); else varsel(t("«{0}» ligger ikke i biblioteket og kan ikke åpnes som hovedmodell herfra.", lag.navn)); }
  else (await import("./ifc.js")).openLocalFile(k.fil);
}

// ---------- Lagring av laget i SharePoint ----------
// Et lag fra en IFC lagres som ferdig «<navn>.lag.glb» i mappa Lag. Det er
// DEN fila en modellgruppe henter igjen — også når IFC-en kom fra disken.
// Uten innlogging kan ingenting lagres; da sier kortet fra med rødt (Emil 29.10).
const kanLagres = (lag) => /\.ifc$/i.test(lag.fil || "");
const iBiblioteket = (lag) => !!(lag.kildeRef && (lag.kildeRef.art === "bibliotek" || (lag.kildeRef.art === "gruppe" && lag.kildeRef.item)));
export async function lagreLagISharePoint(lag) {
  if (!kanLagres(lag) || lag.lagret || lag.lagrer || !lag.gruppe) return;
  if (!spPaalogget()) { tegn(); return; }
  lag.lagrer = true; lag.lagreFeil = false; tegn();
  try {
    // Geometrien hentes fra scenen (lagets egne koordinater, før T), så laget
    // kan lagres også lenge etter at det ble lagt til.
    const deler = lag.gruppe.children.filter(m => m.isMesh && m.userData.ranges && m.geometry && m.geometry.getIndex())
      .map(m => ({ pos: m.geometry.getAttribute("position").array, idx: m.geometry.getIndex().array, ranges: m.userData.ranges }));
    const bytes = await lagGlb(lag, deler);
    const r = await spLastOpp(LAG_MAPPE, R.lagGlbNavn(lag.fil), bytes, "model/gltf-binary");
    lag.lagret = !!(r && r.ok);
    lag.lagreFeil = !lag.lagret;
  } catch (err) {
    console.warn("Laget ble ikke lagret i SharePoint:", err);
    lag.lagreFeil = true;
  } finally {
    lag.lagrer = false;
    tegn();
  }
}
function statusHtml(lag) {
  const grå = (tx) => '<div class="lag-status">' + esc(tx) + '</div>';
  const rød = (tx, knapp, data) => '<div class="lag-ulagret" data-ulagret="' + lag.id + '">⚠ ' + esc(tx) +
    (knapp ? ' <button data-' + data + '="' + lag.id + '">' + esc(knapp) + '</button>' : "") + '</div>';
  if (lag.fraLager) return grå(t("Hentet ferdig fra SharePoint (Lag)"));
  if (lag.lagret) return grå(t("Lagret i SharePoint (Lag) — åpnes raskt neste gang"));
  if (!kanLagres(lag)) return iBiblioteket(lag) ? grå(t("Ligger i biblioteket")) : rød(t("Ikke lagret i SharePoint — legg til IFC-en i stedet"));
  if (!spPaalogget()) return rød(t("Ikke lagret — logg inn på SharePoint"), t("Logg inn"), "lag-logginn");
  if (lag.lagrer) return grå(t("Lagres i SharePoint …"));
  if (lag.lagreFeil) return rød(t("Ikke lagret i SharePoint — opplastingen feilet"), t("Prøv igjen"), "lag-lagre");
  return grå(t("Lagres i SharePoint …"));
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
      '<button data-hoved="' + lag.id + '">' + esc(t("Åpne som hovedmodell")) + '</button>' +
      '<button data-juster="' + lag.id + '"' + (lag.visJuster ? ' class="active"' : "") + '>' + esc(t("Juster plassering")) + '</button></div>' +
    (R.erJustert(lag.justering) ? '<div class="lag-justert" data-justert="' + lag.id + '">' + esc(justertTekst(lag)) + '</div>' : "") +
    (lag.visJuster ? justerHtml(lag) : "") +
    statusHtml(lag) +
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
       : '<div class="lag-slipp" id="lagSlipp">' + ikon("lag") + ' ' + esc(t("Slipp IFC her for å legge den til som lag")) + '</div>' +
         '<div class="lag-hjelp">' + esc(t("IFC gjøres om i bakgrunnen. Hovedmodellen blir liggende. Ferdige lag lagres i SharePoint og åpnes raskt neste gang.")) + '</div>') +
  '</div>';
}

export function tegn() {
  const body = $("lagBody");
  if (!body) return;
  const hoved = S.fileName ? '<div class="lag-hoved"><span class="lag-oye-dummy">' + ikon(S.modelGroup && S.modelGroup.visible === false ? "skjul" : "vis") + '</span>' +
    '<div><b>' + esc(S.fileName) + '</b><span>' + esc(t("Hovedmodell · alle verktøy")) + '</span></div></div>' : "";
  body.innerHTML = gruppeHtml() + hoved +
    (lagene.length ? lagene.map(kortHtml).join("") : '<p class="lag-tom">' + esc(t("Ingen lag ennå. Legg til armering, stål eller en annen fagmodell oppå hovedmodellen.")) + '</p>') +
    mengderHtml() + leggTilHtml();
  koble(body);
}

function finnLag(id) { return lagene.find(l => l.id === Number(id)); }

function koble(body) {
  body.querySelectorAll("[data-oye]").forEach(b => b.onclick = () => { const lag = finnLag(b.dataset.oye); if (lag) settSynlig(lag, !lag.synlig); });
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
  kobleJuster(body);
  body.querySelectorAll("[data-lag-logginn]").forEach(b => b.onclick = async () => {
    try { const { spToken } = await import("./sharepoint.js"); await spToken(); } catch (_) {}
    lagreUlagrede();
  });
  body.querySelectorAll("[data-lag-lagre]").forEach(b => b.onclick = () => { const lag = finnLag(b.dataset.lagLagre); if (lag) { lag.lagreFeil = false; lagreLagISharePoint(lag); } });
  kobleGrupper(body);
  kobleMengder(body);
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
  // 🧲 Dra og slipp (Emil 28.10): IFC-er som slippes i den stiplede ruta blir
  // LAG — ikke ny hovedmodell. Slippet merkes (e.lagHåndtert), og vinduets
  // eget slipp i ifc.js nullstiller rammen og gjør ellers ingenting.
  const sl = $("lagSlipp");
  if (sl) {
    const harFiler = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    sl.ondragover = (e) => {
      if (!harFiler(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      sl.classList.add("over");
      const h = $("dropHint"); if (h) h.classList.remove("open");
    };
    sl.ondragleave = () => sl.classList.remove("over");
    sl.ondrop = (e) => {
      e.preventDefault(); e.lagHåndtert = true;
      sl.classList.remove("over");
      const h = $("dropHint"); if (h) h.classList.remove("open");
      const dt = e.dataTransfer;
      let filer = dt && dt.files ? [...dt.files] : [];
      if (!filer.length && dt && dt.items) filer = [...dt.items].filter(i => i.kind === "file").map(i => { try { return i.getAsFile(); } catch (_) { return null; } }).filter(Boolean);
      slippFiler(filer);
    };
  }
  const lt = $("lagLeggTil");
  if (lt) lt.onclick = async () => {
    const k = tilstand.kilde; if (!k) return;
    const valg = { fag: tilstand.fag || R.gjettFag(kildeNavn(k)), farge: tilstand.farge || "" };
    if (!valg.farge) valg.farge = R.fargeFor(valg.fag);
    const lag = await leggTilLag(k, valg);
    if (lag) { tilstand.kilde = null; tilstand.fag = ""; tilstand.farge = ""; tegn(); }
  };
}

// Én eller flere filer sluppet i ruta — legges til etter tur.
export async function slippFiler(filer) {
  const gode = (filer || []).filter(f => f && /\.(ifc|glb)$/i.test(f.name || ""));
  if (!gode.length) { varsel(t("Slipp en .ifc- eller .glb-fil.")); return; }
  for (const f of gode) {
    const fag = R.gjettFag(f.name);
    await leggTilLag({ art: "disk", fil: f }, { fag, farge: R.fargeFor(fag) });
  }
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
  hentGrupper();
});

// ---------- 🗂 Modellgruppe (runde 5b, Emils valg A 29.10.2026) ----------
// Gruppe-linja øverst i Lag-panelet: velg gruppe · Åpne · Lagre gruppe.
// Gruppene ligger i SharePoint (Modellgrupper/modellgrupper.json) og er
// felles for alle som er logget inn mot samme område.
const innlogget = () => (S.innloggetNavn ? S.innloggetNavn() : "") || "";
const datoTekst = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("no-NO", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }); };

async function hentGrupper(tving) {
  if (!spPaalogget()) { tilstand.grupper = null; tegn(); return; }
  if ((tilstand.grupper && !tving) || tilstand.grStatus === "henter") return;
  tilstand.grStatus = "henter"; tegn();
  try {
    const r = await spLes(R.GRUPPE_MAPPE, R.GRUPPE_FIL);
    if (r.status === "feil") throw new Error("les");
    tilstand.grupper = r.liste || [];
    tilstand.grStatus = "";
  } catch (_) { tilstand.grupper = null; tilstand.grStatus = t("Klarte ikke å hente modellgruppene"); }
  tegn();
}
function valgtGruppe() {
  const g = (tilstand.grupper || []).find(x => x && x.id === tilstand.grValgt);
  return g ? R.vaskGruppe(g) : null;
}

function gruppeHtml() {
  if (!S.fileName) return "";
  const lbl = '<div class="lag-lbl">' + esc(t("MODELLGRUPPE")) + '<span>' + esc(t("SharePoint · Modellgrupper")) + '</span></div>';
  if (!spPaalogget()) return '<div class="lag-grp">' + lbl +
    '<div class="lag-ulagret">⚠ ' + esc(t("Logg inn på SharePoint for å lagre og åpne modellgrupper.")) + ' <button data-lag-logginn="0">' + esc(t("Logg inn")) + '</button></div></div>';
  const { her, andre } = R.sorterGrupper(tilstand.grupper || [], S.fileName);
  const opt = (g, medHoved) => '<option value="' + esc(g.id) + '"' + (g.id === tilstand.grValgt ? " selected" : "") + '>' + esc(g.navn + (medHoved ? " — " + g.hoved.navn : "")) + '</option>';
  const tom = tilstand.grStatus === "henter" ? t("Henter grupper …") : tilstand.grStatus || (her.length + andre.length ? t("Velg gruppe …") : t("Ingen grupper ennå"));
  let valg = '<option value="">' + esc(tom) + '</option>';
  if (her.length) valg += '<optgroup label="' + esc(t("For denne modellen")) + '">' + her.map(g => opt(g, false)).join("") + '</optgroup>';
  if (andre.length) valg += '<optgroup label="' + esc(t("Andre modeller")) + '">' + andre.map(g => opt(g, true)).join("") + '</optgroup>';
  const g = valgtGruppe(), j = tilstand.grJobber;
  const info = j ? esc(j)
    : g ? esc(t("{0} + {1} lag", g.hoved.navn, g.lag.length) + (g.lag.some(l => R.erJustert(l.justering)) ? " · " + t("justeringer med") : "") +
        (g.av || g.endret ? " · " + t("sist lagret av {0} {1}", g.av || "?", datoTekst(g.endret)) : ""))
    : esc(lagene.length ? t("{0} lag åpne nå. Lagre dem som en gruppe, så åpnes alt med ett trykk.", lagene.length) : t("Legg til lag, og lagre dem som en gruppe."));
  let navnFelt = "";
  if (tilstand.grNavnFelt) {
    const forslag = g && g.hoved.navn === S.fileName ? g.navn : R.lagNavn(S.fileName);
    navnFelt = '<div class="lag-rad"><input type="text" id="lagGruppeNavn" maxlength="80" placeholder="' + esc(t("Navn på gruppen")) + '" value="' + esc(forslag) + '">' +
      '<button class="primary" id="lagGruppeLagreOk">' + esc(t("Lagre")) + '</button><button id="lagGruppeAvbryt">' + esc(t("Avbryt")) + '</button></div>' +
      '<div class="lag-grp-info">' + esc(t("Samme navn lagrer over gruppen. Nytt navn lager en ny gruppe.")) + '</div>';
  }
  return '<div class="lag-grp">' + lbl +
    '<div class="lag-rad"><select id="lagGruppeValg"' + (j ? " disabled" : "") + '>' + valg + '</select>' +
      '<button id="lagGruppeApne"' + (g && !j ? "" : " disabled") + '>' + esc(t("Åpne")) + '</button>' +
      '<button class="primary" id="lagGruppeLagre"' + (lagene.length && !j && !tilstand.jobber ? "" : " disabled") + '>' + esc(t("Lagre gruppe")) + '</button></div>' +
    navnFelt + '<div class="lag-grp-info">' + info + '</div></div>';
}

function kobleGrupper(body) {
  const v = body.querySelector("#lagGruppeValg");
  if (v) v.onchange = () => { tilstand.grValgt = v.value; tilstand.grNavnFelt = false; tegn(); };
  const a = body.querySelector("#lagGruppeApne");
  if (a) a.onclick = () => { const g = valgtGruppe(); if (g) apneGruppe(g); };
  const l = body.querySelector("#lagGruppeLagre");
  if (l) l.onclick = () => {
    tilstand.grNavnFelt = !tilstand.grNavnFelt; tegn();
    const f = $("lagGruppeNavn"); if (f) { f.focus(); f.select(); }
  };
  const av = body.querySelector("#lagGruppeAvbryt");
  if (av) av.onclick = () => { tilstand.grNavnFelt = false; tegn(); };
  const ok = body.querySelector("#lagGruppeLagreOk"), felt = body.querySelector("#lagGruppeNavn");
  if (ok && felt) {
    ok.onclick = () => lagreGruppe(felt.value);
    felt.onkeydown = (e) => { if (e.key === "Enter") lagreGruppe(felt.value); if (e.key === "Escape") { tilstand.grNavnFelt = false; tegn(); } };
  }
}

export async function lagreGruppe(navn) {
  const n = String(navn || "").trim();
  if (!n) { varsel(t("Skriv et navn på gruppen.")); return null; }
  if (!spPaalogget()) { varsel(t("Logg inn på SharePoint for å lagre og åpne modellgrupper.")); return null; }
  if (!lagene.length) return null;
  if (!tilstand.grupper) await hentGrupper(true);
  const finnes = R.sorterGrupper(tilstand.grupper || [], S.fileName).her.find(g => g.navn.toLowerCase() === n.toLowerCase());
  const info = S.lastLoadInfo || {};
  const post = R.gruppeFraOppsett({ id: finnes ? finnes.id : null, navn: n, av: innlogget(),
    hoved: { navn: S.fileName, libId: info.name === S.fileName ? info.libId : null, size: info.name === S.fileName ? info.size : 0 }, lagene });
  tilstand.grJobber = t("Lagrer gruppen …"); tegn();
  try {
    const r = await spSkriv(R.GRUPPE_MAPPE, R.GRUPPE_FIL, [post], (p) => String(p && p.id || ""));
    if (!r || !r.ok) throw new Error(r && r.grunn || "feil");
    tilstand.grupper = r.liste || tilstand.grupper;
    tilstand.grValgt = post.id;
    tilstand.grNavnFelt = false;
    const mangler = lagene.filter(x => !x.lagret && !x.fraLager && !iBiblioteket(x));
    if (!post.hoved.libId) varsel(t("Gruppen «{0}» er lagret. Hovedmodellen ligger ikke i biblioteket — den må åpnes for hånd før gruppen.", n));
    else if (mangler.length) varsel(t("Gruppen «{0}» er lagret, men {1} er ikke lagret i SharePoint og kan ikke åpnes fra gruppen.", n, mangler.map(x => "«" + x.navn + "»").join(", ")));
    else varsel(finnes ? t("Gruppen «{0}» er oppdatert.", n) : t("Gruppen «{0}» er lagret.", n));
    return post;
  } catch (err) {
    varsel(t("Klarte ikke å lagre gruppen: {0}", err.message));
    return null;
  } finally {
    tilstand.grJobber = ""; tegn();
  }
}

export async function apneGruppe(g) {
  if (!g || tilstand.grJobber || tilstand.jobber) return;
  stoppModuser(null);
  if (S.fileName !== g.hoved.navn) {
    if (!g.hoved.libId) { varsel(t("Åpne «{0}» først — den ligger ikke i biblioteket. Velg så gruppen på nytt.", g.hoved.navn)); return; }
    if (S.modelGroup && !confirm(t("Åpne gruppen «{0}»? «{1}» lukkes, og «{2}» åpnes med lagene.", g.navn, S.fileName, g.hoved.navn))) return;
    tilstand.grJobber = t("Åpner {0} …", g.hoved.navn); tegn();
    try { await (await import("./sharepoint.js")).spOpenFile({ id: g.hoved.libId, name: g.hoved.navn, size: g.hoved.size }); } catch (_) {}
    if (S.fileName !== g.hoved.navn || !S.modelGroup) { tilstand.grJobber = ""; tegn(); varsel(t("Klarte ikke å åpne «{0}».", g.hoved.navn)); return; }
    apnePanel("lagPanel");
  }
  const mangler = [];
  try {
    for (let i = 0; i < g.lag.length; i++) {
      const l = g.lag[i];
      tilstand.grJobber = t("Legger på lag {0} av {1}: {2}", i + 1, g.lag.length, l.navn); tegn();
      let lag = lagene.find(x => x.fil === l.fil);
      if (!lag) {
        const kilde = { art: "gruppe", navn: l.fil, size: l.size, endret: l.endret,
          item: l.libId ? { id: l.libId, name: l.fil, size: l.size, lastModifiedDateTime: l.endret } : null };
        lag = await leggTilLag(kilde, { fag: l.fag, farge: l.farge, fraGruppe: true });
      }
      if (!lag) { mangler.push(l.navn); continue; }
      // Gruppens oppsett: farge, gjennomsiktighet, synlig og justering
      lag.fraGruppe = true;
      lag.farge = l.farge; if (lag.materiale) lag.materiale.color.set(l.farge);
      lag.gjennom = l.gjennom; if (lag.materiale) settGjennomsiktig(lag.materiale, l.gjennom);
      lag.synlig = l.synlig; if (lag.gruppe) lag.gruppe.visible = l.synlig;
      brukJustering(lag, l.justering);
      if (R.erJustert(lag.justering)) lagreJustering(lag);
    }
  } finally {
    tilstand.grJobber = "";
    tilstand.grValgt = g.id;
    tegn();
    if (S.oppdaterVisAlle) S.oppdaterVisAlle();
    if (S.tegnUtseendePanel) S.tegnUtseendePanel();
  }
  varsel(mangler.length ? t("Gruppen «{0}» er åpnet, men {1} kunne ikke legges på.", g.navn, mangler.map(x => "«" + x + "»").join(", "))
    : t("Gruppen «{0}» er åpnet ({1} lag).", g.navn, g.lag.length));
}

// Logget inn (popup — siden står): lagre lagene som ventet, hent gruppene
function lagreUlagrede() {
  for (const lag of lagene) if (kanLagres(lag) && !lag.lagret && !lag.fraLager) { lag.lagreFeil = false; lagreLagISharePoint(lag); }
  tilstand.grupper = null;
  const p = $("lagPanel");
  if (p && p.classList.contains("open")) hentGrupper(true);
  tegn();
}
{
  const tidligere = S.onSignedIn;
  S.onSignedIn = () => { if (tidligere) try { tidligere(); } catch (_) {} setTimeout(lagreUlagrede, 0); };
}

// ---------- 📊 Mengder per lag ----------
// Folder seg ut under kortene. Hovedmodellen fra Mengder (samme tall som
// Mengder-panelet), lagene fra egne nøkkeltall og volum. Excel: ett ark per
// modell + Sammendrag.
function mengdeListe() {
  const ut = [];
  if (tilstand.hovedM && tilstand.hovedM.m && tilstand.hovedM.fil === S.fileName)
    ut.push({ navn: R.lagNavn(S.fileName), rolle: "Hovedmodell", farge: "#8b939e", m: tilstand.hovedM.m });
  for (const lag of lagene) ut.push({ navn: lag.navn, rolle: "Lag", farge: lag.farge, m: R.lagMengder(lag.props || {}, lag.tall || {}, lag.volum || null, lag.maal || null) });
  return ut;
}
async function regnHovedMengder() {
  if (!S.modelGroup || (tilstand.hovedM && tilstand.hovedM.fil === S.fileName)) return;
  const fil = S.fileName;
  tilstand.hovedM = { fil, regner: true }; tegn();
  try {
    const E = await import("./elements.js");
    const c = await E.sikreMengder();
    // 🧅 Armeringen i hovedmodellen: nøkkeltallene leses fra IFC-en i
    // IFC-tråden (samme kommando som for lag). Bare når hovedmodellen er en
    // åpen IFC — en lett kopi (GLB) har ikke stangdataene.
    let tall = null;
    if (!S.glbActive && S.modelID !== null && S.modelID !== undefined) {
      try {
        const { kall, navnFor } = await import("./ifcrpc.js");
        const raa = await kall("lagTall", {});
        tall = {};
        for (const [id, x] of Object.entries((raa && raa.tall) || {})) {
          const a = R.armeringTall(x, navnFor(Number(id)));
          if (a) tall[id] = a;
        }
      } catch (_) { tall = null; }
    }
    if (S.fileName === fil) tilstand.hovedM = { fil, m: R.hovedMengder(c ? c.groups : [], tall), utenStangdata: !!S.glbActive };
  } catch (err) {
    console.warn(err);
    tilstand.hovedM = { fil, feil: true };
  }
  tegn();
}
const MAKS_TYPER_I_PANELET = 10;
function tabellHtml(m) {
  let h = "";
  const tall = (n, d) => R.heltall(n) + (d ? " " + d : "");
  if (m.perDiameter.length) {
    h += '<table class="lag-m"><tr><th>' + esc(t("Diameter")) + '</th><th>' + esc(t("Stenger")) + '</th><th>' + esc(t("Løpemeter")) + '</th><th>' + esc(t("Vekt")) + '</th></tr>' +
      m.perDiameter.map(x => '<tr><td>' + (x.d ? "Ø" + x.d : esc(t("Ukjent"))) + '</td><td>' + tall(x.stk) + '</td><td>' + tall(x.lm, "m") + '</td><td>' + esc(R.vektTekst(x.kg)) + '</td></tr>').join("") +
      '<tr class="sum"><td>' + esc(t("Sum")) + '</td><td>' + tall(m.sumArm.stk) + '</td><td>' + tall(m.sumArm.lm, "m") + '</td><td>' + esc(R.vektTekst(m.sumArm.kg)) + '</td></tr></table>';
    const former = new Set((m.perForm || []).map(x => x.form).filter(Boolean)).size;
    if (former) h += '<p class="lag-merk">' + esc(t("{0} bøyeformer — se arket «Per bøyeform» i Excel.", former)) + '</p>';
  }
  if (m.rader.length) {
    // 📏 Enhet per rad (Emils valg A 29.10) — som i Endringsmelding
    const r = R.medEnhet(m.rader, tilstand.enheter);
    const vis = r.slice(0, MAKS_TYPER_I_PANELET);
    const valg = (x) => '<select class="lag-enhet' + (x.egenValgt ? " egen" : "") + '" data-enhet="' + esc(R.radNokkel(x.navn, x.materiale)) + '" title="' + esc(t("Enhet")) + '">' +
      R.ENHETER.map(e => '<option' + (e === x.enhet ? " selected" : "") + '>' + e + '</option>').join("") + '</select>';
    h += '<table class="lag-m"><tr><th>' + esc(t("Type")) + '</th><th>' + esc(t("Antall")) + '</th><th>' + esc(t("Enhet")) + '</th><th>' + esc(t("Mengde")) + '</th></tr>' +
      vis.map(x => '<tr><td>' + esc(x.navn) + (x.materiale ? '<div class="lag-mat">' + esc(x.materiale) + '</div>' : "") + '</td><td>' + tall(x.antall) + '</td><td>' + valg(x) + '</td><td><b>' + esc(R.enhetTekst(x.mengde, x.enhet)) + '</b></td></tr>').join("") +
      (r.length > vis.length ? '<tr><td colspan="4" class="lag-merk">' + esc(t("… og {0} typer til (se Excel)", r.length - vis.length)) + '</td></tr>' : "") +
      R.sumPerEnhet(r).map((x, n) => '<tr class="' + (n ? "sum2" : "sum") + '"><td>' + esc(t("Sum")) + ' ' + x.enhet + '</td><td></td><td></td><td>' + esc(R.enhetTekst(x.mengde, x.enhet)) + '</td></tr>').join("") + '</table>';
  }
  return h || '<p class="lag-merk">' + esc(t("Ingen mengder")) + '</p>';
}
function mengderHtml() {
  if (!lagene.length) return "";
  const antall = lagene.length + 1;
  let h = '<button class="lag-mengder-knapp" id="lagMengder"><b>' + (tilstand.visMengder ? "▾ " : "▸ ") + esc(t("Mengder per lag")) + '</b><span>' + esc(t("{0} modeller", antall)) + '</span></button>';
  if (!tilstand.visMengder) return h;
  h += '<div class="lag-mengder">';
  const hm = tilstand.hovedM && tilstand.hovedM.fil === S.fileName ? tilstand.hovedM : null;
  if (!hm) setTimeout(regnHovedMengder, 0);
  h += '<div class="lag-mh"><span class="lag-prikk" style="background:#8b939e"></span>' + esc(R.lagNavn(S.fileName)) + ' <i>' + esc(t("hovedmodell")) + '</i></div>';
  h += !hm || hm.regner ? '<p class="lag-merk">' + esc(t("Regner ut mengder …")) + '</p>' : hm.feil ? '<p class="lag-merk">' + esc(t("Klarte ikke å regne ut mengdene for hovedmodellen.")) + '</p>' :
    tabellHtml(hm.m) + (hm.utenStangdata && hm.m.rader.some(x => /ReinforcingBar/i.test(x.type)) ? '<p class="lag-merk">' + esc(t("Hovedmodellen er en lett kopi: armeringen telles som Revit-sett, uten diameter og vekt. Åpne IFC-en for stenger og vekt.")) + '</p>' : "");
  for (const lag of lagene) h += '<div class="lag-mh"><span class="lag-prikk" style="background:' + esc(lag.farge) + '"></span>' + esc(lag.navn) + ' <i>' + esc(t(lag.fag)) + '</i></div>' +
    tabellHtml(R.lagMengder(lag.props || {}, lag.tall || {}, lag.volum || null, lag.maal || null));
  h += '<div class="lag-knapper"><button class="primary" id="lagMengderXlsx">' + esc(t("Excel – ett ark per lag")) + '</button><button id="lagMengderKopier">' + esc(t("Kopier")) + '</button></div>';
  return h + '</div>';
}
// Excel: Sammendrag, ett ark per modell, og «Per bøyeform» for hver modell
// med armering (Emil 29.10). Er det bare én, heter arket bare «Per bøyeform».
function arkene() {
  const liste = mengdeListe();
  const medForm = liste.filter(x => x.m.perForm && x.m.perForm.length);
  const formNavn = medForm.map(x => medForm.length === 1 ? t("Per bøyeform") : t("Bøyeform") + " " + x.navn);
  const navn = R.arkNavnListe([t("Sammendrag")].concat(liste.map(x => x.navn), formNavn));
  return [{ navn: navn[0], rader: R.sammendragRader(liste, t) }]
    .concat(liste.map((x, i) => ({ navn: navn[i + 1], rader: R.mengdeRader(x.m, t, tilstand.enheter) })))
    .concat(medForm.map((x, i) => ({ navn: navn[liste.length + 1 + i], rader: R.boyeformRader(x.m.perForm, t) })));
}
export async function lastNedMengder() {
  const E = await import("./elements.js");
  const g = valgtGruppe();
  const base = (g && g.hoved.navn === S.fileName ? g.navn : R.lagNavn(S.fileName)).replace(/[\\/:*?"<>|]/g, "-");
  return E.lastNedXlsxFlere(base + " - mengder per lag.xlsx", arkene());
}
function kobleMengder(body) {
  const k = body.querySelector("#lagMengder");
  if (k) k.onclick = () => { tilstand.visMengder = !tilstand.visMengder; tegn(); if (tilstand.visMengder) regnHovedMengder(); };
  body.querySelectorAll("select[data-enhet]").forEach(sel => sel.onchange = () => {
    tilstand.enheter[sel.dataset.enhet] = sel.value;
    lagreEnheter();
    tegn();
  });
  const x = body.querySelector("#lagMengderXlsx");
  if (x) x.onclick = () => lastNedMengder().catch(err => varsel(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err)));
  const c = body.querySelector("#lagMengderKopier");
  if (c) c.onclick = async () => {
    const celle = (v) => (v && typeof v === "object" ? String(v.verdi ?? "") : String(v ?? "")).replace(/[\t\r\n]/g, " ").replace(/^([=+\-@])/, "'$1");
    const tsv = arkene().map(a => a.navn + "\r\n" + a.rader.map(r => r.map(celle).join("\t")).join("\r\n")).join("\r\n\r\n");
    try { await navigator.clipboard.writeText(tsv); c.textContent = t("Kopiert"); setTimeout(() => { if (c.isConnected) c.textContent = t("Kopier"); }, 1500); }
    catch (_) { varsel(t("Klarte ikke å kopiere. Bruk Excel-knappen i stedet.")); }
  };
}
export { arkene as _arkene, mengdeListe as _mengdeListe, hentGrupper as _hentGrupper };

// ---------- 📐 Juster plassering (Emils valg A, 28.10.2026) ----------
// Inne på lag-kortet: høyde fra etasjene med samme navn, sideveis fra
// midtpunktet av samme søyle/pæl i begge modellene, og finjustering med
// tastene. Justeringen (mm langs IFC-aksene) legges OPPÅ T — se
// lag-regn.js justertMatrise. Den lagres per hovedmodell + lag-fil, så
// den er med neste gang samme lag legges på samme hovedmodell.
const JUSTERING_FIL = "justeringer.json";
const LOKAL_NOKKEL = "storm.lagJustering";

function justertTekst(lag) {
  const k = (lag.justering.kilde || []).map(x => t(x === "etasjer" ? "etasjer" : x === "midtpunkt" ? "midtpunkt" : "manuelt"));
  return t("Justert {0}", R.justeringTekst(lag.justering)) + (k.length ? " (" + k.join(", ") + ")" : "") + " · " + t("lagres med laget");
}

// Flytter laget til justeringen j. Ingen angre her — den som kaller, eier angre-posten.
function brukJustering(lag, j) {
  lag.justering = R.vaskJustering(j);
  if (lag.gruppe) {
    lag.gruppe.matrix.fromArray(R.justertMatrise(lag.T, lag.justering, S.enhetSkala));
    lag.gruppe.updateMatrixWorld(true);
  }
  oppdaterJusterTall(lag);
}
// Under flytting med tastene tegnes ikke hele panelet på nytt — bare tallene
function oppdaterJusterTall(lag) {
  const body = $("lagBody");
  if (!body) return;
  for (const [k, felt] of [["ost", "ost"], ["nord", "nord"], ["hoyde", "hoyde"]]) {
    const inp = body.querySelector('[data-j-' + felt + '="' + lag.id + '"]');
    if (inp && document.activeElement !== inp) inp.value = String(lag.justering[k] || 0).replace(".", ",");
  }
  const lbl = body.querySelector('[data-justert="' + lag.id + '"]');
  if (lbl) lbl.textContent = R.erJustert(lag.justering) ? justertTekst(lag) : "";
}

// Én endring = én angre-post, og lagring
function endreJustering(lag, ny, tekst) {
  const foer = R.vaskJustering(lag.justering), etter = R.vaskJustering(ny);
  if (JSON.stringify(foer) === JSON.stringify(etter)) return;
  brukJustering(lag, etter);
  lagreJustering(lag);
  tegn();
  if (S.pushAngre) S.pushAngre({ tekst: tekst || t("Laget flyttet"),
    angre: () => { brukJustering(lag, foer); lagreJustering(lag); tegn(); },
    gjenopprett: () => { brukJustering(lag, etter); lagreJustering(lag); tegn(); } });
}

// ----- Etasjene -----
async function hovedEtasjer() {
  const fil = S.fileName || "";
  if (tilstand.hovedEt && tilstand.hovedEt.fil === fil) return tilstand.hovedEt;
  let liste = null, grunn = "";
  if (S.glbActive) {
    const st = (S.glbStoreys || []).filter(e => e && isFinite(e.mm));
    if (st.length) liste = st.map(e => ({ navn: e.name, mm: e.mm }));
    else grunn = "lett";
  } else if (S.modelID !== null && S.modelID !== undefined) {
    try {
      const { kall } = await import("./ifcrpc.js");
      liste = ((await kall("storeys", { medTomme: true })) || []).filter(e => e && isFinite(e.mm)).map(e => ({ navn: e.name, mm: e.mm }));
    } catch (_) { liste = null; grunn = "feil"; }
  }
  tilstand.hovedEt = { fil, liste, grunn };
  return tilstand.hovedEt;
}
async function beregnForslag(lag) {
  const h = await hovedEtasjer();
  lag.forslag = h.liste ? Object.assign(R.etasjeForslag(h.liste, lag.etasjer || []), { grunn: "" })
    : { par: [], forslag: 0, spredning: 0, antall: 0, grunn: h.grunn || "ingen" };
  tegn();
}

function forslagHtml(lag) {
  const f = lag.forslag;
  if (!f) return '<div class="lag-forslag ok">' + esc(t("Leser etasjene …")) + '</div>';
  if (f.grunn === "lett") return '<div class="lag-forslag ok">' + esc(t("Hovedmodellen er en lett kopi uten etasjehøyder. Lag den lette kopien på nytt, eller åpne IFC-en.")) + '</div>';
  if (!(lag.etasjer || []).length) return '<div class="lag-forslag ok">' + esc(t("Laget har ingen etasjer i IFC-en. Bruk midtpunkt og tastene.")) + '</div>';
  if (!f.antall) return '<div class="lag-forslag ok">' + esc(t("Fant ingen etasjer med samme navn i hovedmodellen og laget.")) + '</div>';
  const navn = (f.like && f.like.length ? f.like : f.par).map(p => p.navn).join(", ");
  const spr = f.avvik && f.avvik.length ? '<span>' + esc(t("Avviker: {0}. Kontroller før du justerer.", f.avvik.map(p => p.navn + " (" + R.mmFortegn(p.diff) + " mm)").join(", "))) + '</span>' : "";
  if (Math.abs(f.forslag) < 0.5) return '<div class="lag-forslag ok">' + esc(t("Høyde fra etasjer: {0} stemmer (0 mm).", navn)) + spr + '</div>';
  const ferdig = Math.abs((lag.justering.hoyde || 0) - f.forslag) < 0.5;
  const retning = f.forslag < 0 ? t("{0} ligger {1} mm høyere i laget.", navn, R.heltall(Math.abs(f.forslag))) : t("{0} ligger {1} mm lavere i laget.", navn, R.heltall(Math.abs(f.forslag)));
  return '<div class="lag-forslag' + (ferdig ? " ok" : "") + '"><span><b>' + esc(t("Høyde fra etasjer:")) + '</b> ' + esc(retning) + '</span>' + spr +
    (ferdig ? '<span>✓ ' + esc(t("Høyden er justert etter etasjene.")) + '</span>'
      : '<button class="primary" data-j-etasje="' + lag.id + '">' + esc(t("Juster {0} mm", R.mmFortegn(f.forslag))) + '</button>') + '</div>';
}

function justerHtml(lag) {
  const m = tilstand.midt && tilstand.midt.lagId === lag.id ? tilstand.midt : null;
  const fl = tilstand.flytt && tilstand.flytt.lagId === lag.id;
  const steg = tilstand.steg || 10;
  const tall = (k, lbl) => '<label>' + esc(lbl) + '<input type="text" inputmode="decimal" data-j-' + k + '="' + lag.id + '" value="' + esc(String(lag.justering[k] || 0).replace(".", ",")) + '"></label>';
  return '<div class="lag-juster">' +
    '<div class="lag-juster-lbl">' + esc(t("JUSTER PLASSERING")) + '</div>' +
    forslagHtml(lag) +
    '<div class="lag-sideveis' + (m ? " aktiv" : "") + '">' +
      (m ? '<span>' + esc(m.steg === 1 ? t("1/2: Klikk en søyle eller pæl i hovedmodellen.") : t("2/2: Klikk den samme søylen eller pælen i laget.")) + '</span>' +
           '<button data-j-midt-av="' + lag.id + '">' + esc(t("Avbryt")) + '</button>'
         : '<span>' + esc(t("Sideveis: klikk en søyle/pæl i hovedmodellen, så den samme i laget. Midtpunktene sett ovenfra legges oppå hverandre.")) + '</span>' +
           '<button data-j-midt="' + lag.id + '">' + esc(t("Midtpunkt …")) + '</button>') +
    '</div>' +
    '<div class="lag-tall">' + tall("ost", t("Øst (mm)")) + tall("nord", t("Nord (mm)")) + tall("hoyde", t("Høyde (mm)")) + '</div>' +
    '<div class="lag-flytt"><button data-j-flytt="' + lag.id + '"' + (fl ? ' class="active"' : "") + '>⌨ ' + esc(fl ? t("Ferdig (Esc)") : t("Flytt med tastene")) + '</button>' +
      '<span class="lag-steg">' + R.STEG_MM.map(n => '<button data-j-steg="' + n + '"' + (n === steg ? ' class="active"' : "") + '>' + n + ' mm</button>').join("") + '</span>' +
      '<button data-j-null="' + lag.id + '"' + (R.erJustert(lag.justering) ? "" : " disabled") + '>' + esc(t("Nullstill")) + '</button></div>' +
    '<div class="lag-taster">' + (fl
      ? '<kbd>←</kbd> <kbd>→</kbd> ' + esc(t("vest/øst")) + ' · <kbd>↑</kbd> <kbd>↓</kbd> ' + esc(t("nord/sør")) + ' · <kbd>Z</kbd> / ' + esc(t("rull fram = opp")) + ' · <kbd>X</kbd> / ' + esc(t("rull bak = ned")) + ' · <kbd>Shift</kbd> = 1 mm'
      : esc(t("Med «Flytt med tastene» på styrer piltastene, Z/X og rullehjulet laget i stedet for kameraet."))) + '</div>' +
  '</div>';
}

const lesMm = (v) => { const n = Number(String(v || "").replace(/\s/g, "").replace(",", ".").replace("−", "-")); return isFinite(n) ? n : null; };

function kobleJuster(body) {
  body.querySelectorAll("[data-juster]").forEach(b => b.onclick = () => {
    const lag = finnLag(b.dataset.juster); if (!lag) return;
    lag.visJuster = !lag.visJuster;
    if (!lag.visJuster) stoppModuser(lag);
    tegn();
    if (lag.visJuster && !lag.forslag) beregnForslag(lag);
  });
  body.querySelectorAll("[data-j-etasje]").forEach(b => b.onclick = () => {
    const lag = finnLag(b.dataset.jEtasje); if (!lag || !lag.forslag) return;
    const j = R.vaskJustering(lag.justering);
    j.hoyde = lag.forslag.forslag;
    if (!j.kilde.includes("etasjer")) j.kilde.push("etasjer");
    endreJustering(lag, j, t("Høyde justert etter etasjene"));
  });
  body.querySelectorAll("[data-j-midt]").forEach(b => b.onclick = () => startMidtpunkt(finnLag(b.dataset.jMidt)));
  body.querySelectorAll("[data-j-midt-av]").forEach(b => b.onclick = () => { stoppMidtpunkt(); tegn(); });
  body.querySelectorAll("[data-j-flytt]").forEach(b => b.onclick = () => {
    const lag = finnLag(b.dataset.jFlytt); if (!lag) return;
    if (tilstand.flytt && tilstand.flytt.lagId === lag.id) stoppFlytt(); else startFlytt(lag);
  });
  body.querySelectorAll("[data-j-steg]").forEach(b => b.onclick = () => { tilstand.steg = Number(b.dataset.jSteg) || 10; tegn(); });
  body.querySelectorAll("[data-j-null]").forEach(b => b.onclick = () => {
    const lag = finnLag(b.dataset.jNull); if (!lag) return;
    endreJustering(lag, R.vaskJustering(null), t("Lagets justering nullstilt"));
  });
  for (const k of ["ost", "nord", "hoyde"]) {
    body.querySelectorAll("[data-j-" + k + "]").forEach(inp => {
      inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
      inp.onchange = () => {
        const lag = finnLag(inp.getAttribute("data-j-" + k)); if (!lag) return;
        const v = lesMm(inp.value);
        if (v === null) { inp.value = String(lag.justering[k] || 0).replace(".", ","); return; }
        const j = R.vaskJustering(lag.justering);
        j[k] = v;
        if (!j.kilde.includes("manuelt")) j.kilde.push("manuelt");
        endreJustering(lag, j, t("Laget flyttet"));
      };
    });
  }
}

// ----- Midtpunkt: klikk i hovedmodellen, så i laget -----
function startMidtpunkt(lag) {
  if (!lag) return;
  stoppFlytt();
  tilstand.midt = { lagId: lag.id, steg: 1, hovedBoks: null };
  S.lagKlikk = midtKlikk;
  window.addEventListener("keydown", midtEsc, true);
  tegn();
  varsel(t("Klikk en søyle eller pæl i hovedmodellen."));
}
function stoppMidtpunkt() {
  if (!tilstand.midt) return;
  tilstand.midt = null;
  if (S.lagKlikk === midtKlikk) S.lagKlikk = null;
  window.removeEventListener("keydown", midtEsc, true);
}
function midtEsc(e) { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stoppMidtpunkt(); tegn(); } }

// Boksen (scenen) rundt ett element i et lag — fra trekantene i `ranges`
function lagElementBoks(lag, id) {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (const m of lag.gruppe.children) {
    if (!m.isMesh || !m.userData.ranges) continue;
    const p = m.geometry.getAttribute("position").array, ix = m.geometry.getIndex().array;
    for (const r of m.userData.ranges) {
      if (r.id !== id) continue;
      for (let i = r.start; i < r.start + r.count; i++) { const vi = ix[i] * 3; b.expandByPoint(v.set(p[vi], p[vi + 1], p[vi + 2]).applyMatrix4(m.matrixWorld)); }
    }
  }
  return b.isEmpty() ? null : b;
}
const tilBoks = (b) => ({ min: b.min.toArray(), max: b.max.toArray() });

// Svarer true når trykket er brukt (main.js spør S.lagKlikk først)
function midtKlikk(x, y) {
  const m = tilstand.midt;
  if (!m) return false;
  const lag = finnLag(m.lagId);
  if (!lag || !lag.gruppe) { stoppMidtpunkt(); tegn(); return true; }
  if (m.steg === 1) {
    const h = pick(x, y);
    const id = h ? hitID(h) : null;
    const b = id != null ? elementBoxById(id) : null;
    if (!b) { varsel(t("Traff ikke noe i hovedmodellen. Klikk en søyle eller pæl.")); return true; }
    m.hovedBoks = tilBoks(b); m.steg = 2;
    tegn();
    varsel(t("Klikk den samme søylen eller pælen i laget «{0}».", lag.navn));
    return true;
  }
  const k = kontrakt(lag).plukk(x, y);
  const b = k ? lagElementBoks(lag, k.id) : null;
  if (!b) { varsel(t("Traff ikke noe i laget «{0}». Klikk den samme søylen eller pælen der.", lag.navn)); return true; }
  const d = R.midtpunktFlytt(m.hovedBoks, tilBoks(b), S.enhetSkala);
  stoppMidtpunkt();
  // Mer enn 25 cm? Da er det trolig ikke samme søyle/pæl (en vegg foran
  // søyla gir fort en meter feil — funnet i testen 28.10). Spør først.
  const lengde = Math.round(Math.hypot(d.ost, d.nord));
  if (lengde > 250 && !confirm(t("Midtpunktene ligger {0} mm fra hverandre. Er det samme søyle eller pæl i begge? Flytt likevel?", R.heltall(lengde)))) { tegn(); return true; }
  const j = R.vaskJustering(lag.justering);
  j.ost = Math.round((j.ost + d.ost) * 10) / 10; j.nord = Math.round((j.nord + d.nord) * 10) / 10;
  if (!j.kilde.includes("midtpunkt")) j.kilde.push("midtpunkt");
  endreJustering(lag, j, t("Laget flyttet etter midtpunkt"));
  varsel(t("Midtpunktene lagt oppå hverandre: Øst {0} mm, Nord {1} mm.", R.mmFortegn(d.ost), R.mmFortegn(d.nord)));
  return true;
}

// ----- Flytt med tastene -----
const erSkrivefelt = (el) => !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !/^(button|range|color|checkbox|radio)$/i.test(el.type)) || el.isContentEditable);
function flyttTast(e) {
  const f = tilstand.flytt; if (!f) return;
  if (erSkrivefelt(e.target)) return;
  if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); stoppFlytt(); return; }
  const d = R.tasteFlytt(e.key, tilstand.steg || 10, { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
  if (!d) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const lag = finnLag(f.lagId); if (!lag) return;
  brukJustering(lag, R.leggTil(lag.justering, d, "manuelt"));
}
function flyttRull(e) {
  const f = tilstand.flytt; if (!f) return;
  if (e.target !== canvas) return;   // rulling i panelene virker som før
  e.preventDefault(); e.stopImmediatePropagation();
  const d = R.rulleFlytt(e.deltaY, tilstand.steg || 10, e.shiftKey);
  const lag = finnLag(f.lagId);
  if (d && lag) brukJustering(lag, R.leggTil(lag.justering, d, "manuelt"));
}
function startFlytt(lag) {
  stoppMidtpunkt();
  stoppFlytt();
  tilstand.flytt = { lagId: lag.id, start: R.vaskJustering(lag.justering) };
  window.addEventListener("keydown", flyttTast, true);
  window.addEventListener("wheel", flyttRull, { capture: true, passive: false });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  tegn();
  varsel(t("Flytt laget med piltastene, Z/X eller rullehjulet. Esc = ferdig."));
}
// Hele flytte-økta blir ÉN angre-post
function stoppFlytt() {
  const f = tilstand.flytt;
  if (!f) return;
  tilstand.flytt = null;
  window.removeEventListener("keydown", flyttTast, true);
  window.removeEventListener("wheel", flyttRull, { capture: true });
  const lag = finnLag(f.lagId);
  if (lag) {
    const foer = f.start, etter = R.vaskJustering(lag.justering);
    if (JSON.stringify(foer) !== JSON.stringify(etter)) {
      lagreJustering(lag);
      if (S.pushAngre) S.pushAngre({ tekst: t("Laget flyttet med tastene"),
        angre: () => { brukJustering(lag, foer); lagreJustering(lag); tegn(); },
        gjenopprett: () => { brukJustering(lag, etter); lagreJustering(lag); tegn(); } });
    }
  }
  tegn();
}
function stoppModuser(lag) {
  if (!lag || (tilstand.midt && tilstand.midt.lagId === lag.id)) stoppMidtpunkt();
  if (!lag || (tilstand.flytt && tilstand.flytt.lagId === lag.id)) stoppFlytt();
}

// ----- Lagring: denne maskinen + SharePoint (Lag/justeringer.json) -----
function lesLokalt() { try { return JSON.parse(localStorage.getItem(LOKAL_NOKKEL) || "{}") || {}; } catch (_) { return {}; } }
function lagreJustering(lag) {
  if (!S.fileName || !lag.fil) return;
  const id = R.justeringId(S.fileName, lag.fil);
  const post = Object.assign({ id, hoved: S.fileName, lag: lag.fil, endret: new Date().toISOString() }, R.vaskJustering(lag.justering));
  try { const alle = lesLokalt(); alle[id] = post; localStorage.setItem(LOKAL_NOKKEL, JSON.stringify(alle)); } catch (_) {}
  clearTimeout(lag._lagreTid);
  if (spPaalogget()) lag._lagreTid = setTimeout(() => {
    spSkriv(LAG_MAPPE, JUSTERING_FIL, [post], (p) => String(p && p.id || "")).catch(() => {});
  }, 1500);
}
async function hentLagretJustering(lag) {
  if (!S.fileName || !lag.fil) return;
  const id = R.justeringId(S.fileName, lag.fil);
  let best = lesLokalt()[id] || null;
  if (spPaalogget()) {
    try {
      const r = await spLes(LAG_MAPPE, JUSTERING_FIL);
      const p = (r.liste || []).find(x => x && x.id === id);
      if (p && (!best || String(p.endret || "") > String(best.endret || ""))) best = p;
    } catch (_) {}
  }
  if (!best || !lagene.includes(lag)) return;
  // Brukeren rakk å justere selv mens vi leste — da vinner det
  if (R.erJustert(lag.justering) || lag.fraGruppe) return;   // gruppens justering vinner
  const j = R.vaskJustering(best);
  if (!R.erJustert(j)) return;
  brukJustering(lag, j);
  tegn();
  varsel(t("«{0}»: lagret justering brukt ({1}).", lag.navn, R.justeringTekst(j)));
}
export { brukJustering as _brukJustering, midtKlikk as _midtKlikk, startFlytt as _startFlytt, stoppFlytt as _stoppFlytt, startMidtpunkt as _startMidtpunkt };

// Gå til et lag (brukes av testene og hjelpekortet)
export function zoomTilLag(lag) {
  const b = new THREE.Box3().setFromObject(lag.gruppe);
  if (!b.isEmpty()) flyTil(b.getCenter(new THREE.Vector3()), b.getSize(new THREE.Vector3()).length());
}
export { clearSelection as _clearSelection };
// Testene: rundtur lag → .lag.glb → lag (bufferen i SharePoint)
export { lagGlb as _lagGlb, lesGlb as _lesGlb };
