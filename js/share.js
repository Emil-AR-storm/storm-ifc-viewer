// ⛓ Delt visningslenke.
//
// Hele visningstilstanden – kamera, snitt, etasje, skjulte typer og fargelegging
// – komprimeres og legges etter # i adressen. Ingen fil lagres noe sted, og
// lenken virker uten innlogging så lenge mottakeren kan åpne selve modellen.
// Mottakeren får aldri sitt eget lagrede oppsett overskrevet: den delte
// visningen legges på uten å lagres.
import { $, S, esc } from "./state.js";
import { applyClipState } from "./clip.js";
import { buildTypeInfo, applyTypeColors, setGhost } from "./display.js";
import { camera, controls } from "./scene.js";
import { spOpenFile } from "./sharepoint.js";

const VERSION = 1;
const HASH_KEY = "v=";

// ---------- base64url uten padding ----------
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// deflate der nettleseren har det (Chrome/Edge/Safari 16.4+), ellers rå tekst.
// Første tegn i nyttelasten sier hva som ble brukt: "1" = pakket, "0" = ikke.
async function pack(obj) {
  const json = JSON.stringify(obj);
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === "function") {
    try {
      const cs = new CompressionStream("deflate-raw");
      const wr = cs.writable.getWriter();
      wr.write(raw); wr.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return "1" + toB64(new Uint8Array(buf));
    } catch(_) {}
  }
  return "0" + toB64(raw);
}

