// ⛰ Terreng — den rene regningen. Ingen DOM, ingen three.js, ingen nettkall.
//
// Alt her kan testes rett i Node (_test/test-terreng.mjs), og det er med vilje:
// feilene som koster i dette verktøyet er REGNEFEIL som ser ut som noe annet.
// Et terreng som er tusen ganger for lite ser ut som at terrenget «ikke kom»,
// og en nord/sør-speiling ser ut som feil tomt. Begge fanges av en test, ikke
// av et øyekast.
//
// KILDEN ER KARTVERKET, ALDRI GOOGLE (spesifikasjonen punkt 2):
//   · adresse → koordinat: ws.geonorge.no/adresser/v1/sok — ingen nøkkel
//   · høyder: WCS «Høyde DTM» (NHM_DTM_25833), 1 m grid fra laserskanning
// Begge svarer med CORS, så nettleseren henter direkte — målt 25.09.2026 fra
// emil-ar-storm.github.io: adressesøket 200 OK, GeoTIFF 400 × 400 m på 1 MB
// og ~0,5 sek. Ingen Worker trengs.
//
// KOORDINATENE ER UTM SONE 33 (EPSG:25833) I METER, HØYDENE ER NN2000 (moh.).
// Hele Norge — også Vestlandet, der øst-koordinaten blir NEGATIV i sone 33 —
// ligger i samme system. Det er derfor vi ber adresse-API-et om 25833 og ikke
// bruker lengde/bredde: da er avstander i meter rett ut av kassa.

export const WCS_URL = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833";
export const WCS_DEKNING = "NHM_DTM_25833";
export const ADRESSE_URL = "https://ws.geonorge.no/adresser/v1/sok";

// Utsnittene panelet tilbyr, som SIDELENGDE i meter. 400 er en gjetning på en
// vanlig Storm-tomt (byggeplanen: «se på en ekte tomt før du låser det») —
// derfor et valg og ikke et fast tall. 800 × 800 m er 640 000 punkt og
// ~2,5 MB, fortsatt raskt; større enn det gir ingenting en byggeplass trenger.
// 50 og 100 m kom til 25.09 (Emil): en liten tomt eller et tilbygg trenger
// ikke 400 m landskap, og en mindre flate er lettere å se detaljer i.
// 1000–2000 m kom til 25.09 (Emil): Drammenselva ved Geithus ligger 1,2 km
// fra tomta og kom ikke med i 600 m.
export const UTSNITT = [50, 100, 200, 400, 600, 800, 1000, 1500, 2000];

// Flest punkt per side vi henter. 2000 m med 1 m oppløsning er 4 millioner
// punkt og 16 MB — for tungt for en nettleser, og ingen trenger meteren
// 1 km unna tomta. Over 1000 m blir rutene større: 1500 m → 1,5 m, 2000 m → 2 m.
export const MAKS_PX = 1000;
export const STANDARD_UTSNITT = 400;

// Høyder utenfor dette er ikke terreng. Kartverket har ingen nodata-tagg i
// fila; sjøen kommer som 3,4·10³⁸ (float-maks) og enkelte kystpiksler som
// hundrevis av meter UNDER havet (målt: −772 m ved Rådhusgata i Oslo). Norges
// høyeste punkt er 2469 moh.
export const MIN_HOYDE = -100;
export const MAKS_HOYDE = 2600;

// ═══════════════════════ ENHETER ═══════════════════════
//
// DEN ENE FELLA SOM KAN ØDELEGGE ALT. Scenen tegnes i MODELLENS enheter:
// en mm-modell teller i millimeter (S.enhetSkala = 0,001 meter per enhet).
// Kartverket leverer meter. Uten denne omregningen blir terrenget tusen ganger
// for lite på en mm-modell. Speiler mmTilScene() i materiell-vis.js.
export function mTilScene(m, skala) {
  const s = Number(skala) > 0 ? Number(skala) : 1;
  return (Number(m) || 0) / s;
}

// ═══════════════════════ INNDATA ═══════════════════════

