// 📊 FRAMDRIFTSRAPPORT — REGNINGEN (runde 10, Emils valg B 02.11.2026). Ren,
// uten DOM — testes i _test/test-ferdig.mjs.
//
// Emil: «én statuslinje per elementtype og én total for prosjektet», og to
// nedlastinger:
//   · INTERN (plan mot faktisk): «internt er det smart og gå ned til minste
//     detalj … for å finne og analysere hva som går bra og hva som går dårlig»
//   · STATUS (bare % ferdig per element): «når du skal sende en
//     framdriftsrapport … bare status per element, siden mye av det andre
//     bare kommer i veien som støy for mottaker»
//
// FERDIGMELDINGENE er en liste i SharePoint (Framdriftsplan/<modell>.ferdig.json),
// én post per objekt, flettet på id med nyeste `endret` (samme som resten).
// Angre/«ikke ferdig» er en post med ferdig: false — aldri en sletting, så
// hvem som rettet hva står igjen.
//
// PLANEN kommer fra Framdriftsplan: objektet ligger i et trinn med Fra–Til.
// Innen trinnet regnes planen jevnt fra start til slutt (trinnAndel) — samme
// regel som glideren. Objekter som ikke ligger i noe trinn, er med i STATUS,
// men har ingen plan: de står som egen linje i den interne rapporten.
//
// PROSENT telles i ANTALL objekter (Emil 02.11, standarden). Arbeidsdager er
// mandag–fredag; helligdager regnes ikke bort.
import { dagNr, ifcGruppe, etappeForNokkel, idFor, isoFraDag, slagFor, synlige, trinnAndel, trinnTid } from "./framdrift-regn.js";

export const MAKS = 50000;
const tekst = (v, n) => String(v == null ? "" : v).slice(0, n || 80);
// IFC-klasser som ikke er bygningsdeler og aldri skal telles
const IKKE_TELL_SETT = new Set(["space", "openingelement", "annotation", "grid", "site", "building",
  "buildingstorey", "project", "virtualelement", "distributionport", "gridaxis", "zone"]);
export const ikkeTell = (typeName) => IKKE_TELL_SETT.has(String(typeName || "").toLowerCase().replace(/^ifc/, ""));
// Slagene som kan ferdigmeldes (materiell, rigg og markeringer er ikke bygget)
export const KAN_MELDES = ["id", "sw", "tak", "blikk"];
export const SLAG_GRUPPE = { sw: "SW-elementer", tak: "Takplater", blikk: "Blikk" };
// Gruppen et generert objekt telles under. Fra SW-laget: betonggulvet og
// isolasjonen under har egne linjer (Emil 02.11), ringmurbitene også.
export function gruppeForNokkel(k) {
  const s = slagFor(k), id = idFor(k);
  if (s === "sw") {
    if (id === "gulv") return "Betonggulv";
    if (id === "gulv-iso") return "Isolasjon under gulv";
    if (/^i?r\d+$/.test(id)) return "Ringmur";
  }
  return SLAG_GRUPPE[s] || "";
}

// Gruppen (elementtypen) et IFC-element telles under. Ukjent klasse: navnet
// uten «Ifc»; «IfcBuildingElementProxy» → «Objekter» (IFC_GRUPPE).
export function gruppeFor(typeName) {
  const t = String(typeName || "");
  if (!t) return "Elementer";
  return ifcGruppe(t) || t.replace(/^ifc/i, "").replace(/standardcase$/i, "") || "Elementer";
}

// Id-en en ferdigmelding lagres på. GlobalId vinner for IFC-elementer: da
// finner meldingen elementet igjen også når modellen lastes på nytt og
// ExpressID-ene har flyttet seg (ny revisjon).
export function meldingId(k, gid) {
  if (slagFor(k) === "id" && gid) return "g:" + tekst(gid, 40);
  return tekst(k, 80);
}

