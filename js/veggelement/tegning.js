// 🎨 Tegning: veggene, ringmuren, utsparingsmerkingen og tekstdekalene tegnes
// opp i 3D, og SW-radene i ⚙ Utseende.
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
import { S, esc, ikon } from "../state.js";
import { t } from "../i18n.js";
import { allElementBoxes, forHverTrekant } from "../elements.js";
import { MALTYPER, mmTilScene, ribbonPosisjoner, trpProfil } from "../materiell-vis.js";
import { APN_REGEL, APN_SLARK, SW_MAKS_LAPPER, eierUtsparing, profilUtsnitt, rektMinusHull, ribbonSkraPos, skraVinkel, soyleTypeNavn, tilMm, tilScene, vinkelTekst } from "./regler.js";
import { STD_OPPSETT, hentLagredeFraSp, just, lagret, lesLagret, lesSkjulteIder, oppdaterSwValgEffekt, ryddTegning, settLagret, skrivLagret, swGroup, swSkjultId } from "./tilstand.js";
import { loesAlleJusteringer } from "./generer.js";
import { STAL_TYPER } from "./stal.js";
import { avsluttJuster } from "./juster.js";
import { lagretInner, lesInner, settLagretInner } from "./panel.js";
import { innerSkjulNaa, oppdaterInnerveggerEtterUtsp, settInnerSkjul, tegnInnervegger } from "./innervegg.js";

// ---------- 👁 «SW-generator» i 🎨 Utseende ----------
// Emil 03.09: alt SW-generatoren har satt PÅ BYGGET skal kunne skjules —
// uavhengig av bunkene med veggelementer rundt bygget, som ligger i
// 📦 Materiell og har sine egne rader der. Skjulingen er en VISNINGStilstand
// og lagres i `lagret.skjul`, altså per fil, sammen med resten av SW-dataene.
export const SKJUL_DELER = [
  { n: "vegger", navn: "Veggelementer" },
  { n: "gulv", navn: "Gulv og isolasjon" },
  { n: "ringmur", navn: "Ringmur" },
  { n: "merking", navn: "Merking og mål" }
];

export function skjulNaa() {
  if (!lagret) return {};
  if (!lagret.skjul) lagret.skjul = {};
  return lagret.skjul;
}

export function settSkjul(navn, verdi) {
  if (!lagret) return;
  const sk = skjulNaa();
  if (navn === "alt") for (const d of SKJUL_DELER) sk[d.n] = verdi;
  sk[navn] = verdi;
  if (navn !== "alt" && !verdi) sk.alt = false;
  if (navn !== "alt") sk.alt = SKJUL_DELER.every(d => sk[d.n]);
  skrivLagret();
  tegnAlt();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();   // «Vis alle» skal dukke opp
}

// Én rad-tegner for begge blokkene: `sk` er tilstanden, `attr` sier hvilken
// knapp som skal svare. To kopier ville drevet fra hverandre.
export function swSkjulRad(sk, attr, navn, tekst, ekstra) {
  return '<div class="qty-row"><div class="n">' + esc(t(tekst)) +
    (ekstra ? ' <span style="color:var(--muted);font-size:11px">(' + ekstra + ')</span>' : "") +
    '</div><div class="c"><button ' + attr + '="' + navn + '" title="' + t("Skjul/vis") +
    '" style="padding:3px 8px">' + ikon(sk[navn] ? "skjul" : "vis") + '</button></div></div>';
}

