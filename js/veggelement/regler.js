// 🧮 Regnereglene: konstanter og rene tallfunksjoner uten three.js og uten DOM.
// Dette er laget _test/test-veggelement.mjs prøver mest av — hold det fritt for
// scene, paneler og lagring.
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

import { $, S } from "../state.js";
import { t } from "../i18n.js";
import { allElementBoxes, sumFormel } from "../elements.js";
import { alleElementIder } from "../ifc.js";
import { metaFor, sikreMeta } from "../ifcrpc.js";

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

// 🏔🚪 DET SKRÅKAPPEDE ELEMENTET MINUS HAKKENE — Emils funn 18.09 (bilde 2):
// «veggelement som blir utskjært til saltak blir ikke skjært av utsparring».
//
// Årsaken var ikke regnestykket, men TEGNEMÅTEN. Et skrått element ble tegnet
// som ÉN ExtrudeGeometry med hakket som `holes`, og et hull som stikker UT
// OVER skråkanten kan ikke trianguleres av three.js. Målt på forsidens areal
// ga et trapes på 1,20 m² med et hull som stakk over kanten arealet 1,32 m² —
// STØRRE enn hele elementet. Hullet ble altså ikke tatt bort, det ble til
// overlappende trekanter, og på skjermen sto elementet uskåret.
//
// Derfor deles elementet i BITER i stedet, som det flate elementet alltid har
// gjort (rektMinusHull), bare med skråkanten tatt med:
//
//   1. x deles ved elementets ender, taklinjas knekk og hvert hakks kanter
//   2. i hver x-stripe er hakkene hele stripa bred, så det som står igjen er
//      rene høydebånd
//   3. hvert bånd får overkanten min(båndets topp, overkanten) — så en bit
//      aldri stikker over taket, og hullet aldri utenfor formen
//
// Alt i ELEMENTETS egne mm: x fra venstre ende, y over bunnkanten. Svaret er
// { x0, x1, y0, topp } der `topp` er overkanten som polylinje.
export function skraBiter(lengdeMm, toppPMm, hull, minMm) {
  const L = Number(lengdeMm) || 0;
  const min = Number(minMm) > 0 ? Number(minMm) : 20;
  const P = (toppPMm || []).filter(q => Array.isArray(q) && q.length >= 2);
  if (!(L > 0) || P.length < 2) return [];
  // overkanten lest av ved x
  const y = (x) => {
    if (x <= P[0][0]) return P[0][1];
    if (x >= P[P.length - 1][0]) return P[P.length - 1][1];
    for (let i = 1; i < P.length; i++) if (x <= P[i][0]) {
      const [x0, y0] = P[i - 1], [x1, y1] = P[i];
      return x1 === x0 ? Math.max(y0, y1) : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return P[P.length - 1][1];
  };
  const H = (hull || []).filter(h => h && h.x1 - h.x0 > 0.5 && h.y1 - h.y0 > 0.5);
  const xs = [0, L];
  const se = (x) => { if (x > 0.5 && x < L - 0.5) xs.push(x); };
  for (const q of P) se(q[0]);
  for (const h of H) { se(h.x0); se(h.x1); }
  xs.sort((a, b) => a - b);
  const ut = [];
  for (let i = 1; i < xs.length; i++) {
    const xa = xs[i - 1], xb = xs[i];
    if (xb - xa < 0.5) continue;
    const xm = (xa + xb) / 2;
    // Innenfor stripa er overkanten RETT (stripa er delt ved hvert knekk), og
    // hvert hakk dekker hele stripa i x. Da er det som står igjen høydebånd.
    const hT = Math.max(y(xa), y(xb));
    const sper = H.filter(h => h.x0 <= xm && h.x1 >= xm)
      .map(h => [h.y0, h.y1]).sort((a, b) => a[0] - b[0]);
    const frie = [];
    let p = 0;
    for (const [a, b] of sper) { if (a - p > 0.5) frie.push([p, a]); p = Math.max(p, b); }
    if (hT - p > 0.5) frie.push([p, hT]);
    for (const [ya, yb] of frie) {
      if (yb - ya < min) continue;
      // Båndets overkant er min(båndets tak, elementets overkant): et bånd
      // under skråkanten er flatt, båndet øverst følger taket, og et bånd som
      // taket skjærer gjennom knekker der de møtes.
      const tak = (x) => Math.min(yb, y(x));
      const pkt = [xa];
      const dA = y(xa) - yb, dB = y(xb) - yb;
      if (dA * dB < 0) pkt.push(xa + (xb - xa) * dA / (dA - dB));   // krysningen
      pkt.push(xb);
      // Der overkanten faller under båndets bunn finnes ikke biten. `tak` er
      // monoton i stripa, så det er alltid ÉN ende som må trimmes.
      let a = xa, b = xb;
      const kA = tak(xa) - ya, kB = tak(xb) - ya;
      if (kA < min && kB < min) continue;
      if (kA < min) a = xa + (xb - xa) * (min - kA) / (kB - kA);
      if (kB < min) b = xa + (xb - xa) * (kA - min) / (kA - kB);
      if (b - a < min) continue;
      const topp = [];
      for (const x of pkt) {
        const cx = Math.min(b, Math.max(a, x));
        const ny = [rundMm(cx), rundMm(Math.max(ya + min, tak(cx)))];
        if (!topp.length || Math.abs(topp[topp.length - 1][0] - ny[0]) > 0.5) topp.push(ny);
      }
      if (topp.length < 2) continue;
      ut.push({ x0: rundMm(a), x1: rundMm(b), y0: rundMm(ya), topp });
    }
  }
  return ut;
}

function rundMm(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

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
  const maks = Number(maksAvstand) > 0 ? Number(maksAvstand) : Infinity;

  // Ett aksesteg: nærmeste ubrukte søyle framover langs (ndx, ndz), innenfor
  // sidetoleransen og steglengden.
  const akseSteg = (cur, brukt, len, ndx, ndz, maksL) => {
    let best = -1, bestL = Infinity;
    for (let i = 0; i < n; i++) {
      if (brukt.has(i) && !(i === start && len > 2)) continue;
      const fram = (P[i].u - cur.u) * ndx + (P[i].v - cur.v) * ndz;
      const side = Math.abs((P[i].u - cur.u) * ndz - (P[i].v - cur.v) * ndx);
      if (fram <= 1e-6 || side > lat || fram > maksL) continue;
      if (fram < bestL) { bestL = fram; best = i; }
    }
    return best;
  };
  // Kandidatene fra ett punkt, i FORETRUKKET rekkefølge:
  //   1) aksesteg innenfor maksAvstand — utsiden først, så rett fram, så innover
  //   2) SKRÅTT steg (Valle Båropplager 08.09): en ekte skrå fasade har ingen
  //      søyle langs noen akse. De ubrukte søylene innenfor maksAvstand som ikke
  //      ligger rett bakover, sortert etter hvor lite de svinger mot innsiden
  //      (utsiden holdes på høyre hånd)
  //   3) aksesteg uansett lengde — en gavl kan være bredere enn maksAvstand
  // (dx, dz) er aksen vi sist gikk langs; (hx, hz) den faktiske retningen.
  const kandidater = (cur, brukt, len, dx, dz, hx, hz) => {
    const ut = [], sett = new Set();
    const legg = (i, ndx, ndz, nhx, nhz) => { if (i >= 0 && !sett.has(i)) { sett.add(i); ut.push({ i, dx: ndx, dz: ndz, hx: nhx, hz: nhz }); } };
    const retninger = [[dz, -dx], [dx, dz], [-dz, dx]];
    for (const [ndx, ndz] of retninger) legg(akseSteg(cur, brukt, len, ndx, ndz, maks), ndx, ndz, ndx, ndz);
    const skraa = [];
    for (let i = 0; i < n; i++) {
      if (brukt.has(i) && !(i === start && len > 2)) continue;
      const du = P[i].u - cur.u, dv = P[i].v - cur.v;
      const L = Math.hypot(du, dv);
      if (L < 1e-6 || L > maks) continue;
      const vinkel = Math.atan2(hx * dv - hz * du, hx * du + hz * dv);   // + = venstre = innsiden
      if (Math.abs(vinkel) > Math.PI * 0.75) continue;
      skraa.push({ i, vinkel, du: du / L, dv: dv / L });
    }
    skraa.sort((a, b) => a.vinkel - b.vinkel);
    for (const k of skraa.slice(0, 4)) {
      const ax = Math.abs(k.du) >= Math.abs(k.dv);
      legg(k.i, ax ? (k.du > 0 ? 1 : -1) : 0, ax ? 0 : (k.dv > 0 ? 1 : -1), k.du, k.dv);
    }
    for (const [ndx, ndz] of retninger) legg(akseSteg(cur, brukt, len, ndx, ndz, Infinity), ndx, ndz, ndx, ndz);
    return ut;
  };
  // GYLDIG KONTUR: ingen veggsøyle står UTENFOR den (mer enn `lat` fra randen).
  // Det er dette som skiller en vandring som fulgte randen fra en som skar
  // gjennom bygget — og som lar søket spore tilbake og prøve neste kandidat.
  const gyldig = (rekke) => {
    const poly = rekke.map(i => P[i]);
    const m = poly.length;
    for (let k = 0; k < n; k++) {
      if (rekke.indexOf(k) >= 0) continue;
      const q = P[k];
      let inne = false, naerRand = false;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const a = poly[i], b = poly[j];
        // avstand til kanten
        const ex = b.u - a.u, ev = b.v - a.v, L2 = ex * ex + ev * ev;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((q.u - a.u) * ex + (q.v - a.v) * ev) / L2)) : 0;
        if (Math.hypot(q.u - (a.u + ex * t), q.v - (a.v + ev * t)) <= lat) { naerRand = true; break; }
        if ((a.v > q.v) !== (b.v > q.v) && q.u < (b.u - a.u) * (q.v - a.v) / (b.v - a.v) + a.u) inne = !inne;
      }
      if (!naerRand && !inne) return false;
    }
    return true;
  };
  // Dybde-først med tilbakesporing. Den første lukkede, gyldige konturen
  // vinner — på et rettvinklet bygg er det nøyaktig den gamle stien, fordi
  // aksestegene prøves først. Budsjettet stopper et bygg vandringen ikke
  // forstår; da faller kalleren tilbake på det konvekse hullet som før.
  let budsjett = 4000;
  const rekke = [start], brukt = new Set([start]);
  const dfs = (dx, dz, hx, hz) => {
    if (--budsjett < 0) return false;
    const cur = P[rekke[rekke.length - 1]];
    for (const k of kandidater(cur, brukt, rekke.length, dx, dz, hx, hz)) {
      if (k.i === start) {
        if (rekke.length >= 3 && gyldig(rekke)) return true;
        continue;
      }
      rekke.push(k.i); brukt.add(k.i);
      if (dfs(k.dx, k.dz, k.hx, k.hz)) return true;
      rekke.pop(); brukt.delete(k.i);
      if (budsjett < 0) return false;
    }
    return false;
  };
  return dfs(1, 0, 1, 0) ? rekke : null;
}

