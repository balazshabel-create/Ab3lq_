import type { Effect, EquipmentDef, EquipmentTierDef, ProductCategory } from '@/game/types';

/**
 * GÉPEK / FEJLESZTÉSEK
 *
 * Egy gépnek több szintje (tier) van. A megvett szint effektjei **abszolút**
 * értékek, nem halmozódnak: ha a 4. szinten állsz, csak a 4. szint effektje
 * él. Így a UI-ban egyetlen szám látszik ("×3,84"), és nincs félreértés.
 *
 * Ár: baseCost * costStep^(tier-1)  – meredek, hogy a gépek végigkísérjék a
 * teljes játékot, ne legyenek 20 perc alatt kimaxolva.
 */

type TierSpec = {
  count: number;
  baseCost: number;
  costStep: number;
  /** A `tier`-edik szint effektjeit adja vissza (abszolút értékek). */
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

/** Kategória-erősítő gép (grill, fritőz, kemence, hűtő, vitrin). */
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
        `${mult(Math.pow(growth, tier))} bevétel minden ${CATEGORY_LABEL[args.category]} termékre`,
    }),
  };
}

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  grill: 'grillezett',
  fryer: 'olajban sült',
  dough: 'tésztás',
  cold: 'hideg',
  drink: 'ital',
  sweet: 'édes',
};

