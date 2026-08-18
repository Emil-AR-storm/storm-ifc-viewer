// Oppstart: kobler sammen modulene og håndterer klikk i modellen.
import * as THREE from "three";
import { $, S, fmtLen, loadingEl, loadingText, tilM } from "./state.js";
import { oversettDom, setLang, t } from "./i18n.js";
import { setClipFromFace } from "./clip.js";
import { clearSelection, hitID, pick, selectElement, showProperties } from "./elements.js";
import { afterLoad, ifcReady, loadModel } from "./ifc.js";
import { closeMarkerPopup, forberedNyMarkering, openMarkerPopup, pickMarker } from "./markers.js";
import { addMeasure, koteValue, rettPunkt, snapPoint } from "./measure.js";
import { canvas, koteGroup, makeLabel, measureGroup } from "./scene.js";

// last inn resten av modulene (rekkefølgen bestemmer oppstart)
import "./prefs.js";
import "./display.js";
import "./outline.js";
import "./markers.js";
import "./minimap.js";
import "./viewcube.js";
import "./axes.js";
import "./modes.js";
import "./angre.js";   // ↩ angre/gjenopprett – må lastes før ui.js (hurtigtastene)
import "./sharepoint.js";
import "./ui.js";
import "./tema.js";   // lyst/mørkt tema – trenger knappen i toppbaren
import "./hjul.js";   // navigasjonshjul – trenger knappen i verktøylinja
import "./compare.js";
import "./recent.js";
import "./share.js";
import "./byggeplass.js";
import "./mobile.js";   // må lastes etter at alle knapper har fått lyttere
import "./oppsett.js";   // ansattliste og Planner-plan fra SharePoint
import "./usersync.js";   // personlig oppsett fra SharePoint – må lastes sist

// JavaScript kjører – skjul advarselen
const jsCheck = document.getElementById("jsCheck");

if (jsCheck) jsCheck.style.display = "none";

// ---------- Språk ----------
// Lagret valg legges på HTML-en med en gang, og velgeren på startskjermen
// holdes i takt med den i ⚙ Innstillinger (begge kaller setLang).
oversettDom();
const sprakVelg = $("sprakVelg");
if (sprakVelg) {
  sprakVelg.value = S.lang;
  sprakVelg.onchange = () => setLang(sprakVelg.value);
}

// ---------- Klikk / trykk ----------

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
  // 📐 Fra flate: neste trykk setter snittplanet (ignorer gjeldende snitt så flaten kan treffes)
  if (S.clipPickFace) {
    const fh = pick(e.clientX, e.clientY, true);
    if (fh) setClipFromFace(fh);
    return;
  }
  // 🟡 Trykk på en markering åpner teksten. Går foran valg av element, men ikke
  // foran verktøyene – i 📌/📏/▲-modus skal trykket gjøre det modusen sier.
  if (!S.mode) {
    const mc = pickMarker(e.clientX, e.clientY);
    if (mc) { openMarkerPopup(mc); return; }
    closeMarkerPopup();
  }
  const hit = pick(e.clientX, e.clientY);
  if (!hit) {
    if (!S.mode) { clearSelection(); $("propPanel").classList.remove("open"); }
    return;
  }
  if (S.mode === "marker") {
    S.pendingPoint = hit.point.clone();
    forberedNyMarkering();
    $("commentDialog").classList.add("open");
    setTimeout(() => $("commentText").focus(), 50);
  } else if (S.mode === "measure") {
    const mp0 = snapPoint(hit).point; // fester seg til nærmeste kant/hjørne
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
    // koteValue gir høyden i MODELLENS enheter – må til meter først
    const label = makeLabel("▲ " + fmtLen(tilM(koteValue(hit.point))), "#22d3ee");
    label.userData.px = 30; // konstant skjermstørrelse
    label.userData.aspect = label.scale.x / label.scale.y;
    label.userData.meter = tilM(koteValue(hit.point));   // så lappen kan tegnes om ved enhetsbytte
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
      alert(t("Klarte ikke å laste innebygd modell: ") + err.message);
    } finally {
      loadingEl.classList.remove("open");
    }
  })();
}
