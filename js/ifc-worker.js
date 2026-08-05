// IFC-motoren i egen tråd.
//
// Hovedtråden gjør ingenting tungt lenger: den sender filen hit, får geometri
// tilbake i porsjoner, og spør om IFC-data med hele spørsmål (ikke ett element
// av gangen). Da holder nettleseren seg i live mens en 200 MB-modell åpnes.
//
// Alle svar er vanlige objekter/typede array-er, aldri web-ifc-objekter – de kan
// ikke krysse trådgrensen.
import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/web-ifc-api.js";

const ifcApi = new WebIFC.IfcAPI();
ifcApi.SetWasmPath("https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/", true);

let klar = null;
let modelID = null;
let fil = null;        // selve IFC-bytene, beholdt så hovedtråden kan få dem tilbake

// web-ifc pakker verdier som { value: … }
const val = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);

function typeNavn(id) {
  try { return (ifcApi.GetNameFromTypeCode(ifcApi.GetLineType(modelID, id)) || "").replace(/^IFC/i, ""); }
  catch(_) { return ""; }
}

// ---------- Kommandoer ----------

let testMinst = 0.15;   // settes av cmdOpen, leses av cmdGeometryLight

async function cmdOpen({ buffer, light, minst, sirkel }) {
  testMinst = minst || 0.15;
  if (!klar) klar = ifcApi.Init();
  await klar;
  if (modelID !== null) { try { ifcApi.CloseModel(modelID); } catch(_) {} modelID = null; }
  matKart = null;                 // materialkartet hører til forrige modell
  fil = new Uint8Array(buffer);
  modelID = ifcApi.OpenModel(fil, light
    ? { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: sirkel || 8 }
    : { COORDINATE_TO_ORIGIN: true });

  let coordMatrix = null;
  try { coordMatrix = Array.from(ifcApi.GetCoordinationMatrix(modelID)); } catch(_) {}

  // Hvor mange elementer kan ha geometri? Brukes som nevner i prosenten.
  // Klarer vi ikke å telle dem, faller vi tilbake på hvor langt inn i filen vi er.
  let total = 0, basis = "fil";
  try {
    const v = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPRODUCT, true);
    if (v && v.size && v.size() > 0) { total = v.size(); basis = "elementer"; }
  } catch(_) {}
  let maxId = 0;
  try { maxId = ifcApi.GetMaxExpressID(modelID); } catch(_) {}
  if (!total) total = maxId;

  return { coordMatrix, total, basis, maxId };
}

// Leser ett mesh til rene array-er
function lesDeler(mesh) {
  const parts = [];
  for (let i = 0; i < mesh.geometries.size(); i++) {
    const pg = mesh.geometries.get(i);
    const geom = ifcApi.GetGeometry(modelID, pg.geometryExpressID);
    const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
    const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
    const n = verts.length / 2;
    const pos = new Float32Array(n);
    const norm = new Float32Array(n);
    for (let j = 0; j < verts.length; j += 6) {
      const k = j / 2;
      pos[k] = verts[j]; pos[k + 1] = verts[j + 1]; pos[k + 2] = verts[j + 2];
      norm[k] = verts[j + 3]; norm[k + 1] = verts[j + 4]; norm[k + 2] = verts[j + 5];
    }
    parts.push({
      pos, norm,
      idx: new Uint32Array(indices),
      color: { x: pg.color.x, y: pg.color.y, z: pg.color.z, w: pg.color.w },
      matrix: Array.from(pg.flatTransformation)
    });
    geom.delete();
  }
  return parts;
}

// Full kvalitet: sendes i porsjoner, så hovedtråden kan bygge mesh underveis
function cmdGeometryFull({ total, basis, maxId }, post) {
  let count = 0;
  let batch = [];
  let bytes = 0;

  const send = (ferdig) => {
    if (!batch.length) return;
    const overfor = [];
    batch.forEach(e => e.parts.forEach(p => {
      overfor.push(p.pos.buffer, p.norm.buffer, p.idx.buffer);
    }));
    post({ type: "geo", batch, done: count, total, basis }, overfor);
    batch = []; bytes = 0;
  };

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    const parts = lesDeler(mesh);
    batch.push({ id: mesh.expressID, parts });
    parts.forEach(p => { bytes += p.pos.byteLength + p.norm.byteLength + p.idx.byteLength; });
    count++;
    // porsjoner på ca. 4 MB: ofte nok til jevn framdrift, sjelden nok til lite støy
    if (bytes > 4e6) {
      if (basis === "fil" && maxId) post({ type: "progress", done: mesh.expressID, total: maxId, basis });
      send();
    }
  });
  send(true);
  return { shown: count, skipped: 0 };
}

