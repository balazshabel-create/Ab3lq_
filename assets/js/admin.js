/* ==========================================================================
   Zamárdi Szépségszalon — admin vezérlőpult

   Az adatok a böngésző localStorage-ában élnek:
     zsz_foglalasok    — a weboldalról érkezett foglalások
     zsz_szolgaltatasok, zsz_kollegak, zsz_beallitasok — admin módosítások
     zsz_admin         — a belépett felhasználó (session- vagy localStorage)

   FIGYELEM: ez bemutató felület. A belépés kizárólag a böngészőben fut, ezért
   nem véd valódi adatot. Éles használat előtt szerveroldali hitelesítés és
   adatbázis kell mögé.

   Újrahasznált függvények: main.js → SALON, perc2ora, szalonIdo, statuszFrissit,
   orakKirajzol; booking.js → Ft, p2o, napISO, foglaltak, SZOLGALTATASOK, KOLLEGAK.
   ========================================================================== */

const AD = {
  nezet: 'attekintes',
  szuro: 'mind',
  kereses: '',
  hetEltolas: 0,
  belepett: null
};

/* ---------- Tár segédek ---------- */
function olvas(kulcs, alap) {
  try {
    const e = JSON.parse(localStorage.getItem(kulcs) || 'null');
    return e === null ? alap : e;
  } catch { return alap; }
}
function ir(kulcs, ertek) {
  try { localStorage.setItem(kulcs, JSON.stringify(ertek)); return true; }
  catch { toast('Nem sikerült menteni — lehet, hogy privát böngészés van bekapcsolva.', 'bad'); return false; }
}
function foglalasokIr(lista) { ir('zsz_foglalasok', lista); }

/* ---------- Pillanatüzenet ---------- */
function toast(szoveg, tipus = 'info') {
  const jelek = { ok: '✓', info: 'i', bad: '!' };
  const el = document.createElement('div');
  el.className = 'toast toast--' + tipus;
  el.innerHTML = `<span class="toast__ico">${jelek[tipus] || 'i'}</span><span></span>`;
  el.lastElementChild.textContent = szoveg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, 3600);
}

/* ---------- Belépés-ellenőrzés ---------- */
(function orseg() {
  let nyers = null;
  try { nyers = sessionStorage.getItem('zsz_admin') || localStorage.getItem('zsz_admin'); } catch { /* privát mód */ }
  if (!nyers) { location.replace('admin-belepes.html'); return; }
  try { AD.belepett = JSON.parse(nyers); }
  catch { location.replace('admin-belepes.html'); }
})();

/* ---------- Formázók ---------- */
const HU_HO = { year: 'numeric', month: 'long', day: 'numeric' };
const datumSzoveg = (iso) => {
  const [y, m, n] = iso.split('-').map(Number);
  return new Date(y, m - 1, n).toLocaleDateString('hu-HU', HU_HO);
};
const rovidDatum = (iso) => {
  const [y, m, n] = iso.split('-').map(Number);
  return new Date(y, m - 1, n).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
};
const maISO = () => napISO(new Date());

const ALLAPOTOK = {
  uj:   { cimke: 'Új kérés',      osztaly: 'badge--uj' },
  ok:   { cimke: 'Visszaigazolt', osztaly: 'badge--ok' },
  kesz: { cimke: 'Lezárt',        osztaly: 'badge--kesz' },
  nem:  { cimke: 'Lemondott',     osztaly: 'badge--nem' }
};
const allapotJelveny = (a) => {
  const inf = ALLAPOTOK[a] || ALLAPOTOK.uj;
  return `<span class="badge ${inf.osztaly}">${inf.cimke}</span>`;
};

/* Idő szerint rendezett lista */
function rendezett() {
  return foglaltak().slice().sort((a, b) =>
    a.nap === b.nap ? a.kezd - b.kezd : a.nap.localeCompare(b.nap));
}

/* ==========================================================================
   PROFIL
   ========================================================================== */
function profilKirajzol() {
  const p = AD.belepett || {};
  const kezdobetu = (p.nev || 'A').trim().charAt(0).toUpperCase();

  document.getElementById('who-nev').textContent = p.nev || 'Adminisztrátor';
  document.getElementById('who-szerep').textContent = p.szerep || 'Admin';
  document.getElementById('menu-nev').textContent = p.nev || 'Adminisztrátor';
  document.getElementById('menu-email').textContent = p.email || '—';
  document.getElementById('av-chip').firstChild.textContent = kezdobetu;
  document.getElementById('av-big').textContent = kezdobetu;

  /* Profilmenü kis statisztikái */
  const lista = foglaltak();
  const ma = maISO();
  const hetVege = napISO(new Date(Date.now() + 7 * 864e5));
  document.getElementById('ps-ma').textContent = lista.filter((f) => f.nap === ma).length;
  document.getElementById('ps-het').textContent = lista.filter((f) => f.nap >= ma && f.nap <= hetVege).length;
  document.getElementById('ps-uj').textContent = lista.filter((f) => (f.allapot || 'uj') === 'uj').length;
}

