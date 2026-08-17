// 🔁 BCF-eksport. Markeringene ut av Storm og inn i Solibri, Dalux, BIMcollab
// eller Revit — som ekte BCF-saker, ikke som en PDF noen må skrive av.
//
// Dette er det som lukker sløyfa: montøren melder avvik på byggeplassen, og
// prosjekterende får det tilbake i verktøyet sitt, koblet til RIKTIG element.
//
// TRE TING SOM STYRER FILA:
//
// 1. IfcGuid ER HELE POENGET. En BCF-sak uten elementreferanse er en tekstlapp
//    med et bilde. Med `globalId` på markeringen kan mottakerens verktøy velge
//    og zoome til nøyaktig den veggen. Markeringer uten globalId eksporteres
//    likevel — men uten Selection, og de teller som «uten elementreferanse» i
//    svaret, så brukeren får vite det.
//
// 2. KOORDINATENE REGNES OM, DE GJETTES IKKE. Visningen er Y-opp (web-ifc gir
//    geometrien slik), mens BCF vil ha IFC-verdenskoordinater i METER.
//    `S.koteMatrixInv` finnes fra før — den er inversen av web-ifcs
//    coordination matrix og brukes allerede av Kote-verktøyet til å vise ekte
//    høyder. Vi bruker den samme, og ganger med `S.enhetSkala` for å komme til
//    meter. Se `tilIfc()` for aksebyttet, som er samlet på ETT sted med vilje.
//
// 3. ZIP-EN SKRIVES FOR HÅND. En .bcfzip er små XML-filer og et par PNG-er.
//    Å dra inn et komprimeringsbibliotek for det ville lagt 100 kB og en ny
//    tredjepart på en side som allerede er streng med avhengigheter. ZIP med
//    lagring (metode 0) er gyldig ZIP, og det er 60 linjer.
import { S } from "./state.js";
import { t } from "./i18n.js";
import { STANDARD_GRENSER, hastegrad, iDagISO as fristIDag } from "./frist.js";

export const BCF_VERSJON = "2.1";

// ═══════════════════════ REN LOGIKK ═══════════════════════

// ---------- CRC32, som ZIP krever ----------
let crcTabell = null;
function crc32(bytes) {
  if (!crcTabell) {
    crcTabell = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTabell[i] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTabell[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function tilBytes(tekst) {
  return new TextEncoder().encode(String(tekst == null ? "" : tekst));
}

// data:image/png;base64,… → Uint8Array. Ugyldig inn gir null, ikke et kast:
// en BCF uten bilde er fortsatt en brukbar BCF.
export function dataUrlTilBytes(url) {
  const m = /^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const ut = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) ut[i] = bin.charCodeAt(i);
    return ut;
  } catch (_) { return null; }
}

// ---------- ZIP med lagring (metode 0) ----------
// Ingen komprimering. XML-ene er små, og alternativet er et bibliotek til.
export function lagZip(filer) {
  const enc = new TextEncoder();
  const deler = [], sentral = [];
  let forskyvning = 0;

  for (const f of filer) {
    const navn = enc.encode(f.navn);
    const data = f.data instanceof Uint8Array ? f.data : tilBytes(f.data);
    const crc = crc32(data);

    const lokal = new Uint8Array(30 + navn.length);
    const dv = new DataView(lokal.buffer);
    dv.setUint32(0, 0x04034b50, true);      // signatur
    dv.setUint16(4, 20, true);              // versjon som trengs
    dv.setUint16(6, 0x0800, true);          // flagg: UTF-8 i filnavn
    dv.setUint16(8, 0, true);               // metode 0 = lagret
    dv.setUint16(10, 0, true);              // tid — fast, se kommentar under
    dv.setUint16(12, 0x2821, true);         // dato: 2020-01-01
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, navn.length, true);
    dv.setUint16(28, 0, true);
    lokal.set(navn, 30);
    deler.push(lokal, data);

    const s = new Uint8Array(46 + navn.length);
    const sv = new DataView(s.buffer);
    sv.setUint32(0, 0x02014b50, true);
    sv.setUint16(4, 20, true); sv.setUint16(6, 20, true);
    sv.setUint16(8, 0x0800, true); sv.setUint16(10, 0, true);
    sv.setUint16(12, 0, true); sv.setUint16(14, 0x2821, true);
    sv.setUint32(16, crc, true);
    sv.setUint32(20, data.length, true);
    sv.setUint32(24, data.length, true);
    sv.setUint16(28, navn.length, true);
    sv.setUint32(42, forskyvning, true);
    s.set(navn, 46);
    sentral.push(s);

    forskyvning += lokal.length + data.length;
  }

  const sentralStart = forskyvning;
  let sentralLengde = 0;
  for (const s of sentral) { deler.push(s); sentralLengde += s.length; }

  const slutt = new Uint8Array(22);
  const ev = new DataView(slutt.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, filer.length, true);
  ev.setUint16(10, filer.length, true);
  ev.setUint32(12, sentralLengde, true);
  ev.setUint32(16, sentralStart, true);
  deler.push(slutt);

  let n = 0; for (const d of deler) n += d.length;
  const ut = new Uint8Array(n);
  let i = 0; for (const d of deler) { ut.set(d, i); i += d.length; }
  return ut;
}

