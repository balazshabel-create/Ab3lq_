import AsyncStorage from '@react-native-async-storage/async-storage';

import { GAME_CONFIG } from '@/config/gameConfig';
import { createInitialState } from '@/game/initialState';
import { STARTER_PRODUCT_ID } from '@/game/content/products';
import { computeChecksum, verifyChecksum } from '@/persistence/checksum';
import { coerceToGameState, migrate } from '@/persistence/migrations';
import { clearSave, exportSave, importSave, loadGame, saveGame } from '@/persistence/save';

describe('ellenőrzőösszeg', () => {
  it('ugyanarra a bemenetre ugyanazt adja', () => {
    expect(computeChecksum('abc', 'só')).toBe(computeChecksum('abc', 'só'));
  });

  it('egyetlen karakter változása is más összeget ad', () => {
    expect(computeChecksum('abc', 'só')).not.toBe(computeChecksum('abd', 'só'));
  });

  it('felismeri a módosított tartalmat', () => {
    const payload = '{"cash":100}';
    const checksum = computeChecksum(payload, 'só');
    expect(verifyChecksum(payload, 'só', checksum)).toBe(true);
    expect(verifyChecksum('{"cash":999999}', 'só', checksum)).toBe(false);
  });
});

describe('migráció', () => {
  it('az aktuális verziójú mentést változatlanul hagyja', () => {
    const save = { version: GAME_CONFIG.saveVersion, cash: 5 };
    expect(migrate({ ...save }).cash).toBe(5);
  });

  it('az 1-es verziót felhozza a mostanira', () => {
    const legacy = { version: 1, cash: 500, coins: 10 };
    const migrated = migrate(legacy);
    expect(migrated.version).toBe(GAME_CONFIG.saveVersion);
    expect(migrated.cash).toBe(500);
    expect(migrated.stars).toBe(0);
    expect(migrated.boosters).toEqual({});
  });

  it('a v2 régi boosterét átalakítja az új szerkezetre', () => {
    const future = Date.now() + 60_000;
    const legacy = {
      version: 2,
      activeBooster: { expiresAt: future, multiplier: 2 },
    };
    const migrated = migrate(legacy) as { boosters: Record<string, { expiresAt: number }> };
    expect(migrated.boosters.doubleIncome?.expiresAt).toBe(future);
  });

  it('a jövőből származó mentést visszautasítja', () => {
    expect(() => migrate({ version: GAME_CONFIG.saveVersion + 5 })).toThrow();
  });
});

describe('séma-helyreállítás', () => {
  it('üres objektumból is teljes állapotot épít', () => {
    const state = coerceToGameState({}, 1000);
    expect(state.version).toBe(GAME_CONFIG.saveVersion);
    expect(state.unlockedCityIds.length).toBeGreaterThan(0);
    expect(Object.keys(state.products).length).toBeGreaterThan(0);
    expect(state.settings.buyQuantity).toBe(1);
  });

  it('a hibás típusokat biztonságos értékre cseréli', () => {
    const state = coerceToGameState(
      {
        cash: 'sok pénz',
        coins: NaN,
        products: { hamis: { level: 'tíz' } },
        settings: { buyQuantity: 42 },
        unlockedCityIds: [123, 'budapest'],
      },
      1000,
    );

    expect(Number.isFinite(state.cash)).toBe(true);
    expect(Number.isFinite(state.coins)).toBe(true);
    expect(state.settings.buyQuantity).toBe(1);
    expect(state.unlockedCityIds).toEqual(['budapest']);
  });

  it('a negatív értékeket nullára vágja', () => {
    const state = coerceToGameState({ cash: -5000, coins: -10, stars: -3 }, 1000);
    expect(state.cash).toBe(0);
    expect(state.coins).toBe(0);
    expect(state.stars).toBe(0);
  });

  it('a magas vízszint sosem kisebb az utolsó látott időnél', () => {
    const state = coerceToGameState({ lastSeenWallClock: 5000, maxSeenWallClock: 1000 }, 0);
    expect(state.maxSeenWallClock).toBeGreaterThanOrEqual(state.lastSeenWallClock);
  });

  it('új tartalom (új termék) hiánya nem töri el a régi mentést', () => {
    // A mentés csak egyetlen termékről tud – a többinek 0 szinttel kell létrejönnie.
    const state = coerceToGameState(
      { products: { [STARTER_PRODUCT_ID]: { level: 12, hasManager: true, progress: 0.5 } } },
      0,
    );
    expect(state.products[STARTER_PRODUCT_ID]?.level).toBe(12);
    expect(Object.values(state.products).every((p) => p.level >= 0)).toBe(true);
  });
});

describe('mentés körforgás', () => {
  beforeEach(async () => {
    await clearSave();
  });

  it('mentés után ugyanazt tölti vissza', async () => {
    const state = createInitialState(1000);
    state.cash = 987_654;
    state.coins = 42;
    state.stars = 7;

    expect(await saveGame(state)).toBe(true);

    const outcome = await loadGame(2000);
    expect(outcome.kind).toBe('loaded');
    expect(outcome.state.cash).toBe(987_654);
    expect(outcome.state.coins).toBe(42);
    expect(outcome.state.stars).toBe(7);
  });

  it('mentés nélkül új játékot ad', async () => {
    const outcome = await loadGame(1000);
    expect(outcome.kind).toBe('fresh');
    expect(outcome.state.cash).toBe(GAME_CONFIG.start.cash);
  });

  it('sérült fő mentés esetén a biztonsági másolatra vált', async () => {
    const good = createInitialState(1000);
    good.cash = 555;
    await saveGame(good);

    // Második mentés: az első átkerül a backup kulcsra.
    const newer = createInitialState(1000);
    newer.cash = 777;
    await saveGame(newer);

    // A fő mentés megsérül.
    await AsyncStorage.setItem(GAME_CONFIG.save.storageKey, '{"f":1,"d":"{}","c":"hamis"}');

    const outcome = await loadGame(2000);
    expect(outcome.kind).toBe('restoredBackup');
    expect(outcome.state.cash).toBe(555);
  });

  it('teljesen olvashatatlan mentésnél sem dob, hanem új játékot indít', async () => {
    await AsyncStorage.setItem(GAME_CONFIG.save.storageKey, 'ez nem json');
    await AsyncStorage.setItem(GAME_CONFIG.save.backupKey, 'ez sem');

    const outcome = await loadGame(1000);
    expect(outcome.kind).toBe('fresh');
    expect(outcome.state.cash).toBe(GAME_CONFIG.start.cash);
  });
});

describe('export / import', () => {
  it('az exportált mentés visszaimportálható', () => {
    const state = createInitialState(1000);
    state.cash = 123_456;

    const text = exportSave(state);
    const imported = importSave(text, 2000);

    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.state.cash).toBe(123_456);
  });

  it('a módosított exportot visszautasítja', () => {
    const state = createInitialState(1000);
    const text = exportSave(state).replace(/"cash\\":\d+/, '"cash\\":999999999');
    const imported = importSave(text, 2000);
    expect(imported.ok).toBe(false);
  });

  it('tetszőleges szöveget nem fogad el', () => {
    expect(importSave('szia').ok).toBe(false);
    expect(importSave('{}').ok).toBe(false);
  });
});
