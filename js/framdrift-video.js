// 🎞 Framdriftsplan — VIDEOEN (trinn 5). Lastes først når noen trykker «Lag
// video» (dynamisk import fra framdrift.js).
//
// Emils spørsmål 01.10: «går det an og få ut en mp4 video som viser
// framdriftsplanen, eksempel et kamera som spinner sakte 360 grader rundt
// byggeplassen mens det vises at byggeplassen blir gradvis utfylt med hvert
// steg fra framdriftsplanen». Svaret er denne fila:
//   • kameraet går én gang rundt, 35° ned (samme vinkel som PDF-bildene)
//   • hvert trinn får like lang tid og bygges nedenfra og opp, som på glideren
//   • det som ikke ligger i noe trinn, er ikke med (Emil 01.10)
//   • trinnets navn og datoer står oppe til venstre, en trinnlinje nederst
//   • etter videoen: lastes ned, og lagres i SharePoint (Framdriftsplan) —
//     PDF-en får da en QR-kode til den på hver side
//
// MP4 der nettleseren kan lage det (WebCodecs + mp4-muxer, selvhostet i
// vendor/): bildene tegnes i sitt eget tempo og får riktige tidsstempler, så
// videoen blir jevn selv om hvert bilde tar et tiendels sekund å tegne. Ellers
// WebM via MediaRecorder i sanntid.
import * as THREE from "three";
import { S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { lastNedFil, norskDato } from "./rapport.js";
import { OVERSIKT_FOV, OVERSIKT_VINKEL, oversiktAvstand } from "./rigg-regn.js";
import { bildeOkt, lastEtterbehandling } from "./riggplan.js";
import { framdriftGroup, settVideoModus, tegnFramdrift } from "./framdrift-vis.js";
import { skjulIkkeInnhold, utsnitt } from "./framdrift-pdf.js";
import { spLastOpp, spPaalogget } from "./sp-lager.js";
import { pdfTrinn, trinnTittel, videoPlan, videoFilnavn, VIDEO } from "./framdrift-regn.js";

export const SP_MAPPE = "Framdriftsplan";
export const spVideoFil = (ext) => String(S.fileName || "modell") + ".framdrift." + ext;

// Kodekene vi prøver, best først. H.264 spilles av overalt (også iPhone);
// VP9 i MP4 er reserven der nettleseren ikke har H.264-koder.
const KODEKER = [
  { codec: "avc1.640028", muxer: "avc" }, { codec: "avc1.4d0028", muxer: "avc" },
  { codec: "avc1.42001f", muxer: "avc" }, { codec: "vp09.00.40.08", muxer: "vp9" }
];
async function velgKodek(W, H, Vo) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const k of KODEKER) {
    const cfg = { codec: k.codec, width: W, height: H, bitrate: Vo.bitrate, framerate: Vo.fps };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return { cfg, muxer: k.muxer }; } catch (_) {}
  }
  return null;
}

// ═══════════ BILDET: SCENEN + TEKSTEN ═══════════
function tegnTekst(ctx, W, H, plan, f, liste) {
  const s = H / 720;
  const e = plan.trinnVed(f);
  // Tittelboksen oppe til venstre
  const tittel = e ? trinnTittel(e, t("Trinn")) : t("Framdriftsplan");
  const dato = e ? [norskDato(e.dato), norskDato(e.slutt)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" – ") : "";
  ctx.font = "700 " + Math.round(30 * s) + "px system-ui, sans-serif";
  const bt = Math.max(ctx.measureText(tittel).width, (ctx.font = "600 " + Math.round(22 * s) + "px system-ui, sans-serif", ctx.measureText(dato).width));
  const bx = 28 * s, by = 26 * s, bb = bt + 44 * s, bh = (dato ? 92 : 62) * s;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bb, bh, 12 * s) : ctx.rect(bx, by, bb, bh); ctx.fill();
  if (e) { ctx.fillStyle = e.farge; ctx.fillRect(bx, by, 7 * s, bh); }
  ctx.fillStyle = "#14161a"; ctx.font = "700 " + Math.round(30 * s) + "px system-ui, sans-serif";
  ctx.fillText(tittel, bx + 22 * s, by + 42 * s);
  if (dato) { ctx.fillStyle = e ? e.farge : "#6b7280"; ctx.font = "600 " + Math.round(22 * s) + "px system-ui, sans-serif"; ctx.fillText(dato, bx + 22 * s, by + 76 * s); }
  // Trinnlinja nederst: ett felt per trinn, fylt etter hvert
  const lx = 28 * s, lb = W - 56 * s, ly = H - 40 * s, lh = 10 * s, n = liste.length;
  const mel = 4 * s, fb = (lb - mel * (n - 1)) / n;
  liste.forEach((x, i) => {
    const p = plan.andel(x, f);
    const fx = lx + i * (fb + mel);
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(fx, ly, fb, lh);
    ctx.fillStyle = x.farge; ctx.fillRect(fx, ly, fb * p, lh);
  });
  ctx.fillStyle = "rgba(20,22,26,0.7)"; ctx.font = "600 " + Math.round(15 * s) + "px system-ui, sans-serif";
  ctx.fillText("Storm · " + t("Framdriftsplan"), lx, ly - 10 * s);
}

