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
import { allElementBoxes, forHverTrekant, hitID, lastNedXlsx, pick, sumFormel } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { metaFor, sikreMeta } from "./ifcrpc.js";
import { MALTYPER, lagreMateriellLokalt, mmTilScene, ribbonPosisjoner, tegnMateriell, trpProfil, vaskMateriell } from "./materiell-vis.js";
// 🖼 Logoene i tittelfeltet kommer fra SAMME SharePoint-mappe som rapportens,
// gjennom samme to funksjoner. To lister med logoer ville drevet fra hverandre
// første gang noen la til en fil bare i den ene.
import { hentLogo, hentLogoer } from "./tegninger.js";
import { ryddLogonavn } from "./rapport.js";

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
// Laveste høyde et SKRÅKAPPET element får ha i den tynne enden.
//
// STANDARD ER 0, OG DET ER ET VALG. En minstehøyde og en tett vegg er to sider
// av samme sak: kapper vi elementet der taket er 300 mm over radbunnen, står
// det igjen en trekant på 300 mm × 600 mm mellom veggkanten og takflaten — og
// den er et HULL (Emil 08.09, andre gjennomgang: «elementene stikker enda ikke
// ut til kanten av taket»). Skal veggen møte taket, må kilen få gå helt ut.
// Grensa står igjen som innstilling for den som heller vil ha en rett kant enn
// en spiss, og da er hullet et bevisst valg.
export const SW_MIN_SKRA_MM = 0;
// Hvor stor del av fasadehøyden en søyle må nå for å telle som veggsøyle.
// To terskler, fordi de to spørsmålene ikke er like strenge:
//  • SW_VEGGANDEL — for å TA INN en søyle som ikke har forlenger. Streng, ellers
//    kommer sekundær fasadeavstivning med: Sundland har CFSHS100x5-stolper som
//    når 80 % av veggen, mot gavlsøylenes 92 %.
//  • SW_SPENNANDEL — for å BEHOLDE en søyle som allerede er med i konturen.
//    Romslig; her skal bare losholter og korte stubber ut. Arendals laveste
//    søyle på pulttaket når 86 % og må aldri falle ut.
export const SW_VEGGANDEL = 0.85;
export const SW_SPENNANDEL = 0.6;
// Hvor mange veggelement som kan merkes med SW-nummer og mål i 3D før lappene
// slås av for å berge bilderaten. Sto på 400 fra runde 5, da et bygg sjelden
// ga mer enn et par hundre element. Etter runde 19c deles gavlene riktig, og
// Sundland (54 × 24 m) passerte grensa — merkingen forsvant uten et ord
// (Emil 04.09). Grensa er nå satt der den faktisk gjør vondt, ikke der et
// normalt lagerbygg lander, og den sier fra i konsollen når den slår inn.
export const SW_MAKS_LAPPER = 2000;
// Hvor langt UTENFOR åpningsboksen et veggplan får ligge og likevel eie
// åpningen, i meter. Boksen er alt 500 mm dyp til hver side (SLARK i
// utsparingFraFlater), så søyleaksen ligger godt innenfor med 300 mm i tillegg.
// Sto på 1000 mm, og var da så romslig at nabovegger stjal hverandres åpninger.
export const APN_SLARK = 0.3;
// Versjonen av åpningsregelen. Innervegger bygget med en eldre regel bygges
// på nytt ÉN gang når fila åpnes, så en utsparing som ble stjålet av en vegg
// på tvers forsvinner av seg selv. Merket er NYTT og har aldri vært satt av en
// bugget migrering — lærdommen fra runde 20e står i migrerOppsett.
export const APN_REGEL = 2;

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

// ═════════════ TAKLINJA: VEGGTOPPEN FØLGER TAKET (runde 20) ═════════════
// Fram til runde 20 ble veggen bygd FLAT opp til fasadens høyeste søyletopp.
// Det holdt på flate tak, ga inntil 1200 mm vegg over taket på Arendals
// pulttak — og falt helt fra hverandre på Norsjø golfklubbs SALTAK: gavlen ble
// bygd flat på 7933 mm, som er 1733 mm over taket i hjørnene og 1084 mm under
// mønet på midten (Emils valg 08.09: veggen skal følge taket og skråkappes).
//
// TAKLINJA ER DEN ØVRE KONVEKSE HYLLA AV STÅLET SOM STÅR I FASADEPLANET.
// Hvorfor hylla, og ikke bare topplinja punkt for punkt: en topplinje av rå
// punkter vipper opp og ned med hver søylehatt og hver knekt bjelke, og ville
// gitt veggen en sagtannet topp. Den øvre hylla er glatt, og den gir NØYAKTIG
// riktig svar på alle takformene vi har møtt:
//
//   flatt tak   → vannrett linje på det høyeste  (= regelen fra runde 5, uendret)
//   pulttak     → rett linje fra lav til høy ende (Arendal, 1200 mm fall)
//   saltak-gavl → raft → møne → raft, altså gavltrekanten (Norsjø)
//   langvegg
//   under saltak→ vannrett på rafthøyde, fordi begge endene ligger like høyt
//
// Enheten er MM langs fasaden (t) og MM i høyden, begge målt slik resten av
// generatoren måler: t fra fasadens start, høyden i scenens y.
export function takLinje(punkter, tolMm) {
  const p = (punkter || [])
    .filter(q => q && Number.isFinite(q[0]) && Number.isFinite(q[1]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 2) return p.map(q => [q[0], q[1]]);
  // Øvre hylle: gå fra venstre mot høyre og kast hvert punkt som lager en
  // VENSTRESVING — da står bare toppunktene igjen.
  const kryss = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const h = [];
  for (const q of p) {
    while (h.length >= 2 && kryss(h[h.length - 2], h[h.length - 1], q) >= 0) h.pop();
    h.push(q);
  }
  // Forenkling: et knekkpunkt som ligger nærmere enn `tolMm` under den rette
  // linja mellom naboene sine er støy (en søylehatt, en boltplate), ikke et
  // møne. Uten dette får en «flat» fasade fem knekk på 20 mm og veggen blir
  // delt opp i skrå biter ingen har bedt om.
  const tol = Number(tolMm) > 0 ? Number(tolMm) : 0;
  let endret = true;
  while (endret && h.length > 2) {
    endret = false;
    for (let i = 1; i < h.length - 1; i++) {
      const [x0, y0] = h[i - 1], [x1, y1] = h[i], [x2, y2] = h[i + 1];
      const paaLinja = x2 === x0 ? Math.max(y0, y2) : y0 + (y2 - y0) * (x1 - x0) / (x2 - x0);
      if (y1 - paaLinja <= tol) { h.splice(i, 1); endret = true; break; }
    }
  }
  // Varierer hele linja mindre enn toleransen, er taket FLATT: den legges
  // vannrett på det høyeste punktet. Da får et flatt bygg nøyaktig samme
  // veggtopp som før runde 20 — ingen skrå elementer av 40 mm søylehatter.
  const ys = h.map(q => q[1]);
  if (h.length && Math.max(...ys) - Math.min(...ys) <= tol) {
    const topp = Math.max(...ys);
    return [[h[0][0], topp], [h[h.length - 1][0], topp]];
  }
  return h.map(q => [q[0], q[1]]);
}

// Høyden på taklinja ved fasade-mm `tMm`. Utenfor linjas endepunkter holdes
// endeverdien — veggen skal ikke stupe i hjørnene der stålet slutter.
export function takHoyde(linje, tMm) {
  const L = linje || [];
  if (!L.length) return null;
  const t = Number(tMm);
  if (!(t > L[0][0])) return L[0][1];
  if (t >= L[L.length - 1][0]) return L[L.length - 1][1];
  for (let i = 1; i < L.length; i++) {
    if (t <= L[i][0]) {
      const [x0, y0] = L[i - 1], [x1, y1] = L[i];
      return x1 === x0 ? Math.max(y0, y1) : y0 + (y1 - y0) * (t - x0) / (x1 - x0);
    }
  }
  return L[L.length - 1][1];
}

// Er taket flatt nok til at veggen skal bygges som før? Da rører vi ingenting:
// flate bygg skal gi BIT FOR BIT samme svar etter runde 20 som før den.
export function flatTak(linje, tolMm) {
  const L = linje || [];
  if (L.length < 2) return true;
  const ys = L.map(q => q[1]);
  return Math.max(...ys) - Math.min(...ys) <= (Number(tolMm) > 0 ? Number(tolMm) : 0);
}

// Hvor taklinja knekker INNE i et felt. Et element kan ha skrå topp, men bare
// ÉN skråning — møneknekken må bli en skjøt, ellers måtte panelet vært brettet.
export function takKnekk(linje, fraMm, tilMm) {
  const ut = [];
  for (const [x] of (linje || []))
    if (x > fraMm + 1 && x < tilMm - 1) ut.push(x);
  return ut;
}

// VINKELEN PÅ SKRÅKUTTET, i grader fra vannrett, med én desimal (Emil 08.09:
// «det må stå hvor mye vinkelen på skrå kuttet er»). Målt på ELEMENTET, ikke på
// taket: det er elementets to endehøyder verkstedet skjærer etter, og
// klaringen i endene kan skille de to tallene et par tidels grader.
export function skraVinkel(lengdeMm, hVMm, hHMm) {
  const L = Math.abs(Number(lengdeMm) || 0);
  if (!L) return 0;
  const d = Math.abs((Number(hHMm) || 0) - (Number(hVMm) || 0));
  return Math.round(Math.atan2(d, L) * 1800 / Math.PI) / 10;
}

// BØLGEHUDEN PÅ ET SKRÅKAPPET PANEL (Emil 08.09: «har ikke samme utseende som
// resten av veggelementene, det er bare en grå boks»).
//
// Mikroprofilen er den samme som på et rett panel: `trpProfil` gir en profil
// som løper OVER HØYDEN, og på et rett panel ekstruderes hvert profilbånd i
// full lengde. På et skråkappet panel kan et bånd ikke gå i full lengde — det
// finnes bare der OVERKANTEN er høyere enn båndet selv. Derfor får hvert bånd
// sin egen x-utstrekning fra `toppIntervall`, og båndet blir et trapes i
// stedet for et rektangel. Da følger ribbene skråkanten helt ut, uten
// trappetrinn — også på en femkant der bare det ene hjørnet er skåret av.
//
// Profilen skal regnes av RADENS høyde, ikke elementets: da står ribbene i
// flukt med naboelementene i samme rad.
//
// `profilM` er [[høyde, bulk]] og `toppM` er overkantens polylinje, begge i
// sceneenheter. `hullM` er hakkene ({x0,x1,y0,y1} fra elementets venstre nedre
// hjørne). Ut kommer et flatt posisjonsarray (x, y, z) der z er bulken.
export function ribbonSkraPos(profilM, lengdeM, toppM, hullM) {
  const ut = [];
  const x0 = -lengdeM / 2;
  const hMaks = Math.max(...(toppM || [[0, 0]]).map(q => q[1]));
  const kl = (v, p, q) => Math.min(q, Math.max(p, v));
  for (let i = 0; i < profilM.length - 1; i++) {
    const [az, ay] = profilM[i], [bz, by] = profilM[i + 1];
    if (az > hMaks + 1e-9 && bz > hMaks + 1e-9) continue;
    const ia = toppIntervall(toppM, Math.min(az, hMaks));
    const ib = toppIntervall(toppM, Math.min(bz, hMaks));
    if (!ia || !ib) continue;
    const aa0 = x0 + ia[0], ab0 = x0 + ia[1];
    const ba0 = x0 + ib[0], bb0 = x0 + ib[1];
    // hakkene tas bort i LENGDEN, bånd for bånd
    const biter = [[Math.min(aa0, ba0), Math.max(ab0, bb0)]];
    for (const h of (hullM || [])) {
      if (h.y1 <= Math.min(az, bz) + 1e-9 || h.y0 >= Math.max(az, bz) - 1e-9) continue;
      const hx0 = x0 + h.x0, hx1 = x0 + h.x1;
      for (let k = biter.length - 1; k >= 0; k--) {
        const [p, q] = biter[k];
        if (hx1 <= p || hx0 >= q) continue;
        biter.splice(k, 1);
        if (hx0 - p > 1e-9) biter.splice(k, 0, [p, hx0]);
        if (q - hx1 > 1e-9) biter.splice(k + (hx0 - p > 1e-9 ? 1 : 0), 0, [hx1, q]);
      }
    }
    const ya = Math.min(az, hMaks) - hMaks / 2, yb = Math.min(bz, hMaks) - hMaks / 2;
    for (const [p, q] of biter) {
      const aa = kl(aa0, p, q), ab = kl(ab0, p, q);
      const ba = kl(ba0, p, q), bb = kl(bb0, p, q);
      if (ab - aa < 1e-9 && bb - ba < 1e-9) continue;
      ut.push(aa, ya, ay, ba, yb, by, bb, yb, by,
              aa, ya, ay, bb, yb, by, ab, ya, ay);
    }
  }
  return ut;
}

// Vinkelen som tekst med norsk desimalkomma: 27.9 → «27,9°».
export function vinkelTekst(grader) {
  return (Number(grader) || 0).toFixed(1).replace(".", ",") + "\u00b0";
}

// Hvor på strekket [fraMm, tilMm] ligger taklinja høyere enn `yMinMm`?
// Taklinja er en ØVRE KONVEKS HYLLE, og da er svaret alltid ETT sammenhengende
// stykke — det er derfor hylla er verdt å ha: uten den måtte hver rad vært delt
// i vilkårlig mange biter der taket vipper inn og ut av radbåndet.
export function takBand(linje, fraMm, tilMm, yMinMm) {
  if (!linje || linje.length < 2) return [fraMm, tilMm];
  let a = null, b = null;
  const se = (t) => {
    if (!(t >= fraMm - 1e-6 && t <= tilMm + 1e-6)) return;
    const q = Math.min(tilMm, Math.max(fraMm, t));
    if (a === null || q < a) a = q;
    if (b === null || q > b) b = q;
  };
  if (takHoyde(linje, fraMm) >= yMinMm) se(fraMm);
  if (takHoyde(linje, tilMm) >= yMinMm) se(tilMm);
  for (let i = 1; i < linje.length; i++) {
    const [x0, y0] = linje[i - 1], [x1, y1] = linje[i];
    if (y0 >= yMinMm) se(x0);
    if (y1 >= yMinMm) se(x1);
    if (x1 !== x0 && (y0 - yMinMm) * (y1 - yMinMm) < 0)
      se(x0 + (x1 - x0) * (yMinMm - y0) / (y1 - y0));
  }
  return (a === null || b === null || b - a <= 0) ? null : [a, b];
}

// OVERKANTEN PÅ ETT ELEMENT, slik taket skjærer den.
//
// Dette er runde 20c sin kjerne, og Emils egen formulering: «går det an at
// veggelement med saltak oppfører seg på samme måte som utsparing — at alt
// utenfor skråkanten fjernes på elementet?» Ja. Elementet beholder feltet sitt
// og full radhøyde, og taket TAR BORT det som stikker over. Resultatet er en
// polylinje langs overkanten, i ELEMENTETS egne mm: x fra venstre ende,
// y over radens bunn.
//
//   flatt tak over hele elementet  → [[0, radH], [L, radH]]   (rett rektangel)
//   taket skjærer det ene hjørnet  → [[0, radH], [x, radH], [L, h]]  (femkant)
//   taket skjærer hele oversiden   → [[0, hV], [L, hH]]       (trapes)
//
// Knekkpunktene er: elementets ender, taklinjas egne knekk, og der taket
// krysser radens topp og bunn. Alt annet er rette linjer imellom.
export function takTopp(linje, fraMm, tilMm, rBunnMm, rToppMm) {
  const radH = rToppMm - rBunnMm;
  const L = tilMm - fraMm;
  if (!linje || linje.length < 2 || !(L > 0)) return [[0, radH], [L, radH]];
  const h = (t) => Math.min(radH, Math.max(0, takHoyde(linje, t) - rBunnMm));
  const xs = [fraMm, tilMm];
  for (const [x] of linje) if (x > fraMm && x < tilMm) xs.push(x);
  // krysningene med radens topp og bunn — der knekker overkanten
  for (const niva of [rToppMm, rBunnMm]) {
    for (let i = 1; i < linje.length; i++) {
      const [x0, y0] = linje[i - 1], [x1, y1] = linje[i];
      if (x1 === x0 || (y0 - niva) * (y1 - niva) >= 0) continue;
      const t = x0 + (x1 - x0) * (niva - y0) / (y1 - y0);
      if (t > fraMm && t < tilMm) xs.push(t);
    }
  }
  xs.sort((a2, b2) => a2 - b2);
  const ut = [];
  for (const x of xs) {
    const px = Math.round((x - fraMm) * 1000) / 1000;
    if (ut.length && Math.abs(ut[ut.length - 1][0] - px) < 0.5) continue;
    ut.push([px, Math.round(h(x))]);
  }
  // rette punkter midt på en rett strekning fjernes — de sier ingenting
  for (let i = ut.length - 2; i > 0; i--) {
    const [x0, y0] = ut[i - 1], [x1, y1] = ut[i], [x2, y2] = ut[i + 1];
    const paa = x2 === x0 ? y0 : y0 + (y2 - y0) * (x1 - x0) / (x2 - x0);
    if (Math.abs(y1 - paa) < 1) ut.splice(i, 1);
  }
  return ut.length >= 2 ? ut : [[0, radH], [L, radH]];
}

// Er overkanten skrå i det hele tatt? Ett tall å teste på, ett sted.
export function toppErSkra(toppP, radHMm) {
  return (toppP || []).some(q => Math.abs(q[1] - radHMm) > 2);
}

// Vinkelen på selve SKRÅKUTTET: den bratteste strekningen i overkanten. Å måle
// over hele elementet ville gitt 0° på en femkant der bare det ene hjørnet er
// tatt av, og for slakt på et element som er dratt forbi taket.
export function toppVinkel(toppP) {
  let best = 0;
  for (let i = 1; i < (toppP || []).length; i++) {
    const dx = toppP[i][0] - toppP[i - 1][0], dy = toppP[i][1] - toppP[i - 1][1];
    if (Math.abs(dx) < 1 || Math.abs(dy) < 1) continue;
    best = Math.max(best, Math.abs(Math.atan2(dy, dx)));
  }
  return Math.round(best * 1800 / Math.PI) / 10;
}

// x-strekningen der overkanten ligger PÅ ELLER OVER høyden `z`. Taklinja er en
// øvre konveks hylle klippet til radbåndet, så svaret er alltid ett stykke.
export function toppIntervall(toppP, z) {
  const P = toppP || [];
  if (P.length < 2) return null;
  let a2 = null, b2 = null;
  const se = (x) => { if (a2 === null || x < a2) a2 = x; if (b2 === null || x > b2) b2 = x; };
  for (let i = 0; i < P.length; i++) {
    if (P[i][1] >= z) se(P[i][0]);
    if (i === 0) continue;
    const [x0, y0] = P[i - 1], [x1, y1] = P[i];
    if ((y0 - z) * (y1 - z) < 0 && y1 !== y0) se(x0 + (x1 - x0) * (z - y0) / (y1 - y0));
  }
  return (a2 === null || b2 === null || b2 - a2 <= 0) ? null : [a2, b2];
}

// ÉN RAD I ÉTT FELT, kappet mot taket. Svaret er bitene raden faktisk består
// av — vanligvis nøyaktig én, som er hele feltet:
//   · taket ligger over hele raden      → [{fra, til}] uendret, som før runde 20
//   · taket knekker inne i raden (møne) → to biter med skjøt i mønet, for et
//                                          panel kan skrås, men ikke brettes
//   · taket dykker under radens bunn    → biten kortes av der taket krysser
//   · taket ligger helt under raden     → ingen bit; raden finnes ikke her
export function takSpenn(linje, fraMm, tilMm, rBunnMm, rToppMm, klaringMm, minBitMm, minHoydeMm) {
  if (!linje || linje.length < 2) return [{ fra: fraMm, til: tilMm }];
  const kl = Number(klaringMm) >= 0 ? Number(klaringMm) : 0;
  const min = Number(minBitMm) > 0 ? Number(minBitMm) : 0;
  // Tynneste tillatte ende. NULL BETYR NULL: da går kilen helt ut til der taket
  // krysser radbunnen, og veggen møter takflaten uten hull. Aldri mer enn halve
  // radhøyden — ellers ville en 190 mm tilpasningsrad forsvunnet helt fordi
  // grensa sto på 300.
  const oppgitt = Number(minHoydeMm);
  const minH = Math.min(Number.isFinite(oppgitt) ? Math.max(0, oppgitt) : min,
                        (rToppMm - rBunnMm) / 2);
  // Bare knekk som faktisk skjærer DENNE raden gir skjøt. Mønet over en rad
  // som uansett er full i hele feltet skal ikke dele den i to.
  const kn = takKnekk(linje, fraMm, tilMm)
    .filter(t => { const y = takHoyde(linje, t); return y > rBunnMm + 1 && y < rToppMm - 1; });
  // MØNET er den ENESTE grunnen til å skjøte. Fram til runde 20c skjøtet vi
  // også der taket krysset radens TOPP — og det var feilen Emil pekte på
  // (08.09): gavlen ble en TRAPP, der hvert felt sto med ett rett element og
  // en skrå stump ved siden av. Et panel kan ikke brettes, så mønet må være en
  // skjøt; men et rektangel med ETT avskåret hjørne er en helt vanlig
  // panelform, og den trenger ingen skjøt. Elementet beholder feltet sitt, og
  // TAKET SKJÆRER I DET — akkurat som en utsparing gjør (Emils egen modell).
  const g = [fraMm, ...kn, tilMm];
  g.sort((x, y) => x - y);
  for (let i = g.length - 1; i > 0; i--) if (g[i] - g[i - 1] < 1) g.splice(i, 1);
  const ut = [];
  for (let i = 0; i < g.length - 1; i++) {
    let fra = i === 0 ? fraMm : g[i] + kl;
    let til = i === g.length - 2 ? tilMm : g[i + 1] - kl;
    const bandet = takBand(linje, fra, til, rBunnMm + minH);
    if (!bandet) continue;
    fra = Math.max(fra, Math.round(bandet[0]));
    til = Math.min(til, Math.round(bandet[1]));
    if (til - fra < min) continue;
    ut.push({ fra, til });
  }
  return ut;
}

// ═════════ RANDVANDRING: fasadene følger byggets FAKTISKE kontur ═════════
// Et konvekst hull kan ikke ha innvendige hjørner. På et L-, T- eller U-formet
// bygg spenner hullet en diagonal over hakket, og generatoren satte lydig
// veggelement på diagonalen — Emils lagerbygg 04.09: to «vegger» på 10 012 mm
// i løse lufta. Randvandringen går i stedet LANGS veggen etter
// høyrehåndsregelen: fra hver søyle prøves HØYRE, RETT FRAM og VENSTRE i den
// rekkefølgen, og nærmeste søyle i den retningen blir den neste. Det gir
// riktig kontur for alle rettvinklede grunnriss, uansett hakk og tilbygg.

// Byggets hovedretning: medianen av retningene mellom nære søylepar, målt
// mod 90°. Et rotert bygg behandles dermed som et akseparallelt.
export function hovedVinkel(soyler, maksAvstand) {
  const maks = Number(maksAvstand) > 0 ? Number(maksAvstand) : Infinity;
  const v = [];
  for (let i = 0; i < soyler.length; i++)
    for (let j = i + 1; j < soyler.length; j++) {
      const dx = soyler[j].cx - soyler[i].cx, dz = soyler[j].cz - soyler[i].cz;
      const L = Math.hypot(dx, dz);
      if (L < 1e-9 || L > maks) continue;
      const a = ((Math.atan2(dz, dx) * 180 / Math.PI) % 90 + 90) % 90;
      v.push(((a + 45) % 90) - 45);
    }
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] * Math.PI / 180;
}

