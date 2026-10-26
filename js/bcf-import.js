// 🔁 BCF-IMPORT — dialogen og det som legges inn (verktøy 7, runde 2,
// bygget 21.10.2026, Emils valg B: tre grupper og hva som endres).
//
// Lastes med import() fra rapportmenyen (ui.js), så kontoret ikke betaler for
// den før noen faktisk trykker. All regning ligger i js/bcf-les.js.
//
// Flyt: velg .bcfzip → lesZip → lesBcf → lagPlan → dialog med
//   • Nye markeringer (avkrysset)
//   • Finnes fra før — oppdateres (avkrysset; viser status/frist/ansvarlig/
//     tekst/+N kommentarer). Uendrede står grått og kan ikke velges.
//   • Finner ikke elementet (IKKE avkrysset — plasseres der BCF-kameraet så)
// → «Importer N valgte» → markeringene legges inn, bildene lastes opp til
// SharePoint, og hele importen er ÉN angre-post (Ctrl+Z).
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { controls } from "./scene.js";
import { allElementBoxes } from "./elements.js";
import { alleElementIder } from "./ifc.js";
import { sikreMeta } from "./ifcrpc.js";
import { bildeNavn, komprimer, lastOpp } from "./bilder.js";
import { MAKS_BCF_MB, fraIfc, lagPlan, lesBcf, lesZip, telPlan } from "./bcf-les.js";
import { ANSATTE } from "./config.js";
import { fjernImportertMarkering, lagreOgSynk, leggTilImportertMarkering, naaTekst, nyId,
         tegnMarkeringPaNytt, vaskMarkering, vaskSvar } from "./markers.js";

const FEILTEKST = {
  IKKE_ZIP: "Fila er ikke en gyldig .bcfzip.",
  ODELAGT_ZIP: "Fila er skadet og kan ikke leses.",
  ZIP64: "Fila er for stor til å leses her (ZIP64).",
  FOR_STOR: "Fila inneholder et bilde eller en del som er for stor."
};

// ---------- Kobling mot modellen ----------
// GlobalId → { id, navn }. Lett kopi (GLB) har GlobalId i S.glbProps
// ([navn, objectType, Ifc-type, materiale, GlobalId]); IFC har det i S.meta.
async function guidKart() {
  const kart = new Map();
  if (S.glbProps && S.glbProps.size) {
    for (const [id, p] of S.glbProps) if (p && p[4]) kart.set(String(p[4]), { id, navn: [p[2], p[0]].filter(Boolean).join(" · ") });
    return kart;
  }
  try { await sikreMeta(alleElementIder); } catch (_) {}
  for (const [id, m] of (S.meta || new Map())) if (m && m.globalId)
    kart.set(String(m.globalId), { id, navn: [m.typeName, m.name || m.objectType].filter(Boolean).join(" · ") });
  return kart;
}
let sisteKart = new Map();

function finnElementFn(kart) {
  let bokser = null;
  return (guid) => {
    if (!kart.has(guid)) return null;
    const id = kart.get(guid).id;
    try { bokser = bokser || allElementBoxes(); } catch (_) { bokser = new Map(); }
    const b = bokser.get(id);
    const senter = b && b.min && b.max
      ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 }
      : null;
    return { id, senter: senter || (controls && controls.target ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null) };
  };
}
const elementNavn = (globalId) => (sisteKart.get(globalId) || {}).navn || "";

export async function byggPlan(saker) {
  const skala = S.enhetSkala || 1;
  sisteKart = await guidKart();
  return lagPlan(saker, {
    markeringer: S.comments || [],
    ansatte: ANSATTE,
    finnElement: finnElementFn(sisteKart),
    tilVisning: (P) => fraIfc(P, skala, S.koteMatrixInv && S.koteMatrixInv.elements),
    standardPunkt: controls && controls.target ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null,
    avstand: Math.max((Number(S.modelSize) || 20) * skala * 0.08, 3) * 1.06,
    nyId
  });
}

// ---------- Dialogen ----------
const datoKort = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? m[3] + "." + m[2] : ""; };
const datoVis = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? m[3] + "." + m[2] + "." + m[1] : t("ingen"); };

