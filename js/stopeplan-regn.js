// 🧱 Støpeplan i 3D — REGNINGEN (ren, testes i Node uten nettleser).
//
// Byggeplan: «Storm IFC-Viewer byggeplan Stopeplan 3D 2026-09-30.md» (variant C
// valgt av Emil: felt på plata OG elementer i samme plan). Denne fila har det
// som ikke trenger three.js eller DOM: vasking av det som kommer fra SharePoint
// og byggeplass-lenka, nye etapper, fargene, statusen og sorteringen.
//
// TRINN 1 dekker etappene selv (navn, dato, farge, status). Felt, elementer og
// vanntetting kommer i trinn 2, 3 og 6; feltene for dem vaskes allerede her,
// så en fil lagret av en nyere utgave ikke mister dem hos en eldre.

// Fargene fra støpeplanene Emil har laget (Pour Sequence Sone 1B, 23.09):
// Pour 1 blå, 2 lilla, 3 oransje, 4 teal, 5 rosa. Rødt er med vilje IKKE med —
// rødt er hovedhandlingen og HOLD. Etter 5 går rekken rundt igjen; nummeret
// på etappen skiller dem da.
export const FARGER = ["#2f6fdb", "#7c4dcc", "#f08a24", "#14a3a3", "#c2388a"];
export const MAKS_ETAPPER = 200;

export function fargeFor(nr) {
  const n = Math.max(1, Math.round(Number(nr) || 1));
  return FARGER[(n - 1) % FARGER.length];
}

const tekst = (v, n) => String(v == null ? "" : v).slice(0, n);
const hex = (f) => (typeof f === "string" && /^#[0-9a-fA-F]{6}$/.test(f)) ? f.toLowerCase() : "";
const dato = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : "";

// Ett element i en etappe: et IFC-element { id, gid } eller generert betong { sw }.
export function vaskElement(x) {
  if (!x || typeof x !== "object") return null;
  if (typeof x.sw === "string" && x.sw) return { sw: x.sw.slice(0, 40) };
  const id = Number(x.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id, gid: typeof x.gid === "string" ? x.gid.slice(0, 40) : "" };
}
// Nøkkelen et element kjennes igjen på. «sw:» og «id:» holder de to slagene
// fra hverandre, så ExpressID 3 og ringmurbit «3» aldri kan forveksles.
export function elementNokkel(x) {
  if (typeof x === "number") return "id:" + x;
  if (typeof x === "string") return /^(sw|id):/.test(x) ? x : "sw:" + x;
  if (!x) return "";
  return x.sw ? "sw:" + x.sw : "id:" + Number(x.id);
}
export const erGenerert = (x) => !!(x && x.sw);

export function vaskEtappe(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) return null;
  const id = e.id.slice(0, 40);
  const endret = tekst(e.endret, 40);
  // 🪦 Gravstein: en slettet etappe beholdes så slettingen synkes (sp-lager.js)
  if (e.slettet === true) return { id, slettet: true, endret };
  const nr = Math.max(1, Math.min(999, Math.round(Number(e.nr) || 1)));
  const ut = {
    id, nr,
    navn: tekst(e.navn, 80).trim() || ("Etappe " + nr),
    farge: hex(e.farge) || fargeFor(nr),
    dato: dato(e.dato),
    status: e.status === "stopt" ? "stopt" : "planlagt",
    // 📅 Når den FAKTISK ble støpt (trinn 4). Settes av «Merk som støpt» —
    // tidslinjen trenger den for å vise hvordan det sto på en dag bakover.
    stoptDato: e.status === "stopt" ? dato(e.stoptDato) : "",
    notat: tekst(e.notat, 500),
    // Kommer i trinn 2/3/6 — tas vare på allerede nå (se toppen av fila)
    // [{ id: ExpressID, gid: GlobalId }] — gid gjør at planen kan finne
    // elementet igjen i en ny revisjon av modellen (samme grep som Sammenlign)
    // 🧱 Generert betong (betonggulvet og ringmurbitene fra SW-generatoren,
    // Emil 30.09) er ikke i IFC-fila og har ingen ExpressID. De lagres som
    // { sw: "gulv" | "r3" | "ir2" } — SW-generatorens egne id-er.
    elementer: Array.isArray(e.elementer) ? e.elementer.map(vaskElement).filter(Boolean).slice(0, 20000) : [],
    felt: Array.isArray(e.felt) ? e.felt.slice(0, 200).map(vaskFelt).filter(Boolean) : [],
    vanntetting: Array.isArray(e.vanntetting) ? e.vanntetting.slice(0, 500).map(vaskVann).filter(Boolean) : [],
    endret, av: tekst(e.av, 60)
  };
  return ut;
}