// Fasadene langs randen. Samme form som fasaderFra, men konturen kan ha
// innvendige hjørner. Returnerer null når vandringen ikke lukker seg.
// Mer enn så mange grader fra begge aksene i byggets frame = skrå fasade.
export const RAND_SKRA_GRADER = 12;
export function fasaderLangsRand(soyler, latTol, maksAvstand) {
  const rekke = randRekke(soyler, latTol, maksAvstand);
  if (!rekke) return null;
  const R = rekke.map(i => soyler[i]), n = R.length;
  const th = hovedVinkel(soyler, maksAvstand);
  const c = Math.cos(th), sn = Math.sin(th);
  const rot = (x) => ({ u: x.cx * c + x.cz * sn, v: -x.cx * sn + x.cz * c });
  // Retningen mellom hvert nabopar, rundet til nærmeste akse i byggets frame —
  // eller SKRÅ (null) når segmentet står mer enn SKRA_GRADER fra begge aksene.
  // En skrå fasade (Valle Båropplager) får sin egen retning, fra første til
  // siste søyle i løpet, i stedet for å bli snappet til en akse den ikke følger.
  const retn = [];
  for (let i = 0; i < n; i++) {
    const a = rot(R[i]), b = rot(R[(i + 1) % n]);
    const du = b.u - a.u, dv = b.v - a.v;
    const grader = Math.abs(Math.atan2(Math.min(Math.abs(du), Math.abs(dv)), Math.max(Math.abs(du), Math.abs(dv)))) * 180 / Math.PI;
    if (grader > RAND_SKRA_GRADER) retn.push(null);
    else retn.push(Math.abs(du) >= Math.abs(dv) ? (du > 0 ? [1, 0] : [-1, 0]) : (dv > 0 ? [0, 1] : [0, -1]));
  }
  const lik = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  // To skrå segmenter hører til samme løp når det neste punktet ligger innenfor
  // sidetoleransen fra linja gjennom løpets første og siste punkt.
  const paaLinje = (punkter, neste) => {
    const a = punkter[0], b = punkter[punkter.length - 1];
    const dx = b.cx - a.cx, dz = b.cz - a.cz, L = Math.hypot(dx, dz);
    if (L < 1e-9) return true;
    return Math.abs((neste.cx - a.cx) * dz - (neste.cz - a.cz) * dx) / L <= latTol;
  };
  let start = 0;
  for (let i = 0; i < n; i++) {
    const f = retn[(i - 1 + n) % n];
    if (!(lik(retn[i], f) || (retn[i] === null && f === null))) { start = i; break; }
  }
  const lop = [];
  let cur = [R[start]];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n, j = (i + 1) % n;
    cur.push(R[j]);
    const samme = retn[j] === null && retn[i] === null
      ? paaLinje(cur, R[(j + 1) % n])
      : lik(retn[j], retn[i]);
    if (!samme || k === n - 1) { lop.push({ punkter: cur, dd: retn[i] }); cur = [R[j]]; }
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
    let ex, ez;
    if (dd) { ex = dd[0] * c - dd[1] * sn; ez = dd[0] * sn + dd[1] * c; }
    else {
      // skrå løp: retningen fra første til siste søyle
      const a = punkter[0], b = punkter[punkter.length - 1];
      const L = Math.hypot(b.cx - a.cx, b.cz - a.cz) || 1;
      ex = (b.cx - a.cx) / L; ez = (b.cz - a.cz) / L;
    }
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

// HJØRNELAPPEN, som rene tall (mm). Hvor langt forbi (eller kort før) sitt
// søylesenter skal veggen gå i en ende, for å møte NABOVEGGEN slik Moelv-
// tegningen gjør: i sluttenden løper elementet FORBI hjørnet og dekker naboens
// endeflate (helt ut til naboens ytterflate); i startenden stopper det FLUKT
// mot innsiden av forrige vegg. Innvendige hjørner (L-bygg) snus.
//
// Regnet som skjæring mellom denne veggens midtplan (offset `off` fra
// søyleaksen) og naboens flate (offset `offNabo` ± halve tykkelsen). På et rett
// hjørne blir det nøyaktig det gamle «± offNabo + tykkelse/2» — vaskehallen,
// Hegdalringen og de andre rører seg ikke. På et SKRÅTT hjørne (Valle) blir det
// den ekte skjæringen. `nabo` er naboens utover-normal; `f` har ex/ez/nx/nz.
// Alle mål i scene-enheter inn, mm ut.
export function hjorneForlengelse(f, nabo, offNabo, off, tykkelseMm, start) {
  const tS = tilScene(Number(tykkelseMm) || 0);
  const tMm = Number(tykkelseMm) || 0;
  // Uten nabo (en fri ende i et manuelt fasadesett): nøyaktig som før —
  // start trekkes inn med off, slutt løper off forbi.
  if (!nabo) return (start ? -tilMm(off) : tilMm(off)) + tMm / 2;
  const d = nabo.x * f.ex + nabo.z * f.ez;          // naboens normal langs denne veggen
  const nn = nabo.x * f.nx + nabo.z * f.nz;         // … og på tvers av den
  // d > 0: naboens YTTERflate (sluttende: utvendig hjørne, løp forbi;
  //        startende: innvendig hjørne, løp forbi).
  // d < 0: naboens INNERflate (sluttende: innvendig hjørne, stopp kort;
  //        startende: utvendig hjørne, stopp flukt mot innsiden).
  const flate = (Number(offNabo) || 0) + (d > 0 ? tS / 2 : -tS / 2);
  if (Math.abs(d) < 0.2) {
    // nesten parallelle vegger (en liten knekk): ingen skjæring å snakke om —
    // gå halve tykkelsen forbi, så det ikke blir et hull i knekken
    return tMm / 2;
  }
  // skjæringen langs veggen, målt fra hjørnesøyla (negativt = bakover)
  return tilMm((flate - nn * (Number(off) || 0)) / d);
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

export const tilScene = (mm) => (Number(mm) || 0) / 1000 / (S.enhetSkala || 1);
export const tilMm = (u) => (Number(u) || 0) * (S.enhetSkala || 1) * 1000;

// Søylene: IfcColumn-elementer, slått sammen når de står i samme punkt
// (søyle + søyleforlenger er ofte to elementer oppå hverandre — de er ÉN
// søyle for oss, med samlet topp og bunn).
export function soyleTypeNavn(id) {
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

export async function hentSoyler() {
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
  const kjentAkse = (u.akse === "x" || u.akse === "z");
  const akse = kjentAkse ? u.akse : (halvX >= halvZ ? "x" : "z");
  // 🚪 EN DØR VED HJØRNET (Emil 08.09, bilde av «Utsparing 17/18»): boksen rundt
  // en dør er NESTEN KVADRATISK i planet — bredden er ~1000 og dybden er
  // tykkelsen + 2 × slark, også ~1000. Da er det et myntkast hvilken side som
  // er «den lengste», og en åpning fra før aksen ble lagret kunne havne på
  // veggen på tvers. Er aksen ukjent OG boksen så godt som kvadratisk, kan
  // retningen ikke leses av boksen — da avgjør AVSTANDEN (nærmeste vegg
  // vinner, hos kalleren), ikke en gjetning.
  const usikker = !kjentAkse && Math.abs(halvX - halvZ) <= (Number(slark) || 0);
  const langs = akse === "x" ? Math.abs(f.ex) : Math.abs(f.ez);
  if (!usikker && langs < 0.7) return null;     // mer enn 45° på tvers
  const tt = (cx - f.px) * f.ex + (cz - f.pz) * f.ez;
  const t0 = Math.min(f.t0, f.t1), t1 = Math.max(f.t0, f.t1);
  if (tt < t0 - 1 || tt > t1 + 1) return null;
  const avst = Math.abs((cx - f.px) * f.nx + (cz - f.pz) * f.nz);
  const rekkevidde = Math.abs(f.nx) * halvX + Math.abs(f.nz) * halvZ + (Number(slark) || 0);
  return avst > rekkevidde ? null : avst;
}

// HVEM EIER EN GLOBAL ÅPNING? Den veggen som ligger NÆRMEST — akkurat som
// del A avgjør det mellom sine fasader. En innervegg som ender i et hjørne av
// ytterveggen fikk før alle åpninger som traff planet dens, og en dør i
// ytterveggen tett ved hjørnet dukket opp som «Utsparing 17» i innerveggen
// også (Emil 08.09). Nå spørres de andre veggene først: ligger én av dem
// nærmere, er åpningen deres. Svaret er avstanden når `f` eier den, ellers null.
export function eierUtsparing(f, u, andreVegger, slark) {
  const a = apningPaVegg(f, u, slark);
  if (a === null) return null;
  for (const v of andreVegger || []) {
    if (!v || v === f) continue;
    const b = apningPaVegg(v, u, slark);
    if (b !== null && b < a) return null;
  }
  return a;
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

// 🧭 FASADER SATT FOR HÅND (Emil 08.09, punkt 6).
//
// For stålmodeller UTEN søyleforlengere har randvandringen ingenting å følge,
// og da peker Emil ut fasadene selv — med SAMME flyt som innerveggene: «Ny
// fasade» → marker søylene → pila viser siden → Godkjenn. Hjørner håndteres som
// BEIN, nøyaktig som i runde 23: en L eller U markert i én omgang blir flere
// fasader i samme sett. Koden er den samme (`soyleKjede`, `innerveggBein`),
// ikke en kopi — bare siden legges på her, for en fasade har en utside: den
// siden Emil pekte på.
//
// `sett` = [{ ider, side, lukk }], `perId` = søyle-id → søyle (fra hentSoyler).
// Ut: fasader i del A-form ({ p, ex, ez, nx, nz, soyler:[{s,t}], forrigeN,
// nesteN }) — det generer() trenger. Et sett med under to kjente søyler hoppes over.
export function manuelleFasaderFra(sett, perId, knekkGrader) {
  const ut = [];
  for (const m of sett || []) {
    if (!m || !Array.isArray(m.ider)) continue;
    const soyler = [];
    const sett2 = new Set();
    for (const id of m.ider) {
      const sø = perId && perId.get(id);
      if (sø && !sett2.has(sø)) { sett2.add(sø); soyler.push(sø); }
    }
    if (soyler.length < 2) continue;
    const sg = Number(m.side) < 0 ? -1 : 1;
    for (const b of innerveggBein(soyler, knekkGrader, !!m.lukk)) {
      const f = { ...b, nx: b.nx * sg, nz: b.nz * sg,
        forrigeN: b.forrigeN ? { x: b.forrigeN.x * sg, z: b.forrigeN.z * sg } : null,
        nesteN: b.nesteN ? { x: b.nesteN.x * sg, z: b.nesteN.z * sg } : null,
        manuell: true };
      f.toppY = Math.max(...f.soyler.map(k => k.s.maxY));
      f.kolBredde = f.soyler.map(k => k.s.bredde).sort((a, c) => a - c)[Math.floor(f.soyler.length / 2)];
      ut.push(f);
    }
  }
  return ut;
}
// Søylene som inngår i de manuelle fasadene (til OK betong, gulv og toleranser).
export function soylerIFasader(fasader) {
  const sett = new Set();
  for (const f of fasader || []) for (const k of f.soyler || []) sett.add(k.s);
  return [...sett];
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
// ═══════════════════ 🚪 UTSPARINGSTYPER (Emil 08.09, punkt 1) ═══════════════════
// Tre typer: Port, Dør, Vindu. Typen styrer PRESIS TO TING (Emils avkryssing):
//   1. beslag-sidene (Dør/Port: tre sider, ingen i bunnen; Vindu: fire) —
//      det er dette hatprofil-løpemeteren i Materiell regner med
//   2. navnet og merkingen: «Port 1», «Dør 2», «Vindu 3» i panelet, i 3D og
//      på instruksjonstegninga — i stedet for «Utsparing 7»
// Typen styrer IKKE bunnen av åpningen (en port snappes ikke til gulvet) og
// IKKE ringmuren (den kappes der åpningen faktisk når ned i muren).
// 🪟 GLASSFASADE kom som fjerde type 17.09 (Geithus 20653): en glassflate som
// står PÅ BETONGEN og går til topps, ikke et vindu med vegg under. Den ble
// tidligere ført som «Vindu», og da het en 6 × 3 m glassfront «Vindu 1» på
// tegninga — misvisende for den som skal bygge. Den er et RENT VALG: det
// finnes ingen måte å se forskjell på en glassfront og en port i stålet, så
// foreslaUtspType foreslår den aldri. Du trykker deg til den.
export const UTSP_TYPER = ["port", "dor", "vindu", "glass"];
export const UTSP_TYPE_NAVN = { port: "Port", dor: "Dør", vindu: "Vindu", glass: "Glassfasade" };
export function utspTypeNavn(type) { return t(UTSP_TYPE_NAVN[type] || UTSP_TYPE_NAVN.dor); }
export function nesteUtspType(type) {
  const i = UTSP_TYPER.indexOf(type);
  return UTSP_TYPER[(i + 1) % UTSP_TYPER.length];
}
// Beslag rundt åpningen: bare Vindu har fire sider. Den fjerde er kanten på
// veggen UNDER åpningen — og under en port, en dør eller en glassfasade er
// det ingen vegg. Den endelige avgjørelsen tas av geometrien i
// js/sw-blikk.js (et «vindu» som står på gulvet får også tre), men for en
// glassfasade er svaret gitt av typen alene.
export function utspBeslagSider(type) { return type === "vindu" ? 4 : 3; }
// STARTFORSLAGET for en ny åpning (et forslag, ikke en regel — ett trykk
// bytter): bunn mer enn 300 mm over OK betong → Vindu. Ellers Port om bredden
// er ≥ 2500 mm, ellers Dør. Ukjent bunn (ingen OK betong ennå) regnes som gulv.
export const UTSP_VINDU_BUNN_MM = 300;
export const UTSP_PORT_BREDDE_MM = 2500;
export function foreslaUtspType(bunnOverBetongMm, breddeMm) {
  if (Number.isFinite(bunnOverBetongMm) && bunnOverBetongMm > UTSP_VINDU_BUNN_MM) return "vindu";
  return (Number(breddeMm) || 0) >= UTSP_PORT_BREDDE_MM ? "port" : "dor";
}
// Bredde og bunn av en lagret åpning (scene-koordinater) i mm. Bredden er den
// lengste vannrette siden — samme tall som står i panelet.
export function utspBreddeMm(u) { return tilMm(Math.max(u.max[0] - u.min[0], u.max[2] - u.min[2])); }
export function utspBunnOverMm(u, okBetong) {
  return Number.isFinite(okBetong) ? tilMm(u.min[1] - okBetong) : NaN;
}
// Åpninger fra før typene fantes får en type etter startforslaget, og ALLE
// får navn på nytt: «Port 1», «Port 2», «Dør 1» … i den rekkefølgen de ligger
// i lista. Navnet er alltid avledet — det finnes ingen rute å skrive eget navn
// i, så ingenting går tapt ved å regne det ut igjen. Returnerer lista.
export function sikreUtspTyper(liste, okBetong) {
  const teller = {};
  for (const u of liste || []) {
    if (!u || !u.min || !u.max) continue;
    if (!UTSP_TYPER.includes(u.type)) u.type = foreslaUtspType(utspBunnOverMm(u, okBetong), utspBreddeMm(u));
    teller[u.type] = (teller[u.type] || 0) + 1;
    u.navn = utspTypeNavn(u.type) + " " + teller[u.type];
  }
  return liste;
}

export function utsparingerPaFasade(fasade, baseY, liste) {
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
      bunnMm: tilMm(u.min[1] - baseY), toppMm: tilMm(u.max[1] - baseY),
      // typen og navnet følger med til merkingen i 3D og på tegninga
      type: u.type, navn: u.navn
    });
  }
  return ut;
}

// ═══════════════════ GENERERINGEN ═══════════════════

// Alt som tegnes bor i én gruppe, og alt som er generert lagres som rene tall
