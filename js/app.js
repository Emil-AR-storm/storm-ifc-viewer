/* ==================================================================
   app.js — Storm Prosjekter, versjon 2 (03.11.2026)
   Struktur som i Gripr:
     Arbeidsområde (SE / SB / SS, egen nummerserie hver)
       └ Hovedprosjekt
           └ Underprosjekt / Endringsmelding
   Hver rad i lista Prosjekter = ett prosjekt i ett arbeidsområde.
   Nøkkel = "<område>-<nr>", f.eks. "SB-317". Samme jobb i flere
   arbeidsområder kobles med JobbNr (SE-nummeret, f.eks. 20652).

   Ruter: #/                     prosjekter i valgt arbeidsområde
          #/p/<nøkkel>           prosjekt (fane: info)
          #/p/<nøkkel>/<fane>    under | sjekklister | avvik | dokumenter
          #/p/<nøkkel>/rediger
          #/nytt?omr=SB&forelder=SB-317
================================================================== */

const tilstand = {
  prosjekter: [],
  omr: lesLokal('sp_omr', 'SE'),
  sok: '',
  statusFilter: 'Pågående',
  lastet: false
};

function lesLokal(k, std) { try { return localStorage.getItem(k) || std; } catch (_) { return std; } }
function skrivLokal(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

const $app = () => document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

function melding(tekst, type = 'ok') {
  const m = document.getElementById('melding');
  m.textContent = tekst;
  m.className = `melding vis ${type}`;
  clearTimeout(melding._t);
  melding._t = setTimeout(() => { m.className = 'melding'; }, type === 'feil' ? 8000 : 3500);
}

const datoVis = iso => iso ? new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const datoInput = iso => iso ? new Date(iso).toISOString().slice(0, 10) : '';
const datoTilSP = v => v ? `${v}T12:00:00Z` : null;   // kl. 12 UTC: «kun dato» flytter seg ikke
const somListe = v => Array.isArray(v) ? v : (v ? [v] : []);
const statusKlasse = s => 'status-' + String(s || '').toLowerCase().replace(/[^a-zæøå]/g, '');
const nokkel = (omr, nr) => `${omr}-${nr}`;
const nrSort = (a, b) => (Number(b.ProsjektNr) || 0) - (Number(a.ProsjektNr) || 0);

/* ---------------- Data ---------------- */

async function lastProsjekter() {
  tilstand.prosjekter = await hentElementer(LISTER.prosjekter);
  tilstand.lastet = true;
}

const finn = k => tilstand.prosjekter.find(p => p.Nokkel === k);
const barnAv = k => tilstand.prosjekter.filter(p => p.ForelderNokkel === k).sort(nrSort);
const hovedIOmr = omr => tilstand.prosjekter.filter(p => p.Arbeidsomrade === omr && !p.ForelderNokkel).sort(nrSort);
const sammeJobb = p => p.JobbNr ? tilstand.prosjekter.filter(x => x.JobbNr === p.JobbNr && x.Nokkel !== p.Nokkel && !x.ForelderNokkel) : [];

/** Neste ledige nummer i arbeidsområdet (egen serie per område, som i Gripr) */
function nesteNr(omr) {
  const tall = tilstand.prosjekter.filter(p => p.Arbeidsomrade === omr).map(p => Number(p.ProsjektNr)).filter(Number.isFinite);
  if (tall.length) return String(Math.max(...tall) + 1);
  return { SE: '20001', SB: '1', SS: '1' }[omr];
}

/* ---------------- Felles: arbeidsområde-velger ---------------- */

function omrVelger() {
  return `<div class="omr-velger" role="tablist" aria-label="Arbeidsområde">
    ${VALG.Arbeidsomrade.map(o => `<button type="button" role="tab" aria-selected="${o === tilstand.omr}" class="omr ${o === tilstand.omr ? 'valgt' : ''}" data-omr="${o}">
      <span class="omr-kode">${o}</span><span class="omr-navn">${esc(SELSKAP[o])}</span></button>`).join('')}
  </div>`;
}
function kobleOmrVelger() {
  $app().querySelectorAll('[data-omr]').forEach(b => b.addEventListener('click', () => {
    tilstand.omr = b.dataset.omr; skrivLokal('sp_omr', tilstand.omr);
    if (location.hash && location.hash !== '#/') location.hash = '#/'; else visListe();
  }));
}

/* ---------------- Visning: prosjektliste ---------------- */

function visListe() {
  const q = tilstand.sok.trim().toLowerCase();
  const passerStatus = p => tilstand.statusFilter === 'Alle' || p.Status === tilstand.statusFilter;
  const passerSok = p => !q || `${p.ProsjektNr} ${p.Title} ${p.Kunde || ''} ${p.Adresse || ''} ${p.JobbNr || ''}`.toLowerCase().includes(q);

  // Hovedprosjekt vises hvis det selv passer, eller hvis et underprosjekt passer søket
  const hoved = hovedIOmr(tilstand.omr).filter(h =>
    passerStatus(h) && (passerSok(h) || (q && barnAv(h.Nokkel).some(passerSok))));
  const filtre = ['Pågående', 'Ikke påbegynt', 'Fullført', 'Lukket', 'Alle'];

  $app().innerHTML = `
    ${omrVelger()}
    <div class="verktoy">
      <input type="search" id="sok" class="sok" placeholder="Søk nr, navn, kunde …" value="${esc(tilstand.sok)}" autocomplete="off">
      <a class="knapp primar" href="#/nytt?omr=${tilstand.omr}">+ Nytt</a>
    </div>
    <div class="chips" role="group" aria-label="Filtrer på status">
      ${filtre.map(f => `<button type="button" class="chip ${f === tilstand.statusFilter ? 'valgt' : ''}" data-filter="${f}">${f}</button>`).join('')}
    </div>
    ${hoved.length === 0
      ? `<div class="tom">${hovedIOmr(tilstand.omr).length === 0
          ? `Ingen prosjekter i ${esc(SELSKAP[tilstand.omr])} ennå. Trykk <b>+ Nytt</b> for å legge inn det første.`
          : 'Ingen prosjekter passer søket eller filteret.'}</div>`
      : `<ul class="kortliste">${hoved.map(h => kortHtml(h, q ? barnAv(h.Nokkel).filter(passerSok) : [])).join('')}</ul>`}
  `;

  kobleOmrVelger();
  const sok = document.getElementById('sok');
  sok.addEventListener('input', () => {
    tilstand.sok = sok.value;
    const pos = sok.selectionStart;
    visListe();
    const ny = document.getElementById('sok'); ny.focus(); ny.setSelectionRange(pos, pos);
  });
  $app().querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    tilstand.statusFilter = b.dataset.filter; visListe();
  }));
}

