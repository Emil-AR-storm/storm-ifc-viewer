// 📁 Navngitte resultater i SharePoint — delt lager for SW-resultater og Grupper.
//
// HVORFOR DENNE FILA FINNES. Både «Lagrede SW-resultater» og «Lagrede grupper»
// lå i localStorage, én nøkkel per modellfil. Det betyr: på DENNE maskinen, i
// DENNE nettleseren. Emil lagret et resultat på kontoret og Simen fant det
// aldri — det fantes ikke noe sted han kunne lete. Modellbiblioteket, de delte
// markeringene og de personlige innstillingene ligger allerede i SharePoint med
// samme innlogging; dette er den fjerde tingen som skulle ligget der.
//
// TO LISTER SOM ER LIKE NOK TIL Å DELE KODE. Begge er en liste av poster med et
// NAVN som nøkkel, begge lagres per modellfil, begge skrives når brukeren
// trykker Lagre. Skrev vi det to ganger, ville flettingen og 412-håndteringen
// drevet fra hverandre første gang noe ble rettet i den ene.
//
// LOKALT ER HURTIGBUFFER, SHAREPOINT ER FASIT. Verktøyet starter og virker
// fullt ut uten innlogging — du får bare ikke se kollegaenes lister, og dine
// egne blir liggende til du logger inn.
import { S } from "./state.js";
import { GRAPH, SP, authHeaders, graphGet, spTokenSilent } from "./sharepoint.js";
// Reglene for hvem som vinner og hva som ryddes bort er RENE
// tallfunksjoner uten nett og uten nettleser — de bor i sin egen fil og
// prøves i _test/test-splager.mjs.
import { flett, ryddGravsteiner } from "./sp-flett.js";

export function spPaalogget() {
  try { return !!(S.msalApp && S.msalApp.getActiveAccount()); } catch (_) { return false; }
}

function filSti(mappe, fil) {
  return "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/") +
    "/" + encodeURIComponent(mappe) + "/" + encodeURIComponent(fil);
}

async function omradeId(token) {
  if (!S.spSiteId) {
    const site = await graphGet("/sites/" + SP.hostname + ":" + SP.sitePath, token);
    S.spSiteId = site.id;
  }
  return S.spSiteId;
}

// Mappa opprettes første gang noen lagrer, som Innstillinger-mappa gjør.
// conflictBehavior=replace på en mappe som finnes er en no-op, ikke en sletting.
async function sikreMappe(token, sid, mappe) {
  const forelder = "/drive/root:/" + SP.folder.split("/").map(encodeURIComponent).join("/");
  await fetch(GRAPH + "/sites/" + sid + forelder + ":/children", {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }, "sp-lager"),
    body: JSON.stringify({ name: mappe, folder: {}, "@microsoft.graph.conflictBehavior": "replace" })
  }).catch(() => {});
}

// Svaret sier hva som SKJEDDE, ikke bare hva som kom:
//   "av"   – ikke innlogget. Ikke en feil; verktøyet skal virke uten.
//   "tom"  – innlogget, men fila finnes ikke ennå (første gang).
//   "ok"   – lista ligger i `liste`, og `etag` brukes ved neste skriving.
//   "feil" – noe gikk galt, og da skal vi IKKE late som lista er tom.
// Uten det skillet ville en nettfeil sett ut som «ingen har lagret noe», og
// neste skriving ville tørket ut kollegaenes poster.
export async function spLes(mappe, fil) {
  const token = await spTokenSilent();
  if (!token) return { status: "av", liste: [] };
  try {
    const sid = await omradeId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + ":/content",
      { headers: authHeaders(token, null, "sp-lager") });
    if (r.status === 404) return { status: "tom", liste: [] };
    if (!r.ok) throw new Error("Graph " + r.status);
    const d = await r.json();
    return { status: "ok", liste: Array.isArray(d) ? d : (Array.isArray(d && d.liste) ? d.liste : []) };
  } catch (err) {
    console.warn("Kunne ikke lese " + mappe + "/" + fil + ":", err.message);
    return { status: "feil", liste: [] };
  }
}

async function lesEtag(token, sid, mappe, fil) {
  const r = await fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + "?$select=id,eTag",
    { headers: authHeaders(token, null, "sp-lager") });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Graph " + r.status);
  return (await r.json()).eTag || null;
}

