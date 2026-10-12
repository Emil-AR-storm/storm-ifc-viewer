// 📊 EKTE EXCEL-FIL (.xlsx), SKREVET FOR HÅND
//
// Hvorfor: CSV-en var riktig på Emils PC og feil i mailen (03.09). Grunnen er
// SKILLETEGNET. Excel på Windows leser CSV med Windows' listeskilletegn, som
// er «;» i norsk oppsett — men Excel på nett og forhåndsvisningen i Outlook
// bruker ALLTID «,». Da havner hele raden i kolonne A. `sep=;`-linja hjelper
// bare skrivebords-Excel, og en CSV med «,» ville brutt PC-en i stedet.
//
// En .xlsx har ingen skilletegn. Kolonnene ER kolonner i fila, og den åpnes
// likt i Excel på PC, Excel på nett, Outlook, Numbers og Google Sheets.
// I tillegg overlever SUM-formlene, og «MULIG TAP AV DATA»-advarselen
// forsvinner.
//
// En .xlsx er en ZIP med noen få XML-filer. ZIP-skriveren finnes alt (den
// skriver .bcfzip), så dette koster ingen ny tredjepart — bare XML-en.
// Modulen lastes DYNAMISK ved nedlasting, akkurat som bcf.js og sw-tegning.js,
// og ligger derfor ikke i lettmodus-skallet.
import { lagZip, tilBytes, xmlEsc } from "./bcf.js";
import { celleRef, kolBokstav, sumFormel } from "./regneark.js";
export { celleRef, kolBokstav, sumFormel };

// ---------- Tall, tekst eller formel? ----------
// Radene lages med NORSKE desimaltall («5,8») fordi de også skal kunne bli
// CSV. I en .xlsx må et tall være et tall med punktum, ellers står det som
// tekst og kan ikke summeres.
//
// Ledende null beskyttes: «0123» er en kode, ikke tallet 123. «0» og «0,5» er
// tall. Uten dette unntaket ville et elementnummer med null foran mistet den.
const NORSK_TALL = /^-?(0|[1-9]\d*)(,\d+)?$/;

export function celleVerdi(v) {
  if (v == null || v === "") return null;
  // 💰 Formel MED ferdig regnet svar: { formel: "=A1*B1", verdi: 42 }.
  // Excel i «Beskyttet visning» (fil fra nett/e-post) regner IKKE formler —
  // da viser cellen bare det som er lagret. Uten svaret sto alle summene
  // tomme til man trykket «Aktiver redigering» (Emil 12.10). Formelen står
  // fortsatt, så tallet regnes på nytt så snart noe endres.
  if (typeof v === "object" && typeof v.formel === "string") {
    const n = Number(v.verdi);
    return { formel: v.formel.replace(/^=/, ""), verdi: isFinite(n) ? n : undefined };
  }
  if (typeof v === "number") return isFinite(v) ? { tall: v } : null;
  const s = String(v);
  if (s[0] === "=") return { formel: s.slice(1) };
  if (NORSK_TALL.test(s)) {
    const n = Number(s.replace(",", "."));
    if (isFinite(n)) return { tall: n };
  }
  return { tekst: s };
}

