// 🏔 TAKFLATA OG TRP-PLATENE — rene tall, runde 3 (Emil 18.09).
//
// Samme form som js/sw-blikk.js og js/sw-materiell.js: ingen three.js, ingen
// DOM, ingen importer fra veggelement-delene. Alt her er regning som kan
// kjøres i Node og måles mot en fasit.
//
// ── HVORFOR DENNE FILA I DET HELE TATT ────────────────────────────────────
// Det finnes INGEN takflate i modellen. `takLinje()` er et 2D-profil langs ÉN
// fasade — den vet hvor høyt taket er over et punkt på veggen, men ikke hvor
// taket ligger ute over bygget. Takflata må derfor bygges, og Emil valgte
// 18.09 at den skal bygges AUTOMATISK AV DE ØVERSTE BJELKENE.
//
// ── RAMMEN ────────────────────────────────────────────────────────────────
// Alt regnes i en egen ramme med to akser:
//
//     u  NED FALLET      — fra møne mot gesims. Taket varierer i høyden langs u.
//     v  LANGS MØNET     — taket er like høyt for alle v.
//
// TRP-platene løper langs u. Det er Emils regel C12 — «de skal legges på tvers
// slik at vann lett renner ned» — og det stemmer med stålet: åsene løper langs
// mønet, og platene ligger på tvers av dem, parallelt med sperrene.
//
// Profilet h(u) er nøyaktig taklinja til GAVLFASADEN, som allerede er regnet
// ut og testet (`takLinje` i regler.js). Vi finner bare ut hvilken fasade som
// ER gavlen: den med størst høydevariasjon. Da er saltak, pulttak og flatt tak
// det samme regnestykket, og det finnes ikke en egen kodevei per taktype som
// kan komme i utakt.

const n = (x) => Number(x) || 0;
const tallEr = (x) => Number.isFinite(Number(x));
export const rund = (x) => Math.round(x * 1000) / 1000;

// Standardverdiene. Alle er settbare felt i panelet — dette er bare det som
// står der før Emil endrer noe.
export const TAK_STD = {
  utstikkGesimsMm: 50,     // hvor langt platene stikker ut over gesimsen
  utstikkGavlMm: 50,       // … og ut over gavlen
  trpBreddeMm: 1030,       // DEKKENDE bredde, altså etter sideoverlappen
  trpBolgeMm: 206,         // én bølge — sideoverlappen er nøyaktig én (prosedyren, steg 2)
  platelengder: "",        // stabelen ned fallet, som radhøydene. Tom = én plate per fall
  endeOverlappMm: 150,     // 10–20 cm ved endeskjøt (prosedyren, steg 6)
  maksLengdeMm: 12000,     // transportgrense — deler fallet når stabelen er tom
  skrueAvstandMm: 450,     // 40–50 cm mellom skruene i skjøten (prosedyren, steg 5)
  flattFallProsent: 0,     // fall på et ellers flatt tak
  // 🔩 Skjøtene hviler på en ås (Emil 21.09). PÅ som standard: en skjøt i
  // løse lufta er ikke et valg noen tar med vilje.
  snapSkjot: true,
  skjotPlanTolMm: 60,
  // 🔄 «Roter takflata 90°» (Emil 21.09, bilde 4)
  rotert: false,
  minHellingProsent: 0.5,  // en bjelke under dette «ligger ikke i fallet»
  retningTolGrader: 5,     // to bjelker «peker samme vei» innenfor dette
  planTolMm: 300,          // … og ligger i samme plan innenfor dette
  minFlateBjelker: 2,      // færre enn dette er et stag, ikke et takfall
  valmTolMm: 50,           // to plan innenfor dette er «like høye» i en valm
  plateOverMm: 10,         // hvor langt platene løftes OPP FRA bjelkas overkant
  fallFasade: "auto"       // "auto" = platene følger bjelkene; ellers fasadenummer
};

// ───────────────────── 1. hvilken vei faller taket? ─────────────────────
//
// Gavlfasaden er den hvis taklinje varierer mest i høyden: på et saltak går
// den fra raft til møne og ned igjen, på en langvegg er den flat. Fallet løper
// LANGS gavlfasaden, mønet på tvers av den.
//
// Er alle linjene flate, finnes det ingen gavl å lese av. Da er taket flatt,
// og Emil må si hvilken vei det skal falle (`fallFasade`) — ellers vet ingen
// hvilken vei vannet skal. Uten et valg tas fasade 0, og panelet sier det.
export function gavlFasade(fasader, tolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : 20;
  let best = -1, bestVar = 0;
  for (let i = 0; i < (fasader || []).length; i++) {
    const L = (fasader[i] || {}).takLinje;
    if (!L || L.length < 2) continue;
    const ys = L.map(q => n(q[1]));
    const v = Math.max(...ys) - Math.min(...ys);
    if (v > bestVar) { bestVar = v; best = i; }
  }
  return bestVar > tol ? { fi: best, variasjon: rund(bestVar), flatt: false }
                       : { fi: -1, variasjon: rund(bestVar), flatt: true };
}

// ═══════ 🏗 FALLRETNINGEN LESES AV BJELKENE (Emils tips 18.09) ═══════
//
// Emils ord: «fallretning blir riktig automatisk så lenge TRP-plater følger
// bjelker, siden de ligger allerede med fall».
//
// Det er en bedre regel enn å lese gavlfasadens taklinje, og den er bedre av
// to grunner:
//
//  1. SPERRA ER FASITEN. Den bærer platene og ligger allerede i takfallet.
//     Leser vi retningen av den, kan takflata per definisjon ikke havne på
//     tvers av det som bærer den.
//  2. FLATT TAK LØSER SEG SELV. Et «flatt» tak har nesten alltid et lite fall,
//     og det ligger i bjelkene. Gavlfasadens taklinje ser flat ut innenfor
//     toleransen, og da måtte Emil velge retning for hånd. Bjelkene vet det.
//
// Hver bjelke oppgis som sin BOKS. En bjelke som ligger med fall stiger fra
// den ene enden til den andre, så boksens høyde er fallet og den lengste
// vannrette aksen er retningen.
export function bjelkeAkse(boks) {
  const b = boks || {};
  const dx = n(b.maxX) - n(b.minX), dz = n(b.maxZ) - n(b.minZ);
  const dy = n(b.maxY) - n(b.minY);
  // 🔎 BOKSENS DIAGONAL ER IKKE BJELKAS AKSE.
  //
  // En bjelke på 12 000 × 200 mm som løper langs x har en boks på 12 000 ×
  // 200. Diagonalen til den boksen peker 0,95° ved siden av x — og 0,95° over
  // et tak på 40 m er 0,7 m feil i den andre enden. Platene ville lagt seg
  // merkbart på skrå av gesimsen.
  //
  // Når den ene vannrette siden er mye kortere enn den andre, ER bjelka langs
  // den lange: en boks på 12 m × 0,2 m kan ikke være noe annet. Først når
  // sidene nærmer seg hverandre — en bjelke som står på skrå i planet — sier
  // diagonalen noe, og da brukes den.
  const lang = Math.max(Math.abs(dx), Math.abs(dz));
  const kort = Math.min(Math.abs(dx), Math.abs(dz));
  let ux, uz, lengde;
  if (lang > 0 && kort / lang <= 0.25) {
    lengde = lang;
    if (Math.abs(dx) >= Math.abs(dz)) { ux = dx < 0 ? -1 : 1; uz = 0; }
    else { ux = 0; uz = dz < 0 ? -1 : 1; }
  } else {
    lengde = Math.hypot(dx, dz);
    if (!(lengde > 1)) return null;
    ux = dx / lengde; uz = dz / lengde;
  }
  if (!(lengde > 1)) return null;
  return { ux, uz, lengdeMm: lengde, fallMm: dy, helling: dy / lengde };
}

