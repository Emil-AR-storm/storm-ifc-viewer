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

export function hideSnapPreview() { snapCursor.visible = false; snapEdgeLine.visible = false; }

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
  snapCursor.material.opacity = sr.edge ? 0.75 : 0.3;
  snapCursor.userData.px = S.snapOn ? Math.max(10, S.snapPx * 2) : 12; // diameter ≈ snap-radius
  snapCursor.position.copy(sr.point);
  snapCursor.visible = true;
  if (sr.edge) {
    snapEdgeLine.geometry.dispose();
    snapEdgeLine.geometry = new THREE.BufferGeometry().setFromPoints(sr.edge);
    snapEdgeLine.visible = true;
  } else snapEdgeLine.visible = false;
});

canvas.addEventListener("pointerleave", hideSnapPreview);

// Fest målepunktet til nærmeste KANT i elementet man traff (følsomhet = snapPx piksler).
// Kantenes endepunkter fanger også, så hjørner treffes naturlig. Returnerer { point, edge }.
const _e0 = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();

const _seg = new THREE.Line3(), _sp = new THREE.Vector3();

export function snapPoint(hit) {
  if (!S.snapOn) return { point: hit.point, edge: null };
  try {
    const obj = hit.object;
    const posA = obj.geometry.getAttribute("position");
    if (!posA) return { point: hit.point, edge: null };
    const dist = camera.position.distanceTo(hit.point);
    const tol = dist * 2 * Math.tan(camera.fov * Math.PI / 360) / renderer.domElement.clientHeight * S.snapPx;
    let best = null, bestD = tol, bestEdge = null;
    const world = !obj.userData.merged; // sammenslått geometri er allerede i verdenskoordinater
    const tryEdge = (a, b) => {
      _seg.start.copy(a); _seg.end.copy(b);
      _seg.closestPointToPoint(hit.point, true, _sp);
      const d = _sp.distanceTo(hit.point);
      if (d < bestD) { bestD = d; best = _sp.clone(); bestEdge = [a.clone(), b.clone()]; }
    };
    const tri = (i0, i1, i2) => {
      _e0.fromBufferAttribute(posA, i0); _e1.fromBufferAttribute(posA, i1); _e2.fromBufferAttribute(posA, i2);
      if (world) { _e0.applyMatrix4(obj.matrixWorld); _e1.applyMatrix4(obj.matrixWorld); _e2.applyMatrix4(obj.matrixWorld); }
      tryEdge(_e0, _e1); tryEdge(_e1, _e2); tryEdge(_e2, _e0);
    };
    const ix = obj.geometry.getIndex();
    if (obj.userData.merged && ix) {
      // let kun i trekantene til elementet man traff
      const fi = hit.faceIndex * 3;
      let range = null;
      for (const r of obj.userData.ranges) if (fi >= r.start && fi < r.start + r.count) { range = r; break; }
      if (range && range.count <= 90000)
        for (let i = range.start; i < range.start + range.count; i += 3) tri(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
    } else if (ix && ix.count <= 90000) {
      for (let i = 0; i < ix.count; i += 3) tri(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
    } else if (!ix && posA.count <= 90000) {
      for (let i = 0; i < posA.count; i += 3) tri(i, i + 1, i + 2);
    }
    return { point: best || hit.point, edge: bestEdge };
  } catch(_) { return { point: hit.point, edge: null }; }
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

