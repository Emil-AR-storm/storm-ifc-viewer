/* ==================================================================
   sjekklister.js — Storm Prosjekter, versjon 4 (03.11.2026)
   Utfylling av sjekklister på mobil, med fotomodus.

   Sjekklister  : én rad per sjekkliste. MalSnapshot = malens Punkter-JSON
                  slik den var da sjekklista ble laget (malen kan endres etterpå).
   SjekklisteSvar: én rad per besvart punkt (SjekklisteId + PunktId).
                  Verdi    = svaret som JSON (alle svartyper)
                  Svar     = OK / Avvik / IR (for OK/Avvik-punkter og IR) – for filtrering
                  Kommentar, Bilder (JSON-liste over filer i Prosjektdokumenter)
   Bilder ligger i prosjektmappa: 07 Sjekklister og KS/Bilder/<sjekkliste>/
   (underprosjekt: Sjekklister og KS/Bilder/<sjekkliste>/).

   Alt som skal lagres går via en utboks i IndexedDB, så ingenting
   forsvinner hvis dekningen er dårlig på byggeplassen. Utboksen tømmes
   automatisk når nettet er tilbake.

   Ruter: #/s/<SjekklisteId>          utfylling
          #/s/<SjekklisteId>/rapport  utskrift / lagre som PDF
================================================================== */

const SL = {
  aktiv: null,         // { item, mal, svar: {punktId: {...}}, bildeMappe }
  filter: 'Aktive',
  fotomodus: null
};

/* ---------------- Utboks (IndexedDB) ---------------- */

const Utboks = (() => {
  let dbP = null;
  const db = () => dbP || (dbP = new Promise((ok, feil) => {
    const r = indexedDB.open('storm-prosjekter', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('utboks', { keyPath: 'nr', autoIncrement: true });
    r.onsuccess = () => ok(r.result); r.onerror = () => feil(r.error);
  }));
  const tx = async (modus, fn) => {
    const d = await db();
    return new Promise((ok, feil) => {
      const t = d.transaction('utboks', modus); const s = t.objectStore('utboks');
      const res = fn(s); t.oncomplete = () => ok(res && res.result); t.onerror = () => feil(t.error);
    });
  };
  let kjorer = false, lyttere = [];
  const varsle = async () => { const n = await antall(); lyttere.forEach(f => f(n)); };
  const leggTil = async op => { await tx('readwrite', s => s.add({ ...op, t: Date.now() })); varsle(); kjor(); };
  const alle = () => tx('readonly', s => s.getAll());
  const fjern = nr => tx('readwrite', s => s.delete(nr));
  const antall = () => tx('readonly', s => s.count());

  async function kjor() {
    if (kjorer || !navigator.onLine) return;
    kjorer = true;
    try {
      for (;;) {
        const ops = (await alle()).sort((a, b) => a.nr - b.nr);
        if (!ops.length) break;
        const op = ops[0];
        // Nyere svar på samme punkt erstatter eldre
        if (op.type === 'svar' && ops.some(o => o.type === 'svar' && o.nr > op.nr && o.sid === op.sid && o.punktId === op.punktId)) { await fjern(op.nr); continue; }
        try { await utforOp(op); await fjern(op.nr); }
        catch (e) {
          console.error('Utboks:', e);
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 401) {
            await fjern(op.nr);   // vil aldri lykkes
            melding('Klarte ikke å lagre ett svar: ' + e.message, 'feil');
          } else { setTimeout(kjor, 15000); break; }
        }
        await varsle();
      }
    } finally { kjorer = false; varsle(); }
  }
  window.addEventListener('online', kjor);
  /** Fjerner ventende operasjoner som passer (f.eks. et bilde som ikke er lastet opp ennå) */
  const fjernHvis = async pred => { for (const op of await alle()) if (pred(op)) await fjern(op.nr); varsle(); };
  return { leggTil, antall, kjor, lytt: f => lyttere.push(f), alle, fjernHvis };
})();

/** Henter (eller oppretter) svarraden for et punkt og skriver feltene */
async function skrivSvar(sid, punktId, felter) {
  const a = SL.aktiv && SL.aktiv.item.SjekklisteId === sid ? SL.aktiv : null;
  let rad = a && a.svar[punktId];
  if (!rad || !rad._id) {
    // Kan ha blitt laget fra en annen enhet — sjekk først
    const fins = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${sid}'`);
    const f = fins.filter(x => x.PunktId === punktId).sort((x, y) => String(y._endret).localeCompare(String(x._endret)))[0];
    if (f) rad = f;
  }
  const bruker = innloggetBruker();
  const alle = { ...felter, UtfortAvEpost: bruker?.epost || '', UtfortAvNavn: bruker?.navn || '', UtfortTid: new Date().toISOString() };
  if (rad && rad._id) {
    await oppdaterElement(LISTER.sjekklisteSvar, rad._id, alle);
    if (a) a.svar[punktId] = { ...(a.svar[punktId] || {}), ...alle, _id: rad._id };
  } else {
    const ny = await opprettElement(LISTER.sjekklisteSvar, { Title: punktId, SjekklisteId: sid, PunktId: punktId, ...alle });
    if (a) a.svar[punktId] = { ...(a.svar[punktId] || {}), ...ny };
  }
}

async function utforOp(op) {
  if (op.type === 'svar') return skrivSvar(op.sid, op.punktId, op.felter);
  if (op.type === 'status') return oppdaterElement(LISTER.sjekklister, op.itemId, op.felter);
  if (op.type === 'slettBilde') {
    await slettFil(op.filId);
    const fins = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${op.sid}'`);
    const rad = fins.filter(x => x.PunktId === op.punktId).sort((x, y) => String(y._endret).localeCompare(String(x._endret)))[0];
    if (rad) {
      const liste = lesJson(rad.Bilder, []).filter(b => b.id !== op.filId);
      await skrivSvar(op.sid, op.punktId, { Bilder: JSON.stringify(liste) });
    }
    return;
  }
  if (op.type === 'slettSvar') {
    for (const id of op.filIder || []) await slettFil(id);
    const fins = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${op.sid}'`);
    for (const r of fins.filter(x => x.PunktId === op.punktId)) await slettElement(LISTER.sjekklisteSvar, r._id);
    return;
  }
  if (op.type === 'bilde') {
    const fil = await lastOppFil(op.mappe, op.navn, op.blob);
    const ny = { id: fil.id, navn: fil.name, url: fil.webUrl, tid: new Date(op.t).toISOString() };
    // Les gjeldende bildeliste fra SharePoint og legg til (tåler bilder fra flere enheter)
    const fins = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${op.sid}'`);
    const rad = fins.filter(x => x.PunktId === op.punktId).sort((x, y) => String(y._endret).localeCompare(String(x._endret)))[0];
    const liste = rad ? lesJson(rad.Bilder, []) : [];
    liste.push(ny);
    if (SL.aktiv && SL.aktiv.item.SjekklisteId === op.sid) {
      const s = SL.aktiv.svar[op.punktId] = SL.aktiv.svar[op.punktId] || {};
      if (rad) s._id = rad._id;
      s.Bilder = JSON.stringify(liste);
      s._lokaleBilder = (s._lokaleBilder || []).filter(b => b.lokalId !== op.lokalId);
    }
    await skrivSvar(op.sid, op.punktId, { Bilder: JSON.stringify(liste) });
    if (SL.aktiv && SL.aktiv.item.SjekklisteId === op.sid) oppdaterPunktVisning(op.punktId);
  }
}

const lesJson = (t, std) => { try { return t ? JSON.parse(t) : std; } catch (_) { return std; } };

/* ---------------- Hjelpere for mal og svar ---------------- */

const erBildepunkt = p => p.bilder || p.type === 'bilde';
const svarVerdi = (a, pid) => lesJson(a.svar[pid]?.Verdi, null);
const bilderFor = (a, pid) => [...lesJson(a.svar[pid]?.Bilder, []), ...(a.svar[pid]?._lokaleBilder || [])];

/** Er punktet synlig ut fra betingelsen? */
function synlig(a, p) {
  if (!p.visHvis) return true;
  const far = a.mal.sider.flatMap(s => s.punkter).find(q => q.id === p.visHvis.punktId);
  if (!far || !synlig(a, far)) return false;
  const v = svarVerdi(a, far.id);
  return Array.isArray(v) ? v.includes(p.visHvis.svar) : v === p.visHvis.svar;
}

function erBesvart(a, p) {
  if (p.type === 'info') return false;
  const v = svarVerdi(a, p.id);
  if (p.type === 'bilde') return bilderFor(a, p.id).length > 0;
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0 && (p.type !== 'tabell' && p.type !== 'ordrelinjer' || v.some(r => r.some(c => String(c).trim())));
  if (typeof v === 'object') return Object.values(v).some(x => String(x).trim());
  return true;
}

function fremdrift(a) {
  // Fast tekst og interne sider teller ikke i fremdriften
  const pk = a.mal.sider.filter(s => !s.intern).flatMap(s => s.punkter).filter(p => p.type !== 'info' && synlig(a, p));
  const besvart = pk.filter(p => erBesvart(a, p)).length;
  const mangler = pk.filter(p => p.obligatorisk && !erBesvart(a, p));
  const avvik = pk.filter(p => svarVerdi(a, p.id) === 'DEVIATION').length;
  return { totalt: pk.length, besvart, mangler, avvik };
}

/* ---------------- Fane på prosjektet ---------------- */

