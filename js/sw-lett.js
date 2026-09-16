// 🏗 SW-elementene PÅ BYGGEPLASSEN — monteringsinstruks, ikke generator.
//
// HVORFOR DENNE FILA FINNES OG IKKE BARE js/veggelement.js. Generatoren er på
// 300 kB og laster fasader, regneregler, tegningseksport og Excel-utskrift.
// Ingenting av det trenger montøren, og alt av det ville blitt forhåndslagret
// av service workeren for en telefon som står uten dekning. Denne fila tegner
// det Emil allerede har bestemt: kasser med riktig mål, på riktig sted, med
// SW-nummeret på. Beskrivelsen kommer ferdig fra kontoret (swForByggeplass i
// js/veggelement.js) og regnes ALDRI ut på nytt her — da kunne montøren endt
// opp med en vegg ingen har godkjent.
//
// Tegningen er enklere enn på kontoret med vilje: ingen bølgeprofil i blikket.
// Den er til pynt, og koster rammer på en telefon.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, flyTil, raycaster, scene } from "./scene.js";

export const swLettGroup = new THREE.Group();
scene.add(swLettGroup);

// ---------- Skiltene ligger PÅ panelet ----------
// FØRSTE FORSØK BRUKTE SVEVENDE LAPPER med konstant skjermstørrelse, som
// materiellet og kotene. På en fasade med to hundre paneler ble det to hundre
// skilt oppå hverandre, og montøren så et teppe av «SW-31» i stedet for
// bygget (Emils bilde 16.09). Kontoret har alltid gjort det motsatte: skiltet
// er en FLAT DEKAL med fast fysisk størrelse, limt på panelflaten. Da ligger
// det der det hører hjemme, krymper når du går unna, og to skilt kan ikke
// legge seg over hverandre — de sitter på hver sin vegg.
const dekalCache = new Map();

function dekalTekstur(tekst) {
  if (dekalCache.has(tekst)) return dekalCache.get(tekst);
  const pad = 16, fs = 64;
  const mc = document.createElement("canvas").getContext("2d");
  mc.font = "bold " + fs + "px sans-serif";
  const w = Math.ceil(mc.measureText(tekst).width + pad * 2);
  const c = document.createElement("canvas");
  c.width = w; c.height = fs + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#11161d"; ctx.lineWidth = 5; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  ctx.font = "bold " + fs + "px sans-serif";
  ctx.fillStyle = "#11161d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tekst, c.width / 2, c.height / 2 + 2);
  const ut = { tex: new THREE.CanvasTexture(c), aspect: c.width / c.height };
  dekalCache.set(tekst, ut);
  return ut;
}

// hoydeMm = skilthøyde i mm; maksBredde (sceneenheter) krymper skiltet så det
// aldri stikker utenfor elementet det sitter på.
function tekstDekal(tekst, hoydeMm, maksBredde) {
  const { tex, aspect } = dekalTekstur(tekst);
  let h = mm(hoydeMm), w = h * aspect;
  if (maksBredde > 0 && w > maksBredde) { const k = maksBredde / w; w *= k; h *= k; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ map: tex }));
  m.raycast = () => {};
  // Skiltet skal IKKE bli gjennomsiktig sammen med veggen det sitter på: du
  // slår på Gjennomsiktig for å se hva som står BAK panelet, og da må du
  // fortsatt kunne lese hvilket panel du ser gjennom.
  m.userData.ghostFritatt = true;
  return m;
}

// Millimeter til sceneenheter. S.enhetSkala settes i js/ifc.js og er meter per
// modellenhet — den SAMME omregningen som generatoren bruker, og grunnen til
// at et element havner riktig i en modell tegnet i millimeter.
const mm = (v) => (Number(v) || 0) / 1000 / (S.enhetSkala || 1);

const FARGER = { y: "#dfe5ec", i: "#cfd8e3", r: "#8a8f98" };

