// Utseende: transparent, skjul/vis og fargelegging per elementtype.
import * as THREE from "three";
import { $, DEFAULT_APPEAR, på, S, apnePanel, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { clearSelection } from "./elements.js";
import { sikreMeta, typeFor } from "./ifcrpc.js";
import { alleElementIder } from "./ifc.js";
import { saveAppear, saveBg, syncHiddenTypes } from "./prefs.js";
import { oppdaterOutline, outlineAktiv } from "./outline.js";
import { scene } from "./scene.js";

// ---------- Transparent (ghost) ----------

const ghostCache = new Map();

// Det gjennomsiktige materialet for et mesh, laget én gang per originalmateriale.
// Skilt ut så settVisning() kan bruke nøyaktig samme materiale som setGhost().
function ghostMat(m) {
  if (!ghostCache.has(m.userData.origMat)) {
    const g = m.userData.origMat.clone();
    g.transparent = true; g.opacity = 0.25; g.depthWrite = false;
    ghostCache.set(m.userData.origMat, g);
  }
  return ghostCache.get(m.userData.origMat);
}

// silent = ikke lagre i brukerens eget oppsett (brukes av delte visningslenker)
export function setGhost(on, silent) {
  if (!S.modelGroup) return;
  clearSelection();
  $("propPanel").classList.remove("open");
  S.ghostOn = on;
  $("btnGhost").classList.toggle("active", S.ghostOn);
  // transparent overtar materialene, så fargelegging per type er ikke lenger på.
  // Uten dette ble S.typeColorsOn hengende igjen som «true» og lurte bl.a. ⛓-lenka.
  if (S.ghostOn) S.typeColorsOn = false;
  if (!silent) {
    S.appear.ghost = S.ghostOn;
    if (S.ghostOn) S.appear.typeColorsOn = false;
    saveAppear();
  }
  S.modelGroup.children.forEach(m => {
    m.material = S.ghostOn ? ghostMat(m)
      : (S.lettFargerPå && m.userData.merged && m.userData.fargeMat ? m.userData.fargeMat : m.userData.origMat);
  });
}

på("btnGhost", "click", () => {
  const før = visningsAvtrykk();
  setGhost(!S.ghostOn);
  meldAngre(før, S.ghostOn ? "Gjennomsiktig på" : "Gjennomsiktig av");
});

// ---------- Skjul / vis ----------
export const hiddenIDs = new Set();

// 🎨 Id-er skjult via TYPE-raden i lav kvalitet. Egen mengde, ikke hiddenIDs:
// da kan «vis type» aldri dra med seg elementer noen har skjult enkeltvis.
export const typeSkjultLett = new Set();

// Skjuler et helt sett i ÉN gjennomgang av meshene. Å kalle hideElement per
// element ville gått gjennom hele modellen én gang per id – med noen hundre
// markerte elementer i en modell på tusenvis blir det merkbart tregt.
export function hideElements(ider) {
  const sett = ider instanceof Set ? ider : new Set(ider);
  if (!sett.size || !S.modelGroup) return;
  // Bare de som faktisk BLIR skjult av dette kallet skal vises igjen ved angre.
  // Var noen skjult fra før, skal de forbli skjult.
  const nye = [...sett].filter(id => !hiddenIDs.has(id));
  sett.forEach(id => hiddenIDs.add(id));
  S.modelGroup.children.forEach(m => { if (sett.has(m.userData.expressID)) m.visible = false; });
  synkMergedSkjuling();
  clearSelection();   // tømmer også S.multiSel – de skjulte skal ikke bli liggende i utvalget
  $("propPanel").classList.remove("open");
  $("btnShowAll").style.display = "";
  if (nye.length && S.pushAngre) S.pushAngre({
    tekst: nye.length === 1 ? "Skjul element" : "Skjul flere element",
    angre: () => showElements(nye),
    gjenopprett: () => hideElements(nye)
  });
}

export function hideElement(expressID) { hideElements([expressID]); }

// ---------- Skjul i SAMMENSLÅTT geometri (🪶 lav kvalitet / lett kopi) ----------
// Ett merged mesh inneholder mange elementer, så visible-flagget kan ikke
// skjule ett av dem — det var derfor Skjul var avslått i lav kvalitet, ikke
// filstørrelsen. Løsningen: trekantene til de skjulte elementene KOLLAPSES —
// indeksene i elementets range settes til 0, som gir trekanter uten areal.
// De verken tegnes eller treffes av raycast. Indeksens LENGDE og rangene
// endres ALDRI, så alle offset-baserte invarianter består (hitID,
// selectElement, mengder). Originalindeksen ligger i userData.origIndex og
// legges tilbake spenn for spenn når elementet vises igjen.
export function synkMergedSkjuling() {
  if (!S.modelGroup) return;
  S.modelGroup.children.forEach(m => {
    if (!m.userData.merged) return;
    const ranges = m.userData.ranges || [];
    const idx = m.geometry.getIndex();
    if (!idx) return;
    const erSkjult = (id) => hiddenIDs.has(id) || typeSkjultLett.has(id);
    const harSkjulte = ranges.some(r => erSkjult(r.id));
    if (!harSkjulte && !m.userData.origIndex) return;   // aldri rørt — ingenting å gjøre
    if (!m.userData.origIndex) m.userData.origIndex = idx.array.slice();
    const orig = m.userData.origIndex, arr = idx.array;
    for (const r of ranges) {
      if (erSkjult(r.id)) arr.fill(0, r.start, r.start + r.count);
      else arr.set(orig.subarray(r.start, r.start + r.count), r.start);
    }
    idx.needsUpdate = true;
  });
}

// Motstykket til hideElements – brukes av ↩ Angre. Et element skal bare bli
// synlig igjen hvis TYPEN det hører til ikke er skjult i 🎨 Utseende; ellers
// ville angre av «Skjul element» også slått på en type brukeren har skjult.
export function showElements(ider) {
  const sett = ider instanceof Set ? ider : new Set(ider);
  if (!sett.size) return;
  sett.forEach(id => hiddenIDs.delete(id));
  const typeSkjult = new Set();
  if (S.typeInfo) for (const [, g] of S.typeInfo) if (g.hidden) g.meshes.forEach(m => typeSkjult.add(m));
  if (S.modelGroup) S.modelGroup.children.forEach(m => {
    if (sett.has(m.userData.expressID)) m.visible = !typeSkjult.has(m);
  });
  synkMergedSkjuling();
  oppdaterVisAlle();
  if ($("colorPanel").classList.contains("open") && S.typeInfo) renderColorPanel();
}

// «Vis alle» skal stå framme så lenge NOE er skjult – enkeltelement eller type.
// Lå før som en kopiert enlinjes tre steder, og de tre var ikke like.
export function oppdaterVisAlle() {
  const noeSkjult = hiddenIDs.size > 0 || typeSkjultLett.size > 0 ||
    (S.typeInfo ? [...S.typeInfo.values()].some(g => g.hidden) : false) ||
    // 👁 En skjult MARKERING teller også. Uten dette sto «Vis alle» borte mens
    // tre bobler var skjult, og det fantes ingen ett-klikks vei tilbake.
    !!(S.markeringNoeSkjult && S.markeringNoeSkjult());
  $("btnShowAll").style.display = noeSkjult ? "" : "none";
}

// Kroker markers.js leser. Settes her fordi display.js eier «Vis alle» og
// 🎨-panelet — markers.js kan ikke importere denne fila (sirkel via ifc.js).
S.oppdaterVisAlle = oppdaterVisAlle;
S.tegnUtseendePanel = () => {
  if (!$("colorPanel") || !$("colorPanel").classList.contains("open")) return;
  if (S.lightLoaded) { if (S.typeInfoLett) renderColorPanelLett(); }
  else if (S.typeInfo) renderColorPanel();
};

på("btnShowAll", "click", () => {
  // Avtrykk FØR: «Vis alle» kan gjøre om en hel dags skjuling på ett klikk
  const før = visningsAvtrykk();
  hiddenIDs.clear();
  typeSkjultLett.clear();
  if (S.typeInfo) for (const [, g] of S.typeInfo) g.hidden = false;
  if (S.typeInfoLett) for (const [, g] of S.typeInfoLett) g.hidden = false;
  S.appear.hiddenTypes = []; saveAppear();
  if (S.modelGroup) S.modelGroup.children.forEach(m => m.visible = true);
  synkMergedSkjuling();
  if ($("colorPanel").classList.contains("open") && S.lightLoaded && S.typeInfoLett) renderColorPanelLett();
  $("btnShowAll").style.display = "none";
  if (S.visAlleMarkeringer) S.visAlleMarkeringer();   // 👁 markeringene med
  if ($("colorPanel").classList.contains("open")) renderColorPanel();
  meldAngre(før, "Vis alle");
});

// ---------- ↩ Avtrykk av visningen (til angre/gjenopprett) ----------
// Dekker skjuling, typefarger, gjennomsiktig og bakgrunn – alt som «Originalfarger»
// nullstiller på ett klikk. Kun verdier, aldri objektreferanser: S.typeInfo
// bygges på nytt ved modellbytte.
export function visningsAvtrykk() {
  return {
    skjulteIder: [...hiddenIDs],
    lettTyperSkjult: S.typeInfoLett ? [...S.typeInfoLett].filter(([, g]) => g.hidden).map(([k]) => k) : [],
    skjulteTyper: S.typeInfo ? [...S.typeInfo].filter(([, g]) => g.hidden).map(([k]) => k) : [],
    farger: S.typeInfo ? Object.fromEntries([...S.typeInfo].map(([k, g]) => [k, g.color])) : {},
    typeColorsOn: S.typeColorsOn,
    ghostOn: S.ghostOn,
    bg: "#" + scene.background.getHexString()
  };
}

export function settVisning(a) {
  if (!a) return;
  scene.background.set(a.bg);
  saveBg(a.bg);
  if (S.typeInfo) {
    const skjult = new Set(a.skjulteTyper);
    for (const [key, g] of S.typeInfo) {
      g.hidden = skjult.has(key);
      if (a.farger[key]) { g.color = a.farger[key]; g.mat.color.set(a.farger[key]); }
    }
    S.appear.colors = Object.assign({}, a.farger);
  }
  hiddenIDs.clear();
  a.skjulteIder.forEach(id => hiddenIDs.add(id));
  typeSkjultLett.clear();
  if (S.typeInfoLett) {
    const sk = new Set(a.lettTyperSkjult || []);
    for (const [k, g] of S.typeInfoLett) {
      g.hidden = sk.has(k);
      if (g.hidden) g.ids.forEach(id => typeSkjultLett.add(id));
    }
  }
  synkMergedSkjuling();

  // Materialene settes i én gjennomgang: ghost > typefarger > original.
  // Rekkefølgen er den samme som setGhost/applyTypeColors bruker hver for seg.
  S.typeColorsOn = a.typeColorsOn && !a.ghostOn;
  S.ghostOn = a.ghostOn;
  $("btnGhost").classList.toggle("active", S.ghostOn);
  if (S.modelGroup) {
    const typeAv = new Map();
    if (S.typeInfo) for (const [, g] of S.typeInfo) g.meshes.forEach(m => typeAv.set(m, g));
    S.modelGroup.children.forEach(m => {
      const g = typeAv.get(m);
      m.material = S.ghostOn ? ghostMat(m) : (S.typeColorsOn && g ? g.mat : m.userData.origMat);
      m.visible = !hiddenIDs.has(m.userData.expressID) && !(g && g.hidden);
    });
  }
  S.appear.ghost = S.ghostOn;
  S.appear.typeColorsOn = S.typeColorsOn;
  syncHiddenTypes();
  saveAppear();
  oppdaterVisAlle();
  if ($("colorPanel").classList.contains("open") && S.typeInfo) renderColorPanel();
}

// Melder en visningsendring til angre-stabelen. Avtrykket ETTER tas her, så
// kallstedet bare trenger å ta vare på avtrykket FØR.
function meldAngre(før, tekst) {
  if (!S.pushAngre) return;
  const etter = visningsAvtrykk();
  S.pushAngre({ tekst, angre: () => settVisning(før), gjenopprett: () => settVisning(etter) });
}

// ---------- Fargeinnstillinger (per elementtype) ----------
export const DEFAULT_BG = "#14181f";

const TYPE_LABELS = {
  COLUMN: "Søyler", BEAM: "Bjelker", SLAB: "Dekker", WALL: "Vegger",
  WALLSTANDARDCASE: "Vegger", MEMBER: "Stag/sperrer", PLATE: "Plater",
  DOOR: "Dører", WINDOW: "Vinduer", ROOF: "Tak", STAIR: "Trapper",
  STAIRFLIGHT: "Trappeløp", RAILING: "Rekkverk", FOOTING: "Fundamenter",
  PILE: "Peler", COVERING: "Kledning", CURTAINWALL: "Glassfasader",
  MECHANICALFASTENER: "Festemidler", FASTENER: "Festemidler",
  FLOWSEGMENT: "Rør/kanaler", BUILDINGELEMENTPROXY: "Annet"
};

const PALETTE = ["#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4",
  "#46f0f0","#f032e6","#bcf60c","#008080","#e6beff","#9a6324","#fffac8",
  "#800000","#aaffc3","#ffd8b1"];

export function buildTypeInfo() {
  S.typeInfo = new Map();
  const idType = new Map();
  S.modelGroup.children.forEach(m => {
    const id = m.userData.expressID;
    if (!idType.has(id)) {
      const tp = typeFor(id) || "UKJENT";
      idType.set(id, tp.toUpperCase().replace(/^IFC/, ""));
    }
    const key = idType.get(id);
    if (!S.typeInfo.has(key)) {
      const color = S.appear.colors[key] || PALETTE[S.typeInfo.size % PALETTE.length];
      S.typeInfo.set(key, {
        label: TYPE_LABELS[key] || key,
        meshes: [],
        color,
        hidden: S.appear.hiddenTypes.includes(key),
        mat: new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
      });
    }
    S.typeInfo.get(key).meshes.push(m);
  });
}

export function applyTypeColors(silent) {
  clearSelection();
  $("propPanel").classList.remove("open");
  S.ghostOn = false;
  $("btnGhost").classList.remove("active");
  S.typeColorsOn = true;
  for (const [, g] of S.typeInfo) g.meshes.forEach(m => m.material = g.mat);
  if (!silent) {
    S.appear.typeColorsOn = true;
    S.appear.ghost = false;
    saveAppear();
  }
}

export function resetColors() {
  // Den mest destruktive knappen i verktøyet: sletter farger, skjuling,
  // gjennomsiktig og bakgrunn på ett klikk. Avtrykk før noe som helst røres.
  const før = visningsAvtrykk();
  scene.background.set(DEFAULT_BG);
  saveBg(DEFAULT_BG);
  S.typeColorsOn = false;
  S.ghostOn = false;
  $("btnGhost").classList.remove("active");
  if (S.modelGroup) {
    clearSelection();
    S.modelGroup.children.forEach(m => { m.material = m.userData.origMat; m.visible = true; });
  }
  hiddenIDs.clear();
  synkMergedSkjuling();
  if (S.typeInfo) for (const [, g] of S.typeInfo) g.hidden = false;
  $("btnShowAll").style.display = "none";
  // Egne, tomme lister – ikke de som ligger i DEFAULT_APPEAR. Object.assign
  // kopierer referansen, og neste push hadde endret standardverdien for alltid.
  S.appear = Object.assign({}, DEFAULT_APPEAR, { colors: {}, hiddenTypes: [], outlineTypes: [] });
  saveAppear();
  oppdaterOutline();          // ▣ kantlinjene per type følger med i nullstillingen
  renderColorPanel();
  meldAngre(før, "Originalfarger");
}

// ---------- 🎨 Utseende i SAMMENSLÅTT geometri (🪶 lav kvalitet / lett kopi) ----------
// Panelet viste før bare bakgrunnen i lav kvalitet. Nå (26.08.2026):
//  · SKJUL/VIS PER TYPE rir på kollaps-mekanikken (synkMergedSkjuling):
//    typens id-er legges i typeSkjultLett og trekantene kollapses.
//  · FARGELEGG ETTER TYPE males som farger per punkt (vertex-farger): hvert
//    sammenslått mesh får et fargeattributt, og hvert elementrange males i
//    typens farge. Punkter i sveiste sømmer deles av naboelementer, så en
//    hårfin fargeblødning i kontaktflatene kan skje — kosmetisk, ikke feil.
//  · Kantlinjer per type finnes fortsatt bare i full kvalitet (kantgeometri
//    per element i sammenslåtte mesh er for tungt på store modeller).

// Typenøkkelen for et element: fra GLB-egenskapene på byggeplassen, fra
// IFC-tråden (metaFor) i 🪶 på kontoret.
function lettTypeKey(id) {
  let tn = "";
  if (S.glbProps && S.glbProps.size) {
    const p = S.glbProps.get(id);
    tn = (p && p[2]) || "";
  } else {
    tn = typeFor(id) || "";
  }
  return (tn || "UKJENT").toUpperCase().replace(/^IFC/, "");
}

async function byggTypeInfoLett() {
  if (S.typeInfoLett) return;
  if (!(S.glbProps && S.glbProps.size)) await sikreMeta(alleElementIder);
  S.typeInfoLett = new Map();
  for (const id of alleElementIder()) {
    const key = lettTypeKey(id);
    let g = S.typeInfoLett.get(key);
    if (!g) {
      g = { label: TYPE_LABELS[key] || key, ids: [], hidden: false,
            color: S.appear.colors[key] || PALETTE[S.typeInfoLett.size % PALETTE.length] };
      S.typeInfoLett.set(key, g);
    }
    g.ids.push(id);
  }
}

function lettFargeMat(m) {
  if (!m.userData.fargeMat) {
    m.userData.fargeMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff, side: THREE.DoubleSide });
  }
  return m.userData.fargeMat;
}

