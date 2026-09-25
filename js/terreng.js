// ⛰ Terreng — hent landskapet rundt byggeplassen fra Kartverket og sett
// modellen ned i det, så prosjektlederen ser bygget i terrenget i stedet for
// å sveve i svart.
//
// Grunnlag: «Storm IFC-Viewer Terreng VEDTATT SPESIFIKASJON 2026-09-24.md» og
// «byggeplan Terreng 2026-09-25.md». Denne fila dekker TRINN 1–3:
//   1. knappen i Bygg Info og panelet
//   2. adresse → koordinat → høydegrid (ws.geonorge.no + WCS)
//   3. gridet som flate i scenen, i RIKTIG MÅLESTOKK
// Beskjæring, plassering/rotasjon, gulvkote og lagring i SharePoint (trinn
// 4–7) kommer oppå dette uten å rive noe: terrenget ligger allerede i sin egen
// gruppe med nullpunkt, og gridet holdes i minnet.
//
// Kun kontor: importeres av main.js, IKKE av lett-main.js (spesifikasjonen
// punkt 5 — byggeplass-lenka når ikke SharePoint uansett).
//
// Den rene regningen (TIFF-lesing, UTM, grid → trekanter) ligger i
// js/terreng-regn.js, så den kan testes uten nettleser.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på, registrerEkstraGruppe, fmtLen } from "./state.js";
import { t } from "./i18n.js";
import { camera, controls, frameHooks, grid, scene } from "./scene.js";
import {
  STANDARD_UTSNITT, UTSNITT, adresseUrl, bboxFra, gridTilTrekanter, hoydeFarger,
  hoydeSpenn, hoydeVed, lesTiff, mTilScene, tolkKoordinat, vaskAdresseSvar, wcsUrl
} from "./terreng-regn.js";

// ═══════════════════════ TILSTAND ═══════════════════════
// Alt om det lastede terrenget. null = ingen terreng.
//   grid     — rådataene fra Kartverket (beholdes: beskjæring i trinn 4 og
//              masseberegning senere trenger høydene, ikke trekantene)
//   E0, N0   — nullpunktet i UTM33 (adressepunktet, avrundet til hel meter)
//   h0       — høyden som legges i modellens laveste punkt (foreløpig — i
//              trinn 6 byttes den mot gulvkoten fra tegningen)
//   adresse  — teksten brukeren valgte
let terreng = null;
let skjult = false;
let opptatt = false;
let melding = "";        // statuslinja i panelet
let meldingFeil = false;
let treff = [];          // adressetreff å velge mellom
let sisteSok = "";
let utsnitt = STANDARD_UTSNITT;

// ═══════════════════════ SCENEN ═══════════════════════
// Egen gruppe ved siden av modellen, som materiellet og SW-elementene.
// Gruppa har nullpunktet; meshet inni har koordinater relativt til det.
export const terrengGroup = new THREE.Group();
terrengGroup.name = "terreng";
scene.add(terrengGroup);

// Laget melder inn hva det kan (se EKSTRA_LAG i js/state.js).
//
// TERRENGET HAR MED VILJE IKKE «plukk» OG IKKE «velg». Kan en terrengtrekant
// velges, havner den i flervalg, grupper og Mengder — en feil som sprer seg
// til fire verktøy før noen skjønner hvor den kom fra (byggeplanen, advarsel 3).
// I stedet har det «flate»: 📏 Mål og ▲ Kote kan treffe terrenget, ingenting
// annet. Det er slik 100 m-testen i trinn 3 i det hele tatt kan gjøres.
//
// «mengder» og «sokRader» er tomme med vilje — kontrakten i test-ekstralag
// krever at hvert lag svarer, og terrenget svarer «ingenting å telle».
registrerEkstraGruppe(terrengGroup, {
  id: "terreng",
  navn: "Terreng",
  noeSkjult: () => !!terreng && skjult,
  visAlt() { if (skjult) settSkjult(false); },
  skjulTilstand: () => ({ skjult }),
  settSkjulTilstand(v) { settSkjult(!!(v && v.skjult)); },
  mengder: () => {},
  sokRader: () => [],
  gaTil() { flyTilTerreng(); },
  utseendeRader(body) { tegnUtseendeRad(body); },
  flate: (x, y) => flateTreff(x, y)
});

function settSkjult(v) {
  skjult = !!v;
  terrengGroup.visible = !!terreng && !skjult;
  oppdaterRutenett();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (erApen()) tegnPanel();
}

// GridHelperen i scene.js ligger i modellens laveste punkt. Med terreng i
// samme plan flimrer de to flatene om hverandre (z-fighting) — det ser ut som
// en grafikkfeil. Rutenettet viker når terrenget vises.
function oppdaterRutenett() {
  grid.visible = !(terreng && !skjult);
}

