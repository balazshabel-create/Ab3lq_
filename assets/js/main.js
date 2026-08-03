/* ==========================================================================
   Zamárdi Szépségszalon — közös scriptek
   Tartalom: betöltő, navigáció, scroll-animációk, élő nyitva/zárva jelző,
             galéria + lightbox, vélemény-forgó, GYIK, előtte/utána csúszka
   ========================================================================== */

/* ---------- Szalon alapadatok — EGY helyen szerkeszthető ---------- */
const SALON = {
  nev: 'Zamárdi Szépségszalon',
  cim: '8621 Zamárdi, Szabadság tér 5.',
  tel: '+36 20 367 8150',
  telHref: '+36203678150',
  email: 'info@zamardiszepsegszalon.hu',
  ertekeles: 4.9,
  velemenyDb: 50,
  /* Nyitvatartás: 0 = vasárnap … 6 = szombat. null = zárva.
     Percben számolva a nap kezdetétől. */
  nyitva: {
    0: null,
    1: { tol: 8 * 60, ig: 15 * 60 },
    2: { tol: 8 * 60, ig: 15 * 60 },
    3: { tol: 8 * 60, ig: 15 * 60 },
    4: { tol: 8 * 60, ig: 15 * 60 },
    5: { tol: 8 * 60, ig: 15 * 60 },
    6: { tol: 8 * 60, ig: 12 * 60 }
  },
  napNev: ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'],
  napRovid: ['Vas', 'Hét', 'Ked', 'Sze', 'Csü', 'Pén', 'Szo']
};

/* Az admin felületen mentett módosítások felülírják a fenti alapértékeket.
   Így a szalon a nyitvatartást és az elérhetőséget kód nélkül állíthatja. */
(function adminBeallitasok() {
  try {
    const ment = JSON.parse(localStorage.getItem('zsz_beallitasok') || 'null');
    if (ment && typeof ment === 'object') Object.assign(SALON, ment);
  } catch { /* privát mód vagy sérült adat — maradnak az alapértékek */ }
})();

/* Percből "8:00" alak */
function perc2ora(p) {
  const h = Math.floor(p / 60);
  const m = p % 60;
  return h + ':' + String(m).padStart(2, '0');
}

/* A szalon helyi ideje (Europe/Budapest) — akkor is jó, ha a látogató
   más időzónában van. */
function szalonIdo() {
  const most = new Date();
  const reszek = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(most);

  const get = (t) => reszek.find((r) => r.type === t)?.value ?? '0';
  const napok = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    nap: napok[get('weekday')] ?? most.getDay(),
    perc: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10)
  };
}

/* Aktuális állapot kiszámolása */
function nyitvaAllapot() {
  const { nap, perc } = szalonIdo();
  const ma = SALON.nyitva[nap];

  if (ma && perc >= ma.tol && perc < ma.ig) {
    const hatra = ma.ig - perc;
    if (hatra <= 60) {
      return {
        allapot: 'soon',
        cim: 'Hamarosan zárunk',
        alcim: `Még ${hatra} perc — ${perc2ora(ma.ig)}-kor zárunk`
      };
    }
    return {
      allapot: 'open',
      cim: 'Most nyitva',
      alcim: `Ma ${perc2ora(ma.tol)}–${perc2ora(ma.ig)} között`
    };
  }

  /* Ma még nyitunk? */
  if (ma && perc < ma.tol) {
    const hatra = ma.tol - perc;
    if (hatra <= 60) {
      return { allapot: 'soon', cim: 'Hamarosan nyitunk', alcim: `${hatra} perc múlva — ${perc2ora(ma.tol)}` };
    }
    return { allapot: 'closed', cim: 'Most zárva', alcim: `Ma ${perc2ora(ma.tol)}-kor nyitunk` };
  }

  /* Következő nyitvatartási nap keresése */
  for (let i = 1; i <= 7; i++) {
    const d = (nap + i) % 7;
    const inf = SALON.nyitva[d];
    if (inf) {
      const nevSzo = i === 1 ? 'Holnap' : SALON.napNev[d];
      return { allapot: 'closed', cim: 'Most zárva', alcim: `${nevSzo} ${perc2ora(inf.tol)}-kor nyitunk` };
    }
  }
  return { allapot: 'closed', cim: 'Most zárva', alcim: 'Hívjon minket!' };
}

