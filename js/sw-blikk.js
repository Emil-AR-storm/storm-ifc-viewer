// 🩹 BLIKKET RUNDT VEGGELEMENTENE (Emil 17.09, runde 1 av Blikk & Tak).
// Rene tallfunksjoner uten avhengigheter — testes i Node med ekte tall
// (_test/test-sw-blikk.mjs) og brukes av js/veggelement/blikk.js til 3D-en og
// av materiell-arket.
//
// PRINSIPPET, Emils ord: blikk skal dekke til ALLE steder hvor isolasjonen i
// veggelementet er eksponert. Ikke noe mer, ikke noe mindre. Kun utvendig.
//
// Derfor regnes ingenting her av lengde × høyde. Alt leses av de SYNLIGE
// elementene: et element som er dratt bort eller skjult er ikke kjøpt, og har
// heller ingen kant å dekke. Det var nettopp formelen
//     beslagLm = 2 * lengde + kanter * høyde
// i sw-materiell.js som gjorde arket ~70 % riktig: den kunne ikke se at en
// port bryter bunnbeslaget, at en gavltopp er lengre enn fasadens lengde,
// eller at skjøtene i det hele tatt finnes.
//
// De to VARENE (Emil 17.09): skjøter = hatprofil, resten = beslag.
//   beslag    → topp, bunn, hjørne (L), fri ende
//   hatprofil → over hver loddrett skjøt, og rundt hver utsparing
//
// Skjøtregelen: elementene ligger vannrett. Skjøten MELLOM to element i samme
// rad står loddrett og har 10 mm luftrom — isolasjonen er eksponert, den skal
// ha skum, teip og blikk. Skjøten mellom to rader låser seg i hverandre og er
// helt dekket: ingenting der.

export const BLIKK_TOL_MM = 5;
export const SKRUER_PER_STANG = 8;      // per påbegynt 2,5 lm, som i dag
export const BESLAG_LENGDE_M = 2.5;
export const STANG_LENGDE_M = 2.5;      // standard bestillingslengde, settbar

// Blikktypene. `vare` sier hvilken rad i arket lengden havner i.
export const BLIKK_TYPER = {
  topp:      { vare: "beslag",    navn: "Toppbeslag" },
  bunn:      { vare: "beslag",    navn: "Bunnbeslag" },
  hjorne:    { vare: "beslag",    navn: "Hjørnebeslag (L)" },
  ende:      { vare: "beslag",    navn: "Endebeslag" },
  skjot:     { vare: "hatprofil", navn: "Hatprofil skjøt" },
  utsparing: { vare: "hatprofil", navn: "Hatprofil utsparing" }
};

// ───────────────────────── små hjelpere ─────────────────────────

const tallEr = (x) => Number.isFinite(Number(x));
const n = (x) => Number(x) || 0;
export const rund = (x) => Math.round(x * 1000) / 1000;

