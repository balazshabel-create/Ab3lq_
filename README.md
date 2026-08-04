# Basilico Bistro — pizzéria weboldal sablon

Teljes, eladásra kész weboldal egy pizzériának. Hét nyilvános oldal + admin felület,
tiszta HTML/CSS/JS — **nincs build lépés, nincs npm, nincs külső könyvtár**.
Feltöltöd bárhová (tárhely, Netlify, Vercel, GitHub Pages), és megy.

---

## Mit tud

### Nyilvános oldalak

| Oldal | Fájl | Tartalom |
|---|---|---|
| Főoldal | `index.html` | Animált hero, futósáv, akciók, top pizzák, folyamat, számlálók, történet, galéria-előnézet, vélemény-karusszel, nyitvatartás, hírlevél |
| Étlap | `etlap.html` | 45 tétel, kereső, kategória- és címkeszűrő, 32/40 cm árváltó, rendezés, allergének, **pizzaépítő** |
| Galéria | `galeria.html` | Masonry elrendezés, kategóriaszűrő, fénydoboz billentyűzet-navigációval, automata diavetítés |
| Asztalfoglalás | `foglalas.html` | 4 lépéses varázsló, élő szabad-idősávok, **kattintható asztaltérkép**, visszaigazoló kód, konfetti |
| Rólunk | `rolunk.html` | Történet, idővonal, értékek, csapat, kemence, díjak |
| Kapcsolat | `kapcsolat.html` | Elérhetőségek, térkép, üzenetküldés (az admin postaládájába), GYIK harmonika |
| Profil | `profil.html` | Hűségpont + szint, pecsétkártya, rendeléstörténet, kedvencek, foglalások, ízprofil-diagram, személyre szabott ajánlások, beállítások |
| Admin | `admin.html` | Belépés, vezérlőpult diagramokkal, foglaláskezelés, postaláda, étlapszerkesztő, nyitvatartás, mentés/visszatöltés |

### Kiemelt funkciók

- **Élő nyitva/zárva jelző villogó pöttyel.** Valós időben számol a nyitvatartásból,
  30 másodpercenként frissül. Négy állapot: nyitva (zöld), hamarosan nyit (sárga),
  hamarosan zár (sárga, gyorsabb villogás), zárva (piros). Kiírja azt is, hány perc van hátra.
- **Egyedi kurzor.** Késleltetve követő gyűrű + pont, felirat interaktív elemeken,
  szövegkurzor beviteli mezőknél, mágneses gombok. Érintőképernyőn automatikusan kikapcsol.
- **Pizzaépítő.** 30 feltét, 4 alap, 4 tésztafajta, 3 méret — a rajz és az ár azonnal frissül.
  „Lepj meg!" gomb véletlen kombinációhoz.
- **Asztaltérkép.** SVG alaprajz; a foglalt és a túl kicsi asztalok automatikusan kiesnek.
- **Kosár** oldalsó fiókkal, mennyiségkezeléssel, szállítási díj számítással.
- **Sötét / világos téma**, mentett beállítással.
- **Animációk**: előtöltő, görgetés-felfedés, betűnkénti címanimáció, számlálók, parallax,
  3D kártyadőlés, konfetti, futósávok, gőz, lebegő elemek.
- **Húsvéti tojás**: gépeld be, hogy `pizza`, majd hogy `basil`.
- **Gyorsbillentyűk**: `/` kereső, `Ctrl/⌘+K` kosár, `T` témaváltás.
- Teljes akadálymentesítési alap: billentyűzet-navigáció, ARIA feliratok, `prefers-reduced-motion`,
  ugrás a tartalomra link, fókuszjelölés.

---

## Indítás

Nincs telepítés. Két lehetőség:

```bash
# 1) Egyszerűen nyisd meg
open index.html

# 2) Vagy indíts helyi szervert (ajánlott)
npx http-server -p 8080
# majd: http://localhost:8080
```

**Admin belépés (demó):** `admin` / `basilico2026`

---

## Fájlszerkezet

```
.
├── index.html            Főoldal
├── etlap.html            Étlap + pizzaépítő
├── galeria.html          Galéria
├── foglalas.html         Asztalfoglalás
├── rolunk.html           Rólunk
├── kapcsolat.html        Kapcsolat + GYIK
├── profil.html           Vendégprofil
├── admin.html            Admin felület
└── assets/
    ├── css/
    │   ├── base.css        Design tokenek, reset, tipográfia, animációk
    │   ├── components.css  Kurzor, navigáció, gombok, kártyák, űrlapok, modális, kosár, lábléc
    │   └── pages.css       Oldalspecifikus elrendezések
    └── js/
        ├── art.js          Procedurális SVG grafikamotor (pizzák, jelenetek, ikonok, diagramok)
        ├── data.js         MINDEN TARTALOM — ezt írd át ügyfélre szabáskor
        ├── store.js        Adatréteg (localStorage) + nyitvatartás-logika
        ├── ui.js           Közös héj: fejléc, lábléc, kurzor, animációk, kosár, értesítések
        ├── pages.js        Oldalankénti logika
        └── admin.js        Admin felület
```

