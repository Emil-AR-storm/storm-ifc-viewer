// 📁 FDV — REGNINGEN (runde 7 / 10, Emils valg A + B 29.10.2026). Ren, uten DOM.
//
// EMILS IDÉ: «Hvis det uansett må legges inn én gang manuelt, så last opp
// PDF-en én gang, og la Storm-IFC huske hvilke objekter som hører til den.»
// En FDV-GRUPPE har dokumentene (PDF-er) og objektene. Samme vare har mange
// navn i modellen («XPS 150mm» og «XPS 100mm» er samme XPS-plate), derfor
// kobles OBJEKTER til gruppa — ikke navn. Objektene huskes på GlobalId, så
// gruppa overlever en ny modellversjon fra RIB, og objekter i lag er med.
//
// Et objekt kan bare være i ÉN gruppe. Legges det i en annen, flyttes det.
// Objekter kan legges til og tas ut når som helst (Emil 29.10).

import { materialAv } from "./em-regn.js";

export const DOKTYPER = [
  { k: "fdv", navn: "FDV-dokumentasjon" },
  { k: "pdb", navn: "Produktdatablad" },
  { k: "dop", navn: "Ytelseserklæring (DoP)" },
  { k: "sam", navn: "Samsvarserklæring" },
  { k: "annet", navn: "Annet" }
];
// De fire som teller i status (Annet teller ikke). En type kan settes til
// «ikke aktuelt» per gruppe (en betongkum har kanskje ingen DoP).
export const KRAV = ["fdv", "pdb", "dop", "sam"];
export const FDV_MAPPE = "FDV";
const tekst = (s, n) => String(s == null ? "" : s).slice(0, n || 200);
export const nyId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Filnavnet sier ofte hva PDF-en er. Brukeren kan endre det.
export function gjettDoktype(filnavn) {
  const s = String(filnavn || "").toLowerCase();
  if (/\bfdv\b|drift|vedlikehold|maintenance/.test(s)) return "fdv";
  if (/ytelse|\bdop\b|declaration of performance|leistungserkl/.test(s)) return "dop";
  if (/samsvar|conformity|\bsam\b|\bdoc\b/.test(s)) return "sam";
  if (/datablad|data ?sheet|\bpdb\b|produktblad|teknisk ?(data|info)|tds/.test(s)) return "pdb";
  return "annet";
}
export const trygtFilnavn = (s) => String(s || "dokument.pdf").replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim().slice(0, 140) || "dokument.pdf";

export function vaskDok(d) {
  if (!d || typeof d !== "object" || !d.fil) return null;
  return { fil: trygtFilnavn(d.fil), navn: tekst(d.navn || d.fil, 160), type: DOKTYPER.some(x => x.k === d.type) ? d.type : "annet",
    lastet: tekst(d.lastet, 40), av: tekst(d.av, 80) };
}
export function vaskObjekt(o) {
  if (!o || typeof o !== "object" || !o.gid) return null;
  return { gid: tekst(o.gid, 64), type: tekst(o.type, 160) };
}
export function vaskGruppe(g) {
  if (!g || typeof g !== "object" || !g.id) return null;
  if (g.slettet) return { id: tekst(g.id, 40), slettet: true, endret: tekst(g.endret, 40) };
  const sett = new Set();
  const objekter = (Array.isArray(g.objekter) ? g.objekter : []).map(vaskObjekt).filter(o => o && !sett.has(o.gid) && sett.add(o.gid)).slice(0, 20000);
  return {
    id: tekst(g.id, 40), navn: tekst(g.navn, 80).trim() || "FDV-gruppe",
    dokumenter: (Array.isArray(g.dokumenter) ? g.dokumenter : []).map(vaskDok).filter(Boolean).slice(0, 60),
    ikkeAktuelt: (Array.isArray(g.ikkeAktuelt) ? g.ikkeAktuelt : []).filter(k => KRAV.includes(k)),
    objekter, endret: tekst(g.endret, 40), av: tekst(g.av, 80)
  };
}
export const levende = (liste) => (liste || []).map(vaskGruppe).filter(g => g && !g.slettet);

