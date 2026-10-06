// 📏 KJEDEMÅL og 📐 VINKEL OG FALL — to nye måleverktøy (Emil 05.10).
//
// KJEDEMÅL («som i Revit», bilde 1–2 fra Emil): trykk flere punkter etter
// hverandre. Avstanden mellom hvert av dem står på én målelinje, med
// hjelpelinjer ned til punktene og skrå tverrstreker i hvert punkt. Når
// punktene er satt (Enter, dobbeltklikk eller «Ferdig»), følger målelinja
// musepekeren ut fra punktene — trykk der du vil ha den. Et ferdig kjedemål
// kan plukkes opp igjen: trykk på linja i Kjedemål-modus, flytt, trykk.
//   · Retningen er fra første til siste punkt. Med «Rett strek» på låses den
//     til nærmeste akse (X, høyde eller Z) — da er det et vanlig horisontalt
//     eller vertikalt kjedemål, som i en plantegning.
//   · Tallene er avstanden LANGS målelinja (projisert), slik Revit gjør det:
//     to punkter som ligger litt på skrå gir avstanden i målets retning.
//
// VINKEL OG FALL: to valg i kontrollinja.
//   · Vinkel: tre trykk — punkt, toppunkt, punkt. Viser vinkelen med en bue.
//   · Fall: to trykk. Under 45° står fallet i % og grader og høydeforskjellen
//     (takfall, fall på gulv). Brattere enn 45° er det et LODD-avvik: mm per
//     meter og grader fra loddrett (søyler, vegger).
//
// Alt legges i measureGroup, så «Tøm mål» og ↩ Angre virker som for Mål.
// Lappene meldes inn til lapp-kollisjonen (scene.js), så de ikke legger seg
// oppå hverandre — men de skjules aldri: et mål skal alltid kunne leses.
import * as THREE from "three";
import { $, S, fmtLen, tilM } from "./state.js";
import { t } from "./i18n.js";
import { camera, canvas, frameHooks, makeLabel, measureGroup, meldLapp, renderer } from "./scene.js";

const FARGE = 0xf59e0b, FARGE_TEKST = "#f59e0b";
const FARGE_VINKEL = 0x22d3ee, FARGE_VINKEL_TEKST = "#22d3ee";
const LAPP_MIN_PX = 16;   // under dette kan ikke tallet leses — da får de heller ligge litt over hverandre

// ═══════════════════════ REN GEOMETRI (testes) ═══════════════════════
// Retningen et kjedemål måler langs: første → siste punkt, eller nærmeste
// akse når «Rett strek» er på. Vektorene er {x,y,z}, så testene slipper three.
export function kjedeRetning(punkter, rett) {
  if (!punkter || punkter.length < 2) return null;
  const a = punkter[0], b = punkter[punkter.length - 1];
  let d = [b.x - a.x, b.y - a.y, b.z - a.z];
  if (rett) {
    const m = d.map(Math.abs), i = m.indexOf(Math.max(...m));
    const fortegn = d[i] >= 0 ? 1 : -1;
    d = [0, 0, 0]; d[i] = fortegn;
  }
  const L = Math.hypot(d[0], d[1], d[2]);
  if (!(L > 0)) return null;
  return { x: d[0] / L, y: d[1] / L, z: d[2] / L };
}

// Posisjonen til hvert punkt langs retningen (fra første punkt), sortert, og
// stykkene mellom dem. Punkter som faller oppå hverandre i målets retning
// (likt t) gir et stykke på 0 — de slås sammen, ellers står «0 mm» i målet.
export function kjedeStykker(punkter, d) {
  const p0 = punkter[0];
  const ts = punkter.map(p => (p.x - p0.x) * d.x + (p.y - p0.y) * d.y + (p.z - p0.z) * d.z);
  const sortert = ts.map((v, i) => ({ t: v, i })).sort((a, b) => a.t - b.t);
  const ut = [sortert[0]];
  for (const s of sortert.slice(1)) if (s.t - ut[ut.length - 1].t > 1e-9) ut.push(s);
  const stykker = [];
  for (let k = 0; k + 1 < ut.length; k++) stykker.push({ fra: ut[k].t, til: ut[k + 1].t, lengde: ut[k + 1].t - ut[k].t });
  return { ts, sortert: ut, stykker, sum: ut.length ? ut[ut.length - 1].t - ut[0].t : 0 };
}

