/* ==========================================================================
   Zamárdi Szépségszalon — időpontfoglaló varázsló
   5 lépés: szolgáltatás → kolléga → nap+idő → adatok → visszaigazolás
   A foglalás e-mailben megy ki (mailto), és letölthető .ics naptárbejegyzésként.
   Backend nélkül is működik — bármikor rákötheti saját rendszerére a
   `foglalasBekuldes()` függvény átírásával.
   ========================================================================== */

const SZOLGALTATASOK = [
  { id: 'noi-vagas',    csoport: 'Fodrászat',  nev: 'Női hajvágás + szárítás', perc: 60,  ar: 8500,  info: 'Konzultáció, mosás, vágás, szárítás' },
  { id: 'ferfi-vagas',  csoport: 'Fodrászat',  nev: 'Férfi hajvágás',          perc: 30,  ar: 5000,  info: 'Gépi vagy ollós fazon, szakállkontúr' },
  { id: 'gyerek',       csoport: 'Fodrászat',  nev: 'Gyermek hajvágás',        perc: 30,  ar: 3500,  info: '12 éves korig, türelmesen' },
  { id: 'festes',       csoport: 'Fodrászat',  nev: 'Tőfestés + vágás',        perc: 120, ar: 16500, info: 'Hajfestés, ápolás, formázás' },
  { id: 'melir',        csoport: 'Fodrászat',  nev: 'Melír / balayage',        perc: 180, ar: 24000, info: 'Egyedi árajánlat hajhossz szerint' },
  { id: 'alkalmi',      csoport: 'Fodrászat',  nev: 'Alkalmi frizura',         perc: 90,  ar: 15000, info: 'Esküvő, ballagás, fotózás' },

  { id: 'arckezeles',   csoport: 'Kozmetika',  nev: 'Mélytisztító arckezelés', perc: 75,  ar: 12000, info: 'Bőrtípusra szabott, gépi tisztítás' },
  { id: 'hidratalo',    csoport: 'Kozmetika',  nev: 'Hidratáló luxus kezelés', perc: 60,  ar: 10500, info: 'Hialuronos maszk, arcmasszázs' },
  { id: 'szemoldok',    csoport: 'Kozmetika',  nev: 'Szemöldök formázás + festés', perc: 30, ar: 4500, info: 'Gyantázás, csipeszezés, színezés' },
  { id: 'smink',        csoport: 'Kozmetika',  nev: 'Alkalmi smink',           perc: 60,  ar: 11000, info: 'Nappali vagy estélyi' },
  { id: 'microblading', csoport: 'Kozmetika',  nev: 'Sminktetoválás (microblading)', perc: 150, ar: 55000, info: 'Konzultációval, korrekcióval' },

  { id: 'manikur',      csoport: 'Kéz és láb', nev: 'Manikűr + géllakk',       perc: 75,  ar: 9500,  info: 'Kézápolás, forma, tartós szín' },
  { id: 'mukorom',      csoport: 'Kéz és láb', nev: 'Műkörömépítés',           perc: 120, ar: 14000, info: 'Zselés építés, díszítés' },
  { id: 'toltes',       csoport: 'Kéz és láb', nev: 'Műköröm töltés',          perc: 90,  ar: 11000, info: '3-4 hetente ajánlott' },
  { id: 'pedikur',      csoport: 'Kéz és láb', nev: 'Pedikűr + lakkozás',      perc: 75,  ar: 10000, info: 'Lábápolás, bőrkeményedés kezelés' }
];

const KOLLEGAK = [
  { id: 'barmelyik', nev: 'Bármelyik kolléga', szak: 'A leghamarabb szabad időpont', csoportok: ['Fodrászat', 'Kozmetika', 'Kéz és láb'] },
  { id: 'anita',     nev: 'Anita',             szak: 'Mesterfodrász · színszakértő',  csoportok: ['Fodrászat'] },
  { id: 'reka',      nev: 'Réka',              szak: 'Fodrász · alkalmi frizurák',    csoportok: ['Fodrászat'] },
  { id: 'judit',     nev: 'Judit',             szak: 'Kozmetikus · sminktetováló',    csoportok: ['Kozmetika'] },
  { id: 'niki',      nev: 'Niki',              szak: 'Műkörmös · pedikűrös',          csoportok: ['Kéz és láb'] }
];

/* Az admin felületen szerkesztett szolgáltatás- és kollégalista felülírja
   a fenti alapértékeket. */
