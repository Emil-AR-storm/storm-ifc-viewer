/* ==================================================================
   sprak.js — Storm Prosjekter 4.42 (12.11.2026)
   Språk på nettsiden: norsk, engelsk, polsk og litauisk.
   - Knappen «Språk» står ved siden av QR og lys/mørk. Valget lagres på
     brukeren (Brukere.Sprak) og på enheten (sp_sprak), så det følger deg
     til telefonen.
   - Oversettelsen skjer i nettleseren: hver tekst på siden slås opp i
     ordboka (js/sprak-ordbok.js). Det brukerne selv har skrevet (navn,
     notater, svar, malenes spørsmål) står ikke i ordboka og blir stående
     på språket det ble skrevet på.
   - Ordboka lastes bare når et annet språk enn norsk er valgt.
   - PDF: knappen «Språk» ved hver PDF velger språket på dokumentet,
     uavhengig av nettsiden. Polsk og litauisk bruker en innebygd skrift
     (js/pdf-font.js) fordi standardskriften i jsPDF mangler ą, č, ę osv.
================================================================== */

const SPRAK_LISTE = [
  { kode: 'no', navn: 'Norsk', html: 'nb' },
  { kode: 'en', navn: 'English', html: 'en' },
  { kode: 'pl', navn: 'Polski', html: 'pl' },
  { kode: 'lt', navn: 'Lietuvių', html: 'lt' }
];
const SPRAK_KODER = SPRAK_LISTE.map(s => s.kode);
const SPRAK_ORD_KNAPP = { no: 'Språk', en: 'Language', pl: 'Język', lt: 'Kalba' };

