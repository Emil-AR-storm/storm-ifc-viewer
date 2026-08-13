// Storm byggeplass-Worker — trinn 3-utgave.
// Nytt siden trinn 2: kodesjekk, rate limiting, utlevering av modellen, logg,
// og Workeren serverer selve lettmodus-siden (samme domene → ingen CORS,
// og ingen annen dør inn til modellen enn kodesjekken).
//
// ---------------------------------------------------------------------------
// v8 — 6. august 2026. Tre rettinger, alle testet mot workerd + R2:
//   1) Arkiveringen strømmer (gammel.body) i stedet for å lese hele modellen
//      inn i Workerens 128 MB minne. 90 MB-vakten er fjernet.       (~linje 175)
//   2) Revisjonsnummeret reserveres med betinget skriving (onlyIf/etag), så to
//      samtidige opplastinger ikke kan overskrive hverandres arkiv. (~linje 185)
//   3) /åpne lister med delimiter, så bilder og revisjoner ikke kan
//      skyve modellene ut av valglista.                             (~linje 290)
//   4) Proxyen normaliserer adressen før henting — stopper
//      /js/%2e%2e/… som ellers serverer hele GitHub-kontoen fra
//      Workerens domene.                                            (~linje 485)
//
// v9 — 6. august 2026:
//   5) Påloggingsbeviset signeres med en EGEN nøkkel (BEVIS_NOKKEL), ikke
//      opplastingsnøkkelen. Ekte HMAC og konstanttids sammenligning. Flere
//      nøkler godtas samtidig, så nøkkelen kan byttes uten at en eneste
//      montør blir kastet ut midt i arbeidsdagen.                    (~linje 85)
//   6) Opprydding: /filer (se hva som ligger der), /fil (slett én) og
//      /prosjekt (slett alt + koden). Uten disse fantes det ingen måte å
//      slette et byggeplassbilde på — en plikt som kommer med
//      databehandleravtalen.                                        (~linje 430)
//   7) Sikkerhetsheadere på det proxyen serverer.                   (~linje 560)
//
// v10 — 6. august 2026:
//   8) Sletting krever en EGEN nøkkel (SLETTE_NOKKEL), sendt som
//      x-slett-token. ADMIN_TOKEN gir fortsatt opplasting og lesing, men kan
//      ikke lenger rive et prosjekt. Grunnen: ADMIN_TOKEN må ligge i
//      nettleseren til hver prosjektleder for at Byggeplass-knappen skal virke,
//      og i v9 ga den plutselig makt til å slette arkivet også.
//      Er SLETTE_NOKKEL ikke satt, er sletting AVSLÅTT – ikke åpen.
//
//      Slette et bilde (lim inn i konsollen, med slettenøkkelen for hånden):
//        await fetch("<worker>/fil/20653/bilder/abc.jpg",
//          { method: "DELETE", headers: { "x-slett-token": "…" } })
//
// v11 — 11. august 2026:
//   9) MORGENVARSEL. scheduled() + [triggers] i wrangler.toml: kl. 07 norsk tid
//      på hverdager går Workeren gjennom aktive prosjekter, regner ut hva som
//      er forfalt eller haster, og sender ÉN samlemelding per prosjekt.
//      All annen varsling utløses av at noen gjør noe (/kvitter, /hendelse) —
//      men en frist som går ut er fravær av handling, og ingen POSTer noe da.
//      Nettleseren kan ikke løse det: setInterval dør når fanen lukkes.
//  10) /modell/ serverer BARE .glb. Ruta satte «fil» rett inn i R2-nøkkelen
//      uten å sjekke endelse, så den 6-tegns prosjektkoden ga tilgang til alt
//      under <prosjekt>/. Se kommentaren ved ruta.  (~linje 490)
//  11) Hastegrad-koden er SPEILET fra js/frist.js. Se SPEILET-markørene —
//      _test/test-frist.mjs feiler hvis de to kopiene kommer ut av takt.
// ---------------------------------------------------------------------------
//
// Bindinger som må finnes (Settings → Bindings):
//   MODELLER          = R2-bøtta storm-modeller
//   KODER             = KV-navnerom (lagrer koder, rate limiting og logg)
//   ADMIN_TOKEN       = Secret. Opplastings- og adminnøkkelen. Denne ligger i
//                       klartekst i localStorage hos hver prosjektleder.
//   BEVIS_NOKKEL      = Secret. Signerer påloggingskaka. VALGFRI: er den ikke
//                       satt, brukes ADMIN_TOKEN som før, og alt virker
//                       nøyaktig som i v8. Se «Bytte av signeringsnøkkel».
//   BEVIS_NOKKEL_GAMMEL = Secret. Valgfri. Godtas i tillegg til BEVIS_NOKKEL i
//                       en overgangsperiode.
//   SLETTE_NOKKEL     = Secret. Kreves for DELETE /fil og DELETE /prosjekt.
//                       Skal IKKE lagres i noen nettleser – tastes for hånd de
//                       få gangene noe faktisk skal slettes. Uten den satt kan
//                       ingenting slettes i det hele tatt.
//   VARSEL_URL        = Secret/variabel. Teams-webhooken (en arbeidsflyt med
//                       «When a Teams webhook request is received»). Uten den
//                       gjør både varsle() og morgenrunden ingenting —
//                       morgenrunden logger en advarsel og hopper over med en
//                       gang, så feilen er synlig i Workers Logs i stedet for
//                       å være et varsel som bare aldri kommer.
//
// Bytte av signeringsnøkkel UTEN avbrudd — rekkefølgen er alt:
//   1. Rull ut denne koden med BEVIS_NOKKEL usatt. Ingenting endrer seg.
//   2. wrangler secret put BEVIS_NOKKEL_GAMMEL  → dagens ADMIN_TOKEN-verdi
//      wrangler secret put BEVIS_NOKKEL         → 32 nye tilfeldige byte
//   3. Vent 12+ timer. Kaka varer 12 timer, så overlappet dekker alle levende.
//   4. wrangler secret delete BEVIS_NOKKEL_GAMMEL
//   Etter dette kan ADMIN_TOKEN roteres fritt uten å røre en montør.
//
// Datamodell i KV:
//   prosjekt:20653            → { kodehash, salt, navn, laget, utløper }
//   logg:20653:<tidsstempel>  → { ok, hva, fil }
//   rate:<ip>                 → antall feilforsøk (TTL 10 min)
//   blokk:<ip>                → "1" (TTL 1 time)

const GITHUB_PAGES = "https://emil-ar-storm.github.io/storm-ifc-viewer";

// Tegn uten 0 O 1 I l — umulige å lese feil på en printet QR-plakat
const KODE_TEGN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KODE_LENGDE = 6;

const MAKS_FEIL = 10;          // feilforsøk per IP …
const FEIL_VINDU = 600;        // … per 10 minutter …
const BLOKK_TID = 3600;        // … deretter blokkert i 1 time

// CORS gjelder BARE opplastingen fra index.html på GitHub Pages.
// Alt annet (kode, modell) skjer fra Workerens eget domene og trenger ingen CORS.
const KILDER = ["https://emil-ar-storm.github.io", "http://localhost:8080"];

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  if (!KILDER.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-prosjekt, x-token, x-slett-token, x-innhold-hash",
    "Access-Control-Max-Age": "86400"
  };
}

