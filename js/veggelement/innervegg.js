// 🚪 Innervegger: bygging, tegning, markeringsmodus, eget panel og egen liste.
//
// Én av åtte deler av SW-generatoren. js/veggelement.js er inngangen og
// samler dem; se toppen av den fila for hva generatoren gjør.
//
// DELENE PEKER PÅ HVERANDRE BEGGE VEIER, og det er med vilje: dette var én
// fil på 6500 linjer, og å rive den i atskilte lag ville vært en omskriving,
// ikke en oppdeling. ES-moduler tåler ringer så lenge navnene brukes når
// koden KJØRER, ikke mens modulen lastes — derfor står det bare
// registreringer av lyttere på toppnivå her, aldri utregninger som leser en
// konstant fra en annen del.

import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "../state.js";
import { t } from "../i18n.js";
import { canvas } from "../scene.js";
import { allElementBoxes, hitID, lastNedXlsxFlere, pick } from "../elements.js";
import { hentLogo } from "../tegninger.js";
import { APN_REGEL, APN_SLARK, SW_MIN_BIT_MM, apningPaVegg, delOppMedUtsparinger, eierUtsparing, hentSoyler, innerveggBein, innerveggBiter, innerveggOffset, kappNavn, nesteUtspType, radStabel, samleTetteSoyler, sikreUtspTyper, swListeRader, swNummerering, takLinje, tilMm, tilScene, utspFyllBiter, utsparingerPaFasade } from "./regler.js";
import { STD_OPPSETT, just, lagret, oppsett, skrivLagret, swGroup } from "./tilstand.js";
import { tegnAlt, tegnRingmurBiter, tegnUtspMerkingFor, tegnVeggElementer } from "./tegning.js";
import { byggInnerStabler, felt, generer, lesOppsettFraPanel, materiellArk } from "./generer.js";
import { akseNavnFor, pdfFelt, stalPaFasader } from "./stal.js";
import { avsluttJuster, avsluttUtspMark, startUtspMark, utspListeHtml, utspMark } from "./juster.js";
import { INNER_STD, innerData, innerOppsettForListe, lagretInner, skrivInner, tegnPanel } from "./panel.js";

