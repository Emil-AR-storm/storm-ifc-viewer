// 🗃 Delt tilstand: swGroup, det lagrede resultatet, skjul/valg og lagringen
// (lokalt og i SharePoint). Alt som flere av de andre delene endrer, bor her.
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
import { $, S, apnePanel, esc, ikon, registrerEkstraGruppe } from "../state.js";
import { t } from "../i18n.js";
import { allElementBoxes } from "../elements.js";
import { camera, flyTil, scene } from "../scene.js";
import { settValgEffekt } from "../materiell-vis.js";
import { flettPaaNavn, spLes, spPaalogget, spSkriv } from "../sp-lager.js";
import { SW_KLARING_MM, SW_MIN_FELT_MM, SW_MIN_SKRA_MM, rektMinusHull, sikreUtspTyper, skraVinkel, soyleTypeNavn, tilScene, vinkelTekst } from "./regler.js";
import { baseYNaa, tegnAlt, utspPaFasader } from "./tegning.js";
import { byggAlleStabler, fjernGenerertMateriell, loesAlleJusteringer } from "./generer.js";
import { pekVegg, veggMedId } from "./juster.js";
import { INNER_STD, lagretInner, skrivInner, tegnPanel } from "./panel.js";
import { innerBaseY, innerMark } from "./innervegg.js";

// per modellfil — da kan det tegnes opp igjen uten å regne på nytt.
export const swGroup = new THREE.Group();
scene.add(swGroup);
// Laget melder inn hva det kan (se EKSTRA_LAG i js/state.js). SW har to
// skjulinger på samme form: `lagret.skjul` for det ytre bygget og
// `lagretInner.skjul` for innerveggene. Begge hentes fram av «Vis alle», og
// begge tegnes opp igjen i ÉN tegnAlt() — to kall ville tegnet hele bygget om
// igjen to ganger på ett klikk.
registrerEkstraGruppe(swGroup, {
  id: "sw",
  navn: "SW-elementer",
  noeSkjult: () => swSkjultId.size > 0 ||
    Object.values((lagret && lagret.skjul) || {}).some(Boolean) ||
    Object.values((lagretInner && lagretInner.skjul) || {}).some(Boolean),
  visAlt() {
    if (!this.noeSkjult()) return;
    swSkjultId.clear();
    if (lagret) { lagret.skjul = {}; }
    if (lagretInner) { lagretInner.skjul = {}; }
    skrivSkjulteIder();
    if (lagret) skrivLagret();
    if (lagretInner) skrivInner();
    tegnAlt();
    if (S.tegnUtseendePanel) S.tegnUtseendePanel();
  },
  skjulTilstand: () => ({
    ytre: Object.assign({}, (lagret && lagret.skjul) || {}),
    indre: Object.assign({}, (lagretInner && lagretInner.skjul) || {}),
    ider: [...swSkjultId]
  }),
  settSkjulTilstand(v) {
    const t = v || {};
    if (lagret) { lagret.skjul = Object.assign({}, t.ytre || {}); }
    if (lagretInner) { lagretInner.skjul = Object.assign({}, t.indre || {}); }
    swSkjultId.clear();
    for (const id of (t.ider || [])) swSkjultId.add(id);
    skrivSkjulteIder();
    if (lagret) skrivLagret();
    if (lagretInner) skrivInner();
    tegnAlt();
    if (S.tegnUtseendePanel) S.tegnUtseendePanel();
  },

  // ---------- Plukking, valg og skjuling ett og ett ----------
  // pick() i elements.js ser BARE S.modelGroup, med vilje. Derfor svarer laget
  // selv på «hva ligger under pekeren her» — og gir avstanden, så kallstedet
  // kan avgjøre hvem som lå nærmest kameraet: modellen, materiellet eller SW.
  plukk(cx, cy) {
    if (!swGroup.children.length) return null;
    const tr = pekVegg(cx, cy);
    if (!tr) return null;
    return { id: tr.v.id, navn: tr.v.sw || "", avstand: camera.position.distanceTo(tr.punkt) };
  },
  velg(ider) {
    const nye = new Set(ider || []);
    // Ingen endring? Ikke mal om. oppdaterSwValgEffekt går gjennom hele
    // swGroup, og clearSelection() kalles ved hver eneste visningsendring.
    if (nye.size === swValgt.size && [...nye].every(id => swValgt.has(id))) return;
    swValgt.clear();
    for (const id of nye) swValgt.add(id);
    oppdaterSwValgEffekt();
  },
  valgte: () => [...swValgt],
  skjul(ider) {
    let nye = 0;
    for (const id of (ider || [])) if (!swSkjultId.has(id)) { swSkjultId.add(id); nye++; }
    if (!nye) return;
    for (const id of (ider || [])) swValgt.delete(id);
    skrivSkjulteIder();
    tegnAlt();
    $("propPanel").classList.remove("open");
    if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  },

  // Egenskapspanelet for ett SW-element. Bor her og ikke i elements.js fordi
  // det er SW-tallene som skal stå der — og fordi «Skjul dette elementet» må
  // treffe dette lagets skjuling, ikke modellens hiddenIDs.
  visEgenskaper(id) {
    const v = veggMedId(id);
    if (!v) return;
    const rad = (k, val) => '<div class="prop-row"><div class="k">' + esc(k) +
      '</div><div class="v">' + esc(String(val)) + '</div></div>';
    const erRm = !!v.ringmur;
    $("propTitle").textContent = erRm ? t("Ringmur") : (v.sw || t("Veggelement"));
    $("propBody").innerHTML =
      '<div class="prop-actions"><button id="paSkjulSw">' + ikon("skjul") + ' ' +
      t("Skjul dette elementet") + '</button></div>' +
      rad(t("Type"), erRm ? t("Ringmur") : (v.inner ? t("Innervegg") : t("Yttervegg"))) +
      (v.sw ? rad(t("SW-nummer"), v.sw) : "") +
      rad(t("Lengde"), (v.lengdeMm || 0) + " mm") +
      rad(t("Høyde"), v.skra ? (v.hVMm + "/" + v.hHMm + " mm") : ((v.hoydeMm || 0) + " mm")) +
      rad(t("Tykkelse"), (v.tMm || 0) + " mm") +
      '<p style="color:var(--muted); font-size:11px; margin-top:8px">' +
      t("Skjulte SW-elementer hentes fram igjen med «Vis alle».") + '</p>';
    $("paSkjulSw").onclick = () => this.skjul([id]);
    apnePanel("propPanel");
  },

  // 🎨 Utseende: radene bor lenger nede (S.swUtseendeRader) fordi de trenger
  // lagret/lagretInner. Her meldes bare evnen inn.
  utseendeRader(body) { if (S.swUtseendeRader) S.swUtseendeRader(body); },

  // ---------- 📊 Mengder og 🔎 Elementsøk ----------
  mengder: (groups, rows) => leggSwIMengder(groups, rows),
  sokRader: () => swAlle().map(({ v, erRm }) => {
    const navn = erRm ? t("Ringmur") : (v.sw || t("Veggelement"));
    const maal = (v.lengdeMm || 0) + "×" + swHoydeMm(v) + " mm";
    const under = [v.inner ? t("Innervegg") : t("Yttervegg"), maal].join(" · ");
    return { id: v.id, navn, under, s: (navn + " " + under + " " + v.id).toLowerCase() };
  }),
  gaTil(id) {
    const v = veggMedId(id);
    if (!v) return;
    flyTil(new THREE.Vector3(v.x, v.y, v.z),
           Math.max(tilScene(v.lengdeMm || 0), tilScene(swHoydeMm(v))));
    this.velg([id]);
    this.visEgenskaper(id);
  }
});

