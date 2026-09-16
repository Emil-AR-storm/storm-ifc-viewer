// 🔩 Stålet lest ut av modellen og projisert på fasadene — utsparingskandidater,
// ringmurbiter — og instruksjonstegningen (PDF).
//
// Én av åtte deler av SW-generatoren. js/veggelement.js er inngangen og
// samler dem; se toppen av den fila for hva generatoren gjør.
//
// DELENE PEKER PÅ HVERANDRE BEGGE VEIER, og det er med vilje: dette var én
// fil på 6500 linjer, og å rive den i atskilte lag ville vært en omskriving,
// ikke en oppdeling. ES-moduler tåler ringer så lenge navnene brukes når
// koden KJØRER, ikke mens modulen lastes — derfor står det bare
// registreringer av lyttere på toppnivå her, aldri utregninger som leser en
// konstant fra en annen del.

import * as THREE from "three";
import { $, S } from "../state.js";
import { t } from "../i18n.js";
import { allElementBoxes, forHverTrekant } from "../elements.js";
import { alleElementIder } from "../ifc.js";
import { sikreMeta } from "../ifcrpc.js";
import { hentLogo } from "../tegninger.js";
import { UTSP_PORT_BREDDE_MM, foreslaUtspType, konveksHull, soyleTypeNavn, tilMm, tilScene } from "./regler.js";
import { STD_OPPSETT, lagret, oppsett } from "./tilstand.js";
import { baseYNaa, utspPaFasader } from "./tegning.js";
import { felt, lesOppsettFraPanel } from "./generer.js";

// ---------- 📐 Instruksjonstegning (PDF i Moelv-format) ----------
// Feltene tittelfeltet skal fylles med. Tomt «Utfyll PDF»-felt arver fra
// Til lista-feltet over, så ingen trenger å skrive prosjektnavnet to ganger.
export function pdfFelt(o, iDag) {
  return {
    fase: o.pdfFase || "",
    prosjekt: o.pdfProsjekt || o.prosjekt || "",
    undertittel: o.pdfUndertittel || o.sted || "",
    tittel: o.pdfTittel || t("SW-Elementer"),
    oppdragsnr: o.pdfOppdrag || o.oppdragsnr || "",
    tegnet: o.pdfTegnet || o.sign || "",
    kontroll: o.pdfKontroll || "",
    godkjent: o.pdfGodkjent || "",
    dato: o.pdfDato || iDag,
    nr: o.pdfNr || "SW-01",
    merknad: o.pdfMerknad || ""
  };
}

// Byggets EKTE aksenavn, når 🔠 Akser er bygget.
//
// FEILEN SOM MÅTTE RETTES (Emil 03.09): første versjon lette i BEGGE
// aksefamiliene og tok den nærmeste. For en fasade som går langs X har alle
// punktene på fasaden nesten samme z — og da traff SAMME bokstavakse på hvert
// eneste punkt. Fasade 1 fikk «A, A, A» og fasade 2 «6, D, 6».
//
// Bare familien som KRYSSER fasaden kan navngi punkter langs den:
//  · fasade langs X krysses av linjene med fast x (tallaksene)
//  · fasade langs Z krysses av linjene med fast z (bokstavaksene)
// En skrå fasade krysses av begge på skrå, og da er det ingen av dem som gir et
// ærlig navn — den faller tilbake på A, B, C for seg.
export function akseNavnFor(fi, fasader) {
  const L = S.akseLinjer;
  const f = (fasader || (lagret && lagret.fasader) || [])[fi];
  if (!L || !f) return () => null;
  const ax = Math.abs(f.ex), az = Math.abs(f.ez);
  // 0,92 ≈ 23° skrå. Mer enn det, og aksene står ikke på tvers av fasaden.
  const langsX = ax > 0.92, langsZ = az > 0.92;
  if (!langsX && !langsZ) return () => null;
  const linjer = langsX ? (L.x || []) : (L.z || []);
  if (!linjer.length) return () => null;
  const tol = L.tol > 0 ? L.tol : 0.4 / (S.enhetSkala || 1);
  return (_fi, mm) => {
    const tt = tilScene(mm);
    const v = langsX ? f.px + f.ex * tt : f.pz + f.ez * tt;
    let best = null, bestD = tol;
    for (const a of linjer) { const dd = Math.abs(v - a.c); if (dd <= bestD) { bestD = dd; best = a.navn; } }
    return best;
  };
}

