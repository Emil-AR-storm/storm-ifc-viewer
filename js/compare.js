// 🔄 Sammenlign to modeller (revisjonssjekk).
//
// Slik brukes den: åpne den GAMLE versjonen, trykk 🔄 Sammenlign (da tas et
// «avtrykk» av modellen), og åpne deretter den NYE versjonen – fra disk eller
// biblioteket. Endringene fargelegges og listes opp.
//
// Elementene kjennes igjen på IFC-ens GlobalId, som følger elementet mellom
// revisjoner. Mangler GlobalId-treff (noen eksportører lager nye hver gang),
// faller den tilbake på geometrisk match: type + posisjon + volum.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, på, S, apnePanel, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { guidFor, sikreMeta, typeFor } from "./ifcrpc.js";
import { alleElementIder } from "./ifc.js";
import { allElementBoxes, elemDisplayName, elementBoxById, fmtVol, quantitiesForSet, val, zoomToElement } from "./elements.js";
import { camera, controls, scene } from "./scene.js";

const COL = { ny: 0x3cb44b, slettet: 0xef4444, endret: 0xfbbf24, uendret: 0x6b7280 };
const MAT = {
  ny:      new THREE.MeshLambertMaterial({ color: COL.ny, side: THREE.DoubleSide }),
  endret:  new THREE.MeshLambertMaterial({ color: COL.endret, side: THREE.DoubleSide }),
  uendret: new THREE.MeshLambertMaterial({ color: COL.uendret, side: THREE.DoubleSide, transparent: true, opacity: 0.25, depthWrite: false })
};

// bokser i modellen: røde der elementer er BORTE i den nye versjonen,
// og på lette kopier (GLB) også grønne rundt nye og gule rundt endrede
const compareGroup = new THREE.Group();
scene.add(compareGroup);

// S.compareBase og S.compareOn er deklarert i state.js, som all annen S-tilstand
let result = null;      // { ny:[], slettet:[], endret:[], uendret:Set, metode }

// Fargefilter: overlappende bokser kan skjule hverandre, så radene i panelet
// kan trykkes for å vise ÉN farge om gangen. null = vis alle.
let boksFilter = null;  // null | "ny" | "slettet" | "endret"
const vis = (hva) => !boksFilter || boksFilter === hva;

// ---------- Avtrykk ----------
// Samler GlobalId, navn, type, senterpunkt, ytre mål og volum for hvert element.
function elementIds() {
  const ids = new Set();
  S.modelGroup.children.forEach(m => {
    if (m.userData.merged) (m.userData.ranges || []).forEach(r => ids.add(r.id));
    else if (m.userData.expressID !== undefined) ids.add(m.userData.expressID);
  });
  return ids;
}

// Begge leses fra hurtigbufferen som ble fylt rett etter lasting.
// På en lett kopi (GLB) finnes ingen IFC-tråd — da leses de fra props som
// ble bakt inn da kopien ble laget: [navn, objekttype, IfcType, materiale, GlobalId]
const guidOf = (id) => {
  if (S.glbActive) { const p = S.glbProps && S.glbProps.get(id); return (p && p[4]) || ""; }
  return guidFor(id);
};
const typeOf = (id) => {
  if (S.glbActive) { const p = S.glbProps && S.glbProps.get(id); return (p && p[2]) || ""; }
  return typeFor(id);
};

export async function snapshotModel() {
  await sikreMeta(alleElementIder);
  // Lette kopier (GLB) KAN sammenlignes: siden v4 bærer de GlobalId i props,
  // og volum regnes fra trekantene. Kommentaren under var sann da den ble
  // skrevet — før GlobalId ble lagret i den lette kopien.
  if (!S.modelGroup || (S.modelID === null && !S.glbActive)) return null;
  const ids = elementIds();
  const boxes = allElementBoxes();
  const vols = quantitiesForSet(ids);
  // quantitiesForSet gir Map<id, {dims, vol, area}> – et OBJEKT, ikke et tall.
  // Før sto det «vols.get(id) || 0» her, så v ble selve objektet. Da gav
  // Math.round(v * 1000) i geoKey NaN, og volumsjekken dVol > 0.005 i diff()
  // var alltid false: «volum 2,4 → 3,1 m³» har aldri slått ut i sammenligningen.
  const volAv = (id) => { const q = vols.get(id); return (q && q.vol) || 0; };
  const items = new Map();   // nøkkel → data
  let withGuid = 0;
  for (const id of ids) {
    const b = boxes.get(id);
    if (!b) continue;
    const c = b.getCenter(new THREE.Vector3());
    const d = b.getSize(new THREE.Vector3());
    const guid = guidOf(id);
    if (guid) withGuid++;
    items.set(guid || ("geo:" + geoKey(c, d, volAv(id))), {
      id, guid, name: elemDisplayName(id), type: typeOf(id),
      c: [c.x, c.y, c.z], d: [d.x, d.y, d.z], v: volAv(id)
    });
  }
  return { file: S.fileName, items, withGuid, count: ids.size, size: S.modelSize };
}