// Vinkelen ved toppunktet B mellom BA og BC, i grader (0–180).
export function vinkelGrader(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  if (!(lu > 0) || !(lv > 0)) return null;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)));
  return Math.acos(cos) * 180 / Math.PI;
}

// Fall mellom to punkter (y er høyde). Svarer med høydeforskjell og vannrett
// avstand (modellenheter), vinkelen mot vannrett, fallet i %, og — for bratte
// linjer — avviket fra loddrett i mm per meter.
export function fallMellom(a, b) {
  const dh = Math.abs(b.y - a.y);
  const horis = Math.hypot(b.x - a.x, b.z - a.z);
  if (!(dh > 0) && !(horis > 0)) return null;
  const grader = Math.atan2(dh, horis) * 180 / Math.PI;
  return {
    dh, horis, grader,
    prosent: horis > 0 ? dh / horis * 100 : Infinity,
    lodd: grader > 45,
    loddMmPerM: dh > 0 ? horis / dh * 1000 : Infinity,
    loddGrader: 90 - grader
  };
}

const tall = (v, d) => v.toFixed(d).replace(".", ",");
export function fallTekst(f, lengdeTekst) {
  if (!f) return "";
  if (f.lodd) return t("Lodd: {0} mm/m · {1}°", tall(f.loddMmPerM, 1), tall(f.loddGrader, 2));
  return t("Fall {0} % · {1}° · Δh {2}", tall(f.prosent, 2), tall(f.grader, 2), lengdeTekst);
}

// ═══════════════════════ HJELPERE FOR TEGNINGEN ═══════════════════════
const V = (p) => new THREE.Vector3(p.x, p.y, p.z);
function linje(a, b, farge, stiplet) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = stiplet
    ? new THREE.LineDashedMaterial({ color: farge, depthTest: false, dashSize: 1, gapSize: 1 })
    : new THREE.LineBasicMaterial({ color: farge, depthTest: false });
  const l = new THREE.Line(g, m);
  if (stiplet) { l.computeLineDistances(); l.userData.stiplet = true; }
  l.renderOrder = 997;
  return l;
}
function prikk(p, farge) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: farge, depthTest: false }));
  dot.renderOrder = 997;
  dot.position.copy(p);
  dot.userData.px = 7;
  return dot;
}
function lapp(tekst, farge, pos, px) {
  const l = makeLabel(tekst, farge);
  l.userData.px = px || 24;
  l.userData.aspect = l.scale.x / l.scale.y;
  l.position.copy(pos);
  l.userData.maalLapp = true;
  return l;
}
// Skrå tverrstrek (45°, som i Revit) med fast størrelse på skjermen
function tverrstrek(p, d, o, farge) {
  const r = d.clone().add(o).normalize().multiplyScalar(0.5);
  const g = new THREE.BufferGeometry().setFromPoints([r.clone().negate(), r]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: farge, depthTest: false }));
  l.position.copy(p);
  l.userData.px = 14;           // updateScreenScaled skalerer den (scale = s/2)
  l.renderOrder = 998;
  return l;
}