// ---------- Status ----------
// { har: [typer], krav: [typer], mangler: [typer], ferdig }
export function gruppeStatus(g) {
  const krav = KRAV.filter(k => !(g.ikkeAktuelt || []).includes(k));
  const har = krav.filter(k => (g.dokumenter || []).some(d => d.type === k));
  return { har, krav, mangler: krav.filter(k => !har.includes(k)), ferdig: har.length === krav.length };
}
// gid → { gruppe, farge: "gronn" | "gul" }   (ikke i kartet = rød)
export function objektKart(grupper) {
  const m = new Map();
  for (const g of levende(grupper)) {
    const f = gruppeStatus(g).ferdig ? "gronn" : "gul";
    for (const o of g.objekter) m.set(o.gid, { gruppe: g.id, farge: f });
  }
  return m;
}
export function gruppeFor(grupper, gid) {
  return levende(grupper).find(g => g.objekter.some(o => o.gid === gid)) || null;
}

// ---------- Endringer (rene: gir NY liste, endrer ikke den gamle) ----------
// Legg objektene i gruppa. Ligger de i en annen gruppe, flyttes de.
// Svar: { grupper, flyttet: [{ gid, fra }] }
export function leggTil(grupper, gruppeId, objekter, naa) {
  const nye = new Map((objekter || []).map(vaskObjekt).filter(Boolean).map(o => [o.gid, o]));
  const flyttet = [];
  const ut = (grupper || []).map(g0 => {
    const g = vaskGruppe(g0);
    if (!g || g.slettet) return g;
    if (g.id === gruppeId) {
      const har = new Set(g.objekter.map(o => o.gid));
      const til = [...nye.values()].filter(o => !har.has(o.gid));
      if (!til.length) return g;
      return Object.assign({}, g, { objekter: g.objekter.concat(til), endret: naa || g.endret });
    }
    const igjen = g.objekter.filter(o => !nye.has(o.gid));
    if (igjen.length === g.objekter.length) return g;
    for (const o of g.objekter) if (nye.has(o.gid)) flyttet.push({ gid: o.gid, fra: g.navn });
    return Object.assign({}, g, { objekter: igjen, endret: naa || g.endret });
  });
  return { grupper: ut, flyttet };
}
export function taUt(grupper, gruppeId, gids, naa) {
  const bort = new Set(gids || []);
  return (grupper || []).map(g0 => {
    const g = vaskGruppe(g0);
    if (!g || g.slettet || g.id !== gruppeId) return g;
    const igjen = g.objekter.filter(o => !bort.has(o.gid));
    return igjen.length === g.objekter.length ? g : Object.assign({}, g, { objekter: igjen, endret: naa || g.endret });
  });
}
// Objektene i gruppa samlet per Revit-type: [{ type, antall, gids }]
export function perType(g) {
  const m = new Map();
  for (const o of (g && g.objekter) || []) {
    const k = o.type || "(uten type)";
    const x = m.get(k) || { type: k, antall: 0, gids: [] };
    x.antall++; x.gids.push(o.gid); m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.antall - a.antall || a.type.localeCompare(b.type, "no"));
}

