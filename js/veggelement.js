// 🧱 SW-generator: automatiske veggelementer (sandwichpaneler) på stålmodeller.
//
// HVA DEN GJØR (Emils spesifikasjon, Ideer/Automatisk SW,veggelement liste…txt):
//  · finner søylene (IfcColumn) og fasadene deres automatisk (konveks hull)
//  · genererer gulv (betong + isolasjon, OK betong = bunn av søylene, med
//    valgt utstikk forbi søylene) og valgfri ringmur inntil utvendige søyler
//  · fyller hver fasade med veggelementer søyle-til-søyle: elementet stopper
//    25 mm fra søylesenter (to naboelementer får 50 mm mellomrom), og radene
//    stables med 1100- og 1000-høyder til topp av søyleforlengerne — går ikke
//    høyden opp, kappes øverste rad (Emils valg 01.09)
//  · utsparinger (dører/vinduer/porter): trykk «Marker utsparing» og pek på
//    FLATENE rundt åpningen — innsiden av søylene på sidene, undersiden av
//    bjelken over. Én flate per side (Emils runde 3: hele elementer dro med
//    seg tre gale sider hver gang)
//  · hver unik lengde×høyde får et SW-nummer (SW-01, SW-02 …); kappede
//    tilpasningsbiter heter SW-XX, som på Moelv-tegningene
//  · veggene tegnes PÅ PLASS i 3D med valgt farge, OG hvert SW-nummer legges
//    som leveransestabel i 📦 Materiell (sandwichpanel) — da kommer antall og
//    areal i Mengder av seg selv
//  · lista lastes ned i Moelv-formatet (Elementnr, lengde, høyde, tykkelse,
//    antall, isolasjon, farger, m²) som semikolon-CSV som åpner rett i Excel
//
// KUN KONTOR: importeres bare fra main.js, som materiell.js. Genererte vegger
// lagres lokalt per modellfil og tegnes opp igjen når modellen åpnes.
//
// Regnereglene (radmiks, spennlengder, oppdeling rundt utsparinger, SW-numre)
// er RENE TALLFUNKSJONER uten three.js — de prøves i _test/test-veggelement.mjs.
import * as THREE from "three";
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, raycaster, scene } from "./scene.js";
import { allElementBoxes, hitID, pick, toCsv } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { MALTYPER, lagreMateriellLokalt, mmTilScene, ribbonPosisjoner, tegnMateriell, trpProfil, vaskMateriell } from "./materiell-vis.js";

// ---------- Konstanter (Emils regler) ----------
// SKJØTEN ER 20 mm (Moelv/Lørenskog, bekreftet av Emil 02.09): hvert element
// slutter 10 mm fra søylesenter, så to naboelementer får 20 mm mellom seg.
// Moelv fasade 1: «3800 · 20 · 4290 · 20 · 5980 · 20 …»; Lørenskog akse
// D–C = 4600 c/c → element 4580. Var 25 (=50 mm skjøt) fram til runde 11.
export const SW_KLARING_MM = 10;      // fra søylesenter til elementende
export const SW_HOYDER = [1100, 1000]; // radhøydene som finnes, mm
export const SW_MIN_BIT_MM = 100;     // kortere biter enn dette droppes
export const SW_TOL_MM = 5;           // to lengder innenfor dette = samme SW-nummer
// LENGDE GJØR IKKE ET ELEMENT TIL KAPP. Lørenskog SW-02 er 1836,6 mm og har
// ekte nummer; Moelv SW-XX er 2560 mm. Et element er kapp når det FAKTISK er
// skåret — av en utsparing, av en tilpasningsrad, eller mot eksisterende bygg.
// Grensa finnes bare som valgfri innstilling (o.kappUnderMm, standard av).
export const SW_KAPP_UNDER_MM = 2000;
export const SW_MIN_FELT_MM = 1000;  // to skjøter nærmere enn dette blir ÉN

// ═══════════════════ RENE REGNEFUNKSJONER (testes i Node) ═══════════════════

// Radmiks: hvilke radhøyder (nedenfra og opp) fyller `hoydeMm`?
// Prøver først en EKSAKT miks av 1100 og 1000 (6400 = 4×1100 + 2×1000).
// Finnes ingen, velges miksen som etterlater minst rest — og resten blir en
// kappet rad ØVERST (Emils valg). 1100-radene ligger nederst, deretter 1000.
export function radMiks(hoydeMm) {
  const H = Math.max(0, Math.round(Number(hoydeMm) || 0));
  let best = null;
  for (let a = Math.floor(H / 1100); a >= 0; a--) {
    const rest0 = H - a * 1100;
    const b = Math.floor(rest0 / 1000);
    const rest = rest0 - b * 1000;
    if (!best || rest < best.rest || (rest === best.rest && a + b < best.a + best.b))
      best = { a, b, rest };
    if (rest === 0) break;   // eksakt — og med flest mulig 1100 (a telles ovenfra)
  }
  if (!best) return { rader: [], kappMm: 0 };
  const rader = [];
  for (let i = 0; i < best.a; i++) rader.push(1100);
  for (let i = 0; i < best.b; i++) rader.push(1000);
  const kappMm = best.rest >= 20 ? best.rest : 0;   // under 2 cm er toleranse, ikke en rad
  return { rader, kappMm };
}

// Elementlengden mellom to søyler: senteravstand minus klaringen i hver ende
// (10 + 10 mm = 20 mm skjøt).
export function spennLengdeMm(senteravstandMm, klaringMm) {
  const k = Number(klaringMm) >= 0 ? Number(klaringMm) : SW_KLARING_MM;
  return Math.round((Number(senteravstandMm) || 0) - 2 * k);
}

// «1100, 1100, 1100, 1100, 1000, 1000» → [1100,1100,1100,1100,1000,1000].
// Tåler mellomrom, semikolon, linjeskift og x/× mellom tallene.
export function parseRadHoyder(tekst) {
  return String(tekst == null ? "" : tekst)
    .split(/[^0-9]+/)
    .map(n => Math.round(Number(n)))
    .filter(n => isFinite(n) && n >= 100 && n <= 4000);
}

// RADSTABELEN NEDENFRA OG OPP (Emils valg 02.09). `oppgitt` er stabelen han
// skriver i panelet — f.eks. 6400 mm vegg som «1100,1100,1100,1100,1000,1000»,
// altså SW-05-trikset fra Moelv for å slippe småkapp. Går stabelen tom før
// veggen er full, GJENTAS den siste høyden (Lørenskog: 1300, 1100, 1000,
// 1000 …). Er feltet tomt, brukes automatikken i radMiks.
// Resten legges som TILPASNINGSRAD nederst eller øverst — referansene har den
// nederst; Emil kan velge.
// Returnerer { rader, kappMm, kappIndex } der rader er ORDNET nedenfra og opp.
export function radStabel(hoydeMm, oppgitt, kappNederst) {
  const H = Math.max(0, Math.round(Number(hoydeMm) || 0));
  const liste = parseRadHoyder(oppgitt);
  let rader = [], kappMm = 0;
  if (!liste.length) {
    const m = radMiks(H);
    rader = m.rader.slice();
    kappMm = m.kappMm;
  } else {
    let sum = 0;
    for (let i = 0; rader.length < 400; i++) {
      const h = liste[Math.min(i, liste.length - 1)];
      if (!(h > 0) || sum + h > H + 20) break;
      rader.push(h); sum += h;
    }
    const rest = H - sum;
    kappMm = rest >= 20 ? Math.round(rest) : 0;
  }
  if (!kappMm) return { rader, kappMm: 0, kappIndex: -1 };
  if (kappNederst) return { rader: [kappMm].concat(rader), kappMm, kappIndex: 0 };
  return { rader: rader.concat([kappMm]), kappMm, kappIndex: rader.length };
}

// TETTE SKJØTER SLÅS SAMMEN. To søyleforlengere som står nærmere hverandre enn
// `minFeltMm` skal ikke gi to skjøter og en 660 mm strimmel mellom seg —
// minste feltelement i referansene er 1836,6 mm (Lørenskog SW-02).
// `ts` er skjøteposisjonene i mm langs fasaden. Første og siste beholdes
// alltid: de er veggens ender.
export function samleTetteSoyler(ts, minFeltMm) {
  const liste = (ts || []).slice().sort((a, b) => a - b);
  const min = Number(minFeltMm) > 0 ? Number(minFeltMm) : 0;
  if (liste.length <= 2 || !min) return liste;
  const ut = [liste[0]];
  for (let i = 1; i < liste.length - 1; i++)
    if (liste[i] - ut[ut.length - 1] >= min) ut.push(liste[i]);
  const siste = liste[liste.length - 1];
  while (ut.length > 1 && siste - ut[ut.length - 1] < min) ut.pop();
  ut.push(siste);
  return ut;
}

// Deler intervallet [fra, til] (mm langs fasaden) opp rundt utsparinger.
// `apninger` er [[a0, a1], …]. Returnerer bitene som står igjen, i rekkefølge.
export function delOppMedUtsparinger(fra, til, apninger) {
  let biter = [[fra, til]];
  for (const [a0, a1] of apninger || []) {
    const neste = [];
    for (const [b0, b1] of biter) {
      if (a1 <= b0 || a0 >= b1) { neste.push([b0, b1]); continue; }
      if (a0 > b0) neste.push([b0, a0]);
      if (a1 < b1) neste.push([a1, b1]);
    }
    biter = neste;
  }
  return biter.filter(([b0, b1]) => b1 - b0 >= SW_MIN_BIT_MM);
}

// Fyller det som er IGJEN av en rad INNE i en åpnings bredde — over og under
// åpningen — når åpningen ikke dekker hele radhøyden (Emil 02.09).
// Uten dette ble HELE raden kappet bort så snart åpningen så vidt tok i den:
// en 2250 mm dør i 1100-rader spiste rad 0, 1 OG 2 = 3300 mm, og hullet ble
// ca. 1 m for høyt. Nå står det en tilpasset bit (SW-XX) på 1520×1050 over
// døra, som på Moelv-tegningene.
// Returnerer [{fraMm, tilMm_, bunnMm, hoydeMm}] — alt i mm fra SW-basen.
export function utspFyllBiter(rBunn, rTopp, sFra, sTil, apninger, minHoyde) {
  const minH = Number(minHoyde) > 0 ? Number(minHoyde) : SW_MIN_BIT_MM;
  const ut = [];
  for (const a of apninger || []) {
    if (!a) continue;
    const f0 = Math.max(sFra, a.fraMm), f1 = Math.min(sTil, a.tilMm_);
    if (f1 - f0 < SW_MIN_BIT_MM) continue;               // åpningen er ikke i dette spennet
    const o0 = Math.max(rBunn, a.bunnMm), o1 = Math.min(rTopp, a.toppMm);
    if (o1 - o0 <= 10) continue;                          // rører ikke raden
    if (o0 - rBunn >= minH)                               // strimmel UNDER åpningen (vindu)
      ut.push({ fraMm: f0, tilMm_: f1, bunnMm: rBunn, hoydeMm: Math.round(o0 - rBunn) });
    if (rTopp - o1 >= minH)                               // strimmel OVER åpningen (dør/port)
      ut.push({ fraMm: f0, tilMm_: f1, bunnMm: Math.round(o1), hoydeMm: Math.round(rTopp - o1) });
  }
  return ut;
}

// EN UTSPARING SOM BARE DELVIS DEKKER EN RAD SKAL IKKE LAGE ET NYTT,
// KORT ELEMENT — DEN SKAL SKJÆRES UT AV ELEMENTET (Emil 02.09).
// Moelv SW-01, fasade 1 nede til høyre: SW-11 4620MM og SW-06 3780MM går
// rett gjennom vinduene og beholder BÅDE full feltlengde, radhøyden og
// nummeret sitt — vinduet er bare et hakk i panelet. Bare når åpningen tar
// HELE radhøyden deles raden i to korte elementer (Moelv SW-XX 650MM ved
// siden av porten).
// Deler åpningene i raden i «hele» (deler raden) og «notch» (skjæres ut).
export function delRadApninger(rBunn, rTopp, apninger, tolMm) {
  const tol = Number(tolMm) >= 0 ? Number(tolMm) : SW_MIN_BIT_MM;
  const hele = [], notch = [];
  for (const a of apninger || []) {
    if (!a) continue;
    if (Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) <= 10) continue;
    if (a.bunnMm <= rBunn + tol && a.toppMm >= rTopp - tol) hele.push(a);
    else notch.push(a);
  }
  return { hele, notch };
}

