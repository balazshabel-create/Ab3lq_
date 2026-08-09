import { createRng, type Rng } from '@/core/rng';
import { productsOfCity } from '@/game/content/products';
import { cycleSeconds, revenuePerCycle } from '@/game/economy';
import type { GameState, Multipliers, ProductId } from '@/game/types';

/**
 * MACSKAVENDÉGEK
 *
 * Ez a réteg teszi a játékot játékká a menü helyett: a pult előtt látszik,
 * ahogy a macskák beérkeznek, sorba állnak, vásárolnak és elmennek.
 *
 * TERVEZÉSI DÖNTÉS — miért nem külön gazdaság?
 *
 * A vendégek NEM egy párhuzamos pénzforrás, hanem a meglévő gazdaság
 * **vizualizációja**. Két esetet különböztetünk meg:
 *
 *  - **Automatizált termék** (van menedzsere): a macskákat a menedzser
 *    szolgálja ki. A pénz a szokásos szimulációs tickből jön; a vendég
 *    érkezési üteme pontosan a termelési ütemhez igazodik, tehát amit látsz,
 *    az tényleg az, ami történik.
 *  - **Kézi termék**: a macska vár, amíg rá nem koppintasz. Ekkor fut le a
 *    `serveByHand`, és tényleg akkor kapod meg a pénzt.
 *
 * Így a jelenet soha nem hazudik, és a gazdaság matematikája érintetlen marad
 * (ugyanaz a kód fut, ugyanazok a tesztek védik).
 *
 * A vendéglista NEM kerül a mentésbe: pillanatnyi, látványbeli állapot.
 * Visszatéréskor egyszerűen újratelik a sor.
 */

export const MAX_QUEUE = 4;

/** Fázisok időzítése (ms). */
const ARRIVE_MS = 850;
const LEAVE_MS = 750;
const SERVE_FLASH_MS = 420;

/** Meddig vár egy macska kézi kiszolgálásra, mielőtt csalódottan elmegy. */
export const PATIENCE_SECONDS = 12;

/** Két érkezés között ennyi idő biztosan eltelik – különben villogna a sor. */
const MIN_SPAWN_SECONDS = 0.55;
/** Ennél ritkábban sose érkezzen vendég, különben üresnek tűnik a hely. */
const MAX_SPAWN_SECONDS = 6;

export type CustomerPhase = 'arriving' | 'waiting' | 'served' | 'leaving';

export type Customer = {
  id: number;
  /** Melyik macska-kinézet (szín + minta + kiegészítő). */
  look: number;
  /** Mit szeretne venni. */
  productId: ProductId;
  phase: CustomerPhase;
  /** A fázis kezdete (fali óra, ms). */
  phaseAt: number;
  /** Sorbeli hely: 0 = pultnál. */
  slot: number;
  /** Hátralévő türelem másodpercben (csak kézi terméknél fogy). */
  patience: number;
  /** Elégedetten távozik-e. */
  happy: boolean;
  /** Kiszolgáláskor mutatott összeg (lebegő felirat). */
  payout: number;
};

export type CustomerWorld = {
  customers: Customer[];
  /** Mikor érkezik a következő vendég (fali óra, ms). */
  nextSpawnAt: number;
  nextId: number;
  /** RNG-állapot, hogy a kinézetek ne ugráljanak újraszámoláskor. */
  rngState: number;
};

export function createCustomerWorld(seed: number, wallMs: number): CustomerWorld {
  return {
    customers: [],
    nextSpawnAt: wallMs + 400,
    nextId: 1,
    rngState: seed >>> 0,
  };
}

/**
 * Az aktív város azon termékei, amelyek ténylegesen kaphatók.
 * Ha nincs ilyen, nem érkezik vendég (a jelenet üres marad, ami helyes:
 * nincs mit eladni).
 */
