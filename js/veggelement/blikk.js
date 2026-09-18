// 🩹 BLIKKET I 3D — «Blikk & Tak», runde 1 (Emil 17.09).
//
// Reglene bor i js/sw-blikk.js (rene tall, testet i Node mot en håndregnet
// fasit). Her bygges bare INNDATAENE fra det som ligger lagret, og strekene
// tegnes opp. Ingen regel skal stå to steder: finner du et regnestykke her,
// er det på feil sted.
//
// Verktøyet er EGET, ikke en seksjon i SW-panelet, og knappen vises først når
// det finnes genererte veggelement (Emils valg A1). Blikket regnes om av seg
// selv hver gang veggene tegnes (A2), så lista aldri viser gårsdagens vegg.
import { $, apnePanel, esc, ikon, på, S } from "../state.js";
import { lastNedXlsxFlere } from "../elements.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { blikkListe, hjorneYtre, justerListe, slaSammenTotaler, utsparingSider, BLIKK_RADER } from "../sw-blikk.js";
import { avsluttBlikkJuster, blikkJust, blikkLagringsTekst, blikkPa, blikkTilstand, fjernBlikk,
         genererBlikk, husBlikkMesh, lagreBlikkResultat, lastInnBlikkResultat, lesBlikkLagrede,
         nullstillBlikkMesh, slettBlikkResultat, startBlikkJuster } from "./blikk-just.js";
import { tilMm, tilScene } from "./regler.js";
import { lagret, oppsett, swGroup, skrivLagret } from "./tilstand.js";
import { innerData } from "./panel.js";
import { koblTakPanel, takPanelHtml } from "./tak.js";
import { baseYNaa, skjulNaa, tegnAlt, utspPaFasader } from "./tegning.js";

// Blikket har ÉN farge, som settes selv — akkurat som veggelementene
// (Emil 17.09). De gule og blå strekene i den første runden var bare en
// illustrasjon av HVOR blikket skulle ligge.
// 📐 PROFILENE. Blikket er BRETTET PLATE, ikke en strek: et toppbeslag er en
// kappe som legger seg over veggtoppen og brettes ned et stykke på hver side,
// et hjørnebeslag er en L rundt hjørnet, og hatprofilen over skjøten er en
// hatt som ligger på veggflaten. Emil 17.09, med bilde av et ekte bygg:
// «de gule og blå strekene var kun for å illustrere HVOR blikket skal, ikke
// hvordan det skal se ut».
//
// Alle målene er PLASSHOLDERE til de ekte er målt opp — derfor står de som
// settbare felt, så de kan byttes uten at noe annet røres.
// 🔎 EMIL 17.09: «hjørne-L-beslaget er for kort i sidene — det skal ha samme
// lengde som blikket som går rundt fasaden, som i dette tilfellet er 200 mm».
// Derfor er det ÉN verdi for alt blikket som ligger på veggflaten:
// toppbeslagets nedbrett, bunnbeslagets oppbrett, hjørnebeina, endebeslaget
// og beslaget rundt utsparingene. Setter du `benUteMm`, følger alle fem.
// Det var fem tall som kunne komme i utakt; nå er det ett.
export const STD_BLIKK = {
  blikkFarge: "#9aa3ad",     // settes selv, som veggelementene
  blikkTykkMm: 1.5,          // platetykkelsen
  benUteMm: 200,             // blikkets ben PÅ VEGGFLATEN — gjelder alle fem
  benInneMm: 40,             // returen inn på innsiden av kappene
  hatToppMm: 60,             // hatprofilen over skjøten: bredden på hatten
  hatFlensMm: 30,            //            flensen som ligger på veggen
  hatHoydeMm: 20,            //            hvor høyt hatten står ut
  lokkOverMm: 10,            // hvor langt kappen stikker OVER veggtoppen
  stangLengdeM: 2.5
};
// Gamle oppsett hadde blikkBreddeMm, toppNedUteMm, hjorneBenMm og flere —
// de er ikke lenger i bruk, og standardverdiene over fyller hullene selv.

// 🔧 TO SETT MED MÅL: ett for fasadene og ett for innerveggene (Emil 18.09).
// «Fasadeelement og innerveggelement har ofte forskjellige dimensjoner, som
// vil si at de også trenger forskjellige dimensjoner på blikk.» Samme skille
// som SW-generatoren allerede har mellom del A og innerveggene.
export const BLIKK_SETT = ["ytter", "inner"];
export const BLIKK_SETT_NAVN = { ytter: "Fasader", inner: "Innervegger" };
const settNokkel = (sett) => (sett === "inner" ? "inner" : "ytter");
// Har lagringen de to nøklene, er den ny. Ellers er det ETT flatt oppsett
// fra før 18.09 — det gjelder da for begge sett, så ingenting hopper.
function erDelt(o) { return !!o && (o.ytter !== undefined || o.inner !== undefined); }

export function blikkOppsett(sett) {
  const o = (lagret && lagret.blikkOppsett) || {};
  const gammelt = erDelt(o) ? {} : o;
  return { ...STD_BLIKK, ...gammelt, ...(erDelt(o) ? (o[settNokkel(sett)] || {}) : {}) };
}
export function settBlikkOppsett(sett, ny) {
  if (!lagret) return;
  const o = lagret.blikkOppsett || {};
  const base = erDelt(o) ? o
    : { ytter: { ...o }, inner: { ...o } };   // migrering: det flate blir begge
  const k = settNokkel(sett);
  lagret.blikkOppsett = { ...base, [k]: { ...blikkOppsett(k), ...ny } };
  skrivLagret();
}

