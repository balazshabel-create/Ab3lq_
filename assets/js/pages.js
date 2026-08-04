/* ==========================================================================
   BASILICO BISTRO — pages.js
   Oldalankénti logika. A <body data-page="…"> attribútum dönti el,
   melyik indító fut le. Így egyetlen fájlban marad a teljes viselkedés,
   és nem kell oldalanként külön scriptet karbantartani.
   ========================================================================== */

(() => {
  const { $, $$, el, esc, toast, modal } = UI;

  /* ======================================================================
     KÖZÖS DARABOK
     ====================================================================== */

  function mountCta() {
    const n = $('#cta');
    if (n) { n.outerHTML = UI.ctaBand(); }
  }

  function headDeco() {
    const d = $('#headDeco');
    if (d) d.innerHTML = Art.pizza({ seed: 'deco', toppings: ['szalami', 'bazsalikom', 'olivabogyo'], size: 320 });
  }

  function hoursTable(target) {
    const H = Store.hours(), today = new Date().getDay();
    target.innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `
      <div class="hours-row${d === today ? ' today' : ''}">
        <span class="d">${DATA.dayNames[d]}</span>
        <span>${H[d] ? `${H[d].open} – ${H[d].close}` : '<span style="color:var(--tomato-lt)">Zárva</span>'}</span>
      </div>`).join('');
  }

  /* ======================================================================
     FŐOLDAL
     ====================================================================== */
  function initHome() {
    /* Hero pizza */
    $('#heroPizza').innerHTML = Art.pizza({
      seed: 'hero-margherita',
      toppings: ['mozzarella', 'bazsalikom', 'paradicsom'],
      base: 'paradicsom', size: 500, alt: 'Margherita pizza felülnézetből'
    });

    /* Hero tények */
    $('#heroFacts').innerHTML = [
      { b: '4,9', s: 'Google értékelés' },
      { b: '1284', s: 'Vélemény' },
      { b: '2020', s: 'Óta sütünk' }
    ].map(f => `<div class="fact"><b>${f.b}</b><span>${f.s}</span></div>`).join('');

    /* Futósáv */
    const strip = DATA.ticker.map(t => `<span>${esc(t)} <em>✦</em></span>`).join('');
    $('#ticker').innerHTML = strip + strip;

    /* Akciók */
    $('#promos').innerHTML = DATA.promos.map((p, i) => `
      <article class="card" data-reveal data-tilt style="--reveal-delay:${i * 90}ms">
        <div style="font-size:1.7rem">${p.icon}</div>
        <h4 class="mt-1" style="font-family:var(--f-display);font-size:1.12rem">${esc(p.title)}</h4>
        <p class="muted tiny mt-1">${esc(p.text)}</p>
      </article>`).join('');

    /* Legnépszerűbbek */
    $('#menuCount').textContent = Store.menu().length;
    const top = Store.menu().filter(m => (m.tags || []).includes('top') && m.cat !== 'ital').slice(0, 4);
    $('#topPizzas').innerHTML = top.map((m, i) => `
      <article class="card pizza-card" data-reveal="zoom" data-id="${m.id}" style="--reveal-delay:${i * 110}ms">
        <span class="rank">${i + 1}</span>
        <div class="art">${Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 210, alt: m.name })}</div>
        <h3>${esc(m.name)}</h3>
        <p class="ings">${esc((m.ings || '').split(',').slice(0, 3).join(', '))}</p>
        <div class="tags">${UI.tagChips(m.tags)}${UI.heatMeter(m.heat)}</div>
        <div class="price-row">
          <span class="price">${Store.huf(m.price)}</span>
          <button class="dish-add" data-add="${m.id}" aria-label="${esc(m.name)} kosárba">+</button>
        </div>
      </article>`).join('');
    UI.bindDishes($('#topPizzas'));
    $('#topPizzas').addEventListener('click', e => {
      const c = e.target.closest('.pizza-card');
      if (c && !e.target.closest('[data-add]')) UI.openDish(c.dataset.id);
    });

    /* Számok */
    $('#stats').innerHTML = DATA.stats.map((s, i) => `
      <div class="center-text" data-reveal style="--reveal-delay:${i * 90}ms">
        <b style="font-family:var(--f-display);font-size:clamp(2.4rem,5vw,3.6rem);color:var(--gold);display:block;line-height:1"
           data-count="${s.num}" data-suffix="${s.suffix}" ${s.dec ? `data-dec="${s.dec}"` : ''}>0</b>
        <span class="tiny dim" style="letter-spacing:.14em;text-transform:uppercase">${esc(s.label)}</span>
      </div>`).join('');

    /* Történet-illusztráció */
    $('#storyArt').innerHTML = Art.scene('teszta');

    /* Galéria-előnézet */
    $('#galleryPeek').innerHTML = ['kemence', 'belso', 'terasz'].map((k, i) => `
      <a class="shot" href="galeria.html" data-reveal="zoom" style="--reveal-delay:${i * 110}ms">
        <div class="shot-media">${Art.scene(k)}</div>
        <div class="shot-cap"><h4>${['A kemence', 'Az étterem', 'A terasz'][i]}</h4>
          <p>${['485 fok, tölgyfa, kilencven másodperc.', 'Hatvannégy hely, meleg fények.', 'Nyáron a legjobb asztal.'][i]}</p></div>
        <span class="shot-zoom">${Art.icon('search', 16)}</span>
      </a>`).join('');

    /* Vélemények */
    const track = $('#reviewTrack'), dots = $('#reviewDots');
    track.innerHTML = DATA.reviews.map(r => `
      <div class="review-slide">
        <div class="card review-card">
          ${UI.starRow(r.stars)}
          <blockquote>„${esc(r.text)}”</blockquote>
          <b>${esc(r.name)}</b>
          <p class="tiny dim">${esc(r.where)}</p>
        </div>
      </div>`).join('');
    dots.innerHTML = DATA.reviews.map((_, i) => `<button data-i="${i}" class="${i ? '' : 'on'}" aria-label="${i + 1}. vélemény"></button>`).join('');
    let ri = 0, timer;
    const go = (i) => {
      ri = (i + DATA.reviews.length) % DATA.reviews.length;
      track.style.transform = `translateX(-${ri * 100}%)`;
      $$('button', dots).forEach((b, k) => b.classList.toggle('on', k === ri));
    };
    const auto = () => { clearInterval(timer); timer = setInterval(() => go(ri + 1), 6000); };
    dots.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { go(+b.dataset.i); auto(); } });
    auto();

    /* Nyitvatartás + szolgáltatások */
    hoursTable($('#hoursTable'));
    $('#features').innerHTML = DATA.brand.features.map(f =>
      `<span class="pill-stat">${Art.icon(f.icon, 15)} ${esc(f.label)}</span>`).join('');

    /* Hírlevél */
    $('#newsletter').addEventListener('submit', e => {
      e.preventDefault();
      const i = $('input', e.target);
      if (!i.value.includes('@')) { toast('Hoppá, ez nem tűnik e-mail címnek', 'err'); return; }
      i.value = '';
      UI.confetti(50);
      toast('Köszönjük! Havonta egy levél, nem több. 🌿', 'ok');
    });

    mountCta();
    UI.reveal(); UI.counters(); UI.tilt();
  }

  /* ======================================================================
     ÉTLAP
     ====================================================================== */
  function initEtlap() {
    headDeco();

    const state = { cat: 'all', q: '', tags: new Set(), size: 32, sort: 'default' };

    /* Kategória-szűrő */
    const cats = [{ id: 'all', name: 'Minden' }].concat(DATA.categories);
    $('#catFilter').innerHTML = cats.map(c => {
      const n = c.id === 'all' ? Store.menu().length : Store.menu().filter(m => m.cat === c.id).length;
      return `<button class="chip${c.id === 'all' ? ' on' : ''}" data-cat="${c.id}">${esc(c.name)} <span class="cnt">${n}</span></button>`;
    }).join('');

    /* Címke-szűrő */
    const TAGS = [
      { id: 'veg', label: '🌱 Vegetáriánus / vegán' },
      { id: 'hot', label: '🌶 Csípős' },
      { id: 'new', label: '✦ Újdonság' },
      { id: 'top', label: '★ Népszerű' }
    ];
    $('#tagFilter').innerHTML = TAGS.map(t =>
      `<button class="chip" data-tag="${t.id}">${t.label}</button>`).join('');

    /* Kirajzolás */
    function render() {
      const all = Store.menu();
      let list = all.filter(m => {
        if (state.cat !== 'all' && m.cat !== state.cat) return false;
        if (state.tags.size && ![...state.tags].every(t => (m.tags || []).includes(t))) return false;
        if (state.q) {
          const hay = (m.name + ' ' + m.ings + ' ' + (m.desc || '')).toLowerCase();
          if (!hay.includes(state.q)) return false;
        }
        return true;
      });

      const price = (m) => (state.size === 40 && m.price40) ? m.price40 : m.price;
      if (state.sort === 'price-asc')  list.sort((a, b) => price(a) - price(b));
      if (state.sort === 'price-desc') list.sort((a, b) => price(b) - price(a));
      if (state.sort === 'name')       list.sort((a, b) => a.name.localeCompare(b.name, 'hu'));

      $('#resultCount').textContent = `${list.length} találat${state.q ? ` a(z) „${state.q}” keresésre` : ''}`;
      $('#menuEmpty').classList.toggle('hidden', list.length > 0);

      const groups = DATA.categories
        .map(c => ({ c, items: list.filter(m => m.cat === c.id) }))
        .filter(g => g.items.length);

      $('#menuList').innerHTML = groups.map(g => `
        <section>
          <div class="menu-group-title">
            <h2>${esc(g.c.name)}</h2>
            <span class="cnt">${g.items.length}</span>
          </div>
          <p class="tiny dim" style="margin:-.9rem 0 1.1rem">${esc(g.c.note)}</p>
          <div class="menu-grid">
            ${g.items.map(m => UI.dishCard(m, state.size)).join('')}
          </div>
        </section>`).join('');

      UI.tilt($('#menuList'));
    }

    /* Események */
    $('#catFilter').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      state.cat = b.dataset.cat;
      $$('#catFilter .chip').forEach(c => c.classList.toggle('on', c === b));
      render();
    });
    $('#tagFilter').addEventListener('click', e => {
      const b = e.target.closest('[data-tag]'); if (!b) return;
      const t = b.dataset.tag;
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      b.classList.toggle('on', state.tags.has(t));
      render();
    });
    let deb;
    $('#menuSearch').addEventListener('input', e => {
      clearTimeout(deb);
      deb = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 180);
    });
    $('#sizeSwitch').addEventListener('click', e => {
      const b = e.target.closest('[data-size]'); if (!b) return;
      state.size = +b.dataset.size;
      $$('#sizeSwitch button').forEach(x => x.classList.toggle('on', x === b));
      render();
      toast(state.size === 40 ? 'Nagy méret (40 cm) árai' : 'Alap méret (32 cm) árai', 'info', 1800);
    });
    $('#sortBy').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('#clearFilters').addEventListener('click', () => {
      state.cat = 'all'; state.q = ''; state.tags.clear();
      $('#menuSearch').value = '';
      $$('#catFilter .chip').forEach((c, i) => c.classList.toggle('on', i === 0));
      $$('#tagFilter .chip').forEach(c => c.classList.remove('on'));
      render();
    });

    UI.bindDishes($('#menuList'), () => state.size);
    render();

    /* Allergén-jelmagyarázat */
    $('#allergenLegend').innerHTML = Object.entries(DATA.allergenMap).map(([k, v]) =>
      `<span class="pill-stat"><i class="allergen">${k}</i> ${esc(v)}</span>`).join('');

    initBuilder();
    mountCta();
    UI.reveal();
  }

  /* ---------------------- PIZZAÉPÍTŐ ---------------------- */
  function initBuilder() {
    const B = DATA.builder;
    const st = { base: 'paradicsom', dough: 'classic', size: 32, picked: new Set(['mozzarella']) };

    const chipRow = (node, arr, key, fmt) => {
      node.innerHTML = arr.map(x =>
        `<button class="chip${x.id === st[key] ? ' on' : ''}" data-v="${x.id}">${esc(x.name)}${fmt ? fmt(x) : ''}</button>`).join('');
      node.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        st[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
        $$('.chip', node).forEach(c => c.classList.toggle('on', c === b));
        paint();
      });
    };

    chipRow($('#baseRow'),  B.bases,  'base',  x => x.price ? ` <span class="cnt">+${x.price}</span>` : '');
    chipRow($('#doughRow'), B.doughs, 'dough', x => x.price ? ` <span class="cnt">+${x.price}</span>` : '');
    chipRow($('#sizeRow'),  B.sizes,  'size',  x => x.mult > 1 ? ` <span class="cnt">×${x.mult}</span>` : '');

    $('#toppingGrid').innerHTML = B.items.map(t => `
      <button class="topping${st.picked.has(t.id) ? ' on' : ''}" data-t="${t.id}">
        <span class="dotc" style="background:${t.color}"></span>
        <span>${esc(t.name)}</span>
        <span class="p">+${t.price} Ft</span>
      </button>`).join('');

    $('#toppingGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const id = b.dataset.t;
      if (st.picked.has(id)) st.picked.delete(id);
      else {
        if (st.picked.size >= 8) { toast('Nyolc feltétnél megállunk — utána már nem sül át rendesen.', 'warn'); return; }
        st.picked.add(id);
      }
      b.classList.toggle('on', st.picked.has(id));
      const pz = $('#builderPizza');
      pz.classList.add('bump');
      setTimeout(() => pz.classList.remove('bump'), 420);
      paint();
    });

    function total() {
      const size = B.sizes.find(s => s.id === st.size);
      const dough = B.doughs.find(d => d.id === st.dough);
      const base = B.bases.find(b => b.id === st.base);
      const tops = [...st.picked].reduce((s, id) => s + (B.items.find(i => i.id === id)?.price || 0), 0);
      return Math.round((B.basePrice + base.price + dough.price + tops) * size.mult);
    }

    function paint() {
      $('#builderPizza').innerHTML = Art.pizza({
        seed: 'builder-' + [...st.picked].join('-') + st.base,
        toppings: [...st.picked], base: st.base, size: 400, density: 1.1,
        alt: 'A saját pizzád előnézete'
      });
      $('#topCount').textContent = `(${st.picked.size}/8 kiválasztva)`;

      const size = B.sizes.find(s => s.id === st.size);
      const dough = B.doughs.find(d => d.id === st.dough);
      const base = B.bases.find(b => b.id === st.base);
      const rows = [
        ['Alaptészta', Store.huf(B.basePrice)],
        [base.name, base.price ? '+' + Store.huf(base.price) : 'ingyen'],
        [dough.name, dough.price ? '+' + Store.huf(dough.price) : 'ingyen'],
        ...[...st.picked].map(id => {
          const t = B.items.find(i => i.id === id);
          return [t.name, '+' + Store.huf(t.price)];
        }),
        [`Méret: ${size.name}`, size.mult > 1 ? `×${size.mult}` : '—']
      ];
      $('#sumLines').innerHTML = rows.map(([a, b]) =>
        `<div class="sum-line"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('');
      $('#sumTotal').textContent = Store.huf(total());
    }

    $('#builderAdd').addEventListener('click', () => {
      if (!st.picked.size) { toast('Válassz legalább egy feltétet!', 'warn'); return; }
      const name = ($('#pizzaName').value || '').trim() || 'Saját pizzám';
      Store.cartAddCustom({
        id: 'custom', name, size: st.size, price: total(),
        toppings: [...st.picked], base: st.base
      });
      UI.confetti(40);
      toast(`<b>${esc(name)}</b> a kosárban — jó választás!`, 'ok');
    });

    $('#builderReset').addEventListener('click', () => {
      st.base = 'paradicsom'; st.dough = 'classic'; st.size = 32;
      st.picked = new Set(['mozzarella']);
      $('#pizzaName').value = '';
      $$('#baseRow .chip').forEach((c, i) => c.classList.toggle('on', i === 0));
      $$('#doughRow .chip').forEach((c, i) => c.classList.toggle('on', i === 0));
      $$('#sizeRow .chip').forEach((c, i) => c.classList.toggle('on', i === 0));
      $$('#toppingGrid .topping').forEach(t => t.classList.toggle('on', t.dataset.t === 'mozzarella'));
      paint();
    });

    $('#builderRandom').addEventListener('click', () => {
      const pool = [...B.items];
      st.picked = new Set();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        st.picked.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
      }
      st.base = B.bases[Math.floor(Math.random() * B.bases.length)].id;
      $$('#baseRow .chip').forEach(c => c.classList.toggle('on', c.dataset.v === st.base));
      $$('#toppingGrid .topping').forEach(t => t.classList.toggle('on', st.picked.has(t.dataset.t)));
      const names = ['Éjféli Bazsalikom', 'Kőfaragó Különleges', 'Palotanegyed', 'Vulkán', 'Marco Titka', 'Szerdai Meglepetés'];
      $('#pizzaName').value = names[Math.floor(Math.random() * names.length)];
      paint();
      toast('Íme egy véletlen kombináció. Merész, de működhet. 🎲', 'info');
    });

    paint();
  }

  /* ======================================================================
     GALÉRIA
     ====================================================================== */
  function initGaleria() {
    headDeco();
    const items = DATA.gallery;

    $('#galFilter').innerHTML = DATA.galleryCats.map((c, i) =>
      `<button class="chip${i ? '' : ' on'}" data-g="${c.id}">${esc(c.name)}</button>`).join('');

    /* A jeleneteket a saját 4:3 arányukban hagyjuk (nem vágunk bele), a masonry
       ritmusát pedig az adja, hogy minden harmadik csempe állandó feliratot kap. */
    $('#gallery').innerHTML = items.map((g, i) => {
      const withFoot = i % 3 === 0;
      const media = Art.photo(Store.galleryPhoto(g), g.title, Art.scene(g.scene));
      return `<button class="shot" data-i="${i}" data-cat="${g.cat}" data-reveal="zoom" style="--reveal-delay:${(i % 6) * 80}ms">
        <div class="shot-media">${media}</div>
        ${withFoot
          ? `<div class="shot-foot"><h4>${esc(g.title)}</h4><p>${esc(g.text)}</p></div>`
          : `<div class="shot-cap"><h4>${esc(g.title)}</h4><p>${esc(g.text)}</p></div>`}
        <span class="shot-zoom">${Art.icon('search', 16)}</span>
      </button>`;
    }).join('');

    $('#galFilter').addEventListener('click', e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const cat = b.dataset.g;
      $$('#galFilter .chip').forEach(c => c.classList.toggle('on', c === b));
      $$('#gallery .shot').forEach(s =>
        s.classList.toggle('hide', cat !== 'all' && s.dataset.cat !== cat));
    });

    /* --- Fénydoboz --- */
    const lb = $('#lightbox');
    let li = 0;
    const showLb = (i) => {
      li = (i + items.length) % items.length;
      const g = items[li];
      $('#lbFrame').innerHTML = Art.photo(Store.galleryPhoto(g), g.title, Art.scene(g.scene));
      $('#lbTitle').textContent = g.title;
      $('#lbText').textContent = g.text + ` · ${li + 1} / ${items.length}`;
      lb.classList.add('on');
      document.body.style.overflow = 'hidden';
    };
    const hideLb = () => { lb.classList.remove('on'); document.body.style.overflow = ''; };

    $('#gallery').addEventListener('click', e => {
      const s = e.target.closest('[data-i]');
      if (s) showLb(+s.dataset.i);
    });
    $('#lbPrev').addEventListener('click', () => showLb(li - 1));
    $('#lbNext').addEventListener('click', () => showLb(li + 1));
    $('#lbClose').addEventListener('click', hideLb);
    lb.addEventListener('click', e => { if (e.target === lb) hideLb(); });
    addEventListener('keydown', e => {
      if (!lb.classList.contains('on')) return;
      if (e.key === 'Escape') hideLb();
      if (e.key === 'ArrowLeft') showLb(li - 1);
      if (e.key === 'ArrowRight') showLb(li + 1);
    });

    /* --- Diavetítés --- */
    let si = 0, playing = false, sTimer;
    const paintSlide = () => {
      const g = items[si];
      $('#slideshow').innerHTML = Art.scene(g.scene);
      $('#slideTitle').textContent = g.title;
      $('#slideText').textContent = g.text;
      $('#slideBar').style.width = ((si + 1) / items.length * 100) + '%';
    };
    const step = (d) => { si = (si + d + items.length) % items.length; paintSlide(); };
    $('#slidePrev').addEventListener('click', () => { step(-1); });
    $('#slideNext').addEventListener('click', () => { step(1); });
    $('#slidePlay').addEventListener('click', (e) => {
      playing = !playing;
      e.currentTarget.textContent = playing ? '❚❚' : '▶';
      clearInterval(sTimer);
      if (playing) sTimer = setInterval(() => step(1), 2600);
    });
    paintSlide();

    mountCta();
    UI.reveal();
  }

  /* ======================================================================
     FOGLALÁS
     ====================================================================== */
  function initFoglalas() {
    headDeco();

    const iso = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };
    const st = {
      step: 0, people: 2, occasion: DATA.occasions[0],
      date: null, time: null, table: null
    };

    /* --- 1. lépés: létszám --- */
    const peopleHints = {
      1: 'Egy jó könyv és egy Margherita. Tökéletes.',
      2: 'Tökéletes egy nyugodt vacsorához.',
      3: 'Kis társaság — ablak melletti asztalt ajánlunk.',
      4: 'Klasszikus négyes. Két pizza és egy tál előétel.',
      5: 'Öten már megéri a Tagliere Mistót kérni.',
      6: 'Nagyasztalra ültetünk benneteket.',
      7: 'Hét fő — érdemes előre szólni a konyhának.',
      8: 'Nyolcan a nagy kerek asztalra fértek el.'
    };
    const paintPeople = () => {
      $('#peopleVal').textContent = st.people;
      $('#peopleWord').textContent = st.people === 1 ? 'fő' : 'fő';
      $('#peopleHint').textContent = peopleHints[st.people] || 'Nagy társasághoz írj e-mailt, külön menüt tervezünk.';
      $$('#quickPeople .chip').forEach(c => c.classList.toggle('on', +c.dataset.p === st.people));
      paintRecap();
    };
    $('#quickPeople').innerHTML = [2, 4, 6, 8].map(p =>
      `<button class="chip${p === 2 ? ' on' : ''}" data-p="${p}">${p} fő</button>`).join('');
    $('#quickPeople').addEventListener('click', e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      st.people = +b.dataset.p; paintPeople();
    });
    $('#peopleMinus').addEventListener('click', () => { st.people = Math.max(1, st.people - 1); paintPeople(); });
    $('#peoplePlus').addEventListener('click', () => {
      if (st.people >= 12) { toast('Tizenkét fő fölött írj nekünk e-mailt — külön ajánlatot adunk.', 'warn'); return; }
      st.people++; paintPeople();
    });

    $('#occasionRow').innerHTML = DATA.occasions.map((o, i) =>
      `<button class="chip${i ? '' : ' on'}" data-o="${esc(o)}">${esc(o)}</button>`).join('');
    $('#occasionRow').addEventListener('click', e => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      st.occasion = b.dataset.o;
      $$('#occasionRow .chip').forEach(c => c.classList.toggle('on', c === b));
      paintRecap();
    });

    /* --- 2. lépés: nap és idő --- */
    const H = Store.hours();
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      days.push({ d, iso: iso(d), dow: d.getDay(), closed: !H[d.getDay()] });
    }
    $('#dayRow').innerHTML = days.map((x, i) => `
      <button class="chip" data-d="${x.iso}" ${x.closed ? 'disabled style="opacity:.35"' : ''}>
        ${i === 0 ? 'Ma' : i === 1 ? 'Holnap' : DATA.dayShort[x.dow]}
        <span class="cnt">${x.d.getMonth() + 1}.${x.d.getDate()}.</span>
      </button>`).join('');

    const pickDate = (isoStr) => {
      st.date = isoStr; st.time = null; st.table = null;
      $$('#dayRow .chip').forEach(c => c.classList.toggle('on', c.dataset.d === isoStr));
      $('#dateInput').value = isoStr;
      paintSlots(); paintRecap();
    };
    $('#dayRow').addEventListener('click', e => {
      const b = e.target.closest('[data-d]'); if (!b || b.disabled) return;
      pickDate(b.dataset.d);
    });
    $('#dateInput').min = days[0].iso;
    $('#dateInput').addEventListener('change', e => {
      const v = e.target.value;
      if (!v) return;
      const dow = new Date(v + 'T00:00:00').getDay();
      if (!H[dow]) { toast(`${DATA.dayNames[dow]} zárva tartunk. Válassz másik napot.`, 'err'); return; }
      pickDate(v);
    });

    function paintSlots() {
      if (!st.date) { $('#slotGrid').innerHTML = '<p class="tiny dim">Előbb válassz napot.</p>'; return; }
      const dow = new Date(st.date + 'T00:00:00').getDay();
      const h = H[dow];
      const toMin = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
      const open = toMin(h.open), close = toMin(h.close) - 60; // utolsó foglalás záróra előtt 1 órával
      const now = new Date();
      const isToday = st.date === iso(now);
      const nowMin = now.getHours() * 60 + now.getMinutes();

      $('#slotGrid').innerHTML = DATA.slots.map(t => {
        const m = toMin(t);
        const outside = m < open || m > close;
        const past = isToday && m < nowMin + 45;
        const cap = Store.slotCapacity(st.date, t);
        const enough = cap.free > 0 && DATA.tables.some(tb =>
          tb.seats >= st.people && !Store.busyTables(st.date, t).includes(tb.id));
        const dis = outside || past || !enough;
        return `<button class="slot${st.time === t ? ' on' : ''}" data-t="${t}" ${dis ? 'disabled' : ''}>
          ${t}<span class="left">${dis ? (outside ? 'zárva' : past ? 'elmúlt' : 'betelt') : cap.free + ' asztal'}</span>
        </button>`;
      }).join('');

      const free = DATA.slots.filter(t => !$(`#slotGrid [data-t="${t}"]`)?.disabled).length;
      $('#slotNote').textContent = free
        ? `${free} szabad idősáv ezen a napon. Az utolsó foglalás záróra előtt egy órával.`
        : 'Erre a napra sajnos betelt. Próbálj másik napot, vagy hívj minket.';
    }
    $('#slotGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b || b.disabled) return;
      st.time = b.dataset.t; st.table = null;
      $$('#slotGrid .slot').forEach(s => s.classList.toggle('on', s === b));
      paintRecap();
    });

    /* --- 3. lépés: asztal --- */
    function paintFloor() {
      if (!st.date || !st.time) {
        $('#floorplan').innerHTML = '<p class="tiny dim" style="padding:2rem;text-align:center">Előbb válassz napot és időpontot.</p>';
        return;
      }
      const busy = Store.busyTables(st.date, st.time);
      const tables = DATA.tables.map(t => ({
        ...t, busy: busy.includes(t.id) || t.seats < st.people
      }));
      $('#floorplan').innerHTML = Art.floorplan(tables, st.table);
      $$('#floorplan .table-hit').forEach(g => {
        g.addEventListener('click', () => {
          const id = +g.dataset.table;
          const t = tables.find(x => x.id === id);
          if (t.busy) { toast(t.seats < st.people ? 'Ez az asztal kicsi ennyi főnek.' : 'Ez az asztal már foglalt.', 'warn'); return; }
          st.table = id; paintFloor(); paintRecap();
        });
      });
      const sel = DATA.tables.find(t => t.id === st.table);
      $('#tableInfo').innerHTML = sel
        ? `<span class="pill-stat">✓ ${sel.id}. asztal · ${sel.seats} fő · ${esc(sel.zone)}</span>`
        : `<span class="tiny dim">Nincs kiválasztott asztal — ez rendben van, mi választunk nektek.</span>`;
    }

    /* --- Összegző --- */
    function paintRecap() {
      const t = DATA.tables.find(x => x.id === st.table);
      const rows = [
        ['Létszám', st.people + ' fő'],
        ['Alkalom', st.occasion],
        ['Dátum', st.date ? Store.dateHu(st.date) : '—'],
        ['Időpont', st.time || '—'],
        ['Asztal', t ? `${t.id}. · ${t.zone}` : 'Válasszatok ti']
      ];
      $('#recap').innerHTML = rows.map(([a, b]) =>
        `<div class="recap-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    }

    /* --- Lépésváltás --- */
    function goStep(n) {
      if (n > st.step) {
        if (st.step === 1 && (!st.date || !st.time)) { toast('Válassz napot és időpontot!', 'warn'); return; }
      }
      st.step = Math.max(0, Math.min(3, n));
      $$('.step-panel').forEach(p => p.classList.toggle('on', +p.dataset.step === st.step));
      $$('#steps .step').forEach((s, i) => {
        s.classList.toggle('on', i === st.step);
        s.classList.toggle('done', i < st.step);
      });
      if (st.step === 2) paintFloor();
      $('.booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.addEventListener('click', e => {
      if (e.target.closest('[data-next]')) goStep(st.step + 1);
      if (e.target.closest('[data-prev]')) goStep(st.step - 1);
    });

    /* --- Beküldés --- */
    $('#bookForm').addEventListener('submit', e => {
      e.preventDefault();
      const fields = [
        ['#bName', v => v.trim().length >= 2, 'Add meg a neved (legalább 2 karakter).'],
        ['#bPhone', v => /[\d+][\d\s\-()]{6,}/.test(v), 'Adj meg egy elérhető telefonszámot.'],
        ['#bEmail', v => !v || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v), 'Ez az e-mail cím nem tűnik érvényesnek.']
      ];
      let ok = true;
      fields.forEach(([sel, test, msg]) => {
        const inp = $(sel), box = inp.parentElement.querySelector('.field-msg');
        const good = test(inp.value);
        inp.classList.toggle('err', !good);
        box.textContent = good ? '' : msg;
        if (!good) ok = false;
      });
      if (!$('#bTerms').checked) { toast('Az adatkezelés elfogadása kötelező.', 'err'); ok = false; }
      if (!st.date || !st.time) { toast('Hiányzik a dátum vagy az időpont.', 'err'); goStep(1); return; }
      if (!ok) return;

      /* Ha nem választott asztalt, keresünk neki egyet */
      let table = st.table;
      if (!table) {
        const busy = Store.busyTables(st.date, st.time);
        const fit = DATA.tables
          .filter(t => !busy.includes(t.id) && t.seats >= st.people)
          .sort((a, b) => a.seats - b.seats)[0];
        if (!fit) { toast('Erre az időpontra épp betelt. Válassz másikat!', 'err'); goStep(1); return; }
        table = fit.id;
      }

      const rec = Store.addBooking({
        name: $('#bName').value.trim(),
        phone: $('#bPhone').value.trim(),
        email: $('#bEmail').value.trim(),
        people: st.people, date: st.date, time: st.time, table,
        occasion: st.occasion, note: $('#bNote').value.trim(),
        mine: true
      });

      if ($('#bNews').checked) Store.saveUser({ prefs: { ...Store.user().prefs, newsletter: true } });

      UI.confetti(120);
      const tbl = DATA.tables.find(t => t.id === table);
      modal(`
        <div class="center-text">
          <div style="font-size:2.6rem">🎉</div>
          <h3 class="mt-1">Megvan a foglalásod!</h3>
          <p class="muted tiny">Küldtünk egy visszaigazolást is${$('#bEmail').value ? ' a megadott e-mail címre' : ''}.</p>
          <div class="mt-3"><span class="success-code">${rec.code}</span></div>
        </div>
        <div class="mt-3">
          <div class="recap-row"><span>Név</span><b>${esc(rec.name)}</b></div>
          <div class="recap-row"><span>Mikor</span><b>${Store.dateHu(rec.date)} · ${rec.time}</b></div>
          <div class="recap-row"><span>Létszám</span><b>${rec.people} fő</b></div>
          <div class="recap-row"><span>Asztal</span><b>${tbl.id}. · ${esc(tbl.zone)}</b></div>
          ${rec.note ? `<div class="recap-row"><span>Megjegyzés</span><b style="max-width:60%">${esc(rec.note)}</b></div>` : ''}
        </div>
        <p class="tiny dim mt-3">Az asztalt 15 percig tartjuk. Lemondás a foglalás előtt 2 óráig díjmentes — hívj minket a ${esc(DATA.brand.phone)} számon.</p>
        <a class="btn btn-primary btn-block mt-3" href="profil.html">Megnézem a profilomban</a>`);

      $('#bookForm').reset();
      st.time = null; st.table = null;
      paintSlots(); paintRecap(); paintMine();
      goStep(0);
      toast('Foglalás rögzítve. Várunk szeretettel! 🍕', 'ok', 5000);
    });

    /* --- Saját foglalások --- */
    function paintMine() {
      const mine = Store.bookings().filter(b => b.mine);
      const box = $('#myBookings');
      if (!mine.length) {
        box.innerHTML = `<div class="empty">${Art.icon('calendar', 46)}
          <p>Még nincs foglalásod ebből a böngészőből.</p></div>`;
        return;
      }
      box.innerHTML = `<div class="stack" style="gap:.7rem">${mine.map(b => {
        const t = DATA.tables.find(x => x.id === b.table);
        const past = new Date(b.date + 'T' + b.time) < new Date();
        return `<div class="order-row">
          <div class="order-date">
            <b>${new Date(b.date + 'T00:00:00').getDate()}</b>
            <span>${new Date(b.date + 'T00:00:00').toLocaleDateString('hu-HU', { month: 'short' })}</span>
          </div>
          <div>
            <b>${b.time} · ${b.people} fő · ${t ? t.id + '. asztal' : '—'}</b>
            <p class="tiny dim">${esc(b.occasion || '')}${b.note ? ' · ' + esc(b.note) : ''} · kód: ${b.code}</p>
          </div>
          <div class="row" style="gap:.5rem">
            <span class="state ${b.status === 'cancelled' ? 'state-cancel' : past ? 'state-done' : b.status === 'confirmed' ? 'state-ok' : 'state-new'}">
              ${b.status === 'cancelled' ? 'Lemondva' : past ? 'Lezajlott' : b.status === 'confirmed' ? 'Visszaigazolva' : 'Rögzítve'}
            </span>
            ${(!past && b.status !== 'cancelled') ? `<button class="mini-btn danger" data-cancel="${b.id}">Lemondás</button>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;

      $$('[data-cancel]', box).forEach(b => b.addEventListener('click', () => {
        Store.setBookingStatus(b.dataset.cancel, 'cancelled');
        paintMine(); paintSlots();
        toast('Foglalás lemondva. Reméljük, legközelebb sikerül!', 'warn');
      }));
    }

    /* Indulás: ma vagy a következő nyitott nap */
    const first = days.find(d => !d.closed);
    if (first) pickDate(first.iso);
    paintPeople(); paintRecap(); paintMine();

    mountCta();
    UI.reveal();
  }

  /* ======================================================================
     RÓLUNK
     ====================================================================== */
  function initRolunk() {
    headDeco();

    $('#storyArt1').innerHTML = Art.scene('szakacs');
    $('#storyArt2').innerHTML = Art.scene('belso');
    $('#ovenArt').innerHTML = Art.scene('kemence');

    $('#timeline').innerHTML = DATA.timeline.map((t, i) => `
      <div class="tl-item" data-reveal style="--reveal-delay:${i * 90}ms">
        <span class="tl-year">${esc(t.year)}</span>
        <h4>${esc(t.title)}</h4>
        <p class="muted" style="font-size:.9rem">${esc(t.text)}</p>
      </div>`).join('');

    $('#team').innerHTML = DATA.team.map((p, i) => `
      <article class="card team-card" data-reveal="zoom" style="--reveal-delay:${i * 100}ms">
        <div class="face">${Art.avatar(p.name, 118)}</div>
        <h3 style="font-size:1.12rem">${esc(p.name)}</h3>
        <p class="role">${esc(p.role)}</p>
        <p class="muted tiny mt-2">${esc(p.bio)}</p>
        <p class="quote">„${esc(p.quote)}”</p>
      </article>`).join('');

    mountCta();
    UI.reveal(); UI.tilt();
  }

  /* ======================================================================
     KAPCSOLAT
     ====================================================================== */
  function initKapcsolat() {
    headDeco();
    const B = DATA.brand;

    $('#contactInfo').innerHTML = [
      { i: 'pin',   h: 'Cím',            v: `${B.address}<br><span class="tiny dim">${B.district}</span>` },
      { i: 'phone', h: 'Telefon',        v: `<a href="tel:${B.phoneHref}">${B.phone}</a><br><span class="tiny dim">Nyitvatartási időben</span>` },
      { i: 'mail',  h: 'E-mail',         v: `<a href="mailto:${B.email}">${B.email}</a><br><span class="tiny dim">24 órán belül válaszolunk</span>` },
      { i: 'clock', h: 'Nyitvatartás',   v: `<span id="hoursMini"></span>` }
    ].map(x => `
      <div class="info-item">
        <span class="ico">${Art.icon(x.i)}</span>
        <div><h4>${x.h}</h4><div>${x.v}</div></div>
      </div>`).join('');

    const mini = $('#hoursMini');
    const H = Store.hours(), today = new Date().getDay();
    mini.innerHTML = H[today]
      ? `Ma ${H[today].open} – ${H[today].close}<br><span class="tiny dim">Hétfőn zárva</span>`
      : `Ma zárva<br><span class="tiny dim">${Store.nextOpenNote()}</span>`;

    $('#map').innerHTML = Art.map();

    /* GYIK harmonika */
    $('#faq').innerHTML = DATA.faq.map((f, i) => `
      <div class="faq-item${i === 0 ? ' on' : ''}">
        <button class="faq-q" aria-expanded="${i === 0}">
          <span>${esc(f.q)}</span><i>+</i>
        </button>
        <div class="faq-a"><div><p>${esc(f.a)}</p></div></div>
      </div>`).join('');
    $('#faq').addEventListener('click', e => {
      const q = e.target.closest('.faq-q'); if (!q) return;
      const item = q.parentElement;
      const open = item.classList.contains('on');
      $$('.faq-item', $('#faq')).forEach(x => { x.classList.remove('on'); $('.faq-q', x).setAttribute('aria-expanded', 'false'); });
      if (!open) { item.classList.add('on'); q.setAttribute('aria-expanded', 'true'); }
    });

    /* Űrlap */
    $('#contactForm').addEventListener('submit', e => {
      e.preventDefault();
      const checks = [
        ['#cName', v => v.trim().length >= 2, 'Add meg a neved.'],
        ['#cEmail', v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v), 'Érvényes e-mail címet kérünk.'],
        ['#cMsg', v => v.trim().length >= 10, 'Írj legalább egy mondatot (10 karakter).']
      ];
      let ok = true;
      checks.forEach(([sel, test, msg]) => {
        const inp = $(sel), box = inp.parentElement.querySelector('.field-msg');
        const good = test(inp.value);
        inp.classList.toggle('err', !good);
        if (box) box.textContent = good ? '' : msg;
        if (!good) ok = false;
      });
      if (!$('#cTerms').checked) { toast('Az adatkezelés elfogadása kötelező.', 'err'); ok = false; }
      if (!ok) return;

      Store.addMessage({
        name: $('#cName').value.trim(),
        email: $('#cEmail').value.trim(),
        subject: $('#cTopic').value,
        body: $('#cMsg').value.trim()
      });
      e.target.reset();
      UI.confetti(40);
      toast('Megkaptuk az üzeneted! 24 órán belül válaszolunk.', 'ok', 5000);
    });

    mountCta();
    UI.reveal();
  }

  /* ======================================================================
     PROFIL
     ====================================================================== */
  function initProfil() {
    const paint = () => {
      const u = Store.user();
      const t = Store.tier(u.points);

      /* A profilkép is felülnézeti pizza — a feltétek a névből származnak,
         így mindenkinek másmilyen. Hoverre forogni kezd. */
      const g = Art.rng(u.name);
      const pool = ['mozzarella', 'szalami', 'bazsalikom', 'gomba', 'paprika',
                    'olivabogyo', 'prosciutto', 'rukkola', 'paradicsom', 'kukorica'];
      const picked = [];
      while (picked.length < 3) {
        const t = pool[Math.floor(g() * pool.length)];
        if (!picked.includes(t)) picked.push(t);
      }
      $('#pAvatar').innerHTML = Art.pizza({ seed: u.name, toppings: picked, size: 108,
                                            alt: u.name + ' profilképe' });
      UI.spinOnHover($('#pAvatar'));
      $('#pName').textContent = u.name;
      $('#pSince').textContent = `Vendégünk ${new Date(u.since).getFullYear()} óta`;
      $('#pTier').className = 'tier tier-' + t.id;
      $('#pTier').textContent = t.name + ' tag';
      $('#pVisits').innerHTML = `${Art.icon('check', 14)} ${u.visits} látogatás`;
      $('#pSpent').innerHTML = `${Art.icon('star', 14)} ${Store.huf(u.spent)} összesen`;
      $('#pPoints').textContent = u.points;

      const pct = t.next ? Math.min(100, ((u.points - t.min) / (t.next - t.min)) * 100) : 100;
      setTimeout(() => { $('#pProgress').style.width = pct + '%'; }, 120);
      $('#pNextTier').textContent = t.next
        ? `Még ${t.next - u.points} pont a következő szintig`
        : 'Elérted a legmagasabb szintet. Le a kalappal.';

      /* Pecsétkártya */
      $('#stampcard').innerHTML = Array.from({ length: 8 }, (_, i) => {
        const on = i < u.stamps;
        const free = i === 7;
        return `<div class="stamp ${on ? 'on' : ''} ${free && !on ? 'free' : ''}"
                  title="${free ? 'A 8. után a következő pizza ingyenes' : (i + 1) + '. pecsét'}">
          ${on ? '🍕' : free ? 'AJÁNDÉK' : i + 1}</div>`;
      }).join('');

      /* Rendelések */
      $('#orderList').innerHTML = u.orders.map(o => `
        <div class="order-row">
          <div class="order-date">
            <b>${new Date(o.date).getDate()}</b>
            <span>${new Date(o.date).toLocaleDateString('hu-HU', { month: 'short' })}</span>
          </div>
          <div>
            <b>${esc(o.items.join(' · '))}</b>
            <p class="tiny dim">${esc(o.kind)} · ${Store.dateHu(o.date)}</p>
          </div>
          <div class="center-text">
            <b style="color:var(--gold)">${Store.huf(o.total)}</b>
            <p class="tiny dim">+${Math.round(o.total / 100)} pont</p>
          </div>
        </div>`).join('');

      /* Kedvencek */
      const favs = u.favorites.map(id => Store.menuItem(id)).filter(Boolean);
      $('#favList').innerHTML = favs.length
        ? favs.map(m => UI.dishCard(m)).join('')
        : `<div class="empty" style="grid-column:1/-1">${Art.icon('heart', 46)}
            <p>Még nincs kedvenced.</p>
            <a class="link-arrow" href="etlap.html">Böngéssz az étlapon ${Art.icon('arrow', 14)}</a></div>`;

      /* Foglalások */
      const mine = Store.bookings().filter(b => b.mine);
      $('#bookingList').innerHTML = mine.length
        ? mine.map(b => {
            const tb = DATA.tables.find(x => x.id === b.table);
            const past = new Date(b.date + 'T' + b.time) < new Date();
            return `<div class="order-row">
              <div class="order-date">
                <b>${new Date(b.date + 'T00:00:00').getDate()}</b>
                <span>${new Date(b.date + 'T00:00:00').toLocaleDateString('hu-HU', { month: 'short' })}</span>
              </div>
              <div><b>${b.time} · ${b.people} fő${tb ? ' · ' + tb.zone : ''}</b>
                <p class="tiny dim">Kód: ${b.code}${b.note ? ' · ' + esc(b.note) : ''}</p></div>
              <span class="state ${b.status === 'cancelled' ? 'state-cancel' : past ? 'state-done' : 'state-ok'}">
                ${b.status === 'cancelled' ? 'Lemondva' : past ? 'Lezajlott' : 'Aktív'}</span>
            </div>`;
          }).join('')
        : `<div class="empty">${Art.icon('calendar', 46)}
            <p>Nincs foglalásod.</p>
            <a class="link-arrow" href="foglalas.html">Foglalok egyet ${Art.icon('arrow', 14)}</a></div>`;

      /* Beállítások */
      $('#uName').value = u.name; $('#uEmail').value = u.email; $('#uPhone').value = u.phone;
      $('#uSpice').value = u.prefs.spice; $('#uSpiceVal').textContent = u.prefs.spice;
      $('#uTable').value = u.prefs.table;
      $('#uVeg').checked = u.prefs.veg;
      $('#uGf').checked = u.prefs.glutenFree;
      $('#uNews').checked = u.prefs.newsletter;

      $('#allergyRow').innerHTML = Object.entries(DATA.allergenMap).map(([k, v]) =>
        `<button class="chip${u.allergies.includes(k) ? ' on' : ''}" data-a="${k}">${esc(v)}</button>`).join('');

      /* Ízprofil */
      const counts = {};
      favs.forEach(m => { counts[m.cat] = (counts[m.cat] || 0) + 1; });
      u.orders.forEach(() => { counts.pizza = (counts.pizza || 0) + 1; });
      const colors = { pizza: '#E0503F', pasta: '#E9B44C', special: '#4C9A5C', desszert: '#C4603A', ital: '#7BD08C', elotel: '#9C7BD0', salata: '#5BAE60' };
      const slices = Object.entries(counts).map(([k, v]) => ({
        label: (DATA.categories.find(c => c.id === k) || {}).name || k,
        value: v, color: colors[k] || '#888'
      }));
      $('#tasteChart').innerHTML = `<div class="donut-wrap">
        ${Art.donut(slices)}
        <div class="legend-list">${slices.map(s =>
          `<span><i style="background:${s.color}"></i>${esc(s.label)} — ${s.value}</span>`).join('')}</div>
      </div>`;

      /* Ajánlások */
      const recos = Store.menu()
        .filter(m => m.cat !== 'ital' && !u.favorites.includes(m.id))
        .filter(m => (m.heat || 0) <= u.prefs.spice + 1)
        .filter(m => !u.prefs.veg || (m.tags || []).includes('veg'))
        .filter(m => !u.allergies.some(a => (m.allergens || []).includes(a)))
        .slice(0, 3);
      $('#recos').innerHTML = recos.length ? recos.map(m => `
        <div class="order-row" style="grid-template-columns:56px 1fr auto">
          <div style="width:56px">${Art.pizza({ seed: m.id, toppings: m.toppings, base: m.base, size: 56 })}</div>
          <div><b>${esc(m.name)}</b><p class="tiny dim">${esc((m.ings || '').slice(0, 54))}…</p></div>
          <button class="mini-btn ok" data-add="${m.id}">Kosárba</button>
        </div>`).join('')
        : '<p class="tiny dim">Az allergia-beállításaid mellett most nincs javaslatunk. Kérdezd a személyzetet!</p>';

      /* Év statisztika */
      const spentAvg = Math.round(u.spent / Math.max(1, u.visits));
      $('#yearStats').innerHTML = [
        ['🍕', u.visits, 'látogatás'],
        ['💸', Store.huf(spentAvg), 'átlagos költés'],
        ['⭐', u.points, 'hűségpont'],
        ['🔥', (u.prefs.spice || 0) + '/3', 'csípősség-tűrés']
      ].map(([i, b, s]) => `
        <div class="center-text">
          <div style="font-size:1.6rem">${i}</div>
          <b style="font-family:var(--f-display);font-size:1.5rem;color:var(--gold);display:block">${b}</b>
          <span class="tiny dim">${s}</span>
        </div>`).join('');

      UI.tilt();
    };

    /* Fülek */
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      $$('.tab').forEach(x => x.classList.toggle('on', x === t));
      $$('.tab-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === t.dataset.tab));
    }));

    /* Interakciók */
    $('#pRedeem').addEventListener('click', () => {
      const u = Store.user();
      if (u.points < 200) { toast('200 ponttól válthatsz be. Még gyűjts egy kicsit!', 'warn'); return; }
      Store.saveUser({ points: u.points - 200 });
      UI.confetti(70);
      toast('Beváltva! 200 pont = egy ingyen desszert. Mutasd ezt a pultnál. 🍰', 'ok', 5000);
      paint();
    });
    $('#pStampDemo').addEventListener('click', () => {
      const u = Store.user();
      if (u.stamps >= 8) {
        Store.saveUser({ stamps: 0, points: u.points + 50 });
        UI.confetti(110);
        toast('Teli a kártya! A következő pizza a miénk. 🍕 +50 pont', 'ok', 6000);
      } else {
        Store.saveUser({ stamps: u.stamps + 1, points: u.points + 25 });
        toast(`${u.stamps + 1}. pecsét megvan · +25 pont`, 'ok');
      }
      paint();
    });
    $('#uSave').addEventListener('click', () => {
      Store.saveUser({ name: $('#uName').value, email: $('#uEmail').value, phone: $('#uPhone').value });
      toast('Adatok mentve.', 'ok'); paint();
    });
    $('#uSpice').addEventListener('input', e => {
      $('#uSpiceVal').textContent = e.target.value;
      Store.saveUser({ prefs: { ...Store.user().prefs, spice: +e.target.value } });
    });
    $('#uSpice').addEventListener('change', paint);
    ['uVeg', 'uGf', 'uNews', 'uTable'].forEach(id => {
      $('#' + id).addEventListener('change', (e) => {
        const p = { ...Store.user().prefs };
        if (id === 'uVeg') p.veg = e.target.checked;
        if (id === 'uGf') p.glutenFree = e.target.checked;
        if (id === 'uNews') p.newsletter = e.target.checked;
        if (id === 'uTable') p.table = e.target.value;
        Store.saveUser({ prefs: p });
        paint();
      });
    });
    $('#allergyRow').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const u = Store.user(), a = b.dataset.a;
      const list = u.allergies.includes(a) ? u.allergies.filter(x => x !== a) : [...u.allergies, a];
      Store.saveUser({ allergies: list });
      paint();
    });
    $('#uReset').addEventListener('click', () => {
      if (!confirm('Biztosan visszaállítod a profilt az alapértelmezettre?')) return;
      Store.resetUser(); paint(); toast('Profil visszaállítva.', 'warn');
    });

    UI.bindDishes($('#favList'));
    document.addEventListener('click', e => {
      const b = e.target.closest('#recos [data-add]');
      if (b) { Store.cartAdd(b.dataset.add); toast('Kosárba tettük.', 'ok'); }
    });

    paint();
    mountCta();
    UI.reveal();
  }

  /* ======================================================================
     INDÍTÁS
     ====================================================================== */
  const ROUTES = {
    home: initHome, etlap: initEtlap, galeria: initGaleria,
    foglalas: initFoglalas, rolunk: initRolunk,
    kapcsolat: initKapcsolat, profil: initProfil
  };

  document.addEventListener('DOMContentLoaded', () => {
    UI.boot();
    const fn = ROUTES[document.body.dataset.page];
    if (fn) fn();
  });
})();
