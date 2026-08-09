# Reklám és vásárlás — tervezés és élesítés

## 0. Az alapelv

A játék teljes egészében végigjátszható fizetés nélkül és reklám nélkül is.
Minden, amit pénzért lehet venni, játékkal is megszerezhető — csak lassabban.
Nincs multiplayer és nincs ranglista, ezért **pay-to-win elvi lehetősége
sincs**.

---

## 1. Architektúra

A játék **soha nem hívja közvetlenül** az AdMob vagy a store SDK-t:

```
játékkód  →  AdService / IapService  →  Provider
                                        ├── Mock       (Expo Go, teszt)
                                        └── AdMob / react-native-iap  (éles)
```

A providert futásidőben választjuk: ha a natív modul nincs jelen, automatikusan
a mock fut. Ennek három haszna van:

1. **A játék Expo Go-ban is teljesen játszható**, natív build nélkül.
2. A teljes jutalom-folyamat tesztelhető SDK nélkül — a mock szándékosan
   valósághűen viselkedik (késleltetett betöltés, hibázás, bezárás jutalom
   nélkül), mert a reklámhibák többsége csak így jön elő.
3. Később **másik hálózatra váltani egyetlen fájl megírása** (Ad Manager,
   AppLovin, ironSource): elég az `AdProvider` interfészt megvalósítani.

Fájlok:

```
src/services/ads/
  types.ts            az interfész és a reklámhelyek
  AdService.ts        HÁZIREND (mikor szabad) + szolgáltatóváltás
  MockAdProvider.ts   fejlesztői
  AdMobProvider.ts    éles
src/services/iap/
  types.ts            az interfész
  IapService.ts       kapcsolat, árak, tranzakciók
  MockIapProvider.ts  fejlesztői
  RnIapProvider.ts    éles
```

---

## 2. Reklám-házirend

Az `AdService.ts` tiszta függvényei döntik el, **szabad-e** reklámot mutatni —
függetlenül attól, hogy van-e betöltve. Mindegyikre van teszt.

### Interstitial (teljes képernyős)

| Szabály | Érték |
|---|---|
| Az app indulása után | 2 percig soha |
| Két interstitial között | legalább 3 perc |
| Jutalomvideó után | legalább 3 perc |
| Jelentős események száma | legalább 8 az utolsó óta |
| Napi maximum | 12 |
| Reklámmentesség vásárolva | soha |

„Jelentős esemény” = városnyitás, franchise, menedzserfelvétel.
**Nem** az: szintvásárlás, koppintás. Ezért az interstitial csak természetes
szünetnél jelenik meg, nem játék közben.

### Jutalomvideó (rewarded)

Mindig **opcionális**, mindig a játékos indítja.

| Reklámhely | Jutalom |
|---|---|
| `doubleIncome` | ×2 bevétel 15 percig |
| `turbo` | ciklusidő −50% 10 percig |
| `freeCrate` | láda: Food Coin, pénz vagy booster |
| `offlineBoost` | ×2 offline bevétel |

Napi limit reklámhelyenként 10, két videó között 30 mp.

**Fontos**: a jutalom kizárólag az SDK `EARNED_REWARD` eseményére íródik jóvá.
A `CLOSED` esemény önmagában nem jutalom — ez a leggyakoribb hiba, amiért a
hálózatok szabálysértést jeleznek.

### Reklámmentesség és a méltányosság

Aki megveszi a reklámmentességet, annál az interstitial teljesen kikapcsol,
**de a jutalomvideós gombok megmaradnak — és a jutalom videó nélkül jár**
(`rewardIsFree()`). A fizető játékos nem járhat rosszabbul, mint aki reklámot
néz. Ez etikai és üzleti döntés is: enélkül a „reklámmentes” vásárlás
büntetésnek érződne.

---

## 3. IAP katalógus

A SKU-kat **pontosan így** kell felvenni a Google Play Console-ban és az
App Store Connectben (forrás: `src/game/content/shop.ts`).

| SKU | Típus | Név | Tartalom |
|---|---|---|---|
| `sfe.remove_ads` | non-consumable | Reklámmentes | interstitial kikapcsol, jutalmak videó nélkül |
| `sfe.starter_pack` | non-consumable | Kezdőcsomag | 250 coin + 4 óra bevétel + 3 menedzser |
| `sfe.golden_counter` | non-consumable | Aranypult | ×1,25 bevétel, ×2 offline sapka, arany kinézet |
| `sfe.coins_small` | consumable | Marék érme | 120 Food Coin |
| `sfe.coins_medium` | consumable | Erszény | 400 Food Coin |
| `sfe.coins_large` | consumable | Pénzesláda | 1 100 Food Coin |
| `sfe.coins_mega` | consumable | Széf | 3 000 Food Coin |

Nincs előfizetés (kevesebb store-adminisztráció és felmondási követelmény), és
nincs valódi pénzért nyitható loot box.

### A kézbesítés sorrendje — ez kritikus

```
1. iapService.purchase(sku)        → a store visszaigazolja
2. jóváírás a játékállapotban      → applyEntitlement / grantCoins
3. MENTÉS kiírása                  → saveScheduler.flush()
4. iapService.finish(txId, sku)    → csak most zárjuk le a tranzakciót
```