// ---------- Mengder og søk: de genererte elementene som rader ----------
// HVORFOR DE MÅ VÆRE MED. SW-elementene er ikke i IFC-fila — de er generert
// her. Mengder gikk bare gjennom S.modelGroup, så et bygg som var fullt
// generert kunne vise null sandwich og null ringmur i uttaket. Den feilen ser
// ikke gal ut: tallene STÅR der, de er bare for lave.
//
// `v.skjult` betyr «dratt bort, ikke slettet» og teller derfor ikke. Skjult
// med øyeknappen eller 🎨-rada er en VISNINGStilstand og teller fortsatt —
// mengden er bestilt uansett om du ser den på skjermen akkurat nå.
export function swAlle() {
  const ut = [];
  for (const b of [lagret, lagretInner]) {
    if (!b) continue;
    for (const v of (b.vegger || []))
      if (!v.skjult && v.lengdeMm > 0) ut.push({ v, erRm: false });
    for (const r of (b.ringmur || []))
      if (!r.skjult && (r.lengdeMm === undefined || r.lengdeMm > 0)) ut.push({ v: r, erRm: true });
  }
  return ut;
}

// Skråkappede elementer har to endehøyder. Gjennomsnittet er den riktige
// mengden: arealet av en trapes er middelhøyden ganger lengden.
export function swHoydeMm(v) {
  if (v.skra && v.hVMm !== undefined && v.hHMm !== undefined) return Math.round((v.hVMm + v.hHMm) / 2);
  return v.hoydeMm || 0;
}