// ---------- Byggingen av én innervegg ----------
// `perId` er id → søylestabel fra hentSoyler(). Serien lagrer element-IDENE,
// ikke koordinatene: åpnes modellen på nytt, står søylene der de står, og
// veggen kan bygges opp igjen fra samme søyler uten at noe er frosset fast.
export function byggEnInnervegg(serie, perId, fi, nV, nR, globaleUtsp, andreVegger) {
  const o = { ...INNER_STD, ...(serie.o || {}) };
  const soyler = [...new Set((serie.ider || []).map(id => perId.get(id)).filter(Boolean))];
  // ETT HJØRNE = TO BEIN (Emil 08.09). Er søylene på én linje, kommer det ett
  // bein ut, og alt under er bit for bit som en rett innervegg.
  const bein = innerveggBein(soyler, o.knekkGrader, o.lukk);
  if (!bein.length) return null;
  const sg = Number(serie.side) < 0 ? -1 : 1;
  const tS = tilScene(o.tykkelseMm);
  const okBetong = Math.min(...soyler.map(s => s.minY));
  if (Array.isArray(serie.utsparinger)) sikreUtspTyper(serie.utsparinger, okBetong);   // 🚪 punkt 1
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;
  const stabelMm = Math.max(100, (Number(o.veggHoydeMm) || 0) - tilMm(ringH));
  const { rader, kappIndex } = radStabel(stabelMm, o.radHoyder, o.kappNederst);
  const slark = APN_SLARK / (S.enhetSkala || 1);
  const fasader = [], vegger = [], ringmur = [], utspVis = [];

  for (let bi = 0; bi < bein.length; bi++) {
    const akse = bein[bi];
    const beinFi = fi + fasader.length;
    const nx = akse.nx * sg, nz = akse.nz * sg;
    const off = innerveggOffset(akse, sg, tS);
    const rot = Math.atan2(-akse.ez, akse.ex);
    const fx = akse.p.x + nx * off, fz = akse.p.z + nz * off;
    const skjot = samleTetteSoyler(akse.soyler.map(k => tilMm(k.t)), o.minFeltMm);
    const t0 = akse.soyler[0].t, t1 = akse.soyler[akse.soyler.length - 1].t;

    // 🚪 UTSPARINGENE. Kandidatene er både seriens egne (markert inne i
    // innerveggen) og de som er markert med den vanlige «Marker utsparing» —
    // Emil skal ikke måtte huske hvilken knapp han brukte (08.09). Begge sett
    // siles med SAMME regel: veggplanet må gå gjennom åpningsboksen. Da kan en
    // dør i ytterveggen aldri kappe en innervegg, og et bein i en L kan ikke
    // kappes av en dør som står i det andre beinet.
    const fLik = { px: akse.p.x, pz: akse.p.z, ex: akse.ex, ez: akse.ez, nx, nz, t0, t1 };
    // Seriens EGNE åpninger er markert på denne veggen og trenger bare å treffe
    // planet. De GLOBALE må i tillegg ha denne veggen som den nærmeste — ellers
    // stjeler et bein ved ytterveggens hjørne døra som står i ytterveggen.
    const egne = (serie.utsparinger || []).filter(u => u && u.min && u.max);
    const mine = egne.filter(u => apningPaVegg(fLik, u, slark) !== null);
    for (const u of (globaleUtsp || []))
      if (u && u.min && u.max && egne.indexOf(u) === -1 && eierUtsparing(fLik, u, andreVegger, slark) !== null)
        mine.push(u);
    const apninger = utsparingerPaFasade(
      { p: akse.p, ex: akse.ex, ez: akse.ez }, baseY, mine);

    // HJØRNET lappes med del A sin pinwheel-regel (runde 6): det ene beinet
    // løper forbi og dekker naboens endeflate, det andre starter flukt mot
    // naboens innside. Fortegnet leses av NABOENS normal, så et innvendig
    // hjørne (veggen bøyer bort fra panelsiden) trekker seg tilsvarende inn i
    // stedet for å stikke ut i lufta.
    // Frie ender — der det ikke er noe nabobein — er som før: søylesenteret,
    // pluss «Forleng begge ender».
    // Fortegnene er del A sine, ord for ord (runde 6): `sStart` snur fortegnet
    // fordi naboen ligger BAK beinet, `sSlutt` ikke. Peker naboens normal samme
    // vei som beinet løper, er hjørnet utvendig og elementet skal forbi (+off);
    // peker den motsatt, er hjørnet innvendig og elementet skal tilsvarende
    // kortere (−off). Første forsøk her hadde fortegnet snudd i startenden, og
    // det ga et hull på 300 mm i hjørnet — regnet ut, ikke sett.
    const offMm = tilMm(off);
    const sStart = akse.forrigeN
      ? (-Math.sign((akse.forrigeN.x * sg) * akse.ex + (akse.forrigeN.z * sg) * akse.ez) || 1) : 1;
    const sSlutt = akse.nesteN
      ? (Math.sign((akse.nesteN.x * sg) * akse.ex + (akse.nesteN.z * sg) * akse.ez) || 1) : 1;
    // innerveggBiter regner `fra = skjot[0] − eFra` og `til = skjot[siste] + eTil`.
    const eFra = akse.forrigeN ? sStart * offMm - o.tykkelseMm / 2 : (Number(o.endeMm) || 0);
    const eTil = akse.nesteN ? sSlutt * offMm + o.tykkelseMm / 2 : (Number(o.endeMm) || 0);

    const biter = innerveggBiter(skjot, rader, kappIndex, o.klaringMm, SW_MIN_BIT_MM,
      [eFra, eTil], apninger);
    const snappP = [];
    for (const k of akse.soyler) {
      const c = tilMm(k.t), halv = tilMm(k.s.bredde) / 2;
      snappP.push(c - o.klaringMm, c + o.klaringMm, c - halv, c + halv);
    }
    const felles = { fi: beinFi, inner: true, fx, fz, ex: akse.ex, ez: akse.ez, nx, nz, rot,
      tMm: o.tykkelseMm, snapp: snappP };
    for (const b of biter) {
      const tMid = tilScene((b.fraMm + b.tilMm_) / 2);
      vegger.push({ ...felles,
        id: "iv" + (nV + vegger.length), tMid,
        x: fx + akse.ex * tMid, z: fz + akse.ez * tMid,
        y: baseY + tilScene(b.rBunnMm + b.hoydeMm / 2),
        radIdx: b.radIdx, rBunnMm: b.rBunnMm,
        basFraMm: b.fraMm, basTilMm: b.tilMm_, dFra: 0, dTil: 0, rev: 0,
        fraMm: b.fraMm, tilMm: b.tilMm_,
        lengdeMm: b.lengdeMm, fullMm: b.fullMm,
        hoydeMm: b.hoydeMm, radHMm: b.radHMm, hVMm: b.hoydeMm, hHMm: b.hoydeMm,
        apn: b.apn, hull: b.hull,
        tilpassetRad: b.tilpassetRad, tilpasset: b.tilpasset });
    }
    // RINGMUREN UNDER EN INNERVEGG er en fundamentmur fra gulvet og opp, ikke
    // ringmuren rundt bygget: gulvplata og isolasjonen hører til del A og skal
    // ikke lages på nytt inne i bygget.
    if (o.ringmur && biter.length) {
      const rmFra = Math.min(...biter.map(b => b.fraMm));
      const rmTil = Math.max(...biter.map(b => b.tilMm_));
      const rmTopp = 0, rmBunn = -Math.round(tilMm(ringH));
      const rmBit = (bunnMm, hoydeMm, fraMm, tilMm2) => {
        const tMid = tilScene((fraMm + tilMm2) / 2);
        ringmur.push({ ...felles,
          id: "ir" + (nR + ringmur.length), ringmur: true, radIdx: "rm", tMid,
          basFraMm: Math.round(fraMm), basTilMm: Math.round(tilMm2), dFra: 0, dTil: 0, rev: 0,
          fraMm: Math.round(fraMm), tilMm: Math.round(tilMm2),
          lengdeMm: Math.round(tilMm2 - fraMm), fullMm: Math.round(tilMm2 - fraMm),
          bunnMm: Math.round(bunnMm), hoydeMm: Math.round(hoydeMm),
          x: fx + akse.ex * tMid, z: fz + akse.ez * tMid,
          y: baseY + tilScene(bunnMm + hoydeMm / 2),
          lengde: tilScene(tilMm2 - fraMm), hoyde: tilScene(hoydeMm), tykkelse: tS });
      };
      // Ringmuren behandles som en rad: kappes rundt en dør, fyllbit under et
      // vindu (del A, runde 6).
      const rmApn = apninger
        .filter(a => Math.min(a.toppMm, rmTopp) - Math.max(a.bunnMm, rmBunn) > 10);
      for (const [rFra, rTil] of delOppMedUtsparinger(rmFra, rmTil,
          rmApn.map(a => [a.fraMm, a.tilMm_])))
        rmBit(rmBunn, rmTopp - rmBunn, rFra, rTil);
      for (const b of utspFyllBiter(rmBunn, rmTopp, rmFra, rmTil, rmApn, SW_MIN_BIT_MM))
        rmBit(b.bunnMm, b.hoydeMm, b.fraMm, b.tilMm_);
    }
    fasader.push({ px: akse.p.x, pz: akse.p.z, ex: akse.ex, ez: akse.ez, nx, nz,
      t0, t1, off, rot, skjot: skjot.map(v => Math.round(v)), takLinje: null,
      // Oppsettet FØLGER FASADEN. `fi` er indeksen i fasadelista, og faller én
      // serie ut (søylene finnes ikke i denne fila), er den ikke lenger samme
      // indeks som i serier[] — da ville tegningen hentet farge og tykkelse fra
      // feil vegg.
      inner: true,
      navn: (serie.navn || "") + (bein.length > 1 ? " – " + t("bein {0}", bi + 1) : ""),
      o: { ...o }, baseY, okBetong });
    for (const a of apninger)
      utspVis.push({ fi: beinFi, fraMm: Math.round(a.fraMm), tilMm_: Math.round(a.tilMm_),
        bunnMm: Math.round(a.bunnMm), toppMm: Math.round(a.toppMm), type: a.type, navn: a.navn });
  }
  return { fasader, vegger, ringmur, utspVis, baseY, okBetong };
}