const Sprak = (() => {
  const lesL = (k, std) => { try { return localStorage.getItem(k) || std; } catch (_) { return std; } };
  const skrivL = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const gyldig = k => SPRAK_KODER.includes(k) ? k : 'no';

  let aktiv = gyldig(lesL('sp_sprak', 'no'));
  let ordbokLastet = typeof SPRAK_ORD !== 'undefined';
  let ordbokLaster = null;
  const TAB = {};             // språk -> { eksakt: Map, monstre: [] }
  const CACHE = {};           // språk -> Map(norsk -> oversatt | null)

  /* ---------- ordboka ---------- */
  function lastOrdbok() {
    if (ordbokLastet) return Promise.resolve();
    if (!ordbokLaster) ordbokLaster = new Promise((ok, feil) => {
      const s = document.createElement('script'); s.src = 'js/sprak-ordbok.js?v=4511';
      s.onload = () => { ordbokLastet = true; ok(); };
      s.onerror = () => { ordbokLaster = null; feil(new Error('Klarte ikke å laste ordboka')); };
      document.head.appendChild(s);
    });
    return ordbokLaster;
  }

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const harBokstav = s => /\p{L}/u.test(s);

  /** Oversettelsesmal → liste med deler: tekst, {} (neste verdi), {p:a|b}, {P:a|b} */
  function malDeler(ut) {
    const d = []; const re = /\{\}|\{([pP]):([^|}]*)\|([^}]*)\}/g; let i = 0, m;
    while ((m = re.exec(ut))) {
      if (m.index > i) d.push(ut.slice(i, m.index));
      d.push(m[0] === '{}' ? { v: 1 } : { p: m[1] === 'p' ? 1 : 2, en: m[2], fl: m[3] });
      i = re.lastIndex;
    }
    if (i < ut.length) d.push(ut.slice(i));
    return d;
  }

  function bygg(lang) {
    if (TAB[lang] || !ordbokLastet) return TAB[lang];
    const O = SPRAK_ORD, ut = O[lang];
    const eksakt = new Map(), monstre = [];
    O.n.forEach((n, i) => {
      const t = ut[i]; if (!t) return;
      if (!n.includes('{}')) { if (!eksakt.has(n)) eksakt.set(n, t); return; }
      const lit = n.split('{}');
      const bokst = lit.join('').replace(/[^\p{L}]/gu, '').length;
      if (bokst < 2) return;                                    // f.eks. «{} {}» – for løst
      const lengst = lit.reduce((a, b) => b.length > a.length ? b : a, '');
      const deler = malDeler(t), suffiks = new Set(); let k = 0;
      for (const d of deler) { if (typeof d === 'string') continue; if (d.v) k++; else if (d.p === 1) suffiks.add(k++); }
      monstre.push({
        re: new RegExp('^' + lit.map(esc).join('([\\s\\S]*?)') + '$'),
        lengst, bokst, kort: bokst < 12, deler, suffiks,
        // {} rett etter/foran en bokstav («Sammenligning{}»): det dynamiske skal ikke fortsette ordet
        foran: lit.slice(0, -1).map(x => /\p{L}$/u.test(x)), bak: lit.slice(1).map(x => /^\p{L}/u.test(x))
      });
    });
    monstre.sort((a, b) => b.bokst - a.bokst);                  // mest spesifikke først
    return (TAB[lang] = { eksakt, monstre });
  }

  /* ---------- datoord (fra toLocaleDateString('nb-NO')) ---------- */
  const DATO = {
    en: { mandag: 'Monday', tirsdag: 'Tuesday', onsdag: 'Wednesday', torsdag: 'Thursday', fredag: 'Friday', lørdag: 'Saturday', søndag: 'Sunday',
      man: 'Mon', tir: 'Tue', ons: 'Wed', tor: 'Thu', fre: 'Fri', lør: 'Sat', søn: 'Sun',
      januar: 'January', februar: 'February', mars: 'March', april: 'April', mai: 'May', juni: 'June', juli: 'July', august: 'August', september: 'September', oktober: 'October', november: 'November', desember: 'December',
      jan: 'Jan', feb: 'Feb', apr: 'Apr', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', okt: 'Oct', nov: 'Nov', des: 'Dec', kl: 'at' },
    pl: { mandag: 'poniedziałek', tirsdag: 'wtorek', onsdag: 'środa', torsdag: 'czwartek', fredag: 'piątek', lørdag: 'sobota', søndag: 'niedziela',
      man: 'pon', tir: 'wt', ons: 'śr', tor: 'czw', fre: 'pt', lør: 'sob', søn: 'niedz',
      januar: 'stycznia', februar: 'lutego', mars: 'marca', april: 'kwietnia', mai: 'maja', juni: 'czerwca', juli: 'lipca', august: 'sierpnia', september: 'września', oktober: 'października', november: 'listopada', desember: 'grudnia',
      jan: 'sty', feb: 'lut', apr: 'kwi', jun: 'cze', jul: 'lip', aug: 'sie', sep: 'wrz', okt: 'paź', nov: 'lis', des: 'gru', kl: 'godz.' },
    lt: { mandag: 'pirmadienis', tirsdag: 'antradienis', onsdag: 'trečiadienis', torsdag: 'ketvirtadienis', fredag: 'penktadienis', lørdag: 'šeštadienis', søndag: 'sekmadienis',
      man: 'pirm', tir: 'antr', ons: 'treč', tor: 'ketv', fre: 'penkt', lør: 'šešt', søn: 'sekm',
      januar: 'sausio', februar: 'vasario', mars: 'kovo', april: 'balandžio', mai: 'gegužės', juni: 'birželio', juli: 'liepos', august: 'rugpjūčio', september: 'rugsėjo', oktober: 'spalio', november: 'lapkričio', desember: 'gruodžio',
      jan: 'saus', feb: 'vas', apr: 'bal', jun: 'birž', jul: 'liep', aug: 'rugp', sep: 'rugs', okt: 'spal', nov: 'lapkr', des: 'gruod', kl: 'val.' }
  };
  /** Bare rene datoer («tirsdag 12. november 2026», «tir. 12.11») – aldri vanlig tekst */
  function datoOrd(s, lang) {
    const tab = DATO[lang]; if (!tab) return null;
    let treff = 0;
    const ut = s.replace(/\p{L}+/gu, w => {
      const t = tab[w.toLowerCase()]; if (!t) return w;
      treff++; return w[0] !== w[0].toLowerCase() ? t[0].toUpperCase() + t.slice(1) : t;
    });
    if (!treff) return null;
    const rest = s.replace(/\p{L}+/gu, w => tab[w.toLowerCase()] ? '' : w);
    return harBokstav(rest) ? null : ut;
  }

  /* ---------- oppslag ---------- */
  function slaOpp(s, lang, dybde) {
    const T = bygg(lang); if (!T) return null;
    const c = CACHE[lang] || (CACHE[lang] = new Map());
    if (c.has(s)) return c.get(s);
    let ut = T.eksakt.get(s);
    if (ut === undefined) {
      ut = monster(T, s, lang, dybde);
      if (ut === null) { const u2 = monster(T, ' ' + s, lang, dybde); if (u2 !== null) ut = u2.replace(/^\s+/, ''); }   // ikon foran teksten: «{} Du har …»
      if (ut === null) ut = datoOrd(s, lang);
      if (ut === null && dybde < 3) ut = reserve(s, lang, dybde);
    }
    if (c.size > 8000) c.clear();
    c.set(s, ut);
    return ut;
  }
  function monster(T, s, lang, dybde) {
    for (const m of T.monstre) {
      if (m.lengst && !s.includes(m.lengst)) continue;
      const r = m.re.exec(s); if (!r) continue;
      const g = r.slice(1);
      // korte maler skal ikke sluke vanlig tekst; norske flertallsendelser er høyst 3 bokstaver
      if (g.some((x, i) => m.suffiks.has(i) ? !/^\p{L}{0,3}$/u.test(x)
        : (m.foran[i] && /^\p{L}/u.test(x)) || (m.bak[i] && /\p{L}$/u.test(x)) || (m.kort && (x.length > 40 || (x.match(/ /g) || []).length > 5)))) continue;
      return fyll(m.deler, g, lang, dybde);
    }
    return null;
  }
  /** Når hele teksten ikke finnes: prøv uten tegn/tall bak («Alle 3», «Pågående ▾», «Lagret.»), og setning for setning */
  function reserve(s, lang, dybde) {
    const deler = s.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
    if (deler.length > 1) {
      let endret = false;
      const ut = deler.map(d => { const t = slaOpp(d, lang, dybde + 1); if (t !== null) { endret = true; return t; } return d; });
      return endret ? ut.join(' ') : null;
    }
    if (s.includes(' · ')) {                       // «3 på jobb · 1 kjøretøy · Kari»
      let endret = false;
      const ut = s.split(' · ').map(d => { const t = d.trim() ? slaOpp(d, lang, dybde + 1) : null; if (t !== null) { endret = true; return t; } return d; });
      if (endret) return ut.join(' · ');
    }
    const m = s.match(/^([\s\S]*?\p{L}[\s\S]*?)(\s*[.:!?]|\s+\(?[\d\s.,%/]+\)?|\s+[^\p{L}\d\s]+)$/u);
    if (m) { const h = slaOpp(m[1], lang, dybde + 1); if (h !== null) return h + m[2]; }
    return null;
  }
  function fyll(deler, g, lang, dybde) {
    let i = 0, sist = '';
    return deler.map(d => {
      if (typeof d === 'string') return d;
      if (d.v) return del(g[i++] ?? '', lang, dybde + 1);
      if (d.p === 1) sist = g[i++] ?? '';
      return sist.trim() ? d.fl : d.en;
    }).join('');
  }
  /** Dynamisk del i en mal: oversettes også (f.eks. «Pågående» i «Status: {}») */
  function del(v, lang, dybde) {
    if (dybde > 2 || !v || !harBokstav(v)) return v;
    return oversettTil(v, lang, dybde);
  }

  /** Oversetter én streng, beholder mellomrom foran og bak */
  function oversettTil(raw, lang, dybde = 0) {
    if (lang === 'no' || typeof raw !== 'string' || !raw || !harBokstav(raw)) return raw;
    const pre = raw.match(/^\s*/)[0], post = raw.match(/\s*$/)[0];
    const midt = raw.slice(pre.length, raw.length - post.length);
    if (!midt) return raw;
    const ut = slaOpp(midt.replace(/\s+/g, ' '), lang, dybde);   // HTML slår sammen mellomrom uansett
    return ut === null ? raw : pre + ut + post;
  }

  /* ---------- DOM ---------- */
  const HOPP_OVER = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, svg: 1, SVG: 1, TEMPLATE: 1 };
  const HOPP_INNHOLD = { TEXTAREA: 1, CODE: 1, PRE: 1 };
  const TEKST_ATTR = ['title', 'placeholder', 'aria-label', 'alt'];
  const origTekst = new WeakMap();   // tekstnode -> { o: norsk, t: sist skrevet }
  const origAttr = new WeakMap();    // element -> { attr: { o, t } }
  let observer = null;

  function tekstnode(n) {
    let r = origTekst.get(n);
    if (!r || n.nodeValue !== r.t) {          // ny node, eller appen har skrevet ny tekst
      if (!n.nodeValue || !harBokstav(n.nodeValue)) { origTekst.delete(n); return; }
      r = { o: n.nodeValue, t: n.nodeValue }; origTekst.set(n, r);
      const p = n.parentNode;                 // <option> uten value: behold norsk verdi for koden
      if (p && p.nodeName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.textContent.trim());
    }
    const ny = oversettTil(r.o, aktiv);
    if (n.nodeValue !== ny) n.nodeValue = ny;
    r.t = ny;
  }
  function attributter(el) {
    let lag = origAttr.get(el);
    for (const a of TEKST_ATTR) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      if (!lag) { lag = {}; origAttr.set(el, lag); }
      let r = lag[a];
      if (!r || v !== r.t) { if (!harBokstav(v)) continue; r = lag[a] = { o: v, t: v }; }
      const ny = oversettTil(r.o, aktiv);
      if (v !== ny) el.setAttribute(a, ny);
      r.t = ny;
    }
  }
  function gaa(el) {
    if (!el) return;
    if (el.nodeType === 3) { const p = el.parentNode; if (p && !stengt(p)) tekstnode(el); return; }
    if (el.nodeType !== 1 || HOPP_OVER[el.nodeName]) return;
    if (el.hasAttribute('data-ingen-oversettelse')) return;
    attributter(el);
    if (HOPP_INNHOLD[el.nodeName]) return;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) tekstnode(n); else if (n.nodeType === 1) gaa(n);
    }
  }
  /** Ligger noden inni noe som ikke skal oversettes? */
  function stengt(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (HOPP_OVER[e.nodeName] || HOPP_INNHOLD[e.nodeName] || e.hasAttribute('data-ingen-oversettelse')) return true;
    }
    return false;
  }
  function kjorAlt() { gaa(document.documentElement); observer?.takeRecords(); }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(poster => {
      for (const p of poster) {
        if (p.type === 'childList') { for (const n of p.addedNodes) { if (n.nodeType === 1 ? !stengt(n.parentNode || n) : true) gaa(n); } }
        else if (p.type === 'characterData') gaa(p.target);
        else if (p.type === 'attributes' && p.target.nodeType === 1 && !stengt(p.target)) attributter(p.target);
      }
      observer.takeRecords();   // det vi selv skrev, skal ikke behandles på nytt
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TEKST_ATTR });
  }
  function stoppObserver() { observer?.disconnect(); observer = null; }

  /* ---------- knappen i topplinja ---------- */
  const GLOBUS = '<svg class="ikon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>';

  /** Felles liten meny (brukes både i topplinja og ved PDF-knappene) */
  let meny = null, menyVelg = null, menyKnapp = null;
  function apneMeny(knapp, gjeldende, tittel, velg) {
    lukkMeny();
    meny = document.createElement('div');
    meny.className = 'sprak-meny'; meny.setAttribute('role', 'menu'); meny.setAttribute('data-ingen-oversettelse', '');
    meny.innerHTML = `<div class="sprak-meny-tittel"></div>` + SPRAK_LISTE.map(s =>
      `<button type="button" role="menuitemradio" aria-checked="${s.kode === gjeldende}" class="sprak-valg${s.kode === gjeldende ? ' aktiv' : ''}" data-kode="${s.kode}"><span class="sprak-hake" aria-hidden="true">✓</span><span>${s.navn}</span><span class="sprak-kode">${s.kode.toUpperCase()}</span></button>`).join('');
    meny.firstChild.textContent = tittel;
    document.body.appendChild(meny);
    const r = knapp.getBoundingClientRect(), b = meny.offsetWidth;
    meny.style.top = (r.bottom + 6 + window.scrollY) + 'px';
    meny.style.left = Math.max(8, Math.min(window.innerWidth - b - 8, r.right - b)) + window.scrollX + 'px';
    menyVelg = velg; menyKnapp = knapp; knapp.setAttribute('aria-expanded', 'true');
    meny.addEventListener('click', e => { const v = e.target.closest('[data-kode]'); if (!v) return; const f = menyVelg; lukkMeny(); f(v.dataset.kode); });
    meny.querySelector('.aktiv')?.focus();
  }
  function lukkMeny() {
    if (!meny) return;
    meny.remove(); meny = null; menyKnapp?.setAttribute('aria-expanded', 'false'); menyKnapp = null;
  }
  document.addEventListener('click', e => { if (meny && !meny.contains(e.target) && !e.target.closest('#sprak-knapp,[data-pdf-sprak]')) lukkMeny(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && meny) { e.stopPropagation(); const k = menyKnapp; lukkMeny(); k?.focus(); } }, true);
  window.addEventListener('resize', lukkMeny);

  function oppdaterKnapp() {
    const k = document.getElementById('sprak-knapp'); if (!k) return;
    k.innerHTML = GLOBUS + `<span class="sprak-knapp-kode">${aktiv.toUpperCase()}</span>`;
    k.title = SPRAK_ORD_KNAPP[aktiv];
    k.setAttribute('aria-label', `${SPRAK_ORD_KNAPP[aktiv]}: ${SPRAK_LISTE.find(s => s.kode === aktiv).navn}`);
  }
  function byggKnapp() {
    if (document.getElementById('sprak-knapp')) return;
    const qr = document.getElementById('qr-knapp'); if (!qr) return;
    const k = document.createElement('button');
    k.type = 'button'; k.id = 'sprak-knapp'; k.className = 'topp-ikon sprak-knapp';
    k.setAttribute('aria-haspopup', 'menu'); k.setAttribute('aria-expanded', 'false'); k.setAttribute('data-ingen-oversettelse', '');
    qr.parentNode.insertBefore(k, qr.nextSibling);
    k.addEventListener('click', () => meny && menyKnapp === k ? lukkMeny() : apneMeny(k, aktiv, SPRAK_ORD_KNAPP[aktiv], kode => sett(kode, { lagre: true })));
    oppdaterKnapp();
  }

  /* ---------- bytte språk ---------- */
  async function sett(kode, { lagre = false } = {}) {
    kode = gyldig(kode);
    const forrige = aktiv;
    if (kode !== 'no') {
      try { await lastOrdbok(); }
      catch (e) { console.warn(e); if (typeof melding === 'function') melding('Klarte ikke å laste språket. Prøv igjen.', 'feil'); return; }
    }
    aktiv = kode; skrivL('sp_sprak', kode);
    document.documentElement.lang = SPRAK_LISTE.find(s => s.kode === kode).html;
    document.documentElement.removeAttribute('data-sprak-venter');
    oppdaterKnapp(); PdfSprak.oppdater();
    if (kode === 'no') { if (forrige !== 'no') { stoppObserver(); kjorAlt(); } }
    else { kjorAlt(); startObserver(); }
    if (lagre) lagrePaBruker(kode);
  }
  async function lagrePaBruker(kode) {
    const rad = typeof ROLLE !== 'undefined' ? ROLLE.rad : null;
    if (!rad?._id || typeof oppdaterElement !== 'function') return;
    try { await oppdaterElement(LISTER.brukere, rad._id, { Sprak: kode }); rad.sprak = kode; }
    catch (e) { console.warn('Språk ble ikke lagret på brukeren:', e.message); }
  }
  /** Kalles etter innlogging: språket som er lagret på brukeren, vinner */
  function fraBruker(rad) {
    if (!rad) return;
    if (rad.sprak && rad.sprak !== aktiv) sett(rad.sprak);
    else if (!rad.sprak && aktiv !== 'no') lagrePaBruker(aktiv);    // valgt før innlogging: ta det med
  }

  /* ---------- meldingsbokser ---------- */
  for (const f of ['alert', 'confirm', 'prompt']) {
    const o = window[f]; if (typeof o !== 'function') continue;
    window[f] = function (msg, ...r) {
      if (aktiv !== 'no' && typeof msg === 'string') msg = msg.split('\n').map(l => oversettTil(l, aktiv)).join('\n');
      return o.call(window, msg, ...r);
    };
  }

  function start() {
    byggKnapp();
    document.documentElement.lang = SPRAK_LISTE.find(s => s.kode === aktiv).html;
    if (aktiv !== 'no') {
      document.documentElement.setAttribute('data-sprak-venter', '');
      setTimeout(() => document.documentElement.removeAttribute('data-sprak-venter'), 1500);   // aldri blank side
      const a = aktiv; aktiv = 'no'; sett(a);
    }
  }

  return {
    hent: () => aktiv, sett, fraBruker, lastOrdbok, start,
    oversett: s => oversettTil(s, aktiv),
    oversettTil: (s, lang) => oversettTil(s, gyldig(lang)),
    /** PDF: tekst som er gjort om til STORE BOKSTAVER før den tegnes («MANNSKAP – 3 PÅ JOBB») */
    oversettStore(s, lang) {
      lang = gyldig(lang);
      const t = oversettTil(s, lang);
      if (t !== s || typeof s !== 'string' || s !== s.toUpperCase() || !harBokstav(s)) return t;
      const T = bygg(lang); if (!T) return t;
      if (!T.liten) { T.liten = new Map(); for (const [k, v] of T.eksakt) if (!T.liten.has(k.toLowerCase())) T.liten.set(k.toLowerCase(), v); }
      const midt = s.trim().replace(/\s+/g, ' '), lo = midt.toLowerCase();
      let u = T.liten.get(lo);
      if (u === undefined) { const v = oversettTil(lo.charAt(0).toUpperCase() + lo.slice(1), lang); u = v.toLowerCase() === lo ? oversettTil(lo, lang) : v; if (u.toLowerCase() === lo) u = undefined; }
      return u === undefined ? t : s.replace(midt, u.toUpperCase());
    },
    apneMeny, lukkMeny,
    /** Til feilsøking i konsollen: norsk tekst på siden uten oversettelse */
    mangler() {
      const ut = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const r = origTekst.get(n); if (r && r.o === r.t && harBokstav(r.o) && !stengt(n.parentNode)) ut.add(r.o.trim());
      }
      return [...ut];
    }
  };
})();

