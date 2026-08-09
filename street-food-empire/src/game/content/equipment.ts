import type { Effect, EquipmentDef, EquipmentTierDef, ProductCategory } from '@/game/types';

/**
 * MACHINES / UPGRADES
 *
 * A machine has several tiers. The effects of the owned tier are **absolute**
 * values, they do not stack: at tier 4 only the tier-4 effect applies. That way
 * the UI shows a single number ("x3.84") and there is nothing to misread.
 *
 * Price: baseCost * costStep^(tier-1) - steep on purpose, so machines stay
 * relevant for the whole game instead of maxing out in 20 minutes.
 */

type TierSpec = {
  count: number;
  baseCost: number;
  costStep: number;
  /** Returns the effects of the given tier (absolute values). */
  effectsAt: (tier: number) => readonly Effect[];
  labelAt: (tier: number) => string;
  descriptionAt: (tier: number) => string;
};

function buildTiers(spec: TierSpec): EquipmentTierDef[] {
  const tiers: EquipmentTierDef[] = [];
  for (let tier = 1; tier <= spec.count; tier += 1) {
    tiers.push({
      tier,
      name: spec.labelAt(tier),
      cost: Math.round(spec.baseCost * Math.pow(spec.costStep, tier - 1)),
      effects: spec.effectsAt(tier),
      description: spec.descriptionAt(tier),
    });
  }
  return tiers;
}

function mult(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `×${rounded.toString().replace(/\.?0+$/, '')}`;
}

/** Category booster machine (grill, fryer, oven, cooler, display case). */
function categoryMachine(args: {
  id: string;
  name: string;
  icon: string;
  category: ProductCategory;
  baseCost: number;
  tierNames: readonly string[];
  growth?: number;
}): EquipmentDef {
  const growth = args.growth ?? 1.4;
  return {
    id: args.id,
    cityId: 'all',
    name: args.name,
    icon: args.icon,
    tiers: buildTiers({
      count: args.tierNames.length,
      baseCost: args.baseCost,
      costStep: 10,
      effectsAt: (tier) => [
        {
          type: 'incomeMultiplier',
          scope: { kind: 'category', category: args.category },
          value: Math.pow(growth, tier),
        },
      ],
      labelAt: (tier) => args.tierNames[tier - 1] ?? `${args.name} ${tier}`,
      descriptionAt: (tier) =>
        `${mult(Math.pow(growth, tier))} income on every ${CATEGORY_LABEL[args.category]} product`,
    }),
  };
}

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  grill: 'grilled',
  fryer: 'deep-fried',
  dough: 'dough',
  cold: 'cold',
  drink: 'drink',
  sweet: 'sweet',
};