/* Minden .status elem frissítése */
function statuszFrissit() {
  const a = nyitvaAllapot();
  document.querySelectorAll('.status').forEach((el) => {
    el.classList.remove('is-open', 'is-closed', 'is-soon');
    el.classList.add('is-' + a.allapot);
    const txt = el.querySelector('.status__txt');
    if (txt) txt.innerHTML = `<b>${a.cim}</b><small>${a.alcim}</small>`;
    el.setAttribute('title', `${a.cim} — ${a.alcim}`);
  });
}

/* Nyitvatartás-táblázat kirajzolása + a mai nap kiemelése */
function orakKirajzol() {
  const doboz = document.querySelector('[data-hours]');
  if (!doboz) return;
  const { nap } = szalonIdo();
  const sorrend = [1, 2, 3, 4, 5, 6, 0];

  doboz.innerHTML = sorrend.map((d) => {
    const inf = SALON.nyitva[d];
    const ma = d === nap ? ' today' : '';
    const ertek = inf
      ? `${perc2ora(inf.tol)} – ${perc2ora(inf.ig)}`
      : '<span class="off">Zárva</span>';
    return `<div class="hours__row${ma}">
        <span class="hours__day">${SALON.napNev[d]}</span>
        <span class="hours__val">${ertek}</span>
      </div>`;
  }).join('');
}

/* ---------- Legközelebbi szabad időpont ----------
   A nyitvatartásból és a már rögzített foglalásokból számol, egy átlagos
   60 perces szolgáltatással. A [data-next-slot] elembe írja az eredményt. */
function kovetkezoSzabad(hossz = 60) {
  let mar = [];
  try { mar = JSON.parse(localStorage.getItem('zsz_foglalasok') || '[]'); } catch { /* üres */ }

  const most = new Date();
  const mostPerc = most.getHours() * 60 + most.getMinutes();

  for (let i = 0; i < 21; i++) {
    const d = new Date(most.getFullYear(), most.getMonth(), most.getDate() + i);
    const nyitva = SALON.nyitva[d.getDay()];
    if (!nyitva) continue;

    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const napiak = mar.filter((f) => f.nap === iso && f.allapot !== 'nem');

    for (let t = nyitva.tol; t + hossz <= nyitva.ig; t += 30) {
      if (i === 0 && t < mostPerc + 60) continue;                     // ma: 1 óra felkészülés
      if (napiak.some((f) => t < f.vege && t + hossz > f.kezd)) continue;
      return { nap: d, ido: t, napokMulva: i };
    }
  }
  return null;
}

function kovetkezoKiir() {
  const doboz = document.querySelector('[data-next-slot]');
  if (!doboz) return;

  const sz = kovetkezoSzabad();
  if (!sz) { doboz.hidden = true; return; }

  const mikor = sz.napokMulva === 0 ? 'ma'
    : sz.napokMulva === 1 ? 'holnap'
    : sz.nap.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

  doboz.hidden = false;
  doboz.querySelector('[data-next-slot-txt]').innerHTML =
    `Legközelebbi szabad időpont: <b>${mikor} ${perc2ora(sz.ido)}</b>`;
}

/* ---------- Betöltő ---------- */
window.addEventListener('load', () => {
  const l = document.getElementById('loader');
  if (l) setTimeout(() => l.classList.add('done'), 420);
  document.querySelectorAll('.split').forEach((el) => el.classList.add('in'));
});

