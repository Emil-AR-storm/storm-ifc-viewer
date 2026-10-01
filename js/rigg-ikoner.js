// 🏕 Rigg — IKONENE. Ett lite bilde per objekttype, tegnet på et lerret.
//
// HVORFOR ET LERRET OG IKKE SVG (Emil 29.09): de samme ikonene skal stå både i
// rigg-panelet og i tegnforklaringen på riggplan-PDF-en. jsPDF tar et PNG-bilde
// rett inn (addImage), mens SVG må tegnes om for hånd. Ett sett tegninger,
// brukt begge steder, så panelet og arket aldri er uenige om hva et symbol betyr.
//
// Ikonene står på et lyst, avrundet merke, så de er like lesbare i mørkt og
// lyst tema og på hvitt papir. Fargen er objektets egen (lagringsområdene kan
// ha hver sin), resten er faste. Våre egne enkle tegninger, ingen offisielle
// symboler (førstehjelp er hvitt kors på grønt, ikke Røde Kors-merket).
//
// Uten lerret (Node-testene) gir riggIkon null, og kalleren bruker fargeflisen
// som før.

const cache = new Map();
const MORK = "#1f2a33";

export function riggIkon(type, farge, px) {
  const s = px || 96;
  const nokkel = type + "|" + (farge || "") + "|" + s;
  if (cache.has(nokkel)) return cache.get(nokkel);
  let data = null;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = s;
      const x = c.getContext("2d");
      if (x && typeof x.fillRect === "function" && typeof c.toDataURL === "function") {
        tegn(x, s, type, farge || "#888888");
        data = c.toDataURL("image/png");
        if (typeof data !== "string" || !data.startsWith("data:image/png")) data = null;
      }
    }
  } catch (_) { data = null; }
  cache.set(nokkel, data);
  return data;
}

// Til testene: typene som har en egen tegning (resten får et fargemerke).
export const IKON_TYPER = ["brakke", "hjulbrakke", "toalett", "forstehjelp", "mote", "strom", "lys", "container", "hms",
  "soppel", "parkering", "lagring", "vaskeplass", "gjerde", "gjerdePort", "pilKjoretoy", "pilGaende", "taarnkran", "royk", "hmstavle"];

function tone(hex, f) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const k = (v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  return "#" + ((1 << 24) + (k((n >> 16) & 255) << 16) + (k((n >> 8) & 255) << 8) + k(n & 255)).toString(16).slice(1);
}

