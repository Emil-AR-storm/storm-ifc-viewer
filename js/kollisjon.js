// 💥 KOLLISJON — fanen i Lag-panelet (runde 6 / 9b, Emils valg A 29.10.2026;
// flyttet inn i Lag som egen fane, valg C samme dag).
//
// Hvert lag i Lag-panelet kontrolleres mot
// hovedmodellen med regelen som passer faget:
//   • Armering mot betong: armering UTENFOR betongen og (hvis kravet er
//     skrevet inn) for liten OVERDEKNING. Kravet kommer fra RIBs beskrivelse.
//   • Alt annet (stål, RIV, ARK): HARD kollisjon — går inn i betongen.
// Funnene gås gjennom ett og ett (◀ 1 av N ▶), kan godkjennes (oppstikk til
// neste støp), bli markering, BCF og Excel. Status (Ny / Godkjent / Løst)
// lagres i SharePoint «Kollisjoner/<modell>.kollisjoner.json»; et funn som
// ikke kommer igjen ved neste kjøring er LØST.
//
// Regningen bor i kollisjon-regn.js (ren, testet med kjente kasser).
import * as THREE from "three";
import { $, S, EKSTRA_LAG, esc } from "./state.js";
import { flyTil } from "./scene.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { _lagene as lagene, _tilstand as lagTilstand, tegn as tegnLag } from "./lag.js";
import { spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import * as K from "./kollisjon-regn.js";

export const KOLL_MAPPE = "Kollisjoner";
const TOL_M = 0.002;          // 2 mm: å ligge an mot er ikke en kollisjon
const MAKS_I_LISTA = 150;
const tilstand = {
  valgt: {},                  // lagId → true/false (med i kontrollen)
  overdekning: {},            // lagId → mm (tom = ikke kontrollert)
  jobber: "",                 // fremdriftstekst mens kontrollen går
  funn: null,                 // [{ id, art, … status }]
  filter: "ny",
  nr: 0,                      // gjeldende funn i navigasjonen
  lagret: [],                 // statusene fra SharePoint/maskinen
  fil: ""                     // hovedmodellen funnene hører til
};
export const _tilstand = tilstand;

const filNavn = () => String(S.fileName || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|#%]/g, "-") + ".kollisjoner.json";
const lokalNokkel = () => "storm.kollisjon." + (S.fileName || "");
const toM = () => S.enhetSkala || 1;
const mmTekst = (x) => K.mm(x, toM()).toLocaleString("no-NO") + " mm";

// ---------- Elementene ----------
async function hovedInfo() {
  const E = await import("./elements.js");
  await E.sikreMengder();   // sørger for navn/typer/materialer (sikreMeta)
  const { metaFor } = await import("./ifcrpc.js");
  return (id) => {
    if (S.glbActive) {
      const p = S.glbProps ? S.glbProps.get(id) : null;
      return p ? { navn: p[0] || "", objType: p[1] || "", type: p[2] || "", mat: p[3] || "", gid: p[4] || "" } : { navn: "", type: "", mat: "", gid: "" };
    }
    const m = metaFor(id) || {};
    return { navn: m.name || "", objType: m.objectType || "", type: m.typeName || "", mat: m.material || "", gid: m.globalId || "" };
  };
}
const lagInfo = (lag) => (id) => {
  const p = (lag.props && lag.props[id]) || [];
  return { navn: p[0] || "", objType: p[1] || "", type: p[2] || "", mat: p[3] || "", gid: p[4] || "" };
};
const artFor = (info, erArmering) => (erArmering ? "armering" : K.elementArt(info.navn, info.mat, info.type));

// Trekantene per element i verdenskoordinater. kilde: "hoved" | lag
async function trekanter(kilde, ider) {
  const per = new Map();
  const v = new THREE.Vector3();
  const legg = (id, x, y, z) => { let a = per.get(id); if (!a) { a = []; per.set(id, a); } a.push(x, y, z); };
  if (kilde === "hoved") {
    const E = await import("./elements.js");
    E.forHverTrekant(ider, (p, i0, i1, i2, mtx, id) => {
      for (const i of [i0, i1, i2]) { v.fromBufferAttribute(p, i); if (mtx) v.applyMatrix4(mtx); legg(id, v.x, v.y, v.z); }
    });
  } else {
    kilde.gruppe.updateMatrixWorld(true);
    for (const m of kilde.gruppe.children) {
      if (!m.isMesh || !m.userData.ranges || !m.geometry.getIndex()) continue;
      const p = m.geometry.getAttribute("position"), ix = m.geometry.getIndex();
      for (const r of m.userData.ranges) {
        if (!ider.has(r.id)) continue;
        for (let i = r.start; i < r.start + r.count; i++) { v.fromBufferAttribute(p, ix.getX(i)).applyMatrix4(m.matrixWorld); legg(r.id, v.x, v.y, v.z); }
      }
    }
  }
  return per;
}
// Hjørnene på stangas overflate, uten dubletter (0,5 mm rutenett)
function punkter(tri) {
  const sett = new Set(), ut = [], q = 0.0005 / toM();
  for (let i = 0; i < tri.length; i += 3) {
    const k = Math.round(tri[i] / q) + "," + Math.round(tri[i + 1] / q) + "," + Math.round(tri[i + 2] / q);
    if (sett.has(k)) continue;
    sett.add(k); ut.push(tri[i], tri[i + 1], tri[i + 2]);
  }
  return new Float32Array(ut);
}
async function alleHovedIder() {
  const E = await import("./elements.js");
  return new Set([...E.allElementBoxes().keys()]);
}

// ---------- Kontrollene som tilbys ----------
// Per lag: armering i laget → mot betongen i hovedmodellen. Armering i
// hovedmodellen og betong i laget → omvendt. Ellers hard kollisjon.
function kontroller() {
  return lagene.filter(l => l.gruppe).map(l => {
    const lagArm = Object.keys(l.tall || {}).length > 0;
    const art = lagArm || (l.fag === "RIB" && S.hovedHarArmering) ? "armering" : "hard";
    return { lag: l, art, retning: lagArm ? "lag" : (art === "armering" ? "hoved" : "") };
  });
}
function regelTekst(k) {
  if (k.art === "armering") {
    const od = Number(tilstand.overdekning[k.lag.id]) || 0;
    return t("Armering utenfor betongen") + (od ? " · " + t("overdekning under {0} mm", od) : "");
  }
  return t("Hard kollisjon (går inn i hverandre)");
}

// ---------- Kjør ----------
const pust = () => new Promise(r => setTimeout(r, 0));
function si(tekst) { tilstand.jobber = tekst; const e = $("kollJobb"); if (e) e.textContent = tekst; else tegn(); }

export async function kjor() {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return null; }
  let valgte = kontroller().filter(k => tilstand.valgt[k.lag.id] !== false);
  if (!valgte.length) { varsel(t("Legg til et lag (armering, stål …) i Lag-panelet først. Kollisjonen kontrollerer lagene mot hovedmodellen.")); return null; }
  tilstand.funn = null; si(t("Leser hovedmodellen …")); tegn();
  try {
    const hInfo = await hovedInfo();
    const hIder = await alleHovedIder();
    const hArt = new Map([...hIder].map(id => [id, artFor(hInfo(id), false)]));
    // Armering åpnet som HOVEDMODELL og betongen som lag: snu kontrollen
    S.hovedHarArmering = [...hArt.values()].includes("armering");
    valgte = kontroller().filter(k => tilstand.valgt[k.lag.id] !== false);
    const hTri = await trekanter("hoved", hIder);
    const tol = TOL_M / toM();
    const funn = [];
    let grove = 0;
    for (const k of valgte) {
      const lag = k.lag, li = lagInfo(lag);
      const lagIder = new Set(Object.keys(lag.props || {}).map(Number));
      si(t("Leser «{0}» …", lag.navn)); await pust();
      const lTri = await trekanter(lag, lagIder);
      const lArt = (id) => artFor(li(id), !!(lag.tall && lag.tall[id]));
      if (k.art === "armering") {
        // Betongen og stengene — hvem som er hva avhenger av retningen
        const betongFra = k.retning === "lag" ? [...hTri].filter(([id]) => hArt.get(id) === "betong") : [...lTri].filter(([id]) => lArt(id) === "betong");
        const stangFra = k.retning === "lag" ? [...lTri].filter(([id]) => lArt(id) === "armering") : [...hTri].filter(([id]) => hArt.get(id) === "armering");
        const betong = betongFra.map(([id, a]) => K.lagLegeme(id, new Float32Array(a)));
        if (!betong.length) { varsel(t("Fant ingen betong å kontrollere «{0}» mot.", lag.navn)); continue; }
        grove += betong.filter(l => l.grov).length;
        const nett = K.lagRutenett(betong, 1 / toM());
        const od = (Number(tilstand.overdekning[lag.id]) || 0) / 1000 / toM();
        const infoStang = k.retning === "lag" ? li : hInfo, infoBetong = k.retning === "lag" ? hInfo : li;
        for (let i = 0; i < stangFra.length; i += 15) {
          si(t("Kontrollerer armeringen i «{0}» … {1} %", lag.navn, Math.round(i / stangFra.length * 100))); await pust();
          const bit = stangFra.slice(i, i + 15).map(([id, a]) => ({ id, pts: punkter(a) }));
          for (const r of K.kontrollerArmering(bit, betong, { tol, overdekning: od, nett, sok: 1 / toM() })) {
            const s = infoStang(r.id), b = r.ved != null ? infoBetong(r.ved) : null;
            const tall = k.retning === "lag" ? lag.tall[r.id] : null;
            const navn = (tall && tall.d ? "Ø" + tall.d + (tall.form ? " " + tall.form.replace(/_RNO$/, "") : "") + " · " : "") + (s.navn || "#" + r.id);
            const felles = { lagId: lag.id, lagFil: lag.fil, lagNavn: lag.navn, retning: k.retning,
              a: { kilde: k.retning === "lag" ? "lag" : "hoved", id: r.id, navn, gid: s.gid } };
            if (r.ute_) funn.push(Object.assign({}, felles, { id: K.funnId("utenfor", lag.fil, s.gid || r.id), art: "utenfor",
              mm: K.mm(r.maksUte, toM()), andel: Math.round(r.ute / Math.max(1, r.total) * 100), punkt: r.punkt,
              b: b ? { kilde: k.retning === "lag" ? "hoved" : "lag", id: r.ved, navn: b.objType || b.navn, gid: b.gid } : null }));
            if (r.od_) { const b2 = infoBetong(r.ved2);
              funn.push(Object.assign({}, felles, { id: K.funnId("overdekning", lag.fil, s.gid || r.id), art: "overdekning",
                mm: K.mm(r.minOverdekning, toM()), krav: Number(tilstand.overdekning[lag.id]) || 0, punkt: r.overdekningPunkt,
                b: { kilde: k.retning === "lag" ? "hoved" : "lag", id: r.ved2, navn: b2.objType || b2.navn, gid: b2.gid } })); }
          }
        }
      } else {
        const A = [...lTri].filter(([id]) => !["isolasjon"].includes(lArt(id))).map(([id, a]) => K.lagLegeme(id, new Float32Array(a)));
        const B = [...hTri].filter(([id]) => !["isolasjon", "armering"].includes(hArt.get(id))).map(([id, a]) => K.lagLegeme(id, new Float32Array(a)));
        for (let i = 0; i < A.length; i += 10) {
          si(t("Kontrollerer «{0}» mot hovedmodellen … {1} %", lag.navn, Math.round(i / A.length * 100))); await pust();
          for (const r of K.kontrollerHard(A.slice(i, i + 10), B, { tol })) {
            const a = li(r.a), b = hInfo(r.b);
            funn.push({ id: K.funnId("hard", lag.fil, a.gid || r.a, b.gid || r.b), art: "hard", lagId: lag.id, lagFil: lag.fil, lagNavn: lag.navn,
              mm: K.mm(r.dybde, toM()), punkt: r.punkt,
              a: { kilde: "lag", id: r.a, navn: a.objType || a.navn || "#" + r.a, gid: a.gid }, b: { kilde: "hoved", id: r.b, navn: b.objType || b.navn || "#" + r.b, gid: b.gid } });
          }
        }
      }
    }
    funn.sort((x, y) => (x.art === "hard" ? 0 : 1) - (y.art === "hard" ? 0 : 1) || y.mm - x.mm);
    await hentStatus();
    const s = K.slaaSammen(funn, tilstand.lagret, valgte.map(k => k.lag.fil));
    tilstand.funn = s.funn.concat(s.nyLost.map(p => ({ id: p.id, art: p.id.split("|")[0], lagFil: p.id.split("|")[1], status: "lost", kommentar: p.kommentar, gammel: true })));
    tilstand.fil = S.fileName;
    tilstand.grove = grove;
    if (s.nyLost.length) lagreStatus(s.nyLost);
    tilstand.filter = "ny"; tilstand.nr = 0;
    const tl = K.telling(tilstand.funn);
    varsel(t("Kollisjonskontroll ferdig: {0} nye, {1} godkjent, {2} løst.", tl.ny, tl.godkjent, tl.lost));
    return tilstand.funn;
  } catch (err) {
    console.error(err);
    varsel(t("Kollisjonskontrollen stoppet: {0}", err.message));
    return null;
  } finally {
    tilstand.jobber = "";
    tegn();
  }
}

// ---------- Status (Ny / Godkjent / Løst) ----------
async function hentStatus() {
  let liste = [];
  try { liste = JSON.parse(localStorage.getItem(lokalNokkel()) || "[]") || []; } catch (_) {}
  if (spPaalogget()) {
    try { const r = await spLes(KOLL_MAPPE, filNavn()); if (r.status === "ok") liste = flettLokalt(liste, r.liste); } catch (_) {}
  }
  tilstand.lagret = liste.map(K.vaskStatus).filter(Boolean);
}
function flettLokalt(lokal, ekstern) {
  const m = new Map();
  for (const p of (ekstern || []).concat(lokal || [])) { const v = K.vaskStatus(p); if (!v) continue; const f = m.get(v.id); if (!f || v.endret > f.endret) m.set(v.id, v); }
  return [...m.values()];
}
function lagreStatus(poster) {
  const av = (S.innloggetNavn ? S.innloggetNavn() : "") || "";
  const nå = new Date().toISOString();
  const nye = poster.map(p => K.vaskStatus(Object.assign({}, p, { endret: nå, av })));
  const m = new Map(tilstand.lagret.map(p => [p.id, p]));
  for (const p of nye) m.set(p.id, p);
  tilstand.lagret = [...m.values()];
  try { localStorage.setItem(lokalNokkel(), JSON.stringify(tilstand.lagret)); } catch (_) {}
  if (spPaalogget()) spSkriv(KOLL_MAPPE, filNavn(), nye, (p) => String(p && p.id || "")).catch(() => {});
}
export function settStatus(f, status, kommentar) {
  if (!f) return;
  const foer = { status: f.status, kommentar: f.kommentar || "" };
  const bruk = (s, k) => { f.status = s; f.kommentar = k; lagreStatus([{ id: f.id, status: s, kommentar: k }]); tegn(); };
  bruk(status, kommentar == null ? foer.kommentar : kommentar);
  if (S.pushAngre) S.pushAngre({ tekst: status === "godkjent" ? t("Kollisjon godkjent") : t("Kollisjon satt til ny"),
    angre: () => bruk(foer.status, foer.kommentar), gjenopprett: () => bruk(status, kommentar == null ? foer.kommentar : kommentar) });
}

// ---------- Visning og navigasjon ----------
const synlige = () => (tilstand.funn || []).filter(f => tilstand.filter === "alle" || f.status === tilstand.filter);
function tittel(f) {
  if (!f.a) return f.id.split("|").slice(2).filter(Boolean).join(" · ") || t("Funn");
  return f.a.navn;
}
function undertekst(f) {
  if (f.gammel) return t("Ikke funnet ved siste kjøring — rettet i modellen");
  const mot = f.b ? f.b.navn : "";
  if (f.art === "utenfor") return t("{0} utenfor betongen ({1} % av stanga)", f.mm.toLocaleString("no-NO") + " mm", f.andel) + (mot ? " · " + t("ved {0}", mot) : "");
  if (f.art === "overdekning") return t("Overdekning {0} mm (krav {1} mm)", f.mm.toLocaleString("no-NO"), f.krav) + (mot ? " · " + mot : "");
  return t("Går inn i {0}", mot) + (f.mm > 0 ? " · " + t("minst {0} mm", f.mm.toLocaleString("no-NO")) : "");
}
const STATUS_TEKST = { ny: "Ny", godkjent: "Godkjent", lost: "Løst" };

export function gaaTil(nr) {
  const liste = synlige();
  if (!liste.length) return;
  tilstand.nr = ((nr % liste.length) + liste.length) % liste.length;
  const f = liste[tilstand.nr];
  tegn();
  if (!f.punkt) return;
  // Uthev elementet i laget (blått, som et klikk) og fly dit
  const lag = lagene.find(l => l.id === f.lagId);
  const kontr = lag ? EKSTRA_LAG.find(x => x.id === "lag:" + lag.id) : null;
  if (kontr && f.a && f.a.kilde === "lag") kontr.velg([f.a.id]);
  else if (kontr && f.b && f.b.kilde === "lag") kontr.velg([f.b.id]);
  const meter = 2.5 / toM();
  flyTil(new THREE.Vector3(f.punkt[0], f.punkt[1], f.punkt[2]), meter);
}

export async function lagMarkering(f) {
  if (!f || !f.punkt) return null;
  const M = await import("./markers.js");
  const c = M.vaskMarkering({ id: M.nyId(), text: t("Kollisjon") + ": " + tittel(f) + "\n" + undertekst(f) + (f.kommentar ? "\n" + f.kommentar : ""),
    author: M.innloggetNavn(), date: M.naaTekst(), status: "Åpen", x: f.punkt[0], y: f.punkt[1], z: f.punkt[2], globalId: (f.a && f.a.gid) || "" });
  if (!c) return null;
  M.leggTilImportertMarkering(c); M.lagreOgSynk();
  f.markering = c.id;
  if (S.pushAngre) S.pushAngre({ tekst: t("Markering fra kollisjon"), angre: () => { M.fjernImportertMarkering(c.id); M.lagreOgSynk(); f.markering = null; tegn(); },
    gjenopprett: () => { M.leggTilImportertMarkering(c); M.lagreOgSynk(); f.markering = c.id; tegn(); } });
  tegn();
  varsel(t("Markering laget: {0}", tittel(f)));
  return c;
}
export async function lastNedBcf() {
  const liste = synlige().filter(f => f.punkt);
  if (!liste.length) { varsel(t("Ingen funn å eksportere.")); return; }
  const B = await import("./bcf.js");
  const markeringer = liste.map((f, i) => ({ id: "kol-" + i + "-" + f.id, text: t("Kollisjon") + ": " + tittel(f) + "\n" + undertekst(f),
    author: (S.innloggetNavn ? S.innloggetNavn() : "") || "Storm", date: "", status: f.status === "lost" ? "Løst" : "Åpen",
    x: f.punkt[0], y: f.punkt[1], z: f.punkt[2], globalId: (f.a && f.a.gid) || "" }));
  const r = await B.eksporterBcf({ markeringer, modell: (S.fileName || "") + " kollisjoner", prosjekt: (S.prosjektInfo ? S.prosjektInfo().nummer : "") || "" });
  varsel(t("BCF lastet ned: {0} saker.", r.antall));
}
export async function lastNedExcel() {
  const E = await import("./elements.js");
  const rader = [[t("Status"), t("Kontroll"), t("Lag"), t("Element"), t("Mot"), t("Mål (mm)"), t("Andel av stanga (%)"), t("Kommentar"), "GlobalId", t("GlobalId (mot)")]];
  for (const f of synlige()) rader.push([t(STATUS_TEKST[f.status]), t(f.art === "hard" ? "Hard kollisjon" : f.art === "utenfor" ? "Utenfor betongen" : "Overdekning"),
    f.lagNavn || f.lagFil || "", tittel(f), f.b ? f.b.navn : "", f.mm != null ? f.mm : "", f.andel != null ? f.andel : "", f.kommentar || "",
    (f.a && f.a.gid) || "", (f.b && f.b.gid) || ""]);
  const base = String(S.fileName || "modell").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]/g, "-");
  await E.lastNedXlsx(base + " - kollisjoner.xlsx", t("Kollisjoner"), rader);
}

