// Oppstart: kobler sammen modulene og håndterer klikk i modellen.
// 🛡 FØRST: klikk-lytterne som før var onclick="…" i HTML-en (se fila).
import "./html-lyttere.js";
import * as THREE from "three";
import { $, S, fmtLen, loadingEl, loadingText, tilM } from "./state.js";
import { lastSprak, oversettDom, setLang, t } from "./i18n.js";
import { setClipFromFace } from "./clip.js";
import { clearSelection, hitID, pick, pickEkstra, pickFlate, selectElement, showProperties, velgVedPunkt } from "./elements.js";
import { afterLoad, ifcReady, loadModel } from "./ifc.js";
import { closeMarkerPopup, forberedNyMarkering, openMarkerPopup, pickMarker } from "./markers.js";
import { addMeasure, koteValue, rettPunkt, snapPoint } from "./measure.js";
import { canvas, koteGroup, makeLabel, measureGroup } from "./scene.js";
import { naermesteMaaleflate, registrerPeker } from "./pek-eier.js";

import { sjekkKort, startTilgang } from "./tilgang.js";   // 🔒 gratisdel og enhetskort (post 11)
import { varsel } from "./varsel.js";

// ---------- Resten av modulene (rekkefølgen bestemmer oppstart) ----------
// 🔒 Post 11 (14.10.2026): de LÅSTE verktøyene lastes bare når denne
// nettleseren har et godkjent enhetskort (eller admin-nøkkelen). Derfor er
// lista under dynamisk import() i stedet for statiske import-linjer.
//
// REKKEFØLGEN ER NØYAKTIG DEN SAMME SOM FØR. Lista lastes én og én med await,
// så en modul evalueres først når den forrige er ferdig — akkurat som de
// statiske linjene gjorde. Kommentarene gjelder fortsatt: «FØR ui.js»,
// «terreng.js før rigg-vis.js», «mobile.js etter at alle knapper har fått
// lyttere», «usersync.js sist». Uten kort hoppes de låste over, og resten
// lastes i samme innbyrdes rekkefølge.
//
// LÅST = true betyr «bare med kort». Lista over låste moduler er byggeplanen
// 3c. FØR EN MODUL FLYTTES INN HER: sjekk at ingen GRATIS modul importerer den
// statisk (grep "from \"./<navn>.js\"") — ellers lastes den uansett. Sjekket
// 14.10: bare lett-main.js (bygg.html) importerer grupper/compare/share, og
// byggeplass.js importerer grupper/veggelement — alle låste selv.
const MODULER = [
  ["./prefs.js"],
  ["./display.js"],
  ["./outline.js"],
  ["./hjelp.js"],
  ["./materiell-vis.js"],          // 📦 materiell: visningen (lastes av begge sider)
  ["./materiell.js", true],        // 📦 materiell: verktøyet (kun kontor)
  ["./stalbunker.js", true],       // 🔩 stålbunker fra stålmodellen (en seksjon i Materiell)
  ["./grupper.js", true],          // 🎯 objektgrupper: lagre og hente fram flervalg
  ["./terreng.js", true],          // ⛰ terreng fra Kartverket (kun kontor — IKKE i lett-main.js)
  ["./rigg-vis.js"],               // 🏕 rigg: visningen (lastes av begge sider) — ETTER terreng.js
  ["./rigg.js", true],             // 🏕 rigg: verktøyet (kun kontor)
  ["./veggelement.js", true],      // 🧱 SW-generator: veggelementer på stålmodeller (kun kontor)
  ["./stopeplan.js", true],        // 🧱 støpeplan i 3D (kun kontor)
  ["./stopeplan-felt.js", true],   // 🧱 trinn 3: felt på plata — tegne og dra (kun kontor)
  ["./framdrift.js", true],        // 📅 framdriftsplan: etapper med alle slags objekter (kun kontor)
  ["./vaer-3d.js", true],          // 🌦 været i 3D: himmel, skyer, nedbør og lyn (KUN kontoret — Emil 09.10)
  ["./priskalk.js", true],         // 💰 priskalkulasjon: mengder × priser → Excel med formler (kun kontor)
  ["./vaer.js", true],             // 🌦 Vis vær (kun kontor — byggeplassen ser været i Framdriftsplan)
  ["./laster.js", true],           // ❄🌬 snø og vind (kun kontor)
  ["./dokumentasjon.js", true],    // 📄 snarveiene i gruppa Dokumentasjon (kun kontor)
  ["./pdf-utseende-ui.js", true],  // 🎨 Innstillinger → Utseende PDF (kun kontor)
  ["./markers.js"],
  ["./minimap.js"],
  ["./viewcube.js"],
  ["./axes.js"],
  ["./maal-verktoy.js"],           // 📏📐 kjedemål og vinkel/fall — FØR modes.js (kontrollinja)
  ["./modes.js"],
  ["./angre.js"],                  // ↩ angre/gjenopprett – må lastes før ui.js (hurtigtastene)
  ["./sharepoint.js"],
  ["./prosjektinfo.js"],           // 🗂 felles prosjektinfo i Innstillinger — FØR ui.js
  ["./ui.js"],
  ["./tema.js"],                   // lyst/mørkt tema – trenger knappen i toppbaren
  ["./hjul.js"],                   // navigasjonshjul – trenger knappen i verktøylinja
  ["./compare.js", true],
  ["./em.js", true],               // 📝 Endringsmelding fra modellen (kun kontor) — ETTER compare.js
  ["./lag.js", true],              // 🧅 Lag: fagmodeller oppå hovedmodellen (kun kontor, runde 5)
  ["./kollisjon.js", true],        // 💥 Kollisjon: lagene mot hovedmodellen (kun kontor, runde 6)
  ["./recent.js"],
  ["./share.js", true],
  ["./byggeplass.js", true],
  ["./mobile.js"],                 // må lastes etter at alle knapper har fått lyttere
  ["./oppsett.js"],                // ansattliste og Planner-plan fra SharePoint
  ["./usersync.js"]                // personlig oppsett fra SharePoint – må lastes sist
];