// ---------- Hva som faktisk skal tegnes ----------
// REN FUNKSJON, uten three.js: beskrivelsen kommer gjennom JSON og et nett, og
// reglene for hva som slipper gjennom skal kunne prøves uten å tegne noe.
//   · uten mål er det ingenting å montere etter — droppes
//   · et skråkappet element ER en trapes. Tegnet som kasse med middelhøyde
//     ville montøren fått beskjed om at gavlpanelet er rett når det ikke er det
//   · fargen er fasadens på ytterveggene, faste på innervegg og ringmur, så
//     montøren ser hva som er hva
export function swLettElementer(data) {
  const d = data && typeof data === "object" ? data : null;
  const liste = d && Array.isArray(d.elementer) ? d.elementer : [];
  const grunnfarge = /^#[0-9a-fA-F]{6}$/.test(String((d && d.farge) || "")) ? d.farge : FARGER.y;
  const ut = [];
  for (const e of liste) {
    if (!e || !(Number(e.l) > 0) || !(Number(e.h) > 0)) continue;
    // Er elementet helt spist av en utsparing, står det ingenting igjen. Da
    // skal det heller ikke tegnes som en hel kasse.
    if (Array.isArray(e.b) && !e.b.length) continue;
    ut.push(Object.assign({}, e, {
      farge: e.k === "r" ? FARGER.r : (e.k === "i" ? FARGER.i : grunnfarge),
      trapes: e.hv !== undefined && e.hh !== undefined && Number(e.hv) !== Number(e.hh)
    }));
  }
  return ut;
}

function mat(farge) {
  return new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
}

// Rett element: en kasse. Skråkappet: en trapes, dratt ut i tykkelsen.
// Gavlpanelene ER trapeser, og en kasse med middelhøyde der ville sagt
// montøren at panelet er rett når det ikke er det.
function byggGeometri(e) {
  const L = mm(e.l), T = mm(e.t);
  if (e.trapes) {
    const hv = mm(e.hv), hh = mm(e.hh);
    const form = new THREE.Shape();
    form.moveTo(-L / 2, 0);
    form.lineTo(L / 2, 0);
    form.lineTo(L / 2, hh);
    form.lineTo(-L / 2, hv);
    form.closePath();
    // 🕳 Hakk i et skråkappet element: hull i selve formen, som på kontoret.
    // Bitene rundt hakket ville mistet skråkuttet.
    for (const h of (Array.isArray(e.hull) ? e.hull : [])) {
      if (!Array.isArray(h) || h.length !== 4) continue;
      const bane = new THREE.Path();
      const a0 = -L / 2 + mm(h[0]), a1 = -L / 2 + mm(h[1]);
      const b0 = mm(h[2]), b1 = mm(h[3]);
      bane.moveTo(a0, b0); bane.lineTo(a1, b0); bane.lineTo(a1, b1); bane.lineTo(a0, b1);
      bane.closePath();
      form.holes.push(bane);
    }
    const g = new THREE.ExtrudeGeometry(form, { depth: T, bevelEnabled: false });
    g.translate(0, -Math.max(hv, hh) / 2, -T / 2);
    return g;
  }
  return new THREE.BoxGeometry(L, mm(e.h), T);
}

// 🕳 ETT ELEMENT, FLERE BITER. Et panel som går FORBI en utsparing er ett
// element i lista (SW-11 4620×1000), men står på bygget som bitene rundt
// hakket. Uten dette ble kassa tegnet tvers over porten, og montøren fikk
// beskjed om å montere et panel foran åpningen (Emils bilde 16.09).
//
// Bitene kommer FERDIG OPPDELT fra kontoret (rektMinusHull i
// js/veggelement.js). Her plasseres de bare: `b` er [x0, x1, y0, y1] i
// elementets egne mm — x fra venstre ende, y fra bunnen.
function byggBiter(e, materiale) {
  const L = mm(e.l), H = mm(e.h), T = mm(e.t);
  const ut = [];
  for (const b of e.b) {
    if (!Array.isArray(b) || b.length !== 4) continue;
    const bw = mm(b[1] - b[0]), bh = mm(b[3] - b[2]);
    if (!(bw > 0) || !(bh > 0)) continue;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, T), materiale);
    bit.position.set(mm((b[0] + b[1]) / 2) - L / 2, mm((b[2] + b[3]) / 2) - H / 2, 0);
    ut.push(bit);
  }
  return ut;
}

