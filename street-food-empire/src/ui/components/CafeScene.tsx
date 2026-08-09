import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { formatMoney } from '@/core/format';
import { getCity } from '@/game/content/cities';
import { getProduct } from '@/game/content/products';
import { MAX_QUEUE, PATIENCE_SECONDS, type Customer } from '@/game/customers';
import type { ProductView } from '@/game/types';
import { CatSprite, WantBubble } from '@/ui/components/CatSprite';
import { FoodIcon } from '@/ui/components/FoodIcon';
import { PlayerCat, type CookState } from '@/ui/components/PlayerCat';
import type { CookingJob } from '@/game/store';
import { Text } from '@/ui/components/primitives';
import { DURATION, EASE, useJitter, useLoop, useReducedMotion } from '@/ui/motion';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * A KÁVÉZÓ – ez maga a játék képernyője
 *
 * Nem egy menü fölé tett dísz: ez tölti ki a képernyőt, és mindig fut. A
 * macskavendégek beérkeznek jobbról, sorba állnak a pultnál, vásárolnak,
 * majd balra elsétálnak. A pult mögött a sütőállomásokon gőzölög az étel.
 *
 * MOZGÁS
 *
 * Minden folyamatos animáció natív driverrel megy, és egyedi fáziseltolást
 * kap (`useJitter`), hogy semmi ne mozogjon szinkronban — a gépiesen egyszerre
 * lüktető elemek adják a „sablonból generált” érzetet. Amit animálunk:
 *
 *  · macska: lépegető ringás séta közben, lélegzés várakozáskor, ugrás
 *    kiszolgáláskor, lecsüggő fej csalódáskor
 *  · gőz: három, eltérő ütemű pamacs minden aktív állomás fölött
 *  · ponyva: alig észrevehető ringás, hogy a háttér ne legyen halott
 *  · pénz: a kiszolgáláskor felszálló összeg
 *  · lámpák: lassú pislákolás a városi sziluetten
 *
 * A Beállítások „csökkentett animáció” kapcsolója mindezt egyben leállítja.
 */

const ARRIVE_MS = 850;
const LEAVE_MS = 750;

type Props = {
  customers: readonly Customer[];
  views: readonly ProductView[];
  cityId: string;
  /** Amit a játékos macskája épp készít (null, ha nem főz). */
  cooking: CookingJob | null;
  onServe: (customerId: number) => void;
};

