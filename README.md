# Webgen
Making cool websites that always on the market for a reasonable offer

---

# Zamárdi Szépségszalon — weboldal

Teljes, kész weboldal a zamárdi szépségszalonnak. Statikus HTML/CSS/JS —
**nincs build, nincs npm, nincs szerveroldali kód.** Feltölthető bármilyen
tárhelyre, működik fájlból megnyitva is.

---

## Mit tud?

| | |
|---|---|
| **6 oldal** | Főoldal, Szolgáltatások, Galéria, Rólunk, Kapcsolat, Foglalás |
| **Élő nyitva/zárva jelző** | Villogó pötty, ami magától tudja, nyitva van-e a szalon — zöld (nyitva), sárga (1 órán belül nyit vagy zár), piros (zárva). Fél percenként frissül. |
| **Időpontfoglaló** | 5 lépéses varázsló: szolgáltatás → kolléga → nap + időpont → adatok → visszaigazolás |
| **Galéria** | Kategória-szűrő + teljes képernyős nagyító (nyilakkal és billentyűzettel lapozható) |
| **Animációk** | Betöltő, szavankénti címsor-bemozgás, görgetésre megjelenő elemek, futó szalag, egérkövető fény a kártyákon, számláló, parallax, előtte/utána csúszka |
| **Mobilbarát** | Teljes reszponzív, mobilmenü, lebegő foglalás-gomb |
| **Google-adatok** | Cím, telefon, nyitvatartás, 4,9 csillag / 50 vélemény, akadálymentesség — a nyilvános Google-találatok alapján |
| **SEO** | Oldalankénti címek és leírások, `HairSalon` strukturált adat a Google-nek |

---

## Fájlok

```
index.html            Főoldal
szolgaltatasok.html   Árlista + csomagok + GYIK
galeria.html          Munkák, szűrővel és nagyítóval
rolunk.html           Történet, értékek, csapat
kapcsolat.html        Elérhetőség, térkép, üzenetküldés
foglalas.html         Időpontfoglaló

assets/css/style.css  Minden stílus
assets/js/main.js     Közös scriptek + a szalon adatai
assets/js/booking.js  Foglaló + szolgáltatáslista
assets/img/           Ide jönnek a saját fotók
```

---

## Amit érdemes átírni átadás előtt

### 1. Szalon adatai — `assets/js/main.js`, legfelül

```js
const SALON = {
  nev: 'Zamárdi Szépségszalon',
  cim: '8621 Zamárdi, Szabadság tér 5.',
  tel: '+36 20 367 8150',
  email: 'info@zamardiszepsegszalon.hu',   // ← ezt biztosan cserélni kell
  ...
};
```

Az oldalakon a `data-salon="tel"`, `data-salon="cim"`, `data-salon="email"`
attribútumok automatikusan innen töltődnek — elég egy helyen átírni.

### 2. Nyitvatartás — ugyanott

```js
nyitva: {
  0: null,                              // vasárnap zárva
  1: { tol: 8 * 60, ig: 15 * 60 },      // hétfő 8:00–15:00
  ...
  6: { tol: 8 * 60, ig: 12 * 60 }       // szombat 8:00–12:00
}
```

Ebből él a villogó jelző, a nyitvatartás-táblázat **és** a foglaló szabad
időpontjai. Egy helyen kell módosítani.

### 3. Szolgáltatások és árak

- **A foglalóban:** `assets/js/booking.js` → `SZOLGALTATASOK` tömb
- **Az árlistán:** `szolgaltatasok.html` → `.price-row` sorok

### 4. Kollégák — `assets/js/booking.js` → `KOLLEGAK`

A `csoportok` mező szabályozza, ki melyik szolgáltatásra választható.
A `rolunk.html` csapat-szekcióját is érdemes ehhez igazítani.

### 5. Fotók

Most minden képhelyen egy animált, színes helyőrző van:

```html
<div class="ph ph--tall" style="--c1:#3d2f27;--c2:#1c1815" data-label="Balayage"></div>
```

Csere valódi fotóra — semmi mást nem kell átírni:

```html
<img src="assets/img/balayage.jpg" alt="Meleg karamell balayage">
```

Ajánlott méret: 1200–1600 px széles, JPG, 200–400 KB.

---

## Publikálás

Bármelyik működik, feltöltés után azonnal él:

- **Tárhelyre FTP-vel** — másold fel az egész mappát a `public_html`-be
- **Netlify / Vercel** — húzd rá a mappát a felületre, kész
- **GitHub Pages** — Settings → Pages → forrás: `main` branch

Helyi kipróbálás: `python3 -m http.server 8000`, majd `localhost:8000`.

---

## A foglalás működése

A foglaló **backend nélkül** működik: a vendég végigmegy a lépéseken, majd
a rendszer

1. megnyitja az e-mail programját egy kész, kitöltött levéllel a szalon
   címére, és
2. felkínál egy `.ics` naptárbejegyzést (emlékeztetővel) a vendégnek.

A már lefoglalt sávokat a böngésző saját tárolójában jegyzi meg, hogy a demó
élethű legyen.

**Ha később valódi rendszer kell** (adatbázis, automatikus e-mail, SMS): elég
a `booking.js` `foglalasBekuldes()` függvényét átírni úgy, hogy `fetch`-csel
elküldje az adatokat a szervernek. Minden más maradhat.

---

## Technikai megjegyzések

- Nincs külső JS-könyvtár. Egyetlen külső hivatkozás a Google Fonts és az
  OpenStreetMap-térkép; ha ezek nem érhetők el, az oldal rendszerbetűkkel és
  térkép nélkül hibátlanul működik tovább.
- Az időzóna fixen `Europe/Budapest`, így a nyitva/zárva jelző akkor is
  helyes, ha a látogató külföldről nézi.
- `prefers-reduced-motion` támogatva: aki kikapcsolta az animációkat a
  rendszerében, statikus oldalt kap.
- Billentyűzettel bejárható, `aria` feliratokkal, látható fókuszkerettel.
- Tesztelve: Chromium (asztali 1440 px, mobil 390 px) — nincs JS-hiba és
  nincs vízszintes túlcsordulás egyik oldalon sem.

---

## Forrásadatok

A szalon adatai nyilvános Google-találatokból származnak: cím, telefonszám,
nyitvatartás, 4,9 csillagos értékelés 50 vélemény alapján, akadálymentes
bejárat/parkoló/mosdó, készpénzes fizetés, női tulajdonú vállalkozás.

**Az árak, a kollégák nevei, a csomagajánlatok és a szövegek illusztrációk** —
ezeket a szalonnal egyeztetve kell véglegesíteni.