export function vaskMelding(m) {
  if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id) return null;
  const k = tekst(m.k, 80);
  if (!KAN_MELDES.includes(slagFor(k))) return null;
  return {
    id: tekst(m.id, 80), k,
    gid: typeof m.gid === "string" ? tekst(m.gid, 40) : "",
    ferdig: m.ferdig === true,
    tid: tekst(m.tid, 40), av: tekst(m.av, 60),
    kilde: m.kilde === "bygg" ? "bygg" : "kontor",
    endret: tekst(m.endret || m.tid, 40)
  };
}
export function vaskMeldinger(liste) {
  return (Array.isArray(liste) ? liste : []).slice(0, MAKS).map(vaskMelding).filter(Boolean);
}
// En melding om ferdig (eller «ikke ferdig» igjen)
export function nyMelding(k, gid, ferdig, av, tid, kilde) {
  return vaskMelding({ id: meldingId(k, gid), k, gid, ferdig: ferdig === true, av, tid, kilde, endret: tid });
}
// Slå meldinger sammen (nyeste `endret` per id vinner) — også fra byggeplassen
export function flettMeldinger(gamle, nye) {
  const m = new Map();
  for (const x of vaskMeldinger(gamle).concat(vaskMeldinger(nye))) {
    const f = m.get(x.id);
    if (!f || String(x.endret) >= String(f.endret)) m.set(x.id, x);
  }
  return [...m.values()];
}
// Oppslag: objekt → gjeldende melding (på GlobalId først, så nøkkelen)
export function oppslag(meldinger) {
  const pa = new Map();
  for (const x of vaskMeldinger(meldinger)) pa.set(x.id, x);
  return (k, gid) => pa.get(meldingId(k, gid)) || (gid ? pa.get(tekst(k, 80)) : null) || null;
}

// ═══════════ ARBEIDSDAGER (man–fre) ═══════════
// Antall arbeidsdager fra og med a til (men ikke med) b, i dagnummer.
export function arbeidsdager(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const fortegn = b < a ? -1 : 1;
  let fra = Math.floor(Math.min(a, b)), til = Math.floor(Math.max(a, b)), n = 0;
  for (let d = fra; d < til; d++) { const u = new Date(d * 86400000).getUTCDay(); if (u !== 0 && u !== 6) n++; }
  return fortegn * n;
}

// ═══════════ STATUSFARGEN ═══════════
// Avvik i prosentpoeng (plan − faktisk): under 2 = i rute, under 10 = litt bak.
export const GRENSE = { gul: 2, rod: 10 };
export function statusFor(planPst, faktiskPst, harPlan) {
  if (!harPlan) return "gra";
  if (planPst <= 0 && faktiskPst <= 0) return "gra";
  const avvik = planPst - faktiskPst;
  return avvik < GRENSE.gul ? "gronn" : avvik < GRENSE.rod ? "gul" : "rod";
}
// Ett objekts farge i modellen: ferdig = grønn; trinnet er over = rød;
// trinnet pågår = gul; ellers (ikke startet / uten trinn) grå.
export function objektFarge(ferdig, trinn, iDagNr) {
  if (ferdig) return "gronn";
  const tt = trinnTid(trinn);
  if (!tt) return "gra";
  if (iDagNr >= tt.b) return "rod";
  if (iDagNr >= tt.a) return "gul";
  return "gra";
}

const pst = (a, n) => (n ? a / n * 100 : 0);
const rund = (x) => Math.round(x * 10) / 10;