// ---------- Fanen «Kollisjon» i Lag-panelet (Emils valg C 29.10.2026) ----------
// Kollisjon virker bare med lag, så den bor i Lag-panelet som egen fane — og
// fanen finnes bare når minst ett lag er lagt til. lag.js tegner fanene og
// kaller S.kollisjonFyll(body) når fanen «Kollisjon» er valgt.
const fanenErApen = () => { const p = $("lagPanel"); return !!(p && p.classList.contains("open") && lagTilstand.fane === "kollisjon" && lagene.length); };
export function tegn() { tegnLag(); tegnNav(); }
S.kollisjonNye = () => (tilstand.funn && tilstand.fil === S.fileName ? K.telling(tilstand.funn).ny : null);
S.kollisjonNav = () => tegnNav();
S.kollisjonFyll = (body) => fyll(body);
function fyll(body) {
  if (!body) return;
  // Har hovedmodellen armering? (Armering åpnet som hovedmodell, betong som lag)
  if (S.hovedHarArmering == null && S.qtyCache && S.qtyCache.groups) S.hovedHarArmering = S.qtyCache.groups.some(([, g]) => /ReinforcingBar/i.test(String(g.type || "")));
  const ks = kontroller();
  let h = '<div class="koll-lbl">' + esc(t("KONTROLLER")) + '<span>' + esc(t("lagene mot {0}", S.fileName || t("hovedmodellen"))) + '</span></div>';
  if (!ks.length) h += '<p class="lag-tom">' + esc(t("Ingen lag å kontrollere. Legg til armering, stål eller en annen fagmodell i Lag-panelet først.")) + '</p>';
  for (const k of ks) {
    const med = tilstand.valgt[k.lag.id] !== false;
    h += '<label class="koll-rad"><input type="checkbox" data-koll-med="' + k.lag.id + '"' + (med ? " checked" : "") + '><span class="lag-prikk" style="background:' + esc(k.lag.farge) + '"></span>' +
      '<span class="koll-navn"><b>' + esc(k.lag.navn) + '</b><span>' + esc(regelTekst(k)) + '</span></span></label>';
    if (k.art === "armering") h += '<div class="koll-od"><span>' + esc(t("Krav til overdekning (fra RIB)")) + '</span><input type="text" inputmode="numeric" placeholder="' + esc(t("tom = av")) + '" data-koll-od="' + k.lag.id + '" value="' + esc(tilstand.overdekning[k.lag.id] || "") + '"> mm</div>';
  }
  const j = tilstand.jobber;
  h += '<div class="lag-knapper"><button class="primary" id="kollKjor"' + (j || !ks.length ? " disabled" : "") + '>▶ ' + esc(t("Kjør kontroll")) + '</button></div>';
  if (j) h += '<div class="koll-jobb" id="kollJobb">' + esc(j) + '</div>';
  if (tilstand.funn && tilstand.fil === S.fileName) {
    const tl = K.telling(tilstand.funn);
    h += '<div class="koll-lbl">' + esc(t("RESULTAT · {0} funn", tilstand.funn.length)) + '</div>';
    if (tilstand.grove) h += '<p class="lag-merk">' + esc(t("{0} betongelementer har ufullstendig geometri i IFC-fila og er kontrollert med boksen rundt (grovere, og uten overdekning).", tilstand.grove)) + '</p>';
    h += '<div class="koll-chips">' + [["ny", t("Ny"), tl.ny], ["godkjent", t("Godkjent"), tl.godkjent], ["lost", t("Løst"), tl.lost], ["alle", t("Alle"), tilstand.funn.length]]
      .map(([k, n, c]) => '<button data-koll-filter="' + k + '"' + (tilstand.filter === k ? ' class="active"' : "") + '>' + esc(n) + ' ' + c + '</button>').join("") + '</div>';
    const liste = synlige();
    if (!liste.length) h += '<p class="lag-tom">' + esc(tilstand.filter === "ny" ? t("Ingen nye funn. 👍") : t("Ingen funn her.")) + '</p>';
    h += liste.slice(0, MAKS_I_LISTA).map((f, i) => '<button class="koll-funn' + (i === tilstand.nr ? " aktiv" : "") + '" data-koll-nr="' + i + '">' +
      '<span class="koll-ft"><b>' + esc(tittel(f)) + '</b><i class="koll-st ' + f.status + '">' + esc(t(STATUS_TEKST[f.status])) + '</i></span>' +
      '<span class="koll-fu">' + esc(undertekst(f)) + (f.kommentar ? ' · «' + esc(f.kommentar) + '»' : "") + (f.markering ? ' · 📍' : "") + '</span></button>').join("");
    if (liste.length > MAKS_I_LISTA) h += '<p class="lag-merk">' + esc(t("… og {0} til (se Excel)", liste.length - MAKS_I_LISTA)) + '</p>';
    h += '<div class="lag-knapper"><button id="kollBcf"' + (liste.length ? "" : " disabled") + '>' + esc(t("BCF")) + '</button><button id="kollXlsx"' + (liste.length ? "" : " disabled") + '>' + esc(t("Excel")) + '</button></div>';
  }
  const boks = document.createElement("div");
  boks.className = "koll-fane";
  boks.id = "kollBody";
  boks.innerHTML = h;
  body.appendChild(boks);
  koble(boks);
}
function tegnNav() {
  let nav = $("kollNav");
  const liste = synlige();
  const vis = fanenErApen() && tilstand.funn && liste.length && tilstand.fil === S.fileName;
  if (!vis) { if (nav) nav.remove(); return; }
  if (!nav) { nav = document.createElement("div"); nav.id = "kollNav"; nav.className = "koll-nav"; document.body.appendChild(nav); }
  const f = liste[Math.min(tilstand.nr, liste.length - 1)];
  nav.innerHTML = '<button id="kollForr" title="' + esc(t("Forrige")) + '">◀</button><b>' + esc(t("{0} av {1}", tilstand.nr + 1, liste.length)) + '</b><button id="kollNeste" title="' + esc(t("Neste")) + '">▶</button>' +
    '<span class="koll-nt">' + esc(tittel(f)) + ' · ' + esc(undertekst(f)) + '</span>' +
    (f.gammel ? "" : f.status === "godkjent" ? '<button id="kollGodkjenn" data-status="ny">' + esc(t("Angre godkjenning")) + '</button>'
      : '<button id="kollGodkjenn" data-status="godkjent">' + esc(t("Godkjenn")) + '</button>') +
    (f.gammel || f.markering ? "" : '<button class="primary" id="kollMarker">' + esc(t("Lag markering")) + '</button>');
  $("kollForr").onclick = () => gaaTil(tilstand.nr - 1);
  $("kollNeste").onclick = () => gaaTil(tilstand.nr + 1);
  const g = $("kollGodkjenn");
  if (g) g.onclick = () => {
    if (g.dataset.status === "godkjent") {
      const k = prompt(t("Hvorfor er dette i orden? (f.eks. «oppstikk til neste støp»)"), f.kommentar || "");
      if (k === null) return;
      settStatus(f, "godkjent", k.trim());
    } else settStatus(f, "ny");
  };
  const m = $("kollMarker");
  if (m) m.onclick = () => lagMarkering(f);
}
function koble(body) {
  body.querySelectorAll("[data-koll-med]").forEach(c => c.onchange = () => { tilstand.valgt[Number(c.dataset.kollMed)] = c.checked; });
  body.querySelectorAll("[data-koll-od]").forEach(inp => inp.onchange = () => {
    const v = Math.max(0, Math.round(Number(String(inp.value).replace(",", ".")) || 0));
    tilstand.overdekning[Number(inp.dataset.kollOd)] = v || "";
    try { localStorage.setItem("storm.kollisjon.od", JSON.stringify(tilstand.overdekning)); } catch (_) {}
    tegn();
  });
  const k = body.querySelector("#kollKjor"); if (k) k.onclick = () => kjor();
  body.querySelectorAll("[data-koll-filter]").forEach(b => b.onclick = () => { tilstand.filter = b.dataset.kollFilter; tilstand.nr = 0; tegn(); });
  body.querySelectorAll("[data-koll-nr]").forEach(b => b.onclick = () => gaaTil(Number(b.dataset.kollNr)));
  const bc = body.querySelector("#kollBcf"); if (bc) bc.onclick = () => lastNedBcf().catch(err => varsel(t("Klarte ikke å lage BCF: {0}", err.message)));
  const x = body.querySelector("#kollXlsx"); if (x) x.onclick = () => lastNedExcel().catch(err => varsel(t("Klarte ikke å lage Excel-fila: ") + err.message));
}

try { tilstand.overdekning = JSON.parse(localStorage.getItem("storm.kollisjon.od") || "{}") || {}; } catch (_) {}

// Lag-panelet lukkes med krysset → ta bort navigasjonslinja
document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest('[data-lukk="lagPanel"]')) setTimeout(tegnNav, 0); });
// Ny hovedmodell: funnene hører til den gamle (S.ryddLag kalles av clearModel)
{
  const tidligere = S.ryddLag;
  S.ryddLag = () => { if (tidligere) tidligere(); tilstand.funn = null; tilstand.fil = ""; S.hovedHarArmering = null; tegnNav(); };
}