// En lapp som skal stå et stykke UT fra punktet sitt, målt i skjermpiksler
// (så luften er den samme uansett zoom). Retningen er en verdensretning
// (kjedemål: ut fra linja) eller null = rett opp på skjermen.
const _fV = new THREE.Vector3(), _fU = new THREE.Vector3();
export function settForskyvning(sprite, base, retning, px) {
  sprite.userData.forskyv = { base: base.clone(), dir: retning ? retning.clone().normalize() : null, px };
}
export function forskyvLapper(gruppe) {
  if (!gruppe.children.length) return;
  const h = renderer.domElement.clientHeight || 1;
  const k = 2 * Math.tan(camera.fov * Math.PI / 360) / h;   // sceneenheter per px per avstand
  gruppe.traverse(o => {
    const f = o.userData && o.userData.forskyv;
    if (!f) return;
    o.parent.localToWorld(_fV.copy(f.base));
    const d = _fV.distanceTo(camera.position) || 1e-9;
    const enh = f.px * d * k;
    if (f.dir) _fU.copy(f.dir); else _fU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    o.position.copy(f.base).addScaledVector(_fU, enh);
  });
}

// Alle lappene i gruppa (også de vanlige Mål-lappene) melder seg til
// lapp-kollisjonen — de krymper når de står tett, men skjules ikke.
export function meldMaalLapper(gruppe, prio) {
  gruppe.traverse(o => { if (o.isSprite && o.visible && o.userData.px) meldLapp(o, prio || 0, LAPP_MIN_PX, false); });
}

// ═══════════════════════ KJEDEMÅLET I 3D ═══════════════════════
// Bygger gruppa på nytt fra { punkter, rett, o } — billig, og da er det bare
// én kode for «under plassering» og «ferdig».
function byggKjede(k) {
  const g = new THREE.Group();
  g.userData.kjede = k;
  const pts = k.punkter.map(V);
  const dd = kjedeRetning(k.punkter, k.rett);
  if (!dd) { pts.forEach(p => g.add(prikk(p, FARGE))); return g; }
  const d = V(dd);
  const o = k.o ? V(k.o) : new THREE.Vector3();
  const r = kjedeStykker(k.punkter, dd);
  const p0 = pts[0];
  const paaLinja = (tt) => p0.clone().addScaledVector(d, tt).add(o);
  const ut = o.lengthSq() > 1e-12 ? o.clone().normalize() : ortogonal(d);
  const fra = paaLinja(r.sortert[0].t), til = paaLinja(r.sortert[r.sortert.length - 1].t);
  g.add(linje(fra, til, FARGE));
  // hjelpelinjer og tverrstreker
  const ol = o.length();
  for (const s of r.sortert) {
    const p = pts[s.i], q = paaLinja(s.t);
    if (ol > 1e-9) {
      const over = q.clone().addScaledVector(ut, Math.min(ol * 0.08, ol));
      g.add(linje(p, over, FARGE));
    }
    g.add(tverrstrek(q, d, ut, FARGE));
    g.add(prikk(p, FARGE));
  }
  // tallene, litt ut fra linja (skjermpiksler)
  for (const st of r.stykker) {
    const midt = paaLinja((st.fra + st.til) / 2);
    const l = lapp(fmtLen(tilM(st.lengde)), FARGE_TEKST, midt, 22);
    l.userData.meter = tilM(st.lengde);
    settForskyvning(l, midt, ut, 14);
    g.add(l);
  }
  g.userData.linje = [fra, til];
  return g;
}
function ortogonal(d) {
  const a = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return a.sub(d.clone().multiplyScalar(a.dot(d))).normalize();
}