// Rektangelet minus hullene, som delrektangler — til 3D-tegningen. Elementet
// er ÉTT element i lista (SW-11 4620×1000), men tegnes som de bitene som står
// igjen rundt hakket. Guillotine-oppdeling: hvert hull kløyver bitene det
// treffer i venstre/høyre/under/over.
// `hull` og svaret er i elementets egne mm: x fra venstre ende, y fra bunnen.
export function rektMinusHull(bredde, hoyde, hull, minMm) {
  const min = Number(minMm) > 0 ? Number(minMm) : 20;
  let biter = [{ x0: 0, x1: Number(bredde) || 0, y0: 0, y1: Number(hoyde) || 0 }];
  for (const h of hull || []) {
    if (!h) continue;
    const neste = [];
    for (const b of biter) {
      const ix0 = Math.max(b.x0, h.x0), ix1 = Math.min(b.x1, h.x1);
      const iy0 = Math.max(b.y0, h.y0), iy1 = Math.min(b.y1, h.y1);
      if (ix1 <= ix0 || iy1 <= iy0) { neste.push(b); continue; }   // treffer ikke
      if (b.x0 < ix0) neste.push({ x0: b.x0, x1: ix0, y0: b.y0, y1: b.y1 });
      if (ix1 < b.x1) neste.push({ x0: ix1, x1: b.x1, y0: b.y0, y1: b.y1 });
      if (b.y0 < iy0) neste.push({ x0: ix0, x1: ix1, y0: b.y0, y1: iy0 });
      if (iy1 < b.y1) neste.push({ x0: ix0, x1: ix1, y0: iy1, y1: b.y1 });
    }
    biter = neste;
  }
  return biter.filter(b => b.x1 - b.x0 >= min && b.y1 - b.y0 >= min);
}

// UTSNITT AV MIKROPROFILEN. Bølgen på et sandwichpanel skal være LIK over
// hele elementet (Emil 02.09) — også når elementet tegnes som flere biter
// rundt et hakk. Derfor lages profilen ÉN gang for elementets fulle høyde,
// og hver bit får utsnittet mellom `fra` og `til` — samme fase som naboen.
// Genererte vi profilen per bit i stedet, startet bølgen på nytt i hver bit
// og hakket så ut som et forskjøvet element.
// `profil`: [[x, y]] med x voksende fra 0. Svaret har x forskjøvet til 0.
export function profilUtsnitt(profil, fra, til) {
  const p = profil || [];
  if (p.length < 2 || !(til > fra)) return [];
  const y = (a, b, x) => a[1] + (b[1] - a[1]) * ((x - a[0]) / ((b[0] - a[0]) || 1));
  const ut = [];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if (b[0] <= fra || a[0] >= til) continue;
    const ax = Math.max(a[0], fra), bx = Math.min(b[0], til);
    if (!ut.length) ut.push([ax - fra, ax === a[0] ? a[1] : y(a, b, ax)]);
    ut.push([bx - fra, bx === b[0] ? b[1] : y(a, b, bx)]);
  }
  return ut;
}

// ═══ HÅNDJUSTERING: dra i elementene ═══════════════════════════════════════
// Emils regel 02.09: drar du høyre ende av et element mot høyre, blir naboen
// til høyre kortere. Blir naboen under 100 mm, forsvinner den — men den
// KOMMER TILBAKE når du drar tilbake så det er mer enn 100 mm igjen av den.
// Derfor endres aldri noe ødeleggende: hvert element beholder sin GENERERTE
// utstrekning (basFraMm/basTilMm) pluss to forskyvninger (dFra/dTil), og
// hvem som vinner en overlapp avgjøres av `rev` — den som ble dratt sist.

// Snapp en kant til nærmeste holdepunkt (10 mm fra søylesenter, eller
// søylekanten) hvis den er innenfor toleransen. Ellers rundes til 5 mm.
export function snappKant(mm, punkter, toleranseMm) {
  const tol = Number(toleranseMm) > 0 ? Number(toleranseMm) : 150;
  let best = null, bestAvst = Infinity;
  for (const p of punkter || []) {
    const d = Math.abs(p - mm);
    if (d <= tol && d < bestAvst) { best = p; bestAvst = d; }
  }
  return best !== null ? best : Math.round(mm / 5) * 5;
}

// Løser én rad: hvem står hvor etter justeringene. `elementer` er
// [{id, fraMm, tilMm, rev}] i SAMME fasade og rad, og fraMm/tilMm er
// basis + forskyvning. Den sist dratte (høyest rev) krever plassen sin
// først; de andre klippes av det som alt er tatt. Blir det under `minBitMm`
// igjen, er elementet skjult — ikke slettet.
export function loesRad(elementer, minBitMm) {
  const min = Number(minBitMm) > 0 ? Number(minBitMm) : SW_MIN_BIT_MM;
  const sortert = (elementer || []).slice().sort((a, b) =>
    (b.rev || 0) - (a.rev || 0) || a.fraMm - b.fraMm);
  const tatt = [];
  const ut = new Map();
  for (const e of sortert) {
    let f = e.fraMm, t = e.tilMm;
    for (const [af, at] of tatt) {
      if (at <= f || af >= t) continue;            // ingen overlapp
      if (af <= f && at >= t) { f = t = 0; break; }  // helt dekket
      if (af <= f) f = at;                         // overlapp fra venstre
      else if (at >= t) t = af;                    // overlapp fra høyre
      else t = af;                                 // tatt bit midt i: behold venstre
    }
    const skjult = !(t - f >= min);
    ut.set(e.id, { fraMm: f, tilMm: t, skjult });
    if (!skjult) tatt.push([f, t]);                // skjulte krever ingen plass
  }
  return ut;
}

// Konveks hull av søylesentrene (monotone chain). Punkter: {x, z}.
// Returnerer hjørnene MOT KLOKKA, uten duplikater.
export function konveksHull(punkter) {
  const p = [...punkter].sort((u, v) => u.x - v.x || u.z - v.z);
  if (p.length < 3) return p;
  const kryss = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const nedre = [];
  for (const q of p) {
    while (nedre.length >= 2 && kryss(nedre[nedre.length - 2], nedre[nedre.length - 1], q) <= 0) nedre.pop();
    nedre.push(q);
  }
  const ovre = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (ovre.length >= 2 && kryss(ovre[ovre.length - 2], ovre[ovre.length - 1], q) <= 0) ovre.pop();
    ovre.push(q);
  }
  nedre.pop(); ovre.pop();
  return nedre.concat(ovre);
}

// Flatene KLYNGES til åpninger: flater nær hverandre hører til samme åpning.
// Emil markerte alle portene i én omgang og trykket Ferdig — da må systemet
// selv se hvilke flater som hører sammen (single-linkage på avstand).
export function grupperFlater(flater, maksAvstand) {
  const grupper = [];
  for (const f of flater) {
    if (!f || !f.p) continue;
    const treff = grupper.filter(g => g.some(x =>
      Math.hypot(x.p.x - f.p.x, x.p.y - f.p.y, x.p.z - f.p.z) <= maksAvstand));
    if (!treff.length) { grupper.push([f]); continue; }
    treff[0].push(f);
    for (const r of treff.slice(1)) {
      treff[0].push(...r);
      grupper.splice(grupper.indexOf(r), 1);
    }
  }
  return grupper;
}

// Utsparingen regnes ut fra FLATENE brukeren trykket på, og HULLENE i
// rammen fylles fra ENDENE av de markerte elementene (Emils tegning runde 6):
//  · normal mest vannrett: flata er en SIDE (fortegnet sier venstre/høyre,
//    aksen er den normalen peker mest langs)
//  · normal mest ned/opp: undersiden av bjelke = TOPP, oversiden = BUNN
//  · 2 sider (to søyler): topp og bunn = ENDENE av de markerte søylene
//  · 3 sider (U): den manglende siden speiles fra elementene på tvers —
//    to søyler + bjelke over gir bunn = søylenes underkant; bjelke over og
//    under + én søyle gir den andre siden = bjelkenes ender
//  · helt uten holdepunkt: gulvet / veggtoppen (±1e9, klippes av radene)
// Hver flate er {p, n, boks?} der boks er elementets AABB ({min,max} xyz).
export function utsparingFraFlater(flater, slark) {
  if (!flater || !flater.length) return { feil: "tom" };
  const SLARK = Number(slark) > 0 ? Number(slark) : 0.5;   // sideveis raushet (sceneenheter)
  const grenser = { x: [null, null], z: [null, null] };   // [min, maks] per akse
  let bunn = null, topp = null;
  const pkt = [];
  const sideBokser = [], liggBokser = [];
  // Hvilke grenser kom fra et FAKTISK trykk? En firkantet åpning har bare to
  // MÅL (bredde × høyde) uansett hvor mange flater som markeres — kilden per
  // kant er det som viser at den tredje/fjerde flata faktisk ble brukt
  // (Emil runde 7: «markert 3 sider, det kommer bare opp 2 mål»).
  const fraFlate = { x: [false, false], z: [false, false], topp: false, bunn: false };
  for (const f of flater) {
    if (!f || !f.p || !f.n) continue;
    pkt.push(f.p);
    if (Math.abs(f.n.y) >= Math.max(Math.abs(f.n.x), Math.abs(f.n.z))) {
      if (f.n.y < 0) { topp = topp === null ? f.p.y : Math.min(topp, f.p.y); fraFlate.topp = true; }
      else { bunn = bunn === null ? f.p.y : Math.max(bunn, f.p.y); fraFlate.bunn = true; }
      if (f.boks) liggBokser.push(f.boks);
      continue;
    }
    if (f.boks) sideBokser.push(f.boks);
    const akse = Math.abs(f.n.x) >= Math.abs(f.n.z) ? "x" : "z";
    const g = grenser[akse];
    if (f.n[akse] > 0) { g[0] = g[0] === null ? f.p[akse] : Math.max(g[0], f.p[akse]); fraFlate[akse][0] = true; }
    else { g[1] = g[1] === null ? f.p[akse] : Math.min(g[1], f.p[akse]); fraFlate[akse][1] = true; }
  }
  // åpningens akse: helst den som har begge sidene, ellers den som har én
  let akse = null;
  for (const a of ["x", "z"]) {
    const g = grenser[a];
    if (g[0] !== null && g[1] !== null && g[1] > g[0] &&
        (!akse || (g[1] - g[0]) > (grenser[akse][1] - grenser[akse][0]))) akse = a;
  }
  if (!akse) for (const a of ["x", "z"]) if (grenser[a][0] !== null || grenser[a][1] !== null) akse = a;
  // helt uten sideflater: aksen og grensene hentes fra de liggende bjelkenes
  // felles utstrekning (bjelke over + under markert = endene deres er sidene)
  if (!akse && liggBokser.length) {
    for (const a of ["x", "z"]) {
      const lo = Math.max(...liggBokser.map(b => b.min[a]));
      const hi = Math.min(...liggBokser.map(b => b.max[a]));
      if (hi > lo && (!akse || hi - lo > grenser[akse][1] - grenser[akse][0])) {
        akse = a; grenser[a] = [lo, hi];
      }
    }
  }
  if (!akse) return { feil: "sider" };
  // manglende side i aksen: fyll fra de liggende elementenes ender
  const g = grenser[akse];
  if ((g[0] === null || g[1] === null) && liggBokser.length) {
    if (g[0] === null) g[0] = Math.max(...liggBokser.map(b => b.min[akse]));
    if (g[1] === null) g[1] = Math.min(...liggBokser.map(b => b.max[akse]));
  }
  if (g[0] === null || g[1] === null || g[1] <= g[0]) return { feil: "sider" };
  // TOPP OG BUNN LIGGER MELLOM DE MARKERTE PUNKTENE (Emils regel 02.09):
  // «enden av de 2 markerte søylene blir enden av toppen og bunnen». To søyler
  // av ulik lengde gir da OVERLAPPET deres, ikke union — union var det som
  // sendte åpningen ca. 1 m for høyt opp og for langt ned (Emils bilde 4/5).
  // En markert vannrett flate (bjelke) kan bare STRAMME grensen, aldri utvide
  // den forbi søyleendene.
  const sideTopp = sideBokser.length ? Math.min(...sideBokser.map(b => b.max.y)) : null;
  const sideBunn = sideBokser.length ? Math.max(...sideBokser.map(b => b.min.y)) : null;
  let toppKlippet = false, bunnKlippet = false;
  if (sideTopp !== null) {
    if (topp === null) topp = sideTopp;
    else if (sideTopp < topp) { topp = sideTopp; toppKlippet = true; }
  }
  if (sideBunn !== null) {
    if (bunn === null) bunn = sideBunn;
    else if (sideBunn > bunn) { bunn = sideBunn; bunnKlippet = true; }
  }
  const annen = akse === "x" ? "z" : "x";
  const av = pkt.map(p => p[annen]);
  const STOR = 1e9;
  const min = { x: 0, y: bunn === null ? -STOR : bunn, z: 0 };
  const max = { x: 0, y: topp === null ? STOR : topp, z: 0 };
  min[akse] = g[0]; max[akse] = g[1];
  min[annen] = Math.min(...av) - SLARK; max[annen] = Math.max(...av) + SLARK;
  if (max.y <= min.y) return { feil: "hoyde" };
  // Kildene, til panelet: "flate" = brukeren trykket der, "ender" = fylt fra
  // endene av de markerte elementene (2/3-sider-regelen), "åpen" = gulv/topp.
  const kilde = {
    sider: fraFlate[akse][0] && fraFlate[akse][1] ? "flater" : "ender",
    topp: fraFlate.topp && !toppKlippet ? "flate" : (topp !== null ? "ender" : "åpen"),
    bunn: fraFlate.bunn && !bunnKlippet ? "flate" : (bunn !== null ? "ender" : "åpen")
  };
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z],
           kilde, antFlater: pkt.length };
}