export function vaskEtappeListe(liste) {
  return (Array.isArray(liste) ? liste : []).slice(0, MAKS_ETAPPER * 2).map(vaskEtappe).filter(Boolean);
}

export function synlige(liste) {
  return vaskEtappeListe(liste).filter(e => !e.slettet);
}

// Neste nummer er ett høyere enn det høyeste som finnes (også blant de
// slettede? Nei — sletter du etappe 4 av 4, skal neste hete 4 igjen).
export function nesteNr(liste) {
  return synlige(liste).reduce((m, e) => Math.max(m, e.nr), 0) + 1;
}

export function nyEtappe(liste, naa, id) {
  const nr = nesteNr(liste);
  return vaskEtappe({
    id: id || ("E-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)),
    nr, navn: "Etappe " + nr, farge: fargeFor(nr), dato: "", status: "planlagt",
    endret: naa || new Date().toISOString()
  });
}

// Mandag i uka datoen ligger i (ISO-uke), som «ÅÅÅÅ-MM-DD».
export function mandag(iso) {
  const b = String(iso || "").split("-").map(Number);
  if (b.length !== 3 || b.some(n => !Number.isFinite(n))) return "";
  const d = new Date(Date.UTC(b[0], b[1] - 1, b[2]));
  const dag = (d.getUTCDay() + 6) % 7;            // 0 = mandag
  d.setUTCDate(d.getUTCDate() - dag);
  return d.toISOString().slice(0, 10);
}

// Hva etappen står som i dag:
//   "stopt"     — merket som støpt (bare knappen avgjør det, ikke datoen)
//   "forsinket" — datoen er passert, men ikke merket som støpt
//   "uke"       — datoen er i samme uke som i dag
//   "planlagt"  — alt annet, også uten dato
export function statusFor(e, iDag) {
  if (!e) return "planlagt";
  if (e.status === "stopt") return "stopt";
  if (!e.dato) return "planlagt";
  if (e.dato < iDag) return "forsinket";
  if (mandag(e.dato) === mandag(iDag)) return "uke";
  return "planlagt";
}

export const STATUS_TEKST = {
  stopt: "Støpt", uke: "Denne uka", forsinket: "Forsinket", planlagt: "Planlagt"
};

// Rekkefølgen i lista: dato først (uten dato sist), så nummer.
export function sortert(liste) {
  return synlige(liste).sort((a, b) =>
    (a.dato || "9999") < (b.dato || "9999") ? -1 : (a.dato || "9999") > (b.dato || "9999") ? 1 : a.nr - b.nr);
}

// Det byggeplassen skal ha (trinn 5): bare synlige etapper, uten synkfelt.
export function stopeplanForByggeplass(liste) {
  return synlige(liste).map(e => ({
    id: e.id, nr: e.nr, navn: e.navn, farge: e.farge, dato: e.dato, status: e.status, stoptDato: e.stoptDato,
    elementer: e.elementer, felt: e.felt, vanntetting: e.vanntetting
  }));
}

// ═══════════════ TRINN 2: ELEMENTER I EN ETAPPE ═══════════════
// Et element hører til ÉN etappe — støpes det i etappe 2, er det ikke også i
// etappe 3. Legges det til en ny etappe, flyttes det dit. Svaret sier hvor
// mange som ble flyttet fra andre etapper, så panelet kan si fra.
export const MAKS_ELEMENTER = 20000;
export function leggTilElementer(liste, etappeId, nye, naa) {
  const inn = (nye || []).map(vaskElement).filter(Boolean);
  const nokler = new Set(inn.map(elementNokkel));
  const har = (x) => nokler.has(elementNokkel(x));
  let flyttet = 0;
  const ut = vaskEtappeListe(liste).map(e => {
    if (e.slettet) return e;
    if (e.id === etappeId) {
      const fra = (e.elementer || []).filter(x => !har(x));
      return Object.assign({}, e, { elementer: fra.concat(inn).slice(0, MAKS_ELEMENTER), endret: naa || e.endret });
    }
    const for_ = (e.elementer || []).length;
    const rest = (e.elementer || []).filter(x => !har(x));
    if (rest.length !== for_) { flyttet += for_ - rest.length; return Object.assign({}, e, { elementer: rest, endret: naa || e.endret }); }
    return e;
  });
  return { liste: ut, lagtTil: inn.length, flyttet };
}

// `ider`: null = alle, ellers ExpressID-er (tall) og/eller nøkler («sw:gulv»).
export function fjernElementer(liste, etappeId, ider, naa) {
  const sett = ider ? new Set(ider.map(elementNokkel)) : null;
  return vaskEtappeListe(liste).map(e => (e.slettet || e.id !== etappeId) ? e
    : Object.assign({}, e, { elementer: sett ? e.elementer.filter(x => !sett.has(elementNokkel(x))) : [], endret: naa || e.endret }));
}

// ═══════════════ TRINN 3: FELT PÅ PLATA (variant C, Emil 30.09) ═══════════════
// Et felt er en flate på plata, tegnet som et rektangel eller et polygon:
//   { id, punkter: [[bx, bz], …], by, tykkelseM }
// Punktene ligger i BYGGRAMMEN — meter fra modellens senter (bx = x, bz = z),
// samme ramme som riggen bruker før terrenget finnes. `by` er toppen av feltet
// (meter fra modellens senter, oppover), og tykkelsen er platetykkelsen der
// feltet ble tegnet. Arealet og volumet regnes ALLTID ut av punktene, aldri
// lagret — da kan de ikke bli stående gamle etter at et hjørne er dratt.
export const FELT_MIN_TYKKELSE = 0.05, FELT_MAKS_TYKKELSE = 3;
export const FELT_MAKS_PUNKTER = 64;
// To hjørner nærmere enn dette regnes som SAMME hjørne (fugen mellom to felt).
export const FELT_TOL_M = 0.02;

const tall = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r3 = (v) => Math.round(v * 1000) / 1000;

export function vaskFelt(f) {
  if (!f || typeof f !== "object") return null;
  const punkter = (Array.isArray(f.punkter) ? f.punkter : [])
    .slice(0, FELT_MAKS_PUNKTER)
    .map(p => Array.isArray(p) ? [tall(p[0]), tall(p[1])] : null)
    .filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 1e5 && Math.abs(p[1]) < 1e5)
    .map(p => [r3(p[0]), r3(p[1])]);
  if (punkter.length < 3) return null;
  const by = Number.isFinite(tall(f.by)) ? r3(tall(f.by)) : 0;
  const tk = tall(f.tykkelseM);
  return {
    id: typeof f.id === "string" && f.id ? f.id.slice(0, 40) : "F-" + Math.random().toString(36).slice(2, 8),
    punkter, by,
    tykkelseM: Number.isFinite(tk) ? Math.min(FELT_MAKS_TYKKELSE, Math.max(FELT_MIN_TYKKELSE, r3(tk))) : 0.25
  };
}