// Slår sammen overlappende og inntilliggende intervaller. [[fra, til], …]
// sortert og uten hull mindre enn `tolMm`. Et intervall med null lengde faller
// bort. Dette er grunnsteinen: både topp, bunn og skjøt er intervaller.
export function slaSammen(intervaller, tolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  const inn = (intervaller || [])
    .filter(p => p && tallEr(p[0]) && tallEr(p[1]) && Number(p[1]) - Number(p[0]) > tol)
    .map(p => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  const ut = [];
  for (const p of inn) {
    const sist = ut[ut.length - 1];
    if (sist && p[0] <= sist[1] + tol) sist[1] = Math.max(sist[1], p[1]);
    else ut.push([p[0], p[1]]);
  }
  return ut;
}

export function sumLengde(intervaller) {
  return (intervaller || []).reduce((a, p) => a + (p[1] - p[0]), 0);
}

// Elementets over- og underkant i veggens egne mm. `hVMm`/`hHMm` er høyden i
// venstre og høyre ende (like på flatt tak, ulike på en gavl).
export function elBunn(el) { return n(el.rBunnMm); }
export function elToppV(el) { return n(el.rBunnMm) + (tallEr(el.hVMm) ? Number(el.hVMm) : n(el.hoydeMm)); }
export function elToppH(el) { return n(el.rBunnMm) + (tallEr(el.hHMm) ? Number(el.hHMm) : n(el.hoydeMm)); }
export function elTopp(el) { return Math.max(elToppV(el), elToppH(el)); }
// Elementets overkant VED fasade-mm `t`. På et skrått tak er den ikke den
// samme i de to endene, og det er høyden PÅ STEDET som bestemmer hvor langt
// et kant- eller skjøtbeslag må være. Brukte vi elTopp (den høyeste enden),
// ble endebeslaget på en gavl like langt som ved mønet — 6,0 m der veggen er
// 4,0 m høy. Det ble sett på prøvetegningen 17.09, ikke fanget av et tall.
export function elToppVed(el, tMm) {
  const fra = n(el.fraMm), til = n(el.tilMm);
  const v = elToppV(el), h = elToppH(el);
  if (!(til > fra)) return Math.max(v, h);
  const k = Math.min(1, Math.max(0, (Number(tMm) - fra) / (til - fra)));
  return v + (h - v) * k;
}

export function synlige(elementer) {
  return (elementer || []).filter(e => e && !e.skjult && n(e.tilMm) - n(e.fraMm) > BLIKK_TOL_MM);
}

// ───────────────────────── veggtoppen ─────────────────────────

// Veggtoppen ved fasade-mm `t`. `linje` er taklinja fra regler.js
// ([[t, y], …]); uten linje er taket flatt og toppen konstant.
export function toppVed(linje, toppMm, tMm) {
  const L = linje || [];
  if (L.length < 2) return n(toppMm);
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

// SKRÅ lengde langs veggtoppen fra `fra` til `til`. På et flatt tak er dette
// bredden; på en gavl er den lengre — og det er nettopp forskjellen formelen
// i sw-materiell.js ikke kunne se. Emil bestiller beslag til hele strekningen
// og klipper det til takvinkelen på plassen, så det er den FAKTISKE skrå
// lengden som skal bestilles.
export function toppLengde(linje, toppMm, fraMm, tilMm) {
  const fra = Number(fraMm), til = Number(tilMm);
  if (!(til > fra)) return 0;
  const L = linje || [];
  if (L.length < 2) return til - fra;
  // knekkpunktene inne i strekningen, pluss endene
  const xs = [fra];
  for (const [x] of L) if (x > fra + 1e-6 && x < til - 1e-6) xs.push(x);
  xs.push(til);
  let sum = 0;
  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i] - xs[i - 1];
    const dy = toppVed(L, toppMm, xs[i]) - toppVed(L, toppMm, xs[i - 1]);
    sum += Math.hypot(dx, dy);
  }
  return sum;
}

// ───────────────────────── de fire beslagene ─────────────────────────

// BUNN: strekningene der et synlig element står mot veggens bunn. Under en
// port står det ingen element, og da er det ingen isolasjon å dekke heller —
// beslaget brytes. Det er regel B9.
export function bunnIntervaller(elementer, bunnMm, tolMm, sammenTolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  const st = tallEr(sammenTolMm) ? Number(sammenTolMm) : tol;
  const b = n(bunnMm);
  return slaSammen(synlige(elementer)
    .filter(e => elBunn(e) <= b + tol)
    .map(e => [n(e.fraMm), n(e.tilMm)]), st);
}

// TOPP: strekningene der et synlig element når veggens overkant. Et element
// regnes som topp-element når minst én av endene står i veggtoppen — på en
// gavl skråner toppen, og et femkantet element (runde 20d) når toppen bare i
// den ene enden.
export function toppIntervaller(elementer, linje, toppMm, tolMm, sammenTolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  const st = tallEr(sammenTolMm) ? Number(sammenTolMm) : tol;
  return slaSammen(synlige(elementer).filter(e => {
    const tV = toppVed(linje, toppMm, n(e.fraMm)), tH = toppVed(linje, toppMm, n(e.tilMm));
    return elToppV(e) >= tV - tol || elToppH(e) >= tH - tol;
  }).map(e => [n(e.fraMm), n(e.tilMm)]), st);
}