// Maler fargeattributtet etter typefargene — bruker ALLTID originalindeksen,
// så også skjulte (kollapsede) elementer får riktig farge når de vises igjen.
function malLettFarger() {
  const c = new THREE.Color();
  S.modelGroup.children.forEach(m => {
    if (!m.userData.merged) return;
    const g = m.geometry;
    let attr = g.getAttribute("color");
    if (!attr) {
      attr = new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3);
      g.setAttribute("color", attr);
    }
    const ix = m.userData.origIndex || g.getIndex().array;
    const a = attr.array;
    for (const r of (m.userData.ranges || [])) {
      const info = S.typeInfoLett.get(lettTypeKey(r.id));
      c.set((info && info.color) || "#ffffff");
      for (let i = r.start; i < r.start + r.count; i++) {
        const vi = ix[i] * 3;
        a[vi] = c.r; a[vi + 1] = c.g; a[vi + 2] = c.b;
      }
    }
    attr.needsUpdate = true;
  });
}

export function settLettFarger(paa, medAngre) {
  const før = S.lettFargerPå;
  if (paa && S.ghostOn) setGhost(false);   // samme forrang som i full kvalitet: farger slår av ghost
  S.lettFargerPå = paa;
  S.modelGroup.children.forEach(m => {
    if (!m.userData.merged) return;
    if (!m.userData.origMat) m.userData.origMat = m.material;
    m.material = paa ? lettFargeMat(m) : m.userData.origMat;
  });
  if (paa) malLettFarger();
  if (medAngre && før !== paa && S.pushAngre) S.pushAngre({
    tekst: paa ? "Fargelegg etter type" : "Originalfarger",
    angre: () => settLettFarger(før, false),
    gjenopprett: () => settLettFarger(paa, false)
  });
}

