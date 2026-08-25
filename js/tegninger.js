// 📄 Arbeidstegninger: PDF-bibliotek per modell, hentet fra SharePoint.
//
// Mappestruktur:
//   IFC-modeller/Tegninger/<modellnavn uten filendelse>/K-201 Snitt B-B.pdf
//
// En markering lagrer bare en HENVISNING – { fil, itemId, side } – aldri en
// kopi av PDF-en. Tjue markeringer som viser til samme tegning betyr én fil i
// SharePoint, lastet ned én gang per økt. Sletter du markeringen, står tegningen
// urørt i biblioteket.
//
// pdf.js hentes med dynamisk import FØRST når noen faktisk åpner en tegning, så
// en vanlig økt uten PDF-er ikke betaler for biblioteket.
import { S, loadingEl, loadingText } from "./state.js";
import { LETT } from "./lett.js";
import { t } from "./i18n.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";

export const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.mjs";
export const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";

export const ADVAR_MB = 25;        // over dette spør vi før nedlasting
export const RENDER_BREDDE = 2400; // piksler på lengste side når en side tegnes

export const tegningsMappe = () => SP.folder + "/Tegninger";

// Logoene til PDF-rapporten. Egen mappe ved siden av Tegninger, med samme
// tanke: legg fila i mappa, så dukker den opp i menyen. Ingen JSON å redigere.
//
// FILNAVN, ALDRI EN NETTADRESSE. oppsett.json skal ikke kunne peke logoen til
// en fremmed server — det ville gjenåpne samme klasse hull som hvitlista i
// oppsett.js nettopp lukket.
export const logoMappe = () => SP.folder + "/Logoer";
export const erBilde = (navn) => /\.(png|jpe?g)$/i.test(String(navn || ""));

// ---------- Navn og mappekobling (rene funksjoner) ----------

export function utenEndelse(navn) {
  return String(navn || "").replace(/\.(ifc|glb)$/i, "");
}

// Mappa heter det samme som IFC-filen. Men en 💾 lett kopi heter gjerne
// «Datasenter drangedalen LETT (1).glb», og skal finne fram til samme mappe.
export function normaliserModellnavn(navn) {
  return utenEndelse(navn)
    .replace(/\s*\(\d+\)\s*$/, "")                  // «(1)» fra nedlasting
    .replace(/[\s_-]*lett(\s*kopi)?\s*$/i, "")      // «LETT» / «lett kopi»
    .trim();
}

// Mappene vi prøver, i rekkefølge: husket valg, filnavnet, det normaliserte navnet.
export function mappekandidater(modell, husket) {
  const ut = [];
  [husket, utenEndelse(modell), normaliserModellnavn(modell)].forEach(k => {
    if (k && !ut.includes(k)) ut.push(k);
  });
  return ut;
}

const huskeNokkel = (modell) => "storm-ifc-tegningsmappe::" + modell;

export function husketMappe(modell) {
  try { return localStorage.getItem(huskeNokkel(modell)) || ""; } catch(_) { return ""; }
}

export function huskMappe(modell, mappenavn) {
  try { localStorage.setItem(huskeNokkel(modell), mappenavn); } catch(_) {}
}

export const erPdf = (navn) => /\.pdf$/i.test(String(navn || ""));

// 🌐 HTML-sider (f.eks. en tegningskatalog) kan ligge i SAMME mappe som
// PDF-ene. De vises som egen kategori i velgeren og åpnes i ny fane —
// fortsatt bak SharePoint-innloggingen, det er hele poenget med å legge
// dem der i stedet for på en åpen nettadresse.
export const erHtml = (navn) => /\.html?$/i.test(String(navn || ""));

export function mb(bytes) {
  return (Number(bytes) || 0) / 1048576;
}

// ---------- SharePoint ----------

async function siteId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

// Leser en mappe. Finnes den ikke, gir vi null i stedet for å kaste – mange
// prosjekter har ingen tegningsmappe ennå.
export async function lesMappe(mappe, token) {
  const sti = mappe.split("/").map(encodeURIComponent).join("/");
  try {
    const d = await graphGet("/sites/" + S.spSiteId + "/drive/root:/" + sti +
      ":/children?$top=999&$select=id,name,size,lastModifiedDateTime,file,folder", token);
    return d.value || [];
  } catch (err) {
    if (/Graph 404/.test(err.message)) return null;
    throw err;
  }
}