// Geometrisk nøkkel til reservematching: posisjon rundet til 5 cm + volum
function geoKey(c, d, v) {
  const r = (n) => Math.round(n / 0.05);
  return r(c.x) + "|" + r(c.y) + "|" + r(c.z) + "|" + Math.round(v * 1000);
}

// ---------- Sammenligning ----------
// Nøkler alle elementer på geometri i stedet for GlobalId. Brukes som reserve
// når prosjekterende har eksportert på nytt uten å bevare GlobalId-ene – da ville
// alt ellers dukket opp som «nytt» og «slettet» samtidig.
function rekeyGeo(items) {
  const m = new Map();
  for (const e of items.values()) {
    const r = (n) => Math.round(n / 0.05);
    const key = (e.type || "") + "|" + r(e.c[0]) + "|" + r(e.c[1]) + "|" + r(e.c[2]) + "|" + Math.round(e.v * 1000);
    if (!m.has(key)) m.set(key, e);   // kolliderer to like elementer, tas første
  }
  return m;
}

function diff(baseItems, nowItems, tol) {
  const ny = [], slettet = [], endret = [], uendret = new Set();
  for (const [key, e] of nowItems) {
    const b = baseItems.get(key);
    if (!b) { ny.push(e); continue; }
    const flyttet = Math.hypot(e.c[0] - b.c[0], e.c[1] - b.c[1], e.c[2] - b.c[2]);
    const dMax = Math.max(...[0, 1, 2].map(i => Math.abs(e.d[i] - b.d[i])));
    const dVol = b.v ? Math.abs(e.v - b.v) / Math.abs(b.v) : (e.v ? 1 : 0);
    if (flyttet > tol || dMax > tol || dVol > 0.005) {
      endret.push(Object.assign({}, e, { fra: b, flyttet, dMax, dVol }));
    } else uendret.add(e.id);
  }
  for (const [key, b] of baseItems) if (!nowItems.has(key)) slettet.push(b);
  return { ny, slettet, endret, uendret };
}

export function compare(base, now) {
  const tol = Math.max(now.size * 2e-5, 0.001);   // ~3 mm på et 150 m bygg
  const minst = Math.max(1, Math.min(base.items.size, now.items.size));

  // 1) match på GlobalId (nøkler uten "geo:"-prefiks)
  const guidTreff = [...now.items.keys()].filter(k => !k.startsWith("geo:") && base.items.has(k)).length;
  let r = diff(base.items, now.items, tol);
  let metode = "GlobalId";

  // 2) traff GlobalId dårlig? prøv geometrisk match og behold det beste resultatet
  if (guidTreff < minst * 0.2) {
    const geo = diff(rekeyGeo(base.items), rekeyGeo(now.items), tol);
    const treffGeo = geo.uendret.size + geo.endret.length;
    const treffGuid = r.uendret.size + r.endret.length;
    if (treffGeo > treffGuid) { r = geo; metode = "geometri"; }
  }

  const sorter = (a, c) => (a.type || "").localeCompare(c.type || "") || (a.name || "").localeCompare(c.name || "");
  r.ny.sort(sorter); r.endret.sort(sorter); r.slettet.sort(sorter);
  const treff = r.uendret.size + r.endret.length;
  return Object.assign(r, { metode, usikker: treff < minst * 0.5 });
}