function detaljNy(p) {
  const c = p.markering, s = p.sak;
  const deler = [];
  if (c.globalId) deler.push(esc(elementNavn(c.globalId) || c.globalId));
  deler.push(esc(t(c.status)));
  if (c.owner) deler.push(esc(c.owner));
  if (c.due) deler.push(esc(t("frist {0}", datoKort(c.due))));
  if (s.snapshot) deler.push(esc(t("1 bilde")));
  if ((c.svar || []).length) deler.push(esc(t("{0} kommentarer", c.svar.length)));
  return deler.join(" · ");
}
function detaljOppdater(p) {
  if (p.art === "uendret") return esc(t("Ingen endringer — står som i fila."));
  return p.endringer.map(e => {
    if (e.felt === "status") return esc(t("Status")) + ' <s>' + esc(t(e.fra)) + '</s> → <i>' + esc(t(e.til)) + '</i>';
    if (e.felt === "frist") return esc(t("frist")) + ' <s>' + esc(datoVis(e.fra)) + '</s> → <i>' + esc(datoVis(e.til)) + '</i>';
    // Tekst og ansvarlig overskrives aldri (valg B, 26.10) — det står i diffen
    if (e.felt === "tekst-notat") return '<i>' + esc(t("ny beskrivelse legges som kommentar")) + '</i>';
    if (e.felt === "ansvarlig-notat") return '<i>' + esc(t("ansvarlig «{0}» legges som kommentar", e.til)) + '</i>';
    if (e.felt === "kommentarer") return '<i>' + esc(t("+{0} kommentarer", e.antall)) + '</i>';
    return "";
  }).filter(Boolean).join(" · ");
}
function detaljFinnerIkke(p) {
  const s = p.sak;
  const hvor = p.plassering === "kamera" ? t("plasseres der BCF-kameraet så på.") : t("plasseres midt i visningen.");
  return s.ifcGuid
    ? esc(t("GUID {0} finnes ikke i denne modellen — {1}", s.ifcGuid, hvor))
    : esc(t("Saken peker ikke på noe element — {0}", hvor));
}

const GRUPPER = [
  { arter: ["ny"], merke: "ny", merkeTekst: "Ny", tittel: "Nye markeringer", detalj: detaljNy },
  { arter: ["oppdater", "uendret"], merke: "opp", merkeTekst: "Oppdateres", tittel: "Finnes fra før — oppdateres", detalj: detaljOppdater },
  { arter: ["finner-ikke"], merke: "finn", merkeTekst: "Finner ikke elementet", tittel: "", detalj: detaljFinnerIkke }
];

export function dialogHtml(filnavn, versjon, plan, feil) {
  const ant = plan.length;
  let html = '<div class="bcfi-dlg" role="dialog" aria-modal="true">' +
    '<header>' + ikon("markeringer") + '<b>' + esc(t("BCF-import")) + '</b><span class="bcfi-fil">' +
      esc(filnavn) + (versjon ? " · BCF " + esc(versjon) : "") + " · " + esc(t("{0} saker", ant)) + '</span>' +
      '<button class="bcfi-x" title="' + esc(t("Lukk")) + '">' + ikon("lukk") + '</button></header><div class="bcfi-bd">';
  if (!ant) html += '<p class="bcfi-tom">' + esc(t("Fant ingen saker i fila.")) + '</p>';
  for (const g of GRUPPER) {
    const rader = plan.map((p, i) => [p, i]).filter(([p]) => g.arter.includes(p.art));
    if (!rader.length) continue;
    const valgt = rader.filter(([p]) => p.valgt).length;
    const velgbare = rader.filter(([p]) => p.art !== "uendret").length;
    html += '<section class="bcfi-grp" data-grp="' + g.merke + '"><h4>' +
      '<span class="bcfi-merke ' + g.merke + '">' + (g.merke === "finn" ? ikon("advarsel") + " " : "") + esc(t(g.merkeTekst)) + '</span>' +
      (g.tittel ? '<span>' + esc(t(g.tittel)) + '</span>' : "") +
      '<span class="bcfi-n">' + esc(t("{0} av {1} valgt", valgt, velgbare)) + '</span></h4>' +
      rader.map(([p, i]) => '<label class="bcfi-rad' + (p.art === "uendret" ? " av" : "") + '">' +
        '<input type="checkbox" data-i="' + i + '"' + (p.valgt ? " checked" : "") + (p.art === "uendret" ? " disabled" : "") + '>' +
        '<div><b>' + esc(String(p.sak.tittel || (p.markering && p.markering.text) || "BCF").split("\n")[0]) + '</b>' +
        '<div class="bcfi-diff">' + g.detalj(p) + '</div></div></label>').join("") +
      '</section>';
  }
  if (feil && feil.length) html += '<p class="bcfi-feil">' + ikon("advarsel") + ' ' +
    esc(t("{0} saker i fila kunne ikke leses og er hoppet over.", feil.length)) + '</p>';
  const n = telPlan(plan).valgt;
  html += '</div><footer><span class="bcfi-inf">' + esc(t("Teksten og ansvarlig i Storm overskrives aldri. Hele importen kan angres med Ctrl+Z.")) + '</span>' +
    '<button class="bcfi-avbryt">' + esc(t("Avbryt")) + '</button>' +
    '<button class="primary bcfi-ok"' + (n ? "" : " disabled") + '>' + esc(t("Importer {0} valgte", n)) + '</button></footer></div>';
  return html;
}

function lukk() { const el = $("bcfImport"); if (el) el.remove(); }

