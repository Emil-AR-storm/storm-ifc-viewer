/* ==================================================================
   maler.js — Storm Prosjekter, versjon 3 (03.11.2026): malbyggeren
   Sjekklistemaler ligger i SharePoint-lista SjekklisteMaler.
   Kolonnen Punkter er JSON:
     { skjema: 2, beskrivelse, sider: [ { id, tittel, beskrivelse,
         punkter: [ { id, nr, tekst, type, griprType, alternativer,
                      kolonner, rader, hjelpetekst, obligatorisk,
                      bilder, antallBilder?, visHvis: { punktId, svar } | null } ] } ] }
   4.51: antallBilder (0–10, standard 1; 0 = hoppes over i fotomodus) = hvor mange bilder fotomodus tar på
   punktet før den går videre til neste punkt.
   Skjema 1 (importen fra Gripr 03.11) brukte visHvis.punkt = nr.
   Det leses fortsatt, og lagres som skjema 2 første gang malen lagres.

   Punkt-id endres aldri (brukes av SjekklisteSvar). Nummer (1.1, 1.1.1)
   regnes ut på nytt ved lagring ut fra rekkefølgen.
   Maler slettes aldri herfra — de deaktiveres (Aktiv = nei).

   Ruter: #/maler            liste
          #/maler/<MalId>    rediger (fane: rediger | forhandsvis)
          #/maler/ny         ny tom mal
================================================================== */

const MAL_MAKS_BILDER = 10;
/** 4.51: bilder før fotomodus går videre (0–10, standard 1). 0 = punktet hoppes over i fotomodus. */
const malAntallBilder = v => (v === 0 || v === '0') ? 0 : Math.max(1, Math.min(MAL_MAKS_BILDER, Math.round(Number(v) || 1)));

const SVARTYPER = [
  ['ja_nei_ia',    'Ja / Nei / IR'],
  ['ok_avvik_ia',  'OK / Avvik / IR'],
  ['tekst',        'Tekst'],
  ['dato',         'Dato'],
  ['flervalg',     'Flervalg (flere svar)'],
  ['enkeltvalg',   'Enkeltvalg (ett svar)'],
  ['linje',        'Kort tekst (én linje)'],
  ['tall',         'Tall'],
  ['info',         'Fast tekst (ingen svar)'],
  ['tabell',       'Tabell (kolonner)'],
  ['grid',         'Grid (rader)'],
  ['ordrelinjer',  'Ordrelinjer'],
  ['adresse',      'Adresse'],
  ['bilde',        'Bilde'],
  ['egendefinert', 'Egendefinert valg – må sjekkes'],
  ['ukjent',       'Ukjent – må sjekkes']
];
const SVARTYPE_NAVN = Object.fromEntries(SVARTYPER);
// Svarene lagres med Gripr-verdiene, vises med norske ord
const FASTE_SVAR = {
  ja_nei_ia:   [['YES', 'Ja'], ['NO', 'Nei'], ['NA', 'IR']],
  ok_avvik_ia: [['OK', 'OK'], ['DEVIATION', 'Avvik'], ['NA', 'IR']]
};
const MAL_FAG = ['Betong', 'Stål', 'Treverk', 'Grunnarbeid', 'Montasje', 'HMS', 'Generelt'];
const MAL_OMR = ['SE', 'SB', 'SS', 'Alle'];
const SKJEMATYPER = ['Sjekkliste', 'Endringsmelding', 'Befaring', 'Avvik', 'Uønsket hendelse', 'Sikker jobbanalyse', 'Loggbok', 'Kontrakt', 'Bedriftsskjema'];

const malTilstand = {
  maler: [], lastet: false, sok: '', typeFilter: 'Alle', visInaktive: false,
  redigert: null   // { item, mal, felter, endret, fane }
};

const nyId = (prefiks = 'p') => prefiks + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const harAlternativer = t => t === 'flervalg' || t === 'enkeltvalg' || t === 'egendefinert';
const kanStyre = t => t === 'ja_nei_ia' || t === 'ok_avvik_ia' || t === 'flervalg' || t === 'enkeltvalg' || t === 'egendefinert';

/* ---------------- Data ---------------- */

async function lastMaler(tving = false) {
  if (malTilstand.lastet && !tving) return;
  malTilstand.maler = await hentElementer(LISTER.sjekklisteMaler);
  malTilstand.lastet = true;
}
// Spesielle sjekklister (f.eks. EM) er definert i koden og kan ikke redigeres (em.js)
const finnMal = id => (typeof SPESIELLE_MALER !== 'undefined' && SPESIELLE_MALER.find(m => m.MalId === id)) || malTilstand.maler.find(m => m.MalId === id);

/** Leser Punkter-JSON og gjør den om til skjema 2 i minnet */
function lesMalJson(tekst) {
  let d;
  try { d = JSON.parse(tekst || '{}'); } catch (_) { d = {}; }
  const sider = Array.isArray(d.sider) ? d.sider : [];
  const alle = sider.flatMap(s => s.punkter || []);
  sider.forEach((s, si) => {
    s.intern = !!s.intern;   // intern side: kommer ikke med i rapport og PDF, kan fylles ut etter låsing
    s.id = s.id || nyId('s');
    s.tittel = s.tittel || `Side ${si + 1}`;
    s.beskrivelse = s.beskrivelse || '';
    s.punkter = (s.punkter || []).map(p => ({
      id: p.id || nyId(), nr: p.nr || '', tekst: p.tekst || '', type: SVARTYPE_NAVN[p.type] ? p.type : 'ukjent',
      griprType: p.griprType || '', alternativer: p.alternativer || [], kolonner: p.kolonner || [], rader: p.rader || [],
      hjelpetekst: p.hjelpetekst || '', obligatorisk: p.type === 'info' ? false : p.obligatorisk !== false, bilder: !!p.bilder,
      antallBilder: malAntallBilder(p.antallBilder ?? 1),
      salgspris: !!p.salgspris, kilde: !!p.kilde, ikkePdf: !!p.ikkePdf,
      visHvis: p.visHvis ? {
        punktId: p.visHvis.punktId || (alle.find(q => q.nr === p.visHvis.punkt) || {}).id || '',
        svar: p.visHvis.svar || ''
      } : null
    }));
  });
  return { skjema: 2, beskrivelse: d.beskrivelse || '', type: d.type || '', sider };
}

