// Valg, egenskaper, søk, mengder og markeringsboks.
import * as THREE from "three";
import { $, ekstraLagSom, på, S, apnePanel, dec, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { TETTHET } from "./config.js";
import { kolBokstav, sumFormel } from "./regneark.js";
import { profilKgPerM } from "./profiler.js";
import { hiddenIDs, hideElement, hideElements, typeSkjultLett } from "./display.js";
import { alleElementIder, lightElementBoxes } from "./ifc.js";
import { kall, metaFor, sikreMeta } from "./ifcrpc.js";
import { axesGroup, camera, canvas, controls, flyTil, grid, koteGroup, markerGroup, measureGroup, omradeGroup, pointer, raycaster, renderer, scene, selGroup } from "./scene.js";
import { materiellGroup, materiellTypeLabel, oppdaterMateriellValgEffekt } from "./materiell-vis.js";
import { skjulMaal, vekselMaal } from "./maal.js";

const selMat = new THREE.MeshLambertMaterial({ color: 0x3b82f6, emissive: 0x1d4ed8, side: THREE.DoubleSide });

const selMatLight = new THREE.MeshBasicMaterial({
  color: 0x3b82f6, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});

// Hvor mange rader elementlista viser før den kortes av. 0 = vis alle.
export function listeGrense() {
  const n = Number(S.settings.listLimit);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

// Tar bort BARE den blå uthevingen i 3D. Brukes internt når et nytt sett skal
// tegnes opp (da skal S.multiSel stå urørt).
function clearSelectionVisual() {
  S.selectedMeshes.forEach(({ mesh, mat }) => mesh.material = mat);
  S.selectedMeshes = [];
  selGroup.children.forEach(h => h.geometry.dispose());
  selGroup.clear();
  S.currentPropID = null;
}

// Nullstiller valget HELT – både uthevingen og flervalgslista.
// VIKTIG: S.multiSel må tømmes her. Ellers lever de gamle elementene videre i
// lista selv om de ikke lenger er blå, og neste shift-klikk drar dem opp igjen
// (klikk i tomrommet, skjul/vis, fargelegging og transparent kaller alle hit).
export function clearSelection() {
  clearSelectionVisual();
  // 📐 målene hører til ETT valgt element. Forsvinner valget, skal de bort –
  // ellers blir de stående på et element ingen lenger ser er valgt.
  skjulMaal();
  S.multiSel.clear();
  // 📦 materiell-flervalget nullstilles i samme slengen — «vanlig klikk
  // nullstiller» skal gjelde hele utvalget, ikke bare IFC-delen av det
  if (S.multiSelMat && S.multiSelMat.size) {
    S.multiSelMat.clear();
    oppdaterMateriellValgEffekt();
  }
  // 🧱 …og valget i lagene ved siden av modellen (SW-elementene). Uten dette
  // ble et SW-element stående blått etter at du hadde klikket i tomrommet.
  for (const l of ekstraLagSom("velg")) l.velg([]);
}

// Finn expressID fra et raycast-treff (også i sammenslått geometri)
export function hitID(hit) {
  const u = hit.object.userData;
  if (!u.merged) return u.expressID;
  const fi = hit.faceIndex * 3;
  const r = u.ranges;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fi < r[mid].start) hi = mid - 1;
    else if (fi >= r[mid].start + r[mid].count) lo = mid + 1;
    else return r[mid].id;
  }
  return null;
}

export function pick(clientX, clientY, ignoreClip) {
  if (!S.modelGroup) return null;
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = S.modelGroup.children.filter(m => m.visible);
  const hits = raycaster.intersectObjects(visible, false);
  // hopp over treff bak snittplanet
  if (!ignoreClip && renderer.clippingPlanes.length) {
    for (const h of hits) {
      if (renderer.clippingPlanes.every(p => p.distanceToPoint(h.point) >= -0.001)) return h;
    }
    return null;
  }
  return hits.length ? hits[0] : null;
}

// 🧱 Plukk i lagene ved siden av modellen. pick() over ser BARE S.modelGroup,
// med vilje — SW-elementene og materiellet bor i egne grupper. Hvert lag svarer
// selv på hva som ligger under pekeren, og oppgir avstanden, så kallstedet kan
// avgjøre hvem som lå nærmest kameraet. Et nytt lag blir med her ved å melde
// inn evnen «plukk», ikke ved at noen husker å utvide denne funksjonen.
export function pickEkstra(x, y) {
  let best = null;
  for (const l of ekstraLagSom("plukk")) {
    const h = l.plukk(x, y);
    if (h && (!best || h.avstand < best.avstand)) best = Object.assign({ lag: l }, h);
  }
  return best;
}

