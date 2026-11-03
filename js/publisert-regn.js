// 🟡 «IKKE PUBLISERT» — ren logikk (forslag 2A, Emil 03.11).
//
// Hva har kontoret endret siden byggeplassen sist fikk markeringsfila? Ved
// hver publisering (Publiser og «Hent og send») lagres et FINGERAVTRYKK av
// innholdet per kategori: én kort hash per post (markering, trinn, rigg-
// objekt …) der postene har id, ellers én hash for hele kategorien. Senere
// regnes det samme avtrykket av det som står på kontoret nå, og forskjellen
// telles: ny, endret eller fjernet post = 1 endring.
//
// Ingen DOM, ingen andre moduler: testes direkte i Node.

// Kort, stabil hash (djb2) — dette er ikke sikkerhet, bare «er det likt?»
export function hash(tekst) {
  let h = 5381;
  const s = String(tekst);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// JSON med sorterte nøkler, så samme innhold alltid gir samme tekst
export function stabil(v) {
  if (Array.isArray(v)) return "[" + v.map(stabil).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stabil(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

// kategorier: { navn: verdi }. En liste med id-er telles per post; alt
// annet (objekt, tall, null) som én post «*».
export function avtrykk(kategorier) {
  const ut = {};
  for (const [navn, v] of Object.entries(kategorier || {})) {
    const k = {};
    if (Array.isArray(v) && v.every(x => x && typeof x === "object" && x.id != null)) {
      for (const x of v) k[String(x.id)] = hash(stabil(x));
    } else if (v != null && !(Array.isArray(v) && !v.length)) {
      k["*"] = hash(stabil(v));
    }
    ut[navn] = k;
  }
  return ut;
}

// Forskjellen mellom to avtrykk → { navn: antall } (bare kategorier med endring)
export function forskjell(gammelt, nytt) {
  const ut = {};
  const navn = new Set([...Object.keys(gammelt || {}), ...Object.keys(nytt || {})]);
  for (const n of navn) {
    const a = (gammelt && gammelt[n]) || {}, b = (nytt && nytt[n]) || {};
    let antall = 0;
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[id] !== b[id]) antall++;
    if (antall) ut[n] = antall;
  }
  return ut;
}

export const sum = (f) => Object.values(f || {}).reduce((s, n) => s + n, 0);
