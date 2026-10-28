// IFC-motoren i egen tråd.
//
// Hovedtråden gjør ingenting tungt lenger: den sender filen hit, får geometri
// tilbake i porsjoner, og spør om IFC-data med hele spørsmål (ikke ett element
// av gangen). Da holder nettleseren seg i live mens en 200 MB-modell åpnes.
//
// Alle svar er vanlige objekter/typede array-er, aldri web-ifc-objekter – de kan
// ikke krysse trådgrensen.
// Selvhostet (sikkerhetsrunden 19.10): en import-URL kan ikke ha integrity-hash,
// så et kompromittert CDN kunne kjørt hva som helst på samme opphav som appen.
// Fila er byte-identisk med npm-pakken web-ifc@0.0.57. Den flertrådede .wasm
// lastes bare når siden er crossOriginIsolated — det er den ikke, så bare
// web-ifc.wasm ligger i vendor/.
import * as WebIFC from "../vendor/web-ifc-0.0.57/web-ifc-api.js";

const ifcApi = new WebIFC.IfcAPI();
ifcApi.SetWasmPath(new URL("../vendor/web-ifc-0.0.57/", import.meta.url).href, true);

let klar = null;
let modelID = null;
let fil = null;        // selve IFC-bytene, beholdt så hovedtråden kan få dem tilbake

// web-ifc pakker verdier som { value: … }
const val = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);

// ---------- Livstegn ----------
// Hovedtråden gir opp på en kommando som er HELT STILLE for lenge (se
// STILLE_MS i ifcrpc.js). Det er riktig når tråden er drept av minnemangel –
// men flere av kommandoene under kan lovlig bruke minutter uten å ha noe å
// sende. En puls sier «jeg lever» uten data, og nullstiller klokka.
//
// Maks én puls per 2 sekunder: nok til å holde klokka i gang, lite nok til at
// den ikke drukner meldingene som faktisk betyr noe.
// Tåler at post mangler: kommandoene kalles også direkte, både av lokaltKall-
// reserven og av testene. Uten denne vakten kastet puls() inne i cmdProps, og
// unntaket ble spist av try/catch-en rundt relasjonsløkka – egenskapspanelet
// ble bare stille tomt.
function pulsGiver(post) {
  if (typeof post !== "function") return () => {};
  let sist = 0;
  return () => {
    const nå = Date.now();
    if (nå - sist > 2000) { sist = nå; post({ type: "puls" }); }
  };
}

function typeNavn(id) {
  try { return (ifcApi.GetNameFromTypeCode(ifcApi.GetLineType(modelID, id)) || "").replace(/^IFC/i, ""); }
  catch(_) { return ""; }
}

// ---------- Kommandoer ----------

let testMinst = 0.15;   // settes av cmdOpen, leses av cmdGeometryLight
// 🧅 Lag-verktøyet (runde 5, 28.10.2026): et lag skal ha ALT med — hver eneste
// armeringsstang og festemiddel. Settes av cmdOpen({ alle: true }), som bare
// lag-konverteringen sender. Hovedmodellen åpnes som før.
let taMedAlle = false;

