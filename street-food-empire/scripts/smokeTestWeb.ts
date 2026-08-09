/**
 * FÜSTTESZT A WEB-ELŐNÉZETHEZ
 *
 * Betölti a `dist/preview.html`-t egy fejnélküli böngészőben, végigjátszik pár
 * alapvető interakciót, és képernyőképet készít. Így nem "vakon" osztunk meg
 * egy buildet: ha egy natív modul webre nem megy át, itt kiderül.
 *
 * Futtatás:  npx tsx scripts/smokeTestWeb.ts
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const previewPath = join(here, '..', 'dist', 'preview.html');
const shotDir = join(here, '..', 'dist', 'shots');

if (!existsSync(previewPath)) {
  throw new Error('Nincs dist/preview.html – futtasd előbb: npx tsx scripts/buildWebPreview.ts');
}
mkdirSync(shotDir, { recursive: true });

const errors: string[] = [];
const warnings: string[] = [];

/**
 * Az előtelepített Chromium megkeresése.
 *
 * A CI-környezetben a böngésző a PLAYWRIGHT_BROWSERS_PATH alatt van, de a
 * verziószám nem feltétlenül egyezik a telepített playwright csomagéval —
 * ilyenkor a `launch()` letöltéssel próbálkozna. Ezért közvetlenül megadjuk
 * a futtatható állományt, ha megtaláljuk.
 */
function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;

  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(root, entry, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function main(): Promise<void> {
  const executablePath = findChromium();
  console.log(`Böngésző: ${executablePath ?? '(playwright alapértelmezett)'}`);

  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') errors.push(text);
    if (message.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`file://${previewPath}`, { waitUntil: 'load' });

  // A játék betöltése aszinkron (mentés olvasása), várunk a fő képernyőre.
  await page.waitForFunction(
    () => document.body.innerText.includes('AKTUÁLIS HELYSZÍN'),
    { timeout: 20_000 },
  );

  const shot = async (name: string) => {
    await page.screenshot({ path: join(shotDir, `${name}.png`) });
  };

  await page.waitForTimeout(600);
  await shot('01-stand');

  // --- Kézi kiszolgálás: a bevételnek nőnie kell ---
  const readCash = () =>
    page.evaluate(() => {
      const match = document.body.innerText.match(/([\d\s.,]+(?:\s?[A-Za-z]+)?)\s*Ft/);
      return match?.[1]?.trim() ?? '';
    });

  const cashBefore = await readCash();
  for (let i = 0; i < 6; i += 1) {
    await page.getByLabel(/kiszolgálása/).first().click({ force: true });
    await page.waitForTimeout(1100); // a kiszolgálási várakozás miatt
  }
  const cashAfter = await readCash();
  await shot('02-after-taps');

  // --- Fülváltás minden képernyőre ---
  for (const [label, name] of [
    ['Gépek', '03-gepek'],
    ['Csapat', '04-csapat'],
    ['Városok', '05-varosok'],
    ['Küldetés', '06-kuldetes'],
    ['Bolt', '07-bolt'],
  ] as const) {
    await page.getByRole('tab', { name: label }).click();
    await page.waitForTimeout(500);
    await shot(name);
  }

  // --- Beállítások ---
  await page.getByRole('button', { name: 'Beállítások' }).click();
  await page.waitForTimeout(500);
  await shot('08-beallitasok');

  // --- Asztali keret ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await shot('09-desktop-frame');

  await browser.close();

  // -------------------------------------------------------------------------
  console.log('\n── FÜSTTESZT ──────────────────────────────────');
  console.log(`  Készpénz koppintás előtt : ${cashBefore}`);
  console.log(`  Készpénz koppintás után  : ${cashAfter}`);
  console.log(`  Képernyőképek            : dist/shots/`);

  if (warnings.length > 0) {
    console.log(`\n  Figyelmeztetés (${warnings.length}):`);
    for (const warning of [...new Set(warnings)].slice(0, 8)) {
      console.log(`    · ${warning.slice(0, 160)}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n  ✗ HIBA (${errors.length}):`);
    for (const error of [...new Set(errors)].slice(0, 12)) {
      console.log(`    · ${error.slice(0, 200)}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\n  ✓ Nulla konzolhiba.');
  }
  console.log('');
}

void main().catch((error) => {
  console.error('A füstteszt elszállt:', error);
  process.exitCode = 1;
});
