// ⚙ Selve genereringen: generer(), migreringen av gamle oppsett, oppløsningen av
// justeringene, materiellstablene og CSV-lista.
//
// Én av åtte deler av SW-generatoren. js/veggelement.js er inngangen og
// samler dem; se toppen av den fila for hva generatoren gjør.
//
// DELENE PEKER PÅ HVERANDRE BEGGE VEIER, og det er med vilje: dette var én
// fil på 6500 linjer, og å rive den i atskilte lag ville vært en omskriving,
// ikke en oppdeling. ES-moduler tåler ringer så lenge navnene brukes når
// koden KJØRER, ikke mens modulen lastes — derfor står det bare
// registreringer av lyttere på toppnivå her, aldri utregninger som leser en
// konstant fra en annen del.

import { $, S, esc } from "../state.js";
import { t } from "../i18n.js";
import { lastNedXlsxFlere } from "../elements.js";
import { materiellListe, materiellRader } from "../sw-materiell.js";
import { blikkArk } from "./blikk.js";
import { takArk } from "./tak.js";
import { lagreMateriellLokalt, tegnMateriell, vaskMateriell } from "../materiell-vis.js";
import { APN_SLARK, SW_MIN_BIT_MM, SW_SPENNANDEL, SW_TOL_MM, SW_VEGGANDEL, delOppMedUtsparinger, delRadApninger, eierUtsparing, fasadeSoyler, fasaderFra, fasaderLangsRand, flatTak, hentSoyler, hjorneForlengelse, kappNavn, konveksHull, loesRad, manuelleFasaderFra, radStabel, samleTetteSoyler, soylerIFasader, spennSoyler, swListeRader, swNummerering, takLinje, takSpenn, takTopp, tilMm, tilScene, toppErSkra, toppVinkel, utspFyllBiter, utsparingerPaFasade, veggSoyler, vinkelTekst } from "./regler.js";
import { STD_OPPSETT, lagret, oppsett, settLagret, skrivLagret } from "./tilstand.js";
import { TAK_TOL_MM, baseYNaa, taklinjerFraModell, tegnAlt, utspPaFasader } from "./tegning.js";
import { butikkFor } from "./juster.js";
import { INNER_STD, innerData, lagretInner, tegnPanel } from "./panel.js";
import { innerBaseY, nummererInner } from "./innervegg.js";