// SW-NUMRENE FØLGER VEGGEN, IKKE ET SORTERT REGISTER. Lørenskog fasade F→A:
// felt F–E = SW-05/06, E–D = SW-07(1300)/08(1100)/09(1000), D–C = SW-10/11/12 …
// Numrene går altså fasade for fasade, felt for felt langs fasaden, og radene
// NEDENFRA OG OPP — første gang en lengde×høyde dukker opp får den neste
// nummer. `elementer` må derfor komme i genereringsrekkefølge.
export function swNummerering(elementer) {
  const nokkel = (e) => Math.round(e.lengdeMm / SW_TOL_MM) * SW_TOL_MM + "|" + e.hoydeMm;
  const ut = new Map();
  for (const e of elementer || []) {
    if (!e || e.tilpasset) continue;
    const k = nokkel(e);
    if (!ut.has(k)) ut.set(k, "SW-" + String(ut.size + 1).padStart(2, "0"));
  }
  return { numre: ut, nokkel };
}

// Navnet på en KAPPBIT. Moelv skriver SW-XX; Lørenskog skriver forelderens
// nummer med stjerne (SW-15*) — «samme element, men skåret».
// `forelder` er nummeret hele feltelementet i samme rad har, om det finnes.
export function kappNavn(forelder, stil) {
  if (stil === "stjerne" && forelder) return forelder + "*";
  return "SW-XX";
}

// Lista i Moelv-formatet, som rader til toCsv. Tilpassede biter (SW-XX) samles
// på like mål. m² = lengde × høyde × antall.
export function swListeRader(elementer, felter) {
  const f = felter || {};
  const grupper = new Map();
  for (const e of elementer) {
    const navn = e.sw || "SW-XX";
    const k = navn + "|" + Math.round(e.lengdeMm) + "|" + e.hoydeMm;
    if (!grupper.has(k)) grupper.set(k, { navn, lengdeMm: Math.round(e.lengdeMm), hoydeMm: e.hoydeMm, antall: 0 });
    grupper.get(k).antall++;
  }
  const sortert = [...grupper.values()].sort((a, b) => {
    const ax = a.navn === "SW-XX", bx = b.navn === "SW-XX";
    if (ax !== bx) return ax ? 1 : -1;         // SW-XX nederst
    return a.navn.localeCompare(b.navn, "no") || a.lengdeMm - b.lengdeMm;
  });
  const m2 = (g) => g.lengdeMm / 1000 * g.hoydeMm / 1000 * g.antall;
  const nb = (n, d) => n.toFixed(d).replace(".", ",");
  const ut = [
    ["Project", f.prosjekt || ""], ["Project nr.", f.oppdragsnr || ""],
    ["Location", f.sted || ""], ["Date", f.dato || ""], ["Sign.", f.sign || ""],
    [],
    ["Elementnr.", "Length [mm]", "Heigth [mm]", "Thickness [mm]", "Count [stk]",
     "Insulation", "Exterior Colour", "Interior Colour", "m2"]
  ];
  let sumAnt = 0, sumM2 = 0;
  for (const g of sortert) {
    sumAnt += g.antall; sumM2 += m2(g);
    ut.push([g.navn, g.lengdeMm, g.hoydeMm, f.tykkelseMm || "", g.antall,
      f.isolasjon || "", f.utvFarge || "", f.innFarge || "", nb(m2(g), 1)]);
  }
  ut.push(["Total", "", "", f.tykkelseMm || "", sumAnt, f.isolasjon || "",
    f.utvFarge || "", f.innFarge || "", nb(sumM2, 1)]);
  return ut;
}

// ═══════════════════ MODELLEN: søyler, fasader, utsparinger ═══════════════════

const tilScene = (mm) => (Number(mm) || 0) / 1000 / (S.enhetSkala || 1);
const tilMm = (u) => (Number(u) || 0) * (S.enhetSkala || 1) * 1000;

// Søylene: IfcColumn-elementer, slått sammen når de står i samme punkt
// (søyle + søyleforlenger er ofte to elementer oppå hverandre — de er ÉN
// søyle for oss, med samlet topp og bunn).
function soyleTypeNavn(id) {
  if (S.glbActive) {   // 💾 lett kopi: typen ligger i glbProps, ikke i IFC-tråden
    const p = S.glbProps && S.glbProps.get(id);
    return p ? String(p[2] || "").replace(/^Ifc/i, "") : "";
  }
  const m = metaFor(id);
  return m ? m.typeName : "";
}

async function hentSoyler() {
  if (!S.glbActive) await sikreMeta(alleElementIder);
  const bokser = allElementBoxes();
  const rå = [];
  for (const [id, b] of bokser) {
    if (soyleTypeNavn(id) !== "Column") continue;
    rå.push({ cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2,
      minY: b.min.y, maxY: b.max.y,
      bx: b.max.x - b.min.x, bz: b.max.z - b.min.z,
      bredde: Math.min(b.max.x - b.min.x, b.max.z - b.min.z) });
  }
  const tol = 0.15 / (S.enhetSkala || 1);   // 15 cm: samme punkt = samme søyle
  const ut = [];
  for (const s of rå) {
    const treff = ut.find(u => Math.hypot(u.cx - s.cx, u.cz - s.cz) < tol);
    if (treff) {
      treff.minY = Math.min(treff.minY, s.minY);
      treff.maxY = Math.max(treff.maxY, s.maxY);
      treff.bredde = Math.max(treff.bredde, s.bredde);
      treff.bx = Math.max(treff.bx, s.bx);
      treff.bz = Math.max(treff.bz, s.bz);
      treff.deler.push({ minY: s.minY, maxY: s.maxY });
    } else ut.push({ ...s, deler: [{ minY: s.minY, maxY: s.maxY }] });
  }
  // Har søyla en SØYLEFORLENGER? Forlengeren er et EGET søyleelement som står
  // oppå søyla (Emils bilde 1: de blå stubbene på toppen). Finner vi to deler
  // der den øvre starter der den nedre slutter, står søyla under en forlenger.
  const stakkTol = 0.3 / (S.enhetSkala || 1);
  for (const u of ut) {
    const d = u.deler.slice().sort((a, b) => a.minY - b.minY);
    u.harForlenger = d.some((x, i) => i > 0 && x.minY >= d[i - 1].maxY - stakkTol);
  }
  return ut;
}

// KUN SØYLER UNDER EN SØYLEFORLENGER ER VEGG (Emils regel 02.09): korte
// tilbygg-rammer uten forlenger — to søyler og en bjelke — skal ikke dra
// fasaden ut; veggen går forbi dem, og de blir stående utenfor/innenfor.
// Finner vi ingen forlengere i modellen (alt er tegnet som én søyle),
// faller vi tilbake på søylene som når toppen, og til slutt på alle.
export function veggSoyler(soyler, toppTol) {
  const alle = (soyler || []).filter(Boolean);
  if (alle.length < 3) return alle;
  const medForlenger = alle.filter(s => s.harForlenger);
  if (medForlenger.length >= 3) return medForlenger;
  const toppen = Math.max(...alle.map(s => s.maxY));
  const hoye = alle.filter(s => s.maxY >= toppen - (Number(toppTol) || 0));
  return hoye.length >= 3 ? hoye : alle;
}

