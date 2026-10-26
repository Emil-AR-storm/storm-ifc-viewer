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
  l.push("", "Mengdene er beregnet fra 3D-modellen og er et anslag, ikke oppmål.");
  if (o.oppdaget) l.push("Endringen ble oppdaget " + o.oppdaget + ".");
  l.push("", "Hjemmel: [fyll inn punkt fra NS 84xx]");
  return l.join("\n");
}

// Ordrelinjer til felt «okonomi» (sjekkliste.js vaskLinje-formen). Linjer
// uten pris tas med med pris 0, så ingenting forsvinner stille.
export function ordrelinjer(linjer) {
  return (linjer || []).map(l => ({
    produkt: (l.navn + (l.undertekst ? " " + l.undertekst : "") + (l.pris == null ? " (mangler pris)" : "")).slice(0, 120),
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
