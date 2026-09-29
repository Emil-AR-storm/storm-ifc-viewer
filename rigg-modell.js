// 🏕 Rigg — 3D-MODELLENE. Bygger hvert rigg-objekt av enkle former, i METER,
// med origo midt på bunnen, lengden langs x og bredden langs z. Kalleren
// (rigg-vis.js) skalerer gruppa til modellens enhet.
//
// HVORFOR EGEN FIL (28.09.2026). Byggingen trenger bare three og mål — ikke
// scenen, panelet eller DOM-en. Da kan testen bygge hvert objekt med den
// EKTE three.js og telle mesher og trekanter (telefonene på byggeplassen er
// svake), og rigg-vis.js blir en fil om plassering og lag, ikke om vinduer.
//
// UTSEENDET (Emil 28.09: stil C «realistisk», valgt fra tre prøvebilder):
//   · fasede kanter på kassene (ExtrudeGeometry med bevel — RoundedBox finnes
//     ikke i vendor), så de ikke ser ut som klosser
//   · vinduer med karm og midtpost, dører med håndtak, panelfuger, takkant
//   · flate detaljer LIGGER på flaten og vinner med polygonOffset, i stedet for
//     å stå 1–3 cm utenpå — det var det som flimret på avstand
//   · alt ligger INNENFOR L × B × H: riggplanen, fotavtrykket og plasseringen
//     på terrenget bygger på de målene (handoffen, advarsel 2)
//   · til slutt slås meshene med samme materiale sammen til ÉN mesh
//     (slaaSammen): en brakkerigg på 30 biter blir 6–8 tegnekall
// `enkel` (byggeplass-siden, Emil 28.09): samme form og farger, men uten
// småbitene (fuger, karmer, håndtak) — raskere på svake telefoner.
import * as THREE from "three";
import { P_PLASS_B, P_PLASS_D, RIGG_TYPER, gjerdeStykker, parkeringsPlasser } from "./rigg-regn.js";

const matCache = new Map();
// `detalj`: flaten ligger oppå en annen flate og skal vinne dybdetesten.
// `lys`: skiltflater (førstehjelpskorset, ID-kortet) er ULYSTE, så det hvite
// er hvitt fra alle kanter — som et refleksskilt. Med vanlig lys ble korset
// grått på skyggesiden og vanskelig å lese (prøvebildene 28.09).
function mat(farge, detalj, lys) {
  const key = farge + (detalj ? "|d" : "") + (lys ? "|l" : "");
  let m = matCache.get(key);
  if (!m) {
    const o = { color: farge };
    if (detalj) Object.assign(o, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m = lys ? new THREE.MeshBasicMaterial(o) : new THREE.MeshLambertMaterial(o);
    matCache.set(key, m);
  }
  return m;
}

// Mørkere/lysere utgave av en farge, til kanter, vinduer og detaljer.
export function toneFarge(hex, f) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const k = (v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  const r = k((n >> 16) & 255), g = k((n >> 8) & 255), b = k(n & 255);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

const MORK = "#1f2a33";    // glass og dørskiller
const HVIT = "#ffffff";
const KARM = "#e9ecef";    // vinduskarm og midtpost
const DOR = "#3f4a53";
const STAAL = "#8e979e";

// En fasert boks med YTRE mål nøyaktig l × h × b og senter i origo: rektangelet
// krympes med r og bevel legger r tilbake på alle sider. seg = 1 gir en skrå
// fas, 2–3 en avrundet kant.
function fasGeo(l, h, b, r, seg) {
  r = Math.min(r, l / 2 - 1e-3, h / 2 - 1e-3, b / 2 - 1e-3);
  if (!(r > 0.002) || !THREE.ExtrudeGeometry) return new THREE.BoxGeometry(l, h, b);
  const x = l / 2 - r, y = h / 2 - r, s = new THREE.Shape();
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.lineTo(-x, -y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: b - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelOffset: 0, bevelSegments: seg || 1, curveSegments: 1 });
  geo.translate(0, 0, -(b - 2 * r) / 2);
  return geo;
}

// En boks med SENTER i (x, y, z). o.r gir fasede kanter.
function boks(g, l, h, b, farge, x, y, z, o) {
  const geo = o && o.r ? fasGeo(l, h, b, o.r, o.seg) : new THREE.BoxGeometry(l, h, b);
  const m = new THREE.Mesh(geo, mat(farge, o && o.detalj));
  m.position.set(x || 0, y || 0, z || 0);
  g.add(m);
  return m;
}

function sylinder(g, r, h, farge, x, y, z, akse, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 16), mat(farge));
  m.position.set(x || 0, y || 0, z || 0);
  if (akse === "z") m.rotation.x = Math.PI / 2;
  if (akse === "x") m.rotation.z = Math.PI / 2;
  g.add(m);
  return m;
}