// Skriver brukeren to tall i stedet for en adresse, er det en UTM33-koordinat
// fra et kart eller en landmåler: «218262 6652579», «218262, 6652579» eller
// «Ø 218262 N 6652579». Øst ligger mellom ca. −100 000 og 1 100 000 i sone 33,
// nord mellom 6,4 og 8,0 millioner. Rekkefølgen tåles begge veier — det er
// lett å bytte om på dem, og tallområdene overlapper ikke.
// Svar: { E, N } eller null (da er det en adresse).
export function tolkKoordinat(tekst) {
  const s = String(tekst || "").trim();
  if (!s || /[a-zæøå]{3,}/i.test(s)) return null;   // et ord på tre bokstaver = adresse
  const tall = (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (tall.length !== 2) return null;
  const erN = (v) => v >= 6.3e6 && v <= 8.0e6;
  const erE = (v) => v >= -1.2e5 && v <= 1.2e6;
  if (erE(tall[0]) && erN(tall[1])) return { E: tall[0], N: tall[1] };
  if (erN(tall[0]) && erE(tall[1])) return { E: tall[1], N: tall[0] };
  return null;
}

// Adressesøket. `fuzzy` er AV første gang: med den på ble «Storgata 14
// Vikersund» til «Storgaten 14, EGERSUND» (prøvd 25.09.2026). Den brukes bare
// som andre forsøk når det eksakte søket gir null treff — og treffene vises
// alltid med poststed, så brukeren ser om det ble feil by.
export function adresseUrl(tekst, fuzzy) {
  return ADRESSE_URL + "?sok=" + encodeURIComponent(String(tekst || "").trim()) +
    "&treffPerSide=5&utkoordsys=25833" + (fuzzy ? "&fuzzy=true" : "");
}

// Alt som kommer utenfra vaskes. Merk feltnavnene: API-et kaller NORD for
// «lat» og ØST for «lon» også når svaret er i UTM — de heter det samme
// uansett koordinatsystem.
export function vaskAdresse(a) {
  if (!a || typeof a !== "object") return null;
  const p = a.representasjonspunkt || {};
  const E = Number(p.lon), N = Number(p.lat);
  if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
  if (String(p.epsg || "").indexOf("25833") < 0) return null;   // ikke UTM33 = feil tall
  const tekst = String(a.adressetekst || "").slice(0, 120).trim();
  if (!tekst) return null;
  return {
    tekst,
    postnummer: String(a.postnummer || "").slice(0, 8),
    poststed: String(a.poststed || "").slice(0, 60),
    kommune: String(a.kommunenavn || "").slice(0, 60),
    E, N
  };
}

export function vaskAdresseSvar(json) {
  const liste = json && Array.isArray(json.adresser) ? json.adresser : [];
  return liste.map(vaskAdresse).filter(Boolean);
}

// Navneforslag fra adressen (spesifikasjonen punkt 3). Brukes når terrenget
// lagres i trinn 7; står her fordi det er ren tekstregning.
export function navneforslag(adr) {
  if (!adr) return "";
  const sted = adr.poststed ? adr.poststed.charAt(0) + adr.poststed.slice(1).toLowerCase() : "";
  return [adr.tekst, sted].filter(Boolean).join(", ");
}

// ═══════════════════════ UTSNITTET ═══════════════════════

// Kvadrat rundt punktet, med hjørnene på hele meter. Kartverkets grid ligger
// på hele meter; et utsnitt som starter på x,5 gir halvpiksler som enten
// interpoleres (unøyaktig) eller avrundes forskjellig fra gang til gang.
export function bboxFra(E, N, side) {
  const s = Math.max(50, Math.min(2000, Math.round(Number(side) || STANDARD_UTSNITT)));
  const h = s / 2;
  const e0 = Math.round(Number(E) - h), n0 = Math.round(Number(N) - h);
  return { minE: e0, minN: n0, maxE: e0 + s, maxN: n0 + s, side: s };
}

// 1 piksel per meter: bredde og høyde = sidelengden. Det er DTM1-oppløsningen;
// ber vi om flere piksler, finner tjenesten bare på mellomverdier.
export function gridPx(side) {
  return Math.max(1, Math.min(MAKS_PX, Math.round(side)));
}

export function wcsUrl(bbox) {
  return WCS_URL + "?service=WCS&version=1.0.0&request=GetCoverage" +
    "&coverage=" + WCS_DEKNING + "&crs=EPSG:25833" +
    "&bbox=" + [bbox.minE, bbox.minN, bbox.maxE, bbox.maxN].join(",") +
    "&width=" + gridPx(bbox.side) + "&height=" + gridPx(bbox.side) + "&format=GeoTIFF";
}

// ═══════════════════════ GEOTIFF ═══════════════════════
//
// EGEN LESER, IKKE geotiff.js. Byggeplanen regnet med et bibliotek på ~200 kB.
// Kveld 0 viste at Kartverkets svar er det enkleste TIFF-formatet som finnes:
// ukomprimert (Compression = 1), ett bånd, 32-bits flyttall (SampleFormat = 3),
// lagt i fliser på 128 × 128. Da er lesingen 80 linjer — og ingen ny fil i
// vendor/, ingen ny post i importmap-en, ingenting å holde oppdatert.
// Kommer det noe annet enn dette (komprimert, heltall), sier leseren fra med
// en melding i stedet for å levere søppel.

const TIFF_STR = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

export function lesTiff(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : (buf && buf.buffer) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null;
  if (!ab || ab.byteLength < 16) throw new Error("tom fil");
  const dv = new DataView(ab);
  const bom = dv.getUint16(0, false);
  if (bom !== 0x4949 && bom !== 0x4D4D) {
    // Tjenesten svarer 200 med en XML-feilmelding når noe er galt i spørringen.
    const tekst = new TextDecoder().decode(new Uint8Array(ab, 0, Math.min(ab.byteLength, 2000)));
    const m = tekst.match(/<ServiceException(?:\s[^>]*)?>([\s\S]*?)<\/ServiceException>/);
    throw new Error(m ? m[1].trim() : "ikke en TIFF-fil");
  }
  const le = bom === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error("BigTIFF støttes ikke");
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);

  const ifd = u32(4), n = u16(ifd), tag = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const id = u16(o), typ = u16(o + 2), cnt = u32(o + 4);
    const str = (TIFF_STR[typ] || 1) * cnt;
    const vo = str <= 4 ? o + 8 : u32(o + 8);
    const verdi = (k) => {
      const p = vo + k * (TIFF_STR[typ] || 1);
      switch (typ) {
        case 3: return u16(p);
        case 4: return u32(p);
        case 11: return dv.getFloat32(p, le);
        case 12: return dv.getFloat64(p, le);
        default: return dv.getUint8(p);
      }
    };
    if (typ === 2) {
      let s = ""; for (let k = 0; k < cnt; k++) { const c = dv.getUint8(vo + k); if (c) s += String.fromCharCode(c); }
      tag[id] = s;
    } else {
      const v = []; for (let k = 0; k < cnt; k++) v.push(verdi(k));
      tag[id] = v;
    }
  }
  const en = (id, std) => (tag[id] && tag[id].length) ? tag[id][0] : std;
  const w = en(256, 0), h = en(257, 0);
  if (!w || !h) throw new Error("mangler bredde/høyde");
  if (en(259, 1) !== 1) throw new Error("komprimert TIFF støttes ikke (Compression " + en(259, 1) + ")");
  if (en(277, 1) !== 1) throw new Error("bare ett bånd støttes");
  if (en(258, 0) !== 32 || en(339, 1) !== 3) throw new Error("forventet 32-bits flyttall");
  const skala = tag[33550], tie = tag[33922];
  if (!skala || !tie || tie.length < 6) throw new Error("mangler georeferanse");
  const dx = skala[0], dy = skala[1];
  // Tiepoint: piksel (I,J) → modellkoordinat (X,Y). Kartverket gir (0,0) →
  // hjørnet oppe til venstre, altså VESTKANT og NORDKANT av første piksel.
  const x0 = tie[3] - tie[0] * dx, y0 = tie[4] + tie[1] * dy;

  const data = new Float32Array(w * h);
  const f32 = (p) => dv.getFloat32(p, le);
  if (tag[322] && tag[324]) {
    // Fliser (Kartverket i dag). Kantflisene er fylt ut til full flis —
    // radbredden i fila er FLISBREDDEN, ikke bildebredden.
    const tw = en(322, 0), th = en(323, 0), offs = tag[324];
    const perRad = Math.ceil(w / tw);
    for (let ty = 0; ty < Math.ceil(h / th); ty++) {
      for (let tx = 0; tx < perRad; tx++) {
        const base = offs[ty * perRad + tx];
        for (let y = 0; y < th; y++) {
          const gy = ty * th + y; if (gy >= h) break;
          for (let x = 0; x < tw; x++) {
            const gx = tx * tw + x; if (gx >= w) break;
            data[gy * w + gx] = f32(base + (y * tw + x) * 4);
          }
        }
      }
    }
  } else if (tag[273]) {
    // Striper (vanlig i filer lastet ned fra hoydedata.no for hånd)
    const rps = en(278, h), offs = tag[273];
    for (let s = 0; s < offs.length; s++) {
      for (let r = 0; r < rps; r++) {
        const gy = s * rps + r; if (gy >= h) break;
        for (let x = 0; x < w; x++) data[gy * w + x] = f32(offs[s] + (r * w + x) * 4);
      }
    }
  } else throw new Error("mangler bildedata");

  const nd = tag[42113] ? Number(tag[42113]) : null;
  return { w, h, data, x0, y0, dx, dy, nodata: Number.isFinite(nd) ? nd : null };
}