// 🪶 Lav kvalitet: slås sammen per farge HER, så hovedtråden får ferdige buffere
function cmdGeometryLight({ maxId, basis }, post) {
  const skipTypes = new Set([WebIFC.IFCMECHANICALFASTENER, WebIFC.IFCFASTENER, WebIFC.IFCDISCRETEACCESSORY]
    .filter(t => t !== undefined));
  const buckets = new Map();
  let shown = 0, skipped = 0;

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    const id = mesh.expressID;
    try { if (skipTypes.has(ifcApi.GetLineType(modelID, id))) { skipped++; return; } } catch(_) {}

    const parts = lesDeler(mesh);
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    // legg transformasjonen inn i punktene med en gang (som før), og finn boksen
    for (const p of parts) {
      const m = p.matrix;
      const pos = p.pos, norm = p.norm;
      for (let k = 0; k < pos.length; k += 3) {
        const x = pos[k], y = pos[k + 1], z = pos[k + 2];
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
        const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
        pos[k] = tx; pos[k + 1] = ty; pos[k + 2] = tz;
        if (tx < mnx) mnx = tx; if (tx > mxx) mxx = tx;
        if (ty < mny) mny = ty; if (ty > mxy) mxy = ty;
        if (tz < mnz) mnz = tz; if (tz > mxz) mxz = tz;
        // normalene roteres (uten flytting); god nok med matrisens 3×3-del
        const nx = norm[k], ny = norm[k + 1], nz = norm[k + 2];
        let rx = m[0] * nx + m[4] * ny + m[8] * nz;
        let ry = m[1] * nx + m[5] * ny + m[9] * nz;
        let rz = m[2] * nx + m[6] * ny + m[10] * nz;
        const len = Math.hypot(rx, ry, rz) || 1;
        norm[k] = rx / len; norm[k + 1] = ry / len; norm[k + 2] = rz / len;
      }
    }
    // dropp veldig små elementer (< 0,15 i modellens enheter)
    if (Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) < testMinst) { skipped++; return; }

    for (const p of parts) {
      const key = [p.color.x, p.color.y, p.color.z, p.color.w].join(",");
      let b = buckets.get(key);
      if (!b) { b = { color: p.color, segs: [], vtot: 0, itot: 0 }; buckets.set(key, b); }
      b.segs.push({ pos: p.pos, norm: p.norm, idx: p.idx, id });
      b.vtot += p.pos.length / 3;
      b.itot += p.idx.length;
    }
    shown++;
    if ((shown & 255) === 0 && maxId) post({ type: "progress", done: id, total: maxId, basis });
  });

  // slå sammen og send én bøtte om gangen, så minnetoppen holdes nede
  let nr = 0;
  for (const [, b] of buckets) {
    const pos = new Float32Array(b.vtot * 3);
    const norm = new Float32Array(b.vtot * 3);
    const idx = new Uint32Array(b.itot);
    const ranges = [];
    let vo = 0, io = 0;
    for (const s of b.segs) {
      pos.set(s.pos, vo * 3);
      norm.set(s.norm, vo * 3);
      for (let i = 0; i < s.idx.length; i++) idx[io + i] = s.idx[i] + vo;
      ranges.push({ start: io, count: s.idx.length, id: s.id });
      vo += s.pos.length / 3;
      io += s.idx.length;
    }
    b.segs = null;
    post({ type: "bucket", pos, norm, idx, ranges, color: b.color, nr: nr++, av: buckets.size },
      [pos.buffer, norm.buffer, idx.buffer]);
  }
  return { shown, skipped };
}

