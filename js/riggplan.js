// 📄 Riggplan — nedlastbar PDF (trinn 6). Emils bestilling: «Nedlastbar PDF
// som heter "riggplan" som er en pdf med bilder av området sett ovenfra fra
// nord til sør, og en sideseksjon som beskriver hva de forskjellige objektene
// i tegningen betyr.» Tolket som: sett rett ovenfra med NORD OPP.
//
// Arket (A3 liggende): oppsett «C — presentasjon», valgt av Emil 29.09 av tre
// prøver (rigg-runde14-a). Toppbånd med logo og tittel, planen under med
// «nåler» som peker ned i objektene, «Hva er hva» som kort til høyre. Selve
// målene står i RIGGPLAN (rigg-regn.js), tegningen av arket i tegnArk under.
//
// BILDENE HAR SKYGGER — BARE HER (runde 14). Skjermen og byggeplass-siden
// tegnes uten skygger, fordi en skyggekart-rendring hvert bilde koster for
// mye på svake telefoner. For PDF-en tegnes ETT bilde av gangen, og da har vi
// råd: skyggene slås på rett før, og av igjen i finally (se medSkygger).
//
// Bildet tegnes med et ORTOGRAFISK kamera rett ovenfra, i en rund målestokk
// (1:500, 1:1000 …), så planen kan måles på med linjal. Kameraet dreies så
// nord er opp: terrenget er rotert med byggets plass.rot, og uten den
// dreiningen ville nord stått skjevt på arket.
//
// Den rene regningen (målestokk, skalastrek, tegnforklaring, filnavn) ligger i
// rigg-regn.js og testes i Node. Denne fila rører DOM, three.js og jsPDF, og
// lastes først når noen trykker på knappen (dynamisk import fra rigg.js).
import * as THREE from "three";
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { grid, renderer, scene } from "./scene.js";
import { hentJsPDF, lastNedFil, norskDato } from "./rapport.js";
import { hentLogo, hentLogoer } from "./tegninger.js";
import { riggIkon } from "./rigg-ikoner.js";
import {
  MAKS_AVSTAND_M, MERKE_R, OVERSIKTSBILDER, OVERSIKT_FOV, OVERSIKT_VINKEL, PORT_FARGE, RIGGPLAN, RIGG_TYPER, SRGB_TABELL,
  gjerdeStykker, nordOgOst, oversiktAvstand, plasserMerker, riggplanNummer, riggObjekter, riggplanDekning, riggplanFilnavn,
  riggplanTegnforklaring, skalaStrek, vaskMalestokkValg, velgMalestokk
} from "./rigg-regn.js";
import { aktivRef, finnRiggObjekt, riggBase, riggGroup, toneFarge } from "./rigg-vis.js";

const PX_PER_MM = 7;          // bildets oppløsning: 292 mm → ~2000 px
const GRÅ = "#6b7280", SORT = "#14161a", LINJE = "#c9ced6", KORT = "#f4f5f7";
// Storms røde (samme som --storm-rod i css/storm.css). Arket er et dokument,
// ikke skjermen, så CSS-variablene kan ikke brukes her.
const STORM_ROD = "#d22b34";