function sellableProducts(state: GameState): ProductId[] {
  const ids: ProductId[] = [];
  for (const def of productsOfCity(state.activeCityId)) {
    const productState = state.products[def.id];
    if (productState && productState.level > 0) ids.push(def.id);
  }
  return ids;
}

/**
 * Az érkezési ütem: az aktív város teljes ciklusütemét követi (ciklus/mp),
 * mert egy ciklus = egy eladott adag. Így a sor sűrűsége együtt nő a
 * fejlődéssel — de vizuális határok között marad.
 */
function spawnIntervalSeconds(state: GameState, multipliers: Multipliers): number {
  let cyclesPerSecond = 0;

  for (const def of productsOfCity(state.activeCityId)) {
    const productState = state.products[def.id];
    if (!productState || productState.level <= 0) continue;

    const seconds = cycleSeconds(def, productState.level, multipliers.productCycle[def.id] ?? 1);
    if (productState.hasManager) {
      cyclesPerSecond += 1 / seconds;
    } else {
      // Kézi terméknél a vendég a koppintásra vár; ne áraszzuk el a sort.
      cyclesPerSecond += 1 / Math.max(seconds, 4);
    }
  }

  if (cyclesPerSecond <= 0) return MAX_SPAWN_SECONDS;
  return Math.min(MAX_SPAWN_SECONDS, Math.max(MIN_SPAWN_SECONDS, 1 / cyclesPerSecond));
}

/** Súlyozott választás: a drágább termékek ritkábban, de látványosabban fogynak. */
function pickProduct(rng: Rng, state: GameState, ids: ProductId[]): ProductId {
  return rng.weighted(ids, (id) => {
    const productState = state.products[id];
    if (!productState) return 0;
    // A menedzserrel ellátott termékek gyakoribbak (ott tényleg pörög a sor).
    return productState.hasManager ? 3 : 1;
  });
}

/** A sor legelső szabad helye, vagy -1 ha tele van. */
function freeSlot(customers: readonly Customer[]): number {
  const taken = new Set(
    customers.filter((c) => c.phase !== 'leaving').map((c) => c.slot),
  );
  for (let slot = 0; slot < MAX_QUEUE; slot += 1) {
    if (!taken.has(slot)) return slot;
  }
  return -1;
}

export type CustomerTickResult = {
  /** Ebben a tickben automatikusan kiszolgált vendégek száma. */
  autoServed: number;
};

/**
 * A vendégvilág léptetése.
 *
 * FONTOS: a megváltozott vendégekből **új objektum** készül, nem helyben
 * módosítunk. A jelenetben minden macska `React.memo`-val van becsomagolva, és
 * ha ugyanazt a referenciát kapná vissza, a React kihagyná az újrarajzolást —
 * a fázisváltásra épülő animáció pedig soha nem indulna el. Egyszerre
 * legfeljebb 5 vendég van, tehát ez a másolás elhanyagolható költség.
 *
 * A pénzhez nem nyúlunk: az automatikus kiszolgálás látvány, a bevételt a
 * `simulateTick` írja jóvá.
 */