// EN ENDE (hjørne eller fri ende): den dekte høyden i enden. Elementene som
// står i enden bestemmer den — går porten helt ut i hjørnet, er det mindre
// kant å dekke.
// Elementene som STÅR I enden — de som dekker fasade-mm `t`, ikke bare de som
// slutter nøyaktig der. HJØRNELAPPEN (runde 6/23) forlenger endeelementene
// forbi fasadens akse: `hjFraMm = tilMm(t0) + hjorneForlengelse(…)`, typisk
// 150–250 mm. Lette vi bare etter en elementende innenfor 5 mm av t0, fant vi
// ingenting på et virkelig bygg, og hjørnebeslaget ble 0 lm på hele modellen.
// Prøvebygget mitt hadde elementene nøyaktig på 0 og 12 000 og skjulte feilen.
export function kantIntervaller(elementer, tMm, tolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  const t = Number(tMm);
  const ved = synlige(elementer).filter(e => n(e.fraMm) <= t + tol && n(e.tilMm) >= t - tol);
  return slaSammen(ved.map(e => [elBunn(e), elToppVed(e, t)]), tol);
}
export function kantHoyde(elementer, tMm, tolMm) {
  return sumLengde(kantIntervaller(elementer, tMm, tolMm));
}

// SKJØTEN ved fasade-mm `s`: den høyden der det står element på BEGGE sider.
// Er det bare element på den ene siden, er det ingen skjøt — det er en ende.
// Går en port gjennom skjøtposisjonen, finnes skjøten ikke i den høyden.
export function skjotIntervaller(elementer, sMm, klaringMm, tolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  const s = Number(sMm), kl = n(klaringMm);
  const slark = kl + tol;
  const venstre = [], hoyre = [];
  for (const e of synlige(elementer)) {
    // høyden MÅLT VED SKJØTEN: elementet til venstre med sin høyre ende,
    // elementet til høyre med sin venstre. På en skrå fasade er de ulike.
    if (Math.abs(n(e.tilMm) - s) <= slark) venstre.push([elBunn(e), elToppH(e)]);
    if (Math.abs(n(e.fraMm) - s) <= slark) hoyre.push([elBunn(e), elToppV(e)]);
  }
  const v = slaSammen(venstre, tol), h = slaSammen(hoyre, tol);
  const ut = [];
  for (const a of v) for (const b of h) {
    const lav = Math.max(a[0], b[0]), hoy = Math.min(a[1], b[1]);
    if (hoy - lav > tol) ut.push([lav, hoy]);
  }
  return slaSammen(ut, tol);
}
export function skjotHoyde(elementer, sMm, klaringMm, tolMm) {
  return sumLengde(skjotIntervaller(elementer, sMm, klaringMm, tolMm));
}

// HATPROFIL RUNDT EN UTSPARING.
//
// Regelen var: Dør og Port har ingen bunn (3 sider), Vindu har 4. Den holder
// så lenge et vindu har vegg under seg — og det er grunnen til at det er fire
// sider: den fjerde er kanten på veggen UNDER vinduet.
//
// 🔎 GEITHUS 20653, 17.09: «Vindu 1» er 6 000 × 3 050 og går HELT NED TIL
// GULVET — en glassfront, ikke et vindu i en vegg. Det er ingen vegg under
// den, altså ingen eksponert isolasjon å dekke, men typen ga likevel fire
// sider og 6,0 lm hatprofil for mye.
//
// Derfor avgjør GEOMETRIEN og ikke navnet: den fjerde siden kommer bare når
// åpningens bunn ligger over veggfeltets bunn. Det er Emils eget prinsipp —
// blikk skal dekke der isolasjonen er eksponert, ikke noe annet sted.
//
// `bunnMm` og `veggBunnMm` måles begge fra SW-basen. Er bunnen ukjent
// (undefined), beholdes den gamle oppførselen, så gamle kall ikke endrer svar.
export function utsparingSider(type, bunnMm, veggBunnMm, tolMm) {
  if (type !== "vindu") return 3;
  if (bunnMm === undefined || bunnMm === null) return 4;
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  return n(bunnMm) > n(veggBunnMm) + tol ? 4 : 3;
}
export function utsparingLm(type, breddeMm, hoydeMm, bunnMm, veggBunnMm, tolMm) {
  const b = Math.max(0, n(breddeMm)) / 1000, h = Math.max(0, n(hoydeMm)) / 1000;
  return utsparingSider(type, bunnMm, veggBunnMm, tolMm) === 4 ? 2 * (b + h) : 2 * h + b;
}

