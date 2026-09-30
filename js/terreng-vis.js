// ⛰ Terrenget på BYGGEPLASS-SIDEN — bare visning.
//
// Emil 30.09.2026: «Skal topografi komme opp i storm byggeplass?» — ja, med
// kartet og hele utsnittet (prøvebilde A av tre). Kontoret sender et krympet
// grid (2 m ruter, hele centimeter) i markeringer.json og kartet som JPEG i
// bildemappa. Se «TERRENGET PÅ BYGGEPLASS-SIDEN» i terreng-regn.js.
//
// DENNE FILA LASTES BARE AV lett-main.js. Kontoret har hele verktøyet i
// terreng.js, og der skal ingenting endres av at denne finnes. Her er det
// ingen håndtak, ingen beskjæring, ingen flytting og ingen masser — montøren
// SER terrenget, han endrer det ikke (samme regel som riggen og materiellet).
//
// Innstillinger → «Vis terreng» slår det av på en treg telefon. Valget huskes.
import * as THREE from "three";
import { S, registrerEkstraGruppe } from "./state.js";
import { LETT } from "./lett.js";
import { camera, frameHooks, grid, renderer, scene } from "./scene.js";
import {
  gridTilTrekanter, hoydeFarger, hoydeSpenn, hoydeVed, kartUv, mTilScene, padFlagg,
  terrengFraByggeplass, terrengTilBygg
} from "./terreng-regn.js";

const FARGE_PLATE = 0x8f9194;   // samme grå plate som på kontoret (terreng.js)

export const terrengGroup = new THREE.Group();
terrengGroup.name = "terreng";
scene.add(terrengGroup);
const landGroup = new THREE.Group();
const innhold = new THREE.Group();
const byggGroup = new THREE.Group();
landGroup.add(innhold);
terrengGroup.add(landGroup, byggGroup);

let ter = null;        // terrenget fra Workeren (terrengFraByggeplass), eller null
let kartTex = null;
let kartFor = "";      // hvilket kart som er lastet (navnet), så det ikke hentes to ganger
let trengerFar = 0;

function paa() { return !!ter && S.settings.terrengBygg !== false; }

// Samme regler som kontoret (terreng.js modellRef/yFraMoh), og samme som
// riggen (rigg-vis.js riggBase): senteret i plan og GULVET = modellens laveste
// punkt. Så står terrenget, plata og riggen der de sto på kontoret.
function modellRef() {
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  return { c, skala: S.enhetSkala || 1, gulvY: Number.isFinite(boks.min.y) ? boks.min.y : 0 };
}
function yFraMoh(moh, mr) {
  const g = ter && ter.gulv ? ter.gulv.kote : moh;
  return mr.gulvY + (moh - g) / mr.skala;
}

function rydd() {
  for (const g of [innhold, byggGroup]) {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }
  trengerFar = 0;
}

function tegn() {
  rydd();
  terrengGroup.visible = paa();
  // Rutenettet under modellen er borte når terrenget ligger der — ellers
  // skinner det gjennom bakken.
  grid.visible = !paa();
  if (!paa() || !S.modelGroup) return;
  const mr = modellRef();
  const g = ter.grid;
  const p = ter.pad;
  const flat = (p && p.paa && ter.gulv)
    ? { flagg: padFlagg(g, ter.E0, ter.N0, ter.plass, p), hoyde: ter.gulv.kote - 0.05 }
    : null;
  const tr = gridTilTrekanter(g, ter.E0, ter.N0, ter.h0, mr.skala, flat);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(tr.pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(kartUv(g), 2));
  geo.setIndex(new THREE.BufferAttribute(tr.idx, 1));
  geo.computeVertexNormals();
  // Uten kart: høydefarger. Med kart: hvitt under kartet (kartet gir fargen).
  geo.setAttribute("color", new THREE.BufferAttribute(
    kartTex ? new Float32Array(g.w * g.h * 3).fill(1) : hoydeFarger(g, hoydeSpenn(g)), 3));
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide, map: kartTex || null,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const flate = new THREE.Mesh(geo, mat);
  flate.name = "terrengflate";
  flate.userData.terreng = true;
  innhold.add(flate);

  landGroup.position.set(mr.c.x, yFraMoh(ter.h0, mr), mr.c.z);
  landGroup.rotation.set(0, (ter.plass.rot || 0) * Math.PI / 180, 0);
  innhold.position.set(-mTilScene(ter.plass.pE || 0, mr.skala), 0, mTilScene(ter.plass.pN || 0, mr.skala));

  // Plata under bygget, som på kontoret
  byggGroup.position.set(mr.c.x, 0, mr.c.z);
  if (p && p.paa && ter.gulv) {
    const s = mr.skala;
    const pg = new THREE.PlaneGeometry((p.x1 - p.x0) / s, (p.z1 - p.z0) / s);
    pg.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({
      color: FARGE_PLATE, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    }));
    plate.position.set((p.x0 + p.x1) / 2 / s, mr.gulvY, (p.z0 + p.z1) / 2 / s);
    byggGroup.add(plate);
  }
  trengerFar = mTilScene(g.w * g.dx * 4, mr.skala);
  if (S.riggOmplasser) S.riggOmplasser();
}

