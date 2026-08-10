// 📷 Bilder på markeringer.
//
// Bildene ligger som egne filer i SharePoint:
//   IFC-modeller/Markeringer/bilder/<markering>-<nr>-<slump>.jpg
// I markerings-JSON-en står bare filnavnet (c.bilder = ["1738…-1-a4f2.jpg"]).
// Grunnen: JSON-fila lastes ned hver gang en modell åpnes, og base64-bilder
// ville gjort den på mange megabyte.
//
// Et kamerabilde er 3–5 MB rett fra telefonen. Vi skalerer ned til 1600 px
// lengste side og lagrer som JPEG før opplasting – det holder rikelig for å se
// hva som er galt på byggeplassen, og gir filer på noen hundre kB.
import { S } from "./state.js";
import { LETT } from "./lett.js";
import { t } from "./i18n.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";

export const MAKS_PX = 1600;      // lengste side etter nedskalering
export const JPEG_KVALITET = 0.72;
export const MAKS_PER_MARKERING = 10;

// ---------- Rene regnestykker og navn (testes for seg) ----------

// Nye mål som beholder formatet. Bilder som alt er små røres ikke.
export function nyMaal(w, h, maks) {
  const m = maks || MAKS_PX;
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const lengst = Math.max(w, h);
  if (lengst <= m) return { w: Math.round(w), h: Math.round(h) };
  const k = m / lengst;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// Filnavn med en liten slump på slutten, så to som fotograferer samtidig på
// hver sin telefon ikke kan skrive over hverandre.
export function bildeNavn(markeringId, nr, slump) {
  const s = slump || Math.random().toString(36).slice(2, 6);
  return String(markeringId).replace(/[^0-9a-zA-Z]/g, "") + "-" + nr + "-" + s + ".jpg";
}

// Bare navnet skal stå i JSON-en – aldri en full sti eller en URL.
export function trygtNavn(navn) {
  return /^[0-9a-zA-Z_-]+\.jpg$/.test(String(navn || "")) ? String(navn) : null;
}

// ---------- Talemeldinger (N5) ----------
// Lagres akkurat som bildene: samme navneskjema, samme mappe, samme innboks.
// Det eneste som skiller dem er endelsen. .m4a er Safari/iOS og .webm er
// Chrome/Android — MediaRecorder gir ikke samme format på tvers, så begge må
// godtas. Endelsen bestemmer også content-type ved opplasting.
export const LYD_ENDELSER = ["m4a", "webm"];

export const MAKS_LYD_PER_MARKERING = 5;

export function lydNavn(markeringId, nr, endelse, slump) {
  const e = LYD_ENDELSER.includes(endelse) ? endelse : "webm";
  const s = slump || Math.random().toString(36).slice(2, 6);
  return String(markeringId).replace(/[^0-9a-zA-Z]/g, "") + "-" + nr + "-" + s + "." + e;
}

export function trygtLyd(navn) {
  return /^[0-9a-zA-Z_-]+\.(m4a|webm)$/.test(String(navn || "")) ? String(navn) : null;
}

// Content-type ut av filnavnet. Workeren gjør nøyaktig det samme oppslaget,
// så en fil som lastes opp her, serveres tilbake med riktig type.
export function vedleggMime(navn) {
  const m = /\.([0-9a-zA-Z]+)$/.exec(String(navn || ""));
  const e = m ? m[1].toLowerCase() : "";
  return e === "m4a" ? "audio/mp4" : e === "webm" ? "audio/webm" : "image/jpeg";
}

export function erBildefil(file) {
  if (!file) return false;
  if (file.type) return /^image\//.test(file.type);
  return /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(file.name || "");
}

function mappeSti() {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/Markeringer/bilder";
}

export function bildeSti(navn) {
  return mappeSti() + "/" + encodeURIComponent(navn);
}

// ---------- Komprimering i nettleseren ----------

// Leser bildet, skalerer det ned og gir en JPEG-blob tilbake.
export async function komprimer(file) {
  const bmp = await lesBilde(file);
  const m = nyMaal(bmp.width, bmp.height, MAKS_PX);
  const c = document.createElement("canvas");
  c.width = m.w; c.height = m.h;
  c.getContext("2d").drawImage(bmp, 0, 0, m.w, m.h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", JPEG_KVALITET));
  if (!blob) throw new Error(t("Klarte ikke å lage bildefil av dette bildet"));
  return blob;
}

function lesBilde(file) {
  // createImageBitmap er raskest og roterer etter EXIF, men mangler i eldre Safari
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(() => viaImgTag(file));
  }
  return viaImgTag(file);
}

function viaImgTag(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(t("Kunne ikke lese bildefilen"))); };
    img.src = url;
  });
}

// ---------- SharePoint ----------

async function siteId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