// ───────────────────────── skruer og stenger ─────────────────────────

// 8 skruer per påbegynt 2,5 lm. Uendret fra i dag.
export function skruerForLm(lm) {
  const m = n(lm);
  return m <= 0 ? 0 : Math.ceil(m / BESLAG_LENGDE_M - 1e-9) * SKRUER_PER_STANG;
}
// Blikk bestilles i løpemeter, men leveres i stenger. Lengden er settbar.
export function stenger(lm, stangLengdeM) {
  const m = n(lm), L = Number(stangLengdeM) > 0 ? Number(stangLengdeM) : STANG_LENGDE_M;
  return m <= 0 ? 0 : Math.ceil(m / L - 1e-9);
}

// ───────────────────────── hjørnene ─────────────────────────

// Hvilken ende av hvilken fasade som EIER kantbeslaget. Samme telling som
// fasadeHjorner() i veggelement/generer.js — hjørnet telles ÉN gang, og en fri
// ende teller én gang — men her sier svaret også HVILKEN ende det er, slik at
// blikket kan tegnes på riktig sted.
//
// Hjørnet dekkes av ETT beslag formet som et hjørne (L-beslag) som dekker
// begge fasadene (Emil 17.09, rettelse av sjekklista 08.09). Eieren er bare
// den som bærer lengden i lista.
//
// `ender` = [[{x, z}, {x, z}], …] — start- og sluttpunktet til hver fasade.
export function fasadeKanter(ender, tol) {
  const e = ender || [];
  const tl = Number(tol) > 0 ? Number(tol) : 1e-6;
  const naer = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) <= tl;
  return e.map((par, i) => {
    const ut = [];
    for (let k = 0; k < 2; k++) {
      const p = par[k];
      let hjorne = false, minIdx = i;
      for (let j = 0; j < e.length; j++) {
        if (j === i) continue;
        if (naer(p, e[j][0]) || naer(p, e[j][1])) { hjorne = true; if (j < minIdx) minIdx = j; }
      }
      ut.push({ hjorne, eier: !hjorne || minIdx === i, type: hjorne ? "hjorne" : "ende" });
    }
    return { start: ut[0], slutt: ut[1] };
  });
}

// BYGGETS HJØRNER, ett punkt per hjørne — ikke ett per fasade. Hvert hjørne
// får ETT L-beslag som dekker begge fasadene (Emil 17.09), og en fri ende får
// sitt eget endebeslag. `eier` er fasaden som bærer løpemeteren i lista, slik
// at hjørnet telles én gang; tegningen bryr seg ikke om hvem som eier det.
export function bygningsHjorner(ender, tol) {
  const e = ender || [];
  const tl = Number(tol) > 0 ? Number(tol) : 1e-6;
  const naer = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) <= tl;
  const ut = [];
  for (let i = 0; i < e.length; i++) {
    for (let k = 0; k < 2; k++) {
      const p = e[i][k];
      const funnet = ut.find(h => naer(h.punkt, p));
      if (funnet) { funnet.kanter.push({ fasade: i, ende: k ? "slutt" : "start" }); continue; }
      ut.push({ punkt: { x: p.x, z: p.z }, kanter: [{ fasade: i, ende: k ? "slutt" : "start" }] });
    }
  }
  for (const h of ut) {
    h.type = h.kanter.length > 1 ? "hjorne" : "ende";
    h.eier = Math.min(...h.kanter.map(k => k.fasade));
  }
  return ut;
}

