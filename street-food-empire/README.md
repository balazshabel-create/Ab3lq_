# 🌭 Street Food Empire

Mobil idle/tycoon játék: egy rozoga utcai kocsiból építesz világméretű street
food birodalmat. Egy közös kódbázis **Androidra és iOS-re**, offline-first
működéssel, felkészítve az AdMob és az in-app purchase integrációra.

**Teljesen saját tartalom**: saját grafika (kódból generált ikonok és SVG-k),
saját nevek, saját gazdaság. Nincs benne egyetlen külső asset sem.

---

## Gyors indulás

```bash
cd street-food-empire
npm install
npm start
```

Nyisd meg **Expo Go**-ban (QR-kód). A játék így azonnal, teljes funkcionalitással
játszható — a reklám és a vásárlás mock szolgáltatóra esik vissza, mert azok
natív modulok. Lásd [docs/ADS_AND_IAP.md](docs/ADS_AND_IAP.md).

```bash
npm run typecheck   # TypeScript ellenőrzés
npm test            # 109 teszt
npm run balance     # végigjátssza 30 napot és kiírja az ütemezést
npm run assets      # ikon + splash újragenerálása a márkaszínekből
```

---

## Mi van kész

| Rendszer | Állapot |
|---|---|
| Gazdaság (6 város × 6 termék, mérföldkövek, zárt alakú árképletek) | ✅ |
| Kézi kiszolgálás korláttal (nem kijátszható) | ✅ |
| Menedzserek / automatizálás | ✅ |
| 9 gép, 4 szerepkör | ✅ |
| Offline bevétel + óracsalás-védelem | ✅ |
| Franchise (presztízs) + 10 perkes fa | ✅ |
| Napi küldetések, 27 achievement, időszakos események | ✅ |
| Mentés: checksum, backup, migrációs lánc | ✅ |
| Reklám-absztrakció + teljes házirend | ✅ |
| IAP-absztrakció + biztonságos kézbesítési sorrend | ✅ |
| 7 képernyő, saját UI-készlet, SVG-ikonok | ✅ |
| Hibahatár, hibakezelés mindenhol | ✅ |
| 109 teszt + balance-szimulátor | ✅ |
| AdMob / react-native-iap natív bekötés | ⏳ 2 parancs + a kulcsaid |
| Hang, push, felhőmentés, több nyelv | ⏳ előkészítve |

---

## Dokumentáció

| Dokumentum | Miről szól |
|---|---|
| [GAME_DESIGN.md](docs/GAME_DESIGN.md) | teljes koncepció, fejlődés, képernyők, az első hét íve |
| [ECONOMY.md](docs/ECONOMY.md) | minden képlet és szám, és hogy miért pont az |
| [ADS_AND_IAP.md](docs/ADS_AND_IAP.md) | reklám-házirend, SKU-k, élesítés lépésről lépésre |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | kódfelépítés, állapotkezelés, mentés, teljesítmény |
| [RELEASE.md](docs/RELEASE.md) | Play Console és App Store Connect végigvezetés |

---

## A hurok

```
KÉZI KISZOLGÁLÁS → PÉNZ → SZINTLÉPÉS → MENEDZSER (automatizálás)
      ↑                                        ↓
   FRANCHISE ← ÚJ VÁROS ← GÉPEK, CSAPAT ← TÖBB BEVÉTEL/MP
```

Az ütemezés a `npm run balance` szimulátor mérése alapján (reklám és vásárlás
nélküli játékos):

| Idő | Esemény |
|---|---|
| 20 mp | első menedzser |
| 15 perc | 2. város |
| ~19 óra | első franchise elérhető |
| 1 nap 18 óra | 3. város |
| 5 nap | 4. város |
| 12 nap | 5. város |

---

## Technológia

- **Expo SDK 57** / React Native 0.86 / React 19.2 / TypeScript 5.9 (strict)
- **zustand** állapotkezelés — a game loop nem allokál és nem rajzol újra fát
- **react-native-svg** — minden ikon kódból, nulla bitmap asset
- **AsyncStorage** — versenyzett mentés checksummal és biztonsági másolattal
- **jest** — 109 teszt a gazdaságra, offline logikára, mentésre, reklámszabályokra

---

## Élesítés dióhéjban

```bash
npx expo install react-native-google-mobile-ads react-native-iap
# app.config.ts → vedd ki a két plugint a kommentből
# .env → töltsd ki az AdMob azonosítókat (.env.example alapján)
npx expo prebuild --clean
eas build --profile production --platform android
```

Részletesen: [docs/ADS_AND_IAP.md](docs/ADS_AND_IAP.md) és
[docs/RELEASE.md](docs/RELEASE.md).

> ⚠️ A `com.streetfoodempire.game` csomagnév **helyőrző**. Élesítés előtt
> cseréld a sajátodra — a store-ban egyedi, és később nem változtatható.

---

## Licenc

Privát projekt. A benne lévő grafika, nevek és gazdasági rendszer saját
tartalom.
