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
  // ⚠ INGEN UTSTIKK-FELT. Regel 3: kanten ER bjelkenes utvendige flate, og
  // den leses av fotavtrykkene — den settes ikke.
  trpBreddeMm: 1030,       // DEKKENDE bredde, altså etter sideoverlappen
  trpBolgeMm: 206,         // én bølge — sideoverlappen er nøyaktig én (prosedyren, steg 2)
  platelengder: "",        // stabelen ned fallet, som radhøydene. Tom = én plate per fall
  endeOverlappMm: 150,     // 10–20 cm ved endeskjøt (prosedyren, steg 6)
  maksLengdeMm: 12000,     // transportgrense — RØD MELDING, deler ikke fallet
  skrueAvstandMm: 450,     // 40–50 cm mellom skruene i skjøten (prosedyren, steg 5)
  flattFallProsent: 0,     // fall på et ellers flatt tak
  // ⚠ INGEN `snapSkjot`. Regel 2: skjøtene LIGGER på åsene, de flyttes ikke dit
  // etterpå. Det er ikke lenger noe å slå av.
  skjotPlanTolMm: 60,
  // 🔄 «Roter takflata 90°» (Emil 21.09, bilde 4)
  rotert: false,
  minHellingProsent: 0.5,  // en bjelke under dette «ligger ikke i fallet»
  // ⬆ HVILKE BJELKER SOM ER TAK avgjøres av toppBjelker() — regel 1. Her
  // står ingen vinkelgrense og ingen avstandsgrense lenger; begge var
  // gjetninger på noe bjelkene selv vet.
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
// ═══════ REGEL 2 (Emil 22.09) ═══════
// «TRP-plater skal automatisk legge seg fra bjelke til bjelke og skjøtes —
// ingen av dem skal stoppe i løse lufta.»
//
// Det er derfor BJELKENE, ikke et tall i panelet, som deler fallet når
// `platelengder` står tom. Hver ås inne i fallet får en skjøt, og det finnes
// ingen annen grunn til å dele en plate. Transportgrensa deler ikke lenger —
// den er blitt en rød melding i panelet (`overMaks`), fordi en plate som er
// for lang å kjøre ut er et bestillingsproblem, ikke et takproblem: deler
// koden den selv, havner skjøten i løse lufta, og det er akkurat feilen Emil
// ser på Geithus.
//
// Finnes det ingen ås inne i fallet, blir det ÉN plate. Da er det ingenting
// å skru skjøten i, og å dele likevel ville være å gjette. Plata merkes
// `ingenAas` og panelet sier fra.
//
// Emils valg 18.09 på skjøtene: «1 er riktig» — skjøten går i rett linje, og
// den ØVERSTE plata beholder full lengde. Kappet havner altså nederst, ved
// gesimsen, der det er lettest å komme til.
//
// Hver skjøt koster `endeOverlappMm`: to plater à 6000 med 150 mm overlapp
// dekker 11 850, ikke 12 000. Det er den feilen som ellers ville gitt for lite
// materiell bestilt.
//
// `aserInn` er åsene inne i fallet, målt opp fallet fra den LAVE enden —
// samme liste som indreAser() gir, og som panelet viser.
export function platerNedFall(fallengdeMm, o, aserInn) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const L = n(fallengdeMm);
  if (!(L > 0)) return [];
  const ov = Math.max(0, n(opp.endeOverlappMm));
  const stabel = parsePlatelengder(opp.platelengder);
  const maks = Math.max(100, n(opp.maksLengdeMm));

  // 1) Ingen stabel: ÉN SKJØT PER ÅS, ingen andre steder (regel 2).
  //
  // Åsen ligger UNDER overlappen: den nederste plata slutter `ov/2` over
  // åsen, den øverste starter `ov/2` under den. Da dekker platene fallet
  // nøyaktig, og skruene i skjøten treffer stål.
  if (!stabel.length) {
    const kant = Math.max(MIN_PLATE_MM, ov);
    const A = [...new Set((aserInn || []).map(x => rund(n(x))))]
      .filter(u => u > kant && u < L - kant).sort((a, b) => a - b);
    if (!A.length)
      return [merkPlatelengde({ lengdeMm: Math.round(L), dekningMm: Math.round(L),
        kappet: false, ingenAas: true }, maks)];
    const dek = [];
    for (let i = 0; i <= A.length; i++) {
      const fra = i === 0 ? 0 : A[i - 1];
      const til = i === A.length ? L : A[i];
      dek.push((til - fra) + (i === 0 ? ov / 2 : 0) - (i === A.length ? ov / 2 : 0));
    }
    return dek.map((d, j) => merkPlatelengde({
      lengdeMm: Math.round(j > 0 ? d + ov : d),
      dekningMm: Math.round(d),
      kappet: true,
      paaAas: j < dek.length - 1
    }, maks));
  }

  // 2) Med stabel: legg lengdene fra GESIMSEN og oppover, siste gjentas.
  //
  // 🔑 EMILS AVKLARING 22.09: «lengde + skjøt/overlapp blir fullstendig
  // lengde — hvis en plate blir 5000 mm når du drar den til skjøten og du har
  // satt skjøt til 20, så blir det 5000 + 20 = 5020 mm.»
  //
  // Tallene han taster er altså DEKNINGEN — hvor mye tak plata tar — og
  // overlappen kommer i TILLEGG. Før regnet koden motsatt: den tastede
  // lengden var bestillingslengden, og overlappen spiste av dekningen. Da
  // dekket «4853, 2267» bare 6970 av et fall på 7120, og det manglet 150 mm
  // tak uten at noen sa fra.
  //
  // HVILKEN plate som blir lengre er ikke en smakssak: vannet renner NEDOVER,
  // så den ØVRE plata må lappe over den nedre. Derfor er det hver plate med
  // en skjøt UNDER seg som får overlappen lagt til — den nederste står med
  // sin egen lengde.
  const dekning = [];
  let dekket = 0, i = 0;
  while (dekket < L - 1 && dekning.length < 200) {
    const d = stabel[Math.min(i, stabel.length - 1)];
    dekning.push(d);
    dekket += d;
    i++;
  }
  if (!dekning.length) return [];
  // Overskytende kappes av den NEDERSTE plata — skjøtene ligger da i rett
  // linje der stabelen sier, og det er mønet som er fast (steg 4: plata føres
  // på plass i riktig avstand i henhold til arbeidstegning).
  const over = dekket - L;
  if (over > 0) {
    const ny = dekning[0] - over;
    // 🔎 EMILS FUNN 22.09 (bilde 2–5): «det kommer veldig smale TRP-plater
    // på enden selv om det allerede ligger en full lengde som går helt ut.»
    //
    // På Sundland: fall 54 115,7 mm og stabelen «6000». Ti plater dekker
    // 60 000, og resten — 115,7 mm — ble stående igjen som den nederste
    // «plata». Den ble merket `kort`, men den ble også tegnet og bestilt.
    // 115 mm er ikke en plate, det er en strimmel ingen monterer.
    //
    // Nå slås en rest under MIN_PLATE_MM sammen med plata OVER seg i stedet.
    // Da blir den nederste plata 6 116 i stedet for 6 000 + 116, dekningen er
    // nøyaktig den samme, og kappet ligger fortsatt ved gesimsen — der Emil
    // valgte at det skulle ligge 18.09.
    if (ny >= MIN_PLATE_MM) dekning[0] = Math.round(ny);
    else if (dekning.length > 1) { dekning.shift(); dekning[0] = Math.round(dekning[0] + ny); }
    else if (ny > 20) dekning[0] = Math.round(ny);
    else dekning.shift();
  }
  if (!dekning.length) return [];
  const ut = dekning.map((d, j) => ({
    // dekningen er Emils tall; bestillingslengden er dekning + overlapp for
    // hver plate som har en skjøt under seg
    lengdeMm: Math.round(j > 0 ? d + ov : d),
    dekningMm: Math.round(d),
    kappet: j === 0 && over > 0
  }));
  // 🔎 EN STABEL SOM IKKE GÅR OPP. «6000, 6000» på et fall på 12 000 ser ut til
  // å passe, men gjør det ikke: overlappen spiser 150 mm, så to plater dekker
  // 11 850. Da trengs en tredje, og den nederste blir stående igjen på 300 mm.
  // Regnestykket er riktig — men 300 mm er ingen plate noen monterer.
  //
  // Vi kapper den IKKE bort i det stille (da mangler det 300 mm tak) og vi
  // later ikke som det går opp. Plata merkes `kort`, og panelet sier fra at
  // stabelen bør justeres. Det er Emils tall, og han skal få vite at de ikke
  // går opp — ikke oppdage det på taket.
  for (const p of ut) merkPlatelengde(p, maks);
  return ut;
}

// Kortere enn 500 mm er en strimmel, og lengre enn transportgrensa er en plate
// ingen kan kjøre ut. Begge sies fra om — ingen av dem endrer taket.
function merkPlatelengde(p, maksMm) {
  if (p.lengdeMm < MIN_PLATE_MM) p.kort = true;
  if (maksMm > 0 && p.lengdeMm > maksMm) p.overMaks = true;
  return p;
}

// ═══════ 🔩 SKJØTENE LIGGER PÅ ÅSENE (regel 2) ═══════
//
// «takplatene skal skjøtes på hver toppbjelke, men det er masse små plater
// som henger i løse lufta.» (Emil 21.09)
//
// Det finnes ikke lenger noen snapping: platene LEGGES på åsene med én gang,
// i platerNedFall(). Det som var «ønsket lengde som flyttes til nærmeste ås»
// var et mellomledd som kunne bomme — og bommet på Geithus.
//
// Åsene som FAKTISK kan bære en skjøt på denne flata: målt opp fallet fra den
// lave enden, og uten dem som ligger så nær en kant at plata ville blitt en
// strimmel. Panelet og plateinndelingen leser den SAMME funksjonen — ellers
// kunne panelet listet en ås platene ikke skjøtes på.
export function indreAser(flate, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate || !Array.isArray(flate.skjotU)) return [];
  const L = n(flate.lengdeMm);
  const kant = Math.max(MIN_PLATE_MM, Math.max(0, n(opp.endeOverlappMm)));
  return [...new Set(flate.skjotU.map(u => rund(n(u) - n(flate.u0))))]
    .filter(u => u > kant && u < L - kant).sort((a, b) => a - b);
}

// Kortere enn dette er ikke en plate, det er en strimmel.
export const MIN_PLATE_MM = 500;

// Platene i en stabel lagt ut langs u fra `uStart` og oppover. Hver plate
// DEKKER `dekningMm` og strekker seg `ov` nedover forbi skjøten under seg.
function stableU(nedFall, uStart, ov) {
  let s = 0;
  return nedFall.map((p, j) => {
    const dek = tallEr(p.dekningMm) ? n(p.dekningMm) : n(p.lengdeMm) - (j > 0 ? ov : 0);
    const topp = n(uStart) + s + dek;
    const bunn = n(uStart) + s - (j > 0 ? ov : 0);
    s += dek;
    return { ...p, uFra: rund(bunn), uTil: rund(topp) };
  });
}

// 📏 Bjelkene som løper LANGS platene (parallelt med U) og ligger i flata —
// de deler taket i rader, slik åsene deler det i lengder. Som linjer i verden.
export function radBjelker(flate, linjer, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate || !flate.U || !flate.V || !flate.origo) return [];
  const U = flate.U, oo = flate.origo, N = flate.N || { x: 0, y: 1, z: 0 };
  const Uh = Math.hypot(U.x, U.z);
  if (!(Uh > 1e-9)) return [];
  const cos = Math.cos(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  const tol = RAMME_PLAN_TOL_MM;
  const d = (p) => (p.x - oo.x) * N.x + (p.y - oo.y) * N.y + (p.z - oo.z) * N.z;
  const ut = [];
  for (const l of linjer || []) {
    if (!l || !l.lav || !l.hoy) continue;
    const dx = l.hoy.x - l.lav.x, dz = l.hoy.z - l.lav.z, L = Math.hypot(dx, dz);
    if (!(L > 500)) continue;
    if (Math.abs((dx * U.x + dz * U.z) / (L * Uh)) < cos) continue;
    if (Math.abs(d(l.lav)) > tol || Math.abs(d(l.hoy)) > tol) continue;
    ut.push([rund(l.lav.x), rund(l.lav.z), rund(l.hoy.x), rund(l.hoy.z)]);
  }
  return ut;
}

// Radgrensene i flatas v: midt på hver langsgående bjelke inne i flata som
// spenner over minst 30 % av lengden. Null når flata ikke har lista (lagret
// før 23.09) — da gjelder den gamle dekkende bredden.
export function radLinjerV(flate) {
  if (!flate || !Array.isArray(flate.radL)) return null;
  const L = n(flate.u1) - n(flate.u0);
  const kant = 300;
  // En sperre kan være modellert i flere stykker på linje (Arendal: fire
  // biter over 20 m). Bitene på samme linje telles sammen.
  const biter = [];
  for (const [x1, z1, x2, z2] of flate.radL) {
    const a = uvVannrett(flate, x1, z1), b = uvVannrett(flate, x2, z2);
    if (!a || !b) continue;
    const ov = Math.min(n(flate.u1), Math.max(a[0], b[0])) - Math.max(n(flate.u0), Math.min(a[0], b[0]));
    if (ov > 0) biter.push({ v: (a[1] + b[1]) / 2, ov });
  }
  biter.sort((p, q) => p.v - q.v);
  const linjer = [];
  for (const b of biter) {
    const sist = linjer[linjer.length - 1];
    if (sist && b.v - sist.v <= 100) { sist.v = (sist.v * sist.ov + b.v * b.ov) / (sist.ov + b.ov); sist.ov += b.ov; }
    else linjer.push({ ...b });
  }
  return linjer.filter(q => q.ov >= 0.3 * L && q.v > n(flate.v0) + kant && q.v < n(flate.v1) - kant)
    .map(q => rund(q.v));
}