function kortHtml(p, treff) {
  const antallUnder = barnAv(p.Nokkel).length;
  return `
    <li><a class="kort" href="#/p/${enc(p.Nokkel)}">
      <div class="kort-topp">
        <span class="kort-nr">${esc(p.ProsjektNr)}</span>
        <span class="status ${statusKlasse(p.Status)}">${esc(p.Status || '')}</span>
      </div>
      <div class="kort-navn">${esc(p.Title)}</div>
      <div class="kort-meta">
        ${p.Kunde ? `<span>${esc(p.Kunde)}</span>` : ''}
        ${antallUnder ? `<span class="muted">${antallUnder} underprosjekt${antallUnder === 1 ? '' : 'er'}</span>` : ''}
        ${p.Kontraktsstandard ? `<span class="muted">${esc(p.Kontraktsstandard)}</span>` : ''}
      </div>
      ${treff.length ? `<ul class="treff">${treff.map(u => `<li>└ ${esc(u.ProsjektNr)} ${esc(u.Title)}</li>`).join('')}</ul>` : ''}
    </a></li>`;
}

/* ---------------- Visning: prosjekt ---------------- */

const FANER = [
  ['info', 'Info'],
  ['under', 'Underprosjekter'],
  ['sjekklister', 'Sjekklister'],
  ['avvik', 'Avvik og oppgaver'],
  ['dokumenter', 'Dokumenter']
];