const medKort = await sjekkKort();
// 🔁 Emil 14.10: «noen ganger laster ikke rigg inn» — feilen var «Failed to
// fetch dynamically imported module …/rigg.js». Det er NETTET (eller GitHub
// Pages midt i en opplasting), ikke koden: neste omlasting virket. Hentingen
// prøves derfor tre ganger før vi gir opp. Andre og tredje forsøk har
// «?forsok=» på adressen, så nettleseren ikke gjenbruker den feilede hentingen.
// Avhengighetene til modulen har uendrede adresser, så ingenting lastes dobbelt.
const pause = (ms) => new Promise(r => setTimeout(r, ms));
async function lastModul(sti) {
  for (let forsøk = 1; ; forsøk++) {
    try { return await import(forsøk === 1 ? sti : sti + "?forsok=" + forsøk); }
    catch (err) {
      // Bare nettfeil prøves på nytt. En feil INNI modulen (SyntaxError,
      // TypeError fra koden) blir ikke bedre av å vente.
      const nett = /fetch|load|network|import/i.test(String(err && err.message || err)) && !(err instanceof SyntaxError);
      if (!nett || forsøk >= 3) throw err;
      await pause(800 * forsøk);
    }
  }
}
const feilet = [];
for (const [sti, låst] of MODULER) {
  if (låst && !medKort) continue;
  // En modul som ikke lar seg laste, skal ikke ta med seg resten av appen.
  // (Med statiske import-linjer stoppet ALT på første feil.)
  try { await lastModul(sti); }
  catch (err) {
    console.error("Klarte ikke å laste " + sti, err);
    feilet.push(sti.slice(2).replace(/\.js$/, ""));
    const st = document.getElementById("status");
    if (st) st.textContent = "Feil: " + sti.slice(2) + " – " + (err && err.message || err);
  }
}
// Sier fra i varselboksen også — teksten oppe til høyre er lett å overse, og
// uten den ser det bare ut som om riggen (eller et annet verktøy) er borte.
if (feilet.length) varsel("Klarte ikke å laste " + feilet.join(", ") + " (nettet eller GitHub svarte ikke). Last siden på nytt (F5).");
// Hengelåsene, «Gratisversjon» og Admin-knappen — når alle knapper finnes
startTilgang();

// JavaScript kjører – skjul advarselen
const jsCheck = document.getElementById("jsCheck");

if (jsCheck) jsCheck.style.display = "none";

// ---------- Språk ----------
// Lagret valg legges på HTML-en med en gang, og velgeren på startskjermen
// holdes i takt med den i ⚙ Innstillinger (begge kaller setLang).
//
// Ordboka for andre språk enn norsk ligger i en egen fil (js/sprak/) og hentes
// med import(). Derfor ventingen her: uten den rekker oversettDom() å kjøre
// med tom ordbok, og siden blir stående på norsk for en som har valgt polsk.
// Er språket norsk, løser lastSprak() seg med en gang og ingenting hentes.
await lastSprak(S.lang);
oversettDom();
const sprakVelg = $("sprakVelg");
if (sprakVelg) {
  sprakVelg.value = S.lang;
  sprakVelg.onchange = () => setLang(sprakVelg.value);
}

// ---------- Klikk / trykk ----------