// Åsene i flatas (u, v): hvor de ligger langs fallet, og hvilken strekning
// på tvers de dekker. Uten linjer (lagret før 23.09) gjelder en ås hele flata.
export function aserUV(flate) {
  if (!flate) return [];
  if (Array.isArray(flate.aserL) && flate.aserL.length) {
    return flate.aserL.map(([x1, z1, x2, z2]) => {
      const a = uvVannrett(flate, x1, z1), b = uvVannrett(flate, x2, z2);
      if (!a || !b) return null;
      return { u: (a[0] + b[0]) / 2, vA: Math.min(a[1], b[1]), vB: Math.max(a[1], b[1]) };
    }).filter(Boolean);
  }
  if (Array.isArray(flate.skjotU))
    return flate.skjotU.map(u => ({ u: n(u), vA: -Infinity, vB: Infinity }));
  return [];
}

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
  // 🧱 HVOR RADEN FØRSTE BEGYNNER. Uten et delt anker er det flatas egen v0.
  // Med anker (to takhalvdeler som deler et møne, se deltRadrutenett) legges
  // radene på det FELLES rutenettet, slik at bølgene møtes over mønet. Det som
  // blir liggende utenfor rutenettet i den første enden blir en rest der, på
  // nøyaktig samme sted på begge sider.
  const minRest = Math.max(20, n(opp.trpBolgeMm));
  const anker = tallEr(flate.radAnker) ? n(flate.radAnker) : null;
  let start = n(flate.v0), restFoer = 0;
  if (anker !== null && Math.abs(n(flate.V && flate.V.y)) <= 1e-6) {
    // Rutenettet får begynne inntil én bølge UTENFOR flata. De to V-aksene er
    // ikke helt parallelle (sperrene er modellert slik), så rutenettet treffer
    // kanten et par cm feil i den ene enden. Å skyve en hel periode for de to
    // centimeterne ville gitt en 5 967 mm strimmel — verre enn et utstikk som
    // uansett er der.
    start = anker + Math.ceil((n(flate.v0) - anker - minRest) / pb) * pb;
    restFoer = Math.round(start - n(flate.v0));
    if (restFoer < 0) restFoer = 0;
  }
  const nyttig = bredde - restFoer;
  const hele = Math.max(0, Math.floor(nyttig / pb));
  let rest = Math.round(nyttig - hele * pb);
  // 🔎 EMILS FUNN 22.09: en 147 mm strimmel langs kanten, ved siden av en
  // plate som allerede når helt ut.
  //
  // SIDEOVERLAPPEN ER ÉN BØLGE (prosedyren, steg 2). En strimmel smalere enn
  // én bølge kan derfor ikke legges: det finnes ingen bølge å lappe den over
  // naboen med. På Sundland var resten 147 og 153 mm mot en bølge på 206 —
  // og 100 av dem er utstikket (50 mm i hver ende) som er lagt på flata, altså
  // ikke tak i det hele tatt.
  //
  // Resten blir derfor ikke en egen plate. Den står igjen som `restMm` slik at
  // panelet kan si hvor mye kanten mangler — skjult blir den ikke.
  const restUtenfor = rest > 0 && rest <= minRest ? rest : 0;
  if (restUtenfor) rest = 0;
  const foerUtenfor = restFoer > 0 && restFoer <= minRest ? restFoer : 0;
  if (foerUtenfor) restFoer = 0;
  // 🔩 REGEL 2: åsene deler fallet når Emil ikke har tastet lengdene selv.
  //
  // 🔑 EMILS VALG 22.09: «mine tall vinner alltid.» Taster han en stabel, er
  // det den som gjelder, og åsene blir en KONTROLL som panelet melder fra om.
  // Står feltet tomt, er det bjelkene som bestemmer — en skjøt per ås.
  const nedFall = platerNedFall(fall, opp, indreAser(flate, opp));
  // hver plate med sin egen strekning langs u, fra den LAVE enden og oppover
  // Hver plate DEKKER `dekningMm` av fallet og strekker seg `ov` NEDOVER
  // forbi skjøten under seg — det er den overlappen som gjør taket tett.
  const ov2 = Math.max(0, n(opp.endeOverlappMm));
  let s2 = 0;
  const medU = nedFall.map((p, j) => {
    const dek = tallEr(p.dekningMm) ? n(p.dekningMm) : n(p.lengdeMm) - (j > 0 ? ov2 : 0);
    const topp = n(flate.u0) + s2 + dek;
    const bunn = n(flate.u0) + s2 - (j > 0 ? ov2 : 0);
    s2 += dek;
    return { ...p, uFra: rund(bunn), uTil: rund(topp) };
  });
  // 🏔 RADENE LEGGES FRA DEN HØYE ENDEN (Emils funn 22.09, bilde 1):
  // «bølgene på takplatene på begge sider av mønet er ikke flush med
  // hverandre.»
  //
  // Radene startet i v0, altså ved gesimsen, og den kappede strimmelen havnet
  // ØVERST — rett i mønet, der de to takhalvdelene møtes og alt sees. De to
  // sidene fikk hver sin strimmelbredde (147 og 153), og bølgene møttes derfor
  // aldri.
  //
  // Nå legges radene fra MØNET og nedover. Begge sider starter med en hel
  // plate i samme linje, bølgene står i takt over mønet, og kappet havner ved
  // gesimsen — samme valg som Emil tok for lengderetningen 18.09.
  //
  // Bare når V faktisk bærer fallet (etter «Roter takflata 90°»). Står V
  // vannrett, er det ingen høy ende å legge fra, og radene ligger som før.
  const vHoy = n(flate.V && flate.V.y);
  const fraMonet = vHoy > 1e-6;
  const rader = [];
  if (fraMonet) {
    for (let i = 0; i < hele; i++)
      rader.push({ vFra: rund(n(flate.v1) - (i + 1) * pb), breddeMm: pb, kappetBredde: false, plater: medU });
    if (rest > 20)
      rader.push({ vFra: rund(flate.v0), breddeMm: rest, kappetBredde: true, plater: medU });
  } else {
    if (restFoer > 20)
      rader.push({ vFra: rund(flate.v0), breddeMm: restFoer, kappetBredde: true, plater: medU });
    for (let i = 0; i < hele; i++)
      rader.push({ vFra: rund(start + i * pb), breddeMm: pb, kappetBredde: false, plater: medU });
    if (rest > 20)
      rader.push({ vFra: rund(start + hele * pb), breddeMm: rest, kappetBredde: true, plater: medU });
  }
  // 📏 RADENE LEGGES FRA BJELKE TIL BJELKE OGSÅ PÅ TVERS (Emil 23.09): «vi
  // kan fjerne dekkende bredde — fasit er bjelke til bjelke, og den regelen er
  // på plass.» Lengden deles av åsene (regel 2); bredden deles nå av bjelkene
  // som løper LANGS platene (radBjelker). Sideskjøten ligger midt på bjelken,
  // og den ytterste raden går ut til rammens utvendige flate. Står det ingen
  // slik bjelke inne i flata, er hele bredden én rad.
  const radV = radLinjerV(flate);
  if (radV) {
    rader.length = 0;
    const grenser = [n(flate.v0), ...radV, n(flate.v1)];
    for (let i = 1; i < grenser.length; i++) {
      const b = grenser[i] - grenser[i - 1];
      if (b > 20) rader.push({ vFra: rund(grenser[i - 1]), breddeMm: rund(b), kappetBredde: false, fraBjelke: true, plater: medU });
    }
  }
  rader.sort((a, b) => a.vFra - b.vFra);
  // 🖼 MED OMRISS: hver rad legges fra der TAKET begynner i raden til der det
  // slutter, og deles bare av åsene som faktisk ligger under raden. Kantene
  // der raden krysser rammen følger med til kappingen (kappMotKant).
  const PUV = omrissUV(flate);
  if (PUV) {
    const aser = aserUV(flate);
    const ut = [];
    for (const r of rader) {
      const vA = n(r.vFra), w = n(r.breddeMm), vB = vA + w;
      const linje = (v) => spennVed(PUV, v, flate.u0, flate.u1);
      // 📏 KANTEN ER OMRISSET SELV, KNEKK FOR KNEKK. En bred rad (Emil kjører
      // 6 000 mm) kan krysse både en skrå bjelke og et hjørne — én rett linje
      // over hele bredden ville da lagt en del av plata i løse lufta. Kappet
      // følger derfor omrisset gjennom hvert hjørne som ligger inne i raden.
      //
      // Men det leses INNE i raden, ikke på selve siden: en side som ligger
      // nesten langs omrisset (på Valle står sperrene 0,17° skjevt mot renna —
      // 75 mm over 24 m) ville ellers truffet omrisset i den ene enden og gitt
      // en trekant. De ytterste `d` mm forlenges fra innsiden.
      const d = Math.min(w / 10, 200);
      // bare der en SIDEKANT (nesten parallell med raden) faktisk ligger ved
      // siden av raden — ellers leses omrisset helt ut, hjørne for hjørne
      const sideVed = (v) => PUV.some((q, i) => {
        const r2 = PUV[(i + 1) % PUV.length];
        const du = Math.abs(r2[0] - q[0]), dv = Math.abs(r2[1] - q[1]);
        return du > 20 * dv && Math.min(q[1], r2[1]) <= v + d && Math.max(q[1], r2[1]) >= v - d;
      });
      const va = vA + (sideVed(vA) ? d : 0.5), vb = vB - (sideVed(vB) ? d : 0.5);
      const vs = [va, vb];
      for (const q of PUV) if (q[1] > va + 0.5 && q[1] < vb - 0.5) vs.push(q[1] - 0.5, q[1] + 0.5);
      vs.sort((p2, q2) => p2 - q2);
      const iM = linje((vA + vB) / 2);
      const midt = iM.length ? iM : (vs.map(linje).find(I => I.length) || []);
      for (const [lo, hi] of midt) {
        const treff = [];
        for (const v of vs) {
          let b2 = null, bo = 0;
          for (const s2 of linje(v)) { const ov = Math.min(hi, s2[1]) - Math.max(lo, s2[0]); if (ov > bo) { bo = ov; b2 = s2; } }
          if (b2) treff.push({ v, lo: b2[0], hi: b2[1] });
        }
        if (!treff.length) continue;
        const klem = (u) => Math.max(n(flate.u0), Math.min(n(flate.u1), u));
        // forleng ut til sidene langs det nærmeste stykket som er langt nok
        const forleng = (k, v, fra) => {
          const A0 = fra ? treff[0] : treff[treff.length - 1];
          const B0 = (fra ? treff : treff.slice().reverse()).find(q => Math.abs(q.v - A0.v) >= 50);
          if (!B0) return A0[k];
          return A0[k] + (B0[k] - A0[k]) * (v - A0.v) / (B0.v - A0.v);
        };
        const kurve = (k) => {
          const ut2 = [[vA, klem(forleng(k, vA, true))]];
          for (const q of treff) ut2.push([q.v, klem(q[k])]);
          ut2.push([vB, klem(forleng(k, vB, false))]);
          return ut2.map(([v, u]) => [rund(v), rund(u)]);
        };
        const loK = kurve("lo"), hiK = kurve("hi");
        const lA = loK[0][1], lB = loK[loK.length - 1][1], hA = hiK[0][1], hB = hiK[hiK.length - 1][1];
        const uS = Math.min(...loK.map(q => q[1])), uE = Math.max(...hiK.map(q => q[1]));
        if (!(uE - uS > 20)) continue;
        const inne = aser
          .filter(q => Math.min(vB, q.vB) - Math.max(vA, q.vA) >= 0.5 * w)
          .map(q => rund(q.u - uS));
        ut.push({ ...r, plater: stableU(platerNedFall(uE - uS, opp, inne), uS, ov2),
          kant: { lA: rund(lA), lB: rund(lB), hA: rund(hA), hB: rund(hB), lo: loK, hi: hiK } });
      }
    }
    rader.length = 0;
    rader.push(...ut);
  }
  // skjøter: én endeskjøt mindre enn antall plater, per rad
  const endeskjoter = rader.reduce((a, r) => a + Math.max(0, r.plater.length - 1), 0);
  // sideskjøter: én mellom hvert par naborader
  const sideskjoter = Math.max(0, rader.length - 1);
  return {
    ...flate, rader, restMm: restUtenfor + foerUtenfor,
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
      // 🔎 EMILS FUNN 22.09: «TRP-platene som er samme lengde får forskjellige
      // navn i stedet for å legges i en bunke.»
      //
      // Navnet het «TRP 5025» for full bredde og «TRP 5025 (940 mm)» for en
      // kappet rad. To plater med samme lengde og samme bredde kunne dermed
      // ikke havne i samme bunke hvis den ene raden tilfeldigvis var merket
      // kappet. Nå står begge målene alltid, slik Emil selv skriver dem
      // («4853 x 5552»), og like plater er per definisjon samme vare.
      const navn = plateNokkel(p.lengdeMm, r.breddeMm, p);
      const e = perType.get(navn) || { navn, lengdeMm: p.lengdeMm, breddeMm: r.breddeMm,
        antall: 0, skra: !!p.skra,
        lengdeVMm: p.lengdeVMm, lengdeHMm: p.lengdeHMm,
        vinkel: p.skra ? vinkelTekstTak(p.vinkel) : "" };
      e.antall++;
      perType.set(navn, e);
      antall++;
    }
  }
  const skrueAvst = Math.max(50, n(opp.skrueAvstandMm));
  const korte = medPlater.reduce((a, f) =>
    a + f.rader.reduce((b, r) => b + r.plater.filter(p => p.kort).length, 0), 0);
  // 🚛 Over transportgrensa: telles og sies fra om — platene står som de er.
  const overMaks = medPlater.reduce((a, f) =>
    a + f.rader.reduce((b, r) => b + r.plater.filter(p => p.overMaks).length, 0), 0);
  const lengsteMm = medPlater.reduce((a, f) =>
    Math.max(a, f.rader.reduce((b, r) =>
      Math.max(b, r.plater.reduce((c, p) => Math.max(c, n(p.lengdeMm)), 0)), 0)), 0);
  // 🏷 EN KODE PER STØRRELSE (Emil 22.09: «samme merking som veggelement, med
  // dimensjon i senter og nummer/navn oppe i hjørnet»). Koden hører til
  // VAREN, ikke til den enkelte plata: står det TRP-02 på taket, vet montøren
  // hvilken bunke på bakken den kommer fra.
  const sortert = [...perType.values()]
    .sort((a, b) => b.lengdeMm - a.lengdeMm || a.breddeMm - b.breddeMm);
  sortert.forEach((e, i) => { e.kode = "TRP-" + String(i + 1).padStart(2, "0"); });
  return {
    plater: sortert,
    antall, arealM2: rund(arealM2), skjotLm: rund(skjotLm),
    // sagt fra om, ikke skjult bort — se platerNedFall
    korte, advarsel: korte > 0, overMaks, lengsteMm: Math.round(lengsteMm),
    // «ca 40-50 cm avstand mellom skruene» langs hver skjøt (prosedyren, steg 5)
    skruer: Math.ceil(skjotLm * 1000 / skrueAvst)
  };
}