// ---------- Småverktøy ----------

async function sha256hex(tekst) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function tilfeldigKode() {
  const a = new Uint8Array(KODE_LENGDE);
  crypto.getRandomValues(a);
  return [...a].map(x => KODE_TEGN[x % KODE_TEGN.length]).join("");
}

function tilfeldigHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Påloggingsbevis: en signert kake (cookie) som sier «denne nettleseren har
// skrevet riktig kode for prosjekt X». Gyldig 12 timer.
// Ingen adresse å lekke: uten kaka gir /modell bare 403.
//
// Signeringsnøkkelen er skilt fra opplastingsnøkkelen (v9). Før var de samme,
// og siden ADMIN_TOKEN ligger i klartekst i localStorage hos hver
// prosjektleder, kunne den som fikk tak i den forfalske en gyldig sesjon for
// ET HVILKET SOM HELST prosjekt – uten å kjenne noen prosjektkode.
//
// Første nøkkel SIGNERER. Resten GODTAS fortsatt, så kaker utstedt før et
// nøkkelbytte lever ut sine 12 timer i fred.
function bevisNøkler(env) {
  return [env.BEVIS_NOKKEL || env.ADMIN_TOKEN, env.BEVIS_NOKKEL_GAMMEL].filter(Boolean);
}

async function signer(nøkkel, data) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(nøkkel),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Konstant tid: sammenligningen skal ikke avsløre hvor mange tegn som stemte.
function likeStrenger(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function lagBevis(env, prosjekt) {
  const utløper = Date.now() + 12 * 3600 * 1000;
  return prosjekt + "." + utløper + "." + await signer(bevisNøkler(env)[0], prosjekt + "|" + utløper);
}

async function lesBevis(env, req) {
  const kaker = req.headers.get("Cookie") || "";
  const m = kaker.match(/storm_bp=([^;]+)/);
  if (!m) return null;
  const [p, utløper, sig] = m[1].split(".");
  if (!p || !utløper || !sig) return null;
  if (Date.now() > Number(utløper)) return null;
  const data = p + "|" + utløper;
  for (const n of bevisNøkler(env)) {
    if (likeStrenger(sig, await signer(n, data))) return p;
    // Overgang: kaker utstedt av v8 og eldre bruker sha256 med nøkkelen
    // bakerst. De skal fortsatt virke ut sine 12 timer etter utrulling.
    // Denne grenen kan fjernes en dag etter at v9 er ute.
    if (likeStrenger(sig, await sha256hex(data + "|" + n))) return p;
  }
  return null;
}

async function sjekkBevis(env, req, prosjekt) {
  return (await lesBevis(env, req)) === prosjekt;
}

async function logg(env, prosjekt, hva) {
  const nøkkel = "logg:" + prosjekt + ":" + new Date().toISOString();
  // Loggen leses sjelden og skriver ofte — TTL 1 år så den rydder seg selv
  await env.KODER.put(nøkkel, JSON.stringify(hva), { expirationTtl: 31536000 });
}

// Valgfritt varsel til prosjektlederen (f.eks. en Teams-arbeidsflyt med
// "When a Teams webhook request is received"). Uten VARSEL_URL skjer ingenting.
// Sendes i bakgrunnen — feiler den, merker ingen på byggeplassen noe.
// Teams-arbeidsflytene viser ikke ren tekst — de krever meldingen pakket som
// et «adaptive card» (funnet 5. aug 2026: flyten kjørte, men feilet på format).
function varsle(env, ctx, tekst) {
  if (!env.VARSEL_URL || !ctx) return;
  ctx.waitUntil(fetch(env.VARSEL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text: tekst, wrap: true }]
        }
      }]
    })
  }).catch(() => {}));
}

// ---------- Vedlegg: bilde og talemelding ----------
// Talemeldinger (N5) lagres på nøyaktig samme måte som kvitteringsbildene:
// samme navneskjema (markeringsID-nr-slump), samme innboks, samme opprydding.
// Det eneste som skiller dem er filendelsen — og at «seksjon» er «lyd».
//
// .m4a er Safari/iOS, .webm er Chrome/Android. Begge må godtas: montørene har
// begge deler, og MediaRecorder gir ikke samme format på tvers.
const VEDLEGG_MIME = {
  jpg:  "image/jpeg",
  m4a:  "audio/mp4",
  webm: "audio/webm"
};

// Gir MIME-typen hvis filnavnet er gyldig, ellers null. Navnet må være helt
// enkelt — ingen skråstrek, ingen punktum utover endelsen — så det aldri kan
// peke ut av mappa i R2.
function vedleggMime(navn) {
  const m = /^[0-9a-zA-Z_-]+\.(jpg|m4a|webm)$/.exec(String(navn || ""));
  return m ? VEDLEGG_MIME[m[1]] : null;
}

const erLyd = (navn) => /\.(m4a|webm)$/i.test(String(navn || ""));

// ---------- Hastegrad ut fra frist (morgenvarselet) ----------
// Blokka under er KOPIERT ORDRETT fra js/frist.js. Den kan ikke importeres:
// klienten ligger på GitHub Pages, Workeren på Cloudflare, og de deployes hver
// for seg. Kopien er derfor bevisst — og _test/test-frist.mjs klipper ut begge
// og feiler hvis de kommer ut av takt.
//
// Grensene (gul/rod) kommer fra <modell>.markeringer.json, som prosjektlederen
// laster opp med Byggeplass-knappen. Samme fil, samme tall som ringen rundt
// markeringen i modellen. Det er hele grunnen til at fristfargene og dette
// varselet ble bygget som én pakke: ellers kan modellen vise gul mens varselet
// sier rød, og ingen klarer å forklare hvorfor.

// ── SPEILET KODE ───────────────────────────────────────────────────────────
// Alt mellom disse to markørene skal finnes ORDRETT likt i worker/worker.js.
// Endres den ene, MÅ den andre endres. _test/test-frist.mjs klipper ut begge,
// normaliserer blanktegn og feiler hvis de har kommet ut av takt.
//
// Ikke legg noe her som bruker DOM, import eller S — Workeren har ingen av delene.

// Standard hvis oppsett.json ikke sier noe annet.
// gul = 8: fristen er om åtte dager eller mindre.
// rod = 3: fristen er om tre dager eller mindre.
// Bevisst TO tall og ikke tre: med tre grenser oppstår det et hull («hva er 8
// dager?») som ingen oppdager før noen står med en markering i akkurat det gapet.
const STANDARD_GRENSER = { gul: 8, rod: 3 };