function brodsmuler(p) {
  const forelder = p.ForelderNokkel ? finn(p.ForelderNokkel) : null;
  return `<nav class="brodsmuler" aria-label="Plassering">
    <a href="#/" data-gaa-omr="${esc(p.Arbeidsomrade)}">${esc(SELSKAP[p.Arbeidsomrade] || p.Arbeidsomrade)}</a>
    ${forelder ? `<span>›</span><a href="#/p/${enc(forelder.Nokkel)}">${esc(forelder.ProsjektNr)} ${esc(forelder.Title)}</a>` : ''}
  </nav>`;
}

function visProsjekt(k, fane = 'info') {
  const p = finn(k);
  if (!p) { $app().innerHTML = `<div class="tom">Fant ikke prosjektet ${esc(k)}. <a href="#/">Til lista</a></div>`; return; }
  const erHoved = !p.ForelderNokkel;
  const faner = FANER.filter(([id]) => erHoved || id !== 'under');
  if (!faner.some(([id]) => id === fane)) fane = 'info';
  const antallUnder = barnAv(p.Nokkel).length;

  $app().innerHTML = `
    ${brodsmuler(p)}
    <div class="detalj-topp">
      <div>
        <div class="kort-nr">${esc(p.Arbeidsomrade)} ${esc(p.ProsjektNr)}${p.Prosjekttype && p.Prosjekttype !== 'Hovedprosjekt' ? ` · ${esc(p.Prosjekttype)}` : ''}</div>
        <h1>${esc(p.Title)}</h1>
      </div>
      <span class="status ${statusKlasse(p.Status)}">${esc(p.Status || '')}</span>
    </div>
    <div class="faner" role="tablist">
      ${faner.map(([id, navn]) => `<a role="tab" aria-selected="${id === fane}" class="fane ${id === fane ? 'valgt' : ''}" href="#/p/${enc(p.Nokkel)}/${id}">${navn}${id === 'under' && antallUnder ? ` <span class="teller">${antallUnder}</span>` : ''}</a>`).join('')}
    </div>
    <div id="faneinnhold"></div>
  `;
  $app().querySelector('[data-gaa-omr]')?.addEventListener('click', () => { tilstand.omr = p.Arbeidsomrade; skrivLokal('sp_omr', p.Arbeidsomrade); });

  const inn = document.getElementById('faneinnhold');
  if (fane === 'info') faneInfo(inn, p);
  else if (fane === 'under') faneUnder(inn, p);
  else if (fane === 'dokumenter') faneDokumenter(inn, p);
  else if (fane === 'sjekklister') inn.innerHTML = kommer('Sjekklister', 'Opprette sjekklister fra mal, fylle ut på mobil med OK / Avvik / IR, kommentar og kamera per punkt, og PDF når den er ferdig.');
  else if (fane === 'avvik') inn.innerHTML = kommer('Avvik og oppgaver', 'Avvik fra sjekklister og egne oppgaver med ansvarlig, frist og status (ikke påbegynt, pågående, fullført, lukket).');
}

const kommer = (tittel, tekst) => `<section class="seksjon kommer"><h2>${tittel} — kommer i neste versjon</h2><p class="muted">${tekst}</p></section>`;

