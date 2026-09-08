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

function celleXml(rad, kol, v) {
  const c = celleVerdi(v);
  if (!c) return "";
  const r = celleRef(rad, kol);
  if (c.formel) return '<c r="' + r + '"><f>' + xmlEsc(c.formel) + "</f></c>";
  if (c.tall !== undefined) return '<c r="' + r + '"><v>' + c.tall + "</v></c>";
  // Innebygd streng: sparer oss for hele sharedStrings-fila, og Excel,
  // Excel på nett, Numbers og Google Sheets leser den likt.
  return '<c r="' + r + '" t="inlineStr"><is><t xml:space="preserve">' +
    xmlEsc(c.tekst) + "</t></is></c>";
}

export function arkXml(rader) {
  const linjer = [];
  (rader || []).forEach((rad, i) => {
    const celler = (rad || []).map((v, k) => celleXml(i, k, v)).join("");
    if (celler) linjer.push('<row r="' + (i + 1) + '">' + celler + "</row>");
    else linjer.push('<row r="' + (i + 1) + '"/>');     // tom rad, men raden finnes
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>" + linjer.join("") + "</sheetData></worksheet>";
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
  const filer = [
    { navn: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        ark.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
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
        "</Relationships>" }
  ];
  ark.forEach((a, i) => filer.push({ navn: "xl/worksheets/sheet" + (i + 1) + ".xml", data: arkXml(a.rader) }));
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