// Den rådende fallretningen blant bjelkene som faktisk heller.
//
// Retningen er en AKSE, ikke en pil: en sperre opp mot mønet og en ned igjen
// på den andre siden peker motsatt vei, men ligger i samme akse. Uten å
// normalisere fortegnet ville de to sidene av et saltak nullet hverandre ut,
// og svaret blitt tilfeldig. Derfor vendes hver akse til å peke mot +x (eller
// mot +z når den står på tvers), og bjelkene veies etter lengde — en 12 m
// sperre skal bety mer enn et 1 m avstivningsstag.
export function fallRetningFraBjelker(bokser, minHellingProsent) {
  const grense = tallEr(minHellingProsent) ? Number(minHellingProsent) / 100 : 0.005;
  let sx = 0, sz = 0, vekt = 0, antall = 0, maksHelling = 0;
  for (const b of bokser || []) {
    const a = bjelkeAkse(b);
    if (!a || a.helling < grense) continue;
    // fortegnet normaliseres, ellers kansellerer de to takfallene hverandre
    const snu = (Math.abs(a.ux) > 1e-9 ? a.ux : a.uz) < 0 ? -1 : 1;
    sx += a.ux * snu * a.lengdeMm;
    sz += a.uz * snu * a.lengdeMm;
    vekt += a.lengdeMm;
    antall++;
    maksHelling = Math.max(maksHelling, a.helling);
  }
  if (!antall || !(vekt > 0)) return null;
  const len = Math.hypot(sx, sz);
  if (!(len > 1e-9)) return null;
  return { ux: sx / len, uz: sz / len, antall,
           helling: rund(maksHelling), gjennomsnitt: rund(vekt / antall) };
}

// Rammen (u, v) i verdenskoordinater. `u` peker langs gavlfasaden — altså ned
// fallet — og `v` står vinkelrett på den, langs mønet.
// `bjelkeFall` er svaret fra fallRetningFraBjelker — sendes det inn, er det
// BJELKENE som bestemmer retningen, og fasadene brukes bare som reserve.
export function takRamme(fasader, valgtFi, o, bjelkeFall) {
  const F = fasader || [];
  if (!F.length) return null;
  const g = gavlFasade(F, (o || {}).flattTolMm);
  // Emils valg slår automatikken: velger han en fasade selv, er det den
  // fasadens retning fallet følger.
  //
  // 🔎 `null` ER IKKE ET VALG. Første utgave testet med `tallEr(valgtFi)`, og
  // `Number(null)` er 0 — som er et endelig tall. Standardverdien `null`
  // («finn selv») ble derfor lest som «Emil har valgt fasade 0», automatikken
  // ble aldri brukt, og nedtrekkslista viste «Fasade 1» som om han hadde
  // valgt den. Tomt felt, null og undefined må alle bety det samme her.
  const satt = valgtFi !== null && valgtFi !== undefined && valgtFi !== "";
  const eksplisitt = satt && tallEr(valgtFi) && F[Number(valgtFi)];
  const fi = eksplisitt ? Number(valgtFi) : (g.fi >= 0 ? g.fi : 0);
  const f = F[fi];
  if (!f) return null;
  // 🏗 BJELKENE FØRST. Fant vi en fallretning i stålet, er DEN rammen — med
  // mindre Emil har pekt ut en fasade selv. Fasaderetningen står igjen som
  // reserve for modeller uten bjelker vi kjenner igjen.
  const fraStal = !eksplisitt && bjelkeFall && bjelkeFall.antall > 0;
  const ux = fraStal ? bjelkeFall.ux : n(f.ex);
  const uz = fraStal ? bjelkeFall.uz : n(f.ez);
  return {
    fi, flatt: g.flatt && !fraStal, variasjon: g.variasjon,
    fraStal: !!fraStal, bjelker: fraStal ? bjelkeFall.antall : 0,
    px: n(f.px), pz: n(f.pz),
    ux, uz,                        // ned fallet
    vx: -uz, vz: ux,               // langs mønet, vinkelrett på fallet
    profil: (f.takLinje && f.takLinje.length >= 2) ? f.takLinje.map(q => [n(q[0]), n(q[1])]) : null
  };
}

// Et punkt i verden → (u, v) i rammen, i samme enhet som punktet.
export function tilUV(ramme, x, z) {
  const dx = n(x) - ramme.px, dz = n(z) - ramme.pz;
  return [dx * ramme.ux + dz * ramme.uz, dx * ramme.vx + dz * ramme.vz];
}
// … og tilbake.
export function fraUV(ramme, u, v) {
  return {
    x: ramme.px + ramme.ux * n(u) + ramme.vx * n(v),
    z: ramme.pz + ramme.uz * n(u) + ramme.vz * n(v)
  };
}

// ───────────────────── 2. hvor stort er taket? ─────────────────────
//
// Omrisset regnes av PUNKTENE fra de øverste bjelkene (Emils valg 18.09), lagt
// ut i rammen og strukket til et rektangel. Rektangel og ikke konveks hylle
// med vilje: et tak ER et rektangel i byggets egen ramme på så godt som alle
// bygg, og en hylle rundt bjelkeender som stikker litt ulikt ut ville gitt en
// flate med skjeve kanter som ingen plate kan legges på.
//
// `utGesimsMm` legges på i u (nedover fallet, mot gesimsen i begge ender) og
// `utGavlMm` i v (ut over gavlene).
export function takRektangel(punkterUV, utGesimsMm, utGavlMm) {
  const P = (punkterUV || []).filter(p => p && tallEr(p[0]) && tallEr(p[1]));
  if (!P.length) return null;
  const us = P.map(p => Number(p[0])), vs = P.map(p => Number(p[1]));
  const ug = n(utGesimsMm), vg = n(utGavlMm);
  return {
    u0: Math.min(...us) - ug, u1: Math.max(...us) + ug,
    v0: Math.min(...vs) - vg, v1: Math.max(...vs) + vg,
    // stålets egen utstrekning, uten utstikk — 3D-en tegner gesimsen med den
    su0: Math.min(...us), su1: Math.max(...us),
    sv0: Math.min(...vs), sv1: Math.max(...vs)
  };
}

// ───────────────────── 3. høyden over et punkt ─────────────────────
//
// Profilet er taklinja: [[u, h], …] i mm.
//
// 🔎 UTENFOR ENDEPUNKTENE FORTSETTER FALLET. Dette er forskjellen fra veggens
// `takHoyde` i regler.js, som HOLDER endeverdien — og forskjellen er ikke
// pirk. Første utgave her holdt verdien, og da ble takutstikket på 300 mm en
// VANNRETT stripe utenfor raftet: et saltak kom ut som FIRE flater i stedet
// for to, med to flate remser hengende utenfor gesimsen. Ingen test fanget
// det; det kom fram første gang tallene ble sett på.
//
// På et ekte tak stikker platene ut forbi gesimsen i SAMME fall som resten —
// det er hele poenget med et utstikk. Derfor forlenges den ytterste
// strekningen i stedet.
export function takHoyde(profil, uMm, flattHoydeMm) {
  const L = profil || [];
  if (L.length < 2) return n(flattHoydeMm);
  const u = n(uMm);
  if (u <= L[0][0]) {
    const [x0, y0] = L[0], [x1, y1] = L[1];
    return x1 === x0 ? n(y0) : n(y0) + (n(y1) - n(y0)) * (u - x0) / (x1 - x0);
  }
  if (u >= L[L.length - 1][0]) {
    const [x0, y0] = L[L.length - 2], [x1, y1] = L[L.length - 1];
    return x1 === x0 ? n(y1) : n(y0) + (n(y1) - n(y0)) * (u - x0) / (x1 - x0);
  }
  for (let i = 1; i < L.length; i++) if (u <= L[i][0]) {
    const [x0, y0] = L[i - 1], [x1, y1] = L[i];
    return x1 === x0 ? Math.max(n(y0), n(y1)) : n(y0) + (n(y1) - n(y0)) * (u - x0) / (x1 - x0);
  }
  return n(L[L.length - 1][1]);
}

