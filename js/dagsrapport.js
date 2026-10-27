// 📋 DAGSRAPPORT — dialogen (Emil 27.10.2026, prøvebilde C).
//
// Tredje valg i Rapport-menyen («Fullstendig» · «Byggemøte» · «Dagsrapport»).
// BARE kontorsiden: bygg.html viser ikke Rapport-menyen, og Workeren vet ikke
// at dagsrapportene finnes.
//
//   • Uke-stripe øverst: man–søn med «levert», «utkast», «mangler» og «i dag».
//     Pilene blar uke. Trykk på en dag for å se, laste ned eller lage ny versjon.
//   • Skjemaet: vær (hentes automatisk), bemanning (firma · fag · antall ·
//     timer, «samme som i går»), utført arbeid, hindringer og avvik, bilder fra
//     PC-en og dagens markeringer (avkrysning).
//   • «Lagre utkast», «Signer og lag PDF» (låser rapporten) og «Hele uka som PDF».
//   • En signert rapport kan ikke endres. «Ny versjon» lager en kopi som ikke er
//     signert; den gamle blir liggende i SharePoint. Ingenting slettes.
//
// Lagring: SharePoint-mappa «Dagsrapporter» — én JSON per prosjekt
// (sp-lager.js, fletting på id) og bildene + PDF-ene som egne filer.
// Regningen ligger i js/dagsrapport-regn.js, PDF-en i js/dagsrapport-pdf.js.
import { $, S, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { spLastOpp, spLes, spLesBin, spSkriv, spSkrivBin } from "./sp-lager.js";
import { innloggetNavn, naaTekst } from "./markers.js";
import { bePåSignatur } from "./sjekkliste.js";
import { hentJsPDF, lastNedFil } from "./rapport.js";
import { dagData, posisjon } from "./vaer-felles.js";
import { dagnavn, datoLang, iDagISO, leggTilDager, lokal } from "./vaer-regn.js";
import { tegnDagsrapport } from "./dagsrapport-pdf.js";
import * as R from "./dagsrapport-regn.js";

export const DR_MAPPE = "Dagsrapporter";
const MAKS_BILDE_BYTES = 1.5e6;
const VAER_IKON = { sol: "☀️", delvis: "⛅", sky: "☁️", taake: "🌫️", regn: "🌧️", sludd: "🌨️", sno: "❄️", storm: "⛈️" };

const tilstand = {
  mandag: "", valgt: "", liste: [], status: "", rapport: null, lagret: null,
  bildeData: new Map(),        // fil → data-URL (hentet eller nettopp lagt til)
  ulagredeBilder: new Set(),   // fil-navn som ikke er lastet opp ennå
  vaerStatus: "", o: {}
};
export const _tilstand = tilstand;   // testene

// ---------- Prosjektet ----------
function prosjekt() {
  const pi = S.prosjektInfo ? S.prosjektInfo() : {};
  return { nr: (pi && pi.nummer) || S.lettProsjekt || "", navn: (pi && pi.navn) || "", modell: S.fileName || "" };
}
const fil = () => R.rapportFil(prosjekt().nr, prosjekt().modell);
const lokalDato = (iso) => { const l = lokal(iso); return l ? l.dato : ""; };
const DAG_LANG = () => ({ man: t("mandag"), tir: t("tirsdag"), ons: t("onsdag"), tor: t("torsdag"), fre: t("fredag"), "lør": t("lørdag"), "søn": t("søndag") });
const DAG_KORT = () => ({ man: t("man"), tir: t("tir"), ons: t("ons"), tor: t("tor"), fre: t("fre"), "lør": t("lør"), "søn": t("søn") });
const dagLang = (d) => DAG_LANG()[dagnavn(d)] + " " + datoLang(d);
const dagKort = (d) => DAG_KORT()[dagnavn(d)] + " " + d.slice(8) + "." + d.slice(5, 7);

// ---------- SharePoint ----------
async function lesListe() {
  const r = await spLes(DR_MAPPE, fil());
  tilstand.status = r.status;
  tilstand.liste = (r.liste || []).map(R.vaskRapport).filter(Boolean);
}
async function lagrePost(post) {
  const p = R.vaskRapport(post);
  const r = await spSkriv(DR_MAPPE, fil(), [p], (x) => String(x && x.id || ""));
  if (r.ok) tilstand.liste = (r.liste || []).map(R.vaskRapport).filter(Boolean);
  return r;
}
function dataUrlTilBytes(u) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(u || ""));
  if (!m) return null;
  const bin = atob(m[2]), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function hentBilde(navn) {
  if (tilstand.bildeData.has(navn)) return tilstand.bildeData.get(navn);
  const r = await spLesBin(DR_MAPPE, navn);
  if (r.status !== "ok" || !r.data) return null;
  const a = new Uint8Array(r.data);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  const data = "data:image/jpeg;base64," + btoa(s);
  tilstand.bildeData.set(navn, data);
  return data;
}
async function lastOppNyeBilder(rapport) {
  for (const b of rapport.bilder) {
    if (!tilstand.ulagredeBilder.has(b.fil)) continue;
    const bytes = dataUrlTilBytes(tilstand.bildeData.get(b.fil));
    if (!bytes) continue;
    const r = await spSkrivBin(DR_MAPPE, b.fil, bytes, "image/jpeg");
    if (!r.ok) return false;
    tilstand.ulagredeBilder.delete(b.fil);
  }
  return true;
}

