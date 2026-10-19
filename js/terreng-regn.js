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

// Skriver brukeren to tall i stedet for en adresse, er det en koordinat. To
// slags godtas:
//
//  · UTM33 fra et kart eller en landmåler: «218262 6652579», «218262,
//    6652579» eller «Ø 218262 N 6652579». Øst ligger mellom ca. −100 000 og
//    1 100 000 i sone 33, nord mellom 6,4 og 8,0 millioner.
//  · BREDDE/LENGDE i grader, slik Google Maps gir dem når man høyreklikker:
//    «59.146733, 8.771015» (Emils funn 25.09 — det var den første koordinaten
//    han prøvde, og den ga «Fant ingen adresse»). Også med komma som desimal-
//    tegn («59,146733 8,771015») og med grader, minutter og sekunder
//    («59°08'48.2"N 8°46'15.7"E»). Gjøres om til UTM33 med tilTM lenger ned.
//    Norge ligger på bredde 57–72° og lengde −10–35°, så de to kan ikke
//    forveksles med hverandre eller med UTM.
//
// Rekkefølgen tåles begge veier — det er lett å bytte om, og tallområdene
// overlapper ikke. Svar: { E, N, grader? } eller null (da er det en adresse).
// `grader: true` betyr at koordinaten kom som bredde/lengde.
const erBredde = (v) => v >= 57 && v <= 72;
const erLengde = (v) => v >= -10 && v <= 35;

function fraGrader(lat, lon) {
  const p = tilTM(lat, lon, koordsys("25833"));
  return { E: p.E, N: p.N, grader: true };
}

// «59°08'48.2"N 8°46'15.7"E» → [59.1467…, 8.7710…]. Minutter og sekunder er
// valgfrie; S og W gir minus.
function lesGMS(s) {
  const re = /(-?\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSØOEWV])?/gi;
  const ut = [];
  let m;
  while ((m = re.exec(s))) {
    const n = (x) => Number(String(x || 0).replace(",", "."));
    let v = n(m[1]) + n(m[2]) / 60 + n(m[3]) / 3600;
    const retning = (m[4] || "").toUpperCase();
    if (retning === "S" || retning === "W" || retning === "V") v = -Math.abs(v);
    ut.push({ v, retning });
  }
  return ut;
}

export function tolkKoordinat(tekst) {
  const s = String(tekst || "").trim();
  if (!s) return null;
  // Grader, minutter, sekunder (Google Maps' andre format)
  if (s.includes("°")) {
    const g = lesGMS(s);
    if (g.length !== 2) return null;
    let lat = g[0].v, lon = g[1].v;
    // Står bokstavene der, bestemmer de hvem som er hvem
    if (/[ØOEWV]/.test(g[0].retning) || /[NS]/.test(g[1].retning)) [lat, lon] = [lon, lat];
    if (!erBredde(lat) && erBredde(lon)) [lat, lon] = [lon, lat];
    return erBredde(lat) && erLengde(lon) ? fraGrader(lat, lon) : null;
  }
  if (/[a-zæøå]{3,}/i.test(s)) return null;   // et ord på tre bokstaver = adresse
  // Komma som desimaltegn: «59,146733 8,771015» eller «59,146733; 8,771015».
  // Bare når det står nøyaktig to slike tall — ellers er kommaet et skille.
  let t = s;
  if (/^\s*-?\d+,\d+\s*[;\s]\s*-?\d+,\d+\s*$/.test(t)) t = t.replace(/(\d),(\d)/g, "$1.$2");
  const tall = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (tall.length !== 2) return null;
  const erN = (v) => v >= 6.3e6 && v <= 8.0e6;
  const erE = (v) => v >= -1.2e5 && v <= 1.2e6;
  if (erE(tall[0]) && erN(tall[1])) return { E: tall[0], N: tall[1] };
  if (erN(tall[0]) && erE(tall[1])) return { E: tall[1], N: tall[0] };
  // Bredde/lengde har desimaler — to heltall som «60 10» er ikke en koordinat
  // noen skriver med vilje.
  const harDesimaler = /\.\d/.test(t);
  if (harDesimaler && erBredde(tall[0]) && erLengde(tall[1])) return fraGrader(tall[0], tall[1]);
  if (harDesimaler && erBredde(tall[1]) && erLengde(tall[0])) return fraGrader(tall[1], tall[0]);
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
      const hv = (flat && flat.flagg[k]) ? (flat.hoyder ? flat.hoyder[k] : flat.hoyde) : v;
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

// ═══════════════════════ ✏ EGENDEFINERT PLATE (Emil 15.10) ═══════════════════════
//
// Plata kan være en fri form i stedet for en firkant: brukeren tegner den
// punkt for punkt (som pilene i Rigg) og må LUKKE formen før «Ferdig» virker.
// Etterpå legges det prikker langs kanten hver 5. meter (som skjøtene på
// byggegjerdet), og prikkene kan dras, legges til (dobbeltklikk på kanten)
// og fjernes (Delete).
//   pad = { paa, form: "egen", punkter: [{ x, z }, …], x0, x1, z0, z1 }
// Punktene er meter i BYGGRAMMEN, som firkanten. x0…z1 er rammen rundt
// punktene (bbox) — den brukes av alt som bare trenger størrelsen (tallet i
// panelet, Excel, rotasjonshåndtaket), og gjør at gamle filer og gammel kode
// som bare kjenner firkanten fortsatt får noe fornuftig.
// En plate UTEN `form` er en firkant — alle gamle lagrede plasseringer.
export const PAD_PRIKK_M = 5;          // prikk langs kanten hver 5. meter
export const PAD_MAKS_PUNKT = 400;
export const PAD_MIN_AREAL = 1;        // m²

// Områdene uten bufrede hjelpefelt (_r), til sammenligning og lagring
export function omrRen(l) {
  return (Array.isArray(l) ? l : []).map(o => ({ id: o.id, navn: o.navn, punkter: o.punkter, dz: o.dz, n: o.n }));
}

export function erEgenPad(pad) {
  return !!(pad && pad.form === "egen" && Array.isArray(pad.punkter) && pad.punkter.length >= 3);
}

// Omrisset som punkter, uansett form (firkanten med klokka sett ovenfra).
export function padPolygon(pad) {
  if (!pad) return [];
  if (erEgenPad(pad)) return pad.punkter.map(q => ({ x: q.x, z: q.z }));
  return [{ x: pad.x0, z: pad.z0 }, { x: pad.x1, z: pad.z0 }, { x: pad.x1, z: pad.z1 }, { x: pad.x0, z: pad.z1 }];
}

export function polyRamme(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  return { x0, x1, z0, z1 };
}

export function polyAreal(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p.x * q.z - q.x * p.z; }
  return Math.abs(a) / 2;
}

// Punkt i polygon (stråle mot +x). Punktene på kanten kan havne på begge
// sider — for en 1 m-rute betyr det ingenting.
export function iPolygon(pts, x, z) {
  let inne = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inne = !inne;
  }
  return inne;
}

// Ligger punktet (byggrammen, meter) på plata? Firkanten som før.
export function iPad(pad, bx, bz) {
  if (!pad || !pad.paa) return false;
  if (bx < pad.x0 || bx > pad.x1 || bz < pad.z0 || bz > pad.z1) return false;
  return erEgenPad(pad) ? iPolygon(pad.punkter, bx, bz) : true;
}

function kryss(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Kan formen brukes som plate? Svar: "" (ja) eller en grunn som kan vises.
//   lukket = true: siste punkt kobles til første (en ferdig form).
export function polyFeil(pts, lukket) {
  if (!Array.isArray(pts) || pts.length < 3) return "Formen trenger minst tre punkter.";
  const n = pts.length, m = lukket === false ? n - 1 : n;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < m; j++) {
      if (lukket !== false && i === 0 && j === n - 1) continue;      // naboer gjennom første punkt
      if (kryss(a, b, pts[j], pts[(j + 1) % n])) return "Kantene krysser hverandre.";
    }
  }
  if (lukket !== false && polyAreal(pts) < PAD_MIN_AREAL) return "Formen er for liten.";
  return "";
}

// Prikker langs kanten: hver side deles i ceil(L / avstand) like stykker.
// Hjørnene (punktene brukeren satte) står alltid.
export function padPrikker(pts, avstand) {
  const a = avstand || PAD_PRIKK_M, ut = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const L = Math.hypot(q.x - p.x, q.z - p.z), k = Math.max(1, Math.ceil(L / a - 1e-9));
    for (let s = 0; s < k; s++) ut.push({ x: rundCm(p.x + (q.x - p.x) * s / k), z: rundCm(p.z + (q.z - p.z) * s / k) });
    if (ut.length > PAD_MAKS_PUNKT) break;
  }
  return ut.slice(0, PAD_MAKS_PUNKT);
}

