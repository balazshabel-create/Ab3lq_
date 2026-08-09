# Architektúra

## 1. Vezérelvek

| Elv | Következmény |
|---|---|
| **Offline-first** | Hálózat nélkül minden működik. Egyetlen opcionális online funkció sincs az alapjátékmenetben. |
| **Tiszta mag** | A gazdaság matematikája mellékhatás nélküli függvényekben van → tesztelhető, és az offline számítás pontosan ugyanazt a kódot használja, mint az online tick. |
| **Egy igazság** | A kijelzett bevétel és a ténylegesen jóváírt bevétel ugyanabból a `Multipliers` objektumból jön. Nem tud szétcsúszni. |
| **Sose dobjunk** | Minden natív, tárolási és hálózati hívás hibája `Result`-ként vagy naplóként jelenik meg. A játék nem fagyhat ki mentési hibától. |
| **Sose veszítsünk mentést** | Checksum + biztonsági másolat + séma-helyreállítás. |
| **Cserélhető szolgáltatók** | Reklám és vásárlás interfész mögött → Expo Go-ban mock fut, éles buildben a valódi SDK. |

---

## 2. Mappaszerkezet

```
src/
├── App.tsx                 gyökér: betöltés, hibahatár, navigáció
├── config/
│   └── gameConfig.ts       MINDEN globális balance-szám egy helyen
├── core/                   játékfüggetlen segédek
│   ├── env.ts              __DEV__ biztonságos elérése (Node alatt is)
│   ├── format.ts           szám- és időformázás (E, M, Mrd, B… aa, ab…)
│   ├── clock.ts            időforrás + óracsalás-védelem
│   ├── rng.ts              determinisztikus mulberry32
│   └── logger.ts           szintezett napló + crash-sink
├── game/
│   ├── types.ts            a teljes típusrendszer
│   ├── content/            statikus tartalom (városok, termékek, gépek…)
│   ├── economy.ts          TISZTA matematika: árgörbék, mérföldkövek
│   ├── selectors.ts        származtatott értékek (Multipliers, ProductView)
│   ├── simulate.ts         a tick és a kézi kiszolgálás
│   ├── offline.ts          offline bevétel
│   ├── progression.ts      napi küldetés, achievement, láda
│   ├── actions.ts          minden játékakció (tiszta mutációk + Result)
│   ├── initialState.ts     új játék állapota
│   └── store.ts            zustand: az EGYETLEN hely, ahol az állapot változik
├── persistence/
│   ├── save.ts             mentés/betöltés, backup, ütemező
│   ├── migrations.ts       verziólánc + séma-helyreállítás
│   └── checksum.ts         FNV-1a
├── services/
│   ├── ads/                reklám-absztrakció + házirend
│   ├── iap/                vásárlás-absztrakció
│   └── haptics.ts          rezgés (throttle-lal)
└── ui/
    ├── theme.ts            színek, térközök, tipográfia
    ├── components/         saját primitívek + SVG-ikonkészlet
    ├── screens/            6 fül + beállítások
    ├── modals/             offline / jutalom / achievement
    └── ErrorBoundary.tsx
```

### Rétegszabály

```
ui  →  game/store  →  game/actions  →  game/{economy,simulate,selectors}  →  game/content
                 ↘  persistence
                 ↘  services
```

Felfelé nincs függés: a `game/` nem tud a `ui/`-ról, az `economy.ts` nem tud a
store-ról. Ezért lehet a teljes gazdaságot React nélkül tesztelni és
szimulálni (`npm run balance` sima Node alatt fut).

---

## 3. Állapotkezelés

### Miért zustand és nem Redux/Context?

A game loop másodpercenként ötször léptet. Context-tel ez a teljes fát
újrarajzolná; Reduxszal minden tick új állapotobjektumot allokálna. A zustand
`useSyncExternalStore`-ra épül, és **szelektoronként** értesít.

### A tick nem allokál

```ts
loopTimer = setInterval(() => {
  simulateTick(state, dt, multipliers);          // helyben módosít
  useGameStore.setState((p) => ({ tick: p.tick + 1 }));  // csak egy szám
}, 200);
```

A `GameState` objektum **nem** cserélődik ticknként — csak a `tick` számláló nő.
A komponensek erre iratkoznak fel, és a szelektoruk olvassa a friss értékeket.
Egy tick költsége így mikroszekundum nagyságrendű, nem React-újrarajzolás.

Új referencia csak **akcióknál** keletkezik (`mutate`), ahol tényleg változott
valami szerkezeti.

### A `mutate` szerződés

Minden akció ugyanazt csinálja:

1. helyben módosítja az állapotot,
2. ellenőrzi az achievementeket,
3. újraszámolja a szorzókat,
4. sekély másolatot tesz a store-ba (új referencia a React felé),
5. mentést kér (debounce-olva).

Így soha nem maradhat ki egy achievement, és soha nem csúszhat el a kijelzett
bevétel a valóditól.

---

## 4. Mentés

```
AsyncStorage
├── sfe.save.v1          fő mentés
└── sfe.backup.v1        az előző jó mentés
```

**Boríték formátum**: `{ f: 1, d: "<json>", c: "<checksum>", t: <időbélyeg> }`

