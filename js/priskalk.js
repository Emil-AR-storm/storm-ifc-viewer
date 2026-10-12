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
import { $, S, apnePanel, esc, ikon, på } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { varsel } from "./varsel.js";
import { hentQto, metaFor } from "./ifcrpc.js";
import { lastNedXlsxFlere, markerElementer, materialGruppe, materialVisning, sikreMengder, typeVisning } from "./elements.js";
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
    : post.modus === "manuell" ? t("{0} markerte objekter", (post.gids || []).length) : t("Egen linje");
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
      (post.modus === "manuell" ? '<button data-pk-gjor="oppdater" title="' + esc(t("Bytt til det som er markert i modellen nå")) + '">' + ikon("fokus") + "</button>" : "") +
      (post.modus !== "egen" ? '<button data-pk-gjor="vis" title="' + esc(t("Vis i modellen")) + '">' + ikon("vis") + "</button>" : "") +
      '<button data-pk-gjor="opp" title="' + esc(t("Flytt opp")) + '">↑</button>' +
      '<button data-pk-gjor="slett" title="' + esc(t("Slett posten")) + '">' + ikon("slett") + "</button>" +
    "</td></tr>";
}

function typeOgMatValg() {
  const full = S.qtyCache || { rows: [], types: [], materialer: [] };
  const typer = (full.types || []).map(([typ, e]) => '<option value="' + esc(typ) + '">' + esc(typeVisning(typ)) + " (" + e.count + t(" stk") + ")</option>").join("");
  const grupper = new Map();
  (full.materialer || []).forEach(([m, e]) => { const g = materialGruppe(m); if (g) grupper.set(g, (grupper.get(g) || 0) + e.count); });
  const gr = [...grupper.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => '<option value="g:' + esc(g) + '">' + esc(t(g)) + " (" + n + t(" stk") + ")</option>").join("");
  const mat = (full.materialer || []).map(([m, e]) => '<option value="m:' + esc(m) + '">' + esc(materialVisning(m)) + " (" + e.count + t(" stk") + ")</option>").join("");
  return { typer, gr, mat };
}

function nyModellForm() {
  const v = typeOgMatValg();
  return '<div class="pk-ny" id="pkNyForm">' +
    '<label>' + esc(t("Objekttype")) + '<select id="pkNyType"><option value="">' + esc(t("Alle typer")) + "</option>" + v.typer + "</select></label>" +
    '<label>' + esc(t("Materiale")) + '<select id="pkNyMat"><option value="">' + esc(t("Alle materialer")) + "</option>" +
      (v.gr ? '<optgroup label="' + esc(t("Materialgrupper")) + '">' + v.gr + "</optgroup>" : "") +
      '<optgroup label="' + esc(t("Enkeltmaterialer")) + '">' + v.mat + "</optgroup></select></label>" +
    '<label>' + esc(t("Enhet")) + enhetValg("m³", 'id="pkNyEnhet"') + "</label>" +
    '<span class="pk-ny-treff" id="pkNyTreff"></span>' +
    '<button class="primary" id="pkNyLegg">' + esc(t("Legg til")) + "</button>" +
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
      '<button id="pkManuell" title="' + esc(t("Lager en post av objektene du har markert (shift-klikk for flere)")) + '">' + ikon("pluss") + esc(t("Markerte objekter")) + "</button>" +
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

function valgteIder() {
  if (S.multiSel && S.multiSel.size) return [...S.multiSel.keys()].map(Number).filter(n => n > 0);
  return S.currentPropID != null && S.currentPropID > 0 ? [S.currentPropID] : [];
}
function gidsForIder(ider) {
  const ut = [];
  for (const id of ider) { const m = metaFor(id); if (m && m.globalId) ut.push(m.globalId); }
  return ut;
}

function kobl(body) {
  const f = $("pkFelles");
  if (f) f.addEventListener("change", () => { oppsett.felles = lesTall(f.value) || 0; merk(OPPSETT_ID); tegn(); });

  $("pkFraModell").addEventListener("click", () => { nyForm = nyForm === "modell" ? "" : "modell"; tegn(); });
  $("pkEgen").addEventListener("click", () => leggTil({ modus: "egen", tekst: t("Egen linje"), enhet: "stk", mengdeEgen: 1 }));
  $("pkManuell").addEventListener("click", () => {
    const ider = valgteIder();
    const gids = gidsForIder(ider);
    if (!gids.length) { varsel(t("Marker objektene i modellen først (shift-klikk for flere), og trykk så her.")); return; }
    leggTil({ modus: "manuell", gids, enhet: "m³", tekst: t("Markerte objekter ({0} stk)", gids.length) });
  });
  $("pkExcel").addEventListener("click", lastNedExcel);

  if (nyForm === "modell") {
    const oppdTreff = () => {
      const type = $("pkNyType").value, mat = $("pkNyMat").value;
      const n = raderForPost({ modus: "modell", type, mat }, (S.qtyCache || { rows: [] }).rows, materialGruppe).length;
      $("pkNyTreff").textContent = t("{0} stk", n);
      const e = foreslaattEnhet(type, mat);
      if (e) $("pkNyEnhet").value = e;
    };
    $("pkNyType").addEventListener("change", oppdTreff);
    $("pkNyMat").addEventListener("change", oppdTreff);
    oppdTreff();
    $("pkNyAvbryt").addEventListener("click", () => { nyForm = ""; tegn(); });
    $("pkNyLegg").addEventListener("click", () => {
      const type = $("pkNyType").value, mat = $("pkNyMat").value;
      const navn = [type ? typeVisning(type) : t("Alle typer"),
        mat ? (mat.slice(0, 2) === "g:" ? t(mat.slice(2)) : materialVisning(mat.slice(2))) : ""].filter(Boolean).join(" · ");
      nyForm = "";
      leggTil({ modus: "modell", type, mat, enhet: $("pkNyEnhet").value, tekst: navn });
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
        const n = markerElementer(rader.map(r => r.id));
        if (!n) varsel(t("Ingen av objektene finnes i denne modellen."));
      } else if (gjor === "oppdater") {
        const gids = gidsForIder(valgteIder());
        if (!gids.length) { varsel(t("Marker objektene i modellen først (shift-klikk for flere), og trykk så her.")); return; }
        p.gids = gids;
        merk(id); tegn();
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