// Kameraets bakre klippeplan settes av fitToModel etter MODELLENS størrelse
// (10 × diagonalen). Et bygg på 30 m får da ~400 m sikt, og en 800 m tomt
// kuttes i kanten. Rammekroken strekker det så hele terrenget synes — også
// etter at noen har trykket «Tilpass», som setter det tilbake.
let trengerFar = 0;
frameHooks.push(() => {
  if (!trengerFar || !terrengGroup.visible) return;
  if (camera.far < trengerFar) { camera.far = trengerFar; camera.updateProjectionMatrix(); }
});

// ⛰ Treff på terrenget, for Mål og Kote. Egen stråle — raycasteren i
// scene.js deles med valg og snapping, og vi vil ikke flytte pekeren deres.
const _ray = new THREE.Raycaster();
const _p = new THREE.Vector2();
function flateTreff(x, y) {
  if (!terreng || !terrengGroup.visible) return null;
  _p.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  _ray.setFromCamera(_p, camera);
  const h = _ray.intersectObjects(terrengGroup.children, false)[0];
  if (!h) return null;
  // utenSnap: kant-snappen i measure.js bygger kantliste per element og er
  // laget for stål. På 300 000 terrengtrekanter finnes ingen «hjørner» å
  // feste seg til — punktet du peker på er punktet.
  return { point: h.point, distance: h.distance, object: h.object, utenSnap: true };
}

function ryddScene() {
  for (const m of terrengGroup.children.slice()) {
    terrengGroup.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  }
  trengerFar = 0;
}