function ryddAlt() {
  swLettGroup.children.slice().forEach(o => {
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); });
    swLettGroup.remove(o);
  });
}

// Over dette antallet droppes merkingen. Det er ikke kassene som tar knekken
// på en telefon, det er teksturene: hvert skilt er sitt eget canvas. Cachen
// deler dem på TEKST, så tjue paneler som alle heter «SW-31» koster én
// tekstur — derfor er grensen på antall SKILT, ikke på antall elementer.
const MAKS_LAPPER = 400;

// Det som står på bygget nå. Egen liste og ikke en gjennomgang av gruppa:
// søket skal svare på hva som ER der, og det svaret skal ikke avhenge av
// hvordan three.js har lagt tingene i scenen.
let tegnede = [];

export function tegnSwLett(data) {
  ryddAlt();
  lesSkjulte();
  const liste = swLettElementer(data);
  tegnede = liste;
  if (!liste.length) { oppdaterKnapp(); return; }
  // ETT materiale per farge, ikke ett per element: to tusen materialer er to
  // tusen shader-oppsett, og telefonen merker det med en gang.
  const materialer = new Map();
  const hent = (f) => {
    if (!materialer.has(f)) materialer.set(f, mat(f));
    return materialer.get(f);
  };
  const visLapper = liste.length <= MAKS_LAPPER;
  for (const e of liste) {
    if (skjultId.has(String(e.id))) continue;   // 👁 skjult enkeltvis
    const materiale = hent(e.farge);
    // Er elementet delt av en utsparing, står bitene i en gruppe som roteres
    // og plasseres som ett element — da er biten i elementets egne mm, og
    // plasseringen trenger ikke kunne noe om fasaden.
    const m = e.b
      ? (() => { const g = new THREE.Group(); for (const bit of byggBiter(e, materiale)) g.add(bit); return g; })()
      : new THREE.Mesh(byggGeometri(e), materiale);
    m.position.set(Number(e.x) || 0, Number(e.y) || 0, Number(e.z) || 0);
    m.rotation.y = Number(e.rot) || 0;
    m.userData.swLettId = String(e.id || "");
    m.userData.swLett = e;
    swLettGroup.add(m);
    if (visLapper && e.sw) merkPanel(e);
  }
  oppdaterValgEffekt();
  if (visLapper) tegnUtsparinger(data);
  oppdaterKnapp();
  // Nytegnet = ferske materialer som ikke vet at Gjennomsiktig står på.
  if (S.ghostPaaNytt) S.ghostPaaNytt();
}

// SW-nummeret i øvre hjørne og målet i midten — nøyaktig samme plassering som
// på kontoret, så montøren og prosjektlederen ser det samme bildet.
const _opp = new THREE.Vector3(0, 0, 1);
function merkPanel(e) {
  const nv = new THREE.Vector3(Number(e.nx) || 0, 0, Number(e.nz) || 0);
  if (nv.lengthSq() < 1e-9) nv.set(0, 0, 1);
  nv.normalize();
  const ex = Math.cos(e.rot || 0), ez = -Math.sin(e.rot || 0);
  const utD = mm(e.t) / 2 + 0.01 / (S.enhetSkala || 1);
  const L = mm(e.l), H = mm(e.h);
  const sw = tekstDekal(e.sw, 220, L * 0.45);
  sw.quaternion.setFromUnitVectors(_opp, nv);
  sw.position.set(e.x - ex * L * 0.32 + nv.x * utD,
                  e.y + H * 0.24,
                  e.z - ez * L * 0.32 + nv.z * utD);
  swLettGroup.add(sw);
  if (e.dim) {
    const dim = tekstDekal(e.dim, 150, L * 0.6);
    dim.quaternion.copy(sw.quaternion);
    dim.position.set(e.x + nv.x * utD, e.y - H * 0.1, e.z + nv.z * utD);
    swLettGroup.add(dim);
  }
}