function faneInfo(inn, p) {
  const rad = (etikett, verdi) => verdi ? `<div class="felt"><dt>${etikett}</dt><dd>${verdi}</dd></div>` : '';
  const andre = sammeJobb(p);
  const erHoved = !p.ForelderNokkel;
  inn.innerHTML = `
    <div class="knapperad"><a class="knapp" href="#/p/${enc(p.Nokkel)}/rediger">Rediger</a></div>
    <section class="seksjon">
      <h2>Prosjekt</h2>
      <dl class="felter">
        ${rad('Arbeidsområde', `${esc(p.Arbeidsomrade)} – ${esc(SELSKAP[p.Arbeidsomrade] || '')}`)}
        ${rad('Kunde', esc(p.Kunde))}
        ${rad('Adresse', esc(p.Adresse))}
        ${rad('Prosjektleder', esc(p.ProsjektlederEpost))}
        ${rad('Byggtype', esc(p.Byggtype))}
        ${rad('Fag', somListe(p.Fag).map(esc).join(', '))}
        ${rad('Oppstart', datoVis(p.Oppstart))}
        ${rad('Sluttfrist', datoVis(p.Sluttfrist))}
        ${rad('Jobbnummer', esc(p.JobbNr))}
        ${rad('Gripr-ID', esc(p.GriprId))}
        ${rad('Navn i Bemanningsoversikten', esc(p.BemanningNavn))}
      </dl>
    </section>
    ${andre.length ? `<section class="seksjon"><h2>Samme jobb i andre arbeidsområder</h2>
      <ul class="enkel">${andre.map(a => `<li><a href="#/p/${enc(a.Nokkel)}">${esc(a.Arbeidsomrade)} ${esc(a.ProsjektNr)} – ${esc(a.Title)}</a></li>`).join('')}</ul></section>` : ''}
    ${erHoved ? `<section class="seksjon">
      <h2>Kontrakt</h2>
      <dl class="felter">
        ${rad('Kontraktsstandard', esc(p.Kontraktsstandard))}
        ${rad('Entrepriseform', esc(p.Entrepriseform))}
        ${rad('Storms rolle', esc(p.StormRolle))}
        ${rad('Kontraktspart', esc(p.Kontraktspart))}
        ${rad('Kontraktssum', p.Kontraktssum != null ? Number(p.Kontraktssum).toLocaleString('nb-NO') + ' kr eks. mva.' : '')}
        ${rad('Dagmulkt', esc(p.DagmulktTekst))}
      </dl>
      ${!p.Kontraktsstandard && !p.Entrepriseform ? '<p class="muted">Ikke fylt ut ennå.</p>' : ''}
    </section>` : ''}
  `;
}

function faneUnder(inn, p) {
  const barn = barnAv(p.Nokkel);
  inn.innerHTML = `
    <div class="knapperad"><a class="knapp primar" href="#/nytt?omr=${enc(p.Arbeidsomrade)}&forelder=${enc(p.Nokkel)}">+ Nytt underprosjekt</a></div>
    ${barn.length === 0 ? '<div class="tom">Ingen underprosjekter ennå.</div>' : `
    <ul class="kortliste en-kol">${barn.map(u => `
      <li><a class="kort" href="#/p/${enc(u.Nokkel)}">
        <div class="kort-topp"><span class="kort-nr">└ ${esc(u.ProsjektNr)}${u.Prosjekttype === 'Endringsmelding' ? ' · EM' : ''}</span>
        <span class="status ${statusKlasse(u.Status)}">${esc(u.Status || '')}</span></div>
        <div class="kort-navn">${esc(u.Title)}</div>
      </a></li>`).join('')}</ul>`}
  `;
}

function faneDokumenter(inn, p) {
  inn.innerHTML = `
    <section class="seksjon">
      <h2>Prosjektmappe</h2>
      <p class="muted">Dokumenter og tegninger ligger i SharePoint (Prosjektdokumenter). Visning og opplasting rett her kommer i en senere versjon.</p>
      <div class="knapperad"><button type="button" class="knapp primar" id="aapne-mappe">Åpne prosjektmappe</button></div>
    </section>`;
  document.getElementById('aapne-mappe').addEventListener('click', () => aapneMappe(p));
}

/* ---------------- Mapper ---------------- */

const hovedMappenavn = p => trygtMappenavn(`${p.Arbeidsomrade} ${p.ProsjektNr} ${p.Title}`);
const underMappenavn = p => trygtMappenavn(`${p.ProsjektNr} ${p.Title}`);

async function finnBarnMappe(forelderSti, prefiks) {
  const did = await driveId();
  const sti = forelderSti ? `root:/${stiKode(forelderSti)}:/children` : 'root/children';
  try {
    const d = await graphGet(`/drives/${did}/${sti}?$select=name,webUrl,folder&$top=999`);
    return d.value.find(x => x.folder && x.name.startsWith(prefiks)) || null;
  } catch (e) { if (e.status === 404) return null; throw e; }
}