// Nøkkelen en plate slås opp under — samme streng som navnet i lista, slik at
// merkingen i 3D og bunken på bakken aldri kan bli to forskjellige varer.
export function plateNokkel(lengdeMm, breddeMm, plate) {
  // ✂ Et skråkappet plate er ikke samme vare som et rett. Begge endemålene
  // står i navnet, i den rekkefølgen de ligger på taket — to speilvendte kapp
  // er heller ikke samme vare. Samme regel som veggelementene har (regler.js).
  const L = plate && plate.skra
    ? Math.round(n(plate.lengdeVMm)) + "/" + Math.round(n(plate.lengdeHMm))
    : String(Math.round(n(lengdeMm)));
  return "TRP " + L + " × " + Math.round(n(breddeMm));
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
    let topp = -Infinity;
    for (const p of br) if (n(p[1]) > topp) topp = n(p[1]);
    // 🔎 EMILS FUNN 23.09 (Norsjø golfklubb, saltak): «kun halve taket
    // legger seg på toppen av høyeste bjelke.» Sperrene er hulprofiler, 140
    // mm brede, og BEGGE toppkantene står like høyt. Før tok vi den første av
    // dem — og hos tre av ni sperrer var det motsatt kant i de to endene. Da
    // ble sperra lest 140 mm skjev, takplanet vippet 0,5° og platene lå
    // 185 mm feil i den ene gavlen. Midten av toppflaten er ett punkt uansett
    // hvilken rekkefølge modellen har lagret hjørnene i.
    const pa = br.filter(p => n(p[1]) >= topp - 1);
    let sx = 0, sz = 0;
    for (const p of pa) { sx += n(p[0]); sz += n(p[2]); }
    return { x: sx / pa.length, y: topp, z: sz / pa.length };
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
    helling: vannrett > 0 ? ly / vannrett : 0,
    // 👣 FOTAVTRYKKET I PLAN. Råpunktene er der allerede — takBjelkeLinjer()
    // samler opptil 600 per bjelke — men bare senterlinja har vært brukt.
    // Fotavtrykket er det regel 3 trenger: den UTVENDIGE FLATEN til bjelken,
    // ikke midten av den. Og det er det regel 1 trenger for å spørre om noe
    // ligger OVER bjelken i samme punkt.
    fot: planHull(P)
  };
}

// Konveks innhylling i plan, (x, z). Egen utgave her fordi sw-tak.js ikke
// importerer noe — samme Andrew-monotone som konveksHull() i regler.js.
export function planHull(punkter) {
  const p = (punkter || []).map(q => ({ x: n(q[0]), z: n(q[2]) }))
    .sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const kryss = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const bygg = (liste) => {
    const ut = [];
    for (const q of liste) {
      while (ut.length >= 2 && kryss(ut[ut.length - 2], ut[ut.length - 1], q) <= 0) ut.pop();
      ut.push(q);
    }
    return ut;
  };
  const nedre = bygg(p), ovre = bygg([...p].reverse());
  nedre.pop(); ovre.pop();
  const hull = nedre.concat(ovre);
  return hull.length >= 3 ? hull : p;
}

// Ligger punktet inne i et plan-polygon? Strålekasting, samme som
// randvandringen i regler.js bruker.
export function iPlanPolygon(poly, x, z) {
  const P = poly || [];
  if (P.length < 3) return false;
  let inne = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((n(a.z) > n(z)) !== (n(b.z) > n(z)) &&
        n(x) < (n(b.x) - n(a.x)) * (n(z) - n(a.z)) / (n(b.z) - n(a.z)) + n(a.x)) inne = !inne;
  }
  return inne;
}