export function gyldigHoyde(v, nodata) {
  return Number.isFinite(v) && v > MIN_HOYDE && v < MAKS_HOYDE && v !== nodata;
}

// Piksel (i, j) → senterkoordinat. j = 0 er NORDLIGSTE rad.
export function pikselSenter(grid, i, j) {
  return { E: grid.x0 + (i + 0.5) * grid.dx, N: grid.y0 - (j + 0.5) * grid.dy };
}

// Høyde i et vilkårlig punkt, bilineært mellom de fire nærmeste pikslene.
// null utenfor gridet eller hvis et av hjørnene mangler høyde.
export function hoydeVed(grid, E, N) {
  const fi = (E - grid.x0) / grid.dx - 0.5, fj = (grid.y0 - N) / grid.dy - 0.5;
  const i = Math.floor(fi), j = Math.floor(fj);
  if (i < 0 || j < 0 || i + 1 >= grid.w || j + 1 >= grid.h) return null;
  const u = fi - i, v = fj - j, d = grid.data, w = grid.w;
  const a = d[j * w + i], b = d[j * w + i + 1], c = d[(j + 1) * w + i], e = d[(j + 1) * w + i + 1];
  if (![a, b, c, e].every(x => gyldigHoyde(x, grid.nodata))) return null;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
}