// ---------- Været ----------
async function hentVaer(rapport) {
  const k = posisjon();
  if (!k) { tilstand.vaerStatus = "ingen-posisjon"; return; }
  tilstand.vaerStatus = "laster"; tegn();
  try {
    const dag = await dagData(k, rapport.dato);
    const v = R.vaerFraSum(dag.sum, dag.kilde);
    // Bare hvis rapporten fortsatt er den som vises og ikke er låst
    if (tilstand.rapport === rapport && !R.erLaast(rapport)) rapport.vaer = v;
    tilstand.vaerStatus = v ? "" : "ingen-data";
  } catch (_) { tilstand.vaerStatus = "feil"; }
  tegn();
}

// ---------- Velg dag ----------
function harEndringer() {
  const r = tilstand.rapport;
  return !!(r && !R.erLaast(r) && !R.likeRapporter(r, tilstand.lagret));
}
function velgDag(d, tving) {
  if (!tving && d !== tilstand.valgt && harEndringer() &&
      !confirm(t("Du har endringer som ikke er lagret. Bytte dag likevel?"))) return;
  tilstand.valgt = d;
  tilstand.mandag = R.mandagFor(d);
  const g = R.gjeldende(tilstand.liste).get(d);
  const p = prosjekt();
  tilstand.rapport = g ? R.vaskRapport(JSON.parse(JSON.stringify(g)))
    : R.nyRapport(d, { prosjekt: p.nr, prosjektNavn: p.navn, modell: p.modell });
  tilstand.lagret = g ? R.vaskRapport(JSON.parse(JSON.stringify(g))) : R.vaskRapport(JSON.parse(JSON.stringify(tilstand.rapport)));
  tilstand.vaerStatus = "";
  if (!R.erLaast(tilstand.rapport)) {
    oppdaterMarkeringer();
    if (!tilstand.rapport.vaer) hentVaer(tilstand.rapport);
  }
  tegn();
  // Bildene hentes i bakgrunnen og vises når de kommer
  for (const b of tilstand.rapport.bilder) if (!tilstand.bildeData.has(b.fil)) hentBilde(b.fil).then(() => tegn());
}
function oppdaterMarkeringer() {
  const r = tilstand.rapport;
  if (!r || R.erLaast(r)) return;
  r.markeringer = R.dagensMarkeringer(S.comments || [], r.dato, lokalDato);
}