// ───────────────── inndataene, lest av det som ligger lagret ─────────────────

// Fasadenes endepunkter, til hjørnene. Samme punkter som fasadeHjorner bruker.
export function fasadeEnder(fasader) {
  return (fasader || []).map(f => [
    { x: f.px + f.ex * f.t0, z: f.pz + f.ez * f.t0 },
    { x: f.px + f.ex * f.t1, z: f.pz + f.ez * f.t1 }
  ]);
}

// Én «vegg» per fasade (eller per innervegg-bein), slik sw-blikk.js vil ha
// den. Bare SYNLIGE element — et element som er dratt bort eller skjult har
// ingen kant å dekke.
//
// `flater` er 1 for en fasade og 2 for en innervegg: den står inne i bygget og
// er eksponert på begge sider (Emil 17.09).
export function blikkVegger(fasader, vegger, apninger, oStd, flater) {
  const o = oStd || oppsett();
  return (fasader || []).map((f, fi) => {
    const tyk = (f.o && f.o.tykkelseMm !== undefined) ? f.o.tykkelseMm : o.tykkelseMm;
    const egne = (vegger || []).filter(v => v && v.fi === fi && !v.ringmur && !v.skjult);
    const skjot = f.skjot && f.skjot.length >= 2 ? f.skjot
      : [Math.round(tilMm(f.t0)), Math.round(tilMm(f.t1))];
    const toppMm = egne.length ? Math.max(...egne.map(v => (v.rBunnMm || 0) + (v.hoydeMm || 0))) : 0;
    return {
      navn: f.navn || t("Fasade {0}", fi + 1), fi, flater: flater || 1, tykkelseMm: tyk,
      t0Mm: skjot[0], t1Mm: skjot[skjot.length - 1],
      bunnMm: 0, toppMm, linje: f.takLinje || null,
      skjot, klaringMm: (f.o && f.o.klaringMm !== undefined) ? f.o.klaringMm : o.klaringMm,
      kantStart: { eier: true, type: "hjorne" }, kantSlutt: { eier: true, type: "hjorne" },
      elementer: egne.map(v => ({ fraMm: v.fraMm, tilMm: v.tilMm, rBunnMm: v.rBunnMm || 0,
        hoydeMm: v.hoydeMm, hVMm: v.hVMm, hHMm: v.hHMm })),
      utsparinger: (apninger || []).filter(a => a && a.fi === fi).map(a => ({
        // bunnen sendes RÅ (kan være under veggfeltet): sw-blikk trenger å se
        // at åpningen går ned til gulvet for å droppe den fjerde siden.
        type: a.type, fraMm: a.fraMm, tilMm_: a.tilMm_,
        bunnMm: a.bunnMm,
        toppMm: Math.abs(a.toppMm) > 1e8 ? toppMm : Math.min(a.toppMm, toppMm),
        breddeMm: Math.max(0, a.tilMm_ - a.fraMm),
        hoydeMm: Math.max(0, Math.min(Math.abs(a.toppMm) > 1e8 ? toppMm : a.toppMm, toppMm)
                           - Math.max(a.bunnMm, 0))
      }))
    };
  });
}

// Blikket for HELE modellen, delt i to sett: ytterveggene og innerveggene.
// De regnes hver for seg fordi hjørnene skal finnes INNENFOR et sett — en
// innervegg som ender i nærheten av en fasade danner ikke et bygghjørne.
//
// Returnerer { deler: [{ erInner, fasader, vegger, liste, baseY }], total },
// eller null når det ikke finnes noe å regne på.
export function blikkDeler() {
  const deler = [];
  const legg = (fasader, vegger, apninger, oStd, flater, erInner, baseY) => {
    if (!(fasader || []).length) return;
    // 600 mm i SCENE-enheter — fasadenes endepunkter ligger i scene, ikke mm.
    // Samme toleranse som fasadeHjorner() bruker i generer.js. Eierskapet av
    // hvert hjørne avgjøres inne i blikkListe (medHjorner), ikke her.
    // hjorneDekkerMm: en skjøt under L-beslaget er allerede dekket — og den
    // leses fra SETTETS eget ben, siden de to settene kan ha ulike mål.
    const b = blikkOppsett(erInner ? "inner" : "ytter");
    const o = { ...b, hjorneTolMm: tilScene(600), hjorneDekkerMm: b.benUteMm };
    const inn = blikkVegger(fasader, vegger, apninger, oStd, flater);
    // 🔧 HÅNDJUSTERINGENE legges på TIL SLUTT, oppå det regnede (runde 2b).
    // Rekkefølgen er hele poenget: blikket regnes alltid av dagens vegger, og
    // justeringene er et tillegg som overlever en ny generering.
    const sett = erInner ? "inner" : "ytter";
    const bt = blikkTilstand();
    const liste = justerListe(blikkListe(inn, o, fasadeEnder(fasader)), inn, sett,
      bt.just, (bt.ekstra || []).filter(x => x && x.sett === sett), o);
    deler.push({ erInner, sett, fasader, vegger: inn, baseY, oStd, b, liste });
  };
  const oA = (lagret && lagret.oppsett) || oppsett();
  if (lagret && (lagret.fasader || []).length)
    legg(lagret.fasader, lagret.vegger, utspPaFasader(), oA, 1, false, baseYNaa());
  // 🚪 INNERVEGGENE: ÉN flate, og sin egen base. Egen try/catch — del B kan
  // mangle eller være tom uten at ytterveggenes blikk skal ryke med.
  //
  // 🔎 EMILS REGEL 18.09: «det skal kun blikk på en side av innervegg og det er
  // siden som er lengst vekke fra søylen» — du får ikke festet blikk mellom en
  // søyle og et veggelement. Innerveggens fasadenormal er akse.nx·side, altså
  // den veien veggen er forskjøvet BORT fra søyleaksen, så flaten blikket skal
  // på er nøyaktig `nrm` — den samme som på en fasade. Derfor er `flater` nå 1,
  // og tegningen trenger ingen ny retning: baksiden faller bare bort.
  let d = null;
  try { d = innerData(); } catch (err) { console.warn("Innerveggenes blikk:", err); }
  if (d && (d.fasader || []).length)
    legg(d.fasader, d.vegger, d.utspVis || [], oA, 1, true, d.baseY);
  if (!deler.length) return null;
  // Stengene regnes av grand-totalen med FASADENES stanglengde — det er én
  // bestilling, og de to settene deler leverandør.
  return { deler, total: slaSammenTotaler(deler.map(x => x.liste), blikkOppsett("ytter")) };
}