// Hele dager fra «iDag» til «due». Positivt = fristen er fram i tid.
//
// Regner på datodelene direkte gjennom Date.UTC, ikke på to Date-objekter i
// lokal tid. Grunnen er sommertid: natta 25.–26. oktober er 25 timer lang, og
// (b - a) / 86400000 gir da 30,96 dager mellom to datoer som er 31 dager fra
// hverandre. Math.round hadde skjult det, men bare noen ganger.
function dagerTil(due, iDag) {
  const a = String(due || "").split("-").map(Number);
  const b = String(iDag || "").split("-").map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return null;
  return (Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000;
}

// Sørger for at to tall fra en håndredigert oppsett.json er brukbare.
// Er gul mindre enn rod, er de byttet om — da hadde ingenting blitt gult.
function vaskGrenser(rå) {
  const g = rå && typeof rå === "object" ? rå : {};
  let gul = Number(g.gul), rod = Number(g.rod);
  if (!Number.isFinite(gul) || gul < 0) gul = STANDARD_GRENSER.gul;
  if (!Number.isFinite(rod) || rod < 0) rod = STANDARD_GRENSER.rod;
  gul = Math.min(365, Math.round(gul));
  rod = Math.min(365, Math.round(rod));
  if (rod > gul) { const b = rod; rod = gul; gul = b; }
  return { gul, rod };
}

// SELVE REGELEN. Alt annet i denne fila er støtte.
//
//   status «Løst»    → ingen ring. En løst sak har ingen hastegrad, og en rød
//                      ring rundt en grønn hake ville vært selvmotsigende.
//   ingen frist      → grå. IKKE grønn: «ingen har bestemt når dette skal være
//                      ferdig» er noe helt annet enn «det er god tid».
//   fristen passert  → mørkerød
//   ≤ rod dager      → rød
//   ≤ gul dager      → gul
//   ellers           → grønn
function hastegrad(c, grenser, iDag) {
  if (!c) return "ukjent";
  const g = grenser || STANDARD_GRENSER;
  if (c.status === "Løst") return "ingen";
  if (!c.due) return "ukjent";
  const d = dagerTil(c.due, iDag);
  if (d === null) return "ukjent";        // ubrukelig datotekst — grå, ikke krasj
  if (d < 0) return "forfalt";
  if (d <= g.rod) return "rod";
  if (d <= g.gul) return "gul";
  return "gronn";
}
// ── SLUTT SPEILET KODE ─────────────────────────────────────

function ipFra(req) {
  return req.headers.get("CF-Connecting-IP") || "ukjent";
}

// ---------- Morgenrunden (Cron Trigger) ----------
// v11 — 11. august 2026.
//
// HVORFOR DEN MÅTTE LIGGE HER OG IKKE I NETTLESEREN: all varsling i verktøyet
// utløses av at NOEN GJØR NOE — varsle() kalles fra /kvitter og /hendelse. Men
// en frist som går ut er nettopp fravær av handling. Ingen POSTer noe når
// 15. august passerer og markering 47 fortsatt står som «Åpen».
//
// Nettleseren kan ikke løse det: setInterval i byggeplass.js dør i det
// prosjektlederen lukker fanen, og klokka 22 på en søndag har ingen hos Storm
// verktøyet åpent.

// Hvor mange markeringer som listes opp per hastegrad før resten telles.
// Et varsel på tretti linjer blir ikke lest.
const VARSEL_MAKS = 6;

// Dagens dato i UTC som YYYY-MM-DD.
//
// Cron-en går 05:00 UTC = 07:00 norsk sommertid, 06:00 om vinteren. Begge er
// samme KALENDERDAG i Norge, så UTC-datoen er riktig hele året. Flytter noen
// utløseren til før 22:00 UTC, regner Workeren på gårsdagen — det er derfor
// tidspunktet står kommentert i wrangler.toml også.
function iDagUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Leser markeringsfila for ett prosjekt rett fra R2.
// Ingen HTTP, ingen kodesjekk — vi er inne i systemet.
async function lesMarkeringer(env, prosjekt) {
  // delimiter: "/" ruller sammen bilder/, rev/, innboks/ og tegninger/ til
  // prefikser. Uten den kommer alle bildene med i lista — samme grunn som
  // rettelse 3 i v8 på /åpne.
  const liste = await env.MODELLER.list({ prefix: prosjekt + "/", delimiter: "/" });
  const treff = (liste.objects || []).filter(o => o.key.endsWith(".markeringer.json"));
  if (!treff.length) return null;

  // Flere modeller i samme prosjekt: ta den sist opplastede.
  treff.sort((a, b) => Date.parse(b.uploaded || 0) - Date.parse(a.uploaded || 0));
  const obj = await env.MODELLER.get(treff[0].key);
  if (!obj) return null;

  let d;
  try { d = await obj.json(); } catch (_) { return null; }

  // FORMAT 1 var en naken array, FORMAT 2 er et objekt med grenser.
  // Begge må tåles: en gammel fil kan ligge i R2 lenge etter at klienten er
  // oppdatert — helt til noen trykker Byggeplass igjen.
  const markeringer = Array.isArray(d) ? d : (d && Array.isArray(d.markeringer) ? d.markeringer : []);
  const grenser = (d && !Array.isArray(d) && d.grenser) ? vaskGrenser(d.grenser) : STANDARD_GRENSER;
  return { markeringer, grenser, fil: treff[0].key };
}

// Bygger varselteksten for ett prosjekt. Gir null hvis det ikke er noe å si.
function byggVarsel(prosjekt, navn, data, iDag) {
  const bøtter = { forfalt: [], rod: [] };
  let utenFrist = 0, apne = 0;

  for (const c of data.markeringer) {
    if (!c || typeof c !== "object") continue;
    if (c.status === "Løst") continue;
    apne++;
    const h = hastegrad(c, data.grenser, iDag);
    if (h === "ukjent") { utenFrist++; continue; }
    if (bøtter[h]) bøtter[h].push(c);
  }

  // INGEN TOMME VARSLER. Et varsel som hver morgen sier «ingenting å melde»
  // blir usynlig på to uker, og da forsvinner de ekte også.
  if (!bøtter.forfalt.length && !bøtter.rod.length) return null;

  const kort = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 70);
  const dagerTekst = (c) => {
    const d = dagerTil(c.due, iDag);
    if (d === null) return "";
    if (d < 0) return " — " + (-d) + (d === -1 ? " dag over" : " dager over");
    if (d === 0) return " — i dag";
    if (d === 1) return " — 1 dag igjen";
    return " — " + d + " dager igjen";
  };
  const seksjon = (tittel, liste) => {
    if (!liste.length) return "";
    // Verst først: den som har stått lengst over fristen skal stå øverst.
    liste.sort((a, b) => (dagerTil(a.due, iDag) || 0) - (dagerTil(b.due, iDag) || 0));
    const vis = liste.slice(0, VARSEL_MAKS)
      .map(c => "• " + (kort(c.text) || "(uten tekst)") + dagerTekst(c)).join("\n");
    const resten = liste.length > VARSEL_MAKS
      ? "\n… og " + (liste.length - VARSEL_MAKS) + " til" : "";
    return "\n\n" + tittel + " (" + liste.length + ")\n" + vis + resten;
  };

  return "📋 Prosjekt " + prosjekt + (navn ? " — " + kort(navn) : "") +
    seksjon("🔴 Forfalt", bøtter.forfalt) +
    seksjon("🟠 Haster (" + data.grenser.rod + " dager eller mindre)", bøtter.rod) +
    "\n\n" + apne + " åpne markeringer" +
    (utenFrist ? ", " + utenFrist + " uten frist" : "");
}