/** Finner mappa på nummer (tåler at navnet er endret etterpå). Returnerer {sti, mappe} */
async function finnProsjektmappe(p) {
  if (!p.ForelderNokkel) {
    const m = await finnBarnMappe('', `${p.Arbeidsomrade} ${p.ProsjektNr} `);
    return m ? { sti: m.name, mappe: m } : null;
  }
  const forelder = finn(p.ForelderNokkel);
  if (!forelder) return null;
  const fm = await finnProsjektmappe(forelder);
  if (!fm) return null;
  const base = `${fm.sti}/${UNDERPROSJEKT_MAPPE}`;
  const m = await finnBarnMappe(base, `${p.ProsjektNr} `);
  return m ? { sti: `${base}/${m.name}`, mappe: m } : null;
}

async function lagMappeTre(forelderSti, navn, mal, undermapper) {
  const rot = await lagMappe(forelderSti, navn);
  const sti = forelderSti ? `${forelderSti}/${navn}` : navn;
  for (const m of mal) {
    await lagMappe(sti, m);
    for (const u of (undermapper[m] || [])) await lagMappe(`${sti}/${m}`, u);
  }
  return { sti, mappe: rot };
}

async function lagMappestruktur(p) {
  if (!p.ForelderNokkel) return lagMappeTre('', hovedMappenavn(p), [...MAPPEMAL, UNDERPROSJEKT_MAPPE], UNDERMAPPER);
  const forelder = finn(p.ForelderNokkel);
  const fm = (await finnProsjektmappe(forelder)) || (await lagMappestruktur(forelder));
  await lagMappe(fm.sti, UNDERPROSJEKT_MAPPE);
  return lagMappeTre(`${fm.sti}/${UNDERPROSJEKT_MAPPE}`, underMappenavn(p), MAPPEMAL_UNDER, UNDERMAPPER_UNDER);
}

async function aapneMappe(p) {
  const vindu = window.open('', '_blank');   // åpnes før await, ellers blokkerer telefonen den
  try {
    let fm = await finnProsjektmappe(p);
    if (!fm) { melding('Mappa fantes ikke — lager den nå …'); fm = await lagMappestruktur(p); }
    if (vindu) vindu.location = fm.mappe.webUrl; else window.location = fm.mappe.webUrl;
  } catch (e) {
    if (vindu) vindu.close();
    console.error(e); melding('Kunne ikke åpne mappa: ' + e.message, 'feil');
  }
}

/* ---------------- Skjema (nytt / rediger) ---------------- */

