// ⛰ Plata under bygget i 3D — med heve/senke-områdene (Emil 15.10.2026).
//
// HVORFOR EGEN FIL: både kontoret (terreng.js) og byggeplass-siden
// (terreng-vis.js) skal tegne plata likt. Tallene (hull, bunner, kanter)
// regnes i terreng-regn.js (plateDeler) og testes der; her blir de bare til
// three-geometri.
//
// Gruppa står med plata i y = 0 og i byggrammen delt på skala (meter →
// modellens enhet). Kalleren setter gruppas høyde til gulvhøyden.
//   · plata: flat, med HULL der de ytterste områdene ligger
//   · hvert område: bunn (med hull for områdene inni) + én firkant per kant
//     fra omrisset til bunnen (loddrett vegg eller skrå kant)
//   · for smale groper med skrå kant: et lite høydefelt
import * as THREE from "three";
import { erEgenPad, padPolygon, plateDeler, fargeFlate, fargeStatus, fargeVerdi } from "./terreng-regn.js";

// Formen i xy-planet med y = −z; rotateX(−90°) legger den riktig vei.
function form(pts, s) {
  const f = new THREE.Shape();
  pts.forEach((q, i) => (i ? f.lineTo(q.x / s, -q.z / s) : f.moveTo(q.x / s, -q.z / s)));
  f.closePath();
  return f;
}
function hullForm(pts, s) {
  const h = new THREE.Path();
  pts.forEach((q, i) => (i ? h.lineTo(q.x / s, -q.z / s) : h.moveTo(q.x / s, -q.z / s)));
  h.closePath();
  return h;
}

export function byggPlate3D(pad, s, farge) {
  const g = new THREE.Group();
  g.name = "terrengplate";
  if (!pad || !pad.paa) return g;
  const mat = new THREE.MeshLambertMaterial({
    color: farge, side: THREE.DoubleSide,
    // Gulvet i modellen ligger i samme høyde som plata — modellen skal vinne
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  // Kantene i gropene får en litt mørkere tone, så formen synes uten skygger
  const kantMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(farge).multiplyScalar(0.82), side: THREE.DoubleSide });
  const deler = plateDeler(pad);

  const plateForm = form(padPolygon(pad), s);
  for (const h of deler.hull) plateForm.holes.push(hullForm(h, s));
  const plateGeo = new THREE.ShapeGeometry(plateForm);
  plateGeo.rotateX(-Math.PI / 2);
  const plate = new THREE.Mesh(plateGeo, mat);
  plate.name = "terrengplate-flate";
  plate.userData.egetMat = true;
  g.add(plate);

  for (const d of deler.deler) {
    if (d.topp) {
      const f = form(d.topp.ytre, s);
      for (const h of d.topp.hull) f.holes.push(hullForm(h, s));
      const geo = new THREE.ShapeGeometry(f);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, d.topp.y / s, 0);
      const m = new THREE.Mesh(geo, mat);
      m.userData.egetMat = true;
      g.add(m);
    }
    if (d.sider.length) {
      const pos = new Float32Array(d.sider.length * 18);
      let o = 0;
      for (const [a, b, c, e] of d.sider) for (const q of [a, b, c, a, c, e]) { pos[o++] = q[0] / s; pos[o++] = q[1] / s; pos[o++] = q[2] / s; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, kantMat);
      m.userData.egetMat = true;
      g.add(m);
    }
    if (d.felt) {
      const pos = Float32Array.from(d.felt.pos, (v) => v / s);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(d.felt.idx, 1));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, kantMat);
      m.userData.egetMat = true;
      g.add(m);
    }
  }
  // 🎨 Fargeområdene (runde 4): ligger oppå det som er under, løftet 1 cm og
  // med polygonOffset, så de vinner over plata uten å flimre. Det siste i
  // lista ligger øverst (større forskyvning).
  const F = Array.isArray(pad.farger) ? pad.farger : [];
  const fst = F.length ? fargeStatus(pad, F) : [];
  F.forEach((f, i) => {
    if (!fst[i].gyldig) return;
    const lag = 2 + Math.min(i, 40);
    const fm = new THREE.MeshLambertMaterial({ color: fargeVerdi(f), side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -lag, polygonOffsetUnits: -lag });
    const d = fargeFlate(pad, f);
    let geo;
    if (d.flat) {
      geo = new THREE.ShapeGeometry(form(d.flat.ytre, s));
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, (d.flat.y + 0.01) / s, 0);
    } else {
      const pos = Float32Array.from(d.felt.pos, (v, k) => (k % 3 === 1 ? v + 0.01 : v) / s);
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(d.felt.idx, 1));
      geo.computeVertexNormals();
    }
    const m = new THREE.Mesh(geo, fm);
    m.name = "terrengfarge";
    m.renderOrder = 1 + i;
    m.userData.egetMat = true;
    g.add(m);
  });
  g.userData.egen = erEgenPad(pad);
  return g;
}

// Rydder gruppa (geometri og materialer — de lages på nytt hver gang)
export function ryddPlate3D(g) {
  if (!g) return;
  const mats = new Set();
  g.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) mats.add(c.material); });
  mats.forEach(m => m.dispose());
}