export function hoydeSpenn(grid) {
  let min = Infinity, max = -Infinity, gyldige = 0;
  for (let k = 0; k < grid.data.length; k++) {
    const v = grid.data[k];
    if (!gyldigHoyde(v, grid.nodata)) continue;
    gyldige++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return gyldige ? { min, max, gyldige } : { min: 0, max: 0, gyldige: 0 };
}

// ═══════════════════════ GRID → TREKANTER ═══════════════════════
//
// Aksene i scenen (three.js er Y opp, og IFC-lasteren legger IFC-nord langs
// −Z): ØST → +X, NORD → −Z, HØYDE → +Y. Koordinatene regnes RELATIVT til et
// nullpunkt (E0, N0, h0), ellers ville Float32 i GPU-en spist desimalene —
// 6 652 579 meter har bare plass til ~0,5 m presisjon i en float.
//
// Viklingen er valgt så normalen peker OPP: (a, b, c) med a = (i, j),
// b = (i, j+1), c = (i+1, j) gir (b−a)×(c−a) = +Y. Snus den, lyses terrenget
// fra undersiden og ser svart ut.
//
// Trekanter som rører en piksel uten høyde (sjø, hull i laserdataene) hoppes
// over — heller et hull enn et stup ned til −772 m.
// `flat` (valgfri) = { flagg: Uint8Array, hoyde: moh } — punktene som er
// flagget legges i den høyden. Det er utskjæringen rundt bygget: terrenget
// innenfor plata senkes til like under plata, så det ikke stikker gjennom.
export function gridTilTrekanter(grid, E0, N0, h0, skala, flat) {
  const { w, h } = grid;
  const pos = new Float32Array(w * h * 3);
  const ok = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const c = pikselSenter(grid, i, j);
      const v = grid.data[k];
      ok[k] = gyldigHoyde(v, grid.nodata) ? 1 : 0;
      pos[k * 3] = mTilScene(c.E - E0, skala);
      const hv = (flat && flat.flagg[k]) ? flat.hoyde : v;
      pos[k * 3 + 1] = ok[k] ? mTilScene(hv - h0, skala) : 0;
      pos[k * 3 + 2] = -mTilScene(c.N - N0, skala);
    }
  }
  return { pos, idx: lagIndeks(ok, w, h, null), ok };
}

// Trekantene innenfor et klipp. Punktene (posisjonene) er de samme for hele
// gridet — BESKJÆRINGEN BYTTER BARE INDEKSEN. Da kan brukeren dra kanten ut
// igjen uten et nytt nettkall (byggeplanen, trinn 4), og det er raskt nok til
// å gjøres for hvert musetrekk: 400 × 400 m er ~10 ms.
// klipp = { i0, i1, j0, j1 } — første og siste PUNKT (inklusive) i hver retning.
export function lagIndeks(ok, w, h, klipp) {
  const k = klipp || { i0: 0, i1: w - 1, j0: 0, j1: h - 1 };
  const i0 = Math.max(0, k.i0), i1 = Math.min(w - 1, k.i1);
  const j0 = Math.max(0, k.j0), j1 = Math.min(h - 1, k.j1);
  const n = Math.max(0, (i1 - i0) * (j1 - j0) * 6);
  const idx = new Uint32Array(n);
  let o = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = j * w + i, b = a + w, c = a + 1, d = b + 1;
      if (ok[a] && ok[b] && ok[c]) { idx[o++] = a; idx[o++] = b; idx[o++] = c; }
      if (ok[c] && ok[b] && ok[d]) { idx[o++] = c; idx[o++] = b; idx[o++] = d; }
    }
  }
  return o === n ? idx : idx.slice(0, o);
}

// ═══════════════════════ BESKJÆRING ═══════════════════════

export function fulltKlipp(grid) {
  return { i0: 0, i1: grid.w - 1, j0: 0, j1: grid.h - 1 };
}

// Hvor stort klippet er, i meter. Hvert punkt er senteret i en 1 m-rute, så
// punktene i0…i1 dekker (i1 − i0 + 1) ruter: hele 400-gridet er 400 m, ikke 399.
export function klippMeter(grid, k) {
  return { bredde: (k.i1 - k.i0 + 1) * grid.dx, hoyde: (k.j1 - k.j0 + 1) * grid.dy };
}

// Koordinat → nærmeste punkt i gridet, klemt innenfor.
export function punktFraE(grid, E) {
  return Math.max(0, Math.min(grid.w - 1, Math.round((E - grid.x0) / grid.dx - 0.5)));
}
export function punktFraN(grid, N) {
  return Math.max(0, Math.min(grid.h - 1, Math.round((grid.y0 - N) / grid.dy - 0.5)));
}

// Minste klipp: 10 m. Mindre enn det er ikke et terreng, det er en flekk —
// og da kan de to kantene ikke lenger skilles fra hverandre med musa.
export const MIN_KLIPP_M = 10;