// En flat detalj (vindu, dør, skilt) som LIGGER på en flate. `n` er hvilken
// vei flaten vender: "x", "-x", "z", "-z" eller "y" (opp).
function flat(g, bredde, hoyde, farge, x, y, z, n, lys) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(bredde, hoyde), mat(farge, true, lys));
  m.position.set(x, y, z);
  if (n === "x") m.rotation.y = Math.PI / 2;
  if (n === "-x") m.rotation.y = -Math.PI / 2;
  if (n === "-z") m.rotation.y = Math.PI;
  if (n === "y") m.rotation.x = -Math.PI / 2;
  g.add(m);
  return m;
}
// Et lite løft ut fra flaten, i retning n — så to detaljer oppå hverandre
// (karm, glass, midtpost) ikke ligger i samme plan.
function ut(n, d) {
  return { x: n === "x" ? d : n === "-x" ? -d : 0, z: n === "z" ? d : n === "-z" ? -d : 0 };
}

// Vindu: karm, mørkt glass og midtpost. Senter (x, y, z) på flaten.
function vindu(g, b, h, x, y, z, n, enkel) {
  if (!enkel) flat(g, b + 0.1, h + 0.1, KARM, x, y, z, n);
  const u = ut(n, 0.001), u2 = ut(n, 0.002);
  flat(g, b, h, MORK, x + u.x, y, z + u.z, n);
  if (!enkel) flat(g, 0.03, h, KARM, x + u2.x, y, z + u2.z, n);
}

// Vinduer jevnt fordelt langs x, aldri helt i kanten.
function vinduRekke(g, L, x0, y, z, n, hoyde, enkel) {
  const nv = Math.max(1, Math.floor(L / 1.6)), del = L / nv;
  for (let i = 0; i < nv; i++) vindu(g, Math.min(1.0, del * 0.6), hoyde, x0 - L / 2 + del * (i + 0.5), y, z, n, enkel);
}

// Dør med håndtak. y0 = underkant. Håndtaket er 2 cm dypt: kalleren legger
// døra minst 2 cm innenfor ytterkanten, så ingenting stikker ut av L × B.
function dor(g, b, h, x, y0, z, n, farge, enkel) {
  flat(g, b, h, farge || DOR, x, y0 + h / 2, z, n);
  if (enkel) return;
  const u = ut(n, 0.01), sideX = n === "x" || n === "-x" ? 0 : b * 0.35, sideZ = sideX ? 0 : b * 0.35;
  boks(g, 0.02, 0.04, 0.02, "#c9ced3", x + u.x + sideX, y0 + h * 0.5, z + u.z + sideZ);
}

// Firmalogoen på langsiden (Emil 28.09): SAMME logo som rapportene — det
// originale bildet som er valgt i rapportmenyen (S.settings.rapLogo), lagt på
// som tekstur, aldri gjenskapt. Ikke valgt → ingen logo. `logo` er
// { data, b, h } fra tegninger.js (hentet av rigg.js); byggeplass-siden har
// den ikke, og viser ingen logo.
const logoCache = new Map();
function logoMat(logo) {
  let m = logoCache.get(logo.data);
  if (!m) {
    const tex = new THREE.TextureLoader().load(logo.data);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    logoCache.set(logo.data, m);
  }
  return m;
}
// Logoen i et felt (maksB × maksH) med senter (x, y, z): høyden eller bredden
// begrenser, forholdet er alltid originalens.
function leggLogo(g, logo, maksB, maksH, x, y, z, n) {
  if (!logo || !logo.data || !(logo.b > 0) || !(logo.h > 0)) return;
  const asp = logo.b / logo.h;
  let h = maksH, b = h * asp;
  if (b > maksB) { b = maksB; h = b / asp; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(b, h), logoMat(logo));
  const u = ut(n, 0.003);
  m.position.set(x + u.x, y, z + u.z);
  if (n === "-z") m.rotation.y = Math.PI;
  m.userData.egen = true;       // slås ikke sammen: eget materiale med tekstur
  m.userData.logo = true;
  g.add(m);
}

// En hvit «M» i et plan — laget av fire staver, ikke en tekstur, så den er
// skarp på alle avstander og ikke trenger canvas. Står i xy-planet med senter
// i origo; kalleren dreier den på plass.
function mBokstav(storrelse, farge) {
  const g = new THREE.Group();
  const s = storrelse, stav = s * 0.16, d = 0.02;
  boks(g, stav, s, d, farge, -s / 2 + stav / 2, 0, 0);
  boks(g, stav, s, d, farge, s / 2 - stav / 2, 0, 0);
  const diag = Math.hypot(s / 2 - stav, s * 0.55);
  const vinkel = Math.atan2(s / 2 - stav, s * 0.55);
  const v = boks(g, stav, diag, d, farge, -s / 4 + stav / 4, s / 2 - s * 0.275, 0.001);
  v.rotation.z = vinkel;
  const h = boks(g, stav, diag, d, farge, s / 4 - stav / 4, s / 2 - s * 0.275, 0.001);
  h.rotation.z = -vinkel;
  return g;
}