// ---------- GUID ----------
// BCF vil ha en UUID per sak, kommentar og viewpoint. Markeringens egen id er
// «tid-tilfeldig» og ikke en UUID, så den kan ikke brukes rått.
export function nyGuid() {
  const b = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues
    ? crypto.getRandomValues(b)
    : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" +
         h.slice(16, 20) + "-" + h.slice(20);
}

// ---------- XML ----------
export function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    // Tegn XML 1.0 rett og slett ikke tillater. En talemelding eller et
    // filnavn med et kontrolltegn ville gjort HELE fila uleselig for mottakeren.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

// Markeringens norske dato «17.08.2026, 14:13» → ISO. BCF krever xs:dateTime,
// og et felt som ikke lar seg tolke skal stå TOMT, ikke som dagens dato — en
// oppdiktet opprettelsesdato er verre enn ingen.
export function tilIsoTid(norsk) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:,?\s+(\d{2}):(\d{2}))?/.exec(String(norsk || "").trim());
  if (!m) return "";
  return m[3] + "-" + m[2] + "-" + m[1] + "T" + (m[4] || "00") + ":" + (m[5] || "00") + ":00";
}

// Storms statuser → BCF. TopicStatus er utvidbar i BCF 2.1, men de tre under
// er de vanlige og forstås av Solibri, Dalux og BIMcollab.
export const STATUS_BCF = { "Åpen": "Open", "Pågår": "In Progress", "Løst": "Closed" };
export const HAST_BCF = { forfalt: "Critical", rod: "High", gul: "Normal", gronn: "Low", ukjent: "Normal" };

export function bcfStatus(s) { return STATUS_BCF[s] || "Open"; }

// ---------- Koordinater ----------
// Visningen er Y-opp. BCF vil ha IFC-verdenskoordinater i meter, og IFC er
// Z-opp. Aksebyttet ligger HER, på ett sted, så en retting er én linje.
//
// ADVARSEL TIL DEN SOM RETTER: fortegnet på Y er det eneste i denne fila som
// ikke er verifisert mot et ekte verktøy. Peker kameraet motsatt vei i Solibri,
// er det dette som skal snus — ikke noe annet. Elementreferansen (IfcGuid) er
// uansett riktig, så saken finner fram til rett vegg selv om kameraet bommer.
export function tilIfc(p, skala) {
  const s = Number(skala) || 1;
  return { x: p.x * s, y: -p.z * s, z: p.y * s };
}

export function rund(n) {
  const v = Number(n);
  return isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0;
}

function vektor(navn, v) {
  return "      <" + navn + ">\n" +
    "        <X>" + rund(v.x) + "</X>\n" +
    "        <Y>" + rund(v.y) + "</Y>\n" +
    "        <Z>" + rund(v.z) + "</Z>\n" +
    "      </" + navn + ">\n";
}

