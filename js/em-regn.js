// 📝 ENDRINGSMELDING FRA MODELLEN — den rene regningen (byggeplan runde 3,
// verktøy 2; bygget 26.10.2026, Emils valg A: sidepanel med tre steg).
//
// Inn: et Sammenlign-resultat ({ ny, slettet, endret }) eller et utvalg
// elementer. Ut: én linje per IFC-type med antall nye/slettede/endrede,
// mengdeendring i valgt enhet, pris fra Priskalkulasjon og sum — pluss
// tekstene som går inn i EM-skjemaet (endringsmelding-v1).
//
// Ingen DOM, ingen three.js, ingen S — _test/test-em.mjs kjører alt direkte.
//
// MENGDENE ER MODELLMENGDER. Lengde er boksens lengste side, areal de to
// lengste, volum er geometriens volum (quantitiesForSet) og kg er volum ×
// 7 850 for stål. Det er et ANSLAG til et varsel, ikke et oppmål — og det står
// i begrunnelsen som går til byggherren.

export const EM_ENHETER = ["lm", "m²", "m³", "stk", "kg"];
export const STAAL_KG_M3 = 7850;

// Standard enhet per IFC-type (kan endres per linje i panelet)
const STANDARD = {
  ifccolumn: "lm", ifcbeam: "lm", ifcmember: "lm", ifcpile: "lm", ifcrailing: "lm",
  ifcslab: "m²", ifcwall: "m²", ifcwallstandardcase: "m²", ifcroof: "m²", ifccovering: "m²",
  ifccurtainwall: "m²", ifcstair: "stk", ifcfooting: "m³",
  ifcreinforcingbar: "kg", ifcreinforcingmesh: "kg", ifctendon: "kg"
};
export const typeNokkel = (t) => String(t || "").trim().toLowerCase();
export function standardEnhet(type) { return STANDARD[typeNokkel(type)] || "stk"; }

// «IFCCOLUMN» / «IfcColumn» → «Søyle» o.l. Ukjent: typen uten «Ifc».
const NAVN = {
  ifccolumn: "Søyle", ifcbeam: "Bjelke", ifcmember: "Stav", ifcslab: "Dekke", ifcwall: "Vegg",
  ifcwallstandardcase: "Vegg", ifcplate: "Plate", ifcfooting: "Fundament", ifcpile: "Pel",
  ifcroof: "Tak", ifcstair: "Trapp", ifcrailing: "Rekkverk", ifcdoor: "Dør", ifcwindow: "Vindu",
  ifccovering: "Kledning", ifccurtainwall: "Glassfasade", ifcreinforcingbar: "Armering",
  ifcreinforcingmesh: "Armeringsnett", ifcmechanicalfastener: "Festemiddel", ifcbuildingelementproxy: "Annet"
};
export function typeNavn(type) {
  const k = typeNokkel(type);
  return NAVN[k] || String(type || "").replace(/^ifc/i, "") || "Ukjent";
}

// Mengden for ÉTT element i en enhet. e = { d:[x,y,z] (modellenheter), v (m³) }
export function mengdeFor(e, enhet, toM) {
  const s = Number(toM) || 1;
  const d = (Array.isArray(e && e.d) ? e.d : [0, 0, 0]).map(x => Math.abs(Number(x) || 0) * s).sort((a, b) => b - a);
  const v = Math.abs(Number(e && e.v) || 0);
  switch (enhet) {
    case "lm": return d[0];
    case "m²": return d[0] * d[1];
    case "m³": return v;
    case "kg": return v * STAAL_KG_M3;
    default: return 1;
  }
}

