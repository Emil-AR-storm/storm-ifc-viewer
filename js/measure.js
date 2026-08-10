// 📏 Mål og ⛰ kote, med kant-snapping.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { S, fmtLen, tilM } from "./state.js";
import { pick } from "./elements.js";
import { camera, canvas, frameHooks, koteGroup, makeLabel, measureGroup, renderer, scene, updateScreenScaled } from "./scene.js";

// ---------- Kote ----------
export function koteValue(point) {
  if (S.koteMatrixInv) {
    const p = point.clone().applyMatrix4(S.koteMatrixInv);
    return p.y;
  }
  return point.y;
}

// ---------- Mål ----------

// Forhåndsvisning i mål-modus: gjennomsiktig prikk som følger pekeren.
// Diameteren = snap-radiusen (følger slideren), og prikken hopper til hjørnet + blir mer solid når snappen tar tak.
const snapCursorGroup = new THREE.Group();

scene.add(snapCursorGroup);

const snapCursor = new THREE.Mesh(new THREE.SphereGeometry(1),
  new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.3, depthTest: false }));

snapCursor.renderOrder = 998;

snapCursor.visible = false;

snapCursorGroup.add(snapCursor);

// Gul markering av kanten prikken har låst seg til
const snapEdgeLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false, transparent: true, opacity: 0.95 }));

snapEdgeLine.renderOrder = 999;

snapEdgeLine.visible = false;

snapCursorGroup.add(snapEdgeLine);

// Kryss som vises når snappen har tatt tak i SENTER. Kant og senter må kunne
// skilles fra hverandre uten å bytte farge – fargen betyr noe annet i denne
// viewer-en (gul = mål, cyan = kote), så formen bærer forskjellen.
const snapCenterCross = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1)
  ]),
  new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false, transparent: true, opacity: 0.95 }));

snapCenterCross.renderOrder = 999;

snapCenterCross.visible = false;

snapCenterCross.userData.px = 26;   // konstant skjermstørrelse

snapCursorGroup.add(snapCenterCross);

export function hideSnapPreview() {
  snapCursor.visible = false;
  snapEdgeLine.visible = false;
  snapCenterCross.visible = false;
}

canvas.addEventListener("pointermove", (e) => {
  if (S.mode !== "measure" || e.buttons !== 0 || S.boxSel || !S.modelGroup) {
    hideSnapPreview();
    return;
  }
  const now = performance.now();
  if (now - S._snapPrevT < 60) return; // ikke raycast oftere enn ~16 g/s (store modeller)
  S._snapPrevT = now;
  const hit = pick(e.clientX, e.clientY);
  if (!hit) { hideSnapPreview(); return; }
  const sr = snapPoint(hit);
  const traff = !!sr.type;
  // Uten treff er prikken like stor som fangstsonen, så man ser hvor nær man må
  // være. Med treff krymper den til et presist punkt.
  snapCursor.material.opacity = traff ? 0.85 : 0.3;
  snapCursor.userData.px = traff ? 11 : (S.snapOn ? Math.max(10, S.snapPx * 2) : 12);
  snapCursor.position.copy(sr.point);
  snapCursor.visible = true;
  if (sr.type === "kant" && sr.edge) {
    snapEdgeLine.geometry.dispose();
    snapEdgeLine.geometry = new THREE.BufferGeometry().setFromPoints(sr.edge);
    snapEdgeLine.visible = true;
  } else snapEdgeLine.visible = false;
  snapCenterCross.visible = sr.type === "senter";
  if (sr.type === "senter") snapCenterCross.position.copy(sr.point);
});

canvas.addEventListener("pointerleave", hideSnapPreview);