// ---------- 🎨 Stiler (valgfritt) ----------
// 💰 Priskalkulasjonen (12.10): cellene du skal fylle inn er GULE, overskriftene
// fete, og kronebeløpene har tusenskille. Arkene uten `stil` skrives nøyaktig
// som før — da kommer heller ingen styles.xml med i fila.
// Indeksen er plassen i cellXfs nedenfor:
//   0 vanlig · 1 fet · 2 gul (fyll inn) · 3 overskrift (fet, grå) ·
//   4 tall 2 des. · 5 fet tall 2 des. · 6 tittel (stor, fet) · 7 gul tall 2 des.
export const STILER = ["vanlig", "fet", "gul", "overskrift", "tall", "fet-tall", "tittel", "gul-tall"];
export const STILER_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF3E1E2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function celleXml(rad, kol, v, s, hent) {
  const st = s ? ' s="' + s + '"' : "";
  const c = celleVerdi(v);
  if (c && c.formel !== undefined && c.verdi === undefined && hent) {
    const x = hent(rad, kol);
    if (isFinite(x)) c.verdi = Math.round(x * 1e9) / 1e9;
  }
  const r = celleRef(rad, kol);
  // En tom celle MED stil skrives likevel — den gule pris-cellen skal synes
  // før prisen er fylt inn.
  if (!c) return st ? '<c r="' + r + '"' + st + "/>" : "";
  if (c.formel) return '<c r="' + r + '"' + st + "><f>" + xmlEsc(c.formel) + "</f>" +
    (c.verdi !== undefined ? "<v>" + c.verdi + "</v>" : "") + "</c>";
  if (c.tall !== undefined) return '<c r="' + r + '"' + st + "><v>" + c.tall + "</v></c>";
  // Innebygd streng: sparer oss for hele sharedStrings-fila, og Excel,
  // Excel på nett, Numbers og Google Sheets leser den likt.
  return '<c r="' + r + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' +
    xmlEsc(c.tekst) + "</t></is></c>";
}

// ---------- 🧮 Ferdige svar for formlene (Emil 12.10) ----------
// En .xlsx som kommer fra nett eller e-post åpnes i «Beskyttet visning», og
// der regner ikke Excel formler: cellen viser bare det svaret som er LAGRET i
// fila. Vi lagret ingen svar, så alle summer sto tomme til man trykket
// «Aktiver redigering». Nå regnes svaret ut her og lagres sammen med formelen
// — i ALLE regneark programmet lager (Mengder, SW-lister, blikk, priser).
// Excel regner likevel på nytt ved redigering (fullCalcOnLoad i workbook.xml).
//
// Bare det enkle vi selv skriver: tall, cellereferanser (også $A$1), + − * /,
// parenteser og SUM(A1:A9). Alt annet gir ingen lagret verdi (som før).
function kolTall(bokst) { let n = 0; for (const c of bokst) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }
export function regnFormel(formel, hent) {
  const s = String(formel || "").replace(/^=/, "").replace(/\s+/g, "");
  let i = 0;
  const feil = () => { throw new Error("formel"); };
  const ref = () => {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return { k: kolTall(m[1]), r: Number(m[2]) - 1 };
  };
  const tallEller = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  function faktor() {
    if (s[i] === "(") { i++; const v = uttrykk(); if (s[i] !== ")") feil(); i++; return v; }
    if (s[i] === "-") { i++; return -faktor(); }
    if (s[i] === "+") { i++; return faktor(); }
    if (s.startsWith("SUM(", i)) {
      i += 4;
      const a = ref(); if (!a || s[i] !== ":") feil(); i++;
      const b = ref(); if (!b || s[i] !== ")") feil(); i++;
      let sum = 0;
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let k = Math.min(a.k, b.k); k <= Math.max(a.k, b.k); k++) sum += tallEller(hent(r, k));
      return sum;
    }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    const c = ref();
    if (c) return tallEller(hent(c.r, c.k));
    return feil();
  }
  function ledd() {
    let v = faktor();
    while (s[i] === "*" || s[i] === "/") { const op = s[i++]; const w = faktor(); v = op === "*" ? v * w : v / w; }
    return v;
  }
  function uttrykk() {
    let v = ledd();
    while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const w = ledd(); v = op === "+" ? v + w : v - w; }
    return v;
  }
  try {
    const v = uttrykk();
    return i === s.length && isFinite(v) ? v : undefined;
  } catch (_) { return undefined; }
}

// Svarene for et helt ark. Formler kan peke på andre formler (sum av
// linjesummer, mva av summen) — de regnes ved behov, med vakt mot sirkler.
export function arkSvar(rader) {
  const svar = new Map(), underveis = new Set();
  function hent(r, k) {
    const v = ((rader || [])[r] || [])[k];
    const c = celleVerdiRa(v);
    if (!c) return 0;
    if (c.tall !== undefined) return c.tall;
    if (c.formel === undefined) return 0;
    const nk = r + "," + k;
    if (svar.has(nk)) return svar.get(nk);
    if (underveis.has(nk)) return 0;
    underveis.add(nk);
    const x = c.verdi !== undefined ? c.verdi : regnFormel(c.formel, hent);
    underveis.delete(nk);
    svar.set(nk, x === undefined ? 0 : x);
    return svar.get(nk);
  }
  return hent;
}
function celleVerdiRa(v) { return celleVerdi(v); }