// Rekkefølgen søylene står i langs veggen (indekser), eller null når
// vandringen ikke kommer helt rundt — da er bygget ikke rettvinklet, og
// kalleren faller tilbake på konveksHull som før.
export function randRekke(soyler, latTol, maksAvstand) {
  const n = (soyler || []).length;
  const lat = Number(latTol) > 0 ? Number(latTol) : 0;
  if (n < 3 || !lat) return null;
  const th = hovedVinkel(soyler, maksAvstand);
  const c = Math.cos(th), sn = Math.sin(th);
  const P = soyler.map(x => ({ u: x.cx * c + x.cz * sn, v: -x.cx * sn + x.cz * c }));
  let start = 0;
  for (let i = 1; i < n; i++) {
    const a = Math.round(P[i].v / lat), b = Math.round(P[start].v / lat);
    if (a < b || (a === b && P[i].u < P[start].u)) start = i;
  }
  const rekke = [start], brukt = new Set([start]);
  let dx = 1, dz = 0;
  for (let steg = 0; steg < n * 4; steg++) {
    const cur = P[rekke[rekke.length - 1]];
    let valgt = -1, vdx = 0, vdz = 0;
    for (const [ndx, ndz] of [[dz, -dx], [dx, dz], [-dz, dx]]) {
      let best = -1, bestL = Infinity;
      for (let i = 0; i < n; i++) {
        if (brukt.has(i) && !(i === start && rekke.length > 2)) continue;
        const fram = (P[i].u - cur.u) * ndx + (P[i].v - cur.v) * ndz;
        const side = Math.abs((P[i].u - cur.u) * ndz - (P[i].v - cur.v) * ndx);
        if (fram <= 1e-6 || side > lat) continue;
        if (fram < bestL) { bestL = fram; best = i; }
      }
      if (best >= 0) { valgt = best; vdx = ndx; vdz = ndz; break; }
    }
    if (valgt < 0) return null;
    dx = vdx; dz = vdz;
    if (valgt === start) return rekke.length >= 3 ? rekke : null;
    rekke.push(valgt); brukt.add(valgt);
  }
  return null;
}

// Fasadene langs randen. Samme form som fasaderFra, men konturen kan ha
// innvendige hjørner. Returnerer null når vandringen ikke lukker seg.
export function fasaderLangsRand(soyler, latTol, maksAvstand) {
  const rekke = randRekke(soyler, latTol, maksAvstand);
  if (!rekke) return null;
  const R = rekke.map(i => soyler[i]), n = R.length;
  const th = hovedVinkel(soyler, maksAvstand);
  const c = Math.cos(th), sn = Math.sin(th);
  const rot = (x) => ({ u: x.cx * c + x.cz * sn, v: -x.cx * sn + x.cz * c });
  // Retningen mellom hvert nabopar, rundet til nærmeste akse i byggets frame.
  const retn = [];
  for (let i = 0; i < n; i++) {
    const a = rot(R[i]), b = rot(R[(i + 1) % n]);
    const du = b.u - a.u, dv = b.v - a.v;
    retn.push(Math.abs(du) >= Math.abs(dv) ? (du > 0 ? [1, 0] : [-1, 0]) : (dv > 0 ? [0, 1] : [0, -1]));
  }
  const lik = (a, b) => a[0] === b[0] && a[1] === b[1];
  let start = 0;
  for (let i = 0; i < n; i++) if (!lik(retn[i], retn[(i - 1 + n) % n])) { start = i; break; }
  const lop = [];
  let cur = [R[start]], dd = retn[start];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    cur.push(R[(i + 1) % n]);
    if (!lik(retn[(i + 1) % n], retn[i])) { lop.push({ punkter: cur, dd: retn[i] }); cur = [R[(i + 1) % n]]; }
  }
  if (cur.length > 1) lop.push({ punkter: cur, dd: retn[(start - 1 + n) % n] });
  // Utover-normalen finnes ved å prøve begge og se hvilken som peker UT av
  // konturen. Tyngdepunktet duger ikke: på et L-bygg ligger tyngdepunktet på
  // feil side av veggene rundt hakket.
  const poly = R.map(x => ({ x: x.cx, z: x.cz }));
  const inni = (px, pz) => {
    let inne = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > pz) !== (b.z > pz) && px < (b.x - a.x) * (pz - a.z) / (b.z - a.z) + a.x) inne = !inne;
    }
    return inne;
  };
  const ut = [];
  for (const { punkter, dd } of lop) {
    if (punkter.length < 2) continue;
    const ex = dd[0] * c - dd[1] * sn, ez = dd[0] * sn + dd[1] * c;
    let nx = ez, nz = -ex;
    const mx = punkter.reduce((a, x) => a + x.cx, 0) / punkter.length;
    const mz = punkter.reduce((a, x) => a + x.cz, 0) / punkter.length;
    const prov = Math.max(...punkter.map(x => Math.max(x.bx, x.bz))) + 1e-6;
    if (inni(mx + nx * prov, mz + nz * prov)) { nx = -nx; nz = -nz; }
    const p = { x: punkter[0].cx, z: punkter[0].cz };
    const paKant = punkter.map(s => ({ s, t: (s.cx - p.x) * ex + (s.cz - p.z) * ez }))
      .sort((a, b) => a.t - b.t);
    ut.push({
      p, ex, ez, nx, nz, soyler: paKant,
      toppY: Math.max(...paKant.map(k => k.s.maxY)),
      kolBredde: paKant.map(k => k.s.bredde).sort((a, b) => a - b)[Math.floor(paKant.length / 2)]
    });
  }
  return ut.length >= 3 ? knyttNaboer(ut) : null;
}

// Hver fasade får naboenes utover-normaler. Hjørnelappen (pinwheel) trenger
// dem for å vite om hjørnet er UTVENDIG (naboveggen ligger foran enden, og
// elementet må løpe forbi) eller INNVENDIG (naboveggen ligger bak enden, og
// elementet må stoppe tilsvarende kortere).
export function knyttNaboer(fasader) {
  const m = fasader.length;
  for (let i = 0; i < m; i++) {
    const f = fasader[(i - 1 + m) % m], n2 = fasader[(i + 1) % m];
    fasader[i].forrigeN = { x: f.nx, z: f.nz };
    fasader[i].nesteN = { x: n2.nx, z: n2.nz };
  }
  return fasader;
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
  // 🧭 ÅPNINGENS EGEN AKSE lagres. Den er kjent her — den kommer av
  // sideflatene brukeren trykket på — og er det eneste som skiller «veggen
  // som løper LANGS åpningen» fra «veggen som krysser den». Uten den kunne en
  // innervegg på tvers stjele en åpning fra ytterveggen (Emil 08.09: en
  // utsparing i et vindu lagde en ekstra utsparing i innerveggen).
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z],
           akse, kilde, antFlater: pkt.length };
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
export function kappNavn(forelder, tekst) {
  const s = String(tekst == null ? "" : tekst).trim();
  // «*» alene (og den gamle verdien "stjerne") betyr Lørenskog-stilen:
  // forelderens nummer med stjerne. Alt annet er Emils egen tekst.
  if (s === "*" || s === "stjerne") return forelder ? forelder + "*" : "SW-XX";
  const rest = s.replace(/^SW[-\s]*/i, "").trim();   // «SW-18*» og «18*» er samme
  if (!rest || rest.toUpperCase() === "XX") return "SW-XX";
  return "SW-" + rest;
}

// Lista i Moelv-formatet, som rader til regnearket. Tilpassede biter (SW-XX) samles
// på like mål. m² = lengde × høyde × antall.
export function swListeRader(elementer, felter) {
  const f = felter || {};
  const grupper = new Map();
  for (const e of elementer) {
    const navn = e.sw || "SW-XX";
    // KAPP KJENNES PÅ ELEMENTET, ikke på navnet. Da kappnavnet ble fritt
    // (Emil 03.09) sluttet «SW-XX» å være noe å kjenne kapp igjen på.
    const kapp = !!e.tilpasset || navn === "SW-XX" || /\*$/.test(navn);
    // 🏔 SKRÅKAPP: høyden er ikke ett tall. Elementet føres med begge
    // endehøydene («1100/460»), og arealet regnes av MIDDELHØYDEN — et trapes,
    // ikke et rektangel. To biter med samme lengde men speilvendt kapp er
    // ikke samme vare og skal ikke slås sammen; derfor står begge tallene i
    // nøkkelen, i den rekkefølgen de står i elementet.
    const skra = !!e.skra && e.hVMm !== undefined && e.hHMm !== undefined;
    const hTekst = skra ? e.hVMm + "/" + e.hHMm : e.hoydeMm;
    const snittH = skra ? (e.hVMm + e.hHMm) / 2 : e.hoydeMm;
    const k = navn + "|" + Math.round(e.lengdeMm) + "|" + hTekst;
    if (!grupper.has(k)) grupper.set(k, { navn, kapp, lengdeMm: Math.round(e.lengdeMm),
      hoydeMm: hTekst, snittH, antall: 0,
      // Vinkelen på skråkuttet, tom på et rett element (Emil 08.09).
      vinkel: skra ? vinkelTekst(skraVinkel(e.lengdeMm, e.hVMm, e.hHMm)) : "" });
    grupper.get(k).antall++;
  }
  const sortert = [...grupper.values()].sort((a, b) => {
    const ax = a.kapp, bx = b.kapp;
    if (ax !== bx) return ax ? 1 : -1;         // kappbitene nederst
    return a.navn.localeCompare(b.navn, "no") || a.lengdeMm - b.lengdeMm
      || String(a.hoydeMm).localeCompare(String(b.hoydeMm), "no");
  });
  const m2 = (g) => g.lengdeMm / 1000 * (g.snittH !== undefined ? g.snittH : g.hoydeMm) / 1000 * g.antall;
  const nb = (n, d) => n.toFixed(d).replace(".", ",");
  const ut = [
    ["Project", f.prosjekt || ""], ["Project nr.", f.oppdragsnr || ""],
    ["Location", f.sted || ""], ["Date", f.dato || ""], ["Sign.", f.sign || ""],
    [],
    // Kolonnen «Cut angle» er lagt TIL SLUTT med vilje: Moelv-kolonnene beholder
    // plassen sin, og SUM-formlene under peker fortsatt på kolonne 4 og 8.
    ["Elementnr.", "Length [mm]", "Heigth [mm]", "Thickness [mm]", "Count [stk]",
     "Insulation", "Exterior Colour", "Interior Colour", "m2", "Cut angle"]
  ];
  const forsteData = ut.length + 1;            // første datarad i arket
  for (const g of sortert) {
    ut.push([g.navn, g.lengdeMm, g.hoydeMm, f.tykkelseMm || "", g.antall,
      f.isolasjon || "", f.utvFarge || "", f.innFarge || "", nb(m2(g), 1),
      g.vinkel || ""]);
  }
  // SUM-formler, ikke ferdige tall (Emil 03.09): summen skal vise hvilke rader
  // den kommer fra, og følge med om noen redigerer arket etterpå.
  const sisteData = ut.length;                 // radnummer i arket (1-basert)
  ut.push(["Total", "", "", f.tykkelseMm || "",
    sumFormel(4, forsteData, sisteData), f.isolasjon || "",
    f.utvFarge || "", f.innFarge || "", sumFormel(8, forsteData, sisteData), ""]);
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

// To bokser hører til SAMME søylestabel når de overlapper i grunnrisset,
// eller når sentrene står nærmere enn `tol`. Overlappregelen er den som
// fanger T- og L-forlengere oppå en firkantsøyle.
export function sammeSoyle(a, b, tol) {
  if (a.mnx <= b.mxx && b.mnx <= a.mxx && a.mnz <= b.mxz && b.mnz <= a.mxz) return true;
  return Math.hypot(a.cx - b.cx, a.cz - b.cz) < (Number(tol) || 0);
}

async function hentSoyler() {
  if (!S.glbActive) await sikreMeta(alleElementIder);
  const bokser = allElementBoxes();
  const rå = [];
  for (const [id, b] of bokser) {
    if (soyleTypeNavn(id) !== "Column") continue;
    // 🚪 ELEMENT-ID-EN FØLGER MED (del B). Innerveggene pekes ut ved å trykke
    // på søylene i modellen, og da må et trykk kunne slås opp i en søylestabel.
    // Del A rører ikke feltet.
    rå.push({ id, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2,
      mnx: b.min.x, mnz: b.min.z, mxx: b.max.x, mxz: b.max.z,
      minY: b.min.y, maxY: b.max.y,
      bx: b.max.x - b.min.x, bz: b.max.z - b.min.z,
      bredde: Math.min(b.max.x - b.min.x, b.max.z - b.min.z) });
  }
  // SØYLE + FORLENGER SLÅS SAMMEN PÅ OVERLAPP I GRUNNRISSET, ikke på avstand
  // mellom sentrene (Emils lagerbygg 04.09). Forlengerne er T- og L-profiler
  // som står oppå en firkantsøyle, og et T-tverrsnitt har tyngdepunkt et helt
  // annet sted enn en firkant: med 15 cm senterkrav ble 10 av 22 forlengere
  // på Hegdalringen aldri koblet til søyla si, søyla mistet skjøten sin, og
  // veggen ble ett element på 25 m. Overlapper boksene, er det samme søyle.
  const tol = 0.15 / (S.enhetSkala || 1);
  const ut = [];
  for (const s of rå) {
    const treff = ut.find(u => sammeSoyle(u, s, tol));
    if (treff) {
      treff.ider.push(s.id);
      treff.minY = Math.min(treff.minY, s.minY);
      treff.maxY = Math.max(treff.maxY, s.maxY);
      treff.mnx = Math.min(treff.mnx, s.mnx); treff.mnz = Math.min(treff.mnz, s.mnz);
      treff.mxx = Math.max(treff.mxx, s.mxx); treff.mxz = Math.max(treff.mxz, s.mxz);
      treff.deler.push({ minY: s.minY, maxY: s.maxY, cx: s.cx, cz: s.cz,
        bx: s.bx, bz: s.bz, bredde: s.bredde });
    } else ut.push({ ...s, ider: [s.id], deler: [{ minY: s.minY, maxY: s.maxY, cx: s.cx, cz: s.cz,
      bx: s.bx, bz: s.bz, bredde: s.bredde }] });
  }
  // Har søyla en SØYLEFORLENGER? Forlengeren er et EGET søyleelement som står
  // oppå søyla (Emils bilde 1: de blå stubbene på toppen). Finner vi to deler
  // der den øvre starter der den nedre slutter, står søyla under en forlenger.
  // SENTER OG BREDDE tas fra den NEDERSTE delen — den ekte søyla. En forlenger
  // med annen profil skal verken flytte skjøtepunktet eller dytte veggen ut.
  const stakkTol = 0.3 / (S.enhetSkala || 1);
  for (const u of ut) {
    const d = u.deler.slice().sort((a, b) => a.minY - b.minY);
    u.harForlenger = d.some((x, i) => i > 0 && x.minY >= d[i - 1].maxY - stakkTol);
    u.cx = d[0].cx; u.cz = d[0].cz;
    u.bx = d[0].bx; u.bz = d[0].bz; u.bredde = d[0].bredde;
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
  return knyttNaboer(ut);
}

// Hvilke søyler DELER veggen i spenn. Regelen fra runde 5 var «bare søyler som
// når fasadens HØYESTE punkt» — den forutsetter at fasadetoppen er vannrett, og
// falt på Arendals pulttak (04.09: 1200 mm fall over 30 m, veggen sluttet 11,9 m
// for tidlig). Nå ser vi på HELE søyla i stedet for bare toppen:
//
//   en søyle deler veggen når den STÅR PÅ OK BETONG og NÅR MINST `andel`
//   av fasadens høyde.
//
// Det skiller riktig i alle tilfellene vi har møtt:
//   • pulttak/gavl — søylene når 86–92 % av høyden og beholdes alle sammen
//   • losholt over en port — står på gulvet, men når bare 19 % → ut
//   • mesanin- og vindavstivningssøyler — starter langt over gulvet → ut
// Endesøylene beholdes alltid; de er hjørnene, uansett høyde.
export function spennSoyler(soyler, okBetong, andel, bunnTol) {
  const n = (soyler || []).length;
  if (n < 3) return soyler || [];
  const ok = Number(okBetong);
  if (!Number.isFinite(ok)) return soyler;
  const del = Number(andel) > 0 ? Number(andel) : 0.7;
  const bt = Number(bunnTol) > 0 ? Number(bunnTol) : 0;
  const topp = Math.max(...soyler.map(k => k.s.maxY));
  const minTopp = ok + (topp - ok) * del;
  const ut = soyler.filter((k, i) =>
    i === 0 || i === n - 1 || (k.s.minY <= ok + bt && k.s.maxY >= minTopp));
  return ut.length >= 2 ? ut : soyler;
}

// GAVLSØYLER UTEN FORLENGER (Sundland 04.09). `veggSoyler` bruker forlengerne
// til å finne KONTUREN, og det er riktig — en tilbyggsramme uten forlenger skal
// ikke dra fasaden ut. Men på gavlene bærer søylene taket direkte og har ingen
// forlenger i det hele tatt. Da satt gavlen igjen med bare de to hjørnesøylene,
// og hele veggen ble ETT element på 24 120 mm per rad.
// Konturen røres ikke. Vi legger bare til søyler som allerede STÅR I fasadens
// plan, innenfor fasadens lengde, og som består samme hele-søyla-prøve som
// over. Innvendige søylerekker ligger meter unna fasadeplanet og kommer aldri
// med.
export function fasadeSoyler(fasade, alleSoyler, kolTol, okBetong, andel) {
  const paa = fasade.soyler.slice();
  const kjent = new Set(paa.map(k => k.s));
  const t0 = paa[0].t, t1 = paa[paa.length - 1].t;
  const tol = Number(kolTol) > 0 ? Number(kolTol) : 0;
  const ok = Number(okBetong);
  const del = Number(andel) > 0 ? Number(andel) : 0.7;
  const topp = Math.max(...paa.map(k => k.s.maxY));
  const minTopp = ok + (topp - ok) * del;
  for (const sø of alleSoyler || []) {
    if (kjent.has(sø)) continue;
    const t = (sø.cx - fasade.p.x) * fasade.ex + (sø.cz - fasade.p.z) * fasade.ez;
    const avst = Math.abs((sø.cx - fasade.p.x) * fasade.nx + (sø.cz - fasade.p.z) * fasade.nz);
    if (avst > tol || t < t0 + tol || t > t1 - tol) continue;
    if (!(sø.minY <= ok + tol && sø.maxY >= minTopp)) continue;
    paa.push({ s: sø, t });
  }
  paa.sort((a, b) => a.t - b.t);
  return paa;
}

// ═══════════════════ 🚪 INNERVEGGER (del B, Emils plan 08.09) ═══════════════════
//
// EN INNERVEGG FINNES IKKE AUTOMATISK — DEN PEKES UT. Del A leter seg fram til
// ytterveggene av seg selv (randvandring rundt søylene), og det er riktig der:
// konturen av et bygg er entydig. Inne i bygget er den ikke det. En søylerekke
// midt i en hall kan være en mesaninvegg, en brannvegg, en bod — eller bare en
// søylerekke som bærer taket. Ingen regel i geometrien skiller dem, og runde
// 19–20 viste hva som skjer når vi later som den finnes: hvert bygg får sitt
// eget unntak.
//
// Derfor markerer Emil søylene selv, velger radhøyder/tykkelse/farge/ringmur og
// vegghøyde, og velger til slutt hvilken SIDE av søylene veggen kommer opp på.
// Innerveggene får sin EGEN SW-serie som starter på SW-01, sin egen
// instruksjonstegning og sin egen elementliste. Ytterveggene røres ikke.

// Aksen gjennom de markerte søylene.
//
// Retningen tas fra de TO SØYLENE SOM STÅR LENGST FRA HVERANDRE, ikke fra en
// regresjonslinje gjennom alle: ytterpunktene er de som faktisk definerer
// veggens lengde, og en rekke der én søyle står 40 mm ute skal gi samme akse
// som en rett rekke.
//
// t = 0 legges på den FØRSTE søyla langs aksen, så alle mål i veggen regnes
// derfra — samme konvensjon som fasadene i del A.
export function innerveggAkse(soyler) {
  const alle = (soyler || []).filter(s => s && isFinite(s.cx) && isFinite(s.cz));
  if (alle.length < 2) return null;
  let a = alle[0], b = alle[1], best = -1;
  for (let i = 0; i < alle.length; i++)
    for (let j = i + 1; j < alle.length; j++) {
      const d = Math.hypot(alle[i].cx - alle[j].cx, alle[i].cz - alle[j].cz);
      if (d > best) { best = d; a = alle[i]; b = alle[j]; }
    }
  if (!(best > 1e-9)) return null;
  let ex = (b.cx - a.cx) / best, ez = (b.cz - a.cz) / best;
  // Retningen gjøres ENTYDIG. Uten dette ville samme søylerekke gitt speilvendt
  // tegning avhengig av hvilken søyle brukeren tilfeldigvis trykket på først.
  if (ex < -1e-9 || (Math.abs(ex) <= 1e-9 && ez < 0)) { ex = -ex; ez = -ez; }
  const nx = ez, nz = -ex;
  const t0 = Math.min(...alle.map(s => (s.cx - a.cx) * ex + (s.cz - a.cz) * ez));
  const p = { x: a.cx + ex * t0, z: a.cz + ez * t0 };
  const liste = alle.map(s => ({ s, t: (s.cx - p.x) * ex + (s.cz - p.z) * ez }))
    .sort((u, v) => u.t - v.t);
  return { p, ex, ez, nx, nz, soyler: liste };
}

// KJEDEN gjennom de markerte søylene.
//
// Et hjørne kan ikke leses av «de to søylene som står lengst fra hverandre» —
// da blir en L til en diagonal tvers gjennom bygget (Emil 08.09, bilde 4).
// Søylene må først settes i REKKEFØLGE langs veggen: nærmeste ubesøkte nabo,
// fra den ene enden. Startenden velges ENTYDIG (minste x, så z), så
// klikkerekkefølgen ikke kan snu kjeden — og dermed ikke speilvende tegninga.
export function soyleKjede(soyler) {
  const alle = (soyler || []).filter(s => s && isFinite(s.cx) && isFinite(s.cz));
  if (alle.length < 3)
    return alle.slice().sort((a, b) => (a.cx - b.cx) || (a.cz - b.cz));
  let a = alle[0], b = alle[1], best = -1;
  for (let i = 0; i < alle.length; i++)
    for (let j = i + 1; j < alle.length; j++) {
      const d = Math.hypot(alle[i].cx - alle[j].cx, alle[i].cz - alle[j].cz);
      if (d > best) { best = d; a = alle[i]; b = alle[j]; }
    }
  const start = ((a.cx - b.cx) || (a.cz - b.cz)) <= 0 ? a : b;
  const igjen = alle.filter(s => s !== start);
  const ut = [start];
  while (igjen.length) {
    const forrige = ut[ut.length - 1];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < igjen.length; i++) {
      const d = Math.hypot(igjen[i].cx - forrige.cx, igjen[i].cz - forrige.cz);
      if (d < bd) { bd = d; bi = i; }
    }
    ut.push(igjen.splice(bi, 1)[0]);
  }
  return ut;
}

// BEINA: kjeden delt der veggen KNEKKER.
//
// Ett hjørne gir to bein, en U gir tre. Hjørnesøyla hører til BEGGE beina, så
// begge veggene når fram til hjørnet. Hvert bein får sin egen akse og sine egne
// naboer, slik at hjørnet kan lappes med samme pinwheel-regel del A bruker.
//
// `lukk` = true legger til det siste beinet tilbake til første søyle — et rom
// rundt (kontor inne i hallen). Den er et VALG i panelet, ikke noe som gjettes:
// avstanden fra siste til første søyle kan like godt være en L som er litt
// dyp, og runde 19–20 viste hva som skjer når vi gjetter.
export function innerveggBein(soyler, knekkGrader, lukk) {
  const kjede = soyleKjede(soyler);
  if (kjede.length < 2) return [];
  const pkt = (lukk && kjede.length >= 3) ? kjede.concat([kjede[0]]) : kjede;
  const gr = Number(knekkGrader) > 0 ? Number(knekkGrader) : 25;
  const grense = Math.cos(gr * Math.PI / 180);
  const seg = [];
  for (let i = 0; i < pkt.length - 1; i++) {
    const dx = pkt[i + 1].cx - pkt[i].cx, dz = pkt[i + 1].cz - pkt[i].cz;
    const l = Math.hypot(dx, dz);
    if (l > 1e-9) seg.push({ i, ex: dx / l, ez: dz / l });
  }
  if (!seg.length) return [];
  const knekk = [];
  let dir = seg[0];
  for (const s of seg.slice(1))
    if (dir.ex * s.ex + dir.ez * s.ez < grense) { knekk.push(s.i); dir = s; }
  const grenser = [0, ...knekk, pkt.length - 1];
  const ut = [];
  for (let k = 0; k < grenser.length - 1; k++) {
    const liste = pkt.slice(grenser[k], grenser[k + 1] + 1);
    if (liste.length < 2) continue;
    // Retningen tas fra beinets FØRSTE til SISTE søyle, ikke fra første
    // segment: en søyle som står litt ute skal ikke dreie beinet.
    const f = liste[0], l = liste[liste.length - 1];
    const dx = l.cx - f.cx, dz = l.cz - f.cz;
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-9)) continue;
    const ex = dx / len, ez = dz / len;
    const ts = liste.map(s => (s.cx - f.cx) * ex + (s.cz - f.cz) * ez);
    const tmin = Math.min(...ts);
    const p = { x: f.cx + ex * tmin, z: f.cz + ez * tmin };
    ut.push({ p, ex, ez, nx: ez, nz: -ex,
      soyler: liste.map((s, i) => ({ s, t: ts[i] - tmin })).sort((u, v) => u.t - v.t) });
  }
  // Naboenes normaler. Fortegnet på siden legges på der de BRUKES, ikke her:
  // bytter Emil side, skal hjørnelappen bytte side med den.
  for (let i = 0; i < ut.length; i++) {
    const forrige = i > 0 ? ut[i - 1] : (lukk && ut.length > 2 ? ut[ut.length - 1] : null);
    const neste = i < ut.length - 1 ? ut[i + 1] : (lukk && ut.length > 2 ? ut[0] : null);
    ut[i].forrigeN = forrige ? { x: forrige.nx, z: forrige.nz } : null;
    ut[i].nesteN = neste ? { x: neste.nx, z: neste.nz } : null;
  }
  return ut;
}

