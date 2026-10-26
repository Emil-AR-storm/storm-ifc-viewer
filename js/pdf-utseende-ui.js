// 🎨 Innstillinger → Utseende PDF (Emils valg C, 26.10.2026: liten
// forhåndsvisning i menyen).
//
// Seksjonen har fire deler:
//   1. En miniatyr av en PDF-side i de valgte fargene. Trykk på noe i den
//      (streken, overskriften, tabellhodet …) for å velge den fargen.
//   2. Runde fargeknapper for alle ni roller; den valgte vises med kode, en
//      fargevelger og ↺ (tilbake til standard for akkurat den).
//   3. Selskaper i bunnteksten: navn · uthevet del · etterledd.
//   4. Lagrede oppsett i SharePoint (PDF-utseende/oppsett.json) — én i firmaet
//      lagrer, alle andre velger det under «Lagrede». Personlig valg ligger i
//      S.settings.pdfUtseende og følger brukeren som de andre innstillingene.
//
// Lastes bare på kontoret (main.js, låst bak koden som PDF-verktøyene).
import { $, S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { LETT } from "./lett.js";
import { varsel } from "./varsel.js";
import { saveSettings } from "./prefs.js";
import { spLes, spSkriv } from "./sp-lager.js";
import { MAKS_SELSKAPER, PDF_ROLLER, PDF_STANDARD, erStandard, likeUtseender, pdfUtseende,
         selskapTekst, vaskUtseende } from "./pdf-utseende.js";

export const SP_MAPPE = "PDF-utseende";
export const SP_FIL = "oppsett.json";

let apen = false;
let valgtRolle = "hoved";
let lagrede = null;            // null = ikke hentet ennå
let lagredeStatus = "";        // "", "av", "feil", "ok"
let logoData = null, logoFil = null;

// ---------- Tilstand ----------
function sett(u) {
  S.settings.pdfUtseende = vaskUtseende(u);
  saveSettings();
}
function endre(fn) {
  const u = pdfUtseende();
  fn(u);
  delete u.kildeId; delete u.kildeNavn;   // endret = ikke lenger det lagrede oppsettet
  sett(u);
  tegnPaNytt();
}

// ---------- Miniatyren ----------
// Logoen er ORIGINALEN fra logo-systemet (aldri en gjenskaping, Emils regel).
// Uten logo står et grått felt med teksten «Logo».
async function hentLogoBilde() {
  const fil = S.settings && S.settings.rapLogo;
  if (!fil) { logoData = null; logoFil = null; return; }
  if (fil === logoFil && logoData) return;
  try {
    const { hentLogoer, hentLogo } = await import("./tegninger.js");
    const l = (await hentLogoer()).find(x => x.fil === fil);
    const b = l ? await hentLogo(l.itemId) : null;
    logoData = b && b.data ? b.data : null; logoFil = fil;
  } catch (_) { logoData = null; }
}

export function miniatyrHtml(u) {
  const F = vaskUtseende(u).farger, sel = vaskUtseende(u).selskaper;
  const r = (k) => ' data-rolle="' + k + '"';
  const logo = logoData
    ? '<img src="' + esc(logoData) + '" alt="" class="pu-logo">'
    : '<span class="pu-logo pu-logo-tom">' + esc(t("Logo")) + '</span>';
  const bunn = sel.map((x, i) =>
    (i ? '<i' + r("hoved") + ' style="color:' + F.hoved + '"> · </i>' : "") +
    '<b' + r("tekst") + ' style="color:' + F.tekst + '">' + esc(x.navn) + '</b> ' +
    '<b' + r("hoved") + ' style="color:' + F.hoved + '">' + esc(x.uthevet) + '</b> ' +
    '<small' + r("hjelpetekst") + ' style="color:' + F.hjelpetekst + '">' + esc(x.etterledd) + '</small>').join("");
  return '<div class="pu-side" title="' + esc(t("Trykk på noe i siden for å endre fargen der")) + '">' +
    '<div class="pu-topp">' + logo + '<span' + r("hjelpetekst") + ' style="color:' + F.hjelpetekst + '">' + esc(t("Revidert")) + '</span></div>' +
    '<div class="pu-strek"' + r("hoved") + ' style="background:' + F.hoved + '"></div>' +
    '<div class="pu-kick"' + r("hoved") + ' style="color:' + F.hoved + '">' + esc(t("SLIK JOBBER VI")) + '</div>' +
    '<div class="pu-tittel"' + r("tekst") + ' style="color:' + F.tekst + '">' + esc(t("Dokumenttittel")) + '</div>' +
    '<div class="pu-h3" style="border-color:' + F.hoved + '"' + r("hoved") + '><span' + r("tekst") + ' style="color:' + F.tekst + '">' + esc(t("Overskrift")) + '</span></div>' +
    '<div class="pu-boks"' + r("bokser") + ' style="background:' + F.bokser + ';border-color:' + F.linjer + '"><b' + r("overskrift") + ' style="color:' + F.overskrift + '">' + esc(t("Pauser")) + '</b> <span' + r("tekst") + ' style="color:' + F.tekst + '">10,75 t</span></div>' +
    '<table class="pu-tab"><tr' + r("tabellhode") + ' style="background:' + F.tabellhode + ';color:' + F.paFarge + '"><td' + r("paFarge") + '>' + esc(t("Uke")) + '</td><td' + r("paFarge") + '>' + esc(t("Man")) + '</td><td' + r("paFarge") + '>' + esc(t("Sum")) + '</td></tr>' +
      '<tr style="color:' + F.tekst + ';border-color:' + F.linjer + '"' + r("linjer") + '><td>1</td><td' + r("overskrift") + ' style="color:' + F.overskrift + '">' + esc(t("Reisedag")) + '</td><td' + r("overskrift") + ' style="color:' + F.overskrift + '">50,5</td></tr>' +
      '<tr' + r("lys") + ' style="background:' + F.lys + ';color:' + F.tekst + '"><td>' + esc(t("Sum")) + '</td><td></td><td>38,7</td></tr></table>' +
    '<div class="pu-bunn" style="border-color:' + F.hoved + '"' + r("hoved") + '>' + (logoData ? '<img src="' + esc(logoData) + '" alt="" class="pu-logo-liten">' : "") +
      '<span class="pu-sel">' + bunn + '</span></div>' +
    '</div>';
}

// ---------- HTML ----------
export function pdfUtseendeHtml() {
  if (LETT) return "";
  const u = pdfUtseende(), F = u.farger;
  const rolle = PDF_ROLLER.find(x => x.k === valgtRolle) || PDF_ROLLER[0];
  const merke = u.kildeNavn ? " · " + esc(u.kildeNavn) : (erStandard(u) ? "" : ' <span style="color:var(--warn)">(' + esc(t("endret")) + ")</span>");
  let h = '<details id="puSeksjon"' + (apen ? " open" : "") + '><summary><h4 style="display:inline">' + esc(t("Utseende PDF")) + "</h4>" + merke + "</summary>" +
    '<p class="pu-hjelp">' + esc(t("Gjelder alle PDF-er i systemet, unntatt konstruksjonstegninger fra Blikk, TRP og SW-generator. Logoen styres av logo-systemet (Prosjektinfo).")) + '</p>' +
    '<div class="pu-topprad"><div class="pu-mini">' + miniatyrHtml(u) + '</div>' +
      '<p class="pu-hjelp">' + esc(t("Trykk på noe i den lille siden for å endre fargen der — eller bruk knappene under. Siden viser endringen med en gang.")) + '</p></div>' +
    '<div class="pu-pal">' + PDF_ROLLER.map(x =>
      '<button class="pu-rund' + (x.k === rolle.k ? " valgt" : "") + (F[x.k] !== PDF_STANDARD[x.k] ? " endret" : "") + '" data-velg="' + x.k + '" title="' + esc(t(x.navn)) + '">' +
      '<span style="background:' + F[x.k] + '"></span><small>' + esc(t(x.navn)) + '</small></button>').join("") + '</div>' +
    '<div class="set-row pu-valgt"><span class="n">' + esc(t(rolle.navn)) + '<br><span class="pu-hjelp">' + esc(t(rolle.hjelp)) + '</span></span>' +
      '<span><code>' + esc(F[rolle.k]) + '</code> <input type="color" id="puFarge" value="' + esc(F[rolle.k]) + '">' +
      (F[rolle.k] !== PDF_STANDARD[rolle.k] ? ' <button id="puRolleStd" class="pu-lite" title="' + esc(t("Tilbake til standardfargen")) + '">' + ikon("nullstill") + '</button>' : "") +
      '</span></div>' +
    '<div class="prop-actions"><button id="puStd">' + ikon("nullstill") + ' ' + esc(t("Tilbakestill til standard")) + '</button></div>' +
    '<h5 class="pu-h5">' + esc(t("Selskaper i bunnteksten")) + '</h5>' +
    '<p class="pu-hjelp">' + esc(t("Navn · uthevet del (hovedfarge) · etterledd (grå)")) + '</p>' +
    u.selskaper.map((x, i) => '<div class="pu-sel3" data-i="' + i + '">' +
      '<input data-f="navn" value="' + esc(x.navn) + '" placeholder="' + esc(t("Navn")) + '">' +
      '<input data-f="uthevet" value="' + esc(x.uthevet) + '" placeholder="' + esc(t("Uthevet")) + '">' +
      '<input data-f="etterledd" value="' + esc(x.etterledd) + '" placeholder="AS">' +
      '<button class="pu-lite pu-fjern" title="' + esc(t("Fjern")) + '">' + ikon("lukk") + '</button></div>').join("") +
    (u.selskaper.length < MAKS_SELSKAPER ? '<button id="puNySel">+ ' + esc(t("Legg til selskap")) + '</button>' : "") +
    '<h5 class="pu-h5">' + esc(t("Lagrede oppsett (SharePoint)")) + '</h5>' +
    '<p class="pu-hjelp">' + esc(t("Lagres for alle i firmaet. Én lagrer — de andre velger det her.")) + '</p>';
  if (lagredeStatus === "av") h += '<p class="pu-hjelp">' + esc(t("Logg inn for å se og lagre felles oppsett.")) + '</p>';
  else if (lagredeStatus === "feil") h += '<p class="pu-hjelp" style="color:var(--danger)">' + esc(t("Fikk ikke hentet de lagrede oppsettene.")) + '</p>';
  else if (lagrede === null) h += '<p class="pu-hjelp">' + esc(t("Henter …")) + '</p>';
  else if (!lagrede.length) h += '<p class="pu-hjelp">' + esc(t("Ingen lagrede oppsett ennå.")) + '</p>';
  for (const p of lagrede || []) {
    const v = vaskUtseende(p), iBruk = u.kildeId === p.id && likeUtseender(u, v);
    h += '<div class="pu-lagret' + (iBruk ? " aktiv" : "") + '" data-id="' + esc(p.id) + '" title="' + esc(selskapTekst(v.selskaper)) + '">' +
      '<span class="pu-stripe">' + ["hoved", "overskrift", "tekst", "hjelpetekst", "lys", "tabellhode"].map(k => '<i style="background:' + v.farger[k] + '"></i>').join("") + '</span>' +
      '<span class="pu-nv">' + esc(p.navn) + '<small>' + esc([p.av, p.dato].filter(Boolean).join(" · ")) + (iBruk ? " · " + esc(t("i bruk")) : "") + '</small></span>' +
      (iBruk ? '<button class="pu-lite" disabled>' + ikon("hake") + '</button>' : '<button class="pu-bruk">' + esc(t("Bruk")) + '</button>') +
      '<button class="pu-lite pu-slett" title="' + esc(t("Slett for alle")) + '">' + ikon("lukk") + '</button></div>';
  }
  h += '<div class="pu-lagre"><input id="puNavn" maxlength="40" placeholder="' + esc(t("Navn, f.eks. «Storm 2027»")) + '"><button id="puLagre" class="primary">' + esc(t("Lagre")) + '</button></div>';
  return h + "</details>";
}
S.pdfUtseendeHtml = pdfUtseendeHtml;

// ---------- Kobling ----------
function tegnPaNytt() {
  const sek = $("puSeksjon");
  if (!sek) return;
  apen = sek.open;
  const ny = document.createElement("div");
  ny.innerHTML = pdfUtseendeHtml();
  sek.replaceWith(ny.firstChild);
  koblPdfUtseende();
}

export async function hentLagrede() {
  const r = await spLes(SP_MAPPE, SP_FIL);
  lagredeStatus = r.status;
  lagrede = r.status === "ok" || r.status === "tom"
    ? r.liste.filter(p => p && p.id && !p.slettet && p.navn).sort((a, b) => String(a.navn).localeCompare(String(b.navn), "no"))
    : [];
  return lagrede;
}

export async function lagreSom(navn) {
  const n = String(navn || "").trim().slice(0, 40);
  if (!n) { varsel(t("Skriv et navn på oppsettet først.")); return false; }
  const u = pdfUtseende();
  const finnes = (lagrede || []).find(p => p.navn.toLowerCase() === n.toLowerCase());
  if (finnes && !confirm(t("«{0}» finnes fra før. Skrive over det?", n))) return false;
  const nå = new Date();
  const post = { id: finnes ? finnes.id : "pu-" + nå.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    navn: n, farger: u.farger, selskaper: u.selskaper, av: (S.innloggetNavn ? S.innloggetNavn() : "") || "",
    dato: nå.toLocaleDateString("no-NO"), endret: nå.toISOString() };
  const res = await spSkriv(SP_MAPPE, SP_FIL, [post], (p) => String(p && p.id || ""));
  if (!res.ok) {
    varsel(res.grunn === "av" ? t("Logg inn for å lagre oppsettet i SharePoint.") : t("Fikk ikke lagret oppsettet i SharePoint. Prøv igjen."));
    return false;
  }
  sett(Object.assign({}, u, { kildeId: post.id, kildeNavn: post.navn }));
  lagrede = res.liste.filter(p => p && p.id && !p.slettet && p.navn).sort((a, b) => String(a.navn).localeCompare(String(b.navn), "no"));
  lagredeStatus = "ok";
  return true;
}

export function bruk(id) {
  const p = (lagrede || []).find(x => x.id === id);
  if (!p) return false;
  const for_ = pdfUtseende();
  sett(Object.assign(vaskUtseende(p), { kildeId: p.id, kildeNavn: p.navn }));
  if (S.pushAngre) S.pushAngre({ tekst: "Utseende PDF",
    angre: () => { sett(for_); tegnPaNytt(); },
    gjenopprett: () => { sett(Object.assign(vaskUtseende(p), { kildeId: p.id, kildeNavn: p.navn })); tegnPaNytt(); } });
  return true;
}

export async function slett(id) {
  const p = (lagrede || []).find(x => x.id === id);
  if (!p) return false;
  // Gravstein, ikke fjerning: da forsvinner det også hos de som har en
  // gammel kopi av lista (sp-flett.js).
  const res = await spSkriv(SP_MAPPE, SP_FIL, [{ id: p.id, navn: p.navn, slettet: true, endret: new Date().toISOString() }],
    (x) => String(x && x.id || ""));
  if (!res.ok) { varsel(t("Fikk ikke slettet oppsettet i SharePoint. Prøv igjen.")); return false; }
  lagrede = res.liste.filter(x => x && x.id && !x.slettet && x.navn).sort((a, b) => String(a.navn).localeCompare(String(b.navn), "no"));
  return true;
}

export function koblPdfUtseende() {
  const sek = $("puSeksjon");
  if (!sek) return;
  sek.ontoggle = () => {
    apen = sek.open;
    if (apen && lagrede === null) hentLagrede().then(tegnPaNytt);
    if (apen && S.settings.rapLogo && logoFil !== S.settings.rapLogo) hentLogoBilde().then(tegnPaNytt);
  };
  if (apen && lagrede === null) hentLagrede().then(tegnPaNytt);
  sek.querySelectorAll("[data-velg]").forEach(b => b.onclick = () => { valgtRolle = b.dataset.velg; tegnPaNytt(); });
  sek.querySelectorAll(".pu-side [data-rolle]").forEach(el => el.onclick = (e) => {
    e.stopPropagation(); valgtRolle = el.dataset.rolle; tegnPaNytt();
  });
  const ff = $("puFarge");
  // «change», ikke «input»: input fyrer for hvert musetrekk i fargehjulet
  if (ff) ff.onchange = () => { const f = ff.value; endre(u => { u.farger[valgtRolle] = f; }); };
  if ($("puRolleStd")) $("puRolleStd").onclick = () => endre(u => { u.farger[valgtRolle] = PDF_STANDARD[valgtRolle]; });
  $("puStd").onclick = () => {
    const for_ = pdfUtseende();
    sett({});
    if (S.pushAngre) S.pushAngre({ tekst: "Utseende PDF", angre: () => { sett(for_); tegnPaNytt(); }, gjenopprett: () => { sett({}); tegnPaNytt(); } });
    tegnPaNytt();
  };
  sek.querySelectorAll(".pu-sel3").forEach(rad => {
    const i = Number(rad.dataset.i);
    rad.querySelectorAll("input[data-f]").forEach(inp => {
      // Lagres ved hver bokstav, men tegnes IKKE på nytt (da mister feltet fokus);
      // miniatyren oppdateres når feltet forlates.
      inp.oninput = () => { const u = pdfUtseende(); if (u.selskaper[i]) { u.selskaper[i][inp.dataset.f] = inp.value; delete u.kildeId; delete u.kildeNavn; S.settings.pdfUtseende = u; saveSettings(); } };
      inp.onchange = () => { sett(pdfUtseende()); tegnPaNytt(); };
    });
    rad.querySelector(".pu-fjern").onclick = () => endre(u => { u.selskaper.splice(i, 1); });
  });
  if ($("puNySel")) $("puNySel").onclick = () => endre(u => { u.selskaper.push({ navn: "", uthevet: t("Nytt selskap"), etterledd: "AS" }); });
  sek.querySelectorAll(".pu-lagret").forEach(rad => {
    const id = rad.dataset.id;
    const b = rad.querySelector(".pu-bruk");
    if (b) b.onclick = () => { if (bruk(id)) tegnPaNytt(); };
    rad.querySelector(".pu-slett").onclick = async () => {
      const p = (lagrede || []).find(x => x.id === id);
      if (!p || !confirm(t("Slette «{0}» for alle i firmaet?", p.navn))) return;
      if (await slett(id)) tegnPaNytt();
    };
  });
  $("puLagre").onclick = async () => { if (await lagreSom($("puNavn").value)) tegnPaNytt(); };
  $("puNavn").onkeydown = (e) => { if (e.key === "Enter") $("puLagre").click(); };
}
S.koblPdfUtseende = koblPdfUtseende;