// ---------- markup.bcf ----------
// Rekkefølgen på elementene inne i <Topic> følger BCF 2.1-skjemaet. Bytter man
// om på dem, avviser strenge lesere hele fila.
export function markupXml(s) {
  const kommentarer = (s.kommentarer || []).map(k =>
    '  <Comment Guid="' + xmlEsc(k.guid) + '">\n' +
    (k.dato ? "    <Date>" + xmlEsc(k.dato) + "</Date>\n" : "") +
    (k.forfatter ? "    <Author>" + xmlEsc(k.forfatter) + "</Author>\n" : "") +
    "    <Comment>" + xmlEsc(k.tekst) + "</Comment>\n" +
    '    <Viewpoint Guid="' + xmlEsc(s.viewpointGuid) + '" />\n' +
    "  </Comment>\n").join("");

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    "<Markup>\n" +
    '  <Topic Guid="' + xmlEsc(s.guid) + '" TopicType="Issue" TopicStatus="' + xmlEsc(s.status) + '">\n' +
    "    <Title>" + xmlEsc(s.tittel) + "</Title>\n" +
    "    <Priority>" + xmlEsc(s.prioritet) + "</Priority>\n" +
    "    <Index>" + (Number(s.nr) || 0) + "</Index>\n" +
    (s.opprettet ? "    <CreationDate>" + xmlEsc(s.opprettet) + "</CreationDate>\n" : "") +
    (s.forfatter ? "    <CreationAuthor>" + xmlEsc(s.forfatter) + "</CreationAuthor>\n" : "") +
    (s.frist ? "    <DueDate>" + xmlEsc(s.frist) + "T00:00:00</DueDate>\n" : "") +
    (s.ansvarlig ? "    <AssignedTo>" + xmlEsc(s.ansvarlig) + "</AssignedTo>\n" : "") +
    (s.beskrivelse ? "    <Description>" + xmlEsc(s.beskrivelse) + "</Description>\n" : "") +
    "  </Topic>\n" +
    kommentarer +
    '  <Viewpoints Guid="' + xmlEsc(s.viewpointGuid) + '">\n' +
    "    <Viewpoint>viewpoint.bcfv</Viewpoint>\n" +
    (s.harBilde ? "    <Snapshot>snapshot.png</Snapshot>\n" : "") +
    "  </Viewpoints>\n" +
    "</Markup>\n";
}

// ---------- viewpoint.bcfv ----------
export function viewpointXml(s) {
  const valg = s.ifcGuid
    ? "    <Selection>\n" +
      '      <Component IfcGuid="' + xmlEsc(s.ifcGuid) + '" />\n' +
      "    </Selection>\n"
    : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<VisualizationInfo Guid="' + xmlEsc(s.viewpointGuid) + '">\n' +
    "  <Components>\n" + valg +
    '    <Visibility DefaultVisibility="true" />\n' +
    "  </Components>\n" +
    "  <PerspectiveCamera>\n" +
    vektor("CameraViewPoint", s.kamera.punkt) +
    vektor("CameraDirection", s.kamera.retning) +
    vektor("CameraUpVector", s.kamera.opp) +
    "    <FieldOfView>" + rund(s.kamera.synsfelt) + "</FieldOfView>\n" +
    "  </PerspectiveCamera>\n" +
    "</VisualizationInfo>\n";
}

export function versjonXml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Version VersionId="' + BCF_VERSJON + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    "  <DetailedVersion>" + BCF_VERSJON + "</DetailedVersion>\n" +
    "</Version>\n";
}

// Kameraet: står et stykke skrått over markeringen og ser ned på den. Avstanden
// følger modellens størrelse, så en prefab-enhet og et anlegg på en kilometer
// begge får et brukbart utsnitt.
export function byggKamera(mål, avstand) {
  const d = Math.max(Number(avstand) || 0, 2);
  const punkt = { x: mål.x + d * 0.6, y: mål.y - d * 0.75, z: mål.z + d * 0.45 };
  const retning = { x: mål.x - punkt.x, y: mål.y - punkt.y, z: mål.z - punkt.z };
  const len = Math.hypot(retning.x, retning.y, retning.z) || 1;
  return {
    punkt,
    retning: { x: retning.x / len, y: retning.y / len, z: retning.z / len },
    opp: { x: 0, y: 0, z: 1 },              // IFC er Z-opp
    synsfelt: 60
  };
}