// bilder-mappa lages første gang noen legger ved et bilde. 409 = fins alt.
async function sikreMappe(token, sid) {
  if (S.bildeMappeOK) return;
  const foreldre = "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") + "/Markeringer";
  const r = await fetch(GRAPH + "/sites/" + sid + foreldre + ":/children", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }, "bilder-mappe"),
    body: JSON.stringify({ name: "bilder", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  if (!r.ok && r.status !== 409) throw new Error("Kunne ikke lage bilder-mappa (Graph " + r.status + ")");
  S.bildeMappeOK = true;
}

// Laster opp én blob. Gir filnavnet tilbake.
// LETTMODUS: montørens kvitteringsbilde går til Workerens innboks i R2 —
// prosjektlederen henter det til SharePoint neste gang han åpner modellen
// innlogget. Prosjektet leses av Workeren fra beviset (kaka fra kodefeltet).
// «av» er navnet på den som lagde fila. Brukes av talemeldinger: på
// byggeplassen finnes ingen innlogging å slå opp i senere, så navnet må følge
// med i det filen sendes — ellers er avsenderen tapt for godt.
export async function lastOpp(blob, navn, av) {
  const mime = vedleggMime(navn);
  if (LETT) {
    const r = await fetch("/kvitter?fil=" + encodeURIComponent(navn) +
      "&seksjon=" + (S._lettSeksjon === "for" ? "for" : "etter") +
      (av ? "&av=" + encodeURIComponent(String(av).slice(0, 60)) : ""), {
      method: "POST", headers: { "content-type": mime }, body: blob
    });
    if (!r.ok) throw new Error(t("Fikk ikke sendt filen") + " (" + r.status + ")");
    return navn;
  }
  const token = await spTokenSilent();
  if (!token) throw new Error("IKKE_INNLOGGET");
  const sid = await siteId(token);
  await sikreMappe(token, sid);
  const r = await fetch(GRAPH + "/sites/" + sid + bildeSti(navn) + ":/content", {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": mime }, "bilde-opplasting"),
    body: blob
  });
  if (!r.ok) throw new Error("Opplasting feilet (Graph " + r.status + ")");
  return navn;
}

// Hentede bilder holdes i en URL-buffer, så samme bilde ikke lastes ned på nytt
// hver gang bobla åpnes.
const urlBuffer = new Map();

export async function bildeUrl(navn) {
  const n = trygtNavn(navn);
  if (!n) return null;
  if (urlBuffer.has(n)) return urlBuffer.get(n);
  if (LETT) {
    try {
      const r = await fetch("/bilde/" + (S.lettProsjekt || "00000") + "/" + encodeURIComponent(n));
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      urlBuffer.set(n, url);
      return url;
    } catch (_) { return null; }
  }
  try {
    const token = await spTokenSilent();
    if (!token) return null;
    const sid = await siteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + bildeSti(n) + ":/content",
      { headers: authHeaders(token, null, "bilde-nedlasting") });
    if (!r.ok) return null;
    const url = URL.createObjectURL(await r.blob());
    urlBuffer.set(n, url);
    return url;
  } catch(_) { return null; }   // uten nett/innlogging viser vi 🔒 i stedet
}

// Talemeldinger hentes samme vei som bildene. Egen funksjon i stedet for et
// flagg på bildeUrl: navnesjekken er ulik, og en lydfil skal aldri kunne havne
// i bildegalleriet fordi noen sendte feil flagg.
export async function lydUrl(navn) {
  const n = trygtLyd(navn);
  if (!n) return null;
  if (urlBuffer.has(n)) return urlBuffer.get(n);
  try {
    if (LETT) {
      const r = await fetch("/bilde/" + (S.lettProsjekt || "00000") + "/" + encodeURIComponent(n));
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      urlBuffer.set(n, url);
      return url;
    }
    const token = await spTokenSilent();
    if (!token) return null;
    const sid = await siteId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + bildeSti(n) + ":/content",
      { headers: authHeaders(token, null, "lyd-nedlasting") });
    if (!r.ok) return null;
    const url = URL.createObjectURL(await r.blob());
    urlBuffer.set(n, url);
    return url;
  } catch (_) { return null; }
}

// Sletter bildefilene til en markering. Stille: mislykkes en sletting, blir det
// en foreldreløs fil i SharePoint – det skal ikke stoppe brukeren fra å slette
// markeringen.
export async function slettBilder(navn) {
  const liste = (navn || []).map(n => trygtNavn(n) || trygtLyd(n)).filter(Boolean);
  if (!liste.length) return;
  try {
    const token = await spTokenSilent();
    if (!token) return;
    const sid = await siteId(token);
    for (const n of liste) {
      urlBuffer.delete(n);
      await fetch(GRAPH + "/sites/" + sid + bildeSti(n), {
        method: "DELETE",
        headers: authHeaders(token, null, "bilde-sletting")
      }).catch(() => {});
    }
  } catch(_) {}
}

// ---------- Hele veien fra valgt fil til lagret filnavn ----------
// Gir en liste filnavn tilbake. Kaster med "IKKE_INNLOGGET" hvis brukeren ikke
// er logget inn – da har vi ingen plass å legge bildene.
//
// `nummerFra` er hvor mange bilder markeringen alt har TIL SAMMEN (før + etter).
// Nummereringen går på tvers av seksjonene, så to filer aldri kan få samme navn.
// Hvor mange bilder en seksjon får ha, avgjøres av den som kaller.
export async function leggTilBilder(markeringId, filer, nummerFra) {
  const fra = Number(nummerFra) || 0;
  const ut = [];
  const inn = [...filer].filter(erBildefil);
  for (let i = 0; i < inn.length; i++) {
    const blob = await komprimer(inn[i]);
    ut.push(await lastOpp(blob, bildeNavn(markeringId, fra + i + 1)));
  }
  return ut;
}