function valgHtml(navn, verdi, { tom = true, etikett = v => v } = {}) {
  return `<select name="${navn}" id="f-${navn}">
    ${tom ? '<option value="">—</option>' : ''}
    ${VALG[navn].map(v => `<option value="${esc(v)}" ${v === verdi ? 'selected' : ''}>${esc(etikett(v))}</option>`).join('')}
  </select>`;
}
function flervalgHtml(navn, verdier) {
  const sett = somListe(verdier);
  return `<div class="avkrysning">${VALG[navn].map(v => `
    <label><input type="checkbox" name="${navn}" value="${esc(v)}" ${sett.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>`;
}

function visSkjema(k, params = new URLSearchParams()) {
  const p = k ? finn(k) : null;
  if (k && !p) { $app().innerHTML = `<div class="tom">Fant ikke prosjektet ${esc(k)}.</div>`; return; }
  const forelderFraUrl = params.get('forelder');
  const omr = p ? p.Arbeidsomrade : (params.get('omr') || tilstand.omr);
  const v = p || {
    Arbeidsomrade: omr, Status: 'Pågående',
    Prosjekttype: forelderFraUrl ? 'Underprosjekt' : 'Hovedprosjekt',
    ForelderNokkel: forelderFraUrl || '', ProsjektNr: nesteNr(omr)
  };
  if (!p && forelderFraUrl) { const f = finn(forelderFraUrl); if (f) { v.Kunde = f.Kunde; v.JobbNr = f.JobbNr; v.Adresse = f.Adresse; v.ProsjektlederEpost = f.ProsjektlederEpost; } }
  const tilbake = p ? `#/p/${enc(p.Nokkel)}` : (forelderFraUrl ? `#/p/${enc(forelderFraUrl)}/under` : '#/');

  $app().innerHTML = `
    <a class="tilbake" href="${tilbake}">‹ Avbryt</a>
    <h1>${p ? 'Rediger prosjekt' : 'Nytt prosjekt'}</h1>
    <form id="skjema" class="skjema" novalidate>
      <section class="seksjon">
        <h2>Plassering</h2>
        <label class="etikett">Arbeidsområde
          ${p ? `<input value="${esc(omr)} – ${esc(SELSKAP[omr])}" readonly><input type="hidden" name="Arbeidsomrade" value="${esc(omr)}">`
              : valgHtml('Arbeidsomrade', omr, { tom: false, etikett: o => `${o} – ${SELSKAP[o]}` })}
        </label>
        <label class="etikett">Type ${valgHtml('Prosjekttype', v.Prosjekttype, { tom: false })}</label>
        <label class="etikett" id="forelder-felt">Hovedprosjekt
          <select name="ForelderNokkel" id="f-ForelderNokkel"></select>
        </label>
      </section>

      <section class="seksjon">
        <h2>Grunndata</h2>
        <label class="etikett">Prosjektnummer *
          <input name="ProsjektNr" id="f-ProsjektNr" inputmode="numeric" required value="${esc(v.ProsjektNr)}" ${p ? 'readonly' : ''}>
        </label>
        <p class="hint" id="nr-hint">${p ? 'Prosjektnummeret kan ikke endres — det kobler sammen lister og mappe.' : ''}</p>
        <label class="etikett">Navn *
          <input name="Title" required value="${esc(v.Title)}" placeholder="f.eks. Datasenter Tørdal / EM 12 - Vinterarbeider">
        </label>
        <label class="etikett">Status ${valgHtml('Status', v.Status, { tom: false })}</label>
        <label class="etikett">Kunde <input name="Kunde" value="${esc(v.Kunde)}"></label>
        <label class="etikett">Adresse <input name="Adresse" value="${esc(v.Adresse)}"></label>
        <label class="etikett">Prosjektleder (e-post) <input name="ProsjektlederEpost" type="email" value="${esc(v.ProsjektlederEpost)}" placeholder="navn@stormentreprenor.no"></label>
        <label class="etikett">Jobbnummer <input name="JobbNr" inputmode="numeric" value="${esc(v.JobbNr)}" placeholder="SE-nummeret, f.eks. 20652"></label>
        <p class="hint">Samme jobb i flere arbeidsområder (f.eks. SE 20652, SB 317, SS 80) kobles sammen med samme jobbnummer.</p>
        <label class="etikett">Gripr-ID <input name="GriprId" value="${esc(v.GriprId)}" placeholder="valgfritt"></label>
      </section>

      <section class="seksjon" id="hoved-felter">
        <h2>Bygg og kontrakt <span class="muted liten">(kan fylles ut senere)</span></h2>
        <label class="etikett">Byggtype ${valgHtml('Byggtype', v.Byggtype)}</label>
        <div class="etikett">Fag${flervalgHtml('Fag', v.Fag)}</div>
        <div class="to-kol">
          <label class="etikett">Oppstart <input type="date" name="Oppstart" value="${datoInput(v.Oppstart)}"></label>
          <label class="etikett">Sluttfrist <input type="date" name="Sluttfrist" value="${datoInput(v.Sluttfrist)}"></label>
        </div>
        <label class="etikett">Kontraktsstandard ${valgHtml('Kontraktsstandard', v.Kontraktsstandard)}</label>
        <label class="etikett">Entrepriseform ${valgHtml('Entrepriseform', v.Entrepriseform)}</label>
        <label class="etikett">Storms rolle ${valgHtml('StormRolle', v.StormRolle)}</label>
        <label class="etikett">Kontraktspart <input name="Kontraktspart" value="${esc(v.Kontraktspart)}" placeholder="byggherre eller hovedentreprenør"></label>
        <label class="etikett">Kontraktssum eks. mva. <input name="Kontraktssum" inputmode="numeric" value="${v.Kontraktssum ?? ''}"></label>
        <label class="etikett">Dagmulkt <input name="DagmulktTekst" value="${esc(v.DagmulktTekst)}" placeholder="f.eks. 1 ‰ per dag, maks 10 %"></label>
        <label class="etikett">Navn i Bemanningsoversikten <input name="BemanningNavn" value="${esc(v.BemanningNavn)}" placeholder="valgfritt"></label>
      </section>

      <div class="knapperad">
        <button type="submit" class="knapp primar" id="lagre">${p ? 'Lagre endringer' : 'Opprett prosjekt og mappe'}</button>
      </div>
    </form>
  `;

  const form = document.getElementById('skjema');
  const omrSel = form.querySelector('[name=Arbeidsomrade]');
  const typeSel = document.getElementById('f-Prosjekttype');
  const forSel = document.getElementById('f-ForelderNokkel');
  const nrInp = document.getElementById('f-ProsjektNr');

  function oppdaterForeldre() {
    const o = omrSel.value;
    const valgt = forSel.value || v.ForelderNokkel;
    const kandidater = hovedIOmr(o).filter(h => !p || h.Nokkel !== p.Nokkel);
    forSel.innerHTML = `<option value="">— velg hovedprosjekt —</option>` +
      kandidater.map(h => `<option value="${esc(h.Nokkel)}" ${h.Nokkel === valgt ? 'selected' : ''}>${esc(h.ProsjektNr)} ${esc(h.Title)}</option>`).join('');
    const erHoved = typeSel.value === 'Hovedprosjekt';
    document.getElementById('forelder-felt').hidden = erHoved;
    document.getElementById('hoved-felter').hidden = !erHoved;
    if (!p) document.getElementById('nr-hint').textContent = `Neste ledige nummer i ${SELSKAP[o]}: ${nesteNr(o)}.`;
  }
  omrSel.addEventListener('change', () => { if (!p) nrInp.value = nesteNr(omrSel.value); oppdaterForeldre(); });
  typeSel.addEventListener('change', oppdaterForeldre);
  oppdaterForeldre();

  form.addEventListener('submit', e => { e.preventDefault(); lagreSkjema(p); });
}

function lesSkjema(form) {
  const fd = new FormData(form);
  const t = k => (fd.get(k) || '').toString().trim();
  const type = t('Prosjekttype') || 'Hovedprosjekt';
  const erHoved = type === 'Hovedprosjekt';
  const sum = t('Kontraktssum').replace(/[\s.]/g, '').replace(',', '.');
  const f = {
    Arbeidsomrade: t('Arbeidsomrade'),
    ProsjektNr: t('ProsjektNr'),
    Title: t('Title'),
    Prosjekttype: type,
    ForelderNokkel: erHoved ? '' : t('ForelderNokkel'),
    Status: t('Status') || 'Pågående',
    Kunde: t('Kunde'),
    Adresse: t('Adresse'),
    ProsjektlederEpost: t('ProsjektlederEpost'),
    JobbNr: t('JobbNr'),
    GriprId: t('GriprId')
  };
  if (erHoved) Object.assign(f, {
    Byggtype: t('Byggtype') || null,
    Fag: fd.getAll('Fag'),
    Oppstart: datoTilSP(t('Oppstart')),
    Sluttfrist: datoTilSP(t('Sluttfrist')),
    Kontraktsstandard: t('Kontraktsstandard') || null,
    Entrepriseform: t('Entrepriseform') || null,
    StormRolle: t('StormRolle') || null,
    Kontraktspart: t('Kontraktspart'),
    Kontraktssum: sum ? Number(sum) : null,
    DagmulktTekst: t('DagmulktTekst'),
    BemanningNavn: t('BemanningNavn')
  });
  f.Nokkel = nokkel(f.Arbeidsomrade, f.ProsjektNr);
  return f;
}

async function lagreSkjema(eksisterende) {
  const form = document.getElementById('skjema');
  const knapp = document.getElementById('lagre');
  const f = lesSkjema(form);

  if (!/^\d{1,6}$/.test(f.ProsjektNr)) return melding('Prosjektnummeret må være 1–6 siffer.', 'feil');
  if (!f.Title) return melding('Navn mangler.', 'feil');
  if (f.Prosjekttype !== 'Hovedprosjekt' && !f.ForelderNokkel) return melding('Velg hvilket hovedprosjekt det hører til.', 'feil');
  if (f.Kontraktssum != null && !Number.isFinite(f.Kontraktssum)) return melding('Kontraktssum må være et tall.', 'feil');

  knapp.disabled = true;
  const tilbakestill = () => { knapp.disabled = false; knapp.textContent = eksisterende ? 'Lagre endringer' : 'Opprett prosjekt og mappe'; };
  try {
    if (eksisterende) {
      const { Nokkel, ProsjektNr, Arbeidsomrade, ...endringer } = f;
      await oppdaterElement(LISTER.prosjekter, eksisterende._id, endringer);
      await lastProsjekter();
      melding('Lagret.');
      location.hash = `#/p/${enc(Nokkel)}`;
    } else {
      await lastProsjekter();   // fersk sjekk mot andre brukere
      if (finn(f.Nokkel)) { tilbakestill(); return melding(`${f.Arbeidsomrade} ${f.ProsjektNr} finnes allerede.`, 'feil'); }
      knapp.textContent = 'Oppretter …';
      const nye = Object.fromEntries(Object.entries({ ...f, ProfilVersjon: 1 })
        .filter(([, x]) => x !== null && x !== '' && !(Array.isArray(x) && x.length === 0)));
      await opprettElement(LISTER.prosjekter, nye);
      await lastProsjekter();
      knapp.textContent = 'Lager mapper …';
      try { await lagMappestruktur(finn(f.Nokkel) || f); }
      catch (e) { console.error(e); melding('Prosjektet er lagret, men mappa feilet. Trykk «Åpne prosjektmappe» for å prøve igjen.', 'feil'); location.hash = `#/p/${enc(f.Nokkel)}`; return; }
      melding(`${f.Arbeidsomrade} ${f.ProsjektNr} er opprettet med mappe.`);
      location.hash = `#/p/${enc(f.Nokkel)}`;
    }
  } catch (e) {
    console.error(e); tilbakestill();
    melding('Lagring feilet: ' + e.message, 'feil');
  }
}

/* ---------------- Ruting og oppstart ---------------- */

function ruter() {
  if (!tilstand.lastet) return;
  const [sti, sporring] = (location.hash.replace(/^#/, '') || '/').split('?');
  const deler = sti.split('/').filter(Boolean).map(decodeURIComponent);
  if (deler[0] === 'nytt') visSkjema(null, new URLSearchParams(sporring || ''));
  else if (deler[0] === 'p' && deler[2] === 'rediger') visSkjema(deler[1]);
  else if (deler[0] === 'p') {
    const p = finn(deler[1]);
    if (p && p.Arbeidsomrade !== tilstand.omr) { tilstand.omr = p.Arbeidsomrade; skrivLokal('sp_omr', p.Arbeidsomrade); }
    visProsjekt(deler[1], deler[2]);
  }
  else visListe();
  window.scrollTo(0, 0);
}

// QR-kode i topplinja: virker også før innlogging
(function qrOppsett() {
  const dlg = document.getElementById('qr-dialog');
  if (!dlg) return;
  const url = 'https://wonderful-tree-047b03e03.5.azurestaticapps.net';
  document.getElementById('qr-url').textContent = url.replace('https://', '');
  const lukk = () => { dlg.hidden = true; };
  document.getElementById('qr-knapp').addEventListener('click', () => { dlg.hidden = false; });
  document.getElementById('qr-lukk').addEventListener('click', lukk);
  dlg.addEventListener('click', e => { if (e.target === dlg) lukk(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') lukk(); });
  document.getElementById('qr-kopier').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); melding('Lenken er kopiert'); } catch (_) { melding('Klarte ikke å kopiere lenken', 'feil'); }
  });
})();

(async function start() {
  try {
    await initMsal();
    const b = innloggetBruker();
    if (b) document.getElementById('topp-bruker').innerHTML =
      `<span class="bruker-navn">${esc(b.navn)}</span> <button type="button" class="lenkeknapp" id="logg-ut">Logg ut</button>`;
    document.getElementById('logg-ut')?.addEventListener('click', loggUt);
    await lastProsjekter();
    window.addEventListener('hashchange', ruter);
    ruter();
  } catch (e) {
    console.error(e);
    $app().innerHTML = `<div class="tom feil"><b>Klarte ikke å laste prosjektene.</b><br>${esc(e.message)}<br><br>
      <button class="knapp" onclick="location.reload()">Prøv igjen</button></div>`;
  }
})();