// Sammenlign-resultat → linjer per type. enheter = { [typeNokkel]: enhet }
// (brukerens valg per linje); mangler den, brukes standardEnhet.
export function mengdeDiff(res, o) {
  const opt = o || {}, toM = Number(opt.toM) || 1, valgt = opt.enheter || {};
  const per = new Map();
  const linje = (type) => {
    const k = typeNokkel(type) || "ukjent";
    if (!per.has(k)) per.set(k, { key: k, type: type || "", navn: typeNavn(type), enhet: valgt[k] || standardEnhet(type),
      ny: 0, slettet: 0, endret: 0, mengde: 0, ider: [], navnSett: new Map() });
    return per.get(k);
  };
  const tellNavn = (l, n) => { const x = String(n || "").split(":")[0].trim(); if (x) l.navnSett.set(x, (l.navnSett.get(x) || 0) + 1); };
  for (const e of (res && res.ny) || []) { const l = linje(e.type); l.ny++; l.mengde += mengdeFor(e, l.enhet, toM); if (e.id != null) l.ider.push(e.id); tellNavn(l, e.name); }
  for (const e of (res && res.slettet) || []) { const l = linje(e.type); l.slettet++; l.mengde -= mengdeFor(e, l.enhet, toM); tellNavn(l, e.name); }
  for (const e of (res && res.endret) || []) {
    const l = linje(e.type); l.endret++;
    const fra = e.fra || {};
    // stk teller ikke endrede: én søyle som blir lengre er fortsatt én søyle
    if (l.enhet !== "stk") l.mengde += mengdeFor(e, l.enhet, toM) - mengdeFor(fra, l.enhet, toM);
    if (e.id != null) l.ider.push(e.id); tellNavn(l, e.name);
  }
  return [...per.values()].map(l => {
    const navn = [...l.navnSett.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    delete l.navnSett;
    return Object.assign(l, { undertekst: navn.slice(0, 2).join(", ") + (navn.length > 2 ? " …" : ""), mengde: avrund(l.mengde, l.enhet) });
  }).filter(l => l.ny || l.slettet || l.endret)
    .sort((a, b) => a.navn.localeCompare(b.navn, "no"));
}

export function avrund(v, enhet) {
  const d = enhet === "stk" ? 0 : enhet === "kg" ? 0 : enhet === "lm" ? 2 : enhet === "m²" ? 2 : 3;
  const f = 10 ** d; return Math.round((Number(v) || 0) * f) / f;
}

// Pris fra Priskalkulasjon: første post med samme type OG enhet som har pris.
// Påslaget i posten tas med — det er Storms pris ut, ikke kostpris.
export function prisFor(type, enhet, poster) {
  const k = typeNokkel(type);
  const p = (poster || []).find(x => x && !x.slettet && typeNokkel(x.type) === k && x.enhet === enhet && x.pris != null && isFinite(x.pris));
  if (!p) return null;
  return Math.round(Number(p.pris) * (1 + (Number(p.paaslag) || 0) / 100) * 100) / 100;
}

// Legger pris og sum på linjene. egne = { [key]: pris } (skrevet i panelet) vinner.
export function prisAnslag(linjer, poster, egne) {
  const e = egne || {};
  return (linjer || []).map(l => {
    const pris = e[l.key] != null && e[l.key] !== "" && isFinite(Number(e[l.key])) ? Number(e[l.key]) : prisFor(l.type, l.enhet, poster);
    return Object.assign({}, l, { pris, sum: pris == null ? null : Math.round(l.mengde * pris) });
  });
}
export function sumAnslag(linjer, med) {
  const valgt = (linjer || []).filter(l => !med || med(l));
  return { sum: valgt.reduce((s, l) => s + (l.sum || 0), 0), manglerPris: valgt.filter(l => l.pris == null).length };
}

// Tall i norsk form: 12,4 · −15 620
export function tallTekst(v, d) {
  const n = Number(v) || 0, s = n < 0 ? "−" : "";
  const [h, des] = Math.abs(n).toFixed(d == null ? 0 : d).split(".");
  return s + h.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (des && Number(des) ? "," + des.replace(/0+$/, "") : "");
}
export const mengdeTekst = (l) => (l.mengde > 0 ? "+" : "") + tallTekst(l.mengde, l.enhet === "stk" || l.enhet === "kg" ? 0 : 2) + " " + l.enhet;

// Teksten til «Begrunnelse» (felt 1.3). Fakta, ikke vurdering — hvorfor det
// er en endring og hjemmelen skriver brukeren selv (samme regel som i
// sjekkliste.js faktablokk).
export function faktablokk(linjer, k) {
  const o = k || {};
  const l = [];
  if (o.fra || o.til) l.push("Modellrevisjon " + (o.til || "ny") + " mot " + (o.fra || "forrige") + (o.metode ? " (sammenlignet på " + o.metode + ")" : "") + ":");
  else if (o.utvalg) l.push("Valgte elementer i modellen " + (o.modell || "") + ":");
  for (const x of linjer || []) {
    const deler = [];
    if (x.ny) deler.push("+" + x.ny + " ny" + (x.ny > 1 ? "e" : ""));
    if (x.slettet) deler.push("−" + x.slettet + " fjernet");
    if (x.endret) deler.push(x.endret + " endret");
    l.push("• " + x.navn + (x.undertekst ? " (" + x.undertekst + ")" : "") + ": " + deler.join(", ") + " → " + mengdeTekst(x));
  }
  if (o.nyId) l.push("", o.nyId + (o.nyId === 1 ? " element har" : " elementer har") + " fått ny GlobalId i modellen, men er samme element på samme sted. De er kontrollert og ikke priset (se vedlegg).");
  l.push("", "Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål.");
  if (o.oppdaget) l.push("Endringen ble oppdaget " + o.oppdaget + ".");
  l.push("", "Hjemmel: [fyll inn punkt fra NS 84xx]");
  return l.join("\n");
}

// Ordrelinjer til felt «okonomi» (sjekkliste.js vaskLinje-formen). Linjer
// uten pris tas med med pris 0, så ingenting forsvinner stille.
export function ordrelinjer(linjer) {
  return (linjer || []).map(l => ({
    // Ikke «(mangler pris)» i navnet: det ble stående i PDF-en etter at prisen
    // var fylt inn i skjemaet (Emils test 26.10). Panelet viser hva som mangler.
    produkt: (l.navn + (l.undertekst ? " " + l.undertekst : "")).slice(0, 120),
    antall: l.mengde, enhet: l.enhet, enhetspris: l.pris == null ? 0 : l.pris, paslag: 0, mva: 25
  }));
}

// Excel: én rad per linje + sum
export function excelRader(linjer, k) {
  const o = k || {};
  const rader = [["Type", "Elementer", "Ny", "Fjernet", "Endret", "Mengdeendring", "Enhet", "Pris (kr/enhet)", "Sum (kr eks. mva)"]];
  for (const l of linjer || []) rader.push([l.navn, l.undertekst || "", l.ny, l.slettet, l.endret, l.mengde, l.enhet, l.pris == null ? "mangler pris" : l.pris, l.sum == null ? "" : l.sum]);
  const s = sumAnslag(linjer);
  rader.push([], ["Prisanslag (eks. mva)", "", "", "", "", "", "", "", s.sum]);
  if (o.fra || o.til) rader.push(["Revisjon " + (o.til || "") + " mot " + (o.fra || "")]);
  rader.push(["Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål."]);
  return rader;
}

// Frist etter Storms EM-flyt: oppdaget + 3 dager (kan endres i panelet)
export function emFrist(oppdagetISO, dager) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(oppdagetISO || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(dager) || 3)));
  return d.toISOString().slice(0, 10);
}

