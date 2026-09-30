// 🏕 Rigg — VISNINGEN. Bygger 3D-objektene (brakker, toalett, container …),
// setter dem på bakken og melder laget inn i scenen.
//
// DENNE FILA LASTES AV BÅDE main.js OG lett-main.js: montøren på byggeplassen
// skal SE riggen, men ikke kunne endre den (Emil 25.09.2026, som Materiell).
// ⛰ Siden 30.09 har byggeplassen også terrenget (js/terreng-vis.js), og den
// setter S.terrengRef der også — da står riggen på bakken på telefonen også,
// ikke på gulvhøyde. Uten terreng er S.terrengRef ikke satt, og alt er som før.
// Selve verktøyet (panel, plassering, flytt, lagring) ligger i js/rigg.js og
// lastes kun av main.js.
//
// HVOR RIGGEN STÅR. Riggen hører til TOMTA (Emil 25.09): posisjonen lagres i
// UTM33, og flyttes bygget på terrenget, blir brakkene stående der de står.
// For å tegne den trengs terrengets plassering (referansen, se rigg-regn.js):
//   · kontor med terreng — levende fra terreng.js (S.terrengRef), og objektene
//     står på bakken (terrenget, eller plata innenfor utskjæringen)
//   · kontor uten terreng, og byggeplassen — siste kjente plassering, lagret i
//     rigg-lista. Objektene står da på gulvhøyde.
//
// Regningen (rammer, vasking, mengder) ligger i js/rigg-regn.js.
import * as THREE from "three";
import { $, S, esc, ikon, registrerEkstraGruppe } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { LAPP_MAKS_M, LAPP_MIN_PX, camera, flyTil, frameHooks, grid, lappStorrelse, makeLabel, renderer, scene, skalerLapperMedTak } from "./scene.js";
import { RIGG_SEL_ANDEL_PIL, byggModell, riggValgEffekt, toneFarge } from "./rigg-modell.js";
import {
  AVFALLSTYPER, avfallstype, GJERDE_DELER, P_PLASS_B, P_PLASS_D, RIGG_REKKEFOLGE, RIGG_TYPER, erPil, gjerdeLappPunkt, gjerdeStykker, parkeringsPlasser, lokalTilEN, riggAntall, riggFraByggeplass, riggForByggeplassFra, riggMengdeRader,
  riggFotavtrykk, riggObjekter, riggRef, riggTilBygg, tilUtm, vaskRef, REF_ID
} from "./rigg-regn.js";

export function gjerdeDelLabel(del) { return t(GJERDE_DELER[del] || del); }

export function riggTypeLabel(type) {
  return RIGG_TYPER[type] ? t(RIGG_TYPER[type].label) : type;
}

// ═══════════════════════ SCENEN ═══════════════════════
export const riggGroup = new THREE.Group();
riggGroup.name = "rigg";
scene.add(riggGroup);

// Typer som er skjult i 🎨 Utseende (per type, som materiellets maltyper).
const skjulteTyper = new Set();

// Byggeplass-siden: det som kom i Workerens JSON.
let lett = { ref: null, objekter: [] };

// Objektene som skal vises, uansett side.
export function riggListe() {
  return LETT ? lett.objekter : riggObjekter(S.rigg || []);
}

// Referansen: den levende fra terrenget, ellers den lagrede.
export function aktivRef() {
  if (LETT) return lett.ref;
  const live = S.terrengRef ? S.terrengRef() : null;
  if (live) return vaskRef(live);
  return riggRef(S.rigg || []);
}

// Modellen som referanse: senteret i plan, meter per sceneenhet og gulvet
// (modellens laveste punkt — samme regel som terreng.js, så riggen og
// terrenget aldri er uenige om hvor gulvet er).
export function riggBase() {
  if (!S.modelGroup) return null;
  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  const gulvY = Number.isFinite(boks.min.y) ? boks.min.y : (grid.position.y || 0);
  return { c, skala: S.enhetSkala || 1, gulvY };
}

