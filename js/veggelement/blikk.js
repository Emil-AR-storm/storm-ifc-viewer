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
import { $, apnePanel, esc, på } from "../state.js";
import { t } from "../i18n.js";
import * as THREE from "three";
import { blikkListe, utsparingSider, BLIKK_RADER } from "../sw-blikk.js";
import { tilMm, tilScene } from "./regler.js";
import { lagret, oppsett, swGroup, skrivLagret } from "./tilstand.js";
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
export const STD_BLIKK = {
  blikkFarge: "#9aa3ad",     // settes selv, som veggelementene
  blikkTykkMm: 1.5,          // platetykkelsen
  toppNedUteMm: 80,          // toppbeslaget brettes ned på utsiden
  toppNedInneMm: 40,         //            og et kortere stykke på innsiden
  bunnOppUteMm: 80,          // bunnbeslaget brettes opp på utsiden
  bunnOppInneMm: 40,
  hjorneBenMm: 100,          // hvert bein på L-beslaget i hjørnet
  endeRetMm: 60,             // endebeslagets retur inn på veggflaten
  hatToppMm: 60,             // hatprofilen over skjøten: bredden på hatten
  hatFlensMm: 30,            //            flensen som ligger på veggen
  hatHoydeMm: 20,            //            hvor høyt hatten står ut
  utspBenMm: 60,             // beslaget rundt utsparingen, på veggflaten
  stangLengdeM: 2.5
};
// Gamle oppsett hadde blikkBreddeMm og blikkTykkMm 12 — de er ikke lenger i
// bruk, og standardverdiene over fyller hullene av seg selv.