function hex(d, farge, felt) {
  const n = parseInt(String(farge).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (felt === "fyll") d.setFillColor(r, g, b);
  else if (felt === "strek") d.setDrawColor(r, g, b);
  else d.setTextColor(r, g, b);
}

// Boksen rundt alt som er TEGNET i en gruppe — uten navnelapper (sprites),
// som ellers ville blåst opp utstrekningen.
function boksUtenLapper(rot) {
  const boks = new THREE.Box3(), b = new THREE.Box3();
  rot.updateMatrixWorld(true);
  rot.traverse(o => {
    if (!o.isMesh || o.isSprite || !o.visible || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    boks.union(b);
  });
  return boks;
}

function hjorner(boks) {
  const ut = [];
  for (const x of [boks.min.x, boks.max.x]) for (const z of [boks.min.z, boks.max.z]) ut.push({ x, z });
  return ut;
}

function mittNavn() {
  try {
    const acc = S.msalApp && S.msalApp.getActiveAccount();
    return (acc && (acc.name || acc.username)) || "";
  } catch (_) { return ""; }
}

// Samme logo som rapportene (valgt i rapportmenyen) — originalbildet fra
// SharePoint, aldri en gjenskaping. Uten innlogging: tekst.
async function finnLogo() {
  try {
    const husket = S.settings && S.settings.rapLogo;
    if (!husket) return null;
    const liste = await hentLogoer();
    const l = liste.find(x => x.fil === husket);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}

// ═══════════════════════ BILDET ═══════════════════════
// Returnerer { data, kamera } — kameraet trengs for å legge nålene på
// riktig sted på arket.
function tegnOvenfra(senter, nord, bredde, hoyde, toppY, bunnY, pxB, pxH, skala, skygge) {
  // Langt nok ned til at terrenget under bygget kommer med, også i en bratt
  // skråning (500 m under bunnen av bygget er mer enn noen tomt).
  const kam = new THREE.OrthographicCamera(-bredde / 2, bredde / 2, hoyde / 2, -hoyde / 2, 0.01, (toppY - bunnY) * 3 + 500 / (skala || 1));
  kam.up.set(nord.x, 0, nord.z);
  kam.position.set(senter.x, toppY + (toppY - bunnY) + 1, senter.z);
  kam.lookAt(senter.x, bunnY, senter.z);
  kam.updateProjectionMatrix();
  kam.updateMatrixWorld(true);
  return { data: tegnMedKamera(kam, pxB, pxH, skygge), kamera: kam };
}

// ☀ Sola: fra nordvest, høyt på himmelen. Nordvest er kartkonvensjonen —
// lys oppe fra venstre på et kart med nord opp, så skyggene faller ned mot
// høyre og øyet leser høyder riktig (lys nedenfra får tak til å se ut som
// groper). Samme sol i alle bildene, så de fem bildene er enige med hverandre.
const SOL = { vest: 0.55, nord: 0.35, opp: 0.8 };

// 🕶 Kontaktskyggen: en myk, mørk flekk under hvert frittstående objekt.
// Sollys-skyggen alene faller til siden; uten flekken ser en brakke sett
// ovenfra ut som den svever. Én flate per objekt, bare mens bildet tegnes.
let kontaktTekstur = null;
function leggKontaktSkygger() {
  if (!kontaktTekstur) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.55, "rgba(0,0,0,0.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    kontaktTekstur = new THREE.CanvasTexture(c);
  }
  const mat = new THREE.MeshBasicMaterial({ map: kontaktTekstur, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const lagt = [];
  for (const g of riggGroup.children) {
    const o = (S.rigg || []).find(p => p && p.id === g.userData.riggId);
    const M = o && RIGG_TYPER[o.type];
    const modell = g.children[0];
    // Flater (parkering, lagring, vaskeplass), piler og gjerdet ligger på
    // bakken eller er tynne — de trenger ingen flekk.
    if (!M || M.flate || M.pil || M.gjerde || !modell) continue;
    // Modellgruppa er i METER (rigg-modell.js), så flekken måles i meter
    const B = o.B * (M.moduler ? (o.moduler || 1) : 1);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(o.L + 1.4, B + 1.4), mat);
    p.rotation.x = -Math.PI / 2;
    p.position.y = 0.03;
    modell.add(p);
    lagt.push(p);
  }
  return () => { for (const p of lagt) { if (p.parent) p.parent.remove(p); p.geometry.dispose(); } mat.dispose(); };
}

// Slår på skygger for ÉN rendring og setter alt tilbake etterpå.
// sk: { senter, radius (sceneenheter), skala (meter per sceneenhet), nord, ost }
// Returnerer en rydde-funksjon — kalleren kaller den i finally.
function medSkygger(sk) {
  const ryddLister = [];
  // Scenens egne lys dempes: de er satt for skjermen (sterkt, jevnt lys uten
  // skygger). Står de på fullt, lyser de opp skyggene så de forsvinner.
  const lys = [];
  scene.traverse(o => {
    if (o.isAmbientLight) { lys.push([o, o.intensity]); o.intensity *= 0.35; }
    else if (o.isDirectionalLight) { lys.push([o, o.intensity]); o.intensity *= 0.1; }
  });
  // Himmellys (skyggesiden får ~45 % lys, ikke svart) + sola med skygge
  const himmel = new THREE.HemisphereLight(0xf3f6ff, 0xcfc6b4, 0.75);
  const sol = new THREE.DirectionalLight(0xfff4e2, 2.1);
  const R = Math.max(sk.radius, 1e-6);
  const dx = -SOL.vest * sk.ost.x + SOL.nord * sk.nord.x, dz = -SOL.vest * sk.ost.z + SOL.nord * sk.nord.z;
  const len = Math.hypot(dx, SOL.opp, dz);
  sol.position.set(sk.senter.x + dx / len * R * 3, sk.senter.y + SOL.opp / len * R * 3, sk.senter.z + dz / len * R * 3);
  sol.target.position.copy(sk.senter);
  sol.castShadow = true;
  // Skyggekartet dekker riggen og ikke mer: jo mindre flate, jo skarpere
  // skygger. 4096 der grafikkortet tåler det (en tomt på 150 m gir ~4 cm per
  // punkt), ellers det største det tåler.
  const maks = Math.min(4096, (renderer.capabilities && renderer.capabilities.maxTextureSize) || 2048);
  sol.shadow.mapSize.set(maks, maks);
  Object.assign(sol.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: R * 0.5, far: R * 6 });
  sol.shadow.camera.updateProjectionMatrix();
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.03 / (sk.skala || 1);     // 3 cm, i modellens enhet
  scene.add(himmel, sol, sol.target);
  // Hvem kaster og hvem mottar: alt fast kaster, terrenget bare mottar (et
  // kupert terreng som skygger for seg selv gir striper), gjennomsiktige
  // ting og kantlinjene (LineSegments2 er en Mesh) er med på ingenting.
  const terreng = new Set();
  const tg = scene.getObjectByName("terreng");
  if (tg) tg.traverse(o => terreng.add(o));
  const flagg = [];
  scene.traverse(o => {
    if (!o.isMesh || o.isSprite) return;
    flagg.push([o, o.castShadow, o.receiveShadow]);
    const linje = !!o.isLineSegments2;
    const gjennomsiktig = !!(o.material && (Array.isArray(o.material) ? o.material.some(m => m.transparent) : o.material.transparent));
    o.castShadow = !linje && !gjennomsiktig && !terreng.has(o);
    o.receiveShadow = !linje;
  });
  const gammelSkygge = renderer.shadowMap.enabled, gammelType = renderer.shadowMap.type;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.needsUpdate = true;
  const ryddKontakt = leggKontaktSkygger();
  return () => {
    ryddKontakt();
    renderer.shadowMap.enabled = gammelSkygge;
    renderer.shadowMap.type = gammelType;
    for (const [o, c, r] of flagg) { o.castShadow = c; o.receiveShadow = r; }
    scene.remove(himmel, sol, sol.target);
    if (sol.shadow.map) sol.shadow.map.dispose();
    sol.dispose(); himmel.dispose();
    for (const [o, i] of lys) o.intensity = i;
  };
}

// Tegner scenen med et hvilket som helst kamera til et JPEG-bilde (data-URL).
// skygge: medSkygger-oppsettet, og valgfritt taake: [nær, fjern] (sceneenheter).
function tegnMedKamera(kam, pxB, pxH, skygge) {
  // Alt som hører skjermen til, skjules for bildet: navnelapper (sprites),
  // skjøteprikker og håndtak. Settes tilbake i finally, uansett hva som skjer.
  const skjult = [];
  scene.traverse(o => {
    if (o.visible && (o.isSprite || o.name === "rigg-skjoter")) { skjult.push(o); o.visible = false; }
  });
  const gammelBg = scene.background ? scene.background.clone() : null;
  const gammeltRutenett = grid.visible;
  const gammelt = renderer.getRenderTarget();
  const gammelTaake = scene.fog;
  let rt = null, rydd = null;
  try {
    if (scene.background) scene.background.set(0xffffff);
    grid.visible = false;
    if (S.outlineOpplosning) S.outlineOpplosning(pxB, pxH);
    // Går skyggene galt (et gammelt grafikkort), kommer bildet uten dem —
    // riggplanen skal komme uansett.
    if (skygge) { try { rydd = medSkygger(skygge); } catch (err) { console.warn("Riggplan: uten skygger:", err && err.message); rydd = null; } }
    // 🌫 Dis i skråbildene: det som er langt unna blir lysere, som i
    // virkeligheten — gir dybde, og kanten av terrenget glir ut i det hvite.
    if (skygge && skygge.taake) scene.fog = new THREE.Fog(0xffffff, skygge.taake[0], skygge.taake[1]);
    // samples: 4 = kantutjevning. Uten den ble gjerder og piler tagget.
    rt = new THREE.WebGLRenderTarget(pxB, pxH, { samples: 4 });
    renderer.setRenderTarget(rt);
    renderer.render(scene, kam);
    const px = new Uint8Array(pxB * pxH * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, pxB, pxH, px);
    // Lineært → sRGB (se SRGB_TABELL): samme farger som på skjermen
    for (let i = 0; i < px.length; i++) if ((i & 3) !== 3) px[i] = SRGB_TABELL[px[i]];
    const c = document.createElement("canvas");
    c.width = pxB; c.height = pxH;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(pxB, pxH);
    for (let y = 0; y < pxH; y++) img.data.set(px.subarray((pxH - 1 - y) * pxB * 4, (pxH - y) * pxB * 4), y * pxB * 4);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.9);
  } finally {
    renderer.setRenderTarget(gammelt);
    if (rydd) rydd();
    scene.fog = gammelTaake;
    if (rt) rt.dispose();
    if (gammelBg && scene.background) scene.background.copy(gammelBg);
    grid.visible = gammeltRutenett;
    for (const o of skjult) o.visible = true;
  }
}

// 📷 Fire skrå bilder mot byggeplassen (Emil 25.09: «et bilde fra sør, vest,
// øst og nord som ser ned over byggeplassen fra en skrå vinkel»). Kameraet
// står i den himmelretningen bildet heter etter, OVERSIKT_VINKEL grader over
// bakken, og så langt unna at hele riggen (radius rM meter) får plass.
function tegnOversikt(base, senter, nord, ost, rM, bunnY, flisB, flisH) {
  const aspekt = flisB / flisH;
  const pxB = Math.round(flisB * 5), pxH = Math.round(flisH * 5);
  const avstand = oversiktAvstand(rM, OVERSIKT_FOV, aspekt) / base.skala;
  const v = OVERSIKT_VINKEL * Math.PI / 180;
  const mål = new THREE.Vector3(senter.x, bunnY, senter.z);
  const skygge = { senter: mål, radius: rM * 1.2 / base.skala, skala: base.skala, nord, ost, taake: [avstand * 0.7, avstand * 2.6] };
  return OVERSIKTSBILDER.map(b => {
    // retningen kameraet står i, i scenen
    const dx = b.fra.e * ost.x + b.fra.n * nord.x, dz = b.fra.e * ost.z + b.fra.n * nord.z;
    const kam = new THREE.PerspectiveCamera(OVERSIKT_FOV, aspekt, avstand / 1000, avstand * 20);
    kam.position.set(mål.x + dx * avstand * Math.cos(v), mål.y + avstand * Math.sin(v), mål.z + dz * avstand * Math.cos(v));
    kam.lookAt(mål);
    kam.updateProjectionMatrix();
    kam.updateMatrixWorld(true);
    return { navn: t(b.navn), data: tegnMedKamera(kam, pxB, pxH, skygge) };
  });
}

// ═══════════════════════ HOVEDINNGANGEN ═══════════════════════
// valg: «auto» (minste målestokk der alt får plass) eller et tall (1:valg).
export async function lastNedRiggplan(valg) {
  const base = riggBase();
  if (!base) { alert(t("Åpne en modell først.")); return null; }
  const objekter = riggObjekter(S.rigg || []).filter(o => !o.skjult);
  if (!objekter.length) { alert(t("Legg inn noe rigg først — planen er tom.")); return null; }
  const vis = (tekst) => { if (loadingText) loadingText.textContent = tekst; };
  if (loadingEl) loadingEl.classList.add("open");
  try {
    vis(t("Lager riggplan …"));
    // Nord: fra terrenget (levende), ellers siste kjente plassering. Uten
    // noen av dem finnes ingen ekte nordretning — da står modellens −Z opp,
    // og arket sier fra.
    const live = S.terrengRef ? S.terrengRef() : null;
    const ref = aktivRef();
    const nordKjent = !!ref;
    const { nord, ost } = nordOgOst(ref ? ref.plass.rot : 0);

    // Utstrekningen: bygget og hvert rigg-objekt, målt langs øst og nord
    // (meter fra byggets senter). Objekter lenger unna enn MAKS_AVSTAND_M
    // hoppes over og nevnes på arket — de ville ellers trukket planen ut i
    // en målestokk der tomta forsvinner.
    const tilEN = (p) => {
      const dx = (p.x - base.c.x) * base.skala, dz = (p.z - base.c.z) * base.skala;
      return { e: dx * ost.x + dz * ost.z, n: dx * nord.x + dz * nord.z };
    };
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, toppY = -Infinity, bunnY = Infinity;
    const taMed = (b) => {
      toppY = Math.max(toppY, b.max.y); bunnY = Math.min(bunnY, b.min.y);
      for (const p of hjorner(b)) {
        const q = tilEN(p);
        minE = Math.min(minE, q.e); maxE = Math.max(maxE, q.e); minN = Math.min(minN, q.n); maxN = Math.max(maxN, q.n);
      }
    };
    const gyldig = (b) => !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
    if (S.modelGroup) { const mb = new THREE.Box3().setFromObject(S.modelGroup); if (gyldig(mb)) taMed(mb); }
    let langtUnna = 0;
    for (const g of riggGroup.children) {
      const b = boksUtenLapper(g);
      if (!gyldig(b)) continue;
      const q = tilEN(b.getCenter(new THREE.Vector3()));
      if (Math.hypot(q.e, q.n) > MAKS_AVSTAND_M) { langtUnna++; continue; }
      taMed(b);
    }
    if (!isFinite(minE) || !isFinite(toppY)) throw new Error(t("Fant ingenting å tegne."));
    const marg = Math.max(5, 0.08 * Math.max(maxE - minE, maxN - minN));
    const bM = maxE - minE + 2 * marg, hM = maxN - minN + 2 * marg;
    // Målestokken: brukerens valg, ellers den minste der alt får plass
    const fast = vaskMalestokkValg(valg);
    const skala = fast === "auto" ? velgMalestokk(bM, hM, RIGGPLAN.bildeB, RIGGPLAN.bildeH) : fast;
    const dekning = riggplanDekning(skala);
    const kuttet = dekning.b < bM - 2 * marg || dekning.h < hM - 2 * marg;
    // Bildet dekker HELE bildefeltet i den runde målestokken
    const rammeB = dekning.b, rammeH = dekning.h;
    const mE = (minE + maxE) / 2, mN = (minN + maxN) / 2;
    const senter = new THREE.Vector3(
      base.c.x + (mE * ost.x + mN * nord.x) / base.skala, 0,
      base.c.z + (mE * ost.z + mN * nord.z) / base.skala);
    if (![senter.x, senter.z, rammeB, rammeH].every(Number.isFinite)) throw new Error(t("Fant ingenting å tegne."));
    const pxB = Math.round(RIGGPLAN.bildeB * PX_PER_MM), pxH = Math.round(RIGGPLAN.bildeH * PX_PER_MM);
    // Skyggekartet dekker riggen (ikke hele bildet): i 1:5000 er bildet over
    // en kilometer bredt, men skyggene som betyr noe står der riggen står.
    const riggR = Math.hypot(maxE - minE, maxN - minN) / 2 + marg;       // meter
    const midt = new THREE.Vector3(senter.x, bunnY, senter.z);
    const planSkygge = { senter: midt, radius: riggR / base.skala, skala: base.skala, nord, ost };
    const bilde = tegnOvenfra(senter, nord, rammeB / base.skala, rammeH / base.skala, toppY, bunnY, pxB, pxH, base.skala, planSkygge);

    // 📍 Nålene: ett punkt per objekt, projisert inn på arket, med objektets
    // fotavtrykk (rekt) så plasserMerker vet hva et merke ikke må dekke.
    const forklaring = riggplanTegnforklaring(S.rigg || [], t);
    const portNr = (forklaring.find(r => r.type === "gjerdePort") || {}).nr;
    const tilArk = (v) => {
      v.project(bilde.kamera);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
      return { x: RIGGPLAN.marg + (v.x + 1) / 2 * RIGGPLAN.bildeB, y: RIGGPLAN.bildeY + (1 - v.y) / 2 * RIGGPLAN.bildeH };
    };
    const ringer = [];
    for (const o of objekter) {
      const g = finnRiggObjekt(o.id);
      if (!g) continue;
      // Gjerdet og pilene: punktet på midten av første stykke — midten av
      // boksen ville vært midt inne i bygget, langt fra selve gjerdet.
      let p, rekt = null;
      if (o.punkter && g.children[0]) {
        const a = o.punkter[0], b2 = o.punkter[1];
        const h = (g.userData.hoyder && g.userData.hoyder[0]) || 0;
        g.updateMatrixWorld(true);
        p = tilArk(g.children[0].localToWorld(new THREE.Vector3((a.x + b2.x) / 2, h + 1, (a.z + b2.z) / 2)));
      } else {
        const b = boksUtenLapper(g);
        if (b.isEmpty()) continue;
        p = tilArk(b.getCenter(new THREE.Vector3()));
        // Fotavtrykket på arket: hjørnene av boksen, projisert
        const hj = [];
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const q = new THREE.Vector3(x, y, z).project(bilde.kamera);
          hj.push({ x: RIGGPLAN.marg + (q.x + 1) / 2 * RIGGPLAN.bildeB, y: RIGGPLAN.bildeY + (1 - q.y) / 2 * RIGGPLAN.bildeH });
        }
        const xs = hj.map(q => q.x), ys = hj.map(q => q.y);
        rekt = { x: Math.min(...xs), y: Math.min(...ys), b: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      if (!p) continue;
      ringer.push({ nr: riggplanNummer(forklaring, o), x: p.x, y: p.y, rekt, farge: o.farge });
      // 🚪 En nål ved hver port i gjerdet, med portens eget nummer
      if (portNr && o.type === "gjerde" && g.children[0]) {
        for (const st of gjerdeStykker(o)) {
          if (!st.port) continue;
          const h = ((g.userData.hoyder && g.userData.hoyder[st.i]) || 0) + 1;
          const q = tilArk(g.children[0].localToWorld(new THREE.Vector3((st.a.x + st.b.x) / 2, h, (st.a.z + st.b.z) / 2)));
          if (q) ringer.push({ nr: portNr, x: q.x, y: q.y, port: true, farge: PORT_FARGE });
        }
      }
    }

    // 📷 Fire skrå oversiktsbilder (side 2), ett fra hver himmelretning.
    vis(t("Tegner oversiktsbilder …"));
    const { flisB, flisH } = side2Fliser();
    const oversikt = tegnOversikt(base, senter, nord, ost, Math.max(maxE - minE, maxN - minN) / 2 + marg, bunnY, flisB, flisH);

    const logo = await finnLogo();
    vis(t("Henter PDF-biblioteket …"));
    const jsPDF = await hentJsPDF();
    const iDag = new Date().toISOString().slice(0, 10);
    const d = tegnArk(jsPDF, {
      bilde, ringer, forklaring, skala, nordKjent, logo, iDag, langtUnna, kuttet, oversikt, flisB, flisH,
      kartkilde: !!(live && live.synlig),
      modell: String(S.fileName || "").replace(/\.(ifc|glb)$/i, ""),
      prosjekt: S.lettProsjekt || "",
      adresse: (live && live.adresse) || "",
      av: mittNavn()
    });
    lastNedFil(d.output("blob"), riggplanFilnavn(S.fileName, iDag));
    return { skala, ringer: ringer.length, rader: forklaring.length, langtUnna, kuttet };
  } catch (err) {
    console.warn("Riggplanen feilet:", err);
    alert(t("Klarte ikke å lage riggplanen: {0}", err.message));
    return null;
  } finally {
    if (loadingEl) loadingEl.classList.remove("open");
  }
}

// ═══════════════════════ ARKET ═══════════════════════
// Oppsett «C — presentasjon» (Emil 29.09). Målene står i RIGGPLAN.

// Side 2: fire bilder i et rutenett under toppbåndet. Én funksjon, så
// bildene tegnes i nøyaktig det formatet de får på arket (ellers strekkes de).
const SIDE2_MELLOM = 5;
function side2Fliser() {
  const R = RIGGPLAN;
  const y0 = R.marg + R.toppH + R.mellom, h = R.h - R.marg - R.bunnH - y0;
  return { y0, flisB: (R.b - 2 * R.marg - SIDE2_MELLOM) / 2, flisH: (h - SIDE2_MELLOM) / 2 };
}

function lyshet(farge) {
  const n = parseInt(String(farge).slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Toppbåndet, likt på begge sider: logo, tittel og undertittel, og (side 1)
// dato, målestokk og laget av helt til høyre. Rød strek under — Storms farge,
// og den eneste rødfargen på arket, så den ikke konkurrerer med objektene.
function toppbaand(d, m, tittel, under, info) {
  const R = RIGGPLAN, x0 = R.marg, y0 = R.marg;
  const lb = 46, lh = 16;
  if (m.logo) {
    // Originalbildet, aldri en gjenskaping — skalert inn i feltet med riktig form
    const f = Math.min(lb / m.logo.b, lh / m.logo.h);
    const b = m.logo.b * f, h = m.logo.h * f;
    try { d.addImage(m.logo.data, m.logo.format || "PNG", x0, y0 + (lh - h) / 2, b, h); } catch (_) {}
  } else {
    d.setFontSize(16); d.setFont(undefined, "bold"); hex(d, SORT);
    d.text("Storm", x0, y0 + 9);
    d.setFont(undefined, "normal"); d.setFontSize(8); hex(d, GRÅ);
    d.text("Storm Entreprenør AS", x0, y0 + 14);
  }
  const tx = x0 + lb + 8;
  d.setFontSize(20); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text(tittel, tx, y0 + 9);
  d.setFont(undefined, "normal"); d.setFontSize(9); hex(d, GRÅ);
  const infoB = (info || []).length * 36;
  d.text(d.splitTextToSize(under || "", R.b - R.marg - infoB - tx - 4).slice(0, 1), tx, y0 + 15);
  (info || []).forEach(([k, v], i) => {
    const x = R.b - R.marg - ((info.length - i) * 36) + 2;
    d.setFontSize(6); hex(d, GRÅ); d.text(k.toUpperCase(), x, y0 + 6);
    d.setFontSize(9); hex(d, SORT); d.text(d.splitTextToSize(v || "—", 33)[0], x, y0 + 11.5);
  });
  hex(d, STORM_ROD, "strek"); d.setLineWidth(0.8);
  d.line(x0, y0 + R.toppH, R.b - R.marg, y0 + R.toppH);
  d.setLineWidth(0.3);
}

// 📍 Én nål: et hode med nummeret (i objektets farge, hvit innside) og en
// spiss som peker ned i punktet. Er hodet flyttet langt ut, går en linje
// resten av veien. Peker nålen på flere objekter (samleLikeMerker), får hvert
// objekt sin egen linje og ingen spiss.
function tegnNaal(d, n, r) {
  const f = n.port ? PORT_FARGE : (n.farge || "#9aa1ab");
  const dx = n.x - n.mx, dy = n.y - n.my, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  const flere = n.mål.length > 1;
  const tx = n.mx + ux * r * 2.1, ty = n.my + uy * r * 2.1;       // spissen
  // hvit glorie: lesbar oppå både gress, asfalt og tak
  hex(d, "#ffffff", "fyll"); d.circle(n.mx, n.my, r + 0.8, "F");
  hex(d, SORT, "strek"); hex(d, SORT, "fyll"); d.setLineWidth(0.3);
  if (flere || !n.leder) {
    for (const p of n.mål) {
      if (!n.leder) break;
      const ex = n.mx - p.x, ey = n.my - p.y, el = Math.hypot(ex, ey) || 1;
      d.line(p.x, p.y, n.mx - ex / el * r, n.my - ey / el * r);
      d.circle(p.x, p.y, 0.55, "F");
    }
  } else {
    if (l > r * 2.2) d.line(tx, ty, n.x, n.y);
    d.circle(n.x, n.y, 0.6, "F");
  }
  hex(d, f, "fyll"); hex(d, toneFarge(f, 0.5), "strek");
  if (!flere && n.leder) d.triangle(n.mx - uy * r * 0.72, n.my + ux * r * 0.72, n.mx + uy * r * 0.72, n.my - ux * r * 0.72, tx, ty, "FD");
  d.circle(n.mx, n.my, r, "FD");
  hex(d, "#ffffff", "fyll"); d.circle(n.mx, n.my, r * 0.68, "F");
  d.setFontSize(n.nr >= 10 ? 6.5 : 7); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text(String(n.nr), n.mx, n.my + 0.1, { align: "center", baseline: "middle" });
  d.setFont(undefined, "normal");
}

function tegnArk(jsPDF, m) {
  const R = RIGGPLAN;
  const d = new jsPDF({ unit: "mm", format: "a3", orientation: "landscape" });
  const x0 = R.marg, y0 = R.bildeY;
  d.setLineWidth(0.3);
  const underTittel = [m.prosjekt, m.adresse, m.modell].filter(Boolean).join("  ·  ");

  // ── Toppbåndet ──
  toppbaand(d, m, t("Riggplan"), underTittel, [
    [t("Dato"), norskDato(m.iDag)],
    [t("Målestokk"), "1:" + m.skala.toLocaleString("nb-NO") + " (A3)"],
    [t("Laget av"), m.av]
  ]);

  // ── Bildet ──
  d.addImage(m.bilde.data, "JPEG", x0, y0, R.bildeB, R.bildeH);
  hex(d, LINJE, "strek"); d.setLineWidth(0.3); d.rect(x0, y0, R.bildeB, R.bildeH);

  // Nordpila oppe til høyre i bildet
  const nx = x0 + R.bildeB - 12, ny = y0 + 14;
  hex(d, "#ffffff", "fyll"); hex(d, SORT, "strek"); d.setLineWidth(0.3);
  d.circle(nx, ny, 8, "FD");
  hex(d, SORT, "fyll");
  d.triangle(nx, ny - 6.5, nx - 3, ny + 3.5, nx, ny + 1.5, "F");
  hex(d, "#ffffff", "fyll"); d.triangle(nx, ny - 6.5, nx + 3, ny + 3.5, nx, ny + 1.5, "FD");
  d.setFontSize(9); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text("N", nx, ny - 8.8, { align: "center" });
  d.setFont(undefined, "normal");

  // Skalastreken nede til venstre i bildet, på hvit bunn
  const s = skalaStrek(m.skala, 70);
  const sx = x0 + 6, sy = y0 + R.bildeH - 8;
  hex(d, "#ffffff", "fyll"); d.rect(sx - 3, sy - 7, s.mm + 16, 11, "F");
  hex(d, SORT, "strek"); d.setLineWidth(0.25);
  for (let i = 0; i < s.deler; i++) {
    const del = s.mm / s.deler;
    if (i % 2 === 0) hex(d, SORT, "fyll"); else hex(d, "#ffffff", "fyll");
    d.rect(sx + i * del, sy - 1.5, del, 1.5, "FD");
  }
  d.setFontSize(7); hex(d, SORT);
  d.text("0", sx, sy - 2.5, { align: "center" });
  d.text(s.m + " m", sx + s.mm, sy - 2.5, { align: "center" });
  d.text("1:" + m.skala.toLocaleString("nb-NO") + " (A3)", sx, sy + 3);

  // Merknader øverst til venstre i bildet, én linje hver, på hvit bunn
  const merknader = [];
  if (!m.nordKjent) merknader.push(t("Nord er ikke kontrollert: modellen står ikke i et terreng."));
  if (m.kuttet) merknader.push(t("Målestokken er for liten til hele riggen — noe av den er utenfor bildet."));
  if (m.langtUnna) merknader.push(t("{0} rigg-objekter ligger over 1 km fra bygget og er ikke med på planen.", m.langtUnna));
  d.setFontSize(7);
  merknader.forEach((tekst, i) => {
    hex(d, "#ffffff", "fyll"); d.rect(x0 + 2, y0 + 2.4 + i * 4, d.getTextWidth(tekst) + 4, 4, "F");
    hex(d, "#a8232b"); d.text(tekst, x0 + 4, y0 + 5.4 + i * 4);
  });

  // ── Nålene ──
  // Merknadene, nordpila og skalastreken er hindringer: ingen nål oppå dem.
  const hindre = [
    { x: nx - 9, y: ny - 12, b: 18, h: 21 },
    { x: sx - 3, y: sy - 7, b: s.mm + 16, h: 11 }
  ];
  if (merknader.length) hindre.push({ x: x0, y: y0, b: 150, h: 3 + merknader.length * 4 });
  const naaler = plasserMerker(m.ringer, { r: MERKE_R, ramme: { x: x0, y: y0, b: R.bildeB, h: R.bildeH }, hindre });
  for (const n of naaler) tegnNaal(d, n, MERKE_R);

  // ── «Hva er hva»: tegnforklaringen som kort ──
  const fx = R.forklaringX, fb = R.forklaringB;
  d.setFontSize(9); d.setFont(undefined, "bold"); hex(d, SORT);
  d.text(t("Hva er hva"), fx, y0 + 4);
  d.setFont(undefined, "normal");
  let y = y0 + 8;
  for (const r of m.forklaring) {
    const linjer = d.splitTextToSize(r.forklaring, fb - 22);
    d.setFontSize(6.5);
    const kh = 7.5 + linjer.length * 2.7;
    if (y + kh > y0 + R.bildeH) { d.setFontSize(7); hex(d, GRÅ); d.text(t("… flere typer enn det er plass til"), fx, y + 3); break; }
    hex(d, KORT, "fyll"); d.roundedRect(fx, y, fb, kh, 1.5, 1.5, "F");
    // 🎨 Ikonet (Emil 29.09): det SAMME som i rigg-panelet (js/rigg-ikoner.js).
    // Uten lerret: fargeflis, eller strek for pilene (stiplet for gående).
    const ikonData = riggIkon(r.type, r.farge, 96);
    let ikonOk = false;
    const iy = y + (kh - 9) / 2;
    if (ikonData) { try { d.addImage(ikonData, "PNG", fx + 2, iy, 9, 9); ikonOk = true; } catch (_) { ikonOk = false; } }
    if (ikonOk) { /* ikonet står */ }
    else if (r.pil) {
      hex(d, r.farge, "strek"); d.setLineWidth(1.4);
      if (r.stiplet) d.setLineDashPattern([1.6, 1], 0);
      d.line(fx + 2, iy + 4.5, fx + 8, iy + 4.5);
      d.setLineDashPattern([], 0);
      hex(d, r.farge, "fyll"); d.triangle(fx + 8, iy + 2.9, fx + 11, iy + 4.5, fx + 8, iy + 6.1, "F");
    } else {
      // lagringsområdet: fargen inni og en mørkere kant, som i 3D
      hex(d, r.farge, "fyll"); hex(d, r.kant ? toneFarge(r.farge, 0.45) : SORT, "strek"); d.setLineWidth(r.kant ? 0.8 : 0.2);
      d.rect(fx + 2, iy + 2, 9, 5, "FD");
    }
    // nummeret i objektets farge — samme farge som hodet på nålen
    const f = r.type === "gjerdePort" ? PORT_FARGE : r.farge;
    hex(d, f, "fyll"); d.circle(fx + 13.8, y + 3.6, 2.1, "F");
    d.setFontSize(6.5); d.setFont(undefined, "bold"); hex(d, lyshet(f) > 0.62 ? SORT : "#ffffff");
    d.text(String(r.nr), fx + 13.8, y + 3.7, { align: "center", baseline: "middle" });
    hex(d, SORT); d.setFontSize(8);
    d.text(d.splitTextToSize(r.label, fb - 46)[0], fx + 17.5, y + 4.4);
    d.setFont(undefined, "normal");
    d.setFontSize(6.5); hex(d, GRÅ);
    d.text(r.antall, fx + fb - 2, y + 4.4, { align: "right" });
    d.text(linjer, fx + 17.5, y + 7.6);
    y += kh + 1.6;
  }

  // ── Bunnlinja: forbehold og kartkilde (CC BY 4.0 krever navngivelse) ──
  const bunn = () => {
    d.setFontSize(6.5); hex(d, GRÅ);
    const kilde = m.kartkilde ? t("Terreng og kart: © Kartverket (CC BY 4.0)") : t("Uten terreng — bakgrunnen er ikke et kart");
    return kilde;
  };
  const kilde = bunn();
  d.text(t("Omtrentlig plassering (±1–2 m). Skal ikke brukes til utstikking.") + "   " + kilde, x0, R.h - R.marg);
  d.text("Storm Entreprenør AS", R.b - R.marg, R.h - R.marg, { align: "right" });

  // ── Side 2: oversiktsbildene ──
  if (m.oversikt && m.oversikt.length) {
    d.addPage("a3", "landscape");
    toppbaand(d, m, t("Slik ser det ut"), [m.prosjekt, m.adresse, norskDato(m.iDag)].filter(Boolean).join("  ·  "), []);
    const { y0: oy } = side2Fliser();
    m.oversikt.forEach((b, i) => {
      const bx = x0 + (i % 2) * (m.flisB + SIDE2_MELLOM);
      const by = oy + Math.floor(i / 2) * (m.flisH + SIDE2_MELLOM);
      d.addImage(b.data, "JPEG", bx, by, m.flisB, m.flisH);
      // navnet på en hvit «pille» oppe til venstre i bildet
      d.setFontSize(8.5); d.setFont(undefined, "bold");
      const pb = d.getTextWidth(b.navn) + 8;
      hex(d, "#ffffff", "fyll"); hex(d, LINJE, "strek"); d.setLineWidth(0.25);
      d.roundedRect(bx + 3, by + 3, pb, 7, 3.5, 3.5, "FD");
      hex(d, SORT); d.text(b.navn, bx + 3 + pb / 2, by + 6.6, { align: "center", baseline: "middle" });
      d.setFont(undefined, "normal");
    });
    d.setFontSize(6.5); hex(d, GRÅ);
    d.text(t("Bildene er perspektiv og kan ikke måles på. Bruk planen på side 1 til mål.") + "   " + kilde, x0, R.h - R.marg);
    d.text("Storm Entreprenør AS", R.b - R.marg, R.h - R.marg, { align: "right" });
  }
  return d;
}