// Hvor objektet skal stå i scenen: { x, y, z, rotY } eller null.
export function riggScenePos(o, base, ref, live) {
  const b = riggTilBygg(o, ref);
  if (!b || !base) return null;
  const x = base.c.x + b.bx / base.skala, z = base.c.z + b.bz / base.skala;
  // På skrå tomt står objektet på det HØYESTE punktet under seg (midten og de
  // fire hjørnene): da ser det ut som det står på klosser i nedoverbakken, i
  // stedet for å være halvveis begravd i oppoverbakken (nettleserprøven 25.09).
  let y = null;
  if (o.punkter) {
    // 🚧 Gjerdet: gruppa står på det LAVESTE punktet, og hver fot løftes
    // til bakken under seg (gjerdeHoyder) — gjerdet følger terrenget panel
    // for panel i stedet for å henge i lufta over en dump.
    if (live && o.ramme === "utm") for (const p of riggFotavtrykk(o)) {
      const h = live.yVed(p.E, p.N);
      if (h != null && (y == null || h < y)) y = h;
    }
    if (y == null) y = base.gulvY;
    return { x, y, z, rotY: b.rotY };
  }
  // 🅿 En parkeringsplass er en stor, flat flate: høyeste hjørne ville løftet
  // hele asfalten opp i lufta på en skrå tomt. Den legges i midtpunktets høyde.
  const bareMidten = !!(RIGG_TYPER[o.type] && RIGG_TYPER[o.type].flate);   // parkering og lagring
  if (live && o.ramme === "utm") {
    for (const p of [{ E: o.E, N: o.N }].concat(bareMidten ? [] : riggFotavtrykk(o))) {
      const h = live.yVed(p.E, p.N);
      if (h != null && (y == null || h > y)) y = h;
    }
  }
  if (y == null) y = base.gulvY;
  return { x, y, z, rotY: b.rotY };
}

// Høyden under hver skjøt i gjerdet, i METER over gruppas bunn (gy, scene).
export function gjerdeHoyder(o, base, live, gy) {
  return o.punkter.map(q => {
    if (!live || o.ramme !== "utm") return 0;
    const p = lokalTilEN(o, q.x, q.z);
    const h = live.yVed(p.E, p.N);
    return h == null ? 0 : Math.max(0, (h - gy) * base.skala);
  });
}

// ═══════════════════════ LAGET ═══════════════════════
// Samme evner som materiellet. INGEN «plukk» og «velg»: rigg-objektene velges
// av rigg.js med egne lyttere (som materiell.js), og ville ellers havnet i
// flervalg og grupper — der de ikke hører hjemme.
registrerEkstraGruppe(riggGroup, {
  id: "rigg",
  navn: "Rigg",
  noeSkjult: () => skjulteTyper.size > 0 || riggListe().some(o => o.skjult),
  visAlt() {
    if (!this.noeSkjult()) return;
    skjulteTyper.clear();
    if (!LETT) {
      const naa = new Date().toISOString();
      S.rigg = (S.rigg || []).map(p => p && p.skjult ? Object.assign({}, p, { skjult: false, endret: naa }) : p);
      if (S.riggMeldEndret) S.riggMeldEndret();
    }
    tegnRigg();
  },
  skjulTilstand: () => ({
    typer: [...skjulteTyper],
    ider: riggListe().filter(o => o.skjult).map(o => o.id)
  }),
  settSkjulTilstand(v) {
    const s = v || {};
    skjulteTyper.clear();
    for (const k of (s.typer || [])) skjulteTyper.add(k);
    if (!LETT) {
      const skjulte = new Set(s.ider || []);
      S.rigg = (S.rigg || []).map(p => (p && RIGG_TYPER[p.type] && !p.slettet && p.skjult !== skjulte.has(p.id))
        ? Object.assign({}, p, { skjult: skjulte.has(p.id), endret: new Date().toISOString() }) : p);
      if (S.riggMeldEndret) S.riggMeldEndret();
    }
    tegnRigg();
  },
  // 📊 Mengder: egen type «Rigg», så filteret i Mengder og Excel-arket får
  // riggen under egen overskrift.
  mengder: (groups, rows) => leggRiggIMengder(groups, rows),
  // 🔎 Elementsøk: «brakke» eller navnet du ga objektet skal gi treff.
  sokRader: () => riggListe().map(o => {
    const label = riggTypeLabel(o.type);
    const n = riggAntall(o);
    return {
      id: o.id, navn: o.navn || label,
      under: [label, n > 1 ? n + t(" stk") : ""].filter(Boolean).join(" · "),
      s: ((o.navn || "") + " " + label + " " + o.id).toLowerCase()
    };
  }),
  utseendeRader(body) { tegnUtseendeRader(body); },
  gaTil(id) {
    const g = finnRiggObjekt(id);
    if (!g) return;
    const boks = new THREE.Box3().setFromObject(g);
    flyTil(boks.getCenter(new THREE.Vector3()), boks.getSize(new THREE.Vector3()).length() * 2);
    S.riggValgtId = id;
    oppdaterRiggValgEffekt();
  }
});

