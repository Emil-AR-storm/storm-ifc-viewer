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

// ─── 🎨 Drapering av fargeområder (Emil 19.10: «hjørnene er ikke fylt ut riktig») ───
//
// Første utgave la fargen over kanten av en haug/grop som et rutenett, og
// tok med de rutene som hadde midten inni formen — da ble kanten en trapp,
// og hjørnene ble hakkete. Nå lages fargen EKSAKT: flata under (plata,
// bunnene og kantflatene) deles i trekanter, fargeformen deles i trekanter,
// og hver fargetrekant klippes mot hver flatetrekant (Sutherland–Hodgman).
// Hvert klippet stykke løftes opp i planet til flatetrekanten det ligger i.
// Alt i byggrammen (meter, x/z), y = høyde over plata.

// Trekantene (3D) i flata under plata-gruppa, fra plateDeler
export function flateTrekanter(pad, deler) {
  const ut = [];
  const tri2 = (ytre, hull, y) => {
    const kontur = ytre.map(q => new THREE.Vector2(q.x, q.z));
    const hv = (hull || []).map(h => h.map(q => new THREE.Vector2(q.x, q.z)));
    const alle = kontur.concat(...hv);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(kontur, hv))
      ut.push([[alle[a].x, y, alle[a].y], [alle[b].x, y, alle[b].y], [alle[c].x, y, alle[c].y]]);
  };
  tri2(padPolygon(pad), deler.hull, 0);
  for (const d of deler.deler) {
    if (d.topp) tri2(d.topp.ytre, d.topp.hull, d.topp.y);
    for (const [a, b, c, e] of d.sider) { ut.push([a, b, c]); ut.push([a, c, e]); }
    if (d.felt) {
      const P = d.felt.pos, I = d.felt.idx, pk = (k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
      for (let k = 0; k < I.length; k += 3) ut.push([pk(I[k]), pk(I[k + 1]), pk(I[k + 2])]);
    }
  }
  return ut;
}

// Klipp et konvekst eller konkavt polygon (punkter {x, z}) mot en trekant (konveks)
function klippMotTrekant(poly, t) {
  // trekanten mot klokka i (x, z), så «inni» er venstre side av hver kant
  let [A, B, C] = t;
  const kr = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
  if (Math.abs(kr) < 1e-12) return [];                 // loddrett vegg: ingen flate ovenfra
  if (kr < 0) [B, C] = [C, B];
  let ut = poly;
  for (const [P, Q] of [[A, B], [B, C], [C, A]]) {
    if (!ut.length) break;
    const inne = (p) => (Q[0] - P[0]) * (p.z - P[2]) - (Q[2] - P[2]) * (p.x - P[0]) >= -1e-12;
    const kutt = (p, q) => {
      const dx = q.x - p.x, dz = q.z - p.z;
      const den = (Q[0] - P[0]) * dz - (Q[2] - P[2]) * dx;
      const tt = den === 0 ? 0 : -((Q[0] - P[0]) * (p.z - P[2]) - (Q[2] - P[2]) * (p.x - P[0])) / den;
      return { x: p.x + dx * tt, z: p.z + dz * tt };
    };
    const inn = ut; ut = [];
    for (let i = 0; i < inn.length; i++) {
      const p = inn[i], q = inn[(i + 1) % inn.length], pi = inne(p), qi = inne(q);
      if (pi) ut.push(p);
      if (pi !== qi) ut.push(kutt(p, q));
    }
  }
  return ut;
}
// Høyden i punktet (x, z) i planet gjennom trekanten
function hoydeITrekant(t, x, z) {
  const [A, B, C] = t;
  const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
  const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d;
  const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d;
  return l1 * A[1] + l2 * B[1] + (1 - l1 - l2) * C[1];
}

// Fargeformen draperet over flata: trekanter som Float32Array (byggrammen, meter)
export function draperFarge(punkter, flate) {
  const kontur = punkter.map(q => new THREE.Vector2(q.x, q.z));
  const ft = THREE.ShapeUtils.triangulateShape(kontur, []).map(([a, b, c]) => [punkter[a], punkter[b], punkter[c]]);
  const ut = [];
  for (const tri of ft) {
    const x0 = Math.min(tri[0].x, tri[1].x, tri[2].x), x1 = Math.max(tri[0].x, tri[1].x, tri[2].x);
    const z0 = Math.min(tri[0].z, tri[1].z, tri[2].z), z1 = Math.max(tri[0].z, tri[1].z, tri[2].z);
    for (const t of flate) {
      if (Math.max(t[0][0], t[1][0], t[2][0]) < x0 || Math.min(t[0][0], t[1][0], t[2][0]) > x1 ||
          Math.max(t[0][2], t[1][2], t[2][2]) < z0 || Math.min(t[0][2], t[1][2], t[2][2]) > z1) continue;
      const bit = klippMotTrekant(tri, t);
      if (bit.length < 3) continue;
      const v = bit.map(p => [p.x, hoydeITrekant(t, p.x, p.z), p.z]);
      for (let k = 1; k < v.length - 1; k++) ut.push(...v[0], ...v[k], ...v[k + 1]);
    }
  }
  return new Float32Array(ut);
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
  let flate = null;                       // flatetrekantene lages bare når de trengs
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
      // over kanten av en grop/haug: eksakt drapering (se draperFarge)
      if (!flate) flate = flateTrekanter(pad, deler);
      const pos = draperFarge(f.punkter, flate).map((v, k) => (k % 3 === 1 ? v + 0.01 : v) / s);
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
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
