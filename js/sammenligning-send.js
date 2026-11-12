// 🔄 «SEND TIL STORM PROSJEKTER» fra sammenligningspanelet (runde G, 12.11.2026)
//
// BYGGEPLAN-Storm-IFC-avvik-sammenligning-2026-11-12.md, punkt 4:
//   1. finn jobbens prosjektmappe som «Legg i prosjekt» (modellen, ellers
//      prosjektnummeret i Prosjektinfo)
//   2. <prosjektmappe>/14 BIM og koordinering/Sammenligninger/<id>/
//   3. oversikt.jpg, e1.jpg … (bilder per elementtype), PDF-en og til sist
//      sammenligning.json (Storm Prosjekter ser mappa som ferdig når den finnes)
//   4. PDF-en registreres i 00 Prosjektprofil/storm-ifc-dokumenter.json
//   5. vurderinger.json i samme mappe eies av Storm Prosjekter og RØRES ALDRI
// Hver sending får ny id og ny mappe, så ingenting overskrives.
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import * as SR from "./sammenligning-regn.js";

let pågår = false;

function tilBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const bin = atob(m[2]), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: m[1] });
}
function åpenModell() {
  const fil = S.fileName || "";
  const ifc = S.kildeIfc && S.kildeIfc.fil === fil ? S.kildeIfc.ifc : (/\.ifc$/i.test(fil) ? fil : "");
  const g = S.aktivModellgruppe && S.aktivModellgruppe.fil === fil ? S.aktivModellgruppe.id : "";
  return { ifc, fil, gruppe: g };
}
async function hentLogo() {
  try {
    const { valgtLogoFil } = await import("./excel-logo.js");
    const fil = valgtLogoFil(); if (!fil) return null;
    const { hentLogoer, hentLogo: hent } = await import("./tegninger.js");
    const l = ((await hentLogoer()) || []).find(x => x.fil === fil);
    return l ? await hent(l.itemId) : null;
  } catch (_) { return null; }
}
function vis(tekst) {
  if (!loadingEl) return;
  if (!tekst) { loadingEl.classList.remove("open"); return; }
  if (loadingText) loadingText.textContent = tekst;
  loadingEl.classList.add("open");
}

