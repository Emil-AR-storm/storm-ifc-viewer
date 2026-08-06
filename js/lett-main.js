// Oppstart for LETTMODUS (bygg.html): som main.js, men uten bibliotek,
// sammenligning, «Fortsett med»-knapp og personlig oppsett fra SharePoint.
// Innlogging startes aldri – se LETT-flagget i lett.js og gaten i sharepoint.js.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { $, S, esc, fmtLen, loadingEl, loadingText } from "./state.js";
import { oversettDom, setLang, t } from "./i18n.js";
import { setClipFromFace } from "./clip.js";
import { clearSelection, hitID, pick, selectElement, showProperties } from "./elements.js";
import { afterLoad, ifcReady, loadGlb } from "./ifc.js";
import { closeMarkerPopup, openMarkerPopup, pickMarker } from "./markers.js";
import { snapshotModel } from "./compare.js";
import { addMeasure, koteValue, rettPunkt, snapPoint } from "./measure.js";
import { canvas, koteGroup, makeLabel, measureGroup } from "./scene.js";

// last inn resten av modulene (rekkefølgen bestemmer oppstart)
// UTELATT i lettmodus: ./compare.js, ./recent.js, ./usersync.js
// (share.js drar inn compare.js selv – det er greit, knappen er skjult i CSS)
import "./prefs.js";
import "./display.js";
import "./markers.js";
import "./minimap.js";
import "./viewcube.js";
import "./axes.js";
import "./modes.js";
import "./sharepoint.js";
import "./ui.js";
import "./share.js";
import "./mobile.js";   // må lastes etter at alle knapper har fått lyttere

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

// ---------- Innlasting av modell fra en vanlig URL ----------
// Erstatter «Automatisk innlasting av innebygd modell» fra main.js.
// Trinn 3 (Workeren) kaller denne etter riktig kode. Fram til da kan den
// kjøres for hånd i konsollen: åpneFraUrl("test.glb")
async function åpneFraUrl(url) {
  loadingText.textContent = t("Laster modell …");
  loadingEl.classList.add("open");
  try {
    await ifcReady;
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    S.fileName = decodeURIComponent((url.split("/").pop() || "modell.glb").split("?")[0]);
    await loadGlb(new Uint8Array(await r.arrayBuffer()));
    afterLoad();
  } catch (err) {
    alert(t("Klarte ikke å laste modellen: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
}
window.åpneFraUrl = åpneFraUrl;   // trinn 3 kaller denne


// ---------- Landingsside (trinn 4): prosjekt fra adressen, kode fra montøren ----------
// QR-en peker på /20653 — Workeren serverer bygg.html der, og vi leser nummeret her.
(function () {
  const boks = $("kodeBoks");
  if (!boks) return;
  const prosjInp = $("prosjektInput"), inp = $("kodeInput"),
        feilEl = $("kodeFeil"), knapp = $("kodeKnapp");
  const fraUrl = (location.pathname.match(/^\/(\d{5})$/) || [])[1] || "";
  if (fraUrl) { prosjInp.value = fraUrl; prosjInp.style.display = "none"; }

  async function prøv() {
    const prosjekt = (prosjInp.value || "").trim();
    const kode = (inp.value || "").trim().toUpperCase();
    if (!/^\d{5}$/.test(prosjekt)) { feilEl.textContent = t("Prosjektnummeret må være 5 siffer."); return; }
    if (kode.length !== 6) { feilEl.textContent = ""; return; }
    feilEl.textContent = "";
    knapp.disabled = true;
    try {
      const r = await fetch("/åpne", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prosjekt, kode })
      });
      const svar = await r.json().catch(() => ({}));
      if (!r.ok) { feilEl.textContent = t(svar.feil || "Feil kode eller prosjekt."); return; }
      S.lettProsjekt = prosjekt;   // trinn 5: markeringer og bilder hentes per prosjekt
      if (!svar.modeller || !svar.modeller.length) { feilEl.textContent = t("Ingen modeller i prosjektet ennå."); return; }
      if (svar.modeller.length === 1) { åpneFraUrl(svar.modeller[0].url); return; }
      // Flere modeller: vis en knapp per modell
      let valg = $("kodeValg");
      if (!valg) { valg = document.createElement("div"); valg.id = "kodeValg"; boks.appendChild(valg); }
      valg.innerHTML = "<p class='liten' style='display:block !important'>" + t("Velg modell") + ":</p>";
      svar.modeller.forEach(m => {
        const b = document.createElement("button");
        b.className = "btn";
        b.textContent = m.navn.replace(/\.lett\.glb$/i, "").replace(/\.glb$/i, "") +
          (m.størrelse ? " · " + Math.round(m.størrelse / 1048576) + " MB" : "");
        b.onclick = () => åpneFraUrl(m.url);
        valg.appendChild(b);
      });
    } catch (_) {
      feilEl.textContent = t("Fikk ikke kontakt – sjekk nettet og prøv igjen.");
    } finally {
      knapp.disabled = false;
    }
  }

  // Ingen Enter-knapp nødvendig: seks tegn skrevet → prøv med en gang
  inp.addEventListener("input", () => {
    inp.value = inp.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
    if (inp.value.length === 6 && /^\d{5}$/.test(prosjInp.value)) prøv();
  });
  knapp.addEventListener("click", prøv);
})();


