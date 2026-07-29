// Oppstart: kobler sammen modulene og håndterer klikk i modellen.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, fmtLen, loadingEl, loadingText } from "./state.js";
import { setClipFromFace } from "./clip.js";
import { clearSelection, hitID, pick, selectElement, showProperties } from "./elements.js";
import { afterLoad, ifcReady, loadModel } from "./ifc.js";
import { closeMarkerPopup, openMarkerPopup, pickMarker } from "./markers.js";
import { addMeasure, koteValue, snapPoint } from "./measure.js";
import { canvas, koteGroup, makeLabel, measureGroup } from "./scene.js";

// last inn resten av modulene (rekkefølgen bestemmer oppstart)
import "./prefs.js";
import "./display.js";
import "./markers.js";
import "./minimap.js";
import "./axes.js";
import "./modes.js";
import "./sharepoint.js";
import "./ui.js";
import "./compare.js";
import "./recent.js";
import "./share.js";
import "./usersync.js";   // personlig oppsett fra SharePoint – må lastes sist

// JavaScript kjører – skjul advarselen
const jsCheck = document.getElementById("jsCheck");

if (jsCheck) jsCheck.style.display = "none";

// ---------- Klikk / trykk ----------

canvas.addEventListener("pointerdown", (e) => { S.downPos = { x: e.clientX, y: e.clientY }; });

canvas.addEventListener("pointerup", (e) => {
  if (!S.downPos) return;
  const moved = Math.hypot(e.clientX - S.downPos.x, e.clientY - S.downPos.y);
  S.downPos = null;
  if (moved > 8) return;
  if (e.button === 2) return; // høyreklikk håndteres av innstillingsmenyen
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
    $("commentText").value = "";
    $("commentDialog").classList.add("open");
    setTimeout(() => $("commentText").focus(), 50);
  } else if (S.mode === "measure") {
    const mp = snapPoint(hit).point; // fester seg til nærmeste kant/hjørne
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
    const label = makeLabel("▲ " + fmtLen(koteValue(hit.point)), "#22d3ee");
    label.userData.px = 30; // konstant skjermstørrelse
    label.userData.aspect = label.scale.x / label.scale.y;
    label.position.copy(hit.point);
    koteGroup.add(label);
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
    loadingText.textContent = "Laster innebygd modell …";
    loadingEl.classList.add("open");
    try {
      await ifcReady;
      const bin = atob(window.EMBEDDED_IFC);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      S.fileName = window.EMBEDDED_NAME || "modell.ifc";
      S.lastBuffer = buf;
      loadModel(buf);
      afterLoad();
    } catch (err) {
      alert("Klarte ikke å laste innebygd modell: " + err.message);
    } finally {
      loadingEl.classList.remove("open");
    }
  })();
}