// ---------- 🔩 Stålet projisert på fasadene, REGNET UT VED TEGNING ----------
// Emil 03.09: «stål rundt portene/stålbjelker og søyler som ikke er tildekket
// av veggelement vises ikke på tegningen, det skal de».
//
// REGNES UT VED TEGNING, ikke lagret ved generering. Stålet står i modellen —
// og modellen ER åpen, for SW-panelet krever den. Hadde det blitt lagret i
// `generer()`, ville tegninga stått uten stål for alle som åpner en modell med
// vegger som alt ligger i localStorage. Det er nøyaktig fella fra runde 18.
//
// Rekkefølgen i tegninga gjør klippingen: stålet tegnes FØR elementene, så det
// som ligger bak veggen blir dekket, og bare det frie stålet står igjen.
export const STAL_TYPER = ["Column", "Beam", "Member", "Plate"];

export async function stalPaFasader(fasader, oppsettInn, baseYInn) {
  fasader = fasader || (lagret && lagret.fasader) || [];
  if (!fasader.length) return [];
  if (!S.glbActive) await sikreMeta(alleElementIder);
  const bokser = allElementBoxes();
  // Hvor nær veggplanet må boksens SENTER stå? En søyle på fasaden ligger på
  // planet; en takbjelke innover i bygget har senteret sitt langt inne og skal
  // IKKE bli et digert rektangel over hele fasaden.
  const naer = Math.max(0.8 / (S.enhetSkala || 1),
    tilScene((oppsettInn || (lagret && lagret.oppsett) || STD_OPPSETT).tykkelseMm) * 3);
  const baseY = baseYInn !== undefined ? baseYInn : baseYNaa();
  const ut = [];
  for (const [id, b] of bokser) {
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    // NÆRMESTE fasade, ikke den første som er innenfor toleransen. En bjelke
    // ved et hjørne ligger nær to fasadeplan, og «første treff» la den på den
    // fasaden som tilfeldigvis kom først i lista.
    let best = -1, bestD = Infinity, bestT = null;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      const dd = Math.abs((cx - f.px) * f.nx + (cz - f.pz) * f.nz);
      if (dd > naer || dd >= bestD) continue;
      // hele boksen projiseres på fasadeaksen — alle fire hjørnene, som
      // utsparingerPaFasade gjør
      const ts = [];
      for (const pxx of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z])
        ts.push((pxx - f.px) * f.ex + (pz - f.pz) * f.ez);
      const t0 = Math.min(...ts), t1 = Math.max(...ts);
      // og den må faktisk ligge LANGS fasaden, ikke bare nær planet dens
      const fT0 = Math.min(f.t0, f.t1) - naer, fT1 = Math.max(f.t0, f.t1) + naer;
      if (t1 < fT0 || t0 > fT1) continue;
      best = fi; bestD = dd; bestT = [t0, t1];
    }
    if (best < 0) continue;
    const fraMm = tilMm(bestT[0]), tilMm_ = tilMm(bestT[1]);
    if (tilMm_ - fraMm < 20) continue;
    ut.push({ fi: best, id, type: soyleTypeNavn(id),
      fraMm: Math.round(fraMm), tilMm_: Math.round(tilMm_),
      bunnMm: Math.round(tilMm(b.min.y - baseY)),
      toppMm: Math.round(tilMm(b.max.y - baseY)) });
  }
  // 🔩 SILHUETTEN, ikke boksen. En SKRÅ takbjelke har en akse-justert boks som
  // er like høy som mønet langs hele spennet, og tegnet som et rektangel fylte
  // den hele gavltrekanten med stål (Emil 08.09: «utfylte områder hvor det ikke
  // skal være det»). Her hentes den FAKTISKE omrisset ut av trekantene:
  // punktene projiseres på fasaden, bøttes langs den, og det konvekse hullet av
  // dem er omrisset. En rett søyle eller bjelke gir nøyaktig samme rektangel som
  // før — flate bygg endrer seg ikke — mens en skrå bjelke blir en skrå stav.
  const perId = new Map(ut.map(r => [r.id, r]));
  const bytter = new Map();   // id → Map(bøtte → [t, minY, maxY])
  const botte = tilScene(50) || 0.05;
  const v3 = new THREE.Vector3();
  forHverTrekant(new Set(perId.keys()), (pos, i0, i1, i2, mtx, id) => {
    const r = perId.get(id);
    const f = fasader[r.fi];
    let m = bytter.get(id);
    if (!m) { m = new Map(); bytter.set(id, m); }
    for (const i of [i0, i1, i2]) {
      v3.fromBufferAttribute(pos, i);
      if (mtx) v3.applyMatrix4(mtx);
      const t = (v3.x - f.px) * f.ex + (v3.z - f.pz) * f.ez;
      const k = Math.round(t / botte);
      const e = m.get(k);
      if (!e) m.set(k, [t, v3.y, v3.y]);
      else { if (v3.y < e[1]) e[1] = v3.y; if (v3.y > e[2]) e[2] = v3.y; }
    }
  });
  for (const r of ut) {
    const m = bytter.get(r.id);
    if (!m || m.size < 2) continue;
    const p = [];
    for (const [t, lo, hi] of m.values()) {
      p.push({ x: tilMm(t), z: tilMm(lo - baseY) });
      if (hi !== lo) p.push({ x: tilMm(t), z: tilMm(hi - baseY) });
    }
    const hull = konveksHull(p);
    if (hull.length >= 3)
      r.poly = hull.map(q => [Math.round(q.x), Math.round(q.z)]);
  }
  return ut;
}