// Midtpunkt for markeringen: snittet av elementsentrene (nye/endrede fra
// boksene i modellen, slettede fra avtrykket).
export function senter(punkter) {
  const p = (punkter || []).filter(x => Array.isArray(x) && x.length === 3 && x.every(isFinite));
  if (!p.length) return null;
  return p.reduce((s, x) => [s[0] + x[0] / p.length, s[1] + x[1] / p.length, s[2] + x[2] / p.length], [0, 0, 0]);
}

// ═══════════ 🔒 Intern EM-liste og bildesider (Emil 26.10: PDF C, lagring A) ═══════════
// EM-ene er IKKE markeringer lenger. Markeringer reiser ut til byggeplassen
// (byggeplass.js → <fil>.markeringer.json), og en endringsmelding med priser og
// bilder skal bare finnes på kontoret. De lagres i SharePoint-mappa
// «Endringsmeldinger», én fil per prosjekt, som Workeren aldri ser.

// Statusene: Opprettet → Sendt → Fullført (Godkjent eller Avvist)
export const EM_STATUS = ["opprettet", "sendt", "godkjent", "avvist"];
export const STATUS_NAVN = { opprettet: "Opprettet", sendt: "Sendt", godkjent: "Fullført · godkjent", avvist: "Fullført · avvist" };
export const erFullfort = (s) => s === "godkjent" || s === "avvist";
// Filteret i lista: «fullført» dekker begge svarene
export function iFilter(em, filter) {
  if (!filter || filter === "alle") return true;
  if (filter === "fullfort") return erFullfort(em.status);
  return em.status === filter;
}
export function filtrerEm(liste, o) {
  const opt = o || {}, sok = String(opt.sok || "").trim().toLowerCase();
  return (liste || []).filter(e => e && !e.slettet && iFilter(e, opt.filter) &&
    (!sok || (String(e.nr || "") + " " + String(e.tittel || "")).toLowerCase().includes(sok)))
    .sort((a, b) => String(b.laget || "").localeCompare(String(a.laget || "")));
}
export function tellStatus(liste) {
  const n = { alle: 0, opprettet: 0, sendt: 0, fullfort: 0 };
  for (const e of liste || []) {
    if (!e || e.slettet) continue;
    n.alle++;
    if (erFullfort(e.status)) n.fullfort++; else if (n[e.status] != null) n[e.status]++;
  }
  return n;
}
// Sum av det som fortsatt venter på svar (opprettet + sendt)
export function sumApne(liste) {
  return (liste || []).filter(e => e && !e.slettet && !erFullfort(e.status)).reduce((s, e) => s + (Number(e.sum) || 0), 0);
}