// Ett stykke blikk per hjørne, med den høyden beslaget faktisk må dekke: den
// HØYESTE av de to fasadene som møtes. Dette er lista 3D-en tegner etter, og
// den har like mange stykker som bygget har hjørner — alltid fire på et
// rektangel, uansett hvordan løpemeteren fordeler seg i arket.
export function hjorneStykker(hjorner, vegger, tolMm) {
  const tol = tallEr(tolMm) ? Number(tolMm) : BLIKK_TOL_MM;
  return (hjorner || []).map(h => {
    let hoydeMm = 0, bunnMm = Infinity, toppMm = -Infinity;
    for (const k of h.kanter) {
      const v = (vegger || [])[k.fasade];
      if (!v) continue;
      const t = k.ende === "start" ? v.t0Mm : v.t1Mm;
      const d = kantIntervaller(v.elementer, t, tol);
      if (!d.length) continue;
      hoydeMm = Math.max(hoydeMm, sumLengde(d));
      bunnMm = Math.min(bunnMm, d[0][0]);
      toppMm = Math.max(toppMm, d[d.length - 1][1]);
    }
    return { punkt: h.punkt, type: h.type, eier: h.eier, kanter: h.kanter,
      bunnMm: isFinite(bunnMm) ? bunnMm : 0, toppMm: isFinite(toppMm) ? toppMm : 0,
      hoydeMm, lm: rund(hoydeMm / 1000) };
  }).filter(h => h.hoydeMm > 0);
}

// Setter hjørnehøyden inn i veggenes kantStart/kantSlutt, så løpemeteren i
// arket og streken i 3D-en er det SAMME tallet. Endrer `vegger` ikke — den
// gir en ny liste.
export function medHjorner(vegger, hjorner, tolMm) {
  const stk = hjorneStykker(hjorner, vegger, tolMm);
  return (vegger || []).map((v, i) => {
    const ny = { ...v };
    for (const [felt, ende] of [["kantStart", "start"], ["kantSlutt", "slutt"]]) {
      const h = stk.find(s => s.kanter.some(k => k.fasade === i && k.ende === ende));
      // EIERSKAPET AVGJØRES HER, ikke av den som bygger vegglista. Hjørnet
      // skal telles ÉN gang, og lot vi kalleren sette `eier` selv, ble
      // fasaden på den andre siden talt en gang til — 28,8 lm der fasiten
      // sier 14,4. Fanget av Geithus-testen 17.09.
      if (h && ny[felt]) ny[felt] = { ...ny[felt], hoydeMm: h.hoydeMm,
        bunnMm: h.bunnMm, toppMm: h.toppMm, type: h.type, eier: h.eier === i };
    }
    return ny;
  });
}

// ───────────────────────── én vegg ─────────────────────────