/** Nummererer på nytt: hovedpunkter s.i, betingede punkter forelder.k */
function nummerer(mal) {
  mal.sider.forEach((s, si) => {
    let i = 0; const teller = {};
    const nrAv = {};
    s.punkter.forEach(p => {
      if (p.type === 'info') { p.nr = ''; return; }   // fast tekst får ikke nummer
      const far = p.visHvis && nrAv[p.visHvis.punktId];
      if (far) { teller[far] = (teller[far] || 0) + 1; p.nr = `${far}.${teller[far]}`; }
      else { i++; p.nr = `${si + 1}.${i}`; }
      nrAv[p.id] = p.nr;
    });
  });
}

/** Ting som bør rettes (vises som advarsler, stopper ikke lagring) */
function malAdvarsler(mal) {
  const ut = [];
  const ids = new Set(mal.sider.flatMap(s => s.punkter.map(p => p.id)));
  mal.sider.forEach(s => s.punkter.forEach(p => {
    const navn = `${p.nr || '?'} ${p.tekst ? '«' + p.tekst.slice(0, 40) + '»' : ''}`;
    if (p.type === 'egendefinert' || p.type === 'ukjent') ut.push({ id: p.id, tekst: `${navn}: velg svartype` });
    if (!p.tekst.trim() && p.type !== 'tabell') ut.push({ id: p.id, tekst: `${navn}: mangler spørsmålstekst` });
    if (p.type === 'flervalg' && !p.alternativer.filter(a => a.trim()).length) ut.push({ id: p.id, tekst: `${navn}: mangler svaralternativer` });
    if (p.type === 'tabell' && !p.kolonner.filter(a => a.trim()).length) ut.push({ id: p.id, tekst: `${navn}: tabellen mangler kolonner` });
    if (p.type === 'grid' && !p.rader.filter(a => a.trim()).length) ut.push({ id: p.id, tekst: `${navn}: grid mangler rader` });
    if (p.visHvis && !ids.has(p.visHvis.punktId)) ut.push({ id: p.id, tekst: `${navn}: betingelsen peker på et punkt som ikke finnes` });
  }));
  if (!mal.sider.length) ut.push({ id: '', tekst: 'Malen har ingen sider' });
  return ut;
}

const antallEgendef = mal => mal.sider.reduce((a, s) => a + s.punkter.filter(p => p.type === 'egendefinert' || p.type === 'ukjent').length, 0);
const antallPunkter = mal => mal.sider.reduce((a, s) => a + s.punkter.length, 0);

/* ---------------- Liste ---------------- */