// REN TALLFUNKSJON, uten three.js og uten lagringen — prøves i
// _test/test-veggelement.mjs. Tekstene kommer inn som `tekst` (t-funksjonen)
// av samme grunn som i sw-materiell.js: da kan regelen prøves uten ordboken.
export function swMengdeRad(v, erRm, tekst) {
  const tt = tekst || ((x) => x);
  const L = (v.lengdeMm || 0) / 1000;
  const H = swHoydeMm(v) / 1000;
  const T = (v.tMm || 0) / 1000;
  const material = erRm ? tt("Betong") : tt("Sandwich");
  const navn = erRm ? tt("Ringmur") : (v.sw || tt("Veggelement"));
  const key = navn + " · " + (v.inner ? tt("Innervegg") : tt("Yttervegg"));
  // Areal = VEGGLIVET, samme mål som Mengder ellers kaller «største flate»:
  // det er etter det isolasjon, kledning og forskaling bestilles.
  const area = L * H;
  // Forskaling bare på betongen, og bare sidene — toppen er støpeflate.
  // Samme regel som hovedløkka i js/elements.js: stål forskales ikke, og en
  // forskalingsmengde på et sandwichpanel ville sett ut som noe å prise.
  const forskaling = erRm ? 2 * L * H : 0;
  return {
    key: key + " · " + material, name: navn, objType: key,
    type: "SW", material,
    L, B: H, H: T, len: Math.max(L, H, T),
    vol: L * H * T, area, flate: area, forskaling,
    kg: 0, kgGeo: 0, kjentVekt: false, umuligVolum: false,
    vektKilde: "", profil: "", nomKgPerM: 0, avvik: null
  };
}

// ---------- 🏗 Ut til byggeplassen (monteringsinstruks) ----------
// MONTØREN SKAL SE HVOR HVERT PANEL GÅR, ikke kunne generere dem på nytt.
// Derfor sendes en FERDIG BESKRIVELSE — posisjon, vinkel, mål, SW-nummer — og
// ikke fasadene og regnereglene. To grunner, og begge er harde:
//
//  · bygg.html laster ikke js/veggelement.js, og skal ikke gjøre det. Fila er
//    på 300 kB og ville doblet det service workeren forhåndslagrer for en
//    telefon på en byggeplass uten dekning.
//  · genererte vi på nytt ute, kunne resultatet bli et ANNET enn det Emil så
//    på kontoret — én rettelse i regelen, og montøren monterer etter en vegg
//    ingen har godkjent. Beskrivelsen kan ikke drive fra det som ble bestilt.
//
// Tegningen ute blir enklere enn her: kasser med riktig mål og plassering,
// med SW-nummeret på. Bølgeprofilen i blikket er til pynt på kontoret og
// koster rammer på en telefon.
export function swForByggeplass() {
  const o = (lagret && lagret.oppsett) || STD_OPPSETT;
  const ut = [];
  for (const { v, erRm } of swAlle()) {
    const e = swByggeplassElement(v, erRm);
    if (e.l > 0 && e.h > 0) ut.push(e);
  }
  return { elementer: ut, utsparinger: swUtspForByggeplass(),
    farge: String(o.farge || "#dfe5ec"),
    utvFarge: String(o.utvFarge || ""), isolasjon: String(o.isolasjon || "") };
}

// REN TALLFUNKSJON — ett element om gangen, uten lagringen. Prøves i
// _test/test-veggelement.mjs.
export function swByggeplassElement(v, erRm) {
  const e = {
    id: String(v.id || ""),
    sw: erRm ? "" : String(v.sw || ""),
    k: erRm ? "r" : (v.inner ? "i" : "y"),
    x: r4(v.x), y: r4(v.y), z: r4(v.z), rot: r4(v.rot),
    // mmHel og ikke Math.round: Math.round("nei") er NaN, og en NaN i et mål
    // gir et element som ikke tegnes — usynlig for montøren, uten feilmelding.
    l: mmHel(v.lengdeMm),
    h: mmHel(swHoydeMm(v)),
    t: mmHel(v.tMm),
    // Fasadenormalen: hvilken vei panelet VENDER. Uten den kan ikke merkingen
    // legges flatt på panelflaten ute, og lappene ble stående som svevende
    // skilt i stedet (Emils bilde 16.09). Samme reserve som tegningen bruker
    // når feltet mangler på et gammelt element.
    nx: r4(v.nx !== undefined ? v.nx : Math.sin(v.rot || 0)),
    nz: r4(v.nz !== undefined ? v.nz : Math.cos(v.rot || 0)),
    // Dimensjonsteksten kommer FERDIG, ikke satt sammen ute: skråkapp skrives
    // «5980×1100/460MM 6,1°», og den regelen skal stå ett sted.
    dim: erRm ? "" : swDimTekst(v)
  };
  // Skråkappet: BEGGE endehøydene følger med, så gavlen ikke blir en kasse med
  // middelhøyde i en vegg som faktisk skråner. `h` står igjen som middelhøyden,
  // så en gammel leser uten trapes-tegning fortsatt får noe som ligner.
  if (v.skra && v.hVMm !== undefined && v.hHMm !== undefined) {
    e.hv = mmHel(v.hVMm); e.hh = mmHel(v.hHMm);
  }
  // 🕳 HAKKENE. Et element som går FORBI en utsparing er ett element i lista
  // (SW-11 4620×1000), men skal tegnes som bitene som står igjen rundt hakket.
  // Ute ble det tegnet som en hel kasse tvers over porten (Emils bilde 16.09).
  //
  // OPPDELINGEN GJØRES HER, ikke ute: rektMinusHull er guillotine-regelen som
  // bestemmer hvilke biter som blir igjen, og den skal finnes ett sted. Ute
  // tegnes bitene som de er.
  const hull = Array.isArray(v.hull) ? v.hull.filter(h => h && h.x1 - h.x0 > 10 && h.y1 - h.y0 > 10) : [];
  if (hull.length) {
    if (e.hv !== undefined) {
      // Skråkappet MED hakk: bitene ville mistet skråkuttet. Hullene sendes rå,
      // og tegnes ute som hull i trapesen — samme måte som på kontoret.
      e.hull = hull.map(h => [mmHel(h.x0), mmHel(h.x1), mmHel(h.y0), mmHel(h.y1)]);
    } else {
      const biter = rektMinusHull(e.l, e.h, hull, 20);
      // Blir det ingenting igjen, er hele elementet spist av utsparingen.
      // Da skal det ikke tegnes som en hel kasse — det skal ikke tegnes.
      e.b = biter.map(b => [mmHel(b.x0), mmHel(b.x1), mmHel(b.y0), mmHel(b.y1)]);
    }
  }
  return e;
}

