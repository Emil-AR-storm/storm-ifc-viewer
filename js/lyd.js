// 🎤 Talemelding på markeringer.
//
// HVORFOR: montøren står med hansker, i kulde, ofte i regn, og skal skrive en
// avviksmelding på en telefonskjerm. Det er derfor meldingene blir korte og
// upresise – ikke fordi han ikke har mer å si.
//
// HVORFOR OPPTAK OG IKKE DIKTERING: nettleserens tale-til-tekst
// (SpeechRecognition) ville gitt søkbar tekst, men sender lyden til Google
// eller Apple. Viewer-en lover at ingenting lastes opp, og Storm har full
// kontroll på både SharePoint og sin egen Worker. Et lydopptak blir liggende i
// Storms egne systemer, akkurat som bildene. Vil dere ha tekst i tillegg
// senere, kan transkriberingen gjøres på Storms side av lydfila.
//
// FORMAT: MediaRecorder gir ikke samme format på tvers. Safari/iOS gir
// audio/mp4 (.m4a), Chrome/Android gir audio/webm (.webm). Begge lagres og
// serveres som de er – ingen konvertering i nettleseren, som ville kostet
// minne og tid på en telefon.

import { t } from "./i18n.js";

export const MAKS_SEKUNDER = 120;   // to minutter er rikelig for et avvik

// Rekkefølgen er med vilje: mp4 først, fordi Safari støtter BARE den, mens
// Chrome støtter begge. Da får hver nettleser sitt beste format.
const FORMATER = [
  { mime: "audio/mp4", endelse: "m4a" },
  { mime: "audio/webm;codecs=opus", endelse: "webm" },
  { mime: "audio/webm", endelse: "webm" }
];

export function stottetFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const f of FORMATER) {
    try { if (MediaRecorder.isTypeSupported(f.mime)) return f; } catch (_) {}
  }
  return null;
}

export function lydStottes() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && stottetFormat());
}

export function fmtTid(sek) {
  const s = Math.max(0, Math.round(sek));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Starter et opptak. Gir tilbake en kontroll med stopp() og avbryt().
//
// Mikrofonen SLIPPES ALLTID etterpå (stream.getTracks().forEach(stop)). Uten
// det blir opptaksindikatoren stående på i telefonens statuslinje lenge etter
// at markeringen er lagret, og det ser ut som appen lytter i skjul.
export async function startOpptak(paTikk) {
  const f = stottetFormat();
  if (!f) throw new Error(t("Denne nettleseren kan ikke ta opp lyd."));
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream, { mimeType: f.mime });
  const biter = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) biter.push(e.data); };

  const start = Date.now();
  let tikker = null;
  const rydd = () => {
    if (tikker) { clearInterval(tikker); tikker = null; }
    stream.getTracks().forEach(sp => sp.stop());
  };

  // Egen flagg-variabel, ikke bare tømming av «biter»: MediaRecorder sender én
  // siste ondataavailable ETTER stop(), så en tømt liste fylles opp igjen og
  // avbryt() ville levert et opptak brukeren trodde han kastet.
  let avbrutt = false;

  const ferdig = new Promise((res) => {
    rec.onstop = () => {
      rydd();
      if (avbrutt || !biter.length) { res(null); return; }
      res({ blob: new Blob(biter, { type: f.mime }), endelse: f.endelse,
            sekunder: (Date.now() - start) / 1000 });
    };
  });

  rec.start();
  if (paTikk) {
    paTikk(0);
    tikker = setInterval(() => {
      const gatt = (Date.now() - start) / 1000;
      paTikk(gatt);
      // Hardt tak: en telefon i lomma kan ellers ta opp til minnet er fullt.
      if (gatt >= MAKS_SEKUNDER && rec.state === "recording") rec.stop();
    }, 250);
  }

  return {
    stopp() { if (rec.state === "recording") rec.stop(); return ferdig; },
    avbryt() { avbrutt = true; if (rec.state === "recording") rec.stop(); else rydd(); return ferdig; },
    get aktiv() { return rec.state === "recording"; }
  };
}
