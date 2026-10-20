// 💰 Priskalkulasjon — reglene. RENE FUNKSJONER: ingen DOM, ingen nett, ingen
// three.js. Panelet (js/priskalk.js) leser mengdene og tegner; her bestemmes
// hva en post ER, hvor mye den blir, og hvordan Excel-arket ser ut.
// Prøves i _test/test-priskalk.mjs.
//
// Byggeplan: «Storm IFC-Viewer Priskalkulasjon kartlegging og 3 provebilder
// 2026-10-12». Emils valg 12.10:
//   · oppsett B (stort tabellvindu), egen prisliste PER PROSJEKT
//   · påslag: felles øverst OG per linje
//   · to måter å lage en post: «Fra modellen» (objekttype + materiale, som i
//     Mengder) og «Manuell» (marker objektene selv, velg m³/m²/lm/stk/kg)
//   · både geometrien og mengdesettene i fila (Qto) vises, med avvik — og du
//     velger per post hvilket tall som går til Excel. Mangler Qto på et
//     element, brukes geometrien for det elementet.
//   · Excel-fila har FORMLER, ikke ferdige tall (Emil 03.09 og 12.10).

export const ENHETER = ["m³", "m²", "lm", "stk", "kg"];

// Geometritallet per element (raden fra computeQuantities i elements.js).
// m² er STØRSTE FLATE — samme tall som Mengder viser (veggens side, dekkets
// overside). Fotavtrykket brukes bare når største flate mangler (materiell).
const GEO = {
  "m³": (r) => Number(r.vol) || 0,
  "m²": (r) => Number(r.flate) || Number(r.area) || 0,
  "lm": (r) => Number(r.len) || 0,
  "stk": () => 1,
  "kg": (r) => Number(r.kg) || 0
};
export function geoVerdi(rad, enhet) { return (GEO[enhet] || GEO.stk)(rad || {}); }

// Hvilken art et mengdesett-tall må ha for å passe enheten
export const QTO_ART = { "m³": "volum", "m²": "areal", "lm": "lengde", "kg": "masse", "stk": "antall" };

// Når flere felt passer, foreslås NETTO først — det er det som er bygget.
// Brutto står som valg, så du kan prise brutto der kontrakten sier det.
const FORETRUKKET = {
  "m³": ["NetVolume", "GrossVolume"],
  "m²": ["NetSideArea", "NetArea", "NetSurfaceArea", "GrossSideArea", "GrossArea", "NetFootprintArea", "GrossFootprintArea", "OuterSurfaceArea"],
  "lm": ["Length", "NetLength"],
  "kg": ["NetWeight", "GrossWeight"],
  "stk": []
};

// ═══════════════════════ POSTENE ═══════════════════════
const tall = (v, reserve) => {
  if (v === "" || v === null || v === undefined) return reserve;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : reserve;
};
export function lesTall(v) { return tall(v, null); }

