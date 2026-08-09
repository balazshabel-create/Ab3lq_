/**
 * Number and duration formatting.
 *
 * Idle-game numbers outgrow Number.MAX_SAFE_INTEGER quickly, but a double goes
 * up to ~1e308, which is plenty: the relative error is around 1e-16, which
 * never touches the 3-4 significant digits we display. So we use plain
 * `number` throughout (no BigInt / custom decimal), because that is orders of
 * magnitude faster on a weak phone.
 */

/** Short scale: thousand, million, billion, trillion... */
const SHORT_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'] as const;

/** After the short scale we continue with letter pairs: aa, ab, ac ... zz */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function alphaSuffix(tier: number): string {
  // tier 0 -> 'aa', 1 -> 'ab', ... 26 -> 'ba'
  const first = Math.floor(tier / 26) % 26;
  const second = tier % 26;
  return `${ALPHABET[first] ?? 'z'}${ALPHABET[second] ?? 'z'}`;
}

/** Suffix for the given group of three digits (1000^tier). */
export function suffixForTier(tier: number): string {
  if (tier < SHORT_SUFFIXES.length) return SHORT_SUFFIXES[tier] ?? '';
  return alphaSuffix(tier - SHORT_SUFFIXES.length);
}

/**
 * Formats money / big numbers: `1.23 M`, `945 K`, `12`.
 * Always shows at most 4 digit characters so the UI does not jitter.
 */
export function formatNumber(value: number, opts: { decimals?: number } = {}): string {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs < 1000) {
    // 0-999: whole number, unless very small (e.g. income/s at the start)
    if (abs === 0) return '0';
    if (abs < 10) return sign + trimZeros(abs.toFixed(opts.decimals ?? 2));
    if (abs < 100) return sign + trimZeros(abs.toFixed(opts.decimals ?? 1));
    return sign + Math.floor(abs).toString();
  }

  const tier = Math.floor(Math.log10(abs) / 3);
  const scaled = abs / Math.pow(1000, tier);
  // Rounding error in log10 can rarely push the scaled value above 1000.
  const [finalScaled, finalTier] = scaled >= 1000 ? [scaled / 1000, tier + 1] : [scaled, tier];

  const decimals = finalScaled < 10 ? 2 : finalScaled < 100 ? 1 : 0;
  return `${sign}${trimZeros(finalScaled.toFixed(decimals))} ${suffixForTier(finalTier)}`;
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/**
 * Formats money with the currency symbol.
 *
 * Dollars match the international release, and the `$` prefix is shorter than
 * any suffix - which matters in an idle game, because the number already
 * carries a magnitude suffix (e.g. `$1.2 M`).
 */
export function formatMoney(value: number): string {
  return `$${formatNumber(value)}`;
}

/** Income per second. */
export function formatRate(value: number): string {
  return `$${formatNumber(value)}/s`;
}

/** Multiplier formatting: `x2`, `x1.5`, `x12.4 K`. */
export function formatMultiplier(value: number): string {
  if (value >= 1000) return `×${formatNumber(value)}`;
  const rounded = Math.round(value * 100) / 100;
  return `×${trimZeros(rounded.toFixed(2))}`;
}

/** Percentage: 0.25 -> `+25%` */
export function formatPercent(fraction: number, withSign = true): string {
  const pct = fraction * 100;
  const decimals = Math.abs(pct) < 10 ? 1 : 0;
  const body = `${trimZeros(pct.toFixed(decimals))}%`;
  return withSign && pct > 0 ? `+${body}` : body;
}

/**
 * Duration formatting from seconds: `2h 14m`, `45s`, `3d 2h`.
 * This is the most important text on the idle game's welcome-back screen.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
}

/** Countdown: `12:04`, `1:02:11`. Used for booster time remaining. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
