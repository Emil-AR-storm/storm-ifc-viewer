// 💰 Priskalkulasjon — panelet (kun kontoret).
//
// Byggeplan: «Storm IFC-Viewer Priskalkulasjon kartlegging og 3 provebilder
// 2026-10-12». Emil valgte oppsett B (stort tabellvindu). Reglene — hva en
// post er, mengden, avviket og Excel-arket — står i js/priskalk-regn.js.
//
// PRISENE ER SENSITIVE (Emil, fast regel): de lagres BARE i SharePoint
// (mappa «Priskalkulasjon», én fil per prosjekt). IKKE i localStorage, ikke i
// GitHub, ikke i Worker-ens R2, og ikke på byggeplass-siden. Er du ikke
// innlogget, kan du regne og laste ned Excel, men ingenting huskes — det står
// tydelig i panelet. Derfor bruker vi spLes/spSkriv direkte og ikke den
// lokale hurtigbufferen de andre delte listene har.
import { $, S, apnePanel, ekstraLagSom, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { varsel } from "./varsel.js";
import { hentQto, metaFor } from "./ifcrpc.js";
import { clearSelection, lastNedXlsxFlere, markerRader, materialGruppe, veksleMateriellIUtvalg, materialVisning, sikreMengder, typeVisning } from "./elements.js";
import { spLes, spPaalogget, spSkriv } from "./sp-lager.js";
import {
  ENHETER, OPPSETT_ID, avvikKlasse, beregnPost, excelArk, filnavn, fraLagret,
  kontrollArk, lesTall, linjesum, mengdeDesimaler, nyId, postNr, prislisteNokkel, raderForPost, vaskOppsett, vaskPost
} from "./priskalk-regn.js";

const SP_MAPPE = "Priskalkulasjon";
let poster = [];                  // vaskede poster, i rekkefølge
let oppsett = vaskOppsett({});
let nokkel = null;                // { fil, hva, navn } — hvilken prisliste som er åpen
let spStatus = "av";              // av | henter | ok | lagrer | feil
let skitne = new Set();           // id-er som er endret siden sist lagret (+ OPPSETT_ID)
let gravsteiner = [];             // slettede poster som ikke er skrevet ennå
let lagreTid = 0;
let nyForm = "";                  // "" | "modell" — skjemaet «Fra modellen» er åpent
let forModell = null;             // modellen panelet ble fylt for

const erApen = () => { const p = $("prisPanel"); return !!(p && p.classList.contains("open")); };
const nb = (v, d) => (Number(v) || 0).toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });
const kr = (v) => (v === null || v === undefined) ? "—" : nb(v, 0);
const naa = () => new Date().toISOString();

// GlobalId → id i denne modellen. Manuelle poster lagres med GlobalId, så de
// overlever at modellen lastes på nytt (id-ene kan bli andre, GUID-en ikke).
let guidKart = null;
function guidTilId(g) {
  if (!guidKart) {
    guidKart = new Map();
    for (const [id, m] of (S.meta || new Map())) if (m && m.globalId) guidKart.set(m.globalId, id);
  }
  return guidKart.has(g) ? guidKart.get(g) : null;
}

// ═══════════════════════ LAGRING (bare SharePoint) ═══════════════════════
function statusTekst() {
  if (!spPaalogget()) return t("Ikke innlogget — prisene lagres IKKE. Logg inn for å lagre dem i SharePoint.");
  if (spStatus === "henter") return t("Henter prislista fra SharePoint …");
  if (spStatus === "lagrer") return t("Lagrer …");
  if (spStatus === "feil") return t("Fikk ikke lagret i SharePoint — prøv igjen");
  return t("Lagret i SharePoint");
}
function visStatus() {
  const el = $("pkStatus");
  if (!el) return;
  el.textContent = statusTekst();
  el.className = "pk-status " + (!spPaalogget() || spStatus === "feil" ? "pk-status-varsel" : spStatus === "ok" ? "pk-status-ok" : "");
}

