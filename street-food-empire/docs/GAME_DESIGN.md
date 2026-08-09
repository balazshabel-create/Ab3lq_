# Street Food Empire — játékterv

> Ez a dokumentum a játék teljes koncepciója. A számokat a
> [ECONOMY.md](./ECONOMY.md), a monetizációt az
> [ADS_AND_IAP.md](./ADS_AND_IAP.md), a kód felépítését az
> [ARCHITECTURE.md](./ARCHITECTURE.md) részletezi.

---

## 1. A koncepció egy mondatban

Egy rozoga utcai kocsiból építesz világméretű street food birodalmat: ételt
adsz el, a bevételből gépet és embert veszel, ők helyetted dolgoznak, te pedig
új városokba terjeszkedsz — majd az egészet franchise-ba adod, és erősebben
kezded elölről.

### A hurok

```
KÉZI KISZOLGÁLÁS → PÉNZ → SZINTLÉPÉS → MENEDZSER (automatizálás)
      ↑                                        ↓
   FRANCHISE ← ÚJ VÁROS ← GÉPEK, CSAPAT ← TÖBB BEVÉTEL/MP
```

Minden kör kb. egy nagyságrenddel nagyobb számokkal fut le, mint az előző.
Ez az idle műfaj lényege: a **fejlődés érzete** a fontos, nem az abszolút szám.

### Miért ragad meg?

| Horgony | Mechanika | Mikor hat |
|---|---|---|
| Azonnali visszajelzés | Koppintás → pénz → szint 3 mp-en belül | első 30 mp |
| Első automatizálás | Menedzser: „magától megy!” | ~20. mp |
| Nyitott hurok | Mindig látszik a következő mérföldkő | folyamatosan |
| Visszatérési jutalom | Offline bevétel + „amíg zárva voltál…” | minden indításnál |
| Napi horgony | 3 napi küldetés, éjfélkor új | naponta |
| Nagy ugrás | Új város: ×2 globális bevétel | hetente |
| Újrajátszás | Franchise: örök +2%/csillag | ~1 naptól |

---

## 2. Fejlődési rendszer

### 2.1 Termékek (a bevétel forrása)

Városonként **6 termék**. Mindegyik:

- **szintezhető** — a szint lineárisan növeli a bevételt, az ár mértani sorban nő,
- **ciklusban termel** — a ciklus végén fizet (1 mp-től 30 mp-ig),
- **automatizálható** — menedzserrel magától fut, és **offline is termel**.

**Mérföldkövek** minden terméknél: 10 / 25 / 50 / 100 / 200 / 300 / 400 / 500
szinten, majd 500 fölött századonként. Van, amelyik a bevételt szorozza
(×2, ×3, ×4), van, amelyik a ciklusidőt felezi. Ez adja a „még 3 szint és
duplázok” érzést, ami a legerősebb rövid távú motiváció.

### 2.2 Kézi kiszolgálás — és a korlátja

Egy koppintás egy teljes adagot ad el. **De a termék ezután egy teljes
ciklusidőn át nem szolgálható ki újra**, és automatizált terméket a koppintás
egyáltalán nem érint.

Ez nem apró részlet, hanem a gazdaság legfontosabb védelme:

```
kézi bevétel  ≤  automatizált bevétel × koppintás-szorzó   (a szorzó < 7×)
```

Enélkül egy 30 másodperces ciklusú terméknél a gyors koppintgatás
másodpercenként több teljes ciklust fizetne ki — két nagyságrenddel verve az
automatizálást. (A projekt balance-szimulátora pontosan ezt a hibát találta
meg: az eredeti szabállyal a teljes játék 50 másodperc alatt kijátszható volt.)

### 2.3 Gépek

9 gép, egyenként 6–12 szinttel. Minden szint **abszolút** értéket ad, nem
halmozódik — a UI-ban mindig egyetlen szám látszik.

| Gép | Hatás |
|---|---|
| Grillfelület / Fritőz / Kemence / Hűtőpult / Cukrászvitrin | ×1,4^szint az adott **kategória** bevételére |
| Pénztárgép | ×1,22^szint **minden** termékre |
| Raktár | +1,5 óra / szint offline sapka |
| Éjszakai műszak | +6% / szint offline arány |
| Kiszolgálópult | ×1,12^szint kézi kiszolgálás (szándékosan kicsi — lásd 2.2) |