// SW-NUMRENE FOR INNERVEGGENE — samme funksjon som ytterveggene, over en annen
// liste. Derfor starter de på SW-01 uten et eneste spesialtilfelle: nummeret
// kommer av HVOR I LISTA lengden dukker opp første gang, og innerveggene har
// sin egen liste.
export function innerveggNummer(vegger, kappTekst) {
  const liste = vegger || [];
  const { numre, nokkel } = swNummerering(liste.filter(v => !v.skjult));
  for (const v of liste) {
    if (v.skjult) { v.sw = ""; continue; }
    if (!v.tilpasset) { v.sw = numre.get(nokkel(v)) || "SW-XX"; continue; }
    v.sw = kappNavn(numre.get(nokkel({ lengdeMm: v.fullMm, hoydeMm: v.hoydeMm })), kappTekst);
  }
  return liste;
}

export function nummererInner(d) {
  innerveggNummer(d.vegger, (oppsett() || {}).kappTekst || "XX");
}

// Bygger ALLE innerveggene på nytt fra seriene. Kalles etter godkjenning, etter
// sletting, og når et oppsett endres — aldri på egen hånd ved åpning av en fil:
// da tegnes de lagrede tallene, akkurat som del A gjør.
export async function byggAlleInnervegger() {
  const d = innerData();
  d.vegger = []; d.ringmur = []; d.fasader = []; d.utspVis = [];
  if (!d.serier.length) return d;
  const alle = await hentSoyler();
  const perId = new Map();
  for (const s of alle) for (const id of s.ider || []) perId.set(id, s);
  const tapte = [];
  d.utspVis = [];
  // De vanlige utsparingene er med som kandidater: Emil skal ikke måtte huske
  // hvilken av de to «Marker utsparing»-knappene han brukte.
  const globale = (oppsett().utsparinger || []).filter(u => u && u.min && u.max);
  for (let i = 0; i < d.serier.length; i++) {
    const serie = d.serier[i];
    const bygd = byggEnInnervegg(serie, perId, d.fasader.length, d.vegger.length,
      d.ringmur.length, globale, (lagret && lagret.fasader) || []);
    if (!bygd) { tapte.push(serie.navn || "?"); continue; }
    for (const f of bygd.fasader) {
      f.serieIdx = i;           // hvilken rad i panelet fasaden hører til
      d.fasader.push(f);
    }
    d.vegger.push(...bygd.vegger);
    d.ringmur.push(...bygd.ringmur);
    d.utspVis.push(...bygd.utspVis);
  }
  nummererInner(d);
  d.apnRegel = APN_REGEL;
  if (tapte.length)
    console.warn("Innervegg: fant ikke søylene til " + tapte.join(", ") +
      " — er det samme modellfil?");
  return d;
}

// ---------- Tegning ----------
export function tegnInnervegger() {
  const d = lagretInner;
  if (!d || !(d.vegger || []).length) return;
  const sk = d.skjul || {};
  if (sk.vegger) return;
  // Hver innervegg har sin egen farge og tykkelse, så elementene tegnes gruppe
  // for gruppe — ett oppsett per serie.
  const perFi = new Map();
  for (const v of d.vegger) {
    if (!perFi.has(v.fi)) perFi.set(v.fi, []);
    perFi.get(v.fi).push(v);
  }
  const redigeres = innerMark && innerMark.steg === "side" ? innerMark.idx : null;
  for (const [fi, liste] of perFi) {
    if (redigeres !== null && redigeres !== undefined
        && (d.fasader[fi] || {}).serieIdx === redigeres) continue;
    const o = { ...INNER_STD, ...((d.fasader[fi] || {}).o || {}) };
    tegnVeggElementer(liste, o, !sk.merking);
    if (!sk.ringmur)
      tegnRingmurBiter(d.ringmur.filter(r => r.fi === fi), !sk.merking);
  }
  if (!sk.merking && ((lagret && lagret.oppsett) || STD_OPPSETT).visUtsp !== false) {
    try {
      tegnUtspMerkingFor((d.utspVis || []).filter(a => perFi.has(a.fi)),
        d.fasader, d.vegger, innerBaseY(), INNER_STD.tykkelseMm);
    } catch (err) { console.warn("Utsparingsmerkinga for innerveggene:", err); }
  }
}

// 👁 Skjulingen av innerveggene. Samme oppskrift som del A (SKJUL_DELER +
// settSkjul), men over innerveggenes egen lagring — «alt» her betyr alle
// innerveggene, ikke alt på bygget.
export const INNER_SKJUL_DELER = [
  { n: "vegger", navn: "Veggelementer" },
  { n: "ringmur", navn: "Ringmur" },
  { n: "merking", navn: "Merking og mål" }
];

export function innerSkjulNaa() {
  const d = lagretInner;
  if (!d) return {};
  if (!d.skjul) d.skjul = {};
  return d.skjul;
}

export function settInnerSkjul(navn, verdi) {
  const d = lagretInner;
  if (!d) return;
  const sk = innerSkjulNaa();
  if (navn === "alt") for (const del of INNER_SKJUL_DELER) sk[del.n] = verdi;
  sk[navn] = verdi;
  if (navn !== "alt" && !verdi) sk.alt = false;
  if (navn !== "alt") sk.alt = INNER_SKJUL_DELER.every(del => sk[del.n]);
  skrivInner();
  tegnAlt();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();   // «Vis alle» skal dukke opp
}