export function tickCustomers(
  world: CustomerWorld,
  state: GameState,
  multipliers: Multipliers,
  wallMs: number,
  dt: number,
): CustomerTickResult {
  const rng = createRng(world.rngState);
  let autoServed = 0;
  let changed = false;

  const products = productsOfCity(state.activeCityId);
  const next: Customer[] = [];

  for (const customer of world.customers) {
    const elapsed = wallMs - customer.phaseAt;

    // --- Eltávozottak kiesnek a listából ---
    if (customer.phase === 'leaving' && elapsed >= LEAVE_MS) {
      changed = true;
      continue;
    }

    let updated: Customer | null = null;
    const change = (patch: Partial<Customer>): void => {
      updated = { ...customer, ...patch };
    };

    switch (customer.phase) {
      case 'arriving':
        if (elapsed >= ARRIVE_MS) change({ phase: 'waiting', phaseAt: wallMs });
        break;

      case 'waiting': {
        const productState = state.products[customer.productId];

        if (!productState || productState.level <= 0) {
          // A termék eltűnt (pl. franchise) – a vendég udvariasan távozik.
          change({ phase: 'leaving', phaseAt: wallMs, happy: false });
          break;
        }

        if (productState.hasManager) {
          // Automatizált: a menedzser szolgálja ki, a ciklusidő ütemében.
          const def = products.find((p) => p.id === customer.productId);
          const seconds = def
            ? cycleSeconds(def, productState.level, multipliers.productCycle[def.id] ?? 1)
            : 1;
          // A pultnál álló a leggyorsabb; a sor hátulja arányosan tovább vár.
          const serviceMs =
            Math.min(2200, Math.max(220, seconds * 1000)) * (1 + customer.slot * 0.35);

          if (elapsed >= serviceMs) {
            change({
              phase: 'served',
              phaseAt: wallMs,
              happy: true,
              payout: def
                ? revenuePerCycle(
                    def,
                    productState.level,
                    multipliers.productIncome[def.id] ?? 1,
                    multipliers.globalIncome,
                  )
                : 0,
            });
            autoServed += 1;
          }
        } else {
          // Kézi: fogy a türelem, a játékosra vár.
          const patience = customer.patience - dt;
          if (patience <= 0) {
            change({ phase: 'leaving', phaseAt: wallMs, happy: false, patience: 0 });
          } else {
            change({ patience });
          }
        }
        break;
      }

      case 'served':
        if (elapsed >= SERVE_FLASH_MS) change({ phase: 'leaving', phaseAt: wallMs });
        break;

      case 'leaving':
        break;
    }

    if (updated) {
      changed = true;
      next.push(updated);
    } else {
      next.push(customer);
    }
  }

  world.customers = next;

  // --- Új vendég ---
  if (wallMs >= world.nextSpawnAt) {
    const ids = sellableProducts(state);
    const slot = freeSlot(world.customers);

    if (ids.length > 0 && slot >= 0) {
      world.customers = [
        ...world.customers,
        {
          id: world.nextId++,
          look: rng.int(0, 999),
          productId: pickProduct(rng, state, ids),
          phase: 'arriving',
          phaseAt: wallMs,
          slot,
          patience: PATIENCE_SECONDS,
          happy: false,
          payout: 0,
        },
      ];
      changed = true;
    }

    world.nextSpawnAt = wallMs + spawnIntervalSeconds(state, multipliers) * 1000;
  }

  world.rngState = rng.state();
  return { autoServed };
}

/**
 * A pultnál álló, kézi kiszolgálásra váró vendég – ha van ilyen.
 * A UI ezt emeli ki, és a koppintás ezt szolgálja ki.
 */
export function nextManualCustomer(
  world: CustomerWorld,
  state: GameState,
): Customer | null {
  let best: Customer | null = null;
  for (const customer of world.customers) {
    if (customer.phase !== 'waiting') continue;
    const productState = state.products[customer.productId];
    if (!productState || productState.hasManager) continue;
    if (!best || customer.slot < best.slot) best = customer;
  }
  return best;
}

/** Egy konkrét vendég kiszolgáltnak jelölése (a fizetést a hívó intézi). */
export function markServed(
  world: CustomerWorld,
  customerId: number,
  payout: number,
  wallMs: number,
): void {
  const customer = world.customers.find((c) => c.id === customerId);
  if (!customer || customer.phase !== 'waiting') return;
  customer.phase = 'served';
  customer.phaseAt = wallMs;
  customer.happy = true;
  customer.payout = payout;
}

/** Franchise / városváltás után a sor kiürül. */
export function resetCustomerWorld(world: CustomerWorld, wallMs: number): void {
  world.customers = [];
  world.nextSpawnAt = wallMs + 300;
}