async function cmdOpen({ buffer, light, minst, sirkel, alle }) {
  // minst: 0 er gyldig for lag (ingenting siles bort). Før ble 0 til 0,15 her.
  testMinst = (typeof minst === "number" && minst >= 0) ? (minst || (alle ? 0 : 0.15)) : 0.15;
  taMedAlle = !!alle;
  if (!klar) klar = ifcApi.Init();
  await klar;
  if (modelID !== null) { try { ifcApi.CloseModel(modelID); } catch(_) {} modelID = null; }
  matKart = null;                 // materialkartet hører til forrige modell
  lagKart = null;
  qtoEnheter = null;
  fil = new Uint8Array(buffer);
  modelID = ifcApi.OpenModel(fil, light
    ? { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: sirkel || 6 }
    : { COORDINATE_TO_ORIGIN: true });

  // NB: rett etter OpenModel er denne ALLTID enhetsmatrisen i web-ifc 0.0.57 —
  // flyttingen til origo bestemmes først når geometrien leses (Lørenskog-
  // filene 28.10: open ga 1,0,0,…; etter StreamAllMeshes 429,16 / −161,85 /
  // 299,51). Den riktige sendes derfor med svaret fra geometryFull/Light
  // (koordinasjonsmatrise() under), og ifc.js bytter til den.
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

// Koordinasjonsmatrisen ETTER at geometrien er lest — den gjelder.
function koordinasjonsmatrise() {
  try { return Array.from(ifcApi.GetCoordinationMatrix(modelID)); } catch (_) { return null; }
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

  const puls = pulsGiver(post);

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    puls();
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
  return { shown: count, skipped: 0, coordMatrix: koordinasjonsmatrise() };
}

// 🪶 Lav kvalitet: slås sammen per farge HER, så hovedtråden får ferdige buffere
function cmdGeometryLight({ maxId, basis }, post) {
  const skipTypes = new Set([WebIFC.IFCMECHANICALFASTENER, WebIFC.IFCFASTENER, WebIFC.IFCDISCRETEACCESSORY]
    .filter(t => t !== undefined));
  const buckets = new Map();
  let shown = 0, skipped = 0;
  const puls = pulsGiver(post);

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    // FØRST i callbacken, ikke etterpå: begge «skipped++; return» under hopper
    // over framdriftslinja nederst. En modell der nesten alt siles bort var
    // derfor helt stille i minutter, og ville blitt drept av stille-klokka.
    puls();
    const id = mesh.expressID;
    if (!taMedAlle) try { if (skipTypes.has(ifcApi.GetLineType(modelID, id))) { skipped++; return; } } catch(_) {}

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
    // dropp veldig små elementer (< 0,15 i modellens enheter) — ikke i et lag
    if (!taMedAlle && Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) < testMinst) { skipped++; return; }

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
    puls();   // få farger og mange trekanter = lang stillhet uten denne
    const pos = new Float32Array(b.vtot * 3);
    const norm = new Float32Array(b.vtot * 3);
    const idx = new Uint32Array(b.itot);
    const ranges = [];
    let vo = 0, io = 0;
    for (const s of b.segs) {
      puls();
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
  return { shown, skipped, coordMatrix: koordinasjonsmatrise() };
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

// 🧅 LAGSETT (Emil 12.10): et dekke eller en vegg med «200 mm betong + 300 mm
// isolasjon» er ETT element, men to varer med hver sin pris. Navnet over slår
// dem sammen («Betong + Isolasjon»); her leses lagene med TYKKELSE, så
// mengdene kan deles per materiale (elements.js computeQuantities).
// [[materialnavn, tykkelse i meter], …] — bare når det er minst to ULIKE lag.
let lagKart = null;
function matLag(id, dybde) {
  if (!id || dybde > 4) return null;
  let line;
  try { line = ifcApi.GetLine(modelID, id); } catch (_) { return null; }
  if (!line) return null;
  if (line.ForLayerSet && line.ForLayerSet.value) return matLag(line.ForLayerSet.value, dybde + 1);
  // IFC4: IfcMaterialConstituentSet med Fraction (andel av volumet). Andelen
  // brukes som «tykkelse» — det er bare forholdet mellom lagene som teller.
  if (Array.isArray(line.MaterialConstituents)) {
    const perNavn = new Map();
    for (const r of line.MaterialConstituents) {
      let c;
      try { c = ifcApi.GetLine(modelID, r && r.value); } catch (_) { continue; }
      const fr = Number(val(c && c.Fraction));
      if (!c || !isFinite(fr) || fr <= 0) return null;     // uten andel kan ikke volumet deles
      const navn = (c.Material && c.Material.value ? matNavn(c.Material.value, dybde + 1) : "") || String(val(c.Name) || "").trim() || "Ukjent";
      perNavn.set(navn, (perNavn.get(navn) || 0) + fr);
    }
    return perNavn.size > 1 ? [...perNavn.entries()] : null;
  }
  if (!Array.isArray(line.MaterialLayers)) return null;
  const f = (qtoEnheter || (qtoEnheter = lesEnheter())).lengde || 1;
  const perNavn = new Map();
  for (const r of line.MaterialLayers) {
    let l;
    try { l = ifcApi.GetLine(modelID, r && r.value); } catch (_) { continue; }
    if (!l) continue;
    const t = Number(val(l.LayerThickness));
    if (!isFinite(t) || t <= 0) continue;
    const navn = (l.Material && l.Material.value ? matNavn(l.Material.value, dybde + 1) : "") || String(val(l.Name) || "").trim() || "Ukjent lag";
    perNavn.set(navn, (perNavn.get(navn) || 0) + t * f);
  }
  return perNavn.size > 1 ? [...perNavn.entries()] : null;
}

function byggMatKart() {
  if (matKart) return matKart;
  matKart = new Map();
  lagKart = new Map();
  try {
    const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));
      const navn = matNavn(rel.RelatingMaterial && rel.RelatingMaterial.value, 0);
      if (!navn) continue;
      const lag = matLag(rel.RelatingMaterial && rel.RelatingMaterial.value, 0);
      (rel.RelatedObjects || []).forEach(o => {
        if (!o || !o.value) return;
        matKart.set(o.value, navn);
        if (lag) lagKart.set(o.value, lag);
      });
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
      const lag = lagKart.get(t);
      (rel.RelatedObjects || []).forEach(o => {
        if (o && o.value && !matKart.has(o.value)) {
          matKart.set(o.value, navn);
          if (lag) lagKart.set(o.value, lag);
        }
      });
    }
  } catch(_) {}
  return matKart;
}

