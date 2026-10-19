// ⛓ Delt visningslenke.
//
// Hele visningstilstanden – kamera, snitt, etasje, skjulte typer og fargelegging
// – komprimeres og legges etter # i adressen. Ingen fil lagres noe sted, og
// lenken virker uten innlogging så lenge mottakeren kan åpne selve modellen.
// Mottakeren får aldri sitt eget lagrede oppsett overskrevet: den delte
// visningen legges på uten å lagres.
import { $, på, S, apnePanel, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { applyClipState } from "./clip.js";
import { applySharedCompare, collectCompare } from "./compare.js";
import { buildTypeInfo, applyTypeColors, hiddenIDs, setGhost } from "./display.js";
import { sikreMeta } from "./ifcrpc.js";
import { alleElementIder } from "./ifc.js";
import { camera, controls } from "./scene.js";
import { spOpenFile } from "./sharepoint.js";
import { varsel } from "./varsel.js";

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

export function collectView(opt) {
  const o = opt || {};
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
  // enkeltelementer skjult med «Skjul element» – dette er ikke det samme som
  // skjulte typer, og ble glemt i første utgave
  if (hiddenIDs.size) v.hidId = [...hiddenIDs];
  if (S.typeColorsOn) v.tc = 1;
  if (S.ghostOn) v.gh = 1;
  if (S.lightMode) v.light = 1;
  if (!o.noCompare) {
    const cmp = collectCompare(o.slimCompare);
    if (cmp) v.cmp = cmp;
  }
  return v;
}

// Lange adresser blir kuttet av e-post og Teams, så vi trapper ned i tre steg:
// full sammenligning → uten navn og mål → uten sammenligning.
const LIMIT_FULL = 20000;
const LIMIT_SLIM = 60000;

export async function buildShareLink() {
  const base = location.origin + location.pathname + "#" + HASH_KEY;
  let link = base + await pack(collectView());
  let note = "";
  if (link.length > LIMIT_FULL && S.compareOn) {
    link = base + await pack(collectView({ slimCompare: true }));
    note = t("Sammenligningen var stor, så navn og mål er utelatt – fargene og antallene er med.");
    if (link.length > LIMIT_SLIM) {
      link = base + await pack(collectView({ noCompare: true }));
      note = t("Sammenligningen var for stor for en adresse og er ikke med. Mottakeren må kjøre Sammenlign selv.");
    }
  }
  return { link, note };
}

// Lenke som åpner modellen med kameraet rettet mot en markering. Brukes i
// Planner-oppgaver, så den som får oppgaven ser hva det gjelder med ett trykk.
// Legges på S for å unngå sirkulær import fra markers.js.
S.markerLink = async (c) => {
  const v = collectView({ noCompare: true });
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize().multiplyScalar(Math.max(S.modelSize * 0.06, 4));
  v.cam = [r3(c.x + dir.x), r3(c.y + dir.y), r3(c.z + dir.z), r3(c.x), r3(c.y), r3(c.z)];
  return location.origin + location.pathname + "#" + HASH_KEY + await pack(v);
};

// ---------- Vask av en innkommende delt visning ----------
// Alt etter #v= kan hvem som helst skrive – en lenke i en e-post er ikke
// nødvendigvis laget av appen. Feltene havner til slutt i innerHTML
// (sammenligningspanelet, snittlinja, fargevelgerne), så en lenke med
// «"m":"<img onerror=…>"» ville kjørt kode hos mottakeren. Derfor bygges
// objektet på nytt av bare de feltene collectView()/collectCompare() lager,
// med riktig type. Ukjente felter og feil typer slippes aldri inn.
const MAKS_TEKST = 500;          // filnavn, typenavn, elementnavn
const MAKS_LISTE = 50000;        // lenka er maks ~60 000 tegn uansett
const SNITTMODUS = ["axis", "face", "box", "none"];
const AKSER = ["x", "y", "z"];
const METODER = ["GlobalId", "geometri", "nærmeste element"];   // se compare() og compareManuelt()
const BOKSFELT = ["x0", "x1", "y0", "y1", "z0", "z1"];

const tall = (x) => (typeof x === "number" && isFinite(x)) ? x : undefined;
const tekst = (x) => String(x == null ? "" : x).slice(0, MAKS_TEKST);
// Samme regel som vaskFarge() i markers.js, men uten å dra inn hele den
// modulen her: bare #rrggbb slipper gjennom, alt annet regnes som tomt.
const farge = (x) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x)) ? x : "";
function tallListe(x, n) {
  if (!Array.isArray(x) || x.length !== n) return undefined;
  const ut = x.map(tall);
  return ut.every(y => y !== undefined) ? ut : undefined;
}
const liste = (x) => Array.isArray(x) ? x.slice(0, MAKS_LISTE) : [];
// et vanlig objekt kan ikke ta imot nøkkelen «__proto__» uten å bytte prototype
const farligNokkel = (k) => k === "__proto__" || k === "constructor" || k === "prototype";