(function profilMenu() {
  const doboz = document.getElementById('profile');
  const gomb = document.getElementById('profile-btn');

  gomb.addEventListener('click', (e) => {
    e.stopPropagation();
    const nyit = !doboz.classList.contains('open');
    doboz.classList.toggle('open', nyit);
    gomb.setAttribute('aria-expanded', String(nyit));
    if (nyit) profilKirajzol();
  });
  document.addEventListener('click', (e) => {
    if (!doboz.contains(e.target)) {
      doboz.classList.remove('open');
      gomb.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { doboz.classList.remove('open'); gomb.setAttribute('aria-expanded', 'false'); }
  });
})();

document.getElementById('kilepes').addEventListener('click', () => {
  try { sessionStorage.removeItem('zsz_admin'); localStorage.removeItem('zsz_admin'); } catch { /* privát mód */ }
  toast('Kijelentkezve — viszlát!', 'ok');
  setTimeout(() => location.replace('admin-belepes.html'), 600);
});

/* ==========================================================================
   NÉZETVÁLTÁS
   ========================================================================== */
const NEZET_CIM = {
  attekintes:    ['Vezérlőpult', 'Áttekintés a mai napról'],
  foglalasok:    ['Foglalások', 'Kérések kezelése és visszaigazolása'],
  naptar:        ['Heti naptár', 'Foglalások napokra bontva'],
  szolgaltatasok:['Szolgáltatások', 'Árak és időtartamok szerkesztése'],
  csapat:        ['Csapat', 'Kollégák és szakterületeik'],
  nyitvatartas:  ['Nyitvatartás', 'Napi nyitási és zárási idők'],
  beallitasok:   ['Szalon adatai', 'Név, cím, elérhetőség']
};

function nezetre(nev) {
  if (!NEZET_CIM[nev]) return;
  AD.nezet = nev;

  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === nev));
  document.querySelectorAll('.side__link[data-view]').forEach((l) => l.classList.toggle('on', l.dataset.view === nev));

  const [cim, alcim] = NEZET_CIM[nev];
  document.getElementById('view-title').textContent = cim;
  document.getElementById('view-sub').textContent = alcim;

  document.getElementById('side').classList.remove('open');
  document.getElementById('veil').classList.remove('on');
  document.getElementById('profile').classList.remove('open');

  if (nev === 'attekintes') attekintesRajz();
  if (nev === 'foglalasok') foglalasokRajz();
  if (nev === 'naptar') naptarRajz();
  if (nev === 'szolgaltatasok') szolgRajz();
  if (nev === 'csapat') kollRajz();
  if (nev === 'nyitvatartas') { oraRajz(); orakKirajzol(); statuszFrissit(); }
  if (nev === 'beallitasok') beallitasRajz();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const cel = e.target.closest('[data-view]');
  if (cel && !cel.classList.contains('view')) nezetre(cel.dataset.view);
});

/* Mobil oldalsáv */
document.getElementById('side-btn').addEventListener('click', () => {
  const s = document.getElementById('side');
  const nyit = !s.classList.contains('open');
  s.classList.toggle('open', nyit);
  document.getElementById('veil').classList.toggle('on', nyit);
});
document.getElementById('veil').addEventListener('click', () => {
  document.getElementById('side').classList.remove('open');
  document.getElementById('veil').classList.remove('on');
});

/* ==========================================================================
   VEZÉRLŐPULT
   ========================================================================== */