// Navn, type, tag, GlobalId og materiale for mange elementer i én runde.
// Hovedtråden hurtigbufrer dette, så resten av viewer'en kan slå opp synkront.
function cmdMeta({ ids }, post) {
  const mat = byggMatKart();
  const puls = pulsGiver(post);
  const out = [];
  let teller = 0;
  for (const id of ids) {
    if ((++teller & 511) === 0) puls();
    let name = "", objectType = "", tag = "", globalId = "";
    try {
      const line = ifcApi.GetLine(modelID, id);
      name = val(line.Name) || "";
      objectType = val(line.ObjectType) || "";
      tag = val(line.Tag) || "";
      globalId = val(line.GlobalId) || "";
    } catch(_) {}
    const m = { id, name, objectType, tag, globalId, typeName: typeNavn(id),
      material: mat.get(id) || "" };
    if (lagKart && lagKart.has(id)) m.lag = lagKart.get(id);
    out.push(m);
  }
  return out;
}

// Full egenskapsliste for ETT element (åpnes bare når man trykker på noe)
const QTO_ENHET = { lengde: "m", areal: "m²", volum: "m³", masse: "kg", antall: "stk" };
function qtoTekst(art, v) {
  const d = art === "antall" ? 0 : art === "masse" ? 1 : 3;
  return String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",") + " " + QTO_ENHET[art];
}
let qtoEnheter = null;            // enhetene hører til modellen — nullstilles i cmdOpen/cmdClose

function cmdProps({ id }, post) {
  const puls = pulsGiver(post);
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
      if ((i & 511) === 0) puls();
      const rel = ifcApi.GetLine(modelID, relIDs.get(i));
      const related = (rel.RelatedObjects || []).map(o => o.value);
      if (!related.includes(id)) continue;
      const ref = rel.RelatingPropertyDefinition;
      if (!ref) continue;
      const pset = ifcApi.GetLine(modelID, ref.value);
      // 📐 Mengdesett (Qto_…) vises også, i SI-enheter, så du kan se hva
      // prosjekterende har oppgitt når du feilsøker kg og m³.
      if (pset && pset.Quantities) {
        const liste = [];
        lesMengdesett(pset, qtoEnheter || (qtoEnheter = lesEnheter()), liste);
        for (const [sett, navn, art, v] of liste) psets.push([sett + " · " + navn, qtoTekst(art, v)]);
        continue;
      }
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

// ---------- 📐 Mengdesettene fra prosjekterende (IfcElementQuantity) ----------
// Byggeplan: «Storm IFC-Viewer Priskalkulasjon kartlegging … 2026-10-12».
// Fram til nå leste vi BARE egenskapssett (HasProperties). Mengdesettene
// (Qto_WallBaseQuantities osv.) har Quantities i stedet, og ble hoppet over
// uten et ord — Revit og Tekla eksporterer NetVolume, GrossVolume,
// NetSideArea, Length og ofte NetWeight der. Emil 12.10: priskalkulasjonen
// skal vise BÅDE det vi regner fra geometrien og det som står i fila, med
// avvik, så kg- og m³-tallene blir mer treffsikre.
//
// ENHETENE er fallgruva. Tallene i fila står i prosjektets enheter
// (IfcUnitAssignment): lengde ofte i mm, volum likevel i m³, masse i kg eller
// tonn. Alt gjøres om til SI her (m, m², m³, kg), så hovedtråden aldri må
// gjette. Mangler areal/volum i enhetslista, avledes de av lengden.
const SI_PREFIKS = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
  HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
  PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18 };
