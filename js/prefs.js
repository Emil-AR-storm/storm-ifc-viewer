// Lagring av innstillinger og utseende. Standardverdiene og innlesingen ved
// oppstart ligger i state.js – her ligger bare skrivingen og gjenopprettingen.
import { $, S, writePrefs } from "./state.js";
import { applyTypeColors, buildTypeInfo } from "./display.js";

export function saveSettings() {
  writePrefs();
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

// ---------- Lagret utseende ----------
// Fargelegging, egendefinerte typefarger, skjulte typer, transparent og bakgrunn
// lagres og legges automatisk på når en modell åpnes.
export function saveAppear() {
  writePrefs();
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

export function saveBg(hex) {
  S.bg = hex;
  writePrefs();
  if (S.syncPrefs) S.syncPrefs(); // send også til SharePoint (personlig oppsett)
}

// Skriver dagens skjulte typer tilbake til lageret
export function syncHiddenTypes() {
  if (!S.typeInfo) return;
  S.appear.hiddenTypes = [...S.typeInfo.entries()].filter(([, g]) => g.hidden).map(([k]) => k);
  saveAppear();
}

// Legger på lagret utseende etter at en modell er åpnet
export function restoreAppearance() {
  if (!S.modelGroup || S.lightLoaded || S.glbActive || S.modelID === null) return;
  const hasSaved = S.appear.typeColorsOn || S.appear.ghost ||
    S.appear.hiddenTypes.length || Object.keys(S.appear.colors).length;
  if (!hasSaved) return;
  try {
    if (!S.typeInfo) buildTypeInfo();
    if (S.appear.typeColorsOn) applyTypeColors(true);
    if (S.appear.hiddenTypes.length) {
      let any = false;
      for (const [k, g] of S.typeInfo) {
        g.hidden = S.appear.hiddenTypes.includes(k);
        if (g.hidden) any = true;
        g.meshes.forEach(m => m.visible = !g.hidden);
      }
      if (any) $("btnShowAll").style.display = "";
    }
    if (S.appear.ghost && !S.appear.typeColorsOn) $("btnGhost").click();
  } catch(err) { console.warn("Klarte ikke å gjenopprette utseende:", err); }
}
