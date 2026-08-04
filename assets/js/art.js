/* ==========================================================================
   BASILICO BISTRO — art.js
   Procedurális SVG grafikamotor.

   Miért így? Az oldal nulla külső képfüggőséggel működik: minden illusztráció
   vektorosan, futásidőben áll elő. Így azonnal betölt, offline is működik,
   nincs licencgond, és a színek automatikusan követik a témát.

   Valódi fotókra váltás: lásd `Art.photo()` — ha egy elemhez megadsz képURL-t
   (data.js → `photo` mező), a rendszer azt használja az illusztráció helyett.
   ========================================================================== */

const Art = (() => {

  /* ---------- Segédfüggvények ------------------------------------------- */

  /** Determinisztikus álvéletlen generátor (mulberry32) – ugyanaz a mag mindig
   *  ugyanazt a pizzát rajzolja, így a képek nem "ugrálnak" újratöltéskor. */
  function rng(seed) {
    let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const R = (n = 3) => (v) => Math.round(v * 10 ** n) / 10 ** n;
  const r2 = R(2);
  const pol = (cx, cy, r, a) => [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
  const uid = (() => { let i = 0; return (p) => `${p}${(++i).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`; })();

  /* ---------- Feltétek receptkönyve -------------------------------------- */
  /* Minden feltét tudja, milyen színű és hogyan rajzolódik. A kulcsok
     megegyeznek a data.js-ben használt azonosítókkal. */

  const TOPPINGS = {
    szalami:    { color: '#C4362B', size: 9,   n: 9,  draw: pepperoni },
    csili:      { color: '#E33B22', size: 6,   n: 7,  draw: chiliRing },
    sonka:      { color: '#E8918C', size: 9,   n: 8,  draw: blob },
    bacon:      { color: '#C96A57', size: 10,  n: 7,  draw: strip },
    kolbasz:    { color: '#9E3B2A', size: 7,   n: 10, draw: dot },
    csirke:     { color: '#D9B27A', size: 8,   n: 8,  draw: blob },
    prosciutto: { color: '#E890A0', size: 13,  n: 5,  draw: ribbon },
    gomba:      { color: '#D8C4A6', size: 8,   n: 8,  draw: mushroom },
    olivabogyo: { color: '#2E2A33', size: 6.5, n: 9,  draw: ring },
    paprika:    { color: '#3FA24C', size: 8,   n: 8,  draw: pepperRing },
    hagyma:     { color: '#D9CFE4', size: 10,  n: 7,  draw: arcTop },
    paradicsom: { color: '#DE4A3B', size: 9,   n: 6,  draw: tomatoSlice },
    kukorica:   { color: '#F2C438', size: 4,   n: 16, draw: dot },
    ananasz:    { color: '#F0CE55', size: 8,   n: 7,  draw: wedge },
    bazsalikom: { color: '#4FA45E', size: 11,  n: 7,  draw: leaf },
    rukkola:    { color: '#5BAE60', size: 13,  n: 8,  draw: leaf },
    mozzarella: { color: '#FBF6E9', size: 11,  n: 6,  draw: softBlob },
    gorgonzola: { color: '#EDE7D6', size: 10,  n: 6,  draw: bluecheese },
    parmezan:   { color: '#F3E4BE', size: 5,   n: 14, draw: shaving },
    feta:       { color: '#FFFBF0', size: 7,   n: 9,  draw: cube },
    kecskesajt: { color: '#FCF3E0', size: 9,   n: 6,  draw: softBlob },
    tojas:      { color: '#FFFDF2', size: 12,  n: 2,  draw: egg },
    tonhal:     { color: '#D8A98F', size: 7,   n: 9,  draw: flake },
    garnela:    { color: '#F08A6E', size: 9,   n: 7,  draw: shrimp },
    articsoka:  { color: '#6E9464', size: 9,   n: 6,  draw: wedge },
    kapribogyo: { color: '#5E7A46', size: 4.5, n: 11, draw: dot },
    burgonya:   { color: '#E6CE9C', size: 8,   n: 8,  draw: cube },
    pisztacia:  { color: '#8FB94F', size: 4,   n: 15, draw: dot },
    trufla:     { color: '#3B3229', size: 4.5, n: 12, draw: shaving },
    fokhagyma:  { color: '#F4EEDD', size: 5,   n: 12, draw: wedge },
    ruccola:    { color: '#5BAE60', size: 13,  n: 8,  draw: leaf }
  };

  /* --- Egyes feltét-rajzolók (cx, cy, s = méret, c = szín, a = szög) ----- */

  function dot(x, y, s, c) {
    return `<circle cx="${x}" cy="${y}" r="${s}" fill="${c}"/>
            <circle cx="${r2(x - s * .3)}" cy="${r2(y - s * .3)}" r="${r2(s * .35)}" fill="#fff" opacity=".22"/>`;
  }
  function pepperoni(x, y, s, c, a) {
    const spots = [[-.3, -.2, .17], [.3, .1, .14], [0, .35, .12], [.25, -.35, .1]]
      .map(([dx, dy, dr]) => `<circle cx="${r2(x + dx * s)}" cy="${r2(y + dy * s)}" r="${r2(dr * s)}" fill="#8E241B" opacity=".55"/>`).join('');
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <circle cx="${x}" cy="${y}" r="${s}" fill="${c}"/>
      <circle cx="${x}" cy="${y}" r="${s}" fill="none" stroke="#8E241B" stroke-width="${r2(s * .16)}" opacity=".7"/>
      ${spots}
      <ellipse cx="${r2(x - s * .28)}" cy="${r2(y - s * .34)}" rx="${r2(s * .42)}" ry="${r2(s * .24)}" fill="#fff" opacity=".18"/>
    </g>`;
  }
  function ring(x, y, s, c) {
    return `<circle cx="${x}" cy="${y}" r="${s}" fill="${c}"/>
            <circle cx="${x}" cy="${y}" r="${r2(s * .42)}" fill="#8C7B5E"/>
            <path d="M${r2(x - s * .8)} ${r2(y - s * .4)}a${s} ${s} 0 0 1 ${r2(s * .7)} ${r2(-s * .4)}" stroke="#fff" stroke-width="1" fill="none" opacity=".25"/>`;
  }
  function pepperRing(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <path d="M${r2(x - s)} ${y}a${s} ${r2(s * .55)} 0 1 0 ${r2(s * 2)} 0a${s} ${r2(s * .55)} 0 1 0 ${r2(-s * 2)} 0Z"
            fill="none" stroke="${c}" stroke-width="${r2(s * .38)}" stroke-linecap="round"/>
      <path d="M${r2(x - s * .8)} ${r2(y - s * .18)}a${r2(s * .8)} ${r2(s * .4)} 0 0 1 ${r2(s * .9)} ${r2(-s * .1)}"
            stroke="#9BE3A6" stroke-width="1" fill="none" opacity=".5"/>
    </g>`;
  }
  function chiliRing(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <circle cx="${x}" cy="${y}" r="${s}" fill="none" stroke="${c}" stroke-width="${r2(s * .45)}"/>
      <circle cx="${x}" cy="${y}" r="${r2(s * .3)}" fill="#F7E7A0" opacity=".8"/>
    </g>`;
  }
  function mushroom(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3 * .3)} ${x} ${y})">
      <path d="M${r2(x - s)} ${y}q0 ${r2(-s * 1.05)} ${s} ${r2(-s * 1.05)}q${s} 0 ${s} ${r2(s * 1.05)}Z" fill="${c}"/>
      <rect x="${r2(x - s * .3)}" y="${r2(y - s * .1)}" width="${r2(s * .6)}" height="${r2(s * .85)}" rx="${r2(s * .2)}" fill="#EFE3CC"/>
      <path d="M${r2(x - s * .62)} ${r2(y - s * .3)}q${r2(s * .6)} ${r2(-s * .34)} ${r2(s * 1.24)} 0" stroke="#B79E77" stroke-width="1" fill="none" opacity=".8"/>
    </g>`;
  }
  function leaf(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <path d="M${x} ${r2(y - s * .55)}q${r2(s * .78)} ${r2(s * .3)} 0 ${r2(s * 1.1)}q${r2(-s * .78)} ${r2(-s * .8)} 0 ${r2(-s * 1.1)}Z" fill="${c}"/>
      <path d="M${x} ${r2(y - s * .5)}L${x} ${r2(y + s * .5)}" stroke="#2E6C39" stroke-width=".9" opacity=".65"/>
      <path d="M${x} ${r2(y - s * .55)}q${r2(s * .5)} ${r2(s * .34)} ${r2(s * .1)} ${r2(s * .9)}" fill="#fff" opacity=".13"/>
    </g>`;
  }
  function blob(x, y, s, c, a) {
    const g = rng(x * 31 + y * 17);
    const p = [];
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + a;
      const rr = s * (.72 + g() * .5);
      p.push(pol(x, y, rr, ang));
    }
    return `<path d="M${p[0]}${p.slice(1).map(q => `L${q}`).join('')}Z" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
            <ellipse cx="${r2(x - s * .2)}" cy="${r2(y - s * .25)}" rx="${r2(s * .35)}" ry="${r2(s * .2)}" fill="#fff" opacity=".2"/>`;
  }
  function softBlob(x, y, s, c) {
    return `<ellipse cx="${x}" cy="${y}" rx="${s}" ry="${r2(s * .78)}" fill="${c}"/>
            <ellipse cx="${x}" cy="${y}" rx="${s}" ry="${r2(s * .78)}" fill="url(#mozGloss)" opacity=".5"/>`;
  }
  function bluecheese(x, y, s, c) {
    const g = rng(x + y);
    let veins = '';
    for (let i = 0; i < 5; i++) {
      const [vx, vy] = pol(x, y, s * .6 * g(), g() * 6.28);
      veins += `<circle cx="${vx}" cy="${vy}" r="${r2(1 + g() * 1.6)}" fill="#5F6E86" opacity=".7"/>`;
    }
    return `<ellipse cx="${x}" cy="${y}" rx="${s}" ry="${r2(s * .8)}" fill="${c}"/>${veins}`;
  }
  function cube(x, y, s, c, a) {
    return `<rect x="${r2(x - s / 2)}" y="${r2(y - s / 2)}" width="${s}" height="${s}" rx="${r2(s * .18)}"
             fill="${c}" transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function shaving(x, y, s, c, a) {
    return `<rect x="${r2(x - s)}" y="${r2(y - s * .28)}" width="${r2(s * 2)}" height="${r2(s * .56)}" rx="${r2(s * .28)}"
             fill="${c}" transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function strip(x, y, s, c, a) {
    return `<path d="M${r2(x - s)} ${y}q${r2(s * .5)} ${r2(-s * .5)} ${s} 0q${r2(s * .5)} ${r2(s * .5)} ${s} 0"
             stroke="${c}" stroke-width="${r2(s * .42)}" fill="none" stroke-linecap="round"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>
            <path d="M${r2(x - s)} ${r2(y - s * .18)}q${r2(s * .5)} ${r2(-s * .5)} ${s} 0q${r2(s * .5)} ${r2(s * .5)} ${s} 0"
             stroke="#F0C0AC" stroke-width="${r2(s * .14)}" fill="none" opacity=".8"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function ribbon(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <path d="M${r2(x - s)} ${y}q${r2(s * .45)} ${r2(-s * .55)} ${r2(s * .9)} ${r2(-s * .05)}q${r2(s * .45)} ${r2(s * .5)} ${r2(s * 1.1)} ${r2(-s * .1)}
               l0 ${r2(s * .5)}q${r2(-s * .6)} ${r2(s * .5)} ${r2(-s * 1.1)} ${r2(s * .05)}q${r2(-s * .48)} ${r2(-s * .4)} ${r2(-s * .9)} ${r2(s * .1)}Z"
            fill="${c}"/>
      <path d="M${r2(x - s * .7)} ${r2(y + s * .1)}q${r2(s * .7)} ${r2(-s * .3)} ${r2(s * 1.5)} ${r2(s * .05)}" stroke="#FBD3D8" stroke-width="1.4" fill="none" opacity=".85"/>
    </g>`;
  }
  function arcTop(x, y, s, c, a) {
    return `<path d="M${r2(x - s)} ${y}a${s} ${s} 0 0 1 ${r2(s * 2)} 0"
             stroke="${c}" stroke-width="${r2(s * .2)}" fill="none" stroke-linecap="round"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>
            <path d="M${r2(x - s * .66)} ${y}a${r2(s * .66)} ${r2(s * .66)} 0 0 1 ${r2(s * 1.32)} 0"
             stroke="${c}" stroke-width="${r2(s * .16)}" fill="none" opacity=".7" stroke-linecap="round"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function tomatoSlice(x, y, s, c) {
    let seg = '';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const [ax, ay] = pol(x, y, s * .78, ang);
      seg += `<path d="M${x} ${y}L${ax} ${ay}" stroke="#F6C6B4" stroke-width="1.6" opacity=".85" stroke-linecap="round"/>`;
    }
    return `<circle cx="${x}" cy="${y}" r="${s}" fill="${c}"/>
            <circle cx="${x}" cy="${y}" r="${r2(s * .78)}" fill="#EE7A62"/>${seg}
            <circle cx="${x}" cy="${y}" r="${r2(s * .18)}" fill="#F9DCCB"/>`;
  }
  function wedge(x, y, s, c, a) {
    return `<path d="M${x} ${r2(y - s)}L${r2(x + s * .72)} ${r2(y + s * .68)}L${r2(x - s * .72)} ${r2(y + s * .68)}Z"
             fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function egg(x, y, s, c) {
    return `<ellipse cx="${x}" cy="${y}" rx="${r2(s * 1.15)}" ry="${s}" fill="${c}"/>
            <circle cx="${x}" cy="${y}" r="${r2(s * .44)}" fill="#F5B93E"/>
            <circle cx="${r2(x - s * .16)}" cy="${r2(y - s * .16)}" r="${r2(s * .16)}" fill="#FBDD8C" opacity=".9"/>`;
  }
  function flake(x, y, s, c, a) {
    return `<path d="M${r2(x - s)} ${y}q${r2(s * .5)} ${r2(-s * .6)} ${s} ${r2(-s * .1)}q${r2(s * .5)} ${r2(s * .5)} ${s} ${r2(s * .1)}
             q${r2(-s)} ${r2(s * .5)} ${r2(-s * 2)} 0Z" fill="${c}"
             transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
  }
  function shrimp(x, y, s, c, a) {
    return `<g transform="rotate(${r2(a * 57.3)} ${x} ${y})">
      <path d="M${r2(x - s * .7)} ${r2(y + s * .5)}a${r2(s * .8)} ${r2(s * .8)} 0 1 1 ${r2(s * 1.2)} ${r2(-s * .5)}"
            stroke="${c}" stroke-width="${r2(s * .5)}" fill="none" stroke-linecap="round"/>
      <path d="M${r2(x - s * .55)} ${r2(y + s * .35)}a${r2(s * .6)} ${r2(s * .6)} 0 1 1 ${r2(s * .95)} ${r2(-s * .4)}"
            stroke="#FBC0AC" stroke-width="${r2(s * .14)}" fill="none" opacity=".9"/>
    </g>`;
  }

  /* ---------- Pizza ------------------------------------------------------ */

  /**
   * Felülnézeti pizza SVG.
   * @param {object} o
   * @param {string} o.seed      – azonosító, ugyanaz a mag = ugyanaz a kép
   * @param {string[]} o.toppings – feltétkulcsok a TOPPINGS-ból
   * @param {string} o.base      – 'paradicsom' | 'tejfol' | 'feher' | 'pesto'
   * @param {boolean} o.slice    – hiányzó szelet (étvágygerjesztő)
   * @param {number} o.size      – px
   */
  function pizza(o = {}) {
    const seed = o.seed || 'basilico';
    const g = rng(seed);
    const tops = (o.toppings || []).filter(t => TOPPINGS[t]);
    const base = o.base || 'paradicsom';
    const size = o.size || 200;
    const cx = 100, cy = 100;
    const id = uid('pz');

    /* Szabálytalan, kézzel nyújtott tészta széle */
    const pts = [];
    const N = 44;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(pol(cx, cy, 94 + Math.sin(a * 5.3 + g() * 2) * 2.2 + g() * 2.6, a));
    }
    const crustPath = 'M' + pts.map((p, i) => (i ? 'L' : '') + p).join('') + 'Z';

    /* Szószréteg – szintén szabálytalan */
    const spts = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      spts.push(pol(cx, cy, 76 + Math.sin(a * 4 + 1) * 2 + g() * 3, a));
    }
    const saucePath = 'M' + spts.map((p, i) => (i ? 'L' : '') + p).join('') + 'Z';

    const SAUCE = {
      paradicsom: ['#C0392B', '#E05A3E'],
      tejfol:     ['#EDE3CE', '#FAF3E4'],
      feher:      ['#E9DFC6', '#FBF5E7'],
      pesto:      ['#4E8544', '#76B25C']
    }[base] || ['#C0392B', '#E05A3E'];

    /* Sajtfoltok */
    let cheese = '';
    for (let i = 0; i < 16; i++) {
      const a = g() * Math.PI * 2, rr = Math.sqrt(g()) * 66;
      const [x, y] = pol(cx, cy, rr, a);
      cheese += `<ellipse cx="${x}" cy="${y}" rx="${r2(7 + g() * 9)}" ry="${r2(5 + g() * 7)}"
                  fill="#F6DFA6" opacity="${r2(.45 + g() * .35)}"/>`;
    }

    /* Sült foltok a peremen */
    let char = '';
    for (let i = 0; i < 11; i++) {
      const a = g() * Math.PI * 2;
      const [x, y] = pol(cx, cy, 85 + g() * 6, a);
      char += `<ellipse cx="${x}" cy="${y}" rx="${r2(2.4 + g() * 3)}" ry="${r2(1.8 + g() * 2)}"
                fill="#7A4A1E" opacity="${r2(.2 + g() * .35)}" transform="rotate(${r2(a * 57.3)} ${x} ${y})"/>`;
    }

    /* Feltétek elszórása – kerüljük a középpontot és a peremet */
    let items = '';
    tops.forEach((key, ti) => {
      const t = TOPPINGS[key];
      const count = Math.max(3, Math.round(t.n * (o.density || 1)));
      for (let i = 0; i < count; i++) {
        const a = ((i + ti * .37) / count) * Math.PI * 2 + g() * .55;
        const rr = 16 + Math.sqrt(g()) * 54;
        const [x, y] = pol(cx, cy, rr, a);
        items += t.draw(x, y, t.size, t.color, g() * Math.PI * 2);
      }
    });

    /* Hiányzó szelet */
    const sliceCut = o.slice
      ? `<path d="M${cx} ${cy}L${pol(cx, cy, 100, -1.15)}A100 100 0 0 1 ${pol(cx, cy, 100, -.35)}Z" fill="var(--bg,#0E0D0C)"/>`
      : '';

    return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="${o.alt || 'Pizza illusztráció'}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${id}d" cx="42%" cy="36%">
      <stop offset="0%" stop-color="#F2D9A8"/><stop offset="62%" stop-color="#E3BE80"/><stop offset="100%" stop-color="#C08A45"/>
    </radialGradient>
    <radialGradient id="${id}s" cx="45%" cy="40%">
      <stop offset="0%" stop-color="${SAUCE[1]}"/><stop offset="100%" stop-color="${SAUCE[0]}"/>
    </radialGradient>
    <radialGradient id="mozGloss" cx="34%" cy="30%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".85"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="${id}sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#2A1608" flood-opacity=".35"/>
    </filter>
  </defs>
  <g filter="url(#${id}sh)">
    <path d="${crustPath}" fill="url(#${id}d)"/>
    ${char}
    <path d="${saucePath}" fill="url(#${id}s)"/>
    ${cheese}
    ${items}
    <path d="${crustPath}" fill="none" stroke="#A9712F" stroke-width="1.1" opacity=".45"/>
    ${sliceCut}
  </g>
</svg>`;
  }

  /* ---------- Egérmutató ------------------------------------------------- */

  /**
   * Pizzaszelet egérmutató a klasszikus nyíl sziluettjében.
   * A szelet csúcsa a viewBox (2,2) pontján van — a `tip` érték adja meg,
   * hány képpontot kell visszatolni, hogy a hegye pontosan a kurzor
   * valódi pozíciójára essen.
   */
  const CURSOR_TIP = 2 / 40;   // a csúcs helye a viewBox arányában

  function cursorPizza(size = 34) {
    const id = uid('cur');
    /* A külső kontúr a klasszikus nyíl sziluettje: hegyes csúcs bal fölül,
       a széles vég kifelé domborodó kéreggel. A belső (sajtos) réteg a két
       vágott élt szinte eléri — kéreg csak a széles végen van, ahogy egy
       valódi szeleten. */
    const OUTER = 'M2 2 L7 31 Q19.4 28.9 27.5 20 Z';
    const INNER = 'M3.1 3.7 L7.05 25.4 Q16.6 24.5 22.4 17.7 Z';
    return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}d" x1="0" y1="0" x2=".7" y2="1">
      <stop offset="0%" stop-color="#F2D9A8"/><stop offset="100%" stop-color="#C9924E"/>
    </linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0%" stop-color="#F2D79B"/><stop offset="55%" stop-color="#E8C36F"/><stop offset="100%" stop-color="#D8452F"/>
    </linearGradient>
    <filter id="${id}f" x="-40%" y="-40%" width="190%" height="190%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/>
    </filter>
  </defs>
  <g filter="url(#${id}f)">
    <!-- fehér kontúr, mint az eredeti rendszer-kurzoron -->
    <path d="${OUTER}" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${OUTER}" fill="url(#${id}d)"/>
    <path d="${INNER}" fill="url(#${id}s)"/>
    <!-- olvadt sajtfoltok -->
    <ellipse cx="8.6" cy="20.8" rx="2.1" ry="1.5" fill="#FBF6E9" opacity=".75"/>
    <ellipse cx="13.4" cy="20.2" rx="2.3" ry="1.6" fill="#FBF6E9" opacity=".7"/>
    <ellipse cx="7.3" cy="9.8" rx="1.5" ry="1.1" fill="#FBF6E9" opacity=".8"/>
    <!-- szalámi -->
    <circle cx="10" cy="17" r="2.2" fill="#C4362B"/>
    <circle cx="9.4" cy="16.4" r=".72" fill="#8E241B" opacity=".55"/>
    <circle cx="15.5" cy="16" r="1.8" fill="#C4362B"/>
    <circle cx="16" cy="16.6" r=".6" fill="#8E241B" opacity=".5"/>
    <circle cx="7.4" cy="12" r="1.5" fill="#C4362B"/>
    <!-- bazsalikom -->
    <ellipse cx="12.6" cy="12.6" rx="1.4" ry="2.2" fill="#4FA45E" transform="rotate(36 12.6 12.6)"/>
    <ellipse cx="16.8" cy="20.6" rx="1.2" ry="1.9" fill="#4FA45E" transform="rotate(-26 16.8 20.6)"/>
    <!-- sült foltok a kérgen -->
    <ellipse cx="11.8" cy="28.2" rx="1.5" ry=".9" fill="#8A5320" opacity=".42"/>
    <ellipse cx="17.6" cy="26.4" rx="1.3" ry=".8" fill="#8A5320" opacity=".38" transform="rotate(-18 17.6 26.4)"/>
    <ellipse cx="23" cy="22.4" rx="1.1" ry=".75" fill="#8A5320" opacity=".38" transform="rotate(-42 23 22.4)"/>
  </g>
</svg>`;
  }

  /* ---------- Logó ------------------------------------------------------- */

  function logo(size = 40, mono = false) {
    const leaf1 = mono ? 'currentColor' : '#5FB56E';
    const leaf2 = mono ? 'currentColor' : '#3C8A4C';
    return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="24" cy="24" r="22" fill="none" stroke="${mono ? 'currentColor' : '#E9B44C'}" stroke-width="1.6" opacity=".55"/>
  <circle cx="24" cy="24" r="17" fill="${mono ? 'none' : '#E0503F'}" opacity="${mono ? 0 : .16}"/>
  <path d="M24 34c0-9 5-14 13-15 0 9-5 14-13 15Z" fill="${leaf1}"/>
  <path d="M24 34c0-9-5-14-13-15 0 9 5 14 13 15Z" fill="${leaf2}"/>
  <path d="M24 36V22" stroke="${mono ? 'currentColor' : '#8B5E2A'}" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="24" cy="16" r="3.1" fill="${mono ? 'currentColor' : '#E9B44C'}"/>
</svg>`;
  }

  /* ---------- Avatár ----------------------------------------------------- */

  /** Névből képzett, mindig ugyanolyan, "pizza-arcú" profilkép. */
  function avatar(name = 'Vendég', size = 120) {
    const g = rng(name);
    const hues = [[76, 154, 92], [224, 80, 63], [233, 180, 76], [196, 96, 58], [93, 135, 176], [150, 96, 172]];
    const c = hues[Math.floor(g() * hues.length)];
    const c2 = hues[Math.floor(g() * hues.length)];
    const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
    const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'B';
    const id = uid('av');
    let confetti = '';
    for (let i = 0; i < 9; i++) {
      const [x, y] = pol(60, 60, 20 + g() * 30, g() * 6.28);
      confetti += `<circle cx="${x}" cy="${y}" r="${r2(2 + g() * 4)}" fill="#fff" opacity="${r2(.08 + g() * .14)}"/>`;
    }
    return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${name} profilképe">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${rgb(c)}"/><stop offset="100%" stop-color="${rgb(c2)}"/>
  </linearGradient></defs>
  <rect width="120" height="120" fill="url(#${id})"/>
  ${confetti}
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central"
        font-family="Playfair Display, Georgia, serif" font-size="46" font-weight="900" fill="#fff" opacity=".95">${initials}</text>
</svg>`;
  }

  /* ---------- Jelenetek (galéria / rólunk) -------------------------------- */

  const SCENE_BG = {
    warm:  ['#2A1B10', '#4A2B16'],
    green: ['#132018', '#1F3A26'],
    night: ['#141115', '#2A1F2A'],
    cream: ['#3A2A18', '#6A4A26']
  };

  function frame(id, tone, inner, w = 400, h = 300, label = '') {
    const [a, b] = SCENE_BG[tone] || SCENE_BG.warm;
    return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="${id}bg" x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0%" stop-color="${b}"/><stop offset="100%" stop-color="${a}"/>
    </linearGradient>
    <radialGradient id="${id}vig" cx="50%" cy="42%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".5"/>
    </radialGradient>
    <filter id="${id}g"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}bg)"/>
  ${inner}
  <rect width="${w}" height="${h}" fill="url(#${id}vig)"/>
</svg>`;
  }

  const SCENES = {
    /* Kemence lobogó tűzzel */
    kemence(id) {
      let bricks = '';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
        bricks += `<rect x="${40 + c * 36 + (r % 2 ? 18 : 0)}" y="${60 + r * 26}" width="32" height="22" rx="3" fill="#6B3E22" opacity="${.5 + (r % 2) * .12}"/>`;
      }
      return frame(id, 'warm', `
        <g>${bricks}</g>
        <path d="M110 210h180v-14a90 62 0 0 0-180 0Z" fill="#3A2011"/>
        <ellipse cx="200" cy="200" rx="78" ry="46" fill="#120A05"/>
        <g filter="url(#${id}g)"><ellipse cx="200" cy="205" rx="58" ry="26" fill="#FF8A2B" opacity=".85"/></g>
        <path d="M172 208q10-30 28-38-6 20 6 26 8-16 22-16-8 18 4 28Z" fill="#FFC14D"/>
        <path d="M186 210q6-18 16-24-4 12 4 16 5-10 13-10-5 11 2 18Z" fill="#FFF0B8" opacity=".9"/>
        <rect x="150" y="192" width="100" height="7" rx="3" fill="#7A4A22"/>
        <g transform="translate(232 178) rotate(-12)">
          <rect x="0" y="0" width="86" height="5" rx="2.5" fill="#C08A45"/>
          <circle cx="-4" cy="2.5" r="17" fill="#E3BE80"/><circle cx="-4" cy="2.5" r="12" fill="#D4503C"/>
        </g>
        <rect x="0" y="240" width="400" height="60" fill="#1A0F07"/>`, 400, 300, 'Fatüzelésű kemence lobogó lánggal');
    },

    /* Tésztanyújtás lisztfelhőben */
    teszta(id) {
      let flour = '';
      for (let i = 0; i < 40; i++) {
        const g = rng(i * 7 + 3);
        flour += `<circle cx="${r2(60 + g() * 280)}" cy="${r2(60 + g() * 180)}" r="${r2(1 + g() * 3)}" fill="#F7EBD4" opacity="${r2(.15 + g() * .4)}"/>`;
      }
      return frame(id, 'cream', `
        <rect x="0" y="190" width="400" height="110" fill="#4E3218"/>
        <rect x="0" y="190" width="400" height="6" fill="#6B4522"/>
        <ellipse cx="200" cy="196" rx="150" ry="16" fill="#000" opacity=".28"/>
        <ellipse cx="200" cy="160" rx="112" ry="46" fill="#F0DDB4"/>
        <ellipse cx="200" cy="154" rx="112" ry="46" fill="#FBEFD2"/>
        <ellipse cx="200" cy="154" rx="92" ry="34" fill="#F3E2BE" opacity=".8"/>
        <ellipse cx="168" cy="142" rx="26" ry="10" fill="#fff" opacity=".28"/>
        <g stroke="#E7C98F" stroke-width="2" fill="none" opacity=".7">
          <path d="M130 160q70 22 140 0"/><path d="M142 172q58 16 116 0"/>
        </g>
        ${flour}
        <rect x="46" y="112" width="12" height="88" rx="6" fill="#8A5A2C"/>
        <rect x="342" y="112" width="12" height="88" rx="6" fill="#8A5A2C"/>`, 400, 300, 'Kézzel nyújtott pizzatészta lisztfelhőben');
    },

    /* Terített asztal felülnézetből */
    asztal(id) {
      return frame(id, 'warm', `
        <rect x="0" y="0" width="400" height="300" fill="#3E2718"/>
        <ellipse cx="200" cy="150" rx="180" ry="132" fill="#5A3A21"/>
        <circle cx="150" cy="140" r="72" fill="#F6EFE3"/><circle cx="150" cy="140" r="63" fill="#EDE2CE"/>
        ${pizzaInline('asztal1', ['szalami', 'bazsalikom'], 150, 140, 58)}
        <circle cx="292" cy="96" r="40" fill="#F6EFE3"/><circle cx="292" cy="96" r="34" fill="#EDE2CE"/>
        ${pizzaInline('asztal2', ['gomba', 'rukkola'], 292, 96, 31)}
        <g transform="translate(300 200)">
          <path d="M0 0q-14-30 0-46 14 16 0 46Z" fill="#7A1D2E" opacity=".92"/>
          <path d="M-13 -46h26v-6q0-16-13-16t-13 16Z" fill="#D9E6E2" opacity=".35"/>
          <rect x="-1.6" y="0" width="3.2" height="26" fill="#D9E6E2" opacity=".45"/>
          <ellipse cx="0" cy="27" rx="16" ry="4" fill="#D9E6E2" opacity=".45"/>
        </g>
        <g transform="translate(66 226) rotate(-8)">
          <rect x="0" y="0" width="6" height="52" rx="3" fill="#C9CFD6"/>
          <rect x="14" y="0" width="6" height="52" rx="3" fill="#C9CFD6"/>
          <ellipse cx="10" cy="-6" rx="14" ry="8" fill="#C9CFD6" opacity=".8"/>
        </g>
        <g transform="translate(212 236)">
          <rect x="-30" y="-6" width="60" height="14" rx="7" fill="#2E5D34"/>
          <rect x="-4" y="-22" width="8" height="18" rx="3" fill="#2E5D34"/>
          <circle cx="0" cy="-24" r="4" fill="#E9B44C"/>
        </g>`, 400, 300, 'Terített asztal felülnézetből');
    },

    /* Belső tér lámpákkal */
    belso(id) {
      let lamps = '';
      [90, 200, 310].forEach((x, i) => {
        lamps += `<g><rect x="${x - 1}" y="0" width="2" height="${52 + i * 14}" fill="#6A5744"/>
          <path d="M${x - 26} ${64 + i * 14}q26-34 52 0Z" fill="#E9B44C" opacity=".9"/>
          <circle cx="${x}" cy="${70 + i * 14}" r="6" fill="#FFF3CC"/>
          <g filter="url(#${id}g)"><circle cx="${x}" cy="${76 + i * 14}" r="30" fill="#FFC65A" opacity=".28"/></g></g>`;
      });
      return frame(id, 'night', `
        <rect x="0" y="150" width="400" height="150" fill="#241A16"/>
        <rect x="0" y="150" width="400" height="4" fill="#3E2C22"/>
        ${lamps}
        <g fill="#1A1214">
          <rect x="40" y="186" width="96" height="8" rx="4"/><rect x="46" y="194" width="7" height="34"/><rect x="123" y="194" width="7" height="34"/>
          <rect x="262" y="186" width="96" height="8" rx="4"/><rect x="268" y="194" width="7" height="34"/><rect x="345" y="194" width="7" height="34"/>
        </g>
        <g fill="#2C1F1A">
          <rect x="150" y="176" width="100" height="10" rx="5"/><rect x="192" y="186" width="16" height="42" rx="4"/>
          <ellipse cx="200" cy="230" rx="34" ry="6"/>
        </g>
        <circle cx="200" cy="168" r="9" fill="#E9B44C" opacity=".55"/>
        <g opacity=".5"><rect x="0" y="252" width="400" height="48" fill="#120C0A"/></g>`, 400, 300, 'A bisztró belső tere esti fényekkel');
    },

    /* Terasz füzérfénnyel */
    terasz(id) {
      let bulbs = '';
      for (let i = 0; i < 12; i++) {
        const x = 20 + i * 34, y = 40 + Math.sin(i * .8) * 12;
        bulbs += `<circle cx="${x}" cy="${y + 10}" r="5" fill="#FFE6A3"/>
                  <g filter="url(#${id}g)"><circle cx="${x}" cy="${y + 10}" r="13" fill="#FFD277" opacity=".35"/></g>`;
      }
      return frame(id, 'night', `
        <path d="M0 44q100 26 200 0t200 6" stroke="#4A3A2C" stroke-width="2" fill="none"/>
        ${bulbs}
        <rect x="0" y="220" width="400" height="80" fill="#241C16"/>
        <g fill="#33261E">
          <circle cx="110" cy="222" r="42"/><rect x="106" y="222" width="8" height="46"/>
          <circle cx="290" cy="228" r="34"/><rect x="286" y="228" width="8" height="42"/>
        </g>
        <g transform="translate(110 222)">${pizzaInline('ter1', ['bazsalikom', 'mozzarella'], 0, 0, 34)}</g>
        <g transform="translate(290 228)">${pizzaInline('ter2', ['szalami'], 0, 0, 27)}</g>
        <g fill="#1C6B3A" opacity=".9">
          <rect x="10" y="200" width="34" height="40" rx="5" fill="#5A3A22"/>
          <path d="M27 200q-22-14-16-42 20 6 16 42Z"/><path d="M27 200q22-16 18-46-22 8-18 46Z"/>
        </g>
        <g fill="#1C6B3A" opacity=".9">
          <rect x="356" y="206" width="32" height="36" rx="5" fill="#5A3A22"/>
          <path d="M372 206q-20-12-15-38 18 6 15 38Z"/><path d="M372 206q20-14 16-42-20 8-16 42Z"/>
        </g>`, 400, 300, 'Nyári terasz füzérfényekkel');
    },

    /* Szelet sajthúzással */
    szelet(id) {
      return frame(id, 'warm', `
        <g transform="translate(200 170) rotate(-14)">
          <path d="M-92 42L0 -120L92 42Z" fill="#E3BE80"/>
          <path d="M-78 34L0 -100L78 34Z" fill="#D8452F"/>
          <path d="M-72 30L0 -92L72 30Z" fill="#F2D79B" opacity=".92"/>
          <path d="M-92 42h184q0 18-92 18t-92-18Z" fill="#C08A45"/>
          ${pepperoni(-30, -8, 13, '#C4362B', .3)}
          ${pepperoni(26, 6, 12, '#C4362B', 1.2)}
          ${pepperoni(0, -50, 11, '#C4362B', 2.1)}
          ${leaf(-6, 18, 14, '#4FA45E', .5)}
          ${leaf(40, -30, 12, '#4FA45E', 2.4)}
        </g>
        <g stroke="#F6DFA6" stroke-width="6" fill="none" stroke-linecap="round" opacity=".92">
          <path d="M128 208q10 44 -6 74"/><path d="M180 216q4 46 -14 70"/><path d="M240 210q12 40 -2 72"/>
        </g>
        <ellipse cx="200" cy="286" rx="120" ry="12" fill="#000" opacity=".3"/>`, 400, 300, 'Pizzaszelet olvadt sajthúzással');
    },

    /* Bor és pohár */
    bor(id) {
      return frame(id, 'green', `
        <g transform="translate(132 170)">
          <path d="M-22 0h44v-90q0-22-22-24t-22 24Z" fill="#20402A"/>
          <rect x="-9" y="-140" width="18" height="30" rx="3" fill="#20402A"/>
          <rect x="-11" y="-146" width="22" height="10" rx="3" fill="#8B1E2E"/>
          <rect x="-19" y="-52" width="38" height="34" rx="3" fill="#F2E6CC"/>
          <text x="0" y="-34" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-size="7" font-weight="700" letter-spacing=".4" fill="#4A3418">BASILICO</text>
          <text x="0" y="-25" text-anchor="middle" font-family="Inter, sans-serif" font-size="4.6" fill="#8A7248">CHIANTI</text>
          <path d="M-16 -100q10 -6 20 0" stroke="#fff" stroke-width="2" opacity=".18" fill="none"/>
        </g>
        <g transform="translate(268 176)">
          <path d="M-34 -74h68q-2 44-34 52-32-8-34-52Z" fill="#D9E6E2" opacity=".22"/>
          <path d="M-29 -46h58q-6 22-29 28-23-6-29-28Z" fill="#8B1E2E" opacity=".9"/>
          <rect x="-2.5" y="-22" width="5" height="44" fill="#D9E6E2" opacity=".3"/>
          <ellipse cx="0" cy="24" rx="26" ry="6" fill="#D9E6E2" opacity=".3"/>
          <path d="M-24 -68q8 22 14 30" stroke="#fff" stroke-width="3" opacity=".2" fill="none"/>
        </g>
        <ellipse cx="200" cy="252" rx="140" ry="14" fill="#000" opacity=".3"/>
        ${leaf(70, 236, 16, '#4FA45E', .4)}${leaf(336, 240, 14, '#4FA45E', 2.2)}`, 400, 300, 'Házi vörösbor pohárral');
    },

    /* Bazsalikom cserépben */
    fuszer(id) {
      let leaves = '';
      const g = rng('herb');
      for (let i = 0; i < 22; i++) {
        const a = -Math.PI / 2 + (g() - .5) * 2.6;
        const rr = 40 + g() * 62;
        const [x, y] = pol(200, 190, rr, a);
        leaves += `<g transform="translate(${x} ${y}) rotate(${r2(a * 57.3 + 90)})">
          <path d="M0 -16q16 8 0 26q-16-18 0-26Z" fill="${g() > .5 ? '#4FA45E' : '#3C8A4C'}"/></g>`;
      }
      return frame(id, 'green', `
        <g stroke="#356B3C" stroke-width="3" fill="none">
          <path d="M200 196v-70"/><path d="M200 168q-30-12-42-40"/><path d="M200 156q30-14 44-40"/>
        </g>
        ${leaves}
        <path d="M162 190h76l-9 66h-58Z" fill="#B25A34"/>
        <rect x="156" y="182" width="88" height="16" rx="5" fill="#C4603A"/>
        <ellipse cx="200" cy="262" rx="52" ry="8" fill="#000" opacity=".3"/>
        <rect x="176" y="216" width="24" height="4" rx="2" fill="#8E4426" opacity=".6"/>`, 400, 300, 'Friss bazsalikom cserépben');
    },

    /* Tiramisu */
    desszert(id) {
      return frame(id, 'cream', `
        <g transform="translate(200 178)">
          <path d="M-72 -46h144v78q0 14-72 14t-72-14Z" fill="#F4E7CE"/>
          <rect x="-72" y="-52" width="144" height="14" rx="6" fill="#6B4322"/>
          <rect x="-72" y="-38" width="144" height="16" fill="#FBF2DE"/>
          <rect x="-72" y="-22" width="144" height="14" fill="#8A5A34"/>
          <rect x="-72" y="-8" width="144" height="18" fill="#FBF2DE"/>
          <rect x="-72" y="10" width="144" height="12" fill="#8A5A34" opacity=".85"/>
          <ellipse cx="0" cy="-52" rx="72" ry="12" fill="#5A3620"/>
          <ellipse cx="-24" cy="-54" rx="10" ry="4" fill="#3C2414" opacity=".6"/>
          <ellipse cx="22" cy="-50" rx="13" ry="5" fill="#3C2414" opacity=".5"/>
          ${leaf(46, -62, 13, '#4FA45E', -.4)}
        </g>
        <ellipse cx="200" cy="252" rx="96" ry="12" fill="#000" opacity=".3"/>
        <g fill="#F7EBD4" opacity=".35">
          <circle cx="96" cy="90" r="3"/><circle cx="320" cy="72" r="2.4"/><circle cx="286" cy="118" r="2"/>
        </g>`, 400, 300, 'Házi tiramisu');
    },

    /* Eszpresszó */
    kave(id) {
      return frame(id, 'warm', `
        <g transform="translate(200 180)">
          <path d="M-44 -30h88v34q0 30-44 30t-44-30Z" fill="#F6EFE3"/>
          <ellipse cx="0" cy="-30" rx="44" ry="12" fill="#EDE2CE"/>
          <ellipse cx="0" cy="-30" rx="36" ry="9" fill="#3A2113"/>
          <ellipse cx="0" cy="-31" rx="30" ry="7" fill="#B98A4E" opacity=".85"/>
          <path d="M44 -18q24 2 24 18t-24 16" stroke="#F6EFE3" stroke-width="9" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="44" rx="70" ry="12" fill="#EDE2CE"/>
          <ellipse cx="0" cy="42" rx="70" ry="11" fill="#F6EFE3"/>
        </g>
        <g stroke="#F7EBD4" stroke-width="5" fill="none" opacity=".3" stroke-linecap="round">
          <path d="M182 122q-10-20 4-34t2-30"/><path d="M212 118q-10-18 4-30t2-26"/>
        </g>
        <ellipse cx="200" cy="240" rx="90" ry="10" fill="#000" opacity=".28"/>`, 400, 300, 'Eszpresszó crema réteggel');
    },

    /* Szakács portré */
    szakacs(id) {
      return frame(id, 'night', `
        <g transform="translate(200 170)">
          <path d="M-56 96q0-52 56-52t56 52Z" fill="#22303C"/>
          <path d="M-30 44q30 16 60 0l-6-22h-48Z" fill="#F6EFE3"/>
          <ellipse cx="0" cy="6" rx="40" ry="46" fill="#E8B98F"/>
          <path d="M-40 -6q40-22 80 0v-14q-40-20-80 0Z" fill="#3A2A20"/>
          <path d="M-46 -22q0-30 46-30t46 30q10 2 10 14t-14 12h-84q-14 0-14-12t10-14Z" fill="#FBF6EC"/>
          <ellipse cx="-14" cy="4" rx="4" ry="5" fill="#2A1E16"/><ellipse cx="14" cy="4" rx="4" ry="5" fill="#2A1E16"/>
          <path d="M-12 24q12 10 24 0" stroke="#8A5A44" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M-26 -8q10-6 18-2" stroke="#3A2A20" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M26 -8q-10-6-18-2" stroke="#3A2A20" stroke-width="3" fill="none" stroke-linecap="round"/>
        </g>
        <g transform="translate(300 214) rotate(12)">${pizzaInline('chef1', ['bazsalikom', 'szalami'], 0, 0, 30)}</g>`, 400, 300, 'A pizzaiolónk');
    },

    /* Robogós kiszállítás */
    futar(id) {
      return frame(id, 'green', `
        <rect x="0" y="228" width="400" height="72" fill="#16211A"/>
        <g stroke="#4A6A52" stroke-width="3" stroke-dasharray="16 14" opacity=".6"><path d="M0 250h400"/></g>
        <g transform="translate(200 200)">
          <circle cx="-62" cy="30" r="26" fill="#1B1B1B"/><circle cx="-62" cy="30" r="11" fill="#5A5A5A"/>
          <circle cx="66" cy="30" r="26" fill="#1B1B1B"/><circle cx="66" cy="30" r="11" fill="#5A5A5A"/>
          <path d="M-62 30h44l16-40h44l14 40" stroke="#E0503F" stroke-width="10" fill="none" stroke-linecap="round"/>
          <path d="M-18 -12h56v14h-56Z" fill="#C4362B"/>
          <rect x="24" y="-58" width="46" height="42" rx="6" fill="#E9B44C"/>
          <rect x="30" y="-50" width="34" height="10" rx="3" fill="#3A2A12" opacity=".5"/>
          <path d="M56 -12l14-34" stroke="#8A8A8A" stroke-width="6" stroke-linecap="round"/>
          <path d="M60 -48h26" stroke="#8A8A8A" stroke-width="6" stroke-linecap="round"/>
        </g>
        <g fill="#E9B44C" opacity=".55">
          <circle cx="66" cy="120" r="3"/><circle cx="120" cy="96" r="2.4"/><circle cx="330" cy="110" r="3"/>
        </g>`, 400, 300, 'Meleg pizza házhozszállítás');
    }
  };

  /** Beágyazott mini pizza a jelenetekhez (egyszerűsített, gyors). */
  function pizzaInline(seed, tops, cx, cy, r) {
    const g = rng(seed);
    let items = '';
    tops.forEach((k, ti) => {
      const t = TOPPINGS[k]; if (!t) return;
      for (let i = 0; i < 6; i++) {
        const a = ((i + ti * .4) / 6) * Math.PI * 2 + g();
        const [x, y] = pol(cx, cy, r * (.28 + g() * .5), a);
        items += t.draw(x, y, t.size * (r / 100) * 1.5, t.color, g() * 6.28);
      }
    });
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#E3BE80"/>
            <circle cx="${cx}" cy="${cy}" r="${r2(r * .84)}" fill="#D8452F"/>
            <circle cx="${cx}" cy="${cy}" r="${r2(r * .82)}" fill="#F2D79B" opacity=".55"/>${items}`;
  }

  function scene(kind) {
    const fn = SCENES[kind] || SCENES.kemence;
    return fn(uid('sc'));
  }
  const sceneKeys = () => Object.keys(SCENES);

  /* ---------- Térkép ----------------------------------------------------- */

  function map() {
    const id = uid('mp');
    let blocks = '';
    const g = rng('map');
    for (let i = 0; i < 16; i++) {
      const x = 20 + (i % 4) * 148 + g() * 20;
      const y = 24 + Math.floor(i / 4) * 108 + g() * 16;
      blocks += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(88 + g() * 40)}" height="${r2(58 + g() * 30)}"
                  rx="5" fill="#241C16" opacity="${r2(.55 + g() * .35)}"/>`;
    }
    return `<svg viewBox="0 0 600 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Térkép: Basilico Bistro helye">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16110D"/><stop offset="100%" stop-color="#221913"/>
    </linearGradient>
  </defs>
  <rect width="600" height="420" fill="url(#${id})"/>
  ${blocks}
  <g stroke="#3A2C22" stroke-width="14" stroke-linecap="round">
    <path d="M0 200h600"/><path d="M300 0v420"/>
  </g>
  <g stroke="#4C3A2C" stroke-width="5" stroke-linecap="round" opacity=".8">
    <path d="M0 92h600"/><path d="M0 320h600"/><path d="M140 0v420"/><path d="M460 0v420"/>
  </g>
  <g stroke="#E9B44C" stroke-width="2.5" stroke-dasharray="9 9" fill="none" opacity=".75">
    <path d="M60 396q90-40 150-96t92-98"/>
  </g>
  <g class="map-pin" transform="translate(300 200)">
    <circle cx="0" cy="0" r="34" fill="#E0503F" opacity=".16"/>
    <circle cx="0" cy="0" r="22" fill="#E0503F" opacity=".26"/>
    <path d="M0 6c-9-13-14-20-14-27a14 14 0 1 1 28 0c0 7-5 14-14 27Z" fill="#E0503F"/>
    <circle cx="0" cy="-21" r="5.4" fill="#FBEFD2"/>
  </g>
  <text x="300" y="238" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="#F6EFE3">Basilico Bistro</text>
  <text x="300" y="256" text-anchor="middle" font-family="Inter, sans-serif" font-size="10.5" fill="#E9B44C">Kőfaragó utca 15.</text>
  <g opacity=".55">
    <text x="18" y="404" font-family="Inter, sans-serif" font-size="10" fill="#9C8B78">Illusztratív térkép · a valódi beágyazáshoz lásd README</text>
  </g>
</svg>`;
  }

  /* ---------- Alaprajz (asztalválasztó) ---------------------------------- */

  function floorplan(tables, selectedId) {
    const seats = (t) => {
      let s = '';
      for (let i = 0; i < t.seats; i++) {
        const a = (i / t.seats) * Math.PI * 2 - Math.PI / 2;
        const [x, y] = pol(t.x, t.y, t.r + 11, a);
        s += `<circle cx="${x}" cy="${y}" r="5" fill="#6B5A46" opacity=".85"/>`;
      }
      return s;
    };
    const body = tables.map(t => {
      const state = t.busy ? 'busy' : (t.id === selectedId ? 'sel' : 'free');
      const fill = state === 'busy' ? '#4A3630' : state === 'sel' ? '#4C9A5C' : '#8A6A4A';
      const stroke = state === 'sel' ? '#7BD08C' : 'transparent';
      return `<g class="table-hit" data-table="${t.id}" opacity="${t.busy ? .45 : 1}"
                 tabindex="${t.busy ? -1 : 0}" role="button" aria-label="${t.id}. asztal, ${t.seats} fő${t.busy ? ', foglalt' : ''}">
        ${seats(t)}
        <circle cx="${t.x}" cy="${t.y}" r="${t.r}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
        <text x="${t.x}" y="${t.y + 4}" text-anchor="middle" font-family="Inter, sans-serif"
              font-size="12" font-weight="700" fill="#F6EFE3">${t.id}</text>
        ${state === 'sel' ? `<circle cx="${t.x}" cy="${t.y}" r="${t.r + 8}" fill="none" stroke="#7BD08C" stroke-width="1.5" opacity=".55"><animate attributeName="r" values="${t.r + 6};${t.r + 16};${t.r + 6}" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="2.4s" repeatCount="indefinite"/></circle>` : ''}
      </g>`;
    }).join('');

    return `<svg viewBox="0 0 520 330" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="508" height="318" rx="14" fill="#1D1712" stroke="#3A2C22" stroke-width="2"/>
  <rect x="6" y="6" width="508" height="52" rx="14" fill="#241C16"/>
  <text x="26" y="38" font-family="Inter, sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#E9B44C">KEMENCE &amp; BÁRPULT</text>
  <rect x="330" y="18" width="164" height="28" rx="8" fill="#3A2C22"/>
  <circle cx="356" cy="32" r="9" fill="#E0503F" opacity=".8"/>
  <rect x="6" y="272" width="508" height="52" rx="14" fill="#241C16"/>
  <text x="26" y="304" font-family="Inter, sans-serif" font-size="12" font-weight="700" letter-spacing="2" fill="#7BD08C">TERASZ · BEJÁRAT</text>
  <rect x="410" y="284" width="84" height="28" rx="8" fill="#2E4A34"/>
  ${body}
</svg>`;
  }

  /* ---------- Diagramok --------------------------------------------------- */

  function sparkline(values, color = '#7BD08C', w = 130, h = 34) {
    if (!values.length) return '';
    const max = Math.max(...values), min = Math.min(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [
      r2((i / (values.length - 1)) * w),
      r2(h - ((v - min) / span) * (h - 6) - 3)
    ]);
    const id = uid('sp');
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".38"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${line}L${w} ${h}L0 ${h}Z" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.8" fill="${color}"/>
    </svg>`;
  }

  function donut(slices, size = 148) {
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const R0 = 58, C = 2 * Math.PI * R0;
    let off = 0;
    const arcs = slices.map(s => {
      const len = (s.value / total) * C;
      const el = `<circle cx="74" cy="74" r="${R0}" fill="none" stroke="${s.color}" stroke-width="20"
        stroke-dasharray="${r2(len)} ${r2(C - len)}" stroke-dashoffset="${r2(-off)}"
        transform="rotate(-90 74 74)" stroke-linecap="butt"/>`;
      off += len;
      return el;
    }).join('');
    return `<svg class="donut" viewBox="0 0 148 148" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="74" cy="74" r="${R0}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="20"/>
      ${arcs}
      <text x="74" y="70" text-anchor="middle" font-family="Playfair Display, serif" font-size="24" font-weight="900" fill="currentColor">${total}</text>
      <text x="74" y="88" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1.5" fill="currentColor" opacity=".55">ÖSSZESEN</text>
    </svg>`;
  }

  /* ---------- Ikonkészlet ------------------------------------------------- */

  const ICONS = {
    cart:    '<path d="M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16h7.5a2 2 0 0 0 1.95-1.55L20.5 7H6"/><circle cx="9.5" cy="20" r="1.6"/><circle cx="17.5" cy="20" r="1.6"/>',
    user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    search:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    sun:     '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon:    '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    phone:   '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3Z"/>',
    pin:     '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
    mail:    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.6 6.5 12 12.6l8.4-6.1"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    check:   '<path d="M4 12.5 9.5 18 20 6.5"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    minus:   '<path d="M5 12h14"/>',
    close:   '<path d="M6 6l12 12M18 6L6 18"/>',
    arrow:   '<path d="M5 12h14M13 6l6 6-6 6"/>',
    up:      '<path d="M12 19V5M6 11l6-6 6 6"/>',
    star:    '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8Z"/>',
    heart:   '<path d="M12 20s-7.5-4.7-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.3-7.5 10-7.5 10Z"/>',
    fire:    '<path d="M12 22c4 0 6.5-2.8 6.5-6.3 0-4.6-4.2-6.4-3.4-11.7-3 1.6-5 4.4-5 7 0 1.4.6 2.4.6 2.4S9 12 8.4 10c-1.6 1.6-2.9 3.6-2.9 5.7C5.5 19.2 8 22 12 22Z"/>',
    leaf:    '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z"/><path d="M4 20c4-6 8-9 12-10"/>',
    dash:    '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>',
    list:    '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chart:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.1 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8"/>',
    logout:  '<path d="M15 17l5-5-5-5M20 12H9M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/>',
    inbox:   '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M4.5 5h15l1.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"/>',
    trash:   '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    edit:    '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="M14.5 6.5 17.5 9.5"/>',
    fb:      '<path d="M14 8.5h2.5V5H14a4 4 0 0 0-4 4v2H8v3.5h2V22h3.5v-7.5H16L16.5 11H13.5V9.4c0-.6.3-.9.9-.9Z"/>',
    ig:      '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17" cy="7" r="1"/>',
    tiktok:  '<path d="M15 4c.6 2.4 2.1 3.7 4.5 3.9v3c-1.7.1-3.2-.4-4.5-1.3v6.2A5.8 5.8 0 1 1 9.2 10v3.1a2.7 2.7 0 1 0 2.7 2.7V4Z"/>',
    wifi:    '<path d="M5 12.5a10 10 0 0 1 14 0M8 16a5.6 5.6 0 0 1 8 0"/><circle cx="12" cy="19.5" r="1.2"/>',
    park:    '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9.5 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
    pet:     '<circle cx="8" cy="8.5" r="2"/><circle cx="16" cy="8.5" r="2"/><circle cx="5" cy="14" r="1.8"/><circle cx="19" cy="14" r="1.8"/><path d="M12 12c3 0 5 2.4 5 4.6S15 21 12 21s-5-2.2-5-4.4S9 12 12 12Z"/>',
    baby:    '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/>'
  };

  function icon(name, size = 20, stroke = 1.7) {
    const p = ICONS[name] || ICONS.check;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
      stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }
  function iconSolid(name, size = 16) {
    const p = ICONS[name] || ICONS.star;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="none" aria-hidden="true">${p}</svg>`;
  }

  /* ---------- Fotó vagy illusztráció -------------------------------------- */

  /**
   * Ha az adott elemhez adtál valódi fotót (data.js `photo` mező vagy admin),
   * azt használjuk; különben a generált illusztráció jelenik meg.
   * Így a sablon eladható úgy is, ahogy van, és fotókkal is.
   */
  function photo(src, alt, fallbackSvg, cls = '') {
    if (!src) return fallbackSvg;
    return `<img src="${src}" alt="${alt || ''}" loading="lazy" decoding="async" class="${cls}"
      onerror="this.outerHTML=this.dataset.fb" data-fb="${fallbackSvg.replace(/"/g, '&quot;')}">`;
  }

  return { pizza, logo, avatar, scene, sceneKeys, map, floorplan, sparkline, donut,
           icon, iconSolid, photo, rng, cursorPizza, CURSOR_TIP, TOPPINGS };
})();

window.Art = Art;
