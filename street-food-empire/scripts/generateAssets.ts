/**
 * Ikon- és splash-generátor.
 *
 * A projekt SEMMILYEN külső képi anyagot nem használ – az app ikonja és a
 * splash képe is kódból készül. Így nincs licencprobléma, és a márkaszínek
 * egyetlen helyen módosíthatók (src/ui/theme.ts).
 *
 * Futtatás:  npx tsx scripts/generateAssets.ts
 *
 * Kimenet:
 *   assets/icon.png           1024×1024  (App Store / Play Store ikon)
 *   assets/adaptive-icon.png  1024×1024  (Android adaptív előtér)
 *   assets/splash.png          512×512   (indítóképernyő logó)
 *   assets/favicon.png          48×48    (web)
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Rgba = [number, number, number, number];

const BG: Rgba = [18, 16, 26, 255]; // palette.bg
const PRIMARY: Rgba = [242, 153, 74, 255]; // palette.primary
const SECONDARY: Rgba = [235, 87, 87, 255]; // palette.secondary
const ACCENT: Rgba = [242, 201, 76, 255]; // palette.accent
const TRANSPARENT: Rgba = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// Minimális PNG-író (RGBA, szűrő nélkül)
// ---------------------------------------------------------------------------

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  // Minden sor elé egy 0-s szűrőbájt kell.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width * 4; x += 1) {
      raw[y * (width * 4 + 1) + 1 + x] = pixels[y * width * 4 + x] ?? 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bitmélység
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Rajzolás
// ---------------------------------------------------------------------------

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly size: number,
    background: Rgba,
  ) {
    this.pixels = new Uint8Array(size * size * 4);
    this.fill(() => background);
  }

  fill(shader: (x: number, y: number) => Rgba): void {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        this.set(x, y, shader(x, y));
      }
    }
  }

  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const index = (y * this.size + x) * 4;
    const alpha = color[3] / 255;
    if (alpha >= 1) {
      this.pixels[index] = color[0];
      this.pixels[index + 1] = color[1];
      this.pixels[index + 2] = color[2];
      this.pixels[index + 3] = 255;
      return;
    }
    // Egyszerű alfa-keverés a meglévő pixellel (élsimításhoz).
    const inverse = 1 - alpha;
    this.pixels[index] = Math.round(color[0] * alpha + (this.pixels[index] ?? 0) * inverse);
    this.pixels[index + 1] = Math.round(
      color[1] * alpha + (this.pixels[index + 1] ?? 0) * inverse,
    );
    this.pixels[index + 2] = Math.round(
      color[2] * alpha + (this.pixels[index + 2] ?? 0) * inverse,
    );
    this.pixels[index + 3] = Math.max(this.pixels[index + 3] ?? 0, color[3]);
  }

  /** Kitöltött kör, élsimítással. */
  circle(cx: number, cy: number, radius: number, color: Rgba): void {
    const left = Math.max(0, Math.floor(cx - radius - 1));
    const right = Math.min(this.size - 1, Math.ceil(cx + radius + 1));
    const top = Math.max(0, Math.floor(cy - radius - 1));
    const bottom = Math.min(this.size - 1, Math.ceil(cy + radius + 1));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const coverage = Math.max(0, Math.min(1, radius - distance + 0.5));
        if (coverage > 0) {
          this.set(x, y, [color[0], color[1], color[2], Math.round(color[3] * coverage)]);
        }
      }
    }
  }

  /** Lekerekített téglalap. */
  roundedRect(
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    color: Rgba,
  ): void {
    for (let y = Math.floor(top); y < top + height; y += 1) {
      for (let x = Math.floor(left); x < left + width; x += 1) {
        const dx = Math.max(left + radius - x, x - (left + width - radius), 0);
        const dy = Math.max(top + radius - y, y - (top + height - radius), 0);
        const distance = Math.hypot(dx, dy);
        const coverage = Math.max(0, Math.min(1, radius - distance + 0.5));
        if (distance <= radius || (dx === 0 && dy === 0)) {
          const alpha = dx === 0 && dy === 0 ? 1 : coverage;
          this.set(x, y, [color[0], color[1], color[2], Math.round(color[3] * alpha)]);
        }
      }
    }
  }
}

