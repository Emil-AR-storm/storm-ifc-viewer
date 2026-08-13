// 🔠 Aksesystem: finner akselinjer automatisk fra valgte elementtyper.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, på, S, apnePanel, esc, statusEl } from "./state.js";
import { t } from "./i18n.js";
import { val } from "./elements.js";
import { lightElementBoxes } from "./ifc.js";
import { kall } from "./ifcrpc.js";
import { axesGroup, camera, frameHooks, makeLabel, renderer } from "./scene.js";

// Zoom-avhengige akse-lapper: skjul lapper som ville blitt for små på skjermen.
// Mål-lappene (gule) krever mer plass enn aksenavnene og dukker opp først når man zoomer inn.
const _lodV = new THREE.Vector3();

function updateAxisLOD() {
  const hpx = renderer.domElement.clientHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const o of axesGroup.children) {
    if (!o.isSprite || !o.userData.axisTag) continue;
    const d = _lodV.copy(o.position).sub(camera.position).length() || 1;
    const px = (o.scale.y / d) * hpx; // lappens høyde i skjerm-piksler
    o.visible = px > (o.userData.dim ? 12 : 7);
  }
}

// ---------- Aksesystem (automatisk fra valgte elementtyper) ----------

// ---------- Aksesystem (automatisk fra valgte elementtyper) ----------

// Stålprofiler (HEA/HEB/IPE/HUP/VKR/SHS osv.) og betong-kjennetegn i ObjectType/navn
const AXIS_STEEL_RE = /(\bHE\s?-?[ABM]\s?-?\d|\bIPE|\bINP|\bUNP|\bUPE|\bHUP|\bVKR|\bKVR|\bHSQ|\bWQ|\bSHS|\bRHS|\bCHS|\bCFRHS|\bCFSHS|\bCFCHS|\bKCKR|\bS\s?(235|275|355|420|460)\b|st[åa]l|steel)/i;

const AXIS_CONC_RE = /(betong|concrete|prefab|hulldekk|\bB\s?[2-5]\d\b|\bC\d{2}\/\d{2}|\bLC\d{2})/i;

const AXIS_TYPE_LABELS = { FOOTING: "Fundamenter", PILE: "Peler", WALL: "Vegger", BEAM: "Bjelker" };

const AXIS_COL_LABELS = { COL_STEEL: "Stålsøyler", COL_CONC: "Betongsøyler", COL_OTHER: "Søyler (andre)" };

function axisColumnKey(objType, name) {
  const s = (objType || "") + " " + (name || "");
  if (AXIS_STEEL_RE.test(s)) return "COL_STEEL";
  // rene tverrsnittsmål som «300x300» er nesten alltid betong
  if (AXIS_CONC_RE.test(s) || /^\s*\d{2,4}\s*[x×]\s*\d{2,4}\b/.test(objType || "")) return "COL_CONC";
  return "COL_OTHER";
}

// Hentes ved første trykk på 🔠 Akser, ikke ved lasting
export async function sikreAxisRaw() {
  if (S.axisRaw || S.modelID === null) return;
  try { S.axisRaw = await kall("axisSources"); } catch(_) { S.axisRaw = []; }
}

function classifyAxisSources() {
  S.axisSources = new Map();
  const add = (key, label, id) => {
    let g = S.axisSources.get(key);
    if (!g) { g = { label, ids: new Set() }; S.axisSources.set(key, g); }
    g.ids.add(id);
  };
  const handle = (t, id, objType, name) => {
    if (t === "COLUMN") { const k = axisColumnKey(objType, name); add(k, AXIS_COL_LABELS[k], id); }
    else if (t === "WALLSTANDARDCASE") add("WALL", AXIS_TYPE_LABELS.WALL, id);
    else if (AXIS_TYPE_LABELS[t]) add(t, AXIS_TYPE_LABELS[t], id);
  };
  if (S.glbActive) {
    if (S.glbProps && S.glbProps.size) {
      for (const [id, p] of S.glbProps)
        handle((p[2] || "").toUpperCase().replace(/^IFC/, ""), id, p[1], p[0]);
    } else if (S.glbColumns) {
      // eldre lett kopi uten props: kun søyleliste tilgjengelig
      for (const id of S.glbColumns) add("COL_OTHER", "Søyler", id);
    }
  } else if (S.modelID !== null) {
    // Lista ble hentet fra IFC-tråden da modellen ble åpnet (S.axisRaw),
    // slik at denne funksjonen kan holde seg synkron som før.
    for (const k of (S.axisRaw || [])) handle(k.t, k.id, k.objType, k.name);
  }
  // grupper med under 2 elementer kan ikke gi akselinjer
  for (const [k, g] of S.axisSources) if (g.ids.size < 2) S.axisSources.delete(k);
  // standardvalg: alle søylegrupper (som før), ellers den største gruppen
  S.axisSelection = new Set([...S.axisSources.keys()].filter(k => k.startsWith("COL_")));
  if (!S.axisSelection.size && S.axisSources.size) {
    let best = null;
    for (const k of S.axisSources.keys())
      if (!best || S.axisSources.get(k).ids.size > S.axisSources.get(best).ids.size) best = k;
    S.axisSelection.add(best);
  }
}