/* ---------- Címsorok szavakra bontása ---------- */
function szavakraBont() {
  document.querySelectorAll('.split').forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const html = el.innerHTML;
    /* A <span class="fine"> jellegű belső elemeket megtartjuk */
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const bont = (node) => {
      [...node.childNodes].forEach((gy) => {
        if (gy.nodeType === 3) {
          const frag = document.createDocumentFragment();
          gy.textContent.split(/(\s+)/).forEach((sz) => {
            if (!sz.trim()) { frag.appendChild(document.createTextNode(sz)); return; }
            const w = document.createElement('span');
            w.className = 'word';
            const inner = document.createElement('span');
            inner.textContent = sz;
            w.appendChild(inner);
            frag.appendChild(w);
          });
          node.replaceChild(frag, gy);
        } else if (gy.nodeType === 1) {
          bont(gy);
        }
      });
    };
    bont(tmp);
    el.innerHTML = tmp.innerHTML;

    /* Lépcsőzetes késleltetés */
    el.querySelectorAll('.word > span').forEach((s, i) => {
      s.style.transitionDelay = (i * 0.045) + 's';
    });
  });
}

/* ---------- Scroll-reveal ---------- */
function revealInit() {
  const elemek = document.querySelectorAll('.rv, .split');
  if (!('IntersectionObserver' in window)) {
    elemek.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((bejegyzesek) => {
    bejegyzesek.forEach((b) => {
      if (!b.isIntersecting) return;
      const kesleltet = parseFloat(b.target.dataset.delay || 0);
      setTimeout(() => b.target.classList.add('in'), kesleltet * 1000);
      io.unobserve(b.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  elemek.forEach((e) => io.observe(e));
}

/* ---------- Navigáció ---------- */
function navInit() {
  const nav = document.querySelector('.nav');
  const burger = document.querySelector('.burger');
  const drawer = document.querySelector('.drawer');
  const progress = document.querySelector('.progress');
  const fab = document.querySelector('.fab');

  const onScroll = () => {
    const y = window.scrollY;
    if (nav) nav.classList.toggle('stuck', y > 40);
    if (fab) fab.classList.toggle('show', y > 520);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (burger && drawer) {
    const valt = (nyit) => {
      burger.classList.toggle('on', nyit);
      drawer.classList.toggle('open', nyit);
      document.body.classList.toggle('no-scroll', nyit);
      burger.setAttribute('aria-expanded', String(nyit));
    };
    burger.addEventListener('click', () => valt(!drawer.classList.contains('open')));
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => valt(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') valt(false); });
  }
}

/* ---------- Kártyák fény-követése ---------- */
function fenyKovetes() {
  document.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      c.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
    });
  });
}

/* ---------- Számláló animáció ---------- */
function szamlalok() {
  const elemek = document.querySelectorAll('[data-count]');
  if (!elemek.length || !('IntersectionObserver' in window)) {
    elemek.forEach((e) => {
      e.textContent = e.dataset.count.replace('.', ',') + (e.dataset.suffix || '');
    });
    return;
  }
  const io = new IntersectionObserver((bs) => {
    bs.forEach((b) => {
      if (!b.isIntersecting) return;
      const el = b.target;
      const cel = parseFloat(el.dataset.count);
      const tizedes = (el.dataset.count.split('.')[1] || '').length;
      const utotag = el.dataset.suffix || '';
      const ido = 1400;
      const start = performance.now();

      const lep = (t) => {
        const p = Math.min((t - start) / ido, 1);
        const konnyit = 1 - Math.pow(1 - p, 3);
        /* Magyar írásmód: tizedesvessző */
        el.textContent = (cel * konnyit).toFixed(tizedes).replace('.', ',') + utotag;
        if (p < 1) requestAnimationFrame(lep);
      };
      requestAnimationFrame(lep);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });
  elemek.forEach((e) => io.observe(e));
}

/* ---------- Parallax ---------- */
function parallax() {
  const elemek = [...document.querySelectorAll('[data-par]')];
  if (!elemek.length) return;
  let tick = false;
  const fut = () => {
    const y = window.scrollY;
    elemek.forEach((el) => {
      const sebesseg = parseFloat(el.dataset.par);
      el.style.transform = `translate3d(0, ${y * sebesseg}px, 0)`;
    });
    tick = false;
  };
  window.addEventListener('scroll', () => {
    if (!tick) { requestAnimationFrame(fut); tick = true; }
  }, { passive: true });
}

/* ---------- Vélemények forgó ---------- */
function velemenyek() {
  const doboz = document.querySelector('.quotes');
  if (!doboz) return;
  const elemek = [...doboz.querySelectorAll('.quote')];
  const pontok = document.querySelector('.quote-dots');
  let i = 0;
  let ora;

  if (pontok) {
    pontok.innerHTML = elemek.map((_, k) =>
      `<button aria-label="${k + 1}. vélemény"${k === 0 ? ' class="on"' : ''}></button>`
    ).join('');
  }

  const mutat = (k) => {
    i = (k + elemek.length) % elemek.length;
    elemek.forEach((e, n) => e.classList.toggle('on', n === i));
    pontok?.querySelectorAll('button').forEach((b, n) => b.classList.toggle('on', n === i));
  };
  const indit = () => { ora = setInterval(() => mutat(i + 1), 5200); };
  const megall = () => clearInterval(ora);

  pontok?.querySelectorAll('button').forEach((b, k) =>
    b.addEventListener('click', () => { megall(); mutat(k); indit(); })
  );
  doboz.addEventListener('mouseenter', megall);
  doboz.addEventListener('mouseleave', indit);

  mutat(0);
  indit();
}

/* ---------- GYIK ---------- */
function gyik() {
  const elemek = document.querySelectorAll('.faq-item');
  if (!elemek.length) return;

  elemek.forEach((item) => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.setAttribute('aria-expanded', 'false');
    q.addEventListener('click', () => {
      const nyitva = item.classList.toggle('open');
      q.setAttribute('aria-expanded', String(nyitva));
      a.style.maxHeight = nyitva ? a.scrollHeight + 'px' : '0px';
    });
  });

  /* Átméretezéskor a nyitott válasz magassága elavulna (px-ben van beállítva),
     és keskenyebb ablakban levágná a szöveget — ezért újraszámoljuk. */
  let ido;
  window.addEventListener('resize', () => {
    clearTimeout(ido);
    ido = setTimeout(() => {
      document.querySelectorAll('.faq-item.open .faq-a').forEach((a) => {
        a.style.maxHeight = a.scrollHeight + 'px';
      });
    }, 150);
  });
}

/* ---------- Galéria szűrő + lightbox ---------- */
function galeria() {
  const rács = document.querySelector('.gallery');
  if (!rács) return;

  const elemek = [...rács.querySelectorAll('.gallery__item')];

  /* Szűrés */
  document.querySelectorAll('[data-filter]').forEach((gomb) => {
    gomb.addEventListener('click', () => {
      const cel = gomb.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((g) => g.classList.toggle('on', g === gomb));
      elemek.forEach((el, i) => {
        const jo = cel === 'mind' || el.dataset.cat === cel;
        el.classList.toggle('hide', !jo);
        if (jo) {
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = `panelIn 0.5s var(--ease) ${i * 0.035}s backwards`;
        }
      });
    });
  });

  /* Lightbox */
  const lb = document.querySelector('.lightbox');
  if (!lb) return;
  const szinpad = lb.querySelector('.lightbox__stage');
  const felirat = lb.querySelector('.lightbox__cap');
  let aktiv = 0;

  const lathatoak = () => elemek.filter((e) => !e.classList.contains('hide'));

  /* Ahonnan a nagyítót nyitották — bezáráskor ide tér vissza a fókusz */
  let honnan = null;

  const nyit = (el) => {
    const lista = lathatoak();
    aktiv = lista.indexOf(el);
    rajzol();
    lb.classList.add('open');
    document.body.classList.add('no-scroll');
    honnan = document.activeElement;
    /* A rejtettből előbukkanó elem csak az első kirajzolás után fókuszálható,
       ezért egy rövid késleltetéssel adjuk rá a fókuszt. */
    setTimeout(() => lb.querySelector('.lightbox__close')?.focus(), 60);
  };
  const rajzol = () => {
    const lista = lathatoak();
    const el = lista[aktiv];
    if (!el) return;
    const media = el.querySelector('img, .ph');
    szinpad.innerHTML = '';
    szinpad.appendChild(media.cloneNode(true));
    const c = el.querySelector('.gallery__cap');
    felirat.textContent = c ? c.textContent.trim() : '';
  };
  const lep = (d) => {
    const lista = lathatoak();
    aktiv = (aktiv + d + lista.length) % lista.length;
    rajzol();
  };
  const zar = () => {
    lb.classList.remove('open');
    document.body.classList.remove('no-scroll');
    honnan?.focus?.();
    honnan = null;
  };

  /* Billentyűzettel is megnyitható legyen minden kép */
  elemek.forEach((el) => {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    const cimke = el.querySelector('.gallery__cap b');
    el.setAttribute('aria-label', (cimke ? cimke.textContent.trim() + ' — ' : '') + 'kép nagyítása');
    el.addEventListener('click', () => nyit(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nyit(el); }
    });
  });
  lb.querySelector('.lightbox__close')?.addEventListener('click', zar);
  lb.querySelector('.lightbox__nav--prev')?.addEventListener('click', (e) => { e.stopPropagation(); lep(-1); });
  lb.querySelector('.lightbox__nav--next')?.addEventListener('click', (e) => { e.stopPropagation(); lep(1); });
  lb.addEventListener('click', (e) => { if (e.target === lb) zar(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') zar();
    if (e.key === 'ArrowLeft') lep(-1);
    if (e.key === 'ArrowRight') lep(1);
  });
}

/* ---------- Előtte / utána csúszka ---------- */
function elotteUtana() {
  document.querySelectorAll('.ba').forEach((doboz) => {
    let huz = false;
    const allit = (x) => {
      const r = doboz.getBoundingClientRect();
      const p = Math.min(Math.max(((x - r.left) / r.width) * 100, 0), 100);
      doboz.style.setProperty('--pos', p + '%');
    };
    doboz.addEventListener('pointerdown', (e) => { huz = true; doboz.setPointerCapture(e.pointerId); allit(e.clientX); });
    doboz.addEventListener('pointermove', (e) => { if (huz) allit(e.clientX); });
    doboz.addEventListener('pointerup', () => { huz = false; });
    doboz.addEventListener('pointercancel', () => { huz = false; });
  });
}

/* ---------- Adatok behelyettesítése ([data-salon="tel"] stb.) ---------- */
function adatokBeir() {
  document.querySelectorAll('[data-salon]').forEach((el) => {
    const k = el.dataset.salon;
    if (SALON[k] === undefined) return;
    el.textContent = SALON[k];

    /* A hivatkozás célja is kövesse az adatot — különben az adminban
       átírt telefonszám mellett a régi tel: link maradna. */
    if (el.tagName === 'A') {
      if (k === 'tel') el.href = 'tel:' + String(SALON.tel).replace(/[^+\d]/g, '');
      if (k === 'email') el.href = 'mailto:' + SALON.email;
    }
  });

  /* A nem feliratozott tel:/mailto: gombok (pl. „Inkább telefonálok”) is */
  document.querySelectorAll('a[href^="tel:"]:not([data-salon])').forEach((a) => {
    a.href = 'tel:' + String(SALON.tel).replace(/[^+\d]/g, '');
  });
}

/* ---------- Indítás ---------- */
document.addEventListener('DOMContentLoaded', () => {
  szavakraBont();
  revealInit();
  navInit();
  fenyKovetes();
  szamlalok();
  parallax();
  velemenyek();
  gyik();
  galeria();
  elotteUtana();
  adatokBeir();
  statuszFrissit();
  orakKirajzol();
  kovetkezoKiir();
  setInterval(() => { statuszFrissit(); kovetkezoKiir(); }, 30000);
});
