// 🔗 «FJERNET + NY» SOM ER DET SAMME ELEMENTET (Emil 26.10.2026, byggeplan runde 1)
//
// Når modelleren sletter et objekt og tegner det på nytt, får det ny GlobalId
// selv om stålet er helt likt. Sammenligningen på GlobalId sa da «fjernet + ny»,
// og EM-en kunne prise stål som ikke var endret (Em-test 3: fire bjelker i A3
// og ti søyler i A2/A3/A4/F4).
//
// Denne fila ser BARE på restene — elementene som ikke fant partner på
// GlobalId. Kopierte elementer som står i begge revisjonene med sin egen ID,
// er allerede paret og er aldri med her. Tre trinn:
//
//   1 Revit-nummer: samme tall etter siste kolon i navnet («…:235953») og samme
//     type/profil = samme element, uansett avstand. Kopierer man i Revit, får
//     kopien nytt nummer.
//   2 Samme sted: senter ≤ 5 mm, ytre mål ±1 mm, samme type/profil = samme
//     element. To stålelementer kan ikke stå på samme sted; står to nye oppå
//     ett gammelt, flagges det som mulig dobbeltelement.
//   3 I nærheten (≤ 1 m), samme type/profil, entydig (gjensidig nærmeste, og
//     neste kandidat minst dobbelt så langt unna) = FORSLAG. Aldri slått
//     sammen av seg selv — brukeren krysser av. En rad med like åser kan ellers
//     pare feil åser.
//
// REN: ingen DOM og ingen three.js. Koordinater i modellenheter, toM = meter per enhet.
import { typeNokkel } from "./em-regn.js";
import { dimensjonAv } from "./em-detalj.js";

export const SAMME_STED_MM = 5;
export const MAAL_MM = 1;
export const NAER_MM = 1000;

export function revitNr(navn) {
  const m = /:(\d{4,})\s*$/.exec(String(navn || ""));
  return m ? m[1] : "";
}
const utenId = (n) => String(n || "").replace(/:\d+\s*$/, "").trim();
export function profilNokkel(e) {
  return typeNokkel(e.type) + "|" + (dimensjonAv(e.name) || utenId(e.name).toLowerCase());
}
// Navnet på koordineringsobjekter (ikke fysisk stål): proxy-typen eller «Coordination»
export function erKoordinering(type, navn) {
  return typeNokkel(type) === "ifcbuildingelementproxy" || /(coordination|koordineringsobjekt|survey ?marker|survey ?point|kontrollpunkt)/i.test(String(navn || ""));
}

const avstMm = (a, b, toM) => Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]) * toM * 1000;
const maalLike = (a, b, toM) => [0, 1, 2].every(i => Math.abs((a.d[i] - b.d[i]) * toM * 1000) <= MAAL_MM);
const volLik = (a, b) => !(a.v > 0) || Math.abs((b.v - a.v) / a.v) <= 0.005;