(function adminLista() {
  const betolt = (kulcs, tomb) => {
    try {
      const ment = JSON.parse(localStorage.getItem(kulcs) || 'null');
      if (Array.isArray(ment) && ment.length) tomb.splice(0, tomb.length, ...ment);
    } catch { /* marad az alapérték */ }
  };
  betolt('zsz_szolgaltatasok', SZOLGALTATASOK);
  betolt('zsz_kollegak', KOLLEGAK);
})();

/* ---------- Állapot ---------- */
const F = {
  lepes: 1,
  szolgaltatas: null,
  kollega: KOLLEGAK[0],
  datum: null,      // Date objektum (nap)
  ido: null,        // perc a nap kezdetétől
  vendeg: { nev: '', tel: '', email: '', uzenet: '' }
};

const Ft = (n) => n.toLocaleString('hu-HU') + ' Ft';
const p2o = (p) => Math.floor(p / 60) + ':' + String(p % 60).padStart(2, '0');
const napISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Már lefoglalt sávok — demó adat a böngésző tárolójából.
   Éles rendszerben ezt a szervertől kérné le. */
function foglaltak() {
  try { return JSON.parse(localStorage.getItem('zsz_foglalasok') || '[]'); }
  catch { return []; }
}
function foglaltEltarol(rekord) {
  const l = foglaltak();
  l.push(rekord);
  try { localStorage.setItem('zsz_foglalasok', JSON.stringify(l)); } catch { /* privát mód */ }
}

/* ---------- 1. lépés — szolgáltatások ---------- */
function rajzolSzolgaltatasok() {
  const doboz = document.getElementById('svc-list');
  if (!doboz) return;
  const csoportok = [...new Set(SZOLGALTATASOK.map((s) => s.csoport))];

  doboz.innerHTML = csoportok.map((cs) => `
    <div class="price-group" style="margin-bottom:26px">
      <h3 style="font-size:1.15rem">${cs}</h3>
      <div class="opt-grid">
        ${SZOLGALTATASOK.filter((s) => s.csoport === cs).map((s) => `
          <button type="button" class="opt" data-svc="${s.id}">
            <b>${s.nev}</b>
            <span>${s.info}</span>
            <em>${Ft(s.ar)} · ${s.perc} perc</em>
          </button>`).join('')}
      </div>
    </div>`).join('');

  doboz.querySelectorAll('[data-svc]').forEach((g) => {
    g.addEventListener('click', () => {
      F.szolgaltatas = SZOLGALTATASOK.find((s) => s.id === g.dataset.svc);
      doboz.querySelectorAll('.opt').forEach((o) => o.classList.toggle('on', o === g));
      /* Ha a kiválasztott kolléga nem csinálja ezt, visszaállunk „bármelyik”-re */
      if (!F.kollega.csoportok.includes(F.szolgaltatas.csoport)) F.kollega = KOLLEGAK[0];
      setTimeout(() => lepj(2), 260);
    });
  });
}

/* ---------- 2. lépés — kollégák ---------- */
function rajzolKollegak() {
  const doboz = document.getElementById('staff-list');
  if (!doboz) return;
  const cs = F.szolgaltatas?.csoport;
  const lista = KOLLEGAK.filter((k) => !cs || k.csoportok.includes(cs));

  doboz.innerHTML = lista.map((k) => `
    <button type="button" class="opt${k.id === F.kollega.id ? ' on' : ''}" data-staff="${k.id}">
      <b>${k.nev}</b>
      <span>${k.szak}</span>
    </button>`).join('');

  doboz.querySelectorAll('[data-staff]').forEach((g) => {
    g.addEventListener('click', () => {
      F.kollega = KOLLEGAK.find((k) => k.id === g.dataset.staff);
      doboz.querySelectorAll('.opt').forEach((o) => o.classList.toggle('on', o === g));
      setTimeout(() => lepj(3), 240);
    });
  });
}

/* ---------- 3. lépés — napok és időpontok ---------- */

/* Egy adott napra visszaadja a foglalható kezdési időpontokat.
   Kiszűri a zárva tartást, a már elmúlt sávokat és az ütközéseket. */
function szabadSavok(datum) {
  const nap = SALON.nyitva[datum.getDay()];
  if (!nap) return [];

  const hossz = F.szolgaltatas?.perc || 60;
  const most = new Date();
  const maE = napISO(most) === napISO(datum);
  const mostPerc = most.getHours() * 60 + most.getMinutes();
  /* A lemondott foglalás felszabadítja a sávot */
  const mar = foglaltak().filter((f) => f.nap === napISO(datum) && f.allapot !== 'nem');

  const lista = [];
  for (let t = nap.tol; t + hossz <= nap.ig; t += 30) {
    const mult = maE && t < mostPerc + 60;                  // ma: 1 óra felkészülési idő
    const utkozes = mar.some((f) => t < f.vege && t + hossz > f.kezd);
    lista.push({ ido: t, szabad: !mult && !utkozes });
  }
  return lista;
}