// ───────────────────── 4. takflata som PLANE FLATER ─────────────────────
//
// Dette er kjernen. Taket deles i én flate per RETT STREKNING i profilet:
//
//     flatt tak   → 1 flate
//     pulttak     → 1 flate
//     saltak      → 2 flater, én per takfall
//     mansard     → like mange som profilet har knekk
//
// Hver flate er et plan, og det er nettopp derfor delingen er verdt å gjøre:
// en TRP-plate er stiv og kan bare ligge i ett plan. Flatene er de flatene
// platene senere legges på, én runde om gangen.
//
// Et flatt tak med fall settes av `flattFallProsent`: profilet lages da selv,
// fra høy ende ved u0 til lav ende ved u1.
export function takFlater(rekt, profil, o) {
  if (!rekt) return [];
  const opp = { ...TAK_STD, ...(o || {}) };
  const L = byggProfil(rekt, profil, opp);
  const ut = [];
  for (let i = 1; i < L.length; i++) {
    const [ua, ha] = L[i - 1], [ub, hb] = L[i];
    if (ub - ua <= 1) continue;
    const fallMm = ha - hb;                      // positivt = det faller nedover u
    const lengdeMm = Math.hypot(ub - ua, fallMm); // den SKRÅ lengden — platene ligger i planet
    ut.push({
      u0: ua, u1: ub, v0: rekt.v0, v1: rekt.v1,
      h0: ha, h1: hb,
      lengdeMm: rund(lengdeMm),                  // ned fallet, i planet
      breddeMm: rund(rekt.v1 - rekt.v0),         // langs mønet
      fallGrader: rund(Math.atan2(fallMm, ub - ua) * 180 / Math.PI),
      arealM2: rund(lengdeMm * (rekt.v1 - rekt.v0) / 1e6)
    });
  }
  return ut;
}

// Profilet klippet og forlenget til takrektangelet. Et flatt tak får sitt eget
// profil av fallprosenten, så resten av koden slipper å vite om taktypen.
export function byggProfil(rekt, profil, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const L = (profil || []).filter(q => q && tallEr(q[0]) && tallEr(q[1]))
    .map(q => [Number(q[0]), Number(q[1])]).sort((a, b) => a[0] - b[0]);
  const hFlat = L.length ? Math.max(...L.map(q => q[1])) : n(opp.flattHoydeMm);
  if (L.length < 2) {
    const fall = (rekt.u1 - rekt.u0) * n(opp.flattFallProsent) / 100;
    return [[rekt.u0, hFlat], [rekt.u1, hFlat - fall]];
  }
  // knekkene INNENFOR rektangelet, pluss endene lest av profilet
  const xs = [rekt.u0];
  for (const [u] of L) if (u > rekt.u0 + 1 && u < rekt.u1 - 1) xs.push(u);
  xs.push(rekt.u1);
  const P = xs.map(u => [u, takHoyde(L, u, hFlat)]);
  // 🔎 ET PUNKT SOM IKKE ER ET KNEKK SKAL BORT. Raftet er et knekkpunkt i
  // VEGGENS taklinje — der slutter veggen — men på TAKET løper fallet rett
  // gjennom det og videre ut i utstikket. Lot vi punktet stå, ble hvert
  // utstikk en egen flate, og saltaket kom ut som fire flater i stedet for to.
  // Samme opprydding som takTopp() gjør i regler.js.
  for (let i = P.length - 2; i > 0; i--) {
    const [x0, y0] = P[i - 1], [x1, y1] = P[i], [x2, y2] = P[i + 1];
    const paa = x2 === x0 ? y0 : y0 + (y2 - y0) * (x1 - x0) / (x2 - x0);
    if (Math.abs(y1 - paa) < 1) P.splice(i, 1);
  }
  return P;
}

// Summen — det som står i panelet og i arket.
export function takTotaler(flater) {
  const F = flater || [];
  return {
    flater: F.length,
    arealM2: rund(F.reduce((a, f) => a + n(f.arealM2), 0)),
    lengsteFallMm: F.reduce((a, f) => Math.max(a, n(f.lengdeMm)), 0),
    moneHoydeMm: F.reduce((a, f) => Math.max(a, n(f.h0), n(f.h1)), 0)
  };
}

// ═══════════════════ 5. TRP-PLATENE ═══════════════════
//
// Reglene er lest rett ut av Emils «Prosedyre for montasje av TRP-takplate»
// (18.09), og står her med sitatet ved siden av tallet:
//
//   · SIDEOVERLAPP = ÉN BØLGE. Steg 2: «Skjøt takplaten sammen ved å overlappe
//     dem (1 bølge i overlapp)». Derfor er `trpBreddeMm` den DEKKENDE bredden
//     — bølgen i overlappen er allerede trukket fra, og det er dekkende bredde
//     man bestiller etter.
//   · ENDESKJØT = 10–20 CM. Steg 6: «for å skjøte riktig må du skjøte over …
//     med 10-20 CM på langsidene». Standard 150 mm, settbart.
//   · SKRUER I SKJØTEN CA. 40–50 CM. Steg 5: «skrur inn resten av skruene som
//     skal på skjøtene (ca 40-50 cm avstand mellom skruene)». Standard 450 mm.
//
// 🔎 ÉN UKLARHET, SAGT HØYT I STEDET FOR GJETTET: parentesen i steg 6 sier
// «en bølge på kortsidene og 10-20 CM på langsidene». Leser man den bokstavelig
// er det motsatt av steg 2, der tre plater legges SIDE VED SIDE med én bølge i
// overlapp. En plate er lang ned fallet, så to naboplater deler den LANGE
// kanten. Koden følger steg 2 — side ved side = én bølge, ende mot ende =
// 10–20 cm — fordi steg 2 er utvetydig om hva som legges hvordan. Emil bør
// bekrefte at ordene i parentesen er byttet om, ikke regelen.

// Stabelen ned fallet, ord for ord som radhøydene i SW-generatoren (Emils valg
// 18.09): «6000, 6000, 3000» fra gesimsen og oppover. Siste lengde gjentas
// hvis fallet er lengre. Tom streng = automatisk.
export function parsePlatelengder(tekst) {
  return String(tekst || "").split(/[,;\s]+/)
    .map(x => Math.round(Number(x.replace(",", "."))))
    .filter(x => Number.isFinite(x) && x > 0);
}

