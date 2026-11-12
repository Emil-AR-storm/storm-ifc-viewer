// 🔀 FLETTING AV DELTE MARKERINGER (runde G, 12.11.2026)
//
// BYGGEPLAN-Storm-IFC-avvik-sammenligning-2026-11-12.md, punkt 2. Storm
// Prosjekter skriver nå i den samme fila (IFC-modeller/Markeringer/
// <modell>.markeringer.json): status, owner, due, svar, endret og endretAv.
//
// FEILEN SOM BLE RETTET: doPush hentet en fersk eTag rett før PUT og skrev så
// hele S.comments fra minnet. Hadde noen skrevet i fila siden denne økta sist
// leste den, forsvant endringen deres uten feilmelding — fersk eTag og gammelt
// innhold beskytter ingenting. Nå leses fila og flettes FØR hver skriving, og
// eTag-en fra den samme lesingen brukes i If-Match.
//
// TREVEIS FLETTING per markering. «sist» er hver markering slik den så ut sist
// vi leste eller skrev fila (JSON, vasket):
//   • bare vi har endret den        → vår
//   • bare fila er endret           → filas
//   • begge (eller ingen grunnlinje) → nyeste `endret` vinner (tolket som tid,
//     ikke sammenlignet som tekst); likt → filas
//   • svar slås alltid sammen på id, så to svar skrevet samtidig beholdes begge
//   • en markering som bare finnes lokalt, beholdes (som før)
//   • en markering VI har slettet (fantes i grunnlinjen, ikke lokalt) og som
//     ingen har endret i fila siden, blir borte. Ellers tas den med fra fila.
//
// Ren: ingen DOM, ingen nett. Prøves i _test/test-markering-flett.mjs.

// «12.11.2026, 10:15» (naaTekst / toLocaleString no-NO), «12.11.2026 kl. 10:15»,
// «12.11.2026» og ISO. Ukjent/tomt → 0.
export function tolkTid(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return 0;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(?:kl\.?\s*)?(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?)?/.exec(t);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
  const iso = Date.parse(t);
  return isFinite(iso) ? iso : 0;
}
const tidFor = (c) => tolkTid(c && (c.endret || c.date));
const svarI = (c) => (c && Array.isArray(c.svar) ? c.svar : []);

// Svarene fra begge, på id. Samme id begge steder: den som er endret sist.
// baseIder (valgfri): svarene som fantes i grunnlinjen. Et svar som fantes
// der, men mangler på den ene siden, er SLETTET der – og blir ikke hentet
// tilbake fra den andre.
export function flettSvar(a, b, baseIder) {
  const base = baseIder instanceof Set ? baseIder : null;
  const ia = new Set(svarI(a).filter(s => s && s.id != null).map(s => String(s.id)));
  const ib = new Set(svarI(b).filter(s => s && s.id != null).map(s => String(s.id)));
  const slettet = (k) => !!base && base.has(k) && !(ia.has(k) && ib.has(k));
  const ut = new Map();
  for (const s of svarI(a)) if (s && s.id != null && !slettet(String(s.id))) ut.set(String(s.id), s);
  for (const s of svarI(b)) {
    if (!s || s.id == null || slettet(String(s.id))) continue;
    const k = String(s.id), f = ut.get(k);
    if (!f || tolkTid(s.endret || s.dato) > tolkTid(f.endret || f.dato)) ut.set(k, s);
  }
  return [...ut.values()];
}

// lokal, remote: lister av markeringer. sist: Map(id → JSON) eller null.
// norm: vaskfunksjonen (vaskMarkering) – gir lik JSON for likt innhold.
// Svar: { liste, lokaleVant } – liste i filas rekkefølge, lokale nye bakerst.
// lokaleVant: id-er der vår versjon (eller noe bare vi har) står i lista,
// altså det fila mangler – da må det skrives.
export function flettMarkeringer(lokal, remote, sist, norm) {
  const n = typeof norm === "function" ? norm : (x) => x;
  const J = (x) => { try { return JSON.stringify(n(x)); } catch (_) { return ""; } };
  const base = sist instanceof Map ? sist : new Map();
  const lok = new Map();
  for (const c of lokal || []) if (c && c.id != null) lok.set(String(c.id), c);
  const ut = [], lokaleVant = [];
  const sett = new Set();
  for (const r of remote || []) {
    if (!r || r.id == null) continue;
    const k = String(r.id);
    sett.add(k);
    const l = lok.get(k), b = base.has(k) ? base.get(k) : null;
    if (!l) {
      // Slettet her? (fantes i grunnlinjen, og fila er ikke endret siden)
      if (b != null && J(r) === b) continue;
      ut.push(r);
      continue;
    }
    const lEndret = b == null || J(l) !== b, rEndret = b == null || J(r) !== b;
    let vinner;
    if (!lEndret) vinner = r;
    else if (!rEndret) vinner = l;
    else vinner = tidFor(l) > tidFor(r) ? l : r;
    let baseSvar = null;
    if (b != null) { try { baseSvar = new Set(svarI(JSON.parse(b)).map(x => String(x && x.id))); } catch (_) { baseSvar = null; } }
    const svar = flettSvar(r, l, baseSvar);
    if (svar.length || svarI(vinner).length) vinner = Object.assign({}, vinner, { svar });
    if (J(vinner) !== J(r)) lokaleVant.push(k);
    ut.push({ vinner, lokal: l });
  }
  // Bare lokalt: beholdes
  for (const [k, l] of lok) if (!sett.has(k)) { ut.push({ vinner: l, lokal: l }); lokaleVant.push(k); }
  return {
    liste: ut.map(x => (x && x.vinner ? x : { vinner: x, lokal: null })),
    lokaleVant
  };
}