// Fila: prosjektnummeret hvis det finnes, ellers modellnavnet
export function emFil(prosjektNr, modellFil) {
  const ren = (s) => String(s || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-").trim().slice(0, 80);
  const n = ren(prosjektNr) || ren(modellFil) || "uten-prosjekt";
  return n + ".endringsmeldinger.json";
}

// Aksen et punkt står på. akser = S.akseLinjer: { x:[{c,navn}] (tallakser),
// z:[{c,navn}] (bokstavakser), tol }. «B3» på aksekrysset, «B–C/3» mellom.
export function akseFor(c, akser) {
  if (!akser || !Array.isArray(c)) return "";
  const del = (liste, v) => {
    const l = (liste || []).filter(a => a && isFinite(a.c)).slice().sort((a, b) => a.c - b.c);
    if (!l.length || !isFinite(v)) return "";
    const tol = Number(akser.tol) || 0;
    let best = l[0];
    for (const a of l) if (Math.abs(a.c - v) < Math.abs(best.c - v)) best = a;
    if (Math.abs(best.c - v) <= tol) return String(best.navn);
    const i = l.findIndex(a => a.c > v);
    if (i <= 0) return (i === 0 ? "<" + l[0].navn : ">" + l[l.length - 1].navn);
    return l[i - 1].navn + "–" + l[i].navn;
  };
  const z = del(akser.z, c[2]), x = del(akser.x, c[0]);
  if (!z && !x) return "";
  // Utenfor aksene: nærmeste akse og «utenfor» — ikke «<A/>6» (Emils test 26.10)
  if (/[<>]/.test(z + x)) {
    const zz = z.replace(/[<>]/g, ""), xx = x.replace(/[<>]/g, "");
    return (/–/.test(zz + xx) ? [zz, xx].filter(Boolean).join("/") : zz + xx) + " (utenfor)";
  }
  const enkel = (s) => !/[–<>]/.test(s);
  return (z && x && enkel(z) && enkel(x)) ? z + x : [z, x].filter(Boolean).join("/");
}

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const pkt = (a) => Array.isArray(a) ? a.slice(0, 3).map(r3) : null;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const retn = (r) => (Array.isArray(r) && r.length === 3 && r.every(x => isFinite(Number(x)))) ? r.map(x => Math.round(Number(x) * 1e5) / 1e5) : null;
export const kortGuid = (g) => { const s = String(g || ""); return s.length > 10 ? s.slice(0, 4) + "…" + s.slice(-3) : s; };
export const MAKS_ELEMENTER = 400;   // per endring i fila — resten telles

// Én «endring» per linje (elementtype) som er krysset av: elementene med hva
// som skjedde, aksen, mengden i linjas enhet, og boksene til bildene/planen.
export function endringerFra(res, linjer, o) {
  const opt = o || {}, toM = Number(opt.toM) || 1;
  return (linjer || []).map(l => {
    const av = (e) => (typeNokkel(e.type) || "ukjent") === l.key;
    const el = [];
    const legg = (e, hva) => {
      let m;
      if (hva === "fjernet") m = -mengdeFor(e, l.enhet, toM);
      else if (hva === "endret") m = l.enhet === "stk" ? null : mengdeFor(e, l.enhet, toM) - mengdeFor(e.fra || {}, l.enhet, toM);
      else m = mengdeFor(e, l.enhet, toM);
      el.push({ hva, id: e.id != null ? e.id : null, navn: String(e.name || "").slice(0, 80), guid: String(e.guid || ""),
        akse: akseFor(e.c, opt.akser), mengde: m == null ? null : avrund(m, l.enhet),
        c: pkt(e.c), d: pkt(e.d), fc: e.fra ? pkt(e.fra.c) : null, fd: e.fra ? pkt(e.fra.d) : null,
        // 🔍 detaljene (em-detalj.js): retning, lengde, volum og navnet før
        r: retn(e.r), L: r3(e.L), v: r6(e.v),
        fr: e.fra ? retn(e.fra.r) : null, fL: e.fra ? r3(e.fra.L) : 0, fv: e.fra ? r6(e.fra.v) : 0,
        nf: e.fra ? String(e.fra.name || "").slice(0, 80) : "" });
    };
    const nyHva = opt.utvalg ? "valgt" : "ny";
    for (const e of (res && res.slettet) || []) if (av(e)) legg(e, "fjernet");
    for (const e of (res && res.ny) || []) if (av(e)) legg(e, nyHva);
    for (const e of (res && res.endret) || []) if (av(e)) legg(e, "endret");
    const deler = [];
    if (opt.utvalg) deler.push(l.ny + " valgt");
    else {
      if (l.slettet) deler.push(l.slettet + " fjernet");
      if (l.ny) deler.push(l.ny + " ny" + (l.ny > 1 ? "e" : ""));
      if (l.endret) deler.push(l.endret + " endret");
    }
    const nyId = nyIdFor(res, opt, (e) => (typeNokkel(e.type) || "ukjent") === l.key);
    return { key: l.key, navn: l.navn, undertekst: l.undertekst || "", enhet: l.enhet,
      oppsummering: deler.join(" · ") + " → " + mengdeTekst(l) + (nyId.length ? " · " + nyId.length + " samme element med ny ID (ikke priset)" : ""),
      antall: el.length, elementer: el.slice(0, MAKS_ELEMENTER), bilder: { for: "", etter: "" }, nyId };
  });
}

// 🔗 «Samme element, ny ID» (em-paring.js) i kort form: navn, akse, GlobalId før → etter, grunn
export function nyIdFor(res, o, filter) {
  return ((res && res.uendretNyId) || []).filter(p => p && p.til && (!filter || filter(p.til))).slice(0, MAKS_ELEMENTER).map(p => ({
    navn: String(p.til.name || "").slice(0, 80), type: String(p.til.type || ""), akse: akseFor(p.til.c, o && o.akser),
    gf: String(p.fra.guid || ""), gt: String(p.til.guid || ""), grunn: p.grunn === "revit" ? "revit" : "sted",
    nr: p.grunn === "revit" ? (/:(\d{4,})\s*$/.exec(String(p.til.name || "")) || [])[1] || "" : "" }));
}
// Typene som bare har elementer med ny ID (ingen ekte endring) — de har ingen
// egen endringsside, men skal likevel stå i PDF-en (Emil 26.10: «ja det skal det»)
export function nyIdUtenEndring(res, endringer, o) {
  const har = new Set((endringer || []).map(e => e.key));
  return nyIdFor(res, o, (e) => !har.has(typeNokkel(e.type) || "ukjent"));
}

// Mengden i tabellen på bildesida
export function elementMengde(e, enhet) {
  if (e.hva === "endret" && !e.mengde) return "endret";
  if (e.mengde == null) return "";
  const d = enhet === "stk" || enhet === "kg" ? 0 : 2;
  return (e.mengde > 0 && e.hva !== "valgt" ? "+" : "") + tallTekst(e.mengde, d) + " " + enhet;
}

// Utsnittet i planen ovenfra (x mot høyre, z nedover): alle fotavtrykk
// (også det gamle til endrede), med litt luft rundt.
export function planUtsnitt(elementer) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const ta = (c, d) => {
    if (!c || !d) return;
    x0 = Math.min(x0, c[0] - d[0] / 2); x1 = Math.max(x1, c[0] + d[0] / 2);
    z0 = Math.min(z0, c[2] - d[2] / 2); z1 = Math.max(z1, c[2] + d[2] / 2);
  };
  for (const e of elementer || []) { ta(e.c, e.d); ta(e.fc, e.fd); }
  if (!isFinite(x0)) return null;
  const luft = Math.max(x1 - x0, z1 - z0) * 0.18 || 1;
  return { x0: x0 - luft, x1: x1 + luft, z0: z0 - luft, z1: z1 + luft };
}