// Svar: { ok, id, mappe, prosjekt } eller { ok:false, grunn }
export async function sendTilStormProsjekter() {
  if (pågår) return { ok: false, grunn: "pågår" };
  const C = await import("./compare.js");
  const k = C.sammenligningForEm();
  if (!k) { varsel(t("Kjør en sammenligning først.")); return { ok: false, grunn: "ingen" }; }
  pågår = true;
  const LR = await import("./legg-i-prosjekt-regn.js");
  const G = await import("./legg-i-prosjekt-graph.js");
  const sp = await import("./sharepoint.js");
  try {
    vis(t("Finner prosjektet …"));
    const token = await sp.spToken();
    if (!token) { varsel(t("Logg inn på SharePoint først.")); return { ok: false, grunn: "av" }; }
    const rader = await G.hentProsjekter(token);
    const å = åpenModell();
    let jobb = LR.finnJobb(rader, å);
    if (!jobb.length && S.prosjektInfo) jobb = LR.jobbForNummer(rader, (S.prosjektInfo() || {}).nummer);
    const valgt = LR.foreslåProsjekt(jobb, "sammenligning");
    if (!valgt) {
      varsel(t("Fant ikke jobben modellen hører til i Storm Prosjekter. Koble modellen til jobben der (Modell-feltet), eller skriv prosjektnummeret i Prosjektinfo."));
      return { ok: false, grunn: "ingen-prosjekt" };
    }
    const mappa = await G.prosjektmappe(token, valgt, rader);
    const id = SR.sammenligningId(new Date());
    const under = SR.UNDERMAPPE + "/" + id;
    const navnAv = (sp.innloggingNå().konto || {});
    const av = navnAv.name || navnAv.username || "";

    // --- bildene ---
    vis(t("Tar oversiktsbildet …"));
    const { fangstBilde } = await import("./scene.js");
    const ov = fangstBilde(1600, 1000);
    const R = await import("./em-regn.js");
    if (!S.akseLinjer && S.sikreAkseLinjer) { try { await S.sikreAkseLinjer(); } catch (_) { /* uten akser */ } }
    const toM = S.enhetSkala || 1;
    const linjer = R.mengdeDiff(k.res, { toM });
    const endringer = R.endringerFra(k.res, linjer, { toM, akser: S.akseLinjer });
    const { taEndringsbilder } = await import("./em-bilder.js");
    const bilder = [];
    for (let i = 0; i < endringer.length; i++) {
      vis(t("Tar bilder av endring {0} av {1} …", i + 1, endringer.length));
      let b = { for: null, etter: null };
      try { b = await taEndringsbilder(endringer[i], {}); } catch (err) { console.warn("Sammenligningsbildet feilet:", err); }
      bilder.push(b);
    }

    // --- sammenligning.json og PDF-en ---
    const felt = valgt.fields || {};
    const koblet = LR.lesModellFelt(felt.Modell);
    const { ifcNavnFra } = await import("./innebygd-regn.js");
    const modell = koblet && koblet.navn ? (koblet.type === "lett" ? ifcNavnFra(koblet.navn) : koblet.navn) : (å.ifc || k.til);
    const pdf = SR.pdfNavn(k.fra, k.til, new Date());
    const j = SR.byggJson({ id, fra: k.fra, til: k.til, modell, av, laget: new Date().toISOString(),
      manuell: !!(S.compareBase && S.compareBase.manuell), usikker: k.usikker, pdf,
      telling: { ny: k.res.ny.length, endret: k.res.endret.length, fjernet: k.res.slettet.length },
      endringer, bilder: bilder.map(b => ({ for: !!b.for, etter: !!b.etter })), toM, akser: S.akseLinjer,
      oversiktBilde: !!(ov && ov.data) });
    const feil = SR.sjekkJson(j);
    if (feil.length) throw new Error("sammenligning.json: " + feil.slice(0, 3).join(", "));
    vis(t("Lager PDF …"));
    const { hentJsPDF } = await import("./rapport.js");
    const { tegnSammenligning } = await import("./sammenligning-pdf.js");
    const jsPDF = await hentJsPDF();
    const logo = await hentLogo();
    const d = tegnSammenligning(jsPDF, j, { endringer, toM, akser: S.akseLinjer }, bilder,
      { logo, avsender: "", oversikt: ov && ov.data });
    const pdfBlob = d.output("blob");

    // --- opp i mappa: bildene, PDF-en, og JSON-en til sist ---
    const opp = async (navn, blob) => { vis(t("Laster opp {0} …", navn)); return G.lastOpp(token, mappa.sti, under, navn, blob); };
    if (ov && ov.data) await opp(SR.OVERSIKT_BILDE, tilBlob(ov.data));
    for (let i = 0; i < bilder.length; i++) {
      if (bilder[i].etter) await opp(SR.gruppeBilde(i, "etter"), tilBlob(bilder[i].etter));
      if (bilder[i].for) await opp(SR.gruppeBilde(i, "for"), tilBlob(bilder[i].for));
    }
    const pdfItem = await opp(pdf, pdfBlob);
    await opp(SR.JSON_FIL, new Blob([JSON.stringify(j, null, 1)], { type: "application/json" }));
    await G.oppdaterOversikt(token, mappa.sti, LR.oversiktPost({
      id: pdfItem && pdfItem.id, navn: pdf, type: "sammenligning", dato: LR.isoDato(), av,
      modell: SR.kortModellNavn(modell), mappe: "14 BIM og koordinering",
      url: (pdfItem && pdfItem.webUrl) || "", storrelse: (pdfItem && pdfItem.size) || pdfBlob.size, prosjekt: felt.Nokkel
    }));
    const pt = LR.prosjektTekst(valgt).split(" ").slice(0, 2).join(" ");
    varsel(t("Sendt til Storm Prosjekter: {0} → {1}. Vurder endringene der.", pt, "14 BIM og koordinering/Sammenligninger"),
      { visTekst: t("Åpne"), vis: () => window.open(LR.stormProsjekterLenke(felt.Nokkel), "_blank", "noopener") });
    return { ok: true, id, mappe: mappa.sti + "/" + under, prosjekt: felt.Nokkel, json: j };
  } catch (err) {
    const G2 = await import("./legg-i-prosjekt-graph.js");
    if (err instanceof G2.IngenMappe) varsel(t("Prosjektet har ingen mappe ennå – åpne det i Storm Prosjekter og trykk Mappe først."));
    else if (err instanceof G2.IngenTilgang) varsel(t("Du har ikke tilgang til prosjektmappa i Storm Prosjekter."));
    else varsel(t("Klarte ikke å sende sammenligningen: {0}", (err && err.message) || err));
    return { ok: false, grunn: "feil" };
  } finally { vis(""); pågår = false; }
}