// ---------- Materiale per element ----------
// Materialet står ikke på elementet selv, men i IfcRelAssociatesMaterial, og kan
// peke på et helt tre av lag- og profilsett. Kartet bygges én gang, ved første
// gang noe spør etter meta – ikke ved åpning, så en modell som bare skal ses på
// ikke betaler for det.
let matKart = null;

// Følger materialkjeden til det fins et navn. Lagsett og profilsett kan ha
// flere materialer (f.eks. «Betong + Isolasjon») – da tas alle med.
const MAT_LISTER = ["Materials", "MaterialLayers", "MaterialProfiles", "MaterialConstituents"];
const MAT_REFS = ["Material", "ForLayerSet", "ForProfileSet"];

function matNavn(id, dybde) {
  if (!id || dybde > 5) return "";
  let line;
  try { line = ifcApi.GetLine(modelID, id); } catch(_) { return ""; }
  if (!line) return "";
  const ut = [];
  for (const f of MAT_LISTER)
    for (const r of (line[f] || [])) {
      const n = matNavn(r && r.value, dybde + 1);
      if (n) ut.push(n);
    }
  for (const f of MAT_REFS)
    if (line[f] && line[f].value) {
      const n = matNavn(line[f].value, dybde + 1);
      if (n) ut.push(n);
    }
  if (ut.length) return [...new Set(ut)].join(" + ");
  const eget = val(line.Name);
  return eget ? String(eget).trim() : "";
}

function byggMatKart() {
  if (matKart) return matKart;
  matKart = new Map();
  try {
    const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));
      const navn = matNavn(rel.RelatingMaterial && rel.RelatingMaterial.value, 0);
      if (!navn) continue;
      (rel.RelatedObjects || []).forEach(o => { if (o && o.value) matKart.set(o.value, navn); });
    }
  } catch(_) {}
  // Mange modeller henger materialet på typeobjektet (IfcColumnType) i stedet
  // for på hver søyle. Da arver elementene fra typen sin.
  try {
    const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));
      const t = rel.RelatingType && rel.RelatingType.value;
      const navn = t ? matKart.get(t) : null;
      if (!navn) continue;
      (rel.RelatedObjects || []).forEach(o => {
        if (o && o.value && !matKart.has(o.value)) matKart.set(o.value, navn);
      });
    }
  } catch(_) {}
  return matKart;
}

// Navn, type, tag, GlobalId og materiale for mange elementer i én runde.
// Hovedtråden hurtigbufrer dette, så resten av viewer'en kan slå opp synkront.
function cmdMeta({ ids }) {
  const mat = byggMatKart();
  const out = [];
  for (const id of ids) {
    let name = "", objectType = "", tag = "", globalId = "";
    try {
      const line = ifcApi.GetLine(modelID, id);
      name = val(line.Name) || "";
      objectType = val(line.ObjectType) || "";
      tag = val(line.Tag) || "";
      globalId = val(line.GlobalId) || "";
    } catch(_) {}
    out.push({ id, name, objectType, tag, globalId, typeName: typeNavn(id),
      material: mat.get(id) || "" });
  }
  return out;
}

// Full egenskapsliste for ETT element (åpnes bare når man trykker på noe)
function cmdProps({ id }) {
  const felt = [];
  let typeName = "";
  try {
    const line = ifcApi.GetLine(modelID, id);
    typeName = typeNavn(id);
    for (const key of ["GlobalId", "Name", "ObjectType", "Tag", "Description", "PredefinedType"]) {
      const v = val(line[key]);
      if (v !== null && v !== undefined && v !== "") felt.push([key, v]);
    }
  } catch(_) { return { typeName: "", felt: [], psets: [], feil: true }; }

  const psets = [];
  try {
    const relIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < relIDs.size(); i++) {
      const rel = ifcApi.GetLine(modelID, relIDs.get(i));
      const related = (rel.RelatedObjects || []).map(o => o.value);
      if (!related.includes(id)) continue;
      const ref = rel.RelatingPropertyDefinition;
      if (!ref) continue;
      const pset = ifcApi.GetLine(modelID, ref.value);
      if (!pset || !pset.HasProperties) continue;
      const psetName = val(pset.Name) || "Pset";
      for (const pRef of pset.HasProperties) {
        try {
          const p = ifcApi.GetLine(modelID, pRef.value);
          const pv = val(p.NominalValue);
          if (pv !== null && pv !== undefined) psets.push([psetName + " · " + val(p.Name), pv]);
        } catch(_) {}
      }
    }
  } catch(_) {}
  return { typeName, felt, psets };
}