function settLettTypeSkjult(g, skjul, medAngre) {
  g.hidden = skjul;
  g.ids.forEach(id => { if (skjul) typeSkjultLett.add(id); else typeSkjultLett.delete(id); });
  synkMergedSkjuling();
  oppdaterVisAlle();
  if ($("colorPanel").classList.contains("open")) renderColorPanelLett();
  if (medAngre && S.pushAngre) S.pushAngre({
    tekst: skjul ? "Type skjult" : "Type vist",
    angre: () => settLettTypeSkjult(g, !skjul, false),
    gjenopprett: () => settLettTypeSkjult(g, skjul, false)
  });
}

export function renderColorPanelLett() {
  const bgVal = "#" + scene.background.getHexString();
  let html =
    '<div class="prop-actions">' +
    '<button id="colApplyLett" class="primary">' + ikon("utseende") + ' ' + t("Fargelegg etter type") + '</button>' +
    '<button id="colResetLett">' + t("Originalfarger") + '</button></div>' +
    '<div class="qty-row"><div class="n">' + t("Bakgrunn") + '</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>';
  const keys = [...S.typeInfoLett.keys()];
  keys.forEach((key, i) => {
    const g = S.typeInfoLett.get(key);
    html += '<div class="qty-row"><div class="n">' + esc(t(g.label)) +
      ' <span style="color:var(--muted);font-size:11px">(' + g.ids.length + ')</span></div>' +
      '<div class="c" style="display:flex; align-items:center; gap:8px">' +
      '<button data-lett-hide="' + i + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(g.hidden ? "skjul" : "vis") + '</button>' +
      '<input type="color" data-lett-type="' + i + '" value="' + g.color + '"></div></div>';
  });
  html += '<p style="color:var(--muted);font-size:11px;margin-top:10px">' + t("Kantlinjer per type finnes bare i full kvalitet.") + '</p>';
  $("colorBody").innerHTML = html;
  $("colBg").oninput = (e) => { scene.background.set(e.target.value); saveBg(e.target.value); };
  $("colApplyLett").onclick = () => settLettFarger(true, true);
  $("colResetLett").onclick = () => settLettFarger(false, true);
  $("colorBody").querySelectorAll("button[data-lett-hide]").forEach(b =>
    b.onclick = () => {
      const g = S.typeInfoLett.get(keys[Number(b.dataset.lettHide)]);
      settLettTypeSkjult(g, !g.hidden, true);
    });
  $("colorBody").querySelectorAll("input[data-lett-type]").forEach(inp =>
    inp.oninput = () => {
      const key = keys[Number(inp.dataset.lettType)];
      const g = S.typeInfoLett.get(key);
      g.color = inp.value;
      S.appear.colors[key] = inp.value;
      saveAppear();
      if (S.lettFargerPå) malLettFarger();
    });
  // 👁 Markeringene finnes også på byggeplassen — der brukes de mest.
  if (S.markeringUtseendeRader) S.markeringUtseendeRader($("colorBody"));
}