function malListeHtml() {
  const q = malTilstand.sok.trim().toLowerCase();
  const liste = malTilstand.maler
    .filter(m => malTilstand.visInaktive || m.Aktiv !== false)
    .filter(m => malTilstand.typeFilter === 'Alle' || m.Skjematype === malTilstand.typeFilter)
    .filter(m => !q || `${m.MalId} ${m.Title} ${m.Skjematype || ''} ${m.Fag || ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.Title.localeCompare(b.Title, 'nb'));
  const spes = (typeof SPESIELLE_MALER !== 'undefined' ? SPESIELLE_MALER : [])
    .filter(m => malTilstand.typeFilter === 'Alle' || m.Skjematype === malTilstand.typeFilter)
    .filter(m => !q || `${m.MalId} ${m.Title} ${m.Skjematype}`.toLowerCase().includes(q));
  const spesHtml = spes.length ? `<h2 class="mal-gruppe">${ikon('venter')} Spesielle sjekklister <span class="muted liten">faste, kan ikke redigeres</span></h2>
    <ul class="kortliste">${spes.map(m => `<li><a class="kort spesiell" href="#/maler/${enc(m.MalId)}">
      <div class="kort-topp"><span class="kort-nr">${esc(m.MalId)} · v${esc(m.Versjon)}</span><span class="status status-fullført">Låst</span></div>
      <div class="kort-navn">${esc(m.Title)}</div>
      <div class="kort-meta"><span>${esc(m.Skjematype)}</span><span class="muted">${esc(m.Kort || '')}</span></div></a></li>`).join('')}</ul>
    <h2 class="mal-gruppe">Skjemamaler</h2>` : '';
  if (!liste.length) return spesHtml + '<div class="tom">Ingen maler passer søket.</div>';
  return spesHtml + `<ul class="kortliste">${liste.map(m => {
    const mal = lesMalJson(m.Punkter);
    const adv = malAdvarsler(mal).length;
    const bilder = mal.sider.reduce((a, s) => a + s.punkter.filter(p => p.bilder).length, 0);
    return `<li><a class="kort" href="#/maler/${enc(m.MalId)}">
      <div class="kort-topp"><span class="kort-nr">${esc(m.MalId)} · v${esc(m.Versjon || 1)}</span>
        ${m.Aktiv === false ? '<span class="status status-lukket">Deaktivert</span>' : adv ? `<span class="status status-ikkepåbegynt">${adv} å sjekke</span>` : ''}</div>
      <div class="kort-navn">${esc(m.Title)}</div>
      <div class="kort-meta">
        ${m.Skjematype ? `<span>${esc(m.Skjematype)}</span>` : ''}
        <span class="muted">${mal.sider.length} side${mal.sider.length === 1 ? '' : 'r'} · ${antallPunkter(mal)} punkter${bilder ? ` · ${bilder} med bilder` : ''}</span>
        ${m.Fag ? `<span class="muted">${esc(m.Fag)}</span>` : ''}
      </div></a></li>`;
  }).join('')}</ul>`;
}

async function visMalListe() {
  $app().innerHTML = '<p class="laster">Laster maler …</p>';
  try { await lastMaler(); } catch (e) { return visLastefeil(e); }
  const typer = ['Alle', ...new Set(malTilstand.maler.map(m => m.Skjematype).filter(Boolean))].sort((a, b) => a === 'Alle' ? -1 : b === 'Alle' ? 1 : a.localeCompare(b, 'nb'));
  const inaktive = malTilstand.maler.filter(m => m.Aktiv === false).length;
  $app().innerHTML = `
    <div class="detalj-topp"><h1>Maler</h1></div>
    ${malerFaner('s')}
    <div class="verktoy">
      <input type="search" id="mal-sok" class="sok" placeholder="Søk i maler …" value="${esc(malTilstand.sok)}" autocomplete="off" enterkeyhint="search">
      <a class="knapp primar" href="#/maler/ny">+ Ny mal</a>
    </div>
    <div class="chips" role="group" aria-label="Filtrer på skjematype">
      ${typer.map(t => `<button type="button" class="chip ${t === malTilstand.typeFilter ? 'valgt' : ''}" data-type="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    ${inaktive ? `<label class="avkrysning liten-velger"><input type="checkbox" id="vis-inaktive" ${malTilstand.visInaktive ? 'checked' : ''}> Vis deaktiverte (${inaktive})</label>` : ''}
    <div id="mal-liste">${malListeHtml()}</div>
  `;
  const oppdater = () => { document.getElementById('mal-liste').innerHTML = malListeHtml(); };
  document.getElementById('mal-sok').addEventListener('input', e => { malTilstand.sok = e.target.value; oppdater(); });
  $app().querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
    malTilstand.typeFilter = b.dataset.type;
    $app().querySelectorAll('[data-type]').forEach(x => x.classList.toggle('valgt', x === b));
    oppdater();
  }));
  document.getElementById('vis-inaktive')?.addEventListener('change', e => { malTilstand.visInaktive = e.target.checked; oppdater(); });
}

function visLastefeil(e) {
  console.error(e);
  $app().innerHTML = `<div class="tom feil"><b>Klarte ikke å laste malene.</b><br>${esc(e.message)}<br><br>
    <button type="button" class="knapp" data-last-paa-nytt>Prøv igjen</button></div>`;
}

/* ---------------- Redigering ---------------- */

async function visMal(malId, fane = 'rediger') {
  try { await lastMaler(); } catch (e) { return visLastefeil(e); }
  const r = malTilstand.redigert;
  // Behold ulagrede endringer når man bytter mellom rediger og forhåndsvis
  if (!r || r.malId !== malId) {
    if (malId === 'ny') {
      malTilstand.redigert = {
        malId: 'ny', item: null, endret: false,
        felter: { Title: '', Skjematype: 'Sjekkliste', Fag: '', Arbeidsomrade: 'SE', Aktiv: true },
        mal: { skjema: 2, beskrivelse: '', sider: [{ id: nyId('s'), tittel: 'Side 1', beskrivelse: '', punkter: [] }] }
      };
    } else {
      const item = finnMal(malId);
      if (!item) { $app().innerHTML = `<div class="tom">Fant ikke malen ${esc(malId)}. <a href="#/maler">Til malene</a></div>`; return; }
      malTilstand.redigert = {
        malId, item, endret: false,
        felter: { Title: item.Title || '', Skjematype: item.Skjematype || '', Fag: item.Fag || '', Arbeidsomrade: item.Arbeidsomrade || 'SE', Aktiv: item.Aktiv !== false },
        mal: lesMalJson(item.Punkter)
      };
    }
  }
  malTilstand.redigert.fane = fane === 'forhandsvis' || malTilstand.redigert.item?.Spesiell ? 'forhandsvis' : 'rediger';
  tegnMal();
}