// ═══════════════════════ NAVNELAPPENE ═══════════════════════
// Regelen (maks 0.9 m, skjult under 7 px) bor i scene.js — materiellet bruker
// den samme (Emil 25.09). Eksporteres videre herfra for de eksisterende testene.
export { LAPP_MAKS_M, LAPP_MIN_PX, lappStorrelse };
frameHooks.push(() => skalerLapperMedTak(riggGroup));

export function leggRiggIMengder(groups, rows) {
  const liste = riggListe().filter(o => !skjulteTyper.has(o.type));
  for (const r of riggMengdeRader(liste, t)) {
    if (!groups.has(r.key)) groups.set(r.key,
      { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0,
        utenVekt: 0, umulige: 0, nominelle: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.area += r.area; g.flate += r.flate; g.utenVekt++;
    rows.push(r);
  }
}


// 3D-modellene (brakker, toalett, container …) bygges i js/rigg-modell.js.
// toneFarge sendes videre herfra: riggplan.js og testene henter den her.
export { toneFarge };

// Hvilket gjerde og hvilke paneler som er valgt til port (rigg.js setter det).
const gjerdeMark = { id: null, stykker: new Set(), over: null };
export function settGjerdeMarkering(id, stykker, over) {
  gjerdeMark.id = id || null;
  gjerdeMark.stykker = new Set(stykker || []);
  gjerdeMark.over = over == null ? null : over;
}

// Høyden på det ferdige objektet (til navnelappen): brakken i etasjer.
export function riggTotalHoyde(o) {
  return RIGG_TYPER[o.type] && RIGG_TYPER[o.type].moduler ? o.H * (o.etasjer || 1) : o.H;
}

// Hele objektet: en ytre gruppe som står i scenen (posisjon, rotasjon, id),
// med modellen skalert inni og navnelappen ved siden av — ikke inni den
// skalerte gruppa, ellers ville skjermstørrelsen på lappen blitt feil.
export function byggRiggObjekt(o, skala, hoyder) {
  const ytre = new THREE.Group();
  const modell = new THREE.Group();
  const s = 1 / (skala || 1);
  modell.scale.set(s, s, s);
  // Selve modellen bygges i rigg-modell.js. Byggeplass-siden får det enkle
  // nivået (Emil 28.09: raskere på telefonene). Logoen er objektets EGEN
  // (o.logo, valgt i skjemaet — Emil 29.09); rigg.js henter bildet fra
  // SharePoint. Byggeplass-siden har ingen innlogging, og viser ingen logo.
  const logo = !LETT && o.logo && S.riggLogoFor ? S.riggLogoFor(o.logo) : null;
  // ♻ Avfallstypen på søppelcontaineren: skilt med piktogram og navnet (på
  // brukerens språk). Vises også på byggeplass-siden — det er ingen bilder å hente.
  const at = o.avfall ? avfallstype(o.avfall) : null;
  const avfall = at ? { id: at.id, farge: at.farge, tekst: t(at.label).toUpperCase() } : null;
  byggModell(modell, o, hoyder, { enkel: LETT, logo, avfall, mark: gjerdeMark, skiltTekster: { vaskeplass: t("Vaskeplass").toUpperCase(), lagring: t("Lagringsområde").toUpperCase() } });
  ytre.add(modell);
  const n = riggAntall(o);
  let tekst = (o.navn || riggTypeLabel(o.type)) + (n > 1 ? "  ×" + n : "");
  // 🅿 parkeringen viser antall plasser, det er det man lurer på
  if (RIGG_TYPER[o.type] && RIGG_TYPER[o.type].parkering)
    tekst += "  · " + t("{0} plasser", parkeringsPlasser(o.L, o.B).totalt);
  // ➜ Pilene har ingen navnelapp med mindre brukeren har gitt dem et navn:
  // fargen og streken sier hva de er, og en lapp på hver pil ville druknet
  // riggplanen.
  if (erPil(o) && !o.navn) {
    ytre.userData.hoyder = hoyder || null;
    ytre.userData.riggId = o.id;
    ytre.userData.riggType = o.type;
    return ytre;
  }
  const lapp = makeLabel(tekst, o.farge);
  lapp.userData.px = 22;
  lapp.userData.aspect = lapp.scale.x / lapp.scale.y;
  lapp.position.y = (riggTotalHoyde(o) + 0.8) * s;
  if (o.punkter) {
    // 🏷 Gjerdets lapp står PÅ gjerdet (runde 15a): midt på den lengste siden,
    // den sørligste ved likhet — regelen står i gjerdeLappPunkt (rigg-regn.js).
    // Står det bare én skjøt (en kladd), faller den tilbake til midtpunktet.
    const pk = gjerdeLappPunkt(o) || {
      x: o.punkter.reduce((a, q) => a + q.x, 0) / o.punkter.length,
      z: o.punkter.reduce((a, q) => a + q.z, 0) / o.punkter.length
    };
    const hm = Math.max(0, ...(hoyder || [0]));
    lapp.position.set(pk.x * s, (o.H + hm + 0.8) * s, pk.z * s);
  }
  ytre.add(lapp);
  ytre.userData.hoyder = hoyder || null;
  ytre.userData.riggId = o.id;
  ytre.userData.riggType = o.type;
  return ytre;
}

// ═══════════════════════ TEGN OG PLASSER ═══════════════════════

function fjernAlle() {
  riggGroup.children.slice().forEach(o => {
    o.traverse(m => { if (m.geometry) m.geometry.dispose(); });
    riggGroup.remove(o);
  });
}

export function finnRiggObjekt(id) {
  return riggGroup.children.find(o => o.userData.riggId === id) || null;
}

function byggPlassert(o, base, ref, live) {
  const pos = riggScenePos(o, base, ref, live);
  if (!pos) return null;
  const g = byggRiggObjekt(o, base.skala, o.punkter ? gjerdeHoyder(o, base, live, pos.y) : null);
  g.position.set(pos.x, pos.y, pos.z);
  g.rotation.y = pos.rotY;
  return g;
}

// Ett objekt på nytt (rigg.js, mens en skjøt dras): `o` kan være en kladd
// som ikke er lagret ennå. Valget og effekten beholdes.
export function tegnEnRigg(o) {
  const base = riggBase();
  if (!base || !o) return null;
  const gammel = finnRiggObjekt(o.id);
  if (gammel) { gammel.traverse(m => { if (m.geometry) m.geometry.dispose(); }); riggGroup.remove(gammel); }
  const g = byggPlassert(o, base, aktivRef(), S.terrengRef ? S.terrengRef() : null);
  if (g) { riggGroup.add(g); valgEffekt(g, o.id === S.riggValgtId); }
  return g;
}

export function tegnRigg() {
  fjernAlle();
  const base = riggBase();
  if (base) {
    const ref = aktivRef();
    const live = S.terrengRef ? S.terrengRef() : null;
    for (const o of riggListe()) {
      if (o.skjult || skjulteTyper.has(o.type)) continue;
      const g = byggPlassert(o, base, ref, live);
      if (g) riggGroup.add(g);
    }
  }
  if (S.etterTegnRigg) S.etterTegnRigg();
  else oppdaterRiggValgEffekt();
  if (S.ghostPaaNytt) S.ghostPaaNytt();
}

// Bare flytt det som står der. Kalles for hvert musetrekk mens bygget dras
// på terrenget — å bygge alle meshene på nytt da ville vært bortkastet.
export function plasserRigg() {
  const base = riggBase();
  if (!base) return;
  const ref = aktivRef();
  const live = S.terrengRef ? S.terrengRef() : null;
  const alle = new Map(riggListe().map(o => [o.id, o]));
  const gjerder = [];
  for (const g of riggGroup.children.slice()) {
    const o = alle.get(g.userData.riggId);
    if (o && o.punkter) { gjerder.push(o); continue; }
    const pos = o && riggScenePos(o, base, ref, live);
    if (!pos) continue;
    g.position.set(pos.x, pos.y, pos.z);
    g.rotation.y = pos.rotY;
  }
  // Gjerdets føtter står hver på sin bakke — flyttes tomta under, må de
  // regnes på nytt, ikke bare flyttes.
  for (const o of gjerder) tegnEnRigg(o);
}

// terreng.js: bygget er flyttet på tomta, eller terrenget kom eller gikk.
// To ting kan måtte lagres (kontor): objekter lagt inn i byggrammen før noe
// terreng fantes flyttes over på tomta, og referansen (siste kjente
// plassering) oppdateres, så byggeplass-siden og en maskin uten terreng
// tegner riggen på samme sted.
S.riggOmplasser = () => {
  if (!LETT && S.terrengRef) {
    const live = S.terrengRef();
    const ref = live ? vaskRef(live) : null;
    if (ref) {
      const liste = S.rigg || [];
      const naa = new Date().toISOString();
      let endret = false;
      const ny = liste.map(p => {
        if (p && p.ramme === "bygg" && !p.slettet && RIGG_TYPER[p.type]) {
          endret = true;
          return Object.assign(tilUtm(p, ref), { endret: naa });
        }
        return p;
      });
      const gammel = riggRef(ny);
      const harObjekter = riggObjekter(ny).length > 0;
      const refEndret = harObjekter && !likRefSmaa(gammel, ref);
      if (refEndret) {
        const uten = ny.filter(p => p && p.id !== REF_ID);
        uten.push(Object.assign({ id: REF_ID }, ref, { endret: naa }));
        S.rigg = uten;
      } else if (endret) S.rigg = ny;
      if (endret) { tegnRigg(); if (S.riggMeldEndret) S.riggMeldEndret(); return; }
      if (refEndret && S.riggMeldEndret) S.riggMeldEndret();
    }
  }
  plasserRigg();
};

// Referansen regnes lik innenfor en millimeter og en tidel grad — ellers ville
// hvert eneste flyttemusetrekk gitt en ny post (lagringen er uansett samlet).
function likRefSmaa(a, b) {
  if (!a || !b) return !a && !b;
  const n = (x, y, e) => Math.abs(x - y) < e;
  return n(a.E0, b.E0, 1e-3) && n(a.N0, b.N0, 1e-3) && n(a.plass.pE, b.plass.pE, 1e-3) &&
    n(a.plass.pN, b.plass.pN, 1e-3) && n(a.plass.rot, b.plass.rot, 0.05);
}

// ═══════════════════════ 🔵 VALG ═══════════════════════
// Samme blåtone som materiell og elementvalget, men blandet med objektets egne farger (se under).
// 🚧 Gjerdet males IKKE blått når det er valgt: da ville det skjult det som
// betyr noe på gjerdet — røde paneler (for lange), grønne (valgt til port) og
// gule porter. Valget vises med skjøtene (prikkene) i stedet.
// ➜ Pilene males blått som alt annet (runde 15a) — de har ingen panelfarger å
// skjule — men sterkere, se RIGG_SEL_ANDEL_PIL.
// Selve fargingen (riggValgEffekt) bor i rigg-modell.js, så testen kan
// sjekke den med ekte three.
function valgEffekt(g, paa) {
  const type = g.userData.riggType;
  const pil = !!(RIGG_TYPER[type] || {}).pil;
  riggValgEffekt(g, paa && type !== "gjerde", pil ? RIGG_SEL_ANDEL_PIL : undefined);
}

export function oppdaterRiggValgEffekt() {
  riggGroup.children.forEach(o => valgEffekt(o, o.userData.riggId === S.riggValgtId));
}

// ═══════════════════════ BYGGEPLASSEN ═══════════════════════

// Det som sendes med i <fil>.markeringer.json når Byggeplass trykkes (byggeplass.js).
export function riggForByggeplass() {
  return riggForByggeplassFra(S.rigg || [], aktivRef());
}

// markers.js (lettmodus) med `rigg`-feltet. Gamle filer har ikke feltet.
S.settRiggFraLett = (d) => {
  lett = riggFraByggeplass(d);
  tegnRigg();
};

// Modellbytte: riggen hørte til modellen som ble lukket.
S.ryddRigg = () => {
  fjernAlle();
  if (LETT) lett = { ref: null, objekter: [] };
};

// ═══════════════════════ 🎨 UTSEENDE ═══════════════════════
function tegnUtseendeRader(body) {
  if (!body) return;
  const typer = new Map();
  for (const o of riggListe()) typer.set(o.type, (typer.get(o.type) || 0) + riggAntall(o));
  if (!typer.size) return;
  const el = document.createElement("div");
  let html = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
    t("Rigg") + '</div><div class="c"></div></div>';
  for (const k of RIGG_REKKEFOLGE) {
    if (!typer.has(k)) continue;
    html += '<div class="qty-row"><div class="n">' + esc(riggTypeLabel(k)) +
      ' <span style="color:var(--muted);font-size:11px">(' + typer.get(k) + ')</span></div>' +
      '<div class="c"><button data-rigg-hide="' + k + '" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' +
      ikon(skjulteTyper.has(k) ? "skjul" : "vis") + '</button></div></div>';
  }
  el.innerHTML = html;
  body.appendChild(el);
  el.querySelectorAll("button[data-rigg-hide]").forEach(btn => {
    btn.onclick = (e) => {
      const k = e.currentTarget.dataset.riggHide;
      if (skjulteTyper.has(k)) skjulteTyper.delete(k); else skjulteTyper.add(k);
      e.currentTarget.innerHTML = ikon(skjulteTyper.has(k) ? "skjul" : "vis");
      tegnRigg();
      S.qtyCache = null;
      if (S.oppdaterVisAlle) S.oppdaterVisAlle();
    };
  });
}

export function riggTypeSkjult(k) { return skjulteTyper.has(k); }