// ---------- HTML ----------
function stripeHtml() {
  const iDag = iDagISO();
  const st = R.ukeStatus(tilstand.liste, tilstand.mandag, iDag);
  const tell = R.ukeTelling(st);
  const u = R.ukeNr(tilstand.mandag);
  const forrige = R.ukeTelling(R.ukeStatus(tilstand.liste, leggTilDager(tilstand.mandag, -7), iDag));
  const kort = DAG_KORT();
  const merke = { levert: t("levert"), utkast: t("utkast"), mangler: t("mangler"), idag: t("i dag"), fremtid: "", helg: "" };
  let sammendrag;
  if (tell.mangler) sammendrag = '<span class="dr-rod">' + esc(tell.mangler === 1 ? t("1 dag mangler denne uka") : t("{0} dager mangler denne uka", tell.mangler)) + '</span>';
  else if (tell.arbeidsdager && tell.levert >= tell.arbeidsdager) sammendrag = '<span class="dr-gronn">' + esc(t("Alle arbeidsdager levert")) + '</span>';
  else sammendrag = esc(t("{0} av {1} arbeidsdager levert", tell.levert, tell.arbeidsdager));
  return '<div class="dr-ukelinje"><button class="dr-uke-pil" data-uke="-1" title="' + esc(t("Forrige uke")) + '">' + ikon("forrige") + '</button>' +
    '<b>' + esc(t("Uke {0}", u.uke)) + '</b>' +
    '<button class="dr-uke-pil" data-uke="1" title="' + esc(t("Neste uke")) + '">' + ikon("neste") + '</button>' +
    (tilstand.mandag !== R.mandagFor(iDag) ? '<button class="dr-idag">' + esc(t("I dag")) + '</button>' : "") +
    '<span class="dr-sammendrag">' + sammendrag + '</span></div>' +
    '<div class="dr-uke">' + st.map(s => '<button class="dr-dag ' + s.status + (s.dato === tilstand.valgt ? " valgt" : "") +
      (R.erHelg(s.dato) ? " helg" : "") + '" data-dato="' + s.dato + '"' + (s.status === "fremtid" ? " disabled" : "") + '>' +
      '<span>' + esc(kort[s.dag]) + '</span><b>' + s.dagNr + '</b><i>' + esc(s.iDag && !s.rapport ? merke.idag : merke[s.status]) + '</i></button>').join("") + '</div>' +
    '<div class="dr-hint">' + esc(t("Forrige uke: {0} av {1}", forrige.levert, forrige.arbeidsdager)) + ' · ' +
      esc(t("Trykk på en dag for å se, laste ned eller lage ny versjon.")) + '</div>';
}

function vaerHtml(r) {
  const v = r.vaer;
  let innhold;
  if (v) {
    innhold = '<span class="dr-vaer-ikon">' + (VAER_IKON[v.bilde] || "🌡️") + '</span><span>' + esc(R.vaerTekst(v)) + '</span>' +
      R.vaerMerker(v).map(m => '<span class="dr-tag ' + m.niva + '">' + esc(t(m.tekst)) + '</span>').join("");
  } else {
    const tekst = { laster: t("Henter været …"), "ingen-posisjon": t("Ingen posisjon — legg inn adresse i Prosjektinfo for å få været."),
      "ingen-data": t("Ingen værdata for denne dagen."), feil: t("Klarte ikke å hente været.") }[tilstand.vaerStatus] || t("Henter været …");
    innhold = '<span class="dr-gra">' + esc(tekst) + '</span>';
  }
  const kilde = v && v.kilde === "maalt" ? t("målt") : v ? t("varsel") : "";
  return '<div class="dr-felt"><div class="dr-lbl">' + esc(t("Vær")) + '<span class="dr-auto">● ' + esc(t("hentet automatisk")) + (kilde ? " · " + esc(kilde) : "") + '</span>' +
    (!R.erLaast(r) && posisjon() ? '<button class="dr-lenke dr-vaer-ny">' + esc(t("Hent på nytt")) + '</button>' : "") + '</div>' +
    '<div class="dr-vaer">' + innhold + '</div></div>';
}