// HØRER ÅPNINGEN TIL DENNE VEGGEN?
//
// Regelen er del A sin fra runde 6, trukket ut som én funksjon så ytterveggene
// og innerveggene ikke kan svare forskjellig: veggplanet må FAKTISK GÅ GJENNOM
// åpningsboksen, og åpningen må ligge langs veggens lengde. Uten det kunne en
// port kappe veggen på motsatt side av et smalt bygg fordi den var «nærmest».
// Svaret er avstanden fra planet (til å velge nærmeste vegg), eller null.
export function apningPaVegg(f, u, slark) {
  if (!f || !u || !u.min || !u.max) return null;
  const cx = (u.min[0] + u.max[0]) / 2, cz = (u.min[2] + u.max[2]) / 2;
  const halvX = (u.max[0] - u.min[0]) / 2, halvZ = (u.max[2] - u.min[2]) / 2;
  // 🧭 VEGGEN MÅ LØPE LANGS ÅPNINGEN. En vegg som KRYSSER åpningen skal aldri
  // eie den, uansett hvor nær planet ligger.
  //
  // Dette var hullet i regelen: rekkevidden under regnes av boksens utstrekning
  // PÅ TVERS AV VEGGEN, og for en vegg på tvers er «på tvers» åpningens
  // BREDDE. En 4280 mm bred åpning ga dermed 2140 mm rekkevidde til hver side,
  // og en innervegg et par meter unna stjal den — og fikk et hull som var
  // 1074 mm bredt, altså boksens dybde (Emil 08.09).
  //
  // Aksen lagres på åpningen når den markeres. Er den ikke lagret (markert av
  // en eldre versjon), leses den av boksen: dybden på tvers er alltid punktenes
  // spredning pluss 2 × 500 mm slark, så den LENGSTE vannrette siden er aksen.
  const akse = (u.akse === "x" || u.akse === "z") ? u.akse : (halvX >= halvZ ? "x" : "z");
  const langs = akse === "x" ? Math.abs(f.ex) : Math.abs(f.ez);
  if (langs < 0.7) return null;                 // mer enn 45° på tvers
  const tt = (cx - f.px) * f.ex + (cz - f.pz) * f.ez;
  const t0 = Math.min(f.t0, f.t1), t1 = Math.max(f.t0, f.t1);
  if (tt < t0 - 1 || tt > t1 + 1) return null;
  const avst = Math.abs((cx - f.px) * f.nx + (cz - f.pz) * f.nz);
  const rekkevidde = Math.abs(f.nx) * halvX + Math.abs(f.nz) * halvZ + (Number(slark) || 0);
  return avst > rekkevidde ? null : avst;
}

// Hvor langt fra søyleaksen ligger MIDTEN av veggplanet?
//
// Samme regning som ytterveggene (runde 2: veggen skal stå FLUKT inntil den
// faktiske søyleflaten, ikke inntil en medianbredde), men siden er brukerens
// valg — en innervegg har ingen «utside». `side` er +1 eller −1 og peker langs
// ±(nx, nz); svaret er avstanden langs DEN siden, alltid positiv.
export function innerveggOffset(akse, side, tykkelse) {
  if (!akse || !akse.soyler || !akse.soyler.length) return 0;
  const sg = Number(side) < 0 ? -1 : 1;
  const nx = akse.nx * sg, nz = akse.nz * sg;
  let ytre = 0;
  for (const k of akse.soyler) {
    const lat = (k.s.cx - akse.p.x) * nx + (k.s.cz - akse.p.z) * nz;
    const halv = (Math.abs(nx) * (k.s.bx || 0) + Math.abs(nz) * (k.s.bz || 0)) / 2;
    ytre = Math.max(ytre, lat + halv);
  }
  return ytre + (Number(tykkelse) || 0) / 2;
}

// Elementene i én innervegg, som rene mm.
//
// Rammen er FELT UTENPÅ, RADER INNENFOR — samme rekkefølge som del A, så
// SW-numrene kommer felt for felt langs veggen og radene nedenfra og opp.
//
// ENDENE er den ene forskjellen fra en yttervegg. Ytterveggene løper forbi
// hjørnet og dekker naboveggens endeflate; en innervegg har ingen nabovegg å
// møte, og hvor den slutter vet bare den som har tegnet bygget. Standard er
// derfor det ETTERPRØVBARE valget: veggen går fra første til siste søylesenter.
// `endeMm` skyver begge endene utover, for den som vil ta veggen helt inn til
// ytterveggen.
//
// UTSPARINGENE behandles med NØYAKTIG samme regler som ytterveggene (runde 12):
// en åpning som tar HELE radhøyden deler raden i to korte element; en som bare
// skjærer inn i den blir et HAKK i et element som beholder full høyde og full
// feltlengde. Det er `delRadApninger` og `delOppMedUtsparinger` som avgjør —
// samme to funksjoner del A bruker, ikke et nytt regelsett.
export function innerveggBiter(skjot, rader, kappIndex, klaringMm, minBitMm, endeMm, apninger) {
  const ut = [];
  const sk = (skjot || []).map(Number).filter(n => isFinite(n));
  const rd = (rader || []).map(Number).filter(n => n > 0);
  if (sk.length < 2 || !rd.length) return ut;
  const kl = Number(klaringMm) || 0;
  const minBit = Number(minBitMm) || 0;
  // `endeMm` er ett tall (samme i begge ender) eller [fra, til] — hjørnet
  // trenger ulik lapp i hver ende, en fri ende trenger samme.
  const e = Array.isArray(endeMm)
    ? [Number(endeMm[0]) || 0, Number(endeMm[1]) || 0]
    : [Number(endeMm) || 0, Number(endeMm) || 0];
  const apn = (apninger || []).filter(a => a && isFinite(a.fraMm) && isFinite(a.tilMm_));
  const radBunn = [];
  { let b = 0; for (const h of rd) { radBunn.push(b); b += h; } }
  for (let i = 0; i < sk.length - 1; i++) {
    const fra = i === 0 ? sk[0] - e[0] : sk[i] + kl;
    const til = i === sk.length - 2 ? sk[sk.length - 1] + e[1] : sk[i + 1] - kl;
    const full = til - fra;
    if (full < minBit) continue;
    for (let r = 0; r < rd.length; r++) {
      const rBunn = radBunn[r], rTopp = rBunn + rd[r];
      const radApninger = apn
        .filter(a => Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) > 10);
      const { hele, notch } = delRadApninger(rBunn, rTopp, radApninger, minBit);
      const kutt = hele.map(a => [a.fraMm, a.tilMm_]);
      for (const [bFra, bTil] of delOppMedUtsparinger(fra, til, kutt)) {
        // hakkene i ELEMENTETS egne mm: x fra venstre ende, y fra bunnen
        const hull = [];
        for (const a of notch) {
          const x0 = Math.max(bFra, a.fraMm) - bFra, x1 = Math.min(bTil, a.tilMm_) - bFra;
          const y0 = Math.max(rBunn, a.bunnMm) - rBunn, y1 = Math.min(rTopp, a.toppMm) - rBunn;
          if (x1 - x0 > 10 && y1 - y0 > 10) hull.push({ x0, x1, y0, y1 });
        }
        const lengdeMm = Math.round(bTil - bFra);
        ut.push({
          fraMm: Math.round(bFra), tilMm_: Math.round(bTil),
          lengdeMm, fullMm: Math.round(full),
          radIdx: r, rBunnMm: rBunn, radHMm: rd[r], hoydeMm: rd[r],
          // radens åpninger følger elementet, så hakkene kan regnes på nytt
          // etter et drag — samme felt som del A bruker
          apn: radApninger.map(a => ({ fraMm: a.fraMm, tilMm_: a.tilMm_,
            bunnMm: a.bunnMm, toppMm: a.toppMm })),
          hull: hull.length ? hull : undefined,
          tilpassetRad: r === kappIndex,
          // Kapp = FAKTISK skåret i LENGDEN. Et hakk gjør det ikke — Moelv
          // beholder SW-06 3780MM med vindu i.
          tilpasset: r === kappIndex || lengdeMm < full - SW_TOL_MM
        });
      }
    }
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
  minSkraMm: SW_MIN_SKRA_MM,    // 0 = kilen går helt ut til taket
  minSkra0: true,               // migreringsmerke, se migrerOppsett()
  // 🏔 SALTAK-KNAPPEN (Emil 08.09). Veggtoppen følger taket bare når den står
  // PÅ. Standard AV, og det er ikke forsiktighet — det er riktigst for de
  // fleste stålbygg: en gavl med FAGVERK har takstolen liggende i gavlplanet,
  // og da leser taklinja overkanten av fagverket og skråner veggen, mens
  // veggen på Hegdalringen faktisk går rett opp til gesims. Er den av, bygges
  // veggen flat til høyeste søyletopp, nøyaktig som før runde 20.
  folgTak: false,
  kappUnderMm: 0,               // 0 = lengde alene gjør ikke noe til kapp
  // Navnet på kappbitene SKRIVES FRITT (Emil 03.09) — alltid med «SW-» foran.
  // «XX» gir SW-XX (Moelv), «18*» gir SW-18*, og «*» alene gir forelderens
  // nummer med stjerne (Lørenskog). Den gamle nøkkelen kappStil migreres.
  kappTekst: "XX",
  visUtsp: true,                // stiplet kryss + mål på utsparingene
  farge: "#dfe5ec", isolasjon: "PIR", utvFarge: "RAL 1015", innFarge: "9010",
  prosjekt: "", oppdragsnr: "", sted: "", sign: "",
  // 📐 «Utfyll PDF»: rutene i Storm-tittelfeltet på instruksjonstegninga.
  // Tomme her betyr «hentes fra Til lista-feltene over» (pdfProsjekt,
  // pdfUndertittel, pdfOppdrag, pdfTegnet) eller «står tom på papiret»
  // (pdfKontroll, pdfGodkjent) — aldri en oppdiktet verdi.
  pdfFase: "Utførelsesfase", pdfTittel: "", pdfNr: "SW-01",
  pdfProsjekt: "", pdfUndertittel: "", pdfOppdrag: "",
  pdfTegnet: "", pdfKontroll: "", pdfGodkjent: "", pdfDato: "",
  pdfMerknad: "",
  // Logoen huskes på FILNAVN, ikke itemId: SharePoint gir samme fil ny itemId
  // hvis den lastes opp på nytt, og da ville valget stille falt bort.
  pdfLogo: "",
  utsparinger: []   // [{navn, min:[x,y,z], max:[x,y,z]}] fra valgte elementer
};

// 🔧 MIGRERINGENE AV ET LAGRET OPPSETT — som REN funksjon, så de kan prøves
// med ekte gamle oppsett i stedet for å leses med øynene.
//
// TO GANGER PÅ RAD har en migrering her vært feil uten at noe sa fra:
//  · runde 20e la sjekken ETTER fletten med STD_OPPSETT, og da hadde merket
//    alt kommet inn — `=== undefined` var aldri sann.
//  · runde 20e retta det, men da var skaden gjort: den buggede versjonen hadde
//    alt STEMPLET oppsettet som ferdig migrert, med 300 fortsatt inni. Den
//    retta migreringen så stempelet og hoppet over (Emil 08.09: «ingen av
//    feilene har blitt fikset»).
//
// Lærdommen står i koden nå: et migreringsmerke som har vært satt av en
// bugget migrering er BRENT. Det kan ikke stoles på igjen — migreringen må få
// et nytt merkenavn, og det gamle ryddes bort.
//
// `raatt` er objektet slik det ligger i localStorage. Ut kommer det ferdig
// flettede oppsettet.
export function migrerOppsett(raatt, std) {
  const r = raatt || {};
  const o = { ...(std || {}), ...r };
  // Et oppsett fra før kappnavnet ble fritt har `kappStil` i stedet. Uten
  // dette ville Lørenskog-valget stille falt tilbake til SW-XX.
  if (r.kappStil !== undefined) {
    o.kappTekst = r.kappStil === "stjerne" ? "*" : "XX";
    delete o.kappStil;
  }
  // 🏔 Runde 20b satte 300 mm som tynneste ende på skråkapp. Det var VÅRT valg,
  // ikke Emils, og det ga et hull mellom veggkanten og takflaten. Verdien
  // ligger lagret PER FIL og overstyrer standarden på 0.
  //
  // Merket heter `minSkra0` og IKKE `minSkraNullet`: det gamle navnet ble satt
  // av den buggede migreringen på oppsett som aldri ble nullet. Det ryddes bort
  // her, så ingen framtidig migrering tror det betyr noe.
  if (r.minSkra0 === undefined && r.minSkraMm === 300) o.minSkraMm = 0;
  o.minSkra0 = true;
  delete o.minSkraNullet;
  return o;
}

function oppsett() {
  if (!lagret) lagret = lesLagret() || { oppsett: { ...STD_OPPSETT }, vegger: [], gulv: null, ringmur: null, materiellIder: [] };
  // Migreringene leser det RÅ lagrede oppsettet og fletter inn standardene.
  // Et oppsett lagret av en ELDRE versjon mangler de nye nøklene (radHoyder,
  // klaringMm, minFeltMm …); uten fletten blir de undefined og genereringen
  // regner med NaN.
  lagret.oppsett = migrerOppsett(lagret.oppsett, STD_OPPSETT);
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
    if (innerMark && (o === innerMark.merker || o === innerMark.forh)) return;
    o.traverse(m => {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    swGroup.remove(o);
  });
}

// ---------- 💾 Lagrede SW-resultater ----------
// Emil 03.09: samme tanke som «Lagrede grupper» i Bygginfo — du gir resultatet
// et navn, og kan hente det tilbake senere. Det som lagres er TALLENE
// (oppsett, vegger, gulv, ringmur, fasader), ikke 3D-objektene: stablene og
// tegninga bygges opp igjen av byggStabler()/tegnAlt() ved innlasting, akkurat
// som når en fil åpnes på nytt. Lagringen er per modellfil, som resten av
// SW-dataene.
function lagredeNokkel() { return "storm-ifc-sw-lagrede::" + S.fileName; }

