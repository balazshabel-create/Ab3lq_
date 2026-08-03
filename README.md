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
| **Egyedi kurzor** | Követő pötty + lassabban úszó gyűrű, ami gomb fölött mágnesesen beleül, galéria fölött „Nagyítás” feliratú aranykorongra vált. Érintőképernyőn magától kikapcsol. |
| **Admin felület** | Külön belépő oldal + vezérlőpult: foglaláskezelés, heti naptár, árak, csapat, nyitvatartás, szalonadatok — profilmenüvel |

---

## Admin felület

Két oldal: `admin-belepes.html` (belépő) és `admin.html` (vezérlőpult).
A publikus oldalak láblécében van egy diszkrét **Admin** link.

**Bemutató belépés:** `admin@zamardiszepsegszalon.hu` / `zamardi2026`

### Mit tud a vezérlőpult?

- **Áttekintés** — mai foglalások, új kérések, várható heti bevétel,
  kihasználtság, mai menetrend, 7 napos oszlopdiagram, legutóbbi foglalások
- **Foglalások** — keresés és szűrés állapot szerint, visszaigazolás egy
  kattintással, részletek ablak, visszaigazoló e-mail a vendégnek, törlés
- **Heti naptár** — hetekre lapozható, napokra bontott nézet
- **Szolgáltatások** — név, időtartam és ár szerkesztése, új sor, törlés
- **Csapat** — kollégák és az, ki melyik szolgáltatáscsoportra választható
- **Nyitvatartás** — naponként kapcsolható, 24 órás legördülővel, élő
  előnézettel amellett
- **Szalon adatai** — név, cím, telefon, e-mail
- **Mentés** — foglalások letöltése JSON vagy Excel-barát CSV formában

### A lényeg: minden módosítás azonnal él a weboldalon

Ha az adminban átírja a nyitvatartást, a publikus oldalon rögtön változik a
villogó jelző, a nyitvatartás-táblázat **és** a foglalóban kiajánlott szabad
időpontok. Ugyanez igaz az árakra, a szolgáltatásokra és a szalon adataira.

### ⚠️ Éles használat előtt olvassa el

A belépés **kizárólag a böngészőben fut**, ezért **nem véd valódi adatot** —
bárki, aki megnyitja a forrást, látja a bemutató jelszót. Ez a verzió
bemutatóra és a folyamatok kipróbálására készült.

Éles üzemhez két dolog kell:

1. **Szerveroldali bejelentkezés** — a jelszóellenőrzés a szerverre kerül
   (munkamenet-süti vagy token), az `admin.html` pedig csak hitelesített
   kéréssel töltődhet be.
2. **Adatbázis** — a foglalások ma a böngésző `localStorage`-ában vannak, ami
   gépenként külön. Több eszközről ugyanazt látni csak közös adatbázissal
   lehet.

Amíg ez nincs meg, az admin oldalt érdemes jelszóval védeni a tárhely
szintjén is (pl. `.htpasswd`), vagy ki sem tenni élesbe.

---

## Fájlok

```
index.html             Főoldal
szolgaltatasok.html    Árlista + csomagok + GYIK
galeria.html           Munkák, szűrővel és nagyítóval
rolunk.html            Történet, értékek, csapat
kapcsolat.html         Elérhetőség, térkép, üzenetküldés
foglalas.html          Időpontfoglaló

admin-belepes.html     Admin belépő
admin.html             Admin vezérlőpult

assets/css/style.css   Publikus oldal stílusai + kurzor
assets/css/admin.css   Admin felület stílusai
assets/js/main.js      Közös scriptek + a szalon adatai
assets/js/booking.js   Foglaló + szolgáltatás- és kollégalista
assets/js/cursor.js    Egyedi kurzor
assets/js/admin.js     Admin vezérlőpult logikája
assets/img/            Ide jönnek a saját fotók
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
