# Valódi fotók ide

Alapból az oldal minden képet vektorosan, futásidőben rajzol (`assets/js/art.js`),
így nincs külső képfüggőség. Ha vannak valódi fotóid, itt tudod bekapcsolni őket.

## Hogyan

1. Másold ide a képeket **a tétel azonosítójával** elnevezve:

   ```
   assets/img/p-margherita.jpg      ← Margherita pizza
   assets/img/p-diavola.jpg         ← Diavola
   assets/img/t-carbonara.jpg       ← Spaghetti Carbonara
   assets/img/galeria/g1.jpg        ← galéria 1. képe (A kemence)
   assets/img/galeria/g5.jpg        ← galéria 5. képe (Este a bisztróban)
   ```

   Az azonosítókat az `assets/js/data.js` fájlban találod (`id:` mezők).

2. Kapcsold be a fotós módot — vagy az **Admin → Beállítások → Valódi fotók**
   kapcsolóval, vagy a `data.js` fájlban:

   ```js
   photos: { enabled: true, … }
   ```

3. Kész. Amelyik tételhez nincs fájl, ott automatikusan marad a rajzolt
   illusztráció — nem lesz tört kép sehol.

## Ajánlott méretek

| Hol | Méret | Arány |
|---|---|---|
| Étlap tételek | 600 × 600 px | 1:1 |
| Galéria | 1200 × 900 px | 4:3 |

JPG vagy WebP, 200 kB alatt. Ha WebP-t használsz, írd át az `ext` mezőt
`data.js`-ben `.webp`-re.

## Egyedi kép egy tételhez

Ha csak néhány képet cserélnél, nem kell a fotós mód: az
**Admin → Étlap → Szerkesztés** ablakban bármelyik tételhez megadhatsz
közvetlen kép-URL-t. Az mindig erősebb, mint a fenti automatikus útvonal.