S.swUtseendeRader = (body) => {
  if (!body) return;
  const antV = ((lagret && lagret.vegger) || []).length;
  const harYtre = !!(lagret && (antV || lagret.gulv || (lagret.ringmur || []).length));
  const d = lagretInner;
  const antI = ((d && d.vegger) || []).length;
  if (!harYtre && !antI) return;
  const boks = document.createElement("div");
  let html = "";
  if (harYtre) {
    const sk = skjulNaa();
    html +=
      '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' + ikon("sw") + ' ' +
        t("SW-generator") + '</div><div class="c"></div></div>' +
      swSkjulRad(sk, "data-sw-skjul", "alt", "Alt på bygget") +
      swSkjulRad(sk, "data-sw-skjul", "vegger", "Veggelementer", antV || "") +
      (lagret.gulv ? swSkjulRad(sk, "data-sw-skjul", "gulv", "Gulv og isolasjon") : "") +
      ((lagret.ringmur || []).length
        ? swSkjulRad(sk, "data-sw-skjul", "ringmur", "Ringmur", (lagret.ringmur || []).length) : "") +
      swSkjulRad(sk, "data-sw-skjul", "merking", "Merking og mål") +
      '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
        t("Bunkene med veggelementer rundt bygget ligger i Materiell og skjules i sine egne rader over.") + '</p>';
  }
  // 🚪 EGEN BLOKK FOR INNERVEGGENE (Emil 08.09). Egen tilstand også: slår han
  // av ytterveggene for å se inn i bygget, skal innerveggene bli stående.
  if (antI) {
    const skI = innerSkjulNaa();
    html +=
      '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' + ikon("dor") + ' ' +
        t("SW-generator: innervegger") + '</div><div class="c"></div></div>' +
      swSkjulRad(skI, "data-sw-iskjul", "alt", "Alt på bygget") +
      swSkjulRad(skI, "data-sw-iskjul", "vegger", "Veggelementer", antI) +
      ((d.ringmur || []).length
        ? swSkjulRad(skI, "data-sw-iskjul", "ringmur", "Ringmur", (d.ringmur || []).length) : "") +
      swSkjulRad(skI, "data-sw-iskjul", "merking", "Merking og mål");
  }
  boks.innerHTML = html;
  body.appendChild(boks);
  boks.querySelectorAll("button[data-sw-skjul]").forEach(b =>
    b.onclick = () => settSkjul(b.dataset.swSkjul, !skjulNaa()[b.dataset.swSkjul]));
  boks.querySelectorAll("button[data-sw-iskjul]").forEach(b =>
    b.onclick = () => settInnerSkjul(b.dataset.swIskjul, !innerSkjulNaa()[b.dataset.swIskjul]));
};

export function boks(farge, opacity) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
  return m;
}