export function blikkOppsett() {
  const o = (lagret && lagret.blikkOppsett) || {};
  return { ...STD_BLIKK, ...o };
}
export function settBlikkOppsett(ny) {
  if (!lagret) return;
  lagret.blikkOppsett = { ...blikkOppsett(), ...ny };
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

// Én «vegg» per fasade, slik sw-blikk.js vil ha den. Bare SYNLIGE element —
// et element som er dratt bort eller skjult har ingen kant å dekke.
export function blikkVegger(lag, apninger) {
  const o = (lag && lag.oppsett) || oppsett();
  const fasader = (lag && lag.fasader) || [];
  return fasader.map((f, fi) => {
    const egne = (lag.vegger || []).filter(v => v && v.fi === fi && !v.ringmur && !v.skjult);
    const skjot = f.skjot && f.skjot.length >= 2 ? f.skjot
      : [Math.round(tilMm(f.t0)), Math.round(tilMm(f.t1))];
    const toppMm = egne.length ? Math.max(...egne.map(v => (v.rBunnMm || 0) + (v.hoydeMm || 0))) : 0;
    return {
      navn: t("Fasade {0}", fi + 1), fi,
      t0Mm: skjot[0], t1Mm: skjot[skjot.length - 1],
      bunnMm: 0, toppMm, linje: f.takLinje || null,
      skjot, klaringMm: o.klaringMm,
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

// Hele blikket for modellen som står. `kanter` er satt til eier=true på begge
// ender i blikkVegger; medHjorner inne i blikkListe retter dem opp mot de
// virkelige hjørnene, så et hjørne telles ÉN gang.
export function blikkNaa() {
  if (!lagret || !(lagret.fasader || []).length) return null;
  const apninger = utspPaFasader();
  const vegger = blikkVegger(lagret, apninger);
  const ender = fasadeEnder(lagret.fasader);
  // eierskapet regnes av geometrien, ikke av flagget over
  // 600 mm i SCENE-enheter — fasadenes endepunkter ligger i scene, ikke mm.
  // Samme toleranse som fasadeHjorner() bruker i generer.js. Eierskapet av
  // hvert hjørne avgjøres inne i blikkListe (medHjorner), ikke her: ett sted.
  const hjTol = tilScene(600);
  return { ...blikkListe(vegger, { ...blikkOppsett(), hjorneTolMm: hjTol }, ender), vegger };
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
  const up = upV.clone().normalize();
  const n = nrmV.clone().normalize();
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
export function tvsnTopp(halv, nedInne, nedUte) {
  return [[-halv, -nedInne], [-halv, 0], [halv, 0], [halv, -nedUte]];
}
// Kappe under veggbunnen: speilvendt.
export function tvsnBunn(halv, oppInne, oppUte) {
  return [[-halv, oppInne], [-halv, 0], [halv, 0], [halv, oppUte]];
}
// Kappe over en fri endeflate: retur inn på begge veggflater.
export function tvsnEnde(halv, ret) {
  return [[-halv, -ret], [-halv, 0], [halv, 0], [halv, -ret]];
}
// Ett bein av hjørnebeslaget: en flat strimmel som ligger på veggflaten og
// løper innover langs fasaden fra hjørnet. To slike, ett per fasade, gir L-en.
export function tvsnHjorneBein(halv, ben) {
  return [[halv, 0], [halv, ben]];
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
  const sk = skjulNaa();
  if (sk.blikk) return;
  const data = blikkNaa();
  if (!data) return;
  if ($("blikkPanel")?.classList.contains("open")) tegnBlikkPanel();
  const o = lagret.oppsett || oppsett();
  const b = blikkOppsett();
  const baseY = baseYNaa();
  const tykkM = tilScene(b.blikkTykkMm);
  const farge = b.blikkFarge || STD_BLIKK.blikkFarge;
  // halve veggtykkelsen + platetykkelsen: profilet ligger utenpå elementet
  const halv = (o.tykkelseMm || 100) / 2 + b.blikkTykkMm;
  const fasader = lagret.fasader || [];
  const legg = (m) => { m.userData.blikk = true; swGroup.add(m); };
  const tegn = (p1, p2, up, n, tvsn) => profilStrek(p1, p2, up, n, tvsn, tykkM, farge, legg);

  data.kolonner.forEach((kol, fi) => {
    const f = fasader[fi];
    if (!f) return;
    const vegg = data.vegger[fi];
    const nrm = V3(f.nx, 0, f.nz);
    const langs = V3(f.ex, 0, f.ez);      // fasadens egen retning
    const P = (tMm, yMm) => punktPaa(f, tMm, yMm, baseY);
    for (const s of kol.stykker) {
      if (s.type === "hjorne" || s.type === "ende") continue;   // tegnes per hjørne
      if (s.type === "topp") {
        // følger taklinja: ett profil per rett strekning, så gavlen får knekk
        const xs = [s.fraMm];
        for (const [x] of f.takLinje || []) if (x > s.fraMm + 1 && x < s.tilMm - 1) xs.push(x);
        xs.push(s.tilMm);
        for (let i = 1; i < xs.length; i++)
          tegn(P(xs[i - 1], toppY(f, xs[i - 1], vegg.toppMm)), P(xs[i], toppY(f, xs[i], vegg.toppMm)),
            OPP(), nrm, tvsnTopp(halv, b.toppNedInneMm, b.toppNedUteMm));
      } else if (s.type === "bunn") {
        tegn(P(s.fraMm, 0), P(s.tilMm, 0), OPP(), nrm,
          tvsnBunn(halv, b.bunnOppInneMm, b.bunnOppUteMm));
      } else if (s.type === "skjot") {
        for (const [y0, y1] of s.deler || [])
          tegn(P(s.tMm, y0), P(s.tMm, y1), langs, nrm,
            tvsnHat(halv, b.hatToppMm, b.hatFlensMm, b.hatHoydeMm));
      } else if (s.type === "utsparing" && s.fraMm !== undefined) {
        const { fraMm: a, tilMm: c, bunnMm: y0, toppMm: y1 } = s;
        const ben = b.utspBenMm;
        // OVER åpningen: `up` peker OPP, bort fra åpningen
        tegn(P(a, y1), P(c, y1), OPP(), nrm, tvsnUtsparing(halv, ben));
        // SIDENE: `up` peker bort fra åpningen, altså hver sin vei
        tegn(P(a, y0), P(a, y1), langs.clone().negate(), nrm, tvsnUtsparing(halv, ben));
        tegn(P(c, y0), P(c, y1), langs, nrm, tvsnUtsparing(halv, ben));
        // UNDER: bare når det er vegg under (vindu med fire sider)
        if (s.sider === 4)
          tegn(P(a, y0), P(c, y0), V3(0, -1, 0), nrm, tvsnUtsparing(halv, ben));
      }
    }
  });

  // 📐 HJØRNENE: ETT L-beslag per hjørne, uansett hvem som bærer løpemeteren
  // i lista (Emil 17.09). Beinet på hver fasade løper INNOVER fra hjørnet, og
  // de to møtes i selve hjørnet — det er L-en.
  for (const h of data.hjorner || []) {
    for (const k of h.kanter) {
      const f = fasader[k.fasade];
      const vegg = data.vegger[k.fasade];
      if (!f || !vegg) continue;
      const nrm = V3(f.nx, 0, f.nz);
      const langs = V3(f.ex, 0, f.ez);
      const start = k.ende === "start";
      const tEnde = start ? vegg.t0Mm : vegg.t1Mm;
      // innover langs fasaden: framover fra starten, bakover fra slutten
      const inn = start ? langs : langs.clone().negate();
      const ben = h.type === "hjorne" ? b.hjorneBenMm : b.endeRetMm;
      tegn(punktPaa(f, tEnde, h.bunnMm, baseY), punktPaa(f, tEnde, h.toppMm, baseY),
        inn, nrm, tvsnHjorneBein(halv, ben));
      // En FRI ende får i tillegg en kappe over selve endeflaten — der er
      // isolasjonen eksponert på tvers, ikke bare i hjørnet.
      if (h.type !== "hjorne")
        tegn(punktPaa(f, tEnde, h.bunnMm, baseY), punktPaa(f, tEnde, h.toppMm, baseY),
          inn.clone().negate(), nrm, tvsnEnde(halv, b.endeRetMm));
    }
  }
}

// ───────────────────────── panelet ─────────────────────────

// Feltene som kan stilles. `felt` er nøkkelen i blikkOppsett().
export const BLIKK_FELT = [
  ["blikkTykkMm", "Platetykkelse (mm)"],
  ["toppNedUteMm", "Toppbeslag ned utside (mm)"],
  ["toppNedInneMm", "Toppbeslag ned innside (mm)"],
  ["bunnOppUteMm", "Bunnbeslag opp utside (mm)"],
  ["bunnOppInneMm", "Bunnbeslag opp innside (mm)"],
  ["hjorneBenMm", "Hjørnebeslag bein (mm)"],
  ["endeRetMm", "Endebeslag retur (mm)"],
  ["hatToppMm", "Hatprofil bredde (mm)"],
  ["hatFlensMm", "Hatprofil flens (mm)"],
  ["hatHoydeMm", "Hatprofil høyde (mm)"],
  ["utspBenMm", "Utsparingsbeslag bein (mm)"],
  ["stangLengdeM", "Stanglengde (m)"]
];

export function blikkPanelHtml() {
  const data = blikkNaa();
  const b = blikkOppsett();
  if (!data) return "<p class='hint'>" + esc(t("Generer veggelementene først.")) + "</p>";
  const { total, kolonner } = data;
  // To desimaler i panelet: «40,332 lm» er falsk presisjon på et tall som
  // bestilles i hele stenger. Arket beholder de eksakte verdiene.
  const vis = (x) => (typeof x === "number" && !Number.isInteger(x))
    ? x.toFixed(2).replace(".", ",") : String(x);
  const rad = (navn, felt, enhet) =>
    "<tr><td>" + esc(t(navn)) + "</td><td style='text-align:right'>" +
    esc(vis(total[felt])) + (enhet ? " " + esc(enhet) : "") + "</td></tr>";
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
    "<p class='hint'>" + esc(t("{0} hjørner · {1} fasader", (data.hjorner || []).length, kolonner.length)) + "</p>" +
    "<h4 data-sek='blikkmal'>" + esc(t("Profilmål")) + "</h4>" +
    "<label>" + esc(t("Farge")) + "<input type='color' id='blikkFarge' value='" +
      esc(b.blikkFarge || STD_BLIKK.blikkFarge) + "'></label>" +
    BLIKK_FELT.map(([id, tekst]) =>
      "<label class='swfelt'><span>" + esc(t(tekst)) + "</span>" +
      "<input id='f_" + id + "' type='number' step='any' min='0' value='" +
      esc(String(b[id])) + "'></label>").join("");
}

export function tegnBlikkPanel() {
  const body = $("blikkBody");
  if (!body) return;
  body.innerHTML = blikkPanelHtml();
  const les = () => {
    const ny = { blikkFarge: ($("blikkFarge") || {}).value || STD_BLIKK.blikkFarge };
    for (const [id] of BLIKK_FELT) {
      const e = $("f_" + id);
      const v = e ? Number(e.value) : NaN;
      ny[id] = Number.isFinite(v) && v >= 0 ? v : STD_BLIKK[id];
    }
    settBlikkOppsett(ny);
    tegnAlt();
  };
  const f = $("blikkFarge");
  if (f) f.onchange = les;
  for (const [id] of BLIKK_FELT) {
    const e = $("f_" + id);
    if (e) e.onchange = les;
  }
}

// Arket «Blikk» til Excel-fila. Samme form som Materiell-arket.
export function blikkArk() {
  const data = blikkNaa();
  if (!data) return null;
  const rader = [[t("Blikk")].concat(data.kolonner.map(k => k.navn), [t("Totalt")])];
  for (const [navn, felt] of BLIKK_RADER)
    rader.push([t(navn)].concat(data.kolonner.map(k => tallEl(k[felt])), [tallEl(data.total[felt])]));
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