// ═══════════════════════ HOVEDINNGANGEN ═══════════════════════
// Returnerer { blob, type, ext, sekunder, url? } eller null.
export async function lagFramdriftVideo() {
  const liste = pdfTrinn(S.framdrift);
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return null; }
  if (!liste.length) { alert(t("Legg noe i et trinn først — planen er tom.")); return null; }
  const vis = (tekst) => { if (loadingText) loadingText.textContent = tekst; };
  if (loadingEl) loadingEl.classList.add("open");
  let okt = null, ryddScene = null;
  try {
    vis(t("Lager video …"));
    await lastEtterbehandling();
    await (await import("./framdrift-kilde.js")).forberedKilder();
    // Utsnittet: bare det som ligger i et trinn (resten er ikke med i videoen)
    const u = utsnitt([...new Set(liste.flatMap(e => e.objekter.map(o => o.k)))]);
    if (!u) throw new Error(t("Fant ingenting å tegne."));
    // S.framdriftVideoTest: testene kan krympe videoen (færre og mindre bilder)
    const Vo = Object.assign({}, VIDEO, S.framdriftVideoTest || {});
    const W = Vo.b, H = Vo.h, ss = Vo.overSampling;
    const RW = Math.round(W * ss), RH = Math.round(H * ss);
    const plan = videoPlan(liste, Vo);
    // Kameraet: rundt senteret, OVERSIKT_VINKEL ned, så langt unna at hele
    // tomta får plass i alle retninger
    const v = OVERSIKT_VINKEL * Math.PI / 180;
    // Høye ting (tårnkranen) skal også få plass: radien er den største av
    // tomtas halve bredde og høyden (i meter)
    const hoydeM = Math.max(0, (u.toppY - u.bunnY) * u.base.skala);
    const avstand = oversiktAvstand(Math.max(u.rM, hoydeM * 0.8), OVERSIKT_FOV, W / H) / u.base.skala * Vo.avstand;
    const mål = new THREE.Vector3(u.senter.x, u.bunnY + (u.toppY - u.bunnY) * 0.25, u.senter.z);
    const kam = new THREE.PerspectiveCamera(OVERSIKT_FOV, W / H, avstand / 1000, avstand * 20);
    const start = Math.atan2(-u.nord.z, -u.nord.x);     // fra sør, som PDF-bildet «sett fra sør»
    const settKamera = (f) => {
      const a = start + plan.vinkel(f);
      kam.position.set(mål.x + Math.cos(a) * Math.cos(v) * avstand, mål.y + Math.sin(v) * avstand, mål.z + Math.sin(a) * Math.cos(v) * avstand);
      kam.lookAt(mål); kam.updateProjectionMatrix(); kam.updateMatrixWorld(true);
    };
    // Utvalgsmarkering, mål, akser og håndtak fra skjermen er ikke med
    ryddScene = skjulIkkeInnhold([framdriftGroup]);
    okt = bildeOkt({ skygge: { senter: mål, radius: u.rM * 1.2 / u.base.skala, skala: u.base.skala, nord: u.nord, ost: u.ost }, himmel: true, taake: [avstand * 0.8, avstand * 2.8] }, RW, RH);
    // Glideren styres av videoens klokke mens bildene tegnes
    let fNaa = 0;
    settVideoModus((e) => plan.andel(e, fNaa));
    // To lerreter: det store (scenen, radene snudd) og videobildet
    const stor = document.createElement("canvas"); stor.width = RW; stor.height = RH;
    const sctx = stor.getContext("2d"); const img = sctx.createImageData(RW, RH);
    const lerret = document.createElement("canvas"); lerret.width = W; lerret.height = H;
    const ctx = lerret.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const tegnBilde = (f) => {
      fNaa = f;
      tegnFramdrift(true);
      ryddScene.igjen();
      settKamera(f);
      const px = okt.tegn(kam);
      for (let y = 0; y < RH; y++) img.data.set(px.subarray((RH - 1 - y) * RW * 4, (RH - y) * RW * 4), y * RW * 4);
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(stor, 0, 0, W, H);
      tegnTekst(ctx, W, H, plan, f, liste);
    };
    const kodek = await velgKodek(W, H, Vo);
    let blob, type, ext;
    // MP4-pakkeren hentes først nå. Mangler fila på nettsiden (Emil 01.10:
    // den var ikke lastet opp til GitHub), lages videoen likevel — som WebM
    // i sanntid — i stedet for at alt stopper med en feilmelding.
    let M = null;
    if (kodek) {
      try { M = await import("../vendor/mp4-muxer-5.2.2.mjs"); }
      catch (err) { console.warn("Framdriftsvideo: MP4-pakkeren lastet ikke, bruker reserven:", err && err.message); M = null; }
    }
    if (kodek && M) {
      const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: kodek.muxer, width: W, height: H, frameRate: Vo.fps }, fastStart: "in-memory" });
      let feil = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { feil = e; } });
      enc.configure(kodek.cfg);
      const dur = 1e6 / Vo.fps;
      for (let f = 0; f < plan.bilder; f++) {
        if (feil) throw feil;
        tegnBilde(f);
        const vf = new VideoFrame(lerret, { timestamp: Math.round(f * dur), duration: Math.round(dur) });
        enc.encode(vf, { keyFrame: f % (Vo.fps * 2) === 0 });
        vf.close();
        if (f % 5 === 0) {
          vis(t("Lager video … {0} %", Math.round(f / plan.bilder * 100)));
          await new Promise(r => setTimeout(r, 0));
        }
        while (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5));
      }
      await enc.flush();
      if (feil) throw feil;
      muxer.finalize();
      enc.close();
      blob = new Blob([muxer.target.buffer], { type: "video/mp4" }); type = "video/mp4"; ext = "mp4";
    } else {
      // Reserven: MediaRecorder tar opp lerretet i SANNTID, så bildene må
      // komme i takt med klokka — et bilde som tegnes for sent, hoppes over.
      if (typeof MediaRecorder === "undefined" || !lerret.captureStream) throw new Error(t("Nettleseren kan ikke lage video."));
      const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
      const strom = lerret.captureStream(Vo.fps);
      const opptak = new MediaRecorder(strom, { mimeType: mime, videoBitsPerSecond: Vo.bitrate });
      const biter = [];
      opptak.ondataavailable = (ev) => { if (ev.data && ev.data.size) biter.push(ev.data); };
      const ferdig = new Promise(r => { opptak.onstop = r; });
      tegnBilde(0);
      opptak.start(1000);
      const t0 = performance.now(), varighet = plan.bilder / Vo.fps * 1000;
      for (;;) {
        const tid = performance.now() - t0;
        if (tid >= varighet) break;
        tegnBilde(Math.min(plan.bilder - 1, Math.floor(tid / 1000 * Vo.fps)));
        vis(t("Lager video … {0} %", Math.round(tid / varighet * 100)));
        await new Promise(r => setTimeout(r, 0));
      }
      opptak.stop();
      await ferdig;
      type = mime.split(";")[0]; ext = type === "video/mp4" ? "mp4" : "webm";
      blob = new Blob(biter, { type });
    }
    const iDag = new Date().toISOString().slice(0, 10);
    lastNedFil(blob, videoFilnavn(S.fileName, iDag, ext));
    // SharePoint: QR-koden på PDF-en peker hit
    let url = "";
    if (spPaalogget()) {
      vis(t("Lagrer videoen i SharePoint …"));
      const r = await spLastOpp(SP_MAPPE, spVideoFil(ext), blob, type);
      url = (r && r.ok && r.webUrl) || "";
    }
    return { blob, type, ext, sekunder: plan.bilder / Vo.fps, url, bilder: plan.bilder };
  } catch (err) {
    console.warn("Framdriftsvideoen feilet:", err);
    alert(t("Klarte ikke å lage videoen: {0}", err.message || String(err)));
    return null;
  } finally {
    settVideoModus(null);
    tegnFramdrift(false);
    if (okt) okt.slutt();
    if (ryddScene) ryddScene();
    if (loadingEl) loadingEl.classList.remove("open");
  }
}