async function faneSjekklister(inn, p, liste = null) {
  if (SL.sokFor !== p.Nokkel) { SL.sok = ''; SL.sokFor = p.Nokkel; }
  if (!liste) {
    inn.innerHTML = '<p class="laster">Laster sjekklister …</p>';
    try { liste = await hentElementerFilter(LISTER.sjekklister, `fields/ProsjektNokkel eq '${p.Nokkel}'`); }
    catch (e) { console.error(e); inn.innerHTML = `<div class="tom feil">Klarte ikke å laste sjekklistene.<br>${esc(e.message)}</div>`; return; }
  }
  const filtre = { Aktive: s => s.Status !== 'Fullført' && s.Status !== 'Lukket', Fullført: s => s.Status === 'Fullført' || s.Status === 'Lukket', Alle: () => true };
  const iFilter = liste.filter(filtre[SL.filter] || filtre.Alle).sort((x, y) => String(y.Created || y._endret).localeCompare(String(x.Created || x._endret)));
  const passerSok = x => { const q = (SL.sok || '').trim().toLowerCase(); return !q || `${x.Title} ${x.MalId || ''} ${x.AnsvarligEpost || ''}`.toLowerCase().includes(q); };
  let vis = iFilter.filter(passerSok);
  const velger = !!SL.slettModus;
  const valgte = SL.valgte = SL.valgte || new Set();
  [...valgte].forEach(id => { if (!vis.some(x => x.SjekklisteId === id)) valgte.delete(id); });
  const kortInnhold = s => `
        <div class="kort-topp"><span class="kort-nr">${esc(s.MalId || '')}${s.Frist ? ` · frist ${datoVis(s.Frist)}` : ''}</span>
          <span class="status ${statusKlasse(s.Status)}">${esc(s.Status || '')}</span></div>
        <div class="kort-navn">${esc(s.Title)}</div>
        <div class="kort-meta"><span class="muted">${esc(s.AnsvarligEpost || '')}</span></div>`;
  const kortDel = () => `
    ${velger && vis.length ? `<label class="velg-alle"><input type="checkbox" id="velg-alle" ${vis.length && vis.every(x => valgte.has(x.SjekklisteId)) ? 'checked' : ''}> Velg alle (${vis.length})</label>` : ''}
    ${vis.length === 0 ? `<div class="tom">${liste.length ? (SL.sok || '').trim() ? 'Ingen sjekklister passer søket.' : 'Ingen sjekklister i dette filteret.' : 'Ingen sjekklister på prosjektet ennå.'}</div>` : `
    <ul class="kortliste en-kol">${vis.map(s => velger ? `
      <li><label class="kort velgbar ${valgte.has(s.SjekklisteId) ? 'valgt' : ''}">
        <input type="checkbox" class="velg-boks" data-velg="${esc(s.SjekklisteId)}" ${valgte.has(s.SjekklisteId) ? 'checked' : ''} aria-label="Velg ${esc(s.Title)}">
        <div class="velg-innhold">${kortInnhold(s)}</div></label></li>` : `
      <li><a class="kort" href="#/s/${enc(s.SjekklisteId)}">${kortInnhold(s)}</a></li>`).join('')}</ul>`}`;
  inn.innerHTML = `
    <div class="knapperad">
      ${velger ? '' : `<button type="button" class="knapp primar" id="ny-sjekkliste">+ Ny sjekkliste</button>
      <button type="button" class="knapp" id="fra-pm">${ikon('mal')} Fra prosjektmal</button>`}
      ${liste.length ? `<button type="button" class="knapp ${velger ? 'aktiv-modus' : 'fare-knapp'}" id="slett-modus" aria-pressed="${velger}">${velger ? 'Velg sjekklistene du vil slette' : '− Slett sjekkliste'}</button>` : ''}
    </div>
    ${liste.length ? `<div class="verktoy"><input type="search" id="sl-sok" class="sok" placeholder="Søk i sjekklistene …" value="${esc(SL.sok || '')}" autocomplete="off" enterkeyhint="search" aria-label="Søk i sjekklistene"></div>` : ''}
    <div class="chips">${Object.keys(filtre).map(f => `<button type="button" class="chip ${f === SL.filter ? 'valgt' : ''}" data-slfilter="${f}">${f} (${liste.filter(filtre[f]).length})</button>`).join('')}</div>
    <div id="sl-kort">${kortDel()}</div>
    ${velger ? `<div class="lagrelinje slettlinje">
      <span class="liten" id="valgt-antall">${valgte.size ? `${valgte.size} valgt` : 'Ingen valgt'}</span>
      <div class="slettlinje-knapper">
        <button type="button" class="knapp" id="slett-avbryt-modus">Avbryt</button>
        <button type="button" class="knapp slett-valgte" id="slett-valgte" ${valgte.size ? '' : 'disabled'}>${ikon('soppel')} Slett${valgte.size ? ` (${valgte.size})` : ''}</button>
      </div></div>` : ''}
    <div id="ny-sl"></div>`;
  const tegn = () => faneSjekklister(inn, p, liste);
  inn.querySelectorAll('[data-slfilter]').forEach(b => b.addEventListener('click', () => { SL.filter = b.dataset.slfilter; tegn(); }));
  document.getElementById('ny-sjekkliste')?.addEventListener('click', () => nySjekklisteSkjema(document.getElementById('ny-sl'), p));
  document.getElementById('fra-pm')?.addEventListener('click', () => brukProsjektmalDialog(p, liste, () => faneSjekklister(inn, p)));
  document.getElementById('slett-modus')?.addEventListener('click', () => { SL.slettModus = !SL.slettModus; valgte.clear(); tegn(); });
  document.getElementById('slett-avbryt-modus')?.addEventListener('click', () => { SL.slettModus = false; valgte.clear(); tegn(); });
  const koblKort = () => {
    document.getElementById('velg-alle')?.addEventListener('change', e => { vis.forEach(x => e.target.checked ? valgte.add(x.SjekklisteId) : valgte.delete(x.SjekklisteId)); tegn(); });
    inn.querySelectorAll('[data-velg]').forEach(c => c.addEventListener('change', () => { c.checked ? valgte.add(c.dataset.velg) : valgte.delete(c.dataset.velg); tegn(); }));
  };
  koblKort();
  // Søk: bare kortene tegnes på nytt, så søkefeltet (og tastaturet) får være i fred
  const sokFelt = document.getElementById('sl-sok');
  sokFelt?.addEventListener('input', () => {
    SL.sok = sokFelt.value;
    vis = iFilter.filter(passerSok);
    document.getElementById('sl-kort').innerHTML = kortDel();
    koblKort();
  });
  document.getElementById('slett-valgte')?.addEventListener('click', async e => {
    const knapp = e.currentTarget;
    const utvalg = liste.filter(x => valgte.has(x.SjekklisteId));
    if (!utvalg.length) return;
    const tittel = utvalg.length === 1 ? `Slett sjekklista «${utvalg[0].Title}»` : `Slett ${utvalg.length} sjekklister`;
    if (!await bekreftSlett(tittel, `${utvalg.length === 1 ? 'Sjekklista' : 'Sjekklistene'} med alle svar og bilder slettes. De kan gjenopprettes fra papirkurven i SharePoint i 93 dager.`)) return;
    if (!navigator.onLine) { melding('Du må ha nett for å slette sjekklister.', 'feil'); return; }
    knapp.disabled = true;
    let ok = 0;
    for (const s of utvalg) {
      knapp.textContent = `Sletter ${ok + 1} av ${utvalg.length} …`;
      try { await slettSjekklisteData(s); ok++; liste = liste.filter(x => x !== s); valgte.delete(s.SjekklisteId); }
      catch (err) { console.error(err); melding(`Stoppet ved «${s.Title}»: ${err.message}. ${ok} er slettet. Prøv igjen.`, 'feil'); break; }
    }
    if (ok === utvalg.length) { melding(ok === 1 ? 'Sjekklista er slettet.' : `${ok} sjekklister er slettet.`); SL.slettModus = false; }
    tegn();
  });
}

/* ---------------- Velg mal (pop-up som i Gripr) ----------------
   Søk på navn, filtrer på skjematype, stjerne = favoritt (øverst i lista).
   Favoritter huskes på denne enheten. */

const lesFavoritter = () => new Set(lesJson(lesLokal('sp_malfavoritter', '[]'), []));
const skrivFavoritter = s => skrivLokal('sp_malfavoritter', JSON.stringify([...s]));

async function nySjekklisteSkjema(boks, p) {
  try { await lastMaler(); } catch (e) { melding('Klarte ikke å laste malene: ' + e.message, 'feil'); return; }
  const alleMaler = malTilstand.maler.filter(m => m.Aktiv !== false && (!m.Arbeidsomrade || m.Arbeidsomrade === 'Alle' || m.Arbeidsomrade === 'SE' || m.Arbeidsomrade === p.Arbeidsomrade));
  const typer = [...new Set(alleMaler.map(m => m.Skjematype).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
  const meg = innloggetBruker()?.epost || '';
  const st = { sok: '', type: '', valgt: null };

  const dlg = document.createElement('div');
  dlg.className = 'modal-bakgrunn'; dlg.id = 'malvelger';
  dlg.innerHTML = `
    <div class="modal malvelger" role="dialog" aria-modal="true" aria-labelledby="mv-tittel">
      <h2 id="mv-tittel">Velg en skjemamal</h2>
      <div class="mv-sokerad">
        <label class="mv-sok">${ikon('sok')}<input type="search" id="mv-sok" placeholder="Søk på navn …" autocomplete="off" aria-label="Søk på navn"></label>
        <select id="mv-type" aria-label="Skjematype"><option value="">Alle skjematyper</option>${typer.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      </div>
      <div class="mv-hode"><span id="mv-antall"></span><span>Skjematype</span></div>
      <button type="button" class="mv-spesiell" id="mv-em">${ikon('venter')}<span><b>Storm Endringsmelding (varsel)</b><br><span class="liten muted">Spesiell sjekkliste – fast skjema med EM-nummer</span></span>${ikon('hoyre')}</button>
      <ul class="mv-liste" id="mv-liste" role="listbox" aria-label="Skjemamaler"></ul>
      <div class="mv-valgt" id="mv-valgt" hidden>
        <label class="etikett-liten">Navn på sjekklista <input id="sl-navn" placeholder="f.eks. Radonduk akse A1–A4"></label>
        <div class="to-kol">
          <label class="etikett-liten">Ansvarlig (e-post) <input id="sl-ansvarlig" type="email" value="${esc(meg)}"></label>
          <label class="etikett-liten">Frist <input id="sl-frist" type="date"></label>
        </div>
      </div>
      <div class="mv-bunn">
        <button type="button" class="knapp primar" id="sl-opprett" disabled>Fyll ut</button>
        <button type="button" class="knapp" id="sl-avbryt">Avbryt</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  document.body.classList.add('modal-aapen');
  const lukk = () => { dlg.remove(); document.body.classList.remove('modal-aapen'); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') lukk(); };
  document.addEventListener('keydown', esc_);
  dlg.addEventListener('click', e => { if (e.target === dlg) lukk(); });
  document.getElementById('sl-avbryt').addEventListener('click', lukk);
  document.getElementById('mv-em').addEventListener('click', () => { lukk(); nyEndringsmelding(p); });

  const navn = document.getElementById('sl-navn');
  function tegnListe() {
    const fav = lesFavoritter();
    const q = st.sok.trim().toLowerCase();
    const liste = alleMaler
      .filter(m => (!q || m.Title.toLowerCase().includes(q)) && (!st.type || m.Skjematype === st.type))
      .sort((a, b) => (fav.has(b.MalId) - fav.has(a.MalId)) || a.Title.localeCompare(b.Title, 'nb'));
    document.getElementById('mv-antall').textContent = `Skjemamaler (${liste.length})`;
    document.getElementById('mv-liste').innerHTML = liste.length ? liste.map(m => `
      <li class="mv-rad ${st.valgt === m.MalId ? 'valgt' : ''}" role="option" aria-selected="${st.valgt === m.MalId}" data-mal="${esc(m.MalId)}" tabindex="0">
        <span class="mv-velg" aria-hidden="true">${st.valgt === m.MalId ? ikon('ok') : ''}</span>
        <button type="button" class="mv-stjerne ${fav.has(m.MalId) ? 'fav' : ''}" data-fav="${esc(m.MalId)}" aria-label="${fav.has(m.MalId) ? 'Fjern favoritt' : 'Merk som favoritt'}" aria-pressed="${fav.has(m.MalId)}">${ikon(fav.has(m.MalId) ? 'stjerne-fylt' : 'stjerne')}</button>
        <span class="mv-navn">${esc(m.Title)}</span>
        ${m.Skjematype ? `<span class="mv-type">${esc(m.Skjematype)}</span>` : '<span></span>'}
      </li>`).join('') : '<li class="mv-tom">Ingen maler passer søket.</li>';
  }
  function velg(id) {
    st.valgt = id;
    const m = finnMal(id);
    document.getElementById('mv-valgt').hidden = false;
    if (!navn.value.trim() || navn.dataset.auto) { navn.value = m.Title; navn.dataset.auto = '1'; }
    document.getElementById('sl-opprett').disabled = false;
    tegnListe();
  }
  tegnListe();
  const sok = document.getElementById('mv-sok');
  setTimeout(() => sok.focus(), 50);
  sok.addEventListener('input', () => { st.sok = sok.value; tegnListe(); });
  document.getElementById('mv-type').addEventListener('change', e => { st.type = e.target.value; tegnListe(); });
  navn.addEventListener('input', () => { delete navn.dataset.auto; });
  const lst = document.getElementById('mv-liste');
  lst.addEventListener('click', e => {
    const f = e.target.closest('[data-fav]');
    if (f) { const fav = lesFavoritter(); fav.has(f.dataset.fav) ? fav.delete(f.dataset.fav) : fav.add(f.dataset.fav); skrivFavoritter(fav); tegnListe(); return; }
    const r = e.target.closest('[data-mal]'); if (r) velg(r.dataset.mal);
  });
  lst.addEventListener('keydown', e => { const r = e.target.closest('[data-mal]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); velg(r.dataset.mal); } });

  document.getElementById('sl-opprett').addEventListener('click', async e => {
    const mal = finnMal(st.valgt);
    if (!mal) return melding('Velg en mal.', 'feil');
    if (!navn.value.trim()) return melding('Gi sjekklista et navn.', 'feil');
    const knapp = e.currentTarget; knapp.disabled = true; knapp.textContent = 'Oppretter …';
    try {
      const forelder = p.ForelderNokkel ? finn(p.ForelderNokkel) : null;
      const id = 'K' + Date.now().toString(36).toUpperCase();
      const felter = {
        Title: navn.value.trim(), SjekklisteId: id, MalId: mal.MalId, MalVersjon: Number(mal.Versjon || 1),
        MalSnapshot: mal.Punkter, Arbeidsomrade: p.Arbeidsomrade, ProsjektNokkel: p.Nokkel,
        ProsjektNr: forelder ? forelder.ProsjektNr : p.ProsjektNr, Status: 'Ikke påbegynt',
        AnsvarligEpost: document.getElementById('sl-ansvarlig').value.trim(), OpprettetAvEpost: meg
      };
      if (forelder) felter.Underprosjekt = p.ProsjektNr;
      const frist = document.getElementById('sl-frist').value;
      if (frist) felter.Frist = datoTilSP(frist);
      await opprettElement(LISTER.sjekklister, felter);
      lukk();
      location.hash = `#/s/${enc(id)}`;
    } catch (err) {
      console.error(err); knapp.disabled = false; knapp.textContent = 'Fyll ut';
      melding('Klarte ikke å opprette sjekklista: ' + err.message, 'feil');
    }
  });
}