på("btnColors", "click", async () => {
  if (!S.modelGroup) return;
  const panel = $("colorPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (S.lightLoaded) {
    if (!S.typeInfoLett) {
      $("colorBody").innerHTML = '<p style="color:var(--muted)">' + t("Leser elementdata …") + '</p>';
      apnePanel("colorPanel");
      await byggTypeInfoLett();
    }
    renderColorPanelLett();
  } else {
    if (!S.typeInfo) { await sikreMeta(alleElementIder); buildTypeInfo(); }
    renderColorPanel();
  }
  apnePanel("colorPanel");
});

export function renderColorPanel() {
  const bgVal = "#" + scene.background.getHexString();
  let html =
    '<div class="prop-actions">' +
    '<button id="colApply" class="primary">' + ikon("utseende") + ' ' + t("Fargelegg etter type") + '</button>' +
    '<button id="colReset">' + t("Originalfarger") + '</button></div>' +
    '<div class="qty-row"><div class="n">' + t("Bakgrunn") + '</div><div class="c"><input type="color" id="colBg" value="' + bgVal + '"></div></div>';
  const keys = [...S.typeInfo.keys()];
  // ▣ Står den globale bryteren i ⚙ Innstillinger på, har ALT kantlinjer. Da
  // vises knappene her som på og låses – en knapp som ser av ut mens streken
  // står der, eller som ikke gjør noe når man trykker, er verre enn en låst knapp.
  const globalOutline = !!(S.settings && S.settings.outline);
  const outlineTittel = globalOutline
    ? t("Kantlinjer er slått på for hele modellen i ⚙ Innstillinger")
    : t("Kantlinjer på denne typen");
  keys.forEach((key, i) => {
    const g = S.typeInfo.get(key);
    const påType = outlineAktiv(key, globalOutline, S.appear.outlineTypes);
    html += '<div class="qty-row"><div class="n">' + esc(t(g.label)) +
      ' <span style="color:var(--muted);font-size:11px">(' + g.meshes.length + ')</span></div>' +
      '<div class="c" style="display:flex; align-items:center; gap:8px">' +
      '<button data-outline="' + i + '"' + (påType ? ' class="active"' : '') + (globalOutline ? ' disabled' : '') +
      ' title="' + esc(outlineTittel) + '" style="padding:3px 8px">' + ikon("boks") + '</button>' +
      '<button data-hide="' + i + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(g.hidden ? "skjul" : "vis") + '</button>' +
      '<input type="color" data-type="' + i + '" value="' + g.color + '"></div></div>';
  });
  $("colorBody").innerHTML = html;
  // Fargevelgere fyrer oninput per piksel man drar. Ett avtrykk tas ved
  // pointerdown/focus og meldes inn på change – ellers ville én dragbevegelse
  // fylt hele angre-stabelen med mellomtrinn.
  let dragFør = null;
  const startDrag = () => { if (!dragFør) dragFør = visningsAvtrykk(); };

  $("colBg").oninput = (e) => { scene.background.set(e.target.value); saveBg(e.target.value); };
  $("colBg").onpointerdown = startDrag;
  $("colBg").onchange = () => { if (dragFør) { meldAngre(dragFør, "Bakgrunnsfarge"); dragFør = null; } };
  $("colApply").onclick = () => {
    const før = visningsAvtrykk();
    applyTypeColors();
    meldAngre(før, "Fargelegg etter type");
  };
  $("colReset").onclick = resetColors;
  $("colorBody").querySelectorAll("input[data-type]").forEach(inp => {
    inp.onpointerdown = startDrag;
    inp.onfocus = startDrag;          // tastaturbruk åpner velgeren uten pointerdown
    inp.oninput = (e) => {
      const key = keys[Number(e.target.dataset.type)];
      const g = S.typeInfo.get(key);
      g.color = e.target.value;
      g.mat.color.set(e.target.value);
      S.appear.colors[key] = e.target.value;
      saveAppear();
      if (!S.typeColorsOn) applyTypeColors();
    };
    inp.onchange = () => { if (dragFør) { meldAngre(dragFør, "Farge på elementtype"); dragFør = null; } };
  });
  // ▣ Kantlinjer per elementtype. IKKE med i ↩ Angre, med vilje: den ødelegger
  // ingenting og tas tilbake med et nytt trykk på samme knapp – samme grunn som
  // at snitt-sliderne står utenfor stabelen.
  $("colorBody").querySelectorAll("button[data-outline]").forEach(btn => {
    btn.onclick = (e) => {
      const key = keys[Number(e.currentTarget.dataset.outline)];
      // NY liste hver gang. Skyves det inn i den som ligger i S.appear, kan den
      // være DEFAULT_APPEAR sin egen – og da er standardverdien endret for godt.
      const liste = (S.appear.outlineTypes || []).slice();
      const p = liste.indexOf(key);
      if (p === -1) liste.push(key); else liste.splice(p, 1);
      S.appear.outlineTypes = liste;
      saveAppear();
      e.currentTarget.classList.toggle("active", liste.indexOf(key) !== -1);
      oppdaterOutline();
    };
  });
  $("colorBody").querySelectorAll("button[data-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const før = visningsAvtrykk();
      const g = S.typeInfo.get(keys[Number(e.currentTarget.dataset.hide)]);
      g.hidden = !g.hidden;
      g.meshes.forEach(m => m.visible = !g.hidden && !hiddenIDs.has(m.userData.expressID));
      e.currentTarget.innerHTML = ikon(g.hidden ? "skjul" : "vis");
      syncHiddenTypes();
      oppdaterVisAlle();
      meldAngre(før, g.hidden ? "Skjul elementtype" : "Vis elementtype");
    };
  });
  // 📦 Materiell (leveranser) får egne rader nederst — de tegnes av
  // materiell-vis.js, som eier objektene (fargen settes per objekt der).
  if (S.materiellUtseendeRader) S.materiellUtseendeRader($("colorBody"));
  // 👁 «Markeringer»-gruppa. Egne rader, fordi markeringene ikke er
  // IFC-elementer og dermed ikke finnes i S.typeInfo.
  if (S.markeringUtseendeRader) S.markeringUtseendeRader($("colorBody"));
  // 🧱 «SW-generator»-gruppa: alt generatoren har satt på bygget. Bunkene med
  // veggelementer rundt bygget er materiell og har sine egne rader over.
  if (S.swUtseendeRader) S.swUtseendeRader($("colorBody"));
}