// Skolisseformelen. Uavhengig av omløpsretningen.
export function feltAreal(f) {
  const p = (f && f.punkter) || [];
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}
export const feltVolum = (f) => feltAreal(f) * ((f && f.tykkelseM) || 0);

export function kantLengde(f, i) {
  const p = f.punkter, a = p[i], b = p[(i + 1) % p.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
export function kantLengder(f) { return ((f && f.punkter) || []).map((_, i) => kantLengde(f, i)); }

export function rektangel(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

export function nyttFelt(punkter, by, tykkelseM, id) {
  return vaskFelt({ id: id || ("F-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)), punkter, by, tykkelseM });
}

const samme = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

// ✥ FLYTT PUNKTER — og naboene følger med (Emil 30.09: «ingen glipe, ingen
// overlapp»). `flytt` er [{ fra: [bx, bz], til: [bx, bz] }]. Hvert hjørne i
// HVERT felt i HELE planen som ligger på et «fra»-punkt, flyttes til «til».
// Et hjørne to felt deler, er dermed ett hjørne — dras det, drar det begge.
// `bare` (valgfritt): et felt-id — da flyttes bare det feltet (dra hele
// feltet skal ikke dra naboene skjeve).
export function flyttPunkter(liste, flytt, naa, bare) {
  const tol = FELT_TOL_M;
  return vaskEtappeListe(liste).map(e => {
    if (e.slettet || !(e.felt || []).length) return e;
    let endret = false;
    const felt = e.felt.map(f => {
      if (bare && f.id !== bare) return f;
      let fEndret = false;
      const punkter = f.punkter.map(p => {
        for (const m of flytt) if (samme(p, m.fra, tol)) { fEndret = true; return [r3(m.til[0]), r3(m.til[1])]; }
        return p;
      });
      if (!fEndret) return f;
      endret = true;
      return Object.assign({}, f, { punkter });
    });
    return endret ? Object.assign({}, e, { felt, endret: naa || e.endret }) : e;
  });
}

// Et nytt hjørne midt på (eller i `punkt` på) kant i. Har nabofeltet den SAMME
// kanten, får det hjørnet også — ellers ville et senere drag i det nye hjørnet
// åpnet en glipe mellom dem.
export function leggTilHjorne(liste, feltId, i, punkt, naa) {
  let a = null, b = null, ny = null;
  for (const e of synlige(liste)) for (const f of e.felt || []) if (f.id === feltId) {
    a = f.punkter[i]; b = f.punkter[(i + 1) % f.punkter.length];
    ny = punkt ? [r3(punkt[0]), r3(punkt[1])] : [r3((a[0] + b[0]) / 2), r3((a[1] + b[1]) / 2)];
  }
  if (!ny) return vaskEtappeListe(liste);
  const tol = FELT_TOL_M;
  return vaskEtappeListe(liste).map(e => {
    if (e.slettet || !(e.felt || []).length) return e;
    let endret = false;
    const felt = e.felt.map(f => {
      if (f.punkter.length >= FELT_MAKS_PUNKTER) return f;
      const p = f.punkter;
      for (let k = 0; k < p.length; k++) {
        const p1 = p[k], p2 = p[(k + 1) % p.length];
        const lik = f.id === feltId ? k === i : ((samme(p1, a, tol) && samme(p2, b, tol)) || (samme(p1, b, tol) && samme(p2, a, tol)));
        if (lik) { endret = true; return Object.assign({}, f, { punkter: p.slice(0, k + 1).concat([ny], p.slice(k + 1)) }); }
      }
      return f;
    });
    return endret ? Object.assign({}, e, { felt, endret: naa || e.endret }) : e;
  });
}

export function fjernHjorne(liste, feltId, i, naa) {
  return endreFelt(liste, feltId, f => f.punkter.length <= 3 ? f
    : Object.assign({}, f, { punkter: f.punkter.filter((_, k) => k !== i) }), naa);
}

// Kant i satt til en ny lengde: ENDEPUNKTET (i+1) flyttes langs kanten, og
// naboene som deler det, følger med (flyttPunkter).
export function settKantLengde(liste, feltId, i, lengde, naa) {
  const L = Number(lengde);
  if (!(L > 0.01)) return vaskEtappeListe(liste);
  for (const e of synlige(liste)) for (const f of e.felt || []) if (f.id === feltId) {
    const p = f.punkter, a = p[i], b = p[(i + 1) % p.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(d > 1e-6)) return vaskEtappeListe(liste);
    const til = [a[0] + (b[0] - a[0]) / d * L, a[1] + (b[1] - a[1]) / d * L];
    return flyttPunkter(liste, [{ fra: b, til }], naa);
  }
  return vaskEtappeListe(liste);
}

export function endreFelt(liste, feltId, fn, naa) {
  return vaskEtappeListe(liste).map(e => {
    if (e.slettet || !(e.felt || []).some(f => f.id === feltId)) return e;
    const felt = e.felt.map(f => f.id === feltId ? vaskFelt(fn(f)) : f).filter(Boolean);
    return Object.assign({}, e, { felt, endret: naa || e.endret });
  });
}
export function fjernFelt(liste, feltId, naa) {
  return vaskEtappeListe(liste).map(e => {
    if (e.slettet || !(e.felt || []).some(f => f.id === feltId)) return e;
    return Object.assign({}, e, { felt: e.felt.filter(f => f.id !== feltId), endret: naa || e.endret });
  });
}
export function leggTilFelt(liste, etappeId, felt, naa) {
  const f = vaskFelt(felt);
  if (!f) return vaskEtappeListe(liste);
  return vaskEtappeListe(liste).map(e => (e.slettet || e.id !== etappeId) ? e
    : Object.assign({}, e, { felt: (e.felt || []).concat([f]).slice(0, 200), endret: naa || e.endret }));
}
export function finnFelt(liste, feltId) {
  for (const e of synlige(liste)) for (const f of e.felt || []) if (f.id === feltId) return { etappe: e, felt: f };
  return null;
}

// 🧲 SNAPP mot hjørnene og kantene til de ANDRE feltene, så to felt deler fuge
// uten glipe. Hjørner går foran kanter. `tol` i meter (kallstedet regner om
// fra piksler). `unntak`: feltet som dras (skal ikke snappe til seg selv).
// `ignorer`: punkter som er i bevegelse (hjørnet som dras). Et nabohjørne som
// ligger på samme sted flytter seg med — å snappe til det ville låst hjørnet
// fast der det startet.
export function snappFelt(liste, p, tol, unntak, ignorer) {
  let best = null, bestD = tol;
  const alle = [];
  const ign = ignorer || [];
  const ignorert = (q) => ign.some(r => samme(q, r, FELT_TOL_M));
  for (const e of synlige(liste)) for (const f of e.felt || []) if (f.id !== unntak) alle.push(f);
  for (const f of alle) for (const q of f.punkter) {
    if (ignorert(q)) continue;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= bestD) { bestD = d; best = [q[0], q[1]]; }
  }
  if (best) return { punkt: best, type: "hjorne" };
  for (const f of alle) {
    const P = f.punkter;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (ignorert(a) || ignorert(b)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      if (L2 < 1e-9) continue;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
      const q = [a[0] + u * dx, a[1] + u * dz];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) { bestD = d; best = q; }
    }
  }
  return best ? { punkt: best, type: "kant" } : { punkt: p, type: null };
}

// Summene for en etappe: areal og volum av feltene (ca).
export function feltSummer(e) {
  let areal = 0, volum = 0;
  for (const f of (e && e.felt) || []) { areal += feltAreal(f); volum += feltVolum(f); }
  return { areal, volum };
}

// ═══════════════ TRINN 4: STATUS OG TIDSLINJE (4D) ═══════════════
// Hvordan etappen sto (eller er PLANLAGT å stå) på en valgt dag `per`.
//   · Bakover (per ≤ i dag): fasiten. Støpt bare om den er merket støpt, og
//     støpedatoen (stoptDato, ellers plandatoen) ikke er etter `per`.
//   · Framover (per > i dag): planen. Det som etter planen er støpt innen
//     `per`, vises som støpt — slik ser bygget ut om planen holder.
// Uten `per` (eller per = i dag) er svaret det samme som statusFor.
export function statusPer(e, per, iDag) {
  if (!per || per === iDag) return statusFor(e, iDag);
  if (per < iDag) {
    const nar = e.stoptDato || e.dato || "";
    if (e.status === "stopt" && nar && nar <= per) return "stopt";
    return statusFor(Object.assign({}, e, { status: "planlagt" }), per);
  }
  if (e.status === "stopt") return "stopt";
  if (e.dato && e.dato <= per) return "stopt";
  return statusFor(e, per);
}

// Dager mellom to «ÅÅÅÅ-MM-DD» (b − a). NaN for ugyldige datoer.
export function dagerMellom(a, b) {
  const t = (x) => { const d = String(x || "").split("-").map(Number); return d.length === 3 ? Date.UTC(d[0], d[1] - 1, d[2]) : NaN; };
  return Math.round((t(b) - t(a)) / 86400000);
}
export function plussDager(iso, n) {
  const d = String(iso || "").split("-").map(Number);
  if (d.length !== 3) return "";
  const x = new Date(Date.UTC(d[0], d[1] - 1, d[2] + n));
  return x.toISOString().slice(0, 10);
}

// Tidslinjens spenn: fra første til siste dato (planlagt eller støpt), med en
// uke luft på hver side og i dag alltid med. Ingen datoer → null.
export function tidslinjeSpenn(liste, iDag) {
  const d = [];
  for (const e of synlige(liste)) { if (e.dato) d.push(e.dato); if (e.stoptDato) d.push(e.stoptDato); }
  if (!d.length) return null;
  d.push(iDag);
  d.sort();
  return { fra: plussDager(d[0], -7), til: plussDager(d[d.length - 1], 7) };
}

// ═══════════════ TRINN 6: VANNTETTING (Emil 30.09 / 01.10) ═══════════════
// To typer, begge langs kanten av betongen, inne i armeringen:
//   · injeksjon — injeksjonsslange. Går i FULL LENGDE rundt, uten skjøt
//     eller omlegg (Emil 01.10).
//   · cemflex   — Cemflex-plater (fugeblikk). Skjøtes med MINST 5 cm omlegg
//     (Emil 01.10). Platene er 2 m lange og 150 mm høye (CEMflex VB 150,
//     produktbladet / forhandlerne) — lengden kan endres i panelet.
// En vanntetting er en kjede av strekninger i byggrammen:
//   { id, type, kanter: [[bx1, bz1, bx2, bz2], …], by, lukket, feltId }
// `lukket` = hele omkretsen (en ring) — da er det én skjøt mer for Cemflex.
export const VANN_TYPER = ["injeksjon", "cemflex"];
export const CEMFLEX_OMLEGG_M = 0.05;
export const CEMFLEX_PLATE_M = 2.0;

export function vaskVann(v) {
  if (!v || typeof v !== "object" || !VANN_TYPER.includes(v.type)) return null;
  const kanter = (Array.isArray(v.kanter) ? v.kanter : []).slice(0, 500)
    .map(k => Array.isArray(k) && k.length === 4 ? k.map(Number) : null)
    .filter(k => k && k.every(Number.isFinite) && Math.hypot(k[2] - k[0], k[3] - k[1]) > 0.01)
    .map(k => k.map(x => Math.round(x * 1000) / 1000));
  if (!kanter.length) return null;
  return {
    id: typeof v.id === "string" && v.id ? v.id.slice(0, 40) : "V-" + Math.random().toString(36).slice(2, 8),
    type: v.type, kanter,
    by: Number.isFinite(Number(v.by)) ? Math.round(Number(v.by) * 1000) / 1000 : 0,
    lukket: v.lukket === true,
    feltId: typeof v.feltId === "string" ? v.feltId.slice(0, 40) : ""
  };
}

export function vannLengde(v) {
  let L = 0;
  for (const k of (v && v.kanter) || []) L += Math.hypot(k[2] - k[0], k[3] - k[1]);
  return L;
}

// Cemflex: hvor mange plater, hvor mange skjøter, og løpemeteren MED omlegg.
// Åpen linje: n plater dekker n·P − (n−1)·o ≥ L. Lukket ring: hver plate
// overlapper den neste, også den siste med den første — n·(P − o) ≥ L.
export function cemflexPlan(L, lukket, plateM, omleggM) {
  const P = Number(plateM) > 0.2 ? Number(plateM) : CEMFLEX_PLATE_M;
  const o = Number(omleggM) >= 0 ? Number(omleggM) : CEMFLEX_OMLEGG_M;
  if (!(L > 0)) return { plater: 0, skjoter: 0, lmMedOmlegg: 0, platelengde: P };
  const plater = lukket ? Math.max(1, Math.ceil(L / (P - o) - 1e-9)) : Math.max(1, Math.ceil((L - o) / (P - o) - 1e-9));
  const skjoter = lukket ? plater : plater - 1;
  return { plater, skjoter, lmMedOmlegg: L + skjoter * o, platelengde: P };
}

// Summene for en etappe, per type: { injeksjon: { lm }, cemflex: { lm, lmMedOmlegg, plater, skjoter } }
export function vannSummer(e, plateM) {
  const ut = { injeksjon: { lm: 0 }, cemflex: { lm: 0, lmMedOmlegg: 0, plater: 0, skjoter: 0 } };
  for (const v of (e && e.vanntetting) || []) {
    const L = vannLengde(v);
    if (v.type === "injeksjon") ut.injeksjon.lm += L;
    else {
      const p = cemflexPlan(L, v.lukket, plateM);
      ut.cemflex.lm += L; ut.cemflex.lmMedOmlegg += p.lmMedOmlegg;
      ut.cemflex.plater += p.plater; ut.cemflex.skjoter += p.skjoter;
    }
  }
  return ut;
}

// Kantene i et felt som strekninger. `ider` = kantnumre (null = hele omkretsen).
export function feltKanter(f, ider) {
  const P = (f && f.punkter) || [];
  const ut = [];
  for (let i = 0; i < P.length; i++) {
    if (ider && !ider.includes(i)) continue;
    const a = P[i], b = P[(i + 1) % P.length];
    ut.push([a[0], a[1], b[0], b[1]]);
  }
  return ut;
}

export function leggTilVann(liste, etappeId, v, naa) {
  const r = vaskVann(v);
  if (!r) return vaskEtappeListe(liste);
  return vaskEtappeListe(liste).map(e => (e.slettet || e.id !== etappeId) ? e
    : Object.assign({}, e, { vanntetting: (e.vanntetting || []).concat([r]).slice(0, 500), endret: naa || e.endret }));
}
export function fjernVann(liste, vannId, naa) {
  return vaskEtappeListe(liste).map(e => (e.slettet || !(e.vanntetting || []).some(v => v.id === vannId)) ? e
    : Object.assign({}, e, { vanntetting: e.vanntetting.filter(v => v.id !== vannId), endret: naa || e.endret }));
}

// ═══════════════ TRINN 7: STØPEPLAN-PDF (oppsett D) OG EXCEL ═══════════════
// Emil 01.10: oppsett D — plan og 3D øverst, tidslinje i midten, full tabell
// nederst. Ingen «ca» på tallene, og ingen svinn eller ekstra betong: det
// varierer for mye fra prosjekt til prosjekt, så brukeren legger det til selv.
//
// Én rad per etappe. `volumElementer(e)` gir elementvolumet i m³ (kommer fra
// mengdeuttaket i stopeplan.js — her er regningen ren og testbar).
export function stopeplanTabell(liste, volumElementer, plateM, iDag) {
  const rader = sortert(liste).map(e => {
    const fs = feltSummer(e);
    const v = vannSummer(e, plateM);
    const st = statusFor(e, iDag);
    const nEl = (e.elementer || []).length, nF = (e.felt || []).length;
    return {
      id: e.id, nr: e.nr, nEl, nF, navn: e.navn, farge: e.farge, dato: e.dato, stoptDato: e.stoptDato || "",
      status: st, innhold: [nEl ? nEl + (nEl === 1 ? " element" : " elementer") : "", nF ? nF + " felt" : ""].filter(Boolean).join(" · ") || "–",
      areal: fs.areal, volum: (Number(volumElementer ? volumElementer(e) : 0) || 0) + fs.volum,
      injeksjon: v.injeksjon.lm, cemflex: v.cemflex.lmMedOmlegg, plater: v.cemflex.plater, skjoter: v.cemflex.skjoter
    };
  });
  const sum = rader.reduce((s, r) => ({ areal: s.areal + r.areal, volum: s.volum + r.volum, injeksjon: s.injeksjon + r.injeksjon,
    cemflex: s.cemflex + r.cemflex, plater: s.plater + r.plater }), { areal: 0, volum: 0, injeksjon: 0, cemflex: 0, plater: 0 });
  return { rader, sum };
}

// Tidslinjen på arket: hele uker, mandag til søndag, fra første til siste
// dato (og i dag). { fra, til, uker: [{ mandag, nr }] } eller null.
export function isoUke(iso) {
  const b = String(iso || "").split("-").map(Number);
  const d = new Date(Date.UTC(b[0], b[1] - 1, b[2]));
  const dag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dag + 3);                 // torsdagen i uka
  const t1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - t1) / 86400000 - 3 + ((t1.getUTCDay() + 6) % 7)) / 7);
}
export function ganttUker(liste, iDag) {
  const d = [];
  for (const e of synlige(liste)) { if (e.dato) d.push(e.dato); if (e.stoptDato) d.push(e.stoptDato); }
  if (!d.length) return null;
  d.push(iDag); d.sort();
  const fra = mandag(d[0]), sist = mandag(d[d.length - 1]);
  const uker = [];
  for (let m = fra; m <= sist; m = plussDager(m, 7)) uker.push({ mandag: m, nr: isoUke(m) });
  return { fra, til: plussDager(sist, 7), uker };
}