### Betöltési sorrend

1. Fő mentés → checksum ellenőrzés → migráció → séma-helyreállítás
2. Ha bármelyik lépés bukik: **biztonsági másolat** ugyanezzel a folyamattal
3. Ha az is bukik: új játék + a játékos értesítése

### Migrációk

Egy megjelent verzió migrációját **soha nem írjuk át**, csak újat teszünk a
lánc végére. A `coerceToGameState` a migráció után is garantálja, hogy minden
kötelező mező létezik és helyes típusú — így egy kézzel szerkesztett vagy
félbeszakadt mentés sem tudja elrontani a futást, és **új tartalom hozzáadása
nem töri el a régi mentéseket** (az új termékek 0 szinttel jelennek meg).

### Mikor mentünk

| Esemény | Hogyan |
|---|---|
| Bármely akció | debounce 1,5 mp |
| Automatikusan | 15 másodpercenként |
| Háttérbe váltás | azonnal, `flush()` |
| Franchise, IAP | azonnal, `flush()` (visszafordíthatatlan lépések) |

### A checksumról őszintén

Ez **nem** csalásvédelem — offline játéknál kliensoldalon az elvileg
lehetetlen. Két dolgot ad: kiszűri a sérült/félig kiírt mentést (hogy a
backupra tudjunk esni), és megfogja a naiv kézi szerkesztést. Mivel nincs
multiplayer, a csalás csak a csaló saját élményét rontja — ezért szándékosan
nem építünk ide agresszív, hamis pozitívokat termelő védelmet, ami becsületes
játékosok mentését dobná el.

---

## 5. Teljesítmény

Cél: stabil 60 fps belépőszintű Android készüléken (4 magos, 2 GB RAM).

| Döntés | Nyereség |
|---|---|
| Logikai hurok 5 Hz (nem 60) | 12× kevesebb CPU |
| A tick nem allokál | nincs GC-akadás |
| Szorzók újraszámolása másodpercenként (nem 5×) | 5× kevesebb számolás |
| Zárt alakú árképletek | a „MAX” gomb 10 000 szintnél sem akad |
| Folyamatos mód 0,25 mp alatti ciklusnál | nincs animáció a késői játékban |
| Saját SVG-ikonok, nulla bitmap | kisebb APK, nincs @2x/@3x asset |
| Nincs navigációs könyvtár | ~200 KB-tal kisebb csomag, gyorsabb hidegindítás |
| `useNativeDriver` a toastnál | a JS szál blokkolása sem akasztja meg |
| R8 + resource shrinking | kisebb release APK |

---

## 6. Hibakezelés

| Réteg | Mi történik hiba esetén |
|---|---|
| Natív / hálózat | `safeAsync` → napló + tartalék érték, sosem dob |
| Akciók | `ActionResult` → magyar hibaüzenet toastban + rezgés |
| Mentés | naplózás, a játék megy tovább; betöltésnél backup |
| Reklám SDK | mockra esik vissza; a gomb tiltva marad |
| React fa | `ErrorBoundary` → „Újraindítom” gomb, a mentés érintetlen |
| Indítás | külön hibaképernyő „Újrapróbálom” gombbal |

A `logger.ts` `addLogSink()` függvényével egy crash-reporter (Sentry,
Crashlytics) egy sorral beköthető — a játékkódhoz nem kell hozzányúlni:

```ts
addLogSink((level, message, context) => {
  if (level === 'error') Sentry.captureMessage(message, { extra: { context } });
});
```

---

## 7. Tesztelés

```bash
npm test        # 109 teszt
npm run balance # végigjátszás + egészség-ellenőrzés
```

| Fájl | Mit véd |
|---|---|
| `economy.test.ts` | árgörbék, mérföldkövek, a „költség > bevétel” invariáns, franchise-görbe |
| `offline.test.ts` | offline számítás, sapka, óracsalás, időugrás |
| `actions.test.ts` | vásárlás, menedzser, város, **a kézi kiszolgálás korlátja**, boosterek, IAP idempotencia, franchise |
| `save.test.ts` | checksum, migráció, séma-helyreállítás, backup-visszaállás, export/import |
| `ads.test.ts` | a teljes reklám-házirend, mock provider viselkedése |
| `format.test.ts` | számformázás minden nagyságrendben |

A tesztek **rögzített, eseménymentes dátumon** futnak (2026-03-02, hétfő), mert
különben az időszakos események naptára befolyásolná az eredményt.

---

## 8. Mit érdemes legközelebb hozzáadni

Az architektúra ezekre már fel van készítve:

1. **Hang** — `expo-av`, a `settings.sound` kapcsoló már megvan
2. **Push értesítés** („megtelt a raktárad”) — `expo-notifications`, offline is ütemezhető
3. **Felhőmentés** — az `exportSave`/`importSave` már kész, csak tárolót kell hozzá
4. **Több nyelv** — a szövegek jelenleg beégetve; egy `t()` réteg bevezetése mechanikus
5. **Új város** — egy bejegyzés a `CITY_SEEDS`-be és 6 név; minden más generálódik
6. **A/B teszt a balance-on** — a `gameConfig.ts` egyben lecserélhető távoli konfigra