function tegnMal() {
  const r = malTilstand.redigert;
  const { item, felter, mal, fane } = r;
  nummerer(mal);
  const adv = malAdvarsler(mal);
  const basis = `#/maler/${enc(r.malId)}`;
  $app().innerHTML = `
    <nav class="brodsmuler"><a href="#/maler">Sjekklistemaler</a></nav>
    <div class="detalj-topp">
      <div>
        <div class="kort-nr">${item ? `${esc(item.MalId)} · versjon ${esc(item.Versjon || 1)}` : 'Ny mal'}</div>
        <h1>${esc(felter.Title || 'Uten navn')}</h1>
      </div>
      ${felter.Aktiv ? '' : '<span class="status status-lukket">Deaktivert</span>'}
    </div>
    ${item?.Spesiell ? `<div class="seksjon info-boks laast-boks">${ikon('venter')} <b>Fast sjekkliste – kan ikke redigeres.</b> ${esc(item.LaastTekst || '')}</div>` : `
    <div class="faner" role="tablist">
      <a role="tab" class="fane ${fane === 'rediger' ? 'valgt' : ''}" aria-selected="${fane === 'rediger'}" href="${basis}">Rediger</a>
      <a role="tab" class="fane ${fane === 'forhandsvis' ? 'valgt' : ''}" aria-selected="${fane === 'forhandsvis'}" href="${basis}/forhandsvis">Forhåndsvis</a>
    </div>`}
    <div id="mal-innhold">${fane === 'forhandsvis' ? forhandsvisHtml(felter, mal) : redigerHtml(r, adv)}</div>
    ${item?.Spesiell ? '' : `<div class="lagrelinje" id="lagrelinje">
      <span class="muted liten" id="lagre-status">${r.endret ? 'Ulagrede endringer' : (item ? 'Ingen endringer' : 'Ikke lagret')}</span>
      <button type="button" class="knapp primar" id="mal-lagre" ${r.endret || !item ? '' : 'disabled'}>${item ? 'Lagre ny versjon' : 'Opprett mal'}</button>
    </div>`}
  `;
  document.getElementById('mal-lagre')?.addEventListener('click', lagreMal);
  if (fane === 'rediger') kobleRediger();
}

function settEndret() {
  const r = malTilstand.redigert;
  if (!r.endret) {
    r.endret = true;
    const s = document.getElementById('lagre-status'); if (s) s.textContent = 'Ulagrede endringer';
    const k = document.getElementById('mal-lagre'); if (k) k.disabled = false;
  }
}

const opt = (verdi, valgt, tekst = verdi) => `<option value="${esc(verdi)}" ${verdi === valgt ? 'selected' : ''}>${esc(tekst)}</option>`;

function redigerHtml(r, adv) {
  const { felter, mal, item } = r;
  return `
    ${adv.length ? `<section class="seksjon advarsel">
      <h2>${adv.length} ting å sjekke</h2>
      <p class="muted liten">Punktene er merket med gul ramme i lista under. Trykk på en linje for å gå til punktet.</p>
      ${antallEgendef(mal) ? `<div class="masse">
        <label class="etikett-liten">Sett alle ${antallEgendef(mal)} punkter med «Egendefinert valg» / «Ukjent» til
          <select id="masse-type">${SVARTYPER.filter(([k]) => k !== 'egendefinert' && k !== 'ukjent').map(([k, n]) => opt(k, 'ja_nei_ia', n)).join('')}</select></label>
        <button type="button" class="knapp liten-knapp" data-handling="masse-type">Bruk</button></div>` : ''}
      <details ${adv.length <= 6 ? 'open' : ''}><summary>Vis lista</summary>
      <ul class="enkel">${adv.map(a => `<li>${a.id ? `<a href="#" data-hopp="${esc(a.id)}">${esc(a.tekst)}</a>` : esc(a.tekst)}</li>`).join('')}</ul></details></section>` : ''}
    <section class="seksjon skjema">
      <h2>Om malen</h2>
      <label class="etikett">Navn * <input data-felt="Title" value="${esc(felter.Title)}" placeholder="f.eks. Sjekkliste – Radonduk"></label>
      <div class="to-kol">
        <label class="etikett">Skjematype <select data-felt="Skjematype">${opt('', felter.Skjematype, '—')}${[...new Set([...SKJEMATYPER, felter.Skjematype].filter(Boolean))].map(t => opt(t, felter.Skjematype)).join('')}</select></label>
        <label class="etikett">Fag <select data-felt="Fag">${opt('', felter.Fag, '—')}${MAL_FAG.map(t => opt(t, felter.Fag)).join('')}</select></label>
      </div>
      <label class="etikett">Arbeidsområde <select data-felt="Arbeidsomrade">${MAL_OMR.map(o => opt(o, felter.Arbeidsomrade, o === 'Alle' ? 'Alle arbeidsområder' : `${o} – ${SELSKAP[o]}`)).join('')}</select></label>
      <label class="etikett">Beskrivelse <textarea data-malfelt="beskrivelse" rows="2" placeholder="valgfritt">${esc(mal.beskrivelse)}</textarea></label>
      <label class="bryter"><input type="checkbox" data-felt="Aktiv" ${felter.Aktiv ? 'checked' : ''}> Aktiv (kan brukes til nye sjekklister)</label>
      ${item?.GriprKilde ? `<p class="hint">Fra Gripr: ${esc(item.GriprKilde)}</p>` : ''}
      ${item ? `<div class="knapperad"><button type="button" class="knapp" id="mal-kopier">Lag kopi av malen</button></div>` : ''}
    </section>
    ${mal.sider.map((s, si) => sideHtml(s, si, mal, adv)).join('')}
    <div class="knapperad"><button type="button" class="knapp" data-handling="ny-side">+ Ny side</button></div>
  `;
}

