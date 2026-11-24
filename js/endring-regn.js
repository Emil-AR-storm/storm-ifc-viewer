// 🔴 ENDRINGSVARSEL – reglene (rene funksjoner, ingen nett og ingen skjerm).
// Brukes av js/endringsvarsel.js og prøves i _test/test-endringsvarsel.mjs.

const tekst = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 80);

// Hvem lagret fila sist? Fra Graph: lastModifiedBy.user { id, displayName, email }.
// Er det meg? Sammenlignes på konto-id (Entra), ellers på navnet.
export function erMeg(av, meg) {
  if (!av || !meg) return false;
  if (av.id && meg.id) return String(av.id).toLowerCase() === String(meg.id).toLowerCase();
  return !!av.navn && !!meg.navn && av.navn.trim().toLowerCase() === meg.navn.trim().toLowerCase();
}
export function avFraGraph(item) {
  const u = item && item.lastModifiedBy && item.lastModifiedBy.user;
  return u ? { id: tekst(u.id, 60), navn: tekst(u.displayName, 80) } : null;
}

// Hva er nytt i markeringene? lokale = det vi har (S.comments), eksterne = fila
// i SharePoint nå, kjente = id-ene som sto i fila sist vi leste den (for å se
// slettinger – en markering vi har laget selv og ikke rukket å lagre, er ikke
// «slettet av noen»). filAv = den som lagret fila sist (når markeringen ikke
// selv sier hvem).
// Svar: [{ type: "ny"|"status"|"svar"|"endret"|"slettet", id, tittel, av }]
export function markeringEndringer(lokale, eksterne, kjente, filAv, statusAv) {
  const ut = [];
  const lok = new Map((lokale || []).filter(Boolean).map(c => [String(c.id), c]));
  const eks = new Map((eksterne || []).filter(Boolean).map(c => [String(c.id), c]));
  const navn = (c) => tekst(c && c.text, 60);
  const st = (c) => (statusAv ? statusAv(c) : (c && c.status)) || "Åpen";
  for (const [id, e] of eks) {
    const l = lok.get(id);
    if (!l) { ut.push({ type: "ny", id, tittel: navn(e), av: tekst(e.author, 80) || filAv }); continue; }
    const sl = (l.svar || []).length, se = (e.svar || []).length;
    if (se > sl) { const s = e.svar[se - 1] || {}; ut.push({ type: "svar", id, tittel: navn(e), av: tekst(s.av || s.author, 80) || filAv }); continue; }
    if (st(e) !== st(l)) { ut.push({ type: "status", id, tittel: navn(e), status: st(e), av: filAv }); continue; }
    const felt = ["text", "owner", "due", "farge"];
    if (felt.some(k => String(e[k] || "") !== String(l[k] || "")) ||
        (e.bilder || []).length !== (l.bilder || []).length || (e.bilderEtter || []).length !== (l.bilderEtter || []).length)
      ut.push({ type: "endret", id, tittel: navn(e), av: filAv });
  }
  const kj = kjente instanceof Set ? kjente : new Set(kjente || []);
  for (const [id, l] of lok) if (!eks.has(id) && kj.has(id)) ut.push({ type: "slettet", id, tittel: navn(l), av: filAv });
  return ut;
}

// Én linje per endring, til stripa og lista. t = oversettelsen.
export function endringLinje(e, t) {
  const tr = t || ((s, ...a) => a.reduce((x, v, i) => x.replace("{" + i + "}", v), s));
  switch (e.type) {
    case "ny": return tr("Ny markering: «{0}»", e.tittel);
    case "svar": return tr("Nytt svar på «{0}»", e.tittel);
    case "status": return tr("«{0}» satt til {1}", e.tittel, tr(e.status || ""));
    case "slettet": return tr("Markering slettet: «{0}»", e.tittel);
    case "endret": return tr("Markering endret: «{0}»", e.tittel);
    default: return tr("{0} er endret", tr(e.navn || ""));
  }
}

// Stripa: kort oppsummering per person. «Steffen: 2 nye markeringer, riggen
// endret · Simen: 1 satt til Løst»
export function oppsummering(endringer, t) {
  const tr = t || ((s, ...a) => a.reduce((x, v, i) => x.replace("{" + i + "}", v), s));
  const per = new Map();
  for (const e of endringer || []) {
    const hvem = e.av || tr("Noen");
    if (!per.has(hvem)) per.set(hvem, { ny: 0, status: 0, svar: 0, endret: 0, slettet: 0, annet: [] });
    const p = per.get(hvem);
    if (e.type in p && e.type !== "annet") p[e.type]++;
    else p.annet.push(e.navn);
  }
  const deler = [];
  for (const [hvem, p] of per) {
    const d = [];
    if (p.ny) d.push(p.ny === 1 ? tr("1 ny markering") : tr("{0} nye markeringer", p.ny));
    if (p.svar) d.push(p.svar === 1 ? tr("1 nytt svar") : tr("{0} nye svar", p.svar));
    if (p.status) d.push(p.status === 1 ? tr("1 ny status") : tr("{0} nye statuser", p.status));
    if (p.endret) d.push(p.endret === 1 ? tr("1 markering endret") : tr("{0} markeringer endret", p.endret));
    if (p.slettet) d.push(p.slettet === 1 ? tr("1 markering slettet") : tr("{0} markeringer slettet", p.slettet));
    for (const n of p.annet) d.push(tr("{0} endret", tr(n || "")));
    deler.push(hvem + ": " + d.join(", "));
  }
  return deler.join(" · ");
}