function rajzolNapok() {
  const doboz = document.getElementById('day-list');
  if (!doboz) return;
  const ma = new Date();

  /* 21 nap előre, mindegyikhez kiszámoljuk a tényleges szabad kapacitást */
  const napok = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(ma.getFullYear(), ma.getMonth(), ma.getDate() + i);
    const savok = szabadSavok(d);
    napok.push({ d, zarva: !SALON.nyitva[d.getDay()], szabadDb: savok.filter((s) => s.szabad).length });
  }

  /* Ha még nincs választott nap (vagy a korábbi már betelt), az első
     olyan napra ugrunk, ahol tényleg van hely. */
  const meglevoJo = F.datum && napok.some((n) => napISO(n.d) === napISO(F.datum) && n.szabadDb > 0);
  if (!meglevoJo) {
    const elso = napok.find((n) => n.szabadDb > 0);
    F.datum = elso ? elso.d : null;
    F.ido = null;
  }

  doboz.innerHTML = napok.map((n) => {
    const tiltva = n.zarva || n.szabadDb === 0;
    const kivalasztott = F.datum && napISO(F.datum) === napISO(n.d);
    const alsoSor = n.zarva ? 'zárva'
      : n.szabadDb === 0 ? 'telt'
      : n.d.toLocaleDateString('hu-HU', { month: 'short' });
    return `<button type="button" class="day${kivalasztott ? ' on' : ''}" data-day="${napISO(n.d)}"${tiltva ? ' disabled' : ''}>
        <small>${SALON.napRovid[n.d.getDay()]}</small>
        <b>${n.d.getDate()}</b>
        <i>${alsoSor}</i>
      </button>`;
  }).join('');

  doboz.querySelectorAll('[data-day]:not(:disabled)').forEach((g) => {
    g.addEventListener('click', () => {
      const [y, m, n] = g.dataset.day.split('-').map(Number);
      F.datum = new Date(y, m - 1, n);
      F.ido = null;
      doboz.querySelectorAll('.day').forEach((d) => d.classList.toggle('on', d === g));
      rajzolIdopontok();
      frissitTovabb();
    });
  });

  /* A kiválasztott nap legyen látható a vízszintes sávban */
  doboz.querySelector('.day.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function rajzolIdopontok() {
  const doboz = document.getElementById('slot-list');
  const cim = document.getElementById('slot-title');
  if (!doboz) return;

  if (!F.datum) {
    doboz.innerHTML = '<p style="grid-column:1/-1">A következő három hétben sajnos nincs szabad időpont erre a szolgáltatásra. '
      + 'Kérjük, hívjon minket — biztosan találunk megoldást.</p>';
    if (cim) cim.textContent = '';
    return;
  }

  const nap = SALON.nyitva[F.datum.getDay()];
  const savok = szabadSavok(F.datum);

  if (cim) {
    cim.textContent = `${F.datum.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })} · `
      + `nyitva ${p2o(nap.tol)}–${p2o(nap.ig)}`;
  }

  doboz.innerHTML = savok.length
    ? savok.map((s) =>
        `<button type="button" class="slot${F.ido === s.ido ? ' on' : ''}" data-slot="${s.ido}"${s.szabad ? '' : ' disabled'}>${p2o(s.ido)}</button>`
      ).join('')
    : '<p style="grid-column:1/-1">Ezen a napon a választott szolgáltatás nem fér be a nyitvatartásba. Kérjük, válasszon másik napot.</p>';

  doboz.querySelectorAll('[data-slot]:not(:disabled)').forEach((g) => {
    g.addEventListener('click', () => {
      F.ido = parseInt(g.dataset.slot, 10);
      doboz.querySelectorAll('.slot').forEach((s) => s.classList.toggle('on', s === g));
      frissitTovabb();
    });
  });
}

/* ---------- 4. lépés — összegzés ---------- */
function rajzolOsszegzes() {
  const doboz = document.getElementById('summary');
  if (!doboz || !F.szolgaltatas || !F.datum || F.ido === null) return;
  doboz.innerHTML = `
    <dl>
      <dt>Szolgáltatás</dt><dd>${F.szolgaltatas.nev}</dd>
      <dt>Kolléga</dt><dd>${F.kollega.nev}</dd>
      <dt>Időpont</dt><dd>${F.datum.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })}, ${p2o(F.ido)}</dd>
      <dt>Időtartam</dt><dd>${F.szolgaltatas.perc} perc</dd>
      <dt>Várható ár</dt><dd><b>${Ft(F.szolgaltatas.ar)}</b></dd>
    </dl>`;
}