async function hentPriser() {
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const ny = prislisteNokkel(info, S.fileName);
  // Uten innlogging finnes prisene bare her, i minnet. Lukker du panelet og
  // åpner det igjen på samme prosjekt, skal de fortsatt stå der.
  if (!spPaalogget() && nokkel && ny.fil === nokkel.fil && forModell === S.modelGroup) { spStatus = "av"; return; }
  nokkel = ny;
  poster = []; oppsett = vaskOppsett({}); skitne = new Set(); gravsteiner = [];
  if (!spPaalogget()) { spStatus = "av"; return; }
  spStatus = "henter"; visStatus();
  const forFil = nokkel.fil;
  const res = await spLes(SP_MAPPE, nokkel.fil);
  if (!nokkel || nokkel.fil !== forFil) return;
  if (res.status === "ok" || res.status === "tom") {
    const d = fraLagret(res.liste);
    poster = d.poster; oppsett = d.oppsett; spStatus = "ok";
  } else spStatus = "feil";
}

function merk(id) {
  skitne.add(id);
  clearTimeout(lagreTid);
  lagreTid = setTimeout(skriv, 800);
}
async function skriv() {
  if (!spPaalogget() || !nokkel) { spStatus = "av"; visStatus(); return; }
  const tid = naa();
  const ut = [];
  for (const id of skitne) {
    if (id === OPPSETT_ID) { oppsett.endret = tid; ut.push(Object.assign({}, oppsett)); continue; }
    const p = poster.find(x => x.id === id);
    if (p) { p.endret = tid; ut.push(Object.assign({}, p)); }
  }
  for (const g of gravsteiner) ut.push({ id: g, slettet: true, endret: tid });
  if (!ut.length) return;
  const sendt = new Set(skitne), sendtGrav = gravsteiner.slice();
  spStatus = "lagrer"; visStatus();
  const fil = nokkel.fil;
  const res = await spSkriv(SP_MAPPE, fil, ut, (p) => String(p && p.id || ""));
  if (!nokkel || nokkel.fil !== fil) return;
  if (res.ok) {
    for (const id of sendt) skitne.delete(id);
    gravsteiner = gravsteiner.filter(g => !sendtGrav.includes(g));
    spStatus = "ok";
  } else spStatus = "feil";
  visStatus();
}

// ═══════════════════════ BEREGNING ═══════════════════════
function beregnAlle() {
  const cache = S.qtyCache || { rows: [] };
  const qto = S.qto || new Map();
  return poster.map(post => {
    const rader = raderForPost(post, cache.rows, materialGruppe, guidTilId);
    return { post, rader, b: beregnPost(post, rader, qto) };
  });
}

// ═══════════════════════ TEGNING ═══════════════════════
function enhetValg(valgt, attr) {
  return '<select ' + attr + '>' + ENHETER.map(e => '<option value="' + e + '"' + (e === valgt ? " selected" : "") + ">" + e + "</option>").join("") + "</select>";
}

function kildeValg(post, b) {
  if (post.modus === "egen") return '<span class="pk-dim">' + esc(t("Egen mengde")) + "</span>";
  if (post.enhet === "stk") return '<span class="pk-dim">' + esc(t("Antall i modellen")) + "</span>";
  const valg = ['<option value="geometri"' + (post.kilde === "geometri" ? " selected" : "") + ">" + esc(t("Geometri")) + "</option>"];
  const navn = new Set();
  for (const v of b.valg) {
    navn.add(v.navn);
    valg.push('<option value="qto:' + esc(v.navn) + '"' + (post.kilde === "qto:" + v.navn ? " selected" : "") + ">" +
      esc(t("Fila: {0}", v.navn)) + (v.dekket < b.n ? " (" + v.dekket + "/" + b.n + ")" : "") + "</option>");
  }
  // Valgt felt som ikke finnes lenger (ny modell): vis det, så valget ikke forsvinner stille
  if (post.kilde.startsWith("qto:") && !navn.has(post.kilde.slice(4)))
    valg.push('<option value="' + esc(post.kilde) + '" selected>' + esc(t("Fila: {0}", post.kilde.slice(4))) + " (0/" + b.n + ")</option>");
  return '<select data-pk="kilde">' + valg.join("") + "</select>";
}