// ---------- A: markeringsmodus ----------
// { steg: "velg" | "side", serie: {ider, side, o, navn}, idx: number|null,
//   merker: Group, forh: Group, ned: {x,y}|null }
export let innerMark = null;

export function innerBarEl() {
  let el = $("swInnerBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swInnerBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

export function tegnInnerBar() {
  const el = innerBarEl();
  // Begge barene står nederst i midten. Står utsparingsmarkeringen på, er den
  // som eier plassen — ellers ville de ligget oppå hverandre.
  if (!innerMark || utspMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const n = innerMark.serie.ider.length;
  if (innerMark.steg === "velg") {
    el.innerHTML =
      '<span style="font-size:12px;max-width:360px">' +
      (innerMark.fasade
        ? t("Trykk på søylene i fasaden — også rundt hjørnet, så blir det flere fasader i ett sett. Trykk en gang til for å fjerne en søyle.")
        : t("Trykk på søylene innerveggen skal stå på — rekka du vil ha veggelementer langs. Trykk en gang til for å fjerne en søyle.")) +
      ' <b>' + t("{0} søyler valgt", n) + '</b></span>' +
      '<button id="swInnerVidere" class="primary" style="padding:3px 10px">' + t("Videre") + '</button>' +
      '<button id="swInnerAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
    $("swInnerVidere").onclick = innerTilSide;
  } else {
    el.innerHTML =
      '<span style="font-size:12px;max-width:340px">' +
      (innerMark.fasade
        ? t("Pila viser hvilken side av søylene fasaden kommer på — utsiden av bygget. Bytt side om den peker inn, og godkjenn.")
        : t("Pila viser hvilken side av søylene veggen står på. Still oppsettet i panelet, bytt side om du vil, og godkjenn.")) +
      '</span>' +
      '<button id="swInnerBytt" style="padding:3px 10px">↔ ' + t("Bytt side") + '</button>' +
      '<button id="swInnerGodkjenn" class="primary" style="padding:3px 10px">✓ ' + t("Godkjenn") + '</button>' +
      '<button id="swInnerAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
    $("swInnerBytt").onclick = () => {
      innerMark.serie.side = innerMark.serie.side < 0 ? 1 : -1;
      innerForhandsvis();
    };
    $("swInnerGodkjenn").onclick = () => innerMark.fasade ? fasadeGodkjenn() : innerGodkjenn();
  }
  $("swInnerAvbryt").onclick = () => avsluttInnerMark();
}

// `forFasade` = true: SAMME markering, men resultatet blir en manuell FASADE i
// del A (punkt 6) i stedet for en innerveggserie. Forhåndsvisningen bruker
// del A sitt oppsett (tykkelse, farge, rader, ringmur), så pila og veggen
// står der de faktisk kommer.
export async function startInnerMark(idx, forFasade) {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  if (utspMark) avsluttUtspMark();
  if (just) avsluttJuster();
  const d = innerData();
  const eksisterende = !forFasade && idx !== null && idx !== undefined ? d.serier[idx] : null;
  const oA = oppsett();
  innerMark = {
    steg: eksisterende ? "side" : "velg",
    idx: eksisterende ? idx : null,
    fasade: !!forFasade,
    serie: eksisterende
      ? JSON.parse(JSON.stringify(eksisterende))
      : forFasade
        ? { ider: [], side: 1, navn: t("Fasade {0}", (oA.manuelleFasader || []).length + 1),
            o: { ...INNER_STD, tykkelseMm: oA.tykkelseMm, farge: oA.farge, radHoyder: oA.radHoyder,
                 kappNederst: oA.kappNederst, klaringMm: oA.klaringMm, minFeltMm: oA.minFeltMm,
                 ringmur: oA.ringmur, ringHoydeMm: oA.ringHoydeMm, lukk: false } }
        : { ider: [], side: 1, o: { ...d.oppsett },
            navn: t("Innervegg {0}", d.serier.length + 1) },
    merker: new THREE.Group(), forh: new THREE.Group(), ned: null,
    soyler: [], perId: new Map()
  };
  swGroup.add(innerMark.merker, innerMark.forh);
  const oss = innerMark;
  const funnet = await hentSoyler();
  if (innerMark !== oss) return;    // avbrutt mens vi ventet
  innerMark.soyler = funnet;
  innerMark.perId = new Map();
  for (const sø of innerMark.soyler) for (const id of sø.ider || []) innerMark.perId.set(id, sø);
  if (eksisterende) {
    tegnAlt();              // den redigerte veggen tas ut av den faste tegninga
    innerForhandsvis();
    apnePanel("swPanel");
  }
  else { $("swPanel").classList.remove("open"); }
  merkInnerSoyler();
  tegnInnerBar();
  tegnPanel();
}

export function avsluttInnerMark() {
  if (!innerMark) return;
  for (const g of [innerMark.merker, innerMark.forh]) {
    g.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    swGroup.remove(g);
  }
  innerMark = null;
  tegnInnerBar();
  // Tegner opp igjen fra lagringen: avbryter Emil en redigering, skal den
  // veggen komme tilbake slik den var godkjent — ikke bli borte til neste gang
  // noe annet tegner.
  tegnAlt();
  tegnPanel();
  apnePanel("swPanel");
}

export function innerTilSide() {
  if (!innerMark) return;
  if (innerMark.serie.ider.length < 2) {
    alert(t("Marker minst to søyler — de to ytterste bestemmer veggens retning og lengde."));
    return;
  }
  if (innerMark.fasade) {
    // Fasadens høyde er søyletoppen — som del A regner den — ikke et tall
    // Emil skriver. Forhåndsvisningen skal se ut som resultatet.
    const valgte = innerMark.serie.ider.map(id => innerMark.perId.get(id)).filter(Boolean);
    if (valgte.length) {
      const bunn = Math.min(...valgte.map(sø => sø.minY)), topp = Math.max(...valgte.map(sø => sø.maxY));
      innerMark.serie.o.veggHoydeMm = Math.max(200, Math.round(tilMm(topp - bunn)));
    }
  }
  innerMark.steg = "side";
  innerForhandsvis();
  tegnInnerBar();
  tegnPanel();
  apnePanel("swPanel");
}

// Blå kasse rundt hver markerte søyle — samme språk som flatemerket i
// utsparingsmarkeringen, bare rundt hele søyla.
export function merkInnerSoyler() {
  if (!innerMark) return;
  const g = innerMark.merker;
  g.children.slice().forEach(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    g.remove(m);
  });
  const bokser = allElementBoxes();
  for (const id of innerMark.serie.ider) {
    const b = bokser.get(id);
    if (!b) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35,
        depthWrite: false }));
    const vokse = 0.02 / (S.enhetSkala || 1);
    m.scale.set(b.max.x - b.min.x + vokse, b.max.y - b.min.y + vokse, b.max.z - b.min.z + vokse);
    m.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    m.renderOrder = 997;
    g.add(m);
  }
}