// Henter tegningene for en modell.
// Svar: { mappenavn, filer } · { mangler: true, undermapper } · { feil }
export async function hentTegninger(modell) {
  if (!modell) return { feil: t("Ingen modell er åpen") };
  let token;
  try { token = await spTokenSilent(); } catch(_) { token = null; }
  if (!token) return { feil: "IKKE_INNLOGGET" };
  await siteId(token);

  for (const kandidat of mappekandidater(modell, husketMappe(modell))) {
    const innhold = await lesMappe(tegningsMappe() + "/" + kandidat, token);
    if (innhold) {
      const filer = innhold.filter(f => f.file && (erPdf(f.name) || erHtml(f.name)))
        .sort((a, b) => a.name.localeCompare(b.name, "no"));
      return {
        mappenavn: kandidat,
        // PDF-ene oppfører seg som før; HTML-sidene er en egen kategori
        filer: filer.filter(f => erPdf(f.name)),
        htmlSider: filer.filter(f => erHtml(f.name))
      };
    }
  }

  // Ingen mappe passet. Hvilke finnes, så brukeren kan velge selv?
  const rot = await lesMappe(tegningsMappe(), token);
  return {
    mangler: true,
    undermapper: (rot || []).filter(x => x.folder).map(x => x.name).sort((a, b) => a.localeCompare(b, "no"))
  };
}

// Brukeren pekte selv ut mappa – husk valget og hent på nytt.
export async function velgMappe(modell, mappenavn) {
  huskMappe(modell, mappenavn);
  return hentTegninger(modell);
}

// ---------- pdf.js, lastet ved behov ----------

let pdfLib = null;

export async function lastPdfLib() {
  if (pdfLib) return pdfLib;
  const m = await import(PDFJS_URL);
  const lib = m.default && m.default.getDocument ? m.default : m;
  try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch(_) {}
  pdfLib = lib;
  return lib;
}

const dokBuffer = new Map();    // itemId → pdf-dokument
const sideBuffer = new Map();   // itemId:side → blob-URL

export function erNedlastet(vedlegg) {
  return !!(vedlegg && dokBuffer.has(vedlegg.itemId));
}

// Laster ned PDF-en og åpner den med pdf.js. Store filer får en advarsel først –
// på byggeplass over mobilnett er 40 MB nesten et minutt.
// R2-nøkkelen for en tegning: itemId-en vasket til trygge tegn.
// MÅ være identisk med tegningNavn() i byggeplass.js.
export function tegningNavn(itemId) {
  return String(itemId).replace(/[^0-9a-zA-Z_-]/g, "_") + ".pdf";
}

export async function pdfDokument(vedlegg, spor) {
  if (dokBuffer.has(vedlegg.itemId)) return dokBuffer.get(vedlegg.itemId);
  if (mb(vedlegg.storrelse) > ADVAR_MB && !confirm(
      t("{0} er {1} MB. Over mobilnett kan nedlastingen ta et minutt. Åpne likevel?",
        vedlegg.fil, mb(vedlegg.storrelse).toFixed(0)))) {
    return null;
  }
  if (LETT) {
    // Byggeplassen: tegningen ble lagt i R2 av Byggeplass-knappen, og hentes
    // fra Workeren med beviset fra kodefeltet. Ingen innlogging.
    if (spor) spor(t("Henter {0} …", vedlegg.fil));
    const r = await fetch("/tegning/" + (S.lettProsjekt || "00000") + "/" + tegningNavn(vedlegg.itemId));
    if (!r.ok) throw new Error(r.status === 404
      ? t("Tegningen er ikke lastet opp til byggeplass-lenka ennå")
      : t("Kunne ikke hente tegningen (Graph {0})", r.status));
    const data = new Uint8Array(await r.arrayBuffer());
    if (spor) spor(t("Åpner {0} …", vedlegg.fil));
    const lib = await lastPdfLib();
    const doc = await lib.getDocument({ data }).promise;
    dokBuffer.set(vedlegg.itemId, doc);
    return doc;
  }
  let token;
  try { token = await spTokenSilent(); } catch(_) { token = null; }
  if (!token) throw new Error("IKKE_INNLOGGET");
  await siteId(token);
  if (spor) spor(t("Henter {0} …", vedlegg.fil));
  const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/items/" +
    encodeURIComponent(vedlegg.itemId) + "/content",
    { headers: authHeaders(token, null, "tegning") });
  if (!r.ok) throw new Error(r.status === 404
    ? t("Tegningen finnes ikke i SharePoint lenger")
    : t("Kunne ikke hente tegningen (Graph {0})", r.status));
  const data = new Uint8Array(await r.arrayBuffer());
  if (spor) spor(t("Åpner {0} …", vedlegg.fil));
  const lib = await lastPdfLib();
  const doc = await lib.getDocument({ data }).promise;
  dokBuffer.set(vedlegg.itemId, doc);
  return doc;
}

export async function antallSider(vedlegg, spor) {
  const doc = await pdfDokument(vedlegg, spor);
  return doc ? doc.numPages : 0;
}

