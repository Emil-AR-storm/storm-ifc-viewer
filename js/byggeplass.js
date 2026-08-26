// «Byggeplass-lenke»: bygger en lett kopi og laster den opp til Storms
// Cloudflare-lager (R2) gjennom Workeren. Importeres BARE fra main.js –
// bygg.html (lettmodus) laster aldri denne fila.
import { $, S, esc, loadingEl, loadingText } from "./state.js";
import { t } from "./i18n.js";
import { byggLettKopi, lettNavn, lettParametre } from "./lite.js";
import { afterLoad, clearLoadFlag, hentBuffer, loadModel, setLoadFlag } from "./ifc.js";
import { bildeUrl, lastOpp } from "./bilder.js";
import { lagreOgSynk, leggTilImportertMarkering, vaskMarkering } from "./markers.js";
import { tegningNavn } from "./tegninger.js";
import { GRAPH, authHeaders, spTokenSilent } from "./sharepoint.js";
import { materiellForEksport } from "./materiell-vis.js";
import { grupperForEksport } from "./grupper.js";
import { FRISTER, TJENESTER } from "./config.js";

// Adressen til Workeren står i config.js, og kan overstyres av oppsett.json i
// SharePoint. Leses gjennom TJENESTER hver gang – verdien kan komme etter at
// denne fila er lastet.

// ---------- Nøkler i nettleseren ----------
// Begge ligger i sessionStorage, ikke localStorage: de skal ikke bli liggende
// på disk mellom økter. Gammel localStorage-nøkkel ryddes bort under.
const TOKEN_KEY = "storm-bp-token";     // opplasting og admin

const nøkkel = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const settNøkkel = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
const glemNøkkel = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };

// Engangsopprydding: nøkkelen lå i localStorage fram til 6. aug 2026, og skal
// ikke bli liggende igjen der på maskiner som har brukt verktøyet før.
try {
  const gml = localStorage.getItem(TOKEN_KEY);
  if (gml) { settNøkkel(TOKEN_KEY, gml); localStorage.removeItem(TOKEN_KEY); }
} catch (_) {}