// ---------- Selve genereringen ----------
export async function generer() {
  const o = oppsett();
  const alleSoyler = await hentSoyler();
  if (alleSoyler.length < 3) {
    alert(t("Fant bare {0} søyler (IfcColumn) i modellen — trenger minst 3 for å finne fasadene.", alleSoyler.length));
    return;
  }
  // 🧭 MANUELT SLÅR AV AUTOMATIKKEN (Emils valg, punkt 6): er én fasade satt
  // for hånd, brukes BARE de manuelle. Da kan ikke to vegger havne i samme plan.
  const manuelle = (o.manuelleFasader || []).filter(m => m && (m.ider || []).length >= 2);
  let soyler, fasader;
  if (manuelle.length) {
    const perId = new Map();
    for (const sø of alleSoyler) for (const id of sø.ider || []) perId.set(id, sø);
    fasader = manuelleFasaderFra(manuelle, perId, INNER_STD.knekkGrader);
    soyler = soylerIFasader(fasader);
    if (!fasader.length || soyler.length < 2) {
      alert(t("De manuelle fasadene peker på søyler som ikke finnes i denne modellen. Slett dem, eller marker på nytt."));
      return;
    }
  } else {
    // Bare søylene UNDER SØYLEFORLENGERE er vegg — de bestemmer både fasadene
    // (konvekst hull) og skjøtene. Rammer uten forlenger står utenfor veggen.
    soyler = veggSoyler(alleSoyler, 0.8 / (S.enhetSkala || 1));
    const kolTol0 = Math.max(0.3 / (S.enhetSkala || 1), soyler[0].bredde * 2);
    // Randvandringen først — den takler innvendige hjørner (L, T, U, tilbygg).
    // Klarer den ikke å lukke konturen, er bygget ikke rettvinklet, og vi faller
    // tilbake på det konvekse hullet som før.
    fasader = fasaderLangsRand(soyler, kolTol0, 15 / (S.enhetSkala || 1))
      || fasaderFra(soyler, kolTol0);
  }
  const kolTol = Math.max(0.3 / (S.enhetSkala || 1), soyler[0].bredde * 2);
  if (!fasader.length) { alert(t("Fant ingen fasader å sette veggelementer på.")); return; }

  const okBetong = Math.min(...soyler.map(s => s.minY));   // OK betong = bunn av søylene
  // Gavlsøyler uten forlenger skal likevel dele veggen (Sundland 04.09).
  for (const f of fasader) {
    f.soyler = fasadeSoyler(f, alleSoyler, kolTol, okBetong, SW_VEGGANDEL);
    f.toppY = Math.max(...f.soyler.map(k => k.s.maxY));
  }
  const ringH = o.ringmur ? tilScene(o.ringHoydeMm) : 0;
  const baseY = okBetong + ringH;                           // SW starter på gulv eller ringmur
  const tS = tilScene(o.tykkelseMm);

  // 🏔 TAKLINJA PER FASADE (runde 20). Punktene leses av stålet i fasadeplanet
  // og gjøres om til MM langs fasaden og MM over SW-basen — samme enheter som
  // resten av elementregninga. Er linja flat, brukes fasadens søyletopp som før.
  // Står saltak-knappen av, spørres modellen ikke i det hele tatt: en runde
  // gjennom alle ståltrekantene koster, og svaret ville uansett blitt kastet.
  const takP = o.folgTak ? taklinjerFraModell(fasader, tS) : [];
  const takLinjer = fasader.map((f, i) => takLinje(
    (takP[i] || []).map(([tt, y]) => [tilMm(tt), tilMm(y - baseY)]), TAK_TOL_MM));

  // Gulvet: søylenes utstrekning + utstikk, OK betong øverst
  const hull = konveksHull(soyler.map(s => ({ x: s.cx, z: s.cz })));
  const minX = Math.min(...hull.map(p => p.x)), maxX = Math.max(...hull.map(p => p.x));
  const minZ = Math.min(...hull.map(p => p.z)), maxZ = Math.max(...hull.map(p => p.z));
  const ut = tilScene(o.utstikkMm);
  const gulv = {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, topp: okBetong,
    bredde: maxX - minX + 2 * ut, dybde: maxZ - minZ + 2 * ut
  };

  // Hver utsparing hører til ÉN vegg — den fasaden senteret ligger nærmest
  // (Emils runde 6: en åpning nær et hjørne skal aldri kappe naboveggen).
  const utspPerFasade = new Map();
  for (const u of (o.utsparinger || [])) {
    if (!u || !u.min) continue;
    let besteFi = -1, besteAvst = Infinity;
    for (let fi = 0; fi < fasader.length; fi++) {
      const f = fasader[fi];
      // UTSPARINGEN HØRER BARE TIL VEGGEN DEN ER LAGET I (Emil 02.09). Regelen
      // bor i apningPaVegg og er den SAMME for yttervegger og innervegger —
      // to kopier ville før eller siden svart forskjellig.
      // … og speilvendt: en INNERVEGG som ligger nærmere eier åpningen (08.09)
      const avst = eierUtsparing(
        { px: f.p.x, pz: f.p.z, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
          t0: f.soyler[0].t, t1: f.soyler[f.soyler.length - 1].t },
        u, (lagretInner && lagretInner.fasader) || [], APN_SLARK / (S.enhetSkala || 1));
      if (avst === null) continue;
      if (avst < besteAvst) { besteAvst = avst; besteFi = fi; }
    }
    if (besteFi >= 0) {
      if (!utspPerFasade.has(besteFi)) utspPerFasade.set(besteFi, []);
      utspPerFasade.get(besteFi).push(u);
    }
  }

  // Veggen (og ringmuren) står FLUKT inntil utsiden av søylene. Utsiden
  // måles fra de FAKTISKE søyleboksene på fasaden — senteravvik pluss halve
  // boksen langs normalen — ikke fra en medianbredde. Da ligger elementet
  // rett på veggen selv når søylene har fotplater eller ulik størrelse
  // (Emils funn runde 2: veggene sto ikke inntil). Regnes for ALLE fasadene
  // først: hjørnelappen trenger naboens offset (skrå hjørner, Valle 08.09).
  const offs = fasader.map(f => {
    let ytreFlate = 0;
    for (const k of f.soyler) {
      const lat = (k.s.cx - f.p.x) * f.nx + (k.s.cz - f.p.z) * f.nz;
      const halv = (Math.abs(f.nx) * k.s.bx + Math.abs(f.nz) * k.s.bz) / 2;
      ytreFlate = Math.max(ytreFlate, lat + halv);
    }
    return ytreFlate + tS / 2;
  });
  // Ringmur og vegger per fasade
  const ringmur = [];
  const vegger = [];
  const fasadeInfo = [];   // {off, rot} per fasade — til stabelplasseringen
  for (let fi = 0; fi < fasader.length; fi++) {
    const f = fasader[fi];
    const off = offs[fi];
    const midt = (tMid, y) => ({
      x: f.p.x + f.ex * tMid + f.nx * off,
      z: f.p.z + f.ez * tMid + f.nz * off,
      y
    });
    const rot = Math.atan2(-f.ez, f.ex);
    fasadeInfo.push({ off, rot });
    // Fasadens basis, så et element kan REGNES OM når det dras: punktet på
    // veggplanet ved fasade-mm 0, og retningen langs fasaden.
    const fx = f.p.x + f.nx * off, fz = f.p.z + f.nz * off;
    // SØYLEFORLENGERNE BESTEMMER SKJØTENE (Emils regel runde 5): bare søyler
    // som når helt til TOPPEN av fasaden deler veggen i spenn. Korte
    // tilleggssøyler og losholter rundt utsparinger når aldri toppen, og kan
    // dermed aldri bli misforstått som skjøtepunkter — mens forlengerne over
    // portene gir skjøt på riktig plass.
    const spennS = spennSoyler(f.soyler, okBetong, SW_SPENNANDEL, kolTol);
    // Tette forlengere (hjørne- og avstivningssøyler i par) gir ÉN skjøt, ikke
    // to skjøter og en 660 mm strimmel mellom seg (Emil 02.09).
    const skjot = samleTetteSoyler(spennS.map(k => tilMm(k.t)), o.minFeltMm);
    // 📐 SKJØTEPUNKTENE LAGRES. Instruksjonstegninga trenger dem til
    // aksesirklene og målkjeden, og har fram til nå regnet dem BAKLENGS ut av
    // elementgrensene. Det gikk galt i hjørnene, der pinwheel-lappen er
    // usymmetrisk (−off+t/2 i starten, +off+t/2 i slutten): aksene havnet
    // 200 mm feil i den ene enden (Emil 03.09). Ett tall lagret her fjerner
    // hele klassen av feil.
    fasadeInfo[fi].skjot = skjot.map(v => Math.round(v));
    // Holdepunktene håndjusteringen snapper til: klaringen fra hvert
    // søylesenter, og søylekantene (Emils ønske 02.09).
    const snappP = [];
    for (const k of f.soyler) {
      const c = tilMm(k.t), halv = tilMm(k.s.bredde) / 2;
      snappP.push(c - o.klaringMm, c + o.klaringMm, c - halv, c + halv);
    }
    const t0 = tilScene(skjot[0]), t1 = tilScene(skjot[skjot.length - 1]);
    // 🏔 VEGGTOPPEN. Flatt tak: fasadens høyeste søyletopp, akkurat som før.
    // Skrått tak: radstabelen reises til taklinjas HØYESTE punkt, og hver rad
    // kappes ned mot linja i takSpenn under. Uten det høyeste punktet ville
    // mønet stått uten rader å kappe.
    const linje = takLinjer[fi] || [];
    const flatt = !o.folgTak || linje.length < 2 || flatTak(linje, TAK_TOL_MM);
    const toppMm = flatt ? tilMm(f.toppY - baseY)
      : Math.max(tilMm(f.toppY - baseY), ...linje.map(q => q[1]));
    fasadeInfo[fi].takLinje = flatt ? null : linje.map(q => [Math.round(q[0]), Math.round(q[1])]);
    const { rader: alleRader, kappIndex } = radStabel(toppMm, o.radHoyder, o.kappNederst);
    const apninger = utsparingerPaFasade(f, baseY, utspPerFasade.get(fi) || []);
    // HJØRNENE gjøres som på Moelv-tegningen: hver fasade LØPER FORBI hjørnet
    // i sin sluttende (dekker naboveggens endeflate, helt ut til ytterhjørnet),
    // og starter FLUKT mot innsiden av forrige fasades vegg. Rundt bygget gir
    // det pinwheel-hjørner — ett element stikker forbi i hvert hjørne, aldri to.
    const offMm = tilMm(off);
    // Fortegnet leses av NABOENS utover-normal: peker den samme vei som denne
    // fasaden løper, er hjørnet utvendig og elementet skal forbi (+off); peker
    // den motsatt, er hjørnet INNVENDIG (L-bygg) og elementet skal tilsvarende
    // kortere (−off). Uten dette dyttet hjørnelappen veggen ut i lufta i hvert
    // innvendig hjørne (Emils lagerbygg 04.09). På et rektangel er begge +1,
    // så vaskehallen og alle konvekse bygg får nøyaktig samme mål som før.
    // SKRÅ HJØRNER (Valle 08.09): på et rett hjørne er dette nøyaktig
    // «± naboens offset + halve tykkelsen»; på et skrått hjørne er det den
    // faktiske skjæringen mellom denne veggens midtplan og naboens flate.
    const nabo = (fi + 1) % fasader.length, forrige = (fi + fasader.length - 1) % fasader.length;
    const hjFraMm = tilMm(t0) + hjorneForlengelse(f, f.forrigeN, offs[forrige], off, o.tykkelseMm, true);
    const hjTilMm = tilMm(t1) + hjorneForlengelse(f, f.nesteN, offs[nabo], off, o.tykkelseMm, false);
    if (o.ringmur) {
      // RINGMUREN BEHANDLES SOM EN RAD (Emil 02.09): den kappes rundt en
      // utsparing på nøyaktig samme måte som veggelementene, og får en
      // fyllbit under åpningen når åpningen ikke går helt ned til gulvets
      // underkant. Før sto ringmuren igjen i døråpningen.
      // Båndet i mm regnet fra SW-basen (topp ringmur = 0):
      const rmTopp = 0;
      const rmBunn = -(tilMm(ringH) + o.betongMm + o.isoMm);
      // ✥ RINGMURBITENE ER JUSTERBARE ELEMENTER, som veggene (Emil 03.09).
      // De får samme felter «Juster elementer» krever: stabil id, fasadebasis,
      // basis-utstrekning og to forskyvninger. Alt annet (x, z, lengde) er
      // avledet og regnes om i loesAlleJusteringer — nøyaktig som for veggene.
      const rmBit = (bunnMm, hoydeMm, fraMm, tilMm2) => {
        const pR = midt(tilScene((fraMm + tilMm2) / 2), 0);
        ringmur.push({
          id: "r" + ringmur.length, fi, ringmur: true, radIdx: "rm",
          fx, fz, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
          basFraMm: Math.round(fraMm), basTilMm: Math.round(tilMm2), dFra: 0, dTil: 0, rev: 0,
          fraMm: Math.round(fraMm), tilMm: Math.round(tilMm2),
          lengdeMm: Math.round(tilMm2 - fraMm), fullMm: Math.round(tilMm2 - fraMm),
          bunnMm: Math.round(bunnMm), hoydeMm: Math.round(hoydeMm), tMm: o.tykkelseMm,
          snapp: snappP,
          x: pR.x, z: pR.z,
          y: baseY + tilScene(bunnMm + hoydeMm / 2),
          lengde: tilScene(tilMm2 - fraMm),
          hoyde: tilScene(hoydeMm),
          tykkelse: tS, rot });
      };
      const rmApn = apninger
        .filter(a => Math.min(a.toppMm, rmTopp) - Math.max(a.bunnMm, rmBunn) > 10);
      const rKutt = rmApn.map(a => [a.fraMm, a.tilMm_]);
      for (const [rFra, rTil] of delOppMedUtsparinger(hjFraMm, hjTilMm, rKutt))
        rmBit(rmBunn, rmTopp - rmBunn, rFra, rTil);
      for (const b of utspFyllBiter(rmBunn, rmTopp, hjFraMm, hjTilMm, rmApn, SW_MIN_BIT_MM))
        rmBit(b.bunnMm, b.hoydeMm, b.fraMm, b.tilMm_);
    }
    // RAMMEN RUNDT LØKKA: FELT UTENPÅ, RADER INNENFOR (Emil 02.09). Da kommer
    // elementene i samme rekkefølge som numrene på Lørenskog-tegningene —
    // felt for felt langs fasaden, radene nedenfra og opp — og swNummerering
    // trenger bare å dele ut neste nummer ved første gangs bruk.
    const radBunn = [];        // bunnMm per rad, nedenfra
    { let b = 0; for (const h of alleRader) { radBunn.push(b); b += h; } }
    const kl = o.klaringMm;
    for (let i = 0; i < skjot.length - 1; i++) {
      const sFra = i === 0 ? hjFraMm : skjot[i] + kl;
      const sTil = i === skjot.length - 2 ? hjTilMm : skjot[i + 1] - kl;
      const fullMm = sTil - sFra;
      if (fullMm < SW_MIN_BIT_MM) continue;
      for (let r = 0; r < alleRader.length; r++) {
        const radH = alleRader[r], rBunn = radBunn[r], rTopp = rBunn + radH;
        const tilpassetRad = r === kappIndex;
        const radApninger = apninger
          .filter(a => Math.min(a.toppMm, rTopp) - Math.max(a.bunnMm, rBunn) > 10);
        // Bare åpninger som tar HELE radhøyden deler raden i to korte
        // elementer. De som bare skjærer inn i den blir HAKK i elementet —
        // elementet står med full høyde og full feltlengde (Emil 02.09,
        // Moelv SW-11/SW-06).
        const { hele, notch } = delRadApninger(rBunn, rTopp, radApninger, SW_MIN_BIT_MM);
        const kutt = hele.map(a => [a.fraMm, a.tilMm_]);
        // 🏔 Taket kapper raden FØR utsparingene deler den. På flatt tak gir
        // takSpenn nøyaktig [{fra: sFra, til: sTil}], og alt under er ord for
        // ord som før runde 20.
        const spenn = flatt ? [{ fra: sFra, til: sTil }]
          : takSpenn(linje, sFra, sTil, rBunn, rTopp, kl, SW_MIN_BIT_MM, o.minSkraMm);
        for (const sp of spenn) {
        // Feltlengden et element måles mot: på et skrått tak er det bitens
        // eget spenn, ellers ville hver møne- og raftbit blitt stemplet kapp
        // i lengden når den bare er kappet i høyden.
        const feltMm = flatt ? fullMm : sp.til - sp.fra;
        for (const [bFra, bTil] of delOppMedUtsparinger(sp.fra, sp.til, kutt)) {
          const lengdeMm = bTil - bFra;
          // 🏔 OVERKANTEN: taket skjærer i elementet, som en utsparing gjør.
          // toppP er polylinja langs overkanten i elementets egne mm.
          const toppP = flatt ? null : takTopp(linje, bFra, bTil, rBunn, rTopp);
          const hV = flatt ? radH : toppP[0][1];
          const hH = flatt ? radH : toppP[toppP.length - 1][1];
          const skra = !flatt && toppErSkra(toppP, radH);
          const hMaks = flatt ? radH : Math.max(...toppP.map(q => q[1]));
          if (hMaks < 20) continue;
          const tMid = tilScene((bFra + bTil) / 2);
          const p = midt(tMid, baseY + tilScene(rBunn + hMaks / 2));
          // hakkene i ELEMENTETS egne mm: x fra venstre ende, y fra bunnen
          const hull = [];
          for (const a of notch) {
            const x0 = Math.max(bFra, a.fraMm) - bFra, x1 = Math.min(bTil, a.tilMm_) - bFra;
            const y0 = Math.max(rBunn, a.bunnMm) - rBunn, y1 = Math.min(rTopp, a.toppMm) - rBunn;
            if (x1 - x0 > 10 && y1 - y0 > 10) hull.push({ x0, x1, y0, y1 });
          }
          vegger.push({
            x: p.x, y: p.y, z: p.z, rot, fi, tMid, nx: f.nx, nz: f.nz,
            // til håndjusteringen: stabil id, fasadebasis, basis-utstrekning,
            // radband og radens åpninger (hakkene regnes ut på nytt ved
            // tegning, så de følger elementet når det strekkes)
            id: "v" + vegger.length, fx, fz, ex: f.ex, ez: f.ez,
            radIdx: r, rBunnMm: rBunn,
            basFraMm: Math.round(bFra), basTilMm: Math.round(bTil), dFra: 0, dTil: 0, rev: 0,
            fraMm: Math.round(bFra), tilMm: Math.round(bTil),
            apn: radApninger.map(a => ({ fraMm: a.fraMm, tilMm_: a.tilMm_, bunnMm: a.bunnMm, toppMm: a.toppMm })),
            snapp: snappP,
            lengdeMm: Math.round(lengdeMm), hoydeMm: hMaks, tMm: o.tykkelseMm,
            // radHMm er RADENS fulle høyde; hVMm/hHMm er elementets høyde i
            // venstre og høyre ende. På flatt tak er alle tre like.
            radHMm: radH, hVMm: hV, hHMm: hH, skra: skra || undefined,
            toppP: skra ? toppP : undefined,
            fullMm: Math.round(feltMm),
            hull: hull.length ? hull : undefined,
            // Kapp = FAKTISK skåret i LENGDEN: tilpasningsraden, eller en bit
            // som er kortere enn feltet fordi en port tok resten. Et hakk
            // gjør det IKKE — Moelv beholder SW-06 3780MM med vindu i.
            tilpassetRad,
            // Et SKRÅKAPPET element er alltid kapp — det er skåret, og to like
            // lange skrå biter fra hver sin ende av gavlen er ikke samme vare.
            tilpasset: tilpassetRad || skra || lengdeMm < feltMm - SW_TOL_MM ||
                       (o.kappUnderMm > 0 && lengdeMm < o.kappUnderMm)
          });
        }
        }
      }
    }
  }
  if (!vegger.length) { alert(t("Ingen veggelementer ble generert — sjekk at modellen har søyler med høyde.")); return; }

  // SW-numrene
  // Fasadene lagres kompakt, så stablene kan settes opp på nytt etter en
  // håndjustering — uten å regne ut fasadene fra modellen igjen.
  const fasadeLagret = fasader.map((f, i) => ({
    px: f.p.x, pz: f.p.z, ex: f.ex, ez: f.ez, nx: f.nx, nz: f.nz,
    t0: f.soyler[0].t, t1: f.soyler[f.soyler.length - 1].t,
    off: (fasadeInfo[i] || {}).off || 0, rot: (fasadeInfo[i] || {}).rot || 0,
    skjot: (fasadeInfo[i] || {}).skjot || null,
    // 🏔 Taklinja lagres i MM, så et element som DRAS kan lese av de nye
    // endehøydene sine uten at fasadene regnes ut av modellen på nytt.
    takLinje: (fasadeInfo[i] || {}).takLinje || null
  }));

  // Åpningene lagres PROJISERT på fasaden, så merkingen kan tegnes uten å
  // regne fasadene ut fra modellen på nytt.
  const utspVis = [];
  for (let fi = 0; fi < fasader.length; fi++)
    for (const a of utsparingerPaFasade(fasader[fi], baseY, utspPerFasade.get(fi) || []))
      utspVis.push({ fi, fraMm: a.fraMm, tilMm_: a.tilMm_, bunnMm: a.bunnMm, toppMm: a.toppMm, type: a.type, navn: a.navn });

  // 🩹 BLIKKET følger med over en ny generering (runde 2b). Både bryteren og
  // håndjusteringene: genererer Emil veggene på nytt etter å ha justert
  // blikket, skal blikket komme tilbake justert — som `dFra`/`dTil` gjør på et
  // veggelement. Er det ikke generert ennå, står det av, og «Generer blikk» er
  // en knapp som faktisk gjør noe.
  const blikkFoer = (lagret && lagret.blikk) || null;
  settLagret({ oppsett: o, vegger, gulv, ringmur, materiellIder: [],
               fasader: fasadeLagret, okBetong, baseY, utspVis,
               blikk: blikkFoer || { pa: false, just: {}, ekstra: [], nesteNr: 1 } });
  loesAlleJusteringer();
  byggAlleStabler();
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

// ---------- Justeringene løses opp, og alt avledet regnes om ----------
// Kjøres etter generering, etter hvert drag, og når en modell åpnes igjen.
// Elementene beholder basFraMm/basTilMm + dFra/dTil; ALT annet (utstrekning,
// posisjon, lengde, SW-nummer, skjult) er avledet — derfor kommer et skjult
// element tilbake så snart du drar tilbake.
// Vegger generert FØR runde 14 mangler id, fasadebasis og basis-utstrekning,
// og var derfor umulige å plukke i justeringsmodus (Emils funn 02.09) — de
// ligger i localStorage og tegnes opp igjen uten å bli generert på nytt.
// Her fylles feltene inn fra det som finnes: rot gir fasaderetningen,
// tMid + lengdeMm gir utstrekningen, og y grupperer radene.
export function migrerVegger() {
  if (!lagret || !lagret.vegger) return;
  const rader = new Map();
  lagret.vegger.forEach((v, i) => {
    if (v.id === undefined || v.id === null) v.id = "v" + i;
    if (v.ex === undefined) { v.ex = Math.cos(v.rot || 0); v.ez = -Math.sin(v.rot || 0); }
    if (v.fx === undefined) { v.fx = v.x - v.ex * (v.tMid || 0); v.fz = v.z - v.ez * (v.tMid || 0); }
    if (v.basFraMm === undefined) {
      const midMm = tilMm(v.tMid || 0);
      v.basFraMm = Math.round(midMm - (v.lengdeMm || 0) / 2);
      v.basTilMm = Math.round(midMm + (v.lengdeMm || 0) / 2);
    }
    if (v.dFra === undefined) v.dFra = 0;
    if (v.dTil === undefined) v.dTil = 0;
    if (v.rev === undefined) v.rev = 0;
    if (v.fullMm === undefined) v.fullMm = v.lengdeMm || 0;
    if (v.rBunnMm === undefined) v.rBunnMm = 0;
    if (v.radIdx === undefined) {
      const k = Math.round((v.y || 0) * 1000) + "|" + v.hoydeMm;
      if (!rader.has(k)) rader.set(k, rader.size);
      v.radIdx = rader.get(k);
    }
  });
}

// 🧱 Ringmur laget FØR den ble justerbar (Emil 03.09) har bare {x,z,y,lengde,
// hoyde,tykkelse,rot}. Uten id er biten ikke plukkbar, og uten fasadebasis kan
// ikke draget regne mm. Her fylles feltene ut av det som finnes — fasaden
// kjennes igjen på RETNINGEN (samme regel som tegninga bruker), ikke på
// avstanden: i hjørnet er en bit alltid nærmere naboens plan enn sitt eget.
// Da slipper Emil å generere veggene på nytt for å kunne dra i muren.
export function migrerRingmur() {
  if (!lagret || !lagret.ringmur || !lagret.ringmur.length) return;
  const fasader = lagret.fasader || [];
  const baseY = baseYNaa();
  lagret.ringmur.forEach((r, i) => {
    if (r.id === undefined || r.id === null) r.id = "r" + i;
    if (r.ringmur === undefined) r.ringmur = true;
    if (r.radIdx === undefined) r.radIdx = "rm";
    if (r.fi === undefined && fasader.length) {
      let best = -1, bestD = Infinity;
      for (let j = 0; j < fasader.length; j++) {
        const f = fasader[j];
        const fRot = isFinite(Number(f.rot)) ? Number(f.rot) : Math.atan2(-f.ez, f.ex);
        if (isFinite(Number(r.rot)) && Math.abs(vinkelDiffLokal(r.rot, fRot)) > 0.05) continue;
        const dd = Math.abs((r.x - f.px) * f.nx + (r.z - f.pz) * f.nz);
        if (dd < bestD) { bestD = dd; best = j; }
      }
      if (best >= 0) r.fi = best;
    }
    const f = fasader[r.fi];
    if (f && r.ex === undefined) { r.ex = f.ex; r.ez = f.ez; r.nx = f.nx; r.nz = f.nz; }
    if (r.ex === undefined) { r.ex = Math.cos(r.rot || 0); r.ez = -Math.sin(r.rot || 0); }
    if (r.nx === undefined) { r.nx = Math.sin(r.rot || 0); r.nz = Math.cos(r.rot || 0); }
    if (r.basFraMm === undefined) {
      // midtpunktet langs fasadeaksen — fra fasadens eget punkt når vi har det
      const midMm = f ? tilMm((r.x - f.px) * f.ex + (r.z - f.pz) * f.ez)
                      : tilMm(r.tMid || 0);
      const lMm = r.lengdeMm !== undefined ? r.lengdeMm : tilMm(r.lengde || 0);
      r.basFraMm = Math.round(midMm - lMm / 2);
      r.basTilMm = Math.round(midMm + lMm / 2);
    }
    if (r.fx === undefined) {
      const midMm = (r.basFraMm + r.basTilMm) / 2;
      r.fx = r.x - r.ex * tilScene(midMm);
      r.fz = r.z - r.ez * tilScene(midMm);
    }
    if (r.dFra === undefined) r.dFra = 0;
    if (r.dTil === undefined) r.dTil = 0;
    if (r.rev === undefined) r.rev = 0;
    if (r.fraMm === undefined) { r.fraMm = r.basFraMm; r.tilMm = r.basTilMm; }
    if (r.lengdeMm === undefined) r.lengdeMm = Math.round(r.tilMm - r.fraMm);
    if (r.fullMm === undefined) r.fullMm = r.lengdeMm;
    if (r.hoydeMm === undefined) r.hoydeMm = Math.round(tilMm(r.hoyde || 0));
    if (r.bunnMm === undefined) r.bunnMm = Math.round(tilMm(r.y - baseY) - r.hoydeMm / 2);
    if (r.tMm === undefined) r.tMm = Math.round(tilMm(r.tykkelse || 0));
  });
}

// Samme vinkelregel som sw-tegning.js bruker. Duplisert med vilje: migreringen
// skal ikke tvinge inn en import av tegnemodulen (den lastes dynamisk).
export function vinkelDiffLokal(a, b) {
  let d = (Number(a) || 0) - (Number(b) || 0);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Holdepunktene et drag snapper til: fasadens søylepunkter (10 mm fra senter
// og søylekanten) PLUSS skjøtene i de andre radene på samme fasade — de er
// like nyttige å låse mot, og de finnes også for eldre, migrerte vegger som
// ikke har søylepunktene lagret.
export function snappPunkter(v) {
  const ut = (v.snapp || []).slice();     // søylepunktene: 10 mm fra senter + søylekant
  // En ringmurbit snapper mot de ANDRE RINGMURBITENE, et veggelement mot de
  // andre veggelementene — hver liste for seg.
  const b = butikkFor(v);
  const naboer = v.ringmur ? ((b && b.ringmur) || [])
                           : ((b && b.vegger) || []);
  for (const w of naboer) {
    if (w.fi !== v.fi || w.id === v.id) continue;
    // ENDENE AV DE ANDRE VEGGELEMENTENE (Emil 02.09) — både der de STÅR nå
    // og der de opprinnelig ble generert. Da låser en kant seg like godt mot
    // et element du alt har justert som mot den opprinnelige skjøten.
    if (!w.skjult && w.fraMm !== undefined) ut.push(w.fraMm, w.tilMm);
    ut.push(w.basFraMm, w.basTilMm);
  }
  return [...new Set(ut.filter(n => isFinite(n)))];
}

export function loesAlleJusteringer() {
  migrerVegger();
  migrerRingmur();
  // Innerveggene løses UANSETT — også på et bygg som bare har dem. Sto dette
  // etter den tidlige returen under, ville et drag i en innervegg vært dødt på
  // en modell uten yttervegger.
  if (!lagret || !lagret.vegger) { loesInnervegger(); return; }
  const o = lagret.oppsett || STD_OPPSETT;
  const grupper = new Map();
  for (const v of lagret.vegger) {
    if (v.basFraMm === undefined) continue;   // generert av en eldre versjon
    const k = v.fi + "|" + v.radIdx;
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(v);
  }
  for (const liste of grupper.values()) {
    const res = loesRad(liste.map(v => ({
      id: v.id,
      fraMm: v.basFraMm + (v.dFra || 0),
      tilMm: v.basTilMm + (v.dTil || 0),
      rev: v.rev || 0
    })), SW_MIN_BIT_MM);
    for (const v of liste) {
      const r = res.get(v.id);
      if (!r) continue;
      v.skjult = !!r.skjult;
      v.fraMm = Math.round(r.fraMm);
      v.tilMm = Math.round(r.tilMm);
      v.lengdeMm = Math.max(0, Math.round(r.tilMm - r.fraMm));
      const midMm = (r.fraMm + r.tilMm) / 2;
      v.tMid = tilScene(midMm);
      v.x = v.fx + v.ex * v.tMid;
      v.z = v.fz + v.ez * v.tMid;
      // 🏔 SKRÅKAPP: endehøydene leses av taklinja på NYTT etter draget, så et
      // element som strekkes langs en gavl får riktig skråkapp i den nye enden.
      // Uten dette beholdt det høyden fra der det sto da det ble generert.
      const lin = ((lagret.fasader || [])[v.fi] || {}).takLinje;
      if (v.radHMm && lin && lin.length > 1) {
        const rB = v.rBunnMm || 0;
        const tp = takTopp(lin, v.fraMm, v.tilMm, rB, rB + v.radHMm);
        v.toppP = tp; v.hVMm = tp[0][1]; v.hHMm = tp[tp.length - 1][1];
        v.hoydeMm = Math.max(...tp.map(q => q[1]));
        v.skra = toppErSkra(tp, v.radHMm) || undefined;
        if (!v.skra) v.toppP = undefined;
        // Dras et element helt forbi taket, er det ikke lenger noe panel der.
        // Uten dette sto det igjen som en flate med null høyde, og geometrien
        // vrengte seg (Emil 08.09).
        if (v.hoydeMm < 20) v.skjult = true;
        // VINKELEN regnes ÉN gang, her, og leses av både 3D-merkinga, lista og
        // instruksjonstegninga. Regnet tre steder ville de tre tallene før
        // eller siden sagt hver sin ting etter et drag.
        //
        // Den regnes av TAKLINJA over elementets utstrekning, ikke av hVMm/hHMm.
        // Endehøydene er KLIPPET til radbåndet, og et element som dras forbi
        // der taket krysser radbunnen får da en ende på 5 mm — og en vinkel på
        // 25,2° der taket faktisk faller 27,4° (Emil 08.09). Panelet skjæres
        // etter takfallet; høydene forteller hvor høyt det er i hver ende, og
        // vinkelen forteller hvor bratt kuttet er. To spørsmål, to svar.
        // Vinkelen måles på selve SKRÅKUTTET — den bratteste strekningen i
        // overkanten. Målt over hele elementet ville en femkant der bare det
        // ene hjørnet er tatt av gitt 0°.
        v.skraTekst = v.skra ? vinkelTekst(toppVinkel(tp)) : undefined;
        if (lagret.baseY !== undefined)
          v.y = lagret.baseY + tilScene((v.rBunnMm || 0) + v.hoydeMm / 2);
      }
      // Et STREKKET element er ikke kapp — Moelv SW-05 er 6490 mm i et
      // 5980-felt og har ekte nummer. Bare et FORKORTET er kapp.
      v.tilpasset = !!v.tilpassetRad || !!v.skra || v.lengdeMm < v.fullMm - SW_TOL_MM ||
                    (o.kappUnderMm > 0 && v.lengdeMm < o.kappUnderMm);
    }
  }
  // ✥ Ringmuren løses på nøyaktig samme vis. Egen løkke, ikke samme liste:
  // ringmurbitene har ingen SW-nummer, ingen leveransestabel og ingen linje i
  // CSV-lista — de skal ikke gjennom noe av det som følger under.
  loesRingmur();
  loesInnervegger();

  const synlige = lagret.vegger.filter(v => !v.skjult);
  const { numre, nokkel } = swNummerering(synlige);
  for (const v of lagret.vegger) {
    if (v.skjult) { v.sw = ""; continue; }
    if (!v.tilpasset) { v.sw = numre.get(nokkel(v)) || "SW-XX"; continue; }
    v.sw = kappNavn(numre.get(nokkel({ lengdeMm: v.fullMm, hoydeMm: v.hoydeMm })), o.kappTekst);
  }
}

// ✥ Ringmuren løst opp etter de samme reglene som veggradene: én gruppe per
// fasade (radIdx «rm»), samme loesRad, samme minste bit. Biter fra en eldre
// generering mangler basFraMm og hoppes over — de tegnes som før, men kan
// ikke dras før neste generering.
export function loesRingmur() { loesRingmurBiter((lagret && lagret.ringmur) || []); }

export function loesRingmurBiter(biter) {
  if (!biter.length) return;
  const grupper = new Map();
  for (const r of biter) {
    if (r.basFraMm === undefined) continue;
    const k = r.fi + "|rm";
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(r);
  }
  for (const liste of grupper.values()) {
    const res = loesRad(liste.map(r => ({
      id: r.id,
      fraMm: r.basFraMm + (r.dFra || 0),
      tilMm: r.basTilMm + (r.dTil || 0),
      rev: r.rev || 0
    })), SW_MIN_BIT_MM);
    for (const r of liste) {
      const res2 = res.get(r.id);
      if (!res2) continue;
      r.skjult = !!res2.skjult;
      r.fraMm = Math.round(res2.fraMm);
      r.tilMm = Math.round(res2.tilMm);
      r.lengdeMm = Math.max(0, Math.round(res2.tilMm - res2.fraMm));
      const midMm = (res2.fraMm + res2.tilMm) / 2;
      r.tMid = tilScene(midMm);
      r.x = r.fx + r.ex * r.tMid;
      r.z = r.fz + r.ez * r.tMid;
      r.lengde = tilScene(r.lengdeMm);
    }
  }
}

// 🚪 INNERVEGGENE LØSES OPP ETTER DE SAMME REGLENE. Egen løkke, ikke samme
// liste: innerveggene har egen lagring og egen nummerserie, og et drag i den
// ene skal aldri kunne flytte et element i den andre.
//
// Ingen taklinje her — en innervegg er flat, så hele skråkapp-delen av
// `loesAlleJusteringer` faller bort. Ellers er det samme `loesRad`, samme
// minste bit og samme kapp-regel.
export function loesInnervegger() {
  const d = lagretInner;
  if (!d || !(d.vegger || []).length) return;
  const grupper = new Map();
  for (const v of d.vegger) {
    if (v.basFraMm === undefined) continue;
    const k = v.fi + "|" + v.radIdx;
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(v);
  }
  for (const liste of grupper.values()) {
    const res = loesRad(liste.map(v => ({
      id: v.id,
      fraMm: v.basFraMm + (v.dFra || 0),
      tilMm: v.basTilMm + (v.dTil || 0),
      rev: v.rev || 0
    })), SW_MIN_BIT_MM);
    for (const v of liste) {
      const r = res.get(v.id);
      if (!r) continue;
      v.skjult = !!r.skjult;
      v.fraMm = Math.round(r.fraMm);
      v.tilMm = Math.round(r.tilMm);
      v.lengdeMm = Math.max(0, Math.round(r.tilMm - r.fraMm));
      v.tMid = tilScene((r.fraMm + r.tilMm) / 2);
      v.x = v.fx + v.ex * v.tMid;
      v.z = v.fz + v.ez * v.tMid;
      // Et STREKKET element er ikke kapp, bare et FORKORTET.
      v.tilpasset = !!v.tilpassetRad || v.lengdeMm < v.fullMm - SW_TOL_MM;
    }
  }
  loesRingmurBiter(d.ringmur || []);
  nummererInner(d);
}

// Navnet en gammel del A-stabel uten id-sporing kjennes på.
export const GENERERT_SW_NAVN = /^SW-\d{2}$/;

// 📦 BUNKENE BLIR STÅENDE DER DE ER FLYTTET (Emil 08.09, sjekkliste punkt 8).
// byggStabler() river alle stablene og bygger dem opp igjen på den beregnede
// plassen — og da forsvant en times flytting i det Emil trykket «Juster
// elementer». Her tas et øyeblikksbilde av hvor hver stabel står FØR den
// rives, og stabelen settes tilbake dit når den bygges igjen.
//
// NØKKELEN ER STØRRELSEN (lengde × høyde × tykkelse), IKKE SW-nummeret:
// SW-numrene forskyver seg når bygget endres (SW-03 blir SW-04), og da ville
// bunken flyttet seg av seg selv. Størrelsen er den fysiske bunken. En stabel
// hvis størrelse ikke finnes lenger forsvinner; en ny størrelse settes på den
// beregnede plassen. Gjelder både «Juster elementer», ny generering og når
// modellen åpnes igjen (stablene ligger da alt i S.materiell fra lagringen).
export function stabelNokkel(lengde, bredde, tykkelse) {
  return Math.round(Number(lengde) || 0) + "x" + Math.round(Number(bredde) || 0) + "x" + Math.round(Number(tykkelse) || 0);
}
// Leser posisjonene til stablene som er i ferd med å rives: de id-sporede
// (`ider`) og, for del A, de gamle uten id som bare kjennes på navnet.
export function lesStabelPosisjoner(liste, ider, navnMonster) {
  const m = new Map();
  for (const p of liste || []) {
    if (!p || p.maltype !== "sandwich") continue;
    if (!ider.has(p.id) && !(navnMonster && navnMonster.test(p.navn || ""))) continue;
    const k = stabelNokkel(p.lengde, p.bredde, p.tykkelse);
    if (!m.has(k)) m.set(k, { x: p.x, y: p.y, z: p.z, rot: p.rot });
  }
  return m;
}
// Setter en nybygd stabel tilbake der en like stor sto. Én posisjon brukes
// bare én gang, så to like store stabler ikke havner oppå hverandre.
export function settStabelTilbake(pkt, posisjoner) {
  if (!pkt || !posisjoner) return pkt;
  const k = stabelNokkel(pkt.lengde, pkt.bredde, pkt.tykkelse);
  const pos = posisjoner.get(k);
  if (!pos) return pkt;
  posisjoner.delete(k);
  pkt.x = pos.x; pkt.y = pos.y; pkt.z = pos.z; pkt.rot = pos.rot;
  return pkt;
}

// 📦 Leveransestablene i Materiell: én stabel per SW-nummer, satt UTENFOR
// fasaden der elementene skal monteres. Bygges opp på nytt etter hver
// justering, så antallene i Mengder følger med.
export function byggStabler() {
  if (!lagret) return;
  const o = lagret.oppsett || STD_OPPSETT;
  const forrige = lesStabelPosisjoner(S.materiell, new Set(lagret.materiellIder || []), GENERERT_SW_NAVN);
  fjernGenerertMateriell();
  const fasader = lagret.fasader || [];
  const okBetong = lagret.okBetong || 0;
  const perSw = new Map();
  for (const v of lagret.vegger || []) {
    if (v.skjult || !v.sw || v.tilpasset) continue;
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm, antall: 0, fi: v.fi, tSum: 0 });
    const g = perSw.get(v.sw);
    g.antall++;
    g.tSum += v.tMid;
  }
  const nyeIder = [];
  const fasadeRad = new Map();
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0], "no"))) {
    const f = fasader[g.fi] || fasader[0];
    if (!f) continue;
    const rad = fasadeRad.get(g.fi) || 0;
    fasadeRad.set(g.fi, rad + 1);
    const ut = f.off + tilScene(5000) + rad * tilScene(g.hoydeMm + 1500);
    const tMid = Math.max(f.t0 + tilScene(g.lengdeMm) / 2,
      Math.min(f.t1 - tilScene(g.lengdeMm) / 2, g.tSum / g.antall));
    const pkt = vaskMateriell({
      id: "SW-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw, farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: o.tykkelseMm,
      antall: g.antall,
      x: f.px + f.ex * tMid + f.nx * ut,
      y: okBetong,
      z: f.pz + f.ez * tMid + f.nz * ut,
      rot: f.rot
    });
    settStabelTilbake(pkt, forrige);
    if (pkt) { nyeIder.push(pkt.id); S.materiell = (S.materiell || []).concat([pkt]); }
  }
  lagret.materiellIder = nyeIder;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// 📦 LEVERANSESTABLENE FOR INNERVEGGENE (Emil 08.09). Egen funksjon og egne