// ═══════════ RAPPORTEN ═══════════
// univers: [{ k, gid?, gruppe, navn? }] — alt som telles (modellens
// bygningsdeler + genererte objekter i trinnene). framdrift: S.framdrift.
// iDag: "ÅÅÅÅ-MM-DD".
export function rapport(univers, meldinger, framdrift, iDag) {
  const finn = oppslag(meldinger);
  const dag = dagNr(iDag);
  const trinnListe = synlige(framdrift);
  const trinnFor = new Map();
  for (const e of trinnListe) for (const o of e.objekter) if (!trinnFor.has(o.k)) trinnFor.set(o.k, e);

  const sett = new Set();
  const rader = [];
  for (const u of univers || []) {
    if (!u || !u.k || sett.has(u.k) || !KAN_MELDES.includes(slagFor(u.k))) continue;
    sett.add(u.k);
    const m = finn(u.k, u.gid);
    const ferdig = !!(m && m.ferdig);
    const trinn = trinnFor.get(u.k) || null;
    const harPlan = !!trinnTid(trinn);
    const plan = harPlan ? trinnAndel(trinn, dag) : 0;
    rader.push({ k: u.k, gid: u.gid || "", gruppe: u.gruppe || "Elementer", navn: u.navn || "", ferdig,
      melding: m && m.ferdig ? m : null, trinn, harPlan, plan,
      farge: objektFarge(ferdig, trinn, dag),
      ferdigDag: m && m.ferdig ? Math.floor(Date.parse(m.tid) / 86400000) : NaN });
  }

  // Per gruppe
  const grupper = new Map();
  for (const r of rader) {
    const g = grupper.get(r.gruppe) || { gruppe: r.gruppe, n: 0, ferdig: 0, planN: 0, planFerdig: 0, planSum: 0 };
    g.n++; if (r.ferdig) g.ferdig++;
    if (r.harPlan) { g.planN++; g.planSum += r.plan; if (r.ferdig) g.planFerdig++; }
    grupper.set(r.gruppe, g);
  }
  const typer = [...grupper.values()].map(g => {
    const planPst = pst(g.planSum, g.planN), faktiskPlan = pst(g.planFerdig, g.planN);
    return { gruppe: g.gruppe, n: g.n, ferdig: g.ferdig, pst: rund(pst(g.ferdig, g.n)),
      planN: g.planN, planPst: rund(planPst), faktiskPlanPst: rund(faktiskPlan), avvik: rund(planPst - faktiskPlan),
      status: statusFor(planPst, faktiskPlan, g.planN > 0) };
  }).sort((a, b) => b.n - a.n || (a.gruppe < b.gruppe ? -1 : 1));

  // Totalen
  const n = rader.length, ferdig = rader.filter(r => r.ferdig).length;
  const planRader = rader.filter(r => r.harPlan);
  const planN = planRader.length;
  const planPst = pst(planRader.reduce((s, r) => s + r.plan, 0), planN);
  const faktiskPlan = pst(planRader.filter(r => r.ferdig).length, planN);
  const uten = { n: n - planN, ferdig: rader.filter(r => !r.harPlan && r.ferdig).length };

  // Kurvene (bare objektene med plan): planen dag for dag og faktisk ferdig
  const kurve = lagKurve(planRader, trinnListe, dag);
  const bak = dagerBak(kurve.plan, faktiskPlan, dag);

  // Trinnene
  const trinn = trinnListe.slice().sort((a, b) => (a.dato || "9") < (b.dato || "9") ? -1 : (a.dato || "9") > (b.dato || "9") ? 1 : a.nr - b.nr).map(e => {
    const egne = rader.filter(r => r.trinn && r.trinn.id === e.id);
    const tn = egne.length, tf = egne.filter(r => r.ferdig).length;
    const p = trinnTid(e) ? trinnAndel(e, dag) * 100 : 0;
    const f = pst(tf, tn);
    return { id: e.id, nr: e.nr, navn: e.navn, farge: e.farge, dato: e.dato, slutt: e.slutt || e.dato, n: tn, ferdig: tf,
      pst: rund(f), planPst: rund(p), avvik: rund(p - f), status: tn ? statusFor(p, f, !!trinnTid(e)) : "gra" };
  }).filter(x => x.n);

  // Det som skulle vært ferdig og ikke er det: trinnet er over, eldst først
  const forsinket = rader.filter(r => !r.ferdig && r.farge === "rod").map(r => {
    const tt = trinnTid(r.trinn);
    return { k: r.k, gid: r.gid, gruppe: r.gruppe, navn: r.navn, trinn: r.trinn.nr + " · " + r.trinn.navn,
      slutt: isoFraDag(tt.b - 1), dagerOver: arbeidsdager(tt.b, dag + 1) };
  }).sort((a, b) => b.dagerOver - a.dagerOver || (a.gruppe < b.gruppe ? -1 : 1));

  return {
    iDag, n, ferdig, pst: rund(pst(ferdig, n)),
    plan: { n: planN, pst: rund(planPst), faktiskPst: rund(faktiskPlan), avvik: rund(planPst - faktiskPlan),
      status: statusFor(planPst, faktiskPlan, planN > 0), dagerBak: bak },
    uten, typer, trinn, forsinket, kurve, rader
  };
}