function lesLagrede() {
  try {
    const l = JSON.parse(localStorage.getItem(lagredeNokkel()) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (_) { return []; }
}

function skrivLagrede(liste) {
  try { localStorage.setItem(lagredeNokkel(), JSON.stringify(liste)); return true; }
  catch (_) { return false; }   // full localStorage — sier fra i stedet for å svelge det
}

// Øyeblikksbildet. Materiell-id-ene tas MED VILJE ikke med: de peker på
// stabler som ikke finnes lenger når resultatet lastes inn igjen, og
// byggStabler() lager nye.
function swOyeblikksbilde() {
  if (!lagret) return null;
  const b = JSON.parse(JSON.stringify({
    oppsett: lagret.oppsett || STD_OPPSETT,
    vegger: lagret.vegger || [],
    gulv: lagret.gulv || null,
    ringmur: lagret.ringmur || [],
    fasader: lagret.fasader || [],
    okBetong: lagret.okBetong || 0,
    baseY: lagret.baseY,
    skjul: lagret.skjul || {}
  }));
  return b;
}

function lagreResultat(navn) {
  const rent = String(navn || "").trim().slice(0, 60);
  if (!rent) { alert(t("Gi resultatet et navn før du lagrer det.")); return; }
  if (!lagret || !(lagret.vegger || []).length) {
    alert(t("Generer veggelementene først.")); return;
  }
  const liste = lesLagrede();
  const fra_for = liste.findIndex(p => p.navn === rent);
  if (fra_for >= 0 && !confirm(t("«{0}» finnes allerede. Skal den skrives over?", rent))) return;
  const post = { navn: rent, dato: new Date().toISOString().slice(0, 10),
    antall: (lagret.vegger || []).filter(v => !v.skjult).length,
    data: swOyeblikksbilde() };
  if (fra_for >= 0) liste[fra_for] = post; else liste.push(post);
  if (!skrivLagrede(liste)) {
    alert(t("Klarte ikke å lagre — nettleserens lagring er full. Slett et gammelt resultat og prøv igjen."));
    return;
  }
  tegnPanel();
}

function lastInnResultat(navn) {
  const post = lesLagrede().find(p => p.navn === navn);
  if (!post || !post.data) return;
  fjernGenerertMateriell();
  lagret = JSON.parse(JSON.stringify(post.data));
  lagret.materiellIder = [];
  oppsett();                 // migrerer et oppsett lagret av en eldre versjon
  loesAlleJusteringer();
  byggAlleStabler();
  skrivLagret();
  tegnAlt();
  tegnPanel();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
}

function slettResultat(navn) {
  if (!confirm(t("Slette «{0}»?", navn))) return;
  skrivLagrede(lesLagrede().filter(p => p.navn !== navn));
  tegnPanel();
}

// ---------- 👁 «SW-generator» i 🎨 Utseende ----------
// Emil 03.09: alt SW-generatoren har satt PÅ BYGGET skal kunne skjules —
// uavhengig av bunkene med veggelementer rundt bygget, som ligger i
// 📦 Materiell og har sine egne rader der. Skjulingen er en VISNINGStilstand
// og lagres i `lagret.skjul`, altså per fil, sammen med resten av SW-dataene.
const SKJUL_DELER = [
  { n: "vegger", navn: "Veggelementer" },
  { n: "gulv", navn: "Gulv og isolasjon" },
  { n: "ringmur", navn: "Ringmur" },
  { n: "merking", navn: "Merking og mål" }
];

function skjulNaa() {
  if (!lagret) return {};
  if (!lagret.skjul) lagret.skjul = {};
  return lagret.skjul;
}

function settSkjul(navn, verdi) {
  if (!lagret) return;
  const sk = skjulNaa();
  if (navn === "alt") for (const d of SKJUL_DELER) sk[d.n] = verdi;
  sk[navn] = verdi;
  if (navn !== "alt" && !verdi) sk.alt = false;
  if (navn !== "alt") sk.alt = SKJUL_DELER.every(d => sk[d.n]);
  skrivLagret();
  tegnAlt();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
}

// Én rad-tegner for begge blokkene: `sk` er tilstanden, `attr` sier hvilken
// knapp som skal svare. To kopier ville drevet fra hverandre.
function swSkjulRad(sk, attr, navn, tekst, ekstra) {
  return '<div class="qty-row"><div class="n">' + esc(t(tekst)) +
    (ekstra ? ' <span style="color:var(--muted);font-size:11px">(' + ekstra + ')</span>' : "") +
    '</div><div class="c"><button ' + attr + '="' + navn + '" title="' + t("Skjul/vis") +
    '" style="padding:3px 8px">' + ikon(sk[navn] ? "skjul" : "vis") + '</button></div></div>';
}

S.swUtseendeRader = (body) => {
  if (!body) return;
  const antV = ((lagret && lagret.vegger) || []).length;
  const harYtre = !!(lagret && (antV || lagret.gulv || (lagret.ringmur || []).length));
  const d = lagretInner;
  const antI = ((d && d.vegger) || []).length;
  if (!harYtre && !antI) return;
  const boks = document.createElement("div");
  let html = "";
  if (harYtre) {
    const sk = skjulNaa();
    html +=
      '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">' +
        t("SW-generator") + '</div><div class="c"></div></div>' +
      swSkjulRad(sk, "data-sw-skjul", "alt", "Alt på bygget") +
      swSkjulRad(sk, "data-sw-skjul", "vegger", "Veggelementer", antV || "") +
      (lagret.gulv ? swSkjulRad(sk, "data-sw-skjul", "gulv", "Gulv og isolasjon") : "") +
      ((lagret.ringmur || []).length
        ? swSkjulRad(sk, "data-sw-skjul", "ringmur", "Ringmur", (lagret.ringmur || []).length) : "") +
      swSkjulRad(sk, "data-sw-skjul", "merking", "Merking og mål") +
      '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
        t("Bunkene med veggelementer rundt bygget ligger i 📦 Materiell og skjules i sine egne rader over.") + '</p>';
  }
  // 🚪 EGEN BLOKK FOR INNERVEGGENE (Emil 08.09). Egen tilstand også: slår han
  // av ytterveggene for å se inn i bygget, skal innerveggene bli stående.
  if (antI) {
    const skI = innerSkjulNaa();
    html +=
      '<div class="qty-row" style="margin-top:10px"><div class="n" style="font-weight:700">🚪 ' +
        t("SW-generator: innervegger") + '</div><div class="c"></div></div>' +
      swSkjulRad(skI, "data-sw-iskjul", "alt", "Alt på bygget") +
      swSkjulRad(skI, "data-sw-iskjul", "vegger", "Veggelementer", antI) +
      ((d.ringmur || []).length
        ? swSkjulRad(skI, "data-sw-iskjul", "ringmur", "Ringmur", (d.ringmur || []).length) : "") +
      swSkjulRad(skI, "data-sw-iskjul", "merking", "Merking og mål");
  }
  boks.innerHTML = html;
  body.appendChild(boks);
  boks.querySelectorAll("button[data-sw-skjul]").forEach(b =>
    b.onclick = () => settSkjul(b.dataset.swSkjul, !skjulNaa()[b.dataset.swSkjul]));
  boks.querySelectorAll("button[data-sw-iskjul]").forEach(b =>
    b.onclick = () => settInnerSkjul(b.dataset.swIskjul, !innerSkjulNaa()[b.dataset.swIskjul]));
};

function boks(farge, opacity) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
  return m;
}

// 🧱 RINGMURBITENE, tegnet fra tallene. Trukket ut av tegnAlt i runde 21 så
// innerveggene kan bruke NØYAKTIG samme tegning — en egen kopi ville drevet fra
// denne første gang noe ble rettet i den ene.
function tegnRingmurBiter(biter, visMerking) {
  const visRmLapper = (biter || []).length <= 400 && !!visMerking;
  for (const r of biter || []) {
    if (r.skjult || (r.lengdeMm !== undefined && !(r.lengdeMm > 0))) continue;
    const m = boks("#8a8f98", 1);
    m.scale.set(r.lengde, r.hoyde, r.tykkelse);
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.rot;
    if (r.id !== undefined) m.userData.swId = r.id;
    swGroup.add(m);
    if (visRmLapper && r.id !== undefined && r.lengdeMm !== undefined) {
      const nx = r.nx !== undefined ? r.nx : Math.sin(r.rot);
      const nz = r.nz !== undefined ? r.nz : Math.cos(r.rot);
      const nv = new THREE.Vector3(nx, 0, nz).normalize();
      const utD = (r.tykkelse || tilScene(r.tMm || 200)) / 2 + 0.01 / (S.enhetSkala || 1);
      const dim = tekstDekal(r.lengdeMm + "\u00d7" + (r.hoydeMm || 0) + "MM", 150,
        (r.lengde || 1) * 0.7);
      dim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
      dim.position.set(r.x + nv.x * utD, r.y, r.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
}

// 🧱 VEGGELEMENTENE, tegnet fra tallene. Også trukket ut i runde 21: del A
// sender inn sine vegger og sitt oppsett, del B sine. Ingenting her vet hvilken
// av dem det er.
function tegnVeggElementer(vegger, o, visMerking) {
  // Elementene tegnes som EKTE SANDWICHPANELER — samme oppskrift som
  // materiell-modellen Emil pekte på (runde 3): lys isolasjonskjerne synlig i
  // endene, og et tynt blikk med mikroprofil i elementfargen på begge sider.
  // Panelet bygges liggende (samme akser som materiell) og reises opp 90°.
  const farge = o.farge || "#dfe5ec";
  const fargeMat = new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide });
  const kjerneMat = new THREE.MeshLambertMaterial({ color: "#e8e4da", side: THREE.DoubleSide });
  const mal = MALTYPER.sandwich;
  const antV = (vegger || []).length;
  const visLapper = antV <= SW_MAKS_LAPPER && !!visMerking;
  if (antV > SW_MAKS_LAPPER && visMerking)
    console.warn("SW: " + antV + " veggelement er over grensa på " + SW_MAKS_LAPPER
      + " — SW-nummer og mål tegnes ikke i 3D. Lista og PDF-en er uendret.");
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
  // 🏔 SKRÅKAPPET PANEL. Bygges som et EKTE sandwichpanel, ikke som en grå
  // kasse (Emil 08.09): isolasjonskjerne som synes i endene og langs
  // skråkuttet, og bølgeblikk i elementfargen på begge sider — samme
  // oppskrift som byggPanel, bare med et trapes i stedet for et rektangel.
  //
  // Bygges i SIN EGEN retning (x = lengde, y = høyde, z = tykkelse), ikke
  // liggende og reist opp som byggPanel: en ExtrudeGeometry ekstruderer i z,
  // og liggende ville kjernen blitt presset ut langs høyden i stedet for
  // gjennom tykkelsen.
  const byggSkraPanel = (lengdeMm, toppPMm, tMm, radHMm, hull) => {
    const inner = new THREE.Group();
    const L = mmTilScene(lengdeMm), T = mmTilScene(tMm);
    const hMaks = Math.max(...toppPMm.map(q => q[1]));
    const y0 = -mmTilScene(hMaks) / 2;
    const inn = mmTilScene(2);                       // kjernen trekkes 2 mm inn
    // Kjernen: elementets faktiske form — bunnkant, høyre kant, overkanten
    // baklengs — med hakkene som hull i formen.
    const form = new THREE.Shape();
    form.moveTo(-L / 2 + inn, y0 + inn);
    form.lineTo(L / 2 - inn, y0 + inn);
    for (let i = toppPMm.length - 1; i >= 0; i--) {
      const [x, y] = toppPMm[i];
      // Overkanten kan gå helt ned til null der elementet ender i en spiss mot
      // raftet. Trakk vi da 2 mm av som overalt ellers, havnet toppunktet UNDER
      // bunnkanten, formen ble selvskjærende, og panelet vrengte seg i 3D
      // (Emil 08.09, da han dro et element ut mot kanten). Overkanten holdes
      // derfor alltid minst et hårstrå over bunnen.
      form.lineTo(-L / 2 + mmTilScene(x) + (i === toppPMm.length - 1 ? -inn : (i === 0 ? inn : 0)),
                  Math.max(y0 + inn * 2, y0 + mmTilScene(y) - inn));
    }
    form.closePath();
    for (const h of (hull || [])) {
      const bane = new THREE.Path();
      const a0 = -L / 2 + mmTilScene(h.x0), a1 = -L / 2 + mmTilScene(h.x1);
      const b0 = y0 + mmTilScene(h.y0), b1 = y0 + mmTilScene(h.y1);
      bane.moveTo(a0, b0); bane.lineTo(a1, b0); bane.lineTo(a1, b1); bane.lineTo(a0, b1);
      bane.closePath();
      form.holes.push(bane);
    }
    const dyp = Math.max(T - mmTilScene(8), mmTilScene(10));
    const kjerneGeo = new THREE.ExtrudeGeometry(form, { depth: dyp, bevelEnabled: false });
    kjerneGeo.translate(0, 0, -dyp / 2);
    inner.add(new THREE.Mesh(kjerneGeo, kjerneMat));
    // Blikket: samme mikroprofil som på et rett panel, klippet mot overkanten.
    const profS = trpProfil(radHMm || hMaks, mal.deling, mal.profilHoyde)
      .map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    const toppS = toppPMm.map(([x, y]) => [mmTilScene(x), mmTilScene(y)]);
    const hullS = (hull || []).map(h => ({
      x0: mmTilScene(h.x0), x1: mmTilScene(h.x1),
      y0: mmTilScene(h.y0), y1: mmTilScene(h.y1) }));
    const pos = ribbonSkraPos(profS, L, toppS, hullS);
    if (pos.length) {
      const ph = mmTilScene(mal.profilHoyde);
      const lag = (utover) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, fargeMat);
        m.scale.z = utover ? 1 : -1;
        m.position.z = utover ? T / 2 - ph : -T / 2 + ph;
        return m;
      };
      inner.add(lag(true), lag(false));
    }
    return inner;
  };
  for (const v of vegger || []) {
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
    if (v.skra) {
      // Skråkappet element: ett trapes med bølge og kjerne, åpningene som hull.
      el.add(byggSkraPanel(v.lengdeMm,
        v.toppP || [[0, v.hVMm], [v.lengdeMm, v.hHMm]], v.tMm, v.radHMm, hull));
    } else {
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
      // Skråkapp merkes med BEGGE endehøydene OG VINKELEN —
      // «5980×1100/460MM 6,1°» — for det er de tre målene verkstedet trenger
      // for å skjære panelet (Emil 08.09).
      const hTekst = v.skra ? v.hVMm + "/" + v.hHMm : String(v.hoydeMm);
      const vTekst = v.skra
        ? " " + (v.skraTekst || vinkelTekst(skraVinkel(v.lengdeMm, v.hVMm, v.hHMm))) : "";
      const dim = tekstDekal(v.lengdeMm + "×" + hTekst + "MM" + vTekst, 150, L * 0.6);
      dim.quaternion.copy(sw.quaternion);
      dim.position.set(v.x + nv.x * utD, v.y - H * 0.1, v.z + nv.z * utD);
      swGroup.add(dim);
    }
  }
}

// Tegner alt fra de lagrede tallene. Vegger: {x,y,z,rot,lengdeMm,hoydeMm,tMm,sw,tilpasset}
function tegnAlt() {
  ryddTegning();
  tegnDelA();
  // 🚪 Innerveggene tegnes ETTER ytterveggene, fra sin EGEN lagring. Egen
  // try/catch med vilje: en feil i del B skal ikke la bygget stå uten
  // yttervegger.
  try { tegnInnervegger(); }
  catch (err) { console.warn("Innerveggene kunne ikke tegnes:", err); }
}

function tegnDelA() {
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  const sk = lagret.skjul || {};
  if (lagret.gulv && !sk.gulv) {
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
  // 🧱 RINGMUREN: samme dra-funksjon som veggelementene (Emil 03.09).
  // Hver bit får swId, så «Juster elementer» plukker den opp uendret, og en
  // dimensjonslapp i midten slik elementene har.
  tegnRingmurBiter(sk.ringmur ? [] : lagret.ringmur || [], !sk.merking);
  if (!sk.vegger) tegnVeggElementer(lagret.vegger || [], o, !sk.merking);
  if (!sk.merking) {
    try { tegnUtspMerking(); }
    catch (err) { console.warn("Utsparingsmerkingen kunne ikke tegnes:", err); }
  }
}

// ---------- 📐 Utsparingsmerking: stiplet kryss + mål ----------
// Som på Moelv-tegningen (Emil 02.09): åpningen får en stiplet ramme med
// kryss, ett mål for HELE åpningen (bredde × høyde), og for hvert element som
// går gjennom området et lite mål på HVOR DYPT det må kappes inn.
// Skrus av og på med «Vis utsparingsmål» i panelet.
// SW-basen (topp ringmur). Mangler den i lagringen — vegger generert av en
// eldre versjon — regnes den ut av et element: y er radens midte.
function baseYNaa() {
  if (lagret && lagret.baseY !== undefined) return lagret.baseY;
  for (const v of (lagret && lagret.vegger) || [])
    if (v.rBunnMm !== undefined && v.hoydeMm) return v.y - tilScene(v.rBunnMm + v.hoydeMm / 2);
  return 0;
}

// Åpningene projisert på fasadene, REGNET UT VED TEGNING. Tidligere ble dette
// bare lagret ved generering (lagret.utspVis), og da viste merkingen
// ingenting på vegger som alt lå i localStorage fra en tidligere generering —
// som er den vanlige situasjonen, siden veggene tegnes opp igjen når modellen
// åpnes (Emils funn 02.09). Nå følger merkingen også med når en utsparing
// legges til eller slettes i panelet, uten å generere på nytt.
function utspPaFasader() {
  if (!lagret) return [];
  const o = lagret.oppsett || STD_OPPSETT;
  const fasader = lagret.fasader || [];
  const liste = (o.utsparinger || []).filter(u => u && u.min && u.max);
  if (!fasader.length || !liste.length) return lagret.utspVis || [];
  const bY = baseYNaa();
  const ut = [];
  for (const u of liste) {
    let bi = -1, best = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      // Samme regel som innerveggene bruker — én funksjon, ett svar.
      const avst = apningPaVegg(fasader[fi], u, APN_SLARK / (S.enhetSkala || 1));
      if (avst === null) continue;
      if (avst < best) { best = avst; bi = fi; }
    }
    if (bi < 0) continue;
    const f = fasader[bi];
    const ts = [];
    for (const px of [u.min[0], u.max[0]]) for (const pz of [u.min[2], u.max[2]])
      ts.push((px - f.px) * f.ex + (pz - f.pz) * f.ez);
    ut.push({ fi: bi, fraMm: tilMm(Math.min(...ts)), tilMm_: tilMm(Math.max(...ts)),
              bunnMm: tilMm(u.min[1] - bY), toppMm: tilMm(u.max[1] - bY) });
  }
  return ut.length ? ut : (lagret.utspVis || []);
}

function tegnUtspMerking() {
  if (!lagret) return;
  const o0 = lagret.oppsett || STD_OPPSETT;
  if (o0.visUtsp === false) return;
  tegnUtspMerkingFor(utspPaFasader(), lagret.fasader || [], lagret.vegger || [],
    baseYNaa(), o0.tykkelseMm);
}