// Hvor langt ut målelinja skal stå, ut fra musepekeren: strålen gjennom
// pekeren treffer planet som inneholder målretningen og vender mest mot
// kameraet. Forskyvningen er den delen av treffpunktet som står på tvers av
// retningen — langs retningen flyttes ingenting.
const _ndc = new THREE.Vector2(), _ray = new THREE.Raycaster(), _pl = new THREE.Plane(), _hit = new THREE.Vector3();
function forskyvningFraPeker(k, cx, cy) {
  const dd = kjedeRetning(k.punkter, k.rett);
  if (!dd) return null;
  const d = V(dd), p0 = V(k.punkter[0]);
  const blikk = camera.getWorldDirection(new THREE.Vector3());
  let n;
  // Et vannrett mål sett ovenfra (planvisning, eller skrått ned på bygget)
  // legges ut i det VANNRETTE planet, som i en plantegning — ellers ville
  // linja vippet opp mot kameraet. Ser du mer fra siden, følger planet blikket.
  if (Math.abs(d.y) < 0.1 && Math.abs(blikk.y) > 0.3) n = new THREE.Vector3(0, 1, 0);
  else {
    n = blikk.clone().sub(d.clone().multiplyScalar(blikk.dot(d)));
    if (n.lengthSq() < 1e-9) return null;
    n.normalize();
  }
  _pl.setFromNormalAndCoplanarPoint(n, p0);
  const r = canvas.getBoundingClientRect();
  _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  if (!_ray.ray.intersectPlane(_pl, _hit)) return null;
  const v = _hit.clone().sub(p0);
  v.sub(d.clone().multiplyScalar(v.dot(d)));
  return { x: v.x, y: v.y, z: v.z };
}

// ═══════════════════════ TILSTAND ═══════════════════════
let kjede = null;      // { punkter, rett, o, gruppe, fase: "punkter" | "plasser", flyttet? }
let vinkel = null;     // { slag: "vinkel" | "fall", punkter, prikker: [] }
S.vinkelSlag = S.vinkelSlag || "vinkel";

function angrePost(tekst, angre, gjen) { if (S.pushAngre) S.pushAngre({ tekst, angre, gjenopprett: gjen }); }

function tegnKjedeKladd() {
  if (!kjede) return;
  if (kjede.gruppe) measureGroup.remove(kjede.gruppe);
  kjede.gruppe = byggKjede(kjede);
  kjede.gruppe.userData.kladd = true;
  measureGroup.add(kjede.gruppe);
  oppdaterLinje();
}

export function avbrytMaalVerktoy() {
  if (kjede) {
    if (kjede.gruppe) measureGroup.remove(kjede.gruppe);
    // Var det et ferdig mål som ble plukket opp, står det der det sto
    if (kjede.flyttet) measureGroup.add(kjede.flyttet.gruppe);
    kjede = null;
  }
  if (vinkel) { vinkel.prikker.forEach(p => measureGroup.remove(p)); vinkel = null; }
  oppdaterLinje();
}
S.avbrytMaalVerktoy = avbrytMaalVerktoy;

function kjedeFerdigPunkter() {
  if (!kjede || kjede.fase !== "punkter") return;
  if (kjede.punkter.length < 2) { avbrytMaalVerktoy(); return; }
  kjede.fase = "plasser";
  tegnKjedeKladd();
}

function plasserKjede() {
  const k = kjede;
  kjede = null;
  measureGroup.remove(k.gruppe);
  const ny = byggKjede({ punkter: k.punkter, rett: k.rett, o: k.o });
  measureGroup.add(ny);
  if (k.flyttet) {
    const gml = k.flyttet.gruppe;
    angrePost("Flytt kjedemål", () => { measureGroup.remove(ny); measureGroup.add(gml); },
      () => { measureGroup.remove(gml); measureGroup.add(ny); });
  } else {
    angrePost("Kjedemål", () => measureGroup.remove(ny), () => measureGroup.add(ny));
  }
  oppdaterLinje();
}