function visDialog(filnavn, les, plan) {
  lukk();
  const el = document.createElement("div");
  el.id = "bcfImport";
  document.body.appendChild(el);
  const tegn = () => {
    el.innerHTML = dialogHtml(filnavn, les.versjon, plan, les.feil);
    el.querySelectorAll("input[data-i]").forEach(cb => {
      cb.onchange = () => { plan[Number(cb.dataset.i)].valgt = cb.checked; tegn(); };
    });
    el.querySelector(".bcfi-x").onclick = lukk;
    el.querySelector(".bcfi-avbryt").onclick = lukk;
    el.querySelector(".bcfi-ok").onclick = () => { lukk(); importer(plan); };
  };
  tegn();
  el.addEventListener("pointerdown", (e) => { if (e.target === el) lukk(); });
}

// ---------- Leggingen ----------
const klon = (o) => JSON.parse(JSON.stringify(o));
function settTil(c, data) {
  for (const k of Object.keys(c)) if (!(k in data)) delete c[k];
  Object.assign(c, klon(data));
  tegnMarkeringPaNytt(c);
}

export async function importer(plan) {
  const valgte = (plan || []).filter(p => p.valgt && p.art !== "uendret");
  const nye = [], oppd = [];
  for (const p of valgte) {
    if (p.markering) {
      const c = vaskMarkering(p.markering);
      if (!c) continue;
      leggTilImportertMarkering(c);
      nye.push({ c, sak: p.sak });
    } else if (p.mål) {
      const c = (S.comments || []).find(x => x.id == p.mål.id) || p.mål;
      const for_ = klon(c);
      Object.assign(c, p.patch);
      const svar = (p.nyeSvar || []).map(vaskSvar).filter(Boolean)
        .filter(s => !(c.svar || []).some(x => String(x.id) === s.id));
      if (svar.length) c.svar = (c.svar || []).concat(svar);
      // Synlig i topplinja av bobla: «(endret av BCF-import 26.10.2026, 09:12)»
      c.endret = naaTekst(); c.endretAv = "BCF-import";
      tegnMarkeringPaNytt(c);
      oppd.push({ c, for_, etter: klon(c) });
    }
  }
  if (!nye.length && !oppd.length) return { nye: 0, oppdatert: 0, bilder: 0 };
  lagreOgSynk();

  // Bildene fra BCF-fila → SharePoint, som et Før-bilde på den nye markeringen.
  // Feiler det (ikke innlogget, nett), står markeringen likevel.
  let bilder = 0, bildeFeil = 0;
  for (const { c, sak } of nye) {
    if (!sak.snapshot) continue;
    try {
      const type = /\.png$/i.test(sak.snapshotNavn) ? "image/png" : "image/jpeg";
      const blob = await komprimer(new File([sak.snapshot], sak.snapshotNavn || "snapshot.png", { type }));
      const navn = bildeNavn(c.id, 1);
      await lastOpp(blob, navn);
      const x = (S.comments || []).find(m => m.id == c.id) || c;
      x.bilder = (x.bilder || []).concat(navn);
      bilder++;
    } catch (err) { bildeFeil++; console.warn("BCF-bilde ble ikke lastet opp:", err.message); }
  }
  if (bilder) lagreOgSynk();

  if (S.pushAngre) S.pushAngre({
    tekst: "BCF-import",
    angre: () => {
      nye.forEach(({ c }) => fjernImportertMarkering(c.id));
      oppd.forEach(({ c, for_ }) => settTil((S.comments || []).find(x => x.id == c.id) || c, for_));
      lagreOgSynk();
    },
    gjenopprett: () => {
      nye.forEach(({ c }) => { if (!(S.comments || []).some(x => x.id == c.id)) leggTilImportertMarkering(c); });
      oppd.forEach(({ c, etter }) => settTil((S.comments || []).find(x => x.id == c.id) || c, etter));
      lagreOgSynk();
    }
  });

  varsel(t("BCF-import: {0} nye markeringer, {1} oppdatert.", nye.length, oppd.length) +
    (bildeFeil ? " " + t("{0} bilder ble ikke lastet opp (logg inn for å dele bilder).", bildeFeil) : ""));
  return { nye: nye.length, oppdatert: oppd.length, bilder };
}

// ---------- Inngangen ----------
export async function lesBcfFil(fil) {
  if (!fil) return null;
  if (fil.size > MAKS_BCF_MB * 1024 * 1024) throw new Error(t("Fila er større enn {0} MB.", MAKS_BCF_MB));
  let filer;
  try { filer = await lesZip(new Uint8Array(await fil.arrayBuffer())); }
  catch (err) { throw new Error(t(FEILTEKST[err.message] || "Fila er ikke en gyldig .bcfzip.")); }
  return lesBcf(filer);
}

export async function apneFil(fil) {
  try {
    const les = await lesBcfFil(fil);
    if (!les) return;
    const plan = await byggPlan(les.saker);
    visDialog(fil.name || "BCF", les, plan);
    return plan;
  } catch (err) {
    varsel(t("Klarte ikke å lese BCF-fila: {0}", err.message));
  }
}

export function startBcfImport() {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".bcfzip,.bcf,.zip";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) apneFil(f); };
  inp.click();
}
