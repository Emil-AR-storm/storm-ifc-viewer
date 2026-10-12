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

function celleXml(rad, kol, v, s) {
  const st = s ? ' s="' + s + '"' : "";
  const c = celleVerdi(v);
  const r = celleRef(rad, kol);
  // En tom celle MED stil skrives likevel — den gule pris-cellen skal synes
  // før prisen er fylt inn.
  if (!c) return st ? '<c r="' + r + '"' + st + "/>" : "";
  if (c.formel) return '<c r="' + r + '"' + st + "><f>" + xmlEsc(c.formel) + "</f></c>";
  if (c.tall !== undefined) return '<c r="' + r + '"' + st + "><v>" + c.tall + "</v></c>";
  // Innebygd streng: sparer oss for hele sharedStrings-fila, og Excel,
  // Excel på nett, Numbers og Google Sheets leser den likt.
  return '<c r="' + r + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' +
    xmlEsc(c.tekst) + "</t></is></c>";
}

// oppsett (valgfritt): { stil(rad, kol) → indeks i STILER, bredder: [tegn per kolonne] }
export function arkXml(rader, oppsett) {
  const o = oppsett || {};
  const stilFn = typeof o.stil === "function" ? o.stil : null;
  const linjer = [];
  (rader || []).forEach((rad, i) => {
    const r = rad || [];
    // Stilte celler kan stå UTENFOR det raden har verdier for (tom gul celle)
    let bredde = r.length;
    if (stilFn) for (let k = r.length; k < 30; k++) if (stilFn(i, k)) bredde = k + 1;
    const celler = [];
    for (let k = 0; k < bredde; k++) celler.push(celleXml(i, k, r[k], stilFn ? stilFn(i, k) : 0));
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
        '</sheets></workbook>' },
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