// Et ferdig kjedemål under pekeren? Avstand på skjermen til målelinja.
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function kjedeUnder(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const tilPx = (p, ut) => { ut.copy(p).project(camera); return [(ut.x + 1) / 2 * r.width + r.left, (1 - ut.y) / 2 * r.height + r.top, ut.z]; };
  let best = null, bestD = 10;
  for (const g of measureGroup.children) {
    const k = g.userData && g.userData.kjede;
    if (!k || g.userData.kladd || !g.userData.linje) continue;
    const [a, b] = g.userData.linje;
    const pa = tilPx(a, _a), pb = tilPx(b, _b);
    if (pa[2] > 1 || pb[2] > 1) continue;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L2 = dx * dx + dy * dy;
    const s = L2 > 0 ? Math.max(0, Math.min(1, ((cx - pa[0]) * dx + (cy - pa[1]) * dy) / L2)) : 0;
    const dist = Math.hypot(cx - (pa[0] + s * dx), cy - (pa[1] + s * dy));
    if (dist < bestD) { bestD = dist; best = g; }
  }
  return best;
}

// main.js / lett-main.js: et trykk i Kjedemål- eller Vinkel-modus. `punkt`
// er ferdig snappet (eller null når trykket ikke traff noe). Svarer true når
// trykket er brukt opp — da gjør main.js ingenting mer med det.
S.maalVerktoyKlikk = (cx, cy, punkt) => {
  if (S.mode === "kjede") {
    if (kjede && kjede.fase === "plasser") { plasserKjede(); return true; }
    if (!kjede) {
      const g = kjedeUnder(cx, cy);
      if (g) {
        // plukk opp et ferdig kjedemål og flytt det
        measureGroup.remove(g);
        const k = g.userData.kjede;
        kjede = { punkter: k.punkter.slice(), rett: k.rett, o: k.o, fase: "plasser", flyttet: { gruppe: g } };
        tegnKjedeKladd();
        return true;
      }
    }
    if (!punkt) return true;
    if (!kjede) kjede = { punkter: [], rett: !!S.rettOn, o: null, fase: "punkter" };
    kjede.rett = !!S.rettOn;
    const p = { x: punkt.x, y: punkt.y, z: punkt.z };
    const siste = kjede.punkter[kjede.punkter.length - 1];
    // dobbeltklikket gir samme punkt to ganger — det andre telles ikke
    if (siste && Math.hypot(p.x - siste.x, p.y - siste.y, p.z - siste.z) < 1e-9) return true;
    kjede.punkter.push(p);
    tegnKjedeKladd();
    return true;
  }
  if (S.mode === "vinkel") {
    if (!punkt) return true;
    if (!vinkel || vinkel.slag !== S.vinkelSlag) { avbrytMaalVerktoy(); vinkel = { slag: S.vinkelSlag, punkter: [], prikker: [] }; }
    const pv = punkt.clone ? punkt.clone() : V(punkt);
    vinkel.punkter.push(pv);
    const dot = prikk(pv, FARGE_VINKEL); dot.userData.temp = true;
    measureGroup.add(dot); vinkel.prikker.push(dot);
    const trengs = vinkel.slag === "fall" ? 2 : 3;
    if (vinkel.punkter.length >= trengs) {
      const v = vinkel; vinkel = null;
      v.prikker.forEach(p => measureGroup.remove(p));
      const g = v.slag === "fall" ? byggFall(v.punkter[0], v.punkter[1]) : byggVinkel(v.punkter[0], v.punkter[1], v.punkter[2]);
      if (g) {
        measureGroup.add(g);
        angrePost(v.slag === "fall" ? "Fall" : "Vinkel", () => measureGroup.remove(g), () => measureGroup.add(g));
      }
    }
    oppdaterLinje();
    return true;
  }
  return false;
};