/**
 * A logó: egy stilizált utcai kocsi — ponyva (csíkos), pult és két kerék.
 * Szándékosan mértani, hogy bármilyen méretben felismerhető maradjon.
 *
 * A rajz egy 1024×1024-es rácsban van megtervezve, és `fill` arányban
 * skálázódik a vászonra: `fill = 1` esetén a logó a vászon teljes
 * szélességét kitöltené, 0,78 a kényelmes ikonmargó.
 *
 * A logó függőlegesen szimmetrikus a középpontra (ponyva teteje -250,
 * kerekek alja +248), ezért nem kell külön függőleges igazítás.
 */
function drawLogo(canvas: Canvas, fill = 0.78): void {
  // A tervezési szélesség 560 egység az 1024-es rácsban.
  const scale = (canvas.size * fill) / 560;
  const s = (value: number) => value * scale;
  const cy = canvas.size / 2;
  const cx = canvas.size / 2;

  // Ponyva (csíkos tető)
  const awningWidth = s(560);
  const awningHeight = s(150);
  const awningLeft = cx - awningWidth / 2;
  const awningTop = cy - s(250);

  const stripes = 7;
  const stripeWidth = awningWidth / stripes;
  for (let i = 0; i < stripes; i += 1) {
    canvas.roundedRect(
      awningLeft + i * stripeWidth,
      awningTop,
      stripeWidth,
      awningHeight,
      s(12),
      i % 2 === 0 ? PRIMARY : SECONDARY,
    );
  }

  // Pult
  canvas.roundedRect(cx - s(240), cy - s(80), s(480), s(240), s(28), [
    38, 34, 56, 255,
  ]);

  // Kiadóablak
  canvas.roundedRect(cx - s(150), cy - s(30), s(300), s(130), s(18), ACCENT);

  // Kerekek
  canvas.circle(cx - s(150), cy + s(190), s(58), [38, 34, 56, 255]);
  canvas.circle(cx + s(150), cy + s(190), s(58), [38, 34, 56, 255]);
  canvas.circle(cx - s(150), cy + s(190), s(24), PRIMARY);
  canvas.circle(cx + s(150), cy + s(190), s(24), PRIMARY);
}

// ---------------------------------------------------------------------------
// Kimenetek
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
mkdirSync(assetsDir, { recursive: true });

function write(name: string, buffer: Buffer): void {
  const target = join(assetsDir, name);
  writeFileSync(target, buffer);
  console.log(`✓ ${name} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

// 1. App ikon: teli háttér + logó
{
  const canvas = new Canvas(1024, BG);
  drawLogo(canvas, 0.78);
  write('icon.png', encodePng(1024, 1024, canvas.pixels));
}

// 2. Android adaptív előtér: a rendszer a kép 66%-át vágja ki maszkkal,
//    ezért itt jóval kisebb a logó — így semmi nem lóg le a maszk szélén.
{
  const canvas = new Canvas(1024, TRANSPARENT);
  drawLogo(canvas, 0.5);
  write('adaptive-icon.png', encodePng(1024, 1024, canvas.pixels));
}

// 3. Splash logó: átlátszó háttér (a hátteret az app.config adja)
{
  const canvas = new Canvas(512, TRANSPARENT);
  drawLogo(canvas, 0.86);
  write('splash.png', encodePng(512, 512, canvas.pixels));
}

// 4. Web favicon
{
  const canvas = new Canvas(48, BG);
  drawLogo(canvas, 0.86);
  write('favicon.png', encodePng(48, 48, canvas.pixels));
}

console.log('\nKész. Az ikonok a assets/ mappában vannak.');