const btn = $("btnByggeplass");
if (btn) btn.addEventListener("click", async () => {
  if (!S.modelGroup) { alert(t("Åpne en modell først.")); return; }
  if (S.glbActive) {
    alert(t("Denne modellen er allerede en lett kopi – åpne originalen (IFC) og prøv igjen."));
    return;
  }
  if (!TJENESTER.worker || TJENESTER.worker.startsWith("FYLL")) {
    alert(t("Adressen til byggeplass-tjenesten er ikke satt opp. Den står i js/config.js, og kan overstyres i oppsett.json i SharePoint-mappa."));
    return;
  }

  // Prosjektnummer: felt med sist brukte som forslag (jf. planens «ikke avklart»)
  const prosjekt = (prompt(t("Prosjektnummer (5 siffer):"),
    localStorage.getItem("storm-bp-prosjekt") || "") || "").trim();
  if (!prosjekt) return;
  if (!/^\d{5}$/.test(prosjekt)) { alert(t("Prosjektnummeret må være 5 siffer.")); return; }
  localStorage.setItem("storm-bp-prosjekt", prosjekt);

  // Opplastingsnøkkelen finnes BARE hos den som laster opp (aldri i offentlig kode).
  //
  // sessionStorage og ikke localStorage: nøkkelen forsvinner når fanen lukkes,
  // så det ligger ingen kopi igjen på disk mellom økter. localStorage er en
  // ukryptert fil i nettleserprofilen – kopierer noen profilmappa, eller kjører
  // det skadevare på maskinen, følger nøkkelen med. Prisen er at du taster den
  // én gang per nettleserøkt i stedet for én gang i livet.
  let token = nøkkel(TOKEN_KEY) || "";
  if (!token) {
    token = (prompt(t("Opplastingsnøkkel:")) || "").trim();
    if (!token) return;
    settNøkkel(TOKEN_KEY, token);
  }

  // 🏗 Normalt eller stort prosjekt? Valget BOR HOS WORKEREN (modus.json i
  // prosjektmappa), så det følger prosjektet og ikke maskinen. Finnes det
  // ikke (nytt prosjekt — eller Workeren er ikke deployet med /modus ennå),
  // vises dialogen med de to boksene.
  let modus = "";
  try {
    const mr = await fetch(TJENESTER.worker + "/modus/" + prosjekt, { headers: { "x-token": token } });
    if (mr.ok) modus = ((await mr.json()).modus === "stor") ? "stor" : "normal";
  } catch (_) {}
  if (!modus) {
    modus = await spørModus();
    if (!modus) return;
    await lagreModus(prosjekt, token, modus);
  }

  loadingEl.classList.add("open");
  try {
    // 1) Hent montørenes kvitteringsbilder fra innboksen FØR vi bygger, så den
    //    ferske markerings-JSON-en får med seg de nye etter-bildene
    loadingText.textContent = t("Henter kvitteringer fra byggeplassen …");
    const antallInn = await hentInnboks(prosjekt, token);

    // 2) Bygg og last opp modellen. Stort prosjekt: modellen lastes først om
    //    i lav kvalitet med de tøffe verdiene (0,5 m / 5 kanter) — det er ved
    //    PARSING rørene får kantene sine, så å bygge fra full kvalitet ville
    //    beholdt all rundingen og hele gevinsten var borte.
    let { bytes, ids, utelatt } = await byggMedModus(modus);

    // Cloudflare tar imot ~100 MB per opplasting. Er kopien over grensa i et
    // normalt prosjekt, tilbys bytte til stort prosjekt PÅ FLEKKEN — valget
    // lagres, modellen lastes om og kopien bygges på nytt i samme trykk.
    const GRENSE = 95 * 1048576;
    if (bytes.byteLength > GRENSE && modus !== "stor" &&
        confirm(t("Kopien ble {0} MB — for stor til å laste opp (taket er ~100 MB). Bytte prosjektet til «Stort prosjekt» og bygge på nytt nå?", (bytes.byteLength / 1048576).toFixed(0)))) {
      modus = "stor";
      await lagreModus(prosjekt, token, "stor");
      ({ bytes, ids, utelatt } = await byggMedModus("stor"));
    }
    if (bytes.byteLength > GRENSE) {
      throw new Error(t("Kopien er fortsatt {0} MB — over opplastingstaket på ~100 MB.", (bytes.byteLength / 1048576).toFixed(0)));
    }
    loadingText.textContent = t("Laster opp …");
    const fil = lettNavn(S.fileName);
    // SHA-256 av innholdet: er modellen uendret siden sist, lager Workeren
    // IKKE en ny revisjon (og slipper å skrive fila på nytt)
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
    const r = await fetch(TJENESTER.worker + "/last-opp?fil=" + encodeURIComponent(fil), {
      method: "PUT",
      headers: {
        "content-type": "model/gltf-binary",
        "x-prosjekt": prosjekt,
        "x-token": token,
        "x-innhold-hash": hash
      },
      body: bytes
    });
    if (r.status === 403) {
      glemNøkkel(TOKEN_KEY);
      throw new Error(t("Feil opplastingsnøkkel – trykk på knappen og skriv den på nytt."));
    }
    if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    const uendret = (await r.text()).startsWith("UENDRET");
    huskProsjektFor(fil, prosjekt);   // den røde telleren vet nå hvilket prosjekt modellen hører til

    // 3) Markeringene, VASKET: eier, frist, Planner-kobling, svar og tegninger
    //    holdes igjen med vilje — montøren skal se hva som skal gjøres, ikke
    //    hvem som har ansvaret internt eller hva som ligger i Teams
    loadingText.textContent = t("Laster opp markeringene …");
    const vaskede = (S.comments || []).map(c => ({
      id: c.id, text: c.text || "", author: c.author || "", date: c.date || "",
      // J4: endret/endretAv MÅ være med. Uten dem leser montøren en omskrevet
      // avvikstekst under opprinnelig forfatter og dato, og tror han leser det
      // som ble skrevet i går. (Til forskjell fra eier og frist er dette ikke
      // noe vi holder igjen med vilje – det manglet.)
      endret: c.endret || "", endretAv: c.endretAv || "",
      // FRIST er nå med. Eier og Planner-kobling holdes fortsatt igjen med
      // vilje — montøren skal ikke se hvem som har ansvaret internt. Men
      // fristen er den ene opplysningen som avgjør hva han gjør NÅ, og den lå
      // ferdig utfylt og ble stoppet på veien ut. Uten den ser byggeplassen
      // grå ringer på alt.
      due: c.due || "",
      status: c.status || "Åpen", x: c.x, y: c.y, z: c.z,
      bilder: c.bilder || [], bilderEtter: c.bilderEtter || [], lyd: c.lyd || [],
      // kommentartråden og tegnings-HENVISNINGENE er med nå (trinn 5b) —
      // eier, frist og Planner-kobling holdes fortsatt igjen
      svar: (c.svar || []).map(s => ({ id: s.id, tekst: s.tekst, forfatter: s.forfatter, dato: s.dato, endret: s.endret || "" })),
      // html-flagget MÅ med: uten det prøver mobilen å åpne tegningskatalogen
      // som PDF (.pdf-navnet i R2) og får «ikke lastet opp» (Emils bilde 25.08)
      tegninger: (c.tegninger || []).map(v => ({ fil: v.fil, itemId: v.itemId, side: v.side, storrelse: v.storrelse, html: v.html === true }))
    }));
    // FORMAT 2: fila var tidligere en naken array. Nå er den et objekt, fordi
    // fristgrensene må følge med ut til byggeplassen (ringen rundt markeringen
    // trenger dem) — og fordi Workerens morgenvarsel skal lese SAMME fil og
    // SAMME grenser. Ett regnestykke, ett sted, ingen drift mellom modell og
    // varsel.
    //
    // All lesing tåler begge former (se lastLettMarkeringer i markers.js).
    // Rull ALLTID ut lesingen før skrivingen — ellers står byggeplassen med en
    // fil den ikke forstår til neste push.
    await fetch(TJENESTER.worker + "/last-opp?fil=" + encodeURIComponent(fil + ".markeringer.json"), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-prosjekt": prosjekt, "x-token": token },
      body: JSON.stringify({
        versjon: 2,
        grenser: { gul: FRISTER.gul, rod: FRISTER.rod },
        markeringer: vaskede,
        // 📦 materiell-objektene følger med ut, vasket. Gamle lesere ser bort
        // fra feltet; nye tegner leveransene der de skal ligge.
        materiell: materiellForEksport(),
        grupper: grupperForEksport()
      })
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
          const br = await fetch(TJENESTER.worker + "/last-opp?fil=" + encodeURIComponent(navn) + "&mappe=bilder", {
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

    await visQr(prosjekt, fil, ids.size, vaskede.length, bildeteller, antallInn, antTegninger, uendret, grupperForEksport().length);
    oppdaterBadge();   // innboksen er tømt nå — telleren skal bort
  } catch (err) {
    console.error(err);
    alert(t("Opplastingen feilet: ") + err.message);
  } finally {
    loadingEl.classList.remove("open");
  }
});


// ---------- 🏗 Normalt / stort prosjekt ----------

async function lagreModus(prosjekt, token, modus) {
  try {
    await fetch(TJENESTER.worker + "/last-opp?fil=modus.json", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-prosjekt": prosjekt, "x-token": token },
      body: JSON.stringify({ modus, valgt: new Date().toISOString() })
    });
  } catch (_) {}   // får vi ikke lagret, spørres det bare på nytt neste gang
}

// Dialogen med de to boksene — vises én gang per prosjekt.
function spørModus() {
  return new Promise((res) => {
    const el = document.createElement("div");
    el.id = "bpModus";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:center;justify-content:center";
    el.innerHTML =
      '<div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px;max-width:540px;width:92%">' +
      '<h3 style="margin:0 0 6px">' + t("Nytt prosjekt — velg størrelse") + "</h3>" +
      '<p style="color:var(--muted);font-size:12px;margin:0 0 12px">' + t("Valget lagres på prosjektet og gjelder alle senere opplastinger.") + "</p>" +
      '<div style="display:flex;gap:10px">' +
      '<button id="bpNormal" style="flex:1;padding:14px 10px;border-radius:10px;text-align:left"><b>' + t("Normalt prosjekt") + "</b><br>" +
      '<span style="font-size:11px;color:var(--muted)">' + t("Som i dag — vanlig detaljnivå i byggeplass-kopien.") + "</span></button>" +
      '<button id="bpStor" style="flex:1;padding:14px 10px;border-radius:10px;text-align:left"><b>' + t("Stort prosjekt") + "</b><br>" +
      '<span style="font-size:11px;color:var(--muted)">' + t("For modeller på 200 MB+: småting under 0,5 m utelates og rør får 5 kanter, så kopien lar seg bygge og laste ned.") + "</span></button>" +
      "</div>" +
      '<div style="text-align:right;margin-top:10px"><button id="bpModusAvbryt">' + t("Avbryt") + "</button></div></div>";
    document.body.appendChild(el);
    const ferdig = (v) => { el.remove(); res(v); };
    el.querySelector("#bpNormal").onclick = () => ferdig("normal");
    el.querySelector("#bpStor").onclick = () => ferdig("stor");
    el.querySelector("#bpModusAvbryt").onclick = () => ferdig(null);
  });
}

// Bygger kopien etter modusens parametre. Stort prosjekt: står ikke modellen
// alt i lav kvalitet MED de tøffe verdiene, lastes den om først (samme
// mekanikk som 🪶-knappen). Overstyringen nullstilles etterpå, så en senere
// manuell omlasting av en ANNEN modell ikke arver stort-verdiene.
async function byggMedModus(modus) {
  const p = lettParametre(modus);
  if (modus === "stor") {
    const brukt = S.lettParametreBrukt || {};
    if (!brukt.light || brukt.minst !== p.minst || brukt.sirkel !== p.sirkel) {
      loadingText.textContent = t("Stort prosjekt: laster modellen på nytt med redusert kvalitet …");
      S.lettOverstyr = { minst: p.minst, sirkel: p.sirkel };
      S.lightMode = true;
      const bl = $("btnLight");
      if (bl) bl.classList.add("active");
      try {
        setLoadFlag(Object.assign({}, S.lastLoadInfo || { name: S.fileName }, { light: true }));
        const buf = await hentBuffer();
        if (!buf) throw new Error(t("Fant ikke modellfilen igjen – åpne den på nytt"));
        await loadModel(buf);
        // AFTERLOAD ER IKKE VALGFRITT: loadModel nullstiller modelltilstanden
        // (markeringer, materiell, grupper), og afterLoad er den som leser alt
        // tilbake fra lager. Uten dette kallet pakket Byggeplass-knappen en
        // JSON med 0 markeringer og 0 grupper etter stort prosjekt-omlastingen
        // — det var Emils «Heissjakt forsvinner»-feil 26.08.
        afterLoad();
        clearLoadFlag();
      } finally {
        S.lettOverstyr = null;
      }
    }
    return byggLettKopi((txt) => { loadingText.textContent = txt; }, { minst: p.minst, weld: p.weld });
  }
  return byggLettKopi((txt) => { loadingText.textContent = txt; });
}

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
  const token = nøkkel(TOKEN_KEY) || "";
  let antall = 0;
  if (prosjekt && token) {
    try {
      const r = await fetch(TJENESTER.worker + "/innboks/" + prosjekt, { headers: { "x-token": token } });
      // teller bare selve innholdet — ikke sidekortene (.jpg.json)
      if (r.ok) antall = (await r.json()).filter(n => /\.(jpg|m4a|webm)$/i.test(n) || /^h-.*\.json$/.test(n)).length;
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
// Eldre enn en uke? Brukes til å rydde innboks-poster ingen modell vil kjennes
// ved. Uten tidsstempel regnes posten som fersk – vi sletter aldri i blinde.
const UKE_MS = 7 * 24 * 3600 * 1000;
function gammel(iso) {
  const t = Date.parse(iso || "");
  return isFinite(t) && (Date.now() - t) > UKE_MS;
}

async function hentInnboks(prosjekt, token) {
  let inn = 0;
  const hent = (navn) => fetch(TJENESTER.worker + "/innboks/" + prosjekt + "/" + encodeURIComponent(navn), { headers: { "x-token": token } });
  const slett = (navn) => fetch(TJENESTER.worker + "/innboks/" + prosjekt + "/" + encodeURIComponent(navn), { method: "DELETE", headers: { "x-token": token } });
  try {
    const r = await fetch(TJENESTER.worker + "/innboks/" + prosjekt, { headers: { "x-token": token } });
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
          // kilde: "bygg" settes her og ikke fra innholdet — alt som kommer
          // gjennom innboksen ER fra byggeplassen, uansett hva fila påstår.
          const rene = { id: String(s.id || ""), tekst: String(s.tekst || "").slice(0, 2000),
                         forfatter: String(s.forfatter || ""), dato: String(s.dato || ""),
                         endret: "", kilde: "bygg" };
          if (rene.id && rene.tekst && !(c.svar || []).some(x => String(x.id) === rene.id)) {
            c.svar = (c.svar || []).concat([rene]);
            inn++;
          }
          await slett(navn);
        } else if (gammel(h.mottatt)) {
          // Finner vi ikke markeringen, hører svaret som regel til en annen
          // modell i samme prosjekt, og da skal en annen runde ta det. Men lot
          // vi det ligge for alltid, ville den røde telleren telt det hver
          // eneste gang – en teller som aldri kunne nullstilles. Etter en uke
          // finnes ingen modell som kommer til å hente det, og da ryddes det.
          await slett(navn);
        }
      } else {
        await slett(navn); // ukjent innhold ryddes
      }
    }

    // 2) BILDER (….jpg) og TALEMELDINGER (….m4a/.webm) med sidekort som sier
    //    hvilken seksjon de hører til. Samme navneskjema, samme opprydding —
    //    det eneste som skiller dem er hvilket felt de havner i.
    for (const navn of alle.filter(n => /\.(jpg|m4a|webm)$/i.test(n))) {
      const erLyd = /\.(m4a|webm)$/i.test(navn);
      const deler = navn.replace(/\.(jpg|m4a|webm)$/i, "").split("-");
      if (deler.length < 3) continue;
      const renId = deler.slice(0, deler.length - 2).join("-");
      const c = (S.comments || []).find(k => String(k.id).replace(/[^0-9a-zA-Z]/g, "") === renId);
      if (!c) {
        // Samme sak som for svar over: et bilde som ingen modell vil kjennes
        // ved, blir liggende og telles i det uendelige. Gi det en uke.
        const sr2 = await hent(navn + ".json");
        let tid = "";
        if (sr2.ok) { try { tid = (await sr2.json()).tid || ""; } catch (_) {} }
        if (gammel(tid)) { await slett(navn); await slett(navn + ".json"); }
        continue;
      }
      let seksjon = "etter", av = "", tid = "";
      const sr = await hent(navn + ".json");
      if (sr.ok) {
        try {
          const k = await sr.json();
          seksjon = k.seksjon === "for" ? "for" : "etter";
          av = String(k.av || "");
          tid = k.tid ? new Date(k.tid).toLocaleString("no-NO") : "";
        } catch (_) {}
      }
      const bi = await hent(navn);
      if (!bi.ok) {
        // Stille «continue» her kostet en feilsøkingsrunde: Workeren avviste
        // .m4a på innboks-ruta, filen ble hoppet over, og telleren på
        // Byggeplass-knappen fortsatte å telle noe som aldri kunne hentes.
        // Nå står det i konsollen hva som ikke kom hjem, og hvorfor.
        console.warn("Fikk ikke hentet «" + navn + "» fra innboksen (HTTP " + bi.status + ")");
        continue;
      }
      const blob = await bi.blob();
      await lastOpp(blob, navn);   // til Storms SharePoint — sluttilstanden er at alt ligger her
      if (erLyd) {
        // Talemeldinger bærer avsender og tidspunkt; bildene er bare filnavn.
        if (!(c.lyd || []).some(l => (typeof l === "string" ? l : l && l.fil) === navn))
          c.lyd = (c.lyd || []).concat([{ fil: navn, av, dato: tid }]);
      } else {
        const felt = seksjon === "for" ? "bilder" : "bilderEtter";
        if (!(c[felt] || []).includes(navn)) c[felt] = (c[felt] || []).concat(navn);
      }
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
      // HTML-vedlegg (tegningskatalogen o.l.) reiser samme vei som PDF-ene,
      // bare med sin egen filendelse og content-type.
      const br = await fetch(TJENESTER.worker + "/last-opp?fil=" + encodeURIComponent(tegningNavn(itemId, v.html)) + "&mappe=tegninger", {
        method: "PUT",
        headers: { "content-type": v.html ? "text/html" : "application/pdf", "x-prosjekt": prosjekt, "x-token": token },
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
async function visQr(prosjekt, fil, antall, antMark, antBilder, antInn, antTegninger, uendret, antGrupper) {
  if (!window.QRCode) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      // Flyttet fra cdnjs til jsDelivr. Samme bibliotek (davidshimjs/qrcodejs
      // 1.0.0), men jsDelivr serverer npm-pakken uendret – og da kan hashen
      // regnes ut fra npm og verifiseres. cdnjs har ingen slik kilde vi kan
      // sjekke mot. Det gir dessuten én CDN mindre å stole på.
      //   npm pack qrcodejs@1.0.0 && tar xf *.tgz
      //   openssl dgst -sha384 -binary package/qrcode.min.js | openssl base64 -A
      s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
      s.integrity = "sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU";
      s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = () => rej(new Error("Fikk ikke lastet QR-biblioteket"));
      document.head.appendChild(s);
    });
  }
  const adresse = TJENESTER.worker + "/" + prosjekt;
  const bak = document.createElement("div");
  bak.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99;display:flex;align-items:center;justify-content:center";
  const kort = document.createElement("div");
  kort.style.cssText = "background:#fff;color:#111;border-radius:14px;padding:28px;text-align:center;max-width:380px";
  kort.innerHTML = "<h2 style='margin:0 0 4px'>Prosjekt " + prosjekt + "</h2>" +
    // esc() på filnavnet: det kommer fra S.fileName, som kan være satt fra en
    // fil noen ANNEN har lastet opp i SharePoint. Uten escaping kan et filnavn
    // med <img onerror=…> kjøre kode i denne fanen – der både SharePoint-token
    // og opplastingsnøkkelen ligger. Resten av verdiene under er tall eller
    // validerte (prosjekt er sjekket mot /^\d{5}$/ over).
    "<p style='margin:0 0 14px;font-size:13px;color:#555'>" + esc(fil) + " · " + antall + " elementer · " +
      (antMark || 0) + " markeringer · " + (antBilder || 0) + " bilder" +
      (antTegninger ? " · " + antTegninger + " tegninger" : "") +
      (antGrupper ? " · " + antGrupper + " " + t("grupper") : "") +
      (antInn ? " · " + antInn + " fra byggeplassen hentet inn" : "") +
      (uendret ? "<br><span style='color:#16a34a'>Modellen er uendret — ingen ny revisjon laget</span>" : "") + "</p>" +
    "<div id='qrRute' style='display:flex;justify-content:center'></div>" +
    "<p style='font-size:13px;color:#555;margin:12px 0 2px'>" + adresse + "</p>" +
    "<p style='font-size:13px;color:#555;margin:2px 0 6px'>Skann → skriv prosjektkoden → se modellen</p>" +
    // Rådet står på plakaten og ikke i verktøyet, fordi det må leses FØR
    // montøren går inn der dekningen er borte. Betong og armering er et
    // Faraday-bur: dekningen på plassen kan være utmerket samtidig som den er
    // null der jobben faktisk gjøres. Har han sida oppe fra før, virker den
    // videre — det er sidelasten som krever nett. Legges sida til på
    // Hjem-skjermen, slutter dessuten Safari å slette det som er lagret
    // lokalt etter sju dager uten besøk.
    "<p style='font-size:12px;color:#777;margin:0;line-height:1.5'>" +
      "Åpne modellen <b>før</b> du går inn i bygget — inne i betong og armering " +
      "forsvinner dekningen.<br>Legg siden til på Hjem-skjermen, så ligger den klar." +
    "</p>";
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