// Samme merking for yttervegger og innervegger. Tykkelsen tas fra fasadens
// EGET oppsett når det finnes (innerveggene har hver sin), ellers fra tallet
// som sendes inn.
function tegnUtspMerkingFor(apninger, fasader, vegger, baseY, tykkelseMm) {
  if (!apninger.length) return;
  // Merkingen skal SKJULES BAK OBJEKT, som SW-lappene og målene på veggene
  // (Emil 02.09). Derfor vanlig dybdetest og ingen renderOrder — det var
  // depthTest:false som lot krysset på baksiden skinne gjennom fasaden.
  const strekMat = new THREE.LineDashedMaterial({
    color: 0x11161d, dashSize: 0.12 / (S.enhetSkala || 1),
    gapSize: 0.08 / (S.enhetSkala || 1) });
  for (const a of apninger) {
    const f = fasader[a.fi];
    if (!f) continue;
    const tMm = ((f.o || {}).tykkelseMm !== undefined) ? f.o.tykkelseMm : tykkelseMm;
    // veggplanet, litt utenfor panelet så streken ikke drukner i det
    const utD = f.off + tilScene(tMm) / 2 + 0.03 / (S.enhetSkala || 1);
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
    tot.raycast = () => {};
    swGroup.add(tot);
    // KAPPDYBDEN per element som går gjennom området
    for (const v of vegger || []) {
      if (v.skjult || v.fi !== a.fi || v.fraMm === undefined) continue;
      const x0 = Math.max(v.fraMm, a.fraMm), x1 = Math.min(v.tilMm, a.tilMm_);
      if (x1 - x0 <= 10) continue;
      const b0 = Math.max(v.rBunnMm, a.bunnMm), b1 = Math.min(v.rBunnMm + v.hoydeMm, a.toppMm);
      const dybde = Math.round(b1 - b0);
      if (dybde <= 10 || dybde >= v.hoydeMm - 10) continue;   // hel rad = ikke et kapp
      const lapp = tekstDekal("↕ " + dybde, 170, tilScene(Math.max(x1 - x0, 400)));
      lapp.quaternion.copy(tot.quaternion);
      lapp.position.copy(pkt((x0 + x1) / 2, baseY + tilScene((b0 + b1) / 2)));
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
S.lastSW = () => {
  lagret = lesLagret();
  lagretInner = lesInner();    // 🚪 leses fra sin egen nøkkel, per fil
  loesAlleJusteringer();
  tegnAlt();
  // 🚪 ÉN GANGS OPPRYDDING (runde 24): innervegger bygget med den gamle,
  // romslige åpningsregelen kan ha fått en utsparing fra en vegg PÅ TVERS.
  // De bygges på nytt én gang per fil; merket hindrer at det gjentas.
  if (lagretInner && (lagretInner.serier || []).length
      && lagretInner.apnRegel !== APN_REGEL) {
    lagretInner.apnRegel = APN_REGEL;
    oppdaterInnerveggerEtterUtsp();
  }
};
S.ryddSW = () => { if (just) avsluttJuster(); lagret = null; ryddTegning(); };

// ---------- 🏔 Taklinja lest ut av stålet i fasadeplanet ----------
// takLinje() over er ren matematikk. Her hentes PUNKTENE den skal jobbe på:
// hver stålbit som står i fasadeplanet projiseres ned på fasadeaksen, og
// toppen av den følges.
//
// HVORFOR TREKANTENE OG IKKE BOKSENE: en takbjelke på et saltak er skrå, og
// den akse-justerte boksen rundt den er like høy som MØNET langs HELE spennet.
// Bygger vi taklinja på bokser, blir gavlen flat på mønehøyde — verre enn feilen
// vi prøver å fikse. Trekantpunktene gir den skrå overkanten slik den er.
//
// Punktene bøttes på 100 mm langs fasaden (høyeste punkt per bøtte) før de
// sendes til hylla. Uten bøtta ville en gavl med 40 000 trekanter gitt 120 000
// punkter til en sortering som bare trenger toppene.
const TAK_BOTTE_MM = 100;
const TAK_TOL_MM = 100;   // knekk lavere enn dette er støy, ikke møne

function taklinjerFraModell(fasader, tS) {
  const bokser = allElementBoxes();
  const naer = Math.max(0.8 / (S.enhetSkala || 1), tS * 3);
  // 1) hver stålbit til NÆRMESTE fasadeplan den ligger langs (samme regel som
  //    stalPaFasader — en bjelke i et hjørne er nær to plan)
  const tilFasade = new Map();
  for (const [id, b] of bokser) {
    if (STAL_TYPER.indexOf(soyleTypeNavn(id)) === -1) continue;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    let best = -1, bestD = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      const dd = Math.abs((cx - f.p.x) * f.nx + (cz - f.p.z) * f.nz);
      if (dd > naer || dd >= bestD) continue;
      const ts = [];
      for (const px of [b.min.x, b.max.x]) for (const pz of [b.min.z, b.max.z])
        ts.push((px - f.p.x) * f.ex + (pz - f.p.z) * f.ez);
      const t0 = f.soyler[0].t, t1 = f.soyler[f.soyler.length - 1].t;
      if (Math.max(...ts) < Math.min(t0, t1) - naer || Math.min(...ts) > Math.max(t0, t1) + naer) continue;
      best = fi; bestD = dd;
    }
    if (best >= 0) tilFasade.set(id, best);
  }
  if (!tilFasade.size) return fasader.map(() => []);
  // 2) trekantene til de bitene, projisert og bøttet
  const botte = tilScene(TAK_BOTTE_MM) || 0.1;
  const bytter = fasader.map(() => new Map());
  const se = (fi, t, y) => {
    const k = Math.round(t / botte);
    const m = bytter[fi];
    const e = m.get(k);
    if (!e || y > e[1]) m.set(k, [t, y]);
  };
  const v = new THREE.Vector3();
  // Punktene KLIPPES til fasadens egen utstrekning (pluss en meter til
  // hjørnelappen). Ellers drar en raftbjelke som løper videre inn i et tilbygg
  // taklinja med seg langt utenfor veggen, og hylla får et endepunkt som ikke
  // finnes på denne fasaden.
  const rand = 1 / (S.enhetSkala || 1);
  const gr = fasader.map(f => {
    const a2 = f.soyler[0].t, b2 = f.soyler[f.soyler.length - 1].t;
    return [Math.min(a2, b2) - rand, Math.max(a2, b2) + rand];
  });
  forHverTrekant(new Set(tilFasade.keys()), (pos, i0, i1, i2, mtx, id) => {
    const fi = tilFasade.get(id);
    if (fi === undefined) return;
    const f = fasader[fi];
    for (const i of [i0, i1, i2]) {
      v.fromBufferAttribute(pos, i);
      if (mtx) v.applyMatrix4(mtx);
      const tt = (v.x - f.p.x) * f.ex + (v.z - f.p.z) * f.ez;
      if (tt < gr[fi][0] || tt > gr[fi][1]) continue;
      se(fi, tt, v.y);
    }
  });
  // 3) hylla, i MM langs fasaden og MM i høyden over SW-basen — samme enhet
  //    som resten av elementregninga
  return bytter.map(m => [...m.values()]);
}

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
  // Randvandringen først — den takler innvendige hjørner (L, T, U, tilbygg).
  // Klarer den ikke å lukke konturen, er bygget ikke rettvinklet, og vi faller
  // tilbake på det konvekse hullet som før.
  const fasader = fasaderLangsRand(soyler, kolTol, 15 / (S.enhetSkala || 1))
    || fasaderFra(soyler, kolTol);
  if (!fasader.length) { alert(t("Fant ingen fasader å sette veggelementer på.")); return; }

  const okBetong = Math.min(...soyler.map(s => s.minY));   // OK betong = bunn av søylene
  // Gavlsøyler uten forlenger skal likevel dele veggen (Sundland 04.09).
  for (const f of fasader) {
    f.soyler = fasadeSoyler(f, alleSoyler, kolTol, okBetong, SW_VEGGANDEL);
    f.toppY = Math.max(...f.soyler.map(k => k.s.maxY));
  }
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;                           // SW starter på gulv eller ringmur
  const tS = tilScene(o.tykkelseMm);

  // 🏔 TAKLINJA PER FASADE (runde 20). Punktene leses av stålet i fasadeplanet
  // og gjøres om til MM langs fasaden og MM over SW-basen — samme enheter som
  // resten av elementregninga. Er linja flat, brukes fasadens søyletopp som før.
  // Står saltak-knappen av, spørres modellen ikke i det hele tatt: en runde
  // gjennom alle ståltrekantene koster, og svaret ville uansett blitt kastet.
  const takP = o.folgTak ? taklinjerFraModell(fasader, tS) : [];
  const takLinjer = fasader.map((f, i) => takLinje(
    (takP[i] || []).map(([tt, y]) => [tilMm(tt), tilMm(y - baseY)]), TAK_TOL_MM));

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
    let besteFi = -1, besteAvst = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      // UTSPARINGEN HØRER BARE TIL VEGGEN DEN ER LAGET I (Emil 02.09). Regelen
      // bor i apningPaVegg og er den SAMME for yttervegger og innervegger —
      // to kopier ville før eller siden svart forskjellig.
      const avst = apningPaVegg(
        { px: f.p.x, pz: f.p.z, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
          t0: f.soyler[0].t, t1: f.soyler[f.soyler.length - 1].t },
        u, APN_SLARK / (S.enhetSkala || 1));
      if (avst === null) continue;
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
    const spennS = spennSoyler(f.soyler, okBetong, SW_SPENNANDEL, kolTol);
    // Tette forlengere (hjørne- og avstivningssøyler i par) gir ÉN skjøt, ikke
    // to skjøter og en 660 mm strimmel mellom seg (Emil 02.09).
    const skjot = samleTetteSoyler(spennS.map(k => tilMm(k.t)), o.minFeltMm);
    // 📐 SKJØTEPUNKTENE LAGRES. Instruksjonstegninga trenger dem til
    // aksesirklene og målkjeden, og har fram til nå regnet dem BAKLENGS ut av
    // elementgrensene. Det gikk galt i hjørnene, der pinwheel-lappen er
    // usymmetrisk (−off+t/2 i starten, +off+t/2 i slutten): aksene havnet
    // 200 mm feil i den ene enden (Emil 03.09). Ett tall lagret her fjerner
    // hele klassen av feil.
    fasadeInfo[fi].skjot = skjot.map(v => Math.round(v));
    // Holdepunktene håndjusteringen snapper til: klaringen fra hvert
    // søylesenter, og søylekantene (Emils ønske 02.09).
    const snappP = [];
    for (const k of f.soyler) {
      const c = tilMm(k.t), halv = tilMm(k.s.bredde) / 2;
      snappP.push(c - o.klaringMm, c + o.klaringMm, c - halv, c + halv);
    }
    const t0 = tilScene(skjot[0]), t1 = tilScene(skjot[skjot.length - 1]);
    // 🏔 VEGGTOPPEN. Flatt tak: fasadens høyeste søyletopp, akkurat som før.
    // Skrått tak: radstabelen reises til taklinjas HØYESTE punkt, og hver rad
    // kappes ned mot linja i takSpenn under. Uten det høyeste punktet ville
    // mønet stått uten rader å kappe.
    const linje = takLinjer[fi] || [];
    const flatt = !o.folgTak || linje.length < 2 || flatTak(linje, TAK_TOL_MM);
    const toppMm = flatt ? tilMm(f.toppY - baseY)
      : Math.max(tilMm(f.toppY - baseY), ...linje.map(q => q[1]));
    fasadeInfo[fi].takLinje = flatt ? null : linje.map(q => [Math.round(q[0]), Math.round(q[1])]);
    const { rader: alleRader, kappIndex } = radStabel(toppMm, o.radHoyder, o.kappNederst);
    const apninger = utsparingerPaFasade(f, baseY, utspPerFasade.get(fi) || []);
    // HJØRNENE gjøres som på Moelv-tegningen: hver fasade LØPER FORBI hjørnet
    // i sin sluttende (dekker naboveggens endeflate, helt ut til ytterhjørnet),
    // og starter FLUKT mot innsiden av forrige fasades vegg. Rundt bygget gir
    // det pinwheel-hjørner — ett element stikker forbi i hvert hjørne, aldri to.
    const offMm = tilMm(off);
    // Fortegnet leses av NABOENS utover-normal: peker den samme vei som denne
    // fasaden løper, er hjørnet utvendig og elementet skal forbi (+off); peker
    // den motsatt, er hjørnet INNVENDIG (L-bygg) og elementet skal tilsvarende
    // kortere (−off). Uten dette dyttet hjørnelappen veggen ut i lufta i hvert
    // innvendig hjørne (Emils lagerbygg 04.09). På et rektangel er begge +1,
    // så vaskehallen og alle konvekse bygg får nøyaktig samme mål som før.
    const sStart = f.forrigeN ? -Math.sign(f.forrigeN.x * f.ex + f.forrigeN.z * f.ez) || 1 : 1;
    const sSlutt = f.nesteN ? Math.sign(f.nesteN.x * f.ex + f.nesteN.z * f.ez) || 1 : 1;
    const hjFraMm = tilMm(t0) - sStart * offMm + o.tykkelseMm / 2;   // start: mot naboens innside
    const hjTilMm = tilMm(t1) + sSlutt * offMm + o.tykkelseMm / 2;   // slutt: forbi, til ytterhjørnet
    if (o.ringmur) {
      // RINGMUREN BEHANDLES SOM EN RAD (Emil 02.09): den kappes rundt en
      // utsparing på nøyaktig samme måte som veggelementene, og får en
      // fyllbit under åpningen når åpningen ikke går helt ned til gulvets
      // underkant. Før sto ringmuren igjen i døråpningen.
      // Båndet i mm regnet fra SW-basen (topp ringmur = 0):
      const rmTopp = 0;
      const rmBunn = -(tilMm(ringH) + o.betongMm + o.isoMm);
      // ✥ RINGMURBITENE ER JUSTERBARE ELEMENTER, som veggene (Emil 03.09).
      // De får samme felter «Juster elementer» krever: stabil id, fasadebasis,
      // basis-utstrekning og to forskyvninger. Alt annet (x, z, lengde) er
      // avledet og regnes om i loesAlleJusteringer — nøyaktig som for veggene.
      const rmBit = (bunnMm, hoydeMm, fraMm, tilMm2) => {
        const pR = midt(tilScene((fraMm + tilMm2) / 2), 0);
        ringmur.push({
          id: "r" + ringmur.length, fi, ringmur: true, radIdx: "rm",
          fx, fz, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
          basFraMm: Math.round(fraMm), basTilMm: Math.round(tilMm2), dFra: 0, dTil: 0, rev: 0,
          fraMm: Math.round(fraMm), tilMm: Math.round(tilMm2),
          lengdeMm: Math.round(tilMm2 - fraMm), fullMm: Math.round(tilMm2 - fraMm),
          bunnMm: Math.round(bunnMm), hoydeMm: Math.round(hoydeMm), tMm: o.tykkelseMm,
          snapp: snappP,
          x: pR.x, z: pR.z,
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
        // 🏔 Taket kapper raden FØR utsparingene deler den. På flatt tak gir
        // takSpenn nøyaktig [{fra: sFra, til: sTil}], og alt under er ord for
        // ord som før runde 20.
        const spenn = flatt ? [{ fra: sFra, til: sTil }]
          : takSpenn(linje, sFra, sTil, rBunn, rTopp, kl, SW_MIN_BIT_MM, o.minSkraMm);
        for (const sp of spenn) {
        // Feltlengden et element måles mot: på et skrått tak er det bitens
        // eget spenn, ellers ville hver møne- og raftbit blitt stemplet kapp
        // i lengden når den bare er kappet i høyden.
        const feltMm = flatt ? fullMm : sp.til - sp.fra;
        for (const [bFra, bTil] of delOppMedUtsparinger(sp.fra, sp.til, kutt)) {
          const lengdeMm = bTil - bFra;
          // 🏔 OVERKANTEN: taket skjærer i elementet, som en utsparing gjør.
          // toppP er polylinja langs overkanten i elementets egne mm.
          const toppP = flatt ? null : takTopp(linje, bFra, bTil, rBunn, rTopp);
          const hV = flatt ? radH : toppP[0][1];
          const hH = flatt ? radH : toppP[toppP.length - 1][1];
          const skra = !flatt && toppErSkra(toppP, radH);
          const hMaks = flatt ? radH : Math.max(...toppP.map(q => q[1]));
          if (hMaks < 20) continue;
          const tMid = tilScene((bFra + bTil) / 2);
          const p = midt(tMid, baseY + tilScene(rBunn + hMaks / 2));
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
            lengdeMm: Math.round(lengdeMm), hoydeMm: hMaks, tMm: o.tykkelseMm,
            // radHMm er RADENS fulle høyde; hVMm/hHMm er elementets høyde i
            // venstre og høyre ende. På flatt tak er alle tre like.
            radHMm: radH, hVMm: hV, hHMm: hH, skra: skra || undefined,
            toppP: skra ? toppP : undefined,
            fullMm: Math.round(feltMm),
            hull: hull.length ? hull : undefined,
            // Kapp = FAKTISK skåret i LENGDEN: tilpasningsraden, eller en bit
            // som er kortere enn feltet fordi en port tok resten. Et hakk
            // gjør det IKKE — Moelv beholder SW-06 3780MM med vindu i.
            tilpassetRad,
            // Et SKRÅKAPPET element er alltid kapp — det er skåret, og to like
            // lange skrå biter fra hver sin ende av gavlen er ikke samme vare.
            tilpasset: tilpassetRad || skra || lengdeMm < feltMm - SW_TOL_MM ||
                       (o.kappUnderMm > 0 && lengdeMm < o.kappUnderMm)
          });
        }
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
    off: (fasadeInfo[i] || {}).off || 0, rot: (fasadeInfo[i] || {}).rot || 0,
    skjot: (fasadeInfo[i] || {}).skjot || null,
    // 🏔 Taklinja lagres i MM, så et element som DRAS kan lese av de nye
    // endehøydene sine uten at fasadene regnes ut av modellen på nytt.
    takLinje: (fasadeInfo[i] || {}).takLinje || null
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
  byggAlleStabler();
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

// 🧱 Ringmur laget FØR den ble justerbar (Emil 03.09) har bare {x,z,y,lengde,
// hoyde,tykkelse,rot}. Uten id er biten ikke plukkbar, og uten fasadebasis kan
// ikke draget regne mm. Her fylles feltene ut av det som finnes — fasaden
// kjennes igjen på RETNINGEN (samme regel som tegninga bruker), ikke på
// avstanden: i hjørnet er en bit alltid nærmere naboens plan enn sitt eget.
// Da slipper Emil å generere veggene på nytt for å kunne dra i muren.
function migrerRingmur() {
  if (!lagret || !lagret.ringmur || !lagret.ringmur.length) return;
  const fasader = lagret.fasader || [];
  const baseY = baseYNaa();
  lagret.ringmur.forEach((r, i) => {
    if (r.id === undefined || r.id === null) r.id = "r" + i;
    if (r.ringmur === undefined) r.ringmur = true;
    if (r.radIdx === undefined) r.radIdx = "rm";
    if (r.fi === undefined && fasader.length) {
      let best = -1, bestD = Infinity;
      for (let j = 0; j < fasader.length; j++) {
        const f = fasader[j];
        const fRot = isFinite(Number(f.rot)) ? Number(f.rot) : Math.atan2(-f.ez, f.ex);
        if (isFinite(Number(r.rot)) && Math.abs(vinkelDiffLokal(r.rot, fRot)) > 0.05) continue;
        const dd = Math.abs((r.x - f.px) * f.nx + (r.z - f.pz) * f.nz);
        if (dd < bestD) { bestD = dd; best = j; }
      }
      if (best >= 0) r.fi = best;
    }
    const f = fasader[r.fi];
    if (f && r.ex === undefined) { r.ex = f.ex; r.ez = f.ez; r.nx = f.nx; r.nz = f.nz; }
    if (r.ex === undefined) { r.ex = Math.cos(r.rot || 0); r.ez = -Math.sin(r.rot || 0); }
    if (r.nx === undefined) { r.nx = Math.sin(r.rot || 0); r.nz = Math.cos(r.rot || 0); }
    if (r.basFraMm === undefined) {
      // midtpunktet langs fasadeaksen — fra fasadens eget punkt når vi har det
      const midMm = f ? tilMm((r.x - f.px) * f.ex + (r.z - f.pz) * f.ez)
                      : tilMm(r.tMid || 0);
      const lMm = r.lengdeMm !== undefined ? r.lengdeMm : tilMm(r.lengde || 0);
      r.basFraMm = Math.round(midMm - lMm / 2);
      r.basTilMm = Math.round(midMm + lMm / 2);
    }
    if (r.fx === undefined) {
      const midMm = (r.basFraMm + r.basTilMm) / 2;
      r.fx = r.x - r.ex * tilScene(midMm);
      r.fz = r.z - r.ez * tilScene(midMm);
    }
    if (r.dFra === undefined) r.dFra = 0;
    if (r.dTil === undefined) r.dTil = 0;
    if (r.rev === undefined) r.rev = 0;
    if (r.fraMm === undefined) { r.fraMm = r.basFraMm; r.tilMm = r.basTilMm; }
    if (r.lengdeMm === undefined) r.lengdeMm = Math.round(r.tilMm - r.fraMm);
    if (r.fullMm === undefined) r.fullMm = r.lengdeMm;
    if (r.hoydeMm === undefined) r.hoydeMm = Math.round(tilMm(r.hoyde || 0));
    if (r.bunnMm === undefined) r.bunnMm = Math.round(tilMm(r.y - baseY) - r.hoydeMm / 2);
    if (r.tMm === undefined) r.tMm = Math.round(tilMm(r.tykkelse || 0));
  });
}

// Samme vinkelregel som sw-tegning.js bruker. Duplisert med vilje: migreringen
// skal ikke tvinge inn en import av tegnemodulen (den lastes dynamisk).
function vinkelDiffLokal(a, b) {
  let d = (Number(a) || 0) - (Number(b) || 0);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Holdepunktene et drag snapper til: fasadens søylepunkter (10 mm fra senter
// og søylekanten) PLUSS skjøtene i de andre radene på samme fasade — de er
// like nyttige å låse mot, og de finnes også for eldre, migrerte vegger som
// ikke har søylepunktene lagret.
function snappPunkter(v) {
  const ut = (v.snapp || []).slice();     // søylepunktene: 10 mm fra senter + søylekant
  // En ringmurbit snapper mot de ANDRE RINGMURBITENE, et veggelement mot de
  // andre veggelementene — hver liste for seg.
  const b = butikkFor(v);
  const naboer = v.ringmur ? ((b && b.ringmur) || [])
                           : ((b && b.vegger) || []);
  for (const w of naboer) {
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
  migrerRingmur();
  // Innerveggene løses UANSETT — også på et bygg som bare har dem. Sto dette
  // etter den tidlige returen under, ville et drag i en innervegg vært dødt på
  // en modell uten yttervegger.
  if (!lagret || !lagret.vegger) { loesInnervegger(); return; }
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
      // 🏔 SKRÅKAPP: endehøydene leses av taklinja på NYTT etter draget, så et
      // element som strekkes langs en gavl får riktig skråkapp i den nye enden.
      // Uten dette beholdt det høyden fra der det sto da det ble generert.
      const lin = ((lagret.fasader || [])[v.fi] || {}).takLinje;
      if (v.radHMm && lin && lin.length > 1) {
        const rB = v.rBunnMm || 0;
        const tp = takTopp(lin, v.fraMm, v.tilMm, rB, rB + v.radHMm);
        v.toppP = tp; v.hVMm = tp[0][1]; v.hHMm = tp[tp.length - 1][1];
        v.hoydeMm = Math.max(...tp.map(q => q[1]));
        v.skra = toppErSkra(tp, v.radHMm) || undefined;
        if (!v.skra) v.toppP = undefined;
        // Dras et element helt forbi taket, er det ikke lenger noe panel der.
        // Uten dette sto det igjen som en flate med null høyde, og geometrien
        // vrengte seg (Emil 08.09).
        if (v.hoydeMm < 20) v.skjult = true;
        // VINKELEN regnes ÉN gang, her, og leses av både 3D-merkinga, lista og
        // instruksjonstegninga. Regnet tre steder ville de tre tallene før
        // eller siden sagt hver sin ting etter et drag.
        //
        // Den regnes av TAKLINJA over elementets utstrekning, ikke av hVMm/hHMm.
        // Endehøydene er KLIPPET til radbåndet, og et element som dras forbi
        // der taket krysser radbunnen får da en ende på 5 mm — og en vinkel på
        // 25,2° der taket faktisk faller 27,4° (Emil 08.09). Panelet skjæres
        // etter takfallet; høydene forteller hvor høyt det er i hver ende, og
        // vinkelen forteller hvor bratt kuttet er. To spørsmål, to svar.
        // Vinkelen måles på selve SKRÅKUTTET — den bratteste strekningen i
        // overkanten. Målt over hele elementet ville en femkant der bare det
        // ene hjørnet er tatt av gitt 0°.
        v.skraTekst = v.skra ? vinkelTekst(toppVinkel(tp)) : undefined;
        if (lagret.baseY !== undefined)
          v.y = lagret.baseY + tilScene((v.rBunnMm || 0) + v.hoydeMm / 2);
      }
      // Et STREKKET element er ikke kapp — Moelv SW-05 er 6490 mm i et
      // 5980-felt og har ekte nummer. Bare et FORKORTET er kapp.
      v.tilpasset = !!v.tilpassetRad || !!v.skra || v.lengdeMm < v.fullMm - SW_TOL_MM ||
                    (o.kappUnderMm > 0 && v.lengdeMm < o.kappUnderMm);
    }
  }
  // ✥ Ringmuren løses på nøyaktig samme vis. Egen løkke, ikke samme liste:
  // ringmurbitene har ingen SW-nummer, ingen leveransestabel og ingen linje i
  // CSV-lista — de skal ikke gjennom noe av det som følger under.
  loesRingmur();
  loesInnervegger();

  const synlige = lagret.vegger.filter(v => !v.skjult);
  const { numre, nokkel } = swNummerering(synlige);
  for (const v of lagret.vegger) {
    if (v.skjult) { v.sw = ""; continue; }
    if (!v.tilpasset) { v.sw = numre.get(nokkel(v)) || "SW-XX"; continue; }
    v.sw = kappNavn(numre.get(nokkel({ lengdeMm: v.fullMm, hoydeMm: v.hoydeMm })), o.kappTekst);
  }
}

// ✥ Ringmuren løst opp etter de samme reglene som veggradene: én gruppe per
// fasade (radIdx «rm»), samme loesRad, samme minste bit. Biter fra en eldre
// generering mangler basFraMm og hoppes over — de tegnes som før, men kan
// ikke dras før neste generering.
function loesRingmur() { loesRingmurBiter((lagret && lagret.ringmur) || []); }

function loesRingmurBiter(biter) {
  if (!biter.length) return;
  const grupper = new Map();
  for (const r of biter) {
    if (r.basFraMm === undefined) continue;
    const k = r.fi + "|rm";
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(r);
  }
  for (const liste of grupper.values()) {
    const res = loesRad(liste.map(r => ({
      id: r.id,
      fraMm: r.basFraMm + (r.dFra || 0),
      tilMm: r.basTilMm + (r.dTil || 0),
      rev: r.rev || 0
    })), SW_MIN_BIT_MM);
    for (const r of liste) {
      const res2 = res.get(r.id);
      if (!res2) continue;
      r.skjult = !!res2.skjult;
      r.fraMm = Math.round(res2.fraMm);
      r.tilMm = Math.round(res2.tilMm);
      r.lengdeMm = Math.max(0, Math.round(res2.tilMm - res2.fraMm));
      const midMm = (res2.fraMm + res2.tilMm) / 2;
      r.tMid = tilScene(midMm);
      r.x = r.fx + r.ex * r.tMid;
      r.z = r.fz + r.ez * r.tMid;
      r.lengde = tilScene(r.lengdeMm);
    }
  }
}

// 🚪 INNERVEGGENE LØSES OPP ETTER DE SAMME REGLENE. Egen løkke, ikke samme
// liste: innerveggene har egen lagring og egen nummerserie, og et drag i den
// ene skal aldri kunne flytte et element i den andre.
//
// Ingen taklinje her — en innervegg er flat, så hele skråkapp-delen av
// `loesAlleJusteringer` faller bort. Ellers er det samme `loesRad`, samme
// minste bit og samme kapp-regel.
function loesInnervegger() {
  const d = lagretInner;
  if (!d || !(d.vegger || []).length) return;
  const grupper = new Map();
  for (const v of d.vegger) {
    if (v.basFraMm === undefined) continue;
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
      v.tMid = tilScene((r.fraMm + r.tilMm) / 2);
      v.x = v.fx + v.ex * v.tMid;
      v.z = v.fz + v.ez * v.tMid;
      // Et STREKKET element er ikke kapp, bare et FORKORTET.
      v.tilpasset = !!v.tilpassetRad || v.lengdeMm < v.fullMm - SW_TOL_MM;
    }
  }
  loesRingmurBiter(d.ringmur || []);
  nummererInner(d);
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

// 📦 LEVERANSESTABLENE FOR INNERVEGGENE (Emil 08.09). Egen funksjon og egne
// navn: to serier som begge starter på SW-01 ville ellers blitt slått sammen i
// Mengder, og tallene ville vært feil for begge. Stabelen heter derfor
// «SW-01 innervegg» — samme nummer som på tegninga, med hvilken vegg det er.
function byggInnerStabler() {
  const d = lagretInner;
  fjernInnerMateriell();
  if (!d || !(d.vegger || []).length) return;
  const perSw = new Map();
  for (const v of d.vegger) {
    if (v.skjult || !v.sw || v.tilpasset) continue;
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm,
      antall: 0, fi: v.fi, tSum: 0, tMm: v.tMm });
    const g = perSw.get(v.sw);
    g.antall++;
    g.tSum += v.tMid;
  }
  const nyeIder = [];
  const fasadeRad = new Map();
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0], "no"))) {
    const f = (d.fasader || [])[g.fi] || (d.fasader || [])[0];
    if (!f) continue;
    const o = { ...INNER_STD, ...(f.o || {}) };
    const rad = fasadeRad.get(g.fi) || 0;
    fasadeRad.set(g.fi, rad + 1);
    const ut = f.off + tilScene(5000) + rad * tilScene(g.hoydeMm + 1500);
    const tMid = Math.max(f.t0 + tilScene(g.lengdeMm) / 2,
      Math.min(f.t1 - tilScene(g.lengdeMm) / 2, g.tSum / g.antall));
    const pkt = vaskMateriell({
      id: "SWI-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw + " " + t("innervegg"), farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: g.tMm || o.tykkelseMm,
      antall: g.antall,
      x: f.px + f.ex * tMid + f.nx * ut,
      y: (f.okBetong !== undefined ? f.okBetong : innerBaseY()),
      z: f.pz + f.ez * tMid + f.nz * ut,
      rot: f.rot
    });
    if (pkt) { nyeIder.push(pkt.id); S.materiell = (S.materiell || []).concat([pkt]); }
  }
  d.materiellIder = nyeIder;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// Rydder BARE innerveggenes stabler, og gjør det på ID — ikke på navnet.
// Del A må lete etter navn i tillegg, fordi gamle versjoner ikke sporet id-ene.
// Innerveggene har hatt id-sporing fra første runde, og et navnemønster ville
// dessuten sluttet å treffe så snart noen byttet språk: stabelnavnet er
// oversatt. Ryddingen skjer FØR `skrivInner` fjerner nøkkelen, så id-ene
// finnes alltid når de trengs.
function fjernInnerMateriell() {
  const ider = new Set((lagretInner && lagretInner.materiellIder) || []);
  if (!ider.size) return;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(pkt => !ider.has(pkt.id));
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// Begge seriene. Kalles der del A før kalte byggStabler() alene, så antallene
// i Mengder følger med etter hver generering og hvert drag.
function byggAlleStabler() {
  byggStabler();
  byggInnerStabler();
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
  // 📊 EKTE EXCEL-FIL, ikke CSV (Emil 03.09): CSV-en var riktig på PC-en og
  // feil i mailen, fordi Excel på nett og Outlook alltid leser «,» som
  // skilletegn. Se lastNedXlsx i elements.js.
  const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  lastNedXlsx(navn + " - SW-liste.xlsx", t("SW-liste"), rader)
    .catch(err => {
      console.warn("SW-lista kunne ikke lages:", err);
      alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
    });
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
  if ($("swFolgTak")) o.folgTak = !!$("swFolgTak").checked;
  o.klaringMm = Math.max(0, Math.min(100, num("swKlaring", o.klaringMm)));
  o.minFeltMm = Math.max(0, Math.min(6000, num("swMinFelt", o.minFeltMm)));
  o.minSkraMm = Math.max(0, Math.min(3000, num("swMinSkra", o.minSkraMm)));
  o.kappUnderMm = Math.max(0, Math.min(6000, num("swKappUnder", o.kappUnderMm)));
  if ($("swKappTekst")) o.kappTekst = $("swKappTekst").value;
  if ($("swVisUtsp")) o.visUtsp = !!$("swVisUtsp").checked;
  o.farge = ($("swFarge") || {}).value || o.farge;
  o.isolasjon = txt("swIsoType") || o.isolasjon;
  o.utvFarge = txt("swUtvF");
  o.innFarge = txt("swInnF");
  o.prosjekt = txt("swProsjekt");
  o.oppdragsnr = txt("swOppdrag");
  o.sted = txt("swSted");
  o.sign = txt("swSign");
  if ($("swPdfFase")) {
    o.pdfFase = txt("swPdfFase");
    o.pdfTittel = txt("swPdfTittel");
    o.pdfNr = txt("swPdfNr") || "SW-01";
    o.pdfProsjekt = txt("swPdfProsjekt");
    o.pdfUndertittel = txt("swPdfUnder");
    o.pdfOppdrag = txt("swPdfOppdrag");
    o.pdfTegnet = txt("swPdfTegnet");
    o.pdfKontroll = txt("swPdfKontroll");
    o.pdfGodkjent = txt("swPdfGodkjent");
    o.pdfDato = txt("swPdfDato");
    o.pdfMerknad = (($("swPdfMerknad") || {}).value || "").trim();
  }
  skrivLagret();
  return o;
}

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
function akseNavnFor(fi, fasader) {
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
const STAL_TYPER = ["Column", "Beam", "Member", "Plate"];

async function stalPaFasader(fasader, oppsettInn, baseYInn) {
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
    ut.push({ fi: best, id, fraMm: Math.round(fraMm), tilMm_: Math.round(tilMm_),
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

// ---------- Ringmurbitene projisert på fasadene ----------
// Ringmuren lagres som biter i scenerommet ({x, z, y, lengde, hoyde, rot}) —
// og den er ALT kappet der utsparingene tar den. Tegninga må bruke bitene, ikke
// ett bånd tvers over fasaden: da sto det ringmur under porten (Emil 03.09).
// Ringmurbitene projisert på fasadene. REGELEN (tilordning etter retning, ikke
// avstand) ligger i js/sw-tegning.js som en ren funksjon — der kan den prøves.
// Her hentes bare dataene ut av lagringen.
async function ringmurPaFasader(mod) {
  return mod.ringmurTilFasader(
    (lagret && lagret.ringmur) || [],
    (lagret && lagret.fasader) || [],
    tilMm, baseYNaa());
}

async function lastNedTegning() {
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

// ---------- ✥ Juster elementer: dra i endene ----------
// Emils ønske 02.09: trykk på et element og dra i enden for å stille lengden.
// Shift+klikk markerer flere, som dras samtidig. Kanten snapper til 10 mm fra
// søylesenter eller til søylekanten. Drar du inn i naboen blir den kortere, og
// under 100 mm forsvinner den — men kommer tilbake når du drar tilbake, fordi
// ingenting slettes: alt er avledet av basFraMm/basTilMm + dFra/dTil.
// Finner et justerbart element — vegg ELLER ringmurbit. Begge har id, basis og
// forskyvninger, og hele justeringen bryr seg ikke om hvilken av dem det er.
// HVILKEN LAGRING et element bor i. Ytterveggene ligger i `lagret`,
// innerveggene i `lagretInner` — og justeringsmodusen skal ikke vite forskjell
// (Emil 08.09: «juster element funker ikke på innervegger»). Flagget står på
// elementet selv, satt der det ble bygget.
function butikkFor(v) {
  return v && v.inner ? lagretInner : lagret;
}

function veggMedId(id) {
  for (const b of [lagret, lagretInner]) {
    if (!b) continue;
    const v = (b.vegger || []).find(w => w.id === id) ||
              (b.ringmur || []).find(r => r.id === id);
    if (v) return v;
  }
  return null;
}

// Hvilken liste et element bor i. Ringmurbiter og veggelementer justeres med
// samme kode (Emil 03.09), men de ligger i hver sin array — og nå i hver sin
// lagring også.
function listeFor(v) {
  const b = butikkFor(v);
  if (!b) return [];
  return v && v.ringmur ? (b.ringmur = b.ringmur || [])
                        : (b.vegger = b.vegger || []);
}

// Lagrer den butikken elementet hører til. Et drag i en innervegg skal ikke
// skrive ytterveggene, og omvendt.
function skrivFor(v) {
  if (v && v.inner) skrivInner(); else skrivLagret();
}

// Begge lagringene, når et drag kan ha tatt element fra begge (shift+klikk).
function skrivBegge() {
  skrivLagret();
  if (lagretInner) skrivInner();
}

// Neste revisjonsnummer i elementets EGEN liste — en ringmurbit skal ikke
// arve revisjonen til et veggdrag.
function nesteRev(v) {
  return 1 + Math.max(0, ...listeFor(v).map(w => w.rev || 0));
}

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
    .map(v => (v.sw || (v.ringmur ? t("Ringmur") : "SW-XX")) + " " + v.lengdeMm + "×" + v.hoydeMm)
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
    for (const v of [...((lagret && lagret.vegger) || []), ...((lagret && lagret.ringmur) || []),
                     ...((lagretInner && lagretInner.vegger) || []),
                     ...((lagretInner && lagretInner.ringmur) || [])])
      { v.dFra = 0; v.dTil = 0; v.rev = 0; }
    loesAlleJusteringer(); byggAlleStabler(); skrivBegge(); tegnAlt(); merkValgte();
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
// Angre-bildet må ta med BEGGE listene. Uten ringmuren ville et drag i den
// vært usynlig for angre — og et angre av et veggdrag ville dratt ringmuren
// tilbake til der den var før veggen ble rørt.
function justBilde() {
  return JSON.parse(JSON.stringify({
    vegger: (lagret && lagret.vegger) || [],
    ringmur: (lagret && lagret.ringmur) || [],
    // Innerveggene MÅ med. Uten dem ville et angre av et drag i en innervegg
    // ikke gjort noe — og et angre av et ytterveggdrag ville dratt
    // innerveggene tilbake til der de sto før.
    iVegger: (lagretInner && lagretInner.vegger) || [],
    iRingmur: (lagretInner && lagretInner.ringmur) || []
  }));
}

function settJustBilde(bilde) {
  if (!lagret) return;
  // Bakoverkompatibelt: et bilde tatt før ringmuren ble justerbar er en naken
  // array av vegger.
  const b = Array.isArray(bilde) ? { vegger: bilde, ringmur: lagret.ringmur } : bilde;
  lagret.vegger = JSON.parse(JSON.stringify(b.vegger || []));
  if (b.ringmur) lagret.ringmur = JSON.parse(JSON.stringify(b.ringmur));
  if (lagretInner && b.iVegger) {
    lagretInner.vegger = JSON.parse(JSON.stringify(b.iVegger));
    lagretInner.ringmur = JSON.parse(JSON.stringify(b.iRingmur || []));
  }
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
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
  if (!just) return;
  const foer = justBilde();
  const o = (lagret && lagret.oppsett) || STD_OPPSETT;
  let delt = 0;
  for (const id of [...just.valgt]) {
    const v = veggMedId(id);
    if (!v || v.skjult) continue;
    // Klaringen tas fra den veggen elementet FAKTISK står i: en innervegg kan
    // ha en annen skjøt enn ytterveggene.
    const kl = v.inner
      ? (((lagretInner && (lagretInner.fasader || [])[v.fi]) || {}).o || {}).klaringMm
      : o.klaringMm;
    const kanter = splittKanter(v.fraMm, v.tilMm, kl === undefined ? o.klaringMm : kl, SW_MIN_BIT_MM);
    if (!kanter) continue;
    const rev = nesteRev(v);
    const ny = JSON.parse(JSON.stringify(v));
    ny.id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // begge halvdelene får ny BASIS og nullede forskyvninger — da er de
    // vanlige elementer som kan dras videre hver for seg
    v.basFraMm = kanter[0][0]; v.basTilMm = kanter[0][1]; v.dFra = 0; v.dTil = 0; v.rev = rev;
    ny.basFraMm = kanter[1][0]; ny.basTilMm = kanter[1][1]; ny.dFra = 0; ny.dTil = 0; ny.rev = rev;
    // full feltlengde arves, så begge halvdelene regnes som kapp
    const liste = listeFor(v);
    liste.splice(liste.indexOf(v) + 1, 0, ny);
    just.valgt.add(ny.id);
    delt++;
  }
  if (!delt) { alert(t("Elementet er for kort å dele — hver halvdel må bli minst 100 mm.")); return; }
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
  merkValgte();
  tegnJustBar();
  postJust("Veggelement delt", foer);
}

function startJuster() {
  const antYtre = ((lagret && lagret.vegger) || []).length;
  const antIndre = ((lagretInner && lagretInner.vegger) || []).length;
  if (!antYtre && !antIndre) { alert(t("Generer veggelementene først.")); return; }
  // Migrer og tegn på nytt FØR modusen åpnes: en ringmur laget av en eldre
  // versjon mangler id-en plukkingen trenger, og da klikket man rett gjennom
  // muren og traff søyla bak (Emil 03.09). Etter migreringen bærer hver bit
  // id-en, og tegninga må gjøres om for at meshen skal få den.
  loesAlleJusteringer();
  byggAlleStabler();
  skrivBegge();
  tegnAlt();
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
  const rev = nesteRev(v);
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
  byggAlleStabler();
  skrivBegge();
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

// `forInner` = true når markeringen hører til den innerveggen som redigeres.
// Da havner boksene på SERIEN, ikke i del A-oppsettet: en dør i en innervegg
// skal ikke kappe ytterveggen bak den.
function startUtspMark(forInner) {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  const prikker = new THREE.Group();
  swGroup.add(prikker);
  utspMark = { flater: [], ned: null, prikker, inner: !!forInner };
  $("swPanel").classList.remove("open");   // panelet i veien for modellen
  tegnInnerBar();                          // innerveggbaren viker for denne
  tegnUtspBar();
}

function avsluttUtspMark() {
  if (!utspMark) return;
  utspMark.prikker.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  swGroup.remove(utspMark.prikker);
  utspMark = null;
  tegnUtspBar();
  tegnInnerBar();          // står vi i en innervegg, kommer baren tilbake
  tegnPanel();
  apnePanel("swPanel");
}

function fullforUtspMark() {
  if (!utspMark) return;
  const e = S.enhetSkala || 1;
  // flater innenfor 4 m hører til samme åpning — da kan alle åpningene
  // markeres i én omgang og Ferdig trykkes til slutt (Emils runde 5)
  const klynger = grupperFlater(utspMark.flater, 4.0 / e);
  // 🚪 Innerveggens åpninger bor på SERIEN som redigeres; ytterveggenes i
  // del A-oppsettet. Samme markering, to mottakere.
  const tilInner = utspMark.inner && innerMark && innerMark.steg === "side";
  const o = oppsett();
  const maal = tilInner
    ? (innerMark.serie.utsparinger = (innerMark.serie.utsparinger || []).filter(x => x && x.min))
    : (o.utsparinger = (o.utsparinger || []).filter(x => x && x.min));
  let lagt = 0, feilet = 0;
  for (const kl of klynger) {
    const u = utsparingFraFlater(kl, 0.5 / e);
    if (u.feil) { feilet++; continue; }
    lagt++;
    maal.push({ navn: t("Utsparing {0}", maal.length + 1), min: u.min, max: u.max,
                akse: u.akse, flater: u.antFlater, kilde: u.kilde });
  }
  if (!lagt) {
    alert(t("Utsparingen trenger to motstående sider — trykk på innsiden av søylene på hver side av åpningen."));
    return;
  }
  if (!tilInner) skrivLagret();
  avsluttUtspMark();
  if (tilInner) innerForhandsvis();
  // 🚪 EMILS FUNN 08.09: han markerte en dør til innerveggen med den vanlige
  // «Marker utsparing», den ble lagret som «Utsparing 14» — og ingenting
  // skjedde med veggen. Åpningen lå i den globale lista, og innerveggene ble
  // aldri bygget på nytt. Nå gjør de det, og døra kapper veggen den står i.
  else oppdaterInnerveggerEtterUtsp();
  if (feilet) alert(t("{0} utsparinger lagt til — {1} område manglet to motstående sider og ble hoppet over.", lagt, feilet));
}

// Klikkene fanges på window i FANGSTFASEN (samme oppskrift som materiell.js):
// kameraet får dra som vanlig — bare et trykk under 8 px behandles, og da
// stoppes det FØR elementvalget i main.js ser det.
// Trykket må ha landet PÅ lerretet. Uten denne sjekken fanget window-lytteren
// også trykk på knappene i modus-baren (#swUtspBar ligger over lerretet), og
// «Ferdig»/«Avbryt» plukket i tillegg flata bak knappen (Emils funn 03.09).
// Samme guard som overCanvas() i materiell.js.
window.addEventListener("pointerdown", (e) => {
  if (!utspMark || e.button !== 0) return;
  if (e.target !== canvas) { utspMark.ned = null; return; }
  utspMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!utspMark || e.button !== 0 || !utspMark.ned) return;
  if (e.target !== canvas) { utspMark.ned = null; return; }
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
  const lagrede = lesLagrede();
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
    '<label style="display:flex;gap:6px;align-items:center" title="' +
      t("Leser taklinja av stålet i fasadeplanet og skråkapper veggen. Slå den på for saltak og pulttak. På et bygg med fagverk i gavlen ligger takstolen i veggplanet, og da skal den stå av.") +
      '"><input type="checkbox" id="swFolgTak"' +
      (o.folgTak ? " checked" : "") + '> ' + t("Veggen følger taket (saltak/pulttak)") + '</label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swKappNed"' +
      (o.kappNederst ? " checked" : "") + '> ' + t("Tilpasningsraden nederst (som Moelv/Lørenskog)") + '</label>' +
    felt("swMinFelt", "Minste felt (mm) — tettere skjøter slås sammen", o.minFeltMm) +
    felt("swKappUnder", "Alt kortere enn (mm) er kapp — 0 = av", o.kappUnderMm) +
    felt("swMinSkra", "Tynneste ende på skråkapp (mm) — 0 = helt inntil taket", o.minSkraMm) +
    '<label>' + t("Navn på kappbiter") +
      '<span class="sw-prefiks"><span>SW-</span>' +
      '<input type="text" id="swKappTekst" maxlength="20" value="' +
      esc(o.kappTekst || "XX") + '"></span></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Skriv bare slutten — «SW-» settes alltid foran. «XX» gir SW-XX (Moelv), «18*» gir SW-18*. Bare «*» gir forelderens nummer med stjerne (Lørenskog).") + '</p>' +
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
    (o.visUtsp !== false && utsp.length && !(lagret && (lagret.fasader || []).length)
      ? '<p style="color:var(--muted);font-size:11px;margin:2px 0">' +
        t("Trykk «Generer SW + gulv/ringmur» for å få fram utsparingsmålene — veggene er laget av en eldre versjon.") + '</p>'
      : "") +
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
    innerPanelHtml() +
    '<h4 style="margin:10px 0 4px">' + t("Til lista") + '</h4>' +
    felt("swProsjekt", "Prosjekt", o.prosjekt, "text") +
    felt("swOppdrag", "Oppdragsnummer", o.oppdragsnr, "text") +
    felt("swSted", "Sted", o.sted, "text") +
    felt("swSign", "Sign.", o.sign, "text") +
    // 📐 Rutene i Storm-tittelfeltet på instruksjonstegninga. Står de tomme,
    // arves de fra Til lista-feltene over — derfor er hjelpeteksten viktigere
    // enn den ser ut: uten den ser tomme felt ut som manglende data.
    '<h4 style="margin:10px 0 4px">' + t("Utfyll PDF") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Dette fyller Storm-tittelfeltet på instruksjonstegninga. Tomt felt hentes fra «Til lista» over; Kontroll og Godkjent står tomme på papiret hvis du ikke fyller dem.") + '</p>' +
    felt("swPdfNr", "Tegningsnummer (nummeret øker per ark)", o.pdfNr || "SW-01", "text") +
    felt("swPdfTittel", "Tegningstittel", o.pdfTittel, "text") +
    felt("swPdfFase", "Prosjektfase", o.pdfFase, "text") +
    felt("swPdfProsjekt", "Prosjektnavn (linje 1)", o.pdfProsjekt, "text") +
    felt("swPdfUnder", "Undertittel (linje 2)", o.pdfUndertittel, "text") +
    felt("swPdfOppdrag", "Oppdragsnummer", o.pdfOppdrag, "text") +
    felt("swPdfTegnet", "Tegnet av", o.pdfTegnet, "text") +
    felt("swPdfKontroll", "Kontrollert av", o.pdfKontroll, "text") +
    felt("swPdfGodkjent", "Godkjent av", o.pdfGodkjent, "text") +
    felt("swPdfDato", "Utsendt dato (tom = i dag)", o.pdfDato, "text") +
    '<label>' + t("Merknad ved fasaden") +
      '<textarea id="swPdfMerknad" rows="2" maxlength="300" placeholder="' +
      esc(t("Veggelementer må kappes og tilpasses til eksisterende fasade. L-Beslag festes til eks. fasade.")) +
      '">' + esc(o.pdfMerknad || "") + '</textarea></label>' +
    '<label>' + t("Logo i tittelfeltet") +
      '<select id="swPdfLogo"><option value="">' + esc(t("Innebygd Storm-logo")) + '</option></select></label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      (S.akseLinjer
        ? t("Aksenavnene hentes fra 🔠 Akser.")
        : t("Aksenavnene blir A, B, C … per fasade. Bygg aksene i 🔠 Akser først hvis du vil ha byggets egne aksenavn på tegninga.")) + '</p>' +
    '<div class="prop-actions" style="margin-top:10px;flex-wrap:wrap">' +
    '<button id="swGenerer" class="primary">' + ikon("boks") + ' ' + t("Generer SW + gulv/ringmur") + '</button>' +
    '<button id="swJusterBtn">✥ ' + t("Juster elementer") + '</button>' +
    '<button id="swTegning">' + ikon("tegning") + ' ' + t("Last ned instruksjonstegning (PDF)") + '</button>' +
    '<button id="swListe">' + ikon("lastned") + ' ' + t("Last ned liste (Excel)") + '</button>' +
    '<button id="swFjern">' + ikon("slett") + ' ' + t("Fjern genererte") + '</button></div>' +
    (antall ? '<p style="color:var(--muted);font-size:12px;margin-top:6px">' +
      t("{0} veggelementer generert. Stablene ligger i 📦 Materiell og telles i Mengder.", antall) + '</p>' : "") +
    // 💾 Lagrede resultater — helt nederst, som «Lagrede grupper» i Bygginfo.
    '<h4 style="margin:14px 0 4px">' + t("Lagrede SW-resultater") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Gi resultatet et navn og lagre det. Trykk på navnet senere for å laste hele resultatet inn på bygget igjen.") + '</p>' +
    '<div class="prop-actions sw-lagre">' +
      '<input type="text" id="swLagreNavn" maxlength="60" placeholder="' +
      esc(t("Navn på resultatet")) + '">' +
      '<button id="swLagreBtn">' + ikon("lagre") + ' ' + t("Lagre") + '</button></div>' +
    (lagrede.length
      ? lagrede.map(pst =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' +
          '<button class="sw-last" data-sw-last="' + esc(pst.navn) + '">' +
          esc(pst.navn) + '</button>' +
          ' <span style="color:var(--muted);font-size:11px">' +
          esc([pst.dato, pst.antall ? t("{0} element", pst.antall) : ""].filter(Boolean).join(" · ")) +
          '</span></div>' +
        '<div class="c"><button data-sw-slett-lagret="' + esc(pst.navn) + '" title="' + t("Slett") +
        '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")
      : '<p style="color:var(--muted);font-size:12px">' + t("Ingen lagrede resultater ennå.") + '</p>');
  $("swGenerer").onclick = async () => {
    lesOppsettFraPanel();
    $("swGenerer").disabled = true;
    try { await generer(); }
    catch (err) { console.warn("SW-generator:", err); alert(t("Genereringen feilet: ") + (err && err.message || err)); }
    finally { const b = $("swGenerer"); if (b) b.disabled = false; }
  };
  $("swListe").onclick = () => { lesOppsettFraPanel(); lastNedListe(); };
  if ($("swLagreBtn")) $("swLagreBtn").onclick = () => {
    lesOppsettFraPanel();
    lagreResultat(($("swLagreNavn") || {}).value);
  };
  body.querySelectorAll("button[data-sw-last]").forEach(b =>
    b.onclick = () => lastInnResultat(b.dataset.swLast));
  body.querySelectorAll("button[data-sw-slett-lagret]").forEach(b =>
    b.onclick = () => slettResultat(b.dataset.swSlettLagret));
  if ($("swTegning")) $("swTegning").onclick = lastNedTegning;
  fyllLogovalgSW();
  $("swFjern").onclick = () => { lesOppsettFraPanel(); fjernAltGenerert(); };
  $("swNyUtsp").onclick = () => { lesOppsettFraPanel(); startUtspMark(); };
  if ($("swVisUtsp")) $("swVisUtsp").onchange = () => { lesOppsettFraPanel(); tegnAlt(); };
  if ($("swJusterBtn")) $("swJusterBtn").onclick = () => { lesOppsettFraPanel(); startJuster(); };
  koblInnerPanel(body);
  body.querySelectorAll("button[data-sw-slett-utsp]").forEach(b =>
    b.onclick = () => {
      lesOppsettFraPanel();
      const o2 = oppsett();
      o2.utsparinger.splice(Number(b.dataset.swSlettUtsp), 1);
      skrivLagret();
      tegnPanel();
      oppdaterInnerveggerEtterUtsp();   // åpningen forsvinner også fra innerveggen
    });
}

// Logolista hentes fra SharePoint FØRSTE gang panelet tegnes, og huskes så
// lenge fanen står åpen. Feiler hentingen (ikke innlogget, ingen dekning) står
// bare «Innebygd Storm-logo» igjen — tegninga lages likevel.
let swLogoer = null;

async function fyllLogovalgSW() {
  if (!$("swPdfLogo")) return;
  if (!swLogoer) {
    try { swLogoer = await hentLogoer(); } catch (_) { swLogoer = []; }
  }
  // Panelet kan ha blitt tegnet på nytt mens vi ventet på SharePoint — hent
  // elementet ETTER ventingen, ellers fylles en <select> som er kastet.
  const v = $("swPdfLogo");
  if (!v) return;
  for (const l of swLogoer) {
    const o = document.createElement("option");
    o.value = l.itemId; o.textContent = ryddLogonavn(l.fil); o.dataset.fil = l.fil;
    v.appendChild(o);
  }
  const husket = (oppsett() || {}).pdfLogo;
  if (husket) {
    const treff = [...v.options].find(o => o.dataset.fil === husket);
    if (treff) v.value = treff.value;
  }
  v.onchange = () => {
    const o = v.selectedOptions[0];
    oppsett().pdfLogo = (o && o.dataset.fil) || "";
    skrivLagret();
  };
}

// ═══════════ 🚪 INNERVEGGER: markering, side, godkjenning, egen serie ═══════════
//
// HELE DEL B LIGGER FOR SEG SELV — egen lagringsnøkkel, egen liste, egen
// tegning. Det er ikke ryddighet for ryddighetens skyld: ytterveggene på de
// fire regresjonsbyggene skal være BIT FOR BIT uendret etter denne runden, og
// den eneste måten å vite det er at innerveggene ikke deler en eneste array
// med dem. Numrene starter derfor på SW-01 igjen av seg selv — de kommer fra
// swNummerering over en annen liste.
//
// Emils flyt (08.09), steg for steg:
//   A  «Ny innervegg» → marker søylene veggen skal stå på
//   B  velg radhøyder, vegghøyde, tykkelse, farge og ringmur
//   C  velg SIDE av søylene — pila i 3D viser hvilken, og forhåndsvisningen
//      står der veggen faktisk kommer
//   D  «Godkjenn»
//   E  egen SW-liste fra SW-01, egen PDF, eget regneark

const INNER_STD = {
  radHoyder: "", kappNederst: true,
  veggHoydeMm: 3000,            // Emils valg: vegghøyden skrives inn
  tykkelseMm: 100, farge: "#eef2f7",
  ringmur: false, ringHoydeMm: 500,
  klaringMm: SW_KLARING_MM, minFeltMm: SW_MIN_FELT_MM,
  // Endene: 0 = veggen går fra første til siste søylesenter. Se innerveggBiter.
  endeMm: 0,
  // 🔲 Rundt et rom: siste bein går tilbake til første søyle. AV som standard —
  // en L er det vanlige, og en lukket boks skal være et valg, ikke en gjetning.
  lukk: false,
  // Hvor mye retningen må endre seg for at veggen KNEKKER i et hjørne.
  // 25° tar en rettvinklet L uten å dele en rekke som bukter seg litt.
  knekkGrader: 25
};

// PROSJEKTDATAENE BOR ETT STED. Prosjektnavn, oppdragsnummer, sted, sign,
// isolasjon og fargenavnene til lista hentes fra del A-oppsettet — to sett
// felter for samme prosjekt ville drevet fra hverandre første gang noen retta
// bare det ene. Innerveggene overstyrer bare det som FAKTISK er deres eget:
// geometrien, fargen i 3D, og tegningsnummeret.
function innerOppsettForListe(so) {
  const a = oppsett();
  return { ...a, ...so, betongMm: 0, isoMm: 0,
    pdfNr: (innerData().oppsett.pdfNr || "SWI-01"),
    pdfTittel: a.pdfTittel || t("SW-Elementer innervegg") };
}

let lagretInner = null;
function innerNokkel() { return "storm-ifc-sw-inner::" + S.fileName; }

function lesInner() {
  try { return JSON.parse(localStorage.getItem(innerNokkel()) || "null"); }
  catch (_) { return null; }
}

function skrivInner() {
  try {
    if (lagretInner && (lagretInner.serier || []).length)
      localStorage.setItem(innerNokkel(), JSON.stringify(lagretInner));
    else localStorage.removeItem(innerNokkel());   // siste innervegg slettet
  } catch (_) {}
}

function innerData() {
  if (!lagretInner) lagretInner = lesInner() || null;
  if (!lagretInner || typeof lagretInner !== "object")
    lagretInner = { oppsett: { ...INNER_STD }, serier: [], vegger: [], ringmur: [], fasader: [] };
  lagretInner.oppsett = { ...INNER_STD, ...(lagretInner.oppsett || {}) };
  for (const n of ["serier", "vegger", "ringmur", "fasader"])
    if (!Array.isArray(lagretInner[n])) lagretInner[n] = [];
  // Skjulingen er en VISNINGStilstand og bor hos innerveggene selv, ikke i
  // del A: slår Emil av ytterveggene, skal innerveggene stå igjen.
  if (!lagretInner.skjul || typeof lagretInner.skjul !== "object") lagretInner.skjul = {};
  if (!Array.isArray(lagretInner.materiellIder)) lagretInner.materiellIder = [];
  for (const s of lagretInner.serier) {
    s.o = { ...INNER_STD, ...(s.o || {}) };
    if (!Array.isArray(s.utsparinger)) s.utsparinger = [];
  }
  if (!Array.isArray(lagretInner.utspVis)) lagretInner.utspVis = [];
  return lagretInner;
}

// ---------- Byggingen av én innervegg ----------
// `perId` er id → søylestabel fra hentSoyler(). Serien lagrer element-IDENE,
// ikke koordinatene: åpnes modellen på nytt, står søylene der de står, og
// veggen kan bygges opp igjen fra samme søyler uten at noe er frosset fast.
export function byggEnInnervegg(serie, perId, fi, nV, nR, globaleUtsp) {
  const o = { ...INNER_STD, ...(serie.o || {}) };
  const soyler = [...new Set((serie.ider || []).map(id => perId.get(id)).filter(Boolean))];
  // ETT HJØRNE = TO BEIN (Emil 08.09). Er søylene på én linje, kommer det ett
  // bein ut, og alt under er bit for bit som en rett innervegg.
  const bein = innerveggBein(soyler, o.knekkGrader, o.lukk);
  if (!bein.length) return null;
  const sg = Number(serie.side) < 0 ? -1 : 1;
  const tS = tilScene(o.tykkelseMm);
  const okBetong = Math.min(...soyler.map(s => s.minY));
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;
  const stabelMm = Math.max(100, (Number(o.veggHoydeMm) || 0) - tilMm(ringH));
  const { rader, kappIndex } = radStabel(stabelMm, o.radHoyder, o.kappNederst);
  const slark = APN_SLARK / (S.enhetSkala || 1);
  const fasader = [], vegger = [], ringmur = [], utspVis = [];

  for (let bi = 0; bi < bein.length; bi++) {
    const akse = bein[bi];
    const beinFi = fi + fasader.length;
    const nx = akse.nx * sg, nz = akse.nz * sg;
    const off = innerveggOffset(akse, sg, tS);
    const rot = Math.atan2(-akse.ez, akse.ex);
    const fx = akse.p.x + nx * off, fz = akse.p.z + nz * off;
    const skjot = samleTetteSoyler(akse.soyler.map(k => tilMm(k.t)), o.minFeltMm);
    const t0 = akse.soyler[0].t, t1 = akse.soyler[akse.soyler.length - 1].t;

    // 🚪 UTSPARINGENE. Kandidatene er både seriens egne (markert inne i
    // innerveggen) og de som er markert med den vanlige «Marker utsparing» —
    // Emil skal ikke måtte huske hvilken knapp han brukte (08.09). Begge sett
    // siles med SAMME regel: veggplanet må gå gjennom åpningsboksen. Da kan en
    // dør i ytterveggen aldri kappe en innervegg, og et bein i en L kan ikke
    // kappes av en dør som står i det andre beinet.
    const fLik = { px: akse.p.x, pz: akse.p.z, ex: akse.ex, ez: akse.ez, nx, nz, t0, t1 };
    const kandidater = [];
    for (const u of (serie.utsparinger || [])) if (u && u.min && u.max) kandidater.push(u);
    for (const u of (globaleUtsp || []))
      if (u && u.min && u.max && kandidater.indexOf(u) === -1) kandidater.push(u);
    const mine = kandidater.filter(u => apningPaVegg(fLik, u, slark) !== null);
    const apninger = utsparingerPaFasade(
      { p: akse.p, ex: akse.ex, ez: akse.ez }, baseY, mine);

    // HJØRNET lappes med del A sin pinwheel-regel (runde 6): det ene beinet
    // løper forbi og dekker naboens endeflate, det andre starter flukt mot
    // naboens innside. Fortegnet leses av NABOENS normal, så et innvendig
    // hjørne (veggen bøyer bort fra panelsiden) trekker seg tilsvarende inn i
    // stedet for å stikke ut i lufta.
    // Frie ender — der det ikke er noe nabobein — er som før: søylesenteret,
    // pluss «Forleng begge ender».
    // Fortegnene er del A sine, ord for ord (runde 6): `sStart` snur fortegnet
    // fordi naboen ligger BAK beinet, `sSlutt` ikke. Peker naboens normal samme
    // vei som beinet løper, er hjørnet utvendig og elementet skal forbi (+off);
    // peker den motsatt, er hjørnet innvendig og elementet skal tilsvarende
    // kortere (−off). Første forsøk her hadde fortegnet snudd i startenden, og
    // det ga et hull på 300 mm i hjørnet — regnet ut, ikke sett.
    const offMm = tilMm(off);
    const sStart = akse.forrigeN
      ? (-Math.sign((akse.forrigeN.x * sg) * akse.ex + (akse.forrigeN.z * sg) * akse.ez) || 1) : 1;
    const sSlutt = akse.nesteN
      ? (Math.sign((akse.nesteN.x * sg) * akse.ex + (akse.nesteN.z * sg) * akse.ez) || 1) : 1;
    // innerveggBiter regner `fra = skjot[0] − eFra` og `til = skjot[siste] + eTil`.
    const eFra = akse.forrigeN ? sStart * offMm - o.tykkelseMm / 2 : (Number(o.endeMm) || 0);
    const eTil = akse.nesteN ? sSlutt * offMm + o.tykkelseMm / 2 : (Number(o.endeMm) || 0);

    const biter = innerveggBiter(skjot, rader, kappIndex, o.klaringMm, SW_MIN_BIT_MM,
      [eFra, eTil], apninger);
    const snappP = [];
    for (const k of akse.soyler) {
      const c = tilMm(k.t), halv = tilMm(k.s.bredde) / 2;
      snappP.push(c - o.klaringMm, c + o.klaringMm, c - halv, c + halv);
    }
    const felles = { fi: beinFi, inner: true, fx, fz, ex: akse.ex, ez: akse.ez, nx, nz, rot,
      tMm: o.tykkelseMm, snapp: snappP };
    for (const b of biter) {
      const tMid = tilScene((b.fraMm + b.tilMm_) / 2);
      vegger.push({ ...felles,
        id: "iv" + (nV + vegger.length), tMid,
        x: fx + akse.ex * tMid, z: fz + akse.ez * tMid,
        y: baseY + tilScene(b.rBunnMm + b.hoydeMm / 2),
        radIdx: b.radIdx, rBunnMm: b.rBunnMm,
        basFraMm: b.fraMm, basTilMm: b.tilMm_, dFra: 0, dTil: 0, rev: 0,
        fraMm: b.fraMm, tilMm: b.tilMm_,
        lengdeMm: b.lengdeMm, fullMm: b.fullMm,
        hoydeMm: b.hoydeMm, radHMm: b.radHMm, hVMm: b.hoydeMm, hHMm: b.hoydeMm,
        apn: b.apn, hull: b.hull,
        tilpassetRad: b.tilpassetRad, tilpasset: b.tilpasset });
    }
    // RINGMUREN UNDER EN INNERVEGG er en fundamentmur fra gulvet og opp, ikke
    // ringmuren rundt bygget: gulvplata og isolasjonen hører til del A og skal
    // ikke lages på nytt inne i bygget.
    if (o.ringmur && biter.length) {
      const rmFra = Math.min(...biter.map(b => b.fraMm));
      const rmTil = Math.max(...biter.map(b => b.tilMm_));
      const rmTopp = 0, rmBunn = -Math.round(tilMm(ringH));
      const rmBit = (bunnMm, hoydeMm, fraMm, tilMm2) => {
        const tMid = tilScene((fraMm + tilMm2) / 2);
        ringmur.push({ ...felles,
          id: "ir" + (nR + ringmur.length), ringmur: true, radIdx: "rm", tMid,
          basFraMm: Math.round(fraMm), basTilMm: Math.round(tilMm2), dFra: 0, dTil: 0, rev: 0,
          fraMm: Math.round(fraMm), tilMm: Math.round(tilMm2),
          lengdeMm: Math.round(tilMm2 - fraMm), fullMm: Math.round(tilMm2 - fraMm),
          bunnMm: Math.round(bunnMm), hoydeMm: Math.round(hoydeMm),
          x: fx + akse.ex * tMid, z: fz + akse.ez * tMid,
          y: baseY + tilScene(bunnMm + hoydeMm / 2),
          lengde: tilScene(tilMm2 - fraMm), hoyde: tilScene(hoydeMm), tykkelse: tS });
      };
      // Ringmuren behandles som en rad: kappes rundt en dør, fyllbit under et
      // vindu (del A, runde 6).
      const rmApn = apninger
        .filter(a => Math.min(a.toppMm, rmTopp) - Math.max(a.bunnMm, rmBunn) > 10);
      for (const [rFra, rTil] of delOppMedUtsparinger(rmFra, rmTil,
          rmApn.map(a => [a.fraMm, a.tilMm_])))
        rmBit(rmBunn, rmTopp - rmBunn, rFra, rTil);
      for (const b of utspFyllBiter(rmBunn, rmTopp, rmFra, rmTil, rmApn, SW_MIN_BIT_MM))
        rmBit(b.bunnMm, b.hoydeMm, b.fraMm, b.tilMm_);
    }
    fasader.push({ px: akse.p.x, pz: akse.p.z, ex: akse.ex, ez: akse.ez, nx, nz,
      t0, t1, off, rot, skjot: skjot.map(v => Math.round(v)), takLinje: null,
      // Oppsettet FØLGER FASADEN. `fi` er indeksen i fasadelista, og faller én
      // serie ut (søylene finnes ikke i denne fila), er den ikke lenger samme
      // indeks som i serier[] — da ville tegningen hentet farge og tykkelse fra
      // feil vegg.
      inner: true,
      navn: (serie.navn || "") + (bein.length > 1 ? " – " + t("bein {0}", bi + 1) : ""),
      o: { ...o }, baseY, okBetong });
    for (const a of apninger)
      utspVis.push({ fi: beinFi, fraMm: Math.round(a.fraMm), tilMm_: Math.round(a.tilMm_),
        bunnMm: Math.round(a.bunnMm), toppMm: Math.round(a.toppMm) });
  }
  return { fasader, vegger, ringmur, utspVis, baseY, okBetong };
}

// SW-NUMRENE FOR INNERVEGGENE — samme funksjon som ytterveggene, over en annen
// liste. Derfor starter de på SW-01 uten et eneste spesialtilfelle: nummeret
// kommer av HVOR I LISTA lengden dukker opp første gang, og innerveggene har
// sin egen liste.
export function innerveggNummer(vegger, kappTekst) {
  const liste = vegger || [];
  const { numre, nokkel } = swNummerering(liste.filter(v => !v.skjult));
  for (const v of liste) {
    if (v.skjult) { v.sw = ""; continue; }
    if (!v.tilpasset) { v.sw = numre.get(nokkel(v)) || "SW-XX"; continue; }
    v.sw = kappNavn(numre.get(nokkel({ lengdeMm: v.fullMm, hoydeMm: v.hoydeMm })), kappTekst);
  }
  return liste;
}

function nummererInner(d) {
  innerveggNummer(d.vegger, (oppsett() || {}).kappTekst || "XX");
}

// Bygger ALLE innerveggene på nytt fra seriene. Kalles etter godkjenning, etter
// sletting, og når et oppsett endres — aldri på egen hånd ved åpning av en fil:
// da tegnes de lagrede tallene, akkurat som del A gjør.
async function byggAlleInnervegger() {
  const d = innerData();
  d.vegger = []; d.ringmur = []; d.fasader = []; d.utspVis = [];
  if (!d.serier.length) return d;
  const alle = await hentSoyler();
  const perId = new Map();
  for (const s of alle) for (const id of s.ider || []) perId.set(id, s);
  const tapte = [];
  d.utspVis = [];
  // De vanlige utsparingene er med som kandidater: Emil skal ikke måtte huske
  // hvilken av de to «Marker utsparing»-knappene han brukte.
  const globale = (oppsett().utsparinger || []).filter(u => u && u.min && u.max);
  for (let i = 0; i < d.serier.length; i++) {
    const serie = d.serier[i];
    const bygd = byggEnInnervegg(serie, perId, d.fasader.length, d.vegger.length,
      d.ringmur.length, globale);
    if (!bygd) { tapte.push(serie.navn || "?"); continue; }
    for (const f of bygd.fasader) {
      f.serieIdx = i;           // hvilken rad i panelet fasaden hører til
      d.fasader.push(f);
    }
    d.vegger.push(...bygd.vegger);
    d.ringmur.push(...bygd.ringmur);
    d.utspVis.push(...bygd.utspVis);
  }
  nummererInner(d);
  d.apnRegel = APN_REGEL;
  if (tapte.length)
    console.warn("Innervegg: fant ikke søylene til " + tapte.join(", ") +
      " — er det samme modellfil?");
  return d;
}

// ---------- Tegning ----------
function tegnInnervegger() {
  const d = lagretInner;
  if (!d || !(d.vegger || []).length) return;
  const sk = d.skjul || {};
  if (sk.vegger) return;
  // Hver innervegg har sin egen farge og tykkelse, så elementene tegnes gruppe
  // for gruppe — ett oppsett per serie.
  const perFi = new Map();
  for (const v of d.vegger) {
    if (!perFi.has(v.fi)) perFi.set(v.fi, []);
    perFi.get(v.fi).push(v);
  }
  const redigeres = innerMark && innerMark.steg === "side" ? innerMark.idx : null;
  for (const [fi, liste] of perFi) {
    if (redigeres !== null && redigeres !== undefined
        && (d.fasader[fi] || {}).serieIdx === redigeres) continue;
    const o = { ...INNER_STD, ...((d.fasader[fi] || {}).o || {}) };
    tegnVeggElementer(liste, o, !sk.merking);
    if (!sk.ringmur)
      tegnRingmurBiter(d.ringmur.filter(r => r.fi === fi), !sk.merking);
  }
  if (!sk.merking && ((lagret && lagret.oppsett) || STD_OPPSETT).visUtsp !== false) {
    try {
      tegnUtspMerkingFor((d.utspVis || []).filter(a => perFi.has(a.fi)),
        d.fasader, d.vegger, innerBaseY(), INNER_STD.tykkelseMm);
    } catch (err) { console.warn("Utsparingsmerkinga for innerveggene:", err); }
  }
}

// 👁 Skjulingen av innerveggene. Samme oppskrift som del A (SKJUL_DELER +
// settSkjul), men over innerveggenes egen lagring — «alt» her betyr alle
// innerveggene, ikke alt på bygget.
const INNER_SKJUL_DELER = [
  { n: "vegger", navn: "Veggelementer" },
  { n: "ringmur", navn: "Ringmur" },
  { n: "merking", navn: "Merking og mål" }
];

function innerSkjulNaa() {
  const d = lagretInner;
  if (!d) return {};
  if (!d.skjul) d.skjul = {};
  return d.skjul;
}

function settInnerSkjul(navn, verdi) {
  const d = lagretInner;
  if (!d) return;
  const sk = innerSkjulNaa();
  if (navn === "alt") for (const del of INNER_SKJUL_DELER) sk[del.n] = verdi;
  sk[navn] = verdi;
  if (navn !== "alt" && !verdi) sk.alt = false;
  if (navn !== "alt") sk.alt = INNER_SKJUL_DELER.every(del => sk[del.n]);
  skrivInner();
  tegnAlt();
  if (S.tegnUtseendePanel) S.tegnUtseendePanel();
}

// ---------- A: markeringsmodus ----------
// { steg: "velg" | "side", serie: {ider, side, o, navn}, idx: number|null,
//   merker: Group, forh: Group, ned: {x,y}|null }
let innerMark = null;

function innerBarEl() {
  let el = $("swInnerBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "swInnerBar";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:64px;" +
      "z-index:40;display:none;gap:6px;align-items:center;background:var(--panel);" +
      "border:1px solid var(--border);border-radius:10px;padding:6px 10px;box-shadow:0 4px 18px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  return el;
}

function tegnInnerBar() {
  const el = innerBarEl();
  // Begge barene står nederst i midten. Står utsparingsmarkeringen på, er den
  // som eier plassen — ellers ville de ligget oppå hverandre.
  if (!innerMark || utspMark) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  const n = innerMark.serie.ider.length;
  if (innerMark.steg === "velg") {
    el.innerHTML =
      '<span style="font-size:12px;max-width:360px">' +
      t("Trykk på søylene innerveggen skal stå på — rekka du vil ha veggelementer langs. Trykk en gang til for å fjerne en søyle.") +
      ' <b>' + t("{0} søyler valgt", n) + '</b></span>' +
      '<button id="swInnerVidere" class="primary" style="padding:3px 10px">' + t("Videre") + '</button>' +
      '<button id="swInnerAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
    $("swInnerVidere").onclick = innerTilSide;
  } else {
    el.innerHTML =
      '<span style="font-size:12px;max-width:340px">' +
      t("Pila viser hvilken side av søylene veggen står på. Still oppsettet i panelet, bytt side om du vil, og godkjenn.") +
      '</span>' +
      '<button id="swInnerBytt" style="padding:3px 10px">↔ ' + t("Bytt side") + '</button>' +
      '<button id="swInnerGodkjenn" class="primary" style="padding:3px 10px">✓ ' + t("Godkjenn") + '</button>' +
      '<button id="swInnerAvbryt" style="padding:3px 10px">' + t("Avbryt") + '</button>';
    $("swInnerBytt").onclick = () => {
      innerMark.serie.side = innerMark.serie.side < 0 ? 1 : -1;
      innerForhandsvis();
    };
    $("swInnerGodkjenn").onclick = innerGodkjenn;
  }
  $("swInnerAvbryt").onclick = () => avsluttInnerMark();
}

async function startInnerMark(idx) {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  if (utspMark) avsluttUtspMark();
  if (just) avsluttJuster();
  const d = innerData();
  const eksisterende = idx !== null && idx !== undefined ? d.serier[idx] : null;
  innerMark = {
    steg: eksisterende ? "side" : "velg",
    idx: eksisterende ? idx : null,
    serie: eksisterende
      ? JSON.parse(JSON.stringify(eksisterende))
      : { ider: [], side: 1, o: { ...d.oppsett },
          navn: t("Innervegg {0}", d.serier.length + 1) },
    merker: new THREE.Group(), forh: new THREE.Group(), ned: null,
    soyler: [], perId: new Map()
  };
  swGroup.add(innerMark.merker, innerMark.forh);
  const oss = innerMark;
  const funnet = await hentSoyler();
  if (innerMark !== oss) return;    // avbrutt mens vi ventet
  innerMark.soyler = funnet;
  innerMark.perId = new Map();
  for (const sø of innerMark.soyler) for (const id of sø.ider || []) innerMark.perId.set(id, sø);
  if (eksisterende) {
    tegnAlt();              // den redigerte veggen tas ut av den faste tegninga
    innerForhandsvis();
    apnePanel("swPanel");
  }
  else { $("swPanel").classList.remove("open"); }
  merkInnerSoyler();
  tegnInnerBar();
  tegnPanel();
}

function avsluttInnerMark() {
  if (!innerMark) return;
  for (const g of [innerMark.merker, innerMark.forh]) {
    g.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    swGroup.remove(g);
  }
  innerMark = null;
  tegnInnerBar();
  // Tegner opp igjen fra lagringen: avbryter Emil en redigering, skal den
  // veggen komme tilbake slik den var godkjent — ikke bli borte til neste gang
  // noe annet tegner.
  tegnAlt();
  tegnPanel();
  apnePanel("swPanel");
}

function innerTilSide() {
  if (!innerMark) return;
  if (innerMark.serie.ider.length < 2) {
    alert(t("Marker minst to søyler — de to ytterste bestemmer veggens retning og lengde."));
    return;
  }
  innerMark.steg = "side";
  innerForhandsvis();
  tegnInnerBar();
  tegnPanel();
  apnePanel("swPanel");
}

// Blå kasse rundt hver markerte søyle — samme språk som flatemerket i
// utsparingsmarkeringen, bare rundt hele søyla.
function merkInnerSoyler() {
  if (!innerMark) return;
  const g = innerMark.merker;
  g.children.slice().forEach(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    g.remove(m);
  });
  const bokser = allElementBoxes();
  for (const id of innerMark.serie.ider) {
    const b = bokser.get(id);
    if (!b) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35,
        depthWrite: false }));
    const vokse = 0.02 / (S.enhetSkala || 1);
    m.scale.set(b.max.x - b.min.x + vokse, b.max.y - b.min.y + vokse, b.max.z - b.min.z + vokse);
    m.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    m.renderOrder = 997;
    g.add(m);
  }
}

// C: forhåndsvisningen — veggen der den faktisk kommer, og PILA som peker på
// siden. Emil skal se svaret før han godkjenner, ikke etterpå.
function innerForhandsvis() {
  if (!innerMark || innerMark.steg !== "side") return;
  const g = innerMark.forh;
  g.children.slice().forEach(m => {
    m.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    g.remove(m);
  });
  const globale = (oppsett().utsparinger || []).filter(u => u && u.min && u.max);
  const bygd = byggEnInnervegg(innerMark.serie, innerMark.perId, 0, 0, 0, globale);
  if (!bygd || !bygd.fasader.length) return;
  innerMark.bygd = bygd;
  const o = { ...INNER_STD, ...(innerMark.serie.o || {}) };
  // Elementene tegnes i EN EGEN gruppe, ikke i swGroup direkte: forhåndsvisningen
  // skal kunne rives uten å røre resten av tegninga.
  const foer = swGroup.children.length;
  tegnVeggElementer(bygd.vegger, o, true);
  tegnRingmurBiter(bygd.ringmur, false);
  const nye = swGroup.children.slice(foer);
  for (const m of nye) { swGroup.remove(m); g.add(m); }
  // Pila: fra søyleaksen og ut mot den valgte siden, midt på hvert bein. Ett
  // hjørne har to bein, og da skal begge pilene peke samme vei ut av rommet —
  // det er hele beviset på at siden ble riktig.
  for (const f of bygd.fasader) {
    const tMid = (f.t0 + f.t1) / 2;
    const start = new THREE.Vector3(f.px + f.ex * tMid,
      bygd.baseY + tilScene(o.veggHoydeMm) * 0.6, f.pz + f.ez * tMid);
    const lengde = Math.max(f.off * 2.5, tilScene(1500));
    const pil = new THREE.ArrowHelper(new THREE.Vector3(f.nx, 0, f.nz).normalize(),
      start, lengde, 0x22c55e, lengde * 0.28, lengde * 0.16);
    pil.renderOrder = 998;
    g.add(pil);
  }
}

async function innerGodkjenn() {
  if (!innerMark) return;
  const d = innerData();
  const serie = JSON.parse(JSON.stringify(innerMark.serie));
  if (innerMark.idx !== null && innerMark.idx !== undefined) d.serier[innerMark.idx] = serie;
  else d.serier.push(serie);
  // Oppsettet den siste veggen fikk blir malen for den neste — Emil skal ikke
  // skrive samme vegghøyde på nytt for hver vegg i samme bygg.
  d.oppsett = { ...d.oppsett, ...serie.o };
  avsluttInnerMark();
  await byggAlleInnervegger();
  byggInnerStabler();      // 📦 leveransestablene og Mengder følger med
  skrivInner();
  tegnAlt();
  tegnPanel();
}

// Bygger innerveggene på nytt fordi den GLOBALE utsparingslista er endret.
// Gjør ingenting når det ikke finnes innervegger — da er dette del A alene.
function oppdaterInnerveggerEtterUtsp() {
  if (!lagretInner || !(lagretInner.serier || []).length) return;
  byggAlleInnervegger()
    .then(() => {
      byggInnerStabler();
      skrivInner();
      tegnAlt();
      tegnPanel();
    })
    .catch(err => console.warn("Innerveggene kunne ikke bygges på nytt:", err));
}

async function slettInnervegg(idx) {
  const d = innerData();
  const s = d.serier[idx];
  if (!s) return;
  if (!confirm(t("Slette «{0}»?", s.navn || "?"))) return;
  d.serier.splice(idx, 1);
  await byggAlleInnervegger();
  byggInnerStabler();
  skrivInner();
  tegnAlt();
  tegnPanel();
}

// Klikkene: samme oppskrift som utsparingsmarkeringen — bare et trykk under
// 8 px behandles, og bare når det landet på lerretet.
window.addEventListener("pointerdown", (e) => {
  if (!innerMark || innerMark.steg !== "velg" || e.button !== 0) return;
  if (e.target !== canvas) { innerMark.ned = null; return; }
  innerMark.ned = { x: e.clientX, y: e.clientY };
}, true);

window.addEventListener("pointerup", (e) => {
  if (!innerMark || innerMark.steg !== "velg" || e.button !== 0 || !innerMark.ned) return;
  if (e.target !== canvas) { innerMark.ned = null; return; }
  const ned = innerMark.ned;
  innerMark.ned = null;
  if (Math.hypot(e.clientX - ned.x, e.clientY - ned.y) > 8) return;   // kameradrag
  e.stopPropagation();
  try { canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId })); }
  catch (_) { try { canvas.dispatchEvent(new Event("pointercancel")); } catch (__) {} }
  const hit = pick(e.clientX, e.clientY);
  const id = hit ? hitID(hit) : null;
  if (id == null) return;
  // BARE SØYLER. Trykker Emil på en bjelke eller en plate, sier baren det i
  // stedet for å ta den med og gi en vegg med gal retning.
  if (!innerMark.perId.has(id)) {
    innerMark.feil = t("Det elementet er ikke en søyle (IfcColumn) — innerveggen står på søyler.");
    tegnInnerBar();
    return;
  }
  innerMark.feil = null;
  const i = innerMark.serie.ider.indexOf(id);
  if (i >= 0) innerMark.serie.ider.splice(i, 1);
  else innerMark.serie.ider.push(id);
  merkInnerSoyler();
  tegnInnerBar();
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && innerMark && !utspMark) { e.stopPropagation(); avsluttInnerMark(); }
}, true);

// ---------- Panelet: 🚪 Innervegger ----------
export function innerOppsettFelter(serie) {
  const s = serie || {};
  const o = { ...INNER_STD, ...(s.o || {}) };
  const utsp = (s.utsparinger || []).filter(u => u && u.min && u.max);
  return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px">' +
    '<b style="font-size:12px">' + esc(s.navn || "") + '</b>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("{0} søyler markert. Still oppsettet, velg side med pila i modellen, og trykk Godkjenn i baren nederst.",
        (s.ider || []).length) + '</p>' +
    '<label>' + t("Navn") + '<input type="text" id="swIvNavn" maxlength="40" value="' +
      esc(s.navn || "") + '"></label>' +
    felt("swIvHoyde", "Vegghøyde over gulv (mm) — topp vegg", o.veggHoydeMm) +
    '<label>' + t("Radhøyder nedenfra (mm) — tom = automatisk") +
      '<input type="text" id="swIvRadH" maxlength="200" value="' + esc(o.radHoyder || "") + '"></label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvKappNed"' +
      (o.kappNederst ? " checked" : "") + '> ' + t("Tilpasningsraden nederst") + '</label>' +
    felt("swIvTykk", "Tykkelse (mm)", o.tykkelseMm) +
    '<label>' + t("Farge") + '<input type="color" id="swIvFarge" value="' + esc(o.farge) + '"></label>' +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvRingmur"' +
      (o.ringmur ? " checked" : "") + '> ' + t("Med ringmur under innerveggen") + '</label>' +
    felt("swIvRingH", "Ringmurhøyde over gulv (mm)", o.ringHoydeMm) +
    felt("swIvEnde", "Forleng frie ender forbi ytterste søyle (mm)", o.endeMm) +
    felt("swIvKlaring", "Klaring fra søylesenter (mm)", o.klaringMm) +
    '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="swIvLukk"' +
      (o.lukk ? " checked" : "") + '> ' + t("Lukk veggen rundt et rom (siste bein tilbake til første søyle)") + '</label>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 8px">' +
      t("Vegghøyden måles fra gulvet til topp vegg. Står veggen på ringmur, er ringmuren en del av den høyden — SW-elementene fyller resten.") + '<br>' +
      t("Frie ender står i første og siste søylesenter. Skal veggen gå helt inn til ytterveggen, skriv hvor mye den skal forlenges — hjørnene lappes av seg selv.") + '<br>' +
      t("Marker søylene rundt hjørnet, og veggen knekker der rekka knekker. Skal den gå helt rundt et rom, kryss av «Lukk veggen».") + '</p>' +
    // 🚪 Utsparingene hører til DENNE veggen, ikke til bygget: to innervegger
    // kan stå rygg mot rygg, og en dør i den ene skal ikke skjære den andre.
    '<h4 style="margin:8px 0 4px;font-size:12px">' + t("Utsparinger i denne veggen") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Trykk «Marker utsparing» og pek på flatene rundt åpningen — innsiden av søylene på hver side, undersiden av bjelken over. Én flate per side.") + '<br>' +
      t("Åpninger du har markert med den vanlige «Marker utsparing» over kommer også med: en åpning kapper den veggen den faktisk står i.") + '</p>' +
    '<div class="prop-actions"><button id="swIvNyUtsp">' + ikon("boks") + ' ' +
      t("Marker utsparing") + '</button></div>' +
    (!utsp.length
      ? '<p style="color:var(--muted);font-size:12px">' + t("Ingen utsparinger i denne veggen.") + '</p>'
      : utsp.map((u, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(u.navn || ("#" + (i + 1))) +
        ' <span style="color:var(--muted)">' +
        Math.round(tilMm(Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2]))) + "×" +
        (u.max[1] - u.min[1] > 1e8 ? t("full høyde") : Math.round(tilMm(u.max[1] - u.min[1])) + " mm") +
        '</span></div>' +
        '<div class="c"><button data-sw-iv-slett-utsp="' + i + '" title="' + t("Slett") +
        '" style="padding:3px 8px">' + ikon("slett") + '</button></div></div>').join("")) +
    '</div>';
}