// vegg = {
//   navn,
//   t0Mm, t1Mm,            // fasadens ender i fasade-mm
//   bunnMm,                // veggfeltets underkant (0 = OK betong)
//   toppMm,                // veggtoppen på flatt tak
//   linje,                 // taklinja [[t, y], …] eller null/[] ved flatt tak
//   skjot: [mm…],          // skjøtposisjonene, start og slutt først og sist
//   klaringMm,             // 10 mm — fra søylesenter til elementende
//   kantStart, kantSlutt,  // { eier, type } fra fasadeKanter
//   elementer: [{ fraMm, tilMm, rBunnMm, hoydeMm, hVMm, hHMm, skjult }],
//   utsparinger: [{ type, breddeMm, hoydeMm }]
// }
export function veggBlikk(vegg, oppsett) {
  const v = vegg || {}, o = oppsett || {};
  const tol = Number(o.blikkTolMm) > 0 ? Number(o.blikkTolMm) : BLIKK_TOL_MM;
  const el = synlige(v.elementer);
  const stykker = [];
  if (!el.length) return tomVegg(v.navn);

  const linje = (v.linje && v.linje.length >= 2) ? v.linje : null;
  // Topp- og bunnbeslaget løper FORBI skjøten: de 20 mm luftrom mellom to
  // element (10 mm klaring i hver ende) er ikke et brudd i beslaget, bare i
  // elementrekka. Uten dette ble et beslag på 12 m talt som 5,99 + 5,99.
  const sammen = 2 * n(v.klaringMm) + tol;

  // 1. topp
  let toppLm = 0;
  for (const [fra, til] of toppIntervaller(el, linje, v.toppMm, tol, sammen)) {
    const m = toppLengde(linje, v.toppMm, fra, til) / 1000;
    toppLm += m;
    stykker.push({ type: "topp", fraMm: fra, tilMm: til, lm: rund(m) });
  }
  // 2. bunn
  let bunnLm = 0;
  for (const [fra, til] of bunnIntervaller(el, v.bunnMm, tol, sammen)) {
    const m = (til - fra) / 1000;
    bunnLm += m;
    stykker.push({ type: "bunn", fraMm: fra, tilMm: til, lm: rund(m) });
  }
  // 3. de loddrette kantene — bare de denne veggen eier
  let kantLm = 0;
  for (const [felt, tMm] of [["kantStart", v.t0Mm], ["kantSlutt", v.t1Mm]]) {
    const k = v[felt];
    if (!k || !k.eier) continue;
    // Hjørnet dekkes av ETT L-beslag som dekker BEGGE fasadene. Står det en
    // port i den ene siden, er det likevel den HØYESTE siden som bestemmer
    // hvor langt beslaget må være — derfor kan hjørnets felles høyde settes
    // utenfra (hjorneStykker fyller den inn). Uten den faller vi tilbake på
    // veggens egen kant.
    const deler = tallEr(k.bunnMm) && tallEr(k.toppMm)
      ? [[Number(k.bunnMm), Number(k.toppMm)]] : kantIntervaller(el, tMm, tol);
    const h = (tallEr(k.hoydeMm) ? Number(k.hoydeMm) : sumLengde(deler)) / 1000;
    if (h <= 0) continue;
    kantLm += h;
    stykker.push({ type: k.type === "hjorne" ? "hjorne" : "ende", tMm: Number(tMm),
      deler, lm: rund(h) });
  }
  // 4. de loddrette skjøtene — bare de INNVENDIGE
  let skjotLm = 0;
  const skjot = v.skjot || [];
  for (let i = 1; i < skjot.length - 1; i++) {
    const deler = skjotIntervaller(el, skjot[i], v.klaringMm, tol);
    const h = sumLengde(deler) / 1000;
    if (h <= 0) continue;
    skjotLm += h;
    stykker.push({ type: "skjot", tMm: Number(skjot[i]), deler, lm: rund(h) });
  }
  // 5. rundt utsparingene
  let utspLm = 0;
  const vBunn = n(v.bunnMm);
  for (const u of v.utsparinger || []) {
    if (!u) continue;
    const m = utsparingLm(u.type, u.breddeMm, u.hoydeMm, u.bunnMm, vBunn, tol);
    if (m <= 0) continue;
    utspLm += m;
    // fraMm/tilMm/bunnMm/toppMm følger med når kalleren har dem (utspPaFasader),
    // så 3D-en kan tegne rammen på riktig sted. Lengden er uavhengig av dem.
    stykker.push({ type: "utsparing", utspType: u.type,
      sider: utsparingSider(u.type, u.bunnMm, vBunn, tol),
      fraMm: u.fraMm, tilMm: u.tilMm_ !== undefined ? u.tilMm_ : u.tilMm,
      // bunnen klippes til veggfeltet for TEGNINGEN; sidene er avgjort over
      bunnMm: Math.max(n(u.bunnMm), vBunn), toppMm: u.toppMm, lm: rund(m) });
  }

  const beslagLm = toppLm + bunnLm + kantLm;
  const hatprofilLm = skjotLm + utspLm;
  return {
    navn: v.navn || "",
    toppLm: rund(toppLm), bunnLm: rund(bunnLm), kantLm: rund(kantLm),
    skjotLm: rund(skjotLm), utsparingLm: rund(utspLm),
    beslagLm: rund(beslagLm), hatprofilLm: rund(hatprofilLm),
    skruerBeslag: skruerForLm(beslagLm), skruerHatprofil: skruerForLm(hatprofilLm),
    stenger: stenger(beslagLm + hatprofilLm, o.stangLengdeM),
    stykker
  };
}