/* ---------------- Utfylling ---------------- */

/** Henter sjekkliste + svar (og det som ligger i utboksen). null hvis den ikke finnes. */
async function lastSjekklisteData(sid) {
  const [item] = await hentElementerFilter(LISTER.sjekklister, `fields/SjekklisteId eq '${sid}'`);
  if (!item) return null;
  const svarRader = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${sid}'`);
  const svar = {};
  svarRader.sort((x, y) => String(x._endret).localeCompare(String(y._endret))).forEach(r => { svar[r.PunktId] = r; });
  if (!item.MalSnapshot && !finnMal(item.MalId)) { try { await lastMaler(); } catch (_) {} }
  const mal = lesMalJson(item.MalSnapshot || finnMal(item.MalId)?.Punkter);
  nummerer(mal);
  mal.sider.forEach(s => s.punkter.forEach(q => { q._intern = s.intern; }));
  // Svar som ligger i utboksen (ikke sendt ennå) vises med en gang
  for (const op of await Utboks.alle()) {
    if (op.sid !== sid) continue;
    if (op.type === 'svar') svar[op.punktId] = { ...(svar[op.punktId] || {}), ...op.felter };
    if (op.type === 'bilde') { const s = svar[op.punktId] = svar[op.punktId] || {}; (s._lokaleBilder = s._lokaleBilder || []).push({ lokalId: op.lokalId, blobUrl: URL.createObjectURL(op.blob), navn: op.navn }); }
  }
  return { item, mal, svar, bildeMappe: null };
}

async function visSjekkliste(sid, modus) {
  if (!SL.aktiv || SL.aktiv.item.SjekklisteId !== sid) {
    $app().innerHTML = '<p class="laster">Laster sjekkliste …</p>';
    try {
      const a = await lastSjekklisteData(sid);
      if (!a) { $app().innerHTML = `<div class="tom">Fant ikke sjekklista ${esc(sid)}.</div>`; return; }
      SL.aktiv = a;
    } catch (e) { console.error(e); $app().innerHTML = `<div class="tom feil">Klarte ikke å laste sjekklista.<br>${esc(e.message)}</div>`; return; }
  }
  if (modus === 'rapport') return visRapport();
  tegnSjekkliste();
}

function tegnSjekkliste() {
  const a = SL.aktiv, s = a.item, p = finn(s.ProsjektNokkel);
  const f = fremdrift(a);
  const lukket = s.Status === 'Fullført' || s.Status === 'Lukket';
  const antBildepunkt = a.mal.sider.flatMap(x => x.punkter).filter(q => erBildepunkt(q) && synlig(a, q) && fmAntall(a, q) > 0).length;   // 4.51: 0 = ikke i fotomodus
  $app().innerHTML = `
    <nav class="brodsmuler">${p ? `<a href="#/p/${enc(p.Nokkel)}/sjekklister">${esc(p.Arbeidsomrade)} ${esc(p.ProsjektNr)} ${esc(p.Title)}</a>` : `<a href="#/">Prosjekter</a>`}</nav>
    <div class="detalj-topp">
      <div><div class="kort-nr">${esc(s.MalId)} v${esc(s.MalVersjon || 1)}${s.Frist ? ` · frist ${datoVis(s.Frist)}` : ''}</div><h1>${esc(s.Title)}</h1></div>
      <span class="status ${statusKlasse(s.Status)}">${esc(s.Status)}</span>
    </div>
    <div class="fremdrift"><div class="fremdrift-strek"><span style="width:${f.totalt ? Math.round(100 * f.besvart / f.totalt) : 0}%"></span></div>
      <span class="liten">${f.besvart} av ${f.totalt} besvart${f.avvik ? ` · <b class="avvik-tekst">${f.avvik} avvik</b>` : ''}</span>
      <span class="liten muted" id="utboks-status"></span></div>
    <div class="knapperad">
      ${!lukket && antBildepunkt ? `<button type="button" class="knapp primar" id="fotomodus">${ikon('kamera')} Ta bilder (${antBildepunkt} punkter)</button>` : ''}
      <a class="knapp" href="#/s/${enc(s.SjekklisteId)}/rapport">Rapport / PDF</a>
      <button type="button" class="knapp" id="sl-epost">${ikon('epost')} Send på e-post</button>
      ${typeof pdfSprakKnapp === 'function' ? pdfSprakKnapp() : ''}
    </div>
    ${erEM(a) ? emPanelHtml(a, lukket) : ''}
    ${lukket ? `<div class="seksjon info-boks">${erEM(a) ? `${ikon('venter')} Signert og låst${s.FullfortAvEpost ? ` av ${esc(navnFraEpost(s.FullfortAvEpost))}` : ''}${s.FullfortTid ? ` ${tidVis(s.FullfortTid)}` : ''} (versjon ${esc(s.EmVersjon || 1)}). Trykk «Ny versjon» for å endre – den signerte PDF-en blir liggende i prosjektmappa. Intern oppfølging kan fylles ut som før.`
      : `Sjekklista er ${esc(s.Status.toLowerCase())}${s.FullfortAvEpost ? ` av ${esc(s.FullfortAvEpost)}` : ''}${s.FullfortTid ? ` ${datoVis(s.FullfortTid)}` : ''}. Svarene er låst.`}
      <div class="knapperad"><button type="button" class="knapp" id="gjenaapne">${erEM(a) ? 'Ny versjon' : 'Åpne for endring'}</button></div></div>` : ''}
    <div id="sider">${a.mal.sider.map(side => `
      <section class="seksjon sl-side">
        <h2>${esc(side.tittel)}${side.intern ? ' <span class="intern-merke">Intern – kommer ikke med i PDF-en</span>' : ''}</h2>${side.beskrivelse ? `<p class="muted liten">${esc(side.beskrivelse)}</p>` : ''}
        <div class="sl-punkter">${side.punkter.map(q => `<div class="sl-punkt-hylse" data-hylse="${esc(q.id)}">${synlig(a, q) ? punktUtfyllHtml(a, q, lukket && !q._intern) : ''}</div>`).join('')}</div>
      </section>`).join('')}</div>
    ${signaturHtml(a, lukket)}
    ${lukket ? '' : `<div class="lagrelinje"><span class="liten" id="mangler-tekst">${f.mangler.length ? `${f.mangler.length} obligatoriske gjenstår` : 'Alle obligatoriske er besvart'}</span>
      ${erEM(a) && typeof pdfSprakKnapp === 'function' ? pdfSprakKnapp() : ''}<button type="button" class="knapp primar" id="fullfor">${erEM(a) ? 'Ferdig – lås og lagre PDF' : 'Fullfør'}</button></div>`}
  `;
  koblUtfylling(lukket);
  document.getElementById('sl-epost')?.addEventListener('click', () => sendSjekklisteEpost(a));
  visUtboksStatus();
}