// Bygger flata. Plassering i plan (trinn 3): adressepunktet midt under
// modellens senter. Høyde: terrenget i adressepunktet legges i modellens
// laveste punkt. Begge deler er foreløpige — trinn 5 lar deg dra og rotere
// bygget, trinn 6 bytter høyden mot gulvkoten fra tegningen.
function tegnTerreng() {
  ryddScene();
  if (!terreng || !S.modelGroup) { oppdaterRutenett(); return; }
  const skala = S.enhetSkala || 1;
  const { grid: g, E0, N0, h0 } = terreng;
  const tr = gridTilTrekanter(g, E0, N0, h0, skala);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(tr.pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(hoydeFarger(g, terreng.spenn), 3));
  geo.setIndex(new THREE.BufferAttribute(tr.idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // Skyver terrenget et hårsbredd bakover i dybdebufferen, så en
    // bunnplate som ligger nøyaktig i terrenghøyden vinner over terrenget
    // i stedet for å flimre.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrengflate";
  mesh.userData.terreng = true;
  terrengGroup.add(mesh);

  const boks = new THREE.Box3().setFromObject(S.modelGroup);
  const c = boks.getCenter(new THREE.Vector3());
  terrengGroup.position.set(c.x, boks.min.y, c.z);
  terrengGroup.visible = !skjult;

  trengerFar = mTilScene(g.w * g.dx * 4, skala);
  oppdaterRutenett();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
}

function flyTilTerreng() {
  if (!terreng) return;
  const s = mTilScene(terreng.grid.w * terreng.grid.dx, S.enhetSkala || 1);
  const c = terrengGroup.getWorldPosition(new THREE.Vector3());
  camera.position.set(c.x + s * 0.45, c.y + s * 0.45, c.z + s * 0.45);
  controls.target.copy(c);
  controls.update();
}

// ═══════════════════════ HENTING ═══════════════════════

async function sokAdresse(tekst) {
  const hent = async (fuzzy) => {
    const r = await fetch(adresseUrl(tekst, fuzzy));
    if (!r.ok) throw new Error("HTTP " + r.status);
    return vaskAdresseSvar(await r.json());
  };
  let liste = await hent(false);
  if (!liste.length) liste = await hent(true);
  return liste;
}

async function hentGrid(E, N) {
  const bb = bboxFra(E, N, utsnitt);
  const r = await fetch(wcsUrl(bb));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return { grid: lesTiff(await r.arrayBuffer()), bb };
}

function settMelding(tekst, feil) {
  melding = tekst || ""; meldingFeil = !!feil;
  if (erApen()) tegnPanel();
}

// Knappen «Hent terreng». To tall → koordinat rett inn. Ellers adressesøk:
// ett treff hentes med en gang, flere vises som en liste å velge fra —
// adressesøk treffer sjelden blink første gang.
async function startHenting() {
  if (opptatt) return;
  const inp = $("trAdresse");
  const tekst = (inp && inp.value || "").trim();
  sisteSok = tekst;
  if (!tekst) { settMelding(t("Skriv en adresse eller en koordinat først."), true); return; }
  treff = [];
  const k = tolkKoordinat(tekst);
  if (k) { await hentTerreng({ tekst: Math.round(k.E) + " Ø, " + Math.round(k.N) + " N", E: k.E, N: k.N }); return; }
  opptatt = true; settMelding(t("Søker etter adressen …"));
  try {
    const liste = await sokAdresse(tekst);
    opptatt = false;
    if (!liste.length) { settMelding(t("Fant ingen adresse. Prøv med postnummer eller poststed, eller skriv en UTM33-koordinat."), true); return; }
    if (liste.length === 1) { await hentTerreng(liste[0]); return; }
    treff = liste.slice(0, 5);
    settMelding(t("Velg riktig adresse:"));
  } catch (err) {
    opptatt = false;
    console.warn("Adressesøk feilet:", err);
    settMelding(t("Fikk ikke kontakt med Kartverket. Sjekk nettet og prøv igjen."), true);
  }
}

async function hentTerreng(adr) {
  if (!S.modelGroup) { settMelding(t("Åpne en modell først."), true); return; }
  opptatt = true; treff = [];
  settMelding(t("Henter høydedata fra Kartverket …"));
  const forFil = S.fileName;
  try {
    const { grid: g, bb } = await hentGrid(adr.E, adr.N);
    if (S.fileName !== forFil) { opptatt = false; return; }   // modellen ble byttet underveis
    const spenn = hoydeSpenn(g);
    if (!spenn.gyldige) {
      opptatt = false;
      settMelding(t("Kartverket har ingen høydedata her (sjø, eller utenfor dekningen)."), true);
      return;
    }
    const E0 = Math.round(adr.E), N0 = Math.round(adr.N);
    // Høyden i adressepunktet. Står punktet i et hull (sjø, bro), brukes
    // laveste høyde i utsnittet — da havner i det minste ikke hele terrenget
    // over bygget.
    const hPunkt = hoydeVed(g, E0, N0);
    const h0 = hPunkt != null ? hPunkt : spenn.min;
    const forrige = terreng;
    terreng = { grid: g, bb, E0, N0, h0, hPunkt, spenn, adresse: adr };
    skjult = false;
    tegnTerreng();
    opptatt = false;
    settMelding("");
    if (S.pushAngre) S.pushAngre({
      tekst: "Terreng hentet",
      angre: () => { terreng = forrige; skjult = false; tegnTerreng(); if (erApen()) tegnPanel(); },
      gjenopprett: () => { terreng = { grid: g, bb, E0, N0, h0, hPunkt, spenn, adresse: adr }; skjult = false; tegnTerreng(); if (erApen()) tegnPanel(); }
    });
  } catch (err) {
    opptatt = false;
    console.warn("Henting av terreng feilet:", err);
    settMelding(t("Klarte ikke å hente terrenget: ") + (err && err.message || err), true);
  }
}

function fjernTerreng() {
  if (!terreng) return;
  const forrige = terreng;
  terreng = null; skjult = false;
  tegnTerreng();
  tegnPanel();
  if (S.oppdaterVisAlle) S.oppdaterVisAlle();
  if (S.pushAngre) S.pushAngre({
    tekst: "Terreng fjernet",
    angre: () => { terreng = forrige; tegnTerreng(); if (erApen()) tegnPanel(); },
    gjenopprett: () => { terreng = null; tegnTerreng(); if (erApen()) tegnPanel(); }
  });
}

// Modellbytte: terrenget var lagt under forrige modell, med dens senter og
// dens enheter. Det hører ikke til den neste. (Trinn 8: finnes en
// plasseringsfil for den nye modellen, hentes terrenget inn igjen av seg selv.)
S.ryddTerreng = () => {
  terreng = null; skjult = false; treff = [];
  ryddScene();
  oppdaterRutenett();
};

// ═══════════════════════ 🎨 UTSEENDE ═══════════════════════
function tegnUtseendeRad(body) {
  if (!body || !terreng) return;
  const el = document.createElement("div");
  el.innerHTML = '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
    t("Terreng") + '</div><div class="c"><button data-terreng-skjul title="' + t("Skjul/vis") +
    '" style="padding:3px 8px">' + ikon(skjult ? "skjul" : "vis") + "</button></div></div>";
  body.appendChild(el);
  const b = el.querySelector("button[data-terreng-skjul]");
  b.onclick = () => { settSkjult(!skjult); b.innerHTML = ikon(skjult ? "skjul" : "vis"); };
}

// ═══════════════════════ PANELET ═══════════════════════
function erApen() {
  const p = $("terrengPanel");
  return !!(p && p.classList.contains("open"));
}

function fmtMoh(v) {
  return (Math.round(v * 10) / 10).toLocaleString("no-NO") + " " + t("moh.");
}

function tegnPanel() {
  const body = $("terrengBody");
  if (!body) return;
  const valg = UTSNITT.map(s => '<option value="' + s + '"' + (s === utsnitt ? " selected" : "") + ">" +
    s + " × " + s + " m</option>").join("");
  let html =
    '<label>' + t("Adresse eller koordinat") +
    '<input type="text" id="trAdresse" maxlength="120" value="' + esc(sisteSok) + '" placeholder="' +
    t("f.eks. Industriveien 20, Geithus") + '"' + (opptatt ? " disabled" : "") + "></label>" +
    '<label>' + t("Utsnitt") + '<select id="trUtsnitt"' + (opptatt ? " disabled" : "") + ">" + valg + "</select></label>" +
    '<div class="prop-actions"><button id="trHent" class="primary"' + (opptatt ? " disabled" : "") + ">" +
    ikon("kote") + " " + t("Hent terreng") + "</button></div>";

  if (melding) {
    html += '<p style="font-size:12px;margin:6px 0 0;color:' + (meldingFeil ? "var(--accent)" : "var(--muted)") + '">' +
      esc(melding) + "</p>";
  }
  if (treff.length) {
    html += treff.map((a, i) =>
      '<div class="qty-row"><div class="n" data-tr-treff="' + i + '" style="cursor:pointer">' +
      ikon("markering") + " " + esc(a.tekst) +
      ' <span style="color:var(--muted);font-size:11px">' + esc([a.postnummer, a.poststed].filter(Boolean).join(" ")) +
      (a.kommune ? " · " + esc(a.kommune) : "") + "</span></div></div>").join("");
  }

  html += '<p style="color:var(--muted);font-size:11px;margin:8px 0 0">' +
    t("Henter 1 m terrengmodell fra Kartverket. Terrenget viser bakken slik den var da den ble laserskannet — før graving.") + "</p>";

  if (terreng) {
    const g = terreng.grid;
    const b = Math.round(g.w * g.dx), h = Math.round(g.h * g.dy);
    html += '<h4 style="margin:12px 0 4px">' + t("Lastet terreng") + "</h4>" +
      '<div class="qty-row"><div class="n">' + ikon("kote") + " " + esc(terreng.adresse.tekst) +
      ' <span style="color:var(--muted);font-size:11px">' +
      esc([terreng.adresse.postnummer, terreng.adresse.poststed].filter(Boolean).join(" ")) + "</span></div>" +
      '<div class="c"><button id="trSkjul" title="' + t("Skjul/vis") + '" style="padding:3px 8px">' + ikon(skjult ? "skjul" : "vis") + "</button>" +
      '<button id="trFjern" title="' + t("Fjern terrenget") + '" style="padding:3px 8px">' + ikon("slett") + "</button></div></div>" +
      '<p style="font-size:12px;margin:4px 0 0">' +
      b + " × " + h + " m · " + fmtMoh(terreng.spenn.min) + " – " + fmtMoh(terreng.spenn.max) + "<br>" +
      t("Terrenghøyde i adressepunktet:") + " " + (terreng.hPunkt != null ? fmtMoh(terreng.hPunkt) : "–") + "</p>" +
      '<p style="color:var(--muted);font-size:11px;margin:6px 0 0">' +
      t("Foreløpig plassering: adressepunktet ligger midt under modellen, i høyde med modellens laveste punkt. Flytting, rotasjon og gulvkote kommer i neste trinn.") + "</p>" +
      '<p style="color:var(--muted);font-size:11px;margin:6px 0 0">' +
      t("Kontroller målestokken: mål en kjent avstand på terrenget med Mål.") +
      " " + t("Utsnittet er") + " " + fmtLen(b) + ".</p>";
  }

  // Advarselen står i PANELET, ikke bare i spesifikasjonen (byggeplanen,
  // advarsel 4). Den som skal grave, leser ikke spesifikasjoner.
  html += '<p style="font-size:11px;margin:10px 0 0;padding:6px 8px;border:1px solid var(--border);border-radius:6px">' +
    ikon("advarsel") + " " +
    t("Plasseringen er omtrentlig (±1–2 m) og skal aldri brukes til utstikking.") + "</p>";

  body.innerHTML = html;

  const inp = $("trAdresse");
  if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); startHenting(); } };
  const sel = $("trUtsnitt");
  if (sel) sel.onchange = () => { utsnitt = Number(sel.value) || STANDARD_UTSNITT; };
  const hent = $("trHent");
  if (hent) hent.onclick = () => startHenting();
  body.querySelectorAll("[data-tr-treff]").forEach(d =>
    d.onclick = () => { const a = treff[Number(d.dataset.trTreff)]; if (a) { sisteSok = a.tekst; hentTerreng(a); } });
  const sk = $("trSkjul");
  if (sk) sk.onclick = () => settSkjult(!skjult);
  const fj = $("trFjern");
  if (fj) fj.onclick = () => fjernTerreng();
}

på("btnTerreng", "click", () => {
  const panel = $("terrengPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("terrengPanel");
  const inp = $("trAdresse");
  if (inp && !terreng) setTimeout(() => inp.focus(), 50);
});