function rundCm(v) { return Math.round(v * 100) / 100; }

// Punktene fra en fil: tall, cm, ingen doble punkter etter hverandre.
export function vaskPadPunkter(arr) {
  if (!Array.isArray(arr)) return null;
  const ut = [];
  for (const q of arr.slice(0, PAD_MAKS_PUNKT)) {
    const x = tall(q && q.x), z = tall(q && q.z);
    if (x == null || z == null || Math.abs(x) >= 5000 || Math.abs(z) >= 5000) return null;
    const p = { x: rundCm(x), z: rundCm(z) }, f = ut[ut.length - 1];
    if (f && Math.abs(f.x - p.x) < 0.01 && Math.abs(f.z - p.z) < 0.01) continue;
    ut.push(p);
  }
  const a = ut[0], b = ut[ut.length - 1];
  if (ut.length > 3 && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01) ut.pop();
  return ut.length >= 3 && !polyFeil(ut) ? ut : null;
}

// Plata fra punktene (paa står på). Ugyldig form → null.
export function padFraPunkter(pts, paa) {
  const v = vaskPadPunkter(pts);
  if (!v) return null;
  return Object.assign({ paa: paa !== false, form: "egen", punkter: v }, polyRamme(v));
}

// Firkanten som en egendefinert form (hjørnene), med prikkene hver 5. meter
// — når man bytter fra Firkant til Egendefinert, starter man fra det man har.
export function padSomEgen(pad) {
  return padFraPunkter(padPrikker(padPolygon(pad)), pad ? pad.paa : true);
}

// Avstanden fra punktet til nærmeste kant, og hvilken vei kanten vender ut
// (utoverpekende normal i byggrammen). Til skråningene rundt en fri form.
export function avstandTilPoly(pts, x, z) {
  let best = Infinity, nx = 0, nz = 0;
  const med = polySum(pts) > 0 ? 1 : -1;       // omløpsretningen avgjør hvilken side som er «ut»
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2)) : 0;
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best) { best = d; const L = Math.sqrt(L2) || 1; nx = med * ez / L; nz = -med * ex / L; }
  }
  return { d: best, nx, nz };
}
function polySum(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p.x * q.z - q.x * p.z; }
  return a;
}
// ═══════════════════════ ⛰ HEVE/SENKE OMRÅDER (Emil 15.10) ═══════════════════════
//
// Et område er en lukket form PÅ plata som heves eller senkes (byggegrop,
// rampe, høyt parti) — som extrude i Blender. Områdene hører til plata og står
// i byggrammen:
//   pad.omrader = [{ id, navn, punkter: [{x, z}], dz, n }]
//     dz — meter: + heve, − senke (fra flata det står på)
//     n  — kanten: helning 1:n (1 opp, n bort), 0 = loddrett vegg
// Kanten regnes INNOVER fra omrisset: omrisset er toppen av en grop og foten
// av en haug, så området aldri blir større enn det som er tegnet.
// REGELEN (endret fra «siste vinner», se byggeplanen): et område kan ligge
// HELT INNI et annet (heissjakt i byggegropa) — da regnes høyden fra bunnen
// av det ytre. Områder kan ikke delvis overlappe, og må ligge på plata.
export const OMR_MAKS = 50;
export const OMR_MAKS_DZ = 30;
export const OMR_MAKS_N = 10;
export const OMR_STD = { dz: -1, n: 1 };

export function vaskOmrader(liste) {
  if (!Array.isArray(liste)) return [];
  const ut = [], sett = new Set();
  for (const q of liste.slice(0, OMR_MAKS)) {
    if (!q || typeof q !== "object") continue;
    const id = String(q.id == null ? "" : q.id).slice(0, 40).trim();
    if (!id || sett.has(id)) continue;
    const punkter = vaskPadPunkter(q.punkter);
    if (!punkter) continue;
    const dzT = tall(q.dz), nT = tall(q.n);
    const dz = dzT == null ? OMR_STD.dz : Math.round(Math.max(-OMR_MAKS_DZ, Math.min(OMR_MAKS_DZ, dzT)) * 100) / 100;
    const n = nT == null || nT < 0 ? OMR_STD.n : Math.round(Math.min(OMR_MAKS_N, nT) * 100) / 100;
    sett.add(id);
    ut.push({ id, navn: String(q.navn == null ? "" : q.navn).slice(0, 60).trim(), punkter, dz, n });
  }
  return ut;
}

// Omrisset flyttet innover med w meter (bunnen av en grop med skrå kant).
// Hjørnene flyttes langs halveringslinja (gjæring). Svarer null når formen
// ikke tåler det — da er gropa for smal til å få flat bunn.
export function polyInnover(pts, w) {
  if (!(w > 1e-6)) return pts.map(q => ({ x: q.x, z: q.z }));
  const n = pts.length, sg = polySum(pts) > 0 ? 1 : -1;
  // innovernormal for kant i (fra i til i+1)
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
    nrm.push({ x: -sg * ez / L, z: sg * ex / L });
  }
  const ut = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], n1 = nrm[(i - 1 + n) % n], n2 = nrm[i];
    const sx = n1.x + n2.x, sz = n1.z + n2.z, dot = n1.x * n2.x + n1.z * n2.z;
    const k = 1 + dot;
    if (k < 1e-3) return null;                         // kanten snur 180°
    ut.push({ x: p.x + w * sx / k, z: p.z + w * sz / k });
  }
  if (polyFeil(ut)) return null;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = ut[i], d = ut[(i + 1) % n];
    if ((b.x - a.x) * (d.x - c.x) + (b.z - a.z) * (d.z - c.z) <= 0) return null;   // en kant har snudd
    if (!iPolygon(pts, c.x, c.z)) return null;
  }
  return ut;
}

// Hvor mye området hever/senker i punktet (relativt til flata det står på).
export function omradeProfil(o, bx, bz) {
  const r = o._r || (o._r = polyRamme(o.punkter));
  if (bx < r.x0 || bx > r.x1 || bz < r.z0 || bz > r.z1 || !iPolygon(o.punkter, bx, bz)) return 0;
  if (!(o.n > 0)) return o.dz;
  const d = avstandTilPoly(o.punkter, bx, bz).d;
  return Math.sign(o.dz) * Math.min(Math.abs(o.dz), d / o.n);
}