const ORDRE_KOL = ['Produkt', 'Antall', 'Enhet', 'Enhetspris', 'Påslag %', 'MVA %'];
const ORDRE_NY = () => ['', '', 'stk', '', '0', '25'];
/** Ordrelinjer klar for rapport/PDF. salgspris: enhetspris inkl. påslag, uten påslagskolonne (kostpris vises ikke). */
function ordreTabell(q, v) {
  let eks = 0, mva = 0;
  const rader = v.filter(r => r.some(c => String(c ?? '').trim())).map(r => {
    const sum = tall(r[1]) * tall(r[3]) * (1 + tall(r[4]) / 100); eks += sum; mva += sum * tall(r[5]) / 100;
    if (q.salgspris && q.kilde) return [r[0] || '', r[1] || '', r[2] || '', kr(tall(r[3]) * (1 + tall(r[4]) / 100)), r[6] || '', `${r[5] || 0} %`, kr(sum)];
    if (q.salgspris) return [r[0] || '', r[1] || '', r[2] || '', kr(tall(r[3]) * (1 + tall(r[4]) / 100)), `${r[5] || 0} %`, kr(sum)];
    return [r[0] || '', r[1] || '', r[2] || '', r[3] || '', r[4] || '', r[5] || '', kr(sum)];
  });
  const kol = q.salgspris && q.kilde ? ['Produkt / beskrivelse', 'Antall', 'Enhet', 'Enhetspris', 'Prisgrunnlag', 'MVA', 'Sum eks. mva'] : q.salgspris ? ['Produkt / beskrivelse', 'Antall', 'Enhet', 'Enhetspris', 'MVA', 'Sum eks. mva'] : ['Produkt', 'Antall', 'Enhet', 'Enhetspris', 'Påslag %', 'MVA %', 'Sum'];
  return { kol, rader, eks, mva };
}
const tall = x => { const n = parseFloat(String(x ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const kr = n => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const initialer = navn => String(navn || '?').split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
const navnFraEpost = e => String(e || '').split('@')[0].split('.').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
const tidVis = iso => { const d = new Date(iso); return `${d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`; };

function radRader(a, p) {
  const v = svarVerdi(a, p.id);
  const kladd = a.kladd && a.kladd[p.id];
  if (kladd) return kladd;
  if (Array.isArray(v) && v.length) return v;
  return [p.type === 'ordrelinjer' ? ORDRE_NY() : p.kolonner.map(() => '')];
}

function punktUtfyllHtml(a, p, lukket) {
  if (p.type === 'info') return `<div class="sl-info" data-punkt="${esc(p.id)}" id="sp-${esc(p.id)}">${esc(p.tekst)}${p.hjelpetekst ? `<div class="sl-hjelp">${esc(p.hjelpetekst)}</div>` : ''}</div>`;
  const v = svarVerdi(a, p.id), rad = a.svar[p.id] || {};
  const dis = lukket ? 'disabled' : '';
  let felt = '';
  if (FASTE_SVAR[p.type]) felt = `<div class="svarknapper tre">${FASTE_SVAR[p.type].map(([k, n]) =>
    `<button type="button" class="svar svar-${k.toLowerCase()} ${v === k ? 'valgt' : ''}" data-svar="${k}" aria-pressed="${v === k}" ${dis}>${v === k ? ikon('ok', 'svar-hake') : ''}${n}</button>`).join('')}</div>`;
  else if (p.type === 'flervalg') felt = `<div class="svarknapper">${p.alternativer.map(alt => { const pa = Array.isArray(v) && v.includes(alt);
    return `<button type="button" class="svar valg ${pa ? 'valgt' : ''}" data-flervalg="${esc(alt)}" aria-pressed="${pa}" ${dis}>${pa ? ikon('ok', 'svar-hake') : ''}${esc(alt)}</button>`; }).join('')}</div>`;
  else if (p.type === 'enkeltvalg') felt = `<div class="svarknapper enkelt" role="radiogroup">${p.alternativer.map(alt => { const pa = v === alt;
    return `<button type="button" class="svar valg ${pa ? 'valgt' : ''}" data-enkeltvalg="${esc(alt)}" role="radio" aria-checked="${pa}" ${dis}>${pa ? ikon('ok', 'svar-hake') : ''}${esc(alt)}</button>`; }).join('')}</div>`;
  else if (p.type === 'linje') felt = `<input type="text" data-verdi value="${esc(v || '')}" placeholder="Skriv svar" ${dis}>`;
  else if (p.type === 'tall') felt = `<input type="text" inputmode="decimal" data-verdi value="${esc(v || '')}" placeholder="Tall" ${dis}>`;
  else if (p.type === 'dato') felt = `<input type="date" data-verdi value="${esc(v || '')}" ${dis}>`;
  else if (p.type === 'tabell') {
    const kol = p.kolonner, rader = radRader(a, p);
    felt = `<div class="tabell-utfyll" style="--kol:${kol.length}">
      <div class="t-hode">${kol.map(k => `<span>${esc(k)}</span>`).join('')}<span></span></div>
      ${rader.map((r, ri) => `<div class="t-rad">${kol.map((_, ci) => `<label class="t-celle"><span class="t-etikett">${esc(kol[ci])}</span><input data-celle="${ri},${ci}" value="${esc(r[ci] || '')}" aria-label="${esc(kol[ci])} rad ${ri + 1}" ${dis}></label>`).join('')}
        ${lukket ? '<span></span>' : `<button type="button" class="ikon fare" data-fjern-rad="${ri}" aria-label="Fjern rad ${ri + 1}">${ikon('lukk')}</button>`}</div>`).join('')}
      ${lukket ? '' : `<button type="button" class="lenkeknapp mork" data-ny-rad>${ikon('pluss')} Ny rad</button>`}</div>`;
  }
  else if (p.type === 'ordrelinjer') {
    const rader = radRader(a, p);
    let eks = 0, mva = 0;
    const linjer = rader.map((r, ri) => {
      const sum = tall(r[1]) * tall(r[3]) * (1 + tall(r[4]) / 100); eks += sum; mva += sum * tall(r[5]) / 100;
      return `<div class="o-rad">
        <input class="o-produkt" data-celle="${ri},0" value="${esc(r[0] || '')}" placeholder="Produkt / beskrivelse" aria-label="Produkt rad ${ri + 1}" ${dis}>
        <label>Antall<input data-celle="${ri},1" inputmode="decimal" value="${esc(r[1] || '')}" ${dis}></label>
        <label>Enhet<input data-celle="${ri},2" value="${esc(r[2] || '')}" ${dis}></label>
        <label>Enhetspris<input data-celle="${ri},3" inputmode="decimal" value="${esc(r[3] || '')}" ${dis}></label>
        <label>Påslag %<input data-celle="${ri},4" inputmode="decimal" value="${esc(r[4] || '')}" ${dis}></label>
        <label>MVA %<input data-celle="${ri},5" inputmode="decimal" value="${esc(r[5] || '')}" ${dis}></label>
        ${p.kilde ? `<label class="o-kilde">Prisgrunnlag<select data-celle="${ri},6" ${dis}>${['', 'Kontraktspris', 'Justert pris', 'Regningsarbeid', 'Tilbud'].map(k => `<option value="${k}" ${(r[6] || '') === k ? 'selected' : ''}>${k || 'velg …'}</option>`).join('')}</select></label>` : ''}
        <span class="o-sum">${kr(sum)} kr</span>
        ${lukket ? '' : `<button type="button" class="ikon fare" data-fjern-rad="${ri}" aria-label="Fjern linje ${ri + 1}">${ikon('lukk')}</button>`}
      </div>`; }).join('');
    felt = `<div class="ordrelinjer">${p.salgspris ? '<p class="hint o-hint">Enhetspris er kostpris. PDF-en viser salgspris per enhet (med påslag) – påslag og kostpris vises bare her.</p>' : ''}${linjer}
      ${lukket ? '' : `<button type="button" class="lenkeknapp mork" data-ny-rad>${ikon('pluss')} Ny linje</button>`}
      <div class="o-total"><span>Total eks. mva</span><b>${kr(eks)} kr</b><span>MVA</span><b>${kr(mva)} kr</b><span>Total inkl. mva</span><b>${kr(eks + mva)} kr</b></div></div>`;
  }
  else if (p.type === 'grid') felt = `<div class="gridvis">${p.rader.map(r => `<div><span>${esc(r)}</span><input data-gridrad="${esc(r)}" value="${esc((v || {})[r] || '')}" ${dis}></div>`).join('')}</div>`;
  else if (p.type === 'bilde') felt = '';
  else felt = `<textarea data-verdi rows="2" ${dis} placeholder="Skriv svar">${esc(v || '')}</textarea>`;
  const bilder = bilderFor(a, p.id);
  const kanBilder = p.bilder || p.type === 'bilde';
  const visNotat = p.bilder && (rad.Kommentar || (a.visNotat && a.visNotat.has(p.id)));
  const hvem = rad.UtfortAvNavn || navnFraEpost(rad.UtfortAvEpost);
  return `
    <div class="sl-punkt ${v === 'DEVIATION' ? 'avvik' : ''} ${p.visHvis ? 'betinget' : ''}" data-punkt="${esc(p.id)}" id="sp-${esc(p.id)}">
      <div class="sl-nr">${esc(p.nr)}</div>
      <div class="sl-sporsmal">${esc(p.tekst)}${p.obligatorisk ? ' <span class="pakrevd">*</span>' : ''}</div>
      ${p.hjelpetekst ? `<div class="sl-hjelp">${esc(p.hjelpetekst)}</div>` : ''}
      ${p.type !== 'bilde' ? '<div class="sl-besvarelse">Besvarelse</div>' : ''}
      ${felt}
      ${visNotat ? `<label class="sl-notat">Notat<textarea data-kommentar rows="2" ${dis}>${esc(rad.Kommentar || '')}</textarea></label>` : ''}
      ${bilder.length ? `<div class="bilderad">${bilder.map(b => `<button type="button" class="miniatyr" data-bilde="${esc(b.id || '')}" data-lokal="${esc(b.blobUrl || '')}" aria-label="Vis bilde"><img alt="" ${b.blobUrl ? `src="${b.blobUrl}"` : ''} data-thumb="${esc(b.id || '')}">${b.blobUrl ? `<span class="venter" title="Ikke lastet opp ennå">${ikon('venter')}</span>` : ''}</button>`).join('')}</div>` : ''}
      <div class="sl-fot">
        ${rad.UtfortTid ? `<div class="sl-hvem"><span class="avatar" aria-hidden="true">${esc(initialer(hvem))}</span>
          <span><span class="liten muted">Sist endret ${esc(tidVis(rad.UtfortTid))}</span><br><b>${esc(hvem)}</b></span></div>` : '<span></span>'}
        ${lukket ? '' : `<div class="sl-handlinger">
          ${p.bilder && !visNotat ? `<button type="button" class="tekstknapp" data-notat>${ikon('notat')} Notat</button>` : ''}
          ${kanBilder ? `<label class="tekstknapp">${ikon('kamera')} Legg til bilder<input type="file" accept="image/*" multiple data-filer hidden></label>` : ''}
          ${erBesvart(a, p) || rad.Kommentar || bilder.length ? `<button type="button" class="tekstknapp fare" data-slett-punkt aria-label="Slett svar, notat og bilder på punkt ${esc(p.nr)}">${ikon('soppel')} Slett</button>` : ''}
        </div>`}
      </div>
    </div>`;
}

/** Tegner ett punkt på nytt (og punkter som avhenger av det) uten å flytte siden */
function oppdaterPunktVisning(punktId) {
  const a = SL.aktiv; if (!a) return;
  const lukket = a.item.Status === 'Fullført' || a.item.Status === 'Lukket';
  const alle = a.mal.sider.flatMap(s => s.punkter);
  const berorte = new Set([punktId]);
  let endret = true;
  while (endret) { endret = false; alle.forEach(q => { if (q.visHvis && berorte.has(q.visHvis.punktId) && !berorte.has(q.id)) { berorte.add(q.id); endret = true; } }); }
  berorte.forEach(id => {
    const h = document.querySelector(`[data-hylse="${CSS.escape(id)}"]`); if (!h) return;
    const q = alle.find(x => x.id === id);
    const ae = document.activeElement;
    const skriver = ae && h.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'file'));
    if (skriver && id === punktId) return;   // ikke avbryt skrivingen
    h.innerHTML = synlig(a, q) ? punktUtfyllHtml(a, q, lukket && !q._intern) : '';
  });
  lastMiniatyrer();
  const f = fremdrift(a);
  const strek = document.querySelector('.fremdrift-strek span'); if (strek) strek.style.width = `${f.totalt ? Math.round(100 * f.besvart / f.totalt) : 0}%`;
  const tekst = document.querySelector('.fremdrift .liten'); if (tekst) tekst.innerHTML = `${f.besvart} av ${f.totalt} besvart${f.avvik ? ` · <b class="avvik-tekst">${f.avvik} avvik</b>` : ''}`;
  const m = document.getElementById('mangler-tekst'); if (m) m.textContent = f.mangler.length ? `${f.mangler.length} obligatoriske gjenstår` : 'Alle obligatoriske er besvart';
  if (erEM(a)) oppdaterEmPanel(a);
}

function lastMiniatyrer() {
  document.querySelectorAll('img[data-thumb]:not([src])').forEach(img => {
    if (!img.dataset.thumb) return;
    bildeUrl(img.dataset.thumb, 'small').then(u => { img.src = u; }).catch(() => { img.alt = 'Bilde'; });
  });
}

function settSvar(punktId, felter, a = SL.aktiv) {
  if (!a) return;
  const sid = a.item.SjekklisteId;
  a.svar[punktId] = { ...(a.svar[punktId] || {}), ...felter, UtfortAvEpost: innloggetBruker()?.epost || '', UtfortAvNavn: innloggetBruker()?.navn || '', UtfortTid: new Date().toISOString() };
  Utboks.leggTil({ type: 'svar', sid, punktId, felter });
  if (erEM(a)) emEtterSvar(a, punktId);
  if (a.item.Status === 'Ikke påbegynt') {
    a.item.Status = 'Pågående';
    Utboks.leggTil({ type: 'status', sid, itemId: a.item._id, felter: { Status: 'Pågående' } });
    const st = document.querySelector('.detalj-topp .status'); if (st) { st.textContent = 'Pågående'; st.className = `status ${statusKlasse('Pågående')}`; }
  }
}

function koblUtfylling(lukket) {
  const a = SL.aktiv;
  const settSvarH = (pid, f) => settSvar(pid, f, a);
  const alle = a.mal.sider.flatMap(s => s.punkter);
  const punktAv = el => alle.find(q => q.id === el.closest('[data-punkt]')?.dataset.punkt);
  const sider = document.getElementById('sider');
  lastMiniatyrer();

  document.getElementById('gjenaapne')?.addEventListener('click', () => {
    if (erEM(a)) { emNyVersjon(a); return; }
    if (!confirm('Åpne sjekklista for endring igjen? Den får status Pågående.')) return;
    a.item.Status = 'Pågående';
    Utboks.leggTil({ type: 'status', sid: a.item.SjekklisteId, itemId: a.item._id, felter: { Status: 'Pågående', FullfortAvEpost: '', FullfortTid: null } });
    tegnSjekkliste();
  });
  sider.addEventListener('click', e => {
    const m = e.target.closest('.miniatyr');
    if (m) { visBilde(m.dataset.bilde, m.dataset.lokal, lukket ? null : punktAv(m)); return; }
    if (lukket && !punktAv(e.target)?._intern) return;
    if (e.target.closest('[data-slett-punkt]')) { slettPunktSvar(punktAv(e.target)); return; }
    const ev = e.target.closest('[data-enkeltvalg]');
    if (ev) { const p = punktAv(ev); const ny = svarVerdi(a, p.id) === ev.dataset.enkeltvalg ? '' : ev.dataset.enkeltvalg;
      if (erEM(a) && ny && !emTillatValg(a, p.id, ny)) return;
      settSvarH(p.id, { Verdi: ny ? JSON.stringify(ny) : '' }); oppdaterPunktVisning(p.id); return; }
    const k = e.target.closest('[data-svar]');
    if (k) { const p = punktAv(k); const ny = svarVerdi(a, p.id) === k.dataset.svar ? '' : k.dataset.svar;
      settSvarH(p.id, { Verdi: ny ? JSON.stringify(ny) : '', Svar: ny === 'OK' ? 'OK' : ny === 'DEVIATION' ? 'Avvik' : ny === 'NA' ? 'IR' : null });
      oppdaterPunktVisning(p.id); return; }
    const fv = e.target.closest('[data-flervalg]');
    if (fv) { const p = punktAv(fv); const v = new Set(svarVerdi(a, p.id) || []); v.has(fv.dataset.flervalg) ? v.delete(fv.dataset.flervalg) : v.add(fv.dataset.flervalg);
      settSvarH(p.id, { Verdi: v.size ? JSON.stringify([...v]) : '' }); oppdaterPunktVisning(p.id); return; }
    if (e.target.closest('[data-ny-rad]')) {
      const p = punktAv(e.target);
      a.kladd = a.kladd || {};
      const rader = lesRader(e.target.closest('[data-punkt]'), p);
      rader.push(p.type === 'ordrelinjer' ? ORDRE_NY() : p.kolonner.map(() => ''));
      a.kladd[p.id] = rader; oppdaterPunktVisning(p.id);
      const ny = document.querySelectorAll(`#sp-${CSS.escape(p.id)} [data-celle^="${rader.length - 1},0"]`)[0]; ny?.focus();
      return;
    }
    const fr = e.target.closest('[data-fjern-rad]');
    if (fr) {
      const p = punktAv(fr);
      const rader = lesRader(fr.closest('[data-punkt]'), p); rader.splice(Number(fr.dataset.fjernRad), 1);
      a.kladd = a.kladd || {}; a.kladd[p.id] = rader.length ? rader : null;
      lagreRader(p, rader, a); oppdaterPunktVisning(p.id); return;
    }
    if (e.target.closest('[data-notat]')) {
      const p = punktAv(e.target); (a.visNotat = a.visNotat || new Set()).add(p.id);
      oppdaterPunktVisning(p.id); document.querySelector(`#sp-${CSS.escape(p.id)} [data-kommentar]`)?.focus(); return;
    }
  });

  // Tekst, dato, tabell, grid, notat: lagres 1 sekund etter siste tastetrykk og når feltet forlates
  const timere = {};
  const lagreFelt = el => {
    const p = punktAv(el); if (!p) return;
    if (el.matches('[data-kommentar]')) return settSvarH(p.id, { Kommentar: el.value });
    if (el.matches('[data-verdi]')) return settSvarH(p.id, { Verdi: el.value.trim() ? JSON.stringify(el.value) : '' });
    if (el.matches('[data-celle]')) {
      const rader = lesRader(el.closest('[data-punkt]'), p);
      a.kladd = a.kladd || {}; a.kladd[p.id] = rader;
      lagreRader(p, rader, a);
      if (p.type === 'ordrelinjer') oppdaterOrdreSum(el.closest('[data-punkt]'), rader);
      return;
    }
    if (el.matches('[data-gridrad]')) {
      const o = {}; el.closest('.gridvis').querySelectorAll('[data-gridrad]').forEach(i => { o[i.dataset.gridrad] = i.value; });
      return settSvarH(p.id, { Verdi: Object.values(o).some(x => x.trim()) ? JSON.stringify(o) : '' });
    }
  };
  sider.addEventListener('input', e => {
    const el = e.target; if (!el.matches('[data-kommentar],[data-verdi],[data-celle],[data-gridrad]')) return;
    const p = punktAv(el); const nokkel = p.id + (el.dataset.kommentar != null ? 'k' : 'v');
    clearTimeout(timere[nokkel]); timere[nokkel] = setTimeout(() => { delete timere[nokkel]; lagreFelt(el); oppdaterFremdrift(); }, 1000);
  });
  sider.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-filer]')) { const p = punktAv(el); [...el.files].forEach(f => leggTilBilde(p, f)); el.value = ''; return; }
    if (!el.matches('[data-kommentar],[data-verdi],[data-celle],[data-gridrad]')) return;
    const p = punktAv(el); const nokkel = p.id + (el.dataset.kommentar != null ? 'k' : 'v');
    if (timere[nokkel]) { clearTimeout(timere[nokkel]); delete timere[nokkel]; }
    lagreFelt(el); oppdaterFremdrift();
    if (el.matches('[data-verdi]') && p.type === 'dato') oppdaterPunktVisning(p.id);
  });

  document.getElementById('fullfor')?.addEventListener('click', fullfor);
  koblSignatur(a, lukket);
  document.getElementById('fotomodus')?.addEventListener('click', aapneFotomodus);
}