function innerPanelHtml() {
  const d = innerData();
  const redigerer = innerMark && innerMark.steg === "side";
  // Elementene telles per SERIE, ikke per fasadeindeks: faller én serie ut,
  // er de to ikke lenger de samme tallene.
  const antPer = new Map();
  for (const v of d.vegger) {
    const si = ((d.fasader[v.fi] || {}).serieIdx);
    if (si === undefined) continue;
    antPer.set(si, (antPer.get(si) || 0) + (v.skjult ? 0 : 1));
  }
  // Hvor mange BEIN veggen ble delt i — ett hjørne gir to. Står det 1 der Emil
  // markerte et hjørne, er det knekkgrensa som ikke slo til, og da er tallet
  // det første stedet å se.
  const beinPer = new Map();
  for (const f of d.fasader)
    if (f.serieIdx !== undefined) beinPer.set(f.serieIdx, (beinPer.get(f.serieIdx) || 0) + 1);
  return '<h4 style="margin:14px 0 4px">🚪 ' + t("Innervegger (egen SW-serie)") + '</h4>' +
    '<p style="color:var(--muted);font-size:11px;margin:2px 0 6px">' +
      t("Innerveggene finnes ikke automatisk — du markerer søylene de skal stå på. De får sin egen SW-serie som starter på SW-01, sin egen instruksjonstegning og sitt eget regneark. Ytterveggene over røres ikke.") + '</p>' +
    (d.serier.length
      ? d.serier.map((s, i) =>
        '<div class="qty-row"><div class="n" style="font-size:12px">' + esc(s.navn || ("#" + (i + 1))) +
          ' <span style="color:var(--muted)">' +
          t("{0} søyler", (s.ider || []).length) + " · " +
          ((beinPer.get(i) || 1) > 1 ? t("{0} bein", beinPer.get(i)) + " · " : "") +
          t("{0} element", antPer.get(i) || 0) + " · " +
          (s.o && s.o.veggHoydeMm ? s.o.veggHoydeMm + " mm" : "") + '</span></div>' +
        '<div class="c">' +
          '<button data-sw-inner-endre="' + i + '" title="' + t("Endre") + '" style="padding:3px 8px">✥</button> ' +
          '<button data-sw-inner-slett="' + i + '" title="' + t("Slett") + '" style="padding:3px 8px">' + ikon("slett") + '</button>' +
        '</div></div>').join("")
      : '<p style="color:var(--muted);font-size:12px">' + t("Ingen innervegger ennå.") + '</p>') +
    '<div class="prop-actions"><button id="swInnerNy">' + ikon("boks") + ' ' +
      t("Ny innervegg") + '</button></div>' +
    (redigerer ? innerOppsettFelter(innerMark.serie) : "") +
    (d.vegger.length
      ? '<div class="prop-actions" style="margin-top:8px;flex-wrap:wrap">' +
        '<button id="swInnerTegning">' + ikon("tegning") + ' ' + t("Innervegg: tegning (PDF)") + '</button>' +
        '<button id="swInnerListe">' + ikon("lastned") + ' ' + t("Innervegg: liste (Excel)") + '</button>' +
        '</div>' +
        '<p style="color:var(--muted);font-size:12px;margin-top:4px">' +
          t("{0} innveggselementer i egen serie fra SW-01.", d.vegger.filter(v => !v.skjult).length) +
          " " + t("«✥ Juster elementer» over tar også disse.") + '</p>' +
        '<label>' + t("Tegningsnummer for innerveggene") +
          '<input type="text" id="swIvPdfNr" maxlength="30" value="' + esc(d.oppsett.pdfNr || "SWI-01") + '"></label>'
      : "");
}