// Overkanten av en bjelke rett over plan-punktet (x, z). `lav` og `hoy` er
// allerede de HØYESTE punktene i hver ende, så en rett interpolasjon mellom
// dem ER overflaten.
export function bjelkeToppY(b, x, z) {
  if (!b || !b.lav || !b.hoy) return null;
  const dx = n(b.hoy.x) - n(b.lav.x), dz = n(b.hoy.z) - n(b.lav.z);
  const L2 = dx * dx + dz * dz;
  if (!(L2 > 1e-9)) return n(b.hoy.y);
  let t = ((n(x) - n(b.lav.x)) * dx + (n(z) - n(b.lav.z)) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return n(b.lav.y) + (n(b.hoy.y) - n(b.lav.y)) * t;
}

// ═══════ ⬆ REGEL 1: DE HØYESTE BJELKENE ═══════
//
// «TRP-platene skal legge seg på toppflaten av de HØYESTE bjelkene på bygget»
// (Emil 22.09). Det er ikke et høydebånd over hele bygget — på et saltak ligger
// mønet metervis over gesimsen, og begge er tak. Det er et LOKALT spørsmål:
// ligger det noe over denne bjelken, i dens egne punkter?
//
// En skråstiver i et fagverk går fra undergurt til overgurt og har overgurten
// rett over seg hele veien — derfor faller den ut, uansett hvor bratt den er.
// Det er dette som gjør at `maksFallGrader` kan fjernes: grensa kastet ekte
// saltak for å bli kvitt skråstivere, og det var feil medisin.
//
// Terskelen er 3/4 av lengden. En ås som ligger OPPÅ en sperre dekker bare
// krysningspunktet — noen få prosent — og sperra overlever. En skråstiver er
// dekket hele veien.
// Tyngdepunktet i et plan-polygon — her bare snittet av hjørnene, som holder
// for et bjelkefotavtrykk (et rektangel).
export function fotSenter(poly) {
  const P = poly || [];
  if (!P.length) return null;
  let x = 0, z = 0;
  for (const q of P) { x += n(q.x); z += n(q.z); }
  return { x: x / P.length, z: z / P.length };
}

export const DEKKET_ANDEL = 0.75;
export const DEKKET_SLARK_MM = 50;

export function toppBjelker(linjer) {
  const L = (linjer || []).filter(Boolean);
  if (L.length < 2) return L;
  const N = 13;
  return L.filter(a => {
    if (!a.fot || a.fot.length < 3 || !a.lav || !a.hoy) return true;
    // 🔎 PRØVEPUNKTENE MÅ LIGGE MIDT I BJELKEN, IKKE PÅ KANTEN AV DEN.
    // `lav` og `hoy` er de HØYESTE hjørnepunktene, og de ligger på kanten av
    // profilen. På Geithus lå bjelke 10 sin senterlinje nøyaktig på z = 0, som
    // er kanten av åsen over den — strålekastingen svarte «utenfor» i hvert
    // eneste punkt, og en bjelke 1 550 mm under taket ble lest som toppbjelke.
    // Derfor forskyves prøvelinja ut til fotavtrykkets eget senter.
    const midt = fotSenter(a.fot);
    const ax = n(a.hoy.x) - n(a.lav.x), az = n(a.hoy.z) - n(a.lav.z);
    const L2 = ax * ax + az * az;
    let dx = 0, dz = 0;
    if (L2 > 1e-9 && midt) {
      const tc = ((midt.x - n(a.lav.x)) * ax + (midt.z - n(a.lav.z)) * az) / L2;
      dx = midt.x - (n(a.lav.x) + ax * tc);
      dz = midt.z - (n(a.lav.z) + az * tc);
    }
    let dekket = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const x = n(a.lav.x) + (n(a.hoy.x) - n(a.lav.x)) * t + dx;
      const z = n(a.lav.z) + (n(a.hoy.z) - n(a.lav.z)) * t + dz;
      const y = n(a.lav.y) + (n(a.hoy.y) - n(a.lav.y)) * t;
      for (const b of L) {
        if (b === a || !b.fot || b.fot.length < 3) continue;
        if (!iPlanPolygon(b.fot, x, z)) continue;
        const by = bjelkeToppY(b, x, z);
        if (by !== null && by > y + DEKKET_SLARK_MM) { dekket++; break; }
      }
    }
    return dekket / N < DEKKET_ANDEL;
  });
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
  // ═════ 📐 REGEL 3: OMRISSET ER BJELKENES UTVENDIGE FLATE ═════
  //
  // «Platene skal kun komme opp innenfor rammen til toppbjelken, og stikke ut
  // til utvendig flate av bjelkene som går langs kanten» (Emil 22.09).
  //
  // FØR: rammen ble spent mellom bjelkenes SENTERLINJER, og så ble det lagt
  // på et settbart utstikk på 50 mm i hver ende. To gjetninger på samme
  // spørsmål — og ingen av dem var kanten.
  //
  // NÅ: hvert hjørne i bjelkens fotavtrykk regnes om til (u, v), med bjelkens
  // egen overflate som høyde. Ytterkanten av rammen er da den ytterste
  // bjelkeflaten, uten en eneste innstilling.
  const hjorner = [];
  const perBjelke = [];
  for (const a of B) {
    const c = (a.fot && a.fot.length >= 3)
      ? a.fot
      : [{ x: a.lav.x, z: a.lav.z }, { x: a.hoy.x, z: a.hoy.z }];
    const uu = [], vv = [];
    for (const q of c) {
      const y = bjelkeToppY(a, q.x, q.z);
      const pt = uv({ x: n(q.x), y: y === null ? n(a.hoy.y) : y, z: n(q.z) });
      uu.push(pt[0]); vv.push(pt[1]); hjorner.push(pt);
    }
    perBjelke.push({ vMid: rund((Math.min(...vv) + Math.max(...vv)) / 2),
      uMin: rund(Math.min(...uu)), uMax: rund(Math.max(...uu)) });
  }
  if (!hjorner.length) return null;
  const us = hjorner.map(q => q[0]), vs = hjorner.map(q => q[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us);
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  // 📐 KANTLINJENE: hvor langt taket FAKTISK rekker ved hver v.
  //
  // 🔎 EMILS FUNN 22.09 (bilde 3–5, bygg med skrå vegg): «vi må legge inn at
  // TRP-plater også stopper på enden av skrå toppbjelker.»
  //
  // Rektangelet u0…u1 er det MINSTE som rommer alle sperrene. Står sperrene
  // like lange, er rektangelet taket. Trappes de ned mot en skrå vegg, er det
  // ikke det — og platene ble lagt ut i luft.
  //
  // Hver sperre gir étt punkt på hver kant: [v, u]. Kantene er altså taket sin
  // egen omriss, ikke en antagelse om at det er firkantet.
  const kantLav = [], kantHoy = [];
  for (const b of perBjelke) {
    kantLav.push([b.vMid, b.uMin]);
    kantHoy.push([b.vMid, b.uMax]);
  }
  kantLav.sort((a, b) => a[0] - b[0]);
  kantHoy.sort((a, b) => a[0] - b[0]);
  const lengdeMm = u1 - u0, breddeMm = v1 - v0;
  const N = flateNormal({ ux: U.x, uy: U.y, uz: U.z });
  // ⚠ INGEN VINKELGRENSE LENGER. Den kastet ekte saltak for å bli kvitt
  // fagverkets skråstivere — feil medisin. Regel 1 (toppBjelker) tar
  // skråstiverne fordi overgurten ligger rett over dem, og da er fallet
  // irrelevant. Emil 22.09.
  return {
    U, V, N, origo: p0, bjelker: B.length, kantLav, kantHoy,
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
// 🔄 KANTLINJENE ETTER EN ROTASJON (Emils funn 22.09: «skråkapp funker kun
// hvis takflaten ikke er rotert 90° — de skal kappes uansett hvilken vei»).
//
// Kantene er «hvor langt rekker taket i u, ved denne v-en». Etter en rotasjon
// bytter u og v plass, og det spørsmålet er et ANNET spørsmål — ikke de samme
// tallene snudd. Første utgave kastet derfor kantene, og da ble et skråtak
// aldri kappet i rotert stilling.
//
// Her leses omrisset på nytt i den nye rammen: for hver nye v (som er den
// gamle u) finnes den første og siste nye u (den gamle v) som ligger inne på
// taket. Grovsøk og så halvering, så kanten blir funnet på under en millimeter
// uten å anta at omrisset er rett.
export function kanterEtterRotasjon(f) {
  if (!f || !Array.isArray(f.kantLav) || !Array.isArray(f.kantHoy)) return null;
  if (!f.kantLav.length || !f.kantHoy.length) return null;
  const uA = n(f.v0), uB = n(f.v1);       // ny u-akse = gammel v
  const vA = n(f.u0), vB = n(f.u1);       // ny v-akse = gammel u
  if (!(uB - uA > 1) || !(vB - vA > 1)) return null;
  const inne = (up, vp) => {
    const a = kantU(f.kantLav, up), b = kantU(f.kantHoy, up);
    return a !== null && b !== null && vp >= a - 1 && vp <= b + 1;
  };
  const N = 48, M = 240;
  const lav = [], hoy = [];
  const rute = (j) => uA + (uB - uA) * j / M;
  for (let i = 0; i <= N; i++) {
    const vp = vA + (vB - vA) * i / N;
    let a = null, b = null;
    for (let j = 0; j <= M; j++) if (inne(rute(j), vp)) { if (a === null) a = j; b = j; }
    if (a === null) continue;
    const finn = (innside, utside) => {
      let x = innside, y = utside;
      for (let k = 0; k < 24; k++) { const m = (x + y) / 2; if (inne(m, vp)) x = m; else y = m; }
      return x;
    };
    lav.push([rund(vp), rund(a > 0 ? finn(rute(a), rute(a - 1)) : rute(0))]);
    hoy.push([rund(vp), rund(b < M ? finn(rute(b), rute(b + 1)) : rute(M))]);
  }
  return lav.length >= 2 ? { kantLav: lav, kantHoy: hoy } : null;
}

export function roterFlate(f) {
  if (!f || !f.U || !f.V) return f;
  // 🖼 Med et omriss i verden er det ingenting å lese på nytt: det er samme
  // polygon, og (u, v) regnes av det når platene legges. Kantlinjene under
  // gjelder bare flater lagret før 23.09.
  const nyeKanter = Array.isArray(f.omriss) ? null : kanterEtterRotasjon(f);
  return {
    ...f,
    U: f.V, V: f.U,
    u0: f.v0, u1: f.v1, v0: f.u0, v1: f.u1,
    lengdeMm: f.breddeMm, breddeMm: f.lengdeMm,
    fallGrader: rund(Math.asin(Math.max(-1, Math.min(1, n(f.V.y)))) * 180 / Math.PI),
    rotert: !f.rotert,
    // skjøtlinjene hører til den GAMLE retningen og gjelder ikke lenger — og det
    // gjør radrutenettet også. Etter en rotasjon legges radene fra mønet, og da
    // møtes de to halvdelene uten et delt anker.
    skjotU: undefined, radAnker: undefined,
    // kantlinjene leses på NYTT i den nye rammen — se kanterEtterRotasjon
    kantLav: nyeKanter ? nyeKanter.kantLav : undefined,
    kantHoy: nyeKanter ? nyeKanter.kantHoy : undefined
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

// Åsene som LINJER i verden — for å vite hvilke rader de faktisk ligger under.
//
// 🔎 EMILS FUNN 23.09 (Valle): en ås på 1 900 mm i det ene hjørnet delte
// platene i ALLE radene, 30 m ut på taket der det ikke fantes stål under
// skjøten. En ås bærer en skjøt bare der den ligger — se platerPaFlate.
export function aserVerden(flate, linjer, o) {
  return skjotKandidater(flate, linjer, o).map(l =>
    [rund(l.lav.x), rund(l.lav.z), rund(l.hoy.x), rund(l.hoy.z)]);
}

function skjotKandidater(flate, linjer, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!flate || !flate.U || !flate.V || !flate.origo) return [];
  const U = flate.U, V = flate.V, oo = flate.origo, N = flate.N || { x: 0, y: 1, z: 0 };
  const tol = Math.sin(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  const planTol = n(opp.skjotPlanTolMm) > 0 ? n(opp.skjotPlanTolMm) : SKJOT_PLAN_TOL_MM;
  const langs = (p, A) => (p.x - oo.x) * A.x + (p.y - oo.y) * A.y + (p.z - oo.z) * A.z;
  return (linjer || []).filter(l => {
    if (!l || !l.lav || !l.hoy) return false;
    if (Math.abs(l.ux * U.x + l.uy * U.y + l.uz * U.z) > tol) return false;
    if (Math.abs(langs(l.lav, N)) > planTol || Math.abs(langs(l.hoy, N)) > planTol) return false;
    const v1 = langs(l.lav, V), v2 = langs(l.hoy, V);
    return !(Math.max(v1, v2) < n(flate.v0) || Math.min(v1, v2) > n(flate.v1));
  });
}

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

// Hvor langt rekker taket ved v? Rett interpolasjon mellom sperrene, klamret
// utenfor den ytterste. Kanten er en polylinje [[v, u], …] sortert på v.
export function kantU(kant, v) {
  const K = Array.isArray(kant) ? kant : null;
  if (!K || !K.length) return null;
  const x = n(v);
  if (K.length === 1 || x <= n(K[0][0])) return n(K[0][1]);
  const siste = K[K.length - 1];
  if (x >= n(siste[0])) return n(siste[1]);
  for (let i = 1; i < K.length; i++) {
    const a = K[i - 1], b = K[i];
    if (x > n(b[0])) continue;
    const d = n(b[0]) - n(a[0]);
    return d > 1e-9 ? n(a[1]) + (n(b[1]) - n(a[1])) * (x - n(a[0])) / d : n(b[1]);
  }
  return n(siste[1]);
}

// Vinkelen på et skråkapp, i grader med én desimal. Samme formel som
// skraVinkel() i js/veggelement/regler.js bruker på veggelementene — den er
// skrevet opp igjen her fordi sw-tak.js ikke importerer noe.
export function kappVinkel(breddeMm, aMm, bMm) {
  const L = Math.abs(n(breddeMm));
  if (!L) return 0;
  return Math.round(Math.atan2(Math.abs(n(bMm) - n(aMm)), L) * 1800 / Math.PI) / 10;
}

export function vinkelTekstTak(grader) {
  return (n(grader)).toFixed(1).replace(".", ",") + "\u00b0";
}

// ═══════ 🏔 MØNET: TO TAKHALVDELER SOM FAKTISK MØTES ═══════
//
// 🔎 EMILS FUNN 22.09 (bilde 1): «bølgene på TRP-platene på begge sidene av
// taket er ikke flush med hverandre.»
//
// Målt på hans egen lagring for Sundland: den ene takhalvdelen rakk til
// z = 12 071, den andre til z = 11 901. De to flatene OVERLAPPET hverandre med
// 170 mm i mønet — begge la plater i det samme feltet, i hver sin bølgetakt.
//
// 100 av de 170 er `utstikkGesimsMm`: flateFraGruppe legger utstikket på BEGGE
// ender av fallet. Nede ved gesimsen er det riktig. Oppe i mønet er det ikke
// et utstikk i det hele tatt — der møter taket det andre taket. De siste
// 70 mm er modellen selv: sperrene er tegnet med endene sine litt forbi
// hverandre i mønet.
//
// Her klippes derfor den HØYE enden av hver flate til der de to planene
// KRYSSER hverandre — den ekte mønelinja. Da møtes halvdelene i én linje, og
// når radene i tillegg legges fra mønet (se platerPaFlate), står bølgene i
// takt over mønet.
//
// Bare flater som faller MOT hverandre klippes: U-ene må peke motsatt vei
// (innenfor `retningTolGrader`), og krysset må ligge nær den høye enden som
// er der fra før. En valm har hipp på skrå av U og røres ikke — den trimmes
// som før av flateEier, plate for plate.
export function klippMoner(flater, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const F = (flater || []).filter(Boolean);
  if (F.length < 2) return F;
  const slark = Math.max(10, n(opp.valmTolMm));
  // Krysset må ligge ved den høye enden. Rommet er nå bjelkenes egen
  // overlapp i mønet — utstikket er borte, så terskelen er bare slarken pluss
  // en halv platebredde som tar sperrer som er modellert litt forbi hverandre.
  const naer = slark + 300;
  const motsatt = -Math.cos(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  return F.map((f, fi) => {
    if (!f.U || !f.V || !f.origo) return f;
    const opp2 = n(f.U.y) >= 0;                     // høy ende er u1 når U peker opp
    const uH = opp2 ? n(f.u1) : n(f.u0);
    const vm = (n(f.v0) + n(f.v1)) / 2;
    let beste = null;
    for (let gi = 0; gi < F.length; gi++) {
      if (gi === fi) continue;
      const g = F[gi];
      if (!g.U || !g.origo) continue;
      if (f.U.x * g.U.x + f.U.y * g.U.y + f.U.z * g.U.z > motsatt) continue;
      // høydene langs linja v = vm er begge rette i u — to prøver holder
      const h = (u) => {
        const pt = punktPaFlate(f, u, vm);
        const hg = planHoydeVed(g, pt.x, pt.z);
        return hg === null ? null : [pt.y, hg];
      };
      const a = h(uH), b = h(uH - 1000);
      if (!a || !b) continue;
      const d1 = a[0] - a[1], d0 = b[0] - b[1];
      if (!(Math.abs(d1 - d0) > 1e-9)) continue;    // planene er parallelle
      const uK = uH - 1000 + 1000 * (0 - d0) / (d1 - d0);
      // krysset må ligge ved den høye enden, ikke midt inne på taket
      const inn = opp2 ? uH - uK : uK - uH;
      if (!(inn > -slark && inn < naer)) continue;
      if (beste === null || Math.abs(uK - uH) < Math.abs(beste - uH)) beste = uK;
    }
    if (beste === null) return f;
    const u0 = opp2 ? n(f.u0) : rund(beste);
    const u1 = opp2 ? rund(beste) : n(f.u1);
    const lengdeMm = rund(u1 - u0);
    if (!(lengdeMm > 0)) return f;
    // kantlinja i den enden følger med inn til mønet — ellers ville platene
    // fortsatt blitt kappet mot den gamle, for lange kanten
    const klipp = (kant, tak) => Array.isArray(kant)
      ? kant.map(([v, u]) => [v, tak ? Math.min(n(u), rund(beste)) : Math.max(n(u), rund(beste))])
      : kant;
    return { ...f, u0, u1, lengdeMm, moneKlipp: rund(Math.abs(beste - uH)),
      kantHoy: opp2 ? klipp(f.kantHoy, true) : f.kantHoy,
      kantLav: opp2 ? f.kantLav : klipp(f.kantLav, false),
      arealM2: rund(lengdeMm * n(f.breddeMm) / 1e6) };
  });
}

// ═══════ 🔁 BEGGE TAKHALVDELENE LEGGES SAMME VEI ═══════
//
// 🔎 EMILS FUNN 22.09, ANDRE RUNDE: «de to sidene lastes inn speilvendt av
// hverandre — den ene starter fra høyre til venstre og den andre fra venstre
// til høyre.» Han har rett, og det er hele forklaringen på at bølgene ikke
// møtes.
//
// Målt på Sundland: `tverretning()` gir V av U, og når de to sperrene faller
// hver sin vei, peker V-ene også hver sin vei — den ene mot −X, den andre mot
// +X. Radene legges fra `v0`, altså fra hver SIN ende av bygget. Rutenettet
// den ene siden legger fra x = 35 966 og nedover møter rutenettet den andre
// legger fra x = −18 150 og oppover, og de to landet 116 mm fra hverandre.
// Samme grunn gjorde merketeksten speilvendt på den ene halvdelen.
//
// To grep, i denne rekkefølgen:
//   1. ensrettFlater()    — V peker samme vei i verden på alle flater
//   2. deltRadrutenett()  — to halvdeler som deler et møne deler også rutenettet
//
// Faller V (etter «Roter takflata 90°»), er retningen gitt av fallet og skal
// ikke snus. Da er det også unødvendig: radene legges fra mønet på begge sider,
// og da møtes de av seg selv.
export function ensrettFlater(flater) {
  return (flater || []).map(f => {
    if (!f || !f.V) return f;
    if (Math.abs(n(f.V.y)) > 1e-6) return f;          // V bærer fallet — la den stå
    const kanonisk = Math.abs(n(f.V.x)) > 1e-6 ? n(f.V.x) > 0 : n(f.V.z) >= 0;
    if (kanonisk) return f;
    const snu = (kant) => Array.isArray(kant)
      ? kant.map(([v, u]) => [rund(-n(v)), n(u)]).sort((a, b) => a[0] - b[0])
      : kant;
    return { ...f, speilet: true,
      V: { x: -n(f.V.x), y: -n(f.V.y), z: -n(f.V.z) },
      v0: rund(-n(f.v1)), v1: rund(-n(f.v0)),
      kantLav: snu(f.kantLav), kantHoy: snu(f.kantHoy) };
  });
}

// Faller de to flatene MOT hverandre? Samme prøve som møneklippet bruker.
function motHverandre(f, g, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!f || !g || !f.U || !g.U) return false;
  const motsatt = -Math.cos(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  return f.U.x * g.U.x + f.U.y * g.U.y + f.U.z * g.U.z <= motsatt;
}

// To halvdeler som deler et møne skal ha radene på SAMME rutenett langs mønet.
// `radAnker` er v-verdien der rutenettet begynner; platerPaFlate legger radene
// derfra. Den første flata i paret bestemmer, og naboen får den samme linja
// regnet om til sine egne koordinater.
export function deltRadrutenett(flater, o) {
  const F = (flater || []).filter(Boolean);
  if (F.length < 2) return F;
  const ut = F.map(f => ({ ...f }));
  for (let i = 0; i < ut.length; i++) {
    const f = ut[i];
    if (!f.V || Math.abs(n(f.V.y)) > 1e-6) continue;   // bare når V løper langs mønet
    if (!tallEr(f.radAnker)) f.radAnker = rund(n(f.v0));
    for (let j = i + 1; j < ut.length; j++) {
      const g = ut[j];
      if (!g.V || tallEr(g.radAnker)) continue;
      if (Math.abs(n(g.V.y)) > 1e-6) continue;
      if (!motHverandre(f, g, o)) continue;
      // Verdenspunktet der f sitt rutenett begynner, lest i g sine koordinater.
      //
      // Punktet tas ved MØNET, ikke midt på flata. De to V-aksene er ikke helt
      // parallelle — på Sundland skiller de 0,16°, fordi sperrene er modellert
      // slik — og da avhenger svaret av hvilket punkt man måler i. I mønet
      // MÅ rutenettene falle sammen; det er der bølgene møtes. Resten av
      // skjevheten er bygget selv, og den kan ikke regnes bort.
      const uH = n(f.U.y) >= 0 ? n(f.u1) : n(f.u0);
      const pt = punktPaFlate(f, uH, n(f.radAnker));
      const uv = uvPaFlate(g, pt.x, pt.z);
      if (!uv) continue;
      g.radAnker = rund(uv[1]);
    }
  }
  return ut;
}

// ═══════════════════════════════════════════════════════════════════════
// 🖼 REGEL 3, ANDRE UTGAVE: TAKET ER RAMMEN AV TOPPBJELKER (Emil 23.09)
// ═══════════════════════════════════════════════════════════════════════
//
// «jeg prøver å få generatoren til kun å generere TRP-plater som går fra
// toppbjelke til toppbjelke og stopper på utvendig kant av toppbjelkene som
// lager rammen til taket» (Emil 23.09, Valle bilde 1–4).
//
// FØR: omrisset ble lest av SPERRENE alene. Hver sperre ga ett punkt i hver
// ende, og mellom to sperrer ble det trukket en rett strek. Målt på Valle:
//   • den skrå toppbjelken var ikke med i det hele tatt — streken mellom
//     sperreendene lå opptil 660 mm UTENFOR den, og innenfor den ellers
//     (sperrene slutter på bjelkens innside, ikke på dens utvendige flate)
//   • etter «Roter takflata 90°» ble streken prøvd på nytt i 48 punkter, og
//     hvert hjørne ble til en skrå linje — platene ble ikke firkantet
//   • en kort ås (1,9 m) delte platene på HELE flata, 30 m ut i løse lufta
//
// NÅ: omrisset er et polygon i VERDEN (plan, x/z), bygget av ALLE
// toppbjelkene som ligger i flatas plan — sperrer, åser, kantbjelker og skrå
// bjelker, uansett retning. Fire faste steg, ingen av dem vet noe om bygget:
//
//   1. Rammen tegnes i et rutenett: fotavtrykket til hver bjelke i planet.
//   2. Glippene i bjelkeskjøtene lukkes (opp til 2 × RAMME_LUKK_MM), og alt
//      som er INNESTENGT av rammen fylles. Det er taket.
//   3. To flater som gjør krav på samme sted deler det der de møtes: punktet
//      tilhører flata med nærmeste egne sperre.
//   4. Kanten leses ut som et polygon og legges på bjelkenes UTVENDIGE flate.
//      Hakk og trinn under RAMME_HAKK_MM er skjøter i stålet, ikke form på
//      taket, og rettes ut.
//
// Polygonet ligger i verden, så «Roter takflata 90°» og speilingen rører det
// ikke — det er det samme taket sett den andre veien, nøyaktig.
//
// Mangler rammen en side (ingen kantbjelke), lukkes den med en rett linje
// mellom sperreendene — det er det samme omrisset som før.

export const RAMME_PLAN_TOL_MM = 100;  // en bjelke ligger «i flata» innenfor dette
export const RAMME_LUKK_MM = 300;      // glipper i bjelkeskjøtene opp til 2 × dette lukkes
export const RAMME_HAKK_MM = 600;      // hakk/trinn i omrisset under dette rettes ut
export const RAMME_NAER_MM = 3000;     // rammebjelker lenger enn dette fra flatas sperrer er ikke med

// ── rutenett ────────────────────────────────────────────────────────────
function lagRute(minX, minZ, maxX, maxZ, celle) {
  const nx = Math.max(1, Math.ceil((maxX - minX) / celle));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / celle));
  return { x0: minX, z0: minZ, c: celle, nx, nz, m: new Uint8Array(nx * nz) };
}

function avstSegment(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-9 ? ((px - a.x) * dx + (pz - a.z) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

// Fyll cellene et plan-polygon dekker. En celle regnes med når midten ligger
// inne, eller nærmere kanten enn en halv celle — ellers forsvinner en smal
// bjelke mellom to cellemidter.
function malPolygon(R, poly, strengt) {
  const P = (poly || []).filter(Boolean);
  if (!P.length) return;
  const xs = P.map(q => n(q.x)), zs = P.map(q => n(q.z));
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - R.x0) / R.c) - 1);
  const i1 = Math.min(R.nx - 1, Math.ceil((Math.max(...xs) - R.x0) / R.c) + 1);
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - R.z0) / R.c) - 1);
  const j1 = Math.min(R.nz - 1, Math.ceil((Math.max(...zs) - R.z0) / R.c) + 1);
  const halv = R.c * 0.5;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = R.x0 + (i + 0.5) * R.c, z = R.z0 + (j + 0.5) * R.c;
    let med = P.length >= 3 && iPlanPolygon(P, x, z);
    if (!med && !strengt) for (let k = 0; k < P.length && !med; k++)
      if (avstSegment(x, z, P[k], P[(k + 1) % P.length]) <= halv) med = true;
    if (med) R.m[j * R.nx + i] = 1;
  }
}