// Vask av en EM-post fra SharePoint: bare kjente felt, tekst er tekst
const tekst = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, n || 200);
const tall = (v) => (v == null || v === "" || !isFinite(Number(v))) ? null : Number(v);
const trePkt = (a) => (Array.isArray(a) && a.length === 3 && a.every(x => isFinite(Number(x)))) ? a.map(Number) : null;
export function vaskEm(r) {
  if (!r || typeof r !== "object" || !r.id) return null;
  const ut = {
    id: tekst(r.id, 60), nr: tekst(r.nr, 30), tittel: tekst(r.tittel, 120),
    status: EM_STATUS.includes(r.status) ? r.status : "opprettet",
    laget: tekst(r.laget, 30), av: tekst(r.av, 80), oppdaget: tekst(r.oppdaget, 10), frist: tekst(r.frist, 10),
    sum: tall(r.sum), manglerPris: Math.max(0, Math.round(tall(r.manglerPris) || 0)),
    modell: tekst(r.modell, 160), fra: tekst(r.fra, 160), til: tekst(r.til, 160), metode: tekst(r.metode, 30),
    utvalg: r.utvalg === true, toM: tall(r.toM) || 1,
    endret: tekst(r.endret, 30), slettet: r.slettet === true,
    historikk: (Array.isArray(r.historikk) ? r.historikk : []).slice(-50).map(h => ({ tid: tekst(h && h.tid, 30), av: tekst(h && h.av, 80), hva: tekst(h && h.hva, 120) })),
    akser: null, endringer: [], nyIdAndre: vaskNyId(r.nyIdAndre), skjema: (r.skjema && typeof r.skjema === "object") ? r.skjema : null
  };
  if (r.akser && typeof r.akser === "object") {
    const a = (l) => (Array.isArray(l) ? l : []).slice(0, 80).filter(x => x && isFinite(Number(x.c))).map(x => ({ c: Number(x.c), navn: tekst(x.navn, 6) }));
    ut.akser = { x: a(r.akser.x), z: a(r.akser.z), tol: tall(r.akser.tol) || 0 };
  }
  ut.endringer = (Array.isArray(r.endringer) ? r.endringer : []).slice(0, 40).map(e => ({
    key: tekst(e && e.key, 60), navn: tekst(e && e.navn, 60), undertekst: tekst(e && e.undertekst, 120),
    enhet: EM_ENHETER.includes(e && e.enhet) ? e.enhet : "stk", oppsummering: tekst(e && e.oppsummering, 160),
    antall: Math.max(0, Math.round(tall(e && e.antall) || 0)),
    bilder: { for: bildeNavnOk(e && e.bilder && e.bilder.for), etter: bildeNavnOk(e && e.bilder && e.bilder.etter) },
    nyId: vaskNyId(e && e.nyId),
    elementer: (Array.isArray(e && e.elementer) ? e.elementer : []).slice(0, MAKS_ELEMENTER).map(x => ({
      hva: ["ny", "fjernet", "endret", "valgt"].includes(x && x.hva) ? x.hva : "ny",
      id: tall(x && x.id), navn: tekst(x && x.navn, 80), guid: tekst(x && x.guid, 40), akse: tekst(x && x.akse, 20),
      mengde: tall(x && x.mengde), c: trePkt(x && x.c), d: trePkt(x && x.d), fc: trePkt(x && x.fc), fd: trePkt(x && x.fd),
      r: trePkt(x && x.r), L: tall(x && x.L) || 0, v: tall(x && x.v) || 0,
      fr: trePkt(x && x.fr), fL: tall(x && x.fL) || 0, fv: tall(x && x.fv) || 0, nf: tekst(x && x.nf, 80)
    }))
  }));
  return ut;
}
// Bildene ligger i samme mappe, med navn vi selv har laget — alt annet avvises
function vaskNyId(l) {
  return (Array.isArray(l) ? l : []).slice(0, MAKS_ELEMENTER).map(x => ({ navn: tekst(x && x.navn, 80), type: tekst(x && x.type, 60),
    akse: tekst(x && x.akse, 24), gf: tekst(x && x.gf, 40), gt: tekst(x && x.gt, 40), grunn: x && x.grunn === "revit" ? "revit" : "sted", nr: tekst(x && x.nr, 12) }));
}
export function bildeNavnOk(n) { const s = String(n || ""); return /^em-[a-z0-9-]{4,60}\.jpg$/i.test(s) ? s : ""; }
export function bildeFil(emId, i, hva) { return "em-" + String(emId).replace(/[^a-z0-9-]/gi, "").slice(0, 40) + "-" + (i + 1) + "-" + (hva === "for" ? "for" : "etter") + ".jpg"; }

// Excel: oversikten over alle EM-ene i lista
export function oversiktRader(liste) {
  const rader = [["EM-nr", "Tittel", "Status", "Laget", "Av", "Frist", "Endringer", "Elementer", "Prisanslag (kr eks. mva)"]];
  for (const e of filtrerEm(liste, {})) rader.push([e.nr, e.tittel, STATUS_NAVN[e.status] || e.status, String(e.laget || "").slice(0, 10), e.av, e.frist,
    e.endringer.length, e.endringer.reduce((s, x) => s + (x.antall || 0), 0), e.sum == null ? "" : e.sum]);
  rader.push([], ["Sum åpne (opprettet + sendt)", "", "", "", "", "", "", "", sumApne(liste)]);
  return rader;
}