// Selve runden. Skilt fra scheduled() så den kan kalles fra en test.
export async function morgenrunde(env, ctx) {
  const iDag = iDagUTC();

  // Uten webhook finnes det ingen vei ut. Da er det ingen grunn til å gå
  // gjennom KV og R2 hver morgen — og advarselen i loggen er det eneste
  // sporet som ville avslørt at varselet aldri virket.
  if (!env.VARSEL_URL) {
    console.warn("morgenrunden hoppet over: VARSEL_URL er ikke satt");
    return { sett: 0, sendt: 0, grunn: "VARSEL_URL mangler" };
  }

  const nå = Date.now();
  let sendt = 0, sett = 0;

  // Alle prosjekter ligger i KV som prosjekt:<nummer>. list() paginerer;
  // med Storms volum er én runde nok, men markøren håndteres uansett.
  let markør;
  do {
    const side = await env.KODER.list({ prefix: "prosjekt:", cursor: markør });
    for (const n of side.keys) {
      const prosjekt = n.name.slice("prosjekt:".length);
      if (!/^\d{5}$/.test(prosjekt)) continue;

      let post; try { post = JSON.parse(await env.KODER.get(n.name) || "null"); } catch (_) { post = null; }
      if (!post) continue;

      // Utløpt prosjekt = byggeplassen er ferdig. Ingen skal purres på et bygg
      // som er levert.
      if (post.utløper && nå > Date.parse(post.utløper)) continue;

      sett++;
      let data;
      try { data = await lesMarkeringer(env, prosjekt); }
      catch (err) { console.warn("morgenrunde: kunne ikke lese " + prosjekt + ": " + err.message); continue; }
      if (!data) continue;

      const tekst = byggVarsel(prosjekt, post.navn, data, iDag);
      if (!tekst) continue;

      varsle(env, ctx, tekst);
      sendt++;
      await logg(env, prosjekt, { ok: true, hva: "morgenvarsel" });
    }
    markør = side.list_complete ? null : side.cursor;
  } while (markør);

  console.log("morgenrunde " + iDag + ": " + sendt + " varsel sendt av " + sett + " aktive prosjekter");
  return { sett, sendt };
}

// ---------- Selve Workeren ----------