export const EQUIPMENT: readonly EquipmentDef[] = [
  categoryMachine({
    id: 'grill',
    name: 'Grillfelület',
    icon: 'flame',
    category: 'grill',
    baseCost: 300,
    tierNames: [
      'Egylapos rezsó',
      'Öntöttvas lap',
      'Duplalapos grill',
      'Szénkosaras rács',
      'Infra grill',
      'Kontakt grill',
      'Forgónyárs',
      'Ipari lávaköves',
      'Zónás profigrill',
      'Automata sütősor',
      'Robotkaros grillsor',
      'Fúziós hőkamra',
    ],
  }),
  categoryMachine({
    id: 'fryer',
    name: 'Fritőz',
    icon: 'droplet',
    category: 'fryer',
    baseCost: 2_400,
    tierNames: [
      'Asztali fritőz',
      'Duplakosaras',
      'Nyomásos fritőz',
      'Olajszűrős rendszer',
      'Gyorsfelfűtő',
      'Négykosaras sor',
      'Automata kosáremelő',
      'Hőcserélős ipari',
      'Vákuumfritőz',
      'Zéró-olaj rendszer',
      'Ciklonos szárító',
      'Kvantumkosár',
    ],
  }),
  categoryMachine({
    id: 'oven',
    name: 'Kemence',
    icon: 'bread',
    category: 'dough',
    baseCost: 18_000,
    tierNames: [
      'Sámlis kemence',
      'Kőlapos sütő',
      'Gőzinjektoros',
      'Forgókocsis',
      'Alagútkemence',
      'Kétkamrás profi',
      'Faalapú hibrid',
      'Programozható sor',
      'Hőtárolós masszív',
      'Automata dagasztó-sütő',
      'Folyamatos szalagsütő',
      'Termikus mátrix',
    ],
  }),
  categoryMachine({
    id: 'cooler',
    name: 'Hűtőpult',
    icon: 'snow',
    category: 'drink',
    baseCost: 140_000,
    tierNames: [
      'Jeges láda',
      'Kompresszoros hűtő',
      'Üvegajtós vitrin',
      'Gyorshűtő torony',
      'Csapos rendszer',
      'Szénsavas keverő',
      'Több zónás pult',
      'Nitro-hűtés',
      'Önkiszolgáló fal',
      'Okos adagoló',
      'Kriogén torony',
      'Örökjég rendszer',
    ],
  }),
  categoryMachine({
    id: 'showcase',
    name: 'Cukrászvitrin',
    icon: 'star',
    category: 'sweet',
    baseCost: 2_000_000,
    tierNames: [
      'Papírtálcás pult',
      'Üvegbura',
      'Hűtött vitrin',
      'Forgó emeletes',
      'Világító sziget',
      'Páraszabályzós',
      'Kétoldalas vitrin',
      'Temperáló egység',
      'Csokiszökőkút-sor',
      'Design tortafal',
      'Lebegő vitrin',
      'Aranyfüst szekció',
    ],
  }),

  // --- Nem kategóriához kötött gépek ---
  {
    id: 'register',
    cityId: 'all',
    name: 'Pénztárgép',
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
          'Fémkassza',
          'Mechanikus gép',
          'Digitális kassza',
          'Kártyaolvasó',
          'Érintőképernyős',
          'Felhő-kassza',
          'Önkiszolgáló kioszk',
          'Arcfelismerős fizetés',
          'Duplasoros kioszk',
          'Aranypult-terminál',
        ][tier - 1] ?? `Pénztárgép ${tier}`,
      descriptionAt: (tier) => `${mult(Math.pow(1.22, tier))} bevétel MINDEN termékre`,
    }),
  },
  {
    id: 'storage',
    cityId: 'all',
    name: 'Raktár',
    icon: 'box',
    tiers: buildTiers({
      count: 8,
      baseCost: 25_000,
      costStep: 16,
      effectsAt: (tier) => [{ type: 'offlineCapHours', value: tier * 1.5 }],
      labelAt: (tier) =>
        [
          'Polcos sarok',
          'Fémállvány',
          'Hűtőkamra',
          'Konténer',
          'Automata polcsor',
          'Központi raktár',
          'Regionális depó',
          'Logisztikai központ',
        ][tier - 1] ?? `Raktár ${tier}`,
      descriptionAt: (tier) => `+${tier * 1.5} óra offline bevétel-sapka`,
    }),
  },
  {
    id: 'nightshift',
    cityId: 'all',
    name: 'Éjszakai műszak',
    icon: 'moon',
    tiers: buildTiers({
      count: 6,
      baseCost: 400_000,
      costStep: 22,
      effectsAt: (tier) => [{ type: 'offlineRate', value: tier * 0.06 }],
      labelAt: (tier) =>
        [
          'Kései zárás',
          'Éjfélig nyitva',
          'Hajnali műszak',
          'Két műszak',
          'Non-stop pult',
          '24/7 birodalom',
        ][tier - 1] ?? `Éjszakai műszak ${tier}`,
      descriptionAt: (tier) => `+${Math.round(tier * 6)}% offline bevételi arány`,
    }),
  },
  {
    // FONTOS BALANCE-KORLÁT: a koppintás-szorzó szándékosan kicsi.
    // Egy kézi kiszolgálás egy teljes ciklust ad el, de a termék utána egy
    // ciklusidőn át nem szolgálható ki újra – így a kézi bevétel felső
    // korlátja: automatizált bevétel × tapMultiplier. Ha ez a szorzó nagyra
    // nőne, az aktív koppintgatás megkerülné az egész gazdaságot.
    id: 'counter',
    cityId: 'all',
    name: 'Kiszolgálópult',
    icon: 'hand',
    tiers: buildTiers({
      count: 8,
      baseCost: 900,
      costStep: 12,
      effectsAt: (tier) => [{ type: 'tapMultiplier', value: Math.pow(1.12, tier) }],
      labelAt: (tier) =>
        [
          'Faláda pult',
          'Rozsdamentes pult',
          'Széles pult',
          'Két kiadóablak',
          'Sorvezetős pult',
          'Három ablak',
          'Gyorskiadó sziget',
          'Villámpult',
        ][tier - 1] ?? `Pult ${tier}`,
      descriptionAt: (tier) => `${mult(Math.pow(1.12, tier))} érték minden kézi kiszolgálásra`,
    }),
  },
];

const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export function getEquipment(id: string): EquipmentDef {
  const equipment = EQUIPMENT_BY_ID.get(id);
  if (!equipment) throw new Error(`Ismeretlen gép: ${id}`);
  return equipment;
}

/** A következő megvehető szint, vagy null ha kimaxolt. */
export function nextTier(def: EquipmentDef, ownedTier: number): EquipmentTierDef | null {
  return def.tiers.find((t) => t.tier === ownedTier + 1) ?? null;
}

export function tierAt(def: EquipmentDef, tier: number): EquipmentTierDef | null {
  if (tier <= 0) return null;
  return def.tiers.find((t) => t.tier === tier) ?? null;
}