// ═══════════════════════ VINKEL OG FALL I 3D ═══════════════════════
function byggVinkel(a, b, c) {
  const gr = vinkelGrader(a, b, c);
  if (gr == null) return null;
  const g = new THREE.Group();
  g.userData.vinkel = { grader: gr };
  g.add(linje(b, a, FARGE_VINKEL), linje(b, c, FARGE_VINKEL), prikk(a, FARGE_VINKEL), prikk(b, FARGE_VINKEL), prikk(c, FARGE_VINKEL));
  const u = a.clone().sub(b), w = c.clone().sub(b);
  const rad = Math.min(u.length(), w.length()) * 0.3;
  u.normalize(); w.normalize();
  // buen i planet til de to linjene: slerp mellom retningene
  const q = new THREE.Quaternion().setFromUnitVectors(u, w);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const qi = new THREE.Quaternion().slerp(q, i / 24);
    pts.push(b.clone().add(u.clone().applyQuaternion(qi).multiplyScalar(rad)));
  }
  const bue = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: FARGE_VINKEL, depthTest: false }));
  bue.renderOrder = 997;
  g.add(bue);
  let halv = u.clone().add(w);
  if (halv.lengthSq() < 1e-9) halv = ortogonal(u);
  halv.normalize();
  const pos = b.clone().addScaledVector(halv, rad * 1.5);
  g.add(lapp(tall(gr, 1) + "°", FARGE_VINKEL_TEKST, pos, 24));
  return g;
}

function byggFall(a, b) {
  const f = fallMellom(a, b);
  if (!f) return null;
  const lav = a.y <= b.y ? a : b, hoy = lav === a ? b : a;
  const g = new THREE.Group();
  g.userData.fall = f;
  g.add(linje(a, b, FARGE_VINKEL), prikk(a, FARGE_VINKEL), prikk(b, FARGE_VINKEL));
  // trekanten: vannrett fra det lave punktet, loddrett opp til det høye
  const hj = new THREE.Vector3(hoy.x, lav.y, hoy.z);
  if (f.horis > 0 && f.dh > 0) {
    const s1 = linje(lav, hj, FARGE_VINKEL, true), s2 = linje(hj, hoy, FARGE_VINKEL, true);
    const enh = Math.max(f.horis, f.dh) / 40;
    s1.material.dashSize = s1.material.gapSize = s2.material.dashSize = s2.material.gapSize = enh;
    g.add(s1, s2);
  }
  const midt = a.clone().add(b).multiplyScalar(0.5);
  const l = lapp(fallTekst(f, fmtLen(tilM(f.dh))), FARGE_VINKEL_TEKST, midt, 22);
  settForskyvning(l, midt, null, 18);
  g.add(l);
  return g;
}

// ═══════════════════════ PEKER, TASTER, KONTROLLINJE ═══════════════════════
window.addEventListener("pointermove", (e) => {
  if (S.mode !== "kjede" || !kjede || kjede.fase !== "plasser" || e.target !== canvas) return;
  const o = forskyvningFraPeker(kjede, e.clientX, e.clientY);
  if (!o) return;
  kjede.o = o;
  tegnKjedeKladd();
});

window.addEventListener("dblclick", (e) => {
  if (S.mode === "kjede" && kjede && kjede.fase === "punkter" && e.target === canvas) { e.preventDefault(); kjedeFerdigPunkter(); }
});

// Fangstfasen: Enter/Esc/Backspace gjelder målet som tegnes, FØR ui.js tar
// Esc som «slå av modusen».
window.addEventListener("keydown", (e) => {
  if (S.mode !== "kjede" && S.mode !== "vinkel") return;
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (e.key === "Enter" && kjede && kjede.fase === "punkter") { e.preventDefault(); e.stopImmediatePropagation(); kjedeFerdigPunkter(); return; }
  if (e.key === "Escape" && (kjede || vinkel)) { e.preventDefault(); e.stopImmediatePropagation(); avbrytMaalVerktoy(); return; }
  if (e.key === "Backspace" && kjede && kjede.fase === "punkter" && kjede.punkter.length) {
    e.preventDefault(); e.stopImmediatePropagation();
    kjede.punkter.pop();
    if (!kjede.punkter.length) avbrytMaalVerktoy(); else tegnKjedeKladd();
  }
}, true);