// Fasadene: kantene i det konvekse hullet av søylesentrene. Hver fasade får
// søylene sine (innenfor en søylebredde fra kantlinja), sortert langs kanten,
// pluss utover-normalen (bort fra tyngdepunktet) og toppen av forlengerne.
export function fasaderFra(soyler, tolScene) {
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  if (hull.length < 2) return [];
  const cx = hull.reduce((a, p) => a + p.x, 0) / hull.length;
  const cz = hull.reduce((a, p) => a + p.z, 0) / hull.length;
  const ut = [];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ex = dx / len, ez = dz / len;
    let nx = ez, nz = -ex;   // normalens fortegn rettes mot tyngdepunktet under
    if ((p.x - cx) * nx + (p.z - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const paKant = [];
    for (const s of soyler) {
      const tt = (s.cx - p.x) * ex + (s.cz - p.z) * ez;
      const avst = Math.abs((s.cx - p.x) * nx + (s.cz - p.z) * nz);
      if (avst <= tolScene && tt >= -tolScene && tt <= len + tolScene)
        paKant.push({ s, t: tt });
    }
    paKant.sort((a, b) => a.t - b.t);
    if (paKant.length < 2) continue;
    ut.push({
      p, ex, ez, nx, nz,
      soyler: paKant,
      toppY: Math.max(...paKant.map(k => k.s.maxY)),
      kolBredde: paKant.map(k => k.s.bredde).sort((a, b) => a - b)[Math.floor(paKant.length / 2)]
    });
  }
  return ut;
}

// Utsparingene: boksene brukeren har lagt til fra valgte elementer
// (oppsett.utsparinger = [{navn, min:[x,y,z], max:[x,y,z]}]), projisert inn
// på fasaden. Returnerer [{fraMm, tilMm_, bunnMm, toppMm}] relativt til
// fasadestart/SW-basen.
function utsparingerPaFasade(fasade, baseY, liste) {
  const ut = [];
  for (const u of liste || []) {
    if (!u || !u.min || !u.max) continue;
    // hvilken vegg utsparingen hører til er alt avgjort (utspPerFasade i
    // generer) — her projiseres den bare inn på fasadeaksen
    const ts = [];
    for (const px of [u.min[0], u.max[0]]) for (const pz of [u.min[2], u.max[2]])
      ts.push((px - fasade.p.x) * fasade.ex + (pz - fasade.p.z) * fasade.ez);
    ut.push({
      fraMm: tilMm(Math.min(...ts)), tilMm_: tilMm(Math.max(...ts)),
      bunnMm: tilMm(u.min[1] - baseY), toppMm: tilMm(u.max[1] - baseY)
    });
  }
  return ut;
}

// ═══════════════════ GENERERINGEN ═══════════════════

// Alt som tegnes bor i én gruppe, og alt som er generert lagres som rene tall
// per modellfil — da kan det tegnes opp igjen uten å regne på nytt.
export const swGroup = new THREE.Group();
scene.add(swGroup);

function lagringsNokkel() { return "storm-ifc-sw::" + S.fileName; }

let lagret = null;   // { oppsett, vegger, gulv, ringmur, materiellIder }
// Justeringsmodus. Deklareres her fordi ryddTegning() må kunne se den for å
// la markeringsgruppa stå (se kommentaren der).
let just = null;     // { valgt: Set<id>, drar: {…} | null, markorer: Group }

function lesLagret() {
  try { return JSON.parse(localStorage.getItem(lagringsNokkel()) || "null"); }
  catch (_) { return null; }
}

function skrivLagret() {
  try {
    if (lagret) localStorage.setItem(lagringsNokkel(), JSON.stringify(lagret));
    else localStorage.removeItem(lagringsNokkel());
  } catch (_) {}
}

const STD_OPPSETT = {
  betongMm: 200, isoMm: 300, utstikkMm: 200,
  ringmur: false, ringHoydeMm: 500, tykkelseMm: 120,
  // Radoppsettet (runde 11): tom streng = automatikk. Skriver Emil
  // «1100,1100,1100,1100,1000,1000» bygges veggen slik NEDENFRA OG OPP, og
  // siste høyde gjentas hvis stabelen går tom før veggen er full.
  radHoyder: "", kappNederst: true,
  klaringMm: SW_KLARING_MM,     // 10 mm hver side = 20 mm skjøt
  minFeltMm: SW_MIN_FELT_MM,    // skjøter nærmere enn dette slås sammen
  kappUnderMm: 0,               // 0 = lengde alene gjør ikke noe til kapp
  kappStil: "xx",               // "xx" = SW-XX (Moelv), "stjerne" = SW-15* (Lørenskog)
  visUtsp: true,                // stiplet kryss + mål på utsparingene
  farge: "#dfe5ec", isolasjon: "PIR", utvFarge: "RAL 1015", innFarge: "9010",
  prosjekt: "", oppdragsnr: "", sted: "", sign: "",
  utsparinger: []   // [{navn, min:[x,y,z], max:[x,y,z]}] fra valgte elementer
};

function oppsett() {
  if (!lagret) lagret = lesLagret() || { oppsett: { ...STD_OPPSETT }, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  // Et oppsett lagret av en ELDRE versjon mangler de nye nøklene (radHoyder,
  // klaringMm, minFeltMm …). Uten denne fletten blir de undefined, og
  // genereringen regner med NaN.
  lagret.oppsett = { ...STD_OPPSETT, ...(lagret.oppsett || {}) };
  return lagret.oppsett;
}

// ---------- Tegning ----------
function ryddTegning() {
  swGroup.children.slice().forEach(o => {
    // Markeringsgruppa i justeringsmodus eies av justeringen, ikke av
    // tegningen. Uten dette unntaket rev tegnAlt() den ut av swGroup ved
    // første drag, og den blå markeringen ble borte for godt etter et
    // sekund (Emils funn 02.09).
    if (just && o === just.markorer) return;
    o.traverse(m => {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    swGroup.remove(o);
  });
}

function boks(farge, opacity) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
  return m;
}

// Tegner alt fra de lagrede tallene. Vegger: {x,y,z,rot,lengdeMm,hoydeMm,tMm,sw,tilpasset}
function tegnAlt() {
  ryddTegning();
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  if (lagret.gulv) {
    const g = lagret.gulv;
    const betong = boks("#9aa3ad", 1);
    betong.scale.set(g.bredde, tilScene(o.betongMm), g.dybde);
    betong.position.set(g.x, g.topp - tilScene(o.betongMm) / 2, g.z);
    swGroup.add(betong);
    if (o.isoMm > 0) {
      const iso = boks("#e8e4da", 1);
      iso.scale.set(g.bredde, tilScene(o.isoMm), g.dybde);
      iso.position.set(g.x, g.topp - tilScene(o.betongMm) - tilScene(o.isoMm) / 2, g.z);
      swGroup.add(iso);
    }
  }
  for (const r of lagret.ringmur || []) {
    const m = boks("#8a8f98", 1);
    m.scale.set(r.lengde, r.hoyde, r.tykkelse);
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.rot;
    swGroup.add(m);
  }
  // Elementene tegnes som EKTE SANDWICHPANELER — samme oppskrift som
  // materiell-modellen Emil pekte på (runde 3): lys isolasjonskjerne synlig i
  // endene, og et tynt blikk med mikroprofil i elementfargen på begge sider.
  // Panelet bygges liggende (samme akser som materiell) og reises opp 90°.
  const farge = o.farge || "#dfe5ec";
  const fargeMat = new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
  const kjerneMat = new THREE.MeshLambertMaterial({ color: "#e8e4da", side: THREE.DoubleSide });
  const mal = MALTYPER.sandwich;
  const visLapper = (lagret.vegger || []).length <= 400;   // tusenvis av lapper kveler bilderaten
  // Ett panelstykke: isolasjonskjerne + ytter- og innerhud med mikroprofil.
  // Bygges LIGGENDE (samme akser som materiell) og reises 90° opp, så x er
  // lengden, y høyden og z tykkelsen i elementets egen ramme.
  const byggPanel = (lengdeMm, hoydeMm, tMm, profilFull, fra, til) => {
    const inner = new THREE.Group();
    const kjerne = new THREE.Mesh(new THREE.BoxGeometry(
      tilScene(Math.max(lengdeMm - 4, 10)), tilScene(Math.max(tMm - 8, 10)),
      tilScene(Math.max(hoydeMm - 4, 10))), kjerneMat);
    kjerne.position.y = mmTilScene(tMm / 2);
    inner.add(kjerne);
    // Bølgen klippes ut av ELEMENTETS profil, ikke laget på nytt for biten —
    // da står ribbene i flukt tvers over hakket.
    const profS = profilUtsnitt(profilFull, fra, til)
      .map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    if (profS.length < 2) return inner;
    const lag = () => {
      const pos = ribbonPosisjoner(profS, mmTilScene(lengdeMm));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, fargeMat);
    };
    const ytter = lag();
    ytter.position.y = mmTilScene(tMm - mal.profilHoyde);
    const indre = lag();
    indre.scale.y = -1;
    indre.position.y = mmTilScene(mal.profilHoyde);
    inner.add(ytter, indre);
    inner.rotation.x = -Math.PI / 2;         // reis panelet: høyden opp
    inner.position.z = tilScene(tMm) / 2;    // tykkelsen sentrert om veggplanet
    return inner;
  };
  for (const v of lagret.vegger || []) {
    if (v.skjult || !(v.lengdeMm > 0)) continue;   // dratt bort, men ikke slettet
    const el = new THREE.Group();
    // 🚪 HAKK ETTER UTSPARINGER: elementet er ÉTT element i lista med full
    // høyde og full feltlengde (Moelv SW-11 4620MM med vindu i), men tegnes
    // som bitene som står igjen rundt hakket.
    // Hakkene regnes ut fra radens åpninger og elementets NÅVÆRENDE
    // utstrekning, så de følger med når elementet dras/strekkes.
    let hull = v.hull;
    if (v.apn && v.fraMm !== undefined) {
      hull = [];
      for (const a of v.apn) {
        const x0 = Math.max(v.fraMm, a.fraMm) - v.fraMm, x1 = Math.min(v.tilMm, a.tilMm_) - v.fraMm;
        const y0 = Math.max(v.rBunnMm, a.bunnMm) - v.rBunnMm;
        const y1 = Math.min(v.rBunnMm + v.hoydeMm, a.toppMm) - v.rBunnMm;
        if (x1 - x0 > 10 && y1 - y0 > 10) hull.push({ x0, x1, y0, y1 });
      }
    }
    const deler = hull && hull.length
      ? rektMinusHull(v.lengdeMm, v.hoydeMm, hull, 20)
      : [{ x0: 0, x1: v.lengdeMm, y0: 0, y1: v.hoydeMm }];
    const profilFull = trpProfil(v.hoydeMm, mal.deling, mal.profilHoyde);
    for (const d of deler) {
      const g = byggPanel(d.x1 - d.x0, d.y1 - d.y0, v.tMm, profilFull, d.y0, d.y1);
      g.position.x += tilScene((d.x0 + d.x1) / 2 - v.lengdeMm / 2);
      g.position.y += tilScene((d.y0 + d.y1) / 2 - v.hoydeMm / 2);
      el.add(g);
    }
    el.position.set(v.x, v.y, v.z);
    el.rotation.y = v.rot;
    el.userData.sw = v.sw;
    el.userData.swId = v.id;
    // Id-en settes på HVER mesh, ikke bare gruppa: da trenger ikke plukkingen
    // å gå oppover i treet, og et treff kan ikke gå tapt underveis.
    el.traverse(m => { m.userData.swId = v.id; });
    swGroup.add(el);
    // 🏷 SW-nummer i øvre hjørne + dimensjon i midten — som på Moelv-tegningen
    // og Lørenskog-skjermbildene. Konstant skjermstørrelse (updateScreenScaled).
    if (visLapper) {
      const ex = Math.cos(v.rot), ez = -Math.sin(v.rot);
      // Teksten SITTER PÅ ELEMENTFLATEN som på tegningene — flate dekaler
      // limt 10 mm utenpå ytterhuden, i veggens plan, med dybdetest. Ikke
      // svevende skjermlapper (Emils runde 4 og 5): de fløt over alt og ble
      // uleselige. Dekalene har fast FYSISK størrelse og følger veggen.
      const nx = v.nx !== undefined ? v.nx : Math.sin(v.rot);
      const nz = v.nz !== undefined ? v.nz : Math.cos(v.rot);
      const nv = new THREE.Vector3(nx, 0, nz).normalize();
      const utD = tilScene(v.tMm) / 2 + 0.01 / (S.enhetSkala || 1);
      const L = tilScene(v.lengdeMm), H = tilScene(v.hoydeMm);
      const sw = tekstDekal(v.sw, 220, L * 0.45);
      sw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
      sw.position.set(
        v.x - ex * L * 0.32 + nv.x * utD,
        v.y + H * 0.24,
        v.z - ez * L * 0.32 + nv.z * utD);
      swGroup.add(sw);
      const dim = tekstDekal(v.lengdeMm + "×" + v.hoydeMm + "MM", 150, L * 0.6);
      dim.quaternion.copy(sw.quaternion);
      dim.position.set(v.x + nv.x * utD, v.y - H * 0.1, v.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
  tegnUtspMerking();
}

// ---------- 📐 Utsparingsmerking: stiplet kryss + mål ----------
// Som på Moelv-tegningen (Emil 02.09): åpningen får en stiplet ramme med
// kryss, ett mål for HELE åpningen (bredde × høyde), og for hvert element som
// går gjennom området et lite mål på HVOR DYPT det må kappes inn.
// Skrus av og på med «Vis utsparingsmål» i panelet.
function tegnUtspMerking() {
  if (!lagret || !lagret.utspVis || !lagret.utspVis.length) return;
  const o = lagret.oppsett || STD_OPPSETT;
  if (o.visUtsp === false) return;
  const fasader = lagret.fasader || [];
  const baseY = lagret.baseY || 0;
  const strekMat = new THREE.LineDashedMaterial({
    color: 0x11161d, dashSize: 0.12 / (S.enhetSkala || 1),
    gapSize: 0.08 / (S.enhetSkala || 1), depthTest: false });
  for (const a of lagret.utspVis) {
    const f = fasader[a.fi];
    if (!f) continue;
    // veggplanet, litt utenfor panelet så streken ikke drukner i det
    const utD = f.off + tilScene(o.tykkelseMm) / 2 + 0.03 / (S.enhetSkala || 1);
    const pkt = (mm, y) => new THREE.Vector3(
      f.px + f.ex * tilScene(mm) + f.nx * utD, y,
      f.pz + f.ez * tilScene(mm) + f.nz * utD);
    const y0 = baseY + tilScene(a.bunnMm), y1 = baseY + tilScene(a.toppMm);
    const h0 = pkt(a.fraMm, y0), h1 = pkt(a.tilMm_, y0);
    const t0 = pkt(a.fraMm, y1), t1 = pkt(a.tilMm_, y1);
    const geo = new THREE.BufferGeometry().setFromPoints([
      h0, h1, h1, t1, t1, t0, t0, h0,     // rammen
      h0, t1, h1, t0                      // krysset
    ]);
    const linje = new THREE.LineSegments(geo, strekMat);
    linje.computeLineDistances();          // MÅ til, ellers blir streken hel
    linje.renderOrder = 999;
    linje.raycast = () => {};
    swGroup.add(linje);
    // totalmålet midt i åpningen
    const bredde = Math.round(a.tilMm_ - a.fraMm);
    const hoyde = Math.abs(a.toppMm) > 1e8 ? null : Math.round(a.toppMm - a.bunnMm);
    const nv = new THREE.Vector3(f.nx, 0, f.nz).normalize();
    const midtMm = (a.fraMm + a.tilMm_) / 2;
    const tot = tekstDekal(bredde + "×" + (hoyde === null ? "—" : hoyde) + " MM", 260,
      tilScene(Math.max(bredde * 0.8, 600)));
    tot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    tot.position.copy(pkt(midtMm, (y0 + y1) / 2));
    tot.renderOrder = 1000;
    tot.raycast = () => {};
    swGroup.add(tot);
    // KAPPDYBDEN per element som går gjennom området
    for (const v of lagret.vegger || []) {
      if (v.skjult || v.fi !== a.fi || v.fraMm === undefined) continue;
      const x0 = Math.max(v.fraMm, a.fraMm), x1 = Math.min(v.tilMm, a.tilMm_);
      if (x1 - x0 <= 10) continue;
      const b0 = Math.max(v.rBunnMm, a.bunnMm), b1 = Math.min(v.rBunnMm + v.hoydeMm, a.toppMm);
      const dybde = Math.round(b1 - b0);
      if (dybde <= 10 || dybde >= v.hoydeMm - 10) continue;   // hel rad = ikke et kapp
      const lapp = tekstDekal("↕ " + dybde, 170, tilScene(Math.max(x1 - x0, 400)));
      lapp.quaternion.copy(tot.quaternion);
      lapp.position.copy(pkt((x0 + x1) / 2, baseY + tilScene((b0 + b1) / 2)));
      lapp.renderOrder = 1000;
      lapp.raycast = () => {};
      swGroup.add(lapp);
    }
  }
}

// ---------- 🏷 Tekst-dekaler: flate skilt limt på elementflaten ----------
// Hvit boks med sort tekst, som elementmerkene på Moelv-tegningen. Teksturen
// caches per tekst (SW-03 går igjen hundrevis av ganger); materialet og
// geometrien er per dekal og ryddes av ryddTegning.
const dekalCache = new Map();

function dekalTekstur(tekst) {
  if (dekalCache.has(tekst)) return dekalCache.get(tekst);
  const pad = 16, fs = 64;
  const mc = document.createElement("canvas").getContext("2d");
  mc.font = "bold " + fs + "px sans-serif";
  const w = Math.ceil(mc.measureText(tekst).width + pad * 2);
  const c = document.createElement("canvas");
  c.width = w; c.height = fs + pad * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#11161d"; ctx.lineWidth = 5; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  ctx.font = "bold " + fs + "px sans-serif";
  ctx.fillStyle = "#11161d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tekst, c.width / 2, c.height / 2 + 2);
  const ut = { tex: new THREE.CanvasTexture(c), aspect: c.width / c.height };
  dekalCache.set(tekst, ut);
  return ut;
}

// hoydeMm = ønsket skilthøyde i mm; maksBredde (sceneenheter) krymper skiltet
// så det aldri stikker utenfor elementet det sitter på.
function tekstDekal(tekst, hoydeMm, maksBredde) {
  const { tex, aspect } = dekalTekstur(tekst);
  let h = tilScene(hoydeMm), w = h * aspect;
  if (maksBredde > 0 && w > maksBredde) { const k = maksBredde / w; w *= k; h *= k; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ map: tex }));
  m.raycast = () => {};   // lappene er skilt, ikke noe å trykke på
  return m;
}

// Kalles av afterLoad (ifc.js) når en modell er åpnet, og av clearModel når
// den lukkes — samme kroker som materiell og grupper bruker.
S.lastSW = () => { lagret = lesLagret(); loesAlleJusteringer(); tegnAlt(); };
S.ryddSW = () => { if (just) avsluttJuster(); lagret = null; ryddTegning(); };

// ---------- Selve genereringen ----------
async function generer() {
  const o = oppsett();
  const alleSoyler = await hentSoyler();
  if (alleSoyler.length < 3) {
    alert(t("Fant bare {0} søyler (IfcColumn) i modellen — trenger minst 3 for å finne fasadene.", alleSoyler.length));
    return;
  }
  // Bare søylene UNDER SØYLEFORLENGERE er vegg — de bestemmer både fasadene
  // (konvekst hull) og skjøtene. Rammer uten forlenger står utenfor veggen.
  const soyler = veggSoyler(alleSoyler, 0.8 / (S.enhetSkala || 1));
  const kolTol = Math.max(0.3 / (S.enhetSkala || 1), soyler[0].bredde * 2);
  const fasader = fasaderFra(soyler, kolTol);
  if (!fasader.length) { alert(t("Fant ingen fasader å sette veggelementer på.")); return; }

  const okBetong = Math.min(...soyler.map(s => s.minY));   // OK betong = bunn av søylene
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;                           // SW starter på gulv eller ringmur
  const tS = tilScene(o.tykkelseMm);

  // Gulvet: søylenes utstrekning + utstikk, OK betong øverst
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  const minX = Math.min(...hull.map(p => p.x)), maxX = Math.max(...hull.map(p => p.x));
  const minZ = Math.min(...hull.map(p => p.z)), maxZ = Math.max(...hull.map(p => p.z));
  const ut = tilScene(o.utstikkMm);
  const gulv = {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, topp: okBetong,
    bredde: maxX - minX + 2 * ut, dybde: maxZ - minZ + 2 * ut
  };

  // Hver utsparing hører til ÉN vegg — den fasaden senteret ligger nærmest
  // (Emils runde 6: en åpning nær et hjørne skal aldri kappe naboveggen).
  const utspPerFasade = new Map();
  for (const u of (o.utsparinger || [])) {
    if (!u || !u.min) continue;
    const cx = (u.min[0] + u.max[0]) / 2, cz = (u.min[2] + u.max[2]) / 2;
    const halvX = (u.max[0] - u.min[0]) / 2, halvZ = (u.max[2] - u.min[2]) / 2;
    let besteFi = -1, besteAvst = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      const tt = (cx - f.p.x) * f.ex + (cz - f.p.z) * f.ez;
      const len = f.soyler[f.soyler.length - 1].t;
      if (tt < f.soyler[0].t - 1 || tt > len + 1) continue;   // utenfor fasadens lengde
      const avst = Math.abs((cx - f.p.x) * f.nx + (cz - f.p.z) * f.nz);
      // UTSPARINGEN HØRER BARE TIL VEGGEN DEN ER LAGET I (Emil 02.09): fasaden
      // må faktisk gå GJENNOM åpningsboksen. Uten dette kunne en port kappe
      // veggen på motsatt side av et smalt bygg, fordi den var «nærmest» der.
      const rekkevidde = Math.abs(f.nx) * halvX + Math.abs(f.nz) * halvZ + 1.0 / (S.enhetSkala || 1);
      if (avst > rekkevidde) continue;
      if (avst < besteAvst) { besteAvst = avst; besteFi = fi; }
    }
    if (besteFi >= 0) {
      if (!utspPerFasade.has(besteFi)) utspPerFasade.set(besteFi, []);
      utspPerFasade.get(besteFi).push(u);
    }
  }

  // Ringmur og vegger per fasade
  const ringmur = [];
  const vegger = [];
  const fasadeInfo = [];   // {off, rot} per fasade — til stabelplasseringen
  for (let fi = 0; fi < fasader.length; fi++) {
    const f = fasader[fi];
    // Veggen (og ringmuren) står FLUKT inntil utsiden av søylene. Utsiden
    // måles fra de FAKTISKE søyleboksene på fasaden — senteravvik pluss halve
    // boksen langs normalen — ikke fra en medianbredde. Da ligger elementet
    // rett på veggen selv når søylene har fotplater eller ulik størrelse
    // (Emils funn runde 2: veggene sto ikke inntil).
    let ytreFlate = 0;
    for (const k of f.soyler) {
      const lat = (k.s.cx - f.p.x) * f.nx + (k.s.cz - f.p.z) * f.nz;
      const halv = (Math.abs(f.nx) * k.s.bx + Math.abs(f.nz) * k.s.bz) / 2;
      ytreFlate = Math.max(ytreFlate, lat + halv);
    }
    const off = ytreFlate + tS / 2;
    const midt = (tMid, y) => ({
      x: f.p.x + f.ex * tMid + f.nx * off,
      z: f.p.z + f.ez * tMid + f.nz * off,
      y
    });
    const rot = Math.atan2(-f.ez, f.ex);
    fasadeInfo.push({ off, rot });
    // Fasadens basis, så et element kan REGNES OM når det dras: punktet på
    // veggplanet ved fasade-mm 0, og retningen langs fasaden.
    const fx = f.p.x + f.nx * off, fz = f.p.z + f.nz * off;
    // SØYLEFORLENGERNE BESTEMMER SKJØTENE (Emils regel runde 5): bare søyler
    // som når helt til TOPPEN av fasaden deler veggen i spenn. Korte
    // tilleggssøyler og losholter rundt utsparinger når aldri toppen, og kan
    // dermed aldri bli misforstått som skjøtepunkter — mens forlengerne over
    // portene gir skjøt på riktig plass.
    const toppTol = 0.8 / (S.enhetSkala || 1);
    const toppS = f.soyler.filter(k => k.s.maxY >= f.toppY - toppTol);
    const spennS = toppS.length >= 2 ? toppS : f.soyler;
    // Tette forlengere (hjørne- og avstivningssøyler i par) gir ÉN skjøt, ikke
    // to skjøter og en 660 mm strimmel mellom seg (Emil 02.09).
    const skjot = samleTetteSoyler(spennS.map(k => tilMm(k.t)), o.minFeltMm);
    // Holdepunktene håndjusteringen snapper til: klaringen fra hvert
    // søylesenter, og søylekantene (Emils ønske 02.09).
    const snappP = [];
    for (const k of f.soyler) {
      const c = tilMm(k.t), halv = tilMm(k.s.bredde) / 2;
      snappP.push(c - o.klaringMm, c + o.klaringMm, c - halv, c + halv);
    }
    const t0 = tilScene(skjot[0]), t1 = tilScene(skjot[skjot.length - 1]);
    const toppMm = tilMm(f.toppY - baseY);
    const { rader: alleRader, kappIndex } = radStabel(toppMm, o.radHoyder, o.kappNederst);
    const apninger = utsparingerPaFasade(f, baseY, utspPerFasade.get(fi) || []);
    // HJØRNENE gjøres som på Moelv-tegningen: hver fasade LØPER FORBI hjørnet
    // i sin sluttende (dekker naboveggens endeflate, helt ut til ytterhjørnet),
    // og starter FLUKT mot innsiden av forrige fasades vegg. Rundt bygget gir
    // det pinwheel-hjørner — ett element stikker forbi i hvert hjørne, aldri to.
    const offMm = tilMm(off);
    const hjFraMm = tilMm(t0) - offMm + o.tykkelseMm / 2;   // start: mot naboens innside
    const hjTilMm = tilMm(t1) + offMm + o.tykkelseMm / 2;   // slutt: forbi, til ytterhjørnet
    if (o.ringmur) {
      // RINGMUREN BEHANDLES SOM EN RAD (Emil 02.09): den kappes rundt en
      // utsparing på nøyaktig samme måte som veggelementene, og får en
      // fyllbit under åpningen når åpningen ikke går helt ned til gulvets
      // underkant. Før sto ringmuren igjen i døråpningen.
      // Båndet i mm regnet fra SW-basen (topp ringmur = 0):
      const rmTopp = 0;
      const rmBunn = -(tilMm(ringH) + o.betongMm + o.isoMm);
      const rmBit = (bunnMm, hoydeMm, fraMm, tilMm2) => {
        const pR = midt(tilScene((fraMm + tilMm2) / 2), 0);
        ringmur.push({ x: pR.x, z: pR.z,
          y: baseY + tilScene(bunnMm + hoydeMm / 2),
          lengde: tilScene(tilMm2 - fraMm),
          hoyde: tilScene(hoydeMm),
          tykkelse: tS, rot });
      };
      const rmApn = apninger
        .filter(a => Math.min(a.toppMm, rmTopp) - Math.max(a.bunnMm, rmBunn) > 10);
      const rKutt = rmApn.map(a => [a.fraMm, a.tilMm_]);
      for (const [rFra, rTil] of delOppMedUtsparinger(hjFraMm, hjTilMm, rKutt))
        rmBit(rmBunn, rmTopp - rmBunn, rFra, rTil);
      for (const b of utspFyllBiter(rmBunn, rmTopp, hjFraMm, hjTilMm, rmApn, SW_MIN_BIT_MM))
        rmBit(b.bunnMm, b.hoydeMm, b.fraMm, b.tilMm_);
    }
    // RAMMEN RUNDT LØKKA: FELT UTENPÅ, RADER INNENFOR (Emil 02.09). Da kommer
    // elementene i samme rekkefølge som numrene på Lørenskog-tegningene —
    // felt for felt langs fasaden, radene nedenfra og opp — og swNummerering
    // trenger bare å dele ut neste nummer ved første gangs bruk.
    const radBunn = [];        // bunnMm per rad, nedenfra
    { let b = 0; for (const h of alleRader) { radBunn.push(b); b += h; } }
    const kl = o.klaringMm;
    for (let i = 0; i < skjot.length - 1; i++) {
      const sFra = i === 0 ? hjFraMm : skjot[i] + kl;
      const sTil = i === skjot.length - 2 ? hjTilMm : skjot[i + 1] - kl;
      const fullMm = sTil - sFra;
      if (fullMm < SW_MIN_BIT_MM) continue;
      for (let r = 0; r < alleRader.length; r++) {
        const radH = alleRader[r], rBunn = radBunn[r], rTopp = rBunn + radH;
        const tilpassetRad = r === kappIndex;
        const radApninger = apninger
          .filter(a => Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) > 10);
        // Bare åpninger som tar HELE radhøyden deler raden i to korte
        // elementer. De som bare skjærer inn i den blir HAKK i elementet —
        // elementet står med full høyde og full feltlengde (Emil 02.09,
        // Moelv SW-11/SW-06).
        const { hele, notch } = delRadApninger(rBunn, rTopp, radApninger, SW_MIN_BIT_MM);
        const kutt = hele.map(a => [a.fraMm, a.tilMm_]);
        for (const [bFra, bTil] of delOppMedUtsparinger(sFra, sTil, kutt)) {
          const lengdeMm = bTil - bFra;
          const tMid = tilScene((bFra + bTil) / 2);
          const p = midt(tMid, baseY + tilScene(rBunn + radH / 2));
          // hakkene i ELEMENTETS egne mm: x fra venstre ende, y fra bunnen
          const hull = [];
          for (const a of notch) {
            const x0 = Math.max(bFra, a.fraMm) - bFra, x1 = Math.min(bTil, a.tilMm_) - bFra;
            const y0 = Math.max(rBunn, a.bunnMm) - rBunn, y1 = Math.min(rTopp, a.toppMm) - rBunn;
            if (x1 - x0 > 10 && y1 - y0 > 10) hull.push({ x0, x1, y0, y1 });
          }
          vegger.push({
            x: p.x, y: p.y, z: p.z, rot, fi, tMid, nx: f.nx, nz: f.nz,
            // til håndjusteringen: stabil id, fasadebasis, basis-utstrekning,
            // radband og radens åpninger (hakkene regnes ut på nytt ved
            // tegning, så de følger elementet når det strekkes)
            id: "v" + vegger.length, fx, fz, ex: f.ex, ez: f.ez,
            radIdx: r, rBunnMm: rBunn,
            basFraMm: Math.round(bFra), basTilMm: Math.round(bTil), dFra: 0, dTil: 0, rev: 0,
            fraMm: Math.round(bFra), tilMm: Math.round(bTil),
            apn: radApninger.map(a => ({ fraMm: a.fraMm, tilMm_: a.tilMm_, bunnMm: a.bunnMm, toppMm: a.toppMm })),
            snapp: snappP,
            lengdeMm: Math.round(lengdeMm), hoydeMm: radH, tMm: o.tykkelseMm,
            fullMm: Math.round(fullMm),
            hull: hull.length ? hull : undefined,
            // Kapp = FAKTISK skåret i LENGDEN: tilpasningsraden, eller en bit
            // som er kortere enn feltet fordi en port tok resten. Et hakk
            // gjør det IKKE — Moelv beholder SW-06 3780MM med vindu i.
            tilpassetRad,
            tilpasset: tilpassetRad || lengdeMm < fullMm - SW_TOL_MM ||
                       (o.kappUnderMm > 0 && lengdeMm < o.kappUnderMm)
          });
        }
      }
    }
  }
  if (!vegger.length) { alert(t("Ingen veggelementer ble generert — sjekk at modellen har søyler med høyde.")); return; }

  // SW-numrene
  // Fasadene lagres kompakt, så stablene kan settes opp på nytt etter en
  // håndjustering — uten å regne ut fasadene fra modellen igjen.
  const fasadeLagret = fasader.map((f, i) => ({
    px: f.p.x, pz: f.p.z, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
    t0: f.soyler[0].t, t1: f.soyler[f.soyler.length - 1].t,
    off: (fasadeInfo[i] || {}).off || 0, rot: (fasadeInfo[i] || {}).rot || 0
  }));

  // Åpningene lagres PROJISERT på fasaden, så merkingen kan tegnes uten å
  // regne fasadene ut fra modellen på nytt.
  const utspVis = [];
  for (let fi = 0; fi < fasader.length; fi++)
    for (const a of utsparingerPaFasade(fasader[fi], baseY, utspPerFasade.get(fi) || []))
      utspVis.push({ fi, fraMm: a.fraMm, tilMm_: a.tilMm_, bunnMm: a.bunnMm, toppMm: a.toppMm });

  lagret = { oppsett: o, vegger, gulv, ringmur, materiellIder: [],
             fasader: fasadeLagret, okBetong, baseY, utspVis };
  loesAlleJusteringer();
  byggStabler();
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

// ---------- Justeringene løses opp, og alt avledet regnes om ----------
// Kjøres etter generering, etter hvert drag, og når en modell åpnes igjen.
// Elementene beholder basFraMm/basTilMm + dFra/dTil; ALT annet (utstrekning,
// posisjon, lengde, SW-nummer, skjult) er avledet — derfor kommer et skjult
// element tilbake så snart du drar tilbake.
// Vegger generert FØR runde 14 mangler id, fasadebasis og basis-utstrekning,
// og var derfor umulige å plukke i justeringsmodus (Emils funn 02.09) — de
// ligger i localStorage og tegnes opp igjen uten å bli generert på nytt.
// Her fylles feltene inn fra det som finnes: rot gir fasaderetningen,
// tMid + lengdeMm gir utstrekningen, og y grupperer radene.
function migrerVegger() {
  if (!lagret || !lagret.vegger) return;
  const rader = new Map();
  lagret.vegger.forEach((v, i) => {
    if (v.id === undefined || v.id === null) v.id = "v" + i;
    if (v.ex === undefined) { v.ex = Math.cos(v.rot || 0); v.ez = -Math.sin(v.rot || 0); }
    if (v.fx === undefined) { v.fx = v.x - v.ex * (v.tMid || 0); v.fz = v.z - v.ez * (v.tMid || 0); }
    if (v.basFraMm === undefined) {
      const midMm = tilMm(v.tMid || 0);
      v.basFraMm = Math.round(midMm - (v.lengdeMm || 0) / 2);
      v.basTilMm = Math.round(midMm + (v.lengdeMm || 0) / 2);
    }
    if (v.dFra === undefined) v.dFra = 0;
    if (v.dTil === undefined) v.dTil = 0;
    if (v.rev === undefined) v.rev = 0;
    if (v.fullMm === undefined) v.fullMm = v.lengdeMm || 0;
    if (v.rBunnMm === undefined) v.rBunnMm = 0;
    if (v.radIdx === undefined) {
      const k = Math.round((v.y || 0) * 1000) + "|" + v.hoydeMm;
      if (!rader.has(k)) rader.set(k, rader.size);
      v.radIdx = rader.get(k);
    }
  });
}

// Holdepunktene et drag snapper til: fasadens søylepunkter (10 mm fra senter
// og søylekanten) PLUSS skjøtene i de andre radene på samme fasade — de er
// like nyttige å låse mot, og de finnes også for eldre, migrerte vegger som
// ikke har søylepunktene lagret.
function snappPunkter(v) {
  const ut = (v.snapp || []).slice();     // søylepunktene: 10 mm fra senter + søylekant
  for (const w of (lagret && lagret.vegger) || []) {
    if (w.fi !== v.fi || w.id === v.id) continue;
    // ENDENE AV DE ANDRE VEGGELEMENTENE (Emil 02.09) — både der de STÅR nå
    // og der de opprinnelig ble generert. Da låser en kant seg like godt mot
    // et element du alt har justert som mot den opprinnelige skjøten.
    if (!w.skjult && w.fraMm !== undefined) ut.push(w.fraMm, w.tilMm);
    ut.push(w.basFraMm, w.basTilMm);
  }
  return [...new Set(ut.filter(n => isFinite(n)))];
}

function loesAlleJusteringer() {
  migrerVegger();
  if (!lagret || !lagret.vegger) return;
  const o = lagret.oppsett || STD_OPPSETT;
  const grupper = new Map();
  for (const v of lagret.vegger) {
    if (v.basFraMm === undefined) continue;   // generert av en eldre versjon
    const k = v.fi + "|" + v.radIdx;
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(v);
  }
  for (const liste of grupper.values()) {
    const res = loesRad(liste.map(v => ({
      id: v.id,
      fraMm: v.basFraMm + (v.dFra || 0),
      tilMm: v.basTilMm + (v.dTil || 0),
      rev: v.rev || 0
    })), SW_MIN_BIT_MM);
    for (const v of liste) {
      const r = res.get(v.id);
      if (!r) continue;
      v.skjult = !!r.skjult;
      v.fraMm = Math.round(r.fraMm);
      v.tilMm = Math.round(r.tilMm);
      v.lengdeMm = Math.max(0, Math.round(r.tilMm - r.fraMm));
      const midMm = (r.fraMm + r.tilMm) / 2;
      v.tMid = tilScene(midMm);
      v.x = v.fx + v.ex * v.tMid;
      v.z = v.fz + v.ez * v.tMid;
      // Et STREKKET element er ikke kapp — Moelv SW-05 er 6490 mm i et
      // 5980-felt og har ekte nummer. Bare et FORKORTET er kapp.
      v.tilpasset = !!v.tilpassetRad || v.lengdeMm < v.fullMm - SW_TOL_MM ||
                    (o.kappUnderMm > 0 && v.lengdeMm < o.kappUnderMm);
    }
  }
  const synlige = lagret.vegger.filter(v => !v.skjult);
  const { numre, nokkel } = swNummerering(synlige);
  for (const v of lagret.vegger) {
    if (v.skjult) { v.sw = ""; continue; }
    if (!v.tilpasset) { v.sw = numre.get(nokkel(v)) || "SW-XX"; continue; }
    v.sw = kappNavn(numre.get(nokkel({ lengdeMm: v.fullMm, hoydeMm: v.hoydeMm })), o.kappStil);
  }
}

// 📦 Leveransestablene i Materiell: én stabel per SW-nummer, satt UTENFOR
// fasaden der elementene skal monteres. Bygges opp på nytt etter hver
// justering, så antallene i Mengder følger med.
function byggStabler() {
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  fjernGenerertMateriell();
  const fasader = lagret.fasader || [];
  const okBetong = lagret.okBetong || 0;
  const perSw = new Map();
  for (const v of lagret.vegger || []) {
    if (v.skjult || !v.sw || v.tilpasset) continue;
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm, antall: 0, fi: v.fi, tSum: 0 });
    const g = perSw.get(v.sw);
    g.antall++;
    g.tSum += v.tMid;
  }
  const nyeIder = [];
  const fasadeRad = new Map();
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0], "no"))) {
    const f = fasader[g.fi] || fasader[0];
    if (!f) continue;
    const rad = fasadeRad.get(g.fi) || 0;
    fasadeRad.set(g.fi, rad + 1);
    const ut = f.off + tilScene(5000) + rad * tilScene(g.hoydeMm + 1500);
    const tMid = Math.max(f.t0 + tilScene(g.lengdeMm) / 2,
      Math.min(f.t1 - tilScene(g.lengdeMm) / 2, g.tSum / g.antall));
    const pkt = vaskMateriell({
      id: "SW-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw, farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: o.tykkelseMm,
      antall: g.antall,
      x: f.px + f.ex * tMid + f.nx * ut,
      y: okBetong,
      z: f.pz + f.ez * tMid + f.nz * ut,
      rot: f.rot
    });
    if (pkt) { nyeIder.push(pkt.id); S.materiell = (S.materiell || []).concat([pkt]); }
  }
  lagret.materiellIder = nyeIder;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