function vaskSnitt(c) {
  if (!c || typeof c !== "object") return undefined;
  const ut = {};
  if (SNITTMODUS.includes(c.mode)) ut.mode = c.mode;
  if (AKSER.includes(c.axis)) ut.axis = c.axis;
  if (tall(c.t) !== undefined) ut.t = c.t;
  ut.flip = !!c.flip;
  if (c.box && typeof c.box === "object") {
    ut.box = {};
    BOKSFELT.forEach(k => { if (tall(c.box[k]) !== undefined) ut.box[k] = c.box[k]; });
  } else ut.box = null;
  ut.faceN = tallListe(c.faceN, 3) || null;
  ut.faceP = tallListe(c.faceP, 3) || null;
  if (tall(c.faceOff) !== undefined) ut.faceOff = c.faceOff;
  ut.storey = (Number.isInteger(c.storey) && c.storey >= -1) ? c.storey : -1;
  return ut;
}

// Radene i sammenligningen: [id, navn, type] for nye, [id, navn, type, 5 tall]
// for endrede, [navn, type, 6 tall] for slettede. Den slanke utgaven har
// kortere rader, så lengden beholdes – bare innholdet vaskes.
function vaskRad(a, tekstPlass, idPlass) {
  if (!Array.isArray(a)) return null;
  const ut = a.slice(0, 8).map((x, i) =>
    i === idPlass ? tall(x) : tekstPlass.includes(i) ? tekst(x) : (tall(x) ?? 0));
  return (idPlass >= 0 && ut[idPlass] === undefined) ? null : ut;
}

function vaskSammenligning(c) {
  if (!c || typeof c !== "object") return undefined;
  const ut = { b: tekst(c.b || "forrige versjon") };
  if (METODER.includes(c.m)) ut.m = c.m;
  ut.ue = (Number.isInteger(c.ue) && c.ue >= 0) ? c.ue : 0;
  if (c.u) ut.u = 1;
  ut.n = liste(c.n).map(a => vaskRad(a, [1, 2], 0)).filter(Boolean);
  ut.e = liste(c.e).map(a => vaskRad(a, [1, 2], 0)).filter(Boolean);
  ut.d = liste(c.d).map(a => vaskRad(a, [0, 1], -1)).filter(Boolean);
  if (c.slim) ut.slim = 1;
  return ut;
}

export function vaskDeltVisning(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const ut = { v: tall(v.v) ?? VERSION, f: tekst(v.f) };
  const cam = tallListe(v.cam, 6);
  if (cam) ut.cam = cam;
  // biblioteks-ID-en limes rett inn i Graph-adressen (/drive/items/<id>) med
  // mottakerens token, så bare tegnene en ekte ID har – ingen «/» eller «..»
  if (typeof v.lib === "string" && /^[A-Za-z0-9!_-]{1,200}$/.test(v.lib)) ut.lib = v.lib;
  const clip = vaskSnitt(v.clip);
  if (clip) ut.clip = clip;
  if (Array.isArray(v.hid)) ut.hid = liste(v.hid).filter(x => typeof x === "string").map(tekst);
  if (v.col && typeof v.col === "object" && !Array.isArray(v.col)) {
    const col = {};
    for (const k of Object.keys(v.col).slice(0, MAKS_LISTE)) {
      const f = farge(v.col[k]);
      if (f && !farligNokkel(k)) col[tekst(k)] = f;
    }
    if (Object.keys(col).length) ut.col = col;
  }
  if (Array.isArray(v.hidId)) ut.hidId = liste(v.hidId).filter(x => tall(x) !== undefined);
  if (v.tc) ut.tc = 1;
  if (v.gh) ut.gh = 1;
  if (v.light) ut.light = 1;
  const cmp = vaskSammenligning(v.cmp);
  if (cmp) ut.cmp = cmp;
  return ut;
}