const ENHET_ART = { LENGTHUNIT: "lengde", AREAUNIT: "areal", VOLUMEUNIT: "volum", MASSUNIT: "masse" };
const QTO_FELT = [["LengthValue", "lengde"], ["AreaValue", "areal"], ["VolumeValue", "volum"],
  ["WeightValue", "masse"], ["CountValue", "antall"]];

// Hvor mange SI-enheter én enhet i fila er. null = ukjent enhet (da brukes ikke tallet).
export function siFaktor(navn, prefiks) {
  const n = String(navn || "").toUpperCase().replace(/^\./, "").replace(/\.$/, "");
  const pr = String(prefiks || "").toUpperCase().replace(/^\./, "").replace(/\.$/, "");
  const p = pr ? SI_PREFIKS[pr] : 1;
  if (p === undefined) return null;
  if (n === "METRE") return p;
  if (n === "SQUARE_METRE") return p * p;
  if (n === "CUBIC_METRE") return p * p * p;
  if (n === "GRAM") return p / 1000;
  return null;
}

function enhetFaktor(id, dybde) {
  if (!id || dybde > 4) return null;
  let line;
  try { line = ifcApi.GetLine(modelID, id); } catch (_) { return null; }
  if (!line) return null;
  // Konverteringsbasert (fot, tonn …): verdien × SI-enheten den peker på
  if (line.ConversionFactor && line.ConversionFactor.value) {
    try {
      const mw = ifcApi.GetLine(modelID, line.ConversionFactor.value);
      const v = Number(val(mw.ValueComponent));
      const under = mw.UnitComponent && mw.UnitComponent.value ? enhetFaktor(mw.UnitComponent.value, dybde + 1) : 1;
      return isFinite(v) && under ? v * under : null;
    } catch (_) { return null; }
  }
  return siFaktor(val(line.Name), val(line.Prefix));
}

function lesEnheter() {
  const e = { lengde: null, areal: null, volum: null, masse: null };
  try {
    const ua = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCUNITASSIGNMENT);
    for (let i = 0; i < ua.size(); i++) {
      const linje = ifcApi.GetLine(modelID, ua.get(i));
      for (const ref of (linje.Units || [])) {
        const id = ref && ref.value;
        if (!id) continue;
        let u;
        try { u = ifcApi.GetLine(modelID, id); } catch (_) { continue; }
        const art = ENHET_ART[String(val(u && u.UnitType) || "").toUpperCase().replace(/\./g, "")];
        if (!art || e[art] !== null) continue;
        const f = enhetFaktor(id, 0);
        if (f) e[art] = f;
      }
    }
  } catch (_) {}
  if (e.lengde === null) e.lengde = 1;
  if (e.areal === null) e.areal = e.lengde * e.lengde;
  if (e.volum === null) e.volum = e.lengde * e.lengde * e.lengde;
  if (e.masse === null) e.masse = 1;
  return e;
}

// Ett mengdesett → [[sett, navn, art, verdi i SI], …]
function lesMengdesett(def, enheter, ut) {
  const sett = String(val(def.Name) || "Qto");
  for (const qRef of (def.Quantities || [])) {
    let q;
    try { q = ifcApi.GetLine(modelID, qRef.value); } catch (_) { continue; }
    if (!q) continue;
    const navn = String(val(q.Name) || "");
    for (const [felt, art] of QTO_FELT) {
      if (q[felt] === undefined || q[felt] === null) continue;
      const v = Number(val(q[felt]));
      if (!isFinite(v)) break;
      let f = art === "antall" ? 1 : enheter[art];
      // Mengden kan ha sin egen enhet (sjeldent, men lov)
      if (art !== "antall" && q.Unit && q.Unit.value) { const egen = enhetFaktor(q.Unit.value, 0); if (egen) f = egen; }
      if (f) ut.push([sett, navn, art, v * f]);
      break;
    }
  }
}