Ha a 3. és 4. lépés között lehal az app, a store **újra kézbesíti** a
vásárlást, a jóváírás pedig idempotens (`applyEntitlement` nem ad kétszer).
Így a játékos sem veszíteni, sem duplán nyerni nem tud. Erre teszt is van.

Fogyó terméknél a `finishTransaction`-t **kötelező** meghívni, különben a
store végtelen ciklusban újra és újra kézbesíti.

---

## 4. Élesítés lépésről lépésre

### 4.1 AdMob

```bash
npx expo install react-native-google-mobile-ads
```

1. **`app.config.ts`** — vedd ki a kommentből a plugin blokkot:

```ts
[
  'react-native-google-mobile-ads',
  {
    androidAppId: ANDROID_ADMOB_APP_ID,
    iosAppId: IOS_ADMOB_APP_ID,
    userTrackingUsageDescription:
      'Az azonosító segítségével relevánsabb reklámokat tudunk mutatni.',
  },
],
```

2. **`.env`** (a `.env.example` alapján) — töltsd ki:

```
ADMOB_ANDROID_APP_ID=ca-app-pub-XXXX~YYYY
ADMOB_IOS_APP_ID=ca-app-pub-XXXX~YYYY
ADMOB_ANDROID_REWARDED=ca-app-pub-XXXX/YYYY
ADMOB_ANDROID_INTERSTITIAL=ca-app-pub-XXXX/YYYY
ADMOB_IOS_REWARDED=ca-app-pub-XXXX/YYYY
ADMOB_IOS_INTERSTITIAL=ca-app-pub-XXXX/YYYY
```

3. **Build**:

```bash
npx expo prebuild --clean
eas build --profile development --platform android
```

Fejlesztői buildben a kód **mindig a Google teszt-ID-ket** használja
(`IS_DEV` ág az `AdMobProvider.ts`-ben). Éles reklámra kattintani fejlesztés
közben fióklezárást okoz — ezért van így bedrótozva.

4. **Ellenőrzés**: Beállítások képernyő alján látszik, melyik szolgáltató fut
   („Reklámszolgáltató: admob” vs „mock (teszt)”).

### 4.2 In-app purchase

```bash
npx expo install react-native-iap
```

1. `app.config.ts` → vedd ki a `'react-native-iap'` plugint a kommentből.
2. **Google Play Console** → Monetize → In-app products → vidd fel a 7 SKU-t.
   A csomagot legalább egyszer fel kell tölteni belső tesztre, hogy a
   termékek élővé váljanak.
3. **App Store Connect** → Features → In-App Purchases → ugyanez a 7 SKU.
   A `sfe.remove_ads`, `sfe.starter_pack`, `sfe.golden_counter` **Non-Consumable**,
   a 4 érmecsomag **Consumable**.
4. `npx expo prebuild --clean && eas build`

### 4.3 Adatvédelem

- **iOS**: az `NSUserTrackingUsageDescription` már be van állítva. Az ATT
  kérést csak akkor mutasd, ha a játékos a Beállításokban bekapcsolta a
  személyre szabott reklámot — alapból **ki** van kapcsolva.
- **Android / EU**: a Google UMP SDK-t az AdMob csomag hozza; a beleegyezési
  űrlapot az AdMob konzolon kell összeállítani.
- A Beállítások képernyőn a játékos bármikor átkapcsolhatja a személyre
  szabást; a `setPersonalizedAds` eldobja a már betöltött reklámokat, hogy a
  következő kérés az új beleegyezéssel menjen.

---

## 5. Szerveroldali nyugtaellenőrzés

Jelenleg **nincs**, és ez tudatos: a játék egyjátékos és offline, nincs mit
„ellopni” másoktól. A csalás csak a csaló saját élményét rontja.

Ha később mégis kell (pl. mert cross-device mentést vezetsz be), a hely elő van
készítve: az `IapProvider` interfészben a `purchase` visszaadja a
`transactionId`-t, és a `RnIapProvider` őrzi a nyers nyugtát. Elég egy
`validateReceipt(receipt): Promise<boolean>` hívást beszúrni a jóváírás elé.

---

## 6. Store-megfelelési ellenőrzőlista

- [x] „Vásárlások visszaállítása” gomb (Bolt + Beállítások) — App Store követelmény
- [x] Minden IAP ára a store-ból jön (lokalizált), a beégetett ár csak tartalék
- [x] Nincs reklám 13 év alatti korosztálynak szánt tartalomban (a játék 12+)
- [x] A jutalom csak tényleges megtekintés után jár
- [x] Nincs kényszerített reklám azonnal indítás után
- [x] `ITSAppUsesNonExemptEncryption: false` beállítva
- [x] Az adattörlés a Beállításokban elérhető
- [ ] Adatvédelmi tájékoztató URL — **neked kell megírnod és megadnod** a
      store-listákon (az AdMob adatgyűjtése miatt kötelező)
- [ ] Play Console → Data safety kérdőív kitöltése
- [ ] App Store Connect → App Privacy kérdőív kitöltése