function tomVegg(navn) {
  return { navn: navn || "", toppLm: 0, bunnLm: 0, kantLm: 0, skjotLm: 0, utsparingLm: 0,
    beslagLm: 0, hatprofilLm: 0, skruerBeslag: 0, skruerHatprofil: 0, stenger: 0, stykker: [] };
}

// ───────────────────────── alle veggene ─────────────────────────

// Skruene og stengene på TOTALEN regnes av total-løpemeteren, ikke som summen
// av kolonnene: færre påbegynte lengder. Det er totalen Emil bestiller på.
// `ender` er fasadenes endepunkter ([[{x,z},{x,z}], …]); sendes de inn, får
// hvert hjørne sitt eget L-beslag og lista sin hjornerliste til 3D-en.
export function blikkListe(vegger, oppsett, ender) {
  const o = oppsett || {};
  const hjorner = ender ? bygningsHjorner(ender, Number(o.hjorneTolMm) > 0 ? o.hjorneTolMm : 1) : null;
  const liste = hjorner ? medHjorner(vegger, hjorner, o.blikkTolMm) : (vegger || []);
  const kolonner = liste.map(v => veggBlikk(v, o));
  const sum = (k) => kolonner.reduce((a, c) => a + (c[k] || 0), 0);
  const beslagLm = sum("beslagLm"), hatprofilLm = sum("hatprofilLm");
  const total = {
    navn: "Totalt",
    toppLm: rund(sum("toppLm")), bunnLm: rund(sum("bunnLm")), kantLm: rund(sum("kantLm")),
    skjotLm: rund(sum("skjotLm")), utsparingLm: rund(sum("utsparingLm")),
    beslagLm: rund(beslagLm), hatprofilLm: rund(hatprofilLm),
    skruerBeslag: skruerForLm(beslagLm), skruerHatprofil: skruerForLm(hatprofilLm),
    stenger: stenger(beslagLm + hatprofilLm, o.stangLengdeM),
    stykker: []
  };
  return { kolonner, total, hjorner: hjorner ? hjorneStykker(hjorner, liste, o.blikkTolMm) : [] };
}

// Radene i arket «Blikk». `T` er oversetteren (t fra i18n.js).
export const BLIKK_RADER = [
  ["Toppbeslag (lm)", "toppLm"],
  ["Bunnbeslag (lm)", "bunnLm"],
  ["Hjørne- og endebeslag (lm)", "kantLm"],
  ["Beslag totalt (lm)", "beslagLm"],
  ["Skrue beslag (stk)", "skruerBeslag"],
  ["Hatprofil skjøt (lm)", "skjotLm"],
  ["Hatprofil utsparing (lm)", "utsparingLm"],
  ["Hatprofil totalt (lm)", "hatprofilLm"],
  ["Skrue hatprofil (stk)", "skruerHatprofil"],
  ["Blikk (stenger)", "stenger"]
];
export function blikkRader(liste, T) {
  const tr = typeof T === "function" ? T : (s) => s;
  const { kolonner, total } = liste;
  const rader = [[tr("Blikk")].concat(kolonner.map(k => k.navn), [tr("Totalt")])];
  for (const [navn, felt] of BLIKK_RADER)
    rader.push([tr(navn)].concat(kolonner.map(k => tall(k[felt])), [tall(total[felt])]));
  return rader;
}
function tall(x) { return (x === null || x === undefined || !isFinite(x)) ? "" : Number(x); }
