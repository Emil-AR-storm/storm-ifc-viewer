// Storm byggeplass-Worker — trinn 2-utgave: tar imot opplastinger til R2.
// Trinn 3 bygger på med kodesjekk, rate limiting, utlevering og logg.
//
// Hemmeligheter ligger ALDRI her (fila er i et offentlig repo):
//   ADMIN_TOKEN settes i Cloudflare: Worker → Settings → Variables and Secrets
//   MODELLER er R2-bindingen til bøtta storm-modeller (Settings → Bindings)

// Hvem får lov å kalle Workeren fra nettleseren (CORS gjelder BARE opplastingen
// fra index.html på GitHub Pages — utleveringen i trinn 3 skjer fra samme domene
// og trenger ingen CORS):
const KILDER = [
  "https://emil-ar-storm.github.io",
  "http://localhost:8080"            // lokal testing
];

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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);

    // Preflight: nettleseren spør om lov før PUT med egne headere
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // Enkel helsesjekk: åpne adressen i nettleseren → «ok»
    if (req.method === "GET" && url.pathname === "/helse") {
      return new Response("ok", { headers: cors });
    }

    // ---------- Opplasting (trinn 2) ----------
    if (req.method === "PUT" && url.pathname === "/last-opp") {
      const token = req.headers.get("x-token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return new Response("Feil eller manglende opplastingsnøkkel", { status: 403, headers: cors });
      }
      const prosjekt = (req.headers.get("x-prosjekt") || "").trim();
      if (!/^\d{5}$/.test(prosjekt)) {
        return new Response("Prosjektnummeret må være 5 siffer", { status: 400, headers: cors });
      }
      const fil = decodeURIComponent(url.searchParams.get("fil") || "").trim();
      // Bare trygge filnavn — ingen skråstreker (mappestrukturen styres her, ikke av klienten)
      if (!/^[\wæøåÆØÅ .,()–-]+\.(glb|json|jpg|jpeg)$/i.test(fil) || fil.includes("..")) {
        return new Response("Ugyldig filnavn: " + fil, { status: 400, headers: cors });
      }
      // req.body er en strøm — Workeren holder aldri hele fila i minnet
      await env.MODELLER.put(prosjekt + "/" + fil, req.body);
      return new Response("OK: " + prosjekt + "/" + fil, { headers: cors });
    }

    // ---------- Trinn 3 kommer her: POST /åpne med kodesjekk + rate limiting ----------

    return new Response("Ikke funnet", { status: 404, headers: cors });
  }
};