/** Leser radene slik de står i skjemaet nå */
function lesRader(punktEl, p) {
  const ant = p.type === 'ordrelinjer' ? ORDRE_KOL.length + (p.kilde ? 1 : 0) : p.kolonner.length;
  const ut = [];
  punktEl.querySelectorAll('[data-celle]').forEach(i => {
    const [r, c] = i.dataset.celle.split(',').map(Number);
    (ut[r] = ut[r] || Array(ant).fill(''))[c] = i.value;
  });
  return ut.filter(Boolean);
}
function lagreRader(p, rader, a = SL.aktiv) {
  const tom = p.type === 'ordrelinjer' ? r => !String(r[0]).trim() && !tall(r[1]) && !tall(r[3]) : r => !r.some(c => String(c).trim());
  const v = rader.filter(r => !tom(r));
  settSvar(p.id, { Verdi: v.length ? JSON.stringify(v) : '' }, a);
}
function oppdaterOrdreSum(punktEl, rader) {
  let eks = 0, mva = 0;
  punktEl.querySelectorAll('.o-rad').forEach((el, ri) => { const r = rader[ri] || []; const sum = tall(r[1]) * tall(r[3]) * (1 + tall(r[4]) / 100); eks += sum; mva += sum * tall(r[5]) / 100; el.querySelector('.o-sum').textContent = `${kr(sum)} kr`; });
  const b = punktEl.querySelectorAll('.o-total b'); if (b.length === 3) { b[0].textContent = `${kr(eks)} kr`; b[1].textContent = `${kr(mva)} kr`; b[2].textContent = `${kr(eks + mva)} kr`; }
}

function oppdaterFremdrift() {
  const a = SL.aktiv; if (!a) return;
  const f = fremdrift(a);
  const strek = document.querySelector('.fremdrift-strek span'); if (strek) strek.style.width = `${f.totalt ? Math.round(100 * f.besvart / f.totalt) : 0}%`;
  const m = document.getElementById('mangler-tekst'); if (m) m.textContent = f.mangler.length ? `${f.mangler.length} obligatoriske gjenstår` : 'Alle obligatoriske er besvart';
}