function lesInnerFraPanel() {
  if (!innerMark || innerMark.steg !== "side") return;
  const o = innerMark.serie.o = { ...INNER_STD, ...(innerMark.serie.o || {}) };
  const num = (id, std) => { const n = Number(($(id) || {}).value); return isFinite(n) && n >= 0 ? n : std; };
  if ($("swIvNavn")) innerMark.serie.navn = ($("swIvNavn").value || "").trim() || innerMark.serie.navn;
  o.veggHoydeMm = Math.max(200, Math.min(30000, num("swIvHoyde", o.veggHoydeMm)));
  o.radHoyder = (($("swIvRadH") || {}).value || "").trim();
  o.kappNederst = !!($("swIvKappNed") || {}).checked;
  o.tykkelseMm = Math.max(30, Math.min(500, num("swIvTykk", o.tykkelseMm)));
  o.farge = ($("swIvFarge") || {}).value || o.farge;
  o.ringmur = !!($("swIvRingmur") || {}).checked;
  o.ringHoydeMm = Math.max(0, Math.min(3000, num("swIvRingH", o.ringHoydeMm)));
  o.endeMm = Math.max(0, Math.min(3000, num("swIvEnde", o.endeMm)));
  o.klaringMm = Math.max(0, Math.min(100, num("swIvKlaring", o.klaringMm)));
  o.lukk = !!($("swIvLukk") || {}).checked;
}