function bemanningHtml(r, laast) {
  const sum = R.bemanningSum(r.bemanning);
  const forrige = laast ? null : R.forrigeBemanning(tilstand.liste, r.dato);
  const rad = (b, i) => laast
    ? '<tr><td>' + esc(b.firma) + '</td><td>' + esc(t(b.fag) || b.fag) + '</td><td class="tall">' + esc(b.antall == null ? "" : b.antall) + '</td><td class="tall">' + esc(b.timer == null ? "" : String(b.timer).replace(".", ",")) + '</td><td></td></tr>'
    : '<tr><td><input data-bm="' + i + '" data-k="firma" list="drFirma" value="' + esc(b.firma) + '" placeholder="' + esc(t("Firma")) + '"></td>' +
      '<td><input data-bm="' + i + '" data-k="fag" list="drFag" value="' + esc(b.fag) + '" placeholder="' + esc(t("Fag")) + '"></td>' +
      '<td><input data-bm="' + i + '" data-k="antall" type="number" min="0" step="1" value="' + esc(b.antall == null ? "" : b.antall) + '"></td>' +
      '<td><input data-bm="' + i + '" data-k="timer" type="number" min="0" step="0.5" value="' + esc(b.timer == null ? "" : b.timer) + '"></td>' +
      '<td><button class="dr-x" data-bm-fjern="' + i + '" title="' + esc(t("Fjern raden")) + '">' + ikon("lukk") + '</button></td></tr>';
  return '<div class="dr-felt"><div class="dr-lbl">' + esc(t("Bemanning")) +
    (!laast ? '<span class="dr-knapper">' + (forrige ? '<button class="dr-lenke dr-bm-igaar" title="' + esc(dagLang(forrige.dato)) + '">↺ ' + esc(t("samme som sist ({0})", dagKort(forrige.dato))) + '</button>' : "") +
      '<button class="dr-lenke dr-bm-ny">+ ' + esc(t("legg til firma")) + '</button></span>' : "") + '</div>' +
    '<table class="dr-bm"><thead><tr><th>' + esc(t("Firma")) + '</th><th>' + esc(t("Fag")) + '</th><th class="tall">' + esc(t("Antall")) + '</th><th class="tall">' + esc(t("Timer")) + '</th><th></th></tr></thead><tbody>' +
    (r.bemanning.length ? r.bemanning.map(rad).join("") : '<tr><td colspan="5" class="dr-gra">' + esc(t("Ingen rader ennå.")) + '</td></tr>') +
    '</tbody>' + (r.bemanning.length ? '<tfoot><tr><td>' + esc(t("Sum")) + '</td><td></td><td class="tall">' + sum.antall + '</td><td class="tall">' + String(sum.timer).replace(".", ",") + '</td><td></td></tr></tfoot>' : "") + '</table></div>';
}

function tekstfelt(r, k, navn, plass, laast) {
  return '<div class="dr-felt"><div class="dr-lbl">' + esc(navn) + '</div>' +
    (laast ? '<div class="dr-les">' + (esc(r[k]) || '<span class="dr-gra">' + esc(t("Ikke fylt ut.")) + '</span>') + '</div>'
      : '<textarea data-tekst="' + k + '" rows="3" placeholder="' + esc(plass) + '">' + esc(r[k]) + '</textarea>') + '</div>';
}

function bilderHtml(r, laast) {
  const kort = r.bilder.map((b, i) => {
    const data = tilstand.bildeData.get(b.fil);
    return '<div class="dr-bilde">' + (data ? '<img src="' + esc(data) + '" alt="">' : '<div class="dr-bilde-laster">' + esc(t("Henter …")) + '</div>') +
      (laast ? '<span>' + esc(b.tekst) + '</span>'
        : '<input data-bt="' + i + '" value="' + esc(b.tekst) + '" placeholder="' + esc(t("Bildetekst")) + '">' +
          '<button class="dr-x dr-bilde-x" data-bfjern="' + i + '" title="' + esc(t("Fjern bildet fra rapporten")) + '">' + ikon("lukk") + '</button>') + '</div>';
  }).join("");
  if (laast && !r.bilder.length) return "";
  return '<div class="dr-felt"><div class="dr-lbl">' + esc(t("Bilder")) + (r.bilder.length ? ' <span class="dr-gra">(' + r.bilder.length + ')</span>' : "") +
    (!laast && r.bilder.length < R.MAKS_BILDER ? '<label class="dr-lenke">+ ' + esc(t("legg til bilder")) + '<input type="file" id="drBildeFil" accept="image/*" multiple hidden></label>' : "") + '</div>' +
    (r.bilder.length ? '<div class="dr-bilder">' + kort + '</div>' : '<div class="dr-gra dr-liten">' + esc(t("Ingen bilder. Bildene kommer med i PDF-en, to i bredden.")) + '</div>') + '</div>';
}

function markeringerHtml(r, laast) {
  const n = r.markeringer.length;
  const liste = r.medMarkeringer && n ? '<div class="dr-merk">' + r.markeringer.slice(0, 6).map(m =>
    '<div><span class="dr-dot s-' + esc(m.status) + '"></span>' + esc(m.tekst) + (m.hva === "svar" ? ' <span class="dr-gra">· ' + esc(t("nytt svar")) + '</span>' : "") + '</div>').join("") +
    (n > 6 ? '<div class="dr-gra">' + esc(t("+ {0} til", n - 6)) + '</div>' : "") + '</div>' : "";
  return '<div class="dr-felt"><label class="dr-avkryss"><input type="checkbox" id="drMedMerk"' + (r.medMarkeringer ? " checked" : "") + (laast ? " disabled" : "") + '> ' +
    esc(t("Ta med dagens markeringer ({0})", n)) + '</label>' + liste + '</div>';
}