// Alle kolonnene fra begge sett, i én liste — til panelet og til arket.
export function blikkKolonner(data) {
  return ((data && data.deler) || []).flatMap(d => d.liste.kolonner);
}

// ───────────────────────── tegningen ─────────────────────────
//
// Hvert blikkstykke er BRETTET PLATE. Tverrsnittet oppgis som en polylinje i
// mm, i planet PÅ TVERS av strekningen:
//
//     u = utover fra veggens MIDTPLAN (positiv ut av bygget)
//     v = på tvers av løpsretningen i det planet (retningen `up` bestemmer)
//
// Hver rette strekning i polylinja blir én brett — én tynn boks. Et
// toppbeslag er tre bretter, et hjørnebein ett, en hatprofil fem.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const matBuffer = new Map();
function blikkMat(farge) {
  if (!matBuffer.has(farge))
    matBuffer.set(farge, new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide }));
  return matBuffer.get(farge);
}

// Punktet på veggens MIDTPLAN ved fasade-mm `tMm` og høyde `yMm` over
// SW-basen. Tverrsnittet plasserer seg selv utover derfra.
export function punktPaa(f, tMm, yMm, baseY) {
  const tS = tilScene(tMm);
  return V3(f.px + f.nx * f.off + f.ex * tS,
            baseY + tilScene(yMm),
            f.pz + f.nz * f.off + f.ez * tS);
}

// Ett brettet profil langs strekningen p1 → p2.
export function profilStrek(p1, p2, upV, nrmV, tverrsnitt, tykkM, farge, leggFn) {
  const d = new THREE.Vector3().subVectors(p2, p1);
  const len = d.length();
  if (!(len > 1e-6)) return 0;
  const dir = d.clone().normalize();
  const n = nrmV.clone().normalize();
  // 🔎 EMILS FUNN 18.09 (bilde 2–3): blikket la seg feil på saltak. På en gavl
  // løper toppbeslaget LANGS skråningen, og (0,1,0) er da ikke vinkelrett på
  // løpsretningen. Basisen ble skjev, og kappen la seg på tvers av veggtoppen
  // i stedet for oppå den. `up` trekkes derfor fra sin egen komponent langs
  // løpet — da er den vinkelrett uansett helning, og på en vannrett vegg er
  // den nøyaktig som før.
  const up = upV.clone().normalize();
  up.addScaledVector(dir, -up.dot(dir));
  if (up.lengthSq() < 1e-12) return 0;   // up peker langs løpet: ingen retning
  up.normalize();
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  let antall = 0;
  for (let i = 1; i < (tverrsnitt || []).length; i++) {
    const [u0, v0] = tverrsnitt[i - 1], [u1, v1] = tverrsnitt[i];
    const du = tilScene(u1 - u0), dv = tilScene(v1 - v0);
    const segLen = Math.hypot(du, dv);
    if (!(segLen > 1e-9)) continue;
    // brettets egen retning i tverrsnittsplanet, uttrykt i verden
    const segDir = n.clone().multiplyScalar(du / segLen)
      .add(up.clone().multiplyScalar(dv / segLen)).normalize();
    const zAks = new THREE.Vector3().crossVectors(dir, segDir).normalize();
    if (!isFinite(zAks.x) || zAks.lengthSq() < 1e-9) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), blikkMat(farge));
    m.scale.set(len, segLen, tykkM);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, segDir, zAks));
    m.position.copy(mid)
      .add(n.clone().multiplyScalar(tilScene((u0 + u1) / 2)))
      .add(up.clone().multiplyScalar(tilScene((v0 + v1) / 2)));
    leggFn(m);
    antall++;
  }
  return antall;
}

// ── tverrsnittene, alle i mm fra veggens midtplan ──
// `halv` er halve veggtykkelsen pluss en liten klaring, så platen ligger
// UTENPÅ elementet og ikke inni det.