// plan: [[dag, %]] fra første trinnstart til siste trinnslutt.
// faktisk: [[dag, %]] fra første start til i dag (ferdig innen dagens slutt).
export function lagKurve(planRader, trinnListe, iDagNr) {
  if (!planRader.length) return { plan: [], faktisk: [], a: NaN, b: NaN };
  let a = Infinity, b = -Infinity;
  for (const r of planRader) { const tt = trinnTid(r.trinn); a = Math.min(a, tt.a); b = Math.max(b, tt.b); }
  // Trinnvis: antall objekter per trinn, så dagene regnes per trinn, ikke per objekt
  const perTrinn = new Map();
  for (const r of planRader) perTrinn.set(r.trinn.id, { e: r.trinn, n: (perTrinn.get(r.trinn.id) || { n: 0 }).n + 1 });
  const N = planRader.length;
  const plan = [];
  const steg = Math.max(1, Math.ceil((b - a) / 120));   // høyst ~120 punkter
  for (let d = a; d <= b; d += steg) {
    let s = 0; for (const x of perTrinn.values()) s += trinnAndel(x.e, d) * x.n;
    plan.push([d, rund(s / N * 100)]);
  }
  if (plan[plan.length - 1][0] !== b) plan.push([b, 100]);
  const faktisk = [];
  const ferdigDager = planRader.filter(r => r.ferdig).map(r => Number.isFinite(r.ferdigDag) ? r.ferdigDag : iDagNr).sort((x, y) => x - y);
  const slutt = Math.min(Math.max(a, iDagNr + 1), Math.max(b, iDagNr + 1));
  let i = 0;
  for (let d = a; d <= slutt; d += steg) {
    while (i < ferdigDager.length && ferdigDager[i] < d) i++;
    faktisk.push([d, rund(i / N * 100)]);
  }
  if (!faktisk.length || faktisk[faktisk.length - 1][0] !== slutt) faktisk.push([slutt, rund(ferdigDager.filter(x => x < slutt).length / N * 100)]);
  return { plan, faktisk, a, b };
}

// Hvor mange arbeidsdager bak (+) eller foran (−) planen: når nådde (eller
// når) planen den prosenten som faktisk er ferdig i dag?
export function dagerBak(plan, faktiskPst, iDagNr) {
  if (!plan || !plan.length) return null;
  let d = null;
  for (let i = 0; i < plan.length; i++) {
    if (plan[i][1] >= faktiskPst - 1e-9) {
      if (i === 0) { d = plan[0][0]; break; }
      const [d0, p0] = plan[i - 1], [d1, p1] = plan[i];
      d = p1 === p0 ? d1 : d0 + (faktiskPst - p0) / (p1 - p0) * (d1 - d0);
      break;
    }
  }
  if (d === null) d = plan[plan.length - 1][0];
  // Ingenting gjort og planen ikke startet: i rute
  if (faktiskPst <= 0 && iDagNr <= plan[0][0]) return 0;
  return arbeidsdager(Math.round(d), iDagNr);
}

