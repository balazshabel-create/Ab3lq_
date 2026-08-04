/* ==========================================================================
   BASILICO BISTRO — store.js
   Adatréteg: a data.js "magját" összefésüli a böngészőben tárolt
   módosításokkal (admin szerkesztések, foglalások, kosár, profil).

   Backendre költöztetés: minden írás/olvasás ezen a modulon megy keresztül,
   így elég a `read`/`write` függvényeket egy fetch-alapú API-hívásra
   cserélni — az oldal többi része változatlan maradhat.
   ========================================================================== */

const Store = (() => {
  const NS = 'basilico:';
  const KEY = {
    menu: NS + 'menu',
    hours: NS + 'hours',
    brand: NS + 'brand',
    bookings: NS + 'bookings',
    messages: NS + 'messages',
    cart: NS + 'cart',
    user: NS + 'user',
    theme: NS + 'theme',
    admin: NS + 'admin-session',
    cookie: NS + 'cookie-ok',
    photos: NS + 'photos',
    seeded: NS + 'seeded-v1'
  };

  const listeners = new Set();
  const emit = (what) => listeners.forEach(fn => { try { fn(what); } catch (e) { console.warn(e); } });
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /* ---------- Alacsony szintű tárolás ------------------------------------ */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('Nem sikerült menteni:', key, e); }
    return value;
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) {} }

  /* ---------- Első indítás: demóadatok betöltése -------------------------- */
  function seed() {
    if (read(KEY.seeded, false)) return;
    const today = new Date();
    const iso = (d) => new Date(today.getTime() + d * 864e5).toISOString().slice(0, 10);

    write(KEY.bookings, DATA.seedBookings.map((b, i) => ({
      ...b,
      id: 'bk' + (i + 1),
      date: iso(b.date),
      created: new Date(today.getTime() - (5 - i) * 36e5).toISOString()
    })));

    write(KEY.messages, DATA.seedMessages.map((m, i) => ({
      ...m,
      id: 'ms' + (i + 1),
      at: new Date(today.getTime() - m.days * 864e5 - i * 72e5).toISOString()
    })));

    write(KEY.seeded, true);
  }

  /* ---------- Valódi fotók ------------------------------------------------ */
  /** Be van-e kapcsolva a fotós mód (data.js alapérték + admin felülírás). */
  function photosOn() {
    const o = read(KEY.photos, null);
    return o === null ? !!DATA.photos.enabled : !!o;
  }
  function setPhotos(on) { write(KEY.photos, !!on); emit('photos'); }

  /**
   * Fotós módban minden tétel megkapja a hozzá tartozó képútvonalat
   * (`assets/img/<id>.jpg`), kivéve ha kézzel adtál meg neki másikat.
   * Ha a fájl nem létezik, az art.js automatikusan visszavált a rajzra.
   */
  function withPhoto(item) {
    if (item.photo || !photosOn()) return item;
    return { ...item, photo: DATA.photos.base + item.id + DATA.photos.ext };
  }
  function galleryPhoto(g) {
    if (g.photo) return g.photo;
    return photosOn() ? DATA.photos.galleryBase + g.id + DATA.photos.ext : '';
  }

  /* ---------- Étlap ------------------------------------------------------- */
  /** A mag + admin felülírások (ár, elérhetőség, név) összefésülve. */
  function menu() {
    const over = read(KEY.menu, {});
    return DATA.menu.map(item => withPhoto({ available: true, ...item, ...(over[item.id] || {}) }));
  }
  function menuItem(id) { return menu().find(m => m.id === id); }
  function updateMenuItem(id, patch) {
    const over = read(KEY.menu, {});
    over[id] = { ...(over[id] || {}), ...patch };
    write(KEY.menu, over);
    emit('menu');
  }
  function resetMenu() { drop(KEY.menu); emit('menu'); }

  /* ---------- Nyitvatartás ------------------------------------------------ */
  function hours() { return { ...DATA.hours, ...read(KEY.hours, {}) }; }
  function setHours(day, val) {
    const h = read(KEY.hours, {});
    h[day] = val;
    write(KEY.hours, h);
    emit('hours');
  }
  function resetHours() { drop(KEY.hours); emit('hours'); }

  /**
   * Élő nyitvatartási állapot — ez hajtja a villogó pöttyöt.
   * Visszaad: { state: 'open'|'soon'|'closing'|'closed', label, note, next }
   */
  function openState(now = new Date()) {
    const H = hours();
    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    /* Ünnepnapi kivétel */
    const iso = now.toISOString().slice(0, 10);
    const exc = (DATA.exceptions || []).find(e => e.date === iso);
    if (exc && exc.closed) {
      return { state: 'closed', label: 'Ma zárva', note: exc.note, next: nextOpen(now) };
    }

    const today = H[day];

    /* Éjfélen átnyúló előző napi nyitvatartás (pl. 12:00–00:30) */
    const prev = H[(day + 6) % 7];
    if (prev && toMin(prev.close) < toMin(prev.open) && mins < toMin(prev.close)) {
      const left = toMin(prev.close) - mins;
      return { state: left <= 45 ? 'closing' : 'open',
               label: left <= 45 ? 'Hamarosan zárunk' : 'Most nyitva',
               note: `Zárás ${prev.close}-kor · még ${left} perc`, next: null };
    }

    if (!today) {
      return { state: 'closed', label: 'Ma zárva', note: nextOpenNote(now), next: nextOpen(now) };
    }

    const o = toMin(today.open);
    let c = toMin(today.close);
    if (c < o) c += 1440;   // éjfél utáni zárás

    if (mins < o) {
      const wait = o - mins;
      if (wait <= 60) return { state: 'soon', label: 'Nemsokára nyitunk', note: `Nyitás ${today.open} · ${wait} perc múlva`, next: today.open };
      return { state: 'closed', label: 'Most zárva', note: `Ma ${today.open}-kor nyitunk`, next: today.open };
    }
    if (mins >= c) {
      return { state: 'closed', label: 'Mára bezártunk', note: nextOpenNote(now), next: nextOpen(now) };
    }
    const left = c - mins;
    if (left <= 45) {
      return { state: 'closing', label: 'Hamarosan zárunk', note: `Utolsó rendelés ${fmt(c - 30)} · még ${left} perc`, next: null };
    }
    return { state: 'open', label: 'Most nyitva', note: `Zárás ${today.close}-kor`, next: null };
  }

  function nextOpen(now = new Date()) {
    const H = hours();
    for (let i = 1; i <= 7; i++) {
      const d = (now.getDay() + i) % 7;
      if (H[d]) return { day: d, time: H[d].open, inDays: i };
    }
    return null;
  }
  function nextOpenNote(now = new Date()) {
    const n = nextOpen(now);
    if (!n) return 'Nyitvatartás egyeztetés alatt';
    if (n.inDays === 1) return `Holnap ${n.time}-kor nyitunk`;
    return `${DATA.dayNames[n.day]} ${n.time}-kor nyitunk`;
  }

  /* ---------- Kosár -------------------------------------------------------- */
  function cart() { return read(KEY.cart, []); }
  function cartAdd(id, opts = {}) {
    const c = cart();
    const key = id + '|' + (opts.size || 32);
    const found = c.find(l => l.key === key);
    if (found) found.qty++;
    else {
      const m = menuItem(id);
      if (!m) return;
      c.push({
        key, id, name: m.name, size: opts.size || 32,
        price: opts.size === 40 && m.price40 ? m.price40 : m.price,
        toppings: m.toppings, base: m.base, qty: 1
      });
    }
    write(KEY.cart, c); emit('cart');
  }
  function cartAddCustom(line) {
    const c = cart();
    c.push({ key: 'custom-' + Date.now(), qty: 1, ...line });
    write(KEY.cart, c); emit('cart');
  }
  function cartQty(key, delta) {
    const c = cart();
    const l = c.find(x => x.key === key);
    if (!l) return;
    l.qty += delta;
    write(KEY.cart, c.filter(x => x.qty > 0)); emit('cart');
  }
  function cartRemove(key) { write(KEY.cart, cart().filter(l => l.key !== key)); emit('cart'); }
  function cartClear() { write(KEY.cart, []); emit('cart'); }
  function cartTotal() { return cart().reduce((s, l) => s + l.price * l.qty, 0); }
  function cartCount() { return cart().reduce((s, l) => s + l.qty, 0); }

  /* ---------- Foglalások --------------------------------------------------- */
  function bookings() {
    return read(KEY.bookings, []).sort((a, b) =>
      (a.date + a.time).localeCompare(b.date + b.time));
  }
  function addBooking(b) {
    const list = read(KEY.bookings, []);
    const rec = {
      id: 'bk' + Date.now().toString(36),
      code: 'BB-' + Math.floor(1000 + Math.random() * 9000),
      status: 'new',
      created: new Date().toISOString(),
      ...b
    };
    list.push(rec);
    write(KEY.bookings, list);
    emit('bookings');
    return rec;
  }
  function setBookingStatus(id, status) {
    const list = read(KEY.bookings, []);
    const b = list.find(x => x.id === id);
    if (b) { b.status = status; write(KEY.bookings, list); emit('bookings'); }
  }
  function deleteBooking(id) {
    write(KEY.bookings, read(KEY.bookings, []).filter(b => b.id !== id));
    emit('bookings');
  }
  /** Egy adott napon+időpontban foglalt asztalok azonosítói. */
  function busyTables(date, time) {
    return bookings()
      .filter(b => b.date === date && b.time === time && b.status !== 'cancelled')
      .map(b => b.table);
  }
  /** Szabad helyek száma egy idősávban (kapacitás alapú becslés). */
  function slotCapacity(date, time) {
    const busy = busyTables(date, time);
    const free = DATA.tables.filter(t => !busy.includes(t.id));
    return { free: free.length, seats: free.reduce((s, t) => s + t.seats, 0), total: DATA.tables.length };
  }

  /* ---------- Üzenetek ----------------------------------------------------- */
  function messages() {
    return read(KEY.messages, []).sort((a, b) => b.at.localeCompare(a.at));
  }
  function addMessage(m) {
    const list = read(KEY.messages, []);
    list.push({ id: 'ms' + Date.now().toString(36), at: new Date().toISOString(), read: false, ...m });
    write(KEY.messages, list);
    emit('messages');
  }
  function markRead(id, val = true) {
    const list = read(KEY.messages, []);
    const m = list.find(x => x.id === id);
    if (m) { m.read = val; write(KEY.messages, list); emit('messages'); }
  }
  function deleteMessage(id) {
    write(KEY.messages, read(KEY.messages, []).filter(m => m.id !== id));
    emit('messages');
  }

  /* ---------- Vendégprofil -------------------------------------------------- */
  const DEFAULT_USER = {
    name: 'Kovács Bence',
    email: 'bence.kovacs@example.hu',
    phone: '+36 30 123 4567',
    since: '2022-03-14',
    points: 340,
    stamps: 5,
    visits: 27,
    spent: 214800,
    favorites: ['p-diavola', 'p-bufala', 'd-tiramisu'],
    prefs: { spice: 2, veg: false, glutenFree: false, newsletter: true, table: 'Ablak' },
    allergies: [],
    orders: [
      { date: '2026-07-28', items: ['Diavola', 'Aperol Spritz'], total: 6580, kind: 'Helyben' },
      { date: '2026-07-14', items: ['Bufala DOP', 'Burrata & Datterino', 'Chianti Classico'], total: 17580, kind: 'Helyben' },
      { date: '2026-06-30', items: ['Quattro Formaggi', 'Tiramisù'], total: 6880, kind: 'Kiszállítás' },
      { date: '2026-06-11', items: ['La Basilico', 'Limonádé'], total: 6680, kind: 'Helyben' },
      { date: '2026-05-22', items: ['Diavola', 'Diavola', 'Peroni x2'], total: 11160, kind: 'Elvitel' }
    ]
  };
  function user() { return { ...DEFAULT_USER, ...read(KEY.user, {}) }; }
  function saveUser(patch) {
    write(KEY.user, { ...read(KEY.user, {}), ...patch });
    emit('user');
  }
  function toggleFavorite(id) {
    const u = user();
    const favs = u.favorites.includes(id) ? u.favorites.filter(f => f !== id) : [...u.favorites, id];
    saveUser({ favorites: favs });
    return favs.includes(id);
  }
  function tier(points) {
    if (points >= 1000) return { id: 'basil',  name: 'Basilico',  next: null, min: 1000 };
    if (points >= 600)  return { id: 'gold',   name: 'Arany',     next: 1000, min: 600 };
    if (points >= 250)  return { id: 'silver', name: 'Ezüst',     next: 600,  min: 250 };
    return { id: 'bronze', name: 'Bronz', next: 250, min: 0 };
  }
  function resetUser() { drop(KEY.user); emit('user'); }

  /* ---------- Téma ---------------------------------------------------------- */
  function theme() { return read(KEY.theme, 'dark'); }
  function setTheme(t) {
    write(KEY.theme, t);
    document.documentElement.setAttribute('data-theme', t);
    emit('theme');
  }
  function toggleTheme() { setTheme(theme() === 'dark' ? 'light' : 'dark'); return theme(); }

  /* ---------- Admin munkamenet ----------------------------------------------- */
  function adminIn() { return read(KEY.admin, false); }
  function adminLogin(u, p) {
    const ok = u === DATA.admin.user && p === DATA.admin.pass;
    if (ok) write(KEY.admin, { at: Date.now(), user: u });
    return ok;
  }
  function adminLogout() { drop(KEY.admin); }

  /* ---------- Süti ------------------------------------------------------------ */
  function cookieOk() { return read(KEY.cookie, false); }
  function acceptCookie() { write(KEY.cookie, true); }

  /* ---------- Export / import / reset ------------------------------------------ */
  function exportAll() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      menuOverrides: read(KEY.menu, {}),
      hoursOverrides: read(KEY.hours, {}),
      bookings: read(KEY.bookings, []),
      messages: read(KEY.messages, []),
      user: read(KEY.user, {})
    }, null, 2);
  }
  function importAll(json) {
    const d = JSON.parse(json);
    if (d.menuOverrides)   write(KEY.menu, d.menuOverrides);
    if (d.hoursOverrides)  write(KEY.hours, d.hoursOverrides);
    if (d.bookings)        write(KEY.bookings, d.bookings);
    if (d.messages)        write(KEY.messages, d.messages);
    if (d.user)            write(KEY.user, d.user);
    emit('all');
  }
  function factoryReset() {
    Object.values(KEY).forEach(drop);
    emit('all');
  }

  /* ---------- Formázók ---------------------------------------------------------- */
  const huf = (n) => new Intl.NumberFormat('hu-HU').format(Math.round(n)) + ' Ft';
  const dateHu = (iso) => {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  };
  const dateShort = (iso) => {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
  };
  const relTime = (iso) => {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'most';
    if (diff < 3600) return Math.floor(diff / 60) + ' perce';
    if (diff < 86400) return Math.floor(diff / 3600) + ' órája';
    if (diff < 604800) return Math.floor(diff / 86400) + ' napja';
    return dateShort(iso.slice(0, 10));
  };

  seed();

  return {
    KEY, on, emit,
    menu, menuItem, updateMenuItem, resetMenu,
    photosOn, setPhotos, galleryPhoto,
    hours, setHours, resetHours, openState, nextOpen, nextOpenNote,
    cart, cartAdd, cartAddCustom, cartQty, cartRemove, cartClear, cartTotal, cartCount,
    bookings, addBooking, setBookingStatus, deleteBooking, busyTables, slotCapacity,
    messages, addMessage, markRead, deleteMessage,
    user, saveUser, toggleFavorite, tier, resetUser,
    theme, setTheme, toggleTheme,
    adminIn, adminLogin, adminLogout,
    cookieOk, acceptCookie,
    exportAll, importAll, factoryReset,
    huf, dateHu, dateShort, relTime
  };
})();

window.Store = Store;
