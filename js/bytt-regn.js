// 🔁 «BYTT TIL DE NYE» — ren logikk (forslag 10A, Emil 03.11).
//
// PROBLEMET: takplatene og blikket får id-en sin av HVOR de sitter (sw-tak.js
// plateId, sw-blikk.js blikkStykkeId). Regnes taket på nytt, får platene nye
// id-er, og de gamle blir liggende i framdriftsplanen og ferdigmeldingene som
// «finnes ikke lenger i modellen».
//
// LØSNINGEN: siden id-en ER posisjonen, kan vi lese den gamle plassen rett ut
// av den gamle id-en og finne den nye plata som ligger nærmest — på samme
// takflate (blikk: samme sett, fasade og type).
//
//   tak:t:0:1030:0          → flate «t:0», punkt (v 1030, u 0)
//   blikk:ytter:0:topp:600  → «ytter:0:topp», punkt (600)
//
// SW-elementene (v12, r3, gulvet) har løpenummer, ikke posisjon. Dem kan vi
// ikke finne igjen på denne måten — de står som «ingen ny i nærheten».
//
// Ingen DOM, ingen andre moduler: testes direkte i Node.

export const MAKS_MM = 1500;   // lenger unna enn dette er det ikke «samme plate»

// { gruppe, pos: [a, b] } eller null
export function posFra(k) {
  const s = String(k || "");
  let m = /^tak:t:(-?\d+):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { gruppe: "tak:" + m[1], pos: [Number(m[2]), Number(m[3])] };
  m = /^blikk:([a-z]+):(-?\d+):([a-z]+):(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { gruppe: "blikk:" + m[1] + ":" + m[2] + ":" + m[3], pos: [Number(m[4]), 0] };
  return null;
}

// gamle: nøklene som er borte. finnes: alle nøklene som står i modellen nå.
// → [{ fra, til (null = ingen), mm }] i samme rekkefølge som `gamle`.
// Én ny plate brukes til høyst én gammel: de nærmeste parene velges først.
export function finnBytter(gamle, finnes, maksMm) {
  const maks = Number(maksMm) > 0 ? Number(maksMm) : MAKS_MM;
  const kandidater = new Map();     // gruppe → [{ k, pos }]
  for (const k of finnes || []) {
    const p = posFra(k);
    if (!p) continue;
    if (!kandidater.has(p.gruppe)) kandidater.set(p.gruppe, []);
    kandidater.get(p.gruppe).push({ k, pos: p.pos });
  }
  const par = [];
  const unike = [...new Set(gamle || [])];
  unike.forEach((fra, i) => {
    const p = posFra(fra);
    if (!p) return;
    for (const c of kandidater.get(p.gruppe) || []) {
      const mm = Math.hypot(c.pos[0] - p.pos[0], c.pos[1] - p.pos[1]);
      if (mm <= maks) par.push({ i, fra, til: c.k, mm });
    }
  });
  par.sort((a, b) => a.mm - b.mm || a.i - b.i);
  const brukt = new Set(), ferdig = new Map();
  for (const x of par) {
    if (ferdig.has(x.fra) || brukt.has(x.til)) continue;
    ferdig.set(x.fra, x); brukt.add(x.til);
  }
  return unike.map(fra => {
    const x = ferdig.get(fra);
    return x ? { fra, til: x.til, mm: Math.round(x.mm) } : { fra, til: null, mm: null };
  });
}

// Bytter i objektlista til ett trinn: gammel → ny, gammel uten ny → ut.
// En ny som alt ligger i trinnet, legges ikke inn to ganger.
// → { objekter, endret }
export function byttIObjekter(objekter, kart) {
  const ut = [], sett = new Set();
  let endret = false;
  for (const o of objekter || []) {
    if (!o || !o.k) continue;
    if (kart.has(o.k)) {
      endret = true;
      const til = kart.get(o.k);
      if (til && !sett.has(til)) { ut.push({ k: til }); sett.add(til); }
      continue;
    }
    if (sett.has(o.k)) { endret = true; continue; }
    ut.push(o); sett.add(o.k);
  }
  return { objekter: ut, endret };
}

// Avstanden som tekst: «samme sted» under 2 cm, ellers «12 cm unna»
export function avstandTekst(mm) {
  if (mm == null) return "";
  return mm < 20 ? "samme sted" : Math.round(mm / 10) + " cm unna";
}