function sourceBoxes() {
  // Bounding box per element fra valgte kilder, i viewer-koordinater
  if (!S.axisSources) classifyAxisSources();
  const ids = new Set();
  for (const k of S.axisSelection) {
    const g = S.axisSources.get(k);
    if (g) for (const id of g.ids) ids.add(id);
  }
  if (!ids.size || !S.modelGroup) return [];
  if (S.lightLoaded) return [...lightElementBoxes(ids).values()];
  const boxes = new Map();
  S.modelGroup.traverse(o => {
    if (o.isMesh && ids.has(o.userData.expressID)) {
      const b = new THREE.Box3().setFromObject(o);
      const prev = boxes.get(o.userData.expressID);
      if (prev) prev.union(b); else boxes.set(o.userData.expressID, b);
    }
  });
  return [...boxes.values()];
}

function clusterAxes(vals, tol) {
  // Grupperer søyle-posisjoner som ligger på (nesten) samme linje
  vals.sort((a, b) => a.c - b.c);
  const groups = [];
  for (const v of vals) {
    const g = groups[groups.length - 1];
    if (g && v.c - g.items[g.items.length - 1].c <= tol) g.items.push(v);
    else groups.push({ items: [v] });
  }
  for (const g of groups) {
    g.c = g.items.reduce((s, i) => s + i.c, 0) / g.items.length; // senterlinje
    g.edgeMin = Math.min(...g.items.map(i => i.min));            // ytterkant (lav side)
    g.edgeMax = Math.max(...g.items.map(i => i.max));            // ytterkant (høy side)
    g.perpMin = Math.min(...g.items.map(i => i.pmin));           // hvor aksen starter (på tvers)
    g.perpMax = Math.max(...g.items.map(i => i.pmax));           // hvor aksen slutter (på tvers)
  }
  return groups.filter(g => g.items.length >= 2);
}

