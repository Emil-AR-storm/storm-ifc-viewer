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
    alert(t("Lastet opp: ") + prosjekt + "/" + fil + " (" + ids.size + t(" elementer") +
      (utelatt ? ", " + utelatt + t(" små utelatt") : "") + ")");
  } catch (err) {
    console.error(err);
    alert(t("Opplastingen feilet: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});