// Flytter én kant (n/s/v/o) eller ett hjørne (nv/no/sv/so) til punktet (i, j).
// NORD er j0 (øverste rad i fila), SØR j1, VEST i0, ØST i1. Motstående kant
// står stille, og klippet blir aldri mindre enn MIN_KLIPP_M.
export function flyttKlippKant(grid, klipp, kant, i, j) {
  const k = Object.assign({}, klipp);
  const minI = Math.max(1, Math.round(MIN_KLIPP_M / grid.dx) - 1);
  const minJ = Math.max(1, Math.round(MIN_KLIPP_M / grid.dy) - 1);
  const ii = Math.max(0, Math.min(grid.w - 1, Math.round(i)));
  const jj = Math.max(0, Math.min(grid.h - 1, Math.round(j)));
  if (kant.includes("v")) k.i0 = Math.min(ii, k.i1 - minI);
  if (kant.includes("o")) k.i1 = Math.max(ii, k.i0 + minI);
  if (kant.includes("n")) k.j0 = Math.min(jj, k.j1 - minJ);
  if (kant.includes("s")) k.j1 = Math.max(jj, k.j0 + minJ);
  k.i0 = Math.max(0, k.i0); k.j0 = Math.max(0, k.j0);
  k.i1 = Math.min(grid.w - 1, k.i1); k.j1 = Math.min(grid.h - 1, k.j1);
  return k;
}

export function likeKlipp(a, b) {
  return !!a && !!b && a.i0 === b.i0 && a.i1 === b.i1 && a.j0 === b.j0 && a.j1 === b.j1;
}

// Høyden i et punkt (i, j) — også et brøkpunkt (midt på en kant). Nærmeste
// punkt med høyde; null bare hvis det ikke finnes noe gyldig der.
export function hoydeIPunkt(grid, i, j) {
  const ii = Math.max(0, Math.min(grid.w - 1, Math.round(i)));
  const jj = Math.max(0, Math.min(grid.h - 1, Math.round(j)));
  const v = grid.data[jj * grid.w + ii];
  return gyldigHoyde(v, grid.nodata) ? v : null;
}

// De åtte håndtakene: fire hjørner og fire kantmidter, som (i, j).
export function klippHandtak(k) {
  const mi = (k.i0 + k.i1) / 2, mj = (k.j0 + k.j1) / 2;
  return [
    { kant: "nv", i: k.i0, j: k.j0 }, { kant: "n", i: mi, j: k.j0 }, { kant: "no", i: k.i1, j: k.j0 },
    { kant: "o", i: k.i1, j: mj }, { kant: "so", i: k.i1, j: k.j1 }, { kant: "s", i: mi, j: k.j1 },
    { kant: "sv", i: k.i0, j: k.j1 }, { kant: "v", i: k.i0, j: mj }
  ];
}

// Omrisset rundt klippet, punkt for punkt langs kantene (med urviseren fra
// nordvest), så streken kan legges oppå terrenget i stedet for å sveve.
export function klippOmriss(k) {
  const ut = [];
  for (let i = k.i0; i <= k.i1; i++) ut.push([i, k.j0]);
  for (let j = k.j0 + 1; j <= k.j1; j++) ut.push([k.i1, j]);
  for (let i = k.i1 - 1; i >= k.i0; i--) ut.push([i, k.j1]);
  for (let j = k.j1 - 1; j > k.j0; j--) ut.push([k.i0, j]);
  return ut;
}

// Farge per punkt etter høyde: grønt i bunnen, brunt i midten, lyst på
// toppen. Ren pynt — men et helt grått terreng er vanskelig å lese høyder av.
// Spennet strekkes over tomtas EGET spenn, så 12 m fall på en tomt synes like
// godt som 400 m fall i en fjellside.
const FARGE_LAV = [0.40, 0.52, 0.32], FARGE_MIDT = [0.55, 0.48, 0.35], FARGE_HOY = [0.76, 0.73, 0.66];
export function hoydeFarger(grid, spenn) {
  const n = grid.w * grid.h, ut = new Float32Array(n * 3);
  const lo = spenn.min, d = Math.max(1e-6, spenn.max - spenn.min);
  for (let k = 0; k < n; k++) {
    const v = grid.data[k];
    const t = gyldigHoyde(v, grid.nodata) ? Math.max(0, Math.min(1, (v - lo) / d)) : 0;
    const [a, b, u] = t < 0.5 ? [FARGE_LAV, FARGE_MIDT, t * 2] : [FARGE_MIDT, FARGE_HOY, (t - 0.5) * 2];
    for (let c = 0; c < 3; c++) ut[k * 3 + c] = a[c] + (b[c] - a[c]) * u;
  }
  return ut;
}

// ═══════════════════════ PLASSERING (trinn 5) ═══════════════════════
//
// MODELLEN FLYTTES ALDRI. Markeringer, materiell, SW-elementer, snitt og
// delte lenker står alle i modellens koordinater — flytter vi modellen, flytter
// vi alt det. Det er TERRENGET som legges under bygget, med en plassering:
//
//   plass = { pE, pN, rot }
//     pE, pN — hvor byggets senter står, i meter øst/nord for adressepunktet
//     rot    — byggets rotasjon i forhold til terrenget, i grader MED KLOKKA
//              sett ovenfra (som et kompass). 0 = modellens −Z peker mot nord.
//
// «Byggrammen» er modellens plan i METER, med origo i modellens senter og
// aksene langs scenens X og Z (Z peker mot sør når rot = 0).

