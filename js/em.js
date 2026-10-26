// 📝 ENDRINGSMELDING FRA MODELLEN — panelet (byggeplan runde 3, verktøy 2;
// bygget 26.10.2026, Emils valg A: sidepanel med tre steg).
//
//   1 Kilde: siste Sammenligning (rev. A → B), eller valgte elementer.
//   2 Mengder og prisanslag: én linje per IFC-type, med avkrysning, enhet
//     (lm/m²/m³/stk/kg) og pris fra Priskalkulasjon (kan overstyres).
//   3 Tittel, EM-nummer (manuelt i V1), før/etter-bilder og frist.
//   «Lag EM-utkast» → ny markering midt i endringen med EM-skjemaet
//   (endringsmelding-v1) forhåndsutfylt: dato, varselnummer, begrunnelse,
//   ordrelinjer og vedlegg. Skjemaet er et UTKAST — brukeren går gjennom,
//   låser og laster ned PDF fra markeringen som før.
//
// Regningen ligger i js/em-regn.js.
import { $, på, S, apnePanel, esc, ikon, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import { emBilder, sammenligningForEm } from "./compare.js";
import { allElementBoxes, lastNedXlsxFlere, quantitiesForSet, zoomToElement } from "./elements.js";
import { metaFor, typeFor } from "./ifcrpc.js";
import { fangstBilde } from "./scene.js";
import { spLes } from "./sp-lager.js";
import { fraLagret, prislisteNokkel } from "./priskalk-regn.js";
import { hentMaler, iDagISO, nyttSkjema } from "./sjekkliste.js";
import { fjernImportertMarkering, innloggetNavn, lagreOgSynk, lagreSkjema, leggTilImportertMarkering,
         naaTekst, nyId, openMarkerPopup, vaskMarkering } from "./markers.js";
import { bildeNavn, lastOpp } from "./bilder.js";
import * as R from "./em-regn.js";

export const EM_MAL_ID = "endringsmelding-v1";

const tilstand = {
  kilde: "sammenligning", enheter: {}, egnePriser: {}, av: new Set(),
  tittel: "", emNr: "", oppdaget: "", fristDager: 3,
  poster: [], prisStatus: "", bilder: null
};
export const _tilstand = tilstand;   // testene

// ---------- Data ----------
function utvalgsIder() {
  return (S.multiSel && S.multiSel.size) ? [...S.multiSel.keys()].map(Number)
    : (S.currentPropID != null ? [Number(S.currentPropID)] : []);
}
function typeAv(id) {
  if (S.glbActive || (S.glbProps && S.glbProps.size)) { const p = S.glbProps && S.glbProps.get(id); if (p && p[2]) return p[2]; }
  return typeFor(id) || "";
}
function utvalgSomResultat() {
  const ider = utvalgsIder().filter(n => n > 0);
  if (!ider.length) return null;
  const boxes = allElementBoxes(), q = quantitiesForSet(new Set(ider));
  const ny = [];
  for (const id of ider) {
    const b = boxes.get(id); if (!b) continue;
    const c = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
    const d = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    const m = metaFor(id), p = S.glbProps && S.glbProps.get(id);
    ny.push({ id, type: typeAv(id), name: (m && m.name) || (p && p[0]) || "", c, d, v: ((q.get(id) || {}).vol) || 0 });
  }
  return { res: { ny, slettet: [], endret: [] }, utvalg: true, modell: S.fileName || "" };
}
export function kildeData() {
  if (tilstand.kilde === "sammenligning") return sammenligningForEm();
  return utvalgSomResultat();
}
export function linjer() {
  const k = kildeData();
  if (!k) return [];
  const l = R.mengdeDiff(k.res, { toM: S.enhetSkala || 1, enheter: tilstand.enheter });
  return R.prisAnslag(l, tilstand.poster, tilstand.egnePriser);
}
const valgte = () => linjer().filter(l => !tilstand.av.has(l.key));

export async function hentPriser() {
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const n = prislisteNokkel(info, S.fileName);
  const r = await spLes("Priskalkulasjon", n.fil);
  tilstand.prisStatus = r.status;
  tilstand.poster = (r.status === "ok") ? fraLagret(r.liste).poster : [];
  return tilstand.poster;
}

// ---------- Panelet ----------
const kr = (v) => v == null ? "—" : R.tallTekst(v) + " kr";
function html() {
  const s = sammenligningForEm(), utv = utvalgsIder().length;
  if (!s && tilstand.kilde === "sammenligning" && utv) tilstand.kilde = "utvalg";
  const L = linjer(), sum = R.sumAnslag(L, l => !tilstand.av.has(l.key));
  const iDag = iDagISO();
  if (!tilstand.oppdaget) tilstand.oppdaget = iDag;
  const frist = R.emFrist(tilstand.oppdaget, tilstand.fristDager);
  const sek = (n, tekst) => '<div class="em-sek"><span class="em-n">' + n + '</span>' + esc(t(tekst)) + '</div>';
  let h = sek(1, "Kilde") + '<div class="em-kilder">' +
    '<button class="em-kilde' + (tilstand.kilde === "sammenligning" ? " valgt" : "") + '" data-kilde="sammenligning"' + (s ? "" : " disabled") + '>' +
      (s ? esc(t("Sammenligning {0} → {1}", kortNavn(s.fra), kortNavn(s.til))) : esc(t("Ingen sammenligning — bruk Sammenlign først"))) + '</button>' +
    '<button class="em-kilde' + (tilstand.kilde === "utvalg" ? " valgt" : "") + '" data-kilde="utvalg"' + (utv ? "" : " disabled") + '>' +
      esc(t("Valgte elementer ({0})", utv)) + '</button></div>';
  h += sek(2, "Mengder og prisanslag");
  if (!L.length) h += '<p class="em-hjelp">' + esc(s || utv ? t("Ingen endringer å telle.") : t("Sammenlign to revisjoner, eller velg elementer i modellen (shift-klikk), og kom tilbake hit.")) + '</p>';
  else {
    h += '<table class="em-tab"><tr><th></th><th>' + esc(t("Type")) + '</th><th>' + esc(t("Ny / fjernet / endret")) + '</th><th class="r">' + esc(t("Endring")) + '</th><th>' + esc(t("Enhet")) + '</th><th class="r">' + esc(t("Pris")) + '</th><th class="r">' + esc(t("Sum")) + '</th></tr>';
    for (const l of L) {
      const av = tilstand.av.has(l.key);
      h += '<tr class="em-rad' + (av ? " av" : "") + '" data-key="' + esc(l.key) + '">' +
        '<td><input type="checkbox" class="em-med"' + (av ? "" : " checked") + '></td>' +
        '<td><b>' + esc(t(l.navn)) + '</b><div class="em-under">' + esc(l.undertekst) + '</div></td>' +
        '<td class="em-tall">+' + l.ny + ' / −' + l.slettet + ' / ' + l.endret + '</td>' +
        '<td class="r ' + (l.mengde < 0 ? "neg" : "pos") + '">' + esc(R.mengdeTekst(l).replace(" " + l.enhet, "")) + '</td>' +
        '<td><select class="em-enhet">' + R.EM_ENHETER.map(e => '<option' + (e === l.enhet ? " selected" : "") + '>' + e + '</option>').join("") + '</select></td>' +
        '<td class="r"><input class="em-pris" inputmode="decimal" value="' + (l.pris == null ? "" : esc(String(l.pris).replace(".", ","))) + '" placeholder="' + esc(t("mangler pris")) + '"></td>' +
        '<td class="r em-sum">' + esc(kr(l.sum)) + '</td></tr>';
    }
    h += '<tr class="em-sumrad"><td></td><td colspan="5">' + esc(t("Prisanslag (eks. mva)")) +
      (sum.manglerPris ? ' · <span class="em-mangler">' + esc(t("{0} linjer mangler pris", sum.manglerPris)) + '</span>' : "") + '</td><td class="r">' + esc(kr(sum.sum)) + '</td></tr></table>';
    h += '<p class="em-hjelp">' + esc(tilstand.prisStatus === "ok" ? t("Prisene er hentet fra Priskalkulasjon for prosjektet. Skriv inn pris der den mangler.")
      : tilstand.prisStatus === "av" ? t("Logg inn for å hente priser fra Priskalkulasjon.") : t("Ingen prisliste i Priskalkulasjon for prosjektet ennå — skriv inn prisene her.")) + '</p>';
  }
  h += sek(3, "Tittel, bilder og frist") +
    '<input id="emTittel" class="em-felt" maxlength="120" placeholder="' + esc(t("Tittel, f.eks. «Rev. B: nye søyler akse C»")) + '" value="' + esc(tilstand.tittel) + '">' +
    '<input id="emNr" class="em-felt" maxlength="30" placeholder="' + esc(t("EM-nummer (fra Storm Prosjektoversikt), f.eks. EM-14")) + '" value="' + esc(tilstand.emNr) + '">' +
    '<div class="em-bilder">' + bildeHtml("for", t("Før")) + bildeHtml("etter", t("Etter")) + '</div>' +
    '<button id="emTaBilder">' + ikon("kamera") + ' ' + esc(tilstand.bilder ? t("Ta bildene på nytt") : t("Ta bilder fra modellen")) + '</button>' +
    '<p class="em-hjelp">' + esc(t("Bildene tas fra kameravinkelen du står i nå. Før viser det som er fjernet, etter det som er nytt og endret.")) + '</p>' +
    '<div class="em-frist">' + ikon("advarsel") + '<div>' + esc(t("Oppdaget")) + ' <input type="date" id="emOppdaget" value="' + esc(tilstand.oppdaget) + '"> · ' +
      esc(t("frist")) + ' <b>' + esc(frist.split("-").reverse().join(".")) + '</b> (' + esc(t("{0} dager", tilstand.fristDager)) + ')' +
      '<br><span class="em-hjelp">' + esc(t("Varsle uten ugrunnet opphold. Storms EM-flyt: frist 3 dager etter at endringen ble kjent.")) + '</span></div></div>';
  return h;
}
function bildeHtml(k, navn) {
  const b = tilstand.bilder && tilstand.bilder[k];
  return '<div class="em-bilde">' + (b ? '<img src="' + esc(b.data) + '" alt="">' : "") + '<span>' + esc(navn) + '</span></div>';
}
const kortNavn = (f) => String(f || "").replace(/\.(ifc|glb)$/i, "").slice(0, 28);

export function tegn() {
  const body = $("emBody"); if (!body) return;
  body.innerHTML = html();
  body.querySelectorAll("[data-kilde]").forEach(b => b.onclick = () => { tilstand.kilde = b.dataset.kilde; tilstand.bilder = null; tegn(); });
  body.querySelectorAll(".em-rad").forEach(rad => {
    const key = rad.dataset.key;
    rad.querySelector(".em-med").onchange = (e) => { if (e.target.checked) tilstand.av.delete(key); else tilstand.av.add(key); tegn(); };
    rad.querySelector(".em-enhet").onchange = (e) => { tilstand.enheter[key] = e.target.value; delete tilstand.egnePriser[key]; tegn(); };
    rad.querySelector(".em-pris").onchange = (e) => {
      const v = String(e.target.value).replace(/\s/g, "").replace(",", ".");
      if (v === "") delete tilstand.egnePriser[key]; else if (isFinite(Number(v))) tilstand.egnePriser[key] = Number(v);
      tegn();
    };
    // Trykk på typen → vis det første elementet i modellen
    rad.querySelector("td:nth-child(2)").onclick = () => {
      const l = linjer().find(x => x.key === key);
      if (l && l.ider.length) { try { zoomToElement(l.ider[0]); } catch (_) {} }
    };
  });
  const tt = $("emTittel"); if (tt) tt.oninput = () => { tilstand.tittel = tt.value; };
  const nr = $("emNr"); if (nr) nr.oninput = () => { tilstand.emNr = nr.value; };
  const od = $("emOppdaget"); if (od) od.onchange = () => { tilstand.oppdaget = od.value || iDagISO(); tegn(); };
  const tb = $("emTaBilder"); if (tb) tb.onclick = taBilder;
  const harLinjer = linjer().some(l => !tilstand.av.has(l.key));
  if ($("emLag")) $("emLag").disabled = !harLinjer;
  if ($("emExcel")) $("emExcel").disabled = !harLinjer;
}

export async function taBilder() {
  const fangst = () => fangstBilde(1200, 800);
  if (tilstand.kilde === "sammenligning") {
    const b = await emBilder(fangst);
    tilstand.bilder = b ? { for: b.for, etter: b.etter } : null;
  } else tilstand.bilder = { for: null, etter: await fangst() };
  tegn();
}

// ---------- Excel ----------
export async function lastNedExcel() {
  const k = kildeData() || {};
  const rader = R.excelRader(valgte(), { fra: kortNavn(k.fra), til: kortNavn(k.til) });
  const navn = ((S.prosjektInfo && S.prosjektInfo().nummer) ? S.prosjektInfo().nummer + " " : "") +
    t("Endringsmelding mengder") + " " + iDagISO() + ".xlsx";
  await lastNedXlsxFlere(navn, [{ navn: t("Endringsmelding"), rader }]);
}

// ---------- Lag EM-utkast ----------
function dataUrlTilBlob(u) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(u || "")); if (!m) return null;
  const bin = atob(m[2]), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: m[1] });
}

