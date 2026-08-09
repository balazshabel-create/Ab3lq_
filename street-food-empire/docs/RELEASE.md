# Kiadás: Google Play és App Store

## 0. Előfeltételek

| Kell | Hol |
|---|---|
| Expo-fiók | https://expo.dev |
| Google Play Developer-fiók | 25 USD, egyszeri |
| Apple Developer Program | 99 USD / év |
| Mac (csak iOS lokális buildhez) | EAS felhő-buildhez **nem** kell |

```bash
npm install -g eas-cli
eas login
eas init            # ez tölti ki az EAS_PROJECT_ID-t
```

---

## 1. Amit MINDENKÉPP cserélj le

| Fájl | Mit |
|---|---|
| `app.config.ts` | `bundleIdentifier` és `package` → a saját fordított domained (pl. `com.tecegneved.streetfoodempire`) |
| `.env` | AdMob azonosítók (a `.env.example` alapján) |
| `eas.json` | `appleId`, `ascAppId`, `appleTeamId` |
| `src/game/content/shop.ts` | SKU-k, ha más elnevezést szeretnél |
| `assets/` | `npm run assets` újragenerálja a színekből, vagy tedd be a sajátodat |

A `com.streetfoodempire.game` egy **helyőrző** — élesben nem használható, mert
a csomagnév a store-ban egyedi és később megváltoztathatatlan.

---

## 2. Verziózás

```jsonc
// app.config.ts
version: '1.0.0',        // amit a felhasználó lát
ios:     { buildNumber: '1' },
android: { versionCode: 1 },
```

Az `eas.json` production profiljában `autoIncrement: true` — a build számot az
EAS lépteti, neked csak a `version` mezőt kell emelned kiadásonként.

---

## 3. Build

```bash
# Fejlesztői build (natív modulokkal, Expo Go helyett)
eas build --profile development --platform android

# Belső teszt (APK, megosztható linken)
eas build --profile preview --platform android

# Éles
eas build --profile production --platform android   # .aab a Play-hez
eas build --profile production --platform ios       # .ipa az App Store-hoz
```

Az első iOS buildnél az EAS felajánlja, hogy kezelje a tanúsítványokat és a
provisioning profilt — fogadd el, ez a legkevésbé hibalehetőséges út.

---

## 4. Google Play

1. Play Console → **Create app**
2. **App content** → töltsd ki mindet:
   - Privacy policy URL (**kötelező**, mert az AdMob adatot gyűjt)
   - Ads → *igen, tartalmaz reklámot*
   - Data safety → hirdetésazonosító, hozzávetőleges hely (AdMob)
   - Content rating kérdőív → várhatóan PEGI 3 / ESRB Everyone
   - Target audience → 13+ (reklám miatt ne jelöld gyerekeknek)
3. **Monetize → In-app products** → a 7 SKU (lásd
   [ADS_AND_IAP.md](./ADS_AND_IAP.md))
4. **Testing → Internal testing** → töltsd fel az `.aab`-t
   > Az IAP-k csak azután élnek, hogy a csomag legalább egyszer fel lett
   > töltve egy tesztsávra. Ez a leggyakoribb „nem működik a vásárlás” ok.
5. Tesztelés valódi készüléken, licencelt tesztfiókkal
6. **Production → Create release**

Boltoldali anyag: 2–8 képernyőkép (telefon), 512×512 ikon, 1024×500 feature
grafika, rövid (80 karakter) és hosszú leírás.

---

## 5. App Store

1. App Store Connect → **My Apps → +**
2. Bundle ID → egyeznie kell az `app.config.ts`-ben lévővel
3. **Features → In-App Purchases** → a 7 SKU
   - `sfe.remove_ads`, `sfe.starter_pack`, `sfe.golden_counter` → **Non-Consumable**
   - a 4 érmecsomag → **Consumable**
   - mindegyikhez kell képernyőkép és review-megjegyzés
4. **App Privacy** → hirdetési adat: „Identifiers → Device ID”, „Usage Data”
5. `eas submit --platform ios --profile production`
6. TestFlight → belső teszt
7. **Submit for Review**

### Amin az iOS review el szokott bukni

| Ok | Megoldás |
|---|---|
| Nincs „Restore Purchases” gomb | **Megvan** — Bolt és Beállítások képernyőn |
| ATT prompt indoklás nélkül | `NSUserTrackingUsageDescription` **be van állítva**, és a személyre szabás alapból ki van kapcsolva |
| Az IAP nem tesztelhető | Sandbox fiók + a SKU-k „Ready to Submit” állapotban |
| Hiányzó adatvédelmi tájékoztató | **Neked kell megírnod** és megadnod a linkjét |
| Reklám gyerekeknek | 12+ korhatár beállítása |

---

## 6. Kiadás előtti ellenőrzőlista

```bash
npm run typecheck   # nulla hiba
npm test            # 109 teszt zöld
npm run balance     # minden egészség-ellenőrzés ✓
```

Kézzel, éles buildben:

- [ ] Új játék → az első koppintástól az első menedzserig ~1 perc
- [ ] Erőltetett kilépés (app swipe) után a haladás megmarad
- [ ] Repülőgép mód → a játék teljesen működik, csak a reklám nem
- [ ] Az óra 1 évvel előre állítása → az offline bevétel a sapkánál megáll
- [ ] Az óra visszaállítása → nincs bevétel, nincs összeomlás
- [ ] Jutalomvideó bezárása jutalom előtt → nincs jutalom, nincs hibaüzenet
- [ ] Vásárlás megszakítása → nincs hibaüzenet, nincs jóváírás
- [ ] Vásárlás → app kill a jóváírás után → az újraindítás megtartja
- [ ] „Vásárlások visszaállítása” friss telepítésen visszahozza a jogosultságokat
- [ ] Beállítások → Játék törlése → tényleg elölről indul, de a vásárlás megmarad
- [ ] Rendszer-betűméret maximumon a UI nem törik szét
- [ ] Belépőszintű Androidon a görgetés sima

---

## 7. Kiadás után

**Figyelendő számok**: D1/D7 retenció, átlagos munkamenethossz, hol lépnek ki
először, jutalomvideó-megtekintés / munkamenet, ARPDAU.

**Hangolás kód nélkül**: a `src/config/gameConfig.ts` és a
`src/game/content/*` fájlok minden balance-számot tartalmaznak. Ha a
`npm run balance` szimulátor ellenőrzései átmennek, a változtatás nem rontja
el az ütemezést.

**Mentés-kompatibilitás**: ha a `GameState` alakja változik, növeld a
`GAME_CONFIG.saveVersion` értékét, és tegyél egy új lépést a
`migrations.ts` láncába. Régi migrációt soha ne írj át.