function sideHtml(s, si, mal, adv) {
  const advIds = new Set(adv.map(a => a.id));
  return `
    <section class="seksjon side" data-side="${esc(s.id)}">
      <div class="side-topp">
        <span class="kort-nr">Side ${si + 1}</span>
        <div class="flytt">
          <button type="button" class="ikon" data-handling="side-opp" title="Flytt siden opp" aria-label="Flytt siden opp" ${si === 0 ? 'disabled' : ''}>${ikon('opp')}</button>
          <button type="button" class="ikon" data-handling="side-ned" title="Flytt siden ned" aria-label="Flytt siden ned" ${si === mal.sider.length - 1 ? 'disabled' : ''}>${ikon('ned')}</button>
          <button type="button" class="ikon fare" data-handling="side-fjern" title="Fjern siden" aria-label="Fjern siden">${ikon('lukk')}</button>
        </div>
      </div>
      <input class="side-tittel" data-sidefelt="tittel" value="${esc(s.tittel)}" placeholder="Sidetittel" aria-label="Sidetittel">
      <input class="side-beskr" data-sidefelt="beskrivelse" value="${esc(s.beskrivelse)}" placeholder="Sidebeskrivelse (valgfritt)" aria-label="Sidebeskrivelse">
      <ol class="punkter">${s.punkter.map((p, pi) => punktHtml(p, pi, s, advIds.has(p.id))).join('')}</ol>
      <button type="button" class="knapp liten-knapp" data-handling="nytt-punkt">+ Nytt punkt</button>
    </section>`;
}

function punktHtml(p, pi, s, merket) {
  const styrere = s.punkter.filter(q => q.id !== p.id && kanStyre(q.type) && !q.visHvis);
  const far = p.visHvis ? s.punkter.find(q => q.id === p.visHvis.punktId) : null;
  const svarValg = far ? (FASTE_SVAR[far.type] || far.alternativer.map(a => [a, a])) : [];
  return `
    <li class="punkt ${p.visHvis ? 'betinget' : ''} ${merket ? 'merket' : ''}" data-punkt="${esc(p.id)}" id="pk-${esc(p.id)}">
      <div class="punkt-topp">
        <span class="punkt-nr">${esc(p.nr)}</span>
        <input class="punkt-tekst" data-pfelt="tekst" value="${esc(p.tekst)}" placeholder="Spørsmål / kontrollpunkt" aria-label="Spørsmål">
        <div class="flytt">
          <button type="button" class="ikon" data-handling="punkt-opp" title="Flytt opp" aria-label="Flytt punktet opp" ${pi === 0 ? 'disabled' : ''}>${ikon('opp')}</button>
          <button type="button" class="ikon" data-handling="punkt-ned" title="Flytt ned" aria-label="Flytt punktet ned" ${pi === s.punkter.length - 1 ? 'disabled' : ''}>${ikon('ned')}</button>
          <button type="button" class="ikon fare" data-handling="punkt-fjern" title="Fjern punktet" aria-label="Fjern punktet">${ikon('lukk')}</button>
        </div>
      </div>
      <div class="punkt-felter">
        <label class="etikett-liten">Svartype
          <select data-pfelt="type">${SVARTYPER.filter(([k]) => k !== 'ukjent' || p.type === 'ukjent').map(([k, n]) => opt(k, p.type, n)).join('')}</select>
        </label>
        <label class="etikett-liten">Hjelpetekst <input data-pfelt="hjelpetekst" value="${esc(p.hjelpetekst)}" placeholder="valgfritt"></label>
        ${harAlternativer(p.type) ? listeFeltHtml('alternativer', 'Svaralternativer', p.alternativer) : ''}
        ${p.type === 'tabell' ? listeFeltHtml('kolonner', 'Kolonner', p.kolonner) : ''}
        ${p.type === 'grid' ? listeFeltHtml('rader', 'Rader', p.rader) : ''}
        <div class="avkrysning">
          <label><input type="checkbox" data-pfelt="obligatorisk" ${p.obligatorisk ? 'checked' : ''}> Obligatorisk</label>
          <label><input type="checkbox" data-pfelt="bilder" ${p.bilder ? 'checked' : ''}> Bilder og notat</label>
        </div>
        ${p.bilder || p.type === 'bilde' ? `<label class="etikett-liten">Bilder før neste punkt <span class="muted">(fotomodus)</span>
          <select data-pfelt="antallBilder">${Array.from({ length: MAL_MAKS_BILDER + 1 }, (_, i) => i).map(n => opt(String(n), String(malAntallBilder(p.antallBilder ?? 1)), n === 0 ? '0 – hoppes over i fotomodus' : n === 1 ? '1 bilde' : `${n} bilder`)).join('')}</select></label>` : ''}
        <label class="etikett-liten">Vises bare hvis
          <select data-pfelt="visHvisPunkt">
            <option value="">— alltid —</option>
            ${styrere.map(q => opt(q.id, p.visHvis?.punktId, `${q.nr} ${q.tekst.slice(0, 50)}`)).join('')}
          </select>
        </label>
        ${far ? `<label class="etikett-liten">… har svaret
          <select data-pfelt="visHvisSvar">${svarValg.map(([v, n]) => opt(v, p.visHvis.svar, n)).join('')}</select></label>` : ''}
        ${p.griprType && p.griprType !== (SVARTYPER.find(([k]) => k === p.type) || [])[1] ? `<p class="hint">Gripr: ${esc(p.griprType)}</p>` : ''}
      </div>
    </li>`;
}

function listeFeltHtml(felt, etikett, verdier) {
  const v = verdier.length ? verdier : [''];
  return `<div class="etikett-liten listefelt" data-liste="${felt}">${etikett}
    ${v.map((a, i) => `<div class="listerad"><input data-listeverdi="${i}" value="${esc(a)}" placeholder="${{ alternativer: 'Alternativ', kolonner: 'Kolonne', rader: 'Rad' }[felt]} ${i + 1}">
      <button type="button" class="ikon fare" data-handling="liste-fjern" data-i="${i}" aria-label="Fjern">${ikon('lukk')}</button></div>`).join('')}
    <button type="button" class="lenkeknapp mork" data-handling="liste-ny">${ikon('pluss')} Legg til</button></div>`;
}