function axisLetter(i) {
  let s = "";
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

function buildAxes() {
  S.axesBuilt = true;
  if (!S.modelGroup || !S.modelBox) return;
  const boxes = sourceBoxes();
  if (boxes.length < 2) return;

  // mm eller meter? (geometrien følger filens enheter)
  // Aksene regner i MILLIMETER, ikke meter – derfor ganger vi opp.
  //   mm-modell:  enhetSkala 0,001 → toMM 1,    tol 400 mm
  //   m-modell:   enhetSkala 1     → toMM 1000, tol 0,4 m
  // Begge gir nøyaktig samme tall som den gamle gjetningen gjorde.
  const skala = S.enhetSkala || 1;
  const toMM = skala * 1000;                  // modellenheter → mm
  const tol = 0.4 / skala;                    // 400 mm, uttrykt i modellenheter

  // På store modeller: krev flere elementer per akse til vi er under taket (maks 50 per retning),
  // ellers drukner visningen i hundrevis av linjer og merkelapper
  function clusterCapped(vals) {
    let groups = clusterAxes(vals, tol);
    let minItems = 2;
    while (groups.length > 50 && minItems < 50) {
      minItems++;
      groups = groups.filter(g => g.items.length >= minItems);
    }
    return groups;
  }
  const xs = clusterCapped(boxes.map(b => ({ c: (b.min.x + b.max.x) / 2, min: b.min.x, max: b.max.x, pmin: b.min.z, pmax: b.max.z })));
  const zs = clusterCapped(boxes.map(b => ({ c: (b.min.z + b.max.z) / 2, min: b.min.z, max: b.max.z, pmin: b.min.x, pmax: b.max.x })));
  if (!xs.length && !zs.length) return;

  const one = 1 / skala;             // 1 meter i modellens enheter
  // Høyde: median av kildeelementenes underkant (ikke modellens bunn – terreng/peler
  // kan ligge langt under og ville lagt aksene under bygget)
  const yBottoms = boxes.map(b => b.min.y).sort((a, b) => a - b);
  const y = yBottoms[Math.floor(yBottoms.length / 2)] + S.modelSize * 0.002;
  const labelY = y + S.modelSize * 0.008;
  const TAG = 0.013; // skriftstørrelse akser/mål (mindre enn standard)
  const dashMat = new THREE.LineDashedMaterial({
    color: 0x8ab4ff, dashSize: one * 0.6, gapSize: one * 0.3,
    depthTest: false, transparent: true, opacity: 0.85
  });
  const dimMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, depthTest: false, transparent: true, opacity: 0.9 });

  function addLine(p1, p2, mat, dashed) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 990;
    axesGroup.add(line);
  }
  function addTag(text, pos, color, sizeF, dim) {
    const lab = makeLabel(text, color || "#8ab4ff", sizeF || TAG);
    lab.position.copy(pos); lab.position.y = labelY;
    lab.userData.axisTag = true;
    lab.userData.dim = !!dim; // mål-lapp (vises kun når man er nær nok)
    lab.userData.baseScale = { x: lab.scale.x, y: lab.scale.y };
    lab.scale.set(lab.scale.x * S.axisFontF, lab.scale.y * S.axisFontF, 1);
    axesGroup.add(lab);
  }
  // Merkelapp-størrelse krymper når naboaksene står tettere enn 5000 mm
  function tagSize(gapMM) {
    const f = Math.max(0.45, Math.min(1, gapMM / 5000));
    return TAG * f;
  }
  function neighborGap(groups, i) {
    let g = Infinity;
    if (i > 0) g = Math.min(g, groups[i].c - groups[i - 1].c);
    if (i < groups.length - 1) g = Math.min(g, groups[i + 1].c - groups[i].c);
    return (g === Infinity ? 5 * one : g) * toMM;
  }

  // Grenser for bygget – fra elementene som faktisk inngår i aksene,
  // slik at enkeltelementer langt utenfor ikke strekker linjene
  // (xs: edge = X-retning, perp = Z-retning · zs: edge = Z, perp = X)
  const minX = Math.min(...xs.map(g => g.edgeMin), ...zs.map(g => g.perpMin));
  const maxX = Math.max(...xs.map(g => g.edgeMax), ...zs.map(g => g.perpMax));
  const minZ = Math.min(...zs.map(g => g.edgeMin), ...xs.map(g => g.perpMin));
  const maxZ = Math.max(...zs.map(g => g.edgeMax), ...xs.map(g => g.perpMax));

  // Akselinjer stikker gjennom hele bygget + 1 m i hver ende
  xs.forEach((g, i) => {
    const s = tagSize(neighborGap(xs, i));
    addLine(new THREE.Vector3(g.c, y, minZ - one), new THREE.Vector3(g.c, y, maxZ + one), dashMat, true);
    addTag(String(i + 1), new THREE.Vector3(g.c, y, minZ - one), null, s);
    addTag(String(i + 1), new THREE.Vector3(g.c, y, maxZ + one), null, s);
  });
  zs.forEach((g, i) => {
    const s = tagSize(neighborGap(zs, i));
    addLine(new THREE.Vector3(minX - one, y, g.c), new THREE.Vector3(maxX + one, y, g.c), dashMat, true);
    addTag(axisLetter(i), new THREE.Vector3(minX - one, y, g.c), null, s);
    addTag(axisLetter(i), new THREE.Vector3(maxX + one, y, g.c), null, s);
  });

  // Målekjede på én rett linje 1 m utenfor bygget:
  // ytterkant ytterste søyle → senter-senter i mellom → ytterkant siste
  function dimChain(groups, dir, off) {
    if (groups.length < 2) return;
    const pts = groups.map((g, i) =>
      i === 0 ? g.edgeMin : (i === groups.length - 1 ? g.edgeMax : g.c));
    const mk = (v) => dir === "x"
      ? new THREE.Vector3(v, y, off)
      : new THREE.Vector3(off, y, v);
    const tick = one * 0.3;
    addLine(mk(pts[0]), mk(pts[pts.length - 1]), dimMat, false);
    for (const p of pts) {
      const t1 = mk(p), t2 = mk(p);
      if (dir === "x") { t1.z -= tick; t2.z += tick; } else { t1.x -= tick; t2.x += tick; }
      addLine(t1, t2, dimMat, false);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const mm = Math.round((pts[i + 1] - pts[i]) * toMM);
      addTag(String(mm), mk((pts[i] + pts[i + 1]) / 2), "#fbbf24", tagSize(mm), true);
    }
  }
  dimChain(xs, "x", minZ - one * 2.5); // tallakser: kjede utenfor akse-merkelappene
  dimChain(zs, "z", minX - one * 2.5); // bokstavakser
}