export function stopeplanFilnavn(fil, iDag, ending) {
  const navn = String(fil || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "modell";
  return "Støpeplan " + navn + " " + iDag + "." + (ending || "pdf");
}

// Excel: ett ark, én rad per etappe, summene som FORMLER (som Mengder).
// Tallene skrives som tall — ikke tekst — så de kan regnes videre på
// (svinn og ekstra betong legger brukeren til selv, Emil 01.10).
export function stopeplanExcelRader(tab, statusTekst) {
  const st = statusTekst || ((s) => STATUS_TEKST[s] || s);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const hode = ["Nr", "Etappe", "Innhold", "Plandato", "Status", "Støpt", "Areal felt (m²)", "Volum (m³)",
    "Injeksjonsslange (lm)", "Cemflex m/omlegg (lm)", "Cemflex plater (stk)"];
  const rader = [hode];
  for (const r of tab.rader) rader.push([r.nr, r.navn, r.innhold, r.dato || "", st(r.status), r.stoptDato || "",
    r3(r.areal), r3(r.volum), r3(r.injeksjon), r3(r.cemflex), r.plater]);
  const n = tab.rader.length;
  const sumRad = ["", "Sum", "", "", "", ""];
  for (let k = 6; k <= 10; k++) sumRad.push(n ? "=SUM(" + String.fromCharCode(65 + k) + "2:" + String.fromCharCode(65 + k) + (n + 1) + ")" : 0);
  rader.push(sumRad);
  return rader;
}
