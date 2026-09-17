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

// Fargene er Emils: gult beslag, blå hatprofil over skjøtene.
export const BLIKK_FARGE = { topp: "#f2c200", bunn: "#f2c200", hjorne: "#f2c200",
  ende: "#f2c200", utsparing: "#f2c200", skjot: "#1f78d1" };
// Profilmålene er PLASSHOLDERE til Emil måler opp de ekte (bilde 3, 17.09).
// De står som settbare felt nettopp fordi de skal byttes uten at noe annet
// røres.
export const STD_BLIKK = { blikkBreddeMm: 100, blikkTykkMm: 12, stangLengdeM: 2.5 };

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

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Ett stykke blikk mellom to punkter, med `nrm` som utover-retning. Boksen
// står med bredden PÅ TVERS av streken, i veggplanet, og tykkelsen utover.
export function strek(p1, p2, breddeM, tykkM, nrm, farge) {
  const d = new THREE.Vector3().subVectors(p2, p1);
  const len = d.length();
  if (!(len > 1e-6)) return null;
  const dir = d.clone().normalize();
  const n = nrm.clone().normalize();
  const up = new THREE.Vector3().crossVectors(n, dir).normalize();
  if (!isFinite(up.x) || up.lengthSq() < 1e-9) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: farge, side: THREE.DoubleSide }));
  m.scale.set(len, breddeM, tykkM);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, n));
  m.position.copy(p1).add(p2).multiplyScalar(0.5);
  return m;
}

// Punktet på veggens YTTERFLATE ved fasade-mm `tMm` og høyde `yMm` over
// SW-basen. `ut` dytter blikket litt utenpå elementet så det ikke z-fighter.
export function punktPaa(f, tMm, yMm, baseY, utS) {
  const tS = tilScene(tMm);
  return V3(f.px + f.nx * f.off + f.ex * tS + f.nx * utS,
            baseY + tilScene(yMm),
            f.pz + f.nz * f.off + f.ez * tS + f.nz * utS);
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
  const breddeM = tilScene(b.blikkBreddeMm), tykkM = tilScene(b.blikkTykkMm);
  const utS = tilScene(o.tykkelseMm) / 2 + tykkM / 2;
  const fasader = lagret.fasader || [];

  data.kolonner.forEach((kol, fi) => {
    const f = fasader[fi];
    if (!f) return;
    const vegg = data.vegger[fi];
    const nrm = V3(f.nx, 0, f.nz);
    const P = (tMm, yMm) => punktPaa(f, tMm, yMm, baseY, utS);
    for (const s of kol.stykker) {
      if (s.type === "hjorne" || s.type === "ende") continue;   // tegnes per hjørne
      if (s.type === "topp") {
        // følger taklinja: ett stykke per rett strekning, så gavlen får knekk
        const xs = [s.fraMm];
        for (const [x] of f.takLinje || []) if (x > s.fraMm + 1 && x < s.tilMm - 1) xs.push(x);
        xs.push(s.tilMm);
        for (let i = 1; i < xs.length; i++)
          legg(strek(P(xs[i - 1], toppY(f, xs[i - 1], vegg.toppMm)),
                     P(xs[i], toppY(f, xs[i], vegg.toppMm)), breddeM, tykkM, nrm, BLIKK_FARGE.topp));
      } else if (s.type === "bunn") {
        legg(strek(P(s.fraMm, 0), P(s.tilMm, 0), breddeM, tykkM, nrm, BLIKK_FARGE.bunn));
      } else if (s.type === "skjot") {
        for (const [y0, y1] of s.deler || [])
          legg(strek(P(s.tMm, y0), P(s.tMm, y1), breddeM, tykkM, nrm, BLIKK_FARGE.skjot));
      } else if (s.type === "utsparing" && s.fraMm !== undefined) {
        const { fraMm: a, tilMm: c, bunnMm: y0, toppMm: y1 } = s;
        legg(strek(P(a, y1), P(c, y1), breddeM, tykkM, nrm, BLIKK_FARGE.utsparing));  // topp
        legg(strek(P(a, y0), P(a, y1), breddeM, tykkM, nrm, BLIKK_FARGE.utsparing));  // venstre
        legg(strek(P(c, y0), P(c, y1), breddeM, tykkM, nrm, BLIKK_FARGE.utsparing));  // høyre
        // Dør og port har ingen bunn (3 sider) — vinduet har fire.
        if (utsparingSider(s.utspType) === 4)
          legg(strek(P(a, y0), P(c, y0), breddeM, tykkM, nrm, BLIKK_FARGE.utsparing));
      }
    }
  });

  // 📐 HJØRNENE: ETT L-beslag per hjørne, uansett hvem som bærer løpemeteren
  // i lista (Emil 17.09). På et rektangel blir det alltid fire — det var
  // nettopp dette som måtte rettes fra sjekklista 08.09.
  for (const h of data.hjorner || []) {
    for (const k of h.kanter) {
      const f = fasader[k.fasade];
      if (!f) return;
      const vegg = data.vegger[k.fasade];
      if (!vegg) continue;
      const nrm = V3(f.nx, 0, f.nz);
      const tEnde = k.ende === "start" ? vegg.t0Mm : vegg.t1Mm;
      // beinet legges INNOVER langs fasaden fra hjørnet, en halv profilbredde,
      // så de to beina møtes i hjørnet i stedet for å krysse hverandre
      const inn = k.ende === "start" ? b.blikkBreddeMm / 2 : -b.blikkBreddeMm / 2;
      const P = (yMm) => punktPaa(f, tEnde + inn, yMm, baseY, utS);
      legg(strek(P(h.bunnMm), P(h.toppMm), breddeM, tykkM, nrm,
        BLIKK_FARGE[h.type === "hjorne" ? "hjorne" : "ende"]));
    }
  }

  function legg(m) { if (m) { m.userData.blikk = true; swGroup.add(m); } }
}

// ───────────────────────── panelet ─────────────────────────

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
    felt3("blikkBredde", "Profilbredde (mm)", b.blikkBreddeMm) +
    felt3("blikkTykk", "Profiltykkelse (mm)", b.blikkTykkMm) +
    felt3("blikkStang", "Stanglengde (m)", b.stangLengdeM);
}

function felt3(id, tekst, verdi) {
  return "<label class='swfelt'><span>" + esc(t(tekst)) + "</span>" +
    "<input id='" + id + "' type='number' step='any' value='" + esc(String(verdi)) + "'></label>";
}

export function tegnBlikkPanel() {
  const body = $("blikkBody");
  if (!body) return;
  body.innerHTML = blikkPanelHtml();
  const les = () => {
    settBlikkOppsett({
      blikkBreddeMm: Number($("blikkBredde").value) || STD_BLIKK.blikkBreddeMm,
      blikkTykkMm: Number($("blikkTykk").value) || STD_BLIKK.blikkTykkMm,
      stangLengdeM: Number($("blikkStang").value) || STD_BLIKK.stangLengdeM
    });
    tegnAlt();
    tegnBlikkPanel();
  };
  for (const id of ["blikkBredde", "blikkTykk", "blikkStang"]) {
    const e = $(id);
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