function kobleRediger() {
  const r = malTilstand.redigert;
  const inn = document.getElementById('mal-innhold');
  const side = el => r.mal.sider.find(s => s.id === el.closest('[data-side]')?.dataset.side);
  const punkt = el => { const s = side(el); return s && s.punkter.find(p => p.id === el.closest('[data-punkt]')?.dataset.punkt); };

  // Tekstfelter: oppdater tilstanden uten å tegne på nytt (beholder markøren)
  inn.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.felt && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
      r.felter[t.dataset.felt] = t.value;
      if (t.dataset.felt === 'Title') document.querySelector('.detalj-topp h1').textContent = t.value || 'Uten navn';
    }
    else if (t.dataset.malfelt) r.mal[t.dataset.malfelt] = t.value;
    else if (t.dataset.sidefelt) side(t)[t.dataset.sidefelt] = t.value;
    else if (t.dataset.pfelt && t.type !== 'checkbox' && t.tagName !== 'SELECT') punkt(t)[t.dataset.pfelt] = t.value;
    else if (t.dataset.listeverdi != null) punkt(t)[t.closest('[data-liste]').dataset.liste][Number(t.dataset.listeverdi)] = t.value;
    else return;
    settEndret();
  });

  // Valg og avkrysninger: kan endre hva som vises, så tegn på nytt
  inn.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.felt) { r.felter[t.dataset.felt] = t.type === 'checkbox' ? t.checked : t.value; settEndret(); if (t.type === 'checkbox') tegnBevarScroll(); return; }
    if (!t.dataset.pfelt || (t.tagName !== 'SELECT' && t.type !== 'checkbox')) return;   // tekstfelt håndteres i «input»
    const p = punkt(t), s = side(t);
    if (t.type === 'checkbox') p[t.dataset.pfelt] = t.checked;
    else if (t.dataset.pfelt === 'type') {
      p.type = t.value;
      if (harAlternativer(p.type) && !p.alternativer.length) p.alternativer = [''];
      // Punkter som var styrt av dette punktet: nullstill svaret hvis det ikke lenger finnes
      s.punkter.filter(q => q.visHvis?.punktId === p.id).forEach(q => {
        const gyldige = (FASTE_SVAR[p.type] || p.alternativer.map(a => [a])).map(x => x[0]);
        if (!kanStyre(p.type)) q.visHvis = null; else if (!gyldige.includes(q.visHvis.svar)) q.visHvis.svar = gyldige[0] || '';
      });
    }
    else if (t.dataset.pfelt === 'visHvisPunkt') {
      if (!t.value) p.visHvis = null;
      else {
        const far = s.punkter.find(q => q.id === t.value);
        const forste = (FASTE_SVAR[far.type] || far.alternativer.map(a => [a]))[0];
        p.visHvis = { punktId: t.value, svar: forste ? forste[0] : '' };
        // Flytt punktet rett under forelderen (og forelderens andre betingede punkter)
        s.punkter = s.punkter.filter(q => q.id !== p.id);
        let i = s.punkter.findIndex(q => q.id === far.id);
        while (s.punkter[i + 1] && s.punkter[i + 1].visHvis?.punktId === far.id) i++;
        s.punkter.splice(i + 1, 0, p);
      }
    }
    else if (t.dataset.pfelt === 'visHvisSvar') p.visHvis.svar = t.value;
    else if (t.dataset.pfelt === 'antallBilder') p.antallBilder = malAntallBilder(t.value);   // 4.51
    settEndret(); tegnBevarScroll(p.id);
  });

  inn.addEventListener('click', e => {
    const hopp = e.target.closest('[data-hopp]');
    if (hopp) { e.preventDefault(); const el = document.getElementById('pk-' + hopp.dataset.hopp); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.querySelector('input')?.focus({ preventScroll: true }); return; }
    const b = e.target.closest('[data-handling]');
    if (!b) return;
    const h = b.dataset.handling, s = side(b), sider = r.mal.sider;
    let fokus = null;
    if (h === 'ny-side') { const ny = { id: nyId('s'), tittel: `Side ${sider.length + 1}`, beskrivelse: '', punkter: [] }; sider.push(ny); fokus = `[data-side="${ny.id}"] .side-tittel`; }
    else if (h === 'side-opp' || h === 'side-ned') { const i = sider.indexOf(s), j = h === 'side-opp' ? i - 1 : i + 1; [sider[i], sider[j]] = [sider[j], sider[i]]; }
    else if (h === 'side-fjern') {
      if (s.punkter.length && !confirm(`Fjerne siden «${s.tittel}» med ${s.punkter.length} punkter? Endringen gjelder først når du lagrer.`)) return;
      sider.splice(sider.indexOf(s), 1);
    }
    else if (h === 'nytt-punkt') { const p = { id: nyId(), nr: '', tekst: '', type: 'ja_nei_ia', griprType: '', alternativer: [], kolonner: [], rader: [], hjelpetekst: '', obligatorisk: true, bilder: true, visHvis: null }; s.punkter.push(p); fokus = `#pk-${p.id} .punkt-tekst`; }
    else if (h === 'punkt-opp' || h === 'punkt-ned') {
      const p = punkt(b), i = s.punkter.indexOf(p), j = h === 'punkt-opp' ? i - 1 : i + 1;
      [s.punkter[i], s.punkter[j]] = [s.punkter[j], s.punkter[i]];
      // Et betinget punkt kan ikke ligge over punktet som styrer det
      s.punkter.forEach((q, k) => { if (q.visHvis) { const fi = s.punkter.findIndex(x => x.id === q.visHvis.punktId); if (fi > k) q.visHvis = null; } });
    }
    else if (h === 'punkt-fjern') {
      const p = punkt(b);
      const barn = s.punkter.filter(q => q.visHvis?.punktId === p.id);
      if (!confirm(`Fjerne punkt ${p.nr}${p.tekst ? ` «${p.tekst.slice(0, 60)}»` : ''}?${barn.length ? `\n${barn.length} punkt(er) som vises ut fra dette svaret blir vist alltid.` : ''}`)) return;
      barn.forEach(q => { q.visHvis = null; });
      s.punkter.splice(s.punkter.indexOf(p), 1);
    }
    else if (h === 'masse-type') {
      const ny = document.getElementById('masse-type').value;
      const n = antallEgendef(r.mal);
      if (!confirm(`Sette ${n} punkter til «${SVARTYPE_NAVN[ny]}»? Du kan se over før du lagrer.`)) return;
      r.mal.sider.forEach(x => x.punkter.forEach(p => { if (p.type === 'egendefinert' || p.type === 'ukjent') { p.type = ny; if (harAlternativer(ny) && !p.alternativer.length) p.alternativer = ['']; } }));
      melding(`${n} punkter er endret. Husk å lagre.`);
    }
    else if (h === 'liste-ny') { const p = punkt(b), f = b.closest('[data-liste]').dataset.liste; if (!p[f].length) p[f].push(''); p[f].push(''); fokus = `#pk-${p.id} [data-liste="${f}"] .listerad:last-of-type input`; }
    else if (h === 'liste-fjern') { const p = punkt(b), f = b.closest('[data-liste]').dataset.liste; p[f].splice(Number(b.dataset.i), 1); }
    else return;
    settEndret(); tegnBevarScroll(null, fokus);
  });

  document.getElementById('mal-kopier')?.addEventListener('click', kopierMal);
}