// Ligger formen a helt inni formen b? (alle punkter inni, ingen kanter krysser)
export function polyInni(a, b) {
  if (!a.every(q => iPolygon(b, q.x, q.z))) return false;
  return !polyKrysser(a, b);
}
function polyKrysser(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++)
    if (kryss(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}
function polyUtenfor(a, b) {
  return !polyKrysser(a, b) && !a.some(q => iPolygon(b, q.x, q.z)) && !b.some(q => iPolygon(a, q.x, q.z));
}

// Status for hvert område på plata: gyldig, og hvem det ligger inni.
//   → [{ gyldig, grunn, forelder (indeks | −1), base (meter fra plata), bunn }]
//     bunn = flat bunn (omrisset flyttet innover), null når gropa er for smal
// Et ugyldig område regnes ikke med i massene og tegnes ikke, men står i
// lista med grunnen, så det kan rettes (f.eks. når plata er gjort mindre).
export function omradeStatus(pad, liste) {
  const L = Array.isArray(liste) ? liste : [];
  const plate = padPolygon(pad);
  const st = L.map(o => ({ gyldig: true, grunn: "", forelder: -1, base: 0,
    bunn: polyInnover(o.punkter, o.n > 0 ? Math.abs(o.dz) * o.n : 0) }));
  L.forEach((o, i) => {
    if (!pad || !pad.punkter && pad.x0 == null) { st[i].gyldig = false; st[i].grunn = "Ingen plate."; return; }
    if (!polyInni(o.punkter, plate)) { st[i].gyldig = false; st[i].grunn = "Området ligger utenfor plata."; }
  });
  // Delvis overlapp: det SISTE av de to blir ugyldig (det som nettopp ble
  // tegnet eller endret), ikke det som sto der fra før.
  for (let j = 0; j < L.length; j++) {
    if (!st[j].gyldig) continue;
    for (let i = 0; i < j; i++) {
      if (!st[i].gyldig) continue;
      const a = L[j].punkter, b = L[i].punkter;
      if (polyUtenfor(a, b) || polyInni(a, b) || polyInni(b, a)) continue;
      st[j].gyldig = false; st[j].grunn = "Områdene kan ikke delvis overlappe hverandre."; break;
    }
  }
  // Hvem ligger inni hvem? Forelder = det minste området det ligger inni.
  for (let i = 0; i < L.length; i++) {
    if (!st[i].gyldig) continue;
    let best = -1, bestA = Infinity;
    for (let j = 0; j < L.length; j++) {
      if (i === j || !st[j].gyldig) continue;
      if (polyInni(L[i].punkter, L[j].punkter)) {
        const ar = polyAreal(L[j].punkter);
        if (ar < bestA) { bestA = ar; best = j; }
      }
    }
    if (best >= 0) {
      const f = st[best].bunn;
      if (!f) { st[i].gyldig = false; st[i].grunn = "Det ytre området har ikke flat bunn å stå på."; continue; }
      if (!polyInni(L[i].punkter, f)) { st[i].gyldig = false; st[i].grunn = "Området må ligge på den flate bunnen, ikke i kanten."; continue; }
      st[i].forelder = best;
    }
  }
  // Base: summen av alle foreldrene (et område i et ugyldig område er ugyldig)
  for (let i = 0; i < L.length; i++) {
    if (!st[i].gyldig) continue;
    let b = 0, f = st[i].forelder, n = 0;
    while (f >= 0 && n++ < OMR_MAKS) {
      if (!st[f].gyldig) { st[i].gyldig = false; st[i].grunn = "Det ytre området er ugyldig."; break; }
      b += L[f].dz; f = st[f].forelder;
    }
    st[i].base = b;
  }
  return st;
}

// Summen av områdene i punktet (bare de gyldige). `st` fra omradeStatus.
export function omradeDz(liste, st, bx, bz) {
  let dz = 0;
  for (let i = 0; i < liste.length; i++) if (st[i].gyldig) dz += omradeProfil(liste[i], bx, bz);
  return dz;
}
export function gyldigeOmrader(pad) {
  const L = pad && Array.isArray(pad.omrader) ? pad.omrader : [];
  if (!L.length) return { liste: [], st: [] };
  return { liste: L, st: omradeStatus(pad, L) };
}

// Ligger formen (helt eller delvis) under byggets fotavtrykk?
export function polyMotRekt(pts, r) {
  const rekt = [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
  return !polyUtenfor(pts, rekt);
}

// Terrenget under plata: litt under plata som før, men under en grop senkes
// det til under bunnen — og i en ring på to ruter rundt, så trekantene mellom
// et senket og et vanlig punkt ligger skjult under plata, ikke inni gropa.
export function padHoyder(grid, E0, N0, plass, pad, gulvKote) {
  const flagg = padFlagg(grid, E0, N0, plass, pad);
  const { liste, st } = gyldigeOmrader(pad);
  if (!liste.length || !st.some(q => q.gyldig)) return { flagg, hoyder: null };
  const w = grid.w, h = grid.h, dz = new Float32Array(w * h);
  const t = (plass.rot || 0) * RAD, c = Math.cos(t), s = Math.sin(t);
  for (let j = 0; j < h; j++) {
    const N = grid.y0 - (j + 0.5) * grid.dy, lz = -(N - N0 - (plass.pN || 0));
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!flagg[k]) continue;
      const lx = grid.x0 + (i + 0.5) * grid.dx - E0 - (plass.pE || 0);
      dz[k] = Math.min(0, omradeDz(liste, st, lx * c + lz * s, -lx * s + lz * c));
    }
  }
  const hoyder = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (!flagg[k]) continue;
    let m = 0;
    for (let b = Math.max(0, j - 2); b <= Math.min(h - 1, j + 2); b++)
      for (let a = Math.max(0, i - 2); a <= Math.min(w - 1, i + 2); a++) { const q = b * w + a; if (flagg[q] && dz[q] < m) m = dz[q]; }
    hoyder[k] = gulvKote - 0.05 + m;
  }
  return { flagg, hoyder };
}

// 3D-delene til plata som rene tall (meter i byggrammen, y = høyde over
// plata). terreng.js og terreng-vis.js lager three-geometrien av dette.
//   → { hull: [punkter] (ytterste områder, hull i plata),
//       deler: [{ topp: { ytre, hull, y } , sider: [[x,y,z]×4 …], felt: null | { pos, idx } }] }
// Et område med flat bunn tegnes eksakt: bunn (med hull for områdene inni) og
// én firkant per kant fra omrisset ned/opp til bunnen. Uten flat bunn (for
// smalt for kanten) tegnes det som et lite høydefelt.
export function plateDeler(pad) {
  const { liste, st } = gyldigeOmrader(pad);
  const ut = { hull: [], deler: [] };
  liste.forEach((o, i) => {
    if (!st[i].gyldig) return;
    if (st[i].forelder < 0) ut.hull.push(o.punkter);
    const barn = liste.filter((_, k) => st[k].gyldig && st[k].forelder === i).map(b => b.punkter);
    const y0 = st[i].base, y1 = st[i].base + o.dz, bunn = st[i].bunn;
    if (bunn) {
      const sider = [];
      for (let k = 0, n = o.punkter.length; k < n; k++) {
        const a = o.punkter[k], b = o.punkter[(k + 1) % n], c = bunn[(k + 1) % n], d = bunn[k];
        sider.push([[a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z]]);
      }
      ut.deler.push({ topp: { ytre: bunn, hull: barn, y: y1 }, sider, felt: null });
    } else {
      ut.deler.push({ topp: null, sider: [], felt: hoydeFelt(o, y0) });
    }
  });
  return ut;
}
function hoydeFelt(o, y0) {
  const r = polyRamme(o.punkter), A = (r.x1 - r.x0) * (r.z1 - r.z0);
  const st = Math.max(0.1, Math.sqrt(A) / 80);
  const nx = Math.max(2, Math.ceil((r.x1 - r.x0) / st) + 1), nz = Math.max(2, Math.ceil((r.z1 - r.z0) / st) + 1);
  const pos = new Float32Array(nx * nz * 3), inne = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = Math.min(r.x1, r.x0 + i * st), z = Math.min(r.z1, r.z0 + j * st), k = j * nx + i;
    inne[k] = iPolygon(o.punkter, x, z) ? 1 : 0;
    pos[k * 3] = x; pos[k * 3 + 1] = y0 + omradeProfil(o, x, z); pos[k * 3 + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (inne[a] || inne[b] || inne[c] || inne[d]) idx.push(a, c, b, b, c, d);
  }
  return { pos, idx: Uint32Array.from(idx) };
}

// ═══════════════════════ 🎨 FARGEOMRÅDER (Emil 15.10, runde 4) ═══════════════════════
//
// Områder på plata som får en farge (grus, asfalt, gress …), som en malt flate.
// De ligger oppå det som er under — plata, bunnen av en grop, toppen av en
// haug — og påvirker IKKE massene. Kan overlappe: det siste i lista ligger øverst.
//   pad.farger = [{ id, navn, type, farge, punkter }]  (byggrammen, meter)
// Fargene er VÅRE EGNE valg for å skille flatene, ikke en standard {Source not found}.
// `id` lagres — endre aldri en id, bare etiketten.
export const FARGE_TYPER = [
  { id: "grus", label: "Grus", farge: "#b8a98a" },
  { id: "asfalt", label: "Asfalt", farge: "#4a4d52" },
  { id: "pukk", label: "Pukk", farge: "#9a9ca0" },
  { id: "gress", label: "Gress", farge: "#6aa84f" },
  { id: "vann", label: "Vann/søle", farge: "#4f8fc0" },
  { id: "egen", label: "Egen farge", farge: "#d08a2e" }
];
export const FARGE_MAKS = 50;
export function fargeType(id) { return FARGE_TYPER.find(f => f.id === id) || FARGE_TYPER[0]; }
// Fargen flata faktisk har: typens farge, eller brukerens egen
export function fargeVerdi(f) { return f && f.type === "egen" ? f.farge : fargeType(f && f.type).farge; }