function kontrollCelle(post, b) {
  if (post.modus === "egen" || post.enhet === "stk") return '<span class="pk-dim">—</span>';
  const d = mengdeDesimaler(post.enhet);
  if (!b.qto) return '<span class="pk-dim" title="' + esc(t("Fila har ikke noe mengdesett som passer denne enheten")) + '">' +
    esc(t("Geometri {0}", nb(b.geo, d))) + " · " + esc(t("ingen Qto")) + "</span>";
  const a = b.qto.avvik;
  const avvTekst = a === null ? "" : !isFinite(a) ? " · ∞" : " · " + (a >= 0 ? "+" : "−") + nb(Math.abs(a) * 100, 1) + " %";
  const tittel = t("Geometri: {0} · Fila ({1}): {2} · {3} av {4} elementer har feltet",
    nb(b.geo, d), b.qto.navn, nb(b.qto.sum, d), b.qto.dekket, b.qto.n);
  return '<span class="pk-avvik pk-avvik-' + (avvikKlasse(a) || "ingen") + '" title="' + esc(tittel) + '">' +
    esc(nb(b.geo, d)) + " / " + esc(nb(b.qto.sum, d)) + esc(avvTekst) + "</span>";
}

function radHtml({ post, rader, b }, i) {
  const d = mengdeDesimaler(post.enhet);
  const sum = linjesum(b.mengde, post.pris, post.paaslag, oppsett.felles);
  const ingen = post.modus !== "egen" && b.n === 0;
  const opphav = post.modus === "modell"
    ? (post.type ? typeVisning(post.type) : t("Alle typer")) + (post.mat ? " · " + (post.mat.slice(0, 2) === "g:" ? t(post.mat.slice(2)) : materialVisning(post.mat.slice(2))) : "")
    : post.modus === "manuell" ? t("{0} markerte objekter", (post.gids || []).length + (post.nokler || []).length) : t("Egen linje");
  return '<tr data-id="' + esc(post.id) + '"' + (ingen ? ' class="pk-tom"' : "") + ">" +
    '<td><input class="pk-nr" data-pk="nr" value="' + esc(post.nr) + '" placeholder="' + esc(postNr({}, i)) + '"></td>' +
    '<td><input class="pk-tekst" data-pk="tekst" value="' + esc(post.tekst) + '"><div class="pk-opphav">' + esc(opphav) +
      (post.modus !== "egen" ? " · " + esc(t("{0} stk", b.n)) : "") + "</div></td>" +
    "<td>" + kildeValg(post, b) + "</td>" +
    '<td class="pk-tall">' + (post.modus === "egen"
      ? '<input class="pk-num" data-pk="mengdeEgen" value="' + esc(nb(post.mengdeEgen, d).replace(/\s/g, "")) + '">'
      : esc(nb(b.mengde, d))) + "</td>" +
    "<td>" + enhetValg(post.enhet, 'data-pk="enhet"') + "</td>" +
    '<td class="pk-tall">' + kontrollCelle(post, b) + "</td>" +
    '<td><input class="pk-num' + (post.pris === null ? " pk-mangler" : "") + '" data-pk="pris" value="' + esc(post.pris === null ? "" : String(post.pris).replace(".", ",")) + '" placeholder="' + esc(t("pris")) + '"></td>' +
    '<td><input class="pk-num pk-smal" data-pk="paaslag" value="' + esc(String(post.paaslag || 0).replace(".", ",")) + '"></td>' +
    '<td class="pk-tall pk-sum">' + esc(kr(sum)) + "</td>" +
    '<td class="pk-knapper">' +
      (post.modus === "manuell" ? '<button data-pk-gjor="oppdater" title="' + esc(t("Endre hvilke objekter posten gjelder")) + '">' + ikon("fokus") + "</button>" : "") +
      (post.modus !== "egen" ? '<button data-pk-gjor="vis" title="' + esc(t("Vis i modellen")) + '">' + ikon("vis") + "</button>" : "") +
      '<button data-pk-gjor="opp" title="' + esc(t("Flytt opp")) + '">↑</button>' +
      '<button data-pk-gjor="slett" title="' + esc(t("Slett posten")) + '">' + ikon("slett") + "</button>" +
    "</td></tr>";
}

// «Fra modellen»: SAMME filter som 📊 Mengder (Emil 12.10, bilde 3 og 4).
// Listene henger sammen: velger du objekttype, viser materiallista bare
// materialene som FINNES i den typen — med antall innenfor typen — og
// omvendt. Da kan du ikke sette sammen «Takplater + Gjerdefot» og få 0 stk.
// Samme telleregel som renderQuantities i elements.js: tell én gang per
// gruppe, og vis bare valg som gir treff.
let nyType = "", nyMat = "", nyEnhet = "";
const passerMat = (r, mat) => !mat ||
  (mat.slice(0, 2) === "g:" ? materialGruppe(r.material) === mat.slice(2) : (r.material || "") === mat.slice(2));