// ---------- Fag (status per fag) ----------
// navn + materiale + IFC-type → "Betong" | "Armering" | "Isolasjon" | "Stål" | "Annet"
export function fagFor(navn, materiale, ifcType) {
  const t = String(ifcType || "");
  if (/(ReinforcingBar|ReinforcingMesh|Tendon)$/i.test(t)) return "Armering";
  const m = materialAv(String(materiale || "") + " " + String(navn || ""));
  if (m === "isolasjon") return "Isolasjon";
  if (m === "staal") return "Stål";
  if (m === "betong") return "Betong";
  if (/^(Ifc)?(Slab|Wall|WallStandardCase|Column|Beam|Footing|Pile)$/i.test(t) && !String(materiale || "").trim()) return "Betong";
  return "Annet";
}
// Objekter som ikke skal telle (rom, åpninger, koordineringsobjekter)
export function tellerIkke(navn, materiale, ifcType) {
  return /^(Ifc)?(Space|OpeningElement|Annotation|Grid|VirtualElement|Site|Building|BuildingStorey)$/i.test(String(ifcType || "")) ||
    materialAv(String(materiale || "") + " " + String(navn || "")) === "koord";
}
// objekter: [{ gid, fag }] · kart: objektKart → [{ fag, totalt, ferdig, delvis, prosent }]
export function statusPerFag(objekter, kart) {
  const m = new Map();
  for (const o of objekter) {
    const x = m.get(o.fag) || { fag: o.fag, totalt: 0, ferdig: 0, delvis: 0 };
    x.totalt++;
    const k = kart.get(o.gid);
    if (k && k.farge === "gronn") x.ferdig++; else if (k) x.delvis++;
    m.set(o.fag, x);
  }
  const rekke = ["Betong", "Armering", "Isolasjon", "Stål", "Annet"];
  return [...m.values()].map(x => Object.assign(x, { prosent: x.totalt ? Math.round(x.ferdig / x.totalt * 100) : 0 }))
    .sort((a, b) => rekke.indexOf(a.fag) - rekke.indexOf(b.fag));
}

// ---------- Eksport ----------
const doktypeNavn = (k) => (DOKTYPER.find(d => d.k === k) || DOKTYPER[DOKTYPER.length - 1]).navn;
// Én rad per objekt. objekter: [{ gid, type, ifcType, materiale, fag, modell }]
export function registerRader(objekter, grupper, ov) {
  const T = ov || ((x) => x);
  const gr = levende(grupper);
  const gFor = new Map();
  for (const g of gr) for (const o of g.objekter) gFor.set(o.gid, g);
  const rader = [[T("Status"), T("FDV-gruppe"), T("Revit-type"), T("IFC-type"), T("Materiale"), T("Fag"), T("Modell"), "GlobalId", T("Dokumenter")]];
  const sortert = objekter.slice().sort((a, b) => (gFor.get(a.gid) ? 0 : 1) - (gFor.get(b.gid) ? 0 : 1) || String(a.type).localeCompare(String(b.type), "no"));
  for (const o of sortert) {
    const g = gFor.get(o.gid);
    const st = !g ? T("Mangler") : gruppeStatus(g).ferdig ? T("Ferdig") : T("Delvis");
    rader.push([st, g ? g.navn : "", o.type || "", o.ifcType || "", o.materiale || "", T(o.fag || ""), o.modell || "", o.gid,
      g ? g.dokumenter.map(d => d.navn).join(", ") : ""]);
  }
  return rader;
}
export function gruppeRader(grupper, ov) {
  const T = ov || ((x) => x);
  const rader = [[T("FDV-gruppe"), T("Objekter"), T("Revit-typer")].concat(KRAV.map(k => T(doktypeNavn(k)))).concat([T("Annet"), T("Status")])];
  for (const g of levende(grupper)) {
    const st = gruppeStatus(g);
    rader.push([g.navn, g.objekter.length, perType(g).map(p => p.type + " (" + p.antall + ")").join(", ")]
      .concat(KRAV.map(k => (g.ikkeAktuelt.includes(k) ? T("ikke aktuelt") : g.dokumenter.filter(d => d.type === k).map(d => d.navn).join(", ") || T("mangler"))))
      .concat([g.dokumenter.filter(d => d.type === "annet").map(d => d.navn).join(", "), st.ferdig ? T("Ferdig") : T("Delvis") + " " + st.har.length + "/" + st.krav.length]));
  }
  return rader;
}
// Stien i ZIP-en: «<gruppe>/<doktype> - <filnavn>.pdf»
export function zipSti(g, d) {
  return trygtFilnavn(g.navn) + "/" + trygtFilnavn(doktypeNavn(d.type) + " - " + (d.navn || d.fil));
}
// Nøkkelen fila lagres under: prosjektnummer, ellers modellnavnet
export function lagerNokkel(prosjektNr, modell) {
  const p = String(prosjektNr || "").trim();
  return trygtFilnavn(p || String(modell || "modell").replace(/\.(ifc|glb)$/i, ""));
}