// ---------- Snapping: bare HJØRNE, SENTER og KANT ----------
//
// HVA SOM VAR GALT FØR: snappen festet seg til nærmeste punkt på en hvilken som
// helst TREKANTKANT i elementet. En flat vegg er triangulert i to trekanter, og
// diagonalen tvers over veggen er en trekantkant uten å være en kant på
// objektet. Snappen hang seg opp i den, og i alle andre indre delelinjer.
//
// NÅ bygges en liste over EKTE kanter. En kant regnes som ekte hvis den enten
// bare hører til én trekant (ytterkant), eller hvis de to trekantene som deler
// den knekker mer enn 20° på hverandre. Koplanare diagonaler faller bort.
//
// Kandidatene er, i prioritert rekkefølge – samme rangering som i CAD:
//   1. HJØRNE – endepunkt på en ekte kant
//   2. SENTER – elementets midtpunkt (midtpunktet i en bjelke)
//   3. KANT   – nærmeste punkt langs en ekte kant
// Ingenting annet fanger. Treffer du ingen av dem, brukes punktet du pekte på.
//
// AVSTANDEN MÅLES I PIKSLER, ikke i modellenheter. Det er nettopp derfor senter
// virker: midtpunktet i en bjelke ligger inne i stålet, langt fra flaten du
// traff, men rett under pekeren på skjermen. Den gamle koden regnet piksler om
// til verdensenheter ved treffpunktets dybde, og da ville senter aldri nås.
// hit.point ligger på strålen gjennom pekeren, så projeksjonen av hit.point ER
// pekerens skjermposisjon – vi trenger ikke få musekoordinatene inn hit.
//
// Kantlista er dyr å bygge (to gjennomløp av trekantene), så den mellomlagres
// per element. Man holder pekeren over ett element om gangen, så en liten cache
// holder. Nøkkelen inneholder objektets uuid, så en ny modell aldri treffer
// gamle rader.

const SNAP_KNEKK = Math.cos(20 * Math.PI / 180); // to flater må knekke mer enn dette for at kanten skal telle
const MAKS_INDEKSER = 90000;                     // samme ytelsestak som før
const CACHE_MAKS = 12;

const snapCache = new Map();

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const _n = new THREE.Vector3(), _ab = new THREE.Vector3(), _ac = new THREE.Vector3();

const _p = new THREE.Vector3(), _proj = new THREE.Vector3(), _størrelse = new THREE.Vector3();

const _seg = new THREE.Line3(), _sp = new THREE.Vector3();

const _peker = { x: 0, y: 0 }, _px = { x: 0, y: 0 };

function utenSnap(hit) { return { point: hit.point, edge: null, type: null }; }

// Hvilke trekanter hører til elementet man traff?
// Sammenslått geometri holder mange elementer i én buffer, og da forteller
// obj.userData.ranges hvor det ene elementet begynner og slutter.
function finnRange(obj, hit) {
  if (!obj.userData.merged || !obj.geometry.getIndex()) return null;
  const fi = hit.faceIndex * 3;
  for (const r of obj.userData.ranges) if (fi >= r.start && fi < r.start + r.count) return r;
  return undefined;   // sammenslått, men fant ikke elementet – da snapper vi ikke
}

function leggTilKant(kart, p1, p2, n, nøkkelAv) {
  const k1 = nøkkelAv(p1), k2 = nøkkelAv(p2);
  if (k1 === k2) return;                       // null-lang kant
  const nøkkel = k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1;
  const e = kart.get(nøkkel);
  if (!e) { kart.set(nøkkel, { a: p1.clone(), b: p2.clone(), n: n.clone(), flat: false }); return; }
  // Kanten deles av to trekanter. Ligger de i samme plan, er dette en
  // trianguleringsdiagonal og ikke en kant på objektet.
  if (e.n.dot(n) >= SNAP_KNEKK) e.flat = true;
}