export const CafeScene = React.memo(function CafeScene({
  customers,
  views,
  cityId,
  cooking,
  onServe,
}: Props) {
  const { width } = useWindowDimensions();
  const city = getCity(cityId);
  const owned = views.filter((view) => view.state.level > 0);

  // A főzés haladása – a jelenet 5 Hz-en frissül, ez épp elég simának látszik.
  const now = Date.now();
  const cookProgress = cooking
    ? Math.max(0, Math.min(1, (now - cooking.startedAt) / cooking.duration))
    : 0;
  const cookState: CookState = cooking ? 'cooking' : 'idle';
  const cookingIcon = cooking
    ? views.find((view) => view.def.id === cooking.productId)?.def.icon
    : undefined;

  return (
    <View style={styles.scene}>
      <Backdrop colors={city.colors} />

      {/* Pavement: starts exactly at the counter's lower edge, the queue stands here. */}
      <View style={styles.sidewalk} pointerEvents="none">
        <View style={styles.curb} />
      </View>

      <Awning colors={city.colors} />

      {/* --- The chef: that is YOU, behind the counter --- */}
      <View style={styles.playerSlot} pointerEvents="none">
        <PlayerCat
          state={cookState}
          progress={cookProgress}
          cookingIcon={cookingIcon}
          cityColors={city.colors}
          size={104}
        />
      </View>

      <View style={styles.stations} pointerEvents="none">
        {owned.slice(0, 6).map((view, index) => (
          <CookStation key={view.def.id} view={view} colors={city.colors} index={index} />
        ))}
      </View>

      <Counter colors={city.colors} />

      <View style={styles.queue} pointerEvents="box-none">
        {customers.map((customer) => (
          <QueueCat
            key={customer.id}
            customer={customer}
            laneWidth={width}
            busy={cooking?.customerId === customer.id}
            onServe={onServe}
          />
        ))}
      </View>

      {customers.length === 0 ? <EmptyHint /> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Háttér
// ---------------------------------------------------------------------------

const Backdrop = React.memo(function Backdrop({
  colors,
}: {
  colors: readonly [string, string];
}) {
  // Lassú pislákolás az ablakokon – a város „él”, de nem vonja el a figyelmet.
  const glow = useLoop(2600);
  const windowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 640" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors[0]} stopOpacity={0.5} />
            <Stop offset="0.4" stopColor={colors[1]} stopOpacity={0.24} />
            <Stop offset="0.75" stopColor="#15131F" stopOpacity={1} />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="400" height="640" fill="url(#sky)" />

        {/* Hold */}
        <Circle cx="322" cy="74" r="26" fill="#FFF4D8" opacity={0.14} />
        <Circle cx="314" cy="68" r="22" fill="#FFF4D8" opacity={0.2} />

        {/* City skyline */}
        <G opacity={0.35} fill="#0C0A14">
          <Rect x="-4" y="180" width="58" height="240" rx="3" />
          <Rect x="62" y="132" width="44" height="288" rx="3" />
          <Rect x="114" y="204" width="66" height="216" rx="3" />
          <Rect x="188" y="152" width="50" height="268" rx="3" />
          <Rect x="246" y="222" width="58" height="198" rx="3" />
          <Rect x="312" y="168" width="48" height="252" rx="3" />
          <Rect x="368" y="210" width="40" height="210" rx="3" />
        </G>
      </Svg>

      {/* Windows on their own layer so their opacity can be animated */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: windowOpacity }]}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 640" preserveAspectRatio="xMidYMid slice">
          <G fill={colors[0]}>
            {WINDOWS.map(([x, y], index) => (
              <Rect key={index} x={x} y={y} width="7" height="10" rx="1.5" />
            ))}
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
});

/** Az ablakok pozíciói – kézzel szórva, hogy ne legyen rácsos a mintázat. */
const WINDOWS: readonly (readonly [number, number])[] = [
  [10, 198], [30, 232], [12, 268], [74, 150], [90, 186], [76, 226], [92, 268],
  [126, 220], [148, 252], [130, 288], [200, 170], [216, 206], [198, 244],
  [258, 240], [278, 276], [324, 186], [340, 224], [326, 262], [378, 228],
];

/** A ponyva alig érzékelhető ringása – ettől nem hat kartonpapírnak a háttér. */
const Awning = React.memo(function Awning({
  colors,
}: {
  colors: readonly [string, string];
}) {
  const sway = useLoop(3400);
  const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: ['-0.35deg', '0.35deg'] });

  const stripes = 9;
  const stripeWidth = 400 / stripes;

  return (
    <Animated.View style={[styles.awning, { transform: [{ rotate }] }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 60" preserveAspectRatio="none">
        {Array.from({ length: stripes }).map((_, index) => (
          <Rect
            key={index}
            x={index * stripeWidth}
            y={0}
            width={stripeWidth}
            height={40}
            fill={index % 2 === 0 ? colors[0] : colors[1]}
          />
        ))}
        {/* Scalloped lower edge */}
        <Path
          d={Array.from({ length: stripes })
            .map((_, i) => {
              const x = i * stripeWidth;
              return `M${x} 40 Q${x + stripeWidth / 2} 58 ${x + stripeWidth} 40`;
            })
            .join(' ')}
          fill="#15131F"
          opacity={0.25}
        />
      </Svg>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Pult
// ---------------------------------------------------------------------------

const Counter = React.memo(function Counter({
  colors,
}: {
  colors: readonly [string, string];
}) {
  return (
    <Svg style={styles.counter} viewBox="0 0 400 150" preserveAspectRatio="none" pointerEvents="none">
      {/* Pultlap */}
      <Rect x="0" y="0" width="400" height="14" rx="4" fill={colors[0]} opacity={0.85} />
      {/* Test */}
      <Rect x="0" y="12" width="400" height="138" fill="#2A2540" />
      <Rect x="0" y="12" width="400" height="5" fill="#3B3457" />
      {/* Vertical slats */}
      <G opacity={0.22} stroke="#0F0D18" strokeWidth={1.5}>
        {Array.from({ length: 13 }).map((_, index) => (
          <Path key={index} d={`M${index * 32 + 16} 18 V150`} />
        ))}
      </G>
      {/* Warm yellow glow of the serving window */}
      <Rect x="128" y="26" width="144" height="34" rx="8" fill="#F2C94C" opacity={0.16} />
      {/* Menu board */}
      <G opacity={0.6}>
        <Rect x="300" y="34" width="62" height="42" rx="4" fill="#1A1626" />
        <G stroke="#7E7699" strokeWidth={2} strokeLinecap="round">
          <Path d="M310 46h42M310 55h34M310 64h38" />
        </G>
      </G>
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// Sütőállomás gőzzel
// ---------------------------------------------------------------------------

const CookStation = React.memo(function CookStation({
  view,
  colors,
  index,
}: {
  view: ProductView;
  colors: readonly [string, string];
  index: number;
}) {
  const progress = Math.max(0, Math.min(1, view.displayProgress));
  const automated = view.state.hasManager;
  const active = automated || progress > 0.02;

  return (
    <View style={styles.station}>
      {active ? <Steam seed={index} /> : null}

      <View style={[styles.stationPlate, automated && { borderColor: palette.success }]}>
        <FoodIcon name={view.def.icon} size={26} colors={colors} />
      </View>

      <View style={styles.stationBar}>
        <View
          style={[
            styles.stationFill,
            {
              width: `${progress * 100}%`,
              backgroundColor: automated ? palette.success : palette.primary,
            },
          ]}
        />
      </View>
    </View>
  );
});

/** Három, eltérő ütemű gőzpamacs. */
const Steam = React.memo(function Steam({ seed }: { seed: number }) {
  return (
    <View style={styles.steam} pointerEvents="none">
      <SteamPuff seed={seed * 3 + 0} offset={-7} />
      <SteamPuff seed={seed * 3 + 1} offset={0} />
      <SteamPuff seed={seed * 3 + 2} offset={7} />
    </View>
  );
});

const SteamPuff = React.memo(function SteamPuff({
  seed,
  offset,
}: {
  seed: number;
  offset: number;
}) {
  const jitter = useJitter(seed);
  const loop = useLoop(1500 + jitter * 900, jitter * 700);

  const translateY = loop.interpolate({ inputRange: [0, 1], outputRange: [4, -18] });
  const opacity = loop.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.5, 0] });
  const scale = loop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] });

  return (
    <Animated.View
      style={[
        styles.puff,
        { left: 14 + offset, opacity, transform: [{ translateY }, { scale }] },
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// Sorban álló macska
// ---------------------------------------------------------------------------

function slotOffset(slot: number, laneWidth: number): number {
  const start = laneWidth * 0.1;
  const step = Math.min(70, (laneWidth * 0.66) / MAX_QUEUE);
  return start + slot * step;
}

const QueueCat = React.memo(function QueueCat({
  customer,
  laneWidth,
  busy,
  onServe,
}: {
  customer: Customer;
  laneWidth: number;
  /** Igaz, ha épp az ő rendelése készül. */
  busy: boolean;
  onServe: (customerId: number) => void;
}) {
  const reduced = useReducedMotion();
  const jitter = useJitter(customer.id);

  const targetX = slotOffset(customer.slot, laneWidth);
  const enterX = laneWidth + 30;
  const exitX = -90;

  const translateX = useRef(new Animated.Value(enterX)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;

  const walking = customer.phase === 'arriving' || customer.phase === 'leaving';

  // Séta közben ringás, álldogálva lélegzés – két külön ütem.
  const stride = useLoop(walking ? 210 : 1700 + jitter * 500, jitter * 300);
  const bob = stride.interpolate({
    inputRange: [0, 1],
    outputRange: walking ? [0, -5] : [0, -2],
  });
  const lean = stride.interpolate({
    inputRange: [0, 1],
    outputRange: walking ? ['-3deg', '3deg'] : ['0deg', '0deg'],
  });

  // --- Érkezés / sorban előrelépés / távozás ---
  useEffect(() => {
    if (customer.phase === 'leaving') {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: exitX,
          duration: reduced ? 0 : LEAVE_MS,
          easing: EASE.in,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: reduced ? 0 : LEAVE_MS,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(translateX, {
        toValue: targetX,
        duration: reduced ? 0 : ARRIVE_MS,
        easing: EASE.out,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduced ? 0 : DURATION.quick,
        useNativeDriver: true,
      }),
    ]).start();
  }, [customer.phase, targetX, translateX, opacity, exitX, reduced]);

  // --- Örömugrás kiszolgáláskor ---
  useEffect(() => {
    if (customer.phase !== 'served' || reduced) return;
    Animated.sequence([
      Animated.timing(hop, {
        toValue: -14,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(hop, {
        toValue: 0,
        duration: 260,
        easing: Easing.bounce,
        useNativeDriver: true,
      }),
    ]).start();
  }, [customer.phase, hop, reduced]);

  const def = getProduct(customer.productId);
  const city = getCity(def.cityId);

  const mood =
    customer.phase === 'served'
      ? 'happy'
      : customer.phase === 'leaving' && !customer.happy
        ? 'sad'
        : 'neutral';

  // A koppintható vendég körül lüktető gyűrű: ez mondja meg, hol a dolgod.
  const needsMe = customer.phase === 'waiting' && !busy;
  const ring = useLoop(900);
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.12] });

  const showBubble = customer.phase === 'waiting' || customer.phase === 'arriving';
  const patienceRatio = Math.max(0, Math.min(1, customer.patience / PATIENCE_SECONDS));
  const waitingForTap = customer.phase === 'waiting' && patienceRatio < 1;
  const urgent = waitingForTap && patienceRatio < 0.34;

  return (
    <Animated.View
      style={[styles.cat, { opacity, transform: [{ translateX }, { translateY: hop }] }]}
    >
      {showBubble ? (
        <Animated.View style={[styles.bubbleWrap, { transform: [{ translateY: bob }] }]}>
          <WantBubble size={40} urgent={urgent} />
          <View style={styles.bubbleIcon} pointerEvents="none">
            <FoodIcon name={def.icon} size={20} colors={city.colors} />
          </View>
        </Animated.View>
      ) : null}

      {customer.phase === 'served' && customer.payout > 0 ? (
        <FloatingPayout amount={customer.payout} />
      ) : null}

      <Pressable
        onPress={() => onServe(customer.id)}
        disabled={customer.phase !== 'waiting'}
        accessibilityRole="button"
        accessibilityLabel={`Cook ${def.name} for the customer`}
        accessibilityHint="Tap and your chef will cook the order"
        hitSlop={14}
      >
        {needsMe ? (
          <Animated.View
            style={[
              styles.tapRing,
              { opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
            pointerEvents="none"
          />
        ) : null}

        <Animated.View style={{ transform: [{ translateY: bob }, { rotate: lean }] }}>
          <CatSprite look={customer.look} size={62} mood={mood} />
        </Animated.View>

        {waitingForTap ? (
          <View style={styles.patienceBar}>
            <View
              style={[
                styles.patienceFill,
                {
                  width: `${patienceRatio * 100}%`,
                  backgroundColor: urgent ? palette.danger : palette.accent,
                },
              ]}
            />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
});

/** A kiszolgáláskor felszálló összeg. */
const FloatingPayout = React.memo(function FloatingPayout({ amount }: { amount: number }) {
  const rise = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      rise.setValue(0.5);
      return;
    }
    Animated.timing(rise, {
      toValue: 1,
      duration: 900,
      easing: EASE.out,
      useNativeDriver: true,
    }).start();
  }, [rise, reduced]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -34] });
  const opacity = rise.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] });

  return (
    <Animated.View
      style={[styles.payout, { opacity, transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <Text variant="label" color={palette.success}>
        +{formatMoney(amount)}
      </Text>
    </Animated.View>
  );
});

/** Üres sor – lassan pulzáló segítő felirat. */
const EmptyHint = React.memo(function EmptyHint() {
  const pulse = useLoop(1600);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });

  return (
    <Animated.View style={[styles.emptyHint, { opacity }]} pointerEvents="none">
      <Text variant="caption" color="#FFFFFF">
        Unlock a product and the customers will come…
      </Text>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  /**
   * ELRENDEZÉS: minden réteg a jelenet ALJÁHOZ van igazítva, nem
   * százalékhoz.
   *
   * Százalékos pozíciókkal a bódé és a járda különböző képernyőmagasságoknál
   * elcsúszott egymástól, és üres sávok maradtak közöttük. Alsó igazítással a
   * kompozíció együtt marad: járda → pult → sütők → ponyva egymásra épül, és
   * csak a fölöttük lévő égbolt nyúlik meg magasabb kijelzőn.
   */
  scene: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#15131F',
  },
  sidewalk: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 240,
    backgroundColor: '#221D30',
  },
  curb: {
    height: 3,
    backgroundColor: '#3A3350',
  },
  counter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 240,
    height: 140,
  },
  awning: {
    position: 'absolute',
    left: -8,
    right: -8,
    bottom: 470,
    height: 58,
  },
  playerSlot: {
    position: 'absolute',
    left: '4%',
    /**
     * A pult felső éle 380 px-re van a jelenet aljától. A macska 104 px
     * magas, és a feje a sprite felső ~45%-án ül, ezért 352-nél a fej és a
     * mellkas a pult fölé kerül, a dereka mögé — pont, mint egy valódi
     * kiszolgálónál. Feljebb lebegne, lejjebb csak a sapkája látszana.
     */
    bottom: 352,
  },
  stations: {
    position: 'absolute',
    // A bal oldalt a szakács foglalja – a sütők mellé sorakoznak.
    left: '36%',
    right: 0,
    // A sütők a pult lapján állnak (a pult teteje 380).
    bottom: 384,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  station: {
    alignItems: 'center',
    width: 44,
  },
  stationPlate: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(15,13,24,0.86)',
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationBar: {
    marginTop: 5,
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  stationFill: {
    height: '100%',
    borderRadius: 2,
  },
  steam: {
    position: 'absolute',
    top: -20,
    left: 0,
    right: 0,
    height: 24,
  },
  puff: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  queue: {
    position: 'absolute',
    left: 0,
    right: 0,
    /**
     * KRITIKUS: az alsó dokk a jelenet fölött lebeg. Ha a sor alá kerülne,
     * a macskákra egyszerűen nem lehetne koppintani — pontosan ez tette
     * korábban játszhatatlanná a játékot.
     */
    bottom: 108,
    height: 104,
  },
  cat: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    alignItems: 'center',
  },
  /** Lüktető gyűrű a koppintható vendég körül – ez mutatja, hol a dolgod. */
  tapRing: {
    position: 'absolute',
    left: -6,
    right: -6,
    top: -6,
    bottom: -6,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: palette.accent,
  },
  bubbleWrap: {
    position: 'absolute',
    top: -38,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  bubbleIcon: {
    position: 'absolute',
    top: 5,
    left: 10,
  },
  payout: {
    position: 'absolute',
    top: -28,
    alignSelf: 'center',
  },
  patienceBar: {
    marginTop: 3,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  patienceFill: {
    height: '100%',
    borderRadius: 2,
  },
  emptyHint: {
    position: 'absolute',
    bottom: 18,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