// C: forhåndsvisningen — veggen der den faktisk kommer, og PILA som peker på
// siden. Emil skal se svaret før han godkjenner, ikke etterpå.
export function innerForhandsvis() {
  if (!innerMark || innerMark.steg !== "side") return;
  const g = innerMark.forh;
  g.children.slice().forEach(m => {
    m.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    g.remove(m);
  });
  const globale = (oppsett().utsparinger || []).filter(u => u && u.min && u.max);
  const bygd = byggEnInnervegg(innerMark.serie, innerMark.perId, 0, 0, 0, globale, (lagret && lagret.fasader) || []);
  if (!bygd || !bygd.fasader.length) return;
  innerMark.bygd = bygd;
  const o = { ...INNER_STD, ...(innerMark.serie.o || {}) };
  // Elementene tegnes i EN EGEN gruppe, ikke i swGroup direkte: forhåndsvisningen
  // skal kunne rives uten å røre resten av tegninga.
  const foer = swGroup.children.length;
  tegnVeggElementer(bygd.vegger, o, true);
  tegnRingmurBiter(bygd.ringmur, false);
  const nye = swGroup.children.slice(foer);
  for (const m of nye) { swGroup.remove(m); g.add(m); }
  // Pila: fra søyleaksen og ut mot den valgte siden, midt på hvert bein. Ett
  // hjørne har to bein, og da skal begge pilene peke samme vei ut av rommet —
  // det er hele beviset på at siden ble riktig.
  for (const f of bygd.fasader) {
    const tMid = (f.t0 + f.t1) / 2;
    const start = new THREE.Vector3(f.px + f.ex * tMid,
      bygd.baseY + tilScene(o.veggHoydeMm) * 0.6, f.pz + f.ez * tMid);
    const lengde = Math.max(f.off * 2.5, tilScene(1500));
    const pil = new THREE.ArrowHelper(new THREE.Vector3(f.nx, 0, f.nz).normalize(),
      start, lengde, 0x22c55e, lengde * 0.28, lengde * 0.16);
    pil.renderOrder = 998;
    g.add(pil);
  }
}

export async function innerGodkjenn() {
  if (!innerMark) return;
  const d = innerData();
  const serie = JSON.parse(JSON.stringify(innerMark.serie));
  if (innerMark.idx !== null && innerMark.idx !== undefined) d.serier[innerMark.idx] = serie;
  else d.serier.push(serie);
  // Oppsettet den siste veggen fikk blir malen for den neste — Emil skal ikke
  // skrive samme vegghøyde på nytt for hver vegg i samme bygg.
  d.oppsett = { ...d.oppsett, ...serie.o };
  avsluttInnerMark();
  await byggAlleInnervegger();
  byggInnerStabler();      // 📦 leveransestablene og Mengder følger med
  skrivInner();
  tegnAlt();
  tegnPanel();
}

// 🧭 Godkjenn en manuell fasade: settet lagres i del A-oppsettet, og veggene
// genereres på nytt — nå BARE på de manuelle fasadene.
export async function fasadeGodkjenn() {
  if (!innerMark || !innerMark.fasade) return;
  const o = oppsett();
  const sett = { ider: innerMark.serie.ider.slice(), side: innerMark.serie.side < 0 ? -1 : 1,
                 lukk: !!(innerMark.serie.o && innerMark.serie.o.lukk) };
  if (sett.ider.length < 2) { alert(t("Marker minst to søyler — de to ytterste bestemmer veggens retning og lengde.")); return; }
  o.manuelleFasader = (o.manuelleFasader || []).concat([sett]);
  skrivLagret();
  avsluttInnerMark();
  await generer();
  tegnPanel();
}
// Slett ett sett, eller alle: er lista tom, er automatikken på igjen.
export async function slettManuellFasade(idx) {
  const o = oppsett();
  const liste = o.manuelleFasader || [];
  if (idx === null || idx === undefined) {
    if (!liste.length) return;
    if (!confirm(t("Slette alle manuelle fasader og la automatikken finne fasadene igjen?"))) return;
    o.manuelleFasader = [];
  } else {
    liste.splice(idx, 1);
    o.manuelleFasader = liste;
  }
  skrivLagret();
  if (lagret && (lagret.vegger || []).length) await generer();
  tegnPanel();
}

// Bygger innerveggene på nytt fordi den GLOBALE utsparingslista er endret.
// Gjør ingenting når det ikke finnes innervegger — da er dette del A alene.
export function oppdaterInnerveggerEtterUtsp() {
  if (!lagretInner || !(lagretInner.serier || []).length) return;
  byggAlleInnervegger()
    .then(() => {
      byggInnerStabler();
      skrivInner();
      tegnAlt();
      tegnPanel();
    })
    .catch(err => console.warn("Innerveggene kunne ikke bygges på nytt:", err));
}

export async function slettInnervegg(idx) {
  const d = innerData();
  const s = d.serier[idx];
  if (!s) return;
  if (!confirm(t("Slette «{0}»?", s.navn || "?"))) return;
  d.serier.splice(idx, 1);
  await byggAlleInnervegger();
  byggInnerStabler();
  skrivInner();
  tegnAlt();
  tegnPanel();
}