function tegn(x, s, type, farge) {
  const k = s / 96;
  x.save();
  x.scale(k, k);
  // merket
  rund(x, 2, 2, 92, 92, 16); x.fillStyle = "#f4f6f8"; x.fill();
  x.lineWidth = 2; x.strokeStyle = "#c9d0d6"; x.stroke();
  x.lineJoin = "round"; x.lineCap = "round";
  const f = (c) => { x.fillStyle = c; };
  const st = (c, w) => { x.strokeStyle = c; x.lineWidth = w; };
  const R = (a, b, c, d, farge2) => { f(farge2); x.fillRect(a, b, c, d); };
  const P = (pts, farge2, strek) => {
    x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath();
    if (farge2) { f(farge2); x.fill(); }
    if (strek) { st(strek, 2.5); x.stroke(); }
  };
  const kant = tone(farge, 0.55);
  switch (type) {
    case "brakke":
      R(12, 30, 72, 42, farge); st(kant, 2); x.strokeRect(12, 30, 72, 42);        // omriss: lyse brakker skal synes på det lyse merket
      R(10, 26, 76, 6, kant); R(10, 72, 76, 5, kant);
      for (const vx of [18, 34, 50]) R(vx, 40, 10, 12, MORK);
      R(66, 44, 12, 28, MORK);
      break;
    case "hjulbrakke":
      rund(x, 10, 26, 70, 40, 8); f(farge); x.fill(); st(tone(farge, 0.45), 2.5); x.stroke();
      R(18, 36, 12, 12, MORK); R(38, 36, 12, 12, MORK);
      x.beginPath(); x.arc(34, 72, 9, 0, Math.PI * 2); f("#222"); x.fill();
      x.beginPath(); x.arc(34, 72, 4, 0, Math.PI * 2); f("#b0b7bd"); x.fill();
      st("#37474f", 4); x.beginPath(); x.moveTo(80, 60); x.lineTo(90, 70); x.stroke();
      break;
    case "toalett":
      R(30, 22, 36, 8, tone(farge, 1.6)); R(32, 30, 32, 52, farge);
      R(38, 36, 20, 42, tone(farge, 1.3));
      f("#ffffff"); x.font = "bold 13px Arial, sans-serif"; x.textAlign = "center"; x.fillText("WC", 48, 58);
      break;
    case "forstehjelp":
      rund(x, 18, 18, 60, 60, 6); f(farge); x.fill();
      R(42, 26, 12, 44, "#ffffff"); R(26, 42, 44, 12, "#ffffff");
      break;
    case "mote":
      rund(x, 16, 16, 64, 64, 8); f(farge); x.fill();
      f("#ffffff"); x.font = "bold 44px Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("M", 48, 50);
      break;
    case "strom":
      R(28, 14, 40, 60, farge); R(26, 12, 44, 5, kant); R(36, 74, 24, 10, "#546e7a");
      P([[52, 22], [38, 48], [48, 48], [42, 68], [60, 38], [50, 38], [56, 22]], "#fdd835", "#111");
      break;
    case "lys":
      st("#4a5157", 4);
      x.beginPath(); x.moveTo(48, 30); x.lineTo(48, 84); x.moveTo(48, 60); x.lineTo(26, 86); x.moveTo(48, 60); x.lineTo(70, 86); x.stroke();
      R(26, 26, 44, 5, "#4a5157");
      for (const lx of [20, 54]) { R(lx, 14, 22, 16, farge); R(lx + 3, 17, 16, 10, "#fff6c4"); }
      st(tone(farge, 0.8), 2.5);
      x.beginPath(); x.moveTo(24, 34); x.lineTo(14, 48); x.moveTo(72, 34); x.lineTo(82, 48); x.stroke();
      break;
    case "container":
      R(10, 28, 76, 44, farge);
      for (let i = 0; i < 9; i++) R(14 + i * 8, 32, 3, 36, kant);
      R(8, 26, 80, 5, kant); R(8, 70, 80, 5, kant);
      break;
    case "hms":
      R(28, 14, 40, 56, farge); R(44, 70, 8, 14, "#78909c"); R(32, 82, 32, 4, "#78909c");
      R(34, 24, 28, 18, "#ffffff"); R(34, 24, 28, 5, "#1f5fbf"); R(37, 31, 8, 9, "#90a4ae");
      R(38, 52, 20, 5, "#26c6da");
      break;
    case "soppel":
      P([[14, 30], [82, 30], [72, 74], [24, 74]], farge, kant);
      R(12, 28, 72, 5, kant);
      st(kant, 3); x.beginPath(); x.moveTo(36, 36); x.lineTo(36, 68); x.moveTo(60, 36); x.lineTo(60, 68); x.stroke();
      break;
    case "parkering":
      rund(x, 16, 16, 64, 64, 8); f("#1f5fbf"); x.fill();          // P-skiltet er alltid blått
      f("#ffffff"); x.font = "bold 48px Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("P", 48, 51);
      break;
    case "lagring":
      R(12, 16, 72, 64, tone(farge, 0.45)); R(18, 22, 60, 52, farge);
      R(28, 58, 40, 6, "#ffffff"); R(28, 64, 6, 6, "#ffffff"); R(45, 64, 6, 6, "#ffffff"); R(62, 64, 6, 6, "#ffffff");
      R(30, 40, 16, 16, "#ffffff"); R(50, 40, 16, 16, "#ffffff"); R(40, 26, 16, 14, "#ffffff");
      break;
    case "vaskeplass":
      R(12, 16, 72, 64, tone(farge, 0.45)); R(18, 22, 60, 52, farge);
      for (const [dx, dy] of [[36, 38], [58, 38], [47, 58]]) {
        x.beginPath(); x.moveTo(dx, dy - 12); x.quadraticCurveTo(dx + 9, dy + 2, dx, dy + 6); x.quadraticCurveTo(dx - 9, dy + 2, dx, dy - 12); f("#1f5fbf"); x.fill();
      }
      break;
    case "gjerde":
      st(farge, 1.5);
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(12 + i * 9, 22); x.lineTo(12 + i * 9, 70); x.stroke(); }
      for (let j = 0; j <= 4; j++) { x.beginPath(); x.moveTo(12, 22 + j * 12); x.lineTo(84, 22 + j * 12); x.stroke(); }
      st(tone(farge, 0.6), 4); x.strokeRect(12, 22, 72, 48);
      R(6, 70, 16, 8, "#a7a39b"); R(74, 70, 16, 8, "#a7a39b");
      break;
    case "gjerdePort":
      st(farge, 4); x.strokeRect(12, 22, 72, 50);
      x.beginPath(); x.moveTo(48, 22); x.lineTo(48, 72); x.moveTo(12, 22); x.lineTo(48, 72); x.lineTo(84, 22); x.stroke();
      break;
    case "pilKjoretoy":
    case "pilGaende": {
      const kf = tone(farge, 0.45);
      const pil = (farge2, u) => {
        if (type === "pilGaende") {
          for (const [a, b] of [[10, 22], [28, 40], [46, 56]]) R(a - u, 42 - u, b - a + 2 * u, 12 + 2 * u, farge2);
          P([[56 - u, 30 - u], [88 + u * 1.6, 48], [56 - u, 66 + u]], farge2);
        } else {
          R(10 - u, 40 - u, 50 + 2 * u, 16 + 2 * u, farge2);
          P([[56 - u, 26 - u], [88 + u * 1.6, 48], [56 - u, 70 + u]], farge2);
        }
      };
      pil(kf, 2.5); pil(farge, 0);
      break;
    }
    case "taarnkran": {
      // svingsirkelen (grønn sektor) bak, masta og bommen foran
      x.beginPath(); x.moveTo(48, 50); x.arc(48, 50, 38, Math.PI * 0.75, Math.PI * 1.9); x.closePath(); f("rgba(46,157,74,0.35)"); x.fill();
      st("#2e9d4a", 2); x.beginPath(); x.arc(48, 50, 38, Math.PI * 0.75, Math.PI * 1.9); x.stroke();
      st(farge, 4); x.beginPath(); x.moveTo(40, 86); x.lineTo(40, 26); x.moveTo(52, 86); x.lineTo(52, 26); x.stroke();
      st(farge, 2); for (let y = 30; y < 86; y += 10) { x.beginPath(); x.moveTo(40, y); x.lineTo(52, y + 10); x.stroke(); }
      st(farge, 4); x.beginPath(); x.moveTo(10, 26); x.lineTo(88, 26); x.stroke();
      R(68, 20, 16, 12, "#7d858c");                                  // motvekten
      st("#3a3f46", 1.5); x.beginPath(); x.moveTo(46, 12); x.lineTo(14, 26); x.moveTo(46, 12); x.lineTo(80, 26); x.moveTo(46, 12); x.lineTo(46, 26); x.stroke();
      st("#3a3f46", 1.5); x.beginPath(); x.moveTo(22, 26); x.lineTo(22, 52); x.stroke(); R(19, 52, 6, 6, "#f2b705");
      R(34, 84, 24, 6, "#9a9a96");
      break;
    }
    case "royk":
      R(12, 16, 72, 64, tone(farge, 0.45)); R(18, 22, 60, 52, farge);
      R(24, 56, 40, 8, "#ffffff"); R(64, 56, 8, 8, "#f57c00");
      st("#ffffff", 3);
      for (const sx of [34, 46]) { x.beginPath(); x.moveTo(sx, 52); x.bezierCurveTo(sx + 6, 44, sx - 6, 38, sx, 28); x.stroke(); }
      break;
    case "hmstavle":
      R(16, 34, 4, 50, "#5f666d"); R(76, 34, 4, 50, "#5f666d");
      R(12, 18, 72, 44, farge); R(16, 28, 64, 30, "#f7f8f9");
      f("#ffffff"); x.font = "bold 9px Arial, sans-serif"; x.textAlign = "center"; x.fillText("HMS", 48, 26);
      for (const ax of [20, 36, 52, 66]) { R(ax, 31, 11, 24, "#ffffff"); R(ax + 2, 34, 7, 2, "#37474f"); R(ax + 2, 39, 7, 1.5, "#9aa4ad"); R(ax + 2, 43, 7, 1.5, "#9aa4ad"); }
      R(10, 14, 76, 5, tone(farge, 0.6));
      break;
    default:
      rund(x, 22, 22, 52, 52, 8); f(farge); x.fill();
  }
  x.restore();
}

function rund(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
  x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
  x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
  x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b);
  x.closePath();
}