// Platene NED ETT FALL. Svaret er lengdene fra gesimsen og opp mot mønet.
//
// Emils valg 18.09 på skjøtene: «1 er riktig» — skjøten går i rett linje, og
// den ØVERSTE plata beholder full lengde. Kappet havner altså nederst, ved
// gesimsen, der det er lettest å komme til.
//
// Hver skjøt koster `endeOverlappMm`: to plater à 6000 med 150 mm overlapp
// dekker 11 850, ikke 12 000. Det er den feilen som ellers ville gitt for lite
// materiell bestilt.
export function platerNedFall(fallengdeMm, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const L = n(fallengdeMm);
  if (!(L > 0)) return [];
  const ov = Math.max(0, n(opp.endeOverlappMm));
  const stabel = parsePlatelengder(opp.platelengder);
  const maks = Math.max(100, n(opp.maksLengdeMm));

  // 1) Ingen stabel: del i så få plater som mulig innenfor maks lengde.
  if (!stabel.length) {
    if (L <= maks) return [{ lengdeMm: Math.round(L), kappet: false }];
    // n plater dekker n*lengde − (n−1)*overlapp. Finn minste n som når fram.
    let ant = 2;
    while (ant * maks - (ant - 1) * ov < L && ant < 200) ant++;
    const hver = (L + (ant - 1) * ov) / ant;
    return Array.from({ length: ant }, () => ({ lengdeMm: Math.round(hver), kappet: true }));
  }

  // 2) Med stabel: legg lengdene fra GESIMSEN og oppover, siste gjentas.
  //    Den øverste plata beholder full lengde (Emils valg), så det er den
  //    NEDERSTE som kappes når stabelen ikke går opp.
  const ut = [];
  let dekket = 0, i = 0;
  while (dekket < L - 1 && ut.length < 200) {
    const lengde = stabel[Math.min(i, stabel.length - 1)];
    ut.push({ lengdeMm: lengde, kappet: false });
    dekket += ut.length === 1 ? lengde : lengde - ov;
    i++;
  }
  if (!ut.length) return [];
  // Overskytende kappes av den NEDERSTE plata — skjøtene ligger da i rett
  // linje der stabelen sier, og det er mønet som er fast (steg 4: plata føres
  // på plass i riktig avstand i henhold til arbeidstegning).
  const over = dekket - L;
  if (over > 0) {
    const nederst = ut[0];
    const ny = nederst.lengdeMm - over;
    if (ny > 20) { nederst.lengdeMm = Math.round(ny); nederst.kappet = true; }
    else { ut.shift(); }        // den ble for kort til å være en plate i det hele tatt
  }
  // 🔎 EN STABEL SOM IKKE GÅR OPP. «6000, 6000» på et fall på 12 000 ser ut til
  // å passe, men gjør det ikke: overlappen spiser 150 mm, så to plater dekker
  // 11 850. Da trengs en tredje, og den nederste blir stående igjen på 300 mm.
  // Regnestykket er riktig — men 300 mm er ingen plate noen monterer.
  //
  // Vi kapper den IKKE bort i det stille (da mangler det 300 mm tak) og vi
  // later ikke som det går opp. Plata merkes `kort`, og panelet sier fra at
  // stabelen bør justeres. Det er Emils tall, og han skal få vite at de ikke
  // går opp — ikke oppdage det på taket.
  for (const p of ut) if (p.lengdeMm < MIN_PLATE_MM) p.kort = true;
  return ut;
}

// ═══════ 🔩 SKJØTENE FLYTTES NED PÅ ÅSENE (Emil 21.09) ═══════
//
// «takplatene skal skjøtes på hver toppbjelke, men det er masse små plater
// som henger i løse lufta.»
//
// Stabelen Emil taster er et ØNSKE om hvor skjøtene skal ligge. Her flyttes
// hver av dem til nærmeste ås, og lengdene leses av der skjøtene faktisk
// havnet. Det er åsene som bestemmer — de er det eneste som kan skrus i.
//
// Åsen ligger UNDER overlappen, så den nederste plata slutter `ov/2` over
// åsen og den øverste starter `ov/2` under den. Da dekker platene fallet
// nøyaktig, og skruene i skjøten treffer stål.
//
//   · `skjot` er avstandene opp fallet, målt fra den LAVE enden.
//   · To skjøter kan ikke havne på samme ås — da hadde en plate fått lengde 0.
//   · Finnes det INGEN ås inne i fallet, kan det ikke skjøtes i det hele tatt.
//     Da blir det én plate, og panelet sier fra. Å late som noe annet er å
//     sende en montør opp med plater han ikke får festet.
// Åsene som FAKTISK kan bære en skjøt på denne flata: målt opp fallet fra den
// lave enden, og uten dem som ligger så nær en kant at plata ville blitt en
// strimmel. Panelet og snappingen leser den SAMME funksjonen — ellers kunne
// panelet listet en ås som snappingen så bort fra.
export function indreAser(flate, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate || !Array.isArray(flate.skjotU)) return [];
  const L = n(flate.lengdeMm);
  const kant = Math.max(MIN_PLATE_MM, Math.max(0, n(opp.endeOverlappMm)));
  return [...new Set(flate.skjotU.map(u => rund(n(u) - n(flate.u0))))]
    .filter(u => u > kant && u < L - kant).sort((a, b) => a - b);
}

export function snapSkjoterTilAser(plater, fallengdeMm, skjot, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const L = n(fallengdeMm);
  const ov = Math.max(0, n(opp.endeOverlappMm));
  const P = (plater || []).filter(Boolean);
  if (!(L > 0) || P.length <= 1) return P;
  const kant = Math.max(MIN_PLATE_MM, ov);
  const indre = [...new Set((skjot || []).map(x => rund(n(x))))]
    .filter(u => u > kant && u < L - kant).sort((a, b) => a - b);
  if (!indre.length)
    return [{ lengdeMm: Math.round(L), kappet: true, ingenAas: true }];

  // hvor stabelen VILLE lagt skjøtene, målt fra den lave enden
  const onsket = [];
  let s = 0;
  for (let i = 0; i < P.length - 1; i++) { s += n(P[i].lengdeMm) - (i ? ov : 0); onsket.push(s); }

  // nærmeste ledige ås til hver — nærmeste ønske først, så den som treffer
  // best får velge før de andre
  const rest = indre.slice();
  const valgt = [];
  for (const u of onsket.slice().sort((a, b) =>
      minAvstand(a, indre) - minAvstand(b, indre))) {
    if (!rest.length) break;
    let beste = 0;
    for (let i = 1; i < rest.length; i++)
      if (Math.abs(rest[i] - u) < Math.abs(rest[beste] - u)) beste = i;
    valgt.push(rest.splice(beste, 1)[0]);
  }
  valgt.sort((a, b) => a - b);

  const ut = [];
  let forrige = 0;
  for (let i = 0; i <= valgt.length; i++) {
    const topp = i < valgt.length ? valgt[i] + ov / 2 : L;
    const lengde = topp - forrige;
    if (lengde > 20) ut.push({ lengdeMm: Math.round(lengde), kappet: true, paaAas: i < valgt.length });
    forrige = (i < valgt.length ? valgt[i] - ov / 2 : L);
  }
  for (const p of ut) if (p.lengdeMm < MIN_PLATE_MM) p.kort = true;
  return ut.length ? ut : P;
}
function minAvstand(u, liste) {
  return liste.reduce((a, k) => Math.min(a, Math.abs(k - u)), Infinity);
}

// Kortere enn dette er ikke en plate, det er en strimmel.
export const MIN_PLATE_MM = 500;

