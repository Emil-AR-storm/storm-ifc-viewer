// ⚡ RASKERE INNLASTING – de rene reglene (B4 i
// BYGGEPLAN-3D-innebygd-tillegg-2026-11-09.md). Ingen nettleser, ingen nett.
// Prøves i _test/test-modell-lager.mjs. Selve lagringen bor i modell-lager.js.
//
// 1. MÅLING: tre tider – nedlasting (MB/s), tolking og første bilde – så vi
//    vet om nettet eller maskinen er flaskehalsen.
// 2. MELLOMLAGRING: den nedlastede fila lagres i nettleseren (Cache Storage)
//    med SharePoint-id og cTag som nøkkel. Neste gang hentes bare metadata;
//    er cTag lik, leses fila lokalt. Maks 3 modeller / 1,5 GB, den som er
//    brukt lengst siden fjernes først.
// 3. GZIP: «<navn>.glb.gz» ved siden av en lett kopi hentes i stedet for
//    .glb-en når den er like ny eller nyere. Tapsfritt – ranges, props og
//    ExpressID-er er nøyaktig like (ikke Draco/gltfpack, som stokker punktene).

export const LAGER_CACHE = "storm-modeller-v1";
export const LAGER_LISTE = "storm-modell-lager";
export const MAKS_ANTALL = 3;
export const MAKS_BYTES = 1.5e9;

export const nøkkelUrl = (id) => "/__storm-modell/" + encodeURIComponent(String(id || ""));

// cTag endres bare når innholdet endres (eTag også ved nytt navn o.l.).
export function versjon(meta) {
  return String((meta && (meta.cTag || meta.eTag)) || "");
}

// Hva skal ligge igjen etter at «ny» er lagret? liste = [{ id, tag, navn,
// bytes, brukt }]. Svar: { lagre, liste, fjern: [id] }.
export function planLagring(liste, ny, maksAntall = MAKS_ANTALL, maksBytes = MAKS_BYTES) {
  const gamle = (Array.isArray(liste) ? liste : []).filter(x => x && x.id && x.id !== ny.id);
  if (!ny || !ny.id || !(ny.bytes > 0) || ny.bytes > maksBytes)
    return { lagre: false, liste: gamle, fjern: [] };
  const sortert = gamle.slice().sort((a, b) => (b.brukt || 0) - (a.brukt || 0));
  const behold = [ny];
  let sum = ny.bytes;
  const fjern = [];
  for (const x of sortert) {
    if (behold.length < maksAntall && sum + (x.bytes || 0) <= maksBytes) { behold.push(x); sum += x.bytes || 0; }
    else fjern.push(x.id);
  }
  return { lagre: true, liste: behold, fjern };
}

// Bruk den komprimerte kopien bare når den er like ny som .glb-en eller
// nyere – ellers kan en ny .glb lastet opp for hånd bli overstyrt av en
// gammel .gz.
export const gzNavn = (navn) => String(navn || "") + ".gz";
export function brukGz(glbMeta, gzMeta) {
  if (!gzMeta || !gzMeta.id) return false;
  const glb = Date.parse((glbMeta && glbMeta.lastModifiedDateTime) || "");
  const gz = Date.parse(gzMeta.lastModifiedDateTime || "");
  if (!isFinite(glb) || !isFinite(gz)) return false;
  return gz >= glb;
}
// Lønner det seg å legge ut en .gz? Minst 20 % mindre.
export const verdtGz = (rå, pakket) => rå > 0 && pakket > 0 && pakket < rå * 0.8;

// ---------- måling ----------
const tall = (v, d) => v.toFixed(d).replace(".", ",");
export const mb = (bytes) => tall((bytes || 0) / 1e6, 1) + " MB";
export const sek = (ms) => tall((ms || 0) / 1000, 1) + " s";

// «Nedlasting 85,0 MB på 12,3 s (6,9 MB/s) · tolking 4,1 s · første bilde 0,3 s»
// kilde: "nett" | "gz" (komprimert, pakket ut underveis) | "lokal"
export function måleLinje(m) {
  const v = m || {};
  let del1;
  if (v.kilde === "lokal") del1 = "Lokal kopi " + mb(v.bytes) + " på " + sek(v.nedMs);
  else {
    const fart = v.nedMs > 0 ? tall((v.nedBytes || v.bytes || 0) / 1e6 / (v.nedMs / 1000), 1) + " MB/s" : "?";
    del1 = "Nedlasting " + mb(v.nedBytes || v.bytes) + (v.kilde === "gz" ? " komprimert (" + mb(v.bytes) + " utpakket)" : "") +
      " på " + sek(v.nedMs) + " (" + fart + ")";
  }
  return del1 + " · tolking " + sek(v.tolkMs) + " · første bilde " + sek(v.tegnMs);
}
// Kort utgave til topplinja i innebygd modus: «lastet på 4,1 s (lokal kopi)»
export function kortMåling(m) {
  const v = m || {};
  const tot = (v.nedMs || 0) + (v.tolkMs || 0) + (v.tegnMs || 0);
  return "lastet på " + sek(tot) + (v.kilde === "lokal" ? " (lokal kopi)" : v.kilde === "gz" ? " (komprimert)" : "");
}