function byggElementData(obj, range) {
  const geo = obj.geometry;
  const posA = geo.getAttribute("position");
  const ix = geo.getIndex();
  const verden = !obj.userData.merged;   // sammenslått geometri er allerede i verdenskoordinater
  const indeksert = !!ix;

  let start = 0, slutt;
  if (range) { start = range.start; slutt = range.start + range.count; }
  else if (ix) { slutt = ix.count; }
  else { slutt = posA.count; }

  if (slutt - start <= 0 || slutt - start > MAKS_INDEKSER) return { kanter: null, senter: null };
  const idx = indeksert ? (i) => ix.getX(i) : (i) => i;

  // Gjennomløp 1: omsluttende boks. Sentrum av den er elementets midtpunkt, og
  // størrelsen gir oss hvor grovt vi kan runde av koordinater i gjennomløp 2.
  const boks = new THREE.Box3();
  for (let i = start; i < slutt; i++) {
    _p.fromBufferAttribute(posA, idx(i));
    if (verden) _p.applyMatrix4(obj.matrixWorld);
    boks.expandByPoint(_p);
  }
  if (boks.isEmpty()) return { kanter: null, senter: null };
  const senter = boks.getCenter(new THREE.Vector3());

  // To trekanter som deler en kant har sjelden nøyaktig samme flyttall i
  // hjørnene. Vi runder av til en milliondel av elementets diagonal, ellers
  // finner vi aldri at kanten er delt – og da regnes hver diagonal som ekte.
  const eps = Math.max(1e-9, boks.getSize(_størrelse).length() * 1e-6);
  const nøkkelAv = (v) =>
    Math.round(v.x / eps) + "," + Math.round(v.y / eps) + "," + Math.round(v.z / eps);

  // Gjennomløp 2: bygg kantkartet
  const kart = new Map();
  for (let i = start; i + 2 < slutt; i += 3) {
    _a.fromBufferAttribute(posA, idx(i));
    _b.fromBufferAttribute(posA, idx(i + 1));
    _c.fromBufferAttribute(posA, idx(i + 2));
    if (verden) {
      _a.applyMatrix4(obj.matrixWorld);
      _b.applyMatrix4(obj.matrixWorld);
      _c.applyMatrix4(obj.matrixWorld);
    }
    _ab.subVectors(_b, _a); _ac.subVectors(_c, _a);
    _n.crossVectors(_ab, _ac);
    if (_n.lengthSq() === 0) continue;   // degenerert trekant har ingen normal
    _n.normalize();
    leggTilKant(kart, _a, _b, _n, nøkkelAv);
    leggTilKant(kart, _b, _c, _n, nøkkelAv);
    leggTilKant(kart, _c, _a, _n, nøkkelAv);
  }

  const ut = [];
  for (const e of kart.values())
    if (!e.flat) ut.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
  return { kanter: new Float32Array(ut), senter };
}

function hentElementData(obj, range) {
  const nøkkel = obj.uuid + (range ? ":" + range.start : "");
  let d = snapCache.get(nøkkel);
  if (d) return d;
  d = byggElementData(obj, range);
  snapCache.set(nøkkel, d);
  if (snapCache.size > CACHE_MAKS) snapCache.delete(snapCache.keys().next().value);
  return d;
}

export function snapPoint(hit) {
  if (!S.snapOn) return utenSnap(hit);
  try {
    const obj = hit.object;
    if (!obj.geometry || !obj.geometry.getAttribute("position")) return utenSnap(hit);

    const range = finnRange(obj, hit);
    if (range === undefined) return utenSnap(hit);

    const d = hentElementData(obj, range);
    if (!d.kanter || !d.kanter.length) return utenSnap(hit);

    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const tilPiksler = (p, ut) => {
      _proj.copy(p).project(camera);
      ut.x = (_proj.x * 0.5 + 0.5) * w;
      ut.y = (-_proj.y * 0.5 + 0.5) * h;
      return ut;
    };
    tilPiksler(hit.point, _peker);
    const pikselAvstand = (p) => {
      tilPiksler(p, _px);
      return Math.hypot(_px.x - _peker.x, _px.y - _peker.y);
    };

    const tol = S.snapPx;
    let hjørne = null, hjørneD = tol;
    let kantP = null, kantD = tol, kantSeg = null;

    const k = d.kanter;
    for (let i = 0; i < k.length; i += 6) {
      _a.set(k[i], k[i + 1], k[i + 2]);
      _b.set(k[i + 3], k[i + 4], k[i + 5]);

      const da = pikselAvstand(_a);
      if (da < hjørneD) { hjørneD = da; hjørne = _a.clone(); }
      const db = pikselAvstand(_b);
      if (db < hjørneD) { hjørneD = db; hjørne = _b.clone(); }

      // Nærmeste punkt LANGS kanten finnes i 3D mot flaten man faktisk traff.
      // Gjøres det i skjermplanet, fanger kanter på baksiden av elementet.
      _seg.start.copy(_a); _seg.end.copy(_b);
      _seg.closestPointToPoint(hit.point, true, _sp);
      const dp = pikselAvstand(_sp);
      if (dp < kantD) { kantD = dp; kantP = _sp.clone(); kantSeg = [_a.clone(), _b.clone()]; }
    }

    if (hjørne) return { point: hjørne, edge: null, type: "hjørne" };
    if (d.senter && pikselAvstand(d.senter) < tol)
      return { point: d.senter.clone(), edge: null, type: "senter" };
    if (kantP) return { point: kantP, edge: kantSeg, type: "kant" };
    return utenSnap(hit);
  } catch (_) { return utenSnap(hit); }
}