function fjernGenerertMateriell() {
  // Fjerner både de id-sporede stablene fra forrige generering OG alle
  // sandwich-stabler med SW-nummer-navn: tidligere versjoner sporet ikke
  // id-ene, og de gamle stablene ble liggende igjen for hver generering —
  // det var derfor 3D-en fløt over av SW-stabler fra gamle kjøringer
  // (avlest rett fra localStorage i nettleseren, 01.09).
  const ider = new Set((lagret && lagret.materiellIder) || []);
  const generertNavn = /^SW-\d{2}$/;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(p =>
    !ider.has(p.id) && !(p.maltype === "sandwich" && generertNavn.test(p.navn || "")));
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

function fjernAltGenerert() {
  fjernGenerertMateriell();
  const o = oppsett();
  lagret = { oppsett: o, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

// ---------- CSV ----------
function lastNedListe() {
  if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
  const o = lagret.oppsett;
  const rader = swListeRader(lagret.vegger.filter(v => !v.skjult), {
    prosjekt: o.prosjekt, oppdragsnr: o.oppdragsnr, sted: o.sted, sign: o.sign,
    dato: new Date().toLocaleDateString("no-NO"),
    tykkelseMm: o.tykkelseMm, isolasjon: o.isolasjon,
    utvFarge: o.utvFarge, innFarge: o.innFarge
  });
  const blob = new Blob(["﻿" + toCsv(rader)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "") + " - SW-liste.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- Panelet ----------
function felt(id, label, verdi, type) {
  return '<label>' + t(label) +
    '<input type="' + (type || "number") + '" id="' + id + '" value="' + esc(String(verdi)) + '"' +
    (type === "text" ? ' maxlength="60"' : ' step="10" min="0" max="30000"') + '></label>';
}

function lesOppsettFraPanel() {
  const o = oppsett();
  const num = (id, std) => { const n = Number(($(id) || {}).value); return isFinite(n) && n >= 0 ? n : std; };
  const txt = (id) => (($(id) || {}).value || "").trim();
  o.betongMm = num("swBetong", o.betongMm);
  o.isoMm = num("swIso", o.isoMm);
  o.utstikkMm = num("swUtstikk", o.utstikkMm);
  o.ringmur = !!($("swRingmur") || {}).checked;
  o.ringHoydeMm = num("swRingH", o.ringHoydeMm);
  o.tykkelseMm = Math.max(30, Math.min(500, num("swTykk", o.tykkelseMm)));
  o.radHoyder = (($("swRadH") || {}).value || "").trim();
  o.kappNederst = !!($("swKappNed") || {}).checked;
  o.klaringMm = Math.max(0, Math.min(100, num("swKlaring", o.klaringMm)));
  o.minFeltMm = Math.max(0, Math.min(6000, num("swMinFelt", o.minFeltMm)));
  o.kappUnderMm = Math.max(0, Math.min(6000, num("swKappUnder", o.kappUnderMm)));
  o.kappStil = (($("swKappStil") || {}).value === "stjerne") ? "stjerne" : "xx";
  if ($("swVisUtsp")) o.visUtsp = !!$("swVisUtsp").checked;
  o.farge = ($("swFarge") || {}).value || o.farge;
  o.isolasjon = txt("swIsoType") || o.isolasjon;
  o.utvFarge = txt("swUtvF");
  o.innFarge = txt("swInnF");
  o.prosjekt = txt("swProsjekt");
  o.oppdragsnr = txt("swOppdrag");
  o.sted = txt("swSted");
  o.sign = txt("swSign");
  skrivLagret();
  return o;
}

// ---------- ✥ Juster elementer: dra i endene ----------
// Emils ønske 02.09: trykk på et element og dra i enden for å stille lengden.
// Shift+klikk markerer flere, som dras samtidig. Kanten snapper til 10 mm fra
// søylesenter eller til søylekanten. Drar du inn i naboen blir den kortere, og
// under 100 mm forsvinner den — men kommer tilbake når du drar tilbake, fordi
// ingenting slettes: alt er avledet av basFraMm/basTilMm + dFra/dTil.
function veggMedId(id) { return (lagret && lagret.vegger || []).find(v => v.id === id); }

// Elementgruppa under pekeren, blant de genererte veggene
function pekVeggEn(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1,
                                -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const treff = raycaster.intersectObjects(swGroup.children, true);
  for (const h of treff) {
    let o = h.object;
    while (o && o.userData.swId === undefined) o = o.parent;
    if (o && o.userData.swId !== undefined) {
      const v = veggMedId(o.userData.swId);
      if (v && !v.skjult) return { v, punkt: h.point };
    }
  }
  return null;
}

// Treffer ikke midt på, prøves en liten ring rundt pekeren. Et element sett
// nesten på kant er bare noen piksler bredt på skjermen, og da er et treff
// på millimeteren for mye å kreve.
function pekVegg(cx, cy) {
  swGroup.updateMatrixWorld(true);   // matrisene må være ferske før raycast
  const treff = pekVeggEn(cx, cy);
  if (treff) return treff;
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
    const t = pekVeggEn(cx + dx, cy + dy);
    if (t) return t;
  }
  return null;
}

// Peker-posisjonen i fasade-mm: skjæringen mellom blikket og VEGGPLANET til
// elementet som dras. Da følger kanten pekeren uansett kameravinkel.
const _jPlan = new THREE.Plane();
const _jPkt = new THREE.Vector3();
function fasadeMm(cx, cy, v) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1,
                                -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const n = new THREE.Vector3(v.nx, 0, v.nz).normalize();
  _jPlan.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(v.x, v.y, v.z));
  if (!raycaster.ray.intersectPlane(_jPlan, _jPkt)) return null;
  return tilMm((_jPkt.x - v.fx) * v.ex + (_jPkt.z - v.fz) * v.ez);
}

function jBarEl() {
  let el = $("swJustBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swJustBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function tegnJustBar() {
  const el = jBarEl();
  if (!just) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  // Hva som er markert vises med mål, så det er synlig at trykket registrerte
  const valgtTekst = [...just.valgt]
    .map(id => veggMedId(id))
    .filter(Boolean)
    .map(v => (v.sw || "SW-XX") + " " + v.lengdeMm + "×" + v.hoydeMm)
    .slice(0, 4)
    .join(", ");
  el.innerHTML =
    '<span style="font-size:12px;max-width:400px">' +
    t("Trykk på et veggelement og dra i enden for å stille lengden. Shift+klikk for å ta flere. Kanten snapper til søylene.") +
    ' <b>' + t("{0} valgt", just.valgt.size) + '</b>' +
    (valgtTekst ? ' <span style="color:var(--muted)">' + esc(valgtTekst) + '</span>' : "") +
    '</span>' +
    '<button id="swJustSplitt" style="padding:3px 10px"' + (just.valgt.size ? "" : " disabled") + '>✂ ' + t("Del i to") + '</button>' +
    '<button id="swJustNull" style="padding:3px 10px">' + t("Nullstill") + '</button>' +
    '<button id="swJustFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>';
  $("swJustSplitt").onclick = () => splittValgte();
  $("swJustNull").onclick = () => {
    const foer = justBilde();
    for (const v of (lagret && lagret.vegger) || []) { v.dFra = 0; v.dTil = 0; v.rev = 0; }
    loesAlleJusteringer(); byggStabler(); skrivLagret(); tegnAlt(); merkValgte();
    postJust("Justeringer nullstilt", foer);
  };
  $("swJustFerdig").onclick = () => avsluttJuster();
}

// Grønn kant rundt de markerte elementene
function merkValgte() {
  if (!just) return;
  just.markorer.children.slice().forEach(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    just.markorer.remove(m);
  });
  for (const id of just.valgt) {
    const v = veggMedId(id);
    if (!v || v.skjult) continue;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(tilScene(v.lengdeMm), tilScene(v.hoydeMm)),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.40,
        side: THREE.DoubleSide, depthWrite: false }));
    const nv = new THREE.Vector3(v.nx, 0, v.nz).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
    g.position.set(v.x, v.y, v.z).addScaledVector(nv, tilScene(v.tMm) / 2 + 0.02 / (S.enhetSkala || 1));
    g.renderOrder = 998;
    g.raycast = () => {};   // markeringen er bare til å se på
    just.markorer.add(g);
  }
}