// slettet: elementene fra den gamle modellen uten partner. ny: fra den nye.
// Svar: { samme: [{ fra, til, grunn: "revit"|"sted", uendret, avstandMm }],
//         forslag: [{ fra, til, avstandMm }], dobbelt: [til], slettet, ny }
export function parFjernetNy(slettet, ny, o) {
  const toM = Number(o && o.toM) || 1;
  const S = (slettet || []).filter(e => e && e.c && e.d), N = (ny || []).filter(e => e && e.c && e.d);
  const bruktS = new Set(), bruktN = new Set();
  const samme = [], forslag = [], dobbelt = [];
  // ⚡ Emils stresstest 27.10 (6 166 mot 7 784 elementer): alle-mot-alle tok
  // 130 s. Profilnøkkelen regnes én gang per element, og kandidatene hentes fra
  // et rutenett (1 m ruter) per profil i stedet for hele lista. Samme svar.
  const pk = new Map();
  for (const e of S) pk.set(e, profilNokkel(e));
  for (const e of N) pk.set(e, profilNokkel(e));
  const celle = (NAER_MM / 1000) / toM;
  const rute = (c) => [Math.floor(c[0] / celle), Math.floor(c[1] / celle), Math.floor(c[2] / celle)];
  const lagNett = (liste) => {
    const nett = new Map();
    for (const e of liste) { const r = rute(e.c), k = pk.get(e) + "#" + r.join("|"); if (!nett.has(k)) nett.set(k, []); nett.get(k).push(e); }
    return nett;
  };
  // alle i samme profil innen `n` ruter
  const naboer = (nett, e, n) => {
    const r = rute(e.c), p = pk.get(e), ut = [];
    for (let x = r[0] - n; x <= r[0] + n; x++) for (let y = r[1] - n; y <= r[1] + n; y++) for (let z = r[2] - n; z <= r[2] + n; z++) {
      const l = nett.get(p + "#" + x + "|" + y + "|" + z); if (l) for (const q of l) ut.push(q);
    }
    return ut;
  };
  const nettS = lagNett(S), nettN = lagNett(N);
  const ut = (fra, til, grunn) => {
    const a = avstMm(fra, til, toM);
    samme.push({ fra, til, grunn, avstandMm: Math.round(a), uendret: a <= SAMME_STED_MM && maalLike(fra, til, toM) && volLik(fra, til) });
    bruktS.add(fra); bruktN.add(til);
  };

  // 1) Revit-nummer
  const perNr = new Map();
  for (const s of S) { const nr = revitNr(s.name); if (nr) { const k = nr + "|" + pk.get(s); if (!perNr.has(k)) perNr.set(k, []); perNr.get(k).push(s); } }
  for (const n of N) {
    const nr = revitNr(n.name); if (!nr) continue;
    const kand = (perNr.get(nr + "|" + pk.get(n)) || []).filter(s => !bruktS.has(s));
    if (!kand.length) continue;
    kand.sort((a, b) => avstMm(a, n, toM) - avstMm(b, n, toM));
    ut(kand[0], n, "revit");
  }

  // 2) Samme sted
  for (const n of N) {
    if (bruktN.has(n)) continue;
    const kand = naboer(nettS, n, 1).filter(s => !bruktS.has(s) && avstMm(s, n, toM) <= SAMME_STED_MM && maalLike(s, n, toM));
    if (!kand.length) continue;
    kand.sort((a, b) => avstMm(a, n, toM) - avstMm(b, n, toM));
    ut(kand[0], n, "sted");
  }
  // To nye på stedet til ett gammelt: den andre er et mulig dobbeltelement
  const stedTil = samme.filter(p => p.grunn === "sted").map(p => p.til);
  const nettSted = lagNett(stedTil);
  for (const n of N) {
    if (bruktN.has(n)) continue;
    if (naboer(nettSted, n, 1).some(t => avstMm(t, n, toM) <= SAMME_STED_MM)) dobbelt.push(n);
  }

  // 3) Forslag: gjensidig nærmeste innen 1 m, og klart nærmest (neste minst
  //    dobbelt så langt unna — derfor søkes det to ruter ut, ≥ 2 m)
  const dobbeltSett = new Set(dobbelt);
  const restS = new Set(S.filter(s => !bruktS.has(s))), restN = new Set(N.filter(n => !bruktN.has(n) && !dobbeltSett.has(n)));
  const naermest = (x, nett, rest) => naboer(nett, x, 2).filter(y => rest.has(y)).map(y => ({ y, a: avstMm(x, y, toM) })).sort((p, q) => p.a - q.a);
  for (const n of restN) {
    const kn = naermest(n, nettS, restS);
    if (!kn.length || kn[0].a > NAER_MM) continue;
    if (kn[1] && kn[1].a < kn[0].a * 2) continue;          // ikke entydig
    const s = kn[0].y;
    const ks = naermest(s, nettN, restN);
    if (!ks.length || ks[0].y !== n || (ks[1] && ks[1].a < ks[0].a * 2)) continue;   // ikke gjensidig / ikke entydig
    forslag.push({ fra: s, til: n, avstandMm: Math.round(kn[0].a) });
  }
  return { samme, forslag, dobbelt, slettet: S.filter(s => !bruktS.has(s)).concat((slettet || []).filter(e => !(e && e.c && e.d))),
    ny: N.filter(n => !bruktN.has(n)).concat((ny || []).filter(e => !(e && e.c && e.d))) };
}

// Nøkkel for et forslag (avkrysningen i panelet huskes på den)
export const forslagNokkel = (f) => String(f.fra.guid || f.fra.name) + ">" + String(f.til.guid || f.til.id);
