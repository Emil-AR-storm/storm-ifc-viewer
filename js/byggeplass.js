// «Byggeplass-lenke»: bygger en lett kopi og laster den opp til Storms
// Cloudflare-lager (R2) gjennom Workeren. Importeres BARE fra main.js –
// bygg.html (lettmodus) laster aldri denne fila.
import { $, S, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { byggLettKopi, lettNavn } from "./lite.js";
import { bildeUrl, lastOpp } from "./bilder.js";
import { lagreOgSynk, leggTilImportertMarkering, vaskMarkering } from "./markers.js";
import { tegningNavn } from "./tegninger.js";
import { GRAPH, authHeaders, spTokenSilent } from "./sharepoint.js";

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
    // 1) Hent montørenes kvitteringsbilder fra innboksen FØR vi bygger, så den
    //    ferske markerings-JSON-en får med seg de nye etter-bildene
    loadingText.textContent = t("Henter kvitteringer fra byggeplassen …");
    const antallInn = await hentInnboks(prosjekt, token);

    // 2) Bygg og last opp modellen
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
    huskProsjektFor(fil, prosjekt);   // den røde telleren vet nå hvilket prosjekt modellen hører til

    // 3) Markeringene, VASKET: eier, frist, Planner-kobling, svar og tegninger
    //    holdes igjen med vilje — montøren skal se hva som skal gjøres, ikke
    //    hvem som har ansvaret internt eller hva som ligger i Teams
    loadingText.textContent = t("Laster opp markeringene …");
    const vaskede = (S.comments || []).map(c => ({
      id: c.id, text: c.text || "", author: c.author || "", date: c.date || "",
      status: c.status || "Åpen", x: c.x, y: c.y, z: c.z,
      bilder: c.bilder || [], bilderEtter: c.bilderEtter || [],
      // kommentartråden og tegnings-HENVISNINGENE er med nå (trinn 5b) —
      // eier, frist og Planner-kobling holdes fortsatt igjen
      svar: (c.svar || []).map(s => ({ id: s.id, tekst: s.tekst, forfatter: s.forfatter, dato: s.dato, endret: s.endret || "" })),
      tegninger: (c.tegninger || []).map(v => ({ fil: v.fil, itemId: v.itemId, side: v.side, storrelse: v.storrelse }))
    }));
    await fetch(WORKER + "/last-opp?fil=" + encodeURIComponent(fil + ".markeringer.json"), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-prosjekt": prosjekt, "x-token": token },
      body: JSON.stringify(vaskede)
    });

    // 4) Bildene på markeringene, så montøren ser dem (hentes fra SharePoint her,
    //    hvor vi ER innlogget, og legges i R2). Feiler ett bilde, fortsetter resten.
    let bildeteller = 0;
    for (const c of vaskede) {
      for (const navn of [...c.bilder, ...c.bilderEtter]) {
        try {
          const url = await bildeUrl(navn);
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          const br = await fetch(WORKER + "/last-opp?fil=" + encodeURIComponent(navn) + "&mappe=bilder", {
            method: "PUT",
            headers: { "content-type": "image/jpeg", "x-prosjekt": prosjekt, "x-token": token },
            body: blob
          });
          if (br.ok) bildeteller++;
        } catch (_) {}
      }
    }

    loadingText.textContent = t("Laster opp arbeidstegningene …");
    const antTegninger = await lastOppTegninger(prosjekt, token);

    await visQr(prosjekt, fil, ids.size, vaskede.length, bildeteller, antallInn, antTegninger);
    oppdaterBadge();   // innboksen er tømt nå — telleren skal bort
  } catch (err) {
    console.error(err);
    alert(t("Opplastingen feilet: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});


// ---------- Rød teller: er det noe nytt fra byggeplassen? ----------
// Prosjektlederen skal ikke måtte GJETTE at innboksen har innhold. Ved åpning
// og hvert minutt sjekkes innboksen for modellen som er åpen, og Byggeplass-
// knappen får en rød teller. Trykk på knappen henter som vanlig alt hjem.
function huskProsjektFor(fil, prosjekt) {
  try {
    const m = JSON.parse(localStorage.getItem("storm-bp-kart") || "{}");
    m[fil] = prosjekt;
    localStorage.setItem("storm-bp-kart", JSON.stringify(m));
  } catch (_) {}
}

function prosjektFor(fil) {
  try { return (JSON.parse(localStorage.getItem("storm-bp-kart") || "{}"))[fil] || ""; } catch (_) { return ""; }
}

async function oppdaterBadge() {
  if (!btn) return;
  const prosjekt = prosjektFor(lettNavn(S.fileName || ""));
  const token = localStorage.getItem("storm-bp-token") || "";
  let antall = 0;
  if (prosjekt && token) {
    try {
      const r = await fetch(WORKER + "/innboks/" + prosjekt, { headers: { "x-token": token } });
      // teller bare selve innholdet — ikke sidekortene (.jpg.json)
      if (r.ok) antall = (await r.json()).filter(n => /\.jpg$/i.test(n) || /^h-.*\.json$/.test(n)).length;
    } catch (_) {}
  }
  let b = btn.querySelector(".bp-badge");
  if (!antall) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement("span");
    b.className = "bp-badge";
    b.style.cssText = "background:#ef4444;color:#fff;border-radius:9px;padding:0 6px;font-size:11px;margin-left:6px;font-weight:700";
    btn.appendChild(b);
  }
  b.textContent = antall;
  btn.title = antall + " " + t("nye ting fra byggeplassen – trykk Byggeplass for å hente dem inn");
}
setTimeout(oppdaterBadge, 4000);      // like etter oppstart (modellen kan alt være åpen)
setInterval(oppdaterBadge, 60000);    // og hvert minutt

// ---------- Innboksen (trinn 5) ----------
// Montørenes kvitteringsbilder ligger i R2 til noen med nøkkelen henter dem.
// Hvert bilde: lastes ned → skrives til Storms SharePoint (vi er innlogget her)
// → henges på riktig markering som etter-bilde → slettes fra innboksen.
// Filnavnet koder markerings-ID-en (bildeNavn i bilder.js), så vi vet hvor det hører til.
async function hentInnboks(prosjekt, token) {
  let inn = 0;
  const hent = (navn) => fetch(WORKER + "/innboks/" + prosjekt + "/" + encodeURIComponent(navn), { headers: { "x-token": token } });
  const slett = (navn) => fetch(WORKER + "/innboks/" + prosjekt + "/" + encodeURIComponent(navn), { method: "DELETE", headers: { "x-token": token } });
  try {
    const r = await fetch(WORKER + "/innboks/" + prosjekt, { headers: { "x-token": token } });
    if (!r.ok) return 0;
    const alle = await r.json();

    // 1) HENDELSER (h-….json): nye markeringer og kommentarer fra byggeplassen
    for (const navn of alle.filter(n => /^h-.*\.json$/.test(n))) {
      const hr = await hent(navn);
      if (!hr.ok) continue;
      let h; try { h = await hr.json(); } catch (_) { continue; }
      if (h.type === "ny-markering" && h.markering) {
        const c = vaskMarkering(h.markering);
        if (c && !(S.comments || []).some(k => String(k.id) === String(c.id))) {
          c.status = "Åpen"; c.owner = ""; c.due = "";   // status og ansvar settes HER, ikke på plassen
          leggTilImportertMarkering(c);
          inn++;
        }
        await slett(navn);
      } else if (h.type === "svar" && h.svar) {
        const c = (S.comments || []).find(k => String(k.id) === String(h.markering));
        if (c) {
          const s = h.svar;
          const rene = { id: String(s.id || ""), tekst: String(s.tekst || "").slice(0, 2000),
                         forfatter: String(s.forfatter || ""), dato: String(s.dato || ""), endret: "" };
          if (rene.id && rene.tekst && !(c.svar || []).some(x => String(x.id) === rene.id)) {
            c.svar = (c.svar || []).concat([rene]);
            inn++;
          }
          await slett(navn);
        }
        // finner vi ikke markeringen (annen modell i samme prosjekt), lar vi den ligge
      } else {
        await slett(navn); // ukjent innhold ryddes
      }
    }

    // 2) BILDER (….jpg) med sidekort (….jpg.json) som sier før eller etter
    for (const navn of alle.filter(n => /\.jpg$/i.test(n))) {
      const deler = navn.replace(/\.jpg$/i, "").split("-");
      if (deler.length < 3) continue;
      const renId = deler.slice(0, deler.length - 2).join("-");
      const c = (S.comments || []).find(k => String(k.id).replace(/[^0-9a-zA-Z]/g, "") === renId);
      if (!c) continue; // hører til en annen modell i samme prosjekt — la den ligge
      let seksjon = "etter";
      const sr = await hent(navn + ".json");
      if (sr.ok) { try { seksjon = (await sr.json()).seksjon === "for" ? "for" : "etter"; } catch (_) {} }
      const bi = await hent(navn);
      if (!bi.ok) continue;
      const blob = await bi.blob();
      await lastOpp(blob, navn);   // til Storms SharePoint — sluttilstanden er at alt ligger her
      const felt = seksjon === "for" ? "bilder" : "bilderEtter";
      if (!(c[felt] || []).includes(navn)) c[felt] = (c[felt] || []).concat(navn);
      await slett(navn);
      await slett(navn + ".json");
      inn++;
    }

    if (inn) lagreOgSynk();
  } catch (_) {}
  return inn;
}

// ---------- Arbeidstegninger ut (trinn 5b) ----------
// Tegninger markeringene henviser til hentes fra SharePoint (vi er innlogget)
// og legges i R2, så montøren kan åpne dem. Hver unike tegning én gang.
async function lastOppTegninger(prosjekt, token) {
  const sett = new Map();
  (S.comments || []).forEach(c => (c.tegninger || []).forEach(v => { if (v.itemId) sett.set(v.itemId, v); }));
  if (!sett.size) return 0;
  let opp = 0;
  const spToken = await spTokenSilent();
  if (!spToken || !S.spSiteId) return 0;
  for (const [itemId, v] of sett) {
    try {
      const r = await fetch(GRAPH + "/sites/" + S.spSiteId + "/drive/items/" +
        encodeURIComponent(itemId) + "/content", { headers: authHeaders(spToken, null, "tegning-ut") });
      if (!r.ok) continue;
      const blob = await r.blob();
      const br = await fetch(WORKER + "/last-opp?fil=" + encodeURIComponent(tegningNavn(itemId)) + "&mappe=tegninger", {
        method: "PUT",
        headers: { "content-type": "application/pdf", "x-prosjekt": prosjekt, "x-token": token },
        body: blob
      });
      if (br.ok) opp++;
    } catch (_) {}
  }
  return opp;
}

// ---------- QR-plakat (trinn 4) ----------
// Vises etter vellykket opplasting: QR-en peker på WORKER/<prosjektnr>.
// Koden er IKKE i QR-en — montøren skal skrive den selv. Last ned som PNG
// og lim inn i en arbeidstegning eller heng på brakkeveggen.
async function visQr(prosjekt, fil, antall, antMark, antBilder, antInn, antTegninger) {
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
    "<p style='margin:0 0 14px;font-size:13px;color:#555'>" + fil + " · " + antall + " elementer · " +
      (antMark || 0) + " markeringer · " + (antBilder || 0) + " bilder" +
      (antTegninger ? " · " + antTegninger + " tegninger" : "") +
      (antInn ? " · " + antInn + " fra byggeplassen hentet inn" : "") + "</p>" +
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