function tegnBevarScroll(punktId, fokusSel) {
  const y = window.scrollY;
  tegnMal();
  window.scrollTo(0, y);
  if (fokusSel) { const el = document.querySelector(fokusSel); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } }
}

/* ---------------- Forhåndsvisning (slik det ser ut på telefonen) ---------------- */

function forhandsvisHtml(felter, mal) {
  const svarHtml = p => {
    if (FASTE_SVAR[p.type]) return `<div class="svarknapper">${FASTE_SVAR[p.type].map(([v, n]) => `<button type="button" class="svar svar-${v.toLowerCase()}" disabled>${n}</button>`).join('')}</div>`;
    if (harAlternativer(p.type)) return `<div class="svarknapper">${p.alternativer.filter(a => a.trim()).map(a => `<button type="button" class="svar" disabled>${esc(a)}</button>`).join('') || '<span class="muted liten">Ingen alternativer</span>'}</div>`;
    if (p.type === 'dato') return '<input type="date" disabled>';
    if (p.type === 'tabell') return `<div class="tabellvis">${p.kolonner.map(k => `<span>${esc(k)}</span>`).join('')}</div>`;
    if (p.type === 'grid') return `<div class="gridvis">${p.rader.map(k => `<div><span>${esc(k)}</span><input disabled></div>`).join('')}</div>`;
    if (p.type === 'bilde') return '<div class="bildefelt">Ta bilde</div>';
    if (p.type === 'ordrelinjer') return '<div class="muted liten">Ordrelinjer (produkt, antall, enhet)</div>';
    if (p.type === 'info') return '';
    if (p.type === 'tall') return '<input disabled inputmode="decimal" placeholder="Tall">';
    return '<input disabled placeholder="Svar">';
  };
  return `
    <div class="telefon">
      <div class="telefon-topp">${esc(felter.Title || 'Uten navn')}</div>
      ${mal.beskrivelse ? `<p class="muted liten">${esc(mal.beskrivelse)}</p>` : ''}
      ${mal.sider.map(s => `
        <h2 class="fv-side">${esc(s.tittel)}${s.intern ? ' <span class="intern-merke">Intern – ikke i PDF</span>' : ''}</h2>
        ${s.beskrivelse ? `<p class="muted liten">${esc(s.beskrivelse)}</p>` : ''}
        ${s.punkter.map(p => {
          const far = p.visHvis && s.punkter.find(q => q.id === p.visHvis.punktId);
          const svarNavn = far ? ((FASTE_SVAR[far.type] || []).find(x => x[0] === p.visHvis.svar) || [0, p.visHvis.svar])[1] : '';
          return `<div class="fv-punkt ${p.visHvis ? 'betinget' : ''}">
            ${far ? `<div class="fv-betingelse">Vises hvis ${esc(far.nr)} = ${esc(svarNavn)}</div>` : ''}
            <div class="fv-tekst"><b>${esc(p.nr)}</b> ${esc(p.tekst)}${p.obligatorisk ? ' <span class="pakrevd" title="Obligatorisk">*</span>' : ''}</div>
            ${p.hjelpetekst ? `<div class="muted liten">${esc(p.hjelpetekst)}</div>` : ''}
            ${svarHtml(p)}
            ${p.bilder ? `<div class="fv-ekstra">${ikon('kamera')} Bilder ${ikon('notat')} Notat</div>` : ''}
          </div>`;
        }).join('')}`).join('')}
    </div>
    <p class="hint" style="margin-top:12px">Forhåndsvisning. Utfylling av sjekklister kommer i versjon 4.</p>`;
}

/* ---------------- Lagring ---------------- */

function nesteMalId() {
  const tall = malTilstand.maler.map(m => Number(String(m.MalId || '').replace(/^M/, ''))).filter(Number.isFinite);
  return 'M' + String((tall.length ? Math.max(...tall) : 0) + 1).padStart(3, '0');
}