function attekintesRajz() {
  const lista = rendezett();
  const ma = maISO();
  const maiak = lista.filter((f) => f.nap === ma && f.allapot !== 'nem');
  const ujak = lista.filter((f) => (f.allapot || 'uj') === 'uj');
  const jovo7 = lista.filter((f) => f.nap >= ma && f.nap <= napISO(new Date(Date.now() + 6 * 864e5)) && f.allapot !== 'nem');
  const bevetel = jovo7.reduce((ossz, f) => ossz + (f.ar || 0), 0);

  /* Kihasználtság: lefoglalt percek a heti nyitvatartás arányában */
  let nyitvaPerc = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const n = SALON.nyitva[d.getDay()];
    if (n) nyitvaPerc += n.ig - n.tol;
  }
  const foglaltPerc = jovo7.reduce((ossz, f) => ossz + (f.vege - f.kezd), 0);
  const kihasznalt = nyitvaPerc ? Math.round((foglaltPerc / nyitvaPerc) * 100) : 0;

  const CSEMPEK = [
    { cimke: 'Mai foglalás', ertek: maiak.length, ikon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
      delta: ujak.length ? `${ujak.length} új` : 'nincs új', tipus: ujak.length ? 'up' : 'flat' },
    { cimke: 'Új kérés', ertek: ujak.length, ikon: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8',
      delta: ujak.length ? 'visszaigazolásra vár' : 'mind kezelve', tipus: ujak.length ? 'down' : 'up' },
    { cimke: 'Várható bevétel (7 nap)', ertek: Ft(bevetel), ikon: 'M2 7h20v10H2zM12 12h.01M6 12h.01M18 12h.01',
      delta: `${jovo7.length} foglalás`, tipus: 'flat' },
    { cimke: 'Kihasználtság (7 nap)', ertek: kihasznalt + '%', ikon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
      delta: kihasznalt >= 60 ? 'jó' : kihasznalt >= 30 ? 'közepes' : 'van még hely',
      tipus: kihasznalt >= 60 ? 'up' : kihasznalt >= 30 ? 'flat' : 'down' }
  ];

  document.getElementById('stats').innerHTML = CSEMPEK.map((cs) => `
    <div class="stat">
      <div class="stat__top">
        <span class="stat__ico"><svg viewBox="0 0 24 24"><path d="${cs.ikon}"/></svg></span>
        <span class="stat__delta stat__delta--${cs.tipus}">${cs.delta}</span>
      </div>
      <div class="stat__val">${cs.ertek}</div>
      <div class="stat__label">${cs.cimke}</div>
    </div>`).join('');

  /* Mai menetrend */
  document.getElementById('agenda-datum').textContent =
    new Date().toLocaleDateString('hu-HU', { weekday: 'long', ...HU_HO });

  const agenda = document.getElementById('agenda');
  agenda.innerHTML = maiak.length
    ? maiak.map((f) => `
        <div class="agenda__row" data-fog="${f.id}">
          <span class="agenda__time">${p2o(f.kezd)}</span>
          <span class="agenda__pipe"></span>
          <span class="agenda__who">
            <b>${szoveg(f.vendeg)}</b>
            <span>${szoveg(f.szolgaltatas)} · ${szoveg(f.kollega)}</span>
          </span>
          ${allapotJelveny(f.allapot || 'uj')}
        </div>`).join('')
    : '<div class="agenda--empty">Ma nincs foglalás. Jó pihenést!</div>';

  /* Következő 7 nap oszlopdiagram */
  const napok = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const iso = napISO(d);
    napok.push({
      iso,
      cimke: SALON.napRovid[d.getDay()],
      db: lista.filter((f) => f.nap === iso && f.allapot !== 'nem').length,
      ma: i === 0
    });
  }
  const max = Math.max(1, ...napok.map((n) => n.db));
  document.getElementById('bars').innerHTML = napok.map((n, i) => `
    <div class="bar${n.ma ? ' bar--today' : ''}">
      <div class="bar__fill" data-val="${n.db} foglalás"
           style="height:${Math.max(4, (n.db / max) * 100)}%;animation-delay:${i * 0.06}s"></div>
      <span class="bar__lbl">${n.cimke}</span>
    </div>`).join('');

  /* Legutóbbi öt */
  const utolsok = lista.slice().sort((a, b) =>
    (b.letrehozva || '').localeCompare(a.letrehozva || '')).slice(0, 5);

  document.getElementById('recent').innerHTML = utolsok.length
    ? utolsok.map((f) => `
        <tr data-fog="${f.id}">
          <td class="tbl__guest"><b>${szoveg(f.vendeg)}</b><span>${szoveg(f.tel || '—')}</span></td>
          <td>${szoveg(f.szolgaltatas)}</td>
          <td>${rovidDatum(f.nap)}, ${p2o(f.kezd)}</td>
          <td>${szoveg(f.kollega)}</td>
          <td>${allapotJelveny(f.allapot || 'uj')}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="tbl__empty">Még nincs foglalás. Próbálja ki a weboldal foglalóját, vagy töltsön be bemutató adatokat a profilmenüből.</td></tr>';

  jelvenyFrissit();
}

/* HTML-injektálás elleni védelem a vendégadatoknál */
function szoveg(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function jelvenyFrissit() {
  const ujak = foglaltak().filter((f) => (f.allapot || 'uj') === 'uj').length;
  const jel = document.getElementById('badge-uj');
  jel.textContent = ujak;
  jel.style.display = ujak ? '' : 'none';
  document.getElementById('bell-dot').hidden = !ujak;
}

/* ==========================================================================
   FOGLALÁSOK
   ========================================================================== */
function foglalasokRajz() {
  const keres = AD.kereses.toLowerCase();
  const lista = rendezett().filter((f) => {
    const allapotOk = AD.szuro === 'mind' || (f.allapot || 'uj') === AD.szuro;
    if (!allapotOk) return false;
    if (!keres) return true;
    return [f.vendeg, f.tel, f.email, f.szolgaltatas, f.kollega]
      .some((m) => String(m || '').toLowerCase().includes(keres));
  });

  document.getElementById('fog-lista').innerHTML = lista.length
    ? lista.map((f) => {
        const a = f.allapot || 'uj';
        return `<tr data-fog="${f.id}">
          <td class="tbl__guest"><b>${szoveg(f.vendeg)}</b><span>${szoveg(f.tel || '—')}</span></td>
          <td>${szoveg(f.szolgaltatas)}</td>
          <td>${rovidDatum(f.nap)}, ${p2o(f.kezd)}–${p2o(f.vege)}</td>
          <td>${szoveg(f.kollega)}</td>
          <td>${f.ar ? Ft(f.ar) : '—'}</td>
          <td>${allapotJelveny(a)}</td>
          <td>
            <div class="row-acts">
              ${a === 'uj' ? `<button class="mini mini--ok" data-akcio="ok" data-id="${f.id}">Visszaigazol</button>` : ''}
              ${a === 'ok' ? `<button class="mini mini--ok" data-akcio="kesz" data-id="${f.id}">Lezár</button>` : ''}
              <button class="mini" data-akcio="reszlet" data-id="${f.id}">Részletek</button>
            </div>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" class="tbl__empty">Nincs a szűrésnek megfelelő foglalás.</td></tr>`;

  jelvenyFrissit();
}