// navn: to serier som begge starter på SW-01 ville ellers blitt slått sammen i
// Mengder, og tallene ville vært feil for begge. Stabelen heter derfor
// «SW-01 innervegg» — samme nummer som på tegninga, med hvilken vegg det er.
export function byggInnerStabler() {
  const d = lagretInner;
  const forrige = lesStabelPosisjoner(S.materiell, new Set((d && d.materiellIder) || []), null);
  fjernInnerMateriell();
  if (!d || !(d.vegger || []).length) return;
  const perSw = new Map();
  for (const v of d.vegger) {
    if (v.skjult || !v.sw || v.tilpasset) continue;
    if (!perSw.has(v.sw)) perSw.set(v.sw, { lengdeMm: v.lengdeMm, hoydeMm: v.hoydeMm,
      antall: 0, fi: v.fi, tSum: 0, tMm: v.tMm });
    const g = perSw.get(v.sw);
    g.antall++;
    g.tSum += v.tMid;
  }
  const nyeIder = [];
  const fasadeRad = new Map();
  for (const [sw, g] of [...perSw.entries()].sort((a, b) => a[0].localeCompare(b[0], "no"))) {
    const f = (d.fasader || [])[g.fi] || (d.fasader || [])[0];
    if (!f) continue;
    const o = { ...INNER_STD, ...(f.o || {}) };
    const rad = fasadeRad.get(g.fi) || 0;
    fasadeRad.set(g.fi, rad + 1);
    const ut = f.off + tilScene(5000) + rad * tilScene(g.hoydeMm + 1500);
    const tMid = Math.max(f.t0 + tilScene(g.lengdeMm) / 2,
      Math.min(f.t1 - tilScene(g.lengdeMm) / 2, g.tSum / g.antall));
    const pkt = vaskMateriell({
      id: "SWI-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      maltype: "sandwich", navn: sw + " " + t("innervegg"), farge: o.farge,
      lengde: g.lengdeMm, bredde: g.hoydeMm, tykkelse: g.tMm || o.tykkelseMm,
      antall: g.antall,
      x: f.px + f.ex * tMid + f.nx * ut,
      y: (f.okBetong !== undefined ? f.okBetong : innerBaseY()),
      z: f.pz + f.ez * tMid + f.nz * ut,
      rot: f.rot
    });
    settStabelTilbake(pkt, forrige);
    if (pkt) { nyeIder.push(pkt.id); S.materiell = (S.materiell || []).concat([pkt]); }
  }
  d.materiellIder = nyeIder;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// Rydder BARE innerveggenes stabler, og gjør det på ID — ikke på navnet.
// Del A må lete etter navn i tillegg, fordi gamle versjoner ikke sporet id-ene.
// Innerveggene har hatt id-sporing fra første runde, og et navnemønster ville
// dessuten sluttet å treffe så snart noen byttet språk: stabelnavnet er
// oversatt. Ryddingen skjer FØR `skrivInner` fjerner nøkkelen, så id-ene
// finnes alltid når de trengs.
export function fjernInnerMateriell() {
  const ider = new Set((lagretInner && lagretInner.materiellIder) || []);
  if (!ider.size) return;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(pkt => !ider.has(pkt.id));
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

// Begge seriene. Kalles der del A før kalte byggStabler() alene, så antallene
// i Mengder følger med etter hver generering og hvert drag.
export function byggAlleStabler() {
  byggStabler();
  byggInnerStabler();
}

export function fjernGenerertMateriell() {
  // Fjerner både de id-sporede stablene fra forrige generering OG alle
  // sandwich-stabler med SW-nummer-navn: tidligere versjoner sporet ikke
  // id-ene, og de gamle stablene ble liggende igjen for hver generering —
  // det var derfor 3D-en fløt over av SW-stabler fra gamle kjøringer
  // (avlest rett fra localStorage i nettleseren, 01.09).
  const ider = new Set((lagret && lagret.materiellIder) || []);
  const generertNavn = GENERERT_SW_NAVN;
  const foer = (S.materiell || []).length;
  S.materiell = (S.materiell || []).filter(p =>
    !ider.has(p.id) && !(p.maltype === "sandwich" && generertNavn.test(p.navn || "")));
  if ((S.materiell || []).length === foer) return;
  tegnMateriell();
  lagreMateriellLokalt();
  S.qtyCache = null;
}

export function fjernAltGenerert() {
  fjernGenerertMateriell();
  const o = oppsett();
  settLagret({ oppsett: o, vegger: [], gulv: null, ringmur: null, materiellIder: [],
               blikk: { pa: false, just: {}, ekstra: [], nesteNr: 1 } });
  skrivLagret();
  tegnAlt();
  tegnPanel();
}

// ---------- CSV ----------
// ═══════════════════ 🧾 MATERIELL-ARKET (Emil 08.09, punkt 5) ═══════════════════
// Reglene bor i js/sw-materiell.js (rene tall, testet i Node). Her bygges bare
// INNDATAENE: én vegg per fasade i del A og én per innervegg-bein, med
// elementene som står synlige, skjøtene, hjørnene og åpningene på veggen.

// Hjørnene finnes fra geometrien: to fasadeender i samme punkt er ett hjørne.
// Hjørnet TELLES BARE ÉN GANG (ett hjørnebeslag dekker begge fasadene) — den
// fasaden med lavest indeks eier det. En fri ende teller også én gang.
// Fasadene: { px, pz, ex, ez, t0, t1 }. Returnerer per fasade
// { hjorneStart, hjorneSlutt, loddretteKanter }. Ren funksjon, testes i Node.
export function fasadeHjorner(fasader, tol) {
  const f = fasader || [];
  const tl = Number(tol) > 0 ? Number(tol) : 1e-6;
  const ende = (a, t) => ({ x: a.px + a.ex * t, z: a.pz + a.ez * t });
  const ender = f.map(a => [ende(a, a.t0), ende(a, a.t1)]);
  const naer = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) <= tl;
  return f.map((a, i) => {
    let kanter = 0;
    const hj = [false, false];
    for (let k = 0; k < 2; k++) {
      const p = ender[i][k];
      let minIdx = i;
      for (let j = 0; j < f.length; j++) {
        if (j === i) continue;
        if (naer(p, ender[j][0]) || naer(p, ender[j][1])) { hj[k] = true; if (j < minIdx) minIdx = j; }
      }
      // fri ende: teller én gang. Hjørne: teller én gang, hos eieren.
      if (!hj[k] || minIdx === i) kanter++;
    }
    return { hjorneStart: hj[0], hjorneSlutt: hj[1], loddretteKanter: kanter };
  });
}

// Veggene til Materiell-arket, bygd av det som ligger lagret. `navnFn(f, i)`
// gir kolonnenavnet.
export function materiellVeggerFra(fasader, vegger, apninger, navnFn, tykkelseFn) {
  const hj = fasadeHjorner(fasader, tilScene(600));
  return (fasader || []).map((f, fi) => {
    const egne = (vegger || []).filter(v => v && v.fi === fi && !v.ringmur);
    const synlige = egne.filter(v => !v.skjult);
    const hoydeMm = egne.length ? Math.max(...egne.map(v => (v.rBunnMm || 0) + (v.hoydeMm || 0))) : 0;
    const skjot = f.skjot && f.skjot.length >= 2 ? f.skjot
      : [Math.round(tilMm(f.t0)), Math.round(tilMm(f.t1))];
    const lengdeMm = skjot[skjot.length - 1] - skjot[0];
    return {
      navn: navnFn(f, fi), hoydeMm, lengdeMm, tykkelseMm: tykkelseFn(f), skjot,
      // veggfeltets underkant, til regelen om den fjerde siden
      bunnMm: 0,
      hjorneStart: hj[fi].hjorneStart, hjorneSlutt: hj[fi].hjorneSlutt,
      loddretteKanter: hj[fi].loddretteKanter,
      elementer: synlige.map(v => ({ fraMm: v.fraMm, tilMm: v.tilMm, skjult: false })),
      utsparinger: (apninger || []).filter(a => a && a.fi === fi).map(a => ({
        type: a.type,
        // bunnen sendes RÅ (kan være under veggfeltet, som en glassfasade
        // fra gulvet): beslagSider trenger å se det
        bunnMm: a.bunnMm,
        breddeMm: Math.max(0, a.tilMm_ - a.fraMm),
        // «full høyde» (±1e9) klippes til veggen; bunnen under gulvet til gulvet
        hoydeMm: Math.max(0, Math.min(Math.abs(a.toppMm) > 1e8 ? hoydeMm : a.toppMm, hoydeMm) - Math.max(a.bunnMm, 0))
      }))
    };
  });
}

export function materiellArk() {
  const o = oppsett();
  const vegger = [];
  if (lagret && (lagret.fasader || []).length)
    vegger.push(...materiellVeggerFra(lagret.fasader, lagret.vegger, utspPaFasader(),
      (f, fi) => t("Fasade {0}", fi + 1), () => o.tykkelseMm));
  const d = innerData();
  if ((d.fasader || []).length)
    vegger.push(...materiellVeggerFra(d.fasader, d.vegger, d.utspVis || [],
      (f, fi) => f.navn || t("Innervegg {0}", fi + 1),
      (f) => ((f.o || {}).tykkelseMm !== undefined ? f.o.tykkelseMm : INNER_STD.tykkelseMm)));
  return { navn: t("Materiell"), rader: materiellRader(materiellListe(vegger, o), t) };
}

export function lastNedListe() {
  if (!lagret || !(lagret.vegger || []).length) { alert(t("Generer veggelementene først.")); return; }
  const o = lagret.oppsett;
  const rader = swListeRader(lagret.vegger.filter(v => !v.skjult), {
    prosjekt: o.prosjekt, oppdragsnr: o.oppdragsnr, sted: o.sted, sign: o.sign,
    dato: new Date().toLocaleDateString("no-NO"),
    tykkelseMm: o.tykkelseMm, isolasjon: o.isolasjon,
    utvFarge: o.utvFarge, innFarge: o.innFarge
  });
  // 📊 EKTE EXCEL-FIL, ikke CSV (Emil 03.09): CSV-en var riktig på PC-en og
  // feil i mailen, fordi Excel på nett og Outlook alltid leser «,» som
  // skilletegn. Se lastNedXlsx i elements.js.
  const navn = (S.fileName || "modell").replace(/\.(ifc|glb)$/i, "");
  // 🧾 + arket «Materiell» i samme fil (punkt 5)
  // 🩹 + arket «Blikk», regnet av de SYNLIGE elementene (runde 1, 17.09).
  lastNedXlsxFlere(navn + " - SW-liste.xlsx",
    [{ navn: t("SW-liste"), rader }, materiellArk(), blikkArk(), takArk()].filter(Boolean))
    .catch(err => {
      console.warn("SW-lista kunne ikke lages:", err);
      alert(t("Klarte ikke å lage Excel-fila: ") + (err && err.message || err));
    });
}

// ---------- Panelet ----------
export function felt(id, label, verdi, type) {
  return '<label>' + t(label) +
    '<input type="' + (type || "number") + '" id="' + id + '" value="' + esc(String(verdi)) + '"' +
    (type === "text" ? ' maxlength="60"' : ' step="10" min="0" max="30000"') + '></label>';
}

export function lesOppsettFraPanel() {
  const o = oppsett();
  const num = (id, std) => { const n = Number(($(id) || {}).value); return isFinite(n) && n >= 0 ? n : std; };
  const txt = (id) => (($(id) || {}).value || "").trim();
  o.betongMm = num("swBetong", o.betongMm);
  o.isoMm = num("swIso", o.isoMm);
  o.utstikkMm = num("swUtstikk", o.utstikkMm);
  o.ringmur = !!($("swRingmur") || {}).checked;
  o.ringHoydeMm = num("swRingH", o.ringHoydeMm);
  o.tykkelseMm = Math.max(30, Math.min(500, num("swTykk", o.tykkelseMm)));
  o.radHoyder = (($("swRadH") || {}).value || "").trim();
  o.kappNederst = !!($("swKappNed") || {}).checked;
  if ($("swFolgTak")) o.folgTak = !!$("swFolgTak").checked;
  o.klaringMm = Math.max(0, Math.min(100, num("swKlaring", o.klaringMm)));
  o.minFeltMm = Math.max(0, Math.min(6000, num("swMinFelt", o.minFeltMm)));
  o.minSkraMm = Math.max(0, Math.min(3000, num("swMinSkra", o.minSkraMm)));
  o.kappUnderMm = Math.max(0, Math.min(6000, num("swKappUnder", o.kappUnderMm)));
  if ($("swKappTekst")) o.kappTekst = $("swKappTekst").value;
  if ($("swVisUtsp")) o.visUtsp = !!$("swVisUtsp").checked;
  o.farge = ($("swFarge") || {}).value || o.farge;
  o.isolasjon = txt("swIsoType") || o.isolasjon;
  o.utvFarge = txt("swUtvF");
  o.innFarge = txt("swInnF");
  o.prosjekt = txt("swProsjekt");
  o.oppdragsnr = txt("swOppdrag");
  o.sted = txt("swSted");
  o.sign = txt("swSign");
  if ($("swSkumTykk")) o.skumUtbytteTykkM = Math.max(1, Math.min(100, num("swSkumTykk", o.skumUtbytteTykkM)));
  if ($("swSkumTynn")) o.skumUtbytteTynnM = Math.max(1, Math.min(100, num("swSkumTynn", o.skumUtbytteTynnM)));
  if ($("swPdfFase")) {
    o.pdfFase = txt("swPdfFase");
    o.pdfTittel = txt("swPdfTittel");
    o.pdfNr = txt("swPdfNr") || "SW-01";
    o.pdfProsjekt = txt("swPdfProsjekt");
    o.pdfUndertittel = txt("swPdfUnder");
    o.pdfOppdrag = txt("swPdfOppdrag");
    o.pdfTegnet = txt("swPdfTegnet");
    o.pdfKontroll = txt("swPdfKontroll");
    o.pdfGodkjent = txt("swPdfGodkjent");
    o.pdfDato = txt("swPdfDato");
    o.pdfMerknad = (($("swPdfMerknad") || {}).value || "").trim();
  }
  skrivLagret();
  return o;
}