// Kvadrert avstand (i celler) fra hver celle til nærmeste celle der
// `m[k] === sett`. Felzenszwalb & Huttenlocher, én akse om gangen.
function avstandKart(R, m, sett) {
  const { nx, nz } = R, STOR = 1e20;
  const D = new Float64Array(nx * nz);
  for (let k = 0; k < D.length; k++) D[k] = m[k] === sett ? 0 : STOR;
  const N = Math.max(nx, nz);
  const f = new Float64Array(N), d = new Float64Array(N);
  const v = new Int32Array(N), z = new Float64Array(N + 1);
  const en = (len) => {
    let k = 0; v[0] = 0; z[0] = -STOR; z[1] = STOR;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k] && k > 0) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      if (s <= z[k]) { v[0] = q; z[0] = -STOR; z[1] = STOR; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = STOR;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = Math.min(STOR, dq * dq + f[v[k]]);
    }
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) f[i] = D[j * nx + i];
    en(nx);
    for (let i = 0; i < nx; i++) D[j * nx + i] = d[i];
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) f[j] = D[j * nx + i];
    en(nz);
    for (let j = 0; j < nz; j++) D[j * nx + i] = d[j];
  }
  return D;
}

// Alt som IKKE er innestengt: fylles fra kanten av rutenettet.
function utenfor(R, sperre) {
  const { nx, nz } = R;
  const ute = new Uint8Array(nx * nz);
  const ko = [];
  const legg = (i, j) => {
    const k = j * nx + i;
    if (ute[k] || sperre[k]) return;
    ute[k] = 1; ko.push(k);
  };
  for (let i = 0; i < nx; i++) { legg(i, 0); legg(i, nz - 1); }
  for (let j = 0; j < nz; j++) { legg(0, j); legg(nx - 1, j); }
  while (ko.length) {
    const k = ko.pop(), i = k % nx, j = (k - i) / nx;
    if (i > 0) legg(i - 1, j);
    if (i < nx - 1) legg(i + 1, j);
    if (j > 0) legg(i, j - 1);
    if (j < nz - 1) legg(i, j + 1);
  }
  return ute;
}

// Den største sammenhengende biten — en løs flekk er ikke tak.
function storsteBit(R, m) {
  const { nx, nz } = R;
  const merke = new Int32Array(nx * nz);
  let beste = 0, besteN = 0, nr = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || merke[s]) continue;
    nr++;
    let ant = 0;
    const ko = [s]; merke[s] = nr;
    while (ko.length) {
      const k = ko.pop(); ant++;
      const i = k % nx, j = (k - i) / nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1];
      for (const q of nb) if (q >= 0 && m[q] && !merke[q]) { merke[q] = nr; ko.push(q); }
    }
    if (ant > besteN) { besteN = ant; beste = nr; }
  }
  const ut = new Uint8Array(nx * nz);
  if (beste) for (let k = 0; k < m.length; k++) if (merke[k] === beste) ut[k] = 1;
  return ut;
}

// Kanten av cellene som et polygon (celle-hjørner), mot klokka i (x, z).
function kantPolygon(R, m) {
  const { nx, nz, c, x0, z0 } = R;
  const har = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && m[j * nx + i] === 1;
  const W = nx + 1;
  const ut = new Map();                     // hjørne → liste av neste hjørner
  const kant = (a, b) => { let l = ut.get(a); if (!l) ut.set(a, l = []); l.push(b); };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!har(i, j)) continue;
    if (!har(i, j - 1)) kant(j * W + i, j * W + i + 1);
    if (!har(i + 1, j)) kant(j * W + i + 1, (j + 1) * W + i + 1);
    if (!har(i, j + 1)) kant((j + 1) * W + i + 1, (j + 1) * W + i);
    if (!har(i - 1, j)) kant((j + 1) * W + i, j * W + i);
  }
  let beste = null, besteA = 0;
  const brukt = new Set();
  for (const [start, liste] of ut) {
    for (let li = 0; li < liste.length; li++) {
      if (brukt.has(start + ":" + li)) continue;
      const sloyfe = [];
      let a = start, idx = li, vakt = 0;
      while (vakt++ < 4 * nx * nz + 8) {
        const l = ut.get(a);
        if (!l || idx >= l.length) break;
        const nokkel = a + ":" + idx;
        if (brukt.has(nokkel)) break;
        brukt.add(nokkel);
        sloyfe.push(a);
        const b = l[idx];
        if (b === start) break;
        const lb = ut.get(b) || [];
        // ved et klemmepunkt (to celler møtes i et hjørne): ta den første
        // kanten som ikke er brukt
        idx = 0;
        while (idx < lb.length && brukt.has(b + ":" + idx)) idx++;
        a = b;
      }
      if (sloyfe.length < 4) continue;
      const P = sloyfe.map(k => ({ x: x0 + (k % W) * c, z: z0 + Math.floor(k / W) * c }));
      const A = arealPlan(P);
      if (A > besteA) { besteA = A; beste = P; }
    }
  }
  return beste;
}

export function arealPlan(P) {
  let A = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    A += n(a.x) * n(b.z) - n(b.x) * n(a.z);
  }
  return A / 2;
}

// Douglas–Peucker på et lukket polygon.
function forenkle(P, tol) {
  if (!P || P.length < 4) return P;
  let fjern = 0, dm = -1;
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i].x - P[0].x, P[i].z - P[0].z);
    if (d > dm) { dm = d; fjern = i; }
  }
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    let k = -1, maks = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = avstSegment(pts[i].x, pts[i].z, a, b);
      if (d > maks) { maks = d; k = i; }
    }
    if (maks <= tol) return [a, b];
    const v = dp(pts.slice(0, k + 1)), h = dp(pts.slice(k));
    return v.slice(0, -1).concat(h);
  };
  const en = dp(P.slice(0, fjern + 1));
  const to = dp(P.slice(fjern).concat([P[0]]));
  return en.slice(0, -1).concat(to.slice(0, -1));
}

// ── linjer ──────────────────────────────────────────────────────────────
function linjeKryss(A, B) {
  const det = A.d.x * B.d.z - A.d.z * B.d.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((B.p.x - A.p.x) * B.d.z - (B.p.z - A.p.z) * B.d.x) / det;
  return { x: A.p.x + A.d.x * t, z: A.p.z + A.d.z * t };
}
const kryssV = (a, b) => a.x * b.z - a.z * b.x;
const prikkV = (a, b) => a.x * b.x + a.z * b.z;

// Legg hver kant av det forenklede polygonet på den bjelkeflaten den ligger
// langs — den YTTERSTE, for det er den utvendige flaten taket skal ut til.
function leggPaFlater(P, flater, tolMm, annen, celle, raa, K) {
  const ut = [];
  const idx = raa ? new Map(raa.map((q, i) => [q, i])) : null;
  // rett linje gjennom rutenettets egne kantpunkter mellom a og b (minste
  // kvadrater) — for en delt kant, der det ikke finnes noen bjelkeflate
  const tilpass = (a, b) => {
    if (!idx || !idx.has(a) || !idx.has(b)) return null;
    const pts = [];
    for (let i = idx.get(a), vakt = 0; vakt <= raa.length; i = (i + 1) % raa.length, vakt++) {
      pts.push(raa[i]);
      if (raa[i] === b) break;
    }
    if (pts.length < 3) return null;
    let mx = 0, mz = 0;
    for (const q of pts) { mx += q.x; mz += q.z; }
    mx /= pts.length; mz /= pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const q of pts) { const dx = q.x - mx, dz = q.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    return { p: { x: mx, z: mz }, d: { x: Math.cos(th), z: Math.sin(th) } };
  };
  const sinTol = Math.sin(4 * Math.PI / 180);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(L > 1e-6)) continue;
    const d = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const ytre = { x: d.z, z: -d.x };           // høyre side = utsiden (polygonet går mot klokka)
    const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    // 🤝 en kant mot NABOFLATA er ingen bjelkeflate — der møtes to tak, og
    // delingen er allerede gjort (nærmeste sperre). Den skal ikke flyttes ut
    // til en bjelkeflate, for da overlapper de to flatene.
    const ut1 = (t) => ({ x: a.x + (b.x - a.x) * t + ytre.x * 1.5 * celle, z: a.z + (b.z - a.z) * t + ytre.z * 1.5 * celle });
    const naboer = annen ? [0.25, 0.5, 0.75].map(t => { const q = ut1(t); return annen(q.x, q.z); }).filter(Boolean) : [];
    const delt = naboer.length >= 2;
    let best = null, bestS = -Infinity, bestOv = 0;
    if (L >= tolMm && !delt) for (const f of flater) {
      if (Math.abs(kryssV(d, f.d)) > sinTol) continue;
      const s = prikkV({ x: f.a.x - m.x, z: f.a.z - m.z }, ytre);
      if (Math.abs(s) > tolMm) continue;
      // flaten må faktisk ligge langs kanten, ikke bare på samme linje et
      // annet sted på bygget
      const t1 = prikkV({ x: f.a.x - a.x, z: f.a.z - a.z }, d);
      const t2 = prikkV({ x: f.b.x - a.x, z: f.b.z - a.z }, d);
      const ov = Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
      if (ov < 0.3 * Math.min(L, f.L)) continue;
      // Den flaten som ligger langs MEST av kanten vinner; er to like lange,
      // den ytterste. En kort, litt skjev bjelke i enden av en lang takfot
      // (Norsjø: 6,3 m med 20 mm skjevhet ved en 32 m takfot) skal ikke få
      // vippe hele kanten.
      const bedre = !best || ov > bestOv * 1.1 || (ov >= bestOv * 0.9 && s > bestS);
      if (bedre) { bestS = s; best = f; bestOv = ov; }
    }
    const fit = delt ? (delingsLinje(K, naboer[0], a, b, ytre, celle) || tilpass(a, b)) : null;
    if (fit) {
      const dd = prikkV(fit.d, d) >= 0 ? fit.d : { x: -fit.d.x, z: -fit.d.z };
      ut.push({ p: fit.p, d: dd, paaFlate: false, delt });
      continue;
    }
    const dd = best ? (prikkV(best.d, d) >= 0 ? best.d : { x: -best.d.x, z: -best.d.z }) : d;
    ut.push({ p: best ? { x: best.a.x, z: best.a.z } : a, d: dd, paaFlate: !!best, delt });
  }
  return ut;
}

function hjornerAv(L) {
  const P = [];
  for (let i = 0; i < L.length; i++) {
    const A = L[(i - 1 + L.length) % L.length], B = L[i];
    const X = linjeKryss(A, B);
    P.push(X || { x: B.p.x, z: B.p.z });
  }
  return P;
}