// ═══════════ EXCEL ═══════════
export const EXCEL_STIL = { gronn: 8, gul: 9, rod: 10, gra: 11 };
const datoNo = (iso) => { const d = String(iso || "").slice(0, 10).split("-"); return d.length === 3 && d[0] ? d[2] + "." + d[1] + "." + d[0] : ""; };
const tidNo = (iso) => { const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return ""; const x = new Date(t); const to = (n) => String(n).padStart(2, "0"); return to(x.getDate()) + "." + to(x.getMonth() + 1) + "." + x.getFullYear() + " " + to(x.getHours()) + ":" + to(x.getMinutes()); };
export const STATUS_TEKST = { gronn: "I rute", gul: "Litt bak", rod: "Forsinket", gra: "Ikke startet" };
export const FARGE_TEKST = { gronn: "Ferdig", gul: "Pågår", rod: "Forsinket", gra: "Ikke startet" };

// Status (til mottaker): bare % ferdig per type og totalt
export function statusRader(r, T) {
  const tt = T || ((x) => x);
  return [[tt("Elementtype"), tt("Ferdig"), tt("Totalt"), tt("% ferdig")]]
    .concat(r.typer.map(x => [tt(x.gruppe), x.ferdig, x.n, x.pst]))
    .concat([[tt("Totalt prosjektet"), r.ferdig, r.n, r.pst]]);
}
// Intern: typene med plan, trinnene, og hvert objekt
export function internTypeRader(r, T) {
  const tt = T || ((x) => x);
  return [[tt("Elementtype"), tt("Ferdig"), tt("Totalt"), tt("% ferdig"), tt("Med plan"), tt("Plan i dag %"), tt("Faktisk (med plan) %"), tt("Avvik %-poeng"), tt("Status")]]
    .concat(r.typer.map(x => [tt(x.gruppe), x.ferdig, x.n, x.pst, x.planN, x.planN ? x.planPst : "", x.planN ? x.faktiskPlanPst : "", x.planN ? x.avvik : "", tt(STATUS_TEKST[x.status])]))
    .concat([[tt("Totalt prosjektet"), r.ferdig, r.n, r.pst, r.plan.n, r.plan.n ? r.plan.pst : "", r.plan.n ? r.plan.faktiskPst : "", r.plan.n ? r.plan.avvik : "", tt(STATUS_TEKST[r.plan.status])]]);
}
export function internTrinnRader(r, T) {
  const tt = T || ((x) => x);
  return [[tt("Trinn"), tt("Navn"), tt("Fra"), tt("Til"), tt("Objekter"), tt("Ferdig"), tt("% ferdig"), tt("Plan i dag %"), tt("Avvik %-poeng"), tt("Status")]]
    .concat(r.trinn.map(x => [x.nr, x.navn, datoNo(x.dato), datoNo(x.slutt), x.n, x.ferdig, x.pst, x.planPst, x.avvik, tt(STATUS_TEKST[x.status])]));
}
export function internObjektRader(r, T) {
  const tt = T || ((x) => x);
  return [[tt("Elementtype"), tt("Navn"), "GlobalId / id", tt("Trinn"), tt("Plan ferdig"), tt("Status"), tt("Ferdigmeldt"), tt("Av"), tt("Kilde")]]
    .concat(r.rader.map(x => {
      const tt2 = trinnTid(x.trinn);
      return [tt(x.gruppe), x.navn, x.gid || idFor(x.k), x.trinn ? x.trinn.nr + " · " + x.trinn.navn : "", tt2 ? datoNo(isoFraDag(tt2.b - 1)) : "",
        tt(FARGE_TEKST[x.farge]), x.melding ? tidNo(x.melding.tid) : "", x.melding ? x.melding.av : "",
        x.melding ? (x.melding.kilde === "bygg" ? tt("byggeplassen") : tt("kontoret")) : ""];
    }));
}
// Fargene i Excel-arkene: status-kolonnen (eller hele raden for objektene)
export function excelStil(fargeFor, kolonner) {
  return (i, k) => {
    if (i === 0) return 3;
    if (k >= kolonner) return 0;
    const f = fargeFor(i - 1);
    return f ? EXCEL_STIL[f] || 0 : 0;
  };
}
