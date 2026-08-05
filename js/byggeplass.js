// «Byggeplass-lenke»: bygger en lett kopi og laster den opp til Storms
// Cloudflare-lager (R2) gjennom Workeren. Importeres BARE fra main.js –
// bygg.html (lettmodus) laster aldri denne fila.
import { $, S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { byggLettKopi, lettNavn } from "./lite.js";

// Fylles inn når Workeren er publisert, f.eks.:
// "https://storm-byggeplass.dittkontonavn.workers.dev"
const WORKER = "https://storm-byggeplass.emil-46a.workers.dev";

const btn = $("btnByggeplass");
if (btn) btn.addEventListener("click", async () => {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  if (S.glbActive) {
    alert(t("Denne modellen er allerede en lett kopi – åpne originalen (IFC) og prøv igjen."));
    return;
  }
  if (WORKER.startsWith("FYLL")) {
    alert("Worker-adressen er ikke fylt inn øverst i js/byggeplass.js ennå.");
    return;
  }

  // Prosjektnummer: felt med sist brukte som forslag (jf. planens «ikke avklart»)
  const prosjekt = (prompt(t("Prosjektnummer (5 siffer):"),
    localStorage.getItem("storm-bp-prosjekt") || "") || "").trim();
  if (!prosjekt) return;
  if (!/^\d{5}$/.test(prosjekt)) { alert(t("Prosjektnummeret må være 5 siffer.")); return; }
  localStorage.setItem("storm-bp-prosjekt", prosjekt);

  // Opplastingsnøkkelen finnes BARE hos den som laster opp (aldri i offentlig kode).
  // Huskes i localStorage etter første gang. Feil nøkkel → glemmes, så du kan prøve på nytt.
  let token = localStorage.getItem("storm-bp-token") || "";
  if (!token) {
    token = (prompt(t("Opplastingsnøkkel:")) || "").trim();
    if (!token) return;
    localStorage.setItem("storm-bp-token", token);
  }

  loadingEl.classList.add("open");
  try {
    const { bytes, ids, utelatt } = await byggLettKopi((txt) => { loadingText.textContent = txt; });
    loadingText.textContent = t("Laster opp …");
    const fil = lettNavn(S.fileName);
    const r = await fetch(WORKER + "/last-opp?fil=" + encodeURIComponent(fil), {
      method: "PUT",
      headers: {
        "content-type": "model/gltf-binary",
        "x-prosjekt": prosjekt,
        "x-token": token
      },
      body: bytes
    });
    if (r.status === 403) {
      localStorage.removeItem("storm-bp-token");
      throw new Error(t("Feil opplastingsnøkkel – trykk på knappen og skriv den på nytt."));
    }
    if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    await visQr(prosjekt, fil, ids.size);
  } catch (err) {
    console.error(err);
    alert(t("Opplastingen feilet: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});


// ---------- QR-plakat (trinn 4) ----------
// Vises etter vellykket opplasting: QR-en peker på WORKER/<prosjektnr>.
// Koden er IKKE i QR-en — montøren skal skrive den selv. Last ned som PNG
// og lim inn i en arbeidstegning eller heng på brakkeveggen.
async function visQr(prosjekt, fil, antall) {
  if (!window.QRCode) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = res; s.onerror = () => rej(new Error("Fikk ikke lastet QR-biblioteket"));
      document.head.appendChild(s);
    });
  }
  const adresse = WORKER + "/" + prosjekt;
  const bak = document.createElement("div");
  bak.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99;display:flex;align-items:center;justify-content:center";
  const kort = document.createElement("div");
  kort.style.cssText = "background:#fff;color:#111;border-radius:14px;padding:28px;text-align:center;max-width:380px";
  kort.innerHTML = "<h2 style='margin:0 0 4px'>Prosjekt " + prosjekt + "</h2>" +
    "<p style='margin:0 0 14px;font-size:13px;color:#555'>" + fil + " · " + antall + " elementer</p>" +
    "<div id='qrRute' style='display:flex;justify-content:center'></div>" +
    "<p style='font-size:13px;color:#555;margin:12px 0 2px'>" + adresse + "</p>" +
    "<p style='font-size:13px;color:#555;margin:2px 0 14px'>Skann → skriv prosjektkoden → se modellen</p>";
  const lastNed = document.createElement("button");
  lastNed.className = "btn"; lastNed.textContent = "Last ned QR som PNG";
  lastNed.style.cssText = "margin-right:8px";
  const lukk = document.createElement("button");
  lukk.className = "btn"; lukk.textContent = "Lukk";
  kort.appendChild(lastNed); kort.appendChild(lukk);
  bak.appendChild(kort); document.body.appendChild(bak);
  new QRCode(kort.querySelector("#qrRute"), { text: adresse, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
  lastNed.onclick = () => {
    const c = kort.querySelector("#qrRute canvas");
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "byggeplass-QR-" + prosjekt + ".png";
    a.click();
  };
  lukk.onclick = () => bak.remove();
}