// ---------- Visning ----------
function paint() {
  compareGroup.clear();
  // røde bokser der noe er fjernet
  if (vis("slettet")) for (const e of result.slettet) {
    const c = new THREE.Vector3(...e.c), d = new THREE.Vector3(...e.d);
    const box = new THREE.Box3().setFromCenterAndSize(c, d.max(new THREE.Vector3(0.05, 0.05, 0.05)));
    const h = new THREE.Box3Helper(box, COL.slettet);
    h.material.depthTest = false;
    h.renderOrder = 996;
    compareGroup.add(h);
  }
  // Sammenslått geometri (lett kopi) kan ikke fargelegges per element.
  // I stedet tegnes bokser rundt elementene – grønn rundt nye, gul rundt
  // endrede – på samme måte som de røde over. Boksene hentes fra modellen
  // som er lastet nå (den nye versjonen), der begge gruppene finnes.
  if (S.lightLoaded) {
    const boxes = allElementBoxes();
    const tegnBokser = (arr, farge) => {
      for (const e of arr) {
        const b = boxes.get(e.id);
        if (!b) continue;
        const c = b.getCenter(new THREE.Vector3());
        const d = b.getSize(new THREE.Vector3());
        const box = new THREE.Box3().setFromCenterAndSize(c, d.max(new THREE.Vector3(0.05, 0.05, 0.05)));
        const h = new THREE.Box3Helper(box, farge);
        h.material.depthTest = false;
        h.renderOrder = 996;
        compareGroup.add(h);
      }
    };
    if (vis("ny")) tegnBokser(result.ny, COL.ny);
    if (vis("endret")) tegnBokser(result.endret, COL.endret);
    return;
  }
  const status = new Map();
  result.ny.forEach(e => status.set(e.id, "ny"));
  result.endret.forEach(e => status.set(e.id, "endret"));
  S.modelGroup.children.forEach(m => {
    const st = status.get(m.userData.expressID);
    m.material = (st && vis(st)) ? MAT[st] : MAT.uendret;
  });
}

function unpaint() {
  compareGroup.clear();
  if (S.modelGroup && !S.lightLoaded)
    S.modelGroup.children.forEach(m => { if (m.userData.origMat) m.material = m.userData.origMat; });
}

function endre(e) {
  const d = [];
  if (e.flyttet > 0) d.push(t("flyttet ") + mm(e.flyttet));
  if (e.dMax > 0) d.push(t("mål endret ") + mm(e.dMax));
  if (e.dVol > 0.005) d.push(t("volum ") + fmtVol(e.fra.v) + " → " + fmtVol(e.v));
  return d.join(" · ");
}
const mm = (m) => m >= 1 ? m.toFixed(2) + " m" : Math.round(m * 1000) + " mm";