// Klikkene: samme oppskrift som utsparingsmarkeringen — bare et trykk under
// 8 px behandles, og bare når det landet på lerretet.
window.addEventListener("pointerdown", (e) => {
  if (!innerMark || innerMark.steg !== "velg" || e.button !== 0) return;
  if (e.target !== canvas) { innerMark.ned = null; return; }
  innerMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!innerMark || innerMark.steg !== "velg" || e.button !== 0 || !innerMark.ned) return;
  if (e.target !== canvas) { innerMark.ned = null; return; }
  const ned = innerMark.ned;
  innerMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const hit = pick(e.clientX, e.clientY);
  const id = hit ? hitID(hit) : null;
  if (id == null) return;
  // BARE SØYLER. Trykker Emil på en bjelke eller en plate, sier baren det i
  // stedet for å ta den med og gi en vegg med gal retning.
  if (!innerMark.perId.has(id)) {
    innerMark.feil = t("Det elementet er ikke en søyle (IfcColumn) — innerveggen står på søyler.");
    tegnInnerBar();
    return;
  }
  innerMark.feil = null;
  const i = innerMark.serie.ider.indexOf(id);
  if (i >= 0) innerMark.serie.ider.splice(i, 1);
  else innerMark.serie.ider.push(id);
  merkInnerSoyler();
  tegnInnerBar();
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && innerMark && !utspMark) { e.stopPropagation(); avsluttInnerMark(); }
}, true);

// ---------- Panelet: 🚪 Innervegger ----------
export function innerOppsettFelter(serie) {
  const s = serie || {};
  const o = { ...INNER_STD, ...(s.o || {}) };
  const utsp = (s.utsparinger || []).filter(u => u && u.min && u.max);
  return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px">' +
    '<b style="font-size:12px">' + esc(s.navn || "") + '</b>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("{0} søyler markert. Still oppsettet, velg side med pila i modellen, og trykk Godkjenn i baren nederst.",
        (s.ider || []).length) + '</p>' +
    '<label>' + t("Navn") + '<input type="text" id="swIvNavn" maxlength="40" value="' +
      esc(s.navn || "") + '"></label>' +
    felt("swIvHoyde", "Vegghøyde over gulv (mm) — topp vegg", o.veggHoydeMm) +
    '<label>' + t("Radhøyder nedenfra (mm) — tom = automatisk") +
      '<input type="text" id="swIvRadH" maxlength="200" value="' + esc(o.radHoyder || "") + '"></label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvKappNed"' +
      (o.kappNederst ? " checked" : "") + '> ' + t("Tilpasningsraden nederst") + '</label>' +
    felt("swIvTykk", "Tykkelse (mm)", o.tykkelseMm) +
    '<label>' + t("Farge") + '<input type="color" id="swIvFarge" value="' + esc(o.farge) + '"></label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvRingmur"' +
      (o.ringmur ? " checked" : "") + '> ' + t("Med ringmur under innerveggen") + '</label>' +
    felt("swIvRingH", "Ringmurhøyde over gulv (mm)", o.ringHoydeMm) +
    felt("swIvEnde", "Forleng frie ender forbi ytterste søyle (mm)", o.endeMm) +
    felt("swIvKlaring", "Klaring fra søylesenter (mm)", o.klaringMm) +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvLukk"' +
      (o.lukk ? " checked" : "") + '> ' + t("Lukk veggen rundt et rom (siste bein tilbake til første søyle)") + '</label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 8px">' +
      t("Vegghøyden måles fra gulvet til topp vegg. Står veggen på ringmur, er ringmuren en del av den høyden — SW-elementene fyller resten.") + '<br>' +
      t("Frie ender står i første og siste søylesenter. Skal veggen gå helt inn til ytterveggen, skriv hvor mye den skal forlenges — hjørnene lappes av seg selv.") + '<br>' +
      t("Marker søylene rundt hjørnet, og veggen knekker der rekka knekker. Skal den gå helt rundt et rom, kryss av «Lukk veggen».") + '</p>' +
    // 🚪 Utsparingene hører til DENNE veggen, ikke til bygget: to innervegger
    // kan stå rygg mot rygg, og en dør i den ene skal ikke skjære den andre.
    '<h4 style="margin:8px 0 4px;font-size:12px">' + t("Utsparinger i denne veggen") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Trykk «Marker utsparing» og pek på flatene rundt åpningen — innsiden av søylene på hver side, undersiden av bjelken over. Én flate per side.") + '<br>' +
      t("Åpninger du har markert med den vanlige «Marker utsparing» over kommer også med: en åpning kapper den veggen den faktisk står i.") + '</p>' +
    '<div class="prop-actions"><button id="swIvNyUtsp">' + ikon("boks") + ' ' +
      t("Marker utsparing") + '</button></div>' +
    utspListeHtml(utsp, "data-sw-iv-slett-utsp", t("Ingen utsparinger i denne veggen."), false) +
    '</div>';
}