// ---------- Angre/gjenopprett for justeringene ----------
// Elementene er rene tall, så et øyeblikksbilde av hele lista er nok — og da
// virker angre også på SPLITTER, som legger til et element.
function justBilde() {
  return JSON.parse(JSON.stringify((lagret && lagret.vegger) || []));
}

function settJustBilde(liste) {
  if (!lagret) return;
  lagret.vegger = JSON.parse(JSON.stringify(liste));
  loesAlleJusteringer();
  byggStabler();
  skrivLagret();
  tegnAlt();
  if (just) { rensValgte(); merkValgte(); tegnJustBar(); }
  tegnPanel();
}

function postJust(tekst, foer) {
  const etter = justBilde();
  if (JSON.stringify(foer) === JSON.stringify(etter)) return;   // ingenting skjedde
  if (S.pushAngre) S.pushAngre({
    tekst,
    angre: () => settJustBilde(foer),
    gjenopprett: () => settJustBilde(etter)
  });
}

// Etter angre kan et markert element være borte (en splitt ble angret)
function rensValgte() {
  if (!just) return;
  for (const id of [...just.valgt]) if (!veggMedId(id)) just.valgt.delete(id);
}

// ---------- ✂ Splitt: del ett element i to ----------
// Deler på midten, med skjøteklaringen mellom halvdelene. Etterpå kan skjøten
// dras dit den skal — den nye halvdelen er et helt vanlig element.
export function splittKanter(fraMm, tilMm, klaringMm, minBitMm) {
  const k = Number(klaringMm) >= 0 ? Number(klaringMm) : SW_KLARING_MM;
  const min = Number(minBitMm) > 0 ? Number(minBitMm) : SW_MIN_BIT_MM;
  const midt = (fraMm + tilMm) / 2;
  const a = [fraMm, Math.round(midt - k)];
  const b = [Math.round(midt + k), tilMm];
  if (a[1] - a[0] < min || b[1] - b[0] < min) return null;   // for lite å dele
  return [a, b];
}