function renderPanel() {
  apnePanel("comparePanel");

  if (!result) {
    const base = S.compareBase;
    $("compareBody").innerHTML = base
      ? '<p style="font-size:13px">' + t("Avtrykk tatt av <b>{0}</b> ({1} elementer).", esc(base.file), base.count) + '</p>' +
        '<p style="color:var(--muted); font-size:12px; margin-top:8px">' +
        t("Åpne nå den nye versjonen – med Åpne eller Biblioteket. Endringene fargelegges automatisk når modellen er lastet.") + '</p>' +
        '<div class="prop-actions" style="margin-top:12px"><button id="cmpAvbryt">' + t("Avbryt sammenligning") + '</button></div>'
      : '<p style="font-size:13px">' + t("Fikk ikke lest modellen for sammenligning – er dette en svært gammel lett kopi uten elementdata?") + '</p>';
    if ($("cmpAvbryt")) $("cmpAvbryt").onclick = stopCompare;
    return;
  }

  const r = result;
  let html = '<div class="prop-actions">' +
    '<button id="cmpOnlyChanged">' + ikon("vis") + ' ' + t("Bare endringer") + '</button>' +
    '<button id="cmpStopp">' + ikon("lukk") + ' ' + t("Avslutt") + '</button></div>' +
    '<p style="font-size:12px; color:var(--muted); margin-bottom:8px">' +
    esc(S.compareBase.file) + ' → ' + esc(S.fileName) +
    t(" · gjenkjent på ") + r.metode + '</p>' +
    (r.usikker ? '<p style="font-size:12px; color:var(--accent2); margin-bottom:8px">' + ikon("advarsel") + ' ' + t("Under halvparten av elementene lot seg parre. Er dette to versjoner av samme modell? Ellers har eksporten byttet både GlobalId og geometri.") + '</p>' : '') +
    // Radene under er også FILTER: overlappende bokser kan skjule hverandre,
    // så et trykk på Nye/Slettet/Endret viser bare den fargen i modellen.
    // «Se alle» (eller et nytt trykk på samme rad) viser alt igjen.
    '<div class="qty-row cmp-filter" data-filter="" style="cursor:pointer"><div class="n">' + ikon("vis") + ' ' + t("Se alle") + '</div><div class="c"></div></div>' +
    '<div class="qty-row cmp-filter" data-filter="ny" style="cursor:pointer"><div class="n"><span style="color:var(--ok)">●</span> ' + t("Nye") + '</div><div class="c">' + r.ny.length + '</div></div>' +
    '<div class="qty-row cmp-filter" data-filter="slettet" style="cursor:pointer"><div class="n"><span style="color:var(--danger)">●</span> ' + t("Slettet") + '</div><div class="c">' + r.slettet.length + '</div></div>' +
    '<div class="qty-row cmp-filter" data-filter="endret" style="cursor:pointer"><div class="n"><span style="color:#fbbf24">●</span> ' + t("Endret") + '</div><div class="c">' + r.endret.length + '</div></div>' +
    '<div class="qty-row"><div class="n">' + t("Uendret") + '</div><div class="c">' + r.uendret.size + '</div></div>';

  if (!r.ny.length && !r.slettet.length && !r.endret.length)
    html += '<p style="margin-top:12px; font-size:13px">' + ikon("hake") + ' ' + t("Ingen forskjeller funnet.") + '</p>';

  const liste = (tittel, arr, farge, type) => {
    if (!arr.length) return "";
    let h = '<h4 style="margin:12px 0 4px; font-size:12px; color:' + farge + '">' + tittel + ' (' + arr.length + ')</h4>';
    arr.slice(0, 300).forEach((e, i) => {
      h += '<div class="lib-item" data-cmp="' + type + ':' + i + '">' +
        '<div class="n">' + esc(e.name || ("ID " + e.id)) + '</div>' +
        '<div class="m">' + esc(e.type || "") +
        (type === "endret" ? " · " + esc(endre(e)) : "") +
        (type === "slettet" ? t(" · fantes i forrige versjon") : "") + '</div></div>';
    });
    if (arr.length > 300) h += '<p style="color:var(--muted); font-size:11px">' + t("… og {0} flere", arr.length - 300) + '</p>';
    return h;
  };
  html += liste(t("Endret"), r.endret, "#fbbf24", "endret") +
          liste(t("Nye"), r.ny, "#3cb44b", "ny") +
          liste(t("Slettet"), r.slettet, "#ef4444", "slettet");

  $("compareBody").innerHTML = html;
  $("cmpStopp").onclick = stopCompare;
  // fargefilteret: marker aktiv rad og tegn boksene på nytt
  const merkFilter = () => {
    $("compareBody").querySelectorAll(".cmp-filter").forEach(el => {
      const aktiv = (el.dataset.filter || null) === boksFilter;
      el.style.background = aktiv ? "rgba(128,128,128,.25)" : "";
      el.style.borderRadius = aktiv ? "6px" : "";
    });
  };
  $("compareBody").querySelectorAll(".cmp-filter").forEach(el => {
    el.onclick = () => {
      const valgt = el.dataset.filter || null;
      boksFilter = (boksFilter === valgt) ? null : valgt;   // samme rad igjen = vis alle
      paint();
      merkFilter();
    };
  });
  merkFilter();
  $("cmpOnlyChanged").onclick = () => {
    const skjul = !$("cmpOnlyChanged").classList.contains("active");
    $("cmpOnlyChanged").classList.toggle("active", skjul);
    if (S.lightLoaded) return;
    S.modelGroup.children.forEach(m => {
      if (m.material === MAT.uendret) m.visible = !skjul;
    });
  };
  $("compareBody").querySelectorAll("[data-cmp]").forEach(el => {
    el.onclick = () => {
      const [type, i] = el.dataset.cmp.split(":");
      const e = result[type][Number(i)];
      if (type === "slettet") {
        // ingen geometri å velge – flytt kameraet til der elementet lå
        const c = new THREE.Vector3(...e.c);
        controls.target.copy(c);
        const dir = camera.position.clone().sub(c);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
        camera.position.copy(c).add(dir.normalize().multiplyScalar(Math.max(new THREE.Vector3(...e.d).length() * 2.5, S.modelSize * 0.02)));
      } else if (elementBoxById(e.id)) zoomToElement(e.id);
    };
  });
}

// ---------- ⛓ Deling av en sammenligning ----------
// Bare det panelet og fargeleggingen trenger sendes. Uendrede elementer trengs
// ikke som liste – de fargelegges som «alt som ikke er nytt eller endret» – så
// bare antallet følger med. Slettede elementer finnes ikke i mottakerens modell,
// derfor må senter og mål med, ellers kan ikke de røde boksene tegnes.
const r3 = (n) => Math.round(n * 1000) / 1000;
const r5 = (n) => Math.round(n * 100000) / 100000;

