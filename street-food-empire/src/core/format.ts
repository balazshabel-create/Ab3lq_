/**
 * Szám- és időformázás.
 *
 * Az idle játékok számai gyorsan túlnőnek a Number.MAX_SAFE_INTEGER-en, de a
 * dupla pontosságú lebegőpontos szám ~1e308-ig elvisz, ami bőven elég: a
 * relatív hiba 1e-16 nagyságrendű, ami a kijelzett 3-4 értékes jegyet nem
 * érinti. Ezért végig sima `number`-t használunk (nem BigInt / custom decimal),
 * mert az gyenge telefonon is nagyságrendekkel gyorsabb.
 */

/** Rövid skála: ezer, millió, milliárd, billió... */
const SHORT_SUFFIXES = ['', 'E', 'M', 'Mrd', 'B', 'BM', 'T', 'TM'] as const;

/** A rövid skála után betűpárokkal folytatjuk: aa, ab, ac ... zz */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function alphaSuffix(tier: number): string {
  // tier 0 -> 'aa', 1 -> 'ab', ... 26 -> 'ba'
  const first = Math.floor(tier / 26) % 26;
  const second = tier % 26;
  return `${ALPHABET[first] ?? 'z'}${ALPHABET[second] ?? 'z'}`;
}

/** A 3 jegyű csoportnak megfelelő utótag (1000^tier). */
export function suffixForTier(tier: number): string {
  if (tier < SHORT_SUFFIXES.length) return SHORT_SUFFIXES[tier] ?? '';
  return alphaSuffix(tier - SHORT_SUFFIXES.length);
}

/**
 * Pénz / nagy szám formázása: `1,23 M`, `945 E`, `12`.
 * Mindig legfeljebb 4 karakternyi számjegyet mutat, hogy a UI ne ugráljon.
 */
export function formatNumber(value: number, opts: { decimals?: number } = {}): string {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs < 1000) {
    // 0–999: egész, kivéve ha nagyon kicsi (pl. bevétel/mp induláskor)
    if (abs === 0) return '0';
    if (abs < 10) return sign + trimZeros(abs.toFixed(opts.decimals ?? 2));
    if (abs < 100) return sign + trimZeros(abs.toFixed(opts.decimals ?? 1));
    return sign + Math.floor(abs).toString();
  }

  const tier = Math.floor(Math.log10(abs) / 3);
  const scaled = abs / Math.pow(1000, tier);
  // A log10 kerekítési hibája miatt a skálázott érték ritkán 1000 fölé csúszhat.
  const [finalScaled, finalTier] = scaled >= 1000 ? [scaled / 1000, tier + 1] : [scaled, tier];

  const decimals = finalScaled < 10 ? 2 : finalScaled < 100 ? 1 : 0;
  return `${sign}${trimZeros(finalScaled.toFixed(decimals))} ${suffixForTier(finalTier)}`;
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/** Pénz formázása pénznem-jelöléssel. */
export function formatMoney(value: number): string {
  return `${formatNumber(value)} Ft`;
}

/** Bevétel/másodperc formázása. */
export function formatRate(value: number): string {
  return `${formatNumber(value)} Ft/mp`;
}

/** Szorzó formázása: `×2`, `×1,5`, `×12,4 E`. */
export function formatMultiplier(value: number): string {
  if (value >= 1000) return `×${formatNumber(value)}`;
  const rounded = Math.round(value * 100) / 100;
  return `×${trimZeros(rounded.toFixed(2))}`;
}

/** Százalék: 0.25 -> `+25%` */
export function formatPercent(fraction: number, withSign = true): string {
  const pct = fraction * 100;
  const decimals = Math.abs(pct) < 10 ? 1 : 0;
  const body = `${trimZeros(pct.toFixed(decimals))}%`;
  return withSign && pct > 0 ? `+${body}` : body;
}

/**
 * Időtartam formázása másodpercből: `2 ó 14 p`, `45 mp`, `3 nap 2 ó`.
 * Az idle játék visszatérési képernyőjén ez a legfontosabb szöveg.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 mp';
  const s = Math.floor(seconds);
  if (s < 60) return `${s} mp`;

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (days > 0) return hours > 0 ? `${days} nap ${hours} ó` : `${days} nap`;
  if (hours > 0) return minutes > 0 ? `${hours} ó ${minutes} p` : `${hours} ó`;
  return secs > 0 ? `${minutes} p ${secs} mp` : `${minutes} p`;
}

/** Visszaszámláló: `12:04`, `1:02:11`. Boosterek maradék idejéhez. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