// ═══════════════════ 🔍 AUTOMATISK UTSPARINGSSØK (Emil 08.09, punkt 4) ═══════════════════
// En åpning i et stålbygg er ikke en gjetning — den er rommet under en
// LOSHOLT, mellom to søyler. stalPaFasader() har alt stålet projisert på hvert
// fasadeplan i mm, og herfra er det rene tall:
//   over:  en vannrett bjelke i fasadeplanet med underkant mellom
//          OK betong + 1000 mm og veggtoppen − 200 mm (en losholt)
//   sider: nærmeste søyle på hver side av bjelken — åpningen går fra
//          innsiden av den ene til innsiden av den andre
//   under: gulvet, eller overkanten av en bjelke som ligger lavere mellom de
//          samme to søylene (det gir et vindu i stedet for en dør)
// Forkastes: en bjelke over hele fasaden (gesims/ringbjelke), bjelker kortere
// enn 500 mm, kandidater smalere eller lavere enn 500 mm, og kandidater som
// overlapper en utsparing som alt finnes. Flyten er FORESLÅ OG GODKJENN —
// ingenting legges inn uten at Emil har godkjent det.
export const FINN_MIN_MM = 500;
export const FINN_TOL_MM = 300;          // hvor nær en ende/topp må «treffe»
export const FINN_STOLPE_TOPP_TOL_MM = 150;   // stolpens topp mot losholtens underkant
export const FINN_GESIMS_MM = 300;       // bjelke med overkant så nær søyletoppen er gesims
export const FINN_LOSHOLT_MAKS_H_MM = 250;    // en losholt er et slankt ledd; tykkere er drager/gitter
export const FINN_MIN_HOYDE_MM = 500;
export const FINN_BJELKE_MAKS_H_MM = 1000;    // høyere boks enn dette er et kryss/gitter, ikke en bjelke
export const FINN_DOR_MIN_HOYDE_MM = 1800;     // en åpning fra gulvet lavere enn dette er ingen dør
export const FINN_VINDU_MIN_HOYDE_MM = 800;    // et vindu lavere enn dette er et bånd mellom to skinner
export const FINN_DOR_BREDDE_MM = [800, 1400]; // dørbredde, til de tvetydige rommene ved en rammesøyle
// `stal`: [{ fi, type, fraMm, tilMm_, bunnMm, toppMm }] (mm over SW-basen)
// `fasader`: [{ lengdeMm, toppMm, okBetongMm, skjot }] per fi — okBetongMm er OK
//   betong målt fra SW-basen (0 uten ringmur, −ringhøyde med); `skjot` er
//   fasadens søyleposisjoner i mm (hjørnesøylene kan mangle i `stal`, fordi
//   en hjørnesøyle bare hører til ÉN fasade)
// `finnes`: [{ fi, fraMm, tilMm_, bunnMm, toppMm }] utsparinger som alt finnes
//
// REGELEN, lest av seks ekte stålbygg (Geithus, Sundland, Arendal, Hegdal-
// ringen, Norsjø, Valle — 09.09.2026): en åpning er ROMMET MELLOM TO STOLPER
// UNDER EN LOSHOLT.
//   • Stolpene: stående søyler som når opp til losholten og går ned under den.
//     Dør og port har stolper (karmstolper) fra gulvet og opp i losholten;
//     et vindu har korte stolper mellom brystning og losholt.
//   • Rommet mellom to nabostolper er en åpning når BEGGE er stolper (ikke
//     rammesøyler) og den laveste av dem slutter i losholten — eller når
//     begge er rammesøyler, losholten er slank, spenner nøyaktig feltet og
//     ingenting annet står i feltet (en port over hele feltet).
//     Stolpe + rammesøyle er VEGG: karmstolpen står der fordi det er en
//     åpning på den ANDRE siden av den.
//   • Bunnen er gulvet, eller den høyeste bjelken som spenner rommet under
//     losholten (brystningen) — da er det et vindu.
// Forkastes: gesimsen (bjelke med overkant nær søyletoppen), bjelker
// kortere enn 500, rom smalere/lavere enn 500, og rom som overlapper en
// utsparing som alt finnes eller en kandidat som alt er tatt.
export function finnUtsparingKandidater(stal, fasader, finnes) {
  const ut = [];
  // RINGBJELKENE: en bjelke over (nesten) hele en fasade med flere felt er en
  // ringbjelke/veggdrager som går rundt bygget — også der den dukker opp som
  // en kort bit på en liten fasade (Valles knekk). Høydene samles for hele
  // bygget, og ingen bjelke i en slik høyde er en losholt.
  const ringHoyder = [];
  (fasader || []).forEach((f, fi) => {
    if (!f || ((f.skjot || []).length - 1) < 2) return;
    const L = Number(f.lengdeMm) || 0;
    for (const r of (stal || [])) {
      if (!r || r.fi !== fi || r.type === "Column" || r.type === "Plate") continue;
      if (L > 0 && (r.tilMm_ - r.fraMm) >= 0.9 * L && (r.tilMm_ - r.fraMm) > (r.toppMm - r.bunnMm)) ringHoyder.push([r.bunnMm, r.toppMm]);
    }
  });
  // samme bjelke = samme under- OG overkant (Sundlands vinduslosholt på 8250
  // ligger 30 mm fra en gavlbjelke på 8220, men er 100 og ikke 60 høy)
  const iRingHoyde = (h) => ringHoyder.some(([b, t]) => Math.abs(b - h.bunnMm) <= 60 && Math.abs(t - h.toppMm) <= 60);
  const overlapper = (a, b) => a.fi === b.fi &&
    Math.min(a.tilMm_, b.tilMm_) - Math.max(a.fraMm, b.fraMm) > 0 &&
    Math.min(a.toppMm, b.toppMm) - Math.max(a.bunnMm, b.bunnMm) > 0;
  (fasader || []).forEach((f, fi) => {
    if (!f) return;
    const okMm = Number(f.okBetongMm) || 0;
    const paa = (stal || []).filter(r => r && r.fi === fi);
    // STÅENDE ledd (søyler): høyere enn de er lange
    const staaende = paa.filter(r => r.type === "Column" && (r.toppMm - r.bunnMm) > (r.tilMm_ - r.fraMm))
      .map(r => ({ fraMm: r.fraMm, tilMm_: r.tilMm_, bunnMm: r.bunnMm, toppMm: r.toppMm }));
    // RAMMESØYLENES TOPP = det høyeste stående leddet som står PÅ GULVET.
    // Søyleforlengerne er egne bokser som står oppå søylene og går til
    // veggtoppen — de er ikke søyler, og skal ikke gjøre rammesøylene til
    // «stolper» ved å heve målet.
    const fraGulvet = staaende.filter(k => k.bunnMm <= okMm + FINN_MIN_HOYDE_MM && k.toppMm - k.bunnMm >= 1000);
    const soyleTopp = fraGulvet.length ? Math.max(...fraGulvet.map(k => k.toppMm)) : (Number(f.toppMm) || 0);
    // en rammesøyle når (nesten) opp til den høyeste: 300 mm eller 10 % slark
    const rammeTol = Math.max(FINN_GESIMS_MM, 0.1 * (soyleTopp - okMm));
    // hjørnesøyler og andre rammesøyler fra skjøtlista som mangler i stålet
    // (en forlengerstubb oppe ved veggtoppen teller ikke som søyla — den står
    // ikke på gulvet, Valle)
    for (const t of (f.skjot || [])) {
      if (!staaende.some(k => Math.abs((k.fraMm + k.tilMm_) / 2 - t) <= FINN_TOL_MM && k.bunnMm <= okMm + FINN_MIN_HOYDE_MM))
        staaende.push({ fraMm: t, tilMm_: t, bunnMm: okMm, toppMm: soyleTopp, virtuell: true });
    }
    const erRamme = (k) => k.toppMm >= soyleTopp - rammeTol;
    // LIGGENDE ledd (bjelker): lengre enn de er høye, minst 500, ikke gesims,
    // og ikke en KASSE (et vindkryss eller et gitter har en boks som er både
    // lang og høy — den er ikke en bjelke)
    const lengde = Number(f.lengdeMm) || 0;
    const liggende = paa.filter(r => r.type !== "Column" && r.type !== "Plate"
      && (r.tilMm_ - r.fraMm) >= FINN_MIN_MM
      && (r.tilMm_ - r.fraMm) > (r.toppMm - r.bunnMm));
    const bjelker = liggende.filter(r => (r.toppMm - r.bunnMm) <= FINN_BJELKE_MAKS_H_MM
      && r.toppMm < soyleTopp - FINN_GESIMS_MM
      // en bjelke som stikker langt utenfor fasaden er en takutstikk/baldakin-
      // bjelke som bare ligger i planet — ikke en losholt i veggen
      && r.fraMm >= -FINN_TOL_MM * 2 && (lengde <= 0 || r.tilMm_ <= lengde + FINN_TOL_MM * 2));
    // KASSENE: et vindkryss — et 100 mm rør på skrå — har en boks stor som
    // feltet. Et felt med et kryss som står INNE I rommet (både i bredden og i
    // høyden) er avstivet, og der er det ingen åpning (Norsjøs gavl). Et
    // skråstag som går over flere felt eller høyere enn rommet (Arendal, Valle
    // har slike bak både vinduer og dør) teller ikke.
    const kasser = liggende.filter(r => (r.toppMm - r.bunnMm) > FINN_BJELKE_MAKS_H_MM);
    const avstivet = (fraMm, tilMm_, bunn, topp) => kasser.some(k =>
      k.fraMm >= fraMm - FINN_TOL_MM && k.tilMm_ <= tilMm_ + FINN_TOL_MM &&
      k.bunnMm >= bunn - FINN_TOL_MM && k.toppMm <= topp + FINN_TOL_MM &&
      (k.toppMm - k.bunnMm) >= 0.8 * (topp - bunn));
    // en bjelke over (nesten) hele fasaden er en ringbjelke/veggdrager, ikke en losholt
    const gjennomgaaende = (h) => lengde > 0 && ((f.skjot || []).length - 1) >= 2 && (h.tilMm_ - h.fraMm) >= 0.9 * lengde;
    // en GIRTLINJE: en annen bjelke i samme høyde et annet sted på fasaden —
    // da er bjelken en veggskinne som går rundt bygget, og feltet under den er
    // vegg der ingen stolper henger under (Arendal). En port over hele feltet
    // har en losholt som bare finnes der (Geithus).
    const iLinje = (h) => bjelker.some(o => o !== h && Math.abs(o.bunnMm - h.bunnMm) <= 100
      && (o.fraMm >= h.tilMm_ - FINN_TOL_MM || o.tilMm_ <= h.fraMm + FINN_TOL_MM));
    // Kandidatene samles i tre klasser og godkjennes i denne rekkefølgen:
    //   1. stolpe + stolpe (sikre) — karmstolpene «brukes opp»
    //   2. rammesøyle + rammesøyle (port over hele feltet)
    //   3. stolpe + rammesøyle — bare når karmstolpen ikke alt hører til en
    //      åpning på den andre siden, og rommet har dør- eller portbredde
    const sikre = [], felt = [], blandet = [];
    for (const h of bjelker) {
      if (h.bunnMm - okMm < FINN_MIN_HOYDE_MM) continue;          // ligger på gulvet
      if (iRingHoyde(h)) continue;
      // EN LOSHOLT ER SLANK. På alle seks byggene er losholtene 100–140 mm
      // høye; dragere, veggskinner og gesimsbjelker er 280–350. En tykk bjelke
      // bærer noe — den er ikke overdekningen over en åpning.
      if (h.toppMm - h.bunnMm > FINN_LOSHOLT_MAKS_H_MM) continue;
      // sidene: stående ledd som NÅR losholten og GÅR NED under den, innenfor
      // losholtens lengde (± toleranse)
      const sider = staaende.filter(k =>
        k.toppMm >= h.bunnMm - FINN_STOLPE_TOPP_TOL_MM &&
        k.bunnMm <= h.bunnMm - FINN_MIN_HOYDE_MM &&
        // … og som står i eller inntil losholtens lengde: en 300 mm rammesøyle
        // som begynner 13 mm før losholten er fortsatt siden dens (Hegdalringen)
        k.tilMm_ >= h.fraMm - FINN_TOL_MM && k.fraMm <= h.tilMm_ + FINN_TOL_MM)
        .sort((a, b) => a.fraMm - b.fraMm);
      // ender losholten ved en rammesøyle i hver ende? (en losholt for feltet)
      const rammer = staaende.filter(erRamme);
      const enderVedRammer = rammer.some(k => Math.abs(k.tilMm_ - h.fraMm) <= FINN_TOL_MM || Math.abs(k.fraMm - h.fraMm) <= FINN_TOL_MM)
        && rammer.some(k => Math.abs(k.fraMm - h.tilMm_) <= FINN_TOL_MM || Math.abs(k.tilMm_ - h.tilMm_) <= FINN_TOL_MM);
      for (let i = 0; i + 1 < sider.length; i++) {
        const v = sider[i], hs = sider[i + 1];
        const fraMm = v.tilMm_, tilMm_ = hs.fraMm;
        if (tilMm_ - fraMm < FINN_MIN_MM) continue;
        const rammeV = erRamme(v), rammeH = erRamme(hs);
        const enderVedSidene = Math.abs(h.fraMm - fraMm) <= FINN_TOL_MM && Math.abs(h.tilMm_ - tilMm_) <= FINN_TOL_MM;
        const slutterI = (k) => Math.abs(k.toppMm - h.bunnMm) <= FINN_STOLPE_TOPP_TOL_MM;
        let klasse;
        if (!rammeV && !rammeH) {
          // to stolper: begge står på det samme (gulvet, eller brystningen) —
          // vinduets stolper står begge på brystningen, karmstolpene begge på
          // gulvet. Ulik fot = en karmstolpe og en panelstolpe = vegg.
          if (Math.abs(v.bunnMm - hs.bunnMm) > FINN_TOL_MM) continue;
          // … og den laveste slutter i losholten, ELLER losholten går nøyaktig
          // fra stolpe til stolpe (Sundlands portkarmer går høyere enn losholten)
          if (!slutterI(v.toppMm < hs.toppMm ? v : hs) && !enderVedSidene) continue;
          klasse = sikre;
        } else if (rammeV && rammeH) {
          // to rammesøyler: slank losholt som ender ved rammesøyler, og
          // ingenting stående i feltet under den (en port over hele feltet —
          // også når porten går forbi en søyle midt i, Geithus)
          if (!enderVedRammer) continue;
          klasse = felt;
        } else {
          // stolpe + rammesøyle: losholten går nøyaktig fra stolpen til søyla
          // (en losholt laget for dette rommet — Arendals dør med karmstolpe
          // som går opp i vindushøyde, Norsjøs vindu inn mot søyla), ELLER
          // karmstolpen slutter i losholten og rommet har dør-/portbredde
          // (bredden avgjøres under, når karmstolpene er delt ut)
          const stolpe = rammeV ? hs : v;
          if (!enderVedSidene && !slutterI(stolpe)) continue;
          klasse = blandet;
        }
        // bunnen: gulvet, eller den høyeste bjelken som spenner rommet under losholten
        let bunn = okMm, underBjelke = false;
        for (const u of bjelker) {
          if (u === h || u.toppMm > h.bunnMm - FINN_MIN_HOYDE_MM || u.toppMm <= okMm) continue;
          if (u.fraMm > fraMm + FINN_TOL_MM || u.tilMm_ < tilMm_ - FINN_TOL_MM) continue;
          if (u.toppMm > bunn) { bunn = u.toppMm; underBjelke = true; }
        }
        // stolpene til et vindu står PÅ brystningen — bunnen er aldri under stolpefoten
        const stolper = [v, hs].filter(k => !erRamme(k));
        if (stolper.length) {
          const fot = Math.min(...stolper.map(k => k.bunnMm));
          if (fot > okMm + FINN_TOL_MM) bunn = Math.max(bunn, fot);
        }
        if (h.bunnMm - bunn < FINN_MIN_HOYDE_MM) continue;
        if (avstivet(fraMm, tilMm_, bunn, h.bunnMm)) continue;
        // to rammesøyler: ingenting må stå i selve åpningen (mellom bunnen og
        // losholten). Stolper LAVERE i feltet er ikke i veien — Valle har
        // vindusbånd på 8100 over portene i samme felt.
        if (klasse === felt && staaende.some(k => k.fraMm > fraMm && k.tilMm_ < tilMm_
            && k.bunnMm < h.bunnMm - FINN_TOL_MM
            && k.toppMm > bunn + FINN_TOL_MM)) continue;
        // et felt mellom to rammesøyler FRA GULVET under en girtlinje er vegg
        // (Arendal: veggskinna i vindushøyde går videre over tomme felt); med
        // brystning under er det et vindu over hele feltet (Norsjø)
        if (klasse === felt && !underBjelke && !enderVedSidene && iLinje(h)) continue;
        // … og et felt fra gulvet under en bjelke over hele fasaden er vegg under
        // en ringbjelke (Sundlands gavl). Et vindu med brystning kan derimot
        // godt fylle en kort fasade (Valle).
        if (klasse === felt && !underBjelke && gjennomgaaende(h)) continue;
        // en åpning fra gulvet er en dør eller port — lavere enn 1800 er den
        // ingen av delene (brystningen under et vindu ga «porter» på 1100)
        if (bunn <= okMm + FINN_TOL_MM && h.bunnMm - bunn < FINN_DOR_MIN_HOYDE_MM) continue;
        // … og et «vindu» lavere enn 800 er båndet mellom to veggskinner
        if (bunn > okMm + FINN_TOL_MM && h.bunnMm - bunn < FINN_VINDU_MIN_HOYDE_MM) continue;
        klasse.push({ fi, fraMm: Math.round(fraMm), tilMm_: Math.round(tilMm_),
          bunnMm: Math.round(bunn), toppMm: Math.round(h.bunnMm), underBjelke,
          type: foreslaUtspType(bunn - okMm, tilMm_ - fraMm),
          stolper: stolper.map(k => k.fraMm), losholt: h, egenLosholt: enderVedSidene });
      }
    }
    // Karmstolper som alt er brukt av en sikker åpning gjør rommet på den
    // ANDRE siden av seg til vegg. Blandede rom må dessuten ha dør- eller
    // portbredde — et rom på 1500 eller 700 ved siden av en karmstolpe er vegg.
    // En port som går forbi en rammesøyle midt i (Geithus: 6 m port over to
    // felt) kommer som to feltrom under samme losholt — slås sammen til én.
    felt.sort((a, b) => a.fraMm - b.fraMm || a.toppMm - b.toppMm);
    for (let i = 0; i + 1 < felt.length; i++) {
      const a = felt[i], b = felt[i + 1];
      if (a.losholt === b.losholt && a.bunnMm === b.bunnMm && b.fraMm - a.tilMm_ <= FINN_TOL_MM) {
        a.tilMm_ = b.tilMm_; a.type = foreslaUtspType(a.bunnMm - okMm, a.tilMm_ - a.fraMm);
        felt.splice(i + 1, 1); i--;
      }
    }
    const brukt = new Set();
    for (const k of sikre) for (const st of k.stolper) brukt.add(st);
    // innenfor hver klasse: den laveste losholten først (dør under vindu)
    const lavest = (a, b) => a.toppMm - b.toppMm || a.fraMm - b.fraMm;
    sikre.sort(lavest); felt.sort(lavest); blandet.sort(lavest);
    const kand = sikre.concat(felt, blandet.filter(k => {
      // en losholt laget for rommet gjør rommet sikkert — også når stolpen
      // samtidig er karm for en åpning på den andre siden (Norsjø: vindu og dør
      // deler stolpe, hver med sin losholt)
      if (k.egenLosholt) return true;
      if (k.stolper.some(st => brukt.has(st))) return false;
      const b = k.tilMm_ - k.fraMm;
      return (b >= FINN_DOR_BREDDE_MM[0] && b <= FINN_DOR_BREDDE_MM[1]) || b >= UTSP_PORT_BREDDE_MM;
    }));
    // De sikre først, så feltene, så de blandede; innenfor klassen den laveste
    // losholten først (dør under vindu). Overlapp med noe som finnes, eller med
    // en kandidat som alt er tatt, forkastes.
    const topp = Number(f.toppMm) || 0;
    const tatt = (finnes || []).filter(u => u && u.fi === fi).map(u => ({
      fi, fraMm: u.fraMm, tilMm_: u.tilMm_, bunnMm: u.bunnMm,
      toppMm: Math.abs(u.toppMm) > 1e8 ? topp : u.toppMm }));
    const godkjent = [];
    for (const k of kand) {
      if (tatt.some(u => overlapper(u, k))) continue;
      tatt.push(k);
      godkjent.push(k);
    }
    // ANDRE PASS, på det som sto igjen: to bånd som deler en skinne er vegg
    // det ene stedet — men bare der det er ENTYDIG hvilket. Ellers står begge,
    // og Emil slår av det gale (et klikk koster mindre enn en åpning han må
    // markere selv).
    //   • båndet RETT OVER en dør eller port: k.bunn = åpningens topp, og
    //     åpningen står på gulvet (Norsjø, Arendal, Valle)
    //   • brystningen UNDER et vindu MED STOLPER: vinduets stolper står på
    //     skinna, så den er brystning og ikke losholt (Sundland)
    // Et vindu over et vindu (Norsjø) har brystning MELLOM og rammes ikke.
    const overlappX = (a, b) => Math.min(a.tilMm_, b.tilMm_) - Math.max(a.fraMm, b.fraMm)
      > 0.5 * Math.min(a.tilMm_ - a.fraMm, b.tilMm_ - b.fraMm);
    //   • to bånd UTEN stolper som deler en skinne (Valle: drager | bånd |
    //     skinne | vindu | losholt): skinna er vinduets brystning — det øvre
    //     står, det nedre er vegg
    const bort = new Set();
    for (const k of godkjent) {
      for (const o of godkjent) {
        if (o === k || !overlappX(o, k)) continue;
        const kOverO = Math.abs(o.toppMm - k.bunnMm) <= FINN_STOLPE_TOPP_TOL_MM;
        const kUnderO = Math.abs(o.bunnMm - k.toppMm) <= FINN_STOLPE_TOPP_TOL_MM;
        if (kOverO && (o.bunnMm <= okMm + FINN_TOL_MM || o.stolper.length === 2)) { bort.add(k); break; }
        if (kUnderO && o.stolper.length === 2 && o.underBjelke) { bort.add(k); break; }
        if (kUnderO && !o.stolper.length && !k.stolper.length && o.underBjelke && k.underBjelke) { bort.add(k); break; }
      }
    }
    for (const k of godkjent) {
      if (bort.has(k)) continue;
      ut.push({ fi: k.fi, fraMm: k.fraMm, tilMm_: k.tilMm_, bunnMm: k.bunnMm, toppMm: k.toppMm, underBjelke: k.underBjelke, type: k.type });
    }
  });
  return ut;
}
// En kandidat (mm på fasaden) → en lagret utsparing i sceneenheter, samme form
// som «Marker utsparing» lager: boksen ligger i veggplanet (off) og går
// tykkelsen + slark ut til hver side, så apningPaVegg finner den igjen.
export function kandidatTilUtsparing(k, f, baseY, tykkelseMm) {
  const off = Number(f.off) || 0;
  const halv = tilScene((Number(tykkelseMm) || 0) / 2 + 300);
  const xs = [], zs = [];
  for (const tt of [tilScene(k.fraMm), tilScene(k.tilMm_)])
    for (const d of [off - halv, off + halv]) {
      xs.push(f.px + f.ex * tt + f.nx * d);
      zs.push(f.pz + f.ez * tt + f.nz * d);
    }
  return {
    min: [Math.min(...xs), baseY + tilScene(k.bunnMm), Math.min(...zs)],
    max: [Math.max(...xs), baseY + tilScene(k.toppMm), Math.max(...zs)],
    akse: Math.abs(f.ex) >= Math.abs(f.ez) ? "x" : "z",
    type: k.type, kilde: { topp: "losholt", bunn: k.underBjelke ? "bjelke" : "åpen", sider: "søyler" }
  };
}