function dialogHtml() {
  const r = tilstand.rapport, laast = R.erLaast(r), p = prosjekt();
  const versjoner = R.versjonerFor(tilstand.liste, r.dato);
  const lagringTekst = {
    av: t("Ikke innlogget — rapporten kan lastes ned, men ikke lagres."),
    feil: t("Klarte ikke å lese dagsrapportene fra SharePoint. Prøv igjen før du lagrer."),
    laster: t("Henter dagsrapportene …")
  }[tilstand.status] || t("Lagres i SharePoint: Dagsrapporter");
  let banner = "";
  if (laast) banner = '<div class="dr-laast">' + ikon("laas") + '<div><b>' + esc(t("Signert av {0}", r.signert.navn)) + '</b> · ' + esc(r.signert.tid) +
    '<div class="dr-gra">' + esc(t("Rapporten er låst. Trykk «Ny versjon» for å endre — den signerte blir liggende.")) + '</div></div></div>';
  else if (r.versjon > 1) banner = '<div class="dr-info">' + esc(t("Versjon {0} — ikke signert ennå. Versjon {1} er signert og blir liggende.", r.versjon, r.versjon - 1)) + '</div>';
  const versjonsvalg = versjoner.length > 1 ? '<select id="drVersjon">' + versjoner.map(v => '<option value="' + esc(v.id) + '"' + (v.id === r.id ? " selected" : "") + '>' +
    esc(t("Versjon {0}", v.versjon) + (v.signert ? " · " + t("signert") : " · " + t("utkast"))) + '</option>').join("") + '</select>' : "";
  return '<div class="dr-dlg" role="dialog" aria-modal="true">' +
    '<header>' + ikon("tegning") + '<b>' + esc(t("Dagsrapport")) + '</b><span class="dr-prosjekt">' + esc([p.nr, p.navn].filter(Boolean).join(" ") || p.modell) + '</span>' +
      '<button class="dr-lukk" title="' + esc(t("Lukk")) + '">' + ikon("lukk") + '</button></header>' +
    '<div class="dr-bd">' + stripeHtml() +
      '<div class="dr-dagtittel"><b>' + esc(dagLang(r.dato).replace(/^./, (c) => c.toUpperCase())) + '</b>' +
        '<span class="dr-gra">' + esc(t("nr. {0}", R.lopenr(tilstand.liste, r.dato))) + '</span>' + versjonsvalg + '</div>' +
      banner + vaerHtml(r) + bemanningHtml(r, laast) +
      tekstfelt(r, "utfort", t("Utført arbeid"), t("Hva ble gjort i dag? F.eks. «Støpt dekke akse C–D, 42 m³»"), laast) +
      tekstfelt(r, "hindringer", t("Hindringer og avvik"), t("Hva stoppet eller forsinket arbeidet? Skriv «Ingen» hvis alt gikk som planlagt."), laast) +
      bilderHtml(r, laast) + markeringerHtml(r, laast) +
      '<datalist id="drFirma">' + R.tidligereFirma(tilstand.liste).concat(["Storm Betong AS", "Storm Stål AS", "Storm Entreprenør AS"])
        .filter((x, i, a) => a.indexOf(x) === i).map(f => '<option value="' + esc(f) + '">').join("") + '</datalist>' +
      '<datalist id="drFag">' + R.FAG_FORSLAG.map(f => '<option value="' + esc(t(f)) + '">').join("") + '</datalist>' +
    '</div><footer><span class="dr-inf">' + esc(lagringTekst) + '</span>' +
      '<button class="dr-uke-pdf">' + ikon("lastned") + ' ' + esc(t("Hele uka som PDF")) + '</button>' +
      (laast ? '<button class="dr-nyversjon">' + esc(t("Ny versjon")) + '</button><button class="primary dr-pdf">' + ikon("lastned") + ' ' + esc(t("Last ned PDF")) + '</button>'
        : '<button class="dr-lagre"' + (tilstand.status === "ok" || tilstand.status === "tom" ? "" : " disabled") + '>' + esc(t("Lagre utkast")) + '</button>' +
          '<button class="primary dr-signer">' + ikon("hake") + ' ' + esc(t("Signer og lag PDF")) + '</button>') +
    '</footer></div>';
}