export function collectCompare(slim) {
  if (!S.compareOn || !result) return null;
  const c = {
    b: (S.compareBase && S.compareBase.file) || "forrige versjon",
    m: result.metode,
    ue: result.uendret.size
  };
  if (result.usikker) c.u = 1;
  if (slim) {
    // uten navn og mål: bare nok til å fargelegge og vise antall
    c.n = result.ny.map(e => [e.id]);
    c.e = result.endret.map(e => [e.id]);
    c.d = result.slettet.map(e => ["", "", r3(e.c[0]), r3(e.c[1]), r3(e.c[2]), r3(e.d[0]), r3(e.d[1]), r3(e.d[2])]);
    c.slim = 1;
  } else {
    c.n = result.ny.map(e => [e.id, e.name || "", e.type || ""]);
    c.e = result.endret.map(e => [e.id, e.name || "", e.type || "",
      r5(e.flyttet || 0), r5(e.dMax || 0), r5(e.dVol || 0), r3((e.fra && e.fra.v) || 0), r3(e.v || 0)]);
    c.d = result.slettet.map(e => [e.name || "", e.type || "",
      r3(e.c[0]), r3(e.c[1]), r3(e.c[2]), r3(e.d[0]), r3(e.d[1]), r3(e.d[2])]);
  }
  return c;
}

export function applySharedCompare(c) {
  if (!c || !S.modelGroup) return;
  S.compareBase = { file: c.b || "forrige versjon", count: 0 };
  result = {
    metode: c.m || "GlobalId",
    usikker: !!c.u,
    uendret: { size: c.ue || 0 },   // bare antallet trengs (renderPanel leser .size)
    ny: (c.n || []).map(a => ({ id: a[0], name: a[1] || "", type: a[2] || "" })),
    endret: (c.e || []).map(a => ({
      id: a[0], name: a[1] || "", type: a[2] || "",
      flyttet: a[3] || 0, dMax: a[4] || 0, dVol: a[5] || 0,
      fra: { v: a[6] || 0 }, v: a[7] || 0
    })),
    slettet: (c.d || []).map(a => ({
      name: a[0] || "", type: a[1] || "",
      c: [a[2], a[3], a[4]], d: [a[5], a[6], a[7]]
    }))
  };
  boksFilter = null;
  S.compareOn = true;
  $("btnCompare").classList.add("active");
  paint();
  renderPanel();
  if (c.slim) {
    $("compareBody").insertAdjacentHTML("afterbegin",
      '<p style="font-size:11px; color:var(--accent2); margin-bottom:8px">' +
      t("Lenka var for stor til å ta med navn og mål – fargene og antallene stemmer, men lista er uten detaljer.") + '</p>');
  }
}

// ---------- Start / stopp ----------
async function startSnapshot() {
  loadingText.textContent = t("Leser modellen …");
  loadingEl.classList.add("open");
  const snap = await snapshotModel();
  loadingEl.classList.remove("open");
  if (!snap) {
    S.compareBase = null;
    renderPanel();
    return;
  }
  S.compareBase = snap;
  result = null;
  renderPanel();
}

export function stopCompare() {
  S.compareOn = false;
  S.compareBase = null;
  result = null;
  boksFilter = null;
  unpaint();
  if (S.modelGroup) S.modelGroup.children.forEach(m => m.visible = true);
  $("comparePanel").classList.remove("open");
  $("btnCompare").classList.remove("active");
}

// Kalles fra ifc.js hver gang en modell er ferdig lastet
S.onModelLoaded = async () => {
  compareGroup.clear();
  const base = S.compareBase;
  if (!base || base.file === S.fileName) return;
  loadingText.textContent = t("Sammenligner versjoner …");
  loadingEl.classList.add("open");
  const now = await snapshotModel();
  loadingEl.classList.remove("open");
  if (!now) return;
  result = compare(base, now);
  boksFilter = null;   // ny sammenligning starter alltid med alle fargene
  S.compareOn = true;
  $("btnCompare").classList.add("active");
  paint();
  renderPanel();
};

på("btnCompare", "click", () => {
  if (!S.modelGroup) return;
  if (S.compareOn || S.compareBase) { stopCompare(); return; }
  $("btnCompare").classList.add("active");
  startSnapshot();
});