// 🧱 RINGMURBITENE, tegnet fra tallene. Trukket ut av tegnAlt i runde 21 så
// innerveggene kan bruke NØYAKTIG samme tegning — en egen kopi ville drevet fra
// denne første gang noe ble rettet i den ene.
export function tegnRingmurBiter(biter, visMerking) {
  const visRmLapper = (biter || []).length <= 400 && !!visMerking;
  for (const r of biter || []) {
    if (r.skjult || (r.lengdeMm !== undefined && !(r.lengdeMm > 0))) continue;
    if (swSkjultId.has(r.id)) continue;           // 👁 skjult enkeltvis
    const m = boks("#8a8f98", 1);
    m.scale.set(r.lengde, r.hoyde, r.tykkelse);
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.rot;
    if (r.id !== undefined) m.userData.swId = r.id;
    swGroup.add(m);
    if (visRmLapper && r.id !== undefined && r.lengdeMm !== undefined) {
      const nx = r.nx !== undefined ? r.nx : Math.sin(r.rot);
      const nz = r.nz !== undefined ? r.nz : Math.cos(r.rot);
      const nv = new THREE.Vector3(nx, 0, nz).normalize();
      const utD = (r.tykkelse || tilScene(r.tMm || 200)) / 2 + 0.01 / (S.enhetSkala || 1);
      const dim = tekstDekal(r.lengdeMm + "\u00d7" + (r.hoydeMm || 0) + "MM", 150,
        (r.lengde || 1) * 0.7);
      dim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
      dim.position.set(r.x + nv.x * utD, r.y, r.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
}

// 🧱 VEGGELEMENTENE, tegnet fra tallene. Også trukket ut i runde 21: del A
// sender inn sine vegger og sitt oppsett, del B sine. Ingenting her vet hvilken
// av dem det er.
export function tegnVeggElementer(vegger, o, visMerking) {
  // Elementene tegnes som EKTE SANDWICHPANELER — samme oppskrift som
  // materiell-modellen Emil pekte på (runde 3): lys isolasjonskjerne synlig i
  // endene, og et tynt blikk med mikroprofil i elementfargen på begge sider.
  // Panelet bygges liggende (samme akser som materiell) og reises opp 90°.
  const farge = o.farge || "#dfe5ec";
  const fargeMat = new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
  const kjerneMat = new THREE.MeshLambertMaterial({ color: "#e8e4da", side: THREE.DoubleSide });
  const mal = MALTYPER.sandwich;
  const antV = (vegger || []).length;
  const visLapper = antV <= SW_MAKS_LAPPER && !!visMerking;
  if (antV > SW_MAKS_LAPPER && visMerking)
    console.warn("SW: " + antV + " veggelement er over grensa på " + SW_MAKS_LAPPER
      + " — SW-nummer og mål tegnes ikke i 3D. Lista og PDF-en er uendret.");
  // Ett panelstykke: isolasjonskjerne + ytter- og innerhud med mikroprofil.
  // Bygges LIGGENDE (samme akser som materiell) og reises 90° opp, så x er
  // lengden, y høyden og z tykkelsen i elementets egen ramme.
  const byggPanel = (lengdeMm, hoydeMm, tMm, profilFull, fra, til) => {
    const inner = new THREE.Group();
    const kjerne = new THREE.Mesh(new THREE.BoxGeometry(
      tilScene(Math.max(lengdeMm - 4, 10)), tilScene(Math.max(tMm - 8, 10)),
      tilScene(Math.max(hoydeMm - 4, 10))), kjerneMat);
    kjerne.position.y = mmTilScene(tMm / 2);
    inner.add(kjerne);
    // Bølgen klippes ut av ELEMENTETS profil, ikke laget på nytt for biten —
    // da står ribbene i flukt tvers over hakket.
    const profS = profilUtsnitt(profilFull, fra, til)
      .map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    if (profS.length < 2) return inner;
    const lag = () => {
      const pos = ribbonPosisjoner(profS, mmTilScene(lengdeMm));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, fargeMat);
    };
    const ytter = lag();
    ytter.position.y = mmTilScene(tMm - mal.profilHoyde);
    const indre = lag();
    indre.scale.y = -1;
    indre.position.y = mmTilScene(mal.profilHoyde);
    inner.add(ytter, indre);
    inner.rotation.x = -Math.PI / 2;         // reis panelet: høyden opp
    inner.position.z = tilScene(tMm) / 2;    // tykkelsen sentrert om veggplanet
    return inner;
  };
  // 🏔 SKRÅKAPPET PANEL. Bygges som et EKTE sandwichpanel, ikke som en grå
  // kasse (Emil 08.09): isolasjonskjerne som synes i endene og langs
  // skråkuttet, og bølgeblikk i elementfargen på begge sider — samme
  // oppskrift som byggPanel, bare med et trapes i stedet for et rektangel.
  //
  // Bygges i SIN EGEN retning (x = lengde, y = høyde, z = tykkelse), ikke
  // liggende og reist opp som byggPanel: en ExtrudeGeometry ekstruderer i z,
  // og liggende ville kjernen blitt presset ut langs høyden i stedet for
  // gjennom tykkelsen.
  const byggSkraPanel = (lengdeMm, toppPMm, tMm, radHMm, hull) => {
    const inner = new THREE.Group();
    const L = mmTilScene(lengdeMm), T = mmTilScene(tMm);
    const hMaks = Math.max(...toppPMm.map(q => q[1]));
    const y0 = -mmTilScene(hMaks) / 2;
    const inn = mmTilScene(2);                       // kjernen trekkes 2 mm inn
    // Kjernen: elementets faktiske form — bunnkant, høyre kant, overkanten
    // baklengs — med hakkene som hull i formen.
    const form = new THREE.Shape();
    form.moveTo(-L / 2 + inn, y0 + inn);
    form.lineTo(L / 2 - inn, y0 + inn);
    for (let i = toppPMm.length - 1; i >= 0; i--) {
      const [x, y] = toppPMm[i];
      // Overkanten kan gå helt ned til null der elementet ender i en spiss mot
      // raftet. Trakk vi da 2 mm av som overalt ellers, havnet toppunktet UNDER
      // bunnkanten, formen ble selvskjærende, og panelet vrengte seg i 3D
      // (Emil 08.09, da han dro et element ut mot kanten). Overkanten holdes
      // derfor alltid minst et hårstrå over bunnen.
      form.lineTo(-L / 2 + mmTilScene(x) + (i === toppPMm.length - 1 ? -inn : (i === 0 ? inn : 0)),
                  Math.max(y0 + inn * 2, y0 + mmTilScene(y) - inn));
    }
    form.closePath();
    for (const h of (hull || [])) {
      const bane = new THREE.Path();
      const a0 = -L / 2 + mmTilScene(h.x0), a1 = -L / 2 + mmTilScene(h.x1);
      const b0 = y0 + mmTilScene(h.y0), b1 = y0 + mmTilScene(h.y1);
      bane.moveTo(a0, b0); bane.lineTo(a1, b0); bane.lineTo(a1, b1); bane.lineTo(a0, b1);
      bane.closePath();
      form.holes.push(bane);
    }
    const dyp = Math.max(T - mmTilScene(8), mmTilScene(10));
    const kjerneGeo = new THREE.ExtrudeGeometry(form, { depth: dyp, bevelEnabled: false });
    kjerneGeo.translate(0, 0, -dyp / 2);
    inner.add(new THREE.Mesh(kjerneGeo, kjerneMat));
    // Blikket: samme mikroprofil som på et rett panel, klippet mot overkanten.
    const profS = trpProfil(radHMm || hMaks, mal.deling, mal.profilHoyde)
      .map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    const toppS = toppPMm.map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    const hullS = (hull || []).map(h => ({
      x0: mmTilScene(h.x0), x1: mmTilScene(h.x1),
      y0: mmTilScene(h.y0), y1: mmTilScene(h.y1) }));
    const pos = ribbonSkraPos(profS, L, toppS, hullS);
    if (pos.length) {
      const ph = mmTilScene(mal.profilHoyde);
      const lag = (utover) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, fargeMat);
        m.scale.z = utover ? 1 : -1;
        m.position.z = utover ? T / 2 - ph : -T / 2 + ph;
        return m;
      };
      inner.add(lag(true), lag(false));
    }
    return inner;
  };
  for (const v of vegger || []) {
    if (v.skjult || !(v.lengdeMm > 0)) continue;   // dratt bort, men ikke slettet
    if (swSkjultId.has(v.id)) continue;           // 👁 skjult enkeltvis
    const el = new THREE.Group();
    // 🚪 HAKK ETTER UTSPARINGER: elementet er ÉTT element i lista med full
    // høyde og full feltlengde (Moelv SW-11 4620MM med vindu i), men tegnes
    // som bitene som står igjen rundt hakket.
    // Hakkene regnes ut fra radens åpninger og elementets NÅVÆRENDE
    // utstrekning, så de følger med når elementet dras/strekkes.
    let hull = v.hull;
    if (v.apn && v.fraMm !== undefined) {
      hull = [];
      for (const a of v.apn) {
        const x0 = Math.max(v.fraMm, a.fraMm) - v.fraMm, x1 = Math.min(v.tilMm, a.tilMm_) - v.fraMm;
        const y0 = Math.max(v.rBunnMm, a.bunnMm) - v.rBunnMm;
        const y1 = Math.min(v.rBunnMm + v.hoydeMm, a.toppMm) - v.rBunnMm;
        if (x1 - x0 > 10 && y1 - y0 > 10) hull.push({ x0, x1, y0, y1 });
      }
    }
    if (v.skra) {
      // Skråkappet element: ett trapes med bølge og kjerne, åpningene som hull.
      el.add(byggSkraPanel(v.lengdeMm,
        v.toppP || [[0, v.hVMm], [v.lengdeMm, v.hHMm]], v.tMm, v.radHMm, hull));
    } else {
    const deler = hull && hull.length
      ? rektMinusHull(v.lengdeMm, v.hoydeMm, hull, 20)
      : [{ x0: 0, x1: v.lengdeMm, y0: 0, y1: v.hoydeMm }];
    const profilFull = trpProfil(v.hoydeMm, mal.deling, mal.profilHoyde);
    for (const d of deler) {
      const g = byggPanel(d.x1 - d.x0, d.y1 - d.y0, v.tMm, profilFull, d.y0, d.y1);
      g.position.x += tilScene((d.x0 + d.x1) / 2 - v.lengdeMm / 2);
      g.position.y += tilScene((d.y0 + d.y1) / 2 - v.hoydeMm / 2);
      el.add(g);
    }
    }
    el.position.set(v.x, v.y, v.z);
    el.rotation.y = v.rot;
    el.userData.sw = v.sw;
    el.userData.swId = v.id;
    // Id-en settes på HVER mesh, ikke bare gruppa: da trenger ikke plukkingen
    // å gå oppover i treet, og et treff kan ikke gå tapt underveis.
    el.traverse(m => { m.userData.swId = v.id; });
    swGroup.add(el);
    // 🏷 SW-nummer i øvre hjørne + dimensjon i midten — som på Moelv-tegningen
    // og Lørenskog-skjermbildene. Konstant skjermstørrelse (updateScreenScaled).
    if (visLapper) {
      const ex = Math.cos(v.rot), ez = -Math.sin(v.rot);
      // Teksten SITTER PÅ ELEMENTFLATEN som på tegningene — flate dekaler
      // limt 10 mm utenpå ytterhuden, i veggens plan, med dybdetest. Ikke
      // svevende skjermlapper (Emils runde 4 og 5): de fløt over alt og ble
      // uleselige. Dekalene har fast FYSISK størrelse og følger veggen.
      const nx = v.nx !== undefined ? v.nx : Math.sin(v.rot);
      const nz = v.nz !== undefined ? v.nz : Math.cos(v.rot);
      const nv = new THREE.Vector3(nx, 0, nz).normalize();
      const utD = tilScene(v.tMm) / 2 + 0.01 / (S.enhetSkala || 1);
      const L = tilScene(v.lengdeMm), H = tilScene(v.hoydeMm);
      const sw = tekstDekal(v.sw, 220, L * 0.45);
      sw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
      sw.position.set(
        v.x - ex * L * 0.32 + nv.x * utD,
        v.y + H * 0.24,
        v.z - ez * L * 0.32 + nv.z * utD);
      swGroup.add(sw);
      // Skråkapp merkes med BEGGE endehøydene OG VINKELEN —
      // «5980×1100/460MM 6,1°» — for det er de tre målene verkstedet trenger
      // for å skjære panelet (Emil 08.09).
      const hTekst = v.skra ? v.hVMm + "/" + v.hHMm : String(v.hoydeMm);
      const vTekst = v.skra
        ? " " + (v.skraTekst || vinkelTekst(skraVinkel(v.lengdeMm, v.hVMm, v.hHMm))) : "";
      const dim = tekstDekal(v.lengdeMm + "×" + hTekst + "MM" + vTekst, 150, L * 0.6);
      dim.quaternion.copy(sw.quaternion);
      dim.position.set(v.x + nv.x * utD, v.y - H * 0.1, v.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
}

// Tegner alt fra de lagrede tallene. Vegger: {x,y,z,rot,lengdeMm,hoydeMm,tMm,sw,tilpasset}
export function tegnAlt() {
  ryddTegning();
  tegnDelA();
  // 🚪 Innerveggene tegnes ETTER ytterveggene, fra sin EGEN lagring. Egen
  // try/catch med vilje: en feil i del B skal ikke la bygget stå uten
  // yttervegger.
  try { tegnInnervegger(); }
  catch (err) { console.warn("Innerveggene kunne ikke tegnes:", err); }
  // swGroup er revet og bygget opp igjen — alt er ferske materialer som ikke
  // vet at Gjennomsiktig står på. Uten dette kom elementer generert MENS ghost
  // var på ut solide midt i en gjennomsiktig modell.
  if (S.ghostPaaNytt) S.ghostPaaNytt();
  oppdaterSwValgEffekt();
}

export function tegnDelA() {
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  const sk = lagret.skjul || {};
  if (lagret.gulv && !sk.gulv) {
    const g = lagret.gulv;
    const betong = boks("#9aa3ad", 1);
    betong.scale.set(g.bredde, tilScene(o.betongMm), g.dybde);
    betong.position.set(g.x, g.topp - tilScene(o.betongMm) / 2, g.z);
    swGroup.add(betong);
    if (o.isoMm > 0) {
      const iso = boks("#e8e4da", 1);
      iso.scale.set(g.bredde, tilScene(o.isoMm), g.dybde);
      iso.position.set(g.x, g.topp - tilScene(o.betongMm) - tilScene(o.isoMm) / 2, g.z);
      swGroup.add(iso);
    }
  }
  // 🧱 RINGMUREN: samme dra-funksjon som veggelementene (Emil 03.09).
  // Hver bit får swId, så «Juster elementer» plukker den opp uendret, og en
  // dimensjonslapp i midten slik elementene har.
  tegnRingmurBiter(sk.ringmur ? [] : lagret.ringmur || [], !sk.merking);
  if (!sk.vegger) tegnVeggElementer(lagret.vegger || [], o, !sk.merking);
  if (!sk.merking) {
    try { tegnUtspMerking(); }
    catch (err) { console.warn("Utsparingsmerkingen kunne ikke tegnes:", err); }
  }
}

// ---------- 📐 Utsparingsmerking: stiplet kryss + mål ----------
// Som på Moelv-tegningen (Emil 02.09): åpningen får en stiplet ramme med
// kryss, ett mål for HELE åpningen (bredde × høyde), og for hvert element som
// går gjennom området et lite mål på HVOR DYPT det må kappes inn.
// Skrus av og på med «Vis utsparingsmål» i panelet.
// SW-basen (topp ringmur). Mangler den i lagringen — vegger generert av en
// eldre versjon — regnes den ut av et element: y er radens midte.
export function baseYNaa() {
  if (lagret && lagret.baseY !== undefined) return lagret.baseY;
  for (const v of (lagret && lagret.vegger) || [])
    if (v.rBunnMm !== undefined && v.hoydeMm) return v.y - tilScene(v.rBunnMm + v.hoydeMm / 2);
  return 0;
}

// Åpningene projisert på fasadene, REGNET UT VED TEGNING. Tidligere ble dette
// bare lagret ved generering (lagret.utspVis), og da viste merkingen
// ingenting på vegger som alt lå i localStorage fra en tidligere generering —
// som er den vanlige situasjonen, siden veggene tegnes opp igjen når modellen
// åpnes (Emils funn 02.09). Nå følger merkingen også med når en utsparing
// legges til eller slettes i panelet, uten å generere på nytt.
export function utspPaFasader() {
  if (!lagret) return [];
  const o = lagret.oppsett || STD_OPPSETT;
  const fasader = lagret.fasader || [];
  const liste = (o.utsparinger || []).filter(u => u && u.min && u.max);
  if (!fasader.length || !liste.length) return lagret.utspVis || [];
  const bY = baseYNaa();
  const ut = [];
  for (const u of liste) {
    let bi = -1, best = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      // Samme regel som innerveggene bruker — én funksjon, ett svar. En
      // innervegg som ligger nærmere eier åpningen, og merkingen følger den.
      const avst = eierUtsparing(fasader[fi], u, (lagretInner && lagretInner.fasader) || [], APN_SLARK / (S.enhetSkala || 1));
      if (avst === null) continue;
      if (avst < best) { best = avst; bi = fi; }
    }
    if (bi < 0) continue;
    const f = fasader[bi];
    const ts = [];
    for (const px of [u.min[0], u.max[0]]) for (const pz of [u.min[2], u.max[2]])
      ts.push((px - f.px) * f.ex + (pz - f.pz) * f.ez);
    ut.push({ fi: bi, fraMm: tilMm(Math.min(...ts)), tilMm_: tilMm(Math.max(...ts)),
              bunnMm: tilMm(u.min[1] - bY), toppMm: tilMm(u.max[1] - bY), type: u.type, navn: u.navn });
  }
  return ut.length ? ut : (lagret.utspVis || []);
}

export function tegnUtspMerking() {
  if (!lagret) return;
  const o0 = lagret.oppsett || STD_OPPSETT;
  if (o0.visUtsp === false) return;
  tegnUtspMerkingFor(utspPaFasader(), lagret.fasader || [], lagret.vegger || [],
    baseYNaa(), o0.tykkelseMm);
}

// Samme merking for yttervegger og innervegger. Tykkelsen tas fra fasadens
// EGET oppsett når det finnes (innerveggene har hver sin), ellers fra tallet
// som sendes inn.
export function tegnUtspMerkingFor(apninger, fasader, vegger, baseY, tykkelseMm) {
  if (!apninger.length) return;
  // Merkingen skal SKJULES BAK OBJEKT, som SW-lappene og målene på veggene
  // (Emil 02.09). Derfor vanlig dybdetest og ingen renderOrder — det var
  // depthTest:false som lot krysset på baksiden skinne gjennom fasaden.
  const strekMat = new THREE.LineDashedMaterial({
    color: 0x11161d, dashSize: 0.12 / (S.enhetSkala || 1),
    gapSize: 0.08 / (S.enhetSkala || 1) });
  for (const a of apninger) {
    const f = fasader[a.fi];
    if (!f) continue;
    const tMm = ((f.o || {}).tykkelseMm !== undefined) ? f.o.tykkelseMm : tykkelseMm;
    // veggplanet, litt utenfor panelet så streken ikke drukner i det
    const utD = f.off + tilScene(tMm) / 2 + 0.03 / (S.enhetSkala || 1);
    const pkt = (mm, y) => new THREE.Vector3(
      f.px + f.ex * tilScene(mm) + f.nx * utD, y,
      f.pz + f.ez * tilScene(mm) + f.nz * utD);
    const y0 = baseY + tilScene(a.bunnMm), y1 = baseY + tilScene(a.toppMm);
    const h0 = pkt(a.fraMm, y0), h1 = pkt(a.tilMm_, y0);
    const t0 = pkt(a.fraMm, y1), t1 = pkt(a.tilMm_, y1);
    const geo = new THREE.BufferGeometry().setFromPoints([
      h0, h1, h1, t1, t1, t0, t0, h0,     // rammen
      h0, t1, h1, t0                      // krysset
    ]);
    const linje = new THREE.LineSegments(geo, strekMat);
    linje.computeLineDistances();          // MÅ til, ellers blir streken hel
    linje.raycast = () => {};
    swGroup.add(linje);
    // totalmålet midt i åpningen
    const bredde = Math.round(a.tilMm_ - a.fraMm);
    const hoyde = Math.abs(a.toppMm) > 1e8 ? null : Math.round(a.toppMm - a.bunnMm);
    const nv = new THREE.Vector3(f.nx, 0, f.nz).normalize();
    const midtMm = (a.fraMm + a.tilMm_) / 2;
    const tot = tekstDekal(bredde + "×" + (hoyde === null ? "—" : hoyde) + " MM", 260,
      tilScene(Math.max(bredde * 0.8, 600)));
    tot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    tot.position.copy(pkt(midtMm, (y0 + y1) / 2));
    tot.raycast = () => {};
    swGroup.add(tot);
    // 🚪 navnet («Port 1», «Vindu 3») rett over målet (punkt 1)
    if (a.navn) {
      const navnLapp = tekstDekal(String(a.navn).toUpperCase(), 260, tilScene(Math.max(bredde * 0.8, 600)));
      navnLapp.quaternion.copy(tot.quaternion);
      navnLapp.position.copy(pkt(midtMm, (y0 + y1) / 2 + tilScene(320)));
      navnLapp.raycast = () => {};
      swGroup.add(navnLapp);
    }
    // KAPPDYBDEN per element som går gjennom området
    for (const v of vegger || []) {
      if (v.skjult || v.fi !== a.fi || v.fraMm === undefined) continue;
      const x0 = Math.max(v.fraMm, a.fraMm), x1 = Math.min(v.tilMm, a.tilMm_);
      if (x1 - x0 <= 10) continue;
      const b0 = Math.max(v.rBunnMm, a.bunnMm), b1 = Math.min(v.rBunnMm + v.hoydeMm, a.toppMm);
      const dybde = Math.round(b1 - b0);
      if (dybde <= 10 || dybde >= v.hoydeMm - 10) continue;   // hel rad = ikke et kapp
      const lapp = tekstDekal("↕ " + dybde, 170, tilScene(Math.max(x1 - x0, 400)));
      lapp.quaternion.copy(tot.quaternion);
      lapp.position.copy(pkt((x0 + x1) / 2, baseY + tilScene((b0 + b1) / 2)));
      lapp.raycast = () => {};
      swGroup.add(lapp);
    }
  }
}

// ---------- 🏷 Tekst-dekaler: flate skilt limt på elementflaten ----------
// Hvit boks med sort tekst, som elementmerkene på Moelv-tegningen. Teksturen
// caches per tekst (SW-03 går igjen hundrevis av ganger); materialet og
// geometrien er per dekal og ryddes av ryddTegning.
export const dekalCache = new Map();

export function dekalTekstur(tekst) {
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

// hoydeMm = ønsket skilthøyde i mm; maksBredde (sceneenheter) krymper skiltet
// så det aldri stikker utenfor elementet det sitter på.
export function tekstDekal(tekst, hoydeMm, maksBredde) {
  const { tex, aspect } = dekalTekstur(tekst);
  let h = tilScene(hoydeMm), w = h * aspect;
  if (maksBredde > 0 && w > maksBredde) { const k = maksBredde / w; w *= k; h *= k; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ map: tex }));
  m.raycast = () => {};   // lappene er skilt, ikke noe å trykke på
  // Skiltet skal IKKE bli gjennomsiktig sammen med veggen det sitter på:
  // du slår på Gjennomsiktig for å se hva som står BAK elementet, og da må
  // du fortsatt kunne lese hvilket element du ser gjennom.
  m.userData.ghostFritatt = true;
  return m;
}

// Kalles av afterLoad (ifc.js) når en modell er åpnet, og av clearModel når
// den lukkes — samme kroker som materiell og grupper bruker.
S.lastSW = () => {
  settLagret(lesLagret());
  settLagretInner(lesInner());    // 🚪 leses fra sin egen nøkkel, per fil
  lesSkjulteIder();            // 👁 må leses FØR tegnAlt, ellers blinker de fram
  loesAlleJusteringer();
  tegnAlt();
  // Lagrede resultater hentes fra SharePoint i bakgrunnen. Ikke ventet på:
  // modellen skal stå på skjermen med en gang, også uten dekning.
  hentLagredeFraSp();
  // 🚪 ÉN GANGS OPPRYDDING (runde 24): innervegger bygget med den gamle,
  // romslige åpningsregelen kan ha fått en utsparing fra en vegg PÅ TVERS.
  // De bygges på nytt én gang per fil; merket hindrer at det gjentas.
  if (lagretInner && (lagretInner.serier || []).length
      && lagretInner.apnRegel !== APN_REGEL) {
    lagretInner.apnRegel = APN_REGEL;
    oppdaterInnerveggerEtterUtsp();
  }
};
S.ryddSW = () => { if (just) avsluttJuster(); settLagret(null); ryddTegning(); };

// ---------- 🏔 Taklinja lest ut av stålet i fasadeplanet ----------
// takLinje() over er ren matematikk. Her hentes PUNKTENE den skal jobbe på:
// hver stålbit som står i fasadeplanet projiseres ned på fasadeaksen, og
// toppen av den følges.
//
// HVORFOR TREKANTENE OG IKKE BOKSENE: en takbjelke på et saltak er skrå, og
// den akse-justerte boksen rundt den er like høy som MØNET langs HELE spennet.
// Bygger vi taklinja på bokser, blir gavlen flat på mønehøyde — verre enn feilen
// vi prøver å fikse. Trekantpunktene gir den skrå overkanten slik den er.
//
// Punktene bøttes på 100 mm langs fasaden (høyeste punkt per bøtte) før de
// sendes til hylla. Uten bøtta ville en gavl med 40 000 trekanter gitt 120 000
// punkter til en sortering som bare trenger toppene.
export const TAK_BOTTE_MM = 100;
export const TAK_TOL_MM = 100;   // knekk lavere enn dette er støy, ikke møne

export function taklinjerFraModell(fasader, tS) {
  const bokser = allElementBoxes();
  const naer = Math.max(0.8 / (S.enhetSkala || 1), tS * 3);
  // 1) hver stålbit til NÆRMESTE fasadeplan den ligger langs (samme regel som
  //    stalPaFasader — en bjelke i et hjørne er nær to plan)
  const tilFasade = new Map();
  for (const [id, b] of bokser) {
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    let best = -1, bestD = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      const dd = Math.abs((cx - f.p.x) * f.nx + (cz - f.p.z) * f.nz);
      if (dd > naer || dd >= bestD) continue;
      const ts = [];
      for (const px of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z])
        ts.push((px - f.p.x) * f.ex + (pz - f.p.z) * f.ez);
      const t0 = f.soyler[0].t, t1 = f.soyler[f.soyler.length - 1].t;
      if (Math.max(...ts) < Math.min(t0, t1) - naer || Math.min(...ts) > Math.max(t0, t1) + naer) continue;
      best = fi; bestD = dd;
    }
    if (best >= 0) tilFasade.set(id, best);
  }
  if (!tilFasade.size) return fasader.map(() => []);
  // 2) trekantene til de bitene, projisert og bøttet
  const botte = tilScene(TAK_BOTTE_MM) || 0.1;
  const bytter = fasader.map(() => new Map());
  const se = (fi, t, y) => {
    const k = Math.round(t / botte);
    const m = bytter[fi];
    const e = m.get(k);
    if (!e || y > e[1]) m.set(k, [t, y]);
  };
  const v = new THREE.Vector3();
  // Punktene KLIPPES til fasadens egen utstrekning (pluss en meter til
  // hjørnelappen). Ellers drar en raftbjelke som løper videre inn i et tilbygg
  // taklinja med seg langt utenfor veggen, og hylla får et endepunkt som ikke
  // finnes på denne fasaden.
  const rand = 1 / (S.enhetSkala || 1);
  const gr = fasader.map(f => {
    const a2 = f.soyler[0].t, b2 = f.soyler[f.soyler.length - 1].t;
    return [Math.min(a2, b2) - rand, Math.max(a2, b2) + rand];
  });
  forHverTrekant(new Set(tilFasade.keys()), (pos, i0, i1, i2, mtx, id) => {
    const fi = tilFasade.get(id);
    if (fi === undefined) return;
    const f = fasader[fi];
    for (const i of [i0, i1, i2]) {
      v.fromBufferAttribute(pos, i);
      if (mtx) v.applyMatrix4(mtx);
      const tt = (v.x - f.p.x) * f.ex + (v.z - f.p.z) * f.ez;
      if (tt < gr[fi][0] || tt > gr[fi][1]) continue;
      se(fi, tt, v.y);
    }
  });
  // 3) hylla, i MM langs fasaden og MM i høyden over SW-basen — samme enhet
  //    som resten av elementregninga
  return bytter.map(m => [...m.values()]);
}