// 🧭 Fasadevelgeren i panelet (punkt 6): lista over manuelle sett, «Ny
// fasade», og en tydelig melding om at automatikken er av når settene finnes.
export function fasadePanelHtml(o) {
  const sett = o.manuelleFasader || [];
  const redigerer = innerMark && innerMark.fasade && innerMark.steg === "side";
  return '<h4 data-sek="fasader" style="margin:10px 0 4px">' + ikon("fasade") + ' ' + t("Fasader") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      (sett.length
        ? '<b>' + t("Automatikken er AV: bare fasadene under brukes.") + '</b> ' +
          t("Slett alle for å la randvandringen finne fasadene igjen.")
        : t("Fasadene finnes automatisk (randvandring langs søylene under søyleforlengerne). Har modellen ingen forlengere, sett fasadene for hånd: marker søylene, pek på utsiden, godkjenn.")) + '</p>' +
    (sett.length
      ? sett.map((m, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(t("Fasade {0}", i + 1)) +
          ' <span style="color:var(--muted)">' + t("{0} søyler", (m.ider || []).length) +
          (m.lukk ? " · " + t("lukket") : "") + '</span></div>' +
        '<div class="c"><button data-sw-fasade-slett="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")
      : "") +
    '<div class="prop-actions" style="flex-wrap:wrap"><button id="swFasadeNy">' + ikon("boks") + ' ' + t("Ny fasade (manuelt)") + '</button>' +
    (sett.length ? '<button id="swFasadeSlettAlle">' + ikon("slett") + ' ' + t("Slett alle manuelle fasader") + '</button>' : "") +
    '</div>' +
    (redigerer
      ? '<label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="swFasadeLukk"' +
        (innerMark.serie.o.lukk ? " checked" : "") + '> ' + t("Lukk rundt bygget (siste fasade tilbake til første søyle)") + '</label>'
      : "");
}

export function innerPanelHtml() {
  const d = innerData();
  const redigerer = innerMark && innerMark.steg === "side" && !innerMark.fasade;
  // Elementene telles per SERIE, ikke per fasadeindeks: faller én serie ut,
  // er de to ikke lenger de samme tallene.
  const antPer = new Map();
  for (const v of d.vegger) {
    const si = ((d.fasader[v.fi] || {}).serieIdx);
    if (si === undefined) continue;
    antPer.set(si, (antPer.get(si) || 0) + (v.skjult ? 0 : 1));
  }
  // Hvor mange BEIN veggen ble delt i — ett hjørne gir to. Står det 1 der Emil
  // markerte et hjørne, er det knekkgrensa som ikke slo til, og da er tallet
  // det første stedet å se.
  const beinPer = new Map();
  for (const f of d.fasader)
    if (f.serieIdx !== undefined) beinPer.set(f.serieIdx, (beinPer.get(f.serieIdx) || 0) + 1);
  return '<h4 data-sek="inner" style="margin:14px 0 4px">' + ikon("dor") + ' ' + t("Innervegger (egen SW-serie)") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Innerveggene finnes ikke automatisk — du markerer søylene de skal stå på. De får sin egen SW-serie som starter på SW-01, sin egen instruksjonstegning og sitt eget regneark. Ytterveggene over røres ikke.") + '</p>' +
    (d.serier.length
      ? d.serier.map((s, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(s.navn || ("#" + (i + 1))) +
          ' <span style="color:var(--muted)">' +
          t("{0} søyler", (s.ider || []).length) + " · " +
          ((beinPer.get(i) || 1) > 1 ? t("{0} bein", beinPer.get(i)) + " · " : "") +
          t("{0} element", antPer.get(i) || 0) + " · " +
          (s.o && s.o.veggHoydeMm ? s.o.veggHoydeMm + " mm" : "") + '</span></div>' +
        '<div class="c">' +
          '<button data-sw-inner-endre="' + i + '" title="' + t("Endre") + '" style="padding:3px 8px">' + ikon("juster") + '</button> ' +
          '<button data-sw-inner-slett="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button>' +
        '</div></div>').join("")
      : '<p style="color:var(--muted);font-size:12px">' + t("Ingen innervegger ennå.") + '</p>') +
    '<div class="prop-actions"><button id="swInnerNy">' + ikon("boks") + ' ' +
      t("Ny innervegg") + '</button></div>' +
    (redigerer ? innerOppsettFelter(innerMark.serie) : "") +
    (d.vegger.length
      ? '<div class="prop-actions" style="margin-top:8px;flex-wrap:wrap">' +
        '<button id="swInnerTegning">' + ikon("tegning") + ' ' + t("Innervegg: tegning (PDF)") + '</button>' +
        '<button id="swInnerListe">' + ikon("lastned") + ' ' + t("Innervegg: liste (Excel)") + '</button>' +
        '</div>' +
        '<p style="color:var(--muted);font-size:12px;margin-top:4px">' +
          t("{0} innveggselementer i egen serie fra SW-01.", d.vegger.filter(v => !v.skjult).length) +
          " " + t("«Juster elementer» over tar også disse.") + '</p>' +
        '<label>' + t("Tegningsnummer for innerveggene") +
          '<input type="text" id="swIvPdfNr" maxlength="30" value="' + esc(d.oppsett.pdfNr || "SWI-01") + '"></label>'
      : "");
}

export function lesInnerFraPanel() {
  if (!innerMark || innerMark.steg !== "side" || innerMark.fasade) return;
  const o = innerMark.serie.o = { ...INNER_STD, ...(innerMark.serie.o || {}) };
  const num = (id, std) => { const n = Number(($(id) || {}).value); return isFinite(n) && n >= 0 ? n : std; };
  if ($("swIvNavn")) innerMark.serie.navn = ($("swIvNavn").value || "").trim() || innerMark.serie.navn;
  o.veggHoydeMm = Math.max(200, Math.min(30000, num("swIvHoyde", o.veggHoydeMm)));
  o.radHoyder = (($("swIvRadH") || {}).value || "").trim();
  o.kappNederst = !!($("swIvKappNed") || {}).checked;
  o.tykkelseMm = Math.max(30, Math.min(500, num("swIvTykk", o.tykkelseMm)));
  o.farge = ($("swIvFarge") || {}).value || o.farge;
  o.ringmur = !!($("swIvRingmur") || {}).checked;
  o.ringHoydeMm = Math.max(0, Math.min(3000, num("swIvRingH", o.ringHoydeMm)));
  o.endeMm = Math.max(0, Math.min(3000, num("swIvEnde", o.endeMm)));
  o.klaringMm = Math.max(0, Math.min(100, num("swIvKlaring", o.klaringMm)));
  o.lukk = !!($("swIvLukk") || {}).checked;
}

// Panelets knapper og felter. Kalles fra tegnPanel().
export function koblInnerPanel(body) {
  const d = innerData();
  if ($("swInnerNy")) $("swInnerNy").onclick = () => { lesOppsettFraPanel(); startInnerMark(null); };
  body.querySelectorAll("button[data-sw-inner-endre]").forEach(b =>
    b.onclick = () => startInnerMark(Number(b.dataset.swInnerEndre)));
  body.querySelectorAll("button[data-sw-inner-slett]").forEach(b =>
    b.onclick = () => slettInnervegg(Number(b.dataset.swInnerSlett)));
  if ($("swIvPdfNr")) $("swIvPdfNr").onchange = () => {
    d.oppsett.pdfNr = ($("swIvPdfNr").value || "").trim() || "SWI-01";
    skrivInner();
  };
  // Hvert felt i oppsettet tegner forhåndsvisningen på nytt: Emil ser veggen
  // endre seg mens han skriver, i stedet for å måtte godkjenne for å se svaret.
  for (const id of ["swIvHoyde", "swIvRadH", "swIvKappNed", "swIvTykk", "swIvFarge",
                    "swIvRingmur", "swIvRingH", "swIvEnde", "swIvKlaring", "swIvNavn",
                    "swIvLukk"]) {
    const el = $(id);
    if (!el) continue;
    el.onchange = () => { lesInnerFraPanel(); innerForhandsvis(); tegnPanel(); };
  }
  if ($("swIvNyUtsp")) $("swIvNyUtsp").onclick = () => {
    lesInnerFraPanel();
    startUtspMark(true);
  };
  body.querySelectorAll("button[data-sw-iv-slett-utsp]").forEach(b =>
    b.onclick = () => {
      if (!innerMark) return;
      lesInnerFraPanel();
      (innerMark.serie.utsparinger || []).splice(Number(b.dataset.swIvSlettUtsp), 1);
      innerForhandsvis();
      tegnPanel();
    });
  body.querySelectorAll("button[data-sw-iv-type-utsp]").forEach(b =>
    b.onclick = () => {
      if (!innerMark) return;
      lesInnerFraPanel();
      const u = (innerMark.serie.utsparinger || [])[Number(b.dataset.swIvTypeUtsp)];
      if (!u) return;
      u.type = nesteUtspType(u.type);
      innerForhandsvis();   // byggEnInnervegg gir nytt navn og ny merking
      tegnPanel();
    });
  if ($("swInnerListe")) $("swInnerListe").onclick = lastNedInnerListe;
  if ($("swInnerTegning")) $("swInnerTegning").onclick = lastNedInnerTegning;
}

// ---------- E: egen liste og egen tegning ----------
export function lastNedInnerListe() {
  const d = innerData();
  const synlige = d.vegger.filter(v => !v.skjult);
  if (!synlige.length) { alert(t("Lag en innervegg først.")); return; }
  // Tykkelsen kan være ulik fra vegg til vegg, så den føres PER ELEMENT i
  // stedet for som ett tall i toppen: to innervegger på 100 og 150 mm skal
  // ikke slås sammen til én kolonne som er feil for begge.
  const a = oppsett();
  const rader = swListeRader(synlige, {
    prosjekt: a.prosjekt, oppdragsnr: a.oppdragsnr, sted: a.sted, sign: a.sign,
    dato: new Date().toLocaleDateString("no-NO"),
    tykkelseMm: [...new Set(synlige.map(v => v.tMm))].join(" / "),
    isolasjon: a.isolasjon, utvFarge: a.utvFarge, innFarge: a.innFarge
  });
  const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  lastNedXlsxFlere(navn + " - SW-liste innervegg.xlsx", [{ navn: t("SW-liste innervegg"), rader }, materiellArk()])
    .catch(err => {
      console.warn("Innerveggslista kunne ikke lages:", err);
      alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
    });
}

export async function lastNedInnerTegning() {
  const d = innerData();
  if (!d.vegger.length || !d.fasader.length) { alert(t("Lag en innervegg først.")); return; }
  const knapp = $("swInnerTegning");
  if (knapp) knapp.disabled = true;
  try {
    const mod = await import("./sw-tegning.js");
    // Oppsettet tegninga får er innerveggenes eget — men bare ÉN tykkelse og
    // ett ringmuroppsett kan stå i tittelfeltet. Den første veggens oppsett
    // brukes, og de andre står med sine egne mål på elementene.
    const so = { ...INNER_STD, ...((d.fasader[0] || {}).o || {}) };
    const o = innerOppsettForListe(so);
    const navnere = new Map();
    const navnFor = (fi) => {
      if (!navnere.has(fi)) navnere.set(fi, akseNavnFor(fi, d.fasader));
      return navnere.get(fi);
    };
    await mod.lastNedTegning({
      vegger: d.vegger,
      fasader: d.fasader,
      oppsett: o,
      utsparinger: d.utspVis || [],
      ringmurBiter: mod.ringmurTilFasader(d.ringmur, d.fasader, tilMm, innerBaseY()),
      tilMm, tilScene,
      stal: await stalPaFasader(d.fasader, o, innerBaseY()),
      aksenavn: (fi, mm) => navnFor(fi)(fi, mm),
      felt: pdfFelt(o, mod.idag()),
      // En innervegg har ingen gesims.
      toppNavn: "Topp vegg",
      hentLogo: () => hentLogo((($("swPdfLogo") || {}).value) || "")
    });
  } catch (err) {
    console.warn("Innervegg-tegning:", err);
    alert(t("Klarte ikke å lage tegninga: ") + (err && err.message || err));
  } finally {
    const b = $("swInnerTegning");
    if (b) b.disabled = false;
  }
}

// SW-basen for innerveggene. Flere innervegger kan i prinsippet stå på ulik
// høyde; stålet og ringmuren projiseres mot den FØRSTE veggens base, som er
// den tegninga er stilt inn etter.
export function innerBaseY() {
  const d = lagretInner;
  if (d && (d.fasader || []).length && d.fasader[0].baseY !== undefined) return d.fasader[0].baseY;
  for (const v of (d && d.vegger) || [])
    if (v.rBunnMm !== undefined && v.hoydeMm) return v.y - tilScene(v.rBunnMm + v.hoydeMm / 2);
  return 0;
}

på("btnSW", "click", () => {
  const panel = $("swPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("swPanel");
});
