// @-nevning i markeringer og kommentarer.
//
// HVORFOR EGEN MODUL: kommentartråden er flat (ingen «svar på svar»), så det
// fantes ingen måte å rette en melding til én bestemt person. Uten det må alle
// lese alt, og da leser ingen noe.
//
// NEVNINGER LAGRES IKKE som eget felt. De leses ut av teksten hver gang den
// vises, ved å lete etter «@» + et navn fra kandidatlista. Grunnen er at et
// eget felt måtte vaskes tre steder (vaskSvar, vaskMarkering og vasken i
// byggeplass.js), kunne komme i utakt med teksten hvis noen redigerte den, og
// gitt oss to sannheter om samme sak. Teksten er sannheten.
//
// KANDIDATLISTA ER ULIK PÅ KONTORET OG PÅ BYGGEPLASSEN:
//   Kontoret    – ansattlista fra oppsett.json (navn + Entra-GUID).
//   Byggeplassen – navnene som ALLEREDE står i markeringen (forfatter,
//                  kommentarforfattere, «endret av»). Ansattlista sendes med
//                  vilje ikke ut på byggeplass-adressen: den ligger åpent bak
//                  en 6-tegns kode, og en komplett liste over hvem som jobber i
//                  Storm hører ikke hjemme der. Montøren kan altså svare den
//                  som skrev til ham, men ikke bla i hele firmaet.

import { esc } from "./state.js";

// Navn kan inneholde mellomrom («Emil Andersen Rippel»), så vi kan ikke bare
// lete etter ett ord etter @. Vi prøver kandidatene, lengste først, slik at
// «Emil Andersen» ikke stjeler treffet fra «Emil Andersen Rippel».
const lengsteForst = (navn) => [...new Set(navn.filter(Boolean))].sort((a, b) => b.length - a.length);

// Hvem kan nevnes i denne markeringen?
export function nevnKandidater(c, ansatte) {
  if (ansatte && ansatte.length) return ansatte.map(a => a.navn);
  if (!c) return [];
  const ut = [c.author, c.endretAv];
  (Array.isArray(c.svar) ? c.svar : []).forEach(s => ut.push(s.forfatter));
  return [...new Set(ut.map(n => String(n || "").trim()).filter(Boolean))];
}

// Hvilke navn er faktisk nevnt i teksten?
export function finnNevnte(tekst, navn) {
  const s = String(tekst || "");
  const ut = [];
  for (const n of lengsteForst(navn)) {
    const i = s.toLowerCase().indexOf("@" + n.toLowerCase());
    if (i >= 0 && !ut.includes(n)) ut.push(n);
  }
  return ut;
}

// Tekst → trygg HTML med nevningene uthevet. Egen utheving når det er DEG som
// er nevnt, ellers går den i ett med resten og poenget forsvinner.
export function nevningHtml(tekst, navn, megNavn) {
  const s = String(tekst || "");
  const treff = [];
  const lav = s.toLowerCase();
  for (const n of lengsteForst(navn)) {
    const nal = "@" + n.toLowerCase();
    let fra = 0, i;
    while ((i = lav.indexOf(nal, fra)) >= 0) {
      // hopp over treff som overlapper et vi alt har tatt (lengste vant)
      if (!treff.some(t => i < t.slutt && i + nal.length > t.start))
        treff.push({ start: i, slutt: i + nal.length, navn: n });
      fra = i + nal.length;
    }
  }
  if (!treff.length) return esc(s);
  treff.sort((a, b) => a.start - b.start);
  let ut = "", pos = 0;
  const meg = String(megNavn || "").trim().toLowerCase();
  for (const t of treff) {
    ut += esc(s.slice(pos, t.start));
    const erMeg = meg && t.navn.toLowerCase() === meg;
    ut += '<span class="nevn' + (erMeg ? " meg" : "") + '">' + esc(s.slice(t.start, t.slutt)) + "</span>";
    pos = t.slutt;
  }
  return ut + esc(s.slice(pos));
}