---

## Testreszabás

### 1. Tartalom — `assets/js/data.js`

Gyakorlatilag minden szöveg, ár és adat itt van egy helyen:

```js
brand:      { name, tagline, address, phone, email, … }   // étterem alapadatok
hours:      { 0..6 }                                       // nyitvatartás (null = zárva)
exceptions: [ { date, closed, note } ]                     // ünnepnapok
menu:       [ … ]                                          // az étlap tételei
builder:    { bases, doughs, sizes, items }                // pizzaépítő alapanyagai
gallery, team, timeline, reviews, faq, tables, slots, promos
admin:      { user, pass }                                 // demó belépés
```

### 2. Színek — `assets/css/base.css`

A `:root` blokkban minden szín CSS-változó. Márkaváltáshoz elég ezt a néhány sort átírni:

```css
--basil: #4C9A5C;   /* elsődleges */
--tomato: #E0503F;  /* kiemelés */
--gold: #E9B44C;    /* dekoráció */
```

A világos témát a `[data-theme='light']` blokk kezeli.

### 3. Képek

Alapból **nincs egyetlen külső kép sem** — minden illusztráció futásidőben, SVG-ként generálódik
(`art.js`). Ezért az oldal azonnal betölt, offline is működik, és nincs licencgond.

#### Valódi fotók bekapcsolása (nem kell kódot írni)

1. Másold a képeket az `assets/img/` mappába **a tétel azonosítójával** elnevezve
   (az azonosítókat a `data.js` `id:` mezői adják):

   ```
   assets/img/p-margherita.jpg      ← Margherita
   assets/img/p-diavola.jpg         ← Diavola
   assets/img/galeria/g1.jpg        ← galéria 1. kép
   ```

2. Kapcsold be: **Admin → Beállítások → Valódi fotók**, vagy `data.js`-ben
   `photos: { enabled: true }`.

Ennyi. Részletek és ajánlott méretek: `assets/img/README.md`.

#### Hogyan viselkedik

A rajzolt illusztráció **mindig** kirenderelődik, tehát azonnal látszik valami. Ha van fotó és
sikerül betöltenie, finoman ráúszik. Ha a fájl hiányzik, egyszerűen nem jelenik meg semmi extra —
nincs tört kép, nincs üres doboz, nincs elcsúszó elrendezés. Így a tételek egy részéhez is
tehetsz fotót, a többi marad rajzolt.

Egyedi kép egy tételhez (felülírja a fentit, fotós mód nélkül is működik): add meg a `photo`
mezőt a `data.js`-ben, vagy írd be az URL-t az **Admin → Étlap → Szerkesztés** ablakban.

```js
{ id: 'p-margherita', name: 'Margherita', photo: 'https://…/margherita.jpg', … }
```

---

## Éles üzembe helyezés

Ez a csomag **statikus, kliensoldali demó**. Mielőtt valódi forgalmat kap:

1. **Admin hitelesítés.** A belépés jelenleg a böngészőben ellenőrződik (`data.js` → `admin`),
   ami bárki számára olvasható. Cseréld valódi, szerveroldali bejelentkezésre.
2. **Adattárolás.** Minden a `localStorage`-ban él, tehát böngészőnként külön. Ha több gépről
   kell látni ugyanazokat a foglalásokat, írd át a `store.js` `read()` / `write()` függvényeit
   API-hívásokra — a kód többi része változatlan maradhat, mert minden ezen a két függvényen megy át.
3. **E-mail.** A foglalás-visszaigazolás és a kapcsolati űrlap küldése jelenleg szimulált.
   Kösd be egy levelezőszolgáltatáshoz (pl. Resend, Postmark, SMTP).
4. **Térkép.** A `kapcsolat.html` illusztratív SVG térképet mutat. Valódi beágyazáshoz cseréld
   a `#map` tartalmát egy Google Maps / OpenStreetMap iframe-re.
5. **Fizetés.** A kosár „Rendelés véglegesítése" gombja összesítőt mutat. Fizetéshez
   integrálj egy szolgáltatót (pl. Stripe, Barion, SimplePay).

---

## Böngészőtámogatás

Chrome, Edge, Firefox, Safari (utolsó 2 főverzió). Mobil: iOS Safari, Chrome Android.
Az egyedi kurzor érintőképernyőn automatikusan kikapcsol.

Használt modern CSS: `color-mix()`, `aspect-ratio`, `backdrop-filter`, `overflow: clip`, CSS grid/flexbox,
`grid-template-rows` átmenet a harmonikákhoz. Ezeket minden támogatott böngésző ismeri.

---

## Licenc / átadás

A kód és a generált grafikák szabadon felhasználhatók az ügyfélprojektekben.
Külső betűtípus: Google Fonts (Playfair Display, Inter, Caveat) — ha teljesen offline
működésre van szükség, töltsd le őket az `assets/fonts` mappába, és cseréld a
`base.css` tetején lévő `@import` sort helyi `@font-face` szabályokra.
