// 🎨 Selve tegningen av en markeringsboble.
//
// HVORFOR EGEN FIL: dette er den ene delen av markeringene som er REN TEGNING —
// ingen tilstand, ingen three.js, ingen DOM utover et canvas den får utlevert.
// Skilt ut for at den skal kunne kjøres i Node med et ekte canvas, slik at
// _test/lag-markeringsbilde.mjs kan tegne alle 18 variantene og vise at
// glyfen ikke stikker utenfor og at ringen ikke klippes av canvaskanten.
//
// Ligger den inne i markers.js, kan den bare verifiseres med øynene på en
// telefon — og de to feilene den kan gjøre (glyf som stikker ut, ring som
// klippes) er akkurat store nok til å irritere og små nok til å overses.

// Størrelsen på teksturen. 128×128 er nok: markeringen tegnes aldri større enn
// MARKER_PX (26 px) på skjermen, uansett zoom.
export const TEKSTUR_PX = 128;
const M = TEKSTUR_PX / 2;          // midtpunktet

// Radien på selve bobla.
//
// Var 52 før fristringen kom. Fyllet krympes til 42 for å gi plass til ringen
// utenpå, UTEN at markeringen blir mindre på skjermen — MARKER_PX i markers.js
// styrer skjermstørrelsen, ikke denne radien. Teksturen skaleres opp til samme
// antall piksler uansett.
export const MARKER_R = 42;

// Radien glyfkoordinatene under er tegnet for. Endres MARKER_R, skaleres glyfen
// automatisk med. Uten dette stikker utropstegnet ut av bobla, og det ser ut som
// en renderingsfeil i stedet for det det er.
export const GLYF_R = 52;

// Ringen: innerkant, strektykkelse, og den tynne mørke ytterkanten.
// Ytterkanten på 60 + halve strektykkelsen (1,5) = 61,5 < 64. Går den utenfor,
// klippes ringen av canvaskanten.
export const RING_R = 53;
export const RING_TYKK = 12;
export const YTTER_R = 60;
export const YTTER_TYKK = 3;

export const MARKER_KANT = "#14181f";   // samme mørke som bakgrunnen (scene.js)

// Glyfen TEGNES med linjer i stedet for fillText: fonttegn som ➜ og ✓ finnes
// ikke i alle sans-serif-fallbacker, og en tofu-boks inne i 3D-scenen er
// vanskelig å feilsøke. Strektegning gir samme resultat på alle plattformer.
export function tegnGlyf(ctx, glyph) {
  // ctx.scale() skalerer også lineWidth, og det er ønsket: glyfen skal tynnes
  // proporsjonalt sammen med bobla, ikke stå igjen som en fet strek i en
  // mindre sirkel.
  const k = MARKER_R / GLYF_R;
  ctx.save();
  ctx.translate(M, M); ctx.scale(k, k); ctx.translate(-M, -M);
  ctx.strokeStyle = MARKER_KANT;
  ctx.fillStyle = MARKER_KANT;
  ctx.lineWidth = 13;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (glyph === "!") {                    // Åpen: utropstegn
    ctx.moveTo(64, 34); ctx.lineTo(64, 72);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(64, 93, 8, 0, Math.PI * 2); ctx.fill();
  } else if (glyph === "➜") {             // Pågår: pil mot høyre
    ctx.moveTo(36, 64); ctx.lineTo(86, 64);
    ctx.moveTo(64, 42); ctx.lineTo(88, 64); ctx.lineTo(64, 86);
    ctx.stroke();
  } else {                                // Løst: hake
    ctx.moveTo(38, 66); ctx.lineTo(56, 84); ctx.lineTo(90, 46);
    ctx.stroke();
  }
  ctx.restore();
}

// FYLL = STATUS, RING = FRIST.
//
// To opplysninger i én boble. Innsiden sier hva som skjer (gul ! = åpen,
// blå ➜ = pågår, grønn ✓ = løst), ringen sier hvor mye det haster.
//
// Hvorfor ikke la fyllfargen følge fristen: «Åpen» er allerede gul og «Løst» er
// allerede grønn i STATUS. En grønn boble ville da betydd både «god tid» og
// «ferdig» — samme farge, motsatt handling. Det er den typen feil som ikke
// oppdages, fordi begge ser riktige ut.
//
// Glyfen bærer statusen uansett, så en fargeblind leser (rundt 8 % av mennene
// på en byggeplass) mister ingen informasjon.
//
// `lagCanvas` finnes for testens skyld: i nettleseren er den udefinert og vi
// bruker document, i Node sendes en fabrikk fra node-canvas inn.
export function tegnMarkering(col, glyph, ringFarge, lagCanvas) {
  const c = lagCanvas ? lagCanvas(TEKSTUR_PX, TEKSTUR_PX) : document.createElement("canvas");
  if (!lagCanvas) c.width = c.height = TEKSTUR_PX;
  const ctx = c.getContext("2d");

  ctx.beginPath(); ctx.arc(M, M, MARKER_R, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  // Mørk kant mellom fyll og ring. Uten den forsvinner en gul ring mot det
  // ravgule fyllet til status «Åpen».
  ctx.lineWidth = 8; ctx.strokeStyle = MARKER_KANT; ctx.stroke();

  if (ringFarge) {
    ctx.beginPath(); ctx.arc(M, M, RING_R, 0, Math.PI * 2);
    ctx.lineWidth = RING_TYKK; ctx.strokeStyle = ringFarge; ctx.stroke();
    // Tynn mørk ytterkant, så ringen leses mot lys 3D-bakgrunn også.
    ctx.beginPath(); ctx.arc(M, M, YTTER_R, 0, Math.PI * 2);
    ctx.lineWidth = YTTER_TYKK; ctx.strokeStyle = MARKER_KANT; ctx.stroke();
  }

  tegnGlyf(ctx, glyph);
  return c;
}
