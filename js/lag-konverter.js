// 🧅 LAG — gjør om en IFC til et lag i bakgrunnen (runde 5, 28.10.2026).
//
// HVORFOR EN EGEN TRÅD. IFC-tråden (ifc-worker.js) har ÉN modell åpen — den
// lukker forrige når en ny åpnes. Hadde laget gått gjennom den, ville
// hovedmodellen blitt lukket bak ryggen på brukeren. Her startes en NY
// instans av samme fil, laget leses der, og tråden avsluttes etterpå.
// Hovedmodellen merker ingenting, og IFC-logikken finnes fortsatt bare ett sted.
//
// Laget leses i «lav kvalitet»-formen (sammenslått per farge, med `ranges` per
// element), men UTEN å sile bort noe: minst = 0 og alle = true, så hver
// armeringsstang og hvert festemiddel er med.
//
// Svar: { deler: [{ pos, norm, idx, ranges, color }], kote, props, raaTall,
//         lengde, antall }
const STILLE_MS = 300000;   // 5 min stillhet — OpenModel på en stor fil gir ingen puls

export function lagIfcTraad() {
  if (typeof Worker === "undefined") return null;
  try { return new Worker(new URL("./ifc-worker.js", import.meta.url), { type: "module" }); }
  catch (_) { return null; }
}

// Liten samtale med én tråd: ett løfte per kommando, meldinger underveis til
// `underveis`. Samme protokoll som ifcrpc.js.
export function samtale(w) {
  let nesteId = 1;
  const venter = new Map();
  let dod = null;
  const drep = (melding) => {
    dod = melding;
    for (const [, v] of venter) { clearTimeout(v.timer); v.avvis(new Error(melding)); }
    venter.clear();
    try { w.terminate(); } catch (_) {}
  };
  w.onmessage = (e) => {
    const m = e.data || {};
    const v = venter.get(m.id);
    if (!v) return;
    v.pust();
    if (m.type === "puls") return;
    if (m.type) { if (v.underveis) v.underveis(m); return; }
    clearTimeout(v.timer);
    venter.delete(m.id);
    if (m.feil) v.avvis(new Error(m.feil)); else v.los(m.svar);
  };
  w.onerror = (e) => drep((e && e.message) || "Lag-tråden stoppet");
  return {
    kall(cmd, args, underveis, overfor) {
      if (dod) return Promise.reject(new Error(dod));
      const id = nesteId++;
      return new Promise((los, avvis) => {
        const v = { los, avvis, underveis, timer: null };
        v.pust = () => {
          clearTimeout(v.timer);
          v.timer = setTimeout(() => drep("Lag-tråden svarte ikke på «" + cmd + "» — trolig tom for minne"), STILLE_MS);
        };
        venter.set(id, v);
        v.pust();
        w.postMessage({ id, cmd, args: args || {} }, overfor || []);
      });
    },
    avslutt() { try { w.terminate(); } catch (_) {} }
  };
}

// buffer: ArrayBuffer med IFC-fila (overføres til tråden — ikke bruk den etterpå).
// framdrift(tekst, andel 0–1)
export async function konverterIfc(buffer, framdrift, opts) {
  const si = framdrift || (() => {});
  const w = (opts && opts.traad) || lagIfcTraad();
  if (!w) throw new Error("Nettleseren kan ikke gjøre om lag i bakgrunnen (Web Worker mangler)");
  const s = samtale(w);
  try {
    si("Åpner IFC-filen …", 0.02);
    const info = await s.kall("open", { buffer, light: true, minst: 0, alle: true, sirkel: 8 }, null, [buffer]);
    const deler = [];
    si("Leser geometrien …", 0.05);
    const geo = await s.kall("geometryLight", info, (m) => {
      if (m.type === "progress" && m.total) si("Leser geometrien …", 0.05 + 0.6 * Math.min(1, m.done / m.total));
      if (m.type === "bucket") {
        deler.push({ pos: m.pos, norm: m.norm, idx: m.idx, ranges: m.ranges, color: m.color });
        si("Setter sammen geometrien …", 0.65 + 0.15 * ((m.nr + 1) / (m.av || 1)));
      }
    });
    const ider = [];
    for (const d of deler) for (const r of d.ranges) ider.push(r.id);
    si("Leser navn og typer …", 0.82);
    const meta = await s.kall("meta", { ids: [...new Set(ider)] });
    const props = {};
    for (const m of meta || []) props[m.id] = [m.name || "", m.objectType || "", m.typeName ? "Ifc" + m.typeName : "", m.material || "", m.globalId || ""];
    si("Leser nøkkeltall …", 0.92);
    let raa = { lengde: 1, tall: {} };
    try { raa = await s.kall("lagTall", {}); } catch (_) {}
    try { await s.kall("close", {}); } catch (_) {}
    si("Ferdig", 1);
    // Matrisen fra geometryLight, ikke fra open — den fra open er alltid
    // enhetsmatrisen i web-ifc 0.0.57 (Emils bilder 28.10: armeringen lå
    // ca. 5 m for lavt fordi begge modellene fikk «ingen flytting»).
    const cm = (geo && Array.isArray(geo.coordMatrix) && geo.coordMatrix.length === 16) ? geo.coordMatrix : info.coordMatrix;
    let kote = null;
    if (Array.isArray(cm) && cm.length === 16) {
      const { inverter } = await import("./lag-regn.js");
      kote = inverter(cm);
    }
    return { deler, kote, props, raaTall: raa.tall || {}, lengde: raa.lengde || 1,
      antall: (geo && geo.shown) || Object.keys(props).length };
  } finally {
    s.avslutt();
  }
}