document.getElementById('fog-kereso').addEventListener('input', (e) => {
  AD.kereses = e.target.value;
  foglalasokRajz();
});
document.querySelectorAll('[data-fstat]').forEach((g) => {
  g.addEventListener('click', () => {
    AD.szuro = g.dataset.fstat;
    document.querySelectorAll('[data-fstat]').forEach((x) => x.classList.toggle('on', x === g));
    foglalasokRajz();
  });
});

/* Állapotváltás és részletek */
function allapotAllit(id, uj) {
  const lista = foglaltak();
  const f = lista.find((x) => x.id === id);
  if (!f) return;
  f.allapot = uj;
  foglalasokIr(lista);
  toast(`${f.vendeg} foglalása: ${ALLAPOTOK[uj].cimke.toLowerCase()}.`, uj === 'nem' ? 'bad' : 'ok');
  ujraRajz();
}

function foglalasTorles(id) {
  const lista = foglaltak();
  const f = lista.find((x) => x.id === id);
  foglalasokIr(lista.filter((x) => x.id !== id));
  toast(`${f ? f.vendeg + ' foglalása' : 'A foglalás'} törölve.`, 'bad');
  modalZar();
  ujraRajz();
}

function ujraRajz() {
  if (AD.nezet === 'attekintes') attekintesRajz();
  if (AD.nezet === 'foglalasok') foglalasokRajz();
  if (AD.nezet === 'naptar') naptarRajz();
  jelvenyFrissit();
}

/* ---------- Modál ---------- */
const modal = document.getElementById('modal');
function modalNyit(id) {
  const f = foglaltak().find((x) => x.id === id);
  if (!f) return;
  const a = f.allapot || 'uj';

  document.getElementById('m-cim').textContent = f.vendeg;
  document.getElementById('m-azon').textContent = `Azonosító: ${f.id}`;
  document.getElementById('m-adatok').innerHTML = `
    <dt>Szolgáltatás</dt><dd>${szoveg(f.szolgaltatas)}</dd>
    <dt>Kolléga</dt><dd>${szoveg(f.kollega)}</dd>
    <dt>Időpont</dt><dd>${datumSzoveg(f.nap)}, ${p2o(f.kezd)}–${p2o(f.vege)}</dd>
    <dt>Telefon</dt><dd><a href="tel:${szoveg(f.tel)}" class="gold">${szoveg(f.tel || '—')}</a></dd>
    <dt>E-mail</dt><dd>${f.email ? `<a href="mailto:${szoveg(f.email)}" class="gold">${szoveg(f.email)}</a>` : '—'}</dd>
    <dt>Ár</dt><dd>${f.ar ? Ft(f.ar) : '—'}</dd>
    <dt>Állapot</dt><dd>${allapotJelveny(a)}</dd>
    ${f.uzenet ? `<dt>Megjegyzés</dt><dd>${szoveg(f.uzenet)}</dd>` : ''}`;

  const gombok = [];
  if (a !== 'ok' && a !== 'kesz') gombok.push(`<button class="mini mini--ok" data-akcio="ok" data-id="${f.id}">Visszaigazolás</button>`);
  if (a !== 'kesz') gombok.push(`<button class="mini" data-akcio="kesz" data-id="${f.id}">Lezárás</button>`);
  if (a !== 'nem') gombok.push(`<button class="mini mini--no" data-akcio="nem" data-id="${f.id}">Lemondás</button>`);
  gombok.push(`<button class="mini mini--gold" data-akcio="ertesit" data-id="${f.id}">E-mail a vendégnek</button>`);
  gombok.push(`<button class="mini mini--no" data-akcio="torol" data-id="${f.id}">Törlés</button>`);
  document.getElementById('m-gombok').innerHTML = gombok.join('');

  modal.classList.add('open');
  document.body.classList.add('no-scroll');
}
function modalZar() {
  modal.classList.remove('open');
  document.body.classList.remove('no-scroll');
}
document.getElementById('m-zar').addEventListener('click', modalZar);
modal.addEventListener('click', (e) => { if (e.target === modal) modalZar(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) modalZar(); });