// 🚪 UTSPARINGENE: stiplet ramme med kryss, målet i midten og navnet over.
// Hjørnene kommer ferdig utregnet fra kontoret (swUtspForByggeplass) — hadde
// vi regnet dem ut her av fasadene, ville den regningen stått to steder.
//
// Vanlig dybdetest og ingen renderOrder, som på kontoret: det var
// depthTest:false som lot krysset på baksiden skinne gjennom fasaden.
function tegnUtsparinger(data) {
  const liste = (data && Array.isArray(data.utsparinger)) ? data.utsparinger : [];
  if (!liste.length) return;
  const strekMat = new THREE.LineDashedMaterial({
    color: 0x11161d, dashSize: 0.12 / (S.enhetSkala || 1),
    gapSize: 0.08 / (S.enhetSkala || 1) });
  for (const a of liste) {
    if (!a || !Array.isArray(a.p) || a.p.length !== 4) continue;
    const v = a.p.map(q => new THREE.Vector3(Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0));
    const geo = new THREE.BufferGeometry().setFromPoints([
      v[0], v[1], v[1], v[2], v[2], v[3], v[3], v[0],   // rammen
      v[0], v[2], v[1], v[3]                            // krysset
    ]);
    const linje = new THREE.LineSegments(geo, strekMat);
    linje.computeLineDistances();     // MÅ til, ellers blir streken hel
    linje.raycast = () => {};
    linje.userData.ghostFritatt = true;
    swLettGroup.add(linje);
    const nv = new THREE.Vector3(Number((a.n || [])[0]) || 0, 0, Number((a.n || [])[1]) || 0);
    if (nv.lengthSq() < 1e-9) nv.set(0, 0, 1);
    nv.normalize();
    const maks = mm(Math.max((a.b || 0) * 0.8, 600));
    if (Array.isArray(a.m)) {
      const tot = tekstDekal((a.b || 0) + "\u00d7" + (a.h || 0) + " MM", 260, maks);
      tot.quaternion.setFromUnitVectors(_opp, nv);
      tot.position.set(Number(a.m[0]) || 0, Number(a.m[1]) || 0, Number(a.m[2]) || 0);
      swLettGroup.add(tot);
      if (a.navn && Array.isArray(a.mn)) {
        const navn = tekstDekal(a.navn, 260, maks);
        navn.quaternion.copy(tot.quaternion);
        navn.position.set(Number(a.mn[0]) || 0, Number(a.mn[1]) || 0, Number(a.mn[2]) || 0);
        swLettGroup.add(navn);
      }
    }
  }
}

// ---------- Skjul/vis ----------
// TO NIVÅER, som på kontoret: hele laget av gangen (raden i 🎨 Utseende), og
// ETT ELEMENT om gangen. Det siste er ikke et kontorbehov — montøren står foran
// veggen og vil ta bort DET panelet for å se stålsøyla bak det.
//
// Valget lagres per modellfil i nettleseren. På byggeplassen eier Workeren
// dataene, så dette er en ren visningstilstand på telefonen: den overlever at
// du låser skjermen og åpner siden igjen, og forsvinner aldri ut til de andre.
let skjult = false;
const skjultId = new Set();
const valgt = new Set();

function skjulNokkel() { return "storm-sw-lett-skjult::" + (S.fileName || ""); }

function lesSkjulte() {
  skjultId.clear();
  try {
    const l = JSON.parse(localStorage.getItem(skjulNokkel()) || "[]");
    if (Array.isArray(l)) for (const id of l) skjultId.add(String(id));
  } catch (_) {}
}

function skrivSkjulte() {
  try { localStorage.setItem(skjulNokkel(), JSON.stringify([...skjultId])); } catch (_) {}
}

function oppdaterKnapp() {
  swLettGroup.visible = !skjult;
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
}

