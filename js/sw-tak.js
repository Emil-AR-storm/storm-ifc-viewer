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
  fallFasade: null         // hvilken fasade fallet går NED MOT; null = finn selv
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

// Rammen (u, v) i verdenskoordinater. `u` peker langs gavlfasaden — altså ned
// fallet — og `v` står vinkelrett på den, langs mønet.
export function takRamme(fasader, valgtFi, o) {
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
  return {
    fi, flatt: g.flatt, variasjon: g.variasjon,
    px: n(f.px), pz: n(f.pz),
    ux: n(f.ex), uz: n(f.ez),      // ned fallet
    vx: n(f.nx), vz: n(f.nz),      // langs mønet (fasadens normal)
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
  const nedFall = platerNedFall(fall, opp);
  const rader = [];
  for (let i = 0; i < hele; i++)
    rader.push({ vFra: rund(flate.v0 + i * pb), breddeMm: pb, kappetBredde: false, plater: nedFall });
  if (rest > 20)
    rader.push({ vFra: rund(flate.v0 + hele * pb), breddeMm: rest, kappetBredde: true, plater: nedFall });
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
export function trpListe(flater, o) {
  const opp = { ...TAK_STD, ...(o || {}) };
  const medPlater = (flater || []).map(f => platerPaFlate(f, opp)).filter(Boolean);
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