/* ==================================================================
   PDF-språk: egen knapp «Språk» ved hver PDF. Valget huskes på enheten
   (sp_pdf_sprak) og gjelder alle PDF-er til det endres. Standard er norsk.
================================================================== */
const PdfSprak = (() => {
  const lesL = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  let valgt = SPRAK_KODER.includes(lesL('sp_pdf_sprak')) ? lesL('sp_pdf_sprak') : 'no';

  const knappHtml = () => `<button type="button" class="knapp pdf-sprak-knapp" data-pdf-sprak data-ingen-oversettelse aria-haspopup="menu" aria-expanded="false">${innhold()}</button>`;
  function innhold() {
    const s = Sprak.hent();
    return `<span class="pdf-sprak-ord">${SPRAK_ORD_KNAPP[s]}</span> <b>${valgt.toUpperCase()}</b>`;
  }
  function oppdater() {
    document.querySelectorAll('[data-pdf-sprak]').forEach(k => {
      k.innerHTML = innhold();
      const navn = SPRAK_LISTE.find(x => x.kode === valgt).navn;
      k.title = Sprak.oversett('Språk på PDF-en') + ': ' + navn;
      k.setAttribute('aria-label', k.title);
    });
  }
  function sett(kode) {
    valgt = SPRAK_KODER.includes(kode) ? kode : 'no';
    try { localStorage.setItem('sp_pdf_sprak', valgt); } catch (_) {}
    oppdater();
    if (typeof melding === 'function') melding(Sprak.oversett(`PDF-en lages på ${SPRAK_LISTE.find(x => x.kode === valgt).navn}.`));
  }
  document.addEventListener('click', e => {
    const k = e.target.closest('[data-pdf-sprak]'); if (!k) return;
    e.preventDefault();
    if (k.getAttribute('aria-expanded') === 'true') { Sprak.lukkMeny(); return; }
    Sprak.apneMeny(k, valgt, Sprak.oversett('Velg språk på PDF-en'), sett);
  });
  return { hent: () => valgt, sett, knappHtml, oppdater };
})();

