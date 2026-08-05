// Storm byggeplass-Worker — trinn 3-utgave.
// Nytt siden trinn 2: kodesjekk, rate limiting, utlevering av modellen, logg,
// og Workeren serverer selve lettmodus-siden (samme domene → ingen CORS,
// og ingen annen dør inn til modellen enn kodesjekken).
//
// Bindinger som må finnes (Settings → Bindings):
//   MODELLER    = R2-bøtta storm-modeller
//   KODER       = KV-navnerom (lagrer koder, rate limiting og logg)
//   ADMIN_TOKEN = Secret (opplastingsnøkkelen — brukes også til å signere påloggingsbeviset)
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
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-prosjekt, x-token",
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
// skrevet riktig kode for prosjekt X». Signeres med ADMIN_TOKEN, gyldig 12 timer.
// Ingen adresse å lekke: uten kaka gir /modell bare 403.
async function lagBevis(env, prosjekt) {
  const utløper = Date.now() + 12 * 3600 * 1000;
  const sig = await sha256hex(prosjekt + "|" + utløper + "|" + env.ADMIN_TOKEN);
  return prosjekt + "." + utløper + "." + sig;
}

async function sjekkBevis(env, req, prosjekt) {
  const kaker = req.headers.get("Cookie") || "";
  const m = kaker.match(/storm_bp=([^;]+)/);
  if (!m) return false;
  const [p, utløper, sig] = m[1].split(".");
  if (p !== prosjekt) return false;
  if (!utløper || Date.now() > Number(utløper)) return false;
  return sig === await sha256hex(p + "|" + utløper + "|" + env.ADMIN_TOKEN);
}

async function logg(env, prosjekt, hva) {
  const nøkkel = "logg:" + prosjekt + ":" + new Date().toISOString();
  // Loggen leses sjelden og skriver ofte — TTL 1 år så den rydder seg selv
  await env.KODER.put(nøkkel, JSON.stringify(hva), { expirationTtl: 31536000 });
}

function ipFra(req) {
  return req.headers.get("CF-Connecting-IP") || "ukjent";
}

// ---------- Selve Workeren ----------

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Nettlesere koder æøå i adresser (/åpne → /%C3%A5pne) — dekod før sammenligning
    let sti; try { sti = decodeURIComponent(url.pathname); } catch { sti = url.pathname; }
    const cors = corsHeaders(req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (req.method === "GET" && sti === "/helse") return new Response("ok", { headers: cors });

    // ---------- Opplasting (fra trinn 2, uendret oppførsel) ----------
    if (req.method === "PUT" && sti === "/last-opp") {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return new Response("Feil eller manglende opplastingsnøkkel", { status: 403, headers: cors });
      }
      const prosjekt = (req.headers.get("x-prosjekt") || "").trim();
      if (!/^\d{5}$/.test(prosjekt)) {
        return new Response("Prosjektnummeret må være 5 siffer", { status: 400, headers: cors });
      }
      const fil = decodeURIComponent(url.searchParams.get("fil") || "").trim();
      if (!/^[\wæøåÆØÅ .,()–-]+\.(glb|json|jpg|jpeg)$/i.test(fil) || fil.includes("..")) {
        return new Response("Ugyldig filnavn: " + fil, { status: 400, headers: cors });
      }
      await env.MODELLER.put(prosjekt + "/" + fil, req.body);
      await logg(env, prosjekt, { ok: true, hva: "opplasting", fil });
      return new Response("OK: " + prosjekt + "/" + fil, { headers: cors });
    }

    // ---------- Admin: lag (eller bytt) kode for et prosjekt ----------
    // POST /ny-kode  { "prosjekt": "20653", "navn": "Geithus vaskehall" }  + x-token
    // Svarer med koden ÉN gang. Bare hashen lagres — en lekket KV gir ingen koder.
    // Å kjøre den på nytt for samme prosjekt gir ny kode, og den gamle QR-en dør.
    if (req.method === "POST" && sti === "/ny-kode") {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("Feil nøkkel", { status: 403 });
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
      const liste = await env.MODELLER.list({ prefix: prosjekt + "/" });
      const modeller = (liste.objects || [])
        .filter(o => o.key.toLowerCase().endsWith(".glb"))
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
      if (!/^\d{5}$/.test(prosjekt) || fil.includes("..")) return new Response("Ugyldig", { status: 400 });
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
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("Feil nøkkel", { status: 403 });
      const prosjekt = sti.slice("/logg/".length);
      const liste = await env.KODER.list({ prefix: "logg:" + prosjekt + ":", limit: 1000 });
      const rader = [];
      for (const n of liste.keys) {
        const v = await env.KODER.get(n.name);
        rader.push({ tid: n.name.split(":").slice(2).join(":"), ...(v ? JSON.parse(v) : {}) });
      }
      return Response.json(rader);
    }

    // ---------- Lettmodus-siden serveres fra samme domene ----------
    // Workeren henter filene fra GitHub Pages og sender dem videre. Da finnes det
    // bare ÉN utrulling (GitHub, som i dag) — og siden + modellen deler domene.
    if (req.method === "GET") {
      let hent = sti === "/" ? "/bygg.html" : sti;
      if (/^\/(bygg\.html|js\/|css\/|vendor\/)/.test(hent)) {
        const svar = await fetch(GITHUB_PAGES + hent, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (svar.ok) {
          const h = new Headers(svar.headers);
          h.set("Cache-Control", "public, max-age=300"); // 5 min — ny GitHub-opplasting synes raskt
          return new Response(svar.body, { status: svar.status, headers: h });
        }
        return new Response("Fant ikke " + hent, { status: 404 });
      }
    }

    return new Response("Ikke funnet", { status: 404, headers: cors });
  }
};