export async function lagUtkast() {
  const L = valgte();
  if (!L.length) { varsel(t("Kryss av minst én linje først.")); return null; }
  const maler = await hentMaler();
  const mal = maler && maler.maler && maler.maler.find(m => m.id === EM_MAL_ID);
  if (!mal) {
    varsel(maler && maler.feil === "IKKE_INNLOGGET" ? t("Logg inn for å hente EM-skjemaet fra SharePoint.")
      : t("Fant ikke EM-skjemaet (Sjekklister/endringsmelding-v1.json) i SharePoint."));
    return null;
  }
  const k = kildeData() || { res: { ny: [], slettet: [], endret: [] } };
  const valgtKey = new Set(L.map(l => l.key));
  const punkter = [...k.res.ny, ...k.res.endret, ...k.res.slettet]
    .filter(e => valgtKey.has(R.typeNokkel(e.type) || "ukjent")).map(e => e.c);
  const sen = R.senter(punkter) || [0, 0, 0];
  const iDag = iDagISO(), frist = R.emFrist(tilstand.oppdaget || iDag, tilstand.fristDager);
  const tittel = String(tilstand.tittel || "").trim() || t("Endringsmelding fra modellen");
  const oppdagetTekst = String(tilstand.oppdaget || iDag).split("-").reverse().join(".");
  const c = vaskMarkering({ id: nyId(), text: tittel, author: innloggetNavn(), date: naaTekst(), status: "Åpen",
    owner: "", due: frist, x: sen[0], y: sen[1], z: sen[2], svar: [] });
  leggTilImportertMarkering(c);

  const skjema = nyttSkjema(mal);
  skjema.svar = {
    oversendtDato: iDag,
    varselnummer: (String(tilstand.emNr || "").trim() ? String(tilstand.emNr).trim() + " – " : "") + tittel,
    begrunnelse: R.faktablokk(L, { fra: kortNavn(k.fra), til: kortNavn(k.til), metode: k.metode,
      utvalg: k.utvalg, modell: kortNavn(k.modell), oppdaget: oppdagetTekst }),
    okonomi: R.ordrelinjer(L),
    annet: [t("Vedlegg:"), "• " + t("Bilder før og etter fra 3D-modellen"), "• " + t("Mengdeliste (Excel) fra Storm IFC-Viewer")].join("\n")
  };
  lagreSkjema(c, skjema);

  // Bildene → SharePoint, som Før- og Etter-bilde på markeringen
  let bildeFeil = 0;
  for (const [felt, kildeK, n] of [["bilder", "for", 1], ["bilderEtter", "etter", 2]]) {
    const b = tilstand.bilder && tilstand.bilder[kildeK];
    const blob = b && dataUrlTilBlob(b.data);
    if (!blob) continue;
    try { const navn = bildeNavn(c.id, n); await lastOpp(blob, navn); c[felt] = (c[felt] || []).concat(navn); }
    catch (_) { bildeFeil++; }
  }
  lagreOgSynk();
  if (S.pushAngre) S.pushAngre({ tekst: "Endringsmelding",
    angre: () => fjernImportertMarkering(c.id),
    gjenopprett: () => { if (!S.comments.some(x => x.id == c.id)) { leggTilImportertMarkering(c); lagreOgSynk(); } } });
  varsel(t("EM-utkast laget som markering. Gå gjennom skjemaet i markeringen, lås det og last ned PDF.") +
    (bildeFeil ? " " + t("{0} bilder ble ikke lastet opp (logg inn for å dele bilder).", bildeFeil) : ""));
  try { openMarkerPopup(c); } catch (_) {}
  return c;
}

// ---------- Knapper ----------
på("btnEm", "click", async () => {
  const p = $("emPanel");
  if (p && p.classList.contains("open")) { p.classList.remove("open"); return; }
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  apnePanel("emPanel");
  tegn();
  try { await hentPriser(); } catch (_) {}
  tegn();
});
på("emLag", "click", async () => {
  const b = $("emLag"); if (b) b.disabled = true;
  try { await lagUtkast(); } finally { tegn(); }
});
på("emExcel", "click", () => { lastNedExcel().catch(err => varsel(err.message)); });