// Kameraets bakre plan strekkes så hele terrenget synes (samme krok som på
// kontoret), men aldri forbi tegneavstanden i Innstillinger.
frameHooks.push(() => {
  if (!trengerFar || !terrengGroup.visible) return;
  const mål = Math.min(trengerFar, S.tegneFarTak || Infinity);
  if (camera.far < mål) { camera.far = mål; camera.updateProjectionMatrix(); }
});

async function hentKart(navn) {
  if (!navn || kartFor === navn) return;
  kartFor = navn;
  try {
    const r = await fetch("/bilde/" + (S.lettProsjekt || "00000") + "/" + encodeURIComponent(navn));
    if (!r.ok) throw new Error("HTTP " + r.status);
    const url = URL.createObjectURL(await r.blob());
    const img = await new Promise((ok, feil) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => feil(new Error("bildet kunne ikke leses"));
      i.src = url;
    });
    if (kartFor !== navn) return;          // et nyere terreng kom i mellomtiden
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    const maks = renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    tex.anisotropy = Math.min(4, maks || 1);
    tex.needsUpdate = true;
    if (kartTex) kartTex.dispose();
    kartTex = tex;
    tegn();
  } catch (err) {
    // Uten kart står terrenget der med høydefarger — ikke noe å melde om.
    console.warn("Terrengkartet kom ikke:", err);
  }
}

// markers.js (lettmodus) kaller denne med `terreng`-feltet fra Workeren.
// Gamle filer har ikke feltet → null → ingen terreng.
S.settTerrengFraLett = (d) => {
  ter = terrengFraByggeplass(d);
  if (!ter) { if (kartTex) kartTex.dispose(); kartTex = null; kartFor = ""; }
  tegn();
  if (ter && ter.kart && S.settings.terrengBygg !== false) hentKart(ter.kart);
};

// ⚙ Innstillinger → «Vis terreng»
S.oppdaterTerrengBygg = () => {
  tegn();
  if (paa() && ter.kart) hentKart(ter.kart);
};

// Modellbytte
S.ryddTerreng = () => { ter = null; rydd(); terrengGroup.visible = false; grid.visible = true; };

// 🏕 Riggen (rigg-vis.js) står på bakken når terrenget er der, akkurat som på
// kontoret. Samme form som S.terrengRef i terreng.js.
if (LETT) S.terrengRef = () => {
  if (!paa() || !S.modelGroup) return null;
  const mr = modellRef();
  const { E0, N0, plass, pad, gulv, grid: g } = ter;
  return {
    E0, N0, plass: { pE: plass.pE || 0, pN: plass.pN || 0, rot: plass.rot || 0 },
    synlig: true, adresse: "",
    yVed(E, N) {
      if (pad && pad.paa && gulv) {
        const b = terrengTilBygg(E, N, E0, N0, plass);
        if (b.bx >= pad.x0 && b.bx <= pad.x1 && b.bz >= pad.z0 && b.bz <= pad.z1) return mr.gulvY;
      }
      const h = hoydeVed(g, E, N);
      return h == null ? null : yFraMoh(h, mr);
    }
  };
};

// Samme kontrakt som terrenget på kontoret: ingen «plukk», ingen «velg»
// (en terrengtrekant skal aldri havne i Mengder eller i et flervalg).
registrerEkstraGruppe(terrengGroup, {
  id: "terreng",
  navn: "Terreng",
  noeSkjult: () => false,
  visAlt() {},
  skjulTilstand: () => ({ skjult: !paa() }),
  settSkjulTilstand() {},
  mengder: () => {},
  sokRader: () => []
});