async function fullfor() {
  const a = SL.aktiv;
  document.activeElement?.blur();   // lagrer feltet du står i
  const f = fremdrift(a);
  if (f.mangler.length) {
    const forste = f.mangler[0];
    melding(`${f.mangler.length} obligatoriske punkter mangler svar. Første: ${forste.nr} ${forste.tekst.slice(0, 40)}`, 'feil');
    document.getElementById('sp-' + forste.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('sp-' + forste.id)?.classList.add('blink');
    return;
  }
  if (erEM(a)) {
    const feil = emSjekk(a).filter(x => x.niva === 'feil');
    if (feil.length) { melding(`Ikke klar til sending: ${feil[0].tekst}`, 'feil'); document.getElementById('em-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  }
  if (!hentSignaturer(a).length) {
    melding('Sjekklista må signeres før den kan fullføres. Skriv navnet og signer nederst, og trykk «Lagre signatur».', 'feil');
    const sig = document.getElementById('signatur'); sig?.scrollIntoView({ behavior: 'smooth', block: 'center' }); sig?.classList.add('blink');
    return;
  }
  if (!confirm(erEM(a) ? `Låse «${a.item.Title}» og lagre PDF-en i prosjektmappa?\nEtterpå kan den sendes. Endringer krever ny versjon.` : `Fullføre «${a.item.Title}»?${f.avvik ? `\nDen har ${f.avvik} avvik.` : ''}\nSvarene blir låst (kan åpnes igjen).`)) return;
  const meg = innloggetBruker()?.epost || '', naa = new Date().toISOString();
  Object.assign(a.item, { Status: 'Fullført', FullfortAvEpost: meg, FullfortTid: naa });
  await Utboks.leggTil({ type: 'status', sid: a.item.SjekklisteId, itemId: a.item._id, felter: { Status: 'Fullført', FullfortAvEpost: meg, FullfortTid: naa } });
  if (erEM(a)) { tegnSjekkliste(); await emEtterLasing(a); return; }
  melding('Sjekklista er fullført.');
  tegnSjekkliste();
  if (typeof dlEndret === 'function') setTimeout(() => dlEndret(finn(a.item.ProsjektNokkel), ['sjekklister']), 8000);   // 4.48: etter at utboksen har lagret
}

function visUtboksStatus() {
  Utboks.antall().then(n => { const el = document.getElementById('utboks-status'); if (el) el.textContent = n ? ` · ${n} venter på å bli lagret${navigator.onLine ? '' : ' (uten nett)'}` : ' · alt er lagret'; });
}
Utboks.lytt(() => visUtboksStatus());
window.addEventListener('beforeunload', e => { /* utboksen ligger trygt i IndexedDB */ });

/* ---------------- Signaturer ----------------
   Flere kan signere samme sjekkliste. Hver signatur er en egen rad i
   SjekklisteSvar med PunktId «_sig_<id>» og Verdi = {navn, bilde (PNG), tid}.
   Eldre sjekklister kan ha én signatur på selve sjekklista
   (SignaturNavn / SignaturBilde / SignaturTid) — den vises som første signatur.
   Minst én signatur kreves for å fullføre. */

const SIG_PREFIKS = '_sig_';

/** Alle lagrede signaturer på sjekklista, eldste først */
function hentSignaturer(a) {
  const liste = [];
  if (a.item.SignaturBilde) liste.push({ nokkel: '_gammel', navn: a.item.SignaturNavn || '', bilde: a.item.SignaturBilde, tid: a.item.SignaturTid || '' });
  for (const [pid, r] of Object.entries(a.svar)) {
    if (!pid.startsWith(SIG_PREFIKS) || r._slettet) continue;
    const v = lesJson(r.Verdi, null);
    if (v && v.bilde) liste.push({ nokkel: pid, navn: v.navn || '', bilde: v.bilde, tid: v.tid || '' });
  }
  return liste.sort((x, y) => String(x.tid).localeCompare(String(y.tid)));
}

const sigKortHtml = (g, lukket) => `
  <div class="sig-ferdig" data-sig="${esc(g.nokkel)}">
    <img src="${esc(g.bilde)}" alt="Signatur av ${esc(g.navn)}">
    <div class="sig-info"><b>${esc(g.navn)}</b>${g.tid ? `<br><span class="liten muted">Signert ${esc(tidVis(g.tid))}</span>` : ''}</div>
    ${lukket ? '' : `<button type="button" class="ikonknapp sig-slett" data-sig-slett="${esc(g.nokkel)}" aria-label="Slett signaturen til ${esc(g.navn)}" title="Slett signatur">${ikon('soppel')}</button>`}
  </div>`;

const sigUtkastHtml = (uid, navn) => `
  <div class="sig-utkast" data-utkast="${uid}">
    <label class="etikett-liten sig-navn">Navn <input class="sig-navn-felt" autocomplete="name" value="${esc(navn)}" placeholder="Fullt navn"></label>
    <div class="etikett-liten">Signatur <span class="muted">(tegn med musa eller fingeren)</span></div>
    <div class="sig-flate"><canvas aria-label="Signaturfelt. Tegn signaturen her."></canvas><span class="sig-linje" aria-hidden="true"></span></div>
    <div class="knapperad">
      <button type="button" class="knapp primar sig-lagre" disabled>Lagre signatur</button>
      <button type="button" class="knapp sig-tom">Tøm</button>
      <button type="button" class="knapp sig-fjern">Fjern</button>
    </div>
  </div>`;

function signaturHtml(a, lukket) {
  const sig = hentSignaturer(a);
  if (lukket) return `
    <section class="seksjon signatur" id="signatur">
      <h2>Signaturer${sig.length ? ` (${sig.length})` : ''}</h2>
      ${sig.length ? `<div class="sig-liste">${sig.map(g => sigKortHtml(g, true)).join('')}</div>` : '<p class="muted">Ikke signert.</p>'}
    </section>`;
  return `
    <section class="seksjon signatur" id="signatur">
      <h2>Signaturer <span class="sig-antall muted liten">${sig.length ? `(${sig.length})` : ''}</span></h2>
      <div class="sig-liste">${sig.map(g => sigKortHtml(g, false)).join('')}</div>
      <div class="sig-utkast-liste"></div>
      <div class="knapperad"><button type="button" class="knapp" id="sig-legg-til">${ikon('pluss')} Legg til signatur</button></div>
    </section>`;
}

function koblSignatur(a, lukket) {
  if (lukket) return;
  const seksjon = document.getElementById('signatur'); if (!seksjon) return;
  const utkastListe = seksjon.querySelector('.sig-utkast-liste');
  const oppdaterAntall = () => { const n = hentSignaturer(a).length; const el = seksjon.querySelector('.sig-antall'); if (el) el.textContent = n ? `(${n})` : ''; };

  function nyttUtkast(navn = '') {
    const uid = 'u' + Math.random().toString(36).slice(2, 8);
    utkastListe.insertAdjacentHTML('beforeend', sigUtkastHtml(uid, navn));
    koblUtkast(utkastListe.querySelector(`[data-utkast="${uid}"]`));
  }

  function koblUtkast(el) {
    const c = el.querySelector('canvas'), ctx = c.getContext('2d');
    const lagreKnapp = el.querySelector('.sig-lagre'), navnFelt = el.querySelector('.sig-navn-felt');
    let tegnet = false, tegner = false, siste = null;
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * d); c.height = Math.round(r.height * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
    const pos = e => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const oppdater = () => { lagreKnapp.disabled = !(tegnet && navnFelt.value.trim()); };
    c.addEventListener('pointerdown', e => { e.preventDefault(); c.setPointerCapture(e.pointerId); tegner = true; siste = pos(e); ctx.beginPath(); ctx.arc(siste.x, siste.y, 1.1, 0, Math.PI * 2); ctx.fill(); tegnet = true; oppdater(); });
    c.addEventListener('pointermove', e => {
      if (!tegner) return;
      for (const h of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) { const p = pos(h); ctx.beginPath(); ctx.moveTo(siste.x, siste.y); ctx.lineTo(p.x, p.y); ctx.stroke(); siste = p; }
    });
    const slutt = () => { tegner = false; };
    c.addEventListener('pointerup', slutt); c.addEventListener('pointercancel', slutt);
    navnFelt.addEventListener('input', oppdater);
    el.querySelector('.sig-tom').addEventListener('click', () => { ctx.clearRect(0, 0, c.width, c.height); tegnet = false; oppdater(); });
    el.querySelector('.sig-fjern').addEventListener('click', () => el.remove());
    lagreKnapp.addEventListener('click', async () => {
      if (erEM(a)) {
        const feil = emSjekk(a).filter(x => x.niva === 'feil');
        if (feil.length) { melding(`Kan ikke signeres før alt er fylt ut: ${feil[0].tekst}`, 'feil'); document.getElementById('em-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      }
      lagreKnapp.disabled = true;
      // Maks 600 px bredde, hvit bakgrunn, PNG (blir 10–40 kB)
      const ut = document.createElement('canvas'); const sk = Math.min(1, 600 / c.width);
      ut.width = Math.round(c.width * sk); ut.height = Math.round(c.height * sk);
      const u = ut.getContext('2d'); u.fillStyle = '#fff'; u.fillRect(0, 0, ut.width, ut.height); u.drawImage(c, 0, 0, ut.width, ut.height);
      let bilde = ut.toDataURL('image/png');
      if (bilde.length > 60000) bilde = ut.toDataURL('image/jpeg', 0.7);   // SharePoint-feltet tåler ca. 63 000 tegn
      const g = { navn: navnFelt.value.trim(), bilde, tid: new Date().toISOString() };
      const pid = SIG_PREFIKS + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const felter = { Verdi: JSON.stringify(g) };
      a.svar[pid] = { ...felter };
      await Utboks.leggTil({ type: 'svar', sid: a.item.SjekklisteId, punktId: pid, felter });
      seksjon.querySelector('.sig-liste').insertAdjacentHTML('beforeend', sigKortHtml({ nokkel: pid, ...g }, false));
      el.remove();
      oppdaterAntall();
      melding(`Signaturen til ${g.navn} er lagret.`);
    });
  }

  seksjon.addEventListener('click', async e => {
    const k = e.target.closest('[data-sig-slett]'); if (!k) return;
    const nokkel = k.dataset.sigSlett;
    const g = hentSignaturer(a).find(x => x.nokkel === nokkel); if (!g) return;
    if (!await bekreftSlett(`Slett signaturen til ${g.navn || 'ukjent'}`, 'Signaturen fjernes fra sjekklista.')) return;
    if (nokkel === '_gammel') {
      const felter = { SignaturNavn: '', SignaturBilde: '', SignaturTid: null };
      Object.assign(a.item, felter);
      await Utboks.leggTil({ type: 'status', sid: a.item.SjekklisteId, itemId: a.item._id, felter });
    } else {
      delete a.svar[nokkel];
      await Utboks.fjernHvis(op => op.type === 'svar' && op.sid === a.item.SjekklisteId && op.punktId === nokkel);
      await Utboks.leggTil({ type: 'slettSvar', sid: a.item.SjekklisteId, punktId: nokkel, filIder: [] });
    }
    seksjon.querySelector(`[data-sig="${CSS.escape(nokkel)}"]`)?.remove();
    oppdaterAntall();
    melding('Signaturen er slettet.');
  });
  document.getElementById('sig-legg-til').addEventListener('click', () => {
    nyttUtkast('');
    utkastListe.lastElementChild?.querySelector('.sig-navn-felt')?.focus();
  });
  // Ingen signaturer ennå: start med ett felt med navnet ditt
  if (!hentSignaturer(a).length) nyttUtkast(innloggetBruker()?.navn || '');
}

/* ---------------- Bilder ---------------- */

/** Skalerer ned til maks 1600 px og lager JPEG (ca. 200–500 kB) */
/* ---------- 4.41: datostempel på kamerabilder (runde H, Emil 12.11) ----------
   Bare bilder tatt med kameraet i fotomodus. Dato og klokkeslett for når bildet
   ble TATT (kameraets EXIF når den finnes, ellers nå), nede til venstre: hvit
   fet tekst i en svart boks – som Emils eksempel. Stempelet brennes inn i bildet. */
const stempelTekst = d => { const t = n => String(n).padStart(2, '0'); return `${t(d.getDate())}.${t(d.getMonth() + 1)}.${d.getFullYear()} ${t(d.getHours())}:${t(d.getMinutes())}`; };
function tegnStempel(ctx, b, h, dato) {
  if (!(dato instanceof Date) || isNaN(dato)) return;
  const tekst = stempelTekst(dato);
  const fs = Math.round(Math.max(14, Math.min(b, h) * 0.05));
  const pad = Math.round(fs * 0.45), marg = Math.round(Math.min(b, h) * 0.025);
  ctx.save();
  ctx.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  const bredde = Math.ceil(ctx.measureText(tekst).width) + pad * 2, hoyde = fs + pad * 2;
  const x = marg, y = h - marg - hoyde;
  ctx.fillStyle = 'rgba(22, 24, 28, 0.92)';
  ctx.fillRect(x, y, bredde, hoyde);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(tekst, x + pad, y + hoyde / 2 + fs * 0.04);
  ctx.restore();
}
/** Når bildet ble tatt: EXIF DateTimeOriginal (eller DateTime) i en JPEG, ellers null */
async function exifTid(fil) {
  try {
    if (!fil || !/jpe?g/i.test(fil.type || fil.name || '')) return null;
    const v = new DataView(await fil.slice(0, 131072).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const mk = v.getUint16(o), len = v.getUint16(o + 2);
      if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t0 = o + 10, le = v.getUint16(t0) === 0x4949;
        const u16 = a => v.getUint16(a, le), u32 = a => v.getUint32(a, le);
        const les = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return null; };
        const tekstAv = e => { const n = u32(e + 4), at = n > 4 ? t0 + u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < Math.min(n, 19); i++) s += String.fromCharCode(v.getUint8(at + i)); return s; };
        const ifd0 = t0 + u32(t0 + 4);
        let dt = '';
        const exifPek = les(ifd0, 0x8769);
        if (exifPek) { const e = les(t0 + u32(exifPek + 8), 0x9003); if (e) dt = tekstAv(e); }
        if (!dt) { const e = les(ifd0, 0x0132); if (e) dt = tekstAv(e); }
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(dt);
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return isNaN(d) || d.getFullYear() < 2000 ? null : d;
      }
      if ((mk & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch (_) {}
  return null;
}

async function komprimer(kilde, stempel = null) {
  let bilde;
  if (kilde instanceof HTMLVideoElement) bilde = kilde;
  else {
    try { bilde = await createImageBitmap(kilde, { imageOrientation: 'from-image' }); }
    catch (_) { bilde = await new Promise((ok, feil) => { const i = new Image(); i.onload = () => ok(i); i.onerror = feil; i.src = URL.createObjectURL(kilde); }); }
  }
  const b = bilde.videoWidth || bilde.width, h = bilde.videoHeight || bilde.height;
  const s = Math.min(1, 1600 / Math.max(b, h));
  const c = document.createElement('canvas'); c.width = Math.round(b * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(bilde, 0, 0, c.width, c.height);
  if (stempel) tegnStempel(c.getContext('2d'), c.width, c.height, stempel);   // 4.41
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.8));
}

async function bildeMappe() {
  const a = SL.aktiv;
  if (a.bildeMappe) return a.bildeMappe;
  const p = finn(a.item.ProsjektNokkel);
  if (!p) throw new Error('Fant ikke prosjektet til sjekklista.');
  const fm = (await finnProsjektmappe(p)) || (await lagMappestruktur(p));
  const ks = p.ForelderNokkel ? 'Sjekklister og KS' : '07 Sjekklister og KS';
  await lagMappe(fm.sti, ks); await lagMappe(`${fm.sti}/${ks}`, 'Bilder');
  const navn = trygtMappenavn(`${a.item.Title} ${a.item.SjekklisteId}`);
  await lagMappe(`${fm.sti}/${ks}/Bilder`, navn);
  return (a.bildeMappe = `${fm.sti}/${ks}/Bilder/${navn}`);
}

/** Mappa for PDF-er av sjekklister i prosjektmappa (07 Sjekklister og KS/PDF) */
async function pdfMappe(item) {
  const p = finn(item.ProsjektNokkel);
  if (!p) throw new Error('Fant ikke prosjektet til sjekklista.');
  if (item.MalId === 'EM-STORM') {   // Endringsmeldinger: 06 Endringer i hovedprosjektet, som i EM-flyten
    const hoved = (p.ForelderNokkel && finn(p.ForelderNokkel)) || p;
    const hm = (await finnProsjektmappe(hoved)) || (await lagMappestruktur(hoved));
    await lagMappe(hm.sti, '06 Endringer');
    if (hm.felles) { await lagMappe(`${hm.sti}/06 Endringer`, hoved.Arbeidsomrade); return `${hm.sti}/06 Endringer/${hoved.Arbeidsomrade}`; }   // 4.26
    return `${hm.sti}/06 Endringer`;
  }
  const fm = (await finnProsjektmappe(p)) || (await lagMappestruktur(p));
  const ks = p.ForelderNokkel ? 'Sjekklister og KS' : '07 Sjekklister og KS';
  await lagMappe(fm.sti, ks); await lagMappe(`${fm.sti}/${ks}`, 'PDF');
  return `${fm.sti}/${ks}/PDF`;
}

async function leggTilBilde(p, kilde) {
  const a = SL.aktiv;
  try {
    const blob = kilde instanceof Blob && kilde.type === 'image/jpeg' && kilde._ferdig ? kilde : await komprimer(kilde);
    const mappe = await bildeMappe();
    const tid = new Date();
    const lokalId = nyId('b');
    const navn = `${p.nr} ${tid.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${lokalId.slice(-4)}.jpg`;
    const s = a.svar[p.id] = a.svar[p.id] || {};
    (s._lokaleBilder = s._lokaleBilder || []).push({ lokalId, blobUrl: URL.createObjectURL(blob), navn });
    await Utboks.leggTil({ type: 'bilde', sid: a.item.SjekklisteId, punktId: p.id, mappe, navn, blob, lokalId });
    if (a.item.Status === 'Ikke påbegynt') settSvar(p.id, {});
    oppdaterPunktVisning(p.id);
    return true;
  } catch (e) { console.error(e); melding('Klarte ikke å ta vare på bildet: ' + e.message, 'feil'); return false; }
}

async function visBilde(id, lokal, punkt = null) {
  const dlg = document.createElement('div');
  dlg.className = 'bildevisning';
  dlg.innerHTML = `<img alt="Bilde"><div class="knapperad">
    ${punkt ? `<button type="button" class="knapp fare-knapp" data-slett-bilde>${ikon('soppel')} Slett bilde</button>` : ''}
    <button type="button" class="knapp" data-lukk>Lukk</button></div>`;
  document.body.appendChild(dlg);
  const lukk = () => dlg.remove();
  dlg.addEventListener('click', async e => {
    if (e.target.closest('[data-slett-bilde]')) {
      if (await bekreftSlett('Slett bilde', 'Bildet fjernes fra punktet og fra prosjektmappa.')) { lukk(); slettBilde(punkt, id, lokal); }
      return;
    }
    if (e.target.closest('[data-lukk]') || e.target === dlg || e.target.tagName === 'IMG') lukk();
  });
  try { dlg.querySelector('img').src = lokal || await bildeUrl(id, 'large'); } catch (_) { lukk(); melding('Klarte ikke å vise bildet.', 'feil'); }
}

/* ---------------- Sletting ----------------
   Alltid via bekreftelsesvinduet: kryss av «Ja», så blir Slett-knappen rød. */

function bekreftSlett(tittel, forklaring = '') {
  return new Promise(svar => {
    const dlg = document.createElement('div');
    dlg.className = 'modal-bakgrunn slett-bakgrunn';
    dlg.innerHTML = `
      <div class="modal slett-modal" role="alertdialog" aria-modal="true" aria-labelledby="slett-tittel" aria-describedby="slett-sporsmal">
        <div class="slett-ikon">${ikon('soppel')}</div>
        <h2 id="slett-tittel">${esc(tittel)}</h2>
        ${forklaring ? `<p class="slett-forklaring">${esc(forklaring)}</p>` : ''}
        <button type="button" class="slett-knapp" id="slett-ok" disabled>${ikon('soppel')} Slett</button>
        <p class="slett-sporsmal" id="slett-sporsmal">Er du sikker på at du vil slette?</p>
        <label class="slett-ja"><input type="checkbox" id="slett-ja"> Ja</label>
        <button type="button" class="knapp slett-avbryt" id="slett-avbryt">Avbryt</button>
      </div>`;
    document.body.appendChild(dlg);
    document.body.classList.add('modal-aapen');
    const ok = dlg.querySelector('#slett-ok'), ja = dlg.querySelector('#slett-ja');
    const ferdig = v => { dlg.remove(); if (!document.querySelector('.modal-bakgrunn')) document.body.classList.remove('modal-aapen'); document.removeEventListener('keydown', tast); svar(v); };
    const tast = e => { if (e.key === 'Escape') ferdig(false); };
    document.addEventListener('keydown', tast);
    ja.addEventListener('change', () => { ok.disabled = !ja.checked; ok.classList.toggle('aktiv', ja.checked); });
    ok.addEventListener('click', () => { if (ja.checked) ferdig(true); });
    dlg.querySelector('#slett-avbryt').addEventListener('click', () => ferdig(false));
    dlg.addEventListener('click', e => { if (e.target === dlg) ferdig(false); });
    setTimeout(() => ja.focus(), 50);
  });
}

async function slettBilde(p, filId, lokal) {
  const a = SL.aktiv; if (!a || !p) return;
  const s = a.svar[p.id] = a.svar[p.id] || {};
  if (lokal && !filId) {
    // Ikke lastet opp ennå: fjern fra utboksen
    const b = (s._lokaleBilder || []).find(x => x.blobUrl === lokal);
    s._lokaleBilder = (s._lokaleBilder || []).filter(x => x.blobUrl !== lokal);
    if (b) await Utboks.fjernHvis(op => op.type === 'bilde' && op.lokalId === b.lokalId);
  } else {
    s.Bilder = JSON.stringify(lesJson(s.Bilder, []).filter(b => b.id !== filId));
    await Utboks.leggTil({ type: 'slettBilde', sid: a.item.SjekklisteId, punktId: p.id, filId });
  }
  oppdaterPunktVisning(p.id);
  melding('Bildet er slettet.');
}

async function slettPunktSvar(p) {
  const a = SL.aktiv; if (!a || !p) return;
  const bilder = bilderFor(a, p.id);
  if (!await bekreftSlett(`Slett punkt ${p.nr}`, `Svaret, notatet${bilder.length ? ` og ${bilder.length} bilde${bilder.length === 1 ? '' : 'r'}` : ''} på dette punktet slettes. Selve spørsmålet blir stående i sjekklista.`)) return;
  const sid = a.item.SjekklisteId;
  await Utboks.fjernHvis(op => op.sid === sid && op.punktId === p.id && (op.type === 'svar' || op.type === 'bilde'));
  const filIder = lesJson(a.svar[p.id]?.Bilder, []).map(b => b.id).filter(Boolean);
  delete a.svar[p.id];
  if (a.visNotat) a.visNotat.delete(p.id);
  if (a.kladd) delete a.kladd[p.id];
  await Utboks.leggTil({ type: 'slettSvar', sid, punktId: p.id, filIder });
  oppdaterPunktVisning(p.id);
  melding(`Punkt ${p.nr} er tømt.`);
}

/** Sletter sjekklista med svar og bildemappe (uten spørsmål — spør med bekreftSlett først) */
async function slettSjekklisteData(s) {
  const sid = s.SjekklisteId;
  await Utboks.fjernHvis(op => op.sid === sid);
  const svar = await hentElementerFilter(LISTER.sjekklisteSvar, `fields/SjekklisteId eq '${sid}'`);
  for (const r of svar) await slettElement(LISTER.sjekklisteSvar, r._id);
  const p = finn(s.ProsjektNokkel);
  if (p) {
    try {
      const fm = await finnProsjektmappe(p);
      if (fm) await slettMappePaSti(`${fm.sti}/${p.ForelderNokkel ? 'Sjekklister og KS' : '07 Sjekklister og KS'}/Bilder/${trygtMappenavn(`${s.Title} ${sid}`)}`);
    } catch (e) { console.warn('Bildemappe:', e); }
  }
  await slettElement(LISTER.sjekklister, s._id);
  if (SL.aktiv && SL.aktiv.item.SjekklisteId === sid) SL.aktiv = null;
}

/* ---------------- Fotomodus ----------------
   Ett kameravindu. Velgeren viser bare punktene med bilder.
   Bildet havner på punktet som er valgt. */

/* 4.51 (Emil 17.11): hvor mange bilder punktet trenger før fotomodus går videre.
   Standard fra malen (antallBilder). Kan endres i fotomodus for denne sjekklista
   (huskes på enheten: sp_fm_ant_<sjekkliste>_<punkt>), f.eks. på sjekklister som
   ble laget før innstillingen fantes. */
const fmNokkel = (a, p) => `sp_fm_ant_${a.item.SjekklisteId}_${p.id}`;
function fmAntall(a, p) {
  const lok = lesLokal(fmNokkel(a, p), '');
  const v = lok !== '' && lok != null ? Number(lok) : p.antallBilder != null ? Number(p.antallBilder) : 1;
  return isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : 1;   // 0 = hoppes over i fotomodus
}
async function aapneFotomodus() {
  const a = SL.aktiv;
  const alle = a.mal.sider.flatMap(s => s.punkter).filter(p => erBildepunkt(p) && synlig(a, p));
  const punkter = alle.filter(p => fmAntall(a, p) > 0);   // 4.51: 0 bilder = hoppes over
  if (!punkter.length) { melding('Ingen punkter skal ha bilder i fotomodus. Endre «Bilder før neste punkt» i malen.', 'feil'); return; }
  const fm = SL.fotomodus = { punkter, i: Math.max(0, punkter.findIndex(p => bilderFor(a, p.id).length < fmAntall(a, p))), stream: null, autoNeste: lesLokal('sp_autoneste', '') === '1',
    retning: lesLokal('sp_kamera', 'environment') === 'user' ? 'user' : 'environment' };
  const el = document.createElement('div');
  el.className = 'fotomodus'; el.id = 'fotomodus-vindu';
  el.innerHTML = `
    <div class="fm-topp">
      <button type="button" class="fm-lukk" aria-label="Lukk kamera">${ikon('lukk')}</button>
      <div class="fm-punkt" id="fm-punkt"></div>
      <button type="button" class="fm-lukk fm-snu" id="fm-snu" aria-label="Snu kameraet" title="Snu kameraet" hidden>${ikon('snu')}</button>
    </div>
    <div class="fm-velger" id="fm-velger" role="listbox" aria-label="Velg punkt"></div>
    <div class="fm-kamera"><video id="fm-video" autoplay playsinline muted></video><div class="fm-blits" id="fm-blits"></div>
      <div class="fm-ikke-kamera" id="fm-ikke-kamera" hidden>Kameraet kunne ikke startes her. Trykk på knappen for å bruke telefonens kamera.</div></div>
    <div class="fm-bunn">
      <button type="button" class="fm-pil" id="fm-forrige" aria-label="Forrige punkt">${ikon('venstre')}</button>
      <button type="button" class="fm-utloser" id="fm-utloser" aria-label="Ta bilde"></button>
      <button type="button" class="fm-pil" id="fm-neste" aria-label="Neste punkt">${ikon('hoyre')}</button>
    </div>
    <div class="fm-auto-rad"><label class="fm-auto"><input type="checkbox" id="fm-auto" ${fm.autoNeste ? 'checked' : ''}> Gå til neste punkt når punktet har nok bilder</label>
      <div class="fm-antall" id="fm-antall" role="group" aria-label="Bilder på dette punktet"><button type="button" id="fm-ant-ned" aria-label="Færre bilder">−</button><span id="fm-ant-tekst"></span><button type="button" id="fm-ant-opp" aria-label="Flere bilder">+</button></div></div>
    <input type="file" accept="image/*" capture="${fm.retning}" id="fm-fil" data-ingen-slipp hidden>`;
  document.body.appendChild(el);
  document.body.classList.add('fm-aapen');
  tegnVelger();

  await startKamera();
  // Vis «snu»-knappen bare når enheten har mer enn ett kamera
  try {
    const kameraer = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (SL.fotomodus === fm && kameraer.length > 1) document.getElementById('fm-snu').hidden = false;
  } catch (_) {}
  document.getElementById('fm-snu').addEventListener('click', snuKamera);
  el.querySelector('.fm-lukk').addEventListener('click', lukkFotomodus);
  document.getElementById('fm-forrige').addEventListener('click', () => velgPunkt(fm.i - 1));
  document.getElementById('fm-neste').addEventListener('click', () => velgPunkt(fm.i + 1));
  document.getElementById('fm-auto').addEventListener('change', e => { fm.autoNeste = e.target.checked; skrivLokal('sp_autoneste', e.target.checked ? '1' : ''); });
  const endreAntall = d => {
    const p = fm.punkter[fm.i], ny = Math.max(0, Math.min(10, fmAntall(a, p) + d));
    if (ny === 0 && fm.punkter.length === 1) return;   // det siste punktet kan ikke fjernes her
    skrivLokal(fmNokkel(a, p), String(ny));
    if (ny === 0) { fm.punkter.splice(fm.i, 1); fm.i = Math.min(fm.i, fm.punkter.length - 1); melding(`${p.nr} hoppes over i fotomodus.`); }
    tegnVelger();
  };
  document.getElementById('fm-ant-ned').addEventListener('click', () => endreAntall(-1));
  document.getElementById('fm-ant-opp').addEventListener('click', () => endreAntall(1));
  document.getElementById('fm-velger').addEventListener('click', e => { const b = e.target.closest('[data-fm]'); if (b) velgPunkt(Number(b.dataset.fm)); });
  document.getElementById('fm-utloser').addEventListener('click', taBilde);
  document.getElementById('fm-fil').addEventListener('change', async e => {
    // 4.41: kameraet på telefonen (capture) – stempel med tiden bildet ble tatt
    for (const f of e.target.files) {
      let blob = f;
      try { blob = await komprimer(f, (await exifTid(f)) || new Date(f.lastModified || Date.now())); blob._ferdig = true; } catch (err) { console.warn('Datostempel:', err); }
      await lagreFotomodusBilde(blob);
    }
    e.target.value = '';
  });
}

/** Starter kameraet i valgt retning (bak = environment, front = user) */
async function startKamera() {
  const fm = SL.fotomodus; if (!fm) return;
  const video = document.getElementById('fm-video');
  if (fm.stream) { fm.stream.getTracks().forEach(t => t.stop()); fm.stream = null; }
  const onske = r => ({ video: { facingMode: r, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  try {
    let s;
    try { s = await navigator.mediaDevices.getUserMedia(onske({ exact: fm.retning })); }
    catch (_) { s = await navigator.mediaDevices.getUserMedia(onske({ ideal: fm.retning })); }
    if (SL.fotomodus !== fm) { s.getTracks().forEach(t => t.stop()); return; }   // lukket i mellomtiden
    fm.stream = s;
    video.srcObject = s; video.hidden = false;
    document.getElementById('fm-ikke-kamera').hidden = true;
    // Frontkameraet vises speilvendt (som et speil); selve bildet lagres riktig vei
    const faktisk = s.getVideoTracks()[0]?.getSettings?.().facingMode;
    video.classList.toggle('speil', (faktisk || fm.retning) === 'user');
  } catch (e) {
    console.warn('Kamera:', e);
    document.getElementById('fm-ikke-kamera').hidden = false;
    video.hidden = true;
  }
}

async function snuKamera() {
  const fm = SL.fotomodus; if (!fm) return;
  const knapp = document.getElementById('fm-snu'); knapp.disabled = true;
  fm.retning = fm.retning === 'user' ? 'environment' : 'user';
  skrivLokal('sp_kamera', fm.retning);
  document.getElementById('fm-fil')?.setAttribute('capture', fm.retning);
  await startKamera();
  knapp.disabled = false;
}

function tegnVelger() {
  const fm = SL.fotomodus, a = SL.aktiv;
  const v = document.getElementById('fm-velger');
  v.innerHTML = fm.punkter.map((p, i) => {
    const n = bilderFor(a, p.id).length, k = fmAntall(a, p);
    return `<button type="button" role="option" aria-selected="${i === fm.i}" class="fm-chip ${i === fm.i ? 'valgt' : ''} ${n >= k ? 'har' : n ? 'delvis' : ''}" data-fm="${i}">${esc(p.nr)}${k > 1 ? ` · ${n}/${k}` : n ? ` · ${n}` : ''}</button>`;
  }).join('');
  const p = fm.punkter[fm.i], n = bilderFor(a, p.id).length, k = fmAntall(a, p);
  document.getElementById('fm-punkt').innerHTML = `<b>${esc(p.nr)}</b> ${esc(p.tekst)}${k > 1 ? ` <span class="fm-teller">Bilde ${Math.min(n + 1, k)} av ${k}${n >= k ? ' – nok bilder' : ''}</span>` : ''}${p.hjelpetekst ? `<div class="fm-hjelp">${esc(p.hjelpetekst)}</div>` : ''}`;
  const t = document.getElementById('fm-ant-tekst'); if (t) t.textContent = k === 1 ? '1 bilde' : `${k} bilder`;
  v.querySelector('.valgt')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function velgPunkt(i) {
  const fm = SL.fotomodus;
  fm.i = Math.max(0, Math.min(fm.punkter.length - 1, i));
  tegnVelger();
}

async function taBilde() {
  const fm = SL.fotomodus;
  const video = document.getElementById('fm-video');
  if (!fm.stream || !video.videoWidth) { document.getElementById('fm-fil').click(); return; }
  const blits = document.getElementById('fm-blits');
  blits.classList.remove('vis'); void blits.offsetWidth; blits.classList.add('vis');
  if (navigator.vibrate) navigator.vibrate(30);
  const blob = await komprimer(video, new Date());   // 4.41: datostempel – tatt nå
  blob._ferdig = true;
  await lagreFotomodusBilde(blob);
}

async function lagreFotomodusBilde(kilde) {
  const fm = SL.fotomodus;
  const p = fm.punkter[fm.i];
  const ok = await leggTilBilde(p, kilde);
  // 4.51: videre først når punktet har så mange bilder som det skal ha
  if (ok && fm.autoNeste && fm.i < fm.punkter.length - 1 && bilderFor(SL.aktiv, p.id).length >= fmAntall(SL.aktiv, p)) fm.i++;
  tegnVelger();
}

function lukkFotomodus() {
  const fm = SL.fotomodus;
  if (fm?.stream) fm.stream.getTracks().forEach(t => t.stop());
  document.getElementById('fotomodus-vindu')?.remove();
  document.body.classList.remove('fm-aapen');
  SL.fotomodus = null;
}

/* ---------------- Rapport (skriv ut / lagre som PDF) ---------------- */

function visRapport() {
  const a = SL.aktiv, s = a.item, p = finn(s.ProsjektNokkel);
  const f = fremdrift(a);
  const svarTekst = q => {
    const v = svarVerdi(a, q.id);
    if (v == null || v === '') return '<span class="muted">—</span>';
    if (FASTE_SVAR[q.type]) { const n = (FASTE_SVAR[q.type].find(x => x[0] === v) || [0, v])[1]; return `<b class="r-svar r-${String(v).toLowerCase()}">${esc(n)}</b>`; }
    if (Array.isArray(v) && q.type === 'ordrelinjer') {
      const o = ordreTabell(q, v);
      return `<table class="r-tabell"><tr>${o.kol.map(k => `<th>${esc(k)}</th>`).join('')}</tr>${o.rader.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
        <tr class="r-sum"><td colspan="${o.kol.length - 1}">Total eks. mva / mva / inkl. mva</td><td>${kr(o.eks)} / ${kr(o.mva)} / <b>${kr(o.eks + o.mva)}</b></td></tr></table>`;
    }
    if (Array.isArray(v) && q.type === 'tabell') {
      const kol = q.kolonner;
      return `<table class="r-tabell"><tr>${kol.map(k => `<th>${esc(k)}</th>`).join('')}</tr>${v.map(r => `<tr>${kol.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</table>`;
    }
    if (Array.isArray(v)) return esc(v.join(', '));
    if (typeof v === 'object') return `<table class="r-tabell">${Object.entries(v).map(([k, x]) => `<tr><th>${esc(k)}</th><td>${esc(x)}</td></tr>`).join('')}</table>`;
    if (q.type === 'dato') return esc(datoVis(v));
    return esc(v).replace(/\n/g, '<br>');
  };
  let bildeNr = 0; const vedlegg = [];
  $app().innerHTML = `
    <div class="ikke-utskrift knapperad"><a class="knapp" href="#/s/${enc(s.SjekklisteId)}">${ikon('venstre')} Tilbake</a>
      <button type="button" class="knapp primar" id="rapport-pdf">${ikon('nedlast')} Last ned PDF</button>
      <button type="button" class="knapp" id="rapport-skriv">${ikon('skriver')} Skriv ut</button>
      <button type="button" class="knapp" id="rapport-epost">${ikon('epost')} Send på e-post</button>
      <button type="button" class="knapp" id="rapport-lagre">${ikon('sky')} Lagre i prosjektmappa</button>
      ${typeof pdfSprakKnapp === 'function' ? pdfSprakKnapp() : ''}
      ${(typeof AO !== 'undefined' && AO.liste.some(x => x.LogoFil)) ? `<label class="rapport-logo">Logo på PDF <select id="rapport-logo"><option value="">Selskapets valg</option><option value="innebygd">Innebygd Storm-logo</option>${AO.liste.filter(x => x.LogoFil).map(x => `<option value="${esc(x.Kode)}" ${a.logoValg === x.Kode ? 'selected' : ''}>${esc(x.Title)}</option>`).join('')}</select></label>` : ''}</div>
    <article class="rapport">
      <header class="r-hode">
        <img src="img/storm-logo-negativ.png" alt="Storm" class="r-logo">
        <div>${erEM(a) ? `<div class="r-varsel">${esc(emOverskrift(a))}</div>` : ''}<h1>${esc(s.Title)}</h1>
        <div>${p ? (pv => `${esc(SELSKAP[pv.Arbeidsomrade] || '')} · ${esc(pv.ProsjektNr)} ${esc(pv.Title)}`)(erEM(a) ? hovedFor(p) : p) : esc(s.ProsjektNokkel)}</div>
        <div class="muted liten">Mal ${esc(s.MalId)} v${esc(s.MalVersjon || 1)} · Status: ${esc(s.Status)}${s.FullfortTid ? ` · Fullført ${datoVis(s.FullfortTid)} av ${esc(s.FullfortAvEpost || '')}` : ''} · ${f.besvart} av ${f.totalt} besvart${f.avvik ? ` · ${f.avvik} avvik` : ''}</div></div>
      </header>
      ${a.mal.sider.filter(side => !side.intern).map(side => `<section class="r-side"><h2>${esc(side.tittel)}</h2>
        ${side.punkter.filter(q => synlig(a, q)).map(q => {
          if (q.type === 'info') return `<p class="r-info">${esc(q.tekst)}</p>`;
          if (q.ikkePdf) return '';
          const r = a.svar[q.id] || {}; const bilder = bilderFor(a, q.id);
          return `<div class="r-punkt ${svarVerdi(a, q.id) === 'DEVIATION' ? 'avvik' : ''}">
            <div class="r-sporsmal"><b>${esc(q.nr)}</b> ${esc(q.tekst)}</div>
            <div class="r-verdi">${svarTekst(q)}</div>
            ${r.Kommentar ? `<div class="r-kommentar">Notat: ${esc(r.Kommentar)}</div>` : ''}
            ${bilder.length ? `<div class="r-bilder">${bilder.map(b => { const n = ++bildeNr; vedlegg.push({ b, q, n }); return `<a href="#vedlegg-${n}" class="r-mini" data-hopp-bilde="${n}"><img alt="Bilde ${n}" ${b.blobUrl ? `src="${b.blobUrl}"` : ''} data-rbilde="${esc(b.id || '')}"><span>Bilde ${n}</span></a>`; }).join('')}</div>` : ''}
            ${r.UtfortTid && erBesvart(a, q) ? `<div class="utfort">${esc(r.UtfortAvNavn || navnFraEpost(r.UtfortAvEpost))} · ${esc(tidVis(r.UtfortTid))}</div>` : ''}
          </div>`;
        }).join('')}</section>`).join('')}
      <section class="r-signatur"><h2>Signaturer</h2>
        ${hentSignaturer(a).length ? `<div class="r-sig-rutenett">${hentSignaturer(a).map(g => `<div class="r-sig"><img src="${esc(g.bilde)}" alt="Signatur av ${esc(g.navn)}"><div><b>${esc(g.navn)}</b>${g.tid ? `<br><span class="liten muted">${esc(tidVis(g.tid))}</span>` : ''}</div></div>`).join('')}</div>` : '<p class="muted">Ikke signert.</p>'}
      </section>
      ${vedlegg.length ? `<section class="r-vedlegg"><h2>Vedlegg – bilder (${vedlegg.length})</h2>
        ${vedlegg.map(({ b, q, n }) => `<figure class="r-stort" id="vedlegg-${n}">
          <figcaption><b>Bilde ${n}</b> · punkt ${esc(q.nr)} ${esc(q.tekst)}</figcaption>
          <img alt="Bilde ${n}" ${b.blobUrl ? `src="${b.blobUrl}"` : ''} data-rstort="${esc(b.id || '')}"></figure>`).join('')}</section>` : ''}
    </article>`;
  document.querySelectorAll('img[data-rbilde]:not([src])').forEach(img => { if (img.dataset.rbilde) bildeUrl(img.dataset.rbilde, 'medium').then(u => { img.src = u; }).catch(() => {}); });
  document.querySelectorAll('img[data-rstort]:not([src])').forEach(img => { if (img.dataset.rstort) bildeUrl(img.dataset.rstort, 'large').then(u => { img.src = u; }).catch(() => {}); });
  // Lenkene til vedlegget: rull dit uten å bytte rute
  document.querySelectorAll('[data-hopp-bilde]').forEach(l => l.addEventListener('click', e => { e.preventDefault(); document.getElementById('vedlegg-' + l.dataset.hoppBilde)?.scrollIntoView({ behavior: 'smooth' }); }));
  document.getElementById('rapport-skriv').addEventListener('click', () => window.print());
  document.getElementById('rapport-logo')?.addEventListener('change', e => { a.logoValg = e.target.value || undefined; if (e.target.value === 'innebygd') a.logoValg = 'innebygd'; });
  if (a.logoValg) { const sel = document.getElementById('rapport-logo'); if (sel) sel.value = a.logoValg; }
  document.getElementById('rapport-pdf').addEventListener('click', e => lastNedPdf(e.currentTarget));
  document.getElementById('rapport-epost').addEventListener('click', () => sendSjekklisteEpost(a));
  document.getElementById('rapport-lagre').addEventListener('click', async e => {
    const knapp = e.currentTarget, tekst = knapp.innerHTML; knapp.disabled = true;
    try { const fil = await lagreSjekklistePdf(a, t => { knapp.textContent = t; }); melding(`Lagret i prosjektmappa: ${fil.name}`); }
    catch (err) { console.error(err); melding('Klarte ikke å lagre PDF-en: ' + err.message, 'feil'); }
    finally { knapp.disabled = false; knapp.innerHTML = tekst; }
  });
}

async function lastNedPdf(knapp) {
  const a = SL.aktiv; if (!a) return;
  const tekst = knapp.innerHTML; knapp.disabled = true;
  try {
    const doc = await lagSjekklistePdf(a, t => { knapp.textContent = t; }, { logo: a.logoValg });
    doc.save(trygtMappenavn(`${a.item.Title} ${a.item.SjekklisteId}`) + '.pdf');
    melding('PDF-en er lastet ned.');
  } catch (e) {
    console.error(e); melding('Klarte ikke å lage PDF: ' + e.message, 'feil');
  } finally { knapp.disabled = false; knapp.innerHTML = tekst; }
}