/* ---------- Lépésváltás ---------- */
function lepj(n) {
  if (n > F.lepes && !lepesEllenoriz(F.lepes)) return;
  F.lepes = n;

  document.querySelectorAll('.panel').forEach((p) =>
    p.classList.toggle('on', parseInt(p.dataset.step, 10) === n));
  document.querySelectorAll('.step-pill').forEach((p) => {
    const s = parseInt(p.dataset.stepPill, 10);
    p.classList.toggle('on', s === n);
    p.classList.toggle('done', s < n);
  });

  if (n === 2) rajzolKollegak();
  if (n === 3) { rajzolNapok(); rajzolIdopontok(); }
  if (n === 4) rajzolOsszegzes();

  frissitTovabb();
  document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function lepesEllenoriz(n) {
  if (n === 1 && !F.szolgaltatas) { jelez('Kérjük, válasszon szolgáltatást.'); return false; }
  if (n === 3 && (!F.datum || F.ido === null)) { jelez('Kérjük, válasszon napot és időpontot.'); return false; }
  if (n === 4) return urlapEllenoriz();
  return true;
}

function frissitTovabb() {
  const g = document.querySelector(`[data-next="${F.lepes}"]`);
  if (!g) return;
  let ok = true;
  if (F.lepes === 1) ok = !!F.szolgaltatas;
  if (F.lepes === 3) ok = !!F.datum && F.ido !== null;
  g.style.opacity = ok ? '1' : '0.45';
}

function jelez(szoveg) {
  const el = document.getElementById('booking-msg');
  if (!el) return;
  el.textContent = szoveg;
  el.style.color = 'var(--bad)';
  el.style.opacity = '1';
  clearTimeout(jelez._t);
  jelez._t = setTimeout(() => { el.style.opacity = '0'; }, 3600);
}

/* ---------- Űrlap ---------- */
function urlapEllenoriz() {
  let rendben = true;
  const mezok = [
    { id: 'f-nev',   teszt: (v) => v.trim().length >= 3,                      uzenet: 'Kérjük, adja meg a teljes nevét.' },
    { id: 'f-tel',   teszt: (v) => /^[+\d][\d\s\-/()]{7,}$/.test(v.trim()),   uzenet: 'Adjon meg egy érvényes telefonszámot.' },
    { id: 'f-email', teszt: (v) => v.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()), uzenet: 'Az e-mail cím formátuma hibás.' }
  ];

  mezok.forEach((m) => {
    const input = document.getElementById(m.id);
    if (!input) return;
    const mezo = input.closest('.field');
    const jo = m.teszt(input.value);
    mezo?.classList.toggle('err', !jo);
    const msg = mezo?.querySelector('.msg');
    if (msg) msg.textContent = m.uzenet;
    if (!jo) rendben = false;
  });

  const gdpr = document.getElementById('f-gdpr');
  if (gdpr && !gdpr.checked) { jelez('Az adatkezelés elfogadása szükséges a foglaláshoz.'); rendben = false; }

  if (rendben) {
    F.vendeg = {
      nev: document.getElementById('f-nev').value.trim(),
      tel: document.getElementById('f-tel').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      uzenet: document.getElementById('f-uzenet')?.value.trim() || ''
    };
  }
  return rendben;
}

