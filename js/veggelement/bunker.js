// 📦 BUNKENE: hvor de står, og hvordan de husker at noen har flyttet dem.
//
// Et BLAD i modulgrafen — den importerer bare regler.js, som selv ikke peker
// på noen annen del. Derfor kan både generer.js (SW-stablene), tak.js
// (TRP-bunkene) og blikk.js (beslagbunkene) bruke den uten at det oppstår en
// ring mellom delene.
import { tilScene } from "./regler.js";

// Nøkkelen til en bunke er STØRRELSEN, ikke navnet: SW-numrene forskyver seg
// når bygget endres, og da ville bunken flyttet seg av seg selv.
export function stabelNokkel(lengde, bredde, tykkelse) {
  return Math.round(Number(lengde) || 0) + "x" + Math.round(Number(bredde) || 0) + "x" + Math.round(Number(tykkelse) || 0);
}

// 📦 SAMME HUSKEREGEL FOR ALLE MALTYPER (Emil 21.09, da TRP og blikk fikk
// egne bunker). `lesStabelPosisjoner` i generer.js ser bare etter sandwich —
// den er del A-ens egen. Disse to gjør nøyaktig det samme for hva som helst, med
// maltypen INNE I NØKKELEN: en TRP på 6000 × 1030 og et beslag på 6000 × 1030
// er to forskjellige bunker, og skal ikke arve hverandres plass.
export function lesStabelPosisjonerAlle(liste, ider) {
  const m = new Map();
  for (const p of liste || []) {
    if (!p || !ider.has(p.id)) continue;
    const k = p.maltype + ":" + (p.beslagType || "") + ":" +
      stabelNokkel(p.lengde, p.bredde, p.tykkelse);
    if (!m.has(k)) m.set(k, { x: p.x, y: p.y, z: p.z, rot: p.rot });
  }
  return m;
}
export function settStabelTilbakeAlle(pkt, posisjoner) {
  if (!pkt || !posisjoner) return pkt;
  const k = pkt.maltype + ":" + (pkt.beslagType || "") + ":" +
    stabelNokkel(pkt.lengde, pkt.bredde, pkt.tykkelse);
  const pos = posisjoner.get(k);
  if (!pos) return pkt;
  posisjoner.delete(k);
  pkt.x = pos.x; pkt.y = pos.y; pkt.z = pos.z; pkt.rot = pos.rot;
  return pkt;
}

// 🧭 HVOR BUNKENE TIL TAKET OG BLIKKET STÅR.
//
// SW-stablene går UTOVER fra fasaden, rad for rad (off + 5000 + rad × høyde).
// Legger man TRP og blikk samme vei, havner de før eller siden oppå en
// SW-rad — hvor langt ut den rekker avhenger av elementhøyden og hvor mange
// SW-numre fasaden har. Derfor legges de nye bunkene på rekke FORBI ENDEN av
// fasaden i stedet: der er det aldri SW-stabler, uansett hvor høyt bygget er.
// `retning` +1 = forbi t1-enden (taket), −1 = forbi t0-enden (blikket).
export function bunkePlass(f, okBetong, retning, i, lengdeMm, utMm) {
  const ut = f.off + tilScene(Number(utMm) || 2000);
  const steg = tilScene((Number(lengdeMm) || 2000) + 1500);
  const tMid = retning >= 0
    ? f.t1 + tilScene(3000) + i * steg
    : f.t0 - tilScene(3000) - i * steg;
  return {
    x: f.px + f.ex * tMid + f.nx * ut,
    y: okBetong,
    z: f.pz + f.ez * tMid + f.nz * ut,
    rot: f.rot
  };
}

