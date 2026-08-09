# Gazdasági rendszer és balance

Minden szám, ami itt szerepel, a kódban **egyetlen helyen** van:
`src/config/gameConfig.ts` (globális szabályok) és `src/game/content/*`
(tartalmi elemek). Kódot nem kell módosítani a hangoláshoz.

Az ütemezést a `npm run balance` szimulátor méri — nem becsléssel, hanem
végigjátszással.

---

## 1. Alapképletek

### Termékszint ára

```
ár(n) = baseCost × 1,07ⁿ            n = a már megvett szintek száma
```

`n` szint ára `f`-től zárt alakban (mértani sor) — ez azért kell, hogy a
„MAX” gomb késői játékban tízezer szintet is meg tudjon venni anélkül, hogy
a UI megakadna:

```
ár(f, n) = baseCost × 1,07^f × (1,07ⁿ − 1) / 0,07
```

Az ebből visszafejtett „hány szintre futja” szintén zárt alakú:

```
n = ⌊ log(cash × 0,07 / (baseCost × 1,07^f) + 1) / log 1,07 ⌋
```

### Bevétel

```
ciklusbevétel = baseRevenue × szint × mérföldkő × termékszorzó × globális szorzó
ciklusidő     = baseCycleSeconds × mérföldkő-sebesség × ciklusszorzó
bevétel/mp    = ciklusbevétel / ciklusidő
```

### A legfontosabb invariáns

**A költség gyorsabban nő, mint a bevétel.** A szint ára `1,07ⁿ` szerint nő,
a bevétel viszont csak lineárisan a szinttel × a mérföldkövek `2^(n/100)`
ütemével — vagyis nagyjából `1,007ⁿ`. A kettő hányadosa `1,062ⁿ`, azaz a
következő szint mindig valamivel drágább „bevétel-egységenként”.

Ha ez megfordulna, a játék önmagát oldaná meg, és percek alatt elfogyna.
Ezt teszt őrzi (`__tests__/economy.test.ts` → „a költség gyorsabban nő”).

---

## 2. A 6 terméksáv (1. város)

| # | Termék | Alapár | Ciklus | Ciklusbevétel | Bevétel/mp (1. szint) |
|---|---|---|---|---|---|
| 1 | Bécsi virsli | 5 Ft | 1,0 mp | 1 | 1,0 |
| 2 | Sült krumpli tölcsér | 70 Ft | 2,0 mp | 7 | 3,5 |
| 3 | Lángos | 980 Ft | 4,0 mp | 52 | 13 |
| 4 | Gyros tekercs | 13 700 Ft | 8,0 mp | 375 | 47 |
| 5 | Bodzás limonádé | 192 000 Ft | 15 mp | 2 550 | 170 |
| 6 | Kürtőskalács | 2 690 000 Ft | 30 mp | 18 300 | 610 |

Két arány határozza meg az egészet:

- szomszédos termékek **ára ×14**
- szomszédos termékek **bevétel/mp-je ×3,6**

Mivel az ár gyorsabban nő, egy új termék 1. szintje *kevésbé* hatékony, mint a
régi termék következő szintje — egészen addig, amíg a régi terméknél az
`1,07ⁿ` árgörbe utol nem éri. A váltás nagyjából a 39. szint körül történik
(`1,07³⁹ ≈ 14`), és pont ez adja a „mindig van mit venni” érzést. Nem kell
hozzá mesterséges zár.

**Megtérülési idő 1. szinten**: 5 mp → 19 mp → 76 mp → 5 perc → 19 perc → 74 perc.

---

## 3. Mérföldkövek

| Szint | Hatás | Halmozott bevételszorzó |
|---|---|---|
| 10 | ×2 bevétel | ×2 |
| 25 | ×2 bevétel | ×4 |
| 50 | ciklusidő ×0,5 | ×8 effektíven |
| 100 | ×3 bevétel | ×24 |
| 200 | ciklusidő ×0,5 | ×48 |
| 300 | ×3 bevétel | ×144 |
| 400 | ×4 bevétel | ×576 |
| 500 | ciklusidő ×0,5 | ×1 152 |
| 600, 700, 800… | ×2 bevétel | ×2 századonként |

A ciklusidőnek van alsó határa (0,05 mp). 0,25 mp alatt a játék **folyamatos
módra** vált: nem rajzol ciklusanimációt, hanem egyenletesen ír jóvá. Ez a
késői játék legnagyobb CPU-megtakarítása.

---

## 4. Városok

```
termékár     ×5e4    városonként
termékbevétel ×1,5e5 városonként      → 3× jobb bevétel/ár arány
globális szorzó ×2    minden megnyitott városért
```

### Feloldási ár

```
unlockCost(c) = 2,5e6 × 1,5e6^(c−2)
```

| Város | Ár | Kell hozzá (összbevétel) |
|---|---|---|
| Prága | 2,5 M | 5 M |
| Berlin | 3,75 B | 7,5 B |
| Isztambul | 5,6 T | 11 T |
| Bangkok | 8,4 ac | 17 ac |
| New York | 1,3 af | 2,5 af |

**Miért 1,5e6 a lépés?** Mert a bevétel városonként `1,5e5 × 2 = 3e5`-ször nő.
Ha a feloldási ár ennél lassabban nőne, minden újabb város *gyorsabban* nyílna
meg, mint az előző, és a teljes térkép percek alatt elfogyna — pontosan ez
történt az első hangolásnál. `1,5e6 / 3e5 = 5`, tehát minden város nagyjából
ötször annyi ideig tart, mint az előző.