export const EQUIPMENT: readonly EquipmentDef[] = [
  categoryMachine({
    id: 'grill',
    name: 'Grill Top',
    icon: 'flame',
    category: 'grill',
    baseCost: 300,
    tierNames: [
      'Single Hotplate',
      'Cast Iron Slab',
      'Twin Plate Grill',
      'Charcoal Basket',
      'Infrared Grill',
      'Contact Griddle',
      'Rotating Spit',
      'Industrial Lava Rock',
      'Zoned Pro Grill',
      'Automated Grill Line',
      'Robot Arm Broiler',
      'Fusion Heat Chamber',
    ],
  }),
  categoryMachine({
    id: 'fryer',
    name: 'Fryer',
    icon: 'droplet',
    category: 'fryer',
    baseCost: 2_400,
    tierNames: [
      'Countertop Fryer',
      'Twin Basket',
      'Pressure Fryer',
      'Oil Filter System',
      'Rapid Heater',
      'Four Basket Line',
      'Auto Basket Lift',
      'Heat Exchange Industrial',
      'Vacuum Fryer',
      'Zero Oil System',
      'Cyclone Dryer',
      'Quantum Basket',
    ],
  }),
  categoryMachine({
    id: 'oven',
    name: 'Oven',
    icon: 'bread',
    category: 'dough',
    baseCost: 18_000,
    tierNames: [
      'Backyard Oven',
      'Stone Deck Oven',
      'Steam Injection',
      'Rotating Rack',
      'Tunnel Oven',
      'Twin Chamber Pro',
      'Wood Fired Hybrid',
      'Programmable Line',
      'Heat Storage Beast',
      'Auto Knead & Bake',
      'Continuous Belt Oven',
      'Thermal Matrix',
    ],
  }),
  categoryMachine({
    id: 'cooler',
    name: 'Cooler Counter',
    icon: 'snow',
    category: 'drink',
    baseCost: 140_000,
    tierNames: [
      'Ice Chest',
      'Compressor Fridge',
      'Glass Door Case',
      'Blast Chiller Tower',
      'Tap System',
      'Carbonation Mixer',
      'Multi Zone Counter',
      'Nitro Cooling',
      'Self Serve Wall',
      'Smart Dispenser',
      'Cryogenic Tower',
      'Everfrost System',
    ],
  }),
  categoryMachine({
    id: 'showcase',
    name: 'Pastry Case',
    icon: 'star',
    category: 'sweet',
    baseCost: 2_000_000,
    tierNames: [
      'Paper Tray Counter',
      'Glass Cloche',
      'Chilled Display',
      'Rotating Tiers',
      'Lit Island',
      'Humidity Control',
      'Double Sided Case',
      'Tempering Unit',
      'Chocolate Fountain Row',
      'Designer Cake Wall',
      'Floating Display',
      'Gold Leaf Section',
    ],
  }),

  // --- Machines that are not tied to a category ---
  {
    id: 'register',
    cityId: 'all',
    name: 'Register',
    icon: 'coin',
    tiers: buildTiers({
      count: 10,
      baseCost: 5_000,
      costStep: 14,
      effectsAt: (tier) => [
        { type: 'incomeMultiplier', scope: { kind: 'global' }, value: Math.pow(1.22, tier) },
      ],
      labelAt: (tier) =>
        [
          'Metal Cash Box',
          'Mechanical Register',
          'Digital Register',
          'Card Reader',
          'Touchscreen POS',
          'Cloud Register',
          'Self Serve Kiosk',
          'Face Pay Terminal',
          'Twin Lane Kiosk',
          'Gold Counter Terminal',
        ][tier - 1] ?? `Register ${tier}`,
      descriptionAt: (tier) => `${mult(Math.pow(1.22, tier))} income on EVERY product`,
    }),
  },
  {
    id: 'storage',
    cityId: 'all',
    name: 'Storage',
    icon: 'box',
    tiers: buildTiers({
      count: 8,
      baseCost: 25_000,
      costStep: 16,
      effectsAt: (tier) => [{ type: 'offlineCapHours', value: tier * 1.5 }],
      labelAt: (tier) =>
        [
          'Shelf Corner',
          'Metal Racking',
          'Cold Room',
          'Shipping Container',
          'Automated Racks',
          'Central Warehouse',
          'Regional Depot',
          'Logistics Hub',
        ][tier - 1] ?? `Storage ${tier}`,
      descriptionAt: (tier) => `+${tier * 1.5}h offline income cap`,
    }),
  },
  {
    id: 'nightshift',
    cityId: 'all',
    name: 'Night Shift',
    icon: 'moon',
    tiers: buildTiers({
      count: 6,
      baseCost: 400_000,
      costStep: 22,
      effectsAt: (tier) => [{ type: 'offlineRate', value: tier * 0.06 }],
      labelAt: (tier) =>
        [
          'Late Close',
          'Open Till Midnight',
          'Dawn Shift',
          'Double Shift',
          'Non-Stop Counter',
          '24/7 Empire',
        ][tier - 1] ?? `Night Shift ${tier}`,
      descriptionAt: (tier) => `+${Math.round(tier * 6)}% offline income rate`,
    }),
  },
  {
    // IMPORTANT BALANCE LIMIT: the tap multiplier is small on purpose.
    // A hand-served customer pays one full cycle, but the product then cannot
    // be served again for one cycle time - so the ceiling on manual income is
    // automated income x tapMultiplier. If this multiplier grew large, active
    // tapping would bypass the entire economy.
    id: 'counter',
    cityId: 'all',
    name: 'Service Counter',
    icon: 'hand',
    tiers: buildTiers({
      count: 8,
      baseCost: 900,
      costStep: 12,
      effectsAt: (tier) => [{ type: 'tapMultiplier', value: Math.pow(1.12, tier) }],
      labelAt: (tier) =>
        [
          'Crate Counter',
          'Stainless Counter',
          'Wide Counter',
          'Two Serving Windows',
          'Queue Rail Counter',
          'Three Windows',
          'Express Island',
          'Lightning Counter',
        ][tier - 1] ?? `Counter ${tier}`,
      descriptionAt: (tier) => `${mult(Math.pow(1.12, tier))} value on every hand-served order`,
    }),
  },
];

const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export function getEquipment(id: string): EquipmentDef {
  const equipment = EQUIPMENT_BY_ID.get(id);
  if (!equipment) throw new Error(`Unknown equipment: ${id}`);
  return equipment;
}

/** The next purchasable tier, or null when maxed out. */
export function nextTier(def: EquipmentDef, ownedTier: number): EquipmentTierDef | null {
  return def.tiers.find((t) => t.tier === ownedTier + 1) ?? null;
}

export function tierAt(def: EquipmentDef, tier: number): EquipmentTierDef | null {
  if (tier <= 0) return null;
  return def.tiers.find((t) => t.tier === tier) ?? null;
}