// ---------- Skriving med fletting ----------
// HELE LISTA LIGGER I ÉN FIL, og det er med vilje: da kan en kollega se alt du
// har lagret uten å bla i hundre småfiler. Prisen er at to som lagrer samtidig
// skriver i samme fil. Derfor leses fila på nytt rett før skriving, og postene
// flettes på navn — lagrer Simen «Gavl vest» mens du lagrer «Langvegg sør»,
// beholdes begge. Er navnet det samme, vinner den som lagret sist; det er hva
// Lagre betyr, og versjonshistorikken i SharePoint har den forrige.
//
// eTag + If-Match fanger den siste lille sprekken: rakk noen å skrive MELLOM
// lesingen og skrivingen vår, svarer Graph 412, og vi går én runde til. Én
// gang, ikke i evig løkke — går det galt to ganger, skal brukeren få vite det.
export async function spSkriv(mappe, fil, poster, nokkel) {
  const token = await spTokenSilent();
  if (!token) return { ok: false, grunn: "av" };
  try {
    const sid = await omradeId(token);
    for (let forsok = 0; forsok < 2; forsok++) {
      const fra = await spLes(mappe, fil);
      if (fra.status === "feil") return { ok: false, grunn: "feil" };
      const samlet = ryddGravsteiner(flett(poster, fra.liste, nokkel));
      const etag = fra.status === "ok" ? await lesEtag(token, sid, mappe, fil) : null;
      const hoder = { "Content-Type": "application/json" };
      if (etag) hoder["If-Match"] = etag;
      let r = await fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + ":/content", {
        method: "PUT",
        headers: authHeaders(token, hoder, "sp-lager"),
        body: JSON.stringify(samlet)
      });
      if (r.status === 404 && !etag) {            // mappa fantes ikke
        await sikreMappe(token, sid, mappe);
        r = await fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + ":/content", {
          method: "PUT",
          headers: authHeaders(token, { "Content-Type": "application/json" }, "sp-lager"),
          body: JSON.stringify(samlet)
        });
      }
      if (r.status === 412) continue;             // noen kom oss i forkjøpet – les på nytt
      if (!r.ok) throw new Error("Graph " + r.status);
      return { ok: true, liste: samlet };
    }
    return { ok: false, grunn: "opptatt" };
  } catch (err) {
    console.warn("Kunne ikke lagre " + mappe + "/" + fil + ":", err.message);
    return { ok: false, grunn: "feil" };
  }
}

// ---------- Binære filer som skrives ÉN gang ----------
// ⛰ Terrengets høydegrid (Float32, noen MB). Det går ikke gjennom lista over:
// det er ikke JSON, og det skal ALDRI endres (spesifikasjonen, regel 1) — et
// nytt utsnitt får ny id og ny fil. Derfor ingen fletting og ingen eTag, men
// If-None-Match: * — finnes fila alt, svarer Graph 412, og da er det samme
// id og samme innhold: det teller som lagret.
//
// Står HER og ikke i terreng.js: byggeplanen advarte mot en tredje lagringsvei.
// Mappe, område og innlogging er de samme som for lista, og de skal bare
// finnes ett sted.
export async function spSkrivBin(mappe, fil, data, type) {
  const token = await spTokenSilent();
  if (!token) return { ok: false, grunn: "av" };
  try {
    const sid = await omradeId(token);
    const put = () => fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + ":/content", {
      method: "PUT",
      headers: authHeaders(token, { "Content-Type": type || "application/octet-stream", "If-None-Match": "*" }, "sp-lager-bin"),
      body: data
    });
    let r = await put();
    if (r.status === 404) { await sikreMappe(token, sid, mappe); r = await put(); }
    if (r.status === 412 || r.status === 409) return { ok: true, fantes: true };
    if (!r.ok) throw new Error("Graph " + r.status);
    return { ok: true };
  } catch (err) {
    console.warn("Kunne ikke lagre " + mappe + "/" + fil + ":", err.message);
    return { ok: false, grunn: "feil" };
  }
}

// Samme tre svar som spLes: "av", "tom" (finnes ikke) og "ok" med `data`
// (ArrayBuffer), eller "feil".
export async function spLesBin(mappe, fil) {
  const token = await spTokenSilent();
  if (!token) return { status: "av", data: null };
  try {
    const sid = await omradeId(token);
    const r = await fetch(GRAPH + "/sites/" + sid + filSti(mappe, fil) + ":/content",
      { headers: authHeaders(token, null, "sp-lager-bin") });
    if (r.status === 404) return { status: "tom", data: null };
    if (!r.ok) throw new Error("Graph " + r.status);
    return { status: "ok", data: await r.arrayBuffer() };
  } catch (err) {
    console.warn("Kunne ikke lese " + mappe + "/" + fil + ":", err.message);
    return { status: "feil", data: null };
  }
}

export { flett, flettPaaId, flettPaaNavn, ryddGravsteiner } from "./sp-flett.js";
