import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { useGameStore } from '@/game/store';

/**
 * MOZGÁS-ESZKÖZKÉSZLET
 *
 * Minden animáció innen jön, három okból:
 *  1. **Egységes tempó** – ha minden komponens saját időzítést talál ki, a
 *     felület kapkodónak és összeszedetlennek hat.
 *  2. **Natív driver** – itt minden `useNativeDriver: true`-val fut, tehát a
 *     JS szál akadása (nagy vásárlás, mentés) nem akasztja meg a mozgást.
 *  3. **Csökkentett animáció** – a Beállítások kapcsolója egyetlen helyen
 *     tud minden folyamatos mozgást leállítani, gyenge készülékhez és
 *     akadálymentesítéshez.
 */

/** Egységes időzítések (ms). Ezek adják a játék „ritmusát”. */
export const DURATION = {
  /** Gombnyomás, apró visszajelzés. */
  instant: 120,
  /** Megjelenés, eltűnés. */
  quick: 220,
  /** Panelek, nagyobb átmenetek. */
  panel: 340,
  /** Séta, folyamatos mozgás egy ciklusa. */
  stroll: 900,
} as const;

/** Természetesebb, kicsit rugós lassulás – nem a beépített lineáris érzet. */
export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Enyhe túllövés – jutalmakhoz, felugró elemekhez. */
  pop: Easing.bezier(0.34, 1.56, 0.64, 1),
} as const;

/** Kikapcsolta-e a játékos a folyamatos animációkat? */
export function useReducedMotion(): boolean {
  return useGameStore((s) => s.state.settings.reducedMotion);
}

/**
 * Végtelenített oda-vissza animáció 0 → 1 → 0 között.
 *
 * Ez adja a jelenet „életét”: lélegző macskák, gomolygó gőz, ringó ponyva.
 * Csökkentett animáció mellett egyszerűen áll (0-n marad), és a ciklus el sem
 * indul – tehát nem is fogyaszt.
 */
export function useLoop(durationMs: number, delayMs = 0): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      value.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(value, {
          toValue: 1,
          duration: durationMs,
          easing: EASE.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: durationMs,
          easing: EASE.inOut,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [value, durationMs, delayMs, reduced]);

  return value;
}

/**
 * Egy értékhez kötött „pop”: valahányszor a `trigger` változik, a skála
 * felugrik, majd visszaáll. A pénzkijelzőnél és a jutalmaknál használjuk.
 */
export function usePop(trigger: unknown, strength = 0.16): Animated.Value {
  const value = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;

    value.setValue(1 + strength);
    Animated.timing(value, {
      toValue: 1,
      duration: DURATION.quick,
      easing: EASE.pop,
      useNativeDriver: true,
    }).start();
  }, [trigger, value, strength, reduced]);

  return value;
}

/** Belépő animáció: alulról felúszik és beúszik. */
export function useEnter(delayMs = 0): { opacity: Animated.Value; translateY: Animated.Value } {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: DURATION.quick,
        delay: delayMs,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: DURATION.panel,
        delay: delayMs,
        easing: EASE.out,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, delayMs, reduced]);

  return { opacity, translateY };
}

/**
 * Stabil, elemhez kötött véletlen 0..1 – ebből származtatjuk az egyedi
 * fáziseltolást, hogy a macskák ne egyszerre lélegezzenek, és a gőz ne
 * egyszerre gomolyogjon. Enélkül a jelenet gépiesen „szinkronban” mozogna.
 */
export function useJitter(seed: number): number {
  return useMemo(() => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }, [seed]);
}