// Det vanlige førstehjelpsskiltet: HVITT kors på GRØNT (ISO 7010 E003).
// IKKE Røde Kors-merket (rødt kors på hvitt) — det er beskyttet og skal ikke
// brukes som skilt (handoffen, advarsel 3). Skiltet er en tynn plate; korset
// ligger på begge sidene av den.
function forstehjelpKors(g, side, gronn, y, z, enkel) {
  boks(g, side, side, 0.03, gronn, 0, y, z, { r: enkel ? 0 : 0.008 });
  for (const s of [1, -1]) {
    const zf = z + s * 0.0151, n = s > 0 ? "z" : "-z";
    flat(g, side * 0.6, side * 0.2, HVIT, 0, y, zf, n, true);
    flat(g, side * 0.2, side * 0.6, HVIT, 0, y, zf, n, true);
  }
}

// Et GENERISK ID-kort (ikke HMS-kortets egen logo — den skal ikke kopieres):
// hvitt kort med en farget stripe, et «bilde» og to tekstlinjer. Ligger på
// flaten z (s = 1 foran, -1 bak).
function idKort(g, bredde, y, z, s, stripe, enkel) {
  const h = bredde * 0.63, n = s > 0 ? "z" : "-z", z2 = z + s * 0.001;
  flat(g, bredde, h, HVIT, 0, y, z, n, true);
  flat(g, bredde, h * 0.22, stripe, 0, y + h * 0.39, z2, n);
  flat(g, bredde * 0.28, h * 0.46, "#90a4ae", -s * bredde * 0.28, y - h * 0.08, z2, n);
  if (enkel) return;
  flat(g, bredde * 0.42, h * 0.08, "#90a4ae", s * bredde * 0.14, y, z2, n);
  flat(g, bredde * 0.34, h * 0.08, "#90a4ae", s * bredde * 0.10, y - h * 0.2, z2, n);
}

// Takkant: en ring av fire lister rundt toppen (topp = overkanten). Kassen
// under er litt lavere, så taket inni ringen er kassens egen farge — da
// kjenner man igjen brakka ovenfra (riggplanen) på fargen i tegnforklaringen.
function takRing(g, L, B, topp, farge, x, z) {
  const h = 0.12, b = 0.08, y = topp - h / 2;
  boks(g, L, h, b, farge, x, y, z + B / 2 - b / 2);
  boks(g, L, h, b, farge, x, y, z - B / 2 + b / 2);
  boks(g, b, h, B - 2 * b, farge, x + L / 2 - b / 2, y, z);
  boks(g, b, h, B - 2 * b, farge, x - L / 2 + b / 2, y, z);
}