// Tre desimaler holder i sceneenheter: under en tidels millimeter. Uten
// avrundingen blir JSON-fila dobbelt så stor av sifre ingen kan se.
export function r4(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
export function mmHel(n) { return Math.round(Number(n) || 0); }

// Samme tekst som på kontoret (tegnVeggElementer): lengde × høyde, og for et
// skråkappet element BEGGE endehøydene pluss vinkelen — de tre målene
// verkstedet trenger for å skjære panelet.
export function swDimTekst(v) {
  const hTekst = v.skra ? (v.hVMm + "/" + v.hHMm) : String(mmHel(v.hoydeMm));
  const vTekst = v.skra
    ? " " + (v.skraTekst || vinkelTekst(skraVinkel(v.lengdeMm, v.hVMm, v.hHMm))) : "";
  return mmHel(v.lengdeMm) + "\u00d7" + hTekst + "MM" + vTekst;
}

// 🚪 UTSPARINGENE UT SOM FERDIGE PUNKTER. Merkingen på kontoret regnes ut av
// fasadene (retning, tykkelse, avstand ut fra panelet). Å sende fasadene og
// regne på nytt ute ville vært å skrive den regningen to ganger — og den ene
// ville drevet fra den andre. Her sendes hjørnene i ferdige koordinater.
export function utspPunkter(apninger, fasader, baseY, tykkelseMm, ut) {
  for (const a of apninger || []) {
    const f = (fasader || [])[a.fi];
    if (!f) continue;
    if (!isFinite(a.bunnMm) || !isFinite(a.toppMm) || Math.abs(a.toppMm) > 1e8) continue;
    const tMm = ((f.o || {}).tykkelseMm !== undefined) ? f.o.tykkelseMm : tykkelseMm;
    // litt utenfor panelet, så streken ikke drukner i det — som på kontoret
    const utD = f.off + tilScene(tMm) / 2 + 0.03 / (S.enhetSkala || 1);
    const pkt = (mm, y) => [r4(f.px + f.ex * tilScene(mm) + f.nx * utD), r4(y),
                            r4(f.pz + f.ez * tilScene(mm) + f.nz * utD)];
    const y0 = baseY + tilScene(a.bunnMm), y1 = baseY + tilScene(a.toppMm);
    const midtMm = (a.fraMm + a.tilMm_) / 2, midtY = (y0 + y1) / 2;
    ut.push({
      p: [pkt(a.fraMm, y0), pkt(a.tilMm_, y0), pkt(a.tilMm_, y1), pkt(a.fraMm, y1)],
      m: pkt(midtMm, midtY),
      mn: pkt(midtMm, midtY + tilScene(320)),
      n: [r4(f.nx), r4(f.nz)],
      b: mmHel(a.tilMm_ - a.fraMm),
      h: mmHel(a.toppMm - a.bunnMm),
      navn: a.navn ? String(a.navn).toUpperCase().slice(0, 40) : ""
    });
  }
}

export function swUtspForByggeplass() {
  const ut = [];
  const o = (lagret && lagret.oppsett) || STD_OPPSETT;
  if (lagret) utspPunkter(utspPaFasader(), lagret.fasader || [], baseYNaa(), o.tykkelseMm, ut);
  const d = lagretInner;
  if (d) utspPunkter(d.utspVis || [], d.fasader || [], innerBaseY(), INNER_STD.tykkelseMm, ut);
  return ut;
}

export function leggSwIMengder(groups, rows) {
  for (const { v, erRm } of swAlle()) {
    const r = swMengdeRad(v, erRm, t);
    if (!groups.has(r.key)) groups.set(r.key,
      { count: 0, length: 0, vol: 0, area: 0, flate: 0, forskaling: 0, kg: 0, kgGeo: 0,
        utenVekt: 0, umulige: 0, nominelle: 0, type: r.type, material: r.material });
    const g = groups.get(r.key);
    g.count++; g.length += r.len; g.area += r.area; g.flate += r.flate;
    g.vol += r.vol; g.forskaling += r.forskaling; g.utenVekt++;
    rows.push(r);
  }
}

export function lagringsNokkel() { return "storm-ifc-sw::" + S.fileName; }

// Det genererte resultatet for denne modellfila:
// { oppsett, vegger, gulv, ringmur, materiellIder }. Leses direkte av de andre
// delene (bindingen er levende), men skrives bare gjennom settLagret.
export let lagret = null;

// FLYTTET HIT FRA regler.js. Den leser «lagret», og regler.js skal ikke peke
// på noen av de andre delene i det hele tatt: er den et blad i grafen, blir den
// alltid ferdig lastet før de andre, og da kan de trygt lese konstantene
// hennes på toppnivå (INNER_STD i panel.js gjør nettopp det).
//
// OK betong akkurat nå: fra genereringen når den finnes, ellers bunnen av
// søylene i modellen (samme regel som genereringen bruker), ellers alt.
export function okBetongNaa() {
  if (lagret && lagret.okBetong !== undefined) return lagret.okBetong;
  let minS = Infinity, minA = Infinity;
  for (const [id, b] of allElementBoxes()) {
    if (!b) continue;
    if (b.min.y < minA) minA = b.min.y;
    if (soyleTypeNavn(id) === "Column" && b.min.y < minS) minS = b.min.y;
  }
  const m = minS !== Infinity ? minS : minA;
  return m === Infinity ? undefined : m;
}

// ---------- 👁 Skjult ETT OG ETT, og 🔵 valgt ----------
// Rad-skjulingen i 🎨 Utseende tar hele grupper: «alle veggelementer», «all
// ringmur». Det Emil trengte 16.09 var det motsatte — å ta bort ETT panel for
// å se stålsøyla bak det. Den veien fantes ikke: SW-elementene var ikke
// plukkbare i det hele tatt utenfor justeringsmodus.
//
// Id-ene lagres per fil sammen med resten av SW-dataene. Innerveggene har
// id-er som starter med «i» (iv3, ir7) og ytterveggene «v»/«r», så settet kan
// deles mellom de to lagringene uten å slå opp hvert element.
export const swSkjultId = new Set();
export const swValgt = new Set();

export function lesSkjulteIder() {
  swSkjultId.clear();
  swValgt.clear();
  for (const b of [lagret, lagretInner])
    for (const id of ((b && b.skjulteIder) || [])) swSkjultId.add(id);
}

export function skrivSkjulteIder() {
  const ytre = [], indre = [];
  for (const id of swSkjultId) (String(id).startsWith("i") ? indre : ytre).push(id);
  if (lagret) { lagret.skjulteIder = ytre; skrivLagret(); }
  if (lagretInner) { lagretInner.skjulteIder = indre; skrivInner(); }
}

// Samme blå som elementvalget i modellen — «valgt» skal se likt ut uansett hva
// du trykte på. Males om etter hver tegnAlt(), for da er meshene nye objekter
// med nye materialer som ikke vet at noe var valgt.
export function oppdaterSwValgEffekt() {
  swGroup.children.forEach(o => settValgEffekt(o, swValgt.has(o.userData.swId)));
}
// 🔍 «Finn utsparinger»-modus: { kandidater: [{ k, paa, mesh }], gruppe, ned }.
// Deklareres her av samme grunn som `just` under.
export let finnMark = null;

// Justeringsmodus. Deklareres her fordi ryddTegning() må kunne se den for å
// la markeringsgruppa stå (se kommentaren der).
export let just = null;     // { valgt: Set<id>, drar: {…} | null, markorer: Group }

// SETTERE FOR DE FIRE VERANDERLIGE. En import er skrivebeskyttet: de andre
// delene kan LESE «lagret» direkte (bindingen er levende og viser alltid
// gjeldende verdi), men de kan ikke tildele den. Derfor disse fire.
export function settLagret(v) { lagret = v; }
export function settJust(v) { just = v; }
export function settFinnMark(v) { finnMark = v; }


export function lesLagret() {
  try { return JSON.parse(localStorage.getItem(lagringsNokkel()) || "null"); }
  catch (_) { return null; }
}

export function skrivLagret() {
  try {
    if (lagret) localStorage.setItem(lagringsNokkel(), JSON.stringify(lagret));
    else localStorage.removeItem(lagringsNokkel());
  } catch (_) {}
}

export const STD_OPPSETT = {
  betongMm: 200, isoMm: 300, utstikkMm: 200,
  ringmur: false, ringHoydeMm: 500, tykkelseMm: 120,
  // Radoppsettet (runde 11): tom streng = automatikk. Skriver Emil
  // «1100,1100,1100,1100,1000,1000» bygges veggen slik NEDENFRA OG OPP, og
  // siste høyde gjentas hvis stabelen går tom før veggen er full.
  radHoyder: "", kappNederst: true,
  klaringMm: SW_KLARING_MM,     // 10 mm hver side = 20 mm skjøt
  minFeltMm: SW_MIN_FELT_MM,    // skjøter nærmere enn dette slås sammen
  minSkraMm: SW_MIN_SKRA_MM,    // 0 = kilen går helt ut til taket
  minSkra0: true,               // migreringsmerke, se migrerOppsett()
  // 🏔 SALTAK-KNAPPEN (Emil 08.09). Veggtoppen følger taket bare når den står
  // PÅ. Standard AV, og det er ikke forsiktighet — det er riktigst for de
  // fleste stålbygg: en gavl med FAGVERK har takstolen liggende i gavlplanet,
  // og da leser taklinja overkanten av fagverket og skråner veggen, mens
  // veggen på Hegdalringen faktisk går rett opp til gesims. Er den av, bygges
  // veggen flat til høyeste søyletopp, nøyaktig som før runde 20.
  folgTak: false,
  kappUnderMm: 0,               // 0 = lengde alene gjør ikke noe til kapp
  // Navnet på kappbitene SKRIVES FRITT (Emil 03.09) — alltid med «SW-» foran.
  // «XX» gir SW-XX (Moelv), «18*» gir SW-18*, og «*» alene gir forelderens
  // nummer med stjerne (Lørenskog). Den gamle nøkkelen kappStil migreres.
  kappTekst: "XX",
  visUtsp: true,                // stiplet kryss + mål på utsparingene
  farge: "#dfe5ec", isolasjon: "PIR", utvFarge: "RAL 1015", innFarge: "9010",
  prosjekt: "", oppdragsnr: "", sted: "", sign: "",
  // 🧾 Materiell-arket: skum-utbytte per boks, i meter loddrett skjøt. Standard
  // i den forsiktige enden av Emils intervaller (15–20 m på 200 mm, 20–30 m på
  // 120 mm) — en boks for mye er billigere enn en tur til byen.
  skumUtbytteTykkM: 15, skumUtbytteTynnM: 20,
  // 🧭 FASADEVELGEREN (punkt 6): fasader satt for hånd, for stålmodeller uten
  // søyleforlengere der randvandringen ikke har noe å følge. Hvert sett er
  // { ider: [søyle-id…], side: ±1, lukk } — samme form som en innerveggserie.
  // Finnes det ETT sett, brukes BARE de manuelle (automatikken er av).
  manuelleFasader: [],
  // 📐 «Utfyll PDF»: rutene i Storm-tittelfeltet på instruksjonstegninga.
  // Tomme her betyr «hentes fra Til lista-feltene over» (pdfProsjekt,
  // pdfUndertittel, pdfOppdrag, pdfTegnet) eller «står tom på papiret»
  // (pdfKontroll, pdfGodkjent) — aldri en oppdiktet verdi.
  pdfFase: "Utførelsesfase", pdfTittel: "", pdfNr: "SW-01",
  pdfProsjekt: "", pdfUndertittel: "", pdfOppdrag: "",
  pdfTegnet: "", pdfKontroll: "", pdfGodkjent: "", pdfDato: "",
  pdfMerknad: "",
  // Logoen huskes på FILNAVN, ikke itemId: SharePoint gir samme fil ny itemId
  // hvis den lastes opp på nytt, og da ville valget stille falt bort.
  pdfLogo: "",
  utsparinger: []   // [{navn, min:[x,y,z], max:[x,y,z]}] fra valgte elementer
};

// 🔧 MIGRERINGENE AV ET LAGRET OPPSETT — som REN funksjon, så de kan prøves
// med ekte gamle oppsett i stedet for å leses med øynene.
//
// TO GANGER PÅ RAD har en migrering her vært feil uten at noe sa fra:
//  · runde 20e la sjekken ETTER fletten med STD_OPPSETT, og da hadde merket
//    alt kommet inn — `=== undefined` var aldri sann.
//  · runde 20e retta det, men da var skaden gjort: den buggede versjonen hadde
//    alt STEMPLET oppsettet som ferdig migrert, med 300 fortsatt inni. Den
//    retta migreringen så stempelet og hoppet over (Emil 08.09: «ingen av
//    feilene har blitt fikset»).
//
// Lærdommen står i koden nå: et migreringsmerke som har vært satt av en
// bugget migrering er BRENT. Det kan ikke stoles på igjen — migreringen må få
// et nytt merkenavn, og det gamle ryddes bort.
//
// `raatt` er objektet slik det ligger i localStorage. Ut kommer det ferdig
// flettede oppsettet.
export function migrerOppsett(raatt, std) {
  const r = raatt || {};
  const o = { ...(std || {}), ...r };
  // Et oppsett fra før kappnavnet ble fritt har `kappStil` i stedet. Uten
  // dette ville Lørenskog-valget stille falt tilbake til SW-XX.
  if (r.kappStil !== undefined) {
    o.kappTekst = r.kappStil === "stjerne" ? "*" : "XX";
    delete o.kappStil;
  }
  // 🏔 Runde 20b satte 300 mm som tynneste ende på skråkapp. Det var VÅRT valg,
  // ikke Emils, og det ga et hull mellom veggkanten og takflaten. Verdien
  // ligger lagret PER FIL og overstyrer standarden på 0.
  //
  // Merket heter `minSkra0` og IKKE `minSkraNullet`: det gamle navnet ble satt
  // av den buggede migreringen på oppsett som aldri ble nullet. Det ryddes bort
  // her, så ingen framtidig migrering tror det betyr noe.
  if (r.minSkra0 === undefined && r.minSkraMm === 300) o.minSkraMm = 0;
  o.minSkra0 = true;
  delete o.minSkraNullet;
  return o;
}

export function oppsett() {
  if (!lagret) lagret = lesLagret() || { oppsett: { ...STD_OPPSETT }, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  // Migreringene leser det RÅ lagrede oppsettet og fletter inn standardene.
  // Et oppsett lagret av en ELDRE versjon mangler de nye nøklene (radHoyder,
  // klaringMm, minFeltMm …); uten fletten blir de undefined og genereringen
  // regner med NaN.
  lagret.oppsett = migrerOppsett(lagret.oppsett, STD_OPPSETT);
  // 🚪 Åpninger fra før typene fantes får type og nytt navn (punkt 1)
  if (Array.isArray(lagret.oppsett.utsparinger)) sikreUtspTyper(lagret.oppsett.utsparinger, okBetongNaa());
  return lagret.oppsett;
}


// ---------- Tegning ----------
export function ryddTegning() {
  swGroup.children.slice().forEach(o => {
    // Markeringsgruppa i justeringsmodus eies av justeringen, ikke av
    // tegningen. Uten dette unntaket rev tegnAlt() den ut av swGroup ved
    // første drag, og den blå markeringen ble borte for godt etter et
    // sekund (Emils funn 02.09).
    if (just && o === just.markorer) return;
    if (innerMark && (o === innerMark.merker || o === innerMark.forh)) return;
    if (finnMark && o === finnMark.gruppe) return;
    o.traverse(m => {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    swGroup.remove(o);
  });
}

// ---------- 💾 Lagrede SW-resultater ----------
// Emil 03.09: samme tanke som «Lagrede grupper» i Bygginfo — du gir resultatet
// et navn, og kan hente det tilbake senere. Det som lagres er TALLENE
// (oppsett, vegger, gulv, ringmur, fasader), ikke 3D-objektene: stablene og
// tegninga bygges opp igjen av byggStabler()/tegnAlt() ved innlasting, akkurat
// som når en fil åpnes på nytt. Lagringen er per modellfil, som resten av
// SW-dataene.
export function lagredeNokkel() { return "storm-ifc-sw-lagrede::" + S.fileName; }
export const SW_SP_MAPPE = "SW-resultater";
export function swSpFil() { return S.fileName + ".sw.json"; }

// Status til panelet: sier rett ut om det du lagrer havner hos kollegaene
// eller bare på denne maskinen. Uten den linja er «lagret» et løfte brukeren
// ikke kan kontrollere.
export let swSpStatus = "av";   // "av" | "ok" | "feil"

// RÅ liste, gravsteiner og alt. Brukes av lagring og fletting.
export function lesLagredeRaa() {
  try {
    const l = JSON.parse(localStorage.getItem(lagredeNokkel()) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (_) { return []; }
}

// Det panelet skal vise: uten gravsteiner, nyeste først.
export function lesLagrede() {
  return lesLagredeRaa().filter(p => p && !p.slettet)
    .sort((a, b) => String(b.endret || b.dato || "").localeCompare(String(a.endret || a.dato || "")));
}

export function skrivLagrede(liste) {
  try { localStorage.setItem(lagredeNokkel(), JSON.stringify(liste)); return true; }
  catch (_) { return false; }   // full localStorage — sier fra i stedet for å svelge det
}

// Lokalt FØRST, så SharePoint. Rekkefølgen er ikke tilfeldig: har du ikke
// dekning, skal arbeidet likevel være lagret når du lukker fanen.
export function lagreBeggeSteder(liste) {
  if (!skrivLagrede(liste)) return false;
  if (!spPaalogget()) { swSpStatus = "av"; return true; }
  spSkriv(SW_SP_MAPPE, swSpFil(), liste).then(res => {
    swSpStatus = res.ok ? "ok" : "feil";
    if (res.ok && res.liste) skrivLagrede(res.liste);   // kollegaenes poster kom med
    tegnPanel();
  });
  return true;
}

// Hentes når en modell åpnes. Fasiten ligger i SharePoint, men en post du
// lagret uten dekning skal ikke spises av en eldre utgave — derfor flettes det
// på nyeste, ikke på «skya vinner».
export async function hentLagredeFraSp() {
  if (!spPaalogget()) { swSpStatus = "av"; return; }
  const forFil = S.fileName;
  const res = await spLes(SW_SP_MAPPE, swSpFil());
  if (S.fileName !== forFil) return;          // brukeren byttet modell underveis
  swSpStatus = (res.status === "ok" || res.status === "tom") ? "ok" : "feil";
  if (res.status === "ok" || res.status === "tom") {
    skrivLagrede(flettPaaNavn(lesLagredeRaa(), res.liste));
  }
  tegnPanel();
}

// Øyeblikksbildet. Materiell-id-ene tas MED VILJE ikke med: de peker på
// stabler som ikke finnes lenger når resultatet lastes inn igjen, og
// byggStabler() lager nye.
export function swOyeblikksbilde() {
  if (!lagret) return null;
  const b = JSON.parse(JSON.stringify({
    oppsett: lagret.oppsett || STD_OPPSETT,
    vegger: lagret.vegger || [],
    gulv: lagret.gulv || null,
    ringmur: lagret.ringmur || [],
    fasader: lagret.fasader || [],
    okBetong: lagret.okBetong || 0,
    baseY: lagret.baseY,
    skjul: lagret.skjul || {},
    // 🩹 Blikket hører til bygget: bryteren og håndjusteringene lagres med
    // SW-resultatet, så et lastet resultat kommer tilbake med sitt eget blikk
    // og ikke med det forrige byggets.
    blikk: lagret.blikk || { pa: false, just: {}, ekstra: [], nesteNr: 1 }
  }));
  return b;
}

export function lagreResultat(navn) {
  const rent = String(navn || "").trim().slice(0, 60);
  if (!rent) { alert(t("Gi resultatet et navn før du lagrer det.")); return; }
  if (!lagret || !(lagret.vegger || []).length) {
    alert(t("Generer veggelementene først.")); return;
  }
  const liste = lesLagredeRaa();
  const fra_for = liste.findIndex(p => p.navn === rent);
  // En gravstein er ikke «finnes allerede» — den er et slettet navn som blir
  // ledig igjen. Spør vi om overskriving der, spør vi om noe som ikke er der.
  if (fra_for >= 0 && !liste[fra_for].slettet
      && !confirm(t("«{0}» finnes allerede. Skal den skrives over?", rent))) return;
  const naa = new Date();
  const post = { navn: rent, dato: naa.toISOString().slice(0, 10),
    endret: naa.toISOString(), av: swMittNavn(),
    antall: (lagret.vegger || []).filter(v => !v.skjult).length,
    data: swOyeblikksbilde() };
  if (fra_for >= 0) liste[fra_for] = post; else liste.push(post);
  if (!lagreBeggeSteder(liste)) {
    alert(t("Klarte ikke å lagre — nettleserens lagring er full. Slett et gammelt resultat og prøv igjen."));
    return;
  }
  tegnPanel();
}

// Hvem som lagret, så kollegaen ser hvem resultatet kommer fra. Tom streng
// uten innlogging — da er det uansett bare din egen maskin som ser posten.
export function swMittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

export function lastInnResultat(navn) {
  const post = lesLagrede().find(p => p.navn === navn);
  if (!post || !post.data) return;
  fjernGenerertMateriell();
  lagret = JSON.parse(JSON.stringify(post.data));
  lagret.materiellIder = [];
  oppsett();                 // migrerer et oppsett lagret av en eldre versjon
  loesAlleJusteringer();
  byggAlleStabler();
  skrivLagret();
  tegnAlt();
  tegnPanel();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
}

// Sletting setter en GRAVSTEIN (se js/sp-lager.js). Fjernet vi posten helt,
// ville den kommet tilbake ved neste fletting fra SharePoint — den ligger jo
// der, og flettingen kan ikke se forskjell på «slettet» og «ikke hentet ennå».
export function swLagringsTekst() {
  if (swSpStatus === "ok") return t("Lagres i SharePoint — alle med tilgang ser det samme.");
  if (swSpStatus === "feil") return t("Får ikke kontakt med SharePoint. Lagres bare på denne maskinen inntil videre.");
  return t("Lagres bare på denne maskinen. Logg inn i Biblioteket for å dele med de andre.");
}

export function slettResultat(navn) {
  if (!confirm(t("Slette «{0}»?", navn))) return;
  const liste = lesLagredeRaa().map(p => p.navn === navn
    ? { navn: p.navn, slettet: true, endret: new Date().toISOString() } : p);
  lagreBeggeSteder(liste);
  tegnPanel();
}