// Hele takfallet delt i plater: én rad per platebredde langs mønet, hver med
// sine lengder ned fallet.
//
// Bredden: dekkende bredde per plate, og den siste raden kappes på langs når
// taket ikke går opp i hele plater. Det er slik det gjøres — man kapper den
// siste plata i bredden, ikke alle litt.
export function platerPaFlate(flate, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate) return null;
  const bredde = n(flate.breddeMm), fall = n(flate.lengdeMm);
  const pb = Math.max(50, n(opp.trpBreddeMm));
  if (!(bredde > 0) || !(fall > 0)) return null;
  const hele = Math.floor(bredde / pb);
  const rest = Math.round(bredde - hele * pb);
  let nedFall = platerNedFall(fall, opp);
  // 🔩 Skjøtene ned på åsene (Emil 21.09). Flata bærer sine egne åser i
  // `skjotU` — absolutte u-verdier — og her måles de fra den LAVE enden, som
  // er u0: det er der platestabelen starter.
  if (opp.snapSkjot !== false && Array.isArray(flate.skjotU))
    nedFall = snapSkjoterTilAser(nedFall, fall, indreAser(flate, opp), opp);
  // hver plate med sin egen strekning langs u, fra den LAVE enden og oppover
  const ov2 = Math.max(0, n(opp.endeOverlappMm));
  let s2 = 0;
  const medU = nedFall.map(p => {
    const uFra = n(flate.u0) + s2, uTil = uFra + p.lengdeMm;
    s2 += p.lengdeMm - ov2;
    return { ...p, uFra: rund(uFra), uTil: rund(uTil) };
  });
  const rader = [];
  for (let i = 0; i < hele; i++)
    rader.push({ vFra: rund(flate.v0 + i * pb), breddeMm: pb, kappetBredde: false, plater: medU });
  if (rest > 20)
    rader.push({ vFra: rund(flate.v0 + hele * pb), breddeMm: rest, kappetBredde: true, plater: medU });
  // skjøter: én endeskjøt mindre enn antall plater, per rad
  const endeskjoter = rader.length * Math.max(0, nedFall.length - 1);
  // sideskjøter: én mellom hvert par naborader
  const sideskjoter = Math.max(0, rader.length - 1);
  return {
    ...flate, rader,
    antallPlater: rader.reduce((a, r) => a + r.plater.length, 0),
    endeskjoter, sideskjoter,
    // skjøtlengde i lm: sideskjøtene løper ned fallet, endeskjøtene langs mønet
    skjotLm: rund((sideskjoter * fall + endeskjoter * pb) / 1000)
  };
}

// Alle flatene, med lista Emil bestiller etter.
//
// C16: platene skal ha «lengde + navn, trenger ikke nummerering». Navnet er
// derfor lengden selv — «TRP 6000» — og like plater slås sammen til én rad med
// antall. Det er slik en bestilling ser ut.
export function trpListe(flater, o, medPlaterInn) {
  const opp = { ...TAK_STD, ...(o || {}) };
  // Er platene allerede regnet (og håndjustert), brukes DE — lista og
  // tegningen skal aldri regne hver sin gang.
  const medPlater = medPlaterInn || platerPaTaket(flater, opp);
  const perType = new Map();
  let arealM2 = 0, antall = 0, skjotLm = 0;
  for (const f of medPlater) {
    arealM2 += n(f.arealM2);
    skjotLm += n(f.skjotLm);
    for (const r of f.rader) for (const p of r.plater) {
      const navn = "TRP " + p.lengdeMm + (r.kappetBredde ? " (" + r.breddeMm + " mm)" : "");
      const e = perType.get(navn) || { navn, lengdeMm: p.lengdeMm, breddeMm: r.breddeMm, antall: 0 };
      e.antall++;
      perType.set(navn, e);
      antall++;
    }
  }
  const skrueAvst = Math.max(50, n(opp.skrueAvstandMm));
  const korte = medPlater.reduce((a, f) =>
    a + f.rader.reduce((b, r) => b + r.plater.filter(p => p.kort).length, 0), 0);
  return {
    plater: [...perType.values()].sort((a, b) => b.lengdeMm - a.lengdeMm || a.breddeMm - b.breddeMm),
    antall, arealM2: rund(arealM2), skjotLm: rund(skjotLm),
    // sagt fra om, ikke skjult bort — se platerNedFall
    korte, advarsel: korte > 0,
    // «ca 40-50 cm avstand mellom skruene» langs hver skjøt (prosedyren, steg 5)
    skruer: Math.ceil(skjotLm * 1000 / skrueAvst)
  };
}

// Radene i arket «Tak».
export const TAK_RADER = [
  ["Takflater", "flater"],
  ["Takareal (m²)", "arealM2"],
  ["Antall TRP-plater", "antall"],
  ["Skjøt (lm)", "skjotLm"],
  ["Skrue skjøt (stk)", "skruer"]
];

// ═══════ 🏗 TAKFLATER BYGGET AV BJELKENE (Emil 18.09, «Automatisk») ═══════
//
// Emils ord: «alle problem med fall løser seg hvis vi greier å få TRP til å
// legge seg på toppen av bjelke, så la oss fokusere på å få den funksjonen
// til å funke.»
//
// ── HVORFOR HELE MODELLEN OVER MÅTTE FÅ ET ALTERNATIV ────────────────────
// Modellen med ÉN fallretning u og et profil h(u) strukket langs mønet klarer
// saltak, pulttak og flatt tak. Den klarer IKKE et valmtak: der faller taket i
// FIRE retninger, og et profil langs én akse kan ikke beskrive det uansett hvor
// godt retningen gjettes. Emils testbygg er nettopp et slikt tak — «bygget vi
// tester mot nå har fall 2 veier istedenfor 1» — og resultatet var én stor
// skjev flate som stakk langt utenfor bygget.
//
// Her er regelen snudd: vi gjetter ingen retning i det hele tatt. Hver BJELKE
// bærer sin egen retning og sitt eget fall, og bjelker som ligger parallelt og
// i samme plan ER ett takfall. Da faller alt ut av seg selv:
//
//     pulttak  → 1 gruppe      saltak  → 2 grupper
//     valmtak  → 4 grupper     pult+valm, tilbygg, ulike fall → like mange
//
// Ingen taktype er kodet inn noe sted. Det er nettopp poenget.

// Bjelkas overkant som en linje i rommet, fra LAV til HØY ende.
// `punkter` er bjelkas hjørner/toppunkter: [[x, y, z], …] i mm.
export function bjelkeLinje(punkter) {
  const P = (punkter || []).filter(p => p && p.length >= 3);
  if (P.length < 2) return null;
  const xs = P.map(p => n(p[0])), zs = P.map(p => n(p[2]));
  const dx = Math.max(...xs) - Math.min(...xs);
  const dz = Math.max(...zs) - Math.min(...zs);
  if (Math.max(dx, dz) < 1) return null;
  // langs den dominerende vannrette aksen
  const langsX = dx >= dz;
  const t = (p) => langsX ? n(p[0]) : n(p[2]);
  const tMin = Math.min(...P.map(t)), tMax = Math.max(...P.map(t));
  const spenn = tMax - tMin;
  if (!(spenn > 1)) return null;
  // overkanten i hver ende: det HØYESTE punktet i den ytterste tidelen
  const kant = Math.max(spenn * 0.1, 1);
  const ende = (naer) => {
    const nre = P.filter(p => naer ? t(p) <= tMin + kant : t(p) >= tMax - kant);
    const br = nre.length ? nre : P;
    let best = br[0];
    for (const p of br) if (n(p[1]) > n(best[1])) best = p;
    return { x: n(best[0]), y: n(best[1]), z: n(best[2]) };
  };
  const a = ende(true), b = ende(false);
  // fra LAV til HØY, så retningen alltid peker oppover fallet
  const [lav, hoy] = a.y <= b.y ? [a, b] : [b, a];
  const lx = hoy.x - lav.x, ly = hoy.y - lav.y, lz = hoy.z - lav.z;
  const lengde = Math.hypot(lx, ly, lz);
  if (!(lengde > 1)) return null;
  const vannrett = Math.hypot(lx, lz);
  return {
    lav, hoy, lengdeMm: lengde,
    ux: lx / lengde, uy: ly / lengde, uz: lz / lengde,     // opp fallet, i rommet
    helling: vannrett > 0 ? ly / vannrett : 0
  };
}