// ---------- Ringmurbitene projisert på fasadene ----------
// Ringmuren lagres som biter i scenerommet ({x, z, y, lengde, hoyde, rot}) —
// og den er ALT kappet der utsparingene tar den. Tegninga må bruke bitene, ikke
// ett bånd tvers over fasaden: da sto det ringmur under porten (Emil 03.09).
// Ringmurbitene projisert på fasadene. REGELEN (tilordning etter retning, ikke
// avstand) ligger i js/sw-tegning.js som en ren funksjon — der kan den prøves.
// Her hentes bare dataene ut av lagringen.
export async function ringmurPaFasader(mod) {
  return mod.ringmurTilFasader(
    (lagret && lagret.ringmur) || [],
    (lagret && lagret.fasader) || [],
    tilMm, baseYNaa());
}

export async function lastNedTegning() {
  const o = lesOppsettFraPanel();
  if (!lagret || !(lagret.vegger || []).length) {
    alert(t("Generer veggelementene først."));
    return;
  }
  if (!(lagret.fasader || []).length) {
    alert(t("Veggene er laget av en eldre versjon — trykk «Generer SW + gulv/ringmur» før du tegner."));
    return;
  }
  const knapp = $("swTegning");
  if (knapp) knapp.disabled = true;
  try {
    const mod = await import("./sw-tegning.js");
    // Ett navneoppslag per FASADE, ikke per punkt: akseNavnFor gjør oppslaget
    // i S.akseLinjer én gang og lukker over fasaden.
    const navnere = new Map();
    const navnFor = (fi) => {
      if (!navnere.has(fi)) navnere.set(fi, akseNavnFor(fi, lagret.fasader));
      return navnere.get(fi);
    };
    await mod.lastNedTegning({
      vegger: lagret.vegger,
      fasader: lagret.fasader,
      oppsett: o,
      utsparinger: utspPaFasader(),
      ringmurBiter: await ringmurPaFasader(mod),
      // scene ↔ mm. Den rene delen skal ikke vite om S.enhetSkala.
      tilMm, tilScene,
      stal: await stalPaFasader(lagret.fasader, o, baseYNaa()),
      aksenavn: (fi, mm) => navnFor(fi)(fi, mm),
      felt: pdfFelt(o, mod.idag()),
      hentLogo: () => hentLogo((($("swPdfLogo") || {}).value) || "")
    });
  } catch (err) {
    console.warn("Instruksjonstegning:", err);
    alert(t("Klarte ikke å lage tegninga: ") + (err && err.message || err));
  } finally {
    const b = $("swTegning");
    if (b) b.disabled = false;
  }
}