// Kappe over veggtoppen: ned på innsiden, over toppen, ned på utsiden.
//
// 🔎 EMILS FUNN 18.09 (bilde 1): kappen lå MIDT I veggtoppen, ikke oppå den.
// Platen er en tynn boks sentrert på tverrsnittslinja, så med linja i v = 0
// havnet halve platen inne i elementet, og på et saltak — der elementets
// overkant og kappen ligger i samme skråplan — kunne man se rett gjennom fra
// visse vinkler. Toppflaten løftes derfor `over` mm, mens beina fortsatt
// måles fra veggtoppen og ned: kappen er BRETTET OVER kanten, som i virkeligheten.
export function tvsnTopp(halv, nedInne, nedUte, over) {
  const o = Number(over) || 0;
  return [[-halv, -nedInne], [-halv, o], [halv, o], [halv, -nedUte]];
}
// Kappe under veggbunnen: speilvendt — lokket stikker tilsvarende NED under
// veggbunnen, inn mot ringmuren.
export function tvsnBunn(halv, oppInne, oppUte, over) {
  const o = Number(over) || 0;
  return [[-halv, oppInne], [-halv, -o], [halv, -o], [halv, oppUte]];
}
// Kappe over en fri endeflate: retur inn på begge veggflater.
export function tvsnEnde(halv, ret) {
  return [[-halv, -ret], [-halv, 0], [halv, 0], [halv, -ret]];
}
// Ett bein av hjørnebeslaget: en flat strimmel som ligger på veggflaten og
// løper innover langs fasaden fra hjørnet. To slike, ett per fasade, gir L-en.
// Beinet settes ut fra det VIRKELIGE ytterhjørnet (se hjorneYtre), så u måles
// fra ytterflaten og ikke fra veggens midtplan.
export function tvsnHjorneBein(klaring, ben) {
  return [[klaring, 0], [klaring, ben]];
}

// Hatprofil over skjøten: flens — opp — hatt — ned — flens.
export function tvsnHat(halv, topp, flens, hoyde) {
  const h2 = topp / 2;
  return [[halv, -(h2 + flens)], [halv, -h2], [halv + hoyde, -h2],
          [halv + hoyde, h2], [halv, h2], [halv, h2 + flens]];
}
// Beslaget langs en utsparingskant: dekker den kappede enden av elementet
// (hele veggtykkelsen) og brettes ut på veggflaten, bort fra åpningen.
export function tvsnUtsparing(halv, ben) {
  return [[-halv, 0], [halv, 0], [halv, ben]];
}

// Bare beinet — brukes på ANDRE flate av en innervegg, der den kappede enden
// allerede er dekket av profilet på første flate.
export function tvsnUtsparingBen(halv, ben) {
  return [[halv, 0], [halv, ben]];
}

// Veggtoppen ved fasade-mm t, lest av taklinja når den finnes.
function toppY(f, tMm, toppMm) {
  const L = f.takLinje;
  if (!L || L.length < 2) return toppMm;
  if (tMm <= L[0][0]) return L[0][1];
  if (tMm >= L[L.length - 1][0]) return L[L.length - 1][1];
  for (let i = 1; i < L.length; i++) if (tMm <= L[i][0]) {
    const [x0, y0] = L[i - 1], [x1, y1] = L[i];
    return x1 === x0 ? Math.max(y0, y1) : y0 + (y1 - y0) * (tMm - x0) / (x1 - x0);
  }
  return L[L.length - 1][1];
}

const OPP = () => V3(0, 1, 0);
const n0 = (x) => Number(x) || 0;

// Ben-lengden for ett stykke: stykkets egen hvis Emil har satt en, ellers
// settets. Hjørner og ender tegnes utenfor stykke-sløyfa og må slå opp selv.
function benFor(id, standard) {
  const j = (lagret && lagret.blikk && lagret.blikk.just && lagret.blikk.just[id]) || {};
  return Number.isFinite(Number(j.benMm)) && Number(j.benMm) > 0 ? Number(j.benMm) : standard;
}

// 👁 Knappen vises først når det finnes genererte veggelement (Emils valg A1).
// Bare «none» settes inline — tomt igjen, så gruppeskjulingen i
// verktoygrupper.js får bestemme resten. Setter vi «inline-flex» her, ville
// knappen stått i ALLE gruppene, siden inline stil slår CSS-en.
export function oppdaterBlikkKnapp() {
  const b = $("btnBlikk");
  if (!b) return;
  const har = !!(lagret && (lagret.vegger || []).length);
  b.style.display = har ? "" : "none";
  if (!har) $("blikkPanel")?.classList.remove("open");
}