// Hakk og trinn under `hakkMm` rettes ut. En kort kant mellom to kanter som
// krysser hverandre fjernes (hjørnet blir krysset deres). En kort kant mellom
// to PARALLELLE kanter er et trinn — da vinner den ytterste.
function rettUt(L0, hakkMm) {
  let L = L0.slice();
  const parallell = (A, B) => Math.abs(kryssV(A.d, B.d)) < Math.sin(8 * Math.PI / 180);
  const sammeLinje = (A, B) => parallell(A, B) &&
    Math.abs(kryssV(A.d, { x: B.p.x - A.p.x, z: B.p.z - A.p.z })) < 20;
  for (let runde = 0; runde < 400 && L.length > 3; runde++) {
    // slå sammen naboer som er samme linje
    let slatt = false;
    for (let i = 0; i < L.length && L.length > 3; i++) {
      const j = (i + 1) % L.length;
      if (sammeLinje(L[i], L[j])) {
        if (!L[i].paaFlate && L[j].paaFlate) L[i] = L[j];
        L.splice(j, 1); slatt = true; break;
      }
    }
    if (slatt) continue;
    const P = hjornerAv(L);
    // Kandidatene: korte kanter, og skråkanter som ikke ligger på noen
    // bjelke (rutenettets avfasing av et hjørne). En lang kant på en ekte
    // bjelkeflate røres aldri.
    let kort = -1, kortL = Infinity;
    for (let i = 0; i < L.length; i++) {
      if (L[i].laast) continue;
      const a = P[i], b = P[(i + 1) % L.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      // en kant som snur retning (kryssene ligger «baklengs») er også et hakk
      const bak = prikkV({ x: b.x - a.x, z: b.z - a.z }, L[i].d) < 0;
      const lengde = bak ? 0 : len;
      const kandidat = lengde < hakkMm || (!L[i].paaFlate && !L[i].delt && lengde < 3 * hakkMm);
      if (kandidat && lengde < kortL) { kortL = lengde; kort = i; }
    }
    if (kort < 0) break;
    const iF = (kort - 1 + L.length) % L.length, iN = (kort + 1) % L.length;
    const F = L[iF], N = L[iN];
    if (!parallell(F, N)) {
      const X = linjeKryss(F, N);
      const a = P[kort], b = P[(kort + 1) % L.length];
      // hjørnet er krysset av naboene — så lenge det bare flytter en liten
      // trekant (et hakk i en bjelkeskjøt), ikke en bit av taket
      const tri = X ? Math.abs(kryssV({ x: a.x - X.x, z: a.z - X.z }, { x: b.x - X.x, z: b.z - X.z })) / 2 : Infinity;
      const langt = X ? Math.max(Math.hypot(a.x - X.x, a.z - X.z), Math.hypot(b.x - X.x, b.z - X.z)) : Infinity;
      if (tri <= hakkMm * hakkMm / 2 && langt <= 2 * hakkMm) { L.splice(kort, 1); continue; }
      L[kort] = { ...L[kort], laast: true };
      continue;
    }
    // trinn: den ytterste av de to parallelle kantene vinner — men ikke mot
    // naboflata, der er delingen allerede gjort
    const ytre = { x: F.d.z, z: -F.d.x };
    const s = prikkV({ x: N.p.x - F.p.x, z: N.p.z - F.p.z }, ytre);
    // En kant på en ekte bjelkeflate slår alltid en kant som bare er
    // rutenettets (en bjelkeende som stikker opp) — ellers den ytterste.
    // Mot naboflata er trinnet ekte: der slutter den ene flata på sin
    // bjelkeflate og den andre deler med naboen. Det står.
    if (F.delt !== N.delt) { L[kort] = { ...L[kort], laast: true }; continue; }
    const vinner = (F.paaFlate !== N.paaFlate) ? (F.paaFlate ? F : N) : (s > 0 ? N : F);
    const fjern = [kort, iN].sort((x, y) => y - x);
    L[iF] = { ...vinner, d: F.d };
    for (const k of fjern) L.splice(k, 1);
    if (fjern[0] < iF || fjern[1] < iF) { /* indeksene over er allerede riktige */ }
  }
  return L;
}

// Er bjelken en del av flatas plan? Begge ender (og midten) innenfor tol.
function iFlatensPlan(f, l, tol) {
  if (!f || !f.N || !f.origo || !l || !l.lav || !l.hoy) return false;
  const d = (p) => (n(p.x) - f.origo.x) * f.N.x + (n(p.y) - f.origo.y) * f.N.y + (n(p.z) - f.origo.z) * f.N.z;
  return Math.abs(d(l.lav)) <= tol && Math.abs(d(l.hoy)) <= tol;
}

function fotAv(l) {
  return (l && l.fot && l.fot.length >= 3) ? l.fot
    : (l && l.lav && l.hoy ? [{ x: l.lav.x, z: l.lav.z }, { x: l.hoy.x, z: l.hoy.z }] : []);
}

// Avstanden fra et punkt til flatas sperrefelt (0 inne i det).
function feltAvst(K, x, z) {
  let d = Infinity;
  for (const p of K.felt) {
    if (p.length >= 3 && iPlanPolygon(p, x, z)) return 0;
    for (let k = 0; k < p.length; k++) d = Math.min(d, avstSegment(x, z, p[k], p[(k + 1) % p.length]));
  }
  return d;
}

// Vinner flate K over G i punktet (x, z)?
//
// Nærmeste sperrefelt vinner. Ligger punktet INNE i begge feltene (sperrer
// som krysser hverandre i et valmhjørne), avgjør planene selv: på et tak som
// buer UT (møne, valm) er taket det LAVESTE planet — det andre ligger over
// taket der. På et tak som buer INN (renne) er det det HØYESTE.
function vinnerAv(K, G, x, z) {
  const dk = feltAvst(K, x, z), dg = feltAvst(G, x, z);
  if (dk > 1 || dg > 1) return dk < dg || (dk === dg && K.fi < G.fi);
  const hk = planHoydeVed(K.f, x, z), hg = planHoydeVed(G.f, x, z);
  if (hk === null || hg === null) return K.fi < G.fi;
  const hGmegSelv = planHoydeVed(G.f, K.midt.x, K.midt.z), hKmegSelv = planHoydeVed(K.f, K.midt.x, K.midt.z);
  const utover = hGmegSelv !== null && hKmegSelv !== null && hGmegSelv > hKmegSelv;
  if (Math.abs(hk - hg) < 1e-6) return K.fi < G.fi;
  return utover ? hk < hg : hk > hg;
}

// Eier K punktet når naboen er G? Ja der G ikke har tak i det hele tatt
// (G sitt eget, rettede omriss), ellers etter vinnerAv.
function eierAv(K, G, x, z) {
  if (G.P1 && !iPlanPolygon(G.P1, x, z)) return true;
  return vinnerAv(K, G, x, z);
}

// Delingslinja mellom K og naboen G langs en kant fra a til b: der
// eierskapet faktisk skifter, funnet ved halvering i ni punkter. Begge
// flatene regner den SAMME linja — da møtes de uten glipe og uten overlapp.
function delingsLinje(K, G, a, b, ytre, celle) {
  if (!K || !G) return null;
  const pts = [];
  const r = 4 * celle;
  for (let s = 1; s <= 9; s++) {
    const t = s / 10;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    let inn = { x: p.x - ytre.x * r, z: p.z - ytre.z * r };
    let ut = { x: p.x + ytre.x * r, z: p.z + ytre.z * r };
    if (!eierAv(K, G, inn.x, inn.z) || eierAv(K, G, ut.x, ut.z)) continue;
    for (let k = 0; k < 30; k++) {
      const m = { x: (inn.x + ut.x) / 2, z: (inn.z + ut.z) / 2 };
      if (eierAv(K, G, m.x, m.z)) inn = m; else ut = m;
    }
    pts.push({ x: (inn.x + ut.x) / 2, z: (inn.z + ut.z) / 2 });
  }
  if (pts.length < 2) return null;
  let mx = 0, mz = 0;
  for (const q of pts) { mx += q.x; mz += q.z; }
  mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const q of pts) { const dx = q.x - mx, dz = q.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { p: { x: mx, z: mz }, d: { x: Math.cos(th), z: Math.sin(th) } };
}

// Mønelinja mellom flate f og en nabo g som faller MOT den: der de to planene
// skjærer hverandre, i plan, over hele lengden de to spenner over sammen.
// Null når de ikke møtes i et møne (samme fall, parallelle plan, eller
// krysset ligger ikke ved den høye enden av sperrene).
function moneLinje(f, sf, g, sg, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  if (!f || !g || !f.U || !g.U || !sf.length || !sg.length) return null;
  const motsatt = -Math.cos(Math.max(0, n(opp.retningTolGrader)) * Math.PI / 180);
  if (f.U.x * g.U.x + f.U.y * g.U.y + f.U.z * g.U.z > motsatt) return null;
  // hvor langt opp fallet f når, og hvor på tvers de to spenner
  let uH = -Infinity;
  const vs = [];
  for (const b of sf) {
    const q = uvVannrett(f, b.hoy.x, b.hoy.z);
    if (q) { uH = Math.max(uH, q[0]); vs.push(q[1]); }
  }
  for (const b of sg) for (const e of [b.lav, b.hoy]) {
    const q = uvVannrett(f, e.x, e.z);
    if (q) vs.push(q[1]);
  }
  if (!vs.length || !(uH > -Infinity)) return null;
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  // krysset langs u ved en gitt v: h_f(u) − h_g(u) er rett i u
  const kryss = (v) => {
    const d = (u) => {
      const p = punktPaFlate(f, u, v);
      const hg = planHoydeVed(g, p.x, p.z);
      return hg === null ? null : p.y - hg;
    };
    const a = d(uH - 1000), b = d(uH);
    if (a === null || b === null || !(Math.abs(b - a) > 1e-9)) return null;
    return uH - 1000 + 1000 * (0 - a) / (b - a);
  };
  const ua = kryss(v0), ub = kryss(v1);
  if (ua === null || ub === null) return null;
  // mønet må ligge ved den høye enden av sperrene, ikke midt på taket
  const naer = Math.max(10, n(opp.valmTolMm)) + 600;
  if (Math.abs(ua - uH) > naer || Math.abs(ub - uH) > naer) return null;
  const A = punktPaFlate(f, ua, v0), B = punktPaFlate(f, ub, v1);
  return [{ x: A.x, z: A.z }, { x: B.x, z: B.z }];
}

// Omrisset for alle flatene på en gang — de må deles der de møtes.
//
// `grupper[i].bjelker` er sperrene til `flater[i]`, `linjer` er toppbjelkene.
// Svaret er flatene med `omriss` ([[x, z], …] i verden) og utstrekningen
// u0…v1 lest av det. En flate der omrisset ikke lar seg lese står urørt.
export function omrissForFlater(flater, grupper, linjer, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const tol = RAMME_PLAN_TOL_MM, R = RAMME_LUKK_MM;
  const F = flater || [];
  const alleSperrer = new Set();
  for (const g of grupper || []) for (const b of (g && g.bjelker) || []) alleSperrer.add(b);
  const kart = F.map((f, fi) => {
    const sperrer = ((grupper[fi] && grupper[fi].bjelker) || []).filter(Boolean);
    if (!f || !f.U || !sperrer.length) return null;
    const egne = new Set(sperrer);
    // en sperre i en ANNEN flate er aldri ramme her — den bærer naboen, og
    // på et nesten flatt tak ligger den lett innenfor toleransen likevel
    // 📦 bare bjelker i nærheten av flatas egne sperrer — et stort, flatt bygg
    // har hele taket i samme plan, og da ville hver flate ellers regnet over
    // hele bygget. Rammen står inntil sperreendene; RAMME_NAER_MM er god margin.
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const b of sperrer) for (const q of fotAv(b)) {
      bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); bz0 = Math.min(bz0, q.z); bz1 = Math.max(bz1, q.z);
    }
    const M = RAMME_NAER_MM;
    const naer = (l) => fotAv(l).some(q => q.x >= bx0 - M && q.x <= bx1 + M && q.z >= bz0 - M && q.z <= bz1 + M);
    const ramme = (linjer || []).filter(l => egne.has(l) ||
      (!alleSperrer.has(l) && iFlatensPlan(f, l, tol) && naer(l)));
    const fot = ramme.map(fotAv).filter(p => p.length);
    // 🔗 SPERREENDENE SOM RESERVE. Mellom to nabosperrer trekkes en linje i
    // hver ende — men bare der det IKKE står en ekte bjelke langs den. Står
    // det en skrå bjelke der, er det den som er kanten.
    const andre = ramme.filter(l => !egne.has(l)).map(fotAv).filter(p => p.length);
    const naerAndre = (x, z) => andre.some(p => {
      if (p.length >= 3 && iPlanPolygon(p, x, z)) return true;
      for (let k = 0; k < p.length; k++) if (avstSegment(x, z, p[k], p[(k + 1) % p.length]) <= 2 * R) return true;
      return false;
    });
    const sortert = sperrer.map(b => {
      const uv = uvVannrett(f, (b.lav.x + b.hoy.x) / 2, (b.lav.z + b.hoy.z) / 2);
      return { b, v: uv ? uv[1] : 0 };
    }).sort((a, b) => a.v - b.v).map(x => x.b);
    const virtuelle = [];
    for (let k = 1; k < sortert.length; k++) for (const ende of ["lav", "hoy"]) {
      const a = sortert[k - 1][ende], b = sortert[k][ende];
      let naer = 0;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        if (naerAndre(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) naer++;
      }
      if (naer < 6) virtuelle.push([{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
    }
    // 🏔 MØNET ER DER TO TAKFALL MØTES — MED ELLER UTEN MØNEBJELKE (Emil
    // 23.09, Arendal: «er problemet fordi bjelken til mønet ikke går gjennom
    // hele bygget?»). Ja: der mønebjelken manglet, var rammen åpen langs
    // mønet, og taket fant en skråstiver i stedet. Møter flata en nabo som
    // faller mot den, legges skjæringslinja mellom de to planene inn som en
    // kant — over hele lengden de to spenner over sammen.
    for (let gi = 0; gi < F.length; gi++) {
      if (gi === fi) continue;
      const m = moneLinje(f, sperrer, F[gi], (grupper[gi] && grupper[gi].bjelker) || [], o);
      if (m) virtuelle.push(m);
    }
    const alle = fot.concat(virtuelle);
    const xs = [], zs = [];
    for (const p of alle) for (const q of p) { xs.push(n(q.x)); zs.push(n(q.z)); }
    if (!xs.length) return null;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const celle = Math.max(40, Math.ceil(Math.max(maxX - minX, maxZ - minZ) / 1200),
      Math.ceil(Math.sqrt((maxX - minX + 2 * R) * (maxZ - minZ + 2 * R) / 1.5e6)));
    const pad = R + 4 * celle;
    const Rt = lagRute(minX - pad, minZ - pad, maxX + pad, maxZ + pad, celle);
    for (const p of fot) malPolygon(Rt, p);
    for (const [a, b] of virtuelle) malPolygon(Rt, [a, b]);
    // 2. lukk glippene og fyll det innestengte
    const r2 = Math.pow(R / celle, 2);
    const dB = avstandKart(Rt, Rt.m, 1);
    const tykk = new Uint8Array(Rt.m.length);
    for (let k = 0; k < tykk.length; k++) tykk[k] = dB[k] <= r2 ? 1 : 0;
    const ute = utenfor(Rt, tykk);
    const dU = avstandKart(Rt, ute, 1);
    const tak = new Uint8Array(Rt.m.length);
    for (let k = 0; k < tak.length; k++) tak[k] = (dU[k] > r2 || Rt.m[k]) ? 1 : 0;
    // en bjelkeende som stikker ut av rammen er ikke tak: åpning med
    // en halv lukkeradius tar alt smalere enn det
    const r2b = Math.pow(R / 2 / celle, 2);
    const dI = avstandKart(Rt, tak, 0);
    const kjerne = new Uint8Array(tak.length);
    for (let k = 0; k < tak.length; k++) kjerne[k] = dI[k] > r2b ? 1 : 0;
    const dK = avstandKart(Rt, kjerne, 1);
    for (let k = 0; k < tak.length; k++) tak[k] = dK[k] <= r2b ? 1 : 0;
    // 🤝 HVEM EIER ET OMSTRIDT PUNKT? Avstanden til flatas eget SPERREFELT:
    // området sperrene spenner over, fra ende til ende. Ikke avstanden til
    // nærmeste sperre — den måles mest på tvers, og da ville nabosperrer
    // 200 mm forskjøvet i v ha flyttet delingen en meter inn på taket.
    // I en renne eller et møne der sperrene møtes ende mot ende, deler
    // dette nøyaktig midt mellom sperreendene. Se vinnerAv().
    const felt = sperrer.map(fotAv).filter(p => p.length);
    if (sortert.length >= 2)
      felt.push(sortert.map(b => ({ x: b.lav.x, z: b.lav.z }))
        .concat(sortert.slice().reverse().map(b => ({ x: b.hoy.x, z: b.hoy.z }))));
    let sx = 0, sz = 0;
    for (const b of sperrer) { sx += (b.lav.x + b.hoy.x) / 2; sz += (b.lav.z + b.hoy.z) / 2; }
    const midt = { x: sx / sperrer.length, z: sz / sperrer.length };
    const flaterB = [];
    const seg = (a, b) => {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L > 1) flaterB.push({ a, b, L, d: { x: (b.x - a.x) / L, z: (b.z - a.z) / L } });
    };
    for (const p of fot) for (let k = 0; k < p.length; k++) seg(p[k], p[(k + 1) % p.length]);
    for (const [a, b] of virtuelle) seg(a, b);
    const K = { f, fi, Rt, tak, felt, midt, flaterB };
    // ✅ FØRSTE RUNDE: flatas EGET omriss, rettet, tegnes tilbake i rutenettet.
    // Et hakk i en bjelkeskjøt i hjørnet skal ikke gi naboflata et stykke tak
    // den ikke har — da må hakket være rettet før de to deler.
    const P1 = rettPolygon(K, storsteBit(Rt, tak), null);
    K.P1 = P1;
    if (P1) {
      const Rp = { ...Rt, m: new Uint8Array(Rt.m.length) };
      malPolygon(Rp, P1, true);
      K.tak = Rp.m;
    }
    return K;
  });
  // 3. to flater som gjør krav på samme sted: nærmeste sperrefelt vinner
  const harTak = (G, x, z) => {
    const i = Math.floor((x - G.Rt.x0) / G.Rt.c), j = Math.floor((z - G.Rt.z0) / G.Rt.c);
    return i >= 0 && j >= 0 && i < G.Rt.nx && j < G.Rt.nz && G.tak[j * G.Rt.nx + i] === 1;
  };
  const endelig = kart.map((K) => {
    if (!K) return null;
    const { Rt } = K;
    const m = new Uint8Array(K.tak.length);
    for (let k = 0; k < m.length; k++) {
      if (!K.tak[k]) continue;
      const i = k % Rt.nx, j = (k - i) / Rt.nx;
      const x = Rt.x0 + (i + 0.5) * Rt.c, z = Rt.z0 + (j + 0.5) * Rt.c;
      let behold = true;
      for (const G of kart) {
        if (!G || G === K || !harTak(G, x, z)) continue;
        if (!vinnerAv(K, G, x, z)) { behold = false; break; }
      }
      if (behold) m[k] = 1;
    }
    return storsteBit(Rt, m);
  });
  // 4. kanten som polygon, lagt på bjelkenes utvendige flate
  return F.map((f, fi) => {
    const K = kart[fi], m = endelig[fi];
    if (!K || !m) return f;
    const annen = (x, z) => {
      for (let gi = 0; gi < kart.length; gi++) {
        const G = kart[gi];
        if (!G || gi === fi || !endelig[gi]) continue;
        const i = Math.floor((x - G.Rt.x0) / G.Rt.c), j = Math.floor((z - G.Rt.z0) / G.Rt.c);
        if (i >= 0 && j >= 0 && i < G.Rt.nx && j < G.Rt.nz && endelig[gi][j * G.Rt.nx + i] === 1) return G;
      }
      return null;
    };
    const P = rettPolygon(K, m, annen);
    return P ? medOmriss(f, P.map(q => [rund(q.x), rund(q.z)])) : f;
  });
}

// Rutenettets kant som et rettet polygon: forenklet, lagt på bjelkeflatene og
// med hakkene i bjelkeskjøtene rettet ut. Null når det ikke lar seg lese.
function rettPolygon(K, m, annen) {
  const raa = kantPolygon(K.Rt, m);
  if (!raa || raa.length < 4) return null;
  const enkel = forenkle(raa, 1.5 * K.Rt.c);
  const lagt = leggPaFlater(enkel, K.flaterB, Math.max(2 * K.Rt.c, 60), annen, K.Rt.c, raa, K);
  const linjerP = rettUt(lagt, RAMME_HAKK_MM);
  let P = hjornerAv(linjerP);
  const aRaa = arealPlan(raa), aP = arealPlan(P);
  // et rettet omriss som ikke lenger ligner rutenettet er en feil — da står
  // det forenklede omrisset (på rutenettets nøyaktighet) i stedet
  if (!(aP > 0) || Math.abs(aP - aRaa) > 0.08 * aRaa) P = enkel;
  return P;
}

// Utstrekning og areal lest av omrisset, i flatas egen (u, v).
export function medOmriss(f, omriss) {
  const UV = omriss.map(([x, z]) => uvVannrett(f, x, z)).filter(Boolean);
  if (UV.length < 3) return f;
  const us = UV.map(q => q[0]), vs = UV.map(q => q[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  let A = 0;
  for (let i = 0; i < UV.length; i++) {
    const a = UV[i], b = UV[(i + 1) % UV.length];
    A += a[0] * b[1] - b[0] * a[1];
  }
  return { ...f, omriss, u0: rund(u0), u1: rund(u1), v0: rund(v0), v1: rund(v1),
    lengdeMm: rund(u1 - u0), breddeMm: rund(v1 - v0), arealM2: rund(Math.abs(A) / 2 / 1e6) };
}

// Omrisset i flatas (u, v) — én gang per flate, ikke per plate.
export function omrissUV(f) {
  if (!f || !Array.isArray(f.omriss) || f.omriss.length < 3 || !f.U || !f.V) return null;
  const P = f.omriss.map(([x, z]) => uvVannrett(f, x, z)).filter(Boolean);
  return P.length >= 3 ? P : null;
}

// Hvor finnes det tak langs linja v = konstant? Intervaller [fra, til] i u.
export function spennVed(PUV, v, u0, u1) {
  if (!PUV) return [];
  const x = [];
  for (let i = 0; i < PUV.length; i++) {
    const a = PUV[i], b = PUV[(i + 1) % PUV.length];
    if ((a[1] > v) === (b[1] > v)) continue;
    x.push(a[0] + (v - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  x.sort((p, q) => p - q);
  const ut = [];
  for (let i = 0; i + 1 < x.length; i += 2) {
    let a = x[i], b = x[i + 1];
    if (tallEr(u0)) a = Math.max(a, n(u0));
    if (tallEr(u1)) b = Math.min(b, n(u1));
    if (b - a > 1) ut.push([a, b]);
  }
  return ut;
}

// Hele taket: bjelkelinjene inn, ferdige takflater ut.
//
// ⚠ ensrettFlater() og deltRadrutenett() hører IKKE hjemme her. De må kjøre
// ETTER en eventuell rotasjon og etter at åsene er funnet — rotasjonen bytter
// U og V, og en V som er snudd her ville blitt en snudd FALLRETNING der. Se
// js/veggelement/tak.js, som kaller dem i riktig rekkefølge.
export function takflaterFraBjelker(linjer, o) {
  // ⬆ REGEL 1 FØRST: bare de bjelkene som ingenting ligger over.
  const topp = toppBjelker(linjer);
  const par = grupperBjelker(topp, o).map(g => ({ g, f: flateFraGruppe(g, o) })).filter(x => x.f);
  // 🖼 REGEL 3, ANDRE UTGAVE: omrisset leses av HELE rammen av toppbjelker,
  // ikke bare av sperrene — se omrissForFlater
  const med = omrissForFlater(par.map(x => x.f), par.map(x => x.g), topp, o);
  return klippMoner(med, o).sort((a, b) => b.arealM2 - a.arealM2);
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

// ═════ ✂ PLATENE KAPPES MOT SKRÅ TOPPBJELKER (Emil 22.09) ═════
//
// «vi må legge inn at TRP-plater også stopper på enden av skrå toppbjelker, og
// da er det viktig at det også vises gradene på kappet.»
//
// Valmtrimmingen under kaster HELE plater som ligger utenfor. Det er riktig
// der to takflater krysser hverandre. Men en skrå vegg gir ingen kryssende
// flate — den gir en takflate som er kortere i den ene enden enn i den andre,
// og da skal plata KAPPES, ikke kastes.
//
// Kappet leses av kantlinjene (se flateFraGruppe): hvor langt sperrene rekker
// ved hver v. En plate som ligger med den ene kanten på 6 150 og den andre på
// 5 400 får begge målene OG vinkelen — nøyaktig de tre tallene verkstedet
// trenger, og nøyaktig slik veggelementene har gjort det siden 08.09
// («5980×1100/460MM 6,1°»).
export function kappMotKant(f, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const harKant = (f && f.rader || []).some(r => r && r.kant);
  if (!f || (!harKant && !Array.isArray(f.kantLav) && !Array.isArray(f.kantHoy))) return f;
  const tol = 5;
  const rader = (f.rader || []).map(r => {
    const vA = n(r.vFra), vB = vA + n(r.breddeMm);
    // 🖼 kanten fra omrisset (lest per rad i platerPaFlate) går foran de gamle
    // kantlinjene
    const K = r.kant;
    const hA = K ? K.hA : kantU(f.kantHoy, vA), hB = K ? K.hB : kantU(f.kantHoy, vB);
    const lA = K ? K.lA : kantU(f.kantLav, vA), lB = K ? K.lB : kantU(f.kantLav, vB);
    const plater = [];
    // 🖼 KNEKKET KANT (omrisset krysser raden med et hjørne inne i den): hver
    // plate kappes i hvert knekkpunkt, ikke bare på de to sidene
    if (K && Array.isArray(K.lo) && Array.isArray(K.hi) && (K.lo.length > 2 || K.hi.length > 2)) {
      const vsK = [...new Set(K.lo.map(q => q[0]).concat(K.hi.map(q => q[0])))].sort((a2, b2) => a2 - b2);
      const ved = (kurve, v) => {
        for (let i = 1; i < kurve.length; i++) {
          const a2 = kurve[i - 1], b2 = kurve[i];
          if (v <= b2[0] || i === kurve.length - 1) {
            const dd = b2[0] - a2[0];
            return dd > 1e-9 ? a2[1] + (b2[1] - a2[1]) * (v - a2[0]) / dd : b2[1];
          }
        }
        return kurve[0][1];
      };
      for (const p of r.plater || []) {
        const fraK = [], tilK = [];
        for (const v of vsK) {
          const lo = ved(K.lo, v), hi = ved(K.hi, v);
          const f2 = lo - n(p.uFra) > 1 ? lo : n(p.uFra);
          const t2 = Math.max(f2, n(p.uTil) - hi > 1 ? hi : n(p.uTil));
          fraK.push([rund(v - vA), rund(f2)]); tilK.push([rund(v - vA), rund(t2)]);
        }
        const L = fraK.map((q, i) => tilK[i][1] - q[1]);
        if (!L.some(x => x > 20)) continue;
        const rett = fraK.every(q => Math.abs(q[1] - fraK[0][1]) <= tol) && tilK.every(q => Math.abs(q[1] - tilK[0][1]) <= tol);
        const ny = { ...p, uFra: rund(Math.min(...fraK.map(q => q[1]))), uTil: rund(Math.max(...tilK.map(q => q[1]))) };
        ny.lengdeMm = Math.round(Math.max(...L));
        delete ny.skra; delete ny.lengdeVMm; delete ny.lengdeHMm; delete ny.vinkel;
        delete ny.uFraA; delete ny.uFraB; delete ny.uTilA; delete ny.uTilB; delete ny.kappFra; delete ny.kappTil; delete ny.middelMm;
        if (!rett) {
          ny.skra = true;
          ny.lengdeVMm = Math.round(Math.max(0, L[0]));
          ny.lengdeHMm = Math.round(Math.max(0, L[L.length - 1]));
          ny.uFraA = fraK[0][1]; ny.uFraB = fraK[fraK.length - 1][1];
          ny.uTilA = tilK[0][1]; ny.uTilB = tilK[tilK.length - 1][1];
          ny.vinkel = kappVinkel(n(r.breddeMm), L[0], L[L.length - 1]);
          ny.kappFra = fraK; ny.kappTil = tilK;
          // middellengden av et knekket kapp: arealet delt på bredden
          let A = 0;
          for (let i = 1; i < L.length; i++) A += (L[i - 1] + L[i]) / 2 * (fraK[i][0] - fraK[i - 1][0]);
          ny.middelMm = rund(A / Math.max(1, n(r.breddeMm)));
        }
        plater.push(ny);
      }
      return { ...r, plater };
    }
    for (const p of r.plater || []) {
      // 1 mm slark: kantlinja er lest av bjelkeendene og platelengdene er
      // avrundet til hele mm. Uten slarken hadde et helt rett tak fått
      // platene knabbet 0,1 mm — en «kapping» ingen har bedt om.
      const klipp = (u, k, ned) => k === null ? n(u)
        : (ned ? (n(u) - k > 1 ? k : n(u)) : (k - n(u) > 1 ? k : n(u)));
      const tA = klipp(p.uTil, hA, true), tB = klipp(p.uTil, hB, true);
      const fA = klipp(p.uFra, lA, false), fB = klipp(p.uFra, lB, false);
      // 🔎 EMILS FUNN 22.09 (bilde 4–5): «TRP-plater på skrå som ikke går til
      // neste bjelke, og plater som står i løse lufta.»
      //
      // Målt på Valle: i raden ved v = −10 692 endte den øverste plata med
      // uFra = 6 699 og uTil = 5 451 i den ene kanten — 1 248 mm BAKLENGS.
      // Takkanten krysser hele plata, så den enden har ikke tak i det hele
      // tatt. Firkanten ble da tegnet med to kanter som krysser hverandre, og
      // det er strimmelen som henger i lufta.
      //
      // En plate som krysses helt er en TREKANT: ett rett kutt fra der kanten
      // treffer den ene siden til der den forsvinner på den andre. Det er
      // nøyaktig ett sagsnitt, slik en tekker ville gjort det.
      const tA2 = Math.max(tA, fA), tB2 = Math.max(tB, fB);
      const a = tA2 - fA, b = tB2 - fB;
      // ingen av kantene har tak her — da er det ikke en plate
      if (!(a > 20) && !(b > 20)) continue;
      const ny = { ...p, uFra: rund(Math.min(fA, fB)), uTil: rund(Math.max(tA2, tB2)) };
      ny.lengdeMm = Math.round(Math.max(a, b));
      if (Math.abs(a - b) > tol) {
        ny.skra = true;
        ny.lengdeVMm = Math.round(Math.max(0, a));
        ny.lengdeHMm = Math.round(Math.max(0, b));
        ny.uFraA = rund(fA); ny.uFraB = rund(fB);
        ny.uTilA = rund(tA2); ny.uTilB = rund(tB2);
        ny.vinkel = kappVinkel(n(r.breddeMm), a, b);
      } else {
        delete ny.skra; delete ny.lengdeVMm; delete ny.lengdeHMm;
        delete ny.uFraA; delete ny.uFraB; delete ny.uTilA; delete ny.uTilB;
        delete ny.vinkel;
      }
      plater.push(ny);
    }
    return { ...r, plater };
  }).filter(r => r.plater.length);
  return { ...f, rader };
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
        // 🖼 med omriss er det allerede avgjort hvem som eier hvert punkt
        if (Array.isArray(f.omriss)) return true;
        const um = (n(p.uFra) + n(p.uTil)) / 2;
        const vm = n(r.vFra) + n(r.breddeMm) / 2;
        const pt = punktPaFlate(f, um, vm);
        return flateEier(F, fi, pt.x, pt.z, opp.valmTolMm);
      })
    })).filter(r => r.plater.length);
    // Summene regnes av summerFlate — samme funksjon som håndjusteringen
    // bruker, så de to kan ikke komme i utakt.
    return summerFlate(kappMotKant({ ...f, rader }, opp), opp);
  }).filter(f => f.antallPlater > 0);
}