export default {
  // Cron Trigger. Kjøres av Cloudflare uten at noen har nettleseren åpen —
  // se [triggers] i wrangler.toml. Feiler den, skal den IKKE ta med seg
  // resten av Workeren: fetch() må virke selv om varselet ikke gjør det.
  async scheduled(event, env, ctx) {
    try { await morgenrunde(env, ctx); }
    catch (err) { console.error("morgenrunden feilet: " + (err && err.message)); }
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Nettlesere koder æøå i adresser (/åpne → /%C3%A5pne) — dekod før sammenligning
    let sti; try { sti = decodeURIComponent(url.pathname); } catch { sti = url.pathname; }
    const cors = corsHeaders(req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (req.method === "GET" && sti === "/helse") return new Response("ok", { headers: cors });

    // ---------- Opplasting (fra trinn 2, uendret oppførsel) ----------
    if (req.method === "PUT" && sti === "/last-opp") {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || !likeStrenger(token, env.ADMIN_TOKEN)) {
        return new Response("Feil eller manglende opplastingsnøkkel", { status: 403, headers: cors });
      }
      const prosjekt = (req.headers.get("x-prosjekt") || "").trim();
      if (!/^\d{5}$/.test(prosjekt)) {
        return new Response("Prosjektnummeret må være 5 siffer", { status: 400, headers: cors });
      }
      const fil = decodeURIComponent(url.searchParams.get("fil") || "").trim();
      if (!/^[\wæøåÆØÅ .,()–-]+\.(glb|json|jpg|jpeg|pdf)$/i.test(fil) || fil.includes("..")) {
        return new Response("Ugyldig filnavn: " + fil, { status: 400, headers: cors });
      }
      const mappe = url.searchParams.get("mappe") || "";
      if (mappe && mappe !== "bilder" && mappe !== "tegninger") return new Response("Ugyldig mappe", { status: 400, headers: cors });
      const nøkkel = prosjekt + "/" + (mappe ? mappe + "/" : "") + fil;

      // TRINN 6-FUNDAMENT: skrives en .glb som alt finnes over, arkiveres den
      // gamle først som Rev 1, Rev 2 … sammen med markeringene sine.
      // MEN: bare når modellen FAKTISK er endret. Byggeplass-knappen trykkes
      // også for å hente innboksen og oppdatere markeringer — det skal ikke
      // lage en ny revisjon. Klienten sender SHA-256 av innholdet, og er den
      // lik hashen på fila som ligger der, hopper vi over både arkivering og
      // overskriving.
      //
      // 6. aug 2026 — to endringer her:
      //
      //  1) Arkiveringen STRØMMER fila fra R2 til R2 (gammel.body) i stedet for
      //     å lese den inn i minnet (await gammel.arrayBuffer()). Workeren har
      //     128 MB minne; en 83 MB modell sprengte det og ga «Error 1102» uten
      //     forklaring. Med strøm spiller størrelsen ingen rolle, og den gamle
      //     90 MB-vakten er derfor tatt bort — den hoppet stille over
      //     arkiveringen for store modeller.
      //
      //  2) Revisjonsnummeret RESERVERES med betinget skriving (onlyIf/etag).
      //     Før kunne to samtidige opplastinger lese samme «neste», skrive til
      //     samme rev-mappe og overskrive hverandres arkiv. Rekkefølgen er nå
      //     reserver → kopier → før opp i lista, slik at et tapt kappløp aldri
      //     rekker å skrive noe.
      if (!mappe && /\.glb$/i.test(fil)) {
        const hash = req.headers.get("x-innhold-hash") || "";
        const gammel = await env.MODELLER.get(nøkkel);
        if (gammel && hash && gammel.customMetadata && gammel.customMetadata.hash === hash) {
          await logg(env, prosjekt, { ok: true, hva: "opplasting (uendret)", fil });
          return new Response("UENDRET: " + nøkkel, { headers: cors });
        }
        if (gammel) {
          const idxNøkkel = prosjekt + "/rev/index.json";

          // Fase 1 — reserver et revisjonsnummer. Taper vi kappløpet mot en
          // annen opplasting, avviser R2 skrivingen (put returnerer null), og
          // vi leser på nytt og prøver igjen.
          let n = null;
          for (let forsøk = 0; forsøk < 5 && n === null; forsøk++) {
            const rå = await env.MODELLER.get(idxNøkkel);
            let idx = { neste: 1, liste: [] };
            if (rå) { try { idx = JSON.parse(await rå.text()); } catch (_) {} }
            const kandidat = idx.neste || 1;
            idx.neste = kandidat + 1;
            const ok = await env.MODELLER.put(idxNøkkel, JSON.stringify(idx),
              rå ? { onlyIf: { etagMatches: rå.etag } } : { onlyIf: { etagDoesNotMatch: "*" } });
            if (ok) n = kandidat;
          }
          // Klarer vi ikke å reservere, STOPPER vi hele opplastingen. Å skrive
          // den nye modellen uten å arkivere ville slettet den gamle for godt.
          if (n === null) {
            await logg(env, prosjekt, { ok: false, hva: "arkivering – kunne ikke reservere revisjon", fil });
            return new Response("Klarte ikke å arkivere forrige versjon. Prøv igjen om litt.",
              { status: 503, headers: cors });
          }

          // Fase 2 — kopier fila og markeringene. Strøm, aldri i minnet.
          await env.MODELLER.put(prosjekt + "/rev/" + n + "/" + fil, gammel.body);
          const gmlMark = await env.MODELLER.get(nøkkel + ".markeringer.json");
          if (gmlMark) await env.MODELLER.put(prosjekt + "/rev/" + n + "/" + fil + ".markeringer.json", gmlMark.body);

          // Fase 3 — før revisjonen opp i lista. Feiler dette, ligger filene der
          // men vises ikke i historikken. Det er bedre enn en oppføring i lista
          // som peker på en fil som ikke finnes.
          let ført = false;
          for (let forsøk = 0; forsøk < 5 && !ført; forsøk++) {
            const rå = await env.MODELLER.get(idxNøkkel);
            if (!rå) break;
            let idx; try { idx = JSON.parse(await rå.text()); } catch (_) { break; }
            idx.liste = (idx.liste || []).concat([{ rev: n, fil, arkivert: new Date().toISOString() }]);
            if (await env.MODELLER.put(idxNøkkel, JSON.stringify(idx), { onlyIf: { etagMatches: rå.etag } })) ført = true;
          }
          await logg(env, prosjekt, { ok: ført, hva: ført ? "arkivert" : "arkivert (ikke ført i lista)", fil, rev: n });
        }
      }

      const innholdsHash = req.headers.get("x-innhold-hash") || "";
      await env.MODELLER.put(nøkkel, req.body,
        (!mappe && /\.glb$/i.test(fil) && innholdsHash) ? { customMetadata: { hash: innholdsHash } } : undefined);
      await logg(env, prosjekt, { ok: true, hva: "opplasting", fil: nøkkel });
      return new Response("OK: " + nøkkel, { headers: cors });
    }

    // ---------- Admin: lag (eller bytt) kode for et prosjekt ----------
    // POST /ny-kode  { "prosjekt": "20653", "navn": "Geithus vaskehall" }  + x-token
    // Svarer med koden ÉN gang. Bare hashen lagres — en lekket KV gir ingen koder.
    // Å kjøre den på nytt for samme prosjekt gir ny kode, og den gamle QR-en dør.
    if (req.method === "POST" && sti === "/ny-kode") {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || !likeStrenger(token, env.ADMIN_TOKEN)) return new Response("Feil nøkkel", { status: 403 });
      let inn; try { inn = await req.json(); } catch { return new Response("Ugyldig JSON", { status: 400 }); }
      const prosjekt = String(inn.prosjekt || "").trim();
      if (!/^\d{5}$/.test(prosjekt)) return new Response("Prosjektnummeret må være 5 siffer", { status: 400 });
      const kode = tilfeldigKode();
      const salt = tilfeldigHex(16);
      const post = {
        kodehash: await sha256hex(kode + salt),
        salt,
        navn: String(inn.navn || "").slice(0, 80),
        laget: new Date().toISOString(),
        utløper: inn.utløper || null      // f.eks. "2027-06-01" — null = aldri
      };
      await env.KODER.put("prosjekt:" + prosjekt, JSON.stringify(post));
      await logg(env, prosjekt, { ok: true, hva: "ny-kode" });
      return Response.json({ prosjekt, kode, navn: post.navn, utløper: post.utløper });
    }

    // ---------- Byggeplassen: skriv kode, få modell-lista ----------
    // POST /åpne  { "prosjekt": "20653", "kode": "K7M4XP" }
    if (req.method === "POST" && sti === "/åpne") {
      const ip = ipFra(req);

      // Blokkert? Rate limiting FØR alt annet — uten den er seks tegn verdiløst.
      if (await env.KODER.get("blokk:" + ip)) {
        return Response.json({ feil: "For mange forsøk. Prøv igjen om en time." }, { status: 429 });
      }

      let inn; try { inn = await req.json(); } catch { return Response.json({ feil: "Ugyldig forespørsel" }, { status: 400 }); }
      const prosjekt = String(inn.prosjekt || "").trim();
      const kode = String(inn.kode || "").trim().toUpperCase();

      const rå = /^\d{5}$/.test(prosjekt) ? await env.KODER.get("prosjekt:" + prosjekt) : null;
      let riktig = false;
      if (rå) {
        const post = JSON.parse(rå);
        const utløpt = post.utløper && Date.now() > Date.parse(post.utløper);
        riktig = !utløpt && (await sha256hex(kode + post.salt)) === post.kodehash;
      }

      if (!riktig) {
        // Tell feilforsøket. KV har ikke atomisk økning — på dette volumet er det greit.
        const antall = Number(await env.KODER.get("rate:" + ip) || 0) + 1;
        await env.KODER.put("rate:" + ip, String(antall), { expirationTtl: FEIL_VINDU });
        if (antall >= MAKS_FEIL) await env.KODER.put("blokk:" + ip, "1", { expirationTtl: BLOKK_TID });
        await logg(env, prosjekt || "ukjent", { ok: false, hva: "feil kode" });
        return Response.json({ feil: "Feil kode eller prosjekt." }, { status: 403 });
      }

      // Riktig kode: list modellene og gi nettleseren et signert bevis (kake).
      // delimiter: "/" ruller sammen alt under bilder/, rev/, innboks/ og
      // tegninger/ til prefikser i stedet for objekter. Uten den fyller bildene
      // opp de 1000 plassene R2 gir i ett svar, og modellen i rota kan falle
      // utenfor. Målt: 1200 bilder → 2 av 3 modeller forsvant fra valglista,
      // uten noen feilmelding. Filteret under er beholdt som ekstra sikring.
      const liste = await env.MODELLER.list({ prefix: prosjekt + "/", delimiter: "/" });
      const modeller = (liste.objects || [])
        .filter(o => {
          const rest = o.key.slice(prosjekt.length + 1);
          // bare .glb i rota — revisjoner (rev/…) og undermapper skal IKKE i valglista
          return rest.toLowerCase().endsWith(".glb") && !rest.includes("/");
        })
        .map(o => ({
          navn: o.key.slice(prosjekt.length + 1),
          // ?v= gjør adressen unik per opplasting → nettleseren kan hurtigbufre
          // for alltid, og en NY opplasting får automatisk ny adresse.
          url: "/modell/" + prosjekt + "/" + encodeURIComponent(o.key.slice(prosjekt.length + 1)) +
               "?v=" + (o.uploaded ? Date.parse(o.uploaded) : 0),
          størrelse: o.size
        }));
      await logg(env, prosjekt, { ok: true, hva: "åpnet" });
      return Response.json({ ok: true, modeller }, {
        headers: {
          "Set-Cookie": "storm_bp=" + await lagBevis(env, prosjekt) +
            "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200"
        }
      });
    }

    // ---------- Utlevering av modellen — krever beviset fra /åpne ----------
    // GET /modell/20653/fila.glb?v=…
    if (req.method === "GET" && sti.startsWith("/modell/")) {
      const rest = sti.slice("/modell/".length);
      const skille = rest.indexOf("/");
      const prosjekt = rest.slice(0, skille);
      const fil = rest.slice(skille + 1); // sti er allerede dekodet én gang over
      // v11 — 11. aug 2026. BARE .glb.
      //
      // Ruta setter «fil» rett inn i R2-nøkkelen. Uten denne vakten kunne den
      // som har den 6-tegns prosjektkoden hente HVA SOM HELST som ligger under
      // <prosjekt>/ — rev/index.json, markeringsfila, og hva enn som måtte bli
      // lagt der senere. I dag lekker det ikke noe dramatisk, fordi alt som
      // ligger der uansett er ment for byggeplassen. Men hullet LÅSER DESIGNET:
      // den dagen noen legger en fil med interne felt (owner, taskId) ved siden
      // av modellen, er den offentlig for alle med koden.
      //
      // Markeringene har egen rute (/markeringer/), vedleggene sin (/bilde/).
      // Skal noe internt lagres, hører det hjemme i KV — ikke i R2 under <prosjekt>/.
      //
      // Revisjonsstien rev/2/X.glb slutter også på .glb og slipper gjennom.
      if (!/^\d{5}$/.test(prosjekt) || fil.includes("..") || !/\.glb$/i.test(fil)) {
        return new Response("Ugyldig", { status: 400 });
      }
      if (!await sjekkBevis(env, req, prosjekt)) {
        return new Response("Skriv koden først", { status: 403 });
      }
      const obj = await env.MODELLER.get(prosjekt + "/" + fil);
      if (!obj) return new Response("Fant ikke modellen", { status: 404 });
      await logg(env, prosjekt, { ok: true, hva: "hentet", fil });
      // immutable: adressen (med ?v=) endrer seg ved ny opplasting, så nettleseren
      // kan trygt beholde fila for alltid. Montøren betaler for nedlastingen ÉN gang.
      return new Response(obj.body, {
        headers: {
          "content-type": "model/gltf-binary",
          "Cache-Control": "private, max-age=31536000, immutable"
        }
      });
    }

    // ---------- Admin: les loggen for et prosjekt ----------
    if (req.method === "GET" && sti.startsWith("/logg/")) {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || !likeStrenger(token, env.ADMIN_TOKEN)) return new Response("Feil nøkkel", { status: 403 });
      const prosjekt = sti.slice("/logg/".length);
      const liste = await env.KODER.list({ prefix: "logg:" + prosjekt + ":", limit: 1000 });
      const rader = [];
      for (const n of liste.keys) {
        const v = await env.KODER.get(n.name);
        rader.push({ tid: n.name.split(":").slice(2).join(":"), ...(v ? JSON.parse(v) : {}) });
      }
      return Response.json(rader);
    }

    // ---------- Trinn 5: markeringer ut, kvittering inn ----------

    // GET /markeringer/20653/X.lett.glb.markeringer.json — krever beviset
    if (req.method === "GET" && sti.startsWith("/markeringer/")) {
      const rest = sti.slice("/markeringer/".length);
      const skille = rest.indexOf("/");
      const prosjekt = rest.slice(0, skille);
      const fil = rest.slice(skille + 1);
      if (!/^\d{5}$/.test(prosjekt) || !fil.endsWith(".markeringer.json") || fil.includes("..")) {
        return new Response("Ugyldig", { status: 400 });
      }
      if (!await sjekkBevis(env, req, prosjekt)) return new Response("Skriv koden først", { status: 403 });
      const obj = await env.MODELLER.get(prosjekt + "/" + fil);
      if (!obj) return Response.json([]); // ingen markeringer lastet opp ennå — tom liste, ikke feil
      // Markeringer endres mellom opplastinger — aldri hurtigbufre
      return new Response(obj.body, { headers: { "content-type": "application/json", "Cache-Control": "no-store" } });
    }

    // GET /bilde/20653/<navn>.jpg — før-bildene på markeringene. Krever beviset
    if (req.method === "GET" && sti.startsWith("/bilde/")) {
      const rest = sti.slice("/bilde/".length);
      const skille = rest.indexOf("/");
      const prosjekt = rest.slice(0, skille);
      const navn = rest.slice(skille + 1);
      // Ruta heter fortsatt /bilde/ av hensyn til lenker som alt finnes, men
      // serverer nå alle vedlegg — også talemeldinger.
      const mime = vedleggMime(navn);
      if (!/^\d{5}$/.test(prosjekt) || !mime) return new Response("Ugyldig", { status: 400 });
      if (!await sjekkBevis(env, req, prosjekt)) return new Response("Skriv koden først", { status: 403 });
      const obj = await env.MODELLER.get(prosjekt + "/bilder/" + navn);
      if (!obj) return new Response("Fant ikke filen", { status: 404 });
      // filnavn er unike (slump på slutten) — trygt å bufre for alltid
      return new Response(obj.body, { headers: { "content-type": mime, "Cache-Control": "private, max-age=31536000, immutable" } });
    }

    // POST /kvitter?fil=<navn>.jpg — montørens kvitteringsbilde til innboksen.
    // Prosjektet leses fra BEVISET (kaka) — montøren kan bare levere til det
    // prosjektet han har skrevet kode for. Kan bare LEGGE TIL — det finnes
    // ingen rute som endrer eller sletter markeringer eller bilder herfra.
    if (req.method === "POST" && sti === "/kvitter") {
      const prosjekt = await lesBevis(env, req);
      if (!prosjekt) return new Response("Skriv koden først", { status: 403 });
      const fil = decodeURIComponent(url.searchParams.get("fil") || "").trim();
      if (!vedleggMime(fil)) return new Response("Ugyldig filnavn", { status: 400 });
      const lyd = erLyd(fil);
      const str = Number(req.headers.get("content-length") || 0);
      // Lyd får mer plass enn et bilde: to minutter tale er ~2 MB, men en
      // ukomprimert opptaker kan bomme høyere. Fortsatt et tak.
      if (str > (lyd ? 20_000_000 : 8_000_000)) return new Response("Filen er for stor", { status: 413 });
      const seksjon = lyd ? "lyd" : (url.searchParams.get("seksjon") === "for" ? "for" : "etter");
      // Hvem som sendte den. Selvrapportert på byggeplassen (det er all
      // identitet som finnes der), kappet og renset for kontrolltegn så den
      // ikke kan brukes til å smugle noe inn i sidekortet.
      const av = (url.searchParams.get("av") || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
      await env.MODELLER.put(prosjekt + "/innboks/" + fil, req.body);
      await env.MODELLER.put(prosjekt + "/innboks/" + fil + ".json",
        JSON.stringify({ seksjon, av, tid: new Date().toISOString() }));
      await logg(env, prosjekt, { ok: true, hva: lyd ? "talemelding" : "kvittering", fil, seksjon });
      varsle(env, ctx, (lyd ? "🎤 Ny talemelding" : "📷 Nytt bilde") +
        (av ? " fra " + av : " fra byggeplassen") + " på prosjekt " + prosjekt);
      return new Response("OK", { status: 200 });
    }

    // POST /hendelse — ny markering eller kommentar fra byggeplassen.
    // Som /kvitter: bare TILLEGG. Hendelsen legges i innboksen som JSON og
    // hentes hjem av prosjektlederen. Ingenting endres eller slettes herfra.
    if (req.method === "POST" && sti === "/hendelse") {
      const prosjekt = await lesBevis(env, req);
      if (!prosjekt) return new Response("Skriv koden først", { status: 403 });
      if (Number(req.headers.get("content-length") || 0) > 65536) {
        return new Response("For stor", { status: 413 });
      }
      let inn; try { inn = await req.json(); } catch { return new Response("Ugyldig JSON", { status: 400 }); }
      // «nevning» kom til med @-nevning (N4). Uten den her ble varselet avvist
      // med 400 og forsvant stille — nevningen sto i teksten, men ingen fikk
      // beskjed, som var hele poenget med den.
      const KJENTE = ["ny-markering", "svar", "nevning"];
      if (!KJENTE.includes(inn.type)) return new Response("Ukjent type", { status: 400 });
      if (inn.type === "nevning") {
        // Ren beskjed: teksten ligger allerede i markeringen eller kommentaren
        // som ble sendt rett før. Legger vi den i innboksen også, får
        // prosjektlederen den samme meldingen to ganger.
        const hvem = Array.isArray(inn.nevnte) ? inn.nevnte.slice(0, 10).join(", ") : "";
        await logg(env, prosjekt, { ok: true, hva: "nevning" });
        varsle(env, ctx, "🔔 " + String(inn.fra || "Byggeplassen").slice(0, 60) +
          " nevnte " + (hvem || "noen") + " på prosjekt " + prosjekt);
        return new Response("OK");
      }
      const navn = "h-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8) + ".json";
      await env.MODELLER.put(prosjekt + "/innboks/" + navn,
        JSON.stringify({ ...inn, mottatt: new Date().toISOString() }));
      await logg(env, prosjekt, { ok: true, hva: inn.type });
      varsle(env, ctx, (inn.type === "ny-markering" ? "📌 Ny markering" : "💬 Ny kommentar") +
        " fra byggeplassen på prosjekt " + prosjekt);
      return new Response("OK");
    }

    // GET /tegning/20653/<itemId>.pdf — arbeidstegninger. Krever beviset
    if (req.method === "GET" && sti.startsWith("/tegning/")) {
      const rest = sti.slice("/tegning/".length);
      const skille = rest.indexOf("/");
      const prosjekt = rest.slice(0, skille);
      const navn = rest.slice(skille + 1);
      if (!/^\d{5}$/.test(prosjekt) || !/^[0-9a-zA-Z_-]+\.pdf$/.test(navn)) return new Response("Ugyldig", { status: 400 });
      if (!await sjekkBevis(env, req, prosjekt)) return new Response("Skriv koden først", { status: 403 });
      const obj = await env.MODELLER.get(prosjekt + "/tegninger/" + navn);
      if (!obj) return new Response("Fant ikke tegningen", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "application/pdf", "Cache-Control": "private, max-age=86400" } });
    }

    // GET /revisjoner/20645 — arkiverte revisjoner. Bevis eller admin-nøkkel.
    // Selve de gamle modellene hentes via /modell/20645/rev/2/X.glb (samme rute som i dag).
    if (req.method === "GET" && sti.startsWith("/revisjoner/")) {
      const prosjekt = sti.slice("/revisjoner/".length);
      if (!/^\d{5}$/.test(prosjekt)) return new Response("Ugyldig", { status: 400, headers: cors });
      const admin = !!env.ADMIN_TOKEN && likeStrenger(req.headers.get("x-token") || "", env.ADMIN_TOKEN);
      if (!admin && !await sjekkBevis(env, req, prosjekt)) return new Response("Skriv koden først", { status: 403, headers: cors });
      const rå = await env.MODELLER.get(prosjekt + "/rev/index.json");
      if (!rå) return Response.json({ neste: 1, liste: [] }, { headers: cors });
      return new Response(rå.body, { headers: { ...cors, "content-type": "application/json", "Cache-Control": "no-store" } });
    }

    // ---------- Admin: opprydding ----------
    // GET    /filer/20653              – hva ligger der, med størrelse og alder
    // DELETE /fil/20653/bilder/x.jpg   – slett én fil
    // DELETE /prosjekt/20653           – slett ALT på prosjektet, inkludert koden
    //
    // Hvorfor dette måtte inn: bilder skrevet til <prosjekt>/bilder/ hadde
    // ingen slettemekanisme i det hele tatt. Bildene inneholder identifiserbare
    // personer, og GDPR art. 17 krever at sletting faktisk er mulig – ikke bare
    // i SharePoint, men også i R2-kopien. slettBilder() i js/bilder.js treffer
    // bare SharePoint.
    //
    // Alltid ADMIN_TOKEN, aldri montørens kake: den som har prosjektkoden fra
    // en QR-plakat skal kunne LEGGE TIL, aldri fjerne.
    if (sti.startsWith("/filer/") || sti.startsWith("/fil/") || sti.startsWith("/prosjekt/")) {
      // Å SE hva som ligger der krever adminnøkkelen. Å SLETTE krever
      // slettenøkkelen, som er en annen og ikke ligger i noen nettleser.
      // Uten SLETTE_NOKKEL satt er sletting avslått – vi feiler lukket.
      const erSletting = req.method === "DELETE";
      const gitt = req.headers.get(erSletting ? "x-slett-token" : "x-token") || "";
      const fasit = erSletting ? env.SLETTE_NOKKEL : env.ADMIN_TOKEN;
      if (!fasit || !likeStrenger(gitt, fasit)) {
        return new Response(erSletting
          ? "Sletting krever slettenøkkelen (x-slett-token)"
          : "Feil nøkkel", { status: 403, headers: cors });
      }

      if (req.method === "GET" && sti.startsWith("/filer/")) {
        const prosjekt = sti.slice("/filer/".length);
        if (!/^\d{5}$/.test(prosjekt)) return new Response("Ugyldig", { status: 400, headers: cors });
        const ut = [];
        let markør;
        do {
          const l = await env.MODELLER.list({ prefix: prosjekt + "/", cursor: markør, limit: 1000 });
          (l.objects || []).forEach(o => ut.push({ nøkkel: o.key, størrelse: o.size, lastet: o.uploaded }));
          markør = l.truncated ? l.cursor : null;
        } while (markør);
        return Response.json(ut, { headers: cors });
      }

      if (req.method === "DELETE" && sti.startsWith("/fil/")) {
        const rest = sti.slice("/fil/".length);
        const skille = rest.indexOf("/");
        if (skille < 1) return new Response("Ugyldig", { status: 400, headers: cors });
        const prosjekt = rest.slice(0, skille);
        const nøkkel = rest.slice(skille + 1);
        // Det som faktisk verner mot sletting på tvers av prosjekter, er at
        // prefikset settes sammen HER av et prosjektnummer som må være fem
        // siffer. R2-nøkler er dessuten flate strenger uten mappebetydning, så
        // «..» inni en nøkkel peker ingen steder – den lager bare et rart navn.
        //
        // Merk: et ekte «..» i adressen er allerede løst opp av new URL() på
        // linje 124, FØR koden her kjører. /fil/20653/../20999/x.glb blir til
        // /fil/20999/x.glb, altså en helt vanlig forespørsel mot 20999. Det er
        // ikke noe å avvise – den er ikke til å skille fra at noen skrev den
        // adressen selv. Sjekkene under er derfor for å unngå søppelnøkler,
        // ikke for å stoppe et angrep.
        if (!/^\d{5}$/.test(prosjekt) || !nøkkel ||
            nøkkel.includes("..") || /%2e/i.test(nøkkel)) {
          return new Response("Ugyldig", { status: 400, headers: cors });
        }
        await env.MODELLER.delete(prosjekt + "/" + nøkkel);
        await logg(env, prosjekt, { ok: true, hva: "slettet", fil: nøkkel });
        return new Response("OK", { headers: cors });
      }

      if (req.method === "DELETE" && sti.startsWith("/prosjekt/")) {
        const prosjekt = sti.slice("/prosjekt/".length);
        if (!/^\d{5}$/.test(prosjekt)) return new Response("Ugyldig", { status: 400, headers: cors });
        let markør, antall = 0;
        do {
          const l = await env.MODELLER.list({ prefix: prosjekt + "/", cursor: markør, limit: 1000 });
          const nøkler = (l.objects || []).map(o => o.key);
          if (nøkler.length) { await env.MODELLER.delete(nøkler); antall += nøkler.length; }
          markør = l.truncated ? l.cursor : null;
        } while (markør);
        // Koden dør med prosjektet – QR-plakaten slutter å virke samme sekund
        await env.KODER.delete("prosjekt:" + prosjekt);
        await logg(env, prosjekt, { ok: true, hva: "prosjekt slettet", antall });
        return new Response("OK: " + antall + " filer slettet", { headers: cors });
      }

      return new Response("Ikke funnet", { status: 404, headers: cors });
    }

    // ---------- Admin: innboksen (prosjektlederen henter, så tømmes den) ----------
    if (sti.startsWith("/innboks/")) {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || !likeStrenger(token, env.ADMIN_TOKEN)) return new Response("Feil nøkkel", { status: 403, headers: cors });
      const rest = sti.slice("/innboks/".length);
      const skille = rest.indexOf("/");
      const prosjekt = skille === -1 ? rest : rest.slice(0, skille);
      if (!/^\d{5}$/.test(prosjekt)) return new Response("Ugyldig", { status: 400 });
      if (req.method === "GET" && skille === -1) {
        const liste = await env.MODELLER.list({ prefix: prosjekt + "/innboks/" });
        return Response.json((liste.objects || []).map(o => o.key.slice((prosjekt + "/innboks/").length)), { headers: cors });
      }
      const navn = skille === -1 ? "" : rest.slice(skille + 1);
      // Talemeldinger (.m4a/.webm) MÅ stå her sammen med .jpg og .json.
      // Sto de ikke her, ville lista over innboksen vist dem — og telleren på
      // Byggeplass-knappen talt dem — mens selve nedlastingen svarte 400 og ble
      // hoppet stille over i hentInnboks(). Resultatet var en teller som aldri
      // kunne nullstilles og talemeldinger som aldri kom hjem.
      if (!/^[0-9a-zA-Z_.-]+\.(jpg|m4a|webm|json)$/.test(navn) || navn.includes("..")) return new Response("Ugyldig filnavn", { status: 400 });
      if (req.method === "GET") {
        const obj = await env.MODELLER.get(prosjekt + "/innboks/" + navn);
        if (!obj) return new Response("Fant ikke", { status: 404, headers: cors });
        return new Response(obj.body, { headers: { ...cors,
          "content-type": navn.endsWith(".json") ? "application/json" : (vedleggMime(navn) || "application/octet-stream") } });
      }
      if (req.method === "DELETE") {
        await env.MODELLER.delete(prosjekt + "/innboks/" + navn);
        return new Response("OK", { headers: cors });
      }
      return new Response("Ikke funnet", { status: 404 });
    }

    // ---------- Lettmodus-siden serveres fra samme domene ----------
    // Workeren henter filene fra GitHub Pages og sender dem videre. Da finnes det
    // bare ÉN utrulling (GitHub, som i dag) — og siden + modellen deler domene.
    if (req.method === "GET") {
      // QR-adressen /20653 og rota / serverer begge landingssiden
      let hent = (sti === "/" || /^\/\d{5}$/.test(sti)) ? "/bygg.html" : sti;
      if (/^\/(bygg\.html|js\/|css\/|vendor\/)/.test(hent)) {
        // Adressen bygges og NORMALISERES før vi henter, og vi sjekker at
        // resultatet fortsatt ligger under /storm-ifc-viewer/. Uten dette
        // slipper /js/%2e%2e/%2e%2e/… gjennom filteret over, og fetch()
        // normaliserer den ut av repoet — da kan hva som helst på GitHub-kontoen
        // serveres fra Workerens domene, altså samme opphav som storm_bp-kaka.
        // En ren .includes("..")-sjekk er IKKE nok: %252e%252e slipper forbi den,
        // fordi decodeURIComponent over gjør den om til %2e%2e (ingen punktum å
        // se etter), mens new URL() likevel tolker den som et punktumsegment.
        let mål;
        try { mål = new URL(GITHUB_PAGES + hent); }
        catch (_) { return new Response("Ugyldig", { status: 400 }); }
        if (mål.origin !== "https://emil-ar-storm.github.io" ||
            !mål.pathname.startsWith("/storm-ifc-viewer/")) {
          return new Response("Ugyldig", { status: 400 });
        }
        const svar = await fetch(mål.href, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (svar.ok) {
          const h = new Headers(svar.headers);
          // /vendor/ er bibliotek vi ikke har skrevet selv, og filnavnet bærer
          // versjonen (jspdf-2.5.2…). De endrer seg ALDRI under samme navn, så de
          // kan caches for godt. Fem minutter her ville tvunget montøren til å
          // laste ned biblioteket på nytt hvert femte minutt på byggeplassen —
          // og det er nettopp dårlig dekning selvhostingen skal slippe unna.
          // Resten er vår egen kode: fem minutter, så en push synes raskt.
          h.set("Cache-Control", /^\/vendor\//.test(hent)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300");
          // Sikkerhetsheadere. Her koster de nesten ingenting, fordi vi eier
          // proxyen – GitHub Pages kan ikke sette svarheadere i det hele tatt,
          // så index.html må klare seg med <meta http-equiv> hvis den skal ha
          // noe tilsvarende. (Full CSP er bevisst utsatt: de 13 onclick=""-ene
          // i HTML-en krever 'unsafe-inline', og da gjør CSP-en lite nytte.)
          h.set("X-Content-Type-Options", "nosniff");
          h.set("Referrer-Policy", "no-referrer");
          h.set("X-Frame-Options", "DENY");
          return new Response(svar.body, { status: svar.status, headers: h });
        }
        return new Response("Fant ikke " + hent, { status: 404 });
      }
    }

    return new Response("Ikke funnet", { status: 404, headers: cors });
  }
};