// Alt blikket tegnet opp i swGroup. Kalles fra tegnDelA() etter veggene.
export function tegnBlikk() {
  oppdaterBlikkKnapp();
  nullstillBlikkMesh();
  const sk = skjulNaa();
  if (sk.blikk) return;
  // 🔌 «Generer blikk» er bryteren (runde 2b). Er den av, tegnes ingenting —
  // men reglene står klare, så neste trykk gir blikket med én gang.
  if (!blikkPa()) return;
  const data = blikkDeler();
  if (!data) return;
  if ($("blikkPanel")?.classList.contains("open")) tegnBlikkPanel();
  // `naa` peker på stykket som tegnes akkurat nå, så hver brett-boks kan få
  // stykkets id med seg. Uten den treffer et trykk i «Juster blikk» en
  // tilfeldig boks i stedet for beslaget.
  let naa = null;
  const legg = (m) => {
    m.userData.blikk = true;
    if (naa) { m.userData.blikkId = naa.id; m.userData.blikkSett = naa.sett; husBlikkMesh(naa.id, m, naa); }
    swGroup.add(m);
  };

  for (const del of data.deler) {
    // 🔧 Hvert sett har sine egne mål og sin egen farge (Emil 18.09).
    const b = del.b || blikkOppsett(del.erInner ? "inner" : "ytter");
    const tykkM = tilScene(b.blikkTykkMm);
    const farge = b.blikkFarge || STD_BLIKK.blikkFarge;
    const klaring = b.blikkTykkMm;
    const tegn = (p1, p2, up, n, tvsn) => profilStrek(p1, p2, up, n, tvsn, tykkM, farge, legg);
    const fasader = del.fasader || [];
    // Innerveggene har sin egen base og sin egen tykkelse per bein.
    const baseYFor = (f) => (f.baseY !== undefined ? f.baseY : del.baseY) || 0;

    del.liste.kolonner.forEach((kol, fi) => {
      const f = fasader[fi];
      if (!f) return;
      const vegg = del.vegger[fi];
      if (!vegg) return;
      const baseY = baseYFor(f);
      // halve veggtykkelsen + platetykkelsen: profilet ligger utenpå elementet
      const halv = (vegg.tykkelseMm || 100) / 2 + b.blikkTykkMm;
      const nrm = V3(f.nx, 0, f.nz);
      const bak = nrm.clone().negate();
      const langs = V3(f.ex, 0, f.ez);
      const P = (tMm, yMm) => punktPaa(f, tMm, yMm, baseY);
      // fasadens origo i verden — «Juster blikk» regner seg tilbake hit
      const fx = f.px + f.nx * f.off, fz = f.pz + f.nz * f.off;
      const grunn = { sett: del.sett, fi, fasade: kol.navn, baseY,
        fx, fz, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz };
      for (const s of kol.stykker) {
        if (s.type === "hjorne" || s.type === "ende") continue;   // tegnes per hjørne
        naa = { ...grunn, id: s.id, type: s.type,
          loddrett: s.type === "skjot",
          fraMm: s.type === "skjot" ? n0(s.bunnMm) : n0(s.fraMm),
          tilMm: s.type === "skjot" ? n0(s.toppMm) : n0(s.tilMm) };
        // 🔧 EGEN BEN-LENGDE: stykket kan overstyre settets ben (Emil 17.09).
        const ben = Number.isFinite(Number(s.benMm)) ? Number(s.benMm) : b.benUteMm;
        // Blikkflatene. Etter Emils regel 18.09 har både fasader og
        // innervegger ÉN flate — `nrm`, siden som peker bort fra søylen. Får
        // en vegg en gang to flater, står regelen klar her.
        const flater = s.flater === 2 ? [nrm, bak] : [nrm];
        if (s.type === "topp") {
          // følger taklinja: ett profil per rett strekning, så gavlen får knekk
          const xs = [s.fraMm];
          for (const [x] of f.takLinje || []) if (x > s.fraMm + 1 && x < s.tilMm - 1) xs.push(x);
          xs.push(s.tilMm);
          // 🏔 I ET KNEKK (mønet, raftet) møtes to skrå lokk i vinkel, og uten
          // overlapp står det en kile åpen mellom dem — den andre halvparten av
          // Emils hull 18.09. Hvert lokk føres derfor `over` mm forbi knekket.
          const mitre = Math.max(2, Number(b.lokkOverMm) || 0);
          for (let k = 1; k < xs.length; k++) {
            const a2 = xs[k - 1] - (k > 1 ? mitre : 0);
            const c2 = xs[k] + (k < xs.length - 1 ? mitre : 0);
            tegn(P(a2, toppY(f, a2, vegg.toppMm)), P(c2, toppY(f, c2, vegg.toppMm)),
              OPP(), nrm, tvsnTopp(halv, b.benInneMm, ben, b.lokkOverMm));
          }
        } else if (s.type === "bunn") {
          tegn(P(s.fraMm, 0), P(s.tilMm, 0), OPP(), nrm,
            tvsnBunn(halv, b.benInneMm, ben, b.lokkOverMm));
        } else if (s.type === "skjot") {
          for (const n of flater)
            for (const [y0, y1] of s.deler || [])
              tegn(P(s.tMm, y0), P(s.tMm, y1), langs, n,
                tvsnHat(halv, b.hatToppMm, b.hatFlensMm, b.hatHoydeMm));
        } else if (s.type === "ende" && s.lagtTil) {
          // ➕ En strekning Emil la til selv: en kappe over en fri kant.
          for (const [y0, y1] of s.deler || [])
            tegn(P(s.tMm, y0), P(s.tMm, y1), langs, nrm, tvsnEnde(halv, ben));
        } else if (s.type === "utsparing" && s.fraMm !== undefined) {
          const { fraMm: a, tilMm: c, bunnMm: y0, toppMm: y1 } = s;
          flater.forEach((n, iF) => {
            // Den kappede enden av elementet dekkes ÉN gang — profilet spenner
            // hele veggtykkelsen. Den andre flaten får bare beinet.
            const tv = iF === 0 ? tvsnUtsparing(halv, ben) : tvsnUtsparingBen(halv, ben);
            tegn(P(a, y1), P(c, y1), OPP(), n, tv);                              // over
            tegn(P(a, y0), P(a, y1), langs.clone().negate(), n, tv);             // venstre
            tegn(P(c, y0), P(c, y1), langs, n, tv);                              // høyre
            if (s.sider === 4) tegn(P(a, y0), P(c, y0), V3(0, -1, 0), n, tv);    // under
          });
        }
      }
    });

    // 📐 HJØRNENE: ETT L-beslag per hjørne, uansett hvem som bærer løpemeteren
    // i lista (Emil 17.09). Beina settes ut fra det VIRKELIGE ytterhjørnet —
    // skjæringen mellom de to ytterflatene — og løper innover langs hver sin
    // fasade. Da lukker L-en seg om hjørnet selv om pinwheel-regelen lar den
    // ene veggen løpe forbi den andre.
    for (const h of del.liste.hjorner || []) {
      for (const k of h.kanter) {
        const f = fasader[k.fasade];
        const vegg = del.vegger[k.fasade];
        if (!f || !vegg) continue;
        const baseY = baseYFor(f);
        naa = { sett: del.sett, fi: k.fasade, fasade: (del.liste.kolonner[k.fasade] || {}).navn,
          baseY, fx: f.px + f.nx * f.off, fz: f.pz + f.nz * f.off,
          ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz, loddrett: true,
          type: k.type || "hjorne", fraMm: n0(h.bunnMm), tilMm: n0(h.toppMm),
          id: (del.sett) + ":" + k.fasade + ":" + (k.type || "hjorne") + ":" +
              Math.round(n0(k.tMm !== undefined ? k.tMm : (k.ende === "start" ? vegg.t0Mm : vegg.t1Mm)) / 10) * 10 };
        const halv = (vegg.tykkelseMm || 100) / 2 + b.blikkTykkMm;
        const halvS = tilScene((vegg.tykkelseMm || 100) / 2);
        const nabo = h.kanter.find(a => a.fasade !== k.fasade);
        const fB = nabo ? fasader[nabo.fasade] : null;
        const veggB = nabo ? del.vegger[nabo.fasade] : null;
        const halvBS = veggB ? tilScene((veggB.tykkelseMm || 100) / 2) : halvS;
        const nrm = V3(f.nx, 0, f.nz);
        const langs = V3(f.ex, 0, f.ez);
        const start = k.ende === "start";
        const inn = start ? langs : langs.clone().negate();
        const tEnde = start ? vegg.t0Mm : vegg.t1Mm;
        const yt = hjorneYtre(f, fB, halvS, halvBS);
        if (yt) {
          // ekte hjørne: beinet starter i ytterhjørnet og løper innover
          const p = (yMm) => V3(yt.x, baseY + tilScene(yMm), yt.z);
          tegn(p(h.bunnMm), p(h.toppMm), inn, nrm, tvsnHjorneBein(klaring, benFor(naa.id, b.benUteMm)));
        } else if (fB) {
          // 🔎 NABOEN ER PARALLELL. Da er dette ikke noe hjørne — det er en
          // SKJØT i en rett vegg, to bein uten knekk (Emils bilde 1, 18.09:
          // «mye lengre den andre veien» var endekappen tegnet midt på en
          // rett vegg). Hatprofil, ikke kappe. Bare ÉN av de to beina tegner
          // den, ellers står to hatter i samme skjøt.
          if (h.eier !== k.fasade) continue;
          const p = (yMm) => punktPaa(f, tEnde, yMm, baseY);
          const flater = (vegg.flater === 2) ? [nrm, nrm.clone().negate()] : [nrm];
          for (const n of flater)
            tegn(p(h.bunnMm), p(h.toppMm), langs, n,
              tvsnHat(halv, b.hatToppMm, b.hatFlensMm, b.hatHoydeMm));
        } else {
          // FRI ENDE: kappe over selve endeflaten, pluss en retur inn på
          // veggen. Her er isolasjonen eksponert på tvers.
          const p = (yMm) => punktPaa(f, tEnde, yMm, baseY);
          tegn(p(h.bunnMm), p(h.toppMm), inn.clone().negate(), nrm, tvsnEnde(halv, benFor(naa.id, b.benUteMm)));
        }
      }
    }
  }
}