### 2.4 Csapat

- **Menedzser** — termékenkénti egyszeri vásárlás. A játék legfontosabb
  vétele: enélkül nincs offline bevétel.
- **Séf** — +3% globális bevétel / szint (max 50)
- **Futár** — +2% offline arány / szint (max 25)
- **Pénztáros** — +2% kézi kiszolgálás / szint (max 40)
- **Marketinges** — +5% Food Coin találat / szint (max 20)

Nincs bér és nincs fenntartási költség: a negatív cashflow frusztráló, és
szembemegy azzal, hogy az idle játékot bezárva is jó legyen otthagyni.

### 2.5 Városok

6 város, mindegyik saját 6 termékkel, saját nevekkel és színvilággal.
Minden megnyitott város **×2 globális bevételt** ad, és a termékei
nagyságrendekkel jobb bevétel/ár aránnyal indulnak.

| # | Város | Hangulat |
|---|---|---|
| 1 | Budapest | Egy kocsi, egy rezsó, egy álom. |
| 2 | Prága | Kürtős illat a macskaköveken. |
| 3 | Berlin | Éjjel-nappal nyitva, mindig sor áll. |
| 4 | Isztambul | Fűszerpiac és parázs a Boszporusznál. |
| 5 | Bangkok | Wok-tűz és neonfény éjfél után. |
| 6 | New York | A sarki kocsiból lett birodalom. |

### 2.6 Franchise (presztízs)

Az újrakezdés a hosszú távú tartalom. Elvész: készpénz, termékek, menedzserek,
gépek, csapat, városok. **Megmarad**: Arany Merőkanál csillagok, achievementek,
Food Coin, kinézetek, minden vásárlás.

- Csillag = `(futásban keresett pénz / 4e13) ^ 0,25`
- Minden csillag **+2% globális bevétel, örökre**
- Csillagküszöbökhöz kötött perkfa (10 perk) — a perk **nem költi el** a
  csillagot, csak küszöbként használja. Nincs „elrontottam a buildet” érzés.

---

## 3. Az első hét íve

A `npm run balance` szimulátor mérése (reklám és vásárlás nélküli játékos,
15 perc aktív koppintás után tiszta idle):

| Idő | Esemény |
|---|---|
| 20 mp | első menedzser |
| 15 perc | 2. város (Prága) |
| ~19 óra | első franchise elérhető |
| 1 nap 18 óra | 3. város (Berlin) |
| 5 nap | 4. város (Isztambul) |
| 12 nap | 5. város (Bangkok) |
| 30+ nap | 6. város (New York) |

Ez tudatos: az első óra sűrű (megtanulja a hurkot), utána a lépcsők
nagyjából ötszöröződnek, a franchise pedig újra sűrűvé teszi az elejét.

---

## 4. Napi tartalom

### Napi küldetések
Naponta 3, a nap dátumából **determinisztikusan** sorsolva — nincs szerver, és
nem lehet újrapörgetni az app újraindításával. Éjfélkor frissül.
Jutalom: Food Coin + az összes teljesítéséért bónusz.

### Achievementek
27 db, franchise után is megmaradnak, és mindegyik **tartós** globális
bevételbónuszt ad (összesen +2,04, azaz ×3,04, ha mind megvan).

### Időszakos események
A készülék helyi dátumából számolva, **hálózat nélkül**:

| Esemény | Mikor | Hatás |
|---|---|---|
| Hétvégi roham | szombat–vasárnap | ×2 bevétel |
| Éjjeli piac | szerda | ciklusidő −50% |
| Fizetésnapi hangulat | 10. és 25. | ×3 bevétel |
| Utcazenei fesztivál | 1. | +25% offline arány, +4 óra sapka |

Ismétlődő szabályok, nem fix dátumok — így a tartalom soha nem „jár le”.

---

## 5. Offline progress

Az idle játék legfontosabb rendszere: ez adja az okot a visszatérésre.

- **Csak automatizált termékek** termelnek offline
- Az online bevétel **50%-a** (futárral és éjszakai műszakkal növelhető, max 100%)
- **4 órás sapka** alapból, raktárral / perkkel / Aranypulttal max 24 óráig
- Visszatéréskor felugró ablak: mennyit kerestél, és mennyi ideig
- **×2 jutalomvideóért** — opcionálisan, ugyanolyan hangsúlyos „sima felvétel” gombbal
- 1 percnél rövidebb távollétnél csendben jóváírjuk, nem zavarunk ablakkal