// ---------- Tegning og lyttere ----------
function tegn() {
  const el = $("dagsrapport");
  if (!el || !tilstand.rapport) return;
  // Behold rulleposisjonen og fokus når dialogen tegnes på nytt
  const bd = el.querySelector(".dr-bd"), rull = bd ? bd.scrollTop : 0;
  const fokus = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const fokusSel = fokus ? (fokus.dataset.bm != null ? '[data-bm="' + fokus.dataset.bm + '"][data-k="' + fokus.dataset.k + '"]'
    : fokus.dataset.tekst ? '[data-tekst="' + fokus.dataset.tekst + '"]' : fokus.dataset.bt != null ? '[data-bt="' + fokus.dataset.bt + '"]' : "") : "";
  el.innerHTML = dialogHtml();
  const nyBd = el.querySelector(".dr-bd"); if (nyBd) nyBd.scrollTop = rull;
  if (fokusSel) { const f = el.querySelector(fokusSel); if (f) { f.focus(); try { const n = f.value.length; f.setSelectionRange && f.type !== "number" && f.setSelectionRange(n, n); } catch (_) {} } }
  kobleLyttere(el);
}

function kobleLyttere(el) {
  const r = tilstand.rapport;
  const q = (s) => el.querySelector(s), qa = (s) => el.querySelectorAll(s);
  q(".dr-lukk").onclick = lukk;
  qa(".dr-uke-pil").forEach(b => b.onclick = () => {
    const ny = leggTilDager(tilstand.mandag, 7 * Number(b.dataset.uke));
    // Ny uke: velg samme ukedag, men aldri en dag i framtiden
    const dag = leggTilDager(ny, R.ukeStatus([], tilstand.mandag, tilstand.valgt).findIndex(s => s.dato === tilstand.valgt));
    velgDag(dag > iDagISO() ? iDagISO() : dag);
  });
  const idag = q(".dr-idag"); if (idag) idag.onclick = () => velgDag(iDagISO());
  qa(".dr-dag").forEach(b => b.onclick = () => velgDag(b.dataset.dato));
  const vsel = q("#drVersjon");
  if (vsel) vsel.onchange = () => {
    const v = tilstand.liste.find(x => x.id === vsel.value);
    if (!v) return;
    if (harEndringer() && !confirm(t("Du har endringer som ikke er lagret. Bytte dag likevel?"))) { vsel.value = r.id; return; }
    tilstand.rapport = R.vaskRapport(JSON.parse(JSON.stringify(v)));
    tilstand.lagret = R.vaskRapport(JSON.parse(JSON.stringify(v)));
    for (const b of tilstand.rapport.bilder) if (!tilstand.bildeData.has(b.fil)) hentBilde(b.fil).then(() => tegn());
    tegn();
  };
  const vny = q(".dr-vaer-ny"); if (vny) vny.onclick = () => { r.vaer = null; hentVaer(r); };
  if (R.erLaast(r)) {
    q(".dr-nyversjon").onclick = () => {
      tilstand.rapport = R.nyVersjon(r, tilstand.liste);
      oppdaterMarkeringer();
      tegn();
    };
    q(".dr-pdf").onclick = () => lagPdf([tilstand.rapport], null);
  } else {
    // Bemanning
    qa("[data-bm]").forEach(inp => inp.oninput = () => {
      const b = r.bemanning[Number(inp.dataset.bm)]; if (!b) return;
      const k = inp.dataset.k;
      b[k] = (k === "antall" || k === "timer") ? (inp.value === "" ? null : Math.max(0, Number(inp.value) || 0)) : inp.value.slice(0, k === "fag" ? 40 : 80);
      const sum = R.bemanningSum(r.bemanning), fot = el.querySelector(".dr-bm tfoot");
      if (fot) fot.innerHTML = '<tr><td>' + esc(t("Sum")) + '</td><td></td><td class="tall">' + sum.antall + '</td><td class="tall">' + String(sum.timer).replace(".", ",") + '</td><td></td></tr>';
    });
    qa("[data-bm-fjern]").forEach(b => b.onclick = () => { r.bemanning.splice(Number(b.dataset.bmFjern), 1); tegn(); });
    q(".dr-bm-ny").onclick = () => {
      if (r.bemanning.length >= R.MAKS_BEMANNING) return;
      r.bemanning.push({ firma: "", fag: "", antall: null, timer: null }); tegn();
      const inp = el.querySelector('[data-bm="' + (r.bemanning.length - 1) + '"][data-k="firma"]'); if (inp) inp.focus();
    };
    const igaar = q(".dr-bm-igaar");
    if (igaar) igaar.onclick = () => {
      const f = R.forrigeBemanning(tilstand.liste, r.dato);
      if (!f) return;
      if (r.bemanning.length && !confirm(t("Erstatte bemanningen med den fra {0}?", dagLang(f.dato)))) return;
      r.bemanning = f.rader; tegn();
    };
    qa("[data-tekst]").forEach(ta => ta.oninput = () => { r[ta.dataset.tekst] = ta.value.slice(0, R.MAKS_TEKST); });
    qa("[data-bt]").forEach(inp => inp.oninput = () => { const b = r.bilder[Number(inp.dataset.bt)]; if (b) b.tekst = inp.value.slice(0, 160); });
    qa("[data-bfjern]").forEach(b => b.onclick = () => {
      const i = Number(b.dataset.bfjern), x = r.bilder[i];
      if (!x) return;
      // Fjernes bare fra rapporten. Fila blir liggende i SharePoint (ingenting slettes).
      r.bilder.splice(i, 1); tilstand.ulagredeBilder.delete(x.fil); tegn();
    });
    const filInp = q("#drBildeFil");
    if (filInp) filInp.onchange = () => leggTilBilder([...filInp.files]);
    const mm = q("#drMedMerk"); if (mm) mm.onchange = () => { r.medMarkeringer = mm.checked; tegn(); };
    q(".dr-lagre").onclick = () => lagre(false);
    q(".dr-signer").onclick = signer;
  }
  q(".dr-uke-pdf").onclick = lagUkePdf;
}