function splittValgte() {
  if (!just || !lagret) return;
  const foer = justBilde();
  const o = lagret.oppsett || STD_OPPSETT;
  let delt = 0;
  for (const id of [...just.valgt]) {
    const v = veggMedId(id);
    if (!v || v.skjult) continue;
    const kanter = splittKanter(v.fraMm, v.tilMm, o.klaringMm, SW_MIN_BIT_MM);
    if (!kanter) continue;
    const rev = 1 + Math.max(0, ...(lagret.vegger || []).map(w => w.rev || 0));
    const ny = JSON.parse(JSON.stringify(v));
    ny.id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // begge halvdelene får ny BASIS og nullede forskyvninger — da er de
    // vanlige elementer som kan dras videre hver for seg
    v.basFraMm = kanter[0][0]; v.basTilMm = kanter[0][1]; v.dFra = 0; v.dTil = 0; v.rev = rev;
    ny.basFraMm = kanter[1][0]; ny.basTilMm = kanter[1][1]; ny.dFra = 0; ny.dTil = 0; ny.rev = rev;
    // full feltlengde arves, så begge halvdelene regnes som kapp
    lagret.vegger.splice(lagret.vegger.indexOf(v) + 1, 0, ny);
    just.valgt.add(ny.id);
    delt++;
  }
  if (!delt) { alert(t("Elementet er for kort å dele — hver halvdel må bli minst 100 mm.")); return; }
  loesAlleJusteringer();
  byggStabler();
  skrivLagret();
  tegnAlt();
  merkValgte();
  tegnJustBar();
  postJust("Veggelement delt", foer);
}

function startJuster() {
  if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
  const markorer = new THREE.Group();
  swGroup.add(markorer);
  just = { valgt: new Set(), drar: null, markorer };
  $("swPanel").classList.remove("open");
  tegnJustBar();
}

function avsluttJuster() {
  if (!just) return;
  just.markorer.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(just.markorer);
  just = null;
  tegnJustBar();
  tegnPanel();
  apnePanel("swPanel");
}

window.addEventListener("pointerdown", (e) => {
  if (!just || e.button !== 0 || e.target !== canvas) return;
  const treff = pekVegg(e.clientX, e.clientY);
  just.ned = { x: e.clientX, y: e.clientY };
  if (!treff || !treff.v) { just.drar = null; return; }
  const v = treff.v;
  if (e.shiftKey) {
    if (just.valgt.has(v.id)) just.valgt.delete(v.id); else just.valgt.add(v.id);
    e.stopPropagation();
    merkValgte(); tegnJustBar();
    return;
  }
  if (!just.valgt.has(v.id)) { just.valgt.clear(); just.valgt.add(v.id); }
  const startMm = fasadeMm(e.clientX, e.clientY, v);
  if (startMm === null) return;
  // Hvilken ENDE dras? Den halvparten av elementet trykket havnet i.
  const ende = startMm < (v.fraMm + v.tilMm) / 2 ? "fra" : "til";
  const rev = 1 + Math.max(0, ...(lagret.vegger || []).map(w => w.rev || 0));
  const base = new Map();
  for (const id of just.valgt) {
    const w = veggMedId(id);
    if (w) base.set(id, { dFra: w.dFra || 0, dTil: w.dTil || 0 });
  }
  just.drar = { id: v.id, ende, startMm, base, rev, foer: justBilde() };
  e.stopPropagation();   // kameraet skal ikke rotere mens vi drar
  merkValgte(); tegnJustBar();
}, true);

window.addEventListener("pointermove", (e) => {
  if (!just || !just.drar) return;
  const d = just.drar;
  const v = veggMedId(d.id);
  if (!v) return;
  const naMm = fasadeMm(e.clientX, e.clientY, v);
  if (naMm === null) return;
  const b = d.base.get(d.id) || { dFra: 0, dTil: 0 };
  const basKant = d.ende === "fra" ? v.basFraMm + b.dFra : v.basTilMm + b.dTil;
  // kanten snappes, og SAMME forskyvning gis til alle markerte
  const snappet = snappKant(basKant + (naMm - d.startMm), snappPunkter(v), 150);
  const delta = Math.round(snappet - basKant);
  for (const id of just.valgt) {
    const w = veggMedId(id);
    const wb = d.base.get(id);
    if (!w || !wb) continue;
    if (d.ende === "fra") w.dFra = wb.dFra + delta; else w.dTil = wb.dTil + delta;
    w.rev = d.rev;
  }
  loesAlleJusteringer();
  tegnAlt();
  merkValgte();
  e.stopPropagation();
}, true);

window.addEventListener("pointerup", (e) => {
  if (!just || e.button !== 0) return;
  if (!just.drar) { just.ned = null; return; }
  const foer = just.drar.foer;
  just.drar = null;
  just.ned = null;
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  loesAlleJusteringer();
  byggStabler();
  skrivLagret();
  tegnAlt();
  merkValgte();
  tegnJustBar();
  postJust("Veggelement justert", foer);
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && just) { e.stopPropagation(); avsluttJuster(); }
}, true);

// ---------- 🎯 Marker utsparing: trykk på FLATENE rundt åpningen ----------
// Emils regel (runde 3): trykk på ÉN flate per side — innsiden av søylene på
// hver side, undersiden av bjelken over, evt. oversiden av en bjelke under.
// Hvert trykk gir treffpunkt + flatenormal; utsparingFraFlater regner boksen.
// Kameraet virker som vanlig underveis (bare selve KLIKKET fanges), og små
// markører viser hvilke flater som er valgt.
let utspMark = null;   // { flater: [], ned: {x,y}, prikker: Group } når aktiv