// To bjelker hører til SAMME takflate når de peker samme vei i rommet OG
// ligger i samme plan. Retningen alene er ikke nok: to parallelle takfall på
// hver sin side av et tilbygg peker likt, men er to flater.
export function sammeTakflate(a, b, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const vinkelTol = Math.cos((n(opp.retningTolGrader) || 5) * Math.PI / 180);
  const planTol = n(opp.planTolMm) || 300;
  const prikk = a.ux * b.ux + a.uy * b.uy + a.uz * b.uz;
  if (prikk < vinkelTol) return false;
  // planet: normalen er u × (vannrett vinkelrett på u)
  const nrm = flateNormal(a);
  if (!nrm) return false;
  const d = (b.lav.x - a.lav.x) * nrm.x + (b.lav.y - a.lav.y) * nrm.y + (b.lav.z - a.lav.z) * nrm.z;
  const d2 = (b.hoy.x - a.lav.x) * nrm.x + (b.hoy.y - a.lav.y) * nrm.y + (b.hoy.z - a.lav.z) * nrm.z;
  return Math.abs(d) <= planTol && Math.abs(d2) <= planTol;
}

// Normalen til takflata en bjelke ligger i: u × v, der v er den VANNRETTE
// retningen på tvers av bjelka. v er alltid vannrett fordi takflata er et plan
// som faller i én retning — på tvers av fallet er den vannrett.
//
// 🔎 NORMALEN PEKER ALLTID OPP. Kryssproduktet gir like gjerne den ene som
// den andre veien, avhengig av hvilken vei `v` tilfeldigvis kom ut — og en
// test 21.09 fanget nettopp at den pekte NED på det ene takfallet i Geithus.
// Et tak har en overside; en normal som peker ned ville dyttet TRP-platene
// inn i bjelka i stedet for opp på den, altså det motsatte av det Emil ba om.
export function flateNormal(a) {
  const v = tverretning(a);
  if (!v) return null;
  let nx = a.uy * v.z - a.uz * v.y;
  let ny = a.uz * v.x - a.ux * v.z;
  let nz = a.ux * v.y - a.uy * v.x;
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 1e-9)) return null;
  nx /= L; ny /= L; nz /= L;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }   // et tak har en overside
  return { x: nx, y: ny, z: nz };
}

// Vannrett enhetsvektor på tvers av bjelka.
export function tverretning(a) {
  const L = Math.hypot(a.ux, a.uz);
  if (!(L > 1e-9)) return null;          // loddrett «bjelke» — ikke en takflate
  return { x: -a.uz / L, y: 0, z: a.ux / L };
}

// Bjelkene gruppert i takflater. Bjelker uten fall (åser) holdes utenfor:
// de bærer platene på tvers og sier ingenting om retningen.
export function grupperBjelker(linjer, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const grense = n(opp.minHellingProsent) / 100;
  const med = (linjer || []).filter(a => a && Math.abs(a.helling) >= grense);
  const grupper = [];
  for (const a of med) {
    const g = grupper.find(x => sammeTakflate(x.bjelker[0], a, opp));
    if (g) g.bjelker.push(a);
    else grupper.push({ bjelker: [a] });
  }
  // en «gruppe» med én kort bjelke er et avstivningsstag, ikke et takfall
  const minst = n(opp.minFlateBjelker) || 1;
  return grupper.filter(g => g.bjelker.length >= minst);
}

// Takflata fra én gruppe: en lokal ramme i flatens eget plan.
//
//   U — opp fallet, i rommet (bjelkas egen retning)
//   V — vannrett på tvers
//
// Alt måles fra `origo`, som er gruppas laveste/ytterste hjørne. Da er
// (u, v) rene mm i planet, og platene kan legges rett på.
export function flateFraGruppe(gruppe, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const B = (gruppe && gruppe.bjelker) || [];
  if (!B.length) return null;
  // felles retning: lengdeveid snitt
  let sx = 0, sy = 0, sz = 0;
  for (const a of B) { sx += a.ux * a.lengdeMm; sy += a.uy * a.lengdeMm; sz += a.uz * a.lengdeMm; }
  const L = Math.hypot(sx, sy, sz);
  if (!(L > 1e-9)) return null;
  const U = { x: sx / L, y: sy / L, z: sz / L };
  const V = tverretning({ ux: U.x, uy: U.y, uz: U.z });
  if (!V) return null;
  const p0 = B[0].lav;
  const uv = (p) => [
    (p.x - p0.x) * U.x + (p.y - p0.y) * U.y + (p.z - p0.z) * U.z,
    (p.x - p0.x) * V.x + (p.z - p0.z) * V.z
  ];
  const pkt = [];
  for (const a of B) { pkt.push(uv(a.lav)); pkt.push(uv(a.hoy)); }
  const us = pkt.map(p => p[0]), vs = pkt.map(p => p[1]);
  const ug = n(opp.utstikkGesimsMm), vg = n(opp.utstikkGavlMm);
  const u0 = Math.min(...us) - ug, u1 = Math.max(...us) + ug;
  const v0 = Math.min(...vs) - vg, v1 = Math.max(...vs) + vg;
  const lengdeMm = u1 - u0, breddeMm = v1 - v0;
  const N = flateNormal({ ux: U.x, uy: U.y, uz: U.z });
  return {
    U, V, N, origo: p0, bjelker: B.length,
    u0, u1, v0, v1, lengdeMm: rund(lengdeMm), breddeMm: rund(breddeMm),
    fallGrader: rund(Math.asin(Math.max(-1, Math.min(1, U.y))) * 180 / Math.PI),
    arealM2: rund(lengdeMm * breddeMm / 1e6)
  };
}

// ═══════ 🔄 ROTER TAKFLATA 90° (Emil 21.09) ═══════
//
// Emils bilde 4: et bygg på 25 000 × 30 000 der takflata kom ut lagt den ene
// veien, mens den skulle ligget den andre. «Platene kan bare legge seg 2
// veier», sa han, «vi legger inn en enkel roter-knapp».
//
// Rotasjonen er nettopp så enkel som han sa: U og V bytter plass, og med dem
// utstrekningen. Ingen nye tall regnes — det er SAMME flate, sett den andre
// veien. Normalen står i ro, for den peker fortsatt opp.
//
// ⚠ Etter en rotasjon er det V som bærer fallet, ikke U. Alt som leser høyden
// av flata må derfor tåle det — se uvVannrett over, som er skrevet om til å
// løse begge tilfellene i stedet for å anta at V er vannrett.
export function roterFlate(f) {
  if (!f || !f.U || !f.V) return f;
  return {
    ...f,
    U: f.V, V: f.U,
    u0: f.v0, u1: f.v1, v0: f.u0, v1: f.u1,
    lengdeMm: f.breddeMm, breddeMm: f.lengdeMm,
    fallGrader: rund(Math.asin(Math.max(-1, Math.min(1, n(f.V.y)))) * 180 / Math.PI),
    rotert: !f.rotert,
    // skjøtlinjene hører til den GAMLE retningen og gjelder ikke lenger
    skjotU: undefined
  };
}
export function roterFlater(flater) { return (flater || []).map(roterFlate); }