const BYGG = {
  // Brakkerigg: moduler side om side (langs bredden) og 1–3 i høyden.
  // Kassen er 2 cm inne fra L på hver gavl og 1 cm fra B: der ligger dørene
  // og håndtakene, så ingenting stikker ut av L × B.
  brakke(g, o, _h, opts) {
    const { L, B, H } = o, n = o.moduler || 1, e = o.etasjer || 1, enkel = !!opts.enkel;
    const kant = toneFarge(o.farge, 0.72), ramme = toneFarge(o.farge, 0.6), bredTot = n * B;
    const Li = L - 0.04, zYtre = bredTot / 2 - 0.01;
    for (let et = 0; et < e; et++) {
      const y0 = et * H;
      for (let m = 0; m < n; m++) {
        const z = -bredTot / 2 + B * (m + 0.5);
        boks(g, Li, H - 0.012, B - 0.02, o.farge, 0, y0 + (H - 0.012) / 2, z, { r: enkel ? 0.03 : 0.06, seg: enkel ? 1 : 2 });
        takRing(g, L, B - 0.01, y0 + H, kant, 0, z);
        boks(g, L, 0.14, B - 0.01, ramme, 0, y0 + 0.07, z);          // bunnramme
        // dør på gavlen, én per modul
        dor(g, 0.9, Math.min(2.0, H * 0.78), Li / 2 + 0.001, y0 + 0.18, z + B * 0.2, "x", DOR, enkel);
      }
      // vinduer på begge langsidene av hele riggen
      vinduRekke(g, Li, 0, y0 + H * 0.58, zYtre + 0.001, "z", H * 0.3, enkel);
      vinduRekke(g, Li, 0, y0 + H * 0.58, -zYtre - 0.001, "-z", H * 0.3, enkel);
      // sandwichpanel-fugene langs langsidene
      if (!enkel) {
        const nf = Math.round(Li / 1.2);
        for (let i = 1; i < nf; i++) for (const s of [1, -1])
          flat(g, 0.02, H - 0.3, toneFarge(o.farge, 0.8), -Li / 2 + Li * i / nf, y0 + H / 2, s * (zYtre + 0.0005), s > 0 ? "z" : "-z");
      }
    }
    // logoen i feltet mellom vinduene og takkanten, øverste etasje, begge sider
    const yTopp = (e - 1) * H, fraY = yTopp + H * 0.75 + 0.04, tilY = yTopp + H - 0.16;
    for (const s of [1, -1]) leggLogo(g, opts.logo, Li * 0.45, tilY - fraY, 0, (fraY + tilY) / 2, s * (zYtre + 0.001), s > 0 ? "z" : "-z");
  },

  // Hjulbrakke: kassen på en aksel med to hjul (felg og hjulskjerm), og
  // draget foran. Kassen er 2 cm inne på langsidene: der ligger døra.
  hjulbrakke(g, o, _h, opts) {
    const { L, B, H } = o, enkel = !!opts.enkel, bunn = Math.min(0.7, H * 0.3), kant = toneFarge(o.farge, 0.7);
    const Bi = B - 0.04, kh = H - bunn;
    boks(g, L, kh, Bi, o.farge, 0, bunn + kh / 2, 0, { r: enkel ? 0.04 : 0.08, seg: enkel ? 1 : 3 });
    boks(g, L * 0.9, 0.14, B * 0.8, "#37474f", 0, bunn - 0.07, 0);     // chassis
    const r = Math.min(0.35, bunn * 0.5);
    for (const s of [-1, 1]) {
      const z = s * (B / 2 - 0.16);
      sylinder(g, r, 0.22, "#222222", -L * 0.1, r, z, "z", 24);
      sylinder(g, r * 0.55, 0.23, "#b0b7bd", -L * 0.1, r, z, "z", 16);     // felgen
      if (!enkel) boks(g, r * 2.6, 0.04, 0.3, kant, -L * 0.1, r * 2 + 0.05, z);   // hjulskjermen
    }
    // draget: to stag som møtes foran, og støttehjulet
    const dl = 1.3, vinkel = Math.atan2(B * 0.35, dl);
    for (const s of [-1, 1]) {
      const st = boks(g, Math.hypot(dl, B * 0.35), 0.08, 0.08, "#37474f", L / 2 + dl / 2, bunn - 0.1, s * B * 0.175);
      st.rotation.y = s * vinkel;
    }
    sylinder(g, 0.08, bunn - 0.1, "#222222", L / 2 + dl, (bunn - 0.1) / 2, 0);
    vinduRekke(g, L * 0.8, 0, bunn + kh * 0.62, Bi / 2 + 0.001, "z", kh * 0.3, enkel);
    dor(g, 0.8, kh * 0.8, L * 0.3, bunn + 0.05, -Bi / 2 - 0.001, "-z", DOR, enkel);
    leggLogo(g, opts.logo, L * 0.4, kh * 0.32, -L * 0.15, bunn + kh * 0.55, -Bi / 2 - 0.001, "-z");
  },

  // Toalett: kasse med dør på gavlen, lyst tak-lokk med utstikk (utstikket
  // ER ytre mål — kassen er 2 cm inne), opptatt/ledig-merke og lufterist bak.
  toalett(g, o, _h, opts) {
    const { L, B, H } = o, enkel = !!opts.enkel, tak = 0.12, Li = L - 0.04, Bi = B - 0.04;
    boks(g, Li, H - tak, Bi, o.farge, 0, (H - tak) / 2, 0, { r: 0.03, seg: enkel ? 1 : 2 });
    boks(g, L, tak, B, toneFarge(o.farge, 1.6), 0, H - tak / 2, 0, { r: 0.04 });
    dor(g, Bi * 0.72, (H - tak) * 0.86, Li / 2 + 0.001, 0.08, 0, "x", toneFarge(o.farge, 1.25), enkel);
    if (!enkel) {
      flat(g, 0.14, 0.05, "#d32f2f", Li / 2 + 0.002, (H - tak) * 0.62, Bi * 0.26, "x");     // opptatt/ledig
      flat(g, Bi * 0.4, 0.18, toneFarge(o.farge, 0.6), -Li / 2 - 0.001, H - tak - 0.2, 0, "-x");   // lufterist
    }
  },

  // Førstehjelp: stolpe med skilt (hvitt kors på grønt), skap med skiltet på.
  forstehjelp(g, o, _h, opts) {
    const { L, B, H } = o, enkel = !!opts.enkel, side = Math.min(L, 0.8);
    boks(g, 0.08, H, 0.08, "#9e9e9e", 0, H / 2, -B / 2 + 0.04);
    boks(g, L, 0.04, B, "#9e9e9e", 0, 0.02, 0);                          // fotplate
    forstehjelpKors(g, side, o.farge, H - side / 2 - 0.05, -B / 2 + 0.1, enkel);
    // skapet med båre og utstyr, korset på døra
    const skapD = B * 0.8, skapZ = 0.02, front = skapZ + skapD / 2 + 0.001;
    boks(g, L * 0.8, 0.7, skapD, toneFarge(o.farge, 1.2), 0, 1.0, skapZ, { r: 0.02 });
    flat(g, L * 0.24, L * 0.08, HVIT, 0, 1.0, front, "z", true);
    flat(g, L * 0.08, L * 0.24, HVIT, 0, 1.0, front, "z", true);
  },

  // Møteområde: blå boks med hvit M på alle sider og på toppen.
  mote(g, o) {
    const { L, B, H } = o;
    boks(g, L, H, B, o.farge, 0, H / 2, 0);
    const s = Math.min(L, B, H) * 0.6;
    const topp = mBokstav(s, HVIT); topp.rotation.x = -Math.PI / 2; topp.position.set(0, H + 0.011, 0); g.add(topp);
    const fram = mBokstav(s, HVIT); fram.position.set(0, H / 2, B / 2 + 0.011); g.add(fram);
    const bak = mBokstav(s, HVIT); bak.rotation.y = Math.PI; bak.position.set(0, H / 2, -B / 2 - 0.011); g.add(bak);
    const sv = mBokstav(s, HVIT); sv.rotation.y = Math.PI / 2; sv.position.set(L / 2 + 0.011, H / 2, 0); g.add(sv);
    const sh = mBokstav(s, HVIT); sh.rotation.y = -Math.PI / 2; sh.position.set(-L / 2 - 0.011, H / 2, 0); g.add(sh);
  },

  // Strømskap: skap på fot, dørskille, varseltrekant (gul med svart kant,
  // som ISO 7010 W012 — laget av geometri, ikke et bilde) og stikkontaktene.
  strom(g, o, _h, opts) {
    const { L, B, H } = o, enkel = !!opts.enkel, fot = Math.min(0.35, H * 0.25), topp = 0.04;
    boks(g, L * 0.7, fot, B * 0.7, "#546e7a", 0, fot / 2, 0);
    // skapet er 1,5 cm inne på sidene: der sitter stikkontaktene, så de
    // verken stikker ut av L eller ligger i samme plan som skapet (flimmer)
    const Li = L - 0.03;
    boks(g, Li, H - fot - topp, B - 0.02, o.farge, 0, fot + (H - fot - topp) / 2, 0, { r: 0.02 });
    boks(g, L, topp, B, toneFarge(o.farge, 0.7), 0, H - topp / 2, 0);
    const front = (B - 0.02) / 2 + 0.001;
    flat(g, 0.012, (H - fot) * 0.85, MORK, 0, fot + (H - fot) / 2, front, "z");
    const s = L * 0.28, y = fot + (H - fot) * 0.66, x = -L * 0.22;
    const trekant = (sk, farge, dz) => {
      const f = new THREE.Shape();
      f.moveTo(-sk / 2, 0); f.lineTo(sk / 2, 0); f.lineTo(0, sk * 0.87); f.lineTo(-sk / 2, 0);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(f), mat(farge, true));
      m.position.set(x, y - sk * 0.29, front + dz);
      g.add(m);
    };
    trekant(s, "#111111", 0);
    trekant(s * 0.78, "#fdd835", 0.001);
    const nk = enkel ? 1 : 3;
    for (let i = 0; i < nk; i++) boks(g, 0.02, 0.08, 0.08, "#263238", Li / 2 + 0.005, fot + 0.2 + i * 0.14, 0);
  },

  // 20 fots container: korrugerte sider, hjørnestolper og dører på gavlen.
  container(g, o) {
    const { L, B, H } = o, kant = toneFarge(o.farge, 0.7);
    boks(g, L - 0.02, H - 0.02, B - 0.02, o.farge, 0, H / 2, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1])
      boks(g, 0.16, H, 0.16, kant, x * (L / 2 - 0.08), H / 2, z * (B / 2 - 0.08));
    boks(g, L, 0.12, B, kant, 0, H - 0.06, 0);
    boks(g, L, 0.12, B, kant, 0, 0.06, 0);
    // bølgene i sideveggene
    const n = Math.max(4, Math.round(L / 0.3));
    for (let i = 1; i < n; i++) {
      const x = -L / 2 + (L / n) * i;
      boks(g, 0.06, H - 0.3, 0.03, kant, x, H / 2, B / 2 + 0.01);
      boks(g, 0.06, H - 0.3, 0.03, kant, x, H / 2, -B / 2 - 0.01);
    }
    // dørene: skillet på midten og fire låsestenger
    boks(g, 0.03, H - 0.3, 0.02, MORK, -L / 2 - 0.01, H / 2, 0);
    for (const z of [-0.35, -0.15, 0.15, 0.35]) boks(g, 0.04, H - 0.4, 0.04, "#9e9e9e", -L / 2 - 0.03, H / 2, z * B);
  },

  // HMS-kort-registrering: terminal på fot, med et generisk kort-ikon på
  // begge sider og leseren under.
  hms(g, o, _h, opts) {
    const { L, B, H } = o, enkel = !!opts.enkel, fot = Math.min(0.4, H * 0.3);
    boks(g, 0.12, fot, 0.12, "#78909c", 0, fot / 2, 0);
    boks(g, L, 0.04, B, "#78909c", 0, 0.02, 0);
    boks(g, L, H - fot, B - 0.004, o.farge, 0, fot + (H - fot) / 2, 0, { r: 0.03 });
    const kortB = Math.min(L * 0.7, 0.5), y = fot + (H - fot) * 0.62, zf = (B - 0.004) / 2 + 0.001;
    idKort(g, kortB, y, zf, 1, "#1f5fbf", enkel);
    idKort(g, kortB, y, -zf, -1, "#1f5fbf", enkel);
    flat(g, L * 0.4, 0.08, "#26c6da", 0, fot + (H - fot) * 0.25, zf, "z");     // leseren
  },

  // 🚧 Byggegjerde: nettingpanel i stålrør mellom hver skjøt, fot og klemme
  // i skjøten (Emils bilder 2 og 3). For lange paneler er RØDE (varsel), valgte
  // er GRØNNE (som på skissen), porter er gule med skråstag.
  gjerde(g, o, hoyder, opts) {
    const gm = opts && opts.mark, H = o.H, mark = gm && gm.id === o.id ? gm.stykker : null;
    const hv = (k) => (hoyder && hoyder[k]) || 0;
    for (const st of gjerdeStykker(o)) {
      const farge = mark && mark.has(st.i) ? "#2e7d32" : st.forLang ? "#e53935" : st.port ? "#f2b705" : o.farge;
      const dx = st.b.x - st.a.x, dz = st.b.z - st.a.z, l = Math.max(0.05, st.l);
      const panel = new THREE.Group();
      panel.position.set((st.a.x + st.b.x) / 2, (hv(st.i) + hv(st.j)) / 2, (st.a.z + st.b.z) / 2);
      panel.rotation.y = Math.atan2(-dz, dx);
      const rammer = [
        boks(panel, l, 0.045, 0.045, farge, 0, H - 0.02, 0),
        boks(panel, l, 0.045, 0.045, farge, 0, 0.12, 0),
        boks(panel, 0.045, H - 0.1, 0.045, farge, -l / 2 + 0.03, H / 2 + 0.05, 0),
        boks(panel, 0.045, H - 0.1, 0.045, farge, l / 2 - 0.03, H / 2 + 0.05, 0)
      ];
      const netting = new THREE.Mesh(new THREE.BoxGeometry(l, H - 0.16, 0.01), nettingMat(farge));
      netting.position.set(0, H / 2 + 0.05, 0);
      panel.add(netting);
      rammer.push(netting);
      if (st.port) {
        // skråstaget som gjør porten til en port, og en midtstolpe (to fløyer)
        const diag = Math.hypot(l / 2, H - 0.2);
        for (const side of [-1, 1]) {
          const d = boks(panel, 0.04, diag, 0.04, farge, side * l / 4, H / 2 + 0.05, 0);
          d.rotation.z = side * Math.atan2(l / 2, H - 0.2);
          rammer.push(d);
        }
        rammer.push(boks(panel, 0.05, H - 0.1, 0.05, farge, 0, H / 2 + 0.05, 0));
      }
      for (const m of rammer) m.userData.stykke = st.i;
      g.add(panel);
    }
    // føttene og klemmene, én per skjøt
    o.punkter.forEach((q, k) => {
      const fot = boks(g, o.B, 0.15, 0.22, "#9e9e9e", q.x, hv(k) + 0.075, q.z);
      const neste = o.punkter[(k + 1) % o.punkter.length];
      fot.rotation.y = Math.atan2(-(neste.z - q.z), neste.x - q.x);
      boks(g, 0.08, 0.12, 0.08, "#37474f", q.x, hv(k) + H * 0.55, q.z);
    });
  },

  // ➜ Piler for trafikkflyt: et flatt bånd på bakken med pilhode i enden.
  // Kjøretøy er heltrukket, gående stiplet — de skal kunne skilles også uten
  // farge (utskrift av riggplanen i svart-hvitt).
  pilKjoretoy(g, o, hoyder) { byggPil(g, o, hoyder); },
  pilGaende(g, o, hoyder) { byggPil(g, o, hoyder); },

  // 🅿 Parkeringsområde: asfalt, hvite oppmerkingsstreker mellom plassene og
  // et blått P-skilt i hjørnet. Plassene regnes ut av målene
  // (parkeringsPlasser i rigg-regn.js) — to rader med kjørebane i midten når
  // området er dypt nok.
  parkering(g, o) {
    const { L, B, H } = o, asfalt = 0.04, loft = asfalt + 0.006;
    boks(g, L, asfalt, B, o.farge, 0, asfalt / 2, 0);
    const pl = parkeringsPlasser(L, B);
    const start = -L / 2 + (L - pl.perRad * P_PLASS_B) / 2;
    const radZ = pl.rader === 2 ? [-B / 2 + P_PLASS_D / 2, B / 2 - P_PLASS_D / 2] : pl.rader === 1 ? [-B / 2 + P_PLASS_D / 2] : [];
    for (const z of radZ) {
      for (let i = 0; i <= pl.perRad; i++)
        boks(g, 0.12, 0.012, P_PLASS_D - 0.2, HVIT, start + i * P_PLASS_B, loft, z);
      // bakkant av raden
      boks(g, pl.perRad * P_PLASS_B, 0.012, 0.12, HVIT, start + pl.perRad * P_PLASS_B / 2, loft, z < 0 ? -B / 2 + 0.15 : B / 2 - 0.15);
    }
    // P-skiltet: stolpe og blått skilt med hvit P (fire staver, ingen tekstur)
    const sx = L / 2 - 0.5, sz = -B / 2 + 0.5, side = 0.6, topp = Math.max(1.2, H);
    boks(g, 0.08, topp, 0.08, "#9e9e9e", sx, topp / 2, sz);
    for (const r of [1, -1]) {
      const zf = sz + r * 0.03;
      boks(g, side, side, 0.02, "#1f5fbf", sx, topp - side / 2, sz);
      const y0 = topp - side / 2, st = side * 0.13, hs = side * 0.62;
      boks(g, st, hs, 0.01, HVIT, sx - side * 0.15, y0, zf + r * 0.006);                     // stammen
      boks(g, side * 0.32, st, 0.01, HVIT, sx - side * 0.02, y0 + hs / 2 - st / 2, zf + r * 0.006);   // toppen av bøyen
      boks(g, side * 0.32, st, 0.01, HVIT, sx - side * 0.02, y0 + st / 2 - hs * 0.02, zf + r * 0.006); // bunnen av bøyen
      boks(g, st, hs * 0.45, 0.01, HVIT, sx + side * 0.13, y0 + hs * 0.24, zf + r * 0.006);   // bøyens høyre side
    }
  },

  // 🟦 Lagringsområde: flate på bakken i objektets farge, med en kant i en
  // mørkere utgave av samme farge (Emil 25.09: lys blå inni, mørkeblå kant).
  lagring(g, o) {
    const { L, B } = o, tykk = 0.03, kant = Math.min(0.3, Math.min(L, B) * 0.06);
    const mork = toneFarge(o.farge, 0.45);
    boks(g, L - 2 * kant, tykk, B - 2 * kant, o.farge, 0, tykk / 2, 0);
    boks(g, L, tykk + 0.01, kant, mork, 0, (tykk + 0.01) / 2, -B / 2 + kant / 2);
    boks(g, L, tykk + 0.01, kant, mork, 0, (tykk + 0.01) / 2, B / 2 - kant / 2);
    boks(g, kant, tykk + 0.01, B - 2 * kant, mork, -L / 2 + kant / 2, (tykk + 0.01) / 2, 0);
    boks(g, kant, tykk + 0.01, B - 2 * kant, mork, L / 2 - kant / 2, (tykk + 0.01) / 2, 0);
  },

  // Søppelcontainer (liftcontainer, åpen): skrå gavler, åpen topp, løfteører.
  soppel(g, o) {
    const { L, B, H } = o, t = 0.05, inn = Math.min(0.5, L * 0.15);
    const bunnL = L - 2 * inn, kant = toneFarge(o.farge, 0.7);
    boks(g, bunnL, t, B, o.farge, 0, t / 2, 0);                            // bunn
    // langsidene som trapeser
    const form = new THREE.Shape();
    form.moveTo(-bunnL / 2, 0); form.lineTo(bunnL / 2, 0); form.lineTo(L / 2, H); form.lineTo(-L / 2, H); form.lineTo(-bunnL / 2, 0);
    for (const s of [-1, 1]) {
      const vegg = new THREE.Mesh(new THREE.ExtrudeGeometry(form, { depth: t, bevelEnabled: false }), mat(o.farge));
      vegg.position.set(0, 0, s > 0 ? B / 2 - t : -B / 2);
      g.add(vegg);
    }
    // skrå gavler
    const skraa = Math.hypot(inn, H), vinkel = Math.atan2(inn, H);
    for (const s of [-1, 1]) {
      const gavl = boks(g, t, skraa, B, o.farge, s * (bunnL / 2 + inn / 2), H / 2, 0);
      gavl.rotation.z = -s * vinkel;
    }
    // kantlist rundt åpningen og løfteørene
    boks(g, L, 0.08, 0.08, kant, 0, H - 0.04, B / 2 - 0.04);
    boks(g, L, 0.08, 0.08, kant, 0, H - 0.04, -B / 2 + 0.04);
    for (const s of [-1, 1]) sylinder(g, 0.06, B + 0.3, "#37474f", s * (bunnL / 2 + inn * 0.6), H * 0.62, 0, "z");
  }
};