/* Visszaigazoló e-mail a vendégnek */
function ertesito(id) {
  const f = foglaltak().find((x) => x.id === id);
  if (!f) return;
  if (!f.email) { toast('Ehhez a foglaláshoz nem tartozik e-mail cím — hívja telefonon.', 'info'); return; }

  const targy = `Foglalás visszaigazolása — ${SALON.nev}`;
  const torzs = [
    `Kedves ${f.vendeg}!`, '',
    'Örömmel visszaigazoljuk időpontját:', '',
    `Szolgáltatás: ${f.szolgaltatas}`,
    `Kolléga: ${f.kollega}`,
    `Időpont: ${datumSzoveg(f.nap)}, ${p2o(f.kezd)}`,
    `Helyszín: ${SALON.cim}`, '',
    'Ha bármi közbejön, kérjük, hívjon minket a ' + SALON.tel + ' számon.', '',
    'Üdvözlettel,', SALON.nev
  ].join('\n');

  location.href = `mailto:${f.email}?subject=${encodeURIComponent(targy)}&body=${encodeURIComponent(torzs)}`;
}

/* Sorokra és gombokra egy közös figyelő */
document.addEventListener('click', (e) => {
  const gomb = e.target.closest('[data-akcio]');
  if (gomb) {
    e.stopPropagation();
    const { akcio, id } = gomb.dataset;
    if (akcio === 'reszlet') modalNyit(id);
    else if (akcio === 'torol') foglalasTorles(id);
    else if (akcio === 'ertesit') ertesito(id);
    else { allapotAllit(id, akcio); if (modal.classList.contains('open')) modalNyit(id); }
    return;
  }
  const sor = e.target.closest('[data-fog]');
  if (sor) modalNyit(sor.dataset.fog);
});

/* ==========================================================================
   HETI NAPTÁR
   ========================================================================== */