function utspBarEl() {
  let el = $("swUtspBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swUtspBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function tegnUtspBar() {
  const el = utspBarEl();
  if (!utspMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML =
    '<span style="font-size:12px;max-width:340px">' +
    t("Trykk på flatene rundt åpningene: innsiden av søylene på sidene, undersiden av bjelken over. Én flate per side — du kan markere flere åpninger før Ferdig.") +
    ' <b>' + t("{0} flater valgt", utspMark.flater.length) + '</b></span>' +
    '<button id="swUtspFerdig" class="primary" style="padding:3px 10px">' + t("Ferdig") + '</button>' +
    '<button id="swUtspAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
  $("swUtspFerdig").onclick = fullforUtspMark;
  $("swUtspAvbryt").onclick = () => avsluttUtspMark();
}

function startUtspMark() {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  const prikker = new THREE.Group();
  swGroup.add(prikker);
  utspMark = { flater: [], ned: null, prikker };
  $("swPanel").classList.remove("open");   // panelet i veien for modellen
  tegnUtspBar();
}

function avsluttUtspMark() {
  if (!utspMark) return;
  utspMark.prikker.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(utspMark.prikker);
  utspMark = null;
  tegnUtspBar();
  tegnPanel();
  apnePanel("swPanel");
}

function fullforUtspMark() {
  if (!utspMark) return;
  const e = S.enhetSkala || 1;
  // flater innenfor 4 m hører til samme åpning — da kan alle åpningene
  // markeres i én omgang og Ferdig trykkes til slutt (Emils runde 5)
  const klynger = grupperFlater(utspMark.flater, 4.0 / e);
  const o = oppsett();
  o.utsparinger = (o.utsparinger || []).filter(x => x && x.min);   // gamle formater ryddes
  let lagt = 0, feilet = 0;
  for (const kl of klynger) {
    const u = utsparingFraFlater(kl, 0.5 / e);
    if (u.feil) { feilet++; continue; }
    lagt++;
    o.utsparinger.push({ navn: t("Utsparing {0}", o.utsparinger.length + 1), min: u.min, max: u.max,
                         flater: u.antFlater, kilde: u.kilde });
  }
  if (!lagt) {
    alert(t("Utsparingen trenger to motstående sider — trykk på innsiden av søylene på hver side av åpningen."));
    return;
  }
  skrivLagret();
  avsluttUtspMark();
  if (feilet) alert(t("{0} utsparinger lagt til — {1} område manglet to motstående sider og ble hoppet over.", lagt, feilet));
}

// Klikkene fanges på window i FANGSTFASEN (samme oppskrift som materiell.js):
// kameraet får dra som vanlig — bare et trykk under 8 px behandles, og da
// stoppes det FØR elementvalget i main.js ser det.
window.addEventListener("pointerdown", (e) => {
  if (!utspMark || e.button !== 0) return;
  utspMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!utspMark || e.button !== 0 || !utspMark.ned) return;
  const ned = utspMark.ned;
  utspMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  e.stopPropagation();
  // Kameraet fikk pointerdown-en (rotasjon skal virke i modusen) — svelger vi
  // pointerup-en uten å rydde, blir kameraet stående og tro at knappen holdes
  // og «låser seg i rotasjon». Samme kur som materiell.js: syntetisk
  // pointercancel, som SimpleControls håndterer fra før.
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const hit = pick(e.clientX, e.clientY);
  if (!hit || !hit.face) return;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  // IFC-geometri har ofte vilkårlig vindingsretning — normalen kan like
  // gjerne peke INN i søylen som ut. Men flata brukeren SER har alltid
  // normalen sin MOT kameraet: peker den med blikket, snus den. Det var
  // dette som ga «trenger to motstående sider» med 17 flater valgt
  // (Emils skjermbilde 01.09 18:14).
  if (n.dot(raycaster.ray.direction) > 0) n.multiplyScalar(-1);
  // elementets boks følger med: endene av markerte søyler/bjelker fyller ut
  // sidene som ikke er markert (Emils regel runde 6)
  const bid = hitID(hit);
  const bb = bid != null ? allElementBoxes().get(bid) : null;
  utspMark.flater.push({ p: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
                         n: { x: n.x, y: n.y, z: n.z },
                         boks: bb ? { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
                                      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } } : undefined });
  // hele SIDEN av elementet farges blå — som når sammenligningen farger
  // elementer, bare for én flate (Emils runde 4). Flaten finnes fra
  // elementets boks: kvadranten som normalen peker ut av.
  utspMark.prikker.add(byggFlateMerke(hit, n));
  tegnUtspBar();
}, true);

// Blå, halvgjennomsiktig plate lagt oppå siden brukeren trykket på.
function byggFlateMerke(hit, n) {
  const id = hitID(hit);
  const b = id != null ? allElementBoxes().get(id) : null;
  const løft = 0.015 / (S.enhetSkala || 1);   // 15 mm ut, mot z-fighting
  let w = 0.4 / (S.enhetSkala || 1), h = w;
  const senter = hit.point.clone();
  if (b) {
    const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? "x"
      : Math.abs(n.y) >= Math.abs(n.z) ? "y" : "z";
    if (ax === "x") { w = b.max.z - b.min.z; h = b.max.y - b.min.y; }
    else if (ax === "y") { w = b.max.x - b.min.x; h = b.max.z - b.min.z; }
    else { w = b.max.x - b.min.x; h = b.max.y - b.min.y; }
    senter.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    senter[ax] = n[ax] >= 0 ? b.max[ax] : b.min[ax];
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, 1e-6), Math.max(h, 1e-6)),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false }));
  const nv = new THREE.Vector3(n.x, n.y, n.z).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
  m.position.copy(senter).addScaledVector(nv, løft);
  m.renderOrder = 997;
  return m;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && utspMark) { e.stopPropagation(); avsluttUtspMark(); }
}, true);

// Én linje under målene som viser HVOR grensene kom fra. En firkantet åpning
// har bare to mål (bredde × høyde) uansett hvor mange flater som markeres —
// denne linja viser at den tredje og fjerde flata faktisk ble brukt, og hva
// som ble fylt automatisk (Emil runde 7: «markert 3 sider, bare 2 mål»).
function utspKildeTekst(u) {
  const biter = [];
  if (u.flater) biter.push(t("{0} flater markert", u.flater));
  const k = u.kilde || {};
  if (k.topp === "flate") biter.push(t("topp fra flate"));
  else if (k.topp === "ender") biter.push(t("topp fra søyleendene"));
  else if (k.topp === "åpen") biter.push(t("topp åpen"));
  if (k.bunn === "flate") biter.push(t("bunn fra flate"));
  else if (k.bunn === "ender") biter.push(t("bunn fra søyleendene"));
  else if (k.bunn === "åpen") biter.push(t("bunn: gulvet"));
  if (k.sider === "ender") biter.push(t("side fra bjelkeendene"));
  return biter.join(" · ");
}

function tegnPanel() {
  const body = $("swBody");
  if (!body) return;
  const o = oppsett();
  const antall = (lagret && lagret.vegger || []).length;
  const utsp = (o.utsparinger || []).filter(u => u && u.min);
  body.innerHTML =
    '<h4 style="margin:0 0 4px">' + t("Gulv") + '</h4>' +
    felt("swBetong", "Betong (mm)", o.betongMm) +
    felt("swIso", "Isolasjon (mm)", o.isoMm) +
    felt("swUtstikk", "Utstikk forbi søylene (mm)", o.utstikkMm) +
    '<p style="color:var(--muted);font-size:11px;margin:4px 0">' +
      t("Overkant betong settes automatisk til bunnen av søylene.") + '</p>' +
    '<h4 style="margin:10px 0 4px">' + t("Ringmur") + '</h4>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swRingmur"' +
      (o.ringmur ? " checked" : "") + '> ' + t("Med ringmur rundt stålkonstruksjonen") + '</label>' +
    felt("swRingH", "Høyde over gulv (mm)", o.ringHoydeMm) +
    '<h4 style="margin:10px 0 4px">' + t("Veggelementer") + '</h4>' +
    felt("swTykk", "Tykkelse (mm) — samme som ringmuren", o.tykkelseMm) +
    felt("swKlaring", "Klaring fra søylesenter (mm) — 10 gir 20 mm skjøt", o.klaringMm) +
    '<label>' + t("Radhøyder nedenfra (mm) — tom = automatisk") +
      '<input type="text" id="swRadH" maxlength="200" value="' + esc(o.radHoyder || "") + '"></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Skriv stabelen nedenfra og opp, f.eks. «1100, 1100, 1100, 1100, 1000, 1000». Siste høyde gjentas hvis veggen er høyere. Sum: {0} mm.",
        parseRadHoyder(o.radHoyder).reduce((a, b) => a + b, 0)) + '</p>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swKappNed"' +
      (o.kappNederst ? " checked" : "") + '> ' + t("Tilpasningsraden nederst (som Moelv/Lørenskog)") + '</label>' +
    felt("swMinFelt", "Minste felt (mm) — tettere skjøter slås sammen", o.minFeltMm) +
    felt("swKappUnder", "Alt kortere enn (mm) er kapp — 0 = av", o.kappUnderMm) +
    '<label>' + t("Navn på kappbiter") +
      '<select id="swKappStil">' +
      '<option value="xx"' + (o.kappStil !== "stjerne" ? " selected" : "") + '>SW-XX (Moelv)</option>' +
      '<option value="stjerne"' + (o.kappStil === "stjerne" ? " selected" : "") + '>SW-15* (Lørenskog)</option>' +
      '</select></label>' +
    '<label>' + t("Farge") + '<input type="color" id="swFarge" value="' + esc(o.farge) + '"></label>' +
    felt("swIsoType", "Isolasjon (til lista)", o.isolasjon, "text") +
    felt("swUtvF", "Utvendig farge (til lista)", o.utvFarge, "text") +
    felt("swInnF", "Innvendig farge (til lista)", o.innFarge, "text") +
    '<h4 style="margin:10px 0 4px">' + t("Utsparinger (dører, vinduer, porter)") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Trykk «Marker utsparing», og trykk så på flatene rundt åpningen i modellen: innsiden av søylene på sidene og undersiden av bjelken over. Én flate per side.") + '</p>' +
    '<div class="prop-actions"><button id="swNyUtsp">' + ikon("boks") + ' ' + t("Marker utsparing") + '</button></div>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swVisUtsp"' +
      (o.visUtsp === false ? "" : " checked") + '> ' + t("Vis utsparingsmål (stiplet kryss + kappdybde)") + '</label>' +
    (!utsp.length
      ? '<p style="color:var(--muted);font-size:12px">' + t("Ingen utsparinger lagt til ennå.") + '</p>'
      : utsp.map((u, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(u.navn || ("#" + (i + 1))) +
        ' <span style="color:var(--muted)">' +
        Math.round(tilMm(Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2]))) + "×" +
        (u.max[1] - u.min[1] > 1e8 ? t("full høyde") : Math.round(tilMm(u.max[1] - u.min[1])) + " mm") + "</span>" +
        (utspKildeTekst(u)
          ? '<br><span style="color:var(--muted);font-size:11px">' + esc(utspKildeTekst(u)) + "</span>" : "") +
        "</div>" +
        '<div class="c"><button data-sw-slett-utsp="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")) +
    '<h4 style="margin:10px 0 4px">' + t("Til lista") + '</h4>' +
    felt("swProsjekt", "Prosjekt", o.prosjekt, "text") +
    felt("swOppdrag", "Oppdragsnummer", o.oppdragsnr, "text") +
    felt("swSted", "Sted", o.sted, "text") +
    felt("swSign", "Sign.", o.sign, "text") +
    '<div class="prop-actions" style="margin-top:10px;flex-wrap:wrap">' +
    '<button id="swGenerer" class="primary">' + ikon("boks") + ' ' + t("Generer SW + gulv/ringmur") + '</button>' +
    '<button id="swJusterBtn">✥ ' + t("Juster elementer") + '</button>' +
    '<button id="swListe">' + ikon("lastned") + ' ' + t("Last ned liste (Excel/CSV)") + '</button>' +
    '<button id="swFjern">' + ikon("slett") + ' ' + t("Fjern genererte") + '</button></div>' +
    (antall ? '<p style="color:var(--muted);font-size:12px;margin-top:6px">' +
      t("{0} veggelementer generert. Stablene ligger i 📦 Materiell og telles i Mengder.", antall) + '</p>' : "");
  $("swGenerer").onclick = async () => {
    lesOppsettFraPanel();
    $("swGenerer").disabled = true;
    try { await generer(); }
    catch (err) { console.warn("SW-generator:", err); alert(t("Genereringen feilet: ") + (err && err.message || err)); }
    finally { const b = $("swGenerer"); if (b) b.disabled = false; }
  };
  $("swListe").onclick = () => { lesOppsettFraPanel(); lastNedListe(); };
  $("swFjern").onclick = () => { lesOppsettFraPanel(); fjernAltGenerert(); };
  $("swNyUtsp").onclick = () => { lesOppsettFraPanel(); startUtspMark(); };
  if ($("swVisUtsp")) $("swVisUtsp").onchange = () => { lesOppsettFraPanel(); tegnAlt(); };
  if ($("swJusterBtn")) $("swJusterBtn").onclick = () => { lesOppsettFraPanel(); startJuster(); };
  body.querySelectorAll("button[data-sw-slett-utsp]").forEach(b =>
    b.onclick = () => {
      lesOppsettFraPanel();
      const o2 = oppsett();
      o2.utsparinger.splice(Number(b.dataset.swSlettUtsp), 1);
      skrivLagret();
      tegnPanel();
    });
}

på("btnSW", "click", () => {
  const panel = $("swPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("swPanel");
});