// «Rett strek»: låser andrepunktet så målet går langs nærmeste akse
// (X, Y = høyde, eller Z). Slås av og på i målelinja, som Snap.
export function rettPunkt(fra, til) {
  const d = [Math.abs(til.x - fra.x), Math.abs(til.y - fra.y), Math.abs(til.z - fra.z)];
  const størst = d.indexOf(Math.max(d[0], d[1], d[2]));
  const p = til.clone();
  if (størst === 0) { p.y = fra.y; p.z = fra.z; }
  else if (størst === 1) { p.x = fra.x; p.z = fra.z; }
  else { p.x = fra.x; p.y = fra.y; }
  return p;
}

export function addMeasure(p1, p2) {
  const d = p1.distanceTo(p2);
  const nye = [];   // de fire objektene dette målet består av – til ↩ Angre
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false }));
  line.renderOrder = 997;
  measureGroup.add(line); nye.push(line);
  const mkDot = (p) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false }));
    dot.renderOrder = 997;
    dot.position.copy(p);
    dot.userData.px = 8; // konstant skjermstørrelse
    measureGroup.add(dot); nye.push(dot);
  };
  mkDot(p1); mkDot(p2);
  // d er avstand i MODELLENS enheter. fmtLen forventer meter – uten tilM()
  // står et mål på 2,5 m som «2500.00 m» i en mm-modell.
  const label = makeLabel(fmtLen(tilM(d)));
  label.userData.px = 30; // konstant skjermstørrelse
  label.userData.aspect = label.scale.x / label.scale.y;
  label.userData.meter = tilM(d);   // så lappen kan tegnes om ved enhetsbytte
  label.position.copy(p1).add(p2).multiplyScalar(0.5);
  measureGroup.add(label); nye.push(label);
  // Group.remove() disposer ikke, så objektene kan legges rett inn igjen.
  if (S.pushAngre) S.pushAngre({
    tekst: "Mål",
    angre: () => nye.forEach(o => measureGroup.remove(o)),
    gjenopprett: () => nye.forEach(o => measureGroup.add(o))
  });
  return nye;
}

// ---------- Tegn lappene om når enheten endres ----------
//
// Teksten på en lapp er brent inn i en tekstur. Bytter du visningsenhet eller
// modellenhet i ⚙ Innstillinger, ville gamle mål og koter stått igjen med den
// forrige teksten – og innstillingen sett ødelagt ut.
//
// Lappen BYTTES IKKE UT, bare teksturen inni. Angre-postene holder på selve
// objektet, så byttet vi det, ville angring av et gammelt mål plutselig ikke
// funnet noe å fjerne.
function tegnOm(sprite, tekst, farge) {
  const ny = makeLabel(tekst, farge);
  const gammelKart = sprite.material.map;
  sprite.material.map = ny.material.map;
  sprite.material.needsUpdate = true;
  sprite.userData.aspect = ny.scale.x / ny.scale.y;   // teksten kan ha ny bredde
  if (gammelKart) gammelKart.dispose();
  ny.material.dispose();
}

export function oppdaterLengdeEtiketter() {
  for (const [gruppe, farge, prefiks] of
       [[measureGroup, "#f59e0b", ""], [koteGroup, "#22d3ee", "▲ "]]) {
    gruppe.children.forEach(o => {
      // Bare lappene bærer et tall. Streker og prikker hoppes over.
      if (!o.isSprite || typeof (o.userData && o.userData.meter) !== "number") return;
      tegnOm(o, prefiks + fmtLen(o.userData.meter), farge);
    });
  }
}

// hold måle-/kotelapper og snap-prikk i konstant skjermstørrelse
frameHooks.push(() => {
  updateScreenScaled(measureGroup);
  updateScreenScaled(koteGroup);
  updateScreenScaled(snapCursorGroup);
});