/* ---------- Beküldés ---------- */
function foglalasBekuldes() {
  if (!urlapEllenoriz()) return;

  /* A teljes rekord az admin felület foglaláslistáját táplálja */
  foglaltEltarol({
    id: 'F' + Date.now().toString(36).toUpperCase(),
    nap: napISO(F.datum),
    kezd: F.ido,
    vege: F.ido + F.szolgaltatas.perc,
    szolgaltatas: F.szolgaltatas.nev,
    kollega: F.kollega.nev,
    ar: F.szolgaltatas.ar,
    vendeg: F.vendeg.nev,
    tel: F.vendeg.tel,
    email: F.vendeg.email,
    uzenet: F.vendeg.uzenet,
    allapot: 'uj',
    letrehozva: new Date().toISOString()
  });

  const datumSzoveg = F.datum.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });

  /* Visszaigazoló nézet */
  const doboz = document.getElementById('done-body');
  if (doboz) {
    doboz.innerHTML = `
      <p class="lead" style="margin-inline:auto">
        Köszönjük, <b class="gold">${F.vendeg.nev.split(' ')[0]}</b>! Foglalási kérését rögzítettük.
        Kollégánk <b>telefonon vagy e-mailben visszaigazolja</b> — általában néhány órán belül.
      </p>
      <div class="summary" style="max-width:460px;margin:26px auto">
        <dl>
          <dt>Szolgáltatás</dt><dd>${F.szolgaltatas.nev}</dd>
          <dt>Kolléga</dt><dd>${F.kollega.nev}</dd>
          <dt>Időpont</dt><dd><b>${datumSzoveg}, ${p2o(F.ido)}</b></dd>
          <dt>Helyszín</dt><dd>${SALON.cim}</dd>
        </dl>
      </div>`;
  }

  /* E-mail a szalonnak */
  const targy = `Időpontfoglalás — ${F.szolgaltatas.nev} — ${datumSzoveg} ${p2o(F.ido)}`;
  const torzs = [
    'Új időpontfoglalási kérés a weboldalról:', '',
    `Név: ${F.vendeg.nev}`,
    `Telefon: ${F.vendeg.tel}`,
    `E-mail: ${F.vendeg.email || '—'}`, '',
    `Szolgáltatás: ${F.szolgaltatas.nev} (${F.szolgaltatas.perc} perc, kb. ${Ft(F.szolgaltatas.ar)})`,
    `Kolléga: ${F.kollega.nev}`,
    `Időpont: ${datumSzoveg}, ${p2o(F.ido)}`, '',
    `Megjegyzés: ${F.vendeg.uzenet || '—'}`
  ].join('\n');

  const mailto = `mailto:${SALON.email}?subject=${encodeURIComponent(targy)}&body=${encodeURIComponent(torzs)}`;
  const mailGomb = document.getElementById('send-mail');
  if (mailGomb) mailGomb.href = mailto;

  const icsGomb = document.getElementById('add-cal');
  if (icsGomb) {
    icsGomb.href = icsUrl();
    icsGomb.download = 'zamardi-idopont.ics';
  }

  lepj(5);
}

/* Naptárbejegyzés (.ics) generálása */
function icsUrl() {
  const kezd = new Date(F.datum);
  kezd.setHours(Math.floor(F.ido / 60), F.ido % 60, 0, 0);
  const veg = new Date(kezd.getTime() + F.szolgaltatas.perc * 60000);

  const fmt = (d) => d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0') + 'T'
    + String(d.getHours()).padStart(2, '0')
    + String(d.getMinutes()).padStart(2, '0') + '00';

  const sorok = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Zamardi Szepsegszalon//HU',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@zamardiszepsegszalon.hu`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART;TZID=Europe/Budapest:${fmt(kezd)}`,
    `DTEND;TZID=Europe/Budapest:${fmt(veg)}`,
    `SUMMARY:${F.szolgaltatas.nev} — ${SALON.nev}`,
    `LOCATION:${SALON.cim}`,
    `DESCRIPTION:Kolléga: ${F.kollega.nev}. Telefon: ${SALON.tel}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY',
    'DESCRIPTION:Emlékeztető: fodrász időpont', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(sorok.join('\r\n'));
}

/* ---------- Indítás ---------- */
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('booking')) return;

  rajzolSzolgaltatasok();

  document.querySelectorAll('[data-next]').forEach((g) =>
    g.addEventListener('click', () => lepj(parseInt(g.dataset.next, 10) + 1)));
  document.querySelectorAll('[data-prev]').forEach((g) =>
    g.addEventListener('click', () => { F.lepes = parseInt(g.dataset.prev, 10); lepj(F.lepes); }));
  document.querySelectorAll('.step-pill').forEach((p) =>
    p.addEventListener('click', () => {
      const cel = parseInt(p.dataset.stepPill, 10);
      if (cel < F.lepes) lepj(cel);
    }));

  document.getElementById('submit-booking')?.addEventListener('click', foglalasBekuldes);

  /* Ha más oldalról érkezik ?szolgaltatas=id paraméterrel, előre kiválasztjuk */
  const kert = new URLSearchParams(location.search).get('szolgaltatas');
  if (kert) {
    const s = SZOLGALTATASOK.find((x) => x.id === kert);
    if (s) {
      F.szolgaltatas = s;
      document.querySelector(`[data-svc="${s.id}"]`)?.classList.add('on');
      lepj(2);
    }
  }

  frissitTovabb();
});
