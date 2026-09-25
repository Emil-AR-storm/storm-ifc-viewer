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
export const UTSNITT = [200, 400, 600, 800];
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
export function wcsUrl(bbox) {
  return WCS_URL + "?service=WCS&version=1.0.0&request=GetCoverage" +
    "&coverage=" + WCS_DEKNING + "&crs=EPSG:25833" +
    "&bbox=" + [bbox.minE, bbox.minN, bbox.maxE, bbox.maxN].join(",") +
    "&width=" + bbox.side + "&height=" + bbox.side + "&format=GeoTIFF";
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
export function gridTilTrekanter(grid, E0, N0, h0, skala) {
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
      pos[k * 3 + 1] = ok[k] ? mTilScene(v - h0, skala) : 0;
      pos[k * 3 + 2] = -mTilScene(c.N - N0, skala);
    }
  }
  const idx = [];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + w, c = a + 1, d = b + 1;
      if (ok[a] && ok[b] && ok[c]) idx.push(a, b, c);
      if (ok[c] && ok[b] && ok[d]) idx.push(c, b, d);
    }
  }
  return { pos, idx: new Uint32Array(idx), ok };
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
