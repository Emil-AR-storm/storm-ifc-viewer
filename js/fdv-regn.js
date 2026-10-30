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
    objekter, endret: tekst(g.endret, 40), av: tekst(g.av, 80),
    // 📚 FDV-bibliotek (Emils valg A 30.10): varen i biblioteket gruppa hører til
    bibId: tekst(g.bibId, 40), fraBib: !!g.fraBib,
    // 🔩 Varer uten 3D-objekt (skruer, byggeskum, spiker …)
    uten3d: (Array.isArray(g.uten3d) ? g.uten3d : []).map(vaskLinje).filter(Boolean).slice(0, 200)
  };
}
export const levende = (liste) => (liste || []).map(vaskGruppe).filter(g => g && !g.slettet);

// ---------- 🔩 Varer uten 3D (Emil 30.10: «skruer, byggeskum, spiker») ----------
// En linje i gruppa: navn, mengde og enhet. Mengde kan stå tom (fylles inn).
export const ENHETER = ["stk", "kg", "lm", "m²", "m³", "l", "pk"];
export function vaskLinje(l) {
  if (!l || typeof l !== "object") return null;
  const navn = tekst(l.navn, 120).trim();
  if (!navn) return null;
  const m = l.mengde === "" || l.mengde == null ? null : Number(String(l.mengde).replace(/\s/g, "").replace(",", "."));
  return { id: tekst(l.id || nyId(), 40), navn, mengde: Number.isFinite(m) && m >= 0 ? Math.round(m * 1000) / 1000 : null,
    enhet: ENHETER.includes(l.enhet) ? l.enhet : "stk" };
}
export const mengdeTekst = (l) => (l.mengde == null ? "—" : String(l.mengde).replace(".", ",")) + " " + l.enhet;

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
export function statusPerFag(objekter, kart, grupper) {
  const m = new Map();
  for (const o of objekter) {
    const x = m.get(o.fag) || { fag: o.fag, totalt: 0, ferdig: 0, delvis: 0 };
    x.totalt++;
    const k = kart.get(o.gid);
    if (k && k.farge === "gronn") x.ferdig++; else if (k) x.delvis++;
    m.set(o.fag, x);
  }
  // 🔩 Varene uten 3D: hver linje teller som ett «objekt» (alltid i en gruppe)
  for (const g of levende(grupper)) {
    if (!g.uten3d.length) continue;
    const x = m.get("Uten 3D") || { fag: "Uten 3D", totalt: 0, ferdig: 0, delvis: 0 };
    const f = gruppeStatus(g).ferdig;
    x.totalt += g.uten3d.length; if (f) x.ferdig += g.uten3d.length; else x.delvis += g.uten3d.length;
    m.set("Uten 3D", x);
  }
  const rekke = ["Betong", "Armering", "Isolasjon", "Stål", "Annet", "Uten 3D"];
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
  const rader = [[T("Status"), T("FDV-gruppe"), T("Revit-type"), T("IFC-type"), T("Materiale"), T("Fag"), T("Modell"), "GlobalId", T("Dokumenter"), T("Mengde"), T("Enhet")]];
  const sortert = objekter.slice().sort((a, b) => (gFor.get(a.gid) ? 0 : 1) - (gFor.get(b.gid) ? 0 : 1) || String(a.type).localeCompare(String(b.type), "no"));
  for (const o of sortert) {
    const g = gFor.get(o.gid);
    const st = !g ? T("Mangler") : gruppeStatus(g).ferdig ? T("Ferdig") : T("Delvis");
    rader.push([st, g ? g.navn : "", o.type || "", o.ifcType || "", o.materiale || "", T(o.fag || ""), o.modell || "", o.gid,
      g ? g.dokumenter.map(d => d.navn).join(", ") : "", "", ""]);
  }
  // 🔩 Varene uten 3D nederst: varenavnet i Revit-type-kolonnen, mengden til slutt
  for (const g of gr) for (const l of g.uten3d) {
    rader.push([gruppeStatus(g).ferdig ? T("Ferdig") : T("Delvis"), g.navn, l.navn, T("uten 3D"), "", T("Uten 3D"), "", "",
      g.dokumenter.map(d => d.navn).join(", "), l.mengde == null ? "" : l.mengde, l.enhet]);
  }
  return rader;
}
export function gruppeRader(grupper, ov) {
  const T = ov || ((x) => x);
  const rader = [[T("FDV-gruppe"), T("Objekter"), T("Revit-typer")].concat(KRAV.map(k => T(doktypeNavn(k)))).concat([T("Annet"), T("Status"), T("Uten 3D")])];
  for (const g of levende(grupper)) {
    const st = gruppeStatus(g);
    rader.push([g.navn, g.objekter.length, perType(g).map(p => p.type + " (" + p.antall + ")").join(", ")]
      .concat(KRAV.map(k => (g.ikkeAktuelt.includes(k) ? T("ikke aktuelt") : g.dokumenter.filter(d => d.type === k).map(d => d.navn).join(", ") || T("mangler"))))
      .concat([g.dokumenter.filter(d => d.type === "annet").map(d => d.navn).join(", "), st.ferdig ? T("Ferdig") : T("Delvis") + " " + st.har.length + "/" + st.krav.length,
        g.uten3d.map(l => l.navn + " (" + mengdeTekst(l) + ")").join(", ")]));
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

// ═══════════════ 📚 FDV-BIBLIOTEKET (Emils valg A, 30.10.2026) ═══════════════
// «En vare med PDF-ene lagres én gang. I neste prosjekt velger du varen fra
// biblioteket og klikker bare objektene.» Biblioteket er én fil for hele
// Storm: SharePoint FDV/_bibliotek.fdv.json (flettes på id). PDF-ene ligger
// allerede i FDV-mappa og deles.
// En VARE husker hvilke Revit-typer den er koblet til i tidligere prosjekter
// (typer) — det er det forslagene bygger på — og hvilke prosjekter den er
// brukt i. Varer uten 3D husker navn og enhet (mengden er per prosjekt).
export const BIB_FIL = "_bibliotek.fdv.json";
const unik = (liste, n, maks) => { const ut = [], sett = new Set(); for (const x of liste || []) { const v = tekst(x, n).trim(); const k = v.toLowerCase(); if (v && !sett.has(k)) { sett.add(k); ut.push(v); } } return ut.slice(0, maks); };
export function vaskVare(v) {
  if (!v || typeof v !== "object" || !v.id) return null;
  if (v.slettet) return { id: tekst(v.id, 40), slettet: true, endret: tekst(v.endret, 40) };
  const u3 = [], sett = new Set();
  for (const l of Array.isArray(v.uten3d) ? v.uten3d : []) {
    const navn = tekst(l && l.navn, 120).trim(), k = navn.toLowerCase();
    if (navn && !sett.has(k)) { sett.add(k); u3.push({ navn, enhet: ENHETER.includes(l.enhet) ? l.enhet : "stk" }); }
  }
  return {
    id: tekst(v.id, 40), navn: tekst(v.navn, 80).trim() || "FDV-vare",
    dokumenter: (Array.isArray(v.dokumenter) ? v.dokumenter : []).map(vaskDok).filter(Boolean).slice(0, 60),
    ikkeAktuelt: (Array.isArray(v.ikkeAktuelt) ? v.ikkeAktuelt : []).filter(k => KRAV.includes(k)),
    typer: unik(v.typer, 160, 50), prosjekter: unik(v.prosjekter, 140, 500), uten3d: u3.slice(0, 200),
    endret: tekst(v.endret, 40), av: tekst(v.av, 80)
  };
}
export const levendeVarer = (liste) => (liste || []).map(vaskVare).filter(v => v && !v.slettet);
// Hvilken vare i biblioteket en gruppe hører til (gruppas egen id om den ble laget her)
export const vareId = (g) => (g && (g.bibId || g.id)) || "";

// Gruppa er endret → varen i biblioteket oppdateres. Dokumentene og «ikke
// aktuelt» følger gruppa (lesingen fletter inn det andre prosjekter har lagt
// til først), typene og prosjektene samles opp.
export function vareFraGruppe(bib, g0, nokkel, naa, av) {
  const g = vaskGruppe(g0);
  if (!g || g.slettet) return null;
  const id = vareId(g);
  const gml = levendeVarer(bib).find(v => v.id === id) || { typer: [], prosjekter: [], uten3d: [] };
  return vaskVare({
    id, navn: g.navn, dokumenter: g.dokumenter, ikkeAktuelt: g.ikkeAktuelt,
    typer: gml.typer.concat(perType(g).filter(p => p.type !== "(uten type)").map(p => p.type)),
    prosjekter: gml.prosjekter.concat(nokkel ? [nokkel] : []),
    uten3d: gml.uten3d.concat(g.uten3d.map(l => ({ navn: l.navn, enhet: l.enhet }))),
    endret: naa || g.endret, av: av || g.av
  });
}
// En type tatt helt ut av gruppa var en feilkobling — forslagene skal glemme den
export function glemType(vare, type, naa) {
  const v = vaskVare(vare);
  if (!v || v.slettet) return v;
  const k = String(type || "").toLowerCase();
  return Object.assign({}, v, { typer: v.typer.filter(x => x.toLowerCase() !== k), endret: naa || v.endret });
}
// Ny gruppe i dette prosjektet fra en vare i biblioteket
export function gruppeFraVare(vare, naa, av) {
  const v = vaskVare(vare);
  return vaskGruppe({ id: nyId(), bibId: v.id, fraBib: true, navn: v.navn, dokumenter: v.dokumenter, ikkeAktuelt: v.ikkeAktuelt,
    objekter: [], uten3d: v.uten3d.map(l => ({ id: nyId(), navn: l.navn, enhet: l.enhet, mengde: null })), endret: naa, av });
}
// Lesing: dokumenter andre prosjekter har lagt på varen, blir med her også
export function flettVareDok(g0, vare) {
  const g = vaskGruppe(g0), v = vaskVare(vare);
  if (!g || g.slettet || !v || v.slettet) return g;
  const har = new Set(g.dokumenter.map(d => d.fil));
  const nye = v.dokumenter.filter(d => !har.has(d.fil));
  return nye.length ? Object.assign({}, g, { dokumenter: g.dokumenter.concat(nye) }) : g;
}
// 💡 Forslag: varer i biblioteket som ikke er brukt i prosjektet, men har en
// Revit-type som finnes her på objekter som ikke er i noen gruppe ennå.
// Svar: [{ vare, typer: [{ type, antall }], gids, antall }] — flest først.
export function forslag(bib, grupper, objekter) {
  const gr = levende(grupper);
  const brukt = new Set(gr.map(vareId));
  const iGruppe = new Set(); for (const g of gr) for (const o of g.objekter) iGruppe.add(o.gid);
  const ledig = new Map();
  for (const o of objekter || []) {
    if (!o.gid || iGruppe.has(o.gid)) continue;
    const k = String(o.type || "").trim().toLowerCase();
    if (!k) continue;
    const x = ledig.get(k) || { type: o.type, objekter: [] }; x.objekter.push(o); ledig.set(k, x);
  }
  const ut = [];
  for (const v of levendeVarer(bib)) {
    if (brukt.has(v.id)) continue;
    const typer = [], objs = [];
    for (const t of v.typer) { const x = ledig.get(t.toLowerCase()); if (x) { typer.push({ type: x.type, antall: x.objekter.length }); objs.push(...x.objekter); } }
    if (objs.length) ut.push({ vare: v, typer, objekter: objs.map(o => ({ gid: o.gid, type: o.type })), antall: objs.length });
  }
  // Én type kan bare foreslås til én vare (den som er brukt i flest prosjekter)
  ut.sort((a, b) => b.vare.prosjekter.length - a.vare.prosjekter.length || b.antall - a.antall);
  const tatt = new Set();
  return ut.map(f => {
    const objekter = f.objekter.filter(o => !tatt.has(o.gid));
    objekter.forEach(o => tatt.add(o.gid));
    const typer = f.typer.filter(t => objekter.some(o => o.type === t.type)).map(t => ({ type: t.type, antall: objekter.filter(o => o.type === t.type).length }));
    return Object.assign({}, f, { objekter, typer, antall: objekter.length });
  }).filter(f => f.antall).sort((a, b) => b.antall - a.antall || a.vare.navn.localeCompare(b.vare.navn, "no"));
}
// Søk i biblioteket: alle ordene må finnes i navnet, typene eller linjene
export function sokVarer(bib, q) {
  const ord = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  return levendeVarer(bib).filter(v => {
    const s = (v.navn + " " + v.typer.join(" ") + " " + v.uten3d.map(l => l.navn).join(" ")).toLowerCase();
    return ord.every(o => s.includes(o));
  }).sort((a, b) => a.navn.localeCompare(b.navn, "no"));
}