// Pilens mål: tykkelse, hodets lengde og bredde (i forhold til båndet) og
// stiplene for gående. Løftet litt over bakken så båndet ikke flimrer i
// terrenget (z-fighting).
const PIL_TYKK = 0.06, PIL_LOFT = 0.08, PIL_STIPPEL = 1.0, PIL_MELLOM = 0.6;
function byggPil(g, o, hoyder) {
  const B = o.B, hodeL = Math.max(1.5, B * 2.5), hodeB = B * 2.8;
  const st = gjerdeStykker(o);
  const stiplet = !!(RIGG_TYPER[o.type] && RIGG_TYPER[o.type].stiplet);
  const hv = (k) => (hoyder && hoyder[k]) || 0;
  st.forEach((s, n) => {
    const siste = n === st.length - 1;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
    const l = s.l;
    if (l < 1e-6) return;
    const ux = dx / l, uz = dz / l;
    // siste stykke kortes inn med hodet, så spissen står nøyaktig i sluttpunktet
    const brukL = siste ? Math.max(0, l - hodeL) : l;
    const vinkel = Math.atan2(-dz, dx);
    const y0 = hv(s.i), y1 = hv(s.j);
    const bit = (fra, til) => {
      const m = (fra + til) / 2, len = til - fra;
      if (len <= 1e-3) return;
      const b = boks(g, len, PIL_TYKK, B, o.farge, s.a.x + ux * m, y0 + (y1 - y0) * (m / l) + PIL_LOFT, s.a.z + uz * m);
      b.rotation.y = vinkel;
      b.userData.stykke = s.i;
    };
    if (stiplet) {
      for (let t = 0; t < brukL; t += PIL_STIPPEL + PIL_MELLOM) bit(t, Math.min(brukL, t + PIL_STIPPEL));
    } else bit(0, brukL);
    // rund skjøt mellom to stykker, så knekken ikke får et hakk
    if (!siste && !stiplet) {
      const r = sylinder(g, B / 2, PIL_TYKK, o.farge, s.b.x, y1 + PIL_LOFT, s.b.z);
      r.userData.stykke = s.i;
    }
    if (siste) {
      const form = new THREE.Shape();
      form.moveTo(0, -hodeB / 2); form.lineTo(hodeL, 0); form.lineTo(0, hodeB / 2); form.lineTo(0, -hodeB / 2);
      const hode = new THREE.Mesh(new THREE.ExtrudeGeometry(form, { depth: PIL_TYKK, bevelEnabled: false }), mat(o.farge));
      // Formen ligger i xy; lagt ned i xz med spissen langs stykket
      const holder = new THREE.Group();
      hode.rotation.x = -Math.PI / 2;
      hode.position.y = -PIL_TYKK / 2;
      holder.add(hode);
      holder.position.set(s.a.x + ux * brukL, y1 + PIL_LOFT, s.a.z + uz * brukL);
      holder.rotation.y = vinkel;
      hode.userData.stykke = s.i;
      g.add(holder);
    }
  });
}