let teller = 0;
export function nyId(naa) {
  teller++;
  return "P" + (naa || Date.now()).toString(36) + teller.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

// Én post — tåler alt som kan komme fra SharePoint eller en gammel versjon.
export function vaskPost(p) {
  const x = p && typeof p === "object" ? p : {};
  const modus = ["modell", "manuell", "egen"].includes(x.modus) ? x.modus : "egen";
  const enhet = ENHETER.includes(x.enhet) ? x.enhet : "stk";
  const kilde = typeof x.kilde === "string" && /^(geometri|qto:.+)$/.test(x.kilde) ? x.kilde : "geometri";
  return {
    id: String(x.id || ""),
    nr: String(x.nr || "").slice(0, 20),
    tekst: String(x.tekst || "").slice(0, 200),
    modus,
    type: String(x.type || ""),
    mat: String(x.mat || ""),
    gids: Array.isArray(x.gids) ? x.gids.map(String).filter(Boolean) : [],
    // 💰 Det som ikke er IFC: «sw:<id>», «tak:<id>», «blikk:<id>», «mat:<id>»
    nokler: Array.isArray(x.nokler) ? x.nokler.map(String).filter(k => /^(sw|tak|blikk|mat):./.test(k)) : [],
    enhet,
    kilde: enhet === "stk" ? "geometri" : kilde,
    mengdeEgen: tall(x.mengdeEgen, 0),
    pris: tall(x.pris, null),
    paaslag: tall(x.paaslag, 0),
    rekke: tall(x.rekke, 0),
    endret: String(x.endret || ""),
    slettet: !!x.slettet
  };
}

// Det prosjektfelles: felles påslag. Lagres som en egen post i samme fil.
export const OPPSETT_ID = "_oppsett";
export function vaskOppsett(o) {
  const x = o && typeof o === "object" ? o : {};
  return { id: OPPSETT_ID, felles: tall(x.felles, 0), endret: String(x.endret || "") };
}

// Fila i SharePoint: én per PROSJEKT (Emil 12.10: «egen per prosjekt»).
// Prosjektnummeret fra Prosjektinfo binder modellene i samme prosjekt
// sammen — hal A og hal B priser med samme liste. Uten nummer brukes
// modellfila, så ingenting havner i en felles «ukjent»-fil.
export function prislisteNokkel(info, filnavn) {
  const nr = String((info && info.nummer) || "").trim();
  if (nr) return { fil: "prosjekt-" + rensFilnavn(nr) + ".priser.json", hva: "prosjekt", navn: nr };
  const f = String(filnavn || "modell").replace(/\.(ifc|glb)$/i, "");
  return { fil: "modell-" + rensFilnavn(f) + ".priser.json", hva: "modell", navn: f };
}
function rensFilnavn(s) {
  return String(s).replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "ukjent";
}

// Lista fra SharePoint → poster (uten gravsteiner) + oppsett
export function fraLagret(liste) {
  const alle = Array.isArray(liste) ? liste : [];
  const oppsett = vaskOppsett(alle.find(p => p && p.id === OPPSETT_ID));
  const poster = alle.filter(p => p && p.id && p.id !== OPPSETT_ID && !p.slettet).map(vaskPost)
    .sort((a, b) => a.rekke - b.rekke || a.id.localeCompare(b.id));
  return { oppsett, poster };
}

// ═══════════════════════ HVILKE ELEMENTER EN POST GJELDER ═══════════════════════
// matGruppe: funksjonen fra elements.js (materialGruppe) — sendes inn, så
// denne fila slipper å importere modellkoden.
export function raderForPost(post, rader, matGruppe, guidTilId) {
  const p = post || {};
  const alle = Array.isArray(rader) ? rader : [];
  if (p.modus === "modell") {
    if (!p.type && !p.mat) return alle.slice();
    return alle.filter(r => {
      if (p.type && (r.type || "") !== p.type) return false;
      if (!p.mat) return true;
      if (p.mat.slice(0, 2) === "g:") return (matGruppe ? matGruppe(r.material) : "") === p.mat.slice(2);
      if (p.mat.slice(0, 2) === "m:") return (r.material || "") === p.mat.slice(2);
      return true;
    });
  }
  if (p.modus === "manuell") {
    const ider = new Set();
    for (const g of (p.gids || [])) {
      const id = guidTilId ? guidTilId(g) : null;
      if (id !== null && id !== undefined) ider.add(id);
    }
    // SW, takplater og blikk har nøkkelen som id i Mengder; materiell har
    // én rad per enhet med objektets id i matId (hele stabelen kommer med).
    const nokler = new Set((p.nokler || []).filter(k => !k.startsWith("mat:")));
    const mat = new Set((p.nokler || []).filter(k => k.startsWith("mat:")).map(k => k.slice(4)));
    // velgNokkel: én ting i 3D som er flere varer (gulvet: betong + isolasjon)
    const treff = alle.filter(r => ider.has(r.id) || nokler.has(String(r.id)) || (r.velgNokkel && nokler.has(r.velgNokkel)) ||
      (r.matId && mat.has(String(r.matId))));
    // Delt per materiale ved Ferdig (lagdelte elementer): bare dette materialet
    return p.mat ? treff.filter(r => (r.material || "") === p.mat.slice(2) || (p.mat.slice(0, 2) === "g:" && matGruppe && matGruppe(r.material) === p.mat.slice(2))) : treff;
  }
  return [];
}

// ═══════════════════════ MENGDEN ═══════════════════════
// qto: Map id → [[sett, navn, art, verdi i SI], …] (ifcrpc.js hentQto)
function qtoTall(qto, id, navn, art) {
  const l = qto && qto.get ? qto.get(id) : null;
  if (!l) return null;
  for (const q of l) if (q[1] === navn && q[2] === art) return Number(q[3]);
  return null;
}

// Feltene fra fila som passer enheten, med hvor mange av elementene som har dem.
// Netto først (FORETRUKKET), så resten alfabetisk.
export function qtoValg(rader, qto, enhet) {
  const art = QTO_ART[enhet];
  if (!art || art === "antall" || !qto || !qto.size) return [];
  const teller = new Map();
  for (const r of (rader || [])) {
    const l = qto.get(r.id);
    if (!l) continue;
    const sett = new Set();
    for (const q of l) if (q[2] === art && !sett.has(q[1])) { sett.add(q[1]); teller.set(q[1], (teller.get(q[1]) || 0) + 1); }
  }
  const fore = FORETRUKKET[enhet] || [];
  return [...teller.entries()].map(([navn, dekket]) => ({ navn, dekket }))
    .sort((a, b) => {
      const ia = fore.indexOf(a.navn), ib = fore.indexOf(b.navn);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b.dekket - a.dekket || a.navn.localeCompare(b.navn);
    });
}

// Summen av ett Qto-felt over radene. Elementer uten feltet får geometrien
// (Emil 12.10: «der Qto mangler, brukes geometrien automatisk»).
// avvik sammenligner BARE elementene som har feltet — ellers ville et halvt
// dekket felt sett ut som et stort avvik.
export function qtoSum(rader, qto, enhet, navn) {
  const art = QTO_ART[enhet];
  let sum = 0, dekket = 0, qDel = 0, gDel = 0;
  for (const r of (rader || [])) {
    const g = geoVerdi(r, enhet);
    // Et lagdelt element har én rad per materiale; fila oppgir tallet for HELE
    // elementet, så hver rad får sin andel (samme fordeling som geometrien).
    const q0 = qtoTall(qto, r.id, navn, art);
    const q = q0 === null ? null : (art === "areal" || art === "lengde" ? q0 : q0 * (r.lagAndel || 1));
    if (q !== null && isFinite(q)) { sum += q; dekket++; qDel += q; gDel += g; }
    else sum += g;
  }
  const avvik = dekket && gDel > 1e-12 ? qDel / gDel - 1 : (dekket && qDel > 1e-12 ? Infinity : null);
  return { sum, dekket, n: (rader || []).length, avvik };
}

// Alt panelet og Excel trenger om én post.
export function beregnPost(post, rader, qto) {
  const p = vaskPost(post);
  if (p.modus === "egen") {
    return { geo: p.mengdeEgen, n: 0, valg: [], qto: null, mengde: p.mengdeEgen, kilde: { art: "egen" }, brukerQto: false };
  }
  const geo = (rader || []).reduce((s, r) => s + geoVerdi(r, p.enhet), 0);
  const valg = qtoValg(rader, qto, p.enhet);
  let qtoInfo = null, brukerQto = false;
  const valgtNavn = p.kilde.startsWith("qto:") ? p.kilde.slice(4) : "";
  const vis = valgtNavn || (valg[0] && valg[0].navn) || "";
  if (vis && p.enhet !== "stk") {
    qtoInfo = Object.assign({ navn: vis }, qtoSum(rader, qto, p.enhet, vis));
    if (!qtoInfo.dekket) qtoInfo = valgtNavn ? qtoInfo : null;
  }
  let mengde = geo, kilde = { art: p.enhet === "stk" ? "stk" : "geo" };
  if (valgtNavn && qtoInfo) {
    mengde = qtoInfo.sum; brukerQto = true;
    kilde = { art: "qto", navn: valgtNavn, dekket: qtoInfo.dekket, n: qtoInfo.n };
  }
  return { geo, n: (rader || []).length, valg, qto: qtoInfo, mengde, kilde, brukerQto };
}

// Kilden som tekst — i panelet og i Excel-kolonnen «Kilde»
export function kildeTekst(k, t) {
  const tr = typeof t === "function" ? t : (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
  const x = k || {};
  if (x.art === "egen") return tr("Egen mengde");
  if (x.art === "stk") return tr("Antall i modellen");
  if (x.art === "qto") return x.dekket < x.n
    ? tr("Fila: {0} ({1} av {2}, resten geometri)", x.navn, x.dekket, x.n)
    : tr("Fila: {0}", x.navn);
  return tr("Geometri");
}

// Fargen på avviket: grønt under 2 %, nøytralt opp til 5 %, gult over.
export function avvikKlasse(avvik) {
  if (avvik === null || avvik === undefined || Number.isNaN(avvik)) return "";
  const a = Math.abs(avvik);
  if (a < 0.02) return "ok";
  if (a <= 0.05) return "middels";
  return "hoy";
}

export function linjesum(mengde, pris, paaslag, felles) {
  if (pris === null || pris === undefined || !isFinite(pris)) return null;
  return (Number(mengde) || 0) * pris * (1 + (Number(paaslag) || 0) / 100) * (1 + (Number(felles) || 0) / 100);
}

// Forslag til enhet for ett materiale (når en markering deles per materiale)
export function enhetForMateriale(gruppe, type) {
  if (gruppe === "Betong" || gruppe === "Mur") return "m³";
  if (gruppe === "Stål" || gruppe === "Armering") return "kg";
  if (gruppe === "Isolasjon" || type === "SW" || type === "Takplate" || type === "Gulv") return "m²";
  if (type === "Blikk") return "lm";
  return "";
}

// Deler et utvalg per materiale: [{ mat: "m:<navn>", material, n }] — tomt når
// alt er samme materiale (da trengs ingen deling).
export function materialerIUtvalg(rader) {
  const m = new Map();
  for (const r of (rader || [])) { const k = r.material || ""; m.set(k, (m.get(k) || 0) + 1); }
  if (m.size < 2) return [];
  return [...m.entries()].map(([material, n]) => ({ mat: "m:" + material, material, n }));
}

// Postnummer: det du skrev, ellers løpenummer i lista (1, 2, 3 …)
export function postNr(post, i) { return (post && post.nr) || String(i + 1); }

// Hvor mange desimaler mengden vises og skrives med
export function mengdeDesimaler(enhet) { return enhet === "stk" ? 0 : enhet === "kg" ? 1 : enhet === "lm" ? 2 : 3; }
export function avrund(v, d) { const f = 10 ** d; return Math.round((Number(v) || 0) * f) / f; }

// ═══════════════════════ EXCEL ═══════════════════════
// Arket er lagt opp som prøvebildet Emil så 12.10:
//   rad 1–3  prosjektinfo        rad 4  felles påslag (H4, gul)
//   rad 6    overskrifter        rad 7… postene
//   Linjesum = Mengde × Enhetspris × (1 + Påslag/100) × (1 + $H$4/100)
//   så Sum eks. mva (SUM), mva 25 % og Sum inkl. mva — alt formler.
// Formlene skrives med PUNKTUM (0.25): i fila er formelspråket alltid
// engelsk, og Excel viser dem med komma for norske brukere.
// Stilene (indeks i xlsx.js STILER): 1 fet, 2 gul (fyll inn), 3 overskrift,
// 4 tall 2 des., 5 fet tall 2 des., 6 tittel, 7 gul tall 2 des.
export const KOL = { post: 0, tekst: 1, kilde: 2, mengde: 3, enhet: 4, pris: 5, paaslag: 6, sum: 7 };

function ref(kol, radNr) { return String.fromCharCode(65 + kol) + radNr; }   // A–H holder

export function excelArk(beregnede, oppsett, info, dato, modellNavn, t) {
  const tr = typeof t === "function" ? t : (s) => s;
  const i = info || {};
  const rader = [], stil = new Map();
  const sett = (r, k, s) => stil.set(r + "," + k, s);
  const tittel = tr("Priskalkulasjon") + (i.navn ? " — " + i.navn : "");
  rader.push([tittel]); sett(0, 0, 6);
  rader.push([tr("Prosjekt"), [i.nummer, i.navn].filter(Boolean).join(" "), "", tr("Byggherre"), i.byggherre || ""]);
  sett(1, 0, 1); sett(1, 3, 1);
  rader.push([tr("Dato"), dato || "", "", tr("Modell"), modellNavn || ""]);
  sett(2, 0, 1); sett(2, 3, 1);
  rader.push(["", "", "", "", "", "", tr("Felles påslag %"), Number((oppsett && oppsett.felles) || 0)]);
  sett(3, 6, 1); sett(3, 7, 2);
  rader.push([]);
  rader.push([tr("Post"), tr("Beskrivelse"), tr("Kilde"), tr("Mengde"), tr("Enhet"), tr("Enhetspris"), tr("Påslag %"), tr("Linjesum")]);
  for (let k = 0; k <= 7; k++) sett(5, k, 3);
  const forste = rader.length + 1;              // radnummer i Excel (1-basert)
  const felles = Number((oppsett && oppsett.felles) || 0);
  let sumVerdi = 0;
  (beregnede || []).forEach(({ post, b }, n) => {
    const r = rader.length + 1;
    const d = mengdeDesimaler(post.enhet);
    const mengde = avrund(b.mengde, d);
    // Svaret regnes av de SAMME tallene som står i cellene (avrundet mengde),
    // så det lagrede svaret og Excels eget alltid er like.
    const verdi = (linjesum(mengde, post.pris === null ? 0 : post.pris, post.paaslag, felles) || 0);
    sumVerdi += verdi;
    rader.push([
      postNr(post, n), post.tekst || "", kildeTekst(b.kilde, t),
      mengde, post.enhet,
      post.pris === null ? "" : post.pris,
      Number(post.paaslag) || 0,
      { formel: "=" + ref(KOL.mengde, r) + "*" + ref(KOL.pris, r) + "*(1+" + ref(KOL.paaslag, r) + "/100)*(1+$H$4/100)", verdi: avrund(verdi, 6) }
    ]);
    const ri = rader.length - 1;
    sett(ri, KOL.pris, 7); sett(ri, KOL.paaslag, 2); sett(ri, KOL.sum, 4);
  });
  const siste = rader.length;
  const sumRad = rader.length + 1;
  const tom = siste < forste;
  rader.push(["", tr("Sum eks. mva"), "", "", "", "", "", tom ? 0 : { formel: "=SUM(H" + forste + ":H" + siste + ")", verdi: avrund(sumVerdi, 6) }]);
  sett(sumRad - 1, 1, 1); sett(sumRad - 1, 7, 5);
  rader.push(["", tr("Mva 25 %"), "", "", "", "", "", { formel: "=H" + sumRad + "*0.25", verdi: avrund(sumVerdi * 0.25, 6) }]);
  sett(sumRad, 7, 4);
  rader.push(["", tr("Sum inkl. mva"), "", "", "", "", "", { formel: "=H" + sumRad + "+H" + (sumRad + 1), verdi: avrund(sumVerdi * 1.25, 6) }]);
  sett(sumRad + 1, 1, 1); sett(sumRad + 1, 7, 5);
  return { rader, stil: (r, k) => stil.get(r + "," + k) || 0, bredder: [8, 38, 30, 12, 7, 12, 16, 16], forste, siste, sumRad };
}

// ═══════════ HVORDAN TALLET BLE TIL (Emil 12.10) ═══════════
// «Går det an å få med i Kontroll mengder selve kalkulasjonen som ble brukt
// for å komme fram til svaret?» — Ja: hver post får en setning om HVOR
// mengden kommer fra, regnestykket for linjesummen med tallene satt inn, og
// et eget ark med hvert eneste element og hva det bidro med.
const nbTall = (v, d) => (Number(v) || 0).toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });
const ENHET_TEKST = {
  "m³": "volumet", "m²": "arealet (største flate)", "lm": "lengden", "kg": "vekten", "stk": "antallet"
};
export function mengdeForklaring(post, b, tr) {
  const t2 = typeof tr === "function" ? tr : (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
  const k = b.kilde || {};
  if (k.art === "egen") return t2("Mengden er skrevet inn for hånd.");
  if (k.art === "stk") return t2("Antall objekter i posten ({0} stk).", b.n);
  if (k.art === "qto") return t2("Tallet «{0}» fra IFC-fila for {1} av {2} elementer; resten fra 3D-geometrien. Summert.", k.navn, k.dekket, k.n);
  const hva = {
    "m³": t2("Volumet av hvert element, målt i 3D-geometrien (SW, gulv og materiell: lengde × høyde/bredde × tykkelse). Lagdelte elementer: volumet fordelt etter lagtykkelse."),
    "m²": t2("Største flate per element (veggside, dekkets overside, plate L × B). Summert."),
    "lm": t2("Lengden av hvert element (lengste mål). Summert."),
    "kg": t2("Stål: kg/m fra profiltabellen × lengde. Ellers volum × tetthet (betong 2400, stål 7850 kg/m³). Summert.")
  }[post.enhet];
  return (hva || "") + " " + t2("{0} elementer.", b.n);
}
export function utregningTekst(post, b, felles, tr) {
  const t2 = typeof tr === "function" ? tr : (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
  const d = mengdeDesimaler(post.enhet);
  const mengde = avrund(b.mengde, d);
  if (post.pris === null) return t2("Pris mangler");
  const sum = linjesum(mengde, post.pris, post.paaslag, felles) || 0;
  return nbTall(mengde, d) + " " + post.enhet + " × " + nbTall(post.pris, 2) + " kr × (1 + " + nbTall(post.paaslag || 0, 1) +
    " %) × (1 + " + nbTall(felles || 0, 1) + " %) = " + nbTall(sum, 2) + " kr";
}

// Hva ett element bidro med, og hvordan
function elementForklaring(r, enhet, qNavn, qVerdi) {
  const m = (v) => nbTall(v, 3);
  if (qVerdi !== null && qVerdi !== undefined) return "IFC-fila: " + qNavn;
  const lag = r.lagAndel ? " × lag " + nbTall(r.lagAndel * 100, 0) + " %" : "";
  const param = /^(SW|Ringmur|Gulv|Takplate|Blikk|Materiell)$/.test(r.type || "");
  if (enhet === "m³") return param ? m(r.L) + " × " + m(r.B) + " × " + m(r.H) + " m" : "3D-volum" + lag;
  if (enhet === "m²") return param ? m(r.L) + " × " + m(r.B) + " m" : "Største flate (3D)";
  if (enhet === "lm") return "Lengde";
  if (enhet === "kg") {
    if (r.vektKilde === "tabell" || r.vektKilde === "formel") return nbTall(r.nomKgPerM, 2) + " kg/m × " + m(r.len) + " m (" + (r.profil || "profil") + ")";
    if (r.vektKilde === "geometri") return "3D-volum" + lag + " × tetthet";
    return "Ingen vekt";
  }
  return "1 stk";
}

// Ark 2: kontrollen — geometri mot fila, per post, og hvordan tallene ble til.
export function kontrollArk(beregnede, t, felles) {
  const tr = typeof t === "function" ? t : (s) => s;
  const rader = [[tr("Post"), tr("Beskrivelse"), tr("Enhet"), tr("Elementer"), tr("Geometri"), tr("Felt i fila"), tr("Fila"), tr("Dekket"), tr("Avvik %"), tr("Brukt i kalkylen"), tr("Slik er mengden regnet"), tr("Utregning av linjesum")]];
  const stil = new Map();
  for (let k = 0; k < 12; k++) stil.set("0," + k, 3);
  (beregnede || []).forEach(({ post, b }, n) => {
    const d = mengdeDesimaler(post.enhet);
    const q = b.qto;
    rader.push([
      postNr(post, n), post.tekst || "", post.enhet, b.n,
      avrund(b.geo, d),
      q ? q.navn : "",
      q ? avrund(q.sum, d) : "",
      q ? q.dekket + "/" + q.n : "",
      q && q.avvik !== null && isFinite(q.avvik) ? avrund(q.avvik * 100, 1) : "",
      b.brukerQto ? tr("Fila") : b.kilde && b.kilde.art === "egen" ? tr("Egen mengde") : b.kilde && b.kilde.art === "stk" ? tr("Antall i modellen") : tr("Geometri"),
      mengdeForklaring(post, b, t),
      utregningTekst(post, b, felles, t)
    ]);
  });
  return { rader, stil: (r, k) => stil.get(r + "," + k) || 0, bredder: [8, 38, 7, 10, 12, 18, 12, 9, 9, 16, 70, 60] };
}

// Ark 3: hvert element i hver post, og hva det bidro med. Summen per post
// står nederst i posten og er lik mengden i ark 1.
export function elementArk(beregnede, qto, t) {
  const tr = typeof t === "function" ? t : (s) => s;
  const rader = [[tr("Post"), tr("Element"), tr("Type"), tr("Materiale"), "L (m)", "B (m)", "H (m)", tr("Bidrag"), tr("Enhet"), tr("Slik")]];
  const stil = new Map();
  for (let k = 0; k < 10; k++) stil.set("0," + k, 3);
  (beregnede || []).forEach(({ post, rader: elementer, b }, n) => {
    if (post.modus === "egen") return;
    const d = mengdeDesimaler(post.enhet);
    const art = QTO_ART[post.enhet];
    const qNavn = b.kilde && b.kilde.art === "qto" ? b.kilde.navn : "";
    for (const r of (elementer || [])) {
      let qv = null;
      if (qNavn) {
        const q0 = qtoTall(qto, r.id, qNavn, art);
        if (q0 !== null) qv = art === "areal" || art === "lengde" ? q0 : q0 * (r.lagAndel || 1);
      }
      const bidrag = qv !== null ? qv : geoVerdi(r, post.enhet);
      rader.push([postNr(post, n), r.name || r.objType || String(r.id), r.type || "", r.material || "",
        avrund(r.L, 3), avrund(r.B, 3), avrund(r.H, 3), avrund(bidrag, d), post.enhet, elementForklaring(r, post.enhet, qNavn, qv)]);
    }
    const ri = rader.length;
    rader.push([postNr(post, n), tr("Sum") + " — " + (post.tekst || ""), "", "", "", "", "", avrund(b.mengde, d), post.enhet, ""]);
    stil.set(ri + ",1", 1); stil.set(ri + ",7", 1);
    rader.push([]);
  });
  return { rader, stil: (r, k) => stil.get(r + "," + k) || 0, bredder: [8, 40, 14, 22, 9, 9, 9, 12, 7, 42] };
}

export function filnavn(info, modellNavn, dato) {
  const del = [String((info && info.nummer) || "").trim(), String((info && info.navn) || "").trim()].filter(Boolean).join(" ") ||
    String(modellNavn || "modell").replace(/\.(ifc|glb)$/i, "");
  return ("Priskalkulasjon " + del + " " + (dato || "")).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() + ".xlsx";
}

// ═══════════════════════ LASTET LISTE + ULAGREDE ENDRINGER ═══════════════════════
// Prislista hentes på nytt fra SharePoint når panelet åpnes (en kollega kan ha
// endret den). Rakk brukeren å endre noe som ikke er skrevet ennå — mens
// hentingen var ute, eller fordi skrivingen feilet — skal det IKKE forsvinne:
// ulagrede poster (skitne) står over det som kom, og poster som er slettet her
// men ikke skrevet (gravsteiner), kommer ikke tilbake. De skitne skrives med
// ferskt `endret` ved neste lagring, så de vinner flettingen også i SharePoint.
export function flettLastet(liste, lokalePoster, lokaltOppsett, skitne, gravsteiner) {
  const d = fraLagret(liste);
  const sk = skitne instanceof Set ? skitne : new Set(skitne || []);
  const grav = new Set(gravsteiner || []);
  const lokale = new Map((lokalePoster || []).map(p => [p.id, p]));
  const ut = d.poster.filter(p => !grav.has(p.id)).map(p => (sk.has(p.id) && lokale.has(p.id)) ? lokale.get(p.id) : p);
  const finnes = new Set(ut.map(p => p.id));
  for (const p of (lokalePoster || [])) if (sk.has(p.id) && !finnes.has(p.id)) ut.push(p);
  ut.sort((a, b) => a.rekke - b.rekke || a.id.localeCompare(b.id));
  return { poster: ut, oppsett: sk.has(OPPSETT_ID) && lokaltOppsett ? lokaltOppsett : d.oppsett };
}
