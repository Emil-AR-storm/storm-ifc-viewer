// ▦ QR-koder: biblioteket (davidshimjs/qrcodejs 1.0.0) hentes én gang, første
// gang noen trenger en kode. Delt mellom QR-plakaten for byggeplass-lenka
// (byggeplass.js) og framdriftsplanens PDF (QR til videoen).
//
// jsDelivr serverer npm-pakken uendret – og da kan hashen regnes ut fra npm og
// verifiseres. cdnjs har ingen slik kilde vi kan sjekke mot.
//   npm pack qrcodejs@1.0.0 && tar xf *.tgz
//   openssl dgst -sha384 -binary package/qrcode.min.js | openssl base64 -A
export const QR_URL = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
export const QR_SRI = "sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU";

let laster = null;
export function hentQRCode() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (laster) return laster;
  laster = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = QR_URL;
    s.integrity = QR_SRI;
    s.crossOrigin = "anonymous";
    s.onload = () => res(window.QRCode);
    s.onerror = () => { laster = null; rej(new Error("Fikk ikke lastet QR-biblioteket")); };
    document.head.appendChild(s);
  });
  return laster;
}

// En QR-kode som PNG (data-URL), `px` piksler i firkant. null hvis det ikke går.
export async function qrDataUrl(tekst, px) {
  try {
    const QR = await hentQRCode();
    const holder = document.createElement("div");
    new QR(holder, { text: String(tekst), width: px || 512, height: px || 512, correctLevel: QR.CorrectLevel.M });
    const c = holder.querySelector("canvas");
    if (c && c.toDataURL) return c.toDataURL("image/png");
    const img = holder.querySelector("img");
    return img && img.src ? img.src : null;
  } catch (err) {
    console.warn("QR-koden kunne ikke lages:", err && err.message);
    return null;
  }
}