/** HTML for knappen – settes inn ved siden av PDF-knappene */
const pdfSprakKnapp = () => PdfSprak.knappHtml();

/** Kobler et nytt jsPDF-dokument til valgt PDF-språk (kalles fra nyPdf) */
async function pdfSprakKoble(doc, lang = PdfSprak.hent()) {
  if (lang === 'no') return doc;
  await Sprak.lastOrdbok();
  const tr = s => typeof s === 'string' ? Sprak.oversettStore(s, lang) : Array.isArray(s) ? s.map(tr) : s;
  if (lang === 'pl' || lang === 'lt') {
    if (!window.SP_PDF_FONT) await lastSkript('js/pdf-font.js?v=442');
    doc.addFileToVFS('LiberationSans-Regular.ttf', window.SP_PDF_FONT.normal);
    doc.addFont('LiberationSans-Regular.ttf', 'LiberationSans', 'normal');
    doc.addFileToVFS('LiberationSans-Bold.ttf', window.SP_PDF_FONT.bold);
    doc.addFont('LiberationSans-Bold.ttf', 'LiberationSans', 'bold');
    const setFont = doc.setFont.bind(doc);
    doc.setFont = (navn, stil, ...r) => {
      if (!navn || /helvetica/i.test(navn)) { navn = 'LiberationSans'; stil = /bold/i.test(stil || '') ? 'bold' : 'normal'; }
      return setFont(navn, stil, ...r);
    };
    doc.setFont('helvetica', 'normal');
  }
  const text = doc.text.bind(doc), split = doc.splitTextToSize.bind(doc), bredde = doc.getTextWidth.bind(doc);
  doc.text = (t, ...r) => text(tr(t), ...r);
  doc.splitTextToSize = (t, ...r) => split(tr(t), ...r);
  doc.getTextWidth = t => bredde(tr(t));
  if (doc.getStringUnitWidth) { const gs = doc.getStringUnitWidth.bind(doc); doc.getStringUnitWidth = (t, ...r) => gs(tr(t), ...r); }
  try { doc.setLanguage?.(SPRAK_LISTE.find(s => s.kode === lang).html); } catch (_) {}
  return doc;
}

Sprak.start();