export function terrengTilBygg(E, N, E0, N0, plass) {
  const t = (plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = E - E0 - (plass.pE || 0), lz = -(N - N0 - (plass.pN || 0));
  return { bx: lx * c + lz * s, bz: -lx * s + lz * c };
}

export function byggTilTerreng(bx, bz, E0, N0, plass) {
  const t = (plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = bx * c - bz * s, lz = bx * s + bz * c;
  return { E: E0 + (plass.pE || 0) + lx, N: N0 + (plass.pN || 0) - lz };
}

// Et flytt i byggrammen (meter) → nytt senterpunkt i terrenget. Bygget
// flyttes over terrenget, så senteret flytter seg like langt i TERRENGETS
// retninger — derfor roteres flyttet tilbake med byggets rotasjon.
export function flyttPlass(plass, dbx, dbz) {
  const t = (plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = dbx * c - dbz * s, lz = dbx * s + dbz * c;
  return { pE: (plass.pE || 0) + lx, pN: (plass.pN || 0) - lz, rot: plass.rot || 0 };
}

// Grader til [0, 360), med én desimal.
export function normVinkel(g) {
  const v = ((Number(g) || 0) % 360 + 360) % 360;
  return Math.round(v * 10) / 10 % 360;
}

// Snapper til nærmeste 90° når vinkelen er innenfor `tol` grader. Bygg står
// nesten alltid rett på en vei eller en nabogrense — 90°-trinnene er det man
// oftest vil ha, og det skal være lett å treffe dem med musa.
export function snapVinkel(g, tol) {
  const v = normVinkel(g), n = Math.round(v / 90) * 90;
  return Math.abs(v - n) <= (tol == null ? 4 : tol) ? normVinkel(n) : v;
}

// Laveste terrenghøyde innenfor et rektangel i byggrammen (fotavtrykket).
// Brukes av «Legg oppå terrenget»: gulvet på laveste punkt betyr at bygget
// ikke svever noe sted — resten graves ned. null hvis det ikke finnes høyder.
export function lavesteUnder(grid, E0, N0, plass, r) {
  let min = Infinity;
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const v = grid.data[j * grid.w + i];
      if (!gyldigHoyde(v, grid.nodata)) continue;
      const c = pikselSenter(grid, i, j);
      const b = terrengTilBygg(c.E, c.N, E0, N0, plass);
      if (b.bx >= r.x0 && b.bx <= r.x1 && b.bz >= r.z0 && b.bz <= r.z1 && v < min) min = v;
    }
  }
  if (min < Infinity) return min;
  // Mindre enn en rute (lite bygg, 1 m-grid): ta høyden midt i
  const m = byggTilTerreng((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, E0, N0, plass);
  return hoydeVed(grid, m.E, m.N);
}

// ═══════════════════════ UTSKJÆRING (plata rundt bygget) ═══════════════════════
//
// Terrenget går rett gjennom bygget — inn i hallen og opp over gulvet. Plata
// er et rektangel i BYGGRAMMEN (følger bygget når det flyttes og roteres):
// terrenget innenfor senkes, og en flat plate legges i gulvhøyde.
//   pad = { paa, x0, x1, z0, z1 }  (meter i byggrammen)

export const PAD_MARG_M = 2;      // standard: 2 m rundt bygget
export const MIN_PAD_M = 2;

export function padStandard(fp, marg) {
  const m = marg == null ? PAD_MARG_M : marg;
  return { paa: true, x0: fp.x0 - m, x1: fp.x1 + m, z0: fp.z0 - m, z1: fp.z1 + m };
}

export function padMeter(pad) {
  return { bredde: pad.x1 - pad.x0, lengde: pad.z1 - pad.z0 };
}

// Samme kanter som beskjæringen: NORD = z0 (−Z), SØR = z1, VEST = x0, ØST = x1.
// Rundes til 10 cm — ingen trenger millimeter på en utgravingsplate.
export function flyttPadKant(pad, kant, bx, bz) {
  const p = Object.assign({}, pad), r = (v) => Math.round(v * 10) / 10;
  if (kant.includes("v")) p.x0 = Math.min(r(bx), p.x1 - MIN_PAD_M);
  if (kant.includes("o")) p.x1 = Math.max(r(bx), p.x0 + MIN_PAD_M);
  if (kant.includes("n")) p.z0 = Math.min(r(bz), p.z1 - MIN_PAD_M);
  if (kant.includes("s")) p.z1 = Math.max(r(bz), p.z0 + MIN_PAD_M);
  return p;
}

export function padHandtak(p) {
  const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
  return [
    { kant: "nv", bx: p.x0, bz: p.z0 }, { kant: "n", bx: mx, bz: p.z0 }, { kant: "no", bx: p.x1, bz: p.z0 },
    { kant: "o", bx: p.x1, bz: mz }, { kant: "so", bx: p.x1, bz: p.z1 }, { kant: "s", bx: mx, bz: p.z1 },
    { kant: "sv", bx: p.x0, bz: p.z1 }, { kant: "v", bx: p.x0, bz: mz }
  ];
}

export function likePad(a, b) {
  return !!a && !!b && a.paa === b.paa && a.x0 === b.x0 && a.x1 === b.x1 && a.z0 === b.z0 && a.z1 === b.z1;
}

// Hvilke punkter i gridet ligger under plata?
export function padFlagg(grid, E0, N0, plass, pad) {
  const f = new Uint8Array(grid.w * grid.h);
  if (!pad || !pad.paa) return f;
  const t = (plass.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  for (let j = 0; j < grid.h; j++) {
    const N = grid.y0 - (j + 0.5) * grid.dy;
    const lz = -(N - N0 - (plass.pN || 0));
    for (let i = 0; i < grid.w; i++) {
      const lx = grid.x0 + (i + 0.5) * grid.dx - E0 - (plass.pE || 0);
      const bx = lx * c + lz * s, bz = -lx * s + lz * c;
      if (bx >= pad.x0 && bx <= pad.x1 && bz >= pad.z0 && bz <= pad.z1) f[j * grid.w + i] = 1;
    }
  }
  return f;
}

// ═══════════════════════ GULVKOTE (trinn 6) ═══════════════════════
//
// Tegningene sier «±0 = kote +75,30». Modellen er nesten alltid tegnet med
// gulvet i ±0, og da ER gulvkoten det tallet som skal legges til modellens
// egne koter for å få moh. Ligger ±0 ikke innenfor modellen i det hele tatt
// (modellen er flyttet, eller står allerede i moh.), regnes modellens laveste
// punkt som gulv — da er det i det minste ingenting som havner under bakken
// uten at brukeren ser det.
//   minK, maxK — modellens laveste og høyeste kote i METER (egne koter)
// Svar: { mg, relativ } — modellkoten for gulvet, og om ±0 ble brukt.
export function gulvReferanse(minK, maxK) {
  if (Number.isFinite(minK) && Number.isFinite(maxK) && minK - 0.5 <= 0 && 0 <= maxK) return { mg: 0, relativ: true };
  return { mg: Number.isFinite(minK) ? minK : 0, relativ: false };
}

// Gulvkoten slik brukeren skriver den: «75,30», «75.3», «+75,30 moh».
export function tolkKote(tekst) {
  const m = String(tekst == null ? "" : tekst).replace(/\s/g, "").replace(",", ".").match(/^[+]?(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > MIN_HOYDE && v < MAKS_HOYDE ? v : null;
}

// ═══════════════════════ KART PÅ TERRENGET ═══════════════════════
//
// FLYFOTO ER IKKE MULIG UTEN AVTALE. Norge i bilder-tjenestene er forbeholdt
// partene i Norge digitalt (GeoID-innlogging); de åpne tjenestene ble lagt
// ned. Prøvd 25.09.2026: wms.nib svarer «Bruker kan ikke autentiseres».
// Google/Esri-flyfoto er ikke lov å lagre eller lage avledede produkter av
// (spesifikasjonen punkt 2).
//
// Det som ER åpent: Kartverkets topografiske kart (CC BY 4.0, «© Kartverket»).
// Det har elver, vann, veier, bygninger og høydekurver — og tjenesten leverer
// rett i UTM33, så bildet dekker nøyaktig samme firkant som høydegridet.
export const TOPO_URL = "https://wms.geonorge.no/skwms1/wms.topo";

// Bildets størrelse: ~4 piksler per meter på små tomter, taket 2048 (1 m per
// piksel på 2 km). Mindre enn 512 blir grøtete når man zoomer inn.
export function kartPx(side) {
  return Math.max(512, Math.min(2048, Math.round(side * 4)));
}

export function topoUrl(bbox) {
  const px = kartPx(bbox.side);
  return TOPO_URL + "?service=WMS&version=1.3.0&request=GetMap&layers=topo&styles=" +
    "&crs=EPSG:25833&bbox=" + [bbox.minE, bbox.minN, bbox.maxE, bbox.maxN].join(",") +
    "&width=" + px + "&height=" + px + "&format=image/png";
}

// Teksturkoordinater: punktet (i, j) sitt sted i bildet. u går fra vest (0)
// til øst (1), v fra SØR (0) til NORD (1) — three.js snur bildet (flipY), så
// bildets øverste rad (nord) havner på v = 1.
export function kartUv(grid) {
  const uv = new Float32Array(grid.w * grid.h * 2);
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const k = j * grid.w + i;
      uv[k * 2] = (i + 0.5) / grid.w;
      uv[k * 2 + 1] = 1 - (j + 0.5) / grid.h;
    }
  }
  return uv;
}

// ═══════════════════════ NORDPIL ═══════════════════════
// Nord i scenen, gitt byggets rotasjon: terrengets −Z dreid med rot (landGroup
// roteres +rot rundt Y). Svar som { x, z } (enhetsvektor i verden).
export function nordRetning(rot) {
  const t = (Number(rot) || 0) * Math.PI / 180;
  return { x: -Math.sin(t), z: -Math.cos(t) };
}

// ═══════════════════════ LAGRING (trinn 7) ═══════════════════════
//
// Tre ting lagres i SharePoint, i mappa IFC-modeller/Terreng:
//   terreng.json               — katalogen over tomter (delt mellom alle modeller)
//   <id>.bin                   — høydegridet, rå Float32 (skrives ÉN gang, endres aldri)
//   <modellfil>.plassering.json — hvor DENNE modellen står på terrenget
// Plasseringen ligger på modellen, ikke på terrenget (spesifikasjonen punkt 4):
// ARK, RIB og nye revisjoner kan peke på samme terreng og lande likt.
//
// Alt som kommer tilbake fra SharePoint vaskes her. En fil kan inneholde hva
// som helst, og en plassering med NaN i gulvkoten ville sendt terrenget ut av
// synsfeltet uten et eneste feilsymptom.

const tall = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : null;
const tekst = (v, n) => String(v == null ? "" : v).slice(0, n || 80).trim();

export function nyTerrengId() {
  return "T-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function vaskTerrengPost(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id) return null;
  const id = p.id.slice(0, 40), navn = tekst(p.navn, 80), endret = tekst(p.endret, 40);
  if (!navn) return null;
  if (p.slettet === true) return { id, navn, slettet: true, endret };
  const b = p.bbox || {};
  const bbox = { minE: tall(b.minE), minN: tall(b.minN), maxE: tall(b.maxE), maxN: tall(b.maxN), side: tall(b.side) };
  if (Object.values(bbox).some(v => v == null) || !(bbox.side > 0)) return null;
  const w = tall(p.w), h = tall(p.h), dx = tall(p.dx), dy = tall(p.dy), x0 = tall(p.x0), y0 = tall(p.y0);
  if (!(w >= 2 && w <= 4000 && h >= 2 && h <= 4000 && Number.isInteger(w) && Number.isInteger(h))) return null;
  if (!(dx > 0 && dy > 0) || x0 == null || y0 == null) return null;
  const E0 = tall(p.E0), N0 = tall(p.N0);
  if (E0 == null || N0 == null) return null;
  const a = p.adresse || {};
  const adresse = { tekst: tekst(a.tekst, 120) || navn, postnummer: tekst(a.postnummer, 8), poststed: tekst(a.poststed, 60),
    kommune: tekst(a.kommune, 60), E: tall(a.E) != null ? a.E : E0, N: tall(a.N) != null ? a.N : N0 };
  return {
    id, navn, bbox, w, h, dx, dy, x0, y0, E0, N0, adresse,
    nodata: tall(p.nodata),
    kilde: tekst(p.kilde, 120), laserdato: p.laserdato == null ? null : tekst(p.laserdato, 20),
    av: tekst(p.av, 60), opprettet: tekst(p.opprettet, 40), endret
  };
}

export function vaskTerrengListe(liste) {
  return (Array.isArray(liste) ? liste : []).map(vaskTerrengPost).filter(Boolean);
}

export function vaskPlassering(p) {
  if (!p || typeof p !== "object" || p.id !== "plassering" || typeof p.terreng !== "string" || !p.terreng) return null;
  const pl = p.plass || {};
  const plass = { pE: tall(pl.pE) || 0, pN: tall(pl.pN) || 0, rot: normVinkel(tall(pl.rot) || 0) };
  if (Math.abs(plass.pE) > 5000 || Math.abs(plass.pN) > 5000) return null;
  const g = p.gulv || {};
  const kote = tall(g.kote);
  const gulv = (kote != null && kote > MIN_HOYDE && kote < MAKS_HOYDE) ? { kote, grov: g.grov === true } : null;
  let pad = null;
  if (p.pad && typeof p.pad === "object") {
    const q = p.pad, v = [q.x0, q.x1, q.z0, q.z1].map(tall);
    if (v.every(x => x != null) && v[1] > v[0] && v[3] > v[2] && v.every(x => Math.abs(x) < 5000))
      pad = { paa: q.paa !== false, x0: v[0], x1: v[1], z0: v[2], z1: v[3] };
  }
  let klipp = null;
  if (p.klipp && typeof p.klipp === "object") {
    const q = p.klipp, v = [q.i0, q.i1, q.j0, q.j1].map(tall);
    if (v.every(x => x != null && Number.isInteger(x) && x >= 0) && v[1] > v[0] && v[3] > v[2])
      klipp = { i0: v[0], i1: v[1], j0: v[2], j1: v[3] };
  }
  return {
    id: "plassering", terreng: p.terreng.slice(0, 40), plass, gulv, pad, klipp,
    kart: p.kart === "hoyde" ? "hoyde" : "topo",
    av: tekst(p.av, 60), endret: tekst(p.endret, 40)
  };
}

// Høydegridet som rå bytes og tilbake. Lengden sjekkes mot katalogposten:
// en avkuttet opplasting skal gi en feilmelding, ikke et terreng med et hull.
export function gridTilBin(grid) {
  return grid.data.buffer.slice(grid.data.byteOffset, grid.data.byteOffset + grid.data.byteLength);
}

export function binTilGrid(buf, post) {
  const ab = buf instanceof ArrayBuffer ? buf : (buf && buf.buffer) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null;
  if (!ab || ab.byteLength !== post.w * post.h * 4) throw new Error("gridfila har feil størrelse");
  return { w: post.w, h: post.h, data: new Float32Array(ab), x0: post.x0, y0: post.y0, dx: post.dx, dy: post.dy, nodata: post.nodata };
}