// ───────────────────────── panelet ─────────────────────────

// Feltene som kan stilles. `felt` er nøkkelen i blikkOppsett().
export const BLIKK_FELT = [
  ["blikkTykkMm", "Platetykkelse (mm)"],
  ["benUteMm", "Ben på veggflaten (mm)"],
  ["benInneMm", "Retur på innsiden (mm)"],
  ["hatToppMm", "Hatprofil bredde (mm)"],
  ["hatFlensMm", "Hatprofil flens (mm)"],
  ["hatHoydeMm", "Hatprofil høyde (mm)"],
  ["lokkOverMm", "Lokk over topp og bunn (mm)"],
  ["stangLengdeM", "Stanglengde (m)"]
];

// Knapperada og lagrede resultater — SAMME oppsett som SW-generator (Emil
// 18.09). Rekkefølgen er SW-panelets, ikke en ny: Generer · Juster · Tegning ·
// Excel · Fjern, og lagrede resultater nederst.
function blikkHandlingerHtml() {
  const bt = blikkTilstand();
  const lagrede = lesBlikkLagrede();
  const antJust = Object.keys(bt.just || {}).length + (bt.ekstra || []).length;
  return "" +
    "<div class='prop-actions' style='margin-top:10px;flex-wrap:wrap'>" +
    "<button id='blikkGenerer' class='primary'>" + ikon("boks") + " " + esc(t("Generer blikk")) + "</button>" +
    "<button id='blikkJusterBtn'" + (bt.pa ? "" : " disabled") + ">" + ikon("juster") + " " + esc(t("Juster blikk")) + "</button>" +
    // 📐 Instruksjonstegninga for blikket bygges i runde 5 — Emil sa selv at
    // PDF-en kan komme senere. Knappen står her, avslått og med grunnen på
    // plass, slik at panelet er ferdig og det ikke er tvil om hva som mangler.
    "<button id='blikkTegning' disabled title='" +
      esc(t("Instruksjonstegninga for blikket bygges i en senere runde.")) + "'>" +
      ikon("tegning") + " " + esc(t("Last ned instruksjonstegning (PDF)")) + "</button>" +
    "<button id='blikkListe'" + (bt.pa ? "" : " disabled") + ">" + ikon("lastned") + " " + esc(t("Last ned liste (Excel)")) + "</button>" +
    "<button id='blikkFjern'" + (bt.pa ? "" : " disabled") + ">" + ikon("slett") + " " + esc(t("Fjern genererte")) + "</button>" +
    "</div>" +
    (bt.pa
      ? "<p class='hint'>" + esc(antJust
          ? t("Blikket er generert og følger veggene. {0} håndjusteringer ligger på.", antJust)
          : t("Blikket er generert og følger veggene av seg selv.")) + "</p>"
      : "<p class='hint'>" + esc(t("Trykk «Generer blikk» for å legge blikket på bygget.")) + "</p>") +
    "<h4 data-sek='blikklagrede' style='margin:14px 0 4px'>" + esc(t("Lagrede blikkresultater")) + "</h4>" +
    "<p class='hint'>" + esc(t("Gi oppsettet et navn og lagre det. Trykk på navnet senere for å legge samme profilmål og håndjusteringer på bygget igjen.")) + "</p>" +
    "<p class='hint'>" + esc(blikkLagringsTekst()) + "</p>" +
    "<div class='prop-actions sw-lagre'>" +
      "<input type='text' id='blikkLagreNavn' maxlength='60' placeholder='" +
      esc(t("Navn på resultatet")) + "'>" +
      "<button id='blikkLagreBtn'>" + ikon("lagre") + " " + esc(t("Lagre")) + "</button></div>" +
    (lagrede.length
      ? lagrede.map(pst =>
        "<div class='qty-row'><div class='n' style='font-size:12px'>" +
          "<button class='sw-last' data-blikk-last='" + esc(pst.navn) + "'>" + esc(pst.navn) + "</button>" +
          " <span style='color:var(--muted);font-size:11px'>" +
          esc([pst.dato, pst.antall ? t("{0} justeringer", pst.antall) : "", pst.av || ""].filter(Boolean).join(" · ")) +
          "</span></div>" +
        "<div class='c'><button data-blikk-slett='" + esc(pst.navn) + "' title='" + esc(t("Slett")) +
        "' style='padding:3px 8px'>" + ikon("slett") + "</button></div></div>").join("")
      : "<p class='hint'>" + esc(t("Ingen lagrede resultater ennå.")) + "</p>");
}