export function filterValg(rows, type, mat) {
  const alle = rows || [];
  const forType = alle.filter(r => passerMat(r, mat));          // typelista teller innenfor materialet
  const forMat = alle.filter(r => !type || (r.type || "") === type);   // materiallista teller innenfor typen
  const tell = (rader, f) => rader.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
  const typer = [...new Set(alle.map(r => r.type || ""))]
    .map(typ => [typ, tell(forType, r => (r.type || "") === typ)]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const grupper = [...new Set(forMat.map(r => materialGruppe(r.material)).filter(Boolean))]
    .map(g => [g, tell(forMat, r => materialGruppe(r.material) === g)]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const mater = [...new Set(forMat.map(r => r.material || ""))]
    .map(m => [m, tell(forMat, r => (r.material || "") === m)]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return { typer, grupper, mater, nType: forType.length, nMat: forMat.length,
    treff: alle.filter(r => (!type || (r.type || "") === type) && passerMat(r, mat)).length };
}

function nyModellForm() {
  const rows = (S.qtyCache || { rows: [] }).rows;
  let v = filterValg(rows, nyType, nyMat);
  // Et valg som ikke finnes lenger (typen ble byttet) nullstilles — ellers
  // står det et materiale i lista som ikke hører til typen.
  if (nyMat && !(nyMat.slice(0, 2) === "g:" ? v.grupper.some(([g]) => "g:" + g === nyMat) : v.mater.some(([m]) => "m:" + m === nyMat))) {
    nyMat = ""; v = filterValg(rows, nyType, nyMat);
  }
  if (nyType && !v.typer.some(([typ]) => typ === nyType)) { nyType = ""; v = filterValg(rows, nyType, nyMat); }
  const opt = (verdi, tekst, valgt) => '<option value="' + esc(verdi) + '"' + (valgt ? " selected" : "") + ">" + esc(tekst) + "</option>";
  const enhet = nyEnhet || foreslaattEnhet(nyType, nyMat) || "m³";
  return '<div class="pk-ny" id="pkNyForm">' +
    '<label>' + esc(t("Objekttype")) + '<select id="pkNyType">' +
      opt("", t("Alle typer ({0} stk)", v.nType), !nyType) +
      v.typer.map(([typ, n]) => opt(typ, typeVisning(typ) + " (" + n + t(" stk") + ")", typ === nyType)).join("") +
    "</select></label>" +
    '<label>' + esc(t("Materiale")) + '<select id="pkNyMat">' +
      opt("", t("Alle materialer ({0} stk)", v.nMat), !nyMat) +
      (v.grupper.length ? '<optgroup label="' + esc(t("Materialgrupper")) + '">' +
        v.grupper.map(([g, n]) => opt("g:" + g, t(g) + " (" + n + t(" stk") + ")", "g:" + g === nyMat)).join("") + "</optgroup>" : "") +
      '<optgroup label="' + esc(t("Enkeltmaterialer")) + '">' +
        v.mater.map(([m, n]) => opt("m:" + m, materialVisning(m) + " (" + n + t(" stk") + ")", "m:" + m === nyMat)).join("") + "</optgroup>" +
    "</select></label>" +
    '<label>' + esc(t("Enhet")) + enhetValg(enhet, 'id="pkNyEnhet"') + "</label>" +
    '<span class="pk-ny-treff" id="pkNyTreff">' + esc(t("{0} stk", v.treff)) + "</span>" +
    '<button class="primary" id="pkNyLegg"' + (v.treff ? "" : " disabled") + ">" + esc(t("Legg til")) + "</button>" +
    '<button id="pkNyAvbryt">' + esc(t("Avbryt")) + "</button></div>";
}

// Forslag til enhet når typen/materialet velges: betong i m³, stål i kg,
// materiell i lm — det kan alltid endres.
function foreslaattEnhet(type, mat) {
  const g = mat.slice(0, 2) === "g:" ? mat.slice(2) : mat.slice(0, 2) === "m:" ? materialGruppe(mat.slice(2)) : "";
  if (g === "Betong") return "m³";
  if (g === "Stål" || g === "Armering") return "kg";
  if (type === "Materiell") return "lm";
  if (/^(Slab|Roof|Covering|Plate|CurtainWall|Takplate)$/.test(type)) return "m²";
  if (/^(Beam|Column|Member|Pile|Railing)$/.test(type)) return "lm";
  if (/^(Door|Window|Fastener|MechanicalFastener|DiscreteAccessory|Furniture)$/.test(type)) return "stk";
  return "";
}

function tegn() {
  const body = $("prisBody");
  if (!body) return;
  if (!S.modelGroup) { body.innerHTML = '<p class="pk-dim">' + esc(t("Åpne en modell først.")) + "</p>"; return; }
  const beregnede = beregnAlle();
  const total = beregnede.reduce((s, x) => s + (linjesum(x.b.mengde, x.post.pris, x.post.paaslag, oppsett.felles) || 0), 0);
  const mangler = beregnede.filter(x => x.post.pris === null).length;
  const hvem = nokkel ? (nokkel.hva === "prosjekt" ? t("Prosjekt {0}", nokkel.navn) : t("Modell {0} (sett prosjektnummer i Innstillinger → Prosjektinfo)", nokkel.navn)) : "";
  const qtoAntall = S.qto ? S.qto.size : 0;
  body.innerHTML =
    '<div class="pk-topp">' +
      '<span class="pk-dim">' + esc(t("Prisliste:")) + "</span> <b>" + esc(hvem) + "</b>" +
      '<span id="pkStatus" class="pk-status"></span>' +
      '<span class="pk-fyll"></span>' +
      '<label class="pk-felles">' + esc(t("Felles påslag %")) + ' <input class="pk-num pk-smal" id="pkFelles" value="' + esc(String(oppsett.felles || 0).replace(".", ",")) + '"></label>' +
    "</div>" +
    '<div class="pk-qto-info pk-dim">' + esc(qtoAntall
      ? t("Mengdesett i fila: {0} elementer har Qto. Velg i «Kilde» hvilket tall som brukes.", qtoAntall)
      : S.glbActive ? t("Lett kopi (.glb): mengdesettene fra IFC-fila finnes ikke her — bare geometrien.")
        : t("Fila har ingen mengdesett (Qto) — mengdene regnes fra geometrien.")) + "</div>" +
    (nyForm === "modell" ? nyModellForm() : "") +
    '<div class="pk-tabell-ramme"><table class="pk-tabell"><thead><tr>' +
      "<th>" + esc(t("Post")) + "</th><th>" + esc(t("Beskrivelse")) + "</th><th>" + esc(t("Kilde")) + '</th><th class="pk-tall">' + esc(t("Mengde")) + "</th><th>" + esc(t("Enhet")) + '</th>' +
      '<th class="pk-tall" title="' + esc(t("Geometri / fila (Qto) og avviket mellom dem")) + '">' + esc(t("Geometri / fila")) + "</th>" +
      "<th>" + esc(t("Enhetspris")) + "</th><th>" + esc(t("Påslag %")) + '</th><th class="pk-tall">' + esc(t("Sum")) + "</th><th></th>" +
    "</tr></thead><tbody>" +
      (beregnede.length ? beregnede.map(radHtml).join("")
        : '<tr><td colspan="10" class="pk-dim pk-tom-liste">' + esc(t("Ingen poster ennå. Legg til fra modellen, fra det du har markert, eller en egen linje.")) + "</td></tr>") +
    "</tbody></table></div>" +
    '<div class="pk-fot">' +
      '<div><div class="pk-dim">' + esc(t("Sum eks. mva")) + '</div><div class="pk-total">' + esc(kr(total)) + " kr</div></div>" +
      (mangler ? '<div><div class="pk-dim">' + esc(t("Mangler pris")) + '</div><div class="pk-total pk-varsel">' + esc(mangler === 1 ? t("1 linje") : t("{0} linjer", mangler)) + "</div></div>" : "") +
      '<span class="pk-fyll"></span>' +
      '<button id="pkFraModell">' + ikon("pluss") + esc(t("Fra modellen")) + "</button>" +
      '<button id="pkManuell" title="' + esc(t("Trykk på objektene i modellen som skal med, og trykk Ferdig")) + '">' + ikon("pluss") + esc(t("Marker i modellen")) + "</button>" +
      '<button id="pkEgen">' + ikon("pluss") + esc(t("Egen linje")) + "</button>" +
      '<button class="primary" id="pkExcel">' + ikon("lastned") + esc(t("Last ned Excel")) + "</button>" +
    "</div>";
  visStatus();
  kobl(body);
}

// ═══════════════════════ HANDLINGER ═══════════════════════
function leggTil(p) {
  const post = vaskPost(Object.assign({ id: nyId(), rekke: (poster.length ? Math.max(...poster.map(x => x.rekke)) : 0) + 1 }, p));
  poster.push(post);
  merk(post.id);
  tegn();
}

// ═══════════════════════ «MARKER I MODELLEN»: VELGEMODUSEN ═══════════════════════
// Emil 12.10: «du trykker på Marker objekt, da går det inn i markeringsmodus,
// du trykker på det du vil ha og trykker Ferdig eller Avbryt — på samme måte
// som i Framdriftsplan». Det gamle (marker først, åpne panelet, trykk
// «Markerte objekter») var tungvint, og det virket bare for IFC-elementer:
// SW-elementer, takplater, blikk og materiell ble aldri med.
//
// Samme kroker som Framdriftsplan og Støpeplan bruker (S.velgModusAktiv …):
// hvert trykk i modellen legger til / tar bort, shift + dra tar mange, og
// egenskapspanelet åpnes ikke (det ville lukket priskalkulasjonen).
let velger = null;            // { postId: null | id } — null = ny post
let forrigeKroker = null;

// Det som er valgt akkurat nå: GlobalId for IFC, nøkler for resten
export function valgtNaa() {
  const gids = [], nokler = [];
  const ider = (S.multiSel && S.multiSel.size) ? [...S.multiSel.keys()] : (S.currentPropID != null ? [S.currentPropID] : []);
  for (const id of ider.map(Number).filter(n => n > 0)) { const m = metaFor(id); if (m && m.globalId) gids.push(m.globalId); }
  for (const l of ekstraLagSom("valgte")) {
    if (!l.flervalg) continue;
    if (l.id === "sw") for (const id of l.valgte()) nokler.push("sw:" + id);
    else if (l.id === "fpTrpBlikk") for (const k of l.valgte()) if (/^(tak|blikk):/.test(k)) nokler.push(k);
  }
  const mat = new Set(S.multiSelMat || []);
  if (S.materiellValgtId) mat.add(S.materiellValgtId);
  for (const id of mat) nokler.push("mat:" + id);
  return { gids: [...new Set(gids)], nokler: [...new Set(nokler)] };
}
function antallValgt() { const v = valgtNaa(); return v.gids.length + v.nokler.length; }

// Enhet ut fra hva som er valgt: plater/vegger i m², blikk i lm, ellers m³
export function enhetForUtvalg(v) {
  const n = v.nokler || [];
  if (!(v.gids || []).length && n.length) {
    if (n.every(k => k.startsWith("blikk:"))) return "lm";
    if (n.every(k => k.startsWith("tak:") || k.startsWith("sw:"))) return "m²";
  }
  return "m³";
}

function velgBar() {
  let el = $("pkVelgBar");
  if (!el) { el = document.createElement("div"); el.id = "pkVelgBar"; el.className = "st-velgbar pk-velgbar"; document.body.appendChild(el); }
  return el;
}
function tegnVelgBar() {
  const el = velgBar();
  if (!velger) { el.style.display = "none"; el.innerHTML = ""; return; }
  const n = antallValgt();
  const p = velger.postId ? poster.find(x => x.id === velger.postId) : null;
  el.style.display = "flex";
  el.innerHTML =
    '<span class="st-velg-tekst"><b>' + esc(p ? t("Bytt objektene i «{0}»", p.tekst || postNr(p, 0)) : t("Marker objektene som skal prises")) + "</b><br>" +
      esc(t("Trykk på det som skal med — elementer, SW, takplater, blikk og materiell. Trykk igjen for å ta bort. Shift + dra for mange på en gang.")) + "</span>" +
    '<span class="st-velg-ant">' + esc(t("{0} valgt", n)) + "</span>" +
    '<button id="pkVelgFerdig" class="primary"' + (n ? "" : " disabled") + ">" + esc(t("Ferdig")) + "</button>" +
    '<button id="pkVelgAvbryt">' + esc(t("Avbryt")) + "</button>";
  $("pkVelgFerdig").onclick = () => avsluttVelg(true);
  $("pkVelgAvbryt").onclick = () => avsluttVelg(false);
}
export function startVelg(postId) {
  if (velger) avsluttVelg(false);
  // En annen velgemodus (Framdriftsplan, Støpeplan) avsluttes først
  if (S.avsluttVelgModus && S.velgModusAktiv) S.avsluttVelgModus();
  clearSelection();
  velger = { postId: postId || null };
  // Panelet går ned mens du markerer, så hele modellen er fri å trykke i.
  // Det kommer tilbake av seg selv når du trykker Ferdig eller Avbryt.
  const pp = $("prisPanel");
  if (pp) pp.classList.remove("open");
  S.velgModusAktiv = true;
  S.materiellIVelgModus = (id) => { veksleMateriellIUtvalg(id); tegnVelgBar(); };
  S.velgModusBlokkert = null;
  forrigeKroker = { o: S.velgModusOppdater, a: S.avsluttVelgModus };
  S.velgModusOppdater = () => tegnVelgBar();
  S.avsluttVelgModus = () => avsluttVelg(false);
  // Eksisterende post: det den har fra før står markert, så du ser hva du endrer
  const p = postId ? poster.find(x => x.id === postId) : null;
  if (p) markerRader(raderForPost(p, (S.qtyCache || { rows: [] }).rows, materialGruppe, guidTilId));
  tegnVelgBar();
}
export function avsluttVelg(medTil) {
  if (!velger) return 0;
  const v = valgtNaa();
  const n = v.gids.length + v.nokler.length;
  const postId = velger.postId;
  velger = null;
  S.velgModusAktiv = false;
  S.materiellIVelgModus = null;
  S.velgModusBlokkert = null;
  if (forrigeKroker) { S.velgModusOppdater = forrigeKroker.o; S.avsluttVelgModus = forrigeKroker.a; forrigeKroker = null; }
  clearSelection();
  tegnVelgBar();
  apnePanel("prisPanel");
  if (medTil && n) {
    const p = postId ? poster.find(x => x.id === postId) : null;
    if (p) { p.gids = v.gids; p.nokler = v.nokler; Object.assign(p, vaskPost(p)); merk(p.id); tegn(); }
    else leggTil({ modus: "manuell", gids: v.gids, nokler: v.nokler, enhet: enhetForUtvalg(v), tekst: t("Markerte objekter ({0} stk)", n) });
  } else tegn();
  return medTil ? n : 0;
}
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (ev) => {
    if (velger && ev.key === "Escape") { ev.stopPropagation(); avsluttVelg(false); }
  }, true);
  // Telleren følger utvalget
  window.addEventListener("pointerup", () => setTimeout(() => { if (velger) tegnVelgBar(); }, 0));
  window.addEventListener("keyup", () => setTimeout(() => { if (velger) tegnVelgBar(); }, 0));
}

function kobl(body) {
  const f = $("pkFelles");
  if (f) f.addEventListener("change", () => { oppsett.felles = lesTall(f.value) || 0; merk(OPPSETT_ID); tegn(); });

  $("pkFraModell").addEventListener("click", () => { nyForm = nyForm === "modell" ? "" : "modell"; tegn(); });
  $("pkEgen").addEventListener("click", () => leggTil({ modus: "egen", tekst: t("Egen linje"), enhet: "stk", mengdeEgen: 1 }));
  $("pkManuell").addEventListener("click", () => startVelg(null));
  $("pkExcel").addEventListener("click", lastNedExcel);

  if (nyForm === "modell") {
    // Hvert valg tegner skjemaet på nytt, så den andre lista følger med
    $("pkNyType").addEventListener("change", () => { nyType = $("pkNyType").value; nyEnhet = ""; tegn(); });
    $("pkNyMat").addEventListener("change", () => { nyMat = $("pkNyMat").value; nyEnhet = ""; tegn(); });
    $("pkNyEnhet").addEventListener("change", () => { nyEnhet = $("pkNyEnhet").value; });
    $("pkNyAvbryt").addEventListener("click", () => { nyForm = ""; tegn(); });
    $("pkNyLegg").addEventListener("click", () => {
      const type = nyType, mat = nyMat;
      const navn = [type ? typeVisning(type) : t("Alle typer"),
        mat ? (mat.slice(0, 2) === "g:" ? t(mat.slice(2)) : materialVisning(mat.slice(2))) : ""].filter(Boolean).join(" · ");
      const enhet = $("pkNyEnhet").value;
      nyForm = ""; nyType = ""; nyMat = ""; nyEnhet = "";
      leggTil({ modus: "modell", type, mat, enhet, tekst: navn });
    });
  }

  body.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.dataset.id;
    const post = () => poster.find(p => p.id === id);
    tr.querySelectorAll("[data-pk]").forEach(el => {
      el.addEventListener("change", () => {
        const p = post(); if (!p) return;
        const felt = el.dataset.pk;
        if (felt === "pris") p.pris = lesTall(el.value);
        else if (felt === "paaslag") p.paaslag = lesTall(el.value) || 0;
        else if (felt === "mengdeEgen") p.mengdeEgen = lesTall(el.value) || 0;
        else if (felt === "enhet") { p.enhet = el.value; p.kilde = "geometri"; }
        else if (felt === "kilde") p.kilde = el.value;
        else p[felt] = el.value;
        Object.assign(p, vaskPost(p));
        merk(id);
        tegn();
      });
    });
    tr.querySelectorAll("[data-pk-gjor]").forEach(b => b.addEventListener("click", () => {
      const p = post(); if (!p) return;
      const gjor = b.dataset.pkGjor;
      if (gjor === "slett") {
        poster = poster.filter(x => x.id !== id);
        skitne.delete(id); gravsteiner.push(id);
        merk(OPPSETT_ID);         // sørger for at skrivingen går (gravsteinen sendes med)
        tegn();
      } else if (gjor === "opp") {
        const i = poster.findIndex(x => x.id === id);
        if (i > 0) {
          const a = poster[i - 1];
          [a.rekke, p.rekke] = [p.rekke, a.rekke];
          if (a.rekke === p.rekke) p.rekke = a.rekke - 1;
          poster.sort((x, y) => x.rekke - y.rekke);
          merk(a.id); merk(p.id); tegn();
        }
      } else if (gjor === "vis") {
        const rader = raderForPost(p, (S.qtyCache || { rows: [] }).rows, materialGruppe, guidTilId);
        const n = markerRader(rader);
        if (!n) varsel(t("Ingen av objektene finnes i denne modellen."));
      } else if (gjor === "oppdater") {
        startVelg(id);
      }
    }));
  });
}