### Óracsalás elleni védelem

Offline játéknál kliensoldalon nem lehet tökéletes védelmet építeni, de a
triviális trükköt megfogjuk két, egymást kiegészítő mechanizmussal:

1. **Monoton óra** (`performance.now`) — nem állítható át, amíg az app fut.
2. **Magas vízszint** — a mentés eltárolja a valaha látott legnagyobb fali óra
   értéket. Ha a játékos visszaállítja az órát, a különbség negatív lesz → 0
   másodperc jár, és amíg vissza nem éri a vízszintet, nem termel offline.

Az órát előre állítani pedig a sapka miatt nem éri meg: egyszerre legfeljebb
a maximális offline idő nyerhető.

---

## 6. Képernyők

| Képernyő | Mit tartalmaz |
|---|---|
| **Stand** (fő) | város, vásárlási mennyiség (×1/×10/×100/MAX), 3 jutalomgomb, 6 termékkártya |
| **Gépek** | 9 gép, jelenlegi és következő szint hatásával |
| **Csapat** | automatizálási arány, menedzser nélküli termékek, 4 szerepkör |
| **Városok** | 6 város + franchise-panel + perkfa |
| **Küldetés** | élő esemény, 3 napi küldetés, 27 achievement |
| **Bolt** | Food Coin ajánlatok → kinézetek → IAP → vásárlások visszaállítása |
| **Beállítások** | hang, rezgés, csökkentett animáció, személyre szabott reklám, statisztika, adattörlés |

Állandó elemek: **fejléc** (pénz, bevétel/mp, Food Coin, csillag), **booster-sáv**
(csak ha van aktív), **alsó fülsor** (jelzőpöttyel, ha valahol jutalom vár).

Modálisok: offline bevétel → jutalom (láda/booster) → új achievement. Egyszerre
mindig csak egy, hogy indításkor ne legyen ablak-torlódás.

### UI-elvek

- Minden interaktív elem **legalább 48×48 pt**
- Sötét alap: este játsszák, és OLED-en kevesebbet fogyaszt
- Fix szélességű számjegyek a pénznél — nem ugrál a kijelző
- Saját SVG-ikonkészlet, nulla bitmap asset
- A rendszer betűméretét tiszteletben tartjuk (1,35× plafonnal)
- Minden gombnak van `accessibilityLabel`-je

---

## 7. Monetizáció dióhéjban

Részletek: [ADS_AND_IAP.md](./ADS_AND_IAP.md)

**Jutalomvideók** (mindig opcionális, mindig a játékos indítja): dupla bevétel
15 percre, turbó 10 percre, ingyen láda, dupla offline bevétel.

**Interstitial**: csak természetes szünetnél (városnyitás, franchise), legalább
8 jelentős esemény után, 3 perces szünettel, indulás után 2 percig soha,
naponta max 12. Reklámmentesség vásárlásával teljesen kikapcsol — **és a
jutalomvideós bónuszok videó nélkül is járnak**, hogy a fizető játékos ne
járjon rosszabbul.

**Food Coin** (prémium valuta): küldetésből, achievementből, ládából ingyen is
gyűjthető. Ebből vehető: időugrás, csúcsforgalom booster, azonnali menedzser,
kinézetek.

**IAP**: reklámmentesség, kezdőcsomag, Aranypult, 4 érmecsomag. Nincs
előfizetés, nincs loot box valódi pénzért, nincs multiplayer → **pay-to-win
elvi lehetősége sincs**.

---

## 8. Amit tudatosan NEM csinálunk

| Nem | Miért |
|---|---|
| Energia / élet rendszer | A műfaj lényege, hogy bármikor játszható |
| Alkalmazotti bér, negatív cashflow | Büntetné a kilépést |
| Kényszerített reklám akció után | A store-ok is szankcionálják, és rombolja a retenciót |
| Multiplayer ranglista | Ez tenné pay-to-win-né a boltot |
| Kizárólag fizetős tartalom | Minden megszerezhető játékkal is |
| Szerverfüggő alapjátékmenet | Offline-first: repülőn is működik |