// Etasjer med tilhørende elementer – hele utregningen gjøres her
function cmdStoreys() {
  try {
    const byStorey = new Map();
    const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));
      const sid = rel.RelatingStructure && rel.RelatingStructure.value;
      if (!sid) continue;
      try { if (ifcApi.GetLineType(modelID, sid) !== WebIFC.IFCBUILDINGSTOREY) continue; } catch(_) { continue; }
      let e = byStorey.get(sid);
      if (!e) {
        const line = ifcApi.GetLine(modelID, sid);
        e = { name: val(line.Name) || ("Etasje " + (byStorey.size + 1)), elev: Number(val(line.Elevation)) || 0, ids: [] };
        byStorey.set(sid, e);
      }
      (rel.RelatedElements || []).forEach(o => e.ids.push(o.value));
    }
    return [...byStorey.values()].filter(s => s.ids.length).sort((a, b) => a.elev - b.elev);
  } catch(_) { return []; }
}

// Kandidater til aksesystemet: søyler, fundamenter, peler, vegger, bjelker
function cmdAxisSources() {
  const cand = [
    ["COLUMN", WebIFC.IFCCOLUMN], ["FOOTING", WebIFC.IFCFOOTING],
    ["PILE", WebIFC.IFCPILE], ["WALL", WebIFC.IFCWALL],
    ["WALLSTANDARDCASE", WebIFC.IFCWALLSTANDARDCASE], ["BEAM", WebIFC.IFCBEAM]
  ];
  const out = [];
  for (const [t, code] of cand) {
    if (code === undefined) continue;
    try {
      const v = ifcApi.GetLineIDsWithType(modelID, code);
      for (let i = 0; i < v.size(); i++) {
        const id = v.get(i);
        let objType = "", name = "";
        if (t === "COLUMN") {
          try { const line = ifcApi.GetLine(modelID, id); objType = val(line.ObjectType) || ""; name = val(line.Name) || ""; } catch(_) {}
        }
        out.push({ t, id, objType, name });
      }
    } catch(_) {}
  }
  return out;
}

// Gir filen tilbake til hovedtråden (overført, ikke kopiert)
function cmdBuffer(_a, post) {
  if (!fil) return { buffer: null };
  const ut = fil.buffer;
  fil = null;                     // hovedtråden eier den nå
  post({ type: "buffer-ut" });    // bare for å ha noe å henge overføringen på
  return { buffer: ut, _overfor: [ut] };
}

function cmdClose() {
  if (modelID !== null) { try { ifcApi.CloseModel(modelID); } catch(_) {} }
  modelID = null;
  matKart = null;
  fil = null;
  return { ok: true };
}

// ---------- Meldingsløkke ----------
// Eksportert slik at testene kan kjøre kommandoene uten en ekte Worker.
export const KOMMANDOER = {
  open: cmdOpen,
  geometryFull: cmdGeometryFull,
  geometryLight: cmdGeometryLight,
  meta: cmdMeta,
  props: cmdProps,
  storeys: cmdStoreys,
  axisSources: cmdAxisSources,
  buffer: cmdBuffer,
  close: cmdClose
};

export async function håndter(msg, post) {
  const { id, cmd, args } = msg;
  const fn = KOMMANDOER[cmd];
  if (!fn) { post({ id, feil: "Ukjent kommando: " + cmd }); return; }
  try {
    const svar = await fn(args || {}, (m, overfor) => post(Object.assign({ id }, m), overfor));
    if (svar && svar._overfor) {
      const overfor = svar._overfor;
      delete svar._overfor;
      post({ id, svar }, overfor);
    } else post({ id, svar });
  } catch (err) {
    post({ id, feil: (err && err.message) || String(err) });
  }
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && !self.document) {
  self.onmessage = (e) => håndter(e.data, (m, overfor) => self.postMessage(m, overfor || []));
}