export function blikkPanelHtml() {
  const data = blikkDeler();
  if (!data) return "<p class='hint'>" + esc(t("Generer veggelementene først.")) + "</p>";
  const total = data.total, kolonner = blikkKolonner(data);
  const hjorner = data.deler.reduce((a, d) => a + (d.liste.hjorner || []).length, 0);
  const innerVegger = data.deler.filter(d => d.erInner)
    .reduce((a, d) => a + d.liste.kolonner.length, 0);
  // To desimaler i panelet: «40,332 lm» er falsk presisjon på et tall som
  // bestilles i hele stenger. Arket beholder de eksakte verdiene.
  const vis = (x) => (typeof x === "number" && !Number.isInteger(x))
    ? x.toFixed(2).replace(".", ",") : String(x);
  const rad = (navn, felt, enhet) =>
    "<tr><td>" + esc(t(navn)) + "</td><td style='text-align:right'>" +
    esc(vis(total[felt])) + (enhet ? " " + esc(enhet) : "") + "</td></tr>";
  // 🔧 ETT MÅLSETT PER VEGGTYPE (Emil 18.09). Seksjonene har egne id-er med
  // settet som prefiks, så de to blokkene aldri kan skrive over hverandre.
  const malBlokk = (sett) => {
    const b = blikkOppsett(sett);
    return "<h4 data-sek='blikkmal-" + sett + "'>" +
      esc(t("Profilmål") + " — " + t(BLIKK_SETT_NAVN[sett])) + "</h4>" +
      "<label>" + esc(t("Farge")) + "<input type='color' id='blikkFarge_" + sett +
        "' value='" + esc(b.blikkFarge || STD_BLIKK.blikkFarge) + "'></label>" +
      BLIKK_FELT.map(([id, tekst]) =>
        "<label class='swfelt'><span>" + esc(t(tekst)) + "</span>" +
        "<input id='f_" + sett + "_" + id + "' type='number' step='any' min='0' value='" +
        esc(String(b[id])) + "'></label>").join("");
  };
  return "" +
    "<p class='hint'>" + esc(t("Blikket regnes av de synlige veggelementene — det du ser her er det som bestilles.")) + "</p>" +
    "<table class='swtab'><tbody>" +
    rad("Toppbeslag", "toppLm", "lm") +
    rad("Bunnbeslag", "bunnLm", "lm") +
    rad("Hjørne- og endebeslag", "kantLm", "lm") +
    rad("Beslag totalt", "beslagLm", "lm") +
    rad("Skrue beslag", "skruerBeslag", "stk") +
    rad("Hatprofil skjøt", "skjotLm", "lm") +
    rad("Hatprofil utsparing", "utsparingLm", "lm") +
    rad("Hatprofil totalt", "hatprofilLm", "lm") +
    rad("Skrue hatprofil", "skruerHatprofil", "stk") +
    rad("Blikk", "stenger", "stenger") +
    "</tbody></table>" +
    "<p class='hint'>" + esc(t("{0} hjørner · {1} fasader", hjorner, kolonner.length - innerVegger)) +
      (innerVegger ? " · " + esc(t("{0} innervegger (én side)", innerVegger)) : "") + "</p>" +
    malBlokk("ytter") +
    (innerVegger ? malBlokk("inner") : "") +
    blikkHandlingerHtml() +
    // 🏔 TAK-SEKSJONEN. «Blikk & Tak» er ÉTT verktøy med to seksjoner i samme
    // panel (vedtatt spesifikasjon §1) — ikke to knapper.
    "<h4 data-sek='tak' style='margin:18px 0 4px'>" + esc(t("Tak")) + "</h4>" +
    takPanelHtml();
}

