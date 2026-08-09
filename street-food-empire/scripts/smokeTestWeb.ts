/**
 * SMOKE TEST FOR THE WEB PREVIEW
 *
 * Loads `dist/preview.html` in a headless browser and actually PLAYS the most
 * important loop: it waits for a customer, serves them, and checks that the
 * cash really went up. This catches the class of bug that type checking and
 * unit tests cannot: whether the button is reachable at all.
 *
 * Run:  npx tsx scripts/smokeTestWeb.ts
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const previewPath = join(here, '..', 'dist', 'preview.html');
const shotDir = join(here, '..', 'dist', 'shots');

if (!existsSync(previewPath)) {
  throw new Error('No dist/preview.html - run: npx tsx scripts/buildWebPreview.ts');
}
mkdirSync(shotDir, { recursive: true });

const errors: string[] = [];

/**
 * Locate the pre-installed Chromium.
 *
 * The browser lives under PLAYWRIGHT_BROWSERS_PATH, but its version does not
 * necessarily match the installed playwright package - in that case `launch()`
 * would try to download one, which is not possible here.
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

/**
 * The exact cash value, read from the header's accessibility label.
 *
 * The displayed "$1.2 M" format rounds, so it is useless for assertions; the
 * label carries the raw integer.
 */
async function readCash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const node = document.querySelector('[aria-label^="Cash "]');
    const label = node?.getAttribute('aria-label') ?? '';
    const match = label.match(/Cash (\d+) dollars/);
    return match ? Number.parseInt(match[1] ?? '', 10) : NaN;
  });
}

async function main(): Promise<void> {
  const executablePath = findChromium();
  console.log(`Browser: ${executablePath ?? '(default)'}`);

  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  // Short default timeout: a missing element here is information, not a reason
  // to stall the test for half a minute.
  page.setDefaultTimeout(6_000);

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`file://${previewPath}`, { waitUntil: 'load' });

  // The game is ready once the dock buttons have appeared.
  await page.getByRole('button', { name: 'Menu' }).waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1200);

  const shot = (name: string) => page.screenshot({ path: join(shotDir, `${name}.png`) });
  await shot('01-cafe');

  // ------------------------------------------------------------------
  // THE POINT: does a customer arrive, and can I serve them?
  // ------------------------------------------------------------------
  const serveButton = page.getByRole('button', { name: /^Cook .* for the customer$/ });
  await serveButton.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1000); // while the customer walks into place
  console.log('✓ Customer arrived and is tappable.');

  const cashBefore = await readCash(page);

  // A few orders: the sausage takes 1 second to cook.
  let served = 0;
  for (let attempt = 0; attempt < 10 && served < 4; attempt += 1) {
    const button = serveButton.first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => undefined);
      served += 1;
      await page.waitForTimeout(1400); // cooking + handover
    } else {
      await page.waitForTimeout(700);
    }
  }
  await shot('02-serving');

  const cashAfter = await readCash(page);

  // The "cooking…" badge has to show up while cooking.
  await serveButton.first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(250);
  const cookingVisible = (await page.getByText('cooking…').count()) > 0;
  await shot('03-cooking');
  await page.waitForTimeout(1500);

  // ------------------------------------------------------------------
  // Panels
  // ------------------------------------------------------------------
  let panelsOpened = 0;
  for (const [label, name] of [
    ['Menu', '04-menu'],
    ['Machines', '05-machines'],
    ['Places', '06-places'],
    ['Shop', '07-shop'],
  ] as const) {
    const opened = await page
      .getByRole('button', { name: label })
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      errors.push(`The "${label}" panel did not open.`);
      continue;
    }

    panelsOpened += 1;
    await page.waitForTimeout(600);
    await shot(name);

    // Close via the button in the panel header.
    // `exact: true` is required: without it "Close" would also match the
    // backdrop's "Close panel" label, and the double hit would throw.
    const closed = await page
      .getByRole('button', { name: 'Close', exact: true })
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!closed) errors.push(`The "${label}" panel did not close.`);
    await page.waitForTimeout(600);
  }

  await browser.close();

  // ------------------------------------------------------------------
  const income = cashAfter - cashBefore;
  console.log('\n── SMOKE TEST ─────────────────────────────');
  console.log(`  Serve attempts     : ${served}`);
  console.log(`  Cash before        : ${cashBefore}`);
  console.log(`  Cash after         : ${cashAfter}`);
  console.log(`  Earned             : ${income}`);
  console.log(`  "cooking…" visible : ${cookingVisible ? 'yes' : 'NO'}`);
  console.log(`  Screenshots        : dist/shots/`);

  const checks: [string, boolean][] = [
    ['A servable customer arrives', served > 0],
    ['Serving actually pays', Number.isFinite(income) && income > 0],
    ['Cooking is visible on screen', cookingVisible],
    ['All 4 panels open and close', panelsOpened === 4],
    ['No console errors', errors.length === 0],
  ];

  console.log('');
  let failed = 0;
  for (const [label, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }

  if (errors.length > 0) {
    console.log(`\n  Errors (${errors.length}):`);
    for (const error of [...new Set(errors)].slice(0, 10)) {
      console.log(`    · ${error.slice(0, 180)}`);
    }
  }

  console.log('');
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((error) => {
  console.error('The smoke test crashed:', error);
  process.exitCode = 1;
});