// ---------- Autofullfør i et tekstfelt ----------
//
// Fanger «@» etterfulgt av det som skrives, og viser en liste. Piltaster og
// Enter/Tab velger, Esc lukker. Esc stoppes IKKE videre her — den som eier
// feltet (koblRedigering) bruker Esc til å avbryte, og skal fortsatt få den
// når lista er lukket.

const MAKS_TREFF = 6;

// Fragmentet mellom siste «@» og markøren, hvis vi står i en nevning.
function fragment(felt) {
  const pos = felt.selectionStart;
  const foran = felt.value.slice(0, pos);
  const i = foran.lastIndexOf("@");
  if (i < 0) return null;
  const etter = foran.slice(i + 1);
  if (/[\n\r]/.test(etter)) return null;          // @ på en tidligere linje
  if (etter.length > 40) return null;             // for langt til å være et navn
  if (i > 0 && /[^\s(\[]/.test(foran[i - 1])) return null; // e-post o.l.
  return { start: i, tekst: etter };
}

function passer(navn, frag) {
  if (!frag) return true;
  const f = frag.toLowerCase();
  const n = navn.toLowerCase();
  // treff på hele navnet, eller på et av fornavn/etternavn
  return n.startsWith(f) || n.split(/\s+/).some(del => del.startsWith(f));
}

// «navn» kan være en liste ELLER en funksjon som gir lista. Funksjonsvarianten
// er nødvendig fordi ansattlista hentes fra SharePoint etter at siden er lastet:
// en fast liste ville vært tom for alltid i de første sekundene.
export function koblNevning(felt, navn) {
  if (!felt) return;
  const hentNavn = () => {
    const n = typeof navn === "function" ? navn() : navn;
    return Array.isArray(n) ? n : [];
  };

  const liste = document.createElement("div");
  liste.className = "nevn-liste";
  liste.style.display = "none";
  felt.insertAdjacentElement("afterend", liste);

  let treff = [], valgt = 0, frag = null;

  const lukk = () => { liste.style.display = "none"; treff = []; frag = null; };

  const tegn = () => {
    liste.innerHTML = treff.map((n, i) =>
      '<div class="nevn-rad' + (i === valgt ? " valgt" : "") + '" data-i="' + i + '">' + esc(n) + "</div>"
    ).join("");
    liste.style.display = treff.length ? "block" : "none";
  };

  const velg = (i) => {
    if (!treff[i] || !frag) return;
    const foran = felt.value.slice(0, frag.start);
    const bak = felt.value.slice(felt.selectionStart);
    const inn = "@" + treff[i] + " ";
    felt.value = foran + inn + bak;
    const pos = foran.length + inn.length;
    felt.setSelectionRange(pos, pos);
    lukk();
    felt.focus();
  };

  const oppdater = () => {
    frag = fragment(felt);
    if (!frag) { lukk(); return; }
    treff = hentNavn().filter(n => passer(n, frag.tekst)).slice(0, MAKS_TREFF);
    valgt = 0;
    tegn();
  };

  felt.addEventListener("input", oppdater);
  felt.addEventListener("click", oppdater);
  felt.addEventListener("blur", () => setTimeout(lukk, 150)); // rekk å registrere klikk

  // Kjører FØR feltets egen onkeydown, så piltaster og Enter styrer lista når
  // den er åpen – og går videre til lagre/avbryt når den er lukket.
  felt.addEventListener("keydown", (e) => {
    if (liste.style.display === "none" || !treff.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); valgt = (valgt + 1) % treff.length; tegn(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); valgt = (valgt - 1 + treff.length) % treff.length; tegn(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); velg(valgt); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); lukk(); }
  }, true);

  liste.addEventListener("mousedown", (e) => {
    const rad = e.target.closest(".nevn-rad");
    if (!rad) return;
    e.preventDefault();                 // ikke ta fokus fra tekstfeltet
    velg(Number(rad.dataset.i));
  });
}