// Eksponert via S, ikke import: ui.js må kunne bygge aksene på nytt når
// enheten endres, uten at axes.js og ui.js importerer hverandre.
// Samme mønster som S.applyCubePos og S.pushAngre.
function rebuildAxes() {
  axesGroup.clear();
  buildAxes();
  if (!axesGroup.children.length)
    statusEl.textContent = t("Fant ikke nok elementer på linje til å lage akser fra valgt kilde");
}

function renderAxesPanel() {
  if (!S.axisSources) classifyAxisSources();
  let html = '<p style="color:var(--muted); font-size:12px; margin:0 0 8px">' + t("Velg hvilke elementtyper aksene lages fra:") + '</p>';
  if (!S.axisSources.size)
    html += '<p style="font-size:13px">' + t("Fant ingen egnede elementtyper (søyler, fundamenter, peler, vegger, bjelker) i modellen.") + '</p>';
  for (const [k, g] of S.axisSources) {
    html += '<label class="qty-row" style="cursor:pointer"><div class="n">' + esc(t(g.label)) +
      ' <span style="color:var(--muted);font-size:11px">(' + g.ids.size + ')</span></div>' +
      '<div class="c"><input type="checkbox" data-axsrc="' + esc(k) + '"' + (S.axisSelection.has(k) ? " checked" : "") + '></div></label>';
  }
  html += '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
    t("Mål-lappene (gule) vises først når du zoomer nær nok – det holder store modeller ryddige. Skriftstørrelsen justeres i Innstillinger (høyreklikk).") + '</p>';
  $("axesBody").innerHTML = html;
  $("axesBody").querySelectorAll("input[data-axsrc]").forEach(inp => {
    inp.onchange = (e) => {
      const k = e.target.dataset.axsrc;
      if (e.target.checked) S.axisSelection.add(k); else S.axisSelection.delete(k);
      rebuildAxes();
    };
  });
}

export function applyAxisFont() {
  for (const o of axesGroup.children)
    if (o.isSprite && o.userData.baseScale)
      o.scale.set(o.userData.baseScale.x * S.axisFontF, o.userData.baseScale.y * S.axisFontF, 1);
}

på("btnAxes", "click", async () => {
  if (!S.modelGroup) return;
  const panel = $("axesPanel");
  if (S.axesOn) {
    S.axesOn = false;
    axesGroup.visible = false;
    $("btnAxes").classList.remove("active");
    panel.classList.remove("open");
    return;
  }
  await sikreAxisRaw();          // kildelista hentes ved første bruk
  if (!S.axisSources) classifyAxisSources();
  if (!S.axesBuilt) rebuildAxes();
  renderAxesPanel();
  apnePanel("axesPanel");
  S.axesOn = true;
  axesGroup.visible = true;
  $("btnAxes").classList.add("active");
});

// oppdater aksenes detaljnivå hver frame
frameHooks.push(() => { if (axesGroup.visible) updateAxisLOD(); });

S.rebuildAxes = rebuildAxes;