// ═══════ 🧲 SNAPPING NÅR DU DRAR EN PLATEKANT (Emil 22.09) ═══════
//
// Emils ord: «de skal snappe til enden av andre TRP-plater. De skal snappe
// til senter på toppbjelkene + det som er satt som skjøt — så hvis en plate
// blir 5000 mm når du drar den til skjøten og du har satt skjøt til 20, så
// blir det 5000 + 20 = 5020 mm.»
//
// Det gir tre slags festepunkter for kanten du drar, alle i flatas u:
//   1. kantene til de andre platene — så to plater møtes nøyaktig
//   2. senter av en ås — der skjøten SKAL ligge
//   3. åsen pluss overlappen, i den retningen du drar: det er der kanten må
//      ligge for at plata skal dekke fram til åsen OG lappe over den
//
// Ren tallfunksjon, ingen three.js: kandidatene ut, nærmeste inn.
export function snapKandidater(ende, aserAbs, andreKanter, overlappMm) {
  const ov = Math.max(0, n(overlappMm));
  const ut = [];
  for (const k of andreKanter || []) if (tallEr(k)) ut.push(n(k));
  for (const a of aserAbs || []) {
    if (!tallEr(a)) continue;
    ut.push(n(a));
    ut.push(ende === "fra" ? n(a) - ov : n(a) + ov);
  }
  return [...new Set(ut.map(rund))].sort((x, y) => x - y);
}

