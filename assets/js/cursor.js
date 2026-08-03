/* ==========================================================================
   Zamárdi Szépségszalon — egyedi kurzor
   Két rétegű: egy pontosan követő pötty és egy lassabban utánaúszó gyűrű.
   Érintőképernyőn és csökkentett mozgás mellett magától kikapcsol.
   ========================================================================== */

(function () {
  const erintos = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  const csendes = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (erintos || csendes) return;

  /* ---------- Elemek ---------- */
  const gyuru = document.createElement('div');
  gyuru.className = 'cur cur--ring';
  gyuru.innerHTML = '<span class="cur__label"></span>';

  const potty = document.createElement('div');
  potty.className = 'cur cur--dot';

  document.body.append(gyuru, potty);

  /* ---------- Pozíciók ---------- */
  let egerX = window.innerWidth / 2;
  let egerY = window.innerHeight / 2;
  let gyuruX = egerX;
  let gyuruY = egerY;
  let lathato = false;

  /* Mágneses vonzás: a gomb közepe felé húzza a gyűrűt */
  let magnes = null;

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    egerX = e.clientX;
    egerY = e.clientY;
    if (!lathato) {
      lathato = true;
      document.body.classList.add('cur-on');
    }
  }, { passive: true });

  document.addEventListener('pointerdown', () => gyuru.classList.add('is-press'));
  document.addEventListener('pointerup', () => gyuru.classList.remove('is-press'));

  /* Ha kimegy az ablakból, tűnjön el */
  document.addEventListener('mouseleave', () => {
    lathato = false;
    document.body.classList.remove('cur-on');
  });
  document.addEventListener('mouseenter', () => {
    lathato = true;
    document.body.classList.add('cur-on');
  });

  /* ---------- Animációs hurok ---------- */
  function fut() {
    let celX = egerX;
    let celY = egerY;

    /* Mágnes: a gyűrű beleül a gomb közepébe */
    if (magnes) {
      const r = magnes.getBoundingClientRect();
      celX = r.left + r.width / 2;
      celY = r.top + r.height / 2;
    }

    gyuruX += (celX - gyuruX) * 0.16;
    gyuruY += (celY - gyuruY) * 0.16;

    gyuru.style.transform = `translate3d(${gyuruX}px, ${gyuruY}px, 0) translate(-50%, -50%)`;
    potty.style.transform = `translate3d(${egerX}px, ${egerY}px, 0) translate(-50%, -50%)`;

    requestAnimationFrame(fut);
  }
  requestAnimationFrame(fut);

  /* ---------- Állapotok elemtípus szerint ---------- */
  const SZABALYOK = [
    { valaszto: '.gallery__item',                       osztaly: 'is-view',  cimke: 'Nagyítás' },
    { valaszto: '.ba',                                  osztaly: 'is-drag',  cimke: 'Húzza' },
    { valaszto: '.marquee',                             osztaly: 'is-wide',  cimke: '' },
    { valaszto: '.btn, .fab, .chip, .slot, .day, .opt, .step-pill, .quote-dots button, .social a, .burger, .lightbox__close, .lightbox__nav',
      osztaly: 'is-btn', cimke: '', magneses: true },
    { valaszto: 'a, button, .faq-q, [role="button"]',   osztaly: 'is-link',  cimke: '' },
    { valaszto: 'input, textarea, select',              osztaly: 'is-text',  cimke: '' }
  ];

  const cimkeElem = gyuru.querySelector('.cur__label');

  function allapotTorles() {
    gyuru.className = 'cur cur--ring';
    cimkeElem.textContent = '';
    magnes = null;
  }

  document.addEventListener('pointerover', (e) => {
    if (!(e.target instanceof Element)) return;

    for (const sz of SZABALYOK) {
      const talalat = e.target.closest(sz.valaszto);
      if (!talalat) continue;
      gyuru.className = 'cur cur--ring ' + sz.osztaly;
      cimkeElem.textContent = sz.cimke;
      magnes = sz.magneses ? talalat : null;
      return;
    }
    allapotTorles();
  });

  /* Görgetéskor a mágnes elenged, különben „ragadna” a gomb */
  window.addEventListener('scroll', () => { magnes = null; }, { passive: true });
})();