// Nettingen er halvgjennomsiktig: gjerdet skal ikke skjule det som står bak.
const nettCache = new Map();
function nettingMat(farge) {
  let m = nettCache.get(farge);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: farge, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    nettCache.set(farge, m);
  }
  return m;
}

// ═══════════════════════ SAMMENSLÅING ═══════════════════════
// Alle meshene med samme materiale blir ÉN mesh. En brakkerigg på 3 × 2
// moduler er ellers over hundre tegnekall — på en svak telefon med ti objekter
// merkes det. Geometrien legges i gruppas eget rom (meter), så skaleringen
// til modellens enhet fortsatt gjøres av gruppa. Logoen (tekstur) og alt som
// er merket `egen` står for seg. Går noe galt, står bitene som de var.
function slaaSammen(g) {
  try {
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const grupper = new Map();
    g.traverse(c => {
      if (!c.isMesh || c.userData.egen || !c.material || !c.geometry || !c.geometry.attributes || !c.geometry.attributes.position) return;
      if (!grupper.has(c.material)) grupper.set(c.material, []);
      grupper.get(c.material).push(c);
    });
    for (const [materiale, liste] of grupper) {
      if (liste.length < 2) continue;
      const pos = [], nor = [];
      for (const c of liste) {
        let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        if (!geo.attributes.normal) geo.computeVertexNormals();
        pos.push(geo.attributes.position.array);
        nor.push(geo.attributes.normal.array);
        geo.dispose();
      }
      const slaa = (deler) => {
        const ut = new Float32Array(deler.reduce((a, d) => a + d.length, 0));
        let i = 0;
        for (const d of deler) { ut.set(d, i); i += d.length; }
        return ut;
      };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(slaa(pos), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(slaa(nor), 3));
      geo.computeBoundingSphere();
      for (const c of liste) { c.parent.remove(c); c.geometry.dispose(); }
      g.add(new THREE.Mesh(geo, materiale));
    }
    // Tomme grupper (mBokstav) etter sammenslåingen
    g.children.slice().forEach(c => { if (c.isGroup && !c.children.length) g.remove(c); });
  } catch (err) {
    console.warn("Rigg: sammenslåingen feilet, bitene står som de var:", err && err.message);
  }
}

// Bygger objektet `o` inn i gruppa `g`. opts: { enkel, logo, mark }
//   enkel — byggeplass-siden (uten småbitene)
//   logo  — { data, b, h }: firmalogoen på brakkene (ingen → ingen logo)
//   mark  — { id, stykker }: gjerdepanelene som er valgt til port
// Gjerdet og pilene slås IKKE sammen: bitene deres bærer `userData.stykke`,
// som rigg.js bruker til å finne panelet eller stykket man klikket på.
export function byggModell(g, o, hoyder, opts) {
  const f = BYGG[o.type];
  if (!f) return;
  f(g, o, hoyder, opts || {});
  if (!o.punkter) slaaSammen(g);
}

// Til testen: hvilke typer som har en byggefunksjon.
export const MODELL_TYPER = () => Object.keys(BYGG);