// oppsett (valgfritt): { stil(rad, kol) → indeks i STILER, bredder: [tegn per kolonne] }
export function arkXml(rader, oppsett) {
  const o = oppsett || {};
  const stilFn = typeof o.stil === "function" ? o.stil : null;
  const linjer = [];
  const hent = arkSvar(rader);
  (rader || []).forEach((rad, i) => {
    const r = rad || [];
    // Stilte celler kan stå UTENFOR det raden har verdier for (tom gul celle)
    let bredde = r.length;
    if (stilFn) for (let k = r.length; k < 30; k++) if (stilFn(i, k)) bredde = k + 1;
    const celler = [];
    for (let k = 0; k < bredde; k++) celler.push(celleXml(i, k, r[k], stilFn ? stilFn(i, k) : 0, hent));
    const x = celler.join("");
    if (x) linjer.push('<row r="' + (i + 1) + '">' + x + "</row>");
    else linjer.push('<row r="' + (i + 1) + '"/>');     // tom rad, men raden finnes
  });
  const kol = Array.isArray(o.bredder) && o.bredder.length
    ? "<cols>" + o.bredder.map((b, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Number(b) || 10) + '" customWidth="1"/>').join("") + "</cols>"
    : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    kol + "<sheetData>" + linjer.join("") + "</sheetData></worksheet>";
}

// Arknavnet: Excel tåler maks 31 tegn, og ikke : \ / ? * [ ]
export function arkNavn(navn) {
  const s = String(navn || "").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return s || "Ark1";
}

// Én arbeidsbok, ett eller flere ark. `xlsxFiler(navn, rader)` er det gamle
// kallet med ett ark; `xlsxFilerFlere([{ navn, rader }, …])` gir flere ark i
// samme fil — SW-lista i det første, «Materiell» i det andre (Emil 08.09).
export function xlsxFiler(navn, rader) {
  return xlsxFilerFlere([{ navn, rader }]);
}
export function xlsxFilerFlere(arkListe) {
  const ark = (arkListe || []).length ? arkListe : [{ navn: "Ark1", rader: [] }];
  // To ark kan ikke hete det samme — Excel nekter å åpne fila.
  const brukte = new Set();
  const navn = ark.map(a => {
    let n = arkNavn(a.navn), k = 2;
    while (brukte.has(n)) n = arkNavn(n.slice(0, 28) + " " + k++);
    brukte.add(n);
    return n;
  });
  const medStil = ark.some(a => a && (typeof a.stil === "function" || (a.bredder && a.bredder.length)));
  const filer = [
    { navn: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        ark.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
        (medStil ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : "") +
        "</Types>" },
    { navn: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>" },
    { navn: "xl/workbook.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + ark.map((_, i) => '<sheet name="' + xmlEsc(navn[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") +
        // Regn alt på nytt når fila åpnes for redigering — de lagrede svarene
        // er bare til «Beskyttet visning» og forhåndsvisningen i Outlook.
        '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
    { navn: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        ark.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
        (medStil ? '<Relationship Id="rId' + (ark.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : "") +
        "</Relationships>" }
  ];
  ark.forEach((a, i) => filer.push({ navn: "xl/worksheets/sheet" + (i + 1) + ".xml", data: arkXml(a.rader, a) }));
  if (medStil) filer.push({ navn: "xl/styles.xml", data: STILER_XML });
  return filer;
}

export function lagXlsx(navn, rader) {
  return lagZip(xlsxFiler(navn, rader).map(f => ({ navn: f.navn, data: tilBytes(f.data) })));
}
export function lagXlsxFlere(arkListe) {
  return lagZip(xlsxFilerFlere(arkListe).map(f => ({ navn: f.navn, data: tilBytes(f.data) })));
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