// ---------- 🕐 Historikk (trinn 6): se og åpne tidligere revisjoner ----------
// Koden åpner ALLTID nyeste modell. Gamle revisjoner ligger bak denne knappen,
// arkivert automatisk av Workeren hver gang en ENDRET modell lastes opp.
(function () {
  const btn = $("btnHistorikk");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const gammelt = $("histPanel");
    if (gammelt) { gammelt.remove(); btn.classList.remove("active"); return; }
    if (!S.lettProsjekt) { alert(t("Skriv koden først.")); return; }
    let idx = { liste: [] };
    try {
      const r = await fetch("/revisjoner/" + S.lettProsjekt);
      if (r.ok) idx = await r.json();
    } catch (_) {}
    const rader = (idx.liste || []).filter(x => x.fil === S.fileName).reverse();
    const panel = document.createElement("div");
    panel.id = "histPanel";
    panel.innerHTML = "<h3>" + t("Historikk") + " · " + esc(S.fileName || "") + "</h3>";
    const nå = document.createElement("button");
    nå.className = "btn gjeldende";
    nå.textContent = "▶ " + t("Nyeste versjon");
    nå.onclick = () => { panel.remove(); btn.classList.remove("active");
      åpneFraUrl("/modell/" + S.lettProsjekt + "/" + encodeURIComponent(S.fileName) + "?v=" + Date.now()); };
    panel.appendChild(nå);
    if (!rader.length) {
      const p = document.createElement("p");
      p.className = "liten"; p.style.cssText = "display:block !important";
      p.textContent = t("Ingen tidligere revisjoner ennå.");
      panel.appendChild(p);
    }
    rader.forEach(rv => {
      const k = document.createElement("button");
      k.className = "btn";
      const dato = rv.arkivert ? new Date(rv.arkivert).toLocaleString("no-NO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      k.textContent = t("Revisjon") + " " + rv.rev + (dato ? " · " + dato : "");
      k.onclick = () => { panel.remove(); btn.classList.remove("active");
        åpneFraUrl("/modell/" + S.lettProsjekt + "/rev/" + rv.rev + "/" + encodeURIComponent(S.fileName)); };
      panel.appendChild(k);
      // ⇄ Sammenlign: åpner revisjonen, tar avtrykk, åpner nyeste — endringene
      // fargelegges og listes automatisk (S.onModelLoaded i compare.js)
      const s = document.createElement("button");
      s.className = "btn";
      s.style.cssText = "font-size:12px; opacity:.85";
      s.textContent = "⇄ " + t("Sammenlign med nyeste");
      s.onclick = async () => {
        panel.remove(); btn.classList.remove("active");
        const fil = S.fileName;
        await åpneFraUrl("/modell/" + S.lettProsjekt + "/rev/" + rv.rev + "/" + encodeURIComponent(fil));
        const snap = await snapshotModel();
        if (!snap) { alert(t("Fikk ikke lest revisjonen for sammenligning.")); return; }
        snap.file = t("Revisjon") + " " + rv.rev;   // må hete noe annet enn nyeste, ellers starter ikke sammenligningen
        S.compareBase = snap;
        await åpneFraUrl("/modell/" + S.lettProsjekt + "/" + encodeURIComponent(fil) + "?v=" + Date.now());
      };
      panel.appendChild(s);
    });
    document.body.appendChild(panel);
    btn.classList.add("active");
  });
})();