// Samme blå som elementvalget i modellen, så «valgt» ser likt ut uansett hva
// du trykte på. Males om etter hver omtegning — meshene er nye objekter da.
const SEL_FARGE = 0x3b82f6, SEL_EMISSIVE = 0x1d4ed8;

function settValgEffekt(o, paa) {
  o.traverse(m => {
    if (!m.isMesh || !m.material || m.userData.ghostFritatt) return;
    if (paa) {
      if (!m.userData.matOrig) m.userData.matOrig = m.material;
      if (!m.userData.matSel) {
        const sel = m.userData.matOrig.clone();
        sel.color.set(SEL_FARGE);
        if (sel.emissive) sel.emissive.set(SEL_EMISSIVE);
        m.userData.matSel = sel;
      }
      m.material = m.userData.matSel;
    } else if (m.userData.matOrig) {
      m.material = m.userData.matOrig;
    }
  });
}

function oppdaterValgEffekt() {
  swLettGroup.children.forEach(o => {
    if (o.userData.swLettId === undefined) return;
    settValgEffekt(o, valgt.has(o.userData.swLettId));
  });
}

// Laget melder inn hva det kan (se EKSTRA_LAG i js/state.js): Gjennomsiktig,
// «Vis alle», Mengder og Elementsøk virker da på byggeplassen uten at noen av
// dem vet at dette laget finnes.
registrerEkstraGruppe(swLettGroup, {
  id: "sw",
  navn: "SW-elementer",
  noeSkjult: () => skjult || skjultId.size > 0,
  visAlt() {
    if (!skjult && !skjultId.size) return;
    skjult = false;
    skjultId.clear();
    skrivSkjulte();
    tegnPaaNytt();
  },
  skjulTilstand: () => ({ skjult, ider: [...skjultId] }),
  settSkjulTilstand(v) {
    skjult = !!(v && v.skjult);
    skjultId.clear();
    for (const id of ((v && v.ider) || [])) skjultId.add(String(id));
    skrivSkjulte();
    tegnPaaNytt();
  },
  sokRader: () => tegnede.filter(e => e.sw).map(e => {
    const under = [e.k === "i" ? t("Innervegg") : t("Yttervegg"), e.l + "×" + e.h + " mm"].join(" · ");
    return { id: e.id, navn: e.sw, under, s: (e.sw + " " + under).toLowerCase() };
  }),

  // ---------- Plukking og skjuling ETT OG ETT ----------
  // pick() i elements.js ser BARE S.modelGroup. Laget svarer derfor selv på hva
  // som ligger under fingeren, og oppgir avstanden, så kallstedet kan avgjøre
  // hvem som lå nærmest: modellen, materiellet eller SW.
  plukk(cx, cy) {
    if (!swLettGroup.visible || !swLettGroup.children.length) return null;
    const r = canvas.getBoundingClientRect();
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    swLettGroup.updateMatrixWorld(true);
    const treff = raycaster.intersectObjects(swLettGroup.children, true);
    for (const h of treff) {
      // Skiltene er ikke noe å trykke på — de har allerede raycast slått av,
      // men et dekal uten id ville uansett ikke gitt noe treff å bruke.
      let o = h.object;
      while (o && o.userData.swLettId === undefined) o = o.parent;
      if (o && o.userData.swLettId) return { id: o.userData.swLettId, avstand: h.distance };
    }
    return null;
  },
  velg(ider) {
    const nye = new Set((ider || []).map(String));
    if (nye.size === valgt.size && [...nye].every(id => valgt.has(id))) return;
    valgt.clear();
    for (const id of nye) valgt.add(id);
    oppdaterValgEffekt();
  },
  valgte: () => [...valgt],
  skjul(ider) {
    let nye = 0;
    for (const id of (ider || [])) if (!skjultId.has(String(id))) { skjultId.add(String(id)); nye++; }
    if (!nye) return;
    for (const id of (ider || [])) valgt.delete(String(id));
    skrivSkjulte();
    tegnPaaNytt();
    if ($("propPanel")) $("propPanel").classList.remove("open");
  },
  gaTil(id) {
    const e = tegnede.find(x => String(x.id) === String(id));
    if (!e) return;
    flyTil(new THREE.Vector3(Number(e.x) || 0, Number(e.y) || 0, Number(e.z) || 0),
           Math.max(mm(e.l), mm(e.h)));
    this.velg([id]);
    this.visEgenskaper(id);
  },

  // Egenskapspanelet for ett SW-element. Montøren skal se hva panelet heter og
  // hvor stort det er — og kunne ta det bort for å se stålet bak.
  visEgenskaper(id) {
    const e = tegnede.find(x => String(x.id) === String(id));
    if (!e || !$("propTitle")) return;
    const rad = (k, v) => '<div class="prop-row"><div class="k">' + esc(k) +
      '</div><div class="v">' + esc(String(v)) + '</div></div>';
    const erRm = e.k === "r";
    $("propTitle").textContent = erRm ? t("Ringmur") : (e.sw || t("Veggelement"));
    $("propBody").innerHTML =
      '<div class="prop-actions"><button id="paSkjulSwLett">' + ikon("skjul") + ' ' +
      t("Skjul dette elementet") + '</button></div>' +
      rad(t("Type"), erRm ? t("Ringmur") : (e.k === "i" ? t("Innervegg") : t("Yttervegg"))) +
      (e.sw ? rad(t("SW-nummer"), e.sw) : "") +
      rad(t("Lengde"), e.l + " mm") +
      rad(t("Høyde"), (e.hv !== undefined ? e.hv + "/" + e.hh : e.h) + " mm") +
      rad(t("Tykkelse"), e.t + " mm") +
      '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
      t("Skjulte SW-elementer hentes fram igjen med «Vis alle».") + '</p>';
    $("paSkjulSwLett").onclick = () => this.skjul([id]);
    apnePanel("propPanel");
  },

  // 🎨 Utseende: én rad for hele laget. Fargen settes på kontoret, så her er
  // det bare øyeknappen — og antallet, så montøren ser at noe er skjult
  // enkeltvis selv om laget står på.
  utseendeRader(body) {
    if (!body || !tegnede.length) return;
    const boks = document.createElement("div");
    boks.innerHTML =
      '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
      t("SW-elementer") + '</div><div class="c"></div></div>' +
      '<div class="qty-row"><div class="n">' + t("Alt på bygget") +
      ' <span style="color:var(--muted);font-size:11px">(' + tegnede.length + ')</span></div>' +
      '<div class="c"><button data-sw-lett-skjul="1" title="' + t("Skjul/vis") +
      '" style="padding:3px 8px">' + ikon(skjult ? "skjul" : "vis") + '</button></div></div>' +
      (skjultId.size
        ? '<p style="color:var(--muted);font-size:11px;margin:2px 0 0">' +
          t("{0} element er skjult enkeltvis. «Vis alle» henter dem fram.", skjultId.size) + '</p>'
        : "");
    body.appendChild(boks);
    boks.querySelectorAll("button[data-sw-lett-skjul]").forEach(b => {
      b.onclick = () => {
        skjult = !skjult;
        oppdaterKnapp();
        if (S.tegnUtseendePanel) S.tegnUtseendePanel();
      };
    });
  }
});

const _ndc = new THREE.Vector2();

// Tegner opp igjen fra det som allerede er mottatt — brukes når skjulingen
// endres. Vi har ikke rådataene lenger, så `tegnede` mates inn på nytt; den
// har allerede vært gjennom vaskingen, og går uendret gjennom en gang til.
let sisteData = null;
function tegnPaaNytt() { tegnSwLett(sisteData); }

// markers.js kaller denne med `sw`-feltet fra <fil>.markeringer.json når
// modellen er lastet. Gamle filer har ikke feltet — da tegnes ingenting, og
// det er riktig: byggeplassen skal ikke gjette.
S.settSwFraLett = (data) => { sisteData = data; tegnSwLett(data); };
S.ryddSwLett = () => { sisteData = null; tegnSwLett(null); };