async function unpack(payload) {
  const flag = payload[0];
  const bytes = fromB64(payload.slice(1));
  if (flag === "1") {
    const ds = new DecompressionStream("deflate-raw");
    const wr = ds.writable.getWriter();
    wr.write(bytes); wr.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- Hva som deles ----------
const r3 = (n) => Math.round(n * 1000) / 1000;

export function collectView() {
  const v = {
    v: VERSION,
    f: S.fileName || "",
    cam: [r3(camera.position.x), r3(camera.position.y), r3(camera.position.z),
          r3(controls.target.x), r3(controls.target.y), r3(controls.target.z)]
  };
  // modell fra 📚 Biblioteket kan mottakeren åpne selv
  if (S.lastLoadInfo && S.lastLoadInfo.libId) v.lib = S.lastLoadInfo.libId;
  if (S.clipOn || (S.storeyOn && S.storeyIdx >= 0)) {
    v.clip = {
      mode: S.clipOn ? S.clipMode : "none",
      axis: S.clipAxis, t: r3(S.clipT), flip: !!S.clipFlip,
      box: S.clipMode === "box" ? S.clipBox : null,
      faceN: S.clipFaceN ? [r3(S.clipFaceN.x), r3(S.clipFaceN.y), r3(S.clipFaceN.z)] : null,
      faceP: S.clipFaceP ? [r3(S.clipFaceP.x), r3(S.clipFaceP.y), r3(S.clipFaceP.z)] : null,
      faceOff: r3(S.clipFaceOff),
      storey: S.storeyOn ? S.storeyIdx : -1
    };
  }
  if (S.typeInfo) {
    const hid = [], col = {};
    for (const [k, g] of S.typeInfo) {
      if (g.hidden) hid.push(k);
      if (S.appear.colors[k]) col[k] = g.color;
    }
    if (hid.length) v.hid = hid;
    if (Object.keys(col).length) v.col = col;
  }
  if (S.typeColorsOn) v.tc = 1;
  if (S.ghostOn) v.gh = 1;
  if (S.lightMode) v.light = 1;
  return v;
}

export async function buildShareLink() {
  const payload = await pack(collectView());
  return location.origin + location.pathname + "#" + HASH_KEY + payload;
}

// ---------- Legg en delt visning på plass ----------
// silent overalt: mottakerens eget lagrede utseende røres ikke.
export function applyView(v) {
  if (!v) return;
  try {
    if (Array.isArray(v.cam) && v.cam.length === 6) {
      camera.position.set(v.cam[0], v.cam[1], v.cam[2]);
      controls.target.set(v.cam[3], v.cam[4], v.cam[5]);
      controls.update();
    }
    if ((v.hid || v.col || v.tc) && S.modelGroup && !S.lightLoaded && S.modelID !== null) {
      if (!S.typeInfo) buildTypeInfo();
      if (v.col) {
        for (const k in v.col) {
          const g = S.typeInfo.get(k);
          if (g) { g.color = v.col[k]; g.mat.color.set(v.col[k]); }
        }
      }
      if (v.hid) {
        for (const [k, g] of S.typeInfo) {
          g.hidden = v.hid.includes(k);
          g.meshes.forEach(m => m.visible = !g.hidden);
        }
        if (v.hid.length) $("btnShowAll").style.display = "";
      }
      if (v.tc) applyTypeColors(true);
    }
    if (v.gh && !v.tc) setGhost(true, true);
    if (v.clip) {
      applyClipState(v.clip);
      if (v.clip.mode === "none") {           // bare etasjefilter var på
        S.clipOn = false;
        $("btnClip").classList.remove("active");
        $("clipPanel").classList.remove("open");
      }
    }
  } catch (err) {
    console.warn("Klarte ikke å legge på hele den delte visningen:", err);
  }
}

// ---------- ⛓-knappen ----------
$("btnShare").addEventListener("click", async () => {
  if (!S.modelGroup) { alert("Åpne en modell først."); return; }
  const link = await buildShareLink();
  const body = $("shareBody");
  const fromLib = !!(S.lastLoadInfo && S.lastLoadInfo.libId);
  body.innerHTML =
    '<p style="color:var(--muted); font-size:12px; margin:0 0 8px">Lenka gjenskaper kamera, snitt, etasje, ' +
      'skjulte typer og fargelegging. Den inneholder ingen modellfil og virker uten innlogging.</p>' +
    '<textarea id="shLink" readonly rows="4" style="width:100%; font-size:11px; background:var(--panel2); ' +
      'color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px; resize:vertical">' +
      esc(link) + '</textarea>' +
    '<div class="prop-actions" style="margin-top:10px"><button id="shCopy" class="primary">📋 Kopier lenke</button></div>' +
    '<p style="font-size:11px; color:var(--muted); margin:0">' +
      (fromLib
        ? '📚 Modellen ligger i biblioteket, så mottakeren kan åpne den med ett trykk.'
        : '💻 Modellen ble åpnet fra din maskin. Mottakeren må ha samme fil – legg den i 📚 Biblioteket hvis flere skal se den.') +
      '<br>Lengde: ' + link.length + ' tegn.' +
      (link.length > 8000 ? ' <b>Så lange adresser kan bli kuttet i noen program – skjul færre typer.</b>' : '') +
    '</p>';
  $("shCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      $("shCopy").textContent = "✅ Kopiert";
      setTimeout(() => { if ($("shCopy")) $("shCopy").textContent = "📋 Kopier lenke"; }, 1500);
    } catch(_) {
      $("shLink").select();
      alert("Trykk Ctrl+C for å kopiere lenka.");
    }
  };
  ["propPanel","commentPanel","qtyPanel","colorPanel","libPanel","axesPanel","searchPanel","comparePanel","clipPanel"]
    .forEach(id => $(id).classList.remove("open"));
  $("sharePanel").classList.add("open");
  $("shLink").select();
});

// ---------- Mottakersiden ----------
// Hashen ble lest i state.js før MSAL fikk røre den.
(async function readIncoming() {
  const h = (S.initialHash || "").replace(/^#/, "");
  if (!h.startsWith(HASH_KEY)) return;
  let v = null;
  try { v = await unpack(h.slice(HASH_KEY.length)); } catch(_) {}
  if (!v || typeof v !== "object") return;
  S.sharedView = v;
  showIncomingBanner(v);
})();

function showIncomingBanner(v) {
  const b = $("shareBanner");
  if (!b) return;
  b.style.display = "block";
  b.innerHTML = '🔗 <b>Delt visning</b> av «' + esc(v.f || "en modell") + '»' +
    (v.lib ? '<br><button id="shOpen" class="primary" style="margin-top:10px">📚 Åpne modellen</button>'
           : '<br><span style="color:var(--muted); font-size:12px">Åpne samme fil med 📂, så legges visningen på automatisk.</span>');
  const btn = $("shOpen");
  if (btn) btn.onclick = () => spOpenFile({ id: v.lib, name: v.f });
}

// Kalles fra ifc.js når en modell er ferdig lastet
S.onSharedReady = () => {
  const v = S.sharedView;
  if (!v) return;
  S.sharedView = null;
  const b = $("shareBanner");
  if (b) b.style.display = "none";
  if (v.f && S.fileName && v.f !== S.fileName) {
    // annen fil enn den som ble delt – vi legger på visningen, men sier det
    setTimeout(() => alert("Den delte visningen ble laget for «" + v.f + "», men du har åpnet «" +
      S.fileName + "». Visningen legges på så godt det går."), 200);
  }
  applyView(v);
};