function cmdQto(_a, post) {
  const puls = pulsGiver(post);
  const enheter = lesEnheter();
  const perElement = new Map();
  try {
    // Bare relasjonene som peker på et mengdesett åpnes fullt — de vanlige
    // egenskapssettene (som er de fleste) hoppes over på id-en.
    const qtoIder = new Set();
    const qv = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCELEMENTQUANTITY);
    for (let i = 0; i < qv.size(); i++) qtoIder.add(qv.get(i));
    if (qtoIder.size) {
      const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
      for (let i = 0; i < rels.size(); i++) {
        if ((i & 511) === 0) puls();
        let rel;
        try { rel = ifcApi.GetLine(modelID, rels.get(i)); } catch (_) { continue; }
        const r = rel && rel.RelatingPropertyDefinition;
        const refs = Array.isArray(r) ? r : [r];
        for (const ref of refs) {
          const did = ref && ref.value;
          if (!did || !qtoIder.has(did)) continue;
          let def;
          try { def = ifcApi.GetLine(modelID, did); } catch (_) { continue; }
          const liste = [];
          lesMengdesett(def, enheter, liste);
          if (!liste.length) continue;
          for (const o of (rel.RelatedObjects || [])) {
            const id = o && o.value;
            if (!id) continue;
            if (!perElement.has(id)) perElement.set(id, []);
            perElement.get(id).push(...liste);
          }
        }
      }
    }
  } catch (_) {}
  return { enheter, elementer: [...perElement.entries()] };
}

// Etasjer med tilhørende elementer – hele utregningen gjøres her.
// 📐 Lag (28.10): `mm` = Elevation i millimeter (via prosjektets lengdeenhet),
// og `medTomme` tar med etasjer uten elementer — Juster plassering
// sammenligner etasjene på navn, og en etasje kan være tom i én av filene.
function cmdStoreys(a, post) {
  const puls = pulsGiver(post);
  puls();
  const medTomme = !!(a && a.medTomme);
  let mPerEnhet = 1;
  try { mPerEnhet = (qtoEnheter || (qtoEnheter = lesEnheter())).lengde || 1; } catch (_) {}
  const tilMm = (v) => Math.round(v * mPerEnhet * 1000 * 10) / 10;
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
        e.mm = tilMm(e.elev);
        byStorey.set(sid, e);
      }
      (rel.RelatedElements || []).forEach(o => e.ids.push(o.value));
    }
    if (medTomme) {
      try {
        const alle = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY);
        for (let i = 0; i < alle.size(); i++) {
          const sid = alle.get(i);
          if (byStorey.has(sid)) continue;
          const line = ifcApi.GetLine(modelID, sid);
          const elev = Number(val(line.Elevation)) || 0;
          byStorey.set(sid, { name: val(line.Name) || ("Etasje " + (byStorey.size + 1)), elev, mm: tilMm(elev), ids: [] });
        }
      } catch (_) {}
      return [...byStorey.values()].sort((a, b) => a.elev - b.elev);
    }
    return [...byStorey.values()].filter(s => s.ids.length).sort((a, b) => a.elev - b.elev);
  } catch(_) { return []; }
}