// ═══════ 🔩 HVOR EN ENDESKJØT KAN LIGGE (Emil 21.09) ═══════
//
// Emils ord: «vi har en feil her siden takplatene skal skjøtes på hver
// toppbjelke, men det er masse små plater som henger i løse lufta.»
//
// Han har rett, og det er ikke en skjønnhetsfeil: en endeskjøt uten noe under
// seg har ingenting å skrus i. Skjøten må hvile på en bjelke som går PÅ TVERS
// av fallet — enås. Sperrene løper samme vei som platene og kan ikke bære en
// skjøt.
//
// Tre krav, og alle tre må være oppfylt:
//   1. Retningen er på tvers av U (innenfor `retningTolGrader` fra 90°).
//   2. Bjelken ligger I FLATA, ikke under den. Toleransen er EGEN og MYE
//      strammere enn `planTolMm`: på Geithus ligger avstivningen 299–301 mm
//      under taket, og med 300 mm slark hadde den blitt lest som en ås.
//   3. Den strekker seg faktisk inn under platene i v-retningen.
export const SKJOT_PLAN_TOL_MM = 60;

export function skjotBjelker(flate, linjer, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate || !flate.U || !flate.V || !flate.origo) return [];
  const U = flate.U, V = flate.V, oo = flate.origo, N = flate.N || { x: 0, y: 1, z: 0 };
  const tol = Math.sin(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  const planTol = n(opp.skjotPlanTolMm) > 0 ? n(opp.skjotPlanTolMm) : SKJOT_PLAN_TOL_MM;
  const langs = (p, A) => (p.x - oo.x) * A.x + (p.y - oo.y) * A.y + (p.z - oo.z) * A.z;
  const ut = [];
  for (const l of linjer || []) {
    if (!l || !l.lav || !l.hoy) continue;
    if (Math.abs(l.ux * U.x + l.uy * U.y + l.uz * U.z) > tol) continue;   // 1
    if (Math.abs(langs(l.lav, N)) > planTol || Math.abs(langs(l.hoy, N)) > planTol) continue;  // 2
    const v1 = langs(l.lav, V), v2 = langs(l.hoy, V);                     // 3
    if (Math.max(v1, v2) < n(flate.v0) || Math.min(v1, v2) > n(flate.v1)) continue;
    ut.push(rund((langs(l.lav, U) + langs(l.hoy, U)) / 2));
  }
  // to åser i praktisk talt samme linje er ÉN skjøtlinje
  ut.sort((a, b) => a - b);
  const samlet = [];
  for (const u of ut) if (!samlet.length || u - samlet[samlet.length - 1] > planTol) samlet.push(u);
  return samlet;
}

// Hele taket: bjelkelinjene inn, ferdige takflater ut.
export function takflaterFraBjelker(linjer, o) {
  return grupperBjelker(linjer, o).map(g => flateFraGruppe(g, o)).filter(Boolean)
    .sort((a, b) => b.arealM2 - a.arealM2);
}

// ═══════ 🔺 VALMENE: HVILKEN FLATE EIER PUNKTET? ═══════
//
// 🔎 FUNNET VED Å TEGNE OPP ET VALMTAK OG SE PÅ DET (18.09).
//
// Hver takflate strekkes til et REKTANGEL rundt sine egne sperrer. På et
// saltak er det riktig — flatene møtes i mønet og overlapper ikke. På et
// VALMTAK overlapper de fire rektanglene hverandre i alle fire valmer, og
// arealet ble 717 m² der det skulle vært rundt 430. Det er ikke en
// skjønnhetsfeil: det er dobbel bestilling.
//
// Den ekte takflata er den LAVESTE av planene over hvert punkt. Tenk på et
// valmtak fra siden: hvert plan stiger fra sin egen gesims, og der to plan
// krysser hverandre går valmen — utenfor den ligger planet OVER taket og
// finnes ikke.
//
// En plate beholdes derfor når dens EGET plan er det laveste under midten av
// plata. Det gir en trappekant langs valmen, og det er nøyaktig slik det
// bygges: plata legges hel og kappes på plassen. For BESTILLINGEN er det også
// riktig — en halvkappet plate koster en hel plate.

// Høyden plan `flate` gir over punktet (x, z) i verden.
// 🔄 GENERELL SIDEN 21.09. Den gamle utgaven regnet bare langs U og antok at
// V var VANNRETT (V.y = 0) — det stemmer så lenge V kommer fra tverretning().
// Etter «Roter takflata 90°» bytter U og V plass, og da er det V som bærer
// fallet. Da ga den gamle formelen konstant høyde, og valmtrimmingen
// (flateEier) hadde tatt feil på hvert eneste punkt.
//
// Her løses i stedet de to ukjente rett ut av det vannrette planet:
//     (dx, dz) = u · (U.x, U.z) + v · (V.x, V.z)
// Determinanten er null bare når U og V peker samme vei vannrett — altså
// ingen flate. Svaret er NØYAKTIG det samme som før når V er vannrett; det er
// samme regnestykke, bare uten antagelsen.
export function uvVannrett(flate, x, z) {
  if (!flate || !flate.U || !flate.V || !flate.origo) return null;
  const U = flate.U, V = flate.V, o = flate.origo;
  const dx = n(x) - n(o.x), dz = n(z) - n(o.z);
  const det = U.x * V.z - U.z * V.x;
  if (!(Math.abs(det) > 1e-12)) return null;
  return [(dx * V.z - dz * V.x) / det, (U.x * dz - U.z * dx) / det];
}

export function planHoydeVed(flate, x, z) {
  const uv = uvVannrett(flate, x, z);
  if (!uv) return null;
  return n(flate.origo.y) + flate.U.y * uv[0] + flate.V.y * uv[1];
}

// Punktet i verden for (u, v) på en flate.
export function punktPaFlate(flate, u, v) {
  const U = flate.U, V = flate.V, o = flate.origo;
  return { x: o.x + U.x * u + V.x * v, y: o.y + U.y * u + V.y * v, z: o.z + U.z * u + V.z * v };
}

// (u, v) for et verdenspunkt på en flates plan.
export function uvPaFlate(flate, x, z) {
  return uvVannrett(flate, x, z);
}

// Ligger punktet innenfor flatas EGEN utstrekning i planet?
export function innenforFlate(flate, x, z, slark) {
  const uv = uvPaFlate(flate, x, z);
  if (!uv) return false;
  const s = n(slark);
  return uv[0] >= n(flate.u0) - s && uv[0] <= n(flate.u1) + s &&
         uv[1] >= n(flate.v0) - s && uv[1] <= n(flate.v1) + s;
}

