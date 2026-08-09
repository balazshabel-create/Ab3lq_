/**
 * FÜSTTESZT A WEB-ELŐNÉZETHEZ
 *
 * Betölti a `dist/preview.html`-t fejnélküli böngészőben, és VÉGIGJÁTSSZA a
 * legfontosabb hurkot: megvárja a vendéget, kiszolgálja, és ellenőrzi, hogy
 * tényleg nőtt-e a pénz. Ez fogja meg azt a hibaosztályt, amit a
 * típusellenőrzés és a unit tesztek nem: hogy a gomb elérhető-e egyáltalán.
 *
 * Futtatás:  npx tsx scripts/smokeTestWeb.ts
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const previewPath = join(here, '..', 'dist', 'preview.html');
const shotDir = join(here, '..', 'dist', 'shots');

if (!existsSync(previewPath)) {
  throw new Error('Nincs dist/preview.html – futtasd: npx tsx scripts/buildWebPreview.ts');
}
mkdirSync(shotDir, { recursive: true });

const errors: string[] = [];

/**
 * Az előtelepített Chromium megkeresése.
 *
 * A böngésző a PLAYWRIGHT_BROWSERS_PATH alatt van, de a verziószáma nem
 * feltétlenül egyezik a telepített playwright csomagéval – ilyenkor a
 * `launch()` letöltéssel próbálkozna, ami itt nem megy.
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
 * A pontos készpénz a fejléc akadálymentesítési címkéjéből.
 *
 * A megjelenített „1,2 M Ft” formátum kerekít, tehát tesztelésre alkalmatlan;
 * a címke viszont a nyers egész értéket tartalmazza.
 */
async function readCash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const node = document.querySelector('[aria-label^="Készpénz "]');
    const label = node?.getAttribute('aria-label') ?? '';
    const match = label.match(/Készpénz (\d+) dollár/);
    return match ? Number.parseInt(match[1] ?? '', 10) : NaN;
  });
}

async function main(): Promise<void> {
  const executablePath = findChromium();
  console.log(`Böngésző: ${executablePath ?? '(alapértelmezett)'}`);

  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  // Rövid alapértelmezett várakozás: egy hiányzó elem itt információ, nem ok
  // arra, hogy fél percig álljon a teszt.
  page.setDefaultTimeout(6_000);

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`file://${previewPath}`, { waitUntil: 'load' });

  // A játék akkor van kész, amikor a dokk gombjai megjelentek.
  await page.getByRole('button', { name: 'Kínálat' }).waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1200);

  const shot = (name: string) => page.screenshot({ path: join(shotDir, `${name}.png`) });
  await shot('01-kavezó');

  // ------------------------------------------------------------------
  // A LÉNYEG: érkezik-e vendég, és ki tudom-e szolgálni?
  // ------------------------------------------------------------------
  const serveButton = page.getByRole('button', { name: /elkészítése a vendégnek/ });
  await serveButton.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1000); // amíg a vendég a helyére sétál
  console.log('✓ Vendég megérkezett és koppintható.');

  const cashBefore = await readCash(page);

  // Néhány kiszolgálás: a virsli 1 mp alatt készül el.
  let served = 0;
  for (let attempt = 0; attempt < 10 && served < 4; attempt += 1) {
    const button = serveButton.first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => undefined);
      served += 1;
      await page.waitForTimeout(1400); // főzés + átadás
    } else {
      await page.waitForTimeout(700);
    }
  }
  await shot('02-kiszolgalas');

  const cashAfter = await readCash(page);

  // A "készül…" jelzésnek meg kell jelennie főzés közben.
  await serveButton.first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(250);
  const cookingVisible = (await page.getByText('készül…').count()) > 0;
  await shot('03-fozes');
  await page.waitForTimeout(1500);

  // ------------------------------------------------------------------
  // Panelek
  // ------------------------------------------------------------------
  let panelsOpened = 0;
  for (const [label, name] of [
    ['Kínálat', '04-kinalat'],
    ['Gépek', '05-gepek'],
    ['Helyek', '06-helyek'],
    ['Bolt', '07-bolt'],
  ] as const) {
    const opened = await page
      .getByRole('button', { name: label })
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      errors.push(`A(z) "${label}" panel nem nyílt meg.`);
      continue;
    }

    panelsOpened += 1;
    await page.waitForTimeout(600);
    await shot(name);

    // Bezárás a panel fejlécében lévő gombbal.
    // `exact: true` kell: enélkül a „Bezárás” a háttér „Panel bezárása”
    // címkéjére is illeszkedne, és a kettős találat hibát dobna.
    const closed = await page
      .getByRole('button', { name: 'Bezárás', exact: true })
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!closed) errors.push(`A(z) "${label}" panel nem záródott be.`);
    await page.waitForTimeout(600);
  }

  await browser.close();

  // ------------------------------------------------------------------
  const income = cashAfter - cashBefore;
  console.log('\n── FÜSTTESZT ──────────────────────────────');
  console.log(`  Kiszolgálási kísérlet : ${served}`);
  console.log(`  Készpénz előtte       : ${cashBefore}`);
  console.log(`  Készpénz utána        : ${cashAfter}`);
  console.log(`  Keresett              : ${income}`);
  console.log(`  „készül…” látszott    : ${cookingVisible ? 'igen' : 'NEM'}`);
  console.log(`  Képernyőképek         : dist/shots/`);

  const checks: [string, boolean][] = [
    ['Érkezik kiszolgálható vendég', served > 0],
    ['A kiszolgálás tényleg fizet', Number.isFinite(income) && income > 0],
    ['A főzés látszik a képernyőn', cookingVisible],
    ['Mind a 4 panel megnyílik és bezárható', panelsOpened === 4],
    ['Nincs konzolhiba', errors.length === 0],
  ];

  console.log('');
  let failed = 0;
  for (const [label, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }

  if (errors.length > 0) {
    console.log(`\n  Hibák (${errors.length}):`);
    for (const error of [...new Set(errors)].slice(0, 10)) {
      console.log(`    · ${error.slice(0, 180)}`);
    }
  }

  console.log('');
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((error) => {
  console.error('A füstteszt elszállt:', error);
  process.exitCode = 1;
});