export function selectElement(expressID, additive) {
  if (!additive) clearSelection();
  S.currentPropID = expressID;
  if (S.lightLoaded) {
    // bygg en liten kopi av elementets trekanter som legges oppå
    S.modelGroup.children.forEach(m => {
      if (!m.userData.merged) return;
      const rs = m.userData.ranges.filter(r => r.id === expressID);
      if (!rs.length) return;
      const p = m.geometry.getAttribute("position").array;
      const ix = m.geometry.getIndex().array;
      let n = 0;
      rs.forEach(r => n += r.count);
      const arr = new Float32Array(n * 3);
      let o = 0;
      rs.forEach(r => {
        for (let i = r.start; i < r.start + r.count; i++) {
          const vi = ix[i] * 3;
          arr[o] = p[vi]; arr[o+1] = p[vi+1]; arr[o+2] = p[vi+2];
          o += 3;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const hl = new THREE.Mesh(g, selMatLight);
      hl.renderOrder = 996;
      selGroup.add(hl);
    });
    return;
  }
  S.modelGroup.children.forEach(m => {
    if (m.userData.expressID === expressID) {
      S.selectedMeshes.push({ mesh: m, mat: m.material });
      m.material = selMat;
    }
  });
}

export function val(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "value" in v) return v.value;
  return v;
}

// Asynkron fordi egenskapslista hentes fra IFC-tråden. Kallerne trenger ikke
// vente – panelet fyller seg selv når svaret kommer.
export async function showProperties(expressID) {
  const body = $("propBody");
  const rows = [];
  let psets = [];        // egenskapssett fra IFC-fila – se psetHtml under
  if (S.glbActive) {
    const p = S.glbProps ? S.glbProps.get(expressID) : null;
    $("propTitle").textContent = (p && p[2]) || t("Element");
    rows.push(["ExpressID", expressID]);
    if (p && p[0]) rows.push(["Name", p[0]]);
    if (p && p[1]) rows.push(["ObjectType", p[1]]);
    if (p && p[3]) rows.push([t("Materiale"), p[3]]);
    try { maalRader(expressID).forEach(r => rows.push(r)); } catch(_){}
    rows.push([t("Merk"), t("Lett kopi – åpne original-IFC-en for full egenskapsliste")]);
  } else {
    // IFC-tråden svarer med hele egenskapslista i én runde
    let p = null;
    try { p = await kall("props", { id: expressID }); } catch(_) {}
    if (!p || p.feil) rows.push([t("Feil"), t("Kunne ikke lese egenskaper")]);
    else {
      $("propTitle").textContent = (p.typeName ? "Ifc" + p.typeName : t("Element"));
      rows.push(["ExpressID", expressID]);
      p.felt.forEach(([k, v]) => rows.push([k, v]));
      const mMeta = metaFor(expressID);
      if (mMeta && mMeta.material) rows.push([t("Materiale"), mMeta.material]);
      try { maalRader(expressID).forEach(r => rows.push(r)); } catch(_){}
      psets = p.psets || [];
    }
  }

  body.innerHTML =
    '<div class="prop-actions">' +
      '<button id="paHide">' + ikon("skjul") + ' ' + t("Skjul element") + '</button>' +
      '<button id="paMaal">' + ikon("maal") + ' ' + t("Vis mål") + '</button>' +
    '</div>' +
    rows.map(([k,v]) =>
    `<div class="prop-row"><div class="k">${esc(String(k))}</div><div class="v">${esc(String(v))}</div></div>`).join("") +
    psetHtml(psets);
  $("paHide").onclick = () => hideElement(expressID);   // virker nå også i 🪶 (synkMergedSkjuling)
  // 📐 Vis mål. Vanlig import og ikke import(): en dynamisk import ville falt
  // utenfor lista service workeren forhåndslagrer, og knappen hadde vært død
  // uten dekning – nøyaktig der den trengs.
  const maalKnapp = $("paMaal");
  const settAv = () => maalKnapp.classList.toggle("active", S.maalFor === expressID);
  settAv();
  maalKnapp.onclick = () => {
    try { vekselMaal(expressID); } catch (err) { console.warn(err); }
    settAv();
  };
  apnePanel("propPanel");
}


// ---------- Egenskapssettene (Pset) fra IFC-fila ----------
//
// HVA DETTE ER. Alt over denne streken er noe vi selv har regnet ut eller lest
// rett av elementet. Pset-ene er noe ANNET: egenskapssett den prosjekterende
// har lagt på elementet i Revit/Tekla og sendt med i IFC-fila. Vi finner ikke
// på dem, og vi kan ikke rette dem – står det noe rart der, står det rart i
// modellen. De er verdt å ha: `LoadBearing`, `IsExternal` og `Reference`
// (armeringsmengde, elementtype, brannkrav) er ofte det eneste stedet den
// opplysningen finnes.
//
// HVORFOR DE NÅ STÅR GRUPPERT.
// Før sto hvert navn med hele settet foran seg, på hver eneste rad:
// «Pset_ReinforcementBarPitchOfColumn · Reference». Navnekolonnen kan ikke
// krympe (den skal stå i flukt nedover), så en så lang tekst presset
// verdikolonnen ned til ingenting – og verdien brøt til 2–3 bokstaver per
// linje, nedover i det uendelige. Settnavnet står nå ÉN gang, som overskrift,
// og radene under bærer bare egenskapsnavnet. Samme opplysning, en brøkdel av
// bredden. (Bredden er dessuten sikret i css/storm.css, så en lang tekst aldri
// kan gjøre dette igjen.)
function psetHtml(psets) {
  if (!psets || !psets.length) return "";
  // Rekkefølgen fra IFC-fila beholdes – den er ofte den prosjekterende sin
  // egen gruppering, og å sortere den alfabetisk ville skjult det.
  const grupper = new Map();
  for (const [k, v] of psets) {
    const i = String(k).indexOf(" · ");
    const sett = i > 0 ? k.slice(0, i) : "Pset";
    const navn = i > 0 ? k.slice(i + 3) : String(k);
    if (!grupper.has(sett)) grupper.set(sett, []);
    grupper.get(sett).push([navn, v]);
  }
  return '<div class="pset-bolk">' +
    '<div class="pset-tittel">' + esc(t("Egenskaper fra IFC-fila")) + '</div>' +
    [...grupper].map(([sett, felt]) =>
      '<div class="pset-navn">' + esc(sett) + '</div>' +
      felt.map(([k, v]) =>
        '<div class="prop-row"><div class="k">' + esc(String(k)) + '</div>' +
        '<div class="v">' + esc(String(v)) + '</div></div>').join("")
    ).join("") + '</div>';
}

// ---------- Målradene i egenskapspanelet ----------
//
// Rekkefølgen er tenkt: det du bestiller etter kommer først.
//   1. Mål L×B×T – rettet etter største flate (se retteMaal). Faller tilbake
//      til den akse-justerte boksen hvis elementet ikke har noen flate å rette
//      seg etter (buede flater, punktskyer).
//   2. Areal, største flate – vegglivet på en vegg, oversida på et dekke.
//   3. Fotavtrykk – BARE når det er noe annet enn største flate. På et dekke er
//      de to like, og da er én linje nok. På en vegg står de langt fra
//      hverandre, og da skal begge stå der, slik at ingen tror den ene er den
//      andre.
//   4. Volum, og et varsko når elementet er et åpent skall.
function maalRader(id) {
  const rows = [];
  const q = elementQuantities(id);
  let r = null;
  try { r = retteMaal(id); } catch (_) {}
  if (r) {
    // Største mål først, så raden leses likt uansett hvilken vei rammen rundt
    // flata tilfeldigvis falt. Tykkelsen står alltid sist – den er den ene av
    // de tre som betyr noe bestemt.
    const lb = [r.lengde, r.bredde].sort((a, b) => b - a);
    rows.push([t("Mål L×B×T (ca)"),
      [lb[0], lb[1], r.tykkelse].map(fmtDim).join(" × ") + " m"]);
    // Arealet tas fra mengdeuttaket (q.storsteFlate), ikke fra retteMaal, slik
    // at panelet og Mengder-tabellen ALLTID viser samme tall for samme element.
    // retteMaal gjør sin egen gjennomgang for å kunne tegne flata, og to
    // uavhengige utregninger av samme størrelse ender før eller siden i strid.
    rows.push([t("Areal, største flate (ca)"), fmtArea(q.storsteFlate)]);
    // 2 % – under det er forskjellen avrunding i geometrien, ikke en ekte forskjell.
    if (Math.abs(q.storsteFlate - q.area) > Math.max(q.storsteFlate, q.area) * 0.02)
      rows.push([t("Areal, fotavtrykk (ca)"), fmtArea(q.area)]);
  } else {
    rows.push([t("Mål L×B×H (ca)"), q.dims.map(fmtDim).join(" × ") + " m"]);
    rows.push([t("Areal, fotavtrykk (ca)"), fmtArea(q.area)]);
  }
  rows.push([t("Overflate i alt (ca)"), fmtArea(q.overflate)]);
  rows.push([t("Volum (ca)"), fmtVol(q.vol)]);
  if (q.lukket === false)
    rows.push([t("Merk"), t("Åpen flate uten tykkelse – volumet er ikke et ekte volum")]);
  return rows;
}

// ---------- 🔎 Elementsøk ----------

// ---------- 🔎 Elementsøk ----------

function buildSearchIndex() {
  S.searchIndex = [];
  const push = (id, name, objType, tag, type) => S.searchIndex.push({
    id,
    name: name || "", objType: objType || "", tag: tag || "", type: type || "",
    s: ((name || "") + " " + (objType || "") + " " + (tag || "") + " " + id).toLowerCase()
  });
  if (S.glbActive) {
    for (const [id, p] of (S.glbProps || new Map()))
      push(id, p[0], p[1], "", (p[2] || "").replace(/^Ifc/i, ""));
  } else if (S.modelID !== null) {
    const ids = new Set();
    S.modelGroup.children.forEach(m => {
      if (m.userData.merged) (m.userData.ranges || []).forEach(r => ids.add(r.id));
      else if (m.userData.expressID !== undefined) ids.add(m.userData.expressID);
    });
    for (const id of ids) {
      const m = metaFor(id);
      if (m) push(id, m.name, m.objectType, m.tag, m.typeName);
    }
  }
}

export function elementBoxById(id) {
  if (S.lightLoaded) return lightElementBoxes(new Set([id])).get(id) || null;
  let box = null;
  const tmp = new THREE.Box3();
  S.modelGroup.children.forEach(m => {
    if (m.userData.expressID === id) {
      tmp.setFromObject(m);
      if (box) box.union(tmp); else box = tmp.clone();
    }
  });
  return box;
}

// ---------- 🧮 Mengder per element ----------
const _qa = new THREE.Vector3(), _qb = new THREE.Vector3(), _qc = new THREE.Vector3();

// Bounding box for alle elementer (bygges én gang per modell)

export function allElementBoxes() {
  if (S.allBoxCache) return S.allBoxCache;
  const map = new Map();
  if (S.lightLoaded) lightElementBoxes(null, map);
  else {
    const tmp = new THREE.Box3();
    S.modelGroup.children.forEach(m => {
      const id = m.userData.expressID;
      if (id === undefined) return;
      tmp.setFromObject(m);
      const b = map.get(id);
      if (b) b.union(tmp); else map.set(id, tmp.clone());
    });
  }
  S.allBoxCache = map;
  return map;
}

// Bidraget fra ÉN trekant, som rene tall uten three.js – da kan matematikken
// testes for seg selv.
//   vol6  = 6 × signert volum av tetraederet origo–a–b–c (summen over et lukket
//           legeme gir 6 × volumet, uansett hvor legemet står)
//   proj2 = 2 × trekantens areal projisert ned i planet (Y er opp i scenen).
//           Absoluttverdi, så vindingsretningen i modellen ikke spiller inn.
export function triBidrag(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const vol6 = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  // Kryssproduktet (b-a) × (c-a). Lengden er 2 × trekantens areal, og
  // y-komponenten forteller hvor flatt den ligger. proj2 er nettopp |ny| —
  // fotavtrykket har alltid vært den vertikale delen av samme vektor.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const area2 = Math.hypot(nx, ny, nz);
  // nx/nz følger med fordi plangrupperingen (storsteFlate) trenger hele
  // normalen, ikke bare hvor flatt trekanten ligger. Regnestykket skal stå ÉTT
  // sted – ikke gjøres om igjen i den som kaller.
  return { vol6, proj2: Math.abs(ny), area2, nx, ny, nz };
}

// Randbidraget fra ÉN trekant: Σ (a−c) × (b−c) over de tre rettede kantene
// a→b, b→c, c→a. Legges rett inn i akkumulatoren `ut` (tre tall).
//
// En indre kant deles av to trekanter og går én gang hver vei; de to bidragene
// er like store med motsatt fortegn og stryker hverandre. Står summen igjen
// som noe annet enn null, har elementet en fri kant – det er et åpent skall.
// Punktet c er vilkårlig (vi bruker boksens senter): for et lukket legeme går
// summen i null uansett hva c er.
export function randBidrag(ut, c, a, b, d) {
  const p = [a, b, d];
  for (let i = 0; i < 3; i++) {
    const u = p[i], v = p[(i + 1) % 3];
    const ux = u.x - c[0], uy = u.y - c[1], uz = u.z - c[2];
    const vx = v.x - c[0], vy = v.y - c[1], vz = v.z - c[2];
    ut[0] += uy * vz - uz * vy;
    ut[1] += uz * vx - ux * vz;
    ut[2] += ux * vy - uy * vx;
  }
  return ut;
}

// Hvilken vei vender flata? Brukes til forskaling: sidene og undersidene skal
// forskales, toppen er støpeflate.
//
// GRENSEN ER 45°. En flate som heller mindre enn 45° fra vannrett regnes som
// topp eller underside; brattere enn det regnes som side. Valget er en
// vurdering, ikke en naturlov — men det er den som samsvarer med at en skrå
// flate må forskales lenge før den blir loddrett.
export const FLATE_GRENSE = Math.SQRT1_2;   // cos(45°)

export function flateRetning(area2, ny) {
  if (area2 <= 0) return "side";
  const t = ny / area2;
  if (t > FLATE_GRENSE) return "topp";
  if (t < -FLATE_GRENSE) return "under";
  return "side";
}

// Gjør summene om til meter og m²/m³.
// Et lukket legeme har både over- og underside, og begge kaster samme skygge –
// derfor deles den projiserte summen på 2 til slutt (Σproj2 / 4). Et åpent
// skall (tak, kledning, importerte flater) har bare ÉN side og skal ikke
// halveres.
//
// HVORDAN VI VET OM LEGEMET ER LUKKET (F15).
// Før sto det `lukket = vol > 1e-9`: en absoluttgrense på volumet. Den er feil
// på to måter. Et åpent skall har ikke volum 0 – den signerte tetraeder-summen
// måler kjeglen fra origo ut til flata, og den er stor så snart elementet ikke
// ligger på origo. Alle åpne skall ble derfor regnet som lukkede, og
// fotavtrykket kom ut HALVPARTEN av det det skulle være.
//
// Nå avgjøres det av randen i stedet, som er det spørsmålet faktisk handler om:
// `randSum` er Σ (a−c) × (b−c) over alle RETTEDE kanter i elementet. Hver indre
// kant finnes i begge retninger og stryker seg selv ut, så summen er nøyaktig
// null for et lukket legeme – uansett hvor det står, og uansett hvilket punkt c
// vi måler fra. Har elementet en fri kant, blir summen stående igjen.
// Terskelen er relativ til overflata (begge er kvadrat av lengde), så den
// betyr det samme i en mm-modell og i en m-modell.
export const RAND_GRENSE = 1e-4;

export function sluttMengder(volSum, projSum, toM, rand, areal2Sum) {
  const vol = Math.abs(volSum) * toM * toM * toM;
  // rand/areal2Sum utelatt (gamle kallere og enhetstestene): fall tilbake til
  // den gamle regelen framfor å gjette.
  const lukket = (rand === undefined || !areal2Sum)
    ? vol > 1e-9
    : rand <= areal2Sum * RAND_GRENSE;
  return { vol, area: projSum / (lukket ? 4 : 2) * toM * toM, lukket };
}

// Beregner ytre mål, volum (m³) og fotavtrykk (m²) for et sett elementer i ÉN
// gjennomgang av geometrien.
// Volum: signert tetraeder-sum – funker for lukkede volumer som betong og stålprofiler.
// Fotavtrykk: grunnflaten sett rett ovenfra – se triBidrag/sluttMengder over.
//   NB: Skrå og hvelvede flater blir riktig projisert, men et element som
//   overlapper seg selv i høyden (f.eks. en trapp) får skyggen regnet to ganger.
// Går gjennom geometrien én gang og gir hver trekant til `cb`. Trukket ut
// fordi lengdemålingen under trenger to gjennomganger, og den logikken (merged
// vs. eget mesh, ranges, matrise) skal finnes ÉN gang.
export function forHverTrekant(idSet, cb) {
  S.modelGroup.children.forEach(m => {
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute("position");
    const ix = m.geometry.getIndex();
    if (m.userData.merged) {
      if (!ix) return;
      (m.userData.ranges || []).forEach(r => {
        if (!idSet.has(r.id)) return;
        for (let i = r.start; i < r.start + r.count; i += 3)
          cb(p, ix.getX(i), ix.getX(i + 1), ix.getX(i + 2), null, r.id);
      });
    } else if (idSet.has(m.userData.expressID)) {
      const n = ix ? ix.count : p.count;
      for (let i = 0; i < n; i += 3)
        cb(p, ix ? ix.getX(i) : i, ix ? ix.getX(i + 1) : i + 1, ix ? ix.getX(i + 2) : i + 2,
           m.matrixWorld, m.userData.expressID);
    }
  });
}

// Beregner ytre mål, volum (m³), fotavtrykk (m²), overflate delt på retning og
// virkelig lengde for et sett elementer.
//
// Volum: signert tetraeder-sum – funker for lukkede volumer som betong og
// stålprofiler.
// Fotavtrykk: grunnflaten sett rett ovenfra – se triBidrag/sluttMengder over.
//   NB: Skrå og hvelvede flater blir riktig projisert, men et element som
//   overlapper seg selv i høyden (f.eks. en trapp) får skyggen regnet to ganger.
// Overflate: hver trekants areal, sortert på om flata vender opp, ned eller
//   til siden. Til forskaling.
//
// ---------------------------------------------------------------------------
// LENGDE: HVORFOR TO GJENNOMGANGER OG IKKE BOUNDING BOX.
//
// Lengden var tidligere lengste side i en AKSE-JUSTERT boks. Det er riktig for
// en søyle eller bjelke som står langs aksene, og FEIL for alt som står på
// skrå: en 45°-avstiver får en boks som er ~71 % av stavens virkelige lengde.
// Kappliste og kg/m på avstivning ble dermed systematisk for lave, uten at noe
// på skjermen sa fra.
//
// Nå måles den lengste avstanden mellom to punkter på elementet:
//   1. gjennomgang – finn punktet lengst unna et vilkårlig startpunkt
//   2. gjennomgang – finn punktet lengst unna DET punktet
// For et avlangt legeme treffer runde 1 alltid en ende, og runde 2 gir da den
// andre. Det koster én ekstra runde gjennom geometrien, og det er verdt det:
// alternativet er et tall som er trygt feil.
// ---------------------------------------------------------------------------
export function quantitiesForSet(idSet) {
  const toM = S.enhetSkala || 1;   // meter per modellenhet – én sannhet, satt i ifc.js
  const vols = new Map();
  const projs = new Map();   // Σ|n.y| per element – rå, før halvering
  const flater = new Map();  // Σ area2 per retning
  const start = new Map();   // første punkt vi så på elementet
  const fjern = new Map();   // punktet lengst unna start, og avstanden dit
  const rander = new Map();  // Σ (a−c)×(b−c) over rettede kanter – 0 = lukket (se sluttMengder)
  const area2S = new Map();  // Σ area2 per element – målestokken rand-testen holdes opp mot
  // Plangruppene, til «største flate». Ett FLATT tall-array per element –
  // [nx,ny,nz,d,area2, nx,ny,nz,d,area2, …] – og ikke objekter: dette kjøres
  // over hele modellen (7 000+ elementer i et vanlig bygg), og et objekt per
  // plan koster fem ganger så mye minne som de fem tallene det bærer.
  const planAkk = new Map();
  const dTol = PLAN_AVSTAND_M / toM;      // 5 mm uttrykt i modellenheter

  // Boksene hentes FØR gjennomgangen: rand-summen måles fra boksens senter, og
  // da slipper vi at tallene vokser med avstanden til modellens nullpunkt.
  const boxes = allElementBoxes();
  const _c = new THREE.Vector3();
  const sentre = new Map();
  for (const id of idSet) {
    const b = boxes.get(id);
    sentre.set(id, b ? b.getCenter(_c).toArray() : [0, 0, 0]);
  }

  const sePunkt = (id, x, y, z) => {
    const s0 = start.get(id);
    if (!s0) { start.set(id, [x, y, z]); fjern.set(id, [x, y, z, 0]); return; }
    const d2 = (x - s0[0]) ** 2 + (y - s0[1]) ** 2 + (z - s0[2]) ** 2;
    const f = fjern.get(id);
    if (d2 > f[3]) { f[0] = x; f[1] = y; f[2] = z; f[3] = d2; }
  };

  const addTri = (p, i0, i1, i2, mtx, id) => {
    _qa.fromBufferAttribute(p, i0); _qb.fromBufferAttribute(p, i1); _qc.fromBufferAttribute(p, i2);
    if (mtx) { _qa.applyMatrix4(mtx); _qb.applyMatrix4(mtx); _qc.applyMatrix4(mtx); }
    const t = triBidrag(_qa.x, _qa.y, _qa.z, _qb.x, _qb.y, _qb.z, _qc.x, _qc.y, _qc.z);
    vols.set(id, (vols.get(id) || 0) + t.vol6 / 6);
    projs.set(id, (projs.get(id) || 0) + t.proj2);
    let f = flater.get(id);
    if (!f) { f = { topp: 0, under: 0, side: 0 }; flater.set(id, f); }
    f[flateRetning(t.area2, t.ny)] += t.area2;
    area2S.set(id, (area2S.get(id) || 0) + t.area2);
    // Randen: Σ (a−c)×(b−c) over de tre rettede kantene. Se sluttMengder.
    let rv = rander.get(id);
    if (!rv) { rv = [0, 0, 0]; rander.set(id, rv); }
    randBidrag(rv, sentre.get(id) || [0, 0, 0], _qa, _qb, _qc);
    // Plangruppen trekanten hører til. Se planFlater for hvorfor og hvordan.
    if (t.area2 > 0) {
      const inv = 1 / t.area2;
      const nx = t.nx * inv, ny = t.ny * inv, nz = t.nz * inv;
      const d = nx * _qa.x + ny * _qa.y + nz * _qa.z;
      let pa = planAkk.get(id);
      if (!pa) { pa = []; planAkk.set(id, pa); }
      let traff = false;
      for (let k = 0; k < pa.length; k += 5) {
        if (pa[k] * nx + pa[k+1] * ny + pa[k+2] * nz > PLAN_VINKEL && Math.abs(pa[k+3] - d) < dTol) {
          pa[k+4] += t.area2; traff = true; break;
        }
      }
      if (!traff && pa.length < PLAN_MAKS * 5) pa.push(nx, ny, nz, d, t.area2);
    }
    sePunkt(id, _qa.x, _qa.y, _qa.z);
    sePunkt(id, _qb.x, _qb.y, _qb.z);
    sePunkt(id, _qc.x, _qc.y, _qc.z);
  };

  forHverTrekant(idSet, addTri);

  // Runde 2: lengste avstand fra det punktet runde 1 fant.
  const lengder = new Map();
  const seLengde = (p, i0, i1, i2, mtx, id) => {
    const f = fjern.get(id);
    if (!f) return;
    for (const i of [i0, i1, i2]) {
      _qa.fromBufferAttribute(p, i);
      if (mtx) _qa.applyMatrix4(mtx);
      const d2 = (_qa.x - f[0]) ** 2 + (_qa.y - f[1]) ** 2 + (_qa.z - f[2]) ** 2;
      if (d2 > (lengder.get(id) || 0)) lengder.set(id, d2);
    }
  };
  forHverTrekant(idSet, seLengde);

  const out = new Map();
  const s = new THREE.Vector3();
  const m2 = toM * toM;
  for (const id of idSet) {
    let dims = [0, 0, 0];
    const b = boxes.get(id);
    if (b) { b.getSize(s); dims = [s.x * toM, s.y * toM, s.z * toM].sort((a, x) => x - a); }
    const rv = rander.get(id);
    const rand = rv ? Math.hypot(rv[0], rv[1], rv[2]) : undefined;
    const m = sluttMengder(vols.get(id) || 0, projs.get(id) || 0, toM, rand, area2S.get(id) || 0);
    const f = flater.get(id) || { topp: 0, under: 0, side: 0 };
    const pa = planAkk.get(id);
    let storst = 0;
    if (pa) for (let k = 4; k < pa.length; k += 5) if (pa[k] > storst) storst = pa[k];
    out.set(id, {
      // Største sammenhengende flate (m²) – vegglivet på en vegg, oversida på
      // et dekke. Se planFlater for hele begrunnelsen.
      storsteFlate: storst / 2 * m2,
      dims, vol: m.vol, area: m.area, lukket: m.lukket,
      // hele overflata (m²) – summen av de tre retningene under
      overflate: (f.topp + f.under + f.side) / 2 * m2,
      // area2 er 2 × arealet — derfor /2 her, i tillegg til enhetsskalaen
      flateTopp: f.topp / 2 * m2,
      flateUnder: f.under / 2 * m2,
      flateSide: f.side / 2 * m2,
      len: Math.sqrt(lengder.get(id) || 0) * toM
    });
  }
  return out;
}

// ---------- 📐 Største flate på ett element ----------
//
// HVORFOR DETTE MÅLET FINNES.
// «Areal» i egenskapspanelet var fotavtrykket – grunnflaten sett rett ovenfra.
// Det er riktig tall for et dekke, en plate eller et fundament, og det er feil
// tall for en vegg: en betongvegg på 8 × 3 m har et fotavtrykk på 8 × 0,2 m.
// Skal du bestille isolasjon eller kledning til den veggen, er det vegglivet du
// trenger, ikke skyggen den kaster.
//
// Derfor grupperes trekantene i PLAN: alle trekanter som ligger i samme plan og
// vender samme vei hører til samme flate. Den flata med størst areal er
// elementets største flate. For en vegg blir det vegglivet, for et dekke blir
// det oversida (som er nøyaktig fotavtrykket), for en bjelke blir det steget
// eller flensen. Ett mål som betyr det samme for alle: «den største
// sammenhengende flata du kan legge hånda på».
//
// Arealet er summen av de ekte trekantene i planet – ikke lengde × bredde. Et
// veggliv med en døråpning i får derfor arealet MINUS døra, som er det du
// faktisk skal kle.
//
// TOLERANSENE. To trekanter regnes i samme plan når normalene peker innenfor
// ~1,8° av hverandre OG planene ligger nærmere enn 5 mm fra hverandre. Vinkelen
// er romslig nok til at avrunding i IFC-fila ikke splitter en flat vegg, og
// stram nok til at et saltak ikke smelter sammen med veggen under.
export const PLAN_VINKEL = 0.9995;        // cos(~1,8°)
export const PLAN_AVSTAND_M = 0.005;      // 5 mm, målt i meter
// Taket på antall plan er en sikring mot buede flater: en sylinder gir ett plan
// per trekant, og «største flate» betyr ingenting på en sylinder uansett. Det
// SAMME taket brukes i mengdeuttaket og i panelet – ellers kunne de to vist
// forskjellig areal for samme element, og da er begge tall verdiløse.
export const PLAN_MAKS = 64;

// Deler ett elements geometri i plan. Returnerer planene sortert på areal,
// største først. Koordinatene er i MODELLENS enheter; arealet er i m².
// Brukes av egenskapspanelet og av 📐 Vis mål – ikke av mengdeuttaket, som går
// gjennom hele modellen og ikke har råd til å ta vare på trekanter.
export function planFlater(id) {
  const toM = S.enhetSkala || 1;
  const dTol = PLAN_AVSTAND_M / toM;      // 5 mm uttrykt i modellenheter
  const planer = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  forHverTrekant(new Set([id]), (p, i0, i1, i2, mtx) => {
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    if (mtx) { a.applyMatrix4(mtx); b.applyMatrix4(mtx); c.applyMatrix4(mtx); }
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    if (!(area2 > 0)) return;             // sammenfalt trekant – ingen flate
    nx /= area2; ny /= area2; nz /= area2;
    const d = nx * a.x + ny * a.y + nz * a.z;
    let pl = null;
    for (const q of planer) {
      if (q.nx * nx + q.ny * ny + q.nz * nz > PLAN_VINKEL && Math.abs(q.d - d) < dTol) { pl = q; break; }
    }
    if (!pl) {
      if (planer.length >= PLAN_MAKS) return;
      pl = { nx, ny, nz, d, area2: 0, pk: [] };
      planer.push(pl);
    }
    pl.area2 += area2;
    pl.pk.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  });

  planer.sort((x, y) => y.area2 - x.area2);
  const m2 = toM * toM;
  planer.forEach(q => q.areal = q.area2 / 2 * m2);
  return planer;
}

// Den minste rettvinklede rammen rundt en flate, liggende I flata.
// Kandidatretningene er flatas egne kanter (avrundet til hele grader, maks 90
// stykker): for en rektangulær flate treffer én av dem nøyaktig, og for en
// uregelmessig flate gir den minste av dem den rammen som ligger tettest på.
// Rammen brukes bare til å TEGNE målene – arealet er alltid trekantsummen.
export function flateRamme(pl) {
  const n = new THREE.Vector3(pl.nx, pl.ny, pl.nz);
  // to akser i planet
  const hjelp = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(hjelp, n).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const P = pl.pk;
  // 2D-punktene i planet
  const xs = [], ys = [];
  for (let i = 0; i < P.length; i += 3) {
    xs.push(P[i] * e1.x + P[i+1] * e1.y + P[i+2] * e1.z);
    ys.push(P[i] * e2.x + P[i+1] * e2.y + P[i+2] * e2.z);
  }
  const vinkler = new Set([0]);
  for (let i = 0; i + 2 < xs.length && vinkler.size < 90; i += 3) {
    for (const [j, k] of [[0,1],[1,2],[2,0]]) {
      const dx = xs[i+k] - xs[i+j], dy = ys[i+k] - ys[i+j];
      if (dx || dy) vinkler.add(Math.round(Math.atan2(dy, dx) * 180 / Math.PI + 180) % 180);
    }
  }
  let best = null;
  for (const grad of vinkler) {
    const r = grad * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    let m1 = Infinity, M1 = -Infinity, m2 = Infinity, M2 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const u = xs[i] * cs + ys[i] * sn, v = -xs[i] * sn + ys[i] * cs;
      if (u < m1) m1 = u; if (u > M1) M1 = u;
      if (v < m2) m2 = v; if (v > M2) M2 = v;
    }
    const areal = (M1 - m1) * (M2 - m2);
    if (!best || areal < best.areal) best = { areal, cs, sn, m1, M1, m2, M2 };
  }
  if (!best) return null;
  // aksene rammen faktisk ligger langs, tilbake i 3D
  const u = e1.clone().multiplyScalar(best.cs).add(e2.clone().multiplyScalar(best.sn));
  const v = e1.clone().multiplyScalar(-best.sn).add(e2.clone().multiplyScalar(best.cs));
  // hjørnet (m1, m2) som punkt i rommet: legg på planets avstand langs normalen
  const hjorne = u.clone().multiplyScalar(best.m1).add(v.clone().multiplyScalar(best.m2))
    .add(n.clone().multiplyScalar(pl.d));
  return { u, v, n, hjorne, lengde: best.M1 - best.m1, bredde: best.M2 - best.m2 };
}

// Målene til ett element rettet etter den største flata: lengde og bredde i
// flata, og tykkelsen på tvers av den.
//
// HVORFOR IKKE BARE BRUKE BOKSEN. «Mål L×B×H» var den akse-justerte boksen.
// For en vegg som står langs X eller Z er den riktig. For en vegg som står på
// skrå – og det gjør halvparten av veggene i et virkelig bygg – blir boksen for
// stor i to retninger samtidig: en 8 m vegg på 45° får en boks på 5,7 × 5,7 m,
// og da stemmer verken lengden, bredden eller tykkelsen. Måler vi langs flatas
// egne akser i stedet, står tallene likt uansett hvordan bygget er rotert.
export function retteMaal(id) {
  const planer = planFlater(id);
  if (!planer.length) return null;
  const pl = planer[0];
  const r = flateRamme(pl);
  if (!r) return null;
  const toM = S.enhetSkala || 1;
  // tykkelsen: hvor langt elementet strekker seg på tvers av flata
  let lav = Infinity, hoy = -Infinity;
  const a = new THREE.Vector3();
  forHverTrekant(new Set([id]), (p, i0, i1, i2, mtx) => {
    for (const i of [i0, i1, i2]) {
      a.fromBufferAttribute(p, i);
      if (mtx) a.applyMatrix4(mtx);
      const t = a.x * r.n.x + a.y * r.n.y + a.z * r.n.z;
      if (t < lav) lav = t;
      if (t > hoy) hoy = t;
    }
  });
  return {
    areal: pl.areal,
    lengde: r.lengde * toM,
    bredde: r.bredde * toM,
    tykkelse: (hoy > lav ? hoy - lav : 0) * toM,
    lav, hoy,            // i modellenheter, langs flatas normal – 📐 tegner tykkelsen mellom dem
    plan: pl, ramme: r
  };
}

function elementQuantities(id) {
  return quantitiesForSet(new Set([id])).get(id) ||
    { dims: [0, 0, 0], vol: 0, area: 0, storsteFlate: 0, overflate: 0,
      flateTopp: 0, flateUnder: 0, flateSide: 0, len: 0 };
}

// Desimaler følger ⚙ Innstillinger. Små volumer får alltid nok desimaler til å
// vise noe – et 0,005 m³-element skal ikke stå som «0,00 m³».
export function fmtVol(v) {
  const d = Math.max(dec(), v > 0 && v < 0.01 ? 3 : 0);
  return v.toFixed(d) + " m³";
}

export function fmtDim(d) { return d.toFixed(dec()); }

export function elemDisplayName(id) {
  if (S.glbActive) { const p = S.glbProps && S.glbProps.get(id); return (p && (p[0] || p[1])) || ("ID " + id); }
  // objectType med liten o: det er navnet cmdMeta i ifc-worker.js returnerer.
  // Sto som line.ObjectType, som alltid var undefined – derfor viste elementer
  // uten Name «ID 12345» i flervalg, søk og hele sammenligningslista.
  try { const line = metaFor(id) || {}; return (line.name || null) || val(line.objectType) || ("ID " + id); } catch(_) { return "ID " + id; }
}

// ---------- Flervalg (shift-klikk) med samlede mengder ----------

// Asynkron fordi navnene (metaFor) må hentes fra IFC-tråden første gang —
// samme grep som Søk og Mengder (sikreMeta caches, så det koster bare én
// runde). Kallerne venter ikke; panelet fyller seg når svaret kommer. Uten
// dette sto utvalget som «ID 134, ID 159 …» til man hadde åpnet Mengder.
async function showMultiSummary() {
  const antElem = S.multiSel.size;
  if (antElem && !S.glbActive && S.modelID !== null) {
    try { await sikreMeta(alleElementIder); } catch (_) {}
  }
  // Grupperes NØYAKTIG som Mengder (computeQuantities): samme gruppenøkkel
  // (ObjectType/navn + materiale), samme radformat — «24 stk · 82.6 m ·
  // 1.3 m² · 0.185 m³». Da leses flervalget og Mengder som samme verktøy.
  const grupper = new Map();
  let totVol = 0, totLen = 0, totArea = 0;
  for (const [id, q] of S.multiSel) {
    let name = "", objType = "", typeName = "", material = "";
    if (S.glbActive) {
      const p = S.glbProps ? S.glbProps.get(id) : null;
      if (p) { name = p[0] || ""; objType = p[1] || ""; typeName = (p[2] || "").replace(/^Ifc/, ""); material = p[3] || ""; }
    } else {
      const meta = metaFor(id);
      if (meta) { name = meta.name || ""; objType = meta.objectType || ""; typeName = meta.typeName || ""; material = meta.material || ""; }
    }
    const key = (objType || name.replace(/:\d+$/, "") || typeName || "Ukjent") + (material ? " · " + material : "");
    const len = q.len || (q.dims ? q.dims[0] : 0) || 0;
    // Samme areal som Mengder og egenskapspanelet: største flate.
    const vol = q.vol || 0, area = q.storsteFlate || 0;
    totVol += vol; totLen += len; totArea += area;
    let g = grupper.get(key);
    if (!g) grupper.set(key, g = { count: 0, len: 0, area: 0, vol: 0, type: typeName });
    g.count++; g.len += len; g.area += area; g.vol += vol;
  }
  // 📦 Materiell i utvalget — egne grupper med PARAMETRISKE tall (målene
  // brukeren satte × antall), samme nøkkel og type som radene deres i Mengder
  // (materiellMengdeRader). Objekter som er slettet eller skjult i mellomtiden
  // lukes ut av settet her: de kan ikke pekes på, og skal ikke bli i summene.
  if (S.multiSelMat && S.multiSelMat.size) {
    const alle = new Map((S.materiell || []).map(p => [p.id, p]));
    for (const id of [...S.multiSelMat]) {
      const p = alle.get(id);
      if (!p || p.skjult) { S.multiSelMat.delete(id); continue; }
      const label = materiellTypeLabel(p);
      const L = p.lengde / 1000, B = p.bredde / 1000, H = p.tykkelse / 1000;
      const len = Math.max(L, B, H) * p.antall, area = L * B * p.antall;
      totLen += len; totArea += area;
      const key = (p.navn || label) + " · " + label;
      let g = grupper.get(key);
      if (!g) grupper.set(key, g = { count: 0, len: 0, area: 0, vol: 0, type: "Materiell" });
      g.count += p.antall; g.len += len; g.area += area;
    }
  }
  const antMat = S.multiSelMat ? S.multiSelMat.size : 0;
  if (!antElem && !antMat) { $("propPanel").classList.remove("open"); return; }
  // Hvor mange rader lista viser før den kortes av. Settes i ⚙ Innstillinger →
  // Visning → «Elementer i lista». 0 = vis alle (kan bli tregt på tusenvis).
  const items = [...grupper.entries()].sort((a, b) => b[1].count - a[1].count);
  const grense = listeGrense();
  const vist = grense > 0 ? items.slice(0, grense) : items;
  $("propTitle").textContent =
    antElem && antMat ? t("{0} elementer og {1} materiell valgt", antElem, antMat)
    : antMat ? t("{0} materiell valgt", antMat)
    : t("{0} elementer valgt", antElem);
  // Samme «Skjul»-knapp som når ett element er valgt – her skjuler den hele
  // utvalget. Ikke i lav kvalitet / lett kopi: der er geometrien slått sammen,
  // så enkeltelementer kan ikke skjules (samme grunn som i showProperties).
  // Knappen gjelder IFC-elementene — materiell skjules fra sin egen knapperad
  // eller 📦-panelet, og vises derfor bare når utvalget har elementer.
  $("propBody").innerHTML =
    (antElem ? '<div class="prop-actions"><button id="paHideSel">' + ikon("skjul") + ' ' +
      t("Skjul {0} valgte", antElem) + '</button></div>' : "") +
    '<div class="prop-row" style="font-weight:600"><div class="k">' + t("Sum volum") + '</div><div class="v">' + fmtVol(totVol) + '</div></div>' +
    '<div class="prop-row" style="font-weight:600"><div class="k">' + t("Sum areal (største flate)") + '</div><div class="v">' + fmtArea(totArea) + '</div></div>' +
    '<div class="prop-row"><div class="k">' + t("Sum lengde (lengste mål)") + '</div><div class="v">' + totLen.toFixed(2) + ' m</div></div>' +
    '<div class="prop-row"><div class="k">' + t("Antall") + '</div><div class="v">' + (antElem + antMat) + t(" stk") + '</div></div>' +
    vist.map(([key, g]) =>
      '<div class="qty-row"><div class="n">' + esc(key) +
      (g.type ? ' <span style="color:var(--muted);font-size:11px">(' + esc(typeVisning(g.type)) + ')</span>' : "") +
      '</div><div class="c">' + tallDeler([
        g.count + t(" stk"),
        g.len.toFixed(dec()) + ' m',
        fmtArea(g.area),
        fmtVol(g.vol)
      ]) + '</div></div>').join("") +
    (items.length > vist.length ? '<p style="color:var(--muted); font-size:11px; margin-top:6px">' + t("… og {0} til (summene øverst gjelder alle). Endre grensen i ⚙ Innstillinger → Visning.", items.length - vist.length) + '</p>' : "") +
    '<p style="color:var(--muted); font-size:11px; margin-top:8px">' + t("Shift-klikk legger til/fjerner. Shift + dra lager markeringsboks: mot høyre = kun synlige, mot venstre = alt i boksen. Vanlig klikk nullstiller.") + '</p>';
  if (antElem) $("paHideSel").onclick = () => hideElements(new Set(S.multiSel.keys()));   // virker nå også i 🪶
  apnePanel("propPanel");
}

// Markerer et helt sett elementer i én gjennomgang (raskt også for hundrevis)
function selectElementsSet(idSet) {
  clearSelectionVisual();   // ikke clearSelection() – den ville tømt S.multiSel vi nettopp fylte
  if (!idSet.size) return;
  if (S.lightLoaded) {
    S.modelGroup.children.forEach(m => {
      if (!m.userData.merged) return;
      const rs = (m.userData.ranges || []).filter(r => idSet.has(r.id));
      if (!rs.length) return;
      const p = m.geometry.getAttribute("position").array;
      const ix = m.geometry.getIndex().array;
      let n = 0;
      rs.forEach(r => n += r.count);
      const arr = new Float32Array(n * 3);
      let o = 0;
      rs.forEach(r => {
        for (let i = r.start; i < r.start + r.count; i++) {
          const vi = ix[i] * 3;
          arr[o] = p[vi]; arr[o+1] = p[vi+1]; arr[o+2] = p[vi+2];
          o += 3;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const hl = new THREE.Mesh(g, selMatLight);
      hl.renderOrder = 996;
      selGroup.add(hl);
    });
  } else {
    S.modelGroup.children.forEach(m => {
      if (idSet.has(m.userData.expressID)) {
        S.selectedMeshes.push({ mesh: m, mat: m.material });
        m.material = selMat;
      }
    });
  }
}

// ---------- 📦 Materiell i flervalget ----------
// Materiell-objektene er ikke IFC-elementer (egne id-er, egen gruppe), men
// skal kunne markeres på NØYAKTIG samme måte: shift-klikk legger til/fjerner,
// markeringsboksen fanger dem, vanlig klikk nullstiller. Utvalget bor i
// S.multiSelMat, og effekten males av materiell-vis.js — som også lastes på
// byggeplassen, så dette virker i begge moduser.

// Raycast mot materiellGroup — pick() over ser BARE modellen, med vilje
// (materiell.js sier det selv). Navnelappene (sprites) er ingen treff-flate.
function pickMateriell(clientX, clientY) {
  if (!materiellGroup.children.length) return null;
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(materiellGroup.children, true);
  for (const h of hits) {
    if (h.object.isSprite) continue;
    // treff bak snittplanet hopper vi over — samme regel som pick()
    if (renderer.clippingPlanes.length &&
        !renderer.clippingPlanes.every(p => p.distanceToPoint(h.point) >= -0.001)) continue;
    let o = h.object;
    while (o && !o.userData.materiellId) o = o.parent;
    if (o && o.userData.materiellId) return { id: o.userData.materiellId, distance: h.distance };
  }
  return null;
}

function toggleMateriellValg(id) {
  if (S.multiSelMat.has(id)) S.multiSelMat.delete(id);
  else S.multiSelMat.add(id);
  oppdaterMateriellValgEffekt();
}

// Felles shift-klikk-logikk (brukes både ved klikk og små drag)
function shiftClickAt(x, y) {
  const hit = pick(x, y);
  const mHit = pickMateriell(x, y);
  // Materiell nærmest kameraet? Da er det materiellet klikket gjelder — du
  // trykte på det du så, samme regel som for elementene.
  if (mHit && (!hit || mHit.distance < hit.distance)) {
    toggleMateriellValg(mHit.id);
    if (S.multiSel.size || S.multiSelMat.size) showMultiSummary();
    else $("propPanel").classList.remove("open");
    return;
  }
  if (!hit) return;
  const id = hitID(hit);
  if (id == null) return;
  if (!S.multiSel.size && S.currentPropID != null && S.currentPropID !== id)
    S.multiSel.set(S.currentPropID, elementQuantities(S.currentPropID));
  if (S.multiSel.has(id)) S.multiSel.delete(id);
  else S.multiSel.set(id, elementQuantities(id));
  selectElementsSet(new Set(S.multiSel.keys()));
  if (S.multiSel.size || S.multiSelMat.size) showMultiSummary();
  else $("propPanel").classList.remove("open");
}

export function zoomToElement(id) {
  const box = elementBoxById(id);
  if (!box) return;
  const c = box.getCenter(new THREE.Vector3());
  flyTil(c, box.getSize(new THREE.Vector3()).length());
  selectElement(id);
  showProperties(id);
}

på("btnSearch", "click", () => {
  if (!S.modelGroup) return;
  const panel = $("searchPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  apnePanel("searchPanel");
  if (!S.searchIndex) {
    $("searchBody").innerHTML = '<p style="color:var(--muted)">' + t("Bygger søkeindeks …") + '</p>';
    setTimeout(async () => { await sikreMeta(alleElementIder); buildSearchIndex(); renderSearchUI(); }, 30);
  } else renderSearchUI();
});

function renderSearchUI() {
  $("searchBody").innerHTML =
    '<input type="search" id="elSearch" placeholder="' + t("Navn, merke, profil eller ID …") + '" autocomplete="off">' +
    '<div id="searchList"></div>';
  const inp = $("elSearch");
  inp.value = S.lastQuery;
  inp.addEventListener("input", () => { S.lastQuery = inp.value; renderSearchResults(); });
  inp.focus();
  renderSearchResults();
}

// 🧱 Radene fra lagene ved siden av modellen (SW-elementene, materiellet).
// De bor ikke i S.modelGroup og kom derfor aldri med i søkeindeksen — søkte du
// «SW-05» fikk du null treff selv om elementet sto rett foran deg. Radene
// hentes ved hvert tegn og ikke bygges én gang, fordi de er få (titalls, ikke
// tusenvis) og fordi et element som nettopp ble generert skal være søkbart med
// en gang. Et nytt lag blir søkbart ved å melde inn evnen «sokRader».
function ekstraSokRader() {
  const ut = [];
  for (const l of ekstraLagSom("sokRader")) {
    for (const r of (l.sokRader() || [])) ut.push(Object.assign({ lag: l }, r));
  }
  return ut;
}

function renderSearchResults() {
  const el = $("searchList");
  const q = S.lastQuery.trim().toLowerCase();
  const ekstra = ekstraSokRader();
  if (q.length < 2) {
    el.innerHTML = '<p style="color:var(--muted); font-size:12px; margin-top:8px">' + t("Skriv minst 2 tegn – søker i navn, merke (Tag), profil og ExpressID. {0} elementer i indeksen.", S.searchIndex.length + ekstra.length) + '</p>';
    return;
  }
  const hits = S.searchIndex.filter(e => e.s.includes(q));
  // Lagene legges FØRST: søker du på et SW-nummer er det nesten alltid det du
  // er ute etter, og listen kappes ved 50.
  const eHits = ekstra.filter(e => (e.s || "").includes(q));
  if (!hits.length && !eHits.length) { el.innerHTML = '<p style="color:var(--muted); margin-top:8px">' + t("Ingen treff på «{0}».", esc(S.lastQuery)) + '</p>'; return; }
  const antall = hits.length + eHits.length;
  el.innerHTML =
    eHits.slice(0, 50).map((h, i) =>
      '<div class="lib-item" data-lag="' + i + '">' +
      '<div class="n">' + esc(h.navn) + '</div>' +
      '<div class="m">' + esc(h.under || "") + '</div></div>').join("") +
    hits.slice(0, Math.max(0, 50 - eHits.length)).map(h =>
    '<div class="lib-item" data-eid="' + h.id + '">' +
    '<div class="n">' + esc(h.name || h.objType || String(h.id)) + '</div>' +
    '<div class="m">' + esc([h.type, h.objType, h.tag && (t("Merk: ") + h.tag)].filter(Boolean).join(" · ")) + '</div></div>').join("") +
    (antall > 50 ? '<p style="color:var(--muted); font-size:11px; margin-top:6px">' + t("Viser 50 av {0} treff – skriv mer for å avgrense.", antall) + '</p>' : "");
  el.querySelectorAll(".lib-item[data-eid]").forEach(d =>
    d.addEventListener("click", () => zoomToElement(Number(d.dataset.eid))));
  el.querySelectorAll(".lib-item[data-lag]").forEach(d =>
    d.addEventListener("click", () => {
      const h = eHits[Number(d.dataset.lag)];
      if (h && h.lag.gaTil) h.lag.gaTil(h.id);
    }));
}

// ---------- Mengder ----------
på("btnQty", "click", async () => {
  if (!S.modelGroup) return;
  const panel = $("qtyPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.qtyCache) {
    // volumberegningen tar litt tid på store modeller – vis at det skjer noe
    loadingText.textContent = t("Regner ut mengder …");
    loadingEl.classList.add("open");
    await new Promise(r => setTimeout(r, 30));
    try { await sikreMeta(alleElementIder); S.qtyCache = computeQuantities(); }
    finally { loadingEl.classList.remove("open"); }
  }
  renderQuantities(S.qtyCache);
  apnePanel("qtyPanel");
});

// Samler mengder både gruppert (til panelet) og per element (til regneark).
// Volum regnes i samme gjennomgang som sammenligningen bruker, så det koster én
// runde gjennom geometrien uansett hvor mange elementer modellen har.
function computeQuantities() {
  // bounding box per element (funker i både full og lav kvalitet)
  const boxMap = new Map();
  if (S.lightLoaded) {
    lightElementBoxes(null, boxMap);
  } else {
    const tmp = new THREE.Box3();
    S.modelGroup.children.forEach(m => {
      const id = m.userData.expressID;
      tmp.setFromObject(m);
      const b = boxMap.get(id);
      if (b) b.union(tmp); else boxMap.set(id, tmp.clone());
    });
  }
  const toM = S.enhetSkala || 1;   // meter per modellenhet – én sannhet, satt i ifc.js
  const vq = quantitiesForSet(new Set(boxMap.keys()));
  const groups = new Map();
  const rows = [];
  const sizeV = new THREE.Vector3();
  for (const [id, box] of boxMap) {
    let name = "", objType = "", typeName = "", material = "";
    if (S.glbActive) {
      const p = S.glbProps ? S.glbProps.get(id) : null;
      if (p) { name = p[0] || ""; objType = p[1] || ""; typeName = (p[2] || "").replace(/^Ifc/, ""); material = p[3] || ""; }
    } else {
      const meta = metaFor(id);
      if (meta) { name = meta.name || ""; objType = meta.objectType || ""; typeName = meta.typeName || ""; material = meta.material || ""; }
    }
    // gruppenøkkel: ObjectType er oftest profilen (f.eks. CFSHS100x6), ellers navn uten løpenummer
    let key = objType || name.replace(/:\d+$/, "") || typeName || "Ukjent";
    box.getSize(sizeV);
    const q = vq.get(id) ||
      { dims: [0, 0, 0], vol: 0, area: 0, flateTopp: 0, flateUnder: 0, flateSide: 0, len: 0 };
    // Lengde = lengste avstand mellom to punkter på elementet (se
    // quantitiesForSet). Bounding-boksen brukes bare som reserve for elementer
    // uten geometri i denne visningen.
    const len = q.len || Math.max(sizeV.x, sizeV.y, sizeV.z) * toM;
    // Forskaling: sider + underside. Toppen er støpeflate.
    //
    // BARE BETONG. Stål forskales ikke, og «forskaling 145 m²» på en stålhall
    // var ikke bare unyttig — det så ut som en mengde noen kunne prise.
    // Regnes bare for materialgruppen Betong; alt annet får 0 og faller ut av
    // visningen av seg selv (tomme deler vises ikke).
    const erBetong = materialGruppe(material) === "Betong";
    const forskaling = erBetong ? q.flateSide + q.flateUnder : 0;
    // ---------------------------------------------------------------------
    // ER VOLUMET I DET HELE TATT MULIG?
    //
    // Volumet regnes som en fortegnssum over tetraedre. Den matematikken
    // forutsetter at meshen er LUKKET og konsekvent vridd. Er den ikke det —
    // dupliserte flater, vrengte normaler, geometri som overlapper seg selv —
    // gir summen et tall som ser helt normalt ut og er fullstendig galt.
    //
    // Målt på Geithus vaskehall: to CFSHS140x5-bjelker kom ut på 0,91 m³ mot
    // 0,02 m³ i virkeligheten. 46 ganger for mye. Det ene avviket dro totalen
    // fra 3,4 tonn (Revits fasit) til 10,7 tonn. To elementer av 67.
    //
    // SPERREN ER GEOMETRISK, IKKE EN TERSKEL: et legeme kan aldri ha større
    // volum enn sin egen omsluttende boks. Er volumet større, er meshen
    // beviselig ikke et gyldig lukket legeme, og tallet skal ikke brukes til
    // noe. Ingen materialkunnskap, ingen tuning, ingen falske positive.
    // De 2 % slark dekker at boksen er akse-justert og at flyttall runder.
    const boksVol = q.dims[0] * q.dims[1] * q.dims[2];
    const umuligVolum = boksVol > 0 && q.vol > boksVol * 1.02;
    // VEKT. Volum × tetthet for materialgruppen. Har elementet ikke volum
    // (flate uten tykkelse) eller et materiale vi ikke kjenner tettheten til,
    // blir vekten NULL — og det er en løgn i et tilbud. Derfor telles den ikke
    // som 0 kg, den telles som UKJENT, og summen sier hvor mange som mangler.
    // ---------------------------------------------------------------------
    // VEKT: NOMINELL PROFILVEKT FØRST, GEOMETRI SOM RESERVE.
    //
    // Målt mot Revit på to ekte bygg lå volum × tetthet systematisk skjevt, og
    // skjevheten fulgte profiltypen: hulprofiler +2 %, I-profiler −5 %, en
    // sveiset HSQ +14 %. Nominell kg/m × MÅLT lengde traff derimot innenfor
    // 0,5 % på hver eneste gruppe. Det er ikke flaks — nominell vekt er det
    // stålverket leverer og det du betaler for. Geometrien er en tilnærming av
    // profilen; tabellen ER profilen. Se js/profiler.js.
    //
    // Kjennes profilen ikke igjen (sveiste tverrsnitt, betong, alt annet),
    // brukes geometrien — og kilden merkes, så du vet hvilke tall som er
    // kontrollert mot en katalog og hvilke som må sjekkes for hånd.
    const tetthet = TETTHET[materialGruppe(material)] || 0;
    const kgGeo = (tetthet > 0 && q.vol > 1e-9 && !umuligVolum) ? q.vol * tetthet : 0;
    // Nominell vekt hentes fra navnet. Bare for stål: en betongsøyle som
    // tilfeldigvis heter noe med «L200x20» skal ikke få stålvekt.
    // Både ObjectType og Navn prøves: hos noen prosjekterende står profilen i
    // det ene feltet, hos andre i det andre.
    const prof = materialGruppe(material) === "Stål"
      ? (profilKgPerM(objType) || profilKgPerM(name)) : null;
    const kgNom = prof && len > 0 ? prof.kgPerM * len : 0;
    // Nominell vinner. Merk at den også redder et element med ØDELAGT mesh:
    // volumet er ubrukelig, men lengden og profilnavnet er det ikke.
    const kg = kgNom || kgGeo;
    const kjentVekt = kg > 0;
    const vektKilde = kgNom ? (prof.kilde === "tabell" ? "tabell" : "formel") : (kgGeo ? "geometri" : "");
    // Kontrollen: hvor mye spriker geometrien fra katalogen? Stort avvik betyr
    // at modellen ikke er det den utgir seg for.
    const avvik = (kgNom > 0 && kgGeo > 0) ? kgGeo / kgNom - 1 : null;
    // Gruppene skilles også på materiale: en betongsøyle og en stålsøyle med
    // samme mål skal ikke havne på samme rad i en vareordre.
    const gkey = key + (material ? " · " + material : "");
    if (!groups.has(gkey)) groups.set(gkey,
      { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0, utenVekt: 0,
        umulige: 0, nominelle: 0, type: typeName, material });
    const g = groups.get(gkey);
    g.count++;
    g.length += len;
    g.vol += q.vol;
    g.area += q.area;
    g.flate += q.storsteFlate || 0;
    g.forskaling += forskaling;
    g.kg += kg;
    g.kgGeo += kgGeo;
    if (!kjentVekt) g.utenVekt++;
    if (umuligVolum) g.umulige++;
    if (kgNom) g.nominelle++;
    rows.push({
      id, key: gkey, name, objType, type: typeName, material,
      L: q.dims[0], B: q.dims[1], H: q.dims[2], len, vol: q.vol, area: q.area,
      flate: q.storsteFlate || 0,
      forskaling, kg, kgGeo, kjentVekt, umuligVolum, vektKilde,
      profil: prof ? prof.profil : "", nomKgPerM: prof ? prof.kgPerM : 0, avvik
    });
  }
  // 📦 Materiell-objektene får egne rader — parametriske tall fra målene
  // brukeren satte, ikke gjettet fra geometri (js/materiell-vis.js).
  // 📦 / 🧱 Radene fra lagene ved siden av modellen. Materiellet sto her som
  // et navngitt kall; SW-elementene manglet helt, så et halvt bygg kunne være
  // generert uten å dukke opp i en eneste mengde. Nå spør vi etter evnen.
  for (const l of ekstraLagSom("mengder")) l.mengder(groups, rows);
  const sortedRows = rows.sort((a, b) => a.key.localeCompare(b.key, "no") || a.id - b.id);
  return {
    groups: [...groups.entries()].sort((a, b) => b[1].count - a[1].count),
    rows: sortedRows,
    types: typeListe(sortedRows),
    materialer: materialListe(sortedRows)
  };
}

// ---------- Objekttyper (til nedtrekket) ----------
// IFC-typenavnet er engelsk og står uten «Ifc» i dataene («Beam», «Footing»).
// Her får de norske navn – ukjente typer vises som de er.
const TYPE_NAVN = {
  Footing: "Fundamenter", Pile: "Peler", Column: "Søyler", Beam: "Bjelker",
  Member: "Staver", Plate: "Plater", Wall: "Vegger",
  WallStandardCase: "Vegger", CurtainWall: "Glassfasader",
  Slab: "Dekker", Roof: "Tak", Stair: "Trapper", StairFlight: "Trappeløp",
  Ramp: "Ramper", RampFlight: "Rampeløp", Railing: "Rekkverk",
  Covering: "Kledning", Door: "Dører", Window: "Vinduer",
  Reinforcing: "Armering", ReinforcingBar: "Armeringsjern",
  ReinforcingMesh: "Armeringsnett", Fastener: "Festemidler",
  MechanicalFastener: "Festemidler", DiscreteAccessory: "Tilbehør",
  Materiell: "Materiell (leveranser)",
  BuildingElementProxy: "Øvrige bygningsdeler", ElementAssembly: "Sammenstillinger",
  Pipe: "Rør", PipeSegment: "Rør", DuctSegment: "Kanaler",
  Furniture: "Inventar", Space: "Rom", Site: "Tomt"
};

export function typeVisning(typ) {
  if (!typ) return t("Uten IFC-type");
  return TYPE_NAVN[typ] ? t(TYPE_NAVN[typ]) : typ;
}

// Liste over objekttypene som faktisk finnes i modellen, flest først.
function typeListe(rows) {
  const m = new Map();
  rows.forEach(r => {
    const t = r.type || "";
    if (!m.has(t)) m.set(t, { count: 0, vol: 0, area: 0 });
    const e = m.get(t);
    e.count++; e.vol += r.vol; e.area += r.area;
  });
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
}

// ---------- Materiale ----------
// Materialnavnene i en IFC-modell er ikke standardiserte: «B35», «C35/45»,
// «Concrete - Cast-in-Place», «Betong». For å kunne ta ut ALLE betongsøyler i én
// fil, uansett hva prosjekterende har kalt betongen, kjennes navnet igjen på
// nøkkelord og havner i en grovgruppe. Enkeltmaterialene kan fortsatt velges.
const MAT_GRUPPER = [
  ["Betong", /betong|concrete|\bc\d{2}\/\d{2}\b|\bb\d{2}\b|elementbetong|lettbetong/i],
  ["Stål", /\bstål\b|\bstal\b|steel|\bs\d{3}\b|\bhup\b|\bheb?\b|\bipe\b|galvanis|jern(?!bane)/i],
  ["Armering", /armering|reinforc|\bkamstål\b|\bb500\b/i],
  ["Tre", /\btre\b|\btrevirke\b|timber|wood|limtre|kerto|\bc24\b|\bgl30\b|kryssfin/i],
  ["Mur", /mur|brick|tegl|blokk|leca|betongstein/i],
  ["Isolasjon", /isolasjon|insulat|mineralull|glava|rockwool|eps\b|xps\b/i],
  ["Aluminium", /aluminium|alu\b/i],
  ["Glass", /glass|glazing/i],
  ["Gips", /gips|plaster|gypsum/i]
];

export function materialGruppe(navn) {
  const s = String(navn || "").trim();
  if (!s) return "";
  for (const [gruppe, m] of MAT_GRUPPER) if (m.test(s)) return gruppe;
  return "Annet";
}

export function materialVisning(mat) {
  return mat ? mat : t("Uten materiale");
}

// Materialene som faktisk fins i modellen, med grovgruppe og antall.
function materialListe(rows) {
  const m = new Map();
  rows.forEach(r => {
    const mat = r.material || "";
    if (!m.has(mat)) m.set(mat, { count: 0, gruppe: materialGruppe(mat) });
    m.get(mat).count++;
  });
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
}

// Filtrerer en ferdig mengde-cache ned til én objekttype og/eller ett materiale.
// `mat` er "" (alle), "g:Betong" (hele grovgruppen) eller "m:B35" (nøyaktig
// materialnavn). Gruppene regnes på nytt fra radene, så «Antall» i arket
// stemmer med det som faktisk eksporteres.
export function qtyForType(cache, type, mat) {
  if (!type && !mat) return cache;
  const rows = cache.rows.filter(r => {
    if (type && (r.type || "") !== type) return false;
    if (!mat) return true;
    if (mat.slice(0, 2) === "g:") return materialGruppe(r.material) === mat.slice(2);
    if (mat.slice(0, 2) === "m:") return (r.material || "") === mat.slice(2);
    return true;
  });
  const groups = new Map();
  rows.forEach(r => {
    if (!groups.has(r.key)) groups.set(r.key,
      { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0, utenVekt: 0,
        umulige: 0, nominelle: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.vol += r.vol; g.area += r.area;
    g.flate += r.flate || 0;
    g.forskaling += r.forskaling || 0; g.kg += r.kg || 0; g.kgGeo += r.kgGeo || 0;
    if (!r.kjentVekt) g.utenVekt++;
    if (r.umuligVolum) g.umulige++;
    if (r.nomKgPerM) g.nominelle++;
  });
  return {
    groups: [...groups.entries()].sort((a, b) => b[1].count - a[1].count),
    rows, types: cache.types, materialer: cache.materialer
  };
}

// ---------- Eksport til regneark ----------
// Semikolon og desimalkomma, som norsk Excel forventer, og BOM foran så æøå
// blir riktig. Da åpner fila rett i Excel uten importveiviser.
const nb = (n, d) => (Number(n) || 0).toFixed(d === undefined ? 3 : d).replace(".", ",");

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  return rows.map(r => r.map(csvCell).join(";")).join("\r\n");
}

function download(name, text, mime) {
  const blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
  lastNed(name, blob);
}

// Blob → fil på disk. Samme trikset for CSV og .xlsx.
function lastNed(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 📊 EKTE EXCEL-FIL, ikke CSV (Emil 03.09).
// CSV-en var riktig på PC-en og feil i mailen: skrivebords-Excel leser «;»
// fordi Windows' listeskilletegn er «;» i norsk oppsett, men Excel på nett og
// forhåndsvisningen i Outlook bruker alltid «,» — og da havnet hele raden i
// kolonne A. En .xlsx har ingen skilletegn, så den åpnes likt overalt; i
// tillegg overlever SUM-formlene og «mulig tap av data»-advarselen forsvinner.
// Modulen lastes DYNAMISK, så den ligger ikke i lettmodus-skallet.
export async function lastNedXlsx(filnavn, arknavn, rader) {
  const X = await import("./xlsx.js");
  lastNed(filnavn, new Blob([X.lagXlsx(arknavn, rader)], { type: X.XLSX_MIME }));
}
// Flere ark i én fil: [{ navn, rader }, …]
export async function lastNedXlsxFlere(filnavn, arkListe) {
  const X = await import("./xlsx.js");
  lastNed(filnavn, new Blob([X.lagXlsxFlere(arkListe)], { type: X.XLSX_MIME }));
}

function baseName() {
  return (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
}

// Regnearket skal aldri være mindre presist enn skjermen, men heller ikke miste
// presisjon om noen setter visningen til 0 desimaler.
const csvLenDec = () => Math.max(dec(), 3);
const csvVolDec = () => Math.max(dec(), 4);

const csvAreaDec = () => Math.max(dec(), 3);
// Vekt: minst to desimaler i regnearket. Der skal du kunne kontrollere mot
// leverandørens tabell uten at avrunding kommer i veien.
const csvVektDec = () => Math.max(dec(), 2);

// ---------- SUM-formler i regnearkene ----------
// Emil 03.09: summen skal STÅ SOM =SUM(...) i arket, ikke som et ferdig tall.
// Da ser man hvilke rader summen kommer fra, og den følger med hvis noen
// sletter eller filtrerer en rad etterpå. Et statisk tall lyver stille.
//
// Selve regningen bor i js/regneark.js — den er uten avhengigheter, så
// js/xlsx.js kan bruke de SAMME funksjonene uten å dra inn resten av
// elements.js. Re-eksporteres her fordi det er her radene lages.
export { kolBokstav, sumFormel } from "./regneark.js";

export function qtyGroupRows(cache) {
  // «Kg/m» står med vilje rett ved siden av kg. Den er en KONTROLL, ikke et
  // salgstall: ser du 61 kg/m på en HEB200, er modellen bygget med ekte
  // profiler og vekten kan brukes. Ser du 300, er profilen modellert som en
  // kasse, og hele kolonnen til venstre er søppel. Det er den eneste måten å se
  // forskjell på uten å åpne modellen i noe annet.
  // Arealkolonnen er STØRSTE FLATE (vegglivet på en vegg, oversida på et
  // dekke). Fotavtrykket står som egen kolonne HELT TIL SLUTT – på et dekke er
  // de to like, på en vegg står de langt fra hverandre, og den som bestiller
  // isolasjon skal slippe å gjette hvilken av dem han ser på.
  const out = [[t("Gruppe"), t("IFC-type"), t("Materiale"), t("Antall"),
    t("Sum lengde (m)"), t("Sum areal største flate (m2)"), t("Sum volum (m3)"),
    t("Forskaling (m2)"), t("Vekt (kg)"), t("Kg/m"), t("Kilde"), t("Geometri (kg)"), t("Avvik %"),
    t("Uten vekt (stk)"), t("Umulig volum (stk)"), t("Sum fotavtrykk (m2)")]];
  const forste = out.length + 1;        // første datarad, som radnummer i arket
  cache.groups.forEach(([key, g]) => out.push([key, g.type || "", g.material || "", g.count,
    nb(g.length, csvLenDec()), nb(g.flate || 0, csvAreaDec()), nb(g.vol, csvVolDec()),
    nb(g.forskaling, csvAreaDec()), nb(g.kg, csvVektDec()),
    g.length > 0 ? nb(g.kg / g.length, csvVektDec()) : "",
    // Er hele gruppa regnet fra katalog, står det «nominell». Er den blandet,
    // står det hvor mange — en halvveis kontrollert gruppe skal ikke se
    // kontrollert ut.
    g.nominelle === 0 ? t("geometri") : g.nominelle === g.count ? t("nominell") : g.nominelle + "/" + g.count,
    g.kgGeo > 0 ? nb(g.kgGeo, csvVektDec()) : "",
    (g.nominelle && g.kgGeo > 0 && g.kg > 0) ? nb((g.kgGeo / g.kg - 1) * 100, 1) : "",
    g.utenVekt || "", g.umulige || "", nb(g.area, csvAreaDec())]));
  const tot = cache.groups.reduce((s, [, g]) =>
    [s[0] + g.count, s[1] + g.length, s[2] + g.vol, s[3] + g.area, s[4] + g.forskaling, s[5] + g.kg,
     s[6] + (g.utenVekt || 0), s[7] + (g.umulige || 0), s[8] + (g.kgGeo || 0)],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const siste = out.length;            // siste datarad
  const S_ = (kol) => sumFormel(kol, forste, siste);
  out.push([]);
  // Tallene står i `tot` fortsatt — de brukes til å avgjøre om cellen skal
  // være TOM. En 0 i «uten vekt» ser ut som en kontrollert kolonne.
  out.push([t("SUM"), "", "", S_(3), S_(4), S_(5),
    S_(6), S_(7), S_(8), "", "",
    tot[8] > 0 ? S_(11) : "", "", tot[6] ? S_(13) : "", tot[7] ? S_(14) : "", S_(15)]);
  return out;
}

export function qtyElementRows(cache) {
  const out = [["ElementID", t("Gruppe"), t("Navn"), "ObjectType", t("IFC-type"), t("Materiale"),
    t("Lengde (m)"), t("Bredde (m)"), t("Høyde (m)"), t("Lengste mål (m)"),
    t("Areal største flate (m2)"), t("Volum (m3)"),
    t("Forskaling (m2)"), t("Vekt (kg)"), t("Kilde"), t("Profil"), t("Nominell kg/m"), t("Umulig volum"),
    t("Fotavtrykk (m2)")]];
  cache.rows.forEach(r => out.push([r.id, r.key, r.name, r.objType, r.type, r.material || "",
    nb(r.L, csvLenDec()), nb(r.B, csvLenDec()), nb(r.H, csvLenDec()),
    nb(r.len, csvLenDec()), nb(r.flate || 0, csvAreaDec()), nb(r.vol, csvVolDec()),
    nb(r.forskaling || 0, csvAreaDec()),
    // Tom celle, ikke 0, når vekten ikke er kjent. En 0 i et tilbudsark blir
    // summert som om elementet veier ingenting.
    r.kjentVekt ? nb(r.kg, csvVektDec()) : "",
    r.vektKilde ? t(r.vektKilde) : "", r.profil || "",
    r.nomKgPerM ? nb(r.nomKgPerM, csvVektDec()) : "",
    r.umuligVolum ? t("JA") : "", nb(r.area, csvAreaDec())]));
  // Sumrad også her (Emil 03.09), som formler. Bare kolonnene det er MENING i
  // å summere: lengste mål, areal, volum, forskaling og vekt. Lengde/bredde/
  // høyde er mål på hvert element — en sum av dem betyr ingenting.
  if (cache.rows.length) {
    // INGEN tom rad her: hele elementarket skal ha like mange kolonner på
    // hver rad (den invarianten er testet, og Excel liker den).
    const S_ = (kol) => sumFormel(kol, 2, cache.rows.length + 1);
    out.push([t("SUM"), "", "", "", "", "", "", "", "",
      S_(9), S_(10), S_(11), S_(12), S_(13), "", "", "", "", S_(18)]);
  }
  return out;
}

// Tallkolonnen i Mengder. Hver verdi pakkes for seg, slik at linja kan brytes
// MELLOM verdier men aldri inne i én: «216,88» og «m» skal ikke havne på hver
// sin linje. Tomme deler faller ut, så en gruppe uten vekt — eller en stålgruppe
// uten forskaling — ikke får et hengende skilletegn.
//
// Tidligere sto hele strengen med white-space: nowrap. Da vekt og forskaling
// kom til, ble den for lang til å krympe, og flex presset navnekolonnen ned til
// én bokstav per linje.
function tallDeler(deler) {
  return deler.filter(Boolean).map(d => '<span class="d">' + d + '</span>').join(' · ');
}

// Vekt i KILO, med det antallet desimaler som står i ⚙ Innstillinger.
//
// FØRSTE FORSØK RUNDET AV TIL TONN over 1000 kg, med den begrunnelsen at
// «184,4 t» er lettere å kjenne igjen som feil enn «184 350 kg». Det var feil
// prioritering: den som skal PRISE et bygg må kunne regne etter og få nøyaktig
// samme tall som verktøyet. «10,7 t» kan ikke kontrolleres mot noe.
// Desimalinnstillingen styrer alt annet i Mengder, og skal styre denne også.
//
// Tusenskille med hardt mellomrom, som norsk standard: «3 418,7 kg» er like
// lesbart som tonn, og fortsatt et tall du kan sjekke.
export function fmtVekt(kg) {
  const n = Number(kg) || 0;
  const s = n.toFixed(dec()).replace(".", ",");
  // Bare heltallsdelen får tusenskille — ikke desimalene.
  const del = s.split(",");
  return del[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") +
    (del[1] ? "," + del[1] : "") + " kg";
}

export function fmtArea(a) {
  const d = Math.max(dec(), a > 0 && a < 0.01 ? 3 : 0);
  return a.toFixed(d) + " m²";
}

function renderQuantities(full) {
  // S.qtyType er valgt objekttype ("" = alle). Alt under – tabell, sum og
  // eksport – gjelder det som er valgt, slik at CSV-fila blir «ett ark».
  const valgt = S.qtyType || "";
  if (!(full.types || []).some(([t]) => t === valgt)) S.qtyType = "";
  // materialvalget kan være g:<gruppe> eller m:<nøyaktig navn>
  const mv = S.qtyMat || "";
  const matFinnes = !mv ||
    (mv.slice(0, 2) === "g:" && (full.materialer || []).some(([m]) => materialGruppe(m) === mv.slice(2))) ||
    (mv.slice(0, 2) === "m:" && (full.materialer || []).some(([m]) => m === mv.slice(2)));
  if (!matFinnes) S.qtyMat = "";
  const cache = (S.qtyType || S.qtyMat) ? qtyForType(full, S.qtyType, S.qtyMat) : full;
  const matNavnValgt = S.qtyMat ? S.qtyMat.slice(2) || t("Uten materiale") : "";
  const filnavnDel = (S.qtyType ? " - " + typeVisning(S.qtyType) : "") +
    (matNavnValgt ? " - " + matNavnValgt : "");

  const list = cache.groups;
  const total = list.reduce((s, [, g]) => s + g.count, 0);
  const totVol = list.reduce((s, [, g]) => s + g.vol, 0);
  const totLen = list.reduce((s, [, g]) => s + g.length, 0);
  // Arealet i panelet er STØRSTE FLATE – samme tall som i egenskapspanelet og
  // i arealkolonnen i regnearket. Fotavtrykket står bare i regnearket, som egen
  // kolonne; å vise begge her hadde gjort tallrekka uleselig på mobil.
  const totArea = list.reduce((s, [, g]) => s + (g.flate || 0), 0);
  const totKg = list.reduce((s, [, g]) => s + (g.kg || 0), 0);
  const totForsk = list.reduce((s, [, g]) => s + (g.forskaling || 0), 0);
  const totUtenVekt = list.reduce((s, [, g]) => s + (g.utenVekt || 0), 0);
  const totUmulige = list.reduce((s, [, g]) => s + (g.umulige || 0), 0);
  const totUmuligVol = cache.rows.reduce((s, r) => s + (r.umuligVolum ? r.vol : 0), 0);

  // Nedtrekkene teller innenfor det ANDRE valget: har du valgt Søyler, viser
  // materiallista hvor mange søyler som er betong – ikke hvor mange elementer i
  // hele modellen som er betong. Ellers kan du velge en kombinasjon som gir 0.
  const forType = S.qtyMat ? qtyForType(full, "", S.qtyMat).rows : full.rows;
  const forMat = S.qtyType ? qtyForType(full, S.qtyType, "").rows : full.rows;
  const tell = (rader, passer) => rader.reduce((s, r) => s + (passer(r) ? 1 : 0), 0);

  const typeValg = (full.types || []).map(([t]) => [t, tell(forType, r => (r.type || "") === t)])
    .filter(([, n]) => n > 0);

  // materialer: grovgrupper først, deretter de nøyaktige navnene
  // NB: tell én gang PER GRUPPE. Å summere per materialnavn ville tellet hver
  // rad på nytt for hvert navn i gruppen (tre betongnavn ⇒ tre ganger for høyt).
  const grupper = new Set();
  (full.materialer || []).forEach(([m]) => { const g = materialGruppe(m); if (g) grupper.add(g); });
  const gruppeValg = [...grupper]
    .map(g => [g, tell(forMat, r => materialGruppe(r.material) === g)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const matValg = (full.materialer || []).map(([m]) => [m, tell(forMat, r => (r.material || "") === m)])
    .filter(([, n]) => n > 0);
  const harMateriale = (full.materialer || []).some(([m]) => m);

  const nedtrekk =
    '<div class="qty-filtre">' +
    '<label class="qty-type-velg">' + t("Objekttype") +
    '<select id="qtyType">' +
      '<option value=""' + (S.qtyType ? "" : " selected") + '>' + t("Alle typer ({0} stk)", forType.length) + '</option>' +
      typeValg.map(([typ, n]) =>
        '<option value="' + esc(typ) + '"' + (typ === S.qtyType ? " selected" : "") + '>' +
        esc(typeVisning(typ)) + ' (' + n + t(" stk") + ')</option>').join("") +
    '</select></label>' +
    (harMateriale
      ? '<label class="qty-type-velg">' + t("Materiale") +
        '<select id="qtyMat">' +
          '<option value=""' + (S.qtyMat ? "" : " selected") + '>' + t("Alle materialer ({0} stk)", forMat.length) + '</option>' +
          (gruppeValg.length
            ? '<optgroup label="' + t("Materialgrupper") + '">' + gruppeValg.map(([g, n]) =>
                '<option value="g:' + esc(g) + '"' + ("g:" + g === S.qtyMat ? " selected" : "") + '>' +
                esc(t(g)) + ' (' + n + t(" stk") + ')</option>').join("") + '</optgroup>'
            : "") +
          '<optgroup label="' + t("Enkeltmaterialer") + '">' + matValg.map(([m, n]) =>
            '<option value="m:' + esc(m) + '"' + ("m:" + m === S.qtyMat ? " selected" : "") + '>' +
            esc(materialVisning(m)) + ' (' + n + t(" stk") + ')</option>').join("") + '</optgroup>' +
        '</select></label>'
      : "") +
    '</div>';

  $("qtyBody").innerHTML =
    nedtrekk +
    '<div class="prop-actions">' +
      '<button id="qtyCsvG" class="primary" title="' + t("Én rad per gruppe, bare valgt objekttype") + '">' + ikon("lastned") + ' ' + t("Grupper (Excel)") + '</button>' +
      '<button id="qtyCsvE" title="' + t("Én rad per element – for mengdeberegning og vareordre") + '">' + ikon("lastned") + ' ' + t("Alle elementer") + '</button>' +
      '<button id="qtyCopy" title="' + t("Lim rett inn i et åpent regneark") + '">' + ikon("kopier") + ' ' + t("Kopier") + '</button>' +
    '</div>' +
    '<div class="qty-row" style="font-weight:600"><div class="n">' +
      esc([S.qtyType ? typeVisning(S.qtyType) : "", matNavnValgt].filter(Boolean).join(" · ") || t("Totalt")) +
      '</div><div class="c">' + tallDeler([
        total + t(" stk"),
        totLen.toFixed(dec()) + ' m',
        fmtArea(totArea),
        fmtVol(totVol),
        totKg > 0 ? fmtVekt(totKg) : "",
        totForsk > 0 ? t("forskaling") + ' ' + fmtArea(totForsk) : ""
      ]) + '</div></div>' +
    // Står det elementer uten vekt i utvalget, SKAL det stå her og ikke bare i
    // regnearket. Summen over er da ikke hele sannheten, og en kalkyle bygget
    // på den blir for lav.
    // Umulig volum går FØRST og i rødt. Det er ikke «litt usikkert» — det er
    // et tall som beviselig er galt, og som drar hele summen med seg.
    (totUmulige
      ? '<div class="qty-row" style="color:var(--danger)"><div class="n">' +
        t("{0} element med umulig volum", totUmulige) + '</div><div class="c">' +
        t("større enn sin egen boks – geometrien er ødelagt. Volumet ({0}) og vekten kan ikke brukes.",
          fmtVol(totUmuligVol)) + '</div></div>'
      : "") +
    (totUtenVekt
      ? '<div class="qty-row" style="color:var(--warn)"><div class="n">' +
        t("{0} element uten vekt", totUtenVekt) + '</div><div class="c">' +
        t("mangler volum eller materiale – ikke med i kg-summen") + '</div></div>'
      : "") +
    list.map(([key, g]) =>
      '<div class="qty-row"><div class="n">' + esc(key) +
      (g.type ? ' <span style="color:var(--muted);font-size:11px">(' + esc(typeVisning(g.type)) + ')</span>' : "") +
      (g.umulige ? ' <span style="color:var(--danger);font-size:11px" title="' +
        esc(t("Volumet er større enn elementets egen boks. Geometrien er ødelagt – tallet kan ikke brukes.")) +
        '">⚠ ' + t("{0} med umulig volum", g.umulige) + '</span>' : "") + '</div>' +
      '<div class="c">' + tallDeler([
        g.count + t(" stk"),
        g.length.toFixed(dec()) + ' m',
        fmtArea(g.flate || 0),
        fmtVol(g.vol),
        // Vekten og kontrolltallet hører sammen og skal aldri skilles av et
        // linjeskift — derfor én del, ikke to.
        g.kg > 0
          ? fmtVekt(g.kg) + (g.length > 0
              ? ' <span style="color:var(--muted);font-size:11px">(' +
                (g.kg / g.length).toFixed(Math.max(dec(), 1)).replace(".", ",") + ' kg/m' +
                // Er vekten hentet fra katalog, sier vi det — og hvor mye
                // geometrien spriker. Over 10 % er modellen ikke profilen den
                // heter, og da skal tallet ses på.
                (g.nominelle === g.count && g.kgGeo > 0
                  ? ' nom · ' + (() => {
                      const a = (g.kgGeo / g.kg - 1) * 100;
                      const t2 = (a > 0 ? "+" : "") + a.toFixed(0) + " %";
                      return Math.abs(a) > 10
                        ? '<span style="color:var(--danger)">geo ' + t2 + '</span>' : 'geo ' + t2;
                    })()
                  : g.nominelle ? ' · ' + g.nominelle + '/' + g.count + ' nom'
                  : ' geo')
                + ')</span>'
              : "")
          : ""
      ]) + '</div></div>').join("") +
    '<p style="color:var(--muted); font-size:11px; margin-top:10px">' +
    t("Antall desimaler settes i Innstillinger. Velg objekttype og materiale for å få ett ark om gangen – nedlastingen inneholder bare det som står i lista nå (f.eks. Søyler + Betong gir bare betongsøylene). Materialgruppene samler navn som betyr det samme: «B35», «C35/45» og «Concrete» havner alle under Betong. Mangler materiale på et element, står det ikke i IFC-fila. Lengde = lengste mål per element (ca-verdi, summert per gruppe). Areal = største sammenhengende flate på elementet – vegglivet på en vegg, oversida på et dekke. Det er målet isolasjon, kledning og forskaling bestilles etter, og en døråpning i veggen er trukket fra. Fotavtrykket (grunnflaten sett rett ovenfra) står som egen kolonne sist i regnearket; på et dekke er de to like. Volum er regnet ut av geometrien og gjelder lukkede volumer – hule profiler blir riktige, flater uten tykkelse blir 0.") + '</p>';

  const sel = $("qtyType");
  if (sel) sel.onchange = () => { S.qtyType = sel.value; renderQuantities(full); };
  const selM = $("qtyMat");
  if (selM) selM.onchange = () => { S.qtyMat = selM.value; renderQuantities(full); };

  const arkFeil = (err) => {
    console.warn("Regnearket kunne ikke lages:", err);
    alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
  };
  $("qtyCsvG").onclick = () => lastNedXlsx(baseName() + filnavnDel + " - mengder.xlsx",
    t("Mengder"), qtyGroupRows(cache)).catch(arkFeil);
  $("qtyCsvE").onclick = () => lastNedXlsx(baseName() + filnavnDel + " - mengder per element.xlsx",
    t("Mengder per element"), qtyElementRows(cache)).catch(arkFeil);
  $("qtyCopy").onclick = async () => {
    // tabulator lar deg lime rett inn i celler i et åpent ark
    const tsv = qtyGroupRows(cache).map(r => r.join("\t")).join("\r\n");
    try {
      await navigator.clipboard.writeText(tsv);
      $("qtyCopy").textContent = t("Kopiert");
      setTimeout(() => { if ($("qtyCopy")) $("qtyCopy").innerHTML = ikon("kopier") + " " + t("Kopier"); }, 1500);
    } catch(_) { alert(t("Klarte ikke å kopiere. Bruk Grupper (CSV) i stedet.")); }
  };
}

// Tegner tall på nytt når desimalvalget endres i ⚙ Innstillinger.
// Mål-lapper som alt er plassert i 3D beholder teksten de fikk – nye lapper
// følger den nye innstillingen.
export function refreshNumbers() {
  if ($("qtyPanel").classList.contains("open") && S.qtyCache) renderQuantities(S.qtyCache);
  if ($("propPanel").classList.contains("open")) {
    if (S.multiSel.size || (S.multiSelMat && S.multiSelMat.size)) showMultiSummary();
    else if (S.currentPropID != null) showProperties(S.currentPropID);
  }
}

// ---------- Markeringsboks (shift + dra) ----------
// Mot høyre (blå): kun elementer som er synlige i boksen. Mot venstre (grønn): alt innenfor, også skjult bak.

const boxSelEl = document.createElement("div");

boxSelEl.style.cssText = "position:fixed; border:1.5px dashed #8ab4ff; background:rgba(59,130,246,.12); display:none; z-index:20; pointer-events:none";

document.body.appendChild(boxSelEl);

// Farge per element bakes inn som vertex-farge (expressID → RGB) for GPU-basert synlighetstest
function ensureIdColors() {
  let added = false;
  S.modelGroup.children.forEach(m => {
    if (!m.isMesh || m.geometry.getAttribute("color")) return;
    added = true;
    const count = m.geometry.getAttribute("position").count;
    const arr = new Uint8Array(count * 3);
    const write = (vi, id) => { arr[vi] = (id >> 16) & 255; arr[vi+1] = (id >> 8) & 255; arr[vi+2] = id & 255; };
    if (m.userData.merged) {
      const ix = m.geometry.getIndex().array;
      for (const r of (m.userData.ranges || []))
        for (let i = r.start; i < r.start + r.count; i++) write(ix[i] * 3, r.id);
    } else {
      const id = m.userData.expressID || 0;
      for (let i = 0; i < count; i++) write(i * 3, id);
    }
    m.geometry.setAttribute("color", new THREE.BufferAttribute(arr, 3, true));
  });
  return added;
}

// Tegner scenen med ID-farger og leser av pikslene i boksen → elementer som faktisk er synlige der
function idsVisibleInRect(x0, y0, x1, y1) {
  const freshAttrs = ensureIdColors();
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const scale = Math.min(1, 1400 / Math.max(w, h));
  const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale));
  if (!S._idMat) S._idMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });

  // Sju tilstander byttes ut under her, blant annet materialet på ALLE mesh.
  // Kaster readRenderTargetPixels (kontekst tapt, driverfeil), ville modellen
  // før blitt stående i flate ID-farger på svart bakgrunn – permanent, uten
  // feilmelding. Derfor leses alt FØR try, og settes tilbake i finally.
  // materiellGroup er med: den tegnes i sine egne farger, og pikslene ville
  // blitt dekodet som tilfeldige IFC-id-er i avlesningen under.
  const overlays = [markerGroup, measureGroup, koteGroup, axesGroup, selGroup, materiellGroup, omradeGroup];
  const vis = overlays.map(g => g.visible);
  const gridVis = grid.visible;
  const bg = scene.background;
  const prevCS = renderer.outputColorSpace;
  const swaps = [];
  let rt = null;
  const ids = new Set();

  try {
    rt = new THREE.WebGLRenderTarget(rw, rh);
    overlays.forEach(g => g.visible = false);
    grid.visible = false;
    scene.background = new THREE.Color(0x000000);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    S.modelGroup.children.forEach(m => { if (m.isMesh) { swaps.push([m, m.material]); m.material = S._idMat; } });
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    // aller første render etter at fargeattributter er lagt til blir svart (VAO-oppdatering) – render en gang til
    if (freshAttrs) renderer.render(scene, camera);
    const sx = Math.max(0, Math.round(Math.min(x0, x1) * scale));
    const sy = Math.max(0, Math.round((h - Math.max(y0, y1)) * scale));
    const sw = Math.max(1, Math.min(rw - sx, Math.round(Math.abs(x1 - x0) * scale)));
    const sh = Math.max(1, Math.min(rh - sy, Math.round(Math.abs(y1 - y0) * scale)));
    const buf = new Uint8Array(sw * sh * 4);
    renderer.readRenderTargetPixels(rt, sx, sy, sw, sh, buf);
    for (let i = 0; i < buf.length; i += 4) {
      const id = (buf[i] << 16) | (buf[i+1] << 8) | buf[i+2];
      if (id) ids.add(id);
    }
  } catch (err) {
    // Tomt utvalg er riktig svar her – bedre enn å velge feil elementer.
    console.warn("Markeringsboksen kunne ikke leses av:", err);
  } finally {
    renderer.setRenderTarget(null);
    swaps.forEach(([m, mat]) => m.material = mat);
    overlays.forEach((g, i) => g.visible = vis[i]);
    grid.visible = gridVis;
    scene.background = bg;
    renderer.outputColorSpace = prevCS;
    if (rt) rt.dispose();
  }
  return ids;
}

// Geometrisk test: alle elementer hvis projiserte boks berører markeringen (også skjult bak andre)
// Alle elementer som ikke er synlige NÅ. Dekker både «Skjul element» (hiddenIDs)
// og hele typer skjult fra 🎨 Utseende – de siste ligger bare som m.visible=false
// på meshene, ikke i hiddenIDs, og slapp derfor gjennom markeringsboksen før.
// Bygges én gang per markering: å spørre per element ville blitt O(n²).
export function skjulteIder() {
  const skjult = new Set(hiddenIDs);
  typeSkjultLett.forEach(id => skjult.add(id));
  if (!S.modelGroup || S.lightLoaded) return skjult;  // sammenslått geometri: hiddenIDs + typeSkjultLett gjelder
  const synlige = new Set();
  S.modelGroup.children.forEach(m => {
    const id = m.userData.expressID;
    if (id === undefined) return;
    if (m.visible) synlige.add(id); else skjult.add(id);
  });
  // et element med flere deler regnes som synlig så lenge én del vises
  for (const id of synlige) if (!hiddenIDs.has(id)) skjult.delete(id);
  return skjult;
}

function idsAllInRect(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const v = new THREE.Vector3();
  const planes = renderer.clippingPlanes;
  const skjult = skjulteIder();
  camera.updateMatrixWorld(true);
  const ids = new Set();
  for (const [id, box] of allElementBoxes()) {
    if (skjult.has(id)) continue;
    box.getCenter(v);
    if (v.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue; // bak kameraet
    if (planes.length) {
      let ok = true;
      for (const p of planes) if (p.distanceToPoint(v) < 0 && !box.intersectsPlane(p)) { ok = false; break; }
      if (!ok) continue; // utenfor aktivt snitt/etasjefilter
    }
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (let ci = 0; ci < 8; ci++) {
      v.set(ci & 1 ? box.max.x : box.min.x, ci & 2 ? box.max.y : box.min.y, ci & 4 ? box.max.z : box.min.z);
      v.project(camera);
      const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight;
      if (px < sMinX) sMinX = px; if (px > sMaxX) sMaxX = px;
      if (py < sMinY) sMinY = py; if (py > sMaxY) sMaxY = py;
    }
    if (sMaxX >= minX && sMinX <= maxX && sMaxY >= minY && sMinY <= maxY) ids.add(id);
  }
  return ids;
}

// 📦 Materiell i markeringsboksen: geometrisk test av objektets projiserte
// boks, samme prinsipp som idsAllInRect. GPU-passet (synlige) kjenner bare
// IFC-id-er, så materiell testes geometrisk uansett hvilken vei boksen dras —
// materiell ligger åpent oppå bakke og dekker, så «skjult bak noe» er ikke et
// praktisk skille der. Skjulte objekter finnes ikke i materiellGroup
// (tegnMateriell hopper over dem), så de kan aldri fanges.
const _mBox = new THREE.Box3(), _mTmp = new THREE.Box3();

function materiellIRect(x0, y0, x1, y1) {
  const ut = new Set();
  if (!materiellGroup.children.length) return ut;
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const v = new THREE.Vector3();
  const planes = renderer.clippingPlanes;
  camera.updateMatrixWorld(true);
  for (const o of materiellGroup.children) {
    if (!o.userData.materiellId) continue;
    // boksen UTEN navnelappen — spriten er skjermskalert og ville blåst den
    // opp langt utenfor selve stabelen
    o.updateWorldMatrix(true, true);
    _mBox.makeEmpty();
    o.traverse(m => {
      if (!m.isMesh || m.isSprite || !m.geometry) return;
      _mTmp.setFromObject(m);
      _mBox.union(_mTmp);
    });
    if (_mBox.isEmpty()) continue;
    _mBox.getCenter(v);
    if (v.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue; // bak kameraet
    if (planes.length) {
      let ok = true;
      for (const p of planes) if (p.distanceToPoint(v) < 0 && !_mBox.intersectsPlane(p)) { ok = false; break; }
      if (!ok) continue; // utenfor aktivt snitt/etasjefilter
    }
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (let ci = 0; ci < 8; ci++) {
      v.set(ci & 1 ? _mBox.max.x : _mBox.min.x, ci & 2 ? _mBox.max.y : _mBox.min.y, ci & 4 ? _mBox.max.z : _mBox.min.z);
      v.project(camera);
      const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight;
      if (px < sMinX) sMinX = px; if (px > sMaxX) sMaxX = px;
      if (py < sMinY) sMinY = py; if (py > sMaxY) sMaxY = py;
    }
    if (sMaxX >= minX && sMinX <= maxX && sMaxY >= minY && sMinY <= maxY) ut.add(o.userData.materiellId);
  }
  return ut;
}

function finishBoxSelect(b) {
  const visibleOnly = b.x1 >= b.x0; // venstre→høyre = kun synlige
  const ids = visibleOnly ? idsVisibleInRect(b.x0, b.y0, b.x1, b.y1) : idsAllInRect(b.x0, b.y0, b.x1, b.y1);
  // siste skanse: skjulte elementer skal aldri kunne markeres, uansett hvilken vei boksen dras
  const skjult = skjulteIder();
  for (const id of skjult) ids.delete(id);
  const matIds = materiellIRect(b.x0, b.y0, b.x1, b.y1);
  if (!ids.size && !matIds.size) return;
  if (ids.size) {
    const q = quantitiesForSet(ids);
    for (const id of ids) S.multiSel.set(id, q.get(id) || { dims: [0, 0, 0], vol: 0 });
    selectElementsSet(new Set(S.multiSel.keys()));
  }
  if (matIds.size) {
    for (const id of matIds) S.multiSelMat.add(id);
    oppdaterMateriellValgEffekt();
  }
  showMultiSummary();
}

canvas.addEventListener("pointerdown", (e) => {
  if (!e.shiftKey || e.button !== 0 || !S.modelGroup) return;
  e.preventDefault();
  S.boxSel = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!S.boxSel) return;
  S.boxSel.x1 = e.clientX; S.boxSel.y1 = e.clientY;
  boxSelEl.style.display = "block";
  boxSelEl.style.left = Math.min(S.boxSel.x0, S.boxSel.x1) + "px";
  boxSelEl.style.top = Math.min(S.boxSel.y0, S.boxSel.y1) + "px";
  boxSelEl.style.width = Math.abs(S.boxSel.x1 - S.boxSel.x0) + "px";
  boxSelEl.style.height = Math.abs(S.boxSel.y1 - S.boxSel.y0) + "px";
  const crossing = S.boxSel.x1 < S.boxSel.x0;
  boxSelEl.style.borderColor = crossing ? "#3cb44b" : "#8ab4ff";
  boxSelEl.style.background = crossing ? "rgba(60,180,75,.12)" : "rgba(59,130,246,.12)";
});

canvas.addEventListener("pointerup", (e) => {
  if (!S.boxSel) return;
  boxSelEl.style.display = "none";
  const b = S.boxSel; S.boxSel = null;
  if (Math.abs(b.x1 - b.x0) < 8 && Math.abs(b.y1 - b.y0) < 8) shiftClickAt(e.clientX, e.clientY);
  else finishBoxSelect(b);
});
