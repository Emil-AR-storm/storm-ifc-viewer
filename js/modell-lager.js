// ⚡ Mellomlagring av modellfiler i nettleseren (B4). Reglene og målingen
// står i modell-lager-regn.js. Alt her er «beste forsøk»: feiler lagringen
// (kvote, privat vindu, gammel nettleser), åpnes modellen som før.
import * as R from "./modell-lager-regn.js";

function lesListe() {
  try { const l = JSON.parse(localStorage.getItem(R.LAGER_LISTE) || "[]"); return Array.isArray(l) ? l : []; }
  catch (_) { return []; }
}
function skrivListe(l) { try { localStorage.setItem(R.LAGER_LISTE, JSON.stringify(l)); } catch (_) { /* full */ } }
const harCache = () => typeof caches !== "undefined" && caches && typeof caches.open === "function";

// Den lagrede fila, hvis den er nøyaktig samme versjon (cTag). Ellers null.
export async function lesLokal(id, tag) {
  if (!harCache() || !id || !tag) return null;
  try {
    const liste = lesListe();
    const post = liste.find(x => x.id === id);
    if (!post || post.tag !== tag) return null;
    const c = await caches.open(R.LAGER_CACHE);
    const svar = await c.match(R.nøkkelUrl(id));
    if (!svar || svar.headers.get("x-storm-tag") !== tag) return null;
    const buf = new Uint8Array(await svar.arrayBuffer());
    post.brukt = Date.now();
    skrivListe(liste);
    return buf;
  } catch (err) {
    console.warn("Lokal modellkopi kunne ikke leses:", err && err.message);
    return null;
  }
}

export async function lagreLokal(id, tag, navn, buf) {
  if (!harCache() || !id || !tag || !buf) return false;
  try {
    const plan = R.planLagring(lesListe(), { id, tag, navn, bytes: buf.byteLength, brukt: Date.now() });
    if (!plan.lagre) return false;
    const c = await caches.open(R.LAGER_CACHE);
    for (const gammel of plan.fjern) await c.delete(R.nøkkelUrl(gammel));
    await c.put(R.nøkkelUrl(id), new Response(buf, { headers: { "content-type": "application/octet-stream", "x-storm-tag": tag } }));
    skrivListe(plan.liste);
    return true;
  } catch (err) {
    // Kvoten er full o.l.: rydd opp etter et halvt lagret forsøk og gå videre.
    console.warn("Modellen ble ikke mellomlagret:", err && err.message);
    try { (await caches.open(R.LAGER_CACHE)).delete(R.nøkkelUrl(id)); } catch (_) { /* ingenting */ }
    skrivListe(lesListe().filter(x => x.id !== id));
    return false;
  }
}

// Leser en strøm med fremdrift. pakketUt: DecompressionStream("gzip") underveis.
export async function lesStrøm(resp, total, påFremdrift, pakketUt) {
  if (!resp.body) {
    const ab = await resp.arrayBuffer();
    if (!pakketUt) return { buf: new Uint8Array(ab), nedBytes: ab.byteLength };
    const ut = await new Response(new Blob([ab]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return { buf: new Uint8Array(ut), nedBytes: ab.byteLength };
  }
  let ned = 0;
  const teller = new TransformStream({
    transform(chunk, ctl) { ned += chunk.length; if (påFremdrift && total) påFremdrift(Math.min(100, Math.round(ned / total * 100))); ctl.enqueue(chunk); }
  });
  let strøm = resp.body.pipeThrough(teller);
  if (pakketUt) strøm = strøm.pipeThrough(new DecompressionStream("gzip"));
  const reader = strøm.getReader();
  const biter = [];
  let fått = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    biter.push(value); fått += value.length;
  }
  const buf = new Uint8Array(fått);
  let o = 0;
  for (const b of biter) { buf.set(b, o); o += b.length; }
  return { buf, nedBytes: ned };
}

// Komprimerer med gzip (CompressionStream). null hvis nettleseren ikke kan.
export async function gzip(buf) {
  if (typeof CompressionStream === "undefined") return null;
  const ut = await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(ut);
}