// Én markering → én BCF-sak. Ren funksjon: alt som avhenger av visningen
// (skala, matrise, bilde) sendes inn.
export function byggSak(c, i, o) {
  const opt = o || {};
  const p = opt.tilIfcPunkt
    ? opt.tilIfcPunkt(c)
    : tilIfc({ x: c.x, y: c.y, z: c.z }, opt.skala);
  const svar = Array.isArray(c.svar) ? c.svar : [];
  const tittel = String(c.text || "").split("\n")[0].slice(0, 120) || t("Markering");

  return {
    guid: opt.guid || nyGuid(),
    viewpointGuid: opt.viewpointGuid || nyGuid(),
    nr: i + 1,
    tittel,
    beskrivelse: String(c.text || ""),
    status: bcfStatus(c.status),
    prioritet: HAST_BCF[opt.hast || "ukjent"] || "Normal",
    forfatter: String(c.author || ""),
    opprettet: tilIsoTid(c.date),
    frist: /^\d{4}-\d{2}-\d{2}$/.test(String(c.due || "")) ? c.due : "",
    ansvarlig: String(c.owner || ""),
    ifcGuid: String(c.globalId || ""),
    harBilde: !!opt.bilde,
    kamera: byggKamera(p, opt.avstand),
    kommentarer: svar.map(s => ({
      guid: nyGuid(),
      dato: tilIsoTid(s.dato),
      forfatter: String(s.forfatter || ""),
      tekst: String(s.tekst || "")
    })).filter(k => k.tekst.trim())
  };
}

// Hele eksporten som en liste ZIP-filer. Testes uten DOM.
export function byggFiler(saker, bilde) {
  const filer = [{ navn: "bcf.version", data: versjonXml() }];
  for (const s of saker) {
    filer.push({ navn: s.guid + "/markup.bcf", data: markupXml(s) });
    filer.push({ navn: s.guid + "/viewpoint.bcfv", data: viewpointXml(s) });
    if (s.harBilde && bilde) filer.push({ navn: s.guid + "/snapshot.png", data: bilde });
  }
  return filer;
}

export function bcfFilnavn(prosjekt, modell, iDag) {
  const p = prosjekt ? prosjekt + " " : "";
  const m = String(modell || "").replace(/\.(ifc|glb)$/i, "").replace(/[\\/:*?"<>|]/g, "-");
  return (p + (m ? m + " " : "") + "markeringer " + (iDag || "") + ".bcfzip").replace(/\s+/g, " ").trim();
}

// ═══════════════════════ NETTLESER ═══════════════════════

function lastNedFil(bytes, navn) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = navn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function iDagISO(naa) {
  const d = naa instanceof Date ? naa : new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

// Viewer-punkt → IFC-verdenskoordinat i meter. Bruker samme matrise som
// Kote-verktøyet, så høydene i BCF-en er de samme tallene brukeren ser i appen.
export function ifcPunkt(c) {
  let p = { x: Number(c.x) || 0, y: Number(c.y) || 0, z: Number(c.z) || 0 };
  if (S.koteMatrixInv && S.koteMatrixInv.elements) {
    const e = S.koteMatrixInv.elements;
    const x = p.x, y = p.y, z = p.z;
    p = {
      x: e[0] * x + e[4] * y + e[8]  * z + e[12],
      y: e[1] * x + e[5] * y + e[9]  * z + e[13],
      z: e[2] * x + e[6] * y + e[10] * z + e[14]
    };
  }
  return tilIfc(p, S.enhetSkala || 1);
}

// opts: { markeringer, modell, prosjekt, fangstBilde }
// Svar: { antall, utenElement, filnavn }
export async function eksporterBcf(opts) {
  const o = opts || {};
  const liste = (o.markeringer || []).filter(Boolean);
  if (!liste.length) throw new Error(t("Ingen markeringer å eksportere."));

  let bilde = null;
  try {
    const b = typeof o.fangstBilde === "function" ? await o.fangstBilde() : null;
    if (b && b.data) bilde = dataUrlTilBytes(b.data);
  } catch (_) { bilde = null; }

  const avstand = Math.max((Number(S.modelSize) || 20) * (S.enhetSkala || 1) * 0.08, 3);
  const saker = liste.map((c, i) => byggSak(c, i, {
    tilIfcPunkt: ifcPunkt,
    avstand,
    bilde,
    hast: hastegrad(c, S.settings && S.settings.frister ? S.settings.frister : STANDARD_GRENSER, fristIDag())
  }));

  const bytes = lagZip(byggFiler(saker, bilde));
  const navn = bcfFilnavn(o.prosjekt, o.modell, iDagISO());
  lastNedFil(bytes, navn);
  return {
    antall: saker.length,
    utenElement: saker.filter(s => !s.ifcGuid).length,
    filnavn: navn
  };
}