function rensMal(mal) {
  nummerer(mal);
  return {
    skjema: 2, beskrivelse: mal.beskrivelse.trim(), ...(mal.type ? { type: mal.type } : {}),
    sider: mal.sider.map(s => ({
      id: s.id, tittel: s.tittel.trim(), beskrivelse: s.beskrivelse.trim(), ...(s.intern ? { intern: true } : {}),
      punkter: s.punkter.map(p => ({
        id: p.id, nr: p.nr, tekst: p.tekst.trim(), type: p.type, griprType: p.griprType,
        alternativer: harAlternativer(p.type) ? p.alternativer.map(a => a.trim()).filter(Boolean) : [],
        kolonner: p.type === 'tabell' ? p.kolonner.map(a => a.trim()).filter(Boolean) : [],
        rader: p.type === 'grid' ? p.rader.map(a => a.trim()).filter(Boolean) : [],
        hjelpetekst: p.hjelpetekst.trim(), obligatorisk: p.type === 'info' ? false : !!p.obligatorisk, bilder: !!p.bilder,
        ...((p.bilder || p.type === 'bilde') && malAntallBilder(p.antallBilder ?? 1) !== 1 ? { antallBilder: malAntallBilder(p.antallBilder) } : {}),
        ...(p.salgspris ? { salgspris: true } : {}), ...(p.kilde ? { kilde: true } : {}), ...(p.ikkePdf ? { ikkePdf: true } : {}),
        visHvis: p.visHvis && p.visHvis.punktId ? { punktId: p.visHvis.punktId, svar: p.visHvis.svar } : null
      }))
    }))
  };
}

async function lagreMal() {
  const r = malTilstand.redigert;
  const knapp = document.getElementById('mal-lagre');
  if (!r.felter.Title.trim()) { melding('Malen må ha et navn.', 'feil'); return; }
  const json = JSON.stringify(rensMal(r.mal));
  knapp.disabled = true; knapp.textContent = 'Lagrer …';
  try {
    if (r.item) {
      // Sjekk at ingen andre har lagret i mellomtiden
      await lastMaler(true);
      const fersk = finnMal(r.malId);
      if (fersk && Number(fersk.Versjon || 1) !== Number(r.item.Versjon || 1)) {
        knapp.disabled = false; knapp.textContent = 'Lagre ny versjon';
        melding(`Noen andre har lagret versjon ${fersk.Versjon} i mellomtiden. Last siden på nytt før du lagrer.`, 'feil');
        return;
      }
      const ny = Number(r.item.Versjon || 1) + 1;
      await oppdaterElement(LISTER.sjekklisteMaler, r.item._id, {
        Title: r.felter.Title.trim(), Skjematype: r.felter.Skjematype || null, Fag: r.felter.Fag || null,
        Arbeidsomrade: r.felter.Arbeidsomrade, Aktiv: !!r.felter.Aktiv, Punkter: json, Versjon: ny
      });
      await lastMaler(true);
      malTilstand.redigert = null;
      melding(`Lagret som versjon ${ny}.`);
      visMal(r.malId, r.fane);
    } else {
      await lastMaler(true);
      const malId = nesteMalId();
      const felter = { Title: r.felter.Title.trim(), MalId: malId, Arbeidsomrade: r.felter.Arbeidsomrade, Aktiv: !!r.felter.Aktiv, Versjon: 1, Punkter: json };
      if (r.felter.Skjematype) felter.Skjematype = r.felter.Skjematype;
      if (r.felter.Fag) felter.Fag = r.felter.Fag;
      if (r.kopiAv) felter.GriprKilde = `Kopi av ${r.kopiAv}`;
      await opprettElement(LISTER.sjekklisteMaler, felter);
      await lastMaler(true);
      malTilstand.redigert = null;
      melding(`${malId} er opprettet.`);
      location.hash = `#/maler/${enc(malId)}`;
    }
  } catch (e) {
    console.error(e);
    knapp.disabled = false; knapp.textContent = r.item ? 'Lagre ny versjon' : 'Opprett mal';
    melding('Lagring feilet: ' + e.message, 'feil');
  }
}

function kopierMal() {
  const r = malTilstand.redigert;
  if (r.endret && !confirm('Du har ulagrede endringer. Kopien tar med endringene, men originalen blir ikke lagret. Fortsette?')) return;
  const kopi = JSON.parse(JSON.stringify(r.mal));
  // Nye id-er i kopien, og betingelser som peker riktig
  const nyIder = {};
  kopi.sider.forEach(s => { s.id = nyId('s'); s.punkter.forEach(p => { const n = nyId(); nyIder[p.id] = n; p.id = n; }); });
  kopi.sider.forEach(s => s.punkter.forEach(p => { if (p.visHvis) p.visHvis.punktId = nyIder[p.visHvis.punktId] || ''; }));
  malTilstand.redigert = {
    malId: 'ny', item: null, endret: true, kopiAv: r.item ? `${r.item.MalId} ${r.item.Title}` : '',
    felter: { ...r.felter, Title: `${r.felter.Title} (kopi)`, Aktiv: false },
    mal: kopi
  };
  location.hash = '#/maler/ny';
}

/** Kalles fra ruteren før man forlater en mal med ulagrede endringer */
function malHarUlagret() { return !!(malTilstand.redigert && malTilstand.redigert.endret); }

window.addEventListener('beforeunload', e => { if (malHarUlagret()) { e.preventDefault(); e.returnValue = ''; } });