// ---------- Legg en delt visning på plass ----------
// silent overalt: mottakerens eget lagrede utseende røres ikke.
export async function applyView(v) {
  if (!v) return;
  try {
    if (Array.isArray(v.cam) && v.cam.length === 6) {
      camera.position.set(v.cam[0], v.cam[1], v.cam[2]);
      controls.target.set(v.cam[3], v.cam[4], v.cam[5]);
      controls.update();
    }
    if ((v.hid || v.col || v.tc) && S.modelGroup && !S.lightLoaded && S.modelID !== null) {
      if (!S.typeInfo) { await sikreMeta(alleElementIder); buildTypeInfo(); }
      if (v.col) {
        for (const k in v.col) {
          const g = S.typeInfo.get(k);
          const f = farge(v.col[k]);   // g.color havner i value="…" i fargepanelet
          if (g && f) { g.color = f; g.mat.color.set(f); }
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
    // enkeltelementer som var skjult
    if (Array.isArray(v.hidId) && v.hidId.length && S.modelGroup) {
      v.hidId.forEach(id => hiddenIDs.add(id));
      S.modelGroup.children.forEach(m => {
        if (hiddenIDs.has(m.userData.expressID)) m.visible = false;
      });
      $("btnShowAll").style.display = "";
    }
    if (v.gh && !v.tc && !v.cmp) setGhost(true, true);
    if (v.clip) {
      await applyClipState(v.clip);
      if (v.clip.mode === "none") {           // bare etasjefilter var på
        S.clipOn = false;
        $("btnClip").classList.remove("active");
        $("clipPanel").classList.remove("open");
      }
    }
    // sammenligningen legges på sist – den overtar materialene
    if (v.cmp) applySharedCompare(v.cmp);
  } catch (err) {
    console.warn("Klarte ikke å legge på hele den delte visningen:", err);
  }
}

// ---------- ⛓-knappen ----------
på("btnShare", "click", async () => {
  if (!S.modelGroup) { varsel(t("Åpne en modell først.")); return; }
  const { link, note } = await buildShareLink();
  const body = $("shareBody");
  const fromLib = !!(S.lastLoadInfo && S.lastLoadInfo.libId);
  body.innerHTML =
    '<p style="color:var(--muted); font-size:12px; margin:0 0 8px">' +
      t("Lenka gjenskaper kamera, snitt, etasje, skjulte typer og elementer, fargelegging, gjennomsiktighet") +
      (S.compareOn ? t(" og hele sammenligningen") : '') +
      t(". Den inneholder ingen modellfil og virker uten innlogging.") + '</p>' +
    (note ? '<p style="color:var(--accent2); font-size:12px; margin:0 0 8px">' + ikon("advarsel") + ' ' + esc(note) + '</p>' : '') +
    '<textarea id="shLink" readonly rows="4" style="width:100%; font-size:11px; background:var(--panel2); ' +
      'color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px; resize:vertical">' +
      esc(link) + '</textarea>' +
    '<div class="prop-actions" style="margin-top:10px"><button id="shCopy" class="primary">' + ikon("kopier") + ' ' + t("Kopier lenke") + '</button></div>' +
    '<p style="font-size:11px; color:var(--muted); margin:0">' +
      (fromLib
        ? t("Modellen ligger i biblioteket, så mottakeren kan åpne den med ett trykk.")
        : t("Modellen ble åpnet fra din maskin. Mottakeren må ha samme fil – legg den i Biblioteket hvis flere skal se den.")) +
      t("<br>Lengde: ") + link.length + t(" tegn.") +
      (link.length > 8000 ? t(" <b>Så lange adresser kan bli kuttet i noen program – skjul færre typer.</b>") : '') +
    '</p>';
  $("shCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      $("shCopy").textContent = t("Kopiert");
      setTimeout(() => { if ($("shCopy")) $("shCopy").innerHTML = ikon("kopier") + " " + t("Kopier lenke"); }, 1500);
    } catch(_) {
      $("shLink").select();
      varsel(t("Trykk Ctrl+C for å kopiere lenka."));
    }
  };
  apnePanel("sharePanel");
  $("shLink").select();
});

// ---------- Mottakersiden ----------
// Hashen ble lest i state.js før MSAL fikk røre den.
(async function readIncoming() {
  const h = (S.initialHash || "").replace(/^#/, "");
  if (!h.startsWith(HASH_KEY)) return;
  let v = null;
  try { v = await unpack(h.slice(HASH_KEY.length)); } catch(_) {}
  // vaskes her, der lenka kommer inn, så alt videre (banner, snitt,
  // sammenligning, farger) bare ser kjente felter med riktig type
  v = vaskDeltVisning(v);
  if (!v) return;
  S.sharedView = v;
  showIncomingBanner(v);
})();

function showIncomingBanner(v) {
  const b = $("shareBanner");
  if (!b) return;
  b.style.display = "block";
  b.innerHTML = ikon("del") + ' <b>' + t("Delt visning") + '</b> ' + t("av") + ' «' + esc(v.f || t("en modell")) + '»' +
    (v.cmp ? '<br><span style="font-size:12px">' + t("Inneholder en sammenligning mot «{0}»", esc(v.cmp.b || t("forrige versjon"))) + '</span>' : '') +
    (v.lib ? '<br><button id="shOpen" class="primary" style="margin-top:10px">' + ikon("bibliotek") + ' ' + t("Åpne modellen") + '</button>'
           : '<br><span style="color:var(--muted); font-size:12px">' + t("Åpne samme fil med Åpne-knappen, så legges visningen på automatisk.") + '</span>');
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
    setTimeout(() => varsel(t("Den delte visningen ble laget for «{0}», men du har åpnet «{1}». Visningen legges på så godt det går.", v.f, S.fileName)), 200);
  }
  applyView(v);
};