export function vaskFarger(liste) {
  if (!Array.isArray(liste)) return [];
  const ut = [], sett = new Set();
  for (const q of liste.slice(0, FARGE_MAKS)) {
    if (!q || typeof q !== "object") continue;
    const id = String(q.id == null ? "" : q.id).slice(0, 40).trim();
    if (!id || sett.has(id)) continue;
    const punkter = vaskPadPunkter(q.punkter);
    if (!punkter) continue;
    const type = FARGE_TYPER.some(f => f.id === q.type) ? q.type : "grus";
    const hx = String(q.farge || "").trim();
    sett.add(id);
    ut.push({ id, navn: String(q.navn == null ? "" : q.navn).slice(0, 60).trim(), type,
      farge: /^#[0-9a-fA-F]{6}$/.test(hx) ? hx.toLowerCase() : fargeType("egen").farge, punkter });
  }
  return ut;
}
export function fargeRen(l) {
  return (Array.isArray(l) ? l : []).map(f => ({ id: f.id, navn: f.navn, type: f.type, farge: f.farge, punkter: f.punkter }));
}

// Et fargeområde må ligge på plata (det kan godt gå over kanten av en grop)
export function fargeStatus(pad, liste) {
  const plate = padPolygon(pad);
  return (Array.isArray(liste) ? liste : []).map(f => polyInni(f.punkter, plate)
    ? { gyldig: true, grunn: "" } : { gyldig: false, grunn: "Området ligger utenfor plata." });
}

// 3D for ett fargeområde, i byggrammen (y = meter over plata):
//   { flat: { ytre, y } }  når alt under er flatt (plata, eller bunnen/toppen
//                          av ett område) — tegnes eksakt
//   { felt: { pos, idx } } når det går over kanten av en grop/haug — da
//                          draperes det som et fint høydefelt
export function fargeFlate(pad, f) {
  const { liste, st } = gyldigeOmrader(pad);
  const gyl = liste.filter((_, i) => st[i].gyldig);
  const dz = (x, z) => gyl.length ? omradeDz(liste, st, x, z) : 0;
  // Krysser kanten et område (omrisset eller kanten av bunnen)? Da er det ikke flatt.
  let flat = true;
  liste.forEach((o, i) => {
    if (!flat || !st[i].gyldig) return;
    if (polyKrysser(f.punkter, o.punkter) || (st[i].bunn && polyKrysser(f.punkter, st[i].bunn))) flat = false;
  });
  const r = polyRamme(f.punkter), A = Math.max(1e-6, (r.x1 - r.x0) * (r.z1 - r.z0));
  const steg = Math.max(0.25, Math.sqrt(A) / 60);
  if (flat) {
    const y0 = dz(f.punkter[0].x, f.punkter[0].z);
    for (const q of f.punkter) if (Math.abs(dz(q.x, q.z) - y0) > 1e-6) { flat = false; break; }
    if (flat) {
      // midt inni også (en hel grop kan ligge inni fargeområdet)
      for (let x = r.x0 + steg / 2; flat && x < r.x1; x += steg)
        for (let z = r.z0 + steg / 2; z < r.z1; z += steg)
          if (iPolygon(f.punkter, x, z) && Math.abs(dz(x, z) - y0) > 1e-6) { flat = false; break; }
    }
    if (flat) return { flat: { ytre: f.punkter, y: y0 }, felt: null };
  }
  const nx = Math.max(2, Math.ceil((r.x1 - r.x0) / steg) + 1), nz = Math.max(2, Math.ceil((r.z1 - r.z0) / steg) + 1);
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = Math.min(r.x1, r.x0 + i * steg), z = Math.min(r.z1, r.z0 + j * steg), k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = dz(x, z); pos[k * 3 + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cx = r.x0 + (i + 0.5) * steg, cz = r.z0 + (j + 0.5) * steg;
    if (!iPolygon(f.punkter, Math.min(cx, r.x1), Math.min(cz, r.z1))) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { flat: null, felt: { pos, idx: Uint32Array.from(idx) } };
}

// Areal per type (og navn) til Mengder og tegnforklaringen på riggplanen.
// `tr` oversetter. Bare gyldige områder, i den rekkefølgen de første står.
export function fargeOppsummering(pad, tr) {
  const lab = tr || ((x) => x);
  const L = pad && Array.isArray(pad.farger) ? pad.farger : [];
  const st = fargeStatus(pad, L), m = new Map();
  L.forEach((f, i) => {
    if (!st[i].gyldig) return;
    const farge = fargeVerdi(f), typeNavn = lab(fargeType(f.type).label);
    const navn = f.navn || typeNavn;
    const nokkel = navn + "|" + farge;
    if (!m.has(nokkel)) m.set(nokkel, { navn, typeNavn, farge, antall: 0, areal: 0 });
    const g = m.get(nokkel); g.antall++; g.areal += polyAreal(f.punkter);
  });
  return [...m.values()];
}

// 📊 Mengder: én rad per fargeområde, med arealet — under «Rigg», som
// lagrings- og parkeringsområdene. Syntetiske id-er som aldri kolliderer.
export function fargeMengdeRader(pad, tr) {
  const lab = tr || ((x) => x);
  const L = pad && pad.paa && Array.isArray(pad.farger) ? pad.farger : [];
  const st = fargeStatus(pad, L), ut = [];
  L.forEach((f, i) => {
    if (!st[i].gyldig) return;
    const typeNavn = lab(fargeType(f.type).label), navn = f.navn || typeNavn, A = polyAreal(f.punkter), r = polyRamme(f.punkter);
    const del = lab("Fargeområde") + ": " + typeNavn;
    ut.push({
      id: -(3000000 + i + 1), key: navn + " · " + del, name: navn, objType: del,
      type: "Rigg", material: del,
      L: r.x1 - r.x0, B: r.z1 - r.z0, H: 0, len: Math.max(r.x1 - r.x0, r.z1 - r.z0),
      vol: 0, area: A, flate: A, forskaling: 0,
      kg: 0, kgGeo: 0, kjentVekt: false, umuligVolum: false,
      vektKilde: "", profil: "", nomKgPerM: 0, avvik: null
    });
  });
  return ut;
}

// Normalen → siden av byggrammen den vender mest mot (skråning per side).
export function sideFraNormal(nx, nz) {
  return Math.abs(nx) >= Math.abs(nz) ? (nx < 0 ? "x0" : "x1") : (nz < 0 ? "z0" : "z1");
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
  if (!a || !b || a.paa !== b.paa || erEgenPad(a) !== erEgenPad(b)) return false;
  if (JSON.stringify(omrRen(a.omrader)) !== JSON.stringify(omrRen(b.omrader))) return false;
  if (JSON.stringify(fargeRen(a.farger)) !== JSON.stringify(fargeRen(b.farger))) return false;
  if (erEgenPad(a)) return a.punkter.length === b.punkter.length && a.punkter.every((q, i) => q.x === b.punkter[i].x && q.z === b.punkter[i].z);
  return a.x0 === b.x0 && a.x1 === b.x1 && a.z0 === b.z0 && a.z1 === b.z1;
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
      if (iPad(pad, bx, bz)) f[j * grid.w + i] = 1;
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
    // ✏ egendefinert form: en ugyldig form blir firkanten rundt den (rammen
    // står i fila), ikke borte
    if (q.form === "egen") {
      const eg = padFraPunkter(q.punkter, q.paa !== false);
      if (eg) pad = eg;
    }
    // ⛰ heve/senke-områdene følger plata
    if (pad && Array.isArray(q.omrader) && q.omrader.length) pad.omrader = vaskOmrader(q.omrader);
    // 🎨 fargeområdene også
    if (pad && Array.isArray(q.farger) && q.farger.length) pad.farger = vaskFarger(q.farger);
  }
  let klipp = null;
  if (p.klipp && typeof p.klipp === "object") {
    const q = p.klipp, v = [q.i0, q.i1, q.j0, q.j1].map(tall);
    if (v.every(x => x != null && Number.isInteger(x) && x >= 0) && v[1] > v[0] && v[3] > v[2])
      klipp = { i0: v[0], i1: v[1], j0: v[2], j1: v[3] };
  }
  return {
    id: "plassering", terreng: p.terreng.slice(0, 40), plass, gulv, pad, klipp,
    planum: vaskPlanum(p.planum),
    skraning: vaskSkraning(p.skraning),
    fest: vaskFest(p.fest),
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

// ═══════════════════════ MASSER: SKJÆRING OG FYLLING ═══════════════════════
//
// Hvor mye som må graves bort og fylles inn under plata, ned/opp til PLANUM.
// Planum er IKKE gulvkoten: under gulvet ligger betong, isolasjon og pukk.
// Standard er gulvkote − 0,50 m oppbygging, men planumkoten kan også skrives
// direkte (Emil 25.09: «1 + 3, så man kan sette det manuelt også»).
//
// Regnestykket: hvert punkt i gridet som ligger under plata står for én rute
// (dx × dy m²). Ligger terrenget over planum, er differansen skjæring; under,
// fylling. Med 1 m-grid er det 1 m² per punkt — på en tomt er det godt nok,
// og det er langt bedre enn feilen i selve plasseringen (±1–2 m).
//
// Skråningene utenfor plata regnes i masseFelt (se SKRÅNINGER lenger ned).

export const STANDARD_OPPBYGGING = 0.5;

export function vaskPlanum(p) {
  const q = p && typeof p === "object" ? p : {};
  const opp = typeof q.oppbygging === "number" && Number.isFinite(q.oppbygging) && q.oppbygging >= 0 && q.oppbygging <= 5 ? q.oppbygging : STANDARD_OPPBYGGING;
  const kote = typeof q.kote === "number" && Number.isFinite(q.kote) && q.kote > MIN_HOYDE && q.kote < MAKS_HOYDE ? q.kote : null;
  return { modus: q.modus === "kote" && kote != null ? "kote" : "oppbygging", oppbygging: opp, kote };
}

export function planumKote(gulv, planum) {
  const p = vaskPlanum(planum);
  if (p.modus === "kote") return p.kote;
  return gulv && Number.isFinite(gulv.kote) ? gulv.kote - p.oppbygging : null;
}

export function masser(grid, flagg, planum) {
  const A = grid.dx * grid.dy;
  let skj = 0, fyl = 0, n = 0, uten = 0, sum = 0;
  if (planum == null || !Number.isFinite(planum)) return null;
  for (let k = 0; k < flagg.length; k++) {
    if (!flagg[k]) continue;
    const v = grid.data[k];
    if (!gyldigHoyde(v, grid.nodata)) { uten++; continue; }
    n++; sum += v;
    const d = v - planum;
    if (d > 0) skj += d * A; else fyl -= d * A;
  }
  const areal = n * A;
  return {
    skjaering: skj, fylling: fyl, netto: skj - fyl, areal,
    snitt: n ? sum / n : null,     // terrengets middelhøyde under plata
    per10cm: areal * 0.1,          // hva 10 cm feil i planum utgjør
    utenHoyde: uten
  };
}

// Farger for «Vis skjæring/fylling»: punkt under plata blir rødt (skjæring)
// eller blått (fylling), sterkere jo dypere; resten beholder grunnfargen.
// 2 m forskjell = full farge.
export function masseFarger(grid, flagg, planum, grunn) {
  const ut = Float32Array.from(grunn);
  for (let k = 0; k < flagg.length; k++) {
    if (!flagg[k]) continue;
    const v = grid.data[k];
    if (!gyldigHoyde(v, grid.nodata)) continue;
    const d = v - planum, s = Math.min(1, Math.abs(d) / 2);
    const c = d > 0 ? [0.90, 0.25, 0.22] : [0.22, 0.45, 0.90];
    const f = 0.35 + 0.65 * s;                   // blek ved liten forskjell, sterk ved stor
    for (let i = 0; i < 3; i++) ut[k * 3 + i] = 0.95 * (1 - f) + c[i] * f;
  }
  return ut;
}

// ═══════════════════════ KOORDINATSYSTEMER (fest hjørne) ═══════════════════════
//
// Landmåleren leverer ikke alltid UTM33. Sør-Norge stikkes ofte ut i UTM32
// (Geithus ligger i sone 32), og mange kommuner bruker NTM (én sone per
// lengdegrad). Høydedataene står i UTM33, så koordinaten gjøres om hit.
//
// Alle er EUREF89 (ETRS89, GRS80-ellipsoiden) og transversal Mercator —
// forskjellen er bare midtmeridian, målestokk og falsk øst/nord. Regnet med
// Krügers rekker (3 ledd), som gir millimeter innenfor en sone. Kontrollert
// mot Kartverkets adresse-API 25.09.2026: Industriveien 20 i UTM32, UTM33 og
// NTM10 (se test-terreng.mjs).
const GRS80_A = 6378137, GRS80_F = 1 / 298.257222101;
const TMN = GRS80_F / (2 - GRS80_F);
const TMA = GRS80_A / (1 + TMN) * (1 + TMN * TMN / 4 + Math.pow(TMN, 4) / 64);
const ALFA = [TMN / 2 - 2 * TMN * TMN / 3 + 5 * Math.pow(TMN, 3) / 16, 13 * TMN * TMN / 48 - 3 * Math.pow(TMN, 3) / 5, 61 * Math.pow(TMN, 3) / 240];
const BETA = [TMN / 2 - 2 * TMN * TMN / 3 + 37 * Math.pow(TMN, 3) / 96, TMN * TMN / 48 + Math.pow(TMN, 3) / 15, 17 * Math.pow(TMN, 3) / 480];
const DELTA = [2 * TMN - 2 * TMN * TMN / 3 - 2 * Math.pow(TMN, 3), 7 * TMN * TMN / 3 - 8 * Math.pow(TMN, 3) / 5, 56 * Math.pow(TMN, 3) / 15];
const RAD = Math.PI / 180;

// Systemene i nedtrekkslista. NTM: k0 = 1, falsk øst 100 000, falsk nord
// 1 000 000, breddegrad-origo 58°, midtmeridian = sone + 0,5°.
export const KOORDSYS = [
  { id: "25833", navn: "EUREF89 UTM33", cm: 15, k0: 0.9996, fe: 500000, fn: 0, lat0: 0 },
  { id: "25832", navn: "EUREF89 UTM32", cm: 9, k0: 0.9996, fe: 500000, fn: 0, lat0: 0 },
  { id: "25835", navn: "EUREF89 UTM35", cm: 27, k0: 0.9996, fe: 500000, fn: 0, lat0: 0 },
  ...Array.from({ length: 26 }, (_, i) => {
    const z = 5 + i;
    return { id: String(5100 + z), navn: "EUREF89 NTM" + z, cm: z + 0.5, k0: 1, fe: 100000, fn: 1000000, lat0: 58 };
  })
];
export function koordsys(id) { return KOORDSYS.find(k => k.id === String(id)) || KOORDSYS[0]; }

function tmXiEta(lat, lon, cm) {
  const phi = lat * RAD, dl = (lon - cm) * RAD;
  const k = 2 * Math.sqrt(TMN) / (1 + TMN);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - k * Math.atanh(k * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = xi, y = eta;
  for (let j = 1; j <= 3; j++) {
    x += ALFA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    y += ALFA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { x, y };   // x: nord-retning, y: øst-retning (normalisert med A)
}

export function tilTM(lat, lon, sys) {
  const s = typeof sys === "object" ? sys : koordsys(sys);
  const p = tmXiEta(lat, lon, s.cm), o = tmXiEta(s.lat0, s.cm, s.cm);
  return { E: s.fe + s.k0 * TMA * p.y, N: s.fn + s.k0 * TMA * (p.x - o.x) };
}

export function fraTM(E, N, sys) {
  const s = typeof sys === "object" ? sys : koordsys(sys);
  const o = tmXiEta(s.lat0, s.cm, s.cm);
  const xi = (N - s.fn) / (s.k0 * TMA) + o.x, eta = (E - s.fe) / (s.k0 * TMA);
  let x = xi, y = eta;
  for (let j = 1; j <= 3; j++) {
    x -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    y -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(x) / Math.cosh(y));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  return { lat: phi / RAD, lon: s.cm + Math.atan2(Math.sinh(y), Math.cos(x)) / RAD };
}

// Fra et hvilket som helst system i lista til UTM33 (høydedataenes system).
export function tilUtm33(E, N, sysId) {
  const s = koordsys(sysId);
  if (s.id === "25833") return { E, N };
  const g = fraTM(E, N, s);
  return tilTM(g.lat, g.lon, koordsys("25833"));
}

// ═══════════════════════ FEST HJØRNE ═══════════════════════
//
// Spesifikasjonen punkt 2: «Klikk et hjørne, skriv inn ekte koordinat fra
// landmåler, bygget låses.» Uten dette er plasseringen ±1–2 m — med det er den
// så god som landmålerens tall.
//   Ett punkt:  flytter bygget så punktet treffer koordinaten; rotasjonen står.
//   To punkt:   gir også rotasjonen, og avstanden mellom dem er en kontroll:
//               avviker modellens avstand fra landmålerens, er noe feil.
// Punktene står i byggrammen (meter), koordinatene i UTM33.

export function festEttPunkt(b, E0, N0, rot, E, N) {
  const t = (rot || 0) * RAD, c = Math.cos(t), s = Math.sin(t);
  const lx = b.bx * c - b.bz * s, lz = b.bx * s + b.bz * c;
  return { pE: E - E0 - lx, pN: N - N0 + lz, rot: normVinkel(rot || 0) };
}

export function festToPunkt(b1, b2, E0, N0, t1, t2) {
  const vb = { x: b2.bx - b1.bx, z: b2.bz - b1.bz };
  const vt = { x: t2.E - t1.E, z: -(t2.N - t1.N) };
  const lb = Math.hypot(vb.x, vb.z), lt = Math.hypot(vt.x, vt.z);
  if (lb < 0.5 || lt < 0.5) return null;                     // punktene må ligge et stykke fra hverandre
  const rot = normVinkel((Math.atan2(vt.z, vt.x) - Math.atan2(vb.z, vb.x)) / RAD);
  // Plasser ut fra midtpunktet: da fordeles et lite avvik likt på begge punkt
  const bm = { bx: (b1.bx + b2.bx) / 2, bz: (b1.bz + b2.bz) / 2 };
  const plass = festEttPunkt(bm, E0, N0, rot, (t1.E + t2.E) / 2, (t1.N + t2.N) / 2);
  return { plass, avvikM: lt - lb, lengdeModell: lb, lengdeLandmaaler: lt };
}

// ═══════════════════════ SKRÅNINGER ═══════════════════════
//
// Rundt plata graves eller fylles det ikke loddrett: skjæringen får en
// skråning opp til terrenget, fyllingen en skråning ned. Skråningen starter i
// planum på platekanten og går ut til den møter terrenget («dagslys»).
// Helningen oppgis som 1:n (1 opp, n bort) — typisk 1:1,5 i skjæring og 1:2
// i fylling, men det avhenger av masser og grunnforhold.
//
// For hvert punkt utenfor plata: avstanden d til plata (i byggrammen).
//   Skjæringsflate: planum + d/nS  → terreng over den = skjæring
//   Fyllingsflate:  planum − d/nF  → terreng under den = fylling
// Mellom de to flatene ligger terrenget urørt.
export const STANDARD_SKRANING = { skjaering: 1.5, fylling: 2 };

// Sidene er platas fire kanter i BYGGRAMMEN (x0 = venstre, x1 = høyre,
// z0 = bak, z1 = foran når bygget ikke er rotert). De følger bygget når det
// roteres; himmelretningen de vender mot regnes ut med sideRetning.
export const SIDER = ["z0", "x1", "z1", "x0"];

export function vaskSkraning(s) {
  const q = s && typeof s === "object" ? s : {};
  const ok = (v, std) => (typeof v === "number" && Number.isFinite(v) && v >= 0.2 && v <= 10) ? v : std;
  const skj = ok(q.skjaering, STANDARD_SKRANING.skjaering), fyl = ok(q.fylling, STANDARD_SKRANING.fylling);
  const qs = q.sider && typeof q.sider === "object" ? q.sider : {};
  const sider = {};
  for (const k of SIDER) {
    const e = qs[k] && typeof qs[k] === "object" ? qs[k] : {};
    sider[k] = { skjaering: ok(e.skjaering, skj), fylling: ok(e.fylling, fyl) };
  }
  return { paa: q.paa !== false, skjaering: skj, fylling: fyl, perSide: q.perSide === true, sider };
}

// Himmelretningen en side av plata vender UT mot, med byggets rotasjon.
// Utoverpekende normal i byggrammen → terrengrammen (samme regning som
// byggTilTerreng) → vinkel fra nord med klokka.
const RETNINGER = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];
export function sideRetning(side, rot) {
  const n = { x0: [-1, 0], x1: [1, 0], z0: [0, -1], z1: [0, 1] }[side] || [0, -1];
  const t = (rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const lx = n[0] * c - n[1] * s, lz = n[0] * s + n[1] * c;
  const g = (Math.atan2(lx, -lz) * 180 / Math.PI + 360) % 360;
  return RETNINGER[Math.round(g / 45) % 8];
}

function avstandTilRekt(bx, bz, r) {
  const dx = Math.max(r.x0 - bx, 0, bx - r.x1), dz = Math.max(r.z0 - bz, 0, bz - r.z1);
  return Math.hypot(dx, dz);
}

// Hele massefeltet: volumer delt på plate og skråning, og dz per punkt
// (terreng minus prosjektert flate: + graves, − fylles, 0 urørt, NaN utenfor).
export function masseFelt(grid, E0, N0, plass, pad, planum, skraning) {
  if (!pad || !pad.paa || planum == null || !Number.isFinite(planum)) return null;
  const sk = vaskSkraning(skraning);
  const A = grid.dx * grid.dy, n = grid.w * grid.h;
  const dz = new Float32Array(n).fill(NaN);
  const flagg = new Uint8Array(n);
  const t = (plass.rot || 0) * RAD, c = Math.cos(t), s = Math.sin(t);
  const r = { skjP: 0, fylP: 0, skjS: 0, fylS: 0, arealP: 0, arealS: 0, sum: 0, nP: 0, uten: 0, kant: false };
  // ✏ Egendefinert form: avstanden måles til nærmeste kant av formen. For å
  // slippe å måle mot hver kant for hvert punkt i gridet: lenger ut enn
  // skråningen kan nå (høydeforskjellen × helningen) er terrenget urørt.
  const egen = erEgenPad(pad), poly = egen ? pad.punkter : null;
  // ⛰ heve/senke-områdene: planum flyttes like mye som plata i området
  const om = gyldigeOmrader(pad), harOmr = om.st.some(q => q.gyldig);
  r.senket = 0; r.hevet = 0;
  let rekk = Infinity;
  if (egen) {
    let lo = Infinity, hi = -Infinity;
    for (let q = 0; q < n; q++) { const v = grid.data[q]; if (gyldigHoyde(v, grid.nodata)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const maksN = Math.max(sk.skjaering, sk.fylling, ...SIDER.map(k => Math.max(sk.sider[k].skjaering, sk.sider[k].fylling)));
    rekk = Math.max(hi - planum, planum - lo, 0) * maksN + 1;
  }
  const perSide = {};
  for (const k of SIDER) perSide[k] = { skjaering: 0, fylling: 0, areal: 0 };
  for (let j = 0; j < grid.h; j++) {
    const N = grid.y0 - (j + 0.5) * grid.dy, lz = -(N - N0 - (plass.pN || 0));
    for (let i = 0; i < grid.w; i++) {
      const k = j * grid.w + i, v = grid.data[k];
      const lx = grid.x0 + (i + 0.5) * grid.dx - E0 - (plass.pE || 0);
      const bx = lx * c + lz * s, bz = -lx * s + lz * c;
      const inne = egen ? iPad(pad, bx, bz) : bx >= pad.x0 && bx <= pad.x1 && bz >= pad.z0 && bz <= pad.z1;
      if (inne) flagg[k] = 1;
      if (!gyldigHoyde(v, grid.nodata)) { if (inne) r.uten++; continue; }
      if (inne) {
        const oz = harOmr ? omradeDz(om.liste, om.st, bx, bz) : 0;
        if (oz < 0) r.senket -= oz * A; else r.hevet += oz * A;
        const d = v - (planum + oz);
        dz[k] = d; r.nP++; r.sum += v; r.arealP += A;
        if (d > 0) r.skjP += d * A; else r.fylP -= d * A;
        continue;
      }
      if (!sk.paa) continue;
      if (egen) {
        // ✏ fri form: én side per punkt (den kanten er nærmest vender mot),
        // ingen blanding rundt hjørnene
        if (avstandTilRekt(bx, bz, pad) > rekk) { dz[k] = 0; continue; }
        const a = avstandTilPoly(poly, bx, bz), side = sideFraNormal(a.nx, a.nz);
        const h = sk.perSide ? sk.sider[side] : sk;
        const opp = planum + a.d / h.skjaering, ned = planum - a.d / h.fylling;
        let dd = 0;
        if (v > opp) { dd = v - opp; r.skjS += dd * A; perSide[side].skjaering += dd * A; }
        else if (v < ned) { dd = v - ned; r.fylS -= dd * A; perSide[side].fylling -= dd * A; }
        if (dd !== 0) {
          dz[k] = dd; r.arealS += A; perSide[side].areal += A;
          if (i === 0 || j === 0 || i === grid.w - 1 || j === grid.h - 1) r.kant = true;
        } else dz[k] = 0;
        continue;
      }
      // Avstanden ut fra plata, og hvilken side punktet hører til. Ved
      // hjørnene blandes helningen til de to sidene etter vinkelen, så
      // skråningsflata henger sammen rundt hjørnet uten et sprang.
      const ax0 = pad.x0 - bx, ax1 = bx - pad.x1, az0 = pad.z0 - bz, az1 = bz - pad.z1;
      const ax = Math.max(ax0, 0, ax1), az = Math.max(az0, 0, az1);
      const d = Math.hypot(ax, az);
      const sx = ax0 > 0 ? "x0" : "x1", sz = az0 > 0 ? "z0" : "z1";
      const side = ax >= az ? sx : sz;
      let nS = sk.skjaering, nF = sk.fylling;
      if (sk.perSide) {
        const w = az === 0 ? 0 : ax === 0 ? 1 : Math.atan2(az, ax) / (Math.PI / 2);
        const hx = sk.sider[sx], hz = sk.sider[sz];
        nS = hx.skjaering * (1 - w) + hz.skjaering * w;
        nF = hx.fylling * (1 - w) + hz.fylling * w;
      }
      const opp = planum + d / nS, ned = planum - d / nF;
      let dd = 0;
      // Punkt nøyaktig på diagonalen ut fra hjørnet deles likt på de to sidene
      const del = ax === az && ax > 0 ? [[sx, 0.5], [sz, 0.5]] : [[side, 1]];
      if (v > opp) { dd = v - opp; r.skjS += dd * A; for (const [q, w] of del) perSide[q].skjaering += dd * A * w; }
      else if (v < ned) { dd = v - ned; r.fylS -= dd * A; for (const [q, w] of del) perSide[q].fylling -= dd * A * w; }
      if (dd !== 0) {
        dz[k] = dd; r.arealS += A; for (const [q, w] of del) perSide[q].areal += A * w;
        if (i === 0 || j === 0 || i === grid.w - 1 || j === grid.h - 1) r.kant = true;
      } else dz[k] = 0;
    }
  }
  const skj = r.skjP + r.skjS, fyl = r.fylP + r.fylS;
  return {
    skjaering: skj, fylling: fyl, netto: skj - fyl,
    skjaeringPlate: r.skjP, fyllingPlate: r.fylP, skjaeringSkraning: r.skjS, fyllingSkraning: r.fylS,
    areal: r.arealP, arealSkraning: r.arealS, snitt: r.nP ? r.sum / r.nP : null,
    per10cm: r.arealP * 0.1, utenHoyde: r.uten,
    skraningUtAvUtsnitt: r.kant,        // skråningen treffer kanten av det hentede terrenget
    perSide,                            // skråningsmassene fordelt på platas fire sider
    omrSenket: r.senket, omrHevet: r.hevet,   // ⛰ volumet av gropene og haugene (er med i «under plata»)
    dz, flagg
  };
}

// Farger fra dz: rødt der det graves, blått der det fylles (full farge ved 2 m).
export function dzFarger(dz, grunn) {
  const ut = Float32Array.from(grunn);
  for (let k = 0; k < dz.length; k++) {
    const d = dz[k];
    if (!(d > 0.01 || d < -0.01)) continue;
    const s = Math.min(1, Math.abs(d) / 2), f = 0.35 + 0.65 * s;
    const c = d > 0 ? [0.90, 0.25, 0.22] : [0.22, 0.45, 0.90];
    for (let i = 0; i < 3; i++) ut[k * 3 + i] = 0.95 * (1 - f) + c[i] * f;
  }
  return ut;
}

// Terrenget ETTER graving og fylling, til visning: terreng minus dz. Under
// plata blir det planum, i skråningene skråningsflata, resten urørt.
export function ferdigGrid(grid, dz) {
  const data = Float32Array.from(grid.data);
  for (let k = 0; k < data.length; k++) { const d = dz[k]; if (d === d && d !== 0) data[k] -= d; }
  return Object.assign({}, grid, { data });
}

// ═══════════════════════ FEST: KONTROLL OG LAGRING ═══════════════════════
//
// En koordinat fra landmåleren kan være skrevet i feil felt (nord og øst
// byttet — i norsk oppmåling er x = NORD og y = ØST, motsatt av matematikken),
// eller i et annet koordinatsystem enn valgt. Begge deler flytter bygget
// hundrevis av meter eller kilometer. Punktet må ligge innenfor det hentede
// terrenget; ellers avvises det, med et hint om hva som trolig er feil.
//   → { ok, avstand (m fra adressepunktet), byttet (true hvis N/Ø byttet om ville passet) }
export function festSjekk(E, N, sysId, E0, N0, halv) {
  const u = tilUtm33(E, N, sysId);
  const avstand = Math.hypot(u.E - E0, u.N - N0);
  const ok = Math.abs(u.E - E0) <= halv && Math.abs(u.N - N0) <= halv;
  let byttet = false;
  if (!ok) {
    const b = tilUtm33(N, E, sysId);
    byttet = Math.abs(b.E - E0) <= halv && Math.abs(b.N - N0) <= halv;
  }
  return { ok, avstand, byttet, E: u.E, N: u.N };
}

export function vaskFest(f) {
  if (!f || typeof f !== "object") return null;
  const tallEl = (v, g) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < g) ? v : null;
  // Et punkt kan være valgt i modellen uten koordinater ennå, eller ha
  // koordinater skrevet inn før det er valgt — begge deler tas vare på.
  const punkter = (Array.isArray(f.punkter) ? f.punkter : []).slice(0, 2).map(q => {
    if (!q || typeof q !== "object") return null;
    let bx = tallEl(q.bx, 5000), bz = tallEl(q.bz, 5000);
    if (bx == null || bz == null) bx = bz = null;
    const E = tallEl(q.E, 1e8), N = tallEl(q.N, 1e8);
    const Z0 = tallEl(q.Z, MAKS_HOYDE), Z = Z0 != null && Z0 > MIN_HOYDE ? Z0 : null;
    if (bx == null && E == null && N == null && Z == null) return null;
    return { bx, bz, hy: tallEl(q.hy, 1000) || 0, E, N, Z, snap: typeof q.snap === "string" ? q.snap.slice(0, 12) : null };
  });
  while (punkter.length < 2) punkter.push(null);
  const k = f.kontroll;
  const kontroll = k && typeof k === "object" && [k.avvikM, k.lengdeModell, k.lengdeLandmaaler].every(v => tallEl(v, 1e5) != null)
    ? { avvikM: k.avvikM, lengdeModell: k.lengdeModell, lengdeLandmaaler: k.lengdeLandmaaler } : null;
  const laast = f.laast === true;
  return { sys: koordsys(f.sys).id, laast, antall: laast && (f.antall === 2) ? 2 : (laast ? 1 : 0), kontroll: laast ? kontroll : null, punkter };
}

// ═══════════════════════ EKSPORT AV MASSENE ═══════════════════════
//
// Radene til regnearket (js/xlsx.js skriver fila). Rene data, så de kan
// testes uten nettleser. Tallene står som TALL (ikke tekst) og summene som
// SUM-formler — da kan kalkylen regne videre, og man ser hvor summen kommer fra.
//   inn: { modell, adresse, dato, av, gulv, planum, oppbygging, planumModus,
//          padMeter:{b,d}, skraning (vasket), rot, m (masseFelt-svaret), fest }
const avr = (v, d) => { const f = Math.pow(10, d == null ? 1 : d); return Math.round((Number(v) || 0) * f) / f; };
export function masseRader(inn) {
  const m = inn.m, sk = vaskSkraning(inn.skraning);
  const h = (n) => "1:" + String(n).replace(".", ",");
  const rader = [
    ["Masseoverslag — Storm IFC-Viewer"],
    ["Modell", inn.modell || ""],
    ["Terreng", inn.adresse || ""],
    ["Dato", inn.dato || ""],
    ["Laget av", inn.av || ""],
    [],
    ["Gulvkote (moh.)", avr(inn.gulv, 2)],
    ["Planum (moh.)", avr(m.planum, 2)],
    ["Planum satt som", inn.planumModus === "kote" ? "Egen planumkote" : "Gulvkote minus oppbygging " + String(avr(inn.oppbygging, 2)).replace(".", ",") + " m"],
    ["Plate (m)", inn.padMeter ? String(avr(inn.padMeter.b, 1)).replace(".", ",") + " × " + String(avr(inn.padMeter.d, 1)).replace(".", ",") : ""],
    ["Skråninger", !sk.paa ? "Ikke med" : sk.perSide ? "Ulik helning per side" : "Skjæring " + h(sk.skjaering) + ", fylling " + h(sk.fylling)],
    [],
    ["Post", "Helning skjæring", "Helning fylling", "Skjæring (m³)", "Fylling (m³)", "Areal (m²)"]
  ];
  const forste = rader.length + 1;              // første tallrad, 1-basert som i Excel
  rader.push(["Under plata", "", "", avr(m.skjaeringPlate), avr(m.fyllingPlate), avr(m.areal, 0)]);
  if (sk.paa) {
    for (const k of SIDER) {
      const e = sk.perSide ? sk.sider[k] : sk;
      const ps = (m.perSide && m.perSide[k]) || { skjaering: 0, fylling: 0, areal: 0 };
      rader.push(["Skråning mot " + sideRetning(k, inn.rot), h(e.skjaering), h(e.fylling), avr(ps.skjaering), avr(ps.fylling), avr(ps.areal, 0)]);
    }
  }
  const siste = rader.length;
  rader.push(["Sum", "", "", "=SUM(D" + forste + ":D" + siste + ")", "=SUM(E" + forste + ":E" + siste + ")", "=SUM(F" + forste + ":F" + siste + ")"]);
  const sumRad = rader.length;
  rader.push(["Netto (+ overskudd, − underskudd)", "", "", "=D" + sumRad + "-E" + sumRad]);
  rader.push(["10 cm høyere/lavere planum ≈ (m³)", "", "", avr(m.per10cm)]);
  // ⛰ gropene og haugene står for seg — de er allerede med i «Under plata»
  if (m.omrSenket || m.omrHevet) {
    rader.push(["Herav senkede områder (m³)", "", "", avr(m.omrSenket)]);
    rader.push(["Herav hevede områder (m³)", "", "", avr(m.omrHevet)]);
  }
  rader.push([]);
  const f = inn.fest;
  rader.push(["Plassering", f && f.laast
    ? "Festet i " + (f.antall === 2 ? "to hjørner" : "ett hjørne") + " etter landmålerens koordinater"
    : "Omtrentlig (±1–2 m), ikke festet"]);
  if (f && f.laast && f.kontroll) rader.push(["Avvik mellom hjørnene (m)", avr(f.kontroll.avvikM, 3)]);
  if (m.skraningUtAvUtsnitt) rader.push(["ADVARSEL", "Skråningen når kanten av det hentede terrenget — skråningsmassene er for små."]);
  rader.push([]);
  rader.push(["Forbehold", "Overslag, ikke til oppgjør. Terrenget er Kartverkets laserdata (DTM 1 m) fra før graving. Skråningene er regnet med fast helning uten grøfter, drenering eller masseutskifting. Skal aldri brukes til utstikking."]);
  rader.push(["Kilde", "Høydedata: © Kartverket (CC BY 4.0)"]);
  return rader;
}

// ═══════════════════════ 🏗 TERRENGET PÅ BYGGEPLASS-SIDEN ═══════════════════════
//
// Emil 30.09.2026: terrenget skal med ut til byggeplass-lenka, med kartet og
// hele utsnittet (prøvebilde A, «kart, 400 m»). Montøren står på en telefon
// med mobildekning, så det som sendes er KRYMPET:
//   · annethvert punkt (2 m ruter i stedet for 1 m) — et 400 m-utsnitt går fra
//     160 000 til 40 000 punkt. Terrenget er bakgrunn på plassen, ikke
//     måleunderlag; ingen ser forskjell på 1 og 2 m ruter fra 50 m avstand.
//   · høydene som hele centimeter over laveste punkt (Uint16), ikke 32-bits
//     flyttall: 80 kB i stedet for 640 kB.
//   · bare det som er innenfor beskjæringen brukeren har satt på kontoret.
// Kartet sendes for seg som JPEG (se terreng.js) — det er det største.
//
// HVORFOR GRIDET LIGGER I markeringer.json OG IKKE I EN EGEN FIL: Workeren tar
// bare imot glb/json/jpg/pdf/html, og leser bare .markeringer.json og bilder
// tilbake. En egen .bin-fil ville krevd en ny Worker-rute og ny utrulling. Som
// base64 i JSON blir gridet ~110 kB, og fila hentes uansett ved hver åpning.
export const BYGG_STEG = 2;            // hvert 2. punkt
export const BYGG_MAKS_PUNKT = 360000; // vakt mot en fil noen har tuklet med (600 × 600)
const NODATA16 = 65535;

function tilBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fraBase64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// Kontoret → byggeplassen. `t` er terrenget slik terreng.js har det:
// { grid, klipp, E0, N0, h0, plass, gulv, pad }. Svarer med
// { data, kartUtsnitt } — data er det som legges i markeringer.json,
// kartUtsnitt er hvilken del av kartbildet (0–1) som hører til gridet.
export function terrengForByggeplass(t, steg) {
  if (!t || !t.grid || !t.grid.data) return null;
  const g = t.grid, st = Math.max(1, Math.round(steg || BYGG_STEG));
  const k = t.klipp || fulltKlipp(g);
  const i0 = Math.max(0, k.i0), i1 = Math.min(g.w - 1, k.i1);
  const j0 = Math.max(0, k.j0), j1 = Math.min(g.h - 1, k.j1);
  // Hvert nye punkt er SNITTET av en st × st-blokk. Da dekker det nye gridet
  // nøyaktig samme flate som beskjæringen (en rest på én rute i kanten
  // droppes), og kartet kan beskjæres med de samme kantene. Å plukke hvert
  // 2. punkt i stedet flyttet hele gridet en halv meter i forhold til kartet.
  const w = Math.floor((i1 - i0 + 1) / st), h = Math.floor((j1 - j0 + 1) / st);
  if (w < 2 || h < 2) return null;
  const snitt = new Float64Array(w * h);
  let lo = Infinity;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let sum = 0, n = 0;
    for (let b = 0; b < st; b++) for (let a = 0; a < st; a++) {
      const v = g.data[(j0 + j * st + b) * g.w + (i0 + i * st + a)];
      if (gyldigHoyde(v, g.nodata)) { sum += v; n++; }
    }
    const v = n ? sum / n : NaN;
    snitt[j * w + i] = v;
    if (n && v < lo) lo = v;
  }
  if (!Number.isFinite(lo)) return null;
  const hMin = Math.floor(lo * 100) / 100;
  const u16 = new Uint16Array(w * h);
  for (let q = 0; q < w * h; q++) {
    const v = snitt[q];
    u16[q] = Number.isFinite(v) ? Math.min(NODATA16 - 1, Math.max(0, Math.round((v - hMin) * 100))) : NODATA16;
  }
  const dx = g.dx * st, dy = g.dy * st;
  const x0 = g.x0 + i0 * g.dx, y0 = g.y0 - j0 * g.dy;
  const fullB = g.w * g.dx, fullH = g.h * g.dy;
  const klem = (v) => Math.max(0, Math.min(1, v));
  const kartUtsnitt = {
    u0: klem((x0 - g.x0) / fullB), u1: klem((x0 + w * dx - g.x0) / fullB),
    v0: klem((g.y0 - y0) / fullH), v1: klem((g.y0 - (y0 - h * dy)) / fullH)
  };
  const p = t.plass || {};
  return {
    kartUtsnitt,
    data: {
      v: 1,
      E0: t.E0, N0: t.N0, h0: t.h0,
      plass: { pE: p.pE || 0, pN: p.pN || 0, rot: p.rot || 0 },
      gulv: t.gulv ? { kote: t.gulv.kote } : null,
      pad: t.pad && t.pad.paa ? Object.assign({ paa: true, x0: t.pad.x0, x1: t.pad.x1, z0: t.pad.z0, z1: t.pad.z1 },
        erEgenPad(t.pad) ? { form: "egen", punkter: t.pad.punkter.map(q => ({ x: q.x, z: q.z })) } : {},
        t.pad.omrader && t.pad.omrader.length ? { omrader: omrRen(t.pad.omrader) } : {},
        t.pad.farger && t.pad.farger.length ? { farger: fargeRen(t.pad.farger) } : {}) : null,
      grid: { w, h, x0, y0, dx, dy, hMin, data: tilBase64(new Uint8Array(u16.buffer)) },
      kart: ""   // fylles av byggeplass.js med navnet på JPEG-en
    }
  };
}

// Byggeplassen ← markeringer.json. Alt vaskes: fila kommer utenfra. Svarer med
// et terreng i samme form som kontoret bruker (grid med Float32Array), eller null.
export function terrengFraByggeplass(d) {
  if (!d || typeof d !== "object" || d.v !== 1) return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : null;
  const E0 = n(d.E0), N0 = n(d.N0), h0 = n(d.h0);
  if (E0 == null || N0 == null || h0 == null || h0 <= MIN_HOYDE || h0 >= MAKS_HOYDE) return null;
  const q = d.grid || {};
  const w = n(q.w), h = n(q.h), x0 = n(q.x0), y0 = n(q.y0), dx = n(q.dx), dy = n(q.dy), hMin = n(q.hMin);
  if ([w, h, x0, y0, dx, dy, hMin].some(v => v == null)) return null;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > BYGG_MAKS_PUNKT) return null;
  if (!(dx > 0 && dx <= 20 && dy > 0 && dy <= 20) || hMin <= MIN_HOYDE || hMin >= MAKS_HOYDE) return null;
  if (typeof q.data !== "string") return null;
  let u8;
  try { u8 = fraBase64(q.data); } catch (_) { return null; }
  if (u8.length !== w * h * 2) return null;
  const u16 = new Uint16Array(u8.buffer, u8.byteOffset, w * h);
  const data = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) data[k] = u16[k] === NODATA16 ? NaN : hMin + u16[k] / 100;
  const pl = vaskPlassering({ id: "plassering", terreng: "bygg", plass: d.plass, gulv: d.gulv, pad: d.pad });
  if (!pl) return null;
  const kart = typeof d.kart === "string" && /^[0-9a-zA-Z_-]+\.jpg$/.test(d.kart) ? d.kart : "";
  return {
    E0, N0, h0,
    grid: { w, h, x0, y0, dx, dy, data, nodata: null },
    plass: pl.plass, gulv: pl.gulv, pad: pl.pad, kart
  };
}
