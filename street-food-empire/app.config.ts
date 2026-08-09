import type { ExpoConfig } from 'expo/config';

/**
 * Street Food Empire – Expo alkalmazás-konfiguráció.
 *
 * A reklám- és IAP-SDK-k natív modulok, ezért Expo Go-ban NEM futnak.
 * A játék ettől függetlenül teljesen játszható Expo Go-ban is: a
 * services/ads és services/iap rétegek automatikusan mock providerre
 * esnek vissza, ha a natív modul nincs jelen (lásd docs/ADS_AND_IAP.md).
 *
 * Éles buildhez:
 *   1. töltsd ki a .env fájlt (.env.example alapján)
 *   2. npx expo prebuild --clean
 *   3. eas build -p android --profile production
 */

const IS_DEV = process.env.APP_VARIANT === 'development';

const ANDROID_ADMOB_APP_ID =
  process.env.ADMOB_ANDROID_APP_ID ?? 'ca-app-pub-3940256099942544~3347511713'; // Google teszt ID
const IOS_ADMOB_APP_ID =
  process.env.ADMOB_IOS_APP_ID ?? 'ca-app-pub-3940256099942544~1458002511'; // Google teszt ID

const config: ExpoConfig = {
  name: IS_DEV ? 'SFE (dev)' : 'Street Food Empire',
  slug: 'street-food-empire',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'streetfoodempire',
  userInterfaceStyle: 'dark',
  // Az új architektúra (Fabric/TurboModules) az SDK 57-ben alapértelmezett,
  // ezért nincs külön kapcsolója.
  backgroundColor: '#12101A',

  // A splash képernyőt az SDK 57-ben az `expo-splash-screen` plugin
  // konfigurálja (lásd a plugins tömböt), nincs külön `splash` kulcs.
  icon: './assets/icon.png',

  assetBundlePatterns: ['**/*'],

  ios: {
    bundleIdentifier: IS_DEV ? 'com.streetfoodempire.game.dev' : 'com.streetfoodempire.game',
    buildNumber: '1',
    supportsTablet: true,
    requireFullScreen: false,
    infoPlist: {
      // Az App Store megköveteli a nem-exempt titkosítás nyilatkozatot.
      ITSAppUsesNonExemptEncryption: false,
      // AdMob iOS-en az app ID-t az Info.plist-ből olvassa.
      GADApplicationIdentifier: IOS_ADMOB_APP_ID,
      // App Tracking Transparency – csak személyre szabott reklámhoz kell.
      NSUserTrackingUsageDescription:
        'Az azonosító segítségével relevánsabb reklámokat tudunk mutatni. Ez opcionális, a játék enélkül is teljesen működik.',
      SKAdNetworkItems: [{ SKAdNetworkIdentifier: 'cstr6suwn9.skadnetwork' }],
    },
  },

  android: {
    package: IS_DEV ? 'com.streetfoodempire.game.dev' : 'com.streetfoodempire.game',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#12101A',
    },
    // A com.android.vending.BILLING engedélyt a react-native-iap plugin adja hozzá,
    // az AD_ID-t pedig a react-native-google-mobile-ads.
    permissions: ['com.android.vending.BILLING'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },

  plugins: [
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        backgroundColor: '#12101A',
        imageWidth: 220,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 24,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          // R8 teljes mód: kisebb APK, gyorsabb indulás gyenge készüléken.
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
        ios: {
          deploymentTarget: '15.1',
          useFrameworks: 'static', // a Google Mobile Ads SDK ezt igényli
        },
      },
    ],
    // --- Ezt a két plugint akkor kapcsold be, amikor telepítetted az SDK-kat ---
    // Lásd: docs/ADS_AND_IAP.md 2. lépés
    // [
    //   'react-native-google-mobile-ads',
    //   {
    //     androidAppId: ANDROID_ADMOB_APP_ID,
    //     iosAppId: IOS_ADMOB_APP_ID,
    //     userTrackingUsageDescription:
    //       'Az azonosító segítségével relevánsabb reklámokat tudunk mutatni.',
    //   },
    // ],
    // 'react-native-iap',
  ],

  extra: {
    admobAndroidAppId: ANDROID_ADMOB_APP_ID,
    admobIosAppId: IOS_ADMOB_APP_ID,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '00000000-0000-0000-0000-000000000000',
    },
  },

  experiments: {
    tsconfigPaths: true,
  },
};

export default config;