---

## 5. Kézi kiszolgálás korlátja

Ez a rendszer legkényesebb pontja, ezért külön kiemelve.

Egy koppintás egy **teljes ciklust** ad el. Ha ez időköltség nélkül lenne
elérhető, egy 30 másodperces ciklusú terméknél másodpercenként 3 koppintás
= 90× az automatizált bevétel — a koppintás-szorzókkal együtt több tízezerszeres.

**A szabály**: koppintás után a termék egy teljes ciklusidőn át nem szolgálható
ki újra (`ProductState.nextServeAt`), és automatizált termék a koppintást
figyelmen kívül hagyja. Ebből:

```
kézi bevétel/mp  ≤  automatizált bevétel/mp × koppintás-szorzó
```

Ezért kell a koppintás-szorzót kicsin tartani:

| Forrás | Maximum |
|---|---|
| Kiszolgálópult (8 szint, ×1,12/szint) | ×2,48 |
| Pénztáros (40 szint, +2%/szint) | ×1,80 |
| „Gyors kezek” perk | ×1,50 |
| **Együtt** | **≈ ×6,7** |

Tehát az aktív koppintgatás legfeljebb ~6,7-szeresét hozza az automatizálásnak
egyetlen terméken — érdemi, de nem játékrontó. Ezt három teszt őrzi
(`__tests__/actions.test.ts`).

---

## 6. Franchise

```
csillag = ⌊ (futásban keresett pénz / 4e13) ^ 0,25 ⌋      küszöb: 1e20
bónusz  = +2% globális bevétel csillagonként, örökre
```

| Futásbevétel | Csillag | Bónusz |
|---|---|---|
| 1e20 | 40 | +80% |
| 1e24 | 400 | ×9 |
| 1e26 | 1 265 | ×26 |
| 1e30 | 12 650 | ×254 |

**Miért negyedik gyök és nem négyzetgyök?** Mert a bevétel a játék során
1e20-tól 1e30-ig terjed. Négyzetgyökkel 1e30-nál tízmilliós csillagszám jönne
ki (×200 000 bónusz), ami értelmetlenné tenné a további fejlesztéseket. A
negyedik gyök végig kezelhető marad. Ezt is teszt őrzi.

**Miért 1e20 a küszöb?** Mert így az első franchise kb. 19 óra játék után
válik elérhetővé. Ha alacsonyabb lenne, a játékos azelőtt nyomná meg, hogy
megértené, mit veszít vele — ez az egyik leggyakoribb oka annak, hogy valaki
otthagy egy idle játékot.

---

## 7. Offline bevétel

```
offline bevétel = automatizált bevétel/mp × arány × min(távollét, sapka)
```

| Paraméter | Alap | Maximum | Növelő |
|---|---|---|---|
| Arány | 50% | 100% | Éjszakai műszak (+6%/szint), Futár (+2%/szint), perkek |
| Sapka | 4 óra | 24 óra | Raktár (+1,5 ó/szint), perkek, Aranypult (×2) |

Reklámmal vagy Food Coinnal ×2 — **utólag**, a visszatérési ablakban, tehát a
játékos dönt, nem kényszerítjük.

---

## 8. Food Coin gazdaság

### Bevételi oldal (fizetés nélkül)

| Forrás | Mennyi | Milyen gyakran |
|---|---|---|
| Napi küldetés | 10–15 × 3 | naponta |
| Összes napi küldetés | +25 | naponta |
| Achievement | 10–120 | egyszer / darab |
| Láda | 3–12 | 30 percenként, napi 6 |
| Induló | 25 | egyszer |

Aktív játékos napi ~**80–120 Food Coin** fizetés nélkül.

### Költési oldal

| Tétel | Ár | Megjegyzés |
|---|---|---|
| 2 óra bevétel | 80 | |
| 8 óra bevétel | 272 | mennyiségi kedvezmény |
| Csúcsforgalom (×4, 30 perc) | 60 | |
| Azonnali menedzser | 75 | |
| Kinézet | 150 | tisztán vizuális |

Vagyis egy ingyenes játékos naponta megengedhet magának egy nagyobb és egy
kisebb tételt. Ez tudatos: a prémium valuta legyen érezhető, de ne tűnjön
elérhetetlennek fizetés nélkül.

---

## 9. Hangolás gyakorlatban

```bash
npm run balance     # végigjátssza 30 napot és kiírja a mérföldköveket
npm test            # 109 teszt: gazdaság, offline, mentés, reklámszabályok
```

A balance-szimulátor egészség-ellenőrzései (ezek **bukhatnak**, ha elrontod a
hangolást):

- az első menedzser 10 percen belül megvan
- a 2. város az első napon megnyílik
- az első franchise 1–7 nap között érhető el
- az első futás legalább 3 napig tart
- minden szám véges marad
- a szimuláció nem akad meg

### Tipikus hangolási igények

| Cél | Mit állíts |
|---|---|
| Lassabb korai játék | `products.ts` → `PRODUCT_SLOTS` alapárak fel |
| Gyorsabb városnyitás | `cities.ts` → `UNLOCK_STEP` le |
| Hosszabb első futás | `UNLOCK_STEP` fel |
| Korábbi franchise | `gameConfig.franchise.minLifetimeToUnlock` le |
| Nagyvonalúbb offline | `gameConfig.offline.baseRate` / `baseCapHours` fel |
| Több Food Coin | `gameConfig.coins.*` fel |