// 🎯 Rigg og materiell har egne pekerlyttere på window, og spør pek-eier.js
// om de eier punktet før de velger noe. Der var bare de to med — et SW-element,
// en takplate eller stålet FORAN en container ga likevel containeren
// (Emil 05.10: «objekt som står bak blir markert»). Nå er modellen og lagene
// (SW, blikk, takplater, støpeplan …) med i avgjørelsen: nærmeste vinner.
registrerPeker("modell", (x, y) => { const h = pick(x, y); return h ? h.distance : null; });
registrerPeker("lag", (x, y) => { const h = pickEkstra(x, y); return h ? h.avstand : null; });

canvas.addEventListener("pointerdown", (e) => { S.downPos = { x: e.clientX, y: e.clientY }; });

canvas.addEventListener("pointerup", (e) => {
  if (!S.downPos) return;
  const moved = Math.hypot(e.clientX - S.downPos.x, e.clientY - S.downPos.y);
  S.downPos = null;
  if (moved > 8) return;
  // Bare venstre knapp og berøring velger. Berøring gir button 0; midtknappen
  // (1) panorerer i SimpleControls og skal ikke sette markering eller målepunkt
  // når draget er under 8 px. Høyre (2) gir innstillingsmenyen.
  if (e.button > 0) return;
  // 📐 Lag → Juster plassering → «Midtpunkt …»: trykket velger søyla/pælen
  // i hovedmodellen og så i laget (lag.js). Går foran alt annet, ellers ville
  // trykket åpnet egenskapene i stedet.
  if (S.lagKlikk && !S.mode && !e.shiftKey && S.lagKlikk(e.clientX, e.clientY)) return;
  // 🧱 Støpeplanens velgemodus: et vanlig trykk legger til / tar bort, som
  // shift-klikk. Shift + dra og shift-klikk går sin vanlige vei (elements.js).
  if (S.velgModusAktiv && !S.mode && !e.shiftKey) {
    // 📅 Framdriftsplanen tar også markeringene (Emil 01.10): bobla ligger
    // over modellen, så den går først — som ellers i programmet.
    if (S.markeringIVelgModus) {
      const mc = pickMarker(e.clientX, e.clientY);
      if (mc) { S.markeringIVelgModus(mc.id); return; }
    }
    velgVedPunkt(e.clientX, e.clientY); return;
  }
  // 📐 Fra flate: neste trykk setter snittplanet (ignorer gjeldende snitt så flaten kan treffes)
  if (S.clipPickFace) {
    const fh = pick(e.clientX, e.clientY, true);
    if (fh) setClipFromFace(fh);
    return;
  }
  // 🔄 Sammenlign → Manuelt → «Samme objekt i begge»: trykket velger
  // referanseobjektet (compare.js), i stedet for å åpne egenskapene
  if (S.cmpVelger && !S.mode && !e.shiftKey) {
    const ch = pick(e.clientX, e.clientY);
    const cid = ch ? hitID(ch) : null;
    if (cid != null) S.cmpVelger(cid);
    return;
  }
  // 🟡 Trykk på en markering åpner teksten. Går foran valg av element, men ikke
  // foran verktøyene – i 📌/📏/▲-modus skal trykket gjøre det modusen sier.
  if (!S.mode) {
    const mc = pickMarker(e.clientX, e.clientY);
    if (mc) { openMarkerPopup(mc); return; }
    closeMarkerPopup();
  }
  let hit = pick(e.clientX, e.clientY);
  // 🧱 SW-elementene bor i sin egen gruppe, som pick() ikke ser. Ligger et av
  // dem nærmere kameraet enn modelltreffet, er DET du trykte på — samme regel
  // som for materiellet i shift-klikket. Uten dette kunne ikke et SW-element
  // velges i det hele tatt, og da fantes det heller ingen vei til å skjule ett
  // av dem for å se stålsøyla bak (Emils funn 16.09).
  if (!S.mode && !e.shiftKey) {
    const ek = pickEkstra(e.clientX, e.clientY);
    if (ek && (!hit || ek.avstand < hit.distance)) {
      clearSelection();
      ek.lag.velg([ek.id]);
      if (ek.lag.visEgenskaper) ek.lag.visEgenskaper(ek.id);
      return;
    }
  }
  // ⛰ Mål og Kote kan også treffe TERRENGET (og bare de — terrenget kan ikke
  // velges som element). Ligger terrenget nærmere kameraet enn modellen, er
  // det terrenget du pekte på. Uten dette kan ikke målestokken kontrolleres.
  if (S.mode === "measure" || S.mode === "kote" || S.mode === "kjede" || S.mode === "vinkel") {
    const f = pickFlate(e.clientX, e.clientY);
    if (f && (!hit || f.distance < hit.distance)) hit = f;
  }
  // 📏 …og rigg-objektene og materiellet: punktet havner på det du trykte på,
  // ikke på bakken bak (Emil 02.10). Markering også — den skal kunne settes
  // på en container uten at containeren åpnes.
  if (S.mode === "measure" || S.mode === "kote" || S.mode === "marker" || S.mode === "kjede" || S.mode === "vinkel") {
    const f = naermesteMaaleflate(e.clientX, e.clientY);
    if (f && (!hit || f.distance < hit.distance)) hit = f;
  }
  // 📏📐 Kjedemål og Vinkel/fall (js/maal-verktoy.js). Går foran «traff
  // ingenting»: et kjedemål plasseres der du trykker, også i lufta.
  if ((S.mode === "kjede" || S.mode === "vinkel") && S.maalVerktoyKlikk) {
    const mp = hit ? (hit.utenSnap ? hit.point.clone() : snapPoint(hit).point) : null;
    if (S.maalVerktoyKlikk(e.clientX, e.clientY, mp)) return;
  }
  if (!hit) {
    // Shift eies av flervalget (elements.js) — og det kan ha truffet MATERIELL,
    // som pick() med vilje ikke ser. Uten shift-unntaket her ble et shift-klikk
    // på materiell nullstilt som «klikk i tomrommet» rett etter at elements.js
    // hadde lagt objektet til i utvalget (Emils funn 31.08).
    if (!S.mode && !e.shiftKey) { clearSelection(); $("propPanel").classList.remove("open"); }
    return;
  }
  if (S.mode === "marker") {
    S.pendingPoint = hit.point.clone();
    forberedNyMarkering();
    $("commentDialog").classList.add("open");
    setTimeout(() => $("commentText").focus(), 50);
  } else if (S.mode === "measure") {
    // fester seg til nærmeste kant/hjørne — men ikke på terrenget (utenSnap)
    const mp0 = hit.utenSnap ? hit.point.clone() : snapPoint(hit).point;
    // «Rett strek» på: andrepunktet låses til nærmeste akse fra førstepunktet
    const mp = (S.measureFirst && S.rettOn) ? rettPunkt(S.measureFirst, mp0) : mp0;
    if (!S.measureFirst) {
      S.measureFirst = mp.clone();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false }));
      dot.renderOrder = 997;
      dot.position.copy(S.measureFirst);
      dot.userData.temp = true;
      dot.userData.px = 8;
      measureGroup.add(dot);
    } else {
      measureGroup.children.filter(o => o.userData.temp).forEach(o => measureGroup.remove(o));
      addMeasure(S.measureFirst, mp.clone());
      S.measureFirst = null;
    }
  } else if (S.mode === "kote") {
    // koteValue gir høyden i MODELLENS enheter – må til meter først.
    // ⛰ Er modellen satt ned i terrenget med en gulvkote, svarer terreng.js i
    // stedet (moh.) — gulvet viser gulvkoten, terrenget sin høyde.
    const moh = S.koteMoh ? S.koteMoh(hit.point) : null;
    const koteM = moh != null ? moh : tilM(koteValue(hit.point));
    const label = makeLabel("▲ " + fmtLen(koteM), "#22d3ee");
    label.userData.px = 30; // konstant skjermstørrelse
    label.userData.aspect = label.scale.x / label.scale.y;
    label.userData.meter = koteM;   // så lappen kan tegnes om ved enhetsbytte
    label.position.copy(hit.point);
    koteGroup.add(label);
    if (S.pushAngre) S.pushAngre({
      tekst: "Kote",
      angre: () => koteGroup.remove(label),
      gjenopprett: () => koteGroup.add(label)
    });
  } else {
    if (e.shiftKey) return; // shift håndteres av markeringsboks-logikken (shiftClickAt / finishBoxSelect)
    const id = hitID(hit);
    if (id == null) return;
    S.multiSel.clear();
    selectElement(id);
    showProperties(id);
  }
});

// ---------- Automatisk innlasting av innebygd modell ----------
if (window.EMBEDDED_IFC) {
  (async () => {
    loadingText.textContent = t("Laster innebygd modell …");
    loadingEl.classList.add("open");
    try {
      await ifcReady;
      const bin = atob(window.EMBEDDED_IFC);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      S.fileName = window.EMBEDDED_NAME || "modell.ifc";
      S.lastBuffer = buf;
      await loadModel(buf);
      afterLoad();
    } catch (err) {
      varsel(t("Klarte ikke å laste innebygd modell: ") + err.message);
    } finally {
      loadingEl.classList.remove("open");
    }
  })();
}