function naptarRajz() {
  const most = new Date();
  /* Hétfői kezdés */
  const hetfoEltolas = (most.getDay() + 6) % 7;
  const hetfo = new Date(most.getFullYear(), most.getMonth(),
    most.getDate() - hetfoEltolas + AD.hetEltolas * 7);

  const napok = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(hetfo.getFullYear(), hetfo.getMonth(), hetfo.getDate() + i);
    napok.push(d);
  }

  /* Azonos hónapon belül nem ismételjük az évet és a hónapot */
  const egyHonap = napok[0].getMonth() === napok[6].getMonth();
  document.getElementById('het-cim').textContent = egyHonap
    ? `${napok[0].toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' })} ${napok[0].getDate()}–${napok[6].getDate()}.`
    : `${napok[0].toLocaleDateString('hu-HU', HU_HO)} – ${napok[6].toLocaleDateString('hu-HU', HU_HO)}`;

  const lista = rendezett();
  const ma = maISO();

  document.getElementById('het-racs').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;overflow-x:auto">
      ${napok.map((d) => {
        const iso = napISO(d);
        const napiak = lista.filter((f) => f.nap === iso && f.allapot !== 'nem');
        const nyitva = SALON.nyitva[d.getDay()];
        const maE = iso === ma;
        return `
          <div style="min-width:0">
            <div style="padding:9px 6px;text-align:center;border-radius:10px;margin-bottom:8px;
                        background:${maE ? 'rgba(201,162,39,.14)' : 'rgba(255,255,255,.03)'};
                        border:1px solid ${maE ? 'rgba(201,162,39,.36)' : 'var(--line)'}">
              <div style="font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--txt-dimmer)">
                ${SALON.napRovid[d.getDay()]}
              </div>
              <div style="font-family:var(--serif);font-size:1.3rem;line-height:1.3">${d.getDate()}</div>
              <div style="font-size:.6rem;color:${nyitva ? 'var(--txt-dimmer)' : 'var(--bad)'}">
                ${nyitva ? p2o(nyitva.tol) + '–' + p2o(nyitva.ig) : 'zárva'}
              </div>
            </div>
            <div style="display:grid;gap:6px">
              ${napiak.map((f) => `
                <button data-fog="${f.id}" style="width:100%;text-align:left;padding:9px;border-radius:9px;
                        border:1px solid var(--line);background:rgba(201,162,39,.07);color:var(--txt);
                        font-size:.74rem;line-height:1.35;transition:all .3s var(--ease)">
                  <b style="color:var(--gold-soft);font-weight:400">${p2o(f.kezd)}</b><br>
                  ${szoveg(f.vendeg)}<br>
                  <span style="color:var(--txt-dimmer)">${szoveg(f.szolgaltatas)}</span>
                </button>`).join('')
                || `<div style="text-align:center;padding:14px 4px;font-size:.72rem;color:var(--txt-dimmer);
                            border:1px dashed var(--line);border-radius:9px">—</div>`}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

document.getElementById('het-elozo').addEventListener('click', () => { AD.hetEltolas--; naptarRajz(); });
document.getElementById('het-kov').addEventListener('click', () => { AD.hetEltolas++; naptarRajz(); });
document.getElementById('het-ma').addEventListener('click', () => { AD.hetEltolas = 0; naptarRajz(); });

/* ==========================================================================
   SZOLGÁLTATÁSOK
   ========================================================================== */
function szolgRajz() {
  const fejlec = `
    <div class="edit-row" style="background:none;border:none;padding-block:0;margin-bottom:4px">
      <span class="edit-head">Szolgáltatás neve</span>
      <span class="edit-head" style="text-align:right">Perc</span>
      <span class="edit-head" style="text-align:right">Ár (Ft)</span>
      <span></span>
    </div>`;

  document.getElementById('szolg-lista').innerHTML = fejlec + SZOLGALTATASOK.map((s, i) => `
    <div class="edit-row" data-sor="${i}">
      <input type="text" value="${szoveg(s.nev)}" data-mezo="nev" aria-label="Név">
      <input type="number" value="${s.perc}" min="10" step="5" data-mezo="perc" aria-label="Perc">
      <input type="number" value="${s.ar}" min="0" step="500" data-mezo="ar" aria-label="Ár">
      <button class="mini mini--no" data-szolg-torol="${i}" aria-label="Törlés">✕</button>
    </div>`).join('');
}

document.getElementById('szolg-uj').addEventListener('click', () => {
  SZOLGALTATASOK.push({
    id: 'egyedi-' + Date.now().toString(36),
    csoport: 'Fodrászat',
    nev: 'Új szolgáltatás',
    perc: 60,
    ar: 10000,
    info: ''
  });
  szolgRajz();
  toast('Új sor hozzáadva — ne felejtsen menteni.', 'info');
});

document.getElementById('szolg-lista').addEventListener('click', (e) => {
  const g = e.target.closest('[data-szolg-torol]');
  if (!g) return;
  SZOLGALTATASOK.splice(Number(g.dataset.szolgTorol), 1);
  szolgRajz();
});

document.getElementById('szolg-ment').addEventListener('click', () => {
  document.querySelectorAll('#szolg-lista .edit-row').forEach((sor) => {
    const i = Number(sor.dataset.sor);
    const s = SZOLGALTATASOK[i];
    if (!s) return;
    s.nev = sor.querySelector('[data-mezo="nev"]').value.trim() || s.nev;
    s.perc = Math.max(10, Number(sor.querySelector('[data-mezo="perc"]').value) || s.perc);
    s.ar = Math.max(0, Number(sor.querySelector('[data-mezo="ar"]').value) || 0);
  });
  ir('zsz_szolgaltatasok', SZOLGALTATASOK);
  toast('Szolgáltatások mentve — a foglalóban már ez látszik.', 'ok');
});

document.getElementById('szolg-vissza').addEventListener('click', () => {
  try { localStorage.removeItem('zsz_szolgaltatasok'); } catch { /* privát mód */ }
  toast('Visszaállítva az alapértelmezett listára. Az oldal újratöltődik.', 'info');
  setTimeout(() => location.reload(), 900);
});

/* ==========================================================================
   CSAPAT
   ========================================================================== */
const CSOPORTOK = ['Fodrászat', 'Kozmetika', 'Kéz és láb'];

function kollRajz() {
  document.getElementById('koll-lista').innerHTML = KOLLEGAK.map((k, i) => `
    <div class="edit-row" data-sor="${i}" style="grid-template-columns:1fr 1.3fr auto auto">
      <input type="text" value="${szoveg(k.nev)}" data-mezo="nev" aria-label="Név">
      <input type="text" value="${szoveg(k.szak)}" data-mezo="szak" aria-label="Szakterület">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${CSOPORTOK.map((cs) => `
          <button class="mini${k.csoportok.includes(cs) ? ' mini--gold' : ''}"
                  data-koll-cs="${i}" data-cs="${cs}">${cs}</button>`).join('')}
      </div>
      <button class="mini mini--no" data-koll-torol="${i}"
              ${k.id === 'barmelyik' ? 'disabled style="opacity:.3"' : ''} aria-label="Törlés">✕</button>
    </div>`).join('')
    + '<p style="font-size:.78rem;color:var(--txt-dimmer);margin-top:10px">A kiemelt címkék jelzik, melyik szolgáltatáscsoportra választható a kolléga.</p>';
}

document.getElementById('koll-lista').addEventListener('click', (e) => {
  const valt = e.target.closest('[data-koll-cs]');
  if (valt) {
    const k = KOLLEGAK[Number(valt.dataset.kollCs)];
    const cs = valt.dataset.cs;
    const hol = k.csoportok.indexOf(cs);
    if (hol >= 0) k.csoportok.splice(hol, 1); else k.csoportok.push(cs);
    kollRajz();
    return;
  }
  const torol = e.target.closest('[data-koll-torol]');
  if (torol && !torol.disabled) {
    KOLLEGAK.splice(Number(torol.dataset.kollTorol), 1);
    kollRajz();
  }
});

document.getElementById('koll-uj').addEventListener('click', () => {
  KOLLEGAK.push({
    id: 'k' + Date.now().toString(36),
    nev: 'Új kolléga',
    szak: 'Szakterület',
    csoportok: ['Fodrászat']
  });
  kollRajz();
});

document.getElementById('koll-ment').addEventListener('click', () => {
  document.querySelectorAll('#koll-lista .edit-row').forEach((sor) => {
    const k = KOLLEGAK[Number(sor.dataset.sor)];
    if (!k) return;
    k.nev = sor.querySelector('[data-mezo="nev"]').value.trim() || k.nev;
    k.szak = sor.querySelector('[data-mezo="szak"]').value.trim();
  });
  ir('zsz_kollegak', KOLLEGAK);
  toast('Csapat mentve.', 'ok');
});

/* ==========================================================================
   NYITVATARTÁS
   ========================================================================== */
const NAP_SORREND = [1, 2, 3, 4, 5, 6, 0];

/* A natív <input type="time"> a böngésző nyelvét követi, ezért angol
   gépen AM/PM-et mutatna. Saját legördülővel mindig 24 órás a formátum. */
const IDO_LEPCSO = (() => {
  const lista = [];
  for (let p = 6 * 60; p <= 22 * 60; p += 15) lista.push(p);
  return lista;
})();

function idoValaszto(nev, kivalasztott, tiltva) {
  const opciok = IDO_LEPCSO.map((p) =>
    `<option value="${p}"${p === kivalasztott ? ' selected' : ''}>${p2o(p)}</option>`).join('');
  return `<select data-mezo="${nev}" ${tiltva ? 'disabled' : ''}
                  aria-label="${nev === 'tol' ? 'Nyitás' : 'Zárás'}">${opciok}</select>`;
}

function oraRajz() {
  document.getElementById('ora-lista').innerHTML = NAP_SORREND.map((d) => {
    const n = SALON.nyitva[d];
    return `
      <div class="hour-row${n ? '' : ' off'}" data-nap="${d}">
        <span>${SALON.napNev[d]}</span>
        <div class="hour-row__times">
          ${idoValaszto('tol', n ? n.tol : 8 * 60, !n)}
          <span style="color:var(--txt-dimmer)">–</span>
          ${idoValaszto('ig', n ? n.ig : 15 * 60, !n)}
        </div>
        <button class="sw${n ? ' on' : ''}" data-kapcsolo="${d}"
                aria-label="${SALON.napNev[d]} nyitva" aria-pressed="${!!n}"></button>
      </div>`;
  }).join('');
}

document.getElementById('ora-lista').addEventListener('click', (e) => {
  const k = e.target.closest('[data-kapcsolo]');
  if (!k) return;
  const d = Number(k.dataset.kapcsolo);
  SALON.nyitva[d] = SALON.nyitva[d] ? null : { tol: 8 * 60, ig: 15 * 60 };
  oraRajz();
});

document.getElementById('ora-ment').addEventListener('click', () => {
  let baj = false;
  document.querySelectorAll('#ora-lista .hour-row').forEach((sor) => {
    const d = Number(sor.dataset.nap);
    if (!SALON.nyitva[d]) return;
    const tol = Number(sor.querySelector('[data-mezo="tol"]').value);
    const ig = Number(sor.querySelector('[data-mezo="ig"]').value);
    if (ig <= tol) { baj = true; return; }
    SALON.nyitva[d] = { tol, ig };
  });

  if (baj) { toast('A zárás nem lehet korábban a nyitásnál — ellenőrizze az időket.', 'bad'); return; }

  ir('zsz_beallitasok', {
    nev: SALON.nev, cim: SALON.cim, tel: SALON.tel, email: SALON.email, nyitva: SALON.nyitva
  });
  orakKirajzol();
  statuszFrissit();
  toast('Nyitvatartás mentve — a weboldalon már ez él.', 'ok');
});

/* ==========================================================================
   SZALON ADATAI
   ========================================================================== */
function beallitasRajz() {
  document.getElementById('b-nev').value = SALON.nev;
  document.getElementById('b-cim').value = SALON.cim;
  document.getElementById('b-tel').value = SALON.tel;
  document.getElementById('b-email').value = SALON.email;
}

document.getElementById('b-ment').addEventListener('click', () => {
  SALON.nev = document.getElementById('b-nev').value.trim() || SALON.nev;
  SALON.cim = document.getElementById('b-cim').value.trim() || SALON.cim;
  SALON.tel = document.getElementById('b-tel').value.trim() || SALON.tel;
  SALON.email = document.getElementById('b-email').value.trim() || SALON.email;

  ir('zsz_beallitasok', {
    nev: SALON.nev, cim: SALON.cim, tel: SALON.tel, email: SALON.email, nyitva: SALON.nyitva
  });
  toast('Szalon adatai mentve — minden oldalon frissült.', 'ok');
});

/* ---------- Mentés / törlés ---------- */
function letolt(nev, tartalom, tipus) {
  const url = URL.createObjectURL(new Blob([tartalom], { type: tipus }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nev;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('export').addEventListener('click', () => {
  letolt('zamardi-foglalasok.json', JSON.stringify(foglaltak(), null, 2), 'application/json');
  toast('Foglalások letöltve.', 'ok');
});

document.getElementById('export-csv').addEventListener('click', () => {
  const fejlec = ['Azonosito', 'Nap', 'Kezdes', 'Vege', 'Vendeg', 'Telefon', 'Email', 'Szolgaltatas', 'Kollega', 'Ar', 'Allapot'];
  /* A ; és a " védése, hogy a táblázatkezelő jól nyissa meg */
  const cella = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const sorok = foglaltak().map((f) => [
    f.id, f.nap, p2o(f.kezd), p2o(f.vege), f.vendeg, f.tel, f.email,
    f.szolgaltatas, f.kollega, f.ar, (ALLAPOTOK[f.allapot || 'uj'] || {}).cimke
  ].map(cella).join(';'));
  /* BOM, hogy az Excel felismerje az ékezeteket */
  letolt('zamardi-foglalasok.csv', '﻿' + [fejlec.join(';'), ...sorok].join('\r\n'), 'text/csv');
  toast('CSV letöltve.', 'ok');
});

document.getElementById('torles').addEventListener('click', () => {
  if (!confirm('Biztosan törli az összes foglalást és a mentett beállításokat?\n\nEz nem vonható vissza.')) return;
  try {
    ['zsz_foglalasok', 'zsz_szolgaltatasok', 'zsz_kollegak', 'zsz_beallitasok']
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* privát mód */ }
  toast('Minden adat törölve. Az oldal újratöltődik.', 'bad');
  setTimeout(() => location.reload(), 1000);
});

/* ---------- Bemutató adatok ---------- */
document.getElementById('demo-adat').addEventListener('click', () => {
  const NEVEK = ['Kovács Anna', 'Szabó Péter', 'Nagy Eszter', 'Tóth Gábor', 'Kiss Réka',
                 'Varga Dóra', 'Molnár Zsolt', 'Balogh Kata', 'Farkas Nóra', 'Horváth Bence'];
  const ALLAPOT_KESZLET = ['uj', 'uj', 'ok', 'ok', 'ok', 'kesz'];
  const lista = foglaltak();
  let hozzaadva = 0;

  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() + Math.floor(Math.random() * 10) * 864e5);
    const nyitva = SALON.nyitva[d.getDay()];
    if (!nyitva) continue;

    const sz = SZOLGALTATASOK[Math.floor(Math.random() * SZOLGALTATASOK.length)];
    const lehetseges = [];
    for (let t = nyitva.tol; t + sz.perc <= nyitva.ig; t += 30) lehetseges.push(t);
    if (!lehetseges.length) continue;

    const kezd = lehetseges[Math.floor(Math.random() * lehetseges.length)];
    const iso = napISO(d);
    /* Ne csússzon egymásra két bemutató foglalás */
    if (lista.some((f) => f.nap === iso && kezd < f.vege && kezd + sz.perc > f.kezd)) continue;

    const alkalmas = KOLLEGAK.filter((k) => k.id !== 'barmelyik' && k.csoportok.includes(sz.csoport));
    const nev = NEVEK[Math.floor(Math.random() * NEVEK.length)];

    lista.push({
      id: 'D' + Date.now().toString(36) + i,
      nap: iso,
      kezd,
      vege: kezd + sz.perc,
      szolgaltatas: sz.nev,
      kollega: (alkalmas[Math.floor(Math.random() * alkalmas.length)] || KOLLEGAK[0]).nev,
      ar: sz.ar,
      vendeg: nev,
      tel: '+36 30 ' + (100 + Math.floor(Math.random() * 900)) + ' ' + (1000 + Math.floor(Math.random() * 9000)),
      email: nev.split(' ')[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@example.hu',
      uzenet: '',
      allapot: ALLAPOT_KESZLET[Math.floor(Math.random() * ALLAPOT_KESZLET.length)],
      letrehozva: new Date(Date.now() - Math.floor(Math.random() * 5) * 864e5).toISOString()
    });
    hozzaadva++;
  }

  foglalasokIr(lista);
  document.getElementById('profile').classList.remove('open');
  toast(`${hozzaadva} bemutató foglalás hozzáadva.`, 'ok');
  ujraRajz();
});

/* Harang → foglalások, az újakra szűrve */
document.getElementById('bell').addEventListener('click', () => {
  AD.szuro = 'uj';
  document.querySelectorAll('[data-fstat]').forEach((x) => x.classList.toggle('on', x.dataset.fstat === 'uj'));
  nezetre('foglalasok');
});

/* ==========================================================================
   INDÍTÁS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  if (!AD.belepett) return;
  profilKirajzol();
  attekintesRajz();
  setInterval(jelvenyFrissit, 20000);
});
