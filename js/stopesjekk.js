// 📋 SJEKKLISTE FØR STØP — kontoret (runde 9a, Emils valg 5C 30.10.2026).
//
// En seksjon i hvert etappekort i Støpeplan: «📋 Sjekkliste før støp 7/12»,
// lista med avhuking (hvem og når), signering (samme signaturboks som
// Dagsrapport og skjemaene) og PDF (samme skjema-motor som sjekklistene på
// markeringer). «Klar til støp» er låst til alt er huket av og signert.
// Byggeplass-siden (runde 9b) huker av på telefonen — svarene kommer inn hit
// via innboksen (byggeplass.js), med bildene (📷 åpner bildeviseren).
//
// Regningen står i stopesjekk-regn.js. stopeplan.js tegner kortet og gir oss
// `endre(id, endring, angreTekst)` — samme lagring og angre som resten av panelet.
import { S, esc, ikon } from "./state.js";
import { t } from "./i18n.js";
import { varsel } from "./varsel.js";
import * as J from "./stopesjekk-regn.js";

const apne = new Set();          // etapper der lista er slått ut
let malPunkter = null;           // fra SharePoint-malen «for-stop» (eller null = standard)
export const _apne = apne;

// Malen i SharePoint-mappa Sjekklister (id «for-stop»), hentet én gang per økt
export async function hentPunkter() {
  if (malPunkter) return malPunkter;
  try {
    const { hentMaler } = await import("./sjekkliste.js");
    const r = await hentMaler();
    const mal = r && Array.isArray(r.maler) ? r.maler.find(m => m.id === J.MAL_ID) : null;
    const p = mal ? J.punkterFraMal(mal) : [];
    if (p.length) malPunkter = p;
  } catch (_) {}
  return malPunkter || J.STD_PUNKTER;
}

const navn = () => (S.innloggetNavn ? S.innloggetNavn() : "") || "";

export function sjekkHtml(e) {
  const st = J.sjekkStatus(e.sjekk);
  const apen = apne.has(e.id);
  const pst = st.totalt ? Math.round(st.ok / st.totalt * 100) : 0;
  const farge = st.kanKlar ? "var(--ok)" : st.ok ? "var(--warn)" : "var(--danger)";
  let h = '<div class="sj-boks">' +
    '<div class="st-rad sj-topp"><span>📋 ' + esc(t("Sjekkliste før støp")) + "</span>" +
    (e.sjekk ? '<span class="fdv-pill" style="background:' + farge + ";color:" + (st.ok && !st.kanKlar ? "#111" : "#fff") + '">' + st.ok + "/" + st.totalt + "</span>" : "") +
    (e.sjekk && st.signert ? '<span class="sj-sign">✍ ' + esc(e.sjekk.signert.av) + "</span>" : "") + "</div>";
  if (e.sjekk) h += '<div class="sj-bar"><i style="width:' + pst + "%;background:" + farge + '"></i></div>';
  h += '<div class="st-rad st-knapper">' +
    (e.sjekk ? '<button class="sj-apne">' + esc(apen ? t("Lukk sjekklista") : t("Åpne sjekklista")) + "</button>"
      : '<button class="sj-start">' + esc(t("Start sjekkliste")) + "</button>") +
    (e.status === "stopt" ? "" : e.klar
      ? '<span class="sj-klar">✅ ' + esc(t("Klar til støp")) + '</span><button class="sj-ikke-klar" title="' + esc(t("Angre «klar til støp»")) + '">' + esc(t("Angre")) + "</button>"
      : '<button class="sj-klar-knapp"' + (st.kanKlar ? "" : ' disabled title="' + esc(t("Huk av alle punktene og signer først")) + '"') + ">" + (st.kanKlar ? "" : "🔒 ") + esc(t("Klar til støp")) + "</button>") +
    "</div>";
  if (e.sjekk && apen) {
    h += '<div class="sj-liste">' + e.sjekk.punkter.map(p => {
      const a = e.sjekk.svar[p.id];
      return '<label class="sj-punkt"><input type="checkbox" data-sj-punkt="' + esc(p.id) + '"' + (a && a.ok ? " checked" : "") + "> <span>" + esc(t(p.tekst)) +
        (a && a.ok ? '<small>' + esc([a.av, J.kortTid(a.tid), a.kilde === "bygg" ? "📱 " + t("byggeplassen") : ""].filter(Boolean).join(" · ")) + "</small>" : "") + "</span>" +
        (a && a.bilde ? '<button class="sj-bilde" data-sj-bilde="' + esc(a.bilde) + '" title="' + esc(t("Vis bildet")) + '">📷</button>' : "") + "</label>";
    }).join("") + "</div>" +
    (e.sjekk.signert ? '<p class="set-hjelp">✍ ' + esc(t("Signert av {0}, {1}", e.sjekk.signert.av, J.kortTid(e.sjekk.signert.tid))) + (e.sjekk.signert.kilde === "bygg" ? " · 📱 " + esc(t("byggeplassen")) : "") + "</p>" : "") +
    '<div class="st-rad st-knapper">' +
      (st.ferdig && !st.signert ? '<button class="sj-signer primary">' + ikon("hake") + " " + esc(t("Signer")) + "</button>" : "") +
      (!st.ferdig ? '<span class="set-hjelp">' + esc(t("Signering blir mulig når alle punktene er huket av.")) + "</span>" : "") +
      '<button class="sj-pdf">' + ikon("lastned") + " " + esc(t("PDF")) + "</button>" +
    "</div>";
  }
  return h + "</div>";
}