// Teksten i kontrollinja følger det som skjer
function linjeTekst() {
  if (S.mode === "kjede") {
    if (!kjede) return t("Trykk på punktene i rekkefølge. Trykk på et ferdig kjedemål for å flytte det.");
    if (kjede.fase === "plasser") return t("Flytt musa for å legge målelinja ut, og trykk der den skal stå.");
    const dd = kjedeRetning(kjede.punkter, kjede.rett);
    const sum = dd ? kjedeStykker(kjede.punkter, dd).sum : 0;
    return t("{0} punkter · totalt {1} — Enter eller dobbeltklikk når du er ferdig", kjede.punkter.length, fmtLen(tilM(sum)));
  }
  if (S.mode === "vinkel") {
    const n = vinkel ? vinkel.punkter.length : 0;
    if (S.vinkelSlag === "fall") return n ? t("Trykk på det andre punktet") : t("Trykk på to punkter: fall og lodd");
    return [t("Trykk på første punkt"), t("Trykk på toppunktet (der vinkelen er)"), t("Trykk på siste punkt")][Math.min(n, 2)];
  }
  return "";
}
function oppdaterLinje() { const l = $("mbMvTekst"); if (l) l.textContent = linjeTekst(); }

function felles(bar, ekstra) {
  bar.innerHTML = '<span class="lbl" id="mbMvTekst"></span>' + ekstra +
    '<button id="mbSnap" title="' + t("Fest til nærmeste hjørne/kant") + '">' + t("Snap") + '</button>' +
    '<button id="mbClear">' + t("Tøm mål") + '</button>';
  $("mbSnap").classList.toggle("active", S.snapOn);
  $("mbSnap").onclick = () => { S.snapOn = !S.snapOn; $("mbSnap").classList.toggle("active", S.snapOn); if (S.syncPrefs) S.syncPrefs(); };
  $("mbClear").onclick = () => {
    avbrytMaalVerktoy();
    const barn = measureGroup.children.slice();
    measureGroup.clear();
    S.measureFirst = null;
    if (barn.length) angrePost("Tøm mål", () => barn.forEach(o => measureGroup.add(o)), () => barn.forEach(o => measureGroup.remove(o)));
  };
  oppdaterLinje();
  bar.classList.add("open");
}

S.kjedeModeBar = (bar) => {
  felles(bar, '<button id="mbKjedeFerdig">' + t("Ferdig") + '</button>' +
    '<button id="mbRett" title="' + t("Lås målet til rett linje langs nærmeste akse (vannrett eller loddrett)") + '">' + t("Rett strek") + '</button>');
  $("mbRett").classList.toggle("active", !!S.rettOn);
  $("mbRett").onclick = () => {
    S.rettOn = !S.rettOn; $("mbRett").classList.toggle("active", S.rettOn);
    if (kjede) { kjede.rett = S.rettOn; tegnKjedeKladd(); }
  };
  $("mbKjedeFerdig").onclick = () => { if (kjede && kjede.fase === "punkter") kjedeFerdigPunkter(); };
};

S.vinkelModeBar = (bar) => {
  felles(bar, '<button id="mbVinkel">' + t("Vinkel") + '</button><button id="mbFall">' + t("Fall og lodd") + '</button>');
  const merk = () => { $("mbVinkel").classList.toggle("active", S.vinkelSlag !== "fall"); $("mbFall").classList.toggle("active", S.vinkelSlag === "fall"); };
  merk();
  $("mbVinkel").onclick = () => { S.vinkelSlag = "vinkel"; avbrytMaalVerktoy(); merk(); oppdaterLinje(); };
  $("mbFall").onclick = () => { S.vinkelSlag = "fall"; avbrytMaalVerktoy(); merk(); oppdaterLinje(); };
};

// Hver ramme: lappene som skal stå ut fra linja flyttes på plass (skjermpiksler),
// og alle målelappene meldes til lapp-kollisjonen.
frameHooks.push(() => {
  forskyvLapper(measureGroup);
  meldMaalLapper(measureGroup, 0);
});