async function lastNedExcel() {
  const beregnede = beregnAlle();
  if (!beregnede.length) { varsel(t("Legg til minst én post først.")); return; }
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const d = new Date();
  const dato = String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
  const a = excelArk(beregnede, oppsett, info, dato, S.fileName || "", t);
  const k = kontrollArk(beregnede, t);
  await lastNedXlsxFlere(filnavn(info, S.fileName, dato), [
    { navn: t("Priskalkulasjon"), rader: a.rader, stil: a.stil, bredder: a.bredder },
    { navn: t("Kontroll mengder"), rader: k.rader, stil: k.stil, bredder: k.bredder }
  ]);
}

// ═══════════════════════ ÅPNE ═══════════════════════
async function apne() {
  const body = $("prisBody");
  if (!S.modelGroup) { tegn(); apnePanel("prisPanel"); return; }
  if (body) body.innerHTML = '<p class="pk-dim">' + esc(t("Regner ut mengder …")) + "</p>";
  apnePanel("prisPanel");
  try { await sikreMengder(); } catch (_) {}
  try { await hentQto(); } catch (_) {}
  guidKart = null;
  // Prislista hentes på nytt hver gang panelet åpnes — en kollega kan ha
  // endret den. Er noe ulagret, skrives det først.
  if (skitne.size || gravsteiner.length) await skriv();
  await hentPriser();
  forModell = S.modelGroup;
  if (erApen()) tegn();
}

if (!LETT) {
  på("btnPris", "click", () => {
    const p = $("prisPanel");
    if (!p) return;
    if (p.classList.contains("open")) { p.classList.remove("open"); return; }
    apne();
  });
  // Ny modell: det som hørte til forrige modell glemmes (prisene ligger i SharePoint)
  if (typeof document !== "undefined") document.addEventListener("storm-prosjektinfo", () => {
    if (!erApen()) { poster = []; nokkel = null; return; }
    const info = S.prosjektInfo ? S.prosjektInfo() : {};
    const ny = prislisteNokkel(info, S.fileName);
    if (!nokkel || ny.fil !== nokkel.fil || forModell !== S.modelGroup) apne();
  });
}

// Til testene
export const _test = { tegn, beregnAlle, apne, poster: () => poster, settPoster: (p) => { poster = p.map(vaskPost); }, oppsett: () => oppsett };
