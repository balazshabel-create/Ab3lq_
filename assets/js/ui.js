/* ==========================================================================
   BASILICO BISTRO — ui.js
   Közös héj minden oldalhoz: fejléc, lábléc, egyedi kurzor, előtöltő,
   görgetés-animációk, kosárfiók, értesítések, téma, apró meglepetések.
   ========================================================================== */

const UI = (() => {

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const NAV = [
    { href: 'index.html',     label: 'Főoldal' },
    { href: 'etlap.html',     label: 'Étlap' },
    { href: 'galeria.html',   label: 'Galéria' },
    { href: 'rolunk.html',    label: 'Rólunk' },
    { href: 'kapcsolat.html', label: 'Kapcsolat' }
  ];

  const page = () => (location.pathname.split('/').pop() || 'index.html');

  /* ======================================================================
     1. Előtöltő
     ====================================================================== */
  function preloader() {
    if (sessionStorage.getItem('basilico:seen')) return;
    const p = el('div', 'preloader', `
      <div class="preloader-inner">
        <div class="preloader-mark">${Art.logo(64)}</div>
        <div class="preloader-bar"><i></i></div>
        <div class="preloader-text">befűtjük a kemencét…</div>
      </div>`);
    document.body.appendChild(p);
    const bar = $('i', p);
    let v = 0;
    const tick = setInterval(() => {
      v = Math.min(100, v + 8 + Math.random() * 22);
      bar.style.width = v + '%';
      if (v >= 100) {
        clearInterval(tick);
        setTimeout(() => {
          p.classList.add('done');
          sessionStorage.setItem('basilico:seen', '1');
          setTimeout(() => p.remove(), 800);
          document.dispatchEvent(new CustomEvent('ui:ready'));
        }, 260);
      }
    }, 130);
  }

  /* ======================================================================
     2. Egyedi kurzor
     ====================================================================== */
  function cursor() {
    if (matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const root = document.documentElement;
    root.classList.add('cursor-on');

    const dot  = el('div', 'cursor cursor-dot');
    const ring = el('div', 'cursor cursor-ring', '<span class="cursor-label"></span>');
    document.body.append(dot, ring);
    const label = $('.cursor-label', ring);

    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;

    addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      root.classList.remove('cur-hide');
    }, { passive: true });
    addEventListener('mouseleave', () => root.classList.add('cur-hide'));
    addEventListener('mousedown', () => root.classList.add('cur-down'));
    addEventListener('mouseup',   () => root.classList.remove('cur-down'));

    (function loop() {
      rx += (mx - rx) * 0.17;
      ry += (my - ry) * 0.17;
      dot.style.transform  = `translate3d(${mx - 3.5}px, ${my - 3.5}px, 0)`;
      ring.style.transform = `translate3d(${rx - 19}px, ${ry - 19}px, 0)`;
      requestAnimationFrame(loop);
    })();

    /* Állapotok: interaktív elem fölött nagyobb kör + felirat */
    const HOVER = 'a, button, [role="button"], .chip, .slot, .topping, .shot, .tab, .table-hit, summary';
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest(HOVER);
      const txt = e.target.closest('input:not([type=checkbox]), textarea, [contenteditable]');
      root.classList.toggle('cur-text', !!txt);
      if (t && !txt) {
        root.classList.add('cur-hover');
        label.textContent = t.dataset.cursor || '';
      } else {
        root.classList.remove('cur-hover');
      }
    });

    /* Mágneses gombok */
    document.addEventListener('mousemove', (e) => {
      $$('.btn, .icon-btn, .social').forEach(b => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (d < 90) {
          b.style.transform = `translate(${(e.clientX - cx) * .22}px, ${(e.clientY - cy) * .28}px)`;
        } else if (b.style.transform) {
          b.style.transform = '';
        }
      });
    }, { passive: true });
  }

  /* ======================================================================
     3. Fejléc + lábléc
     ====================================================================== */
  function header() {
    const here = page();
    const B = DATA.brand;
    const promoStrip = DATA.promos.map(p =>
      `<span>${p.icon} <b>${esc(p.title)}</b> — ${esc(p.text)}</span>`).join('');

    const links = NAV.map(n =>
      `<a class="nav-link${n.href === here ? ' active' : ''}" href="${n.href}">${n.label}</a>`).join('');

    const bar = el('div', '', `
      <div class="topbar" aria-hidden="true">
        <div class="topbar-track">${promoStrip}${promoStrip}</div>
      </div>
      <header class="nav" id="nav">
        <div class="wrap nav-inner">
          <a class="logo" href="index.html" aria-label="${esc(B.name)} — főoldal">
            ${Art.logo(40)}
            <span class="logo-text">
              <span class="logo-name">Basilico</span>
              <span class="logo-sub">Bistro</span>
            </span>
          </a>

          <nav class="nav-links" aria-label="Fő navigáció">${links}</nav>

          <div class="nav-actions">
            <span id="navStatus"></span>
            <button class="icon-btn" id="themeBtn" aria-label="Világos / sötét téma" data-cursor="téma">${Art.icon('moon')}</button>
            <button class="icon-btn" id="cartBtn" aria-label="Kosár" data-cursor="kosár">
              ${Art.icon('cart')}<span class="badge-count" id="cartCount">0</span>
            </button>
            <a class="icon-btn nav-hide-xs" href="profil.html" aria-label="Profil" data-cursor="profil">${Art.icon('user')}</a>
            <a class="btn btn-primary btn-sm nowrap nav-hide-xs" href="foglalas.html" data-cursor="foglalás">
              ${Art.icon('calendar', 15)} Asztalfoglalás
            </a>
            <button class="burger" id="burger" aria-label="Menü" aria-expanded="false">
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
      </header>
      <div class="mobile-menu" id="mobileMenu">
        ${NAV.concat([{ href: 'foglalas.html', label: 'Asztalfoglalás' },
                      { href: 'profil.html', label: 'Profilom' },
                      { href: 'admin.html', label: 'Admin' }])
             .map((n, i) => `<a href="${n.href}" class="${n.href === here ? 'active' : ''}" style="transition-delay:${80 + i * 55}ms">${n.label}</a>`).join('')}
        <div class="mobile-menu-foot">
          <div id="mobStatus"></div>
          <a class="btn btn-primary btn-block mt-2" href="foglalas.html">
            ${Art.icon('calendar', 16)} Asztalfoglalás
          </a>
          <a class="btn btn-ghost btn-block btn-sm mt-2" href="tel:${B.phoneHref}">
            ${Art.icon('phone', 15)} ${esc(B.phone)}
          </a>
          <p class="tiny dim mt-2">${esc(B.address)}</p>
        </div>
      </div>`);

    document.body.prepend(bar);

    /* Ragadós fejléc árnyék */
    const nav = $('#nav');
    addEventListener('scroll', () => nav.classList.toggle('stuck', scrollY > 10), { passive: true });

    /* Mobil menü */
    const burger = $('#burger'), mm = $('#mobileMenu');
    burger.addEventListener('click', () => {
      const on = mm.classList.toggle('on');
      burger.classList.toggle('on', on);
      burger.setAttribute('aria-expanded', on);
      document.body.style.overflow = on ? 'hidden' : '';
    });

    /* Téma */
    const tb = $('#themeBtn');
    const paintTheme = () => { tb.innerHTML = Store.theme() === 'dark' ? Art.icon('moon') : Art.icon('sun'); };
    paintTheme();
    tb.addEventListener('click', () => { Store.setTheme(Store.toggleTheme()); paintTheme(); });

    /* Kosár */
    $('#cartBtn').addEventListener('click', openCart);
    paintCartCount();
    Store.on(w => { if (w === 'cart') paintCartCount(); });

    /* Élő nyitvatartás-jelző */
    paintStatus();
    setInterval(paintStatus, 30000);
    Store.on(w => { if (w === 'hours') paintStatus(); });
  }

  function statusMarkup(big = false) {
    const s = Store.openState();
    const cls = s.state === 'open' ? 'is-open' : s.state === 'closed' ? 'is-closed' : 'is-soon';
    return `<span class="status ${cls}${big ? ' status-lg' : ''}" title="${esc(s.note || '')}">
      <span class="status-dot"></span>
      <span>${esc(s.label)}</span>
      ${big && s.note ? `<span class="status-note">· ${esc(s.note)}</span>` : ''}
    </span>`;
  }
  function paintStatus() {
    const n = $('#navStatus'); if (n) n.innerHTML = statusMarkup(false);
    const m = $('#mobStatus'); if (m) m.innerHTML = statusMarkup(true);
    $$('[data-status-big]').forEach(x => x.innerHTML = statusMarkup(true));
  }

  function footer() {
    const B = DATA.brand;
    const H = Store.hours();
    const today = new Date().getDay();
    const hoursRows = [1, 2, 3, 4, 5, 6, 0].map(d => `
      <div class="hours-row${d === today ? ' today' : ''}">
        <span class="d">${DATA.dayNames[d]}</span>
        <span>${H[d] ? `${H[d].open} – ${H[d].close}` : 'Zárva'}</span>
      </div>`).join('');

    const f = el('footer', 'footer', `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <a class="logo" href="index.html">${Art.logo(44)}
              <span class="logo-text"><span class="logo-name">Basilico</span><span class="logo-sub">Bistro</span></span>
            </a>
            <p class="muted mt-2" style="font-size:.89rem;max-width:34ch">${esc(B.claim)}</p>
            <div class="mt-3" data-status-big></div>
            <div class="socials mt-3">
              <a class="social" href="${B.social.ig}" aria-label="Instagram">${Art.icon('ig')}</a>
              <a class="social" href="${B.social.fb}" aria-label="Facebook">${Art.icon('fb')}</a>
              <a class="social" href="${B.social.tiktok}" aria-label="TikTok">${Art.icon('tiktok')}</a>
            </div>
          </div>

          <div>
            <h4>Oldalak</h4>
            <div class="footer-links">
              ${NAV.map(n => `<a href="${n.href}">${n.label}</a>`).join('')}
              <a href="foglalas.html">Asztalfoglalás</a>
              <a href="profil.html">Profilom</a>
              <a href="admin.html">Admin belépés</a>
            </div>
          </div>

          <div>
            <h4>Elérhetőség</h4>
            <div class="footer-links">
              <a href="https://maps.google.com/?q=${encodeURIComponent(B.address)}" target="_blank" rel="noopener">${esc(B.address)}</a>
              <a href="tel:${B.phoneHref}">${esc(B.phone)}</a>
              <a href="mailto:${B.email}">${esc(B.email)}</a>
              <span class="tiny dim">${esc(B.district)}</span>
            </div>
          </div>

          <div>
            <h4>Nyitvatartás</h4>
            ${hoursRows}
          </div>
        </div>

        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} ${esc(B.name)} · Minden jog fenntartva</span>
          <span class="row" style="gap:1.2rem">
            <a href="#" class="muted">Adatkezelés</a>
            <a href="#" class="muted">ÁSZF</a>
            <a href="#" class="muted">Impresszum</a>
          </span>
        </div>
      </div>
      <div class="footer-word" aria-hidden="true">BASILICO</div>`);
    document.body.appendChild(f);
    paintStatus();
  }

  /* ======================================================================
     4. Görgetés: haladásjelző, felfedés, vissza a tetejére, parallax
     ====================================================================== */
  function scrollFx() {
    const prog = el('div', 'scroll-progress');
    document.body.appendChild(prog);

    const top = el('button', 'to-top', Art.icon('up'));
    top.setAttribute('aria-label', 'Vissza a lap tetejére');
    top.dataset.cursor = 'fel';
    top.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(top);

    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      prog.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
      top.classList.toggle('on', scrollY > 520);
      $$('[data-parallax]').forEach(n => {
        const speed = parseFloat(n.dataset.parallax) || .18;
        const r = n.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) {
          n.style.transform = `translate3d(0, ${(r.top - innerHeight / 2) * -speed}px, 0)`;
        }
      });
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function reveal(root = document) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('[data-reveal]:not(.in)', root).forEach((n, i) => {
      if (!n.style.getPropertyValue('--reveal-delay')) {
        n.style.setProperty('--reveal-delay', ((i % 8) * 65) + 'ms');
      }
      io.observe(n);
    });
    return io;
  }

  /** Betűnkénti címanimáció. */
  function splitText(node) {
    if (!node || node.dataset.split) return;
    node.dataset.split = '1';
    const walk = (n) => {
      if (n.nodeType === 3) {
        /* A forráskód tördeléséből származó tiszta térközt békén hagyjuk —
           különben minden sortörésből önálló, teljes magasságú betűdoboz lenne,
           és szétcsúsznának a sorok. */
        if (!n.textContent.trim()) return;
        const frag = document.createDocumentFragment();
        [...n.textContent].forEach(ch => {
          /* A szóközök maradnak sima szöveg — nem kell rájuk animáció. */
          if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(' ')); return; }
          frag.appendChild(el('span', 'split-char', esc(ch)));
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains('split-char')) {
        [...n.childNodes].forEach(walk);
      }
    };
    [...node.childNodes].forEach(walk);
    $$('.split-char', node).forEach((s, i) => s.style.setProperty('--d', (i * 26) + 'ms'));
    const io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('split-ready'); io.disconnect(); } });
    }, { threshold: .3 });
    io.observe(node);
  }

  /** Számlálók (data-count="128" data-suffix="K"). */
  function counters(root = document) {
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        const n = e.target;
        io.unobserve(n);
        const to = parseFloat(n.dataset.count);
        const dec = parseInt(n.dataset.dec || '0', 10);
        const suf = n.dataset.suffix || '';
        const t0 = performance.now(), dur = 1500;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - k, 3);
          /* magyar tizedesvessző */
          n.textContent = (to * eased).toFixed(dec).replace('.', ',') + suf;
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: .5 });
    $$('[data-count]', root).forEach(n => io.observe(n));
  }

  /** Kártyák fénykövetése + 3D dőlés. */
  function tilt(root = document) {
    $$('.card, .dish', root).forEach(c => {
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
        c.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
      });
    });
    $$('[data-tilt]', root).forEach(c => {
      c.classList.add('tilt');
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5;
        const py = (e.clientY - r.top) / r.height - .5;
        c.style.transform = `perspective(900px) rotateY(${px * 11}deg) rotateX(${-py * 11}deg) translateY(-5px)`;
      });
      c.addEventListener('mouseleave', () => { c.style.transform = ''; });
    });
  }

  /* ======================================================================
     5. Értesítések
     ====================================================================== */
  let toastBox;
  function toast(msg, kind = 'ok', ms = 3400) {
    if (!toastBox) { toastBox = el('div', 'toasts'); document.body.appendChild(toastBox); }
    const ico = { ok: 'check', warn: 'fire', err: 'close', info: 'leaf' }[kind] || 'check';
    const t = el('div', `toast ${kind}`, `${Art.icon(ico, 17)}<div>${msg}</div>`);
    toastBox.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 380); }, ms);
  }

  /* ======================================================================
     6. Modális ablak
     ====================================================================== */
  function modal(html, opts = {}) {
    const m = el('div', 'modal', `<div class="modal-box" role="dialog" aria-modal="true" style="position:relative">
        <button class="modal-close" aria-label="Bezárás">${Art.icon('close', 16)}</button>
        ${html}
      </div>`);
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('on'));
    const close = () => {
      m.classList.remove('on');
      setTimeout(() => m.remove(), 380);
      opts.onClose && opts.onClose();
    };
    $('.modal-close', m).addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    return { node: m, close };
  }

  /* ======================================================================
     7. Kosárfiók
     ====================================================================== */
  let drawer, scrim;
  function buildCart() {
    scrim = el('div', 'drawer-scrim');
    drawer = el('aside', 'drawer', `
      <div class="drawer-head">
        <h3 style="font-size:1.2rem">A kosarad</h3>
        <button class="icon-btn" id="cartClose" aria-label="Bezárás">${Art.icon('close', 16)}</button>
      </div>
      <div class="drawer-body" id="cartBody"></div>
      <div class="drawer-foot">
        <div class="row row-between" style="margin-bottom:.9rem">
          <span class="muted">Részösszeg</span>
          <b id="cartTotal" style="font-family:var(--f-display);font-size:1.5rem;color:var(--gold)">0 Ft</b>
        </div>
        <p class="tiny dim" style="margin-bottom:.8rem">
          A kiszállítás 12 000 Ft felett ingyenes, alatta 890 Ft (5 km-en belül).
        </p>
        <button class="btn btn-primary btn-block" id="cartOrder">${Art.icon('check', 16)} Rendelés véglegesítése</button>
        <button class="btn btn-ghost btn-block btn-sm mt-2" id="cartWipe">Kosár ürítése</button>
      </div>`);
    document.body.append(scrim, drawer);

    $('#cartClose').addEventListener('click', closeCart);
    scrim.addEventListener('click', closeCart);
    $('#cartWipe').addEventListener('click', () => { Store.cartClear(); toast('Kosár kiürítve', 'warn'); });
    $('#cartOrder').addEventListener('click', checkout);
    Store.on(w => { if (w === 'cart') paintCart(); });
    paintCart();
  }
  function openCart() {
    if (!drawer) buildCart();
    drawer.classList.add('on'); scrim.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeCart() {
    drawer.classList.remove('on'); scrim.classList.remove('on');
    document.body.style.overflow = '';
  }
  function paintCartCount() {
    const b = $('#cartCount');
    if (!b) return;
    const n = Store.cartCount();
    b.textContent = n;
    b.classList.toggle('on', n > 0);
  }
  function paintCart() {
    paintCartCount();
    const body = $('#cartBody');
    if (!body) return;
    const lines = Store.cart();
    if (!lines.length) {
      body.innerHTML = `<div class="empty">${Art.icon('cart', 46)}
        <p>Még üres a kosarad.</p>
        <a class="link-arrow" href="etlap.html">Irány az étlap ${Art.icon('arrow', 14)}</a></div>`;
    } else {
      body.innerHTML = lines.map(l => `
        <div class="cart-line">
          <div class="thumb">${Art.pizza({ seed: l.id, toppings: l.toppings || [], base: l.base, size: 52 })}</div>
          <div>
            <h5>${esc(l.name)}</h5>
            <div class="tiny dim">${l.size ? l.size + ' cm · ' : ''}${Store.huf(l.price)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.35rem">
            <div class="qty">
              <button data-q="-1" data-k="${l.key}" aria-label="Kevesebb">${Art.icon('minus', 13)}</button>
              <span>${l.qty}</span>
              <button data-q="1" data-k="${l.key}" aria-label="Több">${Art.icon('plus', 13)}</button>
            </div>
            <b class="tiny">${Store.huf(l.price * l.qty)}</b>
          </div>
        </div>`).join('');
      $$('[data-q]', body).forEach(b =>
        b.addEventListener('click', () => Store.cartQty(b.dataset.k, +b.dataset.q)));
    }
    const tot = $('#cartTotal');
    if (tot) tot.textContent = Store.huf(Store.cartTotal());
  }
  function checkout() {
    if (!Store.cartCount()) { toast('A kosár üres', 'warn'); return; }
    const total = Store.cartTotal();
    const ship = total >= 12000 ? 0 : 890;
    closeCart();
    modal(`
      <h3 style="margin-bottom:.4rem">Rendelés összesítő</h3>
      <p class="muted tiny">Ez egy bemutató sablon — éles rendszerben itt jönne a fizetés.</p>
      <div class="mt-3">
        <div class="recap-row"><span>Ételek</span><b>${Store.huf(total)}</b></div>
        <div class="recap-row"><span>Kiszállítás</span><b>${ship ? Store.huf(ship) : 'Ingyenes'}</b></div>
        <div class="recap-row" style="border:0"><span>Fizetendő</span><b style="color:var(--gold);font-size:1.2rem">${Store.huf(total + ship)}</b></div>
      </div>
      <p class="mt-3 muted" style="font-size:.88rem">Becsült kiszállítás: <b>${25 + Math.floor(Math.random() * 15)} perc</b></p>
      <button class="btn btn-primary btn-block mt-3" id="okOrder">Rendben, köszönöm!</button>`);
    setTimeout(() => {
      const b = $('#okOrder');
      b && b.addEventListener('click', () => {
        Store.cartClear();
        $('.modal') && $('.modal').classList.remove('on');
        setTimeout(() => $$('.modal').forEach(m => m.remove()), 360);
        confetti();
        toast('Köszönjük a rendelést! Már gyúrjuk is a tésztát 🍕', 'ok', 5000);
      });
    }, 30);
  }

  /* ======================================================================
     8. Ünneplés + húsvéti tojás
     ====================================================================== */
  function confetti(n = 90) {
    const box = el('div', 'confetti');
    document.body.appendChild(box);
    const colors = ['#E9B44C', '#E0503F', '#4C9A5C', '#7BD08C', '#C4603A', '#F7D488'];
    for (let i = 0; i < n; i++) {
      const c = el('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDuration = (2 + Math.random() * 2.2) + 's';
      c.style.animationDelay = (Math.random() * .6) + 's';
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(c);
    }
    setTimeout(() => box.remove(), 5200);
  }

  function leafRain(n = 32) {
    const box = el('div', 'leaf-rain');
    document.body.appendChild(box);
    for (let i = 0; i < n; i++) {
      const l = el('i', '', `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z" fill="#4FA45E"/><path d="M4 20c4-6 8-9 12-10" stroke="#2E6C39" stroke-width="1.4" fill="none"/></svg>`);
      l.style.left = Math.random() * 100 + 'vw';
      l.style.animationDuration = (3 + Math.random() * 3) + 's';
      l.style.animationDelay = (Math.random() * 1.6) + 's';
      box.appendChild(l);
    }
    setTimeout(() => box.remove(), 7200);
  }

  function easterEgg() {
    let buf = '';
    addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;
      buf = (buf + e.key.toLowerCase()).slice(-6);
      if (buf.endsWith('pizza')) {
        leafRain();
        toast('🌿 Bazsalikom-eső! Írd be, hogy <b>bazsalikom</b> a nagy meglepetéshez.', 'info', 5000);
      }
      if (buf.endsWith('basil')) {
        confetti(140); leafRain(50);
        toast('🎉 Megtaláltad a titkos kódot! Mutasd meg a pultnál, és kapsz egy eszpresszót.', 'ok', 7000);
      }
    });
  }

  /* ======================================================================
     9. Sütibanner
     ====================================================================== */
  function cookies() {
    if (Store.cookieOk()) return;
    const c = el('div', 'cookie', `
      <b style="display:block;margin-bottom:.35rem">🍪 (Meg persze 🍕)</b>
      <p class="tiny muted">Sütiket használunk, hogy megjegyezzük a kosaradat, a témabeállításodat és a foglalásaidat. Semmi mást nem követünk.</p>
      <div class="row mt-2" style="gap:.5rem">
        <button class="btn btn-primary btn-sm" id="ckOk">Rendben</button>
        <button class="btn btn-ghost btn-sm" id="ckNo">Csak a szükségeseket</button>
      </div>`);
    document.body.appendChild(c);
    setTimeout(() => c.classList.add('on'), 2200);
    const hide = () => { Store.acceptCookie(); c.classList.remove('on'); setTimeout(() => c.remove(), 700); };
    $('#ckOk', c).addEventListener('click', hide);
    $('#ckNo', c).addEventListener('click', hide);
  }

  /* ======================================================================
     10. Gyorsbillentyűk
     ====================================================================== */
  function shortcuts() {
    addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;
      if (e.key === '/') {
        const s = $('#menuSearch');
        if (s) { e.preventDefault(); s.focus(); }
        else { location.href = 'etlap.html'; }
      }
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openCart(); }
      if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) {
        Store.toggleTheme();
        const tb = $('#themeBtn');
        if (tb) tb.innerHTML = Store.theme() === 'dark' ? Art.icon('moon') : Art.icon('sun');
      }
    });
  }

  /* ======================================================================
     11. Közös darabkák, amiket több oldal is használ
     ====================================================================== */

  const TAGNAMES = { veg: '🌱 Vega', hot: '🌶 Csípős', new: '✦ Új', top: '★ Népszerű', gluten: 'GM' };

  function tagChips(tags = []) {
    return tags.map(t => `<span class="tag tag-${t}">${TAGNAMES[t] || t}</span>`).join('');
  }
  function heatMeter(level) {
    if (!level) return '';
    return `<span class="heat" title="Csípősség: ${level}/3">${[1, 2, 3].map(i =>
      `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;
  }
  function allergenRow(list = []) {
    return `<span class="allergens">${list.map(a =>
      `<i class="allergen" title="${esc(DATA.allergenMap[a] || a)}">${esc(a)}</i>`).join('')}</span>`;
  }
  function starRow(n = 5) {
    return `<span class="stars">${Array.from({ length: 5 }, (_, i) =>
      Art.iconSolid('star', 14)).join('')}</span>`;
  }

  /** Egy étel kártyája az étlaphoz és a kedvencekhez. */
  function dishCard(m, size = 32) {
    const price = size === 40 && m.price40 ? m.price40 : m.price;
    const art = Art.photo(m.photo, m.name,
      Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 92, alt: m.name }));
    return `<article class="dish${m.available === false ? ' sold-out' : ''}" data-id="${m.id}"
              data-cat="${m.cat}" data-name="${esc(m.name.toLowerCase())} ${esc((m.ings || '').toLowerCase())}"
              data-tags="${(m.tags || []).join(' ')}" data-price="${price}">
      ${m.available === false ? '<span class="dish-ribbon">Elfogyott</span>' : ''}
      <div class="dish-art">${art}</div>
      <div class="dish-main">
        <div class="dish-head">
          <h3>${esc(m.name)}</h3>
          <span class="dish-price">${Store.huf(price)}</span>
        </div>
        <p class="dish-ings">${esc(m.ings)}</p>
        <div class="dish-foot">
          <span class="dish-tags">${tagChips(m.tags)} ${heatMeter(m.heat)}</span>
          <span class="row" style="gap:.4rem">
            ${allergenRow(m.allergens)}
            <button class="dish-add" data-add="${m.id}" aria-label="${esc(m.name)} kosárba" data-cursor="+">
              ${Art.icon('plus', 16)}
            </button>
          </span>
        </div>
      </div>
    </article>`;
  }

  /** Étel-részletek modálisban. */
  function openDish(id, size = 32) {
    const m = Store.menuItem(id);
    if (!m) return;
    const price = size === 40 && m.price40 ? m.price40 : m.price;
    const fav = Store.user().favorites.includes(id);
    const mm = modal(`
      <div style="text-align:center">
        ${Art.photo(m.photo, m.name, Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 200 }))
          .replace('<svg', '<svg style="margin:0 auto"')}
      </div>
      <h3 class="mt-2" style="text-align:center">${esc(m.name)}</h3>
      <p class="muted center-text" style="font-size:.9rem">${esc(m.desc || '')}</p>
      <div class="row mt-2" style="justify-content:center">${tagChips(m.tags)} ${heatMeter(m.heat)}</div>
      <div class="mt-3">
        <div class="recap-row"><span>Összetevők</span><b style="max-width:60%">${esc(m.ings)}</b></div>
        ${m.kcal ? `<div class="recap-row"><span>Energia</span><b>${m.kcal} kcal</b></div>` : ''}
        ${m.allergens && m.allergens.length ? `<div class="recap-row"><span>Allergének</span><b>${m.allergens.map(a => esc(DATA.allergenMap[a] || a)).join(', ')}</b></div>` : ''}
        <div class="recap-row" style="border:0"><span>Ár</span><b style="color:var(--gold);font-size:1.2rem">${Store.huf(price)}</b></div>
      </div>
      <div class="row mt-3" style="gap:.6rem">
        <button class="btn btn-primary" id="mAdd" style="flex:1">${Art.icon('cart', 16)} Kosárba</button>
        <button class="icon-btn" id="mFav" aria-label="Kedvenc" style="color:${fav ? 'var(--tomato)' : ''}">${Art.icon('heart')}</button>
      </div>`);
    setTimeout(() => {
      $('#mAdd', mm.node).addEventListener('click', () => {
        Store.cartAdd(id, { size }); toast(`<b>${esc(m.name)}</b> a kosárban`, 'ok'); mm.close();
      });
      $('#mFav', mm.node).addEventListener('click', (e) => {
        const on = Store.toggleFavorite(id);
        e.currentTarget.style.color = on ? 'var(--tomato)' : '';
        toast(on ? 'Hozzáadva a kedvencekhez ❤' : 'Törölve a kedvencekből', on ? 'ok' : 'warn', 2200);
      });
    }, 20);
  }

  /** Kattintáskezelő az étel-kártyákhoz (kosár + részletek). */
  function bindDishes(root = document, getSize = () => 32) {
    root.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) {
        e.stopPropagation();
        const id = add.dataset.add;
        Store.cartAdd(id, { size: getSize() });
        const m = Store.menuItem(id);
        toast(`<b>${esc(m.name)}</b> a kosárban`, 'ok', 2400);
        add.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 380 });
        return;
      }
      const dish = e.target.closest('.dish[data-id]');
      if (dish) openDish(dish.dataset.id, getSize());
    });
  }

  /* CTA sáv, amit több oldal is használ */
  function ctaBand() {
    return `<section class="section"><div class="wrap">
      <div class="cta-band" data-reveal="zoom">
        <p class="script" style="color:#F7D488">Éhes vagy? Mi készen állunk.</p>
        <h2 style="color:#fff;margin:.4rem 0 1rem">Foglalj asztalt 30 másodperc alatt</h2>
        <p style="color:rgba(255,255,255,.82);max-width:52ch;margin:0 auto 1.6rem">
          Azonnali visszaigazolás, ingyenes lemondás a foglalás előtt 2 óráig.
          Csütörtöktől vasárnapig érdemes előre szólni.
        </p>
        <div class="row" style="justify-content:center;gap:.7rem">
          <a class="btn btn-gold btn-lg" href="foglalas.html">${Art.icon('calendar', 17)} Asztalfoglalás <span class="arr">→</span></a>
          <a class="btn btn-ghost btn-lg" href="tel:${DATA.brand.phoneHref}" style="border-color:rgba(255,255,255,.4);color:#fff">
            ${Art.icon('phone', 17)} ${esc(DATA.brand.phone)}</a>
        </div>
      </div></div></section>`;
  }

  /* ======================================================================
     12. Indítás
     ====================================================================== */
  function boot(opts = {}) {
    document.documentElement.setAttribute('data-theme', Store.theme());
    document.body.classList.add('bg-grain');

    if (!opts.bare) {
      preloader();
      header();
    }
    cursor();
    scrollFx();
    reveal();
    counters();
    tilt();
    easterEgg();
    shortcuts();
    if (!opts.bare) {
      cookies();
      footer();
    }
    $$('[data-split]').forEach(splitText);
    document.dispatchEvent(new CustomEvent('ui:boot'));
  }

  return {
    $, $$, el, esc, boot, header, footer, toast, modal, reveal, counters, tilt,
    splitText, confetti, leafRain, openCart, closeCart, statusMarkup, paintStatus,
    dishCard, openDish, bindDishes, tagChips, heatMeter, allergenRow, starRow, ctaBand, NAV, page
  };
})();

window.UI = UI;
