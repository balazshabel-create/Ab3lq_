import {
  formatCountdown,
  formatDuration,
  formatMultiplier,
  formatNumber,
  formatPercent,
  suffixForTier,
} from '@/core/format';

describe('formatNumber', () => {
  it('kis számokat olvashatóan mutat', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(7.5)).toBe('7.5');
    expect(formatNumber(42.34)).toBe('42.3');
    expect(formatNumber(999)).toBe('999');
  });

  it('utótagot használ ezertől', () => {
    expect(formatNumber(1_000)).toBe('1 K');
    expect(formatNumber(1_500)).toBe('1.5 K');
    expect(formatNumber(1_000_000)).toBe('1 M');
    expect(formatNumber(2_500_000_000)).toBe('2.5 B');
  });

  it('nagyon nagy számoknál betűpárokra vált', () => {
    const huge = formatNumber(1e30);
    expect(huge).toMatch(/[a-z]{2}$/);
    expect(Number.isNaN(Number.parseFloat(huge))).toBe(false);
  });

  it('kezeli a negatív és a végtelen értéket', () => {
    expect(formatNumber(-1500)).toBe('-1.5 K');
    expect(formatNumber(Infinity)).toBe('∞');
  });

  it('sosem ad üres vagy NaN kimenetet', () => {
    for (let exponent = 0; exponent < 60; exponent += 1) {
      const output = formatNumber(Math.pow(10, exponent) * 1.234);
      expect(output.length).toBeGreaterThan(0);
      expect(output).not.toContain('NaN');
      expect(output).not.toContain('undefined');
    }
  });

  it('a tier-utótagok egyediek maradnak', () => {
    const seen = new Set<string>();
    for (let tier = 0; tier < 40; tier += 1) {
      const suffix = suffixForTier(tier);
      expect(seen.has(suffix)).toBe(false);
      seen.add(suffix);
    }
  });
});

describe('formatDuration', () => {
  it('másodperc, perc, óra, nap', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3600 * 2 + 60 * 14)).toBe('2h 14m');
    expect(formatDuration(86400 * 3)).toBe('3d');
  });

  it('negatív értéket nullaként kezel', () => {
    expect(formatDuration(-10)).toBe('0s');
  });
});

describe('formatCountdown', () => {
  it('perc:másodperc formátum', () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(9)).toBe('0:09');
  });

  it('óra:perc:másodperc egy óra felett', () => {
    expect(formatCountdown(3725)).toBe('1:02:05');
  });
});

describe('szorzó és százalék', () => {
  it('szorzó', () => {
    expect(formatMultiplier(2)).toBe('×2');
    expect(formatMultiplier(1.5)).toBe('×1.5');
  });

  it('százalék', () => {
    expect(formatPercent(0.25)).toBe('+25%');
    expect(formatPercent(0.03)).toBe('+3%');
    expect(formatPercent(0.25, false)).toBe('25%');
  });
});