// Klemmer et sidetall inn i det som finnes. Ren funksjon, testes for seg.
export function gyldigSide(side, antall) {
  const n = Math.round(Number(side) || 1);
  if (!antall) return 1;
  return Math.min(Math.max(1, n), antall);
}

// Tegner én side og gir en blob-URL tilbake. Bildet gjenbrukes, så du kan bla
// fram og tilbake uten å tegne på nytt.
export async function sideBilde(vedlegg, side, spor) {
  const doc = await pdfDokument(vedlegg, spor);
  if (!doc) return null;
  const nr = gyldigSide(side, doc.numPages);
  const nokkel = vedlegg.itemId + ":" + nr;
  if (sideBuffer.has(nokkel)) return sideBuffer.get(nokkel);
  if (spor) spor(t("Tegner side {0} …", nr));
  const page = await doc.getPage(nr);
  const basis = page.getViewport({ scale: 1 });
  // tegn stort nok til at zoom i visningen fortsatt er lesbart
  const skala = Math.max(0.2, Math.min(4, RENDER_BREDDE / Math.max(basis.width, basis.height)));
  const vp = page.getViewport({ scale: skala });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error(t("Klarte ikke å tegne siden"));
  const url = URL.createObjectURL(blob);
  sideBuffer.set(nokkel, url);
  return url;
}

// Ny modell åpnet: glem både dokumenter og tegnede sider.
export function tomTegningsbuffer() {
  for (const url of sideBuffer.values()) { try { URL.revokeObjectURL(url); } catch(_) {} }
  sideBuffer.clear();
  dokBuffer.clear();
}

// Liten hjelper for framdriftsteksten
export function visStatus(tekst) {
  if (!tekst) { loadingEl.classList.remove("open"); return; }
  loadingText.textContent = tekst;
  loadingEl.classList.add("open");
}


// ---------- 🌐 HTML-sider fra tegningsmappa ----------
// Åpner en HTML-fil fra SharePoint i ny fane. Fila hentes med token (bak
// innloggingen) og vises fra en blob-URL — den får dermed ingen delbar
// adresse: lukker du fanen, er tilgangen borte.
//
// VIKTIG REKKEFØLGE: fanen åpnes FØR den asynkrone hentingen — en
// window.open etter en await har mistet klikket sitt, og popup-blokkeren
// stopper den.
export async function apneHtmlTegning(item) {
  const fane = window.open("", "_blank");
  try {
    let token;
    try { token = await spTokenSilent(); } catch (_) { token = null; }
    if (!token) throw new Error("IKKE_INNLOGGET");
    await siteId(token);
    const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/items/" +
      encodeURIComponent(item.id) + "/content", { headers: authHeaders(token, null, "html-tegning") });
    if (!r.ok) throw new Error("Graph " + r.status);
    const blob = new Blob([await r.arrayBuffer()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    if (fane) fane.location = url;
    else window.open(url, "_blank");
    // ryddes når blobben er lest inn i fanen — 60 sek er rikelig
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
  } catch (err) {
    if (fane) { try { fane.close(); } catch (_) {} }
    throw err;
  }
}

// ---------- Logoer til rapporten ----------
// Tom eller manglende mappe gir tom liste, ikke feil: rapporten faller da
// tilbake på tekstlogoen og lages likevel.
export async function hentLogoer() {
  let token;
  try { token = await spTokenSilent(); } catch (_) { token = null; }
  if (!token) return [];
  try {
    await siteId(token);
    const innhold = await lesMappe(logoMappe(), token);
    return (innhold || []).filter(f => f.file && erBilde(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, "no"))
      .map(f => ({ fil: f.name, itemId: f.id, storrelse: f.size || 0 }));
  } catch (err) {
    console.warn("Kunne ikke lese logomappa:", err.message);
    return [];
  }
}

// Henter én logo som data-URL, klar for jsPDF.
export async function hentLogo(itemId) {
  if (!itemId) return null;
  let token;
  try { token = await spTokenSilent(); } catch (_) { token = null; }
  if (!token) return null;
  try {
    const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/items/" +
      encodeURIComponent(itemId) + "/content", { headers: authHeaders(token, null, "logo") });
    if (!r.ok) throw new Error("Graph " + r.status);
    const blob = await r.blob();
    const data = await new Promise((ja, nei) => {
      const l = new FileReader();
      l.onload = () => ja(l.result); l.onerror = nei;
      l.readAsDataURL(blob);
    });
    const mål = await new Promise((ja) => {
      const i = new Image();
      i.onload = () => ja({ b: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => ja({ b: 1000, h: 260 });
      i.src = data;
    });
    return { data, b: mål.b, h: mål.h };
  } catch (err) {
    console.warn("Kunne ikke hente logoen:", err.message);
    return null;
  }
}