// Panelets knapper og felter. Kalles fra tegnPanel().
function koblInnerPanel(body) {
  const d = innerData();
  if ($("swInnerNy")) $("swInnerNy").onclick = () => { lesOppsettFraPanel(); startInnerMark(null); };
  body.querySelectorAll("button[data-sw-inner-endre]").forEach(b =>
    b.onclick = () => startInnerMark(Number(b.dataset.swInnerEndre)));
  body.querySelectorAll("button[data-sw-inner-slett]").forEach(b =>
    b.onclick = () => slettInnervegg(Number(b.dataset.swInnerSlett)));
  if ($("swIvPdfNr")) $("swIvPdfNr").onchange = () => {
    d.oppsett.pdfNr = ($("swIvPdfNr").value || "").trim() || "SWI-01";
    skrivInner();
  };
  // Hvert felt i oppsettet tegner forhåndsvisningen på nytt: Emil ser veggen
  // endre seg mens han skriver, i stedet for å måtte godkjenne for å se svaret.
  for (const id of ["swIvHoyde", "swIvRadH", "swIvKappNed", "swIvTykk", "swIvFarge",
                    "swIvRingmur", "swIvRingH", "swIvEnde", "swIvKlaring", "swIvNavn",
                    "swIvLukk"]) {
    const el = $(id);
    if (!el) continue;
    el.onchange = () => { lesInnerFraPanel(); innerForhandsvis(); tegnPanel(); };
  }
  if ($("swIvNyUtsp")) $("swIvNyUtsp").onclick = () => {
    lesInnerFraPanel();
    startUtspMark(true);
  };
  body.querySelectorAll("button[data-sw-iv-slett-utsp]").forEach(b =>
    b.onclick = () => {
      if (!innerMark) return;
      lesInnerFraPanel();
      (innerMark.serie.utsparinger || []).splice(Number(b.dataset.swIvSlettUtsp), 1);
      innerForhandsvis();
      tegnPanel();
    });
  if ($("swInnerListe")) $("swInnerListe").onclick = lastNedInnerListe;
  if ($("swInnerTegning")) $("swInnerTegning").onclick = lastNedInnerTegning;
}

// ---------- E: egen liste og egen tegning ----------
function lastNedInnerListe() {
  const d = innerData();
  const synlige = d.vegger.filter(v => !v.skjult);
  if (!synlige.length) { alert(t("Lag en innervegg først.")); return; }
  // Tykkelsen kan være ulik fra vegg til vegg, så den føres PER ELEMENT i
  // stedet for som ett tall i toppen: to innervegger på 100 og 150 mm skal
  // ikke slås sammen til én kolonne som er feil for begge.
  const a = oppsett();
  const rader = swListeRader(synlige, {
    prosjekt: a.prosjekt, oppdragsnr: a.oppdragsnr, sted: a.sted, sign: a.sign,
    dato: new Date().toLocaleDateString("no-NO"),
    tykkelseMm: [...new Set(synlige.map(v => v.tMm))].join(" / "),
    isolasjon: a.isolasjon, utvFarge: a.utvFarge, innFarge: a.innFarge
  });
  const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  lastNedXlsx(navn + " - SW-liste innervegg.xlsx", t("SW-liste innervegg"), rader)
    .catch(err => {
      console.warn("Innerveggslista kunne ikke lages:", err);
      alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
    });
}

async function lastNedInnerTegning() {
  const d = innerData();
  if (!d.vegger.length || !d.fasader.length) { alert(t("Lag en innervegg først.")); return; }
  const knapp = $("swInnerTegning");
  if (knapp) knapp.disabled = true;
  try {
    const mod = await import("./sw-tegning.js");
    // Oppsettet tegninga får er innerveggenes eget — men bare ÉN tykkelse og
    // ett ringmuroppsett kan stå i tittelfeltet. Den første veggens oppsett
    // brukes, og de andre står med sine egne mål på elementene.
    const so = { ...INNER_STD, ...((d.fasader[0] || {}).o || {}) };
    const o = innerOppsettForListe(so);
    const navnere = new Map();
    const navnFor = (fi) => {
      if (!navnere.has(fi)) navnere.set(fi, akseNavnFor(fi, d.fasader));
      return navnere.get(fi);
    };
    await mod.lastNedTegning({
      vegger: d.vegger,
      fasader: d.fasader,
      oppsett: o,
      utsparinger: d.utspVis || [],
      ringmurBiter: mod.ringmurTilFasader(d.ringmur, d.fasader, tilMm, innerBaseY()),
      tilMm, tilScene,
      stal: await stalPaFasader(d.fasader, o, innerBaseY()),
      aksenavn: (fi, mm) => navnFor(fi)(fi, mm),
      felt: pdfFelt(o, mod.idag()),
      // En innervegg har ingen gesims.
      toppNavn: "Topp vegg",
      hentLogo: () => hentLogo((($("swPdfLogo") || {}).value) || "")
    });
  } catch (err) {
    console.warn("Innervegg-tegning:", err);
    alert(t("Klarte ikke å lage tegninga: ") + (err && err.message || err));
  } finally {
    const b = $("swInnerTegning");
    if (b) b.disabled = false;
  }
}

// SW-basen for innerveggene. Flere innervegger kan i prinsippet stå på ulik
// høyde; stålet og ringmuren projiseres mot den FØRSTE veggens base, som er
// den tegninga er stilt inn etter.
function innerBaseY() {
  const d = lagretInner;
  if (d && (d.fasader || []).length && d.fasader[0].baseY !== undefined) return d.fasader[0].baseY;
  for (const v of (d && d.vegger) || [])
    if (v.rBunnMm !== undefined && v.hoydeMm) return v.y - tilScene(v.rBunnMm + v.hoydeMm / 2);
  return 0;
}

på("btnSW", "click", () => {
  const panel = $("swPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  tegnPanel();
  apnePanel("swPanel");
});