// Kandidater til aksesystemet: søyler, fundamenter, peler, vegger, bjelker
function cmdAxisSources(_a, post) {
  const puls = pulsGiver(post);
  puls();
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

// ---------- 🧅 Nøkkeltall til Lag-verktøyet (runde 5, 28.10.2026) ----------
// Armeringsmodeller fra Revit (Lørenskog 14.10) har INGEN mengdesett og intet
// vektfelt. Det som finnes, står på selve IfcReinforcingBar:
//   NominalDiameter (16), BarLength (5145), CrossSectionArea, SteelGrade
// og i Pset_ReinforcingBarBendingsISOCD3766Common (bøyeform + mål a, b, c …).
// Et Revit-SETT er ÉN IfcReinforcingBar med én solid per stang i Body-
// representasjonen — antall stenger = antall solider. Vekten regnes i
// lag-regn.js (π/4 · d² · L · 7 850), ikke her.
// Svar: { lengde: meter per modellenhet, tall: { id: { d, L, n, form, mal, kval, ref, pos } } }
// d og L i mm.
function antallSolider(line) {
  try {
    const rep = line.Representation && line.Representation.value;
    if (!rep) return 1;
    const pds = ifcApi.GetLine(modelID, rep);
    for (const r of (pds.Representations || [])) {
      const sr = ifcApi.GetLine(modelID, r && r.value);
      const navn = String(val(sr && sr.RepresentationIdentifier) || "");
      if (/^body$/i.test(navn) && Array.isArray(sr.Items)) return Math.max(1, sr.Items.length);
    }
  } catch (_) {}
  return 1;
}
function cmdLagTall(_args, post) {
  const puls = pulsGiver(post);
  const enh = qtoEnheter || (qtoEnheter = lesEnheter());
  const tilMm = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * (enh.lengde || 1) * 1000 * 10) / 10 : null; };
  const tall = {};
  let ider = [];
  try {
    const v = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCREINFORCINGBAR);
    for (let i = 0; i < v.size(); i++) ider.push(v.get(i));
  } catch (_) { ider = []; }
  let teller = 0;
  for (const id of ider) {
    if ((++teller & 255) === 0) puls();
    let line;
    try { line = ifcApi.GetLine(modelID, id); } catch (_) { continue; }
    tall[id] = { d: tilMm(val(line.NominalDiameter)), L: tilMm(val(line.BarLength)),
      n: antallSolider(line), kval: String(val(line.SteelGrade) || ""), form: "", mal: {}, ref: "", pos: "" };
  }
  if (ider.length) {
    const sett = new Set(ider);
    try {
      const rels = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
      for (let i = 0; i < rels.size(); i++) {
        if ((i & 511) === 0) puls();
        const rel = ifcApi.GetLine(modelID, rels.get(i));
        const mine = (rel.RelatedObjects || []).map(o => o && o.value).filter(x => sett.has(x));
        if (!mine.length || !rel.RelatingPropertyDefinition) continue;
        const pset = ifcApi.GetLine(modelID, rel.RelatingPropertyDefinition.value);
        if (!pset || !Array.isArray(pset.HasProperties)) continue;
        const ut = { mal: {} };
        for (const pr of pset.HasProperties) {
          let p; try { p = ifcApi.GetLine(modelID, pr && pr.value); } catch (_) { continue; }
          const navn = String(val(p && p.Name) || ""), v = val(p && p.NominalValue);
          if (v == null || v === "") continue;
          let m;
          if (/ShapeCode$/i.test(navn) || /^(Shape|Bøyeform|BendingShape)$/i.test(navn)) ut.form = String(v);
          else if ((m = /ShapeParameter_([A-Za-z0-9]+)$/.exec(navn))) ut.mal[m[1]] = tilMm(v);
          else if (/^Reference$/i.test(navn)) ut.ref = String(v);
          else if (/^(Rebar Number|Schedule Mark|Bar Mark|Pos(isjon)?(snummer|\.? ?nr)?|Mark)$/i.test(navn)) ut.pos = String(v);
          else if (/^(SteelGrade|Grade|Stålkvalitet)$/i.test(navn)) ut.kval = String(v);
        }
        for (const id of mine) {
          const t = tall[id];
          if (ut.form) t.form = ut.form;
          if (ut.ref) t.ref = ut.ref;
          if (ut.pos) t.pos = ut.pos;
          if (ut.kval && !t.kval) t.kval = ut.kval;
          Object.assign(t.mal, ut.mal);
        }
      }
    } catch (_) {}
  }
  return { lengde: enh.lengde || 1, tall };
}

function cmdClose() {
  if (modelID !== null) { try { ifcApi.CloseModel(modelID); } catch(_) {} }
  modelID = null;
  taMedAlle = false;
  matKart = null;
  lagKart = null;
  qtoEnheter = null;
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
  lagTall: cmdLagTall,   // 🧅 Lag-verktøyet: armeringens nøkkeltall
  props: cmdProps,
  qto: cmdQto,
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
