/* ==========================================================================
   BASILICO BISTRO — admin.js
   Belső kezelőfelület: foglalások, üzenetek, étlap, nyitvatartás, beállítások.

   FIGYELEM — a belépés itt kliensoldali, kizárólag bemutató célra.
   Éles üzemben cseréld szerveroldali hitelesítésre (lásd README).
   ========================================================================== */

(() => {
  const { $, $$, esc, toast, modal } = UI;

  const VIEWS = [
    { id: 'dash',     icon: 'dash',     label: 'Vezérlőpult', title: 'Vezérlőpult',   sub: 'A mai nap egy képernyőn' },
    { id: 'bookings', icon: 'calendar', label: 'Foglalások',  title: 'Foglalások',    sub: 'Kezeld a beérkező asztalfoglalásokat' },
    { id: 'messages', icon: 'inbox',    label: 'Üzenetek',    title: 'Postaláda',     sub: 'A kapcsolati űrlapon érkezett levelek' },
    { id: 'menu',     icon: 'list',     label: 'Étlap',       title: 'Étlapkezelés',  sub: 'Ár, elérhetőség, leírás — azonnal él a weboldalon' },
    { id: 'hours',    icon: 'clock',    label: 'Nyitvatartás',title: 'Nyitvatartás',  sub: 'Ez vezérli az oldalon a nyitva/zárva jelzést' },
    { id: 'settings', icon: 'settings', label: 'Beállítások', title: 'Beállítások',   sub: 'Adatmentés, visszaállítás, rendszerinfó' }
  ];

  /* ======================================================================
     BEJELENTKEZÉS
     ====================================================================== */
  function initLogin() {
    /* A bejelentkezés fölötti kör egy felülnézeti pizza: ha ráviszed az
       egeret, forogni kezd, és addig pörög, amíg le nem veszed róla. */
    $('#loginLogo').innerHTML =
      `<div class="spin-pizza" id="loginPizza" tabindex="0" role="img"
            aria-label="Basilico Bistro — vidd rá az egeret, és megforgatja magát">
        ${Art.pizza({ seed: 'basilico-login', base: 'paradicsom', size: 96,
                      toppings: ['mozzarella', 'szalami', 'bazsalikom'] })}
      </div>`;
    UI.spinOnHover($('#loginPizza'));
    $('#loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const ok = Store.adminLogin($('#lUser').value.trim(), $('#lPass').value);
      if (ok) { showAdmin(); toast('Üdv újra, főnök! 👋', 'ok'); }
      else {
        $('#loginMsg').textContent = 'Hibás felhasználónév vagy jelszó.';
        $('#lPass').classList.add('err');
        $('.login-card').animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' },
           { transform: 'translateX(9px)' }, { transform: 'translateX(0)' }],
          { duration: 320 });
      }
    });
  }

  function showAdmin() {
    $('#loginShell').classList.add('hidden');
    $('#adminShell').classList.remove('hidden');
    $('#adminLogo').innerHTML = Art.logo(34);
    $('#adminStatus').innerHTML = UI.statusMarkup(false);
    setInterval(() => { $('#adminStatus').innerHTML = UI.statusMarkup(false); }, 30000);

    /* Oldalsáv feltöltése */
    $$('.side-item[data-view]').forEach(b => {
      const v = VIEWS.find(x => x.id === b.dataset.view);
      b.innerHTML = `${Art.icon(v.icon, 17)}<span>${v.label}</span>`;
      b.addEventListener('click', () => go(v.id));
    });
    $('.side-foot a').innerHTML = `${Art.icon('arrow', 17)}<span>Weboldal megnyitása</span>`;
    $('#logoutBtn').innerHTML = `${Art.icon('logout', 17)}<span>Kijelentkezés</span>`;
    $('#logoutBtn').addEventListener('click', () => {
      Store.adminLogout();
      $('#adminShell').classList.add('hidden');
      $('#loginShell').classList.remove('hidden');
      $('#lPass').value = '';
      toast('Kijelentkeztél.', 'warn');
    });

    const tb = $('#adminTheme');
    const paintTheme = () => { tb.innerHTML = Store.theme() === 'dark' ? Art.icon('moon') : Art.icon('sun'); };
    paintTheme();
    tb.addEventListener('click', () => { Store.toggleTheme(); paintTheme(); });

    go('dash');
    /* A tárolóból érkező változásokra újrarajzolunk — kivéve, ha a változást
       épp ez a nézet okozta (akkor helyben frissítünk, hogy ne vesszen el
       a szűrő, a görgetés vagy a kurzor helye). */
    Store.on(() => { if (current && !quiet) render(current); });
  }

  let quiet = false;
  /** Helyi módosítás: ne indítson teljes újrarajzolást. */
  function localUpdate(fn) {
    quiet = true;
    try { fn(); } finally { setTimeout(() => { quiet = false; }, 0); }
  }

  /* ======================================================================
     NÉZETVÁLTÁS
     ====================================================================== */
  let current = null;
  function go(id) {
    current = id;
    const v = VIEWS.find(x => x.id === id);
    $('#viewTitle').textContent = v.title;
    $('#viewSub').textContent = v.sub;
    $$('.side-item[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === id));
    render(id);
  }
  function render(id) {
    ({ dash, bookings, messages, menu: menuView, hours: hoursView, settings }[id] || dash)();
    UI.reveal($('#adminView'));
  }

  /* ======================================================================
     VEZÉRLŐPULT
     ====================================================================== */
  function dash() {
    const all = Store.bookings();
    const today = new Date().toISOString().slice(0, 10);
    const todays = all.filter(b => b.date === today && b.status !== 'cancelled');
    const guests = todays.reduce((s, b) => s + b.people, 0);
    const unread = Store.messages().filter(m => !m.read).length;
    const upcoming = all.filter(b => b.date >= today && b.status !== 'cancelled');

    /* Hét napjainak foglalásszáma */
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return { iso, dow: d.getDay(), n: all.filter(b => b.date === iso && b.status !== 'cancelled').length };
    });
    const maxN = Math.max(1, ...week.map(w => w.n));

    /* Idősávok megoszlása */
    const byHour = {};
    upcoming.forEach(b => { const h = b.time.slice(0, 2); byHour[h] = (byHour[h] || 0) + 1; });
    const hourSlices = Object.entries(byHour).sort().map(([h, v], i) => ({
      label: h + ':00', value: v,
      color: ['#4C9A5C', '#E9B44C', '#E0503F', '#C4603A', '#7BD08C', '#9C7BD0'][i % 6]
    }));

    const kpi = (lab, num, delta, up, spark) => `
      <div class="card kpi" data-reveal>
        <div class="lab">${lab}</div>
        <div class="num">${num}</div>
        <div class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${delta}</div>
        <div class="spark">${spark}</div>
      </div>`;

    $('#adminView').innerHTML = `
      <div class="kpi-grid">
        ${kpi('Mai foglalás', todays.length, '2 az előző héthez képest', true, Art.sparkline([3, 5, 4, 7, 6, 9, todays.length || 1]))}
        ${kpi('Mai vendégszám', guests + ' fő', '12%', true, Art.sparkline([12, 18, 15, 24, 21, 28, guests || 1], '#E9B44C'))}
        ${kpi('Olvasatlan üzenet', unread, unread ? 'válaszra vár' : 'minden megválaszolva', unread === 0, Art.sparkline([1, 0, 2, 1, 3, 2, unread], '#E0503F'))}
        ${kpi('Aktív foglalás', upcoming.length, 'a következő 14 napra', true, Art.sparkline([8, 9, 11, 10, 13, 12, upcoming.length || 1]))}
      </div>

      <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:1.2rem;margin-top:1.2rem">
        <div class="panel" data-reveal>
          <div class="panel-head"><h3>A következő hét</h3><span class="tiny dim">foglalások napi bontásban</span></div>
          <div class="panel-body">
            <div class="bars">
              ${week.map(w => `
                <div class="bar-col">
                  <span class="val">${w.n}</span>
                  <div class="bar" data-h="${(w.n / maxN) * 100}"></div>
                  <span class="lab">${DATA.dayShort[w.dow]}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Idősávok</h3></div>
          <div class="panel-body">
            ${hourSlices.length ? `<div class="donut-wrap">${Art.donut(hourSlices)}
              <div class="legend-list">${hourSlices.map(s =>
                `<span><i style="background:${s.color}"></i>${s.label} — ${s.value}</span>`).join('')}</div></div>`
              : '<p class="tiny dim">Még nincs adat.</p>'}
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:1.2rem" data-reveal>
        <div class="panel-head">
          <h3>Mai nap</h3>
          <button class="btn btn-ghost btn-sm" data-goto="bookings">Összes foglalás →</button>
        </div>
        <div class="panel-body flush">
          ${todays.length ? bookingTable(todays) : '<div class="empty" style="border:0">Ma nincs foglalás. Csendes nap lesz.</div>'}
        </div>
      </div>

      <div class="grid g-2" style="margin-top:1.2rem">
        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Legutóbbi üzenetek</h3>
            <button class="btn btn-ghost btn-sm" data-goto="messages">Postaláda →</button></div>
          <div class="panel-body flush">
            ${Store.messages().slice(0, 3).map(m => `
              <div class="msg-row ${m.read ? '' : 'unread'}">
                <div class="meta"><b>${esc(m.name)}</b><span>${Store.relTime(m.at)}</span></div>
                <div style="font-size:.9rem;font-weight:600;margin-top:.15rem">${esc(m.subject)}</div>
                <p class="tiny dim" style="margin-top:.2rem">${esc(m.body.slice(0, 90))}…</p>
              </div>`).join('') || '<div class="empty" style="border:0">Üres a postaláda.</div>'}
          </div>
        </div>

        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Gyors műveletek</h3></div>
          <div class="panel-body">
            <div class="grid g-2">
              <button class="btn btn-ghost btn-sm" data-goto="menu">Étlap szerkesztése</button>
              <button class="btn btn-ghost btn-sm" data-goto="hours">Nyitvatartás módosítása</button>
              <button class="btn btn-ghost btn-sm" id="qClose">Mai nap zárása</button>
              <button class="btn btn-ghost btn-sm" data-goto="settings">Adatmentés</button>
            </div>
            <div class="divider mt-3">🍕</div>
            <p class="tiny dim mt-2">
              A „Mai nap zárása” a mai napot zártra állítja a nyitvatartásban —
              a weboldal jelzője azonnal pirosra vált.
            </p>
          </div>
        </div>
      </div>`;

    /* Oszlopdiagram animáció */
    setTimeout(() => $$('.bar').forEach(b => { b.style.height = b.dataset.h + '%'; }), 60);

    $$('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
    $('#qClose').addEventListener('click', () => {
      Store.setHours(new Date().getDay(), null);
      toast('A mai nap zártra állítva. A weboldal jelzője frissült.', 'warn', 5000);
      $('#adminStatus').innerHTML = UI.statusMarkup(false);
    });
  }

  /* ======================================================================
     FOGLALÁSOK
     ====================================================================== */
  const STATUS = {
    new:       { label: 'Új',             cls: 'state-new' },
    confirmed: { label: 'Visszaigazolva', cls: 'state-ok' },
    seated:    { label: 'Megérkezett',    cls: 'state-ok' },
    done:      { label: 'Lezárt',         cls: 'state-done' },
    cancelled: { label: 'Lemondva',       cls: 'state-cancel' }
  };

  function bookingTable(list) {
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr>
        <th>Kód</th><th>Vendég</th><th>Mikor</th><th>Fő</th><th>Asztal</th>
        <th>Alkalom</th><th>Állapot</th><th></th>
      </tr></thead>
      <tbody>${list.map(b => {
        const t = DATA.tables.find(x => x.id === b.table);
        const s = STATUS[b.status] || STATUS.new;
        return `<tr data-id="${b.id}">
          <td class="num-cell" style="color:var(--gold);font-weight:700">${esc(b.code)}</td>
          <td><b>${esc(b.name)}</b><br><span class="tiny dim">${esc(b.phone || '')}</span></td>
          <td class="num-cell">${Store.dateShort(b.date)}<br><span class="tiny dim">${b.time}</span></td>
          <td class="num-cell">${b.people}</td>
          <td>${t ? `${t.id}.<br><span class="tiny dim">${esc(t.zone)}</span>` : '—'}</td>
          <td class="tiny">${esc(b.occasion || '—')}${b.note ? `<br><span class="dim" title="${esc(b.note)}">💬 megjegyzés</span>` : ''}</td>
          <td><span class="state ${s.cls}">${s.label}</span></td>
          <td><div class="row-actions">
            <button class="mini-btn ok" data-act="confirm" title="Visszaigazolás">✓</button>
            <button class="mini-btn" data-act="detail" title="Részletek">…</button>
            <button class="mini-btn danger" data-act="cancel" title="Lemondás">✕</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function bookings() {
    const all = Store.bookings();
    const today = new Date().toISOString().slice(0, 10);

    $('#adminView').innerHTML = `
      <div class="panel" data-reveal>
        <div class="panel-head">
          <div class="filter-row" id="bFilter">
            <button class="chip on" data-f="upcoming">Közelgő <span class="cnt">${all.filter(b => b.date >= today && b.status !== 'cancelled').length}</span></button>
            <button class="chip" data-f="today">Ma <span class="cnt">${all.filter(b => b.date === today).length}</span></button>
            <button class="chip" data-f="new">Új <span class="cnt">${all.filter(b => b.status === 'new').length}</span></button>
            <button class="chip" data-f="past">Korábbi</button>
            <button class="chip" data-f="all">Mind <span class="cnt">${all.length}</span></button>
          </div>
          <div class="search" style="max-width:250px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
            <input class="input" id="bSearch" type="search" placeholder="Név, kód, telefon…">
          </div>
        </div>
        <div class="panel-body flush" id="bTable"></div>
      </div>`;

    let filter = 'upcoming', q = '';
    const apply = () => {
      let list = Store.bookings();   // mindig friss adat, hogy az állapotváltás azonnal látszódjon
      if (filter === 'upcoming') list = list.filter(b => b.date >= today && b.status !== 'cancelled');
      if (filter === 'today')    list = list.filter(b => b.date === today);
      if (filter === 'new')      list = list.filter(b => b.status === 'new');
      if (filter === 'past')     list = list.filter(b => b.date < today).reverse();
      if (q) list = list.filter(b =>
        (b.name + b.code + (b.phone || '') + (b.note || '')).toLowerCase().includes(q));
      $('#bTable').innerHTML = list.length ? bookingTable(list)
        : '<div class="empty" style="border:0">Nincs találat erre a szűrésre.</div>';
      bindRows();
    };

    const bindRows = () => {
      $$('#bTable tr[data-id]').forEach(tr => {
        tr.addEventListener('click', e => {
          const btn = e.target.closest('[data-act]');
          const id = tr.dataset.id;
          const b = Store.bookings().find(x => x.id === id);
          if (!btn) return;
          if (btn.dataset.act === 'confirm') {
            localUpdate(() => Store.setBookingStatus(id, 'confirmed'));
            apply();
            toast(`${b.name} foglalása visszaigazolva.`, 'ok');
          }
          if (btn.dataset.act === 'cancel') {
            if (!confirm(`Biztosan lemondod ${b.name} (${b.code}) foglalását?`)) return;
            localUpdate(() => Store.setBookingStatus(id, 'cancelled'));
            apply();
            toast('Foglalás lemondva.', 'warn');
          }
          if (btn.dataset.act === 'detail') showBooking(b);
        });
      });
    };

    $('#bFilter').addEventListener('click', e => {
      const c = e.target.closest('[data-f]'); if (!c) return;
      filter = c.dataset.f;
      $$('#bFilter .chip').forEach(x => x.classList.toggle('on', x === c));
      apply();
    });
    let d;
    $('#bSearch').addEventListener('input', e => {
      clearTimeout(d);
      d = setTimeout(() => { q = e.target.value.trim().toLowerCase(); apply(); }, 160);
    });
    apply();
  }

  function showBooking(b) {
    const t = DATA.tables.find(x => x.id === b.table);
    const m = modal(`
      <h3>${esc(b.name)} <span style="color:var(--gold);font-size:1rem">${esc(b.code)}</span></h3>
      <p class="tiny dim">Rögzítve: ${Store.relTime(b.created)}</p>
      <div class="mt-3">
        <div class="recap-row"><span>Dátum</span><b>${Store.dateHu(b.date)}</b></div>
        <div class="recap-row"><span>Időpont</span><b>${b.time}</b></div>
        <div class="recap-row"><span>Létszám</span><b>${b.people} fő</b></div>
        <div class="recap-row"><span>Asztal</span><b>${t ? `${t.id}. · ${esc(t.zone)} · ${t.seats} fős` : '—'}</b></div>
        <div class="recap-row"><span>Telefon</span><b><a href="tel:${esc(b.phone || '')}" style="color:var(--gold)">${esc(b.phone || '—')}</a></b></div>
        <div class="recap-row"><span>E-mail</span><b>${esc(b.email || '—')}</b></div>
        <div class="recap-row"><span>Alkalom</span><b>${esc(b.occasion || '—')}</b></div>
        ${b.note ? `<div class="recap-row"><span>Megjegyzés</span><b style="max-width:62%">${esc(b.note)}</b></div>` : ''}
      </div>
      <h4 class="mt-3">Állapot</h4>
      <div class="filter-row mt-1" id="stRow">
        ${Object.entries(STATUS).map(([k, v]) =>
          `<button class="chip${b.status === k ? ' on' : ''}" data-s="${k}">${v.label}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-block btn-sm mt-3" id="delBk">Foglalás törlése</button>`,
      { onClose: () => render('bookings') });

    setTimeout(() => {
      $('#stRow', m.node).addEventListener('click', e => {
        const c = e.target.closest('[data-s]'); if (!c) return;
        localUpdate(() => Store.setBookingStatus(b.id, c.dataset.s));
        $$('#stRow .chip', m.node).forEach(x => x.classList.toggle('on', x === c));
        toast('Állapot frissítve: ' + STATUS[c.dataset.s].label, 'ok');
      });
      $('#delBk', m.node).addEventListener('click', () => {
        if (!confirm('Végleg törlöd ezt a foglalást?')) return;
        localUpdate(() => Store.deleteBooking(b.id));
        m.close(); toast('Foglalás törölve.', 'warn');
      });
    }, 20);
  }

  /* ======================================================================
     ÜZENETEK
     ====================================================================== */
  function messages() {
    const list = Store.messages();
    $('#adminView').innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 1.2fr;gap:1.2rem;align-items:start">
        <div class="panel" data-reveal>
          <div class="panel-head">
            <h3>Beérkezett (${list.length})</h3>
            <span class="tiny dim">${list.filter(m => !m.read).length} olvasatlan</span>
          </div>
          <div class="panel-body flush" id="msgList" style="max-height:70vh;overflow-y:auto">
            ${list.length ? list.map(m => `
              <div class="msg-row ${m.read ? '' : 'unread'}" data-id="${m.id}">
                <div class="meta"><b>${esc(m.name)}</b><span>${Store.relTime(m.at)}</span></div>
                <div style="font-size:.92rem;font-weight:600;margin-top:.15rem">${esc(m.subject)}</div>
                <p class="tiny dim" style="margin-top:.2rem">${esc(m.body.slice(0, 100))}…</p>
              </div>`).join('') : '<div class="empty" style="border:0">Nincs üzenet.</div>'}
          </div>
        </div>
        <div class="panel" data-reveal id="msgPane">
          <div class="panel-body"><div class="empty" style="border:0">
            ${Art.icon('inbox', 46)}<p>Válassz egy üzenetet a listából.</p></div></div>
        </div>
      </div>`;

    $$('#msgList .msg-row').forEach(row => row.addEventListener('click', () => {
      const m = Store.messages().find(x => x.id === row.dataset.id);
      localUpdate(() => Store.markRead(m.id, true));
      row.classList.remove('unread');
      $('#msgPane').innerHTML = `
        <div class="panel-head">
          <div><h3>${esc(m.subject)}</h3>
            <span class="tiny dim">${esc(m.name)} · ${esc(m.email)} · ${Store.dateHu(m.at.slice(0, 10))}</span></div>
          <div class="row-actions">
            <button class="mini-btn" id="mUnread">Olvasatlan</button>
            <button class="mini-btn danger" id="mDel">Törlés</button>
          </div>
        </div>
        <div class="panel-body">
          <p style="white-space:pre-wrap;line-height:1.7">${esc(m.body)}</p>
          <div class="divider mt-3">✉</div>
          <h4 class="mt-3">Válasz</h4>
          <textarea class="textarea mt-1" id="replyBox" placeholder="Kedves ${esc(m.name.split(' ')[0])},&#10;&#10;köszönjük, hogy írtál…"></textarea>
          <div class="row mt-2" style="gap:.5rem">
            <button class="btn btn-primary btn-sm" id="mSend">Válasz küldése</button>
            <a class="btn btn-ghost btn-sm" href="mailto:${esc(m.email)}?subject=Re: ${encodeURIComponent(m.subject)}">Megnyitás levelezőben</a>
          </div>
          <p class="tiny dim mt-2">A küldés ebben a demóban csak szimulált — éles rendszerben itt egy e-mail API hívása történne.</p>
        </div>`;
      $('#mUnread').addEventListener('click', () => { Store.markRead(m.id, false); toast('Olvasatlanra állítva.', 'info'); });
      $('#mDel').addEventListener('click', () => {
        if (!confirm('Törlöd ezt az üzenetet?')) return;
        Store.deleteMessage(m.id); toast('Üzenet törölve.', 'warn');
      });
      $('#mSend').addEventListener('click', () => {
        if ($('#replyBox').value.trim().length < 5) { toast('Írj egy valódi választ. 🙂', 'warn'); return; }
        $('#replyBox').value = '';
        toast(`Válasz elküldve ${m.name} részére.`, 'ok');
      });
    }));
  }

  /* ======================================================================
     ÉTLAP
     ====================================================================== */
  function menuView() {
    const items = Store.menu();
    $('#adminView').innerHTML = `
      <div class="panel" data-reveal>
        <div class="panel-head">
          <div class="filter-row" id="mCat">
            <button class="chip on" data-c="all">Minden <span class="cnt">${items.length}</span></button>
            ${DATA.categories.map(c => `<button class="chip" data-c="${c.id}">${esc(c.name)}
              <span class="cnt">${items.filter(m => m.cat === c.id).length}</span></button>`).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" id="mReset">Alaphelyzet</button>
        </div>
        <div class="panel-body flush" id="mTable"></div>
      </div>
      <p class="tiny dim mt-2">
        A módosítások azonnal megjelennek a weboldalon. A „Kifogyott” kapcsoló áthúzza a tételt az étlapon,
        és letiltja a kosárba tevést.
      </p>`;

    let cat = 'all';
    const paint = () => {
      const list = Store.menu().filter(m => cat === 'all' || m.cat === cat);
      $('#mTable').innerHTML = `<div class="table-wrap"><table class="tbl">
        <thead><tr><th></th><th>Név</th><th>Kategória</th><th>Ár (32)</th><th>Ár (40)</th><th>Elérhető</th><th></th></tr></thead>
        <tbody>${list.map(m => `
          <tr data-id="${m.id}">
            <td style="width:52px">${Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 40 })}</td>
            <td><b>${esc(m.name)}</b><br><span class="tiny dim">${esc((m.ings || '').slice(0, 48))}…</span></td>
            <td class="tiny">${esc((DATA.categories.find(c => c.id === m.cat) || {}).name || m.cat)}</td>
            <td><input class="input" style="width:104px;padding:.4rem .6rem" type="number" step="10" value="${m.price}" data-f="price"></td>
            <td>${m.price40 ? `<input class="input" style="width:104px;padding:.4rem .6rem" type="number" step="10" value="${m.price40}" data-f="price40">` : '<span class="dim">—</span>'}</td>
            <td><label class="switch"><input type="checkbox" data-f="available" ${m.available !== false ? 'checked' : ''}><span class="track"></span></label></td>
            <td><button class="mini-btn" data-edit="${m.id}">Szerkesztés</button></td>
          </tr>`).join('')}</tbody></table></div>`;

      $$('#mTable [data-f]').forEach(inp => {
        inp.addEventListener('change', () => {
          const id = inp.closest('tr').dataset.id;
          const f = inp.dataset.f;
          const val = f === 'available' ? inp.checked : +inp.value;
          localUpdate(() => Store.updateMenuItem(id, { [f]: val }));
          toast(f === 'available'
            ? (val ? 'Újra elérhető.' : 'Kifogyottra állítva.')
            : 'Ár frissítve: ' + Store.huf(val), val ? 'ok' : 'warn', 2200);
        });
      });
      $$('#mTable [data-edit]').forEach(b => b.addEventListener('click', () => editItem(b.dataset.edit)));
    };

    $('#mCat').addEventListener('click', e => {
      const c = e.target.closest('[data-c]'); if (!c) return;
      cat = c.dataset.c;
      $$('#mCat .chip').forEach(x => x.classList.toggle('on', x === c));
      paint();
    });
    $('#mReset').addEventListener('click', () => {
      if (!confirm('Minden étlap-módosítást visszaállítasz az eredetire?')) return;
      Store.resetMenu(); paint(); toast('Étlap visszaállítva az alapértelmezettre.', 'warn');
    });
    paint();
  }

  function editItem(id) {
    const m = Store.menuItem(id);
    const mm = modal(`
      <div style="text-align:center">${Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 150 })
        .replace('<svg', '<svg style="margin:0 auto"')}</div>
      <h3 class="mt-2">${esc(m.name)}</h3>
      <div class="field mt-3"><label for="eName">Megjelenő név</label>
        <input class="input" id="eName" value="${esc(m.name)}"></div>
      <div class="field mt-2"><label for="eIngs">Összetevők</label>
        <textarea class="textarea" id="eIngs" style="min-height:80px">${esc(m.ings)}</textarea></div>
      <div class="field mt-2"><label for="eDesc">Rövid leírás</label>
        <textarea class="textarea" id="eDesc" style="min-height:70px">${esc(m.desc || '')}</textarea></div>
      <div class="grid g-2 mt-2">
        <div class="field"><label for="ePrice">Ár 32 cm</label>
          <input class="input" id="ePrice" type="number" step="10" value="${m.price}"></div>
        <div class="field"><label for="ePrice40">Ár 40 cm</label>
          <input class="input" id="ePrice40" type="number" step="10" value="${m.price40 || ''}" placeholder="nincs"></div>
      </div>
      <div class="field mt-2"><label for="ePhoto">Fotó URL (opcionális)</label>
        <input class="input" id="ePhoto" value="${esc(m.photo || '')}" placeholder="https://…/pizza.jpg">
        <span class="tiny dim">Ha megadsz képet, az illusztráció helyett az jelenik meg.</span></div>
      <button class="btn btn-primary btn-block mt-3" id="eSave">Mentés</button>`);

    setTimeout(() => {
      $('#eSave', mm.node).addEventListener('click', () => {
        Store.updateMenuItem(id, {
          name: $('#eName').value.trim() || m.name,
          ings: $('#eIngs').value.trim(),
          desc: $('#eDesc').value.trim(),
          price: +$('#ePrice').value || m.price,
          price40: $('#ePrice40').value ? +$('#ePrice40').value : undefined,
          photo: $('#ePhoto').value.trim() || undefined
        });
        mm.close();
        toast('Mentve. A weboldalon már frissült.', 'ok');
      });
    }, 20);
  }

  /* ======================================================================
     NYITVATARTÁS
     ====================================================================== */
  function hoursView() {
    const H = Store.hours();
    $('#adminView').innerHTML = `
      <div class="grid" style="grid-template-columns:1.3fr 1fr;gap:1.2rem;align-items:start">
        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Heti nyitvatartás</h3>
            <button class="btn btn-ghost btn-sm" id="hReset">Alaphelyzet</button></div>
          <div class="panel-body">
            ${[1, 2, 3, 4, 5, 6, 0].map(d => `
              <div class="row row-between" style="padding:.7rem 0;border-bottom:1px solid var(--line)" data-day="${d}">
                <b style="min-width:96px">${DATA.dayNames[d]}</b>
                <div class="row" style="gap:.5rem">
                  <input class="input" type="time" style="width:118px" data-t="open"
                         value="${H[d] ? H[d].open : '11:30'}" ${H[d] ? '' : 'disabled'}>
                  <span class="dim">–</span>
                  <input class="input" type="time" style="width:118px" data-t="close"
                         value="${H[d] ? H[d].close : '22:00'}" ${H[d] ? '' : 'disabled'}>
                  <label class="switch" title="Nyitva / zárva">
                    <input type="checkbox" data-t="on" ${H[d] ? 'checked' : ''}><span class="track"></span>
                  </label>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Élő állapot</h3></div>
          <div class="panel-body center-text">
            <div id="livePreview" style="display:flex;justify-content:center"></div>
            <p class="tiny dim mt-3">Pontosan ezt látja a látogató a weboldal fejlécében.
              A pötty valós időben villog, és 30 másodpercenként frissül.</p>
            <div class="divider mt-3">🕐</div>
            <h4 class="mt-3" style="font-family:var(--f-body);font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim)">Kivételes napok</h4>
            <div class="stack mt-2" style="gap:.5rem">
              ${DATA.exceptions.map(e => `
                <div class="row row-between" style="font-size:.85rem">
                  <span>${Store.dateHu(e.date)}</span>
                  <span class="state state-cancel">${esc(e.note.split('–')[1] || 'Zárva')}</span>
                </div>`).join('')}
            </div>
            <p class="tiny dim mt-2">Az ünnepnapokat a <code>data.js</code> <code>exceptions</code> listájában tudod bővíteni.</p>
          </div>
        </div>
      </div>`;

    const live = () => { $('#livePreview').innerHTML = UI.statusMarkup(true); };
    live();

    $$('#adminView [data-day]').forEach(row => {
      const d = +row.dataset.day;
      const on = $('[data-t="on"]', row), o = $('[data-t="open"]', row), c = $('[data-t="close"]', row);
      const save = () => {
        localUpdate(() => {
          if (!on.checked) { Store.setHours(d, null); o.disabled = c.disabled = true; }
          else { o.disabled = c.disabled = false; Store.setHours(d, { open: o.value, close: c.value }); }
        });
        live();
        $('#adminStatus').innerHTML = UI.statusMarkup(false);
        toast(`${DATA.dayNames[d]} frissítve.`, 'ok', 1800);
      };
      [on, o, c].forEach(x => x.addEventListener('change', save));
    });
    $('#hReset').addEventListener('click', () => {
      Store.resetHours(); hoursView(); toast('Nyitvatartás visszaállítva.', 'warn');
    });
  }

  /* ======================================================================
     BEÁLLÍTÁSOK
     ====================================================================== */
  function settings() {
    $('#adminView').innerHTML = `
      <div class="grid g-2">
        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Adatmentés</h3></div>
          <div class="panel-body">
            <p class="muted" style="font-size:.9rem">Minden módosítás (étlap, nyitvatartás, foglalások, üzenetek)
              a böngésző tárolójában él. Innen kimentheted vagy visszatöltheted.</p>
            <div class="grid g-2 mt-3">
              <button class="btn btn-primary btn-sm" id="sExport">Mentés fájlba (.json)</button>
              <button class="btn btn-ghost btn-sm" id="sImportBtn">Visszatöltés fájlból</button>
            </div>
            <input type="file" id="sImport" accept="application/json" class="hidden">
            <div class="divider mt-3">💾</div>
            <button class="btn btn-ghost btn-block btn-sm mt-3" id="sReset"
              style="border-color:rgba(224,80,63,.4);color:var(--tomato-lt)">Gyári visszaállítás</button>
            <p class="tiny dim mt-2">Ez töröl minden helyi módosítást, foglalást és üzenetet.</p>
          </div>
        </div>

        <div class="panel" data-reveal>
          <div class="panel-head"><h3>Rendszerinformáció</h3></div>
          <div class="panel-body">
            <div class="recap-row"><span>Étlap tételek</span><b>${Store.menu().length}</b></div>
            <div class="recap-row"><span>Foglalások</span><b>${Store.bookings().length}</b></div>
            <div class="recap-row"><span>Üzenetek</span><b>${Store.messages().length}</b></div>
            <div class="recap-row"><span>Asztalok</span><b>${DATA.tables.length} (${DATA.tables.reduce((s, t) => s + t.seats, 0)} férőhely)</b></div>
            <div class="recap-row"><span>Tárolt adat</span><b>${storageSize()}</b></div>
            <div class="recap-row" style="border:0"><span>Verzió</span><b>1.0.0</b></div>
          </div>
        </div>

        <div class="panel" data-reveal style="grid-column:1/-1">
          <div class="panel-head"><h3>Éles üzembe helyezés</h3></div>
          <div class="panel-body">
            <p class="muted" style="font-size:.9rem">Amit érdemes megtenni, mielőtt a sablon éles forgalmat kap:</p>
            <ol class="stack mt-2" style="gap:.55rem;font-size:.88rem;list-style:decimal;padding-left:1.2rem">
              <li class="muted"><b>Hitelesítés:</b> az admin belépés jelenleg kliensoldali. Cseréld valódi, szerveroldali bejelentkezésre.</li>
              <li class="muted"><b>Adattárolás:</b> a <code>store.js</code> <code>read</code>/<code>write</code> függvényeit írd át API-hívásokra — a többi kód változatlan maradhat.</li>
              <li class="muted"><b>E-mail:</b> a foglalás-visszaigazolás és a kapcsolati űrlap küldését kösd be egy levelezőszolgáltatáshoz.</li>
              <li class="muted"><b>Tartalom:</b> a <code>data.js</code> fájlban cseréld a márkanevet, címet, étlapot és képeket.</li>
              <li class="muted"><b>Fotók:</b> minden ételnél megadható <code>photo</code> URL — ha üresen hagyod, marad a beépített illusztráció.</li>
            </ol>
          </div>
        </div>
      </div>`;

    $('#sExport').addEventListener('click', () => {
      const blob = new Blob([Store.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `basilico-mentes-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Mentés letöltve.', 'ok');
    });
    $('#sImportBtn').addEventListener('click', () => $('#sImport').click());
    $('#sImport').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { Store.importAll(r.result); settings(); toast('Adatok visszatöltve.', 'ok'); }
        catch (err) { toast('Hibás fájl: ' + err.message, 'err'); }
      };
      r.readAsText(f);
    });
    $('#sReset').addEventListener('click', () => {
      if (!confirm('Minden helyi adat törlődik (foglalások, üzenetek, étlap-módosítások). Biztos?')) return;
      Store.factoryReset();
      location.reload();
    });
  }

  function storageSize() {
    let n = 0;
    for (const k in localStorage) {
      if (k.startsWith('basilico:')) n += (localStorage[k] || '').length;
    }
    return (n / 1024).toFixed(1) + ' kB';
  }

  /* ======================================================================
     INDÍTÁS
     ====================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    UI.boot({ bare: true });
    initLogin();
    if (Store.adminIn()) showAdmin();
  });
})();