export function tegnBlikkPanel() {
  const body = $("blikkBody");
  if (!body) return;
  body.innerHTML = blikkPanelHtml();
  koblBlikkHandlinger(body);
  koblTakPanel(() => tegnBlikkPanel());
  const les = (sett) => () => {
    const f = $("blikkFarge_" + sett);
    const ny = { blikkFarge: (f && f.value) || STD_BLIKK.blikkFarge };
    for (const [id] of BLIKK_FELT) {
      const e = $("f_" + sett + "_" + id);
      const v = e ? Number(e.value) : NaN;
      ny[id] = Number.isFinite(v) && v >= 0 ? v : STD_BLIKK[id];
    }
    settBlikkOppsett(sett, ny);
    tegnAlt();
  };
  for (const sett of BLIKK_SETT) {
    const h = les(sett);
    const f = $("blikkFarge_" + sett);
    if (f) f.onchange = h;
    for (const [id] of BLIKK_FELT) {
      const e = $("f_" + sett + "_" + id);
      if (e) e.onchange = h;
    }
  }
}

// Knapperada og lagrede resultater kobles opp. Egen funksjon, ikke inne i
// tegnBlikkPanel: panelet tegnes fra flere steder, og knappene må virke uansett
// hvem som tegnet det.
export function koblBlikkHandlinger(body) {
  const paa_nytt = () => tegnBlikkPanel();
  if ($("blikkGenerer")) $("blikkGenerer").onclick = () => { if (genererBlikk()) tegnBlikkPanel(); };
  if ($("blikkJusterBtn")) $("blikkJusterBtn").onclick = () => startBlikkJuster(paa_nytt);
  if ($("blikkListe")) $("blikkListe").onclick = lastNedBlikkListe;
  if ($("blikkFjern")) $("blikkFjern").onclick = () => { if (fjernBlikk()) tegnBlikkPanel(); };
  if ($("blikkLagreBtn")) $("blikkLagreBtn").onclick = () =>
    lagreBlikkResultat(($("blikkLagreNavn") || {}).value,
      { ytter: blikkOppsett("ytter"), inner: blikkOppsett("inner") }, paa_nytt);
  (body || document).querySelectorAll("button[data-blikk-last]").forEach(b =>
    b.onclick = () => lastInnBlikkResultat(b.dataset.blikkLast, (o) => {
      for (const sett of BLIKK_SETT) if (o && o[sett]) settBlikkOppsett(sett, o[sett]);
    }, paa_nytt));
  (body || document).querySelectorAll("button[data-blikk-slett]").forEach(b =>
    b.onclick = () => slettBlikkResultat(b.dataset.blikkSlett, paa_nytt));
}

// 📊 «Last ned liste (Excel)» fra Blikk-panelet: EN fil med blikkarket alene.
// Blikket er et eget verktøy med egen bestilling — den som bestiller beslag
// skal ikke måtte lete gjennom SW-lista. Arket er det SAMME som ligger i
// SW-fila, så de to kan aldri komme i utakt.
export function lastNedBlikkListe() {
  if (!blikkPa()) { alert(t("Trykk «Generer blikk» først.")); return; }
  const ark = blikkArk();
  if (!ark) { alert(t("Generer veggelementene først.")); return; }
  const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  lastNedXlsxFlere(navn + " - Blikkliste.xlsx", [ark]).catch(err => {
    console.warn("Blikklista kunne ikke lages:", err);
    alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
  });
}

// Arket «Blikk» til Excel-fila. Samme form som Materiell-arket.
export function blikkArk() {
  const data = blikkDeler();
  if (!data) return null;
  const kol = blikkKolonner(data);
  const rader = [[t("Blikk")].concat(kol.map(k => k.navn), [t("Totalt")])];
  for (const [navn, felt] of BLIKK_RADER)
    rader.push([t(navn)].concat(kol.map(k => tallEl(k[felt])), [tallEl(data.total[felt])]));
  return { navn: t("Blikk"), rader };
}
function tallEl(x) { return (x === null || x === undefined || !isFinite(x)) ? "" : Number(x); }

på("btnBlikk", "click", () => {
  const panel = $("blikkPanel");
  if (!panel) return;
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
  tegnBlikkPanel();
  apnePanel("blikkPanel");
});
