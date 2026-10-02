// ═══════════════════════ 🏷 LAPPER SOM IKKE OVERLAPPER ═══════════════════════
// Emil 02.10 («tekstboks kaos»): når materiellet sorteres, står mange bunker
// tett, og navnelappene la seg oppå hverandre til ingen kunne leses. Ønsket:
// «tekstbokser stopper å vokse hvis de treffer hverandre — bedre å ende opp med
// små tekstbokser man kan se hvis man zoomer inn». Samme for markeringene.
//
// Regelen (ren, uten three.js — testes i _test/test-lapp-kollisjon.mjs):
//   · Hver lapp har et ønske: senter (x, y) og full størrelse (b × h) i px.
//   · To lapper som ville overlappet, krymper LIKT til de akkurat ikke
//     berører hverandre (+ en liten luft). Faktoren for et par er den største
//     av «nok plass i bredden» og «nok plass i høyden» — én av dem holder.
//   · En lapp krymper aldri mer enn det trangeste paret krever, og vokser
//     aldri over ønsket (faktor ≤ 1).
//   · Blir en lapp mindre enn min px av det, skjules den i stedet — en lapp
//     ingen kan lese er bare støy. Det er alltid den MINST viktige i paret som
//     viker (prio: lavere tall = viktigere; markeringer går foran navnelapper,
//     så nærmeste foran fjerneste). Da får naboen plassen.
//   · En som ikke kan skjules (markeringene — en sak skal aldri bli borte),
//     stopper på min px og får heller ligge litt over naboen.
// Zoomer man inn, sprer punktene seg på skjermen mens ønsket står stille —
// og lappene vokser tilbake til full størrelse.

export const LUFT_PX = 2;

// lapper: [{ x, y, b, h, min, kanSkjules, prio }]
// svar:   [{ faktor, vis }] i samme rekkefølge som inn
export function fordelLapper(lapper, luft = LUFT_PX) {
  const n = lapper.length;
  const svar = lapper.map(() => ({ faktor: 1, vis: true }));
  if (n < 2) return svar;
  const rekke = lapper.map((_, i) => i).sort((a, b) => (lapper[a].prio || 0) - (lapper[b].prio || 0) || a - b);
  const skjult = new Uint8Array(n);
  const minF = (l) => (l.h > 0 ? Math.min(1, (l.min || 0) / l.h) : 0);
  // Faktoren der to lapper (begge krympet likt) akkurat ikke overlapper
  const parF = (a, c) => {
    const dx = Math.abs(a.x - c.x), dy = Math.abs(a.y - c.y);
    const fb = (dx - luft) / ((a.b + c.b) / 2 || 1e-9);
    const fh = (dy - luft) / ((a.h + c.h) / 2 || 1e-9);
    return Math.max(0, Math.max(fb, fh));
  };
  // Raskt nei: to lapper som ikke rører hverandre i full størrelse
  const rorer = (a, c) => Math.abs(a.x - c.x) < (a.b + c.b) / 2 + luft && Math.abs(a.y - c.y) < (a.h + c.h) / 2 + luft;

  // Parene som rører hverandre i full størrelse — funnet med et sveip langs x
  // (sortert på venstre kant), så 400 lapper ikke blir 80 000 sammenligninger.
  const xs = lapper.map((_, i) => i).sort((a, b) => (lapper[a].x - lapper[a].b / 2) - (lapper[b].x - lapper[b].b / 2));
  const naboer = lapper.map(() => []);
  for (let p = 0; p < n; p++) {
    const i = xs[p], a = lapper[i], hoyre = a.x + a.b / 2 + luft;
    for (let q = p + 1; q < n; q++) {
      const j = xs[q], c = lapper[j];
      if (c.x - c.b / 2 >= hoyre) break;          // resten ligger lenger til høyre
      if (rorer(a, c)) { naboer[i].push(j); naboer[j].push(i); }
    }
  }
  const plass = new Int32Array(n);
  rekke.forEach((i, k) => { plass[i] = k; });

  // 1) Hvem må vike? Gå fra viktigst og nedover.
  for (const i of rekke) {
    if (skjult[i]) continue;
    const a = lapper[i];
    for (const j of naboer[i]) {
      if (plass[j] < plass[i] || skjult[j]) continue;   // bare de mindre viktige
      const c = lapper[j];
      const f = parF(a, c);
      if (!(f < minF(a) || f < minF(c))) continue;
      if (c.kanSkjules) skjult[j] = 1;
      else if (a.kanSkjules) { skjult[i] = 1; break; }
      // ingen av dem kan skjules: de stopper på min (under)
    }
  }
  // 2) Faktorene, bare mot dem som fortsatt vises
  for (let i = 0; i < n; i++) {
    if (skjult[i]) { svar[i] = { faktor: 0, vis: false }; continue; }
    const a = lapper[i];
    let f = 1;
    for (const j of naboer[i]) if (!skjult[j]) f = Math.min(f, parF(a, lapper[j]));
    f = Math.max(f, a.kanSkjules ? 0 : minF(a));
    // Sikkerhetsnett: kan den skjules og ble likevel for liten (tre i klynge
    // der hvert par alene var greit), viker den.
    if (a.kanSkjules && f < minF(a)) { svar[i] = { faktor: 0, vis: false }; continue; }
    svar[i] = { faktor: Math.min(1, f), vis: true };
  }
  return svar;
}