async function leggTilBilder(filer) {
  const r = tilstand.rapport;
  const { komprimer } = await import("./bilder.js");
  let hoppet = 0;
  for (const f of filer) {
    if (r.bilder.length >= R.MAKS_BILDER) { hoppet++; continue; }
    if (!/^image\//.test(f.type || "")) { hoppet++; continue; }
    try {
      const blob = await komprimer(f);
      if (blob.size > MAKS_BILDE_BYTES) { hoppet++; continue; }
      const data = await new Promise((ok, feil) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = feil; fr.readAsDataURL(blob); });
      const navn = R.bildeNavn(r.prosjekt || prosjekt().nr, r.dato, Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      tilstand.bildeData.set(navn, String(data));
      tilstand.ulagredeBilder.add(navn);
      r.bilder.push({ fil: navn, tekst: String(f.name || "").replace(/\.[a-z0-9]+$/i, "").slice(0, 160) });
    } catch (_) { hoppet++; }
  }
  if (hoppet) varsel(t("{0} bilder ble ikke lagt til (ikke et bilde, for stort, eller over grensen på {1}).", hoppet, R.MAKS_BILDER));
  tegn();
}

// ---------- Lagre, signere, PDF ----------
async function lagre(stille) {
  const r = tilstand.rapport;
  if (tilstand.status !== "ok" && tilstand.status !== "tom") {
    if (!stille) varsel(tilstand.status === "av" ? t("Logg inn for å lagre dagsrapporten i SharePoint.") : t("Dagsrapportene kunne ikke leses fra SharePoint — lagrer ikke, så ingenting blir overskrevet."));
    return false;
  }
  vis(t("Lagrer dagsrapporten …"));
  try {
    if (!(await lastOppNyeBilder(r))) { varsel(t("Klarte ikke å laste opp bildene. Rapporten er ikke lagret.")); return false; }
    const navn = innloggetNavn();
    const naa = new Date().toISOString();
    if (!r.laget) { r.laget = naa; r.lagetAv = navn; }
    r.endret = naa; r.endretAv = navn;
    const res = await lagrePost(r);
    if (!res.ok) { varsel(t("Klarte ikke å lagre dagsrapporten ({0}).", res.grunn || "?")); return false; }
    tilstand.lagret = R.vaskRapport(JSON.parse(JSON.stringify(r)));
    if (!stille) varsel(t("Dagsrapporten er lagret."));
    return true;
  } finally { vis(""); tegn(); }
}

async function signer() {
  const r = tilstand.rapport;
  if (!String(r.utfort || "").trim() && !r.bemanning.length &&
      !confirm(t("Rapporten har verken bemanning eller utført arbeid. Signere likevel?"))) return;
  const sign = await bePåSignatur(innloggetNavn());
  if (!sign) return;
  oppdaterMarkeringer();
  r.signert = { navn: sign.navn, tid: naaTekst(), signatur: sign.signatur || "" };
  const kanLagre = tilstand.status === "ok" || tilstand.status === "tom";
  if (kanLagre) {
    const ok = await lagre(true);
    if (!ok) { r.signert = null; tegn(); return; }
  } else varsel(t("Ikke lagret i SharePoint — PDF-en lastes ned, men rapporten finnes bare her."));
  const blob = await lagPdf([r], null);
  if (blob && kanLagre) {
    const up = await spLastOpp(DR_MAPPE, R.pdfNavn(r.prosjekt || prosjekt().nr, r.dato, r.versjon), blob, "application/pdf");
    varsel(up.ok ? t("Signert og lagret. PDF-en er lastet ned og ligger også i SharePoint (Dagsrapporter).")
      : t("Signert og lagret, men PDF-en kom ikke opp i SharePoint. Den er lastet ned her."));
  }
  tegn();
}

function vis(tekst) {
  if (!loadingEl) return;
  if (!tekst) { loadingEl.classList.remove("open"); return; }
  if (loadingText) loadingText.textContent = tekst;
  loadingEl.classList.add("open");
}

async function lagPdf(rapporter, uke) {
  vis(t("Lager PDF …"));
  try {
    const logo = typeof tilstand.o.hentLogo === "function" ? await tilstand.o.hentLogo().catch(() => null) : null;
    const bilder = new Map();
    for (const r of rapporter) for (const b of r.bilder) { const d = await hentBilde(b.fil); if (d) bilder.set(b.fil, d); }
    const jsPDF = tilstand.o.jsPDF || await hentJsPDF();   // o.jsPDF: testen
    const p = prosjekt();
    const d = tegnDagsrapport(jsPDF, rapporter, { logo, bilder, uke, prosjekt: p.nr, prosjektNavn: p.navn, modell: p.modell,
      nrFor: (dato) => R.lopenr(tilstand.liste, dato) });
    const blob = d.output("blob");
    lastNedFil(blob, uke ? R.ukePdfNavn(p.nr, uke.mandag) : R.pdfNavn(p.nr, rapporter[0].dato, rapporter[0].versjon));
    return blob;
  } catch (err) {
    varsel(t("Klarte ikke å lage PDF-en: {0}", err.message));
    return null;
  } finally { vis(""); }
}

async function lagUkePdf() {
  const u = R.ukeSum(tilstand.liste, tilstand.mandag, iDagISO());
  const rapporter = u.rader.filter(x => x.rapport).map(x => x.rapport);
  if (!rapporter.length) { varsel(t("Ingen lagrede dagsrapporter i uke {0}.", u.uke)); return; }
  if (harEndringer()) varsel(t("Endringene du ikke har lagret er ikke med i uke-PDF-en."));
  await lagPdf(rapporter, u);
}

// ---------- Åpne og lukke ----------
function lukk() {
  if (harEndringer() && !confirm(t("Du har endringer som ikke er lagret. Lukke likevel?"))) return;
  const el = $("dagsrapport"); if (el) el.remove();
  document.removeEventListener("keydown", tast);
}
function tast(e) { if (e.key === "Escape" && !document.querySelector("#signaturBoks.open")) lukk(); }

// o = { hentLogo: () => Promise<logo> }
export async function apneDagsrapport(o) {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  tilstand.o = o || {};
  let el = $("dagsrapport");
  if (!el) { el = document.createElement("div"); el.id = "dagsrapport"; document.body.appendChild(el); }
  el.onpointerdown = (e) => { if (e.target === el) lukk(); };
  document.addEventListener("keydown", tast);
  tilstand.status = "laster"; tilstand.liste = [];
  tilstand.ulagredeBilder.clear();
  const iDag = iDagISO();
  tilstand.valgt = ""; tilstand.mandag = R.mandagFor(iDag);
  velgDag(iDag, true);
  await lesListe();
  velgDag(iDag, true);
}
