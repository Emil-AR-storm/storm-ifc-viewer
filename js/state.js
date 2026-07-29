// Delt tilstand og små hjelpere. Alt som flere moduler endrer, ligger i S.

export const S = {};

// Lengde i valgt enhet (m eller mm)
export function fmtLen(m) {
  return S.settings.unit === "mm" ? Math.round(m * 1000).toLocaleString("no-NO") + " mm" : m.toFixed(2) + " m";
}

export const statusEl = document.getElementById("status");

export const loadingEl = document.getElementById("loading");

export const loadingText = document.getElementById("loadingText");

export const $ = (id) => document.getElementById(id);

export function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