// rad = etappekortet, e = etappen, endre(id, endring, angreTekst) fra stopeplan.js
export function koblSjekk(rad, e, endre, tegnPanel) {
  const q = (s) => rad.querySelector(s);
  const start = q(".sj-start");
  if (start) start.onclick = async () => { apne.add(e.id); endre(e.id, { sjekk: J.nySjekk(await hentPunkter()) }, "Sjekkliste startet"); };
  const ap = q(".sj-apne");
  if (ap) ap.onclick = () => { if (apne.has(e.id)) apne.delete(e.id); else apne.add(e.id); tegnPanel(); };
  rad.querySelectorAll("[data-sj-punkt]").forEach(c => c.onchange = () => {
    endre(e.id, { sjekk: J.settPunkt(e.sjekk, c.dataset.sjPunkt, c.checked, navn(), new Date().toISOString(), "kontor"), klar: false },
      c.checked ? "Punkt huket av" : "Punkt tatt av");
  });
  const sg = q(".sj-signer");
  if (sg) sg.onclick = async () => {
    const { bePåSignatur } = await import("./sjekkliste.js");
    const s = await bePåSignatur(navn());
    if (!s || !String(s.navn || "").trim()) return;
    endre(e.id, { sjekk: J.signer(e.sjekk, s.navn, new Date().toISOString(), s.signatur || "", "kontor") }, "Sjekkliste signert");
  };
  const kl = q(".sj-klar-knapp");
  if (kl) kl.onclick = () => { if (J.sjekkStatus(e.sjekk).kanKlar) endre(e.id, { klar: true }, "Klar til støp"); };
  const ik = q(".sj-ikke-klar");
  if (ik) ik.onclick = () => endre(e.id, { klar: false }, "Ikke klar til støp");
  // 📷 Bildene fra telefonen (9b): bildeviseren, blar mellom etappens bilder
  rad.querySelectorAll("[data-sj-bilde]").forEach(b => b.onclick = async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const alle = e.sjekk.punkter.map(p => e.sjekk.svar[p.id] && e.sjekk.svar[p.id].bilde).filter(Boolean);
    const { visBildeListe } = await import("./markers.js");
    visBildeListe(alle, Math.max(0, alle.indexOf(b.dataset.sjBilde)), t("Sjekkliste før støp"));
  });
  const pdf = q(".sj-pdf");
  if (pdf) pdf.onclick = () => lastNedPdf(e);
}

export async function lastNedPdf(e) {
  const { mal, skjema } = J.somSkjema(e.sjekk, t("Sjekkliste før støp"), t);
  const P = await import("./skjema-pdf.js");
  const info = S.prosjektInfo ? S.prosjektInfo() : {};
  const prosjekt = [info.nummer, info.navn].filter(Boolean).join(" · ") || String(S.fileName || "").replace(/\.(ifc|glb)$/i, "");
  try {
    const fil = await P.lastNedSkjema({ mal, skjema, prosjekt, referanse: t("Etappe {0}", e.nr) + " · " + e.navn + (e.dato ? " · " + e.dato.split("-").reverse().join(".") : ""),
      iDag: new Date().toISOString().slice(0, 10), hentLogo: hentStopeLogo });
    varsel(t("Sjekklista er lastet ned: {0}", fil));
  } catch (err) { varsel(t("Klarte ikke å lage PDF-en: {0}", err.message)); }
}
// Samme logo som Støpeplan-PDF-en (valget «Logo på PDF» i panelet)
async function hentStopeLogo() {
  try {
    const fil = S.stopeLogoFil ? S.stopeLogoFil() : "";
    if (!fil) return null;
    const { hentLogoer, hentLogo } = await import("./tegninger.js");
    const l = ((await hentLogoer()) || []).find(x => x.fil === fil);
    return l ? await hentLogo(l.itemId) : null;
  } catch (_) { return null; }
}