// Eier flate nr. `fi` punktet (x, z)?
//
// 🔎 EMILS FUNN 18.09: «når jeg trykker generer med fallretning automatisk så
// kommer det ingenting opp» — på Geithus vaskehall, hans eget testbygg.
//
// Første utgave sa: «den LAVESTE flata eier punktet». Det er riktig for et
// valmtak, der rektanglene tråkker inn på hverandre, og et plan som ligger
// over taket ikke finnes.
//
// Men Geithus har takfall som heller INN MOT MIDTEN — høyt i begge gavlender,
// renne i midten. Da ligger hvert plan, forlenget forbi sin egen flate, LAVERE
// enn naboen over naboens område. Begge flatene slo hverandre ut, hver eneste
// plate ble filtrert bort, og panelet viste ingenting.
//
// Feilen var ikke regelen, men at den ble brukt OVERALT. To flater kan bare
// krangle om et punkt der de FAKTISK overlapper hverandre i planet. Utenfor
// naboens egen utstrekning sier naboens plan ingenting — det er en matematisk
// forlengelse av noe som ikke er der.
export function flateEier(flater, fi, x, z, tolMm) {
  const F = flater || [];
  const tol = tallEr(tolMm) ? Number(tolMm) : 50;
  const egen = planHoydeVed(F[fi], x, z);
  if (egen === null) return true;
  for (let i = 0; i < F.length; i++) {
    if (i === fi) continue;
    // 🔑 bare flater som VIRKELIG dekker punktet er med i sammenligningen
    if (!innenforFlate(F[i], x, z, tol)) continue;
    const h = planHoydeVed(F[i], x, z);
    if (h === null) continue;
    if (h < egen - tol) return false;          // et annet plan ligger lavere
    // to plan nøyaktig like høye (to like takfall som møtes): den FØRSTE
    // eier, ellers tar begge plata og arealet dobles
    if (Math.abs(h - egen) <= tol && i < fi) return false;
  }
  return true;
}

// Hele taket med platene trimmet mot valmene. ÉN funksjon, brukt av både lista
// og tegningen — da kan de to per definisjon ikke komme i utakt.
export function platerPaTaket(flater, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const F = (flater || []).filter(Boolean);
  const med = F.map(f => platerPaFlate(f, opp)).filter(Boolean);
  return med.map((f, fi) => {
    const rader = f.rader.map(r => ({
      ...r,
      plater: (r.plater || []).filter(p => {
        if (!f.U) return true;                 // den gamle modellen har ingen valmer
        const um = (n(p.uFra) + n(p.uTil)) / 2;
        const vm = n(r.vFra) + n(r.breddeMm) / 2;
        const pt = punktPaFlate(f, um, vm);
        return flateEier(F, fi, pt.x, pt.z, opp.valmTolMm);
      })
    })).filter(r => r.plater.length);
    // Summene regnes av summerFlate — samme funksjon som håndjusteringen
    // bruker, så de to kan ikke komme i utakt.
    return summerFlate({ ...f, rader }, opp);
  }).filter(f => f.antallPlater > 0);
}

// ═══════ 🔧 HÅNDJUSTERING AV TRP-PLATENE (Emil 21.09) ═══════
//
// Samme prinsipp som blikket fikk i runde 2b: justeringen lagres ikke som et
// fasit-tak, men som et TILLEGG oppå det regnede. Stålet kan leses på nytt
// uten at justeringene ryker.
//
// Id-en lages av HVA plata er og HVOR den sitter, avrundet til 10 mm:
//
//     t:0:1030:0        takflate 0, raden som starter i v = 1030, plate ved u = 0
//
// Flytter en bjelke seg mer enn 10 mm, får plata en ny id og justeringen
// følger ikke med. Det er ærlig: en justering av en plate som ikke lenger
// ligger der, er ikke en justering det går an å ta vare på.
export function plateId(fi, rad, plate) {
  return "t:" + Number(fi) + ":" + Math.round(n(rad && rad.vFra) / 10) * 10 +
         ":" + Math.round(n(plate && plate.uFra) / 10) * 10;
}

// Platene med justeringene lagt på.
//
//   just   { "<id>": { av, dFra, dTil, breddeMm } }
//   ekstra [ { id, fi, vFra, breddeMm, uFra, uTil } ]
export function justerPlater(medPlater, just, ekstra, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const J = just || {};
  return (medPlater || []).map((f, fi) => {
    const rader = (f.rader || []).map(r => {
      const plater = [];
      let bredde = n(r.breddeMm);
      for (const p of r.plater || []) {
        const id = p.id || plateId(fi, r, p);
        const j = J[id] || {};
        // egen bredde gjelder RADEN plata ligger i — en TRP-plate er like
        // bred hele veien, så en «halv bredde» midt i en rad finnes ikke
        if (tallEr(j.breddeMm) && Number(j.breddeMm) > 20) bredde = Number(j.breddeMm);
        if (j.av) continue;
        const uFra = n(p.uFra) - n(j.dFra), uTil = n(p.uTil) + n(j.dTil);
        if (uTil - uFra <= 20) continue;
        plater.push({ ...p, id, uFra: rund(uFra), uTil: rund(uTil),
          lengdeMm: rund(uTil - uFra) });
      }
      return { ...r, breddeMm: rund(bredde), kappetBredde: r.kappetBredde ||
        bredde !== n(r.breddeMm), plater };
    }).filter(r => r.plater.length);
    // lagt til for hånd
    for (const e of ekstra || []) {
      if (Number(e.fi) !== fi) continue;
      const j = J[e.id] || {};
      if (j.av) continue;
      const uFra = n(e.uFra) - n(j.dFra), uTil = n(e.uTil) + n(j.dTil);
      if (uTil - uFra <= 20) continue;
      rader.push({ vFra: n(e.vFra), breddeMm: n(e.breddeMm) || n(opp.trpBreddeMm),
        kappetBredde: false, lagtTil: true,
        plater: [{ id: e.id, lagtTil: true, uFra: rund(uFra), uTil: rund(uTil),
          lengdeMm: rund(uTil - uFra) }] });
    }
    rader.sort((a, b) => n(a.vFra) - n(b.vFra));
    return summerFlate({ ...f, rader }, opp);
  }).filter(f => f.antallPlater > 0);
}

// Tallene på en flate regnet PÅ NYTT av radene. Etter en justering er platene
// fasit — summene skal leses av dem, ikke stå igjen fra forrige runde.
// Samme regnestykke som platerPaTaket bruker, ett sted.
export function summerFlate(f, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const rader = f.rader || [];
  const antall = rader.reduce((a, r) => a + r.plater.length, 0);
  let sideskjoter = 0, sideLm = 0;
  for (let i = 1; i < rader.length; i++) {
    const a = rader[i - 1], b = rader[i];
    if (Math.abs((n(a.vFra) + n(a.breddeMm)) - n(b.vFra)) > 5) continue;
    const ua0 = Math.min(...a.plater.map(p => n(p.uFra)));
    const ua1 = Math.max(...a.plater.map(p => n(p.uTil)));
    const ub0 = Math.min(...b.plater.map(p => n(p.uFra)));
    const ub1 = Math.max(...b.plater.map(p => n(p.uTil)));
    const fra = Math.max(ua0, ub0), til = Math.min(ua1, ub1);
    if (til - fra <= 0) continue;
    sideskjoter++;
    sideLm += (til - fra) / 1000;
  }
  let endeskjoter = 0, endeLm = 0;
  for (const r of rader) {
    const k = Math.max(0, r.plater.length - 1);
    endeskjoter += k;
    endeLm += k * n(r.breddeMm) / 1000;
  }
  const arealM2 = rund(rader.reduce((a, r) =>
    a + r.plater.reduce((b, p) => b + (n(p.uTil) - n(p.uFra)) * n(r.breddeMm), 0), 0) / 1e6);
  return { ...f, rader, antallPlater: antall, endeskjoter, sideskjoter, arealM2,
    skjotLm: rund(sideLm + endeLm) };
}