// Nærmeste kandidat innenfor toleransen — ellers tallet uendret.
export function snapVerdi(u, kandidater, tolMm) {
  const tol = tallEr(tolMm) ? Math.abs(n(tolMm)) : 150;
  let beste = null, avstand = Infinity;
  for (const k of kandidater || []) {
    const d = Math.abs(n(k) - n(u));
    if (d < avstand) { avstand = d; beste = n(k); }
  }
  return (beste !== null && avstand <= tol) ? beste : n(u);
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
// 🔎 EMILS FUNN 21.09 («takplater er helt feil»): en dratt plate ble 8466 mm
// på et fall på 5521 — den stakk 2945 mm ut i lufta forbi gesimsen.
//
// `dFra`/`dTil` var ubundne: draget la seg rett på u-verdiene uten å spørre
// om flata rakk så langt. Takflata har allerede utstikket sitt innebygget
// (utstikkGesimsMm / utstikkGavlMm ligger i u0 og u1), så u0…u1 ER hvor det
// finnes tak. Et drag utenfor er ikke en lengre plate, det er en plate som
// henger utenfor bygget.
function paaFlata(f, uFra, uTil) {
  const a = n(f && f.u0), b = n(f && f.u1);
  if (!(b > a)) return [uFra, uTil];
  return [Math.max(a, Math.min(b, uFra)), Math.min(b, Math.max(a, uTil))];
}

export function justerPlater(medPlater, just, ekstra, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const J = just || {};
  return (medPlater || []).map((f, fi) => {
    // 🔎 EMILS FUNN 23.09: «når jeg drar i de gule pilene påvirker det hele
    // rekken, og ikke bare den jeg faktisk drar i.» Bredden ble lagt på RADEN.
    //
    // Nå får en plate med egen bredde (eller flyttet side) sin EGEN rad — de
    // andre platene i raden står der de stod. Det er slik det monteres: en
    // plate som kappes på langs er én plate, ikke hele rekka.
    const egenRad = (j) => (tallEr(j.breddeMm) && Number(j.breddeMm) > 20) || tallEr(j.dvFra);
    const rader = (f.rader || []).flatMap(r => {
      const plater = [], egne = [];
      for (const p of r.plater || []) {
        const id = p.id || plateId(fi, r, p);
        const j = J[id] || {};
        if (j.av) continue;
        const [uFra, uTil] = paaFlata(f, n(p.uFra) - n(j.dFra), n(p.uTil) + n(j.dTil));
        if (uTil - uFra <= 20) continue;
        // ✂ Har Emil dratt i plata, er HANS lengde fasit — da er det ikke lenger
        // kantlinja som bestemmer, og skråkappet følger ikke med.
        const dratt = tallEr(j.dFra) || tallEr(j.dTil);
        const rest = dratt
          ? { ...p, skra: undefined, lengdeVMm: undefined, lengdeHMm: undefined,
              uFraA: undefined, uFraB: undefined, uTilA: undefined, uTilB: undefined,
              vinkel: undefined, kappFra: undefined, kappTil: undefined, middelMm: undefined }
          : p;
        const ny = { ...rest, id, uFra: rund(uFra), uTil: rund(uTil), lengdeMm: rund(uTil - uFra) };
        if (!egenRad(j)) { plater.push(ny); continue; }
        // ↔ egen bredde og/eller flyttet nedre side (Emil 23.09: «alle 4»)
        const dv = tallEr(j.dvFra) ? Number(j.dvFra) : 0;
        const bredde = tallEr(j.breddeMm) && Number(j.breddeMm) > 20 ? Number(j.breddeMm) : n(r.breddeMm);
        // et knekket kapp er målt fra radens gamle start — flytt det med
        if (Array.isArray(ny.kappFra)) ny.kappFra = ny.kappFra.map(([v, u]) => [rund(v - dv), u]);
        if (Array.isArray(ny.kappTil)) ny.kappTil = ny.kappTil.map(([v, u]) => [rund(v - dv), u]);
        egne.push({ ...r, vFra: rund(n(r.vFra) + dv), breddeMm: rund(bredde),
          kappetBredde: r.kappetBredde || bredde !== n(r.breddeMm), egenBredde: true, plater: [ny] });
      }
      const ut = plater.length ? [{ ...r, plater }] : [];
      return ut.concat(egne);
    });
    // lagt til for hånd
    for (const e of ekstra || []) {
      if (Number(e.fi) !== fi) continue;
      const j = J[e.id] || {};
      if (j.av) continue;
      const [uFra, uTil] = paaFlata(f, n(e.uFra) - n(j.dFra), n(e.uTil) + n(j.dTil));
      if (uTil - uFra <= 20) continue;
      const bE = tallEr(j.breddeMm) && Number(j.breddeMm) > 20 ? Number(j.breddeMm) : (n(e.breddeMm) || n(opp.trpBreddeMm));
      rader.push({ vFra: rund(n(e.vFra) + (tallEr(j.dvFra) ? Number(j.dvFra) : 0)), breddeMm: rund(bE),
        kappetBredde: bE !== (n(e.breddeMm) || n(opp.trpBreddeMm)), lagtTil: true,
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
  // ✂ Et skråkappet plate er et TRAPES: arealet regnes av middellengden, ikke
  // av den lengste kanten. Ellers bestilles det for mye på hvert skråtak.
  const arealM2 = rund(rader.reduce((a, r) =>
    a + r.plater.reduce((b, p) => b + (p.skra
      ? (tallEr(p.middelMm) ? n(p.middelMm) : (n(p.lengdeVMm) + n(p.lengdeHMm)) / 2)
      : n(p.uTil) - n(p.uFra)) * n(r.breddeMm), 0), 0) / 1e6);
  return { ...f, rader, antallPlater: antall, endeskjoter, sideskjoter, arealM2,
    skjotLm: rund(sideLm + endeLm) };
}

// ═══════ 🔄 TRP-PLATA SOM TREKANTER: RIBBENE PÅ TVERS AV LENGDEN (Emil 23.09) ═══════
//
// «De 2 sidene av TRP-plata som avslutter med flat ende er de som må legge seg
// på bjelken, der skruen får best feste — nå står de 90° feil.»
//
// Plata går fra bjelke til bjelke langs u. Da er det den FLATE kanten som
// skal ligge på bjelken i hver ende: ribbene løper langs v, parallelt med
// bjelken, og profilen går langs u. Ribbene står på faste u-verdier, så et
// skråkapp skjærer rett gjennom dem slik et sagsnitt gjør.
//
// `prof` er [[x, h], …] langs u fra 0, `vs` stripene på tvers (0, knekkpunkt,
// bredde), `starten(v)`/`enden(v)` platas ender målt fra samme 0. Svaret er
// hjørnene i trekantene som [v, h, u], tre og tre. Ren tallfunksjon.
export function platePunkter(prof, vs, starten, enden) {
  const ut = [];
  const P = prof || [];
  const hAv = (xInn, i) => {
    const [x0, h0] = P[i - 1], [x1, h1] = P[i];
    const x = Math.max(x0, Math.min(x1, xInn));
    return x1 - x0 > 1e-9 ? h0 + (h1 - h0) * (x - x0) / (x1 - x0) : h1;
  };
  const klem = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  for (let k = 1; k < (vs || []).length; k++) {
    const va = vs[k - 1], vb = vs[k];
    if (!(vb - va > 0.1)) continue;
    const sa = starten(va), ea = enden(va), sb = starten(vb), eb = enden(vb);
    for (let i = 1; i < P.length; i++) {
      const x0 = P[i - 1][0], x1 = P[i][0];
      const a0 = Math.max(x0, sa), a1 = Math.min(x1, ea);
      const b0 = Math.max(x0, sb), b1 = Math.min(x1, eb);
      if (!(a1 > a0) && !(b1 > b0)) continue;
      // tomt på den ene sida: segmentet krymper til plateenden der, så
      // trekanten ender PÅ kappet og ikke ute i lufta
      const [A0, A1] = a1 > a0 ? [a0, a1] : [klem(x0, sa, ea), klem(x0, sa, ea)];
      const [B0, B1] = b1 > b0 ? [b0, b1] : [klem(x0, sb, eb), klem(x0, sb, eb)];
      ut.push([va, hAv(A0, i), A0], [va, hAv(A1, i), A1], [vb, hAv(B1, i), B1],
              [va, hAv(A0, i), A0], [vb, hAv(B1, i), B1], [vb, hAv(B0, i), B0]);
    }
  }
  return ut;
}
